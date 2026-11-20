#!/usr/bin/env bash
# Host nginx vhost'u testi (ADR-0015, G-10, G-E9-8; yerel ve CI). Sunucuya DOKUNMAZ: sunucudaki nginx sürümüyle
# (Ubuntu 24.04 = 1.24.0) geçici konteynerde, geçici öz-imzalı sertifikayla `nginx -t` + erişim logu maskesi sınanır.
# Upstream (127.0.0.1:4451) bu konteynerde yok → 443 istekleri 502 döner; amaç yalnız log satırıdır.
# P31 (§15.4): /downloads/NoktaDestek-* limit_req (7. istek 429, /api/ ve diğer yollar sınırsız), red satırı hata loguna ref yazmaz.
# Kullanım: deploy/nginx/test-nginx.sh
set -euo pipefail
cd "$(dirname "$0")"
IMAGE="nginx:1.24.0-alpine@sha256:77e5d4a6ad906c5d3793764085706577fa705b1dc6f244ea0241c4b5e2155385"
C=remote-nginx-test
TMP="$(mktemp -d)"
cleanup() { docker rm -f "$C" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
FAILS=0
pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; FAILS=$((FAILS + 1)); }

LE="$TMP/le"; mkdir -p "$LE/live/remote.noktabilisim.net"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=remote.noktabilisim.net \
  -keyout "$LE/live/remote.noktabilisim.net/privkey.pem" -out "$LE/live/remote.noktabilisim.net/fullchain.pem" 2>/dev/null
openssl dhparam -dsaparam -out "$LE/ssl-dhparams.pem" 2048 2>/dev/null
printf 'ssl_protocols TLSv1.2 TLSv1.3;\n' >"$LE/options-ssl-nginx.conf"   # certbot dosyasının yerine (test)
chmod -R a+rX "$TMP"

docker run -d --name "$C" -p 127.0.0.1::80 -p 127.0.0.1::443 \
  -v "$PWD/remote.noktabilisim.net.conf:/etc/nginx/conf.d/default.conf:ro" -v "$LE:/etc/letsencrypt:ro" \
  "$IMAGE" sh -c 'mkdir -p /var/www/remote-acme && exec nginx -g "daemon off;"' >/dev/null
docker exec "$C" nginx -t 2>&1 | grep -q 'test is successful' && pass "nginx -t" || { fail "nginx -t"; docker logs "$C"; exit 1; }
H80="$(docker port "$C" 80/tcp | head -1 | sed 's/.*://')"
H443="$(docker port "$C" 443/tcp | head -1 | sed 's/.*://')"
for _ in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$H80/" && break; sleep 0.2; done

REF=abcdefghijklmn27
R="--resolve remote.noktabilisim.net:$H443:127.0.0.1"
get80() { curl -s -o /dev/null -w '%{http_code}' -H 'Host: remote.noktabilisim.net' "http://127.0.0.1:$H80$1"; }
get443() { curl -sk $R -o /dev/null -w '%{http_code}' "https://remote.noktabilisim.net:$H443$1"; }
[ "$(get80 "/downloads/NoktaDestek-DemoFirma-$REF.exe?ref=gizli")" = 301 ] && pass "80 → 301" || fail "80 yönlendirme"
[ "$(get443 "/downloads/NoktaDestek-DemoFirma-$REF.exe?x=1")" = 502 ] && pass "443 → upstream (bu testte 502)" || fail "443"
# P31 §15.4 (S-P31-6, AC-510): limit_req 10/dk, burst 5, 429. Yukarıdaki firma .exe isteği 1. istektir (aynı IP, aynı kova);
# 2..6 burst içinde geçer (upstream yok → 502), 7. istek 429. Mac .zip ve jenerik zip aynı kovayı paylaşır.
for i in 2 3 4 5 6; do
  case $i in 2|4) u="/downloads/NoktaDestek-MacFirma-$REF.zip" ;; 3) u="/downloads/NoktaDestek-macOS.zip" ;; *) u="/downloads/NoktaDestek-DemoFirma-$REF.exe" ;; esac
  CODE="$(get443 "$u")"; [ "$CODE" = 502 ] && pass "limit_req: $i. indirme isteği geçer (502)" || fail "limit_req: $i. istek → $CODE"
done
CODE="$(get443 "/downloads/NoktaDestek-MacFirma-$REF.zip?gizli=1")"
[ "$CODE" = 429 ] && pass "limit_req: aynı IP'den 7. istek → 429 (1 + burst 5)" || fail "limit_req: 7. istek → $CODE (429 bekleniyordu)"
[ "$(get443 "/downloads/NoktaDestek-DemoFirma-$REF.exe")" = 429 ] && pass "limit_req: .exe firma yolu da aynı kovada 429" || fail "limit_req: exe 429 değil"
OK=1; for _ in $(seq 1 12); do [ "$(get443 /api/v1/health/x)" = 502 ] || OK=0; done
[ "$OK" = 1 ] && pass "limit_req: /api/ yolunda sınır yok (12 istek, 429 yok)" || fail "limit_req: /api/ yolu sınırlandı"
OK=1; for u in /downloads/NoktaDestek.exe /downloads/Destek-12345678.exe /r/webref /ws/request /; do [ "$(get443 "$u")" = 502 ] || OK=0; done
[ "$OK" = 1 ] && pass "limit_req: kova dolu iken NoktaDestek.exe, Destek-<kod>, /r/, /ws/, / etkilenmez" || fail "limit_req: kapsam dışı yol sınırlandı"
get443 "/x/NoktaDestek-Ikinci-$REF/y" >/dev/null
get443 "/downloads/NoktaDestek.exe" >/dev/null
get443 "/downloads/Destek-12345678.exe" >/dev/null
get443 "/session/TOKENGIZLI123/x" >/dev/null
# P12 gövde sınırı: 2 MiB dosyalı multipart geçer (upstream yok → 502), 3,2 MB → 413 (nginx kendisi keser)
head -c 2097152 /dev/urandom >"$TMP/img2m"; head -c 3200000 /dev/urandom >"$TMP/img3m"
post443() { curl -sk $R -o /dev/null -w '%{http_code}' -X POST -F "file=@$1;type=image/png" "https://remote.noktabilisim.net:$H443$2"; }
[ "$(post443 "$TMP/img2m" /api/v1/users/me/avatar)" = 502 ] && pass "2 MiB yükleme nginx'ten geçer" || fail "2 MiB yükleme nginx'te kesildi"
[ "$(post443 "$TMP/img3m" /api/v1/users/me/avatar)" = 413 ] && pass "3,2 MB → 413" || fail "3,2 MB 413 değil"
# D-P28b-4 / T14 (P28b K6): gövde host diskine yazılmaz. nginx geçici gövde dosyasını açar açmaz unlink ettiği için "dizin boş"
# denetimi ayırt etmez; bunun yerine geçici dizin yazılamaz yapılır: gövde bellekte kalıyorsa istek upstream'e ulaşır (502),
# diske tamponlanıyorsa nginx 500 döner. 2 MiB multipart (P12) ve 1 MiB PUT (P28b dosya parçası) denenir.
TD="$(docker exec "$C" nginx -T 2>/dev/null | awk '$1=="client_body_temp_path"{gsub(";","",$2);print $2; exit}')"
TD="${TD:-/var/cache/nginx/client_temp}"
docker exec "$C" sh -c "mkdir -p '$TD' && chmod 0500 '$TD'"
head -c 1048576 /dev/urandom >"$TMP/chunk1m"
[ "$(post443 "$TMP/img2m" /api/v1/users/me/avatar)" = 502 ] && pass "2 MiB gövde diske yazılmadan iletildi (temp yazılamazken 502)" \
  || fail "2 MiB gövde geçici dosyaya tamponlanıyor (client_body_buffer_size 3m server düzeyinde mi?)"
CODE="$(curl -sk $R -o /dev/null -w '%{http_code}' -X PUT -H 'Content-Type: application/octet-stream' -H 'Authorization: Bearer gizlibelirtec' \
  --data-binary "@$TMP/chunk1m" "https://remote.noktabilisim.net:$H443/api/v1/fsrv/uploads/01HFSRVTEST/chunks/0")"
[ "$CODE" = 502 ] && pass "1 MiB fsrv parçası diske yazılmadan iletildi (502)" || fail "1 MiB fsrv parçası → $CODE (diske tamponlanıyor?)"
docker exec "$C" sh -c "find '$TD' -type f | wc -l" | grep -qx 0 && pass "geçici gövde dizini boş" || fail "geçici gövde dizininde dosya var"
sleep 0.5
docker exec "$C" cat /var/log/nginx/remote.access.log >"$TMP/access.log"
U="$(grep -o '"uri":"[^"]*"' "$TMP/access.log" | sort | uniq -c)"
echo "$U"
grep -q '"status":429' "$TMP/access.log" && pass "429 erişim logunda görünür" || fail "429 erişim logunda yok"
docker exec "$C" sh -c 'cat /var/log/nginx/remote.error.log 2>/dev/null' >"$TMP/error.log" || true
grep -q -- "$REF" "$TMP/error.log" && fail "hata logunda ref var (limit_req red satırı)" || pass "hata logunda ref yok (error_log crit)"
grep -q 'MacFirma' "$TMP/access.log" && fail "logda 'MacFirma' var" || pass "logda 'MacFirma' yok"
for want in '/downloads/NoktaDestek-***' '/x/NoktaDestek-***' '/downloads/NoktaDestek.exe' '/downloads/Destek-***' '/session/***/x'; do
  grep -qF "\"uri\":\"$want\"" "$TMP/access.log" && pass "uri $want" || fail "uri $want yok"
done
for s in "$REF" DemoFirma Ikinci 12345678 TOKENGIZLI gizli 'x=1' gizlibelirtec; do
  if grep -q -- "$s" "$TMP/access.log"; then fail "logda '$s' var"; else pass "logda '$s' yok"; fi
done
echo
[ "$FAILS" = 0 ] && echo "SONUÇ: GEÇTİ" || { echo "SONUÇ: $FAILS FAIL"; exit 1; }
