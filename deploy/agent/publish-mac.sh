#!/usr/bin/env bash
# P28f K8b (mimari-p28f §8.1, §8.2 "Prod yayın betiği"; ADR-0037 m.6; S-P28f-3/7): macOS istemci zip'i yayını. verify-and-publish.sh
# ile aynı ilke: doğrulama operatör makinesinde (SHA256SUMS + zip yapısı + bundle kimliği + gh attestation), sunucu bayt eşitliğini
# yeniden kontrol eder. Hedef: compose `agent_downloads` volume'unda SABİT ad NoktaDestek-macOS.zip (server MAC_AGENT_PATH =
# /data/downloads/NoktaDestek-macOS.zip, Caddy agent_zip_file /srv/downloads/NoktaDestek-macOS.zip — aynı dosya) + deploy/.env
# MAC_AGENT_SHA256 → server yeniden yaratılır → Caddy üzerinden /downloads/NoktaDestek-macOS.zip SHA kontrolü.
#
# Kullanım:
#   deploy/agent/publish-mac.sh --tag v0.23.0 --ssh root@<sunucu>          # Release zip'i -> prod. Dal ortamdan (r4, K-P28f-r4-9):
#       APPLE_TEAM_ID tanımlı -> notarize dal; tanımsız -> ad-hoc dal (Developer ID'siz prod, mimari-p28f §15)
#   deploy/agent/publish-mac.sh --stg-run <run-id> --ssh root@<sunucu>     # main workflow_dispatch staging TEST zip'i
#       (artifact agent-mac-stg; hedef vars. /opt/remote-stg/deploy)
#   ALLOW_UNATTESTED=staging deploy/agent/publish-mac.sh --dir <klasör> --no-attestation --ssh root@<sunucu> \
#       --deploy-dir /opt/remote/deploy   # yerelde paketlenmiş ad-hoc TEST zip'i (klasörde NoktaDestek-macOS-stg-<sürüm>.zip
#       + SHA256SUMS); prod'a ASLA
#   deploy/agent/publish-mac.sh --withdraw --ssh root@<sunucu> [--deploy-dir …]   # geri alma: MAC_AGENT_SHA256 VE MAC_AGENT_SIGNING
#       birlikte boşaltılır → macOS indirmesi görünmez (availability macos:false); dosya volume'da kalır ama sunulmaz (forward_auth 503)
# Seçenekler: --deploy-dir <yol> (vars. /opt/remote/deploy; --stg-run'da /opt/remote-stg/deploy; --local'de bu betiğin üst
#   klasörü), --local (yerel yığın), --dry-run (yalnız indir + doğrula).
# Ortam: AGENT_REPO (vars. NoktaBilisim/Remote), APPLE_TEAM_ID (--tag'de dal seçer: tanımlı -> 10 karakter A-Z0-9 olmalı,
#   notarized predicate'teki teamId ile eşleşir, macOS'ta ayrıca codesign TeamIdentifier + spctl; tanımsız/boş -> ad-hoc dal),
#   AGENT_PUBLISH_RESTART=0 (compose'a dokunma; test: $dir/agent/downloads/).
# Prod kuralları (S-P28f-7, r4 K-P28f-r4-9, S-r4-5): --tag yalnız; ad ^NoktaDestek-macOS-X.Y.Z.zip$ (-stg- RET); attestation
#   --source-ref refs/tags/<etiket> ZORUNLU; bundle kimliği net.noktabilisim.destek; --no-attestation YOK. İkinci attestation dala göre
#   ZORUNLU: notarize -> "macos-notarized/v1" (teamId); ad-hoc -> "macos-adhoc/v1" ve TÜM attestation'larda bundleId, version (=etiket
#   öneksiz), file, signature=adhoc, notarized=false, executableSha256 (= zip içi ikili) eşleşir. Karıştırma yok: notarize zip'te
#   ad-hoc predicate, ad-hoc zip'te notarized predicate bulunmaz -> yanlış ortam değişkeni fail-closed.
# .env yazımı (S-r4-6/7): MAC_AGENT_SHA256 + MAC_AGENT_SIGNING TEK awk geçişi + tek `cat >` (atomik çift; .env.bak.mac.* ikisini
#   birlikte geri getirir). Hedef MAC_AGENT_SIGNING=notarized iken ad-hoc yayın RET (önce açık --withdraw; düşürme yapışkanlığı).
# Ortam kilidi (apply; hedef .env DEPLOY_ENV, fail-closed):
#   production  -> yalnız vX.Y.Z; compose projesi `remote` olmalı; PUBLIC_BASE_URL/SITE_HOST stg.* ise RET (S13C-1/15)
#   staging     -> stg-* / dir-* (TEST zip) ya da vX.Y.Z. Proje `remote` (tek yığın, §20.8) iken de TEST zip KABUL (Windows'tan
#                  farklı: zip yalnız MAC_AGENT_SHA256 eşleşirse sunulur; yanlış kurulmuş ikinci yığın S13C-15 ile durur)
#   development -> hepsi
#   boş/başka   -> RET
# Çıkış: 0 tamam · 1 doğrulama/yayın hatası · 2 kullanım hatası.
# İç modlar (sunucuda): --apply <deploy-dir> <sha256> <etiket> <dosya> <adhoc|notarized> · --apply-withdraw <deploy-dir>
set -euo pipefail
umask 077
REPO="${AGENT_REPO:-NoktaBilisim/Remote}"
WORKFLOW=".github/workflows/agent-win.yml"
NOTARIZED_PREDICATE="https://noktabilisim.net/attestation/macos-notarized/v1" # agent-win.yml MAC_NOTARIZED_PREDICATE ile aynı
ADHOC_PREDICATE="https://noktabilisim.net/attestation/macos-adhoc/v1"         # agent-win.yml MAC_ADHOC_PREDICATE ile aynı
PROD_BUNDLE=net.noktabilisim.destek
MAX_BYTES=62914560 # 60 MiB (AC-389)
ZIP=NoktaDestek-macOS.zip
APP="Nokta Destek.app"
STG_SERVER_URL=https://stg.remote.noktabilisim.net

die() { echo "HATA: $*" >&2; exit 1; }
usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d' >&2; exit 2; }
sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
fsize() { wc -c < "$1" | tr -d ' '; }
envval() { awk -F= -v k="$1" '$1 == k {sub(/^[^=]*=/, ""); v=$0} END {print v}' "$2" 2>/dev/null | tr -d '\r"'"'"; }

# ---------- sunucu tarafı ----------
lock() { # <dir> <etiket> — ortam kilidi; geçerse DEPLOY_ENV'i basar
  local dir="$1" label="$2" denv proj pub site
  [ -f "$dir/.env" ] && [ -f "$dir/docker-compose.yml" ] || die "$dir bir deploy klasörü değil (.env / docker-compose.yml yok)"
  denv="$(envval DEPLOY_ENV "$dir/.env")"
  proj="$(cd "$dir" && docker compose config --no-interpolate 2>/dev/null | sed -n '1s/^name: //p')" || proj=""
  [ -n "$proj" ] || die "compose proje adı çözülemedi ($dir: docker compose config)"
  if [ "$proj" = remote ]; then # S13C-15: proje remote + genel ad stg.* = yanlış kurulmuş ikinci yığın (prod volume'u)
    pub="$(envval PUBLIC_BASE_URL "$dir/.env")"; pub="${pub#*://}"; site="$(envval SITE_HOST "$dir/.env")"
    case "$pub" in stg.*) die "compose projesi 'remote' ama PUBLIC_BASE_URL staging (stg.*) — COMPOSE_PROJECT_NAME/COMPOSE_FILE eksik" ;; esac
    case "$site" in stg.*) die "compose projesi 'remote' ama SITE_HOST staging (stg.*) — COMPOSE_PROJECT_NAME/COMPOSE_FILE eksik" ;; esac
  fi
  case "$denv" in
    production)
      [ "$proj" = remote ] || die "DEPLOY_ENV=production ama compose projesi '$proj' (beklenen 'remote')"
      [[ "$label" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$|^withdraw$ ]] || die "DEPLOY_ENV=production hedefe yalnız attestation'lı Release (vX.Y.Z; notarize ya da ad-hoc) yayınlanır (bulunan: $label)" ;;
    staging)
      [[ "$label" =~ ^(stg-|dir-|withdraw$|v[0-9]+\.[0-9]+\.[0-9]+$) ]] || die "DEPLOY_ENV=staging hedefe yalnız stg-*/dir-* TEST zip'i ya da Release (bulunan: $label)" ;;
    development) ;;
    *) die "$dir/.env DEPLOY_ENV development|staging|production olmalı (bulunan: '$denv'); ortamı bilinmeyen hedefe yayın yapılmaz" ;;
  esac
  echo "$denv"
}

set_env_mac() { # <dir> <sha|boş> <adhoc|notarized|boş> <ts> — S-r4-7: iki anahtar tek geçişte, tek yazımda
  cp -p "$1/.env" "$1/.env.bak.mac.$4"
  awk -v v="$2" -v g="$3" 'BEGIN{d=0; e=0}
    /^MAC_AGENT_SHA256=/ {if(!d) print "MAC_AGENT_SHA256=" v; d=1; next}
    /^MAC_AGENT_SIGNING=/ {if(!e) print "MAC_AGENT_SIGNING=" g; e=1; next}
    {print}
    END{if(!d) print "MAC_AGENT_SHA256=" v; if(!e) print "MAC_AGENT_SIGNING=" g}' "$1/.env" > "$1/.env.tmp.$4"
  # K-r4-2: inode/kip korunur (cat >); yazım yarıda kalırsa yedekten geri yüklenir.
  if ! cat "$1/.env.tmp.$4" > "$1/.env"; then cat "$1/.env.bak.mac.$4" > "$1/.env"; rm -f "$1/.env.tmp.$4"; die ".env yazılamadı; yedekten geri yüklendi"; fi
  rm -f "$1/.env.tmp.$4"
  # shellcheck disable=SC2012  # adlar betiğin ürettiği .env.bak.mac.<UTC zaman>; mtime sırası gerekli
  ls -1t "$1"/.env.bak.mac.* 2>/dev/null | tail -n +6 | xargs -r rm -f
}

restart_server() {
  local dir="$1" _i
  (cd "$dir" && docker compose up -d --no-deps server)
  for _i in $(seq 1 30); do
    [ "$(cd "$dir" && docker compose ps server --format '{{.Health}}')" = healthy ] && return 0; sleep 2
  done
  die "server healthy olmadı (docker compose logs server)"
}

public_base() { # <dir> -> https://host[:port] ve host:port
  local base; base=$(envval PUBLIC_BASE_URL "$1/.env"); base=${base%/}
  [ -n "$base" ] || die "$1/.env içinde PUBLIC_BASE_URL yok"
  echo "$base"
}

apply() {
  local dir="$1" want="$2" label="$3" file="$4" signing="$5" ts cur
  [[ "$want" =~ ^[0-9a-f]{64}$ ]] || die "geçersiz sha256"
  [[ "$label" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || die "geçersiz etiket"
  case "$signing" in adhoc|notarized) ;; *) die "imza türü adhoc|notarized olmalı (bulunan: '$signing')" ;; esac
  [ "$(sha "$file")" = "$want" ] || die "aktarılan dosyanın SHA-256'sı beklenenden farklı"
  [ "$(head -c2 "$file")" = PK ] || die "zip değil"
  lock "$dir" "$label" >/dev/null
  # S-r4-6: notarize yayından ad-hoc'a sessiz düşüş yok — dosya/volume'a dokunmadan önce reddedilir; önce açık --withdraw.
  cur="$(envval MAC_AGENT_SIGNING "$dir/.env")"
  [ "$cur" != notarized ] || [ "$signing" = notarized ] \
    || die "hedefte notarize macOS yayını var (MAC_AGENT_SIGNING=notarized); ad-hoc yayından önce açık --withdraw gerekir"
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  if [ "${AGENT_PUBLISH_RESTART:-1}" = 1 ]; then
    local vol img stage
    vol="$(cd "$dir" && docker compose config --format json | sed -n 's/.*"name": *"\([^"]*agent_downloads\)".*/\1/p' | awk 'NR == 1')"
    [ -n "$vol" ] || die "agent_downloads volume adı compose'dan çözülemedi ($dir)"
    img="$(cd "$dir" && docker compose config --images | awk '/^caddy:/ && !n++')" && [ -n "$img" ] || die "caddy imajı bulunamadı"
    stage=$(dirname "$file")
    docker volume create "$vol" >/dev/null
    # Yardımcı konteyner: compose'daki sabit digest'li caddy imajı, ağsız; atomik yeniden adlandırma, 0644 (server/caddy okur).
    docker run --rm --network none -v "$vol:/dst" -v "$stage:/src:ro" "$img" sh -euc '
      cp /src/'"$ZIP"' /dst/.'"$ZIP"'.new && chmod 0644 /dst/.'"$ZIP"'.new
      [ "$(sha256sum /dst/.'"$ZIP"'.new | cut -d" " -f1)" = "$1" ] || { rm -f /dst/.'"$ZIP"'.new; exit 3; }
      mv -f /dst/.'"$ZIP"'.new /dst/'"$ZIP"'' sh "$want" || die "volume'a yazılamadı / kopya doğrulanamadı"
  else
    local dl="$dir/agent/downloads"; install -d -m 755 "$dl"
    install -m 644 "$file" "$dl/.$ZIP.new"; mv -f "$dl/.$ZIP.new" "$dl/$ZIP"
  fi
  set_env_mac "$dir" "$want" "$signing" "$ts"
  install -d -m 755 "$dir/agent"
  printf '%s %s %s %s %s\n' "$ts" mac "$label" "$want" "$signing" >> "$dir/agent/PUBLISHED.log"
  echo "yayınlandı: agent_downloads/$ZIP ($label, $want, $signing)"
  if [ "${AGENT_PUBLISH_RESTART:-1}" = 1 ]; then
    restart_server "$dir"
    # Caddy üzerinden dış yol (kodsuz ad; forward_auth /internal/agent-ready/macos MAC_AGENT_SHA256 ile). tls internal → -k,
    # bütünlük hash ile. Server yeni yaratıldığı için ilk denemeler 502 olabilir → yeniden dene; boş gövde sayılmaz.
    local base hp got="" tmp _i; base=$(public_base "$dir")
    hp=${base#https://}; hp=${hp%%/*}; case "$hp" in *:*) ;; *) hp="$hp:443" ;; esac
    tmp=$(mktemp)
    for _i in $(seq 1 10); do
      if curl -fsSk --max-time 60 --resolve "$hp:127.0.0.1" -o "$tmp" "$base/downloads/$ZIP"; then
        [ -s "$tmp" ] || { sleep 3; continue; }
        got=$(sha256sum "$tmp" | cut -d' ' -f1); [ "$got" = "$want" ] && break
      fi
      sleep 3
    done
    rm -f "$tmp"
    [ -n "$got" ] || die "Caddy'den indirilemedi (10 deneme; MAC_AGENT_SHA256 / dosya eşleşmesi: docker compose logs server | grep mac_agent_binary)"
    [ "$got" = "$want" ] || die "Caddy'nin sunduğu dosya farklı ($got)"
    echo "kontrol: <host>/downloads/$ZIP SHA-256 = MAC_AGENT_SHA256 = $want"
  fi
}

apply_withdraw() {
  local dir="$1" ts
  lock "$dir" withdraw >/dev/null
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  set_env_mac "$dir" "" "" "$ts"
  install -d -m 755 "$dir/agent"
  printf '%s %s %s %s %s\n' "$ts" mac withdraw - - >> "$dir/agent/PUBLISHED.log"
  echo "geri alındı: MAC_AGENT_SHA256 + MAC_AGENT_SIGNING boş (macOS indirmesi kapalı)"
  if [ "${AGENT_PUBLISH_RESTART:-1}" = 1 ]; then
    restart_server "$dir"
    local base hp code; base=$(public_base "$dir"); hp=${base#https://}; hp=${hp%%/*}; case "$hp" in *:*) ;; *) hp="$hp:443" ;; esac
    code=$(curl -sSk --max-time 30 --resolve "$hp:127.0.0.1" -o /dev/null -w '%{http_code}' "$base/downloads/$ZIP" || true)
    [ "$code" = 503 ] || die "geri almadan sonra /downloads/$ZIP $code döndü (beklenen 503)"
    echo "kontrol: /downloads/$ZIP 503 (kapı kapalı)"
  fi
}

if [ "${1:-}" = --apply ]; then [ $# -eq 6 ] || usage; apply "$2" "$3" "$4" "$5" "$6"; exit 0; fi
if [ "${1:-}" = --apply-withdraw ]; then [ $# -eq 2 ] || usage; apply_withdraw "$2"; exit 0; fi

# ---------- operatör tarafı ----------
TAG="" SRC_DIR="" STG_RUN="" SSH="" LOCAL=0 DRY=0 NOATT=0 DEPLOY_DIR="" WITHDRAW=0
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG="${2:?}"; shift 2 ;;
    --dir) SRC_DIR="${2:?}"; shift 2 ;;
    --stg-run) STG_RUN="${2:?}"; shift 2 ;;
    --withdraw) WITHDRAW=1; shift ;;
    --ssh) SSH="${2:?}"; shift 2 ;;
    --local) LOCAL=1; shift ;;
    --deploy-dir) DEPLOY_DIR="${2:?}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --no-attestation) NOATT=1; shift ;;
    -h|--help) usage ;;
    *) echo "bilinmeyen argüman: $1" >&2; usage ;;
  esac
done
n=0; for v in "$TAG" "$SRC_DIR" "$STG_RUN"; do [ -z "$v" ] || n=$((n + 1)); done
[ "$WITHDRAW" = 0 ] || n=$((n + 1))
[ "$n" = 1 ] || { echo "--tag, --stg-run, --dir veya --withdraw'dan tam biri verilmeli" >&2; usage; }
[ "$DRY" = 1 ] || [ -n "$SSH" ] || [ "$LOCAL" = 1 ] || { echo "--ssh <hedef>, --local veya --dry-run gerekli" >&2; usage; }
[ -z "$SSH" ] || [ "$LOCAL" = 0 ] || usage
[ "$NOATT" = 0 ] || [ -n "$SRC_DIR" ] || die "--no-attestation yalnız --dir ile (--tag/--stg-run attestation'sız kullanılmaz)"
[ "$NOATT" = 0 ] || [ "${ALLOW_UNATTESTED:-}" = staging ] || die "--no-attestation yalnız ALLOW_UNATTESTED=staging ile (prod'da yasak)"

if [ "$WITHDRAW" = 1 ]; then
  [ "$DRY" = 0 ] || { echo "--dry-run: geri alma yapılmadı"; exit 0; }
  if [ "$LOCAL" = 1 ]; then apply_withdraw "${DEPLOY_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"; exit 0; fi
  dir="${DEPLOY_DIR:-/opt/remote/deploy}"; rtmp=$(ssh "$SSH" 'mktemp -d /tmp/mac-publish.XXXXXX')
  scp -q "$0" "$SSH:$rtmp/"
  # shellcheck disable=SC2029  # bilerek istemcide açılır: dir operatörün verdiği yol, tırnaklı
  ssh "$SSH" "bash $rtmp/$(basename "$0") --apply-withdraw '$dir'; rc=\$?; rm -rf $rtmp; exit \$rc"
  exit 0
fi

WORK=$(mktemp -d "${TMPDIR:-/tmp}/mac-publish.XXXXXX"); trap 'rm -rf "$WORK"' EXIT
BUNDLE_WANT=net.noktabilisim.destek.stg
SIGNING=adhoc # --stg-run / --dir: TEST paketi her zaman ad-hoc
if [ -n "$TAG" ]; then
  [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "etiket vX.Y.Z olmalı"
  # K-P28f-r4-9: dal ortamdan deterministik; operatör bayrağı yok. Tanımlı ama bozuk Team ID ad-hoc'a DÜŞMEZ.
  if [ -n "${APPLE_TEAM_ID:-}" ]; then
    [[ "$APPLE_TEAM_ID" =~ ^[A-Z0-9]{10}$ ]] || die "APPLE_TEAM_ID 10 karakter A-Z0-9 olmalı (Team ID denetimi, S-P28f-7); ad-hoc yayın için değişkeni tanımsız bırakın"
    SIGNING=notarized
  fi
  rel="NoktaDestek-macOS-${TAG#v}.zip"
  [[ "$rel" =~ ^NoktaDestek-macOS-[0-9]+\.[0-9]+\.[0-9]+\.zip$ ]] || die "Release zip adı $rel"
  gh release download "$TAG" --repo "$REPO" -p "$rel" -p SHA256SUMS -D "$WORK" || die "Release $TAG'de $rel yok"
  SRC_NAME="$rel"; LABEL="$TAG"; SRC_REF="refs/tags/$TAG"; BUNDLE_WANT=$PROD_BUNDLE
  if [ "$SIGNING" = notarized ]; then echo "dal: notarized (APPLE_TEAM_ID=$APPLE_TEAM_ID)"; else echo "dal: adhoc (APPLE_TEAM_ID tanımsız)"; fi
elif [ -n "$STG_RUN" ]; then
  gh run download "$STG_RUN" --repo "$REPO" -n agent-mac-stg -D "$WORK"
  meta=$(gh run view "$STG_RUN" --repo "$REPO" --json headBranch,event,conclusion,workflowName --jq '[.headBranch,.event,.conclusion,.workflowName]|join(" ")')
  echo "run: $meta"
  read -r br ev concl wf <<<"$meta"
  [ "$ev" = workflow_dispatch ] && [ "$br" = main ] && [ "$wf" = agent-win ] || die "staging paketi yalnız main workflow_dispatch koşusundan (bulunan: $br/$ev/$wf)"
  [ "$concl" = success ] || die "koşu sonucu '$concl' (success değil)"
  [ "$(sed -n 1p "$WORK/build-meta.txt")" = "$STG_SERVER_URL" ] || die "build-meta sunucu adresi $STG_SERVER_URL değil"
  SRC_NAME=$(cd "$WORK" && find . -maxdepth 1 -name 'NoktaDestek-macOS-stg-*.zip' | sed 's#^\./##')
  ver="${SRC_NAME#NoktaDestek-macOS-stg-}"; LABEL="stg-run-$STG_RUN-v${ver%.zip}"; SRC_REF="refs/heads/main"
  DEPLOY_DIR="${DEPLOY_DIR:-/opt/remote-stg/deploy}"
else
  SRC_NAME=$(cd "$SRC_DIR" && find . -maxdepth 1 -name 'NoktaDestek-macOS-*.zip' | sed 's#^\./##')
  [ "$(printf '%s\n' "$SRC_NAME" | grep -c .)" = 1 ] || die "$SRC_DIR içinde tek NoktaDestek-macOS-*.zip yok"
  cp "$SRC_DIR/$SRC_NAME" "$SRC_DIR/SHA256SUMS" "$WORK/"
  LABEL="dir-$(date -u +%Y%m%d%H%M%S)"; SRC_REF=""
fi
# Ad deseni: Release'te -stg- RET; staging yollarında YALNIZ -stg- (TEST paketi).
if [ -n "$TAG" ]; then
  [[ "$SRC_NAME" =~ ^NoktaDestek-macOS-[0-9]+\.[0-9]+\.[0-9]+\.zip$ ]] || die "Release adı $SRC_NAME (-stg- kabul edilmez)"
else
  [[ "$SRC_NAME" =~ ^NoktaDestek-macOS-stg-[0-9]+\.[0-9]+\.[0-9]+\.zip$ ]] || die "staging zip adı NoktaDestek-macOS-stg-X.Y.Z.zip olmalı (bulunan: '$SRC_NAME')"
fi
f="$WORK/$SRC_NAME"
# 1) SHA256SUMS: tek satır
want=$(awk -v e="$SRC_NAME" '$2==e || $2=="*"e {print $1}' "$WORK/SHA256SUMS")
[ "$(printf '%s\n' "$want" | grep -c .)" -eq 1 ] && [[ "$want" =~ ^[0-9a-f]{64}$ ]] || die "SHA256SUMS'ta tek $SRC_NAME satırı yok"
got=$(sha "$f"); [ "$got" = "$want" ] || die "SHA-256 uyuşmuyor: SHA256SUMS=$want dosya=$got"
echo "SHA256SUMS: OK ($want)"
# 2) Zip yapısı: PK, ≤ 60 MiB, iki üst öğe, paket içi ikili + imza, yol kaçışı yok, bundle kimliği.
[ "$(head -c2 "$f")" = PK ] || die "zip değil"
[ "$(fsize "$f")" -le "$MAX_BYTES" ] || die "60 MiB'ı aşıyor (AC-389)"
list=$(unzip -Z1 "$f") || die "zip okunamadı"
if printf '%s\n' "$list" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then die "zip'te mutlak/üst dizin yolu"; fi
top=$(printf '%s\n' "$list" | cut -d/ -f1 | LC_ALL=C sort -u | tr '\n' '|')
[ "$top" = "$APP|OKUBENI.txt|" ] || die "zip üst öğeleri '$APP' + OKUBENI.txt değil ($top)"
for e in "$APP/Contents/MacOS/noktadestek" "$APP/Contents/Info.plist" "$APP/Contents/_CodeSignature/CodeResources"; do
  printf '%s\n' "$list" | grep -qxF "$e" || die "zip'te $e yok"
done
bid=$(unzip -p "$f" "$APP/Contents/Info.plist" | tr -d '\n\t' | sed -n 's#.*<key>CFBundleIdentifier</key> *<string>\([^<]*\)</string>.*#\1#p')
[ "$bid" = "$BUNDLE_WANT" ] || die "bundle kimliği '$bid' (beklenen $BUNDLE_WANT)"
echo "zip yapısı: OK ($bid, $(fsize "$f") B)"
inner=$(unzip -p "$f" "$APP/Contents/MacOS/noktadestek" | { command -v sha256sum >/dev/null && sha256sum || shasum -a 256; } | cut -d' ' -f1)
[[ "$inner" =~ ^[0-9a-f]{64}$ ]] || die "paket içi ikili SHA-256'sı hesaplanamadı"
# 3) Köken: build provenance (+ prod'da notarized predicate) — yalnız bu repo + agent-win.yml + GitHub barındırmalı runner.
if [ "$NOATT" = 1 ]; then
  echo "UYARI: attestation doğrulaması ATLANDI (ALLOW_UNATTESTED=staging). Köken kanıtı YOK (yerel dosya)." >&2
  LABEL="$LABEL-unattested"
else
  args=(attestation verify "$f" --repo "$REPO" --signer-workflow "$REPO/$WORKFLOW" --deny-self-hosted-runners)
  [ -z "$SRC_REF" ] || args+=(--source-ref "$SRC_REF")
  gh "${args[@]}" >/dev/null || die "gh attestation verify başarısız"
  echo "attestation: OK ($REPO/$WORKFLOW${SRC_REF:+ @ $SRC_REF})"
  if [ -n "$TAG" ] && [ "$SIGNING" = notarized ]; then
    team=$(gh "${args[@]}" --predicate-type "$NOTARIZED_PREDICATE" --format json --jq '.[0].verificationResult.statement.predicate.teamId') \
      || die "notarized predicate'li attestation yok (S-P28f-7) — Release ad-hoc olabilir: APPLE_TEAM_ID'yi tanımsız bırakın"
    [ "$team" = "$APPLE_TEAM_ID" ] || die "notarized attestation teamId '$team' ≠ APPLE_TEAM_ID"
    echo "notarized attestation: OK (Team $team)"
  elif [ -n "$TAG" ]; then
    # S-r4-5: her attestation tek satır; TÜMÜ beklenen satıra eşit olmalı (boş liste RET). notarized null/eksik -> "null" ≠ "false".
    pl=$(gh "${args[@]}" --predicate-type "$ADHOC_PREDICATE" --format json \
      --jq '.[] | .verificationResult.statement.predicate | [.bundleId, .version, .file, .signature, (.notarized|tostring), .executableSha256] | map(tostring) | join(" ")') \
      || die "ad-hoc predicate'li attestation yok — Release notarize olabilir: APPLE_TEAM_ID tanımlayın"
    exp="$PROD_BUNDLE ${TAG#v} $rel adhoc false $inner"
    n=$(printf '%s\n' "$pl" | grep -c . || true)
    [ "$n" -ge 1 ] || die "ad-hoc predicate'li attestation yok — Release notarize olabilir: APPLE_TEAM_ID tanımlayın"
    while IFS= read -r line; do
      [ "$line" = "$exp" ] || die "ad-hoc attestation alanları uyuşmuyor: '$line' (beklenen '$exp')"
    done <<<"$pl"
    echo "ad-hoc attestation: OK ($n adet; sürüm ${TAG#v}, paket içi ikili $inner)"
  fi
fi
# 4) macOS operatör makinesinde ek denetim: imza + Gatekeeper (Linux'ta atlanır, attestation bağlayıcıdır).
if [ "$(uname -s)" = Darwin ]; then
  x="$WORK/x"; mkdir "$x"; ditto -x -k "$f" "$x"
  codesign --verify --strict "$x/$APP" || die "codesign --verify başarısız"
  if [ "$SIGNING" = notarized ]; then
    codesign -dv "$x/$APP" 2>&1 | grep -x "TeamIdentifier=$APPLE_TEAM_ID" >/dev/null || die "TeamIdentifier $APPLE_TEAM_ID değil"
    spctl -a -vv -t exec "$x/$APP" 2>&1 | grep 'source=Notarized Developer ID' >/dev/null || die "spctl: Notarized Developer ID değil"
    echo "Gatekeeper: Notarized Developer ID (Team $APPLE_TEAM_ID)"
  else
    codesign -dv "$x/$APP" 2>&1 | grep -x 'Signature=adhoc' >/dev/null || die "paket ad-hoc imzalı değil (Signature=adhoc yok)"
    echo "imza: ad-hoc (Signature=adhoc)"
  fi
fi
echo "parmak izi (Hakkında, Contents/MacOS/noktadestek): ${inner:0:8}  etiket: $LABEL  imza: $SIGNING"
[ "$DRY" = 0 ] || { echo "--dry-run: yayınlanmadı"; exit 0; }

cp "$f" "$WORK/$ZIP"
if [ "$LOCAL" = 1 ]; then
  apply "${DEPLOY_DIR:-$(cd "$(dirname "$0")/.." && pwd)}" "$want" "$LABEL" "$WORK/$ZIP" "$SIGNING"
else
  dir="${DEPLOY_DIR:-/opt/remote/deploy}"
  rtmp=$(ssh "$SSH" 'mktemp -d /tmp/mac-publish.XXXXXX')
  scp -q "$WORK/$ZIP" "$0" "$SSH:$rtmp/"
  # shellcheck disable=SC2029  # bilerek istemcide açılır: want/LABEL regex ile, SIGNING sabit kümeden, dir operatörün verdiği yol, tırnaklı
  ssh "$SSH" "bash $rtmp/$(basename "$0") --apply '$dir' '$want' '$LABEL' $rtmp/$ZIP $SIGNING; rc=\$?; rm -rf $rtmp; exit \$rc"
fi
