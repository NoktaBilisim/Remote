# DB Notları — Remote Support (P1–P8)
Sahibi: dba. Tasarım kaynağı: `docs/mimari.md` §3, ADR-0003. MySQL 8.4, Prisma 7.10.1 (stabil; 8.x RC kullanılmadı).

## Dosyalar
| Dosya | Amaç |
|---|---|
| `apps/server/prisma/schema.prisma` | Şema (P1 tabloları) |
| `apps/server/prisma.config.ts` | Prisma 7 config: migration yolu, seed, URL = `MIGRATE_DATABASE_URL ?? DATABASE_URL` |
| `apps/server/prisma/migrations/20261111000000_p1_init/{migration.sql,down.sql}` | İlk migration + elle geri alma |
| `apps/server/prisma/sql/grants.sql` | `app` tablo yetkileri (migrator çalıştırır, idempotent) |
| `apps/server/prisma/seed.ts` | Super Admin + demo tenant (idempotent) |
| `deploy/mysql/init/01-users.sh` | MySQL ilk açılışta `migrator` + `app` kullanıcılarını oluşturur |
| `deploy/mysql/check-app-grants.sh` | `app` yetki sınırı kontrolü (22 kontrol; geçici tenant/ayar/kullanıcı ekler, sonda siler — boş DB'de de çalışır) |

## Tablolar (P1)
Ortak: PK ULID `CHAR(26)` (uygulama üretir), `created_at/updated_at DATETIME(3)` UTC, enum'lar `VARCHAR(20)` + **CHECK** (biçim: `` CAST(`col` AS BINARY) IN (…) `` — ADR-0014; metin biçimi `REGEXP_LIKE(…, 'c')`), tüm FK `ON DELETE/UPDATE RESTRICT`, utf8mb4_unicode_ci.
| Tablo | Anahtar / indeks | Not |
|---|---|---|
| `tenants` | PK id, UQ slug | soft delete (`deleted_at`, `status`) |
| `tenant_settings` | PK/FK tenant_id | 1-1; aralıklar CHECK ile (15..30, 1..10, 1..8, 1..2048, 90..730), `smtp_security` CHECK; `smtp_pass_enc` AES-GCM |
| `users` | UQ email, UQ username, IX(tenant_id, status) | argon2id; CHECK: role/theme/status, `SUPER_ADMIN ⇔ tenant_id IS NULL`; `must_change_password` vars. true |
| `user_permissions` | PK(user_id, perm_key) | anahtarlar `packages/contracts/src/permissions.ts` |
| `auth_sessions` | UQ token_hash, IX(user_id, revoked_at), IX(expires_at) | token SHA-256; `expires_at` indeksi retention silmesi için |
| `audit_logs` | PK BIGINT AI, IX(tenant_id, created_at), IX(tenant_id, user_id, created_at), IX(tenant_id, action, created_at), IX(created_at) | append-only, `updated_at` yok; `user_id` bilinçli FK değil (başarısız giriş, kullanıcıdan bağımsız kalıcılık); `result` CHECK success/fail |

Enum vs lookup: değer kümeleri sabit ve kodla birlikte değişir → VARCHAR + zod + CHECK (lookup tablosu gereksiz). Büyüme: `audit_logs` en hızlı büyüyen tablo; 730 gün retention `IX(created_at)` ile parti silme (P13); partition gerekmez (§7). Para alanı yok.

## DB kullanıcıları (G-15)
| Kullanıcı | Yetki | Env | Kullanan |
|---|---|---|---|
| `migrator`@`%` | `ALL ON <db>.* WITH GRANT OPTION` (DDL, TRIGGER, grants.sql) | `MIGRATE_DATABASE_URL` | yalnız tek seferlik `migrate` servisi |
| `app`@`%` | Tablo bazlı: 5 tabloda SELECT/INSERT/UPDATE/DELETE; `audit_logs` yalnız SELECT/INSERT (UPDATE/DELETE/ALTER/DROP/TRIGGER yok; DELETE yetkisi retention/tetikleyiciyle birlikte (P11/P13) verilecek; o pakette grants.sql güncellenir); `_prisma_migrations` SELECT | `DATABASE_URL` | server + seed |
- `01-users.sh` env: `MYSQL_ROOT_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_APP_PASSWORD`, `MYSQL_MIGRATOR_PASSWORD` (tırnak/ters bölü içeremez). Yalnız boş veri dizininde çalışır; parola değişimi runbook'ta `ALTER USER` ile.
- **Kural:** yeni tablo ekleyen her migration `grants.sql`'e GRANT satırı ekler (DB düzeyi `app` yetkisi yok, çünkü audit_logs UPDATE'i tablo düzeyinde düşürülemez).
- MySQL 8.4 `caching_sha2_password` + TLS'siz iç ağ: `DATABASE_URL`'e `?allowPublicKeyRetrieval=true` gerekir (mariadb sürücüsü; yoksa `ER_CANNOT_RETRIEVE_RSA_KEY`). MySQL portu dışa açılmamalı.
- **P11 için:** binlog açıkken migrator `CREATE TRIGGER` → ERROR 1419. Seçenek: mysqld `--log-bin-trust-function-creators=1` (8.4'te deprecated uyarısı) veya `--disable-log-bin` (PITR yok, yedek mysqldump). Test edildi: bayrak açıkken migrator tetikleyici oluşturur, `app` 1142 "TRIGGER command denied" alır.

## Compose (devops için)
- mysql: `mysql:8.4`, `--default-time-zone=+00:00`, `./mysql/init:/docker-entrypoint-initdb.d:ro`, healthcheck.
- migrate: `pnpm --filter @remote/server db:migrate` (= `prisma migrate deploy && prisma db execute --file prisma/sql/grants.sql`), env yalnız `MIGRATE_DATABASE_URL`.
- server: `depends_on: migrate (service_completed_successfully)`, env `DATABASE_URL`; `MIGRATE_DATABASE_URL` verilmez.
- seed: ilk kurulumda `pnpm --filter @remote/server db:seed` (`DATABASE_URL`, `SEED_SUPERADMIN_*`). Prod'da (`NODE_ENV=production`) demo tenant oluşmaz.

## Migration / geri alma
- Yeni migration: şemayı değiştir → `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script` ile yeni klasör (shadow DB/CREATE *.* yetkisi gerekmez) + elle `down.sql`. Expand → contract.
- Geri alma (veri silinir, önce yedek): `prisma db execute --file prisma/migrations/<ad>/down.sql` (migrator). `down.sql` `_prisma_migrations` kaydını da siler; `migrate resolve --rolled-back` başarılı migration'da çalışmaz.
- Elle eklenenler `migration.sql` içinde yorumlu: CHECK kısıtları (Prisma ifade edemez; MySQL drift'inde karşılaştırılmaz — `migrate diff --exit-code` = 0 doğrulandı).

## Seed
`SEED_SUPERADMIN_EMAIL`, `SEED_SUPERADMIN_PASSWORD` (12..200), `SEED_SUPERADMIN_NAME?`. Super Admin `must_change_password=true`, argon2id m=19456 t=2 p=1; var olan kullanıcının parolası ezilmez. Demo tenant `demo` + varsayılan `tenant_settings`. Her oluşturma audit'e (`user.created`, `tenant.created`, parolasız) aynı transaction'da yazılır.

## Test (2026-11-11, geçici `mysql:8.4` 8.4.13, sonra silindi)
```
docker run -d --name rs-mysql-test -p 33307:3306 -e MYSQL_ROOT_PASSWORD=… -e MYSQL_DATABASE=remote \
  -e MYSQL_APP_PASSWORD=… -e MYSQL_MIGRATOR_PASSWORD=… \
  -v $PWD/deploy/mysql/init:/docker-entrypoint-initdb.d:ro mysql:8.4 --default-time-zone=+00:00
cd apps/server
MIGRATE_DATABASE_URL=mysql://migrator:…@127.0.0.1:33307/remote pnpm db:migrate
DATABASE_URL='mysql://app:…@127.0.0.1:33307/remote?allowPublicKeyRetrieval=true' SEED_SUPERADMIN_EMAIL=… SEED_SUPERADMIN_PASSWORD=… pnpm db:seed   # 2 kez
prisma db execute --file prisma/migrations/20261111000000_p1_init/down.sql; pnpm db:migrate; pnpm db:seed
prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
APP_PW=… CONTAINER=rs-mysql-test DB=remote ../../deploy/mysql/check-app-grants.sh
```
Sonuç: migrate + grants OK; seed 1. çalıştırma `created/created`, 2. `exists/exists` (idempotent); down.sql sonrası yalnız `_prisma_migrations` kaldı (0 kayıt), yeniden migrate + seed OK; drift yok (exit 0); `migrate status` güncel; yetki kontrolü **17/17 PASS** — app: audit_logs UPDATE/ALTER/DROP/TRUNCATE/TRIGGER, CREATE TABLE, ALTER users, GRANT, `_prisma_migrations` INSERT reddedildi; SELECT/INSERT/DELETE audit ve users UPDATE izinli; CHECK ihlalleri (role, ttl) reddedildi. `created_at` = UTC doğrulandı.

## Yedek
Mimari §8.3 (P13, devops): `mysqldump --single-transaction` günlük 02:00, 14 gün, `age` şifreli; geri yükleme adımı `docs/runbook.md`'de (P13). Not: mysqldump kullanıcısına ayrıca `SELECT, SHOW VIEW, TRIGGER, LOCK TABLES` gerekir (app değil, ayrı `backup` kullanıcısı önerilir).

### Tekrar test (2026-11-11, düzeltme turu)
- `check-app-grants.sh` sağlamlaştırıldı: CHECK testleri artık var olan veriye bağlı değil (geçici kayıtlarla `WHERE id=…`), `users_role_tenant_chk` testi eklendi. Boş DB'de **22/22 PASS**; `NODE_ENV=production` seed (`superAdmin=created demoTenant=skipped`) sonrası **22/22 PASS**; betik sonrası kalan geçici kayıt 0.
- `seed.ts` artık `tsc` kapsamında (`tsconfig.json` include'a `prisma/**/*.ts`); `pnpm --filter @remote/server typecheck` temiz.

### audit_logs DELETE yetkisi (koordinatör kararı, 2026-11-11: P1'de KALDIRILDI)
DELETE yetkisi retention/tetikleyiciyle birlikte (P11/P13) verilecek; o pakette grants.sql güncellenir. Aşağıdaki dayanak o paket içindir.
`app` kullanıcısındaki DELETE yalnız retention içindir: mimari §3.4 (`audit_logs` 730 gün → hard delete, "tetikleyici izinli"), §3.3 (`BEFORE DELETE` → `created_at > NOW() - INTERVAL 730 DAY` ise SIGNAL; "yalnız retention silebilir"), §3.1 tablo notu ve ADR-0003 r2 ("audit_logs için yalnız INSERT/SELECT/DELETE, DELETE tetikleyiciyle 730 gün sınırlı"). Kullanıcı/API tarafından silme yok (§3.3, AC-76: DELETE → 405). Not: tetikleyici P11'de gelene kadar (P1–P10 arası) DB düzeyinde 730 gün sınırı **yoktur**; app kimliği ele geçirilirse audit silinebilir. Kapatmak için P11 tetikleyicisi veya retention'ı ayrı bir kullanıcıya taşıma kararı mimar/güvenlikte.

## P2 — support_sessions (2026-11-11)
Migration `apps/server/prisma/migrations/20261111010000_p2_support_sessions/{migration.sql,down.sql}`. Yalnız P2 alanları; `mode`, `consumed_at`, `started_at`, `terminated_by`, `customer_*`, `ticket_no`, `note`, `quality_summary`, `anonymized_at` kendi paketlerinde (P3/P4/P5/P8/P13) expand migration'la eklenir.
| Sütun | Tip | Not |
|---|---|---|
| `id`, `tenant_id` FK, `technician_id` FK users | CHAR(26) | RESTRICT; teknisyen = oluşturan kullanıcı (görevdeki "created_by") |
| `token_hash` | CHAR(64) UQ | SHA-256 hex (CHECK `^[0-9a-f]{64}$`); düz token DB'de yok (AC-2) |
| `active_code` | CHAR(8)? UQ | CHECK `^[0-9]{8}$`; **PENDING ⇔ NOT NULL** (CHECK) → global tekil bekleyen kod (AC-3, ADR-0006, G-22) |
| `tech_verify_code` | CHAR(4) | CHECK `^[0-9]{4}$` (G-01) |
| `status` | VARCHAR(20) vars. PENDING | CHECK PENDING/ACTIVE/ENDED/EXPIRED/CANCELLED |
| `expires_at` | DATETIME(3) | CHECK `created_at+14dk ≤ expires_at ≤ created_at+31dk` (TTL 15..30, ±1 dk saat toleransı, AC-4) |
| `ended_at`, `ended_by`, `end_reason` | DATETIME(3)?, VARCHAR(20)?, VARCHAR(40)? | **ENDED/EXPIRED/CANCELLED ⇔ ended_at NOT NULL** (CHECK); ended_by CHECK TECH/CUSTOMER/ADMIN/SYSTEM |
İndeksler: UQ(token_hash), UQ(active_code), IX(tenant_id, created_at), IX(technician_id, status) [AC-11 açık oturum sayımı], IX(technician_id, created_at) [kendi listesi, AC-12 saatlik sayım], IX(status, expires_at) [expiry işi].
- **Mimariden sapma (§3.1'e not düşüldü):** IX(tenant_id, technician_id, created_at) yerine IX(technician_id, created_at) — technician_id ULID ve tenant'a özgü, ön ek gereksiz; ayrıca FK için technician_id önde indeks gerekir (aksi halde MySQL gizli indeks ekler). IX(tenant_id, status) P8'e bırakıldı (P2'de tenant geneli durum sorgusu yok). İptal zamanı ayrı sütun değil `ended_at` (+ `ended_by='TECH'`, `end_reason='cancelled'`).
- **Grant:** `app` → SELECT/INSERT/UPDATE (DELETE yok: iptal/expiry UPDATE'tir; hard delete retention P13'te, DELETE yetkisi o pakette). `REVOKE IF EXISTS DELETE, ALTER, DROP, INDEX, TRIGGER, REFERENCES`.
- Büyüme: oturum başına 1 satır; retention `retention_days` + 30 gün sonra silme (P13) — partition gerekmez.
- Seed değişmedi (geliştirmede oturum panelden oluşturulur).

### Backend-dev için
- Kod üretimi: `crypto.randomInt(0, 1e8)` → `padStart(8,'0')`; INSERT'te **P2002** + `e.meta.driverAdapterError.cause.constraint.index === 'support_sessions_active_code_key'` ise yeni kodla yeniden dene (ADR-0006: 5 deneme, sonra 503/500). Prisma 7 + mariadb adaptöründe `meta.target` **yok** (test edildi). `token_hash` çakışması (aynı index adı `support_sessions_token_hash_key`) pratikte imkânsız; yeniden deneme gerekmez, hata olarak bırakın.
- PENDING'den çıkan **her** UPDATE aynı ifadede `activeCode: null` ve (bitiş durumlarında) `endedAt` set etmeli; aksi halde CHECK 3819 (Prisma "Database error ... Check constraint ... is violated") döner. Yarış güvenli iptal/expiry: `updateMany({ where: { id, tenantId, status: 'PENDING' }, data: {...} })` → `count === 0` ise 409/410.
- Expiry işi: `updateMany({ where: { status: 'PENDING', expiresAt: { lte: now } }, data: { status: 'EXPIRED', activeCode: null, endedAt: now, endedBy: 'SYSTEM', endReason: 'expired' } })`. Resolve sırasında da `expiresAt <= now` ise aynı güncellemeyi tek satır için yapıp 410 dönün (iş gecikse bile AC-5).
- `expiresAt = createdAt + session_ttl_min` — `createdAt`'i de servis aynı `now` ile verirse CHECK toleransına hiç yaklaşılmaz.
- Açık oturum sınırı (AC-11): `count({ where: { technicianId, status: { in: ['PENDING','ACTIVE'] } } })` + create aynı transaction'da; tam yarış güvenliği için `SELECT ... FOR UPDATE` users satırı üzerinde kilit önerilir.

### Test (2026-11-11, geçici `mysql:8.4`, port 33308, sonra silindi)
P1 migrate → P2 migrate + grants OK; `migrate diff --exit-code` 0 (drift yok); `check-app-grants.sh` **37/37 PASS** (P2: 15 yeni — SELECT/INSERT/UPDATE izinli, iki NULL kodlu satır izinli, DELETE/ALTER reddi, active_code UQ, status/ttl alt+üst/PENDING-kod/kod biçimi/token biçimi/kod-NULL'suz iptal/ended_at'siz expiry/ended_by CHECK'leri); `down.sql` → yalnız P1 tabloları + P1 kaydı kaldı; yeniden migrate OK, `migrate status` güncel, 37/37 PASS; seed OK; `pnpm typecheck` temiz. Prisma istemcisiyle: UQ ihlali → P2002 (meta yukarıda), CHECK ihlali → hata, `updateMany` iptal count=1.

## P3 — admit tüketimi + zorla sonlandırma (2026-11-11)
Migration `apps/server/prisma/migrations/20261111020000_p3_session_admit/{migration.sql,down.sql}`. Yeni tablo **yok**; `support_sessions`'a 3 sütun (expand, NULL'lı, INSTANT) + FK + 5 CHECK.
| Sütun | Tip | Kaynak | Not |
|---|---|---|---|
| `mode` | VARCHAR(20)? | §3.1, A1 (`mode=BROWSER`), A2 | CHECK `AGENT`/`BROWSER`; admit anında yazılır |
| `consumed_at` | DATETIME(3)? | §3.1, A1, ADR-0006 adım 4, AC-6/7 | admit = tüketim = ACTIVE başlangıcı; AC-13 max süre `consumed_at + max_active_hours` (zamanlayıcı bellekte) |
| `terminated_by` | CHAR(26)? FK users RESTRICT | §3.1, A5, G-04, AC-114 | zorla sonlandıran Admin/Super Admin; IX(terminated_by) adlı (MySQL gizli FK indeksi yerine) |
CHECK'ler: `mode_chk`; `consumed_mode_chk` (consumed_at ⇔ mode); `consumed_status_chk` (ACTIVE ⇒ consumed_at dolu; PENDING/EXPIRED/CANCELLED ⇒ NULL; ENDED serbest — ACTIVE'den bitiş ya da bekleyen oturumun sistemce kapanması); `consumed_before_expiry_chk` (consumed_at ≤ expires_at); `terminated_by_chk` (ended_by='ADMIN' ⇔ terminated_by dolu, ve terminated_by ⇒ ENDED). P2'deki `code_pending_chk` ACTIVE'e geçişte `active_code=NULL`'u zaten zorlar.
- **Bilerek DB'ye konmayanlar (mimari §3.5 bellek içi):** join nonce (60 sn), WS ticket, lobi misafiri + admitCode hash'i, reconnect token hash'i, oda sayaçları (admitFail, adminReject), max süre/120 sn zamanlayıcıları. TURN secret env/`system_settings` (P11) — P3'te tablo yok. Katılımcı tablosu mimaride yok (tek misafir; lobi bellekte); onay kaydı `session_consents` P4'te (§10.3).
- **Ertelenen:** `started_at` — mimaride anlamı tanımsız (admit anı `consumed_at` ile karşılanıyor); medya/paylaşım başlangıcı ise P4'te tanımlanıp eklenmeli (mimar). `end_reason` serbest metin (CHECK yok): protokol nedenleri (`mimari-protokol.md` `session.ended`) küçük harf, §3.5/A3 metni `SERVER_RESTART`/`TIMEOUT` büyük harf yazıyor → backend tek biçim seçmeli (öneri: protokoldeki küçük harf değerler, `server`/`timeout`).
- **Grant:** değişiklik yok (tablo düzeyi SELECT/INSERT/UPDATE yeni sütunları kapsar; DELETE hâlâ P13).
- **İndeks:** admit UPDATE PK ile; açılışta `status='ACTIVE'` → ENDED işi IX(status, expires_at) ön ekini kullanır; yeni sorgu deseni yok.

### Backend-dev için (giriş şartı 2)
- Admit (tek atomik ifade, aynı TX'te audit + P4'te consent):
  `updateMany({ where: { id, status: 'PENDING', expiresAt: { gt: now } }, data: { status: 'ACTIVE', activeCode: null, consumedAt: now, mode } })` → `count === 0` ise iptal/expiry/başka admit kazandı (410/409). `now` hem WHERE hem SET'te aynı değer olmalı (`consumed_before_expiry_chk`).
- Bitiş (tech/customer/timeout/max_duration/server/auth_revoked): `updateMany({ where: { id, status: 'ACTIVE' }, data: { status: 'ENDED', endedAt, endedBy, endReason } })`.
- Terminate (A5): aynı, ayrıca `endedBy: 'ADMIN', terminatedBy: actorUserId`; `where` içinde `tenantId` (Super Admin hariç). ADMIN'i terminated_by'sız yazmak CHECK 3819 verir.
- Açılış (§3.5, ADR-0005): `updateMany({ where: { status: 'ACTIVE' }, data: { status: 'ENDED', endedAt: now, endedBy: 'SYSTEM', endReason: 'server' } })`.
- **Test yardımcısı:** `test/helpers/app.ts` `createSupportSessionRow` ACTIVE (ve tüketilmiş ENDED) satırda `consumedAt` + `mode` vermeli; aksi halde `consumed_status_chk` reddeder (aşağıdaki test sonucu).

### Test (2026-11-11, `apps/server/scripts/test-db.sh`, mysql 8.4)
P1→P2→P3 migrate + grants OK; `migrate diff --exit-code` 0 (drift yok); `check-app-grants.sh` **48/48 PASS** (P3: 11 yeni — atomik admit + ADMIN terminate + SYSTEM max_duration izinli; ACTIVE'de consumed yok, kod NULL'lanmamış, mode yok, mode=VNC, consumed>expires, CANCELLED+consumed, ADMIN terminated_by'sız, TECH+terminated_by, var olmayan terminated_by FK reddi — her biri beklenen kısıt adıyla). `down.sql` → 3 sütun, 5 CHECK, FK, indeks ve P3 kaydı kalktı (P2'nin 8 CHECK'i duruyor), diff exit 2 (beklenen); yeniden migrate OK, drift 0, `migrate status` güncel. `prisma generate` + `typecheck` temiz. `test:int`: 60/62 — 2 hata `sessions-public.test.ts` (AC-7 ACTIVE/ENDED 410), sebep test yardımcısının consumed_at'siz ACTIVE satırı (yukarıda; kısıt doğru, düzeltme yardımcıda).

## P4 — KVKK aydınlatma metni + onay kaydı (2026-11-11)
Migration `apps/server/prisma/migrations/20261111030000_p4_consents/{migration.sql,down.sql}`. İki yeni tablo + `support_sessions`'a UQ(id, tenant_id) (bileşik FK hedefi; INPLACE).
| Tablo | Sütunlar | Anahtar / kısıt |
|---|---|---|
| `consent_texts` | id, tenant_id FK, version INT, body **MEDIUMTEXT**, sha256 CHAR(64), is_current BOOL(0), created_by FK users? (NULL = seed/sistem), created_at, updated_at | UQ(tenant_id, version); UQ(id, tenant_id, sha256); IX(created_by); **fonksiyonel UQ `consent_texts_one_current_uq` ((IF(is_current, tenant_id, NULL)))** = tenant başına tek güncel sürüm; CHECK `version>=1`, `sha256 = SHA2(body,256)`, `CHAR_LENGTH(body) 1..20000` |
| `session_consents` | id, session_id, tenant_id, level, decision, source, consent_text_id?, consent_sha256?, ip?, user_agent?, created_at (updated_at yok, append-only) | FK (session_id, tenant_id) → support_sessions(id, tenant_id); FK tenant_id; FK (consent_text_id, tenant_id, consent_sha256) → consent_texts(id, tenant_id, sha256); IX(session_id, tenant_id, created_at), IX(tenant_id, created_at), IX(consent_text_id, tenant_id, consent_sha256); CHECK level/decision/source enum, text_id ⇔ sha256, metin yalnız VIEW+GRANTED'de |

**Kararlar (mimariden sapma/ekler — mimar §3.1'e not düşmeli):**
1. `body` TEXT yerine MEDIUMTEXT: API 20000 karakter, utf8mb4'te 80 KB'a çıkabilir (TEXT 64 KB → 500 yerine sınır).
2. `sha256` DB'de gövdeye bağlı (CHECK). Uygulama `createHash('sha256').update(body,'utf8').digest('hex')` yazmalı; aksi CHECK 3819. (mysql CLI'dan elle eklemede istemci karakter seti utf8mb4 olmalı.)
3. Tenant tutarlılığı DB'de: onay kaydının oturumu ve metni aynı tenant'a ait olmak zorunda, `consent_sha256` metnin özetine eşit olmak zorunda (bileşik FK). G-24/AC-127'nin **"güncel sürüm"** kısmı uygulamada (join anında `is_current` kontrolü; admit anında metin eskimiş olsa da join anındaki onay kaydedilir — A1).
4. `ip`/`user_agent` NULL'lı: SYSTEM kaynağında yok; retention anonimleştirmesi NULL yazar.
5. Enum vs lookup: `level/decision/source` VARCHAR(20)+CHECK (§3 kuralı); küme küçük ve kod sabiti.
6. Başlangıç metni **tenant bazlı v1, seed'de** (`seedConsentTexts`): metni olmayan HER tenant'a (üretimde de) v1 `is_current=1` + audit `consent_text.created`. Mimaride metin yok; kısa Türkçe aydınlatma+açık rıza metni yazıldı (veri sorumlusu = tenant adı). **Açık nokta:** tenant oluşturma servisi (ileriki paket) v1'i aynı TX'te eklemeli; o zamana dek yeni tenant için `pnpm db:seed` yeterli.
7. Büyüme: `session_consents` oturum başına birkaç satır; partition gerekmez, retention (P13) tenant `retention_days` ile anonimleştirir/siler.

**Grant (`grants.sql`):** `consent_texts` SELECT/INSERT (seed app ile çalışır; P11 düzenleme yeni sürüm INSERT eder). `is_current` geçişi için **sütun düzeyi** `UPDATE (is_current, updated_at)` P11'de verilecek — body/sha256/version hiç güncellenemez. `session_consents` SELECT/INSERT; UPDATE/DELETE retention ile P13.

### Backend-dev için (P4)
- **resolve:** `consentText.findFirst({ where: { tenantId, isCurrent: true }, select: { id, version, body, sha256 } })` (EXPLAIN: UQ(tenant_id, version) ön eki, rows=1). `null` ise tenant'ın metni yok → 503/500 değil; seed eksikliği — hata zarfıyla logla.
- **join (G-24, AC-127):** `consentText.findFirst({ where: { id: consentTextId, tenantId: session.tenantId, isCurrent: true }, select: { id: true, sha256: true } })` → `null` ise 400. Sonucu `LobbyGuest.consent {textId, sha256, at, ip, ua}`'ye koy (bellek).
- **admit TX (A1, P3 kalıbı + consent):** `$transaction([ supportSession.updateMany(...count=1 kontrolü...), sessionConsent.create({ data: { id: ulid(), sessionId, tenantId, level: 'VIEW', decision: 'GRANTED', source: 'UI', consentTextId, consentSha256, ip, userAgent, createdAt: guest.consent.at } }), auditLog.create(...) ])` — interaktif TX ile count=0'da consent yazmadan çık. İlişkiler bileşik olduğundan `create`'te **düz alanlar** (unchecked input) kullanın, `connect` değil.
- **Paylaşım durdur/yeniden, kontrol (P7):** `consentTextId/consentSha256` NULL; `level`/`decision`/`source` uygun değer. Metinli satır yalnız VIEW+GRANTED (CHECK).
- **Zaman çizelgesi (AC-62):** `sessionConsent.findMany({ where: { sessionId, tenantId }, orderBy: { createdAt: 'asc' }, select: {...} })` — IX(session_id, tenant_id, created_at).
- **Test yardımcıları:** consent'li testlerde tenant için `consentText.create` (sha256 node crypto ile); `test/helpers` tenant oluşturuyorsa v1 eklemeli.

### Test (2026-11-11, `apps/server/scripts/test-db.sh`, mysql 8.4)
P1→P3 üzerine P4 migrate + grants OK; `migrate diff --exit-code` 0 (fonksiyonel indeks/CHECK drift üretmiyor). `check-app-grants.sh` **67/67 PASS** (P4: 19 yeni — SELECT/INSERT, UPDATE body/is_current, DELETE, ALTER reddi; ikinci güncel sürüm UQ, sürüm tekrarı UQ, yanlış sha256 ve version=0 CHECK; admit+VIEW/GRANTED/UI metinli + CONTROL/DENIED/SYSTEM metinsiz izinli; session_consents UPDATE/DELETE reddi; yanlış özet FK, özetsiz metin, CONTROL+metin, decision enum, çapraz tenant oturum FK, başka tenant metni FK — her biri beklenen kısıt adıyla). `down.sql` → iki tablo, UQ ve P4 kaydı kalktı, diff exit 2 (beklenen); yeniden migrate OK, drift 0, `migrate status` güncel, 67/67. Seed iki kez: v1 bir kez oluştu (idempotent), CHECK'ten geçti (Node SHA-256 = MySQL SHA2). Temiz DB'de `test:int` **93/93**, `test` 69/69, typecheck + lint temiz.

## P5 — session_files + quality_summary (2026-11-11)
Migration `apps/server/prisma/migrations/20261111040000_p5_session_files/{migration.sql,down.sql}`. Yeni tablo `session_files` + `support_sessions.quality_summary JSON?` (INSTANT ADD COLUMN; CHECK eklemesi COPY, tablo küçük).
| Tablo/Sütun | Tanım | Anahtar / kısıt |
|---|---|---|
| `session_files` | id, session_id, tenant_id, direction VARCHAR(20), file_name VARCHAR(255), size_bytes BIGINT, sha256 CHAR(64), result VARCHAR(20), created_at (updated_at yok, append-only). **Dosya içeriği yok** (AC-55) | FK (session_id, tenant_id) → support_sessions(id, tenant_id) (P4'ün UQ'su; tenant tutarlılığı DB'de); FK tenant_id; IX(session_id, tenant_id, created_at) [detay listesi + FK]; IX(tenant_id, created_at) [tenant FK + retention]. CHECK: direction `TO_CUSTOMER/TO_TECH`; result `OK/REJECTED/CANCELLED/CORRUPT`; sha256 `^[0-9a-f]{64}$` (büyük/küçük duyarlı); size_bytes 0..2147483648 (max_file_mb tavanı 2048 MiB; tenant sınırı serviste); **file_name temizlenmiş**: 1..255 karakter, `\ / : * ? " < > |`, U+0000–U+001F, Unicode Cf (RTLO) yok, sonda nokta/boşluk yok |
| `support_sessions.quality_summary` | JSON? | CHECK: NULL ya da (JSON nesne ∧ JSON_STORAGE_SIZE ≤ 4096 ∧ consumed_at dolu) |

**Grant:** `session_files` SELECT/INSERT; UPDATE/DELETE/DDL REVOKE (retention P13'te verilir). `quality_summary` için ek yetki yok (P2 tablo düzeyi UPDATE).

**Kararlar / açık noktalar:**
1. Mimarideki sütunlar aynen; sapma yok (mimari §3.1'e not gerekmez). `reported_by`/`fid` yok: `file.meta` iki taraftan gelebilir → **backend tek kaynak seçmeli** (öneri: alıcı tarafın raporu; OK/CORRUPT yalnız alıcı bilir, REJECTED/CANCELLED karşı taraftan gelirse tek satır) ve oturum başına hız sınırı koymalı (sahte meta ile tablo şişirme). Gerekirse sütun eklemek mimar kararı.
2. file_name CHECK, `sanitizeFileName` (mimari-protokol §4.2/1) ile birebir; ham ad yazılırsa 3819. Ayrılmış ad (`CON` vb.) DB'de denetlenmez (temizleyici `_` önekler). **P13:** mimari §3.4 anonimleştirmesi `***` yazarsa CHECK ihlal eder (`*` yasak) — P13 ya hard delete ya da `anonim` gibi yer tutucu kullanmalı veya CHECK'i kendi migration'ında uyarlamalı.
3. Büyüme: oturum başına birkaç satır; partition gerekmez.
4. Seed değişmedi (kayıtlar canlı oturumdan gelir).

### Backend-dev için (P5)
- `file.meta`: zod (protokol) → `sanitizeFileName(fileName)` → `sessionFile.create({ data: { id: ulid(), sessionId, tenantId: room.tenantId, direction, fileName, sizeBytes: BigInt(n), sha256, result } })` + audit aynı TX (`$transaction([...])`). Bileşik ilişki: düz alanlar (unchecked input), `connect` değil. `sizeBytes` BigInt — JSON yanıtında `Number()`/string'e çevirin.
- `quality.summary`: `supportSession.updateMany({ where: { id, tenantId, consumedAt: { not: null } }, data: { qualitySummary } })` (60 sn periyodik üzerine yazar). Silmek için `Prisma.DbNull`.
- Detay (GET /sessions/:id): `select: { files: { orderBy: { createdAt: 'asc' }, select: {...} } }` — IX(session_id, tenant_id, created_at).

### Test (2026-11-11, `scripts/test-db.sh`, mysql 8.4)
P1→P4 üzerine P5 migrate + grants OK; `migrate diff --exit-code` 0. `check-app-grants.sh` **76/76 PASS** (P5: 9 yeni — SELECT/INSERT + quality UPDATE izinli; UPDATE/DELETE/ALTER reddi; çapraz tenant FK; file_name/direction CHECK; PENDING'de quality_summary). `down.sql` → tablo, sütun, CHECK ve kayıt kalktı (P4 UQ duruyor), diff exit 2 (beklenen); yeniden migrate OK, drift 0, `migrate status` güncel. Yeni `test/integration/session-files-p5.test.ts` 7/7 (meta yazma/okuma + sütun listesi, tenant izolasyonu FK, enum/sha/boyut CHECK, 17 kötü dosya adı + 6 geçerli ad, app yetki sınırı, quality_summary yazma/üzerine yazma/DbNull + PENDING/dizi/metin/>4 KB reddi). `test:int` **112/112**, `test` 79/79, typecheck + lint temiz.

## P7 — `session_consents.source` += `TECH` (2026-11-11)
Migration `apps/server/prisma/migrations/20261111050000_p7_consent_source_tech/{migration.sql,down.sql}` (ADR-0013, mimari §3.1 + §10.2 P7, mimari-protokol §3.3 K1). Yeni tablo/sütun **yok**; yalnız `session_consents_source_chk` genişletildi: `UI | HOTKEY | RECONNECT | SYSTEM | TECH`.
- `TECH` = teknisyenin kontrolü bırakması (`control.release`) veya GRANTED iken `control.cancel` → satır `CONTROL / REVOKED / TECH`, metinsiz (consent_text_id/sha NULL; `text_scope_chk` zaten buna izin verir). REQUESTED iken `control.cancel` satır **yazmaz** (müşteri karar vermedi).
- Elle yazıldı (Prisma CHECK ifade edemez); `schema.prisma`'da yalnız yorum değişti → `migrate diff` 0.
- **Kilit:** MySQL'de CHECK değişimi = tek `ALTER … DROP CHECK x, ADD CONSTRAINT x CHECK (…)` (aynı ad tek ifadede çalışıyor; kısıtsız ara an yok). `ADD CHECK` ALGORITHM=COPY → tablo yeniden yazılır, süresince yazma bekler. Tablo küçük, prod henüz açık değil (P10) → kabul. İfade genişlediği için mevcut satırlar ihlal üretmez.
- **Geri alma:** `down.sql` CHECK'i P4 kümesine daraltır + `_prisma_migrations` kaydını siler. `source='TECH'` satırı varsa 3819 ile **atomik başarısız** olur (test edildi, hiçbir şey değişmez). Bu satırlar KVKK onay kanıtıdır: silinmez/SYSTEM'e çevrilmez → TECH satırı oluştuktan sonra ileri düzeltme. Önce P7 kodu geri alınmalı.
- **Grant:** değişmedi (yeni tablo yok; `session_consents` SELECT/INSERT P4'ten).
- **Gözlem (mevcut tüm enum CHECK'leri için, P7'ye özgü değil):** sütunlar `utf8mb4_unicode_ci` → `IN (…)` harf duyarsız; `'tech'` CHECK'ten geçer (test edildi). Büyük harf yazım uygulamanın sabitleriyle (contracts) sağlanıyor; DB'de harf duyarlılığı istenirse ayrı karar (ör. `` `source` COLLATE utf8mb4_bin IN (…) ``), tüm enum CHECK'lerine birlikte uygulanmalı — P8 zaman çizelgesi/CSV öncesi mimar değerlendirmesi önerilir.

### Backend-dev için (P7)
- `control.release`/`control.cancel(GRANTED)`: `sessionConsent.create({ data: { id: newId(), sessionId, tenantId: room.tenantId, level: 'CONTROL', decision: 'REVOKED', source: 'TECH' } })` + audit `control.released` aynı `$transaction` (protokol §3.3: önce bellek durumu, sonra DB; hata → log + ref). `ip`/`userAgent` teknisyen bağlantısından doldurulabilir ya da NULL.
- Kaynak değerleri tek yerden (contracts sabiti) yazılmalı; küçük harf DB'de reddedilmez (yukarıdaki gözlem).

### Test (2026-11-11, `scripts/test-db.sh` ayrı ad/port `rs-mysql-dba-p7:33317`, mysql 8.4, sonra silindi)
P1→P5 üzerine P7 migrate + grants OK; `migrate diff --exit-code` 0. `check-app-grants.sh` **78/78 PASS** (P7: 2 yeni — CONTROL/REVOKED/TECH izinli; `BOGUS` kaynak `session_consents_source_chk` ile reddi). Yeni `test/integration/consent-source-p7.test.ts` 2/2 (TECH + P4 kaynakları kabul, zaman çizelgesi sorgusu; `TECHNICIAN`/`DENIED`/`ADMIN`/boş → `session_consents_source_chk`). TECH satırı varken `down.sql` → 3819, CHECK ve kayıt değişmedi; TECH satırları (yalnız geçici DB'de) silinince `down.sql` OK → P4 kümesi, P7 kaydı yok, drift 0; yeniden migrate OK, `migrate status` güncel, 78/78. `test:int` **158/158** (P7 backend testleri dahil), `test` 218/218, typecheck + lint temiz.

## ADR-0014 uygulaması — enum CHECK ikili karşılaştırma (P8, dba; karar 2026-11-11)
Gözlem P7'de yapıldı (yukarıda): `utf8mb4_unicode_ci` harf/aksan duyarsız ve PAD SPACE. **Karar (b):** enum CHECK'leri `` CAST(`col` AS BINARY) IN (…) `` biçimine çevrilir. Sütun harmanlaması ve Prisma şeması değişmez (gerekçe: ADR-0014).
- **Migration:** ayrı klasör, `20261111070000_enum_check_binary/{migration.sql,down.sql}`, P8 `session_history`'den sonra gelir. Elle yazılır ve her tablo tek `ALTER … DROP CHECK x, ADD CONSTRAINT x CHECK (…)` ile değiştirilir. Kapsamdaki 14 CHECK: `tenants_status_chk`, `users_role_chk`, `users_theme_chk`, `users_status_chk`, `tenant_settings_smtp_security_chk`, `audit_logs_result_chk`, `support_sessions_status_chk`, `support_sessions_ended_by_chk`, `support_sessions_mode_chk`, `session_consents_level_chk`, `session_consents_decision_chk`, `session_consents_source_chk`, `session_files_direction_chk`, `session_files_result_chk`. NULL olabilen sütunlarda `IS NULL OR` korunur. Eşitlik içeren CHECK'ler (`code_pending`, `ended_at`, `role_tenant`, `text_scope` vb.) değişmez. `BINARY expr` ve `utf8mb4_bin` kullanılmaz (biri kullanımdan kalkıyor, diğeri PAD SPACE).
- **Ön kontrol:** migration'dan önce her sütun için `SELECT COUNT(*) … WHERE CAST(col AS BINARY) NOT IN (…)` çalıştırılır; beklenen sonuç 0. Sıfır dışı bir sonuç çıkarsa durulur ve mimara bildirilir. Özellikle consent satırları **elle düzeltilmez**.
- **Kilit:** ADD CHECK = COPY, 6 tablo yeniden yazılır. Prod açık değil ve staging küçük olduğundan kabul edildi.
- **down.sql:** ci biçimine döner (genişletme yönünde, her zaman başarılı) ve `_prisma_migrations` kaydını siler.
- **Test (`check-app-grants.sh`):** her CHECK için küçük harf, sondaki boşluk ve aksanlı (`É`) varyantın 3819 + beklenen kısıt adı ile reddedildiği; kanonik değerin geçtiği. `migrate diff --exit-code` 0, down → up döngüsü, `test:int` yeşil.
- **P8 migration'ına ek (`session_history`):** `audit_logs` üzerinde `IX(tenant_id, entity, entity_id, created_at)` (detay zaman çizelgesi; INPLACE) ve `support_sessions` üzerinde `IX(created_at)` (Super Admin tüm-tenant listesi, P13 retention). Gerekçe: `mimari-api.md` "Oturum geçmişi (P8)" §3 ve §6.

## P8 — oturum geçmişi alanları + liste indeksi (2026-11-11)
Migration `apps/server/prisma/migrations/20261111060000_p8_session_history/{migration.sql,down.sql}` (expand; mimari §3.1, mimari-api GET/PATCH `/sessions`, export.csv; AC-60..63).
| Sütun / indeks | Tanım | CHECK |
|---|---|---|
| `customer_name` | VARCHAR(100)? — admit edilen misafirin adı | 2..100 karakter, kırpılmış, Unicode Cc/Cf yok (join kuralıyla aynı); yalnız `consumed_at` dolu oturumda (`customer_consumed_chk`) |
| `customer_email` | VARCHAR(190)? | tek `@`, boşluk/Cc/Cf yok; `customer_name` doluysa |
| `ticket_no` | VARCHAR(50)? (AC-63) | 1..50, kırpılmış, Cc/Cf/Zl/Zp yok (= contracts `UNSAFE_NAME_CHARS`) |
| `note` | TEXT? (AC-63) | 1..4000 karakter; yalnız `\n` `\t` serbest — diğer Cc (`\r` dahil, U+007F–U+009F) ve Cf yasak (mimari-api P8 §4) |
| IX(tenant_id, status, created_at) | durum filtresi + sıralama/tarih aralığı | — |
| `support_sessions` IX(created_at) | SUPER_ADMIN tüm-tenant listesi (mimari-api P8 §2/§6) + P13 retention | — |
| `audit_logs` IX(tenant_id, entity, entity_id, created_at) | detay zaman çizelgesi (mimari-api P8 §3); INPLACE/LOCK=NONE | — |

**Kararlar:**
1. `anonymized_at` eklenmedi — retention ile P13'te (mimari §3.1 "kendi migration'larında").
2. Mimari "IX(tenant_id, status)" yerine **(tenant_id, status, created_at)**: eşitlik + `created_at DESC` aynı indeksten (sapma notu mimari §3.1).
3. P8 öncesi oturumlarda müşteri adı DB'de yok (yalnız audit `guest.admitted.newValue.name`); **geri doldurma yapılmadı** (prod açık değil, staging test verisi) → UI "—".
4. Kilit: ADD COLUMN INSTANT, CREATE INDEX INPLACE/LOCK=NONE, ADD CHECK COPY (tablo küçük, prod kapalı → kabul).
5. Mod ve müşteri adı için indeks yok (mod düşük seçicilik; müşteri araması `%x%`, B-tree kullanamaz) — ölçüm aşağıda yeterli.
6. Boş metin saklanmaz: temizleme = NULL.
7. **Sözleşme karşılaştırması (mimari-api "Oturum geçmişi (P8)"):** `startedAt` = `consumed_at` (P3), `durationSec` hesaplanır (sütun yok), `customerName/customerEmail/ticketNo/note/mode/endedBy/endReason/terminatedBy/quality_summary` DB'de mevcut; `tenant {id,name}` ilişkiden. Sapma yok. PATCH `note` kuralı (yalnız \n \t) ve `ticketNo` Zl/Zp DB CHECK'ine de işlendi; zod `.length` UTF-16 ≥ `CHAR_LENGTH` olduğundan zod'dan geçen değer CHECK'e takılmaz. Not: `\r` yasak — tarayıcı textarea değeri JS'te `\n`'dir, ama ham CRLF gönderen istemci 3819 alır; servis `\r\n`→`\n` normalleştirebilir.

### Backend-dev için (P8)
- **Kapsam:** her sorguda `tenantId` (+ USER için `technicianId = user.id`) — `repo.scopeWhere` mevcut. Sıralama **`[{createdAt:'desc'},{id:'desc'}]`** (iki alan aynı yönde; karışık yön filesort üretir). Sayfalama mimari-api'ye göre offset (`page/pageSize ≤ 100`); `findMany` + `count` aynı `where`, `Promise.all`.
- **Hangi indeks hangi sorgu:**
  | Filtre | İndeks |
  |---|---|
  | filtresiz / tarih aralığı / mod / müşteri | `(tenant_id, created_at)` geri tarama (+ filtre) |
  | USER kapsamı veya `technicianId` | `(technician_id, created_at)`; count `(technician_id, status)` |
  | `status` (+ tarih) | `(tenant_id, status, created_at)` (count covering) |
- **Tarih filtresi `created_at` üzerinde** (`gte from`, `lt to+1gün`, UTC); "başlangıç" gösterimi `consumed_at` (mimar kararı P3) — `consumed_at` ile filtrelemek indeks kullanmaz.
- **Müşteri filtresi — DİKKAT:** Prisma 7 (MySQL) `contains` LIKE jokerlerini **kaçışlamaz** (`"%"` tüm kayıtları eşledi, test edildi). `customerName: { contains: q.replace(/[\\%_]/g, "\\$&") }` kullanın. `utf8mb4_unicode_ci` → büyük/küçük harf duyarsız.
- **Admit (A1):** tek atomik koşullu UPDATE'e `customerName` (trim'li) + `customerEmail` eklenmeli (CHECK: yalnız `consumed_at` ile birlikte); LobbyGuest'ten.
- **PATCH (AC-63):** `ticketNo`/`note` zod (≤50/≤4000, trim; `""` → `null`); `updateMany({ where: { ...scope, id } })` count 0 → 404. ticket_no'da satır sonu/kontrol karakteri 3819 üretir — zod'da da reddedin.
- **Liste N+1 yok:** `technician: { select: { id, fullName } }` Prisma'da tek ek `IN` sorgusu. consents/files yalnız detayda.
- **SUPER_ADMIN tüm tenant'lar:** `where` tenant'sız → `IX(created_at)` geri tarama (10k+5k: 2,2 ms); `tenantId` filtresi verilirse `(tenant_id, created_at)`.
- **Zaman çizelgesi:** `auditLog.findMany({ where: { tenantId, entity: 'support_sessions', entityId: id, action: { in: [...] } }, orderBy: [{createdAt:'asc'},{id:'asc'}], take: 500 })` → `IX(tenant_id, entity, entity_id, created_at)` (81k audit satırında 6 satır okur, 0,02 ms). `tenantId` **mutlaka** verilmeli (indeksin ilk sütunu; SUPER_ADMIN için oturumun tenant'ı).
- **CSV imleci:** sözleşme "id imleciyle 1000'lik parti": sıra listeyle aynı olsun diye `(created_at, id)` keyset önerilir (`OR: [{createdAt:{lt:c}}, {createdAt:c, id:{lt:i}}]`) — `(tenant_id, created_at)` indeksini kullanır. Yalnız `id` imleci (ULID ≈ zaman) PK üzerinden tarar + tenant filtresi; 50k sınırında ikisi de yeterli.
- **CSV:** 10k satır tek `findMany` ~100 ms, 100k ~840 ms (bellek). Akış için 1000'lik partiler, **keyset** imleç (`created_at < ? OR (created_at = ? AND id < ?)`), offset değil.

### Performans seed'i (yalnız dev/test)
`apps/server/scripts/perf-sessions.ts` — `PERF_SEED_ALLOW=1 node scripts/perf-sessions.ts seed|measure` (`DATABASE_URL` = app). NODE_ENV=production veya bayrak yoksa reddeder; `prisma/seed.ts`'e girmez. Varsayılan: `perf-p8` tenant'ına 10.000 oturum (+ `perf-p8-noise` 5.000), 10 teknisyen (giriş yapılamaz yer tutucu hash); `PERF_TENANT_SLUG=demo` ile panelden görülebilir. İdempotent (eksik kadar ekler). Test: `test/integration/session-history-p8.test.ts`.

### Ölçüm (2026-11-11, geçici mysql 8.4, ANALYZE TABLE sonrası, findMany+count, 7 tekrar medyan)
| Senaryo (pageSize 25) | 10k | 100k |
|---|---|---|
| filtresiz | 2,7 ms | 14,7 ms |
| USER kapsamı | 2,2 | 18,1 |
| durum=CANCELLED / ACTIVE(0) | 2,0 / 1,4 | 2,7 / 1,8 |
| mod=AGENT | 10,3 | 111,8 |
| tarih son 30 gün | 2,0 | 3,6 |
| müşteri `Yılmaz` / eşleşmesiz | 11,1 / 15,1 | 120 / 156 |
| tüm filtreler | 2,1 | 5,5 |
| derin sayfa (skip 9975) | 12,6 | 15,5 |
| SUPER_ADMIN tüm tenant'lar (15k) | 2,2 | — |
**AC-60 (< 500 ms, 10k) karşılanıyor**; en kötü 15 ms. EXPLAIN: liste sorguları `LIMIT 25`'te 25 satır okuyup durur (reverse index lookup, filesort yok); maliyeti `count` taşır (mod/müşteri filtresinde tenant'ın tüm satırları). Doğrusal: tenant başına ~250k'da müşteri araması ~400 ms. O ölçekte öneri: UI varsayılan tarih aralığı (ör. son 90 gün) veya `(tenant_id, mode, created_at)` / ngram FULLTEXT — gerek görülürse ayrı migration.

### Test (2026-11-11, `scripts/test-db.sh` `rs-mysql-dba-p8:33318`, mysql 8.4, sonra silindi)
P1→P7 üzerine P8 + ADR-0014 migrate + grants OK; `migrate diff --exit-code` 0. `check-app-grants.sh` **148/148 PASS** (P8: 14, ADR-0014: 56; her red beklenen kısıt adıyla — `run` artık 3. parametreyle kısıt adını da doğrular). `down.sql` (ADR-0014 → P8 sırasıyla) → sütunlar, 3 indeks, 5 CHECK ve kayıtlar kalktı, satırlar korundu, diff 2 (beklenen); yeniden migrate OK, drift 0, `migrate status` güncel, 148/148. `test/integration/session-history-p8.test.ts` 6/6; DB katmanı testleri (P4/P5/P7/grants) yeşil; `test` 244/244, lint temiz. Tam `test:int` 191/192: tek kırmızı `tenant-isolation` "her uç sınıflandırılmış" — backend-dev'in paralel eklediği yeni P8 ucu (sınıflandırma onun işi); `src/sessions/*` typecheck hataları da o sırada backend'in yarım dosyalarındandı. grants.sql değişmedi (yeni tablo yok).

### ADR-0014 uygulandı (2026-11-11)
Migration `apps/server/prisma/migrations/20261111070000_enum_check_binary/{migration.sql,down.sql,precheck.sql}`. 14 enum CHECK `CAST(col AS BINARY) IN (…)` (NULL'lanabilir: `smtp_security`, `ended_by`, `mode` → `IS NULL OR …`). `information_schema.CHECK_CONSTRAINTS` bunu `cast(… as char charset binary)` olarak gösterir.
- **Yerleşik koruma:** ALTER'lardan önce geçici tablo `adr14_guard` (`CHECK (n = 0)`) kanonik olmayan satır toplamını alır → > 0 ise migration **3819 `adr14_noncanonical_rows_chk` ile hiçbir şey değişmeden** durur (DDL transaction'sız olduğu için kısmi uygulamayı önler). Test edildi: `status='active'` tenant satırı → durdu, 14 CHECK eski hâlinde.
- **Durursa (runbook, devops):** `precheck.sql` ile hangi sütun olduğunu görün → **satırı elle düzeltmeyin**, mimara bildirin → karar sonrası `prisma migrate resolve --rolled-back 20261111070000_enum_check_binary` → `pnpm db:migrate` (test edildi).
- Staging/prod'da migrate'ten önce `precheck.sql` çalıştırılması önerilir (yalnız okuma).
- `down.sql` ci biçimine döner (her zaman başarılı) + kayıt siler. ci biçimindeyken yeni testlerden 42'si (14×3 varyant) FAIL veriyor — testlerin ayırt ettiği kanıtlandı.
- Kilit: 7 tablo COPY (`audit_logs` dahil); prod kapalı → kabul.
