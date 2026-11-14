# Gerçek kullanıcıya açmadan önce

Bu liste bitmeden uygulama gerçek kullanıcıya açılmamalıdır. Ücretli servis açmak, üretime yayınlamak ve gerçek para hareketi ayrıca onay gerektirir.

## Hukuk ve uyum
- [ ] Gizlilik politikası, kullanım koşulları ve KVKK aydınlatma metni bir hukuk danışmanınca yazılsın (`src/content/legal/` içindekiler taslaktır). Veri sorumlusu bilgileri, hukuki sebepler, saklama süreleri ve yurt dışı aktarımlar tamamlansın.
- [ ] VERBİS kaydı ve açık rıza gereksinimleri değerlendirilsin.
- [ ] Ödeme akışının (özellikle uygulama içi ödeme açılırsa) ödeme hizmetleri mevzuatı kapsamında lisans gerektirip gerektirmediği danışılsın. O zamana kadar "lisanslı", "tam uyumlu" gibi ifadeler kullanılmasın.
- [ ] "Payımız" adı için marka ve alan adı araştırması yapılsın.

## Kimlik ve hesap
- [ ] E-posta sağlayıcısı bağlansın; e-posta doğrulama ve parola sıfırlama yazılsın. Şu an parolasını unutan kullanıcı hesabına giremez.
- [ ] Misafir hesaplar için kurtarma yolu netleşsin (çerez silinirse hesap kaybolur; arayüz bunu söylüyor).
- [ ] Giriş denemesi sınırı ve şüpheli oturum bildirimi gözden geçirilsin.

## Güvenlik
- [ ] İstek sınırlayıcı bellek içidir; birden fazla sunucuda ortak depoya (ör. Redis) taşınsın.
- [ ] Veritabanı düzeyinde ikinci katman: grup üyeliğine göre PostgreSQL RLS politikaları eklensin ve test edilsin. Şu an yetki yalnızca servis katmanındadır.
- [ ] İçerik güvenlik politikası (CSP) başlığı eklensin.
- [ ] IBAN alanı veritabanında şifrelensin; yedekler şifreli tutulsun.
- [ ] Bağımsız güvenlik incelemesi / sızma testi yapılsın. `npm audit` çıktısı temizlensin.
- [ ] `APP_SECRET`, `CRON_SECRET`, webhook anahtarı gizli anahtar kasasında tutulsun; döndürme planı yazılsın.
- [ ] Yüklenen dosyalar için zararlı içerik taraması ve görsel üst verisinin (EXIF konum) temizlenmesi eklensin.

## Ödeme
- [ ] Yetkili bir ödeme sağlayıcısı seçilsin, sözleşme yapılsın ve adaptör sandbox'ta sınansın (bkz. `INTEGRATIONS.md`).
- [ ] Mutabakat: sağlayıcı kayıtlarıyla `payments` tablosunun günlük karşılaştırması ve tutar uyuşmazlığı (`payment_attempt.amount_mismatch`) için inceleme süreci.
- [ ] İade, itiraz ve destek süreçleri tanımlansın.

## Altyapı
- [ ] Üretim PostgreSQL'i, yedekleme ve geri yükleme tatbikatı.
- [ ] `/api/cron` için zamanlayıcı kurulsun.
- [ ] Dosya depolama kalıcı ve özel bir nesne deposuna taşınsın.
- [ ] Hata izleme, uyarılar, çalışma süresi takibi.
- [ ] Yük testi: bakiye her istekte yeniden hesaplanıyor; çok büyük gruplarda önbellek ya da özet tablo gerekebilir.

## Ürün
- [ ] OCR ve dil modeli adaptörleri gerçek anahtarla, gerçek Türkçe fişlerle sınansın; doğruluk ölçülsün.
- [ ] Dekont yükleme ve harcama formundan belge ekleme arayüzü tamamlansın.
- [ ] Erişilebilirlik denetimi (ekran okuyucu ve klavye ile tam tur, kontrast ölçümü). ₺ simgesi yazı tipinde yedek karakterle çiziliyor; tipografi gözden geçirilsin.
- [ ] Gerçek cihazlarda (iOS Safari, Android Chrome) deneme; sesle ekleme bu cihazlarda sınansın.
- [ ] Bildirim kanalları (push / e-posta) ve gerekirse WhatsApp Business şablonları.
- [ ] İngilizce yerelleştirme.
- [ ] Demo modunun üretim dağıtımında kapalı olduğu doğrulansın.
