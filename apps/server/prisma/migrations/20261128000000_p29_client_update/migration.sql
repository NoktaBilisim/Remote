-- P29-K1 istemci otomatik güncelleme veri modeli (docs/mimari-p29.md §3.1–3.3, §9.5, §11 K1; AC-485, 490; K-P29-7/18).
-- Ayrıntı ve gerekçeler: docs/db-notlari.md "P29". Veri taşıma YOK: client_auto_update mevcut firmalarda DEFAULT TRUE (AC-485
-- varsayılan Açık); update_* NULL ("olay yok") → mevcut satırlar yeni CHECK'leri olduğu gibi geçer. Yeni tablo YOK → grants.sql'de
-- yeni GRANT yok (tablo düzeyi UPDATE P1/P27'den; yalnız açıklayıcı yorum). Tetikleyici YOK → toplam 23, audit-continuity.sql
-- özet sabiti değişmez. Yeni indeks YOK (mimari §3.2: dağılım mevcut IX(tenant_id, revoked_at, name) ile).
--
-- ELLE EKLENDİ (dba): Prisma CHECK üretmez. Sütunlar `migrate diff` çıktısıyla aynı ad/tipte; sonrasında `migrate diff
-- --exit-code` = 0. CHECK'ler:
--  * update_state_chk: ikili enum (ADR-0014; CAST AS BINARY — 'failed', 'FAILED ', 'FAİLED' reddedilir).
--  * update_version_chk: agent_version_chk ile birebir (semver x.y.z, her parça 1..3 hane; `\z` → sonda `\n` yok; 'c' kipi).
--  * update_reason_chk: ikili enum = UPDATE_FAIL_REASONS ∪ UPDATE_SKIP_REASONS (contracts §4.1); state ∈ {FAILED, ROLLED_BACK,
--    SKIPPED} ⇔ reason dolu (NULL-güvenli: state NULL iken reason NULL olmalı). Neden ↔ durum sınıfı eşlemesi (FAILED/ROLLED_BACK
--    → FAIL, SKIPPED → SKIP) zod refine'ında; DB birleşimi tutar (K2 listeleri değişirse 3819 riski yerine geniş kalır).
--  * update_set_chk (SAPMA, db-notlari "P29"): state, version, update_at birlikte dolu ya da birlikte NULL — mimari §3.2 yazma
--    kuralı "dört alan birlikte" DB'de zorunlu (reason kendi CHECK'iyle state'e bağlı).
--
-- Kilit (MySQL 8.4): ADD CHECK INPLACE/INSTANT desteklenmez (ALGORITHM=INPLACE → 1845 ER_ALTER_OPERATION_NOT_SUPPORTED, test DB'de
-- denendi) → unattended_devices TEK COPY ALTER (sütun + CHECK birlikte, tek yeniden yazım, kısıtsız ara an yok). Tablo küçük
-- (firma başına ≤ birkaç yüz cihaz; db-notlari "P29"), süre ms mertebesi; süresince device.auth / last_seen UPDATE'i bekler.
-- tenant_settings: yalnız ADD COLUMN … DEFAULT → INSTANT (firma başına 1 satır).
-- Ön kontrol (ileri) gerekmez. Geri alma: down.sql (elle; Prisma çalıştırmaz; guard'lı).

-- 1) tenant_settings (§3.1, AC-485). PRISMA ÜRETTİ.
ALTER TABLE `tenant_settings` ADD COLUMN `client_auto_update` BOOLEAN NOT NULL DEFAULT true, ALGORITHM=INSTANT;

-- 2) unattended_devices (§3.2, AC-490). PRISMA ÜRETTİ (sütunlar) + CHECK'ler ELLE — TEK COPY ALTER.
ALTER TABLE `unattended_devices`
    ADD COLUMN `update_at` DATETIME(3) NULL,
    ADD COLUMN `update_reason` VARCHAR(24) NULL,
    ADD COLUMN `update_state` VARCHAR(12) NULL,
    ADD COLUMN `update_version` VARCHAR(20) NULL,
    ADD CONSTRAINT `unattended_devices_update_state_chk` CHECK (`update_state` IS NULL
        OR CAST(`update_state` AS BINARY) IN ('AVAILABLE', 'INSTALLING', 'FAILED', 'ROLLED_BACK', 'SKIPPED')),
    ADD CONSTRAINT `unattended_devices_update_version_chk` CHECK (`update_version` IS NULL
        OR REGEXP_LIKE(`update_version`, '^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}\\z', 'c')),
    -- state kendi ikili CHECK'iyle kanonik → burada CAST gerekmez; IS NOT NULL ile NULL-güvenli eşdeğerlik.
    ADD CONSTRAINT `unattended_devices_update_reason_chk` CHECK (
        (`update_state` IS NOT NULL AND `update_state` IN ('FAILED', 'ROLLED_BACK', 'SKIPPED')
            AND `update_reason` IS NOT NULL
            AND CAST(`update_reason` AS BINARY) IN ('DOWNLOAD', 'HASH_MISMATCH', 'MANIFEST_SIGNATURE', 'PLATFORM_SIGNATURE',
                'DOWNGRADE', 'EXPIRED', 'ENV_MISMATCH', 'INSTALL', 'HEALTH', 'POLICY_OFF', 'NOT_WRITABLE', 'MANUAL_ONLY'))
        OR ((`update_state` IS NULL OR `update_state` NOT IN ('FAILED', 'ROLLED_BACK', 'SKIPPED')) AND `update_reason` IS NULL)),
    ADD CONSTRAINT `unattended_devices_update_set_chk` CHECK ((`update_state` IS NULL) = (`update_version` IS NULL)
        AND (`update_state` IS NULL) = (`update_at` IS NULL)),
    ALGORITHM=COPY;
