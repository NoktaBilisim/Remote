-- GERİ ALMA (elle, dba) — 20261124000000_p28u_unattended_consent. Prisma bu dosyayı ÇALIŞTIRMAZ. Önce: UNATTENDED_MODE=off,
-- açık gözetimsiz oturumların bitmesi, P28u sunucu kodunun (connect-tx 150 sn, consentMode yazımı) geri alınması
-- (runbook "Gözetimsiz erişim"). Sonra precheck.sql (koruma satırları 0 olmalı).
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261124000000_p28u_unattended_consent/down.sql
-- Koruma (hiçbir şey değişmeden 3819 ile durur): p28u_down_guard_chk — 65 sn'den uzun pencereli talepsiz cihaz/anonim oturum
-- (eski TTL CHECK'ine sığmaz; oturum geçmişi silinmez/değiştirilmez) ya da açık (PENDING/ACTIVE) kipli oturum var.
-- Kalıcı kayıp (guard'sız, bilinçli): bitmiş oturumların consent_mode / silent_reason değeri ve firma politika anahtarı + aydınlatma
-- izi. Kopyaları audit_logs'ta (unattended.connect / unattended.session.started / unattended.policy) 730 gün kalır.
-- Kilit: support_sessions tek COPY ALTER; tenant_settings küçük.
CREATE TEMPORARY TABLE `p28u_down_guard` (`n` BIGINT NOT NULL, CONSTRAINT `p28u_down_guard_chk` CHECK (`n` = 0));
INSERT INTO `p28u_down_guard` (`n`) SELECT
      (SELECT COUNT(*) FROM `support_sessions` WHERE `request_id` IS NULL
            AND (`device_id` IS NOT NULL OR `anonymized_at` IS NOT NULL)
            AND TIMESTAMPDIFF(SECOND, `created_at`, `expires_at`) > 65)
    + (SELECT COUNT(*) FROM `support_sessions` WHERE `consent_mode` IS NOT NULL AND `status` IN ('PENDING', 'ACTIVE'));
DROP TEMPORARY TABLE `p28u_down_guard`;

-- support_sessions: P28b sonrası hâl (P27 ttl/anonymized tanımları birebir).
ALTER TABLE `support_sessions`
    DROP CHECK `support_sessions_consent_mode_chk`,
    DROP CHECK `support_sessions_consent_mode_dev_chk`,
    DROP CHECK `support_sessions_silent_reason_chk`,
    DROP CHECK `support_sessions_ttl_chk`,
    DROP CHECK `support_sessions_anonymized_chk`,
    ADD CONSTRAINT `support_sessions_ttl_chk` CHECK (
        (`request_id` IS NULL AND `device_id` IS NULL
            AND `expires_at` BETWEEN `created_at` + INTERVAL 14 MINUTE AND `created_at` + INTERVAL 31 MINUTE)
        OR ((`request_id` IS NOT NULL OR `device_id` IS NOT NULL OR `anonymized_at` IS NOT NULL)
            AND TIMESTAMPDIFF(SECOND, `created_at`, `expires_at`) BETWEEN 55 AND 65)),
    ADD CONSTRAINT `support_sessions_anonymized_chk` CHECK (`anonymized_at` IS NULL
        OR (`status` IN ('ENDED', 'EXPIRED', 'CANCELLED')
            AND `customer_name` IS NULL AND `customer_email` IS NULL AND `note` IS NULL
            AND `guest_net_key` IS NULL AND `guest_ip_key` IS NULL AND `device_id` IS NULL)),
    DROP COLUMN `consent_mode`,
    DROP COLUMN `silent_reason`,
    ALGORITHM=COPY;

ALTER TABLE `tenant_settings`
    DROP FOREIGN KEY `tenant_settings_unattended_silent_ack_by_fkey`,
    DROP CHECK `tenant_settings_silent_ack_chk`,
    DROP INDEX `tenant_settings_unattended_silent_ack_by_idx`,
    DROP COLUMN `unattended_silent_ack_at`,
    DROP COLUMN `unattended_silent_ack_by`,
    DROP COLUMN `unattended_silent_enabled`;

DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261124000000_p28u_unattended_consent';
