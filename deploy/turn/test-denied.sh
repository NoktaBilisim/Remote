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
#      TURN_TEST_FW_OUTPORT (3480; aralık dışı, boş olmalı), TURN_TEST_FW_INPORT (vars. base.conf max-port = aralığın
#      SON portu 49479; relay<->relay aralık sınırında da çalışmalı).
#  0) Aralık/kapasite (P13b, ADR-0018 m.2): base.conf min/max = TURN_TEST_EXPECT_RANGE (49160-49479, 320 port),
#     total-quota (300) <= port sayısı ve >= 50 oturum x 6 allocation; user-quota 8.
# ~60 allocation açar (600 sn yaşar); prod'da 320 portluk aralığın ~%20'si: yoğun saatte çalıştırmayın (~3-5 dk).
# Çıkış kodu: 0 = tüm beklentiler tuttu, 1 = en az bir FAIL. Secret yazdırılmaz.
set -uo pipefail
cd "$(dirname "$0")" || exit 1
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
n=0; pass=0; fail=0

# uclient <ad> <secret> <expiry-ofset-sn> [uclient argümanları...] -> $rc, çıktı $OUT
uclient() {
  local id="$1" secret="$2" off="$3"; shift 3
  n=$((n + 1))
  local user="$(( $(date +%s) + off )):t$$-$n-$id"
  local pw; pw="$(printf %s "$user" | openssl dgst -sha1 -hmac "$secret" -binary | base64)"
  docker run --rm --network "$NET" --entrypoint turnutils_uclient "$IMAGE" \
    -u "$user" -w "$pw" -n 1 -m 1 -c "$@" "$HOST" >"$OUT" 2>&1
  rc=$?
  # Kaynak tükenmesi: 508 = relay portu kalmadı (her deneme bir allocation; 600 sn yaşar; prod 320 port),
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

echo "== 0) relay aralığı ve kapasite (turnserver.base.conf)"
cval() { sed -n "s/^$1=\([0-9][0-9]*\)\$/\1/p" turnserver.base.conf | tail -1; }
RMIN="$(cval min-port)"; RMAX="$(cval max-port)"; TQ="$(cval total-quota)"; UQ="$(cval user-quota)"
EXP="${TURN_TEST_EXPECT_RANGE:-49160-49479}"
NPORT=$(( ${RMAX:-0} - ${RMIN:-0} + 1 ))
if [ "$RMIN-$RMAX" = "$EXP" ]; then ok "relay aralığı $RMIN-$RMAX ($NPORT port; son port $RMAX)"; else bad "relay aralığı $RMIN-$RMAX (beklenen $EXP)"; fi
if [ -n "$TQ" ] && [ "$TQ" -le "$NPORT" ] && [ "$TQ" -ge 300 ]; then ok "total-quota $TQ: <= $NPORT port, >= 50 oturum x 6 allocation"
else bad "total-quota '${TQ:-yok}' (300 <= q <= $NPORT olmalı)"; fi
if [ "$UQ" = 8 ]; then ok "user-quota 8"; else bad "user-quota '${UQ:-yok}' (8 beklenir)"; fi

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
  # Aralık içi echo peer'ı: INP bölüm 1-3'ün allocation'larından birinin (600 sn yaşar) relay soketi olabilir
  # (CI 43706534669: coturn 172.31.250.2:49990'ı tutunca peer 0.0.0.0:49990'a bağlanamayıp çıktı -> "echo dönmedi").
  # Peer'ın ağ ad alanında p ve p+1 boş olan ilk portu seç (INP, INP-3, ... en çok 20 aday; hepsi aralık içi), başlat ve
  # gerçekten dinlediğini doğrula; dinlemiyorsa (yarış) sıradakini dene. Kuralın kendisi (aralık içi geçer) değişmedi.
  udp_busy() { $FWX ss -Hlun 2>/dev/null | awk -v a=":$1" -v b=":$(($1 + 1))" '{ for (i = 1; i <= NF; i++)
    if ($i ~ /:[0-9]+$/) { if (substr($i, length($i) - length(a) + 1) == a || substr($i, length($i) - length(b) + 1) == b) f = 1; break } }
    END { exit !f }'; }
  P2=""; cand="$INP"
  for _ in $(seq 20); do
    if ! udp_busy "$cand"; then
      P2="$(docker run -d --rm --network "$PNET" --entrypoint turnutils_peer "$IMAGE" -p "$cand")"
      sleep 1
      if udp_busy "$cand" && [ -n "$(docker ps -q --filter "id=$P2")" ]; then INP="$cand"; break; fi
      docker rm -f "$P2" >/dev/null 2>&1; P2=""
    fi
    cand=$((cand - 3))
  done
  trap 'rm -f "$OUT"; docker rm -f "$P1" ${P2:+"$P2"} >/dev/null 2>&1' EXIT
  [ -n "$P2" ] || echo "WARN  aralık içi echo peer'ı için boş port bulunamadı ($INP..$cand); sonraki test düşecek"
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
