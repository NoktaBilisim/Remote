#!/usr/bin/env bash
# Yerel/CI coturn testi: geçici secret + geçici staging CA/sertifika ile coturn'ü bridge ağda
# (docker-compose.test.yml) başlatır, test-denied.sh'ı çalıştırır, her durumda yığını kaldırır.
# Gerçek .env / denied-peer-ip.local.conf / certs/ KULLANILMAZ ve değiştirilmez. Kullanım: ./test-local.sh
# P13b ekleri: host-firewall.sh relay tavanı (hashlimit) + aralık değişiminde reserved ports geri alma + preflight;
# AC-21 bant ölçümü (TURN_MAX_BPS=1000000 bayt/sn, allocation başına; G-P13b-12); G-P13b-1 kapasite (64 eşzamanlı
# allocation, bps-capacity=0). TURN_TEST_BPS=0 / TURN_TEST_CAP=0 ile atlanır.
set -euo pipefail
cd "$(dirname "$0")"
TMP="$(mktemp -d)"
export COMPOSE_FILE=docker-compose.yml:docker-compose.test.yml COMPOSE_PROJECT_NAME=remote-turn-test
TURN_SECRET="$(openssl rand -hex 32)"
export TURN_SECRET TURN_REALM=remote.test TURN_EXTERNAL_IP=172.31.250.2
export TURN_PROMETHEUS_ADDRESS=0.0.0.0 TURN_TEST_CERT_DIR="$TMP/certs" TURN_LISTEN_IPS=auto
export TURN_MAX_BPS=1000000 TURN_BPS_CAPACITY=0   # prod değerleri (mimari-p13 §7.4, G-P13b-1)
cleanup() { docker ps -aq --filter name=remote-turn-test-x | xargs docker rm -f >/dev/null 2>&1 || true
  docker rm -f remote-turn-test-fw >/dev/null 2>&1 || true; docker compose --env-file /dev/null down -v >/dev/null 2>&1 || true; rm -rf "$TMP"; }
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
  "$IMAGE" -c 'apk add --no-cache iptables ip6tables iproute2 >/dev/null 2>&1 && touch /tmp/ready && exec sleep 3600' >/dev/null
for _ in $(seq 60); do docker exec remote-turn-test-fw test -f /tmp/ready 2>/dev/null && break; sleep 1; done
FX() { docker exec "$@" remote-turn-test-fw /fw/host-firewall.sh "${FWCMD[@]}"; }
# Aralık değişimi (49160-49199 -> 49160-49479): önceki apply'ın reserved ports kaydı geri alınır, yenisi eklenir; remove
# yalnız bizimkini çıkarır. /proc/sys konteynerde salt okunur -> TURN_FW_TEST_RES_FILE.
docker exec remote-turn-test-fw sh -c 'mkdir -p /var/lib/remote-turn-fw && echo 1000-1001,49160-49199 >/tmp/res &&
  echo 49160-49199 >/var/lib/remote-turn-fw/reserved.range && echo 1000-1001 >/var/lib/remote-turn-fw/reserved.before'
RENV=(-e TURN_EXTERNAL_IP=172.31.250.2 -e TURN_FW_PORT_MAX=49479 -e TURN_FW_RESERVE_PORTS=1 -e TURN_FW_TEST_RES_FILE=/tmp/res -e TURN_FW_SKIP_PREFLIGHT=1)
FWCMD=(apply); FX "${RENV[@]}" >/dev/null
r1="$(docker exec remote-turn-test-fw cat /tmp/res)"
FWCMD=(remove); FX "${RENV[@]}" >/dev/null
r2="$(docker exec remote-turn-test-fw cat /tmp/res)"
if [ "$r1" = "1000-1001,49160-49479" ] && [ "$r2" = "1000-1001" ]; then echo "PASS  aralık değişimi: reserved '$r1' -> remove '$r2' (eski 49160-49199 geri alındı)"
else echo "FAIL  reserved ports aralık değişimi: apply '$r1', remove '$r2'"; exit 1; fi
# preflight: aralıkta başka süreç UDP dinliyorsa apply yazmadan çıkar.
docker exec -d remote-turn-test-fw sh -c 'exec nc -u -l -p 49300 >/dev/null'
sleep 1
FWCMD=(preflight)
if FX -e TURN_EXTERNAL_IP=172.31.250.2 -e TURN_FW_PORT_MAX=49479 >"$TMP/pf" 2>&1; then echo "FAIL  preflight dinleyiciyi görmedi"; exit 1
elif grep -q '49300' "$TMP/pf"; then echo "PASS  preflight: aralıkta başka UDP dinleyici (49300) -> çıkış 1"; else echo "FAIL  preflight: $(cat "$TMP/pf")"; exit 1; fi
docker exec remote-turn-test-fw pkill -f 'nc -u -l' || true
# Aralıktaki (49160-49999) UDP dinleyicilerin yerel adresleri (test aracı dinleyicisi kapanana kadar bekle).
inrange() { docker exec remote-turn-test-fw ss -Hlun | awk '{ for (i = 1; i <= NF; i++) if ($i ~ /:[0-9]+$/) { n = split($i, x, ":");
  p = x[n] + 0; if (p >= 49160 && p <= 49999) print $i; break } }' | sort -u; }
for _ in $(seq 10); do inrange | grep -q ':49300$' || break; sleep 0.5; done
FWENV=(-e TURN_EXTERNAL_IP=172.31.250.2 -e TURN_FW_PORT_MAX=49999 -e TURN_FW_RESERVE_PORTS=0 -e TURN_FW_RELAY_MAX_BPS=62500000)
# P19 CI (43696731001 deneme 2): Docker gömülü DNS'i (127.0.0.11) bridge ağdaki konteynerin ağ ad alanında çekirdeğin
# geçici aralığından rastgele bir UDP portunda dinler; 49415 relay aralığına düştü ve apply'ın preflight'ı haklı olarak
# çıkış 1 verdi. Bu soket yalnız bridge TEST ağında vardır (staging/prod coturn host ağında; orada aralıkta yabancı
# dinleyici -> çıkış 1 aynen geçerli, host-firewall.sh değişmedi). Test: aralıkta hiç dinleyici yoksa preflight'ın 0
# döndüğü (pozitif yol) ayrıca doğrulanır ve apply preflight ile koşar; yalnız 127.0.0.11 varsa apply preflight'sız
# koşar (negatif yol yukarıda 49300 ile zaten doğrulandı); başka yabancı dinleyici varsa test düşer (test ortamı kirli).
FOREIGN="$(inrange | tr '\n' ' ')"
if [ -z "$FOREIGN" ]; then
  FWCMD=(preflight)
  if FX "${FWENV[@]}" >"$TMP/pf" 2>&1; then echo "PASS  preflight: aralık boş -> çıkış 0"
  else echo "FAIL  preflight boş aralıkta reddetti: $(cat "$TMP/pf")"; exit 1; fi
elif ! echo "$FOREIGN" | tr ' ' '\n' | grep -v '^$' | grep -qv '^127\.0\.0\.11:'; then
  echo "BİLGİ preflight pozitif yolu bu koşuda atlandı: Docker gömülü DNS aralıkta dinliyor ($FOREIGN); test apply preflight'sız"
  FWENV+=(-e TURN_FW_SKIP_PREFLIGHT=1)
else echo "FAIL  test ağ ad alanında aralıkta beklenmeyen UDP dinleyici: $FOREIGN"; exit 1; fi
FWCMD=(apply); FX "${FWENV[@]}"
FX "${FWENV[@]}" >/dev/null   # idempotent: 2. kez
n4="$(docker exec remote-turn-test-fw iptables -S REMOTE-TURN-OUT | grep -c '^-A')"
j4="$(docker exec remote-turn-test-fw iptables -S OUTPUT | grep -c 'REMOTE-TURN-OUT')"
h4="$(docker exec remote-turn-test-fw iptables -S REMOTE-TURN-OUT | grep -c 'hashlimit-above')"
if [ "$n4" = 5 ] && [ "$j4" = 1 ] && [ "$h4" = 3 ]; then echo "PASS  iki kez apply -> 5 kural (3 hashlimit relay tavanı), 1 atlama (idempotent)"
else echo "FAIL  idempotent/tavan değil ($n4 kural, $h4 hashlimit, $j4 atlama)"; exit 1; fi
FWCMD=(check)
if FX "${FWENV[@]}" >/dev/null; then echo "PASS  check: hashlimit kuralları dahil beklenen halde"; else echo "FAIL  check"; exit 1; fi
FWCMD=(print); FX "${FWENV[@]}" | sed 's/^/      /'
TURN_TEST_NETWORK=remote-turn-test_turntest TURN_HOST=172.31.250.2 \
  TURN_LOCAL_CONF=./denied-peer-ip.local.conf.example \
  TURN_TEST_FW_EXEC="docker exec ${FWENV[*]} remote-turn-test-fw" TURN_TEST_FW_SCRIPT=/fw/host-firewall.sh \
  TURN_TEST_PEER_NET="container:$CID" TURN_TEST_FW_INPORT=49990 ./test-denied.sh

cred() { TU="$(( $(date +%s) + 900 )):t$$-$1"; TP="$(printf %s "$TU" | openssl dgst -sha1 -hmac "$TURN_SECRET" -binary | base64)"; }
# Peer coturn ağ ad alanında, aralık İÇİ portta (host OUTPUT kuralı aralık dışını düşürür).
docker run -d --rm --name remote-turn-test-xpeer --network "container:$CID" --entrypoint turnutils_peer "$IMAGE" -p 49991 >/dev/null
sleep 1
# uclient <ad> [arg...] -> çıktı $TMP/<ad>.log
uc() { local n="$1"; shift; cred "$n"; docker run --rm --name "remote-turn-test-x$n" --network remote-turn-test_turntest \
  --entrypoint turnutils_uclient "$IMAGE" -u "$TU" -w "$TP" -c -e 172.31.250.2 -r 49991 "$@" 172.31.250.2 >"$TMP/$n.log" 2>&1 || true; }
# Saniyelik ilerleme satırlarından (tot_*_bytes) sıfır olmayan tam saniyelerin medyanı (ilk/son kısmi saniye atılır).
rate() { grep -o "tot_$2_bytes ~ [0-9]*" "$TMP/$1.log" | awk '{print $3}' | awk 'NR>1 {d=$1-p; if (d>0) print d} {p=$1}' \
  | sed '1d;$d' | sort -n | awk '{a[NR]=$1} END {print (NR ? a[int((NR+1)/2)] : 0)}'; }
# Aynı ilerleme satırından saniyelik "teklif teslim" çiftleri (aynı saniyeye ait olsunlar diye tek satırdan okunur).
pairs() { grep -o 'tot_send_bytes ~ [0-9]*, tot_recv_bytes ~ [0-9]*' "$TMP/$1.log" \
  | awk '{s=$3+0; r=$6+0; if (NR>1) print s-ps, r-pr; ps=s; pr=r}'; }

if [ "${TURN_TEST_BPS:-1}" = 1 ]; then
  echo "== AC-21 bant tavanı (TURN_MAX_BPS=1000000 bayt/sn; 1200 B x 1000 paket/sn = 1,2 MB/s teklif)"
  uc bps1 -l 1200 -z 1 -n 6000
  S1="$(rate bps1 send)"; R1="$(rate bps1 recv)"
  echo "      tek allocation: teklif ~$S1 B/s, teslim ~$R1 B/s (echo: istemci->relay->peer->relay->istemci)"
  if [ "$S1" -gt 1100000 ] && [ "$R1" -ge 900000 ] && [ "$R1" -le 1100000 ]; then
    echo "PASS  allocation başına tavan ~1 MB/s = 8 Mbit/s (birim BAYT/sn; bit olsaydı ~125 KB/s)"
  else echo "FAIL  bant ölçümü: teklif $S1, teslim $R1 (beklenen teklif > 1,1 MB/s, teslim 0,9-1,1 MB/s)"; exit 1; fi
  # G-P13b-12: tavan oturum/kullanıcı değil ALLOCATION başınadır: aynı credential ile 2 allocation ~2 MB/s taşır.
  # P14a A5 (AC-219) -n 8000'e çıkarmıştı; P19 CI (43689643033, 43696731001) yine düştü: uclient -m 2 iki allocation'ı
  # eşzamanlı başlatmayı garanti etmiyor (seri: 1 akış ~4 sn, 2 akış ~4 sn 2 MB/s, sonra yine 1 akış) ve tüm koşunun
  # medyanı tek akışa düşüyordu. Artık yalnız İKİ akışın da sürüldüğü saniyeler (o saniyenin teklifi >= 2,2 MB/s)
  # ölçülür: bu pencerede teslim medyanı >= 1,8 MB/s olmalı (credential başına tavan olsaydı ~1 MB/s -> FAIL, retry
  # YOK). Pencere < 3 sn ise ölçüm GEÇERSİZ sayılır ve en çok TURN_TEST_BPS_TRIES (3) kez yeniden koşulur.
  BPS_TRIES="${TURN_TEST_BPS_TRIES:-3}"; try=1
  while :; do
    uc bps2 -m 2 -l 1200 -z 1 -n 8000
    pairs bps2 >"$TMP/bps2.pairs"
    NW="$(awk '$1 >= 2200000' "$TMP/bps2.pairs" | wc -l | tr -d ' ')"
    R2="$(awk '$1 >= 2200000 {print $2}' "$TMP/bps2.pairs" | sort -n | awk '{a[NR]=$1} END {print (NR ? a[int((NR+1)/2)] : 0)}')"
    echo "      aynı credential, 2 allocation (deneme $try/$BPS_TRIES): iki akışın sürüldüğü $NW sn, bu pencerede teslim ~$R2 B/s"
    if [ "$NW" -ge 3 ]; then break; fi
    echo "      ölçüm geçersiz: istemci iki akışı aynı anda yeterince sürmedi (saniyelik teklif: $(awk '{printf "%d ", $1}' "$TMP/bps2.pairs"))"
    if [ "$try" -ge "$BPS_TRIES" ]; then
      echo "FAIL  $BPS_TRIES denemede iki akışın eşzamanlı sürüldüğü >= 3 sn'lik pencere elde edilemedi (test istemcisi; tavan ölçülemedi)"
      exit 1
    fi
    try=$((try + 1))
  done
  if [ "$R2" -ge 1800000 ]; then echo "PASS  max-bps allocation başına uygulanıyor (2 allocation eşzamanlı ~2 MB/s; G-P13b-12)"
  else
    echo "FAIL  2 allocation eşzamanlı sürülürken teslim $R2 (allocation başına ise ~2 MB/s beklenir; ~1 MB/s ise tavan credential başına)"
    echo "      saniyelik teklif/teslim: $(awk '{printf "%d/%d ", $1, $2}' "$TMP/bps2.pairs")"
    exit 1
  fi
fi

if [ "${TURN_TEST_CAP:-1}" = 1 ]; then
  echo "== G-P13b-1 kapasite: bps-capacity=0 iken 63 açık allocation + 64. açılır (62500000 ile 63. 486 alıyordu)"
  for i in 1 2 3 4 5 6 7 8; do m=8; [ "$i" = 8 ] && m=7; cred "cap$i"
    docker run -d --name "remote-turn-test-xcap$i" --network remote-turn-test_turntest --entrypoint turnutils_uclient "$IMAGE" \
      -u "$TU" -w "$TP" -c -h -m "$m" -n 1 -z 1000 -e 172.31.250.2 -r 49991 172.31.250.2 >/dev/null; done
  sleep 12
  NA="$(docker run --rm --network remote-turn-test_turntest --entrypoint wget "$IMAGE" -qO- http://172.31.250.2:9641/metrics \
    | awk '$1 ~ /^turn_total_allocations/ {s+=$2} END {print s+0}')"
  uc probe -n 1
  if [ "$NA" -ge 63 ] && ! grep -Eq 'error 486|Cannot complete Allocation' "$TMP/probe.log" && grep -q 'Total lost packets 0' "$TMP/probe.log"; then
    echo "PASS  $NA allocation açıkken 64. allocation açıldı (rezervasyon yok)"
  else echo "FAIL  kapasite: açık $NA, 64. deneme: $(grep -Eo 'error [0-9]+|Cannot complete Allocation' "$TMP/probe.log" | head -1)"; exit 1; fi
  docker ps -aq --filter name=remote-turn-test-xcap | xargs docker rm -f >/dev/null 2>&1 || true
fi
