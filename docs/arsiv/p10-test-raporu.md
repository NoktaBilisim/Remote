# Test Raporu — Tur P10 (hesap güvenliği + SMTP)
DURUM: GEÇTİ (ENGELLEYİCİ/YÜKSEK yok, tüm P10 AC'leri ✅; 1 ORTA + 3 DÜŞÜK bulgu, P11 öncesi düzeltilmesi önerilir)
Ortam: YEREL — web standalone `http://localhost:3238` → gerçek `apps/server` (:3313, `NODE_ENV=development`, `APP_ENCRYPTION_KEYS`
koşu başına rastgele, hiçbir yere yazılmadı) → geçici MySQL `rs-mysql-p10op:33336` (seed + 2 ADMIN, parolalar rastgele).
Sahte SMTP: `smtp-server` ile `127.0.0.1:2525` (kimliksiz, STARTTLS yok); iletiler yalnız geçici klasöre yazıldı.
Kod: `main` beb97ea + çalışma ağacı (P10 commit edilmemiş). Tarih: 2026-11-12. Staging'e bağlanılmadı, ACCESS/parola dosyası okunmadı.
Ortam kapatıldı (server, web, sahte SMTP, DB konteyneri silindi; storageState/sır dosyası/anlık görüntü silindi).

Betikler: `docs/test-raporu/e2e/p10/` — `setup.sh up|down`, `op-server.ts`, `smtp-sink.mjs`, `mail.mjs`, `totp.mjs` (RFC 6238),
`lib.mjs`, `flow1..5.mjs`, `scan.mjs`, `probe-abort.mjs`; sonuçlar `flow.jsonl`, `scan.jsonl`, ekranlar `img/` (84 adet; QR, anahtar ve
kurtarma kodları maskeli).

**Test düzeneği notu (netguard):** Üretim netguard'ı 127.0.0.1'i (ve `PUBLIC_BASE_URL` hostunu) engellediği için gerçek gönderim
yerelde ancak `op-server.ts` ile denenebildi: `buildApp`'e yalnız `127.0.0.1`'e izin veren bir netguard verildi ("smtp.op.test" →
127.0.0.1), diğer tüm özel/iç ağ kuralları aynen geçerli. Kod değiştirilmedi; `server.ts` ile tek fark bu. Dolayısıyla loopback reddi
(AC-122'nin "loopback" kısmı) bu turda arayüzden doğrulanamadı — backend entegrasyon testlerine dayanır; 10/8, 192.168/16,
169.254/16, 100.64/10, 172.17/16, `[::1]` ve çözümlenemeyen ad arayüzden doğrulandı.

## Özet
| Ölçüt | Değer |
|---|---|
| Taranan sayfa | 13 rota × açık/koyu × 1366/375 = 52 görünüm (panel 9: `/`, `/account`, `/settings/smtp`, `/settings/security`, `/settings/support-requests`, `/sessions`, `/users`, `/requests`, `/history`; herkese açık 4: `/login`, `/forgot-password`, `/reset-password`, `/reset-password#token=…`) + akış ekranları (`/2fa/setup`, `/login/2fa`, diyaloglar) |
| Açılamayan / 5xx | 0 / 0 |
| JS hatası (pageerror) | 0 |
| Konsol hatası | Yalnız kasıtlı tetiklenen 400/401/403/429 ağ satırları (hatalı kod, iç ağ adresi, yarı oturumda API, test sınırı) |
| Server log error/fatal | 0 (warn: 5 × "SMTP gönderimi başarısız" — kasıtlı; 1 × Windows istemcisi yapılandırılmamış — yerel ortam) |
| axe (WCAG 2.1 AA) | 52 tarama görünümü + 2FA kurulum (1366/375), kurtarma kodları, /login/2fa, SMTP test diyaloğu, yeni oturum diyaloğu, şifremi unuttum: **0 ihlal** |
| Mobil taşma (375 px, sayfa) | 0 (alt menü kırpılması bkz. Bulgu 2 — kaydırılabilir kap içinde) |
| Kırık iç link | 0 |
| > 3 sn açılan | 0 (tümü 0,54–0,69 sn) |
| Akış adımı | 26 adım; ilk koşuda 5 "kaldı" betik hatasıydı (seçici/durum sırası), düzeltilip tekrar koşuldu → tümü geçti |

## Bulgular (öncelik sırasıyla)

### [ORTA] SMTP/e-posta test diyaloğu bekleme sırasında Esc ile kapanıyor; sonuç kayboluyor, kullanıcı bilgilendirilmiyor
Sayfa/akış: `/settings/smtp` → "Test Maili Gönder" (aynı bileşen `/settings/support-requests` e-posta kanalı testinde).
Adımlar: 1. Ulaşılamayan/uyumsuz bir SMTP kaydedin (ör. TLS seçili, sunucu STARTTLS sunmuyor). 2. "Test Maili Gönder" → alıcı → Gönder.
3. Bekleme sırasında Esc'ye basın.
Beklenen: Gönderim sürerken diyalog açık kalır (Kapat düğmesi zaten pasif) ya da kapanırsa sonuç toast ile bildirilir; bekleme
süresi kullanıcıya söylenir.
Gerçekleşen: Başarısız test **12,4 sn** sürüyor (B-P10-1 tavanı, tasarım gereği). Bu sürede yalnız düğmede dönen simge var
(`aria-busy=true`, alan ve Kapat pasif), "en fazla ~15 sn sürebilir" gibi bir metin yok — kullanıcı takıldığını düşünebilir.
Esc'ye basınca yerel `<dialog>` kapanıyor (Kapat pasifken bile); sonuç hiçbir yerde gösterilmiyor, istek arka planda sürüyor ve
dakikalık 5 test kotasından düşüyor; kullanıcı tekrar dener → kotaya erken takılır.
Kök neden: `components/account/mail-test-dialog.tsx:29` `close()` meşgulken erken dönüyor ama `:62` `Dialog`'a `onDismiss`
verilmiyor; `components/ui/dialog.tsx:66-70` `onCancel` yalnız `onDismiss` varsa `preventDefault` ediyor → tarayıcı Esc'de
diyaloğu kapatıyor, React `open` durumu `true` kalıyor. Olası yan etki (bu turda doğrulanmadı): durum `true` kaldığı için sonraki
"Test Maili Gönder" tıklaması diyaloğu yeniden açmayabilir (`dialog.tsx:44-51` effect `open` değişmedikçe koşmaz).
Öneri: `MailTestDialog`'a meşgulken hiçbir şey yapmayan `onDismiss` verin; bekleme sırasında "Sunucuya bağlanılıyor, en fazla 15 sn
sürebilir" yardım metni gösterin.
Kanıt: `img/smtp-test-waiting-1s.png`, `img/smtp-test-waiting-7s.png`, `flow.jsonl` adım "11 …" (Esc ile kapandı=true, sonuç "-"),
adım "11b" (12 391 ms, genel mesaj).
Atanan: frontend-dev

### [DÜŞÜK] Ayarlar alt menüsü 375 px'te "Güvenlik" sekmesini kırpıyor
Sayfa: `/settings/*`, 375 px, açık ve koyu.
Adımlar: 1. Admin ile 375×800'de `/settings/smtp` açın.
Beklenen: üç sekme görünür ya da kaydırılabildiği anlaşılır (gölge/ok, daha kısa etiket).
Gerçekleşen: "Destek talepleri" ve "E-posta (SMTP)" sığıyor; "Güvenlik" yalnız kalkan simgesi kenarda görünüyor, metin kırpık.
Kap `overflow-x-auto` olduğu için sayfa taşmıyor ama kaydırma ipucu yok; mobil kullanıcı Güvenlik ayarını bulamayabilir.
Kanıt: `img/scan-dark-m375-_settings_smtp.png`, `img/scan-light-m375-_settings_smtp.png`.
Yer: `apps/web/app/(panel)/settings/settings-tabs.tsx:19`. Atanan: frontend-dev

### [DÜŞÜK] Hiç giriş yapmamış ziyaretçi `/login/2fa`'ya gidince "Oturumunuz sona erdi" görüyor
Adımlar: 1. Çerezsiz yeni tarayıcıda `/login/2fa` açın.
Beklenen: `/login` (mesajsız) veya `?next=` ile giriş.  Gerçekleşen: `/login?reason=expired` → "Oturumunuz sona erdi. Lütfen tekrar
giriş yapın." (diğer korumalı sayfalar doğru biçimde `/login?next=…` veriyor).
Yer: `apps/web/app/(auth)/login/2fa/page.tsx:17` (`EXPIRED_LOGIN_PATH`). Kanıt: `scan.jsonl` summary `un`. Atanan: frontend-dev

### [DÜŞÜK] Kurtarma kodu tire çevresinde boşlukla yazılınca istemcide reddediliyor
Adımlar: 1. `/login/2fa` → "Kurtarma kodu kullan" 2. `ABCDE - 12345` biçiminde (13 karakter) geçerli bir kod girin.
Beklenen: sözleşme yorumu "tire/boşluk ve büyük/küçük harf yok sayılır" diyor; sunucu `normalizeRecoveryCode` boşlukları siliyor.
Gerçekleşen: istemci şeması `max(12)` normalize etmeden uzunluk ölçtüğü için "Kurtarma kodu geçersiz"; istek gitmiyor.
Uç durum (kodlar kopyala/indir ile verilir); düzeltmesi tek satır (önce boşluk/tire silip sonra uzunluk).
Yer: `packages/contracts/src/api/auth.ts:88-92` (`recoveryCodeSchema`). Kanıt: `flow.jsonl` adım "4 …". Atanan: backend-dev (contracts)

### Bilgi (bulgu değil)
- B-1: Sunucu tarafında render edilen sayfalarda (`/settings/smtp`, `/settings/security`, `/account`) tarayıcıdan `route.fulfill(500)`
  ilk yüklemeyi etkilemiyor (veri SSR'da çekiliyor); ilk yükleme hata ekranı bu turda gözlenemedi. Kaydetmede ağ kesintisi doğrulandı:
  "Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin." + kaydet çubuğu duruyor; güvenlik anahtarı eski değerine dönüyor.
- B-2: Yerel MySQL CLI'nin varsayılan karakter kümesi yüzünden audit `subject` alanı `?` ile görünüyor — veri değil, istemci ayarı
  (`--default-character-set=utf8mb4` ile doğru).
- B-3: `/settings/smtp` kayıtlı şifre varken şifre alanında 8 nokta yer tutucu + "Kayıtlı bir şifre var; değiştirmek için yazın."
  ipucu var; `value` boş, GET yanıtında şifre yok (`hasPassword` bayrağı), boş bırakınca PUT gövdesinde `password` yok. Doğru davranış.

## Akış sonuçları
| # | Akış | Sonuç | Not |
|---|---|---|---|
| 1 | Admin ilk giriş → zorunlu 2FA kapısı | ✅ | `/users`, `/account`, `/settings/smtp`, `/` → `/2fa/setup`; API 403; axe 0 |
| 2 | Kurulum: QR + elle anahtar (32 karakter, 4'lü grup), hatalı kod, doğru TOTP → 10 tekil kurtarma kodu, "Kaydettim" işaretlenmeden "Devam" pasif, `.txt` (10/10 kod) | ✅ | Geri tuşunda kodlar tekrar görünmüyor |
| 3 | Çıkış → giriş → `/login/2fa`; yarı oturumda `/sessions` → `/login/2fa`, API 403; hatalı kod alan hatası + alan temizlenir; doğru TOTP → panel | ✅ | |
| 4 | Kurtarma koduyla giriş; aynı kod 2. kez "hatalı ya da daha önce kullanılmış"; `/account` "Kullanılmamış kurtarma kodu: 9" | ✅ | Boşluklu yazım: Bulgu 4 |
| 5 | `/settings/smtp` ayarsız: uyarı, test pasif, alt menü `aria-current` | ✅ | |
| 6 | Güvenlik → port (SSL 465, TLS 587, Yok 25); "Yok"ta kullanıcı/şifre pasif + boş + açıklama; TLS'e dönünce değer geri; 2525 korunur; port seçenekleri 25/465/587/2525 | ✅ | |
| 7 | İç ağ adresleri genel mesajla reddedilir ("Bu sunucu adresi kullanılamaz.", 400) | ✅ | loopback düzenek gereği denenmedi |
| 8 | Geçerli kayıt; yenileme sonrası kalıcı | ✅ | "Yok" gövdesi `user:""`, `password` yok |
| 9 | Test maili: alıcı sorulur (odakta, boş → hata), başarı 216 ms, sahte SMTP'ye ulaştı | ✅ | |
| 10 | TLS + kimlik kaydı; şifre forma/GET'e geri yazılmaz; boşken korunur | ✅ | audit'te `smtpPassword: "***"` |
| 11 | Hatalı yapılandırmada test: tek genel mesaj, 12,4 sn | ✅ / UX | Bulgu 1 |
| 12 | Kirliyken test pasif; menüden ayrılmada "Kaydedilmemiş değişiklikler var" uygulama diyaloğu | ✅ | |
| 13 | Test sınırı 5/dk/tenant → 6.'da "Çok fazla istek…" (429) | ✅ | |
| 14 | Şifremi unuttum: kayıtlı/kayıtsız aynı 202 + aynı metin (~40 ms ikisi de); mail yalnız kayıtlıya; link → token adres çubuğundan silinir; kısa şifre "en az 12 karakter"; başarı → `/login?reason=reset`; sıfırlama diğer oturumu düşürür (401); aynı link 2. kez → geçersiz ekranı; yeni şifre + TOTP → panel | ✅ | |
| 15 | `/account` şifre değiştir: eşleşmeyen, hatalı mevcut, başarı (sayfada kalır, toast, alanlar temizlenir) | ✅ | |
| 16 | Tüm cihazlardan çıkış: onay diyaloğu (odak Vazgeç), toast "Diğer cihazlardaki 1 oturum kapatıldı", 2. tarayıcı 31 ms'de 401 → `/login?reason=expired`, mevcut oturum açık | ✅ | AC-68 "5 sn" |
| 17 | `/settings/security` teknisyen 2FA zorunlu anahtarı kalıcı | ✅ | Ağ kesintisinde geri döner |
| 18 | Admin USER oluşturur → USER ilk giriş `/change-password` → zorunlu `/2fa/setup` (kapıdan `/sessions` geri döner) → kurulum (375 px, taşma 0, axe 0) | ✅ | |
| 19 | Admin USER'ın 2FA'sını sıfırlar: onaylı diyalog (odak Vazgeç), "Etkin" → "Etkin değil", düğme kalkar; USER oturumu 401; kendi kaydında düğme yok; USER yeniden girişte kurulum kapısı | ✅ | AC-115 |
| 20 | Oturum linki e-postası: boş/`<script>` alıcı reddi; "Bağlantı … adresine gönderildi."; mailde teknisyen adı, firma, link, kod, son geçerlilik (Türkiye saati), logo | ✅ | SMTP bozukken genel hata mesajı satır içinde |
| 21 | Talep ayarları e-posta kanalı: alıcı küçük harfe çevrilir, kaydedilir, test maili sahte SMTP'ye ulaştı | ✅ | AC-151 |
| 22 | Boşta kalma: `last_seen_at` DB'de 31 dk geri + sekme saati 32 dk ileri → sekme kendiliğinden `/login?reason=expired`, "Oturumunuz sona erdi" | ✅ | süre kısaltılamadığı için DB + `page.clock` |
| 23 | Çıkış yapmış ziyaretçi korumalı P10 sayfaları → `/login?next=…` | ✅ | `/login/2fa` için Bulgu 3 |
| 24 | Kaydetmede ağ kesintisi (SMTP, güvenlik anahtarı) | ✅ | Bilgi B-1 |
| 25 | Audit: `auth.mfa_*`, `auth.logout_all`, `auth.password_reset(_requested)`, `mail.sent` (alıcı maskeli, konu, sonuç), `settings.smtp.test`, `tenant_settings.updated` (şifre `***`), `user.mfa_reset` | ✅ | DB'den sayıldı |
| 26 | Çift tıklama ile çift kayıt / geri tuşu | ✅ | Kurtarma kodları geri tuşunda gelmiyor; şifre/SMTP kayıtları idempotent PUT |

## Kabul kriterleri (uçtan uca)
| AC | Durum | Nasıl doğrulandı |
|---|---|---|
| AC-10 | ✅ | Akış 20: gerçek mail (sahte SMTP) içeriği + sonuç satırı + audit `session.email`/`mail.sent`; saatlik 20 sınırı bu turda tetiklenmedi (mock e2e ve backend testinde var) |
| AC-66 | ✅ | Akış 14, 15, 18 (zorunlu şifre değişimi, sıfırlama linki tek kullanımlık; 30 dk süre sonu bu turda beklenmedi) |
| AC-67 | ✅ | Akış 1–4, 17–19 (Admin zorunlu, teknisyen tenant ayarıyla zorunlu, 10 tek kullanımlık kod) |
| AC-68 | ✅ | Akış 16 (≤ 5 sn: 31 ms), 22 (30 dk boşta). 8 sa mutlak sınır denenmedi |
| AC-79 | ✅ | Akış 5, 6, 8, 10 |
| AC-80 | ✅ | Akış 9, 11 + audit `settings.smtp.test`/`mail.sent` |
| AC-115 | ✅ (kısmen) | Akış 16, 19: oturumlar düşüyor. Canlı destek oturumunun 5 sn'de sonlanması (WS) bu turda denenmedi — backend entegrasyon testleri |
| AC-122 | ✅ | Akış 7, 13 (özel/CGNAT/link-local/Docker/IPv6 loopback reddi + 5/dk). IPv4 loopback düzenek gereği denenmedi |
| AC-151 | ✅ | Akış 21 (60 sn içinde gönderim: test maili anında; gerçek talep tetikli gönderim denenmedi) |

## Görsel gözlemler (ekran görüntülerinden)
- `/2fa/setup` (1366): logo açık kartta, sarı "zorunlu" uyarısı, numaralı adımlar, QR `logo-surface` kartında; düzgün hizalı
  (`img/setup-desktop.png`). 375 px kurulum ve kurtarma kodları ekranı taşmasız (`img/setup-m375.png`, `img/recovery-m375.png`).
- `/account` koyu 375 px: profil, şifre, 2FA ("Etkin" yeşil, kalan kod), oturumlar kartları okunaklı; "Tüm cihazlardan çıkış" kırmızı
  çerçeveli ikincil düğme (`img/scan-dark-m375-_account.png`).
- `/settings/smtp` koyu 375 px: form tek sütuna iniyor, sarı uyarı koyu temada okunaklı; alt menüde "Güvenlik" kırpık (Bulgu 2).
  Sayfa alt başlığı ile ilk kart arasında boşluk çok dar (yalnız 375 px'te dikkat çekiyor; kozmetik).
- SMTP test diyaloğu bekleme: arka plan karartılmış, yalnız düğmede dönen simge (Bulgu 1) (`img/smtp-test-waiting-7s.png`).
- Tam sayfa ekran görüntülerinde yapışkan üst menünün sayfa ortasında görünmesi Playwright `fullPage` kaynaklıdır, uygulama hatası değil.
- Açık/koyu temada axe kontrast ihlali yok.

## Denenmeyenler
8 sa mutlak oturum sınırı; sıfırlama linkinin 30 dk sonra geçersizleşmesi (beklenmedi); oturum linki e-postasının 20/sa sınırı (gerçek
sunucuda); canlı destek oturumunun logout-all/2FA sıfırlamada WS üzerinden 5 sn'de kapanması; SSL/TLS ile gerçek başarılı gönderim
(sahte sunucuda sertifika yok); Super Admin ile firma seçmeli SMTP ekranı; hesap kilidi bildirim e-postası.
