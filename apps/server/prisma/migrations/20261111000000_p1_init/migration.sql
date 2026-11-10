-- CreateTable
CREATE TABLE `tenants` (
    `id` CHAR(26) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `slug` VARCHAR(60) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `logo_path` VARCHAR(200) NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tenants_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_settings` (
    `tenant_id` CHAR(26) NOT NULL,
    `session_ttl_min` INTEGER NOT NULL DEFAULT 15,
    `max_open_sessions` INTEGER NOT NULL DEFAULT 3,
    `max_active_hours` INTEGER NOT NULL DEFAULT 4,
    `max_file_mb` INTEGER NOT NULL DEFAULT 100,
    `require_tech_2fa` BOOLEAN NOT NULL DEFAULT true,
    `retention_days` INTEGER NOT NULL DEFAULT 365,
    `smtp_host` VARCHAR(255) NULL,
    `smtp_port` INTEGER NULL,
    `smtp_security` VARCHAR(20) NULL,
    `smtp_user` VARCHAR(190) NULL,
    `smtp_pass_enc` VARBINARY(512) NULL,
    `smtp_from_name` VARCHAR(100) NULL,
    `smtp_from_email` VARCHAR(190) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tenant_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(26) NOT NULL,
    `tenant_id` CHAR(26) NULL,
    `email` VARCHAR(190) NOT NULL,
    `username` VARCHAR(60) NULL,
    `full_name` VARCHAR(100) NOT NULL,
    `role` VARCHAR(20) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `must_change_password` BOOLEAN NOT NULL DEFAULT true,
    `failed_login_count` INTEGER NOT NULL DEFAULT 0,
    `failed_window_at` DATETIME(3) NULL,
    `locked_until` DATETIME(3) NULL,
    `totp_secret_enc` VARBINARY(255) NULL,
    `totp_enabled` BOOLEAN NOT NULL DEFAULT false,
    `avatar_path` VARCHAR(200) NULL,
    `theme` VARCHAR(20) NOT NULL DEFAULT 'SYSTEM',
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_username_key`(`username`),
    INDEX `users_tenant_id_status_idx`(`tenant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_permissions` (
    `user_id` CHAR(26) NOT NULL,
    `perm_key` VARCHAR(60) NOT NULL,
    `granted` BOOLEAN NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`, `perm_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_sessions` (
    `id` CHAR(26) NOT NULL,
    `user_id` CHAR(26) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `acting_tenant_id` CHAR(26) NULL,
    `ip` VARCHAR(45) NOT NULL,
    `user_agent` VARCHAR(300) NOT NULL,
    `last_seen_at` DATETIME(3) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `mfa_passed` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `auth_sessions_token_hash_key`(`token_hash`),
    INDEX `auth_sessions_user_id_revoked_at_idx`(`user_id`, `revoked_at`),
    INDEX `auth_sessions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `tenant_id` CHAR(26) NULL,
    `user_id` CHAR(26) NULL,
    `username` VARCHAR(190) NULL,
    `action` VARCHAR(60) NOT NULL,
    `entity` VARCHAR(40) NOT NULL,
    `entity_id` VARCHAR(40) NULL,
    `old_value` JSON NULL,
    `new_value` JSON NULL,
    `ip_address` VARCHAR(45) NULL,
    `user_agent` VARCHAR(300) NULL,
    `result` VARCHAR(20) NOT NULL,
    `correlation_id` CHAR(26) NULL,

    INDEX `audit_logs_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    INDEX `audit_logs_tenant_id_user_id_created_at_idx`(`tenant_id`, `user_id`, `created_at`),
    INDEX `audit_logs_tenant_id_action_created_at_idx`(`tenant_id`, `action`, `created_at`),
    INDEX `audit_logs_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tenant_settings` ADD CONSTRAINT `tenant_settings_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `user_permissions` ADD CONSTRAINT `user_permissions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_acting_tenant_id_fkey` FOREIGN KEY (`acting_tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ELLE EKLENDİ (dba): tenant_settings aralık ve enum kısıtları, mimari §3.1. Prisma şeması CHECK
-- kısıtını ifade edemez ve MySQL'de CHECK'i karşılaştırmaz (drift oluşmaz); zod ile aynı sınırlar,
-- DB düzeyinde ikinci emniyet. Değiştirirken packages/contracts şemasıyla birlikte güncelleyin.
ALTER TABLE `tenant_settings`
    ADD CONSTRAINT `tenant_settings_session_ttl_chk` CHECK (`session_ttl_min` BETWEEN 15 AND 30),
    ADD CONSTRAINT `tenant_settings_max_open_chk` CHECK (`max_open_sessions` BETWEEN 1 AND 10),
    ADD CONSTRAINT `tenant_settings_max_active_chk` CHECK (`max_active_hours` BETWEEN 1 AND 8),
    ADD CONSTRAINT `tenant_settings_max_file_chk` CHECK (`max_file_mb` BETWEEN 1 AND 2048),
    ADD CONSTRAINT `tenant_settings_retention_chk` CHECK (`retention_days` BETWEEN 90 AND 730),
    ADD CONSTRAINT `tenant_settings_smtp_security_chk` CHECK (`smtp_security` IN ('NONE', 'SSL', 'STARTTLS'));

-- ELLE EKLENDİ (dba): VARCHAR enum alanlarının izinli değerleri (mimari §3: ENUM yerine VARCHAR).
ALTER TABLE `tenants` ADD CONSTRAINT `tenants_status_chk` CHECK (`status` IN ('ACTIVE', 'PASSIVE'));
ALTER TABLE `users`
    ADD CONSTRAINT `users_role_chk` CHECK (`role` IN ('SUPER_ADMIN', 'ADMIN', 'USER')),
    ADD CONSTRAINT `users_theme_chk` CHECK (`theme` IN ('LIGHT', 'DARK', 'SYSTEM')),
    ADD CONSTRAINT `users_status_chk` CHECK (`status` IN ('ACTIVE', 'PASSIVE')),
    -- SUPER_ADMIN tenant'sız, diğer roller tenant'lı olmak zorunda (mimari §3.1 users.tenant_id).
    ADD CONSTRAINT `users_role_tenant_chk` CHECK ((`role` = 'SUPER_ADMIN') = (`tenant_id` IS NULL));
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_result_chk` CHECK (`result` IN ('success', 'fail'));
