#!/bin/bash
# MySQL resmi imajı ilk açılışta (boş veri dizini) /docker-entrypoint-initdb.d/ altındaki bu
# dosyayı çalıştırır (çalıştırılabilir ise alt süreç, değilse source; ikisinde de çalışır).
# Sunucu bu aşamada yalnız soket dinler; root parolası MYSQL_PWD ile verilir (ps'te görünmez).
# İki uygulama kullanıcısı oluşturur (G-15, ADR-0003, docs/db-notlari.md):
#   migrator -> MYSQL_DATABASE üzerinde DDL + TRIGGER + GRANT OPTION (yalnız `migrate` servisi)
#   app      -> burada HİÇ yetki almaz; tablo bazlı DML yetkisini migration sonrası
#               apps/server/prisma/sql/grants.sql verir (audit_logs'ta UPDATE yok).
# Gerekli env: MYSQL_ROOT_PASSWORD, MYSQL_DATABASE, MYSQL_APP_PASSWORD, MYSQL_MIGRATOR_PASSWORD.
(
set -euo pipefail

for var in MYSQL_ROOT_PASSWORD MYSQL_DATABASE MYSQL_APP_PASSWORD MYSQL_MIGRATOR_PASSWORD; do
  if [ -z "${!var:-}" ]; then
    echo "01-users.sh: $var tanımlı değil" >&2
    exit 1
  fi
done

# SQL'e gömüldüğü için tırnak/ters bölü içeren değerler reddedilir (enjeksiyon önlemi).
for var in MYSQL_DATABASE MYSQL_APP_PASSWORD MYSQL_MIGRATOR_PASSWORD; do
  case "${!var}" in
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
)
