# shellcheck shell=bash
# restore.sh scratch/canlı MySQL yardımcıları (P13a + P13b D1/D2; docs/mimari-p13.md §7.6, ADR-0020 m.2). Doğrudan
# çalıştırılmaz; restore.sh lib.sh'ten sonra yükler. Kullandığı global'ler: SCRATCH, READY_TIMEOUT, SQL_DIR, DB_NAME,
# MYSQL_IMAGE, WORK, MANIFEST (imzası doğrulanmış KOPYA), EXPECTED_TRIGGERS, FAILS, check().
rand_pw() { printf 'r%s' "$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"; }
# Geçici MySQL: ağsız, compose ile aynı imaj, bayraklar ve init (01-users.sh -> app + migrator; backup gerekmez; D1).
# --user mysql: entrypoint gosu'yu atlar (Docker Desktop gosu takılması, QA-P5-6; Linux'ta da sorunsuz).
start_scratch() {
  SCRATCH="rs-restore-verify-$(date -u +%s)-$$"
  docker run -d --name "$SCRATCH" --network none --user mysql \
    -v "$SQL_DIR/init:/docker-entrypoint-initdb.d:ro" \
    -e MYSQL_ROOT_PASSWORD="$(rand_pw)" -e MYSQL_DATABASE="$DB_NAME" \
    -e MYSQL_APP_PASSWORD="$(rand_pw)" -e MYSQL_MIGRATOR_PASSWORD="$(rand_pw)" \
    "$MYSQL_IMAGE" --default-time-zone=+00:00 --log-bin-trust-function-creators=1 >/dev/null
  local deadline=$(( $(date -u +%s) + READY_TIMEOUT ))
  while [ "$(date -u +%s)" -lt "$deadline" ]; do
    [ "$(docker inspect -f '{{.State.Running}}' "$SCRATCH" 2>/dev/null)" = true ] || { docker logs --tail 20 "$SCRATCH" >&2; die "scratch MySQL durdu"; }
    if docker logs "$SCRATCH" 2>&1 | grep -q 'mysqld: ready for connections.*port: 3306[^0-9]' &&
       docker exec "$SCRATCH" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -h127.0.0.1 -NBe "SELECT 1"' >/dev/null 2>&1 &&
       echo "SELECT 1;" | sql_migrator "$SCRATCH" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  die "scratch MySQL ${READY_TIMEOUT} sn içinde hazır olmadı"
}

# migrator (D1): yükleme, reset, checksum, sayımlar. Parola konteyner env'inden; argümana girmez.
sql_migrator() {
  docker exec -i "$1" sh -c 'MYSQL_PWD="$MYSQL_MIGRATOR_PASSWORD" exec mysql -umigrator --protocol=socket \
    --system-command=OFF --local-infile=0 --default-character-set=utf8mb4 -NB "$MYSQL_DATABASE"'
}
# root YALNIZ salt okunur güvenlik anlık görüntüsü için (deploy/mysql/restore-sec-snapshot.sql).
sec_snapshot() {
  docker exec -i "$1" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -NB --system-command=OFF \
    --local-infile=0 "$0"' "$DB_NAME" < "$SQL_DIR/restore-sec-snapshot.sql" | tr '\n\t' ' :'
}
# Mutlak koşul (yüklemeden önce): anon=0 ve migratorExtra=0; değilse yükleme yapılmaz.
sec_precondition() {  # <ad> <anlık görüntü>
  local w ok=1
  for w in anon=0 migratorExtra=0; do
    case " $2 " in *" $w "*) ;; *) ok=0 ;; esac
  done
  if [ "$ok" = 1 ]; then printf 'CHECK OK    %-28s anon=0 migratorExtra=0\n' "$1"
  else printf 'CHECK FAIL  %-28s anon/migratorExtra 0 değil — YÜKLENMEDİ (db-notlari P13b)\n' "$1"; FAILS=$((FAILS + 1)); fi
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
load_dump() {  # <konteyner>: migrator ile (D1). rc≠0 -> FAIL
  gzip -dc "$WORK/db.sql.gz" | fix_trigger_dump | sql_migrator "$1"
}
checksum_tables() { sql_migrator "$1" < "$SQL_DIR/checksum-tables.sql"; }
checksum_check() {  # <ad> <dosya-a> <dosya-b>: farkta yalnız tablo adı
  local diff
  diff="$(join -t "$(printf '\t')" -a1 -a2 -e MISSING -o 0,1.2,2.2 <(LC_ALL=C sort "$2") <(LC_ALL=C sort "$3") \
    | awk -F'\t' '$2 != $3 {print $1}' | paste -sd, -)"
  if [ -z "$diff" ] && [ -s "$2" ]; then printf 'CHECK OK    %-28s %s tablo eşit\n' "$1" "$(grep -c . "$2")"
  else printf 'CHECK FAIL  %-28s farklı tablo: %s\n' "$1" "${diff:-boş çıktı}"; FAILS=$((FAILS + 1)); fi
}

verify_db() {  # $1 = konteyner (migrator ile okur)
  local c="$1" q got trg
  trg="$(echo "SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE();" | sql_migrator "$c")"
  check "tetikleyici sayısı (manifest)" "$(jq -r '.triggers' "$MANIFEST")" "$trg"
  check "tetikleyici sayısı (beklenen)" "$EXPECTED_TRIGGERS" "$trg"
  check "son migration" "$(jq -r '.lastMigration' "$MANIFEST")" \
    "$(echo "SELECT COALESCE(MAX(migration_name), '') FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;" | sql_migrator "$c")"
  check "tablo kümesi" "$(jq -r '.tables | keys | join(",")' "$MANIFEST")" \
    "$(echo "SELECT GROUP_CONCAT(TABLE_NAME ORDER BY TABLE_NAME SEPARATOR ',') FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE';" | sql_migrator "$c")"
  # Ters tırnaklar SQL tanımlayıcısıdır (kabuk genişletmesi değil):
  # shellcheck disable=SC2016
  q="$(jq -r '.tables | keys | map("SELECT \"" + . + "\", COUNT(*) FROM `" + . + "`") | join(" UNION ALL ") + ";"' "$MANIFEST")"
  got="$(sql_migrator "$c" <<<"$q" | LC_ALL=C sort)"
  check "tablo satır sayıları" "$(jq -r '.tables | to_entries | map(.key + "\t" + (.value | tostring)) | .[]' "$MANIFEST" | LC_ALL=C sort | tr '\n\t' ';=')" \
    "$(printf '%s\n' "$got" | tr '\n\t' ';=')"
  printf 'INFO        toplam satır %s · tablo %s\n' "$(printf '%s\n' "$got" | awk -F'\t' '{s += $2} END {print s + 0}')" "$(printf '%s\n' "$got" | grep -c .)"
}
