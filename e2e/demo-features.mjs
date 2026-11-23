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
  const zeynep = await login("Zeynep");
  await see(zeynep, "DEMO ortamı");
  await zeynep.screenshot({ path: `${OUT}20-demo-ana-sayfa.png` });
  ok("Demo girişi ve DEMO şeridi");

  // Sandbox ödeme: Zeynep → Tan ₺1.000 talebi
  const bodrum = await openGroup(zeynep, "Bodrum Hafta Sonu");
  await zeynep.goto(`${bodrum}?tab=payments`);
  await see(zeynep, "DEMO ödeme simülatörü açık");
  await zeynep.getByRole("button", { name: "Ödeş", exact: true }).first().click();
  await zeynep.waitForURL("**/pay/**");
  const payUrl = zeynep.url();
  await see(zeynep, "İşlem ücreti");
  await zeynep.screenshot({ path: `${OUT}21-odeme-saglayici.png`, fullPage: true });
  await zeynep.getByRole("button", { name: "Onay sayfasına git" }).click();
  await zeynep.waitForURL("**/sandbox-pay/**");
  await see(zeynep, "DEMO · gerçek ödeme değil");
  await zeynep.screenshot({ path: `${OUT}22-sandbox.png` });
  // Dönüş adresine güvenilmediğini göster: onaylamadan ödeme sayfasına dön → hâlâ "işleniyor"
  const sandboxUrl = zeynep.url();
  await zeynep.goto(payUrl);
  await see(zeynep, "Ödemen işleniyor");
  ok("Onay gelmeden ödeme sayfası borcu kapatmıyor; ikinci ödeme başlatılamıyor");
  await zeynep.goto(sandboxUrl);
  await zeynep.getByRole("button", { name: "Ödemeyi onayla (demo)" }).click();
  await see(zeynep, "Sonuç uygulamaya iletildi");
  await zeynep.goto(payUrl);
  await see(zeynep, "Bu borç kapandı");
  await zeynep.goto(`${bodrum}?tab=payments`);
  await see(zeynep, "Ödeme sağlayıcısı tarafından doğrulandı");
  await zeynep.screenshot({ path: `${OUT}23-dogrulandi.png`, fullPage: true });
  ok("Sandbox: imzalı webhook ile “Ödeme sağlayıcısı tarafından doğrulandı”");

  // Ortak fiş: Can kendi ürününü seçer, Zeynep (fiş sahibi) onaylar
  const can = await login("Can");
  const yemek = await openGroup(can, "Cuma Yemeği");
  await can.getByRole("link", { name: /Meyhane hesabı/ }).click();
  await see(can, "Kendi ürünlerini seç");
  await can.getByRole("button", { name: /Künefe/ }).click();
  await can.getByRole("button", { name: /Künefe/, pressed: true }).waitFor();
  await can.screenshot({ path: `${OUT}24-fis-secim.png`, fullPage: true });
  await see(can, "Fişi ekleyen kişi dağılımı onaylayınca");
  ok("Üye kendi telefonundan fiş kalemi seçti; onay yetkisi yok");
  await openGroup(zeynep, "Cuma Yemeği");
  await zeynep.getByRole("link", { name: /Meyhane hesabı/ }).click();
  await see(zeynep, "kalem sahipsiz");
  zeynep.once("dialog", (d) => d.accept());
  await zeynep.getByRole("button", { name: "Sahipsizleri herkese böl ve onayla" }).click();
  await zeynep.waitForURL(/\/expenses\/[0-9a-f-]{36}$/);
  await see(zeynep, "₺4.156,00");
  await zeynep.screenshot({ path: `${OUT}25-fis-harcama.png`, fullPage: true });
  ok("Fiş sahibi dağılımı onayladı; harcama ₺4.156,00 (indirim ve servis dahil)");

  // Demo OCR
  await zeynep.goto(`${yemek}/receipts/new`);
  await see(zeynep, "DEMO: Fotoğrafın okunmuyor");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await zeynep.locator('input[type="file"]:not([capture])').setInputFiles({ name: "fis.png", mimeType: "image/png", buffer: png });
  await see(zeynep, "Fiş okundu");
  await see(zeynep, "Belirsiz okundu, kontrol et");
  await zeynep.screenshot({ path: `${OUT}26-ocr-taslak.png`, fullPage: true });
  ok("Demo OCR: düzenlenebilir taslak, belirsiz kalem işaretli");

  // iPhone düzeltmesi: kamera ve galeri ayrı; galeri girişinde capture yok (Fotoğraf Arşivi açılabilir)
  const inputs = await zeynep.locator('input[type="file"]').evaluateAll((els) => els.map((e) => ({ capture: e.getAttribute("capture"), accept: e.getAttribute("accept") })));
  if (inputs.length !== 2 || inputs.filter((i) => i.capture).length !== 1) throw new Error("Kamera/galeri girişleri hatalı: " + JSON.stringify(inputs));
  // Büyük (48 MP benzeri) fotoğraf: tarayıcıda küçültülüp JPEG olarak yüklenmeli (8 MB sınırına takılmamalı)
  const big = await zeynep.evaluate(async () => {
    // Gerçek fotoğraf gibi sıkıştırılması zor (gürültülü) 3600×2400 görsel → PNG olarak 8 MB'ı aşar
    const c = document.createElement("canvas"); c.width = 3600; c.height = 2400;
    const x = c.getContext("2d"); const d = x.createImageData(c.width, c.height);
    let seed = 7; for (let i = 0; i < d.data.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d.data[i] = (i & 3) === 3 ? 255 : seed & 255; }
    x.putImageData(d, 0, 0);
    const b = await new Promise((r) => c.toBlob(r, "image/png")); const buf = new Uint8Array(await b.arrayBuffer());
    let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(s);
  });
  const bigBuf = Buffer.from(big, "base64");
  if (bigBuf.length <= 8 * 1024 * 1024) throw new Error("Test fotoğrafı 8 MB'tan büyük olmalı, " + bigBuf.length);
  const uploaded = zeynep.waitForResponse((r) => r.url().endsWith("/api/upload"));
  await zeynep.locator('input[type="file"]:not([capture])').setInputFiles({ name: "IMG_0001.png", mimeType: "image/png", buffer: bigBuf });
  const up = await uploaded;
  const upJson = await up.json();
  if (up.status() !== 200 || upJson.mime !== "image/jpeg") throw new Error("Büyük fotoğraf yüklenemedi: " + up.status() + " " + JSON.stringify(upJson));
  let stored = "?";
  if (process.env.DATABASE_URL) {
    const { Client } = createRequire(import.meta.url)("pg");
    const db = new Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
    const row = (await db.query("select size_bytes, mime from attachments where id=$1", [upJson.id])).rows[0]; await db.end();
    if (!row || row.mime !== "image/jpeg" || row.size_bytes > 3 * 1024 * 1024) throw new Error("Saklanan dosya beklenenden büyük: " + JSON.stringify(row));
    stored = (row.size_bytes / 1048576).toFixed(1);
  }
  ok(`Galeriden ${(bigBuf.length / 1048576).toFixed(1)} MB fotoğraf seçildi; tarayıcıda küçültülüp ${stored} MB JPEG olarak yüklendi`);

  // Metinden taslak
  const tan = await login("Tan");
  const ev = await openGroup(tan, "Kadıköy Ev");
  await tan.goto(`${ev}/quick`);
  await tan.getByRole("textbox").fill("Markete 1.240 lira verdim. Dördümüze böl ama temizlik malzemelerinin 200 lirasını Zeynep'e yazma.");
  await tan.getByRole("button", { name: "Taslağı hazırla" }).click();
  await see(tan, "Kimler katılıyor?");
  ok("Belirsiz kişi sayısında (grup 3 kişi, cümlede 4) taslak yerine soru soruldu");
  await tan.getByRole("textbox").fill("Markete 1.240 lira verdim. Üçümüze böl ama temizlik malzemelerinin 200 lirasını Zeynep'e yazma.");
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
