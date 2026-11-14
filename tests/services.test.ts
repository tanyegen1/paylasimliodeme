import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "@/server/db";
import { createGroup, getGroupContext, removeMember, updateGroupSettings, proposeCouple, respondCouple, updateMember } from "@/server/groups";
import { createInvite, joinViaInvite, previewInvite, revokeInvite, decideClaim, listClaims } from "@/server/invites";
import { createExpense, updateExpense, deleteExpense, restoreExpense, getExpense, listExpenses, addComment, includeMemberInExpenses } from "@/server/expenses";
import { computeGroupBalances, getGroupBalances, explainMember } from "@/server/ledger";
import {
  createPaymentRequest, reportManualPayment, decideManualReport, getPayLink, reportViaPayLink, startProviderPayment, handlePaymentWebhook,
  listPaymentActivity, payUrl, revealIbanByToken, reverseManualPayment, expireRequests, proposePaymentDate, respondPaymentDate, syncAttemptStatus,
} from "@/server/payments";
import { signWebhook } from "@/server/providers/payment";
import { saveReceipt, openReceipt, setClaim, finalizeReceipt, getReceipt, reopenReceipt } from "@/server/receipts";
import { createRule, runRecurring, updateRule } from "@/server/recurring";
import { sendManualReminder, runReminders } from "@/server/reminders";
import { draftExpenseFromText } from "@/server/nl";
import { secureAccount, deleteAccount, exportUserData, updateProfile, login, createSession, getUserBySessionToken } from "@/server/auth";
import { saveAttachment, signedFileUrl, readSignedFile } from "@/server/storage";
import { sanitizeProps } from "@/server/analytics";
import { mask } from "@/server/log";
import { groupWith, user, addEqual, equalExpense, nets, today } from "./helpers";

afterAll(() => pool.end());
const SECRET = "test-webhook-secret";
const tokenOf = (url: string) => url.split("/pay/")[1];
async function webhook(type: string, ref: string, amount: number, opts: { id?: string; at?: Date; secret?: string } = {}) {
  const body = JSON.stringify({ id: opts.id ?? randomUUID(), type: `payment.${type}`, ref, amount_minor: amount, occurred_at: (opts.at ?? new Date()).toISOString() });
  return handlePaymentWebhook(body, signWebhook(body, opts.secret ?? SECRET));
}
const refOf = async (attemptId: string) => (await pool.query(`select provider_ref from payment_attempts where id=$1`, [attemptId])).rows[0].provider_ref as string;
const sumNets = (n: Record<string, number>) => Object.values(n).reduce((a, b) => a + b, 0);

describe("harcama ve bakiye", () => {
  it("100 TL üç kişiye dağılır, bakiyeler toplamı sıfırdır", async () => {
    const { group, users, m, ids } = await groupWith(["Tan", "Ece", "Can"]);
    const id = await addEqual(group.id, users[0].id, 10000, m.Tan, ids);
    const e = await getExpense(group.id, users[0].id, id);
    expect(e.allocations.map((a) => a.amount_minor)).toEqual([3334, 3333, 3333]);
    expect(e.allocations.map((a) => a.rounding_minor)).toEqual([1, 0, 0]);
    const n = await nets(group.id);
    expect(n).toEqual({ [m.Tan]: 6666, [m.Ece]: -3333, [m.Can]: -3333 });
    expect(sumNets(n)).toBe(0);
  });

  it("birden fazla ödeyen", async () => {
    const { group, users, m, ids } = await groupWith(["Tan", "Ece", "Can"]);
    await createExpense(group.id, users[0].id, { ...equalExpense(9000, m.Tan, ids), payers: [{ memberId: m.Tan, amount: 6000 }, { memberId: m.Ece, amount: 3000 }] });
    expect(await nets(group.id)).toEqual({ [m.Tan]: 3000, [m.Ece]: 0, [m.Can]: -3000 });
    await expect(createExpense(group.id, users[0].id, { ...equalExpense(9000, m.Tan, ids), payers: [{ memberId: m.Tan, amount: 1 }] })).rejects.toThrow("payers_sum_mismatch");
  });

  it("istemcinin gönderdiği paylara güvenilmez: sunucu yeniden hesaplar", async () => {
    const { group, users, m, ids } = await groupWith(["Tan", "Ece"]);
    await expect(createExpense(group.id, users[0].id, { ...equalExpense(1000, m.Tan, ids), split: { type: "exact", parts: [{ memberId: m.Tan, amount: 1 }, { memberId: m.Ece, amount: 1 }] } })).rejects.toThrow("exact_sum_mismatch");
  });

  it("harcama değişince bakiye yeniden hesaplanır; silme geri alınabilir", async () => {
    const { group, users, m, ids } = await groupWith(["Tan", "Ece"]);
    const id = await addEqual(group.id, users[0].id, 10000, m.Tan, ids);
    expect((await nets(group.id))[m.Ece]).toBe(-5000);
    await updateExpense(group.id, users[0].id, id, equalExpense(20000, m.Tan, ids), 1);
    expect((await nets(group.id))[m.Ece]).toBe(-10000);
    await expect(updateExpense(group.id, users[0].id, id, equalExpense(1, m.Tan, ids), 1)).rejects.toThrow("stale_version");
    await deleteExpense(group.id, users[1].id, id);
    expect((await nets(group.id))[m.Ece] ?? 0).toBe(0);
    await restoreExpense(group.id, users[0].id, id);
    expect((await nets(group.id))[m.Ece]).toBe(-10000);
    const hist = (await getExpense(group.id, users[0].id, id)).history.map((h) => h.type);
    expect(hist).toEqual(expect.arrayContaining(["expense.created", "expense.updated", "expense.deleted", "expense.restored"]));
  });

  it("döviz: özgün tutar ve onaylanan kur saklanır; para birimleri ayrı tutulur", async () => {
    const { group, users, m, ids } = await groupWith(["Tan", "Ece"], { type: "trip" });
    await createExpense(group.id, users[0].id, {
      ...equalExpense(82465, m.Tan, ids), fx: { originalAmount: 1999, originalCurrency: "EUR", rate: "41,2530", source: "Elle girildi", date: today() },
    });
    await createExpense(group.id, users[0].id, { ...equalExpense(3001, m.Ece, ids), currency: "EUR" });
    const b = await computeGroupBalances(group.id);
    expect(b.currencies).toEqual(["TRY", "EUR"]);
    expect(b.nets.TRY[m.Tan]).toBe(41232);
    expect(b.nets.EUR[m.Ece]).toBe(1501); // 30,01 € ikiye: 15,01 + 15,00
    expect(sumNets(b.nets.TRY)).toBe(0);
    expect(sumNets(b.nets.EUR)).toBe(0);
    const row = (await pool.query(`select fx_rate::text, original_amount_minor from expenses where group_id=$1 and original_currency='EUR'`, [group.id])).rows[0];
    expect(row).toEqual({ fx_rate: "41.253000", original_amount_minor: 1999 });
  });

  it("sadeleştirme ayarı net bakiyeyi değiştirmez", async () => {
    const { group, users, m } = await groupWith(["Tan", "Ece", "Can"]);
    await addEqual(group.id, users[0].id, 10000, m.Ece, [m.Tan]);
    await addEqual(group.id, users[0].id, 10000, m.Can, [m.Ece]);
    const simple = await computeGroupBalances(group.id);
    expect(simple.transfers).toEqual([{ from: m.Tan, to: m.Can, amount: 10000, currency: "TRY" }]);
    await updateGroupSettings(group.id, users[0].id, { name: "Test", simplifyDebts: false, settleSchedule: "manual" });
    const raw = await computeGroupBalances(group.id);
    expect(raw.transfers).toHaveLength(2);
    expect(raw.nets).toEqual(simple.nets);
  });

  it("bakiye açıklanabilir: üyeyi oluşturan kalemler", async () => {
    const { group, users, m, ids } = await groupWith(["Tan", "Ece"]);
    await addEqual(group.id, users[0].id, 10000, m.Tan, ids);
    const x = await explainMember(group.id, users[0].id, m.Ece);
    expect(x.expenses).toHaveLength(1);
    expect(x.expenses[0]).toMatchObject({ paid: 0, share: 5000 });
  });

  it("sonradan katılan üye seçili harcamalara dahil edilir", async () => {
    const { group, users, m, ids } = await groupWith(["Tan", "Ece"], { type: "trip" });
    const id = await addEqual(group.id, users[0].id, 9000, m.Tan, ids);
    const late = await user("Can");
    await joinViaInvite(late.id, (await createInvite(group.id, users[0].id)).token);
    const can = (await getGroupContext(group.id, late.id)).me.id;
    expect(await includeMemberInExpenses(group.id, users[0].id, can, [id])).toBe(1);
    expect((await nets(group.id))[can]).toBe(-3000);
  });
});

describe("erişim, davet ve kimlik", () => {
  it("başka grubun verisine erişilemez", async () => {
    const a = await groupWith(["Tan", "Ece"]);
    const b = await groupWith(["Mert", "Su"]);
    const exp = await addEqual(a.group.id, a.users[0].id, 1000, a.m.Tan, a.ids);
    const outsider = b.users[0].id;
    await expect(getGroupContext(a.group.id, outsider)).rejects.toThrow("not_found");
    await expect(listExpenses(a.group.id, outsider)).rejects.toThrow("not_found");
    await expect(getExpense(a.group.id, outsider, exp)).rejects.toThrow("not_found");
    await expect(getGroupBalances(a.group.id, outsider)).rejects.toThrow("not_found");
    await expect(listPaymentActivity(a.group.id, outsider)).rejects.toThrow("not_found");
    await expect(deleteExpense(a.group.id, outsider, exp)).rejects.toThrow("not_found");
    // Kendi grubunun kimliğiyle başka grubun harcamasına ulaşamaz.
    await expect(getExpense(b.group.id, outsider, exp)).rejects.toThrow("not_found");
    // Başka grubun üyesini kendi harcamasına ekleyemez.
    await expect(addEqual(b.group.id, outsider, 1000, b.m.Mert, [b.m.Mert, a.m.Tan])).rejects.toThrow("member_not_in_group");
    await expect(createInvite(a.group.id, outsider)).rejects.toThrow("not_found");
  });

  it("süresi dolan, iptal edilen ve geçersiz davet", async () => {
    const { group, users } = await groupWith(["Tan"]);
    const inv = await createInvite(group.id, users[0].id);
    const guest = await user("Ece", false);
    await pool.query(`update invitations set expires_at = now() - interval '1 minute' where id=$1`, [inv.id]);
    expect((await previewInvite(inv.token)).state).toBe("expired");
    await expect(joinViaInvite(guest.id, inv.token)).rejects.toThrow("invite_expired");
    const inv2 = await createInvite(group.id, users[0].id);
    await revokeInvite(group.id, users[0].id, inv2.id);
    await expect(joinViaInvite(guest.id, inv2.token)).rejects.toThrow("invite_revoked");
    expect((await previewInvite("x".repeat(43))).state).toBe("invalid");
    await expect(getGroupContext(group.id, guest.id)).rejects.toThrow("not_found");
  });

  it("davet önizlemesi harcama, bakiye veya IBAN içermez", async () => {
    const { group, users, m, ids } = await groupWith(["Tan", "Ece"]);
    await updateProfile(users[0].id, { name: "Tan", iban: "TR33 0006 1005 1978 6457 8413 26" });
    await addEqual(group.id, users[0].id, 123456, m.Tan, ids);
    const p = JSON.stringify(await previewInvite((await createInvite(group.id, users[0].id)).token));
    expect(p).not.toContain("TR33");
    expect(p).not.toContain("123456");
    expect(p).not.toContain("61728");
  });

  it("isim seçerek başkasının kimliği devralınamaz: sahiplenme yönetici onayı ister", async () => {
    const tan = await user("Tan");
    const group = await createGroup(tan.id, { name: "Ev", type: "home", placeholders: ["Ece"] });
    const ctx = await getGroupContext(group.id, tan.id);
    const ecePh = ctx.members.find((x) => x.display_name === "Ece")!;
    await addEqual(group.id, tan.id, 10000, ctx.me.id, [ctx.me.id, ecePh.id]);
    const inv = await createInvite(group.id, tan.id);
    const impostor = await user("Sahte", false);
    const r = await joinViaInvite(impostor.id, inv.token, { claimMemberId: ecePh.id });
    expect(r.status).toBe("claim_pending");
    await expect(getGroupContext(group.id, impostor.id)).rejects.toThrow("not_found"); // onaya kadar erişim yok
    const claims = await listClaims(group.id, tan.id);
    expect(claims).toHaveLength(1);
    await decideClaim(group.id, tan.id, claims[0].id, false);
    await expect(getGroupContext(group.id, impostor.id)).rejects.toThrow("not_found");
    // Gerçek Ece: kişiye özel, tek kullanımlık davet doğrudan bağlar ve geçmiş borcu taşır.
    const personal = await createInvite(group.id, tan.id, { targetMemberId: ecePh.id });
    const ece = await user("Ece", false);
    expect((await joinViaInvite(ece.id, personal.token)).status).toBe("joined");
    const eceCtx = await getGroupContext(group.id, ece.id);
    expect(eceCtx.me.id).toBe(ecePh.id);
    expect(eceCtx.me.role).toBe("guest");
    expect((await nets(group.id))[ecePh.id]).toBe(-5000);
    await expect(joinViaInvite(impostor.id, personal.token)).rejects.toThrow("invite_used");
    // Üye olmayan yönetici olmayan kişi kişiye özel davet üretemez.
    await expect(createInvite(group.id, ece.id)).rejects.toThrow("guest_limited");
  });

  it("sınırlı misafir yönetemez; hesabını güvenceye alınca üye olur ve aynı kimlikle giriş yapar", async () => {
    const { group, users, m, ids } = await groupWith(["Tan", "Ece"]);
    const guest = await user("Can", false);
    await joinViaInvite(guest.id, (await createInvite(group.id, users[0].id)).token);
    const exp = await addEqual(group.id, users[0].id, 1000, m.Tan, ids);
    await expect(deleteExpense(group.id, guest.id, exp)).rejects.toThrow("guest_limited");
    await expect(updateGroupSettings(group.id, guest.id, { name: "x", simplifyDebts: true, settleSchedule: "manual" })).rejects.toThrow("forbidden");
    const email = `can-${Date.now()}@test.local`;
    await secureAccount(guest.id, { email, password: "guclu-parola-1" });
    expect((await getGroupContext(group.id, guest.id)).me.role).toBe("member");
    const again = await login({ email, password: "guclu-parola-1" });
    expect(again.id).toBe(guest.id);
    await expect(login({ email, password: "yanlis" })).rejects.toThrow("login_failed");
    const s = await createSession(guest.id);
    expect((await getUserBySessionToken(s.token))?.id).toBe(guest.id);
    expect(await getUserBySessionToken(s.token + "x")).toBeNull();
    expect((await pool.query(`select 1 from sessions where token_hash=$1`, [s.token])).rowCount).toBe(0); // düz belirteç saklanmaz
  });

  it("üye ayrılınca geçmiş hesaplar bozulmaz; hesap silinince kişisel veri gider, kayıtlar kalır", async () => {
    const { group, users, m, ids } = await groupWith(["Tan", "Ece", "Can"]);
    await addEqual(group.id, users[0].id, 9000, m.Tan, ids);
    const before = await nets(group.id);
    await removeMember(group.id, users[2].id, m.Can); // Can ayrılır
    expect(await nets(group.id)).toEqual(before);
    await expect(getGroupContext(group.id, users[2].id)).rejects.toThrow("not_found");
    const data = await exportUserData(users[1].id);
    expect(data.shares).toHaveLength(1);
    await deleteAccount(users[1].id);
    expect(await nets(group.id)).toEqual(before);
    const u = (await pool.query(`select display_name, email, iban, password_hash from users where id=$1`, [users[1].id])).rows[0];
    expect(u).toEqual({ display_name: "Silinmiş hesap", email: null, iban: null, password_hash: null });
    expect((await pool.query(`select display_name, user_id from members where id=$1`, [m.Ece])).rows[0]).toEqual({ display_name: "Ayrılan üye", user_id: null });
  });

  it("dosyalar: tür içerikten doğrulanır, bağlantı imzalı ve sürelidir", async () => {
    const { group, users } = await groupWith(["Tan", "Ece"]);
    const other = await groupWith(["Mert"]);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
    await expect(saveAttachment(group.id, users[0].id, "receipt", Buffer.from("<script>alert(1)</script>"))).rejects.toThrow("file_type_invalid");
    await expect(saveAttachment(group.id, users[0].id, "receipt", Buffer.alloc(9 * 1024 * 1024, 0xff))).rejects.toThrow("file_too_large");
    const a = await saveAttachment(group.id, users[0].id, "receipt", png);
    await expect(signedFileUrl(group.id, other.users[0].id, a.id)).rejects.toThrow("not_found");
    const url = new URL("http://x" + (await signedFileUrl(group.id, users[1].id, a.id)));
    const exp = Number(url.searchParams.get("exp")), sig = url.searchParams.get("sig")!;
    expect((await readSignedFile(a.id, exp, sig)).mime).toBe("image/png");
    await expect(readSignedFile(a.id, exp + 1, sig)).rejects.toThrow("not_found");
    await expect(readSignedFile(a.id, 1, sig)).rejects.toThrow("not_found");
  });

  it("analitik ve loglar kişisel veri taşımaz", () => {
    expect(sanitizeProps({ group_type: "home", title: "Market", name: "Ece", iban: "TR33", amount_minor: 5, note: "özel" })).toEqual({ group_type: "home", amount_minor: 5 });
    expect(JSON.stringify(mask({ iban: "TR330006100519786457841326", msg: "a@b.com TR33 0006 1005 1978 6457 8413 26", nested: { email: "x@y.z", amount_minor: 5 } }))).not.toMatch(/TR33|a@b|x@y|"amount_minor":5/);
  });
});

describe("manuel hesaplaşma", () => {
  it("beyan bakiyeyi değiştirmez; alıcı onayı değiştirir; ikinci onay tekrar işlenmez", async () => {
    const { group, users, m, ids } = await groupWith(["Tan", "Ece"]);
    await addEqual(group.id, users[0].id, 10000, m.Tan, ids);
    const rep = await reportManualPayment(group.id, users[1].id, { fromMember: m.Ece, toMember: m.Tan, amount: 5000, currency: "TRY" });
    expect(rep.confirmed).toBe(false);
    expect((await nets(group.id))[m.Ece]).toBe(-5000);
    await expect(decideManualReport(group.id, users[1].id, rep.id, true)).rejects.toThrow("forbidden"); // borçlu kendi beyanını onaylayamaz
    const [a, b] = await Promise.all([decideManualReport(group.id, users[0].id, rep.id, true), decideManualReport(group.id, users[0].id, rep.id, true)]);
    expect([a.changed, b.changed].filter(Boolean)).toHaveLength(1);
    expect((await nets(group.id))[m.Ece] ?? 0).toBe(0);
    expect((await pool.query(`select count(*)::int n from payments where report_id=$1`, [rep.id])).rows[0].n).toBe(1);
    expect((await pool.query(`select settled_at from groups where id=$1`, [group.id])).rows[0].settled_at).not.toBeNull();
    const events = (await pool.query(`select name from analytics_events where name in ('manual_payment_reported','manual_payment_confirmed','group_settled') and group_hash is not null order by id desc limit 3`)).rows.map((r) => r.name);
    expect(events).toEqual(expect.arrayContaining(["manual_payment_confirmed", "group_settled"]));
  });

  it("kısmi ödeme: talep açık kalır, kalan borç doğru", async () => {
    const { group, users, m, ids } = await groupWith(["Tan", "Ece"]);
    await addEqual(group.id, users[0].id, 20000, m.Tan, ids);
    const req = await createPaymentRequest(group.id, users[0].id, { fromMember: m.Ece, toMember: m.Tan, amount: 10000, currency: "TRY" });
    const token = tokenOf(req.url);
    const r1 = await reportViaPayLink(token, { amount: 4000 }, null);
    await expect(reportViaPayLink(token, { amount: 6001 }, null)).rejects.toThrow("amount_exceeds_debt"); // bekleyen beyan + yenisi borcu aşamaz
    await decideManualReport(group.id, users[0].id, r1.id, true);
    let link = (await getPayLink(token))!;
    expect(link).toMatchObject({ status: "pending", paid: 4000, remaining: 6000 });
    expect((await nets(group.id))[m.Ece]).toBe(-6000);
    const r2 = await reportViaPayLink(token, { amount: 6000 }, null);
    await decideManualReport(group.id, users[0].id, r2.id, true);
    link = (await getPayLink(token))!;
    expect(link).toMatchObject({ status: "verified", remaining: 0 });
    await expect(reportViaPayLink(token, { amount: 1 }, null)).rejects.toThrow("request_not_payable");
  });

  it("reddedilen beyan borcu kapatmaz; onaylanan ödeme geri alınabilir", async () => {
    const { group, users, m, ids } = await groupWith(["Tan", "Ece"]);
    await addEqual(group.id, users[0].id, 10000, m.Tan, ids);
    const rep = await reportManualPayment(group.id, users[1].id, { fromMember: m.Ece, toMember: m.Tan, amount: 5000, currency: "TRY" });
    await decideManualReport(group.id, users[0].id, rep.id, false);
    expect((await nets(group.id))[m.Ece]).toBe(-5000);
    const ok = await reportManualPayment(group.id, users[0].id, { fromMember: m.Ece, toMember: m.Tan, amount: 5000, currency: "TRY" }); // alıcı kendisi kaydeder
    expect(ok.confirmed).toBe(true);
    const pay = (await listPaymentActivity(group.id, users[0].id)).payments[0];
    await expect(reverseManualPayment(group.id, users[1].id, pay.id, "")).rejects.toThrow("forbidden");
    await reverseManualPayment(group.id, users[0].id, pay.id, "yanlış kayıt");
    expect((await nets(group.id))[m.Ece]).toBe(-5000);
  });

  it("ödeme bağlantısı üyelik vermez; IBAN yalnızca ödenebilir talepte açılır; talep borcu aşamaz", async () => {
    const { group, users, m, ids } = await groupWith(["Tan", "Ece"]);
    await updateProfile(users[0].id, { name: "Tan", iban: "TR33 0006 1005 1978 6457 8413 26" });
    await addEqual(group.id, users[0].id, 10000, m.Tan, ids);
    await expect(createPaymentRequest(group.id, users[0].id, { fromMember: m.Ece, toMember: m.Tan, amount: 5001, currency: "TRY" })).rejects.toThrow("amount_exceeds_debt");
    const req = await createPaymentRequest(group.id, users[0].id, { fromMember: m.Ece, toMember: m.Tan, amount: 5000, currency: "TRY" });
    const token = tokenOf(req.url);
    const link = (await getPayLink(token))!;
    expect(JSON.stringify(link)).not.toContain("TR33");
    expect(link.expenses[0]).toMatchObject({ share: 5000 });
    expect((await revealIbanByToken(token)).iban).toBe("TR330006100519786457841326");
    expect(await getPayLink("0".repeat(64))).toBeNull();
    // Belirteç davet olarak kullanılamaz.
    const stranger = await user("Yabancı", false);
    await expect(joinViaInvite(stranger.id, token)).rejects.toThrow(/invite_/);
    // Süresi dolunca IBAN açılmaz.
    await pool.query(`update payment_requests set expires_at = now() - interval '1 minute' where id=$1`, [req.id]);
    await expireRequests();
    expect((await getPayLink(token))!.status).toBe("expired");
    await expect(revealIbanByToken(token)).rejects.toThrow("request_not_payable");
    expect(payUrl({ id: req.id, link_nonce: "baska" })).not.toBe(req.url);
  });

  it("ödeme tarihi önerisi borcu değiştirmez ve karşı taraf onayı ister", async () => {
    const { group, users, m, ids } = await groupWith(["Tan", "Ece"]);
    await addEqual(group.id, users[0].id, 10000, m.Tan, ids);
    const req = await createPaymentRequest(group.id, users[0].id, { fromMember: m.Ece, toMember: m.Tan, amount: 5000, currency: "TRY" });
    const date = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    await expect(proposePaymentDate(group.id, users[0].id, req.id, date)).rejects.toThrow("forbidden");
    await proposePaymentDate(group.id, users[1].id, req.id, date);
    await expect(respondPaymentDate(group.id, users[1].id, req.id, true)).rejects.toThrow("forbidden");
    await respondPaymentDate(group.id, users[0].id, req.id, true);
    expect((await nets(group.id))[m.Ece]).toBe(-5000);
    await expect(sendManualReminder(group.id, users[0].id, m.Ece, "TRY")).rejects.toThrow("reminder_paused_date");
  });
});

describe("sağlayıcı ödemesi ve webhook", () => {
  async function setup(amount = 10000) {
    const g = await groupWith(["Tan", "Ece"]);
    await addEqual(g.group.id, g.users[0].id, amount * 2, g.m.Tan, g.ids);
    const req = await createPaymentRequest(g.group.id, g.users[0].id, { fromMember: g.m.Ece, toMember: g.m.Tan, amount, currency: "TRY" });
    return { ...g, req, token: tokenOf(req.url) };
  }
  const key = () => "idem-" + randomUUID();

  it("doğrulanan ödeme borcu kapatır; aynı webhook tekrar gelince ikinci kez işlenmez", async () => {
    const { group, m, token } = await setup();
    const a = await startProviderPayment(token, { amount: 10000, idempotencyKey: key() }, null);
    expect((await getPayLink(token))!.status).toBe("processing");
    expect((await nets(group.id))[m.Ece]).toBe(-10000); // dönüş adresi değil, doğrulama bakiyeyi değiştirir
    const ref = await refOf(a.attemptId);
    const id = randomUUID();
    const at = new Date();
    expect((await webhook("succeeded", ref, 10000, { id, at })).result).toBe("applied");
    expect((await webhook("succeeded", ref, 10000, { id, at })).result).toBe("duplicate");
    expect((await webhook("succeeded", ref, 10000)).result).toBe("ignored"); // farklı kimlikle aynı olay
    expect((await pool.query(`select count(*)::int n from payments where attempt_id=$1`, [a.attemptId])).rows[0].n).toBe(1);
    expect((await nets(group.id))[m.Ece] ?? 0).toBe(0);
    expect((await getPayLink(token))!.status).toBe("verified");
  });

  it("eşzamanlı aynı webhook yalnızca bir kez uygulanır", async () => {
    const { group, m, token } = await setup();
    const a = await startProviderPayment(token, { amount: 10000, idempotencyKey: key() }, null);
    const ref = await refOf(a.attemptId);
    const id = randomUUID();
    const at = new Date();
    const rs = await Promise.all(Array.from({ length: 6 }, () => webhook("succeeded", ref, 10000, { id, at })));
    expect(rs.filter((r) => r.result === "applied")).toHaveLength(1);
    expect((await nets(group.id))[m.Ece] ?? 0).toBe(0);
  });

  it("başarısız ödeme borcu kapatmaz ve yeniden denenebilir", async () => {
    const { group, m, token } = await setup();
    const a = await startProviderPayment(token, { amount: 10000, idempotencyKey: key() }, null);
    await webhook("failed", await refOf(a.attemptId), 10000);
    expect((await nets(group.id))[m.Ece]).toBe(-10000);
    expect((await getPayLink(token))!.status).toBe("failed");
    // Geç gelen "succeeded" kesinleşmiş başarısız girişimi değiştirmez.
    expect((await webhook("succeeded", await refOf(a.attemptId), 10000)).result).toBe("ignored");
    expect((await nets(group.id))[m.Ece]).toBe(-10000);
    const b = await startProviderPayment(token, { amount: 10000, idempotencyKey: key() }, null);
    expect(b.attemptId).not.toBe(a.attemptId);
  });

  it("süren ödeme varken ikinci ödeme başlatılamaz (fazla tahsilat engeli); idempotency aynı girişimi döndürür", async () => {
    const { group, users, m, token } = await setup();
    const k = key();
    const a = await startProviderPayment(token, { amount: 6000, idempotencyKey: k }, null);
    const again = await startProviderPayment(token, { amount: 6000, idempotencyKey: k }, null);
    expect(again.attemptId).toBe(a.attemptId);
    await expect(startProviderPayment(token, { amount: 4000, idempotencyKey: key() }, null)).rejects.toThrow("payment_in_progress");
    await expect(reportViaPayLink(token, { amount: 4000 }, null)).rejects.toThrow("payment_in_progress");
    const [x, y] = await Promise.allSettled([startProviderPayment(token, { amount: 1, idempotencyKey: key() }, null), startProviderPayment(token, { amount: 1, idempotencyKey: key() }, null)]);
    expect([x.status, y.status]).toEqual(["rejected", "rejected"]);
    expect((await pool.query(`select count(*)::int n from payment_attempts a join payment_requests r on r.id=a.request_id where r.group_id=$1`, [group.id])).rows[0].n).toBe(1);
    // Kısmi sağlayıcı ödemesi + kalan
    await webhook("succeeded", await refOf(a.attemptId), 6000);
    expect((await getPayLink(token))!).toMatchObject({ status: "pending", remaining: 4000 });
    await expect(startProviderPayment(token, { amount: 4001, idempotencyKey: key() }, null)).rejects.toThrow("amount_exceeds_debt");
    expect((await nets(group.id))[m.Ece]).toBe(-4000);
    void users;
  });

  it("sırası bozuk olaylar ve geri alınan (reversed) ödeme deftere doğru yansır", async () => {
    const { group, m, token } = await setup();
    const a = await startProviderPayment(token, { amount: 10000, idempotencyKey: key() }, null);
    const ref = await refOf(a.attemptId);
    const t0 = Date.now();
    await webhook("succeeded", ref, 10000, { at: new Date(t0 + 2000) });
    expect((await webhook("processing", ref, 10000, { at: new Date(t0 + 1000) })).result).toBe("ignored"); // geç gelen eski olay
    expect((await getPayLink(token))!.status).toBe("verified");
    await webhook("reversed", ref, 10000, { at: new Date(t0 + 3000) });
    expect((await nets(group.id))[m.Ece]).toBe(-10000);
    expect((await getPayLink(token))!.status).toBe("pending");
    expect((await pool.query(`select reversed_at is not null as r from payments where attempt_id=$1`, [a.attemptId])).rows[0].r).toBe(true);
  });

  it("imzasız, yanlış imzalı, eski tarihli veya tutarı uyuşmayan webhook hiçbir şeyi değiştirmez", async () => {
    const { group, m, token } = await setup();
    const a = await startProviderPayment(token, { amount: 10000, idempotencyKey: key() }, null);
    const ref = await refOf(a.attemptId);
    const body = JSON.stringify({ id: randomUUID(), type: "payment.succeeded", ref, amount_minor: 10000, occurred_at: new Date().toISOString() });
    expect((await handlePaymentWebhook(body, null)).status).toBe(401);
    expect((await handlePaymentWebhook(body, signWebhook(body, "yanlis"))).status).toBe(401);
    expect((await handlePaymentWebhook(body, signWebhook(body, SECRET, Math.floor(Date.now() / 1000) - 3600))).status).toBe(401);
    expect((await handlePaymentWebhook(body + " ", signWebhook(body, SECRET))).status).toBe(401);
    expect((await webhook("succeeded", ref, 1, {})).result).toBe("ignored");
    expect((await webhook("succeeded", "sbx_bilinmeyen", 10000)).result).toBe("unknown");
    expect((await nets(group.id))[m.Ece]).toBe(-10000);
  });

  it("webhook gelmezse sunucudan durum sorgusu sonucu yakalar", async () => {
    const { group, m, token } = await setup();
    const a = await startProviderPayment(token, { amount: 10000, idempotencyKey: key() }, null);
    await pool.query(`update sandbox_payments set status='succeeded', updated_at=now() where ref=$1`, [await refOf(a.attemptId)]);
    await syncAttemptStatus(a.attemptId);
    await syncAttemptStatus(a.attemptId);
    expect((await nets(group.id))[m.Ece] ?? 0).toBe(0);
    expect((await pool.query(`select count(*)::int n from payments where attempt_id=$1`, [a.attemptId])).rows[0].n).toBe(1);
  });
});

describe("fiş paylaşımı", () => {
  async function receipt() {
    const g = await groupWith(["Tan", "Ece", "Can"], { type: "meal" });
    const id = await saveReceipt(g.group.id, g.users[0].id, null, {
      title: "Cuma yemeği", payerMemberId: g.m.Tan, currency: "TRY", expenseDate: today(),
      items: [{ name: "Rakı", amount: 90000 }, { name: "Levrek", amount: 48000 }, { name: "Künefe", amount: 18000, uncertain: true }],
      declaredTotal: 160600, discount: 10000, service: 14600, tip: 0, extrasMode: "proportional",
    });
    const items = (await getReceipt(g.group.id, g.users[0].id, id)).items;
    return { ...g, id, items };
  }

  it("toplam uyuşmazlığı kullanıcı onayı olmadan geçilmez", async () => {
    const g = await groupWith(["Tan", "Ece"]);
    const id = await saveReceipt(g.group.id, g.users[0].id, null, { title: "Fiş", payerMemberId: g.m.Tan, currency: "TRY", expenseDate: today(), items: [{ name: "A", amount: 1000 }], declaredTotal: 1500 });
    await expect(openReceipt(g.group.id, g.users[0].id, id, false)).rejects.toThrow("receipt_total_mismatch");
    await openReceipt(g.group.id, g.users[0].id, id, true);
    expect((await getReceipt(g.group.id, g.users[0].id, id)).receipt).toMatchObject({ status: "open", mismatch_ack: true });
  });

  it("eşzamanlı seçimler tutarlı: aynı kalemi seçen herkes kaydolur, tekrarlar çoğalmaz", async () => {
    const { group, users, m, id, items } = await receipt();
    await openReceipt(group.id, users[0].id, id, false);
    const raki = items[0].id;
    const ops = [];
    for (let i = 0; i < 5; i++) for (const u of users) ops.push(setClaim(group.id, u.id, id, raki, true));
    ops.push(setClaim(group.id, users[1].id, id, items[1].id, true), setClaim(group.id, users[2].id, id, items[1].id, true));
    await Promise.all(ops);
    const r = await getReceipt(group.id, users[0].id, id);
    expect(r.items[0].claims.map((c) => c.memberId).sort()).toEqual([m.Tan, m.Ece, m.Can].sort());
    expect(r.items[1].claims).toHaveLength(2);
    expect(r.unclaimed).toBe(1);
    // Üye başkası adına seçemez.
    await expect(setClaim(group.id, users[1].id, id, raki, true, m.Can)).rejects.toThrow("forbidden");
    // Sahipsiz kalem varken onay engellenir.
    await expect(finalizeReceipt(group.id, users[0].id, id, "block")).rejects.toThrow("receipt_unclaimed_items");
    await expect(finalizeReceipt(group.id, users[1].id, id, "split_all")).rejects.toThrow("forbidden"); // yalnızca yetkili kişi onaylar
    const expenseId = await finalizeReceipt(group.id, users[0].id, id, "split_all");
    const e = await getExpense(group.id, users[0].id, expenseId);
    expect(e.expense.amount_minor).toBe(160600);
    expect(e.allocations.reduce((a, x) => a + x.amount_minor, 0)).toBe(160600);
    expect(Object.values(await nets(group.id)).reduce((a, b) => a + b, 0)).toBe(0);
    // Onaydan sonra seçim değişmez; değişiklik için yeniden açılır ve kayda girer.
    await expect(setClaim(group.id, users[1].id, id, raki, false)).rejects.toThrow("receipt_finalized");
    await reopenReceipt(group.id, users[0].id, id);
    expect((await nets(group.id))[m.Ece] ?? 0).toBe(0);
    const log = (await pool.query(`select type from audit_events where entity_id=$1 order by id`, [id])).rows.map((x) => x.type);
    expect(log).toEqual(expect.arrayContaining(["receipt.finalized", "receipt.reopened"]));
  });

  it("onay ile eşzamanlı gelen seçim ya sayılır ya reddedilir; yarım kalmaz", async () => {
    const { group, users, id, items } = await receipt();
    await openReceipt(group.id, users[0].id, id, false);
    for (const it of items) await setClaim(group.id, users[0].id, id, it.id, true);
    const [fin, late] = await Promise.allSettled([finalizeReceipt(group.id, users[0].id, id, "block"), setClaim(group.id, users[1].id, id, items[0].id, true)]);
    expect(fin.status).toBe("fulfilled");
    const e = await getExpense(group.id, users[0].id, (fin as PromiseFulfilledResult<string>).value);
    const claimedByEce = (await getReceipt(group.id, users[0].id, id)).items[0].claims.length === 2;
    const eceInExpense = e.allocations.length === 2;
    expect(late.status === "fulfilled" ? claimedByEce === eceInExpense : true).toBe(true);
    expect(e.allocations.reduce((a, x) => a + x.amount_minor, 0)).toBe(e.expense.amount_minor);
  });
});

describe("tekrarlayan giderler ve hatırlatmalar", () => {
  it("zamanlanmış görev aynı dönemi iki kez üretmez (eşzamanlı çalışsa bile)", async () => {
    const { group, users, m } = await groupWith(["Tan", "Ece"]);
    const rule = await createRule(group.id, users[0].id, { title: "Kira", category: "rent", amount: 2400000, payerMemberId: m.Tan, frequency: "monthly", startDate: "2026-03-01" });
    await Promise.all([runRecurring("2026-03-01", group.id), runRecurring("2026-03-01", group.id), runRecurring("2026-03-01", group.id)]);
    await runRecurring("2026-03-01", group.id);
    let list = await listExpenses(group.id, users[0].id);
    expect(list).toHaveLength(1);
    expect((await nets(group.id))[m.Ece]).toBe(-1200000);
    await runRecurring("2026-05-15", group.id); // kaçırılan dönemler birer kez üretilir
    list = await listExpenses(group.id, users[0].id);
    expect(list.map((e) => e.expense_date).sort()).toEqual(["2026-03-01", "2026-04-01", "2026-05-01"]);
    await updateRule(group.id, users[0].id, rule, { title: "Kira", amount: 2400000, payerMemberId: m.Tan, prorateByDays: false, active: false });
    await runRecurring("2026-12-01", group.id);
    expect(await listExpenses(group.id, users[0].id)).toHaveLength(3);
  });

  it("değişken fatura tutar bekleyen taslak üretir; taslak bakiyeye girmez", async () => {
    const { group, users, m, ids } = await groupWith(["Tan", "Ece"]);
    await createRule(group.id, users[0].id, { title: "Elektrik", category: "utilities", amount: null, payerMemberId: m.Tan, frequency: "monthly", startDate: "2026-03-10" });
    await runRecurring("2026-03-10", group.id);
    const [draft] = await listExpenses(group.id, users[0].id);
    expect(draft.status).toBe("draft");
    expect(await nets(group.id)).toEqual({});
    await updateExpense(group.id, users[0].id, draft.id, { ...equalExpense(84000, m.Tan, ids), title: "Elektrik", expenseDate: "2026-03-10" });
    expect((await nets(group.id))[m.Ece]).toBe(-42000);
  });

  it("gün bazlı paylaşım: ay ortasında taşınan daha az öder", async () => {
    const { group, users, m } = await groupWith(["Tan", "Ece"]);
    await updateMember(group.id, users[0].id, m.Ece, { name: "Ece", stayFrom: "2026-04-16" });
    await createRule(group.id, users[0].id, { title: "İnternet", category: "internet", amount: 90000, payerMemberId: m.Tan, frequency: "monthly", startDate: "2026-04-01", prorateByDays: true });
    await runRecurring("2026-04-01", group.id);
    // Nisan 30 gün: Tan 30 gün, Ece 15 gün → 2:1
    expect((await nets(group.id))[m.Ece]).toBe(-30000);
  });

  it("hatırlatma: sıklığı sınırlı, itirazda ve bekleyen ödemede durur, ödeme sonrası gönderilmez", async () => {
    const { group, users, m, ids } = await groupWith(["Tan", "Ece"]);
    const exp = await addEqual(group.id, users[0].id, 10000, m.Tan, ids);
    await expect(sendManualReminder(group.id, users[1].id, m.Ece, "TRY")).rejects.toThrow("forbidden"); // yalnızca alacaklı
    await sendManualReminder(group.id, users[0].id, m.Ece, "TRY");
    await expect(sendManualReminder(group.id, users[0].id, m.Ece, "TRY")).rejects.toThrow("reminder_too_soon");
    const n = (await pool.query(`select user_id, type from notifications where group_id=$1 and type='reminder'`, [group.id])).rows;
    expect(n).toEqual([{ user_id: users[1].id, type: "reminder" }]); // yalnızca borçluya özel
    await pool.query(`delete from reminder_log where group_id=$1`, [group.id]);
    await addComment(group.id, users[1].id, exp, { kind: "correction_request", body: "Tutar yanlış olabilir" });
    await expect(sendManualReminder(group.id, users[0].id, m.Ece, "TRY")).rejects.toThrow("reminder_paused_dispute");
    await pool.query(`update expense_comments set status='resolved'`);
    const rep = await reportManualPayment(group.id, users[1].id, { fromMember: m.Ece, toMember: m.Tan, amount: 5000, currency: "TRY" });
    await expect(sendManualReminder(group.id, users[0].id, m.Ece, "TRY")).rejects.toThrow("reminder_paused_pending");
    await decideManualReport(group.id, users[0].id, rep.id, true);
    await expect(sendManualReminder(group.id, users[0].id, m.Ece, "TRY")).rejects.toThrow("forbidden"); // borç kalmadı
  });

  it("zamanlanmış hatırlatma dönem başına bir kez gider", async () => {
    const { group, users, m, ids } = await groupWith(["Tan", "Ece"]);
    await updateGroupSettings(group.id, users[0].id, { name: "Ev", simplifyDebts: true, settleSchedule: "month_end" });
    await addEqual(group.id, users[0].id, 10000, m.Tan, ids);
    await runReminders("2026-04-29");
    await runReminders("2026-04-30");
    await runReminders("2026-04-30");
    expect((await pool.query(`select count(*)::int n from notifications where group_id=$1 and type='reminder'`, [group.id])).rows[0].n).toBe(1);
  });

  it("çiftler yalnızca iki tarafın onayıyla birlikte hesaplaşır", async () => {
    const { group, users, m, ids } = await groupWith(["Tan", "Ece", "Can"], { type: "trip" });
    await addEqual(group.id, users[0].id, 9000, m.Tan, ids);
    await proposeCouple(group.id, users[1].id, m.Can);
    expect((await computeGroupBalances(group.id)).transfers).toHaveLength(2);
    const link = (await pool.query(`select id from couple_links where group_id=$1`, [group.id])).rows[0].id;
    await expect(respondCouple(group.id, users[1].id, link, "accept")).rejects.toThrow("forbidden");
    await respondCouple(group.id, users[2].id, link, "accept");
    const b = await computeGroupBalances(group.id);
    expect(b.transfers).toEqual([{ from: m.Ece, to: m.Tan, amount: 6000, currency: "TRY" }]);
    expect(b.nets.TRY[m.Can]).toBe(-3000); // kişisel netler değişmez
  });
});

describe("metinden harcama taslağı", () => {
  it("örnek cümle: sunucu payları hesaplar, hiçbir şey kaydetmez", async () => {
    const { group, users, m } = await groupWith(["Tan", "Ece", "Can", "Defne"]);
    const r = await draftExpenseFromText(group.id, users[0].id, "Markete 1.240 lira verdim. Dördümüze böl ama temizlik malzemelerinin 200 lirasını Ece'ye yazma.");
    expect(r.questions).toEqual([]);
    const by = Object.fromEntries(r.shares.map((s) => [s.memberId, s.amount]));
    expect(by[m.Ece]).toBe(26000);
    expect(by[m.Tan] + by[m.Can] + by[m.Defne]).toBe(98000);
    expect(r.input!.payers).toEqual([{ memberId: m.Tan, amount: 124000 }]);
    expect(await listExpenses(group.id, users[0].id)).toHaveLength(0);
    await createExpense(group.id, users[0].id, r.input); // kullanıcı onayı sonrası aynı doğrulamadan geçer
    expect((await nets(group.id))[m.Ece]).toBe(-26000);
  });
  it("kişi sayısı grupla uyuşmazsa sorar", async () => {
    const { group, users } = await groupWith(["Tan", "Ece", "Can"]);
    const r = await draftExpenseFromText(group.id, users[0].id, "Yemeğe 900 TL verdim, ikimize böl");
    expect(r.input).toBeNull();
    expect(r.questions[0]).toContain("Kimler");
  });
});
