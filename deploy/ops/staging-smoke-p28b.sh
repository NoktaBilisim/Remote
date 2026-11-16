#!/usr/bin/env bash
# P28b staging uçtan uca duman testi (K9; runbook §28b.8). YALNIZ staging host'unda (hostname `develop` + DEPLOY_ENV=staging).
# Kimlik: /root/.k9-staging-test.env (k9-staging-account.sh üretir: K9_* Super Admin, K9_TECH_* demo teknisyeni — Super Admin
# destek oturumu açamaz, (c)–(e) için teknisyen şart). TOTP'yi kendisi üretir. Yalnız sonuç satırları basar.
# Adımlar (k9-staging.mjs smoke, Caddy üzerinden gerçek HTTPS + WSS):
#   (a) ClamAV "Bağlantıyı Test Et" (PONG/EICAR/şifreli zip/imza yaşı)   (b) demo firmasında sunucu dosya modu (aydınlatma onayı)
#   (c) destek oturumu + tarayıcı misafiri kabul   (d) EICAR → INFECTED   (e) 50 MB rastgele, 1 MiB parça → CLEAN, AC-357 süresi
#   (g) misafir reddi (dosya silinir), oturum sonu, mod eski değere   (f) server + caddy logunda test dosya adları ve belirteç
#   önekleri 0 eşleşme (pozitif kontrol: dosya kimlikleri server logunda var). Yarıda kalırsa trap geri alma koşar.
# Kullanım (host'ta, root):  bash staging-smoke-p28b.sh      Env: DEPLOY_DIR, K9_FILE, K9_TENANT_SLUG (vars. demo)
set -euo pipefail
umask 077

DEPLOY_DIR="${DEPLOY_DIR:-/opt/remote/deploy}"
K9_FILE="${K9_FILE:-/root/.k9-staging-test.env}"
K9_STATE="${K9_FILE%.env}.state"
HERE="$(cd "$(dirname "$0")" && pwd)"
MJS="$HERE/k9-staging.mjs"

die() { echo "hata: $*" >&2; exit 1; }

# --- Guard ---
[ "$(hostname -s 2>/dev/null || hostname)" = develop ] || die "bu host staging değil (hostname develop bekleniyor)"
[ "$(id -u)" = 0 ] || die "root olarak çalıştırın"
[ -f "$MJS" ] || die "k9-staging.mjs betikle aynı dizinde olmalı"
[ -s "$K9_FILE" ] && [ "$(stat -c '%a %U' "$K9_FILE")" = "600 root" ] || die "$K9_FILE yok ya da izni 600 root değil (önce k9-staging-account.sh)"
cd "$DEPLOY_DIR" || die "DEPLOY_DIR yok"
[ "$(docker compose exec -T server printenv DEPLOY_ENV 2>/dev/null || true)" = staging ] || die "server DEPLOY_ENV=staging değil"
echo "guard: ok (develop, DEPLOY_ENV=staging)"

WORK="$(mktemp -d /root/.k9-smoke.XXXXXX)"
NEEDLES="$WORK/needles" FIDS="$WORK/fids"
: > "$NEEDLES"; : > "$FIDS"
SESSION_ID="" PRIOR="" DONE=0
kv() { sed -n "s/^$1=//p" "$K9_FILE" | tail -n 1; }

SITE_HOST="$(sed -n 's/^SITE_HOST=//p' .env | tail -n 1)"
[ -n "$SITE_HOST" ] || die ".env SITE_HOST yok"
K9_CA="$(docker compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt)"
K9_SITE="$SITE_HOST:4450" K9_TENANT_SLUG="${K9_TENANT_SLUG:-demo}"
K9_EMAIL="$(kv K9_EMAIL)" K9_PASSWORD="$(kv K9_PASSWORD)" K9_TOTP_SECRET="$(kv K9_TOTP_SECRET)"
K9_TECH_EMAIL="$(kv K9_TECH_EMAIL)" K9_TECH_PASSWORD="$(kv K9_TECH_PASSWORD)" K9_TECH_TOTP_SECRET="$(kv K9_TECH_TOTP_SECRET)"
export K9_CA K9_SITE K9_TENANT_SLUG K9_EMAIL K9_PASSWORD K9_TOTP_SECRET K9_TECH_EMAIL K9_TECH_PASSWORD K9_TECH_TOTP_SECRET
[ -n "$K9_TECH_EMAIL" ] || echo "uyarı: K9_TECH_* yok → yalnız (a) koşar (teknisyen: k9-staging-account.sh --tech)"

run_mjs() { # $1 mod; stdout satır protokolü → ekran/dosya. Gizli satır türleri burada yalnız 600 dosyaya gider.
  K9_MODE="$1" K9_LAST_STEP="$(cat "$K9_STATE" 2>/dev/null || echo 0)"
  export K9_MODE K9_LAST_STEP
  local ok=0 k v
  while IFS=' ' read -r k v; do
    case "$k" in
      R) echo "$v" ;;
      S) printf '%s\n' "$v" > "$K9_STATE" ;;
      M) PRIOR="$v" ;;
      I) SESSION_ID="$v" ;;
      F) printf '%s\n' "$v" >> "$FIDS" ;;
      N) printf '%s\n' "$v" >> "$NEEDLES" ;;
      OK) ok=1 ;;
    esac
  done < <(docker compose exec -T -e K9_MODE -e K9_SITE -e K9_CA -e K9_TENANT_SLUG -e K9_EMAIL -e K9_PASSWORD \
    -e K9_TOTP_SECRET -e K9_TECH_EMAIL -e K9_TECH_PASSWORD -e K9_TECH_TOTP_SECRET -e K9_LAST_STEP -e K9_RESTORE_SESSION -e K9_RESTORE_MODE server node --input-type=module - < "$MJS")
  [ "$ok" = 1 ]
}

on_exit() {
  local rc=$?
  if [ "$DONE" != 1 ] && { [ -n "$SESSION_ID" ] || [ "$PRIOR" = false ]; }; then
    echo "geri alma: smoke yarıda kaldı → oturum kapatılıyor / mod eski değere alınıyor"
    K9_RESTORE_SESSION="$SESSION_ID" K9_RESTORE_MODE="$PRIOR"
    export K9_RESTORE_SESSION K9_RESTORE_MODE
    run_mjs restore || echo "geri alma: BAŞARISIZ — runbook §28b.8 elle geri alma"
  fi
  rm -rf "$WORK"
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 130' INT TERM

T0="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
K9_RESTORE_SESSION="" K9_RESTORE_MODE=""
export K9_RESTORE_SESSION K9_RESTORE_MODE
if run_mjs smoke; then DONE=1; else die "smoke tamamlanmadı (yukarıdaki k9: satırı)"; fi
unset K9_PASSWORD K9_TOTP_SECRET K9_TECH_PASSWORD K9_TECH_TOTP_SECRET

# (f) log taraması — temizlikten sonra; iğneler yalnız 600 dosyada, ekrana yalnız sayı
sleep 2
n_needles="$(sort -u "$NEEDLES" | grep -c . || true)"
srv_hits="$(docker compose logs --no-color --since "$T0" server 2>&1 | grep -c -F -f "$NEEDLES" || true)"
cad_hits="$(docker compose logs --no-color --since "$T0" caddy 2>&1 | grep -c -F -f "$NEEDLES" || true)"
fid_hits="$(docker compose logs --no-color --since "$T0" server 2>&1 | grep -c -F -f "$FIDS" || true)"
echo "(f) log taraması: iğne=$n_needles (2 dosya adı + belirteç önekleri) server=$srv_hits caddy=$cad_hits eşleşme; pozitif kontrol (dosya kimliği server logunda)=$fid_hits satır"
if [ "$srv_hits" = 0 ] && [ "$cad_hits" = 0 ] && [ "$fid_hits" -gt 0 ]; then
  echo "SONUÇ: GEÇTİ"
else
  echo "SONUÇ: KALDI (log taraması)"; exit 1
fi
