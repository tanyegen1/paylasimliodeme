/**
 * DEMO verisi. Yalnızca DEMO_MODE=true ve adı "demo" içeren ayrı bir veritabanında çalışır;
 * gerçek hesaplarla aynı veritabanına asla yazmaz. Kişiler ve tutarlar uydurmadır.
 *   DEMO_MODE=true DATABASE_URL=postgres://…/payimiz_demo npm run db:seed:demo
 */
import { loadEnv } from "./_env";
loadEnv();

void (async () => {
  const url = process.env.DATABASE_URL ?? "";
  if (process.env.DEMO_MODE !== "true" || !/demo/i.test(new URL(url).pathname)) {
    console.error("Reddedildi: DEMO_MODE=true olmalı ve veritabanı adı 'demo' içermeli (ör. payimiz_demo).");
    process.exit(1);
  }
  process.env.RATE_LIMIT_DISABLED = "true";
  const { migrate } = await import("./migrate");
  await migrate(url, true);
  const { pool } = await import("../src/server/db");
  if ((await pool.query(`select 1 from users where is_demo limit 1`)).rowCount) {
    console.log("Demo verisi zaten var. Sıfırlamak için veritabanını yeniden oluşturun.");
    return pool.end();
  }
  const auth = await import("../src/server/auth");
  const groups = await import("../src/server/groups");
  const invites = await import("../src/server/invites");
  const ex = await import("../src/server/expenses");
  const pay = await import("../src/server/payments");
  const rc = await import("../src/server/receipts");
  const rec = await import("../src/server/recurring");

  const today = rec.todayTR();
  const d = (n: number) => rec.addDays(today, -n);
  const U: Record<string, string> = {};
  for (const name of ["Tan", "Ece", "Can", "Defne", "Mert"]) {
    const u = await auth.registerUser({ name, email: `${name.toLowerCase()}@demo.invalid`, password: `demo-${name.toLowerCase()}-2026`, termsAccepted: true });
    await pool.query(`update users set is_demo=true where id=$1`, [u.id]);
    U[name] = u.id;
  }
  // Belgelerde kullanılan örnek IBAN (gerçek bir hesaba ait değildir).
  await auth.updateProfile(U.Tan, { name: "Tan", iban: "TR33 0006 1005 1978 6457 8413 26", ibanHolder: "Tan Örnek" });
  await pool.query(`insert into entitlements (user_id, plan, source) values ($1,'premium','demo')`, [U.Tan]);

  async function make(owner: string, input: Record<string, unknown>, joiners: string[]) {
    const g = await groups.createGroup(U[owner], input);
    const inv = await invites.createInvite(g.id, U[owner]);
    for (const j of joiners) await invites.joinViaInvite(U[j], inv.token);
    const ctx = await groups.getGroupContext(g.id, U[owner]);
    return { id: g.id, m: Object.fromEntries(ctx.members.map((x) => [x.display_name, x.id])) as Record<string, string> };
  }
  const eq = (title: string, category: string, amount: number, payer: string, ids: string[], date: string, extra: Record<string, unknown> = {}) =>
    ({ title, category, amount, currency: "TRY", expenseDate: date, payers: [{ memberId: payer, amount }], split: { type: "equal", memberIds: ids }, ...extra });

  // 1) Kadıköy Ev
  const ev = await make("Tan", { name: "Kadıköy Ev", type: "home", settleSchedule: "month_end" }, ["Ece", "Can"]);
  const evAll = [ev.m.Tan, ev.m.Ece, ev.m.Can];
  await rec.createRule(ev.id, U.Tan, { title: "Kira", category: "rent", amount: 3600000, payerMemberId: ev.m.Tan, frequency: "monthly", startDate: `${today.slice(0, 7)}-01` });
  await rec.createRule(ev.id, U.Tan, { title: "İnternet", category: "internet", amount: 69900, payerMemberId: ev.m.Ece, frequency: "monthly", startDate: `${today.slice(0, 7)}-05` });
  await rec.createRule(ev.id, U.Tan, { title: "Elektrik", category: "utilities", amount: null, payerMemberId: ev.m.Can, frequency: "monthly", startDate: `${today.slice(0, 7)}-01` });
  await rec.runRecurring(today, ev.id);
  await ex.createExpense(ev.id, U.Ece, eq("Market alışverişi", "groceries", 184750, ev.m.Ece, evAll, d(6)));
  await ex.createExpense(ev.id, U.Can, eq("Temizlik malzemeleri", "shopping", 42000, ev.m.Can, evAll, d(4)));
  const dogalgaz = await ex.createExpense(ev.id, U.Can, eq("Doğalgaz", "utilities", 96500, ev.m.Can, evAll, d(2)));
  await ex.addComment(ev.id, U.Ece, dogalgaz, { kind: "comment", body: "Bu ay az yakmıştık, fatura doğru mu acaba?" });
  await pay.reportManualPayment(ev.id, U.Ece, { fromMember: ev.m.Ece, toMember: ev.m.Tan, amount: 500000, currency: "TRY", note: "Kira için EFT" });

  // 2) Bodrum Hafta Sonu
  const bodrum = await make("Tan", { name: "Bodrum Hafta Sonu", type: "trip", startDate: d(12), endDate: d(9), settleSchedule: "trip_end" }, ["Ece", "Defne", "Mert"]);
  const bAll = [bodrum.m.Tan, bodrum.m.Ece, bodrum.m.Defne, bodrum.m.Mert];
  await ex.createExpense(bodrum.id, U.Tan, eq("Villa kirası", "lodging", 2400000, bodrum.m.Tan, bAll, d(12)));
  await ex.createExpense(bodrum.id, U.Defne, eq("Araç kiralama", "transport", 680000, bodrum.m.Defne, bAll, d(12)));
  await ex.createExpense(bodrum.id, U.Mert, eq("Tekne turu", "fun", 126033, bodrum.m.Mert, bAll, d(11), { fx: { originalAmount: 3000, originalCurrency: "EUR", rate: "42,0110", source: "Elle girildi (demo)", date: d(11) } }));
  await ex.createExpense(bodrum.id, U.Ece, { title: "Balık akşamı", category: "food", amount: 540000, currency: "TRY", expenseDate: d(10), payers: [{ memberId: bodrum.m.Ece, amount: 340000 }, { memberId: bodrum.m.Tan, amount: 200000 }], split: { type: "shares", parts: bAll.map((memberId, i) => ({ memberId, weight: i === 3 ? 2 : 1 })) } });
  await ex.createExpense(bodrum.id, U.Mert, { ...eq("Beach club", "fun", 12000, bodrum.m.Mert, [bodrum.m.Mert, bodrum.m.Defne], d(10)), currency: "EUR" });
  await pay.createPaymentRequest(bodrum.id, U.Tan, { fromMember: bodrum.m.Ece, toMember: bodrum.m.Tan, amount: 100000, currency: "TRY", note: "Bodrum hesabı" });

  // 3) Cuma Yemeği
  const yemek = await make("Ece", { name: "Cuma Yemeği", type: "meal", placeholders: ["Selin"] }, ["Tan", "Can"]);
  await ex.createExpense(yemek.id, U.Can, eq("Taksi", "transport", 38000, yemek.m.Can, [yemek.m.Ece, yemek.m.Tan, yemek.m.Can], d(1)));
  const rid = await rc.saveReceipt(yemek.id, U.Ece, null, {
    title: "Meyhane hesabı", payerMemberId: yemek.m.Ece, currency: "TRY", expenseDate: d(1),
    items: [{ name: "Rakı 70cl", amount: 145000 }, { name: "Meze tabağı", quantity: 2, amount: 68000 }, { name: "Levrek ızgara", quantity: 2, amount: 96000 }, { name: "Kalamar tava", amount: 42000, uncertain: true }, { name: "Künefe", quantity: 2, amount: 36000 }, { name: "Su", quantity: 3, amount: 9000 }],
    declaredTotal: 415600, discount: 20000, service: 39600, tip: 0, extrasMode: "proportional",
  });
  await rc.openReceipt(yemek.id, U.Ece, rid, false);
  const items = (await rc.getReceipt(yemek.id, U.Ece, rid)).items;
  for (const u of ["Ece", "Tan", "Can"]) await rc.setClaim(yemek.id, U[u], rid, items[0].id, true);
  await rc.setClaim(yemek.id, U.Tan, rid, items[2].id, true);
  await rc.setClaim(yemek.id, U.Ece, rid, items[2].id, true);
  await rc.setClaim(yemek.id, U.Can, rid, items[3].id, true);

  console.log("Demo verisi hazır: Kadıköy Ev, Bodrum Hafta Sonu, Cuma Yemeği. Giriş ekranındaki demo hesap düğmelerini kullanın.");
  await pool.end();
})();
