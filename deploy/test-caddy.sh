#!/usr/bin/env bash
# Caddyfile yönlendirme + log maskesi testi (P6/P8b; yerel ve CI). Gerçek .env, volume ve imajlar KULLANILMAZ.
# Geçici ağda sabitlenmiş Caddy imajı + sahte "server" (Node, bağımlılıksız: forward_auth iç ucu ve WS el sıkışması)
# başlatır, 4451 (düz HTTP, nginx arkası dinleyici) üzerinden istek atar, her durumda kaldırır.
# Doğrulananlar: firma dosyası NoktaDestek-<label>-<ref>.exe (AC-130, G-E9-11) aynı ikiliyi sunar (iki firma adı → aynı SHA-256) ve forward_auth'a
# adı sorgu dizesiz iletir; kapı 404/503 dönerse dosya sunulmaz; biçim dışı adlar server'a hiç gitmez; P6 yolları
# (NoktaDestek.exe, Destek-<8 hane>.exe) server'a maskeli gider; /ws/request ve /ws/panel yükseltilir; /internal/* 404;
# Caddy erişim/hata logunda ref, sorgu dizesi ve WS subprotocol (talep sırrı) yok (G-10, G-E9-8, T31); P19 web talep formu
# /r/<ref> iki log bloğunda da /r/*** (S-P19-10).
# P28f (S-P28f-3): macOS zip'i (NoktaDestek-macOS.zip, Destek-<8 hane>.zip) forward_auth /internal/agent-ready/macos'a, .exe
# yolları /internal/agent-ready/windows'a gider (çapraz: mac kapısı kapalıyken zip sunulmaz, exe sunulur); zip başlıkları; log maskesi.
# P28g (S-P28g-6/12): Linux ELF'i (NoktaDestek-linux, Destek-<8 hane>, uzantısız) /internal/agent-ready/linux'a gider; başlıklar
# (octet-stream, attachment uzantısız ad, nosniff, no-store, Last-Modified YOK); çapraz kapı senaryoları (Windows açık + Linux kapalı,
# macOS açık + Linux kapalı, Linux açık + diğerleri kapalı); biçim dışı adlar (Destek-12345678.sh, NoktaDestek-linux/) server'a gitmez.
# P13c: ROBOTS_NOINDEX yokken (prod) X-Robots-Tag / robots.txt Disallow yok; staging katmanı değerleriyle noindex + trusted_proxies.
# Kullanım: deploy/test-caddy.sh   ·   KEEP=1 (konteynerleri bırak)   ·   uzun WS bağlantısı (HTTP zaman aşımlarından etkilenmiyor mu, ~40 sn):
#           CADDY_TEST_WS_HOLD=1 deploy/test-caddy.sh
set -euo pipefail
cd "$(dirname "$0")"
CADDY_IMAGE="$(awk '/image: caddy:/ {print $2; exit}' docker-compose.yml)"
NODE_IMAGE="$(sed -n 's/^ARG NODE_IMAGE=//p' ../apps/server/Dockerfile)"
[ -n "$CADDY_IMAGE" ] && [ -n "$NODE_IMAGE" ] || { echo "imaj adı bulunamadı"; exit 2; }
P="remote-caddy-test-$$"   # benzersiz ad: paralel koşular / paylaşılan Docker çakışmaz
TMP="$(mktemp -d)"
cleanup() { docker rm -f "$P-caddy" "$P-caddy-stg" "$P-server" >/dev/null 2>&1 || true; docker network rm "$P" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
if [ "${KEEP:-0}" = 1 ]; then trap - EXIT; fi   # KEEP=1: konteynerler incelemek için kalır (sonra elle rm)
FAILS=0
pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; FAILS=$((FAILS + 1)); }

REF=abcdefghijklmn27            # [a-z2-7]{16}
REF2=zyxwvutsrqpo2345           # ikinci firma (AC-130: aynı ikili)
FIRM="NoktaDestek-DemoFirma-$REF"
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | awk '{print $1}'; }
WREF="webref$(openssl rand -hex 8)"   # P19 /r/<ref> (sahte; her koşuda rastgele)
SUBPROTO="rs.req.TESTSIRRI$(openssl rand -hex 16)"   # sahte talep sırrı (subprotocol), her koşuda rastgele
mkdir -p "$TMP/dl"
printf 'MZ-sahte-ikili-%s' "$(date +%s)" >"$TMP/dl/NoktaDestek.exe"
printf 'PK-sahte-zip-%s' "$(date +%s)" >"$TMP/dl/NoktaDestek-macOS.zip"
printf '\177ELF-sahte-linux-%s' "$(date +%s)" >"$TMP/dl/NoktaDestek-linux"
touch -t 202001010000 "$TMP/dl/NoktaDestek-linux"   # eski mtime: Last-Modified sızarsa açıkça görünür
chmod 0755 "$TMP" "$TMP/dl" && chmod 0644 "$TMP/dl/NoktaDestek.exe" "$TMP/dl/NoktaDestek-macOS.zip" "$TMP/dl/NoktaDestek-linux"
# P29 (mimari-p29 §9.1): agent_downloads/update/ altındaki imzalı manifestler public SUNULMAZ (server okur, Caddy 404).
mkdir -p "$TMP/dl/update"
for m in update-client-windows-amd64.json update-client-windows-amd64.json.sig update-service-windows-amd64.json; do
  printf 'MANIFEST-sahte-%s' "$m" >"$TMP/dl/update/$m"; chmod 0644 "$TMP/dl/update/$m"
done
chmod 0755 "$TMP/dl/update"
cat >"$TMP/mock.js" <<'JS'
// Sahte server:3001 — yalnız Caddy'nin ilettiklerini kaydeder (gerçek doğrulama server'ın işi). WS yanıtında
// en kötü durumu sınar: gerçek server yalnız rs.v1 seçer, burada sırlı ilk öğe geri yazılır → log filtresi silmeli.
const http = require("node:http"), crypto = require("node:crypto"), fs = require("node:fs");
const s = http.createServer((req, res) => {
  if (req.url.startsWith("/api/v1/fsrv/files/")) {   // P28b indirme: dosya adı yalnız Content-Disposition'da
    res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": "attachment; filename=\"gizli-ad-fsrv.pdf\"" });
    return res.end("icerik");
  }
  if (req.url.startsWith("/api/")) {   // P12: gövdeyi sonuna kadar oku, kaç bayt geldiğini döndür
    let n = 0;
    req.on("data", (c) => { n += c.length; });
    req.on("end", () => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ n })); });
    req.on("error", () => {});
    return;
  }
  if (req.url.startsWith("/internal/agent-ready")) {
    const uri = req.headers["x-forwarded-uri"] ?? "";
    const path = req.url.split("?")[0];
    fs.appendFileSync("/tmp/fa.log", JSON.stringify({ uri, method: req.headers["x-forwarded-method"] ?? "" }) + "\n");
    fs.appendFileSync("/tmp/fa-path.log", path + "\n");
    // P28f: platform kapısı kapalı senaryosu (/tmp/<platform>-closed varsa 503).
    if (path === "/internal/agent-ready/macos" && fs.existsSync("/tmp/macos-closed")) { res.writeHead(503, { "content-type": "application/json" }); return res.end('{"error":{"code":"NOT_READY"}}'); }
    if (path === "/internal/agent-ready/windows" && fs.existsSync("/tmp/windows-closed")) { res.writeHead(503, { "content-type": "application/json" }); return res.end('{"error":{"code":"NOT_READY"}}'); }
    // P28g: /tmp/linux-closed = LINUX_AGENT_SHA256 uyuşmaz / dosya yok (server 503 NOT_READY).
    if (path === "/internal/agent-ready/linux" && fs.existsSync("/tmp/linux-closed")) { res.writeHead(503, { "content-type": "application/json" }); return res.end('{"error":{"code":"NOT_READY"}}'); }
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
fa_path() { docker exec "$P-server" sh -c 'tail -1 /tmp/fa-path.log'; }

echo "== firma dosyası (P8b)"
H="$(curl -s -D - -o "$TMP/out" "$B/downloads/$FIRM.exe?utm=1")"
CODE="$(printf '%s' "$H" | head -1 | awk '{print $2}')"
[ "$CODE" = 200 ] && [ "$(cat "$TMP/out")" = "$WANT" ] && pass "firma adı → 200, aynı ikili" || fail "firma adı: $CODE"
printf '%s' "$H" | grep -qi "^content-disposition: attachment; filename=\"$FIRM.exe\"" && pass "Content-Disposition firma adı" || fail "Content-Disposition"
printf '%s' "$H" | grep -qi '^cache-control: no-store' && pass "Cache-Control no-store" || fail "Cache-Control"
[ "$(fa_last)" = "{\"uri\":\"/downloads/$FIRM.exe\",\"method\":\"GET\"}" ] && pass "forward_auth X-Forwarded-Uri = yol (sorgu dizesi yok)" || fail "forward_auth uri: $(fa_last)"
[ "$(fa_path)" = /internal/agent-ready/windows ] && pass "firma dosyası → /internal/agent-ready/windows" || fail "firma kapı yolu: $(fa_path)"
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
  "NoktaDestek--$REF.exe" "x/$FIRM.exe" "$FIRM.exe.zip" "nokta$FIRM.exe" "Destek-1234567.exe" \
  "Destek-1234567.zip" "Destek-123456789.zip" "$FIRM.zip" "NoktaDestek.zip" "NoktaDestek-macos.zip" "NoktaDestek-macOS.exe" \
  "Destek-12345678.ZIP" "x/NoktaDestek-macOS.zip" \
  "Destek-12345678.sh" "NoktaDestek-linux/" "Destek-12345678/" "NoktaDestek-Linux" "NoktaDestek-linux.exe" "NoktaDestek-linux.zip" \
  "NoktaDestek-linux-x86_64-0.20.0" "Destek-1234567" "Destek-123456789" "destek-98765432" "x/NoktaDestek-linux" \
  "Destek-12345678(1)" "NoktaDestek-linuxx"; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "$B/downloads/$bad")"
  [ "$CODE" = 404 ] && pass "404 $bad" || fail "$bad → $CODE"
done
[ "$(fa_count)" = "$N0" ] && pass "biçim dışı adlarda forward_auth çağrılmadı" || fail "biçim dışı ad server'a gitti"

echo "== P29 update/ alt yolu public sunulmaz (404, gövdede manifest yok)"
N0="$(fa_count)"
for u in update/ update/update-client-windows-amd64.json update/update-client-windows-amd64.json.sig \
  update/update-service-windows-amd64.json update/../update/update-service-windows-amd64.json; do
  CODE="$(curl -s --path-as-is -o "$TMP/out" -w '%{http_code}' "$B/downloads/$u")"
  [ "$CODE" = 404 ] && ! grep -q MANIFEST-sahte "$TMP/out" && pass "404 /downloads/$u" || fail "/downloads/$u → $CODE"
done
[ "$(fa_count)" = "$N0" ] && pass "update/ yolları server'a gitmez" || fail "update/ yolu forward_auth'a gitti"

echo "== P6 yolları (regresyon)"
for n in NoktaDestek Destek-12345678; do
  CODE="$(curl -s -o "$TMP/out" -w '%{http_code}' "$B/downloads/$n.exe")"
  [ "$CODE" = 200 ] && [ "$(cat "$TMP/out")" = "$WANT" ] && pass "$n.exe → 200" || fail "$n.exe → $CODE"
  [ "$(fa_last)" = '{"uri":"/downloads/***","method":"GET"}' ] && pass "$n.exe: server'a ad gitmez" || fail "$n uri: $(fa_last)"
  [ "$(fa_path)" = /internal/agent-ready/windows ] && pass "$n.exe → /internal/agent-ready/windows" || fail "$n.exe kapı yolu: $(fa_path)"
done

echo "== P28f macOS zip (S-P28f-3)"
WANTZ="$(cat "$TMP/dl/NoktaDestek-macOS.zip")"
for n in NoktaDestek-macOS Destek-12345678; do
  H="$(curl -s -D - -o "$TMP/out" "$B/downloads/$n.zip?x=1")"
  CODE="$(printf '%s' "$H" | head -1 | awk '{print $2}')"
  [ "$CODE" = 200 ] && [ "$(cat "$TMP/out")" = "$WANTZ" ] && pass "$n.zip → 200, aynı zip" || fail "$n.zip → $CODE"
  HL="$(printf '%s' "$H" | tr -d '\r')"
  printf '%s' "$HL" | grep -qi "^content-disposition: attachment; filename=\"$n.zip\"$" && pass "$n.zip Content-Disposition" || fail "$n.zip Content-Disposition"
  printf '%s' "$HL" | grep -qi '^content-type: application/zip$' && pass "$n.zip Content-Type application/zip" || fail "$n.zip Content-Type"
  printf '%s' "$HL" | grep -qi '^cache-control: no-store$' && pass "$n.zip no-store" || fail "$n.zip Cache-Control"
  printf '%s' "$HL" | grep -qi '^x-content-type-options: nosniff$' && pass "$n.zip nosniff" || fail "$n.zip nosniff"
  [ "$(fa_last)" = '{"uri":"/downloads/***","method":"GET"}' ] && pass "$n.zip: server'a ad gitmez" || fail "$n.zip uri: $(fa_last)"
  [ "$(fa_path)" = /internal/agent-ready/macos ] && pass "$n.zip → /internal/agent-ready/macos" || fail "$n.zip kapı yolu: $(fa_path)"
done
docker exec "$P-server" touch /tmp/macos-closed
CODE="$(curl -s -o "$TMP/out" -w '%{http_code}' "$B/downloads/Destek-12345678.zip")"
[ "$CODE" = 503 ] && ! grep -q PK-sahte "$TMP/out" && pass "mac kapısı 503 → zip sunulmaz" || fail "mac kapısı kapalı: $CODE"
CODE="$(curl -s -o "$TMP/out" -w '%{http_code}' "$B/downloads/Destek-12345678.exe")"
[ "$CODE" = 200 ] && [ "$(cat "$TMP/out")" = "$WANT" ] && pass "mac kapısı kapalıyken exe sunulur (çapraz)" || fail "mac kapalı exe: $CODE"
docker exec "$P-server" sh -c 'rm -f /tmp/macos-closed && touch /tmp/windows-closed'
CODE="$(curl -s -o "$TMP/out" -w '%{http_code}' "$B/downloads/Destek-12345678.exe")"
[ "$CODE" = 503 ] && ! grep -q MZ-sahte "$TMP/out" && pass "windows kapısı 503 → exe sunulmaz" || fail "windows kapısı kapalı: $CODE"
CODE="$(curl -s -o "$TMP/out" -w '%{http_code}' "$B/downloads/$FIRM.exe")"
[ "$CODE" = 503 ] && ! grep -q MZ-sahte "$TMP/out" && pass "windows kapısı 503 → firma exe sunulmaz" || fail "windows kapalı firma: $CODE"
CODE="$(curl -s -o "$TMP/out" -w '%{http_code}' "$B/downloads/NoktaDestek-macOS.zip")"
[ "$CODE" = 200 ] && [ "$(cat "$TMP/out")" = "$WANTZ" ] && pass "windows kapısı kapalıyken zip sunulur (çapraz)" || fail "windows kapalı zip: $CODE"
docker exec "$P-server" rm -f /tmp/windows-closed

echo "== P28g Linux ELF (S-P28g-6/12): uzantısız, octet-stream, Last-Modified yok"
WANTL="$(cat "$TMP/dl/NoktaDestek-linux")"
for n in NoktaDestek-linux Destek-12345678; do
  H="$(curl -s -D - -o "$TMP/out" "$B/downloads/$n?x=1")"
  CODE="$(printf '%s' "$H" | head -1 | awk '{print $2}')"
  [ "$CODE" = 200 ] && [ "$(cat "$TMP/out")" = "$WANTL" ] && pass "$n → 200, aynı ELF" || fail "$n → $CODE"
  HL="$(printf '%s' "$H" | tr -d '\r')"
  printf '%s' "$HL" | grep -qi "^content-disposition: attachment; filename=\"$n\"$" && pass "$n Content-Disposition uzantısız" || fail "$n Content-Disposition: $(printf '%s' "$HL" | grep -i '^content-disposition')"
  printf '%s' "$HL" | grep -qi '^content-type: application/octet-stream$' && pass "$n Content-Type application/octet-stream" || fail "$n Content-Type"
  printf '%s' "$HL" | grep -qi '^cache-control: no-store$' && pass "$n no-store" || fail "$n Cache-Control"
  printf '%s' "$HL" | grep -qi '^x-content-type-options: nosniff$' && pass "$n nosniff" || fail "$n nosniff"
  printf '%s' "$HL" | grep -qi '^last-modified:' && fail "$n Last-Modified gönderildi (S-P28g-6)" || pass "$n Last-Modified yok"
  [ "$(fa_last)" = '{"uri":"/downloads/***","method":"GET"}' ] && pass "$n: server'a ad gitmez" || fail "$n uri: $(fa_last)"
  [ "$(fa_path)" = /internal/agent-ready/linux ] && pass "$n → /internal/agent-ready/linux" || fail "$n kapı yolu: $(fa_path)"
done
# HEAD de aynı kapıdan geçer ve Last-Modified taşımaz.
HL="$(curl -s -I "$B/downloads/Destek-12345678" | tr -d '\r')"
printf '%s' "$HL" | head -1 | grep -q ' 200' && ! printf '%s' "$HL" | grep -qi '^last-modified:' && pass "HEAD Destek-12345678 → 200, Last-Modified yok" || fail "HEAD: $(printf '%s' "$HL" | head -1)"
echo "== P28g çapraz kapılar (S-P28g-12 m.3)"
docker exec "$P-server" touch /tmp/linux-closed   # Linux uyuşmaz; Windows ve macOS açık
CODE="$(curl -s -o "$TMP/out" -w '%{http_code}' "$B/downloads/Destek-12345678")"
[ "$CODE" = 503 ] && ! grep -q 'ELF-sahte' "$TMP/out" && pass "Windows ok + Linux uyuşmaz → Destek-<kod> 503, ELF sunulmaz" || fail "Linux kapalı Destek-<kod>: $CODE"
CODE="$(curl -s -o "$TMP/out" -w '%{http_code}' "$B/downloads/NoktaDestek-linux")"
[ "$CODE" = 503 ] && ! grep -q 'ELF-sahte' "$TMP/out" && pass "Linux uyuşmaz → NoktaDestek-linux 503" || fail "Linux kapalı NoktaDestek-linux: $CODE"
CODE="$(curl -s -o "$TMP/out" -w '%{http_code}' "$B/downloads/Destek-12345678.exe")"
[ "$CODE" = 200 ] && [ "$(cat "$TMP/out")" = "$WANT" ] && pass "Windows ok + Linux uyuşmaz → Destek-<kod>.exe 200" || fail "Linux kapalı exe: $CODE"
CODE="$(curl -s -o "$TMP/out" -w '%{http_code}' "$B/downloads/Destek-12345678.zip")"
[ "$CODE" = 200 ] && [ "$(cat "$TMP/out")" = "$WANTZ" ] && pass "macOS ok + Linux yok → .zip 200" || fail "Linux kapalı zip: $CODE"
docker exec "$P-server" sh -c 'rm -f /tmp/linux-closed && touch /tmp/windows-closed /tmp/macos-closed'
CODE="$(curl -s -o "$TMP/out" -w '%{http_code}' "$B/downloads/Destek-12345678")"
[ "$CODE" = 200 ] && [ "$(cat "$TMP/out")" = "$WANTL" ] && pass "Linux ok + Windows/macOS kapalı → Destek-<kod> 200" || fail "diğerleri kapalı Linux: $CODE"
for n in Destek-12345678.exe Destek-12345678.zip; do
  CODE="$(curl -s -o "$TMP/out" -w '%{http_code}' "$B/downloads/$n")"
  [ "$CODE" = 503 ] && ! grep -q 'ELF-sahte' "$TMP/out" && pass "Linux ok + kapı kapalı → $n 503 (ELF'e düşmez)" || fail "$n: $CODE"
done
docker exec "$P-server" rm -f /tmp/windows-closed /tmp/macos-closed

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

echo "== gövde sınırı (P12: yükleme uçları 3 MiB, diğer /api 2MB)"
head -c 2097152 /dev/urandom >"$TMP/img2m"                     # tam 2 MiB "dosya" (sınırın kendisi)
head -c 3200000 /dev/urandom >"$TMP/img3m"                     # 3 MiB tavanı aşar
up() { curl -s -o "$TMP/out" -w '%{http_code}' -X POST -F "file=@$1;type=image/png" "$B$2"; }
# Üç yükleme ucu (Caddyfile @upload); avatar ucu `me` ve <id> biçimiyle iki kez denenir.
for u in /api/v1/users/me/avatar /api/v1/users/01HXYZ/avatar /api/v1/settings/logo /api/v1/admin/settings/system-logo; do
  CODE="$(up "$TMP/img2m" "$u")"
  [ "$CODE" = 200 ] && grep -q '"n":' "$TMP/out" && pass "2 MiB multipart → $u geçer" || fail "2 MiB $u → $CODE"
  CODE="$(up "$TMP/img3m" "$u")"
  [ "$CODE" = 413 ] && pass "3,2 MB → $u 413" || fail "3,2 MB $u → $CODE"
done
for u in /api/v1/auth/login /api/v1/users/me/avatar/x /api/v1/settings/logox; do
  CODE="$(up "$TMP/img2m" "$u")"
  [ "$CODE" = 413 ] && pass "2 MiB → $u 413 (2MB sınırı korunur)" || fail "2 MiB $u → $CODE"
done
CODE="$(curl -s -o /dev/null -w '%{http_code}' -X PUT --data-binary "@$TMP/img2m" "$B/api/v1/settings/logo")"
[ "$CODE" = 413 ] && pass "PUT /api/v1/settings/logo 2 MiB → 413 (yalnız POST genişler)" || fail "PUT logo → $CODE"
CODE="$(curl -s -o /dev/null -w '%{http_code}' "$B/api/v1/files/avatar/T1/abcdefghijklmnop.webp?v=gizlisorgu")"
[ "$CODE" = 200 ] && pass "/api/v1/files/* server'a gider" || fail "/api/v1/files → $CODE"

echo "== P28b fsrv: parça PUT 1 MiB + 1 sınırı, Bearer ve dosya adı loga yazılmaz"
head -c 1048576 /dev/urandom >"$TMP/chunk1m"; head -c 1048578 /dev/urandom >"$TMP/chunk1m2"
FTOK="fsrvbelirtec$(openssl rand -hex 8)"
putc() { curl -s -o "$TMP/out" -w '%{http_code}' -X PUT -H 'Content-Type: application/octet-stream' -H "Authorization: Bearer $FTOK" \
  --data-binary "@$1" "$B/api/v1/fsrv/uploads/01HFSRVTESTFID000000000000/chunks/$2"; }
CODE="$(putc "$TMP/chunk1m" 0)"; [ "$CODE" = 200 ] && grep -q '"n":1048576' "$TMP/out" && pass "fsrv 1 MiB parça → server'a tam gider" || fail "fsrv 1 MiB → $CODE $(cat "$TMP/out")"
CODE="$(putc "$TMP/chunk1m2" 1)"; [ "$CODE" = 413 ] && pass "fsrv 1 MiB + 2 → 413" || fail "fsrv 1 MiB + 2 → $CODE"
CODE="$(curl -s -o /dev/null -w '%{http_code}' -X PUT --data-binary "@$TMP/chunk1m2" "$B/api/v1/settings/other")"
[ "$CODE" = 200 ] && pass "fsrv dışı PUT 1 MiB + 2 (2MB sınırı) etkilenmez" || fail "fsrv dışı PUT → $CODE"
H="$(curl -s -D - -o /dev/null -H "Authorization: Bearer $FTOK" "$B/api/v1/fsrv/files/01HFSRVTESTFID000000000000/content")"
printf '%s' "$H" | grep -qi 'gizli-ad-fsrv' && pass "fsrv indirme Content-Disposition istemciye gider" || fail "fsrv indirme başlığı yok"

echo "== P28e kayıt parçası: PUT 2 MiB (REC_PART_MAX_BYTES) geçer, +1 413; Bearer loga yazılmaz"
head -c 2097152 /dev/urandom >"$TMP/rec2m"; head -c 2097153 /dev/urandom >"$TMP/rec2m1"
RTOK="recbelirtec$(openssl rand -hex 8)"
putr() { curl -s -o "$TMP/out" -w '%{http_code}' -X PUT -H 'Content-Type: video/webm' -H "Authorization: Bearer $RTOK" \
  --data-binary "@$1" "$B/api/v1/rec/01HRECTESTRID0000000000000/series/$2/parts/$3"; }
CODE="$(putr "$TMP/rec2m" 0 0)"; [ "$CODE" = 200 ] && grep -q '"n":2097152' "$TMP/out" && pass "rec 2 MiB parça → server'a tam gider" || fail "rec 2 MiB → $CODE $(cat "$TMP/out")"
CODE="$(putr "$TMP/rec2m1" 0 1)"; [ "$CODE" = 413 ] && pass "rec 2 MiB + 1 → 413" || fail "rec 2 MiB + 1 → $CODE"
CODE="$(curl -s -o /dev/null -w '%{http_code}' -X PUT --data-binary "@$TMP/rec2m" "$B/api/v1/rec/01HRECTESTRID0000000000000/series/0")"
[ "$CODE" = 413 ] && pass "rec parça yolu dışı PUT 2 MiB → 413 (2MB sınırı korunur)" || fail "rec dışı PUT → $CODE"
CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST --data-binary "@$TMP/rec2m" "$B/api/v1/rec/01HRECTESTRID0000000000000/series/0/parts/2")"
[ "$CODE" = 413 ] && pass "rec parça yoluna POST 2 MiB → 413 (yalnız PUT genişler)" || fail "rec POST → $CODE"

echo "== güvenlik başlıkları (mimari-p13 §7.5, AC-126; uygulama koymadığında Caddy tamamlar)"
H="$(curl -s -D - -o /dev/null "$B/downloads/x")"
HSTS="$(printf '%s' "$H" | tr -d '\r' | sed -n 's/^[Ss]trict-[Tt]ransport-[Ss]ecurity: //p')"
[ "$HSTS" = "max-age=31536000; includeSubDomains" ] && pass "HSTS = '$HSTS'" || fail "HSTS = '$HSTS'"
case "$HSTS" in *preload*) fail "HSTS preload içeriyor" ;; *) pass "HSTS preload yok" ;; esac
printf '%s' "$H" | grep -qi '^server:' && fail "Server başlığı var" || pass "Server başlığı yok"
printf '%s' "$H" | tr -d '\r' | grep -qi '^x-content-type-options: nosniff$' && pass "X-Content-Type-Options nosniff" || fail "nosniff yok"

echo "== ops uçları dışarıya kapalı"
for u in /internal/agent-ready /internal/agent-ready/windows /internal/agent-ready/macos /internal/agent-ready/linux /metrics /ready; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -H 'X-Forwarded-Method: GET' "$B$u")"
  [ "$CODE" = 404 ] && pass "$u → 404" || fail "$u → $CODE"
done

echo "== P13c arama motoru kuralı: prod (ROBOTS_NOINDEX yok) etkilenmez, staging katmanında noindex"
H="$(curl -s -D - -o "$TMP/out" "$B/robots.txt")"
printf '%s' "$H" | grep -qi '^x-robots-tag:' && fail "prod: X-Robots-Tag var" || pass "prod: X-Robots-Tag yok"
grep -q 'Disallow' "$TMP/out" && fail "prod: /robots.txt Disallow döndü" || pass "prod: /robots.txt Caddy'de yanıtlanmaz (web'e gider)"
docker run -d --name "$P-caddy-stg" --network "$P" -p 127.0.0.1::4451 \
  -e SITE_HOST=localhost -e EDGE_PROXY_SECRET=test-only-edge-secret-0123456789abcdef \
  -e ROBOTS_NOINDEX=1 -e CADDY_TRUSTED_PROXIES=172.30.1.128/32 \
  -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$TMP/dl:/srv/downloads:ro" "$CADDY_IMAGE" >/dev/null
SB="http://127.0.0.1:$(docker port "$P-caddy-stg" 4451/tcp | head -1 | sed 's/.*://')"
for _ in $(seq 1 50); do curl -s -o /dev/null "$SB/downloads/x" && break; sleep 0.2; done
H="$(curl -s -D - -o "$TMP/out" "$SB/robots.txt")"
printf '%s' "$H" | tr -d '\r' | grep -qi '^x-robots-tag: noindex, nofollow$' && pass "staging: /robots.txt X-Robots-Tag noindex, nofollow" || fail "staging robots başlık"
[ "$(printf '%s' "$H" | head -1 | awk '{print $2}')" = 200 ] && grep -qx 'Disallow: /' "$TMP/out" && grep -qx 'User-agent: \*' "$TMP/out" \
  && pass "staging: /robots.txt 200 'Disallow: /'" || fail "staging robots gövde: $(cat "$TMP/out")"
H="$(curl -s -D - -o /dev/null "$SB/api/v1/files/avatar/T1/abcdefghijklmnop.webp")"
printf '%s' "$H" | tr -d '\r' | grep -qi '^x-robots-tag: noindex, nofollow$' && pass "staging: proxy yanıtında (/api) X-Robots-Tag" || fail "staging /api başlık"
docker exec "$P-caddy-stg" caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile 2>/dev/null | grep -q '"172.30.1.128/32"' \
  && pass "staging: 4451 trusted_proxies = CADDY_TRUSTED_PROXIES" || fail "staging trusted_proxies"
docker rm -f "$P-caddy-stg" >/dev/null

echo "== P19 web talep formu /r/<ref> (web:3000 testte yok → 502: erişim + hata logu birlikte sınanır)"
for u in "/r/$WREF" "/r/$WREF/" "/r/$WREF?x=1" "/r/$WREF/bekle"; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "$B$u")"
  [ "$CODE" = 502 ] && pass "$u → web'e yönlendi (502, test web'i yok)" || fail "$u → $CODE"
done

echo "== server erişilemez → 502, dosya sunulmaz (hata logu da maskeli olmalı)"
docker stop -t 1 "$P-server" >/dev/null
CODE="$(curl -s -o "$TMP/out" -w '%{http_code}' "$B/downloads/$FIRM.exe?utm=2")"
[ "$CODE" = 502 ] && ! grep -q MZ-sahte "$TMP/out" && pass "server yok → 502, dosya sunulmaz" || fail "server yok → $CODE"

echo "== log maskesi (G-10, G-E9-8, T31)"
sleep 1
# Önce dosyaya al: `docker logs | grep -q` pipefail altında grep erken çıkınca SIGPIPE ile yanlış FAIL verir.
docker logs "$P-caddy" >"$TMP/caddy.log" 2>&1
grep -q '"logger":"http.log.error' "$TMP/caddy.log" && pass "hata logu satırı üretildi (filtre sınanıyor)" || fail "hata logu satırı yok"
grep -q '"uri":"/downloads/NoktaDestek-\*\*\*"' "$TMP/caddy.log" && pass "erişim logu /downloads/NoktaDestek-***" || fail "maskeli firma yolu logda yok"
grep -q '"uri":"/downloads/NoktaDestek.exe"' "$TMP/caddy.log" && pass "kodsuz ad maskelenmez (NoktaDestek.exe)" || fail "NoktaDestek.exe logda yok"
grep -q '"uri":"/downloads/Destek-\*\*\*"' "$TMP/caddy.log" && pass "P28f: Destek-<kod>.zip/.exe erişim logunda /downloads/Destek-***" || fail "maskeli Destek yolu logda yok"
grep -q '"uri":"/api/v1/files/avatar/T1/abcdefghijklmnop.webp"' "$TMP/caddy.log" && pass "erişim logu /api/v1/files yolu sorgu dizesiz" || fail "/api/v1/files log satırı"
grep '"logger":"http.log.access' "$TMP/caddy.log" | grep -q '"uri":"/r/\*\*\*/bekle"' && pass "P19 erişim logu /r/***/bekle" || fail "P19 erişim logu /r/*** yok"
grep '"logger":"http.log.error' "$TMP/caddy.log" | grep -q '"uri":"/r/\*\*\*"' && pass "P19 hata logu (varsayılan logger) /r/***" || fail "P19 hata logu /r/*** yok"
for s in "$WREF" "webref" "$REF" "$REF2" "TESTSIRRI" "utm=" "x=1" "gizlisorgu" "12345678" "DemoFirma" "IkinciFirma2" "test-only-edge-secret" "$FTOK" "gizli-ad-fsrv" "$RTOK"; do
  if grep -q -- "$s" "$TMP/caddy.log"; then fail "logda '$s' var"; else pass "logda '$s' yok"; fi
done

echo
[ "$FAILS" = 0 ] && echo "SONUÇ: GEÇTİ" || { echo "SONUÇ: $FAILS FAIL"; exit 1; }
