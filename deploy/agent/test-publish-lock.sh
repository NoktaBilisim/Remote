#!/usr/bin/env bash
# verify-and-publish.sh --apply ortam kilidi testi (P13c; S13C-1/3) + publish-servis.sh --apply izinli liste (P32 K3, AC-529). Sunucuya bağlanmaz, konteyner BAŞLATMAZ: yalnız
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

# ---------- P32 K3 (mimari-p32 §8.1, AC-529, S-P32-3/6/9): publish-servis.sh --apply izinli liste ----------
# AGENT_PUBLISH_RESTART=0: volume/compose'a dokunmaz, ikiliyi $dir/agent/unattended/ altına yazar. Sunucuya bağlanmaz.
P="$HERE/publish-servis.sh"
shaf() { (command -v sha256sum >/dev/null && sha256sum "$1" || shasum -a 256 "$1") | cut -d' ' -f1; }
mode() { ls -ln "$1" | cut -c1-10; }
hx() { printf '%064x\n' "$1"; }   # sahte liste öğesi (64 hane)
for i in 1 2 3; do printf 'MZservis%s' "$i" >"$TMP/s$i.exe"; done
S1="$(shaf "$TMP/s1.exe")"; S2="$(shaf "$TMP/s2.exe")"; S3="$(shaf "$TMP/s3.exe")"
mks() {  # mks <ad> <DEPLOY_ENV> [ek .env satırları...] -> $TMP/<ad>, .env 644 (kip korunmalı)
  local d="$TMP/$1" e="$2"; shift 2; rm -rf "$d"; mkdir -p "$d"; cp "$HERE/../docker-compose.yml" "$d/"
  printf '%s\n' "DEPLOY_ENV=$e" 'IMAGE_TAG=x' "$@" >"$d/.env"; chmod 644 "$d/.env"
}
# pub <klasör> <dosya no> <etiket> -> $TMP/po (çıktı), RC
pub() {
  local w; case "$2" in 1) w="$S1" ;; 2) w="$S2" ;; *) w="$S3" ;; esac
  RC=0; AGENT_PUBLISH_RESTART=0 bash "$P" --apply "$TMP/$1" "$w" "$3" "$TMP/s$2.exe" >"$TMP/po" 2>&1 || RC=$?
}
ev() { awk -F= -v k="$2" '$1 == k {sub(/^[^=]*=/, ""); print}' "$TMP/$1/.env"; }
cntk() { grep -c "^$2=" "$TMP/$1/.env"; }
chk() { if eval "$2"; then ok "$1"; else no "$1 (rc=$RC: $(tail -2 "$TMP/po" | tr '\n' ' '))"; fi; }

mks sp production 'UNATTENDED_MODE=off'
pub sp 1 v0.23.0
chk "AC-529 prod + v0.23.0 -> liste tek öğe + UNATTENDED_AGENT_VERSION=0.23.0 + AGENT_SHA" \
  '[ "$RC" = 0 ] && [ "$(ev sp UNATTENDED_SIGNED_SHA256)" = "$S1" ] && [ "$(ev sp UNATTENDED_AGENT_VERSION)" = 0.23.0 ] && [ "$(ev sp UNATTENDED_AGENT_SHA256)" = "$S1" ]'
chk "PUBLISHED.log satırı '<ts> servis v0.23.0 <sha>'" \
  'awk -v s="$S1" '"'"'$2=="servis" && $3=="v0.23.0" && $4==s'"'"' "$TMP/sp/agent/PUBLISHED.log" | grep -q .'
pub sp 1 v0.23.0
chk "aynı SHA ikinci kez -> listede tekrar yok, anahtar satırları tek" \
  '[ "$RC" = 0 ] && [ "$(ev sp UNATTENDED_SIGNED_SHA256)" = "$S1" ] && [ "$(cntk sp UNATTENDED_SIGNED_SHA256)" = 1 ] && [ "$(cntk sp UNATTENDED_AGENT_SHA256)" = 1 ] && [ "$(cntk sp UNATTENDED_AGENT_VERSION)" = 1 ]'
pub sp 2 v0.24.0
chk "ikinci sürüm -> iki öğe, sıra korunur, sürüm 0.24.0" \
  '[ "$RC" = 0 ] && [ "$(ev sp UNATTENDED_SIGNED_SHA256)" = "$S1,$S2" ] && [ "$(ev sp UNATTENDED_AGENT_VERSION)" = 0.24.0 ]'
chk "dosya kipleri: .env kipi korundu (644), yedek 600, geçici dosya kalmadı" \
  '[ "$(mode "$TMP/sp/.env")" = "-rw-r--r--" ] && for b in "$TMP"/sp/.env.bak.servis.*; do [ "$(mode "$b")" = "-rw-------" ] || exit 1; done && ! ls "$TMP"/sp/.env.tmp.* >/dev/null 2>&1'
cp "$TMP/sp/.env" "$TMP/sp.env.before"
pub sp 3 dir-20261120-unattested
chk "prod + dir-* -> ret, .env değişmedi, ikili yazılmadı" \
  '[ "$RC" != 0 ] && grep -q "yalnız Release etiketi" "$TMP/po" && cmp -s "$TMP/sp/.env" "$TMP/sp.env.before" && [ "$(shaf "$TMP/sp/agent/unattended/NoktaDestekServis.exe")" = "$S2" ]'
mks ss staging "UNATTENDED_SIGNED_SHA256=$S1" 'UNATTENDED_AGENT_VERSION=0.23.0' "UNATTENDED_AGENT_SHA256=$S1"
pub ss 2 dir-20261120-unattested
chk "S-P32-3 staging + dir-* -> yayın, liste DEĞİŞMEDİ, UNATTENDED_AGENT_VERSION boşaltıldı" \
  '[ "$RC" = 0 ] && [ "$(ev ss UNATTENDED_SIGNED_SHA256)" = "$S1" ] && [ "$(cntk ss UNATTENDED_AGENT_VERSION)" = 1 ] && [ -z "$(ev ss UNATTENDED_AGENT_VERSION)" ] && [ "$(ev ss UNATTENDED_AGENT_SHA256)" = "$S2" ]'
mks sd development
pub sd 1 v0.23.0
chk "development + v0.23.0 -> listeye eklenir (tüm ortamlarda)" '[ "$RC" = 0 ] && [ "$(ev sd UNATTENDED_SIGNED_SHA256)" = "$S1" ]'
mks sn production "UNATTENDED_SIGNED_SHA256= $(printf %s "$S1" | tr a-f A-F) , ,"
pub sn 1 v0.23.0
chk "normalizasyon: büyük harf + boşluk + boş öğe -> küçük harf, tek öğe (server ile aynı kural)" \
  '[ "$RC" = 0 ] && [ "$(ev sn UNATTENDED_SIGNED_SHA256)" = "$S1" ]'
L15="$(for i in $(seq 1 15); do hx "$i"; done | paste -sd, -)"
mks s15 production "UNATTENDED_SIGNED_SHA256=$L15"
pub s15 1 v0.23.0
chk "S-P32-6 15 öğe + yeni -> 16: UYARI, yayın sürer" \
  '[ "$RC" = 0 ] && grep -q "UYARI: UNATTENDED_SIGNED_SHA256 16 öğe" "$TMP/po" && [ "$(ev s15 UNATTENDED_SIGNED_SHA256)" = "$L15,$S1" ]'
L20="$(for i in $(seq 1 20); do hx "$i"; done | paste -sd, -)"
mks s20 production "UNATTENDED_SIGNED_SHA256=$L20"
cp "$TMP/s20/.env" "$TMP/s20.env.before"
pub s20 1 v0.23.0
chk "S-P32-6 20 dolu + yeni -> ret 'liste dolu', .env değişmedi, ikili/yedek/PUBLISHED.log yok" \
  '[ "$RC" != 0 ] && grep -q "liste dolu" "$TMP/po" && cmp -s "$TMP/s20/.env" "$TMP/s20.env.before" && [ ! -e "$TMP/s20/agent/unattended/NoktaDestekServis.exe" ] && ! ls "$TMP"/s20/.env.bak.servis.* >/dev/null 2>&1 && [ ! -e "$TMP/s20/agent/PUBLISHED.log" ]'
L19="$(for i in $(seq 1 19); do hx "$i"; done | paste -sd, -)"
mks s20b production "UNATTENDED_SIGNED_SHA256=$L19,$S1"
pub s20b 1 v0.23.0
chk "20 dolu ama SHA zaten listede -> yeniden yayın geçer, liste aynı" '[ "$RC" = 0 ] && [ "$(ev s20b UNATTENDED_SIGNED_SHA256)" = "$L19,$S1" ]'
mks sb production
for i in $(seq 10 21); do : >"$TMP/sb/.env.bak.servis.20261101T0000${i}Z"; done
pub sb 1 v0.23.0
chk "S-P32-9 12 eski yedek + yeni -> en yeni 10 yedek kalır (yenisi dahil)" \
  '[ "$RC" = 0 ] && [ "$(ls "$TMP"/sb/.env.bak.servis.* | wc -l | tr -d " ")" = 10 ] && [ ! -e "$TMP/sb/.env.bak.servis.20261101T000010Z" ] && [ ! -e "$TMP/sb/.env.bak.servis.20261101T000012Z" ] && [ -e "$TMP/sb/.env.bak.servis.20261101T000013Z" ]'
mks sa production 'UNATTENDED_MODE=off'; chmod 640 "$TMP/sa/.env"
ino() { ls -i "$1" | awk '{print $1}'; }
# shellcheck disable=SC2034  # ia/oa aşağıdaki chk eval dizesinde kullanılır
ia="$(ino "$TMP/sa/.env")"
# shellcheck disable=SC2034
oa="$(ls -ln "$TMP/sa/.env" | awk '{print $3":"$4}')"
pub sa 1 v0.23.0
chk "S-P32-K-2 .env atomik yazılır: yeni inode (rename), kip 640 ve sahiplik korunur, geçici dosya kalmaz" \
  '[ "$RC" = 0 ] && [ "$(ino "$TMP/sa/.env")" != "$ia" ] && [ "$(mode "$TMP/sa/.env")" = "-rw-r-----" ] && [ "$(ls -ln "$TMP/sa/.env" | awk "{print \$3\":\"\$4}")" = "$oa" ] && [ "$(ev sa UNATTENDED_SIGNED_SHA256)" = "$S1" ] && ! ls "$TMP"/sa/.env.tmp.* >/dev/null 2>&1'
grep -q 'mv -f "$dir/.env.tmp.$ts" "$dir/.env"' "$P" && ! grep -q 'cat "$dir/.env.tmp' "$P" && ok "S-P32-K-2 publish-servis.sh .env'i yerinde üzerine yazmıyor (mv -f)" || no "S-P32-K-2 .env yazımı atomik değil"
grep -q '^umask 077$' "$P" && ok "publish-servis.sh umask 077 (geçici dosya 600)" || no "publish-servis.sh umask 077 yok"

echo
if [ "$F" = 0 ]; then echo "SONUÇ: GEÇTİ"; else echo "SONUÇ: $F FAIL"; exit 1; fi
