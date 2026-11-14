import "server-only";
import { q, q1, pool, type Db } from "./db";
import { AppError, forbidden } from "./errors";
import { requireMember } from "./groups";
import { computeGroupBalances } from "./ledger";
import { notify } from "./notify";
import { track } from "./analytics";
import { audit } from "./audit";
import { todayTR, addDays } from "./recurring";

/** Aynı kişiye aynı borç için en fazla 3 günde bir hatırlatma. */
const MIN_GAP_DAYS = 3;

type Skip = "reminder_too_soon" | "reminder_paused_dispute" | "reminder_paused_pending" | "reminder_paused_date" | "reminder_no_account" | "reminder_opted_out";

/** Hatırlatma göndermeden önce durdurma koşulları: itiraz, bekleyen ödeme, kabul edilmiş tarih, sıklık sınırı. */
async function skipReason(db: Db, groupId: string, debtor: string, creditor: string, currency: string, today: string): Promise<Skip | null> {
  const d = await q1(`select user_id from members where id=$1`, [debtor], db);
  if (!d?.user_id) return "reminder_no_account";
  const pref = await q1(`select reminders from notification_prefs where user_id=$1`, [d.user_id], db);
  if (pref && pref.reminders === false) return "reminder_opted_out";
  if (await q1(
    `select 1 from expense_comments c join expenses e on e.id=c.expense_id
     where e.group_id=$1 and c.member_id=$2 and c.kind='correction_request' and c.status='open' and e.deleted_at is null limit 1`, [groupId, debtor], db)) return "reminder_paused_dispute";
  if (await q1(`select 1 from manual_payment_reports where group_id=$1 and from_member=$2 and currency=$3 and status='reported' limit 1`, [groupId, debtor, currency], db)) return "reminder_paused_pending";
  if (await q1(
    `select 1 from payment_attempts a join payment_requests r on r.id=a.request_id where r.group_id=$1 and r.from_member=$2 and a.status in ('initiated','processing') limit 1`, [groupId, debtor], db)) return "reminder_paused_pending";
  if (await q1(
    `select 1 from payment_requests where group_id=$1 and from_member=$2 and to_member=$3 and proposal_status='accepted' and proposed_date >= $4 and status in ('pending','failed') limit 1`,
    [groupId, debtor, creditor, today], db)) return "reminder_paused_date";
  if (await q1(
    `select 1 from reminder_log where group_id=$1 and debtor_member=$2 and creditor_member=$3 and created_at > now() - make_interval(days => $4) limit 1`,
    [groupId, debtor, creditor, MIN_GAP_DAYS], db)) return "reminder_too_soon";
  return null;
}

/** Elle "nazikçe hatırlat". Yalnızca alacaklı (ya da yönetici) gönderebilir; bildirim yalnızca borçluya özeldir. */
export async function sendManualReminder(groupId: string, userId: string, debtorMemberId: string, currency: string) {
  const me = await requireMember(groupId, userId);
  const b = await computeGroupBalances(groupId);
  const unit = (id: string) => b.units[id] ?? id;
  const t = b.transfers.find((x) => x.currency === currency && x.from === unit(debtorMemberId) && (x.to === unit(me.id) || me.role === "admin"));
  if (!t) throw forbidden();
  const today = todayTR();
  const skip = await skipReason(pool, groupId, t.from, t.to, currency, today);
  if (skip) throw new AppError(skip);
  const debtor = await q1(`select user_id from members where id=$1`, [t.from]);
  const creditor = await q1(`select display_name from members where id=$1`, [t.to]);
  const g = await q1(`select name from groups where id=$1`, [groupId]);
  await q(`insert into reminder_log (group_id, debtor_member, creditor_member, kind) values ($1,$2,$3,'manual')`, [groupId, t.from, t.to]);
  await notify(null, { userId: debtor!.user_id, groupId, type: "reminder", category: "reminders", data: { amount_minor: t.amount, currency, to: creditor!.display_name, group: g!.name } });
  await audit(pool, { groupId, userId, memberId: me.id, type: "reminder.sent", data: { kind: "manual" } });
  await track("reminder_sent", { userId, groupId }, { kind: "manual" });
}

function periodKeyFor(g: { settle_schedule: string; settle_date: string | null; end_date: string | null }, today: string): string | null {
  const d = new Date(today + "T00:00:00Z");
  switch (g.settle_schedule) {
    case "weekly": return d.getUTCDay() === 1 ? `w:${today}` : null;                       // pazartesi
    case "month_end": return addDays(today, 1).slice(8, 10) === "01" ? `m:${today.slice(0, 7)}` : null;
    case "date": return g.settle_date && g.settle_date <= today && today <= addDays(g.settle_date, 2) ? `d:${g.settle_date}` : null;
    case "trip_end": return g.end_date && g.end_date < today && today <= addDays(g.end_date, 3) ? `t:${g.end_date}` : null;
    default: return null;
  }
}

/** Zamanlanmış hatırlatmalar. Her (grup, borçlu, alacaklı, dönem) için en fazla bir kez; borcu kalmayana gönderilmez. */
export async function runReminders(today = todayTR()): Promise<number> {
  const groups = await q(`select id, name, settle_schedule, settle_date, end_date from groups where archived_at is null and settle_schedule <> 'manual'`);
  let sent = 0;
  for (const g of groups) {
    const key = periodKeyFor(g as never, today);
    if (!key) continue;
    const b = await computeGroupBalances(g.id);
    for (const t of b.transfers) {
      if (await skipReason(pool, g.id, t.from, t.to, t.currency, today)) continue;
      const ins = await pool.query(
        `insert into reminder_log (group_id, debtor_member, creditor_member, kind, period_key) values ($1,$2,$3,'auto',$4) on conflict do nothing`, [g.id, t.from, t.to, key]);
      if (!ins.rowCount) continue;
      const debtor = await q1(`select user_id from members where id=$1`, [t.from]);
      const creditor = await q1(`select display_name from members where id=$1`, [t.to]);
      if (await notify(null, { userId: debtor?.user_id, groupId: g.id, type: "reminder", category: "reminders", data: { amount_minor: t.amount, currency: t.currency, to: creditor?.display_name, group: g.name } })) {
        sent++;
        await track("reminder_sent", { groupId: g.id }, { kind: "auto" });
      }
    }
  }
  return sent;
}
