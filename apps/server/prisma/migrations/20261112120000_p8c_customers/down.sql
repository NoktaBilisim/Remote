-- GERİ ALMA (elle, dba) — 20261112120000_p8c_customers. Prisma bu dosyayı ÇALIŞTIRMAZ.
-- Uyarı: customers, request_refs, device_bindings tablolarını VE VERİSİNİ, talep/oturumların müşteri bağını
-- (support_requests.customer_id/binding_id, support_sessions.customer_id) siler. Müşteri dosyaları ve bilgisayar kayıtları
-- geçersizleşir (0.10.0 istemci eski sunucuda 404 alıp kaydını siler — mimari-e10 §10). Önce yedek alın (docs/runbook.md).
-- P8c sunucu kodu önce geri alınmalıdır.
-- Koruma: cancel_reason CHECK eski listeye döner → CUSTOMER_PASSIVE / BINDING_REVOKED nedenli talep varsa eski CHECK
-- yazılamaz; geçici tablo CHECK'i 3819 (`p8c_down_guard_chk`) ile HİÇBİR ŞEY DEĞİŞMEDEN durur. Bu satırlar talep
-- geçmişidir: silmeyin/düzenlemeyin, mimara bildirin (P8b kalıbı).
-- Çalıştırma (migrator):
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261112120000_p8c_customers/down.sql
CREATE TEMPORARY TABLE `p8c_down_guard` (`n` BIGINT NOT NULL, CONSTRAINT `p8c_down_guard_chk` CHECK (`n` = 0));
INSERT INTO `p8c_down_guard` (`n`)
    SELECT COUNT(*) FROM `support_requests` WHERE `cancel_reason` IN ('CUSTOMER_PASSIVE', 'BINDING_REVOKED');
DROP TEMPORARY TABLE `p8c_down_guard`;

-- Yetkiler (MySQL tablo düşünce tablo yetkisini silmez).
REVOKE IF EXISTS ALL PRIVILEGES ON `customers` FROM 'app'@'%';
REVOKE IF EXISTS ALL PRIVILEGES ON `request_refs` FROM 'app'@'%';
REVOKE IF EXISTS ALL PRIVILEGES ON `device_bindings` FROM 'app'@'%';

-- (5) support_sessions
ALTER TABLE `support_sessions` DROP FOREIGN KEY `support_sessions_tenant_id_customer_id_fkey`;
DROP INDEX `support_sessions_tenant_id_customer_id_created_at_idx` ON `support_sessions`;
ALTER TABLE `support_sessions` DROP COLUMN `customer_id`;

-- (4) support_requests
ALTER TABLE `support_requests` DROP FOREIGN KEY `support_requests_tenant_id_customer_id_fkey`;
ALTER TABLE `support_requests` DROP FOREIGN KEY `support_requests_binding_id_tenant_id_fkey`;
DROP INDEX `support_requests_tenant_id_customer_id_created_at_idx` ON `support_requests`;
DROP INDEX `support_requests_binding_id_tenant_id_status_idx` ON `support_requests`;
ALTER TABLE `support_requests`
    DROP CHECK `support_requests_cancel_reason_chk`,
    ADD CONSTRAINT `support_requests_cancel_reason_chk` CHECK (`cancel_reason` IS NULL OR CAST(`cancel_reason` AS BINARY) IN ('CUSTOMER', 'DISCONNECTED', 'TENANT_PASSIVE')),
    DROP COLUMN `customer_id`,
    DROP COLUMN `binding_id`;

-- (3)(2)(1) yeni tablolar (FK sırası: device_bindings, request_refs → customers).
DROP TABLE `device_bindings`;
DROP TABLE `request_refs`;
DROP TABLE `customers`;

-- Not: seed'in eklediği aydınlatma metni yeni sürümü kalır (consent_texts değişmez kayıttır; P4 şemasıyla uyumlu).
DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261112120000_p8c_customers';
