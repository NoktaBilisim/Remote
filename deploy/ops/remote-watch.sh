#!/usr/bin/env bash
# remote-watch — prod izleme (mimari-p13 §7.8, AC önerisi §7.15-e; Prometheus yokken kritik alarm kuralları). Yeni bağımlılık
# yok: bash, docker, systemctl, curl, openssl, df, timeout. systemd timer'ı 10 dakikada bir root olarak çalıştırır.
#
# Kullanım (root):
#   remote-watch.sh install     kurulu kopya /usr/local/lib/remote/remote-watch.sh (root:root 0755; G-P13b-13: root birimi
#                               git ağacından çalıştırılmaz), /etc/remote-watch/ (0700) + watch.env (yoksa örnekten, 600),
#                               systemd remote-watch.service + .timer (enable --now). Betik değişince yeniden çalıştırılır.
#   remote-watch.sh uninstall   timer/service + kurulu kopyayı siler (watch.env ve /var/lib/remote-watch kalır).
#   remote-watch.sh [run]       bütün kontrolleri bir kez çalıştırır.
#   İkinci örnek (P13c, mimari-e11 §3.1; ör. staging `stg`): install|uninstall|run <örnek>. Örnek adı [a-z][a-z0-9]{0,15}.
#     Birimler remote-watch@.service/.timer (şablon; remote-watch@<örnek>.timer), yapılandırma /etc/remote-watch/<örnek>.env,
#     durum /var/lib/remote-watch/<örnek>/, journal etiketi remote-watch-<örnek>, alarm metni "remote-watch[<örnek>] ...".
#     Örnekte varsayılanlar: WATCH_PROJECT remote-<örnek>, WATCH_DEPLOY_DIR /opt/remote-<örnek>/deploy, WATCH_TREE_DIR
#     /opt/remote-<örnek>, WATCH_BACKUP_DIR /var/backups/remote-<örnek>, WATCH_BACKUP_STATUS
#     /var/lib/remote-backup-<örnek>/status.prom, WATCH_TIMERS remote-backup@<örnek>.timer, WATCH_TURN_CHECKS 0 (coturn
#     prod örneğinde izlenir); WATCH_PUBLIC_HOST ZORUNLU (prod adına düşmez).
# Yapılandırma: /etc/remote-watch/watch.env (root sahibi, tam 600/400, normal dosya; değilse ÇALIŞMAZ, çıkış 1). Dosya source
#   EDİLMEZ; yalnız WATCH_* anahtarları okunur, ortamdaki değer dosyadakini ezer (test/elle). Anahtarlar: watch.env.example.
# Çıktı (journal, SyslogIdentifier=remote-watch): `remote-watch: OK (<n> kontrol)` ya da her bozuk kontrol için
#   `remote-watch: ALERT check=<ad> <kısa ayrıntı>`. Kişisel veri ve sır yazılmaz.
# Alarm: WATCH_ALERT_CMD (sh -c) ilk ALERT'te / yeni bir kontrol bozulunca hemen, sonra en çok WATCH_REPEAT_MIN dakikada bir;
#   düzelen kontroller için bir kez "DUZELDI". Mesaj (yalnız kontrol adları) $REMOTE_WATCH_MSG ve stdin ile verilir.
#   G-P13b-7: komut metni `ps` ile görünür -> içinde sır OLMAZ. Telegram token'ı / x-api-key / Authorization içeren komut
#   çalıştırılmaz (check=alert-cmd-unsafe); sırrı curl -K <root 600 dosya> ile verin (watch.env.example).
# Durum: /var/lib/remote-watch/state (bozuk küme, son gönderim) ve status.prom (sır yok).
set -uo pipefail
umask 077
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
INSTALL_DIR=/usr/local/lib/remote
INSTALLED="$INSTALL_DIR/remote-watch.sh"
CONF_DIR=/etc/remote-watch
UNIT_DIR="${WATCH_TEST_UNIT_DIR:-/etc/systemd/system}"
TAG=remote-watch

WATCH_ENV_KEYS="WATCH_ALERT_CMD WATCH_REPEAT_MIN WATCH_DISK_MAX_PCT WATCH_CERT_MIN_DAYS WATCH_DEPLOY_DIR WATCH_PUBLIC_HOST
WATCH_SERVICES WATCH_PROJECT WATCH_TURN_CONTAINER WATCH_TURN_TLS WATCH_TURN_CERT_FILE WATCH_LE_DIR WATCH_BACKUP_STATUS
WATCH_BACKUP_DIR WATCH_DISK_PATHS WATCH_OFFSITE_REMIND_DAYS WATCH_TREE_DIR WATCH_TIMERS WATCH_TURN_CHECKS
WATCH_GUEST_PREFIX_MAX WATCH_MYSQL_FAIL_MAX WATCH_PURGE_CHECKS WATCH_PURGE_REPEAT_MIN WATCH_NOTIFY_CAPS WATCH_NOTIFY_FAIL_MIN
WATCH_NOTIFY_RL_MAX WATCH_AV_CHECKS WATCH_AV_STALE_DAYS WATCH_AV_FAIL_MIN WATCH_UA_SILENT_MAX WATCH_UA_TIMEOUT_MIN
WATCH_REC_ERR_MIN WATCH_REC_PART_BAD_MAX WATCH_REC_VIEW_THROTTLE_MAX
WATCH_MULTI_DENIED_MAX WATCH_PORTAL_LOGIN_FAIL_MAX WATCH_PORTAL_LOCKED_MAX WATCH_PORTAL_REQ_REJECT_MAX"

# P13c: isteğe bağlı örnek adı (2. argüman). Boş = prod (bugünkü adlar/yollar birebir).
INST="${2:-}"
if [ -n "$INST" ]; then
  [[ "$INST" =~ ^[a-z][a-z0-9]{0,15}$ ]] || { printf '%s: HATA: örnek adı geçersiz: %s\n' "$TAG" "$INST" >&2; exit 2; }
  TAG="remote-watch-$INST"
fi

ERRP=""; [ -n "${INVOCATION_ID:-}" ] && ERRP="<3>"
log() { printf '%s: %s\n' "$TAG" "$*"; }
err() { printf '%s%s: %s\n' "$ERRP" "$TAG" "$*" >&2; }
die() { err "HATA: $*"; exit 1; }

# watch.env: root kodudur (WATCH_ALERT_CMD root olarak çalışır). Normal dosya, sahibi uid 0, izni tam 600 ya da 400.
env_file_secure() {
  local f="$1" perm uid
  [ -f "$f" ] && [ ! -L "$f" ] || { err "HATA: $f normal dosya değil"; return 1; }
  read -r perm _ uid _ < <(ls -ln "$f")
  perm="${perm:0:10}"
  if [ "$uid" != 0 ] || { [ "$perm" != "-rw-------" ] && [ "$perm" != "-r--------" ]; }; then
    err "HATA: $f sahibi root ve izni 600 olmalı (bulunan: uid=$uid $perm). Düzeltme: chown root:root $f && chmod 600 $f"
    return 1
  fi
}
load_env_file() {
  local f="$1" line key val
  env_file_secure "$f" || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    key="${line%%=*}"; val="${line#*=}"
    case " ${WATCH_ENV_KEYS//$'\n'/ } " in *" $key "*) ;; *) continue ;; esac
    case "$val" in \"*\") val="${val#\"}"; val="${val%\"}" ;; \'*\') val="${val#\'}"; val="${val%\'}" ;; esac
    if [ -z "${!key+x}" ]; then printf -v "$key" '%s' "$val"; export "${key?}"; fi
  done <"$f"
}

do_install() {
  [ "$(id -u)" = 0 ] || die "root gerekli"
  [ "$SELF" != "$INSTALLED" ] || die "install repo kopyasından çalıştırılır (deploy/ops/remote-watch.sh install)"
  local src; src="$(dirname "$SELF")"
  if [ -n "$INST" ]; then do_install_inst "$src"; return $?; fi
  for f in remote-watch.service remote-watch.timer watch.env.example; do [ -f "$src/$f" ] || die "$src/$f yok"; done
  install -d -o root -g root -m 0755 "$INSTALL_DIR"
  install -o root -g root -m 0755 "$SELF" "$INSTALLED.tmp.$$" && mv -f "$INSTALLED.tmp.$$" "$INSTALLED"
  install -d -o root -g root -m 0700 "$CONF_DIR"
  if [ ! -e "$CONF_DIR/watch.env" ]; then
    install -o root -g root -m 0600 "$src/watch.env.example" "$CONF_DIR/watch.env"
    log "$CONF_DIR/watch.env örnekten oluşturuldu (600) — WATCH_ALERT_CMD'yi doldurun"
  fi
  install -o root -g root -m 0644 "$src/remote-watch.service" "$UNIT_DIR/remote-watch.service"
  install -o root -g root -m 0644 "$src/remote-watch.timer" "$UNIT_DIR/remote-watch.timer"
  systemctl daemon-reload && systemctl enable --now remote-watch.timer >/dev/null || die "systemctl enable başarısız"
  log "kuruldu: $INSTALLED (0755), $CONF_DIR/watch.env, remote-watch.service + .timer (10 dk). İlk koşu: systemctl start remote-watch.service"
}
# P13c ikinci örnek: şablon birimler + /etc/remote-watch/<örnek>.env. Kurulu kopya prod ile ortaktır (aynı betik).
do_install_inst() {
  local src="$1" f
  for f in remote-watch@.service remote-watch@.timer watch.env.example; do [ -f "$src/$f" ] || die "$src/$f yok"; done
  install -d -o root -g root -m 0755 "$INSTALL_DIR"
  install -o root -g root -m 0755 "$SELF" "$INSTALLED.tmp.$$" && mv -f "$INSTALLED.tmp.$$" "$INSTALLED"
  install -d -o root -g root -m 0700 "$CONF_DIR"
  if [ ! -e "$CONF_DIR/$INST.env" ]; then
    install -o root -g root -m 0600 "$src/watch.env.example" "$CONF_DIR/$INST.env"
    log "$CONF_DIR/$INST.env örnekten oluşturuldu (600) — WATCH_PUBLIC_HOST ve WATCH_ALERT_CMD'yi doldurun"
  fi
  install -o root -g root -m 0644 "$src/remote-watch@.service" "$UNIT_DIR/remote-watch@.service"
  install -o root -g root -m 0644 "$src/remote-watch@.timer" "$UNIT_DIR/remote-watch@.timer"
  systemctl daemon-reload && systemctl enable --now "remote-watch@$INST.timer" >/dev/null || die "systemctl enable başarısız"
  log "kuruldu: remote-watch@$INST.timer (10 dk), $CONF_DIR/$INST.env. İlk koşu: systemctl start remote-watch@$INST.service"
}
do_uninstall() {
  [ "$(id -u)" = 0 ] || die "root gerekli"
  if [ -n "$INST" ]; then
    systemctl disable --now "remote-watch@$INST.timer" >/dev/null 2>&1 || true
    log "remote-watch@$INST.timer kapatıldı (şablon birimler, kurulu kopya, $CONF_DIR/$INST.env korunur)"; return 0
  fi
  systemctl disable --now remote-watch.timer >/dev/null 2>&1 || true
  rm -f "$UNIT_DIR/remote-watch.service" "$UNIT_DIR/remote-watch.timer" "$INSTALLED"
  systemctl daemon-reload 2>/dev/null || true
  log "kaldırıldı ($CONF_DIR/watch.env ve /var/lib/remote-watch korunur; gerekirse elle silin)"
}

case "${1:-run}" in
  install) do_install; exit $? ;;
  uninstall) do_uninstall; exit $? ;;
  run) ;;
  *) sed -n '2,/^set -uo/p' "$0" | sed '$d' >&2; exit 2 ;;
esac

# --- run -------------------------------------------------------------------------------------------------------------
[ "$(id -u)" = 0 ] || die "root gerekli (docker, /etc/letsencrypt, watch.env)"
ENV_FILE="$CONF_DIR/watch.env"
# Test: yalnız repo kopyası başka yapılandırma/durum dizini kullanabilir; kurulu kopya sabit yolları kullanır.
BASE_STATE=/var/lib/remote-watch
if [ -n "$INST" ]; then ENV_FILE="$CONF_DIR/$INST.env"; BASE_STATE="$BASE_STATE/$INST"; fi
if [ "$SELF" != "$INSTALLED" ]; then ENV_FILE="${WATCH_ENV_FILE:-$ENV_FILE}"; STATE_DIR="${WATCH_STATE_DIR:-$BASE_STATE}"
else STATE_DIR="$BASE_STATE"; fi
if [ -e "$ENV_FILE" ] || [ -L "$ENV_FILE" ]; then load_env_file "$ENV_FILE" || exit 1
else err "UYARI: $ENV_FILE yok — varsayılanlarla, alarm komutu olmadan çalışılıyor (yalnız journal)"; fi

REPEAT_MIN="${WATCH_REPEAT_MIN:-360}"
DISK_MAX="${WATCH_DISK_MAX_PCT:-80}"
CERT_DAYS="${WATCH_CERT_MIN_DAYS:-14}"
# P13c: örnekte prod adlarına DÜŞÜLMEZ (S = "-<örnek>" son eki; prod'da boş -> bugünkü değerler).
S="${INST:+-$INST}"
# WATCH_DEPLOY_DIR (tasarım anahtarı) bilgi amaçlıdır: servis durumu compose dosyası çözülmeden etiketlerden okunur.
# shellcheck disable=SC2034
DEPLOY_DIR="${WATCH_DEPLOY_DIR:-/opt/remote$S/deploy}"
if [ -n "$INST" ]; then
  HOSTN="${WATCH_PUBLIC_HOST:-}"; [ -n "$HOSTN" ] || die "örnek $INST: WATCH_PUBLIC_HOST zorunlu ($ENV_FILE)"
else HOSTN="${WATCH_PUBLIC_HOST:-remote.noktabilisim.net}"; fi
PROJECT="${WATCH_PROJECT:-remote$S}"
SERVICES="${WATCH_SERVICES:-mysql server web caddy}"
TURN_C="${WATCH_TURN_CONTAINER:-remote-turn-coturn-1}"
TURN_TLS="${WATCH_TURN_TLS:-127.0.0.1:5349}"
TURN_CERT="${WATCH_TURN_CERT_FILE:-/etc/remote/turn-certs/turn.crt}"
LE_DIR="${WATCH_LE_DIR:-/etc/letsencrypt/live}"
BSTATUS="${WATCH_BACKUP_STATUS:-/var/lib/remote-backup$S/status.prom}"
BDIR="${WATCH_BACKUP_DIR:-/var/backups/remote$S}"
DISKS="${WATCH_DISK_PATHS:-/ /var/lib/docker $BDIR}"
REMIND_DAYS="${WATCH_OFFSITE_REMIND_DAYS:-7}"
# P14a A5 (AC-208/212; runbook §22): sayaç artış eşikleri. Pencere 15 dk / 1 sa (timer 10 dk -> en az pencere kadar).
GP_MAX="${WATCH_GUEST_PREFIX_MAX:-20}"
MF_MAX="${WATCH_MYSQL_FAIL_MAX:-10}"
# P16 (mimari-e11 §7.7, S16-12; runbook §23.4): kalıcı silme alarmları. PURGE_REPEAT = SCHEDULED iş sürdükçe alarmın
# yeniden gönderim aralığı (dk; 0 = her 10 dk'lık turda). PURGE_CHECKS=0 yalnız P16 öncesi server için.
PURGE_CHECKS="${WATCH_PURGE_CHECKS:-1}"
PURGE_REPEAT="${WATCH_PURGE_REPEAT_MIN:-0}"
TREE="${WATCH_TREE_DIR-/opt/remote$S}"
# P19 (mimari-e11 §8c.3, S-P19-12/T6; runbook §26.2): müşteri bildirimi kuyruğu. NOTIFY_CAPS = firma × kanal saatlik tavanı
# (contracts NOTIFY_LIMITS ile AYNI tutulur; hacim alarmı tavanın %80'i). FAIL_MIN = 15 dk'da FAILED oranı alarmının en az
# FAILED sayısı (tek başarısızlık %100 sayılıp gece alarmı üretmesin; 1 = tasarımın yalın kuralı). RL_MAX = 15 dk'da
# rs_notify_rate_limited_total artış eşiği.
NOTIFY_CAPS="${WATCH_NOTIFY_CAPS:-SMS:100 WHATSAPP:60 EMAIL:100}"
NF_MIN="${WATCH_NOTIFY_FAIL_MIN:-3}"
NRL_MAX="${WATCH_NOTIFY_RL_MAX:-20}"
# P28b (mimari-p28b §7.3, §11.2; AC-359/361; runbook §28b.4): ClamAV. AV_CHECKS: 1 = server P28b metriklerini yayımlıyorsa ya da
# clamav konteyneri varsa ZORUNLU (konteyner yoksa alarm; prod varsayılanı), auto = yalnız clamav konteyneri varsa (ikinci örnek
# varsayılanı: staging'de `av` profili kapalıyken alarm üretmez), 0 = kapalı. STALE_DAYS = imza yaşı eşiği (AV_STALE_DAYS = 3).
# FAIL_MIN = 1 sa'te taranamadı oranı > %20 alarmı için en az başarısız tarama sayısı (tek hata gece alarmı olmasın).
AV_STALE="${WATCH_AV_STALE_DAYS:-3}"
AV_FMIN="${WATCH_AV_FAIL_MIN:-5}"
# P28u (mimari-p28u §9.4; runbook §28u.6): SILENT_MAX = 1 sa'te izinsiz (silent) başarılı bağlantı artışı bu sayıyı AŞARSA uyarı
# (R-PU2); TIMEOUT_MIN = 24 sa'te onay diyaloğu "yanıt yok" oranı > %50 bilgisi için en az zaman aşımı sayısı.
UA_SMAX="${WATCH_UA_SILENT_MAX:-5}"
UA_TMIN="${WATCH_UA_TIMEOUT_MIN:-3}"
# P28e (mimari-p28e §11.3; runbook §28e.6): ERR_MIN = 1 sa'te error ile duran kayıt oranı > %20 alarmı için en az error sayısı (tek
# hata gece alarmı olmasın); PART_BAD_MAX = 10 dk'da reddedilen parça (invalid|rate|busy) artışı bunu AŞARSA; VIEW_THROTTLE_MAX =
# 1 sa'te izleme kovası (429) artışı bunu AŞARSA uyarı.
REC_EMIN="${WATCH_REC_ERR_MIN:-3}"
REC_BMAX="${WATCH_REC_PART_BAD_MAX:-10}"
REC_VMAX="${WATCH_REC_VIEW_THROTTLE_MAX:-50}"
# P28c (mimari-p28c §4.4/§8; runbook §28c.6): 1 sa'te rol kapısı reddi (rs_multi_denied_total, bütün type) artışı bunu AŞARSA uyarı.
# Konsol yetkisiz mesajı arayüzde zaten göndermez -> ret = rol yükseltme denemesi (T3) ya da istemci/sunucu sürüm hatası.
MD_MAX="${WATCH_MULTI_DENIED_MAX:-20}"
# P21 (mimari-p21 §9, §5.4 P1/P12, r2 S-P21-4; runbook §29.5): müşteri portalı. LOGIN_FAIL_MAX = 10 dk'da
# rs_portal_login_total{result="fail"} artışı >= bu sayı (mimari: "10 dk'da fail >= 200", dağıtık doldurma); LOCKED_MAX = 1 sa'te
# rs_portal_locked_total artışı bunu AŞARSA; REQ_REJECT_MAX = 1 sa'te rs_portal_requests_total{result="rate_limited"|"queue_full"}
# artışı bunu AŞARSA (son ikisi devops varsayılanı; mimaride sayı yok).
PL_FMAX="${WATCH_PORTAL_LOGIN_FAIL_MAX:-200}"
PL_LMAX="${WATCH_PORTAL_LOCKED_MAX:-10}"
PR_RMAX="${WATCH_PORTAL_REQ_REJECT_MAX:-20}"
for x in $NOTIFY_CAPS; do [[ "$x" =~ ^[A-Z_]{1,16}:[1-9][0-9]{0,5}$ ]] || die "WATCH_NOTIFY_CAPS biçimi KANAL:sayı (bulunan: $x)"; done
if [ -n "$INST" ]; then TIMERS="${WATCH_TIMERS:-remote-backup@$INST.timer}"; TURN_CHECKS="${WATCH_TURN_CHECKS:-0}"; AV_CHECKS="${WATCH_AV_CHECKS:-auto}"
else TIMERS="${WATCH_TIMERS:-remote-turn-fw.timer remote-backup.timer}"; TURN_CHECKS="${WATCH_TURN_CHECKS:-1}"; AV_CHECKS="${WATCH_AV_CHECKS:-1}"; fi
case "$AV_CHECKS" in 0|1|auto) ;; *) die "WATCH_AV_CHECKS 0, 1 ya da auto olmalı" ;; esac
case "$TURN_CHECKS" in 0|1) ;; *) die "WATCH_TURN_CHECKS 0 ya da 1 olmalı" ;; esac
case "$PURGE_CHECKS" in 0|1) ;; *) die "WATCH_PURGE_CHECKS 0 ya da 1 olmalı" ;; esac
for v in REPEAT_MIN DISK_MAX CERT_DAYS REMIND_DAYS GP_MAX MF_MAX PURGE_REPEAT NF_MIN NRL_MAX AV_STALE AV_FMIN UA_SMAX UA_TMIN REC_EMIN REC_BMAX REC_VMAX MD_MAX PL_FMAX PL_LMAX PR_RMAX; do
  case "${!v}" in ''|*[!0-9]*) die "WATCH_${v} sayı olmalı (bulunan: ${!v})" ;; esac
done
for c in docker systemctl curl openssl df timeout awk; do command -v "$c" >/dev/null 2>&1 || die "'$c' bulunamadı"; done
install -d -m 0755 "$STATE_DIR" 2>/dev/null || die "$STATE_DIR oluşturulamadı"
NOW="$(date +%s)"
DAY=86400

FAILS=()      # "ad|ayrıntı"
CHECKS=()     # bütün kontrol adları (status.prom)
fail() { FAILS+=("$1|$2"); }
seen() { CHECKS+=("$1"); }

# --- kontroller -------------------------------------------------------------------------------------------------------
# compose `remote` servisleri: running ve (healthcheck varsa) healthy. compose dosyası çözülmez (sır/.env gerekmez):
# Docker'ın compose etiketleri okunur.
ps_out="$(timeout 20 docker ps -a --filter "label=com.docker.compose.project=$PROJECT" \
  --format '{{.Label "com.docker.compose.service"}}|{{.State}}|{{.Status}}|{{.Names}}' 2>/dev/null)" || ps_out=""
svc_name() { awk -F'|' -v s="$1" '$1 == s && $2 == "running" {print $4; exit}' <<<"$ps_out"; }
svc_check() {
  local s="$1" line st status
  seen "compose:$s"
  line="$(awk -F'|' -v s="$s" '$1 == s {print; exit}' <<<"$ps_out")"
  if [ -z "$line" ]; then fail "compose:$s" "konteyner yok"; return; fi
  IFS='|' read -r _ st status _ <<<"$line"
  if [ "$st" != running ]; then fail "compose:$s" "durum=$st"
  elif [[ "$status" == *"(unhealthy)"* || "$status" == *"health: starting"* ]]; then fail "compose:$s" "sağlık=${status##*(}"; fi
}
for s in $SERVICES; do svc_check "$s"; done

SERVER_C="$(svc_name server)"
seen ready
if [ -z "$SERVER_C" ]; then fail ready "server çalışmıyor"
elif ! timeout 20 docker exec "$SERVER_C" node -e \
  "fetch('http://127.0.0.1:3001/ready').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
  fail ready "/ready 200 değil"
fi

seen nginx-login
code="$(curl -sS -o /dev/null -w '%{http_code}' -m 15 --resolve "$HOSTN:443:127.0.0.1" "https://$HOSTN/login" 2>/dev/null)" || true
[ "$code" = 200 ] || fail nginx-login "https://$HOSTN/login (nginx yolu) -> ${code:-bağlantı yok}"

if [ "$TURN_CHECKS" = 1 ]; then
seen coturn
th="$(timeout 10 docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$TURN_C" 2>/dev/null)" || th=""
if [ "$th" != healthy ]; then fail coturn "sağlık=${th:-konteyner yok}"
elif ! timeout 15 docker exec "$TURN_C" turnutils_stunclient -p 3478 127.0.0.1 >/dev/null 2>&1; then fail coturn "STUN 127.0.0.1:3478 yanıt yok"; fi
fi

for t in $TIMERS; do
  seen "timer:$t"
  systemctl is-active --quiet "$t" 2>/dev/null || fail "timer:$t" "etkin değil"
done

# Yedek durum dosyası (backup.sh yazar; mimari-p13 §7.6/5). Değerler sayı değilse dosya bozuk sayılır.
prom() { awk -v k="$1" '$1 == k {v = $2} END {if (v != "") print v}' "$BSTATUS" 2>/dev/null | sed 's/\..*//'; }
age_ok() { case "$1" in ''|*[!0-9]*) return 1 ;; esac; [ $((NOW - $1)) -lt $((26 * 3600)) ]; }
seen backup-age; seen audit-continuity; seen offsite
if [ ! -f "$BSTATUS" ]; then
  fail backup-age "$BSTATUS yok (yedek hiç çalışmadı mı?)"
else
  ls_="$(prom remote_backup_last_success_timestamp_seconds)"
  age_ok "$ls_" || fail backup-age "son başarılı yedek 26 saatten eski (${ls_:-yok})"
  [ "$(prom remote_backup_audit_continuity_ok)" = 1 ] || fail audit-continuity "remote_backup_audit_continuity_ok != 1"
  # P16 (S16-13): yedekteki imha defteri eklenebilirlik denetimi. Metrik yoksa (P16 öncesi backup.sh) değerlendirilmez.
  lo_="$(prom remote_backup_ledger_ok)"
  if [ -n "$lo_" ]; then seen ledger-backup; [ "$lo_" = 1 ] || fail ledger-backup "remote_backup_ledger_ok != 1 (defter kısaldı/değişti/yok; runbook §23.6)"; fi
  if [ "$(prom remote_backup_offsite_configured)" = 1 ]; then
    os_="$(prom remote_backup_offsite_last_success_timestamp_seconds)"
    age_ok "$os_" || fail offsite "site dışı kopya 26 saatten eski (rc=$(prom remote_backup_offsite_last_rc))"
  fi
fi

# Saklama işi (runbook §18.6 mantığı): metrik + süreç yaşı; hata sayacı son 24 saatte arttıysa alarm.
seen retention
RET_FC=""; R_GP=""; R_MF=""; P_SCH=""; P_FAIL=""; P_RUN=""; P_HB=""; O_LAST=""; O_CIRC=""; L_FAIL=""; st_epoch="$NOW"
D_FAIL=""; C_FB=""; M_TEN=""; M_ALL=""; NO_TOT=""; NO_FAIL=""; NO_OLD=""; NO_RL=""; SK_UNR=""; NO_VOL=""
AV_UP=""; AV_ST=""; AV_AGE=""; AV_TOT=""; AV_FAIL=""; UA_NT=""; UA_NF=""; UA_SOK=""; UA_CT=""; UA_CTO=""
REC_PT=""; REC_PB=""; REC_ST=""; REC_SE=""; REC_VT=""; MD_TOT=""; PL_TOT=""; PL_FAIL=""; PL_LOCK=""; PR_REJ=""
if [ -n "$SERVER_C" ]; then
  # 12.-15. alan (P18 H5; mimari-e11 §8b.13 T2/T4/T12): rs_crypto_decrypt_failures_total (bütün table), rs_calendar_fallback_total
  # (bütün tenant), rs_request_messages_rejected_total{reason~"tenant"} (firma müşteri mesajı kovası, queue.alert),
  # rs_request_messages_total (P18 server işareti).
  # 16.-21. alan (P19 J6; mimari-e11 §8c.3/§8c.7): rs_notify_outbox_total (bütün seriler; P19 işareti — etiketsiz sayaç da
  # "… 0" yazılır), rs_notify_outbox_total{result~"fail"}, rs_notify_outbox_oldest_pending_seconds (en büyük),
  # rs_notify_rate_limited_total (bütün scope/channel), rs_sms_key_unreadable_total, rs_notify_tenant_max_hourly kanal=değer
  # listesi (etiket adı channel ya da role — Metrics.gauge kayıtları {role=…} yazar; kanal adı [A-Za-z0-9_] dışı "_").
  # 3./4. alan (P14a A5): rs_guest_code_rate_limited_total{scope="prefix"} ve rs_mysql_test_failed_total (tüm class) toplamı;
  # seri yoksa "-" (metrik henüz yayında değil -> değerlendirilmez).
  rt="$(timeout 20 docker exec "$SERVER_C" node -e "const sum=(t,re)=>{let n=0,k=0;for(const x of t.matchAll(re)){n+=Number(x[1]);k++}return k?String(n):'-'};const mx=(t,re)=>{let n=null;for(const x of t.matchAll(re)){const v=Number(x[1]);if(n===null||v>n)n=v}return n===null?'-':String(n)};fetch('http://127.0.0.1:3001/metrics',{headers:{authorization:'Bearer '+(process.env.METRICS_TOKEN||'')}}).then(r=>r.text()).then(t=>{const m=t.match(/^rs_retention_last_success_timestamp_seconds (\S+)/m);const f=t.match(/^rs_retention_failures_total (\S+)/m);console.log([m?m[1]:'yok',sum(t,/^rs_retention_failures_total(?:\{[^}]*\})? (\S+)/gm).replace('-','0'),sum(t,/^rs_guest_code_rate_limited_total\{[^}]*scope=\"prefix\"[^}]*\} (\S+)/gm),sum(t,/^rs_mysql_test_failed_total(?:\{[^}]*\})? (\S+)/gm),sum(t,/^rs_tenant_purge_jobs\{[^}]*=\"SCHEDULED\"[^}]*\} (\S+)/gm),sum(t,/^rs_tenant_purge_jobs\{[^}]*=\"FAILED\"[^}]*\} (\S+)/gm),sum(t,/^rs_tenant_purge_jobs\{[^}]*=\"RUNNING\"[^}]*\} (\S+)/gm),sum(t,/^rs_tenant_purge_last_heartbeat_seconds(?:\{[^}]*\})? (\S+)/gm),sum(t,/^rs_orphan_scan_last_success_timestamp_seconds(?:\{[^}]*\})? (\S+)/gm),sum(t,/^(?:rs_orphan_scan_circuit_open_total(?:\{[^}]*\})?|rs_orphan_files_total\{[^}]*action=\"circuit_open\"[^}]*\}) (\S+)/gm),sum(t,/^rs_erasure_ledger_write_failed_total(?:\{[^}]*\})? (\S+)/gm),sum(t,/^rs_crypto_decrypt_failures_total(?:\{[^}]*\})? (\S+)/gm),sum(t,/^rs_calendar_fallback_total(?:\{[^}]*\})? (\S+)/gm),sum(t,/^rs_request_messages_rejected_total\{[^}]*reason=\"[^\"]*tenant[^\"]*\"[^}]*\} (\S+)/gm),sum(t,/^rs_request_messages_total(?:\{[^}]*\})? (\S+)/gm),sum(t,/^rs_notify_outbox_total(?:\{[^}]*\})? (\S+)/gm),sum(t,/^rs_notify_outbox_total\{[^}]*result=\"fail(?:ed)?\"[^}]*\} (\S+)/gmi),mx(t,/^rs_notify_outbox_oldest_pending_seconds(?:\{[^}]*\})? (\S+)/gm),sum(t,/^rs_notify_rate_limited_total(?:\{[^}]*\})? (\S+)/gm),sum(t,/^rs_sms_key_unreadable_total(?:\{[^}]*\})? (\S+)/gm),[...t.matchAll(/^rs_notify_tenant_max_hourly\{(?:[^}]*,)?(?:channel|role)=\"([^\"]*)\"[^}]*\} (\S+)/gm)].map(x=>x[1].replace(/\W/g,'_')+'='+x[2]).join(',')||'-',sum(t,/^rs_av_up(?:\{[^}]*\})? (\S+)/gm),sum(t,/^rs_av_selftest_ok(?:\{[^}]*\})? (\S+)/gm),mx(t,/^rs_av_signature_age_seconds(?:\{[^}]*\})? (\S+)/gm),sum(t,/^rs_av_scan_total(?:\{[^}]*\})? (\S+)/gm),sum(t,/^rs_av_scan_total\{[^}]*result=\"failed_[^\"]*\"[^}]*\} (\S+)/gm),sum(t,/^rs_unattended_silent_notify_total(?:\{[^}]*\})? (\S+)/gm),sum(t,/^rs_unattended_silent_notify_total\{[^}]*result=\"fail\"[^}]*\} (\S+)/gm),sum(t,/^rs_unattended_connect_total\{(?=[^}]*mode=\"silent\")(?=[^}]*result=\"ok\")[^}]*\} (\S+)/gm),sum(t,/^rs_unattended_consent_total(?:\{[^}]*\})? (\S+)/gm),sum(t,/^rs_unattended_consent_total\{[^}]*decision=\"timeout\"[^}]*\} (\S+)/gm),sum(t,/^rs_rec_part_total(?:\{[^}]*\})? (\S+)/gm),sum(t,/^rs_rec_part_total\{[^}]*result=\"(?:invalid|rate|busy)\"[^}]*\} (\S+)/gm),sum(t,/^rs_rec_stop_total(?:\{[^}]*\})? (\S+)/gm),sum(t,/^rs_rec_stop_total\{[^}]*reason=\"error\"[^}]*\} (\S+)/gm),sum(t,/^rs_rec_view_throttled_total(?:\{[^}]*\})? (\S+)/gm),sum(t,/^rs_multi_denied_total(?:\{[^}]*\})? (\S+)/gm),sum(t,/^rs_portal_login_total(?:\{[^}]*\})? (\S+)/gm),sum(t,/^rs_portal_login_total\{[^}]*result=\"fail\"[^}]*\} (\S+)/gm),sum(t,/^rs_portal_locked_total(?:\{[^}]*\})? (\S+)/gm),sum(t,/^rs_portal_requests_total\{[^}]*result=\"(?:rate_limited|queue_full)\"[^}]*\} (\S+)/gm)].join(' '))}).catch(()=>console.log('yok 0'))" 2>/dev/null)" || rt="yok 0"
  started="$(docker inspect -f '{{.State.StartedAt}}' "$SERVER_C" 2>/dev/null)"
  st_epoch="$(date -d "$started" +%s 2>/dev/null || echo "$NOW")"
  read -r r_last r_fail R_GP R_MF P_SCH P_FAIL P_RUN P_HB O_LAST O_CIRC L_FAIL D_FAIL C_FB M_TEN M_ALL NO_TOT NO_FAIL NO_OLD NO_RL SK_UNR NO_VOL \
    AV_UP AV_ST AV_AGE AV_TOT AV_FAIL UA_NT UA_NF UA_SOK UA_CT UA_CTO REC_PT REC_PB REC_ST REC_SE REC_VT MD_TOT PL_TOT PL_FAIL PL_LOCK PR_REJ _ <<<"$rt"
  r_last="${r_last%.*}"; r_fail="${r_fail%.*}"
  # S14-2: konteyner çıktısı güvenilmez; $(( )) bash aritmetiği `a[$(komut)]` ile komut çalıştırır -> yalnız ^[0-9]+$ girer.
  [[ "$st_epoch" =~ ^[0-9]+$ ]] || { err "UYARI: server başlangıç zamanı geçersiz; şimdi varsayıldı"; st_epoch="$NOW"; }
  if [[ -n "$r_fail" && ! "$r_fail" =~ ^[0-9]+$ ]]; then err "UYARI: rs_retention_failures_total geçersiz; yok sayıldı"; r_fail=""; fi
  if [ "$r_last" = yok ] || [ -z "$r_last" ]; then fail retention "rs_retention metriği yok (METRICS_TOKEN?)"
  elif ! [[ "$r_last" =~ ^[0-9]+$ ]]; then err "UYARI: rs_retention_last_success_timestamp_seconds geçersiz"; fail retention "rs_retention metrik değeri geçersiz"
  elif [ $((NOW - st_epoch)) -ge 93600 ] && [ $((NOW - r_last)) -ge 93600 ]; then fail retention "26 saattir başarılı saklama turu yok"; fi
  RET_FC="$r_fail"
fi
num() { [[ "${1%.*}" =~ ^[0-9]+$ ]] && echo "${1%.*}"; }

# P16 kalıcı silme (mimari-e11 §7.3/§7.6/§7.7, ADR-0030 m.5/m.9; runbook §23.4). Değerler yalnız ^[0-9]+ ise kullanılır (S14-2).
# Metrik sözleşmesi: rs_tenant_purge_jobs{state|role="<DURUM>"} gösterge; rs_tenant_purge_last_heartbeat_seconds (epoch ya
# da yaş sn; > 1e9 epoch sayılır); rs_orphan_scan_last_success_timestamp_seconds; rs_orphan_scan_circuit_open_total ya da
# rs_orphan_files_total{action="circuit_open"}; rs_erasure_ledger_write_failed_total. "-" = seri yok.
up_s=$((NOW - st_epoch))
if [ -n "$SERVER_C" ] && [ "$PURGE_CHECKS" = 1 ] && [[ "${r_last:-yok}" != yok ]]; then
  seen p16-metrics; seen purge-scheduled; seen purge-failed; seen purge-heartbeat; seen orphan-scan; seen orphan-circuit; seen ledger-write
  P_SCH="$(num "${P_SCH:--}")"; P_FAIL="$(num "${P_FAIL:--}")"; P_RUN="$(num "${P_RUN:--}")"; P_HB="$(num "${P_HB:--}")"
  O_LAST="$(num "${O_LAST:--}")"; O_CIRC="$(num "${O_CIRC:--}")"; L_FAIL="$(num "${L_FAIL:--}")"
  miss=""; [ -n "$P_SCH" ] || miss="rs_tenant_purge_jobs"; [ -n "$L_FAIL" ] || miss="${miss:+$miss,}rs_erasure_ledger_write_failed_total"
  [ -z "$miss" ] || fail p16-metrics "metrik yok: $miss (P16 server mı? değilse WATCH_PURGE_CHECKS=0)"
  [ "${P_SCH:-0}" -eq 0 ] || fail purge-scheduled "$P_SCH firma silme işi SCHEDULED (24 sa iptal penceresi; beklenmiyorsa panelden İptal et)"
  [ "${P_FAIL:-0}" -eq 0 ] || fail purge-failed "$P_FAIL firma silme işi FAILED (invalid_job/db_*/fs; runbook §23.3)"
  if [ "${P_RUN:-0}" -gt 0 ]; then
    if [ -z "$P_HB" ]; then fail purge-heartbeat "RUNNING iş var, heartbeat metriği yok"
    else hb_age="$P_HB"; [ "$P_HB" -lt 1000000000 ] || hb_age=$((NOW - P_HB))
      [ "$hb_age" -le 1800 ] || fail purge-heartbeat "RUNNING iş heartbeat ${hb_age} sn (> 30 dk)"; fi
  fi
  if [ "$up_s" -ge $((8 * DAY)) ] && { [ -z "$O_LAST" ] || [ $((NOW - O_LAST)) -ge $((8 * DAY)) ]; }; then
    fail orphan-scan "8 gündür başarılı yetim dosya taraması yok"
  fi
fi

# P18 (mimari-e11 §8b.13; runbook §25.4). rs_request_messages_total yoksa server P18 öncesidir -> değerlendirilmez. Varsa
# şifre çözme ve takvim sayaçları ZORUNLU (yoksa p18-metrics; fail-closed). Kova reddi serisi ilk artışa kadar yoktur -> 0.
P18=0
if [ -n "$SERVER_C" ] && [[ "${r_last:-yok}" != yok ]] && [ -n "$(num "${M_ALL:--}")" ]; then
  P18=1; seen p18-metrics; seen crypto-decrypt; seen calendar-fallback; seen msg-tenant-rate
  D_FAIL="$(num "${D_FAIL:--}")"; C_FB="$(num "${C_FB:--}")"; M_TEN="$(num "${M_TEN:--}")"; M_TEN="${M_TEN:-0}"
  miss=""; [ -n "$D_FAIL" ] || miss="rs_crypto_decrypt_failures_total"; [ -n "$C_FB" ] || miss="${miss:+$miss,}rs_calendar_fallback_total"
  [ -z "$miss" ] || fail p18-metrics "metrik yok: $miss (P18 server sözleşmesi; runbook §25.4)"
fi

# P19 (mimari-e11 §8c.3/§8c.7, S-P19-12/T6; runbook §26.2). rs_notify_outbox_total yoksa server P19 öncesidir -> değerlendirilmez.
# Varsa en eski PENDING göstergesi ve anahtar okunamadı sayacı ZORUNLU (yoksa p19-metrics; fail-closed). Etiketli seriler
# (FAILED, rate_limited, hacim göstergesi) ilk değere kadar yoktur -> 0.
P19=0; VOL_HI=""
cap_of() { local x; for x in $NOTIFY_CAPS; do [ "${x%%:*}" = "$1" ] && { echo "${x#*:}"; return; }; done; }
if [ -n "$SERVER_C" ] && [[ "${r_last:-yok}" != yok ]] && [ -n "$(num "${NO_TOT:--}")" ]; then
  P19=1; seen p19-metrics; seen notify-outbox-pending; seen notify-outbox-failed; seen notify-volume; seen sms-key-unreadable
  NO_TOT="$(num "$NO_TOT")"; NO_FAIL="$(num "${NO_FAIL:--}")"; NO_FAIL="${NO_FAIL:-0}"; NO_RL="$(num "${NO_RL:--}")"; NO_RL="${NO_RL:-0}"
  NO_OLD="$(num "${NO_OLD:--}")"; SK_UNR="$(num "${SK_UNR:--}")"
  miss=""; [ -n "$NO_OLD" ] || miss="rs_notify_outbox_oldest_pending_seconds"; [ -n "$SK_UNR" ] || miss="${miss:+$miss,}rs_sms_key_unreadable_total"
  [ -z "$miss" ] || fail p19-metrics "metrik yok: $miss (P19 server sözleşmesi; runbook §26.2)"
  [ -z "$NO_OLD" ] || [ "$NO_OLD" -le 60 ] || fail notify-outbox-pending "en eski PENDING bildirim ${NO_OLD} sn (> 60; kanal servisi ulaşılamıyor ya da işçi durdu; runbook §26.2)"
  # Hacim: herhangi bir kanalda firma başı en yüksek saatlik sayı >= tavanın %80'i (yukarı yuvarlanır: SMS 80, WA 48, EMAIL 80).
  IFS=, read -ra vpairs <<<"${NO_VOL:--}"
  for x in "${vpairs[@]+"${vpairs[@]}"}"; do
    ch="${x%%=*}"; v="$(num "${x#*=}")"
    [[ "$ch" =~ ^[A-Za-z0-9_]{1,16}$ ]] && [ -n "$v" ] || continue
    ch="${ch^^}"; c="$(cap_of "$ch")"
    [ -n "$c" ] || { err "UYARI: rs_notify_tenant_max_hourly bilinmeyen kanal $ch (WATCH_NOTIFY_CAPS)"; continue; }
    [ "$v" -lt $(((c * 80 + 99) / 100)) ] || VOL_HI="${VOL_HI:+$VOL_HI,}$ch=$v/$c"
  done
fi

# P28b ClamAV (mimari-p28b §7.3/§11.2; runbook §28b.4). 22.-26. alan: rs_av_up, rs_av_selftest_ok, rs_av_signature_age_seconds
# (en büyük), rs_av_scan_total (toplam), rs_av_scan_total{result="failed_*"}. "-" = seri yok. Değerler yalnız ^[0-9]+ (S14-2).
AV_ON=0
AV_UP="$(num "${AV_UP:--}")"; AV_ST="$(num "${AV_ST:--}")"; AV_AGE="$(num "${AV_AGE:--}")"; AV_TOT="$(num "${AV_TOT:--}")"; AV_FAIL="$(num "${AV_FAIL:--}")"
av_ctr="$(awk -F'|' '$1 == "clamav" || $1 == "clamav-update" {print; exit}' <<<"$ps_out")"
case "$AV_CHECKS" in
  1) { [ -n "$AV_UP" ] || [ -n "$av_ctr" ]; } && AV_ON=1 ;;
  auto) [ -n "$av_ctr" ] && AV_ON=1 ;;
esac
if [ "$AV_ON" = 1 ]; then
  svc_check clamav; svc_check clamav-update
  if [ -n "$SERVER_C" ]; then
    seen av-metrics; seen av-up; seen av-selftest; seen av-signature-age; seen av-scan-failed
    [ -n "$AV_UP" ] && [ -n "$AV_ST" ] || fail av-metrics "metrik yok: rs_av_up / rs_av_selftest_ok (P28b server mı? METRICS_TOKEN?)"
    # Tek yoklama imza yeniden yüklemesine (~8 sn) denk gelebilir -> rs_av_up=0 ardışık 2 turda alarm (K0, §7.3).
    [ "${AV_ST:-1}" -ge 1 ] || fail av-selftest "rs_av_selftest_ok=0: clamd EICAR/şifreli zip'i yanlış yanıtladı -> yeni taramalar TARANAMADI (yanlış yapılandırma; runbook §28b.5)"
    [ -z "$AV_AGE" ] || [ "$AV_AGE" -le $((AV_STALE * DAY)) ] || fail av-signature-age "imza yaşı $((AV_AGE / 3600)) sa > $AV_STALE gün (freshclam / av_egress; runbook §28b.5)"
  fi
fi

# P28u gözetimsiz izinli/izinsiz (mimari-p28u §9.4; runbook §28u.6). 27.-31. alan: rs_unattended_silent_notify_total (bütün
# seriler; P28u server işareti — etiketsiz sayaç ilk artışa kadar "… 0" yazılır), {result="fail"}, rs_unattended_connect_total
# {mode="silent",result="ok"} (etiket sırasından bağımsız), rs_unattended_consent_total (bütün), {decision="timeout"}. İşaret yoksa
# server P28u öncesidir -> değerlendirilmez; varsa etiketli seriler ilk artışa kadar yoktur -> 0. Yalnız ^[0-9]+ (S14-2).
UA=0
UA_NT="$(num "${UA_NT:--}")"
if [ -n "$SERVER_C" ] && [[ "${r_last:-yok}" != yok ]] && [ -n "$UA_NT" ]; then
  UA=1; seen unattended-notify-fail; seen unattended-silent-volume; seen unattended-consent-timeout
  UA_NF="$(num "${UA_NF:--}")"; UA_NF="${UA_NF:-0}"; UA_SOK="$(num "${UA_SOK:--}")"; UA_SOK="${UA_SOK:-0}"
  UA_CT="$(num "${UA_CT:--}")"; UA_CT="${UA_CT:-0}"; UA_CTO="$(num "${UA_CTO:--}")"; UA_CTO="${UA_CTO:-0}"
fi

# P28e oturum kaydı (mimari-p28e §11.2/§11.3; runbook §28e.6). 32.-36. alan: rs_rec_part_total (bütün seriler; P28e server işareti —
# etiketsiz sayaç ilk artışa kadar "… 0"), {result=~"invalid|rate|busy"}, rs_rec_stop_total (bütün), {reason="error"} (gözcü
# no_upload dahil — neden etiketi yok, alt kod audit recording.stop.cause'da), rs_rec_view_throttled_total. rs_rec_part_bytes
# (histogram) ayrı addır, toplanmaz. İşaret yoksa server P28e öncesidir -> değerlendirilmez. Yalnız ^[0-9]+ (S14-2).
REC=0
REC_PT="$(num "${REC_PT:--}")"
if [ -n "$SERVER_C" ] && [[ "${r_last:-yok}" != yok ]] && [ -n "$REC_PT" ]; then
  REC=1; seen rec-stop-error; seen rec-part-rejected; seen rec-view-throttled
  REC_PB="$(num "${REC_PB:--}")"; REC_PB="${REC_PB:-0}"; REC_ST="$(num "${REC_ST:--}")"; REC_ST="${REC_ST:-0}"
  REC_SE="$(num "${REC_SE:--}")"; REC_SE="${REC_SE:-0}"; REC_VT="$(num "${REC_VT:--}")"; REC_VT="${REC_VT:-0}"
fi

# P28c çoklu teknisyen (mimari-p28c §8; runbook §28c.6). 37. alan: rs_multi_denied_total (bütün type; etiketsiz sayaç ilk reddedilen
# mesaja kadar "… 0" -> P28c server işareti). İşaret yoksa server P28c öncesidir -> değerlendirilmez. Yalnız ^[0-9]+ (S14-2).
MD=0
MD_TOT="$(num "${MD_TOT:--}")"
if [ -n "$SERVER_C" ] && [[ "${r_last:-yok}" != yok ]] && [ -n "$MD_TOT" ]; then MD=1; seen multi-denied; fi

# P21 müşteri portalı (mimari-p21 §9; runbook §29.5). 38.-41. alan: rs_portal_login_total (bütün seriler; P21 server işareti —
# etiketsiz sayaç ilk girişe kadar "… 0"), {result="fail"}, rs_portal_locked_total (bütün), rs_portal_requests_total
# {result="rate_limited"|"queue_full"}. İşaret yoksa server P21 öncesidir -> değerlendirilmez; etiketli seriler ilk artışa kadar
# yoktur -> 0. rs_portal_sessions_active (gösterge) toplanmaz. Yalnız ^[0-9]+ (S14-2).
PT=0
PL_TOT="$(num "${PL_TOT:--}")"
if [ -n "$SERVER_C" ] && [[ "${r_last:-yok}" != yok ]] && [ -n "$PL_TOT" ]; then
  PT=1; seen portal-login-fail; seen portal-locked; seen portal-request-reject
  PL_FAIL="$(num "${PL_FAIL:--}")"; PL_FAIL="${PL_FAIL:-0}"; PL_LOCK="$(num "${PL_LOCK:--}")"; PL_LOCK="${PL_LOCK:-0}"
  PR_REJ="$(num "${PR_REJ:--}")"; PR_REJ="${PR_REJ:-0}"
fi

# Sertifikalar: LE web (nginx), LE remote-turn, coturn'ün dağıtılmış dosyası ve 5349'dan sunulan.
cert_left_ok() { openssl x509 -noout -checkend $((CERT_DAYS * DAY)) >/dev/null 2>&1; }
fp_of() { openssl x509 -noout -fingerprint -sha256 2>/dev/null | sed 's/.*=//'; }
CERT_PAIRS=("cert:web|$LE_DIR/$HOSTN/fullchain.pem")
[ "$TURN_CHECKS" = 0 ] || CERT_PAIRS+=("cert:turn-le|$LE_DIR/remote-turn/fullchain.pem")
for pair in "${CERT_PAIRS[@]}"; do
  n="${pair%%|*}"; f="${pair#*|}"; seen "$n"
  if [ ! -f "$f" ]; then fail "$n" "$f yok"; elif ! cert_left_ok <"$f"; then fail "$n" "$CERT_DAYS günden az kaldı"; fi
done
if [ "$TURN_CHECKS" = 1 ]; then
seen cert:turn-served
served="$(timeout 10 openssl s_client -connect "$TURN_TLS" -servername "$HOSTN" </dev/null 2>/dev/null | openssl x509 2>/dev/null)" || served=""
if [ -z "$served" ]; then fail cert:turn-served "$TURN_TLS TLS el sıkışması yok"
elif ! cert_left_ok <<<"$served"; then fail cert:turn-served "sunulan sertifikada $CERT_DAYS günden az kaldı"
elif [ -f "$TURN_CERT" ] && [ "$(fp_of <<<"$served")" != "$(fp_of <"$TURN_CERT")" ]; then
  fail cert:turn-served "sunulan != $TURN_CERT (deploy hook / SIGUSR2 başarısız?)"
fi
fi

for d in $DISKS; do
  [ -d "$d" ] || continue
  seen "disk:$d"
  pct="$(df -P "$d" 2>/dev/null | awk 'NR == 2 {gsub("%", "", $5); print $5}')"
  case "$pct" in ''|*[!0-9]*) fail "disk:$d" "df okunamadı" ;; *) [ "$pct" -lt "$DISK_MAX" ] || fail "disk:$d" "%$pct >= %$DISK_MAX" ;; esac
done

seen systemd-failed
# P13c: prod örneği şablon (@) birimlerini, ikinci örnek yalnız kendi @<örnek> birimlerini sayar (alarm ortamlar arası karışmaz).
failed_units="$(systemctl list-units --failed --plain --no-legend --no-pager 'remote-*' 2>/dev/null \
  | awk -v i="$INST" 'i == "" && $1 !~ /@/ {print $1} i != "" && index($1, "@" i ".") {print $1}' | tr '\n' ' ')"
[ -z "${failed_units// /}" ] || fail systemd-failed "${failed_units% }"

# G-P13b-13: root birimlerinin okuduğu ağaçta root dışı sahip / herkese yazılabilir dosya olmamalı.
if [ -n "$TREE" ] && [ -d "$TREE" ]; then
  seen tree-perms
  bad="$(find "$TREE" -xdev \( -path "$TREE/deploy/turn/certs" -o -path "$TREE/.data" \) -prune -o ! -type l \
    \( -perm -0002 -o ! -user 0 -o \( -perm -0020 ! -group 0 \) \) -print -quit 2>/dev/null)"
  [ -z "$bad" ] || fail tree-perms "root dışı sahip / herkese ya da root dışı gruba yazılabilir (S-P13b-4): ${bad#"$TREE"/}"
fi

# G-P13b-7: alarm komutunda sır deseni -> çalıştırılmaz.
ALERT_CMD="${WATCH_ALERT_CMD:-}"
seen alert-cmd-unsafe
if [ -n "$ALERT_CMD" ] && printf '%s' "$ALERT_CMD" | grep -Eqi 'api\.telegram\.org/bot[0-9]|bot[0-9]{6,}:[A-Za-z0-9_-]{20,}|x-api-key[[:space:]]*:|authorization[[:space:]]*:|AGE-SECRET-KEY'; then
  fail alert-cmd-unsafe "WATCH_ALERT_CMD sır içeriyor (ps ile görünür); curl -K <600 dosya> kullanın — komut ÇALIŞTIRILMADI"
  ALERT_CMD=""
fi

# --- durum, journal, alarm ---------------------------------------------------------------------------------------------
STATE="$STATE_DIR/state"
st_get() { [ -f "$STATE" ] && sed -n "s/^$1=//p" "$STATE" | tail -1; }
prev_fail="$(st_get failing)"; last_sent="$(st_get last_sent)"; remind="$(st_get offsite_remind)"
prev_rfc="$(st_get retention_fail_count)"; prev_rfa="$(st_get retention_fail_at)"
samples="$(st_get counter_samples)"; purge_sent="$(st_get purge_sent)"
case "$purge_sent" in ''|*[!0-9]*) purge_sent=0 ;; esac
case "$last_sent" in ''|*[!0-9]*) last_sent=0 ;; esac
case "$remind" in ''|*[!0-9]*) remind=0 ;; esac

# Saklama hata sayacı: artış anı saklanır; 24 saat içinde artış varsa alarm (süreç yeniden başlayınca sayaç sıfırlanır).
if [ -n "$RET_FC" ] && [[ "$RET_FC" =~ ^[0-9]+$ ]]; then
  [[ "$prev_rfc" =~ ^[0-9]+$ ]] || prev_rfc="$RET_FC"
  [[ "$prev_rfa" =~ ^[0-9]+$ ]] || prev_rfa=0
  if [ "$RET_FC" -gt "$prev_rfc" ]; then prev_rfa="$NOW"; fi
  prev_rfc="$RET_FC"
  [ $((NOW - prev_rfa)) -ge "$DAY" ] || fail retention "rs_retention_failures_total son 24 saatte arttı"
fi

# P16: devre kesici ve defter yazım hatası sayaçları — artıştan sonra 24 saat alarm (süreç yeniden başlarsa sayaç sıfırlanır,
# alarm yine 24 saat sürer). Defter yazım hatası ayrıca sayaç > 0 oldukça sürer (eksik satır elle eklenmeli; runbook §23.4).
bump() {  # bump <ad> <değer> <önceki> <önceki artış anı> -> "<önceki> <artış anı>" yazar
  local cur="$2" pc="$3" pa="$4"
  [[ "$pc" =~ ^[0-9]+$ ]] || pc="$cur"; [[ "$pa" =~ ^[0-9]+$ ]] || pa=0
  if [ "$cur" -gt "$pc" ] || { [ "$cur" -lt "$pc" ] && [ "$cur" -gt 0 ]; }; then pa="$NOW"; fi
  echo "$cur $pa"
}
oc_prev="$(st_get orphan_circuit)"; lw_prev="$(st_get ledger_write)"
if [ -n "$O_CIRC" ]; then
  read -r a b <<<"$(bump orphan-circuit "$O_CIRC" "${oc_prev% *}" "${oc_prev#* }")"; oc_prev="$a $b"
  [ $((NOW - b)) -ge "$DAY" ] || fail orphan-circuit "yetim tarama devre kesici açıldı (silme yapılmadı; runbook §23.4)"
fi
if [ -n "$L_FAIL" ]; then
  read -r a b <<<"$(bump ledger-write "$L_FAIL" "${lw_prev% *}" "${lw_prev#* }")"; lw_prev="$a $b"
  { [ "$L_FAIL" -eq 0 ] && [ $((NOW - b)) -ge "$DAY" ]; } || fail ledger-write "rs_erasure_ledger_write_failed_total=$L_FAIL (defter satırı yazılamadı; runbook §23.4)"
fi
# P18: şifre çözme hatası (T2c) sayaç > 0 oldukça ya da artıştan sonra 24 sa (Kritik); takvim düşüşü (T12) artıştan sonra
# 24 sa; firma müşteri mesajı kovası (T4, queue.alert) artıştan sonra 1 sa. Sayaçlar süreç yeniden başlayınca sıfırlanır.
df_prev="$(st_get decrypt_fail)"; cf_prev="$(st_get calendar_fallback)"; mt_prev="$(st_get msg_tenant_rate)"
if [ "$P18" = 1 ]; then
  # Önceki örnek yoksa (ilk P18 turu) taban 0: açılıştan beri birikmiş artış da alarm verir (sessiz kalmaz).
  [ -n "$cf_prev" ] || cf_prev="0 0"; [ -n "$mt_prev" ] || mt_prev="0 0"
  if [ -n "$D_FAIL" ]; then
    read -r a b <<<"$(bump crypto-decrypt "$D_FAIL" "${df_prev% *}" "${df_prev#* }")"; df_prev="$a $b"
    { [ "$D_FAIL" -eq 0 ] && [ $((NOW - b)) -ge "$DAY" ]; } || fail crypto-decrypt "rs_crypto_decrypt_failures_total=$D_FAIL (mesaj okunamadı: anahtar halkası/AAD; runbook §25.4)"
  fi
  if [ -n "$C_FB" ]; then
    read -r a b <<<"$(bump calendar-fallback "$C_FB" "${cf_prev% *}" "${cf_prev#* }")"; cf_prev="$a $b"
    [ $((NOW - b)) -ge "$DAY" ] || fail calendar-fallback "rs_calendar_fallback_total arttı (firma saat dilimi kurulamadı -> Europe/Istanbul; runbook §25.4)"
  fi
  read -r a b <<<"$(bump msg-tenant-rate "$M_TEN" "${mt_prev% *}" "${mt_prev#* }")"; mt_prev="$a $b"
  [ $((NOW - b)) -ge 3600 ] || fail msg-tenant-rate "firma müşteri mesajı kovası (300/dk) aşıldı, queue.alert (runbook §25.4)"
fi
# P19: hacim >= %80 "10 dk boyunca" = timer 10 dk'da bir -> ardışık iki turda (ilk görülme anından >= 9 dk) yüksek. SMS anahtarı
# okunamadı (T6; P18 crypto-decrypt'ten AYRI, Uyarı) artıştan sonra 24 sa; ilk P19 turunda taban 0.
vs_prev="$(st_get notify_volume_since)"; sk_prev="$(st_get sms_key_unreadable)"; nsamples="$(st_get notify_samples)"
[[ "$vs_prev" =~ ^[0-9]+$ ]] || vs_prev=""
if [ "$P19" = 1 ]; then
  if [ -n "$VOL_HI" ]; then
    vs_prev="${vs_prev:-$NOW}"
    [ $((NOW - vs_prev)) -lt 540 ] || fail notify-volume "firma başı saatlik bildirim >= tavanın %80'i ($VOL_HI) >= 10 dk (log notify.tenant_volume -> tenant; runbook §26.5)"
  else vs_prev=""; fi
  if [ -n "$SK_UNR" ]; then
    [ -n "$sk_prev" ] || sk_prev="0 0"
    read -r a b <<<"$(bump sms-key-unreadable "$SK_UNR" "${sk_prev% *}" "${sk_prev#* }")"; sk_prev="$a $b"
    [ $((NOW - b)) -ge "$DAY" ] || fail sms-key-unreadable "rs_sms_key_unreadable_total arttı (firma SMS anahtarı çözülemedi: SMSPORTAL_URL değişti / sürüm emekli; runbook §26.3)"
  fi
else vs_prev=""; fi

# P28b: rs_av_up=0 ardışık tur sayısı (av_down) ve tarama örnekleri "ts:toplam:başarısız" (av_samples, 90 dk).
av_down="$(st_get av_down)"; [[ "$av_down" =~ ^[0-9]+$ ]] || av_down=0
avsamples="$(st_get av_samples)"
if [ "$AV_ON" = 1 ] && [ -n "$AV_UP" ]; then
  if [ "$AV_UP" -eq 0 ]; then av_down=$((av_down + 1)); else av_down=0; fi
  [ "$av_down" -lt 2 ] || fail av-up "rs_av_up=0 ardışık $av_down yoklama: clamd'ye ulaşılamıyor -> sunucu modunda dosyalar TARANAMADI (fail-closed; runbook §28b.5)"
else av_down=0; fi

# P14a A5 (AC-208/212): sayaç örnekleri "ts:prefix:mysql" (90 dk tutulur). Artış = pencere başından (pencereden eski en
# yeni örnek; yoksa en eski) bugüne ardışık farkların toplamı; azalma = süreç yeniden başladı -> yeni değer artış sayılır.
seen guest-code-prefix; seen mysql-test-failed
gp="$(num "$R_GP")"; mf="$(num "$R_MF")"
kept=""
for x in $samples; do IFS=: read -r ts _ _ <<<"$x"; [[ "$ts" =~ ^[0-9]+$ ]] && [ $((NOW - ts)) -le 5400 ] && kept="${kept:+$kept }$x"; done
samples="$kept"; [ -z "$gp$mf" ] || samples="${samples:+$samples }$NOW:${gp:--}:${mf:--}"
incr() {  # incr <alan> <pencere sn> [örnekler; vars. $samples] -> artış (örnek yoksa boş)
  local f="$1" w="$2" base=0 i=0 x ts v prev="" sum=0 n=0 arr=() src="${3-$samples}"
  for x in $src; do arr+=("$x"); done
  for x in "${arr[@]+"${arr[@]}"}"; do ts="${x%%:*}"; [[ "$ts" =~ ^[0-9]+$ ]] && [ $((NOW - ts)) -ge "$w" ] && base="$i"; i=$((i + 1)); done
  for x in "${arr[@]:base}"; do
    v="$(cut -d: -f"$f" <<<"$x")"; [[ "$v" =~ ^[0-9]+$ ]] || { prev=""; continue; }
    if [ -n "$prev" ]; then if [ "$v" -ge "$prev" ]; then sum=$((sum + v - prev)); else sum=$((sum + v)); fi; n=$((n + 1)); fi
    prev="$v"
  done
  [ "$n" -gt 0 ] && echo "$sum"
}
d="$(incr 2 900)"; [ -z "$d" ] || [ "$d" -lt "$GP_MAX" ] || fail guest-code-prefix "rs_guest_code_rate_limited_total{scope=prefix} +$d / >=15 dk (eşik $GP_MAX)"
d="$(incr 3 3600)"; [ -z "$d" ] || [ "$d" -lt "$MF_MAX" ] || fail mysql-test-failed "rs_mysql_test_failed_total +$d / >=1 sa (eşik $MF_MAX)"
# P19 örnekleri "ts:outbox-toplam:outbox-failed:rate-limited" (ayrı durum anahtarı, 90 dk). FAILED oranı: 15 dk'da FAILED
# artışı >= NF_MIN ve toplam artışın yarısından fazla. rate_limited: 15 dk'da artış >= NRL_MAX -> notify-volume.
kept=""
for x in $nsamples; do IFS=: read -r ts _ <<<"$x"; [[ "$ts" =~ ^[0-9]+$ ]] && [ $((NOW - ts)) -le 5400 ] && kept="${kept:+$kept }$x"; done
nsamples="$kept"
if [ "$P19" = 1 ]; then
  nsamples="${nsamples:+$nsamples }$NOW:$NO_TOT:$NO_FAIL:$NO_RL"
  dt="$(incr 2 900 "$nsamples")"; dfl="$(incr 3 900 "$nsamples")"; drl="$(incr 4 900 "$nsamples")"
  [ -z "$dfl" ] || [ "${dt:-0}" -ge "$dfl" ] || dt="$dfl"   # tutarsız örnek (FAILED > toplam) -> toplam en az FAILED
  if [ -n "$dfl" ] && [ "$dfl" -ge "$NF_MIN" ] && [ $((dfl * 2)) -gt "${dt:-0}" ]; then
    fail notify-outbox-failed "15 dk'da FAILED $dfl / $dt son durum (> %50; runbook §26.2)"
  fi
  [ -z "$drl" ] || [ "$drl" -lt "$NRL_MAX" ] || fail notify-volume "rs_notify_rate_limited_total +$drl / >=15 dk (eşik $NRL_MAX; runbook §26.5)"
fi

# P28b: 1 sa'te başarısız tarama artışı >= AV_FMIN ve toplam artışın %20'sinden fazla (mimari §11.2).
kept=""
for x in $avsamples; do IFS=: read -r ts _ <<<"$x"; [[ "$ts" =~ ^[0-9]+$ ]] && [ $((NOW - ts)) -le 5400 ] && kept="${kept:+$kept }$x"; done
avsamples="$kept"
if [ "$AV_ON" = 1 ] && [ -n "$AV_TOT" ]; then
  avsamples="${avsamples:+$avsamples }$NOW:$AV_TOT:${AV_FAIL:-0}"
  dt="$(incr 2 3600 "$avsamples")"; dfl="$(incr 3 3600 "$avsamples")"
  [ -z "$dfl" ] || [ "${dt:-0}" -ge "$dfl" ] || dt="$dfl"
  if [ -n "$dfl" ] && [ "$dfl" -ge "$AV_FMIN" ] && [ $((dfl * 5)) -gt "${dt:-0}" ]; then
    fail av-scan-failed "1 sa'te taranamadı $dfl / $dt tarama (> %20; rs_av_scan_total{result=failed_*}; runbook §28b.5)"
  fi
fi

# P28u: dört göz e-postası son denemede de gitmedi (sayaç alıcı başına, 3 deneme sonrası) -> artıştan sonra 24 sa uyarı; ilk P28u
# turunda taban 0 (açılıştan beri birikmiş hata da alarm verir). Örnekler "ts:silent-ok:onay-toplam:onay-timeout" 25 sa tutulur:
# 1 sa'te izinsiz bağlantı > UA_SMAX -> uyarı; 24 sa'te onay zaman aşımı >= UA_TMIN ve onay sonuçlarının > %50'si -> bilgi.
ua_nf_prev="$(st_get ua_notify_fail)"; uasamples="$(st_get ua_samples)"
kept=""
for x in $uasamples; do IFS=: read -r ts _ <<<"$x"; [[ "$ts" =~ ^[0-9]+$ ]] && [ $((NOW - ts)) -le 90000 ] && kept="${kept:+$kept }$x"; done
uasamples="$kept"
if [ "$UA" = 1 ]; then
  [ -n "$ua_nf_prev" ] || ua_nf_prev="0 0"
  read -r a b <<<"$(bump unattended-notify-fail "$UA_NF" "${ua_nf_prev% *}" "${ua_nf_prev#* }")"; ua_nf_prev="$a $b"
  [ $((NOW - b)) -ge "$DAY" ] || fail unattended-notify-fail "rs_unattended_silent_notify_total{result=fail}=$UA_NF: dört göz e-postası 3 denemede gitmedi -> izinsiz bağlantı/politika değişikliği bildirilmedi (SMTP; runbook §28u.6)"
  uasamples="${uasamples:+$uasamples }$NOW:$UA_SOK:$UA_CT:$UA_CTO"
  d="$(incr 2 3600 "$uasamples")"
  [ -z "$d" ] || [ "$d" -le "$UA_SMAX" ] || fail unattended-silent-volume "1 sa'te izinsiz (silent) bağlantı +$d (eşik $UA_SMAX; audit filtresi İzinsiz; runbook §28u.6)"
  dt="$(incr 3 86400 "$uasamples")"; dto="$(incr 4 86400 "$uasamples")"
  [ -z "$dto" ] || [ "${dt:-0}" -ge "$dto" ] || dt="$dto"
  if [ -n "$dto" ] && [ "$dto" -ge "$UA_TMIN" ] && [ $((dto * 2)) -gt "${dt:-0}" ]; then
    fail unattended-consent-timeout "BİLGİ: 24 sa'te onay diyaloğu yanıtsız $dto / $dt (> %50; diyalog görünmüyor olabilir; runbook §28u.6)"
  fi
else ua_nf_prev=""; fi

# P28e: örnekler "ts:parça-toplam:parça-red:stop-toplam:stop-error:izleme-429" 90 dk tutulur. 1 sa'te error ile duran >= REC_EMIN ve
# duranların > %20'si -> rec-stop-error; reddedilen parça (invalid|rate|busy) 600 sn penceresinde (timer 10 dk -> fiilen 10-20 dk)
# > REC_BMAX -> rec-part-rejected; 1 sa'te izleme kovası 429 > REC_VMAX -> rec-view-throttled.
recsamples="$(st_get rec_samples)"
kept=""
for x in $recsamples; do IFS=: read -r ts _ <<<"$x"; [[ "$ts" =~ ^[0-9]+$ ]] && [ $((NOW - ts)) -le 5400 ] && kept="${kept:+$kept }$x"; done
recsamples="$kept"
if [ "$REC" = 1 ]; then
  recsamples="${recsamples:+$recsamples }$NOW:$REC_PT:$REC_PB:$REC_ST:$REC_SE:$REC_VT"
  dst="$(incr 4 3600 "$recsamples")"; dse="$(incr 5 3600 "$recsamples")"
  [ -z "$dse" ] || [ "${dst:-0}" -ge "$dse" ] || dst="$dse"
  if [ -n "$dse" ] && [ "$dse" -ge "$REC_EMIN" ] && [ $((dse * 5)) -gt "${dst:-0}" ]; then
    fail rec-stop-error "1 sa'te kayıt error ile durdu $dse / $dst (> %20; gözcü no_upload / tarayıcı kaydedici; audit recording.stop cause; runbook §28e.6)"
  fi
  d="$(incr 3 600 "$recsamples")"
  [ -z "$d" ] || [ "$d" -le "$REC_BMAX" ] || fail rec-part-rejected "10 dk'da reddedilen kayıt parçası +$d (invalid|rate|busy; eşik $REC_BMAX; runbook §28e.6)"
  d="$(incr 6 3600 "$recsamples")"
  [ -z "$d" ] || [ "$d" -le "$REC_VMAX" ] || fail rec-view-throttled "1 sa'te izleme çekiş bütçesi aşımı +$d (toplu çekiş denemesi? audit recording.view.end; eşik $REC_VMAX; runbook §28e.6)"
fi

# P28c: örnekler "ts:ret-toplam" 90 dk tutulur; 1 sa'te artış > MD_MAX -> multi-denied (süreç yeniden başlarsa sayaç sıfırlanır,
# incr yeni değeri artış sayar).
mdsamples="$(st_get multi_samples)"
kept=""
for x in $mdsamples; do IFS=: read -r ts _ <<<"$x"; [[ "$ts" =~ ^[0-9]+$ ]] && [ $((NOW - ts)) -le 5400 ] && kept="${kept:+$kept }$x"; done
mdsamples="$kept"
if [ "$MD" = 1 ]; then
  mdsamples="${mdsamples:+$mdsamples }$NOW:$MD_TOT"
  d="$(incr 2 3600 "$mdsamples")"
  [ -z "$d" ] || [ "$d" -le "$MD_MAX" ] || fail multi-denied "1 sa'te çoklu teknisyen rol kapısı reddi +$d (rs_multi_denied_total{type}: izleyici/katılımcı yetkisiz mesaj — rol yükseltme denemesi ya da sürüm hatası; eşik $MD_MAX; runbook §28c.6)"
fi

# P21: örnekler "ts:giriş-fail:kilit:talep-ret" 90 dk tutulur. 600 sn penceresinde (timer 10 dk -> fiilen 10-20 dk) giriş hatası
# artışı >= PL_FMAX -> portal-login-fail; 1 sa'te kilit artışı > PL_LMAX -> portal-locked; 1 sa'te talep reddi > PR_RMAX ->
# portal-request-reject. Süreç yeniden başlarsa sayaç sıfırlanır (incr yeni değeri artış sayar).
ptsamples="$(st_get portal_samples)"
kept=""
for x in $ptsamples; do IFS=: read -r ts _ <<<"$x"; [[ "$ts" =~ ^[0-9]+$ ]] && [ $((NOW - ts)) -le 5400 ] && kept="${kept:+$kept }$x"; done
ptsamples="$kept"
if [ "$PT" = 1 ]; then
  ptsamples="${ptsamples:+$ptsamples }$NOW:$PL_FAIL:$PL_LOCK:$PR_REJ"
  d="$(incr 2 600 "$ptsamples")"
  [ -z "$d" ] || [ "$d" -lt "$PL_FMAX" ] || fail portal-login-fail "10 dk'da portal giriş hatası +$d (>= $PL_FMAX; dağıtık kimlik doldurma? rs_portal_login_total{result=fail}; runbook §29.5)"
  d="$(incr 3 3600 "$ptsamples")"
  [ -z "$d" ] || [ "$d" -le "$PL_LMAX" ] || fail portal-locked "1 sa'te kilitlenen portal hesabı +$d (eşik $PL_LMAX; audit portal.locked; runbook §29.5)"
  d="$(incr 4 3600 "$ptsamples")"
  [ -z "$d" ] || [ "$d" -le "$PR_RMAX" ] || fail portal-request-reject "1 sa'te portal talep reddi +$d (rate_limited|queue_full; eşik $PR_RMAX; audit via:portal; runbook §29.5)"
fi

cur=""
for x in "${FAILS[@]+"${FAILS[@]}"}"; do
  n="${x%%|*}"; err "ALERT check=$n ${x#*|}"
  case " $cur " in *" $n "*) ;; *) cur="${cur:+$cur }$n" ;; esac
done
[ -n "$cur" ] || log "OK (${#CHECKS[@]} kontrol)"

send() {  # send <mesaj>; 0 = gönderildi (ya da komut yok)
  local msg="$1"
  if [ -z "$ALERT_CMD" ]; then return 0; fi
  if printf '%s\n' "$msg" | REMOTE_WATCH_MSG="$msg" timeout 30 sh -c "$ALERT_CMD" >/dev/null 2>&1; then
    log "alarm komutu çağrıldı: ${msg#*: }"; return 0
  fi
  err "UYARI: WATCH_ALERT_CMD başarısız; sonraki koşuda yeniden denenir"; return 1
}
H="$(hostname -s 2>/dev/null || hostname)"
new=""; fixed=""
for n in $cur; do case " $prev_fail " in *" $n "*) ;; *) new="${new:+$new }$n" ;; esac; done
for n in $prev_fail; do case " $cur " in *" $n "*) ;; *) fixed="${fixed:+$fixed }$n" ;; esac; done
# keep = bir sonraki koşunun "önceki bozuk küme"si. Gönderim başarısızsa yeni kontroller "yeni" kalır, düzelenler yeniden
# denenir (alarm komutu geçici olarak çalışmıyorsa mesaj kaybolmaz).
keep="$cur"
# S16-12: SCHEDULED iş sürdükçe alarm PURGE_REPEAT dakikada bir (vars. her tur) yeniden gönderilir.
force=0; case " $cur " in *" purge-scheduled "*) [ $((NOW - purge_sent)) -lt $((PURGE_REPEAT * 60)) ] || force=1 ;; esac
if [ -n "$cur" ] && { [ -n "$new" ] || [ "$force" = 1 ] || [ $((NOW - last_sent)) -ge $((REPEAT_MIN * 60)) ]; }; then
  if send "remote-watch${INST:+[$INST]} $H: ALERT ${cur// /,}"; then last_sent="$NOW"; [ "$force" = 0 ] && [ -z "$new" ] || purge_sent="$NOW"
  else keep=""; for n in $cur; do case " $new " in *" $n "*) ;; *) keep="${keep:+$keep }$n" ;; esac; done; fi
fi
if [ -n "$fixed" ]; then
  if send "remote-watch${INST:+[$INST]} $H: DUZELDI ${fixed// /,}"; then [ -n "$cur" ] || last_sent=0
  else keep="${keep:+$keep }$fixed"; fi
fi

# Site dışı yedek yapılandırılmamışsa WATCH_OFFSITE_REMIND_DAYS günde bir hatırlatma (alarm sayılmaz; durum OK kalır).
if [ -f "$BSTATUS" ] && [ "$(prom remote_backup_offsite_configured)" = 0 ]; then
  log "UYARI check=offsite-unconfigured site dışı yedek kopyası yok (ADR-0020)"
  if [ $((NOW - remind)) -ge $((REMIND_DAYS * DAY)) ]; then
    send "remote-watch${INST:+[$INST]} $H: HATIRLATMA site-disi-yedek-yapilandirilmamis" && remind="$NOW"
  fi
fi

tmp="$STATE.tmp.$$"
printf 'failing=%s\nlast_sent=%s\noffsite_remind=%s\nretention_fail_count=%s\nretention_fail_at=%s\ncounter_samples=%s\npurge_sent=%s\norphan_circuit=%s\nledger_write=%s\ndecrypt_fail=%s\ncalendar_fallback=%s\nmsg_tenant_rate=%s\nnotify_volume_since=%s\nsms_key_unreadable=%s\nnotify_samples=%s\nav_down=%s\nav_samples=%s\nua_notify_fail=%s\nua_samples=%s\nrec_samples=%s\nmulti_samples=%s\nportal_samples=%s\n' \
  "$keep" "$last_sent" "$remind" "${prev_rfc:-}" "${prev_rfa:-}" "$samples" "$purge_sent" "${oc_prev:-}" "${lw_prev:-}" \
  "${df_prev:-}" "${cf_prev:-}" "${mt_prev:-}" "${vs_prev:-}" "${sk_prev:-}" "$nsamples" "$av_down" "$avsamples" "${ua_nf_prev:-}" "$uasamples" "$recsamples" "$mdsamples" "$ptsamples" >"$tmp" && mv -f "$tmp" "$STATE"
tmp="$STATE_DIR/status.prom.tmp.$$"
{
  echo "# $TAG (mimari-p13 §7.8); sır yok"
  echo "remote_watch_last_run_timestamp_seconds $NOW"
  echo "remote_watch_ok $([ -z "$cur" ] && echo 1 || echo 0)"
  echo "remote_watch_failing_checks $(wc -w <<<"$cur" | tr -d ' ')"
  for c in "${CHECKS[@]}"; do
    case " $cur " in *" $c "*) v=0 ;; *) v=1 ;; esac
    printf 'remote_watch_check_ok{check="%s"} %s\n' "$c" "$v"
  done
} >"$tmp" && chmod 0644 "$tmp" && mv -f "$tmp" "$STATE_DIR/status.prom"
exit 0
