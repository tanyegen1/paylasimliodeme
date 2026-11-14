import "server-only";
import { z } from "zod";
import { q, q1, tx, type Db, pool } from "./db";
import { AppError, forbidden, notFound } from "./errors";
import { parse } from "./auth";
import { audit } from "./audit";
import { track } from "./analytics";
import { notify } from "./notify";
import { CURRENCY_CODES } from "@/lib/money";

export const GROUP_TYPES = ["home", "trip", "meal", "event", "other"] as const;
export type GroupType = (typeof GROUP_TYPES)[number];
export type Group = {
  id: string; name: string; type: GroupType; currency: string; simplify_debts: boolean;
  settle_schedule: string; settle_date: string | null; start_date: string | null; end_date: string | null;
  is_demo: boolean; settled_at: Date | null; archived_at: Date | null; created_at: Date; created_by: string | null;
};
export type Member = {
  id: string; group_id: string; user_id: string | null; display_name: string; role: "admin" | "member" | "guest";
  status: "active" | "left"; stay_from: string | null; stay_to: string | null; position: number; joined_at: Date;
};

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optDate = z.preprocess((v) => (v === "" || v == null ? null : v), dateStr.nullable());
const groupSchema = z.object({
  name: z.string().trim().min(1, "name_required").max(60),
  type: z.enum(GROUP_TYPES),
  currency: z.enum(CURRENCY_CODES as [string, ...string[]]).default("TRY"),
  placeholders: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  startDate: optDate.optional(),
  endDate: optDate.optional(),
  settleSchedule: z.enum(["weekly", "month_end", "date", "trip_end", "manual"]).default("manual"),
  settleDate: optDate.optional(),
});

/** Üyelik kontrolü. Üye olmayan için grup "yok" gibi davranır (varlığı sızdırılmaz). */
export async function requireMember(groupId: string, userId: string, db: Db = pool): Promise<Member> {
  if (!/^[0-9a-f-]{36}$/i.test(groupId)) throw notFound();
  const m = await q1<Member>(`select * from members where group_id=$1 and user_id=$2 and status='active'`, [groupId, userId], db);
  if (!m) throw notFound();
  return m;
}
export async function requireAdmin(groupId: string, userId: string, db: Db = pool): Promise<Member> {
  const m = await requireMember(groupId, userId, db);
  if (m.role !== "admin") throw forbidden();
  return m;
}
/** Sınırlı misafir: görüntüler, kendi harcamasını ekler, fiş kalemi seçer, ödeme bildirir; yönetemez. */
export function requireFullMember(m: Member) {
  if (m.role === "guest") throw new AppError("guest_limited", 403);
}

export async function createGroup(userId: string, raw: unknown): Promise<Group> {
  const input = parse(groupSchema, raw);
  if (input.settleSchedule === "date" && !input.settleDate) throw new AppError("settle_date_required");
  if (input.startDate && input.endDate && input.endDate < input.startDate) throw new AppError("date_range_invalid");
  const user = await q1(`select display_name, is_demo from users where id=$1`, [userId]);
  if (!user) throw forbidden();
  const group = await tx(async (db) => {
    const g = await q1<Group>(
      `insert into groups (name, type, currency, start_date, end_date, settle_schedule, settle_date, created_by, is_demo)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [input.name, input.type, input.currency, input.startDate ?? null, input.endDate ?? null, input.settleSchedule, input.settleDate ?? null, userId, user.is_demo], db);
    await db.query(`insert into members (group_id, user_id, display_name, role, position) values ($1,$2,$3,'admin',0)`, [g!.id, userId, user.display_name]);
    const names = new Set([user.display_name.toLocaleLowerCase("tr")]);
    let pos = 1;
    for (const name of input.placeholders) {
      if (names.has(name.toLocaleLowerCase("tr"))) continue;
      names.add(name.toLocaleLowerCase("tr"));
      await db.query(`insert into members (group_id, display_name, role, position) values ($1,$2,'member',$3)`, [g!.id, name, pos++]);
    }
    await audit(db, { groupId: g!.id, userId, type: "group.created" });
    return g!;
  });
  const prior = await q1(`select count(*)::int as n from groups where created_by=$1`, [userId]);
  await track("group_created", { userId, groupId: group.id }, { group_type: group.type, member_count: 1 + input.placeholders.length, kind: prior!.n > 1 ? "repeat" : "first" });
  return group;
}

export async function getGroupContext(groupId: string, userId: string) {
  const me = await requireMember(groupId, userId);
  const group = (await q1<Group>(`select * from groups where id=$1`, [groupId]))!;
  const members = await q<Member & { has_account: boolean; has_iban: boolean }>(
    `select m.*, (m.user_id is not null) as has_account, (u.iban is not null) as has_iban
     from members m left join users u on u.id=m.user_id where m.group_id=$1 order by m.position, m.joined_at`, [groupId]);
  return { group, me, members };
}

export async function listGroups(userId: string) {
  return q<Group & { member_count: number; my_member_id: string; last_activity: Date }>(
    `select g.*, m.id as my_member_id,
       (select count(*)::int from members x where x.group_id=g.id and x.status='active') as member_count,
       greatest(g.created_at, coalesce((select max(created_at) from audit_events a where a.group_id=g.id), g.created_at)) as last_activity
     from groups g join members m on m.group_id=g.id and m.user_id=$1 and m.status='active'
     order by g.archived_at nulls first, last_activity desc`, [userId]);
}

const settingsSchema = z.object({
  name: z.string().trim().min(1, "name_required").max(60),
  simplifyDebts: z.boolean(),
  settleSchedule: z.enum(["weekly", "month_end", "date", "trip_end", "manual"]),
  settleDate: optDate.optional(),
  startDate: optDate.optional(),
  endDate: optDate.optional(),
});
export async function updateGroupSettings(groupId: string, userId: string, raw: unknown) {
  const me = await requireAdmin(groupId, userId);
  const s = parse(settingsSchema, raw);
  if (s.settleSchedule === "date" && !s.settleDate) throw new AppError("settle_date_required");
  if (s.startDate && s.endDate && s.endDate < s.startDate) throw new AppError("date_range_invalid");
  await tx(async (db) => {
    const before = await q1(`select name, simplify_debts, settle_schedule from groups where id=$1 for update`, [groupId], db);
    await db.query(
      `update groups set name=$2, simplify_debts=$3, settle_schedule=$4, settle_date=$5, start_date=$6, end_date=$7 where id=$1`,
      [groupId, s.name, s.simplifyDebts, s.settleSchedule, s.settleDate ?? null, s.startDate ?? null, s.endDate ?? null]);
    await audit(db, { groupId, userId, memberId: me.id, type: "group.settings_updated", data: { simplify_before: before!.simplify_debts, simplify_after: s.simplifyDebts, schedule: s.settleSchedule } });
  });
}
export async function setArchived(groupId: string, userId: string, archived: boolean) {
  const me = await requireAdmin(groupId, userId);
  await q(`update groups set archived_at = case when $2 then now() end where id=$1`, [groupId, archived]);
  await audit(pool, { groupId, userId, memberId: me.id, type: archived ? "group.archived" : "group.unarchived" });
}

export async function addPlaceholder(groupId: string, userId: string, name: string): Promise<Member> {
  const me = await requireMember(groupId, userId);
  requireFullMember(me);
  const n = parse(z.string().trim().min(1, "name_required").max(60), name);
  const dup = await q1(`select 1 from members where group_id=$1 and status='active' and lower(display_name)=lower($2)`, [groupId, n]);
  if (dup) throw new AppError("member_name_taken");
  const m = await q1<Member>(
    `insert into members (group_id, display_name, role, position) values ($1,$2,'member', (select coalesce(max(position),0)+1 from members where group_id=$1)) returning *`, [groupId, n]);
  await audit(pool, { groupId, userId, memberId: me.id, type: "member.placeholder_added", entityType: "member", entityId: m!.id });
  return m!;
}

export async function updateMember(groupId: string, userId: string, memberId: string, raw: unknown) {
  const me = await requireMember(groupId, userId);
  const input = parse(z.object({
    name: z.string().trim().min(1, "name_required").max(60),
    stayFrom: optDate.optional(), stayTo: optDate.optional(),
    role: z.enum(["admin", "member"]).optional(),
  }), raw);
  const target = await q1<Member>(`select * from members where id=$1 and group_id=$2`, [memberId, groupId]);
  if (!target) throw notFound();
  // Kendi adını/tarihlerini herkes düzenler; başkasını ve rolleri yalnızca yönetici.
  if (target.id !== me.id && me.role !== "admin") throw forbidden();
  if (input.stayFrom && input.stayTo && input.stayTo < input.stayFrom) throw new AppError("date_range_invalid");
  let role = target.role;
  if (input.role && input.role !== target.role) {
    if (me.role !== "admin") throw forbidden();
    if (!target.user_id) throw new AppError("placeholder_no_role");
    if (target.role === "guest") throw new AppError("guest_no_role");
    if (target.role === "admin" && input.role !== "admin") {
      const admins = await q1(`select count(*)::int n from members where group_id=$1 and role='admin' and status='active'`, [groupId]);
      if (admins!.n <= 1) throw new AppError("last_admin");
    }
    role = input.role;
  }
  await q(`update members set display_name=$2, stay_from=$3, stay_to=$4, role=$5 where id=$1`, [memberId, input.name, input.stayFrom ?? null, input.stayTo ?? null, role]);
  await audit(pool, { groupId, userId, memberId: me.id, type: "member.updated", entityType: "member", entityId: memberId, data: { role } });
}

async function memberHasHistory(memberId: string, db: Db) {
  return !!(await q1(
    `select 1 from expense_payers where member_id=$1 union all select 1 from expense_allocations where member_id=$1
     union all select 1 from payments where from_member=$1 or to_member=$1
     union all select 1 from manual_payment_reports where from_member=$1 or to_member=$1
     union all select 1 from payment_requests where from_member=$1 or to_member=$1 limit 1`, [memberId], db));
}

/**
 * Üye çıkarma / ayrılma. Geçmişi olan üye silinmez, "ayrıldı" olarak işaretlenir:
 * eski harcamalar ve bakiyeler bozulmaz, açık borç/alacak görünmeye devam eder.
 */
export async function removeMember(groupId: string, userId: string, memberId: string) {
  const me = await requireMember(groupId, userId);
  await tx(async (db) => {
    const target = await q1<Member>(`select * from members where id=$1 and group_id=$2 and status='active' for update`, [memberId, groupId], db);
    if (!target) throw notFound();
    const self = target.id === me.id;
    if (!self && me.role !== "admin") throw forbidden();
    if (target.role === "admin") {
      const others = await q1(`select count(*)::int n from members where group_id=$1 and role='admin' and status='active' and id<>$2`, [groupId, memberId], db);
      const remaining = await q1(`select count(*)::int n from members where group_id=$1 and status='active' and user_id is not null and id<>$2`, [groupId, memberId], db);
      if (others!.n === 0 && remaining!.n > 0) throw new AppError("last_admin");
    }
    if (await memberHasHistory(memberId, db)) {
      await db.query(`update members set status='left', left_at=now() where id=$1`, [memberId]);
    } else {
      await db.query(`delete from members where id=$1`, [memberId]);
    }
    await db.query(`update couple_links set status='ended' where group_id=$1 and (member_a=$2 or member_b=$2)`, [groupId, memberId]);
    await audit(db, { groupId, userId, memberId: me.id, type: self ? "member.left" : "member.removed", data: { target: target.id } });
  });
}

/** Çiftlerin birlikte hesaplaşması: iki tarafın da açık onayı gerekir. */
export async function proposeCouple(groupId: string, userId: string, otherMemberId: string) {
  const me = await requireMember(groupId, userId);
  const other = await q1<Member>(`select * from members where id=$1 and group_id=$2 and status='active'`, [otherMemberId, groupId]);
  if (!other || other.id === me.id) throw notFound();
  if (!other.user_id) throw new AppError("couple_needs_account");
  const busy = await q1(`select 1 from couple_links where group_id=$1 and status in ('pending','accepted') and (member_a in ($2,$3) or member_b in ($2,$3))`, [groupId, me.id, other.id]);
  if (busy) throw new AppError("couple_exists");
  await q(`insert into couple_links (group_id, member_a, member_b) values ($1,$2,$3)`, [groupId, me.id, other.id]);
  await audit(pool, { groupId, userId, memberId: me.id, type: "couple.proposed", data: { with: other.id } });
  await notify(null, { userId: other.user_id, groupId, type: "couple_proposed", category: "group_activity", data: { by: me.display_name } });
}
export async function respondCouple(groupId: string, userId: string, linkId: string, action: "accept" | "decline" | "end") {
  const me = await requireMember(groupId, userId);
  const link = await q1(`select * from couple_links where id=$1 and group_id=$2`, [linkId, groupId]);
  if (!link) throw notFound();
  if (action === "accept") {
    if (link.member_b !== me.id || link.status !== "pending") throw forbidden();
    await q(`update couple_links set status='accepted' where id=$1`, [linkId]);
  } else {
    if (link.member_a !== me.id && link.member_b !== me.id) throw forbidden();
    await q(`update couple_links set status='ended' where id=$1`, [linkId]);
  }
  await audit(pool, { groupId, userId, memberId: me.id, type: `couple.${action}`, entityId: linkId });
}
export async function listCouples(groupId: string) {
  return q<{ id: string; member_a: string; member_b: string; status: string }>(
    `select id, member_a, member_b, status from couple_links where group_id=$1 and status in ('pending','accepted')`, [groupId]);
}
