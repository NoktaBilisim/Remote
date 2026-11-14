#!/bin/bash
# MySQL resmi imajı ilk açılışta (boş veri dizini) /docker-entrypoint-initdb.d/ altındaki bu
# dosyayı çalıştırır (çalıştırılabilir ise alt süreç, değilse source; ikisinde de çalışır).
# Sunucu bu aşamada yalnız soket dinler; root parolası MYSQL_PWD ile verilir (ps'te görünmez).
# İki uygulama kullanıcısı oluşturur (G-15, ADR-0003, docs/db-notlari.md):
#   migrator -> MYSQL_DATABASE üzerinde DDL + TRIGGER + GRANT OPTION (yalnız `migrate` servisi)
#   app      -> burada HİÇ yetki almaz; tablo bazlı DML yetkisini migration sonrası
#               apps/server/prisma/sql/grants.sql verir (audit_logs'ta UPDATE yok).
#   backup   -> (P13a, mimari-p13 §4) yalnız 'backup'@'localhost': MYSQL_DATABASE üzerinde SELECT, SHOW VIEW, TRIGGER
#               (mysqldump --single-transaction --no-tablespaces --triggers). Yalnız mysql konteyneri içinden
#               (`docker compose exec mysql mysqldump …`) bağlanabilir. Mevcut kurulumda: deploy/mysql/backup-user.sql.
# Gerekli env: MYSQL_ROOT_PASSWORD, MYSQL_DATABASE, MYSQL_APP_PASSWORD, MYSQL_MIGRATOR_PASSWORD.
# İsteğe bağlı: MYSQL_BACKUP_PASSWORD (boşsa backup kullanıcısı oluşturulmaz; yedek betiği o durumda hata verir).
(
set -euo pipefail

for var in MYSQL_ROOT_PASSWORD MYSQL_DATABASE MYSQL_APP_PASSWORD MYSQL_MIGRATOR_PASSWORD; do
  if [ -z "${!var:-}" ]; then
    echo "01-users.sh: $var tanımlı değil" >&2
    exit 1
  fi
done

# SQL'e gömüldüğü için tırnak/ters bölü içeren değerler reddedilir (enjeksiyon önlemi).
for var in MYSQL_DATABASE MYSQL_APP_PASSWORD MYSQL_MIGRATOR_PASSWORD MYSQL_BACKUP_PASSWORD; do
  case "${!var:-}" in
    *\'* | *\\* | *\`*) echo "01-users.sh: $var tırnak veya ters bölü içeremez" >&2; exit 1 ;;
  esac
done

MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --protocol=socket -uroot --database=mysql <<-EOSQL
	ALTER DATABASE \`${MYSQL_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

	CREATE USER IF NOT EXISTS 'migrator'@'%' IDENTIFIED BY '${MYSQL_MIGRATOR_PASSWORD}';
	GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}\`.* TO 'migrator'@'%' WITH GRANT OPTION;

	CREATE USER IF NOT EXISTS 'app'@'%' IDENTIFIED BY '${MYSQL_APP_PASSWORD}';

	FLUSH PRIVILEGES;
EOSQL

if [ -n "${MYSQL_BACKUP_PASSWORD:-}" ]; then
  if [ "${#MYSQL_BACKUP_PASSWORD}" -lt 16 ]; then
    echo "01-users.sh: MYSQL_BACKUP_PASSWORD en az 16 karakter olmalı" >&2
    exit 1
  fi
  # Yetki kümesi deploy/mysql/backup-user.sql ile AYNI tutulmalı (gerekçe docs/db-notlari.md "P13a").
  MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --protocol=socket -uroot --database=mysql <<-EOSQL
		CREATE USER IF NOT EXISTS 'backup'@'localhost' IDENTIFIED BY '${MYSQL_BACKUP_PASSWORD}';
		GRANT SELECT, SHOW VIEW, TRIGGER ON \`${MYSQL_DATABASE}\`.* TO 'backup'@'localhost';
	EOSQL
else
  echo "01-users.sh: MYSQL_BACKUP_PASSWORD boş — 'backup' kullanıcısı oluşturulmadı (sonradan: deploy/mysql/backup-user.sql)" >&2
fi
)
