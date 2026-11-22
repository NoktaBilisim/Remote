#!/bin/sh
# P33 K1 — K0s-A2 düzeneği: ürün kodlu iki ad-hoc imzalı, hardened runtime'lı .app üretir.
#   app-ent   : entitlement com.apple.security.device.audio-input (ürünle aynı küme) + NSMicrophoneUsageDescription
#   app-noent : entitlement yok (beklenen: istem çıkmaz ya da sessizce reddedilir)
# Kullanım: sh test/spike-p33/k1a2.sh <çıktı-klasörü>   (apps/agent-win altından)
set -eu
OUT=${1:?çıktı klasörü}
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"
export GOTOOLCHAIN=local CGO_ENABLED=0 GOPROXY=off GOFLAGS=-mod=mod
(cd "$HERE" && go build -o "$OUT/k1a2" ./cmd/k1a2)
for v in ent noent; do
  APP="$OUT/app-$v/P33A2.app"
  rm -rf "$OUT/app-$v"
  mkdir -p "$APP/Contents/MacOS"
  cp "$OUT/k1a2" "$APP/Contents/MacOS/k1a2"
  cat > "$APP/Contents/Info.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>net.noktabilisim.destek.p33a2.$v</string>
<key>CFBundleExecutable</key><string>k1a2</string>
<key>CFBundleName</key><string>P33A2 $v</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSUIElement</key><true/>
<key>NSMicrophoneUsageDescription</key><string>Teknisyenle sesli görüşme için. Mikrofon yalnız siz Kabul'e tıkladığınızda açılır.</string>
</dict></plist>
PL
  if [ "$v" = ent ]; then
    cat > "$OUT/ent.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>com.apple.security.device.audio-input</key><true/></dict></plist>
PL
    codesign -f -s - --options runtime --entitlements "$OUT/ent.plist" "$APP"
  else
    codesign -f -s - --options runtime "$APP"
  fi
  codesign -dv "$APP" 2>&1 | grep -E "Identifier|flags"
done
echo "Hazır: $OUT/app-ent/P33A2.app ve $OUT/app-noent/P33A2.app"
