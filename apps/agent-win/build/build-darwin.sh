#!/bin/sh
# Tekrarlanabilir macOS ince ikili derlemesi (ADR-0037 m.1, ADR-0010; mimari-p28f §6, §8.2). CI'da Linux Go imajında
# (GO_IMAGE) çapraz derlenir: CGO_ENABLED=0 (purego), -trimpath, -buildid=. Universal ikili (lipo), .app paketi ve imza
# macOS çalıştırıcısındadır (build/macos/package.sh, K8a). Aynı kaynaktan iki derlemenin SHA-256'sı eşit olmalıdır.
# Kullanım: build/build-darwin.sh <https://alan-adı[:port]> <sürüm x.y.z> <arm64|amd64> [çıktı] [test]
#   test: staging TEST derlemesi (`config.testBuild=1`; TEST bandı imzadan da türetilir, S-P28f-7).
# S-P28f-7: TEST olmayan (prod) derleme yalnız etiket iş akışında (GITHUB_REF_TYPE=tag, GITHUB_REF_NAME=v<sürüm>) ya da
# `.invalid` sunucuyla (iz testi derlemesi, AC-394) yapılır; aksi halde ret — ad-hoc derlemeye prod adresi gömülemez.
set -eu
SERVER="$1"; VERSION="$2"; ARCH="$3"; OUT="${4:-bin/darwin-$ARCH/noktadestek}"; MODE="${5:-}"
case "$ARCH" in arm64|amd64) ;; *) echo "mimari arm64 ya da amd64 olmalı: $ARCH" >&2; exit 2 ;; esac
case "$MODE" in
  test) TEST_FLAG="-X remote-support/agent-win/internal/config.testBuild=1" ;;
  "")
    TEST_FLAG=""
    HOST="${SERVER#https://}"; HOST="${HOST%%:*}"
    case "$HOST" in
      *.invalid) ;;
      *)
        if [ "${GITHUB_REF_TYPE:-}" != tag ] || [ "${GITHUB_REF_NAME:-}" != "v$VERSION" ]; then
          echo "prod macOS derlemesi yalnız v$VERSION etiket iş akışında (S-P28f-7); staging için 5. argüman: test" >&2
          exit 2
        fi ;;
    esac ;;
  *) echo "bilinmeyen kip: $MODE (yalnız: test)" >&2; exit 2 ;;
esac
cd "$(dirname "$0")/.."
GOOS=darwin GOARCH="$ARCH" CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -buildid= \
  -X remote-support/agent-win/internal/config.serverURL=$SERVER \
  -X remote-support/agent-win/internal/config.version=$VERSION $TEST_FLAG" -o "$OUT" ./cmd/noktadestek
