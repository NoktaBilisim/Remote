#!/usr/bin/env bash
# Remote Support — geri yükleme ve doğrulama (P13a + P13b; docs/mimari-p13.md §4 ve §7.6, ADR-0020, AC-91, AC-200;
# runbook §18.4–18.6).
#
#   restore.sh --identity <age-anahtarı> [--allowed-signers <dosya>] [--target scratch] <çalıştırma-dizini>
#       Geçici, ağsız bir MySQL konteynerine (compose ile aynı imaj + bayraklar + deploy/mysql/init) MIGRATOR ile yükler
#       ve manifestle karşılaştırır. Son satır: "restore-verify: OK" veya "restore-verify: FAIL". Canlıya dokunmaz;
#       yönetici iş istasyonunda da çalışır (docker + age + jq + ssh-keygen >= 8.9).
#
#   restore.sh --identity <anahtar> --target staging|production --confirm <veritabanı>@<hostname -s> \
#              [--no-pre-backup] <çalıştırma-dizini>
#       ÖNCE scratch doğrulaması (FAIL ise canlıya dokunulmaz). Sonra deploy/ yığınında: ön yedek (backup.sh) ->
#       `stop web server` -> güvenlik anlık görüntüsü (anon=0, migratorExtra=0 şart) -> restore-reset-db.sql (migrator;
#       DROP/CREATE DATABASE) -> migrator ile yükleme -> anlık görüntü eşit -> uploads -> CHECKSUM canlı = scratch ->
#       satır/tetikleyici = manifest -> backup.sh --reset-audit-baseline (SQL + host işareti, S-P13b-1) -> up -d -> /ready.
#
# 1. İLK ADIM İMZA (ADR-0020 m.1): manifest.json.sig, --allowed-signers (vars. /etc/remote-backup/allowed_signers) ile
#    `ssh-keygen -Y verify -n remote-backup -Overify-time=<manifest.createdUtc>` doğrulanır. Geçmezse sha256, çözme ve
#    yükleme YAPILMAZ: "restore-verify: FAIL (imza)". Atlama seçeneği YOKTUR. İmzalayan anahtar = manifest.signer.
# 2. Tazelik (G-P13b-8): dizin adı çalıştırma adı biçimindeyse manifest.run ile aynı olmalı; manifest yaşı ve sıra
#    numarası yazılır; aynı üst dizinde daha yeni yedek varsa uyarılır. production'da 48 saatten eski ya da en yeni
#    olmayan yedek için TTY'de ayrıca "ESKI-<run>" yazılır.
# 3. Ortam kilidi (S-P13a-6): staging|production hedefinde deploy/.env DEPLOY_ENV = hedef = manifest.env, --confirm,
#    compose projesi RESTORE_EXPECT_PROJECT (vars. remote), root. production ek olarak: manifest.host = hostname -s ve
#    TTY'de "PRODUCTION-<hostname -s>" (TTY yoksa ret).
#
# Güvenlik (S-P13a-2/3, D1/D2): döküm migrator ile `--system-command=OFF --local-infile=0` yüklenir (root yazmaz; root
# yalnız salt okunur deploy/mysql/restore-sec-snapshot.sql için); dökümde istemci meta-komutu varsa FAIL; anlık görüntü
# önce/sonra farklıysa FAIL; tablo içerikleri CHECKSUM TABLE ile scratch = canlı. Çözülmüş dosyalar yalnız RAM'de
# (/dev/shm); yoksa --work-dir <şifreli disk dizini> açıkça verilir.
#
# Seçenekler: --keep (scratch konteynerini bırakır), --work-dir <dizin>, RESTORE_READY_TIMEOUT (sn, vars. 240).
# Çıkış: 0 OK · 1 doğrulama FAIL / hata / ret · 2 kullanım hatası.
set -euo pipefail
umask 077
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/backup/lib.sh
. "$SCRIPT_DIR/lib.sh"
# shellcheck source=deploy/backup/lib-restore.sh
. "$SCRIPT_DIR/lib-restore.sh"
# shellcheck source=deploy/backup/lib-ledger.sh
. "$SCRIPT_DIR/lib-ledger.sh"   # P16: defter doğrulama (scratch) + uzlaştırma, erasure:replay/verify (canlı; runbook §23.5)
DEPLOY_DIR="${BACKUP_DEPLOY_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
LOG_TAG=remote-restore

usage() { sed -n '2,33p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }
IDENTITY=""; TARGET=scratch; CONFIRM=""; PRE_BACKUP=1; KEEP=0; RUN_DIR=""; WORK_PARENT=""
ALLOWED_SIGNERS=/etc/remote-backup/allowed_signers
while [ $# -gt 0 ]; do
  case "$1" in
    --identity) IDENTITY="${2:-}"; shift 2 ;;
    --allowed-signers) ALLOWED_SIGNERS="${2:-}"; shift 2 ;;
    --target) TARGET="${2:-}"; shift 2 ;;
    --confirm) CONFIRM="${2:-}"; shift 2 ;;
    --no-pre-backup) PRE_BACKUP=0; shift ;;
    --keep) KEEP=1; shift ;;
    --work-dir) WORK_PARENT="${2:-}"; shift 2 ;;
    -h|--help) usage ;;
    -*) echo "bilinmeyen seçenek: $1" >&2; usage ;;
    *) [ -z "$RUN_DIR" ] || usage; RUN_DIR="$1"; shift ;;
  esac
done
[ -n "$IDENTITY" ] && [ -n "$RUN_DIR" ] || usage
case "$TARGET" in
  scratch|staging|production) ;;
  *) echo "--target scratch|staging|production" >&2; usage ;;
esac
need_cmd docker age jq gzip awk ssh-keygen
[ -d "$RUN_DIR" ] || die "çalıştırma dizini yok: $RUN_DIR"
RUN_DIR="$(cd "$RUN_DIR" && pwd)"
[ -f "$RUN_DIR/manifest.json" ] || die "manifest yok: $RUN_DIR/manifest.json"
# S-P13b-2: manifest + imza önce 700 bir dizine KOPYALANIR; doğrulama ve sonraki BÜTÜN okumalar bu kopyadan yapılır
# (RUN_DIR'e yazabilen biri doğrulamadan sonra manifesti değiştiremez).
VDIR="$(mktemp -d "${TMPDIR:-/tmp}/remote-restore-m.XXXXXX")"; chmod 700 "$VDIR"
trap 'rm -rf -- "$VDIR"' EXIT
cp -- "$RUN_DIR/manifest.json" "$VDIR/manifest.json"
[ ! -f "$RUN_DIR/manifest.json.sig" ] || cp -- "$RUN_DIR/manifest.json.sig" "$VDIR/manifest.json.sig"
MANIFEST="$VDIR/manifest.json"
EXPECTED_TRIGGERS="${RESTORE_EXPECTED_TRIGGERS:-22}"  # P16 (S16-11): restore-verify beklenen tetikleyici
READY_TIMEOUT="${RESTORE_READY_TIMEOUT:-240}"
HOST_SHORT="$(hostname -s 2>/dev/null || hostname)"

FAILS=0
check() {  # <ad> <beklenen> <bulunan>
  if [ "$2" = "$3" ]; then printf 'CHECK OK    %-28s %s\n' "$1" "$3"
  else printf 'CHECK FAIL  %-28s beklenen=%s bulunan=%s\n' "$1" "$2" "$3"; FAILS=$((FAILS + 1)); fi
}
verdict() {
  if [ "$FAILS" -eq 0 ]; then echo "restore-verify: OK"; else echo "restore-verify: FAIL ($FAILS kontrol)"; exit 1; fi
}
reject() { log "RET: $*"; echo "restore-verify: FAIL (ret)"; exit 1; }

# --- 0. İmza: her şeyden ÖNCE (ADR-0020 m.1; atlama seçeneği yok) ------------------------------------------------
[ -f "$ALLOWED_SIGNERS" ] || { log "allowed_signers yok: $ALLOWED_SIGNERS (--allowed-signers <dosya>; kasadaki kopya)"; echo "restore-verify: FAIL (imza)"; exit 1; }
if ! SIG_FP="$(verify_manifest_sig "$MANIFEST" "$ALLOWED_SIGNERS")"; then
  log "manifest imzası doğrulanamadı (imza yok/bozuk, manifest değiştirilmiş ya da anahtar allowed_signers'ta yok/süresi geçmiş) — çözme ve yükleme YAPILMADI"
  echo "restore-verify: FAIL (imza)"; exit 1
fi
printf 'CHECK OK    %-28s %s\n' "manifest imzası" "$SIG_FP"
# Bundan sonra manifest güvenilir (imzalı). P13b biçimi şart.
[ "$(jq -r '.format' "$MANIFEST")" = 2 ] || reject "manifest biçimi 2 değil"
check "imzalayan = manifest.signer" "$(jq -r '.signer' "$MANIFEST")" "$SIG_FP"
[ "$FAILS" -eq 0 ] || verdict

M_RUN="$(jq -r '.run' "$MANIFEST")"; M_ENV="$(jq -r '.env' "$MANIFEST")"; M_HOST="$(jq -r '.host' "$MANIFEST")"
M_SEQ="$(jq -r '.seq' "$MANIFEST")"; M_CREATED="$(jq -r '.createdUtc' "$MANIFEST")"
# S-P13b-2: imzalı olsa da SQL/log metnine giren alanlar dar biçimle denetlenir.
[[ "$M_RUN" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || reject "manifest.run biçimi geçersiz"
case "$M_ENV" in development|staging|production) ;; *) reject "manifest.env geçersiz" ;; esac
[[ "$M_HOST" =~ ^[A-Za-z0-9.-]{1,64}$ ]] || reject "manifest.host geçersiz"
[[ "$M_SEQ" =~ ^[0-9]{1,9}$ ]] || reject "manifest.seq geçersiz"
DB_NAME="$(jq -r '.database' "$MANIFEST")"
[[ "$DB_NAME" =~ ^[A-Za-z0-9_]{1,64}$ ]] || die "manifestte geçersiz veritabanı adı"
jq -e '.tables | keys | all(test("^[A-Za-z0-9_]{1,64}$"))' "$MANIFEST" >/dev/null || die "manifestte geçersiz tablo adı"

# --- 0b. Tazelik (G-P13b-8) -------------------------------------------------------------------------------------------
RUN_NAME="${RUN_DIR##*/}"
if [[ "$RUN_NAME" =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; then
  [ "$RUN_NAME" = "$M_RUN" ] || reject "dizin adı ($RUN_NAME) manifest.run ($M_RUN) ile aynı değil — başka bir yedek bu ada kopyalanmış olabilir"
else
  log "uyarı: dizin adı çalıştırma biçiminde değil ($RUN_NAME); manifest.run=$M_RUN"
fi
created_epoch="$(utc_to_epoch "$M_CREATED")"
AGE_H=-1; [ -n "$created_epoch" ] && AGE_H=$(( ($(date -u +%s) - created_epoch) / 3600 ))
NEWER=""
while IFS= read -r d; do
  n="${d##*/}"
  [[ "$n" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] && [[ "$n" > "$M_RUN" ]] && [ -f "$d/manifest.json" ] && NEWER="$n"
done < <(find "${RUN_DIR%/*}" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | LC_ALL=C sort)
log "çalıştırma $M_RUN · sıra $M_SEQ · env $M_ENV · host $M_HOST · yaş ${AGE_H} sa · commit $(jq -r '.version.commit' "$MANIFEST") · migration $(jq -r '.lastMigration' "$MANIFEST") · hedef $TARGET"
[ -z "$NEWER" ] || log "UYARI: aynı dizinde DAHA YENİ bir yedek var ($NEWER) — en yenisini mi yüklemek istiyorsunuz?"

# --- 0c. Ortam kilidi (S-P13a-6, ADR-0020): çözmeden önce ---------------------------------------------------------
if [ "$TARGET" != scratch ]; then
  DEPLOY_ENV_VAL="$(deploy_env_of "$DEPLOY_DIR")"
  [ "$DEPLOY_ENV_VAL" = "$TARGET" ] || reject "--target $TARGET ama $DEPLOY_DIR/.env DEPLOY_ENV='${DEPLOY_ENV_VAL}' (yanlış sunucu/yığın?)"
  [ "$M_ENV" = "$TARGET" ] || reject "yedek env=$M_ENV, hedef $TARGET — başka ortamın yedeği yüklenmez"
  [ "$CONFIRM" = "$DB_NAME@$HOST_SHORT" ] || reject "--target $TARGET için --confirm $DB_NAME@$HOST_SHORT gerekli (canlı veritabanı SİLİNİP yeniden yüklenir; runbook §18.5)"
  [ "$(id -u)" = 0 ] || reject "--target $TARGET root ile çalıştırılır"
  if [ "$TARGET" = production ]; then
    [ "$M_HOST" = "$HOST_SHORT" ] || reject "yedek host=$M_HOST, bu sunucu $HOST_SHORT"
    { [ -t 0 ] && [ -t 2 ] && [ -r /dev/tty ]; } || reject "--target production etkileşimli terminal (TTY) ister"
    printf 'PRODUCTION geri yüklemesi: %s@%s, yedek %s (yaş %s sa). Onay için PRODUCTION-%s yazın: ' "$DB_NAME" "$HOST_SHORT" "$M_RUN" "$AGE_H" "$HOST_SHORT" >&2
    read -r ans < /dev/tty || ans=""
    [ "$ans" = "PRODUCTION-$HOST_SHORT" ] || reject "production onayı verilmedi"
    if [ "$AGE_H" -lt 0 ] || [ "$AGE_H" -gt 48 ] || [ -n "$NEWER" ]; then
      printf 'DİKKAT: yedek %s sa önce alınmış%s. Bilerek yüklemek için ESKI-%s yazın: ' "$AGE_H" "${NEWER:+ ve daha yenisi var ($NEWER)}" "$M_RUN" >&2
      read -r ans < /dev/tty || ans=""
      [ "$ans" = "ESKI-$M_RUN" ] || reject "eski yedek onayı verilmedi"
    fi
  fi
fi
[ -f "$IDENTITY" ] && [ -r "$IDENTITY" ] || die "anahtar dosyası okunamıyor: $IDENTITY"
SQL_DIR="$(sql_dir)"

T0="$(date -u +%s)"
WORK=""; SCRATCH=""
cleanup() {
  local rc=$?
  if [ -n "$SCRATCH" ]; then
    if [ "$KEEP" = 1 ]; then log "scratch konteyneri bırakıldı: $SCRATCH (silmek: docker rm -fv $SCRATCH)"
    else docker rm -fv "$SCRATCH" >/dev/null 2>&1 || true; fi
  fi
  [ -n "$WORK" ] && [ -d "$WORK" ] && rm -rf -- "$WORK"
  rm -rf -- "$VDIR"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# --- 1. Şifreli dosya bütünlüğü (anahtar kullanılmadan önce) -----------------------------------------------------
# S-P13a-3: çözülmüş döküm/arşiv yalnız RAM'de (/dev/shm). Yoksa (macOS) veya yer yetmezse açık hata; bilinçli seçim
# için --work-dir (ör. şifreli disk). Gereken yer: iki düz dosya + %10.
need_kb=$(( $(jq '[.files[].plainBytes] | add' "$MANIFEST") * 11 / 10240 + 1024 ))
if [ -z "$WORK_PARENT" ]; then
  [ -d /dev/shm ] && [ -w /dev/shm ] || die "/dev/shm yok/yazılamıyor; çözülmüş veri için --work-dir <şifreli disk dizini> verin"
  WORK_PARENT=/dev/shm
fi
[ -d "$WORK_PARENT" ] && [ -w "$WORK_PARENT" ] || die "çalışma dizini yazılamıyor: $WORK_PARENT"
free_kb="$(df -Pk "$WORK_PARENT" | awk 'NR == 2 {print $4}')"
[ "$free_kb" -ge "$need_kb" ] || die "$WORK_PARENT boş alan $((free_kb / 1024)) MB < gereken $((need_kb / 1024)) MB (--work-dir ile başka dizin verin)"
WORK="$(mktemp -d "$WORK_PARENT/remote-restore.XXXXXX")"; chmod 700 "$WORK"
for name in db.sql.gz.age uploads.tar.gz.age; do
  f="$RUN_DIR/$name"; [ -f "$f" ] || die "dosya yok: $f"
  check "$name sha256" "$(jq -r --arg n "$name" '.files[] | select(.name == $n) | .sha256' "$MANIFEST")" "$(sha256_file "$f")"
done
[ "$FAILS" -eq 0 ] || { log "şifreli dosya özeti tutmuyor (bozulma/kurcalama) — çözülmedi"; verdict; }

# --- 2. Çözme -------------------------------------------------------------------------------------------------------
T1="$(date -u +%s)"
for name in db.sql.gz uploads.tar.gz; do
  age -d -i "$IDENTITY" -o "$WORK/$name" "$RUN_DIR/$name.age" || die "$name.age çözülemedi (yanlış anahtar?)"
  check "$name düz sha256" "$(jq -r --arg n "$name.age" '.files[] | select(.name == $n) | .plainSha256' "$MANIFEST")" "$(sha256_file "$WORK/$name")"
done
{ gzip -t "$WORK/db.sql.gz" && gzip -t "$WORK/uploads.tar.gz"; } || die "gzip bütünlüğü bozuk"
check "dökümde istemci komutu" 0 "$(gzip -dc "$WORK/db.sql.gz" | dump_client_command_count)"
[ "$FAILS" -eq 0 ] || verdict
T2="$(date -u +%s)"

MYSQL_IMAGE="$(compose_mysql_image "$DEPLOY_DIR")"
# --- 3. Scratch: yükle + doğrula -----------------------------------------------------------------------------------
log "scratch MySQL başlatılıyor ($MYSQL_IMAGE)"
start_scratch
T3="$(date -u +%s)"
SEC_BEFORE="$(sec_snapshot "$SCRATCH")"
sec_precondition "scratch hesap koşulu" "$SEC_BEFORE"
[ "$FAILS" -eq 0 ] || verdict
load_dump "$SCRATCH" || { check "döküm yükleme (migrator)" 0 "rc≠0"; verdict; }
sec_check "hesap/yetki/rutin değişmedi" "$SEC_BEFORE" "$(sec_snapshot "$SCRATCH")"
T4="$(date -u +%s)"
verify_db "$SCRATCH"
checksum_tables "$SCRATCH" > "$WORK/checksum.scratch" || check "CHECKSUM (scratch)" 0 "rc≠0"
read -r up_n up_d < <(uploads_digest "$MYSQL_IMAGE" < "$WORK/uploads.tar.gz")
check "uploads dosya sayısı" "$(jq -r '.uploads.files' "$MANIFEST")" "$up_n"
check "uploads özet listesi" "$(jq -r '.uploads.listSha256' "$MANIFEST")" "$up_d"
ledger_restore_check "$SCRATCH"
T5="$(date -u +%s)"
printf 'restore-sure: toplam %ss (çözme %ss, MySQL açılış %ss, yükleme %ss, doğrulama %ss)\n' \
  "$((T5 - T0))" "$((T2 - T1))" "$((T3 - T2))" "$((T4 - T3))" "$((T5 - T4))"
if [ "$TARGET" = scratch ]; then verdict; exit 0; fi

# --- 4. Canlı (staging|production) -----------------------------------------------------------------------------------
[ "$FAILS" -eq 0 ] || { log "scratch doğrulaması FAIL — canlı yığına DOKUNULMADI"; verdict; }
docker rm -fv "$SCRATCH" >/dev/null 2>&1 || true; SCRATCH=""
cd "$DEPLOY_DIR"
LIVE="$(docker compose ps -q mysql)"; [ -n "$LIVE" ] || die "canlı mysql konteyneri yok ($DEPLOY_DIR)"
PROJECT="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$LIVE")"
[ "$PROJECT" = "${RESTORE_EXPECT_PROJECT:-remote}" ] || die "compose projesi '$PROJECT', beklenen '${RESTORE_EXPECT_PROJECT:-remote}' (S-P13a-6)"
LIVE_DB="$(docker exec "$LIVE" sh -c 'printf %s "$MYSQL_DATABASE"')"
[ "$LIVE_DB" = "$DB_NAME" ] || die "canlı MYSQL_DATABASE ($LIVE_DB) manifestteki ($DB_NAME) ile aynı değil"
UPLOADS_VOL="$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" --filter label=com.docker.compose.volume=uploads)"
[ -n "$UPLOADS_VOL" ] || die "uploads volume'u bulunamadı"

if [ "$PRE_BACKUP" = 1 ]; then
  log "geri yükleme öncesi güncel durumun yedeği alınıyor (atlamak: --no-pre-backup)"
  "$SCRIPT_DIR/backup.sh" || die "ön yedek başarısız; bilinçli olarak atlamak için --no-pre-backup"
fi
T6="$(date -u +%s)"
log "server ve web durduruluyor"
docker compose stop web server
SEC_LIVE_BEFORE="$(sec_snapshot "$LIVE")"
sec_precondition "canlı hesap koşulu" "$SEC_LIVE_BEFORE"
[ "$FAILS" -eq 0 ] || { log "canlı yetki durumu beklenmedik — DB'ye DOKUNULMADI, server DURDURULMUŞ (runbook §19)"; verdict; }
log "veritabanı migrator ile boşaltılıyor ($DB_NAME; deploy/mysql/restore-reset-db.sql)"
reset_sql="$(printf "SET @rs_confirm_db = '%s';\n" "$DB_NAME"; cat "$SQL_DIR/restore-reset-db.sql")"   # QA-P13c-2: boru yok
reset_out="$(sql_migrator "$LIVE" <<<"$reset_sql")" \
  || die "restore-reset-db.sql başarısız — DB değişmedi (guard) ya da yok kaldı: runbook §19 'Veri bozuldu'"
case "$reset_out" in "restore-reset: OK $DB_NAME "*) log "$reset_out" ;; *) die "beklenmeyen reset çıktısı" ;; esac
log "döküm migrator ile yükleniyor"
load_dump "$LIVE" || die "döküm canlı MySQL'e yüklenemedi — server DURDURULMUŞ kaldı (runbook §19 'Veri bozuldu')"
log "uploads volume'u geri yükleniyor ($UPLOADS_VOL)"
docker run --rm -i --network none --cap-drop ALL --cap-add CHOWN --cap-add FOWNER --cap-add DAC_OVERRIDE \
  --security-opt no-new-privileges:true --user 0 -v "$UPLOADS_VOL:/u" --entrypoint bash "$MYSQL_IMAGE" \
  -c 'set -euo pipefail; find /u -mindepth 1 -delete; tar -C /u --same-owner -xzpf -' < "$WORK/uploads.tar.gz"
sec_check "hesap/yetki/rutin değişmedi (canlı)" "$SEC_LIVE_BEFORE" "$(sec_snapshot "$LIVE")"
checksum_tables "$LIVE" > "$WORK/checksum.live" || check "CHECKSUM (canlı)" 0 "rc≠0"
checksum_check "CHECKSUM canlı = scratch" "$WORK/checksum.scratch" "$WORK/checksum.live"
verify_db "$LIVE"
read -r up_n up_d < <(volume_digest "$MYSQL_IMAGE" "$UPLOADS_VOL")
check "uploads dosya sayısı (volume)" "$(jq -r '.uploads.files' "$MANIFEST")" "$up_n"
check "uploads özet listesi (volume)" "$(jq -r '.uploads.listSha256' "$MANIFEST")" "$up_d"
[ "$FAILS" -eq 0 ] || { log "canlı doğrulama FAIL — server DURDURULMUŞ bırakıldı (runbook §19 'Veri bozuldu')"; verdict; }
# Audit taban çizgisi (G-P13b-5, S-P13b-1): geri yükleme datadir'i değiştirmez. `backup.sh --reset-audit-baseline`
# audit-baseline-reset.sql'i migrator ile çalıştırır VE BACKUP_DIR'e root 600 host işaretini yazar; sonraki yedek ikisini
# eşleştirip "taban-cizgisi-sifirlandi" (uyarı) der. CHECKSUM'dan SONRA (audit satırı yazar).
"$SCRIPT_DIR/backup.sh" --reset-audit-baseline "restore $M_RUN sonrasi (restore.sh --target $TARGET)" \
  || die "audit taban çizgisi sıfırlanamadı (veri yüklendi, server DURDURULMUŞ): backup.sh --reset-audit-baseline '<gerekçe>' + docker compose up -d (runbook §18)"
ledger_live_reconcile; ledger_live_replay   # S16-5: server DURURKEN; başarısızsa server başlatılmaz
log "yığın başlatılıyor (migrate önce)"
docker compose up -d
deadline=$(( $(date -u +%s) + READY_TIMEOUT ))
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q server)" 2>/dev/null)" = healthy ]; do
  [ "$(date -u +%s)" -lt "$deadline" ] || die "server ${READY_TIMEOUT} sn içinde healthy olmadı (docker compose logs server migrate)"
  sleep 2
done
ready="$(docker compose exec -T server node -e "fetch('http://127.0.0.1:3001/ready').then(async r=>console.log(r.status, await r.text()))")"
check "/ready" 200 "${ready%% *}"
ledger_live_verify
T7="$(date -u +%s)"
printf 'restore-sure: %s kesintisi %ss (durdurma -> /ready 200), toplam %ss\n' "$TARGET" "$((T7 - T6))" "$((T7 - T0))"
verdict
