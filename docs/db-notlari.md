# DB Notları — Remote Support (P1)
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
Ortak: PK ULID `CHAR(26)` (uygulama üretir), `created_at/updated_at DATETIME(3)` UTC, enum'lar `VARCHAR(20)` + **CHECK**, tüm FK `ON DELETE/UPDATE RESTRICT`, utf8mb4_unicode_ci.
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
