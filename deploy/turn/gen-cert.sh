#!/usr/bin/env bash
# TURN-TLS (5349) sertifikası — staging CA'sı + IP SAN'lı sunucu sertifikası (mimari §8.3.1).
# Kullanım (sunucuda, deploy/turn içinde):  ./gen-cert.sh 185.126.217.99 [ek-ip ...]
# Çıktı: certs/ca.crt (test makinelerine "güvenilen kök" olarak kurulur), certs/turn.crt, certs/turn.key.
# Özel anahtarlar (certs/*.key) repoya GİRMEZ (.gitignore: *.key, deploy/turn/certs/).
# CA zaten varsa yeniden kullanılır (test makinelerindeki kök değişmez); yalnız sunucu sertifikası yenilenir.
# Prod: Let's Encrypt (turn.<domain>) — bu betik kullanılmaz (ADR-0007).
set -euo pipefail
[ $# -ge 1 ] || { echo "kullanım: $0 <public-ip> [ek-ip ...]" >&2; exit 2; }
DIR="${TURN_CERT_OUT:-$(cd "$(dirname "$0")" && pwd)/certs}"  # TURN_CERT_OUT: yalnız test
DAYS_CA=1825
DAYS_LEAF=${TURN_CERT_DAYS:-365}
mkdir -p "$DIR"
chmod 755 "$DIR"
umask 077
SAN=""
for ip in "$@"; do
  [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || { echo "geçersiz IPv4: $ip" >&2; exit 2; }
  SAN="${SAN:+$SAN,}IP:$ip"
done

if [ ! -f "$DIR/ca.key" ]; then
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -sha256 \
    -days "$DAYS_CA" -subj "/CN=Remote Support Staging TURN CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -keyout "$DIR/ca.key" -out "$DIR/ca.crt"
  echo "yeni CA üretildi: $DIR/ca.crt (test makinelerine kurun, runbook §9.4)"
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -sha256 \
  -subj "/CN=$1" -keyout "$TMP/turn.key" -out "$TMP/turn.csr"
cat > "$TMP/ext.cnf" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=serverAuth
subjectAltName=$SAN
EOF
openssl x509 -req -in "$TMP/turn.csr" -CA "$DIR/ca.crt" -CAkey "$DIR/ca.key" -CAcreateserial \
  -days "$DAYS_LEAF" -sha256 -extfile "$TMP/ext.cnf" -out "$TMP/turn.crt"
openssl verify -CAfile "$DIR/ca.crt" "$TMP/turn.crt" >/dev/null
mv "$TMP/turn.key" "$DIR/turn.key"
mv "$TMP/turn.crt" "$DIR/turn.crt"
chmod 644 "$DIR/ca.crt" "$DIR/turn.crt"
# coturn konteyneri nobody:nogroup (65534:65533) çalışır; anahtar yalnız ona okunur.
if [ "$(id -u)" = 0 ]; then
  chown 65534:65533 "$DIR/turn.key"; chmod 400 "$DIR/turn.key"
else
  chmod 644 "$DIR/turn.key"  # root değilken (yerel test) konteyner okuyabilsin
  echo "UYARI: root değil -> turn.key 644 (yalnız yerel test). Sunucuda root ile çalıştırın." >&2
fi
openssl x509 -in "$DIR/turn.crt" -noout -subject -enddate
openssl x509 -in "$DIR/turn.crt" -noout -text | grep -A1 "Subject Alternative Name" | tail -1
