#!/bin/sh
# Tekrarlanabilir Windows derlemesi (ADR-0010): manifest + sürüm bilgisi go-winres ile .syso'ya, sonra go build.
# -H=windowsgui: GUI alt sistemi — açılışta siyah konsol penceresi çıkmaz (0.9.1 öncesi hata). Servis ikilisi de GUI alt
# sistemindedir (SCM konsol istemez; ayar penceresi/tepsi/yardımcı konsolsuz açılır).
# Kullanım: build/build.sh <https://alan-adı[:port]> <sürüm x.y.z> [çıktı] [komut]
#   komut: noktadestek (varsayılan; NoktaDestek.exe, build/winres.json) |
#          noktadestek-servis (P27 K9; NoktaDestekServis.exe, build/winres-servis.json — manifest asInvoker, aynı ldflags)
# İki ayrı derlemenin SHA-256'sı aynı olmalıdır (CI agent-win.yml her iki ikili için karşılaştırır).
# P29 K6 (mimari-p29 §9.6): UPDATE_ENV=prod|staging ortam değişkeni verilirse build/update-keys/<env>.pub açık anahtarları gömülür
# (build/update-ldflags.sh; dosya yoksa güncelleyici kapalı derlenir). Boş/verilmemiş = gömülmez (PR, yer tutucu). Gömüldüyse
# değerin ikilide bulunduğu denetlenir (`-X` var olmayan sembolde sessizce etkisizdir).
set -eu
SERVER="$1"; VERSION="$2"; CMD="${4:-noktadestek}"
case "$CMD" in
  noktadestek) RES=build/winres.json; DEF_OUT=bin/NoktaDestek.exe ;;
  noktadestek-servis) RES=build/winres-servis.json; DEF_OUT=bin/NoktaDestekServis.exe ;;
  *) echo "bilinmeyen komut: $CMD (noktadestek | noktadestek-servis)" >&2; exit 2 ;;
esac
OUT="${3:-$DEF_OUT}"
cd "$(dirname "$0")/.."
UPD_FLAGS="$(sh build/update-ldflags.sh "${UPDATE_ENV:-}")"
WINRES=github.com/tc-hib/go-winres@v0.3.3
GOOS='' GOARCH='' go run "$WINRES" make --in "$RES" --out "cmd/$CMD/rsrc" \
  --arch amd64 --product-version "$VERSION.0" --file-version "$VERSION.0"
trap 'rm -f "cmd/$CMD/rsrc_windows_amd64.syso"' EXIT
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -buildid= -H=windowsgui \
  -X remote-support/agent-win/internal/config.serverURL=$SERVER \
  -X remote-support/agent-win/internal/config.version=$VERSION $UPD_FLAGS" -o "$OUT" "./cmd/$CMD"
if [ -n "$UPD_FLAGS" ]; then
  UPD_KEYS="${UPD_FLAGS##*updateKeys=}"
  LC_ALL=C grep -aqF "$UPD_KEYS" "$OUT" || { echo "güncelleme anahtarı ikiliye gömülmedi: config.updateKeys Go kaynağında yok (P29 K3)" >&2; rm -f "$OUT"; exit 2; }
fi
