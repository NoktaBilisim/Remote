#!/usr/bin/env bash
# P27 K9 (mimari-p27 §4.2, §8.1): gözetimsiz erişim servis ikilisi (NoktaDestekServis.exe) yayını. verify-and-publish.sh ile
# aynı ilke: doğrulama operatör makinesinde (SHA256SUMS + PE/boyut/packer + gh attestation), sunucu bayt eşitliğini yeniden
# kontrol eder. Hedef: compose `unattended_downloads` volume'u (YALNIZ server salt okunur bağlar; Caddy görmez) +
# deploy/.env UNATTENDED_AGENT_SHA256 → server yeniden yaratılır → konteyner içinden SHA kontrolü.
#
# Kullanım:
#   deploy/agent/publish-servis.sh --tag v0.13.0 --ssh root@<sunucu>        # Release (NoktaDestekServis-<sürüm>.exe) -> prod
#   ALLOW_UNATTESTED=staging deploy/agent/publish-servis.sh --dir <klasör> --no-attestation --ssh root@<sunucu>
#       # yerelde derlenmiş imzasız staging ikilisi (klasörde NoktaDestekServis.exe + SHA256SUMS); prod'a ASLA
#   deploy/agent/publish-servis.sh --dir <klasör> --local [--no-attestation]  # yerel yığın
# Seçenekler: --deploy-dir <yol> (vars. /opt/remote/deploy; --local'de bu betiğin üst klasörü), --dry-run.
# Ortam: AGENT_REPO (vars. NoktaBilisim/Remote), AGENT_PUBLISH_RESTART=0 (compose'a dokunma; test: $dir/agent/unattended/).
# Ortam kilidi (apply; hedef .env DEPLOY_ENV, fail-closed): production -> yalnız Release etiketi (vX.Y.Z, attestation'lı);
#   staging | development -> her etiket; boş/başka -> RET.
# P32 (mimari-p32 §8.1, AC-529, S-P32-3/6/9): etiket vX.Y.Z ise (TÜM ortamlarda) SHA hedef .env UNATTENDED_SIGNED_SHA256
#   (izinli servis listesi) sonuna eklenir (yinelenmez, sıra korunur; öğeler kırpılır + küçük harfe çevrilir) ve
#   UNATTENDED_AGENT_VERSION=X.Y.Z yazılır. dir-* / *-unattested listeye EKLENMEZ, UNATTENDED_AGENT_VERSION boşaltılır.
#   Liste 16 öğeye ulaşınca UYARI; 20'yi aşacaksa betik HİÇBİR ŞEY yazmadan durur (runbook §27.9 acil yol). Listeden
#   çıkarma yalnız elle (runbook §27.9 iki aşamalı geri çekme). .env yazımı tek geçiş; geçici dosya umask 077,
#   yedek .env.bak.servis.<UTC zaman> chmod 600, son 10 yedek tutulur.
# Çıkış: 0 tamam · 1 doğrulama/yayın hatası · 2 kullanım hatası.
# İç mod (sunucuda): --apply <deploy-dir> <sha256> <etiket> <dosya>
set -euo pipefail
umask 077
REPO="${AGENT_REPO:-NoktaBilisim/Remote}"
WORKFLOW=".github/workflows/agent-win.yml"
MAX_BYTES=41943040
EXE=NoktaDestekServis.exe

die() { echo "HATA: $*" >&2; exit 1; }
usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d' >&2; exit 2; }
sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
fsize() { wc -c < "$1" | tr -d ' '; }
envval() { awk -F= -v k="$1" '$1 == k {sub(/^[^=]*=/, ""); v=$0} END {print v}' "$2" 2>/dev/null | tr -d '\r"'"'"; }
LIST_WARN=16
LIST_MAX=20
# İzinli liste normalizasyonu (server env.ts ile aynı kural): virgülle böl, boşlukları at, küçük harf, boş öğeleri at; sıra korunur.
normlist() { printf '%s' "$1" | tr ',' '\n' | tr -d ' \t\r' | tr 'A-F' 'a-f' | awk 'NF' | paste -sd, -; }

# ---------- sunucu tarafı ----------
apply() {
  local dir="$1" want="$2" label="$3" file="$4" denv ts release=0 list newlist ver="" n
  [[ "$want" =~ ^[0-9a-f]{64}$ ]] || die "geçersiz sha256"
  [[ "$label" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || die "geçersiz etiket"
  [ -f "$dir/.env" ] && [ -f "$dir/docker-compose.yml" ] || die "$dir bir deploy klasörü değil"
  [ "$(sha "$file")" = "$want" ] || die "aktarılan dosyanın SHA-256'sı beklenenden farklı"
  denv="$(envval DEPLOY_ENV "$dir/.env")"
  case "$denv" in
    production) [[ "$label" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "DEPLOY_ENV=production hedefe yalnız Release etiketi (vX.Y.Z) yayınlanır (bulunan: $label)" ;;
    staging|development) ;;
    *) die "$dir/.env DEPLOY_ENV development|staging|production olmalı (bulunan: '$denv')" ;;
  esac
  # P32 AC-529: izinli liste — yalnız Release (vX.Y.Z) eklenir. Sınır denetimi ikili/volume/.env'e dokunmadan ÖNCE (yarım yayın yok).
  list="$(normlist "$(envval UNATTENDED_SIGNED_SHA256 "$dir/.env")")"; newlist="$list"
  if [[ "$label" =~ ^v([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
    release=1; ver="${BASH_REMATCH[1]}"
    case ",$list," in
      *",$want,"*) ;;
      *) newlist="${list:+$list,}$want" ;;
    esac
  fi
  n=0; [ -z "$newlist" ] || n=$(printf '%s\n' "$newlist" | tr ',' '\n' | grep -c .)
  if [ "$n" -gt "$LIST_MAX" ]; then
    die "UNATTENDED_SIGNED_SHA256 liste dolu ($n > $LIST_MAX) — runbook §27.9 acil yol: kullanımı 0 olan en eski SHA'yı elle çıkarın, sonra yeniden yayınlayın. Hiçbir şey yazılmadı."
  fi
  if [ "$release" = 1 ] && [ "$n" -ge "$LIST_WARN" ]; then
    echo "UYARI: UNATTENDED_SIGNED_SHA256 $n öğe (>= $LIST_WARN; en çok $LIST_MAX) — runbook §27.9 liste temizliği" >&2
  fi
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  if [ "${AGENT_PUBLISH_RESTART:-1}" = 1 ]; then
    local vol img stage
    vol="$(cd "$dir" && docker compose config --format json | sed -n 's/.*"name": *"\([^"]*unattended_downloads\)".*/\1/p' | awk 'NR == 1')"
    [ -n "$vol" ] || die "unattended_downloads volume adı compose'dan çözülemedi ($dir; compose P27 öncesi mi?)"
    img="$(cd "$dir" && docker compose config --images | awk '/^caddy:/ && !n++')" && [ -n "$img" ] || die "caddy imajı bulunamadı"
    stage=$(dirname "$file")
    docker volume create "$vol" >/dev/null
    # Yardımcı konteyner: compose'daki sabit digest'li caddy imajı, ağsız. Dosya node (uid 1000) tarafından okunur: 0644.
    docker run --rm --network none -v "$vol:/dst" -v "$stage:/src:ro" "$img" sh -euc '
      cp /src/'"$EXE"' /dst/.'"$EXE"'.new && chmod 0644 /dst/.'"$EXE"'.new
      [ "$(sha256sum /dst/.'"$EXE"'.new | cut -d" " -f1)" = "$1" ] || { rm -f /dst/.'"$EXE"'.new; exit 3; }
      mv -f /dst/.'"$EXE"'.new /dst/'"$EXE"'' sh "$want" || die "volume'a yazılamadı / kopya doğrulanamadı"
  else
    local dl="$dir/agent/unattended"; install -d -m 755 "$dl"
    install -m 644 "$file" "$dl/.$EXE.new"; mv -f "$dl/.$EXE.new" "$dl/$EXE"
  fi
  cp "$dir/.env" "$dir/.env.bak.servis.$ts" && chmod 600 "$dir/.env.bak.servis.$ts"
  # Adlar UTC zaman damgası (sözlük sırası = zaman sırası); en yeni 10 yedek kalır (S-P32-9).
  # shellcheck disable=SC2012  # adlar betiğin ürettiği .env.bak.servis.<UTC zaman>
  ls -1 "$dir"/.env.bak.servis.* 2>/dev/null | sort -r | tail -n +11 | xargs -r rm -f
  # Tek geçiş: üç anahtar ilk göründüğü yerde yazılır, yinelenen satırları atılır, yoksa sona eklenir. Geçici dosya umask 077 (600).
  # Liste yalnız Release'te yazılır (dir-* mevcut satıra dokunmaz); sürüm Release'te X.Y.Z, aksi halde boş.
  awk -v sha="$want" -v rel="$release" -v list="$newlist" -v ver="$ver" '
    function emit(k) { if (k == "UNATTENDED_AGENT_SHA256") print k "=" sha; else if (k == "UNATTENDED_AGENT_VERSION") print k "=" ver; else print k "=" list }
    { k = $0; sub(/=.*/, "", k) }
    k == "UNATTENDED_AGENT_SHA256" || k == "UNATTENDED_AGENT_VERSION" || (rel == 1 && k == "UNATTENDED_SIGNED_SHA256") {
      if (!(k in done)) { emit(k); done[k] = 1 }
      next
    }
    { print }
    END {
      if (!("UNATTENDED_AGENT_SHA256" in done)) emit("UNATTENDED_AGENT_SHA256")
      if (!("UNATTENDED_AGENT_VERSION" in done)) emit("UNATTENDED_AGENT_VERSION")
      if (rel == 1 && !("UNATTENDED_SIGNED_SHA256" in done)) emit("UNATTENDED_SIGNED_SHA256")
    }' "$dir/.env" > "$dir/.env.tmp.$ts"
  cat "$dir/.env.tmp.$ts" > "$dir/.env" && rm -f "$dir/.env.tmp.$ts"
  if [ "$release" = 1 ]; then echo "izinli liste: $n öğe (UNATTENDED_SIGNED_SHA256), UNATTENDED_AGENT_VERSION=$ver"
  else echo "izinli liste değişmedi ($label Release değil); UNATTENDED_AGENT_VERSION boşaltıldı"; fi
  install -d -m 755 "$dir/agent"
  printf '%s %s %s %s\n' "$ts" servis "$label" "$want" >> "$dir/agent/PUBLISHED.log"
  echo "yayınlandı: unattended_downloads/$EXE ($label, $want)"
  if [ "${AGENT_PUBLISH_RESTART:-1}" = 1 ]; then
    (cd "$dir" && docker compose up -d --no-deps server)
    local _i got
    for _i in $(seq 1 30); do
      [ "$(cd "$dir" && docker compose ps server --format '{{.Health}}')" = healthy ] && break; sleep 2
    done
    [ "$(cd "$dir" && docker compose ps server --format '{{.Health}}')" = healthy ] || die "server healthy olmadı (docker compose logs server)"
    # İndirme ucu oturum ister; bütünlük konteyner içinden, server'ın gördüğü yol + env ile denetlenir.
    got="$(cd "$dir" && docker compose exec -T server node -e "const c=require('node:crypto'),f=require('node:fs');const h=c.createHash('sha256').update(f.readFileSync(process.env.UNATTENDED_AGENT_PATH)).digest('hex');console.log(h===process.env.UNATTENDED_AGENT_SHA256?h:'uyusmaz:'+h)")" \
      || die "server konteynerinde dosya okunamadı"
    [ "$got" = "$want" ] || die "server'ın gördüğü dosya/env farklı ($got)"
    echo "kontrol: server UNATTENDED_AGENT_PATH SHA-256 = UNATTENDED_AGENT_SHA256 = $want"
  fi
}

if [ "${1:-}" = --apply ]; then [ $# -eq 5 ] || usage; apply "$2" "$3" "$4" "$5"; exit 0; fi

# ---------- operatör tarafı ----------
TAG="" SRC_DIR="" SSH="" LOCAL=0 DRY=0 NOATT=0 DEPLOY_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG="${2:?}"; shift 2 ;;
    --dir) SRC_DIR="${2:?}"; shift 2 ;;
    --ssh) SSH="${2:?}"; shift 2 ;;
    --local) LOCAL=1; shift ;;
    --deploy-dir) DEPLOY_DIR="${2:?}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --no-attestation) NOATT=1; shift ;;
    -h|--help) usage ;;
    *) echo "bilinmeyen argüman: $1" >&2; usage ;;
  esac
done
{ [ -n "$TAG" ] && [ -z "$SRC_DIR" ]; } || { [ -z "$TAG" ] && [ -n "$SRC_DIR" ]; } || { echo "--tag veya --dir'den tam biri verilmeli" >&2; usage; }
[ "$DRY" = 1 ] || [ -n "$SSH" ] || [ "$LOCAL" = 1 ] || { echo "--ssh <hedef>, --local veya --dry-run gerekli" >&2; usage; }
[ -z "$SSH" ] || [ "$LOCAL" = 0 ] || usage
[ -z "$TAG" ] || [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "etiket vX.Y.Z olmalı"
[ -z "$TAG" ] || [ "$NOATT" = 0 ] || die "--tag attestation'sız kullanılmaz"
[ "$NOATT" = 0 ] || [ "${ALLOW_UNATTESTED:-}" = staging ] || die "--no-attestation yalnız ALLOW_UNATTESTED=staging ile (prod'da yasak)"

WORK=$(mktemp -d "${TMPDIR:-/tmp}/servis-publish.XXXXXX"); trap 'rm -rf "$WORK"' EXIT
if [ -n "$TAG" ]; then
  rel="NoktaDestekServis-${TAG#v}.exe"
  gh release download "$TAG" --repo "$REPO" -p "$rel" -p SHA256SUMS -D "$WORK"
  want=$(awk -v e="$rel" '$2==e || $2=="*"e {print $1}' "$WORK/SHA256SUMS")
  mv "$WORK/$rel" "$WORK/$EXE"; LABEL="$TAG"; SRC_REF="refs/tags/$TAG"
else
  cp "$SRC_DIR/$EXE" "$SRC_DIR/SHA256SUMS" "$WORK/"
  want=$(awk -v e="$EXE" '$2==e || $2=="*"e {print $1}' "$WORK/SHA256SUMS")
  LABEL="dir-$(date -u +%Y%m%d%H%M%S)"; SRC_REF=""
fi
f="$WORK/$EXE"
[ "$(printf '%s\n' "$want" | grep -c .)" -eq 1 ] && [[ "$want" =~ ^[0-9a-f]{64}$ ]] || die "SHA256SUMS'ta tek servis ikilisi satırı yok"
[ "$(sha "$f")" = "$want" ] || die "SHA-256 uyuşmuyor: SHA256SUMS=$want dosya=$(sha "$f")"
echo "SHA256SUMS: OK ($want)"
[ "$(head -c2 "$f")" = MZ ] || die "PE dosyası değil"
[ "$(fsize "$f")" -le "$MAX_BYTES" ] || die "40 MB'ı aşıyor"
if LC_ALL=C grep -aq 'UPX!' "$f"; then die "UPX/packer izi"; fi
LC_ALL=C grep -aq 'requestedExecutionLevel level="asInvoker"' "$f" || die "manifest asInvoker değil (yanlış ikili?)"
if [ "$NOATT" = 1 ]; then
  echo "UYARI: attestation doğrulaması ATLANDI (ALLOW_UNATTESTED=staging). Köken kanıtı YOK." >&2
  LABEL="$LABEL-unattested"
else
  args=(attestation verify "$f" --repo "$REPO" --signer-workflow "$REPO/$WORKFLOW" --deny-self-hosted-runners)
  [ -z "$SRC_REF" ] || args+=(--source-ref "$SRC_REF")
  gh "${args[@]}" >/dev/null || die "gh attestation verify başarısız"
  echo "attestation: OK ($REPO/$WORKFLOW${SRC_REF:+ @ $SRC_REF})"
fi
echo "servis ikilisi: $LABEL  sha256: $want  boyut: $(fsize "$f") B"
[ "$DRY" = 0 ] || { echo "--dry-run: yayınlanmadı"; exit 0; }

if [ "$LOCAL" = 1 ]; then
  apply "${DEPLOY_DIR:-$(cd "$(dirname "$0")/.." && pwd)}" "$want" "$LABEL" "$f"
else
  dir="${DEPLOY_DIR:-/opt/remote/deploy}"
  rtmp=$(ssh "$SSH" 'mktemp -d /tmp/servis-publish.XXXXXX')
  scp -q "$f" "$0" "$SSH:$rtmp/"
  # shellcheck disable=SC2029  # bilerek istemcide açılır: want/LABEL regex ile doğrulanmış, dir operatörün verdiği yol
  ssh "$SSH" "bash $rtmp/$(basename "$0") --apply '$dir' '$want' '$LABEL' $rtmp/$EXE; rc=\$?; rm -rf $rtmp; exit \$rc"
fi
