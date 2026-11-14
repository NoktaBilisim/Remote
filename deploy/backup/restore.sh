#!/usr/bin/env bash
# Remote Support — geri yükleme ve doğrulama (P13a; docs/mimari-p13.md §4, AC-91, AC-200; runbook §18.4–18.6).
#
#   restore.sh --identity <age-anahtar-dosyası> [--target scratch] <çalıştırma-dizini>
#       Geçici, ağsız bir MySQL konteynerine (compose ile aynı imaj + bayraklar) yükler ve manifestle karşılaştırır:
#       şifreli/düz dosya sha256, tetikleyici sayısı (beklenen RESTORE_EXPECTED_TRIGGERS, vars. 3), son migration,
#       tablo kümesi + satır sayıları, uploads özet listesi. Son satır: "restore-verify: OK" veya "restore-verify: FAIL".
#       Canlı sisteme dokunmaz; yönetici iş istasyonunda da çalışır (yalnız docker + age + jq gerekir).
#
#   restore.sh --identity <anahtar> --target staging --confirm <veritabanı>@<hostname> [--no-pre-backup] <çalıştırma-dizini>
#       ÖNCE yukarıdaki scratch doğrulamasını yapar (FAIL ise hiçbir şeye dokunmaz). Ardından deploy/ yığınında:
#       (varsayılan) güncel durumun yedeği (backup.sh) -> server + web durdurulur -> veritabanı root ile silinip
#       yeniden oluşturulur ve döküm yüklenir -> uploads volume'u boşaltılıp arşiv açılır -> aynı doğrulama canlı
#       DB/volume üzerinde -> `docker compose up -d` (migrate önce) -> server healthy (/ready 200) beklenir.
#       Kullanıcı hesapları (app/migrator/backup) ve yetkileri mysql şemasındadır, DB silinince kaybolmaz.
#       Ortam kilidi (S-P13a-6): --confirm'deki hostname `hostname -s` ile, compose projesi RESTORE_EXPECT_PROJECT
#       (vars. remote) ile eşleşmeli. Prod hedefi yok (P13b'de ayrı bayrak + ayrı onay).
#
# Güvenlik (S-P13a-2/3): döküm `mysql --system-command=OFF` ile yüklenir; dökümde istemci meta-komutu (tırnak dışında
# satırın herhangi bir yerinde `\X`, satır başında system/source/tee/pager/connect/use/edit/charset) varsa FAIL; yükleme
# öncesi/sonrası hesap listesi + yetki tabloları/mysql.component CHECKSUM + ROUTINES/EVENTS + persisted_variables özeti
# farklıysa FAIL. Çözülmüş dosyalar yalnız RAM'de (/dev/shm) tutulur; yoksa veya yer yetmezse --work-dir <dizin> açıkça
# verilmelidir (iş istasyonunda şifreli disk). Manifest imzası ve tablo içeriği CHECKSUM karşılaştırması yok: site dışı
# yedekten (P13b) önce zorunlu (runbook §18.4).
#
# Seçenekler: --keep (scratch konteynerini incelemek için bırakır), --work-dir <dizin>, RESTORE_READY_TIMEOUT (sn, vars. 240).
# Özel anahtar: yalnız bu çalıştırma süresince; sunucuda ise RAM'de (/dev/shm) tutulur ve hemen silinir (runbook §18.4).
# Çıkış: 0 OK · 1 doğrulama FAIL / hata · 2 kullanım hatası.
set -euo pipefail
umask 077
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/backup/lib.sh
. "$SCRIPT_DIR/lib.sh"
DEPLOY_DIR="${BACKUP_DEPLOY_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
LOG_TAG=remote-restore

usage() { sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }
IDENTITY=""; TARGET=scratch; CONFIRM=""; PRE_BACKUP=1; KEEP=0; RUN_DIR=""; WORK_PARENT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --identity) IDENTITY="${2:-}"; shift 2 ;;
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
  scratch|staging) ;;
  production|prod) die "--target production henüz yok (P13b: ayrı bayrak ve ayrı onayla eklenecek)" ;;
  *) echo "--target scratch|staging" >&2; usage ;;
esac
[ -f "$IDENTITY" ] && [ -r "$IDENTITY" ] || die "anahtar dosyası okunamıyor: $IDENTITY"
RUN_DIR="$(cd "$RUN_DIR" && pwd)"
MANIFEST="$RUN_DIR/manifest.json"
[ -f "$MANIFEST" ] || die "manifest yok: $MANIFEST"
need_cmd docker age jq gzip awk
EXPECTED_TRIGGERS="${RESTORE_EXPECTED_TRIGGERS:-3}"
READY_TIMEOUT="${RESTORE_READY_TIMEOUT:-240}"

T0="$(date -u +%s)"
WORK=""; SCRATCH=""
cleanup() {
  local rc=$?
  if [ -n "$SCRATCH" ]; then
    if [ "$KEEP" = 1 ]; then log "scratch konteyneri bırakıldı: $SCRATCH (silmek: docker rm -fv $SCRATCH)"
    else docker rm -fv "$SCRATCH" >/dev/null 2>&1 || true; fi
  fi
  [ -n "$WORK" ] && [ -d "$WORK" ] && rm -rf -- "$WORK"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

FAILS=0
check() {  # <ad> <beklenen> <bulunan>
  if [ "$2" = "$3" ]; then printf 'CHECK OK    %-28s %s\n' "$1" "$3"
  else printf 'CHECK FAIL  %-28s beklenen=%s bulunan=%s\n' "$1" "$2" "$3"; FAILS=$((FAILS + 1)); fi
}
verdict() {
  if [ "$FAILS" -eq 0 ]; then echo "restore-verify: OK"; else echo "restore-verify: FAIL ($FAILS kontrol)"; exit 1; fi
}

DB_NAME="$(jq -r '.database' "$MANIFEST")"
[[ "$DB_NAME" =~ ^[A-Za-z0-9_]{1,64}$ ]] || die "manifestte geçersiz veritabanı adı"
jq -e '.tables | keys | all(test("^[A-Za-z0-9_]{1,64}$"))' "$MANIFEST" >/dev/null || die "manifestte geçersiz tablo adı"
log "çalıştırma $(jq -r '.run' "$MANIFEST") · commit $(jq -r '.version.commit' "$MANIFEST") · migration $(jq -r '.lastMigration' "$MANIFEST") · hedef $TARGET"

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
# Geçici MySQL: ağsız, compose ile aynı imaj ve bayraklar (tetikleyiciler için --log-bin-trust-function-creators=1).
# --user mysql: entrypoint gosu'yu atlar (Docker Desktop gosu takılması, QA-P5-6; Linux'ta da sorunsuz).
start_scratch() {
  SCRATCH="rs-restore-verify-$(date -u +%s)-$$"
  docker run -d --name "$SCRATCH" --network none --user mysql \
    -e MYSQL_ROOT_PASSWORD="r$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')" -e MYSQL_DATABASE="$DB_NAME" \
    "$MYSQL_IMAGE" --default-time-zone=+00:00 --log-bin-trust-function-creators=1 >/dev/null
  local deadline=$(( $(date -u +%s) + READY_TIMEOUT ))
  while [ "$(date -u +%s)" -lt "$deadline" ]; do
    [ "$(docker inspect -f '{{.State.Running}}' "$SCRATCH" 2>/dev/null)" = true ] || { docker logs --tail 20 "$SCRATCH" >&2; die "scratch MySQL durdu"; }
    if docker logs "$SCRATCH" 2>&1 | grep -q 'mysqld: ready for connections.*port: 3306[^0-9]' &&
       docker exec "$SCRATCH" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -h127.0.0.1 -NBe "SELECT 1"' >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  die "scratch MySQL ${READY_TIMEOUT} sn içinde hazır olmadı"
}

# root SQL (konteyner env'indeki parola; argümana girmez). $1 = konteyner.
# --system-command=OFF: dökümdeki `system`/`\!` kabuk komutu çalışmaz (S-P13a-2).
sql_root() { docker exec -i "$1" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -NB --system-command=OFF --default-character-set=utf8mb4 "$0"' "$DB_NAME"; }

# S-P13a-2: hesap/yetki/rutin/olay/bileşen/kalıcı değişken anlık görüntüsü. Döküm yalnız DB tablolarını ve
# tetikleyicileri içerir; bunlardan biri değişirse döküm hesap/yetki/rutin eklemiş ya da değiştirmiştir (kurcalanmış) -> FAIL.
# Yetki tabloları `CHECKSUM TABLE` ile tüm satır içeriği üzerinden özetlenir (mysql.user'da plugin ve authentication_string
# dahil); parola özeti/değeri hiçbir zaman yazdırılmaz, yalnız tablo sağlama toplamı. Kalıcı değişkenler (SET PERSIST)
# SHA-256 özetiyle karşılaştırılır.
sec_snapshot() {
  sql_root "$1" <<'SQL' | tr '\n\t' ' :'
SELECT COALESCE(GROUP_CONCAT(CONCAT(user, '@', host) ORDER BY user, host SEPARATOR ','), '') FROM mysql.user;
CHECKSUM TABLE mysql.user, mysql.global_grants, mysql.db, mysql.tables_priv, mysql.columns_priv, mysql.procs_priv,
  mysql.proxies_priv, mysql.role_edges, mysql.default_roles, mysql.component;
SELECT CONCAT('routines=', COUNT(*)) FROM information_schema.ROUTINES;
SELECT CONCAT('events=', COUNT(*)) FROM information_schema.EVENTS;
SELECT CONCAT('components=', COUNT(*)) FROM mysql.component;
SELECT CONCAT('persisted=', COUNT(*), '/', LEFT(SHA2(COALESCE(GROUP_CONCAT(CONCAT(VARIABLE_NAME, '=', VARIABLE_VALUE)
  ORDER BY VARIABLE_NAME SEPARATOR ';'), ''), 256), 16)) FROM performance_schema.persisted_variables;
SQL
}
# Anlık görüntüleri öğe öğe karşılaştırır; farklı öğelerin yalnız ADINI yazar (değer/özet yazmaz).
sec_check() {  # <ad> <önce> <sonra>
  local -a a b; local i diff="" key
  read -r -a a <<<"$2"; read -r -a b <<<"$3"
  if [ "${#a[@]}" -ne "${#b[@]}" ]; then diff="öğe-sayısı"; else
    for i in "${!a[@]}"; do
      [ "${a[$i]}" = "${b[$i]}" ] && continue
      key="${a[$i]%%[:=]*}"; [ "$i" -eq 0 ] && key="hesap-listesi"
      diff="${diff:+$diff,}$key"
    done
  fi
  if [ -z "$diff" ]; then printf 'CHECK OK    %-28s %s öğe aynı\n' "$1" "${#a[@]}"
  else printf 'CHECK FAIL  %-28s değişen: %s\n' "$1" "$diff"; FAILS=$((FAILS + 1)); fi
}

verify_db() {  # $1 = konteyner
  local c="$1" q got
  check "tetikleyici sayısı (manifest)" "$(jq -r '.triggers' "$MANIFEST")" \
    "$(echo "SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE();" | sql_root "$c")"
  check "tetikleyici sayısı (beklenen)" "$EXPECTED_TRIGGERS" \
    "$(echo "SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE();" | sql_root "$c")"
  check "son migration" "$(jq -r '.lastMigration' "$MANIFEST")" \
    "$(echo "SELECT COALESCE(MAX(migration_name), '') FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;" | sql_root "$c")"
  check "tablo kümesi" "$(jq -r '.tables | keys | join(",")' "$MANIFEST")" \
    "$(echo "SELECT GROUP_CONCAT(TABLE_NAME ORDER BY TABLE_NAME SEPARATOR ',') FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE';" | sql_root "$c")"
  # Ters tırnaklar SQL tanımlayıcısıdır (kabuk genişletmesi değil):
  # shellcheck disable=SC2016
  q="$(jq -r '.tables | keys | map("SELECT \"" + . + "\", COUNT(*) FROM `" + . + "`") | join(" UNION ALL ") + ";"' "$MANIFEST")"
  got="$(sql_root "$c" <<<"$q" | LC_ALL=C sort)"
  check "tablo satır sayıları" "$(jq -r '.tables | to_entries | map(.key + "\t" + (.value | tostring)) | .[]' "$MANIFEST" | LC_ALL=C sort | tr '\n\t' ';=')" \
    "$(printf '%s\n' "$got" | tr '\n\t' ';=')"
  printf 'INFO        toplam satır %s · tablo %s\n' "$(printf '%s\n' "$got" | awk -F'\t' '{s += $2} END {print s + 0}')" "$(printf '%s\n' "$got" | grep -c .)"
}

# --- 3. Scratch: yükle + doğrula -----------------------------------------------------------------------------------
log "scratch MySQL başlatılıyor ($MYSQL_IMAGE)"
start_scratch
T3="$(date -u +%s)"
[ "$FAILS" -eq 0 ] || { log "döküm yüklenmedi"; verdict; }
SEC_BEFORE="$(sec_snapshot "$SCRATCH")"
gzip -dc "$WORK/db.sql.gz" | fix_trigger_dump | sql_root "$SCRATCH" || die "döküm scratch MySQL'e yüklenemedi"
sec_check "hesap/yetki/rutin değişmedi" "$SEC_BEFORE" "$(sec_snapshot "$SCRATCH")"
T4="$(date -u +%s)"
verify_db "$SCRATCH"
read -r up_n up_d < <(uploads_digest "$MYSQL_IMAGE" < "$WORK/uploads.tar.gz")
check "uploads dosya sayısı" "$(jq -r '.uploads.files' "$MANIFEST")" "$up_n"
check "uploads özet listesi" "$(jq -r '.uploads.listSha256' "$MANIFEST")" "$up_d"
T5="$(date -u +%s)"
printf 'restore-sure: toplam %ss (çözme %ss, MySQL açılış %ss, yükleme %ss, doğrulama %ss)\n' \
  "$((T5 - T0))" "$((T2 - T1))" "$((T3 - T2))" "$((T4 - T3))" "$((T5 - T4))"
if [ "$TARGET" = scratch ]; then verdict; exit 0; fi

# --- 4. Staging: canlı yığına uygula ---------------------------------------------------------------------------------
[ "$FAILS" -eq 0 ] || { log "scratch doğrulaması FAIL — canlı yığına DOKUNULMADI"; verdict; }
HOST_SHORT="$(hostname -s 2>/dev/null || hostname)"
[ "$CONFIRM" = "$DB_NAME@$HOST_SHORT" ] || die "--target staging için --confirm $DB_NAME@$HOST_SHORT gerekli (canlı veritabanı SİLİNİP yeniden yüklenir; runbook §18.5)"
[ "$(id -u)" = 0 ] || die "--target staging root ile çalıştırılır"
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
charset="$(echo "SELECT CONCAT(DEFAULT_CHARACTER_SET_NAME, ' ', DEFAULT_COLLATION_NAME) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = DATABASE();" | sql_root "$LIVE")"
read -r cs coll <<<"$charset"
[[ "$cs" =~ ^[a-z0-9_]+$ && "$coll" =~ ^[a-z0-9_]+$ ]] || die "karakter seti okunamadı"
log "veritabanı yeniden oluşturuluyor ($DB_NAME, $cs/$coll) ve döküm yükleniyor"
# shellcheck disable=SC2016
printf 'DROP DATABASE `%s`; CREATE DATABASE `%s` CHARACTER SET %s COLLATE %s;\n' "$DB_NAME" "$DB_NAME" "$cs" "$coll" \
  | docker exec -i "$LIVE" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -NB --system-command=OFF'
SEC_LIVE_BEFORE="$(sec_snapshot "$LIVE")"
gzip -dc "$WORK/db.sql.gz" | fix_trigger_dump | sql_root "$LIVE" || die "döküm canlı MySQL'e yüklenemedi — server DURDURULMUŞ kaldı (runbook §19 'Veri bozuldu')"
log "uploads volume'u geri yükleniyor ($UPLOADS_VOL)"
docker run --rm -i --network none --cap-drop ALL --cap-add CHOWN --cap-add FOWNER --cap-add DAC_OVERRIDE \
  --security-opt no-new-privileges:true --user 0 -v "$UPLOADS_VOL:/u" --entrypoint bash "$MYSQL_IMAGE" \
  -c 'set -euo pipefail; find /u -mindepth 1 -delete; tar -C /u --same-owner -xzpf -' < "$WORK/uploads.tar.gz"
sec_check "hesap/yetki/rutin değişmedi (canlı)" "$SEC_LIVE_BEFORE" "$(sec_snapshot "$LIVE")"
verify_db "$LIVE"
read -r up_n up_d < <(volume_digest "$MYSQL_IMAGE" "$UPLOADS_VOL")
check "uploads dosya sayısı (volume)" "$(jq -r '.uploads.files' "$MANIFEST")" "$up_n"
check "uploads özet listesi (volume)" "$(jq -r '.uploads.listSha256' "$MANIFEST")" "$up_d"
[ "$FAILS" -eq 0 ] || { log "canlı doğrulama FAIL — server DURDURULMUŞ bırakıldı (runbook §19 'Veri bozuldu')"; verdict; }
log "yığın başlatılıyor (migrate önce)"
docker compose up -d
deadline=$(( $(date -u +%s) + READY_TIMEOUT ))
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q server)" 2>/dev/null)" = healthy ]; do
  [ "$(date -u +%s)" -lt "$deadline" ] || die "server ${READY_TIMEOUT} sn içinde healthy olmadı (docker compose logs server migrate)"
  sleep 2
done
ready="$(docker compose exec -T server node -e "fetch('http://127.0.0.1:3001/ready').then(async r=>console.log(r.status, await r.text()))")"
check "/ready" 200 "${ready%% *}"
T7="$(date -u +%s)"
printf 'restore-sure: staging kesintisi %ss (durdurma -> /ready 200), toplam %ss\n' "$((T7 - T6))" "$((T7 - T0))"
verdict
