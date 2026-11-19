#!/usr/bin/env bash
# P22-T yerel yığın: anlık görüntü + seed + 2 ADMIN + server :3483 + web :3484. Gizli değerler yalnız $W içinde (600).
set -euo pipefail; set +x
SRC=/Users/mennan/Projeler/Remote/.claude/worktrees/p22-06bd24
S=/private/tmp/claude-501/-Users-mennan-Projeler-Remote--claude-worktrees-p22-06bd24/0dcce0ad-a44b-4c3d-99df-760aa36ce45f/scratchpad
W=$S/p22op; SNAP=$W/repo; SP=3483; WP=3484
rand() { openssl rand -hex "$1"; }
source $S/env.sh
export DATABASE_URL="$TEST_DATABASE_URL"; unset NODE_ENV
umask 077
if [[ ! -f $W/secrets.env ]]; then
  cat > $W/secrets.env <<EOT
export ENC='v1:$(openssl rand -base64 32)'
export TSEC='$(rand 24)'
export SREF='$(rand 24)'
export SA_EMAIL='sa-$(rand 3)@p22op.invalid'
export SA_PW='Sa-$(rand 16)'
export A1='admin1-$(rand 3)@p22op.invalid'
export A2='admin2-$(rand 3)@p22op.invalid'
export APW='Ad-$(rand 16)'
EOT
fi
source $W/secrets.env
if [[ "${1:-}" != "noseed" ]]; then
  if [[ ! -d $SNAP ]]; then
    mkdir -p $SNAP
    for e in "$SRC"/* "$SRC"/.[!.]*; do n=$(basename "$e"); [[ "$n" == ".git" ]] && continue; cp -cR "$e" "$SNAP/" 2>/dev/null || cp -R "$e" "$SNAP/"; done
    rm -rf "$SNAP/apps/web/.next" "$SNAP/apps/web/test-results"
  fi
  SEED_SUPERADMIN_EMAIL="$SA_EMAIL" SEED_SUPERADMIN_PASSWORD="$SA_PW" pnpm --silent --dir "$SNAP" db:seed > $W/seed.log 2>&1
  E2E_REAL_LOGIN="$A1" E2E_REAL_LOGIN2="$A2" E2E_REAL_PASSWORD="$APW" pnpm --silent --dir "$SNAP" --filter @remote/web e2e:real:users > $W/users.log 2>&1
fi
(cd "$SNAP/apps/server" && exec env -u SA_PW -u APW APP_ENCRYPTION_KEYS="$ENC" SESSION_REF_KEY="$SREF" \
  NODE_ENV=development PUBLIC_BASE_URL="http://localhost:$WP" PORT="$SP" HOST=127.0.0.1 LOG_LEVEL=info \
  TURN_URLS="stun:stun.p22op.test:3478,turn:turn.p22op.test:3478" TURN_SECRET="$TSEC" METRICS_TOKEN="$TSEC" \
  node src/server.ts) > $W/server.log 2>&1 &
echo $! > $W/server.pid
for _ in $(seq 1 120); do curl -fsS "http://127.0.0.1:$SP/ready" >/dev/null 2>&1 && break; sleep 0.5; done
curl -fsS "http://127.0.0.1:$SP/ready" >/dev/null && echo "server hazır"
