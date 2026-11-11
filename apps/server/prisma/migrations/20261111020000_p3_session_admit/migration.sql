-- P3 (mimari §3.1, mimari-akislar A1/A2/A5, ADR-0006 adım 4, G-04): admit tüketimi + zorla sonlandırma.
-- Kilitleme notu: ADD COLUMN (NULL) MySQL 8.4'te INSTANT; CHECK/FK ekleme tablo kopyalar (COPY) —
-- support_sessions küçük (oturum başına 1 satır, retention'lı); P3 öncesi ACTIVE satır yoktur
-- (P2 admit yapmaz), dolayısıyla yeni CHECK'ler mevcut veride ihlal üretmez.

-- AlterTable
ALTER TABLE `support_sessions` ADD COLUMN `consumed_at` DATETIME(3) NULL,
    ADD COLUMN `mode` VARCHAR(20) NULL,
    ADD COLUMN `terminated_by` CHAR(26) NULL;

-- CreateIndex
CREATE INDEX `support_sessions_terminated_by_idx` ON `support_sessions`(`terminated_by`);

-- AddForeignKey
ALTER TABLE `support_sessions` ADD CONSTRAINT `support_sessions_terminated_by_fkey` FOREIGN KEY (`terminated_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;


-- ELLE EKLENDİ (dba): P3 CHECK kısıtları. Prisma CHECK ifade edemez, MySQL'de karşılaştırmaz (drift yok).
-- Gereksinimler §9 "P3 giriş şartı 2": admit tek atomik
--   UPDATE ... SET status='ACTIVE', active_code=NULL, consumed_at=?, mode=?
--   WHERE id=? AND status='PENDING' AND expires_at > ?
-- Bu kısıtlar o UPDATE'in eksik yazılmasını (kod NULL'lanmadan / tüketim zamanı olmadan ACTIVE) DB'de reddeder.
-- Not: CHECK ifadesi NULL dönerse geçer; bu yüzden NULL olabilen sütunlar IS [NOT] NULL / COALESCE ile yazıldı.
ALTER TABLE `support_sessions`
    ADD CONSTRAINT `support_sessions_mode_chk` CHECK (`mode` IS NULL OR `mode` IN ('AGENT', 'BROWSER')),
    -- Tüketim ve mod birlikte, admit anında yazılır (A1: consumed_at, ACTIVE, active_code=NULL, mode).
    ADD CONSTRAINT `support_sessions_consumed_mode_chk` CHECK ((`consumed_at` IS NULL) = (`mode` IS NULL)),
    -- ACTIVE yalnız admit ile (AC-6/7); PENDING/EXPIRED/CANCELLED hiç tüketilmemiştir. ENDED iki yoldan
    -- gelebilir (ACTIVE'den bitiş veya teknisyen yetki iptali vb. ile bekleyen oturumun kapanması) → serbest.
    ADD CONSTRAINT `support_sessions_consumed_status_chk` CHECK (
        (`status` <> 'ACTIVE' OR `consumed_at` IS NOT NULL)
        AND (`status` NOT IN ('PENDING', 'EXPIRED', 'CANCELLED') OR `consumed_at` IS NULL)),
    -- Süresi dolmuş oturum tüketilemez (AC-5/AC-6, giriş şartı 2'nin DB emniyeti).
    ADD CONSTRAINT `support_sessions_consumed_before_expiry_chk` CHECK (`consumed_at` IS NULL OR `consumed_at` <= `expires_at`),
    -- Zorla sonlandırma (G-04, AC-114): ended_by='ADMIN' <=> terminated_by dolu ve oturum ENDED.
    ADD CONSTRAINT `support_sessions_terminated_by_chk` CHECK (
        (COALESCE(`ended_by`, '') = 'ADMIN') = (`terminated_by` IS NOT NULL)
        AND (`terminated_by` IS NULL OR `status` = 'ENDED'));
