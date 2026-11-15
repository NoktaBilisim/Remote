#!/usr/bin/env bash
# verify-and-publish.sh --apply ortam kilidi testi (P13c; S13C-1/3). Sunucuya bağlanmaz, konteyner BAŞLATMAZ: yalnız
# `docker compose config` (CLI) ve AGENT_PUBLISH_RESTART=0 (volume/compose'a dokunmadan geçici klasöre yazar).
# Hedef klasörler gerçek deploy/docker-compose.yml (+ staging katmanı) kopyasıyla kurulur; .env'de sır yok.
# Kullanım: deploy/agent/test-publish-lock.sh   Çıkış 0 = tüm beklentiler tuttu.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
V="$HERE/verify-and-publish.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
F=0; ok() { echo "PASS  $*"; }; no() { echo "FAIL  $*"; F=$((F + 1)); }
printf 'MZtest' >"$TMP/x.exe"
W="$( (command -v sha256sum >/dev/null && sha256sum "$TMP/x.exe" || shasum -a 256 "$TMP/x.exe") | cut -d' ' -f1)"
mk() {  # <ad> <DEPLOY_ENV satırı> [ek .env satırları...] -> $TMP/<ad>
  local d="$TMP/$1"; shift; mkdir -p "$d"
  cp "$HERE/../docker-compose.yml" "$HERE/../docker-compose.staging.yml" "$d/"
  printf '%s\n' "$@" >"$d/.env"
}
# exp <ok|ret> <açıklama> <klasör> <etiket> [beklenen mesaj parçası]
exp() {
  local rc=0
  AGENT_PUBLISH_RESTART=0 bash "$V" --apply "$TMP/$3" "$W" "$4" "$TMP/x.exe" >"$TMP/o" 2>&1 || rc=$?
  if [ "$1" = ok ] && [ "$rc" = 0 ]; then ok "$2"
  elif [ "$1" = ret ] && [ "$rc" != 0 ] && { [ -z "${5:-}" ] || grep -q -- "$5" "$TMP/o"; }; then ok "$2"
  else no "$2 (rc=$rc: $(tail -1 "$TMP/o"))"; fi
}
mk prod 'DEPLOY_ENV=production'
mk stg 'DEPLOY_ENV="staging"' 'COMPOSE_PROJECT_NAME=remote-stg' 'COMPOSE_FILE=docker-compose.yml:docker-compose.staging.yml'
mk stgfile 'DEPLOY_ENV=staging' 'COMPOSE_FILE=docker-compose.yml:docker-compose.staging.yml'   # yalnız katman: name remote-stg
mk stgbad 'DEPLOY_ENV=staging'                                                                 # katman/ad unutulmuş
mk prodbad 'DEPLOY_ENV=production' 'COMPOSE_PROJECT_NAME=remote-stg'
mk prodstg 'DEPLOY_ENV=production' 'PUBLIC_BASE_URL="https://stg.remote.noktabilisim.net"'     # S13C-15
mk prodsite 'DEPLOY_ENV=production' 'PUBLIC_BASE_URL=https://remote.noktabilisim.net' "SITE_HOST='stg.remote.noktabilisim.net'"
mk prodok 'DEPLOY_ENV=production' 'PUBLIC_BASE_URL=https://remote.noktabilisim.net' 'SITE_HOST=185.126.217.99'
mk legstg 'DEPLOY_ENV=staging' 'PUBLIC_BASE_URL=https://stg.remote.noktabilisim.net'
mk dev 'DEPLOY_ENV=development'
mk empty 'DEPLOY_ENV='
mk unknown 'DEPLOY_ENV=prod'
mk missing 'IMAGE_TAG=x'

exp ok  "production + vX.Y.Z -> yayın" prod v0.11.0
exp ret "production + run-* -> ret" prod run-123 "yalnız Release etiketi"
exp ret "production + dir-* -> ret" prod dir-20261115 "yalnız Release etiketi"
exp ret "production + stg-* -> ret" prod stg-run-5-v0.11.0 "yalnız Release etiketi"
exp ret "S13C-1: production ama proje remote-stg -> ret" prodbad v0.11.0 "compose projesi 'remote-stg'"
exp ok  "staging (tırnaklı DEPLOY_ENV, COMPOSE_PROJECT_NAME) + stg-* -> yayın" stg stg-run-5-v0.11.0
exp ok  "staging + dir-* -> yayın" stg dir-20261115-unattested
exp ret "staging + vX.Y.Z (prod adresli Release) -> ret" stg v0.11.0 "yalnız --stg-run"
exp ret "staging + run-* (prod adresli main push) -> ret" stg run-123 "yalnız --stg-run"
exp ok  "S13C-1: yalnız staging katmanı (COMPOSE_PROJECT_NAME yok) -> proje remote-stg, yayın" stgfile stg-run-5-v0.11.0
exp ret "S13C-1: staging + proje remote + stg-* (ikinci yığın katmanı unutulmuş) -> ret" stgbad stg-run-5-v0.11.0 "compose projesi 'remote'"
exp ok  "S13C-13: tek yığın staging (proje remote, bayraksız) + vX.Y.Z -> yayın" stgbad v0.11.0
exp ret "S13C-13: tek yığın staging + run-* -> ret" stgbad run-123 "compose projesi 'remote'"
exp ret "S13C-13: tek yığın staging + dir-* -> ret" stgbad dir-20261115 "compose projesi 'remote'"
exp ret "S13C-15: proje remote + PUBLIC_BASE_URL stg.* (tırnaklı) -> ret" prodstg v0.11.0 "PUBLIC_BASE_URL staging"
exp ret "S13C-15: proje remote + SITE_HOST stg.* -> ret" prodsite v0.11.0 "SITE_HOST staging"
exp ok  "S13C-15: proje remote + prod adları -> yayın" prodok v0.11.0
exp ret "S13C-15: tek yığın staging görünümlü ama genel ad stg.* -> ret" legstg v0.11.0 "PUBLIC_BASE_URL staging"
exp ok  "development + run-* -> yayın (yerel prova)" dev run-123-failedrun
exp ret "development + stg-* -> ret" dev stg-run-5-v0.11.0 "yalnız DEPLOY_ENV=staging"
exp ret "S13C-3: DEPLOY_ENV boş -> ret (fail-closed)" empty dir-20261115 "development|staging|production olmalı"
exp ret "S13C-3: DEPLOY_ENV bilinmeyen (prod) -> ret" unknown v0.11.0 "development|staging|production olmalı"
exp ret "S13C-3: DEPLOY_ENV satırı yok -> ret" missing run-1 "development|staging|production olmalı"
[ ! -e "$TMP/empty/agent/downloads/NoktaDestek.exe" ] && [ ! -e "$TMP/prodbad/agent/downloads/NoktaDestek.exe" ] \
  && ok "reddedilen hedeflere dosya yazılmadı" || no "reddedilen hedefe dosya yazıldı"
echo
if [ "$F" = 0 ]; then echo "SONUÇ: GEÇTİ"; else echo "SONUÇ: $F FAIL"; exit 1; fi
