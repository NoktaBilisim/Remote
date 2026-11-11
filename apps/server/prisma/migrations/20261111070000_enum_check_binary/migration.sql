-- ADR-0014 (P8, dba): 14 enum CHECK'i ikili (byte, NO PAD) karşılaştırmaya çevrilir: CAST(`col` AS BINARY) IN (…).
-- Neden: sütunlar utf8mb4_unicode_ci (harf/aksan duyarsız, PAD SPACE) → eski CHECK 'tech', 'TÉCH', 'TECH ' değerlerini
-- geçiriyordu. Sütun harmanlaması, indeksler, sorgu davranışı ve Prisma şeması DEĞİŞMEZ (drift yok).
-- `BINARY expr` (8.0.27+ kullanımdan kalkıyor) ve utf8mb4_bin (PAD SPACE) bilinçli olarak kullanılmadı.
-- Eşitlik içeren diğer CHECK'ler (code_pending, ended_at, role_tenant, text_scope, terminated_by …) değişmez:
-- enum CHECK değeri kanonik kıldığı için doğru kalırlar. end_reason ve audit_logs.action'a CHECK eklenmez (ADR-0014).
--
-- ELLE YAZILDI (dba): Prisma CHECK ifade edemez.
-- Kilit: ADD CHECK = ALGORITHM=COPY → 7 tablo yeniden yazılır (tenants, tenant_settings, users, audit_logs,
-- support_sessions, session_consents, session_files). Prod açık değil (P10), staging küçük → kabul.
-- Her tablo tek ALTER (DROP CHECK x, ADD CONSTRAINT x …) — kısıtsız ara an yok, tablo başına atomik.

-- ÖN KONTROL (koruma): MySQL'de DDL transaction'a girmez; 3. tabloda ihlal çıkarsa ilk ikisi değişmiş kalırdı.
-- Bu yüzden ALTER'lardan ÖNCE kanonik olmayan satır sayılır; toplam > 0 ise geçici tablonun CHECK'i 3819
-- (`adr14_noncanonical_rows_chk`) ile migration'ı HİÇBİR ŞEY DEĞİŞMEDEN durdurur. Bu durumda satırlar elle
-- DÜZELTİLMEZ (consent satırları KVKK kanıtı) — mimara bildirilir. Ayrıntılı sayım: precheck.sql.
-- (NULL olabilen sütunlarda NULL `NOT IN` → NULL, sayılmaz; doğru.)
CREATE TEMPORARY TABLE `adr14_guard` (
    `n` BIGINT NOT NULL,
    CONSTRAINT `adr14_noncanonical_rows_chk` CHECK (`n` = 0)
);
INSERT INTO `adr14_guard` (`n`) SELECT
      (SELECT COUNT(*) FROM `tenants`          WHERE CAST(`status` AS BINARY) NOT IN ('ACTIVE', 'PASSIVE'))
    + (SELECT COUNT(*) FROM `tenant_settings`  WHERE CAST(`smtp_security` AS BINARY) NOT IN ('NONE', 'SSL', 'STARTTLS'))
    + (SELECT COUNT(*) FROM `users`            WHERE CAST(`role` AS BINARY) NOT IN ('SUPER_ADMIN', 'ADMIN', 'USER')
                                                  OR CAST(`theme` AS BINARY) NOT IN ('LIGHT', 'DARK', 'SYSTEM')
                                                  OR CAST(`status` AS BINARY) NOT IN ('ACTIVE', 'PASSIVE'))
    + (SELECT COUNT(*) FROM `audit_logs`       WHERE CAST(`result` AS BINARY) NOT IN ('success', 'fail'))
    + (SELECT COUNT(*) FROM `support_sessions` WHERE CAST(`status` AS BINARY) NOT IN ('PENDING', 'ACTIVE', 'ENDED', 'EXPIRED', 'CANCELLED')
                                                  OR CAST(`ended_by` AS BINARY) NOT IN ('TECH', 'CUSTOMER', 'ADMIN', 'SYSTEM')
                                                  OR CAST(`mode` AS BINARY) NOT IN ('AGENT', 'BROWSER'))
    + (SELECT COUNT(*) FROM `session_consents` WHERE CAST(`level` AS BINARY) NOT IN ('VIEW', 'CONTROL')
                                                  OR CAST(`decision` AS BINARY) NOT IN ('GRANTED', 'DENIED', 'REVOKED')
                                                  OR CAST(`source` AS BINARY) NOT IN ('UI', 'HOTKEY', 'RECONNECT', 'SYSTEM', 'TECH'))
    + (SELECT COUNT(*) FROM `session_files`    WHERE CAST(`direction` AS BINARY) NOT IN ('TO_CUSTOMER', 'TO_TECH')
                                                  OR CAST(`result` AS BINARY) NOT IN ('OK', 'REJECTED', 'CANCELLED', 'CORRUPT'));
DROP TEMPORARY TABLE `adr14_guard`;

ALTER TABLE `tenants`
    DROP CHECK `tenants_status_chk`,
    ADD CONSTRAINT `tenants_status_chk` CHECK (CAST(`status` AS BINARY) IN ('ACTIVE', 'PASSIVE'));

-- smtp_security NULL olabilir: CAST(NULL) IN (…) = NULL → CHECK geçer (eski davranışla aynı; açık yazıldı).
ALTER TABLE `tenant_settings`
    DROP CHECK `tenant_settings_smtp_security_chk`,
    ADD CONSTRAINT `tenant_settings_smtp_security_chk` CHECK (`smtp_security` IS NULL OR CAST(`smtp_security` AS BINARY) IN ('NONE', 'SSL', 'STARTTLS'));

ALTER TABLE `users`
    DROP CHECK `users_role_chk`,
    DROP CHECK `users_theme_chk`,
    DROP CHECK `users_status_chk`,
    ADD CONSTRAINT `users_role_chk` CHECK (CAST(`role` AS BINARY) IN ('SUPER_ADMIN', 'ADMIN', 'USER')),
    ADD CONSTRAINT `users_theme_chk` CHECK (CAST(`theme` AS BINARY) IN ('LIGHT', 'DARK', 'SYSTEM')),
    ADD CONSTRAINT `users_status_chk` CHECK (CAST(`status` AS BINARY) IN ('ACTIVE', 'PASSIVE'));

ALTER TABLE `audit_logs`
    DROP CHECK `audit_logs_result_chk`,
    ADD CONSTRAINT `audit_logs_result_chk` CHECK (CAST(`result` AS BINARY) IN ('success', 'fail'));

ALTER TABLE `support_sessions`
    DROP CHECK `support_sessions_status_chk`,
    DROP CHECK `support_sessions_ended_by_chk`,
    DROP CHECK `support_sessions_mode_chk`,
    ADD CONSTRAINT `support_sessions_status_chk` CHECK (CAST(`status` AS BINARY) IN ('PENDING', 'ACTIVE', 'ENDED', 'EXPIRED', 'CANCELLED')),
    ADD CONSTRAINT `support_sessions_ended_by_chk` CHECK (`ended_by` IS NULL OR CAST(`ended_by` AS BINARY) IN ('TECH', 'CUSTOMER', 'ADMIN', 'SYSTEM')),
    ADD CONSTRAINT `support_sessions_mode_chk` CHECK (`mode` IS NULL OR CAST(`mode` AS BINARY) IN ('AGENT', 'BROWSER'));

ALTER TABLE `session_consents`
    DROP CHECK `session_consents_level_chk`,
    DROP CHECK `session_consents_decision_chk`,
    DROP CHECK `session_consents_source_chk`,
    ADD CONSTRAINT `session_consents_level_chk` CHECK (CAST(`level` AS BINARY) IN ('VIEW', 'CONTROL')),
    ADD CONSTRAINT `session_consents_decision_chk` CHECK (CAST(`decision` AS BINARY) IN ('GRANTED', 'DENIED', 'REVOKED')),
    ADD CONSTRAINT `session_consents_source_chk` CHECK (CAST(`source` AS BINARY) IN ('UI', 'HOTKEY', 'RECONNECT', 'SYSTEM', 'TECH'));

ALTER TABLE `session_files`
    DROP CHECK `session_files_direction_chk`,
    DROP CHECK `session_files_result_chk`,
    ADD CONSTRAINT `session_files_direction_chk` CHECK (CAST(`direction` AS BINARY) IN ('TO_CUSTOMER', 'TO_TECH')),
    ADD CONSTRAINT `session_files_result_chk` CHECK (CAST(`result` AS BINARY) IN ('OK', 'REJECTED', 'CANCELLED', 'CORRUPT'));
