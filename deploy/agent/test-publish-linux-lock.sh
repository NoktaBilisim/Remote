#!/usr/bin/env bash
# publish-linux.sh testi (P28g K8b; S-P28g-9/12, S13C-1/3/15). Sunucuya bağlanmaz, konteyner BAŞLATMAZ: `docker compose config`
# (CLI) + AGENT_PUBLISH_RESTART=0 (volume/compose'a dokunmadan geçici klasöre yazar). (1) --apply / --apply-withdraw ortam kilidi ve
# sunucu tarafı ELF/adres denetimi; (2) operatör tarafı --dir --dry-run (ad deseni, SHA256SUMS, ELF başlığı, .invalid); (3) --tag
# --dry-run çevrimdışı: PATH'e konan sahte `gh` ile Release indirme + attestation argümanları (--source-ref refs/tags/<etiket>,
# --signer-workflow) ve prod adres kuralları.
# Kullanım: deploy/agent/test-publish-linux-lock.sh [stg-klasörü]
#   Klasör verilirse (NoktaDestek-linux-x86_64-stg-X.Y.Z + SHA256SUMS; build-linux.sh `test` çıktısı) gerçek ELF ile olumlu yol da sınanır.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
V="$HERE/publish-linux.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
F=0; ok() { echo "PASS  $*"; }; no() { echo "FAIL  $*"; F=$((F + 1)); }
shaf() { (command -v sha256sum >/dev/null && sha256sum "$1" || shasum -a 256 "$1") | cut -d' ' -f1; }
PROD=https://remote.noktabilisim.net
STG=https://stg.remote.noktabilisim.net
mkelf() { # <dosya> <gömülü metin> [e_machine hex, vars. 3e] — sahte ELF64 LE başlığı + metin
  { printf '\177ELF\002\001\001'; head -c 11 /dev/zero; printf "\\x${3:-3e}\\000"; printf 'gövde %s son' "$2"; } >"$1"
}

# ---- (1) sunucu tarafı kilit + adres ----
mkelf "$TMP/p.elf" "$PROD"; WP="$(shaf "$TMP/p.elf")"
mk() {
  local d="$TMP/$1"; shift; mkdir -p "$d"
  cp "$HERE/../docker-compose.yml" "$HERE/../docker-compose.staging.yml" "$d/"
  printf '%s\n' "$@" >"$d/.env"
}
expf() { # <ok|ret> <açıklama> <klasör> <etiket> <dosya> [mesaj parçası]
  local rc=0 w; w="$(shaf "$5")"
  AGENT_PUBLISH_RESTART=0 bash "$V" --apply "$TMP/$3" "$w" "$4" "$5" >"$TMP/o" 2>&1 || rc=$?
  if [ "$1" = ok ] && [ "$rc" = 0 ]; then ok "$2"
  elif [ "$1" = ret ] && [ "$rc" != 0 ] && { [ -z "${6:-}" ] || grep -q -- "$6" "$TMP/o"; }; then ok "$2"
  else no "$2 (rc=$rc: $(tail -1 "$TMP/o"))"; fi
}
exp() { expf "$1" "$2" "$3" "$4" "$TMP/p.elf" "${5:-}"; }
mk prod 'DEPLOY_ENV=production' "PUBLIC_BASE_URL=$PROD"
mk prodbad 'DEPLOY_ENV=production' 'COMPOSE_PROJECT_NAME=remote-stg' "PUBLIC_BASE_URL=$PROD"
mk prodstg 'DEPLOY_ENV=production' "PUBLIC_BASE_URL=\"$STG\""
mk stg 'DEPLOY_ENV=staging' 'COMPOSE_PROJECT_NAME=remote-stg' 'COMPOSE_FILE=docker-compose.yml:docker-compose.staging.yml' "PUBLIC_BASE_URL=$STG"
mk legstg 'DEPLOY_ENV=staging' "PUBLIC_BASE_URL=$PROD" 'LINUX_AGENT_SHA256=eski'
mk stgbad 'DEPLOY_ENV=staging' "PUBLIC_BASE_URL=$STG"
mk dev 'DEPLOY_ENV=development'
mk empty 'DEPLOY_ENV='
mk unknown 'DEPLOY_ENV=prod'

exp ok  "production + vX.Y.Z (prod adresli ELF) -> yayın" prod v0.20.0
exp ret "production + dir-* -> ret" prod dir-20261118-unattested "yalnız Release"
exp ret "production + stg-run-* -> ret" prod stg-run-5-v0.20.0 "yalnız Release"
exp ret "S13C-1: production ama proje remote-stg -> ret" prodbad v0.20.0 "compose projesi 'remote-stg'"
exp ret "S13C-15: production + PUBLIC_BASE_URL stg.* -> ret" prodstg v0.20.0 "PUBLIC_BASE_URL staging"
mkelf "$TMP/stg.elf" "$STG"
expf ret "S-P28g-9: production + staging adresli ELF -> ret" prod v0.20.0 "$TMP/stg.elf" "hedefin adresi"
mkelf "$TMP/both.elf" "$PROD $STG"
expf ret "S-P28g-9: production + prod ve staging adresi birlikte -> ret" prod v0.20.0 "$TMP/both.elf" "staging adresli"
mkelf "$TMP/inv.elf" "$PROD https://destek.example.invalid:4450"
expf ret "S-P28g-9: .invalid içeren ELF -> ret" prod v0.20.0 "$TMP/inv.elf" ".invalid"
mkelf "$TMP/arm.elf" "$PROD" b7
expf ret "x86-64 olmayan ELF (aarch64) -> ret" prod v0.20.0 "$TMP/arm.elf" "x86-64 ELF değil"
printf 'MZnotelf %s' "$PROD" >"$TMP/x.bin"
expf ret "ELF olmayan dosya -> ret" dev dir-1 "$TMP/x.bin" "ELF64"
expf ok  "staging (ikinci yığın) + stg-run-* + stg adresli ELF -> yayın" stg stg-run-5-v0.20.0 "$TMP/stg.elf"
exp ret "staging (ikinci yığın) + prod adresli ELF -> ret (başka sunucuya bağlanır)" stg dir-1 "hedefin adresi"
exp ok  "tek yığın staging (proje remote) + dir-* TEST ELF -> yayın" legstg dir-20261118-unattested
exp ok  "tek yığın staging + vX.Y.Z -> yayın" legstg v0.20.0
exp ret "staging + run-* (tanımsız köken) -> ret" stg run-123 "yalnız stg-\*/dir-\*"
exp ret "S13C-15: proje remote + PUBLIC_BASE_URL stg.* + dir-* -> ret" stgbad dir-1 "PUBLIC_BASE_URL staging"
exp ok  "development + dir-* -> yayın (adres denetimi yok)" dev dir-1
exp ret "S13C-3: DEPLOY_ENV boş -> ret" empty dir-1 "development|staging|production olmalı"
exp ret "S13C-3: DEPLOY_ENV bilinmeyen -> ret" unknown v0.20.0 "development|staging|production olmalı"
[ ! -e "$TMP/empty/agent/downloads/NoktaDestek-linux" ] && [ ! -e "$TMP/prodbad/agent/downloads/NoktaDestek-linux" ] \
  && ok "reddedilen hedeflere dosya yazılmadı" || no "reddedilen hedefe dosya yazıldı"
[ "$(grep -c '^LINUX_AGENT_SHA256=' "$TMP/legstg/.env")" = 1 ] && grep -qx "LINUX_AGENT_SHA256=$WP" "$TMP/legstg/.env" \
  && ok ".env LINUX_AGENT_SHA256 tek satır, güncellendi" || no ".env LINUX_AGENT_SHA256 güncellenmedi/çiftlendi"
grep -q " linux v0.20.0 $WP\$" "$TMP/legstg/agent/PUBLISHED.log" && ok "PUBLISHED.log linux satırı" || no "PUBLISHED.log linux satırı yok"
cmp -s "$TMP/p.elf" "$TMP/legstg/agent/downloads/NoktaDestek-linux" && ok "hedef dosya sabit adla (NoktaDestek-linux) yazıldı" || no "hedef dosya"
rc=0; AGENT_PUBLISH_RESTART=0 bash "$V" --apply "$TMP/dev" "$(printf '%064d' 0)" dir-1 "$TMP/p.elf" >"$TMP/o" 2>&1 || rc=$?
[ "$rc" != 0 ] && grep -q 'beklenenden farklı' "$TMP/o" && ok "SHA uyuşmaz aktarım -> ret" || no "SHA uyuşmaz aktarım geçti"
rc=0; AGENT_PUBLISH_RESTART=0 bash "$V" --apply-withdraw "$TMP/legstg" >"$TMP/o" 2>&1 || rc=$?
[ "$rc" = 0 ] && grep -qx 'LINUX_AGENT_SHA256=' "$TMP/legstg/.env" && ok "--apply-withdraw: LINUX_AGENT_SHA256 boşaltıldı" || no "withdraw (rc=$rc)"
rc=0; AGENT_PUBLISH_RESTART=0 bash "$V" --apply-withdraw "$TMP/empty" >"$TMP/o" 2>&1 || rc=$?
[ "$rc" != 0 ] && ok "--apply-withdraw DEPLOY_ENV boş -> ret" || no "withdraw boş ortamda geçti"

# ---- (2) operatör tarafı --dir (ağ yok) ----
op() { # <ok|ret> <açıklama> <klasör> [mesaj]
  local rc=0
  ALLOW_UNATTESTED=staging bash "$V" --dir "$3" --no-attestation --dry-run >"$TMP/o" 2>&1 || rc=$?
  if [ "$1" = ok ] && [ "$rc" = 0 ]; then ok "$2"
  elif [ "$1" = ret ] && [ "$rc" != 0 ] && { [ -z "${4:-}" ] || grep -q -- "$4" "$TMP/o"; }; then ok "$2"
  else no "$2 (rc=$rc: $(tail -1 "$TMP/o"))"; fi
}
mkd() { # <klasör> <ad> <kaynak elf>
  mkdir -p "$TMP/$1"; cp "$3" "$TMP/$1/$2"; (cd "$TMP/$1" && shaf "$2" | sed "s/\$/  $2/" >SHA256SUMS)
}
rc=0; bash "$V" --dir "$TMP" --no-attestation --dry-run >"$TMP/o" 2>&1 || rc=$?
[ "$rc" != 0 ] && grep -q 'ALLOW_UNATTESTED=staging' "$TMP/o" && ok "--no-attestation ALLOW_UNATTESTED olmadan -> ret" || no "ALLOW_UNATTESTED denetimi"
rc=0; ALLOW_UNATTESTED=staging bash "$V" --tag v0.20.0 --no-attestation --dry-run >"$TMP/o" 2>&1 || rc=$?
[ "$rc" != 0 ] && grep -q 'yalnız --dir ile' "$TMP/o" && ok "--tag + --no-attestation -> ret" || no "--tag attestation'sız geçti"
mkd iyi NoktaDestek-linux-x86_64-stg-0.20.0 "$TMP/p.elf"
op ok  "--dir + -stg- adlı ELF -> doğrulandı (dry-run)" "$TMP/iyi"
mkd adsiz NoktaDestek-linux-x86_64-0.20.0 "$TMP/p.elf"
op ret "--dir + -stg- olmayan (Release) ad -> ret" "$TMP/adsiz" "stg-X.Y.Z olmalı"
mkd shabad NoktaDestek-linux-x86_64-stg-0.20.0 "$TMP/p.elf"
printf '%064d  NoktaDestek-linux-x86_64-stg-0.20.0\n' 0 >"$TMP/shabad/SHA256SUMS"
op ret "--dir + SHA256SUMS uyuşmaz -> ret" "$TMP/shabad" "SHA-256 uyuşmuyor"
mkd inv NoktaDestek-linux-x86_64-stg-0.20.0 "$TMP/inv.elf"
op ret "--dir + .invalid adresli ELF -> ret" "$TMP/inv" ".invalid"
mkd notelf NoktaDestek-linux-x86_64-stg-0.20.0 "$TMP/x.bin"
op ret "--dir + ELF olmayan -> ret" "$TMP/notelf" "ELF64"

# ---- (3) --tag --dry-run, sahte gh ----
mkdir -p "$TMP/bin"
cat >"$TMP/bin/gh" <<'GH'
#!/usr/bin/env bash
# Sahte gh: çağrıyı kaydeder; release download → $GH_SRC'deki dosyaları -D hedefine kopyalar; attestation verify → 0.
printf '%s\n' "$*" >> "$GH_LOG"
if [ "$1 $2" = "release download" ]; then
  d=""; while [ $# -gt 0 ]; do [ "$1" = -D ] && d="$2"; shift; done
  cp "$GH_SRC"/* "$d/"; exit 0
fi
[ "$1 $2" = "attestation verify" ] && exit 0
exit 1
GH
chmod +x "$TMP/bin/gh"
tag() { # <ok|ret> <açıklama> <kaynak elf> <AGENT_SERVER_URL> [mesaj] [Release dosya adı]
  local rc=0 n="${6:-NoktaDestek-linux-x86_64-0.20.0}"
  rm -rf "$TMP/rel" && mkdir "$TMP/rel" && cp "$3" "$TMP/rel/$n" && (cd "$TMP/rel" && shaf "$n" | sed "s/\$/  $n/" >SHA256SUMS)
  : >"$TMP/gh.log"
  PATH="$TMP/bin:$PATH" GH_LOG="$TMP/gh.log" GH_SRC="$TMP/rel" AGENT_SERVER_URL="$4" \
    bash "$V" --tag v0.20.0 --dry-run >"$TMP/o" 2>&1 || rc=$?
  if [ "$1" = ok ] && [ "$rc" = 0 ]; then ok "$2"
  elif [ "$1" = ret ] && [ "$rc" != 0 ] && { [ -z "${5:-}" ] || grep -q -- "$5" "$TMP/o"; }; then ok "$2"
  else no "$2 (rc=$rc: $(tail -1 "$TMP/o"))"; fi
}
tag ok  "--tag prod ELF + AGENT_SERVER_URL -> doğrulandı" "$TMP/p.elf" "$PROD"
grep -q -- "attestation verify .*NoktaDestek-linux-x86_64-0.20.0 --repo NoktaBilisim/Remote --signer-workflow NoktaBilisim/Remote/.github/workflows/agent-win.yml --deny-self-hosted-runners --source-ref refs/tags/v0.20.0" "$TMP/gh.log" \
  && ok "--tag attestation: --signer-workflow agent-win.yml + --source-ref refs/tags/v0.20.0" || no "attestation argümanları: $(grep attestation "$TMP/gh.log")"
grep -q -- "release download v0.20.0 .*-p NoktaDestek-linux-x86_64-0.20.0 -p SHA256SUMS" "$TMP/gh.log" && ok "--tag Release dosyası + SHA256SUMS indirilir" || no "release download: $(head -1 "$TMP/gh.log")"
tag ret "--tag AGENT_SERVER_URL yok -> ret" "$TMP/p.elf" "" "AGENT_SERVER_URL"
tag ret "--tag AGENT_SERVER_URL = staging adresi -> ret" "$TMP/stg.elf" "$STG" "prod adresi değil"
tag ret "--tag ELF'te prod adresi yok -> ret" "$TMP/stg.elf" "$PROD" "prod adresi"
tag ret "--tag ELF'te prod + staging adresi -> ret" "$TMP/both.elf" "$PROD" "staging adresi var"
tag ret "--tag .invalid adresli ELF -> ret" "$TMP/inv.elf" "$PROD" ".invalid"
tag ret "--tag Release'te -stg- adlı dosya -> ret (indirilecek ad yok)" "$TMP/p.elf" "$PROD" "SHA256SUMS'ta tek" NoktaDestek-linux-x86_64-stg-0.20.0

if [ -n "${1:-}" ]; then
  op ok "--dir gerçek TEST ELF'i ($1) -> doğrulandı (dry-run)" "$1"
  grep -E 'ELF:|parmak izi' "$TMP/o" | sed 's/^/      /'
fi
echo
if [ "$F" = 0 ]; then echo "SONUÇ: GEÇTİ"; else echo "SONUÇ: $F FAIL"; exit 1; fi
