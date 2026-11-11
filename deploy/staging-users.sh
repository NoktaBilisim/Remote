#!/usr/bin/env bash
# Staging teknisyen hesapları (gereksinimler §9; P9 kullanıcı yönetimine kadar geçici).
# Demo tenant'ı (yoksa) ve ona bağlı bir ADMIN + bir USER kullanıcısı oluşturur.
# Tekrar çalıştırılabilir: var olan tenant/kullanıcıya dokunmaz, parola EZMEZ.
# Parolalar yalnız ACCESS dosyasına (600) yazılır; ekrana/loga yazılmaz.
# Hash: server konteynerindeki src/auth/password.ts (ARGON2_OPTIONS, argon2id) ile üretilir.
# SQL: mysql konteynerinde `app` kullanıcısı (en az yetki), utf8mb4.
# Kullanım (deploy/ içinde, yığın ayakta):  bash staging-users.sh
#   Opsiyonel env: ADMIN_EMAIL, USER_EMAIL, ACCESS_FILE (varsayılan ./ACCESS.txt)
set -euo pipefail
cd "$(dirname "$0")"

ADMIN_EMAIL="${ADMIN_EMAIL:-teknisyen.admin@remote-staging.local}"
USER_EMAIL="${USER_EMAIL:-teknisyen.user@remote-staging.local}"
ACCESS_FILE="${ACCESS_FILE:-./ACCESS.txt}"
TENANT_SLUG="demo"
TENANT_NAME="Demo Firma"
# USER varsayılanı tüm yetkiler kapalı; teknisyen testi için açılan yetkiler (toggle karşılığı).
USER_PERMS="sessions.view sessions.create sessions.edit sessions.delete sessions.terminate remote_control.use file_transfer.use session_history.view"

email_re='^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$'
for e in "$ADMIN_EMAIL" "$USER_EMAIL"; do
  [[ "$e" =~ $email_re ]] || { echo "geçersiz e-posta: $e" >&2; exit 1; }
done

sql() { # stdin -> mysql (app kullanıcısı); çıktı: tablo başlığı olmadan
  docker compose exec -T mysql sh -c \
    'MYSQL_PWD="$MYSQL_APP_PASSWORD" mysql -uapp --default-character-set=utf8mb4 -N -B "$MYSQL_DATABASE"'
}
new_id() { # ULID (server imajındaki ulid paketi)
  docker compose exec -T server node --input-type=module -e \
    "import { ulid } from 'ulid'; process.stdout.write(ulid())"
}
hash_pw() { # parola stdin'den; argv/env'e girmez
  docker compose exec -T server node --input-type=module -e \
    "import { hashPassword } from './src/auth/password.ts';
     let s=''; for await (const c of process.stdin) s+=c;
     process.stdout.write(await hashPassword(s))"
}

# 1) Demo tenant (seed NODE_ENV=production iken oluşturmaz)
TENANT_ID="$(echo "SELECT id FROM tenants WHERE slug='$TENANT_SLUG';" | sql)"
if [ -z "$TENANT_ID" ]; then
  TENANT_ID="$(new_id)"
  sql <<SQL
START TRANSACTION;
INSERT INTO tenants (id, name, slug, status, created_at, updated_at)
  VALUES ('$TENANT_ID', '$TENANT_NAME', '$TENANT_SLUG', 'ACTIVE', NOW(3), NOW(3));
INSERT INTO tenant_settings (tenant_id, created_at, updated_at) VALUES ('$TENANT_ID', NOW(3), NOW(3));
INSERT INTO audit_logs (tenant_id, action, entity, entity_id, new_value, result)
  VALUES ('$TENANT_ID', 'tenant.created', 'tenants', '$TENANT_ID',
          JSON_OBJECT('slug','$TENANT_SLUG','name','$TENANT_NAME','source','staging-users.sh'), 'success');
COMMIT;
SQL
  echo "tenant: created ($TENANT_SLUG)"
else
  echo "tenant: exists ($TENANT_SLUG)"
fi

# 2) Kullanıcılar
create_user() { # $1 rol, $2 e-posta, $3 ad
  local role="$1" email="$2" name="$3" id pw hash perms=""
  if [ -n "$(echo "SELECT id FROM users WHERE email='$email';" | sql)" ]; then
    echo "$role: exists ($email) - parola değiştirilmedi"; return
  fi
  id="$(new_id)"
  pw="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-20)"
  hash="$(printf '%s' "$pw" | hash_pw)"
  [[ "$hash" == '$argon2id$'* ]] || { echo "hash üretilemedi" >&2; exit 1; }
  if [ "$role" = USER ]; then
    for p in $USER_PERMS; do
      perms+="INSERT INTO user_permissions (user_id, perm_key, granted, created_at, updated_at) VALUES ('$id', '$p', 1, NOW(3), NOW(3));"$'\n'
    done
  fi
  sql <<SQL
START TRANSACTION;
INSERT INTO users (id, tenant_id, email, full_name, role, password_hash, must_change_password, created_at, updated_at)
  VALUES ('$id', '$TENANT_ID', '$email', '$name', '$role', '$hash', 1, NOW(3), NOW(3));
$perms
INSERT INTO audit_logs (tenant_id, action, entity, entity_id, new_value, result)
  VALUES ('$TENANT_ID', 'user.created', 'users', '$id',
          JSON_OBJECT('email','$email','role','$role','source','staging-users.sh'), 'success');
COMMIT;
SQL
  umask 077
  printf '%-12s %s  %s\n' "$role" "$email" "$pw" >> "$ACCESS_FILE"
  chmod 600 "$ACCESS_FILE"
  echo "$role: created ($email) - parola $ACCESS_FILE dosyasında"
}
create_user ADMIN "$ADMIN_EMAIL" "Teknisyen Admin"
create_user USER  "$USER_EMAIL"  "Teknisyen Kullanıcı"
