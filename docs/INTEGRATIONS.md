# Entegrasyon kurulumu

Her dış servis bir adaptörün arkasındadır. Anahtar yoksa ilgili özellik kapalı kalır ve arayüz bunu söyler; başarı taklidi yapılmaz.

## Ödeme sağlayıcısı

Durum: gerçek sağlayıcı **bağlı değil**. Uygulamanın FAST'e ya da açık bankacılığa doğrudan erişimi yoktur.

- `PAYMENT_PROVIDER=none` (varsayılan): IBAN göster → kullanıcı kendi bankasından gönderir → "Ödeme yaptım" → alıcı onaylar.
- `PAYMENT_PROVIDER=sandbox`: uygulama içi DEMO simülatörü. Üretimde yalnızca `DEMO_MODE=true` iken açılır.

Gerçek sağlayıcı eklemek için `src/server/providers/payment.ts` içindeki `PaymentProvider` arayüzü, yetkili bir ödeme kuruluşunun ya da bankanın **belgelenmiş** API'siyle uygulanır:

| Yöntem | Görev |
|---|---|
| `methods` | Sağlayıcının gerçekten desteklediği yöntemler (arayüzde yalnızca bunlar yazılır) |
| `quoteFee` | Onaydan önce gösterilecek işlem ücreti |
| `createPayment` | Ödemeyi başlatır; `idempotencyKey` sağlayıcıya iletilmelidir. Sağlayıcının onay sayfasının adresini döndürür |
| `fetchStatus` | Sunucudan durum sorgusu |
| `verifyWebhook` | Sağlayıcının imza şemasını doğrular; doğrulanamazsa `null` |

Hazır olan altyapı: webhook ucu `/api/webhooks/payments`, tekrar eden olayların tek işlenmesi (`webhook_events`), sıra dışı olaylar için durum makinesi, girişim başına tek defter kaydı, talep başına tek açık girişim, kısmi ödeme ve ters işlem. Sağlayıcının sandbox'ında şu senaryolar yeniden sınanmalıdır: başarı, ret, zaman aşımı, çift webhook, geç gelen webhook, iade.

Banka şifresi, OTP, kart numarası ya da CVV uygulamada toplanmaz; onay sağlayıcının sayfasında yapılır. Sağlayıcı desteklemedikçe "tüm bankalar" ya da "tek tıkla ödeme" gibi ifadeler eklenmemelidir.

## Fiş okuma (OCR) ve metinden taslak

- `OCR_PROVIDER=none | demo | anthropic`, `NLP_PROVIDER=rules | anthropic`
- `anthropic` için `ANTHROPIC_API_KEY` gerekir; model `ANTHROPIC_MODEL` ile değiştirilebilir (varsayılan `claude-opus-5-5`). Anahtar yalnızca sunucuda okunur.
- Adaptör: `src/server/providers/ai.ts`. Çıktı şemayla doğrulanır; görsel ve metin "güvenilmeyen veri" olarak işlenir; model yalnızca taslak üretir, kayıt ya da ödeme başlatamaz. Paylar her zaman sunucuda yeniden hesaplanır.
- Bu adaptör anahtar olmadığı için canlı çağrıyla **sınanmadı**. İlk kurulumda gerçek fişlerle doğruluk ölçülmeli ve görsellerin üçüncü tarafa aktarımı aydınlatma metnine eklenmelidir.
- Başka bir OCR servisi için aynı dosyadaki `extractReceipt` işlevine yeni bir dal eklenir.

## Konuşma

Tarayıcının Web Speech API'si kullanılır (`tr-TR`); ses sunucuya gönderilmez ve saklanmaz. Tüm tarayıcılarda bulunmaz; yoksa kullanıcı yazarak devam eder. Sunucu tarafı konuşma çözümleme istenirse yeni bir adaptör yazılmalı, kayıt izni ve saklama süresi tanımlanmalıdır.

## Bildirimler

`src/server/notify.ts` uygulama içi bildirimi yazar. E-posta, push ve WhatsApp kanalları yoktur.

- WhatsApp'ta otomatik mesaj için Meta'nın resmi WhatsApp Business Platform'u (ya da yetkili bir çözüm ortağı), kullanıcı izni ve onaylı mesaj şablonları gerekir. Kullanıcının kişisel WhatsApp hesabı otomatikleştirilmez. Mevcut "WhatsApp'ta paylaş" düğmesi yalnızca hazır metinle sohbeti açar; gönderimi kullanıcı yapar.
- E-posta sağlayıcısı bağlandığında e-posta doğrulama ve parola sıfırlama akışları da yazılmalıdır.

## Analitik

`ANALYTICS_PROVIDER=db | amplitude | none`. `amplitude` için `AMPLITUDE_API_KEY`; olaylar Amplitude HTTP V2 API'sine gönderilir. AB veri bölgesi kullanılacaksa uç adresi `src/server/analytics.ts` içinde değiştirilmelidir.

## Kur

`FX_PROVIDER=manual` (varsayılan) ya da `tcmb` (TCMB günlük kur XML'i, döviz satış). Öneri yalnızca alanı doldurur; kaydedilen kur her zaman kullanıcının onayladığı değerdir.

## Dosya depolama

Yerel disk (`STORAGE_DIR`), herkese açık olmayan klasör. Dosyalar yalnızca üyeye üretilen, 5 dakika geçerli imzalı bağlantıyla sunulur. Birden fazla sunucu ya da kalıcı olmayan disk kullanılacaksa `src/server/storage.ts` nesne depolamaya (S3 uyumlu, özel kova) taşınmalıdır.

## Abonelik

Entegrasyon yok. Planlar `src/config/plans.ts` içinde; fiyat tanımlı değil. Yetki `entitlements` tablosundan okunur; satın alma sağlayıcısı bağlandığında bu tabloya yazması yeterlidir.
