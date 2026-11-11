#!/usr/bin/env bash
# Yerel/CI coturn testi: geçici secret + geçici staging CA/sertifika ile coturn'ü bridge ağda
# (docker-compose.test.yml) başlatır, test-denied.sh'ı çalıştırır, her durumda yığını kaldırır.
# Gerçek .env / denied-peer-ip.local.conf / certs/ KULLANILMAZ ve değiştirilmez. Kullanım: ./test-local.sh
set -euo pipefail
cd "$(dirname "$0")"
TMP="$(mktemp -d)"
export COMPOSE_FILE=docker-compose.yml:docker-compose.test.yml COMPOSE_PROJECT_NAME=remote-turn-test
export TURN_SECRET="$(openssl rand -hex 32)" TURN_REALM=remote.test TURN_EXTERNAL_IP=172.31.250.2
export TURN_PROMETHEUS_ADDRESS=0.0.0.0 TURN_TEST_CERT_DIR="$TMP/certs" TURN_LISTEN_IPS=auto
cleanup() { docker rm -f remote-turn-test-fw >/dev/null 2>&1 || true; docker compose --env-file /dev/null down -v >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
TURN_CERT_OUT="$TMP/certs" ./gen-cert.sh 172.31.250.2 >/dev/null 2>&1
echo "== yapılandırma (TURN_CONFIG_CHECK, secret maskeli)"
docker compose --env-file /dev/null run --rm --no-deps -e TURN_CONFIG_CHECK=1 coturn | grep -E 'static-auth-secret|external-ip|relay-ip|listening-ip|allowed-peer-ip|max-bps|cert=|prometheus-address'
docker compose --env-file /dev/null up -d --wait --wait-timeout 60
IMAGE="$(awk '/image: coturn\/coturn/ {print $2; exit}' docker-compose.yml)"
echo "== Prometheus (iç ağdan)"
docker run --rm --network remote-turn-test_turntest --entrypoint wget "$IMAGE" -qO- http://172.31.250.2:9641/metrics \
  | grep -c '^turn_' | xargs -I{} echo "turn_* metrik satırı: {}"
CID="$(docker compose --env-file /dev/null ps -q coturn)"
echo "== CLI/portlar (r5 m.3: 5766 yok; 9641 bu testte 0.0.0.0, staging 127.0.0.1)"
LISTEN="$(docker exec "$CID" netstat -tln)"
if echo "$LISTEN" | grep -q ':5766 '; then echo "FAIL  5766 (CLI) dinleniyor"; exit 1; else echo "PASS  5766 (CLI) dinlenmiyor"; fi
echo "$LISTEN" | grep -q ':9641 ' && echo "PASS  9641 (Prometheus) dinleniyor"
# P4 düzeltme 1: listening-ip (TURN_LISTEN_IPS=auto) -> 3478 yalnız relay IPv4 + 127.0.0.1'de, joker adreste değil.
L3478="$(echo "$LISTEN" | awk '$4 ~ /:3478$/ {print $4}' | sort -u | tr '\n' ' ')"
if [ "$L3478" = "127.0.0.1:3478 172.31.250.2:3478 " ]; then echo "PASS  3478 yalnız 127.0.0.1 + 172.31.250.2 (listening-ip)"
else echo "FAIL  3478 dinleme adresleri: $L3478"; exit 1; fi
echo "== host-firewall.sh (S-P3-2) coturn ağ ad alanında (yardımcı konteyner, NET_ADMIN)"
docker run -d --name remote-turn-test-fw --network "container:$CID" --cap-add NET_ADMIN --user 0 --entrypoint sh \
  -v "$PWD/host-firewall.sh:/fw/host-firewall.sh:ro" -v "$PWD/turnserver.base.conf:/fw/turnserver.base.conf:ro" \
  "$IMAGE" -c 'apk add --no-cache iptables ip6tables >/dev/null 2>&1 && touch /tmp/ready && exec sleep 3600' >/dev/null
for _ in $(seq 60); do docker exec remote-turn-test-fw test -f /tmp/ready 2>/dev/null && break; sleep 1; done
FWENV=(-e TURN_EXTERNAL_IP=172.31.250.2 -e TURN_FW_PORT_MAX=49999 -e TURN_FW_RESERVE_PORTS=0)
docker exec "${FWENV[@]}" remote-turn-test-fw /fw/host-firewall.sh apply
docker exec "${FWENV[@]}" remote-turn-test-fw /fw/host-firewall.sh apply >/dev/null   # idempotent: 2. kez
n4="$(docker exec remote-turn-test-fw iptables -S REMOTE-TURN-OUT | grep -c '^-A')"
j4="$(docker exec remote-turn-test-fw iptables -S OUTPUT | grep -c 'REMOTE-TURN-OUT')"
if [ "$n4" = 2 ] && [ "$j4" = 1 ]; then echo "PASS  iki kez apply -> 2 kural, 1 atlama (idempotent)"; else echo "FAIL  idempotent değil ($n4 kural, $j4 atlama)"; exit 1; fi
docker exec "${FWENV[@]}" remote-turn-test-fw /fw/host-firewall.sh print | sed 's/^/      /'
TURN_TEST_NETWORK=remote-turn-test_turntest TURN_HOST=172.31.250.2 \
  TURN_LOCAL_CONF=./denied-peer-ip.local.conf.example \
  TURN_TEST_FW_EXEC="docker exec ${FWENV[*]} remote-turn-test-fw" TURN_TEST_FW_SCRIPT=/fw/host-firewall.sh \
  TURN_TEST_PEER_NET="container:$CID" TURN_TEST_FW_INPORT=49990 ./test-denied.sh
