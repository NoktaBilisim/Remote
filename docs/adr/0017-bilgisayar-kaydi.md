# ADR-0017 — Bilgisayar kaydı (kalıcı istemci): sunucu üretimli anahtar, yalnız talep yetkisi

Tarih: 2026-11-12 · Durum: Önerildi · İlgili: ADR-0004 r4, ADR-0006 r5, ADR-0016, `docs/mimari-e10.md` §3.3–3.4, §5; AC-181..188, V21, V22, V28.

## Bağlam

Sahadan gelen geri bildirim: müşteri elindeki dosyayı (çoğu zaman süresi dolmuş `Destek-<kod>.exe`) yeniden açtığında teknisyene talep düşmüyor. E10, başarılı bir oturumdan sonra bilgisayarın firmayı "hatırlamasını" ister. Kısıtlar: ikili jenerik kalır (ADR-0010), istemci yalnız tek DPAPI dosyası yazar (ADR-0004), 0.9.x istemci kırılmaz, kayıt gözetimsiz erişime dönüşmez (S7), tek bilgisayar tek başına geçersizleşebilmeli (V22).

## Karar

1. **Anahtar:** Sunucu her bilgisayar için `rsb_` + base64url(32 bayt rastgele) üretir (256 bit). Sunucu yalnız SHA-256 özetini `device_bindings.key_hash` (UQ) olarak saklar; geçersizleşince özet NULL olur, satır audit için kalır. Müşteri ref'inin kopyası **değildir**.
2. **Verme anı ve kanalı:** Misafir admit edildikten (VIEW GRANTED) sonra `/ws/guest` üzerinde: sunucu yalnız `clientVersion ≥ 0.10.0` olan AGENT'a `binding.offer` gönderir → istemci `binding.request{previousKey?}` → sunucu tek TX'te verir/yeniler → `binding.issued`. Kaydın müşterisi istemciden değil oturumun `customer_id`'sinden gelir.
3. **Rotasyon ve tekillik:** Aynı tenant'ın etkin kaydını gösteren `previousKey` gelirse satır yerinde güncellenir (yeni anahtar, müşteri, son kullanım). Başka tenant'ın kaydıysa o satır `REPLACED` olur. İstemci tek kayıt tutar (S19).
4. **Yetki kapsamı:** Anahtar yalnız `POST /public/bindings/status`, `POST /public/requests` ve `POST /public/bindings/revoke`'ta geçer. Oturum, ticket, reconnect ve TURN uçları bu tabloya bakmaz. Kayıtla açılan talep E9 akışından geçer: teknisyen kabulü ve müşterinin her seferki "Ekranımı paylaş" onayı şarttır.
5. **Geçersizleşme:** unut (`FORGOTTEN`), müşteri bağlantısı yenilendi/pasif, Genel bağlantı yenilendi, tenant pasif, son kullanımdan tenant saklama süresi geçti (`EXPIRED`). Kullanım anında sorgu koşulu, ayrıca TX/iş ile özet silinir. Bütün nedenler tek 404 `BINDING_INVALID` verir.
6. **Sınırlar:** kayıt başına 1 bekleyen talep + 6 talep/sa; kayıtla gelen talep bilinen kaynak sayılır.

## Alternatifler

- **Müşteri ref'ini kayıt olarak saklamak:** Tek bilgisayar ayrı geçersizleşemez (V22). Ref gizli değildir. Reddedildi.
- **`hello`'ya alan eklemek:** 0.9.x `strict` ayrıştırıcısı bilinmeyen alanda bağlantıyı düşürür. Reddedildi.
- **Ayrı REST ucu (`POST /public/bindings` + reconnectToken):** Oturum kimliğini REST'e taşır ve yeni bir saldırı yüzeyi açar. WS soketi zaten admit edilmiş misafiri kanıtlıyor. Reddedildi.
- **İstemci üretimli anahtar (deviceKey) + sunucu kaydı:** Sunucu anahtarın gücünü ve rotasyonunu denetleyemez, eski istemcilerde anahtar zaten isteğe bağlı. Reddedildi.
- **Kaydı yavaş hash (argon2) ile saklamak:** 256 bit rastgele anahtarda gereksiz maliyet. SHA-256 yeterli.

## Sonuçlar

- **r2 (2026-11-12, güvenlik tasarım turu E10 — mimari-e10 §15):** (a) Talepten doğan oturumda kayıt yalnız kaynak bayat değilse verilir: talep ref yenilemesinden sonra açılmış olmalı, kayıtla açıldıysa kayıt etkin olmalı. (b) DB değişmezi: oturum başına en çok bir etkin kayıt (`active_session_id` STORED + UQ). (c) Panelden tek kayıt iptali (`ADMIN_REVOKED`, `POST /support-requests/:id/revoke-binding`), böylece V22 Admin için de sağlanır. (d) Müşterisiz kod oturumu kaydın müşteri bağını korur. (e) Başka tenant'ın kaydını değiştirmek iki tenant'ın audit'inde de görünür, karşı tenant adı yazılmaz. (f) Kayıtlı bilgisayar kimlik doğrulaması değildir; rozet kapsamlı ve nötrdür. (g) Kayıt yanıtının kaybolması kabul edilen risktir (AC-185 ile kurtarılır).
- Müşteri dosyasız/süresi dolmuş dosyayla "Destek iste" kullanabilir. Teknisyenin link akışı değişmez.
- Sızan anahtarın etkisi "o firma/müşteri adına talep açmak" ile sınırlıdır. Kişi doğrulaması teknisyende kalır (R19, T39).
- Sunucu geri alınırsa istemci teklif almaz, kayıt istemez. Mevcut kayıtlar 404 alır ve istemci tarafından silinir.
- Yeni tablo ve P13 retention'a bir tablo daha eklenir.
