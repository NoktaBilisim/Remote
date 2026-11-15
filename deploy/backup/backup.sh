#!/usr/bin/env bash
# Remote Support — günlük yedek (P13a + P13b; docs/mimari-p13.md §4 ve §7.6, ADR-0020, AC-91, AC-200; runbook §18).
#
#   backup.sh            MySQL dökümü + uploads volume arşivi (aynı çalıştırma), age ile şifreli, manifest, rotasyon
#   backup.sh --alert    Yalnız alarm: journal'a "remote-backup: FAILED" + BACKUP_ALERT_CMD (systemd OnFailure birimi)
#   backup.sh --reset-audit-baseline "<gerekçe>"   Audit taban çizgisini sıfırlar (root): audit-baseline-reset.sql
#                        (migrator) + BACKUP_DIR/audit-baseline-reset.json host işareti (S-P13b-1; lib-audit.sh).
#
# Çalıştıran: root (docker erişimi). Yapılandırma: deploy/backup/backup.env (git-ignore; anahtarlar
# backup.env.example). Ortamdaki değer dosyadakini ezer. BACKUP_ENV_FILE ile başka dosya verilebilir.
#
# Çıktı: $BACKUP_DIR/<UTC zaman, ör. 20261115T230000Z>/ (700) içinde
#   db.sql.gz.age       mysqldump (backup kullanıcısı, --single-transaction, tetikleyiciler) -> gzip -> age
#   uploads.tar.gz.age  remote_uploads volume'u (logo/avatar) -> tar.gz -> age
#   manifest.json       zaman, sürüm (commit, IMAGE_TAG, MySQL), son migration, tetikleyici sayısı, tablo satır
#                       sayıları, uploads özet listesi, dosyaların boyut + sha256'sı (şifreli ve düz); P13b: env
#                       (deploy/.env DEPLOY_ENV), host (hostname -s), signer (imza anahtarı SHA256), seq/prevRun (monoton
#                       sıra, G-P13b-8), audit (deploy/mysql/audit-continuity.sql) ve auditContinuity (karşılaştırma sonucu)
#   manifest.json.sig   ssh-keygen -Y sign -n remote-backup (BACKUP_SIGNING_KEY, root 600). restore.sh İLK iş bunu doğrular.
# Hepsi 600. Çalıştırma önce ".partial-<zaman>" dizinine yazılır, başarıyla bitince adı değişir: yarım yedek
# hiçbir zaman geçerli bir çalıştırma gibi görünmez. Düz (şifresiz) döküm/arşiv HİÇ diske yazılmaz: akış doğrudan
# gzip -> age'e gider, sayım/özetler akış üzerinde hesaplanır (S-P13a-3). Özel (çözme) anahtar sunucuda BULUNMAZ.
# backup.env root'a ait ve 600 değilse çalışmaz (S-P13a-7). DB'deki tetikleyici sayısı BACKUP_EXPECTED_TRIGGERS
# (vars. 22; P16 öncesi 3) değilse FAILED (S-P13a-4, S16-11).
#
# P13b sırası: meta -> audit ölçümü -> döküm -> manifest -> imza -> yayımla -> rotasyon -> site dışı kanca -> status.prom.
#   Audit süreklilik (db-notlari "P13b"): önceki imzası geçerli, sonucu FAILED olmayan manifestle karşılaştırılır. FAILED
#   olursa yedek YİNE yayımlanır (kanıt) ama çıkış kodu 1 (alarm); bir sonraki çalıştırma yine son İYİ manifestle
#   karşılaştırır -> taban çizgisi sıfırlanana (backup.sh --reset-audit-baseline) kadar her gün alarm. DB'deki sıfırlama
#   satırı host işareti olmadan kabul edilmez (S-P13b-1). Yardımcılar: lib-audit.sh, lib-offsite.sh.
#   Kanca (BACKUP_OFFSITE_CMD, G-P13b-6): root DEĞİL, BACKUP_OFFSITE_USER (vars. remote-offsite) olarak, `env -i` ile,
#   yalnız bu çalıştırmanın dizinini (grup okuma) görerek; başarısızsa OFFSITE-FAILED + BACKUP_ALERT_CMD, birim OK.
#   Durum: BACKUP_STATUS_FILE (vars. /var/lib/remote-backup/status.prom, 644, sır yok) her çıkışta yazılır.
# Çıkış kodu: 0 başarılı · ≠0 hata (MySQL erişilemez, boş/bozuk döküm, şifreleme/disk hatası...). Hata satırı
# "remote-backup: FAILED ..." stderr'e (systemd altında journal'a) yazılır; birim `failed` olur, OnFailure alarmı çalışır.
set -euo pipefail
umask 077
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/backup/lib.sh
. "$SCRIPT_DIR/lib.sh"
# shellcheck source=deploy/backup/lib-audit.sh
. "$SCRIPT_DIR/lib-audit.sh"
DEPLOY_DIR="${BACKUP_DEPLOY_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
LOG_TAG=remote-backup
ENV_OK=1
load_env_file "${BACKUP_ENV_FILE:-$SCRIPT_DIR/backup.env}" || ENV_OK=0
# shellcheck source=deploy/backup/lib-offsite.sh
. "$SCRIPT_DIR/lib-offsite.sh"
# shellcheck source=deploy/backup/lib-ledger.sh
. "$SCRIPT_DIR/lib-ledger.sh"   # P16 imha defteri (ADR-0030 m.9, S16-13): ayrı şifreli dosya + eklenebilirlik denetimi
HOST_SHORT="$(hostname -s 2>/dev/null || hostname)"

# S13C-2/S13C-13: ikinci yığın prod yedek yollarını kullanamaz (tek yığın staging etkilenmez). trap/status'tan ÖNCE:
# prod status.prom'a yazılmaz.
if [ "${1:-}" != --alert ]; then
  nonprod_paths_guard "$(deploy_env_of "$DEPLOY_DIR")" "$DEPLOY_DIR" || exit 1
  stg_name_guard "$DEPLOY_DIR" || exit 1   # S13C-14
fi

case "${1:-}" in
  --alert) [ $# -eq 1 ] || die "kullanım: backup.sh --alert"; alert_mode; exit $? ;;
  --reset-audit-baseline)
    [ $# -eq 2 ] || die "kullanım: backup.sh --reset-audit-baseline \"<gerekçe 10-200 karakter>\""
    [ "$ENV_OK" = 1 ] || die "backup.env güvensiz (S-P13a-7)"
    need_cmd docker jq; audit_baseline_reset_cmd "$2"; exit 0 ;;
  --reset-ledger-baseline) [ $# -eq 2 ] || die "kullanım: backup.sh --reset-ledger-baseline \"<gerekçe>\""; ledger_baseline_reset_cmd "$2"; exit 0 ;;
  '') ;;
  *) die "kullanım: backup.sh [--alert | --reset-audit-baseline <gerekçe> | --reset-ledger-baseline <gerekçe>]" ;;
esac

STEP=başlangıç
WORK=""; LOCK=""
START_EPOCH="$(date -u +%s)"
status_init
on_exit() {
  local rc=$?
  offsite_close
  [ -n "$WORK" ] && [ -d "$WORK" ] && rm -rf -- "$WORK"
  [ -n "$LOCK" ] && rm -rf -- "$LOCK"
  if [ "$rc" -ne 0 ]; then
    printf '%s remote-backup: FAILED adım=%s rc=%s\n' "$(ts)" "$STEP" "$rc" >&2
    write_status 0
  else
    write_status 1
  fi
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 130' INT TERM

# --- 1. Ön koşullar ------------------------------------------------------------------------------------------------
STEP=önkoşul
[ "$ENV_OK" = 1 ] || die "backup.env güvensiz (S-P13a-7) — yedek alınmadı"
need_cmd docker age jq gzip awk mkfifo ssh-keygen
DEPLOY_ENV_VAL="$(deploy_env_of "$DEPLOY_DIR")"
[ -n "$DEPLOY_ENV_VAL" ] || die "$DEPLOY_DIR/.env içinde DEPLOY_ENV development|staging|production olmalı (manifest env; restore ortam kilidi)"
# İmza anahtarı (ADR-0020 m.1): yoksa, root sahibi ve 600 değilse yedek alınmaz.
SIGN_KEY="${BACKUP_SIGNING_KEY:-/etc/remote-backup/manifest_ed25519}"
STEP=imza
file_root_600 "$SIGN_KEY" || die "imza anahtarı $SIGN_KEY yok ya da sahibi root/izni 600 değil (üretim: runbook §18.1)"
SIGNER="$(ssh-keygen -l -E sha256 -f "$SIGN_KEY" 2>/dev/null | awk '{print $2}')"
[[ "$SIGNER" =~ ^SHA256:[A-Za-z0-9+/]{43}$ ]] || die "imza anahtarının parmak izi okunamadı ($SIGN_KEY)"
STEP=önkoşul
EXPECTED_TRIGGERS="${BACKUP_EXPECTED_TRIGGERS:-22}"  # P16 (ADR-0030 m.3, S16-11): 3 audit + 19 kalıcı silme
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
backup_lock
offsite_normalize   # S-P13b-6: öldürülmüş kancadan kalan grup okuma izni geri alınır
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

# --- 2b. Audit süreklilik (P13b D2 + G-P13b-5 + S-P13b-1; lib-audit.sh) ---------------------------------------------
STEP=audit-sureklilik
SQL_DIR="$(sql_dir)"
audit_find_prev
audit_measure
STEP=tetikleyici
jq -e '.triggers.ok == true' <<<"$AUDIT_JSON" >/dev/null || die "audit tetikleyici gövde özeti beklenen değil (count=$(jq -r '.triggers.count' <<<"$AUDIT_JSON")) — tetikleyici değiştirilmiş olabilir (runbook §19.10)"
STEP=audit-sureklilik
audit_marker_load
audit_compare

RUN="$(date -u +%Y%m%dT%H%M%SZ)"
[ ! -e "$BACKUP_DIR/$RUN" ] || die "$BACKUP_DIR/$RUN zaten var (aynı saniyede iki çalıştırma)"
WORK="$BACKUP_DIR/.partial-$RUN"
mkdir -m 700 -- "$WORK"
log "başladı run=$RUN db=$DB_NAME migration=$LAST_MIGRATION tetikleyici=$TRIGGERS volume=$UPLOADS_VOL"

# Düz döküm ve arşiv DİSKE YAZILMAZ (S-P13a-3): akış -> (sayım/özet yan kanalları) -> gzip -> age. Özet ve boyutlar
# FIFO'lar üzerinden arka plan süreçleriyle hesaplanır; $WORK'te yalnız sayılar/özetler (kişisel veri yok) durur.
OUT="$WORK/out"; mkdir -m 700 -- "$OUT"
BG_PIDS=()   # side / wait_side / count_bytes: lib.sh

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

STEP=imha-defteri
ledger_backup
# --- 5. Manifest ---------------------------------------------------------------------------------------------------
STEP=manifest
COMMIT="$(git -C "$DEPLOY_DIR/.." rev-parse --short=12 HEAD 2>/dev/null || echo unknown)"
IMAGE_TAG_VAL="$(awk -F= '$1 == "IMAGE_TAG" {print $2}' "$DEPLOY_DIR/.env" 2>/dev/null | tail -n 1)"
TABLES_JSON="$(jq -Rn '[inputs | split("\t") | {(.[0]): (.[1] | tonumber)}] | add' < "$WORK/rows.tsv")"
{
  file_json db.sql.gz.age "$OUT/db.sql.gz.age" "$(cat "$WORK/db.size.out")" "$(cat "$WORK/db.sha.out")"
  file_json uploads.tar.gz.age "$OUT/uploads.tar.gz.age" "$(cat "$WORK/up.size.out")" "$(cat "$WORK/up.sha.out")"
  file_json "$LEDGER_FILE.age" "$OUT/$LEDGER_FILE.age" "$(jq .bytes <<<"$LEDGER_STATS")" "$(jq -r .sha256 <<<"$LEDGER_STATS")"
} | jq -s '.' > "$WORK/files.json"
jq -n --arg createdUtc "$(ts)" --arg run "$RUN" --arg host "$HOST_SHORT" --arg commit "$COMMIT" \
  --arg env "$DEPLOY_ENV_VAL" --arg signer "$SIGNER" --argjson seq "$((PREV_SEQ + 1))" --arg prevRun "$PREV_RUN" \
  --argjson audit "$AUDIT_JSON" --arg auditResult "${AUDIT_RESULT%% *}" --arg auditDetail "$AUDIT_RESULT" \
  --argjson baselineMarker "$(audit_marker_used)" \
  --arg imageTag "${IMAGE_TAG_VAL:-local}" --arg mysqlVersion "$MYSQL_VERSION" --arg mysqlImage "$MYSQL_IMAGE_ID" \
  --arg database "$DB_NAME" --arg lastMigration "$LAST_MIGRATION" --argjson migrationsApplied "$MIGRATIONS" \
  --argjson triggers "$TRIGGERS" --arg triggerNames "$TRIGGER_NAMES" --argjson tables "$TABLES_JSON" --argjson upFiles "$UP_FILES" \
  --arg upDigest "$UP_DIGEST" --slurpfile files "$WORK/files.json" --arg recipients "$BACKUP_AGE_RECIPIENT" \
  --argjson ledger "$LEDGER_JSON" --argjson keepDays "$KEEP_DAYS" --argjson durationSeconds "$(( $(date -u +%s) - START_EPOCH ))" \
  '{format: 2, run: $run, seq: $seq, prevRun: $prevRun, createdUtc: $createdUtc, env: $env, host: $host, signer: $signer,
    version: {commit: $commit, imageTag: $imageTag, mysql: $mysqlVersion, mysqlImage: $mysqlImage},
    database: $database, lastMigration: $lastMigration, migrationsApplied: $migrationsApplied, triggers: $triggers,
    triggerNames: ($triggerNames | split(",") | map(select(length > 0))),
    tables: $tables, uploads: {files: $upFiles, listSha256: $upDigest}, files: $files[0],
    ageRecipients: ($recipients | gsub(","; " ") | split(" ") | map(select(length > 0))),
    keepDays: $keepDays, ledger: $ledger, durationSeconds: $durationSeconds,
    audit: $audit, auditContinuity: {result: $auditResult, detail: $auditDetail, comparedWith: $prevRun,
      baselineMarker: $baselineMarker}}' > "$OUT/manifest.json"

# --- 5b. İmza (ADR-0020 m.1) -----------------------------------------------------------------------------------------
STEP=imza
ssh-keygen -q -Y sign -f "$SIGN_KEY" -n remote-backup "$OUT/manifest.json" 2>/dev/null || die "manifest imzalanamadı"
[ -s "$OUT/manifest.json.sig" ] || die "imza dosyası boş"

# --- 6. Yayımla (atomik ad değişikliği) ---------------------------------------------------------------------------
STEP=yayımla
chmod 600 "$WORK/out/"*
chmod 700 "$WORK/out"
mv -- "$WORK/out" "$BACKUP_DIR/$RUN"
rm -rf -- "$WORK"; WORK=""

# --- 7. Rotasyon (yalnız başarılı yedekten sonra; lib.sh rotate_runs) ------------------------------------------------
STEP=rotasyon
rotate_runs "$RUN" "$PREV_RUN"

# --- 8. Site dışı kanca (lib-offsite.sh) ------------------------------------------------------------------------------
STEP="site-disi"
offsite_run "$RUN"

# Audit taban çizgisi sıfırlandıysa: host işareti imzalı manifestte, dosya tüketilir; uyarı alarmı (birim başarılı).
case "$AUDIT_RESULT" in
  taban-cizgisi-sifirlandi*)
    rm -f -- "$(baseline_marker_path)"
    offsite_alert "remote-backup: audit-sureklilik $AUDIT_RESULT host=$HOST_SHORT run=$RUN (uyarı: taban çizgisi elle/geri yüklemeyle sıfırlandı)" ;;
esac

ledger_after_publish
STEP=bitti
db_bytes="$(jq -r '.files[0].bytes' "$BACKUP_DIR/$RUN/manifest.json")"
up_bytes="$(jq -r '.files[1].bytes' "$BACKUP_DIR/$RUN/manifest.json")"
printf '%s remote-backup: OK run=%s dizin=%s db=%sB uploads=%sB/%s dosya tablo=%s tetikleyici=%s silinen=%s kalan=%s süre=%ss\n' \
  "$(ts)" "$RUN" "$BACKUP_DIR/$RUN" "$db_bytes" "$up_bytes" "$UP_FILES" "$(jq '.tables | length' "$BACKUP_DIR/$RUN/manifest.json")" \
  "$TRIGGERS" "$removed" "$kept" "$(( $(date -u +%s) - START_EPOCH ))"
printf '%s remote-backup: audit-sureklilik: %s env=%s seq=%s signer=%s\n' "$(ts)" "$AUDIT_RESULT" "$DEPLOY_ENV_VAL" "$((PREV_SEQ + 1))" "$SIGNER" >&2
[ "${AUDIT_RESULT%% *}" != FAILED ] || { STEP=audit-sureklilik; exit 1; }
[ "${LEDGER_RESULT%% *}" != FAILED ] || { STEP=imha-defteri; exit 1; }
M_LAST_SUCCESS="$(date -u +%s)"
