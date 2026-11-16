#!/usr/bin/env bash
# P28b K6 doğrulama kapısı 3 (mimari-p28b §7.1 r2, Y-P28b-1, AC-353 port taraması) + D-r2-1 / D-r2-4 denetimi.
# Çalışan bir yığında (prod `remote`, staging `remote-stg`) ClamAV ağ yalıtımını sınar. Sunucuda root ya da docker grubu.
# Konteynerler compose etiketlerinden bulunur (.env / compose dosyası gerekmez, sır okunmaz). Hiçbir şey değiştirmez.
#
# Kullanım: deploy/ops/check-av-isolation.sh [proje]        (vars. remote; staging: remote-stg)
#   STRICT_DR21=1  -> D-r2-1 (clamd -> server HTTP yanıtı) UYARI değil FAIL sayılır (K3 reddi yayına girdikten sonra).
#
# Her "bağlanamamalı" denetiminin yanında AYNI araçla bir "bağlanabilmeli" denetimi vardır: nc bayrağı desteklenmiyor ya da ad
# çözülemiyor diye olumsuz denetimler boşuna geçmesin. clamav-update -> clamav/server hem adla hem IP ile denenir.
# Çıkış: 0 = tüm denetimler PASS (UYARI'lar dahil değil), 1 = en az bir FAIL, 2 = kullanım/ön koşul hatası.
set -uo pipefail
PROJECT="${1:-remote}"
[[ "$PROJECT" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] || { echo "proje adı geçersiz: $PROJECT" >&2; exit 2; }
FAILS=0; WARNS=0
pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; FAILS=$((FAILS + 1)); }
warn() { echo "UYARI $*"; WARNS=$((WARNS + 1)); }

cname() {  # cname <servis> -> çalışan konteyner adı
  docker ps --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$1" \
    --filter status=running --format '{{.Names}}' | head -1
}
AV="$(cname clamav)"; UPD="$(cname clamav-update)"; SRV="$(cname server)"
[ -n "$AV" ] && [ -n "$UPD" ] || { echo "clamav / clamav-update çalışmıyor (proje $PROJECT; staging'de profil kapalı mı? runbook §28b.2)" >&2; exit 2; }
# nc -z: busybox (imajdaki clamdcheck.sh de nc kullanır). 0 = bağlantı kuruldu.
can() { docker exec "$1" nc -z -w 3 "$2" "$3" >/dev/null 2>&1; }
ips_of() { docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$1" 2>/dev/null; }

echo "== araç öz-sınaması (olumlu denetimler; bunlar geçmeden olumsuzlar anlamsızdır)"
can "$AV" 127.0.0.1 3310 && pass "clamav -> 127.0.0.1:3310 (nc -z çalışıyor)" || fail "clamav içinde nc -z 127.0.0.1:3310 kurulamadı (araç/clamd?)"
can "$UPD" database.clamav.net 443 && pass "clamav-update -> database.clamav.net:443 (çıkış var, ad çözümü çalışıyor)" \
  || fail "clamav-update internete çıkamıyor (imza güncellenemez; av_egress / güvenlik duvarı)"

echo "== clamd (clamav) dışarı çıkamaz"
for t in "1.1.1.1 443" "8.8.8.8 53" "database.clamav.net 443"; do
  # shellcheck disable=SC2086
  can "$AV" $t && fail "clamav -> $t bağlantı KURULDU (av internal değil mi?)" || pass "clamav -> $t kurulamadı"
done

echo "== freshclam (clamav-update) clamd'ye ve server'a ulaşamaz"
can "$UPD" clamav 3310 && fail "clamav-update -> clamav:3310 (ad) KURULDU" || pass "clamav-update -> clamav:3310 (ad) kurulamadı"
for ip in $(ips_of "$AV"); do
  can "$UPD" "$ip" 3310 && fail "clamav-update -> $ip:3310 (clamav IP) KURULDU" || pass "clamav-update -> $ip:3310 (clamav IP) kurulamadı"
done
can "$UPD" server 3001 && fail "clamav-update -> server:3001 (ad) KURULDU" || pass "clamav-update -> server:3001 (ad) kurulamadı"
if [ -n "$SRV" ]; then
  for ip in $(ips_of "$SRV"); do
    can "$UPD" "$ip" 3001 && fail "clamav-update -> $ip:3001 (server IP) KURULDU" || pass "clamav-update -> $ip:3001 (server IP) kurulamadı"
  done
else warn "server çalışmıyor: server IP denetimleri ve D-r2-1 atlandı"; fi

echo "== ağ üyeliği ve port yayımı"
AVNET="$(docker network ls -q --filter "label=com.docker.compose.project=$PROJECT" --filter label=com.docker.compose.network=av)"
if [ -z "$AVNET" ]; then fail "av ağı yok"
else
  [ "$(docker network inspect -f '{{.Internal}}' "$AVNET")" = true ] && pass "av internal" || fail "av internal DEĞİL"
  members="$(docker network inspect -f '{{range .Containers}}{{.Name}} {{end}}' "$AVNET")"
  extra=""
  for m in $members; do
    s="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$m" 2>/dev/null)"
    case "$s" in server|clamav) ;; *) extra="$extra $m($s)" ;; esac
  done
  [ -z "$extra" ] && pass "av üyeleri yalnız server + clamav" || fail "av ağında beklenmeyen konteyner:$extra"
fi
for c in "$AV" "$UPD"; do
  [ -z "$(docker port "$c" 2>/dev/null)" ] && pass "$c port yayımlamıyor" || fail "$c port yayımlıyor: $(docker port "$c" | tr '\n' ' ')"
done
if command -v ss >/dev/null 2>&1; then
  ss -Hltn 'sport = :3310' | grep -q . && fail "host 3310 dinliyor (AC-353)" || pass "host 3310 dinlemiyor (ss)"
else
  (exec 3<>/dev/tcp/127.0.0.1/3310) 2>/dev/null && fail "host 127.0.0.1:3310 açık (AC-353)" || pass "host 127.0.0.1:3310 kapalı"
fi
echo "   dış tarama (operatör makinesinden, AC-353): nc -z -w 3 <sunucu-genel-IP> 3310 -> başarısız olmalı"

echo "== sertleştirme (Y-P28b-1, D-r2-4: memswap = mem -> swap yok)"
for c in "$AV" "$UPD"; do
  read -r ro mem swap user caps <<<"$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}} {{.HostConfig.Memory}} {{.HostConfig.MemorySwap}} {{.Config.User}} {{.HostConfig.CapDrop}}' "$c")"
  [ "$ro" = true ] && [ "$user" = 100:101 ] && [[ "$caps" == *ALL* ]] && pass "$c read_only + 100:101 + cap_drop ALL" || fail "$c sertleştirme: ro=$ro user=$user capdrop=$caps"
  [ "$mem" -gt 0 ] && [ "$mem" = "$swap" ] && pass "$c Memory = MemorySwap = $mem (swap yok)" || fail "$c Memory=$mem MemorySwap=$swap (D-r2-4)"
done
docker exec "$AV" sh -c 'touch /var/lib/clamav/.w' >/dev/null 2>&1 && fail "clamav imza DB'sine YAZABİLİYOR" || pass "clamav imza DB'si salt okunur"

echo "== D-r2-1: clamd -> server:3001 HTTP (TCP kurulabilir; server av alt ağından gelen isteği reddetmeli — K3)"
if [ -n "$SRV" ]; then
  resp="$(docker exec "$AV" sh -c 'printf "GET /ready HTTP/1.0\r\nHost: server\r\n\r\n" | nc -w 3 server 3001 2>/dev/null | head -1')"
  case "$resp" in
    *" 200"*) if [ "${STRICT_DR21:-0}" = 1 ]; then fail "clamav -> server /ready 200 (D-r2-1 reddi yok)"
              else warn "clamav -> server /ready 200: D-r2-1 reddi henüz yok (K3). STRICT_DR21=1 ile FAIL sayılır"; fi ;;
    "") pass "clamav -> server:3001 yanıt yok / bağlantı kapandı" ;;
    *) pass "clamav -> server /ready: ${resp%$'\r'} (200 değil)" ;;
  esac
fi

echo
echo "SONUÇ: $([ "$FAILS" = 0 ] && echo GEÇTİ || echo "$FAILS FAIL") (uyarı $WARNS)"
[ "$FAILS" = 0 ]
