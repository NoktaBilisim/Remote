-- CreateTable
CREATE TABLE `support_sessions` (
    `id` CHAR(26) NOT NULL,
    `tenant_id` CHAR(26) NOT NULL,
    `technician_id` CHAR(26) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `active_code` CHAR(8) NULL,
    `tech_verify_code` CHAR(4) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `expires_at` DATETIME(3) NOT NULL,
    `ended_at` DATETIME(3) NULL,
    `ended_by` VARCHAR(20) NULL,
    `end_reason` VARCHAR(40) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `support_sessions_token_hash_key`(`token_hash`),
    UNIQUE INDEX `support_sessions_active_code_key`(`active_code`),
    INDEX `support_sessions_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    INDEX `support_sessions_technician_id_status_idx`(`technician_id`, `status`),
    INDEX `support_sessions_technician_id_created_at_idx`(`technician_id`, `created_at`),
    INDEX `support_sessions_status_expires_at_idx`(`status`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `support_sessions` ADD CONSTRAINT `support_sessions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `support_sessions` ADD CONSTRAINT `support_sessions_technician_id_fkey` FOREIGN KEY (`technician_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;


-- ELLE EKLENDİ (dba): support_sessions CHECK kısıtları (mimari §3.1, AC-3/4/5/8, ADR-0006, G-22).
-- Prisma CHECK ifade edemez ve MySQL'de karşılaştırmaz (drift oluşmaz). zod/servis kurallarının
-- DB düzeyindeki ikinci emniyetidir; değiştirirken packages/contracts şemasıyla birlikte güncelleyin.
ALTER TABLE `support_sessions`
    ADD CONSTRAINT `support_sessions_status_chk` CHECK (`status` IN ('PENDING', 'ACTIVE', 'ENDED', 'EXPIRED', 'CANCELLED')),
    ADD CONSTRAINT `support_sessions_ended_by_chk` CHECK (`ended_by` IS NULL OR `ended_by` IN ('TECH', 'CUSTOMER', 'ADMIN', 'SYSTEM')),
    ADD CONSTRAINT `support_sessions_active_code_fmt_chk` CHECK (`active_code` IS NULL OR REGEXP_LIKE(`active_code`, '^[0-9]{8}$', 'c')),
    ADD CONSTRAINT `support_sessions_verify_code_fmt_chk` CHECK (REGEXP_LIKE(`tech_verify_code`, '^[0-9]{4}$', 'c')),
    ADD CONSTRAINT `support_sessions_token_hash_fmt_chk` CHECK (REGEXP_LIKE(`token_hash`, '^[0-9a-f]{64}$', 'c')),
    -- Kod yalnız PENDING iken dolu; PENDING dışına her geçişte aynı UPDATE'te NULL yapılmalı (G-22).
    ADD CONSTRAINT `support_sessions_code_pending_chk` CHECK ((`status` = 'PENDING') = (`active_code` IS NOT NULL)),
    -- Bitmiş durumlar (ENDED/EXPIRED/CANCELLED) ended_at taşır; PENDING/ACTIVE taşımaz.
    ADD CONSTRAINT `support_sessions_ended_at_chk` CHECK ((`status` IN ('ENDED', 'EXPIRED', 'CANCELLED')) = (`ended_at` IS NOT NULL)),
    -- TTL 15..30 dk (AC-4). created_at DB/istemci saatinden, expires_at servisten gelir: +/-1 dk tolerans.
    ADD CONSTRAINT `support_sessions_ttl_chk` CHECK (`expires_at` BETWEEN `created_at` + INTERVAL 14 MINUTE AND `created_at` + INTERVAL 31 MINUTE);
