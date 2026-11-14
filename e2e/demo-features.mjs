// DEMO ortamında gelişmiş özellikler: sandbox ödeme (imzalı webhook), ortak fiş seçimi, demo OCR, metinden taslak.
// Gerekenler: DEMO_MODE=true, PAYMENT_PROVIDER=sandbox, OCR_PROVIDER=demo ve `npm run db:seed:demo`.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const OUT = new URL("./screenshots/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const ok = (m) => console.log("✓", m);
const browser = await chromium.launch();
const login = async (name) => {
  const c = await browser.newContext({ ...devices["iPhone 13"], locale: "tr-TR" }); const p = await c.newPage(); p.setDefaultTimeout(15000);
  await p.goto(`${BASE}/login`); await p.getByRole("button", { name, exact: true }).click(); await p.waitForURL(BASE + "/"); return p;
};
const see = (p, text) => p.getByText(text, { exact: false }).first().waitFor();
const openGroup = async (p, name) => { await p.goto(`${BASE}/groups`); await p.getByRole("link", { name: new RegExp(name) }).first().click(); await p.waitForURL(/\/groups\/[0-9a-f-]{36}/); return p.url().split("?")[0]; };

try {
  const ece = await login("Ece");
  await see(ece, "DEMO ortamı");
  await ece.screenshot({ path: `${OUT}20-demo-ana-sayfa.png` });
  ok("Demo girişi ve DEMO şeridi");

  // Sandbox ödeme: Ece → Tan ₺1.000 talebi
  const bodrum = await openGroup(ece, "Bodrum Hafta Sonu");
  await ece.goto(`${bodrum}?tab=payments`);
  await see(ece, "DEMO ödeme simülatörü açık");
  await ece.getByRole("button", { name: "Ödeş", exact: true }).first().click();
  await ece.waitForURL("**/pay/**");
  const payUrl = ece.url();
  await see(ece, "İşlem ücreti");
  await ece.screenshot({ path: `${OUT}21-odeme-saglayici.png`, fullPage: true });
  await ece.getByRole("button", { name: "Onay sayfasına git" }).click();
  await ece.waitForURL("**/sandbox-pay/**");
  await see(ece, "DEMO · gerçek ödeme değil");
  await ece.screenshot({ path: `${OUT}22-sandbox.png` });
  // Dönüş adresine güvenilmediğini göster: onaylamadan ödeme sayfasına dön → hâlâ "işleniyor"
  const sandboxUrl = ece.url();
  await ece.goto(payUrl);
  await see(ece, "Ödemen işleniyor");
  ok("Onay gelmeden ödeme sayfası borcu kapatmıyor; ikinci ödeme başlatılamıyor");
  await ece.goto(sandboxUrl);
  await ece.getByRole("button", { name: "Ödemeyi onayla (demo)" }).click();
  await see(ece, "Sonuç uygulamaya iletildi");
  await ece.goto(payUrl);
  await see(ece, "Bu borç kapandı");
  await ece.goto(`${bodrum}?tab=payments`);
  await see(ece, "Ödeme sağlayıcısı tarafından doğrulandı");
  await ece.screenshot({ path: `${OUT}23-dogrulandi.png`, fullPage: true });
  ok("Sandbox: imzalı webhook ile “Ödeme sağlayıcısı tarafından doğrulandı”");

  // Ortak fiş: Can kendi ürününü seçer, Ece (fiş sahibi) onaylar
  const can = await login("Can");
  const yemek = await openGroup(can, "Cuma Yemeği");
  await can.getByRole("link", { name: /Meyhane hesabı/ }).click();
  await see(can, "Kendi ürünlerini seç");
  await can.getByRole("button", { name: /Künefe/ }).click();
  await can.getByRole("button", { name: /Künefe/, pressed: true }).waitFor();
  await can.screenshot({ path: `${OUT}24-fis-secim.png`, fullPage: true });
  await see(can, "Fişi ekleyen kişi dağılımı onaylayınca");
  ok("Üye kendi telefonundan fiş kalemi seçti; onay yetkisi yok");
  await openGroup(ece, "Cuma Yemeği");
  await ece.getByRole("link", { name: /Meyhane hesabı/ }).click();
  await see(ece, "kalem sahipsiz");
  ece.once("dialog", (d) => d.accept());
  await ece.getByRole("button", { name: "Sahipsizleri herkese böl ve onayla" }).click();
  await ece.waitForURL(/\/expenses\/[0-9a-f-]{36}$/);
  await see(ece, "₺4.156,00");
  await ece.screenshot({ path: `${OUT}25-fis-harcama.png`, fullPage: true });
  ok("Fiş sahibi dağılımı onayladı; harcama ₺4.156,00 (indirim ve servis dahil)");

  // Demo OCR
  await ece.goto(`${yemek}/receipts/new`);
  await see(ece, "DEMO: Fotoğrafın okunmuyor");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await ece.locator('input[type="file"]').setInputFiles({ name: "fis.png", mimeType: "image/png", buffer: png });
  await see(ece, "Fiş okundu");
  await see(ece, "Belirsiz okundu, kontrol et");
  await ece.screenshot({ path: `${OUT}26-ocr-taslak.png`, fullPage: true });
  ok("Demo OCR: düzenlenebilir taslak, belirsiz kalem işaretli");

  // Metinden taslak
  const tan = await login("Tan");
  const ev = await openGroup(tan, "Kadıköy Ev");
  await tan.goto(`${ev}/quick`);
  await tan.getByRole("textbox").fill("Markete 1.240 lira verdim. Dördümüze böl ama temizlik malzemelerinin 200 lirasını Ece'ye yazma.");
  await tan.getByRole("button", { name: "Taslağı hazırla" }).click();
  await see(tan, "Kimler katılıyor?");
  ok("Belirsiz kişi sayısında (grup 3 kişi, cümlede 4) taslak yerine soru soruldu");
  await tan.getByRole("textbox").fill("Markete 1.240 lira verdim. Üçümüze böl ama temizlik malzemelerinin 200 lirasını Ece'ye yazma.");
  await tan.getByRole("button", { name: "Taslağı hazırla" }).click();
  await see(tan, "₺346,67");
  await see(tan, "Henüz hiçbir şey kaydedilmedi");
  await tan.screenshot({ path: `${OUT}27-metinden-taslak.png`, fullPage: true });
  await tan.getByRole("button", { name: "Onayla ve ekle" }).click();
  await tan.waitForURL(/\/expenses\/[0-9a-f-]{36}$/);
  ok("Metinden taslak: kişi başı hesap gösterildi, onaydan sonra kaydedildi");

  // Premium + rapor + CSV
  await tan.goto(`${ev}/summary`);
  await see(tan, "CSV indir");
  const csv = await tan.request.get(`${ev.replace("/groups/", "/api/export/")}`);
  if (csv.status() !== 200 || !(await csv.text()).includes("Market")) throw new Error("CSV dışa aktarım başarısız");
  const denied = await can.request.get(`${yemek.replace("/groups/", "/api/export/")}`);
  if (denied.status() !== 402) throw new Error("Premium olmayan grupta CSV açık: " + denied.status());
  await tan.screenshot({ path: `${OUT}28-aylik-ozet.png`, fullPage: true });
  ok("Premium grup: CSV dışa aktarım çalışıyor; premium olmayan grupta kapalı");
  console.log("\nDemo özellik akışı tamamlandı.");
} catch (e) {
  console.error("✗ BAŞARISIZ:", e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
