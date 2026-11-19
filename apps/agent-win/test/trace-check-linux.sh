#!/bin/bash
# trace-check-linux.sh — Nokta Destek Linux istemcisi kapandıktan sonra iz kalmadığını doğrular (AC-401, mimari-p28g §5.3,
# §9 "İz", S-P28g-11). trace-check-mac.sh kalıbı.
#
# SALT OKUNUR: hiçbir şeyi silmez/değiştirmez. Tek yazım snapshot ile verilen dosyadır.
#
# Kullanım:
#   trace-check-linux.sh snapshot <dosya>            # istemciyi çalıştırmadan ÖNCE
#   trace-check-linux.sh compare  <dosya> [seçenek]  # istemci kapandıktan SONRA (önceki durumla fark)
#   trace-check-linux.sh check    [seçenek]          # önceki durum olmadan yalnız desen taraması
# Seçenekler:
#   --marker <metin>   içerik işareti (tekrarlanabilir; kod, teknisyen adı, dosya adı): YOLLARDA ve --since verilirse
#                      kullanıcı günlüğünde aranır; bulunan içerik basılmaz
#   --exe <yol>        çalıştırılan ikili (kendisi iz sayılmaz; İndirilenler'deki ikili belgelenmiş kalan izdir)
#   --since <zaman>    journalctl --user bu andan itibaren taranır (verilmezse günlük taranmaz)
#
# Taranan yerler (öncesi/sonrası ad farkı): ~/.config (autostart dahil), ~/.cache, ~/.local/share, ~/.local/state, HOME kökü,
# /tmp, /var/tmp, $XDG_RUNTIME_DIR (özel dizin noktadestek-*), İndirilenler (yalnız *.part iz), çalışan süreç.
# İz: yeni yollar (compare) ya da desene uyan yollar: noktadestek, "nokta destek", gst-registry, pulse-cookie.
# Belgelenmiş istisnalar (istemciye ait değil, iz sayılmaz, "Bilgi" olarak listelenir; §5.3, K0s-7):
#   ~/.config/pulse/* (pulseaudio/pipewire-pulse sunucusunun cihaz/ses dosyaları; çerez istemcide özel dizine yönlenir),
#   ~/.local/state/wireplumber/* (24.04 ses oturum yöneticisinin varsayılan aygıt durumu),
#   ~/.config/dconf/user (yalnız dconf servisi yazar), $XDG_RUNTIME_DIR/{at-spi,dconf,gvfs,gvfsd,pulse,pipewire-*,bus,doc}
#   (oturum servisleri, tmpfs), /tmp/.X11-unix ve /tmp/.X*-lock.
# Çıkış: 0 temiz (snapshot: kaydedildi), 1 iz bulundu, 2 kullanım/ortam hatası.
set -u
export LC_ALL=C

PATTERN='noktadestek|nokta destek|gst-registry|pulse-cookie'
EXEMPT='^(Config	.*/\.config/pulse(/|$)|Config	.*/\.local/state/wireplumber(/|$)|Config	.*/\.config/dconf(/user)?$|Runtime	[^	]*/(at-spi|dconf|gvfs|gvfsd|pulse|pipewire-[^/]*|bus|doc)(/|$)|Tmp	/tmp/\.(X11-unix|X[0-9]+-lock|ICE-unix)(/|$))'

usage() { sed -n '2,26p' "$0" >&2; exit 2; }
[ "$(uname -s)" = Linux ] || { echo "HATA: yalnız Linux" >&2; exit 2; }
[ $# -ge 1 ] || usage
mode=$1; shift
snap=""
case "$mode" in
  snapshot|compare) [ $# -ge 1 ] || usage; snap=$1; shift ;;
  check) ;;
  *) usage ;;
esac
since=""; exe=""; markers=()
while [ $# -gt 0 ]; do
  case "$1" in
    --since) [ $# -ge 2 ] || usage; since=$2; shift 2 ;;
    --marker) [ $# -ge 2 ] || usage; markers+=("$2"); shift 2 ;;
    --exe) [ $# -ge 2 ] || usage; exe=$2; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "${HOME:-}" ] && [ -d "$HOME" ] || { echo "HATA: HOME yok" >&2; exit 2; }
rt=${XDG_RUNTIME_DIR:-}

# İndirme dizini: user-dirs.dirs (yalnız "$HOME/…" ya da mutlak biçim) → ~/Downloads.
dl="$HOME/Downloads"
if [ -r "$HOME/.config/user-dirs.dirs" ]; then
  v=$(sed -n 's/^[[:space:]]*XDG_DOWNLOAD_DIR[[:space:]]*=[[:space:]]*"\(.*\)"[[:space:]]*$/\1/p' "$HOME/.config/user-dirs.dirs" | tail -n 1)
  case "$v" in '$HOME'*) dl="$HOME${v#\$HOME}" ;; /*) dl=$v ;; esac
fi

scan() {
  local d
  for d in .config .cache .local/share .local/state; do
    [ -d "$HOME/$d" ] && find "$HOME/$d" -maxdepth 4 2>/dev/null | sed "s|^|Config\t|"
  done
  find "$HOME" -mindepth 1 -maxdepth 1 2>/dev/null | sed "s|^|Home\t|"
  for d in /tmp /var/tmp; do # XDG_RUNTIME_DIR /tmp altındaysa (test düzeneği) yalnız Runtime olarak taranır
    [ -d "$d" ] && find "$d" -maxdepth 2 \( -path "${rt:-/nonexistent}" -o -path "${rt:-/nonexistent}/*" \) -prune -o -print 2>/dev/null |
      sed "s|^|Tmp\t|"
  done
  [ -n "$rt" ] && [ -d "$rt" ] && find "$rt" -maxdepth 2 2>/dev/null | sed "s|^|Runtime\t|"
  [ -d "$dl" ] && find "$dl" -maxdepth 1 -name '*.part' 2>/dev/null | sed "s|^|Downloads\t|"
}

traces_of() {
  local marks
  marks=$(printf '%s\n' "${markers[@]+"${markers[@]}"}")
  awk -F '\t' -v pat="$PATTERN" -v ex="$EXEMPT" -v marks="$marks" -v snap="$snap" -v after="${after:-}" -v exe="$exe" -v all="$1" '
    BEGIN { n = split(tolower(marks), m, "\n") }
    $0 == "" { next }
    $2 == snap || $2 == after || (exe != "" && $2 == exe) { next }
    $0 ~ ex { if (all) print "BILGI\t" $0; next }
    { item = tolower($2); hit = all || ($1 == "Downloads") || (item ~ pat)
      for (i = 1; i <= n && !hit; i++) if (m[i] != "" && index(item, m[i])) hit = 1
      if (hit) print "IZ\t" $0 }'
}

if [ "$mode" = snapshot ]; then
  scan | sort -u > "$snap" || { echo "HATA: $snap yazılamadı" >&2; exit 2; }
  echo "Önceki durum kaydedildi: $snap ($(wc -l < "$snap" | tr -d ' ') girdi)"
  exit 0
fi

after=$(mktemp "${TMPDIR:-/tmp}/trace-check-linux.XXXXXX") || exit 2
trap 'rm -f "$after"' EXIT
scan | sort -u > "$after"

traces=0
if [ "$mode" = compare ]; then
  [ -r "$snap" ] || { echo "HATA: $snap okunamıyor" >&2; exit 2; }
  out=$(comm -13 "$snap" "$after" | traces_of 1)   # compare: her yeni yol iz (istisnalar bilgi)
else
  out=$(traces_of 0 < "$after")
fi
printf '%s\n' "$out" | awk -F '\t' '$1 == "BILGI" { print "Bilgi (belgelenmiş istisna): " $2 "\t" $3 }'
found=$(printf '%s\n' "$out" | awk -F '\t' '$1 == "IZ" { print $2 "\t" $3 }')
if [ -n "$found" ]; then
  printf '%s\n' "$found" | sed 's/^/İZ: /'
  traces=$(printf '%s\n' "$found" | wc -l | tr -d ' ')
fi

# K8b: süreç komut satırına göre değil çalıştırılan dosyaya göre aranır. `pgrep -f` bu betiğin KENDİ komut satırını
# (`compare … --exe …/Destek-12345678`) eşleyip yanlış pozitif veriyordu. /proc/<pid>/exe = istemci ELF'i (yeniden çalıştırma
# /proc/self/exe ile aynı dosya) ya da argv[0]; ad deseni veya --exe yolu ("(deleted)" eki dahil). Okunamayan süreç atlanır.
client_running() {
  local p t want=""
  [ -z "$exe" ] || want=$(readlink -f -- "$exe" 2>/dev/null || printf '%s' "$exe")
  for p in /proc/[0-9]*; do
    [ "${p#/proc/}" != "$$" ] || continue
    # exe bağlantısı (yerli) ve argv[0] (yalnız ilk alan; emülasyonda — Rosetta/qemu — exe yorumlayıcıyı gösterir). Betiğin kendi
    # argv[0]'ı "bash"tır; --exe argümanı ilk alanda olmadığı için eşleşmez.
    for t in "$(readlink "$p/exe" 2>/dev/null)" "$(tr '\0' '\n' < "$p/cmdline" 2>/dev/null | head -n 1)"; do
      [ -n "$t" ] || continue
      t=${t% (deleted)}
      case "${t##*/}" in noktadestek|noktadestek-*) return 0 ;; esac
      [[ "${t##*/}" =~ ^Destek-[0-9]{8}( ?\([0-9]{1,3}\))?$ ]] && return 0
      [ -n "$want" ] && [ "$t" = "$want" ] && return 0
    done
  done
  return 1
}
if client_running; then
  echo "İZ: Process	istemci süreci hâlâ çalışıyor"; traces=$((traces + 1))
fi

if [ -n "$since" ] && command -v journalctl >/dev/null 2>&1; then
  logs=$(journalctl --user --since "$since" -o cat 2>/dev/null) || logs=""
  for m in "${markers[@]+"${markers[@]}"}"; do
    n=$(printf '%s\n' "$logs" | grep -Fic -- "$m")
    if [ "$n" -gt 0 ]; then echo "İZ: Journal	içerik işareti $n satırda (içerik gösterilmez)"; traces=$((traces + 1)); fi
  done
fi

if [ "$traces" -gt 0 ]; then echo "SONUÇ: $traces iz bulundu"; exit 1; fi
echo "SONUÇ: temiz"
exit 0
