# shellcheck shell=bash
# backup.sh durum dosyası, alarm ve site dışı kanca (P13b; mimari-p13 §7.6/4-5, ADR-0020 m.4, G-P13b-6/7, S-P13b-6).
# Doğrudan çalıştırılmaz; backup.sh lib.sh'ten sonra yükler.

# --- status.prom (BACKUP_STATUS_FILE; 644, yalnız sayılar; remote-watch okur) --------------------------------------
STATUS_FILE="${BACKUP_STATUS_FILE:-/var/lib/remote-backup/status.prom}"
# Ölçülmeyen/bu çalıştırmada değişmeyen değerler önceki dosyadan taşınır.
prev_metric() { awk -v k="$1" '$1 == k {v=$2} END {print (v == "" ? "0" : v)}' "$STATUS_FILE" 2>/dev/null || echo 0; }
status_init() {
  M_LAST_SUCCESS="$(prev_metric remote_backup_last_success_timestamp_seconds)"
  M_OFF_SUCCESS="$(prev_metric remote_backup_offsite_last_success_timestamp_seconds)"
  M_OFF_RC="$(prev_metric remote_backup_offsite_last_rc)"
  M_AUDIT_OK="$(prev_metric remote_backup_audit_continuity_ok)"
  M_OFF_CONF=0; [ -n "${BACKUP_OFFSITE_CMD:-}" ] && M_OFF_CONF=1
  return 0
}
metric() {  # <ad> <yardım> <değer>
  printf '# HELP %s %s\n# TYPE %s gauge\n%s %s\n' "$1" "$2" "$1" "$1" "$3"
}
write_status() {  # <last_run_ok>; atomik (aynı dizinde geçici dosya + mv)
  local ok="$1" dir tmp
  dir="$(dirname -- "$STATUS_FILE")"
  { mkdir -p -- "$dir" && chmod 755 "$dir"; } 2>/dev/null || true
  tmp="$(mktemp "$dir/.status.prom.XXXXXX" 2>/dev/null)" || { log "uyarı: $STATUS_FILE yazılamadı"; return 0; }
  {
    metric remote_backup_last_success_timestamp_seconds 'Son basarili yedegin zamani (epoch).' "$M_LAST_SUCCESS"
    metric remote_backup_last_run_ok 'Son calistirma basarili mi (1/0).' "$ok"
    metric remote_backup_offsite_configured 'BACKUP_OFFSITE_CMD tanimli mi (1/0).' "$M_OFF_CONF"
    metric remote_backup_offsite_last_success_timestamp_seconds 'Son basarili site disi kopyanin zamani (epoch).' "$M_OFF_SUCCESS"
    metric remote_backup_offsite_last_rc 'Son site disi kanca cikis kodu (0 basarili).' "$M_OFF_RC"
    metric remote_backup_audit_continuity_ok 'Audit sureklilik denetimi gecti mi (1/0).' "$M_AUDIT_OK"
  } > "$tmp"
  chmod 644 "$tmp"; mv -f -- "$tmp" "$STATUS_FILE"
}

# --- alarm -----------------------------------------------------------------------------------------------------------
# `backup.sh --alert` (OnFailure birimi): journal + BACKUP_ALERT_CMD. Komut metninde sır varsa ÇALIŞTIRILMAZ (G-P13b-7).
alert_mode() {
  local msg rc
  msg="remote-backup: FAILED host=$(hostname) zaman=$(ts) — ayrıntı: journalctl -u ${BACKUP_UNIT_NAME:-remote-backup.service} -n 50"
  printf '%s\n' "$msg" >&2
  [ "$ENV_OK" = 1 ] || { log "backup.env güvensiz — BACKUP_ALERT_CMD ÇALIŞTIRILMADI"; return 1; }
  [ -n "${BACKUP_ALERT_CMD:-}" ] || return 0
  if cmd_has_inline_secret "$BACKUP_ALERT_CMD"; then
    log "HATA: BACKUP_ALERT_CMD komut metninde sır var (G-P13b-7: curl -K <root 600 dosya> kullanın) — ÇALIŞTIRILMADI"; return 1
  fi
  # Komut yapılandırmadan gelir (root'a ait 600 dosya); mesaj REMOTE_BACKUP_MSG ortam değişkeniyle verilir.
  REMOTE_BACKUP_MSG="$msg" sh -c "$BACKUP_ALERT_CMD" || { rc=$?; log "uyarı: BACKUP_ALERT_CMD başarısız (rc=$rc)"; return 1; }
}
offsite_alert() {  # <mesaj>: başarılı birim içinde uyarı alarmı (rc yutulmaz, loglanır)
  [ -n "${BACKUP_ALERT_CMD:-}" ] || return 0
  if cmd_has_inline_secret "$BACKUP_ALERT_CMD"; then log "HATA: BACKUP_ALERT_CMD komut metninde sır var (G-P13b-7) — çalıştırılmadı"; return 0; fi
  REMOTE_BACKUP_MSG="$1" sh -c "$BACKUP_ALERT_CMD" || log "uyarı: BACKUP_ALERT_CMD başarısız (rc=$?)"
}

# --- site dışı kanca (ADR-0020 m.4, G-P13b-6) -------------------------------------------------------------------------
# root DEĞİL: BACKUP_OFFSITE_USER (vars. remote-offsite; uid ≠ 0) olarak setpriv ile, `env -i` (yalnız PATH, HOME ve
# REMOTE_BACKUP_*), cwd /. Bu kullanıcı yalnız bu çalıştırmanın dizinini grup okumasıyla görür (BACKUP_DIR 710
# root:<grup>, run 750, dosyalar 640); imza anahtarı, deploy/.env ve diğer çalıştırmalar ona kapalıdır. Süre:
# min(BACKUP_OFFSITE_TIMEOUT_SEC, birim bütçesinden kalan − 10 dk); TERM'den 60 sn sonra KILL. Hata yedeği başarısız
# saymaz (yerel yedek yayımlandı): OFFSITE-FAILED + BACKUP_ALERT_CMD. Komut metni loga yazılmaz.
# S-P13b-6: açılan izin OFFSITE_OPEN bayrağıyla izlenir; kanca/betik öldürülse de on_exit -> offsite_close geri alır.
OFFSITE_OPEN=""
offsite_close() {
  [ -n "$OFFSITE_OPEN" ] || return 0
  chmod 600 "$OFFSITE_OPEN/"* 2>/dev/null || true
  chmod 700 "$OFFSITE_OPEN" "$BACKUP_DIR" 2>/dev/null || true
  OFFSITE_OPEN=""
}
# SIGKILL'de trap çalışmaz: sonraki çalıştırma (kilit alındıktan sonra) grup izinlerini normalleştirir. YALNIZ çalıştırma
# dizinleri: BACKUP_DIR'deki başka dosyalara (ör. taban çizgisi işareti) dokunulmaz — 644 bir işaret 600'e çevrilip
# geçerli sayılmasın (izin denetimini atlatırdı).
offsite_normalize() {
  local d
  for d in "$BACKUP_DIR"/[0-9]*Z; do
    [[ "${d##*/}" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] && [ -d "$d" ] && [ ! -L "$d" ] || continue
    chmod 700 "$d"; find "$d" -maxdepth 1 -type f -perm -g+r -exec chmod 600 {} +
  done
}
offsite_run() {  # <run>
  local run="$1" rdir="$BACKUP_DIR/$1" off_rc=0 off_t0 user tmo budget remain uid gid home msg
  if [ -z "${BACKUP_OFFSITE_CMD:-}" ]; then
    printf '%s remote-backup: OFFSITE-UNCONFIGURED (uyarı: site dışı kopya yok)\n' "$(ts)" >&2; return 0
  fi
  off_t0="$(date -u +%s)"
  user="${BACKUP_OFFSITE_USER:-remote-offsite}"
  tmo="${BACKUP_OFFSITE_TIMEOUT_SEC:-1800}"; budget="${BACKUP_UNIT_TIMEOUT_SEC:-7200}"
  case "$tmo$budget" in *[!0-9]*) tmo=1800; budget=7200; log "uyarı: kanca süre ayarı sayı değil, varsayılan" ;; esac
  remain=$(( budget - ($(date -u +%s) - START_EPOCH) - 600 - 60 ))
  [ "$tmo" -le "$remain" ] || tmo="$remain"
  uid="$(awk -F: -v u="$user" '$1 == u {print $3}' /etc/passwd)"
  gid="$(awk -F: -v u="$user" '$1 == u {print $4}' /etc/passwd)"
  home="$(awk -F: -v u="$user" '$1 == u {print $6}' /etc/passwd)"
  if cmd_has_inline_secret "$BACKUP_OFFSITE_CMD"; then
    log "HATA: BACKUP_OFFSITE_CMD komut metninde sır var (G-P13b-7: kimlik kancanın kullanıcısının 600 dosyasında olmalı)"; off_rc=126
  elif [ -z "$uid" ] || [ "$uid" = 0 ] || [ -z "$gid" ] || [ "$gid" = 0 ]; then
    log "HATA: kanca kullanıcısı '$user' yok ya da root (uid/gid 0) — kanca root olarak ÇALIŞTIRILMAZ (runbook §18)"; off_rc=126
  elif ! command -v setpriv >/dev/null 2>&1; then
    log "HATA: setpriv yok (util-linux) — kanca çalıştırılmadı"; off_rc=127
  elif ! setpriv --reuid="$uid" --regid="$gid" --clear-groups test -x "$(dirname -- "$BACKUP_DIR")"; then
    log "HATA: '$user' BACKUP_DIR'in üst dizinlerine giremiyor (ör. /var/backups 755 olmalı) — kanca çalıştırılmadı"; off_rc=126
  elif [ "$tmo" -lt 60 ]; then
    log "HATA: birim süre bütçesinde kanca için yer kalmadı (BACKUP_UNIT_TIMEOUT_SEC)"; off_rc=124
  else
    OFFSITE_OPEN="$rdir"
    chgrp "$gid" "$BACKUP_DIR" "$rdir" "$rdir/"*.age "$rdir/manifest.json" "$rdir/manifest.json.sig"
    chmod 710 "$BACKUP_DIR"; chmod 750 "$rdir"
    chmod 640 "$rdir/"*.age "$rdir/manifest.json" "$rdir/manifest.json.sig"
    (cd / && exec timeout -k 60 "$tmo" setpriv --reuid="$uid" --regid="$gid" --clear-groups \
      --inh-caps=-all --bounding-set=-all --no-new-privs \
      env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME="${home:-/nonexistent}" \
        REMOTE_BACKUP_RUN_DIR="$rdir" REMOTE_BACKUP_RUN="$run" REMOTE_BACKUP_DIR="$BACKUP_DIR" \
        REMOTE_BACKUP_HOST="$HOST_SHORT" REMOTE_BACKUP_ENV="$DEPLOY_ENV_VAL" sh -c "$BACKUP_OFFSITE_CMD" \
      </dev/null >/dev/null 2>&1) || off_rc=$?
    offsite_close   # okuma izni yalnız kanca süresince: dizin 700, dosyalar 600
  fi
  M_OFF_RC="$off_rc"
  if [ "$off_rc" -eq 0 ]; then
    M_OFF_SUCCESS="$(date -u +%s)"
    printf '%s remote-backup: OFFSITE OK run=%s sure=%ss\n' "$(ts)" "$run" "$(( $(date -u +%s) - off_t0 ))" >&2
  else
    msg="remote-backup: OFFSITE-FAILED run=$run rc=$off_rc host=$HOST_SHORT (yerel yedek tamam; runbook §19 'site dışı kanca başarısız')"
    printf '%s %s\n' "$(ts)" "$msg" >&2
    offsite_alert "$msg"
  fi
}
