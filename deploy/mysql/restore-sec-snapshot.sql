-- Geri yükleme öncesi/sonrası güvenlik anlık görüntüsü (P13a S-P13a-2 + P13b D2; docs/mimari-p13.md §7.6,
-- ADR-0020 m.2; docs/db-notlari.md "P13b"). restore.sh'teki `sec_snapshot` heredoc'unun YERİNE geçer (aynı biçim,
-- sona 4 öğe eklendi). Salt okuma; çalıştıran root (mysql.* okumak için), hedef DB bağlantı argümanı:
--   docker exec -i "$C" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -NB --system-command=OFF \
--       --local-infile=0 "$0"' "$DB_NAME" < mysql/restore-sec-snapshot.sql | tr '\n\t' ' :'
-- Çıktı (tr sonrası tek satır, boşlukla ayrılmış öğeler; restore.sh `sec_check` öğe öğe karşılaştırır, yalnız ADI yazar):
--   <hesap listesi> mysql.user:<n> … mysql.component:<n> routines=<n> events=<n> components=<n> persisted=<n>/<özet>
--   plugins=<n> views=<n> anon=<n> migratorExtra=<n>
-- Öncesi/sonrası EŞİT olmalı (yükleme hesap/yetki/rutin/olay/view/bileşen/kalıcı değişken değiştirmez). EK OLARAK
-- (mutlak, yüklemeden ÖNCE de; scratch ve canlı): `anon=0` ve `migratorExtra=0` olmalı, değilse yükleme yapılmaz:
--   * anon: anonim hesap (user='') sayısı. Varsa (ör. eski bir kurulum betiği) herkes parolasız bağlanabilir ve
--     'localhost' anonim satırı 'migrator'@'%' eşleşmesini gölgeleyebilir.
--   * migratorExtra: migrator'ın kendi DB'si dışındaki HER yetkisi (global statik/dinamik, başka şema, tablo/sütun/
--     rutin düzeyinde başka şema, rol, proxy). D1'in güvenlik sınırı migrator'ın `*.*` üzerinde yetkisiz olmasına
--     dayanır; 0 değilse kurcalanmış döküm CREATE USER/GRANT/SET PERSIST yapabilir.
--   * plugins: mysql.plugin satır sayısı (INSTALL PLUGIN; güvenlik raporu S-P13a-2 önerisi).
--   * views: DB'deki view sayısı (uygulamada view yok; tablo kümesi kontrolü yalnız BASE TABLE sayar).
-- Parola özeti/değeri hiçbir zaman yazdırılmaz; yalnız tablo sağlama toplamı ve sayılar.
SELECT COALESCE(GROUP_CONCAT(CONCAT(user, '@', host) ORDER BY user, host SEPARATOR ','), '') FROM mysql.user;
CHECKSUM TABLE mysql.user, mysql.global_grants, mysql.db, mysql.tables_priv, mysql.columns_priv, mysql.procs_priv,
  mysql.proxies_priv, mysql.role_edges, mysql.default_roles, mysql.component;
SELECT CONCAT('routines=', COUNT(*)) FROM information_schema.ROUTINES;
SELECT CONCAT('events=', COUNT(*)) FROM information_schema.EVENTS;
SELECT CONCAT('components=', COUNT(*)) FROM mysql.component;
SELECT CONCAT('persisted=', COUNT(*), '/', LEFT(SHA2(COALESCE(GROUP_CONCAT(CONCAT(VARIABLE_NAME, '=', VARIABLE_VALUE)
  ORDER BY VARIABLE_NAME SEPARATOR ';'), ''), 256), 16)) FROM performance_schema.persisted_variables;
SELECT CONCAT('plugins=', COUNT(*)) FROM mysql.plugin;
SELECT CONCAT('views=', COUNT(*)) FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE();
SELECT CONCAT('anon=', COUNT(*)) FROM mysql.user WHERE user = '';
SELECT CONCAT('migratorExtra=',
    (SELECT COUNT(*) FROM information_schema.USER_PRIVILEGES WHERE GRANTEE = '''migrator''@''%''' AND PRIVILEGE_TYPE <> 'USAGE')
  + (SELECT COUNT(*) FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE = '''migrator''@''%''' AND TABLE_SCHEMA <> DATABASE())
  + (SELECT COUNT(*) FROM mysql.tables_priv WHERE CAST(User AS BINARY) = 'migrator' AND Db <> DATABASE())
  + (SELECT COUNT(*) FROM mysql.columns_priv WHERE CAST(User AS BINARY) = 'migrator' AND Db <> DATABASE())
  + (SELECT COUNT(*) FROM mysql.procs_priv WHERE CAST(User AS BINARY) = 'migrator' AND Db <> DATABASE())
  + (SELECT COUNT(*) FROM mysql.role_edges WHERE CAST(TO_USER AS BINARY) = 'migrator')
  + (SELECT COUNT(*) FROM mysql.proxies_priv WHERE CAST(User AS BINARY) = 'migrator')
  + (SELECT COUNT(*) FROM mysql.user WHERE CAST(User AS BINARY) = 'migrator' AND Host <> '%'));
