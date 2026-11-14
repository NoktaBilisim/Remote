#!/bin/sh
# TURN-TLS (5349) Let's Encrypt deploy hook (ADR-0018 m.4, mimari-p13 §7.4, G-P13b-4, runbook §9.4). certbot `remote-turn`
# kaydı yenilenince çalışır: fullchain.pem + privkey.pem -> /etc/remote/turn-certs/turn.{crt,key} (git ağacı DIŞI; compose
# TURN_CERT_DIR ile bağlar). Geçici dosya mktemp, sahiplik/izin içerikten ÖNCE, sonra mv (atomik). coturn'e SIGUSR2
# (sertifikayı yeniden okur; 4.18'de doğrulandı, docs/implementation.md "P13b — devops"), 5349'dan sunulan sertifikanın
# SHA-256 parmak izi yeni sertifikayla karşılaştırılır; eşit değilse `docker restart`, yine eşit değilse journal'a err +
# çıkış 1 (certbot hatayı loglar, remote-watch `turn-cert-served` alarmı verir).
# Web sertifikasının anahtarı coturn'e VERİLMEZ (ayrı certbot kaydı). Anahtar içeriği loga yazılmaz.
#
# Kullanım (root):  ./cert-deploy-hook.sh install|uninstall|run|check|print
#   install    TURN_CERT_DIR'i (yoksa root:65533 0750) oluşturur ve denetler, betiği
#              /usr/local/sbin/remote-turn-cert-deploy (root:root 0755) olarak kopyalar, girdileri
#              /etc/default/remote-turn-cert'e (root 0644; yol/ad, sır yok) yazar. Betik değişince yeniden çalıştırılır.
#              certbot: certonly ... --cert-name remote-turn --deploy-hook /usr/local/sbin/remote-turn-cert-deploy
#   uninstall  kurulu kopyayı ve /etc/default dosyasını siler (certbot kaydına dokunmaz).
#   run        (argümansız çağrı da run'dır; certbot böyle çağırır) RENEWED_LINEAGE TAM OLARAK TURN_CERT_LINEAGE ise
#              dağıtır; başka kayıt için hiçbir şey yapmadan 0 ile çıkar.
#   check      dosyadaki turn.crt ile 5349'dan sunulanın parmak izini karşılaştırır (yazmaz). 0 = eşit.
#   print      etkin girdileri yazar.
# Elle deneme: RENEWED_LINEAGE=/etc/letsencrypt/live/remote-turn /usr/local/sbin/remote-turn-cert-deploy
# Yol güvenliği (G-P13b-4): TURN_CERT_DIR ve bütün üst dizinleri sembolik bağlantı değil, sahibi root, group/other
#   yazamaz olmalı; değilse HİÇBİR ŞEY yazmadan çıkış 1. Dizin yoksa root:65533 0750 oluşturulur (coturn 65534:65533
#   grup ile girer). chown bağlantı izlemez (-h); hedef turn.crt/turn.key bağlantı ya da dizinse reddedilir.
# Girdi: kurulu kopya YALNIZ /etc/default/remote-turn-cert'i okur (root sahibi, g/o yazamaz). Repo kopyası env'den:
#   TURN_CERT_DIR (/etc/remote/turn-certs), TURN_CERT_LINEAGE (/etc/letsencrypt/live/remote-turn),
#   TURN_CONTAINER (remote-turn-coturn-1), TURN_TLS_NAME (remote.noktabilisim.net), TURN_TLS_CONNECT (127.0.0.1:5349),
#   TURN_CERT_WAIT_SEC (10; SIGUSR2 sonrası bekleme), TURN_CERT_RESTART_WAIT_SEC (30).
#   TURN_CERT_TEST_NONROOT=1  YALNIZ yerel test (repo kopyası, root değil): chown yok, anahtar 0444, üst dizinlerde sahip
#              olarak çalışan kullanıcı da kabul edilir. Kurulu kopyada verilirse reddedilir.
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)"
SELF_PATH="$DIR/$(basename "$0")"
INSTALLED=/usr/local/sbin/remote-turn-cert-deploy
CONF=/etc/default/remote-turn-cert
TAG=remote-turn-cert
NL='
'
CR="$(printf '\r')"

# stdout/stderr (certbot logu) + logger varsa syslog/journal (öncelikli).
log() { echo "$TAG: $*"; if command -v logger >/dev/null 2>&1; then logger -t "$TAG" -p user.info -- "$*" 2>/dev/null || true; fi; }
warn() { echo "$TAG: UYARI $*" >&2; if command -v logger >/dev/null 2>&1; then logger -t "$TAG" -p user.warning -- "UYARI $*" 2>/dev/null || true; fi; }
err() { echo "$TAG: HATA $*" >&2; if command -v logger >/dev/null 2>&1; then logger -t "$TAG" -p user.err -- "HATA $*" 2>/dev/null || true; fi; }
die() { err "$*"; exit 1; }
file_val() { sed -n "s/^$1=//p" "$2" | tail -1 | tr -d "\"' \r"; }
one_line() { case "$2" in *"$NL"*|*"$CR"*) die "$1 çok satırlı olamaz" ;; esac; }

if [ "$SELF_PATH" = "$INSTALLED" ]; then
  [ "${TURN_CERT_TEST_NONROOT:-0}" = 0 ] || die "TURN_CERT_TEST_NONROOT kurulu kopyada kullanılamaz"
  [ -f "$CONF" ] || die "$CONF yok (deploy/turn/cert-deploy-hook.sh install ile oluşturulur)"
  [ -n "$(find "$CONF" -maxdepth 0 -user 0 ! -perm /022 2>/dev/null)" ] || die "$CONF root sahibi değil ya da group/other yazabiliyor"
  TURN_CERT_DIR="$(file_val TURN_CERT_DIR "$CONF")"
  TURN_CERT_LINEAGE="$(file_val TURN_CERT_LINEAGE "$CONF")"
  TURN_CONTAINER="$(file_val TURN_CONTAINER "$CONF")"
  TURN_TLS_NAME="$(file_val TURN_TLS_NAME "$CONF")"
  TURN_TLS_CONNECT="$(file_val TURN_TLS_CONNECT "$CONF")"
fi
CERT_DIR="${TURN_CERT_DIR:-/etc/remote/turn-certs}"
LINEAGE="${TURN_CERT_LINEAGE:-/etc/letsencrypt/live/remote-turn}"
CONTAINER="${TURN_CONTAINER:-remote-turn-coturn-1}"
TLS_NAME="${TURN_TLS_NAME:-remote.noktabilisim.net}"
CONNECT="${TURN_TLS_CONNECT:-127.0.0.1:5349}"
WAIT="${TURN_CERT_WAIT_SEC:-10}"
RWAIT="${TURN_CERT_RESTART_WAIT_SEC:-30}"
NONROOT="${TURN_CERT_TEST_NONROOT:-0}"
for v in CERT_DIR LINEAGE CONTAINER TLS_NAME CONNECT WAIT RWAIT; do eval "one_line $v \"\$$v\""; done
for p in "$CERT_DIR" "$LINEAGE"; do
  case "$p" in /?*) ;; *) die "TURN_CERT_DIR / TURN_CERT_LINEAGE mutlak yol olmalı" ;; esac
  case "$p" in *[!A-Za-z0-9/._-]*|*/../*|*/..|*/./*|*//*) die "yol yalnız [A-Za-z0-9/._-] içerebilir, '..' / '//' olmaz: $p" ;; esac
done
CERT_DIR="${CERT_DIR%/}"; LINEAGE="${LINEAGE%/}"
case "$CONTAINER" in ''|-*|*[!A-Za-z0-9_.-]*) die "TURN_CONTAINER geçersiz" ;; esac
case "$TLS_NAME" in ''|-*|*[!A-Za-z0-9.-]*) die "TURN_TLS_NAME geçersiz (DNS adı)" ;; esac
case "$CONNECT" in ''|*[!A-Za-z0-9.:\[\]-]*) die "TURN_TLS_CONNECT geçersiz (host:port)" ;; esac
case "$WAIT$RWAIT" in *[!0-9]*) die "bekleme süreleri sayı olmalı" ;; esac
case "$NONROOT" in 0|1) ;; *) die "TURN_CERT_TEST_NONROOT 0 veya 1" ;; esac

need_root() { [ "$(id -u)" = 0 ] || [ "$NONROOT" = 1 ] || die "root gerekli"; }
have_timeout() { command -v timeout >/dev/null 2>&1; }

# Dosyadaki ilk sertifikanın (yaprak) SHA-256 parmak izi: yalnız hex, ':'siz, büyük harf.
fp_file() { openssl x509 -in "$1" -noout -fingerprint -sha256 2>/dev/null | sed 's/.*=//; s/://g' | tr 'a-f' 'A-F'; }
# 5349'dan sunulan sertifikanın parmak izi (bağlanamazsa boş).
fp_served() {
  if have_timeout; then
    timeout 8 openssl s_client -connect "$CONNECT" -servername "$TLS_NAME" </dev/null 2>/dev/null
  else
    openssl s_client -connect "$CONNECT" -servername "$TLS_NAME" </dev/null 2>/dev/null
  fi | openssl x509 -noout -fingerprint -sha256 2>/dev/null | sed 's/.*=//; s/://g' | tr 'a-f' 'A-F'
}
# wait_served <fp> <sn>: sunulan parmak izi <fp> olana kadar 1 sn aralıkla bekler. 0 = eşit.
wait_served() {
  i=0
  while :; do
    [ "$(fp_served)" = "$1" ] && return 0
    [ "$i" -ge "$2" ] && return 1
    sleep 1; i=$((i + 1))
  done
}

# Yeni sertifika + anahtar dağıtılmadan önce doğrulanır (bozuksa mevcut dosyalara DOKUNULMAZ).
validate_lineage() {
  ln="$1"
  [ -f "$ln/fullchain.pem" ] && [ -f "$ln/privkey.pem" ] || die "$ln/fullchain.pem veya privkey.pem yok"
  openssl x509 -in "$ln/fullchain.pem" -noout 2>/dev/null || die "fullchain.pem okunamadı"
  openssl x509 -in "$ln/fullchain.pem" -noout -checkend 0 >/dev/null 2>&1 || die "yeni sertifikanın süresi dolmuş"
  # Ad: SAN'da tam DNS:<ad> (LibreSSL'de -checkhost yok; metin taraması iki araçta da çalışır).
  openssl x509 -in "$ln/fullchain.pem" -noout -text 2>/dev/null | tr ',' '\n' | sed 's/^[[:space:]]*//' \
    | grep -qx "DNS:$TLS_NAME" || die "sertifika $TLS_NAME adını kapsamıyor (SAN)"
  c="$(openssl x509 -in "$ln/fullchain.pem" -noout -pubkey 2>/dev/null | openssl sha256 2>/dev/null | sed 's/.*= *//')"
  k="$(openssl pkey -in "$ln/privkey.pem" -pubout 2>/dev/null | openssl sha256 2>/dev/null | sed 's/.*= *//')"
  [ -n "$c" ] && [ "$c" = "$k" ] || die "privkey.pem sertifikayla eşleşmiyor"
}

# safe_dir <yol>: yol ve bütün üst dizinleri gerçek dizin (bağlantı değil), sahibi root (testte çalışan kullanıcı da),
# group/other yazamaz. `ls -lnd` GNU/busybox/BSD'de aynı biçimdedir; yol karakter kümesi yukarıda sınırlandı.
safe_dir() {
  d="$1"; me="$(id -u)"
  while :; do
    [ -L "$d" ] && die "$d sembolik bağlantı (G-P13b-4); hiçbir şey yazılmadı"
    [ -d "$d" ] || die "$d dizin değil; hiçbir şey yazılmadı"
    # shellcheck disable=SC2012,SC2046
    set -- $(ls -lnd "$d")
    m="$1"; u="$3"
    if [ "$u" != 0 ] && { [ "$NONROOT" = 0 ] || [ "$u" != "$me" ]; }; then
      die "$d sahibi root değil (uid=$u); hiçbir şey yazılmadı"
    fi
    case "$m" in ?????w*|????????w*) die "$d group/other yazabiliyor ($m); hiçbir şey yazılmadı" ;; esac
    [ "$d" = / ] && break
    d="$(dirname "$d")"
  done
}
# Hedef dosya varsa normal dosya olmalı (bağlantı izlenmez, dizinin içine taşınmaz).
safe_target() {
  if [ -L "$1" ] || { [ -e "$1" ] && [ ! -f "$1" ]; }; then die "$1 normal dosya değil (bağlantı/dizin); hiçbir şey yazılmadı"; fi
}
# GNU mv -T: hedef dizinse içine taşımaz. BSD'de -T yok (safe_target dizini zaten reddeder).
mvT() { if mv --version >/dev/null 2>&1; then mv -fT "$1" "$2"; else mv -f "$1" "$2"; fi; }

TMPC=""; TMPK=""
cleanup_tmp() { rm -f "$TMPC" "$TMPK" 2>/dev/null || true; }

do_run() {
  ln="${RENEWED_LINEAGE:-}"
  one_line RENEWED_LINEAGE "$ln"
  [ -n "$ln" ] || die "RENEWED_LINEAGE boş (certbot deploy hook'u olarak ya da elle RENEWED_LINEAGE=... ile çalıştırın)"
  ln="${ln%/}"
  # G-P13b-4: tam yol eşitliği (".../eski-remote-turn" eşleşmez).
  if [ "$ln" != "$LINEAGE" ]; then
    log "atlandı: kayıt '$ln' (yalnız $LINEAGE)"
    return 0
  fi
  need_root
  validate_lineage "$ln"
  if [ ! -e "$CERT_DIR" ] && [ ! -L "$CERT_DIR" ]; then
    safe_dir "$(dirname "$CERT_DIR")"
    (umask 077; mkdir "$CERT_DIR")
    [ "$NONROOT" = 1 ] || chown -h 0:65533 "$CERT_DIR"
    chmod 0750 "$CERT_DIR"
    log "$CERT_DIR oluşturuldu (root:65533 0750)"
  fi
  safe_dir "$CERT_DIR"
  safe_target "$CERT_DIR/turn.crt"; safe_target "$CERT_DIR/turn.key"
  trap cleanup_tmp EXIT INT TERM
  # Geçici dosyalar aynı dizinde mktemp ile (0600); sahiplik/izin İÇERİK yazılmadan önce ayarlanır.
  TMPC="$(mktemp "$CERT_DIR/.turn.crt.XXXXXX")"; TMPK="$(mktemp "$CERT_DIR/.turn.key.XXXXXX")"
  if [ "$NONROOT" = 1 ]; then
    warn "TEST: root değil -> anahtar 0444, chown yok (yalnız yerel test)"
  else
    chown -h 0:0 "$TMPC"; chown -h 65534:65533 "$TMPK"; chmod 0400 "$TMPK"
  fi
  cat "$ln/fullchain.pem" >"$TMPC"; cat "$ln/privkey.pem" >"$TMPK"
  chmod 0444 "$TMPC"
  if [ "$NONROOT" = 1 ]; then chmod 0444 "$TMPK"; fi
  # Anahtar önce: coturn araya giren bir yeniden başlatmada eski sertifika + yeni anahtar görürse açılmaz; pencere iki mv
  # arasıdır (mikrosaniye). SIGUSR2 ikisi de yerindeyken gönderilir.
  mvT "$TMPK" "$CERT_DIR/turn.key"; mvT "$TMPC" "$CERT_DIR/turn.crt"
  TMPC=""; TMPK=""
  want="$(fp_file "$CERT_DIR/turn.crt")"
  [ -n "$want" ] || die "kopyalanan turn.crt okunamadı"
  log "sertifika kopyalandı ($CERT_DIR/turn.crt 0444, turn.key 65534:65533 0400; parmak izi $(echo "$want" | cut -c1-16)…)"

  running="$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || true)"
  if [ "$running" != true ]; then
    warn "konteyner $CONTAINER çalışmıyor; dosyalar güncel, coturn başlarken yükler (remote-watch coturn kontrolü)"
    return 0
  fi
  docker kill -s USR2 "$CONTAINER" >/dev/null || warn "SIGUSR2 gönderilemedi"
  if wait_served "$want" "$WAIT"; then
    log "OK: coturn SIGUSR2 ile yeni sertifikayı sunuyor ($CONNECT)"
    return 0
  fi
  warn "SIGUSR2 sonrası $WAIT sn içinde yeni sertifika sunulmadı -> docker restart $CONTAINER (açık oturumlar ICE restart ile döner)"
  docker restart "$CONTAINER" >/dev/null || die "docker restart $CONTAINER başarısız"
  if wait_served "$want" "$RWAIT"; then
    log "OK: coturn yeniden başlatıldı, yeni sertifikayı sunuyor ($CONNECT)"
    return 0
  fi
  die "yeniden başlatma sonrası da $CONNECT yeni sertifikayı sunmuyor (sunulan: $(fp_served | cut -c1-16)…)"
}

do_check() {
  [ -f "$CERT_DIR/turn.crt" ] || die "$CERT_DIR/turn.crt yok"
  want="$(fp_file "$CERT_DIR/turn.crt")"; have="$(fp_served)"
  if [ -n "$have" ] && [ "$have" = "$want" ]; then log "check OK: $CONNECT dosyadaki sertifikayı sunuyor"; return 0; fi
  err "check: $CONNECT sunulan '${have:-bağlanılamadı}' != dosya '$want'"; return 1
}

do_install() {
  [ "$(id -u)" = 0 ] || die "root gerekli"
  [ "$SELF_PATH" != "$INSTALLED" ] || die "install repo kopyasından çalıştırılır (deploy/turn/cert-deploy-hook.sh install)"
  install -d -o root -g root -m 0755 "$(dirname "$INSTALLED")" "$(dirname "$CONF")" "$(dirname "$CERT_DIR")"
  if [ ! -e "$CERT_DIR" ]; then install -d -o root -g 65533 -m 0750 "$CERT_DIR"; log "$CERT_DIR oluşturuldu (root:65533 0750)"; fi
  safe_dir "$CERT_DIR"
  install -o root -g root -m 0755 "$SELF_PATH" "$INSTALLED.tmp.$$"
  mv -f "$INSTALLED.tmp.$$" "$INSTALLED"
  tmp="$CONF.tmp.$$"
  (umask 022; {
    echo "# remote-turn-cert girdileri — deploy/turn/cert-deploy-hook.sh install üretir; elle düzenlemeyin, install'ı"
    echo "# yeniden çalıştırın (runbook §9.4). Yalnız yol/ad; sır YOK. root:root 0644."
    echo "TURN_CERT_DIR=$CERT_DIR"
    echo "TURN_CERT_LINEAGE=$LINEAGE"
    echo "TURN_CONTAINER=$CONTAINER"
    echo "TURN_TLS_NAME=$TLS_NAME"
    echo "TURN_TLS_CONNECT=$CONNECT"
  } >"$tmp")
  chown root:root "$tmp"; chmod 0644 "$tmp"; mv -f "$tmp" "$CONF"
  log "kuruldu: $INSTALLED (0755), $CONF (0644). certbot: --cert-name $(basename "$LINEAGE") --deploy-hook $INSTALLED"
}

do_uninstall() {
  [ "$(id -u)" = 0 ] || die "root gerekli"
  rm -f "$INSTALLED" "$CONF"
  log "kaldırıldı ($INSTALLED, $CONF); certbot renewal/$(basename "$LINEAGE").conf içindeki renew_hook satırını da silin"
}

case "${1:-run}" in
  run) do_run ;;
  check) do_check ;;
  install) do_install ;;
  uninstall) do_uninstall ;;
  print) printf 'TURN_CERT_DIR=%s\nTURN_CERT_LINEAGE=%s\nTURN_CONTAINER=%s\nTURN_TLS_NAME=%s\nTURN_TLS_CONNECT=%s\n' \
           "$CERT_DIR" "$LINEAGE" "$CONTAINER" "$TLS_NAME" "$CONNECT" ;;
  *) sed -n '2,/^set -eu/p' "$0" | sed '$d' >&2; exit 2 ;;
esac
