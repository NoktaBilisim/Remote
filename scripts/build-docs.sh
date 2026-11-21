#!/usr/bin/env bash
# README.md, docs/KULLANIM_KILAVUZU.md ve docs/DATASHEET.md dosyalarından docs/pdf/ altına 3 PDF üretir.
# Ortak Nokta Bilişim doküman aracını çağırır (Projeler/CLAUDE.md §1.7, mimari §10.5 W1).
#
# Kullanım:  scripts/build-docs.sh          (veya: pnpm docs:pdf)
# Ortam:     DOCS_PDF_TOOL       araç yolu (varsayılan aşağıda)
#            DOCS_PDF_CHROMIUM   isteğe bağlı Chromium/Chrome yolu (araç okur)
set -euo pipefail

DEFAULT_TOOL="/Users/mennan/Projeler/claude-agents/it-firmasi/tools/docs-pdf/build.mjs"
TOOL="${DOCS_PDF_TOOL:-$DEFAULT_TOOL}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  echo "build-docs: HATA: $*" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "node bulunamadı (Node 22 gerekli)."

if [[ ! -f "$TOOL" ]]; then
  fail "PDF aracı bulunamadı: $TOOL
  Ortak aracı kurun ya da yolunu DOCS_PDF_TOOL ile verin:
    DOCS_PDF_TOOL=/yol/docs-pdf/build.mjs scripts/build-docs.sh"
fi

TOOL_DIR="$(dirname "$TOOL")"
if [[ ! -d "$TOOL_DIR/node_modules" ]]; then
  fail "PDF aracının bağımlılıkları kurulu değil. Bir kez çalıştırın:
    (cd \"$TOOL_DIR\" && npm install)"
fi

SOURCES=(README.md docs/KULLANIM_KILAVUZU.md docs/DATASHEET.md)
OUTPUTS=(README.pdf KULLANIM_KILAVUZU.pdf DATASHEET.pdf)

# Araç eksik kaynağı sessizce atlar; burada üçü de zorunlu.
for src in "${SOURCES[@]}"; do
  [[ -f "$ROOT/$src" ]] || fail "kaynak doküman yok: $src"
done

# Kapak sürümü: ortak araç kök package.json "version" ya da VERSION dosyası yoksa CHANGELOG.md'deki ilk
# "## [x.y.z]" başlığını okur. Bu projede ikisi de bilerek yoktur (tek kaynak CHANGELOG). Başlık yoksa araç "1.0" yazar.
for f in package.json VERSION; do
  if [[ "$f" == VERSION && -f "$ROOT/VERSION" ]] || { [[ "$f" == package.json ]] && grep -q '"version"' "$ROOT/package.json"; }; then
    fail "kökte $f sürümü var; kapak sürümü CHANGELOG.md'den okunmalı. Kaldırın ya da CHANGELOG ile eşitleyin."
  fi
done
COVER_VERSION="$(grep -m1 -oE '^##[[:space:]]*\[?v?[0-9]+\.[0-9]+(\.[0-9]+)?' "$ROOT/CHANGELOG.md" | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' || true)"
[[ -n "$COVER_VERSION" ]] || fail "CHANGELOG.md'de '## [x.y.z]' sürüm başlığı yok; kapak sürümü belirlenemez."
echo "build-docs: kapak sürümü $COVER_VERSION (CHANGELOG.md), tarih $(date -u +%F) (UTC)"

# Eski PDF'ler silinir; böylece aşağıdaki kontrol yalnız bu çalıştırmanın çıktısını görür.
for out in "${OUTPUTS[@]}"; do
  rm -f "$ROOT/docs/pdf/$out"
done

node "$TOOL" "$ROOT"

for out in "${OUTPUTS[@]}"; do
  [[ -s "$ROOT/docs/pdf/$out" ]] || fail "PDF üretilmedi veya boş: docs/pdf/$out"
done

echo "build-docs: 3 PDF hazır -> docs/pdf/ (${OUTPUTS[*]})"
