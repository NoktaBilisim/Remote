-- Canlı geri yüklemede veritabanını MIGRATOR yetkisiyle boşaltır (P13b D1; docs/mimari-p13.md §7.6, ADR-0020 m.2;
-- docs/db-notlari.md "P13b"). Çağıran: deploy/backup/restore.sh, --target staging|production, scratch doğrulaması OK
-- olduktan ve `docker compose stop web server` yapıldıktan SONRA. root KULLANILMAZ.
--
-- Çalıştırma (deploy/ dizininde; DB adı restore.sh'te ^[A-Za-z0-9_]{1,64}$ ile doğrulanmış olmalı):
--   { printf "SET @rs_confirm_db = '%s';\n" "$DB_NAME"; cat mysql/restore-reset-db.sql; } \
--     | docker exec -i "$LIVE" sh -c 'MYSQL_PWD="$MYSQL_MIGRATOR_PASSWORD" exec mysql -umigrator --protocol=socket \
--         --system-command=OFF --local-infile=0 -NB "$MYSQL_DATABASE"'
-- Beklenen tek çıktı satırı: `restore-reset: OK <db> <karakter seti> <collation>`. Başka her durumda rc≠0 ve
-- HİÇBİR ŞEY DEĞİŞMEZ (guard DROP'tan önce).
--
-- Yöntem (dba kararı): DROP DATABASE + CREATE DATABASE (aynı karakter seti/collation). Tablo/tetikleyici tek tek
-- düşürmeye göre: dökümde olmayan her nesne (fazla tablo, view, rutin, olay, tetikleyici) de gider; FK sırası ve nesne
-- listesi gerekmez. Yetki: migrator'ın `<db>`.* ALL'ı DROP ve CREATE'i kapsar (başka DB oluşturamaz: 1044).
-- Hesaplar ve yetkiler (mysql.user/db/tables_priv/columns_priv) DROP DATABASE ile SİLİNMEZ; app'in tablo yetkileri
-- aynı adlı tablolara döküm yüklenince yeniden geçerli olur, `docker compose up -d` (migrate → grants.sql) eşitler.
-- Korumasız an: DB yokken server durmuş olmalı (restore.sh sırası). MySQL DDL transaction'a girmez; DROP ile CREATE
-- arasında hata olursa (pratikte yalnız disk/bağlantı) DB yok kalır → aynı dosya tekrar çalıştırılamaz (DATABASE()
-- NULL), kurtarma: runbook §19 "Veri bozuldu" (migrator ile `CREATE DATABASE <db>` + yüklemeyi tekrar).

-- Guard: yanlış hesap (root vb.), yanlış/boş DB ya da onaysız çağrı → 3819, hiçbir şey değişmeden durur.
CREATE TEMPORARY TABLE `rs_restore_reset_guard` (`ok` TINYINT NOT NULL, CONSTRAINT `rs_restore_reset_guard_chk` CHECK (`ok` = 1));
INSERT INTO `rs_restore_reset_guard` (`ok`)
SELECT COALESCE(
        CAST(SUBSTRING_INDEX(CURRENT_USER(), '@', 1) AS BINARY) = 'migrator'
    AND CAST(DATABASE() AS BINARY) = CAST(@rs_confirm_db AS BINARY)
    AND REGEXP_LIKE(DATABASE(), '^[A-Za-z0-9_]{1,64}$', 'c')
    AND LOWER(DATABASE()) NOT IN ('mysql', 'sys', 'information_schema', 'performance_schema')
    AND (SELECT REGEXP_LIKE(CONCAT(DEFAULT_CHARACTER_SET_NAME, ' ', DEFAULT_COLLATION_NAME), '^[a-z0-9_]+ [a-z0-9_]+$', 'c')
           FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = DATABASE()), 0);
DROP TEMPORARY TABLE `rs_restore_reset_guard`;

SELECT DATABASE(), DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME INTO @rs_db, @rs_cs, @rs_coll
  FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = DATABASE();

SET @q = CONCAT('DROP DATABASE `', @rs_db, '`');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
SET @q = CONCAT('CREATE DATABASE `', @rs_db, '` CHARACTER SET ', @rs_cs, ' COLLATE ', @rs_coll);
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
SET @q = NULL;

SELECT CONCAT('restore-reset: OK ', SCHEMA_NAME, ' ', DEFAULT_CHARACTER_SET_NAME, ' ', DEFAULT_COLLATION_NAME)
  FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = @rs_db;
