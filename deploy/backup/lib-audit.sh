# shellcheck shell=bash disable=SC2034
# (SC2034: PREV_*, AUDIT_*, M_AUDIT_OK backup.sh ve lib-offsite.sh tarafından okunur.)
# backup.sh audit süreklilik adımı (P13b D2 + G-P13b-5 + S-P13b-1; kurallar deploy/mysql/audit-continuity.sql başlığında,
# docs/db-notlari.md "P13b"). Doğrudan çalıştırılmaz; backup.sh lib.sh'ten sonra yükler. Kullandığı global'ler: BACKUP_DIR,
# SIGN_KEY, SQL_DIR, DEPLOY_ENV_VAL, HOST_SHORT, DB_NAME, sql_backup(). Ürettiği: PREV_DIR, PREV_M, PREV_RUN, PREV_SEQ,
# AUDIT_JSON, MARKER_JSON, AUDIT_RESULT, M_AUDIT_OK.

# S-P13b-1: taban çizgisi sıfırlamasının HOST tarafı kanıtı. Yalnız root'un yazabildiği BACKUP_DIR (700) içinde, root 600.
# `backup.sh --reset-audit-baseline` (restore.sh canlı yüklemeden sonra bunu çağırır) SQL'i çalıştırıp dönen audit id ile
# yazar. DB'deki `backup.audit_baseline_reset` satırı TEK BAŞINA yetmez: id'si bu kayıtla eşleşmezse FAILED.
# Kabul edildiği yedekte manifest `auditContinuity.baselineMarker`'a kopyalanır (imzalı) ve dosya silinir.
baseline_marker_path() { printf '%s/audit-baseline-reset.json\n' "$BACKUP_DIR"; }

# Önceki = BACKUP_DIR'deki en yeni, imzası (kendi açık anahtarımızla) geçerli ve sonucu FAILED olmayan manifest.
audit_find_prev() {
  local own d newest
  own="$(mktemp)"
  printf 'remote-backup namespaces="remote-backup" %s\n' "$(ssh-keygen -y -f "$SIGN_KEY" | awk '{print $1, $2}')" > "$own"
  PREV_DIR=""; PREV_M=""
  while IFS= read -r d; do
    if ! [[ "${d##*/}" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || [ ! -f "$d/manifest.json" ]; then continue; fi
    if [ ! -f "$d/manifest.json.sig" ]; then PREV_DIR="$d"; break; fi  # P13a (imzasız) -> "ilk"
    if ! verify_manifest_sig "$d/manifest.json" "$own" >/dev/null; then
      rm -f -- "$own"; die "önceki yedeğin (${d##*/}) manifest imzası geçersiz — yerel yedek dizini kurcalanmış olabilir (runbook §19)"
    fi
    [ "$(jq -r '.auditContinuity.result // ""' "$d/manifest.json")" = FAILED ] && continue
    PREV_DIR="$d"; PREV_M="$d/manifest.json"; break
  done < <(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '[0-9]*Z' | LC_ALL=C sort -r)
  rm -f -- "$own"
  PREV_SEQ=0; PREV_RUN=""
  if [ -n "$PREV_DIR" ]; then
    PREV_RUN="${PREV_DIR##*/}"
    # Sıra numarası: en yeni yayımlanmış manifestten (FAILED olsa da) +1; tazelik kanıtı (G-P13b-8).
    newest="$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '[0-9]*Z' | LC_ALL=C sort -r | head -n 1)"
    PREV_SEQ="$(jq -r '.seq // 0' "$newest/manifest.json" 2>/dev/null || echo 0)"
    case "$PREV_SEQ" in ''|*[!0-9]*) PREV_SEQ=0 ;; esac
  fi
}

audit_measure() {
  local pday="" puntil=""
  if [ -n "$PREV_M" ] && [ "$(jq -r '.audit.format // 0' "$PREV_M")" = 2 ]; then
    pday="$(jq -r '.audit.tail.day // ""' "$PREV_M")"; puntil="$(jq -r '.audit.tail.until // ""' "$PREV_M")"
    [[ "$pday" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ && "$puntil" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}$ ]] \
      || { pday=""; puntil=""; }
  fi
  AUDIT_JSON="$({ [ -z "$pday" ] || printf "SET @rs_prev_tail_day = '%s', @rs_prev_tail_until = '%s';\n" "$pday" "$puntil"
    cat "$SQL_DIR/audit-continuity.sql"; } | sql_backup)"
  jq -e '.format == 2 and (.maxId | type == "number")' <<<"$AUDIT_JSON" >/dev/null 2>&1 || die "audit-continuity.sql çıktısı okunamadı"
}

# Host işaretini okur: yoksa / root 600 normal dosya değilse / id sayı değilse MARKER_JSON=null (nedeni loglanır).
audit_marker_load() {
  local f; f="$(baseline_marker_path)"; MARKER_JSON=null
  [ -e "$f" ] || [ -L "$f" ] || return 0
  if ! file_root_600 "$f"; then log "uyarı: $f root 600 normal dosya değil — taban çizgisi işareti YOK SAYILDI"; return 0; fi
  if jq -e '.format == 1 and (.id | type == "number") and .id > 0' "$f" >/dev/null 2>&1; then MARKER_JSON="$(jq -c . "$f")"
  else log "uyarı: $f okunamadı — taban çizgisi işareti YOK SAYILDI"; fi
}

# Karşılaştırma (P = önceki manifest). Çıktı: "ilk" | "taban-cizgisi-sifirlandi id=<id> zaman=<at>" | "ok" | "FAILED <neden>".
audit_compare() {
  AUDIT_RESULT="$(jq -rn --argjson t "$AUDIT_JSON" --argjson m "$MARKER_JSON" --arg env "$DEPLOY_ENV_VAL" \
    --arg host "$HOST_SHORT" --arg db "$DB_NAME" --slurpfile p "${PREV_M:-/dev/null}" '
    def d2e: strptime("%Y-%m-%d") | mktime;
    def e2d: strftime("%Y-%m-%d");
    def nh: if . == null then {n: 0, h: null} else {n: .n, h: .h} end;
    # P (girdi) ile bugünkü ölçüm arasındaki farklar: maxId azaldı, gün özeti, önceki kuyruk.
    def why: . as $P
      | (($t.asOfUtcDate | d2e) - 728 * 86400 | e2d) as $lo
      | ([($t.days // {} | keys[]), ($P.audit.days // {} | keys[])] | unique
         | map(select(. >= $lo and . < $P.audit.asOfUtcDate))
         | map(select(($t.days[.] | nh) != ($P.audit.days[.] | nh)))) as $bad
      | [if $t.maxId < $P.audit.maxId then "maxId" else empty end]
        + (if ($bad | length) > 0 then ["gun=" + ($bad | join(","))] else [] end)
        + (if $P.audit.tail != null and $P.audit.tail.day >= $lo
             and (($t.prevTail | nh) != ($P.audit.tail | nh)) then ["tail=" + $P.audit.tail.day] else [] end);
    ($p[0] // null) as $P
    | ([($t.days // {} | to_entries[] | select(.value.n > 0 and .value.h == null) | .key)]
       + (if ($t.tail.n // 0) > 0 and $t.tail.h == null then ["tail"] else [] end)) as $trunc
    | if ($trunc | length) > 0 then "FAILED ozet-kesildi gun=" + ($trunc | join(","))
      elif $P == null or ($P.audit.format // 0) != 2 or $P.audit.instanceId != $t.instanceId or $P.env != $env
           or $P.host != $host or $P.database != $db then "ilk"
      elif ($P.audit.baseline.id // 0) != ($t.baseline.id // 0) then
        # Yalnız önceki ölçümden SONRA yazılmış VE host işaretiyle (root, BACKUP_DIR) aynı id taşıyan sıfırlama kaydı
        # taban çizgisini değiştirir. Kayıt kaybolduysa / eskiyse ya da işaret yoksa -> FAILED (S-P13b-1).
        if ($t.baseline.at == null) or ($t.baseline.at <= $P.audit.measuredAtUtc) then
          "FAILED taban-cizgisi-kaydi-kayboldu maxId=\($P.audit.maxId)->\($t.maxId)"
        elif ($m == null) or ($m.id != $t.baseline.id) then
          "FAILED taban-cizgisi-isaretsiz id=\($t.baseline.id) isaret=\(if $m == null then "yok" else $m.id end)"
        # S-P13b-10: meşru sıfırlamada da farklar hesaplanır ve YALNIZ BİLGİ olarak alarm metnine eklenir (FAIL değil).
        else "taban-cizgisi-sifirlandi id=\($t.baseline.id) zaman=\($t.baseline.at)"
          + (($P | why) as $w | if ($w | length) > 0 then " fark-bilgi=" + ($w | join(";")) else "" end) end
      else ($P | why) as $why
        | if ($why | length) > 0 then "FAILED " + ($why | join(" ")) else "ok" end
      end')"
  case "$AUDIT_RESULT" in
    FAILED*) M_AUDIT_OK=0; log "audit-sureklilik: $AUDIT_RESULT (karşılaştırılan: ${PREV_RUN:-yok}) — runbook §19 'audit süreklilik alarmı'" ;;
    taban-cizgisi-sifirlandi*) M_AUDIT_OK=1; log "audit-sureklilik: $AUDIT_RESULT (uyarı; host işareti eşleşti)" ;;
    *) M_AUDIT_OK=1; log "audit-sureklilik: $AUDIT_RESULT${PREV_RUN:+ (karşılaştırılan: $PREV_RUN)}" ;;
  esac
}

# Manifeste girecek işaret: yalnız kabul edildiyse (aksi hâlde null).
audit_marker_used() {
  case "$AUDIT_RESULT" in taban-cizgisi-sifirlandi*) printf '%s\n' "$MARKER_JSON" ;; *) printf 'null\n' ;; esac
}

# `backup.sh --reset-audit-baseline "<gerekçe>"` (root). audit-baseline-reset.sql'i migrator ile canlı mysql'de çalıştırır,
# dönen audit id ile host işaretini yazar. Gerekçe: 10–200 karakter, tek satır, ' ve \ yok (SQL'e gömülür; guard da denetler).
audit_baseline_reset_cmd() {
  local reason="$1" op cid out id f tmp
  [ "$(id -u)" = 0 ] || die "--reset-audit-baseline root ile çalıştırılır (işaret BACKUP_DIR'e yazılır)"
  : "${BACKUP_DIR:?BACKUP_DIR tanımlı değil (backup.env)}"
  case "$BACKUP_DIR" in /*) ;; *) die "BACKUP_DIR mutlak yol olmalı" ;; esac
  case "$reason" in *\'*|*\\*) die "gerekçe ' veya \\ içeremez" ;; esac
  [[ "$reason" =~ [[:cntrl:]] ]] && die "gerekçe tek satır olmalı (kontrol karakteri yok)"
  [ "${#reason}" -ge 10 ] && [ "${#reason}" -le 200 ] || die "gerekçe 10–200 karakter olmalı (kişisel veri/sır yazmayın)"
  op="${SUDO_USER:-$(id -un)}@$HOST_SHORT"
  [[ "$op" =~ ^[A-Za-z0-9._-]{1,32}@[A-Za-z0-9.-]{1,64}$ ]] || op="root@$HOST_SHORT"
  # S-P13b-11: yedekle aynı kilit — çalışan bir yedeğin ölçümü ile işaret yazımı yarışmasın.
  mkdir -p -- "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
  backup_lock; trap 'rm -rf -- "$LOCK"' EXIT
  cd "$DEPLOY_DIR" || die "$DEPLOY_DIR yok"
  cid="$(docker compose ps -q mysql 2>/dev/null || true)"
  [ -n "$cid" ] || die "mysql konteyneri bulunamadı ($DEPLOY_DIR)"
  out="$({ printf "SET @rs_reason = '%s', @rs_operator = '%s';\n" "$reason" "$op"; cat "$(sql_dir)/audit-baseline-reset.sql"; } \
    | docker exec -i "$cid" sh -c 'MYSQL_PWD="$MYSQL_MIGRATOR_PASSWORD" exec mysql -umigrator --protocol=socket \
        --system-command=OFF --local-infile=0 -NB "$MYSQL_DATABASE"')" || die "audit-baseline-reset.sql başarısız (guard?) — işaret yazılmadı"
  [[ "$out" =~ ^audit-baseline-reset:\ OK\ id=([0-9]+)$ ]] || die "beklenmeyen çıktı — işaret yazılmadı"
  id="${BASH_REMATCH[1]}"
  f="$(baseline_marker_path)"; tmp="$(mktemp "$BACKUP_DIR/.baseline.XXXXXX")"
  jq -n --argjson id "$id" --arg createdUtc "$(ts)" --arg operator "$op" --arg reason "$reason" --arg host "$HOST_SHORT" \
    --arg env "$(deploy_env_of "$DEPLOY_DIR")" \
    '{format: 1, id: $id, createdUtc: $createdUtc, operator: $operator, reason: $reason, host: $host, env: $env}' > "$tmp"
  chmod 600 "$tmp"; mv -f -- "$tmp" "$f"
  printf '%s remote-backup: audit-baseline-reset: OK id=%s isaret=%s\n' "$(ts)" "$id" "$f" >&2
}
