import "server-only";
import { q } from "./db";
import { requireMember } from "./groups";

export type ActivityRow = { id: number; group_id: string; group_name: string; type: string; actor_name: string | null; entity_id: string | null; data: Record<string, unknown>; created_at: Date };
const FEED_TYPES = [
  "group.created", "member.joined", "member.left", "member.removed", "member.placeholder_added", "claim.approved",
  "expense.created", "expense.updated", "expense.deleted", "expense.restored", "expense.correction_requested",
  "payment_request.created", "manual_payment.reported", "manual_payment.confirmed", "manual_payment.rejected",
  "payment_attempt.succeeded", "payment_attempt.failed", "payment_attempt.reversed", "payment.reversed",
  "receipt.finalized", "receipt.reopened", "recurring.created", "recurring.stopped", "group.settings_updated",
];

export async function userActivity(userId: string, limit = 60) {
  return q<ActivityRow>(
    `select a.id, a.group_id, g.name as group_name, a.type, am.display_name as actor_name, a.entity_id, a.data, a.created_at
     from audit_events a join groups g on g.id=a.group_id
       join members me on me.group_id=a.group_id and me.user_id=$1 and me.status='active'
       left join members am on am.id=a.actor_member_id
     where a.type = any($2) order by a.id desc limit $3`, [userId, FEED_TYPES, limit]);
}
export async function groupActivity(groupId: string, userId: string, limit = 80) {
  await requireMember(groupId, userId);
  return q<ActivityRow>(
    `select a.id, a.group_id, g.name as group_name, a.type, am.display_name as actor_name, a.entity_id, a.data, a.created_at
     from audit_events a join groups g on g.id=a.group_id left join members am on am.id=a.actor_member_id
     where a.group_id=$1 and a.type = any($2) order by a.id desc limit $3`, [groupId, FEED_TYPES, limit]);
}
export async function listNotifications(userId: string, limit = 40) {
  return q<{ id: string; group_id: string | null; type: string; data: Record<string, unknown>; read_at: Date | null; created_at: Date }>(
    `select id, group_id, type, data, read_at, created_at from notifications where user_id=$1 order by created_at desc limit $2`, [userId, limit]);
}
export async function unreadCount(userId: string) {
  return (await q(`select count(*)::int n from notifications where user_id=$1 and read_at is null`, [userId]))[0].n as number;
}
export async function markAllRead(userId: string) {
  await q(`update notifications set read_at=now() where user_id=$1 and read_at is null`, [userId]);
}

/** Dönem özeti: kategori ve kişi bazında. Aylık ev özeti ve gezi özeti için. */
export async function periodSummary(groupId: string, userId: string, from: string | null, to: string | null) {
  await requireMember(groupId, userId);
  const cond = `e.group_id=$1 and e.deleted_at is null and e.status='active' and ($2::date is null or e.expense_date >= $2) and ($3::date is null or e.expense_date <= $3)`;
  const byCategory = await q<{ category: string; currency: string; total: number; n: number }>(
    `select category, currency, sum(amount_minor)::bigint as total, count(*)::int n from expenses e where ${cond} group by 1,2 order by 3 desc`, [groupId, from, to]);
  const byMember = await q<{ member_id: string; currency: string; paid: number; share: number }>(
    `select m.id as member_id, c.currency,
       coalesce((select sum(p.amount_minor) from expense_payers p join expenses e on e.id=p.expense_id where p.member_id=m.id and e.currency=c.currency and ${cond}),0)::bigint as paid,
       coalesce((select sum(a.amount_minor) from expense_allocations a join expenses e on e.id=a.expense_id where a.member_id=m.id and e.currency=c.currency and ${cond}),0)::bigint as share
     from members m cross join (select distinct currency from expenses e where ${cond}) c where m.group_id=$1 order by m.position, m.joined_at`, [groupId, from, to]);
  const byMonth = await q<{ month: string; currency: string; total: number }>(
    `select to_char(expense_date, 'YYYY-MM') as month, currency, sum(amount_minor)::bigint as total from expenses e
     where e.group_id=$1 and e.deleted_at is null and e.status='active' group by 1,2 order by 1 desc limit 24`, [groupId]);
  return {
    byCategory: byCategory.map((r) => ({ ...r, total: Number(r.total) })),
    byMember: byMember.map((r) => ({ ...r, paid: Number(r.paid), share: Number(r.share) })).filter((r) => r.paid || r.share),
    byMonth: byMonth.map((r) => ({ ...r, total: Number(r.total) })),
  };
}
