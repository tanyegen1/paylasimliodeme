import "server-only";
import { z } from "zod";
import { q, q1, tx, type Db, pool } from "./db";
import { AppError, notFound } from "./errors";
import { parse } from "./auth";
import { requireFullMember, requireMember, type Member } from "./groups";
import { createExpense } from "./expenses";
import { audit } from "./audit";
import { CATEGORIES } from "@/lib/categories";
import { MAX_MINOR } from "@/lib/money";
import { overlapDays } from "@/lib/split";
import type { ExpenseInput } from "@/lib/expense-calc";

export const todayTR = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(now);
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = (d: Date) => d.toISOString().slice(0, 10);
export function addMonths(date: string, n: number, dayOfMonth: number): string {
  const y = +date.slice(0, 4), m = +date.slice(5, 7) - 1 + n;
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}-${String(Math.min(dayOfMonth, daysIn(yy, mm + 1))).padStart(2, "0")}`;
}
export const addDays = (date: string, n: number) => iso(new Date(Date.parse(date + "T00:00:00Z") + n * 86_400_000));

const ruleSchema = z.object({
  title: z.string().trim().min(1, "title_required").max(120),
  category: z.enum(CATEGORIES).default("other"),
  amount: z.number().int().positive().max(MAX_MINOR).nullable(),  // null: değişken fatura
  payerMemberId: z.string().uuid(),
  frequency: z.enum(["monthly", "weekly"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  prorateByDays: z.boolean().default(false),
});

export async function createRule(groupId: string, userId: string, raw: unknown) {
  const me = await requireMember(groupId, userId);
  requireFullMember(me);
  const i = parse(ruleSchema, raw);
  if (!(await q1(`select 1 from members where id=$1 and group_id=$2 and status='active'`, [i.payerMemberId, groupId]))) throw new AppError("member_not_in_group");
  const g = await q1(`select currency from groups where id=$1`, [groupId]);
  const r = await q1(
    `insert into recurring_rules (group_id, title, category, amount_minor, currency, payer_member_id, frequency, day_of_month, next_run, prorate_by_days, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [groupId, i.title, i.category, i.amount, g!.currency, i.payerMemberId, i.frequency, +i.startDate.slice(8, 10), i.startDate, i.prorateByDays, me.id]);
  await audit(pool, { groupId, userId, memberId: me.id, type: "recurring.created", entityType: "recurring_rule", entityId: r!.id });
  return r!.id as string;
}
export async function updateRule(groupId: string, userId: string, ruleId: string, raw: unknown) {
  const me = await requireMember(groupId, userId);
  requireFullMember(me);
  const i = parse(z.object({
    title: z.string().trim().min(1, "title_required").max(120), amount: z.number().int().positive().max(MAX_MINOR).nullable(),
    payerMemberId: z.string().uuid(), prorateByDays: z.boolean(), active: z.boolean(),
  }), raw);
  if (!(await q1(`select 1 from members where id=$1 and group_id=$2 and status='active'`, [i.payerMemberId, groupId]))) throw new AppError("member_not_in_group");
  const r = await pool.query(
    `update recurring_rules set title=$3, amount_minor=$4, payer_member_id=$5, prorate_by_days=$6, active=$7,
       next_run = case when $7 and not active and next_run < current_date then current_date else next_run end
     where id=$1 and group_id=$2`, [ruleId, groupId, i.title, i.amount, i.payerMemberId, i.prorateByDays, i.active]);
  if (!r.rowCount) throw notFound();
  await audit(pool, { groupId, userId, memberId: me.id, type: i.active ? "recurring.updated" : "recurring.stopped", entityType: "recurring_rule", entityId: ruleId });
}
export async function deleteRule(groupId: string, userId: string, ruleId: string) {
  const me = await requireMember(groupId, userId);
  requireFullMember(me);
  await q(`delete from recurring_rules where id=$1 and group_id=$2`, [ruleId, groupId]);
  await audit(pool, { groupId, userId, memberId: me.id, type: "recurring.deleted", entityType: "recurring_rule", entityId: ruleId });
}
export async function listRules(groupId: string, userId: string) {
  await requireMember(groupId, userId);
  return q<{ id: string; title: string; category: string; amount_minor: number | null; currency: string; payer_member_id: string; frequency: string; next_run: string; prorate_by_days: boolean; active: boolean }>(
    `select id, title, category, amount_minor, currency, payer_member_id, frequency, next_run, prorate_by_days, active from recurring_rules where group_id=$1 order by active desc, next_run`, [groupId]);
}

/** Gün bazlı paylaşım ağırlıkları: üyenin evde kaldığı günlerin fatura dönemiyle kesişimi. */
export function prorationWeights(members: Pick<Member, "id" | "stay_from" | "stay_to">[], from: string, to: string) {
  return members.map((m) => ({ memberId: m.id, weight: overlapDays(from, to, m.stay_from, m.stay_to) })).filter((w) => w.weight > 0);
}

/**
 * Vadesi gelen tekrarlayan giderleri üretir. Çift kayıt koruması:
 * (kural, dönem) çifti recurring_runs tablosunda birincil anahtardır; aynı dönem ikinci kez
 * eklenemez. Kural satırı kilitlenir (SKIP LOCKED), eşzamanlı çalışan iki görev aynı kuralı işlemez.
 */
export async function runRecurring(today = todayTR(), groupId?: string): Promise<number> {
  const due = await q<{ id: string }>(
    `select id from recurring_rules where active and next_run <= $1 and ($2::uuid is null or group_id=$2) order by next_run limit 200`, [today, groupId ?? null]);
  let created = 0;
  for (const { id } of due) {
    for (let guard = 0; guard < 24; guard++) {
      const made = await tx(async (db: Db) => {
        const rule = await q1(`select * from recurring_rules where id=$1 and active and next_run <= $2 for update skip locked`, [id, today], db);
        if (!rule) return null;
        const period = rule.next_run as string;
        const next = rule.frequency === "weekly" ? addDays(period, 7) : addMonths(period, 1, rule.day_of_month ?? +period.slice(8, 10));
        const periodEnd = addDays(next, -1);
        await db.query(`update recurring_rules set next_run=$2 where id=$1`, [id, next]);
        const ins = await db.query(`insert into recurring_runs (rule_id, period_key) values ($1,$2) on conflict do nothing`, [id, period]);
        if (!ins.rowCount) return false;
        const members = await q<Member>(`select * from members where group_id=$1 and status='active' order by position, joined_at`, [rule.group_id], db);
        const creator = (await q1<Member>(`select * from members where id=$1`, [rule.created_by], db))!;
        let payerId = rule.payer_member_id as string;
        if (!members.some((m) => m.id === payerId)) payerId = members[0]?.id;
        if (!payerId) return false;
        const amount = (rule.amount_minor ?? 0) as number;
        let split: ExpenseInput["split"] = { type: "equal", memberIds: members.map((m) => m.id) };
        if (rule.prorate_by_days) {
          const parts = prorationWeights(members, period, periodEnd);
          if (parts.length) split = { type: "shares", parts };
        }
        const expenseId = await createExpense(rule.group_id, null, {
          title: rule.title, category: rule.category, amount, currency: rule.currency, expenseDate: period,
          payers: [{ memberId: payerId, amount }], split, periodStart: period, periodEnd,
        }, { db, status: amount > 0 ? "active" : "draft", recurringRuleId: id, source: "recurring", skipAuth: creator });
        await db.query(`update recurring_runs set expense_id=$3 where rule_id=$1 and period_key=$2`, [id, period, expenseId]);
        return true;
      });
      if (made === null) break;
      if (made) created++;
    }
  }
  return created;
}
