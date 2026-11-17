#!/usr/bin/env bash
# publish-mac.sh testi (P28f K8b; S-P28f-3/7, S13C-1/3/15). Sunucuya bağlanmaz, konteyner BAŞLATMAZ: `docker compose config`
# (CLI) + AGENT_PUBLISH_RESTART=0 (volume/compose'a dokunmadan geçici klasöre yazar). (1) --apply / --apply-withdraw ortam kilidi;
# (2) operatör tarafı zip doğrulaması (--dir --dry-run): ad deseni, SHA256SUMS, iki üst öğe, yol kaçışı, bundle kimliği .stg.
# Kullanım: deploy/agent/test-publish-mac-lock.sh [stg-zip-klasörü]
#   Klasör verilirse (içinde NoktaDestek-macOS-stg-X.Y.Z.zip + SHA256SUMS; build/macos/package.sh adhoc çıktısı) gerçek
#   paketle olumlu yol da sınanır (macOS'ta ad-hoc imza denetimi dahil). Çıkış 0 = tüm beklentiler tuttu.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
V="$HERE/publish-mac.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
F=0; ok() { echo "PASS  $*"; }; no() { echo "FAIL  $*"; F=$((F + 1)); }
shaf() { (command -v sha256sum >/dev/null && sha256sum "$1" || shasum -a 256 "$1") | cut -d' ' -f1; }

# ---- (1) sunucu tarafı kilit ----
printf 'PK\003\004test' >"$TMP/z.zip"; W="$(shaf "$TMP/z.zip")"
mk() {
  local d="$TMP/$1"; shift; mkdir -p "$d"
  cp "$HERE/../docker-compose.yml" "$HERE/../docker-compose.staging.yml" "$d/"
  printf '%s\n' "$@" >"$d/.env"
}
exp() { # <ok|ret> <açıklama> <klasör> <etiket> [mesaj parçası]
  local rc=0
  AGENT_PUBLISH_RESTART=0 bash "$V" --apply "$TMP/$3" "$W" "$4" "$TMP/z.zip" >"$TMP/o" 2>&1 || rc=$?
  if [ "$1" = ok ] && [ "$rc" = 0 ]; then ok "$2"
  elif [ "$1" = ret ] && [ "$rc" != 0 ] && { [ -z "${5:-}" ] || grep -q -- "$5" "$TMP/o"; }; then ok "$2"
  else no "$2 (rc=$rc: $(tail -1 "$TMP/o"))"; fi
}
mk prod 'DEPLOY_ENV=production' 'PUBLIC_BASE_URL=https://remote.noktabilisim.net'
mk prodbad 'DEPLOY_ENV=production' 'COMPOSE_PROJECT_NAME=remote-stg'
mk prodstg 'DEPLOY_ENV=production' 'PUBLIC_BASE_URL="https://stg.remote.noktabilisim.net"'
mk stg 'DEPLOY_ENV=staging' 'COMPOSE_PROJECT_NAME=remote-stg' 'COMPOSE_FILE=docker-compose.yml:docker-compose.staging.yml'
mk legstg 'DEPLOY_ENV=staging' 'PUBLIC_BASE_URL=https://remote.noktabilisim.net' 'MAC_AGENT_SHA256=eski'
mk stgbad 'DEPLOY_ENV=staging' 'PUBLIC_BASE_URL=https://stg.remote.noktabilisim.net'
mk dev 'DEPLOY_ENV=development'
mk empty 'DEPLOY_ENV='
mk unknown 'DEPLOY_ENV=prod'

exp ok  "production + vX.Y.Z (notarize Release) -> yayın" prod v0.19.0
exp ret "production + dir-* (ad-hoc TEST) -> ret" prod dir-20261117-unattested "notarize edilmiş Release"
exp ret "production + stg-run-* -> ret" prod stg-run-5-v0.19.0 "notarize edilmiş Release"
exp ret "S13C-1: production ama proje remote-stg -> ret" prodbad v0.19.0 "compose projesi 'remote-stg'"
exp ret "S13C-15: production + PUBLIC_BASE_URL stg.* -> ret" prodstg v0.19.0 "PUBLIC_BASE_URL staging"
exp ok  "staging (ikinci yığın) + stg-run-* -> yayın" stg stg-run-5-v0.19.0
exp ok  "staging (ikinci yığın) + dir-* -> yayın" stg dir-20261117-unattested
exp ok  "tek yığın staging (proje remote, §20.8) + dir-* TEST zip -> yayın" legstg dir-20261117-unattested
exp ok  "tek yığın staging + vX.Y.Z -> yayın" legstg v0.19.0
exp ret "staging + run-* (tanımsız köken) -> ret" stg run-123 "yalnız stg-\*/dir-\*"
exp ret "S13C-15: proje remote + PUBLIC_BASE_URL stg.* (yanlış kurulmuş 2. yığın) + dir-* -> ret" stgbad dir-1 "PUBLIC_BASE_URL staging"
exp ok  "development + dir-* -> yayın" dev dir-1
exp ret "S13C-3: DEPLOY_ENV boş -> ret" empty dir-1 "development|staging|production olmalı"
exp ret "S13C-3: DEPLOY_ENV bilinmeyen -> ret" unknown v0.19.0 "development|staging|production olmalı"
[ ! -e "$TMP/empty/agent/downloads/NoktaDestek-macOS.zip" ] && [ ! -e "$TMP/prodbad/agent/downloads/NoktaDestek-macOS.zip" ] \
  && ok "reddedilen hedeflere dosya yazılmadı" || no "reddedilen hedefe dosya yazıldı"
[ "$(grep -c '^MAC_AGENT_SHA256=' "$TMP/legstg/.env")" = 1 ] && grep -qx "MAC_AGENT_SHA256=$W" "$TMP/legstg/.env" \
  && ok ".env MAC_AGENT_SHA256 tek satır, güncellendi" || no ".env MAC_AGENT_SHA256 güncellenmedi/çiftlendi"
grep -q " mac dir-20261117-unattested $W\$" "$TMP/legstg/agent/PUBLISHED.log" && ok "PUBLISHED.log mac satırı" || no "PUBLISHED.log mac satırı yok"
rc=0; AGENT_PUBLISH_RESTART=0 bash "$V" --apply-withdraw "$TMP/legstg" >"$TMP/o" 2>&1 || rc=$?
[ "$rc" = 0 ] && grep -qx 'MAC_AGENT_SHA256=' "$TMP/legstg/.env" && ok "--apply-withdraw: MAC_AGENT_SHA256 boşaltıldı" || no "withdraw (rc=$rc)"
rc=0; AGENT_PUBLISH_RESTART=0 bash "$V" --apply-withdraw "$TMP/empty" >"$TMP/o" 2>&1 || rc=$?
[ "$rc" != 0 ] && ok "--apply-withdraw DEPLOY_ENV boş -> ret" || no "withdraw boş ortamda geçti"
printf 'MZnotzip' >"$TMP/x.zip"; W2="$(shaf "$TMP/x.zip")"; rc=0
AGENT_PUBLISH_RESTART=0 bash "$V" --apply "$TMP/dev" "$W2" dir-1 "$TMP/x.zip" >"$TMP/o" 2>&1 || rc=$?
[ "$rc" != 0 ] && grep -q 'zip değil' "$TMP/o" && ok "zip olmayan dosya -> ret" || no "zip olmayan dosya geçti"

# ---- (2) operatör tarafı (--dir --dry-run; ağ yok) ----
op() { # <ok|ret> <açıklama> <klasör> [mesaj]
  local rc=0
  ALLOW_UNATTESTED=staging bash "$V" --dir "$3" --no-attestation --dry-run >"$TMP/o" 2>&1 || rc=$?
  if [ "$1" = ok ] && [ "$rc" = 0 ]; then ok "$2"
  elif [ "$1" = ret ] && [ "$rc" != 0 ] && { [ -z "${4:-}" ] || grep -q -- "$4" "$TMP/o"; }; then ok "$2"
  else no "$2 (rc=$rc: $(tail -1 "$TMP/o"))"; fi
}
rc=0; bash "$V" --dir "$TMP" --no-attestation --dry-run >"$TMP/o" 2>&1 || rc=$?
[ "$rc" != 0 ] && grep -q 'ALLOW_UNATTESTED=staging' "$TMP/o" && ok "--no-attestation ALLOW_UNATTESTED olmadan -> ret" || no "ALLOW_UNATTESTED denetimi"
rc=0; ALLOW_UNATTESTED=staging bash "$V" --tag v0.19.0 --no-attestation --dry-run >"$TMP/o" 2>&1 || rc=$?
[ "$rc" != 0 ] && grep -q 'yalnız --dir ile' "$TMP/o" && ok "--tag + --no-attestation -> ret" || no "--tag attestation'sız geçti"
rc=0; APPLE_TEAM_ID='' bash "$V" --tag v0.19.0 --dry-run >"$TMP/o" 2>&1 || rc=$?
[ "$rc" != 0 ] && grep -q 'APPLE_TEAM_ID' "$TMP/o" && ok "--tag APPLE_TEAM_ID olmadan -> ret" || no "--tag Team ID denetimi"
mkz() { # <klasör> <zip adı> <bundle id> [ek dosya] — yapay paket (imzasız; ad/yapı denetimleri için)
  local d="$TMP/$1" s="$TMP/$1.s"; mkdir -p "$d" "$s/Nokta Destek.app/Contents/MacOS" "$s/Nokta Destek.app/Contents/_CodeSignature"
  printf '<plist><dict><key>CFBundleIdentifier</key>\n\t<string>%s</string></dict></plist>' "$3" >"$s/Nokta Destek.app/Contents/Info.plist"
  echo x >"$s/Nokta Destek.app/Contents/MacOS/noktadestek"; echo x >"$s/Nokta Destek.app/Contents/_CodeSignature/CodeResources"
  echo x >"$s/OKUBENI.txt"; [ -z "${4:-}" ] || echo x >"$s/$4"
  (cd "$s" && zip -qr "$d/$2" .)
  (cd "$d" && shaf "$2" | sed "s/\$/  $2/" >SHA256SUMS)
}
mkz adsiz NoktaDestek-macOS-0.19.0.zip net.noktabilisim.destek.stg
op ret "--dir + -stg- olmayan ad -> ret" "$TMP/adsiz" "NoktaDestek-macOS-stg-X.Y.Z.zip olmalı"
mkz prodid NoktaDestek-macOS-stg-0.19.0.zip net.noktabilisim.destek
op ret "--dir + prod bundle kimliği -> ret" "$TMP/prodid" "beklenen net.noktabilisim.destek.stg"
mkz fazla NoktaDestek-macOS-stg-0.19.0.zip net.noktabilisim.destek.stg ucuncu.txt
op ret "--dir + üçüncü üst öğe -> ret" "$TMP/fazla" "üst öğeleri"
mkz shabad NoktaDestek-macOS-stg-0.19.0.zip net.noktabilisim.destek.stg
printf '%064d  NoktaDestek-macOS-stg-0.19.0.zip\n' 0 >"$TMP/shabad/SHA256SUMS"
op ret "--dir + SHA256SUMS uyuşmaz -> ret" "$TMP/shabad" "SHA-256 uyuşmuyor"
if [ "$(uname -s)" = Darwin ]; then
  mkz imzasiz NoktaDestek-macOS-stg-0.19.0.zip net.noktabilisim.destek.stg
  op ret "--dir + imzasız paket (macOS codesign) -> ret" "$TMP/imzasiz" "codesign"
fi
if [ -n "${1:-}" ]; then
  op ok "--dir gerçek ad-hoc TEST paketi ($1) -> doğrulandı (dry-run)" "$1"
  grep -E 'zip yapısı|parmak izi' "$TMP/o" | sed 's/^/      /'
fi
echo
if [ "$F" = 0 ]; then echo "SONUÇ: GEÇTİ"; else echo "SONUÇ: $F FAIL"; exit 1; fi
