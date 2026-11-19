#!/bin/sh
# P29 K6 (mimari-p29 K-P29-1, §9.6; ADR-0040 m.1): güncelleme açık anahtarlarının ldflags'i. Tek kaynak; build.sh, build-darwin.sh,
# build-linux.sh çağırır. Çıktı (stdout): boş ya da
#   -X remote-support/agent-win/internal/config.updateEnv=<env> -X remote-support/agent-win/internal/config.updateKeys=<k1>[,<k2>]
# Kullanım: build/update-ldflags.sh [prod|staging|""]
#   boş            -> boş çıktı: anahtar GÖMÜLMEZ, güncelleyici kapalı (PR, yer tutucu, iz testi derlemeleri; fail-closed)
#   prod|staging   -> build/update-keys/<env>.pub okunur. Dosya YOKSA uyarı + boş çıktı (anahtar henüz üretilmedi: güncelleyici
#                     kapalı derlenir; runbook §31.2). Dosya varsa biçimi katı denetlenir, bozuksa çıkış 2 (derleme durur).
# .pub biçimi: satır başına (ya da virgülle ayrılmış) Ed25519 açık anahtarı (base64url, dolgusuz, 43 karakter); '#' ile başlayan ve boş satırlar yok
# sayılır; en çok 2 anahtar (etkin + yedek), yinelenemez. Deterministik: aynı dosya -> aynı ldflags (tekrarlanabilir derleme).
set -eu
ENV_NAME="${1:-}"
case "$ENV_NAME" in
  "") exit 0 ;;
  prod|staging) ;;
  *) echo "update-ldflags: ortam prod|staging olmalı: $ENV_NAME" >&2; exit 2 ;;
esac
F="$(dirname "$0")/update-keys/$ENV_NAME.pub"
if [ ! -f "$F" ]; then
  echo "update-ldflags: UYARI $F yok — güncelleyici KAPALI derleniyor (anahtar üretimi: runbook §31.2)" >&2
  exit 0
fi
KEYS=""; N=0
# shellcheck disable=SC2013  # satır satır; anahtarlar boşluk içermez (aşağıda denetlenir)
for line in $(sed -e 's/\r$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e '/^#/d' -e '/^$/d' "$F" | tr ',' '\n'); do
  case "$line" in *[!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-]*) OK=0 ;; *) OK=1 ;; esac
  LAST="$(printf '%s' "$line" | cut -c43)"
  case "$LAST" in A|E|I|M|Q|U|Y|c|g|k|o|s|w|0|4|8) ;; *) OK=0 ;; esac
  [ "$OK" = 1 ] && [ "${#line}" -eq 43 ] || { echo "update-ldflags: $F geçersiz satır (base64url 43 karakter değil)" >&2; exit 2; }
  case ",$KEYS," in *",$line,"*) echo "update-ldflags: $F yinelenen anahtar" >&2; exit 2 ;; esac
  KEYS="${KEYS:+$KEYS,}$line"; N=$((N + 1))
done
[ "$N" -ge 1 ] && [ "$N" -le 2 ] || { echo "update-ldflags: $F 1 ya da 2 anahtar içermeli (bulunan: $N)" >&2; exit 2; }
printf '%s' "-X remote-support/agent-win/internal/config.updateEnv=$ENV_NAME -X remote-support/agent-win/internal/config.updateKeys=$KEYS"
