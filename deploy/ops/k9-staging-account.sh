#!/usr/bin/env bash
# K9 staging test hesabı (runbook §28b.8). YALNIZ staging host'unda (hostname `develop` + çalışan server'da DEPLOY_ENV=staging).
# Ne yapar (idempotent):
#   1. Hesap yoksa: parolayı `openssl rand` ile üretir, kimlik dosyasına (root 600) YAZAR, sonra hesabı oluşturur
#      (`must_change_password=0`: parola yalnız bu host'ta, rastgele, insan görmez → ilk giriş değişimi gereksiz),
#      audit `user.created {source:"k9-staging-test"}`. Hash: server konteynerindeki `hashPassword` (argon2id, stdin).
#      SQL: mysql konteynerinde `app` kullanıcısı (staging-users.sh kalıbı).
#        varsayılan  → `k9-test@staging.invalid`, SUPER_ADMIN, firma yok (ClamAV ayarı + firma ayarı); anahtarlar K9_*
#        --tech      → `k9-tech@staging.invalid`, ADMIN, demo firması (destek oturumu açan teknisyen; Super Admin oturum
#                      açamaz: sessions/service.ts "yalnız kendi firmanızda"); anahtarlar K9_TECH_*. AYRI ONAY GEREKİR.
#   2. Uygulamanın kendi API'siyle 2FA kurulumu (k9-staging.mjs enroll): login → mfa/setup → tohum dosyaya → TOTP üret
#      (RFC 6238) → mfa/enable → kurtarma kodları dosyaya. 2FA zaten etkinse tohumla doğrular.
# Çıktı: yalnız "ok/hata" satırları. Parola, tohum, kurtarma kodu, çerez hiçbir zaman ekrana/loga gitmez.
# Kullanım (host'ta, root):  bash /root/k9/k9-staging-account.sh [--tech]
#   Env: DEPLOY_DIR (vars. /opt/remote/deploy), K9_FILE (vars. /root/.k9-staging-test.env), K9_TENANT_SLUG (vars. demo).
#   Betik /opt/remote ağacına KOPYALANMAZ (izlenmeyen dosya git pull'u bozar): /root/k9/ altında tutulur.
# Hesabı kaldırma: Super Admin panelinden kullanıcı pasife alınır/silinir, sonra ilgili K9_* satırları ya da dosya silinir.
set -euo pipefail
umask 077

DEPLOY_DIR="${DEPLOY_DIR:-/opt/remote/deploy}"
K9_FILE="${K9_FILE:-/root/.k9-staging-test.env}"
K9_STATE="${K9_FILE%.env}.state"
TENANT_SLUG="${K9_TENANT_SLUG:-demo}"
HERE="$(cd "$(dirname "$0")" && pwd)"
MJS="$HERE/k9-staging.mjs"

die() { echo "hata: $*" >&2; exit 1; }

case "${1:-}" in
  "") P=K9_ ROLE=SUPER_ADMIN EMAIL=k9-test@staging.invalid NAME="K9 Staging Test" ;;
  --tech) P=K9_TECH_ ROLE=ADMIN EMAIL=k9-tech@staging.invalid NAME="K9 Staging Teknisyen" ;;
  *) die "kullanım: $0 [--tech]" ;;
esac

# --- Guard: yalnız staging ---
[ "$(hostname -s 2>/dev/null || hostname)" = develop ] || die "bu host staging değil (hostname develop bekleniyor)"
[ "$(id -u)" = 0 ] || die "root olarak çalıştırın"
[ -f "$MJS" ] || die "k9-staging.mjs betikle aynı dizinde olmalı"
cd "$DEPLOY_DIR" || die "DEPLOY_DIR yok"
[ "$(docker compose exec -T server printenv DEPLOY_ENV 2>/dev/null || true)" = staging ] || die "server DEPLOY_ENV=staging değil; çalıştırılmadı"
echo "guard: ok (develop, DEPLOY_ENV=staging)"

sql() { # stdin -> mysql (app kullanıcısı)
  docker compose exec -T mysql sh -c \
    'MYSQL_PWD="$MYSQL_APP_PASSWORD" mysql -uapp --default-character-set=utf8mb4 -N -B "$MYSQL_DATABASE"'
}
kv() { [ -f "$K9_FILE" ] && sed -n "s/^$1=//p" "$K9_FILE" | tail -n 1 || true; }
setkv() { # $1 anahtar, $2 değer (değer yalnız bu kabukta; dış süreç argv'sine girmez — printf yerleşik)
  local tmp
  tmp="$(mktemp "${K9_FILE}.XXXXXX")"
  grep -v "^$1=" "$K9_FILE" > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  chmod 600 "$tmp" && mv -f "$tmp" "$K9_FILE"
}
[ -e "$K9_FILE" ] || { : > "$K9_FILE"; chmod 600 "$K9_FILE"; }
[ "$(stat -c '%a %U' "$K9_FILE")" = "600 root" ] || die "$K9_FILE izni 600 root değil"

# --- 1) Hesap ---
TENANT_SQL=NULL AUDIT_TENANT=NULL
if [ "$ROLE" = ADMIN ]; then
  tid="$(echo "SELECT id FROM tenants WHERE slug='$TENANT_SLUG' AND status='ACTIVE';" | sql)"
  [ -n "$tid" ] || die "firma '$TENANT_SLUG' yok/pasif"
  TENANT_SQL="'$tid'" AUDIT_TENANT="'$tid'"
fi
uid="$(echo "SELECT id FROM users WHERE email='$EMAIL';" | sql)"
if [ -z "$uid" ]; then
  [ -z "$(kv "${P}PASSWORD")" ] || die "$K9_FILE içinde ${P}PASSWORD var ama hesap yok; o satırları silip yeniden çalıştırın"
  pw="$(openssl rand -base64 33 | tr -d '/+=\n' | cut -c1-32)"
  [ "${#pw}" -ge 24 ] || die "parola üretilemedi"
  setkv "${P}EMAIL" "$EMAIL"
  setkv "${P}PASSWORD" "$pw" # DB'ye yazılmadan ÖNCE dosyada
  hash="$(printf '%s' "$pw" | docker compose exec -T server node --input-type=module -e \
    "import { hashPassword } from './src/auth/password.ts';
     let s=''; for await (const c of process.stdin) s+=c;
     process.stdout.write(await hashPassword(s))")"
  unset pw
  # shellcheck disable=SC2016 # düz önek, genişleme istenmiyor
  [[ "$hash" == '$argon2id$'* ]] || die "hash üretilemedi"
  id="$(docker compose exec -T server node --input-type=module -e "import { ulid } from 'ulid'; process.stdout.write(ulid())")"
  [[ "$id" =~ ^[0-9A-HJKMNP-TV-Z]{26}$ ]] || die "ULID üretilemedi"
  sql <<SQL
START TRANSACTION;
INSERT INTO users (id, tenant_id, email, full_name, role, password_hash, must_change_password, created_at, updated_at)
  VALUES ('$id', $TENANT_SQL, '$EMAIL', '$NAME', '$ROLE', '$hash', 0, NOW(3), NOW(3));
INSERT INTO audit_logs (tenant_id, action, entity, entity_id, new_value, result)
  VALUES ($AUDIT_TENANT, 'user.created', 'users', '$id',
          JSON_OBJECT('email','$EMAIL','role','$ROLE','source','k9-staging-test'), 'success');
COMMIT;
SQL
  unset hash
  echo "hesap: oluşturuldu ($EMAIL, $ROLE; audit source=k9-staging-test)"
else
  [ -n "$(kv "${P}PASSWORD")" ] || die "hesap var ama $K9_FILE içinde parolası yok. Panelden hesabı pasife alın/silin ya da parolayı sıfırlayın"
  [ "$(kv "${P}EMAIL")" = "$EMAIL" ] || die "$K9_FILE ${P}EMAIL uyuşmuyor"
  echo "hesap: mevcut ($EMAIL) - parola değiştirilmedi"
fi

# --- 2) 2FA (uygulama API'si, Caddy üzerinden) ---
SITE_HOST="$(sed -n 's/^SITE_HOST=//p' .env | tail -n 1)"
[ -n "$SITE_HOST" ] || die ".env SITE_HOST yok"
K9_CA="$(docker compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt)"
K9_MODE=enroll K9_SITE="$SITE_HOST:4450" K9_TENANT_SLUG="$TENANT_SLUG" K9_ENROLL_PREFIX="$P"
K9_LAST_STEP="$(cat "$K9_STATE" 2>/dev/null || echo 0)"
printf -v "${P}EMAIL" '%s' "$(kv "${P}EMAIL")"
printf -v "${P}PASSWORD" '%s' "$(kv "${P}PASSWORD")"
printf -v "${P}TOTP_SECRET" '%s' "$(kv "${P}TOTP_SECRET")"
export K9_MODE K9_SITE K9_CA K9_TENANT_SLUG K9_ENROLL_PREFIX K9_LAST_STEP "${P}EMAIL" "${P}PASSWORD" "${P}TOTP_SECRET"
codes="" ok=0
while IFS=' ' read -r k v; do
  case "$k" in
    R) echo "$v" ;;
    S) printf '%s\n' "$v" > "$K9_STATE" ;;
    T) setkv "${P}TOTP_SECRET" "$v" ;; # enable'dan ÖNCE dosyada
    C) codes="${codes:+$codes,}$v" ;;
    OK) ok=1 ;;
  esac
done < <(docker compose exec -T -e K9_MODE -e K9_SITE -e K9_CA -e K9_TENANT_SLUG -e K9_ENROLL_PREFIX -e K9_LAST_STEP \
  -e "${P}EMAIL" -e "${P}PASSWORD" -e "${P}TOTP_SECRET" server node --input-type=module - < "$MJS")
[ -z "$codes" ] || setkv "${P}RECOVERY_CODES" "$codes"
unset "${P}PASSWORD" "${P}TOTP_SECRET" codes
[ "$ok" = 1 ] || die "2FA kurulumu tamamlanmadı (yukarıdaki k9: satırına bakın)"
echo "dosya: $K9_FILE ($(stat -c '%a %U' "$K9_FILE"); anahtarlar: $(cut -d= -f1 "$K9_FILE" | tr '\n' ' '))"
echo "SONUÇ: ok"
