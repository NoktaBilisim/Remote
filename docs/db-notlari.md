# DB Notları — Remote Support (P1–P8c)

Sahibi: dba. Tasarım kaynağı: `docs/mimari.md` §3, ADR-0003. MySQL 8.4, Prisma 7.10.1 (stabil; 8.x RC kullanılmadı).

## Dosyalar

| Dosya                                                                           | Amaç                                                                                                             |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `apps/server/prisma/schema.prisma`                                              | Şema (P1 tabloları)                                                                                              |
| `apps/server/prisma.config.ts`                                                  | Prisma 7 config: migration yolu, seed, URL = `MIGRATE_DATABASE_URL ?? DATABASE_URL`                              |
| `apps/server/prisma/migrations/20261111000000_p1_init/{migration.sql,down.sql}` | İlk migration + elle geri alma                                                                                   |
| `apps/server/prisma/sql/grants.sql`                                             | `app` tablo yetkileri (migrator çalıştırır, idempotent)                                                          |
| `apps/server/prisma/seed.ts`                                                    | Super Admin + demo tenant (idempotent)                                                                           |
| `deploy/mysql/init/01-users.sh`                                                 | MySQL ilk açılışta `migrator` + `app` kullanıcılarını oluşturur                                                  |
| `deploy/mysql/check-app-grants.sh`                                              | `app` yetki sınırı kontrolü (22 kontrol; geçici tenant/ayar/kullanıcı ekler, sonda siler — boş DB'de de çalışır) |

## Tablolar (P1)

Ortak: PK ULID `CHAR(26)` (uygulama üretir), `created_at/updated_at DATETIME(3)` UTC, enum'lar `VARCHAR(20)` + **CHECK** (biçim: ``CAST(`col` AS BINARY) IN (…)`` — ADR-0014; metin biçimi `REGEXP_LIKE(…, 'c')`), tüm FK `ON DELETE/UPDATE RESTRICT`, utf8mb4_unicode_ci.

| Tablo              | Anahtar / indeks                                                                                                               | Not                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `tenants`          | PK id, UQ slug                                                                                                                 | soft delete (`deleted_at`, `status`)                                                                                                       |
| `tenant_settings`  | PK/FK tenant_id                                                                                                                | 1-1; aralıklar CHECK ile (15..30, 1..10, 1..8, 1..2048, 90..730), `smtp_security` CHECK; `smtp_pass_enc` AES-GCM                           |
| `users`            | UQ email, UQ username, IX(tenant_id, status)                                                                                   | argon2id; CHECK: role/theme/status, `SUPER_ADMIN ⇔ tenant_id IS NULL`; `must_change_password` vars. true                                   |
| `user_permissions` | PK(user_id, perm_key)                                                                                                          | anahtarlar `packages/contracts/src/permissions.ts`                                                                                         |
| `auth_sessions`    | UQ token_hash, IX(user_id, revoked_at), IX(expires_at)                                                                         | token SHA-256; `expires_at` indeksi retention silmesi için                                                                                 |
| `audit_logs`       | PK BIGINT AI, IX(tenant_id, created_at), IX(tenant_id, user_id, created_at), IX(tenant_id, action, created_at), IX(created_at) | append-only, `updated_at` yok; `user_id` bilinçli FK değil (başarısız giriş, kullanıcıdan bağımsız kalıcılık); `result` CHECK success/fail |

Enum vs lookup: değer kümeleri sabit ve kodla birlikte değişir → VARCHAR + zod + CHECK (lookup tablosu gereksiz). Büyüme: `audit_logs` en hızlı büyüyen tablo; 730 gün retention `IX(created_at)` ile parti silme (P13); partition gerekmez (§7). Para alanı yok.

## DB kullanıcıları (G-15)

| Kullanıcı      | Yetki                                                                                                                                                                                                                                                             | Env                    | Kullanan                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------- |
| `migrator`@`%` | `ALL ON <db>.* WITH GRANT OPTION` (DDL, TRIGGER, grants.sql)                                                                                                                                                                                                      | `MIGRATE_DATABASE_URL` | yalnız tek seferlik `migrate` servisi |
| `app`@`%`      | Tablo bazlı: 5 tabloda SELECT/INSERT/UPDATE/DELETE; `audit_logs` yalnız SELECT/INSERT (UPDATE/DELETE/ALTER/DROP/TRIGGER yok; DELETE yetkisi retention/tetikleyiciyle birlikte (P11/P13) verilecek; o pakette grants.sql güncellenir); `_prisma_migrations` SELECT | `DATABASE_URL`         | server + seed                         |

- `01-users.sh` env: `MYSQL_ROOT_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_APP_PASSWORD`, `MYSQL_MIGRATOR_PASSWORD` (tırnak/ters bölü içeremez). Yalnız boş veri dizininde çalışır; parola değişimi runbook'ta `ALTER USER` ile.
- **Kural:** yeni tablo ekleyen her migration `grants.sql`'e GRANT satırı ekler (DB düzeyi `app` yetkisi yok, çünkü audit_logs UPDATE'i tablo düzeyinde düşürülemez).
- MySQL 8.4 `caching_sha2_password` + TLS'siz iç ağ: `DATABASE_URL`'e `?allowPublicKeyRetrieval=true` gerekir (mariadb sürücüsü; yoksa `ER_CANNOT_RETRIEVE_RSA_KEY`). MySQL portu dışa açılmamalı.
- **P11 için (ÇÖZÜLDÜ — bkz. "P11" bölümü: `--log-bin-trust-function-creators=1`):** binlog açıkken migrator `CREATE TRIGGER` → ERROR 1419. Seçenek: mysqld `--log-bin-trust-function-creators=1` (8.4'te deprecated uyarısı) veya `--disable-log-bin` (PITR yok, yedek mysqldump). Test edildi: bayrak açıkken migrator tetikleyici oluşturur, `app` 1142 "TRIGGER command denied" alır.

## Compose (devops için)

- mysql: `mysql:8.4`, `--default-time-zone=+00:00`, `./mysql/init:/docker-entrypoint-initdb.d:ro`, healthcheck.
- migrate: `pnpm --filter @remote/server db:migrate` (= `prisma migrate deploy && prisma db execute --file prisma/sql/grants.sql`), env yalnız `MIGRATE_DATABASE_URL`.
- server: `depends_on: migrate (service_completed_successfully)`, env `DATABASE_URL`; `MIGRATE_DATABASE_URL` verilmez.
- seed: ilk kurulumda `pnpm --filter @remote/server db:seed` (`DATABASE_URL`, `SEED_SUPERADMIN_*`). Prod'da (`NODE_ENV=production`) demo tenant oluşmaz.

## Migration / geri alma

- Yeni migration: şemayı değiştir → `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script` ile yeni klasör (shadow DB/CREATE _._ yetkisi gerekmez) + elle `down.sql`. Expand → contract.
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

| Sütun                                          | Tip                                      | Not                                                                                                   |
| ---------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `id`, `tenant_id` FK, `technician_id` FK users | CHAR(26)                                 | RESTRICT; teknisyen = oluşturan kullanıcı (görevdeki "created_by")                                    |
| `token_hash`                                   | CHAR(64) UQ                              | SHA-256 hex (CHECK `^[0-9a-f]{64}$`); düz token DB'de yok (AC-2)                                      |
| `active_code`                                  | CHAR(8)? UQ                              | CHECK `^[0-9]{8}$`; **PENDING ⇔ NOT NULL** (CHECK) → global tekil bekleyen kod (AC-3, ADR-0006, G-22) |
| `tech_verify_code`                             | CHAR(4)                                  | CHECK `^[0-9]{4}$` (G-01)                                                                             |
| `status`                                       | VARCHAR(20) vars. PENDING                | CHECK PENDING/ACTIVE/ENDED/EXPIRED/CANCELLED                                                          |
| `expires_at`                                   | DATETIME(3)                              | CHECK `created_at+14dk ≤ expires_at ≤ created_at+31dk` (TTL 15..30, ±1 dk saat toleransı, AC-4)       |
| `ended_at`, `ended_by`, `end_reason`           | DATETIME(3)?, VARCHAR(20)?, VARCHAR(40)? | **ENDED/EXPIRED/CANCELLED ⇔ ended_at NOT NULL** (CHECK); ended_by CHECK TECH/CUSTOMER/ADMIN/SYSTEM    |

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

| Sütun           | Tip                         | Kaynak                            | Not                                                                                                         |
| --------------- | --------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `mode`          | VARCHAR(20)?                | §3.1, A1 (`mode=BROWSER`), A2     | CHECK `AGENT`/`BROWSER`; admit anında yazılır                                                               |
| `consumed_at`   | DATETIME(3)?                | §3.1, A1, ADR-0006 adım 4, AC-6/7 | admit = tüketim = ACTIVE başlangıcı; AC-13 max süre `consumed_at + max_active_hours` (zamanlayıcı bellekte) |
| `terminated_by` | CHAR(26)? FK users RESTRICT | §3.1, A5, G-04, AC-114            | zorla sonlandıran Admin/Super Admin; IX(terminated_by) adlı (MySQL gizli FK indeksi yerine)                 |

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

| Tablo              | Sütunlar                                                                                                                                                   | Anahtar / kısıt                                                                                                                                                                                                                                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `consent_texts`    | id, tenant_id FK, version INT, body **MEDIUMTEXT**, sha256 CHAR(64), is_current BOOL(0), created_by FK users? (NULL = seed/sistem), created_at, updated_at | UQ(tenant_id, version); UQ(id, tenant_id, sha256); IX(created_by); **fonksiyonel UQ `consent_texts_one_current_uq` ((IF(is_current, tenant_id, NULL)))** = tenant başına tek güncel sürüm; CHECK `version>=1`, `sha256 = SHA2(body,256)`, `CHAR_LENGTH(body) 1..20000`                                                                                                 |
| `session_consents` | id, session_id, tenant_id, level, decision, source, consent_text_id?, consent_sha256?, ip?, user_agent?, created_at (updated_at yok, append-only)          | FK (session_id, tenant_id) → support_sessions(id, tenant_id); FK tenant_id; FK (consent_text_id, tenant_id, consent_sha256) → consent_texts(id, tenant_id, sha256); IX(session_id, tenant_id, created_at), IX(tenant_id, created_at), IX(consent_text_id, tenant_id, consent_sha256); CHECK level/decision/source enum, text_id ⇔ sha256, metin yalnız VIEW+GRANTED'de |

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

| Tablo/Sütun                        | Tanım                                                                                                                                                                                                     | Anahtar / kısıt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session_files`                    | id, session_id, tenant_id, direction VARCHAR(20), file_name VARCHAR(255), size_bytes BIGINT, sha256 CHAR(64), result VARCHAR(20), created_at (updated_at yok, append-only). **Dosya içeriği yok** (AC-55) | FK (session_id, tenant_id) → support_sessions(id, tenant_id) (P4'ün UQ'su; tenant tutarlılığı DB'de); FK tenant_id; IX(session_id, tenant_id, created_at) [detay listesi + FK]; IX(tenant_id, created_at) [tenant FK + retention]. CHECK: direction `TO_CUSTOMER/TO_TECH`; result `OK/REJECTED/CANCELLED/CORRUPT`; sha256 `^[0-9a-f]{64}$` (büyük/küçük duyarlı); size_bytes 0..2147483648 (max_file_mb tavanı 2048 MiB; tenant sınırı serviste); **file_name temizlenmiş**: 1..255 karakter, `\ / : * ? " < > | `, U+0000–U+001F, Unicode Cf (RTLO) yok, sonda nokta/boşluk yok |
| `support_sessions.quality_summary` | JSON?                                                                                                                                                                                                     | CHECK: NULL ya da (JSON nesne ∧ JSON_STORAGE_SIZE ≤ 4096 ∧ consumed_at dolu)                                                                                                                                                                                                                                                                                                                                                                                                                                   |

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

Gözlem P7'de yapıldı (yukarıda): `utf8mb4_unicode_ci` harf/aksan duyarsız ve PAD SPACE. **Karar (b):** enum CHECK'leri ``CAST(`col` AS BINARY) IN (…)`` biçimine çevrilir. Sütun harmanlaması ve Prisma şeması değişmez (gerekçe: ADR-0014).

- **Migration:** ayrı klasör, `20261111070000_enum_check_binary/{migration.sql,down.sql}`, P8 `session_history`'den sonra gelir. Elle yazılır ve her tablo tek `ALTER … DROP CHECK x, ADD CONSTRAINT x CHECK (…)` ile değiştirilir. Kapsamdaki 14 CHECK: `tenants_status_chk`, `users_role_chk`, `users_theme_chk`, `users_status_chk`, `tenant_settings_smtp_security_chk`, `audit_logs_result_chk`, `support_sessions_status_chk`, `support_sessions_ended_by_chk`, `support_sessions_mode_chk`, `session_consents_level_chk`, `session_consents_decision_chk`, `session_consents_source_chk`, `session_files_direction_chk`, `session_files_result_chk`. NULL olabilen sütunlarda `IS NULL OR` korunur. Eşitlik içeren CHECK'ler (`code_pending`, `ended_at`, `role_tenant`, `text_scope` vb.) değişmez. `BINARY expr` ve `utf8mb4_bin` kullanılmaz (biri kullanımdan kalkıyor, diğeri PAD SPACE).
- **Ön kontrol:** migration'dan önce her sütun için `SELECT COUNT(*) … WHERE CAST(col AS BINARY) NOT IN (…)` çalıştırılır; beklenen sonuç 0. Sıfır dışı bir sonuç çıkarsa durulur ve mimara bildirilir. Özellikle consent satırları **elle düzeltilmez**.
- **Kilit:** ADD CHECK = COPY, 6 tablo yeniden yazılır. Prod açık değil ve staging küçük olduğundan kabul edildi.
- **down.sql:** ci biçimine döner (genişletme yönünde, her zaman başarılı) ve `_prisma_migrations` kaydını siler.
- **Test (`check-app-grants.sh`):** her CHECK için küçük harf, sondaki boşluk ve aksanlı (`É`) varyantın 3819 + beklenen kısıt adı ile reddedildiği; kanonik değerin geçtiği. `migrate diff --exit-code` 0, down → up döngüsü, `test:int` yeşil.
- **P8 migration'ına ek (`session_history`):** `audit_logs` üzerinde `IX(tenant_id, entity, entity_id, created_at)` (detay zaman çizelgesi; INPLACE) ve `support_sessions` üzerinde `IX(created_at)` (Super Admin tüm-tenant listesi, P13 retention). Gerekçe: `mimari-api.md` "Oturum geçmişi (P8)" §3 ve §6.

## P8 — oturum geçmişi alanları + liste indeksi (2026-11-11)

Migration `apps/server/prisma/migrations/20261111060000_p8_session_history/{migration.sql,down.sql}` (expand; mimari §3.1, mimari-api GET/PATCH `/sessions`, export.csv; AC-60..63).

| Sütun / indeks                                            | Tanım                                                                | CHECK                                                                                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `customer_name`                                           | VARCHAR(100)? — admit edilen misafirin adı                           | 2..100 karakter, kırpılmış, Unicode Cc/Cf yok (join kuralıyla aynı); yalnız `consumed_at` dolu oturumda (`customer_consumed_chk`) |
| `customer_email`                                          | VARCHAR(190)?                                                        | tek `@`, boşluk/Cc/Cf yok; `customer_name` doluysa                                                                                |
| `ticket_no`                                               | VARCHAR(50)? (AC-63)                                                 | 1..50, kırpılmış, Cc/Cf/Zl/Zp yok (= contracts `UNSAFE_NAME_CHARS`)                                                               |
| `note`                                                    | TEXT? (AC-63)                                                        | 1..4000 karakter; yalnız `\n` `\t` serbest — diğer Cc (`\r` dahil, U+007F–U+009F) ve Cf yasak (mimari-api P8 §4)                  |
| IX(tenant_id, status, created_at)                         | durum filtresi + sıralama/tarih aralığı                              | —                                                                                                                                 |
| `support_sessions` IX(created_at)                         | SUPER_ADMIN tüm-tenant listesi (mimari-api P8 §2/§6) + P13 retention | —                                                                                                                                 |
| `audit_logs` IX(tenant_id, entity, entity_id, created_at) | detay zaman çizelgesi (mimari-api P8 §3); INPLACE/LOCK=NONE          | —                                                                                                                                 |

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
  | Filtre                                    | İndeks                                                         |
  | ----------------------------------------- | -------------------------------------------------------------- |
  | filtresiz / tarih aralığı / mod / müşteri | `(tenant_id, created_at)` geri tarama (+ filtre)               |
  | USER kapsamı veya `technicianId`          | `(technician_id, created_at)`; count `(technician_id, status)` |
  | `status` (+ tarih)                        | `(tenant_id, status, created_at)` (count covering)             |
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

| Senaryo (pageSize 25)            | 10k         | 100k      |
| -------------------------------- | ----------- | --------- |
| filtresiz                        | 2,7 ms      | 14,7 ms   |
| USER kapsamı                     | 2,2         | 18,1      |
| durum=CANCELLED / ACTIVE(0)      | 2,0 / 1,4   | 2,7 / 1,8 |
| mod=AGENT                        | 10,3        | 111,8     |
| tarih son 30 gün                 | 2,0         | 3,6       |
| müşteri `Yılmaz` / eşleşmesiz    | 11,1 / 15,1 | 120 / 156 |
| tüm filtreler                    | 2,1         | 5,5       |
| derin sayfa (skip 9975)          | 12,6        | 15,5      |
| SUPER_ADMIN tüm tenant'lar (15k) | 2,2         | —         |

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

## P8b-1 — müşteri destek talepleri (2026-11-12)

Migration `apps/server/prisma/migrations/20261112000000_p8b_support_requests/{migration.sql,down.sql}` (mimari-e9 §3, §13 bağlayıcı; ADR-0014/0016). Expand-only; precheck gerekmez (değişen P2/P8 CHECK'leri yalnız genişler, mevcut satırların hepsi `request_id` NULL).

| Tablo / sütun                                         | Tanım                                                                                                                                                                                          | Kısıtlar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenant_request_settings` (yeni, 1-1 tenants, tembel) | tenant_id PK/FK, request_ref CHAR(16) UQ, ref_rotated_at?, file_label VARCHAR(20), wait_minutes (30), wa_enabled, wa_recipients JSON, email_enabled, email_recipients JSON, trusted_cidrs JSON | ref `^[a-z2-7]{16}$`, label `^[A-Za-z0-9]{1,20}$`, wait 10..120; JSON dizileri **JSON_SCHEMA_VALID** (wa ≤ 5 E.164, email ≤ 5, cidr ≤ 10; tekil, öğe biçimi); kanal açık ⇒ ≥ 1 alıcı. JSON sütunlarının DB varsayılanı yok (Prisma MySQL'de ifade edemez) → servis `[]` yazar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `support_requests` (yeni)                             | mimari-e9 §3.2 + §13.8 sütunları; `network_match` (aşağıda), `known_device`, `request_code`, `net_key`, `device_hash`, `anonymized_at`                                                         | ikili enum: status, cancel_reason, network_match; biçim: request_code, secret_hash/device_hash hex, client_instance, client_version, telefon E.164, e-posta iskeleti; metin: ad 2..80, açıklama 10..500 tek satır (Cc/Cf/Zl/Zp ve çift boşluk yok), ret mesajı 5..200 (kırpılmış); tutarlılık: CANCELLED ⇔ cancel_reason, PENDING ⇔ closed_at NULL, kabul alanları (ACCEPTED/CONNECT_FAILED dolu; PENDING/EXPIRED/REJECTED boş; CANCELLED+kabulcü yalnız CUSTOMER), REJECTED ⇔ rejected_by ⇔ reject_message; zaman: expires 9..121 dk, accepted_at ≤ expires_at, consented_at = created_at ±1 dk; **PII ↔ anonimleştirme**: anonim değilse ad/telefon/açıklama/ip/ip_key/net_key dolu, anonimse e-posta ve device_hash dahil hepsi NULL (yarım anonimleştirme reddedilir); known_device ⇒ device_hash (veya anonim). Fonksiyonel UQ `support_requests_pending_code_uq` = tenant içinde bekleyenlerde tekil kod |
| `support_sessions`                                    | += request_id CHAR(26)? (bileşik FK (request_id, tenant_id) → support_requests, UQ(request_id, tenant_id)), guest_net_key?, **guest_ip_key?** (G-E9-15); customer_email 190→**254** (INPLACE)  | `code_pending_chk`: talep oturumu kodsuz, kod yolunda P2 aynen; `ttl_chk`: kod yolu 15..30 dk, talep 55..65 sn; `customer_consumed_chk`: talep oturumunda PENDING iken ad yazılabilir (kabul INSERT'i); yeni `request_mode_chk` (talep oturumu yalnız AGENT), `guest_keys_chk` (iki anahtar birlikte, yalnız admit edilmişte)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `session_consents`                                    | += request_id? (bileşik FK)                                                                                                                                                                    | `request_scope_chk`: yalnız VIEW/GRANTED                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**İndeksler (`support_requests`):** IX(tenant_id, status, created_at) kuyruk/sıra/pasif tenant; **IX(tenant_id, closed_at)** geçmiş sekmesi (dba ek); IX(status, expires_at) süpürücü; IX(tenant_id, ip_key, status), IX(tenant_id, net_key, status), IX(tenant_id, client_instance, status) bekleyen sınırları; IX(tenant_id, device_hash) known_device; **IX(tenant_id, anonymized_at, created_at)** anonimleştirme (mimarideki IX(created_at) yerine — retention tenant bazlı); FK indeksleri; UQ(secret_hash), UQ(id, tenant_id). `support_sessions`: IX(tenant_id, guest_net_key, consumed_at), IX(tenant_id, guest_ip_key, consumed_at).

**Sapmalar (mimari §3'e not düşüldü):**

1. **G-E9-15:** `known_network BOOL` yerine `network_match VARCHAR(20)` `NONE|PREFIX|IP|TRUSTED` (talep anında bir kez hesaplanır). Rozet = `IP|TRUSTED`; PREFIX nötr metin ("Benzer ağdan önceki oturum var"), uyarıyı kaldırmaz; hız/kuyruk ayrıcalığı (≥ 40 eşiği, 120/sa) yalnız `TRUSTED` veya `known_device`. Tam IP için `support_sessions.guest_ip_key` + indeks eklendi. API `knownNetwork` = `network_match IN ('IP','TRUSTED')` türetilebilir; ayrı alan gerekip gerekmediği mimar/backend kararı.
2. **G-E9-17:** şema değişikliği yok; `known_device` hesabı 90 gün penceresiyle yapılmalı (aşağıdaki sorgu). "Bu cihazı güvenilir sayma" kara listesi tablosu **eklenmedi** (spekülatif) — mimar P8b-1'e alırsa ayrı migration.
3. `customer_email` talepte VARCHAR(254) (AC-134) → oturum sütunu da 254'e genişletildi (kabulde kopyalanır).
4. `support_sessions` UQ(request_id) yerine UQ(request_id, tenant_id): request_id global tekil ULID olduğundan eşdeğer; Prisma 1-1 bileşik ilişki için gerekli.
5. Fonksiyonel UQ tek parçalı (`CONCAT(tenant_id, request_code)`): iki parçalı biçimi Prisma 7.10 içgözlemi yanlış okuyup sahte drift üretti.
6. `consent_texts` sütun düzeyi `UPDATE(is_current, updated_at)` P11'den **öne alındı** (seed yeni sürüm). body/sha256/version hâlâ güncellenemez.

**Grant:** `tenant_request_settings`, `support_requests` → SELECT/INSERT/UPDATE (DELETE/DDL REVOKE; hard delete P13). `consent_texts` += UPDATE(is_current, updated_at). `session_consents` değişmedi (SELECT/INSERT).

**Seed:** aydınlatma metni yeni sistem sürümü (talep verisi, telefon/açıklama, "Bilgilerimi hatırla" yerel şifreli dosya — ne/nerede/nasıl silinir, saklama + anonimleştirme). Kural: güncel sürüm sistem metniyse (created_by NULL) ve gövdesi farklıysa max+1 sürüm eklenir, eskisi is_current=0 (tek TX + audit); Admin'in yazdığı metne dokunulmaz; metni olmayan tenant'a doğrudan güncel metin. Geliştirmede demo tenant'a `tenant_request_settings` (rastgele ref, `DemoFirma`). **Yayın notu (runbook, devops):** yeni sürüm, eski sürümle açık karşılama sayfalarını join'de 400'e düşürür (AC-127).

### Backend-dev için (P8b-1)

- **Oluşturma TX'i** (G-E9-10): ilk ifade `SELECT … FROM tenant_request_settings WHERE tenant_id=? FOR UPDATE`; sayımlar `count({where:{tenantId, status:'PENDING', clientInstance|ipKey|netKey}})` (ilgili IX); INSERT'te `createdAt`, `consentedAt`, `expiresAt = createdAt + wait` aynı `now`'dan. `requestCode` çakışması: P2002 + `constraint.index === 'support_requests_pending_code_uq'` → yeni kod (5 deneme).
- **known_device (90 gün, G-E9-17):** `SELECT 1 FROM support_requests r JOIN support_sessions s ON s.request_id=r.id AND s.tenant_id=r.tenant_id WHERE r.tenant_id=? AND r.device_hash=? AND s.consumed_at >= now-90g LIMIT 1`.
- **network_match:** güvenilen CIDR → TRUSTED; yoksa `support_sessions WHERE tenant_id=? AND guest_ip_key=? AND consumed_at >= now-90g` → IP; yoksa aynı sorgu `guest_net_key` → PREFIX; değilse NONE. Admit UPDATE'i `guest_net_key` + `guest_ip_key`'i birlikte yazar (her iki yol).
- **Kabul TX'i:** talep `updateMany({where:{id,tenantId,status:'PENDING',expiresAt:{gt:now}}, data:{status:'ACCEPTED',acceptedBy,acceptedAt:now,closedAt:now}})`; oturum INSERT `requestId`, `activeCode:null`, `createdAt:now`, `expiresAt:now+60sn`, `customerName/Email` talepten. Talep oturumu admit'inde `mode:'AGENT'`.
- Durum geçişlerinde aynı UPDATE'te: CANCELLED → `cancelReason`+`closedAt`; REJECTED → `rejectedBy`+`rejectMessage`+`closedAt`; EXPIRED → `closedAt`; ACCEPTED→CONNECT_FAILED/CANCELLED(CUSTOMER) mevcut kabul alanları kalır. Eksik alan 3819.
- **Anonimleştirme:** tenant başına `updateMany({where:{tenantId, anonymizedAt:null, createdAt:{lt:cutoff}}, data:{customerName:null,customerPhone:null,customerEmail:null,description:null,ip:null,ipKey:null,netKey:null,deviceHash:null,anonymizedAt:now}})` 1000'lik partiler (IX(tenant_id, anonymized_at, created_at)); alanlardan biri unutulursa `support_requests_pii_chk` reddeder.
- **Metin kuralları:** DB açıklamada da `UNSAFE_NAME_CHARS` (tüm Cf) reddeder; `descriptionSchema` aynı kümeyi kullanmalı.
- Geçmiş sekmesi: `where:{tenantId, closedAt:{gte}}`, `orderBy:[{closedAt:'desc'},{id:'desc'}]` → IX(tenant_id, closed_at).

### Test (2026-11-12, geçici `mysql:8.4` `rs-mysql-dba-p8b:33328`, sonra silindi)

Boş DB'de P1→P8b migrate + grants OK; `migrate diff --exit-code` **0**; seed 2 kez (`consentTextsCreated=1/0`, `demoRequestSettings=created/exists`); eski sistem v1'li tenant → seed v2 ekledi, v1 `is_current=0`, ikinci çalıştırma 0 (idempotent). `check-app-grants.sh` **211/211 PASS** (P8b: 63 yeni — yetkiler, JSON şema CHECK'leri, talep yaşam döngüsü izinli yollar, her CHECK negatifi beklenen kısıt adıyla, bekleyen kod UQ, çapraz tenant FK, talep oturumu kod/TTL/mod/ağ anahtarı, onay kapsamı). `down.sql`: talep oturumu varken `p8b_down_guard_chk` ile hiçbir şey değişmeden durdu; temizken tablolar/sütunlar/yetkiler/kayıt kalktı → yeniden migrate OK, 211/211, drift 0. `test` 256/256; `test:int` 216/216 (P8 şema testinde iki beklenen değer güncellendi: e-posta 254, ikili CHECK sayısı 17). typecheck/lint temiz.

## P8c-1 — müşteri firmalar, tek ref ad alanı, bilgisayar kaydı (2026-11-12)

Migration `apps/server/prisma/migrations/20261112120000_p8c_customers/{migration.sql,down.sql}` (mimari-e10 §3 + **§15 r2 bağlayıcı**, ADR-0017, ADR-0006 r5, ADR-0014). Expand-only; precheck gerekmez (`cancel_reason` CHECK yalnız genişler, diğer CHECK'ler yeni tablolara/NULL sütunlara bakar).

| Tablo / sütun                      | Tanım                                                                                                                                                                                                                                                              | Kısıtlar                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customers` (yeni)                 | id, tenant_id, name(100), **name_key(200)/search_key(400) `utf8mb4_bin`**, file_label, request_ref CHAR(16) UQ, ref_rotated_at?, contact_name?(80), phone?(16), email?(254), note?(1000), status, passive_at?, anonymized_at?, created_by? FK users                | ikili enum status; ad 2..100 kırpılmış Cc/Cf/Zl/Zp yok; name_key boş değil + kırpılmış; **search_key name_key ile başlar**; etiket/ref/telefon/e-posta biçimi; kişi 1..80; not 1..1000 yalnız `\n` serbest (`\t` `\r` dahil diğer Cc, Cf, Zl/Zp yasak); `PASSIVE ⇔ passive_at`; `anonymized_at ⇒ PII NULL` |
| `request_refs` (yeni, append-only) | ref CHAR(16) PK, tenant_id, customer_id? (NULL = Genel), created_at (updated_at yok)                                                                                                                                                                               | ref biçimi; FK (tenant_id, customer_id) → customers                                                                                                                                                                                                                                                        |
| `device_bindings` (yeni)           | id, tenant_id, customer_id?, key_hash CHAR(64)? UQ, client_version, first/last_session_id (bileşik FK → support_sessions), issue_count, last_used_at, revoked_at?, revoke_reason?, **active_session_id STORED** `IF(revoked_at IS NULL, last_session_id, NULL)` UQ | ikili enum revoke_reason (8 değer, `ADMIN_REVOKED` dahil); `revoked_at NULL ⇔ key_hash dolu ⇔ revoke_reason NULL`; key_hash `^[0-9a-f]{64}$`; client_version x.y.z; issue_count ≥ 1                                                                                                                        |
| `support_requests`                 | += customer_id?, binding_id? (bileşik FK'ler)                                                                                                                                                                                                                      | `cancel_reason` += `CUSTOMER_PASSIVE`, `BINDING_REVOKED`                                                                                                                                                                                                                                                   |
| `support_sessions`                 | += customer_id? (bileşik FK)                                                                                                                                                                                                                                       | —                                                                                                                                                                                                                                                                                                          |

**İndeksler:** customers UQ(request_ref), UQ(tenant_id, name_key), UQ(tenant_id, id), IX(tenant_id, status, name_key), IX(tenant_id, created_at), IX(status, passive_at), IX(created_by); request_refs IX(tenant_id, customer_id); device_bindings UQ(key_hash), UQ(active_session_id), UQ(id, tenant_id), IX(tenant_id, customer_id, revoked_at), IX(revoked_at, last_used_at), IX(last_session_id, tenant_id), IX(first_session_id, tenant_id); support_requests IX(tenant_id, customer_id, created_at), IX(binding_id, tenant_id, status); support_sessions IX(tenant_id, customer_id, created_at).

**Kararlar / sapmalar (mimari-e10 §3'e not):**

1. **Bileşik müşteri FK sırası `(tenant_id, customer_id) → customers(tenant_id, id)`**, hedef `UQ(tenant_id, id)` (mimaride `(customer_id, tenant_id) → (id, tenant_id)`). Anlam aynı. InnoDB FK indeksinin sütun sırası eşleşmeli; bu sırayla mimarinin zaten istediği `IX(tenant_id, customer_id, …)` indeksleri FK'yi de taşır. 4 tabloda (ikisi büyük) ayrı `(customer_id, tenant_id)` indeksi gerekmez. request_refs'te mimarinin `IX(customer_id, tenant_id)` + `IX(tenant_id)` ikilisi tek `IX(tenant_id, customer_id)` oldu.
2. `request_refs`'ten sahibe ters FK (customers.request_ref → request_refs) **yok**: döngüsel FK olur ve müşteri oluşturma INSERT sırası çözülemez. Ad alanı tekilliği PK + servis TX'iyle sağlanır. Tutarlılık sorgusu aşağıda.
3. `active_session_id` Prisma'da `String? @unique` (normal alan) olarak duruyor. Migration onu `MODIFY … AS (…) STORED` ile üretilmiş yapar. `migrate diff` üretilmiş ifadeyi ve harmanlamayı karşılaştırmadığından drift 0. **Yazılırsa MySQL 3105 verir.**
4. `customers` için mimarideki CHECK'lere iki ek: `customers_search_key_chk` (ad değişip arama anahtarı yeniden hesaplanmazsa 3819) ve `customers_name_key_chk`.
5. Not CHECK'i mimariye göre `\t`'yi de reddeder ("yalnız `\n` serbest"). contracts `customerNoteSchema` `\t`'ye izin verirse 3819 olur, zod'da da reddedilmeli.
6. `device_bindings`'e zaman CHECK'i konmadı (sahte saatli testlerle çakışır, değer katmaz).

**Geri doldurma (idempotent):** `INSERT INTO request_refs … SELECT request_ref, tenant_id, NULL, COALESCE(ref_rotated_at, created_at) FROM tenant_request_settings WHERE NOT EXISTS (…)`. Migration içindedir. Eski sunucu imajı yeni şemada çalıştıysa (o pencerede yapılan Genel ref yenilemesi kayda girmemişse), migrator ile aynı ifade yeniden çalıştırılır. Pre-P8c emekli Genel ref'ler hiçbir yerde saklanmadığı için kayda alınamaz (audit'te yalnız ilk 4 karakter var). 80 bitte yeniden üretilme olasılığı ihmal edilebilir. Tutarlılık kontrolü (beklenen 0):

```sql
SELECT (SELECT COUNT(*) FROM tenant_request_settings s WHERE NOT EXISTS (SELECT 1 FROM request_refs r WHERE r.ref=s.request_ref AND r.tenant_id=s.tenant_id AND r.customer_id IS NULL))
     + (SELECT COUNT(*) FROM customers c WHERE NOT EXISTS (SELECT 1 FROM request_refs r WHERE r.ref=c.request_ref AND r.tenant_id=c.tenant_id AND r.customer_id=c.id)) AS kayitsiz;
```

**Kilit:** yeni tablolar boş. `ADD COLUMN` INSTANT, `CREATE INDEX` INPLACE. support_requests/support_sessions FK ekleme ve cancel_reason CHECK değişimi COPY ile yapılır. Prod kapalı, staging küçük olduğu için kabul.

**down.sql:** `CUSTOMER_PASSIVE`/`BINDING_REVOKED` nedenli talep varken `p8c_down_guard_chk` (3819) ile hiçbir şey değişmeden durur. Bu satırları silmeyin, mimara bildirin. Temizken yetkileri geri alır, sütun/FK/indeksleri ve üç tabloyu **verisiyle** düşürür, `_prisma_migrations` kaydını siler. Önce yedek alınmalı.

**Grant:** `customers`, `device_bindings` → SELECT/INSERT/UPDATE. `request_refs` → SELECT/INSERT (append-only). DELETE/DDL REVOKE edilir. device_bindings DELETE P13 retention ile verilecek.

**Seed:** aydınlatma metni yeni sistem sürümü eklendi (bilgisayar kaydı: ne, nerede, ne kadar, nasıl silinir; müşteri yetkili kişi verisi). Mevcut kural geçerli: sistem metni farklıysa max+1, Admin metnine dokunulmaz. Geliştirmede demo tenant'ın Genel ref'i artık `request_refs`'e de yazılıyor; ayrıca örnek müşteri `Örnek Müşteri A.Ş.` (ref + kayıt + audit `customer.created`) ekleniyor. Bu müşterinin katlanmış anahtarları elle hesaplandı; contracts `foldKey` gelince ondan üretilmeli. Yayın notu P8b ile aynı: yeni metin sürümü, eski sürümle açık karşılama sayfalarını join'de 400'e düşürür.

### Backend-dev için (P8c-1)

- **Ref üretimi (5 deneme, P2002):** Genel için `request_refs` INSERT → `tenant_request_settings` INSERT/UPDATE. Müşteri **oluşturmada sıra: önce `customers` INSERT, sonra `request_refs` INSERT** (FK anında denetlenir; mimaride "önce buraya" yazıyor ama FK buna izin vermez). `request_refs` PK çakışırsa (`constraint` PRIMARY) tüm TX geri alınıp yeniden denenir. Yenileme/yeniden aktif etmede önce `request_refs` INSERT, sonra `customers` UPDATE. Çakışma tespiti: `P2002` + hedef `PRIMARY` (request_refs) veya `customers_request_ref_key`.
- **Ad çakışması:** `P2002` + `customers_tenant_id_name_key_key` → 409 `fields.name`.
- **search_key** her ad/kişi/telefon yazımında yeniden hesaplanmalı, `name_key` ile başlamalı (CHECK). Arama `searchKey: { contains: esc(foldKey(q)) }` — Prisma `contains` jokerleri kaçışlamaz (P8 notu), `%`, `_`, `\` kaçışlanmalı. İkili harmanlama nedeniyle `q` da katlanmış olmalı.
- **Anonimleştirme:** `updateMany({ where: { status:'PASSIVE', passiveAt:{ lt: cutoff }, anonymizedAt: null, tenantId }, data: { contactName:null, phone:null, email:null, note:null, searchKey: <yeniden>, anonymizedAt: now } })`. Bu sorgu IX(status, passive_at) kullanır; retention tenant bazlı olduğu için tenant döngüsünde çalıştırın. **Anonimleşmiş müşteriye PII yazan her UPDATE (PATCH, yeniden aktif sonrası) aynı UPDATE'te `anonymizedAt: null` yazmalı**, aksi halde `customers_anonymized_chk` 3819 verir.
- **Pasif/aktif:** `status` ve `passiveAt` aynı UPDATE'te birlikte yazılmalı (aktif etmede `passiveAt: null`).
- **device_bindings verme TX'i (§15.3):** adım 1 `findFirst({ where: { activeSessionId: sid } })` + `FOR UPDATE` (raw) veya eşdeğeri `lastSessionId: sid, revokedAt: null`. Eşzamanlı iki istekte UQ ihlali `P2002` + `device_bindings_active_session_id_key` → TX bir kez yeniden denenir (test edildi: iki eşzamanlı INSERT'ten biri düşer). `activeSessionId` **asla** `data`'ya yazılmaz.
- **Geçersizleştirme:** her yolda `revokedAt`, `revokeReason`, `keyHash: null` üçü birlikte yazılır; biri eksikse `device_bindings_revoked_chk` 3819 verir. Toplu müşteri/Genel: `updateMany({ where: { tenantId, customerId: x | null, revokedAt: null } })` → IX(tenant_id, customer_id, revoked_at). Boşta kalma: `revokedAt: null, lastUsedAt: { lte }` → IX(revoked_at, last_used_at), 1000'lik partiler.
- **Kayıtla talep:** kayıt başına bekleyen sayımı `count({ where: { bindingId, tenantId, status:'PENDING' } })` → IX(binding_id, tenant_id, status). `viaBinding`/`bindingRevoked` için liste sorgusunda `binding: { select: { revokedAt: true } }` (tek ek IN sorgusu, N+1 yok).
- **Türetilmiş sayaçlar (AC-166):** sayfadaki id'ler için `groupBy({ by:['customerId'], where:{ tenantId, customerId:{ in: ids } }, _count:true, _max:{ createdAt:true } })` → IX(tenant_id, customer_id, created_at) kapsar.
- **Kabul TX'i:** oturum INSERT'ine `customerId: request.customerId` kopyalanır (AC-177; eşitlik DB'de değil, testte). `POST /sessions` `customerId` → `customers WHERE id AND tenantId AND status='ACTIVE'`; başka tenant'ın müşterisi zaten FK ile 1452 verir, ama 404 servis kontrolünden dönmeli.
- Test yardımcısı `test/helpers/requests.ts` `createRequestSettings` ad alanına yazmıyor. Backend P8c ref çözümlemesi bunu gerektirirse yardımcıya `requestRef.create` eklenmeli.

### Test (2026-11-12, geçici `mysql:8.4` `rs-mysql-p8c:33319`, sonra silindi)

P8b durumundaki DB'ye (önceden eklenmiş bir `tenant_request_settings` satırıyla) migrate + grants OK. Geri doldurma satırı yazdı, üretilmiş sütun ve `utf8mb4_bin` doğrulandı, `migrate diff --exit-code` **0**. down → up → drift 0. `CUSTOMER_PASSIVE` satırı varken down.sql `p8c_down_guard_chk` ile durdu, tablolar ve kayıt korundu. Seed 2 kez çalıştı: ilkinde `consentTextsCreated=2 demoRequestSettings=created demoCustomer=created`, ikincisinde hepsi `exists`/0. Demo ref'leri `request_refs`'te; kayıtsız ref 0. `check-app-grants.sh` **261/261 PASS** (P8c: 50 yeni). `test/integration/customers-p8c-db.test.ts` 12/12. `session-history-p8` ikili CHECK sayısı 17 → 19 güncellendi. `test` 281/281, `test:int` **312/312**, typecheck/lint temiz.

## P10 — hesap güvenliği + SMTP (2026-11-12)

Migration `20261112180000_p10_account_security` (expand-only, veri taşıma yok) + `down.sql` (guard'lı).

### Mevcut olan, eklenmeyen (mimari §3.1 P1'de zaten kurulmuş)

| İhtiyaç                                                  | Alan                                                                                            |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| TOTP sırrı (şifreli) / etkinlik                          | `users.totp_secret_enc VARBINARY(255)`, `users.totp_enabled`                                    |
| Hesap geneli kilit (G-23)                                | `users.failed_login_count`, `failed_window_at`, `locked_until`                                  |
| Boşta 30 dk / mutlak 8 sa / logout-all / MFA yarı oturum | `auth_sessions.last_seen_at`, `expires_at`, `revoked_at`, `mfa_passed`; IX(user_id, revoked_at) |
| USER için 2FA zorunluluğu                                | `tenant_settings.require_tech_2fa` (vars. true)                                                 |
| SMTP (şifre şifreli)                                     | `tenant_settings.smtp_host/port/security/user/pass_enc/from_name/from_email`                    |
| E9 e-posta kanalı (AC-151)                               | `tenant_request_settings.email_enabled`, `email_recipients` (+ P8b CHECK'leri)                  |

`enrolled_at`/`mfa_enabled` gibi ek alan **eklenmedi** (mimaride yok; `totp_enabled` + audit yeterli).

### Yeni

- `recovery_codes` (id, user_id FK RESTRICT, code_hash CHAR(64), used_at?, created/updated_at) — **UQ(user_id, code_hash)** (doğrulama araması ve kullanıcı başına sayım bu indeksle). CHECK: hash biçimi `^[0-9a-f]{64}$`.
- `password_reset_tokens` (id, user_id FK RESTRICT, token_hash CHAR(64) UQ, expires_at, used_at?, created/updated_at) — IX(user_id, created_at) (hesap başına istek sayımı, açıkları kapatma), IX(expires_at) (retention, §3.4). CHECK: hash biçimi; `expires_at > created_at AND ≤ created_at + 31 dk` (30 dk + P2 toleransı).
- **Sapma:** `users.totp_last_step BIGINT?` — son kabul edilen TOTP adımı (floor(unix/30)). Mimaride yok; RFC 6238 §5.2 (aynı OTP ikinci kez kabul edilmez) ve yarışsız tek kullanım için gerekli (koşullu UPDATE). INSTANT ADD COLUMN, NULL. mimari §3'e dba notu düşüldü.
- CHECK'ler (zod'a ek): `users_totp_enabled_chk` (etkin ⇒ sır var), `users_totp_secret_enc_chk` (≥ 30 bayt: ver+iv+tag+≥1), `users_totp_last_step_chk` (> 0 ve yalnız sır varken); `tenant_settings_smtp_complete_chk` (ya hepsi NULL ya host+port+security+from_email dolu), `_smtp_auth_chk` (şifre ⇒ kullanıcı), `_smtp_pass_enc_chk` (≥ 30 bayt), `_smtp_port_chk` (1..65535), `_smtp_host_chk` (ASCII ad / IPv4 / `[IPv6]`, ≤ 253; IDN punycode'a çevrilmeli), `_smtp_user_chk` ve `_smtp_from_name_chk` (Cc/Cf/Zl/Zp yok → CRLF başlık enjeksiyonu savunması; from_name kırpılmış), `_smtp_from_email_chk` (P8 e-posta iskeleti).
- Up guard: P10 öncesi kod `smtp_*`/`totp_*` yazmadığı için bu alanlarda dolu satır varsa migration `p10_up_guard_chk` (3819) ile hiçbir şey değişmeden durur (MySQL DDL transaction'sız).

### Yetkiler (`grants.sql`)

| Tablo                 | app                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| recovery_codes        | SELECT, INSERT, DELETE (yeniden üretim / MFA sıfırlama) + **sütun** UPDATE(used_at, updated_at); code_hash/user_id güncellenemez                      |
| password_reset_tokens | SELECT, INSERT + **sütun** UPDATE(used_at, updated_at); token_hash/expires_at güncellenemez (süre uzatılamaz); DELETE yok → P13 retention ile verilir |

### Geri alma

`down.sql`: kurtarma kodu veya `totp_enabled=1` kullanıcı varsa `p10_down_guard_chk` ile durur (kodlar geri getirilemez; P9 kodu TOTP'yi yok sayar). Gerekirse önce MFA'lar uygulamadan (audit'li) sıfırlanır. smtp_*/totp_secret_enc (P1 sütunları) korunur.

### Açık noktalar (mimar/backend kararı)

1. **Super Admin e-postası:** Super Admin'in tenant'ı yok → tenant SMTP'si yok; sıfırlama/kilit bildirimi e-postası gönderilemez. Sistem SMTP alanı **eklenmedi** (mimaride yok). Öneri: Super Admin için `forgot` 202 döner ama gönderim yapılmaz (audit `fail, reason: no_smtp`); kurtarma runbook (seed/CLI) ile. Sistem SMTP istenirse `system_settings` (P11) anahtarı olarak eklenir.
2. **Oturum linki e-postası 20/sa/teknisyen (AC-10):** tablo eklenmedi. Seçenek A: bellek `rate.ts` (yeniden başlatmada sıfırlanır); B: P2 kalıbı (TX + `users FOR UPDATE` + `audit_logs` sayımı `action='session.email'`, IX(tenant_id, user_id, created_at) kapsar). Backend seçer.
3. **ICU `$` bulgusu (P10 dışı, Düşük):** MySQL REGEXP'te `$` sondaki `\n`'yi kabul ediyor (test: `REGEXP_LIKE('abc\n','^[a-z]+$')=1`). Yeni host CHECK'inde `\z` kullanıldı. Sabit uzunluklu CHAR(n) + `{n}` desenleri etkilenmez (uzunluk taşar); değişken uzunluklu olanlar etkilenir: `customers_file_label_chk`, `customers_phone_fmt_chk`, `support_requests_phone_fmt_chk`, `support_requests_client_version_fmt_chk`, `device_bindings_client_version_fmt_chk`, `tenant_request_settings_file_label_chk`. zod birincil savunma olduğu için risk düşük; bir sonraki dba paketinde `\z`'ye çevrilmeli (DROP+ADD CHECK, COPY).

### Test (2026-11-12, geçici `mysql:8.4` `rs-mysql-p10dba:33330`, sonra silindi)

P8c durumundaki DB'den `migrate diff` ile Prisma kısmı üretildi. up → `check-app-grants.sh` **302/302 PASS** (P10: 41 yeni; ADR-0014 `smtp_security` enum_case satırı complete_chk nedeniyle tam yapılandırmayla denenecek şekilde güncellendi). down (boş) → tablolar, sütun, yetkiler (table/column_privileges 0) ve `_prisma_migrations` satırı silindi → up tekrar OK. Kurtarma kodu varken down `p10_down_guard_chk` ile durdu, hiçbir şey değişmedi. `typecheck` temiz, `test` 285/285, `test:int` **384/384**. Seed değişmedi (2FA kayıt akışı kodları kendisi üretir; SMTP seed'lenmez — netguard loopback'i reddeder).

## P11 — system_settings + audit değiştirilemezliği (2026-11-13)

Migration `apps/server/prisma/migrations/20261113090000_p11_system_settings_audit/{migration.sql,down.sql}`. Mimari §3.1 `system_settings`, §3.3, §10 P11; ADR-0003 r2; AC-76/77/78/123. Veri taşıma yok.

### Binlog ve ERROR 1419 (karar)

MySQL 8.4'te binlog varsayılan açık. Bu durumda SUPER yetkisi olmayan `migrator` `CREATE TRIGGER` çalıştıramaz (1419). Deney (8.4.13): migrator'a tek tek `SET_ANY_DEFINER`, `SET_USER_ID`, `SYSTEM_VARIABLES_ADMIN`, `BINLOG_ADMIN`, `SYSTEM_USER`, `ALLOW_NONEXISTENT_DEFINER`, `SESSION_VARIABLES_ADMIN` verildi, ayrıca `SET sql_log_bin=0` denendi; **hiçbiri yetmedi, yalnız SUPER yetiyor**. SUPER geniş bir yetki (KILL, SET GLOBAL, read_only aşma), üstelik deprecated → reddedildi. `--disable-log-bin` de reddedildi: PITR ve replika imkânı kalıcı olarak kapanırdı.
**Karar:** mysqld `--log-bin-trust-function-creators=1`, binlog açık kalır. Etkisi yalnız CREATE TRIGGER/ROUTINE yetkisi olan kullanıcılarla sınırlı; bu da yalnız migrator (`app`'te yok). 8.4.13'te değişken **deprecated**: `SET GLOBAL` 1287 uyarısı veriyor, komut satırı bayrağı açılışta uyarı vermiyor. MySQL bu değişkeni kaldırırsa yedek yol `--disable-log-bin` olur (yedek zaten mysqldump, §8.3).

- `deploy/docker-compose.yml` mysql `command` satırı güncellendi: `["--default-time-zone=+00:00", "--log-bin-trust-function-creators=1"]`.
- `apps/server/scripts/test-db.sh`: aynı bayrak eklendi; ayrıca `TEST_MIGRATE_DATABASE_URL` (migrator) export ediliyor.
- `.github/workflows/ci.yml`: servis konteynerine argüman verilemediği için 01-users.sh'tan sonra root ile `SET GLOBAL log_bin_trust_function_creators = 1` çalıştırılıyor; env'e `TEST_MIGRATE_DATABASE_URL` eklendi.
- Bayrak yoksa migration **ilk ifadede** (tetikleyici) 1419 ile durur ve hiçbir şey değişmez (doğrulandı: tablo, tetikleyici ve indeks değişmedi). Kurtarma: bayrağı aç → `prisma migrate resolve --rolled-back 20261113090000_p11_system_settings_audit` → `pnpm db:migrate`.
- **`--sysdate-is-now` eklenmemeli** (DELETE tetikleyicisi SYSDATE'e dayanır).

### Runbook'a eklenecek adım (devops — staging/prod, P11 deploy'undan ÖNCE)

1. Yedek al (mysqldump, runbook).
2. Yeni compose dosyasıyla `cd deploy && docker compose up -d mysql`. `command` değiştiği için konteyner yeniden oluşturulur; `mysql_data` volume'u ve veri korunur. Healthy olmasını bekle.
3. Doğrula: `docker compose exec mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -Ne "SELECT @@log_bin, @@log_bin_trust_function_creators"'` → `1	1`.
4. `docker compose up -d` (migrate servisi P11'i uygular, sonra server başlar).
5. `APP_PW=… CONTAINER=<mysql konteyneri> DB=… deploy/mysql/check-app-grants.sh` → tümü PASS (P11 satırları: tetikleyici sayısı 2, app DDL/TRIGGER yetkisi 0).

- Restart istenmezse alternatif: root ile `SET PERSIST log_bin_trust_function_creators = 1` (volume'daki `mysqld-auto.cnf`'e yazılır). Yine de compose bayrağı kaynak gerçeklik olarak kalmalı.

### system_settings

| Sütun                      | Tip                         | Not                                                                                                                                   |
| -------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `key`                      | VARCHAR(60) PK              | CHECK ikili kümede (ADR-0014): `mysql`, `turn`. Yeni anahtar (P12 sistem logosu vb.) gelirse CHECK'i genişleten bir migration gerekir |
| `value_json`               | JSON?                       | nesne, ≤ 4 KB (`JSON_STORAGE_SIZE`); anahtar başına `JSON_SCHEMA_VALID`, `additionalProperties:false` → gizli değer buraya yazılamaz  |
| `secret_enc`               | VARBINARY(512)?             | AES-256-GCM (§3.2), ≥ 30 bayt                                                                                                         |
| `updated_by`               | CHAR(26)? FK users RESTRICT | IX(updated_by); kullanıcılar soft delete edildiği için RESTRICT sorun çıkarmaz                                                        |
| `created_at`, `updated_at` | DATETIME(3)                 | dba kuralı (mimaride yalnız updated_at vardı)                                                                                         |

- **mysql** (`system_settings_mysql_chk`): `{host, port, database, user}` dördü de zorunlu, başka alan yok. host: ASCII ad / IPv4 / `[IPv6]`, 1..253 (SMTP host kuralıyla aynı); port: tamsayı 1..65535 (`"3306"` dizesi reddedilir); database `^[A-Za-z0-9_$-]{1,64}$`; user 1..32, Cc/Cf/Zl/Zp yok. Şifre `secret_enc`'te ve opsiyonel. **zod aynı kuralları uygulamalı** (backend).
- **turn** (`system_settings_turn_chk`): `{urls}`; 0..10 tekil URL, `^(stun|turn|turns):[!-~]+$`, her biri ≤ 255. `turn:`/`turns:` URL'si varsa `secret_enc` zorunlu (env.ts TURN_SECRET kuralıyla aynı). Satır yoksa env `TURN_URLS`/`TURN_SECRET` kullanılır (öneri; backend karar verir).
- Tek satıra eşzamanlı ilk yazımda iki INSERT yarışırsa biri P2002 alır. Öneri: `upsert` (INSERT … ON DUPLICATE KEY UPDATE).
- Seed değişmedi: satır yoksa varsayılan/env kullanılır, geliştirme ortamı boş kalmaz.

### audit_logs tetikleyicileri (mimari §3.3)

- `audit_logs_no_update` BEFORE UPDATE → `SIGNAL 45000 'audit_logs is append-only: UPDATE denied'`. Migrator ve root dahil herkes için geçerli; `INSERT … ON DUPLICATE KEY UPDATE` de reddedilir.
- `audit_logs_retention_only_delete` BEFORE DELETE → `IF NOT COALESCE(OLD.created_at <= CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00') - INTERVAL 730 DAY, FALSE) THEN SIGNAL`.
  - **Sapma (NOW → SYSDATE):** `SET TIMESTAMP` yetki gerektirmez ve `NOW()`/`UTC_TIMESTAMP()`'ı ileri alır. Deneyle doğrulandı: app oturumunda `SET TIMESTAMP=2030` sonrası `NOW()` 2030 dönüyor. Mimari metnindeki `NOW()` kullanılsaydı, P13'te DELETE yetkisi alan app yeni satırları silebilirdi. `SYSDATE()` gerçek saati döner. `CONVERT_TZ` ise oturumun `time_zone`'u değiştirilse de (+14:00 denendi) değeri UTC'ye çevirir. Karşılaştırma NULL çıkarsa silme reddedilir (fail-closed).
  - TRUNCATE tetikleyiciyi atlar ama DROP yetkisi ister; app'te bu yetki yok. FK'ler RESTRICT, cascade yok.
- DEFINER = `migrator@%`. Migrator kullanıcısı silinir veya yeniden adlandırılırsa UPDATE/DELETE "definer does not exist" ile reddedilir (fail-closed). INSERT etkilenmez. mysqldump tetikleyicileri DEFINER ile birlikte döker; ayrı `backup` kullanıcısı TRIGGER yetkisi ister (Yedek bölümü).
- **audit_logs DELETE yetkisi app'e VERİLMEDİ** (en az yetki). Bugün audit silen hiçbir kod yok; yetki P13 retention ile `grants.sql`'e eklenecek, tetikleyici o gün de 730 gün sınırını uygulayacak. P1 notundaki "P11/P13" ifadesi: P11 = tetikleyici, P13 = yetki.

### Audit ekranı indeksleri (AC-76; filtreler tarih/kullanıcı/işlem/sonuç; sıralama `created_at DESC, id DESC`)

| Kapsam + filtre                              | İndeks                                                       |
| -------------------------------------------- | ------------------------------------------------------------ |
| Admin (tenant) + tarih / + sonuç             | IX(tenant_id, created_at) — sonuç indeks üstünde filtrelenir |
| Admin + kullanıcı                            | **IX(user_id, created_at)** (yeni)                           |
| Admin + işlem                                | IX(tenant_id, action, created_at)                            |
| Super Admin tüm tenant'lar + tarih / + sonuç | IX(created_at)                                               |
| Super Admin + kullanıcı                      | **IX(user_id, created_at)**                                  |
| Super Admin + işlem                          | **IX(action, created_at)** (yeni)                            |

- **Sapma:** IX(tenant_id, user_id, created_at) kaldırıldı, yerine IX(user_id, created_at) geldi. user_id ULID ve tek tenant'a ait (P2 technician_id gerekçesi). `sessions/email.ts` sayımı (tenant+user+action+tarih) da bu indeksi kullanır. Net değişim +1 indeks. `id DESC`: InnoDB ikincil indeksi PK'yi sonda taşır, sıralama indeksten gelir.
- `result` için indeks eklenmedi. Değer kümesi iki elemanlı; mevcut indeksin üstünde filtrelenir.
- Backend uyarısı: 730 günlük aralıkta `COUNT(*)` ile toplam sayfa hesabı tüm aralığı tarar. Öneri: keyset (`(created_at, id) <` imleç) veya üst sınırlı sayım; varsayılan tarih aralığı (ör. son 30 gün).
- İndeks DDL'i `ALGORITHM=INPLACE, LOCK=NONE` (çevrimiçi).
- Prisma 7.10.1 `migrate diff` bir hata üretti: indeksi düşürürken `audit_logs` FK'sini düşürüp **yanlış tabloya** (`tenant_settings_tenant_id_fkey`) geri ekleyen satırlar. Bu satırlar elle çıkarıldı (gerekçe migration.sql'de). Sonrasında `migrate diff --exit-code` = 0.

### Yetkiler (`grants.sql`, `check-app-grants.sh`)

| Tablo           | app                                                                       |
| --------------- | ------------------------------------------------------------------------- |
| system_settings | SELECT, INSERT, UPDATE; DELETE/ALTER/DROP/INDEX/TRIGGER/REFERENCES REVOKE |
| audit_logs      | değişmedi: SELECT, INSERT (DELETE → P13)                                  |

`check-app-grants.sh` +18 kontrol:

- root ile: tetikleyici sayısı = 2; app'in global/DB yetkisi ve tablo düzeyi TRIGGER/ALTER/DROP/CREATE/INDEX yetkisi = 0; audit_logs'ta yalnız SELECT/INSERT; sütun yetkisi yok. Betik artık konteyner env'indeki `MYSQL_ROOT_PASSWORD`'ü kullanıyor (compose, test-db ve CI'da tanımlı).
- app ile: UPDATE, DROP/CREATE TRIGGER, RENAME ve ALTER INDEX reddediliyor; system_settings izinleri ve 4 CHECK doğru çalışıyor.

### Test bulgusu (diğer testler için)

`CREATE/DROP TRIGGER` ve `RENAME TABLE` prepared statement protokolünde **1295** ("not supported") döner. Prisma `$executeRawUnsafe` ile "reddedildi" görünür ama yetki sınanmamış olur. `db-grants.test.ts`'teki CREATE/DROP TRIGGER satırları bu yüzden **yanlış pozitif**. Yeni test, metin protokolüyle (`mariadb` sürücüsü, Prisma adaptörünün bağımlılığından çözülür; yeni bağımlılık yok) ve hata metninde "command denied" arayarak sınıyor.

### Geri alma

`down.sql`: `system_settings`'te satır varsa `p11_down_guard_chk` ile durur (hiçbir şey değişmez). Satır yoksa: yetkileri REVOKE eder, tetikleyicileri ve tabloyu düşürür, IX(tenant_id, user_id, created_at)'i geri ekler, P11 indekslerini düşürür, `_prisma_migrations` kaydını siler.

### Test (2026-11-12/13, geçici `mysql:8.4` 8.4.13, binlog AÇIK + bayrak; `rs-mysql-p11dba:33341`, `rs-mysql-p11fresh:33342`; ikisi de silindi)

- **P10 durumundaki DB** (staging senaryosu): up OK, drift 0. `check-app-grants.sh` **320/320 PASS** (önceki 302 + 18 P11).
  - down guard (satır varken) → 3819, hiçbir şey değişmedi. Satır silinip down çalıştırılınca: tetikleyici 0, tablo 0, yetki 0, son migration P10; HEAD (P10) şemasına göre drift 0. Yeniden up → drift 0, `migrate status` güncel.
  - Bayrak 0 iken migrate → P3018/1419; tablo, tetikleyici ve eski indeks değişmedi. Bayrak açılıp `resolve --rolled-back` + migrate → OK.
- **Temiz DB:** `test-db.sh up` (P1→P11) OK, 320/320 PASS. `test:int` 421 testten 420'si geçti. Kalan 1 test `session-history-p8` ikili CHECK sayımıydı: 19 → 22 olarak güncellendi (P11 key/mysql/turn), sonra geçti. down → up → drift 0.
- `audit-immutability-p11.test.ts` **12/12**: migrator UPDATE → SIGNAL; 0/365/729 gün DELETE → SIGNAL; `SET TIMESTAMP=2035` ve `time_zone=+14:00` ile de SIGNAL (730 güne 10 saat kalan satır dahil); 731 gün DELETE OK; app UPDATE/DELETE/DROP·CREATE TRIGGER/ALTER/TRUNCATE/DROP/RENAME/GRANT → yetki hatası; system_settings geçerli/geçersiz kayıtlar (anahtar, nesne/boyut, secret, mysql ve turn şemaları); app DELETE/DDL yok.
- `pnpm db:generate` + server `typecheck` temiz; birim testleri 310/310.

## P12 — marka ve kişiselleştirme (2026-11-13)

Migration `apps/server/prisma/migrations/20261113120000_p12_branding/{migration.sql,down.sql}`. Mimari §3.1, §10 P12; AC-81..85; T16. **Yalnız CHECK**: yeni tablo/sütun, veri taşıma, Prisma şema değişikliği yok (drift 0). Seed değişmedi (satır/yol yoksa varsayılan Nokta logosu ve baş harf avatarı — geliştirme ortamı boş kalmaz).

### Mevcut olan, eklenmeyen

| İhtiyaç               | Alan                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| Tenant logosu         | `tenants.logo_path VARCHAR(200)?`                                                                       |
| Avatar                | `users.avatar_path VARCHAR(200)?`                                                                       |
| Tema (AC-85)          | `users.theme VARCHAR(20)` vars. `SYSTEM`; `users_theme_chk` ADR-0014 migration'ında zaten ikili (`LIGHT | DARK | SYSTEM`) → dokunulmadı |
| Sistem logosu (AC-82) | `system_settings` anahtarı `system_logo` (yeni değer, tablo P11)                                        |

### Yol biçimi (karar)

Backend'in yazacağı biçim: **`{öndek}/{rastgele}.{uzantı}`**, yükleme köküne göre göreli (`uploads/` öneki DB'ye yazılmaz).

- öndek: `tenants` → satırın **kendi `id`'si**; `users` → satırın **`tenant_id`'si**, Super Admin (tenant_id NULL) → `system`; sistem logosu → `system`.
- rastgele: `[A-Za-z0-9_-]{16,100}` (base64url ≥ 12 bayt, ULID veya hex uygun). Nokta ve `/` yok → `..`, gizli dosya, alt dizin, mutlak yol imkânsız.
- uzantı: `png|jpg|webp`, küçük harf (`jpeg`, `PNG`, `svg` ret; sharp yeniden kodlar, uzantıyı sunucu seçer).
- Harf duyarlı (`'c'`; sütunlar `_ci`), son `\z` (ICU `$` sondaki `\n`'yi kabul ediyor — P10 madde 3). Öndek eşitliği `CAST(... AS BINARY)`.
- **Öndek satırın tenant'ına bağlı:** başka tenant klasörünü gösteren yol DB'ye yazılamaz (AC-84 izolasyonunun DB savunması). Yan etki: avatarı olan kullanıcının `tenant_id`'si değiştirilemez (önce avatar kaldırılır) — bugün böyle bir akış yok.
- DB savunma derinliğidir; birincil kontrol backend `uploads/*` (magic bytes, sharp, rastgele ad). Dosyayı sunarken yolu yine sunucu kurmalı ve tenant'ı oturumdan doğrulamalı (CHECK yalnız yazılan değeri sınar).

| CHECK                             | Kural                                                                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tenants_logo_path_chk`           | NULL veya `^[0-9A-Z]{26}/[A-Za-z0-9_-]{16,100}[.](png\|jpg\|webp)\z` + öndek = `id`                                                                                                                          |
| `users_avatar_path_chk`           | NULL veya `^([0-9A-Z]{26}\|system)/…\z` + öndek = `COALESCE(tenant_id,'system')`                                                                                                                             |
| `system_settings_key_chk`         | ikili `mysql\|turn\|system_logo` (DROP+ADD aynı ALTER)                                                                                                                                                       |
| `system_settings_system_logo_chk` | key ≠ system_logo veya (value_json dolu, secret_enc NULL, JSON şema `{path}` zorunlu tek alan, `^system/[A-Za-z0-9_-]{16,100}[.](png\|jpg\|webp)$`) — rapidjson `$` sondaki `\n`'yi reddediyor (test edildi) |

Backend notu: zod aynı deseni uygulamalı. Sistem logosu kaldırma için bkz. açık nokta 1.

### Kilit / guard

- ADD CHECK = ALGORITHM=COPY → `tenants`, `users`, `system_settings` yeniden yazılır (küçük tablolar; prod kapalı).
- Up guard `p12_up_guard_chk` (3819): biçime uymayan logo/avatar satırı varsa migration hiçbir şey değişmeden durur (P12 öncesi kod bu sütunları yazmıyordu). Kurtarma: satırı NULL'a çek (dosya yeniden yüklenir) → `prisma migrate resolve --rolled-back 20261113120000_p12_branding` → `pnpm db:migrate`.
- `down.sql`: `system_logo` satırı varsa `p12_down_guard_chk` ile durur; yoksa 3 CHECK'i düşürür, key CHECK'ini `mysql|turn`'e döndürür, `_prisma_migrations` kaydını siler. Yol değerleri korunur.

### Yetkiler

Değişiklik yok: app'in `tenants`/`users` tablo düzeyi UPDATE'i (logo_path, avatar_path, theme dahil) ve `system_settings` SELECT/INSERT/UPDATE'i P1/P11'den var. `grants.sql` değişmedi; `check-app-grants.sh` +10 P12 satırı.

### Açık noktalar (backend/mimar)

1. **Sistem logosunu kaldırma:** app'te `system_settings` DELETE yok ve şema `value_json` NULL'a izin vermiyor. Seçenek A (öneri, en az yetki): kaldırma yok, yalnız "değiştir" (AC-82 sistem logosunu yalnız değiştirmeyi ister); B: grants'e `system_settings` DELETE eklenir (mysql/turn satırlarını da silebilir hale gelir — P11'de bilinçli verilmedi). Karar backend/mimar; DELETE istenirse dba migration+grant günceller.
2. ICU `$` bulgusundaki 6 eski CHECK (P10 madde 3) bu pakette **çevrilmedi** (kapsam küçük tutuldu); açık kalıyor.

### Test (2026-11-13, geçici `mysql:8.4` 8.4.13 binlog açık + bayrak, `rs-mysql-p12dba:33351`, silindi)

- **Temiz DB** P1→P12 OK. `check-app-grants.sh` **330/330 PASS** (320 + 10 P12).
- **down**: system_logo satırı varken `p12_down_guard_chk` 3819, hiçbir şey değişmedi; satır silinince OK → P11 durumu, drift 0.
- **P11 durumundaki DB → up**: geçersiz `logo_path` (`../etc/passwd`) varken `p12_up_guard_chk` 3819 (P3018), CHECK'ler ve key CHECK'i değişmedi; satır düzeltilip `resolve --rolled-back` + migrate → OK, `migrate status` güncel, drift 0.
- `branding-p12.test.ts` (yeni, app kullanıcısı): logo/avatar geçerli/geçersiz yollar (başka tenant, `..`, alt dizin, mutlak, `uploads/`, svg/PNG/jpeg, `\n`, kısa/uzun/ASCII dışı ad), Super Admin `system/`, tenant değişimi engeli, tema ikili, system_logo şema/secret/anahtar.
- Güncellenen: `audit-immutability-p11` (system_logo artık geçerli anahtar → ret listesinde `SYSTEM_LOGO`), `session-history-p8` ikili CHECK sayısı 22 → 25.
- `test:int` **455/455**, birim 324/324, typecheck + lint temiz.

## WhatsApp servis ayarı — `system_settings.whatsapp` (2026-11-14)

Migration `apps/server/prisma/migrations/20261114090000_whatsapp_service_setting/{migration.sql,down.sql}`. P12b, AC-196 (mimari §3.1): Super Admin WhatsApp servis adresini panelden girer; kayıt yoksa env `WHATSAPP_SERVICE_URL`. **Yalnız CHECK**: tablo/sütun, veri taşıma, Prisma şema, seed, grant değişikliği yok (drift 0; satır yoksa env/varsayılan geçerli — geliştirme ortamı boş kalmaz).

| CHECK                          | Kural                                                                                                                                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `system_settings_key_chk`      | ikili `mysql\|turn\|system_logo\|whatsapp` (DROP+ADD aynı ALTER)                                                                                                                                                             |
| `system_settings_whatsapp_chk` | key ≠ whatsapp veya: `value_json` dolu; `secret_enc` NULL; JSON şema `{"url": string\|null}` (url zorunlu, tek alan, `maxLength` 200 kod noktası); url string ise ICU `REGEXP_LIKE(url, '^https?://[^@?#\s\p{Cc}]+\z', 'c')` |

- `\s` = ICU Unicode boşlukları (`\t\n\f\r` + `\p{Z}`: NBSP, U+2028, U+3000…); `\p{Cc}` = C0/C1 kontrol + DEL. Harf duyarlı: `HTTP://` ret. Sonda `\z` (ICU `$` sondaki `\n`'yi kabul eder — P10 madde 3).
- `url: null` = "panelden ayar yok" (env/varsayılana dön). Satır silinemez (app'te DELETE yok, P11 kararı) → kaldırma `{url:null}` ile yapılır.
- CHECK yalnız biçimi sınar; SSRF/özel adres denetimi (mimari-e9 T33, §13.5 fail-closed) backend'de kalır.
- Kilit: ADD CHECK = COPY, `system_settings` birkaç satır. Ön koruma gerekmez (eski key CHECK'i `whatsapp` satırına izin vermiyordu).
- `down.sql`: `whatsapp` satırı varsa `wa_down_guard_chk` (3819) ile hiçbir şey değişmeden durur; yoksa yeni CHECK'i düşürür, key CHECK'ini P12 kümesine döndürür, `_prisma_migrations` kaydını siler.

### Test (2026-11-14, geçici `mysql:8.4.13` binlog açık + bayrak, `rs-mysql-wadba:33361`, silindi)

- Temiz DB P1→bu migration OK; `check-app-grants.sh` **337/337 PASS** (330 + 7).
- down: satır varken `wa_down_guard_chk` 3819, CHECK'ler ve migration kaydı değişmedi; satır silinince OK → P12 durumu, drift 0. P12 durumundaki DB (mysql/turn/system_logo satırları dolu) → `migrate deploy` OK, `migrate status` güncel, drift 0.
- `whatsapp-setting.test.ts` (yeni, app kullanıcısı): geçerli null/http/https/port/yol/IPv6/200 karakter; ret: anahtar varyantları, value_json NULL/`{}`/ek alan/dizi/tip, secret_enc, şema (`ftp`, `HTTP`, `//`, boş, `http://`), `@ ? #`, boşluk/tab/`\n`/`\r`/NUL/DEL/U+0085/NBSP/U+2028/U+3000, 201 karakter.
- Güncellenen: `audit-immutability-p11` ve `branding-p12` geçersiz anahtar listeleri (`WHATSAPP`, `WhatsApp`, `whatsapp `…), `session-history-p8` ikili CHECK sayısı 25 → 26. `test:int` **479/479**, typecheck + lint temiz.

## P13a — saklama, audit created_at zorlaması, app DELETE yetkileri, `backup` kullanıcısı (2026-11-14)

Migration `apps/server/prisma/migrations/20261114120000_p13a_retention/{migration.sql,down.sql}`. Mimari §10.5 D1–D3, mimari-p13 §2 (K-P13-1..4), §3 (B-P12b-4), §4; AC-197, 198, 200. Expand-only, veri taşıma yok. Seed değişmedi (yeni sütun NULL = anonim değil; geliştirme ortamı boş kalmaz).

### Şema (D1)

| Değişiklik                                                   | Ayrıntı                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `support_sessions.anonymized_at DATETIME(3) NULL`            | Prisma `anonymizedAt`. ALGORITHM=INSTANT                                                                                                                                                                                                                                                                                              |
| `support_sessions_anonymized_chk`                            | `anonymized_at IS NULL OR (status IN (ENDED,EXPIRED,CANCELLED) AND customer_name, customer_email, note, guest_net_key, guest_ip_key IS NULL)`. ticket_no, mod, kalite özeti kalır. Anonim oturuma kişisel alan yazan her UPDATE 3819 (PATCH 409'un DB savunması). CAST yok (status_chk zaten ikili) → ikili CHECK sayısı **26 kalır** |
| IX `support_sessions_tenant_id_anonymized_at_created_at_idx` | Aday sorgusu `tenant_id = ? AND anonymized_at IS NULL AND created_at < ? AND status IN (…) ORDER BY created_at, id LIMIT 1000`. INPLACE, LOCK=NONE                                                                                                                                                                                    |
| Tetikleyici `audit_logs_force_created_at` (BEFORE INSERT)    | `IF CAST(SUBSTRING_INDEX(USER(),'@',1) AS BINARY) NOT IN ('migrator','root') THEN SET NEW.created_at = CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00')`. audit_logs tetikleyici sayısı **2 → 3**                                                                                                                                |
| `system_settings_whatsapp_chk`                               | desen `^https?://[^@?#\s\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+\z` ('c'); geri kalanı P12b ile aynı                                                                                                                                                                                                                                                |

**Tetikleyici koşulu (K-P13-4 kararı):** zorlanan liste değil **muaf liste** (fail-closed): yalnız `migrator` (migration, test fikstürü) ve `root` (geri yükleme; mysqldump satırları özgün `created_at` ile döner) kendi değerini yazar; `app` ve ileride eklenecek her hesap DB saatine zorlanır. `USER()` kullanıldı, çünkü tetikleyici içinde `CURRENT_USER()` DEFINER'ı (migrator) döndürür. Saat kaynağı P11 DELETE tetikleyicisiyle aynıdır (SYSDATE + UTC). `SET TIMESTAMP` ve `time_zone=+14:00` ile denendi, etkilemiyor. CONVERT_TZ NULL dönerse NOT NULL ihlaliyle INSERT reddedilir.

- Sonuç: app'in Prisma `createdAt` / ham SQL `created_at` değeri yok sayılır. 2020 tarihli ekle → sil denemesi `older than 730 days` ile düşer.
- **Test fikstürü:** geçmiş tarihli audit satırı artık app ile yazılamaz. Bunun için `test/helpers/app.ts` `testFixtureDb()` (TEST_MIGRATE_DATABASE_URL) kullanılır; `audit-p11.test.ts` buna geçirildi. **Backend retention testleri de (730 g) bunu kullanmalı.**

**Kilit:** ADD CHECK = COPY → support_sessions yeniden yazılır (staging küçük, prod kapalı). Diğer DDL çevrimiçidir.
**Up guard `p13a_up_guard_chk`:** mevcut `whatsapp` adresinde Cf/Zl/Zp varsa migration hiçbir şey değişmeden 3819 (P3018) ile durur. Kurtarma: adres yeniden girilir ya da `{url:null}` yapılır → `prisma migrate resolve --rolled-back 20261114120000_p13a_retention` → `pnpm db:migrate`. Test edildi.
**down.sql:** anonim oturum varsa `p13a_down_guard_chk` (3819) ile hiçbir şey değişmeden durur. Yoksa: P13a grant'larını REVOKE eder (tablo REVOKE'u sütun yetkisini kaldırmadığı için sütun yetkisi ayrıca), tetikleyiciyi, CHECK'i, indeksi ve sütunu düşürür, WhatsApp CHECK'ini P12b desenine döndürür, `_prisma_migrations` kaydını siler.

### Ek: `audit_logs_no_update` gövdesi (devops yedek provası bulgusu, 2026-11-14)

- **Sorun:** P11'de tetikleyici tek ifadelik gövdeyle yazılmıştı (`SIGNAL …;`). Prisma çok ifadeli gönderdiği için MySQL sondaki `;`'yi gövdeye dahil etti; ACTION_STATEMENT `…UPDATE denied';` olarak saklandı.
- **Etkisi:** mysqldump bunu `…'; */;;` olarak döküyor ve düz `mysql` istemcisiyle geri yükleme 1064 veriyor (AC-200).
- **Düzeltme:** P13a migration'ında (madde 0) `DROP` + `CREATE` ile **BEGIN…END** gövdesi kuruldu. Bileşik ifade `END`'de biter. Davranış ve DEFINER aynıdır. P11 migration dosyasına dokunulmadı (checksum).
- **Diğer iki tetikleyici** (`retention_only_delete`, `force_created_at`) IF…END IF gövdeli ve `END IF` ile bitiyor; sorun yok.
- **Kural:** yeni tetikleyiciler bileşik gövdeyle (BEGIN…END / IF…END IF) yazılır.
- **down.sql** gövdeyi bilerek P11 biçimine döndürmez.
- **Test (`rs-mysql-p13d2:33393`, silindi):**
  - Temiz DB'de up sonrası üç gövdede de sonda `;` yok.
  - `backup` kullanıcısıyla mysqldump alındı (`'; */;;` sayısı 0). Döküm düz `mysql` ile boş bir DB'ye 1064'süz yüklendi (rc 0, 3 tetikleyici, son migration p13a).
  - drift 0. `check-app-grants.sh` 373/373 PASS.
  - Temiz DB'de `test:int` 52 dosya, **525/525**.
  - down → up: drift 0, gövde yine BEGIN…END.
- **Restore-verify notu (devops):** tetikleyicilerin DEFINER'ı `migrator@%`. Bu hesabın olmadığı (ya da hedef DB'de yetkisinin olmadığı) scratch MySQL'de UPDATE/DELETE/INSERT tetikleyicileri çalışırken hata verir. Bu fail-closed bir davranış; yalnız sayım/satır doğrulaması yapılıyorsa sorun değildir.

### Yetkiler (D2, `grants.sql`)

| Tablo                                                                                                        | P13a sonrası app                                                                           |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| audit_logs                                                                                                   | SELECT, INSERT, **DELETE** (730 g sınırı tetikleyicide; UPDATE yok)                        |
| password_reset_tokens                                                                                        | SELECT, INSERT, **DELETE**, UPDATE(used_at, updated_at)                                    |
| session_files                                                                                                | SELECT, INSERT, **DELETE** (UPDATE yok, K-P13-2)                                           |
| session_consents                                                                                             | SELECT, INSERT, **UPDATE(ip, user_agent)**; DELETE yok                                     |
| auth_sessions                                                                                                | değişmedi: SELECT/INSERT/UPDATE/DELETE P1'den beri var (+7 g silme için ek yetki gerekmez) |
| support_sessions, support_requests, device_bindings, customers, request_refs, consent_texts, system_settings | **DELETE yok** (K-P13-1/K27; genişleme `purgeAnonymized()` o pakette grant ekler)          |

- `check-app-grants.sh`: app'in DELETE yetkili tablo kümesi ve sütun yetkisi kümesi **tam eşitlikle** sınanıyor. Yeni bir DELETE ya da sütun yetkisi eklenirse betikteki beklenen liste de güncellenmeli.
- `session_consents` sütun dışı UPDATE → 1143 (`command denied … for column`).

### `backup` kullanıcısı (D3)

- **Hesap:** `'backup'@'localhost'`, `MYSQL_DATABASE.*` üzerinde **SELECT, SHOW VIEW, TRIGGER**. Global yetkisi yok.
- **PROCESS verilmedi:** mimari önerisindeydi, ancak yalnız tablespace dökümü için gerekir ve `--no-tablespaces` ile gereksizdir. Global PROCESS diğer oturumların SQL metnini gösterir.
- **LOCK TABLES / RELOAD verilmedi:** `--single-transaction` ve `--set-gtid-purged=OFF` ile FTWRL yapılmaz.
- **TRIGGER:** `--triggers` için zorunlu. Yan etkisi CREATE/DROP TRIGGER iznidir. Bu yüzden hesap yalnız `localhost`'tur: soket, yani mysql konteyneri içi. TCP `127.0.0.1` ile bile 1045 döner (test edildi). Tetikleyici sayısı check-app-grants'te ve restore-verify'da izlenir.
- **Env:** `MYSQL_BACKUP_PASSWORD` (≥ 16 karakter).
  - `.env.example`'da anahtar boş durur. Yalnız compose `mysql` servisine verilir (`${MYSQL_BACKUP_PASSWORD:-}`, isteğe bağlı).
  - Boşsa 01-users.sh kullanıcıyı oluşturmaz ve uyarı yazar.
  - Server okumadığı için `env.ts`'te yoktur (mimari-p13 §4 istisnası).
- **Yeni kurulum:** `deploy/mysql/init/01-users.sh`.
- **Mevcut kurulum:** root ile `deploy/mysql/backup-user.sql`. Çalıştırma komutu dosya başlığındadır: değerler konteyner env'inden onaltılı literal olarak aktarılır, parola süreç argümanında görünmez.
  - İdempotenttir: parolayı günceller, yetkileri tam kümeye eşitler (fazla PROCESS/INSERT geri alındı, test edildi).
  - Kısa parola `backup_user_guard_chk` ile reddedilir.
- **Yedek betiği için öneri:** `docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_BACKUP_PASSWORD" mysqldump -ubackup --single-transaction --no-tablespaces --triggers --set-gtid-purged=OFF "$MYSQL_DATABASE"'`. Böylece backup.env'deki `BACKUP_DB_PASSWORD`'e gerek kalmaz; kullanılırsa değeri `MYSQL_BACKUP_PASSWORD` ile aynı olmalı.
- **CI:** `MYSQL_BACKUP_PASSWORD` env'i eklendi, 01-users.sh'a ve check-app-grants'e (`BACKUP_PW`) iletiliyor. `test-db.sh` rastgele parola veriyor.

### Test (2026-11-14, geçici `mysql:8.4.13` binlog açık + bayrak, `rs-mysql-p13d:33391`, silindi)

- **Temiz DB** P1→P13a OK, drift 0. `check-app-grants.sh` **373/373 PASS**. Yeni kontroller:
  - audit: DELETE, ekle-sil reddi, tetikleyici sayısı 3, DROP TRIGGER reddi.
  - Yetki kümeleri; session_consents sütun UPDATE ±; session_files/reset DELETE.
  - anonymized CHECK 6 durum; WhatsApp Cf/Zl/Zp 7 durum.
  - backup: hesap/host/yetki kümesi, DML/DDL/LOCK reddi, gerçek `mysqldump` rc=0 + 3 tetikleyici + `_prisma_migrations`.
- **down:** anonim oturum varken 3819, hiçbir şey değişmedi. Temizlenince OK: tetikleyici 2, P13a grant'ları geri alındı, HEAD (P12b) şemasına drift 0. Yeniden up → drift 0, `migrate status` güncel.
- **P12b durumu + U+200B'li whatsapp satırı → up:** 3819 (P3018), tetikleyici ve sütun değişmedi. Satır düzeltilip resolve + migrate → OK, drift 0, 373/373 PASS.
- `retention-p13a-db.test.ts` (yeni, 15 test):
  - Zorlama: Prisma/ham, geçmiş/gelecek, SET TIMESTAMP/time_zone; migrator muaf.
  - DELETE: 731 g OK, 729/0 g SIGNAL, ekle-sil reddi, parti atomik.
  - Yetkiler: session_consents sütun ±, session_files ve reset DELETE, K27 DELETE reddi (8 tablo).
  - anonymized CHECK ve indeks.
- `whatsapp-setting.test.ts` += Cf/Zl/Zp (12 karakter × yol/host).
- Güncellenen testler:
  - `audit-immutability-p11`: tetikleyici 3, app DELETE artık yetki reddi değil.
  - `session-files-p5`: DELETE izinli.
  - `audit-p11`: geçmiş tarihli fikstür `testFixtureDb`.
- `test:int` **506 test**. Test güncellemelerinden sonraki tam koşu aynı DB'de yapıldı (ilk koşu P13a öncesi testlerle): 505 geçti. Düşen tek test `branding-api-p12` "boş DB ön koşulu"ydu: önceki koşudan `system_logo` satırı kalmıştı. Satır silinince 16/16 geçti; bu mevcut bir test varsayımı. Etkilenen 5 dosya ayrıca 52/52 geçti. **Temiz DB'de tek tam koşu yapılmadı** (qa/CI'da doğrulanmalı).
- typecheck + lint temiz.

## P13b — geri yüklemede migrator, CHECKSUM, audit süreklilik (2026-11-14)

Mimari-p13 §7.6, §7.11, §7.16 D1/D2; ADR-0020 m.2 ve m.5; güvenlik raporu P13b tasarım turu **G-P13b-5** (dba payı); AC-298, AC-301.
**Şema, migration, seed ve `grants.sql` değişmedi.** Yeni grant gerekmedi. Bütün iş `deploy/mysql/` altındaki SQL arayüzü ile `check-app-grants.sh`'tedir. `restore.sh` ve `backup.sh`'ye dokunulmadı; onları devops (T1) bu arayüzle değiştirecek.

### Arayüz (devops T1 bunları çağırır)

| Dosya                                   | Hesap               | Ne zaman                                                                                                            | Çıktı / beklenen                                                                                                                                                                                                                                                                       |
| --------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy/mysql/restore-sec-snapshot.sql` | root (yalnız okuma) | yüklemeden önce ve sonra, scratch ve canlıda                                                                        | `restore.sh` `sec_snapshot` heredoc'unun **yerine** geçer (aynı biçim; `\| tr '\n\t' ' :'`). Sona `plugins=`, `views=`, `anon=`, `migratorExtra=` eklendi. Önce ve sonra eşit olmalı. **Mutlak koşul (yüklemeden önce):** `anon=0` ve `migratorExtra=0`; sağlanmazsa yükleme yapılmaz. |
| `deploy/mysql/restore-reset-db.sql`     | **migrator**        | yalnız canlıda: scratch OK + `stop web server` sonrası, yüklemeden önce                                             | Önüne `SET @rs_confirm_db = '<db>';` eklenir. Çıktı: tek satır `restore-reset: OK <db> <cs> <coll>`. Guard (3819) şu durumlarda hiçbir şey değiştirmeden durur: root ya da başka bir hesapla çalıştırma, onay yok ya da farklı (harf duyarlı), sistem şeması.                          |
| (döküm yükleme)                         | **migrator**        | scratch, sonra canlı                                                                                                | `gzip -dc db.sql.gz \| fix_trigger_dump \| docker exec -i $C sh -c 'MYSQL_PWD="$MYSQL_MIGRATOR_PASSWORD" exec mysql -umigrator --protocol=socket --system-command=OFF --local-infile=0 --default-character-set=utf8mb4 -NB "$MYSQL_DATABASE"'`. rc≠0 → FAIL.                           |
| `deploy/mysql/checksum-tables.sql`      | migrator            | yükleme bittikten sonra, `docker compose up -d`'den önce, iki tarafta                                               | Her tablo için bir satır: `<db>.<tablo>\t<checksum>`, ikili sıralı, `_prisma_migrations` dahil, bütün BASE TABLE'lar. İki çıktı birebir eşit olmalı. Farkta yalnız tablo adı yazılır; `join` satırı dosya başlığında.                                                                  |
| `deploy/mysql/audit-continuity.sql`     | backup              | `backup.sh`, döküm adımının yanında                                                                                 | Tek satır JSON → manifest `audit`. Önceki manifestte `audit.tail` varsa önüne `SET @rs_prev_tail_day=…, @rs_prev_tail_until=…;` eklenir. Alanlar ve karşılaştırma kuralı dosya başlığında (aşağıda özet).                                                                              |
| `deploy/mysql/audit-baseline-reset.sql` | migrator            | yalnız `backup.sh --reset-audit-baseline "<gerekçe>"` üzerinden (root; `restore.sh` canlı yüklemeden sonra çağırır) | Önüne `SET @rs_reason='…', @rs_operator='<kullanıcı>@<host>';` eklenir. Çıktı `audit-baseline-reset: OK id=<n>`. Audit satırı yazar; backup.sh aynı id ile `$BACKUP_DIR/audit-baseline-reset.json` host işaretini (root 600) yazar (S-P13b-1).                                         |

**Scratch kurulumu (D1):** `restore.sh` `start_scratch`'e şunlar eklenir: `-v "$DEPLOY_DIR/mysql/init:/docker-entrypoint-initdb.d:ro"`, `-e MYSQL_APP_PASSWORD=<rastgele>`, `-e MYSQL_MIGRATOR_PASSWORD=<rastgele>`. `MYSQL_BACKUP_PASSWORD` verilmez; o hesap scratch'te gerekmez. Böylece compose ile aynı `01-users.sh` çalışır ve migrator, `<db>`.* üzerinde ALL + GRANT OPTION alır.

- Hazır olma beklemesi P13a'daki gibi kalır. Ek olarak migrator ile `SELECT 1` denenir.
- root yalnız `restore-sec-snapshot.sql` ve tetikleyici sayımı için kullanılır; yazma yapmaz.

**Canlı sırası (D1):** scratch OK → `stop web server` → snapshot (mutlak koşullar) → `restore-reset-db.sql` → migrator ile yükleme → snapshot eşit → `checksum-tables` canlı = scratch → satır/tetikleyici = manifest → `audit-baseline-reset.sql` (gerekçe: `restore <run>`) → `up -d`.

- P13a'daki root `DROP/CREATE DATABASE` printf'i kalkar.
- Scratch'in checksum çıktısı scratch silinmeden önce `$WORK`'e yazılır. Bu çıktı yalnız tablo adı ve sayı içerir, kişisel veri yoktur.

### D1 kararları

- **DB boşaltma = migrator ile `DROP DATABASE` + `CREATE DATABASE` (aynı charset ve collation).** Tablo ve tetikleyiciyi tek tek düşürmeye göre avantajları:
  - Dökümde olmayan her nesne de gider (fazla tablo, view, rutin, olay).
  - FK sırası ya da nesne listesi gerekmez.
  - Migrator'ın `<db>`.* ALL yetkisi DROP ve CREATE'i kapsar. Başka bir DB oluşturamaz (1044).
- **DROP DATABASE hesap ve yetki silmez:** `mysql.db`, `tables_priv` ve `columns_priv` kalır. app'in tablo yetkileri, aynı adlı tablolar yeniden oluşunca geçerli olur.
  - Test: geri yüklenen DB'de `grants.sql` yeniden çalıştırılmadan `check-app-grants` **384/384**.
  - `up -d` içindeki migrate ve grants.sql bunu ayrıca eşitler. migrate "No pending migrations" verdi, drift 0.
- **Tetikleyici DEFINER:** dökümde yalnız `` `migrator`@`%` `` bulunur (testte doğrulandı). Yükleyen de migrator olduğundan `SET_ANY_DEFINER` gerekmez.
  - Kurcalanmış bir dökümde başka bir DEFINER varsa 1227 döner.
- **`created_at` korunur:** mysqldump tetikleyicileri tablonun verisinden **sonra** yazar. Ayrıca `force_created_at`, migrator'ı (`USER()`) muaf tutar. İki yönden de özgün değer kalır.
  - Test: `2025-01-02 03:04:05.678` scratch'te ve canlıda aynı çıktı; UTF-8 JSON da aynı.
  - P13a notundaki "root muaf (restore root kullanır)" gerekçesi artık migrator için geçerli. root muafiyeti ise elle kurtarma için kalır.
- **`--local-infile=0`:** sunucuda `local_infile` 8.4'te varsayılan olarak kapalı. İstemcide de kapatılır. Bu olmadan kurcalanmış bir `LOAD DATA LOCAL INFILE '/proc/1/environ'`, konteyner içindeki root ortamını (MYSQL_ROOT_PASSWORD) bir tabloya okuyabilirdi. Test: 3948.
- **Sınırın türü:**
  - **Önlenenler:** CREATE USER, global ya da `mysql.*` GRANT, ALTER USER, SET PERSIST/GLOBAL, `sql_log_bin`, INSTALL COMPONENT/PLUGIN, `mysql.*` DML, `USE mysql`, başka DB, `INTO OUTFILE`, `LOAD DATA LOCAL`, yabancı DEFINER.
  - **Önlenmeyip yakalananlar** (migrator'ın kendi DB'sindeki yetkisi): `GRANT … ON <db>.* TO app`, `SET PASSWORD` (kendi parolası), CREATE VIEW/EVENT/PROCEDURE. Bunlar scratch'te snapshot farkı verir (`mysql.db`/`mysql.user` checksum, `views=`, `events=`, `routines=`) ve FAIL olur. Canlıya hiç ulaşmazlar, çünkü aynı döküm önce scratch'te yüklenir.
- **Kalıcı iz:** reddedilen ifadeden önceki ifadeler (ör. ilk tablolar) yalnız scratch'te kalır ve scratch silinir.
  - Testte her kurcalama vakası aynı scratch'te `reset → yükle` ile denendi. Hiçbirinde hesap, yetki, kalıcı değişken, bileşen, eklenti ya da view değişmedi.

### D2

- **CHECKSUM:** varsayılan EXTENDED kullanılır; InnoDB'de QUICK NULL döner. Değer ROW_FORMAT'a bağlıdır; iki taraf da aynı imaj ve aynı dökümle kurulur.
  - Yedek **anında** alınmaz, çünkü CHECKSUM TABLE `--single-transaction` anlık görüntüsünü değil güncel veriyi okur. Bu yüzden karşılaştırma scratch ↔ canlı yapılır. Manifest tarafında satır sayısı ve audit özetleri kullanılır.
  - Test: tek hücre değişikliği yalnız `remote.tenants` adıyla yakalandı.
- **Yetki anlık görüntüsü:** P13a listesine `plugins`, `views`, `anon` ve `migratorExtra` eklendi. `migratorExtra` şunların toplamıdır: global statik ve dinamik yetkiler, başka şema, başka şemadaki tablo/sütun/rutin yetkisi, rol, proxy ve `%` dışı migrator hesabı.
- **`check-app-grants.sh` (373 → 384 PASS):**
  - Anonim hesap = 0.
  - `migratorExtra=0` (snapshot dosyasındaki sorgunun aynısı, `sed` ile okunur).
  - Migrator için 7 DENIED denemesi: CREATE USER (1227), `GRANT *.*` (1045), `GRANT mysql.*` (1044), SET PERSIST (1227), `INSERT mysql.user` (1142), CREATE DATABASE (1044), `DEFINER=root` (1227). Ardından root ile koşulsuz temizlik yapılır.
  - `audit-continuity.sql` backup ile çalışır ve `triggers.ok=true`, `count=3` döner.
  - `reset-superadmin` CLI'nin bütün ifadeleri app ile geri alınan bir TX'te denenir.
  - Migrator parolası `MIGRATOR_PW` ya da konteyner env'inden alınır. CI servis konteynerinde env olmadığı için `.github/workflows/ci.yml` adımına `MIGRATOR_PW="$MYSQL_MIGRATOR_PASSWORD"` eklendi.
- **CLI yetkileri (§7.7): değişiklik yok.** Yetkiler: users tablo düzeyi UPDATE (parola, `must_change_password`, `failed_*`, `locked_until`, `totp_*`); `auth_sessions` UPDATE (`revoked_at`); `password_reset_tokens` UPDATE(`used_at`, `updated_at`); `recovery_codes` DELETE; `audit_logs` INSERT. CLI'nin audit `created_at`'i DB saatine zorlanır (app).

### Audit süreklilik (D2 + G-P13b-5)

`audit-continuity.sql` çıktısı (`format: 2`):

| Alan                           | Anlamı                                                    |
| ------------------------------ | --------------------------------------------------------- |
| `instanceId`                   | `@@server_uuid`                                           |
| `maxId`                        | en büyük audit id                                         |
| `asOfUtcDate`, `measuredAtUtc` | ölçüm günü ve anı                                         |
| `baseline {id, at}`            | son taban çizgisi sıfırlama kaydı                         |
| `triggers {count, digest, ok}` | tetikleyici sayısı, gövde özeti, beklenen sabitle eşleşme |
| `days {"YYYY-MM-DD": {n, h}}`  | 729 tamamlanmış gün: satır sayısı ve içerik özeti         |
| `tail {day, until, n, h}`      | bugünün ölçülen kısmı                                     |
| `prevTail`                     | önceki tail aralığının bugünkü hâli                       |

1. **Tetikleyici varlığı ve gövdesi:** `information_schema.TRIGGERS`'tan (ad, tablo, zaman, olay, sıra, `ACTION_STATEMENT`, DEFINER) değerleri JSON_ARRAY ile alınır, ada göre sıralanır ve SHA-256'sı hesaplanır. Sonuç dosyadaki **beklenen sabitle** (`c1ce0877…50eb`, P13a sonrası) karşılaştırılır.
   - `ok=false` → `FAILED adım=tetikleyici`. Bu mutlak bir kontroldür; taban çizgisinden etkilenmez.
   - SQL_MODE ve karakter seti alanları dışarıda bırakıldı, çünkü bağlantıya bağlıdırlar ve ortama göre değişebilirler.
   - Özet, döküm → migrator yükleme sonrasında aynı kaldı.
   - **Kural:** tetikleyici değiştiren her migration bu sabiti günceller. `check-app-grants` bunu zorlar.
   - Test: DROP → `ok=false`, count 2. Gövdesi değiştirilerek yeniden kurulan tetikleyicide count 3 ama `ok=false`. Özgün gövde geri kurulunca `ok=true`.
2. **İçerik özeti:** `h` = SHA-256( id sırasıyla, her satırın `SHA2(JSON_ARRAY(bütün 14 sütun))` hex değerlerinin birleşimi ).
   - **Sıralı ve kriptografik.** Raporun önerdiği `BIT_XOR(CRC32)` reddedildi: XOR tabanlı çoklu küme özeti doğrusaldır. Wagner'in genelleştirilmiş doğum günü yöntemiyle "sil + aynı sayıda uydurma satır ekle" düşük maliyetle eşlenebilir; CRC32 ise zaten kriptografik değildir.
   - Kesilme koruması: `n*64 ≠ LENGTH` ise `h=null` → FAILED. Sınır, gün başına ~1 M satırdır (`max_allowed_packet` 64 MB). Bugünkü hacmin çok üstündedir.
   - Test: migrator ile `DROP TRIGGER no_update` → geçmiş günde UPDATE → tetikleyiciyi aynen geri kurma. Tetikleyici `ok`, `n` ve `maxId` aynı kaldı; **yalnız o günün `h`'si** farklı çıktı.
3. **Son ~48 saat:** `tail` = bugünün `[00:00, ölçüm − 5 dk)` satırları. Ertesi çalıştırma aynı aralığı `prevTail` ile yeniden ölçer; değer önceki `tail` ile eşit olmalıdır. Böylece bir satır, onu ilk ölçen çalıştırmadan itibaren korunur (eski kural: ilk ölçümden ~48 saat sonra).
   - 5 dk pay: `created_at` INSERT anındaki SYSDATE'tir; o anda açık kalan kısa bir transaction'ın satırı daha sonra görünebilir.
   - `created_at`'i geçmişe yazmak yalnız migrator ve root ile mümkündür.
   - Test: tail'den 1 satır sil + 1 ekle → `n` aynı, `h` farklı. Ölçümden sonra app'in eklediği satır geçmiş özetleri bozmuyor.
   - **Kalan kör aralık (belgelenmiş sınır):** son ölçümden (ve son 5 dk'dan) sonra yazılan satır, sonraki çalıştırmaya kadar (≤ 24 sa + 5 dk) hiçbir manifestte yoktur. Bu sürede silinir ya da değiştirilirse görünmez. Silme sondaysa `maxId` de yakalamayabilir.
   - Daraltma yolları: daha sık timer (ör. 6 saatte bir) ya da site dışı yalnız-yazılır kopya (ADR-0020 m.5, Sonra).
4. **Taban çizgisi:**
   - `instanceId` (yeni datadir ya da volume = yeni kurulum), `env`, `host` ya da `database` farklıysa → `audit-sureklilik: ilk`. Terfi sonrası ilk prod yedeği temiz kurulumdur (yeni volume), bu yüzden kendiliğinden "ilk" sayılır.
   - Geri yükleme datadir'i değiştirmez (`server_uuid` aynı kalır). Bu yüzden **açık sıfırlama** gerekir: `audit-baseline-reset.sql` migrator ile çalışır, gerekçe (10–200 karakter, kontrol karakteri yok) ve operatör (`kullanıcı@host`) zorunludur.
   - Sıfırlama audit'e `backup.audit_baseline_reset` satırı yazar (`username=cli`, `new_value {reason, operator, maxIdBefore}`, `created_at` UTC). Sonraki yedek `baseline.id` farkını görür; **yalnız host işareti aynı id'yi taşıyorsa** (S-P13b-1) karşılaştırmayı atlar → journal'a `taban-cizgisi-sifirlandi` yazar ve alarm (uyarı) çalışır. İşaret yoksa ya da id farklıysa `FAILED taban-cizgisi-isaretsiz` (audit_logs'a INSERT yapabilen app/migrator sahte sıfırlama satırıyla karşılaştırmayı atlatamaz).
   - Sıfırlamanın kaydı DB'de, audit'te ve dökümde kalır. Gizli bir sıfırlama yoktur.
   - app ile çalıştırma 1044 verir (geçici tablo yetkisi yok) ve satır yazılmaz. app doğrudan aynı action'ı INSERT edebilir, ama bu da alarm üretir ve Audit ekranında görünür. Tetikleyici özeti sıfırlamadan etkilenmez.
   - Test: guard (kısa gerekçe, parametresiz, app) ve `baseline.id` değişimi.
   - **backend-dev'e:** `contracts` audit etiketi `backup.audit_baseline_reset` = "Yedek audit taban çizgisi sıfırlandı" eklenmeli.
5. **Süre** (2 M satır, 730 gün, ~2.700 satır/gün; Docker Desktop):
   - Gün histogramı tek başına **0,44 sn** (`audit_logs_created_at_idx` kaplayan aralık taraması; EXPLAIN ANALYZE). AC'nin < 2 sn ölçütü histogram için sağlanıyor.
   - İçerik özetiyle birlikte tam sorgu **4,6 sn**. Satır okuma ve 2 M SHA-256 gerektirdiği için ek süre G-P13b-5'in bilinçli bedelidir; doğrusal büyür.
   - Gün başına `GROUP_CONCAT` bir kez hesaplanır (ilk sürüm 7,8 sn idi).
   - Yedek döküm süresinin yanında küçüktür. **Sapma:** mimari-p13 §7.6/1'deki `days: {gün: n}` biçimi `{gün: {n, h}}` oldu (`format: 2`).

**Karşılaştırma kuralı (backup.sh, devops T1)** dosya başlığında birebir yazılıdır:

- 0. `triggers.ok`.
- 1. "ilk" koşulları.
- 2. `baseline.id` farkı: `baseline.at` önceki manifestin `measuredAtUtc`'sinden yeni **ve** `$BACKUP_DIR/audit-baseline-reset.json` host işareti (root 600, `backup.sh --reset-audit-baseline` yazar) aynı id'yi taşıyorsa uyarı + alarm, karşılaştırma yok; işaret imzalı manifeste (`auditContinuity.baselineMarker`) girer ve silinir. Yeni ama işaretsiz/id farklı → `FAILED taban-cizgisi-isaretsiz` (S-P13b-1, devops düzeltme turu 1). Yeni değilse (kayıt yok/null ya da eski; ör. TRUNCATE sıfırlama kaydını da sildi) `FAILED taban-cizgisi-kaydi-kayboldu` (devops T1 bulgusu, 2026-11-15). Sahte bir taban kaydının eski tarihle eklenmesi de (yalnız migrator/root `created_at` yazabilir) bu kurala takılır.
- 3. FAILED: `maxId` azaldı, `T−728 ≤ gün < P.asOfUtcDate` aralığında `{n, h}` farkı var, ya da `prevTail ≠ P.tail`.
- **Terfi notu (G-P13b-5/3, devops):** staging çalıştırmaları `BACKUP_DIR` dışına taşınmasa bile `instanceId` farkı karşılaştırmayı engeller. Raporun önerdiği taşıma yine de yapılmalıdır, çünkü rotasyon ve "son başarılı manifest" seçimi açısından temizdir.

### Test (2026-11-14, geçici `mysql:8.4.13` binlog açık + bayrak; `rs-p13b-dba-21c21a` (2 M sahte audit), `-src` (seed'li kaynak), `-scr` (ağsız scratch, 01-users.sh); üçü de silindi)

- **D1/D2 betiği 62/62 PASS:**
  - Döküm: istemci komutu 0, DEFINER yalnız migrator.
  - Scratch: `anon=0`, `migratorExtra=0`, hesaplar `app,migrator`.
  - Migrator ile meşru yükleme rc 0, snapshot aynı, tetikleyici 3, audit `created_at` ve UTF-8 korunur.
  - CHECKSUM kaynak = scratch (19 tablo).
  - Canlı benzetimi: fazla tablo ve view varken reset → boş DB, `tables_priv` aynı → yükleme → snapshot önce = sonra, CHECKSUM eşit. Reset guard: root, onaysız ve harf farklı onayda tablolar yerinde kaldı.
  - Kurcalama, ret + iz yok (15 vaka): CREATE USER 1227, `GRANT *.*` 1045, `GRANT mysql.*` 1044, SET PERSIST 1227, SET GLOBAL 1227, INSTALL COMPONENT 1142, INSTALL PLUGIN 1142, `USE mysql` + INSERT 1044, `INSERT mysql.user` 1142, CREATE DATABASE 1044, `DEFINER=root` 1227, `sql_log_bin` 1227, `INTO OUTFILE` 1227, `LOAD DATA LOCAL` 3948, ALTER USER app 1227.
  - Kurcalama, yakalanan (5 vaka): `GRANT <db>.* app`, CREATE VIEW, EVENT, PROCEDURE, `SET PASSWORD`.
- **G-P13b-5 betiği 21/21 PASS** (yukarıda).
- **`check-app-grants.sh` 384/384:** 2 M satırlı DB'de ve migrator ile geri yüklenmiş DB'de (`grants.sql` yeniden çalıştırılmadan). Geri yüklenmiş DB'de migrate "No pending", drift 0.
- Şema değişmediği için `test:int` koşulmadı (backend kaydı: temiz DB 538/538).

## `20261115090000_whatsapp_api_key` — dba incelemesi (2026-11-15; yazan backend-dev, S-P13b-3)

- **Değişiklik:** `system_settings_whatsapp_chk` içindeki koşulsuz `secret_enc IS NULL` maddesi gevşetildi. Yeni kural: adres JSON `null` ise `secret_enc` NULL olmak zorunda; adres doluyken NULL da olabilir, şifreli API anahtarı da.
- **Korunan güvenceler:** anahtar ikili karşılaştırılıyor; JSON şeması (`additionalProperties:false`, url ≤ 200); adres deseni P13a ile birebir aynı (`^https?://[^@?#\s\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+\z`, `'c'`; `\z` var). Blob uzunluğu genel `system_settings_secret_enc_chk` (≥ 30) ile sınırlı. Değişiklik tek bir ALTER'da (DROP + ADD) yapılıyor, arada kısıtsız an yok. Yetki, tetikleyici ve Prisma şeması değişmedi; `audit-continuity.sql` tetikleyici özeti etkilenmez.
- **down.sql:** önce kayıtlı anahtarı siliyor (`secret_enc = NULL`), sonra P13a CHECK'ini geri kuruyor ve migration kaydını siliyor. Doğru; önce sunucu kodu geri alınmalı.
- **`check-app-grants.sh` (+3 → 387):** adres + anahtar OK; kısa blob → `secret_enc_chk`; kullanıcı bilgisi içeren adres + anahtar → `whatsapp_chk`. Var olan "adres null + anahtar" DENIED denemesi geçerli kalıyor.
- **Test** (`rs-p13b-dba-wa-cbc48d`, silindi): up → anahtarlı INSERT OK; anahtar varken url null yapılınca 3819. down → anahtar NULL; anahtarlı INSERT 3819 (P13a kuralı geri geldi). Yeniden up → OK, drift 0, tetikleyici 3. `check-app-grants` 387/387.

## P14a — 6 biçim CHECK'i `\z`, `users.version`, `auth_sessions.step_up_at` (A1, 2026-11-15)

Migration `apps/server/prisma/migrations/20261116000000_p14a_security/{migration.sql,down.sql}`. Mimari-e11 §4.1; ADR-0014, ADR-0022, ADR-0023; AC-201, 206, 215. Veri taşıma yok. Yeni tablo yok. **`grants.sql` değişmedi:** `users` ve `auth_sessions`'ta app'in tablo düzeyi UPDATE yetkisi yeni sütunları kapsıyor. `check-app-grants.sh` app yetki kümesi aynı kaldı. Seed değişmedi: `version` 0, `step_up_at` NULL varsayılanla geliyor, geliştirme ortamı boş kalmıyor.

### Şema

| Değişiklik                                                                                                                                                                                                             | Ayrıntı                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `customers_file_label_chk`, `customers_phone_fmt_chk`, `support_requests_phone_fmt_chk`, `support_requests_client_version_fmt_chk`, `device_bindings_client_version_fmt_chk`, `tenant_request_settings_file_label_chk` | Desenler aynı, yalnız son çapa `$` yerine `\z`, `'c'` korunuyor. Tablo başına tek ALTER (DROP + ADD), COPY |
| `users.version INT UNSIGNED NOT NULL DEFAULT 0`                                                                                                                                                                        | Prisma `version Int @db.UnsignedInt`. INSTANT. İndeks yok: koşullu UPDATE PK ile tek satırı buluyor        |
| `auth_sessions.step_up_at DATETIME(3) NULL`                                                                                                                                                                            | Prisma `stepUpAt`. INSTANT. İndeks yok: guard zaten okunan oturum satırına bakıyor                         |

**ICU `$` bulgusunun kapsamı (8.4.13'te denendi):** `$` yalnız `\n`'den değil, girdinin sonundaki herhangi bir **tek** satır sonlandırıcıdan önce de eşleşiyor: LF, CR, CRLF, VT, FF, NEL (U+0085), LS (U+2028), PS (U+2029). İki sonlandırıcı (`\n\n`) eşleşmiyor. `\z` hepsini reddediyor.

**Kapsam dışı açık (mimar kararı gerekiyor; AC-201 yalnız 6 CHECK'i sayıyor):** e-posta iskeleti `^[^@\s\p{Cc}\p{Cf}]+@[^@\s\p{Cc}\p{Cf}]+$` da sondaki tek bir sonlandırıcıyı kabul ediyor (`'a@b.test\n'` ve `'a@b.test\r\n'` → 1). Etkilenen CHECK'ler: `customers_email_fmt_chk`, `support_requests_email_fmt_chk`, `support_sessions_customer_email_chk`, `tenant_settings_smtp_from_email_chk`. Sonuncusu SMTP başlığına gidiyor, CRLF başlık enjeksiyonunda tek savunma zod kalıyor. Öneri: P15 dba paketinde aynı kalıpla (ön kontrol + `\z`) düzeltilsin. Sabit uzunluklu `CHAR(n)` + `{n}` desenleri etkilenmiyor (sonlandırıcı sütuna sığmıyor). `session_files_file_name_chk` içindeki `[. ]$` bir `NOT` deseni, yalnız daha fazla değeri reddediyor.

### Ön kontrol (AC-201)

- Migration, ALTER'lardan önce geçici bir saklı yordam (`p14a_precheck`) oluşturup çağırıyor. Yordam yeni desenleri ihlal eden satırları tablo bazında sayıyor; ihlal varsa `SIGNAL SQLSTATE '45000'` ile **hiçbir şey değişmeden** durduruyor. Mesaj örneği: `P14A_PRECHECK customers=2 support_requests=1`. Mesaj yalnız ihlali olan tabloları ve satır sayısını içeriyor (`customers` iki CHECK için tek sayı, yani ihlalli satır sayısı). Prisma bunu `P3018` çıktısında gösteriyor, migrate logunda da görünüyor.
- SIGNAL yalnız saklı program içinde geçerli, bu yüzden yordam kullanıldı. DEFINER migrator. CREATE ROUTINE yetkisi `<db>`.* ALL kapsamında. Binlog bayrağı (1419) yalnız fonksiyon ve tetikleyici için gerekli, yordam için değil.
- **Kalıntı:** ön kontrol düşerse yordam DB'de kalıyor. Zararsız (yalnız okuyor). Bir sonraki deneme önce `DROP PROCEDURE IF EXISTS` yapıyor, `down.sql` de siliyor. Arada alınan bir `restore-sec-snapshot` `routines=` farkı verirse: `DROP PROCEDURE IF EXISTS p14a_precheck;`.
- **Sütun bazında döküm** (yalnız okuma, migrator; ihlal çıkınca hangi sütun olduğunu görmek için):

```sql
SELECT 'customers.file_label' AS col, COUNT(*) AS n FROM customers WHERE NOT REGEXP_LIKE(file_label, '^[A-Za-z0-9]{1,20}\\z', 'c')
UNION ALL SELECT 'customers.phone', COUNT(*) FROM customers WHERE NOT REGEXP_LIKE(phone, '^[+][1-9][0-9]{7,14}\\z', 'c')
UNION ALL SELECT 'support_requests.customer_phone', COUNT(*) FROM support_requests WHERE NOT REGEXP_LIKE(customer_phone, '^[+][1-9][0-9]{7,14}\\z', 'c')
UNION ALL SELECT 'support_requests.client_version', COUNT(*) FROM support_requests WHERE NOT REGEXP_LIKE(client_version, '^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}\\z', 'c')
UNION ALL SELECT 'device_bindings.client_version', COUNT(*) FROM device_bindings WHERE NOT REGEXP_LIKE(client_version, '^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}\\z', 'c')
UNION ALL SELECT 'tenant_request_settings.file_label', COUNT(*) FROM tenant_request_settings WHERE NOT REGEXP_LIKE(file_label, '^[A-Za-z0-9]{1,20}\\z', 'c');
```

### Düzeltme SQL'i (ön kontrol düşerse; migrator, önce yedek — runbook §18)

Eski CHECK'ten geçmiş bir değerin yeni desenden kalmasının tek nedeni, sondaki tek satır sonlandırıcı. Sonlandırıcı kırpılınca değer eski desenin gövdesine birebir uyuyor. Kişisel veri anlamı değişmiyor, yalnız görünmez karakter siliniyor. İdempotent: ikinci çalıştırma 0 satır günceller.

```sql
-- Sondaki tek satır sonlandırıcı: CRLF | LF | VT | FF | CR | NEL | LS | PS. Desen SATIR İÇİ (P16 düzeltmesi): `SET @t`
-- kullanıcı değişkeni `prisma db execute` bağlantısında utf8mb4_general_ci olur → 1267 (Illegal mix of collations).
-- Sütun tarafında `COLLATE utf8mb4_bin` (EXPLICIT) bağlantı karakter setinden bağımsız kılar (latin1/utf8mb4 denendi).
UPDATE customers SET file_label = REGEXP_REPLACE(file_label COLLATE utf8mb4_bin, '(\\r\\n|[\\n\\x{0B}\\x{0C}\\r\\x{85}\\x{2028}\\x{2029}])\\z', '') WHERE NOT REGEXP_LIKE(file_label, '^[A-Za-z0-9]{1,20}\\z', 'c');
UPDATE customers SET phone = REGEXP_REPLACE(phone COLLATE utf8mb4_bin, '(\\r\\n|[\\n\\x{0B}\\x{0C}\\r\\x{85}\\x{2028}\\x{2029}])\\z', '') WHERE NOT REGEXP_LIKE(phone, '^[+][1-9][0-9]{7,14}\\z', 'c');
UPDATE support_requests SET customer_phone = REGEXP_REPLACE(customer_phone COLLATE utf8mb4_bin, '(\\r\\n|[\\n\\x{0B}\\x{0C}\\r\\x{85}\\x{2028}\\x{2029}])\\z', '') WHERE NOT REGEXP_LIKE(customer_phone, '^[+][1-9][0-9]{7,14}\\z', 'c');
UPDATE support_requests SET client_version = REGEXP_REPLACE(client_version COLLATE utf8mb4_bin, '(\\r\\n|[\\n\\x{0B}\\x{0C}\\r\\x{85}\\x{2028}\\x{2029}])\\z', '') WHERE NOT REGEXP_LIKE(client_version, '^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}\\z', 'c');
UPDATE device_bindings SET client_version = REGEXP_REPLACE(client_version COLLATE utf8mb4_bin, '(\\r\\n|[\\n\\x{0B}\\x{0C}\\r\\x{85}\\x{2028}\\x{2029}])\\z', '') WHERE NOT REGEXP_LIKE(client_version, '^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}\\z', 'c');
UPDATE tenant_request_settings SET file_label = REGEXP_REPLACE(file_label COLLATE utf8mb4_bin, '(\\r\\n|[\\n\\x{0B}\\x{0C}\\r\\x{85}\\x{2028}\\x{2029}])\\z', '') WHERE NOT REGEXP_LIKE(file_label, '^[A-Za-z0-9]{1,20}\\z', 'c');
```

**P16 sınaması (2026-11-15):** eski `SET @t` biçimi `prisma db execute`'ta 1267 verdi; yukarıdaki biçim hatasız çalıştı (0 satır, idempotent). Anlam testi (geçici tablo, migrator, `--default-character-set=latin1` ve `utf8mb4`): `Firma`+CRLF / LF / U+2028 / NEL → `Firma`; `Firma`+LF+LF → `Firma`+LF (tek sonlandırıcı kırpılır; kalan ihlal elle değil mimara). Desene (sabit dizgeye) `COLLATE utf8mb4_bin` eklemek latin1 bağlantıda 1253 verir; yalnız sütun tarafında olmalı.

Ardından: `prisma migrate resolve --rolled-back 20261116000000_p14a_security` → `pnpm db:migrate`. Döküm sorgusu hâlâ 0 olmayan satır gösteriyorsa (sonlandırıcı dışı bir ihlal, eski CHECK'le olanaksız) satırlar elle düzeltilmez, mimara bildirilir. `customers`'ta `phone` değişirse `search_key` aynı kalıyor, çünkü anahtar yalnız rakamlardan üretiliyor.

### Kilit ve geri alma

- **Kilit:** 4 tablo COPY ile yeniden yazılıyor (customers, support_requests, device_bindings, tenant_request_settings). Sütunlar INSTANT. Migrate, compose'da server'dan önce `migrate` servisinde çalışıyor. Ön kontrol ile ALTER arasında yazma olmuyor.
- **`down.sql`:** guard yok. Gerekçe: 6 CHECK eski `$` desenine gevşiyor, mevcut her satır uyuyor. Düşen iki sütun yeniden üretilebilir veri (version sayacı, step-up anı). Kalıntı yordamı da siliyor, ardından sütunları düşürüyor (INSTANT), CHECK'leri `$`'a döndürüyor ve `_prisma_migrations` kaydını siliyor. **Önce P14a sunucu kodu geri alınmalı.**

### B1 — `tenants(name)` indeksi: **gerek yok** (AC-226, mimari-e11 §5.1)

Ölçüm (8.4.13, `tenants` utf8mb4_unicode_ci, 250 firma fixture'ı, %10 pasif, Türkçe adlar). Sorgu biçimi: `WHERE deleted_at IS NULL AND name LIKE ? ORDER BY (name LIKE 'q%') DESC, (status='ACTIVE') DESC, name LIMIT 20`.

| Sorgu                        | İndeks yok (EXPLAIN ANALYZE)       | Geçici IX(name) ile                                     |
| ---------------------------- | ---------------------------------- | ------------------------------------------------------- |
| önek `name LIKE 'nok%'`      | tam tarama 250 satır, **0,11 ms**  | aralık taraması 25 satır, 0,08 ms                       |
| içerir `name LIKE '%biliş%'` | tam tarama 250 satır, **0,08 ms**  | **indeks kullanılmıyor** (baştaki `%`), yine tam tarama |
| boş `q` (ilk 20, aktif önce) | tam tarama + sıralama, **0,12 ms** | —                                                       |
| 10.000 firma, içerir / önek  | 2,6 ms / 1,4 ms                    | —                                                       |

- **Karar:** indeks eklenmedi. AC-226 ölçütü p95 ≤ 500 ms; sorgu 250 firmada bunun ~1/4000'i. İçerir araması B-tree kullanamıyor, önekte de kazanç mikrosaniye düzeyinde. İndeks her firma yazmasına maliyet ekler ve ölçülebilir fayda sağlamaz.
- Harf duyarsızlığı unicode_ci harmanlamasından geliyor: `LIKE '%BİLİŞİM%'` ve `LIKE 'çağ%'` doğru eşleşti. Backend `LOWER()` ya da `COLLATE` eklememeli, eklerse sonuç değişmez ama maliyet artar.
- **Yeniden değerlendirme eşiği:** firma sayısı 50.000'i aşarsa ya da ölçülen p95 50 ms'yi geçerse. O durumda içerir için `FULLTEXT … WITH PARSER ngram`, önek için IX(name).
- **Backend'e (B2):** `LIMIT 20` zorunlu, `q` uzunluğu ≤ 120 (sütun genişliği). `q` içindeki `%` ve `_` LIKE kaçışıyla verilmeli (Prisma `contains` / `startsWith` bunu yapıyor).

### Test (2026-11-15, geçici `mysql:8.4.13` binlog açık + bayrak, `rs-p14a-dba-7f3c1e:33447`, silindi)

- **Temiz up:** HEAD → P14a OK. `migrate diff --exit-code` 0 (drift yok), `migrate status` güncel.
- **Ön kontrol:** down sonrası eski `$` CHECK'iyle `tenant_request_settings`'e `'Firma\n'` ve `'Firma\r\n'` yazıldı. `migrate deploy` → `P3018` + `P14A_PRECHECK tenant_request_settings=2`. 6 CHECK `$`'da kaldı, sütunlar eklenmedi (değişiklik yok), yordam kaldı (beklenen). Düzeltme SQL'i iki satırı `Firma`'ya kırptı → resolve → `pnpm db:migrate` OK, yordam silindi, drift 0.
- **down → up döngüsü:** down sonrası Prisma diff yalnız iki `ADD COLUMN` gösterdi (CHECK'ler Prisma dışında). up sonrası drift 0. 6 CHECK'in `CHECK_CLAUSE`'u ilk up ile birebir aynı.
- `test/integration/security-p14a-db.test.ts` (yeni, 5 test): 6 CHECK'te `\n` sonlu UPDATE → 3819 + kısıt adı, geçerli değer kabul; 8 sonlandırıcının hepsi ret; information_schema'da `\z` var, `$` yok; `version` 0, koşullu `UPDATE … AND version=?` 1/0, negatif 1264; `step_up_at` `datetime(3)` NULL. **Ayırt edicilik:** down sonrası (`$` desenleri) AC-201 testlerinin 3'ü de düştü, up sonrası geçti.
- `check-app-grants.sh` += 6 `CHAR(10)` negatifi (her CHECK için, kısıt adıyla) → **393/393 PASS**.
- Server: typecheck temiz, `test` 368/368, `test:int` **559/559** (56 dosya, temiz DB + P14a).

### İkinci migration: `20261116010000_p14a_mysql_tls` (A3, AC-211; yazan backend-dev)

- **Ne yapıyor:** `system_settings_mysql_chk` CHECK'indeki JSON şemasına isteğe bağlı `requireTls: boolean` alanı ekleniyor. Şemanın geri kalanı P11 ile birebir aynı (`host`/`port`/`database`/`user` zorunlu, `additionalProperties:false`, `user`'da Cc/Cf/Zl/Zp yok). `DROP CHECK` + `ADD CONSTRAINT` tek `ALTER` içinde, bu yüzden kısıtsız bir ara an yok. `system_settings` en çok 3 satır, kilit önemsiz. Yeni tablo ya da yetki yok, `grants.sql` değişmedi.
- **Gerekçe:** A1 migration'ı (§4.1) bu alanı kapsamıyordu. P11 şeması `additionalProperties:false` olduğu için A3'ün yazdığı `requireTls` anahtarı 3819 ile reddediliyordu. Alan zorunlu değil, eski satırlar geçerli kalıyor; okuyucu alan yoksa `false` sayıyor. QA Tur 1 bu ek migration'ı gerekçeli kabul etti.
- **`down.sql` (elle; Prisma çalıştırmaz):** önce `mysql` satırındaki `requireTls` anahtarı `JSON_REMOVE` ile siliniyor (P11 şeması bilinmeyen anahtarı reddettiği için bu sıra şart). Ardından CHECK P11 şemasına döndürülüyor ve `_prisma_migrations` kaydı siliniyor. **Önce P14a A3 sunucu kodu geri alınmalı.** Silinen veri yalnız TLS zorunluluğu tercihi; geri alındığında varsayılan `false` olur ve yönetici paneli yeniden işaretleyebilir.
- Komut: `pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261116010000_p14a_mysql_tls/down.sql` (migrator).

## P15 — request_blocks, session_files raporlayan, kabul kodu, logo kaldırma, e-posta `\z` (2026-11-15)

Migration `apps/server/prisma/migrations/20261117000000_p15_g3/{migration.sql,down.sql}`. Mimari-e11 §6; AC-233, 235, 237, 238, 239 + P14a'dan devreden e-posta CHECK'leri. Veri taşıma: yalnız S15-2 (aşağıda, `session_files` eski TO_CUSTOMER satırları → CUSTOMER). `grants.sql` += `request_blocks` (SELECT/INSERT/DELETE).

### Şema

| Değişiklik                                    | Ayrıntı                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `request_blocks` (yeni)                       | `id, tenant_id, kind, ip_from VARBINARY(16), ip_to VARBINARY(16), device_key_hash CHAR(64), expires_at, note VARCHAR(200), created_by, created_at`. FK tenant/created_by RESTRICT. IX(tenant_id, kind, expires_at), IX(created_by), **UQ(tenant_id, ip_from, ip_to)**, **UQ(tenant_id, device_key_hash)**. UPDATE yetkisi yok, o yüzden updated_at da yok                     |
| CHECK'ler                                     | `kind_chk` (ikili IP/DEVICE), `target_chk` (IP ⇒ ip_from/ip_to dolu + hash NULL; DEVICE tersi), `ip_range_chk` (4/16 bayt, aynı uzunluk, gerçek CIDR: ip_from ağ, ip_to yayın adresi; IPv4 ≤ /24, IPv6 ≤ /48), `device_key_hash_fmt_chk` (`^[a-f0-9]{64}\z`, 'c'), `expires_chk` (expires_at > created_at), `note_chk` (1..200, kırpılmış, Cc/Cf/Zl/Zp yok)                   |
| `session_files.reported_by`                   | `VARCHAR(20) NOT NULL DEFAULT 'TECH'` + ikili `session_files_reported_by_chk`. **Sapma:** mimaride ENUM; proje kuralı VARCHAR + ikili CHECK (ADR-0014). INSTANT                                                                                                                                                                                                               |
| `session_files.match_key`                     | `CHAR(64) NULL`, `^[a-f0-9]{64}\z`. **UQ(session_id, match_key, reported_by)**. Eski satırlar NULL                                                                                                                                                                                                                                                                            |
| `session_files` veri (S15-2, düzeltme 1)      | `UPDATE … SET reported_by='CUSTOMER' WHERE match_key IS NULL AND direction='TO_CUSTOMER'`. P5'te tek satır alıcının raporuydu (koddan doğrulandı: `collab.ts` 0dd1d99, gönderen raporu yalnız audit); TO_CUSTOMER alıcısı müşteri. TO_TECH eski satırları TECH kalır. Migration henüz hiçbir ortama uygulanmadığı için aynı dosyaya eklendi. down.sql: sütunla birlikte düşer |
| `tenant_request_settings.require_accept_code` | `BOOLEAN NOT NULL DEFAULT false`, INSTANT                                                                                                                                                                                                                                                                                                                                     |
| `system_settings_system_logo_chk`             | `path` artık `string \| null` (AC-233; V31, WhatsApp kalıbı). app'e DELETE verilmedi                                                                                                                                                                                                                                                                                          |
| 4 e-posta CHECK'i                             | customers, support_requests, support_sessions (`customer_name IS NOT NULL` korunuyor), tenant_settings smtp_from: `$` → `\z`. Ön kontrol `p15_precheck` + SIGNAL (P14a kalıbı)                                                                                                                                                                                                |

**`system_settings_mysql_chk` değişmedi.** JSON_SCHEMA_VALID `pattern`'i ICU değil, ECMAScript motoru kullanıyor. Orada `$` gerçek son anlamına geliyor: host/database sonuna eklenen 8 sonlandırıcının hepsi 3819 ile reddedildi. `\z` bu motorda desteklenmiyor; `"abc"` bile `^[a-z]+\z`'den kalıyor. `\z`'ye çevirmek her geçerli değeri reddederdi. `system_logo` ve `turn` şemaları için de aynı durum geçerli (8.4.13'te denendi). `$` ile biten REGEXP_LIKE yalnız sabit uzunluklu `CHAR(n)` + `{n}` desenlerinde kaldı (P14a: etkilenmiyor).

**AC-237:** DB değişikliği gerekmedi. `perm_key` serbest VARCHAR(60), seed yetki satırı yazmıyor. `support_requests.block` anahtarını `packages/contracts/src/permissions.ts`'e backend ekleyecek. **Risk (karar gerekli):** `users.delete` şimdiye dek hiçbir ucu korumuyordu ama toggle'ı vardı. USER'a daha önce açılmış bir satır, P16'da kalıcı silme yetkisi verir. Kontrol: `SELECT user_id FROM user_permissions WHERE perm_key='users.delete' AND granted=1;`. Sıfırlama gerekirse: `DELETE FROM user_permissions WHERE perm_key='users.delete';` (rol varsayılanına döner).

### Ön kontrol düşerse: düzeltme SQL'i (migrator, önce yedek)

Desenler satır içinde verilmeli, `@değişken` kullanılmamalı. `prisma db execute` bağlantısında kullanıcı değişkeni utf8mb4_general_ci oluyor ve 1267 veriyor (denendi). P14a'daki `SET @t` kalıbı da mysql CLI dışında aynı hatayı verir. Aşağıdaki SQL idempotent:

```sql
UPDATE customers SET email = REGEXP_REPLACE(email, '(\\r\\n|[\\n\\x{0B}\\x{0C}\\r\\x{85}\\x{2028}\\x{2029}])\\z', '') WHERE NOT REGEXP_LIKE(email, '^[^@\\s\\p{Cc}\\p{Cf}]+@[^@\\s\\p{Cc}\\p{Cf}]+\\z', 'c');
UPDATE support_requests SET customer_email = REGEXP_REPLACE(customer_email, '(\\r\\n|[\\n\\x{0B}\\x{0C}\\r\\x{85}\\x{2028}\\x{2029}])\\z', '') WHERE NOT REGEXP_LIKE(customer_email, '^[^@\\s\\p{Cc}\\p{Cf}]+@[^@\\s\\p{Cc}\\p{Cf}]+\\z', 'c');
UPDATE support_sessions SET customer_email = REGEXP_REPLACE(customer_email, '(\\r\\n|[\\n\\x{0B}\\x{0C}\\r\\x{85}\\x{2028}\\x{2029}])\\z', '') WHERE NOT REGEXP_LIKE(customer_email, '^[^@\\s\\p{Cc}\\p{Cf}]+@[^@\\s\\p{Cc}\\p{Cf}]+\\z', 'c');
UPDATE tenant_settings SET smtp_from_email = REGEXP_REPLACE(smtp_from_email, '(\\r\\n|[\\n\\x{0B}\\x{0C}\\r\\x{85}\\x{2028}\\x{2029}])\\z', '') WHERE NOT REGEXP_LIKE(smtp_from_email, '^[^@\\s\\p{Cc}\\p{Cf}]+@[^@\\s\\p{Cc}\\p{Cf}]+\\z', 'c');
```

Ardından: `prisma migrate resolve --rolled-back 20261117000000_p15_g3` → `pnpm db:migrate`.

### Kilit ve geri alma

- COPY: e-posta CHECK'leri olan 4 tablo ve session_files. UQ INPLACE, sütunlar INSTANT.
- `down.sql` sırasıyla şunları yapar: yordamı siler; `request_blocks`'u düşürür; `match_key` dolu gönderen tarafı satırlarını siler (eski "tek satır = alıcı raporu" modeli); sütunları düşürür; `path:null` logo satırını siler; CHECK'leri eski hâline getirir; migration kaydını siler. **Önce P15 sunucu kodu geri alınmalı, grants.sql'den request_blocks satırları çıkarılmalı.**

### Backend notları

- **Kapı önbelleği:** `findMany({ where: { tenantId, OR: [{expiresAt: null}, {expiresAt: {gt: now}}] } })` (IX). IP bellekte karşılaştırılır. İstemci IP'si 4 ya da 16 bayta çevrilir; **IPv4-eşlemeli IPv6 4 bayta indirgenir**. Eşleşme koşulu: `ipFrom.length === ip.length && Buffer.compare(ipFrom, ip) <= 0 && Buffer.compare(ip, ipTo) <= 0`. SQL'de karşılaştırma `LENGTH(ip_from)=LENGTH(?) AND ip_from <= ? AND ip_to >= ?` (baytsal, VARBINARY).
- **Yazma:** CIDR → ip_from ağ, ip_to yayın adresi (/32 ve /128'de ikisi aynı). Hizasız önek 3819 verir, zod önce normalize etmeli. `device_key_hash` küçük harf hex olmalı.
- **Ekleme TX'i:** tenant satırı `FOR UPDATE` → `COUNT(*)` < 1.000 → aynı hedefin süresi dolmuş satırını DELETE → INSERT. P2002 → 409. Süre değişikliği DELETE + INSERT ile yapılır. Kaldırma `deleteMany({ where: { id, tenantId } })`, 0 satır → 404.
- **Saklama önerisi:** IP kişisel veri. P13a işine `DELETE … WHERE expires_at < now - 30 gün` eklenmeli (karar mimar/backend).
- **session_files (AC-238):** iki tarafın raporu ayrı satır. `reported_by` raporlayan bağlantının rolüdür. `match_key = sha256Hex(sessionId\ndirection\nfid\nsha256\nsizeBytes)`; yeni satırlarda **her zaman dolu** olmalı (down.sql buna dayanıyor). Aynı taraf tekrar raporlarsa P2002 gelir, yok sayılır. "Doğrulanmış": TECH satırı ya da aynı match_key'i taşıyan iki taraf. Yalnız CUSTOMER satırı varsa "Müşteri bildirimi". Liste/CSV match_key'e göre tekilleştirilir; NULL olan eski satırlar `reported_by`'a göre sayılır (S15-2 sonrası eski TO_CUSTOMER = CUSTOMER). Düzeltme 1: fid'siz müşteri raporu, aynı yön + SHA-256 + boyuttaki eşsiz TECH grubuyla okumada eşlenir (`groupFileReports`). `file.meta`'ya `fid` eklenmesi protokol işi.
- **Logo:** kaldırma = `upsert system_logo {path:null}`. Okuyucu `null`'ı "satır yok" gibi ele alır.

### Test (2026-11-15, geçici `rs-p15-dba-a71c3e:33461`, mysql 8.4.13, silindi)

- Temiz up, drift 0. İlk denemede `HEX()` 1267 harmanlama hatası verdi; `COLLATE utf8mb4_bin` ile düzeldi. Kısmi durum down.sql ile temizlendi, down da bu sırada sınanmış oldu.
- down sonrası eski `$` ile `a@b.test\r\n` ve `x@y.test`+U+2028 yazıldı. deploy → `P3018` + `P15_PRECHECK customers=1 tenant_settings=1`, hiçbir şey değişmedi. Düzeltme SQL'i iki kez çalıştı (idempotent) → resolve → up OK, drift 0, yordam silindi, tetikleyici 3.
- `security-p15-db.test.ts` (9 test) eklendi. `session-files-p5` sütun listesi ve `session-history-p8` ikili CHECK sayısı (26 → 29) güncellendi. `check-app-grants.sh` **425/425**. typecheck temiz, `test` yeşil, `test:int` **614/614**.

## P16 — kalıcı silme: tetikleyiciler, tenant_purge_jobs, mezar taşı, passive_at (G1, 2026-11-15)

Migration `apps/server/prisma/migrations/20261118000000_p16_hard_delete/{migration.sql,down.sql}`. Mimari-e11 §7.1; ADR-0030 r2 m.1, m.3–m.5; güvenlik P16 turları S16-2, 3, 4, 6, 10, 11, 13 (yalnız DB payı), 14, 15; AC-240..242. Veri taşıma: `tenants.passive_at` geri doldurma (PASSIVE → `updated_at`) ve `users.delete` sıfırlama. Seed değişmedi (yeni sütun/tablo boş başlar; seed kullanıcısı silmez).

### Şema

| Değişiklik                                           | Ayrıntı                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `audit_logs_tenant_id_fkey` düşürüldü                | İndeksler kalır. Prisma `AuditLog.tenant` / `Tenant.auditLogs` çıktı. Firma adı artık ayrı `IN` sorgusu (`audit/repo.ts listAudit`, G1 tip düzeltmesi)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `tenants.passive_at DATETIME(3) NULL`                | INSTANT + geri doldurma + `tenants_passive_chk` (`PASSIVE ⇔ passive_at`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `users_status_chk` += `DELETED`; `users_deleted_chk` | `DELETED ⇔ deleted_at`; DELETED ⇒ `username`, `avatar_path`, `totp_secret_enc` NULL, `password_hash = '!deleted'`, `email` = `'deleted+' + id + '@invalid'` (ikili, id saklandığı gibi büyük harf)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `tenant_purge_jobs` (yeni)                           | §7.1 sütunları. `counts` JSON **NOT NULL** (açılışta `{}`), `step` varsayılan `FENCE`, `state` varsayılan `SCHEDULED`. CHECK: `tenant_id_fmt` (Crockford ULID, S16-2), `state`, `step` (17 adım, ikili), `done` (DONE ⇔ finished_at ⇔ step DONE), `cancelled` (CANCELLED ⇔ cancelled_at; cancelled_at ⇔ cancelled_by), `tenant_row` (tenant_row_deleted_at yalnız TENANT_ROW/FILES/DONE; FILES/DONE'da zorunlu), `counts` (nesne, ≤ 4 KB), `last_error` (`^[a-z_]{1,60}\z`), `preview_hash_fmt` (hex). UQ `preview_hash`; fonksiyonel UQ `tenant_purge_jobs_one_open_uq`; IX(state, scheduled_for), IX(tenant_id), IX(started_by), IX(cancelled_by). FK started_by/cancelled_by → users RESTRICT; tenant_id FK **değil** |

**Ön kontrol** `p16_precheck` (P14a kalıbı, hiçbir şey değişmeden SIGNAL): `P16_PRECHECK users=<n>` (deleted_at dolu kullanıcı; P16 öncesi hepsi DELETED-olmayan) ve `binlog_flag` (binlog açık + `log_bin_trust_function_creators=0` → tetikleyici 1419 ile yarıda kalırdı). Düzeltme: kullanıcı satırı incelenir (bugün kod `users.deleted_at` yazmıyor; değer elle girilmiş olmalı), `UPDATE users SET deleted_at = NULL WHERE …` ya da bayrak açılır → `prisma migrate resolve --rolled-back 20261118000000_p16_hard_delete` → `pnpm db:migrate`.

**`users.delete` sıfırlama:** migration sonunda `DELETE FROM user_permissions WHERE perm_key = 'users.delete'`. Öncesi/sonrası sayım Prisma çıktısında görünmediği için **audit satırına** yazılır: `action = 'migration.p16_users_delete_reset'`, `username = 'migrator'`, `new_value = {grantedBefore, rowsDeleted, grantedAfter}`. Elle kontrol: `SELECT new_value FROM audit_logs WHERE action = 'migration.p16_users_delete_reset' ORDER BY id DESC LIMIT 1;`. Deploy öncesi elle ölçüm: `SELECT COUNT(*) FROM user_permissions WHERE perm_key = 'users.delete' AND granted = 1;`. **backend-dev'e:** `contracts` audit etiketi "Migration: kullanıcı silme yetkileri sıfırlandı".

### Tetikleyiciler (19 yeni, toplam 22)

Ad kalıbı `<tablo>_{delete,update,insert}_guard`. Bütün gövdeler BEGIN…END; `migrator`/`root` muaf (USER()); saat `CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00')`; NULL → red (`COALESCE(…, FALSE)`); SIGNAL metni `p16:` önekli (backend `db_signal` sınıfı bu öneki ve 1644'ü kullanabilir).

| Tetikleyici                                                                                              | Kural                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `support_sessions`, `support_requests` delete                                                            | `anonymized_at ≤ UTC − 30 g` veya PURGING                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `session_consents` delete                                                                                | üst oturum `anonymized_at ≤ UTC − 30 g` veya PURGING (gece işi onayları oturumdan ÖNCE silmeli)                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `device_bindings` delete                                                                                 | `revoked_at ≤ UTC − 30 g` veya PURGING                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `customers`, `request_refs`, `consent_texts`, `tenant_request_settings` delete                           | yalnız PURGING                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `users` delete                                                                                           | `tenant_id` dolu ve PURGING (Super Admin asla)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `tenants` delete                                                                                         | PASSIVE + `passive_at ≤ UTC − 30 g` + RUNNING iş `step = TENANT_ROW`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `tenant_purge_jobs` delete                                                                               | DONE/CANCELLED ve `COALESCE(finished_at, cancelled_at) ≤ UTC − 730 g`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `support_sessions`, `support_requests` update (`anonymized_at`), `device_bindings` update (`revoked_at`) | NULL → değer bir kez, `[UTC − 1 g, UTC + 1 dk]`; dolu değer değişmez/NULL'lanmaz (S16-3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `users` update                                                                                           | `OLD.status = 'DELETED'` → SIGNAL                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `tenants` insert/update                                                                                  | `passive_at` zorlanır (PASSIVE'e geçişte UTC, ACTIVE'de NULL, diğerlerinde eski); açık (SCHEDULED/RUNNING/FAILED) işte status değişimi SIGNAL (S16-10)                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `tenant_purge_jobs` insert                                                                               | yalnız `state = SCHEDULED`, `step = FENCE`, `attempts = 0`, yaşam döngüsü sütunları NULL; `scheduled_for` = UTC + 24 sa **zorlanır** (uygulamanın değeri yok sayılır)                                                                                                                                                                                                                                                                                                                                                                                                        |
| `tenant_purge_jobs` update                                                                               | id/tenant_id/scheduled_for/started_by/created_at sabit; DONE/CANCELLED satır değişmez; geçişler SCHEDULED→RUNNING (yalnız `UTC ≥ scheduled_for`), SCHEDULED→CANCELLED, RUNNING→DONE\|FAILED, FAILED→RUNNING (**yeni** `preview_hash` zorunlu; başka durumda preview_hash değişmez); `step` yalnız RUNNING'de ve **birer** ilerler (S16-15); `tenant_row_deleted_at` yalnız RUNNING + `OLD.step = TENANT_ROW` + firma satırı yokken bir kez; `started_at` (→RUNNING ilk), `finished_at` (→DONE), `cancelled_at` (→CANCELLED), `tenant_row_deleted_at` **DB saatine zorlanır** |

PURGING(t) = `EXISTS (tenant_purge_jobs j JOIN tenants x …  j.state = 'RUNNING' AND x.status = 'PASSIVE' AND x.passive_at ≤ UTC − 30 g)`. SCHEDULED iş kilidi açmaz.

**Backend (G2–G4) için sonuçlar:**

- **S16-14:** `anonymized_at` / `revoked_at` uygulama saatiyle **ileri** yazılamaz. Gece işi ve `bindings/repo.ts expireIdle`/`revokeData(now)` yolları gerçek saatle (tercihen `UTC_TIMESTAMP(3)`) yazmalı; testler sahte ileri saat yerine fikstürü migrator ile geçmişe çekmeli. G1'de `bindings-p8c` AC-185 testi bu kalıba çevrildi. Saatler arası fark > 1 dk ise uygulama saatiyle yazım SIGNAL alır → DB saati önerilir.
- **Sıra:** gece işi `session_files → session_consents → support_sessions`; `support_requests.binding_id = NULL` UPDATE'i yalnız anonim taleplerde (tetikleyici değil, ADR kuralı).
- **İş satırı:** INSERT sonrası `scheduled_for`'u yeniden okuyun (Prisma `create` dönüşü DB'nin zorladığı değeri içermeyebilir → `findUnique`). Adım atlatma yok: her adım ayrı UPDATE (`step` +1). TENANT_ROW TX'i: `DELETE tenants` → `UPDATE … SET tenant_row_deleted_at = <herhangi>, step = 'FILES'` (değer DB saatine zorlanır). DONE: `state = 'DONE', step = 'DONE'` tek UPDATE (`FILES → DONE`).
- **Sürdürme:** FAILED→RUNNING aynı UPDATE'te yeni `preview_hash` ister.
- **Mezar taşı UPDATE:** tek UPDATE'te `status = 'DELETED'`, `deleted_at`, `email = deleted+<id>@invalid`, `username = NULL`, `password_hash = '!deleted'`, `avatar_path = NULL`, `totp_secret_enc = NULL`, `totp_enabled = 0`, `totp_last_step = NULL` (TOTP CHECK'leri). Sonra hiçbir UPDATE (sayaç dahil) → auth sorguları `status <> 'DELETED'` süzmeli (S16-7).
- **`users.deleted_at`** artık yalnız mezar taşında dolu olabilir (`superadmin-reset-p13b` testi buna göre güncellendi). Kodda `deletedAt: null` süzmeleri doğru kalır; DELETED satırlar için ayrıca `status` süzmesi gerekir.

### Yetkiler (`grants.sql`)

DELETE eklendi: `support_sessions`, `support_requests`, `session_consents`, `device_bindings`, `customers`, `request_refs`, `consent_texts`, `tenant_request_settings`. `tenant_purge_jobs`: SELECT/INSERT/UPDATE/DELETE, DDL yok. `check-app-grants.sh` DELETE kümesi tam eşitlikle güncellendi (19 tablo); sütun yetkisi kümesi değişmedi.

### Beklenen sayılar (S16-11)

- `audit-continuity.sql` sabiti `a4a6f552…13be` (22 tetikleyici; P13a sabiti `c1ce0877…50eb`).
- `check-app-grants.sh`: toplam 22; P16 dağılımı 11/6/2; mysqldump 22; continuity `count=22, ok=true`.
- `backup.sh` `BACKUP_EXPECTED_TRIGGERS` varsayılanı 22 + `backup.env.example`; `restore.sh` `RESTORE_EXPECTED_TRIGGERS` varsayılanı 22 (lib-restore.sh bu değeri kullanır).
- **devops'a (G7):** `deploy/backup/test-backup-inner.sh` yalnız 3 audit tetikleyicisini DROP/geri kuruyor; P16 sonrası DB'de 22 olduğundan beklenen sayıları bu betikte de 22'ye uyarlayın. Runbook satırı "BACKUP_EXPECTED_TRIGGERS= (boş = 3)" → 22. Staging/prod `backup.env`'de değer elle 3 yazılıysa migration'dan önce 22 yapılmalı (yoksa ilk gece yedeği FAIL).

### Meta-test girdisi (S16-11; G3 meta-testi)

`check-app-grants.sh` iki kontrol ekledi: bütün FK'lerde `DELETE_RULE = UPDATE_RULE = RESTRICT` (0 istisna) ve `audit_logs`/`tenant_purge_jobs` → `tenants` FK yok.

### Aday sorguları — EXPLAIN ANALYZE (8.4.13; 2 firma, 20.000 oturum, 5.000 kayıt, 10.000 talep; ANALYZE TABLE sonrası)

| Sorgu (kesme `UTC_TIMESTAMP(3) − 30 g − 1 sa`, LIMIT 500)                                                                     | Plan                                                                                                            | Süre     |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------- |
| Oturum S\*: `tenant_id = ? AND anonymized_at < cut AND NOT EXISTS (first/last_session_id)` **`ORDER BY anonymized_at`**       | kaplayan IX `support_sessions_tenant_id_anonymized_at_created_at_idx` + iki antijoin (IX first/last_session_id) | 5,1 ms   |
| Aynı sorgu `ORDER BY anonymized_at, id`                                                                                       | IX(tenant_id, created_at) + 10.000 satır filtre + sıralama                                                      | 29 ms    |
| Talep R\*: `tenant_id = ? AND anonymized_at < cut AND NOT EXISTS (support_sessions.request_id)` `ORDER BY anonymized_at`      | kaplayan IX `support_requests_tenant_id_anonymized_at_created_at_idx` + UQ(request_id, tenant_id)               | 0,6 ms   |
| Aynı sorgu `ORDER BY anonymized_at, id`                                                                                       | IX(tenant_id, status, created_at) + sıralama                                                                    | 11,5 ms  |
| Kayıt B\*: `tenant_id = ? AND revoked_at < cut AND NOT EXISTS (support_requests binding_id = b.id AND anonymized_at IS NULL)` | IX(tenant_id, customer_id, revoked_at) kaplayan + **materyalize** (talep tablosu tam tarama)                    | 6,6 ms   |
| Aynı sorgu `/*+ NO_SEMIJOIN(@sq) */` + `QB_NAME(sq)`                                                                          | bağımlı alt sorgu IX(binding_id, tenant_id, status)                                                             | 2,0 ms   |
| Onay: `session_id IN (aday oturumlar)`                                                                                        | IX(session_id, tenant_id, created_at) + PK                                                                      | < 0,1 ms |
| İş: `state = 'SCHEDULED' AND scheduled_for <= ?`                                                                              | IX(state, scheduled_for)                                                                                        | —        |

**Backend'e (G2):** sıralamada `id` eklemeyin (`ORDER BY anonymized_at` yeterli; idempotent tur için kararlı sıra gerekmez) ya da sırasız `LIMIT 500` kullanın. Kayıt adayında NOT EXISTS'e `NO_SEMIJOIN` ipucu ya da `LIMIT 1`'li bağımlı alt sorgu önerilir; talep tablosu büyüdükçe materyalizasyon doğrusal büyür. **`device_bindings(tenant_id, revoked_at)` eklenmedi:** mevcut IX(tenant_id, customer_id, revoked_at) kaplayan aralıkla 5.000 kayıtta 0,4 ms; firma başına kayıt sayısı oturumun altında kalır. Firma silmede `DELETE … WHERE tenant_id = ? LIMIT 500` her tabloda tenant_id önekli bir indeksle çalışır (`user_permissions`/`recovery_codes`/`password_reset_tokens`/`auth_sessions` için `user_id IN (SELECT id FROM users WHERE tenant_id = ?)` — IX(tenant_id, status) + PK/IX(user_id …)).

### Dolu DB'de 1644 bulgusu (2026-11-15, ikinci tur)

- **Belirti:** P15 düzeyinde dolu bir DB'de (P15 `test:int` artığı + sentetik firmalar) `migrate deploy` → P3018 / 1644.
- **Kök neden:** tetikleyici değil, **ön kontrol**: `P16_PRECHECK users=1`. Satır, P15 `superadmin-reset-p13b` testinin bıraktığı `status = 'ACTIVE'`, `deleted_at` dolu bir SUPER_ADMIN fikstürüdür. P15 uygulama kodunda `users.deleted_at` yazan yol yok (yalnız test fikstürleri), bu yüzden gerçek veride beklenmez. Tetikleyiciler geri doldurma ve `users.delete` DELETE'inden **sonra** kuruluyor; migration içindeki DML tetikleyiciye çarpmıyor (dolu DB'de kanıtlandı).
- **Karar:** ön kontrol fail-closed kalır (mimari §7.1). Kendiliğinden mezar taşı PII'yi geri dönüşsüz siler, kendiliğinden diriltme silinmiş hesabı yeniden etkinleştirilebilir yapar; ikisi de onaysız yapılmaz.
- **Deploy öncesi kontrol (salt okuma):** `SELECT id, role, status FROM users WHERE deleted_at IS NOT NULL AND status <> 'DELETED';` → 0 olmalı.
- **Düzeltme (yalnız test/staging artığı; migrator):** satır pasif ve görünür olur, giriş yapamaz:
  `UPDATE users SET status = 'PASSIVE', deleted_at = NULL WHERE deleted_at IS NOT NULL AND status <> 'DELETED';`
  → `prisma migrate resolve --rolled-back 20261118000000_p16_hard_delete` → `pnpm db:migrate`. Gerçek bir silinmiş hesapsa P16 kodu geldikten sonra mezar taşı ucuyla silinir.
- **Kanıt** (geçici `rs-p16g1b-7de3aa`, silindi; P15 kodu ayrı `git worktree`'de, sonra kaldırıldı): P15 `test:int` 636/636 → +13.000 firma (4.367 PASSIVE), 26.000 kullanıcı (6.500 `users.delete` açık), 40.000 oturum (yarısı anonim), 10.000 kayıt (2/3 geçersiz), 20.000 anonim talep, 50.000 audit satırı. P16 up → `P16_PRECHECK users=1`, hiçbir şey değişmedi (tetikleyici 3, sütun yok). Düzeltme + resolve + up: 1,3 sn, drift 0, tetikleyici 22, audit `{grantedBefore: 6500, rowsDeleted: 26000, grantedAfter: 0}`, PASSIVE firmaların hepsinde `passive_at` dolu. `check-app-grants` 501/501 → down (P15'e diff 0) → up (drift 0) → 501/501, continuity `ok=true count=22`. Aynı DB'de P16 `test:int` 657/657.

### Kilit ve geri alma

- COPY: `tenants` (CHECK), `users` (CHECK). Diğerleri INSTANT/metadata ya da boş tablo. 19 CREATE TRIGGER kısa metadata kilidi.
- `down.sql`: başta iki koruma — `p16_down_guard_chk` (DELETED kullanıcı ya da iş satırı) ve `p16_down_fk_guard_chk` (firması olmayan audit satırı) — hiçbir şey değişmeden 3819. Sonra yordam kalıntısı, P16 REVOKE'ları, 19 tetikleyici, tablo, CHECK'ler, sütun, FK geri, migration kaydı. `users.delete` geri gelmez. **Önce P16 sunucu kodu ve grants.sql geri alınmalı.** İlk firma silindikten sonra down pratikte kapanır (audit dangling).

### Test (2026-11-15, geçici `rs-p16g1-a92611`, mysql 8.4.13 binlog açık + bayrak, silindi)

- Temiz up (P1→P16) OK; `migrate diff --exit-code` 0; tetikleyici 22; continuity `ok=true count=22`.
- `check-app-grants.sh` **501/501 PASS** (önce 425). §7.1 negatiflerinin hepsi: taze anonim oturum/talep/kayıt DELETE, aktif firma customers, Super Admin ve firma kullanıcısı DELETE, tenants DELETE, passive_at geri tarihleme (UPDATE ve INSERT'te zorlanan değer; ACTIVE'de NULL), mezar taşı UPDATE + `users_deleted_chk` 3 negatif, açık işte yeniden etkinleştirme (SCHEDULED ve FAILED), `anonymized_at = '2000-01-01'` / +1 g / değiştirme / NULL'lama, `revoked_at` geçmiş ve dolu değer değişimi, `state = RUNNING` ve `step = FILES` INSERT, `scheduled_for` dolmadan RUNNING, `scheduled_for` değişimi, `tenant_id` `system`/`..`/küçük harf (CHECK), RUNNING ve SCHEDULED iş DELETE, adım atlatma, erken tenant_row_deleted_at, preview_hash değişimi, yeni hash'siz sürdürme, tek açık iş UQ, preview_hash UQ. Pozitif: iş +24 sa açılır, iptal sonrası etkinleştirme, adım +1, sürdürme. **Migrator fikstürü:** 29 g anonim oturum (ve onayı) DELETE → SIGNAL, 31 g → OK; uçtan uca (PASSIVE 31 g + RUNNING): customers DELETE OK; SCHEDULED iş ve 29 g pasif → SIGNAL; TENANT_ROW'da firma satırı silinir, `tenant_row_deleted_at` DB saatine zorlanır; DONE iş 729 g SIGNAL, 731 g OK.
- down: koruma 1 (mezar taşı) ve 2 (dangling audit) → 3819, tetikleyici 22 kaldı. Temiz down → P15 şemasına diff 0, tetikleyici 3, P16 DELETE yetkileri ve `tenant_purge_jobs` tables_priv satırı yok. Yeniden up → drift 0.
- Ön kontrol: down sonrası `deleted_at` dolu kullanıcı → `P16_PRECHECK users=1`, hiçbir şey değişmedi (tetikleyici 3, sütun yok, FK var). Düzeltme + resolve + up → OK; audit satırı `{grantedBefore: 1, rowsDeleted: 2, grantedAfter: 0}`; PASSIVE firmada `passive_at = updated_at`. `binlog_flag` dalı sınanmadı (root'la global bayrak değiştirmek gerekir).
- P14a düzeltme SQL'i (yukarıda) `prisma db execute` ile iki kez: hatasız.
- Server: typecheck/lint temiz, `test` 383/383, temiz DB'de `test:int` **636/636** (65 dosya).

## P18 — talep iletişimi: session_messages, business_holidays, öncelik/atama/SLA, mesai, MESSAGES adımı (H1, 2026-11-15)

Migration `apps/server/prisma/migrations/20261119000000_p18_request_comms/{migration.sql,down.sql}`. Mimari-e11 §8b.1 +
§8b.13 (güvenlik tasarım turu S-P18-T2, T5, T11); ADR-0025 m.1–m.3; AC-255..258. Veri taşıma yok: eski talepler `NORMAL`,
atanmamış, SLA'sız, `after_hours = 0`; firma ayarları `NORMAL` / SLA yok / `Europe/Istanbul` / takvim kapalı / `ACCEPT`.

### Şema

| Değişiklik                   | Ayrıntı                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `session_messages` (yeni)    | §8b.1 sütunları, `updated_at` yok. CHECK: `sender` (ikili), `sender_user` (TECH ⇔ `sender_user_id`), `parent` (talep ya da oturum), `client_msg_id_fmt` (`^[A-Za-z0-9_-]{1,36}\z`), `body_chars` 1..1000, `body_enc` uzunluğu `[29 + chars, 29 + 4 × chars]` (lib/crypto biçimi). UQ(request_id, sender, client_msg_id); IX(request_id, tenant_id, created_at), IX(session_id, tenant_id, created_at), IX(tenant_id, created_at), IX(sender_user_id). FK'ler RESTRICT; talep/oturum bileşik (tenant tutarlı) |
| `business_holidays` (yeni)   | `day` DATE, `name` metin kuralı (1..100, kırpılmış, Cc/Cf/Zl/Zp yok), `open_until` TIME(0) (00:00 < t < 24:00, saniyesiz). UQ(tenant_id, day), IX(created_by)                                                                                                                                                                                                                                                                                                                                                |
| `support_requests` +=        | `priority` (LOW/NORMAL/HIGH), `assigned_to` + `assigned_at` (birlikte), `sla_minutes` 5..1440, `sla_due_at` (dakika NULL ⇒ NULL; > created_at), `after_hours`. **Bileşik FK** (`assigned_to`, `tenant_id`) → `users(id, tenant_id)` (S-P18-T5): başka tenant kullanıcısı ve Super Admin atanamaz (1452). IX(assigned_to, tenant_id, status)                                                                                                                                                                  |
| `users`                      | UQ(id, tenant_id) `users_id_tenant_id_key` (bileşik FK hedefi; INPLACE)                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `customers` +=               | `default_priority` (NULL ya da enum), `sla_minutes` (NULL ya da 5..1440)                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `tenant_request_settings` += | `default_priority`, `default_sla_minutes`, `time_zone` (biçim CHECK; geçerlilik zod), `hours_enabled`, `business_hours` (JSON şeması + gün içi `from < to` + iki aralık örtüşmez; `to` en çok `"24:00"`), `after_hours_mode` (ACCEPT/REJECT); `hours_enabled ⇒ business_hours` dolu                                                                                                                                                                                                                          |
| `tenant_purge_jobs_step_chk` | 18 adım: `MESSAGES`, `SESSION_CONSENTS` ile `REQUEST_UNLINK` arasında. `tenant_purge_jobs_update_guard` aynı gövdeyle yeniden kuruldu (üç `FIELD()` listesi)                                                                                                                                                                                                                                                                                                                                                 |

**Sapmalar** (mimari §8b.13'e not düşüldü): IX sırası (`assigned_to` başta, FK için); `sla_due_chk` yönü düzeltildi (`<=`);
`"24:00"` kabulü. `business_hours` gün sırası Pazartesi=0; iki aralığın sırası serbest (zod sıralayabilir).

### Tetikleyici (1 yeni, toplam 23)

`session_messages_delete_guard` (BEFORE DELETE; P16 ortak gövdesi, `p18:` önekli). İzin: **dolu her üst bağ anonim**
(talep VE oturum; S-P18-T11) ya da PURGING (RUNNING iş + PASSIVE ≥ 30 g). Retention `anonymizeRequestsOf`, talebi
anonimleştirdiği **aynı TX'te** siler; tetikleyici aynı TX'in UPDATE'ini görür (test edildi). `lib/db.ts isP16Signal`
artık `p18:` önekini de `db_signal` sayar.

### Ön kontrol

`p18_precheck`: `P18_PRECHECK purge_jobs_open=<n>` (RUNNING/FAILED firma silme işi) ve `binlog_flag`. Düşerse hiçbir şey
değişmez (yordam DB'de kalır, zararsız). Deploy öncesi elle: `SELECT id, tenant_id, state, step FROM tenant_purge_jobs
WHERE state IN ('RUNNING','FAILED');` → 0 olmalı. Açık iş varsa önce bitirilir (yürütücü) ya da FAILED iş runbook'taki
sürdürme ile tamamlanır; sonra `prisma migrate resolve --rolled-back 20261119000000_p18_request_comms` → `pnpm db:migrate`.

### Yetkiler

`session_messages`, `business_holidays`: SELECT, INSERT, DELETE; UPDATE/DDL REVOKE. **S-P18-T2:** app'e UPDATE yok;
anahtar sızıntısında yeniden şifreleme (`cli crypto:rewrap`, H3) `migrator` ile yapılır — migrator'ın DB üzerinde ALL'ı
var ve tabloda UPDATE tetikleyicisi yok, ek yetki gerekmez. **S-P18-T3** (`support_requests.message`): yetki
`contracts/permissions.ts`'te; `user_permissions.perm_key` serbest VARCHAR(60) → şema değişikliği yok.

### Beklenen sayılar

- `audit-continuity.sql` sabiti `f029d544…3c90` (23; P16 22'nin sabiti `a4a6f552…13be`).
- `check-app-grants.sh`: toplam 23; dağılım 12/6/2; DELETE yetkili tablo kümesi += business_holidays, session_messages;
  mysqldump 23; continuity `count=23, ok=true`.
- **devops'a (H5):** `backup.sh` `BACKUP_EXPECTED_TRIGGERS` varsayılanı, `backup.env.example`, `restore.sh`
  `RESTORE_EXPECTED_TRIGGERS` varsayılanı, `test-backup-inner.sh` beklentisi 22 → 23 (sabit tek kaynakta değil; dba
  dokunmadı). `lib-ledger.sh` `-ge 22` doğru kalır. Staging/prod `backup.env`'de elle 22 yazılıysa migration'dan önce boşaltın.

### Firma silme (uygulama tarafı, H1'de yapıldı)

`TENANT_PURGE_STEPS` += `MESSAGES` (18), `DATA_STEPS.MESSAGES = [session_messages]`, `SETTINGS` += `business_holidays`
(USERS'tan önce; `created_by` FK). Web etiketi "Talep mesajları". Meta-testler: `users`'a FK listesi +=
`business_holidays.created_by`, `session_messages.sender_user_id`, `support_requests.assigned_to` / `.tenant_id` (bileşik
FK iki satır); korunan tablolar += session_messages. Fikstür `seedPurgeTenant` bir mesaj + bir tatil ekler.

### Sorgu planları (EXPLAIN, 8.4.13, seed + test verisi)

| Sorgu                                                                          | Plan                                                          |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Kuyruk: `tenant_id = ? AND status = 'PENDING' ORDER BY created_at LIMIT 200`   | IX(tenant_id, status, created_at) (sıralama uygulamada)       |
| "Bana atananlar": `tenant_id = ? AND assigned_to = ? AND status = 'PENDING'`   | IX(assigned_to, tenant_id, status) ref                        |
| "Atanmamış": `assigned_to IS NULL` + aynı süzgeç                               | IX(tenant_id, status, created_at) + filtre (kuyruk ≤ 50)      |
| Mesajlar: `tenant_id = ? AND request_id = ? AND id > ? ORDER BY created_at`    | IX(request_id, tenant_id, created_at) + ICP; sıralama yok     |
| Talep başına sayım (200 tavanı): `COUNT(*) … request_id = ? AND tenant_id = ?` | UQ(request_id, sender, client_msg_id) önek (gönderici başına) |
| Tatiller: `tenant_id = ? AND day BETWEEN ? AND ?`                              | UQ(tenant_id, day) kaplayan aralık                            |

**Backend'e:** mesaj listesinde `ORDER BY created_at, id` yerine `ORDER BY created_at` (ULID aynı ms'de sıralı değilse
istemci `id` ile kararlı sıralar); gönderici başına tavan (S-P18-T4) `request_id = ? AND sender = ?` ile UQ önekini kullanır.

### Kilit ve geri alma

- INSTANT: üç tablodaki sütun eklemeleri. COPY: `tenant_request_settings`, `customers` (CHECK), `support_requests`
  (indeks + FK + CHECK tek ALTER), `tenant_purge_jobs` (CHECK). INPLACE: `users` UQ. Yeni tablolar boş.
- `down.sql`: `p18_down_guard_chk` (mesaj ya da tatil satırı) ve `p18_down_jobs_guard_chk` (RUNNING/FAILED iş ya da
  `step = MESSAGES`) → hiçbir şey değişmeden 3819. Sonra REVOKE (DROP TABLE tables_priv satırını silmez), update_guard + step
  CHECK P16 hâline, tetikleyici, tablolar, FK/indeks/CHECK/sütunlar, UQ, migration kaydı. **Önce P18 kodu ve grants.sql
  geri alınmalı.**

### Test (2026-11-15, geçici `rs-p18h1-c4e7a2:33481`, mysql 8.4.13 binlog açık + bayrak, silindi)

- Temiz up (P1→P18) OK; `migrate diff --exit-code` 0; tetikleyici 23; continuity `ok=true count=23`.
- `check-app-grants.sh` **561/561 PASS** (+60 P18 satırı): §8b.1 negatiflerinin hepsi (anonim olmayan talebin mesajı DELETE →
  SIGNAL, anonim → OK; `session_messages`/`business_holidays` UPDATE → 1142; TECH + NULL `sender_user_id` → 3819;
  `priority = 'URGENT'` → 3819; 8 günlük `business_hours` → 3819), §8b.13 ekleri (başka tenant kullanıcısına ve Super
  Admin'e atama → 1452; iki bağlı satırda yalnız talep ya da yalnız oturum anonim → SIGNAL, ikisi anonim → OK), RUNNING
  silme işinde DELETE OK / iş yokken SIGNAL, adım MESSAGES → REQUEST_UNLINK OK / atlama SIGNAL, CHECK negatifleri.
- down: iki koruma 3819 (tetikleyici 23 kaldı). Temiz down → P16 şemasına diff 0, tetikleyici 22, continuity özeti P16
  sabitine (`a4a6f552…`) eşit, tables_priv satırı yok. Yeniden up → drift 0.
- Ön kontrol: down + RUNNING iş → `P18_PRECHECK purge_jobs_open=1`, hiçbir şey değişmedi (tetikleyici 22, sütun yok).
  Temizlik + resolve + up → OK.
- Seed (boş DB) OK (demo `business_hours` CHECK'ten geçti).
- Server `test` 383/383, contracts 103/103, web `p16.test` 10/10; temiz DB'de `test:int` **686/686** (71 dosya; yeni
  `p18-schema-h1.test.ts` 7 test).
