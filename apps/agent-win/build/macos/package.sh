#!/bin/sh
# macOS paketleyici (ADR-0037 m.5/m.6, mimari-p28f §6, §8.2 package-mac/sign-mac; S-P28f-4/5/6/14). YALNIZ macOS'ta koşar
# (lipo, codesign, sips, iconutil, plutil, ditto). İnce ikililer Linux'ta build/build-darwin.sh ile derlenir; bu betik onları
# universal yapar, .app paketini kurar, imzalar (ad-hoc ya da Developer ID — HER İKİSİ hardened runtime + aynı entitlements.plist),
# zip'ler ve denetler. CI package-mac (ad-hoc) ve sign-mac (Developer ID) AYNI betiği kullanır.
#
# Kullanım:
#   package.sh bundle <arm64> <amd64> <sürüm> <stg|prod> <stage-dizini>   → <stage>/{Nokta Destek.app, OKUBENI.txt}
#   package.sh sign   <app> <kimlik>                    kimlik "-" = ad-hoc; aksi Developer ID (+ --timestamp)
#   package.sh zip    <stage-dizini> <zip>              sabit mtime (SOURCE_DATE_EPOCH) + ditto; ≤ 60 MiB; iki üst öğe
#   package.sh check  <app> <stg|prod> <sürüm> [team-id] Info.plist izin listesi + entitlement tam eşleşme + imza/runtime/dilim
#   package.sh adhoc  <arm64> <amd64> <sürüm> <stg|prod> <çıktı-dizini> <zip-adı>   bundle + sign - + check + zip
#   package.sh compare <app> <ince-ikili> <arm64|x86_64>  S-P28f-17: paketteki dilim = yeniden derlenen imzasız ince ikili mi
#        (iki taraftan imza kaldırılır; `codesign --remove-signature` __LINKEDIT vmsize'ı geri yüklemediği için TEK izinli fark
#        bu 8 baytlık alandır; o alan eşitlenip dosyanın tamamı `cmp` ile karşılaştırılır)
# Profil: stg → bundle kimliği net.noktabilisim.destek.stg (TEST; TCC kayıtları prod'a taşınmaz), OKUBENI-stg.txt;
#         prod → net.noktabilisim.destek, OKUBENI.txt. stg her zaman ad-hoc olmalıdır (check denetler).
# Ortam: SOURCE_DATE_EPOCH (zip; yoksa git son commit zamanı), CODESIGN_KEYCHAIN (sign; isteğe bağlı keychain yolu).
# Çıkış: 0 tamam · 1 denetim/araç hatası · 2 kullanım hatası. `set -x` YOK (sign-mac'te kimlik/sır günlüğe düşmesin).
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ICON_SRC="$HERE/../../internal/ui/uicore/assets/nokta-kucuk.png"
ENT="$HERE/entitlements.plist"
APP_NAME="Nokta Destek.app"
EXE=noktadestek
MAX_ZIP=62914560 # 60 MiB (AC-389; agent-watch --max-filesize ile aynı)

die() { echo "HATA: $*" >&2; exit 1; }
usage() { sed -n '2,/^set -eu/p' "$0" | sed '$d' >&2; exit 2; }
need_mac() { [ "$(uname -s)" = Darwin ] || die "bu betik yalnız macOS'ta koşar (lipo/codesign)"; }
bundle_id() {
  case "$1" in
    stg) echo net.noktabilisim.destek.stg ;;
    prod) echo net.noktabilisim.destek ;;
    *) echo "profil stg ya da prod olmalı: $1" >&2; exit 2 ;;
  esac
}
check_version() { printf '%s' "$1" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "sürüm x.y.z olmalı: $1" >&2; exit 2; }; }
sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
plist_get() { plutil -extract "$2" raw -o - "$1" 2>/dev/null || true; }

# Fonksiyonlar POSIX sh: değişkenler ortak; yardımcılar kendi önekini kullanır (ic_*).
# Uygulama simgesi nokta-kucuk.png'den üretilir (CLAUDE.md §1.5: kare değil → şeffaf kenarla kareye, oran korunur).
make_icon() {
  ic_out="$1" ic_tmp="$(mktemp -d)"
  ic_w=$(sips -g pixelWidth "$ICON_SRC" | awk '/pixelWidth/ {print $2}')
  ic_h=$(sips -g pixelHeight "$ICON_SRC" | awk '/pixelHeight/ {print $2}')
  ic_side=$ic_w; [ "$ic_h" -gt "$ic_side" ] && ic_side=$ic_h
  sips -p "$ic_side" "$ic_side" "$ICON_SRC" --out "$ic_tmp/kare.png" >/dev/null
  mkdir "$ic_tmp/AppIcon.iconset"
  for ic_s in 16 32 128 256 512; do
    sips -z "$ic_s" "$ic_s" "$ic_tmp/kare.png" --out "$ic_tmp/AppIcon.iconset/icon_${ic_s}x${ic_s}.png" >/dev/null
    ic_d=$((ic_s * 2))
    sips -z "$ic_d" "$ic_d" "$ic_tmp/kare.png" --out "$ic_tmp/AppIcon.iconset/icon_${ic_s}x${ic_s}@2x.png" >/dev/null
  done
  iconutil -c icns "$ic_tmp/AppIcon.iconset" -o "$ic_out"
  rm -rf "${ic_tmp:?}"
}

cmd_bundle() {
  [ $# -eq 5 ] || usage
  a="$1" x="$2" ver="$3" prof="$4" stage="$5"
  check_version "$ver"; bid="$(bundle_id "$prof")"
  [ -f "$a" ] && [ -f "$x" ] || die "ince ikili yok"
  [ "$(lipo -archs "$a")" = arm64 ] || die "$a tek dilim arm64 değil ($(lipo -archs "$a" 2>&1))"
  [ "$(lipo -archs "$x")" = x86_64 ] || die "$x tek dilim x86_64 değil ($(lipo -archs "$x" 2>&1))"
  [ -n "$stage" ] && [ "$stage" != / ] || die "stage dizini boş/kök olamaz"
  rm -rf "${stage:?}"
  app="$stage/$APP_NAME"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
  lipo -create -output "$app/Contents/MacOS/$EXE" "$a" "$x"
  # Artifact yükle/indir çalıştırma bitini korumaz: koşulsuz 0755 (yoksa paket imzalanır ama açılmaz).
  chmod 0755 "$app/Contents/MacOS/$EXE"
  sed -e "s/@BUNDLE_ID@/$bid/" -e "s/@VERSION@/$ver/g" "$HERE/Info.plist.tmpl" > "$app/Contents/Info.plist"
  plutil -lint -s "$app/Contents/Info.plist" || die "Info.plist geçersiz"
  make_icon "$app/Contents/Resources/AppIcon.icns"
  if [ "$prof" = stg ]; then cp "$HERE/OKUBENI-stg.txt" "$stage/OKUBENI.txt"; else cp "$HERE/OKUBENI.txt" "$stage/OKUBENI.txt"; fi
  find "$stage" -type d -exec chmod 0755 {} +
  find "$stage" -type f ! -path "*/Contents/MacOS/$EXE" -exec chmod 0644 {} +
  echo "bundle: $app ($bid $ver; $(lipo -archs "$app/Contents/MacOS/$EXE"))"
}

cmd_sign() {
  [ $# -eq 2 ] || usage
  app="$1" id="$2"
  [ -d "$app/Contents/MacOS" ] || die "$app bir .app paketi değil"
  kc=""; [ -z "${CODESIGN_KEYCHAIN:-}" ] || kc="--keychain $CODESIGN_KEYCHAIN"
  if [ "$id" = - ]; then
    # shellcheck disable=SC2086  # kc bilerek bölünür (boş ya da iki sözcük)
    codesign --force --sign - $kc --options runtime --entitlements "$ENT" "$app"
  else
    # shellcheck disable=SC2086
    codesign --force --sign "$id" $kc --options runtime --timestamp --entitlements "$ENT" "$app"
  fi
  codesign --verify --strict --verbose=2 "$app"
}

cmd_zip() {
  [ $# -eq 2 ] || usage
  stage="$1" zip="$2"
  if [ -z "${SOURCE_DATE_EPOCH:-}" ]; then
    SOURCE_DATE_EPOCH="$(git -C "$HERE" log -1 --format=%ct 2>/dev/null)" || die "SOURCE_DATE_EPOCH yok ve git zamanı okunamadı"
  fi
  printf '%s' "$SOURCE_DATE_EPOCH" | grep -Eq '^[0-9]+$' || die "SOURCE_DATE_EPOCH sayı olmalı"
  top="$(cd "$stage" && find . -mindepth 1 -maxdepth 1 | sed 's#^\./##' | LC_ALL=C sort | tr '\n' '|')"
  [ "$top" = "$APP_NAME|OKUBENI.txt|" ] || die "stage üst öğeleri yalnız '$APP_NAME' + OKUBENI.txt olmalı (bulunan: $top)"
  ts="$(date -u -r "$SOURCE_DATE_EPOCH" +%Y%m%d%H%M.%S)"
  # mtime imza mührüne girmez; yine de sonra --verify ile mührün bozulmadığı denetlenir.
  find "$stage" -exec env TZ=UTC touch -h -t "$ts" {} +
  codesign --verify --strict "$stage/$APP_NAME" || die "sabit mtime sonrası imza doğrulanamadı"
  case "$zip" in /*) ;; *) zip="$(pwd)/$zip" ;; esac
  rm -f "$zip"
  (cd "$stage" && ditto -c -k --norsrc --noextattr --noacl . "$zip")
  size=$(stat -f %z "$zip")
  [ "$size" -le "$MAX_ZIP" ] || die "zip $size bayt > 60 MiB (AC-389)"
  ztop="$(zipinfo -1 "$zip" | cut -d/ -f1 | LC_ALL=C sort -u | tr '\n' '|')"
  [ "$ztop" = "$APP_NAME|OKUBENI.txt|" ] || die "zip üst öğeleri beklenen değil: $ztop"
  echo "zip: $zip ($size bayt, sha256 $(sha "$zip"))"
}

cmd_check() {
  [ $# -eq 3 ] || [ $# -eq 4 ] || usage
  app="$1" prof="$2" ver="$3" team="${4:-}"
  check_version "$ver"; bid="$(bundle_id "$prof")"
  plist="$app/Contents/Info.plist"; bin="$app/Contents/MacOS/$EXE"
  [ -f "$plist" ] && [ -f "$bin" ] || die "$app içinde Info.plist / Contents/MacOS/$EXE yok"
  bad=0
  # 1) Info.plist anahtar kümesi = izin listesi (S-P28f-14; fazla anahtar = dışarıdan tetikleme yüzeyi).
  got="$(plutil -convert json -o - "$plist" | jq -r 'keys[]' | LC_ALL=C sort)"
  want="$(grep -v '^#' "$HERE/info-plist-keys.txt" | sed '/^$/d' | LC_ALL=C sort)"
  if [ "$got" != "$want" ]; then
    echo "FAIL Info.plist anahtar kümesi izin listesiyle aynı değil:" >&2
    printf '%s\n' "$got" > "${TMPDIR:-/tmp}/pk-got.$$"; printf '%s\n' "$want" > "${TMPDIR:-/tmp}/pk-want.$$"
    diff "${TMPDIR:-/tmp}/pk-want.$$" "${TMPDIR:-/tmp}/pk-got.$$" | sed -n 's/^[<>]/  &/p' >&2 || true
    rm -f "${TMPDIR:-/tmp}/pk-got.$$" "${TMPDIR:-/tmp}/pk-want.$$"
    bad=1
  fi
  for k in CFBundleURLTypes CFBundleDocumentTypes NSAppleScriptEnabled NSServices UTExportedTypeDeclarations NSMicrophoneUsageDescription; do
    if plutil -extract "$k" raw -o /dev/null "$plist" >/dev/null 2>&1 || plutil -extract "$k" xml1 -o /dev/null "$plist" >/dev/null 2>&1; then
      echo "FAIL Info.plist yasak anahtar: $k" >&2; bad=1
    fi
  done
  for kv in "CFBundleIdentifier=$bid" "CFBundleExecutable=$EXE" "CFBundleShortVersionString=$ver" "CFBundleVersion=$ver" \
            "LSMinimumSystemVersion=13.0" "LSFileQuarantineEnabled=true"; do
    k="${kv%%=*}" v="${kv#*=}"
    [ "$(plist_get "$plist" "$k")" = "$v" ] || { echo "FAIL Info.plist $k = '$(plist_get "$plist" "$k")' (beklenen '$v')" >&2; bad=1; }
  done
  # 2) Universal: tam olarak x86_64 + arm64.
  archs="$(lipo -archs "$bin" | tr ' ' '\n' | LC_ALL=C sort | tr '\n' ' ')"
  [ "$archs" = "arm64 x86_64 " ] || { echo "FAIL dilimler '$archs' (beklenen arm64 + x86_64)" >&2; bad=1; }
  [ -x "$bin" ] || { echo "FAIL $EXE çalıştırılabilir değil" >&2; bad=1; }
  # 3) İmza geçerli + her dilimde hardened runtime + kimlik = bundle kimliği.
  codesign --verify --strict --verbose=2 "$app" 2>&1 || { echo "FAIL codesign --verify --strict" >&2; bad=1; }
  for a in arm64 x86_64; do
    info="$(codesign -dv --verbose=4 --arch "$a" "$app" 2>&1)" || { echo "FAIL codesign -dv ($a)" >&2; bad=1; continue; }
    printf '%s\n' "$info" | grep -Eq '^CodeDirectory .*flags=0x[0-9a-f]+\(.*runtime' \
      || { echo "FAIL $a diliminde hardened runtime yok (S-P28f-5)" >&2; bad=1; }
    printf '%s\n' "$info" | grep -qx "Identifier=$bid" || { echo "FAIL $a imza kimliği $bid değil" >&2; bad=1; }
    if [ -n "$team" ]; then
      printf '%s\n' "$info" | grep -qx "TeamIdentifier=$team" || { echo "FAIL $a TeamIdentifier $team değil" >&2; bad=1; }
      printf '%s\n' "$info" | grep -q '^Authority=Developer ID Application: ' || { echo "FAIL $a Developer ID Application imzası değil" >&2; bad=1; }
      printf '%s\n' "$info" | grep -q '^Timestamp=' || { echo "FAIL $a güvenli zaman damgası yok (--timestamp)" >&2; bad=1; }
    else
      printf '%s\n' "$info" | grep -qx 'Signature=adhoc' || { echo "FAIL $a ad-hoc değil ama team-id verilmedi" >&2; bad=1; }
    fi
  done
  if [ "$prof" = stg ] && [ -n "$team" ]; then echo "FAIL stg profili Developer ID ile imzalanmaz" >&2; bad=1; fi
  # 4) Entitlement'lar entitlements.plist ile TAM eşleşme (S-P28f-4; fazlası FAIL). Boş liste: codesign hiçbir şey basmaz.
  ent="$(codesign -d --entitlements - --xml "$app" 2>/dev/null || true)"
  if [ -n "$ent" ]; then gotent="$(printf '%s' "$ent" | plutil -convert json -o - -- - | jq -S -c .)"; else gotent='{}'; fi
  wantent="$(plutil -convert json -o - "$ENT" | jq -S -c .)"
  [ "$gotent" = "$wantent" ] || { echo "FAIL entitlement'lar $wantent değil: $gotent" >&2; bad=1; }
  [ "$bad" = 0 ] || die "paket denetimi başarısız ($app)"
  echo "check: GEÇTİ ($bid $ver; dilimler $archs; runtime; entitlements $gotent${team:+; TeamIdentifier $team})"
}

cmd_adhoc() {
  [ $# -eq 6 ] || usage
  a="$1" x="$2" ver="$3" prof="$4" out="$5" zname="$6"
  case "$zname" in */*) die "zip adı yol içeremez" ;; esac
  mkdir -p "$out"
  cmd_bundle "$a" "$x" "$ver" "$prof" "$out/stage"
  cmd_sign "$out/stage/$APP_NAME" -
  cmd_check "$out/stage/$APP_NAME" "$prof" "$ver"
  cmd_zip "$out/stage" "$out/$zname"
}

cmd_compare() {
  [ $# -eq 3 ] || usage
  app="$1" thin="$2" arch="$3"
  case "$arch" in arm64|x86_64) ;; *) echo "dilim arm64 ya da x86_64" >&2; exit 2 ;; esac
  cmp_t="$(mktemp -d)"
  lipo -thin "$arch" "$app/Contents/MacOS/$EXE" -output "$cmp_t/paket"
  cp "$thin" "$cmp_t/yeni"
  codesign --remove-signature "$cmp_t/paket" && codesign --remove-signature "$cmp_t/yeni"
  if [ "$(stat -f %z "$cmp_t/paket")" != "$(stat -f %z "$cmp_t/yeni")" ]; then rm -rf "${cmp_t:?}"; die "$arch: imzasız boyut farklı"; fi
  # segment_command_64: cmd(4) cmdsize(4) segname(16) vmaddr(8) vmsize(8) → vmsize = segname ofseti + 24. Yalnız bu 8 bayt
  # yeni ikiliden kopyalanır; geri kalan dosya bayt bayt aynı olmalı (başka her fark FAIL).
  cmp_o="$(LC_ALL=C grep -obUa '__LINKEDIT' "$cmp_t/paket" | head -1 | cut -d: -f1)"
  cmp_o2="$(LC_ALL=C grep -obUa '__LINKEDIT' "$cmp_t/yeni" | head -1 | cut -d: -f1)"
  if [ -z "$cmp_o" ] || [ "$cmp_o" != "$cmp_o2" ] || [ "$cmp_o" -gt 65536 ]; then rm -rf "${cmp_t:?}"; die "$arch: __LINKEDIT yük komutu bulunamadı"; fi
  dd if="$cmp_t/yeni" of="$cmp_t/paket" bs=1 skip=$((cmp_o + 24)) seek=$((cmp_o + 24)) count=8 conv=notrunc 2>/dev/null
  if cmp -s "$cmp_t/paket" "$cmp_t/yeni"; then
    rm -rf "${cmp_t:?}"; echo "compare $arch: AYNI (imza kaldırıldıktan sonra; __LINKEDIT vmsize hariç bayt bayt)"
  else
    cmp_n="$(cmp -l "$cmp_t/paket" "$cmp_t/yeni" | wc -l | tr -d ' ')"; rm -rf "${cmp_t:?}"
    die "$arch: paketteki dilim yeniden derlenen ikiliden FARKLI ($cmp_n bayt)"
  fi
}

[ $# -ge 1 ] || usage
sub="$1"; shift
need_mac
case "$sub" in
  bundle) cmd_bundle "$@" ;;
  sign) cmd_sign "$@" ;;
  zip) cmd_zip "$@" ;;
  check) cmd_check "$@" ;;
  adhoc) cmd_adhoc "$@" ;;
  compare) cmd_compare "$@" ;;
  -h|--help) usage ;;
  *) echo "bilinmeyen alt komut: $sub" >&2; usage ;;
esac
