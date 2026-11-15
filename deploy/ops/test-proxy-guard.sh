#!/usr/bin/env bash
# proxy-guard.sh yerel testi (G-P13b-3). Sunucuya bağlanmaz; dind YOK. Linux konteyneri (alpine, kendi ağ ad alanı,
# NET_ADMIN; benzersiz ad, iş bitince silinir) içinde gerçek nftables ile:
#   - korumasız durumda izinsiz kullanıcı 127.0.0.1:4451'e bağlanabiliyor (açığın kanıtı);
#   - apply sonrası: root ve www-data bağlanır; nobody / başka kullanıcı RST alır; aynı kural 172.30.0.2:4451 (edge ağı,
#     doğrudan) ve DNAT ile 127.0.0.1:4451 -> 172.30.0.2:4451 (Docker userland-proxy kapalı yolu: output + skuid NAT'tan
#     sonra) için de geçerli; kapsam dışı (4450, başka adres) etkilenmez; ::1;
#   - idempotent apply, check/ensure onarımı, hatalı kullanıcı adında mevcut tablo korunur, verify, UYARI, install/uninstall;
#   - P13c çok port (4451,4461 + 172.30.1.0/24 staging edge); tek port kural metni değişmedi.
# Kullanım: deploy/ops/test-proxy-guard.sh   Çıkış 0 = tüm beklentiler tuttu.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
C="rs-pguard-test-$$-$RANDOM"
TMP="$(mktemp -d)"
cleanup() { docker rm -f "$C" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

cat >"$TMP/inner.sh" <<'EOF'
#!/bin/bash
set -u
apk add --no-cache nftables socat util-linux procps iproute2 >/dev/null 2>&1 || { echo "FAIL  apk"; echo "SONUÇ-İÇ 1"; exit 1; }
F=0; ok() { echo "PASS  $*"; }; no() { echo "FAIL  $*"; F=$((F + 1)); }
G=/w/proxy-guard.sh
id -u www-data >/dev/null 2>&1 || adduser -D -H -G www-data www-data || adduser -D -H www-data
adduser -D -H -u 4242 intruder
ip link add rsedge type dummy 2>/dev/null && ip link set rsedge up && ip addr add 172.30.0.2/24 dev rsedge || ip addr add 172.30.0.2/32 dev lo
ip addr add 10.77.0.1/32 dev lo
lis() { socat "TCP-LISTEN:$2,bind=$1,fork,reuseaddr" SYSTEM:'echo hi' >/dev/null 2>&1 & echo $! >>/tmp/lis; }
lis 127.0.0.1 4451; lis 172.30.0.2 4451; lis 127.0.0.1 4450; lis 10.77.0.1 4451
HAS6=0; if socat "TCP6-LISTEN:4451,bind=[::1],fork,reuseaddr" SYSTEM:'echo hi' >/dev/null 2>&1 & sleep 0.3; kill -0 $! 2>/dev/null; then HAS6=1; fi
sleep 0.5
conn() {  # <kullanıcı> <adres> <port> -> 0 bağlandı (yanıt "hi")
  local h="$2"; case "$h" in *:*) h="[$h]" ;; esac
  [ "$(setpriv --reuid="$(id -u "$1")" --regid="$(id -g "$1")" --clear-groups socat -T2 - "TCP:$h:$3" </dev/null 2>/dev/null)" = hi ]
}
exp() {  # <beklenen ok|ret> <açıklama> <kullanıcı> <adres> <port>
  if conn "$3" "$4" "$5"; then r=ok; else r=ret; fi
  if [ "$r" = "$1" ]; then ok "$2"; else no "$2 (beklenen $1, bulunan $r)"; fi
}
exp ok "korumasız: nobody 127.0.0.1:4451'e bağlanabiliyor (açık kanıtı)" nobody 127.0.0.1 4451

WU="$(id -u www-data)"
setpriv --reuid=65534 --regid=65534 --clear-groups bash $G print >/tmp/p 2>&1 && grep -q "meta skuid != { 0,$WU }" /tmp/p \
  && ok "print root'suz çalışır, uid {0,$WU}" || no "print: $(cat /tmp/p)"
bash $G apply >/tmp/o 2>&1 && ok "apply -> 0" || no "apply: $(cat /tmp/o)"
exp ok  "root -> 127.0.0.1:4451 bağlanır (docker-proxy, remote-watch)" root 127.0.0.1 4451
exp ok  "www-data -> 127.0.0.1:4451 bağlanır (nginx)" www-data 127.0.0.1 4451
exp ret "nobody -> 127.0.0.1:4451 REDDEDİLDİ" nobody 127.0.0.1 4451
exp ret "intruder (uid 4242) -> 127.0.0.1:4451 REDDEDİLDİ" intruder 127.0.0.1 4451
exp ret "nobody -> 172.30.0.2:4451 (edge ağına doğrudan) REDDEDİLDİ" nobody 172.30.0.2 4451
exp ok  "root -> 172.30.0.2:4451 bağlanır" root 172.30.0.2 4451
exp ok  "kapsam dışı: nobody -> 127.0.0.1:4450 etkilenmez" nobody 127.0.0.1 4450
exp ok  "kapsam dışı: nobody -> 10.77.0.1:4451 (başka hedef) etkilenmez" nobody 10.77.0.1 4451
if [ "$HAS6" = 1 ]; then exp ret "nobody -> [::1]:4451 REDDEDİLDİ" nobody ::1 4451; exp ok "www-data -> [::1]:4451 bağlanır" www-data ::1 4451
else echo "INFO  konteynerde ::1 yok; IPv6 kuralı yalnız check ile doğrulandı"; fi
nft list chain inet remote_proxy_guard output | grep -q 'counter packets [1-9]' && ok "reddedilen bağlantılar sayaçta görünür" || no "sayaç"

# Docker userland-proxy kapalı yolu: 127.0.0.1:4451 nat/output'ta 172.30.0.2:4451'e DNAT edilir; filtre NAT'tan sonra.
kill "$(sed -n 1p /tmp/lis)" 2>/dev/null; sleep 0.3
sysctl -qw net.ipv4.conf.all.route_localnet=1 2>/dev/null || true
nft -f - <<'N'
table ip rstest_nat {
  chain out { type nat hook output priority dstnat; policy accept; ip daddr 127.0.0.1 tcp dport 4451 dnat to 172.30.0.2:4451; }
}
N
exp ok  "DNAT yolu: root 127.0.0.1:4451 -> 172.30.0.2:4451 bağlanır" root 127.0.0.1 4451
exp ret "DNAT yolu: nobody REDDEDİLDİ (output + skuid NAT'tan sonra da tutar)" nobody 127.0.0.1 4451
exp ok  "DNAT yolu: www-data bağlanır" www-data 127.0.0.1 4451
nft delete table ip rstest_nat; lis 127.0.0.1 4451; sleep 0.3

bash $G check >/tmp/o 2>&1 && ok "check -> 0" || no "check: $(cat /tmp/o)"
bash $G apply >/dev/null 2>&1; [ "$(nft list table inet remote_proxy_guard | grep -c 'comment "rpg:')" = 2 ] && ok "apply iki kez -> yine 2 kural (idempotent)" || no "idempotent"
PROXY_GUARD_USERS="root www-dataa" bash $G apply >/tmp/o 2>&1; rc=$?
[ "$rc" = 1 ] && grep -q 'kullanıcı yok: www-dataa' /tmp/o && bash $G check >/dev/null 2>&1 && ok "hatalı kullanıcı adı -> rc 1, mevcut tablo korundu" || no "hatalı ad: rc=$rc $(cat /tmp/o)"
nft flush chain inet remote_proxy_guard output
bash $G check >/dev/null 2>&1 && no "boşaltılmış zincir check'ten geçti" || ok "zincir boşaltılınca check -> 1"
nft delete table inet remote_proxy_guard
exp ok "tablo silinince nobody yine bağlanır (sapma)" nobody 127.0.0.1 4451
bash $G ensure >/tmp/o 2>&1 && grep -q 'sapma bulundu' /tmp/o && bash $G check >/dev/null 2>&1 && ok "ensure: sapmayı onardı" || no "ensure: $(cat /tmp/o)"
exp ret "ensure sonrası nobody yine REDDEDİLDİ" nobody 127.0.0.1 4451
bash $G verify >/tmp/o 2>&1 && grep -q 'verify OK' /tmp/o && ok "verify -> OK (root bağlandı, nobody reddedildi)" || no "verify: $(cat /tmp/o)"
setpriv --reuid="$WU" --regid="$WU" --clear-groups sleep 30 & SP=$!; sleep 0.3
bash $G check >/tmp/o 2>&1; grep -q "UYARI: www-data ile nginx dışı süreç (4451'e bağlanabilir): sleep" /tmp/o && ok "check: www-data ile çalışan nginx dışı süreç UYARI" || no "uyarı: $(cat /tmp/o)"
kill $SP 2>/dev/null
bash $G remove >/dev/null 2>&1; bash $G verify >/tmp/o 2>&1 && no "remove sonrası verify geçti" || { grep -q 'BAĞLANABİLDİ' /tmp/o && ok "remove sonrası verify -> rc 1 (koruma yok)"; }

# P13c: ikinci yığın (staging Caddy 127.0.0.1:4461, edge 172.30.1.0/24) aynı tabloda, çok portlu
ip addr add 172.30.1.2/32 dev lo; lis 127.0.0.1 4461; lis 172.30.1.2 4461; lis 127.0.0.1 4462; sleep 0.3
export PROXY_GUARD_PORT=4451,4461 PROXY_GUARD_DST4=127.0.0.0/8,172.30.0.0/24,172.30.1.0/24
bash $G print 2>/dev/null | grep -q 'tcp dport { 4451, 4461 } ip daddr' && ok "çok port: print 'tcp dport { 4451, 4461 }'" || no "çok port print"
bash $G apply >/tmp/o 2>&1 && bash $G check >/dev/null 2>&1 && ok "çok port: apply + check -> 0" || no "çok port apply: $(cat /tmp/o)"
exp ret "stg: nobody -> 127.0.0.1:4461 REDDEDİLDİ" nobody 127.0.0.1 4461
exp ret "stg: nobody -> 172.30.1.2:4461 (stg edge) REDDEDİLDİ" nobody 172.30.1.2 4461
exp ok  "stg: www-data -> 127.0.0.1:4461 bağlanır" www-data 127.0.0.1 4461
exp ok  "stg: root -> 127.0.0.1:4461 bağlanır" root 127.0.0.1 4461
exp ret "prod portu hâlâ korunuyor: nobody -> 127.0.0.1:4451 REDDEDİLDİ" nobody 127.0.0.1 4451
exp ok  "kapsam dışı: nobody -> 127.0.0.1:4462 etkilenmez" nobody 127.0.0.1 4462
bash $G verify >/tmp/o 2>&1 && grep -q 'tcp/4451,4461' /tmp/o && ok "çok port: verify her portu sınadı" || no "çok port verify: $(cat /tmp/o)"
PROXY_GUARD_PORT=4451,70000 bash $G print >/tmp/o 2>&1; [ $? = 1 ] && grep -q 'PROXY_GUARD_PORT geçersiz' /tmp/o && ok "geçersiz port listesi -> rc 1" || no "port listesi: $(cat /tmp/o)"
unset PROXY_GUARD_PORT PROXY_GUARD_DST4; bash $G apply >/dev/null 2>&1
bash $G print 2>/dev/null | grep -q 'tcp dport 4451 ip daddr { 127.0.0.0/8,172.30.0.0/24 }' && ok "tek port (varsayılan): kural metni P13b ile aynı" || no "tek port metni"

# install / uninstall (systemctl taslağı)
mkdir -p /stub /units /src && printf '#!/bin/sh\necho "systemctl $*" >>/tmp/sysctl.log\n' >/stub/systemctl && chmod 755 /stub/systemctl
cp $G /src/proxy-guard.sh
PATH="/stub:$PATH" PROXY_GUARD_TEST_UNIT_DIR=/units bash /src/proxy-guard.sh install >/tmp/o 2>&1 && ok "install -> 0" || no "install: $(cat /tmp/o)"
[ "$(stat -c '%u %a' /usr/local/sbin/remote-proxy-guard)" = "0 755" ] && [ "$(stat -c '%u %a' /etc/default/remote-proxy-guard)" = "0 644" ] \
  && ok "kurulu kopya root 0755, /etc/default root 0644" || no "izinler"
grep -q '^ExecStart=/usr/local/sbin/remote-proxy-guard ensure' /units/remote-proxy-guard.service && grep -q '^Before=docker.service' /units/remote-proxy-guard.service \
  && grep -q '^WantedBy=multi-user.target nftables.service' /units/remote-proxy-guard.service && grep -q 'enable --now remote-proxy-guard.timer' /tmp/sysctl.log \
  && ok "birimler kuruldu, ExecStart kurulu kopya, timer etkin" || no "birimler"
nft delete table inet remote_proxy_guard
PROXY_GUARD_PORT=1 /usr/local/sbin/remote-proxy-guard ensure >/dev/null 2>&1; exp ret "kurulu kopya ensure (env yok sayıldı, conf'tan 4451) -> nobody REDDEDİLDİ" nobody 127.0.0.1 4451
chmod 0666 /etc/default/remote-proxy-guard
/usr/local/sbin/remote-proxy-guard check >/tmp/o 2>&1; [ $? = 1 ] && grep -q 'group/other yazabiliyor' /tmp/o && ok "conf g/o yazılabilir -> kurulu kopya çalışmaz" || no "conf izin: $(cat /tmp/o)"
chmod 0644 /etc/default/remote-proxy-guard
PATH="/stub:$PATH" PROXY_GUARD_TEST_UNIT_DIR=/units bash /src/proxy-guard.sh uninstall >/dev/null 2>&1
[ ! -e /usr/local/sbin/remote-proxy-guard ] && [ ! -e /etc/default/remote-proxy-guard ] && [ ! -e /units/remote-proxy-guard.timer ] \
  && ! nft list table inet remote_proxy_guard >/dev/null 2>&1 && ok "uninstall: kopya, conf, birimler ve tablo silindi" || no "uninstall"
echo "SONUÇ-İÇ $F"
EOF
chmod 0755 "$TMP"; chmod 0644 "$TMP"/*
docker run --rm --name "$C" --user 0 --cap-add NET_ADMIN -v "$HERE:/w:ro" -v "$TMP:/t:ro" alpine:3.20 \
  sh -c 'apk add --no-cache bash >/dev/null 2>&1 && bash /t/inner.sh' >"$TMP/out" 2>&1 || true
grep -E '^(PASS|FAIL|INFO)' "$TMP/out" || true
n="$(sed -n 's/^SONUÇ-İÇ //p' "$TMP/out")"
echo
if [ "$n" = 0 ]; then echo "SONUÇ: GEÇTİ"; else [ -n "$n" ] || tail -20 "$TMP/out"; echo "SONUÇ: ${n:-?} FAIL"; exit 1; fi
