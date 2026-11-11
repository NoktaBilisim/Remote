-- P5 (mimari §3.1, mimari-protokol `file.meta` / `quality.summary`, AC-46, AC-53..55): dosya transferi meta
-- kaydı + oturum kalite özeti. Dosya İÇERİĞİ hiçbir tabloda yoktur (AC-55: yalnız ad, boyut, SHA-256, yön, sonuç).
-- Kilitleme notu: session_files YENİ (boş) tablo — kilit yok. support_sessions'a NULL'lı JSON sütun
-- MySQL 8.4'te INSTANT; CHECK eklemek tabloyu kopyalar (COPY) — tablo küçük (oturum başına 1 satır,
-- retention'lı), mevcut satırlarda quality_summary NULL olduğundan CHECK ihlal üretmez. Büyük tabloda
-- yapılacak olsaydı bakım penceresinde veya pt-online-schema-change ile adımlanmalıydı.
-- Veri taşıma yok; seed değişmez (dosya/kalite kaydı canlı oturumdan gelir).

-- AlterTable
ALTER TABLE `support_sessions` ADD COLUMN `quality_summary` JSON NULL;

-- CreateTable
CREATE TABLE `session_files` (
    `id` CHAR(26) NOT NULL,
    `session_id` CHAR(26) NOT NULL,
    `tenant_id` CHAR(26) NOT NULL,
    `direction` VARCHAR(20) NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `size_bytes` BIGINT NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `result` VARCHAR(20) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `session_files_session_id_tenant_id_created_at_idx`(`session_id`, `tenant_id`, `created_at`),
    INDEX `session_files_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `session_files` ADD CONSTRAINT `session_files_session_id_tenant_id_fkey` FOREIGN KEY (`session_id`, `tenant_id`) REFERENCES `support_sessions`(`id`, `tenant_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `session_files` ADD CONSTRAINT `session_files_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;


-- ELLE EKLENDİ (dba): Prisma CHECK ifade edemez; MySQL drift'inde karşılaştırılmaz (`migrate diff --exit-code` 0).
-- Not: CHECK ifadesi NULL dönerse geçer; NULL olabilen sütunlar IS [NOT] NULL ile yazıldı.
ALTER TABLE `session_files`
    ADD CONSTRAINT `session_files_direction_chk` CHECK (`direction` IN ('TO_CUSTOMER', 'TO_TECH')),
    ADD CONSTRAINT `session_files_result_chk` CHECK (`result` IN ('OK', 'REJECTED', 'CANCELLED', 'CORRUPT')),
    -- Protokol: sha256 /^[a-f0-9]{64}$/ (küçük harf; 'c' = büyük/küçük harf duyarlı, unicode_ci'ye rağmen).
    ADD CONSTRAINT `session_files_sha256_fmt_chk` CHECK (REGEXP_LIKE(`sha256`, '^[0-9a-f]{64}$', 'c')),
    -- 0 baytlık dosya geçerli; üst sınır tenant_settings.max_file_mb'nin tavanı 2048 MiB (= 2147483648 B).
    -- Tenant'a özgü sınır (vars. 100 MB) servis katmanında (AC-53); DB yalnız mutlak tavanı tutar.
    ADD CONSTRAINT `session_files_size_chk` CHECK (`size_bytes` BETWEEN 0 AND 2147483648),
    -- file_name = sanitizeFileName çıktısı (mimari-protokol §4.2 G-06 madde 1): boş değil, \ / : * ? " < > |,
    -- U+0000..U+001F ve Unicode Cf (RTLO U+202E dahil) içermez, sonda nokta/boşluk yok. Ham (temizlenmemiş)
    -- ad yazılırsa 3819 döner → oturum detayında/dışa aktarımda yanıltıcı ad (RTLO) görünmesi DB'de engellenir.
    -- MySQL string kaçışı: '\\\\' → ICU'da tek ters bölü; '\\x{00}' → U+0000; '\\p{Cf}' → Cf kategorisi.
    ADD CONSTRAINT `session_files_file_name_chk` CHECK (
        CHAR_LENGTH(`file_name`) BETWEEN 1 AND 255
        AND NOT REGEXP_LIKE(`file_name`, '[\\\\/:*?"<>|\\x{00}-\\x{1F}\\p{Cf}]', 'c')
        AND NOT REGEXP_LIKE(`file_name`, '[. ]$', 'c')
    );

-- quality_summary (AC-46): JSON nesne, en çok 4 KB (beklenen ~200 B; periyodik 60 sn UPDATE'te şişme
-- olmasın), yalnız tüketilmiş (admit edilmiş, consumed_at dolu) oturumda — medya hiç akmamışsa özet yoktur.
ALTER TABLE `support_sessions`
    ADD CONSTRAINT `support_sessions_quality_summary_chk` CHECK (
        `quality_summary` IS NULL
        OR (JSON_TYPE(`quality_summary`) = 'OBJECT'
            AND JSON_STORAGE_SIZE(`quality_summary`) <= 4096
            AND `consumed_at` IS NOT NULL)
    );
