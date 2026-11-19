#!/usr/bin/env bash
# P29 K6 (mimari-p29 §9.2, §9.5, §14.1 m.4/m.6, §14.7 T-12; ADR-0040; runbook §31): imzalı güncelleme manifestlerinin yayını.
# publish-linux.sh kalıbı: doğrulama operatör makinesinde (Ed25519 imza + kanonik biçim + alanlar [verify-manifest.mjs] +
# SHA256SUMS + gh attestation, kimlik sabit) ve SUNUCUDA yeniden (hedef .env UPDATE_MANIFEST_PUBKEYS ile imza, DEPLOY_ENV ↔ env,
# manifest sha256 = hedefte YAYIMLANMIŞ ikilinin *_SHA256'sı, sürüm düşmez). Hedef: compose `agent_downloads` volume'unun update/
# alt klasörü (server UPDATE_MANIFEST_DIR=/data/downloads/update salt okunur; Caddy `/downloads/*` 404 bu yolu public sunmaz).
# Server dosyayı ≤ 60 sn'de görür (stat önbelleği); yeniden başlatma gerekmez.
#
# Kullanım:
#   deploy/agent/publish-manifest.sh --tag v0.22.1 --ssh root@<sunucu>                 # Release -> prod (staging-önce kuralı §31.4!)
#   deploy/agent/publish-manifest.sh --stg-run <run-id> --ssh root@<sunucu>            # main dispatch artifact agent-update-stg
#       (hedef vars. /opt/remote-stg/deploy)
#   ALLOW_UNATTESTED=staging deploy/agent/publish-manifest.sh --dir <klasör> --no-attestation --env staging --local|--ssh …
#       # yerelde imzalanmış TEST manifesti (klasörde update-*.json + .sig); prod'a ASLA
#   deploy/agent/publish-manifest.sh --withdraw <client|service|all> --ssh root@<sunucu> [--deploy-dir …]
#       # acil durdurma (§9.5): bileşenin manifestleri volume'dan silinir -> istemci "yayın yok" (204 / update.none)
# Seçenekler: --only <client|service> (yalnız o bileşenin manifestleri), --deploy-dir <yol> (vars. /opt/remote/deploy; --stg-run'da
#   /opt/remote-stg/deploy; --local'de bu betiğin üst klasörü), --local, --dry-run (yalnız indir + doğrula),
#   --pubkeys-file <dosya> (operatör denetimi; vars. apps/agent-win/build/update-keys/<env>.pub).
# Ortam: AGENT_REPO (vars. NoktaBilisim/Remote), AGENT_PUBLISH_RESTART=0 (volume'a dokunma; test: $dir/agent/downloads/update/).
# Ortam kilidi (apply; hedef .env DEPLOY_ENV, fail-closed; publish-linux.sh ile aynı tablo + manifest env eşlemesi):
#   production  -> yalnız vX.Y.Z, manifest env=prod     staging -> stg-*/dir-*/vX.Y.Z, manifest env=staging
#   development -> hepsi (env prod|staging)              boş/başka -> RET
# Sunucu kapıları (biri tutmazsa HİÇBİR dosya yazılmaz): UPDATE_MANIFEST_PUBKEYS dolu; imza bu anahtarlardan biriyle; kalan
#   süre ≥ 1 gün; dosya adı = hedef; sha256 = .env AGENT_SHA256 (client windows) / MAC_AGENT_SHA256 / LINUX_AGENT_SHA256 /
#   UNATTENDED_AGENT_SHA256 (service) — İKİLİ ÖNCE yayınlanır (§31.4); volume'daki aynı hedefin sürümünden düşük olamaz.
# Çıkış: 0 tamam · 1 doğrulama/yayın hatası · 2 kullanım hatası.
# İç modlar (sunucuda): --apply <deploy-dir> <etiket> <aşama-klasörü> · --apply-withdraw <deploy-dir> <bileşen>
set -euo pipefail
umask 077
REPO="${AGENT_REPO:-NoktaBilisim/Remote}"
WORKFLOW=".github/workflows/agent-win.yml"
OIDC_ISSUER="https://token.actions.githubusercontent.com"
HERE="$(cd "$(dirname "$0")" && pwd)"
VERIFY="$HERE/verify-manifest.mjs"

die() { echo "HATA: $*" >&2; exit 1; }
usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d' >&2; exit 2; }
sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
envval() { awk -F= -v k="$1" '$1 == k {sub(/^[^=]*=/, ""); v=$0} END {print v}' "$2" 2>/dev/null | tr -d '\r"'"'"; }
NAME_RE='^update-(client-(windows-amd64|macos-universal|linux-amd64)|service-windows-amd64)\.json$'

# verify-manifest.mjs: host'ta node varsa onunla; yoksa (sunucu) compose'daki server imajının node'u, ağsız, salt okunur bağlarla.
vnode() { # <deploy-dir|""> <bağlanacak klasör> <argümanlar...> — dosya yolları klasöre göreli verilir
  local dir="$1" mdir="$2"; shift 2
  if command -v node >/dev/null 2>&1; then (cd "$mdir" && node "$VERIFY" "$@"); return; fi
  local img
  img="$(cd "$dir" && docker compose config --images | awk '/server/ && !n++')"
  [ -n "$img" ] || die "node yok ve server imajı compose'dan çözülemedi"
  docker run --rm --network none --read-only --entrypoint node -v "$VERIFY:/v/verify-manifest.mjs:ro" -v "$mdir:/m:ro" -w /m "$img" \
    /v/verify-manifest.mjs "$@"
}

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
      [[ "$label" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$|^withdraw$ ]] || die "DEPLOY_ENV=production hedefe yalnız Release (vX.Y.Z) manifesti yayınlanır (bulunan: $label)" ;;
    staging)
      [[ "$label" =~ ^(stg-|dir-|withdraw$|v[0-9]+\.[0-9]+\.[0-9]+$) ]] || die "DEPLOY_ENV=staging hedefe yalnız stg-*/dir-* ya da Release (bulunan: $label)" ;;
    development) ;;
    *) die "$dir/.env DEPLOY_ENV development|staging|production olmalı (bulunan: '$denv'); ortamı bilinmeyen hedefe yayın yapılmaz" ;;
  esac
  echo "$denv"
}

# Volume'daki (ya da test klasöründeki) update/ içeriğini okumak/yazmak için kök. RESTART=1: yardımcı konteyner.
vol_name() {
  (cd "$1" && docker compose config --format json | sed -n 's/.*"name": *"\([^"]*agent_downloads\)".*/\1/p' | awk 'NR == 1')
}
helper_img() { (cd "$1" && docker compose config --images | awk '/^caddy:/ && !n++'); }

sha_key() { # <bileşen-platform-mimari> -> .env anahtarı
  case "$1" in
    client-windows-amd64) echo AGENT_SHA256 ;;
    client-macos-universal) echo MAC_AGENT_SHA256 ;;
    client-linux-amd64) echo LINUX_AGENT_SHA256 ;;
    service-windows-amd64) echo UNATTENDED_AGENT_SHA256 ;;
    *) return 1 ;;
  esac
}
vgt() { # a > b (x.y.z sayısal)
  local -a a b; local i
  IFS=. read -r -a a <<<"$1"; IFS=. read -r -a b <<<"$2"
  for i in 0 1 2; do [ "${a[$i]}" -gt "${b[$i]}" ] && return 0; [ "${a[$i]}" -lt "${b[$i]}" ] && return 1; done; return 1
}

apply() {
  local dir="$1" label="$2" stage="$3" denv menv keys ts f n tgt k want got cur line ver files=()
  [[ "$label" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || die "geçersiz etiket"
  denv="$(lock "$dir" "$label")"
  case "$denv" in production) menv=prod ;; staging) menv=staging ;; *) menv="" ;; esac
  keys="$(envval UPDATE_MANIFEST_PUBKEYS "$dir/.env")"
  [ -n "$keys" ] || die "$dir/.env UPDATE_MANIFEST_PUBKEYS boş — önce ortamın açık anahtarlarını yazın ve server'ı yeniden yaratın (runbook §31.2)"
  for f in "$stage"/*; do
    n="$(basename "$f")"
    case "$n" in *.sig) [ -f "${f%.sig}" ] || die "eşsiz imza dosyası: $n"; continue ;; esac
    [[ "$n" =~ $NAME_RE ]] || die "beklenmeyen dosya: $n"
    files+=("$n")
  done
  [ "${#files[@]}" -gt 0 ] || die "aşama klasöründe manifest yok"
  if [ -z "$menv" ]; then menv="$(sed -n 's/.*"env":"\([a-z]*\)".*/\1/p' "$stage/${files[0]}")"; fi
  # 1) imza + kanonik + alanlar + ad + kalan süre (hedefin KENDİ anahtarlarıyla)
  vnode "$dir" "$stage" --pubkeys "$keys" --env "$menv" --expect-name --min-remaining-days 1 "${files[@]}" >"$stage/.verify.out" \
    || die "manifest doğrulaması başarısız (imza bu sunucunun UPDATE_MANIFEST_PUBKEYS anahtarlarıyla mı? ortam env=$menv mi?)"
  # 2) sha256 = hedefte yayımlanmış ikili; 3) sürüm düşmez
  local cur_dir=""
  if [ "${AGENT_PUBLISH_RESTART:-1}" = 1 ]; then
    local vol img; vol="$(vol_name "$dir")"; [ -n "$vol" ] || die "agent_downloads volume adı compose'dan çözülemedi ($dir)"
    img="$(helper_img "$dir")"; [ -n "$img" ] || die "caddy imajı bulunamadı"
    cur_dir="$(mktemp -d)"; chmod 0755 "$cur_dir"
    docker volume create "$vol" >/dev/null
    docker run --rm --network none -v "$vol:/src:ro" -v "$cur_dir:/dst" "$img" sh -c \
      'for f in /src/update/update-*.json; do [ -f "$f" ] && cp "$f" /dst/; done; true' || die "volume okunamadı"
  else
    cur_dir="$dir/agent/downloads/update"
  fi
  for n in "${files[@]}"; do
    tgt="${n#update-}"; tgt="${tgt%.json}"
    k="$(sha_key "$tgt")" || die "hedef $tgt"
    line="$(grep -F "\"file\":\"$n\"" "$stage/.verify.out")" || die "doğrulama çıktısında $n yok"
    got="$(sed -n 's/.*"sha256":"\([0-9a-f]\{64\}\)".*/\1/p' <<<"$line")"
    ver="$(sed -n 's/.*"version":"\([0-9.]*\)".*/\1/p' <<<"$line")"
    want="$(envval "$k" "$dir/.env" | tr 'A-F' 'a-f')"
    [ -n "$want" ] || die "$n: hedefte $k boş — önce ikiliyi yayınlayın (publish-*.sh; runbook §31.4)"
    [ "$got" = "$want" ] || die "$n: manifest sha256 ($got) hedefte yayımlanmış ikili değil ($k=$want) — önce aynı sürümün ikilisini yayınlayın"
    if [ -f "$cur_dir/$n" ]; then
      cur="$(sed -n 's/.*"version":"\([0-9.]*\)".*/\1/p' "$cur_dir/$n")"
      if [[ "$cur" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && vgt "$cur" "$ver"; then die "$n: yayındaki sürüm $cur > $ver (geri gidilmez; V-P29-7)"; fi
    fi
  done
  [ "${AGENT_PUBLISH_RESTART:-1}" = 0 ] || rm -rf "$cur_dir"
  # 4) atomik yaz: önce .sig, sonra .json (her biri .new -> mv)
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  if [ "${AGENT_PUBLISH_RESTART:-1}" = 1 ]; then
    docker run --rm --network none -v "$vol:/dst" -v "$stage:/src:ro" "$img" sh -euc '
      mkdir -p /dst/update && chmod 0755 /dst/update
      for n in "$@"; do
        for x in "$n.sig" "$n"; do cp "/src/$x" "/dst/update/.$x.new" && chmod 0644 "/dst/update/.$x.new"
          cmp "/src/$x" "/dst/update/.$x.new" && mv -f "/dst/update/.$x.new" "/dst/update/$x"; done
      done' sh "${files[@]}" || die "volume'a yazılamadı"
  else
    install -d -m 755 "$cur_dir"
    for n in "${files[@]}"; do
      for x in "$n.sig" "$n"; do install -m 644 "$stage/$x" "$cur_dir/.$x.new"; mv -f "$cur_dir/.$x.new" "$cur_dir/$x"; done
    done
  fi
  install -d -m 755 "$dir/agent"
  for n in "${files[@]}"; do
    line="$(grep -F "\"file\":\"$n\"" "$stage/.verify.out")"
    printf '%s %s %s %s %s\n' "$ts" manifest "$label" "$n" "$(sed -n 's/.*"version":"\([0-9.]*\)".*"expiresAt":"\([^"]*\)".*/\1 \2/p' <<<"$line")" \
      >> "$dir/agent/PUBLISHED.log"
    echo "yayınlandı: update/$n ($(sed -n 's/.*"version":"\([0-9.]*\)".*"daysLeft":\([0-9.]*\).*/v\1, kalan \2 g/p' <<<"$line"))"
  done
  if [ "${AGENT_PUBLISH_RESTART:-1}" = 1 ]; then
    # Kontrol (en çok 90 sn; server 60 sn'de bir stat eder): Windows istemci manifesti uçtan aynı bayt mı. Eski server (P29 öncesi) 404.
    local base hp code body _i want_b64; base="$(envval PUBLIC_BASE_URL "$dir/.env")"; base="${base%/}"
    if printf '%s\n' "${files[@]}" | grep -qx update-client-windows-amd64.json && [ -n "$base" ]; then
      hp=${base#https://}; hp=${hp%%/*}; case "$hp" in *:*) ;; *) hp="$hp:443" ;; esac
      want_b64="$(base64 < "$stage/update-client-windows-amd64.json" | tr -d '\n')"; body=$(mktemp)
      for _i in $(seq 1 18); do
        code=$(curl -sSk --max-time 20 --resolve "$hp:127.0.0.1" -o "$body" -w '%{http_code}' \
          "$base/api/v1/public/agent/update?platform=windows&arch=amd64&component=client" || true)
        [ "$code" = 200 ] && grep -qF "$want_b64" "$body" && break
        [ "$code" = 404 ] && break
        sleep 5
      done
      rm -f "$body"
      case "$code" in
        200) echo "kontrol: /api/v1/public/agent/update (windows client) yeni manifesti sunuyor" ;;
        404) echo "UYARI: güncelleme ucu yok (P29 öncesi server?) — manifest volume'da, server güncellenince sunulur" >&2 ;;
        *) die "server manifesti sunmuyor (son kod $code): docker compose logs server | grep -i manifest (imza/env/SHA kapısı)" ;;
      esac
    fi
  fi
}

apply_withdraw() {
  local dir="$1" comp="$2" ts pat
  case "$comp" in client) pat='update-client-*' ;; service) pat='update-service-*' ;; all) pat='update-*' ;; *) die "bileşen client|service|all" ;; esac
  lock "$dir" withdraw >/dev/null
  if [ "${AGENT_PUBLISH_RESTART:-1}" = 1 ]; then
    local vol img; vol="$(vol_name "$dir")"; [ -n "$vol" ] || die "agent_downloads volume adı çözülemedi"
    img="$(helper_img "$dir")"; [ -n "$img" ] || die "caddy imajı bulunamadı"
    docker run --rm --network none -v "$vol:/dst" "$img" sh -c 'rm -f /dst/update/'"$pat"'; ls /dst/update 2>/dev/null | grep -c . || true' >/dev/null \
      || die "volume'dan silinemedi"
  else
    # shellcheck disable=SC2086  # bilerek glob
    rm -f "$dir/agent/downloads/update/"$pat
  fi
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  install -d -m 755 "$dir/agent"
  printf '%s %s %s %s\n' "$ts" manifest withdraw "$comp" >> "$dir/agent/PUBLISHED.log"
  echo "geri çekildi: update/$pat (istemciler ≤ 60 sn içinde 'yayın yok' görür; ikililer yerinde)"
}

if [ "${1:-}" = --apply ]; then [ $# -eq 4 ] || usage; apply "$2" "$3" "$4"; exit 0; fi
if [ "${1:-}" = --apply-withdraw ]; then [ $# -eq 3 ] || usage; apply_withdraw "$2" "$3"; exit 0; fi

# ---------- operatör tarafı ----------
TAG="" SRC_DIR="" STG_RUN="" SSH="" LOCAL=0 DRY=0 NOATT=0 DEPLOY_DIR="" WITHDRAW="" ONLY="" ENVN="" PUBFILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG="${2:?}"; shift 2 ;;
    --dir) SRC_DIR="${2:?}"; shift 2 ;;
    --stg-run) STG_RUN="${2:?}"; shift 2 ;;
    --withdraw) WITHDRAW="${2:?}"; shift 2 ;;
    --only) ONLY="${2:?}"; shift 2 ;;
    --env) ENVN="${2:?}"; shift 2 ;;
    --pubkeys-file) PUBFILE="${2:?}"; shift 2 ;;
    --ssh) SSH="${2:?}"; shift 2 ;;
    --local) LOCAL=1; shift ;;
    --deploy-dir) DEPLOY_DIR="${2:?}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --no-attestation) NOATT=1; shift ;;
    -h|--help) usage ;;
    *) echo "bilinmeyen argüman: $1" >&2; usage ;;
  esac
done
n=0; for v in "$TAG" "$SRC_DIR" "$STG_RUN" "$WITHDRAW"; do [ -z "$v" ] || n=$((n + 1)); done
[ "$n" = 1 ] || { echo "--tag, --stg-run, --dir veya --withdraw'dan tam biri verilmeli" >&2; usage; }
[ "$DRY" = 1 ] || [ -n "$SSH" ] || [ "$LOCAL" = 1 ] || { echo "--ssh <hedef>, --local veya --dry-run gerekli" >&2; usage; }
[ -z "$SSH" ] || [ "$LOCAL" = 0 ] || usage
[ "$NOATT" = 0 ] || [ -n "$SRC_DIR" ] || die "--no-attestation yalnız --dir ile"
[ "$NOATT" = 0 ] || [ "${ALLOW_UNATTESTED:-}" = staging ] || die "--no-attestation yalnız ALLOW_UNATTESTED=staging ile (prod'da yasak)"
case "$ONLY" in ""|client|service) ;; *) die "--only client|service" ;; esac

remote() { # <iç mod argümanları...> — betik + verify-manifest.mjs (+ aşama klasörü) sunucuya kopyalanır
  local rtmp; rtmp=$(ssh "$SSH" 'mktemp -d /tmp/manifest-publish.XXXXXX')
  scp -q "$0" "$VERIFY" "$SSH:$rtmp/"
  if [ -n "${STAGE:-}" ]; then ssh "$SSH" "mkdir -m 700 $rtmp/stage"; scp -q "$STAGE"/* "$SSH:$rtmp/stage/"; fi
  local q="" a; for a in "$@"; do q="$q '${a//\'/}'"; done
  # shellcheck disable=SC2029  # bilerek istemcide açılır: argümanlar doğrulanmış, tek tırnaklı
  ssh "$SSH" "bash $rtmp/$(basename "$0") ${q//@STAGE@/$rtmp/stage}; rc=\$?; rm -rf $rtmp; exit \$rc"
}

if [ -n "$WITHDRAW" ]; then
  case "$WITHDRAW" in client|service|all) ;; *) die "--withdraw client|service|all" ;; esac
  [ "$DRY" = 0 ] || { echo "--dry-run: geri çekme yapılmadı"; exit 0; }
  if [ "$LOCAL" = 1 ]; then apply_withdraw "${DEPLOY_DIR:-$(cd "$HERE/.." && pwd)}" "$WITHDRAW"; exit 0; fi
  remote --apply-withdraw "${DEPLOY_DIR:-/opt/remote/deploy}" "$WITHDRAW"; exit 0
fi

WORK=$(mktemp -d "${TMPDIR:-/tmp}/manifest-publish.XXXXXX"); trap 'rm -rf "$WORK"' EXIT
mkdir -m 700 "$WORK/dl" "$WORK/stage"
if [ -n "$TAG" ]; then
  [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "etiket vX.Y.Z olmalı"
  gh release download "$TAG" --repo "$REPO" -p 'update-*.json' -p 'update-*.json.sig' -p SHA256SUMS -D "$WORK/dl" \
    || die "Release $TAG'de manifest yok (UPDATE_SIGNING_ENABLED kapalı mıydı? Release notu 'Güncelleme manifesti')"
  ENVN=prod; LABEL="$TAG"; SRC_REF="refs/tags/$TAG"
elif [ -n "$STG_RUN" ]; then
  [[ "$STG_RUN" =~ ^[0-9]+$ ]] || die "--stg-run sayısal koşu kimliği"
  gh run download "$STG_RUN" --repo "$REPO" -n agent-update-stg -D "$WORK/dl"
  meta=$(gh run view "$STG_RUN" --repo "$REPO" --json headBranch,event,conclusion,workflowName --jq '[.headBranch,.event,.conclusion,.workflowName]|join(" ")')
  read -r br ev concl wf <<<"$meta"
  [ "$ev" = workflow_dispatch ] && [ "$br" = main ] && [ "$wf" = agent-win ] || die "staging manifesti yalnız main workflow_dispatch koşusundan (bulunan: $br/$ev/$wf)"
  [ "$concl" = success ] || die "koşu sonucu '$concl' (success değil)"
  ENVN=staging; LABEL="stg-run-$STG_RUN"; SRC_REF="refs/heads/main"
  DEPLOY_DIR="${DEPLOY_DIR:-/opt/remote-stg/deploy}"
else
  [ -n "$ENVN" ] || die "--dir ile --env prod|staging gerekli"
  [ "$ENVN" = staging ] || [ "$NOATT" = 0 ] || die "attestation'sız yalnız staging"
  cp "$SRC_DIR"/update-*.json "$SRC_DIR"/update-*.json.sig "$WORK/dl/" 2>/dev/null || die "$SRC_DIR içinde update-*.json(.sig) yok"
  [ ! -f "$SRC_DIR/SHA256SUMS" ] || cp "$SRC_DIR/SHA256SUMS" "$WORK/dl/"
  LABEL="dir-$(date -u +%Y%m%d%H%M%S)"; SRC_REF=""
fi
case "$ENVN" in prod|staging) ;; *) die "--env prod|staging" ;; esac
PUBFILE="${PUBFILE:-$HERE/../../apps/agent-win/build/update-keys/$ENVN.pub}"
[ -f "$PUBFILE" ] || die "$PUBFILE yok (açık anahtar dosyası; runbook §31.2)"

files=()
for f in "$WORK/dl"/update-*.json; do
  [ -f "$f" ] || continue
  n="$(basename "$f")"
  [[ "$n" =~ $NAME_RE ]] || die "beklenmeyen dosya $n"
  case "$ONLY:$n" in client:update-service-*|service:update-client-*) continue ;; esac
  [ -f "$f.sig" ] || die "$n.sig yok"
  files+=("$n")
done
[ "${#files[@]}" -gt 0 ] || die "yayınlanacak manifest yok"
# 1) SHA256SUMS (Release'te zorunlu; staging artifact'inde de üretilir)
if [ -f "$WORK/dl/SHA256SUMS" ]; then
  for n in "${files[@]}"; do for x in "$n" "$n.sig"; do
    want=$(awk -v e="$x" '$2==e || $2=="*"e {print $1}' "$WORK/dl/SHA256SUMS")
    [ "$(printf '%s\n' "$want" | grep -c .)" -eq 1 ] || die "SHA256SUMS'ta tek $x satırı yok"
    [ "$(sha "$WORK/dl/$x")" = "$want" ] || die "$x SHA-256 SHA256SUMS ile uyuşmuyor"
  done; done
  echo "SHA256SUMS: OK"
elif [ -z "$SRC_DIR" ]; then die "SHA256SUMS yok"; fi
# 2) imza + kanonik + alanlar (repo açık anahtarlarıyla); Release'te sürüm = etiket
vargs=(--pubkeys-file "$PUBFILE" --env "$ENVN" --expect-name --min-remaining-days 1)
[ -z "$TAG" ] || vargs+=(--expect-version "${TAG#v}")
(cd "$WORK/dl" && node "$VERIFY" "${vargs[@]}" "${files[@]}") || die "manifest doğrulaması başarısız"
# 3) köken: attestation kimliği sabit (§14.7 T-12) — bu repo, agent-win.yml, GitHub OIDC, barındırmalı runner, kaynak ref
if [ "$NOATT" = 1 ]; then
  echo "UYARI: attestation doğrulaması ATLANDI (ALLOW_UNATTESTED=staging)." >&2; LABEL="$LABEL-unattested"
else
  for n in "${files[@]}"; do
    args=(attestation verify "$WORK/dl/$n" --repo "$REPO" --signer-workflow "$REPO/$WORKFLOW" --cert-oidc-issuer "$OIDC_ISSUER"
      --deny-self-hosted-runners)
    [ -z "$SRC_REF" ] || args+=(--source-ref "$SRC_REF")
    gh "${args[@]}" >/dev/null || die "gh attestation verify başarısız: $n"
  done
  echo "attestation: OK ($REPO/$WORKFLOW${SRC_REF:+ @ $SRC_REF})"
fi
for n in "${files[@]}"; do cp "$WORK/dl/$n" "$WORK/dl/$n.sig" "$WORK/stage/"; done
[ "$DRY" = 0 ] || { echo "--dry-run: yayınlanmadı (${files[*]})"; exit 0; }

STAGE="$WORK/stage"
if [ "$LOCAL" = 1 ]; then
  apply "${DEPLOY_DIR:-$(cd "$HERE/.." && pwd)}" "$LABEL" "$STAGE"
else
  remote --apply "${DEPLOY_DIR:-/opt/remote/deploy}" "$LABEL" @STAGE@
fi
