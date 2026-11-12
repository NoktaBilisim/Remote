# Test Raporu — Tur P9 (kullanıcı/yetki/firma yönetimi)
DURUM: GEÇTİ (1 ORTA + 5 DÜŞÜK bulgu, P10 öncesi düzeltilmesi önerilir)
Ortam: YEREL — web standalone `http://localhost:3228` → gerçek `apps/server` (:3312) → geçici MySQL `rs-mysql-p9op:33328`
(seed + 2 ADMIN, parolalar koşu başına rastgele, repoya/rapora yazılmadı). Kod: `main` 916e845 + çalışma ağacı (P9 commit edilmemiş).
Tarih: 2026-11-12. Staging'e bağlanılmadı. Ortam kapatıldı (server, web, DB konteyneri silindi; storageState/creds silindi).

Betikler: `docs/test-raporu/e2e/p9/` (`setup.sh up|down`, `sa-first.mjs`, `login.mjs`, `flow.mjs`, `probe*.mjs`; sonuç `flow.jsonl`, ekranlar `img/`).
Tarama: `docs/test-raporu/p9-tarama-admin/` (Admin, 24 sayfa) ve `docs/test-raporu/p9-tarama-sa/` (Super Admin, 9 sayfa). Rota listesi `docs/rotalar.txt`.

## Özet
| Ölçüt | Değer |
|---|---|
| Taranan sayfa | 33 (Admin 24 + SA 9), masaüstü 1366 + mobil |
| Açılamayan / 5xx | 0 / 0 (yalnız kasıtlı `/settings/tenant` ve `/yok-boyle-sayfa` → 404 ekranı) |
| JS hatası (pageerror) | 0 |
| Konsol hatası | Yalnız kasıtlı tetiklenen 400/403/404/409 ağ satırları + test kaynaklı 1 WS 429 (bkz. Bilgi-2) |
| Server log error/fatal | 0 |
| axe (WCAG 2.1 AA) | /users, /users/[id], /admin/tenants, firma formu, geçici şifre diyaloğu — açık+koyu, 1366+375: 0 ihlal |
| Mobil taşma (375 px) | 1 — Super Admin üst menüsü 6 px (Bulgu 1) |
| > 3 sn açılan | 0 (tümü ~0,6 sn) |
| Akış adımı | 24; 19 ilk koşuda geçti, 4 "kaldı" ölçüm yarışıydı (count() beklemedi) → probe ile doğrulandı geçti, 1 gerçek bulgu (taşma) |

## Bulgular (öncelik sırasıyla)

### [ORTA] Super Admin üst menüsü 375 px'te taşıyor, "Çıkış yap" düğmesi kırpılıyor
Sayfa/akış: SUPER_ADMIN ile herhangi bir panel sayfası (ör. /admin/tenants), 375 px, açık ve koyu tema.
Adımlar: 1. SA ile giriş 2. 375×800 mobil görünümde /admin/tenants aç.
Beklenen: yatay kaydırma yok, tüm üst menü öğeleri görünür.  Gerçekleşen: `scrollWidth - clientWidth = 6`; header içindeki
`LogoutButton` sarmalayıcısı ve düğme right=381 (viewport 375). Firma seçici (ikon+ok) eklenince sağ grup sığmıyor.
Kanıt: `docs/test-raporu/e2e/p9/img/tenants-375-probe.png`, `img/tenants-light-m375.png`, `flow.jsonl` "Görsel/axe light m375".
Yer: `apps/web/app/(panel)/layout.tsx:41-57` (header; `ml-auto flex min-w-0 items-center gap-3`), `apps/web/app/(panel)/logout-button.tsx:35`,
`apps/web/app/(panel)/tenant-switcher.tsx`. Öneri: mobilde gap küçültme / ürün adını daha erken kısaltma / seçiciyi daraltma.
Admin/USER'da (seçici yok) taşma yok. Mevcut mock e2e bu durumu yakalamıyor (taşma testi yalnız `usadm` ile koşuyor).
Atanan: frontend-dev

### [DÜŞÜK] Kullanıcı arayüzünde iç paket adı "P10" görünüyor
Sayfa: /users/[id] → Profil kartı "İki adımlı doğrulama" açıklaması: "Sıfırlama ve zorunlu kılma hesap güvenliği paketinde (P10) gelir."
Beklenen: son kullanıcıya iç yol haritası kodu gösterilmez (ör. "Yakında"). Kanıt: `p9-tarama-admin/ekran/users_01M780K15Q61T2G0VASPHS215X-desktop.png`.
Yer: `apps/web/messages/tr.json:985` (`us.e.twofaHint`); aynı desen `tr.json:719` (`srs.mail.p10`, önceki paket).
Atanan: frontend-dev

### [DÜŞÜK] Olmayan / kapsam dışı kullanıcı sayfası HTTP 200 dönüyor ve h1 yok
Adımlar: Admin ile `/users/00000000000000000000000000` veya başka firmanın kullanıcı id'si → "Kullanıcı bulunamadı" ekranı görünüyor (doğru),
ama yanıt HTTP 200 ve tarayıcı "sayfada h1 yok" raporluyor. Beklenen: 404 durum kodu + tek h1 başlık.
Kanıt: `p9-tarama-admin/rapor.md` (/users/000… satırı), `e2e/p9/img/cross-tenant-user.png`.
Yer: `apps/web/app/(panel)/users/[id]/page.tsx:27,41` (`notFound()`; `users/[id]/loading.tsx` akış sınırı durumu 200'e sabitliyor — P2'deki müşteri sayfası kararıyla aynı neden), `users/[id]/not-found.tsx` (başlık h1 değil).
Güvenlik açısından sorun yok: API GET/PATCH 404, veri sızmıyor.
Atanan: frontend-dev

### [DÜŞÜK] Açık temada kapalı ve kilitli anahtarların kontrastı zayıf
Sayfa: /users/[id] yetki matrisi, açık tema. Kapalı toggle izi beyaz zemin üzerinde çok açık gri; kilitli anahtar (ör. Audit log → Dışa aktar)
neredeyse görünmüyor, yalnız küçük kilit ikonu ayırt ediliyor. WCAG 1.4.11 (non-text contrast ≥ 3:1) şüphesi — axe bu kuralı ölçmüyor, piksel ölçümü yapılmadı (gözlem).
Kanıt: `e2e/p9/img/locked-permission.png`. Koyu temada sorun yok (`img/user-detail-dark-desk.png`).
Yer: `apps/web/components/ui/switch.tsx` (kapalı iz rengi token'ı), DESIGN.md token'ı.
Atanan: frontend-dev

### [DÜŞÜK] Mobilde etkin menü öğesi görünür alana kaydırılmıyor
Sayfa: 375–390 px, /users veya /admin/tenants. Yatay menüde yalnız "Ana sayfa / Oturumlar / Talepler" görünüyor; etkin "Kullanıcılar"/"Firmalar"
ekran dışında, kullanıcı nerede olduğunu menüden göremiyor (breadcrumb var).
Kanıt: `p9-tarama-admin/ekran/users-mobile.png`, `p9-tarama-sa/ekran/admin_tenants-mobile.png`.
Yer: `apps/web/app/(panel)/side-nav.tsx` (aria-current öğeye `scrollIntoView({inline:"nearest"})` önerisi).
Atanan: frontend-dev

### [DÜŞÜK] Mobilde Super Admin etkin firmayı göremiyor
Sayfa: SA, 375 px. Firma seçici yalnız ikon + ok; etkin firma adı ve kullanıcı satırı (sr-only) görünmüyor. Yanlış firmada işlem riski
(ör. kullanıcı ekleme). Masaüstünde "Firma seçilmedi"/firma adı görünüyor. Erişilebilir ad doğru ("Etkin firma: …").
Kanıt: `p9-tarama-sa/ekran/admin_tenants-mobile.png`, `e2e/p9/img/tenants-375-probe.png` (Demo satırında "Etkin firma" rozeti var; diğer sayfalarda gösterge yok).
Yer: `apps/web/app/(panel)/tenant-switcher.tsx`. Bulgu 1 ile birlikte ele alınabilir.
Atanan: frontend-dev

### Bilgi (bulgu değil)
1. `/settings/tenant` için web sayfası yok (404). implementation.md P9 Rotalar tablosu bunu kapsamıyor; AC-4 yalnız API düzeyinde (aşağıda ✅).
   Ekran P10'da SMTP/2FA ile gelecekse `gereksinimler-sonra-acik.md`'de açıkça izlenmeli.
2. Görsel tur ~1 dakikada aynı kullanıcıyla 12 bağlam açınca bir `/ws/panel` el sıkışması 429 aldı (hız sınırı çalışıyor; test kaynaklı).
3. Tarayıcı `/settings/support-requests` iki switch'i "adsız" saydı; düğmelerde `aria-labelledby` var, sezgisel araç çözmüyor olabilir — P8b'de axe temizdi, bu turda yeniden axe koşulmadı.
4. Ad alanı `maxlength=100`: 150 karakter yapıştırma sessizce kırpılıyor (hata metni gösterilmiyor). Davranış kabul edilebilir; sunucu 400'ü zaten var.

## Akış sonuçları (gerçek sunucu)
| Akış | Sonuç | Not |
|---|---|---|
| SA ilk giriş → zorunlu şifre değişimi | ✅ | /change-password → / |
| Admin kullanıcı formu boş gönderim | ✅ | Ad soyad aria-invalid + odak |
| Admin USER ekler, geçici şifre bir kez | ✅ | 16 karakter; kopyalamadan kapatma uyarısı; yenilemede/detayda tekrar görünmüyor; diyalog axe 0 |
| Çift tıklama ile çift kayıt | ✅ | 1 POST, 1 kayıt |
| Aynı e-posta (büyük harf) | ✅ | 409 → alan altında mesaj |
| `<script>` / `<b>` adlar | ✅ | Metin olarak kaçışlı gösterildi, çalışmadı |
| Arama `' OR 1=1 --` | ✅ | Eşleşme yok ekranı; URL'de `q`, yenilemede korunuyor |
| Yeni USER ilk giriş | ✅ | /change-password; menüde yalnız Ana sayfa; `GET /users` 403 |
| Yetki toggle değiştir + kaydet (Admin1 → Admin2 audit.export kapat) | ✅ | PATCH yalnız değişen anahtar; yenilemede kalıcı |
| Kendinde olmayan yetki kilitli (Admin2) | ✅ | aria-disabled + kilit; API ile verme 403 `fields.permissions.audit.export` |
| Daha geniş yetkili hesap salt okunur | ✅ | "düzenleme yetkiniz yok", pasife al yok |
| USER→ADMIN rol değişimi (kilitli anahtarlı Admin) | ✅ | 200; yenilemede ADMIN, audit.export kapalı, diğerleri açık (QA Tur1 #1 düzeltmesi gerçek sunucuda doğrulandı) |
| Kaydet sırasında ağ kesik (route.abort) | ✅ | "Değişiklikler kaydedilemedi. Sunucuya ulaşılamadı…", form değeri korundu |
| Pasife al → açık oturum düşer → giriş engelli → pasif filtresinde görünür → yeniden etkinleştir → giriş | ✅ | ilk koşuda pasif liste sayımı yarıştı; probe2 ile doğrulandı |
| Admin → /admin/tenants | ✅ | Uyarı ekranı; API 403 |
| AC-4 `PUT /settings/tenant` | ✅ | sessionTtlMin 10 → 400 `fields.sessionTtlMin`; 20 → 200 |
| SA firma oluştur (boş, `demo` 409, özel karakterli ad) | ✅ | |
| SA yeni firmaya geç → boş liste → kullanıcı ekle | ✅ | "Henüz kullanıcı yok" + ekle düğmesi |
| Tenant izolasyonu (Demo Admin → diğer firmanın kullanıcısı) | ✅ | API GET/PATCH 404; ekran "Kullanıcı bulunamadı" (HTTP 200, Bulgu 3) |
| SA satırdan Demo'ya geç → yalnız Demo kullanıcıları; bağlamdan çık | ✅ | probe ile doğrulandı |
| SA firmayı pasife al (kısa ad onayı) → seçicide yok, switch API 404 → yeniden etkinleştir | ✅ | |
| Çıkış yapılmış → /users, /users/[id], /admin/tenants | ✅ | /login?next=… |
| Geri tuşu (detay → liste) | ✅ | |
| Açık/koyu × 1366/375 görsel + axe | ⚠️ | axe 0; yalnız SA 375 px taşma (Bulgu 1) |

## Kabul kriterleri (uçtan uca)
| AC | ✅/❌ | Nasıl doğrulandı |
|---|---|---|
| AC-4 (aralık dışı 400) | ✅ | Gerçek API PUT /settings/tenant 10 → 400, 20 → 200 |
| AC-69 (tenant izolasyonu) | ✅ | Başka firmanın kullanıcısına GET/PATCH 404; SA Demo listesinde diğer firma kişisi yok |
| AC-70 (firma oluştur/düzenle/pasif/geçiş) | ✅ | UI akışı; pasif firma seçicide yok, geçiş 404. (Pasif firma kullanıcı girişi bu turda ayrıca denenmedi; backend int testi var) |
| AC-71 (tüm modüller, alt anahtarlar, Tümünü aç/kapat) | ✅ | 9 modül + alt anahtarlar + grup toggle ekranda (masaüstü tablo, mobil gruplu liste) |
| AC-72 (tek tanımdan üretim) | ✅ (dolaylı) | Ekrandaki anahtarlar `PERMISSION_MODULES` ile birebir; geçici anahtar testi birim/int testinde (bu turda tekrar edilmedi) |
| AC-73 (sahip olunmayan yetki verilemez; rol varsayılanları) | ✅ | Kilitli UI + API 403; ADMIN tümü açık, USER tümü kapalı başlıyor |
| AC-74 (yetki değişikliği audit) | — | Audit ekranı bu pakette yok; DB sorgusu yapılmadı (backend int testi `users-p9` kapsıyor) |
| AC-115 (deaktivasyon/yetki canlıya) | Kısmi ✅ | Pasife alınan kullanıcının panel oturumu anında düştü; canlı destek oturumu bu turda kurulmadı |

## Görsel gözlemler (ekran görüntülerinden)
- /users masaüstü: temiz tablo, "(siz)" etiketi, rozetler; mobilde kart görünümü düzgün, taşma yok.
- /users/[id] masaüstü: Profil + Yetkiler iki sütun, matris hizalı; "Diğer" sütunundaki ek anahtarlar ("Zorla sonlandır", "Kabul / ret") etiketli. Mobilde modül grupları alt alta, 44 px dokunma hedefleri.
- Koyu tema: kontrast iyi, logo açık zemin kartında (§1.5 kuralına uygun).
- Açık temada kapalı/kilitli toggle'lar soluk (Bulgu 4).
- /admin/tenants: masaüstünde satır işlemleri tek satırda; mobil kartta "Etkin firma" rozeti + işlemler iki satıra kırılıyor, düzgün. Özel karakterli firma adı ("Op Firma <b>x</b> …") metin olarak ve kısaltılarak gösteriliyor.
- SA /users firma seçilmeden: "Firma seçin" boş durumu anlaşılır.
- Mobil üst menü: SA'da taşma (Bulgu 1); etkin menü öğesi görünmüyor (Bulgu 5).
