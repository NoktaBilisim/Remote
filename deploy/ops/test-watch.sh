#!/usr/bin/env bash
# remote-watch.sh yerel testi (P13b T4; mimari-p13 §7.8, AC önerisi §7.15-e, G-P13b-7/13). Sunucuya bağlanmaz.
# Linux root konteyneri (alpine, benzersiz ad, iş bitince silinir; dind YOK): docker/systemctl/curl yerine PATH taslakları
# (senaryo dosyalarından okur), openssl/df/find/timeout/date gerçek. Coturn 5349 yerine openssl s_server.
# Doğrulananlar: her kontrol için olumsuz durum -> `ALERT check=<ad>` + alarm komutu; tekrar bastırma; tekrar süresi
# dolunca yeniden; düzelince bir kez DUZELDI; watch.env 644 / bağlantı / root dışı sahip -> çalışmaz; sır içeren alarm
# komutu çalıştırılmaz; site dışı hatırlatma 7 günde bir; install/uninstall (kurulu kopya root 0755, watch.env 600);
# P13c ikinci örnek `stg` (ayrı env/durum, [stg] alarm adı, coturn kontrolü yok, @stg birimleri yalnız stg'de sayılır);
# P18 H5 crypto-decrypt / calendar-fallback / msg-tenant-rate / p18-metrics.
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
  exp="1763000000 3 - - 1 0 1 1763000100 - 3 0 - - - -"
  if [ "$got" = "$exp" ]; then echo "PASS  metrik ayrıştırma: etiketli rs_retention_failures_total toplamı 3, SCHEDULED/RUNNING, circuit_open 3, P18 serisi yok -> '-'"
  else echo "FAIL  metrik ayrıştırma: '$got' (beklenen '$exp')"; echo "SONUÇ-İÇ 1" >>"$TMP/out"; fi
  # P18 H5: decrypt (bütün table), takvim (bütün tenant), yalnız reason~tenant kova reddi, mesaj sayacı (P18 işareti).
  printf '%s\n' 'rs_crypto_decrypt_failures_total{table="session_messages"} 2' 'rs_calendar_fallback_total{tenant="t1"} 1' \
    'rs_calendar_fallback_total{tenant="t2"} 2' 'rs_request_messages_rejected_total{reason="tenant_rate"} 4' \
    'rs_request_messages_rejected_total{reason="sender_cap"} 9' 'rs_request_messages_total{sender="CUSTOMER"} 7' >>"$M"
  got="$(M="$M" node -e "globalThis.fetch=async()=>({text:async()=>require('fs').readFileSync(process.env.M,'utf8')});$JS")"
  exp="1763000000 3 - - 1 0 1 1763000100 - 3 0 2 3 4 7"
  if [ "$got" = "$exp" ]; then echo "PASS  metrik ayrıştırma P18: decrypt 2, takvim 1+2, tenant kova 4 (sender_cap hariç), mesaj 7"
  else echo "FAIL  metrik ayrıştırma P18: '$got' (beklenen '$exp')"; echo "SONUÇ-İÇ 1" >>"$TMP/out"; fi
else echo "UYARI: host'ta node yok — metrik ayrıştırma testi atlandı"; fi
grep -E '^(PASS|FAIL)' "$TMP/out" || true
n="$(sed -n 's/^SONUÇ-İÇ //p' "$TMP/out" | sort -n | tail -1)"
echo
if [ "$n" = 0 ]; then echo "SONUÇ: GEÇTİ"; else [ -n "$n" ] || tail -20 "$TMP/out"; echo "SONUÇ: ${n:-?} FAIL"; exit 1; fi
