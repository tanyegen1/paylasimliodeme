"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as auth from "@/server/auth";
import * as groups from "@/server/groups";
import * as invites from "@/server/invites";
import * as expenses from "@/server/expenses";
import * as payments from "@/server/payments";
import * as receipts from "@/server/receipts";
import * as recurring from "@/server/recurring";
import { sendManualReminder } from "@/server/reminders";
import { draftExpenseFromText } from "@/server/nl";
import { suggestRate } from "@/server/fx";
import { markAllRead } from "@/server/activity";
import { signedFileUrl } from "@/server/storage";
import { getPaymentProvider, signWebhook } from "@/server/providers/payment";
import { pool } from "@/server/db";
import { env } from "@/server/env";
import { AppError } from "@/server/errors";
import { log } from "@/server/log";
import { rateLimit } from "@/server/ratelimit";
import { clientIp, endSession, getUser, safeNext, sessionToken, startSession } from "@/server/session";
import { tDyn } from "@/lib/i18n";
import { randomUUID } from "node:crypto";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string; code: string };

async function run<T>(fn: () => Promise<T>, paths: string[] = []): Promise<Result<T>> {
  try {
    const data = await fn();
    for (const p of paths) revalidatePath(p, "layout");
    return { ok: true, data };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, code: e.code, error: tDyn(`errors.${e.code}`, tDyn("errors.generic", "Bir şeyler ters gitti.")) };
    if ((e as { digest?: string })?.digest?.startsWith("NEXT_")) throw e;
    log.error("action_failed", e);
    return { ok: false, code: "generic", error: tDyn("errors.generic", "Bir şeyler ters gitti.") };
  }
}
async function uid(): Promise<string> {
  const u = await getUser();
  if (!u) throw new AppError("auth_required", 401);
  return u.id;
}
const g = (id: string) => [`/groups/${id}`, "/", "/groups", "/activity"];

// ---------- Kimlik ----------
export async function startGuestAction(input: { name: string; terms: boolean }) {
  return run(async () => {
    rateLimit(`signup:${await clientIp()}`, 10, 3600);
    const u = await auth.createGuestUser({ name: input.name, termsAccepted: input.terms });
    await startSession(u.id);
  });
}
export async function registerAction(input: { name: string; email: string; password: string; terms: boolean; marketing: boolean }) {
  return run(async () => {
    rateLimit(`signup:${await clientIp()}`, 10, 3600);
    const u = await auth.registerUser({ ...input, termsAccepted: input.terms });
    await startSession(u.id);
  });
}
export async function loginAction(input: { email: string; password: string }) {
  return run(async () => {
    rateLimit(`login:${await clientIp()}`, 10, 600);
    rateLimit(`login:${String(input.email).toLowerCase()}`, 8, 600);
    const u = await auth.login(input);
    await startSession(u.id);
  });
}
export async function demoLoginAction(userId: string) {
  return run(async () => {
    if (!env.demoMode) throw new AppError("forbidden", 403);
    const u = await pool.query(`select id from users where id=$1 and is_demo and deleted_at is null`, [userId]);
    if (!u.rowCount) throw new AppError("forbidden", 403);
    await startSession(userId);
  });
}
export async function logoutAction() {
  await endSession();
  redirect("/");
}
export async function secureAccountAction(input: { email: string; password: string }) {
  return run(async () => auth.secureAccount(await uid(), input), ["/"]);
}
export async function updateProfileAction(input: { name: string; iban: string; ibanHolder: string; marketing: boolean }) {
  return run(async () => auth.updateProfile(await uid(), input), ["/"]);
}
export async function setPrefsAction(p: auth.Prefs) {
  return run(async () => auth.setPrefs(await uid(), p), ["/profile"]);
}
export async function changePasswordAction(input: { current: string; next: string }) {
  return run(async () => {
    const id = await uid();
    await auth.changePassword(id, input.current, input.next);
    await startSession(id);
  });
}
export async function signOutOthersAction() {
  return run(async () => auth.destroyOtherSessions(await uid(), await sessionToken()));
}
export async function deleteAccountAction(confirm: string) {
  const r = await run(async () => {
    if (confirm.trim().toLocaleUpperCase("tr") !== "SİL") throw new AppError("confirm_required");
    await auth.deleteAccount(await uid());
    await endSession();
  });
  if (r.ok) redirect("/");
  return r;
}
export async function markReadAction() {
  return run(async () => markAllRead(await uid()), ["/activity"]);
}

// ---------- Grup, üye, davet ----------
export async function createGroupAction(input: unknown) {
  return run(async () => {
    const id = await uid();
    const group = await groups.createGroup(id, input);
    const inv = await invites.createInvite(group.id, id);
    return { id: group.id, inviteUrl: inv.url };
  }, ["/", "/groups"]);
}
export async function updateGroupSettingsAction(groupId: string, input: unknown) {
  return run(async () => groups.updateGroupSettings(groupId, await uid(), input), g(groupId));
}
export async function setArchivedAction(groupId: string, archived: boolean) {
  return run(async () => groups.setArchived(groupId, await uid(), archived), g(groupId));
}
export async function addPlaceholderAction(groupId: string, name: string) {
  return run(async () => { await groups.addPlaceholder(groupId, await uid(), name); }, g(groupId));
}
export async function updateMemberAction(groupId: string, memberId: string, input: unknown) {
  return run(async () => groups.updateMember(groupId, await uid(), memberId, input), g(groupId));
}
export async function removeMemberAction(groupId: string, memberId: string) {
  return run(async () => groups.removeMember(groupId, await uid(), memberId), g(groupId));
}
export async function createInviteAction(groupId: string, targetMemberId?: string | null) {
  return run(async () => {
    const inv = await invites.createInvite(groupId, await uid(), { targetMemberId });
    return { url: inv.url, expiresAt: inv.expiresAt.toISOString(), targetName: inv.targetName };
  }, g(groupId));
}
export async function revokeInviteAction(groupId: string, inviteId: string) {
  return run(async () => invites.revokeInvite(groupId, await uid(), inviteId), g(groupId));
}
export async function inviteSharedAction(groupId: string, via: string) {
  return run(async () => invites.trackInviteShared(groupId, await uid(), via));
}
/** Davetle katılım. Oturum yoksa yalnızca isimle misafir hesap açılır (uygulama indirmek gerekmez). */
export async function joinAction(token: string, input: { name?: string; terms?: boolean; claimMemberId?: string | null }) {
  return run(async () => {
    rateLimit(`join:${await clientIp()}`, 20, 600);
    let user = await getUser();
    if (!user) {
      const pre = await invites.previewInvite(token);
      if (pre.state !== "ok") throw new AppError(`invite_${pre.state}`, 410);
      user = await auth.createGuestUser({ name: input.name ?? "", termsAccepted: !!input.terms });
      await startSession(user.id);
    }
    return invites.joinViaInvite(user.id, token, { claimMemberId: input.claimMemberId });
  }, ["/", "/groups"]);
}
export async function cancelClaimAction(groupId: string) {
  return run(async () => invites.cancelClaim(await uid(), groupId));
}
export async function decideClaimAction(groupId: string, claimId: string, approve: boolean) {
  return run(async () => invites.decideClaim(groupId, await uid(), claimId, approve), g(groupId));
}
export async function proposeCoupleAction(groupId: string, otherMemberId: string) {
  return run(async () => groups.proposeCouple(groupId, await uid(), otherMemberId), g(groupId));
}
export async function respondCoupleAction(groupId: string, linkId: string, action: "accept" | "decline" | "end") {
  return run(async () => groups.respondCouple(groupId, await uid(), linkId, action), g(groupId));
}

// ---------- Harcama ----------
export async function saveExpenseAction(groupId: string, expenseId: string | null, input: unknown, version?: number) {
  return run(async () => {
    const id = await uid();
    if (expenseId) {
      await expenses.updateExpense(groupId, id, expenseId, input, version);
      return { id: expenseId };
    }
    return { id: await expenses.createExpense(groupId, id, input) };
  }, g(groupId));
}
export async function deleteExpenseAction(groupId: string, expenseId: string) {
  return run(async () => expenses.deleteExpense(groupId, await uid(), expenseId), g(groupId));
}
export async function restoreExpenseAction(groupId: string, expenseId: string) {
  return run(async () => expenses.restoreExpense(groupId, await uid(), expenseId), g(groupId));
}
export async function addCommentAction(groupId: string, expenseId: string, input: { kind: string; body: string }) {
  return run(async () => expenses.addComment(groupId, await uid(), expenseId, input), g(groupId));
}
export async function resolveCommentAction(groupId: string, commentId: string) {
  return run(async () => expenses.resolveComment(groupId, await uid(), commentId), g(groupId));
}
export async function includeMemberAction(groupId: string, memberId: string, expenseIds: string[]) {
  return run(async () => expenses.includeMemberInExpenses(groupId, await uid(), memberId, expenseIds), g(groupId));
}
export async function suggestRateAction(from: string, to: string) {
  return run(async () => { await uid(); return suggestRate(from, to); });
}
export async function prorationAction(groupId: string, from: string, to: string) {
  return run(async () => {
    const ctx = await groups.getGroupContext(groupId, await uid());
    return recurring.prorationWeights(ctx.members.filter((m) => m.status === "active"), from, to);
  });
}
export async function draftFromTextAction(groupId: string, text: string) {
  return run(async () => draftExpenseFromText(groupId, await uid(), text));
}
export async function fileUrlAction(groupId: string, attachmentId: string) {
  return run(async () => signedFileUrl(groupId, await uid(), attachmentId));
}

// ---------- Fiş ----------
export async function scanReceiptAction(groupId: string, attachmentId: string) {
  return run(async () => receipts.scanReceipt(groupId, await uid(), attachmentId));
}
export async function saveReceiptAction(groupId: string, receiptId: string | null, input: unknown) {
  return run(async () => ({ id: await receipts.saveReceipt(groupId, await uid(), receiptId, input) }), g(groupId));
}
export async function openReceiptAction(groupId: string, receiptId: string, ack: boolean) {
  return run(async () => receipts.openReceipt(groupId, await uid(), receiptId, ack), g(groupId));
}
export async function receiptToDraftAction(groupId: string, receiptId: string) {
  return run(async () => receipts.backToDraft(groupId, await uid(), receiptId), g(groupId));
}
export async function setClaimAction(groupId: string, receiptId: string, itemId: string, on: boolean, forMemberId?: string | null) {
  return run(async () => receipts.setClaim(groupId, await uid(), receiptId, itemId, on, forMemberId), [`/groups/${groupId}/receipts/${receiptId}`]);
}
export async function finalizeReceiptAction(groupId: string, receiptId: string, unclaimed: "block" | "split_all") {
  return run(async () => ({ expenseId: await receipts.finalizeReceipt(groupId, await uid(), receiptId, unclaimed) }), g(groupId));
}
export async function reopenReceiptAction(groupId: string, receiptId: string) {
  return run(async () => receipts.reopenReceipt(groupId, await uid(), receiptId), g(groupId));
}
export async function deleteReceiptAction(groupId: string, receiptId: string) {
  return run(async () => receipts.deleteReceipt(groupId, await uid(), receiptId), g(groupId));
}

// ---------- Tekrarlayan ----------
export async function createRuleAction(groupId: string, input: unknown) {
  return run(async () => {
    const id = await uid();
    await recurring.createRule(groupId, id, input);
    await recurring.runRecurring(undefined, groupId);
  }, g(groupId));
}
export async function updateRuleAction(groupId: string, ruleId: string, input: unknown) {
  return run(async () => recurring.updateRule(groupId, await uid(), ruleId, input), g(groupId));
}
export async function deleteRuleAction(groupId: string, ruleId: string) {
  return run(async () => recurring.deleteRule(groupId, await uid(), ruleId), g(groupId));
}

// ---------- Ödeme ----------
export async function createRequestAction(groupId: string, input: unknown) {
  return run(async () => payments.createPaymentRequest(groupId, await uid(), input), g(groupId));
}
export async function activateRequestAction(groupId: string, requestId: string) {
  return run(async () => payments.activatePaymentRequest(groupId, await uid(), requestId), g(groupId));
}
export async function cancelRequestAction(groupId: string, requestId: string) {
  return run(async () => payments.cancelPaymentRequest(groupId, await uid(), requestId), g(groupId));
}
export async function requestLinkAction(groupId: string, requestId: string) {
  return run(async () => payments.getRequestLink(groupId, await uid(), requestId));
}
export async function reportPaymentAction(groupId: string, input: unknown) {
  return run(async () => payments.reportManualPayment(groupId, await uid(), input), g(groupId));
}
export async function decideReportAction(groupId: string, reportId: string, approve: boolean) {
  return run(async () => { await payments.decideManualReport(groupId, await uid(), reportId, approve); }, g(groupId));
}
export async function reversePaymentAction(groupId: string, paymentId: string) {
  return run(async () => payments.reverseManualPayment(groupId, await uid(), paymentId, ""), g(groupId));
}
export async function proposeDateAction(groupId: string, requestId: string, date: string) {
  return run(async () => payments.proposePaymentDate(groupId, await uid(), requestId, date), g(groupId));
}
export async function respondDateAction(groupId: string, requestId: string, accept: boolean) {
  return run(async () => payments.respondPaymentDate(groupId, await uid(), requestId, accept), g(groupId));
}
export async function remindAction(groupId: string, debtorMemberId: string, currency: string) {
  return run(async () => sendManualReminder(groupId, await uid(), debtorMemberId, currency), g(groupId));
}

// Ödeme bağlantısı: oturum gerekmez; belirteç yalnızca o talebe yetki verir. Sıkı istek sınırı uygulanır.
export async function revealIbanAction(token: string) {
  return run(async () => {
    rateLimit(`iban:${await clientIp()}`, 10, 600);
    return payments.revealIbanByToken(token);
  });
}
export async function reportViaLinkAction(token: string, input: { amount: number; note?: string }) {
  return run(async () => {
    rateLimit(`payrep:${await clientIp()}`, 10, 600);
    const u = await getUser();
    await payments.reportViaPayLink(token, input, u?.id ?? null);
  }, [`/pay/${token}`]);
}
export async function proposeDateViaLinkAction(token: string, date: string) {
  return run(async () => {
    rateLimit(`paydate:${await clientIp()}`, 10, 600);
    await payments.proposeDateViaPayLink(token, date);
  }, [`/pay/${token}`]);
}
export async function startPaymentAction(token: string, input: { amount: number; idempotencyKey: string }) {
  return run(async () => {
    rateLimit(`paystart:${await clientIp()}`, 10, 600);
    const u = await getUser();
    return payments.startProviderPayment(token, input, u?.id ?? null);
  }, [`/pay/${token}`]);
}

/**
 * DEMO simülatörü: "sağlayıcı" rolünü oynar. Kararı kendi tablosuna yazar ve uygulamanın
 * webhook uç noktasına İMZALI istek gönderir; uygulama tarafı gerçek entegrasyondakiyle aynı yoldan işler.
 */
export async function sandboxDecideAction(ref: string, outcome: "succeeded" | "failed" | "reversed") {
  return run(async () => {
    const provider = getPaymentProvider();
    if (!provider || provider.id !== "sandbox") throw new AppError("provider_unavailable");
    rateLimit(`sbx:${await clientIp()}`, 30, 600);
    const cur = await pool.query(`select * from sandbox_payments where ref=$1`, [ref]);
    const row = cur.rows[0];
    if (!row) throw new AppError("not_found", 404);
    const allowed = (row.status === "initiated" && outcome !== "reversed") || (row.status === "succeeded" && outcome === "reversed");
    if (!allowed) throw new AppError("invalid_input");
    await pool.query(`update sandbox_payments set status=$2, updated_at=now() where ref=$1`, [ref, outcome]);
    const body = JSON.stringify({ id: randomUUID(), type: `payment.${outcome}`, ref, amount_minor: row.amount_minor, occurred_at: new Date().toISOString() });
    let delivered = false;
    try {
      const res = await fetch(`${env.appUrl}/api/webhooks/payments`, {
        method: "POST", body, headers: { "content-type": "application/json", "x-payimiz-signature": signWebhook(body, env.paymentWebhookSecret) }, signal: AbortSignal.timeout(5000),
      });
      delivered = res.ok;
    } catch { /* webhook ulaşmadıysa ödeme sayfası sunucudan durum sorgular */ }
    return { delivered };
  });
}
export async function settleLinkAction(groupId: string, input: unknown) {
  return run(async () => payments.getOrCreateRequest(groupId, await uid(), input), g(groupId));
}
