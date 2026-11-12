# Runbook — Remote Support (P1–P8c)
Sahibi: devops. Kapsam P1: kurulum, başlatma/durdurma, env, log, migrate/seed. Yedek, alarm, rollback
provası, TURN, sertifika yenileme P3/P13'te eklenecek. Mimari: `docs/mimari.md` §8.

## 1. Bileşenler
| Servis | İmaj | Ağ | Dış port | Not |
|---|---|---|---|---|
| caddy | `caddy:2.11.9-alpine` | edge (sabit 172.30.0.2) | **4450/tcp**, `127.0.0.1:4451` | 4450: TLS (`tls internal`, IP girişi); 4451: host nginx arkası düz HTTP (§8.3); yönlendirme, log filtresi |
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
| `ABUSE_EMAIL` | Misafir karşılama ekranındaki "Kötüye kullanımı bildir" `mailto:` adresi (AC-125, V13, S-P4-1), ör. `abuse@<alan-adı>`. **production'da boşsa bağlantı gizlenir** (Super Admin e-postasına düşülmez). Staging/prod'da doldurulması önerilir. Değişiklik: `.env` → `docker compose up -d server`. Kullanmayacaksanız boş bırakmak (`ABUSE_EMAIL=`) veya satırı silmek güvenlidir: env.ts boş/yalnız boşluk değerleri tanımsız sayar (`withoutBlanks`), server açılır ve production'da bağlantı gizlenir. Dolu ama geçersiz bir adres (ör. `abuse@`) ise env.ts doğrulamasında server'ı açtırmaz |
| `AGENT_SHA256` | P6 (G-07): `agent_downloads` volume'undaki `NoktaDestek.exe`'nin SHA-256'sı (64 hex). **Elle yazılmaz**: `deploy/agent/verify-and-publish.sh` attestation + `SHA256SUMS` doğrulamasından sonra yazar, ardından `docker compose up -d server`. Boşsa, dosya yoksa veya hash uyuşmazsa `GET /api/v1/public/agent/download` **503** döner (fail-closed) ve server logunda bir kez `alarm: "agent_binary"` uyarısı çıkar. `AGENT_BINARY_PATH` compose'da sabittir (`/data/downloads/NoktaDestek.exe`); `.env`'deki değer yalnız compose dışı çalıştırmada kullanılır |
| `WHATSAPP_SERVICE_URL` | P8b: whatsapp-bildirim servisi (sistem düzeyi; tenant değiştiremez). Boş/tanımsız → `env.ts` varsayılanı `http://89.252.189.211:3000` (staging). **production'da `http://` + özel olmayan adres → kanal kapalı başlar** (gönderim yok, test 502, log `alarm:"whatsapp_insecure"`); prod değeri K13'e göre `https://…` veya özel ağ adresi (§12.3). Değişiklik: `.env` → `docker compose up -d server` |
| `MIN_AGENT_VERSION` | P8b G-E9-4: asgari Windows istemci sürümü `x.y.z`. Boş = kontrol yok. Düşük sürüm talep/resolve/join/`/ws/guest`'te 426 `CLIENT_OUTDATED`; istemci "Yeni sürümü indir" gösterir. Güvenlik yamasında yükseltilir (§12.4) |
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
- `app` yetki sınırı kontrolü: `set -a; . ./.env; set +a; APP_PW=$MYSQL_APP_PASSWORD CONTAINER=remote-mysql-1 DB=$MYSQL_DATABASE bash mysql/check-app-grants.sh`.
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
| Belirti | Kontrol / çözüm |
|---|---|
| `required variable X is missing` | `deploy/.env`'de X boş; §3 |
| migrate `exited (1)` | `docker compose logs migrate`; parola/DB adı uyuşmazlığı → mysql volume ilk init'teki parolayı kullanır (`.env` sonradan değiştiyse `ALTER USER`) |
| server `unhealthy` | `logs server`; `/ready` 503 → DB erişimi / migration sürümü |
| Tarayıcı sertifika uyarısı | kök sertifika kurulmamış (§2) veya `SITE_HOST` ≠ adres çubuğundaki ad |
| 4450 açılmıyor | `CADDY_BIND`, host güvenlik duvarı, `docker compose logs caddy` |
| TLS `internal error` alert'i (IP ile bağlanınca) | IP adresine bağlanan istemci SNI göndermez; Caddyfile global `default_sni {$SITE_HOST}` olmalı |
| Dışarıdan 4450 zaman aşımı, sunucuda `curl -k https://127.0.0.1:4450/login` 200 | Paket VM'e ulaşmıyor: üst NAT/firewall yönlendirmesi eksik (§8). Kontrol: `tcpdump -ni ens18 tcp port 4450` dışarıdan istek sırasında boş |
| `Address already in use` (ağ) | 172.30.0.0/24 host'ta başka ağla çakışıyor → compose `edge` alt ağını, caddy/web sabit adreslerini ve `TRUSTED_PROXY_CIDR` sabitini birlikte değiştir |
| Müşteri "uygulamayı indir"de 503 / server logunda `alarm: "agent_binary"` (`state`: `unconfigured` \| `missing` \| `mismatch`) | P6 indirme kapısı: `AGENT_SHA256` boş, volume'da `NoktaDestek.exe` yok/okunamıyor (dosya izni 0644 olmalı; server root olmayan kullanıcıyla okur) veya hash uyuşmuyor. **`mismatch` güvenlik olayıdır** (ikili değiştirilmiş olabilir): volume'u elle düzeltmeyin, `verify-and-publish.sh` ile Release'den yeniden yayımlayın. Kontrol (hash değerini karşılaştırın, ikiliyi kopyalamayın): `docker compose exec server sha256sum /data/downloads/NoktaDestek.exe`. Dosya değişince server yeniden başlatma gerekmeden hash'i yeniden hesaplar; `AGENT_SHA256` değişirse `docker compose up -d server` |
| `/downloads/*.exe` 503 `NOT_READY` (JSON) | S6-2: Caddy dosyayı sunmadan önce `forward_auth` ile server'ın iç `/internal/agent-ready` ucuna sorar; yukarıdaki satırla aynı nedenler (`alarm: "agent_binary"`). Server ayakta değilse 502. İç uç dışarıdan 404'tür; elle kontrol: `docker compose exec caddy wget -S -O- --header 'X-Forwarded-Method: GET' http://server:3001/internal/agent-ready` → `204` |
| `/downloads/Destek-<kod>.exe` 404 | Caddy yalnız `NoktaDestek.exe` ve `Destek-<8 hane>.exe` adlarını sunar (her ikisi aynı dosya); volume `caddy` servisine `/srv/downloads` olarak bağlı mı: `docker compose exec caddy ls -l /srv/downloads` |
| Müşteri resolve audit'inde IP hep `172.30.0.3` | `EDGE_PROXY_SECRET` caddy ile web arasında farklı: iki servisi birlikte yeniden yaratın (`docker compose up -d --force-recreate caddy web`). Kontrol için sırrın kendisini değil özetini karşılaştırın: `docker compose exec web sh -c 'printf %s "$EDGE_PROXY_SECRET" \| sha256sum'`, aynı komutu `caddy` için de çalıştırın |
| Teknisyen "Kontrol iste"de `CONFLICT` alıyor | P7 `control.request` süzgeci: "Müşteri bağlı değil." (misafir kopuk/lobide), "Önceki kontrol isteği müşteride bekliyor." (önce **Vazgeç**), "Kontrol zaten açık." (iki sekme). Monitör isteğinde "Önceki monitör isteği müşteride bekliyor." → yanıt ya da 30 sn beklenir. Sunucu hatası değildir; ayrıntı `docs/api.md` "Uzaktan kontrol (P7)" |
| Teknisyen `RATE_LIMITED` alıyor (kontrol veya monitör) | Ret/yanıtsızlık sonrası 30 sn bekleme veya oturum başına 5 istek sınırı (G-03, bilinçli). Sınır oturum başınadır; teknisyen yeni oturum açarak devam eder. Ayar yoktur |
| Konsolda "Kontrol sistem tarafından kapatıldı (yetki veya kayıt)", müşteri izin vermişti | Fail-closed (G-15): izin kaydı (consent + audit) yazılamadı veya 800 ms'yi aştı → kontrol geri alındı, teknisyene `error{INTERNAL}` + `ref`. Kontrol: `docker compose logs server --since 10m \| grep <ref>`; `rs_control_total{event="grant_audit_error"\|"grant_audit_timeout"}` artıyor mu; DB gecikmesi/bağlantısı (`/ready`, `docker compose logs mysql`). DB düzelince kontrol yeniden istenebilir; kodda gevşetilecek bir ayar yoktur |
| Yetkisi kaldırılan teknisyenin kontrolü hemen kapanmadı | P9'a kadar yetki değişikliği teknisyen soketinin 60 sn'lik yeniden doğrulamasında uygulanır (`caps.update` + `control.revoke{permission}`, metrik `caps_narrowed`, `revoke_permission`). En geç ~60 sn beklenir. Hemen kesmek için oturumu zorla sonlandırın (`POST /api/v1/sessions/:id/terminate`, Oturumlar → "Zorla sonlandır") |
| Uzaktan kontrol olaylarını izleme | `/metrics` → `rs_control_total{event}` (komut: `docs/api.md` "GET /metrics"; olay listesi `apps/server/src/ops/metrics.ts`). Dikkat: `grant_audit_{error,timeout}` > 0 (izin kaydı yazılamıyor), `control_request_audit_failed` > 0 (istek audit'i yazılamadı, istek yine iletildi), `control_state_unexpected` sık artıyorsa (beklenmeyen izin mesajı; değiştirilmiş istemci şüphesi, log oda başına dakikada ≤ 1) |
| Konsolda "Kontrol iste" düğmesi yok | Teknisyende `remote_control.use` yok (staging: `staging-users.sh` USER'a açar), müşteri tarayıcıdan bağlı (yalnız görüntü; "Uzaktan kontrol" pasif) veya görüntü henüz gelmedi |
| `https://remote.noktabilisim.net` 502 | Caddy 4451 dinlemiyor: `ss -ltn \| grep 4451` boş → repo'daki Caddyfile/compose (ADR-0015) yayında değil veya caddy yeniden yaratılmadı (`docker compose up -d caddy`). `tail /var/log/nginx/remote.access.log` → `upstream_status` |
| Alan adında tüm istemciler `172.30.0.128` görünüyor | edge ağ geçidi değişti: `docker network inspect remote_edge -f '{{json .IPAM.Config}}'` → Gateway, Caddyfile `servers :4451 trusted_proxies` ile aynı olmalı. Cloudflare kaydı "proxied" (turuncu) yapıldıysa istemci Cloudflare IP'si görünür → "DNS only" |
| Sertifika süresi doldu / yenilenmedi (alan adı) | `certbot certificates --cert-name remote.noktabilisim.net`; `certbot renew --cert-name remote.noktabilisim.net` (webroot `/var/www/remote-acme`, HTTP 80 vhost'u açık olmalı); `journalctl -u certbot --since -2d` |
| Hızlı Destek staging'de kod soruyor / hiçbir kodu kabul etmiyor | (Alan adıyla gömülü istemcide geçerli değil — LE sertifikası, kök kurulumu gerekmez.) IP:4450 gömülü istemcide: Windows'ta Caddy `tls internal` kök sertifikası kurulu değil (§8 "Kök CA", yönetici komut isteminde `certutil -addstore -f Root remote-staging-ca.crt`). İstemci sertifikayı doğrulayamayınca bağlantı hatası kod hatası gibi görünüyor; ajan 0.8.0'da TLS hatası ayrı mesajla gösterilecek |
| CSV dışa aktarmada 429 / "En çok 50.000 satır" | P8 sınırları: kullanıcı başına dakikada 5 dışa aktarma; 50.000 satır üstünde dosya üretilmez (tarih aralığı daraltılır). Müşteri adıyla liste araması dakikada 60. Ayar yoktur |
| Tüm müşteriler aynı IP'den (`172.30.0.x`) görünüyor / token limiti (429) ortak işliyor | web'in adresi .3 değil veya `TRUSTED_PROXY_CIDR` kapsamıyor: `docker inspect remote-web-1 -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'` |

## 8. Staging (185.126.217.99:4450)
Paylaşımlı sunucu (`/opt` altında başka projeler; 80/443 başka serviste). Yalnız `remote` compose projesinin
konteyner/ağ/volume'larına dokunulur; `docker system prune` / `docker builder prune` (filtresiz) **yasak**.
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
  | Tarih | Kapsam | Commit / `IMAGE_TAG` | Migration | Not |
  |---|---|---|---|---|
  | 2026-11-11 | P3+P4 | `0f1b89a` / `0f1b89a` | `20261111030000_p4_consents` | coturn `TURN_LISTEN_IPS=auto` (3478 yalnız 127.0.0.1 ve özel IP'de dinliyor); dış TURN erişimi pfSense NAT'ı bekliyor (§8.2) |
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

| # | Arayüz | Protokol | Kaynak | Dış hedef (WAN adresi) | Dış port | Yönlendirilen iç IP | İç port |
|---|---|---|---|---|---|---|---|
| 1 | WAN | UDP | any | 185.126.217.99 | 3478 | 192.168.25.10 | 3478 |
| 2 | WAN | TCP | any | 185.126.217.99 | 3478 | 192.168.25.10 | 3478 |
| 3 | WAN | TCP | any | 185.126.217.99 | 5349 | 192.168.25.10 | 5349 |
| 4 | WAN | UDP | any | 185.126.217.99 | 49160–49199 (aralık) | 192.168.25.10 | 49160 (aralık 1:1, port değişmez) |

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

| Değişken | Nerede | Değer |
|---|---|---|
| `TURN_SECRET` | `deploy/.env` + `deploy/turn/.env` | `openssl rand -hex 32` (≥ 32; boşluk/`#` yok). İki dosyada aynı |
| `TURN_URLS` | `deploy/.env` | staging `stun:185.126.217.99:3478,turn:185.126.217.99:3478?transport=udp,turn:185.126.217.99:3478?transport=tcp,turns:185.126.217.99:5349?transport=tcp` |
| `TURN_CRED_TTL_MIN` | `deploy/.env` | boş = **20** (5..60; env.ts + compose varsayılanı, S-P3-6: credential oturum bitince iptal edilemez) |
| `METRICS_TOKEN` | `deploy/.env` | `openssl rand -hex 24`; `/metrics` Bearer (Caddy dışarıya 404) |
| `TURN_REALM` | `deploy/turn/.env` | staging `185.126.217.99`, prod `turn.<alan-adı>` |
| `TURN_EXTERNAL_IP` | `deploy/turn/.env` | staging `185.126.217.99/192.168.25.10` (public/özel) |
| `TURN_SECRET_PREVIOUS` | `deploy/turn/.env` | yalnız rotasyon sırasında (9.6) |
| `TURN_MAX_BPS` / `TURN_BPS_CAPACITY` | `deploy/turn/.env` | 8000000 / 0 (sınırsız; K3 ölçümüyle) |
| `TURN_PROMETHEUS_ADDRESS` | `deploy/turn/.env` | 127.0.0.1 (9641 dışa açılmaz) |
| `TURN_LISTEN_IPS` | `deploy/turn/.env` | staging/prod **`auto`** → `listening-ip=<özel relay IPv4>` + `listening-ip=127.0.0.1` (3478/5349 diğer Docker köprü ağ geçitlerinde ve IPv6'da dinlenmez). Virgüllü IPv4 listesi de verilebilir; 127.0.0.1 healthcheck (`turnutils_stunclient 127.0.0.1`) ve `test-denied.sh` (`TURN_HOST=127.0.0.1`) için her zaman eklenir. Boşsa coturn tüm arayüzlerde dinler, entrypoint UYARI yazar. Kontrol: `ss -tulnp \| grep -E ':(3478\|5349) '` |

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
Docker (DOCKER-*/nat) ve UFW (ufw-*) zincirlerine dokunmaz; diğer projelere etkisi yalnız "aralıktan çıkan UDP → kendi
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
| Arayüz | Proto | Dış hedef | Dış port | İç hedef | İç port | Not |
|---|---|---|---|---|---|---|
| WAN | UDP | 185.126.217.99 | 3478 | 192.168.25.10 | 3478 | STUN + TURN/UDP |
| WAN | TCP | 185.126.217.99 | 3478 | 192.168.25.10 | 3478 | TURN/TCP |
| WAN | TCP | 185.126.217.99 | 5349 | 192.168.25.10 | 5349 | TURN-TLS |
| WAN | UDP | 185.126.217.99 | 49160–49199 | 192.168.25.10 | 49160–49199 | relay, **1:1 (port değişmez)** |
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
  | Kural | Seviye | Anlamı / ilk adım |
  |---|---|---|
  | `rate(rs_file_meta_rate_limited_total{class="sender"}[5m]) > 0` | **Uyarı** | Gönderen tarafın `file.meta` raporu kotayı aştı: olası audit şişirme veya değiştirilmiş istemci (normal arayüz bu hıza ulaşmaz). Server logunda `event=file_meta_rate_limited` → `sessionId`, `side`; audit `file.meta.rate_limited` (oda+sınıf başına dakikada en çok 1 satır). Oturumu ve teknisyeni inceleyin; gerekirse oturumu zorla sonlandırın (AC-114). |
  | `increase(rs_file_meta_rate_limited_total{class="accepted"}[1h]) > 0` | Bilgi | Meşru yoğun dosya aktarımı da tetikleyebilir (dakikada 60 / oturumda 2000 OK+CORRUPT). Sürekli artıyorsa kota değerleri (`FILE_META_ACCEPTED_PER_*`) gözden geçirilir; tek oturumdan geliyorsa `sender` kuralı gibi incelenir. |
  | `declined` sınıfı | Bilgi | Otomatik ret/iptal döngüsü (istemci tekilleştirmesi bozuk olabilir); panoda izlenir, alarm yok. |

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

| Belirti | Kontrol / çözüm |
|---|---|
| coturn sürekli yeniden başlıyor | `docker compose logs coturn` → `turn-entrypoint:` satırı eksik env/local dosyayı söyler |
| `exec: turnserver: Operation not permitted` | `cap_add: [NET_BIND_SERVICE]` silinmiş (ikili dosya yeteneği taşır) |
| İstemciler relay adayı almıyor | `TURN_SECRET` iki .env'de farklı (log: `message integrity does not match`); `TURN_URLS`; UFW/NAT 3478 |
| Relay adayı var, medya yok | NAT relay aralığı 1:1 değil veya eksik; `TURN_EXTERNAL_IP` yanlış; `tcpdump -ni ens18 udp portrange 49160-49199` |
| `error 508` (kapasite) | 40 port dolu: `turn_allocations` metriği; test-denied çalışıyorsa bitmesini bekleyin |
| Relay↔relay (aynı TURN) medya yok | `host-firewall.sh print`: aralık `min-port/max-port` ile aynı mı; DROP sayacı artıyorsa hedef port aralık dışı (beklenen) |
| coturn logunda `ERROR no-cli option is deprecated` | base.conf'a `no-cli` eklenmiş — kaldırın (r5 m.3) |
| Her peer 403 | local dosyada çok geniş satır (ör. `::`); `docker compose run --rm -e TURN_CONFIG_CHECK=1 coturn` ile birleşik yapılandırmayı görün (secret maskeli) |
| TLS (5349) bağlanmıyor | `certs/turn.key` sahibi 65534 değil / dosya yok (logda `no-tls` UYARISI); test makinesinde `ca.crt` kurulu değil |
| Yalnız `turn:…?transport=tcp` ile ICE kurulmuyor (TEST-NAT-2) | Altyapı değil (2026-11-11 tanısı, implementation.md): `turnutils_uclient -t -y -n 50 -m 1 <özel IP>` 0 kayıp olmalı; minimal iki-PC Chrome testi bağlanıyorsa sorun uygulama/harness'ta (`ice.servers` → `setConfiguration`) |
| coturn logunda `udp send: Operation not permitted` | Çoğunlukla `REMOTE-TURN-OUT` DROP'u (relay → kendi adresi, aralık dışı port; test-denied'de beklenir): `iptables -L REMOTE-TURN-OUT -vnx` sayacı aynı anda artar. Tek satır bağlantıyı kesmez; sürekli artıyorsa `nf_conntrack_count/max` |
| UDP relay'de kayıp patlaması, TCP/TLS temiz (TEST-NAT-3) | Sunucu: `ip -s link show ens18` drop, `nstat -az UdpRcvbufErrors UdpSndbufErrors` 0 ise kayıp sunucu öncesinde (istemci uplink / pfSense UDP state-kuyruk); koşu sırasında `tcpdump -ni ens18 udp portrange 49160-49199` paket sayısını istemci kaybıyla karşılaştırın |

## 10. Gerçek sunucu e2e (yerel; P4 regresyonu, QA-P5-6)
Tek komut (repo kökü, Docker + `pnpm install` + Playwright chromium gerekir): `scripts/e2e-real.sh` (~2 dk).
1. Çalışma ağacının anlık görüntüsünü `$TMPDIR/rs-e2e-real.*/repo`'ya alır (APFS klon, `.git`/`.next` hariç) — paralel
   çalışan biri `apps/web/.next`'i veya kaynağı değiştirse de koşu tutarlı kalır.
2. Geçici MySQL `rs-mysql-e2e-real` (127.0.0.1:33317; entegrasyon testinin `rs-mysql-test`/33307'siyle çakışmaz) →
   migrate + grants → seed → `e2e:real:users` (iki ADMIN) → server :3302 → Playwright (web standalone build,
   `API_INTERNAL_URL=http://127.0.0.1:3302` derlemeye gömülü, :3218) → temizlik (trap: server, web, konteyner, kopya).
3. Seed/kullanıcı parolaları ve DB parolaları her koşuda rastgele; ekrana/dosyaya yazılmaz. Trace varsayılan kapalı
   (`E2E_REAL_TRACE=1` açar; iz o koşunun atılan parolasını içerir).

| Değişken | Varsayılan | Not |
|---|---|---|
| `E2E_DB_CONTAINER` / `E2E_DB_PORT` | `rs-mysql-e2e-real` / `33317` | çakışmada değiştirin |
| `E2E_SERVER_PORT` | `3302` | web portu 3218 sabit (config) |
| `E2E_KEEP_LOGS=1` | — | başarıda da `server.log` + `test-results/` saklanır |
| `E2E_REAL_REF=<git ref>` | — | çalışma ağacı yerine commit'lenmiş sürüm (karşılaştırma koşusu) |
| `TEST_DB_READY_TIMEOUT` | `180` | MySQL hazır olma bekleme süresi (sn); `test-db.sh` de okur |

Çıkış kodu: 0 geçti · 1 test kırmızı · 2 ön koşul (port/konteyner dolu, Docker yok) · 3 kurulum (DB/seed/server).
Kırmızıda loglar `$TMPDIR/rs-e2e-real.*/` altında kalır (yol son satırda yazılır).

| Belirti | Neden / çözüm |
|---|---|
| `KURULUM HATASI: test DB / migrate`, üstünde `test-db: HATA — … hazır olmadı` + konteyner logu (çıkış 3) | MySQL `TEST_DB_READY_TIMEOUT` (varsayılan 180 sn) içinde gerçek sunucuyu (`mysqld: ready for connections … port: 3306`) açmadı veya app/migrator `SELECT 1` geçmedi. Log `Switching to dedicated user 'mysql'`'de kaldıysa Docker Desktop VM'sinde gosu asılması (test-db.sh bunu `--user mysql` ile atlar; eski bir `E2E_REAL_REF` koşturuyorsanız o sürümde bu yoktur). Yüklü makinede `TEST_DB_READY_TIMEOUT=300`; sürekli tekrarlıyorsa Docker Desktop'ı yeniden başlatın (diğer konteynerleri de durdurur) |
| `ChunkLoadError` / `/_global-error` prerender `useContext` hatası | Ortak `.next` başka build tarafından ezildi veya `NODE_ENV=development` ile `next build` — betik ikisini de önler; elle koşuyorsanız `NODE_ENV`'i dışa aktarmayın |
| Ön koşul: `port … dolu` / `konteyner … zaten var` | önceki yarım koşu: `docker rm -f rs-mysql-e2e-real`, `lsof -nP -iTCP:3218 -sTCP:LISTEN` |
| 409 oturum oluşturma | AC-12 saatlik sınır; betik her koşuda yeni DB açtığı için normalde görülmez |
| Kurulum mu ürün mü? | `E2E_REAL_REF=<son yeşil commit> scripts/e2e-real.sh`: o da aynı yerde kırmızıysa ortam/kurulum, yeşilse ürün regresyonu |

## 11. Windows istemci yayını (P6; ADR-0010, G-07, AC-94/96/128)
Akış: `agent-win.yml` (CI) → iki bağımsız build'in SHA-256 eşitliği → `SHA256SUMS` → build provenance attestation →
(etiket) onaylı Release → operatör makinesinde `deploy/agent/verify-and-publish.sh` (SHA256SUMS + `gh attestation verify`)
→ sunucuda `agent_downloads` volume'u + `deploy/.env` `AGENT_SHA256` → `docker compose up -d --no-deps server` →
Caddy `/downloads/NoktaDestek.exe` hash kontrolü. Caddy her `/downloads/*.exe` isteğinde server'ın hash kapısına
(`forward_auth` → `/internal/agent-ready`) sorar; uyuşmazlıkta 503 (fail-closed, S6-2). Günlük dış gözcü: `agent-watch.yml`.

### 11.1 Tek seferlik GitHub ayarları (repo sahibi)
| Ayar | Değer |
|---|---|
| Repo değişkeni `AGENT_SERVER_URL` | exe'ye ldflags ile gömülen tek adres, ör. `https://185.126.217.99:4450` (staging). Etiket build'i bu değişken yoksa durur. Prod için ayrı değer/etiket (P13) |
| Environment `agent-release` | Settings → Environments: required reviewers (kendiniz), "Deployment tags": `v*` |
| Tag ruleset | `v*` etiketlerini yalnız yöneticiler oluşturabilir/silebilir (AC-94 "korumalı v* etiketi") |
| Branch protection (main) | required checks: `ci` job'ları + `agent-win` → `check`, `test-windows`, `build 1/2`, `build 2/2`, `tekrarlanabilirlik + SHA256SUMS` |
| Repo değişkenleri (gözcü) | `AGENT_WATCH_URL` = `https://<host>:4450/downloads/NoktaDestek.exe`; staging'de `AGENT_WATCH_CA_PEM` = §8'deki Caddy kök sertifikası (PEM, gizli değil) |
| Görünürlük | **Repo public olmalı**: GitHub attestation private repoda yalnız Enterprise Cloud'da çalışır (§11.6) |

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
1. main yeşil (özellikle `check`: govulncheck + lisans). `git tag -s vX.Y.Z && git push origin vX.Y.Z`.
2. Actions → agent-win → `agent-release` onayı → Release'de `NoktaDestek.exe` + `SHA256SUMS`.
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

### 11.5 Staging test yayını (Release'siz, main artifact'i)
`gh run list --repo NoktaBilisim/Remote --workflow agent-win.yml --branch main --event push -L 5` → run-id →
`deploy/agent/verify-and-publish.sh --run <run-id> --ssh root@185.126.217.99` (attestation `--source-ref refs/heads/main`).
Yalnız main push koşuları kabul edilir. Koşu `success` değilse (ör. govulncheck kırmızı) **reddedilir** (S6-5); yalnız
staging için bilerek: `--allow-failed-run` (etiket `run-<id>-failedrun` olarak `PUBLISHED.log`'a yazılır) — prod'a asla.
Not: PR ve elle tetiklenen (`workflow_dispatch`) derlemelerde exe'ye yer tutucu `https://destek.example.invalid:4450`
gömülür; gerçek `AGENT_SERVER_URL` yalnız main/etiket push'unda (S6-4). Bu yüzden staging'e yalnız main push artifact'i konur.

### 11.6 Repo private iken (geçici, yalnız staging)
Attestation üretilemez/doğrulanamaz. `--dir` (yerel exe+SHA256SUMS) ile `--no-attestation` birlikte kökeni hiç kanıtlanmamış
dosya demektir; betik bunu yalnız açık `ALLOW_UNATTESTED=staging` ile kabul eder (etiket `dir-<zaman>-unattested`). Staging için: `ALLOW_UNATTESTED=staging deploy/agent/verify-and-publish.sh --run <id>
--ssh root@185.126.217.99 --no-attestation` (köken = GitHub'dan kimlikli indirme + SHA256SUMS; etiket `-unattested` ekiyle
kaydedilir). Prod açılışı (P10/P13) öncesi repo public yapılır ve bu yol kullanılmaz.

### 11.7 Alarm: istemci bütünlüğü (agent-watch issue / server `alarm: "agent_binary"` `mismatch`)
Güvenlik olayıdır. 1) Volume'a elle dokunmayın; kanıt için hash alın: `docker compose exec server sha256sum /data/downloads/NoktaDestek.exe`.
2) Sunucu erişim/SSH loglarını ve `deploy/agent/PUBLISHED.log`'u inceleyin. 3) Son Release'i §11.3 ile yeniden yayınlayın; agent-watch'u
elle tetikleyin (Actions → agent-watch → Run workflow), yeşil olunca issue'yu kapatın. 4) Sunucu ele geçirilmiş olabilir şüphesinde
indirmeyi kapatın (`AGENT_SHA256=` boş → `docker compose up -d --no-deps server` → 503; müşteri tarayıcı modunu kullanır).
**Sunucu erişilemez alarmı** (agent-watch issue başlığı "sunucu erişilemez", HTTP 502/504): bütünlük olayı değildir. Caddy
server'a ulaşamıyor: `docker compose ps server` + `docker compose logs --tail 200 server` (§5, §7); server healthy olunca
agent-watch'u elle tetikleyin, yeşilse issue'yu kapatın. 503 ise yukarıdaki bütünlük adımları (dosya yok / hash uyuşmazlığı).
| Belirti | Neden / çözüm |
|---|---|
| `agent-win` `test-windows` kırmızı: "İZ BULUNDU" | trace-check (AC-108) istemciye ait yeni girdi buldu; koşu çıktısındaki satır kategori + yolu gösterir (§11.8) |
| `test-windows` uyarı "WM_CLOSE ile kapanmadı" | runner'da etkileşimli masaüstü yok, istemci zorla kapatıldı; iz testi yine koşar ama kapanış yolu sınanmamıştır → §11.8 elle test |
| `build` kırmızı: "etiket derlemesi yalnız etiket push'unda" | etiket üzerinde elle tetikleme; Release yalnız etiket push'uyla (S6-4) |
| `--run` "koşu sonucu 'failure' … yayınlanmadı" | S6-5: önce koşuyu yeşile çekin; yalnız staging'de bilerek `--allow-failed-run` |
| `agent-win` `check` kırmızı: govulncheck | Go/x/net zafiyeti; go.mod `toolchain` + bağımlılık yükseltilir, `GO_IMAGE`/`GO_VERSION` (agent-win.yml, agent-watch.yml) aynı sürüme |
| `check`: "imaj goX, go.mod goY" | go.mod toolchain değişti; iki workflow'daki imaj etiketi + digest güncellenir (`docker buildx imagetools inspect golang:<sürüm>-bookworm`) |
| `tekrarlanabilirlik` kırmızı | build.sh/winres/zaman damgası kaynağı; iki artifact'i indirip `cmp -l` ile fark bulun |
| `attest` "Feature not available" | repo private (§11.6) |
| betik `gh attestation verify başarısız` | yanlış etiket/run, fork'tan build veya dosya değişmiş — yayınlamayın |
| agent-watch "AGENT_WATCH_URL tanımlı değil" | §11.1 değişkenleri |

### 11.8 İz testi: `apps/agent-win/test/trace-check.ps1` (AC-108, T17; P6 DoD)
Salt okunur PowerShell betiği (Windows PowerShell 5.1 ve 7). Taradığı yerler: HKCU/HKLM `Software` (+WOW6432Node) anahtar
adları, HKCU/HKLM `Run`/`RunOnce`, servisler (ad + ImagePath), zamanlanmış görevler (+ eylem komutu), kullanıcı/ortak Başlangıç
klasörü (.lnk hedefi), `%APPDATA%`, `%LOCALAPPDATA%`, `%TEMP%`, İndirilenler (yarım `*.part`), açık istemci süreci.
İz deseni: `NoktaDestek`, `Nokta Destek`, `Destek-<8 hane>`, `remote-support`, `-ExePath` dosya adı. Windows'un kendi kayıtları
(Prefetch, AmCache, UserAssist, MuiCache, AppCompatFlags) istemci verisi değildir, taranmaz.
| Mod | Ne yapar |
|---|---|
| `-Mode Snapshot -SnapshotPath <json>` | çalıştırmadan önceki durumu kaydeder (tek yazım bu dosya) |
| `-Mode Compare -SnapshotPath <json> [-ExePath <exe>] [-Strict]` | sonrası ile fark: desene uyan yeni girdi / yeni `.part` / açık süreç = iz. Desene uymayan yeniler "İNCELEYİN" listesi (`-Strict` ile onlar da iz) |
| `-Mode Check` (varsayılan) | önceki durum yok; desene uyan her girdi iz |
Çıkış kodu: **0** temiz · **1** iz bulundu · **2** kullanım/ortam hatası (Windows değil, snapshot okunamadı).

**CI:** `agent-win.yml` → `test-windows` job'u her PR/push'ta yer tutucu adresli exe'yi `Destek-12345678.exe` adıyla
başlatır (resolve ağ hatası → kod penceresi; hiçbir sunucuya istek gitmez), 15 sn sonra `WM_CLOSE` ile kapatır ve Compare
koşar. Oturum, dosya aktarımı ve ekran yakalama CI'da yoktur; bunlar için aşağıdaki elle test **zorunludur** (DoD).

**Elle test (temiz Windows 10 22H2 / 11 VM, standart kullanıcı):**
1. Repo'yu ya da yalnız `trace-check.ps1`'i VM'e kopyalayın (ör. `C:\iz\`). PowerShell 7 yoksa `powershell -ExecutionPolicy Bypass -File ...`.
2. `pwsh -File C:\iz	race-check.ps1 -Mode Snapshot -SnapshotPath C:\iz\once.json`
3. Exe'yi tarayıcıdan indirin (`Destek-<kod>.exe`), implementation.md "Windows'ta elle doğrulanacaklar" 1-12 akışını yapın:
   oturum, sohbet, bir dosya kabul, bir aktarımı yarıda iptal, "Oturumu bitir" → program kapanır.
4. `pwsh -File C:\iz	race-check.ps1 -Mode Compare -SnapshotPath C:\iz\once.json -ExePath "$env:USERPROFILE\Downloads\Destek-<kod>.exe"`
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
- Staging: `WHATSAPP_SERVICE_URL` boş (varsayılan `http://89.252.189.211:3000`, kimliksiz, internete açık). Mesajda kişisel veri yok (§13.5 şablonu).
- **Prod açılışından önce (P13 kontrol listesi):** servis TLS arkasında (`https://…`) **veya** özel ağda; servis host güvenlik duvarında 3000 yalnız Remote sunucusunun çıkış IP'sine açık. Doğrulama: başka bir dış makineden `curl -m 5 http://<servis>:3000/` zaman aşımı; Remote sunucusundan Ayarlar > Destek talepleri > "Test Mesajı Gönder" başarılı. Aksi halde server kanalı zaten kapalı başlatır (log `alarm:"whatsapp_insecure"`, ayar ekranında uyarı) — bu bir arıza değil, ön koşul eksikliğidir.
- Servis API anahtarı desteği "Sonra" (servis destekleyince env eklenir).

### 12.4 `MIN_AGENT_VERSION` — güvenlik yamasında yükseltme
1. Yamalı istemciyi §11.3 ile yayınlayın (`verify-and-publish.sh`; firma dosyaları ve `NoktaDestek.exe` aynı ikilidir, bağlantılar değişmez).
2. `.env`'de `MIN_AGENT_VERSION=<yamalı sürüm>` → `docker compose up -d server`.
3. Eski istemci açan müşteri "Bu Hızlı Destek dosyası eski" + "Yeni sürümü indir" görür (talep modunda aynı firma bağlantısından yenisini indirir); kod modunda teknisyenden yeni bağlantı ister.
4. Doğrulama: server logunda `CLIENT_OUTDATED` (426) sayısı; geri almak için değeri önceki sürüme çekip `up -d server`.

### 12.5 Metrikler ve alarmlar (`/metrics`, Bearer `METRICS_TOKEN`; adlar mimari-e9 §8, server tarafı backend)
| Kural (PromQL) | Seviye | Anlamı / ilk adım |
|---|---|---|
| `increase(rs_request_ref_invalid_total[1m]) > 100` | **Uyarı** | Ref numaralandırma denemesi (T28). Engelleme değil alarm (IP kovası zaten 15 dk 429). Caddy logunda kaynak IP dağılımı: `docker compose logs caddy --since 15m \| grep -o '"client_ip":"[^"]*"' \| sort \| uniq -c \| sort -rn \| head` |
| `sum(increase(rs_request_notify_total{channel="whatsapp",result="failed"}[15m])) / sum(increase(rs_request_notify_total{channel="whatsapp",result=~"ok\|failed"}[15m])) > 0.5` | **Uyarı** | WhatsApp servisi ulaşılamıyor/hata dönüyor. `docker compose logs server --since 15m \| grep -i whatsapp`; servis sahibine bildirin. Panel bildirimi (birincil kanal) etkilenmez |
| `increase(rs_request_rate_limited_total{bucket="tenant"}[10m]) > 0` | **Uyarı** | Tenant'a olağan dışı talep yoğunluğu (G-E9-7); panelde uyarı bandı çıkar. Admin'e "bağlantıyı yenile" önerin (ref yenileme) |
| `sum(rs_requests_pending) > 400` | Uyarı | Sistem geneli hedef ≤ 500 bekleyen; teknisyen yokluğu veya spam. Tenant dağılımı için SQL: `SELECT tenant_id, COUNT(*) FROM support_requests WHERE status='PENDING' GROUP BY tenant_id` |
| `rs_ws_connections{role="request"}` / `{role="panel"}` | Pano | Bekleyen müşteri ve açık panel sayısı; `request` ≈ `rs_requests_pending` olmalı (fark büyükse kopan istemciler) |
| server log `alarm:"whatsapp_global_cap"` | Bilgi | Saatlik 300 global WhatsApp sınırı aşıldı, özet mesajlara düşüldü |
| server log `alarm:"db_busy"` (metrik yok; log sayımı: `docker compose logs server --since 5m \| grep -c '"alarm":"db_busy"'`) — 5 dk'da > 20 **veya** 15 dk boyunca her 5 dk'da > 0 | **Uyarı** | Geçici DB çekişmesi → istemciye 503 `NOT_READY` + `Retry-After` (errors.ts; kod alanı: `P2028` TX/havuz bekleme, `P2034`/`1213` deadlock, `1205` kilit bekleme, `45028` havuzdan bağlantı alınamadı). Bağlam: talep oluşturma TX'i tenant ayar satırını kilitler; talep kapısı (S8b-5, düzeltildi) talepleri havuzun (10 bağlantı) en çok 4'üyle sınırlar, giriş/panel/WS için en az 6 kalır. Başarısız giriş sayacı DB'ye yazılamazsa bellek içi yedek kova kilidi yine uygular (S8b-6, düzeltildi; `auth_fail_counter_fallback` satırı). İlk adım: (1) kod dağılımı `docker compose logs server --since 15m \| grep '"alarm":"db_busy"' \| grep -o '"code":[^,}]*' \| sort \| uniq -c`; (2) eşzamanlı `rs_requests_created_total` / `rs_request_rate_limited_total` artışı → talep yığılması (tenant dağılımı §12.5 SQL); (3) MySQL tarafı `docker compose exec mysql mysql -uroot -p -e "SHOW PROCESSLIST; SHOW ENGINE INNODB STATUS\G" \| grep -A20 "LATEST DETECTED DEADLOCK"`; (4) uzun süren sorgu veya yedek alma çakışması varsa bitmesini bekleyin. Sürekli ise `docker compose restart server` havuzu boşaltır (geçici); kalıcıysa DB kaynakları/sorgu planı incelenir |
| `increase(rs_request_gate_rejected_total[5m]) > 0` (`reason="full"` veya `"timeout"`) | **Uyarı** | Talep oluşturma kapısı doldu (S8b-5: firma başına 2, toplam 4 eşzamanlı; kuyruk 16/64, bekleme 5 sn) → müşteriye 503 `NOT_READY` + `Retry-After: 5`. Ani talep yığılması veya yavaş DB. `db_busy` satırıyla birlikte değerlendirin; sürekli artış havuz/DB kaynak yetersizliğidir. Firma dağılımı: `docker compose logs server --since 15m \| grep '"alarm":"request_gate_busy"' \| grep -o '"tenantId":"[^"]*"' \| sort \| uniq -c` |
| server log `alarm:"request_gate_busy"` (10 sn'de en çok 1; `reason`, `tenantId`; PII yok) | Uyarı | Yukarıdaki metriğin log karşılığı; metrik toplanmıyorsa log sayımı: `docker compose logs server --since 5m \| grep -c '"alarm":"request_gate_busy"'` > 0 |
| server log `alarm:"auth_fail_counter_fallback"` (`userId`, `code`, `lockedNow`) | **Uyarı** | Başarısız giriş sayacı DB'ye yazılamadı; hesap kilidi bellek içi yedek kovayla uygulandı (S8b-6, fail-closed). Tekil olay: DB çekişmesi (`db_busy` ile aynı pencere). Aynı `userId` için tekrar ediyorsa kaba kuvvet denemesi + DB sorunu birlikte: §7 DB kontrolleri, kullanıcı audit kaydı. Server yeniden başlarsa yedek kova sıfırlanır |
| server log `alarm:"auth_fail_unrecorded"` (`userId`, `pairLocked`/`locked`, `lockedNow`, `code`) | **Uyarı** | Başarısız giriş veya kilit audit'e yazılamadı (yanıt yine 401/423; S8b-6/S8b-7). Audit eksikliği demektir: olay zamanını ve `userId`'yi not edin, DB sorunu giderilince güvenlik ekibine bildirin. 5 dk'da > 5 ise DB'yi kontrol edin (§7, `db_busy`) |
Kabul süresi (ayrı metrik yok): `SELECT DATE(created_at) g, COUNT(*), AVG(TIMESTAMPDIFF(SECOND, created_at, accepted_at)) ort_sn FROM support_requests WHERE accepted_at IS NOT NULL AND created_at > NOW() - INTERVAL 7 DAY GROUP BY g`.

### 12.6 Sorun giderme (P8b)
| Belirti | Kontrol / çözüm |
|---|---|
| Firma bağlantısı / dosyası 404 | Ref yenilenmiş, tenant pasif veya Admin ayar ekranını hiç açmamış (ref tembel oluşur, K14). Firma kısa adı değiştiyse eski adlı dosya 404 (label uyuşmaz, G-E9-11) → Admin bağlantıyı yeniler. İç uç elle: `docker compose exec caddy wget -S -O- --header 'X-Forwarded-Method: GET' --header 'X-Forwarded-Uri: /downloads/NoktaDestek-<label>-<ref>.exe' http://server:3001/internal/agent-ready` → 204 |
| Firma dosyası 503 | P6 ikili kapısı (§7 `agent_binary` satırı) |
| Firma dosyası 404 ama ad doğru görünüyor | Caddy biçimi: label `[A-Za-z0-9]{1,20}`, ref `[a-z2-7]{16}`, büyük/küçük harf duyarlı; biçim dışı ad server'a hiç gitmez. `deploy/test-caddy.sh` |
| WhatsApp gelmiyor | Tenant ayarında kanal açık + alıcı var mı; Ayarlar > "Test Mesajı Gönder"; prod'da `alarm:"whatsapp_insecure"` (§12.3); saatlik sınırlar (tenant 30, alıcı 10, global 300 → özet); audit `request.notify` |
| Müşteri "dosya eski" görüyor | `MIN_AGENT_VERSION` > istemci sürümü (§12.4); yanlışlıkla yükseltildiyse geri çekin |
| `/ws/request` veya `/ws/panel` 502 | server ayakta değil (§7); nginx/Caddy WS ayarı değişmedi (`/ws/*` aynı kural) |
| Seed sonrası müşteri karşılamada 400 | AC-127: yeni aydınlatma sürümü; müşteri sayfayı yenilesin (§12.1/4) |
| Talep 429 `QUEUE_FULL` / `RATE_LIMITED` | Tenant 50 bekleyen, IP/önek kovaları (mimari-e9 §5.4, §13.6); NAT'lı ofis için Admin "güvenilen IP/CIDR" ekleyebilir |

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
   ile yeniden çalıştırın (`docs/db-notlari.md` "Geri doldurma (idempotent)").
7. **Teknisyen hesabı:** `bash staging-users.sh` → USER'a `customers.view/create/edit/delete` eklenir (mevcut hesaba
   `INSERT IGNORE`; Admin'in elle kapattığı satıra dokunmaz). Çıktı: `USER: exists (...) - ..., eksik yetkiler eklendi`.
   Kullanıcı yeniden giriş yapınca "Müşteriler" menüsü görünür.
8. **Doğrulama** (panelde Admin ile "Müşteriler > Yeni müşteri", ardından satırdaki "Kopyala"):
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
   (yayını durdurmaz). Panelde müşteriyi **pasife alın** → kopyaladığınız bağlantı 404 olmalı (ilk curl `location` yerine 404).
9. §8 yayın geçmişi tablosuna satır ekleyin (commit, migration, yedek dosya adı, grants sonucu, seed çıktısı).

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
| İşlem (panel) | Yetki | Etkilenen kayıtlar (`device_bindings`) | Bekleyen talepler | Müşteri dosyası / bağlantı |
|---|---|---|---|---|
| Talep kartı ⋯ > **"Bu bilgisayarın kaydını iptal et"** (`POST /support-requests/:id/revoke-binding`) | `customers.edit` | Yalnız o talebi açan kayıt → `ADMIN_REVOKED` | Aynı kaydın bekleyenleri `CANCELLED(BINDING_REVOKED)` | Değişmez |
| Müşteri detayı > **"Bağlantıyı yenile"** (`POST /customers/:id/rotate-ref`) | `customers.edit` | O müşterinin tüm etkin kayıtları → `CUSTOMER_ROTATED` | Etkilenmez (kartta "bağlantı yenilenmeden önce açıldı" uyarısı; kabul edilirse kayıt **verilmez**) | Eski ref anında 404; yeni bağlantı müşteriye gönderilir |
| Müşteri > **"Pasife al"** (`POST /customers/:id/deactivate`) | `customers.delete` | O müşterinin tüm kayıtları → `CUSTOMER_PASSIVE` | `CANCELLED(CUSTOMER_PASSIVE)` (≤ 60 sn, süpürücü yedek) | 404; seçim listesinden çıkar |
| Müşteri > **"Aktif et"** (`POST /customers/:id/reactivate`) | `customers.edit` | (zaten geçersiz) | — | **Yeni** ref; eski ref asla dirilmez (`request_refs`) |
| Ayarlar > Destek talepleri > **Genel bağlantıyı yenile** | `settings.edit` | Tenant'ın tüm Genel (müşterisiz) kayıtları → `GENERAL_ROTATED` | Etkilenmez | Genel ref 404 |
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
| Olay | Belirti | Sınırlama (ilk 15 dk) | Not |
|---|---|---|---|
| **Müşteri dosyası / bağlantısı sızdı** (ör. herkese açık paylaşıldı) | O müşteriden tanımadığınız kişi adına talepler, `rs_request_rate_limited_total` artışı | Müşteri > **Bağlantıyı yenile** (o müşterinin kayıtları da düşer) | Yeni bağlantıyı yetkili kişiye kayıtlı numaradan teyitle gönderin |
| **Tek kayıtlı bilgisayar kötüye kullanılıyor** (aynı bilgisayardan istenmeyen talepler) | Kartlarda aynı "Kayıtlı bilgisayar" kaynağı, `req.create.binding` 6/sa sınırına takılma | Talep kartı > **"Bu bilgisayarın kaydını iptal et"** (§13.3) | Bağlantıyı yenilemek **yalnız** dosya da sızdıysa; aksi halde müşterinin diğer bilgisayarlarını gereksiz düşürür |
| **Genel dosya sızdı** | Genel'e düşen beklenmedik talepler | Ayarlar > **Genel bağlantıyı yenile** (tüm Genel kayıtlar düşer) | Müşteri firmaya ait dosyalar etkilenmez |
| **`hatirla.bin` / kayıt anahtarı sızdı** (yedek, zararlı yazılım) | Aynı kayıttan farklı IP'lerden talep | Önce tek kayıt iptali; müşteri bilgisayarında istemciden **"Bu bilgisayarı unut"** | Anahtar her başarılı oturumda döndürülür; sızan eski anahtar bir sonraki oturumdan sonra zaten ölür |
| **Kayıt anahtarı/ref tahmini** (numaralandırma) | `rs_request_ref_invalid_total` / `rs_binding_invalid_total` sıçraması | Kendiliğinden: IP kovası 10/dk → 15 dk blok. §12.5 Caddy IP dağılımı | Kalıcıysa üst güvenlik duvarında IP/önek engeli |
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
| Seri | Tür | Pano / kural | Anlamı / ilk adım |
|---|---|---|---|
| `rs_customers_active` | gauge (günlük) | Pano | Tenant'lar toplamı aktif müşteri; tasarım tavanı ~1.000/tenant (mimari-e10 §7) |
| `rs_bindings_issued_total{renewed}` | counter | Pano: `sum by (renewed)(increase(...[1d]))` | `renewed="false"` yeni bilgisayar, `"true"` rotasyon. 0.10.0 yayınından sonra artmıyorsa `binding.offer` gitmiyor (istemci sürümü / ticket `clientVersion`) |
| `rs_binding_denied_total{reason}` | counter | Pano | P8c-1 B-P8c-4: verilmeyen kayıtlar. `stale_source` (yenileme/iptal öncesi açılmış talep) ve `inactive` (oturum/tenant/müşteri pasif) audit `binding.denied` ile de görünür; `rate` (oturum başına > 3), `no_offer`, `browser` yalnız metrik. `rate`/`no_offer` sürekli artışı → bozuk ya da sahte istemci |
| `rs_binding_invalid_total` | counter | Pano; `rs_request_ref_invalid_total` alarmına zaten dahil | Bağlantı yenileme/pasif sonrası geçici sıçrama **beklenir** (eski kayıtlı bilgisayarlar açılışta 404 alır). Yenileme olmadan sürekli artış → §13.4 numaralandırma satırı |
| `rs_bindings_revoked_total{reason}` | counter | Pano: `sum by (reason)(increase(...[1d]))` | `FORGOTTEN` müşteri "unut", `ADMIN_REVOKED` panel iptali, `CUSTOMER_*`/`GENERAL_ROTATED` toplu, `REPLACED` başka tenant'a geçiş, `EXPIRED` günlük 03:30 iş, `TENANT_PASSIVE` |
| `rs_requests_created_total{via}` | counter | Pano: `sum by (via)(rate(...[1h]))` | `via="ref"` dosya/bağlantı, `"binding"` kayıtlı bilgisayar |
| Alarm `increase(rs_request_ref_invalid_total[1m]) > 100` | **Uyarı** (mevcut, §12.5) | — | Kayıt geçersizleri de bu kovaya sayılır |
| Alarm `increase(rs_bindings_revoked_total{reason="ADMIN_REVOKED"}[1h]) > 10` | Bilgi | — | Bir saatte çok sayıda tek kayıt iptali: kötüye kullanım dalgası olabilir; §13.4 inceleme sorgusu |
| Haftalık bakış: günlük 03:30 boşta kalma işi | Bilgi | SQL (beklenen 0): `SELECT COUNT(*) FROM device_bindings WHERE revoked_at IS NULL AND last_used_at < NOW() - INTERVAL 731 DAY` | 730 gün en uzun saklama süresidir; `> 0` ise iş çalışmıyor → `docker compose logs server --since 26h` içinde iş hatası, backend-dev |
Etiket değerleri sabit kümedir (IP, tenant, müşteri kimliği etiket olmaz). Metrik toplayıcı (Prometheus) bu projede henüz
kurulu değil (P13); o zamana kadar §13.1/8'deki `/metrics` komutuyla elle okunur.

### 13.6 Sorun giderme (P8c)
| Belirti | Kontrol / çözüm |
|---|---|
| Müşteri bağlantısı 404 | Müşteri pasif veya bağlantı yenilenmiş (detayda ref/durum); tenant pasif. Etiket değiştiyse dosya adı değişir → yeni bağlantıyı kopyalayın. İç uç: §12.6 `agent-ready` komutu, müşteri ref + müşterinin güncel `file_label`'ı ile 204 |
| Müşteri "Bu bilgisayarın destek kaydı artık geçerli değil." görüyor | Beklenen durumlar: unutuldu, panelden iptal, müşteri yenilendi/pasif, Genel yenilendi, tenant pasif, saklama süresi kadar kullanılmadı. Müşteri bağlantı kodu veya güncel dosya ile devam eder; başarılı oturumdan sonra yeni kayıt alır. Nedeni: `device_bindings.revoke_reason` (§13.4 sorgu) |
| Kayıt hiç verilmiyor (`rs_bindings_issued_total` düz) | İstemci < 0.10.0 (teklif gönderilmez, tasarım gereği); oturum talepten bayat kaynakla doğdu (audit `binding.denied{reason:"stale_source"}`); müşteri pasif (`CONFLICT`) |
| "Müşteriler" menüsü yok | Kullanıcıda `customers.view` yok (User varsayılan kapalı) → Admin toggle'dan açar; staging teknisyeni için `staging-users.sh` (§13.1/7) |
| Migrate 3819 / 1452 ile durdu | Migration expand-only; beklenmez. `docker compose logs migrate` → kısıt adını dba'ya bildirin, §13.2/1 ile önceki imaja dönün, Prisma kaydını `migrate resolve --rolled-back 20261112120000_p8c_customers` ile kapatın |
| `down.sql` 3819 `p8c_down_guard_chk` | §13.2/2 — tasarım gereği; satırlara dokunmayın |
| Seed sonrası müşteri karşılamada 400 | §13.1 yayın notu; müşteri sayfayı yeniler |

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
