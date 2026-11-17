#!/bin/bash
# P28g K8a (mimari-p28g §8.2 test-linux-gui, §9, §5.4 D-P28g-T2-2, §14 m.2, T6/S-P28g-4): Linux GUI test koşucusu.
# test/linux/Dockerfile.{2204,2404} imajının İÇİNDE koşar; dışarıdan test/linux/gui.sh çağırır (CI ve yerel prova aynı yol).
# Sözleşme (test adları, etiket, ortam değişkenleri): docs/implementation.md "P28g K8a"; zorunlu ad listesi test/linux/gui-tests.txt.
#
# Adımlar (her biri kırmızı olabilir; sonuç /out/ozet-<sürüm>.md ve çıkış kodu):
#   1 araç zinciri = go.mod toolchain
#   2 GStreamer envanteri: beyaz listedeki 11 öğe var ve lisansı LGPL / MIT/X11; x264enc vb. GPL/H.264 öğeleri imajda YOK (T6)
#   3 XI2 ofsetleri: xi2-offsets.c imaj başlıklarıyla derlenir → /out/xi2-offsets-<sürüm>.txt (P28G_XI2_OFFSETS)
#   4 X11 katmanı: oturum D-Bus'ı (unix:path=$XDG_RUNTIME_DIR/bus — D-P28g-T2-1 biçimi) + Xvfb :99 1920x1080 (XTEST + XInputExtension)
#   5 ELF: build-linux.sh (.invalid, TEST değil) + check-linux-elf.sh; bu dağıtımda yükleniyor mu (glibc / ld.so)
#   6 ortam pozitif kontrolü (§14 m.2, S-P28g-5): GDK_CORE_DEVICE_EVENTS / GDK_DEBUG / GTK_MODULES / GST_* / LD_PRELOAD + argümanla
#     açılış → strace'te tek yeniden çalıştırma, argümansız, süzülmüş ortam, PATH=/usr/bin:/bin
#   7 go test -tags linuxgui (X11 fazı; adında Wayland geçenler hariç)
#   8 iz testi: test/trace-check-linux.sh (K5) snapshot → boş HOME ile ELF → compare (Wayland süreçleri başlamadan, gürültüsüz)
#   9 Wayland katmanı: pipewire + wireplumber + mutter --headless + xdg-desktop-portal(-gnome); kurulursa Wayland fazı
#  10 zorunlu liste (gui-tests.txt) + "P28g SKIP = kırmızı" kuralı
# Ortam: HOST_UID/HOST_GID (kaynak dizinin sahibi; testler bu kullanıcıyla, root DEĞİL), P28G_STRICT=1 (v* etiketi: bekleyen = kırmızı),
# P28G_EMULATED=1 (gui.sh: konak x86_64 değil; yalnız strace adımı uyarıya düşer).
set -uo pipefail

SRC=/repo/apps/agent-win
OUT=/out
SELF="$SRC/test/linux/run-gui-tests.sh"

# ---------- root bölümü: sistem D-Bus'ı (mutter), kullanıcı, kullanıcıya geçiş ----------
if [ "${1:-}" != --ic ]; then
  [ "$(id -u)" = 0 ] || { echo "root olarak başlatılmalı (gui.sh)" >&2; exit 2; }
  uid="${HOST_UID:-1000}"; gid="${HOST_GID:-1000}"
  [ "$uid" != 0 ] || uid=1000
  getent group "$gid" >/dev/null || groupadd -g "$gid" kullanici
  user="$(getent passwd "$uid" | cut -d: -f1)"
  if [ -z "$user" ]; then useradd -M -d /nonexistent -s /bin/bash -u "$uid" -g "$gid" kullanici; user=kullanici; fi
  # Başsız mutter Docker'da sistem veriyolu ister; logind koltuğu yok (spike K0s-6 düzeneği; gerçek masaüstünde gerekmez).
  mkdir -p /run/dbus /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix
  rm -rf /run/systemd/seats
  dbus-daemon --system --fork --nopidfile 2>/dev/null || dbus-daemon --system --fork || echo "uyarı: sistem D-Bus başlamadı"
  mkdir -p "$OUT" && chown "$uid:$gid" "$OUT"
  exec runuser -u "$user" -- env -i PATH="$PATH" LANG=C.UTF-8 GOTOOLCHAIN=local GOFLAGS=-mod=readonly CGO_ENABLED=0 \
    P28G_STRICT="${P28G_STRICT:-0}" P28G_REL="${P28G_REL:-?}" \
    P28G_EMULATED="${P28G_EMULATED:-0}" bash "$SELF" --ic
fi

# ---------- kullanıcı bölümü ----------
REL="$P28G_REL"
SUM="$OUT/ozet-$REL.md"
: > "$SUM"
FAIL=0
ERRS=0
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; }
trap cleanup EXIT
err()  { echo "::error::[$REL] $*"; echo "- HATA: $*" >> "$SUM"; FAIL=1; ERRS=$((ERRS + 1)); }
warn() { echo "::warning::[$REL] $*"; echo "- UYARI: $*" >> "$SUM"; }
ok()   { echo "[$REL] TAMAM: $*"; echo "- tamam: $*" >> "$SUM"; }
step() { echo; echo "==== [$REL] $*"; }
{ echo "### test-linux-gui Ubuntu $REL"; echo; } >> "$SUM"

XDG_RUNTIME_DIR="/tmp/xdg-$(id -u)"; export XDG_RUNTIME_DIR
mkdir -p "$XDG_RUNTIME_DIR" && chmod 0700 "$XDG_RUNTIME_DIR"
export HOME; HOME="$(mktemp -d /tmp/ev.XXXXXX)"
export GOCACHE=/tmp/gocache GOMODCACHE=/tmp/gomod GOPATH=/tmp/gopath
export GST_REGISTRY=/tmp/gst-registry.bin
cd "$SRC" || exit 2

step "1 araç zinciri"
want="go$(sed -n 's/^toolchain go//p' go.mod)"
if [ "$(go env GOVERSION)" = "$want" ]; then ok "Go $want"; else err "imajdaki Go $(go env GOVERSION), go.mod $want — agent-win.yml GO_IMAGE"; fi
if ! go mod download >/dev/null 2>&1; then err "go mod download başarısız"; fi

step "2 GStreamer envanteri (T6, S-P28g-4)"
e0=$ERRS
for f in ximagesrc pipewiresrc videorate videoconvert videoscale tee queue valve vp8enc appsink capsfilter; do
  info="$(gst-inspect-1.0 "$f" 2>/dev/null)" || { err "GStreamer öğesi yok: $f"; continue; }
  lic="$(printf '%s\n' "$info" | sed -n 's/^  License[[:space:]]*//p' | head -1)"
  case "$lic" in LGPL|MIT/X11) ;; *) err "$f lisansı '$lic' (LGPL ya da MIT/X11 bekleniyordu)" ;; esac
done
for f in x264enc x265enc openh264enc avenc_h264 avenc_h264_omx vah264enc vaapih264enc nvh264enc msdkh264enc; do
  if gst-inspect-1.0 "$f" >/dev/null 2>&1; then err "imajda yasak öğe var: $f (ugly/bad/libav kurulmamalı)"; fi
done
[ "$ERRS" != "$e0" ] || ok "11 beyaz liste öğesi var (LGPL / MIT/X11), H.264/GPL kodlayıcı yok"

step "3 XI2 ofsetleri (D-P28g-T2-2)"
XI2="$OUT/xi2-offsets-$REL.txt"
if gcc -O0 -o /tmp/xi2-offsets test/linux/xi2-offsets.c && /tmp/xi2-offsets > "$XI2"; then
  cat "$XI2"
  # Spike K0s-5 probunun okuduğu değerler (amd64 LP64): yapı başlığı aynı kalmalı.
  for kv in XGenericEventCookie.extension=32 XGenericEventCookie.evtype=36 XGenericEventCookie.data=48 XIRawEvent.sourceid=52 sizeof.XEvent=192; do
    grep -qx "$kv" "$XI2" || err "beklenmeyen XI2 ABI: $kv yok ($XI2)"
  done
  ok "XI2 ofsetleri üretildi ($(wc -l < "$XI2") satır)"
else
  err "xi2-offsets.c derlenemedi / koşmadı"
fi
export P28G_XI2_OFFSETS="$XI2"

step "4 X11 katmanı (oturum D-Bus + Xvfb)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
dbus-daemon --session --address="$DBUS_SESSION_BUS_ADDRESS" --nofork --nopidfile >/tmp/dbus-session.log 2>&1 &
PIDS+=($!)
Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
PIDS+=($!)
x11=0
for _ in $(seq 1 30); do
  if DISPLAY=:99 xdpyinfo >/dev/null 2>&1 && [ -S "$XDG_RUNTIME_DIR/bus" ]; then x11=1; break; fi
  sleep 1
done
if [ "$x11" = 1 ]; then
  ext="$(DISPLAY=:99 xdpyinfo -queryExtensions 2>/dev/null)"
  for e in XTEST XInputExtension RANDR; do printf '%s\n' "$ext" | grep -q "$e" || err "Xvfb'de $e eklentisi yok"; done
  ok "Xvfb :99 + oturum D-Bus hazır"
else
  err "Xvfb ya da oturum D-Bus'ı 30 sn'de hazır olmadı"; cat /tmp/xvfb.log /tmp/dbus-session.log
fi

step "5 ELF (.invalid, TEST değil) + bu dağıtımda yükleme"
ELFDIR="$(mktemp -d /tmp/elf.XXXXXX)"
ELF="$ELFDIR/Destek-12345678"
PLACEHOLDER=https://destek.example.invalid:4450
if sh build/build-linux.sh "$PLACEHOLDER" 0.0.0 "$ELF" && sh build/check-linux-elf.sh "$ELF" --server "$PLACEHOLDER"; then
  ok "ELF derlendi ve denetlendi"
else
  err "build-linux.sh / check-linux-elf.sh başarısız"
fi

step "6 ortam pozitif kontrolü (§14 m.2, S-P28g-5)"
e0=$ERRS
if [ -x "$ELF" ] && [ "$x11" = 1 ]; then
  ST=/tmp/strace-env.txt
  # strace ptrace ister (gui.sh --cap-add SYS_PTRACE). Çıkış kodu: K4 öncesi 6 (arayüz yok), K4 sonrası pencere açık kalır →
  # timeout 124. Yükleyici hatası (126/127) ve çökme sinyali (SIGSEGV/SIGABRT) kırmızı.
  DISPLAY=:99 XDG_SESSION_TYPE=x11 GDK_CORE_DEVICE_EVENTS=1 GDK_DEBUG=events GTK_DEBUG=interactive GTK_MODULES=nokta-yok \
    GST_PLUGIN_PATH=/tmp LD_PRELOAD=/nokta-yok/libyok.so timeout 20 \
    strace -f -qq -e trace=execve -v -s 4096 -o "$ST" "$ELF" --fazla-arguman > /tmp/elf-stdout.txt 2> /tmp/elf-stderr.txt
  rc=$?
  echo "ELF çıkış kodu $rc"
  if grep -q 'error while loading shared libraries' /tmp/elf-stderr.txt; then err "ELF yüklenemedi: $(head -3 /tmp/elf-stderr.txt)"; fi
  case "$rc" in 126|127|132|134|135|136|139) err "ELF çıkış kodu $rc (yükleyici/çökme)"; cat /tmp/elf-stderr.txt ;; esac
  re="$(grep -E 'execve\("/proc/self/exe"' "$ST" | grep -E '= 0$' || true)"
  n="$(printf '%s' "$re" | grep -c . || true)"
  if [ "$P28G_EMULATED" = 1 ] && [ "$n" = 0 ] && grep -q 'syscall_0x' "$ST"; then
    # Apple Silicon'da linux/amd64 Rosetta emülasyonu ptrace'i desteklemez (strace sistem çağrısı adlarını çözemiyor). Yalnız
    # yerel provada olur; CI (yerli amd64) bu kontrolü gerçekten koşar.
    warn "strace emülasyonda çalışmıyor; ortam pozitif kontrolü bu koşuda YAPILAMADI (CI yerli amd64'te zorunlu)"
  elif [ "$n" != 1 ]; then
    err "yeniden çalıştırma sayısı $n (beklenen tam 1; strace: $ST)"; cat "$ST"
  else
    printf '%s\n' "$re" | grep -qE 'execve\("/proc/self/exe", \["[^"]*"\], ' || err "yeniden çalıştırma argümanlı: $re"
    for v in GDK_CORE_DEVICE_EVENTS GDK_DEBUG GTK_DEBUG GTK_MODULES GST_PLUGIN_PATH LD_PRELOAD; do
      if printf '%s\n' "$re" | grep -q "\"$v="; then err "yeniden çalıştırılan ortamda $v kaldı"; fi
    done
    printf '%s\n' "$re" | grep -q '"PATH=/usr/bin:/bin"' || err "yeniden çalıştırılan ortamda PATH=/usr/bin:/bin yok"
    [ "$ERRS" != "$e0" ] || ok "tek yeniden çalıştırma, argümansız, süzülmüş ortam (çıkış $rc)"
  fi
else
  err "ELF ya da X11 yok; ortam pozitif kontrolü koşmadı"
fi

gotest() { # $1 faz adı, $2 çıktı, geri kalanı go test argümanları; hata varsa 1 döner
  local faz="$1" out="$2" e0=$ERRS; shift 2
  go test -tags linuxgui -count=1 -v "$@" ./... 2>&1 | tee "$out"
  local rc=${PIPESTATUS[0]}
  [ "$rc" = 0 ] || err "go test ($faz) çıkış kodu $rc"
  local skips; skips="$(grep -E -- '^[[:space:]]*--- SKIP: ' "$out" || true)"
  if [ -n "$skips" ]; then
    { echo; echo "<details><summary>go test $faz SKIP listesi</summary>"; echo; echo '```'; printf '%s\n' "$skips"; echo '```'; echo "</details>"; } >> "$SUM"
    local p; p="$(printf '%s\n' "$skips" | grep -E -- '--- SKIP: [A-Za-z0-9_]*P28g' || true)"
    [ -z "$p" ] || err "imajda P28g testi SKIP ($faz): $(printf '%s' "$p" | sed -E 's/.*--- SKIP: ([^ ]+).*/\1/' | tr '\n' ' ')"
  fi
  [ "$ERRS" = "$e0" ]
}

step "7 go test -tags linuxgui (X11 fazı)"
X11OUT="$OUT/go-test-x11-$REL.txt"
if [ "$x11" = 1 ]; then
  DISPLAY=:99 XDG_SESSION_TYPE=x11 P28G_GUI=x11 gotest x11 "$X11OUT" -skip Wayland
else
  : > "$X11OUT"; err "X11 fazı koşmadı"
fi

step "8 iz testi (AC-401, trace-check-linux.sh)"
TC=test/trace-check-linux.sh
if [ -f "$TC" ]; then
  H2="$(mktemp -d /tmp/iz-ev.XXXXXX)"; mkdir -p "$H2/Downloads"
  cp "$ELF" "$H2/Downloads/Destek-12345678"
  snap=/tmp/iz-once.txt
  if HOME="$H2" bash "$TC" snapshot "$snap"; then
    HOME="$H2" DISPLAY=:99 XDG_SESSION_TYPE=x11 timeout -s TERM 15 "$H2/Downloads/Destek-12345678"; echo "istemci çıkış kodu $?"
    sleep 2
    if HOME="$H2" bash "$TC" compare "$snap" --exe "$H2/Downloads/Destek-12345678" --marker 12345678; then ok "iz testi temiz"
    else err "trace-check-linux.sh compare: iz bulundu ya da hata"; fi
  else
    err "trace-check-linux.sh snapshot başarısız"
  fi
elif [ "$P28G_STRICT" = 1 ]; then
  err "$TC yok (K5; etiket derlemesinde zorunlu)"
else
  warn "bekleyen: $TC yok (K5 yazacak); iz testi bu koşuda yapılmadı"
fi

step "9 Wayland katmanı (başsız mutter + portal)"
WLOUT="$OUT/go-test-wayland-$REL.txt"; : > "$WLOUT"
wl=0
pipewire >/tmp/pipewire.log 2>&1 & PIDS+=($!)
sleep 1
wireplumber >/tmp/wireplumber.log 2>&1 & PIDS+=($!)
XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=GNOME mutter --headless --wayland --no-x11 --virtual-monitor 1280x720 >/tmp/mutter.log 2>&1 &
PIDS+=($!)
for _ in $(seq 1 60); do [ -S "$XDG_RUNTIME_DIR/wayland-0" ] && break; sleep 1; done
if [ -S "$XDG_RUNTIME_DIR/wayland-0" ]; then
  export WAYLAND_DISPLAY=wayland-0
  XDG_CURRENT_DESKTOP=GNOME /usr/libexec/xdg-desktop-portal-gnome >/tmp/xdpg.log 2>&1 & PIDS+=($!)
  sleep 1
  XDG_CURRENT_DESKTOP=GNOME /usr/libexec/xdg-desktop-portal >/tmp/xdp.log 2>&1 & PIDS+=($!)
  for _ in $(seq 1 30); do
    if dbus-send --session --print-reply --dest=org.freedesktop.portal.Desktop /org/freedesktop/portal/desktop \
         org.freedesktop.DBus.Properties.Get string:org.freedesktop.portal.ScreenCast string:version >/dev/null 2>&1; then wl=1; break; fi
    sleep 1
  done
  unset WAYLAND_DISPLAY
fi
if [ "$wl" = 1 ]; then
  ok "Wayland katmanı hazır (mutter başsız + portal ScreenCast)"
  # DISPLAY bilerek verilmez: Wayland yolunda istemci X11'e düşmemeli.
  # Alt kabuk: ortam yalnız bu faza; err'in sayaç/FAIL güncellemesi alt kabukta kalır, sonuç çıkış kodundan alınır.
  ( export WAYLAND_DISPLAY=wayland-0 XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=GNOME P28G_GUI=wayland
    gotest wayland "$WLOUT" -run Wayland ) || { FAIL=1; ERRS=$((ERRS + 1)); }
else
  warn "Wayland katmanı kurulamadı (mutter/portal); Wayland adlı testler bu imajda denetlenmedi — kanıt elle (§12.1)"
  tail -20 /tmp/mutter.log /tmp/xdp.log 2>/dev/null
fi

step "10 zorunlu liste (test/linux/gui-tests.txt)"
pending=0
while read -r name mark _; do
  case "$name" in ''|'#'*) continue ;; esac
  case "$name" in *Wayland*) log="$WLOUT"; [ "$wl" = 1 ] || continue ;; *) log="$X11OUT" ;; esac
  if grep -Eq -- "^[[:space:]]*--- PASS: $name \(" "$log"; then continue; fi
  if grep -Eq -- "^[[:space:]]*--- (SKIP|FAIL): $name \(" "$log"; then
    err "$name PASS değil ($(grep -Eo -- "--- (SKIP|FAIL): $name" "$log" | head -1 | cut -c5-8))"
  elif [ "$mark" = bekleyen ]; then
    pending=$((pending + 1))
    if [ "$P28G_STRICT" = 1 ]; then err "$name koşmadı (bekleyen; etiket derlemesinde zorunlu)"; else warn "bekleyen: $name henüz yok"; fi
  else
    err "$name koşmadı (ad değişti mi? listeyi güncelleyin)"
  fi
done < test/linux/gui-tests.txt
[ "$pending" = 0 ] || echo "bekleyen test sayısı: $pending"

echo
if [ "$FAIL" = 0 ]; then echo "SONUÇ [$REL]: GEÇTİ"; echo "- **GEÇTİ**" >> "$SUM"; else echo "SONUÇ [$REL]: KALDI"; echo "- **KALDI**" >> "$SUM"; fi
exit "$FAIL"
