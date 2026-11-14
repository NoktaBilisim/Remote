-- Uygulama tablolarının içerik sağlama toplamı (P13b D2; docs/mimari-p13.md §7.6 "Karşılaştırma", ADR-0020 m.2,
-- docs/db-notlari.md "P13b"). Salt okuma. Çağıran: deploy/backup/restore.sh; scratch'e ve canlıya yükleme BİTTİKTEN
-- sonra, `docker compose up -d`'DEN ÖNCE (server/migrate çalışırken satırlar değişir) iki tarafta da aynı hesapla
-- (migrator önerilir; SELECT yeter) çalıştırılır ve çıktılar birebir karşılaştırılır.
--
-- Çalıştırma:
--   docker exec -i "$C" sh -c 'MYSQL_PWD="$MYSQL_MIGRATOR_PASSWORD" exec mysql -umigrator --protocol=socket \
--       --system-command=OFF --local-infile=0 -NB "$MYSQL_DATABASE"' < mysql/checksum-tables.sql
-- Çıktı: tablo başına bir satır, `<db>.<tablo><TAB><sağlama toplamı>`, tablo adına göre ikili sıralı. Kapsam:
-- DATABASE()'deki TÜM BASE TABLE'lar (_prisma_migrations dahil; view hariç). Tablo yoksa rc≠0 (boş liste sözdizimi
-- hatası) → FAIL sayılır.
-- Karşılaştırma: iki çıktı satır satır eşit olmalı; farkta YALNIZ tablo adı yazılır (değer yazılmaz):
--   join -t "$(printf '\t')" -a1 -a2 -e MISSING -o 0,1.2,2.2 <(sort a) <(sort b) | awk -F'\t' '$2 != $3 {print $1}'
--
-- Notlar:
--  * CHECKSUM TABLE (varsayılan EXTENDED) satırların tamamını okur; InnoDB'de QUICK desteklenmez (NULL döner).
--  * Değer satır biçimine (ROW_FORMAT) bağlıdır: iki taraf aynı imaj + aynı dökümden kurulduğu için aynıdır.
--  * Yedek ANINDA alınamaz: CHECKSUM TABLE --single-transaction anlık görüntüsünü değil güncel veriyi okur → manifest
--    satır sayısı + bu karşılaştırma (scratch ↔ canlı) birlikte kullanılır.
--  * AUTO_INCREMENT sayacı kapsam dışıdır (satır içeriği değil).
SET SESSION group_concat_max_len = 65536;
SELECT CONCAT('CHECKSUM TABLE ', GROUP_CONCAT(CONCAT('`', REPLACE(TABLE_NAME, '`', '``'), '`')
                                             ORDER BY CAST(TABLE_NAME AS BINARY) SEPARATOR ', '))
  INTO @rs_q
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE';
PREPARE rs_checksum FROM @rs_q;
EXECUTE rs_checksum;
DEALLOCATE PREPARE rs_checksum;
SET @rs_q = NULL;
