#!/bin/sh
# TCC rehber metni denetimi (P33 K3; mimari-p33 §5.1 T13, §8.4; S-P33-T-7, AC-556). POSIX sh, Linux ve macOS'ta koşar
# (CI `check` işi + package.sh check). Salt okunur.
#
# Kurallar:
#  1) Müşteriye giden her metinde `tccutil reset <Hizmet> <kimlik>` kimliği BİLİNEN paket kimliklerinden biridir
#     (package.sh `id prod` / `id stg`); kimliksiz `tccutil reset <Hizmet>` (bütün uygulamaları sıfırlar) yasak.
#  2) Aynı metinlerde `tccutil reset All`, `sudo` + tccutil, `csrutil` (SIP kapatma) ve `TCC.db` (veritabanı düzenleme) geçmez.
#  3) OKUBENI dosyaları profil başına TAM kimlik kullanır: OKUBENI.txt + OKUBENI-adhoc.txt → prod, OKUBENI-stg.txt → stg; her biri
#     Mikrofon kaldırma komutunu (`tccutil reset Microphone <kimlik>`) içerir ve başka kimlik içermez.
#  4) --bundle-id <kimlik> --profile <stg|prod> verilirse (package.sh check, paketteki Info.plist CFBundleIdentifier) kimlik o profilin
#     beklenen kimliğine ve o profilin OKUBENI'sindeki tccutil kimliklerine birebir eşit olmalıdır.
#
# Taranan müşteri metinleri (bulunanlar; yoksa atlanır — K0/K7 paralel yazar): build/macos/OKUBENI*.txt, docs/KULLANIM_KILAVUZU.md,
# README.md, apps/web/messages/*.json, apps/web/app/**/mac-guide.tsx, apps/agent-win/internal/ui/**/*.go. Testler (*_test.go,
# *.test.tsx) ve tasarım/denetim raporları (yasak komutları örnek olarak anar) taranmaz.
#
# Kullanım: tcc-rehber-check.sh [--bundle-id <kimlik> --profile <stg|prod>]
# Çıkış: 0 GEÇTİ · 1 kural ihlali · 2 kullanım/ortam hatası.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
PKG="$HERE/package.sh"

die2() { echo "HATA: $*" >&2; exit 2; }
want_bid="" want_prof=""
while [ $# -gt 0 ]; do
  case "$1" in
    --bundle-id) [ $# -ge 2 ] || die2 "--bundle-id değer ister"; want_bid="$2"; shift 2 ;;
    --profile) [ $# -ge 2 ] || die2 "--profile değer ister"; want_prof="$2"; shift 2 ;;
    *) die2 "bilinmeyen argüman: $1" ;;
  esac
done
if [ -n "$want_bid$want_prof" ] && { [ -z "$want_bid" ] || [ -z "$want_prof" ]; }; then die2 "--bundle-id ve --profile birlikte verilir"; fi

PROD_ID="$(sh "$PKG" id prod)" || die2 "package.sh id prod"
STG_ID="$(sh "$PKG" id stg)" || die2 "package.sh id stg"
[ -n "$PROD_ID" ] && [ -n "$STG_ID" ] && [ "$PROD_ID" != "$STG_ID" ] || die2 "paket kimlikleri okunamadı"

bad=0
fail() { echo "FAIL $*" >&2; bad=1; }

# tccutil kimlikleri: "tccutil reset <Hizmet> <sonraki belirteç>" → sonraki belirteç (yoksa boş). Belirteç tırnak/ters tırnak/
# noktalama sonu kırpılmış tam dizgedir (alt dizge değil: `.stg` öneki prod kimliğine uymaz).
# Kaynak kodda (.go/.tsx) yorum satırları metin değildir (geliştirici notu); yalnız metin/dizge satırları taranır.
content() {
  case "$1" in
    *.go | *.tsx) sed -E '/^[[:space:]]*(\/\/|\*|\/\*)/d' "$1" ;;
    *) cat "$1" ;;
  esac
}
ids_in() {
  content "$1" | grep -o 'tccutil reset [A-Za-z][A-Za-z]*[^A-Za-z0-9.]*[A-Za-z0-9.-]*' 2>/dev/null \
    | awk '{ id = (NF >= 4) ? $4 : ""; gsub(/^[^A-Za-z0-9]+/, "", id); sub(/[.]+$/, "", id); print $3 "\t" id }' || true
}

# Kural 1 + 2: tek dosya.
check_file() {
  f="$1" rel="${1#"$ROOT"/}"
  if content "$f" | grep -qi 'tccutil reset all\|csrutil\|TCC\.db'; then
    fail "$rel: yasak öneri (tccutil reset All / csrutil / TCC.db) — S-P33-T-7"
    content "$f" | grep -ni 'tccutil reset all\|csrutil\|TCC\.db' | cut -c1-160 | sed 's/^/  /' >&2
  fi
  if content "$f" | grep 'tccutil' | grep -q 'sudo'; then fail "$rel: tccutil satırında sudo — S-P33-T-7"; fi
  ids_in "$f" | while IFS="$(printf '\t')" read -r svc id; do
    case "$id" in
      "$PROD_ID" | "$STG_ID") ;;
      "") echo "FAIL $rel: kimliksiz 'tccutil reset $svc' (bütün uygulamaları sıfırlar)" >&2; echo x ;;
      *) echo "FAIL $rel: 'tccutil reset $svc $id' bilinmeyen paket kimliği ($PROD_ID / $STG_ID)" >&2; echo x ;;
    esac
  done | grep -q x && bad=1
  return 0
}

# Kural 3: OKUBENI profil eşlemesi.
check_okubeni() {
  f="$HERE/$1" id="$2"
  [ -f "$f" ] || { fail "$1 yok"; return 0; }
  ids_in "$f" | grep -q "^Microphone	$id\$" || fail "$1: 'tccutil reset Microphone $id' satırı yok (AC-556)"
  other="$(ids_in "$f" | cut -f2 | grep -vx "$id" || true)"
  [ -z "$other" ] || fail "$1: profil kimliği $id dışında tccutil kimliği: $(printf '%s' "$other" | tr '\n' ' ')"
}

files="$(
  for f in "$HERE"/OKUBENI*.txt "$ROOT/docs/KULLANIM_KILAVUZU.md" "$ROOT/README.md"; do [ -f "$f" ] && echo "$f"; done
  [ -d "$ROOT/apps/web/messages" ] && find "$ROOT/apps/web/messages" -name '*.json' -type f
  [ -d "$ROOT/apps/web/app" ] && find "$ROOT/apps/web/app" -name 'mac-guide.tsx' -type f -not -path '*/node_modules/*'
  [ -d "$ROOT/apps/agent-win/internal/ui" ] && find "$ROOT/apps/agent-win/internal/ui" -name '*.go' -type f -not -name '*_test.go'
)"
n=0
OLDIFS="$IFS"; IFS='
'
for f in $files; do check_file "$f"; n=$((n + 1)); done
IFS="$OLDIFS"

check_okubeni OKUBENI.txt "$PROD_ID"
check_okubeni OKUBENI-adhoc.txt "$PROD_ID"
check_okubeni OKUBENI-stg.txt "$STG_ID"

if [ -n "$want_prof" ]; then
  exp="$(sh "$PKG" id "$want_prof")" || die2 "profil stg ya da prod olmalı: $want_prof"
  [ "$want_bid" = "$exp" ] || fail "paket CFBundleIdentifier '$want_bid' ≠ $want_prof profil kimliği '$exp'"
  case "$want_prof" in stg) okb="OKUBENI-stg.txt" ;; *) okb="OKUBENI.txt OKUBENI-adhoc.txt" ;; esac
  for o in $okb; do
    ids_in "$HERE/$o" | grep -q "^Microphone	$want_bid\$" \
      || fail "$o: tccutil Mikrofon kimliği paket CFBundleIdentifier '$want_bid' ile aynı değil (S-P33-T-7)"
  done
fi

[ "$bad" = 0 ] || { echo "tcc-rehber-check: BAŞARISIZ" >&2; exit 1; }
echo "tcc-rehber-check: GEÇTİ ($n dosya; kimlikler $PROD_ID / $STG_ID${want_bid:+; paket $want_bid = $want_prof})"
