import "server-only";
import { z } from "zod";
import { q, q1, tx, type Db, pool } from "./db";
import { AppError, forbidden, notFound } from "./errors";
import { parse } from "./auth";
import { requireMember, type Member } from "./groups";
import { audit } from "./audit";
import { track } from "./analytics";
import { notify } from "./notify";
import { expenseSchema, validateExpense, memberIdsOf, type ExpenseInput } from "@/lib/expense-calc";
import { SplitError, splitEqual } from "@/lib/split";

export type ExpenseRow = {
  id: string; group_id: string; title: string; note: string | null; category: string; amount_minor: number; currency: string;
  original_amount_minor: number | null; original_currency: string | null; fx_rate: string | null; fx_source: string | null; fx_date: string | null;
  expense_date: string; split_type: string; split_meta: ExpenseInput["split"]; status: "active" | "draft"; created_by: string | null;
  receipt_id: string | null; recurring_rule_id: string | null; period_start: string | null; period_end: string | null; attachment_id: string | null;
  version: number; deleted_at: Date | null; created_at: Date; updated_at: Date;
};

function parseExpense(raw: unknown): { input: ExpenseInput; shares: ReturnType<typeof validateExpense> } {
  const input = parse(expenseSchema, raw);
  try {
    return { input, shares: validateExpense(input) };
  } catch (e) {
    if (e instanceof SplitError) throw new AppError(e.code);
    throw e;
  }
}

async function assertMembers(db: Db, groupId: string, ids: string[], allowLeft: string[] = []) {
  const rows = await q<{ id: string; status: string }>(`select id, status from members where group_id=$1 and id = any($2)`, [groupId, ids], db);
  if (rows.length !== ids.length) throw new AppError("member_not_in_group");
  for (const r of rows) if (r.status !== "active" && !allowLeft.includes(r.id)) throw new AppError("member_not_active");
}

async function writeLines(db: Db, expenseId: string, input: ExpenseInput, shares: { memberId: string; amount: number; rounding: number }[]) {
  await db.query(`delete from expense_payers where expense_id=$1`, [expenseId]);
  await db.query(`delete from expense_allocations where expense_id=$1`, [expenseId]);
  for (const p of input.payers) {
    if (p.amount === 0 && input.payers.length > 1) continue;
    await db.query(`insert into expense_payers (expense_id, member_id, amount_minor) values ($1,$2,$3)`, [expenseId, p.memberId, p.amount]);
  }
  for (const s of shares) {
    await db.query(`insert into expense_allocations (expense_id, member_id, amount_minor, rounding_minor) values ($1,$2,$3,$4)`, [expenseId, s.memberId, s.amount, s.rounding]);
  }
}

type CreateOpts = { db?: Db; status?: "active" | "draft"; receiptId?: string; recurringRuleId?: string; source?: string; skipAuth?: Member };

/** Harcama oluşturur. Paylar sunucuda yeniden hesaplanır; istemciden gelen pay tutarlarına güvenilmez. */
export async function createExpense(groupId: string, userId: string | null, raw: unknown, opts: CreateOpts = {}): Promise<string> {
  const me = opts.skipAuth ?? (await requireMember(groupId, userId!));
  const { input, shares } = parseExpense(raw);
  const status = opts.status ?? "active";
  if (status === "active" && input.amount <= 0) throw new AppError("amount_required");
  const run = async (db: Db) => {
    await assertMembers(db, groupId, memberIdsOf(input));
    if (input.attachmentId && !(await q1(`select 1 from attachments where id=$1 and group_id=$2 and deleted_at is null`, [input.attachmentId, groupId], db))) throw notFound();
    const e = await q1(
      `insert into expenses (group_id, title, note, category, amount_minor, currency, original_amount_minor, original_currency, fx_rate, fx_source, fx_date,
         expense_date, split_type, split_meta, status, created_by, receipt_id, recurring_rule_id, period_start, period_end, attachment_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) returning id`,
      [groupId, input.title, input.note || null, input.category, input.amount, input.currency,
        input.fx?.originalAmount ?? null, input.fx?.originalCurrency ?? null, input.fx ? input.fx.rate.replace(",", ".") : null, input.fx?.source ?? null, input.fx?.date ?? null,
        input.expenseDate, input.split.type, JSON.stringify(input.split), status, me.id, opts.receiptId ?? null, opts.recurringRuleId ?? null,
        input.periodStart ?? null, input.periodEnd ?? null, input.attachmentId ?? null], db);
    await writeLines(db, e!.id, input, shares);
    await db.query(`update groups set settled_at=null where id=$1`, [groupId]);
    await audit(db, { groupId, userId, memberId: me.id, type: "expense.created", entityType: "expense", entityId: e!.id, data: { title: input.title, amount_minor: input.amount, currency: input.currency, status, source: opts.source ?? "manual" } });
    if (status === "active") {
      const others = await q(`select distinct m.user_id from members m where m.id = any($1) and m.user_id is not null and m.id <> $2`, [shares.map((s) => s.memberId), me.id], db);
      for (const o of others) await notify(db, { userId: o.user_id, groupId, type: "expense_added", category: "group_activity", data: { expenseId: e!.id, title: input.title, by: me.display_name } });
    }
    return e!.id as string;
  };
  const id = opts.db ? await run(opts.db) : await tx(run);
  const n = await q1(`select count(*)::int n from expenses where group_id=$1`, [groupId], opts.db ?? pool);
  const props = { split_type: input.split.type, currency: input.currency, payer_count: input.payers.length, member_count: shares.length, source: opts.source ?? "manual", has_receipt: !!opts.receiptId };
  if (n!.n === 1) await track("first_expense_created", { userId, groupId }, props);
  await track("expense_created", { userId, groupId }, props);
  return id;
}

function canEdit(me: Member, e: { created_by: string | null }) {
  return me.role !== "guest" || e.created_by === me.id;
}

async function snapshot(db: Db, expenseId: string) {
  const e = await q1(`select title, amount_minor, currency, expense_date, split_type, category, status from expenses where id=$1`, [expenseId], db);
  const payers = await q(`select member_id, amount_minor from expense_payers where expense_id=$1 order by member_id`, [expenseId], db);
  const allocations = await q(`select member_id, amount_minor from expense_allocations where expense_id=$1 order by member_id`, [expenseId], db);
  return { ...e, payers, allocations };
}

export async function updateExpense(groupId: string, userId: string, expenseId: string, raw: unknown, expectedVersion?: number) {
  const me = await requireMember(groupId, userId);
  const { input, shares } = parseExpense(raw);
  if (input.amount <= 0) throw new AppError("amount_required");
  await tx(async (db) => {
    const e = await q1<ExpenseRow>(`select * from expenses where id=$1 and group_id=$2 and deleted_at is null for update`, [expenseId, groupId], db);
    if (!e) throw notFound();
    if (!canEdit(me, e)) throw new AppError("guest_limited", 403);
    if (e.receipt_id) throw new AppError("receipt_expense_locked");
    if (expectedVersion != null && expectedVersion !== e.version) throw new AppError("stale_version", 409);
    const before = await snapshot(db, expenseId);
    const existing = [...before.payers, ...before.allocations].map((r) => r.member_id as string);
    await assertMembers(db, groupId, memberIdsOf(input), existing);
    await db.query(
      `update expenses set title=$2, note=$3, category=$4, amount_minor=$5, currency=$6, original_amount_minor=$7, original_currency=$8, fx_rate=$9, fx_source=$10, fx_date=$11,
         expense_date=$12, split_type=$13, split_meta=$14, status='active', period_start=$15, period_end=$16, attachment_id=coalesce($17, attachment_id),
         version=version+1, updated_at=now() where id=$1`,
      [expenseId, input.title, input.note || null, input.category, input.amount, input.currency,
        input.fx?.originalAmount ?? null, input.fx?.originalCurrency ?? null, input.fx ? input.fx.rate.replace(",", ".") : null, input.fx?.source ?? null, input.fx?.date ?? null,
        input.expenseDate, input.split.type, JSON.stringify(input.split), input.periodStart ?? null, input.periodEnd ?? null, input.attachmentId ?? null]);
    await writeLines(db, expenseId, input, shares);
    await db.query(`update groups set settled_at=null where id=$1`, [groupId]);
    await audit(db, { groupId, userId, memberId: me.id, type: "expense.updated", entityType: "expense", entityId: expenseId, data: { before, after: await snapshot(db, expenseId) } });
  });
}

/** Geri alınabilir silme. Bakiyeden çıkar, kayıt ve geçmiş korunur. */
export async function deleteExpense(groupId: string, userId: string, expenseId: string) {
  const me = await requireMember(groupId, userId);
  await tx(async (db) => {
    const e = await q1<ExpenseRow>(`select * from expenses where id=$1 and group_id=$2 and deleted_at is null for update`, [expenseId, groupId], db);
    if (!e) throw notFound();
    if (!canEdit(me, e)) throw new AppError("guest_limited", 403);
    await db.query(`update expenses set deleted_at=now(), deleted_by=$2 where id=$1`, [expenseId, me.id]);
    if (e.receipt_id) await db.query(`update receipts set status='open', expense_id=null, finalized_at=null, finalized_by=null where id=$1`, [e.receipt_id]);
    await audit(db, { groupId, userId, memberId: me.id, type: "expense.deleted", entityType: "expense", entityId: expenseId, data: { title: e.title, amount_minor: e.amount_minor, currency: e.currency } });
  });
}
export async function restoreExpense(groupId: string, userId: string, expenseId: string) {
  const me = await requireMember(groupId, userId);
  await tx(async (db) => {
    const e = await q1<ExpenseRow>(`select * from expenses where id=$1 and group_id=$2 and deleted_at is not null for update`, [expenseId, groupId], db);
    if (!e) throw notFound();
    if (!canEdit(me, e)) throw new AppError("guest_limited", 403);
    if (e.receipt_id) throw new AppError("receipt_expense_locked");
    await db.query(`update expenses set deleted_at=null, deleted_by=null where id=$1`, [expenseId]);
    await db.query(`update groups set settled_at=null where id=$1`, [groupId]);
    await audit(db, { groupId, userId, memberId: me.id, type: "expense.restored", entityType: "expense", entityId: expenseId, data: { title: e.title } });
  });
}

export async function listExpenses(groupId: string, userId: string, opts: { includeDeleted?: boolean } = {}) {
  const me = await requireMember(groupId, userId);
  return q<ExpenseRow & { my_share: number; my_paid: number; payer_names: string[]; open_requests: number }>(
    `select e.*,
       coalesce((select amount_minor from expense_allocations a where a.expense_id=e.id and a.member_id=$2),0) as my_share,
       coalesce((select amount_minor from expense_payers p where p.expense_id=e.id and p.member_id=$2),0) as my_paid,
       (select coalesce(array_agg(m.display_name order by p.amount_minor desc), '{}') from expense_payers p join members m on m.id=p.member_id where p.expense_id=e.id) as payer_names,
       (select count(*)::int from expense_comments c where c.expense_id=e.id and c.kind='correction_request' and c.status='open') as open_requests
     from expenses e where e.group_id=$1 and ($3 or e.deleted_at is null)
     order by e.deleted_at nulls first, (e.status='draft') desc, e.expense_date desc, e.created_at desc limit 500`, [groupId, me.id, !!opts.includeDeleted]);
}

export async function getExpense(groupId: string, userId: string, expenseId: string) {
  const me = await requireMember(groupId, userId);
  if (!/^[0-9a-f-]{36}$/i.test(expenseId)) throw notFound();
  const expense = await q1<ExpenseRow>(`select * from expenses where id=$1 and group_id=$2`, [expenseId, groupId]);
  if (!expense) throw notFound();
  const payers = await q<{ member_id: string; amount_minor: number }>(`select member_id, amount_minor from expense_payers where expense_id=$1 order by amount_minor desc`, [expenseId]);
  const allocations = await q<{ member_id: string; amount_minor: number; rounding_minor: number }>(
    `select a.member_id, a.amount_minor, a.rounding_minor from expense_allocations a join members m on m.id=a.member_id where a.expense_id=$1 order by m.position, m.joined_at`, [expenseId]);
  const comments = await q<{ id: string; member_id: string; kind: string; body: string; status: string; created_at: Date }>(
    `select id, member_id, kind, body, status, created_at from expense_comments where expense_id=$1 order by created_at`, [expenseId]);
  const history = await q<{ id: number; type: string; actor_member_id: string | null; data: Record<string, unknown>; created_at: Date }>(
    `select id, type, actor_member_id, data, created_at from audit_events where entity_id=$1 and group_id=$2 order by id desc limit 50`, [expenseId, groupId]);
  return { expense, payers, allocations, comments, history, me, canEdit: canEdit(me, expense) && !expense.receipt_id };
}

export async function addComment(groupId: string, userId: string, expenseId: string, raw: unknown) {
  const me = await requireMember(groupId, userId);
  const input = parse(z.object({ kind: z.enum(["comment", "correction_request"]), body: z.string().trim().min(1, "comment_required").max(1000) }), raw);
  const e = await q1(`select id, title, created_by from expenses where id=$1 and group_id=$2`, [expenseId, groupId]);
  if (!e) throw notFound();
  await q(`insert into expense_comments (expense_id, member_id, kind, body) values ($1,$2,$3,$4)`, [expenseId, me.id, input.kind, input.body]);
  await audit(pool, { groupId, userId, memberId: me.id, type: input.kind === "comment" ? "expense.commented" : "expense.correction_requested", entityType: "expense", entityId: expenseId });
  if (e.created_by && e.created_by !== me.id) {
    const owner = await q1(`select user_id from members where id=$1`, [e.created_by]);
    await notify(null, { userId: owner?.user_id, groupId, type: input.kind === "comment" ? "expense_comment" : "correction_requested", category: "group_activity", data: { expenseId, title: e.title, by: me.display_name } });
  }
}
export async function resolveComment(groupId: string, userId: string, commentId: string) {
  const me = await requireMember(groupId, userId);
  const c = await q1(`select c.id, c.member_id, c.expense_id, e.created_by from expense_comments c join expenses e on e.id=c.expense_id where c.id=$1 and e.group_id=$2`, [commentId, groupId]);
  if (!c) throw notFound();
  if (c.member_id !== me.id && c.created_by !== me.id && me.role !== "admin") throw forbidden();
  await q(`update expense_comments set status='resolved', resolved_by=$2 where id=$1`, [commentId, me.id]);
  await audit(pool, { groupId, userId, memberId: me.id, type: "expense.correction_resolved", entityType: "expense", entityId: c.expense_id });
}

/** Sonradan katılan üyeyi seçili (eşit bölüşülen) harcamalara dahil eder. */
export async function includeMemberInExpenses(groupId: string, userId: string, memberId: string, expenseIds: string[]) {
  const me = await requireMember(groupId, userId);
  if (me.role === "guest") throw new AppError("guest_limited", 403);
  let changed = 0;
  await tx(async (db) => {
    await assertMembers(db, groupId, [memberId]);
    for (const id of expenseIds.slice(0, 200)) {
      const e = await q1<ExpenseRow>(`select * from expenses where id=$1 and group_id=$2 and deleted_at is null and status='active' and split_type='equal' and receipt_id is null for update`, [id, groupId], db);
      if (!e) continue;
      const cur = await q<{ member_id: string }>(`select a.member_id from expense_allocations a join members m on m.id=a.member_id where a.expense_id=$1 order by m.position, m.joined_at`, [id], db);
      if (cur.some((c) => c.member_id === memberId)) continue;
      const ids = [...cur.map((c) => c.member_id), memberId];
      const shares = splitEqual(e.amount_minor, ids);
      const before = await snapshot(db, id);
      await db.query(`delete from expense_allocations where expense_id=$1`, [id]);
      for (const s of shares) await db.query(`insert into expense_allocations (expense_id, member_id, amount_minor, rounding_minor) values ($1,$2,$3,$4)`, [id, s.memberId, s.amount, s.rounding]);
      await db.query(`update expenses set split_meta=$2, version=version+1, updated_at=now() where id=$1`, [id, JSON.stringify({ type: "equal", memberIds: ids })]);
      await audit(db, { groupId, userId, memberId: me.id, type: "expense.updated", entityType: "expense", entityId: id, data: { reason: "member_included", before, after: await snapshot(db, id) } });
      changed++;
    }
    if (changed) await db.query(`update groups set settled_at=null where id=$1`, [groupId]);
  });
  return changed;
}
