#!/usr/bin/env bash
# backup.sh / restore.sh uçtan uca yerel testi (P13b T1; AC-298, AC-300, AC-301; S-P13b-1/2/6). Sunucuya bağlanmaz, dind YOK.
# Kurulum (hepsi geçici, benzersiz ad, trap ile silinir):
#   - compose projesi rstb<rand>: mysql (compose imajı + deploy/mysql/init) + sahte server (/ready 200, uploads volume) + web;
#   - migration'lar host'tan `pnpm db:migrate` ile (apps/server/scripts/test-db.sh yolu; 127.0.0.1:<rastgele port>);
#   - yardımcı konteyner (alpine 3.20, root, docker.sock; bash docker-cli compose age jq openssh setpriv): age ve ed25519
#     anahtarları, backup.env değerleri, BACKUP_DIR, deploy/.env ve remote-offsite kullanıcısı KONTEYNER dosya sisteminde
#     (macOS virtiofs bağlamasında dosya izinleri uygulanmaz; erişim/izin testleri bu yüzden bağlama dışında yapılır).
#     Repo aynı mutlak yolla salt okunur bağlanır (scratch MySQL'in init bağlaması host yoluyla çözülür).
# Senaryolar: deploy/backup/test-backup-inner.sh. Kullanım: deploy/backup/test-backup.sh   Çıkış 0 = tüm beklentiler tuttu.
# Gereken: docker, pnpm (repo kurulu: pnpm install), openssl. Süre ~5-8 dk (7 scratch MySQL açılışı).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PROJ="rstb$(date +%s)$((RANDOM % 1000))"
H="$PROJ-helper"
PORT=$((34000 + RANDOM % 1000))
TMP="$(mktemp -d)"
cleanup() {
  docker exec "$H" sh -c 'cd /opt/tdeploy 2>/dev/null && docker compose down -v --remove-orphans' >/dev/null 2>&1 || true
  docker rm -f "$H" >/dev/null 2>&1 || true
  # helper (etiketli); restore.sh scratch konteynerlerini kendi trap.iyle siler.
  docker ps -aq --filter "label=rstb.owner=$PROJ" | xargs -r docker rm -fv >/dev/null 2>&1 || true
  docker volume ls -q --filter "label=com.docker.compose.project=$PROJ" | xargs -r docker volume rm >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT
pw() { printf '%s%s' "$1" "$(openssl rand -hex 16)"; }
MIG_PW="$(pw m)"
cat >"$TMP/env" <<EOF
MYSQL_ROOT_PASSWORD=$(pw r)
MYSQL_DATABASE=remote
MYSQL_APP_PASSWORD=$(pw a)
MYSQL_MIGRATOR_PASSWORD=$MIG_PW
MYSQL_BACKUP_PASSWORD=$(pw b)
DEPLOY_ENV=staging
IMAGE_TAG=test
EOF
MYSQL_LINE="$(grep -m1 -E '^ +image: mysql:' "$REPO/deploy/docker-compose.yml")"
cat >"$TMP/compose.yml" <<EOF
name: $PROJ
services:
  mysql:
$MYSQL_LINE
    user: mysql
    command: ["--default-time-zone=+00:00", "--log-bin-trust-function-creators=1"]
    environment:
      MYSQL_ROOT_PASSWORD: \${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: \${MYSQL_DATABASE}
      MYSQL_APP_PASSWORD: \${MYSQL_APP_PASSWORD}
      MYSQL_MIGRATOR_PASSWORD: \${MYSQL_MIGRATOR_PASSWORD}
      MYSQL_BACKUP_PASSWORD: \${MYSQL_BACKUP_PASSWORD}
    volumes: [mysql_data:/var/lib/mysql, "$REPO/deploy/mysql/init:/docker-entrypoint-initdb.d:ro"]
    ports: ["127.0.0.1:$PORT:3306"]
    healthcheck:
      test: ["CMD-SHELL", "MYSQL_PWD=\"\$\$MYSQL_ROOT_PASSWORD\" mysqladmin ping -h 127.0.0.1 -uroot --silent"]
      interval: 3s
      retries: 80
  server:
    image: node:22-alpine
    command: ["node", "-e", "require('http').createServer((q,s)=>s.end('ok')).listen(3001)"]
    volumes: [uploads:/data/uploads]
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3001/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
      interval: 2s
  web:
    image: node:22-alpine
    command: ["sleep", "infinity"]
volumes:
  mysql_data:
  uploads:
EOF
echo "test-backup: yardımcı konteyner $H"
docker run -d --name "$H" --hostname rstest --label "rstb.owner=$PROJ" -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$REPO:$REPO:ro" -v "$TMP:/t:ro" alpine:3.20 sleep infinity >/dev/null
docker exec "$H" sh -c 'apk add --no-cache bash docker-cli docker-cli-compose age jq openssh-client util-linux coreutils \
  findutils gzip >/dev/null && mkdir -p /opt/tdeploy && cp /t/compose.yml /opt/tdeploy/docker-compose.yml && cp /t/env /opt/tdeploy/.env \
  && chmod 600 /opt/tdeploy/.env && cd /opt/tdeploy && docker compose up -d --wait mysql server web' >/dev/null 2>&1 \
  || { echo "kurulum başarısız"; docker exec "$H" sh -c 'cd /opt/tdeploy && docker compose logs --tail 20' 2>&1 | tail -20; exit 1; }
echo "test-backup: migration (host pnpm, 127.0.0.1:$PORT)"
(cd "$REPO/apps/server" && MIGRATE_DATABASE_URL="mysql://migrator:$MIG_PW@127.0.0.1:$PORT/remote" pnpm --silent db:migrate >/dev/null 2>"$TMP/mig.err") \
  || { echo "migration başarısız"; tail -5 "$TMP/mig.err"; exit 1; }
docker exec -e REPO="$REPO" -e PROJ="$PROJ" "$H" bash "$REPO/deploy/backup/test-backup-inner.sh" | tee "$TMP/out" | grep -E '^(PASS|FAIL|INFO|==)' || true
n="$(sed -n 's/^SONUÇ-İÇ //p' "$TMP/out")"
p="$(grep -c '^PASS' "$TMP/out" || true)"
echo
if [ "$n" = 0 ]; then echo "SONUÇ: GEÇTİ ($p PASS)"; else [ -n "$n" ] || tail -20 "$TMP/out"; echo "SONUÇ: ${n:-?} FAIL, $p PASS"; exit 1; fi
