# Changelog

Bu projedeki önemli değişiklikler bu dosyada tutulur.
Biçim [Keep a Changelog](https://keepachangelog.com/tr/1.1.0/), sürümleme [Semantic Versioning](https://semver.org/lang/tr/).

## [Unreleased]

### Eklendi — P4 (KVKK onayı + tarayıcıdan ekran paylaşımı)
- **Müşteri karşılama akışı (`/session/<token>`):** teknisyen kartı + doğrulama kodu, dolandırıcılık uyarısı,
  "Kötüye kullanımı bildir" (`mailto:`, adres yoksa gizli), ad + KVKK aydınlatma metni onayı, "Yalnız ekranımı
  tarayıcıdan paylaş" → lobi (4 haneli kabul kodu, kalan bekleme, "Vazgeç ve çık") → oturum (paylaş / durdur /
  yeniden paylaş, önizleme, onaylı bitirme) → bitiş, ret, bekleme doldu, bağlantı kesildi ekranları.
- **Paylaşım izni reddedilirse** "Paylaşım başlatılmadı" + "Tekrar dene" (AC-30). Mobil veya `getDisplayMedia`
  desteklemeyen tarayıcıda "Bu cihaz desteklenmiyor" ekranı; form gösterilmez (AC-33).
- **Teknisyen konsolu (`/sessions/<id>/console`, koyu):** üst bar (müşteri, durum, kalan süre, doğrulama kodu,
  onaylı bitir/iptal), lobi paneli (kabul kodu, kalan hak, satır başına Reddet), canlı video, görüntü modları
  Sığdır / %100 (kaydırmalı) / Tam ekran (AC-43), paylaşım durdu, müşteri koptu (120 sn) ve kendi bağlantısı koptu
  durumları. Tarayıcı modunda pasif "Uzaktan kontrol" düğmesi ve açıklaması (AC-34; kontrol P7).
- **Oturumlar listesi:** "Konsolu aç" (PENDING/ACTIVE, yalnız kendi oturumu) ve "Zorla sonlandır" (ACTIVE,
  `sessions.terminate`, onay diyaloğu).
- **WebRTC medya hattı:** teknisyen `recvonly`, misafir `sendonly` ekran izi; ses/kamera/mikrofon yok. Misafir
  kabulden sonra `reconnectToken` ile 120 sn yeniden bağlanır; teknisyen konsolu yenilense de paylaşım geri gelir.
- **KVKK onay kaydı:** migration `20261111030000_p4_consents` — `consent_texts` (tenant bazlı, sürümlü, değişmez,
  tenant başına tek güncel sürüm, `sha256 = SHA2(body,256)` CHECK) ve `session_consents` (yalnız ekleme; bileşik FK ile
  oturum, metin ve özet aynı tenant'ta). Onay, teknisyen kabulünde oturum tüketimiyle aynı işlemde yazılır (AC-29).
  Seed metni olmayan her tenant'a Türkçe KVKK metni v1 ekler.
- **API:** resolve yanıtına `consentText {id, version, body, sha256}` ve `abuseEmail` (`string | null`); join'de
  `consentTextId` zorunlu (AC-127). WS `hello` (teknisyen) `guestName` ve `share`, `peer.joined{guest}` `guestName`
  alanlarını taşır. `@remote/contracts/dc` (DataChannel etiketleri ve zarf şeması; ctl mesajları P5).
- **Audit:** `guest.pending` KVKK metin kimliği/sürümü, `guest.admitted` onay özeti (`textId`, `version`, `sha256`).
- **Yeni ortam değişkenleri:** server `ABUSE_EMAIL`; coturn `TURN_LISTEN_IPS` (`auto` = özel relay IPv4 + 127.0.0.1).
- **Gerçek sunucu e2e:** `e2e/p4-real.spec.ts` + `playwright.real.config.ts`; `pnpm --filter @remote/web e2e:real:users`
  (demo tenant'ta iki ADMIN) ve `pnpm --filter @remote/web e2e:real`. CI'da koşmaz (README "Gerçek sunucu e2e").
- **Testler:** birim 146 (server 78, web 44, contracts 24), server entegrasyon 103, TURN 62 kontrol, web e2e 116 geçti
  + 8 atlandı, gerçek sunucu e2e 5/5.

### Değişti — P4
- Boş ortam değişkeni (`ANAHTAR=`) tanımsız sayılır; varsayılanlı alan varsayılana düşer, zorunlu alan yine hata
  verir. Compose'da boş geçen `ABUSE_EMAIL`/`METRICS_TOKEN` server'ı durdurmaz.
- coturn yalnız `TURN_LISTEN_IPS` adreslerinde dinler; boşsa eski davranış (tüm arayüzler) + uyarı.
- `test-denied.sh` kota/allocation hatalarını yeniden dener; beklenen ret testleri beklemeden biter.
- DESIGN.md: Button `danger`/`danger-ghost`, CodeDisplay `xl`, Segmented `icon`, sahne, lobi paneli, konsol koyu
  teması, cihaz desteklenmiyor ve paylaşım reddedildi durumları.

### Güvenlik — P4
- **S-P4-1:** Production'da `ABUSE_EMAIL` yoksa resolve `abuseEmail: null` döner, Super Admin e-postası hiç
  sorgulanmaz (önceden platformun en yetkili hesabının e-postası her bağlantı sahibine gidiyordu). `ABUSE_EMAIL`
  `.env.example`, compose ve runbook'a eklendi.
- **S-P4-2:** `apps/web` devDependency `ws` 8.18.3 → 8.21.0 (GHSA-58qx-3vcg-4xpx); `pnpm audit` temiz.
- **S-P4-3 / S-P4-T2-1:** Müşteri adında Unicode `Cc`, `Cf`, `Zl`, `Zp`, U+034F ve U+180E reddedilir (bidi, sıfır
  genişlik, soft hyphen, etiket karakterleri dahil); kontrol kırpmadan önce yapılır. Teknisyen ekranında ve audit'te
  yanıltıcı ad gösterilemez.
- **S-P4-4:** Çıkışta sekme belleğindeki `rs.*` anahtarları (müşteri adı) silinir.
- **S-P4-T2-2:** `e2e-real-users.ts` `NODE_ENV=production` iken veya `E2E_REAL_ALLOW=1` olmadan çalışmaz.
- KVKK onayı yalnız oturumun tenant'ının güncel metniyle kabul edilir; eski sürüm, başka tenant ve bilinmeyen id aynı
  400 yanıtını alır (tenant varlığı sızmaz, G-24). Onay kaydı DB'de değiştirilemez (`app` kullanıcısında UPDATE/DELETE yok).
- `getDisplayMedia` yalnız kullanıcı tıklamasıyla çağrılır, yeniden bağlanmada otomatik paylaşım yok. Müşteri sayfası
  çerçevelenemez (`frame-ancestors 'none'`, AC-38). Ticket ve reconnect token yalnız bellekte ve subprotocol'de.
- coturn `TURN_LISTEN_IPS` değerleri IPv4 olarak tam doğrulanır, satır sonu reddedilir (yapılandırma enjeksiyonu yok).

### Düzeltildi — P4 (QA)
- QA-P4-2..5: pasif "Uzaktan kontrol" (AC-34), cihaz desteklenmiyor ekranı (AC-33), paylaşım reddinde tekrar dene
  (AC-30), konsol görüntü modları ve tam ekran (AC-43).
- QA-P4-6: `ABUSE_EMAIL` env zinciri (`.env.example`, compose, runbook).
- QA-P4-7: `docs/mimari-api.md` resolve/join satırları koda uyarlandı.
- QA-P4-8, QA-P4-9: `frame-ancestors 'none'`, doğrulama kodu eşliği ve `mailto:` bağlantısı (gizli hali dahil) e2e testli.
- QA-P4-11: gerçek sunucu e2e tekrarlanabilir kurulum betiği.
- QA-P4-12: konsol yenilenince müşteri adı ve paylaşım durumu sunucudan gelir (`hello.guestName`/`share`,
  `peer.joined.guestName`); lobide birden fazla misafir varken ad tahmin edilmez.
- QA-P4-13: DESIGN.md yeni bileşen ve durumlarla güncellendi.
- Gerçek sunucu e2e'sinin bulduğu: teknisyen yeniden bağlanınca misafir paylaşım durumunu yeniden bildirir.

### Bilinen sınırlamalar — P4
- Staging NAT/TURN-TLS ölçümleri (AC-23, 40, 42) üst NAT yönlendirmesi açılınca yapılacak, en geç P6 öncesi.
- Müşteri adı DB'ye yazılmaz (lobide bellekte ve audit'te); oturum listesinde müşteri adı yok (P8).
- Onay zaman çizelgesi (AC-62) P8'de. KVKK metninin yeni sürümünü yayımlama ekranı henüz yok; metin seed ile gelir.
- Kalite göstergesi, sohbet, dosya transferi, işaretleme P5'te; uzaktan kontrol P7'de.
- Oturum süresi dolup girişe yönlenmede sekme belleği temizlenmez (sekme kapanınca silinir, B-2).
- `e2e-real-users.ts` server imajında bulunuyor; imajdan çıkarılması devops işi olarak açık.

### Eklendi — P3 (sinyalizasyon + TURN)
- **Müşteri katılımı:** `POST /api/v1/public/sessions/join` (`joinNonce` + ad + onay → `wsTicket`, 4 haneli
  `admitCode`, teknisyen adı). Resolve yanıtına `joinNonce` ve `nonceExpiresAt` eklendi (tek kullanımlık, 60 sn).
- **WebSocket sinyalizasyonu:** `/ws/tech?sessionId=` (çerez + Origin, yalnız oturum sahibi) ve `/ws/guest`
  (subprotocol `rs.v1` + `rs.ticket.<wsTicket>` / `rs.reconnect.<token>`). Lobi (≤ 3 misafir, 5 dk), teknisyen
  kabulü (`guest.admit`) ve reddi (`guest.reject`), SDP/ICE/`share.state` aktarımı, 120 sn yeniden bağlanma,
  en uzun süre uyarısı ve bitişi, TURN bilgisi yenileme (`ice.servers`), ping/pong.
- **Sözleşme:** `@remote/contracts/ws` (zod şemaları, kapanış kodları, `session.ended` nedenleri, WS hata kodları)
  ve Go istemciyle paylaşılan `packages/contracts/fixtures/ws-messages.json`.
- **Zorla sonlandırma:** `POST /api/v1/sessions/:id/terminate` (`sessions.terminate`; odaya `session.ended{admin}`).
- **`/metrics`** (iç ağ, `METRICS_TOKEN` Bearer): WS bağlantı/ret/1008 sayaçları, admit sonuçları, biten oturumlar,
  `rs_ws_connections`, `rs_active_sessions`, `rs_active_rooms`, `rs_resolve_failed`.
- **TURN (coturn 4.18):** `deploy/turn/` ayrı compose projesi; HMAC süreli credential (`<unixExpiry>:<sessionId>`),
  TCP/UDP/TLS (5349), iç/özel adreslere relay yasağı (`denied-peer-ip`), `TURN_SECRET_PREVIOUS` ile kesintisiz
  sır değişimi, `host-firewall.sh` (relay portlarından host'un kendi servislerine UDP'yi keser; systemd timer ile
  onarılır), yerel test betikleri (`test-local.sh`, `test-denied.sh`). CI'da yeni `turn` işi.
- **Veritabanı:** migration `20261111020000_p3_session_admit`: `support_sessions.mode`, `consumed_at`,
  `terminated_by` + 5 CHECK kısıtı. Yeni tablo yok.
- **Hata kodları:** `LOBBY_FULL` (409), `NONCE_INVALID` (410).
- **Audit:** `guest.pending`, `guest.admitted`, `guest.admit` (başarısız), `guest.rejected`, `session.join`
  (başarısız), `session.ended`, `session.terminated`, `reconnect.conflict`.
- **Yeni ortam değişkenleri:** server `TURN_URLS`, `TURN_SECRET`, `TURN_CRED_TTL_MIN`, `METRICS_TOKEN`; coturn
  `TURN_SECRET_PREVIOUS`, `TURN_REALM`, `TURN_EXTERNAL_IP`, `TURN_MAX_BPS`, `TURN_BPS_CAPACITY`,
  `TURN_PROMETHEUS_ADDRESS` (`.env.example`, compose, runbook §9).
- **Bağımlılık:** `ws` 8.21.0, `@types/ws` (dev).
- **Testler:** birim 94 (server 69, web 23, contracts 2), server entegrasyon 93, TURN 62 kontrol, web e2e 97 geçti
  + 1 atlandı.

### Değişti — P3
- Public resolve ve join ADR-0012 kuralını uygular: `Origin` varsa izinli olmalı ve tür `BROWSER`; yoksa yalnız
  `AGENT` (Windows istemcisi). Join'de tür `joinNonce` kaydından gelir.
- `POST /sessions/:id/cancel` artık bağlı teknisyen ve lobi misafirlerine `session.ended{cancelled}` gönderir.
- Bekleyen oturumun süresi dolunca teknisyen ve lobi `session.ended{timeout}` alır, oda silinir.
- Sunucu açılışında yarım kalmış ACTIVE oturumlar `ENDED` (`server`) yapılır.
- Compose: server'a `TURN_URLS`/`TURN_SECRET` zorunlu, `TURN_CRED_TTL_MIN` (vars. 20), `METRICS_TOKEN` (isteğe bağlı).
- Staging ADMIN/USER hesabı `deploy/staging-users.sh` ile eklenir (runbook §6).

### Güvenlik — P3
- Token'lar URL'de taşınmaz: misafir kimliği WS subprotocol'ünde; URL'de ticket görülürse bağlantı 403.
  `joinNonce`, `wsTicket`, `reconnectToken`, `admitCode` ve TURN credential'ı log/audit'e yazılmaz (testle doğrulandı).
- Misafir, teknisyen kabul etmeden TURN bilgisi ve `reconnectToken` almaz; kabul kodu yalnız o misafire gösterilir,
  sunucu sabit zamanlı karşılaştırır, 5 hatada lobi boşaltılır.
- Oturum tüketimi tek atomik koşullu UPDATE (admit ‖ admit ve admit ‖ iptal 50'şer turda tek kazanan).
- Mesaj sınırları: şema hatası / ekstra alan / saniyede 50 mesaj aşımı → 1008, 64 KB üstü → 1009. Upgrade hız
  sınırı (`/ws/guest` ve `/ws/tech` IP başına), join IP başına 20/dk.
- Misafir yeniden bağlanması mevcut bağlantı varken reddedilir (403 + audit); teknisyenin oturumu 60 sn'de bir
  yeniden doğrulanır, geçersizse 4401.
- `ws` 8.18.3 → 8.21.0 (GHSA-96hv-2xvq-fx4p, GHSA-58qx-3vcg-4xpx); `pnpm audit` temiz.
- TURN: kısa süreli credential (vars. 20 dk), `TURN_SECRET` ≥ 32 karakter, coturn root dışı + salt okunur,
  secret komut satırında değil, CLI kapalı, Prometheus yalnız `127.0.0.1`, log 3×5 MB + haftalık temizlik.
- Test sırları tek dosyada (`apps/server/test/helpers/secrets.ts`), gitleaks allowlist'i yalnız o dosya.

### Bilinen sınırlamalar — P3
- Ekran paylaşımı ve teknisyen konsolu video arayüzü P4'te; KVKK metni doğrulaması (`consentTextId`) P4'te zorunlu olur (P4'te kapandı).
- Yetki daraltması/pasifleştirme aktif oturumu henüz sonlandırmaz (S-P3-8, P7 giriş şartı).
- Staging'de TURN'ün dışarıdan çalışması üst NAT yönlendirmesine bağlı (runbook §9.3). Prod IPv6 relay doğrulaması P13.
- `host-firewall.sh` sertleştirmeleri (S-P3-T2-1, S-P3-T2-2) prod açılışından önce kapanacak.

### Eklendi — P2 (destek oturumları)
- **Oturum uçları:** `POST /api/v1/sessions` (link + 8 haneli kod + teknisyen doğrulama kodu; link yalnız bu
  yanıtta), `GET /api/v1/sessions` (sayfalı, `status`/`technicianId` filtresi, en çok 100),
  `GET /api/v1/sessions/:id`, `POST /api/v1/sessions/:id/cancel` (yalnız PENDING). Ayrıntı `docs/api.md`.
- **Public müşteri uçları:** `POST /api/v1/public/sessions/resolve` (token veya kod; oturumu tüketmez) ve
  `GET /api/v1/public/sessions/status?ref=` (opak `sessionRef` ile durum yoklaması).
- **Sınırlar:** teknisyen başına açık oturum sınırı (tenant ayarı `max_open_sessions`, varsayılan 3) ve saatte 20
  oturum; ikisi DB'de tek işlemde sayılır (eşzamanlı isteklerde aşılamaz).
- **Süre dolumu işi:** 30 sn'de bir süresi dolan PENDING oturumları EXPIRED yapar; resolve ve durum yoklaması da
  aynı istekte günceller. Geçerlilik tenant ayarı `session_ttl_min` (15–30, varsayılan 15 dk).
- **Audit:** `session.created`, `session.cancelled`, `session.expired`, `session.resolve` (başarısız, 410 nedeni).
- **Veritabanı:** `support_sessions` tablosu (migration `20261111010000_p2_support_sessions`); aktif kod tekilliği
  indeksi, kod çakışmasında en çok 5 yeniden deneme.
- **Contracts:** `@remote/contracts/api/sessions` (zod şemaları ve yanıt tipleri); yeni hata kodları `CONFLICT`,
  `OPEN_SESSION_LIMIT` (409), `SESSION_EXPIRED`, `SESSION_CONSUMED`, `SESSION_CANCELLED` (410).
- **Web — Oturumlar ekranı (`/sessions`):** liste (durum rozeti, kod, kalan süre, Tümü/Açık/Bitmiş filtresi,
  10 sn'de bir yenileme), "Yeni destek oturumu" diyaloğu (link, kod, doğrulama kodu, kopyalama, geri sayım),
  onaylı iptal; yöneticide Teknisyen sütunu; boş/yükleniyor/hata/kısmi/yetkisiz durumları. Kenar çubuğunda
  "Oturumlar" menüsü (yalnız `sessions.view`).
- **Web — müşteri karşılama (`/session/<token>`):** teknisyen kartı + doğrulama kodu, dolandırıcılık uyarısı,
  2 sn'de bir durum yoklaması; süresi doldu / iptal edildi / kullanıldı / çok fazla deneme / geçersiz (HTTP 404)
  ekranları; `noindex`, `no-referrer`.
- **Yeni ortam değişkenleri:** `SESSION_REF_KEY`, `EDGE_PROXY_SECRET` (`.env.example`, compose, runbook §3).
- **Testler:** birim 51 (server 26, web 23, contracts 2), server entegrasyon 62, web e2e 97 geçti + 1 atlandı.

### Değişti — P2
- Compose: web sabit adres `172.30.0.3`, server `TRUSTED_PROXY_CIDR=172.30.0.2/31` (Caddy → web → server zinciri);
  `SESSION_REF_KEY` (server) ve `EDGE_PROXY_SECRET` (caddy, web) zorunlu.
- Web 401 → giriş yönlendirmesi tek yardımcıda (`lib/api.ts` `isUnauthenticated`, `EXPIRED_LOGIN_PATH`).
- `/session/<biçimsiz>` artık panel 404'ü yerine müşteri "Bağlantı geçersiz" ekranını (HTTP 404) gösterir.
- Bellek içi hız sayacı (K11/S3-1): kapasite dolunca kilidi bitmiş en eski kaydı atar; hepsi kilitliyse
  yeni kayıt eklemez ve isteği engeller (fail-closed). P1'deki "etkin kilit atılabilir" sınırlaması kapandı.

### Güvenlik — P2
- Link token'ı 32 bayt rastgele, DB'de yalnız SHA-256; token ve kod log/audit'e yazılmaz (testle doğrulandı).
- Public kod denemesi IP başına 10/dk ve /24 (IPv6 /56) önek başına 30/dk; aşan anahtar 15 dk 429. Token 30/dk/IP,
  durum yoklaması 60/dk/IP. Başarısız kod toplamı 60 sn'de 100'ü aşınca `warn` alarmı (engellemez).
- Aynı oturum + neden için 410 audit kaydı 10 dakikada bire indirildi (audit şişirmeye karşı).
- Müşteri IP'si: Caddy web'e `X-Edge-Auth` sırrı yazar; web sırrı sabit zamanlı karşılaştırır ve yalnız eşleşince
  doğrulanmış `X-Forwarded-For`'u iletir. İstemcinin gönderdiği `X-Edge-Auth` ezilir ve Caddy logundan silinir.
- Web production'da `EDGE_PROXY_SECRET` yoksa veya 32 karakterden kısaysa açılışta durur (exit 1).
- XFF gelmeden proxy adresinden resolve gelirse dakikada bir `warn` alarmı (`client_ip_is_proxy`).
- `SESSION_REF_KEY` production'da zorunlu (`env.ts`); müşteriye iletilen User-Agent 512 karaktere kırpılır.
- `lib/server-api.ts` `server-only`; başka tenant'ın / başka teknisyenin oturumu 404 (tenant ayrımı testi "list"
  sınıfıyla genişletildi).

### Bilinen sınırlamalar — P2
- Tenant logosu ve teknisyen avatarı `null` (P9/P12); TTL ve açık oturum sınırı ayar ekranı P9/P10.
- Super Admin tenant seçmeden destek oturumu açamaz (P9). Seed teknisyen oluşturmaz; staging'de teknisyen
  hesabı P9'a kadar SQL ile eklenir.
- Açık kalan güvenlik maddeleri ve P3 giriş şartları: `docs/gereksinimler.md` §9 "Sonra / açık".

## P1 (ince iskelet, sürüm etiketi yok)

### Eklendi — P1 (ince iskelet)
- **Monorepo:** pnpm 9 workspace; `apps/server`, `apps/web`, `packages/contracts`.
- **Contracts:** tek yetki tanımı (`permissions.ts`, rol varsayılanları: Super Admin tümü, Admin varsayılan
  açık, User varsayılan kapalı), hata kodu → HTTP eşlemesi ve hata zarfı (`errors.ts`), auth girdi şemaları
  ve çerez/başlık adları (`api/auth.ts`).
- **Server (Fastify 5):** zod ile doğrulanan ortam değişkenleri, JSON log (pino, `X-Request-Id`), standart
  hata zarfı, `/health` ve `/ready` (DB + son migration).
- **Auth uçları:** `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`,
  `POST /api/v1/auth/password/change` (ayrıntı `docs/api.md`).
- **Oturum:** opak DB oturumu (mutlak 8 sa, boşta 30 dk); ilk girişte zorunlu şifre değişimi kapısı.
- **Yetki/tenant altyapısı:** `requireAuth`, `requirePerm`, `tenantScope` guard'ları; tüm uçları
  `public|self|tenant` olarak sınıflandırmayı zorunlu kılan tenant ayrımı test aracı.
- **Audit log yazımı:** giriş/çıkış/kilit/şifre değişimi ve seed kayıtları; izinli/kara liste maskeleme.
- **Veritabanı (MySQL 8.4, Prisma 7):** `tenants`, `tenant_settings`, `users`, `user_permissions`,
  `auth_sessions`, `audit_logs` tabloları; CHECK kısıtları; elle geri alma (`down.sql`).
- **DB kullanıcıları:** `migrator` (yalnız `migrate` servisi) ve `app` (tablo bazlı yetki; `audit_logs`
  yalnız SELECT/INSERT); yetki kontrol betiği `deploy/mysql/check-app-grants.sh`.
- **Seed:** ilk Super Admin (`SEED_SUPERADMIN_*`, idempotent); production dışı ortamda `demo` tenant.
- **Web (Next.js 16):** login sayfası (sistem logosu), şifre değiştirme, boş panel kabuğu (üst menü, kenar
  çubuğu, çıkış), 404/500 sayfaları, yükleniyor iskeleti, Nokta favicon seti; sistem temasına uyan açık/koyu
  görünüm; WCAG 2.1 AA (axe) kontrollü.
- **Deploy:** Docker Compose yığını (caddy, web, server, migrate, seed, mysql); Caddy tek TLS girişi
  (4450/tcp, `tls internal`); staging hedefi 185.126.217.99:4450.
- **CI:** lint, typecheck, birim + entegrasyon testi (MySQL servisi), Playwright e2e, Docker build,
  `pnpm audit`, lisans denetimi, gitleaks; Dependabot.
- **Belgeler:** `README.md`, `docs/api.md`, `docs/runbook.md`, `docs/db-notlari.md`, bu dosya, `LICENSE`.

### Güvenlik
- Şifreler argon2id (m=19456, t=2, p=1); oturum token'ı DB'de yalnız SHA-256.
- Çerezler `__Host-rs_session` (HttpOnly) ve `__Host-rs_csrf`; ikisi Secure, SameSite=Strict, Path=/, Domain yok.
- CSRF: durum değiştiren isteklerde `Origin` allowlist zorunlu (login dahil) + `X-CSRF-Token` double-submit.
- Giriş kilidi: hesap+IP 5 hata → 15 dk; hesap geneli 1 saatte 20 hata → 15 dk (atomik DB sayacı);
  IP başına 20 deneme/dk (429). Var olmayan hesapta aynı davranış; yanıtlar hesap varlığını sızdırmaz.
- Bellek içi sayaçlar kayıt sayısıyla sınırlı (50.000) ve arka planda temizlenir.
- Şifre değişiminde mevcut dahil tüm oturumlar iptal edilir, yeni oturum çerezi verilir; oturum başına
  5 hatalı mevcut şifre oturumu sonlandırır.
- Başarılı girişte aynı tarayıcının eski oturumu iptal edilir.
- Login sonrası yönlendirmede (`?next=`) açık yönlendirme engellenir; `next`'e sorgu dizesi ve
  `/session/` yolları yazılmaz.
- CSP (nonce'lu, uygulama üretir), HSTS, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`;
  `Server`/`X-Powered-By` başlıkları kaldırıldı.
- Caddy logu sorgu dizesi, çerez, `Authorization`, CSRF başlığı, `Referer`, `Location`, `Set-Cookie` ve
  WebSocket subprotocol yazmaz; `/session/<token>` maskelenir. Uygulama logları da gizli değer içermez.
- X-Forwarded-For yalnız Caddy'nin sabit adresinden kabul edilir.
- Konteynerler salt okunur, `cap_drop: ALL`, `no-new-privileges`, uid 1000; MySQL portu yayımlanmaz, DB ağı internetsiz.
- İmajlar `etiket@sha256` ile, GitHub Action'lar commit SHA ile sabitlendi; `permissions: contents: read`.
- `minimatch` GHSA-g3hv-75wg-m249 için `pnpm.overrides` (^11.0.1).

### Bilinen sınırlamalar
- Hesap kilidi bildirim e-postası, 2FA ve tüm cihazlardan çıkış P10'da.
- Kullanıcı tema tercihi P12'de; P1 yalnız işletim sistemi temasına uyar.
- Yönetim ekranları (kullanıcı, yetki, tenant, ayarlar, audit log) P9–P11'de.
- Bellek sayaç sınırı dolduğunda etkin bir kilit kaydı atılabilir (S3-1) — P2'de kapandı (bkz. Değişti — P2).
