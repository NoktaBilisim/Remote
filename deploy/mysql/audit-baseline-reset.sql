-- Audit süreklilik TABAN ÇİZGİSİ sıfırlama (P13b G-P13b-5; docs/db-notlari.md "P13b"). ELLE, gerekçeyle ve audit'li.
-- Ne zaman: (a) `restore.sh --target staging|production` canlıya başarıyla yükledikten sonra (restore.sh çağırır),
-- (b) terfi/yeniden kurulum sonrası ilk yedekten önce, (c) incelenip meşru bulunan bir `audit-sureklilik` FAILED'ından
-- sonra (ör. elle düzeltilen kayıt). Etkisi: bir sonraki yedekte audit-continuity.sql `baseline.id` farklı döner; backup.sh
-- bunu YALNIZ host işaretiyle (S-P13b-1) eşleşirse kabul eder → karşılaştırmayı atlar, `taban-cizgisi-sifirlandi` yazar ve
-- BACKUP_ALERT_CMD'yi (uyarı) çağırır; o çalıştırma yeni taban olur. Tetikleyici özeti (triggers.ok) ETKİLENMEZ.
-- Çalıştıran: migrator (audit_logs INSERT; force_created_at'ten muaf olduğu için created_at açıkça UTC yazılır).
-- app/migrator aynı action'ı yazabilir: bu yüzden DB satırı TEK BAŞINA yetmez (işaretsiz → FAILED taban-cizgisi-isaretsiz).
--
-- Çalıştırma (root, sunucuda; DESTEKLENEN TEK YOL — SQL'i elle çalıştırmak işaret yazmaz ve sonraki yedek FAILED olur):
--   sudo /opt/remote/deploy/backup/backup.sh --reset-audit-baseline "<gerekçe>"
--   backup.sh dosyayı migrator ile şu biçimde gönderir ve dönen id ile $BACKUP_DIR/audit-baseline-reset.json (root 600) yazar:
--   { printf "SET @rs_reason = '%s', @rs_operator = '%s';\n" "<gerekçe>" "<kullanıcı>@<host>"; cat mysql/audit-baseline-reset.sql; } \
--   | docker exec -i <mysql> sh -c 'MYSQL_PWD="$MYSQL_MIGRATOR_PASSWORD" exec mysql -umigrator --protocol=socket \
--       --system-command=OFF --local-infile=0 -NB "$MYSQL_DATABASE"'
--   (GEREKÇE kişisel veri/sır içermez, 10–200 karakter, tek satır; ' ve \ olmamalı — backup.sh reddeder, guard da denetler.)
-- Beklenen çıktı: `audit-baseline-reset: OK id=<audit id>`. Guard ihlali → 3819, hiçbir şey yazılmaz.
CREATE TEMPORARY TABLE `rs_baseline_guard` (`ok` TINYINT NOT NULL, CONSTRAINT `rs_baseline_guard_chk` CHECK (`ok` = 1));
INSERT INTO `rs_baseline_guard` (`ok`)
SELECT COALESCE(
        CAST(SUBSTRING_INDEX(CURRENT_USER(), '@', 1) AS BINARY) = 'migrator'
    AND CHAR_LENGTH(@rs_reason) BETWEEN 10 AND 200
    AND NOT REGEXP_LIKE(@rs_reason, '[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]', 'c')
    AND REGEXP_LIKE(@rs_operator, '^[A-Za-z0-9._-]{1,32}@[A-Za-z0-9.-]{1,64}$', 'c'), 0);
DROP TEMPORARY TABLE `rs_baseline_guard`;

INSERT INTO `audit_logs` (`created_at`, `username`, `action`, `entity`, `entity_id`, `new_value`, `user_agent`, `result`)
SELECT UTC_TIMESTAMP(3), 'cli', 'backup.audit_baseline_reset', 'audit_logs', CAST(COALESCE(MAX(`id`), 0) AS CHAR),
       JSON_OBJECT('reason', @rs_reason, 'operator', @rs_operator, 'maxIdBefore', COALESCE(MAX(`id`), 0)),
       'audit-baseline-reset-sql', 'success'
  FROM `audit_logs`;
SELECT CONCAT('audit-baseline-reset: OK id=', LAST_INSERT_ID());
SET @rs_reason = NULL, @rs_operator = NULL;
