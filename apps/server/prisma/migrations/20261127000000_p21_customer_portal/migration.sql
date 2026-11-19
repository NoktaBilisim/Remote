-- P21-K1 müşteri portalı veri modeli (docs/mimari-p21.md r2 §3.1–3.4, §11 K1; ADR-0039; AC-262; K-P21-1/4/5/6/9/11/12/14;
-- r2 S-P21-3 UQ(tenant_id, email), S-P21-5 temp_password_expires_at). Ayrıntı ve gerekçeler: docs/db-notlari.md "P21".
-- Veri taşıma YOK: iki yeni tablo boş başlar; mevcut tablolarda sütun/kısıt değişikliği YOK. Yeni tablolar → prisma/sql/grants.sql
-- (SELECT/INSERT/DELETE + sütun düzeyi UPDATE; email/tenant_id/customer_id/token_hash/expires_at güncellenemez).
-- Tetikleyici YOK → toplam 23 kalır (deploy/mysql/audit-continuity.sql özet sabiti, deploy/backup/lib.sh değişmez).
--
-- ELLE YAZILDI / ELLE EKLENDİ (dba): Prisma CHECK üretmez. Prisma'nın ürettiği kısımlar (CREATE TABLE, indeksler, FK'ler)
-- `migrate diff` çıktısıyla aynı ad/tipte; CHECK'ler boş tabloların CREATE'ine gömüldü (sonradan ALTER = gereksiz COPY).
-- Sonrasında `migrate diff --exit-code` = 0 (drift yok).
--
-- Sapmalar / daraltmalar (db-notlari "P21"; mimari-p21 §3'e not düşüldü):
--  * portal_users IX(tenant_id) YOK (mimari §3.1 listesinde var): UQ(tenant_id, email) ve IX(tenant_id, customer_id, status)
--    zaten tenant_id önekli → tenant FK ve firma silme (`WHERE tenant_id=?`) onları kullanır; üçüncü indeks yalnız yazma maliyeti.
--  * email küçük harf CHECK'i İKİLİ karşılaştırma (ADR-0014): tablo harmanlaması utf8mb4_unicode_ci olduğundan mimarideki
--    `email = LOWER(email)` her zaman doğru olurdu (etkisiz). Ek: kırpılmış + P15 e-posta iskeleti (`\z`).
--  * Mimariye ek CHECK'ler: full_name (customers_name_chk kuralı, mimari "2..100, kontrol karakteri yok"), password_hash yalnız
--    argon2id PHC biçimi (düz/zayıf özet yazılamaz), TOTP üçlüsü (users P10 kalıbı), failed_login_count ≥ 0, created_by ULID biçimi;
--    portal_sessions token_hash küçük harf hex 64 (`\z`), TTL (created_at, created_at + 8 sa + 1 dk].
--
-- Kilit (MySQL 8.4): yalnız yeni (boş) tablolar + boş tablolarda FK → kilit yok. Mevcut tablolara (tenants, customers) yalnız
-- FK hedefi olarak dokunulur (referans eden FK eklemek ebeveyn tabloyu yeniden yazmaz; kısa metadata kilidi).
-- Ön kontrol (ileri) gerekmez. Geri alma: down.sql (elle; Prisma çalıştırmaz).

-- 1) portal_users (§3.1). PRISMA ÜRETTİ + CHECK'ler ELLE.
CREATE TABLE `portal_users` (
    `id` CHAR(26) NOT NULL,
    `tenant_id` CHAR(26) NOT NULL,
    `customer_id` CHAR(26) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `full_name` VARCHAR(100) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `must_change_password` BOOLEAN NOT NULL DEFAULT true,
    `failed_login_count` INTEGER NOT NULL DEFAULT 0,
    `failed_window_at` DATETIME(3) NULL,
    `locked_until` DATETIME(3) NULL,
    `totp_secret_enc` VARBINARY(255) NULL,
    `totp_enabled` BOOLEAN NOT NULL DEFAULT false,
    `totp_last_step` BIGINT NULL,
    `theme` VARCHAR(20) NOT NULL DEFAULT 'SYSTEM',
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `passive_at` DATETIME(3) NULL,
    `last_login_at` DATETIME(3) NULL,
    `temp_password_expires_at` DATETIME(3) NULL,
    `created_by` CHAR(26) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `portal_users_tenant_id_customer_id_status_idx`(`tenant_id`, `customer_id`, `status`),
    INDEX `portal_users_status_passive_at_idx`(`status`, `passive_at`),
    UNIQUE INDEX `portal_users_tenant_id_email_key`(`tenant_id`, `email`),
    UNIQUE INDEX `portal_users_id_tenant_id_key`(`id`, `tenant_id`),
    PRIMARY KEY (`id`),
    -- ELLE (K-P21-6): servis küçük harfe indirir ve kırpar; DB ikili karşılaştırmayla zorlar (unicode_ci'de `=` harf duyarsız).
    -- İskelet P15 / customer_notify_contacts_email_chk ile aynı (`\z`; tam doğrulama zod).
    CONSTRAINT `portal_users_email_chk` CHECK (
        CAST(`email` AS BINARY) = CAST(LOWER(`email`) AS BINARY)
        AND REGEXP_LIKE(`email`, '^[^@\\s\\p{Cc}\\p{Cf}]+@[^@\\s\\p{Cc}\\p{Cf}]+\\z', 'c')),
    -- ELLE: customers_name_chk kuralı — trim, 2..100 kod noktası, Cc/Cf/Zl/Zp yok (panel listesi + portal üst menü).
    CONSTRAINT `portal_users_full_name_chk` CHECK (
        CHAR_LENGTH(`full_name`) BETWEEN 2 AND 100
        AND CHAR_LENGTH(`full_name`) = CHAR_LENGTH(TRIM(`full_name`))
        AND NOT REGEXP_LIKE(`full_name`, '[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]', 'c')),
    -- ELLE (daraltma): yalnız argon2id PHC dizgesi (mimari §5.1) — düz şifre ya da başka algoritma özeti yazılamaz.
    CONSTRAINT `portal_users_password_hash_chk` CHECK (REGEXP_LIKE(`password_hash`, '^[$]argon2id[$]v=[0-9]+[$]', 'c')),
    -- ELLE: users P10 TOTP kalıbı — açık TOTP sırsız olamaz; sır en az GCM zarfı (IV 12 + etiket 16 + veri); son adım sırla.
    CONSTRAINT `portal_users_totp_enabled_chk` CHECK (NOT `totp_enabled` OR `totp_secret_enc` IS NOT NULL),
    CONSTRAINT `portal_users_totp_secret_enc_chk` CHECK (`totp_secret_enc` IS NULL OR LENGTH(`totp_secret_enc`) >= 30),
    CONSTRAINT `portal_users_totp_last_step_chk` CHECK (`totp_last_step` IS NULL
        OR (`totp_last_step` > 0 AND `totp_secret_enc` IS NOT NULL)),
    -- ELLE (ADR-0014 ikili enum'lar).
    CONSTRAINT `portal_users_theme_chk` CHECK (CAST(`theme` AS BINARY) IN ('LIGHT', 'DARK', 'SYSTEM')),
    CONSTRAINT `portal_users_status_chk` CHECK (CAST(`status` AS BINARY) IN ('ACTIVE', 'PASSIVE')),
    -- ELLE (K-P21-9): saklama sayacı yalnız ve her zaman pasif hesapta (etkinleştirme passive_at'i NULL'lar).
    CONSTRAINT `portal_users_passive_chk` CHECK ((CAST(`status` AS BINARY) = 'PASSIVE') = (`passive_at` IS NOT NULL)),
    -- ELLE (r2 S-P21-5): geçici şifre süresi yalnız zorunlu değişim bekleyen hesapta; şifre değişimi ikisini birlikte kapatır.
    CONSTRAINT `portal_users_temp_password_chk` CHECK (`temp_password_expires_at` IS NULL OR `must_change_password` = 1),
    CONSTRAINT `portal_users_failed_count_chk` CHECK (`failed_login_count` >= 0),
    -- ELLE: created_by FK değil (panel kullanıcısı kalıcı silinse de satır kalır) → yalnız ULID biçimi (session_recordings_recorder_chk).
    CONSTRAINT `portal_users_created_by_chk` CHECK (`created_by` IS NULL OR REGEXP_LIKE(`created_by`, '^[0-9A-Z]{26}\\z', 'c'))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 2) portal_sessions (§3.2). PRISMA ÜRETTİ + CHECK'ler ELLE.
CREATE TABLE `portal_sessions` (
    `id` CHAR(26) NOT NULL,
    `portal_user_id` CHAR(26) NOT NULL,
    `tenant_id` CHAR(26) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `ip` VARCHAR(45) NOT NULL,
    `user_agent` VARCHAR(300) NOT NULL,
    `last_seen_at` DATETIME(3) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `portal_sessions_token_hash_key`(`token_hash`),
    INDEX `portal_sessions_portal_user_id_tenant_id_revoked_at_idx`(`portal_user_id`, `tenant_id`, `revoked_at`),
    INDEX `portal_sessions_expires_at_idx`(`expires_at`),
    INDEX `portal_sessions_tenant_id_idx`(`tenant_id`),
    PRIMARY KEY (`id`),
    -- ELLE: düz token yazılamasın (yalnız SHA-256 hex, küçük harf; `\z` — ICU `$` sondaki satır sonunu kabul ediyordu).
    CONSTRAINT `portal_sessions_token_hash_fmt_chk` CHECK (REGEXP_LIKE(`token_hash`, '^[0-9a-f]{64}\\z', 'c')),
    -- ELLE (§3.2): mutlak 8 saat (+1 dk uygulama/DB saat farkı toleransı, password_reset_tokens kalıbı). expires_at'te UPDATE
    -- yetkisi de yok → oturum uzatılamaz.
    CONSTRAINT `portal_sessions_ttl_chk` CHECK (`expires_at` > `created_at`
        AND `expires_at` <= `created_at` + INTERVAL 8 HOUR + INTERVAL 1 MINUTE)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey (PRISMA ÜRETTİ)
ALTER TABLE `portal_users` ADD CONSTRAINT `portal_users_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey (PRISMA ÜRETTİ) — bileşik: hesabın müşterisi hesabın firmasında.
ALTER TABLE `portal_users` ADD CONSTRAINT `portal_users_tenant_id_customer_id_fkey` FOREIGN KEY (`tenant_id`, `customer_id`) REFERENCES `customers`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey (PRISMA ÜRETTİ) — bileşik: oturumun firması = hesabın firması.
ALTER TABLE `portal_sessions` ADD CONSTRAINT `portal_sessions_portal_user_id_tenant_id_fkey` FOREIGN KEY (`portal_user_id`, `tenant_id`) REFERENCES `portal_users`(`id`, `tenant_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
