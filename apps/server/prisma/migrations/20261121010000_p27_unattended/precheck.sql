-- P27 GERİ ALMA ön kontrolü (yalnız okuma; Prisma bu dosyayı ÇALIŞTIRMAZ). down.sql'den ÖNCE migrator ile çalıştırın:
--   docker compose exec mysql sh -c 'MYSQL_PWD=… mysql -umigrator remote' < precheck.sql
-- Her satır 0 olmalı. 0 değilse down.sql `p27_down_guard_chk` (3819) ile hiçbir şey değiştirmeden durur. Satırları SİLMEYİN
-- (oturum geçmişi / KVKK onay kanıtı / audit'le eşleşen iz): önce UNATTENDED_MODE=off + açık oturumların bitmesi (runbook
-- "Gözetimsiz erişim"), sonra mimara bildirin — gözetimsiz oturum geçmişi varken şema geri alınmaz, ileri düzeltme yapılır.
SELECT 'support_sessions.device_id dolu' AS kontrol, COUNT(*) AS n FROM `support_sessions` WHERE `device_id` IS NOT NULL
UNION ALL SELECT 'support_sessions.mode=UNATTENDED', COUNT(*) FROM `support_sessions` WHERE CAST(`mode` AS BINARY) = 'UNATTENDED'
UNION ALL SELECT 'session_consents.source=UNATTENDED', COUNT(*) FROM `session_consents` WHERE CAST(`source` AS BINARY) = 'UNATTENDED'
UNION ALL SELECT 'notification_outbox talep dışı', COUNT(*) FROM `notification_outbox` WHERE `request_id` IS NULL
UNION ALL SELECT 'unattended_devices', COUNT(*) FROM `unattended_devices`
UNION ALL SELECT 'unattended_registration_codes', COUNT(*) FROM `unattended_registration_codes`
UNION ALL SELECT 'customer_notify_contacts (bilgi: kayıp olur)', COUNT(*) FROM `customer_notify_contacts`;
