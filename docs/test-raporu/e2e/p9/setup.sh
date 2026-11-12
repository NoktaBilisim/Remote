#!/usr/bin/env bash
# P9 sayfa testi ortamı (yalnız YEREL): geçici MySQL + seed + 2 ADMIN + server :3312 + web standalone :3228.
#   WORK=<boş klasör> docs/test-raporu/e2e/p9/setup.sh up     → $WORK/creds.env (chmod 600) üretir, süreçleri arka planda bırakır
#   WORK=<aynı klasör> docs/test-raporu/e2e/p9/setup.sh down  → server/web süreçleri + DB konteyneri kapatılır
# Parolalar her koşuda rastgele üretilir; yalnız $WORK/creds.env içinde (repoya girmez, ekrana yazılmaz).
set -euo pipefail
set +x
SRC="$(cd "$(dirname "$0")/../../../.." && pwd)"
: "${WORK:?WORK klasörü verin}"
DB_CONTAINER="${TEST_DB_CONTAINER:-rs-mysql-p9op}"
DB_PORT="${TEST_DB_PORT:-33328}"
SERVER_PORT=3312
WEB_PORT=3228
SNAP="$WORK/repo"
rand() { openssl rand -hex "$1"; }

case "${1:-}" in
up)
  mkdir -p "$SNAP"
  for entry in "$SRC"/* "$SRC"/.[!.]*; do
    name="$(basename "$entry")"; [[ "$name" == ".git" ]] && continue
    cp -cR "$entry" "$SNAP/" 2>/dev/null || cp -R "$entry" "$SNAP/"
  done
  rm -rf "$SNAP/apps/web/.next" "$SNAP/apps/web/test-results"
  DB_ENV="$(TEST_DB_CONTAINER="$DB_CONTAINER" TEST_DB_PORT="$DB_PORT" "$SNAP/apps/server/scripts/test-db.sh" up)"
  eval "$DB_ENV"; unset DB_ENV
  export DATABASE_URL="$TEST_DATABASE_URL"; unset NODE_ENV
  SA_EMAIL="sa-$(rand 3)@p9op.invalid"; SA_PW="Sa-$(rand 16)"
  SEED_SUPERADMIN_EMAIL="$SA_EMAIL" SEED_SUPERADMIN_PASSWORD="$SA_PW" pnpm --silent --dir "$SNAP" db:seed >/dev/null
  export E2E_REAL_LOGIN="admin1-$(rand 3)@p9op.invalid" E2E_REAL_LOGIN2="admin2-$(rand 3)@p9op.invalid" E2E_REAL_PASSWORD="Ad-$(rand 16)"
  pnpm --silent --dir "$SNAP" --filter @remote/web e2e:real:users >/dev/null
  umask 077
  cat >"$WORK/creds.env" <<EOF
export P9_BASE=http://localhost:$WEB_PORT
export P9_SA_LOGIN='$SA_EMAIL'
export P9_SA_PW='$SA_PW'
export P9_ADMIN_LOGIN='$E2E_REAL_LOGIN'
export P9_ADMIN2_LOGIN='$E2E_REAL_LOGIN2'
export P9_ADMIN_PW='$E2E_REAL_PASSWORD'
export P9_DATABASE_URL='$DATABASE_URL'
EOF
  (cd "$SNAP/apps/server" && exec env -u E2E_REAL_PASSWORD -u E2E_REAL_LOGIN -u E2E_REAL_LOGIN2 \
    NODE_ENV=development PUBLIC_BASE_URL="http://localhost:$WEB_PORT" PORT="$SERVER_PORT" HOST=127.0.0.1 LOG_LEVEL=info \
    node src/server.ts) >"$WORK/server.log" 2>&1 &
  echo $! >"$WORK/server.pid"
  for _ in $(seq 1 60); do curl -fsS "http://127.0.0.1:$SERVER_PORT/ready" >/dev/null 2>&1 && break; sleep 0.5; done
  curl -fsS "http://127.0.0.1:$SERVER_PORT/ready" >/dev/null
  (cd "$SNAP/apps/web" && env -u E2E_REAL_PASSWORD API_INTERNAL_URL="http://127.0.0.1:$SERVER_PORT" PUBLIC_BASE_URL="http://localhost:$WEB_PORT" \
    ./node_modules/.bin/next build >"$WORK/build.log" 2>&1 && cp -R .next/static .next/standalone/apps/web/.next/ && cp -R public .next/standalone/apps/web/)
  (cd "$SNAP/apps/web" && exec env -u E2E_REAL_PASSWORD API_INTERNAL_URL="http://127.0.0.1:$SERVER_PORT" PUBLIC_BASE_URL="http://localhost:$WEB_PORT" \
    PORT="$WEB_PORT" HOSTNAME=0.0.0.0 EDGE_PROXY_SECRET="e2e-only-edge-secret-not-for-production-000" \
    node .next/standalone/apps/web/server.js) >"$WORK/web.log" 2>&1 &
  echo $! >"$WORK/web.pid"
  for _ in $(seq 1 60); do curl -fsS -o /dev/null "http://localhost:$WEB_PORT/login" && break; sleep 1; done
  curl -fsS -o /dev/null "http://localhost:$WEB_PORT/login" && echo "hazır: http://localhost:$WEB_PORT"
  ;;
down)
  for f in server web; do [[ -f "$WORK/$f.pid" ]] && kill "$(cat "$WORK/$f.pid")" 2>/dev/null || true; done
  TEST_DB_CONTAINER="$DB_CONTAINER" "$SRC/apps/server/scripts/test-db.sh" down || true
  ;;
*) echo "kullanım: WORK=… $0 up|down" >&2; exit 2 ;;
esac
