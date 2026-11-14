import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { q, q1, tx, type Db, pool } from "./db";
import { AppError, forbidden, notFound } from "./errors";
import { parse } from "./auth";
import { requireMember, type Member } from "./groups";
import { computeGroupBalances } from "./ledger";
import { audit } from "./audit";
import { track } from "./analytics";
import { notify } from "./notify";
import { hashToken, hmac } from "./tokens";
import { env } from "./env";
import { getPaymentProvider, type ProviderEvent } from "./providers/payment";
import { CURRENCY_CODES, MAX_MINOR } from "@/lib/money";

const REQUEST_DAYS = 14;
export type RequestStatus = "draft" | "pending" | "processing" | "verified" | "failed" | "cancelled" | "expired";
export type PaymentRequest = {
  id: string; group_id: string; from_member: string; to_member: string; amount_minor: number; currency: string; status: RequestStatus;
  note: string | null; expires_at: Date; proposed_date: string | null; proposal_status: string | null; created_at: Date; link_nonce: string; created_by: string | null;
};

const linkToken = (r: { id: string; link_nonce: string }) => hmac(`pay:${r.id}:${r.link_nonce}`);
export const payUrl = (r: { id: string; link_nonce: string }) => `${env.appUrl}/pay/${linkToken(r)}`;

async function unitNet(db: Db, groupId: string, memberId: string, currency: string) {
  const b = await computeGroupBalances(groupId, db);
  const unit = b.units[memberId] ?? memberId;
  let net = 0;
  for (const [m, v] of Object.entries(b.nets[currency] ?? {})) if ((b.units[m] ?? m) === unit) net += v;
  return net;
}

/** Borçlunun, süren girişimler ve onay bekleyen beyanlar düşüldükten sonra ödeyebileceği en fazla tutar. */
async function availableToPay(db: Db, groupId: string, fromMember: string, currency: string, excludeAttemptId?: string) {
  const debt = Math.max(0, -(await unitNet(db, groupId, fromMember, currency)));
  const open = await q1(
    `select coalesce(sum(a.amount_minor),0)::bigint as s from payment_attempts a join payment_requests r on r.id=a.request_id
     where r.group_id=$1 and r.from_member=$2 and r.currency=$3 and a.status in ('initiated','processing') and ($4::uuid is null or a.id<>$4)`,
    [groupId, fromMember, currency, excludeAttemptId ?? null], db);
  const reported = await q1(
    `select coalesce(sum(amount_minor),0)::bigint as s from manual_payment_reports where group_id=$1 and from_member=$2 and currency=$3 and status='reported'`,
    [groupId, fromMember, currency], db);
  return Math.max(0, debt - Number(open!.s) - Number(reported!.s));
}

async function paidFor(db: Db, requestId: string) {
  const r = await q1(`select coalesce(sum(amount_minor),0)::bigint as s from payments where request_id=$1 and reversed_at is null`, [requestId], db);
  return Number(r!.s);
}

/** Talep durumunu defterden yeniden türetir. İptal ve süresi dolmuş talepler değişmez. */
async function recomputeRequest(db: Db, requestId: string) {
  const r = await q1<PaymentRequest>(`select * from payment_requests where id=$1 for update`, [requestId], db);
  if (!r || r.status === "cancelled" || r.status === "draft") return;
  const paid = await paidFor(db, requestId);
  let status: RequestStatus;
  if (paid >= r.amount_minor) status = "verified";
  else if (await q1(`select 1 from payment_attempts where request_id=$1 and status in ('initiated','processing')`, [requestId], db)) status = "processing";
  else if (r.status === "expired" || new Date(r.expires_at) <= new Date()) status = "expired";
  else {
    const last = await q1(`select status from payment_attempts where request_id=$1 order by created_at desc limit 1`, [requestId], db);
    status = last && ["failed", "cancelled"].includes(last.status) && paid === 0 ? "failed" : "pending";
  }
  if (status !== r.status) await db.query(`update payment_requests set status=$2, updated_at=now() where id=$1`, [requestId, status]);
}

async function checkSettled(db: Db, groupId: string) {
  const b = await computeGroupBalances(groupId, db);
  const has = await q1(`select 1 from expenses where group_id=$1 and deleted_at is null and status='active' limit 1`, [groupId], db);
  const zero = Object.values(b.nets).every((m) => Object.values(m).every((v) => v === 0));
  if (has && zero) {
    const r = await db.query(`update groups set settled_at=now() where id=$1 and settled_at is null`, [groupId]);
    return !!r.rowCount;
  }
  return false;
}

export async function expireRequests(db: Db = pool) {
  await db.query(
    `update payment_requests r set status='expired', updated_at=now() where status in ('pending','failed','draft') and expires_at <= now()
       and not exists (select 1 from payment_attempts a where a.request_id=r.id and a.status in ('initiated','processing'))`);
}

const requestSchema = z.object({
  fromMember: z.string().uuid(), toMember: z.string().uuid(),
  amount: z.number().int().positive().max(MAX_MINOR),
  currency: z.enum(CURRENCY_CODES as [string, ...string[]]),
  note: z.string().trim().max(200).optional().nullable(),
  draft: z.boolean().optional(),
});

/** Ödeme talebi (plan). Borcu değiştirmez; yalnızca kesinleşen ödemeler bakiyeyi değiştirir. */
export async function createPaymentRequest(groupId: string, userId: string, raw: unknown) {
  const me = await requireMember(groupId, userId);
  const input = parse(requestSchema, raw);
  if (input.fromMember === input.toMember) throw new AppError("invalid_input");
  const req = await tx(async (db) => {
    const ms = await q<Member>(`select * from members where group_id=$1 and id = any($2)`, [groupId, [input.fromMember, input.toMember]], db);
    if (ms.length !== 2) throw new AppError("member_not_in_group");
    const b = await computeGroupBalances(groupId, db);
    const unitOf = (id: string) => b.units[id] ?? id;
    const mine = [input.fromMember, input.toMember].some((id) => unitOf(id) === unitOf(me.id));
    if (!mine && me.role !== "admin") throw forbidden();
    const debt = -(await unitNet(db, groupId, input.fromMember, input.currency));
    const credit = await unitNet(db, groupId, input.toMember, input.currency);
    if (input.amount > Math.min(debt, credit)) throw new AppError("amount_exceeds_debt");
    const dup = await q1(
      `select id from payment_requests where group_id=$1 and from_member=$2 and to_member=$3 and currency=$4 and status in ('pending','processing','failed') and expires_at > now()`,
      [groupId, input.fromMember, input.toMember, input.currency], db);
    if (dup) throw new AppError("request_exists");
    const id = randomUUID();
    const nonce = randomUUID().replace(/-/g, "");
    const r = await q1<PaymentRequest>(
      `insert into payment_requests (id, group_id, from_member, to_member, amount_minor, currency, status, token_hash, link_nonce, note, expires_at, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() + make_interval(days => $11), $12) returning *`,
      [id, groupId, input.fromMember, input.toMember, input.amount, input.currency, input.draft ? "draft" : "pending",
        hashToken(linkToken({ id, link_nonce: nonce })), nonce, input.note || null, REQUEST_DAYS, me.id], db);
    await audit(db, { groupId, userId, memberId: me.id, type: "payment_request.created", entityType: "payment_request", entityId: id, data: { amount_minor: input.amount, currency: input.currency, draft: !!input.draft } });
    if (!input.draft) {
      const debtor = ms.find((m) => m.id === input.fromMember)!;
      if (debtor.id !== me.id) await notify(db, { userId: debtor.user_id, groupId, type: "payment_requested", category: "payment_updates", data: { requestId: id, amount_minor: input.amount, currency: input.currency, by: me.display_name } });
    }
    return r!;
  });
  if (!input.draft) await track("payment_request_created", { userId, groupId }, { amount_minor: input.amount, currency: input.currency });
  return { id: req.id, url: payUrl(req) };
}

async function loadRequestFor(db: Db, groupId: string, userId: string, requestId: string, lock = false) {
  const me = await requireMember(groupId, userId, db);
  const r = await q1<PaymentRequest>(`select * from payment_requests where id=$1 and group_id=$2 ${lock ? "for update" : ""}`, [requestId, groupId], db);
  if (!r) throw notFound();
  const from = await q1<Member>(`select * from members where id=$1`, [r.from_member], db);
  const to = await q1<Member>(`select * from members where id=$1`, [r.to_member], db);
  const isCreditor = to!.user_id === userId || (!to!.user_id && me.role === "admin");
  const isDebtor = from!.user_id === userId || (!from!.user_id && me.role === "admin");
  return { me, r, from: from!, to: to!, isCreditor, isDebtor };
}

export async function activatePaymentRequest(groupId: string, userId: string, requestId: string) {
  await tx(async (db) => {
    const { me, r, isCreditor, isDebtor, from } = await loadRequestFor(db, groupId, userId, requestId, true);
    if (!isCreditor && !isDebtor && me.role !== "admin") throw forbidden();
    if (r.status !== "draft") return;
    await db.query(`update payment_requests set status='pending', expires_at = now() + make_interval(days => $2), updated_at=now() where id=$1`, [requestId, REQUEST_DAYS]);
    if (from.id !== me.id) await notify(db, { userId: from.user_id, groupId, type: "payment_requested", category: "payment_updates", data: { requestId, amount_minor: r.amount_minor, currency: r.currency, by: me.display_name } });
    await audit(db, { groupId, userId, memberId: me.id, type: "payment_request.activated", entityId: requestId });
  });
  await track("payment_request_created", { userId, groupId }, {});
}

export async function cancelPaymentRequest(groupId: string, userId: string, requestId: string) {
  await tx(async (db) => {
    const { me, r, isCreditor } = await loadRequestFor(db, groupId, userId, requestId, true);
    if (!isCreditor && me.role !== "admin" && r.created_by !== me.id) throw forbidden();
    if (await q1(`select 1 from payment_attempts where request_id=$1 and status in ('initiated','processing')`, [requestId], db)) throw new AppError("payment_in_progress");
    if (["verified", "cancelled"].includes(r.status)) return;
    await db.query(`update payment_requests set status='cancelled', updated_at=now() where id=$1`, [requestId]);
    await audit(db, { groupId, userId, memberId: me.id, type: "payment_request.cancelled", entityId: requestId });
  });
}

/** Yetkili üyeye (alacaklı, borçlu, yönetici) ödeme bağlantısını yeniden verir. */
export async function getRequestLink(groupId: string, userId: string, requestId: string) {
  const { me, r, isCreditor, isDebtor } = await loadRequestFor(pool, groupId, userId, requestId);
  if (!isCreditor && !isDebtor && me.role !== "admin") throw forbidden();
  return payUrl(r);
}

export async function listPaymentActivity(groupId: string, userId: string) {
  await requireMember(groupId, userId);
  await expireRequests();
  const requests = await q<PaymentRequest & { paid_minor: number; attempt_status: string | null }>(
    `select r.*, coalesce((select sum(amount_minor) from payments p where p.request_id=r.id and p.reversed_at is null),0)::bigint as paid_minor,
       (select status from payment_attempts a where a.request_id=r.id order by created_at desc limit 1) as attempt_status
     from payment_requests r where r.group_id=$1 order by r.created_at desc limit 100`, [groupId]);
  const reports = await q<{ id: string; request_id: string | null; from_member: string; to_member: string; amount_minor: number; currency: string; status: string; note: string | null; attachment_id: string | null; reported_via: string; created_at: Date; decided_at: Date | null }>(
    `select id, request_id, from_member, to_member, amount_minor, currency, status, note, attachment_id, reported_via, created_at, decided_at
     from manual_payment_reports where group_id=$1 order by created_at desc limit 100`, [groupId]);
  const payments = await q<{ id: string; from_member: string; to_member: string; amount_minor: number; currency: string; source: string; reversed_at: Date | null; reversal_reason: string | null; created_at: Date; request_id: string | null }>(
    `select id, from_member, to_member, amount_minor, currency, source, reversed_at, reversal_reason, created_at, request_id from payments where group_id=$1 order by created_at desc limit 200`, [groupId]);
  return { requests: requests.map((r) => ({ ...r, paid_minor: Number(r.paid_minor) })), reports, payments };
}

// ---------- Manuel ödeme: beyan → alıcı onayı → deftere kayıt ----------

const reportSchema = z.object({
  fromMember: z.string().uuid(), toMember: z.string().uuid(),
  amount: z.number().int().positive().max(MAX_MINOR),
  currency: z.enum(CURRENCY_CODES as [string, ...string[]]),
  requestId: z.string().uuid().optional().nullable(),
  note: z.string().trim().max(200).optional().nullable(),
  attachmentId: z.string().uuid().optional().nullable(),
});

async function insertReport(db: Db, groupId: string, input: z.infer<typeof reportSchema>, by: { userId: string | null; via: "app" | "pay_link" }) {
  if (input.requestId) {
    const r = await q1<PaymentRequest>(`select * from payment_requests where id=$1 and group_id=$2 for update`, [input.requestId, groupId], db);
    if (!r || r.from_member !== input.fromMember || r.to_member !== input.toMember || r.currency !== input.currency) throw notFound();
    if (!["pending", "failed"].includes(r.status)) throw new AppError(r.status === "processing" ? "payment_in_progress" : "request_not_payable");
    const pendingForReq = await q1(`select coalesce(sum(amount_minor),0)::bigint s from manual_payment_reports where request_id=$1 and status='reported'`, [r.id], db);
    const remaining = r.amount_minor - (await paidFor(db, r.id)) - Number(pendingForReq!.s);
    if (input.amount > remaining) throw new AppError("amount_exceeds_debt");
  }
  const row = await q1(
    `insert into manual_payment_reports (group_id, request_id, from_member, to_member, amount_minor, currency, note, attachment_id, reported_by_user, reported_via)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [groupId, input.requestId ?? null, input.fromMember, input.toMember, input.amount, input.currency, input.note || null, input.attachmentId ?? null, by.userId, by.via], db);
  await audit(db, { groupId, userId: by.userId, type: "manual_payment.reported", entityType: "manual_report", entityId: row!.id, data: { amount_minor: input.amount, currency: input.currency, via: by.via } });
  return row!.id as string;
}

async function confirmReportTx(db: Db, groupId: string, reportId: string, deciderMemberId: string, userId: string | null) {
  const rep = await q1(`select * from manual_payment_reports where id=$1 and group_id=$2 for update`, [reportId, groupId], db);
  if (!rep) throw notFound();
  if (rep.status !== "reported") return false; // zaten karara bağlanmış: ikinci kez işlenmez
  await db.query(`update manual_payment_reports set status='confirmed', decided_by=$2, decided_at=now() where id=$1`, [reportId, deciderMemberId]);
  await db.query(
    `insert into payments (group_id, from_member, to_member, amount_minor, currency, source, report_id, request_id)
     values ($1,$2,$3,$4,$5,'manual',$6,$7) on conflict (report_id) do nothing`,
    [groupId, rep.from_member, rep.to_member, rep.amount_minor, rep.currency, reportId, rep.request_id]);
  if (rep.request_id) await recomputeRequest(db, rep.request_id);
  await audit(db, { groupId, userId, memberId: deciderMemberId, type: "manual_payment.confirmed", entityType: "manual_report", entityId: reportId, data: { amount_minor: rep.amount_minor, currency: rep.currency } });
  const from = await q1(`select user_id from members where id=$1`, [rep.from_member], db);
  if (from?.user_id !== userId) await notify(db, { userId: from?.user_id, groupId, type: "payment_confirmed", category: "payment_updates", data: { amount_minor: rep.amount_minor, currency: rep.currency } });
  return true;
}

/**
 * "Ödeme yaptım" bildirimi. Alıcı onaylayana kadar bakiye DEĞİŞMEZ.
 * Bildirimi alıcının kendisi (veya geçici alıcı adına yönetici) giriyorsa aynı anda onaylanmış sayılır.
 */
export async function reportManualPayment(groupId: string, userId: string, raw: unknown) {
  const me = await requireMember(groupId, userId);
  const input = parse(reportSchema, raw);
  if (input.fromMember === input.toMember) throw new AppError("invalid_input");
  const out = await tx(async (db) => {
    const ms = await q<Member>(`select * from members where group_id=$1 and id = any($2)`, [groupId, [input.fromMember, input.toMember]], db);
    const from = ms.find((m) => m.id === input.fromMember);
    const to = ms.find((m) => m.id === input.toMember);
    if (!from || !to) throw new AppError("member_not_in_group");
    const actsForFrom = from.user_id === userId || (!from.user_id && me.role === "admin");
    const actsForTo = to.user_id === userId || (!to.user_id && me.role === "admin");
    if (!actsForFrom && !actsForTo) throw forbidden();
    if (input.attachmentId && !(await q1(`select 1 from attachments where id=$1 and group_id=$2`, [input.attachmentId, groupId], db))) throw notFound();
    const id = await insertReport(db, groupId, input, { userId, via: "app" });
    let confirmed = false;
    if (actsForTo) confirmed = await confirmReportTx(db, groupId, id, me.id, userId);
    else await notify(db, { userId: to.user_id, groupId, type: "payment_reported", category: "payment_updates", data: { reportId: id, amount_minor: input.amount, currency: input.currency, by: from.display_name } });
    const settled = confirmed ? await checkSettled(db, groupId) : false;
    return { id, confirmed, settled };
  });
  await track("manual_payment_reported", { userId, groupId }, { amount_minor: input.amount, currency: input.currency, via: "app" });
  if (out.confirmed) await track("manual_payment_confirmed", { userId, groupId }, { amount_minor: input.amount, currency: input.currency });
  if (out.settled) await track("group_settled", { userId, groupId }, {});
  return out;
}

export async function decideManualReport(groupId: string, userId: string, reportId: string, approve: boolean) {
  const me = await requireMember(groupId, userId);
  const out = await tx(async (db) => {
    const rep = await q1(`select * from manual_payment_reports where id=$1 and group_id=$2 for update`, [reportId, groupId], db);
    if (!rep) throw notFound();
    const to = await q1<Member>(`select * from members where id=$1`, [rep.to_member], db);
    // Yalnızca alıcı onaylar; alıcı geçici üyeyse (hesabı yoksa) yönetici onun adına onaylar.
    if (!(to!.user_id === userId || (!to!.user_id && me.role === "admin"))) throw forbidden();
    if (rep.status !== "reported") return { changed: false, settled: false, amount: 0, currency: rep.currency };
    if (approve) {
      await confirmReportTx(db, groupId, reportId, me.id, userId);
      return { changed: true, settled: await checkSettled(db, groupId), amount: rep.amount_minor as number, currency: rep.currency as string };
    }
    await db.query(`update manual_payment_reports set status='rejected', decided_by=$2, decided_at=now() where id=$1`, [reportId, me.id]);
    await audit(db, { groupId, userId, memberId: me.id, type: "manual_payment.rejected", entityType: "manual_report", entityId: reportId });
    const from = await q1(`select user_id from members where id=$1`, [rep.from_member], db);
    await notify(db, { userId: from?.user_id, groupId, type: "payment_report_rejected", category: "payment_updates", data: { amount_minor: rep.amount_minor, currency: rep.currency } });
    return { changed: true, settled: false, amount: 0, currency: rep.currency };
  });
  if (approve && out.changed) await track("manual_payment_confirmed", { userId, groupId }, { amount_minor: out.amount, currency: out.currency });
  if (out.settled) await track("group_settled", { userId, groupId }, {});
  return out;
}

/** Onaylanmış manuel ödemeyi geri alma (yanlış onay). Alıcı veya yönetici; kayıt silinmez, ters kayıt olarak işaretlenir. */
export async function reverseManualPayment(groupId: string, userId: string, paymentId: string, reason: string) {
  const me = await requireMember(groupId, userId);
  await tx(async (db) => {
    const p = await q1(`select * from payments where id=$1 and group_id=$2 and source='manual' for update`, [paymentId, groupId], db);
    if (!p) throw notFound();
    const to = await q1<Member>(`select * from members where id=$1`, [p.to_member], db);
    if (to!.user_id !== userId && me.role !== "admin") throw forbidden();
    if (p.reversed_at) return;
    await db.query(`update payments set reversed_at=now(), reversal_reason=$2 where id=$1`, [paymentId, reason.trim().slice(0, 200) || null]);
    if (p.request_id) await recomputeRequest(db, p.request_id);
    await db.query(`update groups set settled_at=null where id=$1`, [groupId]);
    await audit(db, { groupId, userId, memberId: me.id, type: "payment.reversed", entityType: "payment", entityId: paymentId, data: { amount_minor: p.amount_minor, currency: p.currency, source: "manual" } });
    const from = await q1(`select user_id from members where id=$1`, [p.from_member], db);
    await notify(db, { userId: from?.user_id, groupId, type: "payment_reversed", category: "payment_updates", data: { amount_minor: p.amount_minor, currency: p.currency } });
  });
}

// ---------- Ödeme tarihi önerisi: borç koşullarını değiştirmez ----------

export async function proposePaymentDate(groupId: string, userId: string, requestId: string, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < new Date().toISOString().slice(0, 10)) throw new AppError("date_invalid");
  const { r, isDebtor, to, from } = await loadRequestFor(pool, groupId, userId, requestId);
  if (!isDebtor) throw forbidden();
  if (!["pending", "failed"].includes(r.status)) throw new AppError("request_not_payable");
  await q(`update payment_requests set proposed_date=$2, proposal_status='pending', updated_at=now() where id=$1`, [requestId, date]);
  await audit(pool, { groupId, userId, type: "payment_request.date_proposed", entityId: requestId, data: { date } });
  await notify(null, { userId: to.user_id, groupId, type: "date_proposed", category: "payment_updates", data: { requestId, date, by: from.display_name } });
}
export async function respondPaymentDate(groupId: string, userId: string, requestId: string, accept: boolean) {
  const { r, isCreditor, from } = await loadRequestFor(pool, groupId, userId, requestId);
  if (!isCreditor) throw forbidden();
  if (r.proposal_status !== "pending") return;
  await q(`update payment_requests set proposal_status=$2, updated_at=now() where id=$1`, [requestId, accept ? "accepted" : "declined"]);
  await audit(pool, { groupId, userId, type: accept ? "payment_request.date_accepted" : "payment_request.date_declined", entityId: requestId });
  await notify(null, { userId: from.user_id, groupId, type: accept ? "date_accepted" : "date_declined", category: "payment_updates", data: { requestId, date: r.proposed_date } });
}

// ---------- Kişiye özel ödeme bağlantısı (üyelik yetkisi vermez) ----------

async function requestByToken(db: Db, token: string, lock = false) {
  if (!/^[0-9a-f]{64}$/.test(token ?? "")) return null;
  return q1<PaymentRequest>(`select * from payment_requests where token_hash=$1 ${lock ? "for update" : ""}`, [hashToken(token)], db);
}

/** Bağlantı sahibine yalnızca bu talebe ait bilgiler gösterilir. IBAN ayrı adımda açılır. */
export async function getPayLink(token: string) {
  await expireRequests();
  const r = await requestByToken(pool, token);
  if (!r || r.status === "draft" || r.status === "cancelled") return null;
  const g = await q1(`select name, type from groups where id=$1`, [r.group_id]);
  const from = await q1(`select display_name, user_id from members where id=$1`, [r.from_member]);
  const to = await q1(`select m.display_name, (u.iban is not null) as has_iban from members m left join users u on u.id=m.user_id where m.id=$1`, [r.to_member]);
  const paid = await paidFor(pool, r.id);
  const reported = await q1(`select coalesce(sum(amount_minor),0)::bigint s from manual_payment_reports where request_id=$1 and status='reported'`, [r.id]);
  const expenses = await q<{ title: string; expense_date: string; share: number; currency: string }>(
    `select e.title, e.expense_date, a.amount_minor as share, e.currency from expense_allocations a join expenses e on e.id=a.expense_id
     where a.member_id=$1 and e.group_id=$2 and e.currency=$3 and e.deleted_at is null and e.status='active' and a.amount_minor>0
     order by e.expense_date desc, e.created_at desc limit 8`, [r.from_member, r.group_id, r.currency]);
  const provider = getPaymentProvider();
  const attempt = await q1(`select id, status, provider_ref from payment_attempts where request_id=$1 order by created_at desc limit 1`, [r.id]);
  return {
    id: r.id, groupId: r.group_id, groupName: g!.name as string, fromName: from!.display_name as string, fromUserId: from!.user_id as string | null,
    toName: to!.display_name as string, hasIban: !!to!.has_iban, amount: r.amount_minor, paid, reported: Number(reported!.s),
    remaining: Math.max(0, r.amount_minor - paid), currency: r.currency, status: r.status, note: r.note, expiresAt: r.expires_at,
    proposedDate: r.proposed_date, proposalStatus: r.proposal_status, expenses,
    provider: provider ? { id: provider.id, isDemo: provider.isDemo, methods: provider.methods, fee: provider.quoteFee(Math.max(0, r.amount_minor - paid), r.currency) } : null,
    attemptStatus: (attempt?.status ?? null) as string | null,
  };
}

/** IBAN yalnızca ödenebilir durumdaki talepte, açık istekle gösterilir ve kayda geçer. */
export async function revealIbanByToken(token: string) {
  const r = await requestByToken(pool, token);
  if (!r || !["pending", "failed"].includes(r.status)) throw new AppError("request_not_payable");
  const to = await q1(`select u.iban, u.iban_holder from members m join users u on u.id=m.user_id where m.id=$1`, [r.to_member]);
  if (!to?.iban) throw new AppError("iban_missing");
  await audit(pool, { groupId: r.group_id, type: "iban.revealed", entityType: "payment_request", entityId: r.id, data: { via: "pay_link" } });
  return { iban: to.iban as string, holder: (to.iban_holder ?? "") as string };
}

export async function reportViaPayLink(token: string, raw: unknown, userId: string | null) {
  const input = parse(z.object({ amount: z.number().int().positive().max(MAX_MINOR), note: z.string().trim().max(200).optional().nullable() }), raw);
  const out = await tx(async (db) => {
    const r = await requestByToken(db, token, true);
    if (!r) throw notFound();
    if (new Date(r.expires_at) <= new Date()) throw new AppError("request_not_payable");
    const id = await insertReport(db, r.group_id, { fromMember: r.from_member, toMember: r.to_member, amount: input.amount, currency: r.currency, requestId: r.id, note: input.note }, { userId, via: "pay_link" });
    const to = await q1(`select user_id from members where id=$1`, [r.to_member], db);
    const from = await q1(`select display_name from members where id=$1`, [r.from_member], db);
    await notify(db, { userId: to?.user_id, groupId: r.group_id, type: "payment_reported", category: "payment_updates", data: { reportId: id, amount_minor: input.amount, currency: r.currency, by: from?.display_name } });
    return { id, groupId: r.group_id, currency: r.currency };
  });
  await track("manual_payment_reported", { userId, groupId: out.groupId }, { amount_minor: input.amount, currency: out.currency, via: "pay_link" });
  return out;
}

export async function proposeDateViaPayLink(token: string, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < new Date().toISOString().slice(0, 10)) throw new AppError("date_invalid");
  const r = await requestByToken(pool, token);
  if (!r || !["pending", "failed"].includes(r.status)) throw new AppError("request_not_payable");
  await q(`update payment_requests set proposed_date=$2, proposal_status='pending', updated_at=now() where id=$1`, [r.id, date]);
  const to = await q1(`select user_id from members where id=$1`, [r.to_member]);
  const from = await q1(`select display_name from members where id=$1`, [r.from_member]);
  await audit(pool, { groupId: r.group_id, type: "payment_request.date_proposed", entityId: r.id, data: { date, via: "pay_link" } });
  await notify(null, { userId: to?.user_id, groupId: r.group_id, type: "date_proposed", category: "payment_updates", data: { requestId: r.id, date, by: from?.display_name } });
}

// ---------- Sağlayıcı ile ödeme ----------

/**
 * Sağlayıcı ödemesi başlatır. Aynı idempotency anahtarı aynı girişimi döndürür.
 * Talep başına tek açık girişim (veritabanı kısıtı) ve borçlunun kalan borcu sınırı ile fazla tahsilat engellenir.
 */
export async function startProviderPayment(token: string, raw: unknown, userId: string | null) {
  const provider = getPaymentProvider();
  if (!provider) throw new AppError("provider_unavailable");
  const input = parse(z.object({ amount: z.number().int().positive().max(MAX_MINOR), idempotencyKey: z.string().min(16).max(80).regex(/^[\w-]+$/) }), raw);
  const res = await tx(async (db) => {
    const r = await requestByToken(db, token, true);
    if (!r) throw notFound();
    const prev = await q1(`select id, provider_ref, request_id, status, redirect_url from payment_attempts where idempotency_key=$1`, [input.idempotencyKey], db);
    if (prev) {
      if (prev.request_id !== r.id) throw new AppError("invalid_input");
      return { attemptId: prev.id as string, redirectUrl: (prev.redirect_url ?? `${env.appUrl}/pay/${token}`) as string, groupId: r.group_id, fresh: false, currency: r.currency };
    }
    if (new Date(r.expires_at) <= new Date() || !["pending", "failed"].includes(r.status)) throw new AppError(r.status === "processing" ? "payment_in_progress" : "request_not_payable");
    const pendingForReq = await q1(`select coalesce(sum(amount_minor),0)::bigint s from manual_payment_reports where request_id=$1 and status='reported'`, [r.id], db);
    const remaining = r.amount_minor - (await paidFor(db, r.id)) - Number(pendingForReq!.s);
    const avail = await availableToPay(db, r.group_id, r.from_member, r.currency);
    if (input.amount > Math.min(remaining, avail)) throw new AppError("amount_exceeds_debt");
    const attemptId = randomUUID();
    const created = await provider.createPayment({ amountMinor: input.amount, currency: r.currency, idempotencyKey: input.idempotencyKey, returnUrl: `${env.appUrl}/pay/${token}` });
    try {
      await db.query(
        `insert into payment_attempts (id, request_id, provider, provider_ref, amount_minor, fee_minor, idempotency_key, redirect_url) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [attemptId, r.id, provider.id, created.providerRef, input.amount, provider.quoteFee(input.amount, r.currency), input.idempotencyKey, created.redirectUrl]);
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new AppError("payment_in_progress");
      throw e;
    }
    await db.query(`update payment_requests set status='processing', updated_at=now() where id=$1`, [r.id]);
    await audit(db, { groupId: r.group_id, userId, type: "payment_attempt.started", entityType: "payment_attempt", entityId: attemptId, data: { amount_minor: input.amount, currency: r.currency, provider: provider.id } });
    return { attemptId, redirectUrl: created.redirectUrl, groupId: r.group_id, fresh: true, currency: r.currency };
  });
  if (res.fresh) await track("payment_started", { userId, groupId: res.groupId }, { amount_minor: input.amount, currency: res.currency, provider: provider.id });
  return { attemptId: res.attemptId, redirectUrl: res.redirectUrl };
}

const RANK: Record<string, number> = { initiated: 0, processing: 1, succeeded: 2, failed: 2, cancelled: 2, reversed: 3 };

/**
 * Doğrulanmış sağlayıcı olayını işler. Güvenlik özellikleri:
 *  - Aynı olay kimliği ikinci kez gelirse hiçbir şey yapılmaz (webhook_events birincil anahtarı).
 *  - Sırası bozuk olaylar durum makinesiyle ayıklanır; kesinleşmiş durum geriye dönmez.
 *  - Bir girişim deftere en fazla bir kez yazılır (payments.attempt_id tekil).
 */
export async function applyProviderEvent(providerId: string, evt: ProviderEvent): Promise<"applied" | "duplicate" | "ignored" | "unknown"> {
  const out = await tx(async (db) => {
    const ins = await db.query(`insert into webhook_events (provider, event_id) values ($1,$2) on conflict do nothing`, [providerId, evt.eventId]);
    if (!ins.rowCount) return { result: "duplicate" as const };
    const a = await q1(`select * from payment_attempts where provider=$1 and provider_ref=$2 for update`, [providerId, evt.providerRef], db);
    if (!a) return { result: "unknown" as const };
    const r = (await q1<PaymentRequest>(`select * from payment_requests where id=$1 for update`, [a.request_id], db))!;
    const cur = a.status as string;
    const next = evt.status;
    const allowed = (cur === "succeeded" && next === "reversed") || (RANK[cur] < 2 && RANK[next] > RANK[cur]);
    if (!allowed) return { result: "ignored" as const };
    if (next === "succeeded" && evt.amountMinor !== a.amount_minor) {
      // Tutar uyuşmuyor: otomatik işlenmez, elle inceleme için kayda alınır.
      await audit(db, { groupId: r.group_id, type: "payment_attempt.amount_mismatch", entityType: "payment_attempt", entityId: a.id, data: { expected: a.amount_minor, got: evt.amountMinor } });
      return { result: "ignored" as const };
    }
    await db.query(`update payment_attempts set status=$2, last_event_at=$3, updated_at=now() where id=$1`, [a.id, next, evt.occurredAt]);
    const from = await q1(`select user_id from members where id=$1`, [r.from_member], db);
    const to = await q1(`select user_id from members where id=$1`, [r.to_member], db);
    const data = { amount_minor: a.amount_minor, currency: r.currency };
    let settled = false;
    if (next === "succeeded") {
      await db.query(
        `insert into payments (group_id, from_member, to_member, amount_minor, currency, source, attempt_id, request_id)
         values ($1,$2,$3,$4,$5,'provider',$6,$7) on conflict (attempt_id) do nothing`, [r.group_id, r.from_member, r.to_member, a.amount_minor, r.currency, a.id, r.id]);
      for (const u of [from?.user_id, to?.user_id]) await notify(db, { userId: u, groupId: r.group_id, type: "payment_verified", category: "payment_updates", data });
    } else if (next === "reversed" && cur === "succeeded") {
      await db.query(`update payments set reversed_at=now(), reversal_reason='provider_reversal' where attempt_id=$1 and reversed_at is null`, [a.id]);
      await db.query(`update groups set settled_at=null where id=$1`, [r.group_id]);
      for (const u of [from?.user_id, to?.user_id]) await notify(db, { userId: u, groupId: r.group_id, type: "payment_reversed", category: "payment_updates", data });
    } else if (next === "failed" || next === "cancelled") {
      await notify(db, { userId: from?.user_id, groupId: r.group_id, type: "payment_failed", category: "payment_updates", data });
    }
    await recomputeRequest(db, r.id);
    if (next === "succeeded") settled = await checkSettled(db, r.group_id);
    await audit(db, { groupId: r.group_id, type: `payment_attempt.${next}`, entityType: "payment_attempt", entityId: a.id, data: { ...data, provider: providerId } });
    return { result: "applied" as const, groupId: r.group_id, next, data, settled };
  });
  if (out.result === "applied") {
    if (out.next === "succeeded") await track("payment_verified", { groupId: out.groupId }, { ...out.data, provider: providerId });
    if (out.next === "failed" || out.next === "cancelled") await track("payment_failed", { groupId: out.groupId }, { ...out.data, provider: providerId, reason: out.next });
    if (out.settled) await track("group_settled", { groupId: out.groupId }, {});
  }
  return out.result;
}

/** Webhook gelmediyse sağlayıcıdan durumu sunucu tarafında sorgular (tarayıcı dönüşüne güvenilmez). */
export async function syncAttemptStatus(attemptId: string) {
  const provider = getPaymentProvider();
  const a = await q1(`select * from payment_attempts where id=$1`, [attemptId]);
  if (!provider || !a || a.provider !== provider.id || RANK[a.status] >= 2) return;
  const s = await provider.fetchStatus(a.provider_ref);
  if (!s || s.status === "initiated" || s.status === a.status) return;
  await applyProviderEvent(provider.id, { eventId: `poll:${a.id}:${s.status}`, providerRef: a.provider_ref, status: s.status, amountMinor: a.amount_minor, occurredAt: s.occurredAt });
}
export async function syncOpenAttemptsForToken(token: string) {
  const r = await requestByToken(pool, token);
  if (!r) return;
  for (const a of await q(`select id from payment_attempts where request_id=$1 and status in ('initiated','processing')`, [r.id])) await syncAttemptStatus(a.id);
}

/** Webhook girişi: önce imza doğrulanır, sonra olay işlenir. İmzasız/bozuk istek hiçbir şeyi değiştirmez. */
export async function handlePaymentWebhook(rawBody: string, signature: string | null) {
  const provider = getPaymentProvider();
  if (!provider) return { status: 404 as const, result: "no_provider" };
  const evt = provider.verifyWebhook(rawBody, signature);
  if (!evt) return { status: 401 as const, result: "bad_signature" };
  return { status: 200 as const, result: await applyProviderEvent(provider.id, evt) };
}

/** "Ödeş" / "Ödeme iste": bu iki kişi arasında açık talep varsa onun bağlantısını, yoksa yeni talebi döndürür. */
export async function getOrCreateRequest(groupId: string, userId: string, raw: unknown) {
  const input = parse(requestSchema, raw);
  await requireMember(groupId, userId);
  await expireRequests();
  const open = await q1<PaymentRequest>(
    `select * from payment_requests where group_id=$1 and from_member=$2 and to_member=$3 and currency=$4 and status in ('pending','processing','failed') and expires_at > now()`,
    [groupId, input.fromMember, input.toMember, input.currency]);
  if (open) return { id: open.id, url: await getRequestLink(groupId, userId, open.id), amount: open.amount_minor - (await paidFor(pool, open.id)), existing: true };
  const created = await createPaymentRequest(groupId, userId, input);
  return { ...created, amount: input.amount, existing: false };
}
