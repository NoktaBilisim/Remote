#!/bin/sh
# P28d (ADR-0036 yedek 1, A-PD-1): libopus 1.6.1 → internal/voice/libopus.wasm, tekrarlanabilir derleme.
# - Kaynak: Xiph resmi tarball'ı; SHA-256 Xiph'in yayımladığı SHA256SUMS.txt değeriyle sabit (aşağıda), uyuşmazsa durur.
# - Araç zinciri: wasi-sdk 34 resmi imajı, dizin (index) digest'iyle sabit; --platform sabit (CI = linux/amd64).
# - Konteyner ağsız (--network none) koşar; tarball host'ta indirilip salt okunur bağlanır.
# - Bayraklar sabit: -O2 -g0, -ffile-prefix-map, SOURCE_DATE_EPOCH, kaynaklar C yerelinde sıralı, nesneler sabit adla
#   doğrudan bağlanır (ar yok), --strip-all. Dışa aktarım yalnız nk_* (build/libopus-wasm/nk_opus.c) + memory +
#   _initialize; WASI importu YOK (wazero örneği ana makine işlevi almadan kurulur; import olursa voice testi kırmızı).
# - Bellek: üst sınır 16 MiB (--max-memory; Go tarafı da 256 sayfa sınırı koyar), yığın 1 MiB ve --stack-first
#   (yığın taşması veriyi ezmez, sınır dışı erişim tuzağı olur).
# Kullanım: build/libopus-wasm.sh [çıktı dizini]   (varsayılan internal/voice; CI karşılaştırması için geçici dizin verilir)
# Çıktı: libopus.wasm, libopus.wasm.sha256 (sha256sum biçimi), libopus-COPYING.txt (libopus BSD-3 metni, dağıtımda gerekir).
set -eu

OPUS_VERSION=1.6.1
OPUS_URL="https://downloads.xiph.org/releases/opus/opus-$OPUS_VERSION.tar.gz"
OPUS_SHA256=6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1 # Xiph SHA256SUMS.txt
WASI_SDK_IMAGE="ghcr.io/webassembly/wasi-sdk@sha256:52595085a0ffbaf574d8d678a9aa81305f0b3af81c639291f15bc7713e42848e" # wasi-sdk-34
WASI_SDK_PLATFORM="${WASI_SDK_PLATFORM:-linux/amd64}"
SOURCE_DATE_EPOCH=1767225600 # 2026-01-01T00:00:00Z; çıktıya tarih girmez, araçlar için sabit

if [ "${1:-}" = "--inner" ]; then
  # Konteyner içi: /in (salt okunur: tarball + nk_opus.c), /out (çıktı). Yol /tmp/nkwork sabittir (prefix map).
  export SOURCE_DATE_EPOCH LC_ALL=C TZ=UTC
  CC=/opt/wasi-sdk/bin/clang
  echo "$OPUS_SHA256  /in/opus-$OPUS_VERSION.tar.gz" | sha256sum -c - >/dev/null
  mkdir -p /tmp/nkwork/obj && cd /tmp/nkwork
  tar -xzf "/in/opus-$OPUS_VERSION.tar.gz"
  cp /in/libopus-wasm/nk_opus.c /tmp/nkwork/nk_opus.c
  cd "/tmp/nkwork/opus-$OPUS_VERSION"
  # Kaynak listesi libopus'un kendi *_sources.mk dosyalarından (kayan nokta yapı; x86/ARM/DNN listeleri dışarıda).
  SRCS=$(printf 'include celt_sources.mk\ninclude silk_sources.mk\ninclude opus_sources.mk\nall:\n\t@printf "%%s\\n" $(CELT_SOURCES) $(SILK_SOURCES) $(SILK_SOURCES_FLOAT) $(OPUS_SOURCES) $(OPUS_SOURCES_FLOAT)\n' |
    make -s -f - | sort)
  CFLAGS="--target=wasm32-wasip1 -O2 -g0 -std=gnu99 -fno-ident -ffile-prefix-map=/tmp/nkwork=. \
    -DOPUS_BUILD -DVAR_ARRAYS -DHAVE_LRINTF -DHAVE_LRINT -DPACKAGE_VERSION=\"$OPUS_VERSION\" \
    -Iinclude -Icelt -Isilk -Isilk/float -Isrc"
  OBJS=""
  i=0
  for s in $SRCS ../nk_opus.c; do
    i=$((i + 1))
    o=$(printf '/tmp/nkwork/obj/%03d.o' "$i")
    # shellcheck disable=SC2086
    "$CC" $CFLAGS -c "$s" -o "$o"
    OBJS="$OBJS $o"
  done
  # shellcheck disable=SC2086
  "$CC" --target=wasm32-wasip1 -mexec-model=reactor -O2 -g0 -o /tmp/nkwork/libopus.wasm $OBJS \
    -Wl,--strip-all -Wl,--stack-first -Wl,-z,stack-size=1048576 -Wl,--max-memory=16777216
  cp /tmp/nkwork/libopus.wasm /out/libopus.wasm
  cp COPYING /out/libopus-COPYING.txt
  exit 0
fi

cd "$(dirname "$0")/.."
OUT_DIR="${1:-internal/voice}"
mkdir -p "$OUT_DIR"
OUT_DIR=$(cd "$OUT_DIR" && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/in/libopus-wasm" "$WORK/out"
curl -fsSL --proto '=https' --tlsv1.2 -o "$WORK/in/opus-$OPUS_VERSION.tar.gz" "$OPUS_URL"
if command -v sha256sum >/dev/null 2>&1; then SUM="sha256sum"; else SUM="shasum -a 256"; fi
echo "$OPUS_SHA256  $WORK/in/opus-$OPUS_VERSION.tar.gz" | $SUM -c - >/dev/null || {
  echo "libopus tarball SHA-256 uyuşmuyor" >&2
  exit 1
}
cp build/libopus-wasm/nk_opus.c "$WORK/in/libopus-wasm/"
cp build/libopus-wasm.sh "$WORK/in/"
docker run --rm --network none --platform "$WASI_SDK_PLATFORM" --user "$(id -u):$(id -g)" \
  -v "$WORK/in:/in:ro" -v "$WORK/out:/out" "$WASI_SDK_IMAGE" sh /in/libopus-wasm.sh --inner
cp "$WORK/out/libopus.wasm" "$WORK/out/libopus-COPYING.txt" "$OUT_DIR/"
(cd "$OUT_DIR" && $SUM libopus.wasm >libopus.wasm.sha256)
cat "$OUT_DIR/libopus.wasm.sha256"
