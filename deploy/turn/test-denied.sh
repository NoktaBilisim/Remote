#!/usr/bin/env bash
# coturn doğrulama (G-05, AC-21/22): HMAC credential + denied-peer-ip negatif testleri, turnutils_uclient ile.
#  1) Pozitif: geçerli HMAC (server algoritması: user=<expiry>:<id>, pass=base64(HMAC-SHA1(secret,user)))
#     ile UDP / TCP / TLS allocation + kendi relay IP'sine (allowed-peer-ip) channel bind -> başarılı.
#     Kontrol peer'ı (genel IPv4/IPv6) -> başarılı; böylece 403'lerin "her şeyi reddeden" bir satırdan
#     gelmediği kanıtlanır (bkz. base.conf `::` notu).
#  2) Negatif kimlik: yanlış secret ve süresi geçmiş username -> allocation reddedilir.
#  3) Negatif peer: base + local dosyadaki HER denied-peer-ip satırının ilk ve son adresi -> 403
#     (IPv6 satırları: relay-ip IPv4 olduğundan IPv6 allocation 440 ile de reddedilebilir; ikisi de "erişilemez").
#  4) Host OUTPUT kuralı (S-P3-2, host-firewall.sh; TURN_TEST_FW=1 varsayılan): kendi IP'sine relay aralığı DIŞI
#     port (echo peer 3480, 3478 TURN-in-TURN, 53) -> paket düşer (echo yok + DROP sayacı artar); aralık İÇİ port
#     (relay<->relay) -> echo döner. Staging'de root ile çalıştırılır (iptables sayaçları okunur).
# Kullanım (staging, sunucuda):  cd /opt/remote/deploy/turn && set -a && . ./.env && set +a && ./test-denied.sh
# Env: TURN_SECRET, TURN_EXTERNAL_IP (zorunlu); TURN_HOST (127.0.0.1), TURN_TEST_NETWORK (host),
#      TURN_LOCAL_CONF (./denied-peer-ip.local.conf), TURN_TEST_TLS (1), TURN_TEST_PUBLIC_PEER (1.1.1.1),
#      TURN_TEST_PUBLIC_PEER6 (2606:4700:4700::1111). Kontrol peer'ına tek 100 baytlık UDP paketi gider.
#      Bölüm 4: TURN_TEST_FW (1), TURN_TEST_FW_EXEC (iptables/betik önüne eklenen komut; staging boş),
#      TURN_TEST_FW_SCRIPT (./host-firewall.sh), TURN_TEST_PEER_NET (echo peer ağı; vars. TURN_TEST_NETWORK),
#      TURN_TEST_FW_OUTPORT (3480; aralık dışı, boş olmalı), TURN_TEST_FW_INPORT (vars. base.conf max-port).
# Staging'de ~60 allocation açar, 40 portluk aralık dolar: test oturumu yokken çalıştırın (~20-25 dk).
# Çıkış kodu: 0 = tüm beklentiler tuttu, 1 = en az bir FAIL. Secret yazdırılmaz.
set -uo pipefail
cd "$(dirname "$0")"
: "${TURN_SECRET:?TURN_SECRET gerekli}"
: "${TURN_EXTERNAL_IP:?TURN_EXTERNAL_IP gerekli}"
HOST="${TURN_HOST:-127.0.0.1}"
NET="${TURN_TEST_NETWORK:-host}"
LOCAL="${TURN_LOCAL_CONF:-./denied-peer-ip.local.conf}"
SELF="${TURN_EXTERNAL_IP%%/*}"
PUB4="${TURN_TEST_PUBLIC_PEER:-1.1.1.1}"
PUB6="${TURN_TEST_PUBLIC_PEER6:-2606:4700:4700::1111}"
IMAGE="$(awk '/image: coturn\/coturn/ {print $2; exit}' docker-compose.yml)"
[ -n "$IMAGE" ] || { echo "imaj docker-compose.yml'den okunamadı" >&2; exit 2; }
[ -f "$LOCAL" ] || { echo "$LOCAL yok" >&2; exit 2; }
OUT="$(mktemp)"; trap 'rm -f "$OUT"' EXIT
n=0; pass=0; fail=0; v6_ok=1

# uclient <ad> <secret> <expiry-ofset-sn> [uclient argümanları...] -> $rc, çıktı $OUT
uclient() {
  local id="$1" secret="$2" off="$3"; shift 3
  n=$((n + 1))
  local user="$(( $(date +%s) + off )):t$$-$n-$id"
  local pw; pw="$(printf %s "$user" | openssl dgst -sha1 -hmac "$secret" -binary | base64)"
  docker run --rm --network "$NET" --entrypoint turnutils_uclient "$IMAGE" \
    -u "$user" -w "$pw" -n 1 -m 1 -c "$@" "$HOST" >"$OUT" 2>&1
  rc=$?
  # Kaynak tükenmesi: 508 = relay portu kalmadı (her deneme bir allocation; 600 sn yaşar; staging'de 40 port),
  # 486 = user-quota (kullanıcı başına allocation tavanı) aşıldı; uclient bazen yalnız "Cannot complete Allocation"
  # yazar. Hepsinde kaynak boşalana kadar bekleyip aynı denemeyi tekrarla (en çok TURN_TEST_WAIT_MAX sn).
  # Yalnız beklenen başarısızlık değilse tekrarla: negatif kimlik/IPv6 relay testleri (wrong/expired/v6relay) zaten "Cannot complete
  # Allocation" bekler -> 401 görülen çıktı tekrarlanmaz (aksi halde her negatif test 700 sn beklerdi).
  local waited=0
  retryable() {
    grep -Eq 'error (508|486)' "$OUT" && return 0
    grep -q 'Cannot complete Allocation' "$OUT" && ! grep -Eq 'error (401|403|437|438|440|441|442|443)' "$OUT" \
      && case "$id" in wrong|expired|v6relay) false ;; *) true ;; esac
  }
  while retryable && [ "$waited" -lt "${TURN_TEST_WAIT_MAX:-700}" ]; do
    [ "$waited" = 0 ] && echo "WAIT  relay kaynağı dolu (508/486/Cannot complete Allocation), boşalması bekleniyor..."
    sleep 30; waited=$((waited + 30))
    docker run --rm --network "$NET" --entrypoint turnutils_uclient "$IMAGE" \
      -u "$user" -w "$pw" -n 1 -m 1 -c "$@" "$HOST" >"$OUT" 2>&1
    rc=$?
  done
}
ok()  { pass=$((pass + 1)); printf 'PASS  %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf 'FAIL  %s\n' "$1"; grep -v 'pool disabled' "$OUT" | tail -3 | sed 's/^/      /'; }
expect_ok()  { if [ "$rc" -eq 0 ] && ! grep -q 'error 4' "$OUT"; then ok "$1"; else bad "$1 (başarı beklendi)"; fi; }
expect_403() { if [ "$rc" -ne 0 ] && grep -q 'error 403' "$OUT"; then ok "$1"; else bad "$1 (403 beklendi)"; fi; }
# IPv6 peer: 403 (denied) veya 440/443 (IPv6 relay kapalı / aile uyuşmazlığı) -> erişilemez.
expect_403_or_v4only() { if [ "$rc" -ne 0 ] && grep -Eq 'error (403|440|443)' "$OUT"; then ok "$1"; else bad "$1 (403/440 beklendi)"; fi; }
expect_noalloc() { if [ "$rc" -ne 0 ] && grep -q 'Cannot complete Allocation' "$OUT"; then ok "$1"; else bad "$1 (allocation reddi beklendi)"; fi; }

echo "== 1) HMAC credential, pozitif (host=$HOST, relay=$SELF)"
uclient udp "$TURN_SECRET" 600 -e "$SELF";            expect_ok "UDP 3478 allocation + kendi relay IP'si (allowed-peer-ip)"
uclient tcp "$TURN_SECRET" 600 -t -e "$SELF";         expect_ok "TCP 3478 allocation"
if [ "${TURN_TEST_TLS:-1}" = 1 ]; then
  uclient tls "$TURN_SECRET" 600 -t -S -p 5349 -e "$SELF"; expect_ok "TLS 5349 allocation"
fi
uclient pub4 "$TURN_SECRET" 600 -e "$PUB4";           expect_ok "kontrol: genel IPv4 peer $PUB4 izinli"
# S-P3-3 / ADR-0007 r5 m.5: relay-ip IPv4 -> IPv6 relay (REQUESTED-ADDRESS-FAMILY=IPv6) açılmamalı.
uclient v6relay "$TURN_SECRET" 600 -x -e "$PUB6"
if [ "$rc" -ne 0 ] && grep -Eq 'error 440|Cannot complete Allocation' "$OUT"; then ok "IPv6 relay allocation reddedildi (relay-ip IPv4)"
elif [ "$rc" -eq 0 ] && ! grep -q 'error 4' "$OUT"; then bad "IPv6 relay açık: $PUB6'e relay edildi (relay-ip IPv4 olmalı)"
else bad "IPv6 relay denemesi beklenmeyen sonuç"; fi
v6_ok=0
[ -n "$(ip -6 addr show scope global 2>/dev/null)" ] || echo "INFO  host'ta global IPv6 yok (staging, S-P2-5): IPv6 relay zaten imkânsız; prod ağında P13'te tekrar koşulur"

echo "== 2) HMAC credential, negatif"
uclient wrong "wrong-secret-for-test" 600 -e "$SELF"; expect_noalloc "yanlış secret reddedildi"
uclient expired "$TURN_SECRET" -60 -e "$SELF";        expect_noalloc "süresi geçmiş username reddedildi"

echo "== 3) denied-peer-ip (base + $LOCAL), her satırın ilk ve son adresi"
for ip in $( { grep -h '^denied-peer-ip=' turnserver.base.conf "$LOCAL"; echo 'denied-peer-ip=::'; } \
             | sed 's/^denied-peer-ip=//' | tr '-' '\n' | awk '!seen[$0]++'); do
  if [ "$ip" = "$SELF" ]; then echo "SKIP  $ip (TURN'ün kendi relay IP'si; allowed-peer-ip, relay<->relay)"; continue; fi
  case "$ip" in
    *:*) uclient deny "$TURN_SECRET" 600 -x -e "$ip"; expect_403_or_v4only "$ip reddedildi (IPv6; relay yalnız IPv4)" ;;
    *)   uclient deny "$TURN_SECRET" 600 -e "$ip"; expect_403 "$ip reddedildi (IPv4)" ;;
  esac
done

if [ "${TURN_TEST_FW:-1}" = 1 ]; then
  echo "== 4) host OUTPUT kuralı (S-P3-2; relay -> kendi IP'si $SELF, aralık dışı port düşmeli)"
  FWX="${TURN_TEST_FW_EXEC:-}"; FWS="${TURN_TEST_FW_SCRIPT:-./host-firewall.sh}"
  PNET="${TURN_TEST_PEER_NET:-$NET}"
  OUTP="${TURN_TEST_FW_OUTPORT:-3480}"
  INP="${TURN_TEST_FW_INPORT:-$(sed -n 's/^max-port=//p' turnserver.base.conf)}"
  drops() { $FWX iptables -w -L REMOTE-TURN-OUT -vnx 2>/dev/null | awk '$3=="DROP" {s+=$1} END {print s+0}'; }
  # shellcheck disable=SC2086
  if $FWX $FWS check >"$OUT" 2>&1; then ok "host-firewall.sh check: kurallar yüklü"; else bad "host-firewall.sh check (kural yok/eksik; root?)"; fi
  P1="$(docker run -d --rm --network "$PNET" --entrypoint turnutils_peer "$IMAGE" -p "$OUTP")"
  P2="$(docker run -d --rm --network "$PNET" --entrypoint turnutils_peer "$IMAGE" -p "$INP")"
  trap 'rm -f "$OUT"; docker rm -f "$P1" "$P2" >/dev/null 2>&1' EXIT
  sleep 1
  delivered() { grep -Eq 'Total lost packets 0 ' "$OUT"; }
  uclient fwin "$TURN_SECRET" 600 -e "$SELF" -r "$INP"
  if [ "$rc" -eq 0 ] && delivered; then ok "relay -> $SELF:$INP (aralık içi, relay<->relay) echo döndü"; else bad "relay -> $SELF:$INP (aralık içi) echo dönmedi"; fi
  d0="$(drops)"
  uclient fwout "$TURN_SECRET" 600 -e "$SELF" -r "$OUTP"; d1="$(drops)"
  if ! delivered && [ "$d1" -gt "$d0" ]; then ok "relay -> $SELF:$OUTP (aralık dışı) düştü (echo yok, DROP +$((d1 - d0)))"
  else bad "relay -> $SELF:$OUTP (aralık dışı) düşmedi (DROP $d0 -> $d1)"; fi
  for port in 3478 53; do
    uclient "fw$port" "$TURN_SECRET" 600 -e "$SELF" -r "$port"; d2="$(drops)"
    if [ "$d2" -gt "$d1" ]; then ok "relay -> $SELF:$port düştü (DROP +$((d2 - d1)))"; else bad "relay -> $SELF:$port düşmedi (DROP $d1 -> $d2)"; fi
    d1="$d2"
  done
else
  echo "SKIP  4) host OUTPUT kuralı (TURN_TEST_FW=0) — staging/prod'da P3 kapanış şartı, atlanamaz"
fi

echo "== Sonuç: $pass PASS, $fail FAIL"
[ "$fail" -eq 0 ]
