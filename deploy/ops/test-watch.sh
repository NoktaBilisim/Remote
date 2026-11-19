#!/usr/bin/env bash
# remote-watch.sh yerel testi (P13b T4; mimari-p13 §7.8, AC önerisi §7.15-e, G-P13b-7/13). Sunucuya bağlanmaz.
# Linux root konteyneri (alpine, benzersiz ad, iş bitince silinir; dind YOK): docker/systemctl/curl yerine PATH taslakları
# (senaryo dosyalarından okur), openssl/df/find/timeout/date gerçek. Coturn 5349 yerine openssl s_server.
# Doğrulananlar: her kontrol için olumsuz durum -> `ALERT check=<ad>` + alarm komutu; tekrar bastırma; tekrar süresi
# dolunca yeniden; düzelince bir kez DUZELDI; watch.env 644 / bağlantı / root dışı sahip -> çalışmaz; sır içeren alarm
# komutu çalıştırılmaz; site dışı hatırlatma 7 günde bir; install/uninstall (kurulu kopya root 0755, watch.env 600);
# P13c ikinci örnek `stg` (ayrı env/durum, [stg] alarm adı, coturn kontrolü yok, @stg birimleri yalnız stg'de sayılır);
# P18 H5 crypto-decrypt / calendar-fallback / msg-tenant-rate / p18-metrics; P19 J6 notify-outbox-pending /
# notify-outbox-failed / notify-volume / sms-key-unreadable / p19-metrics; P28b K6 av-up (ardışık 2) / av-selftest /
# av-signature-age / av-scan-failed / av-metrics / compose:clamav*; P28u K8 unattended-notify-fail / unattended-silent-volume /
# unattended-consent-timeout; P28e K8 rec-stop-error / rec-part-rejected / rec-view-throttled; P28c K4 multi-denied;
# P22-O session-chat-internal.
# Kullanım: deploy/ops/test-watch.sh   Çıkış 0 = tüm beklentiler tuttu.
set -euo pipefail
cd "$(dirname "$0")"
HERE="$PWD"
C="${TEST_CONTAINER_NAME:-rs-watch-test-$$}"
TMP="$(mktemp -d)"
cleanup() { docker rm -f "$C" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

cat >"$TMP/docker" <<'EOF'
#!/bin/sh
# docker taslağı: /scn altındaki dosyalar senaryoyu belirler.
case "$1" in
  ps) cat /scn/ps ;;
  exec)
    case "$*" in
      *turnutils_stunclient*) exit "$(cat /scn/stun_rc)" ;;
      *"/metrics"*) cat /scn/metrics ;;
      *"/ready"*) exit "$(cat /scn/ready_rc)" ;;
    esac ;;
  inspect)
    case "$*" in
      *StartedAt*) cat /scn/started ;;
      *Health*) cat /scn/turn_health ;;
    esac ;;
esac
EOF
cat >"$TMP/systemctl" <<'EOF'
#!/bin/sh
echo "systemctl $*" >>/scn/systemctl.log
case "$1" in
  is-active) for a; do :; done; grep -qx "$a" /scn/timers_active ;;
  list-units) cat /scn/failed ;;
  daemon-reload|enable|disable) exit 0 ;;
esac
EOF
cat >"$TMP/curl" <<'EOF'
#!/bin/sh
printf '%s' "$(cat /scn/login_code)"
EOF

cat >"$TMP/inner.sh" <<'EOF'
#!/bin/bash
set -u
apk add --no-cache bash openssl coreutils findutils >/dev/null 2>&1 || { echo "FAIL  apk"; echo "SONUÇ-İÇ 1"; exit 1; }
F=0; ok() { echo "PASS  $*"; }; no() { echo "FAIL  $*"; F=$((F + 1)); }
mkdir -p /stub /scn /out && for f in docker systemctl curl; do cp /t/$f /stub/$f; chmod 755 /stub/$f; done
export PATH="/stub:$PATH"
W=/w/remote-watch.sh
H=remote.test
mkc() { mkdir -p "$(dirname "$1")"; openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days "$2" \
  -subj "/CN=$H" -addext "subjectAltName=DNS:$H" -keyout "$1.key" -out "$1" >/dev/null 2>&1; }
mkc /le/$H/fullchain.pem 90; mkc /le/remote-turn/fullchain.pem 90; mkc /tc/turn.crt 90; mkc /tc/other.crt 90; mkc /tc/short.crt 5
srv() { [ -f /run/srv.pid ] && kill "$(cat /run/srv.pid)" 2>/dev/null; sleep 0.2
  openssl s_server -accept 5349 -cert "$1" -key "$1.key" -quiet -naccept 100000 </dev/null >/dev/null 2>&1 & echo $! >/run/srv.pid; sleep 0.5; }
srv /tc/turn.crt
NOW=$(date +%s)
good() {
  printf 'mysql|running|Up 2 hours (healthy)|remote-mysql-1\nserver|running|Up 2 hours (healthy)|remote-server-1\nweb|running|Up 2 hours (healthy)|remote-web-1\ncaddy|running|Up 2 hours|remote-caddy-1\n' >/scn/ps
  echo 0 >/scn/ready_rc; echo 0 >/scn/stun_rc; echo healthy >/scn/turn_health; echo 200 >/scn/login_code
  printf 'remote-turn-fw.timer\nremote-backup.timer\n' >/scn/timers_active; : >/scn/failed
  echo "$(date -u -d '-2 hours' +%Y-%m-%dT%H:%M:%S.000000000Z)" >/scn/started
  # alanlar: retention-ts retention-hata prefix mysql | P16: SCHEDULED FAILED RUNNING heartbeat orphan-ts circuit ledger-hata
  echo "$(( $(date +%s) - 3600 )) 0 0 0 0 0 0 - $(( $(date +%s) - 3600 )) 0 0" >/scn/metrics
  cat >/scn/status.prom <<P
remote_backup_last_success_timestamp_seconds $(( $(date +%s) - 3600 ))
remote_backup_last_run_ok 1
remote_backup_offsite_configured 1
remote_backup_offsite_last_success_timestamp_seconds $(( $(date +%s) - 3600 ))
remote_backup_offsite_last_rc 0
remote_backup_audit_continuity_ok 1
remote_backup_ledger_ok 1
P
  mkdir -p /opt/tree/deploy; chmod -R go-w /opt/tree
}
good
mkdir -p /etc/rw
cat >/etc/rw/watch.env <<'E'
WATCH_ALERT_CMD=cat >>/out/alerts; echo "env:$REMOTE_WATCH_MSG" >>/out/env
WATCH_PUBLIC_HOST=remote.test
WATCH_LE_DIR=/le
E
chmod 600 /etc/rw/watch.env
export WATCH_ENV_FILE=/etc/rw/watch.env WATCH_STATE_DIR=/var/lib/rw WATCH_BACKUP_STATUS=/scn/status.prom \
  WATCH_TURN_CERT_FILE=/tc/turn.crt WATCH_TURN_TLS=127.0.0.1:5349 WATCH_DISK_PATHS="/" WATCH_TREE_DIR=/opt/tree
run() { : >/out/alerts; bash $W run >/out/o 2>&1; RC=$?; }
alerted() { grep -q "$1" /out/alerts; }

run
[ "$RC" = 0 ] && grep -q '^remote-watch: OK' /out/o && [ ! -s /out/alerts ] && ok "her şey sağlam -> OK, alarm yok" || no "temiz durum: rc=$RC $(cat /out/o)"
grep -q 'remote_watch_ok 1' /var/lib/rw/status.prom && ok "status.prom remote_watch_ok 1" || no "status.prom"

# 1) Servis durdu -> ALERT + alarm; hemen tekrar -> bastırıldı; tekrar süresi dolunca yeniden; düzelince bir kez DUZELDI
sed -i 's/^web|running|Up 2 hours (healthy)/web|exited|Exited (0) 1 minute ago/' /scn/ps
run
grep -q 'ALERT check=compose:web durum=exited' /out/o && alerted 'ALERT compose:web' && grep -q 'env:remote-watch .*ALERT compose:web' /out/env \
  && ok "web durdu -> ALERT check=compose:web + alarm (stdin ve REMOTE_WATCH_MSG)" || no "web durdu: $(cat /out/o) / $(cat /out/alerts)"
run
grep -q 'ALERT check=compose:web' /out/o && [ ! -s /out/alerts ] && ok "ikinci koşu: journal ALERT, alarm bastırıldı" || no "bastırma: $(cat /out/alerts)"
sed -i "s/^last_sent=.*/last_sent=$((NOW - 361 * 60))/" /var/lib/rw/state
run
alerted 'ALERT compose:web' && ok "tekrar süresi (360 dk) dolunca alarm yeniden" || no "tekrar: $(cat /out/alerts)"
WATCH_REPEAT_MIN=1000 run
[ ! -s /out/alerts ] && ok "tekrar süresi dolmadan alarm yok (WATCH_REPEAT_MIN=1000)" || no "repeat: $(cat /out/alerts)"
good; run
alerted 'DUZELDI compose:web' && grep -q '^remote-watch: OK' /out/o && ok "web döndü -> bir kez DUZELDI" || no "düzeldi: $(cat /out/alerts)"
run
[ ! -s /out/alerts ] && ok "düzeldi mesajı tekrarlanmadı" || no "düzeldi tekrar: $(cat /out/alerts)"
# Alarm komutu başarısızsa yeni kontrol 'yeni' kalır ve sonraki koşuda gönderilir
echo 1 >/scn/ready_rc
WATCH_ALERT_CMD='exit 7' bash $W run >/out/o 2>&1; run
alerted 'ALERT ready' && ok "alarm komutu başarısız -> sonraki koşuda yeniden denendi" || no "yeniden deneme: $(cat /out/alerts)"
good; run

# 2) Her kontrol için olumsuz test: <ad> <bozma komutu>
neg() {
  local name="$1" breakc="$2"; good; eval "$breakc"; run
  if grep -q "ALERT check=$name" /out/o && alerted "$name"; then ok "olumsuz: $name -> ALERT + alarm"; else no "olumsuz $name: $(grep -E 'ALERT|OK' /out/o | head -3)"; fi
  good; srv /tc/turn.crt; run
}
neg 'compose:mysql' "sed -i 's/^mysql|running|Up 2 hours (healthy)/mysql|running|Up 2 hours (unhealthy)/' /scn/ps"
neg 'compose:caddy' "sed -i '/^caddy|/d' /scn/ps"
neg ready "echo 1 >/scn/ready_rc"
neg nginx-login "echo 502 >/scn/login_code"
neg coturn "echo unhealthy >/scn/turn_health"
neg coturn "echo 1 >/scn/stun_rc"
neg 'timer:remote-backup.timer' "sed -i '/remote-backup.timer/d' /scn/timers_active"
neg 'timer:remote-turn-fw.timer' "sed -i '/remote-turn-fw.timer/d' /scn/timers_active"
neg backup-age "sed -i 's/^remote_backup_last_success_timestamp_seconds .*/remote_backup_last_success_timestamp_seconds $((NOW - 27 * 3600))/' /scn/status.prom"
neg backup-age "rm /scn/status.prom"
neg audit-continuity "sed -i 's/^remote_backup_audit_continuity_ok .*/remote_backup_audit_continuity_ok 0/' /scn/status.prom"
neg offsite "sed -i 's/^remote_backup_offsite_last_success_timestamp_seconds .*/remote_backup_offsite_last_success_timestamp_seconds $((NOW - 30 * 3600))/' /scn/status.prom"
neg retention "echo 'yok 0' >/scn/metrics"
neg retention "echo '$((NOW - 30 * 3600)) 0' >/scn/metrics; echo $(date -u -d '-30 hours' +%Y-%m-%dT%H:%M:%SZ) >/scn/started"
neg retention "echo '$((NOW - 60)) 3' >/scn/metrics"
# Sayaç artışı 24 saat alarmda kalır (tasarım); sonraki testler için artış anı geçmişe alınır.
sed -i "s/^retention_fail_at=.*/retention_fail_at=$((NOW - 90000))/" /var/lib/rw/state; run
grep -q 'ALERT check=retention' /out/o && no "retention artışı 24 saat sonra hâlâ alarm" || ok "retention: artıştan 24 saat sonra alarm kalktı"
# S14-2: konteyner çıktısındaki aritmetik enjeksiyon `$(( ))`'e girmez (dosya oluşmaz, güvenli varsayılan + uyarı).
good; run
for inj in 'a[$(touch /tmp/pwn1)] 0 0 0' "$((NOW - 3600)) a[\$(touch /tmp/pwn2)] 0 0" "$((NOW - 3600)) 0 a[\$(touch /tmp/pwn3)] a[\$(touch /tmp/pwn4)]"; do
  echo "$inj" >/scn/metrics; run
done
echo 'a[$(touch /tmp/pwn5)]' >/scn/started; echo "$((NOW - 3600)) 0 0 0" >/scn/metrics; run
sed -i 's/^counter_samples=.*/counter_samples=a[$(touch \/tmp\/pwn6)]:1:1 1:a[$(touch \/tmp\/pwn7)]:1/' /var/lib/rw/state; run
ls /tmp/pwn* >/dev/null 2>&1 && no "S14-2 enjeksiyon dosya oluşturdu: $(ls /tmp/pwn*)" || ok "S14-2: a[\$(touch …)] metrik/started/durum değerleri komut çalıştırmadı"
echo 'a[$(touch /tmp/pwn1)] 0 0 0' >/scn/metrics; run
grep -q 'ALERT check=retention rs_retention metrik değeri geçersiz' /out/o && grep -q 'UYARI: rs_retention_last_success' /out/o \
  && ok "S14-2: geçersiz r_last -> uyarı + ALERT retention" || no "S14-2 r_last: $(cat /out/o)"
good; run
# P14a A5 (AC-208/212): sayaç pencere alarmları. /scn/metrics = "<retention ts> <retention hata> <prefix> <mysql>".
cs() { sed -i "s/^counter_samples=.*/counter_samples=$1/" /var/lib/rw/state; }
met() { echo "$((NOW - 3600)) 0 $1 $2 0 0 0 - $((NOW - 3600)) 0 0" >/scn/metrics; }
cnt() {  # cnt <ad> <örnekler> <prefix> <mysql> <alarm 1|0> <açıklama>
  good; run; cs "$2"; met "$3" "$4"; run
  if [ "$5" = 1 ]; then grep -q "ALERT check=$1" /out/o && alerted "$1" && ok "$6" || no "$6: $(grep -E 'ALERT|OK' /out/o | head -3)"
  else ! grep -q "ALERT check=$1" /out/o && ok "$6" || no "$6: $(grep ALERT /out/o | head -3)"; fi
}
cnt guest-code-prefix "" 1000 0 0 "prefix: ilk örnek (taban yok) -> alarm yok"
cnt guest-code-prefix "$((NOW - 1200)):0:0" 19 0 0 "prefix: >=15 dk'da +19 -> alarm yok"
cnt guest-code-prefix "$((NOW - 1200)):0:0" 20 0 1 "AC-208 prefix: >=15 dk'da +20 -> ALERT guest-code-prefix"
cnt guest-code-prefix "$((NOW - 3000)):0:0 $((NOW - 1200)):25:0" 30 0 0 "prefix: artış pencere dışında (+5 son 15+ dk) -> alarm yok"
cnt guest-code-prefix "$((NOW - 1200)):100:0" 25 0 1 "prefix: süreç yeniden başladı (100 -> 25) -> +25 sayılır, ALERT"
cnt mysql-test-failed "$((NOW - 4000)):0:0 $((NOW - 3700)):0:2 $((NOW - 600)):0:8" 0 12 1 "AC-212 mysql: 1 sa'te +10 -> ALERT mysql-test-failed"
cnt mysql-test-failed "$((NOW - 4000)):0:0 $((NOW - 3700)):0:2 $((NOW - 600)):0:8" 0 11 0 "mysql: 1 sa'te +9 -> alarm yok"
cnt mysql-test-failed "$((NOW - 1200)):0:0" - - 0 "metrik yok ('-', A3 öncesi) -> alarm yok"
grep -q "^counter_samples=$((NOW - 1200)):0:0$" /var/lib/rw/state && ok "metrik yokken örnek eklenmedi" || no "örnek: $(grep counter_samples /var/lib/rw/state)"
good; cs "$((NOW - 9000)):0:0"; run
grep -q "^counter_samples=[0-9]*:0:0$" /var/lib/rw/state && ! grep -q "counter_samples=$((NOW - 9000)):" /var/lib/rw/state \
  && ok "90 dk'dan eski örnek atıldı" || no "budama: $(grep counter_samples /var/lib/rw/state)"
good; run
# P16 (mimari-e11 §7.7, S16-12/13; runbook §23.4): kalıcı silme alarmları
p16() { echo "$((NOW - 3600)) 0 0 0 $1" >/scn/metrics; }   # p16 "<SCHEDULED> <FAILED> <RUNNING> <hb> <orphan-ts> <circuit> <ledger>"
neg purge-scheduled "p16 '1 0 0 - $((NOW - 3600)) 0 0'"
p16 "1 0 0 - $((NOW - 3600)) 0 0"; run; run
alerted 'ALERT .*purge-scheduled' && ok "S16-12: SCHEDULED sürdükçe her turda yeniden alarm (WATCH_PURGE_REPEAT_MIN=0)" || no "purge tekrar: $(cat /out/alerts)"
WATCH_PURGE_REPEAT_MIN=60 run
[ ! -s /out/alerts ] && ok "WATCH_PURGE_REPEAT_MIN=60 -> tur içinde tekrar yok" || no "purge repeat 60: $(cat /out/alerts)"
good; run
neg purge-failed "p16 '0 1 0 - $((NOW - 3600)) 0 0'"
neg purge-heartbeat "p16 '0 0 1 $((NOW - 2000)) $((NOW - 3600)) 0 0'"
neg purge-heartbeat "p16 '0 0 1 2000 $((NOW - 3600)) 0 0'"
neg purge-heartbeat "p16 '0 0 1 - $((NOW - 3600)) 0 0'"
good; p16 "0 0 1 $((NOW - 60)) $((NOW - 3600)) 0 0"; run
! grep -q 'ALERT check=purge-heartbeat' /out/o && ok "RUNNING + taze heartbeat -> alarm yok" || no "hb taze: $(cat /out/o)"
neg p16-metrics "echo '$((NOW - 3600)) 0 0 0' >/scn/metrics"
good; echo "$((NOW - 3600)) 0 0 0" >/scn/metrics; WATCH_PURGE_CHECKS=0 run
! grep -q 'p16-metrics' /out/o && ok "WATCH_PURGE_CHECKS=0 -> P16 kontrolleri yok" || no "purge checks 0: $(cat /out/o)"
good; run
neg orphan-scan "p16 '0 0 0 - $((NOW - 9 * 86400)) 0 0'; echo $(date -u -d '-9 days' +%Y-%m-%dT%H:%M:%SZ) >/scn/started"
good; p16 "0 0 0 - $((NOW - 86400)) 0 0"; echo "$(date -u -d '-9 days' +%Y-%m-%dT%H:%M:%SZ)" >/scn/started; run
! grep -q 'ALERT check=orphan-scan' /out/o && ok "tarama 1 g önce -> alarm yok" || no "orphan taze: $(cat /out/o)"
good; p16 "0 0 0 - - 0 0"; run
! grep -q 'ALERT check=orphan-scan' /out/o && ok "süreç < 8 g ve tarama metriği yok -> alarm yok" || no "orphan yeni süreç: $(cat /out/o)"
good; run; neg orphan-circuit "p16 '0 0 0 - $((NOW - 3600)) 1 0'"
sed -i "s/^orphan_circuit=.*/orphan_circuit=1 $((NOW - 90000))/" /var/lib/rw/state; p16 "0 0 0 - $((NOW - 3600)) 1 0"; run
! grep -q 'ALERT check=orphan-circuit' /out/o && ok "devre kesici: artıştan 24 sa sonra alarm kalktı" || no "circuit 24h: $(cat /out/o)"
good; run; neg ledger-write "p16 '0 0 0 - $((NOW - 3600)) 0 1'"
sed -i "s/^ledger_write=.*/ledger_write=0 $((NOW - 90000))/" /var/lib/rw/state; run
! grep -q 'ALERT check=ledger-write' /out/o && ok "defter yazım hatası: sayaç 0 ve artıştan 24 sa sonra alarm kalktı" || no "ledger-write 24h: $(cat /out/o)"
neg ledger-backup "sed -i 's/^remote_backup_ledger_ok .*/remote_backup_ledger_ok 0/' /scn/status.prom"
good; sed -i '/remote_backup_ledger_ok/d' /scn/status.prom; run
! grep -q 'ledger-backup' /out/o && ok "P16 öncesi status.prom (ledger_ok yok) -> değerlendirilmez" || no "ledger-backup yok: $(cat /out/o)"
good; for inj in "0 0 1 a[\$(touch /tmp/pwn8)] 0 0 0" "a[\$(touch /tmp/pwn9)] 0 0 - 0 a[\$(touch /tmp/pwn10)] 1"; do echo "$((NOW - 3600)) 0 0 0 $inj" >/scn/metrics; run; done
ls /tmp/pwn* >/dev/null 2>&1 && no "P16 enjeksiyon: $(ls /tmp/pwn*)" || ok "S14-2: P16 metrik alanlarında a[\$(…)] komut çalıştırmadı"
good; run
# P18 H5 (mimari-e11 §8b.13 T2/T4/T12; runbook §25.4): alanlar 12-15 = decrypt calendar tenant-kova mesaj(P18 işareti)
p18() { echo "$((NOW - 3600)) 0 0 0 0 0 0 - $((NOW - 3600)) 0 0 $1" >/scn/metrics; }
clr() { sed -i -E '/^(decrypt_fail|calendar_fallback|msg_tenant_rate)=/d' /var/lib/rw/state; }
p18a() { grep -q "ALERT check=$1" /out/o && alerted "$1"; }
p18n() { ! grep -q "ALERT check=$1" /out/o; }
good; clr; p18 "0 0 - 5"; run
p18n 'p18-metrics\|crypto-decrypt\|calendar-fallback\|msg-tenant-rate' && grep -q 'check="crypto-decrypt"} 1' /var/lib/rw/status.prom \
  && grep -q 'check="msg-tenant-rate"} 1' /var/lib/rw/status.prom && ok "P18 server temiz -> 4 P18 kontrolü OK, alarm yok" || no "p18 temiz: $(cat /out/o)"
clr; p18 "2 0 - 5"; run
p18a crypto-decrypt && grep -q 'rs_crypto_decrypt_failures_total=2' /out/o && ok "S-P18-T2c: decrypt hata > 0 (ilk tur) -> ALERT crypto-decrypt" || no "decrypt: $(cat /out/o)"
run; grep -q 'ALERT check=crypto-decrypt' /out/o && ok "decrypt sayaç > 0 sürdükçe alarm sürer (journal; tekrar bastırılır)" || no "decrypt sürer: $(cat /out/o)"
sed -i "s/^decrypt_fail=.*/decrypt_fail=2 $((NOW - 90000))/" /var/lib/rw/state; p18 "0 0 - 5"; run
p18n crypto-decrypt && ok "decrypt: sayaç 0 (yeniden başladı) ve artıştan 24 sa sonra alarm kalktı" || no "decrypt 24h: $(cat /out/o)"
sed -i "s/^decrypt_fail=.*/decrypt_fail=0 $((NOW - 90000))/" /var/lib/rw/state; p18 "0 0 - 5"; run
p18n crypto-decrypt && ok "decrypt: 0 -> 0 alarm yok" || no "decrypt 0: $(cat /out/o)"
clr; p18 "0 0 - 5"; run; p18 "0 1 - 5"; run
p18a calendar-fallback && ok "S-P18-T12: rs_calendar_fallback_total arttı -> ALERT calendar-fallback" || no "calendar: $(cat /out/o)"
sed -i "s/^calendar_fallback=.*/calendar_fallback=1 $((NOW - 90000))/" /var/lib/rw/state; run
p18n calendar-fallback && ok "takvim düşüşü: artış yok ve 24 sa geçti -> alarm kalktı" || no "calendar 24h: $(cat /out/o)"
clr; p18 "0 3 - 5"; run
p18a calendar-fallback && ok "takvim: önceki örnek yok + sayaç > 0 -> taban 0, ALERT (sessiz kalmaz)" || no "calendar ilk: $(cat /out/o)"
clr; p18 "0 0 - 5"; run; p18 "0 0 4 5"; run
p18a msg-tenant-rate && ok "S-P18-T4: firma müşteri mesajı kovası reddi (queue.alert) -> ALERT msg-tenant-rate" || no "tenant kova: $(cat /out/o)"
sed -i "s/^msg_tenant_rate=.*/msg_tenant_rate=4 $((NOW - 3700))/" /var/lib/rw/state; run
p18n msg-tenant-rate && ok "kova: artıştan 1 sa sonra alarm kalktı" || no "kova 1h: $(cat /out/o)"
clr; p18 "- - - 5"; run
p18a p18-metrics && grep -q 'rs_crypto_decrypt_failures_total,rs_calendar_fallback_total' /out/o && ok "P18 server, decrypt/takvim metriği yok -> ALERT p18-metrics (fail-closed)" || no "p18-metrics: $(cat /out/o)"
clr; p18 "- - - -"; run
! grep -q 'p18-metrics\|crypto-decrypt' /var/lib/rw/status.prom && p18n p18-metrics && ok "P18 öncesi server (rs_request_messages_total yok) -> P18 kontrolleri yok" || no "p17: $(cat /out/o)"
clr; p18 'a[$(touch /tmp/pwn11)] a[$(touch /tmp/pwn12)] a[$(touch /tmp/pwn13)] 5'; run
sed -i 's/^decrypt_fail=.*/decrypt_fail=a[$(touch \/tmp\/pwn14)] 1/' /var/lib/rw/state; p18 "1 0 - 5"; run
ls /tmp/pwn* >/dev/null 2>&1 && no "P18 enjeksiyon: $(ls /tmp/pwn*)" || ok "S14-2: P18 metrik/durum alanlarında a[\$(…)] komut çalıştırmadı"
good; clr; run
# P19 J6 (mimari-e11 §8c.3/§8c.7, S-P19-12/T6; runbook §26.2): alanlar 16-21 = outbox-toplam outbox-failed en-eski-PENDING
# rate-limited sms-key-unreadable hacim(kanal=değer,…). 12-15 P18 temiz.
p19() { echo "$((NOW - 3600)) 0 0 0 0 0 0 - $((NOW - 3600)) 0 0 0 0 - 5 $1" >/scn/metrics; }
clr19() { sed -i -E '/^(notify_volume_since|sms_key_unreadable|notify_samples)=/d' /var/lib/rw/state; }
ns() { sed -i '/^notify_samples=/d' /var/lib/rw/state; echo "notify_samples=$1" >>/var/lib/rw/state; }
good; clr; clr19; p19 "10 0 3 0 0 SMS=10,WHATSAPP=5"; run
p18n 'p19-metrics\|notify-\|sms-key' && grep -q 'check="notify-volume"} 1' /var/lib/rw/status.prom && grep -q 'check="sms-key-unreadable"} 1' /var/lib/rw/status.prom \
  && ok "P19 server temiz -> 5 P19 kontrolü OK, alarm yok" || no "p19 temiz: $(cat /out/o)"
clr19; p19 "10 0 61 0 0 -"; run
p18a notify-outbox-pending && grep -q 'en eski PENDING bildirim 61 sn' /out/o && ok "outbox en eski PENDING 61 sn -> ALERT notify-outbox-pending" || no "pending: $(cat /out/o)"
clr19; p19 "10 0 60 0 0 -"; run
p18n notify-outbox-pending && ok "en eski PENDING 60 sn -> alarm yok (eşik > 60)" || no "pending 60: $(cat /out/o)"
clr19; ns "$((NOW - 1200)):10:0:0"; p19 "20 6 0 0 0 -"; run
p18a notify-outbox-failed && grep -q 'FAILED 6 / 10' /out/o && ok "15 dk'da FAILED 6/10 (> %50) -> ALERT notify-outbox-failed" || no "failed oran: $(cat /out/o)"
clr19; ns "$((NOW - 1200)):10:0:0"; p19 "20 5 0 0 0 -"; run
p18n notify-outbox-failed && ok "FAILED 5/10 (= %50) -> alarm yok" || no "failed %50: $(cat /out/o)"
clr19; ns "$((NOW - 1200)):10:0:0"; p19 "12 2 0 0 0 -"; run
p18n notify-outbox-failed && ok "FAILED 2/2 ama < WATCH_NOTIFY_FAIL_MIN (3) -> alarm yok" || no "failed min: $(cat /out/o)"
clr19; ns "$((NOW - 1200)):10:0:0"; p19 "12 2 0 0 0 -"; WATCH_NOTIFY_FAIL_MIN=1 run
p18a notify-outbox-failed && ok "WATCH_NOTIFY_FAIL_MIN=1 -> FAILED 2/2 ALERT (tasarımın yalın kuralı)" || no "failed min1: $(cat /out/o)"
clr19; ns "$((NOW - 1200)):50:0:0"; p19 "9 8 0 0 0 -"; run
grep -q 'ALERT check=notify-outbox-failed.*FAILED 8 / 9' /out/o && ok "süreç yeniden başladı (toplam 50 -> 9, FAILED 0 -> 8) -> yeni değerler artış sayıldı, ALERT" || no "restart: $(cat /out/o)"
clr19; ns "$((NOW - 1200)):0:0:5"; p19 "0 0 0 25 0 -"; run
p18a notify-volume && grep -q 'rs_notify_rate_limited_total +20' /out/o && ok "S-P19-12: 15 dk'da rate_limited +20 -> ALERT notify-volume" || no "rl: $(cat /out/o)"
clr19; ns "$((NOW - 1200)):0:0:5"; p19 "0 0 0 24 0 -"; run
p18n notify-volume && ok "rate_limited +19 -> alarm yok" || no "rl 19: $(cat /out/o)"
clr19; p19 "0 0 0 0 0 role_SMS_x=1,SMS=79,WHATSAPP=47,EMAIL=79"; run; run
p18n notify-volume && ok "hacim SMS 79/100, WA 47/60, EMAIL 79/100 (< %80) iki tur -> alarm yok" || no "vol alt: $(cat /out/o)"
clr19; p19 "0 0 0 0 0 WHATSAPP=48"; run
p18n notify-volume && grep -q '^notify_volume_since=[0-9]' /var/lib/rw/state && ok "hacim WA 48/60 ilk tur -> henüz alarm yok (10 dk boyunca şartı)" || no "vol ilk: $(cat /out/o)"
sed -i "s/^notify_volume_since=.*/notify_volume_since=$((NOW - 600))/" /var/lib/rw/state; run
p18a notify-volume && grep -q 'WHATSAPP=48/60' /out/o && ok "S-P19-12: hacim >= %80 10 dk boyunca -> ALERT notify-volume" || no "vol 10dk: $(cat /out/o)"
p19 "0 0 0 0 0 WHATSAPP=10"; run
p18n notify-volume && grep -q '^notify_volume_since=$' /var/lib/rw/state && ok "hacim düştü -> alarm kalktı, süre sıfırlandı" || no "vol düştü: $(cat /out/o)"
clr19; p19 "0 0 0 0 0 sms=80"; sed -i '/^notify_volume_since=/d' /var/lib/rw/state; echo "notify_volume_since=$((NOW - 600))" >>/var/lib/rw/state; run
p18a notify-volume && ok "kanal etiketi küçük harf (sms=80) -> büyük harfe çevrildi, ALERT" || no "vol küçük: $(cat /out/o)"
clr19; p19 "0 0 0 0 0 SMS=40"; sed -i '/^notify_volume_since=/d' /var/lib/rw/state; echo "notify_volume_since=$((NOW - 600))" >>/var/lib/rw/state; WATCH_NOTIFY_CAPS="SMS:50 WHATSAPP:60 EMAIL:100" run
grep -q 'ALERT check=notify-volume.*SMS=40/50' /out/o && ok "WATCH_NOTIFY_CAPS=SMS:50 -> 40/50 = %80 ALERT" || no "caps: $(cat /out/o)"
WATCH_NOTIFY_CAPS="SMS=50" run; [ "$RC" = 1 ] && grep -q 'WATCH_NOTIFY_CAPS biçimi' /out/o && ok "WATCH_NOTIFY_CAPS biçim hatası -> çalışmaz" || no "caps biçim: rc=$RC"
clr19; p19 "0 0 0 0 0 -"; run; p19 "0 0 0 0 2 -"; run
p18a sms-key-unreadable && ok "S-P19-T6: rs_sms_key_unreadable_total arttı -> ALERT sms-key-unreadable (crypto-decrypt değil)" || no "smskey: $(cat /out/o)"
p18n crypto-decrypt && ok "SMS anahtarı uyarısı P18 crypto-decrypt alarmını tetiklemez" || no "smskey/decrypt: $(cat /out/o)"
sed -i "s/^sms_key_unreadable=.*/sms_key_unreadable=2 $((NOW - 90000))/" /var/lib/rw/state; run
p18n sms-key-unreadable && ok "SMS anahtarı: artıştan 24 sa sonra alarm kalktı" || no "smskey 24h: $(cat /out/o)"
clr19; p19 "0 0 0 0 3 -"; run
p18a sms-key-unreadable && ok "SMS anahtarı: ilk P19 turunda sayaç > 0 -> taban 0, ALERT (sessiz kalmaz)" || no "smskey ilk: $(cat /out/o)"
clr19; p19 "0 - - 0 - -"; run
p18a p19-metrics && grep -q 'rs_notify_outbox_oldest_pending_seconds,rs_sms_key_unreadable_total' /out/o && ok "P19 server, zorunlu gösterge/sayaç yok -> ALERT p19-metrics (fail-closed)" || no "p19-metrics: $(cat /out/o)"
clr19; p19 "- - - - - -"; run
! grep -q 'p19-metrics\|notify-' /var/lib/rw/status.prom && ! grep -q '^notify_samples=[0-9]' /var/lib/rw/state && ok "P19 öncesi server (rs_notify_outbox_total yok) -> P19 kontrolleri ve örnek yok" || no "p18 server: $(cat /out/o)"
clr19; p19 'a[$(touch /tmp/pwn15)] a[$(touch /tmp/pwn16)] a[$(touch /tmp/pwn17)] 0 0 SMS=a[$(touch /tmp/pwn18)]'; run
p19 '1 0 0 0 0 -'; ns 'a[$(touch /tmp/pwn19)]:1:1:1'; sed -i '/^notify_volume_since=/d;/^sms_key_unreadable=/d' /var/lib/rw/state
printf 'notify_volume_since=a[$(touch /tmp/pwn20)]\nsms_key_unreadable=a[$(touch /tmp/pwn21)] 1\n' >>/var/lib/rw/state; p19 '1 0 0 0 1 SMS=90'; run
ls /tmp/pwn* >/dev/null 2>&1 && no "P19 enjeksiyon: $(ls /tmp/pwn*)" || ok "S14-2: P19 metrik/durum alanlarında a[\$(…)] komut çalıştırmadı"
good; clr; clr19; run
cp /le/$H/fullchain.pem /tmp/web.bak
neg 'cert:web' "cp /tc/short.crt /le/$H/fullchain.pem"
cp /tmp/web.bak /le/$H/fullchain.pem
neg 'cert:turn-le' "mv /le/remote-turn/fullchain.pem /le/remote-turn/keep.pem"
mv /le/remote-turn/keep.pem /le/remote-turn/fullchain.pem
neg 'cert:turn-served' "srv /tc/short.crt"
neg 'cert:turn-served' "srv /tc/other.crt"
neg 'cert:turn-served' "kill \$(cat /run/srv.pid)"
neg 'disk:/' "export WATCH_DISK_MAX_PCT=1"; unset WATCH_DISK_MAX_PCT
neg systemd-failed "echo 'remote-backup.service loaded failed failed Remote' >/scn/failed"
neg tree-perms "touch /opt/tree/deploy/x.sh; chmod 0666 /opt/tree/deploy/x.sh"
rm -f /opt/tree/deploy/x.sh
neg tree-perms "touch /opt/tree/deploy/y.sh; chown 1000 /opt/tree/deploy/y.sh"
rm -f /opt/tree/deploy/y.sh; good; run
neg tree-perms "touch /opt/tree/deploy/z.sh; chgrp 1000 /opt/tree/deploy/z.sh; chmod 0664 /opt/tree/deploy/z.sh"
rm -f /opt/tree/deploy/z.sh
# 3) G-P13b-7: sır içeren komut çalıştırılmaz
good; run
WATCH_ALERT_CMD='touch /out/RAN; curl -s https://api.telegram.org/bot123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/sendMessage' bash $W run >/out/o 2>&1
grep -q 'ALERT check=alert-cmd-unsafe' /out/o && [ ! -e /out/RAN ] && ! grep -q 'AAAAAAAAAAAA' /out/o \
  && ok "Telegram token'lı alarm komutu -> ALERT alert-cmd-unsafe, komut çalışmadı, token loga düşmedi" || no "unsafe: $(cat /out/o)"
WATCH_ALERT_CMD="touch /out/RAN; curl -H 'x-api-key: abc' http://x" bash $W run >/out/o 2>&1
grep -q 'alert-cmd-unsafe' /out/o && [ ! -e /out/RAN ] && ok "x-api-key başlıklı komut çalıştırılmadı" || no "x-api-key: $(cat /out/o)"
good; run
# 4) Site dışı yapılandırılmamış -> hatırlatma (alarm değil), 7 günde bir
sed -i 's/^remote_backup_offsite_configured .*/remote_backup_offsite_configured 0/' /scn/status.prom
run
grep -q '^remote-watch: OK' /out/o && grep -q 'offsite-unconfigured' /out/o && alerted 'HATIRLATMA site-disi' && ok "site dışı yok -> durum OK + hatırlatma" || no "hatırlatma: $(cat /out/o) / $(cat /out/alerts)"
run
[ ! -s /out/alerts ] && ok "hatırlatma 7 gün içinde tekrarlanmadı" || no "hatırlatma tekrar: $(cat /out/alerts)"
sed -i "s/^offsite_remind=.*/offsite_remind=$((NOW - 8 * 86400))/" /var/lib/rw/state
run
alerted 'HATIRLATMA' && ok "7 gün sonra hatırlatma yeniden" || no "hatırlatma 7 gün: $(cat /out/alerts)"
good
# 5) watch.env güvenliği
chmod 644 /etc/rw/watch.env; echo 1 >/scn/ready_rc; run
[ "$RC" = 1 ] && grep -q 'izni 600 olmalı' /out/o && [ ! -s /out/alerts ] && ok "watch.env 644 -> çalışmaz (rc=1, alarm komutu yok)" || no "644: rc=$RC $(cat /out/o)"
chmod 600 /etc/rw/watch.env; chown 1000 /etc/rw/watch.env; run
[ "$RC" = 1 ] && ok "watch.env sahibi root değil -> çalışmaz" || no "owner: rc=$RC"
chown 0 /etc/rw/watch.env; ln -s /etc/rw/watch.env /etc/rw/link.env
WATCH_ENV_FILE=/etc/rw/link.env bash $W run >/out/o 2>&1; RC=$?
[ "$RC" = 1 ] && grep -q 'normal dosya değil' /out/o && ok "watch.env sembolik bağlantı -> çalışmaz" || no "symlink: rc=$RC"
good; run
# 5b) P13c ikinci örnek (stg): ayrı env/durum, kendi zamanlayıcısı, coturn kontrolü yok, alarm adında [stg]
SH=stg.remote.test; mkc /le/$SH/fullchain.pem 90
cat >/etc/rw/stg.env <<E
WATCH_ALERT_CMD=cat >>/out/alerts
WATCH_PUBLIC_HOST=$SH
WATCH_LE_DIR=/le
E
chmod 600 /etc/rw/stg.env
srun() { : >/out/alerts; WATCH_ENV_FILE=/etc/rw/stg.env WATCH_STATE_DIR=/var/lib/rw-stg WATCH_TREE_DIR=/opt/tree bash $W run stg >/out/o 2>&1; RC=$?; }
good; printf 'remote-backup@stg.timer\n' >/scn/timers_active; echo unhealthy >/scn/turn_health; kill "$(cat /run/srv.pid)" 2>/dev/null
srun
[ "$RC" = 0 ] && grep -q '^remote-watch-stg: OK' /out/o && ! grep -q 'coturn\|turn-served\|turn-le' /var/lib/rw-stg/status.prom \
  && ok "stg: OK, journal etiketi remote-watch-stg, coturn/turn sertifika kontrolü yok (prod coturn'ü prod örneği izler)" || no "stg temiz: rc=$RC $(cat /out/o)"
grep -q 'check="timer:remote-backup@stg.timer"' /var/lib/rw-stg/status.prom && [ ! -e /var/lib/rw/status.prom.stg ] \
  && ok "stg: varsayılan zamanlayıcı remote-backup@stg.timer, durum ayrı dizinde" || no "stg timer: $(cat /var/lib/rw-stg/status.prom)"
echo 'remote-backup@stg.service loaded failed failed Remote' >/scn/failed; srun
grep -q 'ALERT check=systemd-failed remote-backup@stg.service' /out/o && alerted 'remote-watch\[stg\] .*: ALERT systemd-failed' \
  && ok "stg: kendi başarısız birimi -> ALERT, alarm metninde [stg]" || no "stg failed: $(cat /out/o) / $(cat /out/alerts)"
good; srv /tc/turn.crt; echo 'remote-backup@stg.service loaded failed failed Remote' >/scn/failed; run
! grep -q 'systemd-failed' /out/o && ok "prod örneği staging (@stg) birim hatasını saymaz" || no "prod stg birimi saydı: $(cat /out/o)"
sed -i '/^WATCH_PUBLIC_HOST=/d' /etc/rw/stg.env; srun
[ "$RC" = 1 ] && grep -q 'WATCH_PUBLIC_HOST zorunlu' /out/o && ok "stg: WATCH_PUBLIC_HOST yok -> çalışmaz (prod adına düşmez)" || no "stg host: rc=$RC $(cat /out/o)"
bash $W run 'Stg;x' >/out/o 2>&1; [ $? = 2 ] && ok "geçersiz örnek adı -> rc 2" || no "örnek adı: $(cat /out/o)"
good; run

# 6) install / uninstall (G-P13b-13)
# P28b K6 (mimari-p28b §7.3/§11.2; runbook §28b.4): alanlar 22-26 = rs_av_up rs_av_selftest_ok imza-yaşı-sn tarama-toplam tarama-başarısız.
pav() { echo "$((NOW - 3600)) 0 0 0 0 0 0 - $((NOW - 3600)) 0 0 0 0 - 5 10 0 3 0 0 - $1" >/scn/metrics; }
clrav() { sed -i -E '/^(av_down|av_samples)=/d' /var/lib/rw/state; }
avps() { printf 'clamav|running|Up 2 hours (healthy)|remote-clamav-1\nclamav-update|running|Up 2 hours (healthy)|remote-clamav-update-1\n' >>/scn/ps; }
avs() { sed -i '/^av_samples=/d' /var/lib/rw/state; echo "av_samples=$1" >>/var/lib/rw/state; }
good; clr; clr19; clrav; run
! grep -q 'check="av-' /var/lib/rw/status.prom && ! grep -q 'compose:clamav' /var/lib/rw/status.prom && ok "P28b öncesi (rs_av_* yok, clamav yok) -> AV kontrolleri yok" || no "p28b öncesi: $(cat /out/o)"
good; avps; clrav; pav "1 1 3600 10 0"; run
p18n 'av-\|compose:clamav' && grep -q 'check="av-up"} 1' /var/lib/rw/status.prom && grep -q 'check="compose:clamav-update"} 1' /var/lib/rw/status.prom \
  && ok "P28b temiz -> av-* ve compose:clamav* OK, alarm yok" || no "av temiz: $(cat /out/o)"
good; avps; clrav; pav "0 1 3600 10 0"; run
p18n av-up && ok "rs_av_up=0 tek yoklama -> alarm yok (reload penceresi)" || no "av-up 1: $(cat /out/o)"
pav "0 1 3600 10 0"; run
p18a av-up && grep -q 'ardışık 2 yoklama' /out/o && ok "rs_av_up=0 ardışık 2 yoklama -> ALERT av-up" || no "av-up 2: $(cat /out/o)"
pav "1 1 3600 10 0"; run; pav "0 1 3600 10 0"; run
p18n av-up && ok "araya rs_av_up=1 girince sayaç sıfırlandı" || no "av-up reset: $(cat /out/o)"
good; avps; clrav; pav "1 0 3600 10 0"; run
p18a av-selftest && ok "rs_av_selftest_ok=0 -> anında ALERT av-selftest" || no "selftest: $(cat /out/o)"
good; avps; clrav; pav "1 1 $((3 * 86400 + 60)) 10 0"; run
p18a av-signature-age && ok "imza yaşı > 3 gün -> ALERT av-signature-age" || no "age: $(cat /out/o)"
good; avps; clrav; pav "1 1 $((3 * 86400)) 10 0"; run
p18n av-signature-age && ok "imza yaşı = 3 gün -> alarm yok" || no "age 3: $(cat /out/o)"
good; avps; clrav; avs "$((NOW - 1800)):10:0"; pav "1 1 3600 30 6"; run
p18a av-scan-failed && grep -q 'taranamadı 6 / 20' /out/o && ok "1 sa'te taranamadı 6/20 (> %20) -> ALERT av-scan-failed" || no "scan failed: $(cat /out/o)"
good; avps; clrav; avs "$((NOW - 1800)):10:0"; pav "1 1 3600 40 6"; run
p18n av-scan-failed && ok "taranamadı 6/30 (= %20) -> alarm yok" || no "scan 20: $(cat /out/o)"
good; avps; clrav; avs "$((NOW - 1800)):10:0"; pav "1 1 3600 14 4"; run
p18n av-scan-failed && ok "taranamadı 4/4 ama < WATCH_AV_FAIL_MIN (5) -> alarm yok" || no "scan min: $(cat /out/o)"
good; clrav; pav "1 1 3600 10 0"; run
p18a 'compose:clamav' && ok "prod (AV_CHECKS=1): P28b metrikleri var, clamav konteyneri yok -> ALERT compose:clamav" || no "ctr yok: $(cat /out/o)"
good; clrav; pav "0 1 3600 10 0"; WATCH_AV_CHECKS=auto run; pav "0 1 3600 10 0"; WATCH_AV_CHECKS=auto run
p18n 'av-up\|compose:clamav' && ok "auto (staging, av profili kapalı): konteyner yok -> AV alarmı yok" || no "auto: $(cat /out/o)"
good; avps; clrav; run
p18a av-metrics && ok "clamav konteyneri var, rs_av_* yok -> ALERT av-metrics" || no "av-metrics: $(cat /out/o)"
good; avps; clrav; pav "a[\$(touch /tmp/pwn20)] 1 a[\$(touch /tmp/pwn21)] 10 0"; run; avs 'a[$(touch /tmp/pwn22)]:1:1'; pav "1 1 1 10 0"; run
ls /tmp/pwn2* >/dev/null 2>&1 && no "P28b enjeksiyon: $(ls /tmp/pwn2*)" || ok "S14-2: P28b metrik/durum alanlarında a[\$(…)] komut çalıştırmadı"
good; clrav; run

# P28u K8 (mimari-p28u §9.4; runbook §28u.6): alanlar 27-31 = notify-toplam(işaret) notify-fail silent-ok onay-toplam onay-timeout.
pua() { echo "$((NOW - 3600)) 0 0 0 0 0 0 - $((NOW - 3600)) 0 0 0 0 - 5 10 0 3 0 0 - - - - - - $1" >/scn/metrics; }
clrua() { sed -i -E '/^(ua_notify_fail|ua_samples)=/d' /var/lib/rw/state; }
uas() { sed -i '/^ua_samples=/d' /var/lib/rw/state; echo "ua_samples=$1" >>/var/lib/rw/state; }
good; clrua; run
! grep -q 'check="unattended-' /var/lib/rw/status.prom && ok "P28u öncesi (rs_unattended_silent_notify_total yok) -> unattended-* kontrolleri yok" || no "p28u öncesi: $(cat /out/o)"
good; clrua; pua "0 - - - -"; run
p18n 'unattended-' && grep -q 'check="unattended-notify-fail"} 1' /var/lib/rw/status.prom && grep -q 'check="unattended-consent-timeout"} 1' /var/lib/rw/status.prom \
  && ok "P28u temiz (etiketli seriler yok -> 0) -> unattended-* OK, alarm yok" || no "ua temiz: $(cat /out/o)"
good; clrua; pua "2 1 0 0 0"; run
p18a unattended-notify-fail && grep -q 'dört göz e-postası 3 denemede gitmedi' /out/o && ok "dört göz e-postası fail (ilk P28u turu, taban 0) -> ALERT unattended-notify-fail" || no "notify fail: $(cat /out/o)"
pua "2 1 0 0 0"; run
grep -q "ALERT check=unattended-notify-fail" /out/o && ok "fail artışından sonra 24 sa içinde alarm sürer (journal; tekrar bildirimi bastırılır)" || no "notify fail sürer: $(cat /out/o)"
sed -i "s/^ua_notify_fail=.*/ua_notify_fail=1 $((NOW - 86400))/" /var/lib/rw/state; pua "2 1 0 0 0"; run
p18n unattended-notify-fail && ok "artış yok ve 24 sa geçti -> alarm kalktı" || no "notify fail 24h: $(cat /out/o)"
good; clrua; uas "$((NOW - 1800)):0:0:0"; pua "0 - 6 0 0"; run
p18a unattended-silent-volume && grep -q 'izinsiz (silent) bağlantı +6' /out/o && ok "1 sa'te izinsiz bağlantı +6 (> 5) -> ALERT unattended-silent-volume" || no "silent vol: $(cat /out/o)"
good; clrua; uas "$((NOW - 1800)):0:0:0"; pua "0 - 5 0 0"; run
p18n unattended-silent-volume && ok "izinsiz bağlantı +5 (= eşik) -> alarm yok" || no "silent 5: $(cat /out/o)"
good; clrua; uas "$((NOW - 7200)):0:0:0 $((NOW - 4000)):3:0:0"; pua "0 - 8 0 0"; run
p18n unattended-silent-volume && ok "son 1 sa'te +5 (önceki saatteki +3 pencere dışında) -> alarm yok" || no "silent pencere: $(cat /out/o)"
good; clrua; uas "$((NOW - 40000)):0:0:0"; pua "0 - 0 6 4"; run
p18a unattended-consent-timeout && grep -q 'yanıtsız 4 / 6' /out/o && ok "24 sa'te onay zaman aşımı 4/6 (> %50) -> ALERT unattended-consent-timeout (bilgi)" || no "timeout: $(cat /out/o)"
good; clrua; uas "$((NOW - 40000)):0:0:0"; pua "0 - 0 6 3"; run
p18n unattended-consent-timeout && ok "zaman aşımı 3/6 (= %50) -> alarm yok" || no "timeout 50: $(cat /out/o)"
good; clrua; uas "$((NOW - 40000)):0:0:0"; pua "0 - 0 2 2"; run
p18n unattended-consent-timeout && ok "zaman aşımı 2/2 ama < WATCH_UA_TIMEOUT_MIN (3) -> alarm yok" || no "timeout min: $(cat /out/o)"
good; clrua; uas "$((NOW - 100000)):0:0:0 $((NOW - 600)):0:0:0"; pua "0 - 0 0 0"; run
! grep -q "ua_samples=.*$((NOW - 100000)):" /var/lib/rw/state && ok "25 sa'ten eski P28u örneği atıldı" || no "ua örnek budama: $(grep ua_samples /var/lib/rw/state)"
good; clrua; pua 'a[$(touch /tmp/pwn30)] a[$(touch /tmp/pwn31)] a[$(touch /tmp/pwn32)] 0 0'; run; uas 'a[$(touch /tmp/pwn33)]:1:1:1'; pua "0 0 1 1 1"; run
ls /tmp/pwn3* >/dev/null 2>&1 && no "P28u enjeksiyon: $(ls /tmp/pwn3*)" || ok "S14-2: P28u metrik/durum alanlarında a[\$(…)] komut çalıştırmadı"
good; clrua; run

# P28e K8 (mimari-p28e §11.3; runbook §28e.6): alanlar 32-36 = parça-toplam(işaret) parça-red stop-toplam stop-error izleme-429.
prec() { echo "$((NOW - 3600)) 0 0 0 0 0 0 - $((NOW - 3600)) 0 0 0 0 - 5 10 0 3 0 0 - - - - - - - - - - - $1" >/scn/metrics; }
clrrec() { sed -i '/^rec_samples=/d' /var/lib/rw/state; }
recs() { sed -i '/^rec_samples=/d' /var/lib/rw/state; echo "rec_samples=$1" >>/var/lib/rw/state; }
good; clrrec; run
! grep -q 'check="rec-' /var/lib/rw/status.prom && ok "P28e öncesi (rs_rec_part_total yok) -> rec-* kontrolleri yok" || no "p28e öncesi: $(cat /out/o)"
good; clrrec; prec "0 - - - -"; run
p18n 'rec-' && grep -q 'check="rec-stop-error"} 1' /var/lib/rw/status.prom && grep -q 'check="rec-view-throttled"} 1' /var/lib/rw/status.prom \
  && ok "P28e temiz (etiketli seriler yok -> 0) -> rec-* OK, alarm yok" || no "rec temiz: $(cat /out/o)"
good; clrrec; recs "$((NOW - 1800)):0:0:0:0:0"; prec "0 0 10 3 0"; run
p18a rec-stop-error && grep -q 'error ile durdu 3 / 10' /out/o && ok "1 sa'te error 3/10 (> %20) -> ALERT rec-stop-error" || no "stop err: $(cat /out/o)"
good; clrrec; recs "$((NOW - 1800)):0:0:0:0:0"; prec "0 0 15 3 0"; run
p18n rec-stop-error && ok "error 3/15 (= %20) -> alarm yok" || no "stop err 20: $(cat /out/o)"
good; clrrec; recs "$((NOW - 1800)):0:0:0:0:0"; prec "0 0 2 2 0"; run
p18n rec-stop-error && ok "error 2/2 ama < WATCH_REC_ERR_MIN (3) -> alarm yok" || no "stop err min: $(cat /out/o)"
good; clrrec; recs "$((NOW - 7200)):0:0:0:0:0 $((NOW - 4000)):0:0:10:10:0"; prec "0 0 20 12 0"; run
p18n rec-stop-error && ok "son 1 sa'te error 2/10 (önceki saatteki 10/10 pencere dışında) -> alarm yok" || no "stop err pencere: $(cat /out/o)"
good; clrrec; recs "$((NOW - 600)):100:0:0:0:0"; prec "200 11 0 0 0"; run
p18a rec-part-rejected && grep -q 'reddedilen kayıt parçası +11' /out/o && ok "10 dk'da reddedilen parça +11 (> 10) -> ALERT rec-part-rejected" || no "part bad: $(cat /out/o)"
good; clrrec; recs "$((NOW - 600)):100:0:0:0:0"; prec "200 10 0 0 0"; run
p18n rec-part-rejected && ok "reddedilen parça +10 (= eşik) -> alarm yok" || no "part bad 10: $(cat /out/o)"
good; clrrec; recs "$((NOW - 1800)):0:0:0:0:0"; prec "0 0 0 0 51"; run
p18a rec-view-throttled && grep -q 'çekiş bütçesi aşımı +51' /out/o && ok "1 sa'te izleme 429 +51 (> 50) -> ALERT rec-view-throttled" || no "view thr: $(cat /out/o)"
good; clrrec; recs "$((NOW - 1800)):0:0:0:0:0"; prec "0 0 0 0 50"; run
p18n rec-view-throttled && ok "izleme 429 +50 (= eşik) -> alarm yok" || no "view thr 50: $(cat /out/o)"
good; clrrec; recs "$((NOW - 6000)):0:0:0:0:0 $((NOW - 600)):0:0:0:0:0"; prec "0 0 0 0 0"; run
! grep -q "rec_samples=.*$((NOW - 6000)):" /var/lib/rw/state && ok "90 dk'dan eski P28e örneği atıldı" || no "rec örnek budama: $(grep rec_samples /var/lib/rw/state)"
good; clrrec; prec 'a[$(touch /tmp/pwn40)] a[$(touch /tmp/pwn41)] 0 a[$(touch /tmp/pwn42)] 0'; run; recs 'a[$(touch /tmp/pwn43)]:1:1:1:1:1'; prec "0 0 1 1 1"; run
ls /tmp/pwn4* >/dev/null 2>&1 && no "P28e enjeksiyon: $(ls /tmp/pwn4*)" || ok "S14-2: P28e metrik/durum alanlarında a[\$(…)] komut çalıştırmadı"
good; clrrec; run

# P28c K4 (mimari-p28c §8; runbook §28c.6): alan 37 = rs_multi_denied_total (bütün type; etiketsiz "… 0" = P28c işareti).
pmd() { echo "$((NOW - 3600)) 0 0 0 0 0 0 - $((NOW - 3600)) 0 0 0 0 - 5 10 0 3 0 0 - - - - - - - - - - - - - - - - $1" >/scn/metrics; }
clrmd() { sed -i '/^multi_samples=/d' /var/lib/rw/state; }
mds() { sed -i '/^multi_samples=/d' /var/lib/rw/state; echo "multi_samples=$1" >>/var/lib/rw/state; }
good; clrmd; run
! grep -q 'check="multi-denied"' /var/lib/rw/status.prom && ok "P28c öncesi (rs_multi_denied_total yok) -> multi-denied kontrolü yok" || no "p28c öncesi: $(cat /out/o)"
good; clrmd; pmd 0; run
p18n multi-denied && grep -q 'check="multi-denied"} 1' /var/lib/rw/status.prom && ok "P28c temiz (etiketsiz 0) -> multi-denied OK" || no "md temiz: $(cat /out/o)"
# Tohumsuz iki ardışık koşu: betiğin örneği DURUMA yazdığını da kanıtlar (yazmasaydı ikinci koşuda artış görülmezdi).
good; clrmd; pmd 0; run; grep -q "^multi_samples=[0-9]*:0$" /var/lib/rw/state && ok "multi_samples durum anahtarına yazıldı" \
  || no "md durum: $(grep multi_samples /var/lib/rw/state)"
pmd 21; run
p18a multi-denied && grep -q 'rol kapısı reddi +21' /out/o && ok "tohumsuz taban 0 -> 21 (> 20) -> ALERT multi-denied" || no "md artış: $(cat /out/o)"
good; clrmd; mds "$((NOW - 1800)):0"; pmd 20; run
p18n multi-denied && ok "1 sa'te ret +20 (= eşik) -> alarm yok" || no "md 20: $(cat /out/o)"
good; clrmd; mds "$((NOW - 7200)):0 $((NOW - 4000)):100"; pmd 110; run
p18n multi-denied && ok "son 1 sa'te ret +10 (önceki saatteki +100 pencere dışında) -> alarm yok" || no "md pencere: $(cat /out/o)"
good; clrmd; mds "$((NOW - 1800)):30"; pmd 25; run
p18a multi-denied && grep -q 'reddi +25' /out/o && ok "sayaç düştü (server yeniden başladı) -> yeni değer artış: +25 -> ALERT" || no "md restart: $(cat /out/o)"
good; clrmd; mds "$((NOW - 6000)):0 $((NOW - 600)):0"; pmd 0; run
! grep -q "multi_samples=.*$((NOW - 6000)):" /var/lib/rw/state && ok "90 dk'dan eski P28c örneği atıldı" || no "md budama: $(grep multi_samples /var/lib/rw/state)"
good; clrmd; pmd 'a[$(touch /tmp/pwn50)]'; run; mds 'a[$(touch /tmp/pwn51)]:1'; pmd 1; run
ls /tmp/pwn5* >/dev/null 2>&1 && no "P28c enjeksiyon: $(ls /tmp/pwn5*)" || ok "S14-2: P28c metrik/durum alanlarında a[\$(…)] komut çalıştırmadı"
good; clrmd; run

# P22-O (mimari-p22 §7.2; runbook §29.5): alan 38 = rs_session_chat_rejected_total (bütün reason; etiketsiz "… 0" = P22 işareti),
# alan 39 = {reason="internal"}. Durum anahtarı chat_internal="<son değer> <artış anı>".
psc() { echo "$((NOW - 3600)) 0 0 0 0 0 0 - $((NOW - 3600)) 0 0 0 0 - 5 10 0 3 0 0 - - - - - - - - - - - - - - - - 0 $1 $2" >/scn/metrics; }
clrsc() { sed -i '/^chat_internal=/d' /var/lib/rw/state; }
scs() { sed -i '/^chat_internal=/d' /var/lib/rw/state; echo "chat_internal=$1" >>/var/lib/rw/state; }
good; clrsc; run
! grep -q 'check="session-chat-internal"' /var/lib/rw/status.prom && ok "P22 öncesi (rs_session_chat_rejected_total yok) -> session-chat-internal kontrolü yok" || no "p22 öncesi: $(cat /out/o)"
good; clrsc; psc 0 -; run
p18n session-chat-internal && grep -q 'check="session-chat-internal"} 1' /var/lib/rw/status.prom && grep -q '^chat_internal=0 0$' /var/lib/rw/state \
  && ok "P22 temiz (etiketsiz 0, internal serisi yok) -> OK, durum 'chat_internal=0 0'" || no "sc temiz: $(cat /out/o) $(grep chat_internal /var/lib/rw/state)"
good; clrsc; psc 7 -; run
p18n session-chat-internal && ok "yalnız kullanıcı kaynaklı ret (rate/cap; internal yok) -> alarm yok" || no "sc rate: $(cat /out/o)"
good; clrsc; psc 3 1; run
p18a session-chat-internal && grep -q 'reason=internal}=1' /out/o && ok "ilk P22 turu taban 0 -> internal 1 -> ALERT session-chat-internal" || no "sc ilk: $(cat /out/o)"
good; scs "1 $((NOW - 1800))"; psc 3 1; run
grep -q "ALERT check=session-chat-internal" /out/o && ok "artış yok ama son artış 30 dk önce -> alarm sürer (1 sa; zaten bozuk -> yeniden gönderim bastırılır)" || no "sc 30dk: $(cat /out/o)"
good; scs "1 $((NOW - 4000))"; psc 3 1; run
p18n session-chat-internal && ok "son artıştan 1 sa geçti, yeni artış yok -> alarm kalktı" || no "sc 1sa: $(cat /out/o)"
good; scs "5 $((NOW - 4000))"; psc 2 2; run
p18a session-chat-internal && ok "sayaç düştü ama > 0 (server yeniden başladı, yeni hata) -> ALERT" || no "sc restart: $(cat /out/o)"
good; scs "5 $((NOW - 4000))"; psc 0 -; run
p18n session-chat-internal && ok "sayaç 0'a düştü (yeniden başladı, hata yok) -> alarm yok" || no "sc restart0: $(cat /out/o)"
good; clrsc; psc 'a[$(touch /tmp/pwn60)]' 'a[$(touch /tmp/pwn61)]'; run; scs 'a[$(touch /tmp/pwn62)] a[$(touch /tmp/pwn63)]'; psc 1 1; run
ls /tmp/pwn6* >/dev/null 2>&1 && no "P22 enjeksiyon: $(ls /tmp/pwn6*)" || ok "S14-2: P22 metrik/durum alanlarında a[\$(…)] komut çalıştırmadı"
good; clrsc; run

mkdir -p /src && cp /w/remote-watch.sh /w/remote-watch.service /w/remote-watch.timer /w/watch.env.example /src/
mkdir -p /etc/systemd/system
bash /src/remote-watch.sh install >/out/o 2>&1 && ok "install -> 0" || no "install: $(cat /out/o)"
[ "$(stat -c '%u %a' /usr/local/lib/remote/remote-watch.sh)" = "0 755" ] && ok "kurulu kopya /usr/local/lib/remote/remote-watch.sh root 0755" || no "kurulu kopya"
[ "$(stat -c '%u %a' /etc/remote-watch/watch.env)" = "0 600" ] && [ "$(stat -c '%a' /etc/remote-watch)" = 700 ] && ok "/etc/remote-watch 0700, watch.env 0600" || no "watch.env izin"
grep -q '^ExecStart=/usr/local/lib/remote/remote-watch.sh run' /etc/systemd/system/remote-watch.service && [ -f /etc/systemd/system/remote-watch.timer ] \
  && grep -q 'enable --now remote-watch.timer' /scn/systemctl.log && ok "birimler kuruldu, ExecStart kurulu kopya, timer etkin" || no "birimler"
WATCH_ENV_FILE=/etc/rw/watch.env WATCH_STATE_DIR=/tmp/xx WATCH_PUBLIC_HOST=$H WATCH_LE_DIR=/le /usr/local/lib/remote/remote-watch.sh run >/out/o 2>&1
[ -f /var/lib/remote-watch/status.prom ] && [ ! -e /tmp/xx ] && ok "kurulu kopya sabit durum dizini (WATCH_STATE_DIR yok sayıldı)" || no "kurulu kopya yollar"
cp /w/remote-watch@.service /w/remote-watch@.timer /src/
bash /src/remote-watch.sh install stg >/out/o 2>&1 && [ "$(stat -c '%u %a' /etc/remote-watch/stg.env)" = "0 600" ] \
  && grep -q '^ExecStart=/usr/local/lib/remote/remote-watch.sh run %i' /etc/systemd/system/remote-watch@.service \
  && grep -q 'enable --now remote-watch@stg.timer' /scn/systemctl.log && ok "install stg: şablon birimler, stg.env 600, remote-watch@stg.timer etkin" || no "install stg: $(cat /out/o)"
bash /src/remote-watch.sh uninstall stg >/dev/null 2>&1; grep -q 'disable --now remote-watch@stg.timer' /scn/systemctl.log && [ -f /usr/local/lib/remote/remote-watch.sh ] \
  && ok "uninstall stg: yalnız örnek zamanlayıcısı kapandı, prod kopyası kaldı" || no "uninstall stg"
bash /src/remote-watch.sh uninstall >/dev/null 2>&1
[ ! -e /usr/local/lib/remote/remote-watch.sh ] && [ ! -e /etc/systemd/system/remote-watch.timer ] && [ -f /etc/remote-watch/watch.env ] \
  && ok "uninstall: kopya + birimler silindi, watch.env korundu" || no "uninstall"
echo "SONUÇ-İÇ $F"
EOF
chmod 0755 "$TMP"; chmod 0644 "$TMP"/*
docker run --rm --name "$C" --user 0 -v "$HERE:/w:ro" -v "$TMP:/t:ro" alpine:3.20 sh -c 'apk add --no-cache bash >/dev/null 2>&1 && bash /t/inner.sh' \
  >"$TMP/out" 2>&1 || true
# Metrik ayrıştırma (gerçek /metrics metni; konteyner taslağı alanları hazır verdiği için ayrı): host node ile, fetch taslağı.
# G2 (P16): rs_retention_failures_total{class} etiketli -> bütün seriler toplanır; P16 göstergeleri ve devre kesici.
if command -v node >/dev/null 2>&1; then
  M="$TMP/metrics.txt"
  printf '%s\n' 'rs_retention_last_success_timestamp_seconds 1763000000' 'rs_retention_failures_total{class="db_signal"} 2' \
    'rs_retention_failures_total{class="other"} 1' 'rs_tenant_purge_jobs{role="SCHEDULED"} 1' 'rs_tenant_purge_jobs{state="FAILED"} 0' \
    'rs_tenant_purge_jobs{state="RUNNING"} 1' 'rs_tenant_purge_last_heartbeat_seconds 1763000100' \
    'rs_orphan_files_total{action="deleted"} 4' 'rs_orphan_files_total{action="circuit_open"} 3' 'rs_erasure_ledger_write_failed_total 0' >"$M"
  JS="$(sed -n 's/.*node -e "\(const sum=.*\)" 2>\/dev\/null)" || rt=.*/\1/p' "$HERE/remote-watch.sh" | sed 's/\\"/"/g')"
  got="$(M="$M" node -e "globalThis.fetch=async()=>({text:async()=>require('fs').readFileSync(process.env.M,'utf8')});$JS")"
  exp="1763000000 3 - - 1 0 1 1763000100 - 3 0 - - - - - - - - - - - - - - - - - - - - - - - - - - - -"
  if [ "$got" = "$exp" ]; then echo "PASS  metrik ayrıştırma: etiketli rs_retention_failures_total toplamı 3, SCHEDULED/RUNNING, circuit_open 3, P18 serisi yok -> '-'"
  else echo "FAIL  metrik ayrıştırma: '$got' (beklenen '$exp')"; echo "SONUÇ-İÇ 1" >>"$TMP/out"; fi
  # P18 H5: decrypt (bütün table), takvim (bütün tenant), yalnız reason~tenant kova reddi, mesaj sayacı (P18 işareti).
  printf '%s\n' 'rs_crypto_decrypt_failures_total{table="session_messages"} 2' 'rs_calendar_fallback_total{tenant="t1"} 1' \
    'rs_calendar_fallback_total{tenant="t2"} 2' 'rs_request_messages_rejected_total{reason="tenant_rate"} 4' \
    'rs_request_messages_rejected_total{reason="sender_cap"} 9' 'rs_request_messages_total{sender="CUSTOMER"} 7' >>"$M"
  got="$(M="$M" node -e "globalThis.fetch=async()=>({text:async()=>require('fs').readFileSync(process.env.M,'utf8')});$JS")"
  exp="1763000000 3 - - 1 0 1 1763000100 - 3 0 2 3 4 7 - - - - - - - - - - - - - - - - - - - - - - - -"
  if [ "$got" = "$exp" ]; then echo "PASS  metrik ayrıştırma P18: decrypt 2, takvim 1+2, tenant kova 4 (sender_cap hariç), mesaj 7"
  else echo "FAIL  metrik ayrıştırma P18: '$got' (beklenen '$exp')"; echo "SONUÇ-İÇ 1" >>"$TMP/out"; fi
  # P19 J6: outbox toplam (etiketsiz 0 dahil), FAILED (result=failed/FAILED), en eski PENDING (en büyük), rate_limited toplamı,
  # SMS anahtarı, hacim (Metrics.gauge {role=…} ve {channel=…} biçimleri).
  printf '%s\n' 'rs_notify_outbox_total{channel="SMS",result="sent"} 7' 'rs_notify_outbox_total{channel="SMS",result="failed"} 2' \
    'rs_notify_outbox_total{channel="EMAIL",result="FAILED"} 1' 'rs_notify_outbox_oldest_pending_seconds{channel="SMS"} 12.5' \
    'rs_notify_outbox_oldest_pending_seconds{channel="EMAIL"} 70' 'rs_notify_rate_limited_total{scope="tenant_channel",channel="SMS"} 4' \
    'rs_notify_rate_limited_total{scope="wa_bucket",channel="WHATSAPP"} 3' 'rs_sms_key_unreadable_total 0' \
    'rs_notify_tenant_max_hourly{role="SMS"} 81' 'rs_notify_tenant_max_hourly{channel="WHATSAPP"} 2' >>"$M"
  got="$(M="$M" node -e "globalThis.fetch=async()=>({text:async()=>require('fs').readFileSync(process.env.M,'utf8')});$JS")"
  exp="1763000000 3 - - 1 0 1 1763000100 - 3 0 2 3 4 7 10 3 70 7 0 SMS=81,WHATSAPP=2 - - - - - - - - - - - - - - - - - -"
  if [ "$got" = "$exp" ]; then echo "PASS  metrik ayrıştırma P19: outbox 10 (FAILED 3), en eski 70, rate_limited 7, anahtar 0, hacim SMS=81,WHATSAPP=2"
  else echo "FAIL  metrik ayrıştırma P19: '$got' (beklenen '$exp')"; echo "SONUÇ-İÇ 1" >>"$TMP/out"; fi
  # P28b K6: rs_av_up, öz-sınama, imza yaşı (en büyük), tarama toplamı ve yalnız result=failed_* toplamı.
  printf '%s\n' 'rs_av_up 1' 'rs_av_selftest_ok 1' 'rs_av_signature_age_seconds 7200.5' 'rs_av_scan_total{result="clean"} 10' \
    'rs_av_scan_total{result="infected"} 1' 'rs_av_scan_total{result="failed_busy"} 2' 'rs_av_scan_total{result="failed_timeout"} 3' >>"$M"
  got="$(M="$M" node -e "globalThis.fetch=async()=>({text:async()=>require('fs').readFileSync(process.env.M,'utf8')});$JS")"
  exp="1763000000 3 - - 1 0 1 1763000100 - 3 0 2 3 4 7 10 3 70 7 0 SMS=81,WHATSAPP=2 1 1 7200.5 16 5 - - - - - - - - - - - - -"
  if [ "$got" = "$exp" ]; then echo "PASS  metrik ayrıştırma P28b: av_up 1, öz-sınama 1, imza yaşı 7200.5, tarama 16 (failed_* 5)"
  else echo "FAIL  metrik ayrıştırma P28b: '$got' (beklenen '$exp')"; echo "SONUÇ-İÇ 1" >>"$TMP/out"; fi
  # P28u K8: notify toplam (etiketsiz 0 + etiketli), yalnız result="fail", connect mode=silent+result=ok (etiket sırası iki yönde;
  # ask/ok ve silent/forbidden hariç), onay toplamı ve yalnız decision="timeout".
  printf '%s\n' 'rs_unattended_silent_notify_total{result="ok"} 4' 'rs_unattended_silent_notify_total{result="fail"} 2' \
    'rs_unattended_connect_total{mode="silent",result="ok"} 3' 'rs_unattended_connect_total{result="ok",mode="silent"} 1' \
    'rs_unattended_connect_total{mode="ask",result="ok"} 9' 'rs_unattended_connect_total{mode="silent",result="forbidden"} 5' \
    'rs_unattended_consent_total{decision="granted"} 5' 'rs_unattended_consent_total{decision="timeout"} 2' >>"$M"
  got="$(M="$M" node -e "globalThis.fetch=async()=>({text:async()=>require('fs').readFileSync(process.env.M,'utf8')});$JS")"
  exp="1763000000 3 - - 1 0 1 1763000100 - 3 0 2 3 4 7 10 3 70 7 0 SMS=81,WHATSAPP=2 1 1 7200.5 16 5 6 2 4 7 2 - - - - - - - -"
  if [ "$got" = "$exp" ]; then echo "PASS  metrik ayrıştırma P28u: notify 6 (fail 2), silent ok 4 (ask/forbidden hariç), onay 7 (timeout 2)"
  else echo "FAIL  metrik ayrıştırma P28u: '$got' (beklenen '$exp')"; echo "SONUÇ-İÇ 1" >>"$TMP/out"; fi
  printf '%s\n' 'rs_unattended_silent_notify_total 0' >"$M.0"; sed -n '1,10p' "$M" >>"$M.0"
  got="$(M="$M.0" node -e "globalThis.fetch=async()=>({text:async()=>require('fs').readFileSync(process.env.M,'utf8')});$JS")"
  case "$got" in *" 0 - - - - - - - - - - - -") echo "PASS  metrik ayrıştırma P28u işareti: etiketsiz 'rs_unattended_silent_notify_total 0' -> 0, diğerleri '-'" ;;
    *) echo "FAIL  metrik ayrıştırma P28u işareti: '$got'"; echo "SONUÇ-İÇ 1" >>"$TMP/out" ;; esac
  # P28e K8: parça toplamı (histogram rs_rec_part_bytes_* ve rs_rec_bytes_total hariç), yalnız invalid|rate|busy, stop toplamı,
  # yalnız reason="error", izleme 429.
  printf '%s\n' 'rs_rec_part_total{result="ok"} 40' 'rs_rec_part_total{result="invalid"} 2' 'rs_rec_part_total{result="rate"} 1' \
    'rs_rec_part_total{result="busy"} 3' 'rs_rec_part_total{result="dup"} 5' 'rs_rec_part_bytes_bucket{le="65536"} 9' \
    'rs_rec_part_bytes_sum 123456' 'rs_rec_part_bytes_count 40' 'rs_rec_bytes_total 999999' 'rs_rec_stop_total{reason="error"} 2' \
    'rs_rec_stop_total{reason="session_end"} 7' 'rs_rec_view_throttled_total 4' >>"$M"
  got="$(M="$M" node -e "globalThis.fetch=async()=>({text:async()=>require('fs').readFileSync(process.env.M,'utf8')});$JS")"
  exp="1763000000 3 - - 1 0 1 1763000100 - 3 0 2 3 4 7 10 3 70 7 0 SMS=81,WHATSAPP=2 1 1 7200.5 16 5 6 2 4 7 2 51 6 9 2 4 - - -"
  if [ "$got" = "$exp" ]; then echo "PASS  metrik ayrıştırma P28e: parça 51 (red 6; histogram hariç), stop 9 (error 2), izleme 429 4"
  else echo "FAIL  metrik ayrıştırma P28e: '$got' (beklenen '$exp')"; echo "SONUÇ-İÇ 1" >>"$TMP/out"; fi
  printf '%s\n' 'rs_rec_part_total 0' 'rs_rec_stop_total 0' 'rs_rec_view_throttled_total 0' >"$M.1"
  got="$(M="$M.1" node -e "globalThis.fetch=async()=>({text:async()=>require('fs').readFileSync(process.env.M,'utf8')});$JS")"
  case "$got" in *" 0 - 0 - 0 - - -") echo "PASS  metrik ayrıştırma P28e işareti: etiketsiz sayaçlar 0, etiketli alt kümeler '-'" ;;
    *) echo "FAIL  metrik ayrıştırma P28e işareti: '$got'"; echo "SONUÇ-İÇ 1" >>"$TMP/out" ;; esac
  # P28c K4: rol kapısı reddi toplamı (bütün type); rs_multi_invites_total / rs_multi_members (gauge) toplanmaz.
  printf '%s\n' 'rs_multi_denied_total{type="input"} 3' 'rs_multi_denied_total{type="file.offer"} 2' \
    'rs_multi_invites_total{result="rejected"} 9' 'rs_multi_members{role="observer"} 1' >>"$M"
  got="$(M="$M" node -e "globalThis.fetch=async()=>({text:async()=>require('fs').readFileSync(process.env.M,'utf8')});$JS")"
  exp="1763000000 3 - - 1 0 1 1763000100 - 3 0 2 3 4 7 10 3 70 7 0 SMS=81,WHATSAPP=2 1 1 7200.5 16 5 6 2 4 7 2 51 6 9 2 4 5 - -"
  if [ "$got" = "$exp" ]; then echo "PASS  metrik ayrıştırma P28c: rol kapısı reddi 5 (bütün type; davet/üye sayılmaz)"
  else echo "FAIL  metrik ayrıştırma P28c: '$got' (beklenen '$exp')"; echo "SONUÇ-İÇ 1" >>"$TMP/out"; fi
  printf '%s\n' 'rs_multi_denied_total 0' >"$M.2"
  got="$(M="$M.2" node -e "globalThis.fetch=async()=>({text:async()=>require('fs').readFileSync(process.env.M,'utf8')});$JS")"
  case "$got" in *" - - - - - 0 - -") echo "PASS  metrik ayrıştırma P28c işareti: etiketsiz 'rs_multi_denied_total 0' -> 0" ;;
    *) echo "FAIL  metrik ayrıştırma P28c işareti: '$got'"; echo "SONUÇ-İÇ 1" >>"$TMP/out" ;; esac
  # P22-O: sohbet reddi toplamı (bütün reason) ve yalnız reason="internal"; diğer rs_session_chat_* serileri toplanmaz.
  printf '%s\n' 'rs_session_chat_rejected_total{reason="rate"} 4' 'rs_session_chat_rejected_total{reason="internal"} 2' \
    'rs_session_chat_rejected_total{reason="outdated"} 1' 'rs_session_chat_messages_total{sender="TECH"} 9' \
    'rs_session_chat_legacy_sessions_total 3' 'rs_ws_tech_outdated_total 5' >>"$M"
  got="$(M="$M" node -e "globalThis.fetch=async()=>({text:async()=>require('fs').readFileSync(process.env.M,'utf8')});$JS")"
  exp="1763000000 3 - - 1 0 1 1763000100 - 3 0 2 3 4 7 10 3 70 7 0 SMS=81,WHATSAPP=2 1 1 7200.5 16 5 6 2 4 7 2 51 6 9 2 4 5 7 2"
  if [ "$got" = "$exp" ]; then echo "PASS  metrik ayrıştırma P22: sohbet reddi 7 (internal 2; mesaj/legacy/4426 sayılmaz)"
  else echo "FAIL  metrik ayrıştırma P22: '$got' (beklenen '$exp')"; echo "SONUÇ-İÇ 1" >>"$TMP/out"; fi
  printf '%s\n' 'rs_session_chat_rejected_total 0' >"$M.3"
  got="$(M="$M.3" node -e "globalThis.fetch=async()=>({text:async()=>require('fs').readFileSync(process.env.M,'utf8')});$JS")"
  case "$got" in *" - 0 -") echo "PASS  metrik ayrıştırma P22 işareti: etiketsiz 'rs_session_chat_rejected_total 0' -> 0, internal '-'" ;;
    *) echo "FAIL  metrik ayrıştırma P22 işareti: '$got'"; echo "SONUÇ-İÇ 1" >>"$TMP/out" ;; esac
  # Ad eşlemesi P22: betikteki rs_session_chat_* adları ops/metrics.ts'te birebir (ad değişirse alarm sessizce ölmesin).
  for nm in $(grep -o 'rs_session_chat_[a-z_]*' "$HERE/remote-watch.sh" | sort -u); do
    if grep -q "\"$nm\"" "$HERE/../../apps/server/src/ops/metrics.ts"; then echo "PASS  ad eşlemesi: $nm ops/metrics.ts'te"
    else echo "FAIL  ad eşlemesi: $nm ops/metrics.ts'te yok"; echo "SONUÇ-İÇ 1" >>"$TMP/out"; fi
  done
  # Ad eşlemesi P28c: K1 (sunucu) paralel yazılırken ops/metrics.ts'te hiç rs_multi_ yoksa UYARI + tasarıma (mimari-p28c §8) karşı
  # denetim; bir tanesi bile varsa betiğin kullandığı ad orada birebir olmalı (ad değişirse alarm sessizce ölmesin).
  MT="$HERE/../../apps/server/src/ops/metrics.ts"
  for nm in $(grep -o 'rs_multi_[a-z_]*' "$HERE/remote-watch.sh" | sort -u); do
    if grep -q 'rs_multi_' "$MT"; then
      if grep -q "\"$nm\"" "$MT"; then echo "PASS  ad eşlemesi: $nm ops/metrics.ts'te"
      else echo "FAIL  ad eşlemesi: $nm ops/metrics.ts'te yok"; echo "SONUÇ-İÇ 1" >>"$TMP/out"; fi
    elif grep -q "$nm" "$HERE/../../docs/mimari-p28c.md"; then
      echo "UYARI: $nm henüz ops/metrics.ts'te kayıtlı değil (P28c K1); tasarımda var (mimari-p28c §8)"
    else echo "FAIL  ad eşlemesi: $nm ne ops/metrics.ts'te ne mimari-p28c.md'de"; echo "SONUÇ-İÇ 1" >>"$TMP/out"; fi
  done
  # Ad eşlemesi: betikteki rs_rec_* adları apps/server/src/rec/types.ts REC_METRICS ile birebir (ad değişirse alarm sessizce ölmesin).
  for nm in $(grep -o 'rs_rec_[a-z_]*' "$HERE/remote-watch.sh" | sort -u); do
    if grep -q "\"$nm\"" "$HERE/../../apps/server/src/rec/types.ts"; then echo "PASS  ad eşlemesi: $nm REC_METRICS'te"
    else echo "FAIL  ad eşlemesi: $nm REC_METRICS'te yok"; echo "SONUÇ-İÇ 1" >>"$TMP/out"; fi
  done
else echo "UYARI: host'ta node yok — metrik ayrıştırma testi atlandı"; fi
grep -E '^(PASS|FAIL)' "$TMP/out" || true
n="$(sed -n 's/^SONUÇ-İÇ //p' "$TMP/out" | sort -n | tail -1)"
echo
if [ "$n" = 0 ]; then echo "SONUÇ: GEÇTİ"; else [ -n "$n" ] || tail -20 "$TMP/out"; echo "SONUÇ: ${n:-?} FAIL"; exit 1; fi
