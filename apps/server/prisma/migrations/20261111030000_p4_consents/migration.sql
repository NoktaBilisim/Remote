-- P4 (mimari §3.1, mimari-akislar A1, mimari-api join, AC-29/62/111/127, G-24): KVKK aydınlatma metni
-- (tenant bazlı, sürümlü, değişmez) + oturum onay zaman çizelgesi.
-- Kilitleme notu: iki YENİ tablo (boş) — kilit yok. support_sessions'a UQ(id, tenant_id) eklenmesi
-- MySQL 8.4'te INPLACE/LOCK=NONE (ikincil indeks); tablo küçük, PK zaten tekil olduğundan ihlal üretmez.
-- Veri taşıma yok: başlangıç metni (v1) seed'de, idempotent (her tenant için yoksa) — prisma/seed.ts.

-- CreateTable
CREATE TABLE `consent_texts` (
    `id` CHAR(26) NOT NULL,
    `tenant_id` CHAR(26) NOT NULL,
    `version` INTEGER NOT NULL,
    `body` MEDIUMTEXT NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `is_current` BOOLEAN NOT NULL DEFAULT false,
    `created_by` CHAR(26) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `consent_texts_created_by_idx`(`created_by`),
    UNIQUE INDEX `consent_texts_tenant_id_version_key`(`tenant_id`, `version`),
    UNIQUE INDEX `consent_texts_id_tenant_id_sha256_key`(`id`, `tenant_id`, `sha256`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `session_consents` (
    `id` CHAR(26) NOT NULL,
    `session_id` CHAR(26) NOT NULL,
    `tenant_id` CHAR(26) NOT NULL,
    `level` VARCHAR(20) NOT NULL,
    `decision` VARCHAR(20) NOT NULL,
    `source` VARCHAR(20) NOT NULL,
    `consent_text_id` CHAR(26) NULL,
    `consent_sha256` CHAR(64) NULL,
    `ip` VARCHAR(45) NULL,
    `user_agent` VARCHAR(300) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `session_consents_session_id_tenant_id_created_at_idx`(`session_id`, `tenant_id`, `created_at`),
    INDEX `session_consents_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    INDEX `session_consents_consent_text_id_tenant_id_consent_sha256_idx`(`consent_text_id`, `tenant_id`, `consent_sha256`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `support_sessions_id_tenant_id_key` ON `support_sessions`(`id`, `tenant_id`);

-- AddForeignKey
ALTER TABLE `consent_texts` ADD CONSTRAINT `consent_texts_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `consent_texts` ADD CONSTRAINT `consent_texts_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `session_consents` ADD CONSTRAINT `session_consents_session_id_tenant_id_fkey` FOREIGN KEY (`session_id`, `tenant_id`) REFERENCES `support_sessions`(`id`, `tenant_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `session_consents` ADD CONSTRAINT `session_consents_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `session_consents` ADD CONSTRAINT `session_consents_consent_text_id_tenant_id_consent_sha256_fkey` FOREIGN KEY (`consent_text_id`, `tenant_id`, `consent_sha256`) REFERENCES `consent_texts`(`id`, `tenant_id`, `sha256`) ON DELETE RESTRICT ON UPDATE RESTRICT;


-- ELLE EKLENDİ (dba): Prisma CHECK ve fonksiyonel indeks ifade edemez; MySQL drift'inde karşılaştırılmaz.
-- Not: CHECK ifadesi NULL dönerse geçer; NULL olabilen sütunlar IS [NOT] NULL ile yazıldı.
ALTER TABLE `consent_texts`
    ADD CONSTRAINT `consent_texts_version_chk` CHECK (`version` >= 1),
    -- Özet gövdeye bağlı (AC-127 kanıtı): uygulama SHA-256(UTF-8 body) küçük harf hex yazmalı.
    ADD CONSTRAINT `consent_texts_sha256_chk` CHECK (`sha256` = SHA2(`body`, 256)),
    ADD CONSTRAINT `consent_texts_body_len_chk` CHECK (CHAR_LENGTH(`body`) BETWEEN 1 AND 20000);

-- Tenant başına en fazla bir güncel sürüm (G-24 "is_current" tekil olmalı). is_current=0 satırlar NULL
-- üretir (MySQL UQ'da NULL tekil sayılmaz). Fonksiyonel anahtar: MySQL >= 8.0.13.
CREATE UNIQUE INDEX `consent_texts_one_current_uq` ON `consent_texts` ((IF(`is_current`, `tenant_id`, NULL)));

ALTER TABLE `session_consents`
    ADD CONSTRAINT `session_consents_level_chk` CHECK (`level` IN ('VIEW', 'CONTROL')),
    ADD CONSTRAINT `session_consents_decision_chk` CHECK (`decision` IN ('GRANTED', 'DENIED', 'REVOKED')),
    ADD CONSTRAINT `session_consents_source_chk` CHECK (`source` IN ('UI', 'HOTKEY', 'RECONNECT', 'SYSTEM')),
    -- Metin kimliği ve özeti birlikte (bileşik FK yalnız ikisi de doluyken denetlenir — MATCH SIMPLE).
    ADD CONSTRAINT `session_consents_text_pair_chk` CHECK ((`consent_text_id` IS NULL) = (`consent_sha256` IS NULL)),
    -- Metin onayı yalnız görüntüleme izninin verilmesinde anlamlıdır (A1: VIEW/GRANTED, join anındaki onay).
    ADD CONSTRAINT `session_consents_text_scope_chk` CHECK (`consent_text_id` IS NULL OR (`level` = 'VIEW' AND `decision` = 'GRANTED'));
