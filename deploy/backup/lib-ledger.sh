# shellcheck shell=bash disable=SC2034
# (SC2034: LEDGER_*, M_LEDGER_OK backup.sh / lib-offsite.sh / restore.sh tarafından okunur.)
# İmha defteri (P16; ADR-0030 m.9, S16-5, S16-13; mimari-e11 §7.7; runbook §23). backup.sh ve restore.sh lib.sh'ten sonra
# yükler; doğrudan çalıştırılmaz.
#
# Defter: server konteynerinde `ledger` volume'u (compose; ad <proje>_ledger, ör. remote_ledger) içinde
# /var/lib/remote/erasure-ledger.jsonl (node 0600), yalnız eklenen JSONL. Satır {v:1, type:"tenant"|"user", id, jobId?,
# phase?, at}; kişisel veri yok. DB dökümüne GİRMEZ (DB restore'u defteri geri almaz). Yedek setinde ayrı şifreli dosya
# erasure-ledger.jsonl.age + manifest `ledger` bölümü; site dışı kanca bütün *.age dosyalarını görür.
# Eklenebilirlik dışarıdan doğrulanır (S16-13): önceki yedeğin `ledger.ref`'i (bytes + sha256) bugünkü defterin ÖN EKİ
# olmalı. Kısalma / değişme / geçersiz satır / volume yok -> yedek YAYIMLANIR ama rc 1 (birim failed -> alarm) ve ref
# İLERLEMEZ: sorun giderilene ya da `backup.sh --reset-ledger-baseline "<gerekçe>"` çalışana kadar her gün alarm.
LEDGER_FILE=erasure-ledger.jsonl
LEDGER_ID_RE='^[0-9A-HJKMNP-TV-Z]{26}$'
LEDGER_EMPTY_SHA=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
ledger_marker_path() { printf '%s/ledger-baseline-reset.json\n' "$BACKUP_DIR"; }

# Manifest `files` öğesi (backup.sh; ≤ 300 satır için buraya taşındı).
file_json() {  # <ad> <şifreli dosya> <düz boyut> <düz sha256>
  jq -n --arg name "$1" --argjson bytes "$(size_file "$2")" --arg sha256 "$(sha256_file "$2")" \
    --argjson plainBytes "$3" --arg plainSha256 "$4" \
    '{name: $name, bytes: $bytes, sha256: $sha256, plainBytes: $plainBytes, plainSha256: $plainSha256}'
}
# <proje>: stdout volume adı (boş = yok).
ledger_volume() {
  docker volume ls -q --filter "label=com.docker.compose.project=$1" --filter label=com.docker.compose.volume=ledger
}
# <imaj> <volume> <çıktı>: defteri <çıktı>'ya kopyalar (ağsız, salt okunur bağlama, yalnız okuma yeteneği).
# rc 0 = dosya var · 4 = dosya yok (ilk silmeden önce beklenen) · 3 = normal dosya değil (bağlantı vb.) · diğer = hata.
ledger_read() {
  docker run --rm --network none --read-only --cap-drop ALL --cap-add DAC_READ_SEARCH \
    --security-opt no-new-privileges:true --user 0 -v "$2:/l:ro" --entrypoint sh "$1" -c 'f=/l/erasure-ledger.jsonl
      if [ -L "$f" ]; then exit 3; elif [ -f "$f" ]; then exec cat -- "$f"; elif [ -e "$f" ]; then exit 3; else exit 4; fi' > "$3"
}
# <dosya>: stdout JSON {bytes, sha256, lines, invalidLines, tenants, users}. Satır sonu olmayan son satır (yarım yazım)
# geçersiz sayılır. id biçimi ULID (tenant_purge_jobs CHECK ile aynı); kimlikler SQL'e yalnız bu süzgeçten sonra girer.
ledger_stats() {
  local f="$1" bytes partial=0
  bytes="$(size_file "$f")"
  [ "$bytes" -eq 0 ] || [ -z "$(tail -c 1 "$f" | tr -d '\n')" ] || partial=1
  jq -Rn --argjson bytes "$bytes" --arg sha "$(sha256_file "$f")" --argjson partial "$partial" --arg re "$LEDGER_ID_RE" '
    [inputs | select(length > 0) | (try fromjson catch null)
      | if type == "object" and .v == 1 and (.type == "tenant" or .type == "user")
           and (.id | type == "string" and test($re)) and (.at | type == "string") then {t: .type, id: .id} else null end] as $r
    | {bytes: $bytes, sha256: $sha, lines: ($r | length), invalidLines: (($r | map(select(. == null)) | length) + $partial),
       tenants: ([$r[] | select(. != null and .t == "tenant") | .id] | unique | length),
       users: ([$r[] | select(. != null and .t == "user") | .id] | unique | length)}' < "$f"
}
# <dosya> <tür>: geçerli satırlardaki tekil kimlikler (satır başına bir).
ledger_ids() {
  jq -Rr --arg t "$2" --arg re "$LEDGER_ID_RE" 'select(length > 0) | (try fromjson catch null)
    | select(type == "object" and .v == 1 and .type == $t and (.id | type == "string" and test($re))) | .id' < "$1" | LC_ALL=C sort -u
}

# Önceki referans: BACKUP_DIR'de `ledger.ref` taşıyan en yeni imzalı manifest (imza kendi açık anahtarımızla doğrulanır).
ledger_prev_ref() {
  local own d
  LEDGER_REF=null; LEDGER_PREV_RUN=""
  own="$(mktemp)"
  printf 'remote-backup namespaces="remote-backup" %s\n' "$(ssh-keygen -y -f "$SIGN_KEY" | awk '{print $1, $2}')" > "$own"
  while IFS= read -r d; do
    [[ "${d##*/}" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] && [ -f "$d/manifest.json.sig" ] || continue
    jq -e '.ledger.ref | type == "object"' "$d/manifest.json" >/dev/null 2>&1 || continue
    verify_manifest_sig "$d/manifest.json" "$own" >/dev/null \
      || { rm -f -- "$own"; die "önceki yedeğin (${d##*/}) manifest imzası geçersiz — yerel yedek dizini kurcalanmış olabilir"; }
    LEDGER_REF="$(jq -c '.ledger.ref' "$d/manifest.json")"; LEDGER_PREV_RUN="${d##*/}"; break
  done < <(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '[0-9]*Z' | LC_ALL=C sort -r)
  rm -f -- "$own"
}
# Host işareti (root 600, BACKUP_DIR): `--reset-ledger-baseline`. Değilse yok sayılır.
ledger_marker_load() {
  local f; f="$(ledger_marker_path)"; LEDGER_MARKER=null
  [ -e "$f" ] || [ -L "$f" ] || return 0
  if file_root_600 "$f" && jq -e '.format == 1 and (.reason | type == "string")' "$f" >/dev/null 2>&1; then
    LEDGER_MARKER="$(jq -c . "$f")"
  else log "uyarı: $f root 600 normal dosya değil ya da okunamadı — defter taban çizgisi işareti YOK SAYILDI"; fi
}

# backup.sh adım 4b. Global: PROJECT, MYSQL_IMAGE_ID, WORK, OUT, AGE_ARGS, RUN. Sonuç: LEDGER_RESULT, LEDGER_JSON,
# M_LEDGER_OK, $OUT/erasure-ledger.jsonl.age (her zaman; defter yoksa boş içerik).
ledger_backup() {
  local vol rc=0 ref_bytes ref_sha cur_bytes pre="" inv new_ref present=false
  ledger_prev_ref; ledger_marker_load
  vol="$(ledger_volume "$PROJECT")"
  if [ -z "$vol" ]; then rc=novol; : > "$WORK/ledger"
  else ledger_read "$MYSQL_IMAGE_ID" "$vol" "$WORK/ledger" || rc=$?; fi
  case "$rc" in
    0) present=true ;;
    3|4|novol) : > "$WORK/ledger" ;;
    *) die "imha defteri okunamadı (docker rc=$rc; volume $vol)" ;;
  esac
  LEDGER_STATS="$(ledger_stats "$WORK/ledger")" || die "imha defteri özeti hesaplanamadı"
  ref_bytes="$(jq -r '.bytes // 0' <<<"$LEDGER_REF")"; ref_sha="$(jq -r '.sha256 // ""' <<<"$LEDGER_REF")"
  cur_bytes="$(jq -r .bytes <<<"$LEDGER_STATS")"; inv="$(jq -r .invalidLines <<<"$LEDGER_STATS")"
  [ "$cur_bytes" -lt "$ref_bytes" ] || pre="$(head -c "$ref_bytes" "$WORK/ledger" | sha256_stdin)"
  if [ "$rc" = novol ]; then LEDGER_RESULT="FAILED volume-yok (compose 'ledger' volume'u; proje $PROJECT)"
  elif [ "$rc" = 3 ]; then LEDGER_RESULT="FAILED dosya-turu ($LEDGER_FILE normal dosya değil)"
  elif [ "$LEDGER_MARKER" != null ]; then LEDGER_RESULT="taban-sifirlandi zaman=$(jq -r '.createdUtc' <<<"$LEDGER_MARKER")"
  elif [ "$LEDGER_REF" = null ]; then LEDGER_RESULT=ilk
  elif [ "$cur_bytes" -lt "$ref_bytes" ]; then LEDGER_RESULT="FAILED kisaldi bytes=$ref_bytes->$cur_bytes"
  elif [ "$pre" != "$ref_sha" ]; then LEDGER_RESULT="FAILED degisti ilk-${ref_bytes}-bayt"
  else LEDGER_RESULT=ok; fi
  if [ "$inv" -gt 0 ] && [ "${LEDGER_RESULT%% *}" != FAILED ]; then LEDGER_RESULT="FAILED gecersiz-satir=$inv"; fi
  if [ "${LEDGER_RESULT%% *}" = FAILED ]; then
    M_LEDGER_OK=0
    new_ref="$(jq -c --arg e "$LEDGER_EMPTY_SHA" 'if . == null then {run: "", bytes: 0, sha256: $e} else . end' <<<"$LEDGER_REF")"
  else
    M_LEDGER_OK=1
    new_ref="$(jq -c --arg run "$RUN" '{run: $run, bytes: .bytes, sha256: .sha256}' <<<"$LEDGER_STATS")"
  fi
  age "${AGE_ARGS[@]}" -o "$OUT/$LEDGER_FILE.age" "$WORK/ledger" || die "imha defteri şifrelenemedi"
  LEDGER_JSON="$(jq -c -n --argjson s "$LEDGER_STATS" --argjson present "$present" --arg result "${LEDGER_RESULT%% *}" \
    --arg detail "$LEDGER_RESULT" --arg prev "$LEDGER_PREV_RUN" --argjson ref "$new_ref" \
    --argjson marker "$(case "$LEDGER_RESULT" in taban-sifirlandi*) printf '%s' "$LEDGER_MARKER" ;; *) echo null ;; esac)" \
    '{format: 1, file: "erasure-ledger.jsonl.age", present: $present} + $s
      + {result: $result, detail: $detail, comparedWith: $prev, ref: $ref, baselineMarker: $marker}')"
  log "imha-defteri: $LEDGER_RESULT satır=$(jq -r .lines <<<"$LEDGER_STATS") firma=$(jq -r .tenants <<<"$LEDGER_STATS") kullanıcı=$(jq -r .users <<<"$LEDGER_STATS")${LEDGER_PREV_RUN:+ (karşılaştırılan: $LEDGER_PREV_RUN)}"
}
# Yayımladıktan sonra: işaret tüketilir + uyarı; FAILED ise alarm metni (birim zaten rc 1 ile failed olur).
ledger_after_publish() {
  case "$LEDGER_RESULT" in
    taban-sifirlandi*)
      rm -f -- "$(ledger_marker_path)"
      offsite_alert "remote-backup: imha-defteri $LEDGER_RESULT host=$HOST_SHORT run=$RUN (uyarı: defter taban çizgisi elle sıfırlandı; runbook §23.6)" ;;
  esac
}

# `backup.sh --reset-ledger-baseline "<gerekçe>"` (root): bir sonraki yedek defteri yeni taban çizgisi kabul eder.
# Yalnız defter kaybı/kısalması incelenip kayıt altına alındıktan sonra (runbook §23.6). Gerekçe 10–200 karakter, tek satır.
ledger_baseline_reset_cmd() {
  local reason="$1" op f tmp
  [ "$(id -u)" = 0 ] || die "--reset-ledger-baseline root ile çalıştırılır"
  : "${BACKUP_DIR:?BACKUP_DIR tanımlı değil (backup.env)}"
  case "$BACKUP_DIR" in /*) ;; *) die "BACKUP_DIR mutlak yol olmalı" ;; esac
  [[ "$reason" =~ [[:cntrl:]] ]] && die "gerekçe tek satır olmalı (kontrol karakteri yok)"
  [ "${#reason}" -ge 10 ] && [ "${#reason}" -le 200 ] || die "gerekçe 10–200 karakter olmalı (kişisel veri/sır yazmayın)"
  op="${SUDO_USER:-$(id -un)}@$HOST_SHORT"
  [[ "$op" =~ ^[A-Za-z0-9._-]{1,32}@[A-Za-z0-9.-]{1,64}$ ]] || op="root@$HOST_SHORT"
  mkdir -p -- "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
  backup_lock; trap 'rm -rf -- "$LOCK"' EXIT
  f="$(ledger_marker_path)"; tmp="$(mktemp "$BACKUP_DIR/.ledger-baseline.XXXXXX")"
  jq -n --arg createdUtc "$(ts)" --arg operator "$op" --arg reason "$reason" --arg host "$HOST_SHORT" \
    '{format: 1, createdUtc: $createdUtc, operator: $operator, reason: $reason, host: $host}' > "$tmp"
  chmod 600 "$tmp"; mv -f -- "$tmp" "$f"
  printf '%s remote-backup: ledger-baseline-reset: OK isaret=%s\n' "$(ts)" "$f" >&2
}

# --- restore.sh ------------------------------------------------------------------------------------------------------
# Scratch adımı: manifestte defter varsa şifreli/düz özet + istatistik doğrulanır, $WORK/ledger'a çözülür; geri yüklenen
# DB'de defterde olup henüz silinmemiş kayıtlar sayılır (canlı geri yüklemede erasure:replay bunları yeniden siler).
# P16 sonrası yedekte (tetikleyici >= 22) defter bölümü ZORUNLU. Global: MANIFEST, RUN_DIR, WORK, IDENTITY, check().
ledger_restore_check() {  # <scratch konteyneri>
  local c="$1" f="$RUN_DIR/$LEDGER_FILE.age" t u
  LEDGER_IN_BACKUP=0
  if ! jq -e '.ledger | type == "object"' "$MANIFEST" >/dev/null; then
    if [ "$(jq -r '.triggers' "$MANIFEST")" -ge 22 ]; then check "imha defteri manifestte" var yok
    else printf 'INFO        imha defteri yok (P16 öncesi yedek)\n'; fi
    return 0
  fi
  [ -f "$f" ] || { check "imha defteri dosyası" var yok; return 0; }
  check "$LEDGER_FILE.age sha256" "$(jq -r '.files[] | select(.name == "erasure-ledger.jsonl.age") | .sha256' "$MANIFEST")" "$(sha256_file "$f")"
  age -d -i "$IDENTITY" -o "$WORK/ledger" "$f" || { check "imha defteri çözme" 0 "rc≠0"; return 0; }
  check "imha defteri düz sha256" "$(jq -r '.ledger.sha256' "$MANIFEST")" "$(sha256_file "$WORK/ledger")"
  check "imha defteri geçersiz satır" 0 "$(ledger_stats "$WORK/ledger" | jq -r .invalidLines)"
  LEDGER_IN_BACKUP=1
  t="$(ledger_pending_sql tenant tenants "id")"; u="$(ledger_pending_sql user users "id AND status <> 'DELETED'")"
  printf 'INFO        imha defteri: %s satır (firma %s, kullanıcı %s) · geri yüklenen DB'"'"'de henüz silinmemiş: firma %s, kullanıcı %s (canlıda erasure:replay)\n' \
    "$(jq -r '.ledger.lines' "$MANIFEST")" "$(jq -r '.ledger.tenants' "$MANIFEST")" "$(jq -r '.ledger.users' "$MANIFEST")" \
    "$(sql_migrator "$c" <<<"$t")" "$(sql_migrator "$c" <<<"$u")"
}
# <tür> <tablo> [ek koşul]: defterdeki kimliklerden tabloda hâlâ bulunanları sayan SQL (kimlikler ULID süzgecinden geçer).
ledger_pending_sql() {
  local ids
  ids="$(ledger_ids "$WORK/ledger" "$1" | sed "s/.*/'&'/" | paste -sd, -)"
  [ -n "$ids" ] || { echo "SELECT 0;"; return; }
  printf 'SELECT COUNT(*) FROM `%s` WHERE id IN (%s)%s;\n' "$2" "$ids" "${3:+ AND $3}"
}

# Canlı adım 1 (yükleme + CHECKSUM + audit taban çizgisi SONRASI, server DURURKEN): canlı defter ile yedekteki karşılaştırılır.
#   canlı ⊇ yedek (yedek canlının ön eki) -> canlı korunur (DB restore'u defteri geri almaz; ADR-0030 m.9);
#   canlı boş/yok (volume kayboldu, yeni sunucu) -> yedekteki kopya volume'a yazılır (node 1000:1000, 0600, atomik);
#   başka her durum -> DUR (elle karar, runbook §23.5). Global: PROJECT, MYSQL_IMAGE, WORK, LEDGER_IN_BACKUP.
ledger_live_reconcile() {
  local vol rc=0 lb bb
  vol="$(ledger_volume "$PROJECT")"
  [ -n "$vol" ] || die "canlı 'ledger' volume'u yok (proje $PROJECT; P16 compose) — server DURDURULMUŞ (runbook §23.5)"
  ledger_read "$MYSQL_IMAGE" "$vol" "$WORK/ledger.live" || rc=$?
  case "$rc" in 0) ;; 4) : > "$WORK/ledger.live" ;; *) die "canlı imha defteri okunamadı (rc=$rc) — server DURDURULMUŞ (runbook §23.5)" ;; esac
  if [ "$LEDGER_IN_BACKUP" != 1 ]; then log "imha defteri: yedekte yok; canlı defter ($(size_file "$WORK/ledger.live") bayt) kullanılacak"; return 0; fi
  bb="$(size_file "$WORK/ledger")"; lb="$(size_file "$WORK/ledger.live")"
  if [ "$lb" -ge "$bb" ] && [ "$(head -c "$bb" "$WORK/ledger.live" | sha256_stdin)" = "$(sha256_file "$WORK/ledger")" ]; then
    log "imha defteri: canlı defter yedektekini kapsıyor ($lb >= $bb bayt) — korunuyor"; return 0
  fi
  [ "$lb" -eq 0 ] || die "canlı imha defteri yedektekiyle uyuşmuyor (yedek canlının ön eki değil; canlı $lb, yedek $bb bayt) — server DURDURULMUŞ, elle karar: runbook §23.5"
  log "imha defteri: canlı defter boş/yok — yedekteki kopya ($bb bayt) volume'a yazılıyor"
  docker run --rm -i --network none --cap-drop ALL --security-opt no-new-privileges:true --user 1000:1000 -v "$vol:/l" \
    --entrypoint sh "$MYSQL_IMAGE" -c 'set -e; umask 077; cat > /l/.erasure-ledger.restore; mv -f /l/.erasure-ledger.restore /l/erasure-ledger.jsonl' \
    < "$WORK/ledger" || die "imha defteri volume'a yazılamadı (volume node:node 0700 mi?) — server DURDURULMUŞ"
  ledger_read "$MYSQL_IMAGE" "$vol" "$WORK/ledger.live" || die "yazılan imha defteri okunamadı"
  check "canlı imha defteri = yedek" "$(sha256_file "$WORK/ledger")" "$(sha256_file "$WORK/ledger.live")"
}
# erasure CLI (G3; mimari-e11 §7.7): migrate imajında, migrator hesabıyla; `ledger` volume'u migrate servisine salt okunur
# bağlıdır (compose). Çıktıda kişisel veri yoktur (yalnız sayılar/kimlik); son 5 satır restore çıktısına alınır.
erasure_cli() { docker compose run --rm --no-deps -T migrate pnpm --filter @remote/server cli "erasure:$1"; }
# Canlı adım 2 (server DURURKEN): mezar taşları yeniden uygulanır, firmalar için RUNNING iş açılır. Başarısızsa server
# BAŞLATILMAZ (silinmiş veri sunulmasın). rc 3 (S16-16): geri yüklenen DB ile tutarsız defter satırı reddedildi (meşru
# satırlar uygulandı) — kurcalama şüphesi; server yine BAŞLATILMAZ, elle karar runbook §23.5.
ledger_live_replay() {
  local out rc=0
  out="$(erasure_cli replay 2>&1)" || rc=$?
  printf '%s\n' "$out" | tail -n 5 | sed 's/^/INFO        | /'
  check "erasure:replay" 0 "$rc"
  case "$rc" in
    0) ;;
    3) log "erasure:replay tutarsız defter satırı REDDETTİ (kurcalama şüphesi) — server DURDURULMUŞ bırakıldı, elle karar: runbook §23.5"; verdict ;;
    *) log "erasure:replay başarısız — server DURDURULMUŞ bırakıldı (runbook §23.5)"; verdict ;;
  esac
}
# Canlı adım 3 (server açıldıktan sonra): firma işleri (TenantPurgeRunner, 60 sn tur) bitene kadar verify yoklanır.
ledger_live_verify() {
  local deadline rc out tmo="${RESTORE_ERASURE_TIMEOUT:-1800}"
  case "$tmo" in ''|*[!0-9]*) tmo=1800 ;; esac
  deadline=$(( $(date -u +%s) + tmo ))
  while :; do
    rc=0; out="$(erasure_cli verify 2>&1)" || rc=$?
    { [ "$rc" -ne 0 ] && [ "$(date -u +%s)" -lt "$deadline" ]; } || break
    sleep "${RESTORE_ERASURE_POLL:-30}"
  done
  printf '%s\n' "$out" | tail -n 5 | sed 's/^/INFO        | /'
  check "erasure:verify" 0 "$rc"
}
