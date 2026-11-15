-- GERİ ALMA (elle, dba) — 20261122000000_link_send. Prisma bu dosyayı ÇALIŞTIRMAZ. Önce LG sunucu kodu geri alınmalı
-- (belirteç yazımı / sent_count artışı / public indirme ucu). Koruma yok: kayıp yalnız bekleyen kodların indirme bağlantısı
-- ve K2 gönderim sayaçlarıdır (mimari §3 "Rollback": kabul edilir); kodlar geçerli kalır.
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261122000000_link_send/down.sql
-- Kilit: DROP CHECK + DROP COLUMN → COPY (tek ALTER; tablo küçük).
ALTER TABLE `unattended_registration_codes`
    DROP CHECK `unattended_registration_codes_sent_count_chk`,
    DROP CHECK `unattended_registration_codes_download_token_hash_chk`,
    DROP INDEX `unattended_registration_codes_download_token_hash_key`,
    DROP COLUMN `sent_count`,
    DROP COLUMN `download_token_hash`;

DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261122000000_link_send';
