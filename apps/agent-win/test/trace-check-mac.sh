#!/bin/bash
# trace-check-mac.sh — Nokta Destek macOS istemcisi kapandıktan sonra iz kalmadığını doğrular
# (AC-394, ADR-0037 m.8, mimari-p28f §5.3 m.5, §9 "İz testi", S-P28f-14). trace-check.ps1'in macOS eşi.
#
# SALT OKUNUR: hiçbir şeyi silmez/değiştirmez. Tek yazım --snapshot ile verilen dosyadır.
#
# Kullanım:
#   trace-check-mac.sh snapshot <dosya>            # istemciyi çalıştırmadan ÖNCE
#   trace-check-mac.sh compare  <dosya> [seçenek]  # istemci kapandıktan SONRA (önceki durumla fark)
#   trace-check-mac.sh check    [seçenek]          # önceki durum olmadan yalnız desen taraması
# Seçenekler:
#   --since <"YYYY-MM-DD HH:MM:SS">  birleşik log (`log show`) bu andan itibaren taranır (verilmezse log taranmaz)
#   --marker <metin>                 içerik işareti (tekrarlanabilir; ör. kod, teknisyen adı, dosya adı): dosya
#                                    YOLLARINDA ve birleşik logda aranır; bulunan içerik ekrana basılmaz
#   --bundle <yol>                   çalıştırılan .app (kendisi ve bulunduğu klasör iz sayılmaz)
#   --content <metin>                P33 (S-P33-T-8, AC-556): DOSYA İÇERİĞİ işareti (tekrarlanabilir; ör. sahte pencere başlığı
#                                    "GIZLI-BASLIK-123"). ~/Library, DARWIN_USER_CACHE_DIR ve DARWIN_USER_TEMP_DIR ($TMPDIR) altında
#                                    önceki durumdan (compare: snapshot dosyasının zamanı) ya da --since'ten (check) SONRA değişen
#                                    ≤ 20 MiB normal dosyaların içeriğinde ve birleşik logda aranır. Bulunan dosyanın yolu basılır,
#                                    içeriği basılmaz. check kipinde --since zorunludur.
#
# Taranan yerler (öncesi/sonrası ad eşleşmesi):
#   ~/Library/{Application Support,Caches,Preferences,LaunchAgents,Saved Application State,HTTPStorages,WebKit,
#              Containers,Logs,Application Scripts,Cookies}
#   $(getconf DARWIN_USER_CACHE_DIR)  (Metal önbelleği <bundle id>/com.apple.metalfe — spike K0s-7)
#   $(getconf DARWIN_USER_TEMP_DIR)   (yeniden başlatma kod dosyası noktadestek-yeniden-* — S-P28f-13)
#   ~/Downloads                        (yalnız yarım kalan *.part iz sayılır; kabul edilmiş dosyalar iz değil)
#   /Library/LaunchAgents, /Library/LaunchDaemons
#   çalışan noktadestek süreci
# İz deseni (büyük/küçük harf duyarsız): net.noktabilisim.destek, noktadestek, "Nokta Destek", NoktaDestek.
# Sistem tarafından tutulan kayıtlar (TCC veritabanı — Ekran Kaydı, Erişilebilirlik ve P33'ten beri Mikrofon —, LaunchServices,
# CUPS iş geçmişi) istemcinin yazdığı veri değildir; taranmaz (AC-556 tek istisna; kılavuz/OKUBENI: yalnız paket kimlikli
# `tccutil reset <ScreenCapture|Accessibility|Microphone> net.noktabilisim.destek`).
# İçerik taramasında (--content) başka uygulamaların kendi durumu (ör. sahte başlıklı pencereyi açan test uygulamasının Saved
# Application State'i, Terminal geçmişi) yanlış pozitif olabilir: yol basılır, değerlendirme operatörün (runbook §33.4).
#
# Çıkış: 0 temiz (snapshot: kaydedildi), 1 iz bulundu, 2 kullanım/ortam hatası.
set -u
export LC_ALL=C

PATTERN='net\.noktabilisim\.destek|noktadestek|nokta destek'

usage() { sed -n '2,/^set -u/p' "$0" | sed '$d' >&2; exit 2; }
[ "$(uname -s)" = Darwin ] || { echo "HATA: yalnız macOS" >&2; exit 2; }
[ $# -ge 1 ] || usage
mode=$1; shift
snap=""
case "$mode" in
  snapshot|compare) [ $# -ge 1 ] || usage; snap=$1; shift ;;
  check) ;;
  *) usage ;;
esac
since=""; bundle=""; markers=(); contents=()
while [ $# -gt 0 ]; do
  case "$1" in
    --since) [ $# -ge 2 ] || usage; since=$2; shift 2 ;;
    --marker) [ $# -ge 2 ] || usage; markers+=("$2"); shift 2 ;;
    --bundle) [ $# -ge 2 ] || usage; bundle=$2; shift 2 ;;
    --content) [ $# -ge 2 ] && [ -n "$2" ] || usage; contents+=("$2"); shift 2 ;;
    *) usage ;;
  esac
done

if [ "$mode" = check ] && [ ${#contents[@]} -gt 0 ] && [ -z "$since" ]; then
  echo "HATA: check kipinde --content için --since gerekir" >&2; exit 2
fi

cache_dir=$(getconf DARWIN_USER_CACHE_DIR 2>/dev/null) || { echo "HATA: DARWIN_USER_CACHE_DIR alınamadı" >&2; exit 2; }
temp_dir=$(getconf DARWIN_USER_TEMP_DIR 2>/dev/null) || { echo "HATA: DARWIN_USER_TEMP_DIR alınamadı" >&2; exit 2; }
cache_dir=${cache_dir%/}; temp_dir=${temp_dir%/}
lib="$HOME/Library"

# scan: "kategori<TAB>yol" satırları (sıralı). Derinlik sınırlı; okunamayan dizinler sessizce atlanır.
scan() {
  local d
  for d in "Application Support" Caches Preferences LaunchAgents "Saved Application State" HTTPStorages WebKit \
           Containers Logs "Application Scripts" Cookies; do
    [ -d "$lib/$d" ] && find "$lib/$d" -maxdepth 2 2>/dev/null | sed "s|^|Library\t|"
  done
  [ -d "$cache_dir" ] && find "$cache_dir" -maxdepth 2 2>/dev/null | sed "s|^|UserCache\t|"
  [ -d "$temp_dir" ] && find "$temp_dir" -maxdepth 1 2>/dev/null | sed "s|^|UserTemp\t|"
  [ -d "$HOME/Downloads" ] && find "$HOME/Downloads" -maxdepth 1 -name '*.part' 2>/dev/null | sed "s|^|Downloads\t|"
  for d in /Library/LaunchAgents /Library/LaunchDaemons; do
    [ -d "$d" ] && find "$d" -maxdepth 1 2>/dev/null | sed "s|^|System\t|"
  done
}

# traces: stdin'deki "kategori<TAB>yol" satırlarından iz olanlar (tek awk geçişi; satır başına süreç yok).
# İz: İndirilenler'de .part, desene ya da bir içerik işaretine uyan yol. Betiğin kendi dosyaları ve --bundle hariç.
traces_of() {
  local marks
  marks=$(printf '%s\n' "${markers[@]+"${markers[@]}"}")
  awk -F '\t' -v pat="$PATTERN" -v marks="$marks" -v snap="$snap" -v after="${after:-}" -v bundle="$bundle" '
    BEGIN { n = split(tolower(marks), m, "\n"); bdir = bundle; sub(/\/[^\/]*$/, "", bdir) }
    $0 == "" { next }
    $2 == snap || $2 == after { next }
    bundle != "" && ($2 == bundle || index($2, bundle "/") == 1 || $2 == bdir) { next }
    { item = tolower($2); hit = ($1 == "Downloads") || (item ~ pat)
      for (i = 1; i <= n && !hit; i++) if (m[i] != "" && index(item, m[i])) hit = 1
      if (hit) print }'
}

if [ "$mode" = snapshot ]; then
  scan | sort -u > "$snap" || { echo "HATA: $snap yazılamadı" >&2; exit 2; }
  echo "Önceki durum kaydedildi: $snap ($(wc -l < "$snap" | tr -d ' ') girdi)"
  exit 0
fi

after=$(mktemp -t trace-check-mac) || exit 2
trap 'rm -f "$after"' EXIT
scan | sort -u > "$after"

traces=0
if [ "$mode" = compare ]; then
  [ -r "$snap" ] || { echo "HATA: $snap okunamıyor" >&2; exit 2; }
  new=$(comm -13 "$snap" "$after")
  # Önceki durumda da olan izler sayılmaz ama gösterilir (temiz makinede çalıştırın).
  comm -12 "$snap" "$after" | traces_of | sed 's/^/UYARI (önceden vardı): /'
else
  new=$(cat "$after")
fi
found=$(printf '%s\n' "$new" | traces_of)
if [ -n "$found" ]; then
  printf '%s\n' "$found" | sed 's/^/İZ: /'
  traces=$(printf '%s\n' "$found" | wc -l | tr -d ' ')
fi
if [ "$mode" = compare ]; then
  review=$(( $(printf '%s\n' "$new" | grep -c .) - traces ))
  [ "$review" -gt 0 ] && echo "Bilgi: desene uymayan $review yeni girdi (sistem/başka uygulamalar; iz sayılmadı)"
fi

# Çalışan istemci süreci.
if pgrep -x noktadestek >/dev/null 2>&1; then
  echo "İZ: Process	noktadestek süreci hâlâ çalışıyor"; traces=$((traces + 1))
fi

# P33 içerik işaretleri (S-P33-T-8): yalnız önceki durumdan/--since'ten sonra değişen normal dosyalar; içerik basılmaz.
if [ ${#contents[@]} -gt 0 ]; then
  newer=()
  if [ "$mode" = compare ]; then newer=(-newer "$snap"); else newer=(-newermt "$since"); fi
  for root in "$lib" "$cache_dir" "$temp_dir"; do
    [ -d "$root" ] || continue
    while IFS= read -r -d '' f; do
      [ "$f" = "$snap" ] || [ "$f" = "$after" ] && continue
      if [ -n "$bundle" ] && { [ "$f" = "$bundle" ] || [ "${f#"$bundle"/}" != "$f" ]; }; then continue; fi
      for c in "${contents[@]}"; do
        if grep -qF -- "$c" "$f" 2>/dev/null; then
          echo "İZ: Content	$f (içerik işareti; içerik gösterilmez)"; traces=$((traces + 1)); break
        fi
      done
    done < <(find "$root" -type f "${newer[@]}" -size -20971520c -print0 2>/dev/null)
  done
fi

# Birleşik log: istemci log çağrısı yapmaz (S-P28f-14); kod/ad/dosya adı/pencere başlığı geçmemeli. İçerik basılmaz, yalnız sayı.
if [ -n "$since" ]; then
  logs=$(log show --style compact --start "$since" --predicate 'process CONTAINS[c] "noktadestek"' 2>/dev/null) || {
    echo "HATA: log show çalışmadı" >&2; exit 2; }
  for m in "${markers[@]+"${markers[@]}"}" "${contents[@]+"${contents[@]}"}"; do
    n=$(printf '%s\n' "$logs" | grep -Fic -- "$m")
    if [ "$n" -gt 0 ]; then
      echo "İZ: UnifiedLog	içerik işareti $n satırda (içerik gösterilmez)"; traces=$((traces + 1))
    fi
  done
fi

if [ "$traces" -gt 0 ]; then
  echo "SONUÇ: $traces iz bulundu"
  exit 1
fi
echo "SONUÇ: temiz"
exit 0
