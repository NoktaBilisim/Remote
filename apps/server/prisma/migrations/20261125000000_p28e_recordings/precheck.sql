-- P28e GERİ ALMA ön kontrolü (yalnız okuma; Prisma bu dosyayı ÇALIŞTIRMAZ). down.sql'den ÖNCE migrator ile çalıştırın:
--   docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_MIGRATOR_PASSWORD" mysql -umigrator remote' < precheck.sql
-- "KORUMA" satırları 0 olmalı; değilse down.sql `p28e_down_guard_chk` (3819) ile hiçbir şey değiştirmeden durur.
-- Kayıt anahtarı açık firma → ayar ekranından kapatın. Kayıt / RECORDING rıza satırı → SİLMEYİN/DÜZENLEMEYİN (KVKK delili, kayıt
-- geçmişi): şema geri alınmaz, önceki imaja dönülür (tablolar kalır, expand — mimari-p28e §11.4) ya da ileri düzeltme (mimara).
-- "BİLGİ" satırları geri almada kaybolacak değerlerdir (audit kopyası 730 g kalır).
SELECT 'KORUMA: kayıt satırı (her durum)' AS kontrol, COUNT(*) AS n FROM `session_recordings`
UNION ALL SELECT 'KORUMA: kayıt parçası satırı', COUNT(*) FROM `session_recording_parts`
UNION ALL SELECT 'KORUMA: RECORDING rıza satırı', COUNT(*) FROM `session_consents`
    WHERE CAST(`level` AS BINARY) = 'RECORDING' OR `line_sha256` IS NOT NULL
UNION ALL SELECT 'KORUMA: kayıt ya da gözetimsiz kayıt açık firma', COUNT(*) FROM `tenant_settings`
    WHERE `recording_enabled` <> 0 OR `unattended_recording_enabled` <> 0
UNION ALL SELECT 'BİLGİ: saklama günü 30 dışında firma', COUNT(*) FROM `tenant_settings` WHERE `recording_retention_days` <> 30
UNION ALL SELECT 'BİLGİ: gözetimsiz kayıt aydınlatma izi dolu firma', COUNT(*) FROM `tenant_settings`
    WHERE `unattended_recording_ack_at` IS NOT NULL;
