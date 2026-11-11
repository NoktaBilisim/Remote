#!/usr/bin/env bash
# Gerçek sunucu e2e (apps/web/e2e/p4-real.spec.ts) — tek komut, tekrarlanabilir, yalnız YEREL (asla canlı DB).
#   scripts/e2e-real.sh
# Adımlar: 0) çalışma ağacının anlık görüntüsü (APFS klon, .git/.next hariç) → 1) geçici MySQL 8.4 (test-db.sh:
#   migrate + grants) → 2) seed (Super Admin + demo tenant + KVKK v1) → 3) e2e:real:users (iki ADMIN) →
#   4) server (:E2E_SERVER_PORT) → 5) web standalone build (Playwright webServer; API_INTERNAL_URL=E2E_REAL_API
#   derlemeye gömülür) → 6) e2e:real (:3218) → temizlik (trap: server, web, DB konteyneri, anlık görüntü).
# Neden anlık görüntü: paralel çalışan ajanlar/geliştiriciler apps/web/.next'i (mock e2e build) ve kaynak kodu
#   koşu sırasında değiştirebilir (ChunkLoadError, yarım düzenleme). Koşu, başladığı andaki kodla tutarlı çalışır.
# Gizli değerler (seed Super Admin / test kullanıcı parolası, DB parolaları) her koşuda rastgele üretilir, yalnız
#   süreç ortamında yaşar; ekrana ve dosyaya yazılmaz. Playwright izi (trace) parola alanını kaydettiği için
#   varsayılan KAPALI; E2E_REAL_TRACE=1 ile açılır (iz bu koşunun atılan parolasını içerir).
# Müşteri ekran kaynağı sentetiktir (p4-real.spec.ts: getDisplayMedia → canvas captureStream); fiziksel ekran/kilit
#   durumu sonucu etkilemez.
# Ayarlanabilir: E2E_DB_CONTAINER (rs-mysql-e2e-real), E2E_DB_PORT (33317), E2E_SERVER_PORT (3302),
#   TEST_DB_READY_TIMEOUT (180 sn, test-db.sh'e geçer),
#   E2E_KEEP_LOGS=1 (başarıda da logları saklar), E2E_REAL_REF=<git ref> (çalışma ağacı yerine commit'lenmiş
#   sürümü koşturur — kırmızıda "kurulum mu ürün mü" karşılaştırması için). Web portu 3218 sabit (playwright.real.config.ts).
# Çıkış: 0 geçti · 1 test kırmızı (ürün) · 2 ön koşul · 3 kurulum (DB/seed/server) hatası.
# Ayrıntı: README "Gerçek sunucu e2e", docs/runbook.md §9.8, docs/implementation.md "DevOps (P5)".
set -euo pipefail
set +x # parolalar xtrace ile sızmasın

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DB_CONTAINER="${E2E_DB_CONTAINER:-rs-mysql-e2e-real}"
DB_PORT="${E2E_DB_PORT:-33317}"
SERVER_PORT="${E2E_SERVER_PORT:-3302}"
WEB_PORT=3218
WORK="$(mktemp -d "${TMPDIR:-/tmp}/rs-e2e-real.XXXXXX")"
SNAP="$WORK/repo"
SERVER_LOG="$WORK/server.log"
SERVER_PID=""
DB_STARTED=0

log() { printf '[e2e-real] %s\n' "$*" >&2; }

cleanup() {
  local code=$?
  trap - EXIT INT TERM
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$SERVER_PID" 2>/dev/null || break; sleep 0.25; done
    kill -9 "$SERVER_PID" 2>/dev/null || true
  fi
  # Playwright webServer çocuğu yarıda kesilirse :3218'de kalmasın (yalnız bu koşunun standalone'u)
  pkill -f "$SNAP/apps/web/.next/standalone" 2>/dev/null || true
  if [[ "$DB_STARTED" == 1 ]]; then
    TEST_DB_CONTAINER="$DB_CONTAINER" "$SRC/apps/server/scripts/test-db.sh" down || true
  fi
  if [[ -d "$SNAP/apps/web/test-results" ]]; then cp -R "$SNAP/apps/web/test-results" "$WORK/" 2>/dev/null || true; fi
  rm -rf "$SNAP"
  if [[ "$code" -ne 0 || "${E2E_KEEP_LOGS:-}" == 1 ]]; then
    log "loglar: $WORK (server.log, test-results/)"
  else
    rm -rf "$WORK"
  fi
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
rand() { openssl rand -hex "$1"; }
fail_setup() { log "KURULUM HATASI: $*"; exit 3; }

# --- Ön koşullar ---
for bin in docker pnpm node openssl lsof curl; do
  command -v "$bin" >/dev/null || { log "eksik araç: $bin"; exit 2; }
done
docker info >/dev/null 2>&1 || { log "Docker çalışmıyor"; exit 2; }
[[ -d "$SRC/node_modules" ]] || { log "önce: pnpm install --frozen-lockfile && pnpm db:generate"; exit 2; }
for p in "$DB_PORT" "$SERVER_PORT" "$WEB_PORT"; do
  if port_busy "$p"; then log "port $p dolu (başka bir e2e/geliştirme süreci?) — boşaltın veya E2E_*_PORT verin"; exit 2; fi
done
if docker ps -a --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  log "konteyner $DB_CONTAINER zaten var (önceki koşudan kalmış olabilir): docker rm -f $DB_CONTAINER"; exit 2
fi

# --- 0) Anlık görüntü (macOS APFS: cp -c klon, ~10 sn; diğer FS'de düz kopya) ---
mkdir -p "$SNAP"
if [[ -n "${E2E_REAL_REF:-}" ]]; then
  # Karşılaştırma koşusu (kurulum mu ürün mü?): commit'lenmiş bir sürümün kodu + yereldeki node_modules.
  log "0/6 git ref anlık görüntüsü: ${E2E_REAL_REF} → $SNAP"
  git -C "$SRC" archive "$E2E_REAL_REF" | tar -x -C "$SNAP" || { log "git ref okunamadı: $E2E_REAL_REF"; exit 2; }
  for nm in "$SRC"/node_modules "$SRC"/apps/*/node_modules "$SRC"/packages/*/node_modules; do
    [[ -d "$nm" ]] || continue
    rel="${nm#"$SRC"/}"; mkdir -p "$SNAP/$(dirname "$rel")"
    cp -cR "$nm" "$SNAP/$rel" 2>/dev/null || cp -R "$nm" "$SNAP/$rel"
  done
  pnpm --silent --dir "$SNAP" db:generate >/dev/null || fail_setup "prisma generate (ref)"
else
  log "0/6 kod anlık görüntüsü (çalışma ağacı): $SNAP"
  for entry in "$SRC"/* "$SRC"/.[!.]*; do
    name="$(basename "$entry")"
    [[ "$name" == ".git" ]] && continue
    cp -cR "$entry" "$SNAP/" 2>/dev/null || cp -R "$entry" "$SNAP/"
  done
fi
rm -rf "$SNAP/apps/web/.next" "$SNAP/apps/web/test-results"

# --- 1) Test DB (migrate + grants) ---
log "1/6 test DB: $DB_CONTAINER (127.0.0.1:$DB_PORT)"
DB_STARTED=1
DB_ENV="$(TEST_DB_CONTAINER="$DB_CONTAINER" TEST_DB_PORT="$DB_PORT" "$SNAP/apps/server/scripts/test-db.sh" up)" \
  || fail_setup "test DB / migrate (ayrıntı yukarıda: test-db.sh hazır olma zaman aşımı veya prisma migrate hatası)"
eval "$DB_ENV"; unset DB_ENV
export DATABASE_URL="$TEST_DATABASE_URL"
# NODE_ENV dışa aktarılmaz: `next build` NODE_ENV=development ile /_global-error prerender'ında çöker.
# seed/users production olmadığı sürece çalışır; server'a aşağıda development açıkça verilir.
unset NODE_ENV

# --- 2) Seed (rastgele Super Admin; ekrana yazılmaz) ---
log "2/6 seed"
SEED_SUPERADMIN_EMAIL="sa-$(rand 4)@e2e.invalid" SEED_SUPERADMIN_PASSWORD="Sa-$(rand 16)" \
  pnpm --silent --dir "$SNAP" db:seed >/dev/null || fail_setup "seed"

# --- 3) İki ADMIN teknisyen (demo tenant) ---
log "3/6 e2e:real:users"
export E2E_REAL_LOGIN="tech1-$(rand 4)@e2e.invalid" E2E_REAL_LOGIN2="tech2-$(rand 4)@e2e.invalid"
export E2E_REAL_PASSWORD="Tp-$(rand 16)"
pnpm --silent --dir "$SNAP" --filter @remote/web e2e:real:users >/dev/null || fail_setup "e2e:real:users"

# --- 4) Server ---
log "4/6 server :$SERVER_PORT"
(
  cd "$SNAP/apps/server"
  # Test kullanıcı bilgileri server ortamına geçmez.
  exec env -u E2E_REAL_PASSWORD -u E2E_REAL_LOGIN -u E2E_REAL_LOGIN2 \
    NODE_ENV=development PUBLIC_BASE_URL="http://localhost:$WEB_PORT" PORT="$SERVER_PORT" HOST=127.0.0.1 LOG_LEVEL=info \
    node src/server.ts
) >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$SERVER_PORT/ready" >/dev/null 2>&1 && break
  kill -0 "$SERVER_PID" 2>/dev/null || { tail -n 30 "$SERVER_LOG" >&2; fail_setup "server açılmadı"; }
  sleep 0.5
done
curl -fsS "http://127.0.0.1:$SERVER_PORT/ready" >/dev/null || fail_setup "server /ready vermedi"

# --- 5+6) Web build (API_INTERNAL_URL = E2E_REAL_API, derlemeye gömülür) + e2e:real ---
log "5/6 web standalone build + 6/6 e2e:real (Playwright)"
export E2E_REAL_API="http://127.0.0.1:$SERVER_PORT"
TRACE_ARGS=(--trace off)
[[ "${E2E_REAL_TRACE:-}" == 1 ]] && TRACE_ARGS=()
set +e
pnpm --dir "$SNAP" --filter @remote/web e2e:real "${TRACE_ARGS[@]}"
RC=$?
set -e

ERRS="$(grep -c '"level":[56]0' "$SERVER_LOG" || true)"
log "server logunda error/fatal satırı: ${ERRS:-0}"
if [[ "$RC" -eq 0 ]]; then log "SONUÇ: geçti"; else log "SONUÇ: test kırmızı (çıkış $RC) — ayrıntı: test-results/*/error-context.md"; RC=1; fi
exit "$RC"
