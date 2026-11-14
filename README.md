# Payımız

> **Hesabı paylaş. Kolayca ödeş.**

Türkiye için ortak harcama ve hesaplaşma uygulaması. Bir kişi ev, tatil ya da yemek grubu kurar, WhatsApp'tan bağlantı gönderir; arkadaşları uygulama indirmeden katılır, payını görür ve ödeşir.

"Payımız" geçici bir addır. Ad ve marka metinleri tek dosyadan değişir: `src/config/brand.ts`. Marka ya da alan adı müsaitliği doğrulanmamıştır.

Bu klasör, depodaki mevcut statik siteden (`../index.html`) bağımsızdır.

## Teknoloji

| Katman | Seçim | Neden |
|---|---|---|
| Uygulama | Next.js 15 (App Router) + TypeScript | Sunucu bileşenleri ve sunucu eylemleriyle hesap ve yetki sunucuda kalır |
| Arayüz | Tailwind CSS, mobil öncelikli PWA | Ana ekrana eklenebilir; uygulama indirmek gerekmez |
| Veri | PostgreSQL 16, düz SQL migration | Para için BIGINT, tekillik ve kilitlerle idempotency |
| Kimlik | Kendi oturum katmanı (httpOnly çerez, scrypt) | Ortamda Supabase/Docker yoktu; dış servis gerektirmez |
| Dış servisler | Adaptörler: ödeme, OCR, metin taslağı, bildirim, analitik, kur, depolama | Anahtar yokken de çalışır; eksik olan açıkça etiketlenir |

Supabase kullanılmadığı için RLS politikası yoktur. Erişim kontrolü sunucu servis katmanında, her işlemde grup üyeliği doğrulanarak yapılır ve testlerle sınanır (bkz. `docs/LAUNCH_CHECKLIST.md`, "veritabanı düzeyinde ikinci katman").

## Yerelde çalıştırma

Gerekenler: Node 22+, PostgreSQL 14+.

```bash
createuser -P payimiz            # parola: payimiz
createdb -O payimiz payimiz_dev
createdb -O payimiz payimiz_test
cp .env.example .env.local       # APP_SECRET ve CRON_SECRET değerlerini değiştirin
npm install
npm run db:migrate
npm run dev                      # http://localhost:3000
```

### Demo ortamı (ayrı veritabanı)

Demo verisi gerçek hesaplarla aynı veritabanına yazılamaz; betik, `DEMO_MODE=true` ve adında "demo" geçen bir veritabanı ister.

```bash
createdb -O payimiz payimiz_demo
export DEMO_MODE=true DATABASE_URL=postgres://payimiz:payimiz@localhost:5432/payimiz_demo
export PAYMENT_PROVIDER=sandbox PAYMENT_WEBHOOK_SECRET=yerel-demo-anahtari OCR_PROVIDER=demo APP_URL=http://localhost:3001
npm run db:seed:demo
npm run build && npx next start -p 3001
```

Giriş ekranındaki demo hesap düğmeleriyle (Tan, Ece, Can, Defne, Mert) "Kadıköy Ev", "Bodrum Hafta Sonu" ve "Cuma Yemeği" gruplarını gezebilirsiniz. Her sayfada DEMO şeridi görünür.

### Zamanlanmış işler

Tekrarlayan giderler, hatırlatmalar ve süresi dolan talepler için günde en az bir kez:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron
```

ya da `npm run jobs:run`. İşler tekrar çalıştırılmaya dayanıklıdır. Zamanlayıcı kurulmamışsa tekrarlayan giderler grup sayfası açıldığında da üretilir; hatırlatmalar için zamanlayıcı şarttır.

## Testler

```bash
npm test                 # 62 test: hesap motoru + PostgreSQL üzerinde servis testleri (payimiz_test)
npm run test:e2e         # mobil tarayıcı: davet → katılım → harcama → ödeş (uygulama :3000'de açıkken)
npm run test:e2e:demo    # demo ortamı: sandbox ödeme, fiş, OCR, metinden taslak (:3001'de açıkken)
```

Sonuçlar ve özellik durumu: [`docs/STATUS.md`](docs/STATUS.md). Entegrasyon kurulumu: [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md). Yayın öncesi işler: [`docs/LAUNCH_CHECKLIST.md`](docs/LAUNCH_CHECKLIST.md).

## Kod haritası

```
db/migrations/        Şema (SQL)
src/lib/              Saf hesap kodu: money, split, balances, expense-calc, nlp-rules, iban
src/server/           Servisler (yetki + iş kuralları): auth, groups, invites, expenses, ledger,
                      payments, receipts, recurring, reminders, nl, storage, analytics …
src/server/providers/ Ödeme ve yapay zekâ adaptörleri
src/app/              Ekranlar, sunucu eylemleri (actions.ts), API uçları
src/locales/tr.ts     Tüm arayüz metinleri
src/config/           Marka ve plan (ücretsiz/premium) yapılandırması
src/content/legal/    Düzenlenebilir hukuki metin TASLAKLARI
tests/, e2e/          Testler
```

## Temel tasarım kararları

- **Para tam sayıdır.** Tutarlar kuruş olarak BIGINT saklanır; kur çevirisi BigInt ile yapılır. Kayan nokta kullanılmaz.
- **Yuvarlama görünür ve deterministiktir.** Artan kuruşlar en büyük küsurata, eşitlikte üye sırasına göre dağıtılır; her payda `rounding_minor` saklanır ve arayüzde `*` ile gösterilir.
- **Bakiye saklanmaz, hesaplanır.** Tek kaynak: etkin harcamalar + geri alınmamış kesin ödemeler.
- **Plan, beyan ve kesin ödeme ayrıdır.** `payment_requests` (talep), `manual_payment_reports` (beyan), `payment_attempts` (sağlayıcı girişimi), `payments` (defter). Bakiyeyi yalnızca `payments` değiştirir.
- **Borç sadeleştirme** açgözlü bir yöntemdir: en fazla (kişi − 1) transfer üretir, net bakiyeyi değiştirmez; "en az transfer" iddia edilmez. Gruplar arası mahsup yoktur.
- **Misafir güvenliği.** Genel davetle gelen biri geçici bir ismi ancak yönetici onayıyla sahiplenir; yöneticinin ürettiği kişiye özel davet tek kullanımlıktır. Ödeme bağlantısı üyelik vermez.
- **Ortak cüzdan yok.** Uygulama para tutmaz, kullanıcı adına transfer yapmaz.
