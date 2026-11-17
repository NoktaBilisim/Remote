# ADR-0039 — Portal kimliği ve oturum ayrımı

Tarih: 2026-11-17 · Durum: **Kabul r2** (güvenlik tasarım turu 1 GEÇTİ — S-P21-1..5 m.1, m.7, Sonuçlar'a işlendi) · r1.1: m.7 portal talep ucu (koordinatör kararı) · İlgili: AC-262, `docs/mimari-p21.md`,
`docs/mimari-e11.md` §11 P21 satırı, ADR-0008 (opak oturum + CSRF), ADR-0022 (step-up), ADR-0030 (kalıcı silme)

## Bağlam

- AC-262: müşteri firmanın yetkili kişisi e-posta + şifre (+ isteğe bağlı TOTP) ile girer, yalnız kendi müşterisinin talep/oturum
  meta verisini görür; başka müşterinin verisine erişim 404.
- Panel kimliği (`users` + `auth_sessions`, çerez `__Host-rs_session`) tenant kullanıcıları içindir: roller SUPER_ADMIN/ADMIN/USER,
  her uç `requirePerm` ile korunur, USER rolünün varsayılan yetkileri kapalıdır ama Admin toggle ile açabilir; `tenantScope` tenant
  düzeyinde kapsar, **müşteri** düzeyinde kapsam kavramı yoktur.
- Müşteri kişisi tenant çalışanı değildir; panel uçlarının hiçbirine, WS'lere (`/ws/tech`) ve tenant ayarlarına erişmemelidir.
- Sadelik ilkesi: tek yol, istisna dalı yok; panel guard'ına "müşteri ise şunu atla" dalı eklemek bu ilkeye aykırıdır.

## Karar

1. **Ayrı kimlik alanı:** `portal_users` (tenant_id + customer_id zorunlu; r2 S-P21-3: e-posta **firma içinde** tekil, UQ(tenant_id, email); giriş adresi firmaya bağlı `/portal/login?tenant=<slug>`) ve `portal_sessions`
   tabloları. Panel `users`/`auth_sessions` tablolarına dokunulmaz, rol eklenmez.
2. **Ayrı çerezler:** `__Host-rs_portal` (httpOnly) ve `__Host-rs_portal_csrf`; Secure, SameSite=Strict, Path=/. CSRF başlık adı
   ortak (`x-csrf-token`), karşılaştırıldığı çerez alana özgü.
3. **Ayrı guard:** `requirePortal` yalnız portal çerezini okur ve hash'i yalnız `portal_sessions`'ta arar; `requireAuth` yalnız panel
   çerezini okur ve yalnız `auth_sessions`'ta arar. Bir alanın token'ı diğer alanda yapısal olarak çözülemez (tablo farklı).
4. **Kapsam oturumdan:** `portalScope(req) = { tenantId, customerId, portalUserId }` yalnız oturumdan türetilir; portal repo
   fonksiyonları bu kapsamı zorunlu parametre alır; tekil kayıt yoksa ya da başkasınınsa 404 (ayrım yok). `customer_id`/`tenant_id`
   DB'de güncellenemez (sütun düzeyi grant).
5. **Ortak kod yeniden kullanılır, kopyalanmaz:** argon2id (`auth/password.ts`), TOTP (`auth/mfa.ts`), token üretimi/hash
   (`lib/ids.ts`), hız kovası (`lib/rate.ts`), audit (`audit/service.ts`), sır kutusu (`lib/crypto.ts`). Oturum süreleri panelle aynı
   (mutlak 8 sa, boşta 30 dk).
6. **Yarım oturum yok:** TOTP kodu giriş isteğinde gelir; açık TOTP'li hesapta kodsuz istek 403 `MFA_REQUIRED` döner, oturum açılmaz.
7. **Portal kimliği talep oluşturmada bot kapısının yerini alır:** `POST /api/v1/portal/requests` mevcut `RequestService.createCore`'u
   (`source: "WEB"`) çağırır; ref ve müşteri oturumdan çözülür, form token/gizli alan yerine portal oturumu + CSRF + kullanıcı başına
   hız sınırı (müşteri başına 10/sa + 3 bekleyen, r2 S-P21-4) vardır; gövde yalnız sunucuda kurulur ve çözülen müşteri beklenenle eşleşmezse talep yazılmaz (r2 S-P21-1); firmanın `web_form_enabled` tercihi (herkese açık `/r/` formu içindir) bu yolda uygulanmaz. Mesai, KVKK onayı,
   kanal/bildirim, kovalar ve bekleyen sınırları aynı koddur; web tarafında aynı form bileşeni kaynak adaptörüyle kullanılır.
8. **Hesap yaşam döngüsü panel kalıbıyla:** Admin oluşturur (geçici şifre bir kez), ilk girişte zorunlu değişim; Admin pasife alır /
   etkinleştirir / şifre sıfırlar (TOTP'yi de sıfırlar). Pasif hesap tenant saklama süresi sonunda kalıcı silinir.

## Alternatifler

- **A) `users` tablosuna `CUSTOMER` rolü + `customer_id` kolonu.** Reddedildi: her panel ucuna müşteri dalı gerekir (yetki seti,
  `tenantScope` müşteri kapsamı, WS kapıları, `effectivePermissions`, kullanıcı listesi/toggle ekranı, AC-73 küme kontrolü, step-up,
  kalıcı silme defteri); bir uçta unutulan kontrol tüm tenant verisini açar. `users.email` tekilliği müşteri kişisini panelden de
  engeller. Ayrım yapısal değil, disipline bağlı olur.
- **B) Aynı `auth_sessions` tablosu + `kind` kolonu, tek çerez.** Reddedildi: tek çerezle bir tarayıcıda panel ve portal aynı anda
  açılamaz; her guard'da `kind` dalı (istisna yolu); yanlış dalda çapraz kabul riski.
- **C) Parolasız "magic link" (e-posta ile tek kullanımlık giriş).** Reddedildi: AC "e-posta + şifre" diyor; SMTP'ye bağımlılık ve
  e-posta hesabının ele geçirilmesi = portal hesabının ele geçirilmesi.
- **D) Ayrı alt alan adı (`portal.<host>`) ile çerez izolasyonu.** Reddedildi: yeni DNS/TLS/Caddy bloğu ve CSP `connect-src` değişikliği;
  aynı origin'de ayrı çerez + ayrı tablo aynı izolasyonu sağlar. Genişleme noktası olarak kalır (çerez adları sabit, taşınabilir).

## Sonuçlar

- (+) Panel kodu değişmez; müşteri kişisinin panel/WS'e ulaşması yapısal olarak imkânsız; IDOR kuralı tek modülde (`portal/repo.ts`).
- (+) Yeni bağımlılık ve env yok; mevcut güvenlik ilkelleri yeniden kullanılır.
- (+) Portal talebi P19 akışının aynısıdır (tek oluşturma çekirdeği, tek form bileşeni); AC-262 daraltılmaz.
- (−) Portal kullanıcısı firmanın web formu kapalıyken de talep açabilir (bilinçli; hesabı yalnız Admin açar, kullanıcı başına hız sınırı).
- (−) İki kimlik alanı = iki giriş/şifre değiştirme ekranı ve iki hız kovası seti (kod paylaşılır, ekran/uç ayrı).
- (−) Audit'te portal aktörünün `user_id`'si `users` tablosunda yoktur; ayrım `portal.` eylem öneki ve `entity=portal_users` ile yapılır.
- (−) Aynı origin: portal ile panel arasında XSS yalıtımı CSP + React bağlamasına dayanır (r2 S-P21-13, kabul); alt alan adı (alternatif D) genişleme noktası.
- (−) Bir e-posta bir firmada yalnız bir müşteriye bağlı (genişleme: ara tablo, `docs/mimari-p21.md` A-P21-3).
- Geri dönüş: portal kapatılmak istenirse `portal/*` eklentileri kaydedilmez ve tablolar ters migration ile düşürülür; panel etkilenmez.
