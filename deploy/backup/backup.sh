#!/usr/bin/env bash
# Remote Support — günlük yedek (P13a; docs/mimari-p13.md §4, AC-91, AC-200; runbook §18).
#
#   backup.sh            MySQL dökümü + uploads volume arşivi (aynı çalıştırma), age ile şifreli, manifest, rotasyon
#   backup.sh --alert    Yalnız alarm: journal'a "remote-backup: FAILED" + BACKUP_ALERT_CMD (systemd OnFailure birimi)
#
# Çalıştıran: root (docker erişimi). Yapılandırma: deploy/backup/backup.env (git-ignore; anahtarlar
# backup.env.example). Ortamdaki değer dosyadakini ezer. BACKUP_ENV_FILE ile başka dosya verilebilir.
#
# Çıktı: $BACKUP_DIR/<UTC zaman, ör. 20261115T230000Z>/ (700) içinde
#   db.sql.gz.age       mysqldump (backup kullanıcısı, --single-transaction, tetikleyiciler) -> gzip -> age
#   uploads.tar.gz.age  remote_uploads volume'u (logo/avatar) -> tar.gz -> age
#   manifest.json       zaman, sürüm (commit, IMAGE_TAG, MySQL), son migration, tetikleyici sayısı, tablo satır
#                       sayıları, uploads özet listesi, dosyaların boyut + sha256'sı (şifreli ve düz)
# Hepsi 600. Çalıştırma önce ".partial-<zaman>" dizinine yazılır, başarıyla bitince adı değişir: yarım yedek
# hiçbir zaman geçerli bir çalıştırma gibi görünmez. Düz (şifresiz) döküm/arşiv HİÇ diske yazılmaz: akış doğrudan
# gzip -> age'e gider, sayım/özetler akış üzerinde hesaplanır (S-P13a-3). Özel (çözme) anahtar sunucuda BULUNMAZ.
# backup.env root'a ait ve 600 değilse çalışmaz (S-P13a-7). DB'deki tetikleyici sayısı BACKUP_EXPECTED_TRIGGERS
# (vars. 3) değilse FAILED (S-P13a-4).
#
# Çıkış kodu: 0 başarılı · ≠0 hata (MySQL erişilemez, boş/bozuk döküm, şifreleme/disk hatası...). Hata satırı
# "remote-backup: FAILED ..." stderr'e (systemd altında journal'a) yazılır; birim `failed` olur, OnFailure alarmı çalışır.
set -euo pipefail
umask 077
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/backup/lib.sh
. "$SCRIPT_DIR/lib.sh"
DEPLOY_DIR="${BACKUP_DEPLOY_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
LOG_TAG=remote-backup
ENV_OK=1
load_env_file "${BACKUP_ENV_FILE:-$SCRIPT_DIR/backup.env}" || ENV_OK=0

# ---------------------------------------------------------------------------------------------------------------
if [ "${1:-}" = "--alert" ]; then
  msg="remote-backup: FAILED host=$(hostname) zaman=$(ts) — ayrıntı: journalctl -u remote-backup.service -n 50"
  printf '%s\n' "$msg" >&2
  [ "$ENV_OK" = 1 ] || { log "backup.env güvensiz — BACKUP_ALERT_CMD ÇALIŞTIRILMADI"; exit 1; }
  if [ -n "${BACKUP_ALERT_CMD:-}" ]; then
    # Komut yapılandırmadan gelir (root'a ait 600 dosya); mesaj REMOTE_BACKUP_MSG ortam değişkeniyle verilir.
    REMOTE_BACKUP_MSG="$msg" sh -c "$BACKUP_ALERT_CMD" || { log "uyarı: BACKUP_ALERT_CMD başarısız (rc=$?)"; exit 1; }
  fi
  exit 0
fi
[ $# -eq 0 ] || die "kullanım: backup.sh [--alert]"

STEP=başlangıç
WORK=""; LOCK=""
START_EPOCH="$(date -u +%s)"
on_exit() {
  local rc=$?
  [ -n "$WORK" ] && [ -d "$WORK" ] && rm -rf -- "$WORK"
  [ -n "$LOCK" ] && rm -rf -- "$LOCK"
  if [ "$rc" -ne 0 ]; then
    printf '%s remote-backup: FAILED adım=%s rc=%s\n' "$(ts)" "$STEP" "$rc" >&2
  fi
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 130' INT TERM

# --- 1. Ön koşullar ------------------------------------------------------------------------------------------------
STEP=önkoşul
[ "$ENV_OK" = 1 ] || die "backup.env güvensiz (S-P13a-7) — yedek alınmadı"
need_cmd docker age jq gzip awk mkfifo
EXPECTED_TRIGGERS="${BACKUP_EXPECTED_TRIGGERS:-3}"
case "$EXPECTED_TRIGGERS" in ''|*[!0-9]*) die "BACKUP_EXPECTED_TRIGGERS sayı olmalı" ;; esac
: "${BACKUP_DIR:?BACKUP_DIR tanımlı değil (backup.env)}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT tanımlı değil (backup.env; age açık anahtarı, age1...)}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
MIN_FREE_MB="${BACKUP_MIN_FREE_MB:-1024}"
case "$KEEP_DAYS" in ''|*[!0-9]*) die "BACKUP_KEEP_DAYS sayı olmalı" ;; esac
[ "$KEEP_DAYS" -ge 1 ] && [ "$KEEP_DAYS" -le 365 ] || die "BACKUP_KEEP_DAYS 1..365 olmalı"
case "$MIN_FREE_MB" in ''|*[!0-9]*) die "BACKUP_MIN_FREE_MB sayı olmalı" ;; esac
case "$BACKUP_DIR" in /*) ;; *) die "BACKUP_DIR mutlak yol olmalı" ;; esac

AGE_ARGS=()
for r in ${BACKUP_AGE_RECIPIENT//,/ }; do
  [[ "$r" =~ ^age1[0-9a-z]{58}$ ]] || die "BACKUP_AGE_RECIPIENT geçersiz (age1... açık anahtar bekleniyor; AGE-SECRET-KEY ASLA yazılmaz)"
  AGE_ARGS+=(-r "$r")
done
[ "${#AGE_ARGS[@]}" -gt 0 ] || die "BACKUP_AGE_RECIPIENT boş"

mkdir -p -- "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
free_kb="$(df -Pk "$BACKUP_DIR" | awk 'NR == 2 {print $4}')"
[ "$((free_kb / 1024))" -ge "$MIN_FREE_MB" ] || die "BACKUP_DIR diskinde boş alan $((free_kb / 1024)) MB < BACKUP_MIN_FREE_MB=$MIN_FREE_MB (runbook §19 'Disk doldu')"

# Üst üste binme kilidi (systemd zaten tek örnek çalıştırır; elle çalıştırmaya karşı). Ölü kilit (süreç yok) temizlenir.
LOCK_DIR="$BACKUP_DIR/.lock"
if ! mkdir -- "$LOCK_DIR" 2>/dev/null; then
  oldpid="$(cat -- "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [ -n "$oldpid" ] && kill -0 "$oldpid" 2>/dev/null; then die "başka bir yedek çalışıyor (pid $oldpid)"; fi
  log "ölü kilit temizlendi (pid ${oldpid:-?})"; rm -rf -- "$LOCK_DIR"; mkdir -- "$LOCK_DIR"
fi
LOCK="$LOCK_DIR"; echo $$ > "$LOCK_DIR/pid"
# S-P13a-3: yarıda kalmış (SIGKILL/zaman aşımı) önceki çalıştırma artıkları, yaşına bakılmadan, kilit alındıktan sonra silinir.
for d in "$BACKUP_DIR"/.partial-*; do
  [ -d "$d" ] || continue
  log "yarım çalıştırma artığı silindi: ${d##*/}"; rm -rf -- "$d"
done

# --- 2. MySQL konteyneri ve meta ---------------------------------------------------------------------------------
STEP=mysql-bul
cd "$DEPLOY_DIR"
CID="$(docker compose ps -q mysql 2>/dev/null || true)"
[ -n "$CID" ] || die "mysql konteyneri bulunamadı ($DEPLOY_DIR; yığın ayakta mı: docker compose ps)"
[ "$(docker inspect -f '{{.State.Running}}' "$CID")" = true ] || die "mysql konteyneri çalışmıyor"
PROJECT="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$CID")"
MYSQL_IMAGE_ID="$(docker inspect -f '{{.Image}}' "$CID")"
UPLOADS_VOL="$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" --filter label=com.docker.compose.volume=uploads)"
[ -n "$UPLOADS_VOL" ] || die "uploads volume'u bulunamadı (proje $PROJECT)"

# backup kullanıcısıyla, konteyner içinden (soket; hesap yalnız 'backup'@'localhost'). Parola konteynerin env'inden
# okunur, hiçbir süreç argümanına/loga girmez (docs/db-notlari.md P13a).
sql_backup() {
  docker exec -i "$CID" sh -c '[ -n "$MYSQL_BACKUP_PASSWORD" ] || { echo "MYSQL_BACKUP_PASSWORD boş: backup kullanıcısı yok (runbook §18.2)" >&2; exit 2; }
    MYSQL_PWD="$MYSQL_BACKUP_PASSWORD" exec mysql -ubackup -NB "$MYSQL_DATABASE"'
}
STEP=meta
META="$(sql_backup <<'SQL'
SELECT DATABASE();
SELECT VERSION();
SELECT COALESCE(MAX(migration_name), '') FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE();
SELECT COALESCE(GROUP_CONCAT(TRIGGER_NAME ORDER BY TRIGGER_NAME SEPARATOR ','), '') FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE();
SQL
)"
DB_NAME="$(sed -n 1p <<<"$META")"; MYSQL_VERSION="$(sed -n 2p <<<"$META")"
LAST_MIGRATION="$(sed -n 3p <<<"$META")"; MIGRATIONS="$(sed -n 4p <<<"$META")"; TRIGGERS="$(sed -n 5p <<<"$META")"
TRIGGER_NAMES="$(sed -n 6p <<<"$META")"
[ -n "$DB_NAME" ] && [ -n "$LAST_MIGRATION" ] || die "meta okunamadı (DB adı/son migration boş)"
# S-P13a-4: audit tetikleyicisi düşürülmüşse (backup hesabının TRIGGER yetkisi DROP'u da kapsar) yedek FAILED -> alarm.
STEP=tetikleyici
[ "$TRIGGERS" = "$EXPECTED_TRIGGERS" ] || die "DB'de $TRIGGERS tetikleyici var, beklenen $EXPECTED_TRIGGERS ($TRIGGER_NAMES) — audit korumaları eksik olabilir (runbook §19.10)"

RUN="$(date -u +%Y%m%dT%H%M%SZ)"
[ ! -e "$BACKUP_DIR/$RUN" ] || die "$BACKUP_DIR/$RUN zaten var (aynı saniyede iki çalıştırma)"
WORK="$BACKUP_DIR/.partial-$RUN"
mkdir -m 700 -- "$WORK"
log "başladı run=$RUN db=$DB_NAME migration=$LAST_MIGRATION tetikleyici=$TRIGGERS volume=$UPLOADS_VOL"

# Düz döküm ve arşiv DİSKE YAZILMAZ (S-P13a-3): akış -> (sayım/özet yan kanalları) -> gzip -> age. Özet ve boyutlar
# FIFO'lar üzerinden arka plan süreçleriyle hesaplanır; $WORK'te yalnız sayılar/özetler (kişisel veri yok) durur.
OUT="$WORK/out"; mkdir -m 700 -- "$OUT"
BG_PIDS=()
side() {  # <fifo-adı> <komut...>: FIFO'yu okuyan arka plan süreci; çıktısı $WORK/<fifo-adı>.out
  local name="$1"; shift
  mkfifo -m 600 "$WORK/$name"
  "$@" < "$WORK/$name" > "$WORK/$name.out" &
  BG_PIDS+=("$!")
}
wait_side() { local p; for p in "${BG_PIDS[@]}"; do wait "$p" || die "yan hesap süreci başarısız"; done; BG_PIDS=(); }
count_bytes() { wc -c | tr -d ' '; }

# --- 3. MySQL dökümü ---------------------------------------------------------------------------------------------
# --skip-extended-insert: satır başına bir INSERT -> satır sayıları dökümden kesin okunur (manifest = döküm anı).
# --no-autocommit: tablo başına tek COMMIT (geri yükleme hızı). --hex-blob: ikili sütunlar güvenli.
STEP=mysqldump
side db.sha sha256_stdin
side db.size count_bytes
docker exec "$CID" sh -c 'MYSQL_PWD="$MYSQL_BACKUP_PASSWORD" exec mysqldump -ubackup --single-transaction --no-tablespaces \
    --triggers --set-gtid-purged=OFF --skip-extended-insert --no-autocommit --hex-blob --default-character-set=utf8mb4 \
    "$MYSQL_DATABASE"' \
  | dump_tee_meta "$WORK/rows.tsv" "$WORK/dump.meta" | gzip -6 | tee "$WORK/db.sha" "$WORK/db.size" \
  | age "${AGE_ARGS[@]}" -o "$OUT/db.sql.gz.age"
wait_side
STEP=döküm-doğrula
[ -s "$OUT/db.sql.gz.age" ] || die "şifreli döküm boş"
grep -q $'^last\t-- Dump completed' "$WORK/dump.meta" || die "döküm eksik (son satır '-- Dump completed' değil)"
[ -s "$WORK/rows.tsv" ] || die "dökümde tablo yok"
grep -q $'^_prisma_migrations\t' "$WORK/rows.tsv" || die "dökümde _prisma_migrations yok"
dump_triggers="$(awk -F'\t' '$1 == "triggers" {print $2}' "$WORK/dump.meta")"
[ "$dump_triggers" = "$TRIGGERS" ] || die "dökümdeki tetikleyici sayısı ($dump_triggers) DB'dekiyle ($TRIGGERS) aynı değil"

# --- 4. uploads volume'u -----------------------------------------------------------------------------------------
# MySQL imajıyla (sabit digest, GNU tar), ağsız, salt okunur bağlama; yalnız okuma yeteneği (DAC_READ_SEARCH:
# volume node:node 700). Sahiplik/izinler arşivde korunur (geri yüklemede node:node 700/750/640 aynen döner).
STEP=uploads-arşiv
side up.sha sha256_stdin
side up.size count_bytes
side up.digest uploads_digest "$MYSQL_IMAGE_ID"
docker run --rm --network none --read-only --cap-drop ALL --cap-add DAC_READ_SEARCH \
  --security-opt no-new-privileges:true --user 0 -v "$UPLOADS_VOL:/u:ro" --entrypoint tar "$MYSQL_IMAGE_ID" \
  -C /u -czf - . | tee "$WORK/up.sha" "$WORK/up.size" "$WORK/up.digest" | age "${AGE_ARGS[@]}" -o "$OUT/uploads.tar.gz.age"
wait_side
{ [ -s "$OUT/uploads.tar.gz.age" ] && [ "$(cat "$WORK/up.size.out")" -gt 0 ]; } || die "uploads arşivi boş"
read -r UP_FILES UP_DIGEST < "$WORK/up.digest.out"
[ -n "${UP_DIGEST:-}" ] || die "uploads özet listesi hesaplanamadı"

# --- 5. Manifest ---------------------------------------------------------------------------------------------------
STEP=manifest
file_json() {  # <ad> <şifreli dosya> <düz boyut> <düz sha256>
  jq -n --arg name "$1" --argjson bytes "$(size_file "$2")" --arg sha256 "$(sha256_file "$2")" \
    --argjson plainBytes "$3" --arg plainSha256 "$4" \
    '{name: $name, bytes: $bytes, sha256: $sha256, plainBytes: $plainBytes, plainSha256: $plainSha256}'
}
COMMIT="$(git -C "$DEPLOY_DIR/.." rev-parse --short=12 HEAD 2>/dev/null || echo unknown)"
IMAGE_TAG_VAL="$(awk -F= '$1 == "IMAGE_TAG" {print $2}' "$DEPLOY_DIR/.env" 2>/dev/null | tail -n 1)"
TABLES_JSON="$(jq -Rn '[inputs | split("\t") | {(.[0]): (.[1] | tonumber)}] | add' < "$WORK/rows.tsv")"
{
  file_json db.sql.gz.age "$OUT/db.sql.gz.age" "$(cat "$WORK/db.size.out")" "$(cat "$WORK/db.sha.out")"
  file_json uploads.tar.gz.age "$OUT/uploads.tar.gz.age" "$(cat "$WORK/up.size.out")" "$(cat "$WORK/up.sha.out")"
} | jq -s '.' > "$WORK/files.json"
jq -n --arg createdUtc "$(ts)" --arg run "$RUN" --arg host "$(hostname)" --arg commit "$COMMIT" \
  --arg imageTag "${IMAGE_TAG_VAL:-local}" --arg mysqlVersion "$MYSQL_VERSION" --arg mysqlImage "$MYSQL_IMAGE_ID" \
  --arg database "$DB_NAME" --arg lastMigration "$LAST_MIGRATION" --argjson migrationsApplied "$MIGRATIONS" \
  --argjson triggers "$TRIGGERS" --arg triggerNames "$TRIGGER_NAMES" --argjson tables "$TABLES_JSON" --argjson upFiles "$UP_FILES" \
  --arg upDigest "$UP_DIGEST" --slurpfile files "$WORK/files.json" --arg recipients "$BACKUP_AGE_RECIPIENT" \
  --argjson keepDays "$KEEP_DAYS" --argjson durationSeconds "$(( $(date -u +%s) - START_EPOCH ))" \
  '{format: 1, run: $run, createdUtc: $createdUtc, host: $host,
    version: {commit: $commit, imageTag: $imageTag, mysql: $mysqlVersion, mysqlImage: $mysqlImage},
    database: $database, lastMigration: $lastMigration, migrationsApplied: $migrationsApplied, triggers: $triggers,
    triggerNames: ($triggerNames | split(",") | map(select(length > 0))),
    tables: $tables, uploads: {files: $upFiles, listSha256: $upDigest}, files: $files[0],
    ageRecipients: ($recipients | gsub(","; " ") | split(" ") | map(select(length > 0))),
    keepDays: $keepDays, durationSeconds: $durationSeconds}' > "$OUT/manifest.json"

# --- 6. Yayımla (atomik ad değişikliği) ---------------------------------------------------------------------------
STEP=yayımla
chmod 600 "$WORK/out/"*
chmod 700 "$WORK/out"
mv -- "$WORK/out" "$BACKUP_DIR/$RUN"
rm -rf -- "$WORK"; WORK=""

# --- 7. Rotasyon (yalnız başarılı yedekten sonra) -----------------------------------------------------------------
# Adı (UTC zaman) KEEP_DAYS gün + 1 saatten eski çalıştırmalar silinir -> her yedek en az KEEP_DAYS gün kalır.
STEP=rotasyon
CUTOFF="$(fmt_epoch $(( $(date -u +%s) - KEEP_DAYS * 86400 - 3600 )))"
removed=0
for d in "$BACKUP_DIR"/*; do
  [ -d "$d" ] || continue
  name="${d##*/}"
  [[ "$name" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || continue
  [ "$name" != "$RUN" ] || continue
  if [[ "$name" < "$CUTOFF" ]]; then rm -rf -- "$d"; removed=$((removed + 1)); fi
done
kept="$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '[0-9]*Z' | wc -l | tr -d ' ')"

STEP=bitti
db_bytes="$(jq -r '.files[0].bytes' "$BACKUP_DIR/$RUN/manifest.json")"
up_bytes="$(jq -r '.files[1].bytes' "$BACKUP_DIR/$RUN/manifest.json")"
printf '%s remote-backup: OK run=%s dizin=%s db=%sB uploads=%sB/%s dosya tablo=%s tetikleyici=%s silinen=%s kalan=%s süre=%ss\n' \
  "$(ts)" "$RUN" "$BACKUP_DIR/$RUN" "$db_bytes" "$up_bytes" "$UP_FILES" "$(jq '.tables | length' "$BACKUP_DIR/$RUN/manifest.json")" \
  "$TRIGGERS" "$removed" "$kept" "$(( $(date -u +%s) - START_EPOCH ))"
