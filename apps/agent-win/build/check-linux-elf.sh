#!/bin/sh
# P28g K8a (mimari-p28g §8.2 build-linux / reproducible-linux, ADR-0038 m.1/m.11, S-P28g-9): Linux istemci ELF denetimi.
# agent-win.yml (build-linux, reproducible-linux) ve yerel prova aynı betiği koşar; K8b publish-linux.sh de kullanabilir.
# Denetimler: ELF64 little-endian x86-64 (e_machine 0x3e), yorumlayıcı /lib64/ld-linux-x86-64.so.2, `readelf -d` NEEDED
# kümesi ⊆ {libc.so.6, libdl.so.2, libpthread.so.0} ve libc.so.6 var (GTK/GStreamer/X11 yalnız dlopen ile — purego, CGO=0),
# boyut ≤ 60 MiB, UPX/packer izi yok. İsteğe bağlı: --server <url> (adres ikilide geçmeli), --forbid <metin> (geçmemeli;
# tekrarlanabilir). TEST/prod kipi ikiliden okunmaz; kip build-meta.txt 3. satırındadır (agent-win.yml).
# Kullanım: build/check-linux-elf.sh <elf> [--server URL] [--forbid METİN]...
# Çıkış: 0 geçti, 1 denetim başarısız, 2 kullanım hatası. Gerekenler: readelf (binutils), od, grep, stat.
set -eu
[ $# -ge 1 ] || { echo "kullanım: $0 <elf> [--server URL] [--forbid METİN]..." >&2; exit 2; }
F="$1"; shift
[ -f "$F" ] || { echo "dosya yok: $F" >&2; exit 2; }
SERVER=""; FORBID_FILE="$(mktemp)"
trap 'rm -f "$FORBID_FILE"' EXIT
while [ $# -gt 0 ]; do
  case "$1" in
    --server) SERVER="${2:?}"; shift 2 ;;
    --forbid) printf '%s\n' "${2:?}" >> "$FORBID_FILE"; shift 2 ;;
    *) echo "bilinmeyen seçenek: $1" >&2; exit 2 ;;
  esac
done
fail() { echo "HATA: $F: $*" >&2; exit 1; }

hdr="$(od -An -tx1 -N20 "$F" | tr -d ' \n')"
case "$hdr" in 7f454c46020101*) ;; *) fail "ELF64 little-endian değil (başlık $hdr)" ;; esac
# e_machine: bayt 18-19 (little-endian) = 3e 00 (x86-64).
[ "$(printf '%s' "$hdr" | cut -c37-40)" = 3e00 ] || fail "x86-64 değil (e_machine $(printf '%s' "$hdr" | cut -c37-40))"

size=$(stat -c %s "$F" 2>/dev/null || stat -f %z "$F")
[ "$size" -le 62914560 ] || fail "boyut $size > 60 MiB (AC-403 / §8.2)"

if grep -aq 'UPX!' "$F"; then fail "UPX/packer izi (ADR-0010)"; fi

interp="$(readelf -lW "$F" | sed -n 's/.*\[Requesting program interpreter: \(.*\)\]/\1/p')"
[ "$interp" = /lib64/ld-linux-x86-64.so.2 ] || fail "yorumlayıcı '$interp' (beklenen /lib64/ld-linux-x86-64.so.2)"

needed="$(readelf -dW "$F" | sed -n 's/.*(NEEDED).*\[\(.*\)\]/\1/p' | sort)"
[ -n "$needed" ] || fail "NEEDED listesi boş (statik ikili? purego dinamik ELF ister)"
printf '%s\n' "$needed" | grep -qx 'libc.so.6' || fail "NEEDED'da libc.so.6 yok"
extra="$(printf '%s\n' "$needed" | grep -vxE 'libc\.so\.6|libdl\.so\.2|libpthread\.so\.0' || true)"
[ -z "$extra" ] || fail "izin dışı NEEDED: $(printf '%s' "$extra" | tr '\n' ' ')(sistem kitaplıkları yalnız dlopen ile; ADR-0038 m.1)"

if [ -n "$SERVER" ]; then
  grep -aqF "$SERVER" "$F" || fail "gömülü adres '$SERVER' ikilide yok"
fi
while IFS= read -r s; do
  [ -n "$s" ] || continue
  if grep -aqF "$s" "$F"; then fail "ikilide olmaması gereken metin var: '$s'"; fi
done < "$FORBID_FILE"

echo "OK: $F ELF64 x86-64, $size bayt, NEEDED: $(printf '%s' "$needed" | tr '\n' ' ')"
