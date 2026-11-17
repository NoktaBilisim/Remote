#!/bin/sh
# P28g K8a (mimari-p28g §8.2 test-linux-gui): Ubuntu GUI test imajını kurar ve run-gui-tests.sh'i içinde koşar.
# agent-win.yml `test-linux-gui` (matris 2204 / 2404) ve yerel prova AYNI betiği çağırır (docs/runbook.md §28g).
# Kullanım: apps/agent-win/test/linux/gui.sh <2204|2404> [çıktı dizini]
#   Ortam: GO_IMAGE (verilmezse .github/workflows/agent-win.yml `env.GO_IMAGE` okunur — tek sürüm kaynağı),
#          P28G_STRICT=1 (v* etiketi: bekleyen testler / iz betiği kırmızı).
# Apple Silicon'da linux/amd64 emülasyonla koşar (yavaş; glib izin listesi /usr/lib/x86_64-linux-gnu sabit, arm64 imaj olmaz).
# Çıkış: run-gui-tests.sh'in çıkışı (0 geçti, 1 kaldı), 2 kullanım hatası.
set -eu
REL_ARG="${1:-}"
case "$REL_ARG" in 2204) REL=22.04 ;; 2404) REL=24.04 ;; *) echo "kullanım: $0 <2204|2404> [çıktı dizini]" >&2; exit 2 ;; esac
HERE="$(cd "$(dirname "$0")" && pwd)"
AGENT="$(cd "$HERE/../.." && pwd)"
ROOT="$(cd "$AGENT/../.." && pwd)"
OUT="${2:-$AGENT/bin/gui-test-$REL_ARG}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
if [ -z "${GO_IMAGE:-}" ]; then
  GO_IMAGE="$(sed -n 's/^  GO_IMAGE: //p' "$ROOT/.github/workflows/agent-win.yml")"
fi
printf '%s' "$GO_IMAGE" | grep -Eq '^golang:[^@ ]+@sha256:[0-9a-f]{64}$' || { echo "GO_IMAGE digest ile sabit değil: '$GO_IMAGE'" >&2; exit 2; }
TAG="remote-p28g-gui:$REL_ARG"
EMU=0; [ "$(uname -m)" = x86_64 ] || EMU=1

docker build --platform linux/amd64 --pull=false --build-arg GO_IMAGE="$GO_IMAGE" -f "$HERE/Dockerfile.$REL_ARG" -t "$TAG" "$HERE"

# --cap-add SYS_PTRACE: ortam pozitif kontrolündeki strace (adım 6). Ağ açık: go mod download.
# Repo kökü bağlanır (sözleşme testleri packages/contracts fikstürlerini okur); go test kaynakta yazmaz. Testler HOST_UID
# kullanıcısıyla koşar, root değil.
set +e
docker run --rm --platform linux/amd64 --cap-add SYS_PTRACE --shm-size 512m \
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" -e P28G_STRICT="${P28G_STRICT:-0}" -e P28G_REL="$REL" -e P28G_EMULATED="$EMU" \
  -v "$ROOT:/repo" -v "$OUT:/out" "$TAG" bash /repo/apps/agent-win/test/linux/run-gui-tests.sh
rc=$?
set -e
echo "çıktılar: $OUT (ozet-$REL.md, go-test-*-$REL.txt, xi2-offsets-$REL.txt)"
exit "$rc"
