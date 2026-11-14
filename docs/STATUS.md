# Durum, test sonuçları ve ölçümler

Son doğrulama: 15 Kasım 2026, yerel ortam (Node 22, PostgreSQL 16, Chromium / iPhone 13 görünümü).

## Test sonuçları

| Paket | Sonuç |
|---|---|
| `npm test` (hesap motoru + PostgreSQL servis testleri) | 62 / 62 geçti |
| `npm run test:e2e` (mobil: davet → katılım → harcama → ödeş) | 12 / 12 adım geçti |
| `npm run test:e2e:demo` (sandbox ödeme, fiş, OCR, metinden taslak, CSV) | 9 / 9 adım geçti |
| `npx tsc --noEmit`, `npm run build` | Hatasız |

İstenen senaryoların testlerdeki karşılığı (`tests/engine.test.ts`, `tests/services.test.ts`):

| Senaryo | Test |
|---|---|
| 100 TL'nin üç kişiye dağıtılması | "100 TL üç kişiye…" (33,34 + 33,33 + 33,33) |
| Birden fazla ödeyen | "birden fazla ödeyen" |
| Bir kalemden hariç tutulan üye | "bir kalemden hariç tutulan üye", "örnek cümle…" |
| İndirim ve servis bedeli | "indirim ve servis bedeli orantılı…", "…eşit dağıtım seçeneği" |
| Döviz hassasiyeti | "döviz hassasiyeti: BigInt…", "döviz: özgün tutar ve onaylanan kur…" |
| Harcama değişikliği sonrası bakiye | "harcama değişince bakiye yeniden hesaplanır…" |
| Kısmi ödeme | "kısmi ödeme: talep açık kalır…" |
| Aynı webhook'un tekrar gelmesi | "…aynı webhook tekrar gelince…", "eşzamanlı aynı webhook…" |
| Başarısız ödemenin borcu kapatmaması | "başarısız ödeme borcu kapatmaz…" |
| Başka grubun verisine erişim engeli | "başka grubun verisine erişilemez" |
| Süresi dolan davet | "süresi dolan, iptal edilen ve geçersiz davet" |
| Tekrarlayan giderin çift oluşmaması | "zamanlanmış görev aynı dönemi iki kez üretmez…" |
| Eşzamanlı fiş seçimleri | "eşzamanlı seçimler tutarlı…", "onay ile eşzamanlı gelen seçim…" |
| Paylar toplamı = tutar | 500 rastgele dağıtım + her harcama yazımında sunucu doğrulaması |
| Her para biriminde netler toplamı sıfır | 200 rastgele grup |
| Sadeleştirme net bakiyeyi değiştirmez | aynı rastgele test + "sadeleştirme ayarı…" |
| Bir ödeme aynı borca iki kez işlenmez | çift onay, çift webhook, çift durum sorgusu testleri |

Testlerin yakaladığı ve düzeltilen iki gerçek hata: çok ödeyenli harcamalarda ikili borç dökümünde kuruş kayması; "1.240" yazımında cümle bölme hatası.

## Özellik durumu

**Çalışıyor** = dış servis gerekmeden uçtan uca çalışır. **Demo** = yalnızca açıkça etiketli demo modunda. **Dış sağlayıcı bekliyor** = adaptör hazır, sağlayıcı bağlanmadı.

| Özellik | Durum | Not |
|---|---|---|
| Yalnızca adla hızlı başlangıç, e-posta + parola ile hesap | Çalışıyor | Misafir hesap sonradan güvenceye alınır, aynı kimlik korunur |
| E-posta doğrulama, parola sıfırlama | Dış sağlayıcı bekliyor | E-posta sağlayıcısı yok; akış yazılmadı |
| Grup kurma, türler, geçici isimle üye | Çalışıyor | |
| Davet bağlantısı (süreli, iptal edilebilir), WhatsApp / sistem paylaşımı | Çalışıyor | Paylaşımı kullanıcı başlatır |
| Güvenli davet önizlemesi, yönetici onaylı sahiplenme, kişiye özel davet | Çalışıyor | |
| Roller: yönetici / üye / sınırlı misafir | Çalışıyor | |
| Harcama: tek/çok ödeyen, eşit, tutar, yüzde, pay, kalem | Çalışıyor | |
| Düzenleme, geri alınabilir silme, değişiklik geçmişi | Çalışıyor | Eşzamanlı düzenlemede sürüm denetimi |
| Yorum ve düzeltme talebi | Çalışıyor | Açık talep hatırlatmayı durdurur |
| Belge ekleme (harcama formundan) | Kısmen | Yükleme ve imzalı bağlantı çalışıyor; şimdilik yalnızca fiş akışında arayüzü var |
| Bakiyeler, bakiye dökümü, sadeleştirme aç/kapat | Çalışıyor | |
| Çok para birimi, onaylı kur ile çevirme | Çalışıyor | Kur elle girilir |
| Kur önerisi (TCMB) | Dış sağlayıcı bekliyor | `FX_PROVIDER=tcmb` kodu var; bu ortamda ağdan sınanmadı |
| Ödeme talebi, kişiye özel ödeme bağlantısı | Çalışıyor | |
| IBAN ile ödeme, "Ödeme yaptım", alıcı onayı, geri alma | Çalışıyor | Üç ayrı etiket; beyan bakiyeyi değiştirmez |
| Dekont yükleme | Dış sağlayıcı bekliyor değil; yapılmadı | Veri modeli alanı var, arayüzü yok |
| Kısmi ödeme, ödeme tarihi önerisi | Çalışıyor | |
| Uygulama içi ödeme (sağlayıcı ile) | Demo | Yalnızca sandbox simülatörü. Gerçek sağlayıcı bağlı değil |
| İmzalı webhook, idempotency, sıra dışı olay, durum sorgusu, ters işlem | Çalışıyor | Sandbox üzerinden sınandı; gerçek sağlayıcıyla sınanmadı |
| Fiş: elle kalem girişi, ortak seçim, nihai onay, yeniden açma | Çalışıyor | Seçimler 5 saniyede bir yenilenir |
| Fiş OCR | Demo / Dış sağlayıcı bekliyor | `demo` sabit örnek döndürür. `anthropic` adaptörü yazıldı, anahtar olmadığı için canlı sınanmadı |
| Yazarak harcama taslağı (kural tabanlı) | Çalışıyor | Belirsizlikte soru sorar |
| Yazarak taslak (dil modeli) | Dış sağlayıcı bekliyor | Adaptör yazıldı, canlı sınanmadı |
| Konuşarak ekleme | Çalışıyor (tarayıcıya bağlı) | Web Speech API; otomatik testte sınanmadı. Sunucu tarafı konuşma çözümleme yok |
| Tekrarlayan gider, değişken fatura taslağı, gün bazlı paylaşım | Çalışıyor | |
| Aylık özet / gezi özeti, paylaşılabilir metin | Çalışıyor | |
| Sonradan katılanı harcamalara dahil etme, çiftlerin birlikte hesaplaşması | Çalışıyor | |
| Hatırlatmalar (uygulama içi), sıklık sınırı, durdurma kuralları | Çalışıyor | Zamanlayıcı kurulmalı |
| E-posta / push / WhatsApp Business bildirimi | Dış sağlayıcı bekliyor | Kanal yok; arayüzde böyle yazıyor |
| Bildirim tercihleri, pazarlama izni ayrımı | Çalışıyor | |
| Hesap dışa aktarımı (JSON), hesap silme | Çalışıyor | |
| KVKK / gizlilik / koşullar | Taslak | Hukuki inceleme yapılmadı |
| Premium: kotalar, grup kuralı, CSV, gelişmiş rapor | Çalışıyor | Yetki elle verilir (`npm run premium:grant`) |
| PDF dışa aktarım | Kısmen | Tarayıcının "yazdır → PDF" özelliğiyle |
| Abonelik satın alma | Dış sağlayıcı bekliyor | Düğme kapalı, fiyat yok |
| Analitik olay katmanı | Çalışıyor | Varsayılan: yerel tablo |
| Amplitude'a gönderim | Dış sağlayıcı bekliyor | Kod var, anahtarla sınanmadı |
| PWA (manifest, ana ekrana ekleme, çevrimdışı uyarı) | Çalışıyor | Finansal veri önbelleğe alınmaz |
| İngilizce arayüz | Yapılmadı | Metinler tek sözlükte; `en.ts` eklenebilir |

## Analitik

16 olay `src/server/analytics.ts` içinde tanımlıdır. Yalnızca izinli alanlar gider (grup türü, bölüşme türü, para birimi, tutar, sayılar). İsim, IBAN, açıklama, fiş içeriği gönderilmez; kullanıcı ve grup kimlikleri HMAC ile takma ada çevrilir.

Yerel `analytics_events` tablosundan örnek ölçümler:

```sql
-- Davetten katılıma dönüşüm
select (select count(*) from analytics_events where name='member_joined')::float
     / nullif((select count(*) from analytics_events where name='invite_opened'),0);

-- Grup başına ilk harcamaya kadar geçen süre
select g.group_hash, min(e.created_at) - min(g.created_at) as sure
from analytics_events g join analytics_events e using (group_hash)
where g.name='group_created' and e.name='first_expense_created' group by 1;

-- Talep edilen tutarın ödenme oranı
select (select sum((props->>'amount_minor')::bigint) from analytics_events where name in ('payment_verified','manual_payment_confirmed'))::float
     / nullif((select sum((props->>'amount_minor')::bigint) from analytics_events where name='payment_request_created'),0);

-- 7 günlük aktif grup
select count(distinct group_hash) from analytics_events where created_at > now() - interval '7 days';
```

İlk hesaplaşmaya kadar süre (`group_settled`), ödeme tamamlama oranı (`payment_started` → `payment_verified`), 30 günlük devamlılık, grup başına aktif üye (`actor_hash`) ve yeniden grup kurma (`group_created.kind = repeat`) aynı tablodan türetilir.
