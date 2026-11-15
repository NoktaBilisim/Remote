-- P27a-K1 2FA "bu cihazı 30 gün hatırla" veri modeli (docs/mimari-p27a.md §3.1–3.3, §13; AC-325..335b, K-P27a-1/2/11/12).
-- Ayrıntı ve gerekçeler: docs/db-notlari.md "P27a". Veri taşıma YOK: yeni tablo boş başlar; tenant_settings satırları yeni
-- sütunun DEFAULT'u ile TRUE alır (K-P27a-12 "mevcut firmalar da açık"; D-P27a-1'deki `NOT require_tech_2fa` yolu seçilmedi).
-- Yeni tablo `trusted_devices` → prisma/sql/grants.sql (SELECT/INSERT/UPDATE/DELETE).
--
-- ELLE YAZILDI / ELLE EKLENDİ (dba): Prisma CHECK ve ALGORITHM yan tümcesi üretmez. Prisma'nın ürettiği kısımlar (sütun,
-- CREATE TABLE, indeksler, FK'ler) `migrate diff` çıktısıyla aynı ad/tiple yazıldı; CHECK'ler boş tablonun CREATE'ine elle
-- eklendi (sonradan ALTER = gereksiz COPY). Sonrasında `migrate diff --exit-code` = 0 (drift yok).
--
-- Sapmalar / daraltmalar (db-notlari "P27a"; mimari-p27a §3.1'e işlenmek üzere koordinatöre bildirildi):
--  * r3 (güvenlik O-P27a-r2-1, mimari-p27a §3.1 r3): `prev_token_hash` sütunu YOK, `token_hash` İNDEKSSİZ (UQ yok). Çerez
--    `<satır id>.<gizli>`; arama PK ile, doğrulama token_hash ile (koşullu UPDATE `WHERE id=? AND token_hash=?`); satır
--    kullanıcınınsa ama özet tutmuyorsa (kaç nesil önce olursa olsun) yeniden kullanım. 256 bit gizli değerde çakışma yok.
--  * user FK bileşik: (user_id, tenant_id) → users(id, tenant_id) (P18 S-P18-T5 kalıbı; users UQ(id, tenant_id) mevcut).
--    Mimarideki "user_id FK + tenant_id uygulama kopyalar" kuralı DB'de zorlanır: satırın firması kullanıcının firmasından
--    farklı olamaz; tenant_id NOT NULL ile birlikte Super Admin (users.tenant_id NULL) satırı oluşamaz (K-P27a-2).
--    İndeks buna göre IX(user_id, tenant_id, created_at) (mimarideki IX(user_id, created_at) bileşik FK'yi karşılamaz →
--    MySQL gizli ek indeks açardı). Kullanıcı başına ≤ 10 satır: `WHERE user_id=? ORDER BY created_at` filesort'u önemsiz.
--  * Ek CHECK'ler (daraltma): token_hash küçük harf hex 64; expires_at ∈ (created_at, created_at + 30 g + 1 dk] (sabit 30 gün,
--    K-P27a-3; +1 dk uygulama/DB saat farkı toleransı, password_reset_tokens kalıbı); ua_summary'de kontrol/biçim karakteri yok.
--
-- Kilit (MySQL 8.4):
--  * tenant_settings ADD COLUMN (sonda, NOT NULL DEFAULT sabit) → ALGORITHM=INSTANT (yeniden yazım yok, firma sayısı küçük).
--  * trusted_devices yeni (boş) tablo → kilit yok. FK eklemeleri boş tabloda.
--  * Tetikleyici / saklı yordam YOK → toplam 23 kalır (deploy/backup/lib.sh, audit-continuity sabiti değişmez); firma silme adım
--    listesi değişmez (tablo USER_CHILDREN adımına parça, K4) → ön kontrol gerekmez.
-- Geri alma: down.sql (elle; Prisma çalıştırmaz).

-- 1) tenant_settings: firma anahtarı (K-P27a-1). PRISMA ÜRETTİ + ALGORITHM ELLE.
ALTER TABLE `tenant_settings` ADD COLUMN `mfa_remember_device` BOOLEAN NOT NULL DEFAULT true,
    ALGORITHM=INSTANT;

-- 2) trusted_devices. PRISMA ÜRETTİ + CHECK'ler ELLE.
CREATE TABLE `trusted_devices` (
    `id` CHAR(26) NOT NULL,
    `tenant_id` CHAR(26) NOT NULL,
    `user_id` CHAR(26) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `ua_summary` VARCHAR(80) NOT NULL,
    `ip` VARCHAR(45) NOT NULL,
    `last_used_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `trusted_devices_user_id_tenant_id_created_at_idx`(`user_id`, `tenant_id`, `created_at`),
    INDEX `trusted_devices_tenant_id_idx`(`tenant_id`),
    INDEX `trusted_devices_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`),
    -- ELLE: düz belirteç yazılamasın (yalnız SHA-256 hex, küçük harf; `\z` — ICU `$` sondaki satır sonunu kabul ediyordu).
    CONSTRAINT `trusted_devices_token_hash_fmt_chk` CHECK (REGEXP_LIKE(`token_hash`, '^[0-9a-f]{64}\\z', 'c')),
    -- ELLE: sabit 30 gün (K-P27a-3); döndürme süreyi uzatamaz (expires_at'i ileri alan UPDATE de reddedilir).
    CONSTRAINT `trusted_devices_ttl_chk` CHECK (`expires_at` > `created_at`
        AND `expires_at` <= `created_at` + INTERVAL 30 DAY + INTERVAL 1 MINUTE),
    -- ELLE: arayüzde/e-postada gösterilen özet; satır sonu/biçim karakteriyle başlık/metin enjeksiyonu yok.
    CONSTRAINT `trusted_devices_ua_summary_chk` CHECK (NOT REGEXP_LIKE(`ua_summary`, '[\\p{Cc}\\p{Cf}]'))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey (PRISMA ÜRETTİ)
ALTER TABLE `trusted_devices` ADD CONSTRAINT `trusted_devices_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey (PRISMA ÜRETTİ) — bileşik: satırın firması = kullanıcının firması.
ALTER TABLE `trusted_devices` ADD CONSTRAINT `trusted_devices_user_id_tenant_id_fkey` FOREIGN KEY (`user_id`, `tenant_id`) REFERENCES `users`(`id`, `tenant_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
