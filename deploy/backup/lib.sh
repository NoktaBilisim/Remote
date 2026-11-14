# shellcheck shell=bash
# backup.sh ve restore.sh ortak yardımcıları (P13a; docs/mimari-p13.md §4, runbook §18). Doğrudan çalıştırılmaz.
# Taşınabilirlik: Ubuntu 24.04 (GNU), Alpine (busybox) ve macOS (BSD) araçlarıyla çalışır; GNU'ya özgü
# `find -printf`, `stat -c`, `date -d` kullanılmaz. Volume içeriği ve özet listesi MySQL imajındaki GNU araçlarıyla
# (konteyner içinde) hesaplanır, böylece yedek alınan makine ile doğrulayan makine aynı çıktıyı üretir.

# Yalnız bu anahtarlar backup.env'den okunur (dosya `source` edilmez: kod çalıştırmaz). Ortamda zaten tanımlı
# olan değer dosyadakini ezer (test/elle çalıştırma için).
BACKUP_ENV_KEYS="BACKUP_DIR BACKUP_AGE_RECIPIENT BACKUP_KEEP_DAYS BACKUP_ALERT_CMD BACKUP_MIN_FREE_MB BACKUP_EXPECTED_TRIGGERS"

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
    case " $BACKUP_ENV_KEYS " in *" $key "*) ;; *) continue ;; esac
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
