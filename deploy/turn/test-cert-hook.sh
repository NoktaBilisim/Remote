#!/usr/bin/env bash
# cert-deploy-hook.sh yerel testi (P13b T2; mimari-p13 §7.4 m.2-4, G-P13b-4). Gerçek certs/, .env, /etc ve certbot
# KULLANILMAZ. Konteyner/ağ adları benzersizdir ($$), her durumda silinir.
#  A) Gerçek coturn (sabit imaj): sahte lineage ile atomik kopya; SIGUSR2 ile yeniden okuma (konteyner yeniden başlamadan
#     5349 parmak izi değişir); başka/benzer adlı lineage, bozuk lineage reddi; ulaşılamayan 5349'da restart + çıkış 1.
#     Hook host'ta çalışır (root değilse TURN_CERT_TEST_NONROOT=1).
#  B) Linux root konteyneri (alpine; docker yerine PATH taslağı, coturn yerine openssl s_server): sahiplik/izin
#     (dizin root:65533 0750, turn.key 65534:65533 0400, turn.crt 0:0 0444); symlink dizin / symlink hedef / g+w üst
#     dizin -> hiçbir şey yazılmaz, rc≠0; SIGUSR2 etkisizse restart yolu; restart da etkisizse çıkış 1; install/uninstall,
#     kurulu kopyanın /etc/default izin kontrolü.
# Kullanım: deploy/turn/test-cert-hook.sh   (yalnız A: PART=A, yalnız B: PART=B). Çıkış 0 = tüm beklentiler tuttu.
set -euo pipefail
cd "$(dirname "$0")"
HERE="$PWD"
IMAGE="$(awk '/image: coturn\/coturn/ {print $2; exit}' docker-compose.yml)"
P="rs-turn-hooktest-$$"
TMP="$(cd "$(mktemp -d)" && pwd -P)"   # macOS: /var -> /private/var bağlantısı çözülür (hook bağlantılı yolu reddeder)
cleanup() { docker rm -f "$P-coturn" "$P-linux" >/dev/null 2>&1 || true; docker network rm "$P" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
FAILS=0
pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; FAILS=$((FAILS + 1)); }
fp() { openssl x509 -in "$1" -noout -fingerprint -sha256 | sed 's/.*=//; s/://g' | tr 'a-f' 'A-F'; }
# mkcert <dizin> <ad>: EC P-256, SAN DNS:<ad>, 2 gün (LE yerine; yalnız test)
mkcert() {
  mkdir -p "$1"
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -sha256 -days 2 -subj "/CN=$2" \
    -addext "subjectAltName=DNS:$2" -keyout "$1/privkey.pem" -out "$1/fullchain.pem" >/dev/null 2>&1
}
NAME=remote.test

part_a() {
  echo "== A) gerçek coturn ($IMAGE): SIGUSR2 + atomik kopya"
  LN="$TMP/le/remote-turn"
  mkcert "$TMP/s/A" "$NAME"; mkcert "$TMP/s/B" "$NAME"; mkcert "$TMP/s/C" "$NAME"; mkcert "$TMP/s/W" "baska.test"
  mkcert "$TMP/le/eski-remote-turn" "$NAME"
  mkdir -p "$TMP/certs" "$LN"; chmod 0755 "$TMP" "$TMP/certs"
  cp "$TMP/s/A/fullchain.pem" "$TMP/certs/turn.crt"; cp "$TMP/s/A/privkey.pem" "$TMP/certs/turn.key"
  chmod 0444 "$TMP/certs/turn.crt" "$TMP/certs/turn.key"
  use() { cp "$TMP/s/$1/fullchain.pem" "$LN/fullchain.pem"; cp "$TMP/s/$2/privkey.pem" "$LN/privkey.pem"; }
  FP_A="$(fp "$TMP/s/A/fullchain.pem")"; FP_B="$(fp "$TMP/s/B/fullchain.pem")"; FP_C="$(fp "$TMP/s/C/fullchain.pem")"
  docker network create --subnet 172.31.251.0/24 "$P" >/dev/null
  docker run -d --name "$P-coturn" --network "$P" --ip 172.31.251.2 -p 127.0.0.1::5349 --user 65534:65533 --read-only \
    --tmpfs /tmp:mode=0700,uid=65534,gid=65533 --tmpfs /var/lib/coturn:uid=65534,gid=65533 --cap-drop ALL \
    --cap-add NET_BIND_SERVICE --security-opt no-new-privileges:true --entrypoint /bin/sh \
    -e TURN_SECRET="$(openssl rand -hex 32)" -e TURN_REALM="$NAME" -e TURN_EXTERNAL_IP=172.31.251.2 -e TURN_LISTEN_IPS=auto \
    -v "$HERE/entrypoint.sh:/etc/coturn/entrypoint.sh:ro" -v "$HERE/turnserver.base.conf:/etc/coturn/turnserver.base.conf:ro" \
    -v "$HERE/denied-peer-ip.local.conf.example:/etc/coturn/denied-peer-ip.local.conf:ro" -v "$TMP/certs:/etc/coturn/certs:ro" \
    "$IMAGE" /etc/coturn/entrypoint.sh >/dev/null
  PORT="$(docker port "$P-coturn" 5349/tcp | head -1 | sed 's/.*://')"
  export TURN_CERT_DIR="$TMP/certs" TURN_CERT_LINEAGE="$LN" TURN_CONTAINER="$P-coturn" TURN_TLS_NAME="$NAME" \
    TURN_TLS_CONNECT="127.0.0.1:$PORT" TURN_CERT_WAIT_SEC=10 TURN_CERT_RESTART_WAIT_SEC=15
  [ "$(id -u)" = 0 ] || export TURN_CERT_TEST_NONROOT=1
  served() { openssl s_client -connect "127.0.0.1:$PORT" -servername "$NAME" </dev/null 2>/dev/null \
    | openssl x509 -noout -fingerprint -sha256 2>/dev/null | sed 's/.*=//; s/://g' | tr 'a-f' 'A-F'; }
  for _ in $(seq 40); do [ "$(served)" = "$FP_A" ] && break; sleep 0.5; done
  [ "$(served)" = "$FP_A" ] && pass "coturn 5349 ilk sertifikayı (A) sunuyor" || { fail "coturn 5349 A sunmuyor"; return; }
  started0="$(docker inspect -f '{{.State.StartedAt}}' "$P-coturn")"
  unchanged() { [ "$(fp "$TMP/certs/turn.crt")" = "$FP_A" ]; }

  if RENEWED_LINEAGE="$TMP/le/eski-remote-turn" ./cert-deploy-hook.sh >"$TMP/o" 2>&1 && grep -q 'atlandı' "$TMP/o" && unchanged
  then pass "benzer adlı lineage (eski-remote-turn) -> atlandı, 0, dosyalar değişmedi (tam yol eşitliği)"
  else fail "benzer adlı lineage: $(cat "$TMP/o")"; fi
  use B A
  if RENEWED_LINEAGE="$LN" ./cert-deploy-hook.sh >"$TMP/o" 2>&1; then fail "anahtar uyuşmazlığı kabul edildi"
  elif grep -q 'eşleşmiyor' "$TMP/o" && unchanged; then pass "anahtar/sertifika uyuşmazlığı -> 1, dosyalar değişmedi"
  else fail "uyuşmazlık: $(cat "$TMP/o")"; fi
  use W W
  if RENEWED_LINEAGE="$LN" ./cert-deploy-hook.sh >"$TMP/o" 2>&1; then fail "yanlış ad kabul edildi"
  elif grep -q 'kapsamıyor' "$TMP/o" && unchanged; then pass "SAN'da $NAME yok -> 1, dosyalar değişmedi"
  else fail "yanlış ad: $(cat "$TMP/o")"; fi

  use B B
  if RENEWED_LINEAGE="$LN/" ./cert-deploy-hook.sh >"$TMP/o" 2>&1; then rc=0; else rc=$?; fi
  [ "$rc" = 0 ] && grep -q 'OK: coturn SIGUSR2' "$TMP/o" && pass "geçerli lineage -> 0, 'SIGUSR2 ile yeni sertifika'" \
    || fail "geçerli lineage rc=$rc: $(cat "$TMP/o")"
  [ "$(served)" = "$FP_B" ] && pass "5349 artık B'yi sunuyor (parmak izi ${FP_B:0:16}…)" || fail "5349 B sunmuyor"
  [ "$(docker inspect -f '{{.State.StartedAt}}' "$P-coturn")" = "$started0" ] \
    && pass "SIGUSR2: coturn 4.18 yeniden başlamadan sertifikayı yeniden okudu (StartedAt aynı)" || fail "konteyner yeniden başladı"
  [ "$(fp "$TMP/certs/turn.crt")" = "$FP_B" ] && cmp -s "$TMP/certs/turn.key" "$TMP/s/B/privkey.pem" \
    && pass "turn.crt/turn.key = lineage" || fail "kopya içeriği"
  [ -z "$(find "$TMP/certs" -name '.turn.*' -print)" ] && pass "geçici dosya kalmadı" || fail "geçici dosya kaldı"
  ! grep -q 'PRIVATE KEY' "$TMP/o" && pass "çıktıda anahtar içeriği yok" || fail "çıktıda anahtar var"
  ./cert-deploy-hook.sh check >"$TMP/o" 2>&1 && pass "check -> 0 (sunulan = dosya)" || fail "check: $(cat "$TMP/o")"

  # 5349'a ulaşılamıyor (yanlış port): SIGUSR2 sonrası eşleşme yok -> restart -> yine yok -> çıkış 1 + HATA.
  use C C
  if TURN_TLS_CONNECT=127.0.0.1:9 TURN_CERT_WAIT_SEC=1 TURN_CERT_RESTART_WAIT_SEC=2 \
       RENEWED_LINEAGE="$LN" ./cert-deploy-hook.sh >"$TMP/o" 2>&1; then fail "ulaşılamayan 5349'da 0 döndü"
  elif grep -q 'docker restart' "$TMP/o" && grep -q 'HATA yeniden başlatma sonrası' "$TMP/o"; then pass "5349 doğrulanamadı -> restart + çıkış 1 + HATA"
  else fail "ulaşılamayan 5349: $(cat "$TMP/o")"; fi
  [ "$(docker inspect -f '{{.State.StartedAt}}' "$P-coturn")" != "$started0" ] && pass "restart gerçekten yapıldı" || fail "restart yapılmadı"
  PORT="$(docker port "$P-coturn" 5349/tcp | head -1 | sed 's/.*://')"   # restart yayımlanan host portunu değiştirir
  for _ in $(seq 30); do [ "$(served)" = "$FP_C" ] && break; sleep 0.5; done
  [ "$(served)" = "$FP_C" ] && pass "restart sonrası coturn yeni sertifikayla (C) ayakta" || fail "restart sonrası C sunulmuyor"
  unset TURN_CERT_DIR TURN_CERT_LINEAGE TURN_CONTAINER TURN_TLS_NAME TURN_TLS_CONNECT TURN_CERT_WAIT_SEC TURN_CERT_RESTART_WAIT_SEC TURN_CERT_TEST_NONROOT
}

part_b() {
  echo "== B) Linux root konteyneri: sahiplik/izin, symlink, restart yolu, install"
  cat >"$TMP/docker-stub" <<'EOF'
#!/bin/sh
# docker taslağı: coturn yerine openssl s_server. /run/mode_usr2 = reload|ignore, /run/mode_restart = ok|stale
srv() { [ -f /run/srv.pid ] && kill "$(cat /run/srv.pid)" 2>/dev/null; sleep 0.2
  openssl s_server -accept 5349 -cert "$1" -key "$2" -quiet -naccept 100000 </dev/null >/dev/null 2>&1 & echo $! >/run/srv.pid; sleep 0.5; }
echo "docker $*" >>/run/docker.log
case "$1" in
  inspect) echo true ;;
  kill) [ "$(cat /run/mode_usr2)" = reload ] && srv "$CD/turn.crt" "$CD/turn.key"; true ;;
  restart) [ "$(cat /run/mode_restart)" = ok ] && srv "$CD/turn.crt" "$CD/turn.key"; true ;;
  start-initial) srv "$CD/turn.crt" "$CD/turn.key" ;;
esac
EOF
  cat >"$TMP/inner.sh" <<'EOF'
#!/bin/sh
set -u
apk add --no-cache openssl findutils >/dev/null 2>&1 || { echo "FAIL  apk"; echo "B-SONUÇ 1"; exit 1; }
F=0; ok() { echo "PASS  $*"; }; no() { echo "FAIL  $*"; F=$((F + 1)); }
mkdir -p /stub && cp /t/docker-stub /stub/docker && chmod 755 /stub/docker; export PATH="/stub:$PATH"
LN=/etc/letsencrypt/live/remote-turn; export CD=/etc/remote/turn-certs
mk() { mkdir -p "$1"; openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 2 -subj /CN=remote.test \
  -addext subjectAltName=DNS:remote.test -keyout "$1/privkey.pem" -out "$1/fullchain.pem" >/dev/null 2>&1; }
newle() { rm -rf "$LN"; mk "$LN"; }
fpf() { openssl x509 -in "$1" -noout -fingerprint -sha256 | sed 's/.*=//; s/://g'; }
perm() { stat -c '%u:%g %a' "$1"; }
export TURN_CONTAINER=remote-turn-coturn-1 TURN_TLS_NAME=remote.test TURN_TLS_CONNECT=127.0.0.1:5349 \
  TURN_CERT_WAIT_SEC=2 TURN_CERT_RESTART_WAIT_SEC=3
H=/hook/cert-deploy-hook.sh
echo reload >/run/mode_usr2; echo ok >/run/mode_restart; : >/run/docker.log
# 1) İlk dağıtım: /etc/remote/turn-certs yok -> root:65533 0750 oluşturulur (üst dizin runbook'ta install -d ile)
install -d -m 0755 /etc/remote; newle
if RENEWED_LINEAGE=$LN sh $H >/tmp/o 2>&1 && grep -q 'oluşturuldu' /tmp/o; then ok "ilk çalıştırma: $CD oluşturuldu"; else no "ilk: $(cat /tmp/o)"; fi
[ "$(perm $CD)" = "0:65533 750" ] && ok "$CD root:65533 0750" || no "$CD $(perm $CD)"
docker start-initial
# 2) SIGUSR2 yolu + izinler
newle; : >/run/docker.log
if RENEWED_LINEAGE=$LN sh $H >/tmp/o 2>&1 && grep -q 'OK: coturn SIGUSR2' /tmp/o; then ok "SIGUSR2 yolu -> 0"; else no "SIGUSR2 yolu: $(cat /tmp/o)"; fi
grep -q 'docker kill -s USR2 remote-turn-coturn-1' /run/docker.log && ! grep -q 'docker restart' /run/docker.log && ok "yalnız USR2 gönderildi (restart yok)" || no "docker çağrıları: $(cat /run/docker.log)"
[ "$(perm $CD/turn.key)" = "65534:65533 400" ] && ok "turn.key 65534:65533 0400" || no "turn.key $(perm $CD/turn.key)"
[ "$(perm $CD/turn.crt)" = "0:0 444" ] && ok "turn.crt 0:0 0444" || no "turn.crt $(perm $CD/turn.crt)"
[ "$(fpf $CD/turn.crt)" = "$(fpf $LN/fullchain.pem)" ] && ok "turn.crt = lineage" || no "turn.crt içerik"
[ -z "$(find $CD -name '.turn.*')" ] && ok "geçici dosya kalmadı" || no "geçici dosya kaldı"
# 3) SIGUSR2 etkisiz -> restart -> OK
echo ignore >/run/mode_usr2; newle; : >/run/docker.log
if RENEWED_LINEAGE=$LN sh $H >/tmp/o 2>&1 && grep -q 'yeniden başlatıldı' /tmp/o && grep -q 'docker restart' /run/docker.log; then ok "SIGUSR2 etkisiz -> restart -> 0"; else no "restart yolu: $(cat /tmp/o)"; fi
# 4) restart da etkisiz -> 1 + HATA
echo stale >/run/mode_restart; newle
if RENEWED_LINEAGE=$LN sh $H >/tmp/o 2>&1; then no "restart etkisizken 0"; else grep -q 'HATA yeniden başlatma sonrası' /tmp/o && ok "restart etkisiz -> 1 + HATA" || no "çıktı: $(cat /tmp/o)"; fi
echo reload >/run/mode_usr2; echo ok >/run/mode_restart
# 5) G-P13b-4 olumsuz: symlink dizin, symlink hedef, g+w üst dizin, root olmayan sahip -> rc≠0, hiçbir şey yazılmaz
BEFORE="$(fpf $CD/turn.crt)"
mkdir -p /saldirgan && chmod 0777 /saldirgan
mv $CD /etc/remote/turn-certs.real && ln -s /saldirgan /etc/remote/turn-certs; newle
if RENEWED_LINEAGE=$LN sh $H >/tmp/o 2>&1; then no "symlink dizine yazdı"; else grep -q 'sembolik bağlantı' /tmp/o && [ -z "$(ls -A /saldirgan)" ] && ok "certs symlink -> rc≠0, hedefe hiçbir şey yazılmadı" || no "symlink: $(cat /tmp/o) / $(ls -A /saldirgan)"; fi
rm /etc/remote/turn-certs && mv /etc/remote/turn-certs.real $CD
touch /saldirgan/hedef; ln -sf /saldirgan/hedef $CD/turn.key
if RENEWED_LINEAGE=$LN sh $H >/tmp/o 2>&1; then no "symlink hedef izlendi"; else grep -q 'normal dosya değil' /tmp/o && [ "$(perm /saldirgan/hedef)" = "0:0 644" ] && [ ! -s /saldirgan/hedef ] && ok "turn.key symlink -> rc≠0, bağlantı hedefi chown/yazılmadı" || no "symlink hedef: $(cat /tmp/o) $(perm /saldirgan/hedef)"; fi
rm $CD/turn.key; cp $LN/privkey.pem $CD/turn.key
chmod 0775 /etc/remote
if RENEWED_LINEAGE=$LN sh $H >/tmp/o 2>&1; then no "g+w üst dizin kabul"; else grep -q 'group/other yazabiliyor' /tmp/o && ok "üst dizin g+w -> rc≠0" || no "g+w: $(cat /tmp/o)"; fi
chmod 0755 /etc/remote; chown 1000 $CD
if RENEWED_LINEAGE=$LN sh $H >/tmp/o 2>&1; then no "root olmayan sahip kabul"; else grep -q 'sahibi root değil' /tmp/o && ok "dizin sahibi root değil -> rc≠0" || no "sahip: $(cat /tmp/o)"; fi
chown 0 $CD
[ "$(fpf $CD/turn.crt)" = "$BEFORE" ] && ok "olumsuz testlerde turn.crt değişmedi" || no "olumsuz testte turn.crt değişti"
# 6) RENEWED_LINEAGE yok / çok satırlı / benzer ad
if sh $H >/tmp/o 2>&1; then no "RENEWED_LINEAGE boşken 0"; else ok "RENEWED_LINEAGE boş -> 1"; fi
if RENEWED_LINEAGE="/x
$LN" sh $H >/tmp/o 2>&1; then no "çok satırlı lineage kabul"; else ok "çok satırlı RENEWED_LINEAGE -> 1"; fi
mk /etc/letsencrypt/live/eski-remote-turn
RENEWED_LINEAGE=/etc/letsencrypt/live/eski-remote-turn sh $H >/tmp/o 2>&1 && grep -q atlandı /tmp/o && [ "$(fpf $CD/turn.crt)" = "$BEFORE" ] \
  && ok "eski-remote-turn -> atlandı" || no "benzer ad: $(cat /tmp/o)"
# 7) install / kurulu kopya
cp $H /tmp/h.sh
rm -rf /usr/local/sbin; sh /tmp/h.sh install >/tmp/o 2>&1 && ok "install -> 0" || no "install: $(cat /tmp/o)"
[ "$(stat -c '%u %a' /usr/local/sbin/remote-turn-cert-deploy)" = "0 755" ] && ok "kurulu kopya root 0755" || no "kurulu kopya izni"
[ "$(stat -c '%u %a' /etc/default/remote-turn-cert)" = "0 644" ] && grep -qx "TURN_CERT_DIR=$CD" /etc/default/remote-turn-cert \
  && grep -qx "TURN_CERT_LINEAGE=$LN" /etc/default/remote-turn-cert && ok "/etc/default/remote-turn-cert 0644, değerler" || no "conf: $(cat /etc/default/remote-turn-cert)"
newle
if TURN_CERT_DIR=/yanlis RENEWED_LINEAGE=$LN /usr/local/sbin/remote-turn-cert-deploy >/tmp/o 2>&1 && [ "$(fpf $CD/turn.crt)" = "$(fpf $LN/fullchain.pem)" ]; then
  ok "kurulu kopya yalnız /etc/default'u okur (env TURN_CERT_DIR yok sayıldı)"; else no "kurulu kopya: $(cat /tmp/o)"; fi
if TURN_CERT_TEST_NONROOT=1 /usr/local/sbin/remote-turn-cert-deploy check >/tmp/o 2>&1; then no "kurulu kopya TEST_NONROOT kabul etti"; else ok "kurulu kopya TURN_CERT_TEST_NONROOT'u reddeder"; fi
chmod 0666 /etc/default/remote-turn-cert
if RENEWED_LINEAGE=$LN /usr/local/sbin/remote-turn-cert-deploy >/tmp/o 2>&1; then no "0666 conf kabul edildi"; else grep -q 'group/other yazabiliyor' /tmp/o && ok "/etc/default 0666 -> çalışmaz" || no "$(cat /tmp/o)"; fi
sh /tmp/h.sh uninstall >/dev/null 2>&1; [ ! -e /usr/local/sbin/remote-turn-cert-deploy ] && [ ! -e /etc/default/remote-turn-cert ] && ok "uninstall temiz" || no "uninstall"
echo "B-SONUÇ $F"
EOF
  chmod 0755 "$TMP"; chmod 0644 "$TMP/docker-stub" "$TMP/inner.sh"
  docker run --rm --name "$P-linux" --user 0 -v "$HERE/cert-deploy-hook.sh:/hook/cert-deploy-hook.sh:ro" -v "$TMP:/t:ro" \
    alpine:3.20 sh /t/inner.sh >"$TMP/b.out" 2>&1 || true
  grep -E '^(PASS|FAIL)' "$TMP/b.out" || true
  n="$(sed -n 's/^B-SONUÇ //p' "$TMP/b.out")"
  if [ -z "$n" ]; then echo "B çıktısı:"; tail -5 "$TMP/b.out"; FAILS=$((FAILS + 1)); else FAILS=$((FAILS + n)); fi
}

case "${PART:-AB}" in *A*) part_a ;; esac
case "${PART:-AB}" in *B*) part_b ;; esac
echo
[ "$FAILS" = 0 ] && echo "SONUÇ: GEÇTİ" || { echo "SONUÇ: $FAILS FAIL"; exit 1; }
