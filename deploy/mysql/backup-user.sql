-- `backup` MySQL kullanıcısı — MEVCUT kurulum için (yeni kurulumda deploy/mysql/init/01-users.sh aynısını yapar).
-- P13a, docs/mimari-p13.md §4, docs/db-notlari.md "P13a". Çalıştıran: root. İdempotent: tekrar çalıştırılabilir;
-- parola değiştiyse günceller, yetkileri her seferinde tam olarak aşağıdaki kümeye eşitler (fazlası geri alınır).
--
-- Parola ve veritabanı adı bu dosyada YOK: oturum değişkenleri @backup_pw ve @db olarak, mysql konteynerinin kendi
-- env'inden (compose: MYSQL_BACKUP_PASSWORD, MYSQL_DATABASE) verilir. printf kabuk yerleşiğidir → parola hiçbir süreç
-- argümanında (ps/docker top) görünmez. Değerler QUOTE()/ters tırnak kaçışıyla SQL'e girer (enjeksiyon yok).
-- Çalıştırma (deploy/ dizininde; deploy/.env'de MYSQL_BACKUP_PASSWORD dolu ve mysql konteyneri bununla yeniden
-- oluşturulmuş olmalı: `docker compose up -d mysql`):
--   docker compose exec -T mysql sh -c 'h() { printf %s "$1" | od -An -tx1 | tr -d " \n"; }; { echo "SET @backup_pw = CONVERT(0x$(h "$MYSQL_BACKUP_PASSWORD") USING utf8mb4), @db = CONVERT(0x$(h "$MYSQL_DATABASE") USING utf8mb4);"; cat; } | MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N' < mysql/backup-user.sql
-- (Değerler onaltılı literal olarak geçer → tırnak/ters bölü içeren parola da güvenle aktarılır; boş değer `0x` söz
-- dizimi hatasıyla, kısa parola aşağıdaki guard ile HİÇBİR ŞEY DEĞİŞMEDEN durur.)
-- Beklenen son satır: `backup-user: OK` + yetki listesi.
--
-- Yetki kümesi (dba kararı, en az yetki): DB üzerinde SELECT, SHOW VIEW, TRIGGER; yalnız 'backup'@'localhost'.
--  * SELECT: tablo verisi + _prisma_migrations (manifest son migration, satır sayıları).
--  * TRIGGER: mysqldump --triggers için zorunlu (SHOW CREATE TRIGGER / information_schema.TRIGGERS yalnız TRIGGER
--    yetkisiyle görünür). Yan etkisi CREATE/DROP TRIGGER izni → 'localhost' sınırı: hesap yalnız mysql konteyneri
--    içinden (soket) kullanılabilir; server/ağ üzerinden kullanılamaz. Tetikleyici sayısı check-app-grants ve
--    restore-verify ile izlenir.
--  * SHOW VIEW: bugün view yok; ileride eklenirse döküm sessizce eksik kalmasın diye (salt meta okuma).
--  * PROCESS VERİLMEZ (mimari öneri listesindeydi): yalnız tablespace dökümü için gerekir; --no-tablespaces ile
--    gereksiz. Global PROCESS diğer oturumların SQL metnini gösterir (kişisel veri sızabilir).
--  * LOCK TABLES / RELOAD VERİLMEZ: --single-transaction (InnoDB tutarlı anlık görüntü) ve --set-gtid-purged=OFF
--    ile FLUSH TABLES WITH READ LOCK yapılmaz.
-- Geçici guard tablosu için bir veritabanı gerekir (root oturumunda varsayılan yok).
USE mysql;
CREATE TEMPORARY TABLE `backup_user_guard` (`ok` TINYINT NOT NULL, CONSTRAINT `backup_user_guard_chk` CHECK (`ok` = 1));
INSERT INTO `backup_user_guard` (`ok`) SELECT COALESCE(CHAR_LENGTH(@backup_pw) >= 16 AND CHAR_LENGTH(@db) BETWEEN 1 AND 64, 0);
DROP TEMPORARY TABLE `backup_user_guard`;

SET @q = CONCAT('CREATE USER IF NOT EXISTS ''backup''@''localhost'' IDENTIFIED BY ', QUOTE(@backup_pw));
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
SET @q = CONCAT('ALTER USER ''backup''@''localhost'' IDENTIFIED BY ', QUOTE(@backup_pw));
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'backup'@'localhost';
SET @q = CONCAT('GRANT SELECT, SHOW VIEW, TRIGGER ON `', REPLACE(@db, '`', '``'), '`.* TO ''backup''@''localhost''');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
SET @q = NULL, @backup_pw = NULL;

SELECT 'backup-user: OK';
SHOW GRANTS FOR 'backup'@'localhost';
