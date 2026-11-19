#!/bin/sh
# Tekrarlanabilir Linux x86_64 ELF derlemesi (ADR-0038 m.1/m.11, ADR-0010; mimari-p28g §6, §8.2). CGO_ENABLED=0 (purego),
# -trimpath, -buildid=; aynı kaynaktan iki derlemenin SHA-256'sı eşit olmalıdır. İmza yok (AC-403): SHA256SUMS +
# attestation CI'da. NEEDED yalnız libc/libdl/libpthread (CI `readelf -d`), boyut ≤ 60 MB (CI sert sınır).
# Kullanım: [WAYLAND_CONTROL=on|off] build/build-linux.sh <https://alan-adı[:port]> <sürüm x.y.z> [çıktı] [test]
#   test: staging TEST derlemesi (`config.testBuild=1`); S-P28g-9 TEST metni ayrıca adresten çalışma anında türetilir (K4).
#   WAYLAND_CONTROL (P28g K10, mimari-p28g §5.2b m.7; varsayılan on): off → Wayland'de yalnız görüntü (RemoteDesktop
#   istenmez, kontrol isteğine WAYLAND_NO_CONTROL). E-7 (b)/(c) geçmezse off ile derlenir (runbook §28g.6). X11'i etkilemez.
# S-P28g-9 (build-darwin.sh S-P28f-7 kalıbı): TEST olmayan (prod) derleme yalnız etiket iş akışında
# (GITHUB_REF_TYPE=tag, GITHUB_REF_NAME=v<sürüm>) ya da `.invalid` sunucuyla (iz testi derlemesi, AC-401) yapılır.
set -eu
SERVER="$1"; VERSION="$2"; OUT="${3:-bin/linux-amd64/noktadestek}"; MODE="${4:-}"
WAYLAND_CONTROL="${WAYLAND_CONTROL:-on}"
case "$WAYLAND_CONTROL" in
  on|off) ;;
  *) echo "WAYLAND_CONTROL yalnız on|off: $WAYLAND_CONTROL" >&2; exit 2 ;;
esac
case "$MODE" in
  test) TEST_FLAG="-X remote-support/agent-win/internal/config.testBuild=1" ;;
  "")
    TEST_FLAG=""
    HOST="${SERVER#https://}"; HOST="${HOST%%:*}"
    case "$HOST" in
      *.invalid) ;;
      *)
        if [ "${GITHUB_REF_TYPE:-}" != tag ] || [ "${GITHUB_REF_NAME:-}" != "v$VERSION" ]; then
          echo "prod Linux derlemesi yalnız v$VERSION etiket iş akışında (S-P28g-9); staging için 4. argüman: test" >&2
          exit 2
        fi ;;
    esac ;;
  *) echo "bilinmeyen kip: $MODE (yalnız: test)" >&2; exit 2 ;;
esac
cd "$(dirname "$0")/.."
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -buildid= \
  -X remote-support/agent-win/internal/config.serverURL=$SERVER \
  -X remote-support/agent-win/internal/config.version=$VERSION \
  -X remote-support/agent-win/internal/config.waylandControl=$WAYLAND_CONTROL $TEST_FLAG" -o "$OUT" ./cmd/noktadestek
