#!/bin/sh
# Tekrarlanabilir Windows derlemesi (ADR-0010): manifest + sürüm bilgisi go-winres ile .syso'ya, sonra go build.
# Kullanım: build/build.sh <https://alan-adı[:port]> <sürüm x.y.z> [çıktı]
# İki ayrı derlemenin SHA-256'sı aynı olmalıdır (CI agent-win.yml bunu karşılaştırır).
set -eu
SERVER="$1"; VERSION="$2"; OUT="${3:-bin/NoktaDestek.exe}"
cd "$(dirname "$0")/.."
WINRES=github.com/tc-hib/go-winres@v0.3.3
GOOS= GOARCH= go run "$WINRES" make --in build/winres.json --out cmd/noktadestek/rsrc \
  --arch amd64 --product-version "$VERSION.0" --file-version "$VERSION.0"
trap 'rm -f cmd/noktadestek/rsrc_windows_amd64.syso' EXIT
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -buildid= \
  -X remote-support/agent-win/internal/config.serverURL=$SERVER \
  -X remote-support/agent-win/internal/config.version=$VERSION" -o "$OUT" ./cmd/noktadestek
