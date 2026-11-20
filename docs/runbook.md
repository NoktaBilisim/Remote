# Runbook — Remote Support (P1–P13a)

Sahibi: devops. Kapsam P1: kurulum, başlatma/durdurma, env, log, migrate/seed. Yedek, alarm, rollback
provası, TURN, sertifika yenileme P3/P13'te eklenecek. Mimari: `docs/mimari.md` §8.

## 1. Bileşenler

| Servis  | İmaj                                               | Ağ                          | Dış port                       | Not                                                                                                       |
| ------- | -------------------------------------------------- | --------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| caddy   | `caddy:2.11.9-alpine`                              | edge (sabit 172.30.0.2)     | **4450/tcp**, `127.0.0.1:4451` | 4450: TLS (`tls internal`, IP girişi); 4451: host nginx arkası düz HTTP (§8.3); yönlendirme, log filtresi |
| web     | `remote-web` (apps/web/Dockerfile)                 | edge (sabit 172.30.0.3)     | —                              | Next.js :3000                                                                                             |
| server  | `remote-server` (apps/server/Dockerfile `runtime`) | edge + db                   | —                              | Fastify :3001, `/health` `/ready`; volume `uploads` → `/data/uploads` (P12, rw)                           |
| migrate | `remote-migrate` (`migrate` hedefi)                | db                          | —                              | tek seferlik; `migrator` kullanıcısı                                                                      |
| seed    | `remote-migrate`                                   | db                          | —                              | profil `setup`, elle                                                                                      |
| mysql   | `mysql:8.4.13`                                     | db (internal, internet yok) | —                              | volume `mysql_data`, UTC                                                                                  |

`/health`, `/ready`, `/metrics` dışarıdan 404'tür (Caddy). Kontrol konteyner içinden yapılır (§5).

**İstemci IP zinciri (G-11).** Caddy, istemcinin gönderdiği `X-Forwarded-For`'u yok sayıp gerçek
bağlantı adresiyle yeniden yazar (`trusted_proxies` yok). Müşteri sayfası (`/session/<token>`) resolve
çağrısını web konteynerinden server'a yapar ve Caddy'nin XFF'ini iletir. Server `TRUSTED_PROXY_CIDR=172.30.0.2/31`
ile yalnız caddy (.2) ve web (.3) adresinden gelen XFF'e güvenir, zinciri sağdan okur. web/server portu
yayımlanmaz; edge ağında başka servis yoktur. Edge alt ağı değişirse iki sabit adres ve CIDR birlikte değişir.
**Edge sırrı (S-P2-1).** Caddy web'e giden her isteğe `X-Edge-Auth: $EDGE_PROXY_SECRET` yazar. İstemcinin
gönderdiği aynı ad başlık ezilir. `/api` ve `/ws` isteklerinde bu başlık silinir. Web, XFF'i yalnız bu başlık
sabit zamanlı karşılaştırmada eşleşirse iletir; iletirken yalnız ilk öğeyi (Caddy'nin yazdığı) ve yalnız geçerli
bir IP ise gönderir. Eşleşme yoksa (ör. edge ağından `web:3000`'e doğrudan istek) XFF gönderilmez ve audit'e
web adresi (`172.30.0.3`) yazılır, taklit edilen IP yazılmaz. Web ayrıca müşterinin `User-Agent`'ını en çok 512
karaktere kırparak iletir. Server bu değeri audit'e 300 karaktere kadar yazar. Sır hiçbir logda yer almaz;
Caddy log filtresi istemcinin gönderdiği `X-Edge-Auth` başlığını da siler.
**Edge ağına yeni servis EKLENMEZ.** Edge'deki her konteyner server'ın güvendiği web'e doğrudan ulaşır.
Yeni bir servis gerekirse ayrı bir ağ açılır.
Kontrol: `docker compose exec mysql mysql -uroot -p -e "SELECT ip_address, action FROM $MYSQL_DATABASE.audit_logs ORDER BY id DESC LIMIT 10"` → müşteri IP'si görünmeli, `172.30.0.x` değil (istek logunda IP alanı yok).

## 2. İlk kurulum (temiz makine)

Gereksinim: Docker Engine 27+, Compose v2. Staging host güvenlik duvarında yalnız 22 ve 4450 açık (mimari §8.3).

```bash
git clone <repo> remote && cd remote/deploy
cp ../.env.example .env && chmod 600 .env     # değerleri §3'e göre doldur
docker compose build
docker compose up -d                          # mysql -> migrate -> server -> web -> caddy
docker compose --profile setup run --rm seed  # ilk Super Admin (bir kez; tekrar çalıştırmak zararsız)
docker compose ps                             # migrate "exited (0)", diğerleri "healthy"/"running"
```

Beklenen: `server` ≤ 120 sn içinde healthy (yerel ölçüm: mysql ilk init dahil ~60 sn, server 14 sn).
**Temiz kurulum kaydı (AC-88, K26; mimari-p13 §5).** Yöntem: imaj önbelleği ve volume'u olmayan Docker (temiz Ubuntu 24.04
VM; yoksa `docker:29-dind` kabı, `/var/lib/docker` ayrı volume'da). Uygulama imajları (`remote-{server,web,migrate}:<tag>`)
`docker save | docker load` ile, `mysql`/`caddy`/`coturn` digest'le **önceden** çekilir (çekme/derleme süresi ölçüme girmez).
`deploy/.env` §3'e göre doldurulur (`MYSQL_BACKUP_PASSWORD` dahil). Ölçüm:

```bash
t0=$(date +%s); docker compose up -d --no-build
until docker compose exec -T server node -e "fetch('http://127.0.0.1:3001/ready').then(r=>process.exit(r.status===200?0:1),()=>process.exit(1))" 2>/dev/null; do sleep 1; done
echo "ready=$(( $(date +%s) - t0 ))s"     # hedef ≤ 120
cd turn && docker compose up -d && docker compose ps     # coturn ayrı compose (ADR-0007, K26); healthy
# HMAC credential (server algoritması): pozitif allocation + yanlış secret negatif
u="$(( $(date +%s) + 600 )):ac88"; p="$(printf %s "$u" | openssl dgst -sha1 -hmac "$TURN_SECRET" -binary | base64)"
docker run --rm --network host --entrypoint turnutils_uclient coturn/coturn:4.18.0-alpine -u "$u" -w "$p" -n 1 -m 1 -c -e 127.0.0.1 127.0.0.1   # "Total lost packets 0"
```

| Tarih                                             | Ortam                                                                                                                                                               | Commit / tag                                | `up -d` → `/ready` 200                                                                                                                                        | coturn HMAC                                                                                                                                                                       | Not                                                                                                                                                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-11-14                                        | yerel `docker:29-dind` (Docker Desktop arm64)                                                                                                                       | `0f06d7d` + P13a çalışma ağacı / `p13a-t1`  | yarıda kaldı                                                                                                                                                  | —                                                                                                                                                                                 | dind iç `/var/lib/docker` katmanında I/O hatası → Docker Desktop VM diski salt okunur oldu (Docker yeniden başlatılarak düzeldi). **dind bu makinede kullanılmaz**                                                                               |
| 2026-11-14                                        | yerel Docker Desktop 29.8 (arm64), ayrı compose projesi `rsp13ae2e` (yeni volume'lar, imajlar önceden derli, mysql `user: mysql` override — QA-P5-6, caddy portsuz) | `0f06d7d` + P13a çalışma ağacı / `p13a-e2e` | **28 sn** (`up -d` dönüşü 28 sn; mysql healthy 26 sn, server healthy +11 sn; `/ready` → `200 {"status":"ready","migration":"20261114120000_p13a_retention"}`) | `deploy/turn/test-local.sh` (ayrı compose `remote-turn-test`): HMAC UDP/TCP/TLS allocation + yanlış secret/süresi geçmiş red + denied-peer-ip → **62 PASS / 0 FAIL** (2 dk 46 sn) | Hedef ≤ 120 sn **GEÇTİ** (yerel). Staging/prod temiz VM tekrarı P13b (§18.7/7). Not: coturn testi uygulama yığını ayaktayken çalıştırılırsa yığının otomatik `db` ağı (172.31.0.0/16) testin 172.31.250.0/24 ağıyla çakışır → sırayla çalıştırın |
| 2026-11-14 (güvenlik düzeltmeleri sonrası tekrar) | aynı yöntem, compose `rsp13ae2e` (`db` ağı sabit alt ağ — otomatik havuz 172.30.0.0/16 alıp `edge` ile çakışabiliyor; yalnız yerel override)                        | `0f06d7d` + P13a çalışma ağacı / `p13a-e2e` | **20 sn**                                                                                                                                                     | (önceki satır)                                                                                                                                                                    | GEÇTİ                                                                                                                                                                                                                                            |

Tarayıcı: `https://<SITE_HOST>:4450`. `tls internal` kök sertifikası test makinesine kurulur:
`docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt` → işletim sistemi
"Güvenilen kök sertifikalar"a eklenir. (Gerçek müşteri staging'e bağlanmaz.)

## 3. Ortam değişkenleri (`deploy/.env`, git-ignore; anahtar listesi `.env.example`)

| Değişken                                                               | Nasıl üretilir / değer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MYSQL_ROOT_PASSWORD`, `MYSQL_APP_PASSWORD`, `MYSQL_MIGRATOR_PASSWORD` | `openssl rand -hex 24` (yalnız harf/rakam: URL'ye gömülür, tırnak/ters bölü yasak)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `MYSQL_DATABASE`                                                       | `remote`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `MYSQL_BACKUP_PASSWORD`                                                | P13a: `openssl rand -hex 24` (≥ 16; harf/rakam). `'backup'@'localhost'` yedek kullanıcısının parolası (SELECT, SHOW VIEW, TRIGGER). **Yalnız `mysql` servisine** verilir; server/migrate görmez, `env.ts`'te yoktur. Boşsa yeni kurulumda kullanıcı oluşturulmaz ve yedek FAILED olur. Mevcut kurulumda ekleme/değişim: `.env` → `docker compose up -d mysql` → `deploy/mysql/backup-user.sql` (§18.7/3–4; idempotent, parolayı günceller). Yedeği parola kasasında                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `PUBLIC_BASE_URL`                                                      | staging `https://185.126.217.99:4450`, yerel `https://localhost:4450`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `SESSION_REF_KEY`                                                      | `openssl rand -base64 48` (≥ 32 karakter). Oturum linklerindeki `sessionRef`'in HMAC anahtarı; compose'da zorunlu. Değiştirilirse/boş kalırsa (compose dışı) mevcut `sessionRef`'ler 404 olur — açık oturum yokken değiştirin; yedeği parola kasasında                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `EDGE_PROXY_SECRET`                                                    | `openssl rand -base64 32` (≥ 32 karakter). Caddy → web `X-Edge-Auth` sırrı. Compose'da caddy ve web için zorunlu; web production'da sır yoksa müşteri sayfası hata verir. Rotasyon: `.env`'i güncelleyip `docker compose up -d caddy web` çalıştırın; iki servis birlikte yeniden yaratılır, açık oturumlar etkilenmez. Yedeği parola kasasında tutulur, loga ve dokümana yazılmaz                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `SITE_HOST`                                                            | staging `185.126.217.99`, yerel `localhost`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `SEED_SUPERADMIN_EMAIL/PASSWORD/NAME`                                  | boşluk içeren değer tırnakla yazılır (`SEED_SUPERADMIN_NAME="Super Admin"`), yoksa §6'daki `. ./.env` kabukta hata verir.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ↳                                                                      | yalnız seed için; parola ≥ 12, ilk girişte değiştirilir; seed sonrası `.env`'den silinebilir                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `ABUSE_EMAIL`                                                          | Misafir karşılama ekranındaki "Kötüye kullanımı bildir" `mailto:` adresi (AC-125, V13, S-P4-1), ör. `abuse@<alan-adı>`. **production'da boşsa bağlantı gizlenir** (Super Admin e-postasına düşülmez). Staging/prod'da doldurulması önerilir. Değişiklik: `.env` → `docker compose up -d server`. Kullanmayacaksanız boş bırakmak (`ABUSE_EMAIL=`) veya satırı silmek güvenlidir: env.ts boş/yalnız boşluk değerleri tanımsız sayar (`withoutBlanks`), server açılır ve production'da bağlantı gizlenir. Dolu ama geçersiz bir adres (ör. `abuse@`) ise env.ts doğrulamasında server'ı açtırmaz                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `AGENT_SHA256`                                                         | P6 (G-07): `agent_downloads` volume'undaki `NoktaDestek.exe`'nin SHA-256'sı (64 hex). **Elle yazılmaz**: `deploy/agent/verify-and-publish.sh` attestation + `SHA256SUMS` doğrulamasından sonra yazar, ardından `docker compose up -d server`. Boşsa, dosya yoksa veya hash uyuşmazsa `GET /api/v1/public/agent/download` **503** döner (fail-closed) ve server logunda bir kez `alarm: "agent_binary"` uyarısı çıkar. `AGENT_BINARY_PATH` compose'da sabittir (`/data/downloads/NoktaDestek.exe`); `.env`'deki değer yalnız compose dışı çalıştırmada kullanılır                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `MAC_AGENT_SHA256`                                                     | P28f (mimari-p28f §8.1, S-P28f-3): `agent_downloads` volume'undaki `NoktaDestek-macOS.zip`'in SHA-256'sı (64 hex). **Elle yazılmaz**: `deploy/agent/publish-mac.sh` (§28f.4) attestation + `SHA256SUMS` + zip yapısı doğrulamasından sonra yazar, ardından `docker compose up -d server`. Boş/dosya yok/uyuşmaz → `GET /api/v1/public/agent/download?os=macos` **503**, `GET /api/v1/public/agent/availability` `macos:false` (karşılama sayfası macOS düğmesini göstermez), Caddy `/downloads/*.zip` forward_auth `/internal/agent-ready/macos` 503. `unconfigured` olağan (yayın yok ya da `--withdraw`; R39 r4 ile değişti, §28f.9) — alarm yok; `missing`/`mismatch` server logunda bir kez `alarm: "mac_agent_binary"`. Geri alma: `publish-mac.sh --withdraw` (değeri `MAC_AGENT_SIGNING` ile birlikte boşaltır). **Elle değiştirmek yasak** (S-r4-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `MAC_AGENT_SIGNING`                                                    | P28f-r4 (mimari-p28f §15 K-P28f-r4-2, S-r4-6/7): macOS yayınının imza türü `adhoc` \| `notarized` \| boş. **Elle yazılmaz/değiştirilmez**: `publish-mac.sh --apply` doğruladığı predicate'e göre `MAC_AGENT_SHA256` ile **aynı awk geçişinde, tek yazımda** yazar; `--withdraw` ikisini boşaltır; `.env.bak.mac.*` ikisini birlikte geri getirir. Boş → sunucu `adhoc` sayar (availability `macosSigning`); `NODE_ENV=production` + SHA dolu + bu boş → açılışta uyarı logu (hata değil). Geçersiz değer → açılış hatası (`env.ts` enum). Hedef `notarized` iken ad-hoc yayın betikte RET (önce `--withdraw`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `MAC_AGENT_PATH`                                                       | P28f: compose'da sabit `/data/downloads/NoktaDestek-macOS.zip` (Caddy'nin `/srv/downloads/NoktaDestek-macOS.zip` olarak sunduğu dosya). `NODE_ENV=production`'da env.ts başka değeri reddeder (aynı kural `AGENT_BINARY_PATH` = `/data/downloads/NoktaDestek.exe` için de geçerli); `.env` değeri yalnız compose dışı çalıştırmada                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `WHATSAPP_SERVICE_URL`                                                 | P8b: whatsapp-bildirim servisi (sistem düzeyi; tenant değiştiremez). **P12b: yalnız yedek değerdir.** Etkin adres önceliği: **Sistem ayarları → WhatsApp servisi panel kaydı > `WHATSAPP_SERVICE_URL`** (P13b, G-P13b-2: `env.ts`'te yerleşik varsayılan **yok**; ikisi de boşsa kanal yapılandırılmamış = kapalı). Açılışta panel kuralıyla doğrulanır: yalnız `http://`/`https://` (küçük harf), `kullanıcı:şifre@`, sorgu (`?`), parça (`#`), boşluk/kontrol karakteri yok, ≤ 200 karakter → **uymazsa server açılmaz** (log `env` doğrulama hatası; `env.ts` `waServiceUrlSchema`; §17.4). **production'da `http://` + özel olmayan adres → kanal kapalı başlar** (gönderim yok, log `alarm:"whatsapp_insecure"`). Güvensiz veya yapılandırılmamış adreste testler servise istek **göndermez**: Super Admin testi (`POST /api/v1/admin/settings/whatsapp/test`) **200 `{ok:false}`** + sabit mesaj, tenant testi (`POST /api/v1/settings/support-requests/whatsapp/test`) **502 `UPSTREAM`** döner; prod değeri K13'e göre `https://…` veya özel ağ adresi (§12.3). **Değişiklik yolu: panel** (Super Admin → Sistem ayarları → WhatsApp servisi → kaydet; yeniden başlatma gerekmez, çalışan sürece hemen uygulanır). Env'e dönüş: aynı ekranda "Ortam değişkenine dön". **Panel kaydı varken `.env` değişikliği etkisizdir**; env'i değiştirip `docker compose up -d server` yalnız panel kaydı yokken (ekranda kaynak rozeti "Ortam değişkeni") anlamlıdır |
| `WHATSAPP_SERVICE_API_KEY`                                             | İsteğe bağlı. whatsapp-bildirim servisinin `x-api-key` anahtarı (sır: parola kasasında; loga, dokümana, komut satırına yazılmaz). Anahtar adresle birlikte gider: **panel adresi kayıtlıysa yalnız panel anahtarı kullanılır (bu değişken o adrese gönderilmez); panel kaydı yoksa env adresiyle bu değişken kullanılır.** Panelde adresin kökeni değişirse anahtar yeniden girilmelidir (`WA_API_KEY_REENTER`). Boşsa istek anahtarsız gider. Servis tarafında `REQUIRE_API_KEY` ile kademeli geçiş ayrı projede yürür: **servis anahtarı zorunlu hâle gelmeden ÖNCE Remote'a anahtar girilir** (panel ya da bu değişken + `docker compose up -d server`), aksi hâlde gönderimler ve test 401/502 ile düşer. Kontrol (değer basmadan): `grep -c '^WHATSAPP_SERVICE_API_KEY=.' deploy/.env` → `1` ya da panelde kaynak rozeti "Panel kaydı"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `WHATSAPP_ALLOW_INSECURE_HTTP`                                         | **K13 geçici çözümü (kullanıcı kararı 2026-11-15).** `true` / `false`, boş = `false`; başka değer → server açılmaz (env doğrulama). `true` iken **yalnız WhatsApp** hedefi için düz `http://` (genel adres ve `x-api-key` dahil) güvensiz sayılmaz → kanal production'da da açık; `whatsapp_insecure` / `whatsapp_key_over_http` alarmları düşmez, yerine açılışta bir kez **`alarm:"whatsapp_insecure_http_allowed"`** (warn; adres/anahtar yazılmaz). Super Admin → Sistem ayarları → WhatsApp servisi ekranında sarı uyarı (`insecureAllowed`). Ayrıştırılamayan adres yine kapalı; SMS kuralı değişmez. **Risk:** servis anahtarı ve mesajlar ağda açık metin gider. Servis HTTPS'e geçince `false` yapılır/silinir → `docker compose up -d server` (§12.3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `APP_ENCRYPTION_KEYS`                                                  | P10 (mimari §3.2): `v1:<base64 32 bayt>` (`openssl rand -base64 32`). SMTP şifresi ve TOTP sırları bununla AES-256-GCM şifrelenir. **production'da zorunlu** (yoksa server açılmaz; compose da `:?` ile durur). **Kaybedilirse** kayıtlı SMTP şifreleri ve tüm 2FA sırları çözülemez → SMTP şifreleri yeniden girilir, kullanıcıların 2FA'sı sıfırlanır (§14). Rotasyon: `v1:...,v2:...` (eski silinmez; yeni yazımlar v2 — emekliye ayırma kuralı §14 P10 "Anahtar rotasyonu"). Yedeği parola kasasında; loga/dokümana yazılmaz. Değişiklik: `.env` → `docker compose up -d server`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `UPLOADS_DIR`                                                          | P12: logo/avatar yükleme kökü. **Compose sabit verir** (`/data/uploads`, named volume `uploads` → `remote_uploads`); `.env`'deki değer yalnız compose dışı çalıştırmada kullanılır — **mutlak yol** (env.ts göreli yolu reddeder), ör. `<repo>/.data/uploads` (`.data/` git-ignore). Boşsa `/data/uploads`. Yedek/geri yükleme §16.3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `SMSPORTAL_URL`                                                        | P19: smsportal sistem varsayılan adresi (yalnız köken + yol, ör. `https://<smsportal>`). Firma panelde kendi SMS adresini girmemişse bu kullanılır; boş = varsayılan yok. API anahtarı env'de DEĞİL, firma başına panelde (şifreli, AAD etkin kökene bağlı). Production'da `http://` + özel olmayan host → SMS kapalı. **Değiştirmek** varsayılanı kullanan firmaların anahtarını okunamaz yapar → önce §26.3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `MIN_AGENT_VERSION`                                                    | P8b G-E9-4: asgari Windows istemci sürümü `x.y.z`. Boş = kontrol yok. Düşük sürüm talep/resolve/join/`/ws/guest`'te 426 `CLIENT_OUTDATED`; istemci "Yeni sürümü indir" gösterir. Güvenlik yamasında yükseltilir (§12.4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `DEPLOY_ENV`                                                           | **P27: compose'da server için zorunlu** (`${DEPLOY_ENV:?}`; boşsa `docker compose` durur, env.ts NODE_ENV=production iken varsayılansız ister). `production` (prod) · `staging` (staging) · `development` (yerel). Yedek/geri yükleme ve yayın betikleri de okur. Prod `.env` staging'den kopyalanmaz. Açılış hatası "DEPLOY_ENV gerekli" → §27.8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `UNATTENDED_MODE`                                                      | P27 imza kapısı: boş/`off` · `unsigned` (**yalnız** `DEPLOY_ENV=staging`; staging test modu, "TEST — imzasız" etiketleri; başka ortamda server açılmaz) · `unsigned-accepted` (P32 **prod risk kabulü**, ADR-0042; yalnız `DEPLOY_ENV=production\|staging`; liste + `UNATTENDED_AGENT_SHA256` + `UNATTENDED_AGENT_VERSION` zorunlu, ajan SHA'sı listede olmalı) · `signed` (imzalı + listede). İmaj geri alınmadan **önce** `off` (eski imaj `unsigned-accepted`'i tanımaz). §27, §27.9                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `UNATTENDED_SIGNED_SHA256`                                             | İzinli servis SHA-256 listesi (`signed`/`unsigned-accepted`'te zorunlu; adı tarihsel), virgüllü 64-hex, **en çok 20** (env.ts). **Elle eklenmez:** `publish-servis.sh` yalnız `vX.Y.Z` Release yayınında (tüm ortamlarda) SHA'yı sona ekler (yinelenmez; 16'da uyarı, 20'yi aşacaksa durur). Elle yalnız **çıkarılır** (§27.9 iki aşamalı geri çekme). remote-watch her turda listeyi `agent/PUBLISHED.log` ile karşılaştırır. §27.5, §27.9                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `UNATTENDED_AGENT_SHA256`                                              | Servis ikilisinin SHA-256'sı. **Elle yazılmaz**: `deploy/agent/publish-servis.sh` yazar. Yol compose'da sabit (`UNATTENDED_AGENT_PATH=/data/unattended/NoktaDestekServis.exe`, volume `unattended_downloads`, yalnız server salt okunur). Boş/uyuşmaz → panel indirmesi 503                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `UNATTENDED_AGENT_VERSION`                                             | P32 (AC-533): yayınlanan servis ikilisinin sürümü `X.Y.Z`; müşteri kayıt kodu mesajındaki doğrulama bloğunda gösterilir. **Elle yazılmaz:** `publish-servis.sh` `vX.Y.Z` yayınında yazar, `dir-*`/`*-unattested` yayınında boşaltır (bu yüzden `unsigned-accepted` yalnız Release ile açılır). remote-watch `servis v<sürüm> <UNATTENDED_AGENT_SHA256>` satırını `PUBLISHED.log`'da arar (`unattended-agent-version-mismatch`). §27.9                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `NODE_ENV`, `LOG_LEVEL`, `ALLOWED_ORIGINS`, `CADDY_BIND`, `IMAGE_TAG`  | opsiyonel (varsayılan: production, info, PUBLIC_BASE_URL, 0.0.0.0, local)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

`DATABASE_URL` / `MIGRATE_DATABASE_URL` compose'da parolalardan **üretilir**; `.env`'deki değerleri yalnız
compose dışı (yerel `pnpm`) çalıştırmada kullanılır. Server konteynerine yalnız ihtiyaç duyduğu
değişkenler açıkça verilir; `MIGRATE_DATABASE_URL` ve root parolası server'da **yoktur** (G-15). Kontrol:
`docker compose exec server sh -c 'env | grep -c MIGRATE_DATABASE_URL'` → `0`.
Prod gizlileri repo/CI'da tutulmaz; sunucuda `deploy/.env` (600, root) + parola kasası yedeği.
DB parolası değişimi: `ALTER USER 'app'@'%' IDENTIFIED BY '...'` (root ile), `.env` güncelle, `docker compose up -d server`.

## 4. Günlük işlemler

| İş                            | Komut (`deploy/` içinde)                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| Başlat / güncelle             | `docker compose up -d` (değişen imaj/env olan servis yeniden yaratılır)                        |
| Durdur (veri kalır)           | `docker compose stop` · tamamen kaldır: `docker compose down`                                  |
| **Veriyi sil** (yalnız test!) | `docker compose down -v` — MySQL ve Caddy CA volume'ları silinir                               |
| Durum                         | `docker compose ps`                                                                            |
| Yeniden başlat                | `docker compose restart server`                                                                |
| Yeni sürüm                    | `git pull && IMAGE_TAG=<sürüm> docker compose build && IMAGE_TAG=<sürüm> docker compose up -d` |

## 5. Sağlık ve loglar

- Hazırlık: `docker compose exec server node -e "fetch('http://127.0.0.1:3001/ready').then(async r=>console.log(r.status, await r.text()))"` → `200 {"status":"ready","migration":"..."}`.
- Docker healthcheck server'da `/ready`'yi 5 sn'de bir yoklar; `unhealthy` → §6.
- Loglar JSON (pino; `reqId` korelasyon kimliği, yanıtta `X-Request-Id`): `docker compose logs -f --since 10m server`.
  Kullanıcının bildirdiği `requestId` ile arama: `docker compose logs server | grep <requestId>`.
- Caddy erişim logu: `docker compose logs caddy | grep handled`. Sorgu dizesi, `/session/<token>`,
  `/downloads/Destek-<kod>.exe` (→ `Destek-***`), firma dosyası `NoktaDestek-<label>-<ref>.exe` (→ `NoktaDestek-***`, P8b), `Cookie`, `Authorization`, `X-Csrf-Token`, `Sec-WebSocket-Protocol`,
  `Set-Cookie`, `Location`, `Content-Disposition` **yazılmaz** (G-10).
  Caddy **hata logu** (`http.log.error.*`, ör. upstream 502) global `log default` filtresiyle aynı maskelemeyi alır (P6
  düzeltme 1); Caddyfile'da iki filtre listesi birlikte güncellenir.
  Doğrulama: `docker compose logs caddy | grep -c 'ticket=\|Sec-Websocket-Protocol'` → `0`.
- Log dönüşü: json-file 10 MB × 5 dosya / servis.

## 6. Migration ve seed

- Her `docker compose up -d`'de `migrate` önce çalışır (`prisma migrate deploy` + `grants.sql`); başarısızsa
  server **başlamaz**. Log: `docker compose logs migrate`.
- **Yayın sırası: önce migrate, sonra server.** Compose bunu `depends_on: service_completed_successfully` ile sağlar.
  Servisleri tek tek güncelliyorsanız sırayı koruyun: `docker compose run --rm migrate` → `docker compose up -d server`.
  P7 için bu zorunludur: migration `20261111050000_p7_consent_source_tech` `session_consents.source` CHECK'ine `TECH`
  ekler; P7 server'ı migration'sız çalışırsa "Kontrolü bırak" kaydı CHECK hatasıyla (3819) yazılamaz (kontrol yine
  kapanır, log'a `ref` düşer). Geri alma sırası tersidir: önce P7 öncesi imaj, sonra `down.sql`; `source='TECH'` satırı
  varsa `down.sql` atomik başarısız olur, bu satırlar KVKK kanıtıdır ve silinmez (`docs/db-notlari.md` P7).
- Elle: `docker compose run --rm migrate` · seed: `docker compose --profile setup run --rm seed`.
- Geri alma (veri kaybı olur, önce yedek): `docker compose run --rm migrate pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/<ad>/down.sql`, sonra önceki imaj etiketiyle `up -d` (ayrıntı `docs/db-notlari.md`).
- `app` yetki sınırı kontrolü: `set -a; . ./.env; set +a; APP_PW=$MYSQL_APP_PASSWORD CONTAINER=$(docker compose ps -q mysql) DB=$MYSQL_DATABASE bash mysql/check-app-grants.sh`.
- **Staging teknisyen hesapları** (gereksinimler §9; P9'dan sonra kullanıcılar panelden eklenir — §14.1, betik yalnız staging test hesapları için): `bash staging-users.sh`
  (`deploy/` içinde, yığın ayakta). Demo tenant'ı (seed `NODE_ENV=production`'da oluşturmaz) ve bir ADMIN + bir
  USER oluşturur. Hash server konteynerinde `src/auth/password.ts` (`ARGON2_OPTIONS`, argon2id) ile, SQL
  mysql konteynerinde `app` kullanıcısıyla (utf8mb4) çalışır; `must_change_password=1`. USER'a test için
  `sessions.view/create/edit/delete/terminate`, `remote_control.use`, `file_transfer.use`, `session_history.view`,
  `support_requests.view/accept` (P8b), `customers.view/create/edit/delete` (P8c) açılır. Yeni pakette eklenen anahtarlar
  betik tekrar çalıştırılınca mevcut USER hesabına `INSERT IGNORE` ile eklenir (Admin'in elle kapattığı satıra dokunmaz). Tekrar çalıştırmak güvenli: var olan tenant/kullanıcıya dokunmaz, parola ezmez. Parolalar yalnız
  `ACCESS.txt`'e (600) eklenir, ekrana yazılmaz. Oluşturma/yetki olayları audit'e `source: staging-users.sh` ile yazılır.
  Opsiyonel: `ADMIN_EMAIL=… USER_EMAIL=… ACCESS_FILE=… bash staging-users.sh`. Parola sıfırlama P10'a kadar yok:
  kullanıcıyı pasife alıp (Kullanıcılar ekranı) farklı e-postayla yeni hesap açın.

### 6.1 P8 yayını — ADR-0014 ön kontrolü (migrate'ten ÖNCE)

P8 iki migration getirir: `20261111060000_p8_session_history` (sütun + indeks) ve `20261111070000_enum_check_binary`
(ADR-0014: 14 enum CHECK ikili karşılaştırmaya geçer). İkincisi, mevcut satırlardan biri kanonik değilse (ör. `'tech'`,
`'TECH '`) hiçbir şey değiştirmeden **3819** (`adr14_noncanonical_rows_chk`) ile durur; migrate başarısız olunca
server da başlamaz. Bunu yayından önce görmek için `git pull`'dan sonra, `docker compose build/up`'tan **önce**,
çalışan MySQL'e salt okunur ön kontrolü uygulayın (`deploy/` içinde):

```bash
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_MIGRATOR_PASSWORD" mysql -umigrator "$MYSQL_DATABASE"' \
  < ../apps/server/prisma/migrations/20261111070000_enum_check_binary/precheck.sql
```

Parola konteynerin kendi ortamından okunur, komut satırına yazılmaz. Çıktı 14 satırdır (`col`, `n`); **hepsi 0**
olmalıdır (2026-11-11 test DB'sinde denendi). Hepsi 0 ise yayına §8'deki sırayla devam edin.

**`n` > 0 ise ya da migrate 3819 ile durduysa:**

1. Satırları **elle düzeltmeyin** (`session_consents` KVKK onay kanıtıdır). Precheck çıktısını (yalnız sütun adı ve
   sayı; satır içeriği değil) mimara bildirin.
2. Migration yerleşik koruma sayesinde hiçbir şey değiştirmedi; Prisma'daki başarısız kaydı kapatın:
   `docker compose run --rm migrate pnpm --filter @remote/server exec prisma migrate resolve --rolled-back 20261111070000_enum_check_binary`
3. Karar gelene kadar §8 "Rollback" ile önceki `IMAGE_TAG`'e dönün. Karardan sonra `docker compose up -d` (migrate
   yeniden dener).

**Geri dönüş (P8'i tamamen geri almak; önce yedek):** sıra terstir. (1) Önceki imaj (`IMAGE_TAG=<P7>`), (2) ADR-0014
`down.sql` (CHECK'leri eski harf duyarsız biçime döndürür; genişletme yönünde, her zaman başarılı), (3) P8
`down.sql` (**müşteri adı/e-postası, ticket ve not sütunlarını verisiyle siler**):

```bash
docker compose run --rm migrate pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261111070000_enum_check_binary/down.sql
docker compose run --rm migrate pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261111060000_p8_session_history/down.sql
```

Her `down.sql` kendi `_prisma_migrations` kaydını da siler. Yalnız ADR-0014'ü geri almak P7/P8 kodunu etkilemez.
Ayrıntı: `docs/db-notlari.md` "ADR-0014 uygulandı", ADR-0014.

## 7. Sorun giderme (P1)

| Belirti                                                                                                                        | Kontrol / çözüm                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `required variable X is missing`                                                                                               | `deploy/.env`'de X boş; §3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| migrate `exited (1)`                                                                                                           | `docker compose logs migrate`; parola/DB adı uyuşmazlığı → mysql volume ilk init'teki parolayı kullanır (`.env` sonradan değiştiyse `ALTER USER`)                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| server `unhealthy`                                                                                                             | `logs server`; `/ready` 503 → DB erişimi / migration sürümü                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Tarayıcı sertifika uyarısı                                                                                                     | kök sertifika kurulmamış (§2) veya `SITE_HOST` ≠ adres çubuğundaki ad                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 4450 açılmıyor                                                                                                                 | `CADDY_BIND`, host güvenlik duvarı, `docker compose logs caddy`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| TLS `internal error` alert'i (IP ile bağlanınca)                                                                               | IP adresine bağlanan istemci SNI göndermez; Caddyfile global `default_sni {$SITE_HOST}` olmalı                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Dışarıdan 4450 zaman aşımı, sunucuda `curl -k https://127.0.0.1:4450/login` 200                                                | Paket VM'e ulaşmıyor: üst NAT/firewall yönlendirmesi eksik (§8). Kontrol: `tcpdump -ni ens18 tcp port 4450` dışarıdan istek sırasında boş                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `Address already in use` (ağ)                                                                                                  | 172.30.0.0/24 host'ta başka ağla çakışıyor → compose `edge` alt ağını, caddy/web sabit adreslerini ve `TRUSTED_PROXY_CIDR` sabitini birlikte değiştir                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Müşteri "uygulamayı indir"de 503 / server logunda `alarm: "agent_binary"` (`state`: `unconfigured` \| `missing` \| `mismatch`) | P6 indirme kapısı: `AGENT_SHA256` boş, volume'da `NoktaDestek.exe` yok/okunamıyor (dosya izni 0644 olmalı; server root olmayan kullanıcıyla okur) veya hash uyuşmuyor. **`mismatch` güvenlik olayıdır** (ikili değiştirilmiş olabilir): volume'u elle düzeltmeyin, `verify-and-publish.sh` ile Release'den yeniden yayımlayın. Kontrol (hash değerini karşılaştırın, ikiliyi kopyalamayın): `docker compose exec server sha256sum /data/downloads/NoktaDestek.exe`. Dosya değişince server yeniden başlatma gerekmeden hash'i yeniden hesaplar; `AGENT_SHA256` değişirse `docker compose up -d server` |
| `/downloads/*.exe` 503 `NOT_READY` (JSON)                                                                                      | S6-2: Caddy dosyayı sunmadan önce `forward_auth` ile server'ın iç `/internal/agent-ready` ucuna sorar; yukarıdaki satırla aynı nedenler (`alarm: "agent_binary"`). Server ayakta değilse 502. İç uç dışarıdan 404'tür; elle kontrol: `docker compose exec caddy wget -S -O- --header 'X-Forwarded-Method: GET' http://server:3001/internal/agent-ready` → `204`                                                                                                                                                                                                                                        |
| `/downloads/Destek-<kod>.exe` 404                                                                                              | Caddy yalnız `NoktaDestek.exe` ve `Destek-<8 hane>.exe` adlarını sunar (her ikisi aynı dosya); volume `caddy` servisine `/srv/downloads` olarak bağlı mı: `docker compose exec caddy ls -l /srv/downloads`                                                                                                                                                                                                                                                                                                                                                                                             |
| Müşteri resolve audit'inde IP hep `172.30.0.3`                                                                                 | `EDGE_PROXY_SECRET` caddy ile web arasında farklı: iki servisi birlikte yeniden yaratın (`docker compose up -d --force-recreate caddy web`). Kontrol için sırrın kendisini değil özetini karşılaştırın: `docker compose exec web sh -c 'printf %s "$EDGE_PROXY_SECRET" \| sha256sum'`, aynı komutu `caddy` için de çalıştırın                                                                                                                                                                                                                                                                          |
| Teknisyen "Kontrol iste"de `CONFLICT` alıyor                                                                                   | P7 `control.request` süzgeci: "Müşteri bağlı değil." (misafir kopuk/lobide), "Önceki kontrol isteği müşteride bekliyor." (önce **Vazgeç**), "Kontrol zaten açık." (iki sekme). Monitör isteğinde "Önceki monitör isteği müşteride bekliyor." → yanıt ya da 30 sn beklenir. Sunucu hatası değildir; ayrıntı `docs/api.md` "Uzaktan kontrol (P7)"                                                                                                                                                                                                                                                        |
| Teknisyen `RATE_LIMITED` alıyor (kontrol veya monitör)                                                                         | Ret/yanıtsızlık sonrası 30 sn bekleme veya oturum başına 5 istek sınırı (G-03, bilinçli). Sınır oturum başınadır; teknisyen yeni oturum açarak devam eder. Ayar yoktur                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Konsolda "Kontrol sistem tarafından kapatıldı (yetki veya kayıt)", müşteri izin vermişti                                       | Fail-closed (G-15): izin kaydı (consent + audit) yazılamadı veya 800 ms'yi aştı → kontrol geri alındı, teknisyene `error{INTERNAL}` + `ref`. Kontrol: `docker compose logs server --since 10m \| grep <ref>`; `rs_control_total{event="grant_audit_error"\|"grant_audit_timeout"}` artıyor mu; DB gecikmesi/bağlantısı (`/ready`, `docker compose logs mysql`). DB düzelince kontrol yeniden istenebilir; kodda gevşetilecek bir ayar yoktur                                                                                                                                                           |
| Yetkisi kaldırılan teknisyenin kontrolü hemen kapanmadı                                                                        | P9'a kadar yetki değişikliği teknisyen soketinin 60 sn'lik yeniden doğrulamasında uygulanır (`caps.update` + `control.revoke{permission}`, metrik `caps_narrowed`, `revoke_permission`). En geç ~60 sn beklenir. Hemen kesmek için oturumu zorla sonlandırın (`POST /api/v1/sessions/:id/terminate`, Oturumlar → "Zorla sonlandır")                                                                                                                                                                                                                                                                    |
| Uzaktan kontrol olaylarını izleme                                                                                              | `/metrics` → `rs_control_total{event}` (komut: `docs/api.md` "GET /metrics"; olay listesi `apps/server/src/ops/metrics.ts`). Dikkat: `grant_audit_{error,timeout}` > 0 (izin kaydı yazılamıyor), `control_request_audit_failed` > 0 (istek audit'i yazılamadı, istek yine iletildi), `control_state_unexpected` sık artıyorsa (beklenmeyen izin mesajı; değiştirilmiş istemci şüphesi, log oda başına dakikada ≤ 1)                                                                                                                                                                                    |
| Konsolda "Kontrol iste" düğmesi yok                                                                                            | Teknisyende `remote_control.use` yok (staging: `staging-users.sh` USER'a açar), müşteri tarayıcıdan bağlı (yalnız görüntü; "Uzaktan kontrol" pasif) veya görüntü henüz gelmedi                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `https://remote.noktabilisim.net` 502                                                                                          | Caddy 4451 dinlemiyor: `ss -ltn \| grep 4451` boş → repo'daki Caddyfile/compose (ADR-0015) yayında değil veya caddy yeniden yaratılmadı (`docker compose up -d caddy`). `tail /var/log/nginx/remote.access.log` → `upstream_status`                                                                                                                                                                                                                                                                                                                                                                    |
| Alan adında tüm istemciler `172.30.0.128` görünüyor                                                                            | edge ağ geçidi değişti: `docker network inspect remote_edge -f '{{json .IPAM.Config}}'` → Gateway, Caddyfile `servers :4451 trusted_proxies` ile aynı olmalı. Cloudflare kaydı "proxied" (turuncu) yapıldıysa istemci Cloudflare IP'si görünür → "DNS only"                                                                                                                                                                                                                                                                                                                                            |
| Sertifika süresi doldu / yenilenmedi (alan adı)                                                                                | `certbot certificates --cert-name remote.noktabilisim.net`; `certbot renew --cert-name remote.noktabilisim.net` (webroot `/var/www/remote-acme`, HTTP 80 vhost'u açık olmalı); `journalctl -u certbot --since -2d`                                                                                                                                                                                                                                                                                                                                                                                     |
| Hızlı Destek staging'de kod soruyor / hiçbir kodu kabul etmiyor                                                                | (Alan adıyla gömülü istemcide geçerli değil — LE sertifikası, kök kurulumu gerekmez.) IP:4450 gömülü istemcide: Windows'ta Caddy `tls internal` kök sertifikası kurulu değil (§8 "Kök CA", yönetici komut isteminde `certutil -addstore -f Root remote-staging-ca.crt`). İstemci sertifikayı doğrulayamayınca bağlantı hatası kod hatası gibi görünüyor; ajan 0.8.0'da TLS hatası ayrı mesajla gösterilecek                                                                                                                                                                                            |
| CSV dışa aktarmada 429 / "En çok 50.000 satır"                                                                                 | P8 sınırları: kullanıcı başına dakikada 5 dışa aktarma; 50.000 satır üstünde dosya üretilmez (tarih aralığı daraltılır). Müşteri adıyla liste araması dakikada 60. Ayar yoktur                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Tüm müşteriler aynı IP'den (`172.30.0.x`) görünüyor / token limiti (429) ortak işliyor                                         | web'in adresi .3 değil veya `TRUSTED_PROXY_CIDR` kapsamıyor: `docker inspect remote-web-1 -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'`                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## 8. Staging (185.126.217.99:4450)

> **Arşiv notu (P13b, ADR-0019):** Bu bölüm prod terfisine (§20) kadar geçerlidir. Terfide staging yığını `/opt/remote`'ta
> yerinde **prod'a dönüşür** (yeni volume, yeni sırlar, `DEPLOY_ENV=production`, `CADDY_BIND=127.0.0.1`, 4450 dışarı kapalı).
> Terfiden sonra aşağıdaki staging komutları (4450 erişimi, ACCESS.txt, test hesapları) **kullanılmaz**; yayın geçmişi tablosu
> kayıt olarak kalır. Yeni staging P13c'de ayrı compose projesi olarak kurulur (`remote-stg`, 127.0.0.1:4460/4461); o zamana kadar
> paket doğrulaması yerelde yapılır. Prod işletimi: §20.
>
> **P13b staging yayını (sıra A) notları:** (1) `deploy/.env`'e `DEPLOY_ENV=staging` eklenir (§18.9/1); yoksa yedek
> `FAILED adım=önkoşul`. (2) WhatsApp kanalı artık yerleşik varsayılan adres kullanmaz: panel kaydı (Sistem ayarları → WhatsApp
> servisi) ya da `WHATSAPP_SERVICE_URL` yoksa kanal **kapalıdır**. Yayından önce kontrol (değer ekrana basılmaz):
> `grep -c '^WHATSAPP_SERVICE_URL=.' deploy/.env` → `1` ya da panelde kaynak rozeti "Panel kaydı". İkisi de yoksa ve kanal
> isteniyorsa değer parola kasasındaki kayıttan `.env`'e yazılır → `docker compose up -d server`; doğrulama Super Admin
> "Test Mesajı Gönder" → başarılı. Servis anahtarı (`WHATSAPP_SERVICE_API_KEY`, isteğe bağlı; panel adresi kayıtlıysa yalnız panel
> anahtarı kullanılır): `grep -c '^WHATSAPP_SERVICE_API_KEY=.' deploy/.env` → `1` ya da panelde anahtar kayıtlı. Servis tarafında
> `REQUIRE_API_KEY` açılmadan **önce** Remote'a anahtar girilmiş olmalı (değer kasadan, ekrana basılmadan) → `docker compose up -d server`
> → test mesajı yine başarılı. (3) Yedek imzası kurulumu §18.9.
> Paylaşımlı sunucu (`/opt` altında başka projeler; 80/443 başka serviste). Yalnız `remote` compose projesinin
> konteyner/ağ/volume'larına dokunulur; `docker system prune` / `docker builder prune` (filtresiz) **yasak**.

- Konum: `/opt/remote` (main klonu), yığın `/opt/remote/deploy`. Ağlar `remote_edge` (172.30.0.0/24; Docker 29
  ağ geçidini `ip_range`'in ilk adresine, 172.30.0.128'e koyar, server .129 alır; caddy .2 / web .3 sabit,
  `TRUSTED_PROXY_CIDR=172.30.0.2/31` değişmez) ve `remote_db` (internal). MySQL portu yayımlanmaz.
- Sırlar: `deploy/.env` (600, root; sunucuda `openssl rand` ile üretildi). Giriş bilgileri: `deploy/ACCESS.txt`
  (600, root; `.gitignore` + sunucuda `.git/info/exclude`). Okuma: `ssh root@185.126.217.99 cat /opt/remote/deploy/ACCESS.txt`.
  Super Admin ve teknisyen hesapları ilk girişte parola değiştirir; değiştiren kişi ACCESS.txt'i günceller.
- Repo **private**: sunucuda GitHub kimliği yok. Güncelleme yerelden bundle ile (salt okunur deploy key eklenirse `git pull`):

```bash
# yerel makinede (repo kökü)
git bundle create /tmp/remote.bundle main && scp /tmp/remote.bundle root@185.126.217.99:/root/
# sunucuda
cd /opt/remote && git pull /root/remote.bundle main && rm /root/remote.bundle
cd deploy && TAG=$(git rev-parse --short HEAD) && sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$TAG/" .env
docker compose build && docker compose up -d     # migrate önce çalışır; başarısızsa server başlamaz
docker compose --profile setup run --rm seed     # her yayında zararsız; P4+ tenant aydınlatma metni eksikse ekler
                                                 # (yoksa misafir sayfası 500 "consent_text_missing" → "Bağlantı bilgisi alınamadı")
docker compose ps && docker compose logs --since 5m migrate
docker image rm remote-server:<eski> remote-web:<eski> remote-migrate:<eski>   # yalnız kendi eski imajlarımız
```

**P8 ve sonrası:** `git pull`'dan sonra, `docker compose build`'den önce §6.1 ön kontrolünü çalıştırın.
**Yedek ve `git pull` ayrı ssh çağrılarında; `umask 077` pull ile aynı oturumda kullanılmaz** (P8b-1 dersi, §13.1).
Rollback: önce gözetimsiz kapı denetimi `grep -q '^UNATTENDED_MODE=unsigned-accepted' .env && echo DUR` — `DUR` yazarsa önce `UNATTENDED_MODE=off` + `docker compose up -d --no-deps server` (§27.9; eski imaj `unsigned-accepted`'i tanımaz, açılış hatası verir). Sonra `.env`'de `IMAGE_TAG=<önceki>` → `docker compose up -d` (şema değiştiyse önce §6 geri alma).
Disk dar (%80+): her güncellemeden sonra yalnız iki önceki etiketi tutun.

- Kök CA (tarayıcı uyarısı olmasın diye test makinelerine kurulur; gerçek müşteri staging'e bağlanmaz):

```bash
ssh root@185.126.217.99 'cd /opt/remote/deploy && docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt /tmp/remote-staging-ca.crt' \
  && scp root@185.126.217.99:/tmp/remote-staging-ca.crt . && ssh root@185.126.217.99 rm /tmp/remote-staging-ca.crt
# macOS:   sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain remote-staging-ca.crt
# Windows: certutil -addstore -f Root remote-staging-ca.crt   (yönetici)
```

CA `caddy_data` volume'unda kalır; volume silinirse yeni CA üretilir ve test makinelerine yeniden kurulur.

- **Dış erişim:** VM'in adresi 192.168.25.10 (özel); 185.126.217.99 üst NAT'tan (ağ geçidi 192.168.25.1) yönlendirilir.
  NAT kuralı `185.126.217.99:4450/tcp -> 192.168.25.10:4450` **kaynak adresi korunarak (SNAT/masquerade yok)** açıktır
  (2026-11-11). Kural değişir de SNAT eklenirse audit'te tüm istemciler ağ geçidi adresinden görünür. Host UFW'si Docker
  yayınını engellemez. **S-P2-5 IPv4 sonucu (2026-11-11): GEÇTİ** — dış makineden başarısız giriş denemesinde audit
  `ip_address` ve Caddy `remote_ip` istemcinin genel IPv4'üyle eşleşti (özel ağ adresi değil).
- S-P2-5 kontrolü (yönlendirme açılınca, dış makineden): bir giriş yapın, sonra
  `docker compose logs caddy --since 5m | grep -o '"remote_ip":"[^"]*"' | sort | uniq -c` ve §1'deki audit sorgusu →
  istemcinin genel IPv4'ü görünmeli; `172.30.0.x` veya `192.168.25.1` görünürse NAT SNAT yapıyordur.
  `ssh -L` tüneli / sunucu içinden (127.0.0.1) yapılan istekler userland-proxy üzerinden gelir ve `172.30.0.128` görünür (beklenen).
  IPv6: VM'de global IPv6 yok, `/etc/docker/daemon.json` yok (varsayılan: ipv6 kapalı, userland-proxy açık),
  yayın yalnız `0.0.0.0:4450` → IPv6 istemci staging'e ulaşamaz; IPv6 doğrulaması prod ağında yapılır.
- **Yayın geçmişi**
  | Tarih      | Kapsam | Commit / `IMAGE_TAG`  | Migration                    | Not                                                                                                                          |
  | ---------- | ------ | --------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
  | 2026-11-11 | P3+P4  | `0f1b89a` / `0f1b89a` | `20261111030000_p4_consents` | coturn `TURN_LISTEN_IPS=auto` (3478 yalnız 127.0.0.1 ve özel IP'de dinliyor); dış TURN erişimi pfSense NAT'ı bekliyor (§8.2) |

| 2026-11-11 | P5 | `c910495` / `c910495` | `20261111040000_p5_session_files` | `app` yetkisi `session_files`'ta doğrulandı; eski `d90dd2d` imajları + build önbelleği silindi (disk %83 → %60) |
| 2026-11-11 | P6 | `aaaf369` / `aaaf369` | — (şema değişmedi) | Caddy forward_auth + `agent_downloads` volume; istemci 0.6.0 (`https://185.126.217.99:4450` gömülü, SHA-256 `bf55defa…`) `--dir --no-attestation` + `ALLOW_UNATTESTED=staging` ile yayınlandı (private repo → attestation yok). verify-and-publish kontrolü düzeltildi: `Host: 127.0.0.1` isteği Caddy'de boş 200 döndüğü için `--resolve` ile `PUBLIC_BASE_URL` host'u + yeniden deneme |
| 2026-11-11 | P7 | `60a7934` / `60a7934` | `20261111050000_p7_consent_source_tech` (migrate → server sırasıyla, compose `depends_on`) | Uzaktan kontrol; istemci 0.7.0 (`https://185.126.217.99:4450` gömülü, iki derleme aynı SHA-256 `e12ba3b3…`) `--dir --no-attestation` + `ALLOW_UNATTESTED=staging` ile yayınlandı. Windows elle testi bekliyor (gereksinimler "Sonra / açık — P7'den") |
| 2026-11-11 | P8 | `1587538` / `1587538` | `20261111060000_p8_session_history`, `20261111070000_enum_check_binary` (önce `precheck.sql` salt okunur: 14 sütun 0) | Oturum geçmişi + CSV; istemci 0.8.0 (fare imleci, TLS hata ekranı; iki derleme aynı SHA-256 `f75d41c3…`) `--dir --no-attestation` + `ALLOW_UNATTESTED=staging`. Seed: değişiklik yok |
| 2026-11-12 | P8 ek | `20cabfd` (yalnız istemci) | — | İstemci 0.8.1: enjekte tıklama reddinde uyarı; iki derleme aynı SHA-256 `6aeed3dd…`, `--dir --no-attestation` + `ALLOW_UNATTESTED=staging` |
| 2026-11-12 | Alan adı | `3d1278c` | — | `https://remote.noktabilisim.net` (host nginx + Let's Encrypt → Caddy 4451, ADR-0015); IP:4450 geçiş için açık. İstemci 0.8.2 yeni adres gömülü (kök sertifika gerekmez), iki derleme aynı SHA-256 `52dcc1d3…` |
| 2026-11-12 | Alan adı (sunucu tarafı) | — (repo değişikliği yayın bekliyor) | — | nginx vhost + LE sertifikası (`certonly --webroot`, renew dry-run GEÇTİ), `.env` `PUBLIC_BASE_URL`/`ALLOWED_ORIGINS` güncellendi (konteynerler yeniden yaratılmadı). Caddy 4451 (ADR-0015) yayınlanınca §8.3 doğrulaması |
| 2026-11-12 | P8b-1 | `b07aa76` | `20261112000000_p8b_support_requests` | Yedek `/root/remote-pre-p8b-20261112T001545Z.sql.gz`; seed `consentTextsCreated=1`; grants 211 PASS; nginx vhost güncellendi (`nginx -t` OK); Caddy yeniden başlatıldı (admin API kapalı, `reload` yerine `restart`). `WHATSAPP_SERVICE_URL`/`MIN_AGENT_VERSION` boş (prod modunda http WhatsApp kapalı — K13). **Ders:** aynı ssh komutunda `umask 077` sonrası `git pull` yeni dosyaları 600 yaptı → migrate EACCES, server/web birkaç dakika durdu; düzeltme `chmod go+rX` + yeniden build. Yedek/umask'i ayrı ssh çağrısında yapın |
| 2026-11-12 | P8b-2 | `11f9e34` (yalnız istemci) | — | İstemci 0.9.0 ("Destek iste", `https://remote.noktabilisim.net` gömülü); iki derleme aynı SHA-256 `eab23622…`, `--dir --no-attestation` + `ALLOW_UNATTESTED=staging`; yalnız server yeniden yaratıldı. `MIN_AGENT_VERSION` boş kaldı (eski istemciler çalışmaya devam eder). Windows elle testleri bekliyor |
| 2026-11-12 | P8b-2 ek | `81fbdc0` (yalnız istemci) | — | İstemci 0.9.1: `-H=windowsgui` (siyah konsol penceresi kalktı); iki derleme aynı SHA-256 `183911a2…`, `--dir --no-attestation` + `ALLOW_UNATTESTED=staging` |
| 2026-11-12 | Düzeltme (siyah ekran) | `6701567` (server + web) | — | TURN'süz ilk teklif düzeltmesi: admit sonrası teknisyene `ice.servers` `peer.joined`'dan önce gider, konsol ICE listesini bekler. Server ve web imajı yeniden yaratıldı; env/Caddy değişmedi |
| 2026-11-12 | P8c-1 | `1748d10` | `20261112120000_p8c_customers` | Yedek `/root/remote-pre-p8c-20261112T121000Z.sql.gz`; grants **261/261 PASS**; seed `consentTextsCreated=1`; ref ad alanı tutarlılığı `0`; `/metrics`'te 6 P8c metriği. Müşteriler modülü + bilgisayar kaydı (sunucu). Sayfa testi: `docs/arsiv/p8c1-test-raporu.md` |
| 2026-11-12 | P8c-2 | `2edfa9c` (yalnız istemci) | — | İstemci 0.10.0 (kalıcı "Destek iste", bilgisayar kaydı; `https://remote.noktabilisim.net` gömülü); SHA-256 `5255edc87840f18b28eb608c705bf2c16230a3a7cb0da49145a46e5ecbf721f3`, `--dir --no-attestation` + `ALLOW_UNATTESTED=staging` (attestation'sız staging yayını). `MIN_AGENT_VERSION` değişmedi. Windows elle testleri ve AC-192 ölçümü bekliyor |
| 2026-11-12 | İstemci 0.10.1 | `916e845` (yalnız istemci) | — | Dosya alımında "Dosya bozuk" düzeltmesi (DoneWait). SHA-256 `81acc316…` |
| 2026-11-12 | P9 + istemci 0.10.2 | `5e35d79` (server + web), `e53323e` (istemci) | — (şema değişmedi) | Yedek `/root/remote-pre-p9-20261112T140950Z.sql.gz`; grants **261/261 PASS**; seed `consentTextsCreated=0`. Kullanıcı/yetki/firma yönetimi. İstemci 0.10.2 (yakalama DXGI→DXGI1→GDI, neden kodu, kalıcı modda tanılama logu) SHA-256 `85142c14bf6941c2d5c3803b2818f0b1645c95b77704e640c8ff49d4059687bc`, attestation'sız staging yayını. Windows elle testleri bekliyor |
| 2026-11-12 | P10 | `f537cbe` (server + web) | `20261112180000_p10_account_security` | Yedek `/root/remote-pre-p10-20261112T153527Z.sql.gz`; `.env` yedeği `deploy/.env.bak.p10.20261112T153546Z`; `APP_ENCRYPTION_KEYS` sunucuda üretildi (v1, değer yazılmadı — **ayrıca yedeklenmeli**); grants **302/302 PASS**; seed `consentTextsCreated=0`. 2FA (Super Admin/Admin zorunlu: ilk girişte kurulum), şifre sıfırlama, SMTP ayar/test, oturum linki e-postası |
| 2026-11-12 | P11 | `09e7764` (server + web) | `20261113090000_p11_system_settings_audit` | Yedek `/root/remote-pre-p11-20261112T205049Z.sql.gz`; `.env` yedeği `deploy/.env.bak.p11.20261112T205050Z`; mysql `--log-bin-trust-function-creators=1` ile yeniden oluşturuldu, `SELECT @@log_bin, @@log_bin_trust_function_creators` = `1 1`; migrate OK; grants **320/320 PASS**; seed `consentTextsCreated=0`. Duman: `/api/v1/audit` PUT/PATCH/DELETE/POST → 405 (`Allow: GET, HEAD`), oturumsuz GET 401; DB'de `app` UPDATE → 1142, root UPDATE → 1644 (tetikleyici). Audit log ekranı, Super Admin MySQL/TURN ayarları, aydınlatma metni |
| 2026-11-13 | P12 | `55f4703` (server + web + caddy) | `20261113120000_p12_branding` | Yedek `/root/remote-pre-p12-20261113T200016Z.sql.gz`; `.env` yedeği `deploy/.env.bak.p12.20261113T200017Z`; CPU `sse4_2` var; nginx vhost `client_max_body_size 3m` (önceki `/root/remote.conf.prev`, `nginx -t` OK); migrate OK; `remote_uploads` volume `node:node 700` yazılabilir, sharp vips 8.18.7; grants **330/330 PASS**; seed `consentTextsCreated=0`. Duman: `/login` ve `?tenant=demo` 200, `/public/branding` sistem logosuna düşüyor, oturumsuz avatar 401, olmayan logo 404, oturumsuz 2,5 MB yükleme 401 (nginx/Caddy geçiyor). Firma/sistem logosu, avatar, tema |
| 2026-11-13 | P12b | `b7b4891` (server + web) | `20261114090000_whatsapp_service_setting` | Yedek `/root/remote-pre-p12b-20261113T204851Z.sql.gz`; `.env` yedeği `/root/.env.bak.p12b.20261113T204851Z`; `WHATSAPP_SERVICE_URL` boş → varsayılan (açılış doğrulaması geçti); migrate OK; grants **337/337 PASS**; seed değişiklik yok; açılışta beklenen `whatsapp_insecure` alarmı (prod + http genel adres → kanal kapalı, K13). Duman: `/login` 200, oturumsuz `/api/v1/admin/settings/whatsapp` 401, `/admin/settings/whatsapp` 307 → login. Super Admin WhatsApp servisi sekmesi |
| 2026-11-14 | P13a | `a0265be` (server + web + migrate; mysql yeniden oluşturuldu) | `20261114120000_p13a_retention` | Yedek `/root/remote-pre-p13a-20261114T193742Z.sql.gz` + uploads `/root/remote-uploads-pre-p13a-20261114T193742Z.tgz`; `.env` yedeği `/root/.env.bak.p13a.20261114T193742Z`; `MYSQL_BACKUP_PASSWORD` eklendi (48 karakter); `backup-user.sql` → `backup-user: OK` (SELECT, SHOW VIEW, TRIGGER); migrate OK; grants **373/373 PASS** (backup mysqldump, tetikleyici 3 dahil); `age` 1.1.1 + `jq` 1.7 kuruldu; `/var/backups/remote` 700, `backup.env` root 600 (alıcı: kullanıcının açık anahtarı; `BACKUP_ALERT_CMD` boş); `remote-backup.timer` etkin (her gece 02:00 TR); ilk yedek `20261114T194208Z` OK (db 43 KB, 19 tablo, tetikleyici 3, 1 sn); hata testi: mysql durdurulunca `FAILED adım=mysql-bul` + OnFailure `FAILED host=develop`, sonra `reset-failed`, yığın healthy. Retention metrikleri `rows=0 failures=0 last_success=0` (ilk tur 03:30). **Bekleyen:** staging scratch geri yükleme provası (§18.4, kullanıcının özel anahtarıyla), ertesi gün `retention.run` kontrolü (§18.6), AC-88 staging'de ölçülmedi (yerel 20 sn, §2). Duman: `/login` 200 |
| 2026-11-15 | P13b | `e865e19` (server + web + migrate; caddy yeniden yaratıldı) | `20261115090000_whatsapp_api_key` | Yedek `/root/remote-pre-p13b-20261114T215824Z.sql.gz` + uploads `/root/remote-uploads-pre-p13b-20261114T215824Z.tgz` (volume boş); `.env` yedeği `/root/.env.bak.p13b.20261114T215824Z`; `.env`: `DEPLOY_ENV=staging`, `WHATSAPP_SERVICE_API_KEY` eklendi (değer kasadan, ekrana basılmadı); migrate OK; seed değişiklik yok; grants **387/387 PASS**; Caddyfile HSTS `includeSubDomains` (admin API kapalı → `up -d --force-recreate caddy`; başlık doğrulandı). Yedek imzası (§18.9/1): `/etc/remote-backup/manifest_ed25519` (root 600) + `allowed_signers`, `remote-offsite` kullanıcısı, birimler (TimeoutStartUSec=2h); ilk imzalı yedek `20261114T220144Z` OK (`env=staging seq=1`, `audit-sureklilik: ilk`, `OFFSITE-UNCONFIGURED`), `ssh-keygen -Y verify` → Good signature, `status.prom` run_ok 1. `remote-watch` kuruldu (10 dk; `WATCH_ALERT_CMD` boş — alarm kanalı kararı bekliyor); ilk koşu: `cert:turn-le` yok (LE `remote-turn` henüz alınmadı), disk %84 → eski 12 imaj etiketi silindi (%75), offsite uyarısı. WhatsApp: panel kaydı yok + `WHATSAPP_SERVICE_URL` boş → kanal kapalı (K13/TLS kararı). Duman: 4450 `/login` ve `/ready` 200; 4451 (alan adı) `/login` 200, oturumsuz WhatsApp ayarı 401. **Yapılmadı (kullanıcı onayı/ağ adımı):** TURN güncellemesi (yeni relay aralığı 49160–49479 + `host-firewall.sh` hashlimit; çalışan coturn eski yapılandırmada), proxy-guard (nftables, §20.9), TURN LE sertifikası + kanca (§20.5), pfSense relay NAT |
| 2026-11-15 | P13b ağ/TURN | `19f952b` (kod değişmedi; coturn yeniden yaratıldı, server yeniden başlatıldı) | — | **TURN sertifikası (§20.5):** `cert-deploy-hook.sh install`; LE `--cert-name remote-turn` (`-d remote.noktabilisim.net`, `--duplicate`), `/etc/remote/turn-certs` (crt 0444, key 65534:65533 0400); kanca SIGUSR2 OK, `check OK`, `certbot renew --dry-run` başarılı; 5349 sunulan: LE YE1, bitiş 2027-02-12. **TURN (§20.2/6):** `deploy/turn/.env` yedeği `/root/turn.env.bak.p13b.*`; `TURN_REALM=remote.noktabilisim.net`, `TURN_MAX_BPS=1000000`, `TURN_BPS_CAPACITY=0`, `TURN_FW_RELAY_MAX_BPS=62500000`, `TURN_CERT_DIR=/etc/remote/turn-certs`; secret eş; `host-firewall.sh preflight` OK → `install` (49160-49199 reserved ports geri alındı, `ip_local_reserved_ports` 49160-49479, hashlimit 3, `check` OK, kurulu kopya güncel); UFW `49160:49479/udp` eklendi, `49160:49199/udp` silindi (**4450 açık kaldı** — staging; P2 terfi sonrası); coturn `--force-recreate` healthy (min/max-port 49160/49479, total-quota 300, max-bps 1000000, relay-ip 192.168.25.10, 5766 yok, 9641 yalnız 127.0.0.1); `test-denied.sh` **66 PASS / 0 FAIL**. `deploy/.env` `TURN_URLS` IP → `remote.noktabilisim.net` (LE sertifikası ad doğrular), `up -d server` healthy. **proxy-guard (§20.9):** nftables 1.0.9 (nftables.service etkinleştirilmedi); `install` → uid {0,33}, `check` OK, `verify OK` (root bağlandı, nobody reddedildi), nginx→4451 `/login` 200, timer active, `Before=docker.service`; docker grubu boş. `remote-watch`: 22 kontrol OK + offsite uyarısı. **Kalan:** pfSense P1 (WAN UDP 49160–49479 → 192.168.25.10, 1:1; şu an dışarıdan yalnız 49160–49199 ulaşır), eski özel CA/sertifikalar `deploy/turn/certs/` henüz silinmedi (§20.5 son satırı; test makinelerindeki kök kaldırılabilir), `WATCH_ALERT_CMD` boş |
| 2026-11-15 | Düzeltme (Oturumlar, firma seçmemiş Super Admin) | `a71d80e` (web; server/migrate aynı kod, yeni etiket) | — | Yedek `/root/remote-pre-a71d80e-20261114T225117Z.sql.gz`; migrate değişiklik yok; Super Admin firma seçmeden "Yeni destek oturumu" → 403 "Önce bir firma seçin." (ref `01M7E3VHE3JX32DX85YWH867B8`) yerine oluştur/iptal/sonlandır gizlenir + bilgi notu. Duman: 4450 `/login` ve `/ready` 200; 4451 `/login` 200, oturumsuz `/sessions` 307; yeni bileşen web derlemesinde. Eski `b7b4891` imajları silindi (disk %72) |
| 2026-11-15 | P13b-L (bekleme odası göstergesi, AC-304..316) | `0ecbc03` (server + web; migrate yok) | — | Yedek `/root/remote-pre-0ecbc03-20261114T234124Z.sql.gz`; migrate değişiklik yok. Duman: 4450 `/login` ve `/ready` 200; 4451 `/login` 200, oturumsuz `GET /api/v1/sessions/waiting` 401. Eski `a0265be` imajları silindi (disk %72). AC-316 (Windows istemcisiyle uçtan uca) kullanıcı testini bekliyor |
| 2026-11-15 | P13c kod kısmı (parametreleştirme, yedek SIGPIPE düzeltmesi) | `8517725` (yalnız deploy/ betikleri; imaj değişmedi) | — | `git pull`; `docker compose config` önce/sonra birebir aynı (çıktılar `shred` ile silindi); `up -d` değişiklik yok. `remote-backup.service` elle koşuldu: `audit-sureklilik: ok env=staging`, Result=success (tek yığın staging prod yollarıyla yedeğe devam ediyor, S13C-13) |
| 2026-11-15 | P14a + P14b (AC-201..230) | `0dd1d99` (server + web + migrate) | `20261116000000_p14a_security`, `20261116010000_p14a_mysql_tls` | Yedek `/root/remote-pre-0dd1d99-20261115T020818Z.sql.gz`; ön kontrol ihlalsiz geçti, iki migration uygulandı, `users.version` var. Duman: 4450 (HTTPS) `/login` ve `/ready` 200; 4451 `/login` 200, oturumsuz `GET /api/v1/users/options` ve `POST /api/v1/auth/step-up` 401; server logunda hata yok. Eski `e865e19` imajları silindi; disk %80 (build cache prune kullanıcı onayına bırakıldı) |
| 2026-11-15 | P15 (AC-231..239) | `67f6b2b` (server + web + migrate) | `20261117000000_p15_g3` | Yedek `/root/remote-pre-67f6b2b-20261115T033245Z.sql.gz`; migration uygulandı. Duman: 4450 (HTTPS) `/login` ve `/ready` 200; 4451 `/login` 200, oturumsuz `GET /api/v1/request-blocks` 401, `/request-blocks` girişe yönlendiriyor (307); server logunda hata yok. Eski `a71d80e` imajları silindi; disk %82 (build cache prune kullanıcı onayına bırakıldı) |
| 2026-11-15 | P16 (AC-240..244) | `c13f6d8` (server + web + migrate) | `20261118000000_p16_hard_delete` | Ön kontrol (`deleted_at` dolu, DELETED olmayan kullanıcı) 0; `BACKUP_EXPECTED_TRIGGERS` boş (= 22). Yedek `/root/remote-pre-c13f6d8-20261115T055358Z.sql.gz`; migration uygulandı, tetikleyici 22, `remote_ledger` volume oluştu (`/var/lib/remote` node 0700). Duman: 4450 `/login` ve `/ready` 200; 4451 `/login` 200, oturumsuz `GET /api/v1/admin/purge-jobs` ve `DELETE /api/v1/users/:id` 401; server logunda hata yok. Elle `remote-backup.service`: OK, tetikleyici 22, imha defteri boş (0 satır). `RETENTION_PURGE_MODE` boş (= dry). Bekleyen: 24 sa uçtan uca firma silme, restore + replay/verify provası, alarm kanalı (S16-12). Eski `0ecbc03` imajları silindi |
| 2026-11-15 | P17 (istemci 0.11.0; web konsol pencere modu rozeti) | `00b6687` (server + web + migrate imajı) | — (yeni migration yok) | Yedek `/root/remote-pre-00b6687-20261115-073902.sql.gz`; migrate "No pending migrations", tetikleyici 22. Duman: 4450 `/health`, `/login`, `/api/v1/health` 200; 4451 `/login` 200; server logunda hata yok. main CI 43689643033 (yeniden koşuda yeşil; ilk koşuda TEST-P5-1 ve coturn 2-allocation ölçümü kararsız), agent-win 43689643042 yeşil. İstemci 0.11.0 Release yayımlanmadı (§24; P15 prod ön koşulu). Eski `0dd1d99` imajları silindi |
| 2026-11-15 | P18 (talep iletişimi: kuyruk, atama, SLA/mesai/tatil, kabul öncesi mesaj) | `b0570c8` (server + web + migrate imajı) | `20261119000000_p18_request_comms` | Ön kontrol: `tenant_purge_jobs` RUNNING/FAILED 0, `log_bin=1`, `log_bin_trust_function_creators=1`; yedek `/root/remote-pre-b0570c8-20261115-091118.sql.gz` (600); migrate OK, tetikler **22 → 23**. CI `43696731001` üçüncü denemede yeşil (coturn testi kararsız; sağlamlaştırma ayrı iş). Duman: 4450 `/health`, `/login`, `/api/v1/health` 200; 4451 (Host başlığı) `/login` 200, yeni uçlar oturumsuz 401; server log hata 0. `remote-watch` yeniden kuruldu (§20.4): **OK (36 kontrol)** + offsite uyarısı (önceden var). Eski imaj `67f6b2b` silindi (`00b6687`, `c13f6d8` duruyor); disk %70. `APP_ENCRYPTION_KEYS` migrate ortamında yok (crypto CLI tek seferlik `-e` ile, §25). |
| 2026-11-15 | P19 (web talep formu `/r/<ref>`, SMS/WhatsApp bağlantı gönderimi, bildirim kuyruğu, SMS ayarı, müşteri CSV) | `db30b2d` (server + web + migrate imajı; caddy yeniden yaratıldı) | `20261120000000_p19_web_requests`, `20261120010000_p19_request_session_mode` | Ön kontrol: `tenant_purge_jobs` RUNNING/FAILED 0; tablo boyutları küçük (`support_requests` 22, `support_sessions` 39 satır) → COPY ALTER anlık (build + up + migrate toplam 65 sn). Yedek `/root/remote-pre-db30b2d-20261115-110918.sql.gz` (600); `.env` yedeği `/root/.env.bak.p19.*`; `.env`: `SMSPORTAL_URL=` (boş — SMS kanalı staging'de yapılandırılmadı). Migrate OK, tetikler **23** (değişmedi). CI `43706534669` coturn ikinci denemede yeşil (yeni kararsız adım: test-denied §4 aralık içi echo; inceleniyor). **Caddy:** Caddyfile değişti (`/r/***` süzgeci) → `caddy validate` + `up -d --force-recreate caddy`; ilk duman testinde ref logda görünmüştü (konteyner eski yapılandırmadaydı), yeniden yaratma sonrası logda ref 0, `"uri":"/r/***"`. Duman: 4450 `/health`, `/api/v1/health`, `/login` 200; 4451 (Host) `/login` 200, `/r/<ref>` 200 (CSP nonce + `strict-dynamic`, `Referrer-Policy: no-referrer`), geçersiz ref form ucu 404, `/settings/sms` ve `customers/export.csv` oturumsuz 401; server log hata 0. `remote-watch` yeniden kuruldu: **OK (41 kontrol)** + offsite uyarısı. Eski imaj `c13f6d8` silindi (`00b6687`, `b0570c8` duruyor); disk %70. İlk P19 gece yedeği 23:03 UTC (tetik beklentisi 23). |
| 2026-11-15 | P20 (istemci 0.12.0: tepsi + Windows açılışı, çoklu firma ≤5, talep öncesi sohbet, tek ana ekran; sunucu `binding.offer.multi`) | `cc2c91d` (server + web imajı; caddy değişmedi) | — (migration yok) | Yedek `/root/remote-pre-cc2c91d-20261115-131707.sql.gz` (600); `.env` yedeği `/root/.env.bak.p20.*`; `.env` yalnız `IMAGE_TAG`. build + up 58 sn, migrate "No pending migrations", tetikler **23** (değişmedi). CI: PR #7 agent-win (Windows `go test` + trace-check + tekrarlanabilirlik) ve ci (MySQL, e2e, Caddy, coturn) yeşil. Duman: 4450 `/health`, `/api/v1/health`, `/login` 200; 4451 (Host) `/login` 200, `/settings/sms` oturumsuz 401; server log error 0. `remote-watch` yeniden kuruldu: **OK (41 kontrol)** + offsite uyarısı. Eski imaj `00b6687` silindi (`b0570c8`, `db30b2d` duruyor); disk %68. **Yapılmadı:** 0.12.0 istemci exe yayını (agent-win `workflow_dispatch version=0.12.0` / imza — SignPath yok, AV kapısı §8d.8), Windows elle test turu (`docs/test-raporu.md` P20 A–H) |
| 2026-11-15 | PT (kod temizliği; davranış aynı) + `fix(jobs)` PT-K11-B1 | `d624dc6` (server + web + migrate imajı; caddy değişmedi) | — (migration yok) | Yedek `/root/remote-pre-d624dc6-20261115-154513.sql.gz` (600); `.env` yedeği `/root/.env.bak.pt.*`; `.env` yalnız `IMAGE_TAG`. build + up 116 sn, migrate "No pending migrations" (23). CI: PR #8 ci 43730100922 + agent-win 43730100926 yeşil (kararsız testler yeniden koşuda yeşil: Windows `TestAC254GP2016TwoProcessesNoLostUpdate`, entegrasyon S-P19-T12 — Sonra test kararlılığı). Duman: 4450 `/health`, `/api/v1/health`, `/login` 200; 4451 (Host) `/login` 200, `/api/v1/settings/sms` oturumsuz 401; server log error 0. `remote-watch` **OK (41 kontrol)** + offsite uyarısı. Eski imajlar `b0570c8`, `db30b2d` silindi (`cc2c91d` duruyor); disk %75 |
| 2026-11-15 | P27a (2FA "bu cihazı 30 gün hatırla") + P27 (Windows gözetimsiz erişim, imzasız staging) | `250b5b4` (server + web + migrate imajı; caddy değişmedi) | `20261121000000_p27a_trusted_devices`, `20261121010000_p27_unattended` | Yedek `/root/backups/remote-p27-20261115-183254.sql.gz` (600); `.env` yedeği `/root/.env.bak.p27.*`; `.env`: `IMAGE_TAG`, `UNATTENDED_MODE=unsigned` (`DEPLOY_ENV=staging` zaten vardı), `UNATTENDED_AGENT_SHA256` (publish-servis). Migrate "All migrations have been successfully applied". Açılış logu `unattended.mode=unsigned deployEnv=staging`. Servis ikilisi (imzasız, `https://remote.noktabilisim.net` gömülü, 0.13.0) SHA-256 `ce4e6c1c…` §27.3 ile yayınlandı, konteyner içi SHA eşit. CI: PR #10 HEAD `86ed103` tüm işler yeşil (test:int 923/923, e2e 480). Duman (alan adı): `/login` 200, `/api/v1/settings/sms` ve `/api/v1/unattended/status` oturumsuz 401, `/downloads/NoktaDestekServis.exe` 404 (Caddy public yolu yok). Not: `https://127.0.0.1:4450` SNI eşleşmediğinde Caddy boş 200 döndürür — duman testi alan adı veya `--resolve` ile yapılır. `remote-watch` **OK (41 kontrol)** + offsite uyarısı. Eski imajlar silindi (`d624dc6` duruyor). Windows duman testi (§27.2 adım 7) kullanıcıda |
| 2026-11-15 | SMTP düz bağlantıda AUTH + WhatsApp K13 geçici düz http izni (kullanıcı talebi) | `8cbaa03` (server + web + migrate imajı) | — | Yedek `/root/backups/remote-smtpwa-20261115-231044.sql.gz` (600); `.env` yedeği `/root/.env.bak.smtpwa.20261115-231044`; `.env`: `IMAGE_TAG`, `WHATSAPP_SERVICE_URL` (whatsapp-bildirim servisi), `WHATSAPP_ALLOW_INSECURE_HTTP=true` (kullanıcı kararı; HTTPS'e geçince `false`). Açılış logu `alarm:"whatsapp_insecure_http_allowed"` (beklenen). Duman (alan adı): `/login` 200, `/api/v1/admin/settings/whatsapp` oturumsuz 401. `remote-watch` OK (41 kontrol) + offsite uyarısı. Eski imajlar silindi (`250b5b4` duruyor). Kullanıcı: SMTP'de "Yok" + kullanıcı adı/şifre girip "Test Maili Gönder"; Super Admin WhatsApp "Test Mesajı Gönder" |
| 2026-11-15 | LG — müşteriye bağlantı gönderme (AC-405..428) | `410cdd2` (server + web + migrate imajı) | `20261122000000_link_send` | Yedek `/root/backups/remote-lg-20261115-235139.sql.gz` (600); `.env` yedeği `/root/.env.bak.lg.20261115-235139`; `.env`: yalnız `IMAGE_TAG`. Migrate "All migrations have been successfully applied" (`link_send`). qa tur 2 GEÇTİ, güvenlik kod turu 1 GEÇTİ (Düşük 3: D-LGK-1 düzeltildi, D-LGK-2 runbook §12.3/§20.3, D-LGK-3 kılavuz). Yerel tam `test:int` 948/950 — 2 P27 zamanlama testi yük altında kararsız, tek başına 19/19 (Sonra: test kararlılığı). Duman (alan adı): `/login` 200, oturumsuz `POST /api/v1/customer-send/options` 401, geçersiz belirteçle `GET /api/v1/public/unattended/download` 404. `remote-watch` OK (41 kontrol) + offsite uyarısı. Eski imajlar silindi (`8cbaa03` duruyor) |
| 2026-11-16 | P28a — pano senkronu + uzaktan yazdırma (AC-343..352, 404) | `987b2f1` (server + web + migrate imajı); servis ikilisi 0.13.0 SHA-256 `0fdd335a309fa90b87c89fefdeafc7c488ad33f2149c06a946a57fa4cda6e7ab` (`publish-servis.sh --dir`, `PUBLISHED.log` servis satırı) | yok | Yedek `/root/backups/pre-p28a-20261115223604.sql.gz` (600); `.env` yedeği `/root/.env.bak.p28a.20261115223604`; `.env`: yalnız `IMAGE_TAG`. qa GEÇTİ (şartlı: Windows elle maddeleri), güvenlik kod turu 1 GEÇTİ (Düşük 2 düzeltildi). CI yeşil (agent-win Windows: PDF işleyici yalıtım varyantları + Print to PDF + D-P28a-3 öz testi). İstemci 0.13.0 (SHA-256 `bb79da86ef7f98dccf264e9bf59ebf78b454842d6d487bffaa9310eeb686d79d`, iki derleme özdeş) **staging indirmeye yayınlanmadı**: `verify-and-publish.sh` S13C-13 kilidi tek yığın staging'e yalnız Release `vX.Y.Z` kabul eder; kullanıcı kararıyla exe doğrudan teslim edildi, `/downloads/NoktaDestek.exe` 0.12.x (`85142c14…`) kalır, resmi yayın P28 sonu `v0.13.0`. Duman: `/login` 200. `remote-watch` OK (41 kontrol) + offsite uyarısı. Bekleyen elle Windows turu (kullanıcı): AC-346, AC-349, AC-350, AC-289, D-P28a-1, diyalogda Enter=Reddet |
| 2026-11-16 | P28b — sunucuda dosya + ClamAV + depolama kotası (AC-353..363) + K9 düzeltmeleri (B2/B3) | `ec713f2` (P28b; migration `20261123000000_p28b_stored_files`, audit-continuity yeni özet) → `cdd4813` (K9: clamd ilk açılış imza yarışı, AV yoklama yeniden denemesi); yeni servisler `clamav` + `clamav-update` (`clamav/clamav:1.5.4@sha256:45fe5149…`) | yok (varsayılanlar; `AV_SUBNET` 172.30.2.0/28) | Yedekler `/root/backups/pre-p28b-20261116-084713.sql.gz`, `/root/backups/pre-p28bk9-*.sql.gz` (600); `.env` yedekleri `/root/.env.bak.*`; `.env`: yalnız `IMAGE_TAG`. qa tur 2 GEÇTİ, güvenlik kod turu 1 GEÇTİ (Düşük 4 düzeltildi). CI yeşil. Kapı 3 `check-av-isolation.sh` GEÇTİ, dışarıdan 3310 kapalı; kapı 6 host available 6,6–7,6 GiB; clamd sınırları 512M/256M. İlk açılışta clamd eski daily'yi yükledi (B2) → `restart` + kalıcı düzeltme `cdd4813`. ClamAV ayarı ilk testten sonra panel kaydında. K9 staging test hesapları (kullanıcı onayıyla): `k9-test@staging.invalid` (SUPER_ADMIN) + `k9-tech@staging.invalid` (ADMIN, demo), kimlik yalnız `/root/.k9-staging-test.env` (600), betikler `/root/k9/` (§28b.8). Uçtan uca duman `staging-smoke-p28b.sh` GEÇTİ: EICAR INFECTED, 50 MB son parça→CLEAN 3,05–3,21 sn (AC-357), log 0 sızıntı. Build cache 10 GB temizlendi (disk %69–77). Windows istemci sunucu modu elle maddeleri kullanıcıda. Not: K9 sırasında eski staging test şifreleri (ACCESS.txt) yerel araç çıktısına düştü → kullanıcıya değiştirmesi önerildi |
| 2026-11-16 | P28u — gözetimsiz cihazda izinli / izinsiz bağlantı + müdahale (AC-429..446) | `7056496` (PR #16; migration `20261124000000_p28u_unattended_consent` uygulandı) | yok (`.env`: yalnız `IMAGE_TAG`) | Yedek `/root/backups/pre-p28u-*.sql` (600), `.env` yedeği `/root/.env.bak.*`. qa tur 2: 1–9 kapandı (yalnız Windows elle test açık), güvenlik kod turu 2 GEÇTİ (0/0/0/0), K10 sayfa testi GEÇTİ + bulgular düzeltildi. CI yeşil. `check-app-grants.sh` 796/798: 2 FAIL ortamsal (staging'de panelden kaydedilmiş `system_settings.clamav` satırı → probe `Duplicate entry`; yetki ihlali değil). Yedek + `audit-sureklilik: ok`; `check-av-isolation.sh` GEÇTİ; `remote-watch` kuruldu, `unattended-notify-fail` 1. Servis 0.15.0 `publish-servis.sh --dir` (unattested, staging): SHA-256 `623963b3821776b1be8327544bda37a2c9f6f02fed252193bd8f7c10e48c2fca`; istemci 0.15.0 (doğrudan teslim) `fc2a182b1165f1bd6f8b266ddeb3b48110fd1ba844298d95b0f5c1b8973676df`; iki derleme aynı SHA (tekrarlanabilir). `MIN_AGENT_VERSION` değişmedi. Windows elle turu (§28u.8, spike §3 kilit) kullanıcıda |
| 2026-11-16 | P28e — oturum kaydı (katılımlı + gözetimsiz; AC-380..388, 447..450) | `5c1c961` (PR #17; migration `20261125000000_p28e_recordings` uygulandı, `session_consents` 65 satır — pencere gerekmedi) | yok (`.env`: yalnız `IMAGE_TAG`) | Yedek `/root/backups/pre-p28e-*.sql` (600), `.env` yedeği `/root/.env.bak.*`. qa tur 4 GEÇTİ (13 AC), güvenlik kod turu 4 GEÇTİ (0/0/0/0), K10 sayfa testi bulguları düzeltildi (dd8a692). CI yeşil. `check-app-grants.sh` 873/873. Caddy `validate` + `--force-recreate` (`@recPart`); CSP `media-src 'self' blob:`. Yedek + `audit-sureklilik: ok`; `check-av-isolation.sh` GEÇTİ; `remote-watch` OK (54 kontrol, `rec-stop-error` kurulu). Servis 0.16.0 `publish-servis.sh --dir` (unattested, staging): SHA-256 `97389d528bf3a5752bfd4bbac4105a58aaee521ea572ca8e576802fb8c7574f2`; istemci 0.16.0 (doğrudan teslim) `311ce63d78e28cfa9faf4f2c0a422eba52e8cac1acf01c24025e6523d0f3de4a`; iki derleme aynı SHA. `MIN_AGENT_VERSION` değişmedi. Windows/tarayıcı elle turu (§28e.8, 21 madde) kullanıcıda |
| 2026-11-17 | P28c — çoklu teknisyen (davet, İzle, kontrol/oturum devri, çıkarma; AC-364..372 + AC-352 metni) | `47b85e4` (PR #18; migration yok — "No pending migrations") | yok (`.env`: yalnız `IMAGE_TAG`) | Yedek `/root/backups/pre-p28c-*.sql` (600), `.env` yedeği `/root/.env.bak.*`. qa tur 2 GEÇTİ, güvenlik kod turu 2 GEÇTİ (0/0/0/1, D-PC-K5 düzeltildi), K5 sayfa testi GEÇTİ (D-1 düzeltildi). CI yeşil. `check-app-grants.sh` 873/873. Caddy değişmedi. Yedek + `audit-sureklilik: ok`; `check-av-isolation.sh` GEÇTİ; `remote-watch` OK (55 kontrol, `multi-denied` kurulu). Servis 0.17.0 `publish-servis.sh --dir` (unattested, staging): SHA-256 `4420df0db819edcb80e8d02d71eacf578b488758ab23054c253dc5ca519361fd`; istemci 0.17.0 (doğrudan teslim) `ae54e3e3c5e902d51ec4849add0245a90c0d60abe2cb57b5570c771b205ecde8`; iki derleme aynı SHA. `MIN_AGENT_VERSION` değişmedi. Windows elle turu (§28c.7) + AC-371 ölçümü (§28c.8) kullanıcıda |
| 2026-11-17 | Vitrin görsel dili (tasarım paketi C: tokenlar, Plus Jakarta Sans + JetBrains Mono self-host) | `5ec2a1f` (PR #19; migration yok) | yok (`.env`: yalnız `IMAGE_TAG`) | Yedek `/root/backups/pre-vitrin-*.sql` (600), `.env` yedeği `/root/.env.bak.*`. Web e2e 557/557 (axe + taşma dahil), CI yeşil (P28e AC-383 testi toplam tampon süresine geçirildi). `check-app-grants.sh` 873/873. Caddy/CSP değişmedi (font `/_next/static/media` aynı kaynak, 200 `font/woff2`). Yedek + `audit-sureklilik: ok`; `check-av-isolation.sh` GEÇTİ; `remote-watch` OK (55 kontrol). Servis 0.17.0 SHA değişmedi. Not: `set -a; . ./.env` yapılmış kabukta `IMAGE_TAG` değiştirip build etmek eski etiketi kullanır — build'i yeni kabukta yap |
| 2026-11-17 | P28d — sesli görüşme (Opus libopus wasm + wazero, mix-minus, yerel Kabul; AC-373..379) | `e378564` (PR #21; migration yok — "No pending migrations") | yok (`.env`: yalnız `IMAGE_TAG`) | Yedek `/root/backups/pre-p28d-20261117055743.sql` (600), `.env` yedeği `/root/.env.bak.p28d.*`. qa tur 2 GEÇTİ (Windows elle ölçüm staging'e), güvenlik kod turu 2 GEÇTİ (0/0/0/0; A-PD-4 wazero yeniden onay), sayfa testi bulguları (1280 px başlık çakışması, 375 px taşma) düzeltildi. CI yeşil (`libopus-wasm` dahil). `check-app-grants.sh` 873/873. Caddy değişmedi. Yedek + `audit-sureklilik: ok`; `check-av-isolation.sh` GEÇTİ; `remote-watch` OK. Servis 0.18.0 `publish-servis.sh --dir` (unattested, staging): SHA-256 `a4676c5c4aca74739a14b01587c276f6bfe3db681cb529c64f6f9c8d20662463`; istemci 0.18.0 (doğrudan teslim) `712c2403365f0aa6f4f6d464961ffeb96f4244c0e9340a07efa84a5277fb967a`; iki derleme aynı SHA. `MIN_AGENT_VERSION` değişmedi. Windows elle turu (§28d.7) + AC-376 gecikme / AC-378 üç teknisyen / kodlayıcı CPU payı (§28d.8) kullanıcıda |
| 2026-11-17 | P28d saha düzeltmesi 1 — Windows çalma varsayılan aygıta (eConsole) + `tanilama.log` ses özeti | `4cb3da8` (PR #23; yalnız istemci) | — | Sunucu/servis değişmedi (staging `e378564`, servis 0.18.0 kalır). İstemci 0.18.1 (doğrudan teslim) SHA-256 `d1a38d739aa98ada5ac1c2e61601635b8b2e3a3971b9e07dd7390999f236a9fc`; iki derleme aynı SHA. CI yeşil. Saha: teknisyen → Windows müşteri sesi duyulmuyordu (olası neden: varsayılan iletişim aygıtı ≠ hoparlör); Windows doğrulaması kullanıcıda |
| 2026-11-17 | P28f — macOS istemci (TEST, imzasız) + sunucu `clientOs`/`os` audit, macOS indirme kapısı, availability, OS_PERMISSION; karşılama sayfası macOS | `51ff907` (PR #24) | yok ("No pending migrations") | Ön yedek `/root/backups/pre-p28f-*`; Caddy yeniden başlatıldı (`@agentZip`); `check-app-grants` 873/873; `remote-backup` audit-sureklilik ok; `check-av-isolation` GEÇTİ; `/login` 200. macOS TEST zip 0.19.0 (`.stg`, ad-hoc + hardened runtime, universal, 10,3 MB) SHA-256 `251d5ae0da8f2db3b5b0af9f2186bf4a2e28642d9ffe8fc76eec7219b5b57765`; availability `{windows:true, macos:true, macosTestBuild:true}`. Servis 0.19.0 `3dc713c9c61edfa96dadb57d69686f40e1098870e6e93bc3f45f9867c0f4a256`, istemci 0.19.0 `f58461eba67eec1371d1755bd7086c5014ab96c8f0737216d1f0295e5c7e3a7a` (doğrudan teslim); tüm ikililer iki derlemede aynı SHA. macOS elle listesi (`docs/test-raporu.md` P28f) kullanıcıda; prod macOS Apple hesabı + notarization sonrası (R39) |
| 2026-11-19 | P22 (oturum sohbeti) + P28u r3 (gözetimsiz onaysız) + P21 (müşteri portalı) + P28g (Linux istemci); istemci/servis 0.20.0 | `d813bc3` / `d813bc3b` (server + web + migrate; caddy yeniden yaratıldı) | `20261126000000_p22_session_chat`, `20261127000000_p21_customer_portal` (ikisi uygulandı; `/ready` → `migration: 20261127000000_p21_customer_portal`) | CI main: `ci` 44511613324 yeşil; `agent-win` 44511613458 **ikinci denemede** yeşil (ilk denemede `TestAC253GP205ScopesResetPerSession` `-race` 3 sn ve 22.04 `TestAC402P28gGTKClipRoundTrip` düştü; ağaç PR başı `cc73ced` ile aynı ve PR koşusu yeşil → oynaklık). Ön kontrol: `BACKUP_EXPECTED_TRIGGERS` boş, purge işi 0, `log_bin` `1 1`. Ön yedek `20261119T113320Z` OK (audit-sureklilik ok), `.env` yedeği `/root/.env.bak.p28g.20261119T113318Z`; `.env`: `IMAGE_TAG`, `LINUX_AGENT_SHA256` (publish-linux yazdı). Caddyfile (`@agentLinux`) çalışan caddy içinde `caddy validate --config /dev/stdin` → Valid (bind-mount `git pull` sonrası eski inode'u gösterir; `compose run caddy` sabit IP çakışmasıyla açılmaz) → `up -d --force-recreate caddy`. Seed 1. koşu `consentTextsCreated=1`, 2. koşu `0` (§29.1 adım 4 provası GEÇTİ). `check-app-grants` **929/929 PASS**, FAIL 0, tetikleyici 23. Sonraki yedek `20261119T114028Z` OK, `audit-sureklilik: ok seq=16`. `check-av-isolation` GEÇTİ. `remote-watch` yeniden kuruldu: 54 kontrol OK (`session-chat-internal`, `portal-login-fail`, `portal-locked`, `portal-request-reject` = 1) + offsite uyarısı + **disk %86 → eski `e378564` imajları silindi → %83 (eşik %80, alarm açık)**. Sunucu yayınının hemen ardından servis 0.20.0 (§28u.10, imzasız) `publish-servis.sh --dir` SHA-256 `87b37dc9f4ec262ad4df17ad3e09fff34db32830c07296affa339b433caa1442`; macOS TEST zip 0.20.0 `publish-mac.sh --dir` `64129ebc1ec90261e61ca34260addea018aa4ae6e27b3013e55993be033ca61e`; Linux TEST ELF 0.20.0 `publish-linux.sh --dir` `6387f765fa472e399b908c066997477b4530212d903c5b77c98267fe2ad4f807` (octet-stream, Last-Modified yok); Windows istemci 0.20.0 (doğrudan teslim, S13C-13) `7d9eba5b6118dc8066d37680bd14c7cf5f71f7fd4f4a9a60f318868a84ec7114`. Tüm ikililer iki derlemede aynı SHA. Linux için CI main artefaktı kullanılamaz (main push yer tutucu `destek.example.invalid` + 0.0.0 gömer; `--stg-run` yalnız ikinci yığın) → §28g.5 yerel yol. `publish-mac.sh` düzeltmesi: `pipefail` + `grep -q` codesign'a SIGPIPE (5 denemede 1 "ad-hoc değil") → `grep … >/dev/null`, sonra 6/6 + kilit testi GEÇTİ. Duman: `/health` ve `/ready` iç ağdan 200 (dışarıya kapalı, tasarım), alan adında `/login`, `/portal/login`, `/portal/login?tenant=demo` 200 (gövdeli), oturumsuz `/api/v1/portal/me` 401, availability `{windows,macos,macosTestBuild,linux: true}`, `/downloads/NoktaDestek-linux` 200; server log `level 50` 0, Caddy logunda `tenant=` 0; `rs_portal_*` ve `rs_session_chat_rejected_total` metrikleri var. **Açık:** §30.3 adım 4–11 portal akışı ve §29.1 adım 7 sohbet dumanı (test-operatoru), §29.5 alarm provası, Windows/macOS/Linux elle turları, test VM'lerinde servis güncellemesi (§28u.5), disk alarmı (build cache temizliği kullanıcı onayına) |
| 2026-11-19 | P22-G (Go istemci oturum sohbeti) + P29 (istemci otomatik güncelleme, ADR-0040); istemci/servis 0.22.0 | `1d706ce` / `1d706cef` (server + web + migrate; caddy değişmedi) | `20261128000000_p29_client_update` (uygulandı; `/ready` → `migration: 20261128000000_p29_client_update`) | CI main: `ci` 44539303636 ve `agent-win` 44539303644 yeşil (ilk denemede). Ön kontrol: `BACKUP_EXPECTED_TRIGGERS` boş, purge işi 0, `log_bin` `1 1`, `unattended_devices` 2 satır (COPY ALTER ms). Ön yedek `20261119T140459Z` OK (audit-sureklilik ok), `.env` yedeği `/root/.env.bak.p29.20261119T140457Z`; `.env`: `IMAGE_TAG`, `UNATTENDED_AGENT_SHA256`, `MAC_AGENT_SHA256`, `LINUX_AGENT_SHA256` (yayın betikleri yazdı). Disk: build öncesi eski `51ff907` imajları silindi (%77 → %74), build sonrası %83 (build cache 6,4 GB; eşik %85 aşılmadığından prune yapılmadı, `disk:*` alarmı açık). **`UPDATE_MANIFEST_PUBKEYS` boş** (staging/prod anahtarı henüz üretilmedi, `build/update-keys/` yalnız README; §31.2 çevrimdışı, kullanıcı): server `UPDATE_MANIFEST_DIR` boş, `GET /api/v1/public/agent/update?platform=windows|linux|macos…&component=client` **204** (üçü), `/downloads/update/…` 404. Bu yüzden 0.22.0 ikilileri **güncelleyici kapalı** derlendi (anahtar gömülü değil) ve kendini hiç güncellemez; anahtar üretilince yeniden derleme + elle kurulum gerekir (§31.2 m.5). 0.21→0.22 güncelleme akışı denenemedi. Seed `consentTextsCreated=0`. `check-app-grants` **955/955 PASS**, FAIL 0, tetikleyici 23. Sonraki yedek `20261119T142050Z` OK, `audit-sureklilik: ok seq=18`. `check-av-isolation` GEÇTİ. `remote-watch` yeniden kuruldu: 57 kontrol, `disk:*` dışı hepsi 1 + offsite uyarısı; `update-*` kontrolleri ilk P29 serisine (ya da `WATCH_UPDATE_MANIFEST_REQUIRED=1`) kadar değerlendirilmez (tasarım). İkililer (hepsi iki derlemede aynı SHA, `--dir` unattested, staging): servis 0.22.0 `4cdd4a937e2f536333a837e4a87d21154ff1e1ec360a88ecc01bc71c888e6436`; macOS TEST zip 0.22.0 `acdd28efca50b2344bedfe9d9472373339581798337cbdfa4c681f77afefd167`; Linux TEST ELF 0.22.0 `16ec141847252cc6f8990e2960f3c076890885c9dcb0f037c421790824fe349b`; Windows istemci 0.22.0 (doğrudan teslim, S13C-13; `/downloads/NoktaDestek.exe` değişmedi) `ee7a0239d05baff3391f642103cbc8a6412054b801b9efbaa6ab7ea243dd2a0a`. Availability `{windows,macos,macosTestBuild,linux: true}`. Duman: `/health` (clamav reachable) ve `/ready` iç ağdan 200; `/login`, `/portal/login`, `/portal/login?tenant=demo` 200 (4450 ve alan adı), oturumsuz `/api/v1/portal/me` 401. **§29.1 adım 7 sohbet dumanı GEÇTİ** (protokol düzeyi, K9 teknisyen hesabı, tarayıcı misafiri `rs.cap.schat1`): resolve `chatRetentionDays=365`, `peer.joined guestChat=on`, misafir `chat.state enabled=true`, 4/4 iki yönlü mesaj (yankı + karşı taraf), `session_messages` sırası TECH,CUSTOMER,TECH,CUSTOMER, oturum ENDED, audit `session.chat_summary {tech:2, customer:2, legacy:false}` + `session.chat_viewed`. Server log `level 50` 1: `tenant_purge_failed invalid_job` jobId `…GRANTJ` = `check-app-grants.sh` prob satırı (purge işçisi test sırasında gördü; tablo sonrası 0) — zararsız, test kalıntısı; Caddy logunda `tenant=` 0. **Açık:** P29 anahtar üretimi (§31.2, kullanıcı) → staging 0.22.x anahtarlı derleme + 24 sa staging + güncelleme dumanı (§31.4); Windows/macOS/Linux 0.22.0 GUI elle turları (§29.8 duman, P29 panel rozeti); test VM'lerinde servis güncellemesi (§28u.5); §29.5 alarm provası; disk alarmı. Rollback: `IMAGE_TAG=d813bc3b` → `docker compose up -d` (şema geri alma gerekmez, AC-493) |
| 2026-11-20 | P30 (gözetimsiz çizim web metni) + P30b (kontrol açıkken çizim, AC-498 r2; yalnız web) + `effect` ≥3.22.1 override (GHSA-7589-6fvf-x4pw) | `8de7a56` / `8de7a569` (server + web + migrate; caddy değişmedi) | — (migration yok) | CI PR #37 yeşil (macOS `TestP28fK2AC392LateWindowExcluded` yeniden koşuda yeşil). Ön yedek `20261119T230610Z` OK; `.env` yedeği `/root/.env.bak.p30b.*`; `.env` yalnız `IMAGE_TAG`. Eski `d813bc3b` imajları silindi (`1d706cef` geri dönüş için duruyor). build + up + seed 134 sn, migrate başarılı. Duman: 4450 `/health`, `/api/v1/health`, `/login` 200; 4451 (Host) `/login` 200, `/api/v1/settings/sms` oturumsuz 401; alan adı `/login` 200; server log error 0; web paketinde "Çizim modu" metni var. **Disk %87 → %78**: build cache 9,17 GB kullanıcı onayıyla (2026-11-20) `docker builder prune -af` ile temizlendi; konteynerler etkilenmedi. İstemci yeniden kurulumu gerekmez |
| 2026-11-20 | P31 (macOS Hızlı Destek "Destek iste": firma zip yolu `@agentZipFirm`, iç uç `/internal/agent-ready/macos-firm`) + P32 kodu (imzasız gözetimsiz `unsigned-accepted` modu; staging modu değişmedi) + P28f-r4 (`MAC_AGENT_SIGNING`); macOS TEST zip 0.24.0 | `a26f712` / `a26f712d` (server + web + migrate; caddy yeniden yaratıldı) | `20261129000000_p31_request_client_os` (uygulandı; `/ready` → `migration: 20261129000000_p31_request_client_os`) | Ön kontrol: `BACKUP_EXPECTED_TRIGGERS` boş, `tenant_purge_jobs` satırı yok, `log_bin` `1 1`, tetikleyici 23. Ön yedek `20261120T015401Z` OK (`audit-sureklilik: ok seq=21`), `.env` yedeği `/root/.env.bak.p31.20261120T015359Z`. `.env`: `IMAGE_TAG`, `MAC_AGENT_SHA256` + `MAC_AGENT_SIGNING=adhoc` (publish-mac yazdı); P32 için yeni anahtar eklenmedi (staging `UNATTENDED_MODE=unsigned` + `DEPLOY_ENV=staging` yeni kurallardan geçer; `UNATTENDED_AGENT_VERSION` yalnız `unsigned-accepted`'te zorunlu, compose'un boş dizesi `withoutBlanks` ile tanımsız) — açılış logu `unattended.mode=unsigned deployEnv=staging`. Disk: build öncesi eski `1d706cef` imajları silindi (%78 → %75), build sonrası **%84** (`8de7a569` geri dönüş için duruyor; prune yapılmadı, `disk:*` alarmı açık). `git pull origin main` → `a26f712d`; Caddy 3. adıma kadar yeniden başlatılmadı (S-P31-1). `check-app-grants` **966/966 PASS**, FAIL 0. §32.2 m.3 iç uç: doğru ad **204**, yanlış label 404, maskeli URI 404, `.exe` 404 → Caddyfile çalışan caddy içinde stdin'den `validate` Valid → `up -d --force-recreate --no-deps caddy` (log: yalnız zararsız `tls internal` truststore satırı). `remote-watch`: `watch.env`'e `WATCH_DEPLOY_ENV=staging` eklendi (root 600), P32 betiği yeniden kuruldu; tur: `BILGI unattended-deploy-env OK DEPLOY_ENV=staging`, `unattended.state` ilk kez yazıldı (mode-changed ALERT yok), ALERT yalnız `disk:/`, `disk:/var/lib/docker`, `disk:/var/backups/remote` %84 + offsite uyarısı. macOS TEST zip 0.24.0 (§28f.4 yerel `--dir`, `golang:1.26.11-bookworm`, stg profili, ad-hoc, güncelleyici kapalı — `update-keys/` hâlâ yalnız README): ince ikililer arm64 `43caa4064e52492dee25ce7fb1c0e4504d063abcba8c8c7c9164e75bf79da502`, amd64 `67e03828ae65ecab24a85688b27f315408fdaeab579306935f06941193c3d3fc`; zip `351762167fb69c2b0814e7d797f46523379db956dbb18ae2a8f895818cb17ec0` (10 718 698 B, parmak izi `3bd7d70e`) — iki derleme + iki paketlemede aynı SHA; `publish-mac.sh --dir … --no-attestation` dry-run sonra `--ssh` → `dir-20261120020055-unattested`, kontrol SHA = `MAC_AGENT_SHA256`. Availability `{windows,macos,macosTestBuild,linux: true, macosSigning: adhoc}`. Dış duman (§32.2 m.6, ref maskeli): Mac UA Location `/downloads/NoktaDestek-<label>-<ref>.zip`, curl UA `.exe`, firma zip 200 `application/zip` + `content-disposition` adı, gövde SHA = zip SHA, bozuk label 404, jenerik zip 200; Caddy ve server logunda ref **0** (Caddy `NoktaDestek-***`). `/health` ve `/ready` iç ağdan 200, 4450 `/login` 200 (`/api/v1/health` uç yok → 404, beklenen). Server log `level 50` **0**. Sonraki yedek `20261120T020147Z` OK, `audit-sureklilik: ok seq=22`. Runbook düzeltmesi: §32.2 firma bağlantı yolu `/api/v1/public/agent/request-download`. **Açık:** gerçek Mac'te elle E-P31-1..7 (Destek iste akışı, kullanıcı); P32 K5 staging provası (`unsigned-accepted`, §27.9 m.2; Release yok); macOS CI `TestP28fK2AC392LateWindowExcluded` oynaklığı; disk %84 alarmı; P29 anahtar üretimi (0.24.0 da güncelleyicisiz). Rollback (§32.3 ters sıra): `git -C /opt/remote checkout 8de7a569 -- deploy/Caddyfile && docker compose up -d --force-recreate --no-deps caddy` → `IMAGE_TAG=8de7a569` → `docker compose up -d --no-deps server web` (mod `unsigned`, önce `off` gerekmez; sütun geri alınmaz); Mac zip için `publish-mac.sh --withdraw` |

Rollback hedefi: bir önceki satırdaki `IMAGE_TAG`; şema geri alması gerekiyorsa §6.

### 8.1 Staging TURN durumu (2026-11-11)

- **Kurulu ve sunucu içinde doğrulandı** (§9.1 adımları): `remote-turn` compose projesi `healthy`, host OUTPUT kuralı +
  `remote-turn-fw.timer` aktif, UFW'ye 3478/udp, 3478/tcp, 5349/tcp, 49160:49199/udp eklendi (yorum `remote-turn*`; mevcut
  22/80/443 kurallarına dokunulmadı). Kanıtlar: `docs/test-raporu.md` "P3 staging altyapı kanıtı".
- Sırlar sunucuda: `deploy/turn/.env` (600, root; `TURN_SECRET` `deploy/.env` ile aynı), `deploy/.env`'e `TURN_URLS`,
  `TURN_SECRET`, `TURN_CRED_TTL_MIN` (boş = 20), `METRICS_TOKEN` eklendi (önceki `.env` yedeği `/root/remote-deploy-env.bak.*`,
  600). Çalışan server bu değişkenleri **okuyor** (P3+P4 yayını 2026-11-11, `IMAGE_TAG=0f1b89a`); değiştirildiğinde
  `docker compose up -d server` ile yeniden yüklenir.
- Staging CA: `deploy/turn/certs/ca.crt` (test makinelerine kurulur, §9.4); `ca.key` sunucuda (600, root).
  `denied-peer-ip.local.conf`: sağlayıcı /24 + Proxmox yönetim IP'si + TURN'ün kendi IP'si (§9.5).
- `sudo -E ./test-denied.sh` (2026-11-11): 60 PASS / 3 FAIL — 2'si kota/kapasite (486, "Cannot complete Allocation";
  elle yeniden denemede 403 PASS), 1'i aralık içi relay↔relay echo (genel IP VM'de yerel değil → hairpin gerekir; NAT +
  reflection açılınca yeniden koşulur). Aralık dışı 3480/3478/53 DROP PASS. Ayrıntı test-raporu.
- **Dış erişim: AÇIK (2026-11-11, pfSense NAT kuralları §8.2 uygulandı).** Dış makineden (genel IPv4) doğrulama:
  3478/tcp ve 5349/tcp bağlanıyor; `turnutils_stunclient` XOR-MAPPED = istemcinin genel IP'si (SNAT yok);
  `turnutils_uclient -y` (relay↔relay, NAT reflection) UDP / TCP / TLS-5349: 0 kayıp, RTT ort. 6–7 ms (kısa ömürlü HMAC
  kimliği sunucuda üretildi, secret yazdırılmadı). Sunucuda `test-denied.sh`: 62 PASS / 1 FAIL — FAIL kapasite beklemesi
  ("Cannot complete Allocation"); aynı adres (172.31.255.255) elle tekrarda 403 → fiilen 63/63. **S-P3-2 aralık içi
  relay↔relay echo PASS** (hairpin artık çalışıyor). Log: sunucuda `/root/test-denied-nat.log`.
- **Uygulandı (tarihçe, 2026-11-11 P3+P4 yayını):** `deploy/turn/` artık repoda; aşağıdaki prosedür yalnız kayıt içindir,
  yeni kurulumda gerekmez. `deploy/turn/` repoya girmeden önce rsync ile kopyalanmıştı (sunucuda `?? deploy/turn/`; sırlar
  `.git/info/exclude`'da). İlk `git pull`'da "untracked working tree files would be overwritten" çıkarsa sırlar korunarak:
  ```bash
  cd /opt/remote/deploy/turn && mkdir -p /root/turn-keep && cp -a .env denied-peer-ip.local.conf certs /root/turn-keep/
  cd /opt/remote && rm -rf deploy/turn && git pull /root/remote.bundle main
  cp -a /root/turn-keep/. deploy/turn/ && rm -rf /root/turn-keep
  cd deploy/turn && sudo ./host-firewall.sh install && docker compose up -d   # betik değiştiyse kurulu kopya güncellenir
  ```
  (coturn konteyneri çalışmaya devam eder; `rm -rf` yalnız bind-mount kaynaklarını kaldırır, `cp -a` ile hemen geri gelir.)

### 8.2 pfSense'te açılacak TURN kuralları (ağ yöneticisi için)

Firewall > NAT > Port Forward, her satır için "Filter rule association: Add associated filter rule".

| #   | Arayüz | Protokol | Kaynak | Dış hedef (WAN adresi) | Dış port             | Yönlendirilen iç IP | İç port                           |
| --- | ------ | -------- | ------ | ---------------------- | -------------------- | ------------------- | --------------------------------- |
| 1   | WAN    | UDP      | any    | 185.126.217.99         | 3478                 | 192.168.25.10       | 3478                              |
| 2   | WAN    | TCP      | any    | 185.126.217.99         | 3478                 | 192.168.25.10       | 3478                              |
| 3   | WAN    | TCP      | any    | 185.126.217.99         | 5349                 | 192.168.25.10       | 5349                              |
| 4   | WAN    | UDP      | any    | 185.126.217.99         | 49160–49199 (aralık) | 192.168.25.10       | 49160 (aralık 1:1, port değişmez) |

- **Kaynak adres korunur:** bu kurallar için Outbound NAT / SNAT / masquerade **olmamalı** (4450 kuralı gibi). SNAT olursa
  coturn tüm istemcileri ağ geçidi adresinden görür; denied-peer-ip ve XOR-MAPPED-ADDRESS bozulur.
- **Port değişmez:** 4. kural aralığı 1:1 eşlemeli (pfSense'te iç port alanına yalnız başlangıç 49160 yazılır). Outbound
  NAT'ta 192.168.25.10 kaynaklı UDP için "Static Port" işaretli olmalı (relay'in dışarı giden paketleri port değiştirmeden çıkar).
- **NAT reflection:** 1 ve 4 numaralı kurallarda "NAT reflection: Enable (Pure NAT)" önerilir (relay↔relay, aynı
  TURN'e bağlı iki uç). Açılamazsa staging'de relay↔relay test edilmez (P13'te prod ağında).
- **UDP durum zaman aşımı ≥ 60 sn:** System > Advanced > Firewall & NAT > "Firewall Optimization Options" = Normal veya
  Conservative (varsayılan Normal'de UDP multiple = 60 sn; "Aggressive" SEÇİLMEZ).
- Doğrulama (dış makineden): `turnutils_stunclient 185.126.217.99` → XOR-MAPPED-ADDRESS = o makinenin genel IP'si;
  `nc -vz 185.126.217.99 3478` ve `5349` bağlanır; sonra sunucuda `docker compose -f deploy/turn/docker-compose.yml logs --since 5m coturn`
  istemcinin genel IP'sini göstermeli (192.168.25.1 görünürse SNAT var).

### 8.3 Alan adı: `https://remote.noktabilisim.net` (host nginx + Let's Encrypt; ADR-0015)

DNS: Cloudflare A `remote` → 185.126.217.99, **DNS only (gri)** — proxied yapılırsa ACME ve gerçek IP bozulur. P31'den beri
`/downloads/NoktaDestek-*` için `limit_req` (IP başına 10/dk) da `$remote_addr`'a dayanır: proxied yapılırsa tüm müşteriler tek
kovaya düşer ve indirme herkes için 429 olur (§32.4).
Akış: istemci → host nginx :443 (LE, `remote.noktabilisim.net` vhost'u) → `http://127.0.0.1:4451` (Caddy, yalnız loopback)
→ web/server. IP girişi `https://185.126.217.99:4450` geçiş süresince aynen çalışır (`SITE_HOST` IP olarak kalır).

- **vhost:** repo `deploy/nginx/remote.noktabilisim.net.conf` = sunucu `/etc/nginx/sites-available/remote.noktabilisim.net`
  (+ `sites-enabled` linki). Yalnız `remote_` önekli map/log_format tanımlar; diğer sitelerin dosyalarına dokunulmaz.
  İçerik: 80 → ACME webroot + 301; 443 → `X-Forwarded-For $remote_addr` (istemci XFF'i ezilir), WS upgrade,
  `proxy_read_timeout 3700s`, `client_max_body_size 2m`, `gzip off`, `proxy_buffering off`; güvenlik başlığı EKLEMEZ
  (CSP/HSTS uygulama + Caddy). Log: `/var/log/nginx/remote.access.log` JSON, `uri` maskeli (`/session/***`,
  `/downloads/Destek-***`), sorgu dizesi/çerez/Authorization/Referer/Sec-WebSocket-Protocol yok; hata logu `crit`.
- **vhost güncelleme** (her seferinde `nginx -t`; başarısızsa eski dosyaya dön):

```bash
scp deploy/nginx/remote.noktabilisim.net.conf root@185.126.217.99:/root/remote.conf.new
ssh root@185.126.217.99 'cp /etc/nginx/sites-available/remote.noktabilisim.net /root/remote.conf.prev \
  && cp /root/remote.conf.new /etc/nginx/sites-available/remote.noktabilisim.net \
  && { nginx -t && systemctl reload nginx || { cp /root/remote.conf.prev /etc/nginx/sites-available/remote.noktabilisim.net; nginx -t && systemctl reload nginx; echo GERI ALINDI; }; }'
```

- **Sertifika (ilk kurulum, 2026-11-12 yapıldı):** önce yalnız 80 bloğu olan vhost (443 bloğu yokken nginx -t sertifika
  dosyasını arar), sonra:
  `install -d /var/www/remote-acme && certbot certonly --webroot -w /var/www/remote-acme -d remote.noktabilisim.net --non-interactive --deploy-hook "nginx -t && systemctl reload nginx"`
  ardından tam vhost. Yenileme: sistem `certbot.timer` (günde 2), renewal dosyası `authenticator = webroot`,
  `renew_hook` reload eder. Prova: `certbot renew --dry-run --cert-name remote.noktabilisim.net` → "all simulated renewals succeeded" (2026-11-12 GEÇTİ).
  Bitiş: `certbot certificates --cert-name remote.noktabilisim.net`.
- **Uygulama `.env`:** `PUBLIC_BASE_URL=https://remote.noktabilisim.net` (oturum linkleri, CSP wss host'u, web→server
  Origin), `ALLOWED_ORIGINS=https://remote.noktabilisim.net,https://185.126.217.99:4450` (IP girişi kapatılınca
  ikincisi silinir), `SITE_HOST=185.126.217.99` (değişmez). Yedek: `deploy/.env.bak.domain.<UTC>`. Etkisi
  `docker compose up -d` ile (server/web yeniden yaratılınca) — Caddy 4451 yayında olmadan uygulanırsa linkler 502'ye gider.
- **Windows istemci:** alan adı gömülü istemci (`AGENT_SERVER_URL=https://remote.noktabilisim.net`, GitHub repo
  değişkeni, §11.1; ardından yeni derleme + `verify-and-publish`) için **kök sertifika kurulumu gerekmez**.
  IP:4450 gömülü eski istemciler (≤ 0.8.1) aynı DB'ye bağlanır, onlar için §8 "Kök CA" geçerliliğini korur.
  `AGENT_WATCH_URL` → `https://remote.noktabilisim.net/downloads/NoktaDestek.exe`, `AGENT_WATCH_CA_PEM` boşaltılır.
- **Doğrulama (yayından sonra):**

```bash
curl -sI https://remote.noktabilisim.net/ | head -1                      # -k YOK; 307/200
curl -s -o /dev/null -w '%{http_code}\n' https://remote.noktabilisim.net/login      # 200
# wss el sıkışması: ticket'sız 101 beklenmez; Caddy'nin server'a ilettiğini gösterir (401/403 JSON, 502 değil)
curl -s -o /dev/null -w '%{http_code}\n' --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" -H 'Origin: https://remote.noktabilisim.net' \
  https://remote.noktabilisim.net/ws/tech
# gerçek IP + sahte XFF: dış makineden yanlış parolayla giriş dene (X-Forwarded-For: 1.2.3.4 ekleyerek), sonra sunucuda:
docker compose logs caddy --since 5m | grep -o '"client_ip":"[^"]*"' | sort | uniq -c   # dış IP; 1.2.3.4 / 172.30.0.128 YOK
# + §1 audit sorgusu → ip_address = dış IP
ss -ltn | grep 4451                                                        # yalnız 127.0.0.1:4451
curl -s -o /dev/null -w '%{http_code}\n' https://support.noktabilisim.net/  # diğer siteler etkilenmedi
```

- **Geri dönüş (alan adını kapat):** `rm /etc/nginx/sites-enabled/remote.noktabilisim.net && nginx -t && systemctl reload nginx`;
  `.env`'de `PUBLIC_BASE_URL=https://185.126.217.99:4450` (yedekten) → `docker compose up -d server web`. Caddy 4451
  zararsız kalabilir (yalnız loopback). Sertifikayı tamamen silmek: `certbot delete --cert-name remote.noktabilisim.net`.

## 9. TURN / coturn (P3; mimari §8.3.1, ADR-0007 r3/r5)

Dosyalar `deploy/turn/`: `docker-compose.yml` (ayrı compose projesi `remote-turn`, `network_mode: host`),
`turnserver.base.conf` (repo; sabit ayarlar + sabit denied-peer-ip listesi), `entrypoint.sh` (base + env + local
listeyi `/tmp/turnserver.conf`'a birleştirir; eksik/hatalı girdide başlamaz), `denied-peer-ip.local.conf`
(git-ignore; altyapı IP'leri), `gen-cert.sh` (staging CA + IP SAN'lı sertifika), `host-firewall.sh` (host OUTPUT kuralı,
§9.2.1), `test-denied.sh`, `test-local.sh`. Entrypoint `relay-ip=<özel IPv4>` (IPv6 relay kapalı, §9.2.2) ve `TURN_LISTEN_IPS=auto` ise `listening-ip` satırlarını (özel IPv4 + 127.0.0.1) üretir.
İmaj `coturn/coturn:4.18.0-alpine@sha256:…` (nobody, salt okunur, yalnız `NET_BIND_SERVICE`).

### 9.1 Kurulum (staging, sunucuda; uygulama yığınından bağımsız)

```bash
cd /opt/remote/deploy/turn
cp ../../.env.example .env && chmod 600 .env        # yalnız TURN_* doldurulur (aşağıdaki tablo)
cp denied-peer-ip.local.conf.example denied-peer-ip.local.conf   # gerçek IP'lerle düzenle (9.5)
./gen-cert.sh 185.126.217.99                         # root ile; certs/ca.crt test makinelerine kurulur (9.4)
sudo ./host-firewall.sh install                      # S-P3-2 OUTPUT kuralı + systemd timer (§9.2.1) — coturn'den ÖNCE
docker compose up -d && docker compose ps            # "healthy"
set -a && . ./.env && set +a && ./test-denied.sh     # 0 FAIL olmalı (9.7)
```

Uygulama tarafı (`deploy/.env`): `TURN_URLS`, `TURN_SECRET` (coturn'dekiyle **aynı**), `TURN_CRED_TTL_MIN` → `docker compose up -d server`.

| Değişken                             | Nerede                             | Değer                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TURN_SECRET`                        | `deploy/.env` + `deploy/turn/.env` | `openssl rand -hex 32` (≥ 32; boşluk/`#` yok). İki dosyada aynı                                                                                                                                                                                                                                                                                                                                                                             |
| `TURN_URLS`                          | `deploy/.env`                      | staging `stun:185.126.217.99:3478,turn:185.126.217.99:3478?transport=udp,turn:185.126.217.99:3478?transport=tcp,turns:185.126.217.99:5349?transport=tcp`                                                                                                                                                                                                                                                                                    |
| `TURN_CRED_TTL_MIN`                  | `deploy/.env`                      | boş = **20** (5..60; env.ts + compose varsayılanı, S-P3-6: credential oturum bitince iptal edilemez)                                                                                                                                                                                                                                                                                                                                        |
| `METRICS_TOKEN`                      | `deploy/.env`                      | `openssl rand -hex 24`; `/metrics` Bearer (Caddy dışarıya 404)                                                                                                                                                                                                                                                                                                                                                                              |
| `TURN_REALM`                         | `deploy/turn/.env`                 | staging `185.126.217.99`, prod `turn.<alan-adı>`                                                                                                                                                                                                                                                                                                                                                                                            |
| `TURN_EXTERNAL_IP`                   | `deploy/turn/.env`                 | staging `185.126.217.99/192.168.25.10` (public/özel)                                                                                                                                                                                                                                                                                                                                                                                        |
| `TURN_SECRET_PREVIOUS`               | `deploy/turn/.env`                 | yalnız rotasyon sırasında (9.6)                                                                                                                                                                                                                                                                                                                                                                                                             |
| `TURN_MAX_BPS` / `TURN_BPS_CAPACITY` | `deploy/turn/.env`                 | 8000000 / 0 (sınırsız; K3 ölçümüyle)                                                                                                                                                                                                                                                                                                                                                                                                        |
| `TURN_PROMETHEUS_ADDRESS`            | `deploy/turn/.env`                 | 127.0.0.1 (9641 dışa açılmaz)                                                                                                                                                                                                                                                                                                                                                                                                               |
| `TURN_LISTEN_IPS`                    | `deploy/turn/.env`                 | staging/prod **`auto`** → `listening-ip=<özel relay IPv4>` + `listening-ip=127.0.0.1` (3478/5349 diğer Docker köprü ağ geçitlerinde ve IPv6'da dinlenmez). Virgüllü IPv4 listesi de verilebilir; 127.0.0.1 healthcheck (`turnutils_stunclient 127.0.0.1`) ve `test-denied.sh` (`TURN_HOST=127.0.0.1`) için her zaman eklenir. Boşsa coturn tüm arayüzlerde dinler, entrypoint UYARI yazar. Kontrol: `ss -tulnp \| grep -E ':(3478\|5349) '` |

### 9.2 Sunucu güvenlik duvarı (UFW, 185.126.217.99 / VM 192.168.25.10)

Staging'de TURN = uygulama IP'si; relay kendi IP'sine (`allowed-peer-ip`, relay↔relay) açık olduğundan bu IP'de
dinleyen **her** port relay ile erişilebilir → yalnız aşağıdakiler açık; hiçbir servis "kaynak = 185.126.217.99" diye güvenmez.

```bash
ufw default deny incoming && ufw default allow outgoing
ufw allow 22/tcp && ufw allow 4450/tcp
ufw allow 3478/udp && ufw allow 3478/tcp && ufw allow 5349/tcp && ufw allow 49160:49199/udp
ufw enable && ufw status numbered          # 9641, 5766 (CLI) listede OLMAMALI
```

Not: Docker'ın yayımladığı portlar (4450) UFW'yi DOCKER zinciriyle atlar; coturn host network'te olduğundan UFW'ye tabidir.
Paylaşımlı sunucudaki başka projelerin portları için UFW değişikliği öncesi `ss -lntup` ile envanter alın.

#### 9.2.1 Host OUTPUT kuralı — relay↔relay sızıntısı (S-P3-2, ADR-0007 r5 m.4; **P3 kapanış şartı**)

Sorun: `allowed-peer-ip=<public IP>` (relay↔relay) coturn'de port ayırmaz → relay, host'un kendi adresindeki **her** UDP
portuna (53 DNS, 3478 = TURN-in-TURN, SNMP, syslog…) paket gönderebilir; loopback/hairpin UFW INPUT'u atlar.
Çözüm `deploy/turn/host-firewall.sh` (root, idempotent): filter/OUTPUT başına tek atlama → `REMOTE-TURN-OUT` zinciri:
`-p udp --sport 49160:49199 -d <public|özel|LOCAL> ! --dport 49160:49199 -j DROP` (IPv4; `ip6tables` varsa IPv6 `LOCAL`
kuralı). Ek: relay aralığı `net.ipv4.ip_local_reserved_ports`'a eklenir (mevcut değerle birleştirilir) → aralıktan kaynak
port yalnız açıkça bind eden coturn'de olur; başka süreçlerin geçici portları (ör. 127.0.0.53:53 DNS sorgusu) etkilenmez.
Docker (DOCKER-_/nat) ve UFW (ufw-_) zincirlerine dokunmaz; diğer projelere etkisi yalnız "aralıktan çıkan UDP → kendi
adresine aralık dışı port" paketidir.

```bash
cd /opt/remote/deploy/turn
./host-firewall.sh print                       # uygulanacak kurallar (TURN_EXTERNAL_IP .env'den; secret okunmaz)
sudo ./host-firewall.sh install                # apply + systemd remote-turn-fw.service/.timer (açılış + 5 dk'da bir ensure)
sudo ./host-firewall.sh check                  # "host-firewall: OK"
sudo iptables -L REMOTE-TURN-OUT -vn           # DROP sayaçları (test-denied bölüm 4 bunları okur)
ls -l /usr/local/sbin/remote-turn-fw /etc/default/remote-turn-fw   # root root 0755 / root root 0644
journalctl -u remote-turn-fw -p err --since -1h   # boş olmalı (sapma/onarım hatası err önceliğiyle yazılır)
```

**Kurulu kopya (S-P3-T2-2):** `install` betiği `/usr/local/sbin/remote-turn-fw` (root:root 0755) olarak kopyalar,
girdileri `/etc/default/remote-turn-fw`'ye (root:root 0644; yalnız `TURN_EXTERNAL_IP`, `TURN_FW_SELF_IPS`, port aralığı,
`TURN_FW_RESERVE_PORTS` — secret yok) yazar; systemd birimi **yalnız bu kopyayı** çalıştırır, repo klonunu ve `.env`'i
okumaz. Kurulu kopya `/etc/default` dosyası root sahibi değilse ya da group/other yazabiliyorsa çalışmaz.
**`git pull` ile `host-firewall.sh`/`turnserver.base.conf` değiştiğinde veya `.env`'de `TURN_EXTERNAL_IP`/`TURN_FW_SELF_IPS`
değiştiğinde `sudo ./host-firewall.sh install` YENİDEN çalıştırılır** (değişiklik incelendikten sonra); aksi halde timer
eski kopyayı/değerleri uygulamaya devam eder. `/etc/default/remote-turn-fw` elle düzenlenmez.
**Fail-closed uygulama (S-P3-T2-1):** kurallar önce `REMOTE-TURN-OUT-NEW`'de kurulur; tek kural bile eklenemezse geçici
zincir silinir, mevcut `REMOTE-TURN-OUT` ve atlaması değişmeden kalır (exit 1). Başarıda yeni zincire atlama OUTPUT
başına eklenir, eskisi silinir, yeni zincir yeniden adlandırılır (koruma kesintisiz). IP girdisi tam dize olarak
doğrulanır (IPv4 oktet 0..255, baştaki sıfır yok; IPv6 grup/`::` kuralı); çok satırlı değer reddedilir.
Reserved ports kontrolü "aralık bir girdi tarafından kapsanıyor mu"dur (çekirdek komşu aralıkla birleştirse de geçer);
`remove` eklemeden önceki listeyi (`/var/lib/remote-turn-fw/reserved.before`) kullanarak yalnız bizim eklediğimiz
portları geri alır. `ensure` sapma bulursa/onaramazsa journald'a `err` yazar; onaramazsa birim `failed` olur
(`systemctl --failed` alarmı).
Kalıcılık: `ufw reload|disable|enable` veya `iptables -F OUTPUT` atlamayı silerse timer en geç 5 dk'da `ensure` ile geri
kurar (UFW değişikliğinden sonra hemen: `sudo systemctl start remote-turn-fw.service`). Prod'da ek IPv6/IP:
`TURN_FW_SELF_IPS=<v6>,<v4>` (`deploy/turn/.env`, ardından `install`). Geri alma: `sudo ./host-firewall.sh uninstall`
(birim + kural + reserved port + `/usr/local/sbin/remote-turn-fw` + `/etc/default/remote-turn-fw` + `/var/lib/remote-turn-fw`). Doğrulama: `sudo -E ./test-denied.sh` bölüm 4 — aralık içi port echo döner; aralık dışı 3480, `:3478`, `:53` DROP.

#### 9.2.2 IPv6 relay kapalı (S-P3-3, ADR-0007 r5 m.5)

Entrypoint `relay-ip=<TURN_EXTERNAL_IP iç kısmı>` (public-only kurulumda public IPv4) üretir → IPv6 relay allocation 440 ile
reddedilir (`test-denied.sh` "IPv6 relay allocation reddedildi"). Staging'de host'ta global IPv6 yok (S-P2-5): test
"IPv6 SKIP/ayırt edilemez" gerekçesiyle INFO basar, IPv6 denied satırları 403/440 ile erişilemez sayılır. Prod: host'ta
global IPv6 varsa relay yine IPv4'tür; IPv6 relay ileride açılırsa önce host /64'ü ve sağlayıcı IPv6 bloğu local listeye
`a-b` biçiminde eklenir + `TURN_FW_SELF_IPS` (P13/prod açılış şartı).

#### 9.2.3 Yayın sonrası çalışma zamanı kontrol listesi (staging/prod, her coturn yayınında)

```bash
ss -tlnp | grep -E ':5766|:9641'      # 5766 (CLI) HİÇ görünmemeli; 9641 yalnız 127.0.0.1:9641
ss -ulnp | grep -E ':3478|:49(1[6-9][0-9])'   # 3478 + relay; çıktı test-raporu'na eklenir (S-P3-2)
sudo ./host-firewall.sh check          # OK
docker compose run --rm -e TURN_CONFIG_CHECK=1 coturn | grep -E 'relay-ip|allowed-peer-ip|external-ip'
systemctl is-active remote-turn-fw.timer   # active
systemctl cat remote-turn-fw.service | grep ExecStart   # /usr/local/sbin/remote-turn-fw ensure (repo yolu DEĞİL)
cmp /usr/local/sbin/remote-turn-fw ./host-firewall.sh && echo "kurulu kopya güncel"   # farklıysa install yeniden
```

CLI 4.18'de `--cli` verilmedikçe kapalıdır; `no-cli` **yazılmaz** (4.18'de "deprecated" ERROR basar, ADR-0007 r5 m.3).
Entrypoint base.conf'ta `cli*`, `verbose`, `log-binding` satırı görürse başlamaz.

### 9.3 Üst NAT (pfSense) kuralları — ağ yöneticisine talep

| Arayüz | Proto | Dış hedef      | Dış port    | İç hedef      | İç port     | Not                            |
| ------ | ----- | -------------- | ----------- | ------------- | ----------- | ------------------------------ |
| WAN    | UDP   | 185.126.217.99 | 3478        | 192.168.25.10 | 3478        | STUN + TURN/UDP                |
| WAN    | TCP   | 185.126.217.99 | 3478        | 192.168.25.10 | 3478        | TURN/TCP                       |
| WAN    | TCP   | 185.126.217.99 | 5349        | 192.168.25.10 | 5349        | TURN-TLS                       |
| WAN    | UDP   | 185.126.217.99 | 49160–49199 | 192.168.25.10 | 49160–49199 | relay, **1:1 (port değişmez)** |

Kurallar: kaynak adres korunur (outbound/SNAT yok — "NAT reflection" yalnız hairpin için), UDP durum zaman aşımı ≥ 60 sn,
hairpin (NAT reflection) 3478/udp + 49160–49199/udp için tercihen açık (açılamazsa relay↔relay staging'de test edilmez, P13).
Doğrulama (dışarıdaki bir makineden): `turnutils_stunclient 185.126.217.99` → XOR-MAPPED-ADDRESS = o makinenin public IP'si.

### 9.4 TURN-TLS sertifikası

Staging: `./gen-cert.sh 185.126.217.99` → `certs/ca.crt` (5 yıl, yeniden kullanılır), `certs/turn.crt|key` (365 gün, IP SAN).
`ca.crt` test makinelerine güvenilen kök olarak kurulur (§8 Caddy kökü gibi; macOS `security add-trusted-cert`, Windows
`certutil -addstore -f Root`). `ca.key` sunucuda kalır (600, root), yedeği parola kasasında; repoya girmez (`.gitignore`).
**Yenileme** (alarm: sertifika < 14 gün; kontrol `openssl x509 -in certs/turn.crt -noout -enddate`):
`./gen-cert.sh 185.126.217.99 && docker compose restart coturn` (açık TURN oturumları ICE restart ile yeniden bağlanır;
test oturumu yokken yapın). Sertifika yoksa coturn TLS'siz (`no-tls`) başlar ve logda UYARI yazar.
Prod: Let's Encrypt `turn.<alan-adı>` (ADR-0007), aynı `certs/turn.crt|key` yoluna kopyalanır + restart (P13).

### 9.5 denied-peer-ip yerel listesi (G-05)

`denied-peer-ip.local.conf` yalnız `denied-peer-ip=<ip>` veya `denied-peer-ip=<ip>-<ip>` satırları (CIDR değil). Staging içeriği:
sağlayıcı bloğu `185.126.217.0-185.126.217.255` (publish sunucusu dahil), Proxmox yönetim IP'si, TURN'ün kendi IP'si
`185.126.217.99` (entrypoint bunu `allowed-peer-ip` ile relay↔relay için yeniden açar). IP değişiminde yalnız bu dosya
güncellenir → `docker compose up -d --force-recreate coturn` → `test-denied.sh`. **Tek başına `::` yazmayın**: coturn 4.18
bunu "her adres" sayar ve tüm relay'i kapatır (test-denied kontrol peer'ı FAIL verir).

### 9.6 Secret rotasyonu (kesintisiz)

1. `deploy/turn/.env`: `TURN_SECRET_PREVIOUS=<eski>`, `TURN_SECRET=<yeni>` → `docker compose up -d coturn` (iki secret kabul).
2. `deploy/.env`: `TURN_SECRET=<yeni>` → `cd .. && docker compose up -d server`.
3. `TURN_CRED_TTL_MIN` dk (varsayılan 20; en çok 60 — en uzun credential ömrü) sonra `TURN_SECRET_PREVIOUS=` boşalt → `docker compose up -d coturn`.

### 9.7 Doğrulama testleri

- `./test-local.sh` (yerel/CI; Docker Desktop dahil): geçici secret/CA ile coturn'ü bridge ağda (`docker-compose.test.yml`,
  macOS'ta host network host'tan erişilemediği için) başlatır, `test-denied.sh` çalıştırır, yığını kaldırır (~2 dk).
- `test-local.sh` ayrıca: 5766 dinlenmiyor, `host-firewall.sh` iki kez apply → 2 kural/1 atlama (idempotent), yardımcı
  konteynerle (NET_ADMIN, coturn ağ ad alanı) bölüm 4'ü çalıştırır. Son koşu 2026-11-11 (P4 düzeltme 1, `TURN_LISTEN_IPS=auto` + 3478 dinleme adresi kontrolü): **62 PASS, 0 FAIL**.
- `test-denied.sh` (staging, **root**: `sudo -E`): HMAC credential (UDP/TCP/TLS) pozitif + yanlış secret/süresi geçmiş negatif + base ve local
  listedeki **her satırın ilk ve son adresine** 403 beklentisi (IPv6 satırları 403/440) + kontrol peer'ı 1.1.1.1 izinli +
  IPv6 relay allocation reddi (§9.2.2) + bölüm 4 host OUTPUT kuralı (§9.2.1; echo peer 3480 ve aralığın son portu
  49199'da `turnutils_peer` geçici konteynerle açılır). Staging'de ~60 allocation açar; 40 portluk aralık dolunca (508), user-quota aşılınca (486) veya yalnız "Cannot complete Allocation" görülünce (negatif kimlik/IPv6 relay testleri hariç) 30 sn arayla en çok `TURN_TEST_WAIT_MAX` (700) sn bekleyip aynı denemeyi tekrarlar: **test oturumu yokken**
  çalıştırın (~20–25 dk). Çıktı `docs/test-raporu.md`'ye eklenir.

### 9.8 İzleme ve sorun giderme

- Metrik: `curl -s http://127.0.0.1:9641/metrics | grep ^turn_` (sunucuda). Alarm (mimari §8.2): TURN down (healthcheck),
  `turn_allocations > 2×rs_active_sessions + 10`, sertifika < 14 gün, `remote-turn-fw.timer` aktif değil.
  Uygulama metrikleri (`/metrics`, Bearer `METRICS_TOKEN`): `rs_resolve_failed` (gauge; eski adı `rs_resolve_failed_total`
  kullanılmaz), `rs_ws_connections`, `rs_active_sessions` (gauge).
- **Dosya meta kotası (P5, `rs_file_meta_rate_limited_total{class}`; class = `accepted` | `declined` | `sender`):**
  | Kural                                                                 | Seviye    | Anlamı / ilk adım                                                                                                                                                                                                                                                                                                                                               |
  | --------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `rate(rs_file_meta_rate_limited_total{class="sender"}[5m]) > 0`       | **Uyarı** | Gönderen tarafın `file.meta` raporu kotayı aştı: olası audit şişirme veya değiştirilmiş istemci (normal arayüz bu hıza ulaşmaz). Server logunda `event=file_meta_rate_limited` → `sessionId`, `side`; audit `file.meta.rate_limited` (oda+sınıf başına dakikada en çok 1 satır). Oturumu ve teknisyeni inceleyin; gerekirse oturumu zorla sonlandırın (AC-114). |
  | `increase(rs_file_meta_rate_limited_total{class="accepted"}[1h]) > 0` | Bilgi     | Meşru yoğun dosya aktarımı da tetikleyebilir (dakikada 60 / oturumda 2000 OK+CORRUPT). Sürekli artıyorsa kota değerleri (`FILE_META_ACCEPTED_PER_*`) gözden geçirilir; tek oturumdan geliyorsa `sender` kuralı gibi incelenir.                                                                                                                                  |
  | `declined` sınıfı                                                     | Bilgi     | Otomatik ret/iptal döngüsü (istemci tekilleştirmesi bozuk olabilir); panoda izlenir, alarm yok.                                                                                                                                                                                                                                                                 |

#### 9.8.1 coturn log saklama (S-P3-9, KVKK)

coturn logu müşteri/teknisyen IP'si, peer IP'si ve username'i (`<expiry>:<sessionId>`) içerir (secret yok). Seviye normal
(`verbose`/`log-binding` yok; entrypoint engeller). Saklama: **en çok 7 gün** — boyut tavanı compose'da json-file
3×5 MB; süre tavanı host cron'u (root, `/etc/cron.d/remote-turn-log`):

```
15 3 * * 0 root f=$(docker inspect -f '{{.LogPath}}' remote-turn-coturn-1 2>/dev/null) && [ -n "$f" ] && rm -f "$f".[0-9]* && truncate -s 0 "$f"
```

(Haftalık: rotasyonla oluşan `.1/.2` silinir, aktif dosya boşaltılır → hiçbir satır 7 günden eski kalmaz; Docker json-file
boşaltılan dosyaya yazmaya devam eder. Kontrol: `docker compose logs coturn | head -1` tarihi ≤ 7 gün.) Olay
incelemesi için gerekli kayıt bu süre içinde dışa alınır (`docker compose logs --since 24h coturn > ...`, şifreli saklanır).
Aydınlatma metni/VERBİS kaydında "TURN bağlantı logu, 7 gün" olarak geçer (proje-yoneticisine not).

| Belirti                                                       | Kontrol / çözüm                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| coturn sürekli yeniden başlıyor                               | `docker compose logs coturn` → `turn-entrypoint:` satırı eksik env/local dosyayı söyler                                                                                                                                                                                |
| `exec: turnserver: Operation not permitted`                   | `cap_add: [NET_BIND_SERVICE]` silinmiş (ikili dosya yeteneği taşır)                                                                                                                                                                                                    |
| İstemciler relay adayı almıyor                                | `TURN_SECRET` iki .env'de farklı (log: `message integrity does not match`); `TURN_URLS`; UFW/NAT 3478                                                                                                                                                                  |
| Relay adayı var, medya yok                                    | NAT relay aralığı 1:1 değil veya eksik; `TURN_EXTERNAL_IP` yanlış; `tcpdump -ni ens18 udp portrange 49160-49199`                                                                                                                                                       |
| `error 508` (kapasite)                                        | 40 port dolu: `turn_allocations` metriği; test-denied çalışıyorsa bitmesini bekleyin                                                                                                                                                                                   |
| Relay↔relay (aynı TURN) medya yok                             | `host-firewall.sh print`: aralık `min-port/max-port` ile aynı mı; DROP sayacı artıyorsa hedef port aralık dışı (beklenen)                                                                                                                                              |
| coturn logunda `ERROR no-cli option is deprecated`            | base.conf'a `no-cli` eklenmiş — kaldırın (r5 m.3)                                                                                                                                                                                                                      |
| Her peer 403                                                  | local dosyada çok geniş satır (ör. `::`); `docker compose run --rm -e TURN_CONFIG_CHECK=1 coturn` ile birleşik yapılandırmayı görün (secret maskeli)                                                                                                                   |
| TLS (5349) bağlanmıyor                                        | `certs/turn.key` sahibi 65534 değil / dosya yok (logda `no-tls` UYARISI); test makinesinde `ca.crt` kurulu değil                                                                                                                                                       |
| Yalnız `turn:…?transport=tcp` ile ICE kurulmuyor (TEST-NAT-2) | Altyapı değil (2026-11-11 tanısı, implementation.md): `turnutils_uclient -t -y -n 50 -m 1 <özel IP>` 0 kayıp olmalı; minimal iki-PC Chrome testi bağlanıyorsa sorun uygulama/harness'ta (`ice.servers` → `setConfiguration`)                                           |
| coturn logunda `udp send: Operation not permitted`            | Çoğunlukla `REMOTE-TURN-OUT` DROP'u (relay → kendi adresi, aralık dışı port; test-denied'de beklenir): `iptables -L REMOTE-TURN-OUT -vnx` sayacı aynı anda artar. Tek satır bağlantıyı kesmez; sürekli artıyorsa `nf_conntrack_count/max`                              |
| UDP relay'de kayıp patlaması, TCP/TLS temiz (TEST-NAT-3)      | Sunucu: `ip -s link show ens18` drop, `nstat -az UdpRcvbufErrors UdpSndbufErrors` 0 ise kayıp sunucu öncesinde (istemci uplink / pfSense UDP state-kuyruk); koşu sırasında `tcpdump -ni ens18 udp portrange 49160-49199` paket sayısını istemci kaybıyla karşılaştırın |

## 10. Gerçek sunucu e2e (yerel; P4 regresyonu, QA-P5-6)

Tek komut (repo kökü, Docker + `pnpm install` + Playwright chromium gerekir): `scripts/e2e-real.sh` (~2 dk).

1. Çalışma ağacının anlık görüntüsünü `$TMPDIR/rs-e2e-real.*/repo`'ya alır (APFS klon, `.git`/`.next` hariç) — paralel
   çalışan biri `apps/web/.next`'i veya kaynağı değiştirse de koşu tutarlı kalır.
2. Geçici MySQL `rs-mysql-e2e-real` (127.0.0.1:33317; entegrasyon testinin `rs-mysql-test`/33307'siyle çakışmaz) →
   migrate + grants → seed → `e2e:real:users` (iki ADMIN) → server :3302 → Playwright (web standalone build,
   `API_INTERNAL_URL=http://127.0.0.1:3302` derlemeye gömülü, :3218) → temizlik (trap: server, web, konteyner, kopya).
3. Seed/kullanıcı parolaları ve DB parolaları her koşuda rastgele; ekrana/dosyaya yazılmaz. Trace varsayılan kapalı
   (`E2E_REAL_TRACE=1` açar; iz o koşunun atılan parolasını içerir).

| Değişken                           | Varsayılan                    | Not                                                             |
| ---------------------------------- | ----------------------------- | --------------------------------------------------------------- |
| `E2E_DB_CONTAINER` / `E2E_DB_PORT` | `rs-mysql-e2e-real` / `33317` | çakışmada değiştirin                                            |
| `E2E_SERVER_PORT`                  | `3302`                        | web portu 3218 sabit (config)                                   |
| `E2E_KEEP_LOGS=1`                  | —                             | başarıda da `server.log` + `test-results/` saklanır             |
| `E2E_REAL_REF=<git ref>`           | —                             | çalışma ağacı yerine commit'lenmiş sürüm (karşılaştırma koşusu) |
| `TEST_DB_READY_TIMEOUT`            | `180`                         | MySQL hazır olma bekleme süresi (sn); `test-db.sh` de okur      |

Çıkış kodu: 0 geçti · 1 test kırmızı · 2 ön koşul (port/konteyner dolu, Docker yok) · 3 kurulum (DB/seed/server).
Kırmızıda loglar `$TMPDIR/rs-e2e-real.*/` altında kalır (yol son satırda yazılır).

| Belirti                                                                                                  | Neden / çözüm                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KURULUM HATASI: test DB / migrate`, üstünde `test-db: HATA — … hazır olmadı` + konteyner logu (çıkış 3) | MySQL `TEST_DB_READY_TIMEOUT` (varsayılan 180 sn) içinde gerçek sunucuyu (`mysqld: ready for connections … port: 3306`) açmadı veya app/migrator `SELECT 1` geçmedi. Log `Switching to dedicated user 'mysql'`'de kaldıysa Docker Desktop VM'sinde gosu asılması (test-db.sh bunu `--user mysql` ile atlar; eski bir `E2E_REAL_REF` koşturuyorsanız o sürümde bu yoktur). Yüklü makinede `TEST_DB_READY_TIMEOUT=300`; sürekli tekrarlıyorsa Docker Desktop'ı yeniden başlatın (diğer konteynerleri de durdurur) |
| `ChunkLoadError` / `/_global-error` prerender `useContext` hatası                                        | Ortak `.next` başka build tarafından ezildi veya `NODE_ENV=development` ile `next build` — betik ikisini de önler; elle koşuyorsanız `NODE_ENV`'i dışa aktarmayın                                                                                                                                                                                                                                                                                                                                               |
| Ön koşul: `port … dolu` / `konteyner … zaten var`                                                        | önceki yarım koşu: `docker rm -f rs-mysql-e2e-real`, `lsof -nP -iTCP:3218 -sTCP:LISTEN`                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 409 oturum oluşturma                                                                                     | AC-12 saatlik sınır; betik her koşuda yeni DB açtığı için normalde görülmez                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Kurulum mu ürün mü?                                                                                      | `E2E_REAL_REF=<son yeşil commit> scripts/e2e-real.sh`: o da aynı yerde kırmızıysa ortam/kurulum, yeşilse ürün regresyonu                                                                                                                                                                                                                                                                                                                                                                                        |

## 11. Windows istemci yayını (P6; ADR-0010, G-07, AC-94/96/128)

Akış: `agent-win.yml` (CI) → iki bağımsız build'in SHA-256 eşitliği → `SHA256SUMS` → build provenance attestation →
(etiket) onaylı Release → operatör makinesinde `deploy/agent/verify-and-publish.sh` (SHA256SUMS + `gh attestation verify`)
→ sunucuda `agent_downloads` volume'u + `deploy/.env` `AGENT_SHA256` → `docker compose up -d --no-deps server` →
Caddy `/downloads/NoktaDestek.exe` hash kontrolü. Caddy her `/downloads/*.exe` isteğinde server'ın hash kapısına
(`forward_auth` → `/internal/agent-ready`) sorar; uyuşmazlıkta 503 (fail-closed, S6-2). Günlük dış gözcü: `agent-watch.yml`.

### 11.1 Tek seferlik GitHub ayarları (repo sahibi)

| Ayar                                  | Değer                                                                                                                                                                                                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo değişkeni `AGENT_SERVER_URL`     | exe'ye ldflags ile gömülen tek adres, ör. `https://185.126.217.99:4450` (staging). Etiket build'i bu değişken yoksa durur. Prod için ayrı değer/etiket (P13)                                                                                               |
| Environment `agent-release`           | Settings → Environments: required reviewers (kendiniz), "Deployment tags": `v*`. Onay `approve` işindedir; imza, attestation ve Release onaydan SONRA koşar (S-P17-2)                                                                                      |
| Environment `agent-sign` (S-P17-2)    | SignPath hesabı açılmadan ÖNCE: Settings → Environments → New `agent-sign`; Deployment branches and tags → "Selected" → yalnız tag kuralı `v*`; Environment secret `SIGNPATH_API_TOKEN` (repo secret DEĞİL). Ayrıntı §24.3                                 |
| Tag ruleset                           | `v*` etiketlerini yalnız yöneticiler oluşturabilir/silebilir (AC-94 "korumalı v* etiketi")                                                                                                                                                                 |
| Branch protection (main)              | required checks: `ci` job'ları + `agent-win` → `check`, `test-windows`, `build 1/2`, `build 2/2`, `tekrarlanabilirlik + SHA256SUMS`, `libopus.wasm yeniden üret + karşılaştır` (P28d K4; repo sahibi ekler)                                                |
| Repo değişkenleri (gözcü)             | `AGENT_WATCH_URL` = `https://<host>:4450/downloads/NoktaDestek.exe`; staging'de `AGENT_WATCH_CA_PEM` = §8'deki Caddy kök sertifikası (PEM, gizli değil)                                                                                                    |
| SignPath (AC-252, P17; **şu an YOK**) | Hesap açılınca: repo değişkenleri `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_SIGNING_POLICY_SLUG` + **`agent-sign` ortam secret'ı** `SIGNPATH_API_TOKEN` (§24.3). `SIGNPATH_ORGANIZATION_ID` yoksa `sign` işi atlanır, Release imzasız |
| Görünürlük                            | **Repo public olmalı**: GitHub attestation private repoda yalnız Enterprise Cloud'da çalışır (§11.6)                                                                                                                                                       |

**Durum (2026-11-15, U1):** repo **public** yapıldı (gitleaks tüm geçmiş 45 commit 0 bulgu; kullanıcı commit e-postası ve dokümanlardaki sunucu/ağ ayrıntılarının açılmasını kabul etti). Environment `agent-release` oluşturuldu: required reviewer `NoktaBilisim`, deployment policy yalnız `v*` etiketi. Tag ruleset "v* etiketleri korumalı (AC-94)" etkin: `refs/tags/v*` oluşturma/güncelleme/silme yalnız depo yöneticisi rolü (bypass). Repo değişkeni `AGENT_SERVER_URL` = `https://remote.noktabilisim.net` (prod; main push derlemeleri de bu adresi gömer). **Henüz yok:** `AGENT_WATCH_URL` (prod: `https://remote.noktabilisim.net/downloads/NoktaDestek.exe`, ilk Release yayınından sonra), main branch protection.

### 11.2 Yerel doğrulama (CI ile aynı imaj; Go kurulu olması gerekmez)

```bash
cd <repo>   # temiz checkout (VCS damgası exe'ye girer: kirli ağaçta hash farklı olur)
IMG=golang:1.26.11-bookworm@sha256:dc40a13b61304647ed7e5d581d246b86413dfc29d63c6d018310feb93cd98fc0
for n in 1 2; do mkdir -p /tmp/b$n; docker run --rm -v "$PWD":/src -v /tmp/b$n:/out -w /src -e GOFLAGS=-mod=readonly -e GOTOOLCHAIN=local $IMG \
  sh -c 'git config --global --add safe.directory /src; apps/agent-win/build/build.sh https://<adres>:4450 <x.y.z> /out/NoktaDestek.exe'; done
shasum -a 256 /tmp/b1/NoktaDestek.exe /tmp/b2/NoktaDestek.exe   # aynı olmalı; Release SHA256SUMS ile de aynı (aynı commit+adres+sürüm)
docker run --rm -v "$PWD:/repo" rhysd/actionlint:latest       # workflow sözdizimi
```

### 11.3 Sürüm yayını (Release)

1. main yeşil (özellikle `check`: govulncheck + lisans). `git tag -s vX.Y.Z && git push origin vX.Y.Z`. Etiket biçimi **`vX.Y.Z`**
   (AC-94; ruleset ve `agent-release` ortamı `v*`); etiket = istemci sürümü (ldflags `config.version`). Yeni etiket mevcut en
   yüksek Release sürümünden büyük olmalı (onay işi `approve` denetler). Sürüme özel ön koşullar: 0.11.0 için §24.
2. Actions → agent-win → `approve` işinde `agent-release` onayı → (sign) → attest → Release'de `NoktaDestek.exe` + `SHA256SUMS`.
3. Operatör makinesinde (gh oturumu açık):
   `deploy/agent/verify-and-publish.sh --tag vX.Y.Z --ssh root@185.126.217.99`
   Betik: indirir → `SHA256SUMS` → PE/≤40 MB/UPX yok → `gh attestation verify --repo NoktaBilisim/Remote --signer-workflow
NoktaBilisim/Remote/.github/workflows/agent-win.yml --source-ref refs/tags/vX.Y.Z --deny-self-hosted-runners` → scp →
   sunucuda bayt eşitliği yeniden → volume'a `NoktaDestek.exe` (0644, atomik `mv`) → `.env` `AGENT_SHA256` (yedek
   `.env.bak.agent.<zaman>`, son 5 tutulur) → `docker compose up -d --no-deps server` → healthy bekler →
   `https://127.0.0.1:4450/downloads/NoktaDestek.exe` hash'i = beklenen. Kayıt: `deploy/agent/PUBLISHED.log`.
4. Önce `--dry-run` ile yalnız doğrulama yapılabilir. Çıkış 0 dışı → hiçbir şey yayınlanmamış ya da yarım kalmışsa §11.4.
5. Windows'ta kontrol: istemci "Hakkında" parmak izi = `SHA256SUMS` ilk 8 hane (AC-128). AV yanlış pozitifinde Microsoft
   Defender'a gönderim: https://www.microsoft.com/wdsi/filesubmission (ADR-0010).

### 11.4 Rollback (denendi 2026-11-11, yerel `--local` provası: A → B → A, `.env` ve dosya hash'i A'ya döndü)

Önceki sürümü **aynı doğrulamayla** yeniden yayınlayın (sunucudaki eski kopyaya güvenilmez):
`deploy/agent/verify-and-publish.sh --tag v<önceki> --ssh root@185.126.217.99`. Hangi sürümün yayında olduğu:
`ssh root@185.126.217.99 tail -3 /opt/remote/deploy/agent/PUBLISHED.log`. agent-watch eski Release ile eşleşmeyi kabul eder
(uyarı verir, alarm üretmez).

### 11.5 Staging ve yerel test yayını (P13c ortam kilidi)

`verify-and-publish.sh --apply` hedefin `.env` `DEPLOY_ENV`'ine ve compose proje adına göre kilitlidir (fail-closed):

| Hedef `DEPLOY_ENV`                   | Kabul edilen kaynak                                                                | Proje adı                                                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `production` (`/opt/remote/deploy`)  | yalnız `--tag vX.Y.Z` (onaylı Release, §11.3)                                      | `remote` olmalı                                                                                                           |
| `staging` (`/opt/remote-stg/deploy`) | `--stg-run <run-id>` (§21.3/10) ya da `--dir` (elle derlenmiş staging adresli exe) | `remote` OLAMAZ — istisna: tek yığın staging (proje `remote`; §20 terfisi öncesi sunucu, §20.8) yalnız `--tag` kabul eder |
| `development` (yerel compose)        | `--run`, `--dir`, `--tag` (prova); `--stg-run` hayır                               | kontrol yok                                                                                                               |
| boş / başka                          | hiçbiri                                                                            | —                                                                                                                         |

- **Staging:** Actions → agent-win → Run workflow (dal **main**, `server_url=https://stg.remote.noktabilisim.net`, `version=x.y.z`) →
  `gh run list --repo NoktaBilisim/Remote --workflow agent-win.yml --branch main --event workflow_dispatch -L 5` → run-id →
  `deploy/agent/verify-and-publish.sh --stg-run <run-id> --ssh root@185.126.217.99` (hedef varsayılanı `/opt/remote-stg/deploy`;
  attestation `--source-ref refs/heads/main`). Main push ve Release exe'lerinde **prod adresi** gömülüdür; staging'e yazılmaz.
- **Yerel prova (main push artifact'i):** `deploy/agent/verify-and-publish.sh --run <run-id> --local` (hedef `deploy/` ve
  `DEPLOY_ENV=development`). Yalnız main push koşuları kabul edilir; koşu `success` değilse **reddedilir** (S6-5). Bilerek
  denemek için yalnız yerelde: `--run <id> --local --allow-failed-run` (etiket `run-<id>-failedrun`). Prod ve staging hedefi
  `run-*` etiketini zaten reddeder.
- Not: PR ve `server_url=yer-tutucu` ile elle tetiklenen derlemelerde exe'ye `https://destek.example.invalid:4450` gömülür;
  gerçek `AGENT_SERVER_URL` yalnız main/etiket push'unda, staging adresi yalnız main'de elle tetiklemede (S6-4).

### 11.6 Attestation'sız yayın (repo private dönemi; artık yalnız yerel/staging istisnası)

Repo public (U1); normal yol attestation'lıdır. `--no-attestation` yalnız `ALLOW_UNATTESTED=staging` ile ve yalnız `--run`/`--dir`
ile çalışır (`--tag`/`--stg-run` ile kullanılmaz). Hedef kilidi ayrıca uygulanır:

- Yerel: `ALLOW_UNATTESTED=staging deploy/agent/verify-and-publish.sh --run <id> --local --no-attestation` (köken = GitHub'dan
  kimlikli indirme + SHA256SUMS; etiket `-unattested`).
- Staging (yalnız elle derlenmiş staging adresli exe): `ALLOW_UNATTESTED=staging deploy/agent/verify-and-publish.sh --dir <klasör>
--no-attestation --ssh root@185.126.217.99 --deploy-dir /opt/remote-stg/deploy` (köken kanıtı YOK; etiket `dir-<zaman>-unattested`).
- Prod: **hiçbir koşulda** (`DEPLOY_ENV=production` yalnız `vX.Y.Z` kabul eder).

### 11.7 Alarm: istemci bütünlüğü (agent-watch issue / server `alarm: "agent_binary"` `mismatch`)

Güvenlik olayıdır. 1) Volume'a elle dokunmayın; kanıt için hash alın: `docker compose exec server sha256sum /data/downloads/NoktaDestek.exe`. 2) Sunucu erişim/SSH loglarını ve `deploy/agent/PUBLISHED.log`'u inceleyin. 3) Son Release'i §11.3 ile yeniden yayınlayın; agent-watch'u
elle tetikleyin (Actions → agent-watch → Run workflow), yeşil olunca issue'yu kapatın. 4) Sunucu ele geçirilmiş olabilir şüphesinde
indirmeyi kapatın (`AGENT_SHA256=` boş → `docker compose up -d --no-deps server` → 503; müşteri tarayıcı modunu kullanır).
**Sunucu erişilemez alarmı** (agent-watch issue başlığı "sunucu erişilemez", HTTP 502/504): bütünlük olayı değildir. Caddy
server'a ulaşamıyor: `docker compose ps server` + `docker compose logs --tail 200 server` (§5, §7); server healthy olunca
agent-watch'u elle tetikleyin, yeşilse issue'yu kapatın. 503 ise yukarıdaki bütünlük adımları (dosya yok / hash uyuşmazlığı).

| Belirti                                                                                                                           | Neden / çözüm                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent-win` `test-windows` kırmızı: "İZ BULUNDU"                                                                                  | trace-check (AC-108) istemciye ait yeni girdi buldu; koşu çıktısındaki satır kategori + yolu gösterir (§11.8)                              |
| `test-windows` uyarı "WM_CLOSE ile kapanmadı"                                                                                     | runner'da etkileşimli masaüstü yok, istemci zorla kapatıldı; iz testi yine koşar ama kapanış yolu sınanmamıştır → §11.8 elle test          |
| `test-windows` kırmızı: "TestAC25x… koşmadı" / "SKIP"                                                                             | P20 zorunlu Windows testi adı değişti ya da test atlandı; ad sözleşmesi implementation.md "P20 K7", §24.9                                  |
| `test-windows` kırmızı: "testler HKCU Run'da değer bıraktı"                                                                       | autorun testi geçici değeri silmedi (adım siler); testin `t.Cleanup`'ı düzeltilir (§24.9)                                                  |
| `build` kırmızı: "etiket derlemesi yalnız etiket push'unda"                                                                       | etiket üzerinde elle tetikleme; Release yalnız etiket push'uyla (S6-4)                                                                     |
| `--run` "koşu sonucu 'failure' … yayınlanmadı"                                                                                    | S6-5: önce koşuyu yeşile çekin; yalnız yerelde bilerek `--run <id> --local --allow-failed-run`                                             |
| "DEPLOY_ENV=production hedefe yalnız Release etiketi (vX.Y.Z) yayınlanır"                                                         | prod'a `--run`/`--dir`/`--stg-run` denendi → §11.3 `--tag`                                                                                 |
| "DEPLOY_ENV=staging hedefe yalnız --stg-run (ya da --dir) exe'si yayınlanır"                                                      | staging'e Release/main push exe'si (prod adresi gömülü) denendi → §11.5 `--stg-run`                                                        |
| "staging exe (stg-…) yalnız DEPLOY_ENV=staging hedefe yayınlanır"                                                                 | `--deploy-dir` prod/yerel klasörü gösteriyor → `/opt/remote-stg/deploy` (varsayılan)                                                       |
| "… DEPLOY_ENV development\|staging\|production olmalı … yayın yapılmaz"                                                           | hedef `.env`'de `DEPLOY_ENV` boş/yanlış → düzeltin (prod `production`, staging `staging`)                                                  |
| "DEPLOY_ENV=production ama compose projesi '…'" / "DEPLOY_ENV=staging ama compose projesi 'remote' (tek yığın: yalnız Release …)" | ikinci yığında `COMPOSE_PROJECT_NAME`/`COMPOSE_FILE` eksik (§21.1); tek yığın staging'de yalnız `--tag` kullanılır                         |
| "agent_downloads volume adı compose'dan çözülemedi"                                                                               | `docker compose config` hedef klasörde başarısız (`.env` eksik değer) → `cd <deploy> && docker compose config --quiet`                     |
| `agent-win` `check` kırmızı: govulncheck                                                                                          | Go/x/net zafiyeti; go.mod `toolchain` + bağımlılık yükseltilir, `GO_IMAGE`/`GO_VERSION` (agent-win.yml, agent-watch.yml) aynı sürüme       |
| `check`: "imaj goX, go.mod goY"                                                                                                   | go.mod toolchain değişti; iki workflow'daki imaj etiketi + digest güncellenir (`docker buildx imagetools inspect golang:<sürüm>-bookworm`) |
| `tekrarlanabilirlik` kırmızı                                                                                                      | build.sh/winres/zaman damgası kaynağı; iki artifact'i indirip `cmp -l` ile fark bulun                                                      |
| `attest` "Feature not available"                                                                                                  | repo private (§11.6)                                                                                                                       |
| betik `gh attestation verify başarısız`                                                                                           | yanlış etiket/run, fork'tan build veya dosya değişmiş — yayınlamayın                                                                       |
| agent-watch "AGENT_WATCH_URL tanımlı değil"                                                                                       | §11.1 değişkenleri                                                                                                                         |

### 11.8 İz testi: `apps/agent-win/test/trace-check.ps1` (AC-108, T17; P6 DoD)

Salt okunur PowerShell betiği (Windows PowerShell 5.1 ve 7). Taradığı yerler: HKCU/HKLM `Software` (+WOW6432Node) anahtar
adları, HKCU/HKLM `Run`/`RunOnce`, servisler (ad + ImagePath), zamanlanmış görevler (+ eylem komutu), kullanıcı/ortak Başlangıç
klasörü (.lnk hedefi), `%APPDATA%`, `%LOCALAPPDATA%`, `%TEMP%`, İndirilenler (yarım `*.part`), açık istemci süreci.
İz deseni: `NoktaDestek`, `Nokta Destek`, `Destek-<8 hane>`, `remote-support`, `-ExePath` dosya adı. Windows'un kendi kayıtları
(Prefetch, AmCache, UserAssist, MuiCache, AppCompatFlags) istemci verisi değildir, taranmaz.

| Mod                                                             | Ne yapar                                                                                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-Mode Snapshot -SnapshotPath <json>`                           | çalıştırmadan önceki durumu kaydeder (tek yazım bu dosya)                                                                                         |
| `-Mode Compare -SnapshotPath <json> [-ExePath <exe>] [-Strict]` | sonrası ile fark: desene uyan yeni girdi / yeni `.part` / açık süreç = iz. Desene uymayan yeniler "İNCELEYİN" listesi (`-Strict` ile onlar da iz) |
| `-Mode Check` (varsayılan)                                      | önceki durum yok; desene uyan her girdi iz                                                                                                        |

Çıkış kodu: **0** temiz · **1** iz bulundu · **2** kullanım/ortam hatası (Windows değil, snapshot okunamadı).

Kalıcı mod parametreleri: `-Remember on` / `-Binding on` (izinli: `hatirla.bin` ≤ 0.11.x veya `kayitlar.bin` + `kayitlar.lock`
≥ 0.12.0; biri olmalı), `-Tray on` (yalnız `kayitlar.bin` + `kayitlar.lock`; tepside çalışan süreç bilgi), `-Autostart on`
(`-Tray on` + `-ExePath` ister; yalnız `HKCU\…\Run\NoktaDestek` = `"<exe>" --tray`, REG_SZ). Varsayılanların hepsi `off` =
"Bu bilgisayarı unut" sonrası hiçbir iz. 0.12.0 senaryosu §24.9.

**CI:** `agent-win.yml` → `test-windows` job'u her PR/push'ta yer tutucu adresli exe'yi `Destek-12345678.exe` adıyla
başlatır (resolve ağ hatası → kod penceresi; hiçbir sunucuya istek gitmez), 15 sn sonra `WM_CLOSE` ile kapatır ve Compare
koşar. Oturum, dosya aktarımı ve ekran yakalama CI'da yoktur; bunlar için aşağıdaki elle test **zorunludur** (DoD).

**Elle test (temiz Windows 10 22H2 / 11 VM, standart kullanıcı):**

1. Repo'yu ya da yalnız `trace-check.ps1`'i VM'e kopyalayın (ör. `C:\iz\`). PowerShell 7 yoksa `powershell -ExecutionPolicy Bypass -File ...`.
2. `pwsh -File C:\iz\trace-check.ps1 -Mode Snapshot -SnapshotPath C:\iz\once.json`
3. Exe'yi tarayıcıdan indirin (`Destek-<kod>.exe`), implementation.md "Windows'ta elle doğrulanacaklar" 1-12 akışını yapın:
   oturum, sohbet, bir dosya kabul, bir aktarımı yarıda iptal, "Oturumu bitir" → program kapanır.
4. `pwsh -File C:\iz\trace-check.ps1 -Mode Compare -SnapshotPath C:\iz\once.json -ExePath "$env:USERPROFILE\Downloads\Destek-<kod>.exe"`
5. Beklenen: `TEMİZ` ve çıkış 0. Kabul edilen dosya ile exe'nin kendisi iz sayılmaz. "İNCELEYİN" listesindeki girdileri
   gözden geçirin (Defender/Windows Update kaynaklı olabilir). Sonucu ve çıktının ekran görüntüsünü `docs/test-raporu.md`'ye ekleyin.
6. Ayrıca görev yöneticisiyle sonlandırma (zorla kapatma) senaryosunda adım 2-4'ü tekrarlayın: yarım `.part` kalırsa iz olarak raporlanır.

## 12. P8b-1 yayını — müşteri destek talebi (E9; mimari-e9 §8/§13, ADR-0016)

Ön koşul: P8 yayında. Yeni bileşen yok; yeni env (`WHATSAPP_SERVICE_URL`, `MIN_AGENT_VERSION`), migration
`20261112000000_p8b_support_requests`, seed yeni aydınlatma sürümü, Caddyfile + nginx vhost güncellemesi.

### 12.1 Yayın sırası (staging, §8 akışı)

1. **Yedek** (migration expand-only olsa da): `docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction "$MYSQL_DATABASE"' | gzip > /root/remote-pre-p8b-$(date -u +%Y%m%dT%H%M%SZ).sql.gz` (600).
2. Repo güncelle (§8 bundle). `.env`'e iki satır: `WHATSAPP_SERVICE_URL=` (boş = staging servisi) ve `MIN_AGENT_VERSION=` (P8b-2 istemcisi yayınlanana kadar **boş**; eski istemciler 426 almasın).
3. `docker compose build && docker compose up -d` → migrate önce çalışır (precheck gerekmez; değişen CHECK'ler yalnız genişler). `docker compose logs --since 5m migrate` → `20261112000000_p8b_support_requests` applied. Caddyfile değiştiği için caddy de yeniden yaratılır (açık WS'ler bir kez kopar; istemciler yeniden bağlanır).
4. Seed: `docker compose --profile setup run --rm seed` → yeni sistem aydınlatma sürümü (`consentTextsCreated=1`; ikinci çalıştırma 0). **AC-127 etkisi:** eski sürümle açılmış müşteri karşılama sayfaları join'de 400 alır (sayfa yenilenince yeni metin gelir). Açık müşteri oturumu yokken çalıştırın; staging'de kabul.
5. Yetki kontrolü: §6 `check-app-grants.sh` (P8b dahil hepsi PASS).
6. nginx vhost (§8.3 "vhost güncelleme" komutu aynen; `nginx -t` başarısızsa otomatik geri alır). Bu sürümde değişen: firma dosyası log maskesi (G-E9-8).
7. Doğrulama:

```bash
# firma dosyası: Admin "Ayarlar > Destek talepleri"nden bağlantıyı kopyala (ref oluşur), sonra:
curl -sI "https://remote.noktabilisim.net/api/v1/public/agent/request-download?ref=<ref>" | grep -i '^location'   # /downloads/NoktaDestek-<label>-<ref>.exe
curl -s -o /dev/null -w '%{http_code}\n' "https://remote.noktabilisim.net/downloads/NoktaDestek-<label>-<ref>.exe"  # 200
curl -s -o /dev/null -w '%{http_code}\n' "https://remote.noktabilisim.net/downloads/NoktaDestek-Baska-<ref>.exe"    # 404 (label uyuşmaz, G-E9-11)
# loglarda ref yok:
docker compose logs caddy --since 10m | grep -c '<ref>'; grep -c '<ref>' /var/log/nginx/remote.access.log          # 0 / 0
# /ws/request ve /ws/panel: ticket'sız el sıkışma 101 değil 4xx (502 değil) — §8.3'teki curl, yol /ws/panel
```

8. Yayın geçmişi tablosuna (§8) satır ekleyin.

### 12.2 Geri alma

Sıra terstir: (1) önceki `IMAGE_TAG` + önceki Caddyfile (git) → `docker compose up -d`; (2) gerekirse `down.sql`:
`docker compose run --rm migrate pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261112000000_p8b_support_requests/down.sql`.
**Koruma:** talepten doğan oturum/onay satırı (`request_id` dolu) veya 190 karakteri aşan oturum e-postası varsa `down.sql`
3819 `p8b_down_guard_chk` ile **hiçbir şey değiştirmeden** durur. Bu satırlar KVKK kanıtıdır: silmeyin, mimara bildirin;
o durumda yalnız (1) uygulanır (eski kod yeni sütunları okumaz, şema ileri uyumlu). `down.sql` talepleri ve firma ref'lerini
siler (dağıtılmış firma dosyaları 404 olur). Seed'in eklediği aydınlatma sürümü kalır (zararsız). nginx için §8.3 `remote.conf.prev`.
Prova: dba 2026-11-12 geçici DB'de guard + temiz geri alma + yeniden migrate denedi (`docs/db-notlari.md` P8b-1).

### 12.3 WhatsApp servisi — K13 prod ön koşulu

- Staging: adres panel kaydından ya da `deploy/.env` `WHATSAPP_SERVICE_URL`'den gelir (P13b'den beri yerleşik varsayılan yok; değer runbook'a yazılmaz; servis kimliksizdir, G-P13b-2/K13). Mesajda kişisel veri yok (§13.5 şablonu).
- **Prod açılışından önce (P13 kontrol listesi):** servis TLS arkasında (`https://…`) **veya** özel ağda; servis host güvenlik duvarında 3000 yalnız Remote sunucusunun çıkış IP'sine açık. Adres Super Admin → Sistem ayarları → WhatsApp servisi'nden girilir (P12b, §17; env yalnız yedek). Doğrulama: başka bir dış makineden `curl -m 5 http://<servis>:3000/` zaman aşımı; Super Admin → Sistem ayarları → WhatsApp servisi → "Test Mesajı Gönder" başarılı (tenant tarafında Ayarlar > Destek talepleri > "Test Mesajı Gönder" de aynı etkin adresi kullanır). Aksi halde server kanalı zaten kapalı başlatır (log `alarm:"whatsapp_insecure"`, ayar ekranında uyarı) — bu bir arıza değil, ön koşul eksikliğidir.
- Servis API anahtarı desteği "Sonra" (servis destekleyince env eklenir).
- **Geçici çözüm (2026-11-15, kullanıcı kararı):** whatsapp-bildirim servisi şimdilik düz `http://` + API anahtarıyla kullanılır: `deploy/.env` → `WHATSAPP_ALLOW_INSECURE_HTTP=true` → `docker compose up -d server`. Doğrulama: `docker compose logs server | grep -c whatsapp_insecure_http_allowed` → `1`, panelde sarı "Şifresiz bağlantıya izin verildi" uyarısı, "Test Mesajı Gönder" başarılı. Servis HTTPS'e taşınınca bayrak kaldırılır (uyarı kaybolur).
- **K13 geçici izninin bitiş koşulu (D-LGK-2):** izin yalnız whatsapp-bildirim servisi HTTPS'e taşınana kadar açık kalır;
  taşınınca `deploy/.env` → `WHATSAPP_ALLOW_INSECURE_HTTP=false` (ya da satırı silin) → `docker compose up -d server`.
  Doğrulama: `docker compose logs server | grep -c whatsapp_insecure_http_allowed` → `0`, panelde sarı uyarı yok, "Test
  Mesajı Gönder" başarılı. Bu izin açık kaldıkça "Müşteriye gönder" müşteri bağlantıları (K3) WhatsApp mesajları,
  müşterinin **kalıcı** Hızlı Destek ve talep formu bağlantılarını ve servis API anahtarını düz http üzerinden taşır. Kayıt
  kodu (K2) WhatsApp'tan hiç gönderilmez (yalnız e-posta).

### 12.4 `MIN_AGENT_VERSION` — güvenlik yamasında yükseltme

1. Yamalı istemciyi §11.3 ile yayınlayın (`verify-and-publish.sh`; firma dosyaları ve `NoktaDestek.exe` aynı ikilidir, bağlantılar değişmez).
2. `.env`'de `MIN_AGENT_VERSION=<yamalı sürüm>` → `docker compose up -d server`.
3. Eski istemci açan müşteri "Bu Hızlı Destek dosyası eski" + "Yeni sürümü indir" görür (talep modunda aynı firma bağlantısından yenisini indirir); kod modunda teknisyenden yeni bağlantı ister.
4. Doğrulama: server logunda `CLIENT_OUTDATED` (426) sayısı; geri almak için değeri önceki sürüme çekip `up -d server`.

### 12.5 Metrikler ve alarmlar (`/metrics`, Bearer `METRICS_TOKEN`; adlar mimari-e9 §8, server tarafı backend)

| Kural (PromQL)                                                                                                                                                                      | Seviye                | Anlamı / ilk adım                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `increase(rs_request_ref_invalid_total[1m]) > 100`                                                                                                                                  | **Uyarı**             | Ref numaralandırma denemesi (T28). Engelleme değil alarm (IP kovası zaten 15 dk 429). Caddy logunda kaynak IP dağılımı: `docker compose logs caddy --since 15m \| grep -o '"client_ip":"[^"]*"' \| sort \| uniq -c \| sort -rn \| head`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `sum(increase(rs_request_notify_total{channel="whatsapp",result="failed"}[15m])) / sum(increase(rs_request_notify_total{channel="whatsapp",result=~"ok\|failed"}[15m])) > 0.5`      | **Uyarı**             | WhatsApp servisi ulaşılamıyor/hata dönüyor. `docker compose logs server --since 15m \| grep -i whatsapp`; servis sahibine bildirin. Panel bildirimi (birincil kanal) etkilenmez                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `increase(rs_request_rate_limited_total{bucket="tenant"}[10m]) > 0`                                                                                                                 | **Uyarı**             | Tenant'a olağan dışı talep yoğunluğu (G-E9-7); panelde uyarı bandı çıkar. Admin'e "bağlantıyı yenile" önerin (ref yenileme)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `sum(rs_requests_pending) > 400`                                                                                                                                                    | Uyarı                 | Sistem geneli hedef ≤ 500 bekleyen; teknisyen yokluğu veya spam. Tenant dağılımı için SQL: `SELECT tenant_id, COUNT(*) FROM support_requests WHERE status='PENDING' GROUP BY tenant_id`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `rs_ws_connections{role="request"}` / `{role="panel"}`                                                                                                                              | Pano                  | Bekleyen müşteri ve açık panel sayısı; `request` ≈ `rs_requests_pending` olmalı (fark büyükse kopan istemciler)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| server log `alarm:"whatsapp_global_cap"`                                                                                                                                            | Bilgi                 | Saatlik 300 global WhatsApp sınırı aşıldı, özet mesajlara düşüldü                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| server log `alarm:"whatsapp_insecure"` (P12b: açılışta ve güvensiz adrese **her geçişte**; adres loga yazılmaz)                                                                     | **Uyarı** (prod)      | production'da etkin adres `http://` + genel adres → WhatsApp kanalı kapalı. Arıza değil, K13 ön koşulu eksik (§12.3). Etkin adresin kaynağı Super Admin → Sistem ayarları → WhatsApp servisi rozetinde (Panel / Ortam değişkeni); düzeltme panelden `https://` veya özel ağ adresi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| server log `alarm:"whatsapp_insecure_http_allowed"` (K13 geçici çözümü; açılışta bir kez, warn; adres/anahtar yazılmaz)                                                             | Bilgi                 | `WHATSAPP_ALLOW_INSECURE_HTTP=true`: WhatsApp kanalı düz http ile açık (anahtar ve mesajlar açık metin). Beklenen durum (§12.3 geçici çözüm); servis HTTPS'e geçince bayrak kaldırılır                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| server log `alarm:"unattended_unsigned_risk_accepted"` (P32, AC-527a; açılışta bir kez, warn; `allowedCount`, `listFingerprint` — SHA yazılmaz)                                     | Bilgi                 | `UNATTENDED_MODE=unsigned-accepted`: gözetimsiz servis kod imzasız çalışıyor (risk kabul, ADR-0042). Beklenen durum (§27.9). remote-watch karşılıkları: her turda `BILGI check=unattended-unsigned-accepted` (alarm değil); **ALERT** `unattended-list-unpublished`, `unattended-agent-version-mismatch`, `unattended-deploy-env`, `unattended-mode-changed` (tek seferlik) — §27.9 tablo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| server log `alarm:"whatsapp_invalid_url"` (P12b, **error** seviyesi; adres loga yazılmaz)                                                                                           | **Uyarı** (her ortam) | Etkin adres (panel kaydı veya env) URL olarak ayrıştırılamıyor → WhatsApp kanalı **her ortamda** kapalı (test `reason: insecure`). Normalde panel/env/DB kuralları bunu engeller; görülürse DB'ye kural dışı yazılmış kayıt veya kod hatası. Super Admin → WhatsApp servisi'nden geçerli adres kaydedin veya "Ortam değişkenine dön"; tekrar ederse backend'e bildirin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| server log `alarm:"whatsapp_settings_load"` (P12b, açılışta)                                                                                                                        | **Uyarı**             | Panel kaydı (`system_settings.whatsapp`) okunamadı → server env/varsayılan adresle çalışıyor; panelde kayıtlı adres **uygulanmıyor** olabilir. DB erişimini kontrol edin (§7, `db_busy`), sonra `docker compose restart server` ve logda alarmın tekrar etmediğini doğrulayın                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| server log `alarm:"db_busy"` (metrik yok; log sayımı: `docker compose logs server --since 5m \| grep -c '"alarm":"db_busy"'`) — 5 dk'da > 20 **veya** 15 dk boyunca her 5 dk'da > 0 | **Uyarı**             | Geçici DB çekişmesi → istemciye 503 `NOT_READY` + `Retry-After` (errors.ts; kod alanı: `P2028` TX/havuz bekleme, `P2034`/`1213` deadlock, `1205` kilit bekleme, `45028` havuzdan bağlantı alınamadı). Bağlam: talep oluşturma TX'i tenant ayar satırını kilitler; talep kapısı (S8b-5, düzeltildi) talepleri havuzun (10 bağlantı) en çok 4'üyle sınırlar, giriş/panel/WS için en az 6 kalır. Başarısız giriş sayacı DB'ye yazılamazsa bellek içi yedek kova kilidi yine uygular (S8b-6, düzeltildi; `auth_fail_counter_fallback` satırı). İlk adım: (1) kod dağılımı `docker compose logs server --since 15m \| grep '"alarm":"db_busy"' \| grep -o '"code":[^,}]*' \| sort \| uniq -c`; (2) eşzamanlı `rs_requests_created_total` / `rs_request_rate_limited_total` artışı → talep yığılması (tenant dağılımı §12.5 SQL); (3) MySQL tarafı `docker compose exec mysql mysql -uroot -p -e "SHOW PROCESSLIST; SHOW ENGINE INNODB STATUS\G" \| grep -A20 "LATEST DETECTED DEADLOCK"`; (4) uzun süren sorgu veya yedek alma çakışması varsa bitmesini bekleyin. Sürekli ise `docker compose restart server` havuzu boşaltır (geçici); kalıcıysa DB kaynakları/sorgu planı incelenir |
| `increase(rs_request_gate_rejected_total[5m]) > 0` (`reason="full"` veya `"timeout"`)                                                                                               | **Uyarı**             | Talep oluşturma kapısı doldu (S8b-5: firma başına 2, toplam 4 eşzamanlı; kuyruk 16/64, bekleme 5 sn) → müşteriye 503 `NOT_READY` + `Retry-After: 5`. Ani talep yığılması veya yavaş DB. `db_busy` satırıyla birlikte değerlendirin; sürekli artış havuz/DB kaynak yetersizliğidir. Firma dağılımı: `docker compose logs server --since 15m \| grep '"alarm":"request_gate_busy"' \| grep -o '"tenantId":"[^"]*"' \| sort \| uniq -c`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| server log `alarm:"request_gate_busy"` (10 sn'de en çok 1; `reason`, `tenantId`; PII yok)                                                                                           | Uyarı                 | Yukarıdaki metriğin log karşılığı; metrik toplanmıyorsa log sayımı: `docker compose logs server --since 5m \| grep -c '"alarm":"request_gate_busy"'` > 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| server log `alarm:"auth_fail_counter_fallback"` (`userId`, `code`, `lockedNow`)                                                                                                     | **Uyarı**             | Başarısız giriş sayacı DB'ye yazılamadı; hesap kilidi bellek içi yedek kovayla uygulandı (S8b-6, fail-closed). Tekil olay: DB çekişmesi (`db_busy` ile aynı pencere). Aynı `userId` için tekrar ediyorsa kaba kuvvet denemesi + DB sorunu birlikte: §7 DB kontrolleri, kullanıcı audit kaydı. Server yeniden başlarsa yedek kova sıfırlanır                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| "Müşteri bekliyor" rozeti / "Oturumlar" sayacı yeniden başlatma sonrası 0 (P13b-L)                                                                                                  | **Bilgi**             | Beklenen: lobi göstergesi (`GET /api/v1/sessions/waiting`, liste `waitingGuests`) bellekten okunur (ADR-0029, tek instance); server yeniden başlarsa odalar boşalır, sayı 0'a iner, misafirler yeniden katılınca ≤ 10 sn içinde görünür. Env/migration/grant yok; rollback önceki imaja dönmektir. Kullanıcıya 429 dönüyorsa (60/dk/kullanıcı) çok sayıda açık sekme vardır, sonraki yoklamada düzelir                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| server log `alarm:"auth_fail_unrecorded"` (`userId`, `pairLocked`/`locked`, `lockedNow`, `code`)                                                                                    | **Uyarı**             | Başarısız giriş veya kilit audit'e yazılamadı (yanıt yine 401/423; S8b-6/S8b-7). Audit eksikliği demektir: olay zamanını ve `userId`'yi not edin, DB sorunu giderilince güvenlik ekibine bildirin. 5 dk'da > 5 ise DB'yi kontrol edin (§7, `db_busy`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Kabul süresi (ayrı metrik yok): `SELECT DATE(created_at) g, COUNT(*), AVG(TIMESTAMPDIFF(SECOND, created_at, accepted_at)) ort_sn FROM support_requests WHERE accepted_at IS NOT NULL AND created_at > NOW() - INTERVAL 7 DAY GROUP BY g`.

### 12.6 Sorun giderme (P8b)

| Belirti                                  | Kontrol / çözüm                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Firma bağlantısı / dosyası 404           | Ref yenilenmiş, tenant pasif veya Admin ayar ekranını hiç açmamış (ref tembel oluşur, K14). Firma kısa adı değiştiyse eski adlı dosya 404 (label uyuşmaz, G-E9-11) → Admin bağlantıyı yeniler. İç uç elle: `docker compose exec caddy wget -S -O- --header 'X-Forwarded-Method: GET' --header 'X-Forwarded-Uri: /downloads/NoktaDestek-<label>-<ref>.exe' http://server:3001/internal/agent-ready` → 204                                                  |
| Firma dosyası 503                        | P6 ikili kapısı (§7 `agent_binary` satırı)                                                                                                                                                                                                                                                                                                                                                                                                                |
| Firma dosyası 404 ama ad doğru görünüyor | Caddy biçimi: label `[A-Za-z0-9]{1,20}`, ref `[a-z2-7]{16}`, büyük/küçük harf duyarlı; biçim dışı ad server'a hiç gitmez. `deploy/test-caddy.sh`                                                                                                                                                                                                                                                                                                          |
| WhatsApp gelmiyor                        | Tenant ayarında kanal açık + alıcı var mı; Ayarlar > "Test Mesajı Gönder"; etkin adres ve kaynağı için Super Admin → Sistem ayarları → WhatsApp servisi → "Test Mesajı Gönder", sonra Audit ekranında `settings.whatsapp.test` kaydının `reason` alanı (§17.4 tablosu); prod'da `alarm:"whatsapp_insecure"` (§12.3), açılışta `alarm:"whatsapp_settings_load"` (§12.5); saatlik sınırlar (tenant 30, alıcı 10, global 300 → özet); audit `request.notify` |
| Müşteri "dosya eski" görüyor             | `MIN_AGENT_VERSION` > istemci sürümü (§12.4); yanlışlıkla yükseltildiyse geri çekin                                                                                                                                                                                                                                                                                                                                                                       |
| `/ws/request` veya `/ws/panel` 502       | server ayakta değil (§7); nginx/Caddy WS ayarı değişmedi (`/ws/*` aynı kural)                                                                                                                                                                                                                                                                                                                                                                             |
| Seed sonrası müşteri karşılamada 400     | AC-127: yeni aydınlatma sürümü; müşteri sayfayı yenilesin (§12.1/4)                                                                                                                                                                                                                                                                                                                                                                                       |
| Talep 429 `QUEUE_FULL` / `RATE_LIMITED`  | Tenant 50 bekleyen, IP/önek kovaları (mimari-e9 §5.4, §13.6); NAT'lı ofis için Admin "güvenilen IP/CIDR" ekleyebilir                                                                                                                                                                                                                                                                                                                                      |

## 13. P8c-1 yayını — müşteri firmalar ve bilgisayar kaydı (E10; mimari-e10 §10 + §15 r2, ADR-0017)

Ön koşul: P8b-1/P8b-2 yayında. **Değişmeyenler:** env (yeni değişken yok; `PUBLIC_BASE_URL` müşteri indirme
bağlantısını da üretir), `docker-compose.yml`, Caddyfile, nginx vhost (dosya adı biçimi `NoktaDestek-<etiket>-<ref>.exe`
aynı; log maskesi `NoktaDestek-***` mevcut). **Değişenler:** migration `20261112120000_p8c_customers` (expand-only,
precheck gerekmez), `grants.sql` (3 yeni tablo), seed yeni aydınlatma sürümü, server + web imajı, yeni yetki anahtarları
`customers.view/create/edit/delete` (Admin varsayılan açık, User kapalı).

### 13.1 Yayın sırası (staging, §8 akışı)

**Ders (P8b-1):** `umask 077` ile `git pull` **aynı ssh oturumunda/komutunda kullanılmaz**; çekilen dosyalar 600 olur,
`migrate`/`server` imajında `EACCES` ile durur. Yedeği ve repo güncellemesini **ayrı** ssh çağrılarında yapın; yedek
dosyasının iznini `umask` yerine `chmod 600` ile verin.

1. **Yedek** (ayrı ssh çağrısı):

```bash
ssh root@185.126.217.99 'cd /opt/remote/deploy && F=/root/remote-pre-p8c-$(date -u +%Y%m%dT%H%M%SZ).sql.gz \
  && docker compose exec -T mysql sh -c '\''MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction "$MYSQL_DATABASE"'\'' | gzip > "$F" \
  && chmod 600 "$F" && ls -l "$F" && gzip -t "$F" && echo yedek-ok'
```

2. **Repo güncelle** (yerelde bundle, sunucuda pull; §8). Pull **yeni** bir ssh çağrısında, `umask` vermeden. Ardından izin kontrolü:

```bash
ssh root@185.126.217.99 'find /opt/remote/apps /opt/remote/packages /opt/remote/deploy -type f ! -perm -o+r \
  ! -name .env ! -name ACCESS.txt | head'      # beklenen: boş. Değilse: chmod -R go+rX /opt/remote/{apps,packages}
```

3. `IMAGE_TAG` güncelle → `docker compose build && docker compose up -d`. `docker compose logs --since 5m migrate` →
   `20261112120000_p8c_customers` applied + grants uygulandı. Server `ready` olmadan önce migrate bitmiş olmalı
   (compose `depends_on`). Caddy/nginx yeniden başlatılmaz (değişmedi).
4. **Seed + aydınlatma yayın notu** (aşağıdaki kutu): önce açık müşteri/misafir oturumu var mı bakın, yoksa çalıştırın:

```bash
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_APP_PASSWORD" mysql -uapp -N "$MYSQL_DATABASE"' \
  <<< "SELECT status, COUNT(*) FROM support_sessions WHERE status IN ('PENDING','ACTIVE') GROUP BY status; SELECT COUNT(*) FROM support_requests WHERE status='PENDING';"
docker compose --profile setup run --rm seed     # ilk çalıştırma consentTextsCreated >= 1, ikincisi 0
```

5. **Yetki sınırı:** §6 `check-app-grants.sh` → hepsi PASS, `FAILED=0` (P8c ile 50 yeni denetim; 2026-11-12 test DB'sinde 261/261).
   Özellikle: `customers` / `device_bindings` için DELETE ve DDL **DENIED**, `request_refs` için UPDATE/DELETE **DENIED** (append-only).
6. **Ref ad alanı tutarlılığı** (beklenen `0`; `docs/db-notlari.md` P8c-1):

```bash
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_APP_PASSWORD" mysql -uapp -N "$MYSQL_DATABASE"' <<'SQL'
SELECT (SELECT COUNT(*) FROM tenant_request_settings s WHERE NOT EXISTS (SELECT 1 FROM request_refs r WHERE r.ref=s.request_ref AND r.tenant_id=s.tenant_id AND r.customer_id IS NULL))
     + (SELECT COUNT(*) FROM customers c WHERE NOT EXISTS (SELECT 1 FROM request_refs r WHERE r.ref=c.request_ref AND r.tenant_id=c.tenant_id AND r.customer_id=c.id)) AS kayitsiz;
SQL
```

`> 0` ise: eski imaj yeni şemada çalışırken Genel ref yenilenmiş demektir; migration'daki geri doldurma ifadesini migrator
ile yeniden çalıştırın (`docs/db-notlari.md` "Geri doldurma (idempotent)"). 7. **Teknisyen hesabı:** `bash staging-users.sh` → USER'a `customers.view/create/edit/delete` eklenir (mevcut hesaba
`INSERT IGNORE`; Admin'in elle kapattığı satıra dokunmaz). Çıktı: `USER: exists (...) - ..., eksik yetkiler eklendi`.
Kullanıcı yeniden giriş yapınca "Müşteriler" menüsü görünür. 8. **Doğrulama** (panelde Admin ile "Müşteriler > Yeni müşteri", ardından satırdaki "Kopyala"):

```bash
B=https://remote.noktabilisim.net
curl -sI "$B/api/v1/public/agent/request-download?ref=<müşteri ref>" | grep -i '^location'   # /downloads/NoktaDestek-<etiket>-<ref>.exe
curl -s -o /dev/null -w '%{http_code}\n' "$B/downloads/NoktaDestek-<etiket>-<müşteri ref>.exe" # 200
curl -s -o /dev/null -w '%{http_code}\n' "$B/downloads/NoktaDestek-<etiket>-<GENEL ref>.exe"   # 200 (Genel bağlantı bozulmadı)
curl -s "$B/api/v1/public/requests/tenant?ref=aaaaaaaaaaaaaaaa" | head -c 200; echo            # 404 REQUEST_REF_INVALID
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' \
  -d '{"bindingKey":"rsb_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","clientVersion":"0.10.0"}' "$B/api/v1/public/bindings/status"   # 404 (BINDING_INVALID); clientVersion yoksa 400 VALIDATION
docker compose logs caddy --since 10m | grep -c '<müşteri ref>'; grep -c '<müşteri ref>' /var/log/nginx/remote.access.log   # 0 / 0
docker compose exec -T server node -e 'fetch("http://127.0.0.1:3001/metrics",{headers:{authorization:"Bearer "+process.env.METRICS_TOKEN}}).then(r=>r.text()).then(t=>process.stdout.write(t))' \
  | grep -E '^# TYPE rs_(customers_active|bindings_issued_total|binding_invalid_total|bindings_revoked_total|requests_created_total)'
```

Son komutta beş `# TYPE` satırı beklenir (§13.5). Eksikse server kodu bu sürümde metriği kaydetmiyor → backend-dev'e bildirin
(yayını durdurmaz). Panelde müşteriyi **pasife alın** → kopyaladığınız bağlantı 404 olmalı (ilk curl `location` yerine 404). 9. §8 yayın geçmişi tablosuna satır ekleyin (commit, migration, yedek dosya adı, grants sonucu, seed çıktısı).

> **Yayın notu — aydınlatma metni yeni sürüm (AC-188; P8b AC-127 kalıbı).** Seed, bilgisayar kaydı ve müşteri yetkili
> kişi verisini anlatan yeni sistem aydınlatma sürümünü ekler ve `is_current`'ı ona geçirir. **Etkisi:** seed'den önce
> açılmış müşteri karşılama sayfaları (tarayıcı veya istemci, eski sürümü göstermiş olan) join'de **400** alır;
> müşteri sayfayı yenileyince (istemcide yeniden açınca) yeni metin gelir ve onay yeniden istenir. Devam eden
> (onayı alınmış, bağlı) oturumlar etkilenmez. Bu yüzden seed'i adım 4'teki sorguda bekleyen/açık oturum yokken çalıştırın;
> varsa teknisyene haber verin veya bitmesini bekleyin. Admin'in kendi yazdığı tenant metnine dokunulmaz.
> Geri almada bu sürüm **kalır** (consent_texts değişmez kayıttır; zararsız).

### 13.2 Geri alma (denendi: dba 2026-11-12, geçici `mysql:8.4` üzerinde down → up → drift 0 ve guard durdurması)

Tercih sırası: **ileri düzeltme > yalnız imaj geri alma > imaj + `down.sql`**. Şema expand-only olduğundan eski imaj yeni
şemada çalışır; `down.sql` yalnız şemanın kendisi sorunluysa gerekir.

1. **Önceki imaj:** `.env`'de `IMAGE_TAG=<P8b-2 etiketi>` → `docker compose up -d`. Eski server `customer_id`/`binding_id`'yi
   NULL bırakır, yeni tabloları okumaz. Etkisi: müşteri bağlantıları 404, 0.10.0 istemci `binding.offer` almadığı için kayıt
   istemez (oturum etkilenmez). Bu pencerede Genel ref yenilendiyse ileri dönüşte §13.1/6 tutarlılık sorgusunu çalıştırın.
2. **`down.sql`** (yalnız gerekirse; **verisiyle** `customers`, `request_refs`, `device_bindings` ve talep/oturum müşteri bağını
   siler — önce §13.1/1 yedeği). Önce 1. adım uygulanmış olmalı.

```bash
docker compose run --rm migrate pnpm --filter @remote/server exec prisma db execute \
  --file prisma/migrations/20261112120000_p8c_customers/down.sql
```

**Koruma — `p8c_down_guard_chk`:** dosyanın ilk ifadesi geçici bir tabloya `cancel_reason IN ('CUSTOMER_PASSIVE','BINDING_REVOKED')`
olan talep sayısını yazar; CHECK `n = 0`. Böyle bir talep varsa (müşteri pasife alınmış veya bir kayıt panelden iptal edilmiş
ve bekleyen talebi kapanmışsa) komut **3819 `Check constraint 'p8c_down_guard_chk' is violated`** ile durur ve **hiçbir şey
değişmez** (yetki, sütun, tablo, `_prisma_migrations` kaydı yerinde). Ne yapılır:

- Bu satırları **silmeyin/düzenlemeyin** (talep geçmişidir). Sayıyı mimara bildirin:
  `SELECT cancel_reason, COUNT(*) FROM support_requests WHERE cancel_reason IN ('CUSTOMER_PASSIVE','BINDING_REVOKED') GROUP BY cancel_reason;`
- O durumda yalnız 1. adımda kalın (eski kod yeni sütunlarla sorunsuz çalışır).
  Guard geçerse dosya sırasıyla: yetkileri `REVOKE`, `support_sessions`/`support_requests` FK-indeks-sütunlarını düşürür,
  `cancel_reason` CHECK'ini P8b listesine döndürür, üç tabloyu düşürür, `_prisma_migrations` kaydını siler. Ardından
  §6 `check-app-grants.sh` (P8c satırları "tablo yok" hatası verir; P8b ve öncesi PASS olmalı).

3. **Yeniden ileri:** yeni `IMAGE_TAG` → `docker compose up -d` (migrate migration'ı yeniden uygular; müşteri ref'leri **yeni**
   üretilir, eski dağıtılmış müşteri dosyaları 404 kalır → Admin bağlantıları yeniden gönderir).
4. Geri dönüşten sonra 0.10.0 istemcilerin mevcut kayıtları `bindings/status` 404 alır ve istemci kaydı siler (kabul;
   ileri sürümde bir sonraki başarılı oturumda yeniden verilir).

### 13.3 Operasyon adımları — bilgisayar kaydı ve müşteri bağlantısı

Hepsi panelden yapılır (sunucuya girmek gerekmez); her işlem audit'e düşer. Etki tablosu:

| İşlem (panel)                                                                                        | Yetki              | Etkilenen kayıtlar (`device_bindings`)                         | Bekleyen talepler                                                                                  | Müşteri dosyası / bağlantı                              |
| ---------------------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Talep kartı ⋯ > **"Bu bilgisayarın kaydını iptal et"** (`POST /support-requests/:id/revoke-binding`) | `customers.edit`   | Yalnız o talebi açan kayıt → `ADMIN_REVOKED`                   | Aynı kaydın bekleyenleri `CANCELLED(BINDING_REVOKED)`                                              | Değişmez                                                |
| Müşteri detayı > **"Bağlantıyı yenile"** (`POST /customers/:id/rotate-ref`)                          | `customers.edit`   | O müşterinin tüm etkin kayıtları → `CUSTOMER_ROTATED`          | Etkilenmez (kartta "bağlantı yenilenmeden önce açıldı" uyarısı; kabul edilirse kayıt **verilmez**) | Eski ref anında 404; yeni bağlantı müşteriye gönderilir |
| Müşteri > **"Pasife al"** (`POST /customers/:id/deactivate`)                                         | `customers.delete` | O müşterinin tüm kayıtları → `CUSTOMER_PASSIVE`                | `CANCELLED(CUSTOMER_PASSIVE)` (≤ 60 sn, süpürücü yedek)                                            | 404; seçim listesinden çıkar                            |
| Müşteri > **"Aktif et"** (`POST /customers/:id/reactivate`)                                          | `customers.edit`   | (zaten geçersiz)                                               | —                                                                                                  | **Yeni** ref; eski ref asla dirilmez (`request_refs`)   |
| Ayarlar > Destek talepleri > **Genel bağlantıyı yenile**                                             | `settings.edit`    | Tenant'ın tüm Genel (müşterisiz) kayıtları → `GENERAL_ROTATED` | Etkilenmez                                                                                         | Genel ref 404                                           |

**Tek kayıt iptali (adım adım):**

1. Talepler (kuyruk) veya Geçmiş'te ilgili talep kartını açın; kartta "Kayıtlı bilgisayar — <firma|Genel>" rozeti olmalı.
   Menü öğesi yoksa: kayıt zaten geçersiz ("Kaydı iptal edilmiş bilgisayar" rozeti) ya da kullanıcıda `customers.edit` yok.
2. ⋯ > "Bu bilgisayarın kaydını iptal et" → onay diyaloğunda "İptal et". Başarı toast'ı; 409 "zaten geçersiz" zararsızdır.
3. Doğrulama (salt okunur, `app` kullanıcısı):

```bash
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_APP_PASSWORD" mysql -uapp "$MYSQL_DATABASE"' <<'SQL'
SELECT b.id, b.revoke_reason, b.revoked_at, b.key_hash IS NULL AS hash_silindi
  FROM support_requests r JOIN device_bindings b ON b.id=r.binding_id AND b.tenant_id=r.tenant_id WHERE r.id='<talep id>';
SELECT action, created_at, JSON_EXTRACT(new_value,'$.reason') reason, JSON_EXTRACT(new_value,'$.cancelledRequests') iptal
  FROM audit_logs WHERE action='binding.revoked' AND JSON_EXTRACT(new_value,'$.requestId')='<talep id>';
SQL
```

Beklenen: `ADMIN_REVOKED`, `hash_silindi=1`, bir audit satırı. Müşterinin diğer bilgisayarları ve dosyası etkilenmez;
o bilgisayar bundan sonra açılışta "Bu bilgisayarın destek kaydı artık geçerli değil." görür ve bağlantı kodu veya dosya
ile devam eder.
**Müşteri bağlantısını yenileme / pasife alma:** Müşteriler > ilgili müşteri > işlem; onay diyaloğu etkilenecek kayıtları
anlatır. Sonrasında audit `customer.ref_rotated` / `customer.deactivated` satırında `revokedBindings` (ve pasifte
`cancelledRequests`) sayısı görünür. Yeni bağlantıyı müşteriye **sistem dışı** kanaldan (telefon/e-posta) teknisyen iletir
(sistem göndermez). Kişisel veri: pasif müşterinin yetkili kişi/telefon/e-posta/notu tenant saklama süresi sonunda günlük
03:30 işiyle anonimleşir (`customer.anonymized`); hemen silmek için Admin düzenle ekranında alanları boşaltır.

### 13.4 Olay müdahalesi — sızan dosya / kayıt

Kayıt anahtarı **yalnız talep açar**; oturum, ekran, TURN vermez. Her oturum yine teknisyen kabulü + müşterinin "Ekranımı
paylaş" onayı ister. Bu yüzden olaylar **Orta** önceliklidir; hedef müdahale süresi mesai içinde 1 saat.

| Olay                                                                                    | Belirti                                                                                 | Sınırlama (ilk 15 dk)                                                              | Not                                                                                                              |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Müşteri dosyası / bağlantısı sızdı** (ör. herkese açık paylaşıldı)                    | O müşteriden tanımadığınız kişi adına talepler, `rs_request_rate_limited_total` artışı  | Müşteri > **Bağlantıyı yenile** (o müşterinin kayıtları da düşer)                  | Yeni bağlantıyı yetkili kişiye kayıtlı numaradan teyitle gönderin                                                |
| **Tek kayıtlı bilgisayar kötüye kullanılıyor** (aynı bilgisayardan istenmeyen talepler) | Kartlarda aynı "Kayıtlı bilgisayar" kaynağı, `req.create.binding` 6/sa sınırına takılma | Talep kartı > **"Bu bilgisayarın kaydını iptal et"** (§13.3)                       | Bağlantıyı yenilemek **yalnız** dosya da sızdıysa; aksi halde müşterinin diğer bilgisayarlarını gereksiz düşürür |
| **Genel dosya sızdı**                                                                   | Genel'e düşen beklenmedik talepler                                                      | Ayarlar > **Genel bağlantıyı yenile** (tüm Genel kayıtlar düşer)                   | Müşteri firmaya ait dosyalar etkilenmez                                                                          |
| **`hatirla.bin` / kayıt anahtarı sızdı** (yedek, zararlı yazılım)                       | Aynı kayıttan farklı IP'lerden talep                                                    | Önce tek kayıt iptali; müşteri bilgisayarında istemciden **"Bu bilgisayarı unut"** | Anahtar her başarılı oturumda döndürülür; sızan eski anahtar bir sonraki oturumdan sonra zaten ölür              |
| **Kayıt anahtarı/ref tahmini** (numaralandırma)                                         | `rs_request_ref_invalid_total` / `rs_binding_invalid_total` sıçraması                   | Kendiliğinden: IP kovası 10/dk → 15 dk blok. §12.5 Caddy IP dağılımı               | Kalıcıysa üst güvenlik duvarında IP/önek engeli                                                                  |

**İnceleme sorguları** (salt okunur, `app`; tenant'ı daraltın):

```sql
-- Kayıtla açılan son talepler ve kaynakları (ham IP yalnız audit'te)
SELECT r.id, r.created_at, r.status, r.customer_id, r.binding_id FROM support_requests r
 WHERE r.tenant_id='<tenant>' AND r.binding_id IS NOT NULL AND r.created_at > NOW() - INTERVAL 1 DAY ORDER BY r.created_at DESC LIMIT 50;
-- Kayıt yaşam döngüsü (verme, yenileme, reddedilen bayat kaynak, iptal)
SELECT created_at, action, entity_id, ip_address, new_value FROM audit_logs
 WHERE tenant_id='<tenant>' AND action IN ('binding.issued','binding.denied','binding.revoked','customer.ref_rotated','customer.deactivated')
   AND created_at > NOW() - INTERVAL 7 DAY ORDER BY created_at DESC LIMIT 100;
-- Bir kaydın durumu
SELECT id, customer_id, issue_count, last_used_at, revoked_at, revoke_reason FROM device_bindings WHERE id='<binding id>';
```

Anahtar ve tam ref hiçbir log/audit satırında yoktur (yalnız ref'in ilk 4 karakteri); müdahale notuna da yazmayın.
**Kapanış:** olay zamanı, alınan aksiyon, `revokedBindings`/`cancelledRequests` sayıları ve müşteriye bildirim bilgisini
olay kaydına yazın; aynı müşteri 30 gün içinde tekrar ederse dosya dağıtım yöntemini müşteriyle gözden geçirin.

### 13.5 Metrikler ve alarmlar (P8c; adlar mimari-e10 §10, server tarafı backend)

| Seri                                                                                                       | Tür                       | Pano / kural                                                                                                                  | Anlamı / ilk adım                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rs_customers_active`                                                                                      | gauge (günlük)            | Pano                                                                                                                          | Tenant'lar toplamı aktif müşteri; tasarım tavanı ~1.000/tenant (mimari-e10 §7)                                                                                                                                                                                                                            |
| `rs_bindings_issued_total{renewed}`                                                                        | counter                   | Pano: `sum by (renewed)(increase(...[1d]))`                                                                                   | `renewed="false"` yeni bilgisayar, `"true"` rotasyon. 0.10.0 yayınından sonra artmıyorsa `binding.offer` gitmiyor (istemci sürümü / ticket `clientVersion`)                                                                                                                                               |
| `rs_binding_denied_total{reason}`                                                                          | counter                   | Pano                                                                                                                          | P8c-1 B-P8c-4: verilmeyen kayıtlar. `stale_source` (yenileme/iptal öncesi açılmış talep) ve `inactive` (oturum/tenant/müşteri pasif) audit `binding.denied` ile de görünür; `rate` (oturum başına > 3), `no_offer`, `browser` yalnız metrik. `rate`/`no_offer` sürekli artışı → bozuk ya da sahte istemci |
| `rs_bindings_issued_total{renewed,multi}` / `rs_binding_denied_total{reason="capacity"\|"no_multi"}` (P20) | counter                   | Pano                                                                                                                          | `multi="true"` 0.12.0 çoklu firma dalı. `capacity` = bilgisayar 5 firmaya kayıtlı, kayıt verilmedi (audit `binding.denied{reason:"capacity"}`); `no_multi` = multi teklifi olmayan bağlantıdan `previousKeys` (bozuk/sahte istemci)                                                                       |
| `rs_request_messages_rejected_total{reason="validation"}` (P20, S-P18-K7)                                  | counter                   | Pano; eşik yayından 2 hafta sonra                                                                                             | Yetenekli `/ws/request` soketinde gövde kuralını geçemeyen `request.message` (soket açık kalır). Sürekli artış = istemci (P19 tarayıcı / 0.12 Go) doğrulama açığı                                                                                                                                         |
| `rs_binding_invalid_total`                                                                                 | counter                   | Pano; `rs_request_ref_invalid_total` alarmına zaten dahil                                                                     | Bağlantı yenileme/pasif sonrası geçici sıçrama **beklenir** (eski kayıtlı bilgisayarlar açılışta 404 alır). Yenileme olmadan sürekli artış → §13.4 numaralandırma satırı                                                                                                                                  |
| `rs_bindings_revoked_total{reason}`                                                                        | counter                   | Pano: `sum by (reason)(increase(...[1d]))`                                                                                    | `FORGOTTEN` müşteri "unut", `ADMIN_REVOKED` panel iptali, `CUSTOMER_*`/`GENERAL_ROTATED` toplu, `REPLACED` başka tenant'a geçiş, `EXPIRED` günlük 03:30 iş, `TENANT_PASSIVE`                                                                                                                              |
| `rs_requests_created_total{via}`                                                                           | counter                   | Pano: `sum by (via)(rate(...[1h]))`                                                                                           | `via="ref"` dosya/bağlantı, `"binding"` kayıtlı bilgisayar                                                                                                                                                                                                                                                |
| Alarm `increase(rs_request_ref_invalid_total[1m]) > 100`                                                   | **Uyarı** (mevcut, §12.5) | —                                                                                                                             | Kayıt geçersizleri de bu kovaya sayılır                                                                                                                                                                                                                                                                   |
| Alarm `increase(rs_bindings_revoked_total{reason="ADMIN_REVOKED"}[1h]) > 10`                               | Bilgi                     | —                                                                                                                             | Bir saatte çok sayıda tek kayıt iptali: kötüye kullanım dalgası olabilir; §13.4 inceleme sorgusu                                                                                                                                                                                                          |
| Haftalık bakış: günlük 03:30 boşta kalma işi                                                               | Bilgi                     | SQL (beklenen 0): `SELECT COUNT(*) FROM device_bindings WHERE revoked_at IS NULL AND last_used_at < NOW() - INTERVAL 731 DAY` | 730 gün en uzun saklama süresidir; `> 0` ise iş çalışmıyor → `docker compose logs server --since 26h` içinde iş hatası, backend-dev                                                                                                                                                                       |

Etiket değerleri sabit kümedir (IP, tenant, müşteri kimliği etiket olmaz). Metrik toplayıcı (Prometheus) bu projede henüz
kurulu değil (P13); o zamana kadar §13.1/8'deki `/metrics` komutuyla elle okunur.

### 13.6 Sorun giderme (P8c)

| Belirti                                                             | Kontrol / çözüm                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Müşteri bağlantısı 404                                              | Müşteri pasif veya bağlantı yenilenmiş (detayda ref/durum); tenant pasif. Etiket değiştiyse dosya adı değişir → yeni bağlantıyı kopyalayın. İç uç: §12.6 `agent-ready` komutu, müşteri ref + müşterinin güncel `file_label`'ı ile 204                                                           |
| Müşteri "Bu bilgisayarın destek kaydı artık geçerli değil." görüyor | Beklenen durumlar: unutuldu, panelden iptal, müşteri yenilendi/pasif, Genel yenilendi, tenant pasif, saklama süresi kadar kullanılmadı. Müşteri bağlantı kodu veya güncel dosya ile devam eder; başarılı oturumdan sonra yeni kayıt alır. Nedeni: `device_bindings.revoke_reason` (§13.4 sorgu) |
| Kayıt hiç verilmiyor (`rs_bindings_issued_total` düz)               | İstemci < 0.10.0 (teklif gönderilmez, tasarım gereği); oturum talepten bayat kaynakla doğdu (audit `binding.denied{reason:"stale_source"}`); müşteri pasif (`CONFLICT`)                                                                                                                         |
| "Müşteriler" menüsü yok                                             | Kullanıcıda `customers.view` yok (User varsayılan kapalı) → Admin toggle'dan açar; staging teknisyeni için `staging-users.sh` (§13.1/7)                                                                                                                                                         |
| Migrate 3819 / 1452 ile durdu                                       | Migration expand-only; beklenmez. `docker compose logs migrate` → kısıt adını dba'ya bildirin, §13.2/1 ile önceki imaja dönün, Prisma kaydını `migrate resolve --rolled-back 20261112120000_p8c_customers` ile kapatın                                                                          |
| `down.sql` 3819 `p8c_down_guard_chk`                                | §13.2/2 — tasarım gereği; satırlara dokunmayın                                                                                                                                                                                                                                                  |
| Seed sonrası müşteri karşılamada 400                                | §13.1 yayın notu; müşteri sayfayı yeniler                                                                                                                                                                                                                                                       |

### 13.7 İstemci 0.10.0 (P8c-2) yayın satırı

P8c-1 staging'de GEÇTİ olduktan sonra §11.3/§11.5 akışıyla (`v0.10.0`, iki derleme aynı SHA-256, staging'de
`--dir --no-attestation` + `ALLOW_UNATTESTED=staging`). Sunucu tarafında ek adım yok (env/Caddy aynı). `MIN_AGENT_VERSION`
**yükseltilmez** (0.9.x müşteri bağlantısıyla talep açabilir, R21). Geri alma: §11.4; eski istemciye dönüş sunucuyu etkilemez,
kayıtlar istemcide yeni sürüme kadar kullanılmaz. §8 yayın geçmişine satır.

## 14. P9 — firma (tenant) ve kullanıcı yönetimi (backend-dev, 2026-11-12)

Yeni env değişkeni, migration veya grant **yok** (tablolar P1'den; `app` kullanıcısının `tenants`, `tenant_settings`,
`users`, `user_permissions`, `auth_sessions` yetkileri yeterli).

### 14.1 Firma oluşturma — firma doğrulaması (mimari §10.2 P9)

Super Admin "Firmalar > Yeni firma" (veya `POST /api/v1/admin/tenants`) **öncesinde**:

1. Talep eden firmanın ticari unvanı ve vergi no'su sözleşme/sipariş kaydıyla eşleşiyor mu (unvan aynen "Firma adı" olur;
   aydınlatma metninde veri sorumlusu olarak görünür).
2. İlk Admin olacak kişinin e-postası firmanın kurumsal alan adında mı ve firmanın kayıtlı telefonundan geri aranarak teyit
   edildi mi (dolandırıcıya firma açılmasın — G-17).
3. Kısa ad (`slug`) firmayı açıkça tanımlıyor mu; başka firmayı taklit etmiyor mu.
   Sonra: firmaya geç (`switch-tenant`) → Kullanıcılar > Yeni kullanıcı (rol Admin). Geçici şifre **yalnız bir kez**
   gösterilir; Admin'e telefonda veya ayrı kanaldan iletilir (e-postayla aynı mesajda gönderilmez). İlk girişte değiştirilir.

### 14.2 Firma pasife alma (AC-70)

Tek işlem: kullanıcı oturumları iptal, bekleyen kod oturumları `CANCELLED(tenant_passive)`, etkin oturumlar
`session.ended{tenant_passive}`, bekleyen talepler `TENANT_PASSIVE`, bilgisayar kayıtları geçersiz. Commit sonrası
adımlardan biri düşerse log alarmı `tenant_passive_effect` (step = rooms|panels|requests|bindings); yedek yollar
30 sn talep/kayıt süpürücüsü ve /ws/tech 60 sn yeniden doğrulaması. Yeniden etkinleştirme iptal edilenleri geri getirmez.

### 14.3 Alarm

`user_live_effect`: yetki/rol/pasif değişikliği canlı oturuma anında yansıtılamadı; 60 sn yeniden doğrulama devralır.
Tekrarlıyorsa sunucu logunda `err` incelenir.

## 14. P10 — hesap güvenliği + SMTP

- **Yayın ön koşulu:** `.env`'e `APP_ENCRYPTION_KEYS=v1:<openssl rand -base64 32>` (§3). Migration `20261112180000_p10_account_security`.
- **2FA zorunluluğu (AC-67):** yayından sonra her Super Admin/Admin ilk girişte 2FA kurar (QR + 10 kurtarma kodu). USER için
  firma ayarı `requireTech2fa` (varsayılan açık).
- **Admin 2FA kaybı:** aynı firmadaki başka Admin Kullanıcılar → kullanıcı → "2FA'yı sıfırla" (`POST /users/:id/reset-mfa`).
- **Super Admin 2FA/şifre kaybı (SMTP yok — koordinatör kararı 1):** Super Admin'in firması olmadığı için sıfırlama/kilit
  e-postası gönderilmez (istek yine 202, audit `auth.password_reset_requested fail{reason:no_smtp}`). Kurtarma sunucuda,
  **`reset-superadmin` CLI** ile yapılır (P13b; eski elle SQL yöntemi **kullanılmaz**): komutlar, çıktı ve çıkış kodları §20.6.
  Özet: `cd /opt/remote/deploy && docker compose exec server node src/cli/reset-superadmin.ts --email <e-posta> [--reset-mfa]`
  (`-T` verilmez; TTY şart). Geçici parola **yalnız terminale, bir kez** yazılır ve **24 saat** geçerlidir; Super Admin ilk
  girişte değiştirir, `--reset-mfa` verildiyse 2FA'yı yeniden kurar. İşlem audit'e `auth.superadmin_reset` olarak yazılır
  (parola yok). Super Admin şifresi ve kurtarma kodları yine parola kasasında tutulur.
- **Prod açılış kontrol listesi (P10 ön koşulları):**
  1. `APP_ENCRYPTION_KEYS` üretildi: `echo "v1:$(openssl rand -base64 32)"` çıktısı `deploy/.env`'e yazıldı (ekrana/loga
     kopyalanmadan; dosya `chmod 600`).
  2. Anahtar **parola kasasında yedeklendi** (DB yedeğinden ayrı yerde). Anahtarsız DB yedeği SMTP şifrelerini ve 2FA'yı
     geri getirmez.
  3. `docker compose up -d` sonrası server açıldı (`APP_ENCRYPTION_KEYS` yoksa compose `:?` ile durur).
  4. Super Admin ilk girişte şifresini değiştirdi, **2FA'yı kurdu** ve 10 kurtarma kodunu parola kasasına kaydetti;
     çıkış → giriş → kod ekranı ile doğrulandı.
  5. Her firmanın ilk Admin'i ilk girişte 2FA kurdu; firma SMTP'si girildi ve **Test Maili Gönder** başarılı.
  6. "Şifremi unuttum" bir test hesabıyla denendi (e-posta geldi, bağlantı tek kullanımlık).
  7. **(P11)** MySQL bayrağı açık: `SELECT @@log_bin, @@log_bin_trust_function_creators` → `1	1` (§15.1/3); audit
     tetikleyicileri 2 ve `check-app-grants.sh` **320/320 PASS** (§15.1/5).
  8. **(P11)** Panel MySQL ayarı (Sistem ayarları > MySQL (`/admin/settings/mysql`; kaynak "panel" ve çalışan bağlantıyla eşleşiyor göstergesi)) yalnız **`app`** kullanıcısıyla girildi (root/migrator değil),
     "Bağlantıyı Test Et" başarılı; değer `.env` ile aynı (§15.4). Panelde farklı değer kayıtlıysa bilinçli olarak
     `.env`'e aktarıldı ve server yeniden başlatıldı — aksi halde panel "kayıtlı" görünür ama uygulama `.env`'i kullanır.
  9. **(P11)** Panel TURN ayarı boş (env `TURN_URLS`/`TURN_SECRET` kullanılıyor) **veya** panel secret'ı coturn
     `static-auth-secret` ile aynı; her iki durumda "Bağlantı testi" ile TURN relay adayı alındı (§15.5, §9.7).
     `deploy/.env` `TURN_SECRET` coturn ile aynı tutuluyor (panel kaydı silinince geri dönülen değer budur).
  10. **(P11)** Audit Log ekranı salt okunur: `PUT/DELETE /api/v1/audit` → 405; DB'de `UPDATE audit_logs` → `SIGNAL 45000`.
- **SMTP testi "Bu sunucu adresi kullanılamaz":** host özel/loopback/link-local/CGNAT/Docker IP'sine çözümleniyor (G-12) —
  bilinçli; iç ağ SMTP'si desteklenmez. Gönderim hatasının ayrıntısı server logunda `event:"smtp_send_failed"` (`reason`,
  `code`, `responseCode`; alıcı/şifre yok).
- **Metrik:** `rs_mail_total{kind,result}` (`result`: ok|connect|auth|tls|rejected|not_configured).
- **Alarm `netguard_self_unresolved` (B-P10-10):** `PUBLIC_BASE_URL` hostu çözülemedi. `cached:true` → son başarılı çözüm
  kullanılıyor (gönderim sürer); `cached:false` → (süreç açıldığından beri hiç çözülemedi) tüm SMTP hedefleri
  "Bu sunucu adresi kullanılamaz" ile reddedilir (fail-closed). Sunucunun DNS çözücüsü (`/etc/resolv.conf`, konteyner DNS'i)
  kontrol edilir.
- **SMTP bağlantı tavanı (B-P10-11):** her gönderim denemesi en çok 12 sn; sürede bitmeyen bağlantı (yavaş/damlatan sunucu)
  sunucu tarafında kapatılır (`reason: connect`).
- **Anahtar rotasyonu / emekliye ayırma (`APP_ENCRYPTION_KEYS`):**
  1. Daha yüksek numaralı yeni sürüm eklenir (`v1:...,v2:...`); yeni yazımlar en yüksek numaralı sürümle yapılır, okuma
     kaydın sürüm baytına göre (kurtarma kodu doğrulaması tüm sürümlerle).
  2. Eski sürüm, onunla yazılmış veri kalmayana kadar listeden **çıkarılmaz**: TOTP sırları (`users.totp_secret_enc`), SMTP
     şifreleri (`tenant_settings.smtp_pass_enc`) ve kurtarma kodu HMAC'leri (`recovery_codes.code_hash`, HKDF ile anahtardan
     türetilir). Yeniden şifreleme işi **yoktur**; kurtarma kodu HMAC'i düz kod bilinmeden yeni anahtarla yeniden
     hesaplanamaz.
  3. Bir sürüm erken çıkarılırsa o sürümle yazılmış veriler **geri dönüşsüz bozulur**: SMTP şifreleri çözülemez (log alarmı
     `smtp_secret_unreadable`, e-posta gönderilmez → şifre panelden yeniden girilir), 2FA sırları ve kurtarma kodları
     doğrulanamaz (etkilenen kullanıcıların 2FA'sı sıfırlanır, §14 P10 "Admin/Super Admin 2FA kaybı").
  4. Çıkarmadan önce eski veri kalmadığı doğrulanmalıdır (SMTP şifresi panelden yeniden kaydedilir; kullanıcılar 2FA'yı
     yeniden kurar ve yeni kurtarma kodu üretir). Şüphede sürüm listede tutulur — fazladan sürümün maliyeti yoktur.
  5. **Anahtar yedeği zorunludur:** tüm sürümler (emekliye ayrılanlar dahil, en az son DB yedeğinin saklama süresi boyunca)
     parola kasasında tutulur; DB yedeğinden geri dönüşte o yedeğin yazıldığı sürümler gerekir. Anahtar loga, dokümana,
     repoya yazılmaz.

## 15. P11 — sistem ayarları (MySQL/TURN) + audit değiştirilemezliği (devops, 2026-11-13)

Migration `20261113090000_p11_system_settings_audit` (`system_settings` tablosu, `audit_logs` BEFORE UPDATE/DELETE
tetikleyicileri, audit indeksleri). **Yeni env değişkeni yok.** Değişen altyapı: `deploy/docker-compose.yml` mysql
`command`'a `--log-bin-trust-function-creators=1` eklendi. Neden: MySQL 8.4'te binlog açık; SUPER'siz `migrator`
tetikleyici oluşturamaz (**ERROR 1419**). SUPER verilmedi, binlog kapatılmadı (PITR/replika kalır) — gerekçe
`docs/db-notlari.md` "P11". **`--sysdate-is-now` eklenmez** (audit DELETE tetikleyicisi `SYSDATE()`'e dayanır).

### 15.1 Yayın sırası (staging, §8 akışı; prod'da aynı)

MySQL konteyneri yeniden oluşturulur → **10–30 sn DB kesintisi** (server `/ready` kısa süre 503; etkin oturumlar
DB'ye yazamaz). Düşük trafik saatinde yapın.

1. **Yedek** (ayrı ssh çağrısı, §13.1/1 ile aynı komut; dosya adı `remote-pre-p11-…`):

```bash
ssh root@185.126.217.99 'cd /opt/remote/deploy && F=/root/remote-pre-p11-$(date -u +%Y%m%dT%H%M%SZ).sql.gz \
  && docker compose exec -T mysql sh -c '\''MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction --triggers --routines "$MYSQL_DATABASE"'\'' | gzip > "$F" \
  && chmod 600 "$F" && ls -l "$F" && gzip -t "$F" && echo yedek-ok'
```

2. **Repo güncelle** (§8 bundle + pull, yeni ssh çağrısı, `umask` yok; §13.1/2 izin kontrolü). Ardından **yalnız mysql**:

```bash
cd /opt/remote/deploy && docker compose up -d mysql      # command değişti → konteyner yeniden oluşturulur;
                                                         # mysql_data volume'u ve veri KORUNUR (down -v YAPMAYIN)
docker compose ps mysql                                  # (healthy) görünene kadar bekleyin
```

3. **Doğrula** (parola konteynerin env'inden okunur, komut satırına yazılmaz):

```bash
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -NBe "SELECT @@log_bin, @@log_bin_trust_function_creators"'
# beklenen:  1	1      (ilk 0 ise binlog kapalı — beklenmez, durun ve dba'ya sorun; ikinci 0 ise bayrak gelmedi:
#                       `docker compose config | grep -A3 'mysql:' | grep command` yeni satırı göstermeli)
```

Yeniden başlatma istenmiyorsa (alternatif, kalıcı): root ile `SET PERSIST log_bin_trust_function_creators = 1`
(volume'daki `mysqld-auto.cnf`'e yazılır; 1287 "deprecated" uyarısı normal). Compose bayrağı yine kaynak gerçeklik
olarak kalır; bir sonraki `up -d mysql`'de zaten uygulanır. 4. **Build + migrate + server:** `docker compose build && docker compose up -d` → `docker compose logs --since 5m migrate`
("All migrations have been successfully applied"). Ardından `docker compose --profile setup run --rm seed` (zararsız). 5. **Yetki sınırı:** `set -a; . ./.env; set +a; APP_PW=$MYSQL_APP_PASSWORD CONTAINER=$(docker compose ps -q mysql) DB=$MYSQL_DATABASE bash mysql/check-app-grants.sh | tail -3; echo rc=$?`
→ **320/320 PASS**, `rc=0` (302 + 18 P11: tetikleyici sayısı 2, `app`'te TRIGGER/ALTER/DROP/CREATE/INDEX yok, audit_logs
yalnız SELECT/INSERT, system_settings izin + 4 CHECK). Betik root kontrollerini konteynerin `MYSQL_ROOT_PASSWORD`
env'iyle yapar; parola çıktıya düşmez. Kontrol: `... check-app-grants.sh | grep -c PASS` = 320, `grep -c FAIL` = 0. 6. **Duman testi:** Super Admin → Audit Log ekranı açılır, filtreler çalışır, düzenleme/silme düğmesi yok; Sistem ayarları > MySQL "Bağlantıyı Test Et" (app kullanıcısı) başarılı; TURN ayarı boş bırakılır (env kullanılır) veya §15.5. 7. §8 yayın geçmişine satır (yedek yolu, grants 320, `1 1` doğrulaması).

**Yerel prova (devops, 2026-11-13, geçici `mysql:8.4.13` digest-sabit, `rs-mysql-p11ops:33351` ve compose projesi
`p11volprova`; hepsi silindi):** (a) bayraksız açılmış named volume'lu konteyner → `command`'a bayrak eklenip
`docker compose up -d mysql` → konteyner yeniden oluştu, `1 1`, önceki tablo verisi korundu (42); (b) P1→P11 migrate,
CI adımının birebir komutu `1 1` ve rc 0; `check-app-grants.sh` 320 PASS / 0 FAIL, çıktıda parola yok; (c) §15.2 guard,
1419 ve kurtarma akışı aşağıdaki gibi denendi. Not: Docker Desktop (macOS arm64) üzerinde `user:` verilmeden açılan
compose mysql'i gosu adımında takılıp unhealthy kaldı (bilinen QA-P5-6 sorunu, `test-db.sh` `--user mysql` kullanır);
Linux staging/prod'u etkilemez.

### 15.2 Migrate 1419 ile durursa (bayrak unutulduysa)

Belirti: `docker compose logs migrate` → `P3018` + `ERROR 1419 ... You do not have the SUPER privilege and binary
logging is enabled`; server başlamaz (eski server konteyneri çalışıyorsa çalışmaya devam eder). Migration **ilk
ifadede** (tetikleyici) durur, **hiçbir şey değişmez** (tablo/tetikleyici/indeks yok — prova: tetikleyici 0, tablo 0).

1. §15.1/2–3: `docker compose up -d mysql` → `1	1` doğrulaması.
2. Prisma'daki başarısız kaydı kapat:
   `docker compose run --rm migrate pnpm --filter @remote/server exec prisma migrate resolve --rolled-back 20261113090000_p11_system_settings_audit`
3. `docker compose up -d` (migrate yeniden dener) → §15.1/4–5.
   Karar verilemiyorsa bu arada §8 Rollback ile önceki `IMAGE_TAG`'e dönün (şema P10'da kaldığı için eski server çalışır).

### 15.3 Geri alma (denendi: devops 2026-11-13 yerel; dba aynı akışı drift 0 ile doğruladı)

Tercih: **ileri düzeltme > yalnız imaj geri alma > imaj + `down.sql`**. P10 server'ı `system_settings`'i okumaz ve
tetikleyiciler P10 kodunu etkilemez (audit'e yalnız INSERT yapar) → çoğu durumda yalnız imaj geri alma yeter.

1. **Önceki imaj:** `.env`'de `IMAGE_TAG=<P10 etiketi>` → `docker compose up -d`.
2. **`down.sql`** (yalnız şemanın kendisi sorunluysa; önce §15.1/1 yedeği ve 1. adım):

```bash
docker compose run --rm migrate pnpm --filter @remote/server exec prisma db execute \
  --file prisma/migrations/20261113090000_p11_system_settings_audit/down.sql
```

**Koruma — `p11_down_guard_chk`:** `system_settings`'te kayıt varsa (Super Admin MySQL/TURN ayarı kaydetmişse)
**3819 `Check constraint 'p11_down_guard_chk' is violated`** ile durur ve hiçbir şey değişmez (prova: tetikleyici 2,
satır 1 yerinde). Bilinçli karar verilirse: ayarlar not edilir, TURN için `.env` `TURN_URLS`/`TURN_SECRET` coturn ile
uyumlu olduğu doğrulanır (panel kaydı silinince bu değerlere dönülür), migrator ile `DELETE FROM system_settings;` (panelde "varsayılana dön" de satır bırakır; guard'ı o da tetikler)
ve komut tekrar. Guard geçerse: yetkiler REVOKE, tetikleyiciler + tablo düşer, audit indeksleri P10'a döner,
`_prisma_migrations` kaydı silinir (prova: tetikleyici 0, tablo 0, son migration `20261112180000_p10_account_security`).
Ardından `check-app-grants.sh`: P11 satırları FAIL/"tablo yok" verir (beklenen), P10 ve öncesi PASS.
**Etkisi:** DB düzeyinde audit UPDATE/DELETE koruması kalkar (yalnız `app` yetki sınırı kalır) — güvenlik ekibine bildirin. 3. **Yeniden ileri:** yeni `IMAGE_TAG` → `docker compose up -d` (bayrak açık olduğundan migrate doğrudan geçer; prova OK).

- Bayrağın kendisini geri almaya gerek yoktur (P10 şemasında etkisi yok); geri alınırsa P11 bir daha uygulanamaz (§15.2).

### 15.4 Panel MySQL ayarı → `.env` aktarımı (ADR-0003: canlı geçiş YOK)

Panel ekranı bağlantıyı **test eder ve şifreli saklar**; uygulama açılışta yine `.env`'den kurulan `DATABASE_URL`'i
kullanır (`DATABASE_URL` yoksa `system_settings` zaten okunamaz). Kaydetmek hiçbir şeyi değiştirmez; geçiş yeniden
başlatma ister. Panel kayıtlı şifreyi geri göstermez → şifre **parola kasasından** alınır.

- **Panelde girilecek kullanıcı yalnız `app`'tir** (en az yetki; root/`migrator` girilmez — migrator şifresi server'a
  hiçbir yoldan verilmez, G-15).
- **Aynı (compose içi) MySQL, yalnız `app` şifresi değişiyor:**
  1. Yedek (§15.1/1). Yeni şifre: `openssl rand -hex 24` (URL'de kaçış gerektirmeyen karakterler).
  2. Etkileşimli root oturumu (şifre komut satırına/geçmişe düşmez):
     `docker compose exec mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot'` → `ALTER USER 'app'@'%' IDENTIFIED BY '<yeni>';`
  3. `deploy/.env` `MYSQL_APP_PASSWORD=<yeni>` (compose `DATABASE_URL`'i bundan üretir) → `docker compose up -d server`
     (seed/staging-users da aynı değişkeni okur).
  4. Panelde aynı şifreyi girip "Bağlantıyı Test Et" → başarılı → Kaydet. `curl -fsS https://<alan>/ready` 200.
- **Farklı (harici) MySQL sunucusu:** compose `DATABASE_URL`'i `mysql` servis adına sabittir; harici DB için
  sunucuya özel `deploy/docker-compose.override.yml` (repoya girmez; sunucuda `.git/info/exclude`) ile
  `server`, `seed` ve `migrate` servislerinin `DATABASE_URL`/`MIGRATE_DATABASE_URL` değerleri ayrı `.env` anahtarlarından
  verilir; harici DB'de `app`/`migrator` kullanıcıları `deploy/mysql/init/01-users.sh` ve `grants.sql` ile kurulur, veri
  yedekten taşınır (§ "yedekten dön"). Bu bir **planlı göç**tür, panelden yapılamaz; mimar/dba onayıyla yürütülür.
- Rollback: `.env`'deki eski değer (`.env.bak.<tarih>` alınarak değiştirilir) → `docker compose up -d server`.

### 15.5 Panel TURN ayarı ↔ coturn `static-auth-secret` uyumu

Server TURN kimlik bilgisini (HMAC) **panelde kayıt varsa panelden**, yoksa `.env` `TURN_URLS`/`TURN_SECRET`'tan üretir
(G-13). coturn ise secret'ı yalnız kendi `deploy/turn/.env`'inden okur (`static-auth-secret`). **İkisi aynı değilse TURN
aktarımı sessizce kırılır**: istemciler 401 alır, yalnız doğrudan/STUN bağlantısı kalır, NAT arkası oturumlar siyah ekran.

- **Panelden secret değiştirmek = rotasyon** (§9.6 sırası, server adımı panel olur):
  1. `deploy/turn/.env`: `TURN_SECRET_PREVIOUS=<eski>`, `TURN_SECRET=<yeni>` (≥ 32 karakter, boşluk/`#` yok; `openssl rand -hex 32`)
     → `cd deploy/turn && docker compose up -d coturn` (iki secret kabul).
  2. Sistem ayarları > TURN (`/admin/settings/turn`): aynı `<yeni>` secret + URL'ler → Kaydet.
  3. **`deploy/.env` `TURN_SECRET=<yeni>`** de yapılır (panel kaydı silinirse/okunamazsa server env'e döner; env eski kalırsa
     o an TURN kırılır) → `docker compose up -d server`.
  4. `TURN_CRED_TTL_MIN` dk sonra `TURN_SECRET_PREVIOUS=` boşalt → `docker compose up -d coturn`.
  5. Doğrulama §9.7 (relay adayı alınır) + coturn logunda `401` artışı yok.
- **Panel URL'leri** yalnız bu coturn'ü göstermelidir (başka TURN sunucusu = başka secret).
- **Panel kaydı silinince** ("varsayılana dön"; satır `{urls: []}` olarak kalır) server env'e döner. Ayar canlıdır
  (her kimlik üretiminde okunur, yeniden başlatma gerekmez). Silmeden önce iki secret'ın aynı olduğunu **değeri
  göstermeden** doğrulayın — iki satır aynı özeti vermeli:
  `for f in deploy/.env deploy/turn/.env; do grep '^TURN_SECRET=' "$f" | sha256sum; done`
- `APP_ENCRYPTION_KEYS` sürümü erken çıkarılırsa panel TURN secret'ı çözülemez → server env'e **dönmez**, yalnız STUN
  verir (log `alarm:"system_secret_unreadable"`, `key:"turn"`); secret panelden yeniden girilir. Anahtar kuralı §14 P10.

### 15.6 Yedek ve geri yükleme notu (P11 sonrası)

- `mysqldump` tetikleyicileri `DEFINER=migrator@%` ile döker (`--triggers` varsayılan). Geri yükleme **root ile** yapılır ve
  bayrak açık olmalıdır (aksi halde 1419). Ayrı bir `backup` kullanıcısı tanımlanırsa `TRIGGER` yetkisi gerekir.
- `migrator` kullanıcısı silinir/yeniden adlandırılırsa audit UPDATE/DELETE "definer does not exist" ile reddedilir
  (fail-closed). **P13a'dan itibaren INSERT de reddedilir:** `audit_logs_force_created_at` (BEFORE INSERT) tetikleyicisinin
  DEFINER'ı da `migrator@%`'dir → migrator yoksa her audit yazımı hata verir; audit'e bağlı işlemler (giriş, ayar, yetki,
  oturum olayları) fail-closed olarak başarısız olur. `migrator` silinmez/yeniden adlandırılmaz; parola değişimi `ALTER USER` ile yapılır.
  Kontrol: `SELECT TRIGGER_NAME, DEFINER FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()` → 3 satır, hepsi `migrator@%`.
- Geri yükleme provasından sonra: `SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()` = **3**
  (P13a'dan itibaren: `audit_logs` no_update + retention_only_delete + force_created_at; P11–P12b arası 2). `restore.sh` bunu
  otomatik denetler (§18.4). P13a'dan sonra yedek/geri yükleme için §18 geçerlidir; buradaki elle komutlar yalnız tarihçedir.

### 15.7 Sorun giderme (P11)

| Belirti                                                  | Neden / Yapılacak                                                                 |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| migrate `P3018` + `1419`                                 | Bayrak yok → §15.2                                                                |
| server logu `audit_logs is append-only` (SIGNAL 45000)   | Kodda audit UPDATE denemesi — hata, backend'e bildir; DB koruması doğru çalışıyor |
| `down.sql` 3819 `p11_down_guard_chk`                     | `system_settings`'te kayıt var → §15.3/2                                          |
| Panel MySQL "kaydedildi" ama davranış değişmedi          | Beklenen (ADR-0003) → §15.4                                                       |
| Panel TURN kaydından sonra NAT arkası oturum siyah ekran | Panel secret ≠ coturn → §15.5                                                     |

## 16. P12 — logo/avatar yükleme ve tema (devops, 2026-11-13)

Migration `20261113120000_p12_branding` (yalnız CHECK; `system_settings` += `system_logo`, `logo_path`/`avatar_path`
biçimi; ayrıntı `docs/db-notlari.md` P12). Altyapı değişiklikleri:

- **Yeni env `UPLOADS_DIR`** (compose `server`: `/data/uploads`; §3).
- **Yeni named volume `uploads`** (`remote_uploads`) → server `/data/uploads` (okuma-yazma). Kök fs salt okunur kalır;
  kalıcı yazılabilir tek yer bu volume (`/tmp` tmpfs önceden de vardı; yükleme onu kullanmaz). Multipart gövde
  **tamamen bellekte** işlenir (`@fastify/multipart` `toBuffer`, ≤ 2 MB) → diske geçici dosya yazılmaz; volume'a yalnız
  sharp'ın yeniden kodladığı son dosya, aynı dizinde `.tmp` + `rename` ile atomik yazılır.
  İzinler: kök `/data/uploads` `node:node 0700` (Dockerfile; Docker **boş** volume'u ilk bağlamada bu sahiplikle
  doldurur), alt dizinler `{tenantId|system}/` **0750**, dosyalar **0640** (`apps/server/src/uploads/store.ts`).
  Caddy'ye bağlanmaz; dosyaları yalnız server sunar:
  - `GET /api/v1/files/logo/:tenantId/:file` — firma logosu, herkese açık (login, müşteri sayfası, e-posta)
  - `GET /api/v1/files/system-logo/:file` — sistem logosu, herkese açık
  - `GET /api/v1/files/avatar/:tenantId/:file` — avatar, **oturumlu** (başka tenant → 404; Super Admin hepsi)
    Dosya yalnız DB'de kayıtlı yolsa sunulur (volume'a elle konan dosya 404).
- **sharp (libvips)**: taban imaj `node:22-bookworm-slim` (glibc 2.36) + npm hazır ikilisi `@img/sharp-linux-x64`; apt paketi
  gerekmez. **sharp linux-x64 ikilisi x86-64-v2 CPU ister (SSE4.2)** → yayından önce §16.1/0.
- **Gövde sınırı:** Caddy `@upload` — **üç** yükleme ucu, yalnız POST: `/api/v1/settings/logo`,
  `/api/v1/admin/settings/system-logo`, `/api/v1/users/<id|me>/avatar` → 3 MiB, diğer `/api/*` 2MB (= 2.000.000 bayt), web 1MB. Host nginx `client_max_body_size 3m`.
  2 MB dosya sınırını server uygular (413). Yeni yükleme ucu eklenirse Caddyfile `@upload`/`@notUpload` ikisi birlikte.
- **CSP:** uygulamanın (`apps/web/proxy.ts`) `img-src 'self' data: blob:` — `/api/v1/files/*` aynı köken, değişiklik yok.
  Caddy logu `/api/v1/files/...` yolunu yazar (ad rastgele, gizli değil), sorgu dizesini yazmaz (`test-caddy.sh` sınar).

### 16.1 Yayın sırası (staging, §8 akışı; prod'da aynı)

Kesinti: yalnız server/web/caddy yeniden yaratılırken birkaç saniye. MySQL yeniden yaratılmaz. 0. **CPU ön kontrolü (bir kez, sunucuda):** `grep -qw sse4_2 /proc/cpuinfo && echo x86-64-v2-ok` → `x86-64-v2-ok`
görünmezse **yayını durdurun** (sharp yüklenemez → server açılmaz). Hipervizörde CPU modeli `host`/`x86-64-v2+` yapılır.

1. **Yedek** (ayrı ssh çağrısı; DB §15.1/1 komutu, dosya adı `remote-pre-p12-…`). P12 öncesi `uploads` volume'u yoktur,
   dosya yedeği gerekmez. Sonraki yayınlarda DB + uploads birlikte (§16.3).
2. **Repo güncelle** (§8 bundle + pull, yeni ssh çağrısı, `umask` yok).
3. **nginx vhost** (gövde sınırı 2m → 3m; host'ta, repo dosyasından):

```bash
V=/etc/nginx/sites-available/remote.noktabilisim.net
cp "$V" /root/remote.conf.prev && cp /opt/remote/deploy/nginx/remote.noktabilisim.net.conf "$V" \
  && { nginx -t && systemctl reload nginx || { cp /root/remote.conf.prev "$V"; nginx -t && systemctl reload nginx; echo GERI ALINDI; }; }
```

(§8.3 ile aynı desen.) Atlanırsa 2 MB'a yakın dosyalar nginx'te 413 alır. 4. **Build + up:** `docker compose build && docker compose up -d` → migrate önce çalışır
(`docker compose logs --since 5m migrate` → "All migrations have been successfully applied"). Caddyfile değiştiği için
`docker compose restart caddy` (admin API kapalı, `reload` yok). Seed: `docker compose --profile setup run --rm seed`. 5. **Volume ve sharp kontrolü:**

```bash
docker volume inspect remote_uploads --format '{{.Name}} {{.Mountpoint}}'
docker compose exec server node -e "const s=require('sharp');console.log('vips',s.versions.vips)"
docker compose exec server sh -c 'stat -c "%U:%G %a" /data/uploads && touch /data/uploads/.w && rm /data/uploads/.w && echo yazilabilir'
# beklenen: vips 8.x · node:node 700 · yazilabilir
```

6. **Yetki sınırı:** §15.1/5 komutu → **330/330 PASS**, `rc=0` (`grep -c FAIL` = 0).
7. **Duman testi (tarayıcı):** Admin → tenant ayarları → logo yükle (PNG ~1,9 MB) → önizleme → kaydet → üst menüde görünür;
   SVG ve uzantısı `.png` yapılmış metin dosyası reddedilir (400 `INVALID_IMAGE`); 2,5 MB dosya 413. Profil → avatar
   yükle/kırp/kaldır → baş harf avatarı. Super Admin → sistem logosu → login ekranında görünür. Tema Açık/Koyu/Sistem →
   çıkış/giriş ve başka tarayıcıda aynı tema; sayfa yenilemede yanıp sönme yok. Sunucuda:
   `docker compose exec server find /data/uploads -type f | head` → `<tenantId>/<rastgele>.webp|png|jpg`, `system/...`.
   `docker compose logs caddy --since 10m | grep -c '/api/v1/files/.*?'` → `0`.
8. §8 yayın geçmişine satır (yedek yolu, grants 330, CPU kontrolü).

### 16.2 Geri alma

Tercih: **ileri düzeltme > yalnız imaj geri alma > imaj + `down.sql`**. P11 server'ı yeni CHECK'lerden etkilenmez →
çoğu durumda 1. adım yeter.

1. **Önceki imaj:** `.env` `IMAGE_TAG=<P11 etiketi>` → `docker compose up -d`. `uploads` volume'u kalır (P11 kullanmaz,
   silmeyin: ileri dönüşte dosyalar gerekir). Logo/avatar yolu DB'de kalır; P11 arayüzü göstermez.
2. **`down.sql`** (yalnız şemanın kendisi sorunluysa; önce §16.1/1 yedeği ve 1. adım):

```bash
docker compose run --rm migrate pnpm --filter @remote/server exec prisma db execute \
  --file prisma/migrations/20261113120000_p12_branding/down.sql
```

**Koruma — `p12_down_guard_chk`:** `system_settings`'te `system_logo` satırı varsa (Super Admin sistem logosu yüklemişse)
**3819** ile durur, hiçbir şey değişmez. Bilinçli karar verilirse: migrator ile
``DELETE FROM system_settings WHERE `key` = 'system_logo';`` → komut tekrar. Dosya `system/` altında kalır;
gerekirse `docker compose exec server sh -c 'ls /data/uploads/system'` ile bulunup elle silinir. Ardından
`check-app-grants.sh`: P12 satırları FAIL verir (beklenen), P11 ve öncesi PASS. 3. **nginx** sınırını geri almaya gerek yok (3m daha geniş; Caddy yolları yine sınırlar). Gerekirse `/root/remote.conf.prev`. 4. **Yeniden ileri:** yeni `IMAGE_TAG` → `docker compose up -d`.

### 16.3 Yedek ve geri yükleme — `uploads` volume'u (denendi: devops 2026-11-13 yerel, aşağıda)

DB dökümü ile **aynı pencerede** alınır (DB'deki `logo_path`/`avatar_path` dosyayı gösterir; farklı anlarda alınırsa
yetim dosya veya kırık resim olur — kırık resim baş harf avatarına/sistem logosuna düşer, veri kaybı değildir).
Konteyner geçici olarak server imajıyla, **ağsız** ve salt okunur bağlanır; tar arşivi host'ta 600.

```bash
cd /opt/remote/deploy && set -a && . ./.env && set +a
T=$(date -u +%Y%m%dT%H%M%SZ); F=/root/remote-uploads-$T.tar.gz
( umask 077 && docker run --rm --network none -v remote_uploads:/u:ro remote-server:$IMAGE_TAG tar -C /u -czf - . > "$F" ) \
  && chmod 600 "$F" && gzip -t "$F" && tar -tzf "$F" | wc -l && ls -l "$F" && echo uploads-yedek-ok
```

- **Zamanlama/saklama:** DB yedeği ile aynı (P13 retention işiyle birlikte cron'a bağlanır; o zamana kadar her yayından önce elle).
  Şifreleme: dosyalar kişisel veri (avatar) içerir — sunucu dışına çıkarılırken DB yedeğiyle aynı şifreleme uygulanır.
- **Geri yükleme** (server durdurulur; volume boş veya üzerine yazılacak):

```bash
docker compose stop server
docker run --rm --network none -i -v remote_uploads:/data/uploads remote-server:$IMAGE_TAG \
  tar -C /data/uploads --no-same-owner -xzf - < /root/remote-uploads-<T>.tar.gz
docker run --rm --user 0 -v remote_uploads:/u remote-server:$IMAGE_TAG stat -c '%U:%G %a' /u   # node:node 700
docker compose start server
```

Komut imajın varsayılan kullanıcısıyla (node, uid 1000) çalışır → dosyalar node'a ait olur, chown gerekmez.

- **Volume yanlış sahiplikle oluştuysa** (ör. imaj güncellenmeden önce elle `docker volume create` yapıldı → `root 755`,
  server logunda `EACCES`): `docker run --rm --user 0 --network none -v remote_uploads:/u remote-server:$IMAGE_TAG sh -c 'chown -R 1000:1000 /u && chmod 0700 /u'`.
- **Prova (2026-11-13, yerel):** gerçek server imajı, geçici volume'a 2 dizin + 2 dosya → yukarıdaki yedek komutu (600, `gzip -t`
  OK) → yeni boş volume'a geri yükleme → `node:node 700`, dosyalar `node:node 644` (elle oluşturulan deneme dosyaları; uygulama 640 yazar), iki volume'un SHA-256 listesi aynı.
  **Düzeltme turu provası (2026-11-13, yerel):** güncel Dockerfile'dan derlenen server imajında gerçek
  `UploadStore.save()` ile (`--read-only --cap-drop ALL --network none`) `system/` ve `<tenantId>/` altına dosya yazıldı →
  kök `node:node 700`, dizinler `750`, dosyalar **`640`** → yukarıdaki yedek (arşiv 600, `gzip -t` OK) → boş volume'a geri
  yükleme → sahiplik/modlar (700/750/640) ve SHA-256 listesi **aynı** (tar, node kullanıcısı umask 022 altında 0640'ı korur).
  Not: eski bir `remote-server` imajıyla (P12 öncesi, `/data/uploads` satırı yok) yaratılan volume `root 755` olur →
  yükleme `EACCES`; aşağıdaki "yanlış sahiplik" adımı.

### 16.4 Doğrulama komutları (yerel / CI)

- `deploy/test-caddy.sh` → "gövde sınırı" bölümü: 2 MiB multipart üç yükleme ucundan geçer (avatar hem `me` hem `<id>` biçimiyle denenir → 4 istek), 3,2 MB 413; diğer `/api` 2 MiB 413;
  PUT 413; `/api/v1/files/*` logunda sorgu dizesi yok. CI'da çalışır.
- `deploy/nginx/test-nginx.sh` → 2 MiB yükleme geçer, 3,2 MB 413. CI'da çalışır.
- sharp duman testi (imaj değişince; taban imaj alpine/musl'a geçerse **zorunlu**):
  `docker run --rm --read-only --tmpfs /tmp --cap-drop ALL remote-server:<tag> node -e "require('sharp')({create:{width:8,height:8,channels:3,background:'#fff'}}).webp().toBuffer().then(b=>console.log('ok',b.length))"`.
- Lisans: sharp Apache-2.0, `@img/sharp-libvips-*` **LGPL-3.0-or-later** (dinamik bağlı paylaşımlı kütüphane) → `scripts/check-licenses.mjs`
  LGPL'i izinli sayar, istisna gerekmez (prova: gerçek `pnpm licenses list --prod` çıktısı "temiz").

### 16.5 Sorun giderme (P12)

| Belirti                                                                           | Neden / Yapılacak                                                                                                                     |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| server açılmıyor, log `Could not load the "sharp" module` / `Illegal instruction` | CPU x86-64-v2 değil (§16.1/0) veya imaj başka platformda derlendi (Mac'te `--platform` olmadan derleyip taşımayın; sunucuda derleyin) |
| Yüklemede `EACCES` / 500, log `/data/uploads`                                     | Volume sahipliği → §16.3 "yanlış sahiplik"                                                                                            |
| 2 MB'a yakın dosyada 413 ve yanıt HTML (nginx sayfası)                            | Host nginx 2m kalmış → §16.1/3                                                                                                        |
| 413 JSON değil, boş gövde (Caddy)                                                 | Uç `@upload` listesinde yok → Caddyfile + `test-caddy.sh`                                                                             |
| Logo/avatar kırık resim                                                           | DB yolu var, dosya yok (yedek/geri yükleme farklı anlardan) → kullanıcı yeniden yükler; toplu ise §16.3 ile eşleşen yedek             |
| Disk doluyor                                                                      | `docker system df -v                                                                                                                  | grep remote_uploads`; dosyalar ≤ 512 px yeniden kodlanır (tipik < 100 KB). Eski dosya silme backend'in işi (değiştirmede eski dosya silinir); artış anormalse backend'e bildir |

## 17. P12b — WhatsApp servisi sistem ayarı (devops, 2026-11-13; AC-196)

Migration `20261114090000_whatsapp_service_setting` (**yalnız CHECK**: `system_settings` anahtar kümesine `whatsapp`,
`{"url": string|null}` biçimi; tablo/sütun/grant/seed değişikliği yok; ayrıntı `docs/db-notlari.md` "WhatsApp servis ayarı").
Yeni env, volume, Caddy/nginx değişikliği **yok**. `WHATSAPP_SERVICE_URL` artık yalnız yedek (§3 satırı).

### 17.1 Etkin adres ve değişiklik yolu

- Öncelik: **panel kaydı** (`system_settings.whatsapp.value_json.url` dolu) **> `WHATSAPP_SERVICE_URL`**; P13b'den beri yerleşik varsayılan yok (ikisi de boşsa kanal kapalı, G-P13b-2).
- Değiştirme: Super Admin → Sistem ayarları → **WhatsApp servisi** → Servis URL'si → Kaydet. Yeniden başlatma gerekmez;
  kayıttan sonraki ilk bildirim ve test yeni adrese gider. Kayıt + audit `settings.whatsapp.updated` (eski → yeni) tek TX.
- Env'e dönüş: aynı ekranda **"Ortam değişkenine dön"** (onaylı; audit `settings.whatsapp.deleted`). Satır silinmez,
  `{"url": null}` olarak kalır (app kullanıcısında DELETE yok, P11 kararı) — etkin adres env/varsayılana döner.
- **Tuzak:** panel kaydı varken `.env`'deki `WHATSAPP_SERVICE_URL`'i değiştirip `up -d server` yapmak **etkisizdir**. Önce
  ekrandaki kaynak rozetine bakın: "Panel" → panelden değiştirin; "Ortam değişkeni" → env değişikliği geçerli.
- Kural (panel, env ve DB CHECK aynı): `http://` veya `https://` (küçük harf), `kullanıcı:şifre@` / `?` / `#` / boşluk /
  kontrol karakteri yok, ≤ 200 karakter; sondaki `/` kırpılır. Panelde uymayan değer 400 (alan hatası). **Env'de uymayan
  değer → server açılmaz** (`apps/server/src/env.ts` aynı `waServiceUrlSchema` ile doğrular; yayından önce `.env` değerini
  bu kurala göre kontrol edin, boş bırakmak = varsayılan).

### 17.2 Yayın sırası (staging, §8 akışı; prod'da aynı)

Kesinti: yalnız server/web yeniden yaratılırken birkaç saniye; MySQL yeniden yaratılmaz.

1. **Yedek** (ayrı ssh çağrısı; §15.1/1 komutu, dosya adı `remote-pre-p12b-…`) + §16.3 `uploads` yedeği aynı pencerede.
2. **Repo güncelle** (§8 bundle + pull, yeni ssh çağrısı, `umask` yok).
3. **`.env` ön kontrolü:** `grep '^WHATSAPP_SERVICE_URL=' deploy/.env` → boş veya §17.1 kuralına uygun olmalı
   (ör. sonunda `?x=1`, içinde `user:pass@` varsa server açılmaz — önce düzeltin).
4. **Build + up:** `docker compose build && docker compose up -d` → migrate önce çalışır
   (`docker compose logs --since 5m migrate` → "All migrations have been successfully applied"). Caddy yeniden başlatılmaz.
5. **Yetki sınırı:** §15.1/5 komutu → **337/337 PASS** (330 + 7), `grep -c FAIL` = 0.
6. **Duman testi:** Super Admin → Sistem ayarları → WhatsApp servisi: rozet "Ortam değişkeni", etkin adres görünür →
   "Test Mesajı Gönder" (kendi numaranız) sonucu ekranda; Audit ekranında `settings.whatsapp.test` (numara maskeli,
   `result`, varsa `reason`). Admin/User bu sekmeyi görmez (403). Panel kaydı denenecekse: adres kaydet → test → "Ortam
   değişkenine dön" → rozet tekrar "Ortam değişkeni". `docker compose logs server --since 10m | grep -c whatsapp_settings_load` → `0`.
7. §8 yayın geçmişine satır (yedek yolu, grants 337, rozet kaynağı).

### 17.3 Geri alma

Tercih: **ileri düzeltme > yalnız imaj geri alma > imaj + `down.sql`**. P12 server'ı `whatsapp` satırını okumaz → çoğu
durumda 1. adım yeter; P12 kodu env adresini kullanır (panel adresi o sürede **uygulanmaz** — env doğru olmalı).

1. **Önceki imaj:** `.env` `IMAGE_TAG=<P12 etiketi>` → `docker compose up -d`. Satır DB'de kalır (zararsız; ileri dönüşte yeniden geçerli).
2. **`down.sql`** (yalnız şemanın kendisi sorunluysa; önce 17.2/1 yedeği ve 1. adım — sunucu kodu önce geri alınır):

```bash
docker compose run --rm migrate pnpm --filter @remote/server exec prisma db execute \
  --file prisma/migrations/20261114090000_whatsapp_service_setting/down.sql
```

**Koruma — `wa_down_guard_chk`:** `system_settings`'te `whatsapp` anahtarlı **herhangi bir satır** varsa **3819** ile
durur, hiçbir şey değişmez. **"Ortam değişkenine dön" bunu çözmez**: satır `{"url": null}` olarak kalır ve guard'ı yine
tetikler. Down için satır migrator ile **silinmelidir** (bilinçli karar; panel adresi kaybolur, env/varsayılan geçerli olur):

```bash
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_MIGRATOR_PASSWORD" mysql -umigrator "$MYSQL_DATABASE"' \
  <<< "DELETE FROM system_settings WHERE \`key\` = 'whatsapp';"
```

ardından `down.sql` tekrar. Sonra `check-app-grants.sh`: P12b satırları FAIL verir (beklenen), P12 ve öncesi PASS (330).
Prova: dba 2026-11-14 geçici DB'de guard (satır varken 3819, değişiklik yok) + satır silinince temiz geri alma + drift 0
(`docs/db-notlari.md`). 3. **Yeniden ileri:** yeni `IMAGE_TAG` → `docker compose up -d` (migration yeniden uygulanır; panel adresi gerekiyorsa yeniden girilir).

### 17.4 Sorun giderme (P12b)

| Belirti                                                                          | Neden / Yapılacak                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Yayından sonra server açılmıyor, log env doğrulama hatası `WHATSAPP_SERVICE_URL` | Env değeri §17.1 kuralına uymuyor (kullanıcı:şifre, `?`, `#`, büyük harf şema, > 200). `.env`'i düzeltin veya boşaltın → `docker compose up -d server`                                                                                                                                                                                                                                                                                                                                          |
| `.env` değiştirildi, adres değişmedi                                             | Panel kaydı var (rozet "Panel") → panelden değiştirin veya "Ortam değişkenine dön" (§17.1)                                                                                                                                                                                                                                                                                                                                                                                                      |
| WhatsApp gitmiyor                                                                | Super Admin → WhatsApp servisi → "Test Mesajı Gönder"; Audit ekranı `settings.whatsapp.test` → `reason`: `unconfigured` (adres yok), `insecure` (prod'da http+genel adres, §12.3; **ya da her ortamda ayrıştırılamayan adres** — log `whatsapp_invalid_url`; istek gönderilmedi), `timeout` (8 sn), `http_error` (servis 4xx/5xx), `redirect` (3xx, izlenmez — adres yanlış/yönlendiriyor), `unreachable` (DNS/bağlantı/güvenlik duvarı). Ekrandaki mesaj sabittir; ayrıntı yalnız audit/log'da |
| Test 429                                                                         | Super Admin başına 5/dk (6. → 429) **ve** tüm Super Admin'ler için ortak 20/dk (21. → 429); `Retry-After` kadar bekleyin. Tenant testi ayrı kova (tenant 5/dk)                                                                                                                                                                                                                                                                                                                                  |
| Log `alarm:"whatsapp_insecure"`                                                  | §12.5 satırı; prod'da adresi `https://`/özel ağa çekin                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Log `alarm:"whatsapp_invalid_url"`                                               | Etkin adres ayrıştırılamıyor → kanal her ortamda kapalı; §12.5 satırı                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Log `alarm:"whatsapp_settings_load"`                                             | Açılışta panel kaydı okunamadı → env adresiyle çalışıyor; §12.5 satırı                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `down.sql` 3819                                                                  | `whatsapp` satırı var (`{url:null}` dahil) → §17.3/2                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## 18. P13a — yedek/geri yükleme, saklama işi alarmları, yayın (devops, 2026-11-14; AC-91, AC-199, AC-200)

Tasarım: `docs/mimari-p13.md` §2 (saklama), §4 (yedek). Dosyalar `deploy/backup/`: `backup.sh`, `restore.sh`, `lib.sh` (ortak),
`remote-backup.service` + `remote-backup.timer` + `remote-backup-failed.service` (systemd), `backup.env.example`.
Uygulama konteynerine eklenen bir şey yok; yedek host'ta, systemd ile çalışır.

| Konu          | Karar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ne            | MySQL dökümü (`backup` kullanıcısı, `--single-transaction --triggers --skip-extended-insert`) + `uploads` volume'u (logo/avatar) **aynı çalıştırmada**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Şifreleme     | `age -r <BACKUP_AGE_RECIPIENT>` (yalnız açık anahtar). **Çözme anahtarı sunucuda yok**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Nerede        | `BACKUP_DIR` (staging `/var/backups/remote`), çalıştırma başına `<UTC zaman>/` (700): `db.sql.gz.age`, `uploads.tar.gz.age`, `manifest.json` (hepsi 600)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Manifest      | zaman, sürüm (commit, `IMAGE_TAG`, MySQL sürümü + imaj), son migration, tetikleyici sayısı, tablo başına satır sayısı (dökümden, kesin), uploads dosya sayısı + özet listesinin sha256'sı, her dosyanın boyutu + sha256'sı (şifreli ve düz)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Ne zaman      | her gün 02:00 Europe/Istanbul (`Persistent=true`: kaçırılan çalıştırma açılışta telafi) — RPO ≤ 24 sa                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Saklama       | `BACKUP_KEEP_DAYS=14` (AC-91): her yedek en az 14 gün kalır, daha eskisi yalnız **başarılı** yedekten sonra silinir                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Düz veri      | Düz döküm/arşiv **diske hiç yazılmaz**: `mysqldump                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | sayım | gzip | tee(sha256, boyut) | age`; yan hesaplar FIFO üzerinden. Yarım kalmış `.partial-*` (yalnız sayı/özet içerir) her çalıştırmanın başında silinir. Geri yüklemede çözülmüş dosyalar yalnız **RAM'de** (`/dev/shm`; yoksa/yetmezse açık hata, `--work-dir` ile bilinçli seçim) (S-P13a-3) |
| Hata          | `set -euo pipefail`; eksik döküm (son satır `-- Dump completed`, tetikleyici sayısı DB = döküm), **DB'deki tetikleyici sayısı ≠ `BACKUP_EXPECTED_TRIGGERS` (22; P16 öncesi 3)** (audit koruması düşürülmüş; S-P13a-4), `backup.env` root/600 değil (S-P13a-7), MySQL erişilemez, disk < `BACKUP_MIN_FREE_MB` → rc ≠ 0, stderr/journal `remote-backup: FAILED adım=<adım> rc=<n>`, birim `failed` → `remote-backup-failed.service` journal'a `remote-backup: FAILED host=…` yazar + `BACKUP_ALERT_CMD`                                                                                                                                                                                                                                                                                                                                                                                                 |
| Doğrulama     | `restore.sh` (döküm tetikleyici satırı normalize edilerek, §18.4 notu) önce geçici, ağsız MySQL'e (aynı imaj + bayraklar) `mysql --system-command=OFF` ile yükler; tetikleyici = 22 (P16; `RESTORE_EXPECTED_TRIGGERS`) ve = manifest, imha defteri özeti (§23.5), son migration, tablo kümesi + satır sayıları, uploads listesi, **dökümde istemci meta-komutu yok** (tırnak dışında satırın herhangi bir yerinde `\X` — ör. `SELECT 1; \! id`; satır başında system/source/tee/pager/connect/use/edit/charset), **yükleme öncesi/sonrası anlık görüntü aynı**: hesap listesi, `CHECKSUM TABLE` mysql.user (plugin + authentication_string dahil; değer yazılmaz)/global_grants/db/tables_priv/columns_priv/procs_priv/proxies_priv/role_edges/default_roles/component, ROUTINES, EVENTS, `persisted_variables` özeti — farkta değişen öğenin **adı** yazılır (S-P13a-2) → `restore-verify: OK\|FAIL` |
| Env istisnası | `backup.env` anahtarları yalnız `backup.sh` içindir; server okumaz → `env.ts`/compose'a **girmez** (mimari-p13 §4). MySQL parolası `backup.env`'de değil, `deploy/.env` `MYSQL_BACKUP_PASSWORD` (yalnız mysql servisine verilir; döküm `docker exec` ile konteyner içinden, parola argümana düşmez). Mimari'deki `BACKUP_DB_PASSWORD` bu yüzden kullanılmadı (db-notlari P13a önerisi)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Host araçları | `docker`, `age`, `jq` (`apt-get install -y age jq`; age BSD-3, jq MIT). mysqldump/tar/sha256 hesapları `mysql:8.4.13` imajı içinde (sabit digest)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

**Kişisel veri notu (B-P12-3, KVKK):** saklama işinin anonimleştirdiği/sildiği veriler (oturum müşteri alanları, onay IP/UA,
dosya satırları, 730 günü dolan audit, pasif kullanıcı/firma dosyaları) **yedeklerde en çok 14 gün daha** (+ en fazla 1 saat
tolerans) kalır; rotasyonla düşer. Aydınlatma metni/VERBİS'te "yedekler 14 gün, şifreli" olarak geçer. Yedekten geri dönüşte
silinmiş veri geri gelebilir → geri yüklemeden sonraki ilk saklama turu (03:30) bunları yeniden anonimleştirir; acil ise §18.6'daki
gibi server yeniden başlatılmaz, tur beklenir (iş idempotent).

### 18.1 Ön koşul: age anahtar çifti (KULLANICI yapar; sunucuda değil)

Anahtar **yönetici iş istasyonunda** üretilir; özel anahtar sunucuya, repoya, dokümana, sohbete/bilete yazılmaz.

```bash
# macOS: brew install age   ·   Ubuntu: sudo apt-get install -y age
umask 077 && age-keygen -o remote-backup-age.key     # stderr: "Public key: age1..."  ← yalnız bu satır sunucuya gider
age-keygen -y remote-backup-age.key                  # açık anahtarı tekrar göster
```

- **Özel anahtarın yeri:** (1) şirket parola kasasında "Remote — yedek çözme anahtarı (age)" kaydı (dosya eki veya içerik),
  (2) çevrimdışı ikinci kopya (şifreli USB / kasadaki kâğıt çıktı, `AGE-SECRET-KEY-1...` tek satır). İki kişinin erişimi olmalı
  (tek kişi bağımlılığı RTO'yu bozar). Kaybolursa **hiçbir yedek açılamaz** → yeni çift üretilir, `BACKUP_AGE_RECIPIENT` güncellenir,
  hemen bir yedek alınıp §18.4 provası yapılır; eski yedekler 14 günde düşer.
- İkinci alıcı (önerilir): ayrı bir kişinin anahtarı `BACKUP_AGE_RECIPIENT=age1aaa…,age1bbb…` — biri kaybolsa diğeri açar.
- Rotasyon: yeni çift → recipient değiştir → yeni yedek + prova → eski özel anahtar 14 gün sonra (son eski yedek düşünce) imha.

### 18.2 Kurulum (staging; root; `/opt/remote` varsayımı)

```bash
apt-get install -y age jq
install -d -m 700 /var/backups/remote
cd /opt/remote/deploy/backup && install -o root -g root -m 600 backup.env.example backup.env   # root + 600 zorunlu (S-P13a-7)
#   backup.env: BACKUP_DIR=/var/backups/remote · BACKUP_AGE_RECIPIENT=age1… (18.1 açık anahtarı) · BACKUP_KEEP_DAYS=14
#               BACKUP_ALERT_CMD= (isteğe bağlı; örnek dosyada) · BACKUP_EXPECTED_TRIGGERS= (boş = 22; P16 öncesi 3 — elle sayı YAZMAYIN, §23.0)
install -m 644 remote-backup.service remote-backup-failed.service remote-backup.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now remote-backup.timer
systemctl list-timers remote-backup.timer          # NEXT = yarın 02:00 (+3) civarı
systemctl start remote-backup.service && journalctl -u remote-backup.service -n 20 --no-pager   # "remote-backup: OK run=…"
ls -l /var/backups/remote/*/                       # P16: 5 dosya (db, uploads, erasure-ledger .age + manifest + .sig), -rw-------
```

Ön koşul: `backup` MySQL kullanıcısı (§18.7/3–4). Yoksa yedek `MYSQL_BACKUP_PASSWORD boş` / `Access denied` ile FAILED olur.
Elle çalıştırma (zamanlayıcıdan bağımsız, aynı birim): `systemctl start remote-backup.service`. Doğrudan betik de olur
(`/opt/remote/deploy/backup/backup.sh`), ama o zaman OnFailure alarmı çalışmaz.

### 18.3 İzleme ve alarm (yedek)

| Kontrol                                                | Komut                                                                                                                                                       | Beklenen                      |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Son çalıştırma                                         | `systemctl status remote-backup.service --no-pager \| head -5`; `journalctl -u remote-backup.service --since -26h \| grep -E 'remote-backup: (OK\|FAILED)'` | son 26 saatte bir `OK`        |
| Hata                                                   | `journalctl -t remote-backup --since -2d \| grep FAILED`                                                                                                    | boş                           |
| Tazelik (timer hiç çalışmadıysa OnFailure da çalışmaz) | `find /var/backups/remote -maxdepth 1 -type d -name '2*Z' -mmin -1560 \| wc -l`                                                                             | ≥ 1 (son 26 sa)               |
| Zamanlayıcı                                            | `systemctl is-enabled remote-backup.timer && systemctl is-active remote-backup.timer`                                                                       | `enabled` `active`            |
| Saklama                                                | `ls /var/backups/remote \| grep -c 'Z$'`                                                                                                                    | 14–15 (ilk 2 haftada daha az) |
| Disk                                                   | `df -h /var/backups/remote`                                                                                                                                 | < %80                         |

Alarm kuralları: journal'da `remote-backup: FAILED` → **Kritik** (aynı gün düzeltilir, §19.10). Tazelik 0 → **Kritik**.
`BACKUP_ALERT_CMD` tanımlıysa FAILED anında çağrılır (ör. WhatsApp servisi, `backup.env.example`). Staging'de Prometheus yok;
tazelik ve §18.6 retention kontrolü elle/cron ile yapılır (prod izleme P13b).

### 18.4 Geri yükleme provası (`scratch`, canlıya dokunmaz) ve RTO ölçümü

Ayda bir ve her anahtar/betik değişikliğinden sonra. İki yol:

- **A (önerilen, anahtar sunucuya hiç gelmez):** yönetici iş istasyonunda (docker + age + jq + repo klonu):

```bash
R=$(ssh root@185.126.217.99 'ls -1 /var/backups/remote | grep Z$ | tail -1')
scp -r root@185.126.217.99:/var/backups/remote/$R ./backup-$R
deploy/backup/restore.sh --identity ~/guvenli/remote-backup-age.key --allowed-signers ~/guvenli/remote-allowed_signers \
  --work-dir ~/guvenli/tmp ./backup-$R      # ilk satır "CHECK OK manifest imzası SHA256:…", son satır restore-verify: OK
# macOS'ta /dev/shm yok → çözülmüş veri için --work-dir zorunlu: FileVault açık diskte, yalnız sizin okuyabildiğiniz dizin
rm -rf ./backup-$R
```

- **B (sunucuda, mimari-p13 §4):** anahtar yalnız RAM'de (`/dev/shm`), iş bitince silinir:

```bash
# iş istasyonundan: anahtarı diske yazmadan RAM'e aktar
ssh root@185.126.217.99 'umask 077; cat > /dev/shm/rb.key' < ~/guvenli/remote-backup-age.key
ssh root@185.126.217.99 'cd /opt/remote/deploy/backup && R=$(ls -1 /var/backups/remote | grep Z$ | tail -1) \
  && ./restore.sh --identity /dev/shm/rb.key /var/backups/remote/$R; rc=$?; shred -u /dev/shm/rb.key; exit $rc'
# --allowed-signers verilmezse /etc/remote-backup/allowed_signers kullanılır (§18.9)
ssh root@185.126.217.99 'ls /dev/shm/rb.key 2>&1'      # "No such file" olmalı
```

Çıktı: `CHECK OK/FAIL` satırları, `restore-sure: toplam Ns (çözme, MySQL açılış, yükleme, doğrulama)` ve `restore-verify: OK`.
**Bilinen döküm sorunu (P11 tetikleyicisi, 2026-11-14 provasında bulundu):** `audit_logs_no_update` gövdesi sonda `;` ile
saklanmış; mysqldump satırı `... 'audit_logs is append-only: UPDATE denied'; */;;` olarak döker ve **düz `mysql` ile geri yükleme
1064 verir** (eski elle alınan `remote-pre-*.sql.gz` dökümleri de dahil). `restore.sh` yüklemeden önce yalnız tetikleyici `CREATE`
satırının sonundaki `; */;;`'yi ` */;;` yapar (`lib.sh fix_trigger_dump`; gövde anlamı aynı). Eski bir dökümü elle yüklerken:
`gzip -dc X.sql.gz | sed -E '/^\/\*!50003 CREATE\*\/ \/\*!50017 DEFINER=/ s/;[[:space:]]*\*\/;;$/ *\/;;/' | mysql …`. **Kalıcı çözüm uygulandı:** P13a migration'ı
(`20261114120000_p13a_retention`, madde 0) tetikleyiciyi BEGIN…END gövdesiyle yeniden kurdu (`docs/db-notlari.md` P13a "Ek"); P13a
sonrası dökümlerde bu satır yoktur ve `fix_trigger_dump` hiçbir şey değiştirmez. Normalleştirme yalnız **P13a öncesi** dökümler
(eski `remote-pre-*.sql.gz` ve P13a yayınından önce alınmış run'lar) için kalır.

**Bütünlük sınırı ve imza (S-P13a-2):** age yalnız gizlilik sağlar; alıcı **açık** anahtarını bilen biri geçerli bir `.age` ve
ona uyan manifest üretebilir. Bugün yedek dizinine yazmak staging root'u gerektirdiği için risk düşük; `restore.sh`'teki istemci
komutu yasağı ve hesap/yetki/rutin karşılaştırması kurcalanmış dökümün en tehlikeli etkilerini yakalar. Döküm denetimi tırnaklı veriyi (kaçış ve `''` dahil, satırlar arası) atlar; mysqldump tırnak dışında ters bölü üretmediği için
bilinen dökümlerde yanlış pozitif yoktur (tırnak içinde `\!`, `\.`, `system` geçen gerçek audit verisiyle denendi). Yorum
satırları da ihtiyatla taranır: elle düzenlenmiş, yorumunda ters bölü olan bir döküm işaretlenebilir (beklenen; elle düzenlenmiş
döküm zaten geri yüklenmemeli). Tablo **içeriği** bugün satır sayısıyla karşılaştırılır; `CHECKSUM TABLE` ile tam içerik
karşılaştırması P13b'dedir. **(P13b'de uygulandı → §18.9: imza, migrator ile yükleme, CHECKSUM.)** Tarihsel not — **Site dışı yedek (P13b)
devreye girmeden önce manifest imzası zorunludur:** `backup.sh` manifesti imzalar (ör. `ssh-keygen -Y sign` veya minisign;
imza anahtarı yalnız yedek sunucusunda, doğrulama açık anahtarı yönetici tarafında), `restore.sh` imzayı doğrulamadan çözmeye
geçmez. Ayrıca yüklemenin root yerine `migrator` ile yapılması dba ile değerlendirilecek. Site dışı eşitlemede `.partial-*` ve
`.lock` hariç tutulur.

**RTO yöntemi:** RTO = karar anı → `/ready` 200. Bileşenler: (a) anahtarın kasadan alınması (elle; kronometre), (b) `restore.sh`
scratch doğrulaması (`restore-sure: toplam`), (c) canlıya uygulama + `/ready` (`--target staging` çıktısındaki
`staging kesintisi`). Prova kaydına a + b + c yazılır; hedef ≤ 60 dk. Döküm satır başına INSERT içerdiğinden yükleme süresi
satır sayısıyla doğrusal büyür (audit_logs 730 g); prova her ay ölçülür, 30 dk'yı geçerse dba ile hızlandırma (paralel yükleme) değerlendirilir.

**Prova kaydı**

| Tarih                                                | Yol                                                                                                  | Yedek (run)                                                                       | scratch süre             | Canlı kesinti                                                                      | RTO (a+b+c)                                       | Sonuç                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Yapan  |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 2026-11-14                                           | yerel (iş istasyonu, Docker Desktop; compose `rsp13ae2e`, test age anahtarı)                         | `20261114T182249Z` (db 10,8 KB, uploads 2 dosya; 19 tablo, tetikleyici 3)         | 8 sn (MySQL açılış 7 sn) | 14 sn (`--target staging`, Linux root konteynerinden; ön yedek dahil toplam 22 sn) | a: ölçülmedi (test anahtarı) · b: 8 sn · c: 14 sn | **OK** — bozulan `users.full_name`, silinen `_prisma_migrations` satırı ve uploads (silinen/eklenen dosya) geri döndü; izinler `1000:1000 700/750/640`; `check-app-grants.sh` 373/373 PASS. Olumsuz: kurcalanmış `.age` → sha256 FAIL (çözülmedi), yanlış anahtar → çözülemedi rc 1, MySQL durdurulmuş → `FAILED adım=mysql-bul` + `--alert` → `BACKUP_ALERT_CMD` çağrıldı, yarım dizin kalmadı; rotasyon: 15 günlük silindi, 14 gün − 10 dk'lık kaldı, 2 günlük `.partial` silindi                                                                                                                   | devops |
| 2026-11-14 (güvenlik düzeltmeleri, S-P13a-2/3/4/6/7) | yerel, **Linux root konteyneri** (docker CLI + bash/age/jq; staging'e en yakın), compose `rsp13ae2e` | `20261114T190007Z` (akış biçiminde yedek; düz dosya yok)                          | 7 sn (`/dev/shm`)        | 13 sn (toplam 20 sn)                                                               | b: 7 sn · c: 13 sn                                | **OK**. Olumsuz testler: `backup.env` 644 → FAILED + alarm komutu çalıştırılmadı; ölü `.partial` başlangıçta silindi; dökümde `system` satırı (açık anahtarla yeniden şifrelenmiş + manifesti güncellenmiş sahte yedek) → `dökümde istemci komutu` FAIL; `CREATE USER bd@%` eklenmiş sahte yedek → `hesap/yetki/rutin` FAIL; yanlış `--confirm`/proje/`production` → hiçbir şeye dokunmadan durdu; tetikleyici düşürülünce `FAILED adım=tetikleyici`, ardından `--target staging` (`--no-pre-backup`) tetikleyiciyi geri getirdi → sonraki yedek OK; MySQL durdurulunca FAILED + alarm komutu çalıştı | devops |
| 2026-11-14 (güvenlik kod turu 2, S-P13a-2 kalanı)    | yerel Linux root konteyneri, compose `rsp13asec` (yalnız mysql + migrate)                            | `20261114T191114Z` (audit'te tırnak içinde `\!`, `\.`, `system` geçen meşru veri) | —                        | —                                                                                  | —                                                 | Geçerli yedek **OK** (yanlış pozitif yok, 15 öğe aynı). Açık anahtarla yeniden şifrelenip manifesti güncellenmiş sahte yedekler: `SELECT 1; \! id`, satır içi `\. /etc/hostname`, `pager …` → istemci komutu FAIL (yüklenmedi); `CREATE USER` → hesap-listesi + mysql.user; `GRANT … ON mysql.*` → mysql.db; dinamik yetki → mysql.global_grants; `ALTER USER … IDENTIFIED BY` → mysql.user; `SET PERSIST` → persisted; `INSTALL COMPONENT` → mysql.component + components; `CREATE PROCEDURE` → routines; hepsi `restore-verify: FAIL`. Busybox/mawk/BSD awk aynı sonucu verdi                       | devops |

### 18.5 Gerçek geri yükleme (`--target staging`; veri bozuldu / felaket)

Kesinti: server + web durur (DB silinip yeniden yüklenir). Önce §18.4 B'deki gibi anahtarı `/dev/shm`'e aktarın.

```bash
cd /opt/remote/deploy/backup && R=<geri dönülecek run, ör. 20261120T230000Z>
./restore.sh --identity /dev/shm/rb.key --target staging --confirm remote@develop /var/backups/remote/$R; rc=$?
shred -u /dev/shm/rb.key; echo rc=$rc
```

**Ortam kilidi (S-P13a-6 + P13b):** `--confirm <veritabanı>@<hostname -s>` — staging'de **`remote@develop`**; compose projesi
`remote` olmalı (başka adlıysa `RESTORE_EXPECT_PROJECT`); `deploy/.env` `DEPLOY_ENV` = `--target` = manifest `env`. Eşleşmezse
hiçbir şeye dokunmadan durur. Prod hedefi: §18.9/6. **P13b'den beri sıra değişti (§18.9/5):** DB root ile değil migrator ile
boşaltılır ve yüklenir, CHECKSUM canlı = scratch, ardından audit taban çizgisi sıfırlanır.
Betik sırası: scratch doğrulaması (FAIL → canlıya **dokunmaz**) → güncel durumun yedeği (`backup.sh`; DB tamamen bozuksa ve
yedek alınamıyorsa bilinçli olarak `--no-pre-backup`) → `docker compose stop web server` → DB root ile `DROP`/`CREATE` (mevcut
karakter seti korunur) + döküm → `uploads` volume'u boşaltılıp arşiv açılır (sahiplik/izin korunur) → aynı doğrulama canlıda →
`docker compose up -d` (migrate önce; yedek eski migration'daysa yenileri uygulanır) → server healthy → `/ready` 200 → `restore-verify: OK`.
Kullanıcılar/yetkiler `mysql` şemasındadır, DB silinince kaybolmaz; yine de sonra §15.1/5 `check-app-grants.sh` → **373/373 PASS**.
Canlı doğrulama FAIL olursa server **durdurulmuş bırakılır** (bozuk veriyle açılmaz): başka bir run ile tekrar deneyin veya §19.7.
Geri dönüş (yanlış run seçildiyse): ön yedek (`/var/backups/remote/<en yeni>`) ile aynı komut.

### 18.6 Saklama işi metrikleri ve alarmları (AC-199; adlar mimari-p13 §2, `apps/server/src/jobs/retention.ts`)

İş her gün 03:30 Europe/Istanbul server süreci içinde çalışır (ayrı zamanlayıcı yok). Metrikler (`/metrics`, Bearer `METRICS_TOKEN`):
`rs_retention_last_success_timestamp_seconds` (gauge; 0 = süreç açıldığından beri başarılı tur yok),
`rs_retention_rows_total{kind}` (sessions, consents, files, requests, customers, bindings, audit, auth_sessions, reset_tokens),
`rs_retention_failures_total`.

| Kural (PromQL)                                                                                          | Seviye    | Anlamı / ilk adım                                                            |
| ------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------- |
| `time() - rs_retention_last_success_timestamp_seconds > 26*3600 and (time() - process_start) > 26*3600` | **Uyarı** | 26 saattir başarılı tur yok (süreç 26 saatten uzun ayakta). §19.8            |
| `increase(rs_retention_failures_total[1d]) > 0`                                                         | **Uyarı** | En az bir firma/global adım hata verdi (fail-soft: diğerleri işlendi). §19.8 |
| `increase(rs_retention_rows_total{kind="audit"}[1d]) > 100000`                                          | Bilgi     | Olağan dışı büyük audit silmesi (ilk tur/uzun kesinti sonrası beklenir)      |

Server'da süreç başlangıç metriği yok; süreç yaşı konteynerden alınır. Staging'de (Prometheus yok) aynı kural, sunucuda elle/cron:

```bash
cd /opt/remote/deploy && last=$(docker compose exec -T server node -e "fetch('http://127.0.0.1:3001/metrics',{headers:{authorization:'Bearer '+process.env.METRICS_TOKEN}}).then(r=>r.text()).then(t=>{const m=t.match(/^rs_retention_last_success_timestamp_seconds (\S+)/m);const f=t.match(/^rs_retention_failures_total (\S+)/m);console.log((m?m[1]:'yok')+' '+(f?f[1]:'0'))})")
started=$(date -d "$(docker inspect -f '{{.State.StartedAt}}' "$(docker compose ps -q server)")" +%s); now=$(date +%s)
set -- $last; echo "son_basari=$1 hata=$2 surec_yasi=$(( (now-started)/3600 ))sa"
[ "$1" != yok ] && { [ $((now-started)) -lt 93600 ] || [ $((now-${1%.*})) -lt 93600 ]; } && [ "${2%.*}" = 0 ] && echo retention-ok || echo RETENTION-ALARM
```

`yok` → metrik kaydı yok (server P13a öncesi imaj veya `METRICS_TOKEN` boş). Audit karşılığı: Audit ekranında "Saklama süresi işi"
(`retention.run`) kayıtları; SQL: `SELECT created_at, tenant_id, new_value FROM audit_logs WHERE action='retention.run' ORDER BY id DESC LIMIT 10`.

### 18.7 P13a yayın sırası (staging, §8 akışı; prod'da aynı — P13b)

Kesinti: mysql yeniden oluşturulurken 10–30 sn (3. adım) + server/web yeniden yaratılırken birkaç sn. Düşük trafik saatinde.

1. **Yedek (eski yöntem, son kez; ayrı ssh):** §15.1/1 komutu (dosya `remote-pre-p13a-…`) + §16.3 uploads komutu.
2. **Repo güncelle** (§8 bundle + pull, yeni ssh çağrısı, `umask` yok) ve `.env` yedeği: `cp -p deploy/.env /root/.env.bak.p13a.$(date -u +%Y%m%dT%H%M%SZ)`.
3. **mysql env:** `.env`'e yedek kullanıcısı parolası (ekrana yazılmadan; harf/rakam, ≥ 16):
   `grep -q '^MYSQL_BACKUP_PASSWORD=.' .env || { sed -i '/^MYSQL_BACKUP_PASSWORD=/d' .env; echo "MYSQL_BACKUP_PASSWORD=$(openssl rand -hex 24)" >> .env; }`
   → `docker compose up -d mysql` (env değişti → konteyner yeniden oluşur, **volume korunur**; `down -v` YAPMAYIN) → `docker compose ps mysql` healthy.
   Kontrol: `docker compose exec -T mysql sh -c 'echo ${#MYSQL_BACKUP_PASSWORD}'` → `48`.
4. **backup kullanıcısı** (mevcut kurulum; komut `deploy/mysql/backup-user.sql` başlığında, parola argümana düşmez):

```bash
docker compose exec -T mysql sh -c 'h() { printf %s "$1" | od -An -tx1 | tr -d " \n"; }; { echo "SET @backup_pw = CONVERT(0x$(h "$MYSQL_BACKUP_PASSWORD") USING utf8mb4), @db = CONVERT(0x$(h "$MYSQL_DATABASE") USING utf8mb4);"; cat; } | MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N' < mysql/backup-user.sql
```

Beklenen: `backup-user: OK` + `GRANT SELECT, SHOW VIEW, TRIGGER ON \`remote\`.* TO \`backup\`@\`localhost\``.
5. **Build + migrate + grants:** `docker compose build && docker compose up -d`→`docker compose logs --since 5m migrate`   ("All migrations have been successfully applied";`20261114120000_p13a_retention`). Guard 3819 (P3018) ile durursa
   `docs/db-notlari.md`P13a "Up guard" kurtarması. Ardından`docker compose --profile setup run --rm seed`(zararsız).
6. **Yetki sınırı:**`set -a; . ./.env; set +a; APP_PW=$MYSQL_APP_PASSWORD BACKUP_PW=$MYSQL_BACKUP_PASSWORD CONTAINER=$(docker compose ps -q mysql) DB=$MYSQL_DATABASE bash mysql/check-app-grants.sh | tail -3`   → **373/373 PASS**,`grep -c FAIL`= 0 (tetikleyici 3, backup hesabı dahil).
7. **AC-88 kaydı:** staging'de yığın zaten kurulu olduğundan temiz kurulum ölçümü burada yapılmaz; §2 "Temiz kurulum kaydı"
   yöntemi ayrı temiz VM/dind'de (veya staging'de geçici compose projesi`-p remote-ac88`, farklı port ve volume'larla, ölçüm
   sonrası `down -v`) uygulanır ve tabloya yazılır.
8. **Yedek kurulumu + ilk yedek + prova:** §18.2 (kullanıcıdan alınan **açık** anahtarla) → `restore-verify: OK`(§18.4 A veya B) →
   §18.4 prova kaydı (RTO).
9. **Hata testi (AC-200):**`docker compose stop mysql; systemctl start remote-backup.service; systemctl is-failed remote-backup.service; journalctl -t remote-backup -n 5 --no-pager; docker compose start mysql`   →`failed`; journal'da `remote-backup: FAILED adım=mysql-bul …`ve`remote-backup: FAILED host=…`(OnFailure). Sonra
  `systemctl reset-failed remote-backup.service`ve`docker compose ps`(server tekrar healthy; ~30 sn kesinti).
10. **Saklama duman testi:** §18.6 komutu (ilk tur ertesi 03:30'da; öncesinde`son_basari=0`+ süreç yaşı < 26 sa →`retention-ok`).
    Ertesi gün: `retention.run`audit kaydı +`son_basari` > 0. 11. §8 yayın geçmişine satır (yedek yolu, grants 373, ilk run adı, prova süresi).

### 18.8 Geri alma (P13a)

Tercih: **ileri düzeltme > yalnız imaj > imaj + `down.sql`**. Yedek altyapısı bağımsızdır; geri alınması gerekmez.

1. **Önceki imaj:** `.env` `IMAGE_TAG=b7b4891` (P12b) → `docker compose up -d`. P12b kodu P13a şemasıyla çalışır: yeni sütun/CHECK
   okunmaz, `app`'in ek DELETE yetkileri kullanılmaz; `created_at` tetikleyicisi zararsız (DB saati yazar). Saklama işi durur
   (P12b'deki talep/müşteri/kayıt adımları devam eder).
2. **`down.sql`** (yalnız şema sorunluysa; önce 1. adım ve 18.7/1 yedeği):

```bash
docker compose run --rm migrate pnpm --filter @remote/server exec prisma db execute \
  --file prisma/migrations/20261114120000_p13a_retention/down.sql
```

Anonimleştirilmiş oturum varsa `p13a_down_guard_chk` (3819) ile **hiçbir şey değişmeden** durur — bu satırlar geri
döndürülemez (kişisel veri silinmiştir); down yerine 1. adımda kalın. Başarılıysa `check-app-grants.sh` → P13a satırları
FAIL (beklenen), P12b ve öncesi 337 PASS. Prova: dba 2026-11-14 (`docs/db-notlari.md` P13a "down"). 3. **Yedek işi** (gerekirse): `systemctl disable --now remote-backup.timer`; `backup` kullanıcısı zararsızdır, kaldırmak için
root ile `DROP USER 'backup'@'localhost'` (yedek alınamaz hale gelir). 4. Yeniden ileri: yeni `IMAGE_TAG` → `docker compose up -d` (migration yeniden uygulanır).

### 18.9 P13b — imza, ortam kilidi, audit süreklilik, site dışı kanca, `status.prom` (devops, 2026-11-15; ADR-0020)

Tasarım: `docs/mimari-p13.md` §7.6; SQL arayüzü `deploy/mysql/{restore-sec-snapshot,restore-reset-db,checksum-tables,audit-continuity,audit-baseline-reset}.sql`
(`docs/db-notlari.md` "P13b"). Değişiklik özeti:

| Konu               | P13b davranışı                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest           | `format: 2`; yeni alanlar `env` (`deploy/.env` `DEPLOY_ENV`), `host` (`hostname -s`), `signer` (imza anahtarı SHA256), `seq` (monoton sıra) + `prevRun`, `audit` (audit-continuity.sql çıktısı), `auditContinuity {result, detail, comparedWith}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| İmza               | `ssh-keygen -Y sign -n remote-backup` → `manifest.json.sig` (600). Anahtar `/etc/remote-backup/manifest_ed25519` (root 600; değilse `FAILED adım=imza`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Doğrulama          | `restore.sh` **ilk iş** imzayı `--allowed-signers` ile doğrular (`-Overify-time=<createdUtc>`; OpenSSH ≥ 8.9). Geçmezse sha256/çözme/yükleme yok: `restore-verify: FAIL (imza)`. Atlama seçeneği **yok**. P13a (imzasız, format 1) yedekler yeni betikle açılmaz (14 günde rotasyonla düşer; zorunlu olursa `git show a0265be:deploy/backup/restore.sh`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Tazelik (G-P13b-8) | Dizin adı run biçimindeyse `= manifest.run` (eski yedeğin yeni ada kopyası reddedilir); yaş + sıra yazılır; aynı dizinde daha yeni yedek varsa `UYARI`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Ortam kilidi       | `--target staging\|production` → `deploy/.env DEPLOY_ENV` = hedef = manifest `env`, `--confirm <db>@<hostname -s>`, root, compose projesi `remote`. production ek: manifest `host` = bu sunucu, TTY'de `PRODUCTION-<host>`; yedek > 48 sa ya da daha yenisi varsa ayrıca `ESKI-<run>`. Hepsi **çözmeden önce**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Yükleme            | scratch'te `deploy/mysql/init` (app + migrator) → **migrator** ile `--system-command=OFF --local-infile=0`; root yalnız salt okunur `restore-sec-snapshot.sql` (yüklemeden önce `anon=0`, `migratorExtra=0` şart; önce = sonra)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Canlı sıra         | scratch OK → ön yedek → `stop web server` → anlık görüntü → `restore-reset-db.sql` (migrator, DROP/CREATE) → migrator ile yükleme → anlık görüntü eşit → uploads → `CHECKSUM` canlı = scratch (farkta yalnız tablo adı) → satır/tetikleyici = manifest → `backup.sh --reset-audit-baseline "restore <run> sonrasi …"` (SQL + host işareti) → `up -d` → `/ready` 200                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Audit süreklilik   | Önceki imzası geçerli ve sonucu FAILED olmayan manifestle karşılaştırılır: `ilk` (önceki yok / format ≠ 2 / instanceId, env, host, DB farklı), `ok`, `taban-cizgisi-sifirlandi` (önceki ölçümden **sonra** yazılmış sıfırlama kaydı **ve** onunla aynı id'li host işareti `$BACKUP_DIR/audit-baseline-reset.json` (root 600); işaret imzalı manifeste `auditContinuity.baselineMarker` olarak girer ve silinir; uyarı + alarm, rc 0), `FAILED taban-cizgisi-isaretsiz` (DB'de sıfırlama satırı var ama işaret yok / id farklı / izin yanlış — ör. elle SQL ya da app ile yazılmış), `FAILED …` (maxId azaldı, geçmiş bir günün `{n,h}`'si değişti, `prevTail` ≠ önceki `tail`, özet kesildi, sıfırlama kaydı kayboldu — ör. TRUNCATE). FAILED'da yedek **yine yayımlanır ve imzalanır** (kanıt) ama rc 1 → alarm; taban çizgisi sıfırlanana kadar her gün tekrar eder. `triggers.ok=false` → `FAILED adım=tetikleyici` (yedek yok) |
| Kanca              | `BACKUP_OFFSITE_CMD` tanımsız → `OFFSITE-UNCONFIGURED (uyarı)`. Tanımlıysa `remote-offsite` kullanıcısı olarak (`setpriv`, `env -i`, cwd `/`), yalnız o çalıştırmanın dizinini okuyarak, süre `min(BACKUP_OFFSITE_TIMEOUT_SEC, birim bütçesi − 10 dk)`; `OFFSITE OK run=… sure=…s` / `OFFSITE-FAILED run=… rc=<n>` + `BACKUP_ALERT_CMD`; **birim yine başarılı**. Komut metni loga yazılmaz; metinde sır (Telegram bot token'ı, `x-api-key:`, `Authorization: Bearer`) varsa çalıştırılmaz (rc 126)                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Durum              | `/var/lib/remote-backup/status.prom` (644, atomik, sır yok), her çıkışta: `remote_backup_last_success_timestamp_seconds`, `remote_backup_last_run_ok`, `remote_backup_offsite_configured`, `remote_backup_offsite_last_success_timestamp_seconds`, `remote_backup_offsite_last_rc`, `remote_backup_audit_continuity_ok`. `remote-watch` (§20.4) okur                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Birim              | `TimeoutStartSec=2h` (backup.env `BACKUP_UNIT_TIMEOUT_SEC` ile aynı, sn)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

**1. Kurulum / yükseltme (root; staging P13b yayını ve prod terfisi aynı)**

```bash
apt-get install -y age jq openssh-client util-linux      # ssh -V → OpenSSH_9.6 (≥ 8.9); setpriv util-linux içinde
ssh -V 2>&1 | head -1                                    # "OpenSSH_9.6p1 Ubuntu…"
cd /opt/remote/deploy
grep -q '^DEPLOY_ENV=' .env || echo 'DEPLOY_ENV=staging' >> .env     # prod terfisinde: production (§20.2/5)
grep '^DEPLOY_ENV=' .env                                 # DEPLOY_ENV=staging
# İmza anahtarı (sunucuda üretilir, sunucudan çıkmaz; parolasız çünkü systemd çalıştırır)
install -d -m 755 /etc/remote-backup
ssh-keygen -q -t ed25519 -N '' -C "remote-backup@$(hostname -s)" -f /etc/remote-backup/manifest_ed25519
chmod 600 /etc/remote-backup/manifest_ed25519 && stat -c '%U %a' /etc/remote-backup/manifest_ed25519   # root 600
printf 'remote-backup@%s namespaces="remote-backup" %s\n' "$(hostname -s)" "$(cut -d' ' -f1,2 /etc/remote-backup/manifest_ed25519.pub)" \
  > /etc/remote-backup/allowed_signers && chmod 644 /etc/remote-backup/allowed_signers
cat /etc/remote-backup/allowed_signers   # tek satır: remote-backup@develop namespaces="remote-backup" ssh-ed25519 AAAA…
```

`allowed_signers` satırı **açık** anahtardır (sır değil); parola kasasına "Remote — yedek imza doğrulama (allowed_signers, <ortam>)"
olarak konur ve iş istasyonundaki provada (§18.4 A) `--allowed-signers` ile verilir. Özel anahtar sunucudan çıkmaz, kasaya da konmaz
(kaybolursa yeni çift üretilir, aşağıdaki rotasyon).

```bash
# Site dışı kanca kullanıcısı (kanca tanımlı olmasa da önceden kurulur)
id remote-offsite 2>/dev/null || useradd --system --home-dir /var/lib/remote-offsite --create-home --shell /usr/sbin/nologin remote-offsite
id remote-offsite                       # uid=9xx(remote-offsite) gid=9xx(remote-offsite) — uid/gid ≠ 0
stat -c '%a %U' /var/backups            # 755 root  (kanca kullanıcısı geçebilmeli; değilse OFFSITE-FAILED rc=126)
# Birimler (TimeoutStartSec=2h)
cd /opt/remote/deploy/backup && install -m 644 remote-backup.service remote-backup-failed.service remote-backup.timer /etc/systemd/system/
systemctl daemon-reload && systemctl show -p TimeoutStartUSec remote-backup.service    # TimeoutStartUSec=2h
# backup.env: yeni anahtarlar isteğe bağlı (boş = varsayılan): BACKUP_SIGNING_KEY, BACKUP_OFFSITE_CMD, BACKUP_OFFSITE_USER,
# BACKUP_OFFSITE_TIMEOUT_SEC (1800), BACKUP_UNIT_TIMEOUT_SEC (7200), BACKUP_STATUS_FILE. Açıklamalar backup.env.example'da.
stat -c '%U %a' backup.env              # root 600
```

**2. İlk imzalı yedek ve kontrol**

```bash
systemctl start remote-backup.service
journalctl -u remote-backup.service -n 30 --no-pager | grep -E 'audit-sureklilik|OFFSITE|remote-backup: (OK|FAILED)'
#   … audit-sureklilik: ilk            (P13a manifestleri imzasız/format 1 → "ilk"; beklenen)
#   … OFFSITE-UNCONFIGURED (uyarı: site dışı kopya yok)
#   … remote-backup: OK run=<run> …
R=$(ls -1 /var/backups/remote | grep 'Z$' | tail -1); ls -l /var/backups/remote/$R     # 4 dosya, hepsi -rw------- (… manifest.json.sig)
jq '{run, seq, env, host, signer, auditContinuity}' /var/backups/remote/$R/manifest.json
ssh-keygen -Y verify -f /etc/remote-backup/allowed_signers -I "remote-backup@$(hostname -s)" -n remote-backup \
  -s /var/backups/remote/$R/manifest.json.sig < /var/backups/remote/$R/manifest.json
#   Good "remote-backup" signature for remote-backup@develop with ED25519 key SHA256:…
grep -v '^#' /var/lib/remote-backup/status.prom
#   remote_backup_last_run_ok 1 · remote_backup_offsite_configured 0 · remote_backup_audit_continuity_ok 1 · last_success = şimdi
```

Ertesi yedekte `audit-sureklilik: ok (karşılaştırılan: <önceki run>)` beklenir.

**3. Prova (imzalı) ve olumsuz test** — §18.4 A/B, `--allowed-signers` ile → `restore-verify: OK`. Olumsuz (iş istasyonunda):

```bash
cp -r ./backup-$R ./neg && printf ' ' >> ./neg/manifest.json
deploy/backup/restore.sh --identity ~/guvenli/remote-backup-age.key --allowed-signers ~/guvenli/remote-allowed_signers --work-dir ~/guvenli/tmp ./neg
#   … manifest imzası doğrulanamadı … — çözme ve yükleme YAPILMADI
#   restore-verify: FAIL (imza)        (rc 1; "sha256" ya da "düz" satırı YOK)
rm -rf ./neg
```

**4. Site dışı kanca (hedef belli olunca; ADR-0020 m.4)** — hedef şartları: kimlik yalnız yazabilir, üzerine yazma ve yeniden
adlandırma yok, saklama 14 + 1 gün, yurt içi tercih. Hedef kimliği **`remote-offsite` kullanıcısının** 600 dosyasında
(ör. `/var/lib/remote-offsite/.config/rclone/rclone.conf`, sahibi remote-offsite) durur; `BACKUP_OFFSITE_CMD` metninde sır olmaz.
Kanca yalnız `PATH`, `HOME` ve `REMOTE_BACKUP_RUN_DIR`, `REMOTE_BACKUP_RUN`, `REMOTE_BACKUP_DIR`, `REMOTE_BACKUP_HOST`,
`REMOTE_BACKUP_ENV` değişkenlerini görür; imza anahtarı, `deploy/.env`, `backup.env` ve diğer çalıştırmalar ona kapalıdır.
Örnek (backup.env): `BACKUP_OFFSITE_CMD=rclone copy --immutable "$REMOTE_BACKUP_RUN_DIR" "offsite:remote-backup/$REMOTE_BACKUP_ENV/$REMOTE_BACKUP_RUN"`.

```bash
# Elle deneme (kancanın kullanıcısıyla; komut çalışır mı)
sudo -u remote-offsite -H rclone lsd offsite:          # hedef listelenir (yetki yalnız yazma ise "permission denied" de kabul)
systemctl start remote-backup.service; journalctl -u remote-backup.service -n 20 --no-pager | grep OFFSITE
#   remote-backup: OFFSITE OK run=<run> sure=<n>s
grep -E '^remote_backup_offsite_(configured|last_rc)' /var/lib/remote-backup/status.prom    # configured 1, last_rc 0
# Alarm yolu testi (gerçek hedefe dokunmaz; bir yedek daha üretir):
BACKUP_OFFSITE_CMD='exit 3' /opt/remote/deploy/backup/backup.sh 2>&1 | grep -E 'OFFSITE|remote-backup: OK'
#   remote-backup: OFFSITE-FAILED run=<run> rc=3 … + BACKUP_ALERT_CMD mesajı geldi; ardından "remote-backup: OK" (rc 0)
```

**5. Audit taban çizgisini sıfırlama** (yalnız: incelenip meşru bulunan bir `audit-sureklilik` FAILED'ından sonra; geri
yüklemeden sonra `restore.sh` kendisi yapar). **Tek yol `backup.sh --reset-audit-baseline`** (S-P13b-1): komut
`audit-baseline-reset.sql`'i migrator ile çalıştırır ve dönen id ile host işareti `$BACKUP_DIR/audit-baseline-reset.json`
(root 600) yazar. **`audit-baseline-reset.sql`'i elle çalıştırmak artık yetmez:** işaretsiz sıfırlama satırı bir sonraki yedeği
`FAILED taban-cizgisi-isaretsiz` yapar. Gerekçe 10–200 karakter, kişisel veri/sır yok, `'` ve `\` yok:

```bash
sudo /opt/remote/deploy/backup/backup.sh --reset-audit-baseline "<olay no / kısa gerekçe>"
#   audit-baseline-reset: OK id=<n> isaret=/var/backups/remote/audit-baseline-reset.json     (guard ihlali → 3819, hiçbir şey yazılmaz)
stat -c '%U %a' /var/backups/remote/audit-baseline-reset.json                                 # root 600
systemctl start remote-backup.service; journalctl -u remote-backup.service -n 20 --no-pager | grep audit-sureklilik
#   audit-sureklilik: taban-cizgisi-sifirlandi id=<n> zaman=… (uyarı) + BACKUP_ALERT_CMD uyarısı; rc 0. İşaret dosyası silinir
#   (manifestte auditContinuity.baselineMarker). Sonraki yedek: ok
```

Sıfırlama Audit ekranında "Yedek audit taban çizgisi sıfırlandı" olarak görünür; gizli sıfırlama yoktur.

**6. Prod hedefi (`--target production`)** — yalnız prod sunucusunda, **etkileşimli** ssh oturumunda (`ssh -t`), root:

```bash
cd /opt/remote/deploy/backup && R=<run>
./restore.sh --identity /dev/shm/rb.key --target production --confirm remote@$(hostname -s) /var/backups/remote/$R; rc=$?
shred -u /dev/shm/rb.key; echo rc=$rc
#   PRODUCTION geri yüklemesi: remote@develop, yedek <run> (yaş N sa). Onay için PRODUCTION-develop yazın: PRODUCTION-develop
#   (yaş > 48 sa ya da daha yeni yedek varsa) … Bilerek yüklemek için ESKI-<run> yazın: ESKI-<run>
#   … restore-reset: OK remote utf8mb4 utf8mb4_unicode_ci · CHECK OK CHECKSUM canlı = scratch 19 tablo eşit ·
#   audit-baseline-reset: OK id=<n> · CHECK OK /ready 200 · restore-sure: production kesintisi Ns · restore-verify: OK
```

Ret durumları (hepsi çözmeden önce, `restore-verify: FAIL (ret)`): `DEPLOY_ENV` ≠ production, yedek `env=staging`, yedek başka
host'tan, `--confirm` yanlış, TTY yok (`ssh` `-t`'siz / cron), onay metni yanlış.

**7. İmza anahtarı rotasyonu / sızıntı (S-P13b-5)** — doğrulama `-Overify-time=<manifest.createdUtc>` ile yapılır, yani
anahtarın geçerliliği manifestin **imzalı** oluşturulma anına göre değerlendirilir. İki durum farklıdır:

- **Planlı rotasyon:** yeni çift üretilir (1. adımdaki komut; eski dosya önce `manifest_ed25519.old`'a taşınır), `allowed_signers`'a
  yeni satır eklenir, eski satırın başına `valid-before="<rotasyon anı, YYYYMMDDHHMMSS>Z"` yazılır → rotasyondan önce imzalanmış
  14 günlük yedekler doğrulanmaya devam eder. Eski satır 15 gün sonra silinir; eski özel anahtar `shred -u`.
- **Sızıntı / sızma şüphesi:** sızan anahtarla geriye tarihli `createdUtc` yazılarak imzalanmış sahte bir manifest
  `valid-before` sınırını geçebilir. Bu yüzden eski satır sunucudaki ve kasadaki çalışma kopyasından **kaldırılır** (yalnız
  `valid-before` koymak yetmez). Sızma öncesi bir yedek gerekirse yalnız kasadaki **ayrı, eski** `allowed_signers` kopyasıyla,
  manifestin `createdUtc`/`seq` değerleri sızma anından önceki kesin güvenli pencereyle elle karşılaştırılarak yüklenir; production'da
  48 saatten eski yedek için istenen `ESKI-<run>` onayı ikinci engeldir. Ardından yeni çift + yedek + prova; olay kaydı.
  Her iki durumda kasadaki `allowed_signers` kopyası aynı gün güncellenir.

**8. Yedek testi (yerel; betik/SQL değişikliğinden sonra zorunlu):** iş istasyonunda repo kökünde, Docker çalışırken
`deploy/backup/test-backup.sh` (yardımcı alpine konteyner + docker.sock, dind yok; benzersiz compose projesi `rstb…`, ~2,5 dk;
çıkışta compose `down -v`, yardımcı ve volume'lar silinir) → son satır **`SONUÇ: GEÇTİ (55 PASS)`**. Kalıntı kontrolü:
`docker ps -a --format '{{.Names}}' | grep -c rstb` → 0. İlgili diğer testler: `deploy/ops/test-proxy-guard.sh` (34 PASS),
`deploy/ops/test-watch.sh` (49 PASS). Sunucuda çalıştırılmaz.

**Önceki test kaydı (yerel, 2026-11-15, T1):** 49/49 PASS (`docs/implementation.md` "P13b — devops T1"): meşru yedek → imza → scratch
`restore-verify: OK` (7 sn) ve canlı taklidi (kesinti 7 sn, CHECKSUM 19 tablo); imzasız / değiştirilmiş / bozuk / yabancı
imza → `FAIL (imza)` (çözme yok); replay; yanlış `DEPLOY_ENV`, `env=staging` → production, TTY yok → ret; tek DELETE, TRUNCATE →
`FAILED adım=audit-sureklilik`; tetikleyici DROP → `FAILED adım=tetikleyici`; kanca `exit 7` → `OFFSITE-FAILED` + alarm, birim OK.
Sunucuda prova kaydı §18.4 tablosuna eklenir.

## 19. Senaryo dizini (AC-92 + P13a + P13b)

Her senaryo: **belirti → komut → doğrulama → geri dönüş**. Komutlar `/opt/remote/deploy` içinde, root. Ayrıntı bağlantılı bölümde.

### 19.1 Servis düştü (site açılmıyor / 502 / agent-watch "sunucu erişilemez")

- **Belirti:** tarayıcıda 502/504 veya bağlantı yok; `docker compose ps`'te `unhealthy`/`exited`.
- **Komut:** `docker compose ps` → hangi servis? `docker compose logs --since 15m <servis> | tail -100`.
  server: `/ready` (§5) 503 → DB (`docker compose ps mysql`, `logs mysql`); migrate `exited (1)` → §6/§7. Caddy/nginx: §7 ve §8.3 satırları.
  Disk: `df -h / /var/lib/docker` (§19.9). Yeniden başlatma: `docker compose up -d` (değişmeyen servise dokunmaz) veya `docker compose restart server`.
- **Doğrulama:** `docker compose ps` hepsi healthy; §5 `/ready` → 200; dışarıdan `/login` 200.
- **Geri dönüş:** yayın sonrası düştüyse önceki `IMAGE_TAG` (§8 rollback; önce `grep -q '^UNATTENDED_MODE=unsigned-accepted' .env && echo DUR` — `DUR` ise önce `UNATTENDED_MODE=off`, §27.9); şema değiştiyse ilgili paketin geri alma bölümü (§18.8 vb.).

### 19.2 TURN çalışmıyor (bağlantı kuruluyor, görüntü gelmiyor / yalnız aynı ağda çalışıyor)

- **Belirti:** konsolda ICE başarısız; `turn_allocations` 0; coturn `unhealthy`.
- **Komut:** `cd turn && docker compose ps && docker compose logs --since 30m coturn | tail -50`; tablo §9.8 (secret uyumsuzluğu
  `message integrity`, `TURN_EXTERNAL_IP`, UFW/NAT 3478/5349/49160-49199, sertifika). `systemctl is-active remote-turn-fw.timer`.
- **Doğrulama:** §2 temiz kurulum kaydındaki `turnutils_uclient` HMAC denemesi → allocation OK; tam test `test-denied.sh` (§9.7, test oturumu yokken).
- **Geri dönüş:** yapılandırma değiştiyse `deploy/turn/.env`/local dosyanın önceki hali → `docker compose up -d --force-recreate coturn`; secret rotasyonu yarım kaldıysa §9.6.

### 19.3 Sertifika süresi doldu

- **Belirti:** tarayıcı `NET::ERR_CERT_DATE_INVALID` (alan adı) veya istemci TLS hatası; TURN-TLS 5349 bağlanmıyor.
- **Komut:** alan adı (Let's Encrypt, host nginx): `certbot certificates --cert-name remote.noktabilisim.net` →
  `certbot renew --cert-name remote.noktabilisim.net && nginx -t && systemctl reload nginx` (§7 satırı, §8.3).
  TURN-TLS: `openssl x509 -in turn/certs/turn.crt -noout -enddate` → `cd turn && ./gen-cert.sh 185.126.217.99 && docker compose restart coturn` (§9.4).
  IP:4450 (`tls internal`): Caddy kendisi yeniler; kök CA değiştiyse test makinelerine yeniden kurulur (§8).
- **Doğrulama:** `echo | openssl s_client -connect remote.noktabilisim.net:443 -servername remote.noktabilisim.net 2>/dev/null | openssl x509 -noout -enddate`; TURN için `turnutils_uclient -S -p 5349` (§9.7).
- **Geri dönüş:** yenileme bozduysa nginx önceki vhost (`/root/remote.conf.prev`), coturn için önceki `certs/` yedeği; alarm eşiği < 14 gün.

### 19.4 İstemci sürüm yayını, köken doğrulama (attestation) ve indirme bütünlük alarmı

- **Belirti (alarm):** agent-watch issue, server logunda `alarm:"agent_binary"` (`mismatch`/`missing`/`unconfigured`), indirme 503.
- **Komut:** yayın §11.3 (`verify-and-publish.sh --tag vX.Y.Z`; attestation + SHA256SUMS); alarmda §11.7 (volume'a dokunmadan
  hash al, `PUBLISHED.log` + SSH logları, son Release'i yeniden yayınla; ele geçirme şüphesinde `AGENT_SHA256=` boş → 503).
- **Doğrulama:** `docker compose exec server sha256sum /data/downloads/NoktaDestek.exe` = Release `SHA256SUMS`; agent-watch elle tetiklenip yeşil.
- **Geri dönüş:** önceki sürümü aynı doğrulamayla yeniden yayınla (§11.4).

### 19.5 TURN IP değişimi (denied-peer-ip güncelleme)

- **Belirti:** sunucu/NAT IP'si değişti; relay adayı yanlış adres, `test-denied.sh` FAIL.
- **Komut:** `deploy/turn/.env` `TURN_EXTERNAL_IP`, `TURN_REALM`; `denied-peer-ip.local.conf` (yeni sağlayıcı bloğu + yeni kendi IP; §9.5);
  `./gen-cert.sh <yeni-ip>` (§9.4); `host-firewall.sh apply` (§9.2.1); `docker compose up -d --force-recreate coturn`;
  uygulama tarafı `deploy/.env` `TURN_URLS` → `docker compose up -d server`; NAT kuralları (§8.2).
- **Doğrulama:** `test-denied.sh` 0 FAIL (her satırın ilk/son adresi 403, kontrol peer'ı izinli); konsolda relay adayı yeni IP.
- **Geri dönüş:** önceki `.env`/local conf/certs yedeği → `--force-recreate coturn`; `TURN_URLS` eski değer → `up -d server`.

### 19.6 Kötüye kullanım bildirimi (`ABUSE_EMAIL`'e gelen şikâyet, dış kurum talebi)

- **Belirti:** misafir "Kötüye kullanımı bildir" e-postası veya resmi yazı: yetkisiz uzaktan erişim / dolandırıcılık iddiası.
- **Komut:** (1) Bildirimdeki zaman, oturum kodu/ticket no, firma adıyla oturumu bulun: Super Admin → Oturum geçmişi/Audit ekranı
  veya `SELECT id, tenant_id, ticket_no, status, created_by, created_at FROM support_sessions WHERE ticket_no = '<no>'` (root, salt okuma).
  (2) Süren oturum: Oturumlar → "Zorla sonlandır" (AC-114). (3) Teknisyen: Kullanıcılar → pasife al (soket ≤ 60 sn kapanır);
  firma çapında ise Super Admin → firma pasife al (§14.2). Kayıtlı bilgisayar/firma dosyası sızdıysa §13.4.
  (4) **Kanıt koruma:** ilgili audit kayıtları 730 gün, coturn logu yalnız **7 gün** tutulur (§9.8.1) → hemen dışa alın:
  `docker compose -f turn/docker-compose.yml logs --since 72h coturn | age -r <BACKUP_AGE_RECIPIENT> > /root/olay-<tarih>-coturn.log.age` ve
  audit sorgusunun çıktısı aynı şekilde şifreli. (5) Bildirene yanıt + yönetime/KVKK sorumlusuna bilgi (72 saat içinde değerlendirme).
- **Doğrulama:** oturum ENDED, kullanıcı/firma pasif, audit'te `session.terminate`/`user.update` kayıtları; kanıt dosyaları 600.
- **Geri dönüş:** iddia asılsızsa kullanıcı/firma yeniden etkinleştirilir (audit'e yazılır); kanıt dosyaları olay kapanınca imha edilir.

### 19.7 Veri bozuldu (yanlış toplu işlem, bozuk tablo, yanlış migration) — yedekten dön

- **Belirti:** yanlış/eksik kayıtlar, server logunda tutarsızlık hataları, migrate yarıda.
- **Komut:** (1) Kapsamı belirleyin; yazmayı durdurun: `docker compose stop web server`. (2) Hangi ana dönülecek? `ls /var/backups/remote`,
  her run'ın `manifest.json`'u (`jq '{run, lastMigration, version}'`). Bozulma anından **önceki** son run. (3) Önce scratch provası
  (§18.4) → OK. (4) §18.5 `--target staging` (ön yedek bozuk durumu da saklar — inceleme için). Tek tablo/az kayıt sorununda tam
  geri yükleme yerine: scratch'i `--keep` ile bırakıp ilgili satırları oradan seçici aktarmak dba ile değerlendirilir.
- **Doğrulama:** `restore-verify: OK`, `/ready` 200, `check-app-grants.sh` 373 PASS, duman testi (giriş, oturum listesi, logo görünüyor).
  Kayıp pencere = son yedek → olay arası (RPO ≤ 24 sa); kullanıcılara bildirilir.
- **Geri dönüş:** ön yedeğe (geri yüklemeden hemen önce alınan run) aynı komutla dönülür.

### 19.8 Saklama işi çalışmadı (`RETENTION-ALARM`, §18.6)

- **Belirti:** son başarılı tur > 26 sa (süreç 26 sa'ten uzun ayakta) veya `rs_retention_failures_total` > 0; audit'te günlük `retention.run` yok.
- **Komut:** `docker compose logs server --since 30h | grep -iE 'retention' | tail -50` (firma kimliği + hata kodu; kişisel veri yok).
  Sık nedenler: DB kilit/bağlantı (`db_busy`, §12.5), yetki hatası (`command denied` → migrate/grants eksik: §18.7/5–6
  `check-app-grants.sh`), tetikleyici reddi (`older than 730 days` → saat sorunu: `docker compose exec -T mysql date -u` ile host `date -u` karşılaştırın).
  Tek firma hatası diğerlerini durdurmaz (fail-soft); sürekli aynı firma ise o firmanın verisi incelenir (backend'e bildir).
- **Doğrulama:** bir sonraki 03:30 turundan sonra §18.6 komutu `retention-ok`; audit'te yeni `retention.run`. Tur kaçırılınca veri
  kaybı olmaz; sonraki tur aynı kesme noktasıyla tamamlar (idempotent). Acil değilse server'ı yeniden başlatmayın (süreç yaşı sıfırlanır, tur yine 03:30'da).
- **Geri dönüş:** yayın sonrası başladıysa §18.8/1 (önceki imaj; saklama işi P12b kapsamına döner) ve backend'e bildir.

### 19.9 Disk doldu (DB büyüdü / yedek dizini / Docker)

- **Belirti:** MySQL `No space left on device`/`The table is full`, server 503, yedek `boş alan … < BACKUP_MIN_FREE_MB`.
- **Komut:** `df -h / /var/lib/docker /var/backups/remote`; `docker system df -v | grep -E 'remote_|VOLUME'`; yedek dizini `du -sh /var/backups/remote/*`.
  Güvenli temizlik: yalnız kendi eski imajlarımız (`docker image rm remote-*:<eski>`, §8), coturn logu (§9.8.1), en eski yedekler
  **yalnız** 14 günden eskiyse. `docker system prune` (filtresiz) **yasak** (paylaşımlı sunucu). Büyüyen tablo:
  `SELECT table_name, ROUND((data_length+index_length)/1048576) mb FROM information_schema.TABLES WHERE table_schema='remote' ORDER BY mb DESC LIMIT 10`
  (audit_logs → saklama işi çalışıyor mu, §19.8).
- **Doğrulama:** disk < %80; `docker compose ps` healthy; `systemctl start remote-backup.service` → OK.
- **Geri dönüş:** silinen imaj gerekiyorsa yeniden build (§8); yedek dizini silinmez, yerine disk büyütülür.

### 19.10 Yedek alınamadı (`remote-backup: FAILED`)

- **Komut:** `journalctl -u remote-backup.service -n 50 --no-pager` → `adım=`: `önkoşul` (age/jq yok, backup.env eksik/hatalı
  recipient), `mysql-bul` (mysql durmuş → §19.1), `tetikleyici` (DB'de 3 tetikleyici yok → audit koruması düşürülmüş: **güvenlik olayı**; kim/ne zaman için MySQL genel
  logu yoksa `docker compose logs mysql`, SSH/root erişim logları; tetikleyiciler §18.5 ile yedekten veya dba'nın P11/P13a
  migration SQL'iyle migrator olarak yeniden kurulur), `önkoşul` + "backup.env güvensiz" (`chown root:root … && chmod 600 …`),
  `meta`/`mysqldump` (`Access denied` → §18.7/3–4 backup kullanıcısı; parola
  `.env` ile mysql konteyneri arasında farklıysa `docker compose up -d mysql` + backup-user.sql), `döküm-doğrula` (boş/bozuk/tetikleyici
  sayısı farkı → dba), `uploads-arşiv`, `şifrele`, disk (§19.9).
  P13b adımları: `önkoşul` + "DEPLOY_ENV" (`deploy/.env`'e `DEPLOY_ENV=` ekleyin, §18.9/1), `imza` (anahtar yok/izin ≠ 600:
  `stat -c '%U %a' /etc/remote-backup/manifest_ed25519` → `root 600`), `audit-sureklilik` (§19.12), "önceki yedeğin manifest
  imzası geçersiz" (yerel yedek dizini kurcalanmış: **güvenlik olayı**, dizine dokunmadan inceleyin, §19.12 adımları).
- **Doğrulama:** `systemctl reset-failed remote-backup.service && systemctl start remote-backup.service` → journal `remote-backup: OK`.
  Aynı gün içinde başarılı bir yedek olmalı (RPO ≤ 24 sa).

### 19.11 Site dışı kanca başarısız (`OFFSITE-FAILED`)

- **Belirti:** journal `remote-backup: OFFSITE-FAILED run=<run> rc=<n>` + `BACKUP_ALERT_CMD` mesajı; `status.prom`
  `remote_backup_offsite_last_rc` ≠ 0; `remote-watch` site dışı kontrolü (son başarı > 26 sa). **Yerel yedek tamamdır** (birim OK).
- **Komut:** `journalctl -u remote-backup.service --since -26h --no-pager | grep -E 'OFFSITE|HATA'`. rc anlamı:
  `124`/`137` süre aşımı (TERM / 60 sn sonra KILL; `BACKUP_OFFSITE_TIMEOUT_SEC`, ağ hızı), `126` kanca çalıştırılmadı
  (`remote-offsite` yok ya da uid 0, `/var/backups` 755 değil, komut metninde sır, birim süre bütçesi bitti — ayrıntı aynı
  dakikadaki `HATA:` satırında), `127` `setpriv` yok (`apt-get install -y util-linux`), diğerleri aracın kendi kodu
  (kimlik süresi doldu, hedef dolu, ağ). Elle tekrar (aynı kısıtlarla; komutu backup.env'den alın, metni ekrana basmayın):

```bash
R=<run>; D=/var/backups/remote
chgrp remote-offsite $D $D/$R $D/$R/*; chmod 710 $D; chmod 750 $D/$R; chmod 640 $D/$R/*
CMD="$(awk -F= '$1=="BACKUP_OFFSITE_CMD"{sub(/^[^=]*=/,""); print}' /opt/remote/deploy/backup/backup.env)"
(cd / && setpriv --reuid=remote-offsite --regid=remote-offsite --clear-groups --inh-caps=-all env -i PATH=/usr/bin:/bin \
   HOME=/var/lib/remote-offsite REMOTE_BACKUP_RUN_DIR=$D/$R REMOTE_BACKUP_RUN=$R REMOTE_BACKUP_DIR=$D \
   REMOTE_BACKUP_HOST="$(hostname -s)" REMOTE_BACKUP_ENV="$(awk -F= '$1=="DEPLOY_ENV"{print $2}' /opt/remote/deploy/.env)" sh -c "$CMD"); echo rc=$?
chmod 600 $D/$R/*; chmod 700 $D/$R $D                  # izinleri geri al
```

- **Doğrulama:** `rc=0`; hedefte `<env>/<run>/` altında 4 dosya; sonraki zamanlanmış yedekte `OFFSITE OK`, `remote_backup_offsite_last_rc 0`.
- **Geri dönüş:** kanca bozuk ve hemen düzelmiyorsa `BACKUP_OFFSITE_CMD=` boşaltılır (her yedekte `OFFSITE-UNCONFIGURED` uyarısı,
  `remote-watch` 7 günde bir hatırlatır); yerel yedekler etkilenmez. Hedef kimliği değiştiyse yalnız `remote-offsite`'ın 600 dosyası güncellenir.

### 19.12 Audit süreklilik alarmı (`FAILED adım=audit-sureklilik` / `taban-cizgisi-sifirlandi`)

- **Belirti:** journal `audit-sureklilik: FAILED <neden>` (`maxId`, `gun=<YYYY-MM-DD,…>`, `tail=<gün>`, `ozet-kesildi`,
  `taban-cizgisi-kaydi-kayboldu`, `taban-cizgisi-isaretsiz`), birim `failed` + alarm; `status.prom` `remote_backup_audit_continuity_ok 0`. Uyarı biçimi:
  `audit-sureklilik: taban-cizgisi-sifirlandi id=<n> zaman=<at>` (rc 0, alarm mesajı). **FAILED = olası güvenlik olayı**: geçmiş
  audit kaydı silinmiş/değiştirilmiş ya da tablo boşaltılmış olabilir (tetikleyicileri atlayabilen yalnız root/migrator).
- **Komut:**
  1. Karşılaştırmayı görün (kişisel veri yok, yalnız gün/sayı/özet):
     `R=$(ls -1 /var/backups/remote | grep Z$ | tail -1); jq '.auditContinuity' /var/backups/remote/$R/manifest.json` →
     `comparedWith` = son İYİ run. Değişen gün için iki manifesti karşılaştırın:
     `jq --arg d <gün> '.audit.days[$d]' /var/backups/remote/{<comparedWith>,$R}/manifest.json` (n ve h).
  2. Kim/ne zaman: Audit ekranı (o gün, `retention.run`, `backup.audit_baseline_reset`), `docker compose logs mysql --since 48h`,
     `journalctl _COMM=sshd --since -3d`, `last -F | head`, `docker events --since 48h --until now --filter container=$(docker compose ps -q mysql)` (kısa tutun).
     Sıfırlama kaydı gerçekten yapıldı mı: Audit ekranında "Yedek audit taban çizgisi sıfırlandı" kaydının operatörü ve gerekçesi.
  3. Kanıt: FAILED run'ları ve `comparedWith` run'ı **silmeyin/taşımayın** (imzalı kanıt; rotasyon referansı korur). Gerekirse
     iş istasyonunda iki run'ı scratch'e açıp (§18.4 A, `--keep`) ilgili günün satırlarını karşılaştırın (dba).
  4. Karar: (a) meşru (ör. belgelenmiş elle düzeltme, saat sorunu) → §18.9/5 `backup.sh --reset-audit-baseline "<olay no>"` (elle SQL **değil**; işaretsiz sıfırlama FAILED üretir);
     (b) yetkisiz değişiklik → olay müdahalesi: erişimleri kapatın, sırları döndürün (§20.2/5 komutları), gerekirse §19.7 ile
     son İYİ yedeğe dönün; yönetim/KVKK bildirimi değerlendirilir.
  - `taban-cizgisi-sifirlandi` uyarısı: beklenen bir geri yükleme ya da sizin yaptığınız sıfırlama değilse FAILED gibi ele alın (2–4).
  - Meşru sıfırlamadan sonraki uyarıda (`taban-cizgisi-sifirlandi`) farklar yine hesaplanır ve ` fark-bilgi=<maxId;gun=…;tail=…>`
    olarak journal'a, manifest `auditContinuity.detail`'e ve alarm metnine eklenir. **Yalnız bilgidir** (sonuç uyarı, rc 0): sıfırlama
    öncesinde hangi günlerin değiştiğini gösterir; beklenmeyen gün varsa 2–4 adımlarıyla inceleyin.
  - `--reset-audit-baseline` yedekle aynı kilidi (`$BACKUP_DIR/.lock`) kullanır: yedek ya da başka bir sıfırlama çalışırken
    `başka bir yedek/sıfırlama çalışıyor` ile **reddedilir**, işaret yazılmaz → yedek bitince (`systemctl is-active remote-backup.service`
    → `inactive`) yeniden çalıştırın.
  - `FAILED taban-cizgisi-isaretsiz`: DB'ye sıfırlama satırı **host işareti olmadan** yazılmış (elle SQL ya da app ile) →
    olay müdahalesi: Audit ekranında `backup.audit_baseline_reset` satırının kullanıcı/IP'si ve zamanı incelenir. Meşruysa
    (ör. operatör eski yöntemle SQL çalıştırdı) `backup.sh --reset-audit-baseline "<gerekçe>"` yeniden çalıştırılır (§18.9/5).
  - `FAILED adım=tetikleyici`: §19.10 (tetikleyici gövdesi beklenen özetle eşleşmiyor; yedek alınmadı).
- **Doğrulama:** sıfırlamadan sonraki yedek `taban-cizgisi-sifirlandi` (uyarı), ondan sonraki `audit-sureklilik: ok`;
  `remote_backup_audit_continuity_ok 1`; `remote-watch` "DUZELDI".
- **Geri dönüş:** yanlış sıfırlama geri alınamaz (kayıt kalır); bir sonraki yedek yeni taban olur. Olay kaydına not düşülür.

## 20. Prod (P13b; ADR-0019, `docs/mimari-p13.md` §7.2–7.13)

Prod, staging yığınının `/opt/remote`'ta **yerinde terfisidir** (compose projesi `remote`, aynı VM `develop`). Terfi temiz kurulumdur:
yeni volume'lar, yeni sırlar, `DEPLOY_ENV=production`, `CADDY_BIND=127.0.0.1`, yeni TURN secret, yeni age ve imza anahtarları.
Erişim: `https://remote.noktabilisim.net` (host nginx → `127.0.0.1:4451`). 4450 yalnız loopback tanı içindir. Değerler ve sırlar
bu dokümana yazılmaz; parola kasasında tutulur.

### 20.1 Ön koşullar ve ağ talepleri

Ön koşullar (§7.12): P13b staging'de yayında (sıra A); qa GEÇTİ, güvenlik Kritik/Yüksek 0; kullanıcı adımları U1–U3 tamam
(repo public + gitleaks, Release onayı, prod age çifti ve kasa kayıtları, `ABUSE_EMAIL`, K13 kararı).

**pfSense talebi (ağ yöneticisine, iki ayrı zamanda):**

| #   | Ne zaman                                            | Kural                                                                                                                                            | Doğrulama                                                                                           |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| P1  | Terfiden **önce** (dinleyeni olmayan port zararsız) | WAN 185.126.217.99 UDP **49160–49479** → 192.168.25.10 aynı portlar (1:1, port çevirisi yok); eski 49160–49199 kuralı bunun içinde kalır/silinir | Terfi sonrası `test-denied.sh` "0)" bölümü ve AC-23 ölçümü; dış makineden relay adayı 49200+ portta |
| P2  | §20.3 kontrol listesi **imzalandıktan sonra**       | WAN TCP **4450** NAT ve izin kuralı **kaldırılır**                                                                                               | Dış makineden `nc -vz -w 5 185.126.217.99 4450` → zaman aşımı                                       |

Değişmeyenler: 80/443 (nginx), 3478 UDP/TCP, 5349 TCP, 22.

**UFW (sunucuda, root; terfi adımı 6'da):**

```bash
ufw delete allow 49160:49199/udp; ufw allow 49160:49479/udp; ufw delete allow 4450/tcp
ufw status | grep -E '49160|4450'          # yalnız "49160:49479/udp ALLOW"; 4450 satırı yok
```

Not: Docker'ın yayımladığı portlar UFW'yi atlar; 4450'nin asıl kontrolü `CADDY_BIND=127.0.0.1`'dir (G-P13b-9):
`ss -tlnp | grep ':4450 '` → yalnız `127.0.0.1:4450`.

### 20.2 Açılış sırası (terfi, sıra B) — her adım: komut → beklenen

Komutlar root, `/opt/remote/deploy` (aksi yazmadıkça). Sırlar ekrana yazılmaz; `set -x` kullanılmaz.

**1. Duyuru:** staging test kullanıcılarına kapanış bildirimi (WhatsApp/e-posta; metinde adres/sır yok).

**2. Son staging yedeği + doğrulama + staging imza anahtarının saklanması (G-P13b-9):**

```bash
systemctl start remote-backup.service; journalctl -u remote-backup.service -n 10 --no-pager | grep 'remote-backup: OK'
R=$(ls -1 /var/backups/remote | grep Z$ | tail -1); jq -r '.env' /var/backups/remote/$R/manifest.json     # staging
install -d -m 700 /var/backups/remote-staging-final && mv /var/backups/remote/$R /var/backups/remote-staging-final/$R   # dizin adı = run KALIR
cp -p /etc/remote-backup/allowed_signers /root/allowed_signers.staging-final && chmod 644 /root/allowed_signers.staging-final
```

Ardından §18.4 B ile scratch doğrulaması (staging age anahtarı, `/var/backups/remote-staging-final/$R`,
`--allowed-signers /root/allowed_signers.staging-final`) → `restore-verify: OK`. Kalan staging run'ları (test verisi) silinir:
`rm -rf /var/backups/remote/2*Z` → `ls /var/backups/remote` boş. Staging-final dizini ve `allowed_signers.staging-final` **14 gün**
sonra silinir (takvime yazın).

**3. Geri dönüş için `.env`:**

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ); cp -p .env /root/.env.staging-final.$TS && chmod 600 /root/.env.staging-final.$TS
grep -c '^DEPLOY_ENV=staging$' /root/.env.staging-final.$TS      # 1 (yoksa önce ekleyin; geri dönüşte restore aksi hâlde reddeder)
```

14 gün sonra `shred -u /root/.env.staging-final.*`.

**4. İmajları hazırla, yığını indir, yalnız remote volume'larını sil:**

```bash
git -C /opt/remote log -1 --oneline                  # terfi edilecek commit
TAG=$(git -C /opt/remote rev-parse --short HEAD) && sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$TAG/" .env && docker compose build
docker compose down
docker volume rm remote_mysql_data remote_uploads remote_caddy_data remote_caddy_config remote_agent_downloads
docker volume ls -q | grep '^remote_'                # boş
```

Başka projelerin volume/konteynerine dokunulmaz; `docker volume prune` / `system prune` **yasak**.

**5. Yeni `deploy/.env` (yeni sırlar, prod değerleri; §7.9).** Sır olmayan değerler staging-final'den gelir, bütün sırlar yeniden üretilir:

```bash
umask 077 && cp -p /root/.env.staging-final.$TS .env.new
kv() { if grep -q "^$1=" .env.new; then sed -i "s|^$1=.*|$1=$2|" .env.new; else printf '%s=%s\n' "$1" "$2" >> .env.new; fi; }
for k in MYSQL_ROOT_PASSWORD MYSQL_APP_PASSWORD MYSQL_MIGRATOR_PASSWORD MYSQL_BACKUP_PASSWORD METRICS_TOKEN; do kv "$k" "$(openssl rand -hex 24)"; done
kv SESSION_REF_KEY "$(openssl rand -base64 48 | tr -d '\n')"
kv EDGE_PROXY_SECRET "$(openssl rand -base64 32)"
kv APP_ENCRYPTION_KEYS "v1:$(openssl rand -base64 32)"
kv TURN_SECRET "$(openssl rand -hex 32)"; kv TURN_SECRET_PREVIOUS ""
kv SEED_SUPERADMIN_PASSWORD "$(openssl rand -hex 12)"
DB=$(awk -F= '$1=="MYSQL_DATABASE"{print $2}' .env.new)
kv DATABASE_URL "mysql://app:$(awk -F= '$1=="MYSQL_APP_PASSWORD"{print $2}' .env.new)@mysql:3306/$DB?allowPublicKeyRetrieval=true"
kv MIGRATE_DATABASE_URL "mysql://migrator:$(awk -F= '$1=="MYSQL_MIGRATOR_PASSWORD"{print $2}' .env.new)@mysql:3306/$DB"
kv DEPLOY_ENV production; kv NODE_ENV production; kv CADDY_BIND 127.0.0.1
kv PUBLIC_BASE_URL https://remote.noktabilisim.net; kv ALLOWED_ORIGINS https://remote.noktabilisim.net
kv TURN_URLS 'stun:remote.noktabilisim.net:3478,turn:remote.noktabilisim.net:3478?transport=udp,turn:remote.noktabilisim.net:3478?transport=tcp,turns:remote.noktabilisim.net:5349?transport=tcp'
kv MIN_AGENT_VERSION ""                               # adım 10'da doldurulur
# SEED_SUPERADMIN_EMAIL, ABUSE_EMAIL (K-P13b-3), WHATSAPP_SERVICE_URL (K13: boş ya da kasadaki TLS adresi) elle — değerler runbook'a yazılmaz
# WHATSAPP_SERVICE_API_KEY (isteğe bağlı; servisin x-api-key anahtarı, kasadan editörle; yalnız env adresiyle kullanılır, panel adresi kayıtlıysa panel anahtarı gerekir).
#   Servis REQUIRE_API_KEY'e geçmeden ÖNCE girilmiş olmalı. Kontrol: grep -c '^WHATSAPP_SERVICE_API_KEY=.' .env.new → 1 (kanal kullanılacaksa)
mv .env.new .env && chmod 600 .env && stat -c '%U %a' .env                         # root 600
grep -cE '^(DEPLOY_ENV=production|CADDY_BIND=127\.0\.0\.1|NODE_ENV=production)$' .env   # 3
```

- Kasa kaydı (tek seferlik, terminalden doğrudan kasaya; dosyaya/sohbete yazılmaz):
  `grep -E '^(SEED_SUPERADMIN_PASSWORD|APP_ENCRYPTION_KEYS|MYSQL_ROOT_PASSWORD)=' .env` → kasaya → `clear`.
- Eski artıklar imha (G-P13b-9 sınırı: ext4/SSD'de `shred` garanti değildir; asıl kontrol sırların döndürülmüş olması):
  `shred -u deploy/.env.bak.* /root/.env.bak.* /root/remote-pre-*.sql.gz 2>/dev/null; rm -rf /root/remote-uploads-pre-*; shred -u /opt/remote/deploy/ACCESS.txt`
  → `ls /opt/remote/deploy/ACCESS.txt` "No such file". Geçmiş taraması: `grep -lE 'PASSWORD=|SECRET=|AGE-SECRET-KEY' /root/.*_history` → boş (varsa ilgili satırları silin).
- WhatsApp: kanal panel kaydı ya da `WHATSAPP_SERVICE_URL` olmadan **kapalıdır** (yeni DB'de panel kaydı yok). K13 kararı (b) ise boş kalır.
  Kanal açılacaksa `WHATSAPP_SERVICE_API_KEY` de girilir (servis anahtar zorunlu hâle gelmeden önce; panel adresi kayıtlıysa
  anahtar da panelden girilir). Doğrulama §20.3/8: Super Admin "Test Mesajı Gönder" başarılı; anahtar loglarda/ekranda görünmez.

**6. TURN (ADR-0018; §9, §20.5):**

```bash
cd /opt/remote/deploy/turn
TS2=$(awk -F= '$1=="TURN_SECRET"{print $2}' ../.env); sed -i "s|^TURN_SECRET=.*|TURN_SECRET=$TS2|" .env; unset TS2
for kvp in TURN_REALM=remote.noktabilisim.net TURN_MAX_BPS=1000000 TURN_BPS_CAPACITY=0 TURN_FW_RELAY_MAX_BPS=62500000 TURN_CERT_DIR=/etc/remote/turn-certs; do
  k=${kvp%%=*}; grep -q "^$k=" .env && sed -i "s|^$k=.*|$kvp|" .env || echo "$kvp" >> .env; done
cmp <(awk -F= '$1=="TURN_SECRET"{print $2}' .env | sha256sum) <(awk -F= '$1=="TURN_SECRET"{print $2}' ../.env | sha256sum) && echo secret-eş
```

Ardından sırayla: §20.5 sertifika kancası (LE `remote-turn`) → `sudo ./host-firewall.sh preflight` (`preflight OK`) →
`sudo ./host-firewall.sh install` (`önceki relay aralığı 49160-49199 reserved ports'tan geri alındı`;
`cat /proc/sys/net/ipv4/ip_local_reserved_ports` 49160-49479'u kapsar; `iptables -S REMOTE-TURN-OUT | grep -c hashlimit` → 3) →
§20.1 UFW → `docker compose -p remote-turn up -d --force-recreate` (`docker compose -p remote-turn ps` healthy) →
`./test-denied.sh` → 0 FAIL ("0)" bölümü 49160-49479 / 300; ~60 allocation açar, 600 sn yaşar) → §9.2.3 listesi.

**7. Yığın + AC-88 ölçümü + seed + yetki sınırı:**

```bash
cd /opt/remote/deploy
t0=$(date +%s); docker compose up -d --no-build
until docker compose exec -T server node -e "fetch('http://127.0.0.1:3001/ready').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))" 2>/dev/null; do sleep 2; done
echo "AC-88: $(( $(date +%s) - t0 )) sn"                 # ≤ 120 → §2 "Temiz kurulum kaydı" tablosuna
docker compose --profile setup run --rm seed           # Super Admin + varsayılanlar
set -a; . ./.env; set +a; APP_PW=$MYSQL_APP_PASSWORD BACKUP_PW=$MYSQL_BACKUP_PASSWORD MIGRATOR_PW=$MYSQL_MIGRATOR_PASSWORD \
  CONTAINER=$(docker compose ps -q mysql) DB=$MYSQL_DATABASE bash mysql/check-app-grants.sh | tail -3; set +a
#   384/384 PASS (P13b; anon=0, migratorExtra=0 dahil), grep -c FAIL = 0
ss -tlnp | grep -E ':445[01] '                         # yalnız 127.0.0.1:4450 ve 127.0.0.1:4451
curl -sI https://remote.noktabilisim.net/login | grep -i strict-transport   # max-age=31536000; includeSubDomains
```

(Ortam değişkenlerini kabukta bırakmamak için bu adımı ayrı bir `ssh` çağrısında çalıştırın.)

**8. Yedek (prod anahtarları; §18.9):**

- Kullanıcı iş istasyonunda **yeni prod age çifti** üretir (§18.1); yalnız açık anahtar gelir:
  `sed -i "s|^BACKUP_AGE_RECIPIENT=.*|BACKUP_AGE_RECIPIENT=age1…|" backup/backup.env`.
- Staging imza anahtarı imha + prod anahtarı (G-P13b-9; prod `allowed_signers`'ta **yalnız** prod anahtarı olur):

```bash
shred -u /etc/remote-backup/manifest_ed25519 && rm -f /etc/remote-backup/manifest_ed25519.pub /etc/remote-backup/allowed_signers
# §18.9/1'deki anahtar üretimi + allowed_signers (aynı komutlar); DEPLOY_ENV zaten production
wc -l < /etc/remote-backup/allowed_signers             # 1
cat /etc/remote-backup/allowed_signers                 # kasaya: "Remote — yedek imza doğrulama (allowed_signers, prod)"
systemctl start remote-backup.service; journalctl -u remote-backup.service -n 20 --no-pager | grep -E 'audit-sureklilik|OFFSITE|remote-backup: OK'
#   audit-sureklilik: ilk (yeni volume = yeni instanceId) · OFFSITE-UNCONFIGURED (uyarı) · remote-backup: OK run=…
jq -r '.env' /var/backups/remote/$(ls -1 /var/backups/remote | grep Z$ | tail -1)/manifest.json      # production
```

- **AC-91 prod provası:** §18.4 **yol A** (iş istasyonu; `--allowed-signers` = kasadaki prod kopyası) → `restore-verify: OK`, RTO
  (a+b; c için prod'da canlı geri yükleme yapılmaz, scratch kesinti tahmini §18.4 tablosundaki ölçüm) §18.4 tablosuna.
- **Olumsuz:** §18.9/3 (tek bayt) → `restore-verify: FAIL (imza)`.
- **AC-200 hata testi:** §18.7/9 komutu → `FAILED adım=mysql-bul` + alarm; sonra `systemctl reset-failed remote-backup.service`.

**9. `remote-watch`:** §20.4 → ilk koşu `remote-watch: OK` ya da yalnız `offsite-unconfigured` uyarısı.

**9b. proxy-guard (G-P13b-3):** §20.9 → `verify OK: root bağlandı, 'nobody' reddedildi`.

**10. İstemci Release ve sürüm zorlaması (§11; mimari §7.10):** yerelde
`deploy/agent/verify-and-publish.sh --tag vX.Y.Z --ssh root@185.126.217.99` (`--no-attestation`/`ALLOW_UNATTESTED` **yok**) →
`deploy/.env` `MIN_AGENT_VERSION=X.Y.Z` → `docker compose up -d server`. Doğrulama: indirme `sha256sum` = Release `SHA256SUMS`
(§19.4); eski staging istemcisi bağlanınca 426 `CLIENT_OUTDATED`.

**11. Super Admin ilk girişi:** kasadaki seed parolasıyla giriş → parola değişir → 2FA kurulur → 10 kurtarma kodu kasaya.
`docker compose exec server node src/cli/reset-superadmin.ts --email <sa> --dry-run` (`-T` yok) → `Dry-run: … hesabı bulundu.
Değişiklik yapılmadı.`, rc 0. "Nokta Test" firması ve test hesapları oluşturulur (§20.3 testleri için).

**12. Kontrol listesi ve imza:** §20.3 tablosu (test-operatoru + kullanıcı) doldurulur ve imzalanır → pfSense P2 (4450 NAT
kaldırma) → "Nokta Test" pasife alınır → müşteri yönlendirmesi **ancak imzadan sonra** başlar. §8 yayın geçmişine son satır
("Prod terfisi — staging arşivlendi").

**P32 notu:** gözetimsiz servis (`UNATTENDED_MODE`) terfide `off` kalır; prod'da imzasız açılış (`unsigned-accepted`, risk kabulü)
terfiden sonra ayrı adımla §27.9'dan yapılır ve §20.3 madde 16 ile imzalanır. İmaj geri alınacaksa önce §27.9 "Geri alma / kapatma".

### 20.3 Prod açılış kontrol listesi (şablon; imzalı)

| #   | Madde                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Kanıt (komut / kayıt)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Sonuç | Yapan | Tarih |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----- | ----- |
| 1   | AC-88 ≤ 120 sn; AC-91/AC-200 prod provası OK, RTO ≤ 60 dk; imza olumsuz testi FAIL                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | §20.2/7 süre; §18.4 tablo satırı; §18.9/3 çıktısı; §18.7/9 journal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |       |       |       |
| 2   | AC-23 `relay/tls` (UDP kapalı, yalnız 443 + 5349/TCP; kök sertifika yok); AC-21 tavanı (allocation başına 8 Mbit/s)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `docs/test-raporu.md` kaydı; `test-local.sh` ölçümü                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |       |       |       |
| 3   | `test-denied.sh` 0 FAIL (49160–49479); S-P3-2 relay↔relay echo PASS; §9.2.3 listesi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | çıktı özeti                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |       |       |       |
| 4   | S-P2-5: dış makineden başarısız girişte audit `ip_address` = istemcinin genel IPv4'ü; IPv6 kaydı (§20.7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Audit ekranı; `ip -6 addr show scope global` boş; `dig +short AAAA remote.noktabilisim.net` boş                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |       |       |       |
| 5   | HSTS `max-age=31536000; includeSubDomains`; AC-126 e2e; `rs_theme` çerezi `Secure`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `curl -sI …/login`; e2e çıktısı                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |       |       |       |
| 6   | P10 elle testleri (SSL/465, STARTTLS/587, sıfırlama 30 dk, 20/sa → 21. 429, kilit e-postası, logout-all/2FA sıfırlamada oturum ≤ 5 sn, SA SMTP ekranı, 8 sa oturum)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `docs/test-raporu.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |       |       |       |
| 7   | Windows elle testleri (prod Release, 0.10.2 adım 1–7 + AC-95/96/128; parmak izi = SHA256SUMS); eski istemci 426                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | test raporu                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |       |       |       |
| 8   | K13: (a) TLS/özel ağ + test mesajı başarılı ya da (b) kanal kapalı, uyarı + `whatsapp_insecure` log + karar kaydı                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ekran / log satırı / karar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |       |       |       |
| 9   | `reset-superadmin --dry-run` 0 (gerçek çalıştırma ikinci SA'da ya da entegrasyon testi kanıtı)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | §20.2/11 çıktısı                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |       |       |       |
| 10a | G-P13b-3 proxy-guard verify OK; nginx yolu 200; `check` UYARI satırları değerlendirildi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `remote-proxy-guard verify` / `check` çıktısı; `nft list table inet remote_proxy_guard`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |       |       |       |
| 10  | `remote-watch` alarm testi: `docker compose stop web` → ≤ 10 dk ALERT → `start` → DUZELDI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | gelen mesajlar, journal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |       |       |       |
| 11  | Yedek hata testi (AC-200) FAILED + alarm; audit süreklilik olumsuz testi (T1 yerel kanıtı)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | journal; `docs/implementation.md` T1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |       |       |       |
| 12  | Repo public, gitleaks tüm geçmiş 0 bulgu; `verify-and-publish` attestation'la; agent-watch yeşil                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | gitleaks çıktısı; Actions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |       |       |       |
| 13  | Gizli bilgi temizliği: staging sırları/dökümleri imha, ACCESS.txt yok, yeni sırların kasa kaydı; history/journal sır taraması (`grep -lE 'PASSWORD=\|SECRET=\|AGE-SECRET-KEY' /root/.*_history` boş; `journalctl --since -30d \| grep -ciE 'password=\|secret='` 0); imaj katmanlarında sır yok (`docker history --no-trunc remote-server:<TAG> \| grep -ciE 'password\|secret'` 0); staging sırlarıyla eşleşen değer kullanılmıyor; 4450 yalnız 127.0.0.1 (`ss`) ve dışarıdan `nc` zaman aşımı                                                                                                                                                                                                                                                                                                                                                                                                                  | komut çıktıları (değer yazmadan, yalnız sayılar)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |       |       |       |
| 13b | `docker` grubu boş (root eşdeğeri; proxy-guard ve root 600 korumalarını aşar)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `getent group docker` → üye yok                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |       |       |       |
| 14  | "Nokta Test" pasif; README, kılavuz, DATASHEET (ağ gereksinimleri), PDF'ler güncel                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | dosya tarihleri / commit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |       |       |       |
| 15  | K13 geçici izni kapalı: `WHATSAPP_ALLOW_INSECURE_HTTP=false` (ya da boş); WhatsApp servisi HTTPS'te (D-LGK-2, §12.3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `grep -c '^WHATSAPP_ALLOW_INSECURE_HTTP=true' deploy/.env` → 0; `docker compose logs server \| grep -c whatsapp_insecure_http_allowed` → 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |       |       |       |
| 16  | **P32 risk kabulü (ADR-0042, R-P32-1):** gözetimsiz servis prod'da kod imzasız, `UNATTENDED_MODE=unsigned-accepted`. İmzalayan şunları gördü: liste = `PUBLISHED.log` Release satırları (elle eklenmiş öğe yok); açılış alarm logu tam 1 satır + `listFingerprint`; SA bandı (Admin'de yok); AC-533 müşteri mesajı örneği (alan adı, dosya, sürüm, SHA); Windows VM'de `Get-FileHash` = paneldeki SHA + SmartScreen "Ek bilgi → Yine de çalıştır" duman testi; iki aşamalı geri çekme bedeli (listeden çıkarılan SHA'daki cihaz güncelleme de alamaz, elle yeniden kurulum); §13 m.3 kararı (AC-419 bağlantı gönderimi açık / kapalı). **Tedarik zinciri kanıtı (S-P32-10):** `v*` etiket ruleset'i etkin, `refs/tags/v*` oluşturma/güncelleme/silme kuralları açık, bypass yalnız depo yöneticisi rolü (başka kişi/ekip/uygulama yok); `agent-release` ortamında yönetici atlaması kapalı + gerekli onaylayıcı. | §27.9/5 liste denetimi → her satır `ok`, `EKSIK` yok; `docker compose logs server --since 1h \| grep -c unattended_unsigned_risk_accepted` → `1`; açılıştan ≥ 2 tur (20 dk) sonra son tur: `journalctl -t remote-watch --since -11min \| grep 'check=unattended-'` → `BILGI check=unattended-deploy-env OK DEPLOY_ENV=production` ve `BILGI check=unattended-unsigned-accepted …` var, `ALERT check=unattended-` yok (açılıştaki tek seferlik `unattended-mode-changed` bu pencerede olmamalı); §27.9/8 `gh api` çıktıları (kanıt dosyası; değer/sır yok): ruleset `bypass` listesinde **`DeployKey` girdisi yok** (yalnız `RepositoryRole` Admin) ve `gh api 'repos/NoktaBilisim/Remote/collaborators?permission=admin' --jq '.[].login'` çıktısı yalnız beklenen yönetici(ler) — beklenmeyen login varsa imza atılmaz |

Onay: ad, tarih: ______________________

### 20.4 `remote-watch` kurulumu (T4; `deploy/ops/`)

```bash
cd /opt/remote/deploy/ops && ./remote-watch.sh install
#   kurulu kopya /usr/local/lib/remote/remote-watch.sh (root 0755), /etc/remote-watch/watch.env (600), timer enable
install -m 600 /dev/null /etc/remote-watch/telegram.curl   # içerik: url = "https://api.telegram.org/bot<TOKEN>/sendMessage" + data = "chat_id=<ID>" (kasadan; ekrana basmadan editörle)
#   watch.env: WATCH_ALERT_CMD=curl -fsS -m 10 -K /etc/remote-watch/telegram.curl --data-urlencode text@- >/dev/null  (watch.env.example)
stat -c '%U %a' /etc/remote-watch/watch.env /etc/remote-watch/telegram.curl     # root 600 · root 600
systemctl start remote-watch.service; journalctl -u remote-watch -n 20 --no-pager | grep remote-watch:
#   remote-watch: OK (<n> kontrol)   — ya da yalnız offsite-unconfigured hatırlatması
systemctl list-timers remote-watch.timer        # 10 dakikada bir
```

**P32 (§27.9, S-P32-r2-1): `WATCH_DEPLOY_ENV` zorunlu (gözetimsiz mod `off` değilse).** `watch.env`'e beklenen ortamı yazın —
prod `/etc/remote-watch/watch.env`: `WATCH_DEPLOY_ENV=production`; ikinci örnek `/etc/remote-watch/stg.env`: `WATCH_DEPLOY_ENV=staging`
(tek yığın staging'de `watch.env`'e `staging`). `install` mevcut `watch.env`'i **ezmez**: anahtar elle eklenir (editörle; root 600 kalır),
ardından betik değiştiği için `./remote-watch.sh install` (ve örnek için `install stg`) yeniden çalıştırılır. Beklenen journal satırı:
`remote-watch: BILGI check=unattended-deploy-env OK DEPLOY_ENV=production`. Anahtar boşken mod `off` ise yalnız
`ATLANDI check=unattended-deploy-env` yazılır; mod açıkken boşsa **ALERT** `unattended-deploy-env … yapılandırılmamış`. Bugün staging
`unsigned` çalıştığı için P32 betiği kurulup anahtar eklenmezse staging örneği bu ALERT'i verir — beklenen; anahtarı ekleyin.

Alarm testi (§20.3/10): `docker compose stop web` → ≤ 10 dk `remote-watch: ALERT check=…` + Telegram mesajı → `docker compose start web`
→ sonraki koşuda "DUZELDI". Komut metninde token varsa `ALERT check=alert-cmd-unsafe` ve komut çalışmaz (G-P13b-7). Betik
değişince `./remote-watch.sh install` yeniden çalıştırılır (root birimi git ağacından çalışmaz, G-P13b-13).

### 20.5 TURN sertifika kancası (LE `remote-turn`; ADR-0018, G-P13b-4)

```bash
cd /opt/remote/deploy/turn && ./cert-deploy-hook.sh install
#   /usr/local/sbin/remote-turn-cert-deploy (root 0755), /etc/default/remote-turn-cert, /etc/remote/turn-certs (git dışı)
certbot certonly --webroot -w /var/www/remote-acme -d remote.noktabilisim.net --cert-name remote-turn --non-interactive \
  --deploy-hook /usr/local/sbin/remote-turn-cert-deploy          # aynı ad kümesi için onay isterse --duplicate
ls -l /etc/remote/turn-certs        # turn.crt 0444, turn.key 0400 (65534:65533)
docker compose -p remote-turn up -d --force-recreate             # yeni bağlama (TURN_CERT_DIR)
RENEWED_LINEAGE=/etc/letsencrypt/live/remote-turn /usr/local/sbin/remote-turn-cert-deploy   # OK: coturn SIGUSR2 ile yeni sertifikayı sunuyor
/usr/local/sbin/remote-turn-cert-deploy check                    # check OK
certbot renew --dry-run --cert-name remote-turn                  # "Congratulations, all simulated renewals succeeded"
shred -u certs/*.key certs/ca.* 2>/dev/null; rm -rf certs        # eski özel CA ve sertifikalar (staging)
```

Yenileme `certbot.timer` ile; hook sunulan parmak izini doğrular, tutmazsa `docker restart` yapar, yine tutmazsa rc 1 (journal `err`)
→ `remote-watch` sertifika kontrolü alarm verir (§19.3).

### 20.6 `reset-superadmin` (Super Admin parola / 2FA kaybı; mimari §7.7)

```bash
cd /opt/remote/deploy
docker compose exec server node src/cli/reset-superadmin.ts --email <sa-e-postası> --dry-run
#   Dry-run: DB bağlantısı tamam, Super Admin hesabı bulundu. Değişiklik yapılmadı.        (rc 0)
docker compose exec server node src/cli/reset-superadmin.ts --email <sa-e-postası> [--reset-mfa]
#   Super Admin şifresi sıfırlandı.
#   Geçici şifre (yalnız bir kez gösterilir): ********************   → doğrudan kişiye/kasaya; ekran kaydı, sohbet, bilet YOK
#   Geçici şifre 24 saat geçerlidir; ilk girişte yeni şifre belirlenmesi zorunludur.
#   Açık oturumlar iptal edildi: N. [İki adımlı doğrulama ve kurtarma kodları silindi.]
```

- `-T` **verilmez** (TTY şart; yoksa rc 4 "stdout bir terminal değil; işlem yapılmadı"). Çıktıyı pipe/dosyaya yönlendirmeyin.
- Server durmuşsa: `docker compose run --rm --no-deps server node src/cli/reset-superadmin.ts --email …`.
- Çıkış kodları: 0 tamam · 2 kullanım hatası · 3 "Super Admin bulunamadı." (ADMIN/pasif/silinmiş e-posta da 3) · 4 TTY yok ·
  5 DB/yapılandırma hatası (`ref <ULID>`; ayrıntı `docker compose logs server`'da değil, komutun stderr JSON logunda).
- Geçici parola **24 saat** sonra geçersiz (giriş 401 "Geçici şifrenin süresi doldu…", audit `auth.login fail temp_password_expired`) →
  komut yeniden çalıştırılır. Açık WebSocket'ler bir sonraki yeniden doğrulamada kapanır.
- Doğrulama: Audit ekranında "Super Admin şifresi sunucudan sıfırlandı" (`auth.superadmin_reset`, kullanıcı `cli`, parola yok);
  kullanıcı girişte şifre değiştirir, `--reset-mfa` ise 2FA'yı yeniden kurar ve yeni kurtarma kodlarını kasaya koyar.
- Bant dışı bildirim (G-P13b-10) henüz otomatik değil: başarılı çalıştırmadan sonra elle alarm kanalına (parola içermez):
  `printf 'Super Admin parolasi CLI ile sifirlandi (%s, %s)\n' "$(hostname -s)" "$(date -u +%FT%TZ)" | curl -fsS -m 10 -K /etc/remote-watch/telegram.curl --data-urlencode text@- >/dev/null`
  → mesaj geldi (§20.10 Y3).

### 20.7 IPv6 değişiklik kuralı (S-P3-3, S-P2-5; mimari §7.11)

Açılışta kayda geçer (§20.3/4): `ip -6 addr show scope global` → boş; `dig +short AAAA remote.noktabilisim.net` → boş;
`deploy/turn/test-denied.sh` IPv6 bölümü SKIP + gerekçe.
**Kural:** VM'e global IPv6 adresi eklenmesi ya da AAAA kaydı açılması bir **değişiklik talebidir** ve şu adımlar **değişiklikten
önce** yapılır, yapılmadan uygulanmaz: (1) §9.2.2: denied-peer-ip listesine VM'in /64'ü ve sağlayıcı bloğu, `TURN_FW_SELF_IPS`'e
IPv6 adresleri, `host-firewall.sh install`; (2) coturn IPv6 relay kapalı kalır (`relay-ip` yalnız IPv4) — `test-denied.sh` IPv6
bölümü 0 FAIL; (3) S-P2-5 IPv6 doğrulaması: IPv6 istemciden başarısız giriş → audit `ip_address` istemcinin IPv6'sı (nginx
`X-Forwarded-For` → Caddy trusted_proxies); (4) UFW IPv6 kuralları (`/etc/default/ufw IPV6=yes`) 3478/5349/relay ile aynı. Kayıt §8
yayın geçmişine benzer bir "değişiklik" satırı olarak yazılır.

### 20.8 Geri dönüş (yalnız §20.2/12 imzasından önce)

```bash
cd /opt/remote/deploy && docker compose down
docker volume rm remote_mysql_data remote_uploads remote_caddy_data remote_caddy_config remote_agent_downloads
cp -p /root/.env.staging-final.<TS> .env && grep -c '^DEPLOY_ENV=staging$' .env        # 1
docker compose up -d && docker compose ps                        # hepsi healthy (boş DB, migrate + seed: --profile setup run --rm seed)
# staging age anahtarı RAM'e (§18.4 B), sonra:
backup/restore.sh --identity /dev/shm/rb.key --allowed-signers /root/allowed_signers.staging-final \
  --target staging --confirm remote@develop --no-pre-backup /var/backups/remote-staging-final/<run>; shred -u /dev/shm/rb.key
#   restore-verify: OK   (yaş > 48 sa ise yalnız uyarı; staging'de ek onay yok)
```

- `--no-pre-backup`: boş DB'nin yedeği gereksizdir ve imza anahtarı artık prod'undur. Staging imza anahtarı terfide imha edildiği
  için geri dönüşten sonra yeni staging yedekleri için §18.9/1 anahtar üretimi tekrarlanır (`DEPLOY_ENV=staging`).
- TURN: `deploy/turn/.env` önceki hâli (staging realm/secret), `TURN_CERT_DIR` boş → `./gen-cert.sh 185.126.217.99` →
  `docker compose -p remote-turn up -d --force-recreate`; UFW: `ufw allow 4450/tcp` (relay aralığı geniş kalabilir).
- pfSense 4450 NAT henüz kaldırılmadığı için (P2 imzadan sonra) staging erişimi döner. `CADDY_BIND` staging-final'deki değerdir.
- **P13c kilitleri ve geri dönüş (2026-11-15):** dönülen yerleşim P13c öncesi staging'dir (`/opt/remote`, proje `remote`,
  `DEPLOY_ENV=staging`). (a) **Yedek yolları:** değişiklik GEREKMEZ. Yol koruması (S13C-2) yalnız aynı sunucudaki ikinci
  yığında çalışır (compose projesi `remote` değil ya da birim `remote-backup@<örnek>`); tek yığın staging (proje `remote`,
  şablonsuz `remote-backup.service`) prod varsayılan yollarıyla (`/var/backups/remote`, `/var/lib/remote-backup/status.prom`,
  `/etc/remote-backup/manifest_ed25519`) yedek almaya devam eder (S13C-13). Bugünkü sunucu da (§20 terfisi öncesi) böyledir.
  (b) **İstemci:** `remote_agent_downloads`
  silindiği için yeniden yayın gerekir. Release exe'sinde gömülü ad (`remote.noktabilisim.net`) geri dönüşte bu staging'i gösterir;
  tek yığın staging (proje `remote`) için kilit bayraksız yalnız Release kabul eder (S13C-13):
  `deploy/agent/verify-and-publish.sh --tag v<son Release> --ssh root@185.126.217.99` (attestation'lı). `--run`/`--stg-run`/`--dir`
  bu yerleşimde reddedilir (bugünkü sunucuda da, §20 terfisine kadar, aynı kural geçerlidir).

### 20.9 proxy-guard — 127.0.0.1:4451'e yerel bağlantı kısıtı (G-P13b-3; `deploy/ops/proxy-guard.sh`)

Sorun: host'tan yayımlanan 4451'e yapılan her yerel bağlantı Caddy'ye güvenilen 172.30.0.128'den görünür; VM'deki başka bir
sürecin sahte `X-Forwarded-For` ile IP limitlerini atlamasını ve audit IP'sini sahtelemesini engellemek için nftables
`meta skuid` kuralı: ayrı tablo `inet remote_proxy_guard`, `tcp dport 4451`, hedef `127.0.0.0/8`, `172.30.0.0/24`, `::1`, yeni
bağlantı, soket sahibi `root` ve `www-data` dışında → `reject with tcp reset` (sayaçlı). Uygulamaya ve Caddy'ye dokunmaz.
Ne zaman: prod'da nginx kurulduktan sonra, §20.2/9b'de (staging'de de önerilir).

```bash
apt-get install -y nftables          # yalnız nft aracı; nftables.service'i etkinleştirmek GEREKMEZ
nft --version                        # nftables v1.0.x
ps -o user= -C nginx | sort -u       # root + www-data (işçi kullanıcısı). Farklıysa: /etc/default/remote-proxy-guard
                                     #   PROXY_GUARD_USERS="root <kullanıcı>" (install sonrası, dosya root 0644)
cd /opt/remote/deploy/ops && ./proxy-guard.sh install
#   kurulu kopya /usr/local/sbin/remote-proxy-guard (root 0755), /etc/default/remote-proxy-guard (root 0644),
#   remote-proxy-guard.service (açılışta) + .timer (5 dk'da bir ensure) etkin
remote-proxy-guard check             # OK (tablo yerinde, kural sayısı doğru)
remote-proxy-guard verify            # verify OK: root bağlandı, 'nobody' reddedildi
curl -sI https://remote.noktabilisim.net/login | head -1              # HTTP/2 200  (nginx → 4451 yolu çalışıyor)
nft list table inet remote_proxy_guard | grep -c reject               # ≥ 1 (sayaç: … packets N)
systemctl is-active remote-proxy-guard.timer                          # active
```

- **www-data riski (kalan, gerekçeli):** `www-data` olarak çalışan **başka** süreçler (paylaşımlı sunucuda php-fpm havuzları,
  diğer sitelerin CGI'ları) hâlâ 4451'e bağlanıp XFF sahteleyebilir. `remote-proxy-guard check` bunları
  `UYARI: www-data ile nginx dışı süreç …` olarak yazar; her kurulumda ve sunucuya yeni site eklendiğinde bakılır. Kapatma yolu:
  nginx'i ya da php-fpm havuzlarını ayrı kullanıcıya almak ve `PROXY_GUARD_USERS`'ı daraltmak (sunucu sahibiyle).
- Kural silinir/bozulursa: `check` rc 1, timer 5 dk içinde `ensure` ile onarır; `remote-watch` ve journal
  (`journalctl -u remote-proxy-guard -n 20`) izlenir. `nft -f` tek işlemdir: hatalı yapılandırmada mevcut tablo değişmez.
- Birim sırası (S-P13b-12): `remote-proxy-guard.service` `Before=docker.service`, `After=network-pre.target nftables.service`,
  `WantedBy=multi-user.target nftables.service` → açılışta Docker 4451'i yayımlamadan önce kural kurulur; nftables.service
  (yeniden) başlatılınca birim de ardından çalışıp tabloyu yeniden kurar. Kontrol: `systemctl show -p Before,WantedBy remote-proxy-guard.service`.
  **Kalan pencere:** `systemctl stop nftables` (ya da elle `nft flush ruleset`) tabloyu siler; timer **en geç 5 dk** içinde `ensure`
  ile onarır. nftables'ı durdurmanız gerekirse hemen ardından `remote-proxy-guard ensure && remote-proxy-guard check` çalıştırın.
  Birim değişikliğinden sonra `./proxy-guard.sh install` yeniden çalıştırılır (enable'ı kendisi yapar).
- **docker grubu:** kural uid'e bakar; `docker` grubundaki her kullanıcı root eşdeğeridir (docker.sock ile `--privileged`, host
  bağlama, `--network host --user 0`) ve proxy-guard'ı, imza anahtarının ve `backup.env`'in root 600 korumasını aşar. Prod'da grup
  **boş** tutulur: `getent group docker` → `docker:x:<gid>:` (üye yok); yönetim `sudo` ile (§20.3 madde 13b).
- Geri alma: `remote-proxy-guard uninstall` → `nft list table inet remote_proxy_guard` "No such file or directory".
- Test (yerel, sunucuda değil): `deploy/ops/test-proxy-guard.sh` → 34/34 PASS.

### 20.10 Açık işler (prod sonrası, sahibi devops)

| #   | İş                                                                                                                                                                                                                                                                                                                                                        | Not                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Y1  | ~~G-P13b-3~~ → **kurulum adımı oldu** (§20.9 proxy-guard). Kalan: www-data ile çalışan nginx dışı süreçler (§20.9 uyarısı)                                                                                                                                                                                                                                | `check` UYARI satırları izlenir                                                                              |
| Y2  | **Sonra** — G-P13b-13 / S-P13b-4 yedek tarafı: `remote-backup.service` hâlâ git ağacındaki `/opt/remote/deploy/backup/backup.sh`'i çalıştırıyor, kurulu kopyadan (`/usr/local/lib/remote/`) çalışmıyor. Geçişte `backup.sh`, `restore.sh`, `lib*.sh` ve `../mysql/*.sql` birlikte kurulmalı; `sql_dir` yolu ve restore'un `backup.sh` çağrısı uyarlanmalı | O zamana kadar `remote-watch` `tree-perms` (root dışı sahip, o+w, root dışı gruba yazılabilir) ağacı izliyor |
| Y3  | G-P13b-10: `reset-superadmin` sarmalayıcı host betiği (rc 0 → alarm kanalına parola içermeyen bildirim)                                                                                                                                                                                                                                                   | §20.6 son madde elle yapılır                                                                                 |
| Y4  | Site dışı hedef seçimi (K-P13b-4) → §18.9/4                                                                                                                                                                                                                                                                                                               | `remote-watch` hatırlatması kendiliğinden susar                                                              |

## 21. P13c — ayrı staging kurulumu (`remote-stg`; mimari-e11 §3, ADR-0019 m.5, ADR-0021) — TASLAK

> **Durum: BEKLİYOR — kurulum yapılmadı.** Ön koşullar: (1) kullanıcı Cloudflare'de `stg.remote.noktabilisim.net` A kaydını
> açar (**DNS only**, gri bulut; proxy açık olursa LE HTTP-01 ve WebSocket bozulur); (2) §20 prod terfisi imzalı. Kod/yapılandırma
> kısmı (C1, C2, C4) hazır ve yerelde denendi (`docs/implementation.md` "P13c — devops (kod kısmı)"). Kurulum yapılınca bu
> bölüm "taslak"tan çıkarılır, ölçümler ve komut çıktıları yazılır.

### 21.1 Yerleşim (prod ile yan yana, aynı sunucu)

| Öğe                  | Prod                                                     | Staging                                                                                                                                                                                                                                                          |
| -------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ağaç / deploy dizini | `/opt/remote` · `/opt/remote/deploy`                     | `/opt/remote-stg` · `/opt/remote-stg/deploy` (ayrı `git clone`, root sahibi)                                                                                                                                                                                     |
| Compose projesi      | `remote` (compose `name:`)                               | `remote-stg` (`.env` `COMPOSE_PROJECT_NAME`) → volume/ağ/konteyner `remote-stg_*`, `remote-stg-mysql-1`                                                                                                                                                          |
| Compose dosyaları    | `docker-compose.yml`                                     | `COMPOSE_FILE=docker-compose.yml:docker-compose.staging.yml` (Caddy `CADDY_TRUSTED_PROXIES` + `ROBOTS_NOINDEX=1`)                                                                                                                                                |
| Caddy host portları  | `127.0.0.1:4451` (nginx), `127.0.0.1:4450` (tanı)        | `127.0.0.1:4461`, `127.0.0.1:4460` (`CADDY_HTTP_PORT`, `CADDY_TLS_PORT`, `CADDY_BIND=127.0.0.1`)                                                                                                                                                                 |
| edge ağı             | `172.30.0.0/24`, aralık `.128/25`, caddy `.2`, web `.3`  | `EDGE_SUBNET=172.30.1.0/24`, `EDGE_IP_RANGE=172.30.1.128/25`, `EDGE_CADDY_IP=172.30.1.2`, `EDGE_WEB_IP=172.30.1.3`                                                                                                                                               |
| Güvenilen proxy      | server `172.30.0.2/31`, Caddy 4451 `172.30.0.128/32`     | `EDGE_TRUSTED_PROXY_CIDR=172.30.1.2/31`, `CADDY_TRUSTED_PROXIES=172.30.1.128/32`                                                                                                                                                                                 |
| `DEPLOY_ENV`         | `production`                                             | `staging`                                                                                                                                                                                                                                                        |
| Sırlar               | prod kasası                                              | **hepsi yeni üretilir** (MySQL parolaları, `SESSION_REF_KEY`, `EDGE_PROXY_SECRET`, `APP_ENCRYPTION_KEYS`, `METRICS_TOKEN`, `TURN_SECRET` kullanılmaz)                                                                                                            |
| TURN                 | prod coturn                                              | `TURN_URLS=stun:remote.noktabilisim.net:3478` (kimliksiz STUN). `TURN_SECRET` compose'da zorunlu olduğu için **staging'e özgü rastgele** değer verilir (prod coturn'ünkiyle aynı OLMAZ → staging relay kimliği üretemez)                                         |
| Yedek                | `remote-backup.timer` 02:00, `/var/backups/remote`, 14 g | `remote-backup@stg.timer` 03:30, `/var/backups/remote-stg`, **ayrı age çifti + ayrı imza anahtarı**, 3 g                                                                                                                                                         |
| İzleme               | `remote-watch.timer`                                     | `remote-watch@stg.timer` (`/etc/remote-watch/stg.env`; alarm metni `remote-watch[stg]`)                                                                                                                                                                          |
| İmajlar              | `remote-server:<IMAGE_TAG>`                              | **aynı ad** (compose `image:`). Etiket = commit kısa SHA olduğundan aynı etiket aynı kaynaktır; staging'de prod'un çalıştırdığı etiketle _farklı kaynaktan_ build ALINMAZ. `docker image prune` iki yığın ayaktayken çalıştırılabilir (kullanılan imaj silinmez) |

Değişkenlerin anlamı `.env.example` "P13c ikinci yığın" bölümünde; prod `.env`'e **hiçbiri eklenmez** (varsayılanlar prod
değerleri; `COMPOSE_FILE=` gibi **boş** bir satır compose'u durdurur — prod'da satır hiç olmaz).

### 21.2 Kaynak ölçümü (kurulumdan ÖNCE ve SONRA; kabul: disk < %80, boş RAM ≥ 1 GB)

```sh
free -m; df -h / /var/lib/docker /var/backups; docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' | sort
```

Önce/sonra değerleri buraya yazılır (tarih, `free -m` "available", `df` Use%). Eşik aşılırsa staging MySQL sınırlanır:
`docker-compose.staging.yml`'e `mysql: { command: ["--default-time-zone=+00:00", "--log-bin-trust-function-creators=1",
"--innodb-buffer-pool-size=256M"] }` (ana dosyadaki iki bayrak **aynen** tekrarlanır; liste birleşmez, değiştirilir).

### 21.3 Kurulum adımları (root; her adım komut → beklenen)

1. **DNS (kullanıcı):** `dig +short stg.remote.noktabilisim.net` → `185.126.217.99`.
2. **Ağaç:** `git clone <repo> /opt/remote-stg && chown -R root:root /opt/remote-stg && chmod -R go-w /opt/remote-stg`;
   `git -C /opt/remote-stg checkout <prod ile aynı ya da test edilecek commit>`.
3. **`.env`:** `cd /opt/remote-stg/deploy && cp ../.env.example .env && chmod 600 .env`; doldur: §21.1 staging sütunu +
   `COMPOSE_PROJECT_NAME=remote-stg`, `COMPOSE_FILE=docker-compose.yml:docker-compose.staging.yml`, `DEPLOY_ENV=staging`,
   `PUBLIC_BASE_URL=https://stg.remote.noktabilisim.net`, `SITE_HOST=stg.remote.noktabilisim.net`, `CADDY_BIND=127.0.0.1`,
   yeni sırlar (`openssl rand …`, §3), `IMAGE_TAG=$(git rev-parse --short HEAD)`, `MIN_AGENT_VERSION=` boş (staging exe sürümü
   §21.5), `WHATSAPP_SERVICE_URL=` boş. Kontrol:
   `docker compose config | grep -E '^name:|published:|ipv4_address|subnet|ip_range|TRUSTED_PROXY_CIDR|CADDY_TRUSTED_PROXIES|ROBOTS_NOINDEX'`
   → `name: remote-stg`, `4460`/`4461`, `172.30.1.*`, `ROBOTS_NOINDEX: "1"`. Prod'da aynı komut `name: remote`, `4450/4451`,
   `172.30.0.*` göstermeli ve ROBOTS satırı **olmamalı**.
4. **Ayağa kaldır:** `docker compose build && docker compose up -d && docker compose --profile setup run --rm seed`
   → `docker compose ps` dört servis healthy; `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4461/login` → 200.
   Prod kesintisiz (adım boyunca): `curl -s -o /dev/null -w "%{http_code}\n" https://remote.noktabilisim.net/login` → 200 (`/ready` dışarıya kapalı).
5. **nginx vhost:** `deploy/nginx/remote.noktabilisim.net.conf` kopyalanır → `/etc/nginx/sites-available/stg.remote.noktabilisim.net.conf`;
   `server_name stg.remote.noktabilisim.net;`, `proxy_pass http://127.0.0.1:4461;`, sertifika yolları `…/live/stg.remote.noktabilisim.net/`.
   Önce yalnız 80 + ACME bloğu ile: `nginx -t && systemctl reload nginx`;
   `certbot certonly --webroot -w <acme kökü> -d stg.remote.noktabilisim.net` (prod ile aynı yöntem, §8.3) → 443 bloğu açılır,
   `nginx -t && systemctl reload nginx`. Beklenen: `curl -sI https://stg.remote.noktabilisim.net/login` → 200 +
   `x-robots-tag: noindex, nofollow`; `curl -s https://stg.remote.noktabilisim.net/robots.txt` → `Disallow: /`;
   `curl -sI https://remote.noktabilisim.net/login | grep -ci x-robots-tag` → **0** (prod etkilenmedi).
6. **proxy-guard (4461 de korunmalı):** `cd /opt/remote/deploy/ops && PROXY_GUARD_PORT=4451,4461
PROXY_GUARD_DST4=127.0.0.0/8,172.30.0.0/24,172.30.1.0/24 ./proxy-guard.sh install && remote-proxy-guard verify`
   → `verify OK … (tcp/4451,4461)`. (Prod ağacındaki kopya kurulur; tek tablo iki portu korur.)
7. **Yedek (ayrı anahtarlar):** kullanıcı **yeni** age çifti üretir (özel anahtar kasaya, sunucuya değil; §18.1).
   `install -d -m 700 /etc/remote-backup-stg && ssh-keygen -t ed25519 -N '' -C remote-backup-stg@$(hostname -s) -f /etc/remote-backup-stg/manifest_ed25519`;
   `/etc/remote-backup-stg/allowed_signers` (644). `/opt/remote-stg/deploy/backup/backup.env` (root 600): `BACKUP_DIR=/var/backups/remote-stg`,
   `BACKUP_AGE_RECIPIENT=<stg age1…>`, `BACKUP_KEEP_DAYS=3`, `BACKUP_SIGNING_KEY=/etc/remote-backup-stg/manifest_ed25519`,
   `BACKUP_STATUS_FILE=/var/lib/remote-backup-stg/status.prom`, `BACKUP_ALERT_CMD` (§18.3; metinde `stg` geçsin). Bu üç yol
   `remote-backup@.service` / `remote-backup-failed@.service` içinde `Environment=` ile **zorlanır** (S13C-2; `backup.env` farklı
   yazsa da birim değeri geçerlidir); `backup.sh` ikinci yığında (proje `remote` dışı ya da şablon örneği) prod varsayılan
   yollarını görürse status yazmadan durur. Tek yığın (proje `remote`) bu korumadan etkilenmez (S13C-13). Backup kullanıcısı
   `.env` `MYSQL_BACKUP_PASSWORD` ile ilk açılışta oluşur. Birimler:
   `cp /opt/remote-stg/deploy/backup/remote-backup@.service /opt/remote-stg/deploy/backup/remote-backup@.timer /opt/remote-stg/deploy/backup/remote-backup-failed@.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now remote-backup@stg.timer`;
   ilk koşu `systemctl start remote-backup@stg.service && journalctl -u remote-backup@stg -n 5` → `remote-backup: OK`, manifest `env staging`.
8. **İzleme:** `/opt/remote/deploy/ops/remote-watch.sh install stg` (**prod ağacından**, S13C-5: kurulu kopya
   `/usr/local/lib/remote/remote-watch.sh` iki örnekte ortaktır; staging ağacından kurulursa denetlenmemiş staging commit'i root
   olarak prod izlemesini de değiştirir. Staging dalındaki watch değişikliği önce prod ağacına terfi eder.) →
   `/etc/remote-watch/stg.env` (600) doldurulur:
   `WATCH_PUBLIC_HOST=stg.remote.noktabilisim.net`, `WATCH_ALERT_CMD` (prod ile aynı kanal; mesaj `remote-watch[stg] …`).
   Diğerleri örnek adından türer (proje `remote-stg`, yedek `/var/lib/remote-backup-stg/status.prom`, zamanlayıcı
   `remote-backup@stg.timer`, coturn kontrolü yok — prod örneği izler). `systemctl start remote-watch@stg.service &&
journalctl -u remote-watch@stg -n 3` → `remote-watch-stg: OK (<n> kontrol)`. Prod örneği `@` birimlerini saymaz.
9. **Geri yükleme provası (haftalık, staging'de):** `RESTORE_EXPECT_PROJECT=remote-stg /opt/remote-stg/deploy/backup/restore.sh
--identity <stg age anahtarı> --allowed-signers /etc/remote-backup-stg/allowed_signers --target staging
--confirm <db>@$(hostname -s) /var/backups/remote-stg/<run>` → `restore-verify: OK`. Ortam kilidi: staging yedeği prod
   dizininde (`--target staging` ya da `production`) ve prod yedeği staging dizininde **reddedilir** (yerel test
   `deploy/backup/test-backup.sh` bölüm H). İmza anahtarları ayrı olduğundan prod `allowed_signers` staging yedeğini zaten kabul etmez.
10. **İstemci (C4):** GitHub Actions → agent-win → Run workflow (dal **main**), `server_url = https://stg.remote.noktabilisim.net`,
    `version = x.y.z` → artifact `agent-win-stg` (`NoktaDestek-stg-<sürüm>.exe`, attestation), **Release yok**. Yayın:
    `deploy/agent/verify-and-publish.sh --stg-run <run-id> --ssh root@185.126.217.99` (hedef vars. `/opt/remote-stg/deploy`;
    koşu main + workflow_dispatch + success + build-meta adresi staging olmalı; `gh attestation verify --source-ref refs/heads/main`).
    Betik ortam kilidi: `stg-` etiketli exe yalnız `DEPLOY_ENV=staging` hedefe; `DEPLOY_ENV=production` hedefe yalnız `vX.Y.Z`
    Release; staging hedefe Release/main push exe'si (prod adresi gömülü) yazılmaz.
11. **Duman testi (C5, test-operatoru):** login, oturum, tarayıcı modu STUN ile aynı ağda görüntü; konsol hatası 0.
12. **C6 (kullanıcı):** proje `CLAUDE.md` staging satırı `stg.remote.noktabilisim.net`.

### 21.4 Yayın akışı (P13c sonrası)

Staging yayını = `/opt/remote-stg`'de `git pull` → `IMAGE_TAG` → `docker compose build && docker compose up -d` (§8 aynı adımlar,
`cd /opt/remote-stg/deploy`). Prod'a terfi = §20 düzeltme yolu (aynı commit, imzalı Release). Rollback: staging'de önceki
`IMAGE_TAG`; prod etkilenmez.

### 21.5 Geri alma (staging'i tamamen kaldırmak)

`systemctl disable --now remote-watch@stg.timer remote-backup@stg.timer`; `cd /opt/remote-stg/deploy && docker compose down`
(volume'lar `-v` olmadan kalır; kalıcı silme bilinçli: `docker compose down -v`); nginx vhost silinir + `nginx -t && systemctl reload nginx`;
proxy-guard tek port: `PROXY_GUARD_PORT=4451 PROXY_GUARD_DST4=127.0.0.0/8,172.30.0.0/24 ./proxy-guard.sh install`;
`certbot delete --cert-name stg.remote.noktabilisim.net`. Prod'a dokunulmaz (ayrı proje adı, ağ, port, volume).

### 21.6 Sorun giderme

| Belirti                                                                        | Neden / çözüm                                                                                                                 |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `docker compose up` "Pool overlaps with other one on this address space"       | `EDGE_SUBNET` prod'la (172.30.0.0/24) çakışıyor → staging `.env` 172.30.1.0/24                                                |
| `compose file "" set by COMPOSE_FILE … is invalid`                             | `.env`'de boş `COMPOSE_FILE=` satırı → satırı silin (prod) ya da doldurun (staging)                                           |
| `required variable CADDY_TRUSTED_PROXIES is missing`                           | staging katmanı yüklü ama değer yok → `CADDY_TRUSTED_PROXIES=172.30.1.128/32`                                                 |
| Staging'de tüm istemciler aynı IP (ağ geçidi) görünüyor, giriş kilitleri ortak | `CADDY_TRUSTED_PROXIES` yanlış/katman yüklenmemiş → `docker compose config                                                    | grep CADDY_TRUSTED`; ağ geçidi `docker network inspect remote-stg_edge` |
| Staging yanıtında `x-robots-tag` yok                                           | `COMPOSE_FILE` staging katmanını içermiyor → §21.3/3 kontrolü; `docker compose up -d caddy`                                   |
| `verify-and-publish`: "staging exe … yalnız DEPLOY_ENV=staging"                | yanlış `--deploy-dir` (prod) → `--deploy-dir /opt/remote-stg/deploy` ya da varsayılan                                         |
| `restore.sh`: "compose projesi 'remote-stg', beklenen 'remote'"                | staging'de `RESTORE_EXPECT_PROJECT=remote-stg` verilmedi (bilinçli: varsayılan prod adı)                                      |
| `remote-backup@stg` "prod varsayılan yollarını kullanıyor"                     | birim dışından (elle) çalıştırıldı ya da şablon eski → `systemctl start remote-backup@stg` ya da üç yolu `backup.env`'e yazın |

## 22. P14a A5 — CI kabuk/iş akışı denetimi, kararlılık koşusu, kod denemesi ve MySQL testi alarmları (devops, 2026-11-15; AC-208, AC-212, AC-219)

### 22.1 CI ve kararlılık

| İş                                       | Ne yapar                                                                                                                                                                                                         | Yerelde aynı komut                                                                                                                                                                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml` → `shellcheck + actionlint`     | `deploy/**/*.sh` + `scripts/*.sh` shellcheck 0.11.0 (`-S warning`: uyarı/hata düşürür; info/style notları — bilinçli SC2016/SC2015 — düşürmez); `.github/workflows/*` actionlint 1.7.8. İmajlar digest ile sabit | `find deploy scripts -name '*.sh' -print0 \| sort -z \| xargs -0 docker run --rm -e LANG=C.UTF-8 -v "$PWD:/mnt:ro" -w /mnt koalaman/shellcheck:v0.11.0 -S warning` · `docker run --rm -v "$PWD:/repo:ro" -w /repo rhysd/actionlint:1.7.8` |
| `stability.yml` (elle + Pazartesi 02:17) | `scripts/repeat-tests.sh <n>`: entegrasyon (vitest) n ayrı süreç + Playwright `--repeat-each n --retries 0`; varsayılan n = 20; izin `contents: read`                                                            | `TEST_DATABASE_URL=… scripts/repeat-tests.sh 20 [int\|e2e\|all]` (çıkış 0 = hepsi yeşil; günlük yolu sonda)                                                                                                                               |

- Elle tetikleme: GitHub → Actions → `stability` → "Run workflow" (`runs` girdisi) ya da `gh workflow run stability.yml -f runs=20`.
  Sonuç (`SONUÇ: x/y yeşil` + düşen test adları) qa raporuna yazılır. Kararsız test **retry ile gizlenmez**: kök neden
  düzeltilir; düzelene kadar `docs/implementation.md` "Kararsız testler" listesine yazılır (AC-219: liste boş olmalı).
- Yeni `ci.yml` işi `shellcheck + actionlint` main dalı koruma kuralında "required status check" olarak eklenir (repo
  sahibi; Settings → Branches). `stability` zorunlu kontrol DEĞİLDİR (PR'da çalışmaz).
- CI `build` işi "compose yapılandırması geçerli" adımı `.env.example`'dan sahte bir `.env` üretir. Compose'a yeni
  **zorunlu** (`${X:?…}`) anahtar eklenirse bu adımdaki `sed` listesine CI'ya özgü sahte değer eklenir (sır değil);
  aksi hâlde adım "required variable X is missing a value" ile düşer (P10'da `APP_ENCRYPTION_KEYS` için olan buydu,
  P14a A5'te düzeltildi).

### 22.2 Alarm eşikleri (metrikler server `/metrics`, Bearer `METRICS_TOKEN`; A3 ile gelir)

| Kural                                                                            | Önem      | Anlamı / ilk müdahale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `increase(rs_guest_code_rate_limited_total{scope="prefix"}[15m]) >= 20` (AC-208) | **Uyarı** | Sayaç **kilitlenen kova başına bir** artar (kilitliyken yeniden denemeler sayılmaz; S14-6) → 15 dk'da ≥ 20 farklı önek kovasının kilitlenmesi = dağıtık kod numaralandırma/kaba kuvvet; tek istemci alarmı tetikleyemez. IP sınırı (`scope="ip"`) tek başına alarm değildir (pano). Müdahale: Caddy/nginx erişim logunda `/api/guest` 429'larının kaynak IP dağılımı (sorgu dizesi loglanmaz, G-10); tek kaynaksa host güvenlik duvarında geçici engel; dağıtıksa açık oturum kodlarının süresi kısa tutulur ve olay kaydı açılır |
| `increase(rs_mysql_test_failed_total[1h]) >= 10` (AC-212; tüm `class` toplamı)   | **Uyarı** | Super Admin MySQL "Bağlantıyı Test Et" ile port tarama / parola deneme sinyali (B-P11-4). Müdahale: audit `settings.mysql.test` kayıtlarından kim/hangi IP (§1 audit sorgusu); beklenmiyorsa hesabın oturumlarını kapat, parolayı/2FA'yı sıfırla; `class` dağılımı (`connect`/`auth`/`tls`/`timeout`) hedefi gösterir                                                                                                                                                                                                             |

**İzleme yöntemi.** Prometheus yokken iki kural `remote-watch` (§20.4, 10 dk) içinde uygulanır: her koşuda `/metrics`'ten
iki sayaç okunur (prefix serisi; mysql tüm `class` toplamı), `/var/lib/remote-watch[/<örnek>]/state`
`counter_samples=` satırında 90 dk örnek tutulur. Artış = pencereden eski en yeni örnekten bugüne ardışık farklar
(azalma = server yeniden başladı → yeni değer artış sayılır). Timer 10 dk olduğundan etkin pencere **en az** kural
penceresidir (15 dk → ~20 dk, 1 sa → ~70 dk; biraz daha hassas). Kontrol adları `guest-code-prefix` ve
`mysql-test-failed` (`remote_watch_check_ok{check=…}`), alarm kanalı diğer kontrollerle aynı (`WATCH_ALERT_CMD`).
Eşikler `watch.env`: `WATCH_GUEST_PREFIX_MAX` (20), `WATCH_MYSQL_FAIL_MAX` (10). Metrik henüz yoksa (A3 yayında değil)
kontrol değerlendirilmez, alarm üretmez; ilk koşuda taban olmadığından alarm yoktur.

Elle kontrol (sunucuda, server konteyneri içinden; token ekrana yazılmaz):

```bash
docker compose exec -T server node -e "fetch('http://127.0.0.1:3001/metrics',{headers:{authorization:'Bearer '+process.env.METRICS_TOKEN}}).then(r=>r.text()).then(t=>console.log(t.split('\n').filter(l=>/^rs_(guest_code_rate_limited|mysql_test_failed)_total/.test(l)).join('\n')))"
```

**Yayın (remote-watch güncellemesi):** `deploy/ops/remote-watch.sh install` (kurulu kopya yenilenir; `watch.env`
korunur; ikinci örnek için `install stg`). Doğrulama: `systemctl start remote-watch.service` →
`journalctl -t remote-watch -n 5` "OK (<n> kontrol)", `status.prom`'da `check="guest-code-prefix"` ve
`check="mysql-test-failed"` satırları. **Geri alma:** önceki commit'teki `remote-watch.sh` ile `install` yeniden
çalıştırılır (`counter_samples` satırını eski sürüm yok sayar). Yerel test: `deploy/ops/test-watch.sh`
(alarm/eşik/pencere/yeniden başlama/metrik yok senaryoları dahil).

### 22.3 coturn bant testi (CI `turn` işi)

`deploy/turn/test-local.sh` 2 allocation ölçümü `-n 3000`'den `-n 8000`'e çıkarıldı (e433a05'te CI'da bir kez
997200 B/s: iki allocation sırayla açılınca örtüşen tam saniye 1-2 kalıyor, medyan tek akışa düşüyordu). Eşik
değişmedi, retry yok; düşerse teklif ve saniyelik seri yazılır (teklif < 2,2 MB/s ise ölçüm, değilse tavan sorunu).

## 23. P16 — kalıcı silme operasyonu (devops, 2026-11-15; mimari-e11 §7.7, ADR-0030 r2; AC-240..244, S16-5/11/12/13)

Kapsam: gece kalıcı silme (`RETENTION_PURGE_MODE`), firma silme işi (24 saat iptal penceresi), kullanıcı mezar taşı,
yetim dosya taraması, imha defteri (`remote_ledger`), yedek ve geri yükleme etkisi. Kod: G2–G5 (server), G3 `cli erasure:*`.

### 23.0 P16 staging yayını — ön adımlar (migration'dan ÖNCE)

| #   | Komut (sunucu, root)                                                                                                            | Beklenen                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `grep -n '^BACKUP_EXPECTED_TRIGGERS=' /opt/remote/deploy/backup/backup.env`                                                     | Satır boş (`BACKUP_EXPECTED_TRIGGERS=`) ya da `=22`. **`=3` yazılıysa migration'dan önce** `sed -i 's/^BACKUP_EXPECTED_TRIGGERS=.*/BACKUP_EXPECTED_TRIGGERS=/' backup.env` (boş = 22). Aksi hâlde ilk gece yedeği `FAILED adım=tetikleyici … beklenen 3` olur (S16-11). İkinci yığın: `/opt/remote-stg/deploy/backup/backup.env` de |
| 2   | `stat -c '%U %a' backup.env`                                                                                                    | `root 600` (değişiklikten sonra da)                                                                                                                                                                                                                                                                                                 |
| 3   | `grep -c '^RETENTION_PURGE_MODE=' /opt/remote/deploy/.env`                                                                      | 0 ya da 1. Yoksa ekleyin: staging `RETENTION_PURGE_MODE=on`; prod ilk hafta boş (= `dry`), §23.1                                                                                                                                                                                                                                    |
| 4   | Her zamanki yayın (§8): ön yedek → `git pull` → `docker compose build` → `up -d` (migrate `20261118000000_p16_hard_delete`)     | migrate OK; `docker volume ls \| grep _ledger` → `remote_ledger` (staging ikinci yığında `remote-stg_ledger`)                                                                                                                                                                                                                       |
| 5   | `docker compose exec -T server sh -c 'ls -ld /var/lib/remote'`                                                                  | `drwx------ node node` (imajdan; boş volume ilk bağlamada kopyalanır)                                                                                                                                                                                                                                                               |
| 6   | `deploy/mysql/check-app-grants.sh` (§15.1 yöntemi)                                                                              | 501/501 PASS, tetikleyici 22                                                                                                                                                                                                                                                                                                        |
| 7   | `systemctl start remote-backup.service; journalctl -u remote-backup -n 30 --no-pager \| grep -E 'imha-defteri\|OK run\|FAILED'` | `imha-defteri: ilk satır=0 …` + `remote-backup: OK … tetikleyici=22`. **G7 kabulü: migration sonrası ilk gece yedeği PASS** (ertesi sabah aynı grep, `imha-defteri: ok`)                                                                                                                                                            |
| 8   | `cd /opt/remote/deploy/ops && ./remote-watch.sh install` (P16 server ayaktayken; önce değil)                                    | `systemctl start remote-watch.service` → `OK (<n> kontrol)`; `status.prom`'da `check="purge-scheduled"`, `"ledger-backup"`. P16 öncesi server'da `p16-metrics` alarmı verir (bilinçli, fail-closed)                                                                                                                                 |

Geri alma (P16): imaj önceki `IMAGE_TAG` + `down.sql` (koşullu; DELETED kullanıcı ya da iş satırı varsa 3819 ile durur,
db-notlari "P16"). `remote_ledger` volume'u **silinmez**. Silinmiş veri geri gelmez (R26). Geri almada `backup.env`
`BACKUP_EXPECTED_TRIGGERS=3` yazılır (down sonrası 3 tetikleyici); P16 yeniden açılınca boşaltılır.

### 23.1 Ortam ve yerleşim

| Öğe                    | Değer                                                                                                                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RETENTION_PURGE_MODE` | `deploy/.env` → compose `server` → `env.ts` (`dry\|on`, boş = `dry`). `dry`: aday sayıları `retention.run` audit'inde `purgeCandidates.*`, hiçbir satır silinmez. `on`: siler (`purged*`). Prod: ilk hafta `dry`, sayılar incelendikten sonra `on` + `up -d server` |
| İmha defteri           | volume `ledger` (ad `remote_ledger`) → server `/var/lib/remote/erasure-ledger.jsonl` (node 0600, yalnız eklenir); migrate servisi salt okunur bağlar (`cli erasure:*`). Env yok, yol sabit. **Volume silinmez, `docker compose down -v` yasak**                     |
| Satır biçimi           | `{v:1, type:"tenant"\|"user", id, jobId?, phase?, at}` — kişisel veri yok                                                                                                                                                                                           |
| Yedek                  | `backup.sh` defteri ayrı şifreli dosya olarak yedek setine (`erasure-ledger.jsonl.age`) ve manifest `ledger` bölümüne ekler; site dışı kanca onu da kopyalar. DB dökümüne girmez                                                                                    |

Kontrol: `docker compose exec -T server sh -c 'wc -l < /var/lib/remote/erasure-ledger.jsonl 2>/dev/null || echo 0'`.

### 23.2 Firma silme akışı (Super Admin; kılavuz G8)

1. **Önizleme:** Firma pasif ≥ 30 gün → `admin/tenants/<id>` "Kalıcı sil" → sayılar, dosya, "audit 730 gün saklanır".
2. **Zamanlama:** ad yazma + step-up → iş `SCHEDULED`, `scheduled_for` = DB saati + 24 sa. Audit `tenant.purge_scheduled`;
   bütün Super Admin panellerinde bant; `remote-watch` `ALERT purge-scheduled` **her 10 dk turunda** yeniden gönderilir (S16-12).
3. **İptal penceresi (24 sa):** panelden "İptal et" (step-up) → `CANCELLED`, audit `tenant.purge_cancelled`; sonraki turda
   `DUZELDI purge-scheduled`. Beklenmeyen bir alarm = olası ele geçirilmiş Super Admin → önce iptal, sonra §19 olay müdahalesi.
4. **İlerleme:** süre dolunca `RUNNING`; adım çubuğu (3 sn yoklama). Metrik `rs_tenant_purge_jobs{state}`,
   `rs_tenant_purge_rows_total{table}`, heartbeat. Bitince `DONE`, audit `tenant.purged`, defter satırı.

### 23.3 FAILED işi sürdürme

`ALERT purge-failed` → panelde iş kartı `lastError` (`db_fk|db_signal|fs|invalid_job|other`):

| `lastError`   | Ne yapılır                                                                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fs`          | `docker compose exec -T server sh -c 'ls -ld /data/uploads/<firmaId>'` (izin/disk; §19.9) → düzeltilince panelde "Sürdür" (yeni önizleme + step-up)                           |
| `db_fk`       | Yeni bir FK adım listesinde yok (meta-test kaçırdı) → dba + backend; düzeltme yayınlanana kadar iş FAILED kalır (firma yeniden etkinleştirilemez, bilinçli)                   |
| `db_signal`   | Tetikleyici reddi (ör. saat kayması > 1 dk): `docker compose exec mysql date -u` ile host saati karşılaştırılır (NTP) → Sürdür                                                |
| `invalid_job` | Uygunluk yeniden doğrulaması başarısız (firma aktif/`passive_at` < 30 g, ya da elle eklenmiş satır). **Sürdürmeyin**; audit + `tenant_purge_jobs` satırı incelenir (§19 olay) |

`ALERT purge-heartbeat` (RUNNING, heartbeat > 30 dk): server yeniden başladıysa iş bir sonraki turda yeniden alınır;
`docker compose logs server --since 1h | grep -i purge`. Sürerse `docker compose restart server`.

### 23.4 Alarmlar (`remote-watch`, 10 dk; eşikler `deploy/ops/remote-watch.sh`)

| check             | Kaynak                                                                                   | Eşik / davranış                                                                           | Seviye / eylem                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `purge-scheduled` | `rs_tenant_purge_jobs{…="SCHEDULED"}`                                                    | > 0; durum sürdükçe her tur yeniden (`WATCH_PURGE_REPEAT_MIN`, vars. 0 = her tur)         | Kritik — bekleniyor mu? §23.2/3                                                                          |
| `purge-failed`    | `rs_tenant_purge_jobs{…="FAILED"}`                                                       | > 0                                                                                       | Kritik — §23.3                                                                                           |
| `purge-heartbeat` | `rs_tenant_purge_jobs{…="RUNNING"}` + `rs_tenant_purge_last_heartbeat_seconds`           | RUNNING > 0 ve heartbeat > 30 dk (değer > 1e9 ise epoch, değilse yaş sn) ya da metrik yok | Uyarı — §23.3                                                                                            |
| `orphan-circuit`  | `rs_orphan_scan_circuit_open_total` ya da `rs_orphan_files_total{action="circuit_open"}` | artıştan sonra 24 sa                                                                      | Uyarı — referans kümesi boş/%20 üstü: DB/uploads uyuşmazlığı (yanlış volume?) incelenir; silme yapılmadı |
| `orphan-scan`     | `rs_orphan_scan_last_success_timestamp_seconds`                                          | süreç ≥ 8 g açık ve son başarı ≥ 8 g önce/yok                                             | Uyarı — `docker compose logs server \| grep orphan`                                                      |
| `ledger-write`    | `rs_erasure_ledger_write_failed_total`                                                   | > 0 ya da artıştan sonra 24 sa                                                            | Kritik — §23.6 (eksik satır elle eklenir)                                                                |
| `ledger-backup`   | `status.prom` `remote_backup_ledger_ok`                                                  | ≠ 1                                                                                       | Kritik — §23.6                                                                                           |
| `retention`       | `rs_retention_failures_total` (bütün `class` serileri toplanır; `db_signal` dahil)       | son 24 sa artış                                                                           | Uyarı — §19.8                                                                                            |
| `p16-metrics`     | yukarıdaki seriler                                                                       | `rs_tenant_purge_jobs` ya da defter sayacı yok                                            | Uyarı — P16 öncesi server: `WATCH_PURGE_CHECKS=0`                                                        |

Server logu (G2/G5; Loki yok, elle): `docker compose logs server --since 24h | grep -E '"alarm":"(retention_db_signal|orphan_scan_circuit_open)"'`
— `retention_db_signal` gece silmesinde tetikleyici reddi (saat kayması/fikstür; §23.3 `db_signal`), `orphan_scan_circuit_open`
devre kesici (silme yapılmadı). İkisi de yukarıdaki metrik alarmlarıyla aynı olaydır.

**Prod ön koşulu (S16-12; G7 kabulü):** `WATCH_ALERT_CMD` (Telegram, §20.4) kurulmadan prod'da firma silme **açılmaz**.
Staging provası: test firması (pasif ≥ 30 g; migrator fikstürüyle `passive_at` geri alınabilir) için iş zamanlanır →
**≤ 10 dk içinde** dış kanalda `ALERT purge-scheduled` → 10 dk sonra yeniden → panelden iptal → `DUZELDI`. Sonuç §8 dağıtım
kaydına yazılır.

### 23.5 Geri yükleme sonrası zorunlu: `erasure:replay` + `erasure:verify` (S16-5, ADR-0030 m.9)

DB yedeği silinmiş firmaları/kullanıcıları geri getirir; defter getirmez. `restore.sh --target staging|production` bunu
otomatik yapar (sıra: yükleme → CHECKSUM → audit taban çizgisi → **defter uzlaştırma → `erasure:replay` (server DURURKEN)** →
`up -d` → `/ready` → **`erasure:verify` (firma işleri bitene kadar, `RESTORE_ERASURE_TIMEOUT` vars. 1800 sn,
`RESTORE_ERASURE_POLL` vars. 30)**). Beklenen çıktı satırları:

```
CHECK OK    erasure-ledger.jsonl.age sha256 …        (scratch)
INFO        imha defteri: N satır (firma a, kullanıcı b) · geri yüklenen DB'de henüz silinmemiş: firma x, kullanıcı y
… imha defteri: canlı defter yedektekini kapsıyor (… bayt) — korunuyor     | ya da: canlı defter boş/yok — yedekteki kopya … yazılıyor
CHECK OK    erasure:replay  0
CHECK OK    /ready          200
CHECK OK    erasure:verify  0
restore-verify: OK
```

- **Defter uzlaştırma:** canlı defter yedektekini ön ek olarak içeriyorsa canlı korunur; canlı boş/yoksa (yeni sunucu,
  volume kaybı) yedek kopyası `remote_ledger`'a yazılır (node 600). **Başka her durumda** restore durur, server durdurulmuş
  kalır: iki defter `diff` ile karşılaştırılır (`age -d` ile yedek kopya, `docker compose run --rm --no-deps -T migrate cat
/var/lib/remote/erasure-ledger.jsonl` ile canlı), iki kümenin birleşimi (satır tekrarı zararsız) volume'a yazılır ve restore
  `--no-pre-backup` ile yeniden çalıştırılır. Karar §8 kaydına yazılır.
- **`erasure:replay` başarısızsa** server BAŞLATILMAZ (silinmiş veri sunulmaz). Elle: `cd /opt/remote/deploy && docker compose
run --rm --no-deps -T migrate pnpm --filter @remote/server cli erasure:replay` → hata giderilince `docker compose up -d` →
  `… cli erasure:verify` rc 0 olana kadar.
- **`erasure:replay` rc 3 — tutarsız defter satırı reddedildi (S16-16, kurcalama şüphesi).** Çıktı:
  `erasure:replay … reddedilen_kullanici=<n> reddedilen_firma=<m>` + `CHECK FAIL  erasure:replay` + "tutarsız defter satırı
  REDDETTİ". Defterdeki bir satır geri yüklenen DB ile uyuşmuyor: firma PASSIVE değil ya da hem `passive_at` 16 günden
  yeni hem `tenant_purge_jobs` kaydı yok; ya da kullanıcı Super Admin / firmasız. Meşru silmede bu olmaz (30 g pasiflik,
  yedek ≤ 14 g); defteri yazan server süreci ele geçirilip satır eklenmiş olabilir. Meşru satırlar UYGULANMIŞTIR,
  reddedilenler uygulanmamıştır; server durdurulmuş kalır. **Elle karar (iki kişi, §8 kaydı):**
  1. Reddedilen kimlikleri bul: `docker compose run --rm --no-deps -T migrate cat /var/lib/remote/erasure-ledger.jsonl`
     satırlarını geri yüklenen DB ile karşılaştır (`SELECT id, status, passive_at FROM tenants WHERE id IN (…)`,
     `SELECT id, role, tenant_id, status FROM users WHERE id IN (…)`; çıktıyı bilete kişisel veri olmadan yaz).
  2. Satırın audit karşılığını ara (`user.deleted` / `tenant.purge_scheduled|started|purged`, aynı kimlik). **Karşılığı
     yoksa** kurcalama kabul edilir: olay kaydı (§19), server imajı/konteyneri yeniden kurulur, sırlar döndürülür; sonra
     `docker compose up -d` (replay reddedilen satırı hiçbir zaman uygulamaz; verify onları bekleyen saymaz, ayrı yazar).
     **Karşılığı varsa** (beklenmeyen meşru durum) mimar + güvenlik incelemesi olmadan elle silme YAPILMAZ.
  3. Sonraki her geri yüklemede aynı satırlar yine rc 3 verir; karar kaydı bu adımda referans gösterilir.
- **Elle (restore.sh dışı) DB yükleme yapıldıysa** aynı iki komut zorunludur; çalıştırılmadan server açılmaz.
- CLI sözleşmesi (G3): migrate imajında `MIGRATE_DATABASE_URL` ile; defter `/var/lib/remote/erasure-ledger.jsonl` (salt okunur);
  replay mezar taşını yeniden uygular, firmalar için RUNNING iş açar, audit `erasure.replayed` (sayılar) yazar; verify
  defterdeki uygun kimlikler silinmiş/mezar taşı ise rc 0, değilse 1 (reddedilenler `reddedilen_*` olarak ayrı yazılır,
  bekleyen sayılmaz). Replay çıkışı: 0 · 2 kullanım · 3 tutarsız satır reddedildi · 5 DB/defter hatası. Kullanıcı satırı
  `phase: intent|done` taşır (S16-18; ikisi de aynı işlenir). Çıktıda kişisel veri yok.
- Scratch provası (`--target scratch`) DB'ye replay uygulamaz; defter bütünlüğünü ve "henüz silinmemiş" sayısını gösterir.
  **G7 kabulü:** staging restore provasında (`--target staging`, §18.5) `erasure:replay` + `erasure:verify` PASS.

### 23.6 Defter alarmı (`FAILED adım=imha-defteri`, `ledger-backup`, `ledger-write`)

`journalctl -u remote-backup -n 40 | grep imha-defteri` sonucuna göre (yedek yine yayımlanır, birim failed olur, ref ilerlemez):

| Sonuç                      | Anlamı / eylem                                                                                                                                                                                                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kisaldi`, `degisti`       | Defter dışarıdan kesildi/değişti (S16-13; `app` süreci ele geçirilmiş olabilir). Son iyi yedekteki kopya (`age -d … erasure-ledger.jsonl.age`) ile canlı karşılaştırılır; eksik satırlar geri eklenir (sıra korunur, yalnız ekleme). Olay kaydı (§19)                                                                         |
| `gecersiz-satir=<n>`       | Yarım/bozuk satır (çökme anında yazım). Satır incelenir; geçerli JSON'a tamamlanamıyorsa silinir **ve** aynı kimlik doğru biçimde yeniden eklenir (audit `user.deleted`/`tenant.purged`'dan) → `--reset-ledger-baseline`                                                                                                      |
| `volume-yok`, `dosya-turu` | Compose `ledger` volume'u bağlı değil / defter sembolik bağlantı → yerleşim düzeltilir (§23.1)                                                                                                                                                                                                                                |
| `ledger-write`             | Server defter satırı yazamadı (disk/izin). Audit'te eksik kimlik bulunur (`user.deleted`, `tenant.purged`), satır elle eklenir: `docker compose exec -T server sh -c 'printf "%s\n" "<json>" >> /var/lib/remote/erasure-ledger.jsonl'`, ardından `docker compose restart server` (sayaç sıfırlanır; alarm 24 sa sonra kalkar) |

Bilinçli kabul (kayıp gerçekten geri getirilemiyorsa, gerekçe yazılarak):
`/opt/remote/deploy/backup/backup.sh --reset-ledger-baseline "<gerekçe 10-200 karakter>"` → sonraki yedek
`imha-defteri: taban-sifirlandi` (uyarı alarmı), sonraki `ok`.

### 23.7 Yedekten düşme ≤ 14 gün (AC-244) ve scratch dışa aktarımı (S16-5)

**AC-244 madde 1 — yedeklerden en geç 14 günde düşer (aylık kontrol, §20.3 listesine eklenir):**

| Kontrol                 | Komut / yer                                                                      | Beklenen                                                         |
| ----------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Yerel saklama           | `grep '^BACKUP_KEEP_DAYS=' backup.env`; `ls /var/backups/remote \| grep -c 'Z$'` | boş ya da ≤ 14; 14–15 çalıştırma                                 |
| En eski yerel yedek     | `ls /var/backups/remote \| grep 'Z$' \| head -1`                                 | ≤ 15 gün önce (audit referansı FAILED sürüyorsa istisna, §19.12) |
| Site dışı yaşam döngüsü | Hedefin (S3/rclone/sunucu) saklama kuralı ekran görüntüsü/komut çıktısı          | **≤ 14 gün** sonra silme (sürüm/çöp kutusu dahil); kayıt §20.3   |
| Elle kopya              | Kasada/iş istasyonunda `backup-<run>` dizini (§18.4 A)                           | Prova bitince silindi (`ls` boş)                                 |

**AC-244 madde 2 — silinen firmanın verisinin scratch'ten dışa aktarımı** (yalnız resmi talep: mahkeme/KVKK kurulu/firma
sözleşmesi; uygulama dışında olduğu için audit'e girmez → bu kayıt zorunludur):

1. **Kayıt** (§8 dağıtım kaydı benzeri tablo, `docs/` dışında kasadaki "dışa aktarım defteri"ne): tarih, talep no/dayanak,
   firma id, istenen kapsam, yapan, **iki onaylayan** (yapan dışında en az bir kişi daha; ikisi de adını ve saati yazar).
   İki onay olmadan 2. adıma geçilmez.
2. **Ağsız scratch:** yönetici iş istasyonunda (sunucuda değil) `restore.sh --target scratch --keep --work-dir <şifreli dizin>
<run>` → konteyner `--network none` (restore.sh zaten öyle başlatır). Yalnız talep edilen firmanın satırları
   `docker exec <scratch> mysql … --batch` ile `<şifreli dizin>`'e alınır; çıktı talep sahibine şifreli (age) iletilir.
3. **Silme doğrulaması:** `docker rm -fv <scratch>`; `docker ps -a --filter name=rs-restore-verify` **boş**;
   `docker volume ls -qf dangling=true` içinde scratch'e ait volume yok; `<şifreli dizin>` `rm -rf` + `ls` boş. Çıktılar
   kayda eklenir, iki onaylayan "silindi" satırını imzalar.

## 24. P17 I5 — istemci 0.11.0 yayını, staging exe, imzalama (devops, 2026-11-15; mimari-e11 §8, AC-252, S17-2)

Etiket: **`v0.11.0`** (mimari-e11 §8'deki `agent-v0.11.0` yazımı AC-94 "korumalı `v*` etiketi" ve kurulu GitHub ayarlarıyla
çelişir: tag ruleset `refs/tags/v*`, `agent-release` deployment policy `v*`, `verify-and-publish.sh` prod kilidi `vX.Y.Z`.
`agent-v*` etiketi korumasız olur ve release işi ortam politikasına takılır). İstemci sürümü etiketten gelir: `v0.11.0` →
`build.sh … 0.11.0` → `config.version=0.11.0` (ldflags); kodda sabit sürüm yok.

### 24.1 Ön koşullar (hepsi sağlanmadan etiket itilmez; release onayında yeniden kontrol edilir — S17-2, bağlayıcı)

| #   | Kontrol                                                                                                                                               | Nasıl                                                                                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **P15 prod'da** (eski sunucu `share.state`'in yeni `reason`/`method` alanlarını strictObject ile reddeder, mesaj düşer)                               | §8 yayın geçmişinde prod satırı P15 (ve sonrası) commit'i; `ssh … 'cd /opt/remote/deploy && docker compose logs migrate --tail 5'` P15 migration'ı uygulanmış                                                                                                                                  |
| 2   | P17 main'de, `agent-win` main push koşusu yeşil (check + test-windows + build 1/2, 2/2 + tekrarlanabilirlik)                                          | `gh run list --repo NoktaBilisim/Remote --workflow agent-win.yml --branch main -L 3`                                                                                                                                                                                                           |
| 3   | Aynı commit'ten staging exe (§24.2) ile duman testi + I6 test raporu GEÇTİ; qa GEÇTİ, güvenlik Kritik/Yüksek 0                                        | `docs/test-raporu.md`, `docs/qa-raporu.md`, `docs/guvenlik-raporu.md`                                                                                                                                                                                                                          |
| 4   | Bekleyen **`v1.0.0` release koşusu reddedildi** (sonra etiket silinir, §24.7) (run `43649073915`, 2026-11-14'ten beri `agent-release` onayı bekliyor) | Actions → agent-win → o koşu → Review deployments → **Reject**. Onaylanırsa P15 öncesi koddan **istemci 1.0.0** Release'i çıkar: 0.11.0'dan "yeni" görünür, kabul kodu eşiğini (≥ 0.11.0) geçer ama `admitCode`'u tanımaz; ayrıca release işi `v0.11.0`'ı "sürüm geriye gidiyor" diye durdurur |
| 5   | (İsteğe bağlı) SignPath hesabı varsa §24.3 değişkenleri tanımlı                                                                                       | yoksa Release imzasız (ADR-0010), AC-252 "uygulanamaz"                                                                                                                                                                                                                                         |

### 24.2 Staging exe (0.11.0) — yalnız main dalından

Kayıt: p17-wip dispatch koşusu 43687183097 (`f862e0e`) — `go test (Windows)` yeşil; AC-248/249 `-v` adımı 31 PASS, 0 SKIP; `TestAC248WGCWindowSmoke` PASS.

1. Actions → agent-win → Run workflow: dal **main**, `server_url=https://stg.remote.noktabilisim.net`, `version=0.11.0`.
   CLI: `gh workflow run agent-win.yml --repo NoktaBilisim/Remote --ref main -f server_url=https://stg.remote.noktabilisim.net -f version=0.11.0`
2. Koşu yeşil → artifact `agent-win-stg`: `NoktaDestek-stg-0.11.0.exe` + `SHA256SUMS` + `build-meta.txt`; attestation
   `refs/heads/main`. Release'e gitmez.
3. `gh run list --repo NoktaBilisim/Remote --workflow agent-win.yml --branch main --event workflow_dispatch -L 5` → run-id →
   `deploy/agent/verify-and-publish.sh --stg-run <run-id> --ssh root@185.126.217.99` (hedef `/opt/remote-stg/deploy`; §11.5).
4. Staging `.env`: kabul kodu (AC-239) denenecekse tenant ayarı "Talep kabulünde kabul kodu iste" açılır. Sunucu `admitCode`'u
   yalnız **istemcinin bildirdiği sürüm ≥ 0.11.0** (`ACCEPT_CODE_MIN_CLIENT_VERSION`) olan talebe üretir; ayar açıkken eski
   istemcinin talebi 409 `ACCEPT_CODE_CLIENT_UNSUPPORTED` ile kabul edilmez (talep PENDING kalır). Bu yüzden staging exe
   **`version=0.11.0` ile** üretilmelidir; `0.0.0` (varsayılan) ile derlenen exe kabul kodunu ve sürüm eşiklerini test edemez.

Doğrulama (devops, 2026-11-15, yerel; p17-wip çalışma ağacı): CI imajıyla iki bağımsız derleme
`build.sh https://stg.remote.noktabilisim.net 0.11.0` → aynı SHA-256 (`fa0c2623…`, 12.0 MB, PE); workflow'un `meta` ve `name`
adımları dispatch girdileriyle yerelde koşturuldu: main + 0.11.0 → `NoktaDestek-stg-0.11.0.exe`, artifact `agent-win-stg`;
dal `p17-wip` → "staging exe yalnız main dalından" (beklenen ret, S6-4); `version=0.11` → "x.y.z olmalı" (ret). Gerçek CI
koşusu P17 main'e birleşince 1. adımla yapılır.

WGC kanıtı (P17 QA Tur 1 / devops 1): `test-windows` işinde ayrı adım "AC-248/249 testleri (-v, SKIP görünür)"
`go test -count=1 -v -run 'TestAC248|TestAC249' ./internal/...` koşar; günlükte her test `--- PASS`/`--- SKIP` olarak
görünür. `TestAC248WGCWindowSmoke` SKIP ise koşu özetinde `::warning::` çıkar (iş kırmızı olmaz; runner oturumu WGC
desteklemeyebilir) → bu durumda gerçek kare kanıtı Windows VM elle turundan alınır. Test hiç koşmadıysa (ad değişmiş)
iş kırmızıdır. AC-249 testlerinden SKIP olan varsa da uyarı basılır.

### 24.3 İmzalama (AC-252, koşullu) — SignPath hesabı şu an YOK

- `agent-win.yml` `sign` işi yalnız **etiket push'unda** ve repo değişkeni `SIGNPATH_ORGANIZATION_ID` doluysa koşar
  (`windows-2025`, izin `contents: read` + `actions: read`; action `signpath/github-action-submit-signing-request` SHA ile
  sabit, v3.0). Değişken yoksa iş **skipped**; `attest` ve `release` imzasız ikiliyle sürer (bugünkü davranış) → AC-252
  "uygulanamaz" kapanır.
- Koşarsa: imzasız `agent-win` artifact'i doğrulanır (`sha256sum -c`) → yalnız exe `agent-win-unsigned` olarak yüklenir →
  SignPath'e gönderilir, imzalı exe beklenir → `signtool verify /pa /tw /v` + `Get-AuthenticodeSignature` = Valid →
  PE/≤ 40 MB/UPX yok → **SHA256SUMS imzalı exe'den** → artifact `agent-win-signed` → `attest` **imzalı exe'yi** attest eder →
  Release imzalı exe + SHA256SUMS; notta imzasız (tekrarlanabilir) SHA-256 da yazılır.
- Fail-closed: `sign` başarısızsa attest ve Release koşmaz; `SIGNPATH_ORGANIZATION_ID` doluyken imzasız ikili Release'e gitmez
  (release adımı denetler).
- Sıra (S-P17-2, 2026-11-15): etiket koşusunda `approve` (agent-release insan onayı) → `sign` → `attest` → `release`.
  Reject edilen etiket için imzalı ikili **hiç üretilmez**; sürüm artışı denetimi de onay işinde, imzadan önce koşar.
  `agent-win-signed` artifact'i 1 gün saklanır (kalıcı kopya Release'tedir). Release işi 1 günden sonra yalnız başına
  "Re-run" edilirse artifact bulunamaz → tüm koşuyu yeniden başlatın (yeni onay ister).
- Kurulum (hesap açılınca, kullanıcı; sıra önemli — token oluşturulmadan önce 1–2 tamam olmalı):
  1. **GitHub ortamı `agent-sign`:** Settings → Environments → New environment `agent-sign` → "Deployment branches and
     tags" = **Selected branches and tags** → Add rule → Ref type **Tag**, desen `v*` (dal kuralı EKLEMEYİN). Required
     reviewers gerekmez (insan kapısı `agent-release`; `sign` ancak onaydan sonra koşar), isteğe bağlı eklenebilir.
     "Environment secrets" → `SIGNPATH_API_TOKEN`. Token **repo secret'ı olarak tanımlanmaz** (varsa silin): repo secret'ı
     dal push'unda değiştirilmiş herhangi bir iş akışına verilebilir; ortam secret'ı yalnız `v*` etiketinden (ruleset:
     yalnız yönetici) koşan işe verilir.
  2. **SignPath:** GitHub bağlayıcılı proje + yapıt yapılandırması (kök: tek `NoktaDestek.exe`, Authenticode) +
     "release-signing" imzalama politikası. Politikada **origin verification** (Trusted Build System = GitHub.com) açılır
     ve kısıtlanır: izinli kaynak ref'i yalnız `refs/tags/v*`, izinli iş akışı yalnız `.github/workflows/agent-win.yml`,
     depo yalnız `NoktaBilisim/Remote`. Tercihen politika için SignPath tarafında elle onay (approver) da açılır. Menü
     adları SignPath sürümüne göre değişebilir; kurulumda SignPath "GitHub trusted build system" belgesinden doğrulayın.
     API token'ı yalnız bu projeye/politikaya submitter yetkili bir CI kullanıcısından üretin.
  3. Repo **değişkenleri** (gizli değil): `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_SIGNING_POLICY_SLUG`.
     `SIGNPATH_ORGANIZATION_ID` en son tanımlanır (tanımlandığı an `sign` etkinleşir).
  4. Doğrulama: bir sonraki etiket koşusunda `sign` işinin üstünde "agent-sign" ortamı görünür; dal üzerinde
     `environment: agent-sign` deneyen bir iş "Branch … is not allowed to deploy to agent-sign" ile durur.
- Tekrarlanabilirlik (§11.2) imzalı Release'te **imzasız** hash ile karşılaştırılır (Release notu / `sign` iş özeti).
  "Hakkında" parmak izi (AC-128) indirilen dosyanınkidir → imzalı `SHA256SUMS` ilk 8 hane. `verify-and-publish.sh`
  değişmedi (imzalı exe de PE; attestation imzalı özete bağlı).

### 24.4 Yayın (ön koşullar §24.1 tamam)

1. `git tag -s v0.11.0 <P17 main commit> && git push origin v0.11.0` (yalnız yönetici; ruleset).
2. Actions → agent-win → etiket koşusu: check, test-windows, build ×2, tekrarlanabilirlik, libopus-wasm (P28d) yeşil → `approve` işi
   **"ONAY: sunucu ön koşulu prod'da mı"** adıyla `agent-release` onayı bekler. Koşu sayfasındaki "Yayın ön koşulu" özeti
   **boş kutulu** bir kontrol listesidir (S-P17-3; kanıt değil, hatırlatma). Onaylayan §24.1'i yeniden kontrol eder ve onay
   yorumuna P15 prod commit'ini yazar; herhangi biri eksikse **Reject** (etiket kalır; imza, attestation ve Release oluşmaz;
   §24.1 tamamlanınca koşu "Re-run all jobs" edilir).
3. Onaydan sonra: sürüm artışı denetimi (etiket mevcut en yüksek Release'ten büyük) → (sign) → attest → release (ikinci onay
   yok). Release işi artifact adını (`agent-win`/`agent-win-signed`) ve SignPath tanımlıyken imzalı olmasını denetler.
4. Prod yayını: `deploy/agent/verify-and-publish.sh --tag v0.11.0 --dry-run`, sonra `--ssh root@185.126.217.99` (§11.3).
5. `MIN_AGENT_VERSION`: 0.11.0 yayınıyla **yükseltilmez** (0.10.x yeni sunucuyla çalışır; AC-234 alanları isteğe bağlı).
   Kabul kodu ayarını açan tenant'ta 0.10.x müşteri 409 alır → teknisyen müşteriden güncel istemciyi indirmesini ister.
   Tüm müşteriler 0.11.0'a geçmeden `MIN_AGENT_VERSION=0.11.0` yapılmaz (yapılırsa eski istemci 426 alır; §3).
6. §8 yayın geçmişine satır (istemci 0.11.0, SHA-256, imzalı/imzasız). `AGENT_WATCH_URL` henüz yoksa §11.1'e göre eklenir.

### 24.5 Geri alma

Önceki Release'i aynı doğrulamayla yeniden yayınlayın: `verify-and-publish.sh --tag v0.10.0 --ssh root@185.126.217.99`
(§11.4; prova 2026-11-11). Sunucu değişmez; 0.11.0'a özel alanlar isteğe bağlı olduğundan 0.10.x'e dönüş sunucuyu etkilemez,
yalnız kabul kodu açık tenant'larda talepler 409 alır (ayar kapatılır ya da 0.11.0 düzeltilip yeni etiketle — `v0.11.1` —
yeniden yayımlanır; aynı etiket yeniden kullanılmaz). Not: prod'da henüz bir `v*` Release yoksa (`gh release list` boş)
geri dönülecek Release de yoktur → indirmeyi kapatma yolu §11.7/4.

### 24.6 Hedef mimari

İstemci yalnız `windows/amd64` derlenir (`build.sh` `GOARCH=amd64`, go-winres `--arch amd64`; CI vet/govulncheck/lisans
yalnız amd64). `GOOS=windows GOARCH=386 go vet` `internal/capture/mf_windows.go:270` "constant 4294967297 overflows uintptr"
ile kırmızıdır (2026-11-15 yerelde doğrulandı); 386 hedef olmadığından CI'yı etkilemez. 64 bit değerin tek `uintptr` ile
geçirilmesi 386 çağrı kuralına zaten uymaz; 386 eklenirse önce backend-dev düzeltir (öneri: `capture` Windows dosyalarına
`//go:build windows && amd64`).

### 24.7 `v1.0.0` etiketinin silinmesi (S-P17-6; kullanıcı/yönetici — ajanlar silmez)

**Durum (2026-11-15):** `v1.0.0` etiketi kullanıcı tarafından silindi; run `43649073915` kullanıcı onayıyla iptal edildi (`cancelled`), Release oluşmadı. Staging'de docker build önbelleği kullanıcı onayıyla temizlendi (`docker builder prune -af`, 21,8 GB; disk %81 → %61).

Run `43649073915` **Reject** edildikten sonra `v1.0.0` etiketi de silinmelidir: etiket kaldıkça aynı koşu "Re-run" ile
yeniden `agent-release` onayına düşer ve yanlışlıkla onaylanabilir (P15 öncesi koddan istemci 1.0.0; ayrıntı §24.1/4). Bu
koşu etiketin commit'indeki eski `agent-win.yml` ile çalışır (onay `release` işindedir, imza akışı yok). Tag ruleset silmeyi
yalnız depo yöneticisine (bypass) izin verir; komutları yönetici kendi makinesinde çalıştırır:

```bash
gh run view 43649073915 --repo NoktaBilisim/Remote --json status,conclusion   # conclusion "failure"/"cancelled" olmalı (Reject)
gh release view v1.0.0 --repo NoktaBilisim/Remote || echo "Release yok (beklenen)"
git ls-remote --tags origin v1.0.0            # silinecek etiketin commit'ini kaydedin (§8 notu için)
git push origin --delete v1.0.0               # ya da: gh api -X DELETE repos/NoktaBilisim/Remote/git/refs/tags/v1.0.0
git tag -d v1.0.0                              # yerel kopya
git ls-remote --tags origin v1.0.0            # boş çıktı = silindi
```

Release oluşmuşsa (onaylandıysa) önce `gh release delete v1.0.0 --repo NoktaBilisim/Remote --yes`, indirilen exe yayına
alındıysa §24.5 / §11.4. Reject ve silme (tarih, etiket commit'i, kim) §8 yayın geçmişine bir satır olarak yazılır.

### 24.8 P20 — istemci 0.12.0 staging artifact'ı (devops K7, 2026-11-15; mimari-e11 §8d.8)

Sürüm numarası kodda **yoktur**: `build.sh <adres> <sürüm>` → ldflags `config.version` + go-winres `--product-version`/
`--file-version` (`build/winres.json`'daki `0.0.0.0` yer tutucudur, derlemede ezilir). 0.12.0 için kaynakta değiştirilecek sabit
yok; sürüm dispatch girdisinden (staging) veya `v0.12.0` etiketinden (Release) gelir.

Sıra (bağlayıcı): **K1 sunucu eki staging'de** (çoklu firma `binding.offer.multi` yalnız ≥ 0.12.0 teklifine) → P20 main'e
birleşti ve `agent-win` main push koşusu yeşil (AC-253/254 adımı dahil, §24.9) → staging exe:

1. `gh workflow run agent-win.yml --repo NoktaBilisim/Remote --ref main -f server_url=https://stg.remote.noktabilisim.net -f version=0.12.0`
2. Artifact `agent-win-stg`: `NoktaDestek-stg-0.12.0.exe` + `SHA256SUMS` + `build-meta.txt` (Release'e gitmez).
3. `deploy/agent/verify-and-publish.sh --stg-run <run-id> --ssh root@185.126.217.99` (hedef `/opt/remote-stg/deploy`, §11.5).
4. Duman (test-operatoru, Windows 10 + 11): 3 firmaya kayıt, seçerek talep, 6. firma `BINDING_LIMIT` metni, tepsi menüsü 3 öğe,
   Run aç → oturum kapat/aç → tepside başlar, ağ yok; talep sohbeti panel ↔ istemci; "Bu bilgisayarı unut" sonrası §24.9 iz
   testi temiz. Sonuç `docs/test-raporu.md` + §8 yayın geçmişi satırı (staging, 0.12.0, SHA-256).
5. `MIN_AGENT_VERSION` yükseltilmez (0.10.x/0.11.x eski tek kayıt dalıyla çalışır, §8d.2).

Sıra bozulursa (sunucu eki yokken 0.12.0) güvenlidir: istemci `previousKey` göndermez, yeni kayıt ekler; yine de 1. adım K1
staging'de değilken yapılmaz (çoklu dal sınanamaz).

### 24.9 P20 — CI kanıtı ve tepsi / Windows açılışı iz testi (AC-253/254; G-P20-1/2/14/16)

**CI (`agent-win.yml` → `test-windows`, her PR/push):**

| Adım                                  | Ne kanıtlar                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ACL tanılama                          | `icacls` C:\\, C:\\Users, profil, İndirilenler, Public + bütünlük düzeyi (runner yükseltilmiş). Gerçek C:\\ testi kırmızıysa önce buna bakın                                                                                                                                                                                                                            |
| AC-253/254 testleri (-v)              | `go test -count=1 -v -run 'TestAC253\|TestAC254' ./internal/...`; **zorunlu PASS** (SKIP/yok = kırmızı): `TestAC253RunValueRoundTrip` (gerçek HKCU Run, geçici `NoktaDestekTest-<rastgele>`, REG_SZ), `TestAC253IcaclsUsersModifyRefused` (G-P20-1), `TestAC253RealCDriveACL` (G-P20-14), `TestAC254TwoProcessLock` (G-P20-2/16, 2 süreç × 100 tur). Diğer SKIP = uyarı |
| HKCU Run'da test değeri kalmadı       | Testler `NoktaDestek*` adlı değer bırakmadı (bırakırsa silinir ve iş kırmızı)                                                                                                                                                                                                                                                                                           |
| trace-check -Tray/-Autostart öz testi | `kayitlar.bin`/`kayitlar.lock` + Run değeri elle oluşturulur; izinli / iz / REG_EXPAND_SZ reddi / değer yok / `hatirla.bin` kalmış / unut sonrası temiz / unut sonrası `kayitlar.lock` kalmış durumlarının çıkış kodları denetlenir                                                                                                                                     |

Tepsi duman testi ve istemcinin Run'ı **kendisinin** yazması UI ister → aşağıdaki elle test (CI'da yok).

**Elle iz testi (Windows 10 22H2 + 11 VM, standart kullanıcı; §11.8 ön adımları):**

1. `pwsh -File C:\iz\trace-check.ps1 -Mode Snapshot -SnapshotPath C:\iz\once.json`
2. Staging exe'yi (§24.8) İndirilenler'e indirin, kayıt alın, **Tepside çalıştır** ve **Windows açılışında başlat** açın,
   pencereyi X ile kapatın (tepsiye iner), oturumu kapatıp açın (tepside başlamalı).
3. `pwsh -File C:\iz\trace-check.ps1 -Mode Compare -SnapshotPath C:\iz\once.json -Binding on -Tray on -Autostart on -ExePath "$env:USERPROFILE\Downloads\<exe adı>"`
   → `TEMİZ`. İzinli: `%LOCALAPPDATA%\NoktaDestek\{kayitlar.bin, kayitlar.lock, tanilama.log*}` ve yalnız
   `HKCU\…\Run\NoktaDestek` = `"<exe tam yolu>" --tray` (REG_SZ). Tepside çalışan süreç "BİLGİ" satırıdır, iz değil.
4. Tepsi menüsü → **Aç** → **Bu bilgisayarı unut (tüm firmalar)** → onay; ardından tepsiden **Çık**.
5. `pwsh -File C:\iz\trace-check.ps1 -Mode Compare -SnapshotPath C:\iz\once.json -ExePath "$env:USERPROFILE\Downloads\<exe adı>"`
   (varsayılanlar `-Binding off -Remember off -Tray off -Autostart off`) → `TEMİZ`: klasör, `kayitlar.*`, `hatirla.bin`, Run
   değeri yok, süreç yok.
6. İstisna (Windows'un yazdığı, istemcinin değil; taranmaz): `HKCU\Control Panel\NotifyIconSettings\*`, `…\TrayNotify`
   IconStreams/PastIconsStream, Görev Yöneticisi'nin `…\Explorer\StartupApproved\Run\NoktaDestek` değeri.

### 24.10 P20 — AV kapısı ("AV yanlış pozitif"; imza yokken bağlayıcı, K-P20-3, R30, G-P20-10)

0.12.0 imzasızdır (ADR-0010) ve kendini `HKCU\Run`'a yazan imzasız exe sezgisel tespit riskini artırır. **Bu kapı geçmeden prod
Release onaylanmaz** (`agent-release` onayında Reject); staging sürer. Prod'da tepsi/Run seçenekleri varsayılan kapalıdır.

**Örnek dosya kuralı (G-P20-10):** AV'ye/VirusTotal'a/WDSI'ya yalnız CI'nin ürettiği **nötr adlı** dosya gider: etiket koşusunun
`agent-win` artifact'indeki `NoktaDestek.exe` (Release adayı; onay beklerken `reproducible` işi bitmiştir), gerekirse
`NoktaDestek-0.12.0.exe` adına kopyalanır. Müşterinin indirdiği `NoktaDestek-<etiket>-<ref>.exe` / `Destek-<kod>.exe` kopyası
(dosya adı `ref`/kod taşır) **asla** yüklenmez ve gönderilmez — hash Release'le aynıysa gerek de yoktur. Depo açık kaynaktır.

1. Adayı indirin ve hash'i alın:
   `gh run download <etiket-run-id> --repo NoktaBilisim/Remote -n agent-win -D av-0.12.0 && (cd av-0.12.0 && sha256sum -c SHA256SUMS)`
2. **Defender (Windows 10 ve 11, güncel tanım):**
   `& "$env:ProgramFiles\Windows Defender\MpCmdRun.exe" -SignatureUpdate` →
   `& "$env:ProgramFiles\Windows Defender\MpCmdRun.exe" -Scan -ScanType 3 -File <yol>\NoktaDestek-0.12.0.exe -DisableRemediation`
   → "found no threats". Ayrıca aynı commit'in staging exe'siyle (§24.8) tepsi + Run açık **24 sa** izleme:
   `Get-MpThreatDetection` boş, Defender geçmişi temiz.
3. **VirusTotal:** önce **hash araması** (`https://www.virustotal.com/gui/file/<sha256>`; dosya yüklenmez). Kayıt yoksa
   yalnız 1. adımdaki nötr adlı dosya yüklenir. Kabul: büyük motorlar (Microsoft, Kaspersky, ESET, Bitdefender, Sophos, Trend
   Micro) **0**, toplam **≤ 2**.
4. **Tespit varsa:** Microsoft WDSI (`https://www.microsoft.com/en-us/wdsi/filesubmission` → Software developer → "Incorrectly
   detected", aynı nötr adlı dosya) + ilgili satıcının yanlış pozitif formu. Çözülene dek **prod Release yok** (Reject),
   staging sürer; gönderim numarası ve tarih aşağıdaki tabloya.
5. Sonuç tablosu bu bölüme ve Release notuna eklenir (Release işi notu otomatik yazar; yönetici sonra ekler:
   `gh release view v0.12.0 --repo NoktaBilisim/Remote --json body -q .body > notes.md`, tabloyu ekleyin,
   `gh release edit v0.12.0 --repo NoktaBilisim/Remote --notes-file notes.md`).

| Tarih | Sürüm  | SHA-256 (ilk 16) | Defender W10 | Defender W11 | 24 sa izleme | VT büyük motor | VT toplam | WDSI/satıcı gönderimi | Karar |
| ----- | ------ | ---------------- | ------------ | ------------ | ------------ | -------------- | --------- | --------------------- | ----- |
| —     | 0.12.0 | (bekliyor)       | —            | —            | —            | —              | —         | —                     | —     |

**İlk müdahale — "program silindi / karantinaya alındı" (destek talebi, remote-watch geri bildirimi):** (1) müşteriden dosya
istemeyin; Release `SHA256SUMS` ile sunucudaki exe'yi doğrulayın (§11.7 komutu) — farklıysa bütünlük olayıdır (§11.7);
(2) hash Release ile aynıysa yukarıdaki 4. adım (nötr adlı Release dosyasıyla WDSI); (3) müşteriye tarayıcı modu / P19 talep
bağlantısı gönderilir; (4) tespit yaygınsa §24.5 ile önceki sürüme dönülür ve tablo güncellenir.

### 24.11 P20 — Windows açılışından elle kaldırma ve 0.12.0 geri alma

İstemci Run değerini silemezse (izin, AV kilidi; ekranda hata + bu adıma yönlendirme) ya da 0.11.x'e dönüldüyse Run değeri
0.12 exe'sini göstermeye devam eder. Kullanıcı kendi oturumunda (yönetici gerekmez):

```bat
reg query  HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v NoktaDestek
reg delete HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v NoktaDestek /f
```

ya da Görev Yöneticisi → Başlangıç uygulamaları → Nokta Destek → Devre dışı bırak (yalnız devre dışı bırakır; değer kalır, iz
testinde görünür). Tepside çalışan süreç: tepsi simgesi → **Çık**. Kayıtları da silmek için 0.12 exe'sinde "Bu bilgisayarı
unut"; exe yoksa `%LOCALAPPDATA%\NoktaDestek` klasörü elle silinir (sunucu anahtarları teknisyen panelinden iptal edilir).

**Geri alma 0.12.0 → 0.11.x:** §24.5 (`verify-and-publish.sh --tag v0.11.0`). 0.11 `kayitlar.bin`'i görmez (kayıtsız gibi
davranır, veri silinmez); yeniden 0.12'ye geçişte kayıtlar geri gelir. Run değeri olan müşterilere yukarıdaki kaldırma adımı
iletilir. Sunucu eki (K1) geri alınırsa 0.12 eski tek kayıt dalına düşer, veri kaybı yok (§8d.2).

## 25. P18 — talep iletişimi yayını, alarmlar, anahtar emekliliği (devops H5, 2026-11-15; mimari-e11 §8b.10/§8b.13, AC-255..258)

Kapsam: migration `20261119000000_p18_request_comms` (ön kontrollü), tetikleyici **22 → 23** (`session_messages_delete_guard`),
yedek/geri yükleme beklenen sayısı, yeni `remote-watch` kontrolleri (S-P18-T2c, T4, T12), anahtar emekliliği (S-P18-T2a/b),
tatil listesi. Yeni env değişkeni **yok** (server, compose, backup.env, watch.env).

### 25.1 Tetikleyici sayısı — tek kaynak

`deploy/backup/lib.sh` `REMOTE_EXPECTED_TRIGGERS=23`. `backup.sh` (`BACKUP_EXPECTED_TRIGGERS` boşsa), `restore.sh`
(`RESTORE_EXPECTED_TRIGGERS` boşsa) ve `test-backup-inner.sh` buradan okur. Tetikleyici ekleyen/silen migration aynı commit'te
şunları günceller: `lib.sh` sabiti, `deploy/mysql/audit-continuity.sql` özeti (dba), `check-app-grants.sh` (dba).
`lib-ledger.sh` `-ge 22` "P16 sonrası yedek" eşiğidir, değişmez.

**Not:** `backup.sh` beklenen sayıyı ve audit tetikleyici özetini (`audit-continuity.sql`) **git ağacından** okur. Ağaç
P18'e çekilip DB henüz P17'deyken (ya da tersi) yedek `FAILED adım=tetikleyici` olur. Bu yüzden ön yedek `git pull`'dan
**önce** alınır, geri almada ağaç da önceki commit'e döner.

### 25.2 Staging yayını (sıra; her adım komut → beklenen). Yığın `/opt/remote/deploy` (ikinci yığın varsa `/opt/remote-stg/deploy` için aynısı)

| #   | Komut (sunucu, root, yığın dizininde)                                                                                                                                                                                                                                    | Beklenen                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `grep -n '^BACKUP_EXPECTED_TRIGGERS=' backup/backup.env; stat -c '%U %a' backup/backup.env`                                                                                                                                                                              | Satır **boş** (`BACKUP_EXPECTED_TRIGGERS=`), `root 600`. `=22`/`=3` yazılıysa: `sed -i 's/^BACKUP_EXPECTED_TRIGGERS=.*/BACKUP_EXPECTED_TRIGGERS=/' backup/backup.env` (boş = ağaçtaki değer)                                  |
| 2   | **Açık silme işi ön kontrolü:** `docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_MIGRATOR_PASSWORD" mysql -umigrator -NB "$MYSQL_DATABASE" -e "SELECT id, tenant_id, state, step FROM tenant_purge_jobs WHERE CAST(state AS BINARY) IN (\"RUNNING\",\"FAILED\")"'` | **Boş çıktı.** Satır varsa migration `P18_PRECHECK purge_jobs_open=<n>` ile durur: RUNNING → bitmesini bekleyin (heartbeat, §23.3); FAILED → §23.3 "Sürdür" ile `DONE`'a getirin. SCHEDULED sorun değildir (FENCE'ten başlar) |
| 3   | `docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_MIGRATOR_PASSWORD" mysql -umigrator -NB -e "SELECT @@global.log_bin, @@global.log_bin_trust_function_creators"'`                                                                                                  | `1 1` (compose `--log-bin-trust-function-creators=1`). `1 0` ise migration `P18_PRECHECK binlog_flag` ile durur → compose `mysql.command` bayrağı geri konur, `up -d mysql`                                                   |
| 4   | **Ön yedek, `git pull`'dan ÖNCE** (eski ağaç): `systemctl start remote-backup.service; journalctl -u remote-backup -n 5 --no-pager \| grep -E 'OK run\|FAILED'`                                                                                                          | `remote-backup: OK … tetikleyici=22`. (İkinci yığın: `remote-backup@stg.service`)                                                                                                                                             |
| 5   | §8 akışı: `git pull` → `IMAGE_TAG` → `docker compose build` → `docker compose up -d` → `docker compose logs --since 5m migrate`                                                                                                                                          | `20261119000000_p18_request_comms` uygulandı, grants OK; server/web healthy. Durursa §25.3                                                                                                                                    |
| 6   | `docker compose --profile setup run --rm seed`                                                                                                                                                                                                                           | Hata yok (demo firmaya hafta içi mesai, takvim kapalı)                                                                                                                                                                        |
| 7   | `check-app-grants.sh` (§6 yöntemi: `set -a; . ./.env; set +a; APP_PW=$MYSQL_APP_PASSWORD CONTAINER=$(docker compose ps -q mysql) DB=$MYSQL_DATABASE bash mysql/check-app-grants.sh`)                                                                                     | **561/561 PASS**, tetikleyici 23                                                                                                                                                                                              |
| 8   | `systemctl start remote-backup.service; journalctl -u remote-backup -n 30 --no-pager \| grep -E 'audit-sureklilik\|OK run\|FAILED'`                                                                                                                                      | `audit-sureklilik: ok`, `remote-backup: OK … tetikleyici=23`. **H5 kabulü: migration sonrası ilk gece yedeği PASS** (ertesi sabah aynı grep)                                                                                  |
| 9   | **Geri yükleme provası (scratch; yönetici iş istasyonu, age anahtarı kasadan, §18.4):** `deploy/backup/restore.sh --identity <age-anahtarı> --target scratch <son çalıştırma dizini>`                                                                                    | `CHECK OK    tetikleyici sayısı (beklenen) 23` … `restore-verify: OK`. **H5 kabulü: staging restore provası PASS** → §8 yayın geçmişine satır                                                                                 |
| 10  | `cd ops && ./remote-watch.sh install` (prod örneği) / `./remote-watch.sh install stg` (P18 server ayaktayken)                                                                                                                                                            | `systemctl start remote-watch.service` → `OK (<n> kontrol)`; `status.prom`'da `check="crypto-decrypt"`, `"calendar-fallback"`, `"msg-tenant-rate"`, `"p18-metrics"` = 1                                                       |

**Geçiş dönemi geri yüklemesi:** migration'dan önce alınmış yedeklerde (≤ 14 gün) 22 tetikleyici vardır. P18 ağacının
`restore.sh`'i onlar için `CHECK FAIL tetikleyici sayısı (beklenen)` verir; bilinçli olarak
`RESTORE_EXPECTED_TRIGGERS=22 deploy/backup/restore.sh …` ile çalıştırılır (manifest = DB kontrolü yine yapılır). Böyle
bir yedek canlıya yüklenirse sonraki `up -d` P18 migration'ını yeniden uygular (adım 2–3 ön kontrolleri geçerli).

### 25.3 Migration durdu (`P18_PRECHECK …`) ve geri alma

**Ön kontrol düştü** (`docker compose logs migrate | grep P18_PRECHECK`): hiçbir şema değişmemiştir; server başlamaz.
Neden giderilir (§25.2/2 ya da /3), sonra:

```bash
docker compose run --rm migrate pnpm --filter @remote/server exec prisma migrate resolve --rolled-back 20261119000000_p18_request_comms
docker compose up -d && docker compose logs --since 5m migrate
```

Ön kontrol dışı bir hata (DDL yarıda, 3819/1452/1419): `resolve` **yapmayın**; `docker compose logs migrate` çıktısı dba'ya,
önceki imaja dönüş aşağıdaki gibi.

**Geri alma tercih sırası:** ileri düzeltme > yalnız imaj geri alma > imaj + `down.sql`.

- **Yalnız imaj** (`IMAGE_TAG=<önceki>` → `up -d`): eski kod yeni şemada çalışır (yeni sütunlar varsayılanlı), **ama**
  P17 firma silme kodu `MESSAGES` adımını bilmez → `update_guard` reddeder (`db_signal`). Bu sürede firma silme zamanlanmaz;
  SCHEDULED iş varsa iptal edilir (§23.2/3). Ağaç P18'de kalır (tetikleyici 23 = DB → yedek tutarlı).
- **İmaj + `down.sql`** (veri kaybı: öncelik/atama/SLA/mesai alanları; korumalar aşağıda):
  1. Ön yedek (§25.2/8 komutu; P18 ağacıyla `tetikleyici=23`).
  2. `docker compose stop server web`
  3. P18 imajıyla: `docker compose run --rm migrate pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261119000000_p18_request_comms/down.sql`
     — **3819 `p18_down_guard_chk`**: `session_messages` ya da `business_holidays` satırı var (mesaj/tatil kaybı onaysız
     olmaz; önce dışa alınır ya da bilinçli silinir). **3819 `p18_down_jobs_guard_chk`**: RUNNING/FAILED silme işi ya da
     `step='MESSAGES'` satırı var (§23.3 ile bitirin). İki durumda da hiçbir şey değişmemiştir.
  4. Ağaç ve imaj önceki commit'e: `cd /opt/remote && git checkout <önceki commit> -- deploy` (ya da önceki bundle),
     `.env` `IMAGE_TAG=<önceki>` → `docker compose up -d` (P17 migrate no-op + P17 grants.sql).
  5. `check-app-grants.sh` (P17 ağacı) → hepsi PASS, tetikleyici 22; `systemctl start remote-backup.service` →
     `OK … tetikleyici=22`. `backup.env` `BACKUP_EXPECTED_TRIGGERS` boş kalır (ağaçtaki `lib.sh` 22).
  6. `remote-watch` P18 kontrolleri `rs_request_messages_total` görmeyince kendiliğinden kapanır (yeniden kurulum gerekmez).

### 25.4 Alarmlar (`remote-watch`, 10 dk; `deploy/ops/remote-watch.sh`)

Kontroller yalnız P18 server'da (`/metrics`'te `rs_request_messages_total` varsa) çalışır. Durum: `state` dosyasında
`decrypt_fail=`, `calendar_fallback=`, `msg_tenant_rate=` ("<son değer> <artış anı>"). Prometheus eşdeğeri parantezde.

| check               | Kaynak                                                                                              | Eşik / davranış                                                                                      | Seviye / ilk müdahale                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crypto-decrypt`    | `rs_crypto_decrypt_failures_total` (bütün `table` serileri; S-P18-T2c `{table="session_messages"}`) | sayaç > 0 oldukça **ya da** artıştan sonra 24 sa (`rs_crypto_decrypt_failures_total > 0`)            | **Kritik.** Mesaj "Mesaj okunamadı" görünür. Nedenler: `APP_ENCRYPTION_KEYS`'ten sürüm erken çıkarıldı (§14 P10 rotasyon), farklı anahtarla geri yükleme, DB'de gövde/kimlik kurcalama (AAD uyuşmaz). `docker compose logs server --since 2h \| grep -i decrypt` (gövde loglanmaz) → kasadaki sürümlerle `.env` karşılaştırılır; eksik sürüm geri eklenir → `up -d server`. Açıklanamıyorsa §19 olay müdahalesi |
| `calendar-fallback` | `rs_calendar_fallback_total` (bütün `tenant`)                                                       | artıştan sonra 24 sa; ilk turda sayaç > 0 da alarm (`increase(rs_calendar_fallback_total[24h]) > 0`) | **Uyarı** (S-P18-T12). Firma saat dilimi kurulamadı → `Europe/Istanbul` kullanıldı, SLA NULL olabilir. `docker compose logs server --since 24h \| grep -i calendar` → tenant; `SELECT tenant_id, time_zone FROM tenant_request_settings WHERE tenant_id = '<id>'` → Admin mesai ayarında saat dilimini yeniden seçer. Node imajı güncellemesinden sonra çoksa ICU dilim adı değişmiştir (backend'e)             |
| `msg-tenant-rate`   | `rs_request_messages_rejected_total{reason=~".*tenant.*"}`                                          | artıştan sonra 1 sa (`increase(…[1h]) > 0`)                                                          | **Uyarı** (S-P18-T4). Firma başına müşteri mesajı kovası (300/dk) aşıldı; panelde `queue.alert` bandı. Olağan dışı yoğunluk / bot: Caddy logunda `/ws/request` kaynak IP dağılımı; tek kaynaksa host güvenlik duvarında geçici engel, müşteri bağlantısı yenilenir (§13.4)                                                                                                                                      |
| `p18-metrics`       | yukarıdaki iki zorunlu seri                                                                         | P18 server'da `rs_crypto_decrypt_failures_total` ya da `rs_calendar_fallback_total` yok              | **Uyarı** (fail-closed). Server metrik sözleşmesi eksik → backend'e                                                                                                                                                                                                                                                                                                                                             |

Elle kontrol: §22.2 komutunda süzgeç `/^rs_(crypto_decrypt_failures|calendar_fallback|request_messages(_rejected)?)_total/`.
Yerel test: `deploy/ops/test-watch.sh` (P18 senaryoları dahil).

### 25.5 Anahtar emekliliği ve yeniden şifreleme (S-P18-T2a/b, S-P18-K3; CLI H3 ile gelir)

`session_messages.body_enc` ilk baytı anahtar sürümüdür. §14 P10 "Anahtar rotasyonu" kuralına ek olarak:

**Çalıştırma kuralı (S-P18-K3):** `migrate` servisinin compose tanımında `APP_ENCRYPTION_KEYS` **yoktur** (her `up`/migration
koşusunda anahtar konteyner ortamına girip `docker inspect`'te görünmesin diye). CLI, migrate imajında hazırdır
(`apps/server/Dockerfile` `migrate` hedefi = `tooling`, repo kaynağı `COPY . .`; `pnpm --filter @remote/server cli` →
`node src/cli/main.ts` → `crypto:*` → `src/cli/crypto.ts`). İki komut da `MIGRATE_DATABASE_URL` (migrator) ister ve yalnız
`migrate` servisinde çalışır (ADR-0025 append-only istisnası). Anahtar yalnız `crypto:rewrap` için, **tek seferlik**
verilir:

```bash
cd /opt/remote/deploy            # ikinci yığın: /opt/remote-stg/deploy
# -e ANAHTAR (değer YOK): compose değeri kabuk ortamından, yoksa bu dizindeki .env'den alır (Compose v2/v5'te denendi).
# Değer komut satırına, kabuk geçmişine, `ps` çıktısına düşmez. --rm: konteyner bitince silinir, `docker inspect` izi kalmaz.
docker compose run --rm -e APP_ENCRYPTION_KEYS migrate \
  sh -c 'echo "anahtar_uzunlugu=${#APP_ENCRYPTION_KEYS}"'   # ön kontrol: yalnız uzunluk; 0 ise aşağıdaki B yolunu kullan
```

- **B yolu (eski compose ya da `.env` başka dizinde):** değeri alt kabukta, yalnız o satırı okuyarak aktar (tüm `.env`'i
  `source` etmek yerine; `.env`'de `$` içeren parolalar kabukta bozulmaz). Alt kabuk kapanınca değer oturumda kalmaz:
  `( export APP_ENCRYPTION_KEYS="$(sed -n 's/^APP_ENCRYPTION_KEYS=//p' .env)"; docker compose run --rm -e APP_ENCRYPTION_KEYS migrate pnpm --filter @remote/server cli crypto:rewrap session_messages --from <ver> --dry )`.
  Bilinen kalıp `( set -a; . ./.env; set +a; docker compose run --rm -e APP_ENCRYPTION_KEYS migrate … )` da olur, ama
  yalnız `.env` kabukta okunabiliyorsa. Hiçbir yolda `-e APP_ENCRYPTION_KEYS=<değer>` **yazılmaz**, değer `echo` edilmez.
- **Yasak:** `docker compose up migrate` ya da `-e`'siz `run` ile rewrap (CLI `APP_ENCRYPTION_KEYS tanımlı değil` deyip
  çıkış 2 ile durur, zararsız). Compose dosyasına anahtar geri eklenmez.
- **Koşu sırasında** anahtar o çalışan konteynerin ortamında `docker inspect` ile görülebilir (sınır host/docker yetkisi;
  aynı değer server'da zaten var). Bitince doğrula: `docker ps -a --filter name=migrate-run --format '{{.Names}}'` → **boş**.
  `--rm` unutulduysa ya da koşu kesildiyse: `docker compose rm -f migrate` ve
  `docker ps -aq --filter name=migrate-run | xargs -r docker rm -f`.

1. **Emeklilik ön koşulu (anahtar gerekmez, `-e` verilmez):** sürüm `<ver>` halkadan çıkarılmadan önce
   `docker compose run --rm migrate pnpm --filter @remote/server cli crypto:check-retire <ver>` → **0** satır olmalı
   (eşdeğer SQL: `SELECT COUNT(*) FROM session_messages WHERE ASCII(body_enc) = <ver>`). 0 değilse sürüm çıkarılmaz.
2. **Sızıntı yolu (anahtar sızdı):** yeni sürüm `.env`'e eklenir (`v1:…,v2:…`) → `up -d server` → kuru koşu
   `docker compose run --rm -e APP_ENCRYPTION_KEYS migrate pnpm --filter @remote/server cli crypto:rewrap session_messages --from <ver> --dry`
   → `cozulemeyen=0` ise gerçek koşu `--dry` olmadan, aynı biçimde (yalnız `migrate` servisi, `MIGRATE_DATABASE_URL`/migrator;
   500'lük partiler). Audit `crypto.rewrap {table, fromVer, rows}` (aktör `system:cli`) görülür → adım 1 ile 0 doğrulanır
   → `migrate-run` konteyneri kalmadığı doğrulanır → sürüm çıkarılır.
   Bu, ADR-0025 append-only kuralının tek istisnasıdır (K-P18-10); `app` kullanıcısına UPDATE verilmez.
   **Çıkış 5 (yarıda DB hatası, S-P18-K2):** tamamlanan partiler yazılmış kalır; audit `crypto.rewrap {result:"fail", rows,
batches, error}` yazılır. Sorun giderilince **aynı komut yeniden çalıştırılır** (yalnız kalan `--from <ver>` satırlarını
   taşır), ardından adım 1 ile 0 doğrulanır.
3. Emekli sürüm kasada en az son yedeğin saklama süresi (14 g + site dışı) boyunca tutulur.

### 25.6 Resmî tatil listesi — yıllık güncelleme (AC-258)

Tatiller firma bazındadır (`business_holidays`, firma başına ≤ 200). Dinî bayram tarihleri her yıl değişir; sistem kendisi
eklemez. **Her yıl Aralık ayının ilk haftası:** firma Admin'lerine (ya da Super Admin firma bağlamında) "Ayarlar → Mesai saatleri →
Tatiller → Resmî tatilleri ekle (yıl)" ile ertesi yılın listesinin yüklenmesi hatırlatılır (audit `settings.holidays_imported`). Kontrol:
`SELECT tenant_id, COUNT(*) FROM business_holidays WHERE day >= '<yıl+1>-01-01' GROUP BY tenant_id` — mesai açık
(`hours_enabled = 1`) olup satırı olmayan firma eksik demektir. Geçmiş yılların satırları silinmez (SLA geçmişi).

## 26. P19 — web talep formu, SMS, müşteri bildirimi kuyruğu (devops J6, 2026-11-15; mimari-e11 §8c, S-P19-10/12/T6/T9, R31)

Kapsam: migration `20261120000000_p19_web_requests` + `20261120010000_p19_request_session_mode` (tetikleyici **23 aynı**, grants **627/627**), yeni env `SMSPORTAL_URL`
(§3; yalnız `server`), Caddy log süzgecine `/r/<ref>` → `/r/***` (iki log bloğu; G-10), yeni `remote-watch` kontrolleri,
smsportal arıza yolu, SMS anahtarı ve `SMSPORTAL_URL` değişimi, form spam'i. `backup.env`/`deploy/backup/*` değişmez.
SQL komutları §25.2 adım 2'deki biçimle (`docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_MIGRATOR_PASSWORD" mysql
-umigrator -NB "$MYSQL_DATABASE" -e "<SQL>"'`) yığın dizininde çalıştırılır; aşağıda yalnız `<SQL>` yazılıdır.

### 26.1 Staging yayını ve migration notu (J1: CHECK eklemesi COPY ALTER)

`support_requests` (MODIFY `client_version` NULL + 2 CHECK, **tek COPY ALTER**) ve `tenant_settings` (3 CHECK, COPY) tablo
kopyalanarak yeniden yazılır; kopya süresince bu tablolara **yazım bekler** (talep oluşturma, firma ayarı kaydı). Süre staging'de
ölçülmedi (dba bağlanmadı) → **bu yayında ölçülür** ve §8 yayın geçmişine yazılır. Sütun eklemeleri INSTANT, yeni tablo boş.

| #   | Komut                                                                                                                                                                                                                    | Beklenen                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Ön kontrol (boyut):** `SELECT table_name, table_rows, ROUND((data_length+index_length)/1048576) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('support_requests','tenant_settings')` | Satır sayısı ve MB not edilir. Kaba kestirim: 8.4'te COPY ~ 50–100 bin satır/sn; < 100 bin satırda saniyeler                                                   |
| 2   | `df -h /var/lib/docker`                                                                                                                                                                                                  | Boş alan ≥ 2 × (adım 1 MB toplamı) + 1 GB (COPY geçici kopya + binlog). Değilse önce §"DB dolu" (yer açılır), yayın ertelenir                                  |
| 3   | Yoğun olmayan saat seçilir (talep trafiği en düşük; mesai dışı). Firma Admin'lerine kısa kesinti duyurusu gerekmez (< 1 dk bekleniyorsa)                                                                                 | —                                                                                                                                                              |
| 4   | **Ön yedek, `git pull`'dan ÖNCE:** `systemctl start remote-backup.service; journalctl -u remote-backup -n 5 --no-pager \| grep -E 'OK run\|FAILED'`                                                                      | `remote-backup: OK … tetikleyici=23`                                                                                                                           |
| 5   | §8 akışı (`git pull` → `IMAGE_TAG` → `build` → `up -d`), sonra `docker compose logs --timestamps --since 10m migrate`                                                                                                    | `20261120000000_p19_web_requests` uygulandı, grants OK. **Süre:** migration başlangıç/bitiş zaman damgası farkı → yayın geçmişine                              |
| 6   | `check-app-grants.sh` (§25.2/7 yöntemi)                                                                                                                                                                                  | **626/626 PASS**, tetikleyici 23                                                                                                                               |
| 7   | `.env`'de `SMSPORTAL_URL` (§3) — boş da olabilir; doluysa `docker compose up -d server` sonrası `docker compose logs server --since 5m \| grep -i -E 'sms\|insecure'`                                                    | Hata yok. `http://` + özel olmayan host ise SMS kanalı kapalı başlar (fail-closed) → https ya da özel ağ adresi                                                |
| 8   | **Caddy log doğrulaması (S-P19-10):** tarayıcıdan bir `/r/<ref>` açılır, sonra `docker compose logs caddy --since 10m \| grep -c '"/r/[^*]'`                                                                             | **0** (`/r/***` görünür, ref görünmez). Yerelde/CI'de `deploy/test-caddy.sh` iki log bloğunu ayrı ayrı sınar                                                   |
| 9   | `cd ops && ./remote-watch.sh install` (ve varsa `install stg`) → `systemctl start remote-watch.service`                                                                                                                  | `OK (<n> kontrol)`; `status.prom`'da `check="notify-outbox-pending"`, `"notify-outbox-failed"`, `"notify-volume"`, `"sms-key-unreadable"`, `"p19-metrics"` = 1 |
| 10  | Ertesi sabah: `journalctl -u remote-backup -n 30 --no-pager \| grep -E 'audit-sureklilik\|OK run\|FAILED'`                                                                                                               | **J6 kabulü: ilk gece yedeği PASS** (`tetikleyici=23`)                                                                                                         |

**Durdu / geri alma:** ön kontrol yok (yeni tetikleyici/adım yok). DDL yarıda kaldıysa `resolve` yapılmaz, `docker compose
logs migrate` dba'ya. Tercih sırası §25.3 ile aynı: ileri düzeltme > yalnız imaj (P18 kodu yeni sütunları yok sayar; WEB talebi
`client_version` NULL olduğundan P18 panelinde sürüm boş görünür) > imaj + `down.sql`. `down.sql` **`p19_down_guard_chk`** ile
WEB talebi ya da outbox satırı varken hiçbir şey değiştirmeden 3819 verir; önce P18 kodu + P18 `grants.sql`, firma SMS ayarı
varsa not alınır (kalıcı kayıp). Ayrıntı `docs/db-notlari.md` "P19".

### 26.2 Alarmlar (`remote-watch`, 10 dk; `deploy/ops/remote-watch.sh`)

Yalnız P19 server'da (`/metrics`'te `rs_notify_outbox_total` varsa) çalışır. Durum dosyası: `notify_volume_since=`,
`sms_key_unreadable=`, `notify_samples=` (`ts:outbox-toplam:outbox-failed:rate-limited`, 90 dk). Eşikler `watch.env`:
`WATCH_NOTIFY_CAPS` (vars. `SMS:100 WHATSAPP:60 EMAIL:100` — contracts `NOTIFY_LIMITS` değişirse **aynı commit'te** güncellenir),
`WATCH_NOTIFY_FAIL_MIN` (3), `WATCH_NOTIFY_RL_MAX` (20).

| check                   | Kaynak                                                                   | Eşik                                                                                                                                   | Seviye / ilk müdahale                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `notify-outbox-pending` | `rs_notify_outbox_oldest_pending_seconds` (en büyük seri)                | > 60 sn (AC-261: son deneme ≤ ~50 sn)                                                                                                  | **Kritik.** İşçi durdu ya da kanal servisi takılıyor. `docker compose logs server --since 30m \| grep -i -E 'outbox\|notify'`; server `/ready` sağlamsa §26.6 (smsportal) / §12 (WhatsApp) / §14 (SMTP). İşçi hiç ilerlemiyorsa `docker compose restart server` (SENDING satırlar 60 sn sonra PENDING'e döner; nadir çift mesaj K-P19-4)       |
| `notify-outbox-failed`  | `rs_notify_outbox_total{result="failed"}` / tüm son durumlar             | 15 dk'da FAILED > %50 **ve** FAILED ≥ `WATCH_NOTIFY_FAIL_MIN`                                                                          | **Uyarı.** Kanal bozuk ya da yapılandırılmamış. Neden dağılımı: `SELECT channel, last_reason, COUNT(*) FROM notification_outbox WHERE state='FAILED' AND updated_at > NOW() - INTERVAL 1 HOUR GROUP BY 1,2` — `unreachable`/`http_error` → §26.6; `unauthorized` → §26.4; `unconfigured` → §26.3 ya da firma Admin'i kanalı açmış ama ayar yok |
| `notify-volume`         | `rs_notify_tenant_max_hourly{channel}` · `rs_notify_rate_limited_total`  | herhangi bir kanalda ≥ tavanın %80'i (SMS 80, WA 48, EMAIL 80) **10 dk boyunca** (ardışık iki tur) **ya da** 15 dk'da rate_limited +20 | **Uyarı** (S-P19-12). Bildirim istismarı / form spam'i → §26.5                                                                                                                                                                                                                                                                                 |
| `sms-key-unreadable`    | `rs_sms_key_unreadable_total`                                            | artıştan sonra 24 sa; ilk P19 turunda sayaç > 0 da alarm                                                                               | **Uyarı** (S-P19-T6; P18 `crypto-decrypt`'ten **ayrı** — mesaj gövdesi değil, firma SMS anahtarı). Neden: `SMSPORTAL_URL` değişti (§26.3) ya da anahtar sürümü emekli edildi (§26.4). Etkilenen firmalar: `docker compose logs server --since 24h \| grep -i unreadable` → tenantId; Admin anahtarı panelde yeniden girer                      |
| `p19-metrics`           | `rs_notify_outbox_oldest_pending_seconds`, `rs_sms_key_unreadable_total` | P19 server'da biri yok                                                                                                                 | **Uyarı** (fail-closed). Metrik sözleşmesi eksik → backend'e                                                                                                                                                                                                                                                                                   |

Elle kontrol: §22.2 komutunda süzgeç `/^rs_(notify_|sms_)/`. Yerel test: `deploy/ops/test-watch.sh` (P19 senaryoları dahil).

### 26.3 `SMSPORTAL_URL` değişimi (S-P19-T6)

Firma SMS anahtarı AAD'si **etkin kökene** bağlıdır (`tenant_settings.sms_api_key:<tenantId>|<köken>`). Varsayılanı kullanan
(firma `sms_url` boş) firmaların anahtarı yeni adreste **çözülemez** (tasarım gereği; anahtar yeni adrese taşınmaz).

1. Etkilenen firma sayısı: `SELECT COUNT(*) FROM tenant_settings WHERE sms_url IS NULL AND sms_api_key_enc IS NOT NULL`.
   0 ise doğrudan adım 4. Liste (duyuru için): `SELECT t.id, t.name FROM tenants t JOIN tenant_settings s ON s.tenant_id = t.id
WHERE s.sms_url IS NULL AND s.sms_api_key_enc IS NOT NULL`.
2. Bu firmaların Admin'lerine duyuru (en az 1 iş günü önce): "<tarih/saat>'te SMS servis adresi değişiyor; ardından Ayarlar → SMS'te
   API anahtarını yeniden girip Test SMS gönderin. Arada SMS bildirimleri gitmez (talep/oturum etkilenmez)."
3. Yeni adresin smsportal'da ilgili API anahtarlarının hazır olduğu doğrulanır (aynı smsportal örneği taşınıyorsa anahtarlar aynı kalır).
4. `.env` `SMSPORTAL_URL=<yeni>` → `docker compose up -d server` → `docker compose exec -T server printenv SMSPORTAL_URL` = yeni değer.
5. Arada SMS gönderimleri `unconfigured` (outbox FAILED + audit `request.customer_notify`), `sms-key-unreadable` ve
   `notify-outbox-failed` alarmları beklenir. Adım 1 sorgusundaki firmalar anahtarı yeniden girdikçe alarm 24 sa içinde kalkar.
6. Geri dönüş: eski adres `.env`'e geri yazılırsa (kök aynı) eski anahtarlar yeniden çözülür; yeni adreste anahtar girmiş
   firmalarınki bu kez çözülemez — bu yüzden geri dönüş yalnız ilk saat içinde yapılır.

### 26.4 SMS anahtarı rotasyonu ve uygulama anahtarı emekliliği

**smsportal API anahtarı (firma başına, sızıntı ya da periyodik):** firma Admin'i (ya da Super Admin firma bağlamında) smsportal
admin panelinde yeni anahtar üretir → Remote "Ayarlar → SMS"te anahtar alanına yazar, kaydeder (audit `settings.sms_updated`,
değer `***`) → "Test SMS Gönder" başarılı → smsportal'da eski anahtar iptal edilir. Sıra önemli: eski anahtar test başarılı olmadan
iptal edilmez (arada `unauthorized`). Anahtar hiçbir zaman dokümana, sohbete, `.env`'e yazılmaz.

**`APP_ENCRYPTION_KEYS` sürüm emekliliği (§25.5 kuralına ek; CLI `apps/server/src/cli/crypto.ts`, J3):**

1. **Sayım (anahtar gerekmez, `-e` verilmez):**
   `docker compose run --rm migrate pnpm --filter @remote/server cli crypto:check-retire <ver>` → tablo başına bir satır:
   `crypto:check-retire tablo=<t> surum=<ver> satir=<n>` (`session_messages`, `tenant_settings.sms_api_key_enc`,
   `notification_outbox.recipient_enc`). Toplam > 0 → çıkış 1, sürüm halkadan **çıkarılmaz**. Eşdeğer SQL (ilk bayt sürüm):

   ```sql
   SELECT 'sms_api_key', COUNT(*) FROM tenant_settings WHERE sms_api_key_enc IS NOT NULL AND ASCII(sms_api_key_enc) = <ver>
   UNION ALL SELECT 'outbox_recipient', COUNT(*) FROM notification_outbox WHERE recipient_enc IS NOT NULL AND ASCII(recipient_enc) = <ver>
   ```

2. **S-P19-T13 uyarısı:** `<ver>` koddaki sabit `NOTIFY_RECIPIENT_KEY_VERSION` (`lib/crypto.ts`; `recipient_hash` HMAC anahtarının
   sürümü) ise check-retire stderr'e `uyarı: sürüm <ver> NOTIFY_RECIPIENT_KEY_VERSION; …` yazar. Bu sürüm emekliye ayrılmadan
   **önce** sabit yeni sürüme taşınmış bir server sürümü yayınlanmalıdır (backend değişikliği; devops sabiti değiştirmez). Taşıma
   anında eski `recipient_hash`'ler yeni hash'lerle eşleşmez → alıcı tavanlarının (3/24 sa firma içi, 5/24 sa sistem) sayımı **bir kez,
   en çok 24 sa** sıfırlanır (kabul edilen risk; firma × kanal saatlik tavanı hash'e bağlı değildir ve korur). Bu 24 sa içinde
   `notify-volume` alarmı normalden dikkatli izlenir. Sabit taşınmadan sürüm çıkarılırsa server güncel sürüme düşer (gönderim
   durmaz) ama sayım yine sıfırlanır — taşıma yayın planına yazılır.
3. **`tenant_settings.sms_api_key_enc` > 0 → rewrap** (`crypto:rewrap tenant_settings.sms_api_key`). AAD etkin kökene bağlıdır; firma adresi (`sms_url`) **boş** satırlarda köken
   `SMSPORTAL_URL`'den alınır. `migrate` servisinin compose tanımında **ne `APP_ENCRYPTION_KEYS` ne `SMSPORTAL_URL` vardır** → ikisi
   de komuta tek seferlik, **değersiz `-e`** ile verilir (değer `.env`'den/kabuktan gelir; komut satırına, geçmişe, `ps`'e düşmez;
   §25.5 ön kontrol ve B yolu aynen geçerli). `-e SMSPORTAL_URL` unutulursa varsayılanı kullanan firmaların satırları
   **çözülemez** sayılır (atlanır, değişmez; `cozulemeyen > 0`, çıkış 1; çözülebilenler gerçek koşuda yeniden şifrelenir) →
   komut `-e SMSPORTAL_URL` ile yeniden çalıştırılır (yalnız kalan `--from <ver>` satırlarını taşır).

   ```bash
   cd /opt/remote/deploy            # ikinci yığın: /opt/remote-stg/deploy
   # ön kontrol: iki değişken de konteynere iniyor mu (yalnız uzunluk; 0 ise §25.5 B yolu, SMSPORTAL_URL için de aynı kalıp)
   docker compose run --rm -e APP_ENCRYPTION_KEYS -e SMSPORTAL_URL migrate \
     sh -c 'echo "anahtar_uzunlugu=${#APP_ENCRYPTION_KEYS} smsportal_uzunlugu=${#SMSPORTAL_URL}"'
   # kuru koşu (yazmaz): cozulemeyen=0 beklenir
   docker compose run --rm -e APP_ENCRYPTION_KEYS -e SMSPORTAL_URL migrate \
     pnpm --filter @remote/server cli crypto:rewrap tenant_settings.sms_api_key --from <ver> --dry
   # gerçek koşu (tek TX; firma sayısı küçük)
   docker compose run --rm -e APP_ENCRYPTION_KEYS -e SMSPORTAL_URL migrate \
     pnpm --filter @remote/server cli crypto:rewrap tenant_settings.sms_api_key --from <ver>
   docker ps -a --filter name=migrate-run --format '{{.Names}}'   # boş olmalı
   ```

   Beklenen: `crypto:rewrap tablo=tenant_settings.sms_api_key kaynak=<ver> hedef=<yeni> satir=<n> cozulemeyen=0 kuru=false`, audit
   `crypto.rewrap {table, fromVer, toVer, rows, …}` (aktör `system:cli`). `SMSPORTAL_URL` boşken varsayılanı kullanan satır varsa
   (`sms_url` NULL + anahtar dolu) bunlar zaten okunamıyordur (§26.3) → `cozulemeyen` kalır; o firmaların Admin'i anahtarı panelde
   yeniden girer, sonra adım 1 tekrarlanır. `SMSPORTAL_URL` değişimi (§26.3) ile emeklilik **aynı bakım penceresinde yapılmaz**:
   önce rewrap (eski kökenle), sonra adres değişimi.

4. **`notification_outbox.recipient_enc` > 0:** rewrap **yok**. Alıcı yalnız PENDING/SENDING'de doludur ve dakikalar içinde NULL'lanır →
   yeni sürüm `.env`'e eklenip `up -d server` yapıldıktan sonra sayım 0 olana dek beklenir (normalde ≤ 1 dk; `notify-outbox-pending`
   alarmı yoksa en geç birkaç dakika).
5. Üç sayım 0 → `session_messages` için §25.5/2 → sürüm halkadan çıkarılır, kasada saklama süresince tutulur (§25.5/3).

### 26.5 Form spam'i / bildirim istismarı (alarm `notify-volume` → eylem; S-P19-12, S-P19-T9)

Caddy logu ref'i yazmaz (`/r/***`, S-P19-10) — kaynak firma **server logu ve DB'den** bulunur:

1. Firma: `docker compose logs server --since 2h | grep notify.tenant_volume` (`tenantId`, `channel`, `count`; alıcı yok) ve
   `SELECT tenant_id, COUNT(*) FROM support_requests WHERE source='WEB' AND created_at > NOW() - INTERVAL 1 HOUR GROUP BY 1 ORDER BY 2 DESC LIMIT 5`.
   rate_limited ayrıntısı: `SELECT tenant_id, JSON_UNQUOTE(JSON_EXTRACT(new_value,'$.scope')) s, COUNT(*) FROM audit_logs WHERE
action='request.customer_notify' AND JSON_UNQUOTE(JSON_EXTRACT(new_value,'$.reason'))='rate_limited' AND created_at > NOW() - INTERVAL 1 HOUR GROUP BY 1,2`.
2. Firma Admin'ine haber verilir (meşru yoğunluk mu — kampanya, toplu duyuru — yoksa spam mı).
3. Spam ise Admin panelde **web formunu kapatır** (`web_form_enabled=false`; form hemen tek tip 404) ve sızan bağlantının
   **ref'ini yeniler** (Genel ref ya da ilgili müşterinin ref'i; eski `/r/<ref>` 404). Kılavuz: "Form spam'i altında ne yapılır".
   Form "çok yoğun / geçici olarak kullanılamıyor" yanıtı veriyorsa (firma token kümesi doldu, S-P19-K5) ilk müdahale
   **ref yenilemedir**: yeni ref ile form hemen açılır; eski bağlantı 30 dk sonra kendiliğinden temizlenir.
   Admin'e ulaşılamıyorsa Super Admin firma bağlamında aynısını yapar (audit'e düşer). DB'den doğrudan `UPDATE` yapılmaz
   (audit dışı kalır).
4. Doğrulama: `curl -s -o /dev/null -w '%{http_code}\n' https://<host>/r/<eski-ref>` → 404; 10–20 dk sonra `notify-volume` DUZELDI.
5. Tek kaynak IP'den yoğun istek varsa: `docker compose logs caddy --since 1h | grep '"/r/\*\*\*' | grep -o '"client_ip":"[^"]*"' | sort | uniq -c | sort -rn | head`
   → host güvenlik duvarında geçici engel (§13.4 kalıbı). Tavanlar zaten FAILED `rate_limited` üretir (kontör/numara korunur);
   alarm, firma payını meşru müşterilere kapatmamak için erken müdahale içindir.
6. **Sistem geneli alıcı tavanı (5/24 sa) yaklaşıktır (S-P19-K2, kabul edilen risk).** Firma içi alıcı (3/24 sa) ve firma × kanal
   tavanları firma ayar satırı kilidiyle kesindir; sistem geneli sayım farklı firmaların TX'leri arasında kilitsizdir. N firmada
   **aynı anda** sona eren/kabul edilen talepler aynı numaraya en çok `4 + N` bildirim üretebilir (her firmada yine en çok 3/24 sa).
   Belirti: aynı `recipient_hash` için 24 saatte 5'ten fazla `SENT`/`PENDING` satır —
   `SELECT recipient_hash, channel, COUNT(*) FROM notification_outbox WHERE created_at > NOW() - INTERVAL 1 DAY AND
(last_reason IS NULL OR last_reason <> 'rate_limited') GROUP BY 1,2 HAVING COUNT(*) > 5`. Eylem: hash'in geldiği firmalar
   (`tenant_id`) adım 1–3 ile ele alınır (çok firmada eşzamanlı WEB talebi = form istismarı). Kesin kilit (alıcı başına `GET_LOCK` /
   kilit tablosu) bilinçli olarak eklenmedi; gerekçe `docs/implementation.md` "P19 güvenlik düzeltme turu 1".

### 26.6 smsportal tek nokta arıza yolu (R31)

smsportal (arka planda NetGSM) tek örnektir; düştüğünde talep/oturum akışı **etkilenmez**, yalnız SMS bildirimi ve SMS ile bağlantı
gönderimi başarısız olur (outbox kalıcıdır, 3 deneme 0/10/30 sn sonra FAILED + audit; mesaj kaybı audit'te görünür).

1. Belirti: `notify-outbox-failed` (neden `unreachable`/`http_error`) ve/veya `notify-outbox-pending`; panelde "Test SMS" "ulaşılamadı".
2. Erişim: server konteynerinden `docker compose exec -T server node -e "fetch(process.env.SMSPORTAL_URL).then(r=>console.log(r.status)).catch(e=>console.log('HATA',e.cause?.code||e.message))"`
   (anahtarsız istek; 401/404 = servis ayakta, `HATA ECONNREFUSED/ETIMEDOUT` = erişilemiyor).
3. smsportal sahibine (aynı ekip; `smsportal` projesi) haber verilir; NetGSM kaynaklıysa (kontör bitti, başlık onayı) smsportal
   panelinden görülür. Remote tarafında yapılacak iş yoktur; kod değişmez.
4. Uzun kesintide (> 1 sa) firma Admin'lerine duyuru: "SMS bildirimleri geçici olarak gitmiyor; WhatsApp/e-posta bildirimi açık
   olabilir." Gerekirse Admin SMS bildirim kanalını geçici kapatır (FAILED gürültüsü ve audit hacmi azalır).
5. Servis dönünce yeni bildirimler kendiliğinden gider; FAILED olanlar **yeniden gönderilmez** (tasarım: durum bildirimi
   zamanlıdır). `notify-outbox-failed` 15–25 dk içinde DUZELDI.

## 27. P27 — gözetimsiz erişim altyapısı (devops K9, 2026-11-15; mimari-p27 §4.5, §8, §9 K9; AC-289, 297, 339, 340, 342)

Servis ikilisi `NoktaDestekServis.exe` (`apps/agent-win/cmd/noktadestek-servis`) Windows'ta SYSTEM hizmeti olarak kurulur; panel
"Gözetimsiz cihazlar" sayfasından (`/unattended`, `unattended.manage`; kayıt kodu penceresindeki "Servis programını indir") indirilir ve kayıt koduyla kaydolur. Sunucu tarafı tek kapı `UNATTENDED_MODE`.

### 27.1 Ortamlara göre değerler (yalnız `deploy/.env`; değerler ekrana basılmaz)

| Ortam                                                              | `DEPLOY_ENV`  | `UNATTENDED_MODE`                                                                    | `UNATTENDED_SIGNED_SHA256`                 | Servis ikilisi                                        |
| ------------------------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------ | ------------------------------------------ | ----------------------------------------------------- |
| Prod (`/opt/remote`, terfiden sonra)                               | `production`  | `unsigned-accepted` (P32 risk kabulü, ADR-0042; açılış §27.9) — açılıştan önce `off` | yayınlanmış Release SHA'ları (betik ekler) | `publish-servis.sh --tag vX.Y.Z` (attestation'lı)     |
| Staging (bugün `/opt/remote` 4450; P13c sonrası `/opt/remote-stg`) | `staging`     | `unsigned` (test); prod provasında geçici `unsigned-accepted`                        | `--tag` ile dolar; `dir-*` eklemez         | yerelde derlenmiş imzasız ikili (§27.3) ya da Release |
| Yerel                                                              | `development` | `off` (deneme için `unsigned` **olmaz** — yalnız staging)                            | boş                                        | gerekirse `--local`                                   |

Kurallar: `unsigned` hâlâ **yalnız** `DEPLOY_ENV=staging` iken açılır (aksi halde server açılış hatası verir — prod'a staging `.env`'i
kopyalamaya karşı korkuluk). `unsigned-accepted` (P32) yalnız `production`/`staging`'de açılır, "TEST" etiketlerini taşımaz; liste,
`UNATTENDED_AGENT_SHA256` ve `UNATTENDED_AGENT_VERSION` dolu olmalı, ajan SHA'sı listede olmalı (§27.9). Staging'e **gerçek müşteri cihazı kaydedilmez** (imzasız SYSTEM servisi; gösterge "TEST — imzasız").
Panel bandı "TEST ortamı — imzasız servis" görünür.

### 27.2 Staging açılışı (koordinatör uygular; her adım komut → beklenen)

Ön koşul: P27 migration'ı staging'de uygulandı (`docker compose run --rm migrate`), imaj P27 commit'inden.

1. `.env` teyidi: `cd /opt/remote/deploy && grep -c '^DEPLOY_ENV=staging$' .env` → `1`. Yoksa ekle (`DEPLOY_ENV=staging`).
2. Kapıyı aç: `grep -q '^UNATTENDED_MODE=' .env && sed -i 's/^UNATTENDED_MODE=.*/UNATTENDED_MODE=unsigned/' .env || echo UNATTENDED_MODE=unsigned >> .env`
   → `grep -c '^UNATTENDED_MODE=unsigned$' .env` → `1`.
3. Compose doğrulaması: `docker compose config --format json | jq -r '.services.server.environment | .DEPLOY_ENV, .UNATTENDED_MODE, .UNATTENDED_AGENT_PATH'`
   → `staging`, `unsigned`, `/data/unattended/NoktaDestekServis.exe`.
4. İkiliyi yayınla (§27.3) — `publish-servis.sh` server'ı yeniden yaratır ve sağlıklı olmasını bekler. İkiliyi yayınlamadan
   yalnız kapı açılacaksa: `docker compose up -d --no-deps server` → `docker compose ps server` healthy.
5. Açılış logu (server her açılışta yazar; SHA listesi yazılmaz): `docker compose logs server --since 5m | grep -m1 unattended.mode`
   → satırda `unattended.mode=unsigned deployEnv=staging`. Ek teyit: `docker compose exec -T server printenv DEPLOY_ENV UNATTENDED_MODE`
   → `staging`, `unsigned`.
6. Panel: Super Admin (firma seçili) / Admin → kenar çubuğu **Gözetimsiz cihazlar** → bant "TEST ortamı — imzasız servis";
   Kayıt kodları → Kayıt kodu oluştur → pencerede **Servis programını indir** `NoktaDestekServis.exe` verir
   (503 ise §27.8). `curl` ile kimliksiz deneme: `curl -sk -o /dev/null -w '%{http_code}\n' https://<host>/downloads/NoktaDestekServis.exe` → `404`
   (Caddy public yolu yok; volume Caddy'ye bağlı değil).
7. Duman testi (Windows VM, staging adresli ikili): kayıt kodu üret → VM'de kur (§27.7) → panelde çevrimiçi → bağlan → müşteri
   adresine "gözetimsiz bağlantı başladı" e-postası ≤ 60 sn → yerel kapat ≤ 2 sn → cihaz iptal ≤ 10 sn.

### 27.3 İmzasız servis ikilisini sunucuya koymak (staging)

İkili sunucu adresini derleme zamanında gömer (ldflags; AC-340). Staging adresi = staging `.env` `PUBLIC_BASE_URL` kökeni
(`https://host[:port]`). Operatör makinesinde, repo kökünde (Go gerekmez):

```bash
SERVER='https://<staging PUBLIC_BASE_URL kökeni>'; VER=0.13.0      # MIN_AGENT_VERSION'dan düşük olmamalı
OUT="$(mktemp -d)"
docker run --rm -v "$PWD:/src" -v "$OUT:/out" -w /src -e GOFLAGS=-mod=readonly -e GOTOOLCHAIN=local \
  golang:1.26.11-bookworm@sha256:dc40a13b61304647ed7e5d581d246b86413dfc29d63c6d018310feb93cd98fc0 sh -c '
  git config --global --add safe.directory /src; export SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)
  apps/agent-win/build/build.sh "$0" "$1" /out/NoktaDestekServis.exe noktadestek-servis' "$SERVER" "$VER"
(cd "$OUT" && shasum -a 256 NoktaDestekServis.exe > SHA256SUMS && cat SHA256SUMS)
ALLOW_UNATTESTED=staging deploy/agent/publish-servis.sh --dir "$OUT" --no-attestation --ssh root@185.126.217.99 \
  --deploy-dir /opt/remote/deploy          # P13c ikinci yığında: /opt/remote-stg/deploy
```

Beklenen son satırlar: `yayınlandı: unattended_downloads/NoktaDestekServis.exe (dir-…-unattested, <sha>)` ve
`kontrol: server UNATTENDED_AGENT_PATH SHA-256 = UNATTENDED_AGENT_SHA256 = <sha>`. Betik: SHA256SUMS ↔ dosya, PE + ≤ 40 MB +
UPX yok + manifest `asInvoker`; sunucuda ortam kilidi (`production` hedefe yalnız `vX.Y.Z` Release), ağsız yardımcı konteynerle
`unattended_downloads` volume'una atomik yazım (0644), `.env` `UNATTENDED_AGENT_SHA256` (yedek `.env.bak.servis.<zaman>`, kip 600, son 10; P32: `dir-*` yayını izinli listeye eklemez ve
`UNATTENDED_AGENT_VERSION`'ı boşaltır — `unsigned-accepted` bu ikiliyle açılmaz, §27.9),
`PUBLISHED.log`'a `servis` satırı, `docker compose up -d --no-deps server` + healthy + konteyner içinden SHA eşitliği.
Volume salt okunur ve yalnız server'a bağlı: Caddy ve web dosyayı göremez. Yerel deneme: `--local` (yığın `deploy/`).

### 27.4 CI (`.github/workflows/agent-win.yml`)

- `build` (×2): `NoktaDestek.exe` + `NoktaDestekServis.exe` (`build/build.sh … noktadestek-servis`, `build/winres-servis.json`,
  manifest `asInvoker`). `reproducible`: iki ikili için ayrı ayrı SHA eşitliği, ≤ 40 MB, MZ, UPX yok, `asInvoker`; `SHA256SUMS`
  iki satır. Adlar: dal/PR `NoktaDestekServis.exe`, staging dispatch `NoktaDestekServis-stg-<sürüm>.exe`, Release
  `NoktaDestekServis-<sürüm>.exe`. `attest` iki ikiliyi, `release` ikisini + `SHA256SUMS`'u yükler.
- `test-windows`: "trace-check -Servis öz testi (P27)" — kurulum izi (hizmet, HKLM, Run, Uninstall, olay kaynağı, Program Files,
  ProgramData korumalı DACL) yer tutucu adresli ikiliyle elle kurulur; temiz/ACL bozuk/`device.key.tmp`/tırnaksız ImagePath/
  kaldırma sonrası artık izler için beklenen çıkış kodları denetlenir. Hizmet başlatılmaz.
- `sign` (SignPath varsa): iki PE tek artifact'te gönderilir. **SignPath artifact yapılandırması** iki dosyayı da imzalayacak
  biçimde güncellenmeli (`<pe-file path="NoktaDestek.exe"/>` + `<pe-file path="NoktaDestekServis-*.exe"/>`); güncellenmezse
  `signtool verify` adımı "SignPath çıktısında … yok" ile kırmızı olur (fail-closed).
- `ci.yml` compose adımı: `.env`'e `DEPLOY_ENV=production` (sahte), server'da `DEPLOY_ENV` var ve tek servis, `unattended_downloads`
  Caddy'de yok, `DEPLOY_ENV` boşken compose durur.

### 27.5 İmza gelince (`signed`) — kod değişmez, yalnız env

1. Release `vX.Y.Z` (SignPath'li) → `gh release download vX.Y.Z -p SHA256SUMS -p 'NoktaDestekServis-*.exe'` →
   `gh attestation verify NoktaDestekServis-X.Y.Z.exe --repo NoktaBilisim/Remote --signer-workflow NoktaBilisim/Remote/.github/workflows/agent-win.yml --source-ref refs/tags/vX.Y.Z`.
2. Liste P32'den beri **betikle dolar** (`publish-servis.sh --tag`, §27.9); `signed`'a geçişte yalnız mod değişir:
   `UNATTENDED_MODE=signed`. Listede yalnız imzalı sürümlerin SHA'ları kalmalıdır: imzasız dönemden kalan SHA'lar §27.9 "Liste temizliği ve iki aşamalı geri çekme" ile
   geri çekme ile çıkarılır (eski sürüm listeden çıkınca o cihazlar 4403 alır; önce cihazlar güncellenir).
3. `deploy/agent/publish-servis.sh --tag vX.Y.Z --ssh root@<sunucu>` → SHA listeye eklenir, server yeniden yaratılır.
4. Doğrulama: panel bandı yok, cihaz listesinde "İmzasız" rozeti yok.

### 27.6 Kapatma, geri alma ve migration geri dönüşü

- Acil kapatma (her ortam): `sed -i 's/^UNATTENDED_MODE=.*/UNATTENDED_MODE=off/' .env && docker compose up -d --no-deps server`
  → cihazlar 4403 ile reddedilir (servisler bekleme döngüsünde), kayıt/kod/bağlan 409. Cihaz kaydı silinmez.
- Uygulama geri alma: **önce `off`, sonra imaj** (P32, S-P32-7): `grep -q '^UNATTENDED_MODE=unsigned-accepted' .env && echo DUR` → `DUR` yazarsa
  `sed -i 's/^UNATTENDED_MODE=.*/UNATTENDED_MODE=off/' .env && docker compose up -d --no-deps server` (healthy), sonra önceki `IMAGE_TAG`
  → `docker compose up -d server web`. P32 öncesi imaj `unsigned-accepted`'i tanımaz ve açılmaz; liste ve `UNATTENDED_AGENT_VERSION`
  satırları kalabilir (eski imaj okumaz).
- Migration geri alma (`down.sql`): önce `UNATTENDED_MODE=off`, açık gözetimsiz oturum kalmadığını panelden teyit et, sonra dba'nın
  down adımı (UNATTENDED satır varsa down ön kontrolü uyarır).
- Cihaz toplu iptali SQL'siz panelden (Gözetimsiz cihazlar → cihaz → Cihazı iptal et). Yedek: yeni tablolar mysqldump kapsamında; `device.key`
  cihazdadır, sunucu yedeği gerekmez.

### 27.7 Windows iz testi (`trace-check.ps1 -Servis`, yönetici PowerShell)

Kurulu cihazda: `pwsh -File apps\agent-win\test\trace-check.ps1 -Mode Check -Servis on` → `TEMİZ` (ImagePath tırnaklı ve Program
Files altında, ProgramData/Gelen sahip + korumalı DACL + ACE kümesi, reparse yok). Kaldırma öncesi
`-Mode Snapshot -SnapshotPath D:\once.json` (kurulumdan önce alınmış olmalı) → kaldır → `-Mode Compare -SnapshotPath D:\once.json`
→ `TEMİZ`. `NoktaDestek Servis.eski-*` (squatting önlemi) UYARI olarak listelenir; içeriği incelenip elle silinir. Kaldırmadan hemen sonra
`%SystemRoot%\Temp\NoktaDestekServis-kaldir-*` (kaldırıcının geçici kopyası, D-P27-K5) yeniden başlatmada silinmek üzere kayıtlıysa
UYARI, kayıtlı değilse iz sayılır; bilgisayar yeniden başlatılıp `-Mode Compare` tekrarlanır → uyarısız `TEMİZ`.

### 27.8 Sorun giderme ve operasyon notları

| Belirti                                                                                                     | Neden / eylem                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker compose` "DEPLOY_ENV gerekli"                                                                       | `.env`'de `DEPLOY_ENV` yok/boş → ortama göre ekle (§27.1)                                                                                                                                                                                                                              |
| server açılmıyor, log `UNATTENDED_MODE: unsigned yalnız DEPLOY_ENV=staging`                                 | prod'a staging `.env`'i kopyalanmış → `UNATTENDED_MODE=off`                                                                                                                                                                                                                            |
| log `DEPLOY_ENV gerekli (production)` / `(UNATTENDED_MODE off değil)`                                       | `.env` `DEPLOY_ENV` boş ama compose dışı çalıştırma (yerel `pnpm`) → `.env`'e ekle                                                                                                                                                                                                     |
| log `UNATTENDED_SIGNED_SHA256: signed modda zorunlu`                                                        | liste boş → §27.5 ya da `off`                                                                                                                                                                                                                                                          |
| panel "Servis programını indir" 503                                                                         | `UNATTENDED_AGENT_SHA256` boş veya volume'daki dosya farklı → §27.3 yeniden yayınla                                                                                                                                                                                                    |
| Cihazlar sunucu yeniden başlarken 503 alıyor                                                                | K-P27-21: kimliksiz soket tavanı IP başına 5; aynı NAT arkasında ≥ 6 cihaz üstel beklemeyle toparlanır, eylem gerekmez                                                                                                                                                                 |
| AV/SmartScreen servisi engelliyor (R-P27-2)                                                                 | prod'da (`unsigned-accepted`) beklenen: kullanım kılavuzu — önce `Get-FileHash` ile SHA karşılaştırması, sonra "Ek bilgi → Yine de çalıştır"; AV/EDR istisnası Admin kararıdır ve **dosya özetiyle** (ya da tam yol + özet) verilir, klasör joker değil; her sürümde yenilenir (§27.9) |
| server açılmıyor, log `unsigned-accepted yalnız DEPLOY_ENV=production\|staging`                             | `.env` `DEPLOY_ENV` `development`/boş → ortama göre düzelt ya da `UNATTENDED_MODE=off`                                                                                                                                                                                                 |
| server açılmıyor, log `UNATTENDED_AGENT_SHA256 izinli listede değil`                                        | ikili elle değiştirilmiş ya da SHA listeden yanlışlıkla çıkarılmış → `publish-servis.sh --tag vX.Y.Z` ile yeniden yayınla (§27.9); acilse `off`                                                                                                                                        |
| server açılmıyor, log `unsigned-accepted modda UNATTENDED_AGENT_SHA256 ve UNATTENDED_AGENT_VERSION zorunlu` | son yayın `dir-*` (staging) ya da hiç yayın yok → `--tag vX.Y.Z` ile yayınla                                                                                                                                                                                                           |
| server açılmıyor, log `UNATTENDED_SIGNED_SHA256` 20 öğe sınırı                                              | elle fazla öğe eklenmiş → §27.9 "Acil yol (liste dolu)" (kullanımı 0 olan en eski SHA'yı çıkar)                                                                                                                                                                                        |
| cihaz rozeti "İzinli sürüm değil" (Bağlan pasif, 4403)                                                      | cihazın beyan ettiği SHA listede değil (eski/çıkarılmış sürüm ya da yerel derleme) → panelden servisi güncelle / yeniden kur; sürüm↔SHA `agent/PUBLISHED.log`                                                                                                                          |

Alarm eşikleri (mimari-p27 §7.3; `/metrics`, Bearer `METRICS_TOKEN`):

- `rs_unattended_device_auth_total{result="bad_sig"}`: 10 dk'da 20'den fazla → uyarı (anahtar sızıntısı / deneme).
- `rs_unattended_device_replaced_total`: 10 dk'da 3'ten fazla → uyarı (aynı anahtar iki makinede — klon).
- `rs_unattended_register_total{result="cap"}`: sıfırdan büyük → uyarı (kayıt kodu tahmin denemesi).
- `rs_unattended_device_auth_total{result="unauth_cap"}`: sıfırdan büyük → uyarı (bağlantı seli).
- `rs_unattended_device_auth_total{result="revoked"}`: iptal edilmiş cihaz bağlanmayı sürdürüyor; tek seferlik artış normaldir
  (iptal anı, bağlanırken gelen iptal dahil); aynı cihazdan süregelen artış → uyarı (servisi kaldırılmamış cihaz veya
  kopyalanmış anahtar; mimaride sayısal eşik yok).
- `rs_unattended_device_auth_total{result="tenant_passive"}`: pasif firmanın cihazları bağlanmaya çalışıyor → bilgi; süregelen
  artışta firma yeniden etkinleştirilmeyecekse cihazlar iptal edilir.
- `rs_unattended_connect_total{result="ok"}`: mesai dışı ani artış → bilgi.

**Durum:** `remote-watch` otomasyonu bu P27 serilerini henüz okumuyor (K9 açık işi; P28u'dan yalnız `unattended-notify-fail` okunur — §28u.6, r3). O gelene kadar elle bakılır:
`docker compose exec -T server node -e "fetch('http://127.0.0.1:3001/metrics',{headers:{authorization:'Bearer '+process.env.METRICS_TOKEN}}).then(r=>r.text()).then(t=>console.log(t.split('\n').filter(l=>l.startsWith('rs_unattended_')).join('\n')))"`

### 27.9 Prod'da imzasız gözetimsiz servis — risk kabulü (P32; devops K3, 2026-11-20; mimari-p32 §8, ADR-0042; AC-527b, 529, 532)

Kullanıcı kararı (2026-11-20): servis prod'da Authenticode/SignPath imzası olmadan çalışır, risk kabul (R-P32-1). Mod
`UNATTENDED_MODE=unsigned-accepted`. İzinli liste (`UNATTENDED_SIGNED_SHA256`) kimlik doğrulama değil, **sürüm kapısıdır**: cihaz
beyanına dayanır; yanlış/staging/yerel derlemenin bağlanmasını önler ve açıklı bir sürümü devre dışı bırakmayı sağlar.

**Değişmez kurallar**

- Listeye **elle SHA eklenmez.** Yalnız `deploy/agent/publish-servis.sh --tag vX.Y.Z` ekler (her ortamda yalnız Release; prod'da
  attestation zorunlu). `dir-*` / `*-unattested` (yalnız staging) listeye girmez ve `UNATTENDED_AGENT_VERSION`'ı boşaltır →
  `unsigned-accepted` bu ikiliyle açılmaz. Elle eklenen öğe remote-watch'ta `unattended-list-unpublished` ALERT'i verir.
- Liste en çok 20 öğe (env.ts). Betik 16'da `UYARI: UNATTENDED_SIGNED_SHA256 16 öğe` yazar, 20'yi aşacaksa **hiçbir şey yazmadan**
  `liste dolu — runbook §27.9 acil yol` ile durur (ikili, volume, `.env`, `PUBLISHED.log` değişmez).
- `.env` yedekleri `.env.bak.servis.<UTC zaman>` kip 600, son 10 tutulur; geçici dosya `umask 077`. `.env` atomik yazılır
  (S-P32-K-2): aynı dizinde `.env.tmp.<zaman>` → mevcut `.env`'in kip/sahipliği kopyalanır → `mv -f`; kesintide `.env` ya eski ya yeni
  hâlindedir. Kip/sahiplik aktarılamazsa betik `.env`'e dokunmadan durur. Kesinti sonrası kalan `.env.tmp.*` silinebilir. Yedekler sır içerir: kopyalanmaz.
- Geri alma sırası: **önce `off`, sonra imaj** (aşağıda "Geri alma / kapatma").

**Açılış sırası (her adım komut → beklenen; sunucuda `cd /opt/remote/deploy`)**

1. Ön koşullar: P32 imajı prod'da, `grep -c '^UNATTENDED_MODE=off$' .env` → `1` (ya da satır yok). P29 servis güncellemesi
   isteniyorsa P29-K0s/K7 Windows maddeleri staging'de GEÇTİ (değilse manifest yayınlanmaz, servis elle güncellenir).
   remote-watch: `grep -c '^WATCH_DEPLOY_ENV=production$' /etc/remote-watch/watch.env` → `1` ve P32 betiği kurulu (§20.4).
2. Staging provası (test-operatoru, K5; staging adresli Release ile): `publish-servis.sh --tag vX.Y.Z --ssh root@<staging>` →
   staging `.env` `UNATTENDED_MODE=unsigned-accepted` → `docker compose up -d --no-deps server` → AC-525..527, 533, `Get-FileHash`,
   SmartScreen duman → staging `unsigned`'a döner. `dir-*` ikiliyle `unsigned-accepted` denenirse server açılmaz (beklenen, §27.8).
3. İkili + liste (operatör makinesi, repo kökü):
   `deploy/agent/publish-servis.sh --tag vX.Y.Z --ssh root@185.126.217.99`
   → `attestation: OK …`, `izinli liste: <n> öğe (UNATTENDED_SIGNED_SHA256), UNATTENDED_AGENT_VERSION=X.Y.Z`,
   `kontrol: server UNATTENDED_AGENT_PATH SHA-256 = UNATTENDED_AGENT_SHA256 = <sha>`.
4. Modu aç: `sed -i 's/^UNATTENDED_MODE=.*/UNATTENDED_MODE=unsigned-accepted/' .env && docker compose up -d --no-deps server`
   → `docker compose ps server` healthy; `docker compose logs server --since 5m | grep -c unattended_unsigned_risk_accepted` → `1`;
   `docker compose logs server --since 5m | grep -m1 unattended.mode` → `unattended.mode=unsigned-accepted deployEnv=production`.
5. Liste denetimi (her listede öğe `PUBLISHED.log`'da `servis vX.Y.Z <sha>` olarak var mı; remote-watch'un yaptığının elle hâli):

   ```bash
   awk -F= '$1=="UNATTENDED_SIGNED_SHA256"{sub(/^[^=]*=/,"");print}' .env | tr ',' '\n' | tr -d ' \r"' | tr A-F a-f | awk NF |
     while read -r s; do
       awk -v s="$s" '$2=="servis" && $3 ~ /^v[0-9]+\.[0-9]+\.[0-9]+$/ && $4==s {f=1} END{exit !f}' agent/PUBLISHED.log \
         && echo "ok ${s:0:12}" || echo "EKSIK ${s:0:12}"
     done
   ```

   → her satır `ok`. `EKSIK` varsa: elle eklenmiş öğe → çıkarın ve `--tag` ile yayınlayın; açıklanamıyorsa güvenlik olayı ("Geri alma / kapatma": acil `off`).

6. remote-watch (≤ 10 dk): `journalctl -t remote-watch --since -30min | grep -E 'check=unattended-'` → `unattended-mode-changed`
   tek seferlik ALERT'i **bir ya da iki kez** (m.3 yayını mod `off` iken listFingerprint'i değiştirir, m.4 modu değiştirir; ikisi aynı
   10 dk'lık tura düşerse tek alarm) ve son satır `… ->unsigned-accepted/<listFingerprint>` (+ Telegram). Sonraki turlarda yalnız
   `BILGI check=unattended-unsigned-accepted … listFingerprint=<fp>` ve `BILGI check=unattended-deploy-env OK DEPLOY_ENV=production`.
   `<fp>` açılış logundaki `listFingerprint` ile aynı olmalıdır (tanım: öğeler kırpılır, küçük harf, boşlar atılır, `LC_ALL=C`
   sıralanır, `,` ile birleştirilir, SHA-256 ilk 12 hane; boş liste `e3b0c44298fc`).
7. (P29 açıksa) `deploy/agent/publish-manifest.sh --tag vX.Y.Z --ssh root@<prod>` — manifest SHA listede olduğu için sunulur.
8. §20.3 m.16 kanıtı (yönetici makinesi; çıktı kanıt dosyasına, sır yok):

   ```bash
   gh api repos/NoktaBilisim/Remote/rulesets --jq '.[] | select(.target=="tag") | {id, name, enforcement}'
   #   enforcement "active" olan v* kuralının id'si ile:
   gh api repos/NoktaBilisim/Remote/rulesets/<id> \
     --jq '{enforcement, include: .conditions.ref_name.include, rules: [.rules[].type], bypass: [.bypass_actors[]? | {actor_type, actor_id, bypass_mode}]}'
   #   beklenen: include ["refs/tags/v*"]; rules creation, update, deletion (varsa non_fast_forward); bypass YALNIZ
   #   actor_type "RepositoryRole" = Admin rolü (id imza anında Settings → Rules ekranıyla doğrulanır) — Integration/Team/User/
   #   OrganizationAdmin/DeployKey girdisi yok (DeployKey: dağıtım anahtarı sahibi etiketi kuralı atlayarak açabilir).
   #   Not: bypass listesi boş olamaz; boşsa kimse v* etiketi oluşturamaz (§11.1 kurulumu).
   gh api 'repos/NoktaBilisim/Remote/collaborators?permission=admin' --jq '.[].login'
   #   beklenen: YALNIZ beklenen yönetici login(ler)i (Admin rolü bypass'ı bu kişilere geçer; fazlası varsa imza atılmaz,
   #   Settings → Collaborators'tan rol düşürülür ve komut yeniden koşulur)
   gh api repos/NoktaBilisim/Remote/environments/agent-release \
     --jq '{can_admins_bypass, reviewers: [.protection_rules[]? | select(.type=="required_reviewers") | .reviewers[]?.reviewer.login], policy: .deployment_branch_policy}'
   #   beklenen: can_admins_bypass false; reviewers boş değil; policy custom (yalnız v* etiketi)
   ```

   `can_admins_bypass: true` çıkarsa imza atılmaz: Settings → Environments → `agent-release` → "Allow administrators to bypass" kapatılır,
   komut yeniden koşulur.

9. Windows VM duman (kullanıcı/test-operatoru): panelden indir → PowerShell `Get-FileHash .\NoktaDestekServis.exe -Algorithm SHA256`
   = panel/mesajdaki SHA → SmartScreen'de yayıncı "Bilinmiyor", dosya adı `NoktaDestekServis.exe` → "Ek bilgi → Yine de çalıştır"
   → kayıt → bağlan → bildirim e-postası → yerel kapat → iptal. §20.3 m.16 imzası.

**Liste temizliği ve iki aşamalı geri çekme (elle; tek yol `.env` düzenleme + `docker compose up -d --no-deps server`)**

- Olağan temizlik: Panel → Gözetimsiz → sürüm dağılımında bir sürümü kullanan cihaz 0 olunca o sürümün SHA'sı (`PUBLISHED.log`'dan
  sürüm↔SHA) listeden çıkarılır. `UNATTENDED_AGENT_SHA256` (şu an yayınlanan) çıkarılamaz — açılış hatası; önce yeni sürüm yayınlanır.
- Açıklı sürüm, **aşama 1 (olağan):** düzeltilmiş sürüm `--tag` ile yayınlanır, manifest sunulur (§31.4); eski sürüm dağılımda 0'a
  iner ya da en çok **7 gün** beklenir; sonra SHA çıkarılır. Bu sürede açıklı sürüm bağlanabilir (kabul edilen bedel).
- **Aşama 2 (aktif istismar):** SHA **hemen** çıkarılır. O SHA'daki cihazlar 4403 alır ve P29 güncelleme teklifini de alamaz (aynı
  soket) → elle yeniden kurulum; Admin'lere duyuru yapılır. Gerekirse önce tüm kapı `off`.
- **Acil yol (liste dolu, betik `liste dolu` ile durdu):** kullanımı 0 olan en eski SHA çıkarılır → `up -d --no-deps server` → yayın
  yeniden koşulur.
- Her çıkarma remote-watch'ta bir kez `ALERT check=unattended-mode-changed …` üretir (beklenen; listFingerprint değişti).

**remote-watch kontrolleri (`deploy/ops/remote-watch.sh`, 10 dk; S-P32-3/5, S-P32-r2-1/r2-2)**

| Kontrol                                    | Koşul                                                                                                                                                          | Ne yapılır                                                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `BILGI check=unattended-unsigned-accepted` | mod `unsigned-accepted` (her tur; alarm değil, durum OK). ≥ 16 öğede ayrıca `BILGI check=unattended-list-size`                                                 | yok; 16+'da temizlik planlayın                                                                                   |
| `unattended-deploy-env`                    | server `DEPLOY_ENV` ≠ `WATCH_DEPLOY_ENV`; ya da mod `off` değilken `WATCH_DEPLOY_ENV` boş                                                                      | staging `.env`'i prod'a kopyalanmış olabilir → `.env` karşılaştır; acil `off`. Boşsa §20.4                       |
| `unattended-list-unpublished`              | mod `signed`/`unsigned-accepted` ve listede `PUBLISHED.log`'da `servis vX.Y.Z <sha>` satırı olmayan öğe (yalnız ilk 12 hane yazılır) ya da `PUBLISHED.log` yok | m.5 denetimi; elle eklenmiş öğeyi çıkarın; açıklanamıyorsa güvenlik olayı                                        |
| `unattended-agent-version-mismatch`        | `UNATTENDED_AGENT_VERSION` dolu (ya da mod `unsigned-accepted`) ve `PUBLISHED.log`'da `servis v<sürüm> <UNATTENDED_AGENT_SHA256>` yok                          | `.env` elle düzenlenmiş: müşteri mesajındaki sürüm yanlış → `publish-servis.sh --tag` ile yeniden yayınlayın     |
| `unattended-mode-changed`                  | mod ya da `listFingerprint` önceki turdan farklı (durum `/var/lib/remote-watch/unattended.state`)                                                              | **bir kez** gönderilir, DUZELDI yok; değişiklik planlı mı teyit edin. Gönderim başarısızsa sonraki turda yeniden |

Server konteyneri yoksa bu kontroller atlanır ve durum dosyasına dokunulmaz (`ready`/`compose:server` zaten ALERT verir).
Konteyner **çalışıyor ama env okunamıyorsa** (`docker exec … node -e` hatası/20 sn zaman aşımı) **ALERT `unattended-env-read`**
(S-P32-K-1): mod bilinmediği için sessiz atlama yerine güvenli taraf seçilir; durum dosyasına yine dokunulmaz. Yapılacak:
`docker exec <server> node -e 'console.log(process.env.UNATTENDED_MODE||"")'` elle denenir; imaj/`node` yolu değiştiyse ya da
konteyner yeniden başlıyorsa düzeltilir. Geçici hatada bir sonraki turda DUZELDI gelir.

**Geri alma / kapatma**

- Acil kapatma (her ortam): `sed -i 's/^UNATTENDED_MODE=.*/UNATTENDED_MODE=off/' .env && docker compose up -d --no-deps server` → ≤ 60 sn
  cihazlar 4403, kayıt/kod/bağlan 409; kayıtlar silinmez (§27.6). remote-watch bir kez `unattended-mode-changed …->off/…`.
- İmaj geri alma: **önce** `grep -q '^UNATTENDED_MODE=unsigned-accepted' .env && echo DUR` → `DUR` ise yukarıdaki `off`, sonra
  önceki `IMAGE_TAG` (§27.6, §8). P32 öncesi imaj `unsigned-accepted`'i tanımaz → açılış hatası.
- `publish-servis.sh` geri alma: son `.env.bak.servis.<zaman>` (`cp .env.bak.servis.<zaman> .env && chmod 600 .env`) + önceki
  sürümün `--tag` yayını (§11.4 ile aynı ilke).

**Denenme durumu:** betik davranışı yerelde test edildi (`deploy/agent/test-publish-lock.sh` P32 vakaları, `deploy/ops/test-watch.sh`
P32 vakaları; 2026-11-20 GEÇTİ). Sunucuda açılış/geri alma sırası **denenmedi** — ilk koşu K5 staging provasıdır (m.2); sonucu
`docs/test-raporu.md`'ye ve bu bölüme yazılır.

**Kullanıcıya not (kılavuz, K6):** SmartScreen "Ek bilgi → Yine de çalıştır"dan **önce** yayıncı "Bilinmiyor", dosya adı
`NoktaDestekServis.exe` ve `Get-FileHash` çıktısı = paneldeki/mesajdaki SHA-256 denetlenir; eşleşmezse çalıştırılmaz, destek
firmasına bildirilir. AV/EDR istisnası dosya özetiyle verilir, her sürümde yenilenir.

## 28a. P28a — pano senkronu + uzaktan yazdırma, istemci 0.13.0 (devops K7, 2026-11-16; mimari-p28 §8, §9, §10 K7; ADR-0031; AC-343..352)

Kapsam: teknisyen konsolu ↔ Windows istemcisi arasında metin panosu (en çok 64 KB) ve PDF'in müşterinin varsayılan yazıcısına
gönderilmesi (en çok 20 MiB, müşteri onayıyla). İçerik (pano metni, PDF, dosya adı, hash) sunucudan **geçmez**; sunucu yalnız kimlik + bayt +
sonuç taşır. **Yeni env değişkeni, migration ve feature flag yok** (mimari-p28 §8.3–8.4): açma/kapama yetki toggle'ı
(`remote_control.clipboard`, `file_transfer.print`) + istemci sürümüdür.

### 28a.1 Gözetimsiz odada kapalı (bilerek)

Gözetimsiz (P27 servis) oturumlarında pano ve yazdırma **çalışmaz**: sunucu gözetimsiz bilet soketinde `guestFeatures=[]` uygular
(istemci `rs.cap.clip1` / `rs.cap.print1` gönderse bile — O-P28a-4), konsol "Gözetimsiz oturumda kullanılamaz — müşteri onayı gerekir"
gösterir, `print.request` → `FORBIDDEN` (`rs_clip_print_denied_total{reason="feature"}`). Servis yardımcısı (`helper`) `features=nil` ile
başlar. Bu bir arıza değildir; açmak için mimari değişikliği gerekir (müşteri onayı olmayan yazdırma/pano okuma yasak).

Diğer kapalı durumlar (arıza değil): tarayıcı müşterisi (yazdırma gizli), kontrol izni yok (VIEW), müşteri "Pano paylaşımına izin ver"
kutusunu açmamış, eski istemci (< 0.13.0 → "Müşterinin uygulaması bu özelliği desteklemiyor").

### 28a.2 Metrikler (`/metrics`, Bearer `METRICS_TOKEN`; `apps/server/src/ops/metrics.ts`)

| Seri                                            | Etiketler                                                                                                                                                                                              | Okuma                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `rs_clipboard_transfer_total{direction,result}` | `direction`: `TO_CUSTOMER` (konsol → müşteri panosu) / `TO_TECH` (müşteri panosu → konsol); `result`: `OK`, `EMPTY`, `TOO_LARGE`, `SENSITIVE`, `INVALID`, `DENIED`, `ERROR`, `TIMEOUT`, `DISCONNECTED` | `SENSITIVE` normaldir (parola yöneticisi işaretli içerik okunmaz). `TIMEOUT`/`ERROR` artışı → §28a.3       |
| `rs_print_job_total{result}`                    | `PRINTED`, `NO_PRINTER`, `REJECTED`, `TIMEOUT` (müşteri 60 sn yanıt vermedi), `INVALID_PDF`, `TOO_LARGE`, `BUSY`, `CANCELLED`, `ERROR`, `ABANDONED`, `DISCONNECTED` (son ikisini yalnız sunucu üretir) | Başarı oranı = `PRINTED` / (toplam − `REJECTED` − `TIMEOUT` − `CANCELLED`). Müşteri reddi arıza değildir   |
| `rs_clip_print_denied_total{kind,reason}`       | `kind`: `clip`, `print`, `consent`; `reason`: `permission`, `no_guest`, `feature`, `control`, `consent`, `pending`, `rate`, `cooldown`, `limit`, `reuse`, `unmatched_report`, `unmatched_cancel`       | Konsol düğmeyi önceden pasifler; süregelen `reuse`/`unmatched_*`/`rate` = değiştirilmiş istemci → güvenlik |

Okuma (sunucuda, yığın klasöründe):

```bash
docker compose exec -T server node -e "fetch('http://127.0.0.1:3001/metrics',{headers:{authorization:'Bearer '+process.env.METRICS_TOKEN}}).then(r=>r.text()).then(t=>console.log(t.split('\n').filter(l=>/^rs_(clipboard_transfer|print_job|clip_print_denied)_total/.test(l)).join('\n')))"
```

Alarm eşiği yok (düşük hacim, mimari-p28 §8.2). Elle bakış kuralı: bir günde `rs_print_job_total{result="ERROR"}` yazdırma işlerinin
%20'sinden fazlaysa → §28a.3 ve müşteriden istemci tanılama logu istenir. `rs_clip_print_denied_total{reason=~"reuse|unmatched_report|unmatched_cancel"}`
sıfırdan büyükse server logunda `ws_clip_print_denied` (oda başına dakikada 1 satır; içerik/kimlik yok) satırları incelenir. Audit: Audit Log
ekranında işlem `clipboard.consent`, `clipboard.transfer`, `print.job` (dosya adı ve hash **yok**, AC-351).

### 28a.3 "Yazdırma başarısız" — sorun giderme

Konsoldaki sonuç metni ve audit `print.job.new_value.result` aynı koddur. Sıra: koda bak → tabloya göre eylem.

| Sonuç (konsol metni)                                         | Olası neden                                                                                                                                                                                                                | Eylem                                                                                                          |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `NO_PRINTER` "Müşterinin varsayılan yazıcısı yok"            | Windows'ta varsayılan yazıcı seçili değil ("Windows varsayılan yazıcımı yönetsin" kapalı/yazıcı yok)                                                                                                                       | Müşteri Ayarlar → Bluetooth ve cihazlar → Yazıcılar'dan bir yazıcıyı varsayılan yapar; yeniden dene            |
| `INVALID_PDF` "Belge açılamadı (bozuk veya parola korumalı)" | PDF parola korumalı/bozuk; `%PDF-` ile başlamıyor; sayfa sayısı 0 veya > 100 000                                                                                                                                           | Konsol tarafında PDF'i bir görüntüleyicide aç, parolasız "PDF olarak yazdır" ile yeniden kaydet, tekrar gönder |
| `TOO_LARGE`                                                  | > 20 MiB veya gelen bayt beyandan fazla                                                                                                                                                                                    | Sıkıştır/böl; dosya aktarımı (P5) ile gönderip müşteriye yazdırt                                               |
| `BUSY` "Başka bir aktarım sürüyor"                           | Aynı oturumda bekleyen yazdırma/aktarım var                                                                                                                                                                                | Öncekinin bitmesini bekle veya "Vazgeç"                                                                        |
| `REJECTED` / `TIMEOUT`                                       | Müşteri reddetti / 60 sn yanıt vermedi                                                                                                                                                                                     | Arıza değil; 30 sn bekleme sonrası yeniden iste (`cooldown`)                                                   |
| `CANCELLED` "Kontrol izni kapandı, yazdırma iptal edildi"    | Kontrol VIEW'a döndü (kısayol, "Kontrolü kapat", yetki daralması) — Y-P28a-1                                                                                                                                               | Kontrol iznini yeniden al, tekrar gönder                                                                       |
| `ABANDONED` / `DISCONNECTED`                                 | 10 dk içinde sonuç gelmedi / müşteri koptu                                                                                                                                                                                 | Bağlantıyı kontrol et; tekrar dene                                                                             |
| `ERROR` "Yazdırma başarısız oldu"                            | (a) PDF işleyici süreci açılamadı/çöktü (kısıtlı jeton + job + düşük bütünlük; AV engeli), (b) render zaman aşımı (sayfa 15 sn, toplam 10 dk), (c) GDI/yazıcı sürücüsü hatası (`StartDoc`/`EndDoc`), (d) yazıcı çevrimdışı | Aşağıdaki adımlar                                                                                              |

`ERROR` adımları (müşteri makinesinde, teknisyen uzaktan kontrolle yapabilir):

1. Müşteri aynı PDF'i kendi görüntüleyicisinden yazdırabiliyor mu? Hayır → yazıcı/sürücü sorunu (Windows "Yazıcı sorun gidericisi",
   kuyruktaki takılı işler `Ayarlar → Yazıcılar → Kuyruğu aç`). Spool belge adı her zaman **"NoktaDestek uzaktan yazdırma"**dır (dosya adı
   kuyruğa düşmez).
2. Evet → çok sayfalı/ağır PDF ise sayfa başına 15 sn sınırı aşılıyor olabilir: daha küçük parça veya dosya aktarımı + müşterinin yazdırması.
3. Antivirüs `NoktaDestek.exe --pdf-isleyici` alt sürecini engelliyor mu? (Defender koruma geçmişi.) İmzasız staging ikilisinde
   beklenebilir (§24.10 AV kapısı); prod imzalı ikiliyle tekrar dene. İstisna **verilmez**.
4. Görev Yöneticisi'nde iş bittikten sonra `NoktaDestek.exe` alt süreci kalmamalı (job `KILL_ON_JOB_CLOSE`). Kalıyorsa hata kaydı açılır
   (backend-dev; iz testi §28a.4 de yakalar).
5. Müşteriden tanılama logu istenir (`%LOCALAPPDATA%\NoktaDestek\tanilama.log`, yalnız kalıcı modda oluşur; içinde pano metni / dosya adı
   **olmaz** — D-P28a-3). Logda olmayan ayrıntı için Windows sürümü + yazıcı modeli + PDF'in sayfa sayısı/boyutu kayda yazılır.
6. "Microsoft Print to PDF" varsayılan yazıcıysa Windows kayıt diyaloğu açar — bu müşterinin seçimidir, `PRINTED` döner (kılavuz).

Pano için: `TIMEOUT` (müşteri 8 sn içinde yanıt vermedi — istemci donmuş/pano başka uygulamada kilitli), `ERROR` (pano 10 × 50 ms denemede
açılamadı — başka program panoyu tutuyor; müşteri panoyu kullanan uygulamayı kapatır), `SENSITIVE` (parola yöneticisi içeriği; teknisyenin
koyduğu metin geri okunurken de `SENSITIVE` döner — beklenen, D-P28a-2).

### 28a.4 Windows elle turu: iz ve içerik işareti testi (AC-347, 350, 351; r2 D-P28a-3)

Windows 10 ve 11 VM, staging adresli 0.13.0 istemci (§28a.5), varsayılan yazıcı fiziksel/ağ yazıcısı veya "Microsoft Print to PDF"
(kayıt yeri **Masaüstü** seçilir — taranan klasörler dışı).

1. `pwsh -File apps\agent-win\test\trace-check.ps1 -Mode Snapshot -SnapshotPath D:\once-p28a.json`
2. Oturum: kontrol izni ver → müşteri "Pano paylaşımına izin ver" → konsoldan `P28A-ISARET-<rastgele>` metnini **gönder**; müşteri
   panosuna `P28A-ISARET-<rastgele2>` kopyala → konsoldan **al**; `gizli-ad-<rastgele>.pdf` adlı 2 sayfalık PDF'i **uzaktan yazdır**
   (onayla), bir kez de reddet; kontrolü kapat → bekleyen yazdırma `CANCELLED`. Oturumu bitir, istemciyi kapat.
3. `pwsh -File apps\agent-win\test\trace-check.ps1 -Mode Compare -SnapshotPath D:\once-p28a.json -ExePath "<exe tam yolu>"`
   (kayıtlı bilgisayarda `-Binding on`). Beklenen: `TEMİZ` — `İÇERİK İŞARETİ [D-P28a-3]` satırı **yok**: işaretler `%LOCALAPPDATA%\NoktaDestek`
   (tanılama logu dahil), `%ProgramData%\NoktaDestek Servis`, `%TEMP%`, İndirilenler ve Application olay günlüğünde (kaynak `NoktaDestek`) yok;
   açık `--pdf-isleyici` süreci yok. Sunucu tarafı aynı işaretlerle otomatik testlerde taranır: `apps/server/test/integration/clip-print-ws.test.ts`
   (server logu, `audit_logs`, `/metrics`) ve `apps/web/e2e/p28a-clip-print.spec.ts` (tarayıcı konsolu).
4. Teknisyenin koyduğu pano metni oturumdan sonra müşteri panosunda kalır (amaç budur; Win+V geçmişine/buluta düşmez) — trace-check panoyu
   taramaz; müşteri isterse panoyu temizler.
5. Sonuç `docs/test-raporu.md`'ye (Windows sürümü, yazıcı, çıkış kodu).

CI (`.github/workflows/agent-win.yml`, `test-windows`): "P28a pano + yazdırma testleri" (render, işleyici yalıtımı, iptal **zorunlu PASS**;
runner yazıcısız olduğundan `TestP28aK0PrintToPDF` ve etkileşimsiz oturumda pano testi SKIP → uyarı), "P28a işleyici süreç kalmadı" ve
"trace-check içerik işareti öz testi" (işaretsiz log temiz; UTF-8/UTF-16LE içerik, `%TEMP%` dosya adı, olay günlüğü metni → çıkış 1 +
`[D-P28a-3]`). "P28a K0/K4" tablosu koşu özetinde (`go test ./...` adımı) görünür.

### 28a.5 İstemci 0.13.0 staging yayını (koordinatör deploy adımında uygular)

Sürüm numarası kodda **yoktur** (§24.8): `build.sh <adres> 0.13.0` → ldflags `config.version` + go-winres sürüm alanları. Kaynakta değişecek
sabit yok. Not: P27 staging servis ikilisi de 0.13.0 etiketiyle derlenmişti (§8 geçmişi, SHA `ce4e6c1c…`); P28a ile ikisi yeniden derlenir,
ayırt edici olan SHA-256'dır (yayın geçmişine yazılır).

Ön koşul (sıra bağlayıcı): P28a sunucu + web imajı staging'de (yeni istemci eski sunucuda özellik görmez ama çalışır — ileri/geri uyumlu,
§8.4); `agent-win` koşusu yeşil (P28a adımları dahil). Staging tek yığın `/opt/remote/deploy`, gömülü adres `https://remote.noktabilisim.net`.
Operatör makinesinde, repo kökünde (Go gerekmez):

```bash
SERVER='https://remote.noktabilisim.net'; VER=0.13.0
OUT="$(mktemp -d)"
for c in noktadestek noktadestek-servis; do
  exe=$([ "$c" = noktadestek ] && echo NoktaDestek.exe || echo NoktaDestekServis.exe)
  docker run --rm -v "$PWD:/src" -v "$OUT:/out" -w /src -e GOFLAGS=-mod=readonly -e GOTOOLCHAIN=local \
    golang:1.26.11-bookworm@sha256:dc40a13b61304647ed7e5d581d246b86413dfc29d63c6d018310feb93cd98fc0 sh -c '
    git config --global --add safe.directory /src; export SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)
    apps/agent-win/build/build.sh "$0" "$1" "/out/$2" "$3"' "$SERVER" "$VER" "$exe" "$c"
done
mkdir -p "$OUT/istemci" "$OUT/servis"; mv "$OUT/NoktaDestek.exe" "$OUT/istemci/"; mv "$OUT/NoktaDestekServis.exe" "$OUT/servis/"
(cd "$OUT/istemci" && shasum -a 256 NoktaDestek.exe > SHA256SUMS && cat SHA256SUMS)
(cd "$OUT/servis" && shasum -a 256 NoktaDestekServis.exe > SHA256SUMS && cat SHA256SUMS)
# Tekrarlanabilirlik: aynı komutu ikinci kez koşup SHA'ların aynı olduğunu teyit edin (§11.6).
# DİKKAT: tek yığın staging (proje remote) S13C-13 kilidi istemci --dir yayınını reddeder (yalnız Release vX.Y.Z).
# Bu durumda istemci exe'si test için doğrudan teslim edilir; yayın P28 sonu v0.13.0 Release ile (2026-11-16 kaydı).
ALLOW_UNATTESTED=staging deploy/agent/verify-and-publish.sh --dir "$OUT/istemci" --no-attestation --ssh root@185.126.217.99
ALLOW_UNATTESTED=staging deploy/agent/publish-servis.sh --dir "$OUT/servis" --no-attestation --ssh root@185.126.217.99 \
  --deploy-dir /opt/remote/deploy
```

Beklenen: `verify-and-publish` son satırlarında dış hash = yerel SHA (`/downloads/NoktaDestek.exe`), `publish-servis` `kontrol: server
UNATTENDED_AGENT_PATH SHA-256 = UNATTENDED_AGENT_SHA256 = <sha>`. Ardından: `MIN_AGENT_VERSION` **yükseltilmez** (0.12.x istemciler özelliksiz
çalışır, konsol "güncel sürümü indirin" der); §8 yayın geçmişine satır (staging, 0.13.0, iki SHA-256); Windows duman (§28a.4) test-operatoru.
P13c ikinci yığını kurulduysa staging exe main dalından `gh workflow run agent-win.yml --ref main -f server_url=https://stg.remote.noktabilisim.net
-f version=0.13.0` + `verify-and-publish.sh --stg-run <run-id>` ile yayınlanır (§24.8). Prod: P28 sonu, `v0.13.0` etiketi (§24.4).

### 28a.6 Geri alma

- Özelliği tek kullanıcı/firmada kapatmak: yetki toggle'ları (`remote_control.clipboard`, `file_transfer.print`) kapatılır — anında,
  sunucu her istekte yetkiyi denetler; açık oturumda yetki daralması bekleyen yazdırmayı iptal eder.
- İstemci geri alma: önceki exe (0.12.x) aynı `verify-and-publish.sh --dir` ile yeniden yayınlanır (dosyayı ve SHA'sını §8 geçmişinden
  alın). Servis ikilisi için `publish-servis.sh --dir` önceki ikiliyle.
- Sunucu/web geri alma: önceki `IMAGE_TAG` → `docker compose up -d server web` (migration yok). Yeni istemci eski sunucuda `rs.cap.*`
  görmezden gelinir, özellik görünmez.

## 28b. P28b — sunucuda dosya saklama + ClamAV + depolama kotası (devops K6, 2026-11-16; mimari-p28b §7, §11, §13 K6; ADR-0032; AC-353..363)

Kapsam: firma "Dosyaları sunucu üzerinden aktar ve virüs tara" ayarını açınca (SERVER modu) dosya ve yazdırma belgesi sunucuya şifreli
yüklenir, clamd ile taranır, temizse alıcıya teklif edilir. Bu bölüm altyapıdır: iki ClamAV konteyneri, `av` iç ağı, dosya volume'u,
alarmlar, kapasite ve geri alma. Kullanıcı ekranları kılavuzda (K10).

| Parça            | Nerede                                                                                                      | Not                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `clamav` (clamd) | `deploy/docker-compose.yml`, `deploy/clamav/clamd.conf`                                                     | Yalnız `av` ağı (internal, çıkış yok), imza DB'si `:ro`, `/init`'siz, `read_only`, `100:101`, `cap_drop ALL`, port yayımlanmaz |
| `clamav-update`  | aynı dosya, `deploy/clamav/freshclam.conf`                                                                  | Yalnız `av_egress` (database.clamav.net), DB'nin tek yazanı, `--checks=6` (günde 6), `NotifyClamd` yok                         |
| `av` ağı         | `AV_SUBNET` (vars. `172.30.2.0/28`; ikinci yığın `172.30.3.0/28`)                                           | Üyeler YALNIZ server + clamav. server `CLAMAV_ALLOWED_CIDR` = aynı değer (O-P28b-1)                                            |
| Dosya volume'u   | `stored_files` → server `/data/files` (`FILES_DIR`), `node:node 0700`, tenant klasörleri `{tenantId}/` 0700 | **Yedeğe girmez** (K-P28b-11); `backup.sh` yalnız `uploads` etiketli volume'u arşivler (değişmedi)                             |
| İmza DB volume'u | `clamav_db`                                                                                                 | Yedeklenmez; boş volume'a imajdaki DB kopyalanır, freshclam günceller                                                          |
| İmaj             | `clamav/clamav:1.5.4@sha256:45fe5149…422a` (Alpine, yalnız amd64)                                           | İki servis aynı digest. Dependabot `docker-compose` (`/deploy`) PR açar → §28b.6                                               |

### 28b.1 Kapasite ve değişmezler (bir değer değişirse hepsi birlikte)

- **Bellek değişmezi (O-P28b-3):** `clamav` `mem_limit` (3g) ≥ imza DB tepe (~1,1 GiB) + `/scratch` tmpfs (1536m) + pay 0,4 GiB. tmpfs sayfaları
  konteyner belleğine sayılır. `memswap_limit` = `mem_limit` (3g / 1536m; D-r2-4): konteyner swap kullanamaz, `/scratch` düz metni diske düşmez.
  Tek yığının tavanı 3 + 1,5 = **4,5 GiB**.
- **/scratch değişmezi (K6 kapı 5, D-r2-2 — ölçüldü):** tarama başına `StreamMaxLength` + `MaxScanSize` ≤ `/scratch` / 2
  (256M + 512M = 768M). `/scratch` dolarsa (ENOSPC) libclamav arşiv üyesini atlar ve dosyanın kalanı temizse **`stream: OK`** döner
  (fail-open; K6'da 64m `/scratch` ile kanıtlandı). Bu yüzden mimarideki `StreamMaxLength`/`MaxFileSize 260M` → **256M** (= ürün tavanı;
  tam 256 MiB dosya `OK`, +1 bayt `INSTREAM size limit exceeded`), `MaxScanSize 512M` aynen (düşürülürse ~250 MiB'lık stored zip — dış +
  üyeler ≈ 500 MiB — "boyut sınırı" olur). `/scratch` küçültülürse bu değerler de yarının altına iner; aksi halde değiştirilmez.
- **Host bellek kapısı (K6 kapı 6, D-r2-4):** `free -m` "available" ≥ **4,5 GiB** (+ ikinci yığında `av` profili açıksa onun 4,5 GiB'ı) + mevcut
  tepe (§21.2). Ölçüm ve `swapon --show` sonucu §8 yayın geçmişine yazılır. Yetmezse: ikinci yığında `av` profili yalnız test sırasında ve prod'da
  tarama yükü yokken açılır; kalıcı çözüm mimari §7.1 kapı 6 yedeği (sunucu modu tavanı 128 MiB, `StreamMaxLength`/`MaxFileSize` 132M,
  `MaxScanSize` 256M, `/scratch` 768m, `mem_limit`/`memswap_limit` 2304m — mimar onayıyla).
- **Swap (R-P28b-8):** konteyner düzeyinde kapalı (yukarıda). Host'ta swap açıksa bile clamd/tmpfs sayfaları swap'e gitmez; MySQL vb. için host
  swap politikası değişmez.
- **Disk:** dosyalar `/var/lib/docker` altında (`stored_files`). Sunucu disk boş < %10 iken yeni yüklemeyi reddeder (AC-362, `QUOTA`).
  **"Toplam kota ≤ boş disk" kuralı:** tüm firmaların `storage_quota_gb` toplamı, `/var/lib/docker`'ın boş alanının %80'ini aşmamalı
  (`df -BG /var/lib/docker`). Varsayılan 20 GB × firma sayısı bunu aşarsa Super Admin kotaları düşürür ya da disk büyütülür; aksi halde %10
  koruması firmalar arasında "ilk gelen alır" olur. remote-watch `disk:/var/lib/docker` alarmı %80'de (mimari "%15 uyarı / %10 kritik"ten
  önce çalar).

### 28b.2 Kurulum ve profil

1. **Ön koşul:** P28b migration + grant'lar (dba, `20261123000000_p28b_stored_files`) ve P28b server imajı aynı yayında. **Tetikleyici özeti
   değişti:** `deploy/mysql/audit-continuity.sql` beklenen sabiti `0fdacca7fc67a7b472827b603d65584803be5f749e319a70d5d008cb68a673e0`
   (sayı 23 kalır; `support_sessions_update_guard` gövdesi genişledi). Bu dosya **migration ile aynı yayında** sunucu ağacına gelmeli: ön yedek
   `git pull`'dan önce alınır (§25.1 notu), pull + migration sonrası ilk yedek yeni özetle `audit-continuity ok` vermeli. Ağaç çekilip migration
   koşmazsa (ya da tersi) yedek `FAILED adım=tetikleyici`/audit-continuity alarmı verir.
2. `deploy/.env`: tek yığında (prod / bugünkü staging `/opt/remote`) **yeni satır gerekmez** (varsayılanlar: `AV_SUBNET` 172.30.2.0/28,
   `CLAMAV_HOST` clamav, `CLAMAV_PORT` 3310). İkinci yığın (`/opt/remote-stg`): `AV_SUBNET=172.30.3.0/28`. Alt ağ host'taki başka bir docker
   ağıyla çakışırsa compose "Pool overlaps" der: `docker network inspect $(docker network ls -q) -f '{{.Name}} {{range .IPAM.Config}}{{.Subnet}}{{end}}'`
   ile boş bir /28 seçin (RFC 1918, ≥ /24; server açılışta doğrular — D-r2-5).
3. Kaynak ölçümü (§28b.1 kapı 6): `free -m; swapon --show; df -h / /var/lib/docker` → değerler §8'e.
4. `cd /opt/remote/deploy && docker compose pull clamav clamav-update && docker compose up -d` → `docker compose ps clamav clamav-update`:
   ikisi `healthy`. Sıra: `clamav-update` önce tek seferlik ilk freshclam turunu bitirir (`timeout 300`) ve ancak o zaman sağlıklı olur
   (`start_period` 330 sn; bu sırada `health: starting`), `clamav` `depends_on: service_healthy` ile ondan sonra açılır ve imzayı ~60 sn'de
   yükler (imajın kendi sağlık denetimi). Ayrıntı §28b.3. server `/ready` clamd'den bağımsızdır.
5. İkinci yığında profil: ClamAV staging katmanında `profiles: [av]` → **varsayılan kapalı**. Açma: `.env`'e `COMPOSE_PROFILES=av` + `docker compose
up -d`, ya da tek seferlik `docker compose --profile av up -d clamav-update clamav`. Kapama: `docker compose stop clamav clamav-update`
   (profil satırını kaldırın). Kapalıyken sunucu modu fail-closed: test "ulaşılamadı", tenant anahtarı `AV_NOT_READY`, açık oturumda dosyalar
   "taranamadı" (virüslü sayılmaz).
6. **Yalıtım kapısı (K6 kapı 3, her kurulum/imaj güncellemesinde):** `deploy/ops/check-av-isolation.sh remote` (staging: `remote-stg`) →
   `SONUÇ: GEÇTİ`. Operatör makinesinden `nc -z -w 3 <sunucu-genel-IP> 3310` başarısız olmalı (AC-353). D-r2-1 satırı K3'ün "av alt ağından
   gelen isteği reddet" kodu yayına girene kadar UYARI'dır; girdikten sonra `STRICT_DR21=1` ile koşulur ve PASS olmalı.
7. Super Admin → ClamAV ayarı: sunucu `clamav`, port `3310` (boş bırakılırsa env) → "Bağlantıyı Test Et": PONG + EICAR + şifreli zip +
   imza tarihi; ancak bundan sonra firmalar sunucu modunu açabilir.
   **Kaynak geçişi:** ilk testten (ya da öz-sınamanın "yanlış yapılandırma" kaydından) sonra panel kaydı geçerlidir; ayar `source: panel`
   olur ve audit'e `settings.clamav {host, port, source: "env→panel"}` yazılır. Bundan sonra `.env`'deki `CLAMAV_HOST`/`CLAMAV_PORT`
   değişikliği **etkisizdir**; adres değişecekse panelden kaydedilip yeniden test edilir.
8. nginx (prod host): `deploy/nginx/remote.noktabilisim.net.conf` kopyalanır → `nginx -t && systemctl reload nginx`. Denetim (D-P28b-4):
   `nginx -T | grep -n 'client_body_buffer_size 3m'` server bloğunda tek satır, yeni `location` yok. Gövde diske yazılmaz (yerel kanıt:
   `deploy/nginx/test-nginx.sh` "temp yazılamazken 502").

### 28b.3 İmza güncelleme ve yeniden yükleme penceresi

- freshclam günde 6 kez denetler (`docker compose logs clamav-update | grep -E 'updated|up-to-date'`). Yeni DB volume'a yazılır; clamd
  `SelfCheck 600` ile en geç 10 dk'da yeniden yükler (`docker compose logs clamav | grep -i reload`). Yükleme ~8 sn (ilk açılış ~60 sn) sürer,
  bu arada clamd komut kabul etmez; server bağlantı aşamasında ≤ 15 sn yeniden dener, kullanıcıya yansımaz.
- **İlk açılış yarışı (K6/K9 B2 — kalıcı düzeltme K9):** eskiden clamav-update "DB dosyası var" olur olmaz sağlıklı sayılıyordu; clamd imajdaki
  eski daily'yi yüklerken freshclam yenisini yazınca clamd SelfCheck'te "Database status OK" deyip eski DB'de kalıyordu (staging 2026-11-16: 8 günlük
  imza, `av-signature-age` alarmı). Artık `clamav-update` önce **tek seferlik** `freshclam` koşar (`timeout 300`), sonra `/tmp/first-update.done`
  işaretini yazar, sonra daemon'a geçer; sağlık = işaret + DB dosyaları. `clamav` `depends_on: service_healthy` ile ilk güncelleme bitmeden açılmaz.
  - `docker compose up -d` clamav'ı ilk güncelleme bitene dek bekletir (yerelde ~8 sn; üst sınır 300 sn, `start_period` 330 sn). Bu sırada
    `docker compose ps` clamav-update'i `health: starting` gösterir.
  - CDN/çıkış hatasında tek seferlik deneme başarısız olsa da işaret yazılır ve clamd eski DB ile açılır (bilinçli; eski imzayı `av-signature-age`
    yakalar). Log: `docker compose logs clamav-update | grep -E 'updated|up-to-date|Update failed'`.
  - **Kalan durum:** `depends_on` yalnız `compose up`'ta uygulanır. Host yeniden açılışında / Docker'ın `restart: unless-stopped` yeniden
    başlatmasında iki konteyner aynı anda kalkar; yarış teorik olarak sürer (volume'da önceki güncel DB olduğundan en kötü bir daily geride kalır,
    bir sonraki freshclam güncellemesi ≤ 4 sa'te düzeltir). Reboot sonrası ya da imza yaşı uyarısında: `docker compose restart clamav` →
    ~60 sn sonra aşağıdaki `VERSION` güncel daily'yi göstermeli.
- **Açılışta `av-up` (K9 B3):** server açılış yoklaması clamd imza yüklerken düşerse 30 sn arayla en çok 19 kez yeniden dener (≈ 9,5 dk;
  `remote-watch` "ardışık 2 tur" penceresinin içinde), ulaşınca 10 dk turuna döner. Hızlı denemeler `av_down` log sayacına katılmaz. Bütçe yalnız
  açılışta ve başarılı yoklamadan sonra yenilenir (profil kapalı staging'de kalıcı 30 sn yoklaması olmaz).
- Elle kontrol: `docker compose exec clamav sh -c 'printf "zVERSION\0" | nc localhost 3310'` → `ClamAV 1.5.4/<daily>/<tarih>`; tarih ≤ 1–2 gün.
- Elle güncelleme (CDN sınırı/çıkış engeli sonrası): `docker compose restart clamav-update` → log `daily.cld updated`; 10 dk sonra clamd
  `VERSION` yeni daily'yi göstermeli.

### 28b.4 Alarmlar (`remote-watch`, 10 dk; eşikler `deploy/ops/remote-watch.sh`, AC-359/361)

| Kontrol                                   | Koşul                                                                                                   | Eylem                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `compose:clamav`, `compose:clamav-update` | konteyner yok / çalışmıyor / unhealthy                                                                  | §28b.5 "servis düştü"             |
| `av-up`                                   | `rs_av_up == 0` **ardışık 2 yoklama** (tek yoklama reload penceresine denk gelebilir)                   | §28b.5                            |
| `av-selftest`                             | `rs_av_selftest_ok == 0` (EICAR ya da şifreli zip yanlış yanıtlandı) — **anında**                       | §28b.5 "yanlış yapılandırma"      |
| `av-signature-age`                        | `rs_av_signature_age_seconds` > 3 gün (`WATCH_AV_STALE_DAYS`)                                           | §28b.3 elle güncelleme            |
| `av-scan-failed`                          | 1 sa'te `rs_av_scan_total{result=failed_*}` artışı ≥ 5 (`WATCH_AV_FAIL_MIN`) ve toplam artışın > %20'si | `failed_*` etiketine bak (§28b.5) |
| `av-metrics`                              | clamav konteyneri var ama server `rs_av_*` yayımlamıyor                                                 | server sürümü / `METRICS_TOKEN`   |
| `disk:/var/lib/docker`                    | doluluk ≥ %80 (mevcut)                                                                                  | §28b.5 "disk dolu"                |

Kapsam anahtarı `WATCH_AV_CHECKS`: prod `1` (server P28b ise clamav konteyneri **zorunlu**; yoksa alarm), ikinci örnek `auto` (yalnız clamav
konteyneri varsa — `av` profili kapalıyken sessiz), `0` kapalı. Watch betiği değişti: `deploy/ops/remote-watch.sh install` (ve `install stg`)
yeniden çalıştırılır.

### 28b.5 Sorun giderme

- **Servis düştü / `av-up`:** `docker compose ps clamav clamav-update; docker compose logs --tail 50 clamav`. OOM (`docker inspect -f
'{{.State.OOMKilled}}' <konteyner>`) → §28b.1 bellek; "Can't allocate memory"/DB bozuk → `docker compose restart clamav-update clamav`.
  Etki: açık sunucu modu oturumlarında dosyalar "taranamadı, teslim edilmedi" (fail-closed); P2P firmalar etkilenmez.
- **`av-selftest` (yanlış yapılandırma):** genelde `clamd.conf`'ta `AlertEncrypted*`/`HeuristicAlerts` kapalı ya da imaj sürümünde önek değişti
  (R-P28b-3). `docker compose exec clamav grep -E '^Alert|^Heuristic' /etc/clamav/clamd.conf` → dört satır `yes`. Düzeltilip `docker compose
restart clamav`; bayrak sonraki iyi yoklamada kalkar, ancak firmaların yeniden açabilmesi için Super Admin **elle test** yapar (`lastTest.ok`).
- **`av-scan-failed`:** `failed_busy` → yük (2 yuva, firma başına 1); `failed_unavailable` → clamd erişimi; `failed_timeout`/`failed_limit` →
  büyük/derin arşivler (beklenen, virüs değil); `failed_encrypted` → şifreli arşiv (kullanıcı şifresiz göndermeli).
- **Kota doldu (`STORAGE_QUOTA`, O-P28b-2):** Super Admin → Firmalar → firma → depolama kotası (1..2000 GB) yükseltilir; kullanım
  ayarlar ekranında görünür. Teslim edilmemiş/reddedilmiş dosyalar zaten hemen silinir; saklananlar `file_retention_days` (1–7) sonunda 03:30'da
  silinir. Elle dosya silme aracı yoktur (K-P28b-15) — acil durumda firma Admin'i saklama süresini 1 güne indirir; bir sonraki 03:30 turu siler.
  Kota yükseltmeden önce §28b.1 "toplam kota ≤ boş disk".
- **Disk dolu (boş < %10):** tüm firmalarda yeni yükleme `QUOTA` ile reddedilir. `docker system df; du -sh /var/lib/docker/volumes/*stored_files*`.
  Eski imajları temizle (`docker image prune` — kullanılan silinmez), yedek dizinini kontrol et (§13), gerekirse kotaları düşür. Volume
  içinden elle dosya **silinmez** (satır `CLEAN` kalır, mutabakat `EXPIRED` yapar — yine de yapmayın; uygulama silsin).
- **Yedekten dönüş:** dosyalar yedekte yok; dönüş sonrası ilk 03:30 mutabakatı dosyası olmayan `CLEAN` satırlarını `EXPIRED` yapar (geçmişte
  "süresi doldu"). Beklenen davranıştır.

### 28b.6 ClamAV imaj güncellemesi (Dependabot PR'ı, R-P28b-3)

Birleştirmeden önce staging'de (ikinci yığın `av` profili ya da tek yığın): (1) `docker compose up -d clamav-update clamav` → healthy
(kapı 1); (2) EICAR → `Eicar-Test-Signature`, parolalı zip → `Heuristics.Encrypted.Zip`, sınır → `Heuristics.Limits.Exceeded.*` (K0 "kesin
yanıt dizeleri"; ayar ekranı testi aynı şeyi yapar); (3) `check-av-isolation.sh` GEÇTİ (kapı 3); (4) clamd açılış logunda "Global size limit set to
536870912 bytes" + "File size limit set to 268435456 bytes" ve "Alerting of encrypted archives _and_ documents enabled". Biri tutmazsa PR birleştirilmez.

### 28b.7 Geri alma

1. Firmalarda sunucu modu kapatılır (Admin → Dosyalar; yeni oturumlar P2P). Açık oturumlar modunu korur (AC-355) — bitmeleri beklenir.
2. Önceki `IMAGE_TAG` ile `docker compose up -d server web`. Migration geri alınmaz (expand; tablo/kolon kalabilir, mimari §11.4).
3. ClamAV'ı kaldırmak gerekiyorsa: `docker compose stop clamav clamav-update && docker compose rm -f clamav clamav-update`; compose ağacı da
   önceki commit'e dönerse `av`/`av_egress` ağları server yeniden oluşturulunca kalkar (`docker network prune` yalnız kullanılmayanları siler).
   `stored_files` ve `clamav_db` volume'ları **otomatik silinmez**; dosyalar şifreli ve ≤ 7 gün ömürlüdür — tam temizlik için server durdurulup
   `docker volume rm <proje>_stored_files <proje>_clamav_db`.
4. nginx `client_body_buffer_size` satırı geri alınmaz (P12 yüklemeleri için de doğru; zararsız).

### 28b.8 Staging uçtan uca duman testi (K9 hesabı + `staging-smoke-p28b.sh`)

**Yalnız staging** (`develop` host'u, server'da `DEPLOY_ENV=staging`; iki betik de bunu denetler, aksi halde hiçbir şey yapmadan çıkar). Prod'da
koşulmaz. Betikler `/opt/remote` git ağacına **kopyalanmaz** (izlenmeyen dosya `git pull`'u bozar); `/root/k9/` altında tutulur:

```bash
# operatör makinesinden (repo kökü)
ssh root@185.126.217.99 'mkdir -p /root/k9 && chmod 700 /root/k9'
scp deploy/ops/k9-staging.mjs deploy/ops/k9-staging-account.sh deploy/ops/staging-smoke-p28b.sh root@185.126.217.99:/root/k9/
```

| Dosya                              | Ne yapar                                                                                                                                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy/ops/k9-staging-account.sh` | Test hesabını oluşturur (idempotent): parola host'ta `openssl rand`, hash server'daki `hashPassword`, SQL `app` kullanıcısı, audit `user.created {source:"k9-staging-test"}`; ardından 2FA'yı API ile kurar |
| `deploy/ops/staging-smoke-p28b.sh` | (a)–(g) uçtan uca duman; yalnız sonuç satırları basar; yarıda kalırsa `trap` oturumu kapatır ve firma modunu eski değerine alır                                                                             |
| `deploy/ops/k9-staging.mjs`        | İkisinin HTTP/WS istemcisi; server konteynerinde stdin'den koşar (`ws`, `@remote/contracts`), Caddy'ye `caddy:4450` üzerinden Caddy yerel kökü ile TLS doğrulamalı bağlanır                                 |

**Gizli değerler:** parola, TOTP tohumu, kurtarma kodları yalnız `/root/.k9-staging-test.env` (root 600) dosyasındadır; son kullanılan TOTP
zaman adımı `/root/.k9-staging-test.state` (gizli değil; aynı adım iki kez kabul edilmediği için betik bir sonraki adımı bekler). Değerler argv'ye,
ekrana, loga girmez; betikler `docker compose exec -e AD` ile geçirir. Dosyayı açmayın/kopyalamayın; içeriği yalnız `cut -d= -f1` ile denetleyin.

1. **Super Admin hesabı** (`k9-test@staging.invalid`): `bash /root/k9/k9-staging-account.sh` → `SONUÇ: ok`. İkinci koşu "hesap: mevcut … 2FA zaten
   etkin, tohum … doğrulandı" der. ClamAV testi ve firma ayarı için.
2. **Teknisyen hesabı** (`k9-tech@staging.invalid`, demo firmasında ADMIN): `bash /root/k9/k9-staging-account.sh --tech`. Super Admin destek
   oturumu **açamaz** (oturum yalnız teknisyenin kendi firmasında; `sessions/service.ts`), (c)–(e) için şarttır. Ayrı hesap olduğu için açılmadan
   önce kullanıcı onayı alınır. Yoksa duman testi (a)'dan sonra "K9_TECH_* yok" diyerek durur (firma ayarına dokunmadan).
3. **Duman:** `bash /root/k9/staging-smoke-p28b.sh` (~2 dk; TOTP adım beklemeleri dahil). Sonuç satırları:
   (a) ClamAV testi `ok/EICAR/şifreli-zip/sürüm/imza yaşı/kaynak`; (b) demo firmasında `fileServerMode` önce→şimdi (aydınlatma onayı
   `consentUpdated=true`); (c) oturum + tarayıcı misafiri, oda `fileMode=SERVER`; (d) EICAR → `INFECTED`, teklif yok; (e) 50 MB rastgele, 1 MiB
   parça → `CLEAN`, **son parça → teklif ≤ 30 sn (AC-357)**; (g) misafir reddi (dosya hemen silinir), oturum sonu, mod eski değer; (f) test başından
   beri `server` ve `caddy` loglarında dosya adları + belirteç/çerez önekleri 0 eşleşme, pozitif kontrol: dosya kimlikleri server logunda var.
   Son satır `SONUÇ: GEÇTİ` / `KALDI`.
4. **Geri alınamayan yan etki:** ilk ClamAV testi ayarın kaynağını kalıcı olarak `env→panel` çevirir (§28b.2 adım 7); (a) satırı önce→sonra'yı
   basar. Firma modu ve oturum geri alınır; saklanan dosya kalmaz (EICAR `INFECTED`, 50 MB reddedildi).
5. **Elle geri alma** (betik "geri alma: BAŞARISIZ" derse): Super Admin olarak panelden demo firmasına geç → Ayarlar > Dosyalar anahtarını kapat;
   Oturumlar'da açık K9 oturumunu sonlandır.
6. **Hesapları kaldırma:** panelde Kullanıcılar → `k9-*@staging.invalid` pasife al / sil → `rm /root/.k9-staging-test.env /root/.k9-staging-test.state`.
   Hesap var ama dosya yoksa betik parolaya ulaşamaz ve durur (parola sıfırlanmaz); önce hesabı panelden kaldırın.

Sorun giderme: `k9: login başarısız (HTTP 401 …)` → parola dosyası hesapla uyuşmuyor (6. adım); `HTTP 429` → 2FA deneme sınırı (5/5 dk), 5 dk
bekleyin; `HTTP 403 FORBIDDEN` `sessions.create` → teknisyen yerine Super Admin kullanılıyor (2. adım); `AV_NOT_READY` → (a) başarısız, §28b.5.

## 28u. P28u — gözetimsiz izinli/izinsiz bağlantı + müdahale, servis/istemci 0.15.0 (devops K8, 2026-11-16; mimari-p28u §6.1, §9, §14.1, §16 K8, §r2 D-P28u-5; AC-429..446)

Kapsam: gözetimsiz bağlantı artık varsayılan olarak cihazdaki kullanıcıya **onay diyaloğu** açar (izinli, `ask`); kimse yoksa doğrudan
bağlanır (`no_user`). Firma politikası açık + `unattended.silent` yetkisi + 2FA ile **izinsiz** (izleme, `silent`) bağlantı ve kontrol
açıkken **kilit / oturum kapatma** (müdahale) gelir. Yeni env değişkeni **yok** (mimari §14.1); migration `20261124000000_p28u_unattended_consent`
(tek COPY ALTER, tetikleyici sayısı 23 ve audit-continuity özeti değişmez — db-notlari "P28u"). Kullanıcı ekranları kılavuzda (K11).

> **P28u r3 (2026-11-18, mimari-p28u §r3 — bu bölümün önceki anlatımını geçersiz kılar):** gözetimsiz bağlantı **her zaman cihaz
> kullanıcısına sorulmadan** açılır; tek kip `no_user`. Onay diyaloğu, izinsiz (`silent`) kip, firma politikası, gerekçe, gözetimsiz dört
> göz e-postası ve `unattended.silent` yetkisi **kaldırıldı**. Gizli izleme yoktur: cihazda "Uzaktan bağlantı: <ad> — <firma>" göstergesi
> her zaman görünür, yerel kapatma anahtarı çalışır. **Migration yok** (politika sütunları ve `consent_mode`/`silent_reason` expand-only
> kalır, okunmaz/yazılmaz), **yeni env yok**. Yeni servis alt protokole `rs.cap.direct1` ekler; r3 sunucusu bunu bildirmeyen servise
> (0.15–0.19 dahil) 409 `DEVICE_OUTDATED` verir → **r3 sunucusu ile yeni servis derlemesi aynı pencerede staging'e çıkar** (§28u.10).
> Kaldırılan alarmlar: `unattended-silent-volume`, `unattended-consent-timeout` (§28u.6). Geri alma ve S-P28u-r3-3: §28u.7.

### 28u.1 Politika açma / kapama (izinsiz bağlantı) — r3: KALDIRILDI

Ayarlar → "Gözetimsiz erişim" sekmesi ve `/api/v1/unattended/policy` uçları yok. `tenant_settings.unattended_silent_enabled/_ack_at/_ack_by`
sütunları kalır (expand-only), r3 sunucusu okumaz/yazmaz; staging'de `1` kalmış değer etkisizdir. **Ancak** r3 öncesi imaja geri dönüşte
yeniden etkin olur — §28u.7. Acil "kapat" yolu artık `UNATTENDED_MODE=off` (§27.6) ya da kullanıcının `unattended.connect` yetkisidir.
Eski audit `settings.unattended_silent` satırları okunur kalır.

### 28u.2 İzinsiz bağlantı ve dört göz e-postası — r3: KALDIRILDI

"İzin istemeden bağlan" kutusu, gerekçe ve gözetimsiz dört göz e-postası yok. Bağlan penceresinde yalnız bilgi satırı: "Bağlantı cihaz
kullanıcısına sorulmadan açılır. Cihazda bağlantı göstergesi görünür." Konsol misafir katılınca bir kez otomatik kontrol ister (doğrudan
görüntü + kontrol). Geçmişte eski kayıtlar "Kullanıcı onayıyla (eski)" / "İzinsiz (eski)", yeniler "Onaysız" etiketiyle görünür.
Dört göz e-posta altyapısı (`unattended.silent.notify` audit'i, `rs_unattended_silent_notify_total`) **yalnız P28e kayıt politikası**
e-postası (`event: recording_policy`, §28e) için kalır; alarmı §28u.6 `unattended-notify-fail`.

### 28u.3 Müdahale: kilit / oturum kapatma

- Konsol üst çubuğu → **Kilitle** / **Oturumu kapat** (yalnız kontrol izni varken; `unattended.connect` + cihaz grant'ı + oturumun teknisyeni).
  Oturum kapatma onay ister ("kaydedilmemiş belgeler kaybolur"). Audit `unattended.lock` / `unattended.logoff {result, failReason?, durationMs, rejoin}`.
- Oturum kapatma başarılıysa servis 45 sn içinde yeni konsol oturumuna **yeniden katılır** (audit `unattended.rejoin`). r3: tek kip
  olduğundan yeni kullanıcı girişi oturumu bitirmez (eski `asked`/`session_changed` dalı yok).
- Hata kodları (konsol metni, audit `failReason`): `no_session` (yardımcının oturumu konsol oturumu değil), `not_in_control`, `not_locked`
  (kilit 2 sn içinde Winlogon'a geçmedi), `no_user`, `api_error`, `timeout`; 409 `INTERVENE_PENDING` = önceki komut sürüyor.
  `not_locked` / `api_error` süregelirse §28u.8 K6s elle spike sonucuna bakılır (K-P28u-5b `--lock` geri dönüşü gerekebilir).

### 28u.4 Windows olay günlüğü (Application, kaynak `NoktaDestek`)

Müşteri tarafında "kim, ne zaman bağlandı / ne yaptı" sorusunun yerel kanıtı. Görüntüleme: Olay Görüntüleyicisi → Windows Günlükleri →
Uygulama → "Geçerli günlüğü filtrele" → Olay kaynağı `NoktaDestek`. PowerShell (yönetici gerekmez):
`Get-WinEvent -FilterHashtable @{LogName='Application'; ProviderName='NoktaDestek'; Id=1001,1004,1006,1007,1008} -MaxEvents 50 | Format-List TimeCreated,Id,LevelDisplayName,Message`

| Kimlik | Düzey         | Anlam                                                                                                                                                                                                          |
| ------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1001   | Bilgi         | Gözetimsiz bağlantı başladı — teknisyen, destek firması, teknisyen IP, oturum, **kip**: r3'te her zaman "onaysız" (eski kayıtlarda "izinli (kullanıcı onayı)" / "izinli (kullanıcı yok)" / "izinsiz (izleme)") |
| 1004   | Uyarı         | Bağlantı reddedildi / güvenlik denetimi başarısız (`folder_acl`, `pipe_squatted`, `device_key`, `auth_rejected`, `signature_gate`, `folder_renamed`)                                                           |
| 1006   | Bilgi / Uyarı | Oturum kilitlendi (teknisyen, oturum, sonuç). Uyarı = "(uygulanmadı) … başarısız: <neden>"                                                                                                                     |
| 1007   | Bilgi / Uyarı | Kullanıcı oturumu kapatıldı (aynı biçim)                                                                                                                                                                       |
| 1008   | Bilgi / Uyarı | **r3: artık yazılmaz** (yalnız eski servis kayıtlarında). Bağlantı onayı: "izin verildi" / "reddedildi" / "yanıt verilmedi"                                                                                    |

Diğerleri (P27): 1002 bitti, 1003 yerel anahtar, 1005 iptal/kaldırma. Bilet, anahtar, nonce, gerekçe hiçbir olaya yazılmaz.

### 28u.5 Eski servis (`DEVICE_OUTDATED`) — güncelleme yolu (R-PU7; r3: `direct1`)

r3 sunucusu doğrudan bağlantı yeteneği (`rs.cap.direct1`) bildirmeyen servise (**0.15–0.19 `consent1` servisleri ve ≤ 0.14.x**) **hiçbir**
gözetimsiz bağlantı açmaz: panelde "Servis güncel değil" rozeti, Bağlan pasif, API 409 `DEVICE_OUTDATED` (step-up tüketilmez), metrik
`rs_unattended_connect_total{result="outdated"}`. Bilerek fail-closed'dır: eski servise `ask` gitse diyalog açar, `silent` gitse izleme
kipinde başlar — ikisi de r3 kararına aykırı. Güncelleme (cihaz başına, cihaz yöneticisi):

1. Panel → Gözetimsiz cihazlar → Kayıt kodları → **Servis programını indir** → r3 `NoktaDestekServis.exe` (§28u.10 yayınından sonra;
   SHA-256'yı §8 yayın geçmişiyle karşılaştırın).
2. Cihazda exe'yi çalıştır → pencerede **Güncelle…** → UAC **Evet**. Kurulu servis yerinde güncellenir, **kayıt korunur** (kayıt kodu
   gerekmez; `Install` → `Update`).
3. Panelde ≤ 10 sn içinde rozet kalkar, "Kullanıcı" sütunu (Aktif / Kilitli / Oturum yok — bilgi) dolar; Bağlan etkin.
4. Doğrulama: Bağlan → cihazda **diyalog yok**, gösterge ≤ 3 sn → konsol doğrudan görüntü + kontrol → olay günlüğü 1001 "kip: onaysız".

"Güncelle…" hata verirse ("Güncelleme yapılamadı") bilgisayar yeniden başlatılıp tekrar denenir; sürerse servis kaldırılıp yeni kayıt
koduyla yeniden kurulur (§27.2 adım 7). Staging'de yalnız test VM'leri vardır; prod'da gözetimsiz erişim `off` (imza yok, §27.1).

### 28u.6 Alarmlar (`remote-watch`, 10 dk; eşikler `deploy/ops/remote-watch.sh`, mimari-p28u §9.4 + §r3.1)

Server P28u öncesiyse (`rs_unattended_silent_notify_total` yok) değerlendirilmez. Betik değişti → `cd /opt/remote/deploy/ops &&
./remote-watch.sh install` (ikinci yığında ayrıca `install stg`). **r3:** `unattended-silent-volume` ve `unattended-consent-timeout`
kaldırıldı (`rs_unattended_connect_total{mode="silent"}` ve `rs_unattended_consent_total` artık üretilmiyor); `WATCH_UA_SILENT_MAX` /
`WATCH_UA_TIMEOUT_MIN` okunmaz (watch.env'de kalırsa zararsız, silinebilir). Durum dosyasındaki eski `ua_samples=` satırı ilk turda düşer.

| Kontrol                  | Koşul                                                                                                          | Düzey | Eylem                                                                                                                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unattended-notify-fail` | `rs_unattended_silent_notify_total{result="fail"}` arttı (alıcı başına 3 deneme sonrası); artıştan sonra 24 sa | Uyarı | **Kayıt politikası dört göz e-postası gitmedi** (P28e `recording_policy`). Firma SMTP testi, `docker compose logs server \| grep unattended_silent_notify`, Audit `unattended.silent.notify result=fail`; alıcılara elle bildir |

Elle bakış (alarm yok): `rs_unattended_intervene_total{result!="ok"}` ve `rs_unattended_rejoin_total{result!="ok"}` sürekli artıyorsa §28u.3;
`rs_unattended_device_msg_rejected_total` süregelen artış = değiştirilmiş servis / başka cihazın oturumuna mesaj → güvenlik incelemesi.

```bash
docker compose exec -T server node -e "fetch('http://127.0.0.1:3001/metrics',{headers:{authorization:'Bearer '+process.env.METRICS_TOKEN}}).then(r=>r.text()).then(t=>console.log(t.split('\n').filter(l=>/^rs_unattended_(connect|intervene|silent_notify|rejoin|device_msg_rejected)_total/.test(l)).join('\n')))"
```

### 28u.7 Geri alma (r3; eski "gizlilik gerilemesi" uyarısı konusuz)

Uyum matrisi (mimari-p28u §r3.3):

| Sunucu     | Servis                 | Sonuç                                                                                      |
| ---------- | ---------------------- | ------------------------------------------------------------------------------------------ |
| r3         | r3 (`direct1`)         | Sormadan açılır, `consent_mode=no_user`, konsol otomatik kontrol                           |
| r3         | 0.15–0.19 (`consent1`) | 409 `DEVICE_OUTDATED`, rozet "Servis güncel değil", Bağlan pasif → "Güncelle…" (§28u.5)    |
| r3         | ≤ 0.14 (belirteçsiz)   | 409 `DEVICE_OUTDATED`                                                                      |
| P28u..P28f | r3                     | `ask` → sormadan açılır + `consent.result{no_user}`; `silent` → `connect.result{protocol}` |
| P27        | r3                     | P27 (features yok, onaysız)                                                                |

Önceki "gizlilik gerilemesi" uyarısı (müşteri bildirimi, D-P28u-5) **konusuzdur**: eski sunucu da r3 servisinde sormadan açar.
Migration geri alması **yoktur** (r3 migration getirmez).

**S-P28u-r3-3 — sunucu P28u..P28f imajına (r3 öncesi) geri alınırsa:** saklı `user_permissions.perm_key='unattended.silent'` satırları
(kullanıcı yeniden kaydedilmediyse silinmemiştir) ve `tenant_settings.unattended_silent_enabled=1` politika sütunu **anında yeniden
etkin** olur; henüz güncellenmemiş 0.15–0.19 servislerde izinsiz izleme kipi ve onay diyaloğu geri gelir. Sıra (bağlayıcı):

1. Geri almadan **önce** yedek (§25.2), sonra politika sütununu kapat (yönetici MySQL bağlantısı; etkilenen satır sayısını kaydet):
   `UPDATE tenant_settings SET unattended_silent_enabled=0 WHERE unattended_silent_enabled=1;`
   Saklı yetki satırlarını listele (bilgi; politika `0` iken eski sunucuda etkisizdir):
   `SELECT tenant_id, user_id FROM user_permissions WHERE perm_key='unattended.silent';`
2. Sunucu/web geri alma: önceki `IMAGE_TAG` → `docker compose up -d server web`. r3 servisli cihazlar eski sunucuda sormadan açılır
   (matris); 0.15–0.19 cihazlar eski P28u davranışına (onay diyaloğu) döner.
3. r3'e ileri dönüşte ek adım yok (sütunlar r3'te okunmaz).
4. Servis ikilisini geri almak **gerekmez ve önerilmez**: r3 servisi eski sunucuyla çalışır. Önceki servis yeniden yayınlanırsa
   (`publish-servis.sh --dir`, SHA §8'den) r3 sunucusunda bu cihazlar `DEVICE_OUTDATED` olur → o durumda sunucu da geri alınır.

Durum: bu prosedür **yazıldı, henüz denenmedi** (R5'te dağıtım yapılmadı); ilk r3 staging yayınında (§28u.10 adım 6) prova edilir.

### 28u.8 Windows elle turu ve K6s spike (Windows 10 + 11; CI'da koşamayanlar)

CI (`agent-win.yml` → `test-windows`): "P28u onaysız bağlantı + müdahale testleri (-v)" adımı sahte saat/boru/kilitle 21 testi
**zorunlu PASS** koşar (ad sözleşmesi `docs/implementation.md` "P28u K8"), pencere sınıfı testi SKIP ise uyarı; işin son adımı
"P28u K6s spike" koşucuyu gerçekten kilitler (ölçüm, kırmızı yapmaz; tablo step summary'de).

Elle (staging adresli 0.15.0 servis, §28u.9; sonuç `docs/test-raporu.md`'ye, Windows sürümüyle):

1. **K6s elle spike** — `docs/spike-p28u-k6s.md` §3 (ikilileri üret → yönetici PowerShell `k6s-elle.ps1` → yeniden giriş →
   `-Sonuc`). **Oturum zorla kapatılır**, ekran üç kez kilitlenir; açık belge bırakmayın. Sonuç spike belgesinin §2 "Sonuç" sütunlarına,
   karar §4'e göre (K-P28u-5b `--lock` gerekir mi; yeniden katılım bekleme bütçesi).
2. r3 diyalogsuz açılış: aktif kullanıcılı cihaza Bağlan → **diyalog yok**, gösterge "Uzaktan bağlantı: <ad> — <firma>" ≤ 3 sn,
   konsol doğrudan görüntü + kontrol (otomatik `control.request`); olay günlüğü 1001 "kip: onaysız", 1008 yok.
3. Yerel kapatma anahtarı: göstergeden bağlantıyı sonlandır → oturum biter.
4. (r3: onay diyaloğu, enjeksiyon ve saydam katman maddeleri kaldırıldı — diyalog yok.)
5. Kullanıcı durumu: aktif → kilitli → oturum yok geçişleri panelde ≤ 10 sn.
6. Müdahale: kontrol aç → Kilitle → ekran kilitli, 1006; Oturumu kapat → oturum kapanır, 1007, ≤ 45 sn yeniden katılım (r3: yeni
   kullanıcı girişi oturumu bitirmez).
7. (r3: izinsiz/politika maddesi kaldırıldı.)
8. İz: `trace-check.ps1 -Mode Compare … -Servis on` → `TEMİZ` (gerekçe/bilet olay günlüğünde ve ProgramData'da yok).

### 28u.9 Staging yayını — 0.15.0 (tarihsel; r3 için §28u.10)

Ön koşul: P28u qa GEÇTİ + güvenlik Kritik/Yüksek 0; `ci` ve `agent-win` koşuları yeşil (P28u adımı dahil). Staging tek yığın
`/opt/remote/deploy`, gömülü adres `https://remote.noktabilisim.net`.

1. **Sunucu önce** (yeni servis eski sunucuda onaysız çalışır — §28u.7; bu yüzden servis sunucudan önce yayınlanmaz): §25.2 akışı —
   ön yedek (`git pull`'dan önce) → `git pull` → `IMAGE_TAG` → `docker compose build && docker compose up -d` →
   `docker compose logs --since 5m migrate | grep 20261124000000_p28u_unattended_consent` (uygulandı) → `check-app-grants.sh` **798/798 PASS**
   → `systemctl start remote-backup.service` → `audit-continuity ok` (özet değişmedi). Migration süresi: önce
   `SELECT COUNT(*) FROM support_sessions` (staging küçük; bakım penceresi gerekmez — db-notlari R-P28u-6).
2. İzleme: `cd ops && ./remote-watch.sh install` → `systemctl start remote-watch.service; journalctl -u remote-watch -n 5` → `OK`,
   `status.prom`'da `check="unattended-notify-fail"} 1`.
3. **Servis + istemci 0.15.0** (operatör makinesi, repo kökü; Go gerekmez; §28a.5 komutu, yalnız `VER=0.15.0`):

   ```bash
   SERVER='https://remote.noktabilisim.net'; VER=0.15.0
   OUT="$(mktemp -d)"
   for c in noktadestek noktadestek-servis; do
     exe=$([ "$c" = noktadestek ] && echo NoktaDestek.exe || echo NoktaDestekServis.exe)
     docker run --rm -v "$PWD:/src" -v "$OUT:/out" -w /src -e GOFLAGS=-mod=readonly -e GOTOOLCHAIN=local \
       golang:1.26.11-bookworm@sha256:dc40a13b61304647ed7e5d581d246b86413dfc29d63c6d018310feb93cd98fc0 sh -c '
       git config --global --add safe.directory /src; export SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)
       apps/agent-win/build/build.sh "$0" "$1" "/out/$2" "$3"' "$SERVER" "$VER" "$exe" "$c"
   done
   mkdir -p "$OUT/istemci" "$OUT/servis"; mv "$OUT/NoktaDestek.exe" "$OUT/istemci/"; mv "$OUT/NoktaDestekServis.exe" "$OUT/servis/"
   (cd "$OUT/istemci" && shasum -a 256 NoktaDestek.exe > SHA256SUMS && cat SHA256SUMS)
   (cd "$OUT/servis" && shasum -a 256 NoktaDestekServis.exe > SHA256SUMS && cat SHA256SUMS)
   # Tekrarlanabilirlik: aynı komutu ikinci kez (yeni OUT) koşun; iki SHA da aynı olmalı (§11.6). Temiz ağaç (commit'lenmiş) şart:
   # SOURCE_DATE_EPOCH ve VCS damgası commit'ten gelir.
   ALLOW_UNATTESTED=staging deploy/agent/publish-servis.sh --dir "$OUT/servis" --no-attestation --ssh root@185.126.217.99 \
     --deploy-dir /opt/remote/deploy
   ```

   Beklenen: `kontrol: server UNATTENDED_AGENT_PATH SHA-256 = UNATTENDED_AGENT_SHA256 = <sha>`.

4. **İstemci exe (S13C-13):** tek yığın staging (proje `remote`) `verify-and-publish.sh --dir` yayınını reddeder (yalnız Release `vX.Y.Z`).
   0.15.0 istemci exe'si (`$OUT/istemci`, P28u'da istemci tarafında yeni özellik yok — sürüm hizası) test için doğrudan teslim edilir;
   `/downloads/NoktaDestek.exe` P28 sonu `v0.15.0` Release ile güncellenir (§24.4). P13c ikinci yığını kurulduysa:
   `gh workflow run agent-win.yml --ref main -f server_url=https://stg.remote.noktabilisim.net -f version=0.15.0` +
   `verify-and-publish.sh --stg-run <run-id>` (§24.8).
5. `MIN_AGENT_VERSION` **yükseltilmez** (Hızlı Destek istemcisi etkilenmez). Servis için asgari sürüm kapısı `DEVICE_OUTDATED`'dir (§28u.5).
6. Staging test VM'lerinde servis güncellemesi (§28u.5) → Windows elle turu (§28u.8) test-operatoru.
7. §8 yayın geçmişine satır: tarih, P28u, commit, migration, servis + istemci 0.15.0 SHA-256'ları, `check-app-grants` sonucu.

Prod: P28 sonu (`v0.15.0` etiketi, §24.4 onay listesi "0.15.0 → P28u" ve Windows elle turu maddeleri); prod gözetimsiz açılışı
§27.9'dadır (P32 risk kabulü, `unsigned-accepted`).

### 28u.10 P28u r3 staging yayını — onaysız tek yol (koordinatör uygular; sunucu + servis AYNI pencerede)

Ön koşul: r3 qa GEÇTİ + güvenlik Kritik/Yüksek 0; `ci` ve `agent-win` yeşil ("P28u onaysız bağlantı + müdahale testleri" adımı dahil).
**Migration yok, yeni env yok** (`.env`'de yalnız `IMAGE_TAG`). Servis sürüm numarasını ana oturum verir (aşağıda `VER`).

**Neden aynı pencere:** r3 sunucusu `rs.cap.direct1` bildirmeyen her servise 409 `DEVICE_OUTDATED` verir; yalnız sunucu çıkarsa staging'deki
**tüm** cihazlar (0.15–0.19) bağlanamaz. Ters yön güvenlidir (r3 servisi eski sunucuda sormadan açılır) → **servis ikilisi önce derlenip
hazır edilir, sunucu yayınının hemen ardından yayınlanır ve test VM'leri güncellenir.**

1. Servis + istemci derlemesi (operatör makinesi, temiz ağaç): §28u.9 adım 3 komutu, yalnız `VER=<ana oturumun verdiği>`; ikinci koşuyla
   SHA tekrarlanabilirliği. `publish-servis.sh` henüz **koşulmaz**.
2. Sunucu: §25.2 akışı — ön yedek → `git pull` → `IMAGE_TAG` → `docker compose build && docker compose up -d` →
   `docker compose logs --since 5m migrate` "No pending migrations" → `check-app-grants.sh` tümü PASS → `audit-continuity ok`.
3. **Hemen ardından** servis yayını: `ALLOW_UNATTESTED=staging deploy/agent/publish-servis.sh --dir "$OUT/servis" --no-attestation
--ssh root@185.126.217.99 --deploy-dir /opt/remote/deploy` → `kontrol: … SHA-256 = … = <sha>`.
4. İzleme: `cd ops && ./remote-watch.sh install` → `systemctl start remote-watch.service; journalctl -u remote-watch -n 5` → `OK`;
   `status.prom`'da `unattended-silent-volume` / `unattended-consent-timeout` yok, `unattended-notify-fail` 1.
5. Test VM'lerinde "Güncelle…" (§28u.5) → rozet kalkar → §28u.8 elle tur (test-operatoru).
6. Geri alma provası (§28u.7): ayrı pencerede, yedekten sonra; sonuç §8 satırına.
7. §8 yayın geçmişine satır: tarih, P28u r3, commit, "migration yok", servis + istemci SHA-256'ları, `check-app-grants` sonucu,
   `remote-watch` kontrol sayısı.

`MIN_AGENT_VERSION` yükseltilmez. Prod'da da r3 sunucusu ve servisi aynı pencerede çıkar (agent-release kontrol listesi "P28u r3 servisi").

## 28e. P28e — oturum ekranı kaydı, istemci/servis 0.16.0 (devops K8, 2026-11-16; mimari-p28e r2 §11, §12, §13–§14 K8; ADR-0034; AC-375..388, 447..450)

Kapsam: firma politikasıyla açılan, **müşteri rızasıyla** (gözetimsizde firma politikasıyla) alınan, sesi olmayan, sunucuda şifreli
(`.rsf`) saklanan oturum ekranı kaydı; geçmişten izleme (indirme yok), elle silme, 03:30 saklama süresi silmesi. **Yeni env değişkeni yok**
(mimari §11.4): sabitler `packages/contracts/src/ws-rec.ts` içinde (`REC_REQUIRE_CLUSTER_START = false`, `REC_PART_MAX_BYTES = 2097152`,
`REC_SERIES_MS = 300000` …); değiştirmek kod değişikliği + yayın gerektirir. Migration `20261125000000_p28e_recordings` (db-notlari "P28e").

### 28e.1 Ayar ve KVKK notu

- Yer: Ayarlar → **Oturum kaydı** (`/settings/recording`, `PUT /api/v1/settings/recording`). Yetki: görüntüleme `settings.view`, değiştirme
  `settings.edit`. Varsayılan **kapalı**; saklama 1–90 gün (vars. 30; yalnız yeni kayıtlara uygulanır).
- Açarken aydınlatma kutusu (`consentAck`) zorunlu. **Gözetimsiz kayıt** ayrı anahtar: çalışan bilgilendirmesi kutusu (`employeeNoticeAck`)
  - 2FA step-up; değişince P28u dört göz e-postası "Gözetimsiz bağlantı kayıt politikası değişti" gider (audit `unattended.silent.notify
{event:"recording_policy"}`; gitmezse `unattended-notify-fail` alarmı, §28u.6). Audit `settings.recording`.
- KVKK: rıza kutusu müşteride **işaretsiz** gelir; rıza satırı (`session_consents` `RECORDING`, `line_sha256`) delildir, silinmez (down
  guard). Müşteri "Kaydı durdur" ile geri alır (≤ 2 sn), o ana kadarki kısım saklanır. Gözetimsizde dayanak firma politikasıdır; cihazda
  diyalog satırı + gösterge eki görünür, cihaz kullanıcısında durdurma düğmesi yoktur (tek yol yerel anahtar, AC-295). Aydınlatma metni ve
  çalışan bilgilendirmesi müşteri firmanın sorumluluğundadır — kayıt açılmadan önce firmaya hatırlatılır.
- Acil kapatma: ayarda anahtarı kapat → açık kayıtlar `policy_off` ile durur (audit `recording.stop`), mevcut kayıtlar saklama süresince kalır.

### 28e.2 Disk planı (kayıtlar P28b kotasının içindedir)

- Kayıt ve dosya aynı firma kotasını paylaşır (`storage_quota_gb`, vars. **20 GB**; `rs_storage_used_bytes` ikisini birlikte sayar). Ayrı
  kayıt kotası yoktur. 20 GB ≈ 30 sa kayıt (hedef 1,5 Mbit/s; 1 sa ≤ 1 GB tavanı `REC_MAX_BYTES_PER_HOUR`).
- Kural §28b.1'deki gibi: **Σ(firma kotası) ≤ `/var/lib/docker` boş alanının %80'i**. Örnek: 25 firma × 20 GB = 500 GB → en az ~625 GB boş alan.
  Kontrol:
  ```bash
  df -BG /var/lib/docker
  docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot "$MYSQL_DATABASE"' \
    <<<"SELECT COUNT(*) firma, SUM(storage_quota_gb) toplam_kota_gb FROM tenants WHERE deleted_at IS NULL;"  # pasif firmalar da diskte yer tutar
  ```
  Aşıyorsa Super Admin kotaları düşürür ya da disk büyütülür. Boş alan < %10 iken sunucu yeni parçayı reddeder ve kayıt `quota` ile durur
  (müşteri/teknisyen görür); remote-watch `disk:/var/lib/docker` %80'de önce çalar (yeni disk alarmı yok, mimari §11.3 "aynen").
- Satır büyümesi önemsiz (tenant başına ≈ 5 MB indeks+veri, db-notlari R-P28e-1).

### 28e.3 Yedek: kayıtlar yedeğe girmez (kullanıcı kararı S-P28-3, K-P28b-11)

- `.rsf` dosyaları `stored_files` volume'unda (`FILES_DIR=/data/files`); `backup.sh` bu volume'u **almaz**. Sunucunun günlük tam yedeği
  ayrıca vardır — kayıt dosyası kurtarma gerekiyorsa oradan, ancak DB ile aynı ana ait olmalı.
- Yedekten dönüşte (§18): DB'de olup dosyası olmayan parçalar ilk mutabakat turunda silinir; parçası kalmayan kayıt `DELETED{MISSING}` olur
  (geçmişte "kayıt dosyası bulunamadı", audit `recording.delete deleteReason:"missing"`, aktör sistem). Bu beklenen davranıştır.

### 28e.4 Anahtar emekliliği (R-P28e-3)

Parçalar `APP_ENCRYPTION_KEYS` halkasının o anki sürümüyle (`key_ver`) şifrelenir; `crypto:rewrap` kayıtlara **dokunmaz**. Eski sürüm halkadan ancak:

```bash
docker compose run --rm migrate pnpm --filter @remote/server cli crypto:check-retire <ver>
# … tablo=session_recording_parts.key_ver surum=<ver> satir=0  -> kaldırılabilir (diğer tablolar da 0 olmalı, §25)
```

`satir>0` ise **en son yazılan kaydın saklama süresi (≤ 90 gün) dolana kadar** beklenir; 03:30 işi süresi dolanı siler, sayım düşer.
Erken kaldırmak = o sürümle yazılmış kayıtlar çözülemez, izlenemez.

### 28e.5 Kayıt sorgulama ve elle silme

- Panel: Oturum geçmişi → süzgeç "Kayıt: Kayıtlı" → oturum → "Oturum kaydı" bölümü (meta, **Kaydı izle**, **Kaydı sil**). İzleme
  `sessions.view_recording`, silme `session_history.edit` yetkisi ister; her izleme `recording.view` + `recording.view.end` (sunulan parça/
  bayt, kısıtlama) audit'e yazılır. İndirme yoktur.
- Salt okunur SQL (destek/denetim; firma kimliğiyle süzün):
  ```sql
  SELECT id, session_id, state, basis, stop_reason, delete_reason, started_at, stopped_at, duration_ms,
         ROUND(size_bytes/1048576) mb, part_count, expires_at
  FROM session_recordings WHERE tenant_id = ? ORDER BY started_at DESC LIMIT 50;
  SELECT tenant_id, ROUND(SUM(size_bytes)/1073741824, 2) gb FROM session_recordings
  WHERE state IN ('ACTIVE','STOPPED') GROUP BY tenant_id ORDER BY gb DESC;
  ```
- **Elle silme yalnız panelden/API'den** (`DELETE /api/v1/sessions/<id>/recording`): disk → parçalar → kayıt sırası ve audit
  `recording.delete{deleteReason:"manual"}` ancak böyle tutarlı olur. SQL ile satır ya da diskten dosya **silinmez** (yetim dosya ve audit
  boşluğu; app kullanıcısının zaten kayıt satırında sınırlı yetkisi var).
- Firma silme / anonimleştirme kayıtları da siler (§23; db-notlari "Silme sırası").

### 28e.6 Alarmlar (`remote-watch`, 10 dk; eşikler `deploy/ops/remote-watch.sh`, mimari-p28e §11.3)

Server P28e öncesiyse (`rs_rec_part_total` yok) üçü de değerlendirilmez. Betik değişti → `cd /opt/remote/deploy/ops && ./remote-watch.sh
install` (ikinci yığında ayrıca `install stg`). Metrik adları `apps/server/src/rec/types.ts` `REC_METRICS` ile birebir (test-watch.sh denetler).

| Kontrol                | Koşul                                                                                                                       | Düzey | Eylem                                                                                                                                                                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rec-stop-error`       | 1 sa'te `rs_rec_stop_total{reason="error"}` artışı ≥ 3 (`WATCH_REC_ERR_MIN`) ve tüm durmaların > %20'si                     | Uyarı | Gözcü (`no_upload`: kaydedici bağlı, görüntü akıyor, 30 sn parça yok) ya da tarayıcı kaydedici hatası. Audit `recording.stop` → `cause` (`no_upload`, `rate`, `invalid`, `orphan`, tarayıcı kodları); hangi tarayıcı/firma; Caddy 413/5xx (§28e.7) |
| `rec-part-rejected`    | 10 dk'da `rs_rec_part_total{result=~"invalid\|rate\|busy"}` artışı > 10 (`WATCH_REC_PART_BAD_MAX`; pencere fiilen 10–20 dk) | Uyarı | `invalid` = bozuk/sesli WebM ya da sürüm uyuşmazlığı; `rate` = 1 sa > 1 GB / dakikada > 30 PUT; `busy` = eşzamanlı PUT. Kasıtlı yük şüphesinde ilgili teknisyen oturumu sonlandırılır                                                              |
| `rec-view-throttled`   | 1 sa'te `rs_rec_view_throttled_total` artışı > 50 (`WATCH_REC_VIEW_THROTTLE_MAX`)                                           | Uyarı | Toplu çekiş denemesi: Audit `recording.view.end` (`throttled`, `bytesServed`) → kullanıcı; beklenmiyorsa `sessions.view_recording` yetkisi kapatılır / oturumları sonlandırılır                                                                    |
| `disk:/var/lib/docker` | doluluk ≥ %80 (mevcut, P28b)                                                                                                | Uyarı | §28e.2; kayıt %10 boşta kendiliğinden durur                                                                                                                                                                                                        |

Elle bakış: `rs_rec_active` (anlık açık kayıt), `rs_rec_part_bytes` (parça boyu dağılımı; 2 MiB kovasında yığılma = bit hızı tavanı).

```bash
docker compose exec -T server node -e "fetch('http://127.0.0.1:3001/metrics',{headers:{authorization:'Bearer '+process.env.METRICS_TOKEN}}).then(r=>r.text()).then(t=>console.log(t.split('\n').filter(l=>/^rs_(rec_|storage_used)/.test(l)).join('\n')))"
```

### 28e.7 Ters vekil: gövde sınırı, CSP, log

- Parça `PUT /api/v1/rec/<rid>/series/<s>/parts/<p>` en çok **2 MiB (2097152 bayt)**. Caddy `@recPart` bu tavanı uygular ve parça yolu
  `@notUpload`'tan (2MB = 2.000.000 SI) dışlanır — K8'de bulunan hata: dışlanmasaydı 2.000.001–2.097.152 baytlık parçalar Caddy'de 413
  alırdı. nginx `client_max_body_size 3m` + `client_body_buffer_size 3m` (bellekte, diske yazılmaz). `read_body 30s` → parçayı yükleyen
  konsol (teknisyen tarayıcısı) tarafında en az ≈ 560 kbit/s yükleme gerekir (hedef bit hızı zaten 1,5 Mbit/s). Test: `deploy/test-caddy.sh` "P28e kayıt parçası".
- Yükleme/izleme belirteci yalnız `Authorization: Bearer` başlığında; Caddy iki log bloğunda da siler (G-10; sorgu dizesi, çerez,
  `Sec-WebSocket-Protocol` de silinir). Yoldaki `rid` gizli değildir.
- CSP'yi uygulama üretir: `apps/web/proxy.ts` `media-src 'self' blob:` (yalnız oynatıcı MSE; `default/script/worker-src`'ye `blob:` girmez,
  birim testi dizeyi sabitler). Caddy CSP eklemez.

### 28e.8 Windows elle turu (Windows 10 + 11; CI'da koşamayanlar)

CI (`agent-win.yml` → `test-windows`): "P28e kayıt rızası + gösterge + servis eki testleri (-v)" adımı 33 testi **zorunlu PASS** koşar
(ad sözleşmesi `docs/implementation.md` "P28e K8"). Elle (staging adresli 0.16.0, §28e.9; sonuç `docs/test-raporu.md`'ye, Windows sürümüyle):

**İstemci (Hızlı Destek, K5):**

1. Kayıt açık firmada kodla katıl: karşılamada kayıt kutusu var ve **işaretsiz**; işaretlemeden bağlan → kayıt başlamaz.
2. Kayıt kapalı firma / kota dolu: kutu görünmez.
3. Kutuyu işaretleyip bağlan (çok monitörde seçim ekranında 30 sn+ bekle) → konsolda kayıt başlar; oturum penceresinde "● Kayıt yapılıyor" +
   "Kaydı durdur" + geri alınamaz notu; her monitörde üstte şerit.
4. Oturum penceresini küçült → şerit görünür kalır; başka pencereyi en üste al → şerit 1 sn içinde yine üstte; şerit teknisyen görüntüsünde yok.
5. Şeride tıkla → ≤ 2 sn'de konsol kaydı durur, şerit kalkar, "Kayıt durduruldu; o ana kadarki kısım saklanır". Aynısı "Kaydı durdur" (Alt+D)
   ile. Kayıt bu oturumda yeniden başlamaz.
6. Ağı kes (kayıt açıkken) → "Kaydı durdur" → 2 sn sonra "Kayıt durdurulamadı, paylaşım duraklatıldı", teknisyen görüntüsü donar; ağı aç →
   kayıt durur, paylaşım kendiliğinden sürer.
7. Kayıt sürerken teknisyen tarafında kota/politika kapat → şerit kalkar, bilgi satırı nedeni yazar.
8. Koyu/açık tema ve %150 DPI: karşılama kutusu taşmıyor, kayıt satırı ve şerit okunaklı.
9. Talep formu: kutu işaretsiz; işaretli talep → kabul + paylaşımla kayıt başlar; işaretsizse başlamaz; kayıt kapalı firmada kutu yok.

**Servis + yardımcı (gözetimsiz, K6):**

10. Politika açık + izinli (`asked`) + kullanıcı aktif: diyalogda firma satırının altında kalın "Bu bağlantının ekran kaydı alınacaktır";
    100/125/150/200 % DPI'da kırpılmaz; "İzin ver" 1,5 sn sonra etkin.
11. Politika kapalıyken diyalog P28u düzeninde (satır yok).
12. Gösterge "Uzaktan bağlantı: … — Kayıt yapılıyor" tüm monitörlerde, ek tam görünür; izinsizde izleme ↔ kontrol geçişinde ek kalır.
13. Konsoldan kaydı durdur / kota / politika kapat → ek ≤ 1 sn'de kalkar, bağlantı sürer; olay 1009 "durdu".
14. Kilit (Win+L) / UAC masaüstü geçişinde gösterge ekiyle yeniden çizilir; logoff + yeniden katılımda son kayıt durumuyla gelir.
15. Cihaz kullanıcısında kaydı durduran düğme/menü yok; yerel anahtarı kapatmak bağlantıyı ≤ 2 sn'de keser.
16. Olay günlüğü: 1001 metninde "ekran kaydı: alınıyor (destek firması politikası)", 1009 başladı/durdu; bilet/kişisel veri yok.
17. Eski sunucu (record1 göndermeyen): bağlantı kayıtsız, ek yok, diyalog satırı yok.

**Konsol tarayıcısı (K7 açıkları) ve kapasite:**

18. Firefox ve Edge: kayıt + oynatma + seek + çözünürlük değişimi + `p>0` Cluster hizası ölçümü (`REC_REQUIRE_CLUSTER_START` kararı, mimari §12). Çalışmayan tarayıcı `rs.cap.rec1` bildirmemeli (V-PE-5).
19. Konsol sekmesi **6+ dk arka planda** kayıt: parça aralığı, 60. parçada bölüm geçişi (5 dk), `stop()` kuyruk kaybı, CPU.
20. Gerçek sunucuyla uçtan uca (staging): 11 dk kayıt (3 bölüm) → geçmişten izle, seek, boşluk atlama.
21. **1 sa kayıt boyutu ≤ 1 GB** (AC-384): geçmiş meta "boyut" ya da §28e.5 SQL.

Olay günlüğü filtresi (1009 eklendi):
`Get-WinEvent -FilterHashtable @{LogName='Application'; ProviderName='NoktaDestek'; Id=1001,1004,1006,1007,1008,1009} -MaxEvents 50 | Format-List TimeCreated,Id,LevelDisplayName,Message`

| Kimlik | Düzey | Anlam                                                                                           |
| ------ | ----- | ----------------------------------------------------------------------------------------------- |
| 1009   | Bilgi | Ekran kaydı başladı / durdu (teknisyen, oturum). Gözetimsiz servis; her `rec.state` değişiminde |

### 28e.9 Staging yayını (koordinatör uygular; sıra bağlayıcı)

Ön koşul: P28e qa GEÇTİ + güvenlik Kritik/Yüksek 0; `ci` (test-caddy, shellcheck dahil) ve `agent-win` (P28e adımı dahil) yeşil.

1. **Sunucu önce** (yeni servis/istemci eski sunucuda kayıtsız çalışır, ama sunucu önce gelirse rıza/gösterge yolu hazır olur): §25.2
   akışı — ön yedek → `git pull` → `IMAGE_TAG` → `docker compose build && docker compose up -d` →
   `docker compose logs --since 5m migrate | grep 20261125000000_p28e_recordings` (uygulandı) → `check-app-grants.sh` **873/873 PASS** →
   `systemctl start remote-backup.service` → `audit-continuity ok` (tetikleyici 23, özet değişmedi).
   **Migration süresi:** `session_consents` tek COPY ALTER (tablo yeniden yazılır, süresince rıza/admit yazımı bekler). Önce
   `SELECT COUNT(*) FROM session_consents` — staging küçük, pencere gerekmez; **prod'da bakım penceresinde** ve açık oturum yokken.
2. Caddy (Caddyfile değişti — `@recPart`; bind mount, admin API kapalı → `reload` yok, `up -d` tek başına yeniden yaratmaz):
   `docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile` → `docker compose up -d --force-recreate caddy` (P19 kalıbı).
   Doğrulama: konsoldan kısa bir kayıt → `docker compose logs --since 5m caddy | grep -c '"status":413'` = 0.
   Host nginx değişmedi (yalnız yorum; isteğe bağlı `nginx -t && systemctl reload nginx`).
3. İzleme: `cd ops && ./remote-watch.sh install` → `systemctl start remote-watch.service; journalctl -u remote-watch -n 5` → `OK`,
   `status.prom`'da `check="rec-stop-error"} 1`.
4. **Servis + istemci 0.16.0:** §28u.9 adım 3 komutu, yalnız `VER=0.16.0` (ikinci koşuyla SHA tekrarlanabilirliği). Servis:
   `ALLOW_UNATTESTED=staging deploy/agent/publish-servis.sh --dir "$OUT/servis" --no-attestation --ssh root@185.126.217.99 --deploy-dir /opt/remote/deploy`
   → `kontrol: server UNATTENDED_AGENT_PATH SHA-256 = UNATTENDED_AGENT_SHA256`.
5. **İstemci exe (S13C-13):** tek yığın staging `--dir` yayınını reddeder → `$OUT/istemci/NoktaDestek.exe` test için **doğrudan teslim**
   (0.16.0 istemcide gerçek yenilik var: rıza kutusu, şerit, Kaydı durdur — eski istemci kayda hiç girmez, `rs.cap.rec1` bildirmez).
   `/downloads/NoktaDestek.exe` P28 sonu `v0.16.0` Release ile güncellenir (§24.4).
6. `MIN_AGENT_VERSION` yükseltilmez. Staging test VM'lerinde servis "Güncelle…" (§28u.5) → Windows elle turu (§28e.8) test-operatoru.
7. §8 yayın geçmişine satır: tarih, P28e, commit, migration, servis + istemci 0.16.0 SHA-256'ları, `check-app-grants` 873/873.

Geri alma: ayarda kaydı kapat (açık kayıtlar `policy_off`) → önceki `IMAGE_TAG` → tablolar kalır (expand; eski sunucu kullanmaz). Migration
down yalnız kayıt/rıza verisi yokken mümkün (guard 3819; rıza satırı KVKK delili). 0.16.0 servis/istemci eski sunucuyla kayıtsız çalışır —
ikili geri alınmaz. Prod: P28 sonu (`v0.16.0`, §24.4 onay listesi "0.16.0 → P28e" + Windows kayıt elle turu).

## 28c. P28c — çoklu teknisyen (davet, İzle, devir), istemci/yardımcı 0.17.0 (devops K4, 2026-11-16; mimari-p28c r2 §6.1, §7, §8, §9, §12, §13 K4; ADR-0035; AC-364..372)

Kapsam: oturum sahibi aynı firmadan teknisyen davet eder, `sessions.supervise` sahibi etkin oturumu "İzle" ile izleyici olarak
açar, sahip kontrolü ya da oturumu devreder; müşteri tüm teknisyenleri adıyla görür ve sahip dışındakileri "Çıkar" ile çıkarır. Mesh:
müşteri her teknisyene ayrı akış yükler (kontrol sahibine ana, diğerlerine tavanlı düşük akış). **Yeni env değişkeni yok, migration
yok, yeni tablo yok** (`check-app-grants` değişmez). Sabitler `packages/contracts/src/ws-multi.ts`: `MAX_TECHS = 3` (sahip dahil),
`INVITE_TTL_MS = 120000` (davet 2 dk), `MEMBER_RESERVE_MS = 60000` (kabul/İzle sonrası koltuk 60 sn ayrılı), `MEMBER_GRACE_MS =
120000` (kopan üyeye 120 sn dönüş), `MULTI_JOIN_PER_MIN = 20` (kabul/İzle, kullanıcı başına), `MULTI_POLL_PER_MIN = 60`,
`MULTI_ROOM_CMDS_PER_MIN = 10`, `LOW_FPS = 8` (taban 5), `LOW_BPS = 1000000`. Değiştirmek kod değişikliği + yayın gerektirir.

### 28c.1 Yeni yetkiler (Kullanıcılar → kullanıcı → "Oturumlar" grubu)

| Anahtar              | Anlam                                                                                  | Varsayılan              |
| -------------------- | -------------------------------------------------------------------------------------- | ----------------------- |
| `sessions.invite`    | Etkin oturuma aynı firmadan teknisyen davet et; kontrolü / oturumu devret (sahipken)   | Admin açık, User kapalı |
| `sessions.supervise` | Firmanın etkin oturumlarını izleyici olarak "İzle" (hassas — uyarı tonuyla gösterilir) | Admin açık, User kapalı |

- **Gözetimsiz odada** kabul ve İzle için **2FA kurulu olmalı** (yoksa 403 `MFA_SETUP_REQUIRED`, konsol "Önce 2FA kurun") ve son
  5 dk içinde step-up gerekir (`sessions/invites.ts` `requireUnattendedStepUp`); gözetimli odada ek step-up istenmez.
- Gözetimsiz odada ek olarak cihaz yetkisi gerekir; **izinsiz (`silent`) odaya** katılan/izleyenin `unattended.silent` yetkisi de olmalı
  ve 20–500 karakter **gerekçe** yazması zorunludur (yalnız audit'te). İzinli (`asked`) gözetimsiz odada ek katılım **kapalıdır**
  (409 `JOIN_NOT_ALLOWED`, düğmeler pasif + neden).
- Yetki geri alındığında / kullanıcı pasife alındığında / şifre değiştiğinde üye odadan ≤ 5 sn (anlık) ya da ≤ 60 sn (yedek döngü)
  içinde düşer; **oda yalnız sahip için biter**.
- Eski istemci (0.16.x ve öncesi, `rs.cap.multi1` bildirmez): "Davet et" ve "İzle" pasif, AC-352 metniyle açıklanır (AC-372).

### 28c.2 Audit (AC-370) ve sorgu

Audit süzgecinde "Çoklu teknisyen" grubu: `session.invite`, `session.invite_accept`, `session.invite_reject`, `session.invite_expire`
(`reason`: `timeout` / `session_end` / `revoked`), `session.participant_join`, `session.participant_leave`, `session.participant_remove`
(müşteri çıkardı), `session.supervise_join`, `session.control_handover`, `session.transfer`. `entity = support_sessions`,
`entity_id = sessionId`. Sohbet içeriği yazılmaz. r3 (K-P28u-r3-9): silent oda yok; katılım/devirde dört göz
e-postası (`event: join | transfer`) **gitmez** — eski audit satırları okunur kalır.

### 28c.3 Hız sınırları (429 `RATE_LIMITED`)

Kabul / İzle kullanıcı başına 20/dk; davet / etkin oturum yoklaması 60/dk/kullanıcı (panel 5 sn ve 10 sn yoklar — iki sekme açık bir
kullanıcı sınırın altında kalır); oda içi komutlar (devir, çıkarma) oda başına 10/dk. Başarısız İzle/kabul/davet `fail` audit'i aynı
(kullanıcı, oturum, kod) için dakikada en çok 1. 429 şikâyetinde önce açık sekme sayısı ve tarayıcı eklentisi (otomatik yenileme) sorulur.

### 28c.4 Davet / katılım sorun giderme

| Belirti                                                 | Neden / eylem                                                                                                                           |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| "Oturum dolu" (409 `SESSION_FULL`)                      | Sahip + 2 üye (ya da bekleyen davet/60 sn rezervasyon) dolu. Sahip daveti geri çeker ya da üye ayrılır; rezervasyon 60 sn'de düşer      |
| "Davet artık geçerli değil" (410 `INVITE_GONE`)         | 2 dk doldu, sahip geri çekti ya da oturum bitti. Yeni davet istenir                                                                     |
| Davet/İzle düğmesi pasif, "istemci desteklemiyor"       | Müşteri 0.16.x ve öncesi; istemcinin 0.17.0'a güncellenmesi (Hızlı Destek yeniden indirilir; servis "Güncelle…", §28u.5)                |
| Davet/İzle pasif, "İzinli gözetimsiz bağlantı"          | Tasarım gereği (`asked` kipinde ek teknisyen yok)                                                                                       |
| Kabulde gerekçe isteniyor                               | Oda izinsiz (`silent`); 20–500 karakter gerekçe zorunlu                                                                                 |
| Teknisyen soketi 4403 "removed" ile kapandı             | Müşteri "Çıkar"a bastı ya da yetki düştü; audit `session.participant_remove` / `participant_leave{reason}`                              |
| Üye ekranı donuk / düşük kalite                         | Beklenen: kontrol sahibi dışındakiler tavanlı düşük akış alır (≤ 8 FPS, 1 Mbit/s). Kontrol devriyle ana akış yer değiştirir             |
| Müşteri listesinde ad yok ama teknisyen bağlı görünüyor | Olmamalı (gizli izleyici yok, Y-PC-4): misafir roster'da adı çizilmemiş teknisyenin bağlantısını kurmaz. Hata olarak güvenliğe bildirin |

### 28c.5 Metrikler (`/metrics`, Bearer `METRICS_TOKEN`; tenant etiketi yok)

| Metrik                                                              | Tür      | Anlam                                                                                                |
| ------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `rs_multi_invites_total{result: sent\|accepted\|rejected\|expired}` | sayaç    | Davet akışı. `rejected`/`expired` oranı yüksekse davetliler bildirimi görmüyor olabilir (elle bakış) |
| `rs_multi_members{role}`                                            | gösterge | Anlık üye sayısı (participant / observer)                                                            |
| `rs_multi_denied_total{type}`                                       | sayaç    | Rol kapısı (varsayılan-ret) reddettiği teknisyen mesajları, mesaj tipine göre. Alarm §28c.6          |

```bash
docker compose exec -T server node -e "fetch('http://127.0.0.1:3001/metrics',{headers:{authorization:'Bearer '+process.env.METRICS_TOKEN}}).then(r=>r.text()).then(t=>console.log(t.split('\n').filter(l=>/^rs_multi_/.test(l)).join('\n')))"
```

### 28c.6 Alarm (`remote-watch`, 10 dk; eşik `deploy/ops/remote-watch.sh`)

Server P28c öncesiyse (`rs_multi_denied_total` yok) değerlendirilmez. Betik değişti → `cd /opt/remote/deploy/ops && ./remote-watch.sh
install` (ikinci yığında ayrıca `install stg`). Test: `deploy/ops/test-watch.sh` (P28c bölümü + ad eşlemesi: betikteki `rs_multi_*` adı
`apps/server/src/ops/metrics.ts`'te birebir olmalı).

| Kontrol        | Koşul                                                                                            | Düzey | Eylem                                                                                                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `multi-denied` | 1 sa'te `rs_multi_denied_total` (bütün `type`) artışı > 20 (`WATCH_MULTI_DENIED_MAX`, watch.env) | Uyarı | Konsol yetkisiz mesajı arayüzde göndermez → ret = rol yükseltme denemesi (izleyici/katılımcı girdi, dosya, pano gönderiyor) ya da web/sunucu sürüm uyuşmazlığı. Hangi `type` arttı (§28c.5 komutu) → server logu (rol kapısı reddi, oda başına 1/dk; tid/sessionId; `docker compose logs --since 1h server | grep -i denied`) → audit'ten kullanıcı. Kasıt şüphesinde kullanıcının oturumlarını sonlandır + `sessions.invite/supervise` kapat; yayın sonrası başladıysa geri alma (§28c.10) |

Davet reddi/süre dolumu ve üye sayısı için alarm yoktur (kullanıcı davranışı); elle bakış §28c.5.

### 28c.7 Windows elle turu (Windows 10 + 11; CI'da koşamayanlar)

CI (`agent-win.yml` → `test-windows`): "P28c çoklu teknisyen testleri (-v)" adımı adında `P28c` geçen Go testlerini koşar, listedekiler
**zorunlu PASS** (K0 sözleşme testleri; K3 kendi adlarını ekler). Elle (staging adresli 0.17.0, §28c.9; üç teknisyen hesabı: A sahip, B,
C aynı firmada, 2FA kurulu, `sessions.invite` A'da, `sessions.supervise` C'de; sonuç `docs/test-raporu.md`'ye, Windows sürümüyle):

**Hızlı Destek istemcisi (müşteri):**

1. **Davet:** A oturumdayken B'yi davet eder → B panelinde ≤ 5 sn bildirim; kabul → müşteri ekranında teknisyen listesi "A — Kontrol
   sahibi", "B — Katılımcı" ≤ 2 sn'de. Reddet → A'da "reddedildi". 2 dk beklet → davet düşer (`session.invite_expire{timeout}`).
2. **İzle:** C "Etkin oturumlar"dan İzle → müşteride "C — İzleyici". C'nin konsolunda kontrol, sohbete yazma, dosya, pano, yazdırma,
   işaretleme yok/pasif; DevTools'tan elle gönderilen `input` sunucuda reddedilir (`rs_multi_denied_total{type="input"}` artar).
3. Dördüncü teknisyen (davet ya da İzle) → "Oturum dolu".
4. **Kontrol devri:** A → B "Kontrolü devret": müşteride B "Kontrol sahibi", izin VIEW'a döner, B izni yeniden ister (AC-99). A'nın
   görüntüsü düşük akışa geçer, B'ninki ana akışa (§28c.8 ile ölçülür). A geri alır → tersine döner.
5. **Oturum devri:** A → B "Oturumu devret": B sahip olur; geçmişte tüm katılımcılar + devir zamanı (AC-369). A ayrılır, oda sürer.
6. **Müşteri listesi + Çıkar:** müşteri B'yi "Çıkar" → B konsolu 4403 "removed" ile kapanır, liste ≤ 2 sn'de güncellenir; sahibin yanında
   "Çıkar" yok. Sohbet: B'nin mesajı müşteride ve C'de B adıyla, müşterininki herkeste görünür.
7. Sahip devretmeden "Oturumu bitir" → tüm üyeler düşer.
8. %150 DPI ve koyu/açık tema: teknisyen listesi uzun adlarda (100 karakter) taşmıyor.

**Servis + yardımcı (gözetimsiz):**

9. `no_user` / `silent` cihazda İzle ve davet çalışır; **gösterge metni tüm adları listeler** ("Uzaktan izleniyor — A, C"), her monitörde;
   yeni ad çizilmeden yeni teknisyenin görüntüsü başlamaz (iz: C'nin konsolunda görüntü, gösterge adından **sonra** gelir).
10. **Silent odaya katılım:** kabul/İzle'de gerekçe kutusu (20–500); boş ya da 19 karakter → hata; geçerli gerekçe → katılım + **dört göz
    e-postası** "katılım" (P28u alıcıları) gelir; oturum devrinde "devir" e-postası. Audit `unattended.silent.notify{event:"join"|"transfer"}`.
11. **Asked odada kapalı:** izinli (`asked`) gözetimsiz oturumda "Davet et" ve "İzle" pasif + neden; API'den zorlanırsa 409 `JOIN_NOT_ALLOWED`.
12. Cihaz kullanıcısında "Çıkar" yok (gözetimsiz); müdahale (kilit, oturum kapatma) yalnız kontrol sahibinde.
13. Eski servis (0.16.x): Davet/İzle pasif (AC-372).

### 28c.8 AC-371 elle ölçümü (staging; test-operatoru + kullanıcı Windows)

Hedef: 3 teknisyenli oturumda, müşteri yüklemesi **10 Mbit/s** iken kontrol sahibinde **≥ 15 FPS** (AC-41), diğer iki teknisyende **≥ 5 FPS**;
bant yetmezse önce izleyici kalitesi düşer. Sunucu medya taşımaz (mesh) → **şekillendirme sunucuda değil, müşteri makinesinin çıkışında**
yapılır.

**Ortam:**

- Müşteri: Windows 10/11, **1920×1080**, gerçek ağ yükleme hızı ≥ 10 Mbit/s (önce speedtest ile; altındaysa ölçüm geçersiz).
- Teknisyenler A (sahip), B (katılımcı), C (izleyici): ayrı makineler, Chrome, indirme ≥ 10 Mbit/s.
- **Ekran içeriği sürekli hareketli** olmalı (durağan ekranda FPS anlamsız düşer): müşteride tam ekran 1080p video (ör. yerel bir mp4,
  döngüde) ya da tarayıcıda sürekli kayan bir sayfa. Aynı içerik her turda kullanılır.

**Yükleme şekillendirme (müşteri Windows, yönetici PowerShell) — DENENMEDİ, test-operatoru ilk koşuda doğrular:**

```powershell
# Hızlı Destek istemcisi için 10 Mbit/s çıkış tavanı (politika tabanlı QoS; UDP dahil uygulama yolu eşleşmesi)
New-NetQosPolicy -Name AC371 -AppPathNameMatchCondition 'NoktaDestek.exe' -ThrottleRateActionBitsPerSecond 10000000 -PolicyStore ActiveStore
# Tarayıcı misafir turu için aynı politikayı chrome.exe ile kurun (önce AC371'i kaldırın):
#   New-NetQosPolicy -Name AC371 -AppPathNameMatchCondition 'chrome.exe' -ThrottleRateActionBitsPerSecond 10000000 -PolicyStore ActiveStore
Get-NetQosPolicy -PolicyStore ActiveStore
# Bitince:
Remove-NetQosPolicy -Name AC371 -PolicyStore ActiveStore -Confirm:$false
```

`ActiveStore` yeniden başlatmada silinir (kalıcı iz bırakmaz). **Tavanın gerçekten uygulandığı doğrulanır:** 3 teknisyen bağlıyken
Görev Yöneticisi → Performans → Ethernet/Wi-Fi "Gönder" ≤ ~10 Mbit/s olmalı; politikayı kaldırınca 10'u aşabilmeli (yük hem ana hem iki
düşük akışla ≈ 6,7 Mbit/s hedefli olduğundan aşmayabilir — bu durumda tavanı 5 Mbit/s'e indirip "önce izleyici düşer" davranışı
ayrıca gözlenir). QoS politikası çalışmazsa alternatif: müşteri ile internet arasında Linux köprü/yönlendirici üzerinde
`tc qdisc add dev <çıkış> root tbf rate 10mbit burst 32kbit latency 50ms` (bitince `tc qdisc del dev <çıkış> root`), ya da pfSense limiter.

**Ölçüm (her teknisyen tarayıcısında ayrı):**

1. Oturumu kur, B'yi davet et, C İzle; hareketli içeriği başlat; **30 sn ısınma** bekle.
2. Her teknisyende `chrome://webrtc-internals` → oturumun PeerConnection'ı → `inbound-rtp` (kind=video) → **`framesPerSecond`** grafiği;
   **en az 60 sn** gözle, ortalama ve en düşük değeri yaz. Ek alanlar: `frameWidth`/`frameHeight`, `bytesReceived` hızı (≈ bit hızı),
   `framesDropped`, `jitter`. Aday çift türü (`candidate-pair` seçili: `host`/`srflx`/`relay`) not edilir. Konsol kalite paneli (getStats
   FPS) aynı değeri göstermeli — farklıysa ikisi de yazılır.
3. Müşteri tarafı (tarayıcı misafir turunda): `chrome://webrtc-internals` → üç `outbound-rtp` video; ana gönderici sınırsız, ikinciller
   `maxFramerate 8`, `maxBitrate 1000000` (parametreler `getParameters` ile ya da `framesPerSecond` ≤ 8).
4. **Kontrol devri sonrası yeniden ölç:** A → B kontrol devri; 30 sn bekle; B ≥ 15 FPS, A ve C ≥ 5 FPS olmalı.
5. Turlar: (a) Go istemci (Hızlı Destek 0.17.0), (b) tarayıcı misafir, (c) gözetimsiz servis (`no_user`). Her tur ayrı satır.

**Kayıt** (`docs/test-raporu.md`, AC-371): tarih, Windows sürümü, müşteri ağı (ölçülen yükleme), tavan yöntemi ve doğrulaması, tur,
teknisyen başına rol / ort. FPS / en düşük FPS / çözünürlük / ≈ bit hızı / aday türü, devir öncesi-sonrası. Geçme ölçütü yalnız
AC-371'dir (sahip ≥ 15, diğerleri ≥ 5); başarısızlık R43 notuyla mimara gider (SFU/simulcast "Sonra" kararı).

### 28c.9 Staging yayını (koordinatör uygular; sıra bağlayıcı)

Ön koşul: P28c qa GEÇTİ + güvenlik Kritik/Yüksek 0; `ci` (test-watch, shellcheck, actionlint dahil) ve `agent-win` (P28c adımı dahil) yeşil.
Staging tek yığın `/opt/remote/deploy`.

1. **Sunucu önce** (0.17.0 istemci eski sunucuda tek teknisyenle çalışır — sunucu bilinmeyen `rs.cap.*` belirtecini yok sayar, P28e
   kalıbı; sunucu önce gelirse davet/İzle yolu hazır olur): §25.2 akışı — ön yedek → `git pull` → `IMAGE_TAG` →
   `docker compose build && docker compose up -d`. **Migration yok:** `docker compose logs --since 5m migrate` → "No pending migrations"
   (yeni migration adı görünmemeli). `check-app-grants.sh` **değişmez**: P28e'deki sonuçla aynı (**873/873 PASS**, tetikleyici 23) beklenir;
   sayı değiştiyse dur, db-notlari'na bak. `systemctl start remote-backup.service` → `audit-continuity ok`.
2. Caddy / host nginx **değişmedi** (yeni yol yok; WS ve REST mevcut önekte) — yeniden yaratma gerekmez.
3. İzleme: `cd ops && ./remote-watch.sh install` → `systemctl start remote-watch.service; journalctl -u remote-watch -n 5` → `OK`,
   `status.prom`'da `check="multi-denied"} 1`.
4. **Servis + istemci 0.17.0:** §28u.9 adım 3 komutu, yalnız `VER=0.17.0` (temiz ağaç; ikinci koşuyla SHA tekrarlanabilirliği). Servis:
   `ALLOW_UNATTESTED=staging deploy/agent/publish-servis.sh --dir "$OUT/servis" --no-attestation --ssh root@185.126.217.99 --deploy-dir /opt/remote/deploy`
   → `kontrol: server UNATTENDED_AGENT_PATH SHA-256 = UNATTENDED_AGENT_SHA256 = <sha>`.
5. **İstemci exe (S13C-13):** tek yığın staging `--dir` yayınını reddeder → `$OUT/istemci/NoktaDestek.exe` test için **doğrudan teslim**
   (0.17.0'da istemci yeniliği: `rs.cap.multi1`, eş haritası, iki kodlayıcı, teknisyen listesi + Çıkar). `/downloads/NoktaDestek.exe`
   P28 sonu `v0.17.0` Release ile güncellenir (§24.4).
6. `MIN_AGENT_VERSION` **yükseltilmez** (eski istemcide davet/İzle yalnız pasif). Staging test VM'lerinde servis "Güncelle…" (§28u.5) →
   Windows elle turu (§28c.7) ve AC-371 ölçümü (§28c.8) test-operatoru.
7. §8 yayın geçmişine satır: tarih, P28c, commit, migration "yok", servis + istemci 0.17.0 SHA-256'ları, `check-app-grants` 873/873.

### 28c.10 Geri alma

- **Yalnız ikili geri alma** (migration ve veri yok): önceki `IMAGE_TAG` → `docker compose up -d`. Açık çok teknisyenli odalar sunucu
  yeniden başlarken düşer (tüm oturumlar gibi); yeniden bağlananlar tek teknisyenle sürer.
- Hızlı kapatma (ikili değiştirmeden): ilgili kullanıcılardan `sessions.invite` ve `sessions.supervise` kapatılır — üyeler ≤ 5 sn'de düşer,
  yeni davet/İzle yapılamaz.
- 0.17.0 servis/istemci eski sunucuyla tek teknisyen olarak çalışır (sunucu `rs.cap.multi1`'i yok sayar, roster göndermez) — **ikili geri
  alınmaz**. Geri almadan sonra staging'de bir Hızlı Destek + bir gözetimsiz oturum açılarak doğrulanır.
- Audit satırları (`session.invite*`, `participant_*`) kalır; eski sunucu okumaz ama audit ekranı eylem adını ham gösterir.
- Prod: P28 sonu (`v0.17.0`, §24.4 onay listesi "0.17.0 → P28c, migration yok" + Windows çoklu teknisyen elle turu + AC-371 ölçümü).

## 28d. P28d — sesli görüşme (N katılımcı), istemci 0.18.0 (devops K4, 2026-11-17; mimari-p28d r2 §4, §6, §7, §9, §11 K4, §14 O-PD-4; ADR-0036; AC-373..379)

Kapsam: teknisyen etkin oturumda "Sesli görüşme" ister, müşteri Kabul/Reddet (60 sn) eder; iki yönlü ses (WebRTC Opus, DTLS-SRTP; sunucu
sesi taşımaz/çözmez, hiçbir yerde kaydedilmez — AC-375). Çoklu teknisyende sahip/katılımcı kendi düğmesiyle konuşur, `sessions.voice`
yetkili izleyici yalnız dinler; müşteride mix-minus. Tarayıcı müşteri sayfası ve Windows istemci 0.18.0 (`rs.cap.voice1`) aynı akış.
**Gözetimsiz oturumda ses yoktur** (servis/yardımcı `voice1` bildirmez, ses modülü kurulmaz). **Yeni env değişkeni yok, migration yok,
yeni tablo yok** (`check-app-grants` değişmez), Caddy/nginx değişmez, yeni alarm yok. Sabitler `packages/contracts/src/ws-voice.ts`:
`VOICE_REQUEST_TIMEOUT_MS = 60000`, `VOICE_DENY_COOLDOWN_MS = 30000` (ret/müşteri bitirmesi sonrası bekleme), `VOICE_REQUESTS_PER_SESSION = 10`,
`VOICE_MAX_OPUS_BYTES = 1275`, `VOICE_MAX_PKT_PER_SEC = 100`. Değiştirmek kod değişikliği + yayın gerektirir.

Go istemcide kodlayıcı: **libopus 1.6.1 → WebAssembly** (`apps/agent-win/internal/voice/libopus.wasm`, `go:embed`), **wazero v1.12.0**
sandbox'ında koşar (WASI yok, içe aktarım 0, bellek ≤ 16 MiB). Tedarik zinciri ve güncelleme §28d.11.

### 28d.1 Yetki ve Permissions-Policy

| Anahtar          | Anlam                                                                          | Varsayılan              |
| ---------------- | ------------------------------------------------------------------------------ | ----------------------- |
| `sessions.voice` | Etkin oturumda müşteriyle sesli görüşme başlatır, katılır ve görüşmeyi dinler. | Admin açık, User kapalı |

- Rol varsayılanı çalışma anında uygulanır (`permissions.ts` `effectivePermissions`; toggle satırı yoksa ADMIN = açık): **yayınla birlikte
  tüm mevcut Admin'lerde açık olur**, User'larda kapalı. Firma istemiyorsa yayından sonra Kullanıcılar ekranından kapatılır.
- `sessions.voice`'u olmayan teknisyen (rol fark etmez) görüşmeyi **duymaz** (V-PD-6); izleyici yetkiliyse yalnız dinler, konuşamaz (AC-378).
- **Permissions-Policy (K-PD-1, D-PD-1):** HTML başlığını `apps/web/proxy.ts` `permissionsPolicyFor(pathname)` üretir: tüm sayfalarda
  `microphone=(self)`, yalnız `/r` ve alt yolları (herkese açık talep formu) `microphone=()`; `camera=()`, `geolocation=()` sabit. `/api` ve
  `/ws` (Fastify) `microphone=()` kalır. **Kural:** girişsiz/herkese açık yeni bir sayfa eklenirse `permissionsPolicyFor` içindeki `()`
  listesine eklenir; liste ve birim testi (`apps/web/lib/voice/voice-p28d.test.ts`) birlikte güncellenir. Doğrulama (§28d.9 adım 3):

```bash
curl -sI https://remote.noktabilisim.net/login | grep -i permissions-policy     # microphone=(self) ... camera=() geolocation=()
curl -sI https://remote.noktabilisim.net/r/x | grep -i permissions-policy       # microphone=()
```

### 28d.2 Audit (AC-379) ve sorgu

Audit süzgecinde "Sesli görüşme" grubu: `voice.request` (isteyen teknisyen), `voice.accept` (müşteri), `voice.reject`
(`reason`: `customer` / `timeout` / `disconnect`; result fail), `voice.join` (katılan teknisyen), `voice.end` (`durationSec`, `reason`,
`talkerIds`, `listenerIds`). `entity = support_sessions`, `entity_id = sessionId`. "Görüşmeyi kim dinledi" sorusu `voice.end.listenerIds`
ile yanıtlanır (KVKK hesap verebilirlik). Oturum geçmişi zaman çizelgesinde yalnız neden ve süre görünür, kimlikler görünmez. Kapı
reddi (403/409/429) audit'e yazılmaz, yalnız metrik (§28d.5). Ses içeriği ve aygıt adı hiçbir yere (audit, log, tanılama) yazılmaz.

`voice.end.reason` değerleri: `tech` (teknisyen bitirdi), `customer` (müşteri bitirdi ya da rıza kaydı yok), `device` (müşteri mikrofonu
açılamadı — Windows gizlilik ayarı / aygıt yok / aygıt çıkarıldı), `left` (konuşan son teknisyen ayrıldı/koptu), `disconnect` (müşteri
WS'si koptu — anında, pay yok), `session_ended`, `timeout`.

### 28d.3 "Ses gelmiyor" teşhisi

| Belirti                                                      | Neden / eylem                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Sesli görüşme" düğmesi yok                                  | Teknisyende `sessions.voice` kapalı (§28d.1)                                                                                                                                                                                                                   |
| Düğme pasif, "istemci desteklemiyor" (AC-352 metni)          | Müşteri 0.17.x ve öncesi (`rs.cap.voice1` yok). Hızlı Destek 0.18.0 yeniden indirilir                                                                                                                                                                          |
| Düğme pasif, "Gözetimsiz oturumda sesli görüşme yapılamaz"   | Tasarım gereği (V45, ADR-0036 m.7)                                                                                                                                                                                                                             |
| "Mikrofon izni verilmedi" (konsol)                           | Teknisyen tarayıcısı mikrofonu engelledi: adres çubuğu kilit simgesi → Mikrofon → İzin ver. Sayfa `/r/*` değilse `microphone=(self)` olmalı (§28d.1 curl)                                                                                                      |
| "30 sn sonra tekrar deneyebilirsiniz" / "isteği sınırına..." | Müşteri reddetti ya da bitirdi (30 sn bekleme) ya da oturumda 10 istek doldu (yeni oturum açılır)                                                                                                                                                              |
| Görüşme hemen `device` ile bitiyor (Windows müşteri)         | Ayarlar → Gizlilik ve güvenlik → Mikrofon: "Mikrofon erişimi" ve "Masaüstü uygulamalarının mikrofonunuza erişmesine izin ver" **açık** olmalı; Ses ayarlarında varsayılan kayıt aygıtı var ve devre dışı değil. Aygıt seçimi yok — varsayılan aygıt kullanılır |
| Görüşme açık, ses yok / kesik                                | Konsol kalite paneli "Ses kaybı %x" satırı (`AudioLines`): yüksekse ağ. Aday türü `relay` ise TURN UDP 3478 erişimi; UDP kapalı ağda TCP/TLS yedeği (§9) — TCP üstünde gecikme ve kayıp artar. Müşteride "Sessize al" açık mı (gösterge "Sessizde")            |
| İzleyici duymuyor                                            | İzleyicide `sessions.voice` yok ("dinleme yetkiniz yok") ya da tarayıcı otomatik oynatmayı engelledi → "Sesi aç" düğmesi                                                                                                                                       |
| Yankı / çınlama                                              | Windows'ta yankı giderme yok (Sonra): müşteriye kulaklık önerilir (diyalogdaki satır). Tarayıcı müşteride Chrome yankı gidermesi açık                                                                                                                          |
| Ağ kesintisinden sonra görüşme bitti                         | Tasarım gereği (V-PD-7): yeniden bağlanma yeni istek + yeni kabul ister                                                                                                                                                                                        |

### 28d.4 Gizlilik kuralları (operatörün bilmesi gereken)

- Müşteri mikrofonu yalnız o görüşme için yerel "Kabul et" tıklamasından sonra açılır (K-PD-2); WS kopunca ≤ 1 sn içinde kapanır.
- Müşteri görüşme çubuğunda konuşanları ve dinleyenleri adıyla görür; yeni dinleyici belirgin bildirimle duyurulur.
- Oturum kaydı (P28e) açıkken kayda **ses girmez** (AC-375; kayıtta ses izi 0).

### 28d.5 Metrikler (`/metrics`, Bearer `METRICS_TOKEN`; tenant etiketi yok)

| Metrik                                                      | Tür      | Anlam                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rs_voice_calls_total{result: accepted, rejected, timeout}` | sayaç    | İstek sonuçları (`rejected` = müşteri reddi; pending'de kopma sayılmaz). `timeout` oranı yüksekse müşteriler diyaloğu görmüyor olabilir (elle bakış)                                                                                                           |
| `rs_voice_active`                                           | gösterge | Anlık etkin görüşme sayısı. Yayın/yeniden başlatma öncesi bakılır (yeniden başlatma görüşmeleri düşürür)                                                                                                                                                       |
| `rs_voice_denied_total{code}`                               | sayaç    | Sunucu kapısı reddi: `permission`, `not_talker`, `conflict`, `unattended`, `no_guest`, `client_unsupported`, `cooldown`, `limit`, `stale_call`. İzleyicinin `voice.*` reddi P28c rol kapısında: `rs_multi_denied_total{type="voice.join"}` vb. (§28c.6 alarmı) |

```bash
docker compose exec -T server node -e "fetch('http://127.0.0.1:3001/metrics',{headers:{authorization:'Bearer '+process.env.METRICS_TOKEN}}).then(r=>r.text()).then(t=>console.log(t.split('\n').filter(l=>/^rs_voice_/.test(l)).join('\n')))"
```

`permission`/`unattended`/`client_unsupported` normalde 0'a yakındır (arayüz düğmeyi göstermez/pasif yapar); artış = elle WS mesajı ya da
web/sunucu sürüm uyuşmazlığı → server logu + audit'ten kullanıcı.

### 28d.6 Alarm

**Yeni alarm yok** (mimari-p28d §11 K4). `deploy/ops/remote-watch.sh` değişmedi: `rs_voice_*` adlarını okumaz (2026-11-17 denetlendi);
rol yükseltme denemesi mevcut `multi-denied` alarmına (§28c.6) düşer. `remote-watch install` gerekmez.

### 28d.7 Windows elle turu (Windows 10 + 11; CI'da koşamayanlar)

CI (`agent-win.yml` → `test-windows`): "P28d ses testleri (-v; wazero + libopus.wasm)" adımı adında `P28d`/`Voice`/`Opus` geçen Go
testlerini koşar; listedekiler (K0s internal/voice + K3 flow/voice/rtc/ui/tray/yardımcı sınırı, 85 test) **zorunlu PASS**, SKIP kırmızı. `libopus-wasm` işi gömülü wasm'ı yeniden üretip
karşılaştırır (§28d.11). Elle (staging adresli 0.18.0, §28d.9; teknisyen A sahip, B, C aynı firmada, 2FA kurulu, `sessions.voice` A ve B'de,
C'de bir turda açık bir turda kapalı, `sessions.supervise` C'de; gerçek mikrofon + kulaklık; sonuç `docs/test-raporu.md`'ye, Windows
sürümüyle). Tüm turlar hem **Hızlı Destek 0.18.0** hem **tarayıcı müşteri sayfası** ile yapılır (AC-377):

1. **Mikrofon gizlilik ayarı (V-PD-1):** Ayarlar → Gizlilik → Mikrofon → "Masaüstü uygulamalarının erişmesine izin ver" **kapalı** → A istek,
   müşteri Kabul → müşteri penceresinde yol tarif eden metin, görüşme `voice.end{device}` ile biter, konsolda bitiş bildirimi; çökme yok.
   Aynısı "Mikrofon erişimi" tümden kapalıyken ve hiç kayıt aygıtı yokken (aygıt devre dışı). Ayarı açınca 30 sn sonra yeni istek çalışır.
2. **Kabul/Reddet (AC-373, AC-116):** diyalog "<A> sesli görüşme istiyor"; odak "Reddet"te; "Kabul et" 1,5 sn sonra etkin; diyalog imlecin
   altında açılmaz; kulaklık önerisi satırı var. Reddet → konsolda "Müşteri sesli görüşmeyi reddetti", 30 sn bekleme metni. 60 sn yanıtsız →
   "Müşteri yanıt vermedi", audit `voice.reject{timeout}`. Diyalog açıkken mikrofon göstergesi **yanmaz** (kabulden önce mikrofon açılmaz).
3. **OS mikrofon göstergesi (AC-374):** kabulden sonra görev çubuğunda mikrofon simgesi yanar (Win11: bildirim alanı; Win10: bildirim alanı
   mikrofon simgesi); "Ayarlar → Gizlilik → Mikrofon" son erişimde `NoktaDestek.exe` görünür. Bitirme yolları: (a) teknisyen "Görüşmeyi
   bitir", (b) müşteri "Görüşmeyi bitir", (c) tepsi menüsü "Görüşmeyi bitir", (d) müşteri ağını kes (Wi-Fi kapat), (e) oturumu bitir. Her
   birinde simge **≤ 1 sn** içinde söner — telefonla 60 fps video çekilip kare sayılarak ölçülür (tıklama karesi → simgenin kaybolduğu kare).
   "Sessize al" iken simge **yanık kalır** (aygıt açık, V-PD-4), tepsi ipucu "Sessizde".
4. **Tepsi göstergesi (O-PD-3):** mikrofon açıkken tepsi simgesi ipucu "Mikrofon açık"/"Sessizde", menüde "Görüşmeyi bitir"; pencere
   küçültülünce de görünür, gizlenemez.
5. **Kulaklık:** kulaklık (3,5 mm ve USB/Bluetooth) varsayılan aygıtken iki yönlü ses net, yankı yok. Hoparlörle yankı olabileceği not edilir.
   Görüşme sürerken USB kulaklığı çıkar → beklenen: görüşme `device` ile biter (aygıt geçersiz) ya da sürer; gözlenen davranış rapora
   yazılır; donma/çökme yok ve mikrofon göstergesi bitişte söner.
6. **Çoklu teknisyen, 3 bağlam (AC-378):** A istek → kabul → B "Görüşmeye katıl" → müşteride "Konuşan: A, B"; C (İzle, `sessions.voice`
   açık) → konsolda "Dinleniyor", konuşma düğmesi yok; müşteride "Dinleyen: C" + belirgin bildirim "C görüşmeyi dinlemeye başladı" (Go:
   çubuk satırı + tepsi balonu). Mix-minus: A, B'yi ve müşteriyi duyar, kendi sesini geri duymaz; C herkesi duyar. C'nin DevTools'tan
   gönderdiği `voice.join` reddedilir (`rs_multi_denied_total{type="voice.join"}` artar). C'de `sessions.voice` **kapalı** turu: C hiçbir şey
   duymaz, "dinleme yetkiniz yok"; müşteride "Dinleyen" satırında C yok. Görüşme sürerken B'nin `sessions.voice`'u kapatılır → B ≤ 5 sn'de
   konuşanlardan düşer. Kontrol devri (A → B) konuşanları değiştirmez. A ve B ayrılınca görüşme `left` ile biter.
7. **Gözetimsizde ses yok (V45, O-PD-3):** servis 0.18.0 gözetimsiz oturumda konsolda "Gözetimsiz oturumda sesli görüşme yapılamaz" (pasif);
   cihazda mikrofon göstergesi **hiç** yanmaz; DevTools'tan `voice.request` → `CLIENT_UNSUPPORTED` (`rs_voice_denied_total{code="unattended"}`).
8. **Eski istemci:** Hızlı Destek 0.17.0 ile düğme pasif + AC-352 metni (AC-379).
9. **Kayıt (AC-375):** görüşme sürerken P28e kaydı → indirilen kayıt sessiz (ses izi yok).
10. **İz:** görüşme sonrası `trace-check.ps1 -Mode Compare` temiz; `tanilama.log`'da aygıt adı yok. Tepsi "Lisanslar" libopus (BSD-3) ve
    wazero (Apache-2.0) bildirimlerini gösterir (O-PD-4).
11. %150 DPI ve koyu/açık tema: diyalog ve görüşme çubuğu taşmıyor.
12. **Uzaktan kabul reddi (K-PD-2):** kontrol izni verilmişken teknisyen kendi imleciyle (SendInput) "Kabul et"e tıklar → kabul **olmaz**,
    diyaloğa kırmızı enjekte tıklama uyarısı eklenir, kilit 1,5 sn yeniden başlar; Enter/Space "Kabul et"i tetiklemez. Aynı şekilde
    teknisyenin "Mikrofonu aç" tıklaması sessizden çıkarmaz ("Sessize al" ve "Görüşmeyi bitir" uzaktan da çalışır — güvenli yön).
13. **Gösterge şeridi (O-PD-3):** her monitörde üst-ortada (kayıt şeridinin altında) "● Mikrofon açık"/"● Sessizde"; oturum penceresi
    küçültülünce ve tepsisiz (normal açılış) kipte de görünür; teknisyen görüntüsünde görünmez (yakalamadan hariç); kayıtla birlikte
    iki şerit üst üste binmez. Tepsiden "Çık" (onay) → oturum biter, mikrofon simgesi ≤ 1 sn söner.
14. **768 px ekran:** yükseltilmiş + sunucu üzerinden dosya + 3 teknisyen + kayıt + görüşme açıkken oturum penceresi ekrana sığar
    (sohbet geçmişi kısalır); ses satırında iki satırlık "Konuşan/Dinleyen" metni okunur.
15. **Aygıt hata sınıfları (K3b):** gizlilik anahtarı kapalı → `ErrDeviceDenied` (0x80070005); mikrofonsuz makine → `ErrDeviceNotFound`
    (0x80070490); görüşmede USB kulaklık çıkar → `ErrDeviceLost` (0x88890004); hoparlör başka aygıttayken yalnız USB mikrofonu çıkar →
    ≤ 1–2 sn içinde aygıt bitişi (durmuş akış denetimi). Hepsinde sohbete V-PD-1 yol tarifi "Sistem" satırı, konsolda `device` bitişi.
16. **Ses kalitesi (K3b):** sürücüde iletişim kategorisiyle OEM AEC etkin mi; çalma gecikmesi kulaktan; 10 dk görüşmede saat kayması
    (çalma kuyruğu 200 ms'de kırpılıyor mu, çıtırtı); Chrome'un gönderdiği Opus iki yönlü çözülüyor.
17. **SSE4.1'siz işlemci (A-PD-6):** `voice.Supported()` false olan makinede (ya da VM'de SSE4.1 maskeli) `rs.cap.voice1` bildirilmez →
    konsolda AC-352 pasif metni; istemci çökmez.
18. **Lisanslar:** tepsi menüsü "Lisanslar" (oturum dışında da) salt okunur pencere açar, ağ isteği yok; libopus COPYING, wazero NOTICE +
    Apache-2.0, wasi-libc/musl/cloudlibc, compiler-rt metinleri kaydırılarak okunur; ikinci tıklamada aynı pencere öne gelir.

### 28d.8 AC-376 elle gecikme ölçümü (staging; test-operatoru + kullanıcı Windows) — DENENMEDİ, ilk koşuda doğrulanır

Hedef: RTT < 150 ms ağda ağızdan kulağa gecikme **p95 < 400 ms**. Otomatik e2e (aynı makine, p95 < 325 ms) bunu kısmen kanıtlar; gerçek
aygıt + ağ ölçümü elledir.

**Ortam:** teknisyen dizüstü (Chrome konsol) ve müşteri Windows (Hızlı Destek 0.18.0; ikinci turda tarayıcı müşteri) **aynı odada**,
1–2 m arayla; ikisi de staging'e internetten bağlı (aynı LAN'da doğrudan `host` adayı seçilirse ölçüm iyimser olur — mümkünse müşteri
telefon hotspot'unda). Konsol kalite panelinde **RTT < 150 ms** doğrulanır ve yazılır (aday türü de). Tek telefon, iki cihazın arasında,
ses kaydı uygulaması (48 kHz, sıkıştırmasız/WAV tercih).

**Geri besleme döngüsünü kır (zorunlu):** ölçülen yönde alıcı hoparlörden çalar, karşı tarafın mikrofonu **sessizde** olmalı ya da
kulaklık kullanılmalı; aksi hâlde hoparlör sesi geri dönüp kaydı bozar.

1. **Teknisyen → müşteri yönü:** teknisyen kulaklık takar (konsol çıkışı kulaklıkta), müşteri hoparlörü açık, müşteri "Sessize al".
   Teknisyen mikrofonunun yanında **20 alkış**, aralarında ≥ 2 sn. Telefon hem doğrudan alkışı hem müşteri hoparlöründen gelen alkışı kaydeder.
2. **Müşteri → teknisyen yönü:** roller ters (müşteri kulaklık, teknisyen hoparlörü açık, konsol "Sessize al"); yine 20 alkış.
3. Audacity'de kayıt açılır; her alkış için doğrudan darbenin başlangıcı ile hoparlörden gelen darbenin başlangıcı arası (dalga formunda
   seçim → "Seçim uzunluğu", ms) okunur. Akustik yol (≤ 2 m ≈ 6 ms) ihmal edilir.
4. 20 değer sıralanır; **p95 = 19. değer** (en yakın sıra, ⌈0,95·20⌉). Her yön için ayrı: **p95 < 400 ms** → GEÇTİ.
5. Kayıt dosyası ölçümden sonra silinir (yalnız alkış olsa da kişisel ses içerebilir); rapora yalnız sayılar girer.

**Kayıt** (`docs/test-raporu.md`, AC-376): tarih, Windows sürümü, müşteri türü (Go/tarayıcı), ağ (hotspot/LAN), RTT, aday türü, yön
başına 20 değer, medyan, p95, ses kaybı %. Başarısızlıkta jitter tamponu (Go 60 ms hedef) ve aday türü mimara bildirilir.

### 28d.9 Staging yayını (koordinatör uygular; sıra bağlayıcı)

Ön koşul: P28d qa GEÇTİ + güvenlik Kritik/Yüksek 0; `ci` (test-watch, shellcheck, actionlint dahil) ve `agent-win` (P28d adımı +
`libopus-wasm` işi dahil) yeşil. Staging tek yığın `/opt/remote/deploy`.

1. **Sunucu önce** (0.18.0 istemci eski sunucuda sessiz çalışır — sunucu bilinmeyen `rs.cap.voice1`'i yok sayar, `voice.*` göndermez;
   sunucu önce gelirse ses yolu hazır olur). Önce `rs_voice_active` yok (eski sunucu). §25.2 akışı — ön yedek → `git pull` → `IMAGE_TAG` →
   `docker compose build && docker compose up -d`. **Migration yok:** `docker compose logs --since 5m migrate` → "No pending migrations".
   `check-app-grants.sh` **değişmez**: P28c ile aynı (**873/873 PASS**, tetikleyici 23); sayı değiştiyse dur, db-notlari'na bak.
   `systemctl start remote-backup.service` → `audit-continuity ok`.
2. Caddy / host nginx **değişmedi** (yeni yol yok; Permissions-Policy uygulamadan gelir) — yeniden yaratma gerekmez.
3. Doğrulama: §28d.1 iki `curl` (login `microphone=(self)`, `/r/x` `microphone=()`); §28d.5 komutu → `rs_voice_active 0` ve iki sayaç
   kayıtlı. `remote-watch` değişmedi (`install` gerekmez); `journalctl -u remote-watch -n 5` → `OK`.
4. **Servis + istemci 0.18.0:** önce gömülü wasm tutarlılığı `(cd apps/agent-win/internal/voice && shasum -a 256 -c libopus.wasm.sha256)`
   → `libopus.wasm: OK`. Sonra §28u.9 adım 3 komutu, yalnız `VER=0.18.0` (temiz ağaç; ikinci koşuyla SHA tekrarlanabilirliği; wasm
   yeniden üretilmez, repo'daki gömülür — üretimini CI `libopus-wasm` işi doğrular). Servis (ses içermez ama sürüm hizası; gözetimsizde
   `voice1` bildirmez):
   `ALLOW_UNATTESTED=staging deploy/agent/publish-servis.sh --dir "$OUT/servis" --no-attestation --ssh root@185.126.217.99 --deploy-dir /opt/remote/deploy`
   → `kontrol: server UNATTENDED_AGENT_PATH SHA-256 = UNATTENDED_AGENT_SHA256 = <sha>`.
5. **İstemci exe (S13C-13):** tek yığın staging `--dir` yayınını reddeder → `$OUT/istemci/NoktaDestek.exe` test için **doğrudan teslim**
   (0.18.0'da istemci yeniliği: `rs.cap.voice1`, Kabul/Reddet diyaloğu, görüşme çubuğu, tepsi mikrofon göstergesi, WASAPI + Opus).
   İkili ≈ 2,5 MiB büyür (wazero + wasm; AC-96 40 MB sınırının çok altında). `/downloads/NoktaDestek.exe` P28 sonu `v0.18.0` Release ile
   güncellenir (§24.4).
6. `MIN_AGENT_VERSION` **yükseltilmez** (eski istemcide ses düğmesi yalnız pasif). Staging test VM'lerinde servis "Güncelle…" (§28u.5) →
   Windows elle turu (§28d.7) ve AC-376 ölçümü (§28d.8) test-operatoru.
7. §8 yayın geçmişine satır: tarih, P28d, commit, migration "yok", servis + istemci 0.18.0 SHA-256'ları, libopus.wasm SHA-256
   (`715ac5d3…62e2` değiştiyse yeni değer), `check-app-grants` 873/873.

### 28d.10 Geri alma

- **Yalnız ikili geri alma** (migration ve veri yok): önceki `IMAGE_TAG` → `docker compose up -d`. Önce §28d.5 `rs_voice_active`'e bakılır;
  sunucu yeniden başlarken açık görüşmeler oturumlarla birlikte düşer (müşteri mikrofonu WS kopuşuyla ≤ 1 sn'de kapanır).
- Eski sunucu/konsol `voice1`'i yok sayar; 0.18.0 istemci eski sunucuyla sessiz çalışır — **istemci ikilisi geri alınmaz**. Geri almadan
  sonra staging'de bir Hızlı Destek + bir tarayıcı oturumu açılıp ses düğmesinin olmadığı/pasif olduğu doğrulanır.
- Hızlı kapatma (ikili değiştirmeden): ilgili kullanıcılardan `sessions.voice` kapatılır — konuşan/dinleyen tid'ler anında düşer, yeni
  istek yapılamaz (Admin'lerde de elle kapatılır; varsayılan açık).
- Kodlayıcıda güvenlik açığı (libopus/wazero) ve düzeltilmiş sürüm henüz yoksa: sunucuda `sessions.voice` tüm kullanıcılarda kapatılır
  (müşteri istemcisine `voice.*` gitmez, çözücü hiç çalışmaz), ardından §28d.11 güncellemesiyle yeni istemci sürümü.
- Audit satırları (`voice.*`) kalır; eski sunucu okumaz ama audit ekranı eylem adını ham gösterir.
- Prod: P28 sonu (`v0.18.0`, §24.4 onay listesi "0.18.0 → P28d, migration yok" + Windows ses elle turu + AC-376 ölçümü).

### 28d.11 Tedarik zinciri: libopus.wasm ve wazero (O-PD-4)

**Ne nerede sabit:** libopus **1.6.1** Xiph tarball'ı SHA-256 `6ffcb593…72411a1` (betik `apps/agent-win/build/libopus-wasm.sh`
`OPUS_SHA256` + `agent-win.yml` `libopus-wasm` işi `OPUS_SHA256_PINNED` — ikisi aynı olmalı); araç zinciri wasi-sdk 34 imajı digest'le
(`WASI_SDK_IMAGE`); çıktı `internal/voice/libopus.wasm` (`715ac5d3911a76bf526267786f469fe2760fdc78a32ad736751bfa41bf7562e2`) +
`.sha256` + `libopus-COPYING.txt`. wazero **v1.12.0** `go.mod`/`go.sum` (Dependabot ayrı PR). CI `libopus-wasm` işi her PR'da wasm'ı
yeniden üretip bayt bayt karşılaştırır ve Release `approve` kapısının ön koşuludur. Yerel yeniden üretim (Docker gerekir; ≈ 1 dk, 2026-11-17
Apple Silicon'da `linux/amd64` ile denendi, çıktı repo'yla aynı):

```bash
cd apps/agent-win && OUT="$(mktemp -d)" && sh build/libopus-wasm.sh "$OUT" \
  && for f in libopus.wasm libopus.wasm.sha256 libopus-COPYING.txt; do cmp "$OUT/$f" "internal/voice/$f"; done && echo AYNI
```

(Çıktı dizini her zaman verilir; argümansız koşu `internal/voice`'un üzerine yazar.)

**İzleme (aylık + duyuruda; sorumlu: devops):**

- **libopus güvenlik duyuruları:** libopus wasm içinde olduğundan **govulncheck ve Dependabot görmez**; elle eşlenir. Kaynaklar:
  https://opus-codec.org/release/ (sürüm notları), https://gitlab.xiph.org/xiph/opus/-/releases, NVD'de `libopus` /
  `cpe:2.3:a:opus-codec:opus` araması, oss-security listesi. 1.6.1'i etkileyen bir CVE'de: (1) çözücü yolunda mı (`opus_decode`,
  SILK/CELT çözücü) — uzaktan gelen paket yalnız çözücüye ulaşır, kodlayıcı yalnız yerel mikrofonu işler; (2) etki wazero sandbox'ıyla
  sınırlı (doğrusal bellek dışına çıkamaz; tuzak → `ErrCodecPanic`, 3'te eş susar) ama ses içeriği bozulması/DoS mümkündür; (3) Yüksek ve
  üstüyse §28d.10 "hızlı kapatma" + aşağıdaki güncelleme.
- **wazero sürümleri:** https://github.com/tetratelabs/wazero/releases ve GitHub güvenlik tavsiyeleri (Go vuln DB'ye de girer →
  `check` işindeki govulncheck yakalar). Dependabot haftalık **ayrı PR** açar (`go-minor-patch` grubundan hariç); otomatik birleştirme yok.
- **wasi-sdk:** yalnız derleme aracıdır (ikiliye wasi-libc/compiler-rt parçaları girer); yeni sürüm zorunlu değil, libopus güncellemesinde
  birlikte değerlendirilir.

**libopus güncelleme (yeni sürüm ya da güvenlik düzeltmesi):** tek PR'da (1) `libopus-wasm.sh` `OPUS_VERSION` + `OPUS_SHA256` (değer
Xiph `https://downloads.xiph.org/releases/opus/SHA256SUMS.txt`'ten; HTTPS + sürüm notuyla karşılaştırılır), (2) `agent-win.yml`
`OPUS_SHA256_PINNED` aynı değer, (3) `sh build/libopus-wasm.sh` (argümansız → `internal/voice`) ile wasm + `.sha256` + COPYING yeniden
üretilir ve commit edilir, (4) Go testleri (`TestP28dK0sWasmDigestMatches`, `WasmSandboxSurface` — içe aktarım 0) yeşil, (5) aşağıdaki
"wazero güncelleme" doğrulama adımları, (6) yeni istemci yama sürümü (ör. 0.18.1) staging (§28d.9) → Release.

**wazero güncelleme (Dependabot PR'ı; clamav kalıbı — adımlar koşulmadan birleştirilmez):** PR dalında
(1) CI `check` (-race, govulncheck, go-licenses: Apache-2.0) ve `test-windows` P28d adımı yeşil; (2) `TestP28dK0sCompilerMatchesInterpreter`
amd64'te PASS (derleyici = yorumlayıcı); (3) `go test -fuzz=FuzzDecode -fuzztime=30m ./internal/voice/` **linux/amd64** (Go imajı,
`--platform linux/amd64`) ≥ 30 dk, 0 tuzak (`NOKTA_K0S_TRAPLOG` dosyası boş), 0 panik, crasher yok; (4) arm64 JIT bulgusu (K0s-2: v1.9–v1.12
derleyicisi kodlayıcıyı yanlış derliyor) yeni sürümde yeniden denenir, sonuç `docs/implementation.md`'ye; düzelmişse bile yayın hedefi
amd64 kalır; (5) ikili büyümesi kaydedilir. Sonuç PR açıklamasına yazılır, ardından el ile birleştirilir.

## 28f. P28f — macOS istemcisi: CI, paket, imza, yayın (devops K8a/K8b, 2026-11-17; mimari-p28f §8, §10 K8a/K8b, §13 S-P28f-3..7/14/17, §14; ADR-0037 r3)

Özet: ince ikililer (arm64, amd64) Linux GO_IMAGE'da CGO'suz çapraz derlenir; universal `.app`, imza ve zip **yalnız macOS'ta**
(`apps/agent-win/build/macos/package.sh`). Entitlement listesi **boş** (ses yok, r3). Hardened runtime staging'de de açıktır.
Bundle kimliği staging'de `net.noktabilisim.destek.stg`, prod'da `net.noktabilisim.destek`. ~~Apple hesabı yoksa (R39) prod'da
macOS yoktur~~ — **r4 ile değişti (2026-11-20, kullanıcı kararı; mimari-p28f §15):** `vars.APPLE_TEAM_ID` tanımsızken prod'a **ad-hoc
imzalı** macOS zip'i çıkar (Release + `macos-adhoc/v1` attestation; müşteri Gatekeeper "Yine de Aç" onayı verir). Developer ID yolu
(`APPLE_TEAM_ID` tanımlı) aynen durur. Ad-hoc prod akışı ve yayın sırası: §28f.9.

### 28f.1 Dosyalar

| Yer                                                        | İş                                                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `apps/agent-win/build/macos/package.sh`                    | `bundle` / `sign` / `zip` / `check` / `adhoc` / `compare` (kullanım başlıkta)                                      |
| `build/macos/Info.plist.tmpl` + `info-plist-keys.txt`      | Info.plist; anahtar kümesi izin listesiyle **tam** eşleşmeli (S-P28f-14)                                           |
| `build/macos/entitlements.plist`                           | boş `<dict/>`; ad-hoc ve Developer ID aynı dosya (S-P28f-4/5)                                                      |
| `build/macos/OKUBENI.txt`, `OKUBENI-stg.txt`               | zip'teki ikinci üst öğe (prod: "asla Yine de Aç istemez"; stg: TEST metni)                                         |
| `apps/agent-win/test/trace-check-mac.sh` (K5)              | AC-394 iz testi (`snapshot` / `compare`, salt okunur); CI test-macos çağırır                                       |
| `deploy/agent/publish-mac.sh` + `test-publish-mac-lock.sh` | yayın / geri alma; kilit testi                                                                                     |
| `.github/workflows/agent-win.yml`                          | `check` darwin, `build-mac` ×2, `reproducible-mac`, `package-mac`, `test-macos`, `sign-mac`, `attest-mac`, release |
| `.github/workflows/agent-watch.yml`                        | `hash-mac` (macOS zip = Release, yayımlandıysa)                                                                    |

Simge her paketlemede `internal/ui/uicore/assets/nokta-kucuk.png`'den üretilir (şeffaf kenarla kare, `sips` + `iconutil`); repoda
`.icns` ikilisi yok.

### 28f.2 CI akışı (`agent-win.yml`)

| İş                       | Ne yapar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Etikette                                                                                                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check`                  | `GOOS=darwin` vet + staticcheck (arm64, amd64), govulncheck (iki mimari), go-licenses (darwin/arm64)                                                                                                                                                                                                                                                                                                                                                                                                                                     | aynı                                                                                                                                                                                                                       |
| `build-mac` 1/2, 2/2     | `build-darwin.sh` iki mimari. Adres: PR / main push / yer tutucu dispatch → `.invalid` + `test`; main dispatch staging → `STG_SERVER_URL` + `test`; `v*` etiket → `AGENT_SERVER_URL`, kipsiz (prod). main push'a prod adresi **gömülmez**. Etikette `vars.APPLE_TEAM_ID` doluysa `EXPECTED_TEAM_ID` ile beklenen Team ID gömülür (D-P28f-K3; `build-meta.txt` 4. satır)                                                                                                                                                                  | prod                                                                                                                                                                                                                       |
| `reproducible-mac`       | iki derleme SHA eşit (mimari başına), Mach-O 64, ≤ 30 MiB/dilim; artifact `agent-mac-thin`; çıktılar `sha_arm64/sha_amd64`                                                                                                                                                                                                                                                                                                                                                                                                               | aynı                                                                                                                                                                                                                       |
| `package-mac` (macos-15) | girdi SHA = reproducible-mac **çıktısı**; `package.sh adhoc` (lipo, bundle, ad-hoc + runtime, Info.plist/entitlement/dilim/runtime denetimi, sabit mtime, zip ≤ 60 MiB). Artifact `agent-mac` (PR/main) ya da `agent-mac-stg` (dispatch): zip + `SHA256SUMS` + `icerik-sha256.txt` (paket içi ikili + imzasız dilimler) + `build-meta.txt`. Zip içi `OKUBENI.txt` = stg: `OKUBENI-stg.txt`, prod: `OKUBENI-adhoc.txt` (`cmp`, AC-505). Çıktılar `zip_sha`, `exe_sha`                                                                     | r4: `signing=notarized` → yalnız denetler, yüklemez; `signing=adhoc` → `agent-mac-adhoc` (zip + SHA256SUMS + icerik + build-meta + `adhoc.json`, retention 7; attestation'sız) + özette imza dalı/zip SHA (onaylayan için) |
| `test-macos` (macos-15)  | `go test -v ./...` (`MallocScribble=1`, `NSZombieEnabled=YES`); her `--- SKIP` `::warning::` + step summary "SKIP listesi"; izin gerektirmeyen zorunlu testler ad listesiyle PASS denetlenir (§28f.8); Rosetta varsa `GOARCH=amd64 go test ./internal/darwin/...` (yoksa uyarı); iz testi: `.invalid` + testBuild'siz ayrı derleme, prod profili ad-hoc paket, `Destek-12345678/` klasörüne açılır → `trace-check-mac.sh snapshot` → ikili argümansız açılır, 15 sn sonra SIGTERM → `compare --since --bundle --marker 12345678`         | aynı                                                                                                                                                                                                                       |
| `approve`                | mevcut `agent-release` onayı; artık mac işleri de yeşil olmalı. Kontrol listesi macOS maddesi (r4): package-mac özetindeki imza dalı + zip SHA; ad-hoc ise E-listesi (mimari-p28f §15.7) macOS 14 + 15'te GEÇTİ mi                                                                                                                                                                                                                                                                                                                       | —                                                                                                                                                                                                                          |
| `sign-mac`               | yalnız etiket + onay + `vars.APPLE_TEAM_ID` doluysa; yoksa **skipped** (r4: ad-hoc dal)                                                                                                                                                                                                                                                                                                                                                                                                                                                  | §28f.3                                                                                                                                                                                                                     |
| `attest-mac`             | etiket: yalnız **approve başarılıysa** ve dal `reproducible-mac.signing`'e göre (r4, S-r4-3/4). notarized: sign-mac başarılı → provenance + `macos-notarized/v1` (`notarization.json`). adhoc: package-mac başarılı → zip SHA = `package-mac.zip_sha`, zip içi ikili = `exe_sha`, predicate iş çıktılarından kurulur (`adhoc.json` ile birebir) → provenance + `macos-adhoc/v1` (`bundleId, version, file, signature:"adhoc", notarized:false, executableSha256`). vars ile uyuşmazlık = hata. Etiket dışı: TEST zip'e yalnız provenance | —                                                                                                                                                                                                                          |
| `release`                | sign-mac `failure` ise Release yok. r4: attest-mac **success zorunlu** ("macOS bu sürümde YOK" dalı yok); artifact `attest-mac.outputs.artifact` ∈ {`agent-mac-signed`, `agent-mac-adhoc`}, dal + `APPLE_TEAM_ID` tutarlı olmalı. `NoktaDestek-macOS-<sürüm>.zip` eklenir; `SHA256SUMS`'a zip satırı + `Nokta Destek.app/Contents/MacOS/noktadestek` satırı (doğrulama `sha256sum -c --ignore-missing`); notta imzasız dilim SHA'ları                                                                                                    | —                                                                                                                                                                                                                          |

Yerelde doğrulama (2026-11-17, Apple Silicon, macOS 26.3): `package.sh adhoc` iki farklı dizinde → zip SHA **eşit** (9,2 MiB);
`codesign -dv` → `flags=0x10002(adhoc,runtime)`, `Identifier=net.noktabilisim.destek.stg`, universal x86_64 + arm64; test-macos iz dizisi (snapshot → aç → kapat → compare) yerelde "SONUÇ: temiz"; paket içi ikili
arm64 ve `arch -x86_64` ile açıldı (K1 beklenen çıkış 4). Negatif denetimler FAIL verdi: spike entitlement'larıyla imza, Info.plist'e
`CFBundleURLTypes`, runtime'sız imza, stg paketi prod profiliyle. actionlint 1.7.8 + shellcheck 0.11.0 (CI imajları) temiz.
**macOS runner işleri (package-mac, test-macos, sign-mac) ilk gerçek CI koşusunda doğrulanır**; sign-mac hiç koşmadı (Apple hesabı yok).

### 28f.3 İmza kurulumu (Apple Developer hesabı açılınca; kullanıcı + devops)

1. Apple Developer Program (kuruluş, D-U-N-S). Sertifika: **Developer ID Application** (Certificates → +). Anahtar CSR ile bu Mac'te
   üretilir; Anahtar Zinciri'nden `.p12` dışa aktarılır (güçlü parola). `base64 -i imza.p12 | pbcopy`.
2. App Store Connect → Users and Access → Integrations → **Team Keys** → yeni anahtar, rol **Developer** (Admin değil; S-P28f-6).
   `.p8` bir kez indirilebilir; Key ID ve Issuer ID not edilir.
3. GitHub → Settings → Environments → **`agent-mac-sign`**: Deployment branches and tags = Selected → yalnız **Tag `v*`** kuralı
   (dal kuralı yok); **Required reviewers** = en az bir kişi, "Prevent self-review" açık. Environment secrets:
   `APPLE_DEVELOPER_ID_P12_BASE64`, `APPLE_DEVELOPER_ID_P12_PASSWORD`, `APPLE_NOTARY_KEY_P8` (dosya içeriği aynen),
   `APPLE_NOTARY_KEY_ID`, `APPLE_NOTARY_ISSUER_ID`. Bunlar **repo secret'ı yapılmaz** (dal push'undaki değiştirilmiş iş akışı okuyabilir).
4. Etiket ruleset'i (§24.3 m.1 ile aynı): `refs/tags/v*` oluşturma/silme yalnız yöneticiler.
5. **En son** repo değişkeni `APPLE_TEAM_ID` (10 karakter). Tanımlandığı an sign-mac etkinleşir ve Release macOS zip'i zorunlu olur.
6. Doğrulama: bir sonraki etikette sign-mac üstünde "agent-mac-sign" ortamı + onay bekler. Dalda `environment: agent-mac-sign`
   deneyen iş "not allowed to deploy" ile durmalı.

sign-mac adımları: girdi SHA'ları reproducible-mac çıktısı + build-meta adres/sürüm + gömülü Team ID (4. satır) = `APPLE_TEAM_ID` → sırların varlığı (değer basılmaz) → geçici keychain
(rastgele parola, `-T /usr/bin/codesign`, `set-key-partition-list -S apple-tool:,apple:`), tek "Developer ID Application (TEAM)" kimliği →
`package.sh bundle/sign/check` (runtime + `--timestamp` + boş entitlement, TeamIdentifier) → zip → `notarytool submit --wait --timeout 30m`
(Accepted değilse `notarytool log` + kırmızı) → `stapler staple` + `validate` → `spctl -a -vv -t exec` "source=Notarized Developer ID" →
son zip açılıp yeniden `check` + `stapler validate` → `SHA256SUMS`, `icerik-sha256.txt`, `notarization.json` → artifact (1 gün).
`.p12`/`.p8`/keychain `if: always()` ile silinir.

### 28f.4 Yayın (`deploy/agent/publish-mac.sh`)

Ortam kilidi (sunucuda, `.env` `DEPLOY_ENV`, fail-closed):

| Hedef                                          | Kabul                                                      | Ret                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| production                                     | yalnız `--tag vX.Y.Z` (Release; notarize ya da ad-hoc, r4) | `dir-*`, `stg-*`, proje ≠ `remote`, PUBLIC_BASE_URL/SITE_HOST `stg.*` |
| staging (ikinci yığın veya tek yığın `remote`) | `stg-*`, `dir-*` (ad-hoc TEST), `vX.Y.Z`                   | diğer etiketler; proje `remote` + genel ad `stg.*` (S13C-15)          |
| development                                    | hepsi                                                      | —                                                                     |
| boş / bilinmeyen                               | —                                                          | hepsi                                                                 |

Windows'tan fark: tek yığın staging TEST zip'ini **kabul eder**. Gerekçe: zip yalnız `MAC_AGENT_SHA256` eşleşirse sunulur. Yanlış kurulmuş
ikinci yığın S13C-15 ile durur. Prod `.env` değişmediği için prod TEST zip'ini sunmaz (503).

Operatör tarafı: `SHA256SUMS` tek satır, `PK`, ≤ 60 MiB, yol kaçışı yok, tam iki üst öğe, `Contents/MacOS/noktadestek` +
`_CodeSignature`, bundle kimliği (stg yollarında `.stg`, Release'te `.stg` yok). Ad: Release `^NoktaDestek-macOS-X.Y.Z.zip$`
(`-stg-` ret), staging `NoktaDestek-macOS-stg-X.Y.Z.zip`. `--tag`: `--source-ref refs/tags/<etiket>` + dal ortamdan (r4, K-P28f-r4-9):
`APPLE_TEAM_ID` tanımlı → notarized predicate (teamId = `APPLE_TEAM_ID`; bozuk değer RET, ad-hoc'a düşmez); macOS'ta ayrıca `codesign`
TeamIdentifier + `spctl`. Tanımsız → `macos-adhoc/v1` predicate'i zorunlu ve **tüm** attestation'larda `bundleId`, `version` (= etiket,
`v`'siz), `file`, `signature=adhoc`, `notarized=false`, `executableSha256` (= zip içi ikili) eşleşmeli; macOS'ta `Signature=adhoc`. Karşı
dalın predicate'i yoktur → yanlış ortam değişkeni RET (ipucu mesajlı). Sunucu tarafı: ağsız yardımcı konteynerle
`agent_downloads/NoktaDestek-macOS.zip`'e atomik yazım, `.env` `MAC_AGENT_SHA256` + `MAC_AGENT_SIGNING` tek yazımda (yedek `.env.bak.mac.*`,
son 5; `--apply` 6. argüman `adhoc|notarized`), `PUBLISHED.log` `mac` satırı (son alan imza türü), server yeniden yaratılır, Caddy'den `/downloads/NoktaDestek-macOS.zip` SHA kontrolü.

**Staging TEST paketi (bugünkü yol; Go'yu docker, paketlemeyi operatör Mac'i yapar):** temiz ağaç (commit'lenmiş), repo kökü:

```bash
SERVER='https://remote.noktabilisim.net'; VER=0.19.0      # tek yığın staging'in gömülü adresi (§28u.9)
OUT="$(mktemp -d)"
for a in arm64 amd64; do
  docker run --rm -v "$PWD:/src" -v "$OUT:/out" -w /src -e GOFLAGS=-mod=readonly -e GOTOOLCHAIN=local \
    golang:1.26.11-bookworm@sha256:dc40a13b61304647ed7e5d581d246b86413dfc29d63c6d018310feb93cd98fc0 sh -c '
    git config --global --add safe.directory /src
    apps/agent-win/build/build-darwin.sh "$0" "$1" "$2" "/out/noktadestek-$2" test' "$SERVER" "$VER" "$a"
done
shasum -a 256 "$OUT"/noktadestek-*        # ikinci koşuda (yeni OUT) aynı olmalı
SOURCE_DATE_EPOCH="$(git log -1 --format=%ct)" apps/agent-win/build/macos/package.sh adhoc \
  "$OUT/noktadestek-arm64" "$OUT/noktadestek-amd64" "$VER" stg "$OUT/pkg" "NoktaDestek-macOS-stg-$VER.zip"
mkdir "$OUT/yayin" && cp "$OUT/pkg/NoktaDestek-macOS-stg-$VER.zip" "$OUT/yayin/"
(cd "$OUT/yayin" && shasum -a 256 "NoktaDestek-macOS-stg-$VER.zip" > SHA256SUMS)
ALLOW_UNATTESTED=staging deploy/agent/publish-mac.sh --dir "$OUT/yayin" --no-attestation --dry-run
ALLOW_UNATTESTED=staging deploy/agent/publish-mac.sh --dir "$OUT/yayin" --no-attestation --ssh root@185.126.217.99 \
  --deploy-dir /opt/remote/deploy
```

Beklenen: `yayınlandı: agent_downloads/NoktaDestek-macOS.zip (dir-…-unattested, <sha>)` ve
`kontrol: <host>/downloads/NoktaDestek-macOS.zip SHA-256 = MAC_AGENT_SHA256 = <sha>`. Sonra `curl -sk https://<host>/api/v1/public/agent/availability`
→ `"macos":true,"macosTestBuild":true`. İkinci yığın (`/opt/remote-stg`) kurulduysa CI yolu:
`gh workflow run agent-win.yml --ref main -f server_url=https://stg.remote.noktabilisim.net -f version=0.19.0` →
`publish-mac.sh --stg-run <run-id> --ssh root@185.126.217.99`.

**Prod:** ~~yalnız Apple hesabı + imzalı Release sonrası (R39)~~ r4 ile değişti → ad-hoc prod yayını §28f.9. Developer ID dalı:
`APPLE_TEAM_ID=<TEAM> deploy/agent/publish-mac.sh --tag vX.Y.Z --dry-run`, sonra `--ssh root@<prod>`.

Kilit testi: `deploy/agent/test-publish-mac-lock.sh [<stg zip klasörü>]` → `SONUÇ: GEÇTİ` (2026-11-20 r4: 52/52; `gh` sahte fikstürle,
ağsız — `--tag` ad-hoc/notarize dalları ve predicate alanları dahil; macOS'ta fikstür gerçek ad-hoc imzalı).

### 28f.5 Geri alma ve tekrarlanabilirlik karşılaştırması (S-P28f-17)

- **macOS indirmesini kapat** (sunucu/web geri alınmadan): `deploy/agent/publish-mac.sh --withdraw --ssh root@<sunucu> [--deploy-dir …]`
  → `MAC_AGENT_SHA256=` + `MAC_AGENT_SIGNING=` (tek yazım) + server yeniden + `/downloads/NoktaDestek-macOS.zip` **503** kontrolü.
  Karşılama sayfası tarayıcı moduna döner.
- Önceki sürüme dönüş: `publish-mac.sh --tag v<önceki>` (Release'te zip varsa). `.env`'i elle düzenleyerek geri dönmek **yasak** (S-r4-7):
  SHA ile imza türü ayrışır ("notarized" bayat kalabilir). Notarize yayından ad-hoc'a dönüş önce `--withdraw` ister (S-r4-6).
- Release'teki imzalı paketin dilimini kaynakla karşılaştırma: aynı etiketten ince ikililer (GO_IMAGE, `build-darwin.sh` — etiket dışında
  prod adresiyle derlemek için CI koşusunun `agent-mac-thin` artifact'i ya da `GITHUB_REF_TYPE=tag GITHUB_REF_NAME=v<sürüm>` ortamı) →
  zip açılır → `apps/agent-win/build/macos/package.sh compare "Nokta Destek.app" noktadestek-arm64 arm64` (ve `x86_64` / `noktadestek-amd64`).
  `codesign --remove-signature` `__LINKEDIT` vmsize alanını geri yüklemez; betik yalnız bu 8 baytı eşitleyip kalan dosyayı bayt bayt
  karşılaştırır (yerelde: ad-hoc paket = ince ikili AYNI; 1 bayt değiştirilmiş ikili FARKLI).

### 28f.6 "Yine de Aç" yalnız staging (S-P28f-8) ve elle test listesi

> **r4 ile değişti (2026-11-20):** "Yine de Aç" artık prod ad-hoc yayında da müşteriye anlatılır (TEST kelimesi olmadan; web
> `adhoc` varyantı, zip içi `OKUBENI-adhoc.txt`). "Prod paketi bu adımı istemez / macOS uyarı verirse açmayın" yalnız Developer ID
> (notarize) dalı için geçerlidir. Elle liste: mimari-p28f §15.7 E-listesi.

- Staging TEST paketi ad-hoc'tur. Gatekeeper reddeder → Sistem Ayarları → Gizlilik ve Güvenlik → **Yine de Aç** (macOS 15+ parola
  isteyebilir). Bu adım **yalnız** staging karşılama sayfasında (`macosTestBuild:true`), bu runbook'ta ve test raporunda geçer. Prod paketi
  notarize ve staple'lıdır, bu adımı istemez. Müşteri kılavuzu: "macOS uyarı verirse açmayın".
- Ad-hoc imzada her sürüm yeni TCC kimliği alır (A-PF-6). Test makinesinde eski kaydı temizleyin:
  `tccutil reset ScreenCapture net.noktabilisim.destek.stg; tccutil reset Accessibility net.noktabilisim.destek.stg`.
- Elle liste (test-operatoru, K11; mimari §14): fiziksel Control+Shift+F12/F11 arka planda; S-P28f-1 sahte kaynak senaryoları
  (Fare Tuşları, VO-Space, AXPress, HID kaynaklı sentetik; eller çekiliyken 60 sn 0 kabul); S-P28f-2 gösterge (⌘H, ⌘⌥H, ⌘M, tam ekran,
  Görev Kontrolü, ekran takma ≤ 1 sn); TCC Ekran Kaydı → yeniden başlatma → kod korunur; Erişilebilirlik yok → teknisyende
  "Müşteri erişilebilirlik izni vermedi"; `tccutil reset`; iz testi (Metal önbelleği dahil); App Nap 10 dk; `arch -x86_64` ile x86_64 dilim.

### 28f.7 Sertifika / anahtar rotasyonu ve iptal (S-P28f-6)

- **Gözcü:** repo değişkeni `AGENT_WATCH_MAC_URL=https://<prod host>/downloads/NoktaDestek-macOS.zip` (yalnız macOS Release yayımlanınca).
  Hiçbir Release'te macOS satırı yoksa iş "notice" ile geçer (alarm yok). Varsa 503, uyuşmazlık ve erişilemezlik `agent-watch` issue'su
  açar → §11.7 ile aynı müdahale. Kapatma yolu `--withdraw`.
- **Developer ID sertifikası süresi dolmadan (5 yıl) ya da sızıntı şüphesinde:** yeni CSR → yeni Developer ID Application → `.p12` →
  `agent-mac-sign` secret'ları güncellenir. Eski imzalı paketler zaman damgalı olduğu için çalışmaya devam eder. Sızıntıda Apple Developer
  hesabından sertifika **Revoke** edilir; bu, o sertifikayla imzalı tüm paketleri Gatekeeper'da geçersiz kılar. Önce yeni sertifikayla yeni yama
  sürümü (`v0.19.x`) çıkarılır ve yayınlanır (`publish-mac.sh --tag`), sonra revoke edilir. Arada `--withdraw` uygulanır.
- **Notary API anahtarı (.p8):** App Store Connect'te yeni anahtar → secret'lar güncellenir → eski anahtar **Revoke**. Sızıntıda hemen
  revoke edilir (anahtar imzalamaz, yalnız notarize gönderir; etkisi sınırlı).
- **Team ID değişirse:** `APPLE_TEAM_ID` güncellenir ve **yeni etiket** çıkarılır (beklenen Team ID ince ikiliye derlemede gömülür,
  D-P28f-K3; eski etiketin yeniden imzalanması sign-mac'te "gömülü Team ID vars.APPLE_TEAM_ID değil" ile durur). TCC kayıtları bundle + Team'e bağlı olduğundan kullanıcılar izinleri yeniden verir
  (kılavuza not).
- Rotasyondan sonra `agent-mac-sign` ortamında yalnız yeni secret'ların bulunduğu ve eski `.p12`'nin hiçbir makinede kalmadığı kontrol edilir.

### 28f.8 test-macos zorunlu test listesi ve beklenen Team ID (P28f düzeltme 1)

**Görünür SKIP (QA m.6, mimari-p28f §8.2).** `test-macos` tek `go test -count=1 -v ./...` koşar. Her `--- SKIP` satırı uyarı
annotation'ı olur (GitHub adım başına annotation sayısını sınırlar; tam liste step summary "go test (darwin) SKIP listesi"nde). Uyarı
olan SKIP'ler izin/ekran ya da ortam bağımlıdır: SCK (`needCapture`, Ekran Kaydı izni yok), `TestAC49CGInjectMoveInPlace` ve
`TestAC104TapLifecycleAndOwnEventsNotLocal` (Erişilebilirlik), `TestP28fCGBindAndEventFields` (etkin ekran),
`TestP28fK2AC105EnvProbeUnlocked`, `TestP28fK2AC106Monitors`, `TestAC394P28fUserCacheDirMatchesGetconf`, `TestAC117P28fQuarantineSpctl`,
ölçüm testleri (`NK_K2_OLCUM`). **Zorunlu** liste (iş akışındaki `zorunlu=`): koşullu `t.Skip` yolu olmayan darwin testleri — `objc`
(izin listesi, sınıf/selector fail-closed, NSString, async), VideoToolbox (yazılım kodlayıcı zorunlu; donanım yoksa yalnız log), pano,
karantina + iz/indirme dizini, transfer karantinası, `lp` yazdırma, `input` (ControlReady, localClick, tuş tablosu, Türkçe/AltGr,
koordinat, kapalı kapı, Erişilebilirlik kısayolları), `macperm` yeniden başlatma, `ui/mac` mantığı (`TestP28fTestBand` dahil). Zorunlu test
SKIP olur ya da hiç koşmazsa (ad değişti/silindi) iş kırmızı; testi yeniden adlandıran listeyi de günceller.

Yerel prova (2026-11-17, Apple Silicon, Go 1.26.11): adımın betiği gerçek `-v` çıktısıyla çıkış 0, 42 zorunlu PASS, 4 SKIP uyarısı
(`TestP28fK2Measure`, `…HeavyVT`, `TestAC117P28fQuarantineSpctl`, `TestP28dK0sCompilerMatchesInterpreter`). Negatif: zorunlu bir test
SKIP'e çevrildi → çıkış 1; zorunlu bir testin PASS satırı silindi → çıkış 1; `go test` çıkış 3 → çıkış 3. macos-15 runner'daki SKIP
dağılımı ilk CI koşusunda görülür (bu makinede SCK/AX izni var).

**Beklenen Team ID (D-P28f-K3).** `build-darwin.sh` `EXPECTED_TEAM_ID` ortam değişkenini (tam 10 karakter `A-Z0-9`, `case` ile; satır
sonu/boşluk ret) `-X remote-support/agent-win/internal/config.expectedTeamID` olarak gömer (sembol adı betikte `TEAM_SYMBOL`). `-X` var
olmayan sembolde sessiz kaldığından derlemeden sonra değerin ikilide bulunduğu denetlenir; yoksa ikili silinir, çıkış 2 ("Go kaynağında
yok"). CI: `build-mac` yalnız prod (etiket) kipinde ve `vars.APPLE_TEAM_ID` doluysa geçirir; `build-meta.txt` 4. satırına yazar (iki
derlemenin `cmp`'i bunu da karşılaştırır); `sign-mac` 4. satır = `APPLE_TEAM_ID` değilse durur. `APPLE_TEAM_ID` boşken (r4 ad-hoc prod
dalı) hiçbir şey gömülmez; 4. satır boş → `reproducible-mac` `signing=adhoc` (dalın tek kaynağı, S-r4-3), prod'da TEST bandı yok. Elle staging derlemesi (§28f.4 docker komutu) Team ID geçirmez (TEST bandı zaten görünür).
Yerel prova: Team ID'siz iki derleme SHA eşit; uydurma sembol → ret, çıktı yok; var olan bir sembolle (geçici kopya) → kabul, değer
ikilide; `abcde12345`, 9 karakter, `"ABCDE12345 -X a=b"`, satır sonlu değer → çıkış 2.

### 28f.9 Ad-hoc (Developer ID'siz) prod yayını — r4 (2026-11-20; mimari-p28f §15, K-P28f-r4-2/4/7/9/11, S-r4-3..7/10)

Ön koşul: `vars.APPLE_TEAM_ID` **tanımsız** (tanımlıysa Developer ID dalı, §28f.3). Dal etiket derlemesinde belirlenir (build-meta 4.
satır) ve `reproducible-mac` `signing` çıktısı tek kaynaktır; değişkeni derleme ile onay arasında değiştirmek koşuyu kırmızı yapar →
yeni etiket.

**Yayın sırası (bağlayıcı):**

1. Sunucu + web r4 (availability `macosSigning`, web `adhoc` rehberi) prod'da (§24 / normal deploy). Eski sunucu alanı vermez → web
   `adhoc` varsayar (zararsız).
2. Etiket `vX.Y.Z` → koşu sayfasında `package-mac` özeti: **imza dalı `adhoc`**, zip SHA, paket içi ikili SHA. Onay kontrol listesi
   macOS maddesi: E-listesi (mimari-p28f §15.7) aynı commit'in staging TEST paketiyle macOS 14 + 15'te GEÇTİ mi? Değilse **Reject**
   (reddedilen etiketin `agent-mac-adhoc` artifact'i 7 gün kalır ama attestation'sızdır, yayın betiğinden geçemez).
3. Onay → `attest-mac` (provenance + `macos-adhoc/v1`) → `update-manifest` (UPDATE_SIGNING_ENABLED=1 ise
   `update-client-macos-universal.json`) → `release` (zip + SHA256SUMS'ta zip + paket içi ikili satırı; Release notu ad-hoc metni).
4. Operatör makinesinde (APPLE_TEAM_ID **tanımsız**):
   ```bash
   env -u APPLE_TEAM_ID deploy/agent/publish-mac.sh --tag vX.Y.Z --dry-run   # "dal: adhoc", "ad-hoc attestation: OK (n adet …)"
   env -u APPLE_TEAM_ID deploy/agent/publish-mac.sh --tag vX.Y.Z --ssh root@<prod>
   ```
   Beklenen son satır `kontrol: <host>/downloads/NoktaDestek-macOS.zip SHA-256 = MAC_AGENT_SHA256 = <sha>`; prod `.env`'de
   `MAC_AGENT_SIGNING=adhoc`. Doğrulama: `curl -s https://<host>/api/v1/public/agent/availability` → `macos:true, macosSigning:"adhoc"`.
5. Ardından `deploy/agent/publish-manifest.sh` (§31) — manifest sha256'sı `.env` `MAC_AGENT_SHA256` ile eşleşmeli, bu yüzden **sonra**.
6. Prod paketiyle E-1 ve E-5 bir kez daha (mimari-p28f §15.7).

**Kurallar:** `MAC_AGENT_SHA256` / `MAC_AGENT_SIGNING` elle değiştirilmez (S-r4-7); geri alma `--withdraw` ya da önceki etiketle
yeniden `--tag`. Hedef `MAC_AGENT_SIGNING=notarized` iken ad-hoc yayın betikte RET → bilinçli düşüş için önce `--withdraw`, sonra ad-hoc
`--tag` (S-r4-6). Zip içi `OKUBENI.txt` müşteriye "Oturum bitince bu klasörü silin" der: ad-hoc'ta eski sürüm ikilileri kendi cdhash'iyle
verilmiş TCC iznini korur (S-r4-10). Developer ID'ye geçişte (`APPLE_TEAM_ID` tanımlanırsa) r4 varsayılanları (boş → adhoc) ayrı tasarım
turunda gözden geçirilir (S-r4-8).

## 28g. P28g — Linux istemcisi: CI, yayın (devops K8a/K8b, 2026-11-17/18; mimari-p28g §8, §9, §13 S-P28g-6/9/12; ADR-0038)

Test sözleşmesi: `docs/implementation.md` "P28g K8a". Yayın: §28g.4–§28g.7 (K8b).

### 28g.1 CI akışı (`agent-win.yml`)

- `check`: linux/amd64 `CGO_ENABLED=0` vet ve staticcheck (etiketsiz ve `-tags linuxgui`), govulncheck, go-licenses. Kaynakta yasak
  GStreamer öğe adı (`x264enc`, `decodebin`, `auto*` …) taraması.
- `build-linux` ×2 → `reproducible-linux`: SHA eşitliği ve `build/check-linux-elf.sh` (ELF64 x86-64, NEEDED ⊆ libc/libdl/libpthread,
  ≤ 60 MiB). Etiket: prod adres, staging/`.invalid` yok. Artifact adları:
  - etiket: `agent-linux` (`NoktaDestek-linux-x86_64-<sürüm>`)
  - main'den staging dispatch: `agent-linux-stg`
  - diğer: `agent-linux-test`
- `test-linux-gui` (22.04, 24.04): `apps/agent-win/test/linux/gui.sh <2204|2404>`. Özet koşu sayfasında görünür, günlükler
  `test-linux-gui-<sürüm>` artifact'ındadır. Etikette `bekleyen` testler ve eksik iz betiği kırmızıdır.
- `approve`, `reproducible-linux` ve `test-linux-gui` yeşil olmadan açılmaz.

### 28g.2 Yerel prova (CI ile aynı betik)

```sh
apps/agent-win/test/linux/gui.sh 2404          # ya da 2204; çıktı apps/agent-win/bin/gui-test-2404/
GO_IMAGE=… apps/agent-win/test/linux/gui.sh 2204 /tmp/gui   # GO_IMAGE verilmezse agent-win.yml'den okunur
sh apps/agent-win/build/build-linux.sh https://x.example.invalid 0.0.0 /tmp/nd && sh apps/agent-win/build/check-linux-elf.sh /tmp/nd
```

- Apple Silicon'da imaj `linux/amd64` emülasyonla koşar. İmaj kurulumu yaklaşık 2 dk, test koşusu emülasyonda yavaştır.
- Kırmızıysa `ozet-<sürüm>.md`'deki HATA satırlarına bakın:
  - `go-test-x11-*.txt` / `go-test-wayland-*.txt`: test çıktısı.
  - `xi2-offsets-*.txt`: K3 ofset karşılaştırması.
- Wayland katmanı kurulamazsa yalnız uyarı verilir. Kanıt elle alınır (mimari-p28g §12.1).

### 28g.3 Bakım

- Taban imaj digest'leri `Dockerfile.2204/2404` dosyalarındadır ve Dependabot PR'ı açar. Go sürümü GO_IMAGE'dan gelir (tek kaynak).
- apt paketleri sabit değildir. İmaj kaynaklı kırmızıda önce paket listesi karşılaştırılır.
- Zorunlu test adı değişirse `test/linux/gui-tests.txt` aynı PR'da güncellenir.
- Harness (K8b): iz testi ELF'i `-buildvcs=false` ile derlenir (repo kökü farklı uid'le bağlı → git "dubious ownership" → "error
  obtaining VCS status"); yayın derlemeleri değişmez. `trace-check-linux.sh` çalışan istemciyi `/proc/<pid>/exe` ve argv[0] ile arar
  (eskiden `pgrep -f` betiğin kendi `--exe …/Destek-12345678` komut satırını eşliyordu).

### 28g.4 Dosyalar ve CI yayın zinciri

| Yer                                                            | İş                                                                                                                               |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `deploy/agent/publish-linux.sh` + `test-publish-linux-lock.sh` | yayın / geri alma (`--tag`, `--stg-run`, `--dir`, `--withdraw`); kilit + adres + sahte `gh` ile `--tag` testi                    |
| `deploy/Caddyfile` `@agentLinux` + `agent_bin_file`            | `/downloads/(NoktaDestek-linux\|Destek-<8 hane>)` → forward_auth `/internal/agent-ready/linux` → volume'daki `NoktaDestek-linux` |
| `deploy/docker-compose.yml` server                             | `LINUX_AGENT_PATH=/data/downloads/NoktaDestek-linux` (sabit), `LINUX_AGENT_SHA256=${LINUX_AGENT_SHA256:-}` (yayın betiği yazar)  |
| `.github/workflows/agent-win.yml`                              | `attest-linux` (etikette onaydan sonra), `release`: `NoktaDestek-linux-x86_64-<sürüm>` + SHA256SUMS satırı **zorunlu**           |
| `.github/workflows/agent-watch.yml`                            | `hash-linux` (sunulan ELF = bir Release SHA256SUMS satırı), günlük govulncheck `GOOS=linux`                                      |

Caddy yanıtı: `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename="Destek-<kod>"` (uzantısız),
`nosniff`, `no-store`, **`Last-Modified` yok** (tarayıcı mtime'ı ondan alırsa kılavuzdaki `find -mmin -10` komutu dosyayı görmez,
S-P28g-6). Kapı kapalıysa (SHA boş / uyuşmaz / dosya yok) 503 ve dosya sunulmaz; Windows/macOS kapıları bağımsızdır.
Doğrulama: `deploy/test-caddy.sh` (Docker; Linux başlıkları, çapraz kapılar, biçim dışı adlar 404) → `SONUÇ: GEÇTİ`.

CI: `reproducible-linux` artifact'ı → `attest-linux` (`attest-build-provenance`; etikette `agent-linux`, staging dispatch'te
`agent-linux-stg`, main push'ta `agent-linux-test`) → `release` (artifact adı, dosya adı = etiket sürümü, SHA = reproducible-linux
çıktısı, build-meta `prod` + `AGENT_SERVER_URL`; `sha256sum -c --ignore-missing SHA256SUMS`). Linux'ta imza adımı olmadığından
"skipped" yolu yoktur: `attest-linux` başarısızsa Release oluşmaz.

ELF adres denetimi (S-P28g-9): etikette `check-linux-elf.sh --server AGENT_SERVER_URL --forbid STG_SERVER_URL --forbid
PLACEHOLDER_SERVER_URL`. **Düz `.invalid` aranmaz:** gerçek ELF'te Go sembolleri (`http2…invalidate`) bu metni 27 kez içerir
(2026-11-18 ölçüldü); `publish-linux.sh` de yalnız `https://<host>.invalid` adresini arar.

### 28g.5 Yayın (`deploy/agent/publish-linux.sh`)

Ortam kilidi `publish-mac.sh` ile aynıdır (§28f.4 tablosu): production yalnız `--tag vX.Y.Z`; staging `stg-*`, `dir-*`, `vX.Y.Z`;
development hepsi; boş/bilinmeyen ret; proje `remote` + `stg.*` genel ad ret (S13C-15). Ek olarak **sunucu tarafında** ELF'te hedef
`.env` `PUBLIC_BASE_URL` (şemasıyla) geçmelidir (staging dahil — ikili o sunucuya bağlanır), `https://….invalid` geçmemelidir;
production'da staging adresi (`https://stg.remote.noktabilisim.net`) de geçmemelidir.

Operatör tarafı: `SHA256SUMS` tek satır; ELF64 LE x86-64 (`od`, `readelf` gerekmez — macOS'ta çalışır), ≤ 60 MiB, UPX yok.
Ad: Release `^NoktaDestek-linux-x86_64-X.Y.Z$` (`-stg-` ret), staging yolları `NoktaDestek-linux-x86_64-stg-X.Y.Z`.
`--tag` (S-P28g-9): `AGENT_SERVER_URL=https://<prod host>` ortam değişkeni **zorunlu** (repo değişkeniyle aynı değer); ELF'te bu adres
var, staging adresi yok; `gh attestation verify --signer-workflow <repo>/.github/workflows/agent-win.yml --source-ref refs/tags/<etiket>
--deny-self-hosted-runners`. Sunucu tarafı: ağsız yardımcı konteynerle `agent_downloads/NoktaDestek-linux` atomik (0644), `.env`
`LINUX_AGENT_SHA256` (yedek `.env.bak.linux.*`, son 5), `PUBLISHED.log` `linux` satırı, server yeniden yaratılır, Caddy'den
`/downloads/NoktaDestek-linux` SHA + `octet-stream` + `Last-Modified` yok kontrolü (Caddyfile güncel değilse burada durur).

**Staging TEST ikilisi (tek yığın, bugünkü yol):** sunucu (P28g K6) + Caddyfile + compose staging'e alınmış olmalı (§28g.7 sıra).
Temiz ağaç (commit'lenmiş), repo kökü:

```bash
SERVER='https://remote.noktabilisim.net'; VER=0.20.0      # tek yığın staging'in gömülü adresi (§28f.4 ile aynı)
OUT="$(mktemp -d)"
for n in 1 2; do
  docker run --rm --platform linux/amd64 -v "$PWD:/src" -v "$OUT:/out" -w /src -e GOFLAGS=-mod=readonly -e GOTOOLCHAIN=local \
    golang:1.26.11-bookworm@sha256:dc40a13b61304647ed7e5d581d246b86413dfc29d63c6d018310feb93cd98fc0 sh -c '
    git config --global --add safe.directory /src
    apps/agent-win/build/build-linux.sh "$0" "$1" "/out/nd-$2" test' "$SERVER" "$VER" "$n"
done
shasum -a 256 "$OUT"/nd-*                  # iki SHA eşit olmalı (tekrarlanabilirlik)
mkdir "$OUT/yayin" && cp "$OUT/nd-1" "$OUT/yayin/NoktaDestek-linux-x86_64-stg-$VER"
(cd "$OUT/yayin" && shasum -a 256 "NoktaDestek-linux-x86_64-stg-$VER" > SHA256SUMS)
ALLOW_UNATTESTED=staging deploy/agent/publish-linux.sh --dir "$OUT/yayin" --no-attestation --dry-run
ALLOW_UNATTESTED=staging deploy/agent/publish-linux.sh --dir "$OUT/yayin" --no-attestation --ssh root@185.126.217.99 \
  --deploy-dir /opt/remote/deploy
```

Beklenen: `yayınlandı: agent_downloads/NoktaDestek-linux (dir-…-unattested, <sha>)` ve `kontrol: … octet-stream, Last-Modified yok`.
Sonra `curl -sk https://<host>/api/v1/public/agent/availability` → `"linux":true`. TEST metni pencere başlığında ve Hakkında'da
`test` kipinden gelir. İkinci yığın (`/opt/remote-stg`) kurulduysa CI yolu: `gh workflow run agent-win.yml --ref main -f
server_url=https://stg.remote.noktabilisim.net -f version=0.20.0` → `publish-linux.sh --stg-run <run-id> --ssh root@185.126.217.99`.
**Durum (2026-11-19):** `--ssh` adımı staging'de koşuldu (0.20.0, SHA-256 `6387f765…`; ardından 0.22.0 `16ec1418…`, aynı komut `VER=0.22.0`; §8 yayın geçmişi). CI'daki main push
artefaktı (`agent-linux-test`) bu yol için **kullanılamaz**: yer tutucu adres (`https://destek.example.invalid:4450`) ve `0.0.0` gömer,
betik reddeder. Tek yığın staging'de ikili yukarıdaki yerel komutla derlenir.

**Prod (yalnız §28g.6 kontrol listesi tamamsa):** `AGENT_SERVER_URL=https://remote.noktabilisim.net deploy/agent/publish-linux.sh --tag
v0.20.0 --dry-run`, sonra `--ssh root@<prod>`.

Gözcü: repo değişkeni `AGENT_WATCH_LINUX_URL=https://<prod host>/downloads/NoktaDestek-linux` (Linux Release yayımlanınca). Hiçbir
Release'te Linux satırı yoksa iş "notice" ile geçer. 503, uyuşmazlık, erişilemezlik → `agent-watch` issue'su → §11.7; kapatma `--withdraw`.

Kilit testi: `deploy/agent/test-publish-linux-lock.sh [<stg klasörü>]` → `SONUÇ: GEÇTİ` (2026-11-18: 43/43, gerçek TEST ELF'iyle).

### 28g.6 Prod yayın kontrol listesi (Linux; `approve` özetinde de var)

- [ ] Sunucu P28g (K6) prod'da: `os=linux`, availability `linux`, `WAYLAND_NO_CONTROL`, `/internal/agent-ready/linux`; Caddyfile
      `@agentLinux` ve compose `LINUX_AGENT_*` prod'da (yoksa yayın betiği Caddy kontrolünde durur).
- [ ] K9 qa GEÇTİ, güvenlik Kritik/Yüksek 0; mimari-p28g §12.1 E-listesi staging TEST ikilisiyle GEÇTİ.
- [ ] **Wayland kontrolü (mimari-p28g §5.2b m.7):** E-7 **(b)** (teknisyen Ctrl'yi sürekli yeniden basarken Super+L ≤ 3 sn REVOKED) ve
      **(c)** (kipli kabuk diyaloğu açıkken Super+L) gerçek GNOME Wayland makinesinde (24.04 + 22.04) GEÇTİ ise anahtar **on** kalır.
      **E-7 (b)/(c) geçmezse `WAYLAND_CONTROL=off` ile derle:** repo değişkeni `LINUX_WAYLAND_CONTROL=off`, yeni etiket. Etiket (prod) derlemesinde değişken `on` ya da `off` olarak tanımlı olmak zorundadır; tanımsızsa derleme durur (D-P28g-K3-2). Etiket dışı derlemede tanımsız → on.
      off ikili Wayland'de yalnız görüntüdür (RemoteDesktop istenmez, kontrol isteğine `WAYLAND_NO_CONTROL`); X11 etkilenmez. Değer
      `reproducible-linux` özetinde ("Wayland kontrolü: on|off") ve build-meta 4. satırında; iki derleme aynı değeri kullanmak zorunda
      (build-meta `cmp`). Yerelde: `WAYLAND_CONTROL=off build/build-linux.sh …`. (d) tutmazsa yalnız kılavuz notu.
- [ ] Release'te `NoktaDestek-linux-x86_64-<sürüm>` ve SHA256SUMS satırı var; `gh attestation verify … --source-ref refs/tags/<etiket>` geçti.

### 28g.7 Sıra ve geri alma

- Sıra: sunucu + web (K6/K7) → Caddyfile + compose (`docker compose up -d caddy server`) → `publish-linux.sh`. Linux kapısı
  `LINUX_AGENT_SHA256` boşken 503 olduğundan sunucu önce çıkabilir; karşılama sayfası Linux düğmesini göstermez.
- **Linux indirmesini kapat:** `deploy/agent/publish-linux.sh --withdraw --ssh root@<sunucu> [--deploy-dir …]` → `LINUX_AGENT_SHA256=`
  - server yeniden + `/downloads/NoktaDestek-linux` **503** kontrolü. Windows/macOS etkilenmez.
- Önceki sürüme dönüş: `AGENT_SERVER_URL=… publish-linux.sh --tag v<önceki>` (Release'te Linux ELF'i varsa).

## 29. P22 — oturum sohbeti (sunucu + web; istemci 0.21.0 = P22-G ayrı) (devops P22-O, 2026-11-18; mimari-p22 §7.2, §10.2, §13, §15.2/§15.3/§15.7; ADR-0025 r-P22; AC-264, AC-291)

Bu bölüm yayın **talimatıdır**; P22-O'da staging/prod'a dokunulmadı. **DENENMEDİ:** staging seed provası ve alarm provası
(§10.1 P22-O kabulü) **ana oturum dağıtımında** yapılır (§29.5 "Prova") ve §8 yayın geçmişine yazılır.

**Yeni env yok** (`git diff main -- apps/server/src/env.ts` boş; `.env.example` / compose değişmez). Caddy / host nginx değişmez
(sohbet mevcut `/ws/tech` ve `/ws/guest` üzerinden; yeni REST yolu `GET /api/sessions/:id/chat` mevcut önekte).

### 29.1 Yayın sırası (staging; prod aynı, §29.3 kararıyla)

| #   | Komut (sunucu, root, `/opt/remote/deploy`; ikinci yığın `/opt/remote-stg/deploy`)                                                               | Beklenen                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Ön yedek, `git pull`'dan ÖNCE: `systemctl start remote-backup.service; journalctl -u remote-backup -n 5 --no-pager \| grep -E 'OK run\|FAILED'` | `remote-backup: OK … tetikleyici=23`                                                                                                                                                     |
| 2   | §25.2 akışı: `git pull` → `.env` `IMAGE_TAG` → `docker compose build && docker compose up -d` → `docker compose logs --since 5m migrate`        | `20261126000000_p22_session_chat` uygulandı (yalnız UQ indeks, INPLACE / LOCK=NONE; çevrimiçi). Server/web healthy. `P22_PRECHECK dup_session_client=<n>` ile durursa §29.6              |
| 3   | `check-app-grants.sh` (§6 yöntemi)                                                                                                              | **873/873 PASS**, tetikleyici 23 (db-notlari "P22": grants ve tetikleyici değişmedi). Farklıysa dur, dba                                                                                 |
| 4   | **Düşük trafik anında** (müşteri karşılama sayfası açık değilken; mesai dışı): `docker compose --profile setup run --rm seed`                   | `seed: … consentTextsCreated=<n> …` — n = sistem metnini kullanan firma sayısı (ilk koşu); **ikinci koşu `consentTextsCreated=0`** (idempotent: gövde özeti aynıysa yeni sürüm yazılmaz) |
| 5   | Admin metinli firmalar (§29.2 sorgusu)                                                                                                          | Listelenen firmalar seed'den etkilenmez; Admin'e "Standart paragrafı ekle" duyurusu                                                                                                      |
| 6   | `cd ops && ./remote-watch.sh install` (+ `install stg`) → `systemctl start remote-watch.service; journalctl -u remote-watch -n 5`               | `OK (<n> kontrol)`; P22 metrikleri §29.4 komutuyla görünür                                                                                                                               |
| 7   | Duman: konsoldan bir Hızlı Destek, misafir **tarayıcı** ile katılır, iki yönlü mesaj; oturum bitince Geçmiş → oturum → Sohbet                   | Mesajlar canlı görünür, geçmişte aynı sırada; audit'te `session.chat_summary` (sayı = mesaj sayısı)                                                                                      |
| 8   | §8 yayın geçmişine satır (commit, migration adı, seed çıktısı `consentTextsCreated=<n>`, grants 873/873, §29.3 kararı)                          | —                                                                                                                                                                                        |

**AC-127 etkisi (seed, adım 4):** seed sistem metinli her firmada aydınlatma metninin yeni sürümünü (max+1) yayımlar ve eskisini
`is_current=0` yapar. O anda **eski sürümle açık karşılama sayfaları join'de 400** alır (müşteri "sayfayı yenileyin" görür); sayfa
yenilenince güncel metin gelir ve katılım çalışır. Bu yüzden düşük trafikte çalıştırılır. Audit: `consent_text.created {source:"seed"}`.
Sırayla `up -d`'den sonra çalıştırılır (yeni metin paragrafı yeni imajdaki `defaultConsentBody`'den gelir).

**Yayın sonrası açık konsol sekmeleri:** yeni sunucu `rs.cap.schat1` bildirmeyen `/ws/tech` soketini **4426** ile kapatır; eski
derlemeyle açık konsol bağlanamaz, "sayfayı yenileyin" (eski sekme genel yeniden bağlanma hatası gösterebilir) — yenileme düzeltir.
Sayı: `rs_ws_tech_outdated_total` (§29.4). Yayından sonraki ilk saatlerde artması normaldir; günler sonra hâlâ artıyorsa bir
web derlemesi önbellekte kalmıştır (host nginx/CDN önbelleği, kiosk tarayıcı).

### 29.2 Admin'in yazdığı aydınlatma metni (K-P22-5)

Seed Admin'in yazdığı güncel metne (`created_by` dolu) **dokunmaz**; o firmalarda sohbet paragrafı yoktur, ayar ekranında uyarı bandı
ve "Standart paragrafı ekle" çıkar (`chatParagraphMissing`). Listesi (salt okuma, migrator ya da app):

```bash
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_MIGRATOR_PASSWORD" mysql -umigrator -NB "$MYSQL_DATABASE" -e "SELECT c.tenant_id, t.name, c.version, c.created_at FROM consent_texts c JOIN tenants t ON t.id = c.tenant_id WHERE c.is_current = 1 AND c.created_by IS NOT NULL ORDER BY t.name"'
```

Çekirdek sorgu: `SELECT tenant_id FROM consent_texts WHERE is_current=1 AND created_by IS NOT NULL`. Çıkan firmaların Admin'lerine
duyuru: Ayarlar → Aydınlatma metni → "Standart paragrafı ekle" → Kaydet (yeni sürüm; o anda o firmada açık karşılama sayfaları
da AC-127 ile 400 alır — Admin'e düşük trafikte yapması söylenir).

### 29.3 Geçiş kuralı (mimari-p22 §10.2, K-P22-12) ve yayın kararı

- **Sunucu+web P22-G'siz yayımlanabilir.** Yeni sunucu + ≤ 0.20.x yerel istemci (Windows/macOS/Linux, kayıtlı/tepsi dahil): oturum
  sohbeti iki tarafta **kapalı** — konsolda "Müşterinin istemcisi eski…", istemcide sabit bildirim "Bu sürümde sohbet kapalıdır…
  lütfen sohbet için programı güncelleyin." Görüntü, kontrol, dosya, ses, kayıt ve talep sohbeti (`/ws/request`) etkilenmez.
  Tarayıcı modu tam çalışır: teknisyen gerekirse müşteriyi tarayıcıya ya da telefona yönlendirir. Audit: `session.chat_legacy`.
- **Öneri:** staging'e sunucu+web bağımsız çıkar; **prod'a P22-G 0.21.0 ile aynı bakım penceresinde** çıkar (eski istemcide sohbetin
  kapalı kaldığı süre ~0). P22-G gecikirse prod yayını yine yapılabilir (yukarıdaki bozulma kabul edilmiştir).
- **Sıra kuralı:** yeni istemci (0.21.0) + eski sunucu = onay düğmesi pasif → istemci kullanılamaz. **Sunucu önce**, istemci sonra;
  P22-G yayımlandıktan sonra sunucu **geri alınmaz**, ileri düzeltilir (§29.6).
- Karar (yayın günü doldurulur): `Prod yayını: [ ] P22-G ile aynı pencere  [ ] P22-G'siz (gerekçe: …)  — tarih: …, karar veren: …`

**Asgari istemci politikası (K-P22-15, Sonra — tarihli):** P22-G 0.21.0 **prod** yayınından **60 gün sonra** `schat1` bildirmeyen
AGENT misafiri kabul edilmeyecek ("Programı güncelleyin"; contracts sabiti `SESSION_CHAT_MIN_CLIENT`, env değil). Uygulama ayrı küçük
paket (AC gerekir → proje-yöneticisi, gereksinimler §9 Sonra). Yayın günü doldurulur:

- P22-G 0.21.0 prod yayın tarihi: `…` → politika devreye alma tarihi (= +60 gün): `…`
- O tarihten önce §29.5 legacy oranı düşük olmalı (öneri < %5); değilse kullanıcıyla tarih ertelenir.

### 29.4 Metrikler (`/metrics`, Bearer `METRICS_TOKEN`; tenant etiketi yok; `apps/server/src/ops/metrics.ts`)

| Metrik                                                       | Tür       | Anlam / izleme                                                                                                                      |
| ------------------------------------------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `rs_session_chat_messages_total{sender}`                     | sayaç     | Saklanıp iletilen mesajlar (`TECH` / `CUSTOMER`). Yinelenen (aynı `clientMsgId`) sayılmaz                                           |
| `rs_session_chat_rejected_total{reason}`                     | sayaç     | `rate`/`cap`/`invalid`/`forbidden`/`not_active`/`outdated`: kullanıcı/istemci kaynaklı. **`internal`: DB yazımı başarısız** — §29.5 |
| `rs_session_chat_legacy_sessions_total`                      | sayaç     | `rs.cap.schat1` bildirmeyen misafirle kabul edilen oturumlar (eski istemci ya da yayından önce açık tarayıcı sekmesi)               |
| `rs_session_chat_reads_total`                                | sayaç     | Oturum geçmişinden sohbet okuması (`GET /sessions/:id/chat`; audit `session.chat_viewed` 10 dk penceresiyle)                        |
| `rs_session_chat_store_seconds`                              | histogram | Mesaj INSERT süresi. p95 > 0,25 sn sürekli ise DB yükü (§13 "DB yavaş")                                                             |
| `rs_ws_tech_outdated_total`                                  | sayaç     | 4426 ile kapatılan eski konsol soketleri (§29.1 son paragraf)                                                                       |
| `rs_retention_rows_total{kind="session_messages"}`           | sayaç     | Anonimleştirmede silinen oturum sohbeti satırları                                                                                   |
| `rs_crypto_decrypt_failures_total{table="session_messages"}` | sayaç     | Çözülemeyen mesaj ("Mesaj okunamadı"); mevcut `crypto-decrypt` alarmı (§25.4) bütün `table` serilerini toplar → **P22 kapsanır**    |

```bash
docker compose exec -T server node -e "fetch('http://127.0.0.1:3001/metrics',{headers:{authorization:'Bearer '+process.env.METRICS_TOKEN}}).then(r=>r.text()).then(t=>console.log(t.split('\n').filter(l=>/^rs_(session_chat_|ws_tech_outdated)/.test(l)||/kind=\"session_messages\"|table=\"session_messages\"/.test(l)).join('\n')))"
```

Sayaçlar süreç yeniden başlayınca sıfırlanır; uzun dönem oran için §29.5 audit sorgusu esastır.

### 29.5 Alarmlar ve izleme

| Kontrol                               | Koşul                                                                                                                                                              | Düzey  | Eylem                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session-chat-internal` (mimari §7.2) | `rs_session_chat_rejected_total{reason="internal"}` son turdan beri arttı → artıştan sonra 1 sa (`remote-watch`, 10 dk; Prometheus eşdeğeri `increase(…[1h]) > 0`) | Uyarı  | Mesaj saklanamadı → **iletilmedi** (önce kaydet sonra ilet); kullanıcı "gönderilemedi, tekrar dene" görür. `docker compose logs --since 1h server \| grep session_chat_store` (gövde yok: `sessionId`, `chars`, `code`). DB erişimi / disk (`df`, §13 "DB dolu") / `session_messages` INSERT yetkisi (`check-app-grants.sh`). Süreklilik → backend |
| `crypto-decrypt` (mevcut, §25.4)      | `rs_crypto_decrypt_failures_total` > 0 (bütün `table`)                                                                                                             | Kritik | §25.4 aynen; oturum satırları da `session_messages` tablosundadır                                                                                                                                                                                                                                                                                  |
| `retention` (mevcut, §18.6)           | `rs_retention_failures_total` son 24 sa'te arttı / 26 sa başarılı tur yok                                                                                          | mevcut | **P22 yolu kapsanır (kodda doğrulandı):** oturum mesaj sayımı ve join'li DELETE `anonymizeSessionBatch` içinde, firma adımı `try/catch`'inde → `rs_retention_failures_total{class}` artar, audit `retention.run {result:"fail"}`. Ayrıca `rs_retention_rows_total{kind="session_messages"}` silinen satırı sayar                                   |

`session-chat-internal` ayrıntısı (`deploy/ops/remote-watch.sh`): alan 38 = bütün `rs_session_chat_rejected_total` serileri (etiketsiz
sayaç ilk retten önce `… 0` yazar → **P22 server işareti**; yoksa server P22 öncesidir, kontrol yok), alan 39 = `{reason="internal"}`
(seri yoksa 0). Tasarımdaki "5 dk'da > 0" timer 10 dk olduğu için "son turdan beri artış" olur; alarm artıştan sonra 1 sa sürer (ilk
P22 turunda taban 0 → açılıştan beri birikmiş hata da alarm verir; sayaç yeniden başlamada sıfırlanır). Durum: `state` dosyasında
`chat_internal=<son değer> <artış anı>`. Eşik ayarı yok (> 0). Betik değişti → `cd /opt/remote/deploy/ops && ./remote-watch.sh install`
(ikinci yığında ayrıca `install stg`). Yerel test: `deploy/ops/test-watch.sh` (P22 senaryoları + ayrıştırma + `rs_session_chat_*` ad
eşlemesi `apps/server/src/ops/metrics.ts`'e karşı).

**Prova (ana oturum dağıtımında; DENENMEDİ):** (1) `install` sonrası `systemctl start remote-watch.service` → `status.prom`'da
`check="session-chat-internal"} 1`. (2) Gerçek hata üretmeden betik yolu: `sed -i '/^chat_internal=/d' /var/lib/remote-watch/state;
echo "chat_internal=0 $(( $(date +%s) - 60 ))" >> /var/lib/remote-watch/state` → servis koşusu `ALERT check=session-chat-internal`
ve alarm komutu (WhatsApp/e-posta) gelir → satırı `chat_internal=0 0` yapıp yeniden koş → `DUZELDI session-chat-internal`.
İkinci yığında durum dizini `/var/lib/remote-watch/stg/`.

**Legacy oranı (eski istemci izleme; P22-G yayınından sonra haftalık, K-P22-15 tarihine kadar).** Audit tabanlı (yeniden başlamada
sıfırlanmaz); payda AGENT (yerel istemci) modunda kabul edilen oturumlar:

```bash
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_MIGRATOR_PASSWORD" mysql -umigrator -t "$MYSQL_DATABASE" -e "
SELECT DATE(s.created_at) AS gun, COUNT(*) AS agent_oturum, COUNT(a.entity_id) AS eski_istemci,
       ROUND(100 * COUNT(a.entity_id) / COUNT(*), 1) AS yuzde
FROM support_sessions s
LEFT JOIN (SELECT DISTINCT tenant_id, entity_id FROM audit_logs
           WHERE action = \"session.chat_legacy\" AND created_at >= UTC_TIMESTAMP() - INTERVAL 15 DAY) a
  ON a.tenant_id = s.tenant_id AND a.entity_id = s.id
WHERE s.mode = \"AGENT\" AND s.created_at >= UTC_TIMESTAMP() - INTERVAL 14 DAY
GROUP BY gun ORDER BY gun"'
```

Beklenen: P22-G yayınından sonra yüzde hızla düşer (yeni indirmeler 0.21.0); kalıcı yüksek oran → kayıtlı/tepsi istemcileri
(P20, kendini güncellemez) — firmalara güncelleme duyurusu. Hızlı bakış: `rs_session_chat_legacy_sessions_total` artışı /
aynı dönemdeki kabul edilen oturumlar.

### 29.6 Migration durdu, geri alma

- **`P22_PRECHECK dup_session_client=<n>`** (adım 2): hiçbir şey değişmemiştir. Normalde 0 (P22 öncesi oturum satırı yok). Düzeltme
  db-notlari "P22 → Ön kontrol ve geri alma" (yinelenenleri incele, fazlaları migrator ile sil) → `docker compose run --rm migrate
pnpm --filter @remote/server exec prisma migrate resolve --rolled-back 20261126000000_p22_session_chat` → `docker compose up -d`.
- **Tercih sırası:** ileri düzeltme > yalnız imaj > imaj + `down.sql`. **P22-G (0.21.0) yayımlandıysa sunucu geri alınmaz** (yeni
  istemci eski sunucuda onay satırı bulamaz → kullanılamaz); ileri düzeltilir.
- **Yalnız imaj** (`IMAGE_TAG=<önceki>` → `up -d`): eski kod UQ'lu şemada çalışır. **Dikkat:** oturum sohbeti satırı yazılmışsa eski
  saklama kodu anonimleştirmede bu satırları **silmez**; `session_messages.(session_id, tenant_id)` FK'si RESTRICT olduğundan P16
  kalıcı silme bu oturumlarda FK ile reddedilir (`retention` alarmı). Geri alma birkaç günü aşacaksa ileri düzeltme tercih edilir.
  Yayımlanmış aydınlatma metni sürümü kalır (eski kod da güncel sürümü okur; metin paragrafı eski kodda da doğru bilgi verir).
- **İmaj + `down.sql`:** önce imaj geri alınır (UQ'suz P22 kodu yeniden gönderimde çift satır üretir), sonra
  `docker compose run --rm migrate pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261126000000_p22_session_chat/down.sql`
  — yalnız UQ DROP (INPLACE), veri silinmez.

### 29.7 Anahtar emekliliği ve açık işler

- **`crypto:check-retire <ver>` oturum satırlarını da sayar** (kodda doğrulandı: `apps/server/src/cli/crypto.ts` `SELECT COUNT(*) FROM
session_messages WHERE ASCII(body_enc) = <ver>` — `request_id`/`session_id` süzgeci yok). `crypto:rewrap session_messages` oturum
  satırlarını da taşır (AAD `request_id ?? session_id`). §25.5 prosedürü aynen geçerlidir; ek adım yok.
- Yedek: yeni tablo yok; sohbet mevcut şifreli DB yedeğinde, geri yüklemede anahtar halkası gerekir (§25.5, §18.4).
- **DENENMEDİ (ana oturum dağıtımında prova):** §29.1 adım 4 seed provası (ikinci koşu 0) ve §29.5 alarm provası.

### 29.8 İstemci 0.21.0 (P22-G) yayın notu (teknik-yazar P22-GW, 2026-11-19; mimari-p22 §9, §10.2, §13)

Bu bölüm talimattır. **Staging durumu (2026-11-19):** 0.21.0 ayrıca yayımlanmadı; P22-G içeren 0.22.0 (Windows doğrudan teslim, macOS/Linux/servis `--dir`) `1d706ce` ile çıktı (§8). Sunucu tarafı sohbet dumanı protokol düzeyinde GEÇTİ; her platformun GUI dumanı elle (kullanıcı). Yayın komutları değişmedi, yalnız `VER=0.21.0`:
Windows §28a.5 (istemci exe, §24.4 Release), macOS §28f.4 (`publish-mac.sh`), Linux §28g.5 (`publish-linux.sh`). Yeni env,
migration, bağımlılık ve Caddy değişikliği yok.

- **Ön koşul:** P22 sunucu+web (§29.1) aynı yığında çalışıyor ve `POST /api/v1/public/sessions/resolve` ve `/public/requests/tenant`
  yanıtı `chatRetentionDays` taşıyor. Yoksa 0.21.0 karşılamada ve Windows talep formunda "Sunucu güncel değil; lütfen daha sonra
  deneyin" gösterir, **Bağlan** / **Destek iste** pasif kalır → istemci kullanılamaz.
- **Sıra:** sunucu önce (§29.1), istemci sonra. Prod'da öneri §29.3: ikisi aynı bakım penceresinde.
- **Geri alma:** 0.21.0 yayımlandıktan sonra sunucu **geri alınmaz**, ileri düzeltilir (§29.6, mimari-p22 §13). Sorun istemcideyse
  yalnız istemci önceki sürüme döner (Windows §11.4 / §24.5, macOS §28f.5, Linux §28g.7); 0.20 istemcide oturum sohbeti yine kapalı kalır (§29.3).
- **Duman (her platform):** Hızlı Destek ile katıl → karşılamada **Bağlan**'ın üstünde "Sohbet mesajları kayıt altına alınır ve
  N gün saklanır" (N = firmanın saklama süresi) → oturumda iki yönlü mesaj; konsolda "Müşterinin istemcisi eski…" **çıkmamalı**.
  Windows'ta firma dosyasıyla talep formunda aynı satır **Destek iste**'nin üstünde. Oturum sonunda audit `session.chat_summary`
  sayısı mesaj sayısına eşit; 0.21.0 oturumunda `session.chat_legacy` yazılmamalı.
- **İzleme:** §29.5 legacy oranı 0.21.0 yayınından sonra düşmeli. K-P22-15 tarihini (§29.3) 0.21.0 **prod** yayın günüyle doldurun.
- §8 yayın geçmişine her platform için sürüm ve SHA-256 yazılır.

## 30. P21 — müşteri portalı (devops K7, 2026-11-18; mimari-p21 r2 §7, §8, §9, §11 K7, §13 R-P21-6/7, §14 S-P21-4; ADR-0039; AC-262)

Kapsam: Admin, müşteri firması kişisine **portal hesabı** açar (geçici şifre 72 sa, ilk girişte değişim, isteğe bağlı TOTP). Portal
kullanıcısı `/portal/login?tenant=<slug>` ile girer, kendi müşterisinin taleplerini/oturumlarını görür, yeni talep açar (P19 web talep
akışının aynısı; firma web formu kapalı olsa da çalışır — R-P21-1), firma dosyasını indirir. Kimlik panelden **tamamen ayrıdır**:
`portal_users`, `portal_sessions`, çerezler `__Host-rs_portal` / `__Host-rs_portal_csrf` / `rs_portal_tenant` (yalnız slug).

**Yeni env değişkeni yok** (`.env.example`, `env.ts`, compose değişmedi): bağlantılar `PUBLIC_BASE_URL`, TOTP sırrı
`APP_ENCRYPTION_KEYS`, Origin denetimi `ALLOWED_ORIGINS` (mevcut). **Yeni bağımlılık yok.** Migration: `20261127000000_p21_customer_portal`
(yalnız ekleyen; iki tablo, mevcut tablolarda sütun değişikliği yok, tetikleyici yok — toplam 23). Sabitler
`packages/contracts/src/api/portal.ts`: müşteri başına en çok 20 hesap, müşteri başına 10 talep/sa (tüm hesaplar), portal yolunda müşteri
başına en çok 3 bekleyen talep, geçici şifre 72 sa, oturum 8 sa. Değiştirmek kod değişikliği + yayın gerektirir.

### 30.1 Ters vekil ve CSP — değerlendirildi, değişiklik yok

- **Caddy:** `/portal/*` sayfaları "diğer her şey → web", `/api/v1/portal/*` mevcut `handle /api/*` → server yolundadır; yeni `handle`,
  gövde sınırı ya da yol gerekmez (portal talebi 8 KB `bodyLimit` server'da; Caddy `@notUpload` 2 MB üst sınırı yeter).
- **Log (G-10):** iki log bloğu sorgu dizesini siler (`?tenant=<slug>` loga girmez), `Cookie` başlığını siler (portal çerezleri dahil).
  Portal yollarında sır taşıyan yol parçası yok (`/portal/requests/<id>` kimlik, sır değil) → yeni maske gerekmez.
- **CSP / Permissions-Policy:** uygulama üretir (`apps/web/proxy.ts`; r2 S-P21-12 `/portal` için `display-capture=()`). Caddy başlıklara
  dokunmaz (`?` ile yalnız eksikse tamamlar). Host nginx (`location /` tek blok) değişmez. `deploy/test-caddy.sh` değişmedi.

### 30.2 Migration uygulama (staging/prod yayını)

Sıra §8 / §25.2 akışıdır (ön yedek → `git pull` → `IMAGE_TAG` → `docker compose build && docker compose up -d`). `migrate` servisi
`migrator` ile `prisma migrate deploy` + `prisma/sql/grants.sql` çalıştırır; başarısızsa server başlamaz.

```bash
cd /opt/remote/deploy                                  # ikinci yığın: /opt/remote-stg/deploy
docker compose logs --since 10m migrate | grep -E 'p21_customer_portal|All migrations|No pending'
# beklenen: "Applying migration `20261127000000_p21_customer_portal`" ve "All migrations have been successfully applied."
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_MIGRATOR_PASSWORD" mysql -umigrator -N "$MYSQL_DATABASE" -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (\"portal_users\",\"portal_sessions\")"'
# beklenen: 2
```

Kilit yok (yalnız yeni boş tablolar + FK; `tenants`/`customers` yeniden yazılmaz) → bakım penceresi gerekmez.

**grants.sql'i yeniden yüklemek** (yetki sapması şüphesinde ya da elle `down.sql` sonrası yeniden ileri gidişte; idempotent):

```bash
docker compose run --rm migrate pnpm --filter @remote/server exec prisma db execute --file prisma/sql/grants.sql
```

**Yetki sınırı denetimi** (§6; parola komut satırına/ekrana yazılmaz, alt kabukta okunur):

```bash
( set -a; . ./.env; set +a; APP_PW=$MYSQL_APP_PASSWORD CONTAINER=$(docker compose ps -q mysql) DB=$MYSQL_DATABASE bash mysql/check-app-grants.sh ) | tail -3
# beklenen: FAILED=0. P21 ile PASS sayısı 873 -> 929 (56 yeni denetim: portal yaşam döngüsü, Admin sıfırlama, firma silme,
# 8 sütun reddi, DDL reddi, UQ / çapraz firma FK / silme sırası, her CHECK). Sayı farklıysa dur, docs/db-notlari.md "P21"e bak.
```

Not: staging'de panelden kaydedilmiş `system_settings.clamav` satırı varsa 2 ortamsal FAIL (`Duplicate entry`) görülebilir (§8 P28u
satırı) — yetki ihlali değildir; başka FAIL varsa yayın durdurulur.

### 30.3 Staging doğrulama (koordinatör uygular; sıra bağlayıcı)

Ön koşul: P21 qa GEÇTİ + güvenlik Kritik/Yüksek 0; `ci` yeşil (test-watch dahil). Hesaplar: K9 staging Admin (ACCESS.txt), demo firma.

1. §30.2 migration + `check-app-grants` (929, `FAILED=0`) + `systemctl start remote-backup.service` → `audit-continuity ok`.
2. İzleme: `cd /opt/remote/deploy/ops && ./remote-watch.sh install` (ikinci yığında ayrıca `install stg`) →
   `systemctl start remote-watch.service; journalctl -u remote-watch -n 5` → `OK`; `grep portal /var/lib/remote-watch/status.prom` →
   `check="portal-login-fail"} 1`, `portal-locked`, `portal-request-reject` (üçü de 1).
3. Metrik sözleşmesi (server P21 kodu yayında):
   ```bash
   docker compose exec -T server node -e "fetch('http://127.0.0.1:3001/metrics',{headers:{authorization:'Bearer '+process.env.METRICS_TOKEN}}).then(r=>r.text()).then(t=>console.log(t.split('\n').filter(l=>/^rs_portal_/.test(l)).join('\n')))"
   ```
   → `rs_portal_login_total` (ilk girişten önce etiketsiz `… 0`), `rs_portal_locked_total`, `rs_portal_requests_total`,
   `rs_portal_sessions_active`. Biri yoksa portal alarmları sessiz kalır → backend'e bildir (§30.5 sözleşme).
4. Panel (Admin) → Müşteriler → bir müşteri → "Portal hesapları" → hesap aç (ad, e-posta) → geçici şifre **bir kez** gösterilir;
   audit `portal.account_created`. Liste "İlk girişte şifre değişecek" + 72 sa rozeti.
5. Gizli pencerede `https://<host>/portal/login?tenant=<firma-slug>` → firma logosu; geçici şifreyle giriş → zorunlu şifre değişimi →
   portal ana sayfası. Çerezler (DevTools → Application): `__Host-rs_portal` (HttpOnly, Secure, Path=/), `__Host-rs_portal_csrf`,
   `rs_portal_tenant`; **`__Host-rs_session` yok**. Slugsuz `/portal/login` → "bağlantıyı firmanızdan isteyin" metni.
6. Başlıklar: `curl -sk -D- -o /dev/null "https://<host>/portal/login?tenant=<slug>" | grep -iE 'content-security-policy|permissions-policy|cache-control'`
   → CSP var, Permissions-Policy içinde `display-capture=()`, `no-store`.
7. Yeni talep (portal "Yeni talep") → 201 → bekleme odası; panelde talep `source=WEB`, audit `request.created` `via:"portal"`.
   Firmanın web formu **kapalıyken** de çalışır; `/r/<ref>` o sırada 404 kalır.
8. Çapraz kabul yok: portal çereziyle `GET /api/v1/auth/me` → 401; panel oturumuyla `/api/v1/portal/me` → 401.
9. Kilit: yanlış şifreyle 5 deneme (aynı e-posta+IP) → 6.'da 423 / genel hata; `rs_portal_login_total{result="fail"}` arttı,
   audit `portal.login` `fail`. 15 dk sonra (ya da Admin "Şifreyi sıfırla") açılır.
10. TOTP: portal "Hesabım" → TOTP kur (QR sunucuda üretilir) → etkinleştir → çıkış → giriş kod ister (403 `MFA_REQUIRED` → kod alanı).
11. Admin "Pasife al" → portal oturumu bir sonraki istekte 401; "Etkinleştir" ile geri. Admin "Şifreyi sıfırla" → TOTP kapanır,
    tüm portal oturumları iptal, yeni geçici şifre.
12. Caddy log: `docker compose logs --since 15m caddy | grep -c 'tenant='` → **0** (sorgu dizesi yok).
13. §8 yayın geçmişine satır: tarih, P21, commit, migration `20261127000000_p21_customer_portal` uygulandı, env "yok",
    `check-app-grants` 929/929.

### 30.4 Portal hesabı sorun giderme (Admin işlemleri)

| Belirti                                                  | Neden / eylem                                                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| "Hesap geçici olarak kilitlendi" (423)                   | 1 sa'te 20 hatalı → 15 dk kilit (ya da e-posta+IP 15 dk'da 5). Bekle ya da Admin "Şifreyi sıfırla" (yeni geçici şifre)    |
| "Geçici şifrenizin süresi doldu" (401)                   | 72 sa geçti (S-P21-5); panelde "süre doldu" rozeti → Admin "Şifreyi sıfırla"                                              |
| TOTP cihazı kayboldu                                     | Kurtarma kodu yok (K-P21-5). Admin "Şifreyi sıfırla" = yeni geçici şifre + TOTP kapatma + tüm portal oturumlarının iptali |
| E-posta değişmeli                                        | E-posta güncellenemez (DB yetkisi de yok). Eski hesap pasife alınır, yeni e-postayla yeni hesap açılır                    |
| "Bu e-posta bu firmada kullanılıyor" ama hesap pasif     | Pasif hesap `retention_days` boyunca adresi tutar (R-P21-7): aynı kişi için "Etkinleştir"; anında silme gerekiyorsa §30.7 |
| Giriş sayfası "bağlantıyı isteyin" diyor                 | URL'de `?tenant=<slug>` yok; Admin portal bağlantısını (panelde kopyala) müşteriye iletir                                 |
| Portal talebi "Bekleyen talepleriniz var" (`QUEUE_FULL`) | Müşterinin 3 bekleyen talebi var (`QUEUE_FULL`); teknisyen kabul edince açılır                                            |
| Portal talebi 429                                        | Müşteri başına 10 talep/sa (tüm hesaplar toplamı). Tekrarlıyorsa kötüye kullanım → §30.5 `portal-request-reject`          |

### 30.5 Metrikler ve alarmlar (`remote-watch`, 10 dk; eşikler `deploy/ops/remote-watch.sh`, mimari-p21 §9)

| Metrik                                                                      | Tür      | Anlam                                                        |
| --------------------------------------------------------------------------- | -------- | ------------------------------------------------------------ |
| `rs_portal_login_total{result="success"\|"fail"\|"locked"\|"mfa_required"}` | sayaç    | Portal giriş sonuçları (mimari §9)                           |
| `rs_portal_locked_total`                                                    | sayaç    | Hesap/ikili kilide düşen girişler                            |
| `rs_portal_requests_total{result}`                                          | sayaç    | Portal talep ucu sonuçları (S-P21-4)                         |
| `rs_portal_sessions_active`                                                 | gösterge | Etkin portal oturumu (saklama işinde güncellenir); alarm yok |

**Sözleşme (backend K3 — betik bu değerlere bakar):** sayaçlar `apps/server/src/app-routes.ts`'te etiketsiz kayıtlıdır
(`app.metrics.counter(...)`; ilk olaydan önce `… 0` yazılır — alarmların "P21 server" işareti `rs_portal_login_total`'dır), gösterge
`jobs/retention.ts`'te. `rs_portal_login_total` etiketleri `result` (+ fail'de `reason`); betik `result="fail"`'i etiket sırasından
bağımsız sayar. `rs_portal_requests_total{result}` bugün `created` ve `rate_limited` (müşteri kovası 429) yazar; betik `rate_limited` ve
ileride eklenirse `queue_full`'u (`QUEUE_FULL`) sayar. Başka ad kullanılırsa `portal-request-reject` sessiz kalır.
`deploy/ops/test-watch.sh` ad eşlemesi betikteki her `rs_portal_*` adının `apps/server/src`'de `counter("…")`/`gauge("…")` ile kayıtlı
olmasını zorunlu kılar (etiket değerini denetlemez).

Server P21 öncesiyse (`rs_portal_login_total` yok) üç kontrol de değerlendirilmez. Betik değişti → `cd /opt/remote/deploy/ops &&
./remote-watch.sh install` (ikinci yığında `install stg`). Eşikler watch.env'den (`watch.env.example`).

| Kontrol                 | Koşul                                                                                                                                       | Düzey  | Eylem                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `portal-login-fail`     | 10 dk'da `rs_portal_login_total{result="fail"}` artışı **≥ 200** (`WATCH_PORTAL_LOGIN_FAIL_MAX`; mimari §9 "dağıtık doldurma")              | Yüksek | Kimlik doldurma saldırısı. `docker compose logs --since 30m server \| grep portal_login` → `reason` dağılımı ve IP'ler (log; e-posta yazılmaz). Audit süzgeci `portal.login` + `fail` → hedef firma/hesaplar. Tek IP/önek → `request_blocks` / pfSense'te engel; çok firmaya yayılıyorsa ilgili firmaların Admin'ine bildirim + hesap sahiplerine TOTP önerisi. Kovalar (IP 20/dk, hesap 20/sa) çalışıyor olmalı — 429/423 oranı düşükse güvenliğe bildir |
| `portal-locked`         | 1 sa'te `rs_portal_locked_total` artışı **> 10** (`WATCH_PORTAL_LOCKED_MAX`; devops varsayılanı, mimaride sayı yok)                         | Uyarı  | Hedefli kaba kuvvet ya da müşterinin şifreyi unutması. Audit `portal.locked` → hangi hesaplar/firma. Aynı hesap tekrar tekrar → Admin'e "Şifreyi sıfırla" + TOTP önerisi; çok hesap → `portal-login-fail` ile birlikte değerlendir                                                                                                                                                                                                                        |
| `portal-request-reject` | 1 sa'te `rs_portal_requests_total{result="rate_limited"\|"queue_full"}` artışı **> 20** (`WATCH_PORTAL_REQ_REJECT_MAX`; devops varsayılanı) | Uyarı  | Ele geçirilmiş / kötü niyetli portal hesabıyla kuyruk doldurma (P12). Audit `request.created` `via:"portal"` + `rateAudit` → hesap; firma Admin'i hesabı **pasife alır** (oturumlar anında iptal). Tekrarında güvenliğe bildir                                                                                                                                                                                                                            |

Bu üç sayaç süreç yeniden başlayınca sıfırlanır; betik düşüşü yeni değer kadar artış sayar (diğer P2x alarmlarıyla aynı).

### 30.6 Geri alma (R-P21-6 — sıra bağlayıcı)

**Neden sıra önemli:** eski (P21 öncesi) kod portal tablolarını bilmez; firma silme (P16) eski kodda `portal_*` satırlarına FK RESTRICT
ile takılır (1451 → silme işi `FAILED`). `down.sql` ise tablolarda satır varken hiçbir şey değiştirmeden **3819**
(`p21_down_guard_chk`) ile durur. Bu yüzden: P21 kodu durur → portal satırları (karar kaydıyla) boşaltılır → ters migration → eski imaj.

1. **Ön yedek** (§18; `systemctl start remote-backup.service` → `audit-continuity ok`) + `.env` yedeği.
2. **P21 kodunu durdur** (yeni portal hesabı/oturumu yazılmasın): `docker compose stop server web`. (Kesinti başlar.)
3. **Portal verisi kararı.** Sayım: `docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_MIGRATOR_PASSWORD" mysql -umigrator -N "$MYSQL_DATABASE" -e "SELECT (SELECT COUNT(*) FROM portal_users),(SELECT COUNT(*) FROM portal_sessions)"'`.
   İkisi de 0 → adım 4. Değilse: hesaplar müşteriye ait kişisel veri + erişim hakkıdır, **sessizce silinmez** — karar (kim, neden, tarih)
   yayın geçmişine yazılır; ardından:
   `docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_MIGRATOR_PASSWORD" mysql -umigrator "$MYSQL_DATABASE" -e "DELETE FROM portal_sessions; DELETE FROM portal_users;"'`
   (sıra: oturum → hesap; ters sıra 1451). Audit izi (`portal.*`, `entity=portal_users`) `audit_logs`'ta 730 gün kalır; yedekte hesaplar durur.
4. **Ters migration** (migrator; grants REVOKE + iki tablo DROP + `_prisma_migrations` satırı):
   `docker compose run --rm migrate pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261127000000_p21_customer_portal/down.sql`
   → "Script executed successfully". 3819 görülürse adım 3 eksik kaldı (P21 kodu durdurulmadan yeni satır mı yazıldı?), hiçbir şey değişmedi.
5. **Eski imaj:** `.env` `IMAGE_TAG=<P21 öncesi>` → `docker compose up -d` (eski `migrate` eski `grants.sql`'i yükler — portal satırı içermez).
6. Doğrula: `check-app-grants.sh` → P21 öncesi sayı (873), `FAILED=0`; `/login` 200; bir panel girişi; `remote-watch` → `OK`
   (portal kontrolleri kaybolur — server işareti yok).

**Hızlı kapatma (geri almadan):** ilgili firmalarda Admin portal hesaplarını pasife alır (oturumlar anında iptal). Kod yerinde kalır.

**Tablolar kalsın yolu (yalnız acil):** P21 kodu geri alınır, `down.sql` çalıştırılmaz. Yalnız portal tabloları **boşsa** güvenli;
satır varsa eski kodda o firmaların silinmesi `FAILED` olur (önce adım 3). Eski imajın `migrate deploy`'u veritabanında bilinmeyen
uygulanmış kayıtla karşılaşır — bu yol **DENENMEDİ**; ana yol (1–6) tercih edilir.

**Prova (2026-11-18, yerel `rs-p21-test`, mysql 8.4.13):** dolu tabloda `down.sql` → 3819, tablolar kaldı; hesap oturumdan önce silinince
1451; tablolar boşken `down.sql` → tablolar, `tables_priv`/`columns_priv` portal satırları ve migration kaydı 0; ardından `db:migrate`
(migration + grants.sql) ile yeniden ileri gidiş ve `check-app-grants.sh` (sonuç `docs/implementation.md` "P21 — K7"). Staging dökümünde
denenmedi.

### 30.7 KVKK anlık silme talebi — tek portal hesabı (R-P21-7; elle SQL)

Panelde portal hesabı silme düğmesi **yok** (pasif hesap `retention_days` sonra 03:30 saklama işiyle silinir). İlgili kişi KVKK m.7
kapsamında **anında** silme isterse:

1. Talep yazılı alınır, kimlik doğrulanır, talep numarası verilir (`<TALEP_NO>`).
2. Firma Admin'i panelden hesabı **Pasife al**ır (oturumlar iptal). Super Admin hesabın `<TENANT_ID>` ve `<PORTAL_USER_ID>` değerlerini
   panelden (müşteri → Portal hesapları; adres çubuğu/ayrıntı) ya da aşağıdaki salt okunur sorguyla bulur:
   `SELECT id, tenant_id, status, passive_at FROM portal_users WHERE tenant_id='<TENANT_ID>' AND email='<e-posta küçük harf>';`
3. Ön yedek (§18). Aşağıdaki blok `app` kullanıcısıyla çalıştırılır (yetkisi yalnız SELECT/INSERT/DELETE; tek işlem). Yalnız **PASSIVE**
   hesabı siler (aktif hesapta 0 satır, audit yazılmaz); oturum → hesap sırası; audit `portal.account_deleted` (`username=system:runbook`,
   `new_value.reason=kvkk_manual`) aynı işlemde yazılır:

```sql
-- KVKK-BASLA (runbook §30.7; <TENANT_ID>, <PORTAL_USER_ID>, <TALEP_NO> değiştirilir)
START TRANSACTION;
SELECT id, status FROM portal_users WHERE id = '<PORTAL_USER_ID>' AND tenant_id = '<TENANT_ID>' FOR UPDATE;
DELETE s FROM portal_sessions s JOIN portal_users u ON u.id = s.portal_user_id AND u.tenant_id = s.tenant_id
 WHERE u.id = '<PORTAL_USER_ID>' AND u.tenant_id = '<TENANT_ID>' AND u.status = 'PASSIVE';
DELETE FROM portal_users WHERE id = '<PORTAL_USER_ID>' AND tenant_id = '<TENANT_ID>' AND status = 'PASSIVE';
SET @p21_kvkk_n = ROW_COUNT();
INSERT INTO audit_logs (tenant_id, user_id, username, action, entity, entity_id, new_value, result)
SELECT '<TENANT_ID>', NULL, 'system:runbook', 'portal.account_deleted', 'portal_users', '<PORTAL_USER_ID>',
       JSON_OBJECT('reason', 'kvkk_manual', 'ticket', '<TALEP_NO>'), 'success' FROM DUAL WHERE @p21_kvkk_n = 1;
SELECT @p21_kvkk_n AS silinen_hesap;
COMMIT;
-- KVKK-BITIR
```

Çalıştırma (`deploy/` içinde; blok bir dosyaya kaydedilip yer tutucular doldurulur, parola konteyner ortamından):
`docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_APP_PASSWORD" mysql -uapp "$MYSQL_DATABASE"' < kvkk-portal.sql` →
`silinen_hesap 1`. `0` ise hesap aktif ya da kimlikler yanlış — hiçbir şey silinmedi.

4. **Kalanlar (kişiye bildirilir):** `audit_logs` satırları (`username` = e-posta, 730 gün; değiştirilemez — ADR-0025) ve gece yedekleri
   (14 g + site dışı) saklama süresince kalır; açılan talepler müşteri firmasının kaydıdır (müşteri anonimleştirmesi ayrı süreç, §23).
   `audit_logs`'a elle UPDATE/DELETE yapılmaz (tetikleyici reddeder).
5. Aynı e-posta artık o firmada yeniden kullanılabilir.

### 30.8 Anahtar emekliliği — portal TOTP sırrı (`crypto:check-retire` kapsam dışı)

`portal_users.totp_secret_enc`, `APP_ENCRYPTION_KEYS` halkasının o anki sürümüyle (ilk bayt = sürüm) ve ayrı AAD etiketiyle (S-P21-9)
şifrelenir. `crypto:check-retire <ver>` bugün bu sütunu **saymaz** (panel `users.totp_secret_enc` gibi; §14 P10 "Anahtar rotasyonu").
Bir sürümü halkadan çıkarmadan önce §25.5 adım 1'e **ek olarak**:

```bash
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_MIGRATOR_PASSWORD" mysql -umigrator -N "$MYSQL_DATABASE" -e "SELECT COUNT(*) FROM portal_users WHERE totp_secret_enc IS NOT NULL AND ASCII(totp_secret_enc) = <ver>"'
# 0 olmalı. >0 ise sürüm çıkarılmaz: ilgili portal kullanıcıları TOTP'yi kapatıp yeniden kurar ya da Admin "Şifreyi sıfırla" (TOTP sıfırlanır).
```

Rewrap yoktur. Erken çıkarılırsa o portal kullanıcıları TOTP'li giriş yapamaz (Admin "Şifreyi sıfırla" ile kurtarılır).
**backend-dev notu:** `apps/server/src/cli/crypto.ts` `countAllByVersion`'a `"portal_users.totp_secret_enc"` sayımı eklenirse bu elle
adım kaldırılır (P10 `users.totp_secret_enc` için de aynı açık var).

### 30.9 Yedek

Mevcut gece yedeği iki tabloyu kapsar (şifreli döküm; kişisel veri: e-posta, ad, IP, user agent; `totp_secret_enc` AES-GCM).
Geri yükleme provası değişmez; geri yüklenen DB'de portal oturumları 8 sa içinde kendiliğinden düşer.

## 31. P29 — istemci otomatik güncelleme: anahtar, imza, yayın, alarm (devops K6, 2026-11-19; mimari-p29 r2 §9, §11 K6, §14; ADR-0040; AC-470..472, 486, 489, 492)

Güncelleme kanalının bütünlüğü kendi Ed25519 manifest imzamıza dayanır. Platform imzası (SignPath/Apple) yoktur. **Manifest
anahtarı, bütün gözetimsiz servislerde SYSTEM olarak kod çalıştırma yetkisi demektir.** Bu bölümdeki adımları atlamayın.

### 31.1 Parçalar

| Parça                                 | Yer                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Açık anahtarlar (gizli değil, repoda) | `apps/agent-win/build/update-keys/{prod,staging}.pub`: satır başına 1, en çok 2 (etkin + yedek)                                                        |
| Gömme                                 | `build/update-ldflags.sh` ← `build.sh` / `build-darwin.sh` / `build-linux.sh`, ortam değişkeni `UPDATE_ENV`                                            |
| Özel tohum (32 bayt, base64)          | Yalnız GitHub **ortam** secret'ı `UPDATE_SIGNING_KEY`. Yedek tohum çevrimdışı, iki kopya (kasa)                                                        |
| CI işleri (`agent-win.yml`)           | `update-signer` → `update-manifest` (etiket) / `update-manifest-stg` (main dispatch) / `update-resign-prep` → `update-resign` → `update-resign-upload` |
| Yayın                                 | `deploy/agent/publish-manifest.sh` + `verify-manifest.mjs` (Node, Go'dan bağımsız doğrulayıcı)                                                         |
| Sunucu                                | `.env` `UPDATE_MANIFEST_PUBKEYS`; compose bu doluysa `UPDATE_MANIFEST_DIR=/data/downloads/update` verir                                                |
| Alarm                                 | `remote-watch`: `update-rejected-device`, `update-rejected-client`, `update-manifest-expiry`, `update-manifest-missing`                                |

Anahtar yoksa güvenli varsayılan geçerlidir. `.pub` dosyası yoksa ikililer **güncelleyici kapalı** derlenir; build log'unda
`update-ldflags: UYARI` görünür. `UPDATE_SIGNING_ENABLED` tanımsızsa imza işleri "skipped" olur ve Release manifestsiz çıkar.
`UPDATE_MANIFEST_PUBKEYS` boşsa sunucu hiçbir manifest sunmaz. Hiçbir durumda imzasız güncelleme kurulmaz.

Manifest dosyaları ikili başına birer tanedir (K-P29-2): `update-client-windows-amd64.json`, `update-client-macos-universal.json`,
`update-client-linux-amd64.json`, `update-service-windows-amd64.json`. Her birinin yanında `<ad>.json.sig` bulunur.
Geçerlilik süresi istemci manifestinde 30 gün, servis manifestinde 90 gündür.

### 31.2 Anahtar üretimi (bir kez, ortam başına; çevrimdışı)

Gerçek anahtar **yalnız bu adımla**, internete bağlı olmayan bir makinede üretilir. Ajanlar ve CI anahtar üretmez.

1. Çevrimdışı makinede repo kopyası ve Go 1.26 (GO_IMAGE ile aynı sürüm) bulunur. Her ortam için **iki** çift üretin.
   `keygen` çıktısı iki satırdır: `UPDATE_SIGNING_KEY=<tohum, base64 32 bayt>` ve `PUBLIC_KEY=<b64url 43>`.
   ```sh
   cd apps/agent-win && umask 077
   for k in prod-etkin prod-yedek stg-etkin stg-yedek; do go run ./cmd/update-sign keygen > "$k.txt"; done
   for k in prod-etkin prod-yedek stg-etkin stg-yedek; do sed -n 's/^UPDATE_SIGNING_KEY=//p' "$k.txt" > "$k.seed"; done
   # denetim: tohumdan türeyen açık anahtar = PUBLIC_KEY satırı
   go run ./cmd/update-sign pubkey --key-stdin < prod-etkin.seed; grep PUBLIC_KEY prod-etkin.txt
   ```
2. Açık anahtar dosyalarını yazın. Önce etkin, sonra yedek anahtar gelir. Yorum satırı kullanılabilir:
   ```
   # prod — etkin (2026-11-19)
   <prod-etkin b64url-43>
   # prod — yedek (çevrimdışı)
   <prod-yedek b64url-43>
   ```
   Bu içerik `build/update-keys/prod.pub` dosyasına, staging çifti de `staging.pub` dosyasına girer.
   - Değişiklik PR ile `main`'e gelir; incelemede iki satırın üretim çıktısıyla aynı olduğu doğrulanır.
   - `sh build/update-ldflags.sh prod` biçimi denetler.
3. Tohumları yerleştirin:
   - **Etkin** tohum GitHub ortam secret'ına konur (§31.5):
     `tr -d '\n' < prod-etkin.seed | gh secret set UPDATE_SIGNING_KEY --env agent-update-sign` ve
     `tr -d '\n' < stg-etkin.seed | gh secret set UPDATE_SIGNING_KEY --env agent-update-sign-stg`.
     İmza adımı tohumu dolgulu/dolgusuz, std/url base64 olarak kabul eder; 32 bayta çözülmezse iş başarısız olur.
     Ham değer, std/url (dolgulu+dolgusuz) ve hex (küçük/büyük) varyantlarının hepsi `add-mask` ile maskelenir ve
     imzalayıcı çıktısı bu varyantlarla taranır (S-P29-K-1).
   - **Yedek** tohumlar iki ayrı çevrimdışı ortama (kasa / şifreli USB) konur. GitHub'a **konmaz**.
   - Diskteki kalanlar silinir: `shred -u *.seed *.txt`.
4. Sunucu `.env` dosyasına `UPDATE_MANIFEST_PUBKEYS=<etkin>,<yedek>` satırını yazın. Prod'a prod anahtarları, staging'e staging
   anahtarları girer; iki ortamı karıştırmayın. Ardından servisi yeniden yaratın ve değişkenleri kontrol edin:
   ```sh
   docker compose up -d --no-deps server
   docker compose exec server printenv UPDATE_MANIFEST_DIR UPDATE_MANIFEST_PUBKEYS
   ```
5. Bundan sonraki ilk derleme anahtarı gömer: build, ikilide anahtarı arar ve bulamazsa durur.
   **0.22.0 son elle kurulumdur** (R-P29-5). Anahtarsız derlenmiş ikililer kendini hiçbir zaman güncellemez.

**Durum (2026-11-19, staging `1d706ce`):** anahtar henüz üretilmedi (`update-keys/` yalnız README). Staging `.env` `UPDATE_MANIFEST_PUBKEYS`
boş, güncelleme ucu 204; 0.22.0 staging ikilileri anahtarsız (güncelleyici kapalı). Ajanlar anahtar üretmez; adım 1–4 kullanıcıda.

### 31.3 Rotasyon, sızıntı, kayıp

- **Planlı rotasyon (yılda bir) ya da şüpheli sızıntı:**
  1. Yedek tohum ortam secret'ına konur ve yeni etkin anahtar olur.
  2. Çevrimdışı makinede yeni bir yedek çift üretilir.
  3. `.pub` = {eski yedek (artık etkin), yeni yedek} olarak PR'la güncellenir.
  4. Yeni bir sürüm etiketlenir. Eski istemciler bu sürümü eski yedek anahtarla doğrular; yeni istemciler yeni yuvaları taşır.
  5. Sunucu `.env` `UPDATE_MANIFEST_PUBKEYS` = yeni çift yapılır; ardından server yeniden yaratılır.
- **Sızıntı** (tohum log'a düştü, `imza adımı çıktısında tohum biçimi bulundu` hatası, ortam ele geçirildi):
  1. **Hemen** sızan anahtarı prod ve staging `.env` `UPDATE_MANIFEST_PUBKEYS` değerinden çıkarın ve server'ı yeniden yaratın.
     Sunucu artık o anahtarla imzalı manifesti sunmaz.
  2. `publish-manifest.sh --withdraw all` çalıştırın.
  3. Rotasyon adımlarını uygulayın.
  4. GitHub'da ortam secret'ını silin; ortam ve etiket denetim günlüğünü inceleyin.
- **Kayıp** (iki tohum birden): otomatik güncelleme kanalı kapanır. Yeni anahtar çifti üretilir (§31.2). Yeni anahtarlı sürüm
  **elle** dağıtılır (servis: `--install` → `Update`; taşınabilir: indirme bağlantısı). Eski istemciler bu sürümü otomatik almaz.

### 31.4 Yayın sırası (her sürüm; AC-492; staging-önce kuralı, §14.1 m.6)

1. **Staging:** `main`'de `agent-win` iş akışını `server_url=https://stg.remote.noktabilisim.net`, `version=X.Y.Z` ile tetikleyin.
   İmza işi `update-manifest-stg` ortam onayı ister.
   - İkilileri yayınlayın: `verify-and-publish.sh --stg-run <id>`, `publish-servis.sh …`, `publish-linux.sh --stg-run <id>`.
   - Manifesti yayınlayın: `deploy/agent/publish-manifest.sh --stg-run <id> --ssh root@<sunucu>`.
   - Kendi test cihazlarımızda (servis + taşınabilir) kurulum + panel rozeti + audit `client.update.installed` görülür.
2. **24 saat bekleyin.** Bu süre içinde staging'de alarm, beklenmeyen davranış ya da beklenmeyen etiket/onay olmamalıdır.
   Bu kural, kötü niyetli bir yayını fark etmek için zaman kazandırır.
3. **Prod:** etiket `vX.Y.Z` → `approve` (agent-release) → imza/attest → `update-manifest` (agent-update-sign onayı) → Release.
   Release notunda `Güncelleme manifesti: var` yazmalıdır.
4. `UNATTENDED_MODE` `signed` ya da `unsigned-accepted` ise yeni servis SHA'sını listeye `publish-servis.sh --tag` (m.5) **ekler; elle
   eklemeyin** (remote-watch `unattended-list-unpublished` ALERT'i). Eskisini henüz çıkarmayın (§27.9 iki aşamalı geri çekme).
   Her `--tag` yayını listFingerprint'i değiştirir → remote-watch bir kez `ALERT unattended-mode-changed` gönderir: **beklenen**,
   yayın penceresiyle eşleşiyorsa olay değildir; eşleşmiyorsa §27.9 liste denetimi.
5. **Önce ikilileri** yayınlayın: `verify-and-publish.sh --tag`, `publish-servis.sh --tag`, `publish-linux.sh --tag`,
   (`publish-mac.sh --tag`). Sunucunun `*_SHA256` kapıları yeni sürüme geçer.
6. **Sonra manifesti** yayınlayın: `deploy/agent/publish-manifest.sh --tag vX.Y.Z --ssh root@<sunucu>`. Betik şunları denetler:
   - imza (repo `.pub` ile, sonra sunucuda hedefin kendi `UPDATE_MANIFEST_PUBKEYS` anahtarlarıyla),
   - kanonik biçim, `env=prod`, sürüm = etiket, kalan süre ≥ 1 g,
   - SHA256SUMS ve attestation (`--signer-workflow …/agent-win.yml --source-ref refs/tags/vX.Y.Z --cert-oidc-issuer
https://token.actions.githubusercontent.com`),
   - **manifest sha256 = sunucuda yayımlanmış ikilinin SHA'sı**; sürüm geri gidemez.

   Sıra karışırsa betik durur. Sunucunun kendi hash kapısı da manifesti sunmaz.

7. Panel → Gözetimsiz → sürüm dağılımında cihazların geçişini izleyin.

### 31.5 GitHub kurulumu (bir kez; S-P29-T-1 sertleştirmeleri)

- **Ortam `agent-update-sign`** (Settings → Environments):
  - Required reviewers: yayıncı. "Prevent self-review" açılabiliyorsa açın; tek kişilik ekipte açılamıyorsa bu durum risk
    kabulüne dahildir (§31.9).
  - **Allow administrators to bypass: KAPALI.**
  - Deployment branches and tags: **yalnız etiket `v*`**.
  - Secret: `UPDATE_SIGNING_KEY` (prod etkin tohum).
- **Ortam `agent-update-sign-stg`:** required reviewer, deployment branches = **yalnız `main`**, secret `UPDATE_SIGNING_KEY`
  (staging etkin tohum).
- **Repo/org secret'ı olarak `UPDATE_SIGNING_KEY` TANIMLAMAYIN** (yalnız ortam secret'ı olur).
- **Repo değişkenleri** (Settings → Variables):
  - `UPDATE_SIGNING_ENABLED=1` (prod imza işleri) ve `UPDATE_SIGNING_ENABLED_STG=1`. **Anahtar üretilmeden 1 yapılmaz**;
    `.pub` yoksa iş kırmızı olur.
  - İsteğe bağlı `UPDATE_MIN_UPDATER_VERSION` (varsayılan `0.22.0`; K-P29-15). Manifest biçimi kırılırsa yükseltilir.
- **Etiket ruleset'i** (mevcut, runbook §24/§28f.3): `v*` etiketlerini yalnız depo yöneticisi oluşturabilir; silme ve yeniden yazma
  yasaktır. Kontrol: `gh api repos/{owner}/{repo}/rulesets`.
- **Önerilir (zorunlu değil):**
  - GitHub hesabında donanım anahtarıyla 2FA.
  - Sunucu root SSH anahtarının parola ya da donanımla korunması.
  - Ortam onay geçmişinin ayda bir gözden geçirilmesi.

### 31.6 Yeniden imza (update-resign)

İstemci manifesti 30 gün, servis manifesti 90 gün geçerlidir. `update-manifest-expiry` alarmı en kısa manifestte 14 günden az kaldığında
gelir; istemci için bu, yayından yaklaşık 16 gün sonradır. Alarm gelince ya da her ay başında yeniden imzalayın:

```sh
gh workflow run agent-win.yml --ref vX.Y.Z -f resign_tag=vX.Y.Z      # koşu ETİKET ref'inde (ortam yalnız v*)
# update-resign (agent-update-sign) onayından sonra: Release'te manifest + .sig + SHA256SUMS --clobber ile yenilenir
deploy/agent/publish-manifest.sh --tag vX.Y.Z --ssh root@<sunucu>      # aynı sürüm, yeni tarih -> volume'a
```

`resign_tag` doluyken derleme ve test işleri koşmaz. Hazırlık işi yeni manifestleri üretir; `version`, `sha256`, `size`, hedef, `env` ve
`minUpdaterVersion` alanlarından biri eskisinden farklıysa iş kırmızı olur. Yalnız tarihler değişebilir.

Bir sürüm için güvenlik düzeltmesi yayınlandıysa, açıklı sürümün manifesti **bir daha yeniden imzalanmaz** (§14.5 T-7). Ayrıca
`MIN_AGENT_VERSION` düzeltme sürümüne yükseltilir (§31.7).

### 31.7 MIN_AGENT_VERSION sırası (K-P29-19, AC-486)

Güncelleme uçları `MIN_AGENT_VERSION` kapısından muaftır. Sıra şöyledir:

1. Yayınlayın (§31.4).
2. Panelde sürüm dağılımında cihazların ≥ %95'i yeni sürüme geçene kadar bekleyin. Güvenlik yamasında beklemeyin.
3. `.env` `MIN_AGENT_VERSION=X.Y.Z` yazın ve server'ı yeniden yaratın.
4. Kalan cihazlar "Asgari sürümün altında" rozetini alır; bunlar yine güncelleme bulabilir.
5. `UNATTENDED_SIGNED_SHA256` listesinden eski servis SHA'sını ancak bu noktadan sonra çıkarın (elle; §27.9 "Liste temizliği ve iki aşamalı geri çekme").

### 31.8 Alarmlar (remote-watch; `watch.env.example`)

| Kontrol                   | Koşul                                                                                 | Ne yapılır                                                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `update-rejected-device`  | `rs_agent_update_rejected_total{source="device"}` ≥ 1 artış (24 sa sürer)             | **Güvenlik olayı.** Audit → `client.update.failed` (neden). İmza/ortam reddi: sunucudaki manifest ve `.pub` eşleşmesi; bütünlük: volume'daki ikili SHA'sı ve `PUBLISHED.log`. Açıklanamıyorsa `publish-manifest.sh --withdraw all`, §31.3 |
| `update-rejected-client`  | 1 sa'te `source=binding\|anonymous` ret artışı ≥ `WATCH_UPDATE_REJECT_CLIENT_MIN` (3) | İstemci beyanıdır, doğrulanmamıştır (sahte olay seli olabilir). Server logunda kaynak IP'lere bakın; tasarımdaki "≥ 3 farklı IP" ayrımı metrikte yok                                                                                      |
| `update-manifest-expiry`  | En kısa manifest kalan süresi < `WATCH_UPDATE_EXPIRY_MIN_DAYS` (14) gün               | §31.6 yeniden imza                                                                                                                                                                                                                        |
| `update-manifest-missing` | `WATCH_UPDATE_MANIFEST_REQUIRED=1` iken hiç sunulabilir manifest yok                  | Süresi dolmuş olabilir (§31.6), geri çekilmiş olabilir ya da imza/SHA kapısı reddetmiş olabilir: `docker compose logs server \| grep -i manifest`. Ele geçirilmiş sunucuda "donma" belirtisidir                                           |

İlk prod manifest yayınından sonra `/etc/remote-watch/watch.env` dosyasına `WATCH_UPDATE_MANIFEST_REQUIRED=1` yazın.
Server açılışta geçersiz imzalı manifest bulursa log'a `warn` yazar; sunucu bu manifesti sunmaz.

### 31.9 Kabul edilen risk (S-P29-T-1, kullanıcı kararı 2026-11-19: "Tek imza, risk kabul")

Tek CI imzası kullanılıyor. Etiket itme, ortam onayı, Release ve sunucu erişimi aynı hesapta toplandığından, bu hesabın ele
geçirilmesi bütün gözetimsiz servislerde SYSTEM kod çalıştırma anlamına gelir. Risk yazılı olarak kabul edildi (ADR-0040 Sonuçlar,
R-P29-1).

Kalan sertleştirmeler:

- onaylı ortam secret'ı ve yönetici atlatmasının kapalı olması (§31.5),
- etiket ruleset'i,
- yedek anahtar ve rotasyon (§31.3),
- attestation kimliğinin sabit olması (§31.4 m.6),
- alarmlar (§31.8),
- **staging-önce 24 sa kuralı** (§31.4 m.2).

Genişleme noktası 2-of-2 imzadır (mimari §14.1). Kullanıcı isterse eklenir; manifest biçimi değişmez.

### 31.10 Acil durdurma ve geri alma (denenmiş: `deploy/agent/test-publish-manifest.sh` bölüm 3)

```sh
deploy/agent/publish-manifest.sh --withdraw client --ssh root@<sunucu>    # ya da service | all
```

Manifest volume'dan silinir ve istemciler ≤ 60 sn içinde "yayın yok" görür. Zaten kurulmuş sürüm geri alınmaz (V-P29-7); düzeltme
için daha yüksek bir sürüm yayınlanır. Yeniden açmak için §31.4 m.6 yeniden çalıştırılır. Sunucu kodunu geri almak (önceki imaj) eski
istemcilere zarar vermez (AC-493). Güncelleme uçları yoksa istemciler sessiz kalır.

### 31.11 Doğrulama komutları (yerel; sunucuya bağlanmaz)

`deploy/agent/test-publish-manifest.sh` 63 PASS. `deploy/test-caddy.sh`: `update/` alt yolu 404. `deploy/ops/test-watch.sh`: P29
alarmları. `apps/server/test/unit/p29-k6-env.test.ts`.

## 32. P31 — macOS Hızlı Destek'te "Destek iste": firma zip yolu, hız sınırı, yayın (devops P31-O, 2026-11-20; mimari-p31 §9, §15.1, §15.3, §15.4; AC-510, AC-520, AC-522)

Firma bağlantısı (`/api/v1/public/agent/request-download?ref=`) değişmez; Mac'te sunucu `Location: /downloads/NoktaDestek-<label>-<ref>.zip`
verir. Bu yol yeni Caddy bloğu `@agentZipFirm` ile **ayrı iç uç** `/internal/agent-ready/macos-firm`'den geçer (fail-closed). Yeni env yok;
migration P31-D'nin tek `ALTER`'ı (`migrate` servisi). İstemci 0.24.0 (sunucu ile aynı etiket).

### 32.1 Değişen dosyalar (devops)

| Dosya                                          | Değişiklik                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deploy/Caddyfile`                             | `@agentZipFirm` `^/downloads/(NoktaDestek-[A-Za-z0-9]{1,20}-[a-z2-7]{16})\.zip$` → `forward_auth` `uri /internal/agent-ready/macos-firm`, `header_up X-Forwarded-Uri {path}` (tam ad, sorgu dizesiz) → `agent_zip_file` (jenerik zip, istenen adla). `handle /downloads/*` 404'ünden önce. |
| `deploy/nginx/remote.noktabilisim.net.conf`    | `map $uri $remote_dl_key` + `limit_req_zone … zone=remote_dl:10m rate=10r/m`; `location /` içinde `limit_req zone=remote_dl burst=5 nodelay; limit_req_status 429;` (yeni `location` yok).                                                                                                 |
| `deploy/test-caddy.sh`                         | §15.1 satırları 1–7 + eski sunucu kayması + geri alınmış Caddyfile provası + zip biçimli kötü adlar.                                                                                                                                                                                       |
| `deploy/nginx/test-nginx.sh`                   | 7. istekte 429, `/api/` ve kapsam dışı yollar sınırsız, 429 erişim logunda, hata logunda ref yok.                                                                                                                                                                                          |
| `.github/workflows/agent-win.yml` (`sign-mac`) | Developer ID zip'indeki `OKUBENI.txt` ↔ `build/macos/OKUBENI.txt` `cmp` (ad-hoc/stg için `package-mac`'te zaten vardı).                                                                                                                                                                    |

**Açık iş:** `apps/agent-win/build/macos/OKUBENI*.txt` metinleri (mimari-p31 §15.3 kaynak çapası) bu pakette yazılmadı (paralel
çalışmada `apps/` dokunulmazdı); metinler `docs/implementation.md` "P31-O" bölümünde. Yazıldıktan sonra CI `cmp` adımları (profil
başına) zip içi ↔ kaynak eşliğini zorlar; 0.24.0 etiketi bu dosyalar güncellenmeden atılmaz.

Log maskesi değişmedi: Caddy `NoktaDestek-[^/?]+` ve nginx `remote_log_uri` `.zip` firma adını da `NoktaDestek-***` yazar (G-10;
test-caddy erişim + hata logu, test-nginx erişim logu).

### 32.2 Yayın sırası (staging; prod aynı) — **önce sunucu, sonra Caddyfile** (S-P31-1, bağlayıcı)

Ön koşul: P31 qa GEÇTİ + güvenlik Kritik/Yüksek 0; `ci` (`test-caddy.sh`, `test-nginx.sh` dahil) ve `agent-win` yeşil. Staging tek yığın
`/opt/remote/deploy`. **Staging'de denendi (2026-11-20, `a26f712d`; §8 yayın geçmişi):** m.1–4, 6, 7 GEÇTİ (m.5 yalnız prod). İç uç
204/404/404/404; dış duman Mac UA → `.zip`, curl UA → `.exe`, firma zip 200 `application/zip` (gövde SHA = `MAC_AGENT_SHA256`), bozuk
label 404, jenerik zip 200; Caddy ve server logunda ref 0. Düzeltme: firma bağlantısının yolu `/api/v1/public/agent/request-download`
(önceki metindeki `agent/`'sız yol 404 verir, Location boş kalır). Ref'i ekrana basmamak için ref sunucu tarafında değişkene alınır
(`tenant_request_settings.request_ref`, root ile, çıktısız) ve tüm çıktılar `sed "s/$REF/<ref>/g"` ile maskelenir; komutlar
`docker compose exec -T … </dev/null` ile çalıştırılır (yoksa `ssh … bash -s` betiğinin stdin'ini yutar).

1. **Ön yedek** (§15.1/1, `remote-pre-p31-…`) → repo güncelle (§8 bundle + pull). `git pull` Caddyfile'ı da değiştirir; Caddy dosyayı
   yalnız yeniden başlatınca okur (`admin off`, `reload` yok) — bu yüzden 4. adıma kadar Caddy **yeniden başlatılmaz/yaratılmaz**.
2. **Sunucu (Caddy hariç):** `IMAGE_TAG` → `docker compose build migrate server web && docker compose up -d --no-deps migrate server web`
   (Caddy'ye dokunmaz). `docker compose logs --since 5m migrate` → P31 migration uygulandı; `check-app-grants.sh` PASS.
3. **İç ucu doğrula** (Caddy konteynerinden; uç yalnız güvenilen proxy'ye açık):

```bash
cd /opt/remote/deploy
fa() { docker compose exec -T caddy wget -S -O /dev/null --header "X-Forwarded-Method: GET" --header "X-Forwarded-Uri: $1" \
  http://server:3001/internal/agent-ready/macos-firm 2>&1 | grep -m1 'HTTP/'; }
fa "/downloads/NoktaDestek-<label>-<gerçek-ref>.zip"     # → 204 (mac kapısı ok) ya da 503 (MAC_AGENT_SHA256 / dosya yok)
fa "/downloads/NoktaDestek-Yanlis-<gerçek-ref>.zip"      # → 404 (label eski)
fa "/downloads/***"                                       # → 404 (fail-closed: maskeli URI)
fa "/downloads/NoktaDestek-<label>-<gerçek-ref>.exe"     # → 404 (yanlış uzantı)
```

`<label>` = Admin panelindeki firma kısa adı, `<gerçek-ref>` = staging test firmasının Genel ref'i (panel "Firma bağlantısı" adresindeki
`ref=` değeri). Ref'i ekran görüntüsüne, issue'ya, sohbete yazmayın. 404 yerine "Not Found" sayfası yoksa (uç kayıtlı değil) → server
eski imajda: dur, 2. adıma dön. Bu adım geçmeden Caddy yeniden başlatılmaz.

4. **Caddyfile:** önce çalışan caddy içinde `docker compose exec -T caddy caddy validate --adapter caddyfile --config /dev/stdin < Caddyfile`
   → `Valid configuration` (bind-mount `git pull` sonrası eski inode'u gösterdiği için dosya stdin'den verilir), sonra
   `docker compose up -d --force-recreate --no-deps caddy` → `docker compose logs --since 2m caddy` hatasız (`pki.ca.local failed to
install root certificate … read-only file system` satırı `tls internal`'da her açılışta çıkar, zararsız).
5. **Host nginx (yalnız alan adlı yığın, prod):** §8.3 "vhost güncelleme" komutu aynen (`nginx -t` başarısızsa kendiliğinden geri alır).
   Staging (4450/4460) nginx'ten geçmez → hız sınırı staging'de yoktur (kabul, mimari-p31 §15.4).
6. **Dış doğrulama** (staging adresi, `tls internal` → `-k`; sunucunun içinden `--resolve 185.126.217.99:4450:127.0.0.1` ekleyin):

```bash
B=https://185.126.217.99:4450
MAC_UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
curl -skI -A "$MAC_UA" "$B/api/v1/public/agent/request-download?ref=<gerçek-ref>" | grep -i '^location:'   # → /downloads/NoktaDestek-<label>-<ref>.zip
curl -skI "$B/api/v1/public/agent/request-download?ref=<gerçek-ref>" | grep -i '^location:'                # (curl UA) → … .exe (değişmedi)
curl -skI "$B/downloads/NoktaDestek-<label>-<gerçek-ref>.zip" | grep -iE '^HTTP|^content-(type|disposition)'  # → 200, application/zip, adı
curl -skI "$B/downloads/NoktaDestek-Bozuk-<gerçek-ref>.zip" | head -1                                  # → 404
curl -skI "$B/downloads/NoktaDestek-macOS.zip" | head -1                                               # → 200 (jenerik değişmedi)
docker compose logs --since 5m caddy | grep -c '<gerçek-ref>'                                          # → 0 (G-10)
```

Prod'da ek olarak (host nginx): aynı IP'den hızlı 7 istek → 7.'si 429:
`for i in 1 2 3 4 5 6 7; do curl -s -o /dev/null -w '%{http_code} ' -I https://remote.noktabilisim.net/downloads/NoktaDestek-macOS.zip; done`
→ `200 200 200 200 200 200 429` (1 dk bekleyince düzelir). `grep -c '<gerçek-ref>' /var/log/nginx/remote.access.log` → 0.

7. İstemci 0.24.0: macOS zip r4 ad-hoc hattından (§28f.9; staging TEST zip'i §28f.4 yerel `--dir` yolu), Windows §24.4 — sunucu ile
   aynı etiket. §8 yayın geçmişine satır.

### 32.3 Geri alma — **ters sıra: önce Caddyfile, sonra sunucu** (denendi: `deploy/test-caddy.sh` "P31 geri alma provası" + "sürüm kayması")

1. Caddyfile'ı önceki sürüme döndür: `git -C /opt/remote checkout <önceki-commit> -- deploy/Caddyfile && docker compose up -d --force-recreate --no-deps caddy`.
   Sonuç: `@agentZipFirm` yok → firma zip'i `handle /downloads/*` 404'üne düşer, server'a gitmez; jenerik zip/exe etkilenmez.
2. Sunucu: önceki `IMAGE_TAG` → `docker compose up -d --no-deps server web`. DB sütunu geri alınmaz (mimari-p31 §5; eski kod sütunu okumaz).
3. nginx `limit_req` sorun çıkarırsa (yalnız onu geri almak): `cp /root/remote.conf.prev /etc/nginx/sites-available/remote.noktabilisim.net && nginx -t && systemctl reload nginx`.

Kayma güvenliği (CI'da sınanır): yalnız sunucu geri alınıp yeni Caddyfile kalırsa eski sunucuda `/internal/agent-ready/macos-firm`
kayıtlı değildir → 404 → firma zip'i **404** (200 değil). Yalnız Caddyfile geri alınırsa da 404. Hiçbir ara durumda kapı atlanmaz.
Eski sunucu Mac kullanıcısına `.exe` yönlendirir → kılavuz "Mac'te Windows dosyası indi" durumu (geçici).

### 32.4 Hız sınırı (nginx `limit_req`, S-P31-6) — işletim

- Kapsam: `/downloads/NoktaDestek-*` (firma `.exe` + `.zip`, jenerik `NoktaDestek-macOS.zip`, `NoktaDestek-linux`). Kodsuz `NoktaDestek.exe`,
  `Destek-<kod>.*`, `/api`, `/ws`, `/r/` sınırsız. IP başına 10/dk, anlık 5 fazla (gecikmesiz), aşımda 429.
- **Ön koşul:** nginx gerçek istemci IP'sini görür (Cloudflare "DNS only", §8.3). Kayıt proxied (turuncu) yapılırsa önce
  `set_real_ip_from <Cloudflare aralıkları>; real_ip_header CF-Connecting-IP;` eklenmeden `limit_req` kalamaz → aksi halde tek kova
  herkesi keser; o durumda `limit_req` satırları kaldırılır ve bu bir kabul edilen risk olarak §8 geçmişine yazılır.
- Gözcüler sınırın altında: `agent-watch.yml` günde 1 istek/iş (GitHub IP'leri); `publish-mac.sh`/`publish-linux.sh` doğrulaması 127.0.0.1'den
  en çok 10 deneme × 3 sn (429 → `curl -f` başarısız → yeniden dener; kovanın dolma hızı yeterli). NAT arkasında çok sayıda müşteri aynı
  dakikada indirirse 7.'si 429 alır → 1 dk sonra yeniden dener (kılavuz). Sık şikâyette `rate` artırılır (yalnız repo dosyası + §8.3 komutu).
- Teşhis: `jq -r 'select(.status==429) | .remote_addr' /var/log/nginx/remote.access.log | sort | uniq -c | sort -rn | head` (uri maskeli;
  red satırı hata loguna yazılmaz, `error_log crit`).

### 32.5 Destek notları (AC-522)

- **Ref sızdı → ref yenile — Mac müşterileri için de geçerlidir.** Yenileme sonrası eski `NoktaDestek-<label>-<eski-ref>.zip` ve
  `.exe` 404 olur (aynı kapı). Müşteriye: "Firmanız bağlantıyı yenilediyse yeni bağlantıdan yeniden indirin." Mac'te eski klasör
  (`NoktaDestek-<label>-<eski-ref>/`) ile açılan uygulama talep gönderemez (ref geçersiz) → yeni bağlantıdan indirilen zip kullanılır.
- **Talep yolunda `MIN_AGENT_VERSION` → `CLIENT_OUTDATED` (AC-519):** talep yolu da `MIN_AGENT_VERSION`'ı uygular; Mac istemcisi
  asgari sürümün altındaysa 426 `CLIENT_OUTDATED` alır ve "Bu Hızlı Destek dosyası eski" ekranındaki **Yeni sürümü indir**
  `…/request-download?ref=<ref>&os=macos` adresini açar (yeni zip iner). `MIN_AGENT_VERSION` yükseltmesi Windows ve Mac'i birlikte
  etkiler — Mac zip'i yeni sürümle yayımlanmadan yükseltilmez (§31.7 sırası).
- **Mac talepleri "bilinmeyen kaynak" kovasında (R-P31-4, kabul edilen risk):** Mac'te kayıt olmadığından talepler tenant başına
  60/sa kovasına düşer; sızmış ref ile spam yapılırsa Mac müşterileri bir saat "meşgul" görür → ilk müdahale ref yenilemedir (§26.5 m.3).
- Firma kısa adı değişirse eski adlı `.zip` de 404 (label uyuşmaz) — panel bağlantısı her zaman güncel adı verir.
- Mac'te 404 / 503 ayrımı: 404 = ref/label geçersiz (bağlantıyı yenileyin); 503 `NOT_READY` = macOS ikilisi yayımlanmamış/SHA uyuşmuyor
  (§28f.4 `publish-mac.sh`; bu durumda sunucu Mac'e zaten `.exe` yönlendirir).

### 32.6 Doğrulama komutları (yerel; sunucuya bağlanmaz)

`deploy/test-caddy.sh` → SONUÇ: GEÇTİ (P31: §15.1/1–7, kayma, geri alma provası; mutasyon: `header_up X-Forwarded-Uri "/downloads/***"`
kopyalanırsa 9 FAIL — hata kapalı yönde görünür). `deploy/nginx/test-nginx.sh` → GEÇTİ (`limit_req` 7. istek 429).
