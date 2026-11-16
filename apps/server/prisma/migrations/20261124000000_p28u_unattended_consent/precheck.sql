-- P28u GERİ ALMA ön kontrolü (yalnız okuma; Prisma bu dosyayı ÇALIŞTIRMAZ). down.sql'den ÖNCE migrator ile çalıştırın:
--   docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_MIGRATOR_PASSWORD" mysql -umigrator remote' < precheck.sql
-- "KORUMA" satırları 0 olmalı; değilse down.sql `p28u_down_guard_chk` (3819) ile hiçbir şey değiştirmeden durur. Satırları
-- SİLMEYİN/DÜZENLEMEYİN (oturum geçmişi): önce UNATTENDED_MODE=off + açık oturumların bitmesi (runbook). 150 sn'lik `ask`
-- oturumu bir kez açıldıysa satır saklama + 30 g kalıcı silmeye kadar kalır → şema geri alınmaz, ileri düzeltme yapılır (mimara).
-- "BİLGİ" satırları geri almada kaybolacak değerlerdir (audit kopyası 730 g kalır).
SELECT 'KORUMA: talepsiz oturum penceresi > 65 sn' AS kontrol, COUNT(*) AS n FROM `support_sessions`
    WHERE `request_id` IS NULL AND (`device_id` IS NOT NULL OR `anonymized_at` IS NOT NULL)
      AND TIMESTAMPDIFF(SECOND, `created_at`, `expires_at`) > 65
UNION ALL SELECT 'KORUMA: açık (PENDING/ACTIVE) kipli oturum', COUNT(*) FROM `support_sessions`
    WHERE `consent_mode` IS NOT NULL AND `status` IN ('PENDING', 'ACTIVE')
UNION ALL SELECT 'BİLGİ: consent_mode dolu oturum', COUNT(*) FROM `support_sessions` WHERE `consent_mode` IS NOT NULL
UNION ALL SELECT 'BİLGİ: silent_reason dolu oturum', COUNT(*) FROM `support_sessions` WHERE `silent_reason` IS NOT NULL
UNION ALL SELECT 'BİLGİ: izinsiz politika açık firma', COUNT(*) FROM `tenant_settings` WHERE `unattended_silent_enabled` = 1;
