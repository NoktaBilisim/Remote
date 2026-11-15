#!/bin/bash
# shellcheck disable=SC2034  # BRC, RC, M, P, FP, SEC0 t() içindeki eval koşullarında okunur
# test-backup.sh senaryoları — YALNIZ yardımcı konteyner içinde (root, docker.sock) çalışır. Doğrudan çalıştırmayın.
set -u
F=0; ok() { echo "PASS  $*"; }
no() { echo "FAIL  $*"; F=$((F + 1)); tail -n 2 /tmp/bo /tmp/ro 2>/dev/null | sed 's/^/INFO  | /'; }
t() { if eval "$2"; then ok "$1"; else no "$1"; fi; }   # t <açıklama> <koşul>
B="$REPO/deploy/backup"; D=/opt/tdeploy; cd "$D" || exit 1
install -d -m 755 /var/backups /etc/remote-backup-t /var/lib/remote-backup-t
ssh-keygen -q -t ed25519 -N '' -C remote-backup@rstest -f /etc/remote-backup-t/manifest_ed25519
printf 'remote-backup@rstest namespaces="remote-backup" %s\n' "$(cut -d' ' -f1,2 /etc/remote-backup-t/manifest_ed25519.pub)" >/etc/remote-backup-t/allowed_signers
ssh-keygen -q -t ed25519 -N '' -f /root/foreign
printf 'x@y namespaces="remote-backup" %s\n' "$(cut -d' ' -f1,2 /root/foreign.pub)" >/root/foreign_signers
age-keygen -o /root/age.key 2>/dev/null
adduser -D -H -h /var/lib/remote-offsite -s /sbin/nologin remote-offsite; install -d -o remote-offsite -m 700 /offsite
BACKUP_AGE_RECIPIENT="$(age-keygen -y /root/age.key)"
export BACKUP_ENV_FILE=/nonexistent BACKUP_DEPLOY_DIR=$D BACKUP_DIR=/var/backups/remote-t BACKUP_MIN_FREE_MB=10 \
  BACKUP_STATUS_FILE=/var/lib/remote-backup-t/status.prom BACKUP_SIGNING_KEY=/etc/remote-backup-t/manifest_ed25519 \
  BACKUP_AGE_RECIPIENT RESTORE_EXPECT_PROJECT="$PROJ" \
  BACKUP_ALERT_CMD='printf "%s\n" "$REMOTE_BACKUP_MSG" >>/tmp/alerts'
FP="$(ssh-keygen -l -E sha256 -f /etc/remote-backup-t/manifest_ed25519 | awk '{print $2}')"
SQLR='MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -NB "$MYSQL_DATABASE"'
SQLM='MYSQL_PWD="$MYSQL_MIGRATOR_PASSWORD" exec mysql -umigrator -NB "$MYSQL_DATABASE"'
SQLA='MYSQL_PWD="$MYSQL_APP_PASSWORD" exec mysql -uapp -NB "$MYSQL_DATABASE"'
q() { docker compose exec -T mysql sh -c "$1"; }     # q "$SQLM" <<<"SQL"
# Çalıştırma adı saniye çözünürlüklü (aynı saniyede ikinci yedek reddedilir): her yedekten önce 1 sn.
bk() { sleep 1; : >/tmp/alerts; bash "$B/backup.sh" >/tmp/bo 2>&1; BRC=$?; }
last() { find "${1:-$BACKUP_DIR}" -mindepth 1 -maxdepth 1 -type d -name '[0-9]*Z' | sort | tail -1; }
rs() { bash "$B/restore.sh" --identity /root/age.key --allowed-signers "${AS:-/etc/remote-backup-t/allowed_signers}" "$@" >/tmp/ro 2>&1 </dev/null; RRC=$?; }
has() { grep -q -- "$1" "${2:-/tmp/bo}"; }
setenv() { sed -i "s/^DEPLOY_ENV=.*/DEPLOY_ENV=$1/" $D/.env; }
prom() { awk -v k="$1" '$1 == k {print $2}' /var/lib/remote-backup-t/status.prom; }
# P16: imha defteri volume'u gerçek imajdaki gibi node (1000) 0700; restore.sh yedek kopyasını uid 1000 ile yazar.
docker compose exec -T server sh -c 'chown 1000:1000 /var/lib/remote && chmod 700 /var/lib/remote'
LF=/var/lib/remote/erasure-ledger.jsonl
ULA=01JA0000000000000000000000; ULB=01JB0000000000000000000000
led() { docker compose exec -T server sh -c "$1"; }   # led "<sh>": sahte server içinde defter işlemi
docker compose exec -T server sh -c 'mkdir -p /data/uploads/t1 && echo logo >/data/uploads/t1/a.png && echo av >/data/uploads/t1/b.webp'
q "$SQLM" <<<"INSERT INTO audit_logs (created_at, username, action, entity, entity_id, user_agent, result) VALUES
  (UTC_TIMESTAMP(3) - INTERVAL 3 DAY,'cli','test.seed','test','1','t','success'),(UTC_TIMESTAMP(3) - INTERVAL 2 DAY,'cli','test.seed','test','2','t','success'),
  (UTC_TIMESTAMP(3) - INTERVAL 2 DAY,'cli','test.seed','test','3','t','success'),(UTC_TIMESTAMP(3) - INTERVAL 1 DAY,'cli','test.seed','test','4','t','success');"
q 'MYSQL_PWD="$MYSQL_MIGRATOR_PASSWORD" exec mysqldump -umigrator --no-tablespaces --no-create-info --no-data --triggers --skip-opt "$MYSQL_DATABASE" audit_logs' >/tmp/trg.sql
DROPALL='DROP TRIGGER audit_logs_no_update; DROP TRIGGER audit_logs_retention_only_delete; DROP TRIGGER audit_logs_force_created_at;'
reset_bl() { bash "$B/backup.sh" --reset-audit-baseline "$1" >/tmp/rb 2>&1; }

echo "== A) meşru yedek, imza, doğrulama"
bk; R1="$(last)"; M="$R1/manifest.json"
t "ilk yedek rc 0, audit-sureklilik: ilk, OFFSITE-UNCONFIGURED" '[ $BRC = 0 ] && has "audit-sureklilik: ilk" && has OFFSITE-UNCONFIGURED'
t "status.prom 644, last_run_ok 1, offsite_configured 0" '[ "$(stat -c %a /var/lib/remote-backup-t/status.prom)" = 644 ] && [ "$(prom remote_backup_last_run_ok)" = 1 ] && [ "$(prom remote_backup_offsite_configured)" = 0 ]'
t "manifest format 2, env staging, host rstest, signer = anahtar, seq 1" '[ "$(jq -r "[.format,.env,.host,.signer,.seq]|join(\" \")" $M)" = "2 staging rstest $FP 1" ]'
t "çalıştırma dizini 700, dosyalar 600 (imza dahil)" '[ "$(stat -c %a $R1)" = 700 ] && [ -z "$(find $R1 -type f ! -perm 600)" ] && [ -f $M.sig ]'
t "imza ssh-keygen -Y verify ile doğrulanır" 'ssh-keygen -Y verify -f /etc/remote-backup-t/allowed_signers -I remote-backup@rstest -n remote-backup -s $M.sig <$M >/dev/null 2>&1'
sleep 1; bk; R2="$(last)"
t "S16-11: manifest tetikleyici 22 (BACKUP_EXPECTED_TRIGGERS varsayılanı)" '[ "$(jq .triggers $M)" = 22 ]'
t "P16: defter yokken yedek: ledger ilk, present false, şifreli boş dosya + files[2]" '[ "$(jq -r "[.ledger.result,.ledger.present,.ledger.bytes,.files[2].name]|join(\" \")" $M)" = "ilk false 0 erasure-ledger.jsonl.age" ] && [ -f $R1/erasure-ledger.jsonl.age ] && [ "$(prom remote_backup_ledger_ok)" = 1 ]'
t "ikinci yedek: audit ok, seq 2, prevRun = ilk" 'has "audit-sureklilik: ok" && [ "$(jq -r ".seq,.prevRun" $R2/manifest.json | paste -sd" ")" = "2 ${R1##*/}" ]'
rs "$R2"
t "scratch geri yükleme meşru yedekte restore-verify: OK" '[ $RRC = 0 ] && has "restore-verify: OK" /tmp/ro && has "CHECK OK    manifest imzası" /tmp/ro'

echo "== B) imzasız / değiştirilmiş / bozuk / yabancı anahtar / replay / biçim"
neg() { rm -rf /tmp/neg; mkdir -p /tmp/neg; cp -a "$R2" "/tmp/neg/${2:-${R2##*/}}"; N="/tmp/neg/${2:-${R2##*/}}"; eval "$1"; }
imzafail() { [ $RRC = 1 ] && has "restore-verify: FAIL (imza)" /tmp/ro && ! has "sha256" /tmp/ro; }
neg 'rm $N/manifest.json.sig'; rs "$N"; t "imzasız -> FAIL (imza), sha256/çözme yok" imzafail
neg 'sed -i "s/\"keepDays\": *14/\"keepDays\":15/" $N/manifest.json'; rs "$N"; t "manifestte tek değer değişti -> FAIL (imza)" imzafail
neg 'sed -i "3s/./A/5" $N/manifest.json.sig'; rs "$N"; t "bozuk imza -> FAIL (imza)" imzafail
neg :; AS=/root/foreign_signers rs "$N"; t "yabancı anahtar (allowed_signers'ta yok) -> FAIL (imza)" imzafail
neg 'printf x >>$N/db.sql.gz.age'; rs "$N"; t "şifreli döküm değişti -> sha256 FAIL, çözülmedi" '[ $RRC = 1 ] && has "çözülmedi" /tmp/ro && ! has "düz sha256" /tmp/ro'
neg : "${R2##*/}"; mv "$N" "/tmp/neg/29991231T000000Z"; rs /tmp/neg/29991231T000000Z
t "replay: eski yedek yeni ada kopyalandı -> ret" '[ $RRC = 1 ] && has "manifest.run" /tmp/ro'
resign() { ssh-keygen -q -Y sign -f /etc/remote-backup-t/manifest_ed25519 -n remote-backup "$1/manifest.json" 2>/dev/null <<<y; }
neg 'jq ".run = \"bad-run\"" $N/manifest.json >/tmp/m && cp /tmp/m $N/manifest.json && rm $N/manifest.json.sig && resign $N' sahte-ad
rs "$N"; t "S-P13b-2: imzalı ama run biçimi geçersiz -> ret (SQL'e girmez)" '[ $RRC = 1 ] && has "manifest.run biçimi" /tmp/ro'

echo "== C) ortam kilidi"
rs --target staging --confirm yanlis@rstest "$R2"; t "yanlış --confirm -> ret" '[ $RRC = 1 ] && has "confirm remote@rstest" /tmp/ro'
rs --target production --confirm remote@rstest "$R2"; t "DEPLOY_ENV=staging iken --target production -> ret" '[ $RRC = 1 ] && has "DEPLOY_ENV=" /tmp/ro'
setenv production; rs --target production --confirm remote@rstest "$R2"
t "staging yedeği production'a -> ret (başka ortamın yedeği)" '[ $RRC = 1 ] && has "env=staging, hedef production" /tmp/ro'
BACKUP_DIR=/var/backups/prod bk; RP="$(last /var/backups/prod)"
rs --target production --confirm remote@rstest "$RP"
t "production yedeği + TTY yok -> ret" '[ $BRC = 0 ] && [ $RRC = 1 ] && has "TTY" /tmp/ro'
setenv ''; BACKUP_DIR=/var/backups/prod bk
t "DEPLOY_ENV boş -> yedek FAILED adım=önkoşul, last_run_ok 0" '[ $BRC != 0 ] && has "FAILED adım=önkoşul" && [ "$(prom remote_backup_last_run_ok)" = 0 ]'
setenv staging; RESTORE_EXPECT_PROJECT=remote rs --target staging --confirm remote@rstest --no-pre-backup "$R2"
t "yanlış compose projesi -> canlıya dokunulmadan ret" '[ $RRC = 1 ] && has "compose projesi" /tmp/ro'

echo "== D) canlı taklidi (staging) + audit taban çizgisi (S-P13b-1)"
q "$SQLM" <<<"INSERT INTO audit_logs (created_at, username, action, entity, result) VALUES (UTC_TIMESTAMP(3),'cli','test.after','test','success');"
rs --target staging --confirm remote@rstest "$R2"
t "canlı geri yükleme OK (reset migrator, CHECKSUM canlı = scratch, /ready)" '[ $RRC = 0 ] && has "restore-reset: OK" /tmp/ro && has "CHECK OK    CHECKSUM canlı = scratch" /tmp/ro && has "CHECK OK    /ready" /tmp/ro'
t "yedekten sonra eklenen satır gitti" '[ "$(q "$SQLR" <<<"SELECT COUNT(*) FROM audit_logs WHERE action=\"test.after\"")" = 0 ]'
MK=/var/backups/remote-t/audit-baseline-reset.json
t "restore host işaretini yazdı (root 600, id = DB sıfırlama satırı)" '[ "$(stat -c "%u %a" $MK)" = "0 600" ] && [ "$(jq .id $MK)" = "$(q "$SQLR" <<<"SELECT MAX(id) FROM audit_logs WHERE action=\"backup.audit_baseline_reset\"")" ]'
bk; t "sonraki yedek: taban-cizgisi-sifirlandi (uyarı) + alarm, rc 0" '[ $BRC = 0 ] && has "taban-cizgisi-sifirlandi" && grep -q "audit-sureklilik taban" /tmp/alerts'
t "işaret imzalı manifeste girdi ve tüketildi" '[ "$(jq .auditContinuity.baselineMarker.id "$(last)/manifest.json")" -gt 0 ] && [ ! -e $MK ]'
bk; t "değişiklik yok -> audit ok" 'has "audit-sureklilik: ok"'
q "$SQLA" <<<"INSERT INTO audit_logs (username, action, entity, result) VALUES ('cli','backup.audit_baseline_reset','audit_logs','success');"
bk; t "S-P13b-1: app sahte sıfırlama satırı -> FAILED taban-cizgisi-isaretsiz, rc≠0, audit_ok 0" '[ $BRC != 0 ] && has "taban-cizgisi-isaretsiz" && [ "$(prom remote_backup_audit_continuity_ok)" = 0 ]'
echo '{"format":1,"id":1}' >$MK; chmod 600 $MK; bk; t "işaret id'si farklı -> yine FAILED" 'has "taban-cizgisi-isaretsiz id=.* isaret=1"'
jq ".id = $(q "$SQLR" <<<"SELECT MAX(id) FROM audit_logs")" $MK >/tmp/mk; cp /tmp/mk $MK; chmod 644 $MK; bk
t "işaret 644 (root 600 değil) -> yok sayıldı, FAILED" 'has "YOK SAYILDI" && has "taban-cizgisi-isaretsiz"'
rm -f $MK; reset_bl "test: sahte satir incelendi"; bk
t "meşru --reset-audit-baseline -> sifirlandi, rc 0" 'has "audit-baseline-reset: OK id=" /tmp/rb && [ $BRC = 0 ] && has "taban-cizgisi-sifirlandi"'
q "$SQLM" <<<"$DROPALL DELETE FROM audit_logs WHERE action='test.seed' ORDER BY id LIMIT 1;"; q "$SQLM" </tmp/trg.sql
bk; t "tetikleyiciler düşürülüp geçmiş satır silindi, birebir geri kuruldu -> FAILED gun=, tetikleyici ok" '[ $BRC != 0 ] && has "FAILED adım=audit-sureklilik" && has "gun=" && ! has "adım=tetikleyici"'
bk; t "ertesi çalıştırma yine FAILED (son İYİ yedekle karşılaştırır)" '[ $BRC != 0 ] && has "gun="'
reset_bl "test: silme incelendi"; bk; t "sıfırlama sonrası uyarı + rc 0, fark yalnız bilgi (S-P13b-10)" '[ $BRC = 0 ] && has "taban-cizgisi-sifirlandi" && grep -q "fark-bilgi=.*gun=" /tmp/alerts'
q "$SQLM" <<<"TRUNCATE TABLE audit_logs;"; bk
t "TRUNCATE -> FAILED taban-cizgisi-kaydi-kayboldu" '[ $BRC != 0 ] && has "taban-cizgisi-kaydi-kayboldu"'
reset_bl "test: truncate incelendi"; bk; t "TRUNCATE sonrası meşru sıfırlama -> rc 0" '[ $BRC = 0 ]'
q "$SQLM" <<<"DROP TRIGGER audit_logs_no_update;"; bk
t "DROP TRIGGER -> FAILED adım=tetikleyici" '[ $BRC != 0 ] && has "FAILED adım=tetikleyici"'
q "$SQLM" <<<"DROP TRIGGER audit_logs_retention_only_delete; DROP TRIGGER audit_logs_force_created_at;"; q "$SQLM" </tmp/trg.sql
bk; t "tetikleyiciler geri kurulunca -> ok" '[ $BRC = 0 ] && has "audit-sureklilik: ok"'

echo "== E) site dışı kanca"
export BACKUP_OFFSITE_CMD='d=/offsite/$REMOTE_BACKUP_RUN; mkdir -p $d && cp $REMOTE_BACKUP_RUN_DIR/* $d/ && { cat /etc/remote-backup-t/manifest_ed25519 && echo KEYREAD; cat /opt/tdeploy/.env && echo ENVREAD; ls $REMOTE_BACKUP_DIR && echo DIRLIST; env; id -u; } >$d/probe 2>/dev/null; true'
bk; RO="$(last)"; P="/offsite/${RO##*/}/probe"
t "kanca OK: remote-offsite olarak 5 dosya (defter dahil) kopyaladı" '[ $BRC = 0 ] && has "OFFSITE OK" && [ "$(ls /offsite/${RO##*/} | grep -vc probe)" = 5 ] && [ "$(tail -1 $P)" = "$(id -u remote-offsite)" ]'
t "kanca imza anahtarını, deploy/.env'i okuyamadı, BACKUP_DIR'i listeleyemedi, ortamda sır yok" '! grep -Eq "KEYREAD|ENVREAD|DIRLIST|BACKUP_AGE|MYSQL_|ALERT_CMD" $P'
t "kanca sonrası izinler 700/600, komut metni logda yok, offsite_last_rc 0" '[ "$(stat -c %a $RO)$(stat -c %a /var/backups/remote-t)" = 700700 ] && [ -z "$(find $RO -type f ! -perm 600)" ] && ! has "KEYREAD" && [ "$(prom remote_backup_offsite_last_rc)" = 0 ]'
BACKUP_OFFSITE_CMD='exit 7' bk
t "kanca rc 7 -> OFFSITE-FAILED + alarm, birim rc 0, offsite_last_rc 7" '[ $BRC = 0 ] && has "OFFSITE-FAILED run=.* rc=7" && grep -q OFFSITE-FAILED /tmp/alerts && [ "$(prom remote_backup_offsite_last_rc)" = 7 ]'
BACKUP_OFFSITE_CMD="touch /tmp/RAN; curl -H 'x-api-key: abc' http://x" bk
t "metinde x-api-key -> çalıştırılmadı, rc=126" 'has "rc=126" && [ ! -e /tmp/RAN ]'
BACKUP_OFFSITE_CMD='sleep 20' setsid bash "$B/backup.sh" >/tmp/bo 2>&1 & BP=$!
for _ in $(seq 120); do pgrep -u remote-offsite sleep >/dev/null && break; sleep 0.5; done
kill -TERM -- -"$BP" 2>/dev/null; wait "$BP" 2>/dev/null; RK="$(last)"
t "S-P13b-6: kanca sırasında TERM -> izinler trap ile geri alındı" '[ "$(stat -c %a $RK)$(stat -c %a /var/backups/remote-t)" = 700700 ] && [ -z "$(find $RK -type f ! -perm 600)" ]'
BACKUP_OFFSITE_CMD='sleep 20' setsid bash "$B/backup.sh" >/tmp/bo 2>&1 & BP=$!
for _ in $(seq 120); do pgrep -u remote-offsite sleep >/dev/null && break; sleep 0.5; done
kill -KILL -- -"$BP" 2>/dev/null; wait "$BP" 2>/dev/null; RK="$(last)"; G="$(stat -c %a "$RK")"
unset BACKUP_OFFSITE_CMD; bk
t "S-P13b-6: SIGKILL ($G kaldı) -> sonraki çalıştırma 700/600'e normalleştirdi" '[ "$G" = 750 ] && [ "$(stat -c %a $RK)" = 700 ] && [ -z "$(find $RK -type f ! -perm 600)" ]'

echo "== F) kurcalanmış döküm (imzalı) yüklenemez, iz bırakmaz (AC-298)"
SEC0="$(q "$SQLR" <<<"SELECT COUNT(*) FROM mysql.user; SELECT COUNT(*) FROM performance_schema.persisted_variables; SELECT COUNT(*) FROM mysql.component;" | paste -sd,)"
tamper() {  # <ifade> -> /tmp/tam/kurcalanmis (imzalı, özetler güncel)
  rm -rf /tmp/tam; mkdir -p /tmp/tam/kurcalanmis; T=/tmp/tam/kurcalanmis; cp "$R2/uploads.tar.gz.age" $T/
  age -d -i /root/age.key "$R2/db.sql.gz.age" | gzip -dc | S="$1" awk 'NR == 2 {print ENVIRON["S"]} {print}' | gzip >$T/db.sql.gz
  age -r "$BACKUP_AGE_RECIPIENT" -o $T/db.sql.gz.age $T/db.sql.gz
  jq --argjson b "$(wc -c <$T/db.sql.gz.age)" --arg s "$(sha256sum $T/db.sql.gz.age | cut -d" " -f1)" \
     --argjson pb "$(wc -c <$T/db.sql.gz)" --arg ps "$(sha256sum $T/db.sql.gz | cut -d" " -f1)" \
     '.files[0] += {bytes: $b, sha256: $s, plainBytes: $pb, plainSha256: $ps}' "$R2/manifest.json" >$T/manifest.json
  rm -f $T/db.sql.gz; resign $T
}
for s in "CREATE USER 'evil'@'%' IDENTIFIED BY 'x';" "GRANT ALL ON *.* TO 'migrator'@'%';" "SET PERSIST max_connections = 999;" \
         "INSTALL COMPONENT 'file://component_validate_password';" "SELECT 1; USE mysql; INSERT INTO mysql.db (Host, Db, User) VALUES ('%','x','evil');"; do
  tamper "$s"; rs /tmp/tam/kurcalanmis
  t "kurcalanmış döküm [${s:0:24}…] -> imza OK ama migrator yükleyemez, FAIL" '[ $RRC = 1 ] && has "CHECK OK    manifest imzası" /tmp/ro && has "CHECK FAIL  döküm yükleme (migrator)" /tmp/ro'
done
tamper '\! touch /tmp/pwned'; rs /tmp/tam/kurcalanmis
t "istemci meta-komutu (\\!) -> FAIL, yükleme denenmedi" '[ $RRC = 1 ] && has "CHECK FAIL  dökümde istemci komutu" /tmp/ro && [ ! -e /tmp/pwned ]'
tamper "GRANT ALL ON *.* TO 'migrator'@'%';"; rs --target staging --confirm remote@rstest --no-pre-backup /tmp/tam/kurcalanmis
t "staging hedefi: scratch yüklemesi FAIL -> canlıya dokunulmadı (reset/durdurma yok)" '[ $RRC = 1 ] && has "CHECK FAIL  döküm yükleme" /tmp/ro && ! has "restore-reset" /tmp/ro && ! has "durduruluyor" /tmp/ro'
t "kalıcı iz yok: canlı hesap/persist/bileşen sayısı aynı, evil yok, scratch konteyneri kalmadı" '[ "$(q "$SQLR" <<<"SELECT COUNT(*) FROM mysql.user; SELECT COUNT(*) FROM performance_schema.persisted_variables; SELECT COUNT(*) FROM mysql.component;" | paste -sd,)" = "$SEC0" ] && [ -z "$(docker ps -aq --filter name=rs-restore-verify)" ]'

echo "== G) diğer"
BACKUP_ALERT_CMD='touch /tmp/AL; curl https://api.telegram.org/bot123456:ABC/sendMessage' bash "$B/backup.sh" --alert >/tmp/bo 2>&1; RC=$?
t "--alert metninde Telegram token'ı -> çalıştırılmadı, rc 1" '[ $RC = 1 ] && [ ! -e /tmp/AL ] && has "ÇALIŞTIRILMADI"'
chmod 644 /etc/remote-backup-t/manifest_ed25519; bk; chmod 600 /etc/remote-backup-t/manifest_ed25519
t "imza anahtarı 644 -> FAILED adım=imza" '[ $BRC != 0 ] && has "FAILED adım=imza"'
bash "$B/backup.sh" --reset-audit-baseline "kisa" >/tmp/rb 2>&1; RC=$?
t "--reset-audit-baseline kısa gerekçe -> ret, işaret yok" '[ $RC != 0 ] && [ ! -e $MK ]'
mkdir /var/backups/remote-t/.lock; sleep 300 & LP=$!; echo $LP >/var/backups/remote-t/.lock/pid
bash "$B/backup.sh" --reset-audit-baseline "test: kilit sinamasi" >/tmp/rb 2>&1; RC=$?; kill $LP 2>/dev/null; rm -rf /var/backups/remote-t/.lock
t "S-P13b-11: yedek kilidi tutulurken --reset-audit-baseline -> ret, işaret yok" '[ $RC != 0 ] && grep -q "çalışıyor" /tmp/rb && [ ! -e $MK ]'
echo "== H) P13c iki yığın: proje adı .env'den çözülür; staging yedeği prod'a, prod yedeği staging'e yüklenmez"
# /opt/tstg: compose dosyasındaki `name:` bilerek yanlış; .env COMPOSE_PROJECT_NAME onu ezer (staging .env'i gibi).
install -d -m 755 /opt/tstg && sed "s/^name: .*/name: rs-yanlis-proje/" $D/docker-compose.yml >/opt/tstg/docker-compose.yml
sed "s/^DEPLOY_ENV=.*/DEPLOY_ENV=staging/" $D/.env >/opt/tstg/.env && echo "COMPOSE_PROJECT_NAME=$PROJ" >>/opt/tstg/.env && chmod 600 /opt/tstg/.env
BACKUP_DEPLOY_DIR=/opt/tstg BACKUP_DIR=/var/backups/remote-stg bk; RS="$(last /var/backups/remote-stg)"
t "staging dizininden yedek: konteyner COMPOSE_PROJECT_NAME ile bulundu (sabit ad yok), manifest env staging" '[ $BRC = 0 ] && [ -n "$RS" ] && [ "$(jq -r .env $RS/manifest.json)" = staging ]'
setenv production
rs --target staging --confirm remote@rstest --no-pre-backup "$RS"
t "prod dizininde --target staging (staging yedeği) -> ret, canlıya dokunulmadı" '[ $RRC = 1 ] && has "DEPLOY_ENV='"'"'production'"'"'" /tmp/ro && ! has "restore-reset" /tmp/ro && ! has "durduruluyor" /tmp/ro'
rs --target production --confirm remote@rstest --no-pre-backup "$RS"
t "prod dizininde --target production (staging yedeği) -> ret (manifest env)" '[ $RRC = 1 ] && has "env=staging, hedef production" /tmp/ro && ! has "restore-reset" /tmp/ro'
BACKUP_DEPLOY_DIR=/opt/tstg rs --target staging --confirm remote@rstest --no-pre-backup "$RP"
t "staging dizininde prod yedeği (--target staging) -> ret (manifest env)" '[ $RRC = 1 ] && has "env=production, hedef staging" /tmp/ro && ! has "restore-reset" /tmp/ro'
setenv staging

echo "== I) S13C-2/S13C-13: ikinci yığın prod yedek yollarını kullanamaz; tek yığın staging (legacy) kullanır"
# Test yığınının projesi $PROJ (≠ remote) -> aşağıdaki ilk maddelerde "ikinci yığın" (proje ölçütü).
gfail() { [ $BRC != 0 ] && has "prod varsayılan yollarını" && [ ! -e /var/lib/remote-backup/status.prom ] && [ ! -d /var/backups/remote ]; }
BACKUP_DIR=/var/backups/remote bk; t "staging + BACKUP_DIR=/var/backups/remote -> ret; prod dizini ve prod status.prom oluşmadı" gfail
BACKUP_STATUS_FILE=/var/lib/remote-backup/status.prom bk; t "staging + prod BACKUP_STATUS_FILE -> ret, prod durum dosyasına yazılmadı" gfail
SK="$BACKUP_SIGNING_KEY"; unset BACKUP_SIGNING_KEY; bk; export BACKUP_SIGNING_KEY="$SK"
t "staging + imza anahtarı varsayılanı (prod) -> ret" '[ $BRC != 0 ] && has "BACKUP_SIGNING_KEY=/etc/remote-backup/manifest_ed25519"'
BACKUP_DIR=/var/backups/remote bash "$B/backup.sh" --reset-audit-baseline "test: yol korumasi sinamasi" >/tmp/rb 2>&1; RC=$?
t "staging + prod BACKUP_DIR ile --reset-audit-baseline -> ret, işaret yazılmadı" '[ $RC != 0 ] && grep -q "prod varsayılan yollarını" /tmp/rb && [ ! -d /var/backups/remote ]'
BACKUP_UNIT_NAME=remote-backup@stg.service BACKUP_PRIMARY_PROJECT="$PROJ" BACKUP_DIR=/var/backups/remote bk
t "S13C-13: şablon örneği (proje birincil ad olsa da) + prod yolları -> ret" 'gfail && has "birim remote-backup@stg.service" && ! has "compose projesi"'
# Legacy: §20 terfisi öncesi tek sunucu (proje remote, şablonsuz remote-backup.service, DEPLOY_ENV=staging, prod yolları).
# Birincil ad testte $PROJ'dur (gerçek `remote` projesi bu makinede başlatılmaz).
install -d -m 700 /etc/remote-backup && cp -p /etc/remote-backup-t/manifest_ed25519 /etc/remote-backup/manifest_ed25519
BACKUP_PRIMARY_PROJECT="$PROJ" BACKUP_DIR=/var/backups/remote BACKUP_STATUS_FILE=/var/lib/remote-backup/status.prom \
  BACKUP_SIGNING_KEY=/etc/remote-backup/manifest_ed25519 bk
t "S13C-13: legacy staging (proje birincil, şablonsuz, prod yolları) -> yedek geçer, prod status.prom yazıldı" '[ $BRC = 0 ] && has "remote-backup: OK" && [ -n "$(last /var/backups/remote)" ] && [ "$(awk "\$1 == \"remote_backup_last_run_ok\" {print \$2}" /var/lib/remote-backup/status.prom)" = 1 ]'
rm -rf /var/backups/remote /var/lib/remote-backup /etc/remote-backup
# S13C-14: proje birincil ad iken genel ad staging (stg.*) -> yığın yanlış kurulmuş, yedek alınmaz (status yazılmaz).
cp -p $D/.env /tmp/env.bak; echo 'PUBLIC_BASE_URL="https://stg.remote.noktabilisim.net"' >>$D/.env
BACKUP_PRIMARY_PROJECT="$PROJ" bk
t "S13C-14: proje birincil + PUBLIC_BASE_URL stg.* -> ret" '[ $BRC != 0 ] && has "genel ad staging"'
cp -p /tmp/env.bak $D/.env; echo "SITE_HOST=stg.remote.noktabilisim.net" >>$D/.env
BACKUP_PRIMARY_PROJECT="$PROJ" bk
t "S13C-14: proje birincil + SITE_HOST stg.* -> ret" '[ $BRC != 0 ] && has "genel ad staging"'
bk; t "S13C-14: proje ikinci yığın (≠ birincil) + stg.* adı -> yedek alınır" '[ $BRC = 0 ]'
cp -p /tmp/env.bak $D/.env
setenv production; BACKUP_DIR=/var/backups/remote bk; setenv staging; rm -rf /var/backups/remote
t "production + prod yolları -> koruma devreye girmez" '! has "prod varsayılan yollarını"'
for u in remote-backup@.service remote-backup-failed@.service; do
  t "$u: örnek yolları Environment= ile zorlanır" 'grep -qx "Environment=BACKUP_DIR=/var/backups/remote-%i" $B/$u && grep -qx "Environment=BACKUP_STATUS_FILE=/var/lib/remote-backup-%i/status.prom" $B/$u && grep -qx "Environment=BACKUP_SIGNING_KEY=/etc/remote-backup-%i/manifest_ed25519" $B/$u && grep -qx "Environment=BACKUP_UNIT_NAME=remote-backup@%i.service" $B/$u'
done
BACKUP_UNIT_NAME=remote-backup@stg.service bash "$B/backup.sh" --alert >/tmp/bo 2>&1
t "--alert metni örnek birimine işaret eder (journalctl -u remote-backup@stg.service)" 'has "journalctl -u remote-backup@stg.service"'
echo "== J) P16 imha defteri (ADR-0030 m.9, S16-5/11/13) + tetikleyici 22"
BACKUP_EXPECTED_TRIGGERS=3 bk; t "BACKUP_EXPECTED_TRIGGERS=3 (P16 öncesi değer) -> FAILED adım=tetikleyici" '[ $BRC != 0 ] && has "FAILED adım=tetikleyici" && has "beklenen 3"'
bk; t "varsayılan (22) -> rc 0" '[ $BRC = 0 ]'
led "printf '%s\n' '{\"v\":1,\"type\":\"tenant\",\"id\":\"$ULA\",\"jobId\":\"$ULB\",\"at\":\"2026-11-15T00:00:00Z\"}' '{\"v\":1,\"type\":\"user\",\"id\":\"$ULB\",\"at\":\"2026-11-15T00:00:01Z\"}' >>$LF && chown 1000:1000 $LF && chmod 600 $LF"
bk; RL="$(last)"
t "2 satır eklendi -> ledger ok, lines 2, firma 1, kullanıcı 1" '[ $BRC = 0 ] && has "imha-defteri: ok" && [ "$(jq -r "[.ledger.lines,.ledger.tenants,.ledger.users]|join(\" \")" $RL/manifest.json)" = "2 1 1" ]'
t "şifreli kopya çözülünce canlı defterle aynı" '[ "$(age -d -i /root/age.key $RL/erasure-ledger.jsonl.age | sha256sum | cut -d" " -f1)" = "$(led "cat $LF" | sha256sum | cut -d" " -f1)" ]'
rs "$RL"; t "scratch restore: defter sha OK, bekleyen sayımı INFO" '[ $RRC = 0 ] && has "CHECK OK    erasure-ledger.jsonl.age sha256" /tmp/ro && has "imha defteri: 2 satır" /tmp/ro'
led "cp $LF /tmp/l.bak && head -n 1 /tmp/l.bak >$LF"; bk
t "S16-13: defter kısaldı -> yayımlandı ama rc≠0, FAILED adım=imha-defteri kisaldi, ledger_ok 0" '[ $BRC != 0 ] && has "FAILED adım=imha-defteri" && has "kisaldi" && [ "$(prom remote_backup_ledger_ok)" = 0 ] && [ "$(jq -r .ledger.result "$(last)/manifest.json")" = FAILED ]'
bk; t "ertesi yedek yine FAILED (ref ilerlemedi)" '[ $BRC != 0 ] && has "kisaldi"'
led "cp /tmp/l.bak $LF"; bk; t "defter geri konunca -> ok, ledger_ok 1" '[ $BRC = 0 ] && has "imha-defteri: ok" && [ "$(prom remote_backup_ledger_ok)" = 1 ]'
led "sed -i 's/2026-11-15T00:00:00Z/2026-11-15T09:00:00Z/' $LF"; bk
t "aynı boyda içerik değişti -> FAILED degisti" '[ $BRC != 0 ] && has "degisti"'
led "cp /tmp/l.bak $LF && echo 'bozuk' >>$LF"; bk; t "geçersiz satır -> FAILED gecersiz-satir=1" '[ $BRC != 0 ] && has "gecersiz-satir=1"'
led "cp /tmp/l.bak $LF && printf '{\"v\":1' >>$LF"; bk; t "satır sonu olmayan yarım satır -> FAILED gecersiz-satir" '[ $BRC != 0 ] && has "gecersiz-satir"'
led "head -n 1 /tmp/l.bak >$LF"; bash "$B/backup.sh" --reset-ledger-baseline "test: defter kaybi incelendi" >/tmp/rb 2>&1
LM=/var/backups/remote-t/ledger-baseline-reset.json
t "--reset-ledger-baseline -> işaret root 600" 'grep -q "ledger-baseline-reset: OK" /tmp/rb && [ "$(stat -c "%u %a" $LM)" = "0 600" ]'
bk; t "işaretli yedek: taban-sifirlandi (uyarı + alarm), rc 0, işaret tüketildi" '[ $BRC = 0 ] && has "imha-defteri: taban-sifirlandi" && grep -q "imha-defteri taban" /tmp/alerts && [ ! -e $LM ]'
bk; t "sonraki yedek ok (yeni taban çizgisi)" '[ $BRC = 0 ] && has "imha-defteri: ok"'
led "ln -sf /tmp/l.bak /var/lib/remote/x && rm $LF && ln -s /tmp/l.bak $LF"; bk
t "defter sembolik bağlantı -> FAILED dosya-turu" '[ $BRC != 0 ] && has "dosya-turu"'
led "rm -f $LF /var/lib/remote/x && cp /tmp/l.bak $LF && chown 1000:1000 $LF && chmod 600 $LF"
bash "$B/backup.sh" --reset-ledger-baseline "test: sembolik baglanti duzeltildi" >/tmp/rb 2>&1; bk; RL2="$(last)"
t "düzeltme + sıfırlama -> rc 0, 2 satır" '[ $BRC = 0 ] && [ "$(jq .ledger.lines $RL2/manifest.json)" = 2 ]'
echo "-- canlı restore: defter uzlaştırma + erasure:replay/verify (taslak CLI)"
led "rm -f $LF"
RESTORE_ERASURE_POLL=1 rs --target staging --confirm remote@rstest --no-pre-backup "$RL2"
t "canlı defter yok -> yedek kopyası volume'a yazıldı, replay + verify OK, restore-verify OK" '[ $RRC = 0 ] && has "yedekteki kopya" /tmp/ro && has "CHECK OK    canlı imha defteri = yedek" /tmp/ro && has "CHECK OK    erasure:replay" /tmp/ro && has "erasure:replay stub defter=2" /tmp/ro && has "CHECK OK    erasure:verify" /tmp/ro'
t "yazılan defter uid 1000, 600" '[ "$(led "stat -c %u:%a $LF")" = "1000:600" ]'
led "echo '{\"v\":1,\"type\":\"user\",\"id\":\"01JC0000000000000000000000\",\"at\":\"x\"}' >>$LF"
RESTORE_ERASURE_POLL=1 rs --target staging --confirm remote@rstest --no-pre-backup "$RL2"
t "canlı defter yedeği kapsıyor (3 satır) -> korundu, replay canlı defterle" '[ $RRC = 0 ] && has "korunuyor" /tmp/ro && has "erasure:replay stub defter=3" /tmp/ro && [ "$(led "wc -l <$LF")" = 3 ]'
led "printf '%s\n' '{\"v\":1,\"type\":\"user\",\"id\":\"01JD0000000000000000000000\",\"at\":\"x\"}' >$LF"
RESTORE_ERASURE_POLL=1 rs --target staging --confirm remote@rstest --no-pre-backup "$RL2"
t "canlı defter yedekle uyuşmuyor -> restore rc≠0, DUR mesajı" '[ $RRC != 0 ] && has "yedektekiyle uyu" /tmp/ro'
t "uyuşmazlıkta replay çalışmadı, server durdurulmuş" '! has "CHECK OK    erasure:replay" /tmp/ro && [ -z "$(docker compose ps -q --status running server)" ]'
docker compose up -d --wait server web >/dev/null 2>&1
t "uyuşmazlıkta canlı defter değişmedi (1 satır)" '[ "$(led "wc -l <$LF" | tr -d " ")" = 1 ]'
led "cp /tmp/l.bak $LF"
echo "STUB_REPLAY_RC=1" >>$D/.env
RESTORE_ERASURE_POLL=1 rs --target staging --confirm remote@rstest --no-pre-backup "$RL2"
t "erasure:replay rc≠0 -> restore FAIL, server BAŞLATILMADI" '[ $RRC != 0 ] && has "CHECK FAIL  erasure:replay" /tmp/ro && [ -z "$(docker compose ps -q --status running server)" ]'
sed -i 's/^STUB_REPLAY_RC=1$/STUB_REPLAY_RC=3/' $D/.env
docker compose up -d --wait server web >/dev/null 2>&1
RESTORE_ERASURE_POLL=1 rs --target staging --confirm remote@rstest --no-pre-backup "$RL2"
t "S16-16: erasure:replay rc 3 (tutarsız satır) -> restore FAIL, kurcalama mesajı, server BAŞLATILMADI" '[ $RRC != 0 ] && has "CHECK FAIL  erasure:replay" /tmp/ro && has "kurcalama" /tmp/ro && [ -z "$(docker compose ps -q --status running server)" ]'
sed -i 's/^STUB_REPLAY_RC=3$/STUB_VERIFY_RC=1/' $D/.env
docker compose up -d --wait server web >/dev/null 2>&1
RESTORE_ERASURE_POLL=1 RESTORE_ERASURE_TIMEOUT=3 rs --target staging --confirm remote@rstest --no-pre-backup "$RL2"
t "erasure:verify süre içinde geçmedi -> restore-verify FAIL" '[ $RRC != 0 ] && has "CHECK FAIL  erasure:verify" /tmp/ro'
sed -i '/^STUB_VERIFY_RC=/d' $D/.env; docker compose up -d --wait server web >/dev/null 2>&1
echo "SONUÇ-İÇ $F"
