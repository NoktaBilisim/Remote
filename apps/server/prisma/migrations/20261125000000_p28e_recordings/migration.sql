-- P28e-K1 oturum kaydı veri modeli (docs/mimari-p28e.md r2 §3.1–3.5, §5.5, §14 K1; ADR-0034; AC-380, 381, 386, 447;
-- S-P28e-10 / K-P28e-18 `delete_reason='MISSING'`, K0s / K-P28e-16 `part_no` 0..59). Ayrıntı ve gerekçeler: docs/db-notlari.md "P28e".
-- Veri taşıma YOK: yeni tablolar boş; firmalar kayıt kapalı / saklama 30 g / gözetimsiz kayıt kapalı alır (varsayılan); mevcut
-- session_consents satırları line_sha256 = NULL ile yeni CHECK'leri olduğu gibi geçer. Yeni tablolar → prisma/sql/grants.sql.
-- Tetikleyici YOK (mimari §3) → toplam 23, deploy/mysql/audit-continuity.sql özet sabiti değişmez.
--
-- ELLE YAZILDI / ELLE EKLENDİ (dba): Prisma CHECK ve ALGORITHM yan tümcesi üretmez. Prisma'nın ürettiği kısımlar (sütunlar,
-- CREATE TABLE, indeksler, FK) `migrate diff` çıktısıyla aynı ad/tipte; yeni tabloların CHECK'leri CREATE'e gömüldü, mevcut
-- tablolarda sütun + indeks + FK + CHECK tablo başına TEK ALTER'da (tek yeniden yazım). Sonrasında `migrate diff --exit-code` = 0.
--
-- Sapmalar / daraltmalar (db-notlari "P28e"; mimari §3'e not düşüldü):
--  * session_recordings UNIQUE(session_id, tenant_id) (mimari UNIQUE(session_id)): bileşik session FK'nin öneki olmalı, yoksa
--    MySQL gizli ek indeks açar. session_id global tekil ULID ve FK (session_id, tenant_id) çiftini support_sessions'a bağladığından
--    UQ(session_id) ile eşdeğerdir (P8b support_sessions UQ(request_id, tenant_id) kalıbı).
--  * session_recording_parts UNIQUE(recording_id, tenant_id, series_no, part_no) (mimari UNIQUE(recording_id, series_no, part_no)):
--    aynı gerekçe (bileşik recording FK öneki); recording_id → tenant_id belirli olduğundan eşdeğer.
--  * session_recording_parts UNIQUE(storage_rel) (mimariye ek): mutabakat (a) `storage_rel IN (…)` araması tam tarama olmasın
--    (≈ 22 bin satır/tenant); bir disk dosyası tek satıra bağlı.
--  * session_recording_parts.storage_rel NOT NULL (mimari NULL): tabloda UPDATE grant'ı yok → NULL ara durumu yazılamaz; disk
--    silinince satır aynı TX'te silinir.
--  * session_consents_text_scope_chk genişler: RECORDING satırı oturumun VIEW GRANTED metnini taşır (mimari §3.1; eski kısıt
--    yalnız VIEW GRANTED'e izin veriyordu → 3819). Ek: RECORDING yalnız GRANTED/REVOKED (DENIED yazılmaz; ret audit'te).
--  * Mimariye ek CHECK'ler: durum ↔ stop_reason/stopped_at/delete_reason/deleted_at tutarlılığı, DELETED'da size_bytes = part_count = 0,
--    part_count = 0 ⇔ size_bytes = 0, expires_at ∈ [started_at + 1 g − 1 dk, started_at + 90 g + 1 dk], recorder_user_id ULID biçimi,
--    parça key_ver ≥ 1, storage_rel öneki = tenant_id.
--
-- Kilit (MySQL 8.4):
--  * session_recordings / session_recording_parts yeni (boş) → kilit yok.
--  * tenant_settings: küçük (firma başına 1 satır) → sütun + indeks + FK + CHECK tek ALTER (COPY).
--  * session_consents: ADD COLUMN + 3 CHECK DROP/ADD (kısıtsız ara an yok) → TEK COPY ALTER; tablo yeniden yazılır, süresince onay
--    yazımı (admit/rıza) bekler. Süre: db-notlari "P28e" (staging küçük; prod öncesi bakım penceresi).
-- Ön kontrol (ileri) gerekmez: yeni sütunlar NULL/varsayılan; level/text_scope CHECK'leri yalnız genişler.
-- Geri alma: down.sql (elle; Prisma çalıştırmaz) — önce precheck.sql.

-- 1) tenant_settings (§3.1, AC-380, 447). PRISMA ÜRETTİ (sütunlar, indeks, FK) + CHECK'ler ELLE — tek ALTER.
ALTER TABLE `tenant_settings`
    ADD COLUMN `recording_enabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `recording_retention_days` TINYINT NOT NULL DEFAULT 30,
    ADD COLUMN `unattended_recording_ack_at` DATETIME(3) NULL,
    ADD COLUMN `unattended_recording_ack_by` CHAR(26) NULL,
    ADD COLUMN `unattended_recording_enabled` BOOLEAN NOT NULL DEFAULT false,
    ADD INDEX `tenant_settings_unattended_recording_ack_by_idx`(`unattended_recording_ack_by`),
    ADD CONSTRAINT `tenant_settings_unattended_recording_ack_by_fkey` FOREIGN KEY (`unattended_recording_ack_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
    -- ELLE: REC_RETENTION_MIN/MAX = 1/90 (servis ayrıca ≤ retention_days doğrular).
    ADD CONSTRAINT `tenant_settings_recording_retention_chk` CHECK (`recording_retention_days` BETWEEN 1 AND 90),
    -- ELLE (§3.1): gözetimsiz kayıt yalnız kayıt açıkken. Kaydı kapatan UPDATE gözetimsiz anahtarı da aynı satırda kapatır.
    ADD CONSTRAINT `tenant_settings_unattended_rec_chk` CHECK (`unattended_recording_enabled` = 0 OR `recording_enabled` = 1),
    -- ELLE (P28u silent_ack kalıbı): açık politika aydınlatma izi olmadan var olamaz. Yalnız ack_at — ack_by kullanıcı silmede NULL.
    ADD CONSTRAINT `tenant_settings_unattended_rec_ack_chk` CHECK (`unattended_recording_enabled` = 0 OR `unattended_recording_ack_at` IS NOT NULL);

-- 2) session_consents (§3.1, AC-381). PRISMA ÜRETTİ (sütun) + CHECK'ler ELLE — TEK COPY ALTER.
ALTER TABLE `session_consents`
    ADD COLUMN `line_sha256` CHAR(64) NULL,
    DROP CHECK `session_consents_level_chk`,
    DROP CHECK `session_consents_text_scope_chk`,
    ADD CONSTRAINT `session_consents_level_chk` CHECK (CAST(`level` AS BINARY) IN ('VIEW', 'CONTROL', 'RECORDING')),
    -- RECORDING satırı oturumun VIEW GRANTED metnini kopyalar (aydınlatma sürümü bağı); diğer seviyelerde P4 kuralı aynen.
    ADD CONSTRAINT `session_consents_text_scope_chk` CHECK (`consent_text_id` IS NULL
        OR (`level` = 'VIEW' AND `decision` = 'GRANTED') OR CAST(`level` AS BINARY) = 'RECORDING'),
    -- Rıza cümlesinin SHA-256'sı (REC_CONSENT_LINE_SHA256) yalnız ve her zaman RECORDING satırında; küçük harf hex.
    ADD CONSTRAINT `session_consents_line_chk` CHECK ((CAST(`level` AS BINARY) = 'RECORDING') = (`line_sha256` IS NOT NULL)
        AND (`line_sha256` IS NULL OR REGEXP_LIKE(`line_sha256`, '^[0-9a-f]{64}\\z', 'c'))),
    -- RECORDING: rıza (GRANTED) ve müşterinin durdurması (REVOKED). Reddedilen rıza satır değil audit (`consent_rejected`).
    ADD CONSTRAINT `session_consents_recording_decision_chk` CHECK (CAST(`level` AS BINARY) <> 'RECORDING'
        OR CAST(`decision` AS BINARY) IN ('GRANTED', 'REVOKED')),
    ALGORITHM=COPY;

-- 3) session_recordings (§3.2). PRISMA ÜRETTİ + CHECK'ler ELLE.
CREATE TABLE `session_recordings` (
    `id` CHAR(26) NOT NULL,
    `tenant_id` CHAR(26) NOT NULL,
    `session_id` CHAR(26) NOT NULL,
    `basis` VARCHAR(14) NOT NULL,
    `state` VARCHAR(8) NOT NULL,
    `stop_reason` VARCHAR(12) NULL,
    `delete_reason` VARCHAR(10) NULL,
    `recorder_user_id` CHAR(26) NULL,
    `started_at` DATETIME(3) NOT NULL,
    `stopped_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `duration_ms` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `size_bytes` BIGINT NOT NULL DEFAULT 0,
    `part_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `session_recordings_tenant_id_state_idx`(`tenant_id`, `state`),
    INDEX `session_recordings_state_expires_at_idx`(`state`, `expires_at`),
    UNIQUE INDEX `session_recordings_session_id_tenant_id_key`(`session_id`, `tenant_id`),
    UNIQUE INDEX `session_recordings_id_tenant_id_key`(`id`, `tenant_id`),
    PRIMARY KEY (`id`),
    -- ELLE: ikili enum'lar (ADR-0014).
    CONSTRAINT `session_recordings_basis_chk` CHECK (CAST(`basis` AS BINARY) IN ('CONSENT', 'TENANT_POLICY')),
    CONSTRAINT `session_recordings_state_chk` CHECK (CAST(`state` AS BINARY) IN ('ACTIVE', 'STOPPED', 'DELETED')),
    -- ELLE: durma nedeni ve anı ACTIVE dışında her zaman dolu, ACTIVE'de boş; durma başlangıçtan önce olamaz.
    CONSTRAINT `session_recordings_stop_chk` CHECK ((CAST(`state` AS BINARY) = 'ACTIVE') = (`stop_reason` IS NULL)
        AND (CAST(`state` AS BINARY) = 'ACTIVE') = (`stopped_at` IS NULL)
        AND (`stop_reason` IS NULL
            OR CAST(`stop_reason` AS BINARY) IN ('REVOKED', 'QUOTA', 'SESSION_END', 'ERROR', 'POLICY_OFF'))
        AND (`stopped_at` IS NULL OR `stopped_at` >= `started_at`)),
    -- ELLE (S-P28e-10, K-P28e-18): silme nedeni + anı yalnız ve her zaman DELETED'da; DELETED'da parça/bayt kalmaz.
    CONSTRAINT `session_recordings_delete_chk` CHECK ((CAST(`state` AS BINARY) = 'DELETED') = (`delete_reason` IS NOT NULL)
        AND (CAST(`state` AS BINARY) = 'DELETED') = (`deleted_at` IS NOT NULL)
        AND (`delete_reason` IS NULL OR CAST(`delete_reason` AS BINARY) IN ('EXPIRED', 'MANUAL', 'MISSING'))
        AND (CAST(`state` AS BINARY) <> 'DELETED' OR (`size_bytes` = 0 AND `part_count` = 0))),
    -- ELLE: sayaçlar (her parça ≥ 1 bayt → parça yok ⇔ bayt yok).
    CONSTRAINT `session_recordings_counters_chk` CHECK (`size_bytes` >= 0 AND (`part_count` = 0) = (`size_bytes` = 0)),
    -- ELLE: saklama 1..90 g (REC_RETENTION_MIN/MAX; ±1 dk saat payı). Ayar sonradan değişse de satırın süresi değişmez (K-P28e-22).
    CONSTRAINT `session_recordings_expires_chk` CHECK (`expires_at` >= `started_at` + INTERVAL 1 DAY - INTERVAL 1 MINUTE
        AND `expires_at` <= `started_at` + INTERVAL 90 DAY + INTERVAL 1 MINUTE),
    -- ELLE: 26 karakterlik kimlik biçimi (FK değil; audit_logs.user_id / session_stored_files.uploaded_by_user_id kalıbı).
    CONSTRAINT `session_recordings_recorder_chk` CHECK (`recorder_user_id` IS NULL
        OR REGEXP_LIKE(`recorder_user_id`, '^[0-9A-Z]{26}\\z', 'c'))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 4) session_recording_parts (§3.3). PRISMA ÜRETTİ + CHECK'ler ELLE. Append-only (updated_at yok; UPDATE grant'ı yok).
CREATE TABLE `session_recording_parts` (
    `id` CHAR(26) NOT NULL,
    `recording_id` CHAR(26) NOT NULL,
    `tenant_id` CHAR(26) NOT NULL,
    `series_no` SMALLINT UNSIGNED NOT NULL,
    `part_no` SMALLINT UNSIGNED NOT NULL,
    `offset_ms` INTEGER UNSIGNED NOT NULL,
    `duration_ms` SMALLINT UNSIGNED NOT NULL,
    `size_bytes` INTEGER UNSIGNED NOT NULL,
    `storage_rel` VARCHAR(80) NOT NULL,
    `key_ver` TINYINT UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `session_recording_parts_tenant_id_idx`(`tenant_id`),
    UNIQUE INDEX `session_recording_parts_recording_id_tenant_id_series_no_par_key`(`recording_id`, `tenant_id`, `series_no`, `part_no`),
    UNIQUE INDEX `session_recording_parts_storage_rel_key`(`storage_rel`),
    PRIMARY KEY (`id`),
    -- ELLE: 5 dk bölüm / 5 sn parça = 60 parça (K0s, K-P28e-16; REC_SERIES_MAX_PART = 59).
    CONSTRAINT `session_recording_parts_part_no_chk` CHECK (`part_no` <= 59),
    CONSTRAINT `session_recording_parts_duration_chk` CHECK (`duration_ms` BETWEEN 1 AND 15000),
    -- ELLE: REC_PART_MAX_BYTES = 2 MiB.
    CONSTRAINT `session_recording_parts_size_chk` CHECK (`size_bytes` BETWEEN 1 AND 2097152),
    -- ELLE: `{tenant_id}/{rastgele24}.rsf` (P28b kalıbı: öndek = satırın tenant'ı).
    CONSTRAINT `session_recording_parts_storage_rel_chk` CHECK (
        REGEXP_LIKE(`storage_rel`, '^[0-9A-Z]{26}/[A-Za-z0-9_-]{24}[.]rsf\\z', 'c')
        AND CAST(SUBSTRING_INDEX(`storage_rel`, '/', 1) AS BINARY) = CAST(`tenant_id` AS BINARY)),
    CONSTRAINT `session_recording_parts_key_ver_chk` CHECK (`key_ver` >= 1)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey (PRISMA ÜRETTİ) — yeni tablolar (boş; kilit yok). Önce kayıt → oturum, sonra parça → kayıt.
ALTER TABLE `session_recordings` ADD CONSTRAINT `session_recordings_session_id_tenant_id_fkey` FOREIGN KEY (`session_id`, `tenant_id`) REFERENCES `support_sessions`(`id`, `tenant_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `session_recording_parts` ADD CONSTRAINT `session_recording_parts_recording_id_tenant_id_fkey` FOREIGN KEY (`recording_id`, `tenant_id`) REFERENCES `session_recordings`(`id`, `tenant_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
