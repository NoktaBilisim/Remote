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
| `WHATSAPP_SERVICE_URL`                                                 | P8b: whatsapp-bildirim servisi (sistem düzeyi; tenant değiştiremez). **P12b: yalnız yedek değerdir.** Etkin adres önceliği: **Sistem ayarları → WhatsApp servisi panel kaydı > `WHATSAPP_SERVICE_URL`** (P13b, G-P13b-2: `env.ts`'te yerleşik varsayılan **yok**; ikisi de boşsa kanal yapılandırılmamış = kapalı). Açılışta panel kuralıyla doğrulanır: yalnız `http://`/`https://` (küçük harf), `kullanıcı:şifre@`, sorgu (`?`), parça (`#`), boşluk/kontrol karakteri yok, ≤ 200 karakter → **uymazsa server açılmaz** (log `env` doğrulama hatası; `env.ts` `waServiceUrlSchema`; §17.4). **production'da `http://` + özel olmayan adres → kanal kapalı başlar** (gönderim yok, log `alarm:"whatsapp_insecure"`). Güvensiz veya yapılandırılmamış adreste testler servise istek **göndermez**: Super Admin testi (`POST /api/v1/admin/settings/whatsapp/test`) **200 `{ok:false}`** + sabit mesaj, tenant testi (`POST /api/v1/settings/support-requests/whatsapp/test`) **502 `UPSTREAM`** döner; prod değeri K13'e göre `https://…` veya özel ağ adresi (§12.3). **Değişiklik yolu: panel** (Super Admin → Sistem ayarları → WhatsApp servisi → kaydet; yeniden başlatma gerekmez, çalışan sürece hemen uygulanır). Env'e dönüş: aynı ekranda "Ortam değişkenine dön". **Panel kaydı varken `.env` değişikliği etkisizdir**; env'i değiştirip `docker compose up -d server` yalnız panel kaydı yokken (ekranda kaynak rozeti "Ortam değişkeni") anlamlıdır |
| `WHATSAPP_SERVICE_API_KEY`                                             | İsteğe bağlı. whatsapp-bildirim servisinin `x-api-key` anahtarı (sır: parola kasasında; loga, dokümana, komut satırına yazılmaz). Anahtar adresle birlikte gider: **panel adresi kayıtlıysa yalnız panel anahtarı kullanılır (bu değişken o adrese gönderilmez); panel kaydı yoksa env adresiyle bu değişken kullanılır.** Panelde adresin kökeni değişirse anahtar yeniden girilmelidir (`WA_API_KEY_REENTER`). Boşsa istek anahtarsız gider. Servis tarafında `REQUIRE_API_KEY` ile kademeli geçiş ayrı projede yürür: **servis anahtarı zorunlu hâle gelmeden ÖNCE Remote'a anahtar girilir** (panel ya da bu değişken + `docker compose up -d server`), aksi hâlde gönderimler ve test 401/502 ile düşer. Kontrol (değer basmadan): `grep -c '^WHATSAPP_SERVICE_API_KEY=.' deploy/.env` → `1` ya da panelde kaynak rozeti "Panel kaydı"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `WHATSAPP_ALLOW_INSECURE_HTTP`                                         | **K13 geçici çözümü (kullanıcı kararı 2026-11-15).** `true` / `false`, boş = `false`; başka değer → server açılmaz (env doğrulama). `true` iken **yalnız WhatsApp** hedefi için düz `http://` (genel adres ve `x-api-key` dahil) güvensiz sayılmaz → kanal production'da da açık; `whatsapp_insecure` / `whatsapp_key_over_http` alarmları düşmez, yerine açılışta bir kez **`alarm:"whatsapp_insecure_http_allowed"`** (warn; adres/anahtar yazılmaz). Super Admin → Sistem ayarları → WhatsApp servisi ekranında sarı uyarı (`insecureAllowed`). Ayrıştırılamayan adres yine kapalı; SMS kuralı değişmez. **Risk:** servis anahtarı ve mesajlar ağda açık metin gider. Servis HTTPS'e geçince `false` yapılır/silinir → `docker compose up -d server` (§12.3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `APP_ENCRYPTION_KEYS`                                                  | P10 (mimari §3.2): `v1:<base64 32 bayt>` (`openssl rand -base64 32`). SMTP şifresi ve TOTP sırları bununla AES-256-GCM şifrelenir. **production'da zorunlu** (yoksa server açılmaz; compose da `:?` ile durur). **Kaybedilirse** kayıtlı SMTP şifreleri ve tüm 2FA sırları çözülemez → SMTP şifreleri yeniden girilir, kullanıcıların 2FA'sı sıfırlanır (§14). Rotasyon: `v1:...,v2:...` (eski silinmez; yeni yazımlar v2 — emekliye ayırma kuralı §14 P10 "Anahtar rotasyonu"). Yedeği parola kasasında; loga/dokümana yazılmaz. Değişiklik: `.env` → `docker compose up -d server`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `UPLOADS_DIR`                                                          | P12: logo/avatar yükleme kökü. **Compose sabit verir** (`/data/uploads`, named volume `uploads` → `remote_uploads`); `.env`'deki değer yalnız compose dışı çalıştırmada kullanılır — **mutlak yol** (env.ts göreli yolu reddeder), ör. `<repo>/.data/uploads` (`.data/` git-ignore). Boşsa `/data/uploads`. Yedek/geri yükleme §16.3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `SMSPORTAL_URL`                                                        | P19: smsportal sistem varsayılan adresi (yalnız köken + yol, ör. `https://<smsportal>`). Firma panelde kendi SMS adresini girmemişse bu kullanılır; boş = varsayılan yok. API anahtarı env'de DEĞİL, firma başına panelde (şifreli, AAD etkin kökene bağlı). Production'da `http://` + özel olmayan host → SMS kapalı. **Değiştirmek** varsayılanı kullanan firmaların anahtarını okunamaz yapar → önce §26.3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `MIN_AGENT_VERSION`                                                    | P8b G-E9-4: asgari Windows istemci sürümü `x.y.z`. Boş = kontrol yok. Düşük sürüm talep/resolve/join/`/ws/guest`'te 426 `CLIENT_OUTDATED`; istemci "Yeni sürümü indir" gösterir. Güvenlik yamasında yükseltilir (§12.4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `DEPLOY_ENV`                                                           | **P27: compose'da server için zorunlu** (`${DEPLOY_ENV:?}`; boşsa `docker compose` durur, env.ts NODE_ENV=production iken varsayılansız ister). `production` (prod) · `staging` (staging) · `development` (yerel). Yedek/geri yükleme ve yayın betikleri de okur. Prod `.env` staging'den kopyalanmaz. Açılış hatası "DEPLOY_ENV gerekli" → §27.8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `UNATTENDED_MODE`                                                      | P27 imza kapısı: boş/`off` (prod — SignPath gelene kadar) · `unsigned` (**yalnız** `DEPLOY_ENV=staging`; başka ortamda server açılmaz) · `signed` (imzalı + listede). §27                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `UNATTENDED_SIGNED_SHA256`                                             | `signed`'da zorunlu: virgüllü 64-hex liste (Release `SHA256SUMS`'taki imzalı `NoktaDestekServis-<sürüm>.exe` satırları, attestation doğrulanmış). §27.5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `UNATTENDED_AGENT_SHA256`                                              | Servis ikilisinin SHA-256'sı. **Elle yazılmaz**: `deploy/agent/publish-servis.sh` yazar. Yol compose'da sabit (`UNATTENDED_AGENT_PATH=/data/unattended/NoktaDestekServis.exe`, volume `unattended_downloads`, yalnız server salt okunur). Boş/uyuşmaz → panel indirmesi 503                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
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
Rollback: `.env`'de `IMAGE_TAG=<önceki>` → `docker compose up -d` (şema değiştiyse önce §6 geri alma).
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

DNS: Cloudflare A `remote` → 185.126.217.99, **DNS only (gri)** — proxied yapılırsa ACME ve gerçek IP bozulur.
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
| Branch protection (main)              | required checks: `ci` job'ları + `agent-win` → `check`, `test-windows`, `build 1/2`, `build 2/2`, `tekrarlanabilirlik + SHA256SUMS`                                                                                                                        |
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
- **Geri dönüş:** yayın sonrası düştüyse önceki `IMAGE_TAG` (§8 rollback); şema değiştiyse ilgili paketin geri alma bölümü (§18.8 vb.).

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

### 20.3 Prod açılış kontrol listesi (şablon; imzalı)

| #   | Madde                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Kanıt (komut / kayıt)                                                                                                                      | Sonuç | Yapan | Tarih |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ----- | ----- |
| 1   | AC-88 ≤ 120 sn; AC-91/AC-200 prod provası OK, RTO ≤ 60 dk; imza olumsuz testi FAIL                                                                                                                                                                                                                                                                                                                                                                                                              | §20.2/7 süre; §18.4 tablo satırı; §18.9/3 çıktısı; §18.7/9 journal                                                                         |       |       |       |
| 2   | AC-23 `relay/tls` (UDP kapalı, yalnız 443 + 5349/TCP; kök sertifika yok); AC-21 tavanı (allocation başına 8 Mbit/s)                                                                                                                                                                                                                                                                                                                                                                             | `docs/test-raporu.md` kaydı; `test-local.sh` ölçümü                                                                                        |       |       |       |
| 3   | `test-denied.sh` 0 FAIL (49160–49479); S-P3-2 relay↔relay echo PASS; §9.2.3 listesi                                                                                                                                                                                                                                                                                                                                                                                                             | çıktı özeti                                                                                                                                |       |       |       |
| 4   | S-P2-5: dış makineden başarısız girişte audit `ip_address` = istemcinin genel IPv4'ü; IPv6 kaydı (§20.7)                                                                                                                                                                                                                                                                                                                                                                                        | Audit ekranı; `ip -6 addr show scope global` boş; `dig +short AAAA remote.noktabilisim.net` boş                                            |       |       |       |
| 5   | HSTS `max-age=31536000; includeSubDomains`; AC-126 e2e; `rs_theme` çerezi `Secure`                                                                                                                                                                                                                                                                                                                                                                                                              | `curl -sI …/login`; e2e çıktısı                                                                                                            |       |       |       |
| 6   | P10 elle testleri (SSL/465, STARTTLS/587, sıfırlama 30 dk, 20/sa → 21. 429, kilit e-postası, logout-all/2FA sıfırlamada oturum ≤ 5 sn, SA SMTP ekranı, 8 sa oturum)                                                                                                                                                                                                                                                                                                                             | `docs/test-raporu.md`                                                                                                                      |       |       |       |
| 7   | Windows elle testleri (prod Release, 0.10.2 adım 1–7 + AC-95/96/128; parmak izi = SHA256SUMS); eski istemci 426                                                                                                                                                                                                                                                                                                                                                                                 | test raporu                                                                                                                                |       |       |       |
| 8   | K13: (a) TLS/özel ağ + test mesajı başarılı ya da (b) kanal kapalı, uyarı + `whatsapp_insecure` log + karar kaydı                                                                                                                                                                                                                                                                                                                                                                               | ekran / log satırı / karar                                                                                                                 |       |       |       |
| 9   | `reset-superadmin --dry-run` 0 (gerçek çalıştırma ikinci SA'da ya da entegrasyon testi kanıtı)                                                                                                                                                                                                                                                                                                                                                                                                  | §20.2/11 çıktısı                                                                                                                           |       |       |       |
| 10a | G-P13b-3 proxy-guard verify OK; nginx yolu 200; `check` UYARI satırları değerlendirildi                                                                                                                                                                                                                                                                                                                                                                                                         | `remote-proxy-guard verify` / `check` çıktısı; `nft list table inet remote_proxy_guard`                                                    |       |       |       |
| 10  | `remote-watch` alarm testi: `docker compose stop web` → ≤ 10 dk ALERT → `start` → DUZELDI                                                                                                                                                                                                                                                                                                                                                                                                       | gelen mesajlar, journal                                                                                                                    |       |       |       |
| 11  | Yedek hata testi (AC-200) FAILED + alarm; audit süreklilik olumsuz testi (T1 yerel kanıtı)                                                                                                                                                                                                                                                                                                                                                                                                      | journal; `docs/implementation.md` T1                                                                                                       |       |       |       |
| 12  | Repo public, gitleaks tüm geçmiş 0 bulgu; `verify-and-publish` attestation'la; agent-watch yeşil                                                                                                                                                                                                                                                                                                                                                                                                | gitleaks çıktısı; Actions                                                                                                                  |       |       |       |
| 13  | Gizli bilgi temizliği: staging sırları/dökümleri imha, ACCESS.txt yok, yeni sırların kasa kaydı; history/journal sır taraması (`grep -lE 'PASSWORD=\|SECRET=\|AGE-SECRET-KEY' /root/.*_history` boş; `journalctl --since -30d \| grep -ciE 'password=\|secret='` 0); imaj katmanlarında sır yok (`docker history --no-trunc remote-server:<TAG> \| grep -ciE 'password\|secret'` 0); staging sırlarıyla eşleşen değer kullanılmıyor; 4450 yalnız 127.0.0.1 (`ss`) ve dışarıdan `nc` zaman aşımı | komut çıktıları (değer yazmadan, yalnız sayılar)                                                                                           |       |       |       |
| 13b | `docker` grubu boş (root eşdeğeri; proxy-guard ve root 600 korumalarını aşar)                                                                                                                                                                                                                                                                                                                                                                                                                   | `getent group docker` → üye yok                                                                                                            |       |       |       |
| 14  | "Nokta Test" pasif; README, kılavuz, DATASHEET (ağ gereksinimleri), PDF'ler güncel                                                                                                                                                                                                                                                                                                                                                                                                              | dosya tarihleri / commit                                                                                                                   |       |       |       |
| 15  | K13 geçici izni kapalı: `WHATSAPP_ALLOW_INSECURE_HTTP=false` (ya da boş); WhatsApp servisi HTTPS'te (D-LGK-2, §12.3)                                                                                                                                                                                                                                                                                                                                                                            | `grep -c '^WHATSAPP_ALLOW_INSECURE_HTTP=true' deploy/.env` → 0; `docker compose logs server \| grep -c whatsapp_insecure_http_allowed` → 0 |       |       |       |

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
2. Actions → agent-win → etiket koşusu: check, test-windows, build ×2, tekrarlanabilirlik yeşil → `approve` işi
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

| Ortam                                                              | `DEPLOY_ENV`  | `UNATTENDED_MODE`                                         | `UNATTENDED_SIGNED_SHA256` | Servis ikilisi                                     |
| ------------------------------------------------------------------ | ------------- | --------------------------------------------------------- | -------------------------- | -------------------------------------------------- |
| Prod (`/opt/remote`, terfiden sonra)                               | `production`  | `off` (SignPath imzası gelene dek)                        | boş                        | yayınlanmaz (kapalıyken 409 `UNATTENDED_DISABLED`) |
| Staging (bugün `/opt/remote` 4450; P13c sonrası `/opt/remote-stg`) | `staging`     | `unsigned`                                                | boş                        | yerelde derlenmiş imzasız ikili (§27.3)            |
| Yerel                                                              | `development` | `off` (deneme için `unsigned` **olmaz** — yalnız staging) | boş                        | gerekirse `--local`                                |

Kurallar: `unsigned` yalnız `DEPLOY_ENV=staging` iken açılır (aksi halde server açılış hatası verir — prod'a staging `.env`'i
kopyalamaya karşı korkuluk). Staging'e **gerçek müşteri cihazı kaydedilmez** (imzasız SYSTEM servisi; gösterge "TEST — imzasız").
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
`unattended_downloads` volume'una atomik yazım (0644), `.env` `UNATTENDED_AGENT_SHA256` (yedek `.env.bak.servis.<zaman>`, son 5),
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
2. `UNATTENDED_SIGNED_SHA256=<yeni sha>[,<önceki desteklenen sha>]` (eski sürüm listeden çıkınca o cihazlar 4403 alır; önce
   cihazlar güncellenir) + `UNATTENDED_MODE=signed`.
3. `deploy/agent/publish-servis.sh --tag vX.Y.Z --ssh root@<sunucu>` → server yeniden yaratılır.
4. Doğrulama: panel bandı yok, cihaz listesinde "İmzasız" rozeti yok.

### 27.6 Kapatma, geri alma ve migration geri dönüşü

- Acil kapatma (her ortam): `sed -i 's/^UNATTENDED_MODE=.*/UNATTENDED_MODE=off/' .env && docker compose up -d --no-deps server`
  → cihazlar 4403 ile reddedilir (servisler bekleme döngüsünde), kayıt/kod/bağlan 409. Cihaz kaydı silinmez.
- Uygulama geri alma: önceki `IMAGE_TAG` + `UNATTENDED_MODE=off` → `docker compose up -d server web`.
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

| Belirti                                                                     | Neden / eylem                                                                                                          |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `docker compose` "DEPLOY_ENV gerekli"                                       | `.env`'de `DEPLOY_ENV` yok/boş → ortama göre ekle (§27.1)                                                              |
| server açılmıyor, log `UNATTENDED_MODE: unsigned yalnız DEPLOY_ENV=staging` | prod'a staging `.env`'i kopyalanmış → `UNATTENDED_MODE=off`                                                            |
| log `DEPLOY_ENV gerekli (production)` / `(UNATTENDED_MODE off değil)`       | `.env` `DEPLOY_ENV` boş ama compose dışı çalıştırma (yerel `pnpm`) → `.env`'e ekle                                     |
| log `UNATTENDED_SIGNED_SHA256: signed modda zorunlu`                        | liste boş → §27.5 ya da `off`                                                                                          |
| panel "Servis programını indir" 503                                         | `UNATTENDED_AGENT_SHA256` boş veya volume'daki dosya farklı → §27.3 yeniden yayınla                                    |
| Cihazlar sunucu yeniden başlarken 503 alıyor                                | K-P27-21: kimliksiz soket tavanı IP başına 5; aynı NAT arkasında ≥ 6 cihaz üstel beklemeyle toparlanır, eylem gerekmez |
| AV/SmartScreen servisi engelliyor (R-P27-2)                                 | imzasız ikili yalnız staging'de; prod `off`. Staging VM'de Defender istisnası verilmez — imza gelene kadar beklenen    |

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

**Durum:** `remote-watch` otomasyonu bu serileri henüz okumuyor (K9 açık işi). O gelene kadar elle bakılır:
`docker compose exec -T server node -e "fetch('http://127.0.0.1:3001/metrics',{headers:{authorization:'Bearer '+process.env.METRICS_TOKEN}}).then(r=>r.text()).then(t=>console.log(t.split('\n').filter(l=>l.startsWith('rs_unattended_')).join('\n')))"`
