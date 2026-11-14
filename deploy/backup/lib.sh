# shellcheck shell=bash
# backup.sh ve restore.sh ortak yardımcıları (P13a; docs/mimari-p13.md §4, runbook §18). Doğrudan çalıştırılmaz.
# Taşınabilirlik: Ubuntu 24.04 (GNU), Alpine (busybox) ve macOS (BSD) araçlarıyla çalışır; GNU'ya özgü
# `find -printf`, `stat -c`, `date -d` kullanılmaz. Volume içeriği ve özet listesi MySQL imajındaki GNU araçlarıyla
# (konteyner içinde) hesaplanır, böylece yedek alınan makine ile doğrulayan makine aynı çıktıyı üretir.

# Yalnız bu anahtarlar backup.env'den okunur (dosya `source` edilmez: kod çalıştırmaz). Ortamda zaten tanımlı
# olan değer dosyadakini ezer (test/elle çalıştırma için).
BACKUP_ENV_KEYS="BACKUP_DIR BACKUP_AGE_RECIPIENT BACKUP_KEEP_DAYS BACKUP_ALERT_CMD BACKUP_MIN_FREE_MB BACKUP_EXPECTED_TRIGGERS
  BACKUP_SIGNING_KEY BACKUP_OFFSITE_CMD BACKUP_OFFSITE_TIMEOUT_SEC BACKUP_OFFSITE_USER BACKUP_UNIT_TIMEOUT_SEC BACKUP_STATUS_FILE"

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { printf '%s %s: %s\n' "$(ts)" "${LOG_TAG:-remote-backup}" "$*" >&2; }
die() { log "HATA: $*"; exit 1; }

need_cmd() {
  local c
  for c in "$@"; do command -v "$c" >/dev/null 2>&1 || die "'$c' bulunamadı (kurulum: runbook §18.1)"; done
}

# S-P13a-7: backup.env fiilen root kodudur (BACKUP_ALERT_CMD root olarak çalışır). Dosya varsa sahibi root (uid 0) ve
# izni tam 600 (veya 400) olmalı; değilse okunmaz. 0 = güvenli veya dosya yok, 1 = güvensiz (mesaj stderr'de).
env_file_secure() {
  local file="$1" perm uid
  [ -e "$file" ] || return 0
  [ -f "$file" ] && [ ! -L "$file" ] || { log "HATA: $file normal dosya değil"; return 1; }
  read -r perm _ uid _ < <(ls -ln "$file")
  perm="${perm:0:10}"
  if [ "$uid" != 0 ] || { [ "$perm" != "-rw-------" ] && [ "$perm" != "-r--------" ]; }; then
    log "HATA: $file sahibi root ve izni 600 olmalı (bulunan: uid=$uid $perm). Düzeltme: chown root:root $file && chmod 600 $file"
    return 1
  fi
}

load_env_file() {
  local file="$1" line key val
  [ -f "$file" ] || return 0
  env_file_secure "$file" || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    key="${line%%=*}"; val="${line#*=}"
    case " $(printf '%s' "$BACKUP_ENV_KEYS" | tr -s ' \n' '  ') " in *" $key "*) ;; *) continue ;; esac
    # Çevreleyen tek/çift tırnak kaldırılır (değer içi kaçış yorumlanmaz).
    case "$val" in \"*\") val="${val#\"}"; val="${val%\"}" ;; \'*\') val="${val#\'}"; val="${val%\'}" ;; esac
    if [ -z "${!key+x}" ]; then printf -v "$key" '%s' "$val"; export "${key?}"; fi
  done < "$file"
}

# sha256 (çıktı yalnız 64 hex). Linux/busybox/macOS 15+ `sha256sum`, eski macOS `shasum -a 256`.
sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}
size_file() { wc -c < "$1" | tr -d ' '; }

# Epoch -> 20261114T020000Z (GNU `date -d @`, BSD `date -r`).
fmt_epoch() {
  date -u -d "@$1" +%Y%m%dT%H%M%SZ 2>/dev/null || date -u -r "$1" +%Y%m%dT%H%M%SZ
}

# MySQL imajı: deploy/docker-compose.yml'deki sabit sürüm + digest (tek kaynak).
compose_mysql_image() {
  local f="$1/docker-compose.yml" img
  img="$(awk '$1 == "image:" && $2 ~ /^mysql:/ {print $2; exit}' "$f" 2>/dev/null || true)"
  [ -n "$img" ] || die "$f içinde mysql imajı bulunamadı"
  printf '%s\n' "$img"
}

# stdin: uploads.tar.gz (düz). stdout: "<dosya sayısı> <özet listesinin sha256'sı>".
# Liste = arşivden çıkan her normal dosya için `sha256sum` satırı ("<hex>  ./yol"), LC_ALL=C sıralı. Arşivden
# hesaplanır (canlı volume'dan değil): yedek ile doğrulama aynı içeriği karşılaştırır, arada yüklenen dosya
# yanlış alarm üretmez. Konteyner ağsız; arşiv /tmp'ye (konteyner katmanı) açılır ve konteynerle silinir.
uploads_digest() {
  local image="$1"
  docker run --rm -i --network none --cap-drop ALL --security-opt no-new-privileges:true --user 0 \
    --entrypoint bash "$image" -c '
      set -euo pipefail; mkdir /tmp/u; tar -C /tmp/u --no-same-owner --no-same-permissions -xzf -
      cd /tmp/u; list="$(find . -type f -print0 | LC_ALL=C sort -z | xargs -0r sha256sum)"
      n=0; [ -z "$list" ] || n="$(printf "%s\n" "$list" | wc -l)"
      printf "%s %s\n" "$n" "$(printf "%s" "$list" | sha256sum | cut -d" " -f1)"'
}

# Aynı listeyi doğrudan bir volume'dan (staging geri yüklemesinden sonra) hesaplar.
volume_digest() {
  local image="$1" vol="$2"
  docker run --rm --network none --read-only --cap-drop ALL --cap-add DAC_READ_SEARCH \
    --security-opt no-new-privileges:true --user 0 -v "$vol:/u:ro" --entrypoint bash "$image" -c '
      set -euo pipefail; cd /u; list="$(find . -type f -print0 | LC_ALL=C sort -z | xargs -0r sha256sum)"
      n=0; [ -z "$list" ] || n="$(printf "%s\n" "$list" | wc -l)"
      printf "%s %s\n" "$n" "$(printf "%s" "$list" | sha256sum | cut -d" " -f1)"'
}

# stdin -> stdout: mysqldump (--skip-extended-insert) akışını DEĞİŞTİRMEDEN geçirir (düz döküm diske yazılmaz, S-P13a-3).
# Yan dosyalar: $1 = "<tablo>\t<satır>" (CREATE TABLE olan her tablo, boşsa 0; satır başına bir INSERT olduğundan sayım
# kesin ve tutarlı anlık görüntüden), $2 = "last\t<son satır>", "triggers\t<n>", "triggerNames\t<a,b,c>".
dump_tee_meta() {
  awk -v rows="$1" -v meta="$2" '
    { print }
    /^CREATE TABLE `/ { t=$3; gsub(/`/, "", t); if (!(t in c)) { c[t]=0; o[++n]=t } }
    /^INSERT INTO `/  { t=$3; gsub(/`/, "", t); c[t]++ }
    /^\/\*!50003 CREATE\*\/ \/\*!50017 DEFINER=/ { tr++; x=$0; sub(/.*TRIGGER `/, "", x); sub(/`.*/, "", x); names = names (tr > 1 ? "," : "") x }
    { last=$0 }
    END {
      for (i=1; i<=n; i++) printf "%s\t%d\n", o[i], c[o[i]] > rows
      printf "last\t%s\ntriggers\t%d\ntriggerNames\t%s\n", last, tr, names > meta
    }'
}

# stdin: sha256 (64 hex) / bayt sayısı — akış üzerinde (dosya gerektirmez).
sha256_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'; else shasum -a 256 | awk '{print $1}'; fi
}

# stdin -> stdout: tek satırlık tetikleyici gövdesi sonda ';' ile saklanmışsa (P11 `audit_logs_no_update`:
# "... SET MESSAGE_TEXT = '...'; */;;") mysqldump çıktısı MySQL'e geri yüklenirken 1064 verir (sürüm yorumu içinde
# ifade ';' ile biter, ardından gelen '*/' sözdizimi hatası). Yalnız tetikleyici CREATE satırının sonundaki
# "; */;;" -> " */;;" yapılır; gövde anlamı değişmez. P13a migration'ı tetikleyiciyi BEGIN…END ile yeniden kurdu; bu
# normalleştirme yalnız P13a ÖNCESİ dökümler için gerekir (P13a sonrası dökümde eşleşme yoktur; runbook §18.4).
fix_trigger_dump() {
  sed -E '/^\/\*!50003 CREATE\*\/ \/\*!50017 DEFINER=/ s/;[[:space:]]*\*\/;;$/ *\/;;/'
}

# S-P13a-2: dökümde mysql istemci meta-komutu var mı? stdout: şüpheli satır sayısı (akışın tamamını okur; `grep -q`
# erken çıkıp pipefail altında yanlış sonuç verirdi). mysqldump bu komutları hiç üretmez; bulunursa döküm kurcalanmıştır.
# Yükleme ayrıca `--system-command=OFF` ile yapılır (iki kat savunma).
# Kurallar (mysql istemcisinin ayrıştırmasına göre):
#  1) Kısa biçim `\X` istemci tarafından satırın HER yerinde (tırnak dışında) yorumlanır: `SELECT 1; \! id`. Tırnaklı
#     veri ('…' "…" `…`; içte `\` kaçışı ve '' ikilemesi) satırlar arası durum korunarak atlanır; tırnak dışında kalan
#     her ters bölü işaretlenir. mysqldump tırnak dışında ters bölü üretmez -> bilinen dökümde yanlış pozitif yok.
#     Yorum (`/* */`, `-- `, `#`) içi de taranır (ihtiyatlı; yorumda ters bölü olan elle yazılmış SQL işaretlenebilir).
#  2) Uzun biçimler (system, source, tee, pager, connect, use, edit, charset) satır başında (tırnak dışındayken).
#     `DELIMITER` (mysqldump tetikleyicilerde kullanır) serbest.
# Kapanmamış tırnak satır sonuna taşınır (istemci de öyle yapar); dosya sonunda açık tırnak kalırsa da işaretlenir.
dump_client_command_count() {
  awk -v sq="'" '
    BEGIN { q = ""; bad = 0; anyq = "[" sq "\"`\\\\]" }
    {
      line = $0; flagged = 0
      if (q == "" && tolower(line) ~ /^[[:space:]]*(system|source|tee|pager|connect|use|edit|charset)([[:space:]]|;|$)/) flagged = 1
      while (length(line) > 0) {
        if (q != "") {
          # açık tırnağın sonunu ara: kaçışlı karakterler ve ikilenmiş tırnak tırnağı kapatmaz
          if (q == "`") re = "^[^`]*`"
          else if (q == sq) re = "^([^" sq "\\\\]|\\\\.|" sq sq ")*" sq
          else re = "^([^\"\\\\]|\\\\.|\"\")*\""
          if (match(line, re)) { line = substr(line, RSTART + RLENGTH); q = "" } else { line = ""; break }
        } else {
          if (!match(line, anyq)) break
          c = substr(line, RSTART, 1)
          if (c == "\\") { flagged = 1; line = substr(line, RSTART + 1); continue }
          q = c; line = substr(line, RSTART + 1)
        }
      }
      if (flagged) bad++
    }
    END { if (q != "") bad++; print bad + 0 }'
}

# --- P13b (docs/mimari-p13.md §7.6, ADR-0020) -------------------------------------------------------------------------

# deploy/.env'den DEPLOY_ENV (dosya `source` edilmez; son tanım geçerli, çevreleyen tırnak atılır). Ortam değişkeni
# DİKKATE ALINMAZ: ortam kilidi (S-P13a-6) yığının kendi yapılandırmasından gelir. stdout: değer (geçersiz/boşsa boş).
deploy_env_of() {
  local v
  v="$(awk -F= '$1 == "DEPLOY_ENV" {sub(/^[^=]*=/, ""); v=$0} END {print v}' "$1/.env" 2>/dev/null || true)"
  v="${v%$'\r'}"; v="${v#\"}"; v="${v%\"}"; v="${v#\'}"; v="${v%\'}"
  case "$v" in development|staging|production) printf '%s\n' "$v" ;; *) printf '\n' ;; esac
}

# Dosya sahibi root (uid 0) ve izni 600/400 mü (imza anahtarı). 0 = evet.
file_root_600() {
  local perm uid
  [ -f "$1" ] && [ ! -L "$1" ] || return 1
  read -r perm _ uid _ < <(ls -ln "$1")
  perm="${perm:0:10}"
  [ "$uid" = 0 ] && { [ "$perm" = "-rw-------" ] || [ "$perm" = "-r--------" ]; }
}

# G-P13b-7: alarm/kanca komut metninde sır argümanı (Telegram bot token'ı URL'de, x-api-key başlığı) varsa 0 döner.
# Sır süreç argümanında /proc/<pid>/cmdline ile okunur; bu komutlar ÇALIŞTIRILMAZ (fail-closed). Doğrusu: curl -K <dosya>.
cmd_has_inline_secret() {
  printf '%s' "$1" | grep -Eiq 'api\.telegram\.org/bot[0-9]|x-api-key[[:space:]]*:|authorization[[:space:]]*:[[:space:]]*bearer[[:space:]]+[a-z0-9]'
}

# ssh-keygen -Y verify için zaman: manifest createdUtc (2026-11-15T23:00:00Z) -> 20261115230000Z. Geçersizse boş.
sig_time_of() {
  [[ "$1" =~ ^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})Z$ ]] || { printf '\n'; return; }
  printf '%s%s%s%s%s%sZ\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" "${BASH_REMATCH[4]}" \
    "${BASH_REMATCH[5]}" "${BASH_REMATCH[6]}"
}

# 2026-11-15T23:00:00Z -> epoch (GNU `date -d`, busybox `date -D`, BSD `date -j -f`). Geçersizse boş.
utc_to_epoch() {
  date -u -d "$1" +%s 2>/dev/null || date -u -D '%Y-%m-%dT%H:%M:%SZ' -d "$1" +%s 2>/dev/null \
    || date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$1" +%s 2>/dev/null || printf '\n'
}

# Manifest imzasını doğrular (ADR-0020 m.1, G-P13b-8). <manifest> <allowed_signers> -> stdout: imzalayan anahtarın
# SHA256 parmak izi; 0 = geçerli. Doğrulama manifestin createdUtc anına göre yapılır (-Overify-time; OpenSSH >= 8.9):
# rotasyonda eski satıra valid-before=<rotasyon anı> yazılır, o andan ÖNCE imzalanmış yedekler doğrulanmaya devam eder.
# createdUtc imzanın kapsamındadır; değiştirilirse imza tutmaz.
verify_manifest_sig() {
  local manifest="$1" allowed="$2" sig="$1.sig" created vt principal out fp
  [ -f "$manifest" ] && [ -f "$sig" ] && [ -f "$allowed" ] || return 1
  created="$(jq -r '.createdUtc // empty' "$manifest" 2>/dev/null || true)"
  vt="$(sig_time_of "$created")"; [ -n "$vt" ] || return 1
  principal="$(ssh-keygen -Y find-principals -s "$sig" -f "$allowed" -Overify-time="$vt" 2>/dev/null | head -n 1)" || return 1
  [[ "$principal" =~ ^[A-Za-z0-9@._+-]{1,128}$ ]] || return 1
  out="$(ssh-keygen -Y verify -f "$allowed" -I "$principal" -n remote-backup -s "$sig" -Overify-time="$vt" \
    < "$manifest" 2>&1)" || return 1
  fp="$(printf '%s\n' "$out" | grep -Eo 'SHA256:[A-Za-z0-9+/]{43}' | head -n 1)"
  [ -n "$fp" ] || return 1
  printf '%s\n' "$fp"
}

# SQL dosyaları (dba arayüzü): deploy/mysql/ (BACKUP_DEPLOY_DIR'den bağımsız; betikle aynı sürüm).
sql_dir() { (cd "$SCRIPT_DIR/../mysql" && pwd); }

# --- backup.sh yardımcıları (dosya ≤ 300 satır kuralı için buraya taşındı) ---------------------------------------------
# side <fifo-adı> <komut...>: $WORK/<fifo-adı> FIFO'sunu okuyan arka plan süreci; çıktısı $WORK/<fifo-adı>.out (BG_PIDS).
side() {
  local name="$1"; shift
  mkfifo -m 600 "$WORK/$name"
  "$@" < "$WORK/$name" > "$WORK/$name.out" &
  BG_PIDS+=("$!")
}
wait_side() { local p; for p in "${BG_PIDS[@]}"; do wait "$p" || die "yan hesap süreci başarısız"; done; BG_PIDS=(); }
count_bytes() { wc -c | tr -d ' '; }

# rotate_runs <bu run> <audit referans run>: adı (UTC zaman) KEEP_DAYS gün + 1 saatten eski çalıştırmalar silinir -> her
# yedek en az KEEP_DAYS gün kalır. Audit karşılaştırma referansı (son İYİ manifest) silinmez: aksi hâlde FAILED süren bir
# durum KEEP_DAYS sonra "ilk"e döner. Sonuç (backup.sh okur): removed, kept.
# shellcheck disable=SC2034
rotate_runs() {
  local cutoff d name
  cutoff="$(fmt_epoch $(( $(date -u +%s) - KEEP_DAYS * 86400 - 3600 )))"
  removed=0
  for d in "$BACKUP_DIR"/*; do
    [ -d "$d" ] || continue
    name="${d##*/}"
    [[ "$name" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || continue
    [ "$name" != "$1" ] && [ "$name" != "$2" ] || continue
    if [[ "$name" < "$cutoff" ]]; then rm -rf -- "$d"; removed=$((removed + 1)); fi
  done
  kept="$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '[0-9]*Z' | wc -l | tr -d ' ')"
}

# backup_lock: $BACKUP_DIR/.lock (mkdir atomik; pid yazılır). Canlı sahibi varsa çıkar, ölü kilit temizlenir. Sonuç: LOCK.
# backup.sh ve `backup.sh --reset-audit-baseline` (S-P13b-11) aynı kilidi kullanır.
# shellcheck disable=SC2034
backup_lock() {
  local dir="$BACKUP_DIR/.lock" oldpid
  if ! mkdir -- "$dir" 2>/dev/null; then
    oldpid="$(cat -- "$dir/pid" 2>/dev/null || true)"
    if [ -n "$oldpid" ] && kill -0 "$oldpid" 2>/dev/null; then die "başka bir yedek/sıfırlama çalışıyor (pid $oldpid)"; fi
    log "ölü kilit temizlendi (pid ${oldpid:-?})"; rm -rf -- "$dir"; mkdir -- "$dir"
  fi
  LOCK="$dir"; echo $$ > "$dir/pid"
}
