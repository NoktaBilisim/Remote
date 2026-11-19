-- GERİ ALMA (elle, dba) — 20261126000000_p22_session_chat. Prisma bu dosyayı ÇALIŞTIRMAZ. Önce P22 sunucu kodu geri alınmalı
-- (oturum sohbeti yazımı UQ ihlalini (P2002) idempotent yankı sayar; UQ'suz eski kodla yeniden gönderim çift satır üretir).
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261126000000_p22_session_chat/down.sql
-- Koruma gerekmez: yalnız indeks kalkar, VERİ SİLİNMEZ (oturum sohbet satırları retention'a kadar kalır). Kalıcı kayıp yok.
-- Kilit: ikincil indeks DROP → INPLACE, LOCK=NONE (metadata).
DROP PROCEDURE IF EXISTS `p22_precheck`;

ALTER TABLE `session_messages`
    DROP INDEX `session_messages_session_client_key`,
    ALGORITHM=INPLACE, LOCK=NONE;

DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261126000000_p22_session_chat';
