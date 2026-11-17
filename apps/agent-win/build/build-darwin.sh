#!/bin/sh
# Tekrarlanabilir macOS ince ikili derlemesi (ADR-0037 m.1, ADR-0010; mimari-p28f §6, §8.2). CI'da Linux Go imajında
# (GO_IMAGE) çapraz derlenir: CGO_ENABLED=0 (purego), -trimpath, -buildid=. Universal ikili (lipo), .app paketi ve imza
# macOS çalıştırıcısındadır (build/macos/package.sh, K8a). Aynı kaynaktan iki derlemenin SHA-256'sı eşit olmalıdır.
# Kullanım: build/build-darwin.sh <https://alan-adı[:port]> <sürüm x.y.z> <arm64|amd64> [çıktı] [test]
#   test: staging TEST derlemesi (`config.testBuild=1`; TEST bandı imzadan da türetilir, S-P28f-7).
# S-P28f-7: TEST olmayan (prod) derleme yalnız etiket iş akışında (GITHUB_REF_TYPE=tag, GITHUB_REF_NAME=v<sürüm>) ya da
# `.invalid` sunucuyla (iz testi derlemesi, AC-394) yapılır; aksi halde ret — ad-hoc derlemeye prod adresi gömülemez.
# D-P28f-K3 (P28f düzeltme 1): EXPECTED_TEAM_ID ortam değişkeni (10 karakter A-Z0-9; CI'da etikette vars.APPLE_TEAM_ID) verilirse
# beklenen Apple Team ID'si TEAM_SYMBOL'e gömülür; çalışma anındaki imza Team ID'si farklıysa TEST bandı gösterilir (Go tarafı).
# `-X` var olmayan sembolde sessizce etkisiz olduğundan derleme sonrası değerin ikilide bulunduğu denetlenir (yoksa ret).
set -eu
TEAM_SYMBOL=remote-support/agent-win/internal/config.expectedTeamID
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
TEAM="${EXPECTED_TEAM_ID:-}"; TEAM_FLAG=""
if [ -n "$TEAM" ]; then
  # case (satır bazlı grep değil): satır sonu/boşluk içeren değer ldflags'e giremez.
  case "$TEAM" in *[!ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789]*) TEAM_OK=0 ;; *) TEAM_OK=1 ;; esac
  [ "$TEAM_OK" = 1 ] && [ "${#TEAM}" -eq 10 ] || { echo "EXPECTED_TEAM_ID 10 karakter A-Z0-9 olmalı" >&2; exit 2; }
  TEAM_FLAG="-X $TEAM_SYMBOL=$TEAM"
fi
cd "$(dirname "$0")/.."
GOOS=darwin GOARCH="$ARCH" CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -buildid= \
  -X remote-support/agent-win/internal/config.serverURL=$SERVER \
  -X remote-support/agent-win/internal/config.version=$VERSION $TEST_FLAG $TEAM_FLAG" -o "$OUT" ./cmd/noktadestek
if [ -n "$TEAM" ] && ! LC_ALL=C grep -aqF "$TEAM" "$OUT"; then
  echo "EXPECTED_TEAM_ID ikiliye gömülmedi: $TEAM_SYMBOL Go kaynağında yok (D-P28f-K3)" >&2; rm -f "$OUT"; exit 2
fi
