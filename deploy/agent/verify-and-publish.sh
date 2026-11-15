#!/usr/bin/env bash
# İstemci yayını (P6, ADR-0010, G-07, AC-96/128): indir → SHA256SUMS → gh attestation verify → sunucudaki
# deploy/agent/downloads/NoktaDestek.exe + deploy/.env AGENT_SHA256 → server/caddy güncelle → dış hash kontrolü.
# Doğrulama sunucudan BAĞIMSIZ makinede (gh oturumu açık operatör makinesi) yapılır; sunucu yalnız bayt
# eşitliğini yeniden kontrol eder (ele geçirilmiş sunucu kendi doğrulamasını atlayabilir — G-07).
#
# Kullanım (repo kökünden veya herhangi bir yerden):
#   deploy/agent/verify-and-publish.sh --tag v0.6.0 --ssh root@185.126.217.99      # Release -> YALNIZ prod
#   deploy/agent/verify-and-publish.sh --stg-run <run-id> --ssh root@185.126.217.99 # P13c staging exe (workflow_dispatch
#       server_url=https://stg.remote.noktabilisim.net, main, artifact agent-win-stg); hedef vars. /opt/remote-stg/deploy
#   deploy/agent/verify-and-publish.sh --run <run-id> --local                     # main push artifact'i -> YALNIZ yerel
#   deploy/agent/verify-and-publish.sh --dir <klasör> --local                     # indirilmiş exe+SHA256SUMS -> yerel
#       (--dir staging hedefe de yazılabilir: elle derlenmiş staging adresli exe; prod'a ASLA)
# Seçenekler:
#   --deploy-dir <yol>   hedefteki deploy klasörü (varsayılan /opt/remote/deploy, --stg-run'da /opt/remote-stg/deploy;
#                        --local'de bu betiğin üst klasörü)
#   --dry-run            yalnız indir + doğrula, yayınlama
#   --allow-failed-run   (--run) sonucu success olmayan koşunun artifact'ini yine de yayınla. Varsayılan: REDDEDİLİR
#                        (S6-5). Yalnız yerel (DEPLOY_ENV=development) hedef; etiket `-failedrun` ekiyle PUBLISHED.log'a.
#   --no-attestation     attestation doğrulamasını atla (--run/--dir; --tag/--stg-run ile değil). Prod'da KULLANILMAZ
#                        (runbook §11.6). ALLOW_UNATTESTED=staging ortam değişkeni de verilmelidir (adı tarihseldir; hedef
#                        kilidi ayrıca uygulanır: --run yalnız yerel, --dir yerel/staging). --dir ile birlikte kökeni
#                        kanıtsız yerel dosya demektir (S6-5).
# Ortam: AGENT_REPO (varsayılan NoktaBilisim/Remote), AGENT_PUBLISH_RESTART=0 (compose'a dokunma; test için).
# Çıkış: 0 tamam · 1 doğrulama/yayın hatası · 2 kullanım hatası.
# İç mod (sunucuda, betiğin kendisi ssh ile gönderilir): --apply <deploy-dir> <sha256> <etiket> <dosya>
# Ortam kilidi (P13c, apply; hedef .env DEPLOY_ENV, fail-closed):
#   production  -> yalnız Release etiketi vX.Y.Z (--tag)
#   staging     -> yalnız stg-* (--stg-run) ya da dir-* (--dir); Release/main push exe'sinde prod adresi gömülü olduğundan RET
#   development -> stg-* dışında hepsi (--run, --dir, --tag; yerel prova)
#   boş/başka   -> RET (DEPLOY_ENV development|staging|production olmalı)
#   Ayrıca (S13C-1) hedefin compose proje adı: production = `remote`, staging ≠ `remote`; uyuşmazsa RET. Tek istisna
#   (S13C-13) tek yığın staging (proje remote; §20 terfisi öncesi sunucu, §20.8 geri dönüşü): bayraksız, yalnız vX.Y.Z.
set -euo pipefail
umask 077
REPO="${AGENT_REPO:-NoktaBilisim/Remote}"
WORKFLOW=".github/workflows/agent-win.yml"
MAX_BYTES=41943040
EXE=NoktaDestek.exe
STG_SERVER_URL=https://stg.remote.noktabilisim.net

die() { echo "HATA: $*" >&2; exit 1; }
usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d' >&2; exit 2; }
sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
fsize() { wc -c < "$1" | tr -d ' '; }

# ---------- sunucu tarafı ----------
apply() {
  local dir="$1" want="$2" label="$3" file="$4"
  [[ "$want" =~ ^[0-9a-f]{64}$ ]] || die "geçersiz sha256"
  [[ "$label" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || die "geçersiz etiket"
  [ -f "$dir/.env" ] && [ -f "$dir/docker-compose.yml" ] || die "$dir bir deploy klasörü değil (.env / docker-compose.yml yok)"
  [ "$(sha "$file")" = "$want" ] || die "aktarılan dosyanın SHA-256'sı beklenenden farklı"
  # S13C-3: deploy/backup/lib.sh deploy_env_of ile aynı ayrıştırma (betik sunucuya tek başına gider, lib.sh kaynaklanamaz).
  local denv proj
  denv="$(awk -F= '$1 == "DEPLOY_ENV" {sub(/^[^=]*=/, ""); v=$0} END {print v}' "$dir/.env" 2>/dev/null || true)"
  denv="${denv%$'\r'}"; denv="${denv#\"}"; denv="${denv%\"}"; denv="${denv#\'}"; denv="${denv%\'}"
  # S13C-1: çözülen compose proje adı ortamla eşleşmeli (prod = remote; staging remote OLAMAZ -> prod volume'una yazılmaz).
  proj="$(cd "$dir" && docker compose config --no-interpolate 2>/dev/null | sed -n '1s/^name: //p')" || proj=""
  [ -n "$proj" ] || die "compose proje adı çözülemedi ($dir: docker compose config)"
  # S13C-15: proje remote iken genel ad staging ise (stg.*) yığın yanlış kurulmuş: prod volume'una yazılmaz. Sırsız: yalnız
  # PUBLIC_BASE_URL ve SITE_HOST satırları okunur (lib.sh stg_name_guard ile aynı kural).
  if [ "$proj" = remote ]; then
    local pub site
    pub="$(awk -F= '$1 == "PUBLIC_BASE_URL" {sub(/^[^=]*=/, ""); v=$0} END {print v}' "$dir/.env")"
    site="$(awk -F= '$1 == "SITE_HOST" {sub(/^[^=]*=/, ""); v=$0} END {print v}' "$dir/.env")"
    pub="${pub%$'\r'}"; pub="${pub#[\"\']}"; pub="${pub#*://}"; site="${site%$'\r'}"; site="${site#[\"\']}"
    case "$pub" in stg.*) die "compose projesi 'remote' ama PUBLIC_BASE_URL staging (stg.*) — COMPOSE_PROJECT_NAME/COMPOSE_FILE eksik" ;; esac
    case "$site" in stg.*) die "compose projesi 'remote' ama SITE_HOST staging (stg.*) — COMPOSE_PROJECT_NAME/COMPOSE_FILE eksik" ;; esac
  fi
  case "$denv" in
    production)
      [ "$proj" = remote ] || die "DEPLOY_ENV=production ama compose projesi '$proj' (beklenen 'remote')"
      [[ "$label" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "DEPLOY_ENV=production hedefe yalnız Release etiketi (vX.Y.Z) yayınlanır (bulunan: $label)" ;;
    staging)
      if [ "$proj" = remote ]; then
        # S13C-13: tek yığın staging (§20 terfisi öncesi sunucu ve §20.8 geri dönüşü; proje remote, ad remote.noktabilisim.net)
        # bayraksız devam eder ama YALNIZ Release (vX.Y.Z; attestation'lı, gömülü ad bu sunucu). run-*/stg-*/dir-* RET:
        # yanlış kurulmuş ikinci yığın prod volume'una staging/main exe'si yazamaz.
        [[ "$label" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] \
          || die "DEPLOY_ENV=staging ama compose projesi 'remote' (tek yığın: yalnız Release vX.Y.Z; ikinci yığınsa COMPOSE_PROJECT_NAME/COMPOSE_FILE eksik)"
        echo "UYARI: tek yığın staging (proje remote; runbook §20.8) — yalnız Release $label" >&2
        denv=legacy-staging
      fi
      [ "$denv" = legacy-staging ] || case "$label" in stg-*|dir-*) ;; *) die "DEPLOY_ENV=staging hedefe yalnız --stg-run (ya da --dir) exe'si yayınlanır (bulunan: $label)" ;; esac ;;
    development)
      case "$label" in stg-*) die "staging exe ($label) yalnız DEPLOY_ENV=staging hedefe yayınlanır (bulunan: 'development')" ;; esac ;;
    *) die "$dir/.env DEPLOY_ENV development|staging|production olmalı (bulunan: '${denv}'); ortamı bilinmeyen hedefe yayın yapılmaz" ;;
  esac
  local ts; ts=$(date -u +%Y%m%dT%H%M%SZ)
  # 1) Volume'a yaz (compose `agent_downloads` → remote_agent_downloads; server/caddy salt okunur bağlar).
  #    Yardımcı konteyner: compose'daki sabit digest'li caddy imajı (sh/cp/sha256sum var), ağsız.
  if [ "${AGENT_PUBLISH_RESTART:-1}" = 1 ]; then
    local vol img stage
    vol="$(cd "$dir" && docker compose config --format json | sed -n 's/.*"name": *"\([^"]*agent_downloads\)".*/\1/p' | awk 'NR == 1')"
    # P13c: sabit ad yedeği YOK (staging dizininden prod volume'una yazılmasın); çözülemezse dur.
    [ -n "$vol" ] || die "agent_downloads volume adı compose'dan çözülemedi ($dir)"
    img="$(cd "$dir" && docker compose config --images | awk '/^caddy:/ && !n++')" && [ -n "$img" ] || die "caddy imajı bulunamadı"
    stage=$(dirname "$file")
    docker volume create "$vol" >/dev/null
    docker run --rm --network none -v "$vol:/dst" -v "$stage:/src:ro" "$img" sh -euc '
      cp /src/'"$EXE"' /dst/.'"$EXE"'.new && chmod 0644 /dst/.'"$EXE"'.new
      [ "$(sha256sum /dst/.'"$EXE"'.new | cut -d" " -f1)" = "$1" ] || { rm -f /dst/.'"$EXE"'.new; exit 3; }
      mv -f /dst/.'"$EXE"'.new /dst/'"$EXE"'' sh "$want" || die "volume'a yazılamadı / kopya doğrulanamadı"
  else
    # Test modu: compose'a dokunmadan $dir/agent/downloads klasörüne yazar.
    local dl="$dir/agent/downloads"; install -d -m 755 "$dl"
    install -m 644 "$file" "$dl/.$EXE.new"; mv -f "$dl/.$EXE.new" "$dl/$EXE"
  fi
  # 2) .env: AGENT_SHA256 satırını değiştir/ekle (diğer satırlara dokunulmaz; dosya izni korunur)
  cp -p "$dir/.env" "$dir/.env.bak.agent.$ts"
  awk -v v="$want" 'BEGIN{d=0} /^AGENT_SHA256=/{print "AGENT_SHA256=" v; d=1; next} {print} END{if(!d) print "AGENT_SHA256=" v}' \
    "$dir/.env" > "$dir/.env.tmp.$ts"
  cat "$dir/.env.tmp.$ts" > "$dir/.env" && rm -f "$dir/.env.tmp.$ts"
  install -d -m 755 "$dir/agent"
  printf '%s %s %s\n' "$ts" "$label" "$want" >> "$dir/agent/PUBLISHED.log"
  echo "yayınlandı: agent_downloads/$EXE ($label, $want)"
  if [ "${AGENT_PUBLISH_RESTART:-1}" = 1 ]; then
    (cd "$dir" && docker compose up -d --no-deps server)
    local _i; for _i in $(seq 1 30); do
      [ "$(cd "$dir" && docker compose ps server --format '{{.Health}}')" = healthy ] && break; sleep 2
    done
    [ "$(cd "$dir" && docker compose ps server --format '{{.Health}}')" = healthy ] || die "server healthy olmadı (docker compose logs server)"
    # Caddy üzerinden dış yol (127.0.0.1:4450; tls internal → -k, bütünlük hash ile karşılaştırılır)
    # Server yeniden yaratıldıktan hemen sonra Caddy forward_auth birkaç saniye 502 verebilir → yeniden dene.
    # Boru (curl | sha256sum) curl hatasını yutar ve boş gövdenin hash'ini üretir; bu yüzden geçici dosyaya indirilir.
    # Caddy siteyi PUBLIC_BASE_URL host'uyla eşler; Host: 127.0.0.1 isteği boş 200 döner → --resolve ile doğru Host.
    local base hp; base=$(sed -n 's/^PUBLIC_BASE_URL=//p' "$dir/.env" | tr -d '"' | tail -n1); base=${base%/}
    [ -n "$base" ] || die "$dir/.env içinde PUBLIC_BASE_URL yok"
    hp=${base#https://}; hp=${hp%%/*}; case "$hp" in *:*) ;; *) hp="$hp:443" ;; esac
    local got="" tmp; tmp=$(mktemp)
    for _i in $(seq 1 10); do
      if curl -fsSk --max-time 60 --resolve "$hp:127.0.0.1" -o "$tmp" "$base/downloads/$EXE"; then
        [ -s "$tmp" ] || { sleep 3; continue; }
        got=$(sha256sum "$tmp" | cut -d' ' -f1); [ "$got" = "$want" ] && break
      fi
      sleep 3
    done
    rm -f "$tmp"
    [ -n "$got" ] || die "Caddy'den indirilemedi (10 deneme)"
    [ "$got" = "$want" ] || die "Caddy'nin sunduğu dosya farklı ($got)"
    echo "kontrol: https://<host>:4450/downloads/$EXE SHA-256 = $want"
  fi
  # shellcheck disable=SC2012  # adlar betiğin ürettiği .env.bak.agent.<UTC zaman> (boşluk yok); mtime sırası gerekli
  ls -1t "$dir"/.env.bak.agent.* 2>/dev/null | tail -n +6 | xargs -r rm -f   # son 5 .env yedeği kalır
}

if [ "${1:-}" = --apply ]; then [ $# -eq 5 ] || usage; apply "$2" "$3" "$4" "$5"; exit 0; fi

# ---------- operatör tarafı ----------
TAG="" RUN="" STG_RUN="" SRC_DIR="" SSH="" LOCAL=0 DRY=0 NOATT=0 DEPLOY_DIR="" ALLOW_FAILED=0
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG="${2:?}"; shift 2 ;;
    --run) RUN="${2:?}"; shift 2 ;;
    --stg-run) STG_RUN="${2:?}"; shift 2 ;;
    --dir) SRC_DIR="${2:?}"; shift 2 ;;
    --ssh) SSH="${2:?}"; shift 2 ;;
    --local) LOCAL=1; shift ;;
    --deploy-dir) DEPLOY_DIR="${2:?}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --no-attestation) NOATT=1; shift ;;
    --allow-failed-run) ALLOW_FAILED=1; shift ;;
    -h|--help) usage ;;
    *) echo "bilinmeyen argüman: $1" >&2; usage ;;
  esac
done
n=0; for x in "$TAG" "$RUN" "$STG_RUN" "$SRC_DIR"; do [ -n "$x" ] && n=$((n+1)); done
[ "$n" -eq 1 ] || { echo "--tag, --run, --stg-run veya --dir'den tam biri verilmeli" >&2; usage; }
[ -z "$STG_RUN" ] || [[ "$STG_RUN" =~ ^[0-9]+$ ]] || die "run-id sayı olmalı"
[ -z "$STG_RUN" ] || [ "$NOATT" = 0 ] || die "--stg-run attestation'sız kullanılmaz"
[ "$DRY" = 1 ] || [ -n "$SSH" ] || [ "$LOCAL" = 1 ] || { echo "--ssh <hedef>, --local veya --dry-run gerekli" >&2; usage; }
[ -z "$SSH" ] || [ "$LOCAL" = 0 ] || usage
[ -z "$TAG" ] || [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "etiket vX.Y.Z olmalı"
[ -z "$RUN" ] || [[ "$RUN" =~ ^[0-9]+$ ]] || die "run-id sayı olmalı"
if [ "$NOATT" = 1 ] && [ "${ALLOW_UNATTESTED:-}" != staging ]; then
  if [ -n "$SRC_DIR" ]; then die "--dir + --no-attestation: kökeni kanıtsız dosya; yalnız açık ALLOW_UNATTESTED=staging ile (prod'da yasak)"; fi
  die "--no-attestation yalnız ALLOW_UNATTESTED=staging ile (prod'da yasak)"
fi
[ "$ALLOW_FAILED" = 0 ] || [ -n "$RUN" ] || die "--allow-failed-run yalnız --run ile"

WORK=$(mktemp -d "${TMPDIR:-/tmp}/agent-publish.XXXXXX"); trap 'rm -rf "$WORK"' EXIT
if [ -n "$TAG" ]; then
  gh release download "$TAG" --repo "$REPO" -p "$EXE" -p SHA256SUMS -D "$WORK"; LABEL="$TAG"; SRC_REF="refs/tags/$TAG"
elif [ -n "$RUN" ]; then
  gh run download "$RUN" --repo "$REPO" -n agent-win -D "$WORK"
  head_branch=$(gh run view "$RUN" --repo "$REPO" --json headBranch,event,conclusion,workflowName --jq '[.headBranch,.event,.conclusion,.workflowName]|join(" ")')
  echo "run: $head_branch"
  read -r br ev concl _ <<<"$head_branch"
  [ "$ev" = push ] && [ "$br" = main ] || die "yalnız main push koşularının artifact'i yayınlanır (bulunan: $br/$ev)"
  LABEL="run-$RUN"; SRC_REF="refs/heads/main"
  if [ "$concl" != success ]; then
    # S6-5: kırmızı (veya bitmemiş) koşu varsayılan olarak yayınlanmaz.
    [ "$ALLOW_FAILED" = 1 ] || die "koşu sonucu '$concl' (success değil); yayınlanmadı. Yalnız staging için bilerek: --allow-failed-run"
    echo "UYARI: koşu sonucu '$concl'; --allow-failed-run ile devam (yalnız staging, PUBLISHED.log'a '-failedrun' notu)" >&2
    LABEL="$LABEL-failedrun"
  fi
elif [ -n "$STG_RUN" ]; then
  # P13c (mimari-e11 §3.3, runbook §21): yalnız main dalında elle tetiklenmiş, başarılı, staging adresli derleme.
  gh run download "$STG_RUN" --repo "$REPO" -n agent-win-stg -D "$WORK/stg"
  meta=$(gh run view "$STG_RUN" --repo "$REPO" --json headBranch,event,conclusion,workflowName --jq '[.headBranch,.event,.conclusion,.workflowName]|join(" ")')
  echo "run: $meta"
  read -r br ev concl wf <<<"$meta"
  [ "$ev" = workflow_dispatch ] && [ "$br" = main ] && [ "$wf" = agent-win ] || die "staging exe yalnız main workflow_dispatch koşusundan (bulunan: $br/$ev/$wf)"
  [ "$concl" = success ] || die "koşu sonucu '$concl' (success değil)"
  [ "$(sed -n 1p "$WORK/stg/build-meta.txt")" = "$STG_SERVER_URL" ] || die "build-meta sunucu adresi $STG_SERVER_URL değil"
  stg_exe=$(cd "$WORK/stg" && find . -maxdepth 1 -name 'NoktaDestek-stg-*.exe' | sed 's#^\./##')
  [[ "$stg_exe" =~ ^NoktaDestek-stg-[0-9]+\.[0-9]+\.[0-9]+\.exe$ ]] || die "artifact'ta tek NoktaDestek-stg-<sürüm>.exe yok"
  stg_want=$(awk -v e="$stg_exe" '$2==e || $2=="*"e {print $1}' "$WORK/stg/SHA256SUMS")
  [[ "$stg_want" =~ ^[0-9a-f]{64}$ ]] || die "SHA256SUMS'ta $stg_exe satırı yok"
  # Volume'da ad NoktaDestek.exe (Caddy yolu); içerik aynı bayt, SHA256SUMS bu ada yeniden yazılır, attestation özetle bağlı.
  cp "$WORK/stg/$stg_exe" "$WORK/$EXE"; printf '%s  %s\n' "$stg_want" "$EXE" >"$WORK/SHA256SUMS"
  ver="${stg_exe#NoktaDestek-stg-}"; LABEL="stg-run-$STG_RUN-v${ver%.exe}"; SRC_REF="refs/heads/main"
  DEPLOY_DIR="${DEPLOY_DIR:-/opt/remote-stg/deploy}"
else
  cp "$SRC_DIR/$EXE" "$SRC_DIR/SHA256SUMS" "$WORK/"; LABEL="dir-$(date -u +%Y%m%d%H%M%S)"; SRC_REF=""
  [ "$NOATT" = 0 ] || echo "UYARI: --dir + --no-attestation: bu dosyanın CI kökeni HİÇ doğrulanmıyor (yalnız staging)" >&2
fi

f="$WORK/$EXE"
# 1) SHA256SUMS: tek satır, NoktaDestek.exe
want=$(awk -v e="$EXE" '$2==e || $2=="*"e {print $1}' "$WORK/SHA256SUMS")
[ "$(printf '%s\n' "$want" | grep -c .)" -eq 1 ] && [[ "$want" =~ ^[0-9a-f]{64}$ ]] || die "SHA256SUMS'ta tek $EXE satırı yok"
got=$(sha "$f")
[ "$got" = "$want" ] || die "SHA-256 uyuşmuyor: SHA256SUMS=$want dosya=$got"
echo "SHA256SUMS: OK ($want)"
# 2) Biçim: PE, ≤ 40 MB, packer yok (ADR-0010, AC-96)
[ "$(head -c2 "$f")" = MZ ] || die "PE dosyası değil"
[ "$(fsize "$f")" -le "$MAX_BYTES" ] || die "40 MB'ı aşıyor"
if LC_ALL=C grep -aq 'UPX!' "$f"; then die "UPX/packer izi"; fi
# 3) Köken: GitHub build provenance (Sigstore), yalnız bu repo + agent-win.yml + GitHub barındırmalı runner
if [ "$NOATT" = 1 ]; then
  origin="Köken kanıtı yalnız GitHub'dan kimlikli indirme."; [ -z "$SRC_DIR" ] || origin="Köken kanıtı YOK (yerel dosya)."
  echo "UYARI: attestation doğrulaması ATLANDI (ALLOW_UNATTESTED=staging). $origin" >&2
  LABEL="$LABEL-unattested"
else
  args=(attestation verify "$f" --repo "$REPO" --signer-workflow "$REPO/$WORKFLOW" --deny-self-hosted-runners)
  [ -z "$SRC_REF" ] || args+=(--source-ref "$SRC_REF")
  gh "${args[@]}" >/dev/null || die "gh attestation verify başarısız"
  echo "attestation: OK ($REPO/$WORKFLOW${SRC_REF:+ @ $SRC_REF})"
fi
echo "parmak izi (istemci 'Hakkında'): ${want:0:8}  sürüm etiketi: $LABEL  boyut: $(fsize "$f") B"
[ "$DRY" = 0 ] || { echo "--dry-run: yayınlanmadı"; exit 0; }

if [ "$LOCAL" = 1 ]; then
  dir="${DEPLOY_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
  apply "$dir" "$want" "$LABEL" "$f"
else
  dir="${DEPLOY_DIR:-/opt/remote/deploy}"
  rtmp=$(ssh "$SSH" 'mktemp -d /tmp/agent-publish.XXXXXX')
  scp -q "$f" "$0" "$SSH:$rtmp/"
  # shellcheck disable=SC2029  # bilerek istemcide açılır: want/LABEL doğrulanmış (regex), dir operatörün verdiği yol, tırnaklı
  ssh "$SSH" "bash $rtmp/$(basename "$0") --apply '$dir' '$want' '$LABEL' $rtmp/$EXE; rc=\$?; rm -rf $rtmp; exit \$rc"
fi
