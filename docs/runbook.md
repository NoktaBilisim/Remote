# Runbook — Remote Support (P1 iskeleti)
Sahibi: devops. Kapsam P1: kurulum, başlatma/durdurma, env, log, migrate/seed. Yedek, alarm, rollback
provası, TURN, sertifika yenileme P3/P13'te eklenecek. Mimari: `docs/mimari.md` §8.

## 1. Bileşenler
| Servis | İmaj | Ağ | Dış port | Not |
|---|---|---|---|---|
| caddy | `caddy:2.11.9-alpine` | edge (sabit 172.30.0.2) | **4450/tcp** | TLS (`tls internal`), yönlendirme, log filtresi |
| web | `remote-web` (apps/web/Dockerfile) | edge (sabit 172.30.0.3) | — | Next.js :3000 |
| server | `remote-server` (apps/server/Dockerfile `runtime`) | edge + db | — | Fastify :3001, `/health` `/ready` |
| migrate | `remote-migrate` (`migrate` hedefi) | db | — | tek seferlik; `migrator` kullanıcısı |
| seed | `remote-migrate` | db | — | profil `setup`, elle |
| mysql | `mysql:8.4.13` | db (internal, internet yok) | — | volume `mysql_data`, UTC |

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
Tarayıcı: `https://<SITE_HOST>:4450`. `tls internal` kök sertifikası test makinesine kurulur:
`docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt` → işletim sistemi
"Güvenilen kök sertifikalar"a eklenir. (Gerçek müşteri staging'e bağlanmaz.)

## 3. Ortam değişkenleri (`deploy/.env`, git-ignore; anahtar listesi `.env.example`)
| Değişken | Nasıl üretilir / değer |
|---|---|
| `MYSQL_ROOT_PASSWORD`, `MYSQL_APP_PASSWORD`, `MYSQL_MIGRATOR_PASSWORD` | `openssl rand -hex 24` (yalnız harf/rakam: URL'ye gömülür, tırnak/ters bölü yasak) |
| `MYSQL_DATABASE` | `remote` |
| `PUBLIC_BASE_URL` | staging `https://185.126.217.99:4450`, yerel `https://localhost:4450` |
| `SESSION_REF_KEY` | `openssl rand -base64 48` (≥ 32 karakter). Oturum linklerindeki `sessionRef`'in HMAC anahtarı; compose'da zorunlu. Değiştirilirse/boş kalırsa (compose dışı) mevcut `sessionRef`'ler 404 olur — açık oturum yokken değiştirin; yedeği parola kasasında |
| `EDGE_PROXY_SECRET` | `openssl rand -base64 32` (≥ 32 karakter). Caddy → web `X-Edge-Auth` sırrı. Compose'da caddy ve web için zorunlu; web production'da sır yoksa müşteri sayfası hata verir. Rotasyon: `.env`'i güncelleyip `docker compose up -d caddy web` çalıştırın; iki servis birlikte yeniden yaratılır, açık oturumlar etkilenmez. Yedeği parola kasasında tutulur, loga ve dokümana yazılmaz |
| `SITE_HOST` | staging `185.126.217.99`, yerel `localhost` |
| `SEED_SUPERADMIN_EMAIL/PASSWORD/NAME` | boşluk içeren değer tırnakla yazılır (`SEED_SUPERADMIN_NAME="Super Admin"`), yoksa §6'daki `. ./.env` kabukta hata verir. |
| ↳ | yalnız seed için; parola ≥ 12, ilk girişte değiştirilir; seed sonrası `.env`'den silinebilir |
| `NODE_ENV`, `LOG_LEVEL`, `ALLOWED_ORIGINS`, `CADDY_BIND`, `IMAGE_TAG` | opsiyonel (varsayılan: production, info, PUBLIC_BASE_URL, 0.0.0.0, local) |
`DATABASE_URL` / `MIGRATE_DATABASE_URL` compose'da parolalardan **üretilir**; `.env`'deki değerleri yalnız
compose dışı (yerel `pnpm`) çalıştırmada kullanılır. Server konteynerine yalnız ihtiyaç duyduğu
değişkenler açıkça verilir; `MIGRATE_DATABASE_URL` ve root parolası server'da **yoktur** (G-15). Kontrol:
`docker compose exec server sh -c 'env | grep -c MIGRATE_DATABASE_URL'` → `0`.
Prod gizlileri repo/CI'da tutulmaz; sunucuda `deploy/.env` (600, root) + parola kasası yedeği.
DB parolası değişimi: `ALTER USER 'app'@'%' IDENTIFIED BY '...'` (root ile), `.env` güncelle, `docker compose up -d server`.

## 4. Günlük işlemler
| İş | Komut (`deploy/` içinde) |
|---|---|
| Başlat / güncelle | `docker compose up -d` (değişen imaj/env olan servis yeniden yaratılır) |
| Durdur (veri kalır) | `docker compose stop` · tamamen kaldır: `docker compose down` |
| **Veriyi sil** (yalnız test!) | `docker compose down -v` — MySQL ve Caddy CA volume'ları silinir |
| Durum | `docker compose ps` |
| Yeniden başlat | `docker compose restart server` |
| Yeni sürüm | `git pull && IMAGE_TAG=<sürüm> docker compose build && IMAGE_TAG=<sürüm> docker compose up -d` |

## 5. Sağlık ve loglar
- Hazırlık: `docker compose exec server node -e "fetch('http://127.0.0.1:3001/ready').then(async r=>console.log(r.status, await r.text()))"` → `200 {"status":"ready","migration":"..."}`.
- Docker healthcheck server'da `/ready`'yi 5 sn'de bir yoklar; `unhealthy` → §6.
- Loglar JSON (pino; `reqId` korelasyon kimliği, yanıtta `X-Request-Id`): `docker compose logs -f --since 10m server`.
  Kullanıcının bildirdiği `requestId` ile arama: `docker compose logs server | grep <requestId>`.
- Caddy erişim logu: `docker compose logs caddy | grep handled`. Sorgu dizesi, `/session/<token>`,
  `Cookie`, `Authorization`, `X-Csrf-Token`, `Sec-WebSocket-Protocol`, `Set-Cookie` **yazılmaz** (G-10).
  Doğrulama: `docker compose logs caddy | grep -c 'ticket=\|Sec-Websocket-Protocol'` → `0`.
- Log dönüşü: json-file 10 MB × 5 dosya / servis.

## 6. Migration ve seed
- Her `docker compose up -d`'de `migrate` önce çalışır (`prisma migrate deploy` + `grants.sql`); başarısızsa
  server **başlamaz**. Log: `docker compose logs migrate`.
- Elle: `docker compose run --rm migrate` · seed: `docker compose --profile setup run --rm seed`.
- Geri alma (veri kaybı olur, önce yedek): `docker compose run --rm migrate pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/<ad>/down.sql`, sonra önceki imaj etiketiyle `up -d` (ayrıntı `docs/db-notlari.md`).
- `app` yetki sınırı kontrolü: `set -a; . ./.env; set +a; APP_PW=$MYSQL_APP_PASSWORD CONTAINER=remote-mysql-1 DB=$MYSQL_DATABASE bash mysql/check-app-grants.sh`.

## 7. Sorun giderme (P1)
| Belirti | Kontrol / çözüm |
|---|---|
| `required variable X is missing` | `deploy/.env`'de X boş; §3 |
| migrate `exited (1)` | `docker compose logs migrate`; parola/DB adı uyuşmazlığı → mysql volume ilk init'teki parolayı kullanır (`.env` sonradan değiştiyse `ALTER USER`) |
| server `unhealthy` | `logs server`; `/ready` 503 → DB erişimi / migration sürümü |
| Tarayıcı sertifika uyarısı | kök sertifika kurulmamış (§2) veya `SITE_HOST` ≠ adres çubuğundaki ad |
| 4450 açılmıyor | `CADDY_BIND`, host güvenlik duvarı, `docker compose logs caddy` |
| `Address already in use` (ağ) | 172.30.0.0/24 host'ta başka ağla çakışıyor → compose `edge` alt ağını, caddy/web sabit adreslerini ve `TRUSTED_PROXY_CIDR` sabitini birlikte değiştir |
| Müşteri resolve audit'inde IP hep `172.30.0.3` | `EDGE_PROXY_SECRET` caddy ile web arasında farklı: iki servisi birlikte yeniden yaratın (`docker compose up -d --force-recreate caddy web`). Kontrol için sırrın kendisini değil özetini karşılaştırın: `docker compose exec web sh -c 'printf %s "$EDGE_PROXY_SECRET" \| sha256sum'`, aynı komutu `caddy` için de çalıştırın |
| Tüm müşteriler aynı IP'den (`172.30.0.x`) görünüyor / token limiti (429) ortak işliyor | web'in adresi .3 değil veya `TRUSTED_PROXY_CIDR` kapsamıyor: `docker inspect remote-web-1 -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'` |
