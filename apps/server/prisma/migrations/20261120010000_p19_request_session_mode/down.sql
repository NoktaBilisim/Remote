-- GERİ ALMA (elle, dba) — 20261120010000_p19_request_session_mode. Prisma bu dosyayı ÇALIŞTIRMAZ. Önce P19 J2 sunucu
-- kodu geri alınmalı (web talebini BROWSER modunda kabul eden yol). Sıra: bu dosya, SONRA 20261120000000_p19_web_requests
-- down.sql (ters sıra).
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261120010000_p19_request_session_mode/down.sql
-- Koruma: talebe bağlı BROWSER oturumu (`request_id IS NOT NULL AND mode='BROWSER'`) varsa ADD CONSTRAINT hiçbir şey
-- değişmeden 3819 ile durur (veri kaybı yok; bu oturumlar oturum geçmişidir, silinmez — kod geri alınmadan down yapılmaz).
-- Kilit: CHECK eklemek 8.4'te COPY (tablo yeniden yazılır; süresince support_sessions yazımı bekler).
-- dba düzeltmesi (2026-11-15): migration kaydı silinmiyordu → yeniden `migrate deploy` bu migration'ı atlıyor, şema
-- kayıtla çelişiyordu (diğer 22 down.sql ile aynı desen eklendi).
ALTER TABLE `support_sessions`
    ADD CONSTRAINT `support_sessions_request_mode_chk` CHECK (`request_id` IS NULL OR `mode` IS NULL OR `mode` = 'AGENT');

DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261120010000_p19_request_session_mode';
