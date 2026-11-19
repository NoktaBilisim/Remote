#!/usr/bin/env bash
# publish-mac.sh testi (P28f K8b; S-P28f-3/7, S13C-1/3/15). Sunucuya bağlanmaz, konteyner BAŞLATMAZ: `docker compose config`
# (CLI) + AGENT_PUBLISH_RESTART=0 (volume/compose'a dokunmadan geçici klasöre yazar). (1) --apply / --apply-withdraw ortam kilidi;
# (2) operatör tarafı zip doğrulaması (--dir --dry-run): ad deseni, SHA256SUMS, iki üst öğe, yol kaçışı, bundle kimliği .stg;
# (3) r4 (K-P28f-r4-9, S-r4-5): --tag dal seçimi ve ad-hoc predicate alanları — `gh` PATH'te SAHTE (fikstür; ağ yok).
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
exp() { # <ok|ret> <açıklama> <klasör> <etiket> [mesaj parçası] — imza türü $SIG (vars. adhoc), dosya $ZF (vars. z.zip)
  local rc=0 zf="${ZF:-$TMP/z.zip}"
  AGENT_PUBLISH_RESTART=0 bash "$V" --apply "$TMP/$3" "$(shaf "$zf")" "$4" "$zf" "${SIG:-adhoc}" >"$TMP/o" 2>&1 || rc=$?
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

exp ok  "r4: production + vX.Y.Z (ad-hoc Release) -> yayın" prod v0.19.0
exp ret "production + dir-* (ad-hoc TEST) -> ret" prod dir-20261117-unattested "yalnız attestation'lı Release (vX.Y.Z; notarize ya da ad-hoc)"
exp ret "production + stg-run-* -> ret" prod stg-run-5-v0.19.0 "yalnız attestation'lı Release (vX.Y.Z; notarize ya da ad-hoc)"
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
grep -q " mac dir-20261117-unattested $W adhoc\$" "$TMP/legstg/agent/PUBLISHED.log" && ok "PUBLISHED.log mac satırı (+ imza türü)" || no "PUBLISHED.log mac satırı yok"
[ "$(grep -c '^MAC_AGENT_SIGNING=' "$TMP/legstg/.env")" = 1 ] && grep -qx 'MAC_AGENT_SIGNING=adhoc' "$TMP/legstg/.env" \
  && ok "S-r4-7: .env MAC_AGENT_SIGNING tek satır, adhoc" || no ".env MAC_AGENT_SIGNING yazılmadı/çiftlendi"
rc=0; AGENT_PUBLISH_RESTART=0 bash "$V" --apply-withdraw "$TMP/legstg" >"$TMP/o" 2>&1 || rc=$?
[ "$rc" = 0 ] && grep -qx 'MAC_AGENT_SHA256=' "$TMP/legstg/.env" && grep -qx 'MAC_AGENT_SIGNING=' "$TMP/legstg/.env" \
  && [ "$(grep -c '^MAC_AGENT_S' "$TMP/legstg/.env")" = 2 ] && ok "--apply-withdraw: MAC_AGENT_SHA256 + MAC_AGENT_SIGNING boşaltıldı" || no "withdraw (rc=$rc)"
# r4: 6. argüman enum; eksik argüman kullanım hatası
SIG=developer-id exp ret "r4: --apply imza türü enum dışı -> ret" dev dir-1 "adhoc|notarized olmalı"
SIG=" adhoc" exp ret "r4: --apply imza türü boşluklu -> ret" dev dir-1 "adhoc|notarized olmalı"
rc=0; AGENT_PUBLISH_RESTART=0 bash "$V" --apply "$TMP/dev" "$W" dir-1 "$TMP/z.zip" >"$TMP/o" 2>&1 || rc=$?
[ "$rc" = 2 ] && ok "r4: --apply 5 argüman (imza türü yok) -> kullanım hatası" || no "--apply 5 argümanla geçti (rc=$rc)"
# S-r4-6: notarize yayından ad-hoc'a düşüş önce --withdraw ister; ret dosyaya ve .env'e dokunmaz
mk prodn 'DEPLOY_ENV=production' 'PUBLIC_BASE_URL=https://remote.noktabilisim.net' 'MAC_AGENT_SHA256=' 'MAC_AGENT_SIGNING='
SIG=notarized exp ok "r4: production + notarize Release -> yayın" prodn v0.19.0
grep -qx 'MAC_AGENT_SIGNING=notarized' "$TMP/prodn/.env" && ok ".env MAC_AGENT_SIGNING=notarized" || no ".env notarized yazılmadı"
printf 'PK\003\004baska' >"$TMP/z2.zip"; envsum="$(shaf "$TMP/prodn/.env")"
ZF="$TMP/z2.zip" exp ret "S-r4-6: hedef notarized + ad-hoc yayın (withdraw yok) -> ret" prodn v0.20.0 "açık --withdraw gerekir"
[ "$(shaf "$TMP/prodn/.env")" = "$envsum" ] && [ "$(shaf "$TMP/prodn/agent/downloads/NoktaDestek-macOS.zip")" = "$W" ] \
  && ok "S-r4-6: ret .env'e ve yayındaki zip'e dokunmadı" || no "S-r4-6 reddi .env/zip değiştirdi"
SIG=notarized ZF="$TMP/z2.zip" exp ok "hedef notarized + yeni notarize yayın -> yayın" prodn v0.20.0
AGENT_PUBLISH_RESTART=0 bash "$V" --apply-withdraw "$TMP/prodn" >"$TMP/o" 2>&1 || true
exp ok "S-r4-6: --withdraw sonrası ad-hoc yayın -> yayın" prodn v0.21.0
grep -qx "MAC_AGENT_SHA256=$W" "$TMP/prodn/.env" && grep -qx 'MAC_AGENT_SIGNING=adhoc' "$TMP/prodn/.env" \
  && [ "$(grep -c '^MAC_AGENT_S' "$TMP/prodn/.env")" = 2 ] && ok "S-r4-7: SHA + imza türü birlikte, tek satır" || no "SHA/imza çifti tutarsız"
[ "$(find "$TMP/prodn" -maxdepth 1 -name '.env.bak.mac.*' | wc -l | tr -d ' ')" -ge 1 ] && ok ".env.bak.mac.* yedeği var" || no "yedek yok"
rc=0; AGENT_PUBLISH_RESTART=0 bash "$V" --apply-withdraw "$TMP/empty" >"$TMP/o" 2>&1 || rc=$?
[ "$rc" != 0 ] && ok "--apply-withdraw DEPLOY_ENV boş -> ret" || no "withdraw boş ortamda geçti"
printf 'MZnotzip' >"$TMP/x.zip"; W2="$(shaf "$TMP/x.zip")"; rc=0
AGENT_PUBLISH_RESTART=0 bash "$V" --apply "$TMP/dev" "$W2" dir-1 "$TMP/x.zip" adhoc >"$TMP/o" 2>&1 || rc=$?
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

# ---- (3) r4 --tag dalları: sahte gh (release download -> $FAKE_REL; attestation verify --predicate-type -> $FAKE_ATT/<tür>.json) ----
mkdir -p "$TMP/bin"
cat >"$TMP/bin/gh" <<'GH'
#!/usr/bin/env bash
case "$1 $2" in
  "release download") d=""; while [ $# -gt 0 ]; do [ "$1" = -D ] && d="$2"; shift; done; cp "$FAKE_REL"/* "$d/" ;;
  "attestation verify") pt="" jx=""
    while [ $# -gt 0 ]; do case "$1" in --predicate-type) pt="$2"; shift ;; --jq) jx="$2"; shift ;; esac; shift; done
    [ -n "$pt" ] || exit 0
    case "$pt" in */macos-adhoc/v1) a=adhoc ;; */macos-notarized/v1) a=notarized ;; *) exit 1 ;; esac
    [ -f "$FAKE_ATT/$a.json" ] || { echo "no attestations found" >&2; exit 1; }
    if [ -n "$jx" ]; then jq -r "$jx" "$FAKE_ATT/$a.json"; else cat "$FAKE_ATT/$a.json"; fi ;;
  *) echo "sahte gh: $*" >&2; exit 1 ;;
esac
GH
chmod 0755 "$TMP/bin/gh"
# Release fikstürü: prod bundle kimliği, ad etiketle; macOS'ta gerçek ad-hoc imza (codesign --verify --strict + Signature=adhoc).
R="$TMP/rel"; RS="$TMP/rel.s"; RA="$RS/Nokta Destek.app"; mkdir -p "$R" "$RA/Contents/MacOS" "$RA/Contents/_CodeSignature"
printf '<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>net.noktabilisim.destek</string><key>CFBundleExecutable</key><string>noktadestek</string></dict></plist>\n' >"$RA/Contents/Info.plist"
if [ "$(uname -s)" = Darwin ]; then cp /usr/bin/true "$RA/Contents/MacOS/noktadestek"; codesign -s - --force "$RA" 2>/dev/null
else echo x >"$RA/Contents/MacOS/noktadestek"; echo x >"$RA/Contents/_CodeSignature/CodeResources"; fi
echo x >"$RS/OKUBENI.txt"; RZ=NoktaDestek-macOS-0.23.0.zip
(cd "$RS" && zip -qry "$R/$RZ" .); (cd "$R" && shaf "$RZ" | sed "s/\$/  $RZ/" >SHA256SUMS)
EXE="$(shaf "$RA/Contents/MacOS/noktadestek")"
att() { # <klasör> <tür> <jq predicate dizisi>
  mkdir -p "$TMP/$1"; jq -n "[$3 | {verificationResult: {statement: {predicate: .}}}]" >"$TMP/$1/$2.json"
}
P='{bundleId:"net.noktabilisim.destek", version:"0.23.0", file:"NoktaDestek-macOS-0.23.0.zip", signature:"adhoc", notarized:false, executableSha256:"'"$EXE"'"}'
tg() { # <ok|ret> <açıklama> <att klasörü> [mesaj] — APPLE_TEAM_ID ortamı $TEAM (vars. tanımsız)
  local rc=0
  if [ -n "${TEAM+x}" ]; then
    APPLE_TEAM_ID="$TEAM" PATH="$TMP/bin:$PATH" FAKE_REL="$R" FAKE_ATT="$TMP/$3" bash "$V" --tag v0.23.0 --dry-run >"$TMP/o" 2>&1 || rc=$?
  else
    env -u APPLE_TEAM_ID PATH="$TMP/bin:$PATH" FAKE_REL="$R" FAKE_ATT="$TMP/$3" bash "$V" --tag v0.23.0 --dry-run >"$TMP/o" 2>&1 || rc=$?
  fi
  if [ "$1" = ok ] && [ "$rc" = 0 ]; then ok "$2"
  elif [ "$1" = ret ] && [ "$rc" != 0 ] && { [ -z "${4:-}" ] || grep -q -- "$4" "$TMP/o"; }; then ok "$2"
  else no "$2 (rc=$rc: $(tail -1 "$TMP/o"))"; fi
}
att a-ok adhoc "$P"
tg ok "r4: --tag APPLE_TEAM_ID tanımsız -> ad-hoc dal, predicate alanları eşleşir" a-ok
grep -q '^dal: adhoc' "$TMP/o" && grep -q '^ad-hoc attestation: OK (1 adet' "$TMP/o" && ok "ad-hoc dal + attestation çıktısı" || no "ad-hoc dal çıktısı yok"
[ "$(uname -s)" != Darwin ] || { grep -q '^imza: ad-hoc' "$TMP/o" && ok "macOS: codesign Signature=adhoc denetlendi" || no "Signature=adhoc denetimi yok"; }
att a-two adhoc "$P, $P"
tg ok "S-r4-5: iki ad-hoc attestation, ikisi de eşleşir -> kabul" a-two
att a-vpre adhoc "$P | .version = \"v0.23.0\""
tg ret "S-r4-5: predicate version 'v' önekli -> ret" a-vpre "alanları uyuşmuyor"
att a-exe adhoc "$P | .executableSha256 = \"$(printf '%064d' 0)\""
tg ret "S-r4-5: executableSha256 zip içi ikili değil -> ret" a-exe "alanları uyuşmuyor"
att a-mix adhoc "$P, ($P | del(.notarized))"
tg ret "S-r4-5: ikinci attestation uyuşmaz (notarized eksik) -> ret (hepsi denetlenir)" a-mix "alanları uyuşmuyor"
att a-sig adhoc "$P | .notarized = true"
tg ret "ad-hoc predicate notarized=true -> ret" a-sig "alanları uyuşmuyor"
att a-file adhoc "$P | .file = \"NoktaDestek-macOS-0.22.0.zip\""
tg ret "ad-hoc predicate başka dosya -> ret" a-file "alanları uyuşmuyor"
mkdir -p "$TMP/a-empty"; echo '[]' >"$TMP/a-empty/adhoc.json"
tg ret "S-r4-5: boş attestation listesi -> ret" a-empty "ad-hoc predicate'li attestation yok"
att a-not notarized '{teamId:"ABCDE12345", notarized:true}'
tg ret "r4: notarize Release + APPLE_TEAM_ID tanımsız (ad-hoc dal) -> ret (karıştırma yok)" a-not "APPLE_TEAM_ID tanımlayın"
TEAM=ABCDE12345 tg ret "r4: ad-hoc Release + APPLE_TEAM_ID tanımlı (notarize dal) -> ret" a-ok "notarized predicate'li attestation yok"
TEAM=abc tg ret "r4: APPLE_TEAM_ID tanımlı ama bozuk -> ret (ad-hoc'a düşmez)" a-ok "10 karakter"

echo
if [ "$F" = 0 ]; then echo "SONUÇ: GEÇTİ"; else echo "SONUÇ: $F FAIL"; exit 1; fi
