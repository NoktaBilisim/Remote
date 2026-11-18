#!/usr/bin/env bash
# P28g K8b (mimari-p28g §8.1, §8.2; AC-403; S-P28g-9/12): Linux istemci ELF'i yayını. publish-mac.sh kalıbı: doğrulama operatör
# makinesinde (SHA256SUMS + ELF başlığı + gömülü adres + gh attestation), sunucu bayt eşitliğini ve ELF/adres kurallarını yeniden
# denetler. Hedef: compose `agent_downloads` volume'unda SABİT ad NoktaDestek-linux (server LINUX_AGENT_PATH =
# /data/downloads/NoktaDestek-linux, Caddy agent_bin_file /srv/downloads/NoktaDestek-linux — aynı dosya) + deploy/.env
# LINUX_AGENT_SHA256 → server yeniden yaratılır → Caddy üzerinden /downloads/NoktaDestek-linux SHA + başlık kontrolü.
#
# Kullanım:
#   AGENT_SERVER_URL=https://<prod host> deploy/agent/publish-linux.sh --tag v0.20.0 --ssh root@<sunucu>   # Release -> prod
#   deploy/agent/publish-linux.sh --stg-run <run-id> --ssh root@<sunucu>     # main workflow_dispatch staging TEST ikilisi
#       (artifact agent-linux-stg; hedef vars. /opt/remote-stg/deploy)
#   ALLOW_UNATTESTED=staging deploy/agent/publish-linux.sh --dir <klasör> --no-attestation --ssh root@<sunucu> \
#       --deploy-dir /opt/remote/deploy   # yerelde build-linux.sh `test` kipiyle derlenmiş ikili (klasörde
#       NoktaDestek-linux-x86_64-stg-<sürüm> + SHA256SUMS); prod'a ASLA
#   deploy/agent/publish-linux.sh --withdraw --ssh root@<sunucu> [--deploy-dir …]   # geri alma: LINUX_AGENT_SHA256 boşaltılır →
#       Linux indirmesi görünmez (availability linux:false); dosya volume'da kalır ama sunulmaz (forward_auth 503)
# Seçenekler: --deploy-dir <yol> (vars. /opt/remote/deploy; --stg-run'da /opt/remote-stg/deploy; --local'de bu betiğin üst
#   klasörü), --local (yerel yığın), --dry-run (yalnız indir + doğrula).
# Ortam: AGENT_REPO (vars. NoktaBilisim/Remote), AGENT_SERVER_URL (--tag'de ZORUNLU: repo değişkeni AGENT_SERVER_URL ile aynı
#   prod adresi, https://host[:port]; ELF'te geçmeli), AGENT_PUBLISH_RESTART=0 (compose'a dokunma; test: $dir/agent/downloads/).
# Prod kuralları (S-P28g-9): --tag yalnız; ad ^NoktaDestek-linux-x86_64-X.Y.Z$ (-stg- RET); attestation --source-ref refs/tags/<etiket>
#   ve --signer-workflow agent-win.yml ZORUNLU (attestation iş akışı = etiket iş akışı); ELF'te AGENT_SERVER_URL VAR, staging adresi
#   (https://stg.remote.noktabilisim.net) ve https://….invalid adresi YOK; --no-attestation YOK. Sunucuda (DEPLOY_ENV=production) ayrıca ELF'te hedef
#   PUBLIC_BASE_URL (şemasıyla) geçmeli, staging adresi ve .invalid geçmemeli.
# Ortam kilidi (apply; hedef .env DEPLOY_ENV, fail-closed; publish-mac.sh ile aynı tablo):
#   production  -> yalnız vX.Y.Z; compose projesi `remote` olmalı; PUBLIC_BASE_URL/SITE_HOST stg.* ise RET (S13C-1/15)
#   staging     -> stg-* / dir-* (TEST ikilisi) ya da vX.Y.Z; ELF'te hedef PUBLIC_BASE_URL geçmeli (ikili bu sunucuya bağlanır)
#   development -> hepsi
#   boş/başka   -> RET
# Çıkış: 0 tamam · 1 doğrulama/yayın hatası · 2 kullanım hatası.
# İç modlar (sunucuda): --apply <deploy-dir> <sha256> <etiket> <dosya> · --apply-withdraw <deploy-dir>
set -euo pipefail
umask 077
REPO="${AGENT_REPO:-NoktaBilisim/Remote}"
WORKFLOW=".github/workflows/agent-win.yml"
MAX_BYTES=62914560 # 60 MiB (§8.2)
BIN=NoktaDestek-linux
STG_SERVER_URL=https://stg.remote.noktabilisim.net

die() { echo "HATA: $*" >&2; exit 1; }
usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d' >&2; exit 2; }
sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
fsize() { wc -c < "$1" | tr -d ' '; }
envval() { awk -F= -v k="$1" '$1 == k {sub(/^[^=]*=/, ""); v=$0} END {print v}' "$2" 2>/dev/null | tr -d '\r"'"'"; }
# ELF64 little-endian, x86-64 (e_machine 0x3e), ≤ 60 MiB, packer izi yok. readelf gerekmez (operatör macOS olabilir); NEEDED
# denetimi CI'da (check-linux-elf.sh, reproducible-linux) yapılır ve attestation o derlemeye bağlıdır.
elf_check() {
  local f="$1" hdr
  hdr="$(od -An -tx1 -N20 "$f" | tr -d ' \n')"
  case "$hdr" in 7f454c46020101*) ;; *) die "ELF64 little-endian değil" ;; esac
  [ "${hdr:36:4}" = 3e00 ] || die "x86-64 ELF değil (e_machine ${hdr:36:4})"
  [ "$(fsize "$f")" -le "$MAX_BYTES" ] || die "60 MiB'ı aşıyor"
  if LC_ALL=C grep -aqF 'UPX!' "$f"; then die "UPX/packer izi"; fi
}
has() { LC_ALL=C grep -aqF -- "$2" "$1"; }
# .invalid ADRES (https://<host>.invalid[:port]) — düz ".invalid" Go sembollerinde (http2…invalidate) geçer, yanlış pozitif verir.
has_invalid_url() { LC_ALL=C grep -aqE 'https://[A-Za-z0-9.-]+\.invalid([^A-Za-z0-9_-]|$)' "$1"; }

# ---------- sunucu tarafı ----------
lock() { # <dir> <etiket> — ortam kilidi; geçerse DEPLOY_ENV'i basar
  local dir="$1" label="$2" denv proj pub site
  [ -f "$dir/.env" ] && [ -f "$dir/docker-compose.yml" ] || die "$dir bir deploy klasörü değil (.env / docker-compose.yml yok)"
  denv="$(envval DEPLOY_ENV "$dir/.env")"
  proj="$(cd "$dir" && docker compose config --no-interpolate 2>/dev/null | sed -n '1s/^name: //p')" || proj=""
  [ -n "$proj" ] || die "compose proje adı çözülemedi ($dir: docker compose config)"
  if [ "$proj" = remote ]; then # S13C-15
    pub="$(envval PUBLIC_BASE_URL "$dir/.env")"; pub="${pub#*://}"; site="$(envval SITE_HOST "$dir/.env")"
    case "$pub" in stg.*) die "compose projesi 'remote' ama PUBLIC_BASE_URL staging (stg.*) — COMPOSE_PROJECT_NAME/COMPOSE_FILE eksik" ;; esac
    case "$site" in stg.*) die "compose projesi 'remote' ama SITE_HOST staging (stg.*) — COMPOSE_PROJECT_NAME/COMPOSE_FILE eksik" ;; esac
  fi
  case "$denv" in
    production)
      [ "$proj" = remote ] || die "DEPLOY_ENV=production ama compose projesi '$proj' (beklenen 'remote')"
      [[ "$label" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$|^withdraw$ ]] || die "DEPLOY_ENV=production hedefe yalnız Release (vX.Y.Z) yayınlanır (bulunan: $label)" ;;
    staging)
      [[ "$label" =~ ^(stg-|dir-|withdraw$|v[0-9]+\.[0-9]+\.[0-9]+$) ]] || die "DEPLOY_ENV=staging hedefe yalnız stg-*/dir-* TEST ikilisi ya da Release (bulunan: $label)" ;;
    development) ;;
    *) die "$dir/.env DEPLOY_ENV development|staging|production olmalı (bulunan: '$denv'); ortamı bilinmeyen hedefe yayın yapılmaz" ;;
  esac
  echo "$denv"
}

addr_check() { # <dir> <denv> <dosya> — ikili hedef sunucuya bağlanmalı (S-P28g-9)
  local dir="$1" denv="$2" f="$3" pub
  [ "$denv" != development ] || return 0
  pub="$(envval PUBLIC_BASE_URL "$dir/.env")"; pub="${pub%/}"
  [[ "$pub" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || die "$dir/.env PUBLIC_BASE_URL https://host[:port] değil ('$pub')"
  has "$f" "$pub" || die "ELF'te hedefin adresi ($pub) yok — ikili başka sunucuya bağlanır"
  if has_invalid_url "$f"; then die "ELF'te .invalid adres var (iz testi derlemesi yayınlanmaz)"; fi
  if [ "$denv" = production ] && has "$f" "$STG_SERVER_URL"; then die "prod hedefe staging adresli ELF"; fi
}

set_env_sha() { # <dir> <değer|boş> <ts>
  cp -p "$1/.env" "$1/.env.bak.linux.$3"
  awk -v v="$2" 'BEGIN{d=0} /^LINUX_AGENT_SHA256=/{print "LINUX_AGENT_SHA256=" v; d=1; next} {print} END{if(!d) print "LINUX_AGENT_SHA256=" v}' \
    "$1/.env" > "$1/.env.tmp.$3"
  cat "$1/.env.tmp.$3" > "$1/.env" && rm -f "$1/.env.tmp.$3"
  # shellcheck disable=SC2012  # adlar betiğin ürettiği .env.bak.linux.<UTC zaman>; mtime sırası gerekli
  ls -1t "$1"/.env.bak.linux.* 2>/dev/null | tail -n +6 | xargs -r rm -f
}

restart_server() {
  local dir="$1" _i
  (cd "$dir" && docker compose up -d --no-deps server)
  for _i in $(seq 1 30); do
    [ "$(cd "$dir" && docker compose ps server --format '{{.Health}}')" = healthy ] && return 0; sleep 2
  done
  die "server healthy olmadı (docker compose logs server)"
}

public_base() {
  local base; base=$(envval PUBLIC_BASE_URL "$1/.env"); base=${base%/}
  [ -n "$base" ] || die "$1/.env içinde PUBLIC_BASE_URL yok"
  echo "$base"
}

apply() {
  local dir="$1" want="$2" label="$3" file="$4" ts denv
  [[ "$want" =~ ^[0-9a-f]{64}$ ]] || die "geçersiz sha256"
  [[ "$label" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || die "geçersiz etiket"
  [ "$(sha "$file")" = "$want" ] || die "aktarılan dosyanın SHA-256'sı beklenenden farklı"
  elf_check "$file"
  denv="$(lock "$dir" "$label")"
  addr_check "$dir" "$denv" "$file"
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  if [ "${AGENT_PUBLISH_RESTART:-1}" = 1 ]; then
    local vol img stage
    vol="$(cd "$dir" && docker compose config --format json | sed -n 's/.*"name": *"\([^"]*agent_downloads\)".*/\1/p' | awk 'NR == 1')"
    [ -n "$vol" ] || die "agent_downloads volume adı compose'dan çözülemedi ($dir)"
    img="$(cd "$dir" && docker compose config --images | awk '/^caddy:/ && !n++')" && [ -n "$img" ] || die "caddy imajı bulunamadı"
    stage=$(dirname "$file")
    docker volume create "$vol" >/dev/null
    # Yardımcı konteyner: compose'daki sabit digest'li caddy imajı, ağsız; atomik yeniden adlandırma, 0644 (sunucuda çalıştırılmaz).
    docker run --rm --network none -v "$vol:/dst" -v "$stage:/src:ro" "$img" sh -euc '
      cp /src/'"$BIN"' /dst/.'"$BIN"'.new && chmod 0644 /dst/.'"$BIN"'.new
      [ "$(sha256sum /dst/.'"$BIN"'.new | cut -d" " -f1)" = "$1" ] || { rm -f /dst/.'"$BIN"'.new; exit 3; }
      mv -f /dst/.'"$BIN"'.new /dst/'"$BIN"'' sh "$want" || die "volume'a yazılamadı / kopya doğrulanamadı"
  else
    local dl="$dir/agent/downloads"; install -d -m 755 "$dl"
    install -m 644 "$file" "$dl/.$BIN.new"; mv -f "$dl/.$BIN.new" "$dl/$BIN"
  fi
  set_env_sha "$dir" "$want" "$ts"
  install -d -m 755 "$dir/agent"
  printf '%s %s %s %s\n' "$ts" linux "$label" "$want" >> "$dir/agent/PUBLISHED.log"
  echo "yayınlandı: agent_downloads/$BIN ($label, $want)"
  if [ "${AGENT_PUBLISH_RESTART:-1}" = 1 ]; then
    restart_server "$dir"
    # Caddy üzerinden kodsuz ad (forward_auth /internal/agent-ready/linux). tls internal → -k, bütünlük hash ile. Başlıklar da
    # denetlenir: Caddyfile güncel değilse (agent_bin_file yok) 404 / yanlış başlık burada yakalanır.
    local base hp got="" tmp hdr _i; base=$(public_base "$dir")
    hp=${base#https://}; hp=${hp%%/*}; case "$hp" in *:*) ;; *) hp="$hp:443" ;; esac
    tmp=$(mktemp); hdr=$(mktemp)
    for _i in $(seq 1 10); do
      if curl -fsSk --max-time 60 --resolve "$hp:127.0.0.1" -D "$hdr" -o "$tmp" "$base/downloads/$BIN"; then
        [ -s "$tmp" ] || { sleep 3; continue; }
        got=$(sha256sum "$tmp" | cut -d' ' -f1); [ "$got" = "$want" ] && break
      fi
      sleep 3
    done
    rm -f "$tmp"
    [ -n "$got" ] || { rm -f "$hdr"; die "Caddy'den indirilemedi (10 deneme; Caddyfile @agentLinux güncel mi? docker compose logs server | grep linux_agent)"; }
    [ "$got" = "$want" ] || { rm -f "$hdr"; die "Caddy'nin sunduğu dosya farklı ($got)"; }
    if tr -d '\r' < "$hdr" | grep -qi '^last-modified:'; then rm -f "$hdr"; die "Caddy Last-Modified gönderiyor (S-P28g-6; Caddyfile agent_bin_file güncel değil)"; fi
    tr -d '\r' < "$hdr" | grep -qi '^content-type: application/octet-stream$' || { rm -f "$hdr"; die "Content-Type application/octet-stream değil"; }
    rm -f "$hdr"
    echo "kontrol: <host>/downloads/$BIN SHA-256 = LINUX_AGENT_SHA256 = $want; octet-stream, Last-Modified yok"
  fi
}

apply_withdraw() {
  local dir="$1" ts
  lock "$dir" withdraw >/dev/null
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  set_env_sha "$dir" "" "$ts"
  install -d -m 755 "$dir/agent"
  printf '%s %s %s %s\n' "$ts" linux withdraw - >> "$dir/agent/PUBLISHED.log"
  echo "geri alındı: LINUX_AGENT_SHA256 boş (Linux indirmesi kapalı)"
  if [ "${AGENT_PUBLISH_RESTART:-1}" = 1 ]; then
    restart_server "$dir"
    local base hp code; base=$(public_base "$dir"); hp=${base#https://}; hp=${hp%%/*}; case "$hp" in *:*) ;; *) hp="$hp:443" ;; esac
    code=$(curl -sSk --max-time 30 --resolve "$hp:127.0.0.1" -o /dev/null -w '%{http_code}' "$base/downloads/$BIN" || true)
    [ "$code" = 503 ] || die "geri almadan sonra /downloads/$BIN $code döndü (beklenen 503)"
    echo "kontrol: /downloads/$BIN 503 (kapı kapalı)"
  fi
}

if [ "${1:-}" = --apply ]; then [ $# -eq 5 ] || usage; apply "$2" "$3" "$4" "$5"; exit 0; fi
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
  dir="${DEPLOY_DIR:-/opt/remote/deploy}"; rtmp=$(ssh "$SSH" 'mktemp -d /tmp/linux-publish.XXXXXX')
  scp -q "$0" "$SSH:$rtmp/"
  # shellcheck disable=SC2029  # bilerek istemcide açılır: dir operatörün verdiği yol, tırnaklı
  ssh "$SSH" "bash $rtmp/$(basename "$0") --apply-withdraw '$dir'; rc=\$?; rm -rf $rtmp; exit \$rc"
  exit 0
fi

WORK=$(mktemp -d "${TMPDIR:-/tmp}/linux-publish.XXXXXX"); trap 'rm -rf "$WORK"' EXIT
PROD_URL=""
if [ -n "$TAG" ]; then
  [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "etiket vX.Y.Z olmalı"
  PROD_URL="${AGENT_SERVER_URL:-}"; PROD_URL="${PROD_URL%/}"
  [[ "$PROD_URL" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || die "--tag için AGENT_SERVER_URL=https://<prod host>[:port] ortam değişkeni gerekli (S-P28g-9 adres denetimi)"
  case "$PROD_URL" in "$STG_SERVER_URL"|*.invalid|*.invalid:*) die "AGENT_SERVER_URL prod adresi değil ($PROD_URL)" ;; esac
  rel="NoktaDestek-linux-x86_64-${TAG#v}"
  gh release download "$TAG" --repo "$REPO" -p "$rel" -p SHA256SUMS -D "$WORK" || die "Release $TAG'de $rel yok"
  SRC_NAME="$rel"; LABEL="$TAG"; SRC_REF="refs/tags/$TAG"
elif [ -n "$STG_RUN" ]; then
  [[ "$STG_RUN" =~ ^[0-9]+$ ]] || die "--stg-run sayısal koşu kimliği"
  gh run download "$STG_RUN" --repo "$REPO" -n agent-linux-stg -D "$WORK"
  meta=$(gh run view "$STG_RUN" --repo "$REPO" --json headBranch,event,conclusion,workflowName --jq '[.headBranch,.event,.conclusion,.workflowName]|join(" ")')
  echo "run: $meta"
  read -r br ev concl wf <<<"$meta"
  [ "$ev" = workflow_dispatch ] && [ "$br" = main ] && [ "$wf" = agent-win ] || die "staging ikilisi yalnız main workflow_dispatch koşusundan (bulunan: $br/$ev/$wf)"
  [ "$concl" = success ] || die "koşu sonucu '$concl' (success değil)"
  [ "$(sed -n 1p "$WORK/build-meta.txt")" = "$STG_SERVER_URL" ] && [ "$(sed -n 3p "$WORK/build-meta.txt")" = test ] \
    || die "build-meta sunucu adresi $STG_SERVER_URL / kip test değil"
  SRC_NAME=$(cd "$WORK" && find . -maxdepth 1 -name 'NoktaDestek-linux-x86_64-stg-*' | sed 's#^\./##')
  LABEL="stg-run-$STG_RUN-v${SRC_NAME#NoktaDestek-linux-x86_64-stg-}"; SRC_REF="refs/heads/main"
  DEPLOY_DIR="${DEPLOY_DIR:-/opt/remote-stg/deploy}"
else
  SRC_NAME=$(cd "$SRC_DIR" && find . -maxdepth 1 -name 'NoktaDestek-linux-x86_64-*' | sed 's#^\./##')
  [ "$(printf '%s\n' "$SRC_NAME" | grep -c .)" = 1 ] || die "$SRC_DIR içinde tek NoktaDestek-linux-x86_64-* yok"
  cp "$SRC_DIR/$SRC_NAME" "$SRC_DIR/SHA256SUMS" "$WORK/"
  LABEL="dir-$(date -u +%Y%m%d%H%M%S)"; SRC_REF=""
fi
# Ad deseni: Release'te -stg- RET; staging yollarında YALNIZ -stg- (TEST ikilisi).
if [ -n "$TAG" ]; then
  [[ "$SRC_NAME" =~ ^NoktaDestek-linux-x86_64-[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Release adı $SRC_NAME (-stg- kabul edilmez)"
else
  [[ "$SRC_NAME" =~ ^NoktaDestek-linux-x86_64-stg-[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "staging ikili adı NoktaDestek-linux-x86_64-stg-X.Y.Z olmalı (bulunan: '$SRC_NAME')"
fi
f="$WORK/$SRC_NAME"
# 1) SHA256SUMS: tek satır
want=$(awk -v e="$SRC_NAME" '$2==e || $2=="*"e {print $1}' "$WORK/SHA256SUMS")
[ "$(printf '%s\n' "$want" | grep -c .)" -eq 1 ] && [[ "$want" =~ ^[0-9a-f]{64}$ ]] || die "SHA256SUMS'ta tek $SRC_NAME satırı yok"
got=$(sha "$f"); [ "$got" = "$want" ] || die "SHA-256 uyuşmuyor: SHA256SUMS=$want dosya=$got"
echo "SHA256SUMS: OK ($want)"
# 2) ELF + gömülü adres (S-P28g-9)
elf_check "$f"
if has_invalid_url "$f"; then die "ELF'te .invalid adres var (iz testi / PR derlemesi yayınlanmaz)"; fi
if [ -n "$TAG" ]; then
  has "$f" "$PROD_URL" || die "ELF'te prod adresi ($PROD_URL) yok"
  if has "$f" "$STG_SERVER_URL"; then die "Release ELF'inde staging adresi var"; fi
fi
echo "ELF: OK (x86-64, $(fsize "$f") B${PROD_URL:+, adres $PROD_URL})"
# 3) Köken: build provenance — yalnız bu repo + agent-win.yml + GitHub barındırmalı runner; prod'da etiket ref'i zorunlu.
if [ "$NOATT" = 1 ]; then
  echo "UYARI: attestation doğrulaması ATLANDI (ALLOW_UNATTESTED=staging). Köken kanıtı YOK (yerel dosya)." >&2
  LABEL="$LABEL-unattested"
else
  args=(attestation verify "$f" --repo "$REPO" --signer-workflow "$REPO/$WORKFLOW" --deny-self-hosted-runners)
  [ -z "$SRC_REF" ] || args+=(--source-ref "$SRC_REF")
  gh "${args[@]}" >/dev/null || die "gh attestation verify başarısız"
  echo "attestation: OK ($REPO/$WORKFLOW${SRC_REF:+ @ $SRC_REF})"
fi
echo "parmak izi (Hakkında): ${want:0:8}  etiket: $LABEL"
[ "$DRY" = 0 ] || { echo "--dry-run: yayınlanmadı"; exit 0; }

cp "$f" "$WORK/$BIN"
if [ "$LOCAL" = 1 ]; then
  apply "${DEPLOY_DIR:-$(cd "$(dirname "$0")/.." && pwd)}" "$want" "$LABEL" "$WORK/$BIN"
else
  dir="${DEPLOY_DIR:-/opt/remote/deploy}"
  rtmp=$(ssh "$SSH" 'mktemp -d /tmp/linux-publish.XXXXXX')
  scp -q "$WORK/$BIN" "$0" "$SSH:$rtmp/"
  # shellcheck disable=SC2029  # bilerek istemcide açılır: want/LABEL regex ile doğrulanmış, dir operatörün verdiği yol, tırnaklı
  ssh "$SSH" "bash $rtmp/$(basename "$0") --apply '$dir' '$want' '$LABEL' $rtmp/$BIN; rc=\$?; rm -rf $rtmp; exit \$rc"
fi
