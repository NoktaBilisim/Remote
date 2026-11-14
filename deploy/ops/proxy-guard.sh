#!/usr/bin/env bash
# remote-proxy-guard — 127.0.0.1:4451 yerel bağlantı kısıtı (G-P13b-3; mimari-p13 §7.2/§7.3, ADR-0015).
# Caddy'nin 4451 dinleyicisi docker ağ geçidinden (172.30.0.128) gelen X-Forwarded-For'a güvenir. Host'tan 4451'e giden
# HER bağlantı (127.0.0.1:4451 -> docker-proxy, userland-proxy kapalıysa DNAT ile 172.30.0.2:4451, ya da doğrudan
# 172.30.0.2:4451) Caddy'ye bu adresten görünür -> aynı sunucudaki herhangi bir süreç sahte XFF ile IP tabanlı giriş
# limitlerini ve audit ip_address'i atlatabilirdi. Bu betik nftables'ta ayrı bir tablo kurar:
#   inet remote_proxy_guard / output (hook output, priority filter = NAT'tan SONRA; DNAT edilmiş hedef de görünür):
#   tcp dport 4451, hedef loopback ya da edge ağı, yeni bağlantı, soket sahibi (meta skuid) izinli kullanıcılar DIŞINDA
#   -> reject with tcp reset.
# İzinliler: root (docker-proxy, remote-watch) ve nginx işçi kullanıcısı (vars. www-data). Başka tablo/zincire dokunmaz
# (UFW/Docker iptables-nft tabloları ayrı); yalnız bu tablo atomik olarak (nft -f, tek işlem) yeniden kurulur.
# Kalan risk: izinli kullanıcıyla çalışan BAŞKA süreçler (ör. www-data php-fpm havuzları) hâlâ bağlanabilir; `check`
#   bunları UYARI olarak listeler. Kapatmak için nginx'e ayrı kullanıcı ya da php-fpm havuzlarına ayrı kullanıcı verilir.
#
# Kullanım (root; print hariç):  proxy-guard.sh print|apply|check|ensure|remove|verify|install|uninstall
#   print      uygulanacak nft kural setini yazdırır (değişiklik yok, root gerekmez).
#   apply      tabloyu atomik kurar (idempotent; tablo yoksa oluşturur, varsa tamamen değiştirir).
#   check      tablo + imzalı kural (yorumdaki yapılandırma özeti) yerinde mi (0 = evet); izinli kullanıcıların nginx dışı
#              süreçlerini UYARI olarak yazar. Yazmaz.
#   ensure     check başarısızsa apply (timer bunu çalıştırır; sapma journald'a err önceliğiyle).
#   remove     yalnız inet remote_proxy_guard tablosunu siler.
#   verify     canlı sınama: izinsiz kullanıcı (vars. nobody) 127.0.0.1:<port>'a BAĞLANAMAMALI, root BAĞLANABİLMELİ.
#   install    apply + kurulu kopya /usr/local/sbin/remote-proxy-guard (root 0755) + /etc/default/remote-proxy-guard
#              (root 0644) + systemd remote-proxy-guard.service (açılışta) + .timer (5 dk ensure). Değişince yeniden install.
#   uninstall  timer/service + kurulu kopya + /etc/default dosyası + remove.
# Girdi (env > /etc/default/remote-proxy-guard; kurulu kopya yalnız dosyayı okur):
#   PROXY_GUARD_PORT=4451  PROXY_GUARD_USERS="root www-data"  PROXY_GUARD_DST4="127.0.0.0/8,172.30.0.0/24"
#   (edge ağı deploy/docker-compose.yml networks.edge ile aynı)  PROXY_GUARD_VERIFY_USER=nobody
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
SELF_PATH="$DIR/$(basename "$0")"
TABLE=remote_proxy_guard
UNIT=remote-proxy-guard
INSTALLED=/usr/local/sbin/remote-proxy-guard
CONF=/etc/default/remote-proxy-guard
UNIT_DIR="${PROXY_GUARD_TEST_UNIT_DIR:-/etc/systemd/system}"
ERRP=""; [ -n "${INVOCATION_ID:-}" ] && ERRP="<3>"
die() { echo "${ERRP}proxy-guard: $*" >&2; exit 1; }
warn() { echo "${ERRP}proxy-guard: $*" >&2; }
log() { echo "proxy-guard: $*"; }
file_val() { sed -n "s/^$1=//p" "$2" | tail -1 | tr -d "\"'\r"; }

if [ "$SELF_PATH" = "$INSTALLED" ]; then
  [ -f "$CONF" ] || die "$CONF yok (deploy/ops/proxy-guard.sh install ile oluşturulur)"
  [ -n "$(find "$CONF" -maxdepth 0 -user 0 ! -perm /022 2>/dev/null)" ] || die "$CONF root sahibi değil ya da group/other yazabiliyor"
  PROXY_GUARD_PORT="$(file_val PROXY_GUARD_PORT "$CONF")"; PROXY_GUARD_USERS="$(file_val PROXY_GUARD_USERS "$CONF")"
  PROXY_GUARD_DST4="$(file_val PROXY_GUARD_DST4 "$CONF")"
elif [ -f "$CONF" ]; then
  [ -n "${PROXY_GUARD_PORT:-}" ] || PROXY_GUARD_PORT="$(file_val PROXY_GUARD_PORT "$CONF")"
  [ -n "${PROXY_GUARD_USERS:-}" ] || PROXY_GUARD_USERS="$(file_val PROXY_GUARD_USERS "$CONF")"
  [ -n "${PROXY_GUARD_DST4:-}" ] || PROXY_GUARD_DST4="$(file_val PROXY_GUARD_DST4 "$CONF")"
fi
PORT="${PROXY_GUARD_PORT:-4451}"
USERS="${PROXY_GUARD_USERS:-root www-data}"
DST4="${PROXY_GUARD_DST4:-127.0.0.0/8,172.30.0.0/24}"
[[ "$PORT" =~ ^[1-9][0-9]{0,4}$ ]] && [ "$PORT" -le 65535 ] || die "PROXY_GUARD_PORT geçersiz: $PORT"
[[ "$DST4" =~ ^[0-9./,]{7,200}$ ]] || die "PROXY_GUARD_DST4 geçersiz (virgüllü IPv4/CIDR)"
[[ "$USERS" =~ ^[a-z_][a-z0-9_.\ -]{0,200}$ ]] || die "PROXY_GUARD_USERS geçersiz"

# İzinli kullanıcı adları -> uid (çözülemeyen ad hata: yanlış yazım sessizce nginx'i kilitlemesin). root (0) her zaman.
uids() {
  local u id out="0"
  for u in $USERS; do
    [ "$u" = root ] && continue
    id="$(id -u "$u" 2>/dev/null)" || die "kullanıcı yok: $u (PROXY_GUARD_USERS)"
    case ",$out," in *",$id,"*) ;; *) out="$out,$id" ;; esac
  done
  printf '%s\n' "$out"
}
ruleset() {  # <uid listesi>
  local u="$1" sig
  sig="rpg:$PORT:$DST4:$u"
  cat <<EOF
table inet $TABLE
delete table inet $TABLE
table inet $TABLE {
  chain output {
    type filter hook output priority filter; policy accept;
    tcp dport $PORT ip daddr { $DST4 } ct state new meta skuid != { $u } counter reject with tcp reset comment "$sig"
    tcp dport $PORT ip6 daddr ::1 ct state new meta skuid != { $u } counter reject with tcp reset comment "$sig"
  }
}
EOF
}
need_root() { [ "$(id -u)" = 0 ] || die "root gerekli"; }
need_nft() { command -v nft >/dev/null 2>&1 || die "nft yok (apt install nftables)"; }

do_apply() {
  local u; u="$(uids)"
  ruleset "$u" | nft -f - || die "nft kural seti yüklenemedi (mevcut tablo değişmedi: nft -f tek işlemdir)"
  log "uygulandı: tcp/$PORT yalnız uid {$u} ($USERS); hedef {$DST4, ::1}"
}
do_check() {
  local u n rc=0 p
  u="$(uids)"
  n="$(nft list chain inet "$TABLE" output 2>/dev/null | grep -c "comment \"rpg:$PORT:$DST4:$u\"" || true)"
  if [ "$n" != 2 ]; then echo "inet $TABLE output: beklenen 2 kural yok (bulunan $n)"; rc=1; fi
  for p in $USERS; do
    [ "$p" = root ] && continue
    ps -o comm= -u "$p" 2>/dev/null | grep -vx nginx | sort -u | sed "s/^/UYARI: $p ile nginx dışı süreç (4451'e bağlanabilir): /" >&2 || true
  done
  return "$rc"
}
do_remove() { nft delete table inet "$TABLE" 2>/dev/null || true; log "kaldırıldı (inet $TABLE)"; }
# Canlı sınama: dinleyici gerektirmez. RST (reddedildi) -> "Connection refused"; izinli kullanıcıda bağlantı ya kurulur
# ya da dinleyici yoksa yine refused olur -> root sınaması yalnız dinleyici varsa anlamlıdır (prod: Caddy 4451'de).
probe() {  # <kullanıcı> -> 0 bağlandı
  setpriv --reuid="$(id -u "$1")" --regid="$(id -g "$1")" --clear-groups \
    bash -c "exec 3<>/dev/tcp/127.0.0.1/$PORT" 2>/dev/null
}
do_verify() {
  local vu="${PROXY_GUARD_VERIFY_USER:-nobody}"
  command -v setpriv >/dev/null 2>&1 || die "setpriv yok (util-linux)"
  probe root || die "verify: root 127.0.0.1:$PORT'a bağlanamadı (Caddy 4451 dinlemiyor mu?) — sınama anlamsız"
  if probe "$vu"; then die "verify: '$vu' 127.0.0.1:$PORT'a BAĞLANABİLDİ — koruma çalışmıyor"; fi
  log "verify OK: root bağlandı, '$vu' reddedildi (tcp/$PORT)"
}
do_install() {
  command -v systemctl >/dev/null 2>&1 || die "systemd yok"
  do_apply
  if [ "$SELF_PATH" != "$INSTALLED" ]; then
    install -d -o root -g root -m 0755 "$(dirname "$INSTALLED")" "$(dirname "$CONF")" "$UNIT_DIR"
    install -o root -g root -m 0755 "$SELF_PATH" "$INSTALLED.tmp.$$" && mv -f "$INSTALLED.tmp.$$" "$INSTALLED"
  fi
  (umask 022; printf '# remote-proxy-guard girdileri — deploy/ops/proxy-guard.sh install üretir; elle düzenlemeyin.\nPROXY_GUARD_PORT=%s\nPROXY_GUARD_USERS=%s\nPROXY_GUARD_DST4=%s\n' \
    "$PORT" "$USERS" "$DST4" >"$CONF.tmp.$$")
  chown root:root "$CONF.tmp.$$"; chmod 0644 "$CONF.tmp.$$"; mv -f "$CONF.tmp.$$" "$CONF"
  cat >"$UNIT_DIR/$UNIT.service" <<EOF
[Unit]
Description=Remote Support 127.0.0.1:$PORT yerel baglanti kisiti (G-P13b-3)
# S-P13b-12: Docker 4451'i yayımlamadan ÖNCE kural yerinde. nftables.service (yeniden) başlarsa WantedBy ile bu birim de
# yeniden çalışır (After ile sonra); nftables stop'u (flush ruleset) timer en geç 5 dk'da onarır.
After=network-pre.target nftables.service
Before=docker.service
[Service]
Type=oneshot
ExecStart=$INSTALLED ensure
[Install]
WantedBy=multi-user.target nftables.service
EOF
  cat >"$UNIT_DIR/$UNIT.timer" <<EOF
[Unit]
Description=Remote Support proxy-guard periyodik kontrol (nft flush sonrasi onarim)
[Timer]
OnBootSec=30s
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable "$UNIT.service" >/dev/null 2>&1 || true
  systemctl enable --now "$UNIT.timer" >/dev/null
  log "kuruldu: $INSTALLED (0755), $CONF (0644), systemd $UNIT.service + .timer"
}
do_uninstall() {
  systemctl disable --now "$UNIT.timer" >/dev/null 2>&1 || true
  systemctl disable "$UNIT.service" >/dev/null 2>&1 || true
  rm -f "$UNIT_DIR/$UNIT.service" "$UNIT_DIR/$UNIT.timer"
  systemctl daemon-reload 2>/dev/null || true
  do_remove
  rm -f "$INSTALLED" "$CONF"
}

case "${1:-}" in
  print) ruleset "$(uids)" ;;
  apply) need_root; need_nft; do_apply; do_check >/dev/null || die "uygulama sonrası check başarısız" ;;
  check) need_root; need_nft; if do_check; then log "OK"; else exit 1; fi ;;
  ensure)
    need_root; need_nft
    if ! drift="$(do_check 2>/dev/null)"; then
      warn "sapma bulundu, yeniden uygulanıyor: ${drift//$'\n'/;}"
      do_apply; do_check >/dev/null 2>&1 || die "onarım sonrası check başarısız"
    fi ;;
  remove) need_root; need_nft; do_remove ;;
  verify) need_root; do_verify ;;
  install) need_root; need_nft; do_install ;;
  uninstall) need_root; need_nft; do_uninstall ;;
  *) sed -n '2,/^set -euo/p' "$0" | sed '$d' >&2; exit 2 ;;
esac
