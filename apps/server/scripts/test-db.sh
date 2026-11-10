#!/usr/bin/env bash
# Entegrasyon testi için geçici MySQL 8.4 (docs/db-notlari.md "Test" adımları).
#   eval "$(apps/server/scripts/test-db.sh up)"   → konteyner + migrate + grants, TEST_DATABASE_URL export eder
#   apps/server/scripts/test-db.sh down          → konteyneri siler
# Parolalar her çalıştırmada rastgele üretilir; yalnız bu geçici konteyner içindir.
set -euo pipefail
NAME="${TEST_DB_CONTAINER:-rs-mysql-test}"
PORT="${TEST_DB_PORT:-33307}"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

case "${1:-}" in
  up)
    APP_PW="app$(openssl rand -hex 12)"; MIG_PW="mig$(openssl rand -hex 12)"
    docker run -d --name "$NAME" -p "127.0.0.1:$PORT:3306" \
      -e MYSQL_ROOT_PASSWORD="root$(openssl rand -hex 12)" -e MYSQL_DATABASE=remote \
      -e MYSQL_APP_PASSWORD="$APP_PW" -e MYSQL_MIGRATOR_PASSWORD="$MIG_PW" \
      -v "$ROOT/deploy/mysql/init:/docker-entrypoint-initdb.d:ro" \
      mysql:8.4 --default-time-zone=+00:00 >/dev/null
    for _ in $(seq 1 90); do
      if docker exec "$NAME" sh -c 'MYSQL_PWD="$MYSQL_APP_PASSWORD" mysql -uapp -h127.0.0.1 -e "SELECT 1"' >/dev/null 2>&1; then break; fi
      sleep 1
    done
    (cd "$ROOT/apps/server" && MIGRATE_DATABASE_URL="mysql://migrator:$MIG_PW@127.0.0.1:$PORT/remote" \
      pnpm --silent db:migrate >&2)
    echo "export TEST_DATABASE_URL='mysql://app:$APP_PW@127.0.0.1:$PORT/remote?allowPublicKeyRetrieval=true'"
    ;;
  down)
    docker rm -f "$NAME" >/dev/null && echo "silindi: $NAME" >&2
    ;;
  *)
    echo "kullanım: $0 up|down" >&2; exit 2 ;;
esac
