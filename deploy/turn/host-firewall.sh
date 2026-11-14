#!/bin/sh
# TURN host güvenlik duvarı (S-P3-2; runbook §9.2.1). coturn `allowed-peer-ip=<public IP>` (relay<->relay) port
# ayırmadığından relay soketi host'un KENDİ adreslerindeki her UDP portuna (53, 3478 TURN-in-TURN, SNMP...) paket
# gönderebilir; host network + loopback/hairpin UFW'nin INPUT kurallarını atlar. Bu betik filter/OUTPUT'a dar bir
# zincir ekler:  UDP, kaynak port = relay aralığı, hedef = host'un kendi adresi, hedef port relay aralığı DIŞI -> DROP.
# Yalnız bu üçlüye uyan paket düşer; başka projelerin trafiğine dokunulmaz. Ek olarak relay aralığı çekirdeğin
# geçici (ephemeral) port havuzundan çıkarılır (net.ipv4.ip_local_reserved_ports, v4+v6) -> aralıktan kaynak port
# yalnız açıkça bind eden coturn'de olur (başka süreçlerin 127.0.0.53:53 DNS sorgusu vb. etkilenmez).
# G-P13b-1 (P13b): TURN_FW_RELAY_MAX_BPS > 0 ise aynı zincire toplam relay hız tavanı eklenir (hashlimit, bayt/sn):
#   relay -> peer (UDP, kaynak port relay aralığı) ve relay -> istemci (UDP 3478, TCP 3478/5349) için ayrı ayrı. coturn
#   `bps-capacity` her allocation için max-bps REZERVE ettiğinden (62,5 MB/s / 1 MB/s = 62 allocation) kullanılmaz (0);
#   paylaşımlı sunucunun diğer sitelerini bu tavan korur. Aşan paket düşer (UDP) / yeniden iletilir (TCP).
# Docker kurallarına dokunmaz (Docker filter/OUTPUT kullanmaz; DOCKER-*/nat zincirleri ayrı). UFW'nin ufw-* zincirleri ayrı.
#
# Kullanım (root):  ./host-firewall.sh apply|ensure|check|remove|install|uninstall|print
#   apply     kuralları geçici zincirde kurar, başarıda atomik değiştirir (S-P3-T2-1) + reserved ports. Idempotent.
#   ensure    check başarısızsa apply; sapma ve hata journald'a err önceliğiyle yazılır, onarılamazsa exit 1.
#   check     kurallar ve reserved ports beklenen halde mi (0 = evet). Yazmaz.
#   remove    zinciri ve atlamayı siler, reserved ports'ta yalnız bizim eklediğimiz portları geri alır.
#   install   apply + betiği /usr/local/sbin/remote-turn-fw (root:root 0755) olarak kopyalar, değerleri
#             /etc/default/remote-turn-fw'ye (root 0644, yalnız IP/port) yazar, systemd service+timer kurar (S-P3-T2-2).
#             Betik/.env değişince install YENİDEN çalıştırılır (timer repo klonunu değil kurulu kopyayı çalıştırır).
#   uninstall timer/service + kurulu kopya + /etc/default dosyası + remove.
#   print     uygulanacak kuralları yazdırır (değişiklik yapmaz; root gerekmez).
# Girdi (öncelik: env > kaynak dosya). Repo kopyası: betik dizinindeki .env'den YALNIZ TURN_EXTERNAL_IP ve
#   TURN_FW_SELF_IPS satırları okunur (secret okunmaz, source edilmez), aralık turnserver.base.conf'tan.
#   Kurulu kopya (/usr/local/sbin/remote-turn-fw): yalnız /etc/default/remote-turn-fw (root sahibi, g/o yazamaz).
#   TURN_FW_SELF_IPS   ek kendi adresleri (virgüllü; v4/v6), ör. prod IPv6 adresi.
#   TURN_FW_PORT_MIN/MAX  relay aralığı (vars. turnserver.base.conf min-port/max-port).
#   TURN_FW_RESERVE_PORTS=0  reserved ports adımını atla (yalnız test konteyneri: /proc/sys salt okunur).
#   TURN_FW_RELAY_MAX_BPS  toplam relay tavanı, bayt/sn, yön/akış başına (0 veya boş = kapalı; prod 62500000 = 500 Mbit/s).
# Aralık değişince (P13b: 49160-49199 -> 49160-49479) `install` yeniden çalıştırılır: önceki aralığın reserved ports
#   kaydı geri alınır, yenisi eklenir. apply/install önce aralıkta coturn dışında UDP dinleyen süreç olmadığını denetler
#   (`ss -Hlunp`; varsa yazmadan çıkar). preflight alt komutu yalnız bu denetimi yapar.
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)"
SELF_PATH="$DIR/$(basename "$0")"
CHAIN=REMOTE-TURN-OUT
NEW="$CHAIN-NEW"
UNIT=remote-turn-fw
INSTALLED=/usr/local/sbin/remote-turn-fw
CONF=/etc/default/remote-turn-fw
STATE=/var/lib/remote-turn-fw
# systemd altında stderr'deki "<3>" öneki journald önceliği (err) olur -> sessiz döngü yerine görünür hata.
ERRP=""; [ -n "${INVOCATION_ID:-}" ] && ERRP="<3>"
die() { echo "${ERRP}host-firewall: $*" >&2; exit 1; }
warn() { echo "${ERRP}host-firewall: $*" >&2; }
log() { echo "host-firewall: $*"; }
NL='
'
CR="$(printf '\r')"
# Çok satırlı / CR içeren değer reddi (grep satır bazlı eşleşmesinin ikinci satırı kaçırması, S-P3-T2-1 m.2).
one_line() { case "$2" in *"$NL"*|*"$CR"*) die "$1 çok satırlı olamaz" ;; esac; }
# KEY=değer satırını dosyadan okur (son eşleşme; tırnak/boşluk/CR atılır). Dosya source edilmez.
file_val() { sed -n "s/^$1=//p" "$2" | tail -1 | tr -d "\"' \r"; }

if [ "$SELF_PATH" = "$INSTALLED" ]; then
  [ -f "$CONF" ] || die "$CONF yok (deploy/turn/host-firewall.sh install ile oluşturulur)"
  [ -n "$(find "$CONF" -maxdepth 0 -user 0 ! -perm /022 2>/dev/null)" ] || die "$CONF root sahibi değil ya da group/other yazabiliyor"
  SRC="$CONF"
else
  SRC="$DIR/.env"
fi
if [ -f "$SRC" ]; then
  [ -n "${TURN_EXTERNAL_IP:-}" ] || TURN_EXTERNAL_IP="$(file_val TURN_EXTERNAL_IP "$SRC")"
  [ -n "${TURN_FW_SELF_IPS:-}" ] || TURN_FW_SELF_IPS="$(file_val TURN_FW_SELF_IPS "$SRC")"
  [ -n "${TURN_FW_RELAY_MAX_BPS:-}" ] || TURN_FW_RELAY_MAX_BPS="$(file_val TURN_FW_RELAY_MAX_BPS "$SRC")"
fi
if [ "$SRC" = "$CONF" ]; then
  [ -n "${TURN_FW_PORT_MIN:-}" ] || TURN_FW_PORT_MIN="$(file_val TURN_FW_PORT_MIN "$CONF")"
  [ -n "${TURN_FW_PORT_MAX:-}" ] || TURN_FW_PORT_MAX="$(file_val TURN_FW_PORT_MAX "$CONF")"
  [ -n "${TURN_FW_RESERVE_PORTS:-}" ] || TURN_FW_RESERVE_PORTS="$(file_val TURN_FW_RESERVE_PORTS "$CONF")"
fi
: "${TURN_EXTERNAL_IP:?TURN_EXTERNAL_IP gerekli (env, $DIR/.env veya $CONF)}"
conf_port() { [ -f "$DIR/turnserver.base.conf" ] && sed -n "s/^$1=\([0-9][0-9]*\)\$/\1/p" "$DIR/turnserver.base.conf" | tail -1; }
PMIN="${TURN_FW_PORT_MIN:-$(conf_port min-port || true)}"
PMAX="${TURN_FW_PORT_MAX:-$(conf_port max-port || true)}"
RESERVE="${TURN_FW_RESERVE_PORTS:-1}"
RMAX="${TURN_FW_RELAY_MAX_BPS:-0}"
one_line TURN_EXTERNAL_IP "$TURN_EXTERNAL_IP"
one_line TURN_FW_SELF_IPS "${TURN_FW_SELF_IPS:-}"
case "$PMIN" in ''|*[!0-9]*|0?*) die "relay port aralığı okunamadı (min)" ;; esac
case "$PMAX" in ''|*[!0-9]*|0?*) die "relay port aralığı okunamadı (max)" ;; esac
case "$RESERVE" in 0|1) ;; *) die "TURN_FW_RESERVE_PORTS 0 veya 1 olmalı" ;; esac
case "$RMAX" in *[!0-9]*|0?*) die "TURN_FW_RELAY_MAX_BPS sayı olmalı (bayt/sn)" ;; esac
[ "${#RMAX}" -le 10 ] || die "TURN_FW_RELAY_MAX_BPS çok büyük"
# hashlimit bayt kipi: kb = 1024 bayt (iptables), yukarı yuvarlanır. En az 1kb/s.
RKB=$(( (RMAX + 1023) / 1024 ))
[ "${#PMIN}" -le 5 ] && [ "${#PMAX}" -le 5 ] && [ "$PMIN" -ge 1024 ] && [ "$PMAX" -le 65535 ] && [ "$PMIN" -lt "$PMAX" ] \
  || die "port aralığı hatalı: $PMIN-$PMAX (1024..65535, min<max)"
RANGE="$PMIN:$PMAX"

# IPv4: tam dize case ile (yeni satır geçemez), 4 oktet, her biri 0..255, baştaki sıfır yok (sekizlik belirsizliği).
is_v4() (
  case "$1" in ''|*[!0-9.]*|.*|*.|*..*) exit 1 ;; esac
  IFS=.; set -f; set -- $1
  [ $# -eq 4 ] || exit 1
  for o; do
    case "$o" in ''|*[!0-9]*|0?*) exit 1 ;; esac
    [ "${#o}" -le 3 ] && [ "$o" -le 255 ] || exit 1
  done
)
# IPv6: yalnız hex ve ':'; en çok bir '::'; grup ≤ 4 hane; '::' yoksa 8 grup, varsa ≤ 7. Gömülü IPv4 kabul edilmez.
is_v6() (
  case "$1" in ''|*[!0-9a-fA-F:]*|*:::*|:[!:]*|*[!:]:) exit 1 ;; *:*) ;; *) exit 1 ;; esac
  [ "${#1}" -le 39 ] || exit 1
  dbl=0; r="${1#*::}"
  if [ "$r" != "$1" ]; then case "$r" in *::*) exit 1 ;; esac; dbl=1; fi
  n=0; IFS=:; set -f
  for g in $1; do
    [ -z "$g" ] && continue
    [ "${#g}" -le 4 ] || exit 1
    n=$((n + 1))
  done
  if [ "$dbl" = 1 ]; then [ "$n" -le 7 ]; else [ "$n" -eq 8 ]; fi
)
case "$TURN_EXTERNAL_IP" in */*/*) die "TURN_EXTERNAL_IP biçimi: <public> veya <public>/<private>" ;; esac
V4=""; V6=""
for ip in "${TURN_EXTERNAL_IP%%/*}" "${TURN_EXTERNAL_IP#*/}" $(echo "${TURN_FW_SELF_IPS:-}" | tr ',' ' '); do
  if is_v4 "$ip"; then case " $V4 " in *" $ip "*) ;; *) V4="$V4 $ip" ;; esac
  elif is_v6 "$ip"; then case " $V6 " in *" $ip "*) ;; *) V6="$V6 $ip" ;; esac
  else die "geçersiz IP: $ip"; fi
done
is_v4 "${TURN_EXTERNAL_IP%%/*}" || die "TURN_EXTERNAL_IP biçimi: <public> veya <public>/<private> (IPv4)"

have6() { command -v ip6tables >/dev/null 2>&1 && ip6tables -S OUTPUT >/dev/null 2>&1; }
# rules <fam>: her satır bir kural (zincire -A ile eklenecek argümanlar)
rules() {
  if [ "$1" = 4 ]; then ips="$V4"; else ips="$V6"; fi
  for ip in $ips; do echo "-p udp --sport $RANGE -d $ip ! --dport $RANGE -j DROP"; done
  # Arayüzdeki tüm kendi adresleri (özel IP, docker köprü ağ geçitleri, IPv6 global/ULA, loopback).
  echo "-p udp --sport $RANGE -m addrtype --dst-type LOCAL ! --dport $RANGE -j DROP"
  if [ "$RMAX" != 0 ]; then
    echo "-p udp --sport $RANGE -m hashlimit --hashlimit-above ${RKB}kb/s --hashlimit-name remote-turn-peer$1 -j DROP"
    echo "-p udp --sport 3478 -m hashlimit --hashlimit-above ${RKB}kb/s --hashlimit-name remote-turn-cu$1 -j DROP"
    echo "-p tcp -m multiport --sports 3478,5349 -m hashlimit --hashlimit-above ${RKB}kb/s --hashlimit-name remote-turn-ct$1 -j DROP"
  fi
}
ipt() { if [ "$1" = 4 ]; then shift; iptables -w "$@"; else shift; ip6tables -w "$@"; fi; }
fams() { echo 4; if have6; then echo 6; fi; }

# TURN_FW_TEST_RES_FILE: YALNIZ test (konteynerde /proc/sys salt okunur); aralık değişimi geri alma mantığını sınar.
RES="${TURN_FW_TEST_RES_FILE:-/proc/sys/net/ipv4/ip_local_reserved_ports}"
reserve_on() { [ "$RESERVE" = 1 ]; }
# Bizim aralık listedeki bir girdi tarafından KAPSANIYOR mu (çekirdek komşu/örtüşen aralıkları birleştirebilir; S-P3-T2-1 m.3).
reserved_ok() {
  tr ',' '\n' <"$RES" | awk -F- -v a="$PMIN" -v b="$PMAX" \
    '$1!="" { hi = ($2 == "" ? $1 : $2); if ($1 + 0 <= a && hi + 0 >= b) f = 1 } END { exit !f }'
}
# Önceki apply'ın eklediği aralık farklıysa (aralık değişti) önce o geri alınır (reserved.range kaydı).
reserve_prev_undo() {
  if [ -f "$STATE/reserved.range" ]; then prev="$(tr -d ' \n' <"$STATE/reserved.range")"
  # P13a ve öncesi kurulumlar reserved.range yazmıyordu: önceki aralık kurulu /etc/default dosyasından (install apply'dan
  # SONRA yazar, yani burada hâlâ eski değerdedir) alınır.
  elif [ -f "$CONF" ] && [ -f "$STATE/reserved.before" ]; then prev="$(file_val TURN_FW_PORT_MIN "$CONF")-$(file_val TURN_FW_PORT_MAX "$CONF")"
  else return 0; fi
  [ "$prev" = "$PMIN-$PMAX" ] && return 0
  case "$prev" in [0-9]*-[0-9]*) ;; *) warn "$STATE/reserved.range okunamadı ($prev); yok sayıldı"; rm -f "$STATE/reserved.range"; return 0 ;; esac
  bef=""; [ -f "$STATE/reserved.before" ] && bef="$(tr -d ' \n' <"$STATE/reserved.before")"
  ( PMIN="${prev%-*}"; PMAX="${prev#*-}"; reserved_minus "$(cat "$RES")" "$bef" >"$RES" )
  rm -f "$STATE/reserved.before" "$STATE/reserved.range"
  log "önceki relay aralığı $prev reserved ports'tan geri alındı"
}
reserve_add() {
  reserve_prev_undo
  reserved_ok && return 0
  cur="$(cat "$RES")"
  # Eklemeden önceki liste saklanır: remove, birleşmiş aralıktan yalnız BİZİM eklediğimiz portları çıkarır.
  (umask 077; mkdir -p "$STATE"; printf '%s\n' "$cur" >"$STATE/reserved.before")
  (umask 077; printf '%s\n' "$PMIN-$PMAX" >"$STATE/reserved.range")
  if [ -n "$cur" ]; then echo "$cur,$PMIN-$PMAX" >"$RES"; else echo "$PMIN-$PMAX" >"$RES"; fi
  reserved_ok || die "ip_local_reserved_ports ayarlanamadı"
}
# reserved_minus <güncel> <önceki>: güncel − [PMIN..PMAX] ∪ (önceki ∩ [PMIN..PMAX]); aralık listesi olarak yazar.
reserved_minus() {
  awk -v a="$PMIN" -v b="$PMAX" -v cur="$1" -v bef="$2" '
    function add(list, inr,   n, i, p, q, lo, hi, k) {
      n = split(list, p, ",")
      for (i = 1; i <= n; i++) {
        if (p[i] == "") continue
        split(p[i], q, "-"); lo = q[1] + 0; hi = (q[2] == "" ? lo : q[2] + 0)
        for (k = lo; k <= hi; k++) if (inr ? (k >= a && k <= b) : (k < a || k > b)) s[k] = 1
      }
    }
    BEGIN {
      add(cur, 0); add(bef, 1); out = ""
      for (k = 0; k <= 65535; k++) if (k in s) {
        lo = k; while ((k + 1) in s) k++
        out = out (out == "" ? "" : ",") (lo == k ? lo : lo "-" k)
      }
      print out
    }'
}
reserve_del() {
  [ -f "$RES" ] || return 0
  reserved_ok || return 0
  bef=""; [ -f "$STATE/reserved.before" ] && bef="$(tr -d ' \n' <"$STATE/reserved.before")"
  reserved_minus "$(cat "$RES")" "$bef" >"$RES"
  rm -f "$STATE/reserved.before" "$STATE/reserved.range"
}

do_check() {
  okc=0
  for f in $(fams); do
    ipt "$f" -C OUTPUT -j "$CHAIN" 2>/dev/null || { echo "IPv$f: OUTPUT -> $CHAIN atlaması yok"; okc=1; continue; }
    want=$(rules "$f" | wc -l); have=$(ipt "$f" -S "$CHAIN" | grep -c '^-A' || true)
    [ "$want" -eq "$have" ] || { echo "IPv$f: $CHAIN kural sayısı $have (beklenen $want)"; okc=1; }
    rules "$f" | while read -r r; do
      # shellcheck disable=SC2086
      ipt "$f" -C "$CHAIN" $r 2>/dev/null || { echo "IPv$f: eksik kural: $r"; exit 1; }
    done || okc=1
  done
  if reserve_on; then reserved_ok || { echo "ip_local_reserved_ports $PMIN-$PMAX kapsamıyor"; okc=1; }; fi
  return $okc
}
drop_chain() { # <fam> <zincir>: OUTPUT'taki atlamaları + zinciri siler (yoksa sessiz)
  while ipt "$1" -D OUTPUT -j "$2" 2>/dev/null; do :; done
  ipt "$1" -F "$2" 2>/dev/null || true
  ipt "$1" -X "$2" 2>/dev/null || true
}
# Fail-closed değişim (S-P3-T2-1 m.1): kurallar $NEW'de kurulur; biri bile eklenemezse $NEW silinir, mevcut $CHAIN ve
# atlaması DOKUNULMADAN kalır. Başarıda: $NEW'e atlama OUTPUT başına eklenir (koruma kesintisiz), eski atlama/zincir
# silinir, $NEW -> $CHAIN yeniden adlandırılır (atlama referansı adla birlikte taşınır).
apply_fam() {
  f="$1"
  drop_chain "$f" "$NEW"   # önceki yarım kalmış deneme
  ipt "$f" -N "$NEW"
  rules "$f" | while read -r r; do
    # shellcheck disable=SC2086
    ipt "$f" -A "$NEW" $r || exit 1
  done || { drop_chain "$f" "$NEW"; die "IPv$f: kural eklenemedi; mevcut $CHAIN korunuyor"; }
  [ "$(ipt "$f" -S "$NEW" | grep -c '^-A' || true)" -eq "$(rules "$f" | wc -l)" ] \
    || { drop_chain "$f" "$NEW"; die "IPv$f: $NEW kural sayısı beklenenden farklı; mevcut $CHAIN korunuyor"; }
  ipt "$f" -I OUTPUT 1 -j "$NEW"
  drop_chain "$f" "$CHAIN"
  ipt "$f" -E "$NEW" "$CHAIN" || die "IPv$f: $NEW -> $CHAIN yeniden adlandırılamadı (koruma $NEW ile etkin)"
}
do_apply() {
  for f in $(fams); do apply_fam "$f"; done
  if reserve_on; then reserve_add; fi
  log "uygulandı (aralık $RANGE; relay tavanı ${RMAX} B/s; IPv4:$V4; IPv6:${V6:- -}; IPv6 zinciri: $(have6 && echo var || echo yok))"
}
do_remove() {
  for f in 4 6; do
    [ "$f" = 6 ] && ! have6 && continue
    drop_chain "$f" "$NEW"
    drop_chain "$f" "$CHAIN"
  done
  if reserve_on; then reserve_del; fi
  log "kaldırıldı"
}
do_install() {
  command -v systemctl >/dev/null || die "systemd yok"
  # S-P3-T2-2: timer repo klonunu (deploy kullanıcısı yazabilir) değil, root sahipli kopyayı çalıştırır.
  if [ "$SELF_PATH" != "$INSTALLED" ]; then
    install -o root -g root -m 0755 "$SELF_PATH" "$INSTALLED.tmp.$$"
    mv -f "$INSTALLED.tmp.$$" "$INSTALLED"
  fi
  tmp="$CONF.tmp.$$"
  (umask 022; {
    echo "# remote-turn-fw girdileri — deploy/turn/host-firewall.sh install üretir; elle düzenlemeyin, install'ı yeniden"
    echo "# çalıştırın (runbook §9.2.1). Yalnız IP/port; secret YOK. root:root 0644."
    echo "TURN_EXTERNAL_IP=$TURN_EXTERNAL_IP"
    echo "TURN_FW_SELF_IPS=${TURN_FW_SELF_IPS:-}"
    echo "TURN_FW_PORT_MIN=$PMIN"
    echo "TURN_FW_PORT_MAX=$PMAX"
    echo "TURN_FW_RESERVE_PORTS=$RESERVE"
    echo "TURN_FW_RELAY_MAX_BPS=$RMAX"
  } >"$tmp")
  chown root:root "$tmp"; chmod 0644 "$tmp"; mv -f "$tmp" "$CONF"
  cat >"/etc/systemd/system/$UNIT.service" <<EOF
[Unit]
Description=Remote Support TURN host firewall (S-P3-2, runbook 9.2.1)
After=network-online.target ufw.service docker.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$INSTALLED ensure
EOF
  cat >"/etc/systemd/system/$UNIT.timer" <<EOF
[Unit]
Description=Remote Support TURN host firewall periyodik kontrol (UFW reload sonrası onarım)

[Timer]
OnBootSec=20s
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
EOF
  # Açılışta timer'dan önce de bir kez çalışsın.
  mkdir -p "/etc/systemd/system/$UNIT.service.d"
  printf '[Install]\nWantedBy=multi-user.target\n' >"/etc/systemd/system/$UNIT.service.d/install.conf"
  systemctl daemon-reload
  systemctl enable --now "$UNIT.timer" >/dev/null
  systemctl enable "$UNIT.service" >/dev/null 2>&1 || true
  systemctl start "$UNIT.service"
  log "kuruldu: $INSTALLED (0755), $CONF (0644), systemd $UNIT.service + .timer"
}
do_uninstall() {
  systemctl disable --now "$UNIT.timer" >/dev/null 2>&1 || true
  systemctl disable "$UNIT.service" >/dev/null 2>&1 || true
  rm -rf "/etc/systemd/system/$UNIT.service" "/etc/systemd/system/$UNIT.timer" "/etc/systemd/system/$UNIT.service.d"
  systemctl daemon-reload 2>/dev/null || true
  do_remove
  rm -f "$INSTALLED" "$CONF"
  rm -rf "$STATE"
}
need_root() { [ "$(id -u)" = 0 ] || die "root gerekli"; }
# Aralıkta coturn (turnserver) dışında UDP dinleyen süreç varsa yazmadan çık (mimari-p13 §7.4 "önce ss -lunp").
# TURN_FW_SKIP_PREFLIGHT=1 yalnız test konteyneri (ss yok / coturn ağ ad alanı) içindir.
preflight() {
  [ "${TURN_FW_SKIP_PREFLIGHT:-0}" = 1 ] && return 0
  command -v ss >/dev/null 2>&1 || die "ss yok (iproute2); aralık denetimi yapılamadı"
  busy="$(ss -Hlunp 2>/dev/null | awk -v a="$PMIN" -v b="$PMAX" '
    { l = ""; for (i = 1; i <= NF; i++) if ($i ~ /:[0-9]+$/) { l = $i; break }   # ilk adres:port = yerel (Netid sütunu olsa da olmasa da)
      n = split(l, x, ":"); p = x[n] + 0; if (p >= a && p <= b && $0 !~ /"turnserver"/) print p " " $NF }' | sort -u)"
  [ -z "$busy" ] || die "relay aralığı $RANGE içinde başka süreç UDP dinliyor (önce kapatın): $(echo "$busy" | tr '\n' ';')"
  log "preflight OK: $RANGE aralığında coturn dışında UDP dinleyen yok"
}

case "${1:-}" in
  print)
    echo "# iptables -N $NEW; -A ...; -I OUTPUT 1 -j $NEW; eski $CHAIN silinir; -E $NEW $CHAIN"
    rules 4 | sed "s/^/iptables -A $CHAIN /"
    echo "# ip6tables (varsa)"; rules 6 | sed "s/^/ip6tables -A $CHAIN /"
    echo "# reserved: net.ipv4.ip_local_reserved_ports += $PMIN-$PMAX (kapsama kontrolü)"
    echo "# relay tavanı: ${RMAX} bayt/sn (${RKB}kb/s; 0 = kapalı)" ;;
  preflight) preflight ;;
  check) need_root; if do_check; then log "OK"; else exit 1; fi ;;
  apply) need_root; preflight; do_apply; do_check >/dev/null || die "uygulama sonrası check başarısız" ;;
  ensure)
    need_root
    if ! drift="$(do_check 2>&1)"; then
      warn "sapma bulundu, yeniden uygulanıyor: $(echo "$drift" | tr '\n' ';')"
      do_apply
      do_check >/dev/null 2>&1 || die "onarım sonrası check başarısız: $(do_check 2>&1 | tr '\n' ';')"
    fi ;;
  remove) need_root; do_remove ;;
  install) need_root; preflight; do_apply; do_install ;;
  uninstall) need_root; do_uninstall ;;
  *) sed -n '2,/^set -eu/p' "$0" | sed '$d' >&2; exit 2 ;;
esac
