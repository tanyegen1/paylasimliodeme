// Mobil tarayıcıda uçtan uca: davet → katılım (yönetici onaylı sahiplenme) → harcama → ödeş → onay.
// Çalıştırma: uygulama BASE_URL adresinde açıkken `npm run test:e2e`
import { createRequire } from "node:module";
// Playwright genel kurulumdan da yüklenebilsin diye require ile alınır (npm i -D playwright ile de çalışır).
const { chromium, devices } = createRequire(import.meta.url)("playwright");
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = new URL("./screenshots/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const steps = [];
const ok = (m) => { steps.push(m); console.log("✓", m); };
const browser = await chromium.launch();
const mk = async () => { const c = await browser.newContext({ ...devices["iPhone 13"], locale: "tr-TR" }); const p = await c.newPage(); p.setDefaultTimeout(15000); return p; };
const shot = (p, n) => p.screenshot({ path: `${OUT}${n}.png` });
const expectText = async (p, text) => p.getByText(text, { exact: false }).first().waitFor();

try {
  const tan = await mk();
  await tan.goto(BASE);
  await expectText(tan, "Kolayca ödeş.");
  await shot(tan, "01-landing");
  await tan.getByRole("link", { name: /Hemen grup kur/ }).click();
  await tan.getByLabel("Adın").fill("Tan");
  await tan.getByRole("checkbox").first().check();
  await tan.getByRole("button", { name: "Başla", exact: true }).click();
  await tan.waitForURL("**/groups/new");
  ok("Kurucu yalnızca adıyla başladı");

  await tan.getByLabel("Grup adı").fill("Kadıköy Ev");
  await tan.getByPlaceholder("İsim yaz").fill("Ece");
  await tan.getByRole("button", { name: "Ekle", exact: true }).click();
  await shot(tan, "02-yeni-grup");
  await tan.getByRole("button", { name: "Grubu kur" }).click();
  await expectText(tan, "hazır");
  const shareText = await tan.locator("p", { hasText: "/join/" }).first().innerText();
  const inviteUrl = shareText.match(/https?:\/\/\S+\/join\/\S+/)[0];
  const wa = await tan.getByRole("link", { name: /WhatsApp/ }).getAttribute("href");
  if (!wa.startsWith("https://wa.me/?text=") || !decodeURIComponent(wa).includes(inviteUrl)) throw new Error("WhatsApp paylaşım bağlantısı hatalı");
  await shot(tan, "03-davet-paylas");
  ok("Grup kuruldu, WhatsApp paylaşım metni davet bağlantısını içeriyor");

  // IBAN ekle
  await tan.goto(`${BASE}/profile`);
  await tan.getByLabel(/IBAN \(/).fill("TR33 0006 1005 1978 6457 8413 26");
  await tan.getByRole("button", { name: "Kaydet", exact: true }).first().click();
  await expectText(tan, "Kaydedildi.");

  // Davetli: uygulama indirmeden, tarayıcıdan
  const ece = await mk();
  await ece.goto(inviteUrl.replace(/^https?:\/\/[^/]+/, BASE));
  await expectText(ece, "Tan seni davet ediyor");
  const preview = await ece.locator("main").innerText();
  if (/TR33|IBAN|₺/.test(preview)) throw new Error("Önizleme finansal veri sızdırıyor");
  await shot(ece, "04-davet-onizleme");
  await ece.getByLabel("Adın").fill("Ece");
  await ece.getByRole("checkbox").first().check();
  await ece.getByLabel("Evet, ben Ece").check();
  await ece.getByRole("button", { name: "Onaya gönder" }).click();
  await expectText(ece, "Yönetici onayı bekleniyor");
  await shot(ece, "05-onay-bekliyor");
  ok("Davetli güvenli önizlemeyi gördü; isim sahiplenme yönetici onayına gitti");

  // Kurucu harcama ekler (Ece henüz onaylanmadan, geçici isme)
  await tan.goto(BASE);
  await expectText(tan, "gruba katılmak için onayını bekliyor"); // ana sayfada "Senden bekleyenler"
  await tan.goto(`${BASE}/groups`);
  await tan.getByRole("link", { name: /Kadıköy Ev/ }).first().click();
  await tan.waitForURL(/\/groups\/[0-9a-f-]{36}/);
  const groupUrl = tan.url().split("?")[0];
  await tan.getByRole("link", { name: "Harcamayı ekle" }).first().click();
  await tan.getByLabel("Ne için?").fill("Market alışverişi");
  await tan.getByLabel("Tutar", { exact: true }).fill("1.240,50");
  await expectText(tan, "₺620,25");
  await shot(tan, "06-harcama-formu");
  await tan.getByRole("button", { name: "Harcamayı ekle" }).click();
  await tan.waitForURL(/\/expenses\/[0-9a-f-]{36}$/);
  await expectText(tan, "₺1.240,50");
  await shot(tan, "07-harcama-detay");
  ok("Harcama eklendi: ₺1.240,50 iki kişiye ₺620,25 + ₺620,25");

  // Kurucu sahiplenmeyi onaylar
  await tan.goto(`${groupUrl}?tab=members`);
  await expectText(tan, "olarak gruba katılmak istiyor");
  await shot(tan, "08-sahiplenme-onayi");
  await tan.getByRole("button", { name: "Evet, bu o" }).click();
  await tan.getByText("olarak gruba katılmak istiyor").waitFor({ state: "detached" });
  ok("Yönetici sahiplenmeyi onayladı");

  await ece.getByRole("button", { name: "Tekrar kontrol et" }).click();
  await ece.getByRole("link", { name: "Grubu aç" }).click();
  await expectText(ece, "Borcun");
  await expectText(ece, "₺620,25");
  await shot(ece, "09-davetli-ozet");
  ok("Davetli kendi bakiyesini görüyor: Borcun ₺620,25");

  // Bakiye açıklaması
  await ece.goto(`${ece.url().split("?")[0]}?tab=balances`);
  await shot(ece, "10-kim-kime");
  await ece.getByRole("link", { name: /Ece/ }).first().click();
  await expectText(ece, "Market alışverişi");
  await shot(ece, "11-bakiye-dokumu");
  ok("Borcun hangi harcamadan geldiği görülebiliyor");

  // Ödeş
  await ece.goBack();
  await ece.getByRole("button", { name: /Ödeş · ₺620,25/ }).first().click();
  await ece.waitForURL("**/pay/**");
  await expectText(ece, "₺620,25");
  if ((await ece.locator("main").innerText()).includes("TR33")) throw new Error("IBAN açık istek olmadan gösterildi");
  await ece.getByRole("button", { name: /IBAN bilgisini göster/ }).click();
  await expectText(ece, "TR33 0006 1005 1978 6457 8413 26");
  await shot(ece, "12-odeme-sayfasi");
  await ece.getByRole("button", { name: "Ödeme yaptım" }).click();
  await expectText(ece, "Bildirimin iletildi");
  await shot(ece, "13-bildirildi");
  ok("Borçlu IBAN'ı gördü ve “Ödeme yaptım” bildirdi (otomatik doğrulama iddiası yok)");

  // Beyan bakiyeyi değiştirmemeli
  await tan.goto(groupUrl);
  await expectText(tan, "Alacağın");
  await tan.goto(`${groupUrl}?tab=payments`);
  await expectText(tan, "Ödendi olarak bildirildi");
  await shot(tan, "14-onay-bekleyen");
  await tan.getByRole("button", { name: "Ödemeyi aldım, onayla" }).click();
  await expectText(tan, "Alıcı tarafından onaylandı");
  await shot(tan, "15-onaylandi");
  await tan.goto(groupUrl);
  await expectText(tan, "Herkes ödeşik");
  await shot(tan, "16-odesik");
  ok("Alıcı onayladı; bakiye ancak onaydan sonra kapandı");

  await ece.goto(BASE);
  await shot(ece, "17-davetli-ana-sayfa");
  await ece.goto(`${BASE}/activity`);
  await expectText(ece, "ödemen onaylandı");
  ok("Borçluya onay bildirimi ulaştı");

  // Yetkisiz erişim: üçüncü kişi grup adresini bilse de göremez
  const stranger = await mk();
  const r = await stranger.goto(groupUrl);
  if (!stranger.url().includes("/login")) throw new Error("Oturumsuz kullanıcı gruba ulaştı: " + r.status());
  ok("Oturumsuz ziyaretçi grup sayfasına ulaşamıyor");

  // Yatay taşma ve dokunma hedefi denetimi
  for (const [p, name] of [[tan, "kurucu"], [ece, "davetli"]]) {
    for (const path of ["/", "/groups", "/profile"]) {
      await p.goto(BASE + path);
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (overflow) throw new Error(`Yatay taşma: ${name} ${path}`);
    }
  }
  ok("Mobil genişlikte yatay taşma yok");
  console.log(`\nTamamlandı: ${steps.length} adım. Ekran görüntüleri: e2e/screenshots/`);
} catch (e) {
  console.error("✗ BAŞARISIZ:", e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
