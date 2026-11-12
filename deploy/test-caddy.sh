#!/usr/bin/env bash
# Caddyfile yönlendirme + log maskesi testi (P6/P8b; yerel ve CI). Gerçek .env, volume ve imajlar KULLANILMAZ.
# Geçici ağda sabitlenmiş Caddy imajı + sahte "server" (Node, bağımlılıksız: forward_auth iç ucu ve WS el sıkışması)
# başlatır, 4451 (düz HTTP, nginx arkası dinleyici) üzerinden istek atar, her durumda kaldırır.
# Doğrulananlar: firma dosyası NoktaDestek-<label>-<ref>.exe (AC-130, G-E9-11) aynı ikiliyi sunar (iki firma adı → aynı SHA-256) ve forward_auth'a
# adı sorgu dizesiz iletir; kapı 404/503 dönerse dosya sunulmaz; biçim dışı adlar server'a hiç gitmez; P6 yolları
# (NoktaDestek.exe, Destek-<8 hane>.exe) server'a maskeli gider; /ws/request ve /ws/panel yükseltilir; /internal/* 404;
# Caddy erişim/hata logunda ref, sorgu dizesi ve WS subprotocol (talep sırrı) yok (G-10, G-E9-8, T31).
# Kullanım: deploy/test-caddy.sh   ·   KEEP=1 (konteynerleri bırak)   ·   uzun WS bağlantısı (HTTP zaman aşımlarından etkilenmiyor mu, ~40 sn):
#           CADDY_TEST_WS_HOLD=1 deploy/test-caddy.sh
set -euo pipefail
cd "$(dirname "$0")"
CADDY_IMAGE="$(awk '/image: caddy:/ {print $2; exit}' docker-compose.yml)"
NODE_IMAGE="$(sed -n 's/^ARG NODE_IMAGE=//p' ../apps/server/Dockerfile)"
[ -n "$CADDY_IMAGE" ] && [ -n "$NODE_IMAGE" ] || { echo "imaj adı bulunamadı"; exit 2; }
P=remote-caddy-test
TMP="$(mktemp -d)"
cleanup() { docker rm -f "$P-caddy" "$P-server" >/dev/null 2>&1 || true; docker network rm "$P" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
if [ "${KEEP:-0}" = 1 ]; then trap - EXIT; fi   # KEEP=1: konteynerler incelemek için kalır (sonra elle rm)
FAILS=0
pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; FAILS=$((FAILS + 1)); }

REF=abcdefghijklmn27            # [a-z2-7]{16}
REF2=zyxwvutsrqpo2345           # ikinci firma (AC-130: aynı ikili)
FIRM="NoktaDestek-DemoFirma-$REF"
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | awk '{print $1}'; }
SUBPROTO="rs.req.TESTSIRRI$(openssl rand -hex 16)"   # sahte talep sırrı (subprotocol), her koşuda rastgele
mkdir -p "$TMP/dl"
printf 'MZ-sahte-ikili-%s' "$(date +%s)" >"$TMP/dl/NoktaDestek.exe"
chmod 0755 "$TMP" "$TMP/dl" && chmod 0644 "$TMP/dl/NoktaDestek.exe"
cat >"$TMP/mock.js" <<'JS'
// Sahte server:3001 — yalnız Caddy'nin ilettiklerini kaydeder (gerçek doğrulama server'ın işi). WS yanıtında
// en kötü durumu sınar: gerçek server yalnız rs.v1 seçer, burada sırlı ilk öğe geri yazılır → log filtresi silmeli.
const http = require("node:http"), crypto = require("node:crypto"), fs = require("node:fs");
const s = http.createServer((req, res) => {
  if (req.url.startsWith("/internal/agent-ready")) {
    const uri = req.headers["x-forwarded-uri"] ?? "";
    fs.appendFileSync("/tmp/fa.log", JSON.stringify({ uri, method: req.headers["x-forwarded-method"] ?? "" }) + "\n");
    if (uri.includes("NoktaDestek-Yanlis-")) { res.writeHead(404, { "content-type": "application/json" }); return res.end('{"error":{"code":"REQUEST_REF_INVALID"}}'); }
    if (uri.includes("NoktaDestek-Kapali-")) { res.writeHead(503, { "content-type": "application/json" }); return res.end('{"error":{"code":"NOT_READY"}}'); }
    res.writeHead(204); return res.end();
  }
  res.writeHead(404); res.end();
});
s.on("upgrade", (req, sock) => {
  const acc = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  const proto = (req.headers["sec-websocket-protocol"] ?? "").split(",")[0].trim();
  fs.appendFileSync("/tmp/ws.log", req.url.split("?")[0] + "\n");
  sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + acc +
    "\r\n" + (proto ? "Sec-WebSocket-Protocol: " + proto + "\r\n" : "") + "\r\n");
  const hold = req.url.startsWith("/ws/hold") ? 40000 : 500;   // /ws/hold: Caddy read/idle zaman aşımından uzun
  setTimeout(() => sock.end(Buffer.from([0x88, 0x00])), hold);  // close çerçevesi
});
s.listen(3001);
JS
chmod 0644 "$TMP/mock.js"

docker network create "$P" >/dev/null
docker run -d --name "$P-server" --network "$P" --network-alias server -v "$TMP/mock.js:/mock.js:ro" \
  "$NODE_IMAGE" node /mock.js >/dev/null
docker run -d --name "$P-caddy" --network "$P" -p 127.0.0.1::4451 \
  -e SITE_HOST=localhost -e EDGE_PROXY_SECRET=test-only-edge-secret-0123456789abcdef \
  -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$TMP/dl:/srv/downloads:ro" "$CADDY_IMAGE" >/dev/null
PORT="$(docker port "$P-caddy" 4451/tcp | head -1 | sed 's/.*://')"
B="http://127.0.0.1:$PORT"
for _ in $(seq 1 50); do curl -s -o /dev/null "$B/downloads/x" && break; sleep 0.2; done
WANT="$(cat "$TMP/dl/NoktaDestek.exe")"
fa_count() { docker exec "$P-server" sh -c 'cat /tmp/fa.log 2>/dev/null | wc -l' | tr -d ' '; }
fa_last() { docker exec "$P-server" sh -c 'tail -1 /tmp/fa.log'; }

echo "== firma dosyası (P8b)"
H="$(curl -s -D - -o "$TMP/out" "$B/downloads/$FIRM.exe?utm=1")"
CODE="$(printf '%s' "$H" | head -1 | awk '{print $2}')"
[ "$CODE" = 200 ] && [ "$(cat "$TMP/out")" = "$WANT" ] && pass "firma adı → 200, aynı ikili" || fail "firma adı: $CODE"
printf '%s' "$H" | grep -qi "^content-disposition: attachment; filename=\"$FIRM.exe\"" && pass "Content-Disposition firma adı" || fail "Content-Disposition"
printf '%s' "$H" | grep -qi '^cache-control: no-store' && pass "Cache-Control no-store" || fail "Cache-Control"
[ "$(fa_last)" = "{\"uri\":\"/downloads/$FIRM.exe\",\"method\":\"GET\"}" ] && pass "forward_auth X-Forwarded-Uri = yol (sorgu dizesi yok)" || fail "forward_auth uri: $(fa_last)"
cp "$TMP/out" "$TMP/out1"
FIRM2="NoktaDestek-IkinciFirma2-$REF2"
H="$(curl -s -D - -o "$TMP/out2" "$B/downloads/$FIRM2.exe")"
CODE="$(printf '%s' "$H" | head -1 | awk '{print $2}')"
S1="$(sha256 "$TMP/out1")"; S2="$(sha256 "$TMP/out2")"; S0="$(sha256 "$TMP/dl/NoktaDestek.exe")"
[ "$CODE" = 200 ] && [ -n "$S1" ] && [ "$S1" = "$S2" ] && [ "$S1" = "$S0" ] \
  && pass "AC-130: iki firma adı aynı SHA-256 (${S1:0:16}…)" || fail "AC-130 SHA-256: $CODE $S1 / $S2 / $S0"
printf '%s' "$H" | grep -qi "^content-disposition: attachment; filename=\"$FIRM2.exe\"" && pass "Content-Disposition ikinci firma adı" || fail "Content-Disposition (2)"
CODE="$(curl -s -o "$TMP/out" -w '%{http_code}' "$B/downloads/NoktaDestek-Yanlis-$REF.exe")"
[ "$CODE" = 404 ] && ! grep -q MZ-sahte "$TMP/out" && pass "kapı 404 (label/ref geçersiz) → dosya sunulmaz" || fail "kapı 404: $CODE"
CODE="$(curl -s -o "$TMP/out" -w '%{http_code}' "$B/downloads/NoktaDestek-Kapali-$REF.exe")"
[ "$CODE" = 503 ] && ! grep -q MZ-sahte "$TMP/out" && pass "kapı 503 (ikili kapısı) → dosya sunulmaz" || fail "kapı 503: $CODE"

echo "== biçim dışı adlar server'a gitmez (404)"
N0="$(fa_count)"
for bad in "NoktaDestek-ABCDEFGHIJKLMNOPQRSTU-$REF.exe" "NoktaDestek-Demo-ABCDEFGHIJKLMN27.exe" \
  "NoktaDestek-Demo-abcdefghijklmn18.exe" "NoktaDestek-Demo-abcdefghijklmn2.exe" "NoktaDestek-Demo_1-$REF.exe" \
  "NoktaDestek--$REF.exe" "x/$FIRM.exe" "$FIRM.exe.zip" "nokta$FIRM.exe" "Destek-1234567.exe"; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "$B/downloads/$bad")"
  [ "$CODE" = 404 ] && pass "404 $bad" || fail "$bad → $CODE"
done
[ "$(fa_count)" = "$N0" ] && pass "biçim dışı adlarda forward_auth çağrılmadı" || fail "biçim dışı ad server'a gitti"

echo "== P6 yolları (regresyon)"
for n in NoktaDestek Destek-12345678; do
  CODE="$(curl -s -o "$TMP/out" -w '%{http_code}' "$B/downloads/$n.exe")"
  [ "$CODE" = 200 ] && [ "$(cat "$TMP/out")" = "$WANT" ] && pass "$n.exe → 200" || fail "$n.exe → $CODE"
  [ "$(fa_last)" = '{"uri":"/downloads/***","method":"GET"}' ] && pass "$n.exe: server'a ad gitmez" || fail "$n uri: $(fa_last)"
done

echo "== WebSocket (/ws/request, /ws/panel)"
for w in request panel; do
  CODE="$(curl -s -o /dev/null -m 5 -w '%{http_code}' --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
    -H 'Sec-WebSocket-Version: 13' -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" \
    -H "Sec-WebSocket-Protocol: $SUBPROTO, rs.v1" "$B/ws/$w?x=1" || true)"
  [ "$CODE" = 101 ] && pass "/ws/$w → 101" || fail "/ws/$w → $CODE"
done
if [ "${CADDY_TEST_WS_HOLD:-0}" = 1 ]; then
  T0=$(date +%s)
  curl -s -o /dev/null -m 60 --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
    -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" "$B/ws/hold" || true
  DT=$(( $(date +%s) - T0 ))
  [ "$DT" -ge 39 ] && pass "WS $DT sn açık kaldı (read_body 30s / read_header 10s uygulanmadı)" || fail "WS $DT sn'de kapandı"
fi

echo "== ops uçları dışarıya kapalı"
for u in /internal/agent-ready /metrics /ready; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -H 'X-Forwarded-Method: GET' "$B$u")"
  [ "$CODE" = 404 ] && pass "$u → 404" || fail "$u → $CODE"
done

echo "== server erişilemez → 502, dosya sunulmaz (hata logu da maskeli olmalı)"
docker stop -t 1 "$P-server" >/dev/null
CODE="$(curl -s -o "$TMP/out" -w '%{http_code}' "$B/downloads/$FIRM.exe?utm=2")"
[ "$CODE" = 502 ] && ! grep -q MZ-sahte "$TMP/out" && pass "server yok → 502, dosya sunulmaz" || fail "server yok → $CODE"

echo "== log maskesi (G-10, G-E9-8, T31)"
sleep 1
docker logs "$P-caddy" 2>&1 | grep -q '"logger":"http.log.error' && pass "hata logu satırı üretildi (filtre sınanıyor)" || fail "hata logu satırı yok"
docker logs "$P-caddy" >"$TMP/caddy.log" 2>&1
grep -q '"uri":"/downloads/NoktaDestek-\*\*\*"' "$TMP/caddy.log" && pass "erişim logu /downloads/NoktaDestek-***" || fail "maskeli firma yolu logda yok"
grep -q '"uri":"/downloads/NoktaDestek.exe"' "$TMP/caddy.log" && pass "kodsuz ad maskelenmez (NoktaDestek.exe)" || fail "NoktaDestek.exe logda yok"
for s in "$REF" "$REF2" "TESTSIRRI" "utm=" "x=1" "12345678" "DemoFirma" "IkinciFirma2" "test-only-edge-secret"; do
  if grep -q -- "$s" "$TMP/caddy.log"; then fail "logda '$s' var"; else pass "logda '$s' yok"; fi
done

echo
[ "$FAILS" = 0 ] && echo "SONUÇ: GEÇTİ" || { echo "SONUÇ: $FAILS FAIL"; exit 1; }
