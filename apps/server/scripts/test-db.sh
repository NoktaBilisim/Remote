#!/usr/bin/env bash
# Entegrasyon testi için geçici MySQL 8.4 (docs/db-notlari.md "Test" adımları).
#   eval "$(apps/server/scripts/test-db.sh up)"   → konteyner + migrate + grants, TEST_DATABASE_URL export eder
#   apps/server/scripts/test-db.sh down          → konteyneri siler
# Parolalar her çalıştırmada rastgele üretilir; yalnız bu geçici konteyner içindir.
# Ayarlanabilir: TEST_DB_CONTAINER (rs-mysql-test), TEST_DB_PORT (33307),
#   TEST_DB_READY_TIMEOUT (180 sn; yüklü makinede MySQL init'i 90 sn'yi aşabiliyor).
# Çıkış (up): 0 hazır + migrate tamam · 3 MySQL zaman aşımında hazır olmadı / konteyner durdu · migrate hatası
#   pnpm'in kodu. Hata durumunda konteyner incelemek için bırakılır (`down` ile silin).
set -euo pipefail
NAME="${TEST_DB_CONTAINER:-rs-mysql-test}"
PORT="${TEST_DB_PORT:-33307}"
READY_TIMEOUT="${TEST_DB_READY_TIMEOUT:-180}"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

die_ready() {
  echo "test-db: HATA — $NAME $1 (TEST_DB_READY_TIMEOUT=${READY_TIMEOUT}s). Konteyner logu (son 30):" >&2
  docker logs --tail 30 "$NAME" >&2 2>&1 || true
  echo "test-db: incelemeden sonra silin: $0 down" >&2
  exit 3
}

# Hazır sayılma koşulları (hepsi):
#  1) "ready for connections" ikinci kez, gerçek sunucudan: entrypoint önce init için geçici sunucu
#     (`port: 0`, ağ kapalı) açar, init betiklerinden sonra kapatıp gerçek sunucuyu (`port: 3306`) açar.
#     Yalnız satır saymak yetmez: geçici sunucuda X Plugin de "ready for connections" yazar (2 satır, port 0).
#     Bu yüzden `mysqld: ready for connections ... port: 3306` satırı aranır.
#  2) Gerçek TCP bağlantısıyla sorgu: app ve migrator kullanıcıları (01-users.sh) ile `SELECT 1`.
wait_ready() {
  local deadline=$((SECONDS + READY_TIMEOUT)) ready_lines
  while (( SECONDS < deadline )); do
    if [[ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" != true ]]; then
      die_ready "konteyner çalışmıyor (çöktü/durdu)"
    fi
    ready_lines="$(docker logs "$NAME" 2>&1 | grep -c 'mysqld: ready for connections.*port: 3306[^0-9]' || true)"
    if (( ready_lines >= 1 )) && docker exec "$NAME" sh -c '
        MYSQL_PWD="$MYSQL_APP_PASSWORD" mysql -uapp -h127.0.0.1 -P3306 -NBe "SELECT 1" &&
        MYSQL_PWD="$MYSQL_MIGRATOR_PASSWORD" mysql -umigrator -h127.0.0.1 -P3306 -NBe "SELECT 1" remote' >/dev/null 2>&1
    then
      return 0
    fi
    sleep 1
  done
  die_ready "${READY_TIMEOUT} sn içinde hazır olmadı"
}

case "${1:-}" in
  up)
    APP_PW="app$(openssl rand -hex 12)"; MIG_PW="mig$(openssl rand -hex 12)"
    # --user mysql: entrypoint root değilken gosu'yu atlar. Docker Desktop (29.x, arm64) VM'si uzun yük sonrası
    # gosu 1.19'un setuid adımında %100 CPU'da asılı kaldığı görüldü (QA-P5-6, 2026-11-11); veri dizini zaten mysql'in.
    docker run -d --name "$NAME" --user mysql -p "127.0.0.1:$PORT:3306" \
      -e MYSQL_ROOT_PASSWORD="root$(openssl rand -hex 12)" -e MYSQL_DATABASE=remote \
      -e MYSQL_APP_PASSWORD="$APP_PW" -e MYSQL_MIGRATOR_PASSWORD="$MIG_PW" \
      -v "$ROOT/deploy/mysql/init:/docker-entrypoint-initdb.d:ro" \
      mysql:8.4 --default-time-zone=+00:00 >/dev/null
    t0=$SECONDS
    wait_ready
    echo "test-db: $NAME hazır ($((SECONDS - t0)) sn), migrate başlıyor" >&2
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
