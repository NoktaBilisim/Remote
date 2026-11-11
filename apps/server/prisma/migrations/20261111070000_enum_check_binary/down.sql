-- GERİ ALMA (elle, dba) — 20261111070000_enum_check_binary. Prisma bu dosyayı ÇALIŞTIRMAZ.
-- 14 enum CHECK'i eski utf8mb4_unicode_ci biçimine (`col` IN (…)) döndürür. Genişletme yönünde → mevcut veri
-- her zaman uyar; veri değişmez. Sonuç: harf/aksan/sondaki boşluk farkı yine DB'de kabul edilir (ADR-0014 öncesi).
-- Kilit: 7 tablo COPY ile yeniden yazılır. P8 session_history'den önce geri alınmalıdır (ters sıra).
-- Çalıştırma (migrator):
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261111070000_enum_check_binary/down.sql
ALTER TABLE `tenants`
    DROP CHECK `tenants_status_chk`,
    ADD CONSTRAINT `tenants_status_chk` CHECK (`status` IN ('ACTIVE', 'PASSIVE'));
ALTER TABLE `tenant_settings`
    DROP CHECK `tenant_settings_smtp_security_chk`,
    ADD CONSTRAINT `tenant_settings_smtp_security_chk` CHECK (`smtp_security` IN ('NONE', 'SSL', 'STARTTLS'));
ALTER TABLE `users`
    DROP CHECK `users_role_chk`,
    DROP CHECK `users_theme_chk`,
    DROP CHECK `users_status_chk`,
    ADD CONSTRAINT `users_role_chk` CHECK (`role` IN ('SUPER_ADMIN', 'ADMIN', 'USER')),
    ADD CONSTRAINT `users_theme_chk` CHECK (`theme` IN ('LIGHT', 'DARK', 'SYSTEM')),
    ADD CONSTRAINT `users_status_chk` CHECK (`status` IN ('ACTIVE', 'PASSIVE'));
ALTER TABLE `audit_logs`
    DROP CHECK `audit_logs_result_chk`,
    ADD CONSTRAINT `audit_logs_result_chk` CHECK (`result` IN ('success', 'fail'));
ALTER TABLE `support_sessions`
    DROP CHECK `support_sessions_status_chk`,
    DROP CHECK `support_sessions_ended_by_chk`,
    DROP CHECK `support_sessions_mode_chk`,
    ADD CONSTRAINT `support_sessions_status_chk` CHECK (`status` IN ('PENDING', 'ACTIVE', 'ENDED', 'EXPIRED', 'CANCELLED')),
    ADD CONSTRAINT `support_sessions_ended_by_chk` CHECK (`ended_by` IS NULL OR `ended_by` IN ('TECH', 'CUSTOMER', 'ADMIN', 'SYSTEM')),
    ADD CONSTRAINT `support_sessions_mode_chk` CHECK (`mode` IS NULL OR `mode` IN ('AGENT', 'BROWSER'));
ALTER TABLE `session_consents`
    DROP CHECK `session_consents_level_chk`,
    DROP CHECK `session_consents_decision_chk`,
    DROP CHECK `session_consents_source_chk`,
    ADD CONSTRAINT `session_consents_level_chk` CHECK (`level` IN ('VIEW', 'CONTROL')),
    ADD CONSTRAINT `session_consents_decision_chk` CHECK (`decision` IN ('GRANTED', 'DENIED', 'REVOKED')),
    ADD CONSTRAINT `session_consents_source_chk` CHECK (`source` IN ('UI', 'HOTKEY', 'RECONNECT', 'SYSTEM', 'TECH'));
ALTER TABLE `session_files`
    DROP CHECK `session_files_direction_chk`,
    DROP CHECK `session_files_result_chk`,
    ADD CONSTRAINT `session_files_direction_chk` CHECK (`direction` IN ('TO_CUSTOMER', 'TO_TECH')),
    ADD CONSTRAINT `session_files_result_chk` CHECK (`result` IN ('OK', 'REJECTED', 'CANCELLED', 'CORRUPT'));

-- Migration kaydını kaldır (geri alma tamamlandı).
DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261111070000_enum_check_binary';
