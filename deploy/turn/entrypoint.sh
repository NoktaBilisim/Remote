#!/bin/sh
# coturn başlatıcı (G-05, ADR-0007 r3): turnserver.base.conf (repo) + env'den üretilen ortam satırları
# + denied-peer-ip.local.conf (git-ignore) -> /tmp/turnserver.conf (tmpfs, 600) -> exec turnserver -c.
# Eksik/hatalı girdide BAŞLAMAZ (fail closed). Secret komut satırına konmaz (ps'te görünmesin).
# TURN_CONFIG_CHECK=1: yapılandırmayı üretir, secret'ı maskeleyip yazdırır ve çıkar (CI/runbook).
set -eu
BASE=/etc/coturn/turnserver.base.conf
LOCAL=/etc/coturn/denied-peer-ip.local.conf
CERT=/etc/coturn/certs/turn.crt
KEY=/etc/coturn/certs/turn.key
OUT=/tmp/turnserver.conf

die() { echo "turn-entrypoint: $*" >&2; exit 1; }
is_uint() { case "$1" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }
# IPv4: tam dize case ile (yeni satır geçemez), 4 oktet 0..255, baştaki sıfır yok (S-P3-T2-1 m.2; grep satır bazlıydı).
is_ipv4() (
  case "$1" in ''|*[!0-9.]*|.*|*.|*..*) exit 1 ;; esac
  IFS=.; set -f; set -- $1
  [ $# -eq 4 ] || exit 1
  for o; do
    case "$o" in ''|*[!0-9]*|0?*) exit 1 ;; esac
    [ "${#o}" -le 3 ] && [ "$o" -le 255 ] || exit 1
  done
)
NL='
'
CR="$(printf '\r')"

: "${TURN_SECRET:?TURN_SECRET gerekli}"
: "${TURN_REALM:?TURN_REALM gerekli}"
: "${TURN_EXTERNAL_IP:?TURN_EXTERNAL_IP gerekli (public veya public/private)}"
TURN_MAX_BPS="${TURN_MAX_BPS:-8000000}"
TURN_BPS_CAPACITY="${TURN_BPS_CAPACITY:-0}"
TURN_PROMETHEUS_ADDRESS="${TURN_PROMETHEUS_ADDRESS:-127.0.0.1}"

# Config'e satır olarak yazılan her env: çok satırlı/CR içeren değer ikinci satırla coturn ayarı enjekte edebilir -> reddet.
for v in TURN_SECRET TURN_SECRET_PREVIOUS TURN_REALM TURN_EXTERNAL_IP TURN_MAX_BPS TURN_BPS_CAPACITY \
         TURN_PROMETHEUS_ADDRESS TURN_TEST_MAX_PORT TURN_LISTEN_IPS; do
  eval "val=\${$v:-}"
  case "$val" in *"$NL"*|*"$CR"*) die "$v çok satırlı olamaz" ;; esac
done
case "$TURN_REALM" in *[[:space:]]*|*'#'*) die "TURN_REALM boşluk/# içeremez" ;; esac
case "$TURN_EXTERNAL_IP" in */*/*) die "TURN_EXTERNAL_IP biçimi: <public> veya <public>/<private>" ;; esac
[ "${#TURN_SECRET}" -ge 32 ] || die "TURN_SECRET en az 32 karakter olmalı"
case "$TURN_SECRET${TURN_SECRET_PREVIOUS:-}" in *[[:space:]]*|*'#'*) die "TURN secret boşluk/# içeremez" ;; esac
is_uint "$TURN_MAX_BPS" || die "TURN_MAX_BPS sayı olmalı"
is_uint "$TURN_BPS_CAPACITY" || die "TURN_BPS_CAPACITY sayı olmalı"
PUBLIC_IP="${TURN_EXTERNAL_IP%%/*}"
PRIVATE_IP="${TURN_EXTERNAL_IP#*/}"
is_ipv4 "$PUBLIC_IP" || die "TURN_EXTERNAL_IP biçimi: <public> veya <public>/<private>"
is_ipv4 "$PRIVATE_IP" || die "TURN_EXTERNAL_IP biçimi: <public> veya <public>/<private>"
is_ipv4 "$TURN_PROMETHEUS_ADDRESS" || die "TURN_PROMETHEUS_ADDRESS IPv4 olmalı"
# listening-ip (P4 düzeltme 1): coturn varsayılanı TÜM arayüzler (diğer Docker köprü ağ geçitleri, IPv6 dahil).
# auto = özel relay IPv4 + 127.0.0.1; liste = virgül/boşlukla IPv4'ler. 127.0.0.1 healthcheck için her zaman eklenir.
LISTEN_IPS=""
case "${TURN_LISTEN_IPS:-}" in
  '') echo "turn-entrypoint: UYARI TURN_LISTEN_IPS boş -> 3478/5349 TÜM arayüzlerde dinlenir (runbook §9.1; staging/prod: auto)" >&2 ;;
  auto) LISTEN_IPS="$PRIVATE_IP 127.0.0.1" ;;
  *) for ip in $(echo "$TURN_LISTEN_IPS" | tr ',' ' '); do
       is_ipv4 "$ip" || die "TURN_LISTEN_IPS: '$ip' IPv4 değil (auto veya virgüllü IPv4 listesi)"
       case " $LISTEN_IPS " in *" $ip "*) ;; *) LISTEN_IPS="$LISTEN_IPS $ip" ;; esac
     done
     case " $LISTEN_IPS " in *" 127.0.0.1 "*) ;; *) LISTEN_IPS="$LISTEN_IPS 127.0.0.1" ;; esac ;;
esac
# CLI (5766) açık kalmasın: base.conf'a cli/cli-* satırı girerse başlama (4.18'de varsayılan kapalı; `no-cli` hata verir, r5 m.3).
if grep -Eq '^[[:space:]]*-{0,2}(cli|cli-[a-z-]+|verbose|Verbose|log-binding)([[:space:]=]|$)' "$BASE"; then
  die "$BASE cli/verbose/log-binding içeremez (S-P3-9, ADR-0007 r5)"
fi
# Bind mount'ta kaynak dosya yoksa Docker boş dizin yaratır -> dosya değilse reddet (G-05: liste boş kalmasın).
[ -f "$LOCAL" ] || die "$LOCAL yok (cp denied-peer-ip.local.conf.example denied-peer-ip.local.conf, runbook §9)"
grep -q '^denied-peer-ip=' "$LOCAL" || die "$LOCAL en az bir denied-peer-ip satırı içermeli"
if grep -Ev '^[[:space:]]*(#.*)?$' "$LOCAL" | grep -Evq '^denied-peer-ip=[0-9a-fA-F:.]+(-[0-9a-fA-F:.]+)?$'; then
  die "$LOCAL yalnız 'denied-peer-ip=<ip>' veya 'denied-peer-ip=<ip>-<ip>' satırları içerebilir"
fi

umask 077
{
  cat "$BASE"
  echo
  echo "# --- ortam (entrypoint.sh, env) ---"
  echo "realm=$TURN_REALM"
  echo "static-auth-secret=$TURN_SECRET"
  # Rotasyon (runbook §9.6): eski secret geçiş süresince kabul edilir.
  [ -n "${TURN_SECRET_PREVIOUS:-}" ] && echo "static-auth-secret=$TURN_SECRET_PREVIOUS"
  echo "external-ip=$TURN_EXTERNAL_IP"
  # S-P3-3 / ADR-0007 r5 m.5: relay yalnız IPv4 iç adresten (public-only kurulumda PRIVATE_IP = PUBLIC_IP).
  # Host'un global IPv6'sı olsa da IPv6 relay açılmaz (REQUESTED-ADDRESS-FAMILY=IPv6 -> 440).
  echo "relay-ip=$PRIVATE_IP"
  for ip in $LISTEN_IPS; do echo "listening-ip=$ip"; done
  # YALNIZ test (docker-compose.test.yml): 40 portluk aralık ~60 negatif denemeye yetmez (her deneme bir
  # allocation, 600 sn yaşar -> 508). Sonraki satır base.conf'taki değeri ezer. Staging/prod'da verilmez.
  if [ -n "${TURN_TEST_MAX_PORT:-}" ]; then is_uint "$TURN_TEST_MAX_PORT" || die "TURN_TEST_MAX_PORT"; echo "max-port=$TURN_TEST_MAX_PORT"; fi
  echo "max-bps=$TURN_MAX_BPS"
  [ "$TURN_BPS_CAPACITY" != 0 ] && echo "bps-capacity=$TURN_BPS_CAPACITY"
  echo "prometheus-address=$TURN_PROMETHEUS_ADDRESS"
  # relay<->relay: TURN'ün kendi relay adresi (mimari §8.3 G-05 notu); allowed, denied'dan önceliklidir.
  # coturn port ayırmaz -> host OUTPUT kuralı ZORUNLU (host-firewall.sh, S-P3-2, ADR-0007 r5 m.4, runbook §9.2.1).
  echo "allowed-peer-ip=$PUBLIC_IP"
  if [ -f "$CERT" ] && [ -f "$KEY" ]; then
    echo "cert=$CERT"
    echo "pkey=$KEY"
  else
    echo "turn-entrypoint: UYARI sertifika yok -> TLS (5349) kapalı (gen-cert.sh, runbook §9.4)" >&2
    echo "no-tls"
  fi
  echo
  echo "# --- denied-peer-ip (b): ortam listesi ($LOCAL) ---"
  grep '^denied-peer-ip=' "$LOCAL"
} > "$OUT"

if [ "${TURN_CONFIG_CHECK:-0}" = 1 ]; then
  sed -E 's/^(static-auth-secret=).*/\1***/' "$OUT"
  exit 0
fi
exec turnserver -c "$OUT"
