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
WATCH_BACKUP_DIR WATCH_DISK_PATHS WATCH_OFFSITE_REMIND_DAYS WATCH_TREE_DIR WATCH_TIMERS WATCH_TURN_CHECKS"

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
TREE="${WATCH_TREE_DIR-/opt/remote$S}"
if [ -n "$INST" ]; then TIMERS="${WATCH_TIMERS:-remote-backup@$INST.timer}"; TURN_CHECKS="${WATCH_TURN_CHECKS:-0}"
else TIMERS="${WATCH_TIMERS:-remote-turn-fw.timer remote-backup.timer}"; TURN_CHECKS="${WATCH_TURN_CHECKS:-1}"; fi
case "$TURN_CHECKS" in 0|1) ;; *) die "WATCH_TURN_CHECKS 0 ya da 1 olmalı" ;; esac
for v in REPEAT_MIN DISK_MAX CERT_DAYS REMIND_DAYS; do
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
for s in $SERVICES; do
  seen "compose:$s"
  line="$(awk -F'|' -v s="$s" '$1 == s {print; exit}' <<<"$ps_out")"
  if [ -z "$line" ]; then fail "compose:$s" "konteyner yok"; continue; fi
  IFS='|' read -r _ st status _ <<<"$line"
  if [ "$st" != running ]; then fail "compose:$s" "durum=$st"
  elif [[ "$status" == *"(unhealthy)"* || "$status" == *"health: starting"* ]]; then fail "compose:$s" "sağlık=${status##*(}"; fi
done

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
  if [ "$(prom remote_backup_offsite_configured)" = 1 ]; then
    os_="$(prom remote_backup_offsite_last_success_timestamp_seconds)"
    age_ok "$os_" || fail offsite "site dışı kopya 26 saatten eski (rc=$(prom remote_backup_offsite_last_rc))"
  fi
fi

# Saklama işi (runbook §18.6 mantığı): metrik + süreç yaşı; hata sayacı son 24 saatte arttıysa alarm.
seen retention
RET_FC=""
if [ -n "$SERVER_C" ]; then
  rt="$(timeout 20 docker exec "$SERVER_C" node -e "fetch('http://127.0.0.1:3001/metrics',{headers:{authorization:'Bearer '+(process.env.METRICS_TOKEN||'')}}).then(r=>r.text()).then(t=>{const m=t.match(/^rs_retention_last_success_timestamp_seconds (\S+)/m);const f=t.match(/^rs_retention_failures_total (\S+)/m);console.log((m?m[1]:'yok')+' '+(f?f[1]:'0'))}).catch(()=>console.log('yok 0'))" 2>/dev/null)" || rt="yok 0"
  started="$(docker inspect -f '{{.State.StartedAt}}' "$SERVER_C" 2>/dev/null)"
  st_epoch="$(date -d "$started" +%s 2>/dev/null || echo "$NOW")"
  read -r r_last r_fail <<<"$rt"
  r_last="${r_last%.*}"; r_fail="${r_fail%.*}"
  if [ "$r_last" = yok ] || [ -z "$r_last" ]; then fail retention "rs_retention metriği yok (METRICS_TOKEN?)"
  elif [ $((NOW - st_epoch)) -ge 93600 ] && [ $((NOW - r_last)) -ge 93600 ]; then fail retention "26 saattir başarılı saklama turu yok"; fi
  RET_FC="$r_fail"
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
if [ -n "$cur" ] && { [ -n "$new" ] || [ $((NOW - last_sent)) -ge $((REPEAT_MIN * 60)) ]; }; then
  if send "remote-watch${INST:+[$INST]} $H: ALERT ${cur// /,}"; then last_sent="$NOW"
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
printf 'failing=%s\nlast_sent=%s\noffsite_remind=%s\nretention_fail_count=%s\nretention_fail_at=%s\n' \
  "$keep" "$last_sent" "$remind" "${prev_rfc:-}" "${prev_rfa:-}" >"$tmp" && mv -f "$tmp" "$STATE"
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
