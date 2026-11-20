#!/bin/bash
# trace-firm-mac.sh — P31 AC-517 (mimari-p31 §14 D-3): firma klasörüyle açılışın iz testi. trace-check-mac.sh'in
# senaryo sarmalayıcısıdır; arayüz otomasyonu yoktur.
#
# Akış: zip Arşiv İzlencesi gibi `NoktaDestek-Test-abcdefghijklmnop/` klasörüne açılır (ref klasör adından okunur,
# AC-512) → önceki durum → istemci argümansız açılır (`.invalid` sunucu: firma bilgisi ağ hatası → ana ekran) → 15 sn
# sonra SIGTERM → fark + birleşik log taraması; içerik işareti ref'tir (ref hiçbir dosyaya ya da loga yazılmamalı).
#
# Kullanım: trace-firm-mac.sh <zip> <çalışma-dizini>
# Çıkış: trace-check-mac.sh compare'in çıkışı (0 temiz, 1 iz, 2 ortam hatası).
set -euo pipefail
[ $# -eq 2 ] || { sed -n '2,10p' "$0" >&2; exit 2; }
zip=$1 work=$2
here="$(cd "$(dirname "$0")" && pwd)"
ref=abcdefghijklmnop
dir="$work/NoktaDestek-Test-$ref"
app="$dir/Nokta Destek.app"
snap="$work/once.txt"
mkdir -p "$work"
ditto -x -k "$zip" "$dir"
[ -x "$app/Contents/MacOS/noktadestek" ] || { echo "HATA: $app açılamadı" >&2; exit 2; }
bash "$here/trace-check-mac.sh" snapshot "$snap"
since="$(date '+%Y-%m-%d %H:%M:%S')"
"$app/Contents/MacOS/noktadestek" & pid=$!
sleep 15
if kill -0 "$pid" 2>/dev/null; then
  echo "istemci açık; SIGTERM"; kill -TERM "$pid" 2>/dev/null || true
  for _i in $(seq 1 15); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  if kill -0 "$pid" 2>/dev/null; then echo "UYARI: istemci SIGTERM ile kapanmadı; zorla"; kill -KILL "$pid" || true; fi
fi
rc=0; wait "$pid" 2>/dev/null || rc=$?; echo "istemci çıkış kodu $rc"
sleep 2
bash "$here/trace-check-mac.sh" compare "$snap" --since "$since" --bundle "$app" --marker "$ref"
