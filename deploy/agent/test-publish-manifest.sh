#!/usr/bin/env bash
# publish-manifest.sh + verify-manifest.mjs testi (P29 K6; mimari-p29 §9.2, §14.6, §14.7). Sunucuya bağlanmaz, konteyner BAŞLATMAZ:
# `docker compose config` (CLI) + AGENT_PUBLISH_RESTART=0 (volume yerine geçici klasör). Ed25519 anahtarları koşu anında node:crypto
# ile üretilir (repoda anahtar/fikstür yok). (1) verify-manifest.mjs: geçerli, imza, anahtar, env, kanonik (boşluk/sıra/yinelenen/
# kaçış/BOM/baştaki sıfır), süre (istemci 30 g, servis 90 g, dolmuş, gelecek), ad, --same-as; (2) --apply ortam kilidi + hedef
# anahtarı + yayımlanmış ikili SHA kapısı + sürüm düşmez + reddedilende dosya yazılmaz; (3) --apply-withdraw (acil durdurma provası);
# (4) operatör --dir --dry-run ve --tag --dry-run (sahte `gh`: attestation kimliği sabit argümanları).
# Kullanım: deploy/agent/test-publish-manifest.sh   (node + docker CLI gerekir)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
P="$HERE/publish-manifest.sh"
V="$HERE/verify-manifest.mjs"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
F=0; ok() { echo "PASS  $*"; }; no() { echo "FAIL  $*"; F=$((F + 1)); }
command -v node >/dev/null || { echo "node gerekli"; exit 2; }

# Yardımcı: anahtar üret (tohum dosyada kalır, yalnız bu geçici klasörde), manifest yaz (ham metin) ve imzala.
cat >"$TMP/h.mjs" <<'JS'
import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
const [cmd, ...a] = process.argv.slice(2);
const pkcs8 = (seed) => createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
if (cmd === "keygen") {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  writeFileSync(a[0], seed.toString("base64"));
  process.stdout.write(publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64url"));
} else if (cmd === "sign") { // sign <tohum> <manifest>  -> <manifest>.sig
  const k = pkcs8(Buffer.from(readFileSync(a[0], "utf8"), "base64"));
  const msg = Buffer.concat([Buffer.from("rs-update-manifest-v1\n"), readFileSync(a[1])]);
  writeFileSync(`${a[1]}.sig`, sign(null, msg, k).toString("base64url"));
} else if (cmd === "make") { // make <dosya> env platform arch component version sha size issued expires min
  const [f, env, platform, arch, component, version, sha256, size, issuedAt, expiresAt, min] = a;
  writeFileSync(f, `{"schema":1,"env":"${env}","platform":"${platform}","arch":"${arch}","component":"${component}","version":"${version}","sha256":"${sha256}","size":${size},"issuedAt":"${issuedAt}","expiresAt":"${expiresAt}","minUpdaterVersion":"${min}"}`);
}
JS
h() { node "$TMP/h.mjs" "$@"; }
iso() { node -e "console.log(new Date(Date.now()+Number(process.argv[1])*86400e3).toISOString().slice(0,19)+'Z')" -- "$1"; }
PRODK="$(h keygen "$TMP/prod.seed")"; PRODK2="$(h keygen "$TMP/prod2.seed")"; STGK="$(h keygen "$TMP/stg.seed")"
SW="$(printf 'a%.0s' $(seq 64))"; SS="$(printf 'b%.0s' $(seq 64))"; SL="$(printf 'c%.0s' $(seq 64))"
I0="$(iso -1)"; E29="$(iso 29)"; E89="$(iso 89)"
mkm() { # <klasör> <ad> <env> <platform> <arch> <comp> <ver> <sha> <tohum> [issued] [expires]
  mkdir -p "$1"; h make "$1/$2" "$3" "$4" "$5" "$6" "$7" "$8" 1048576 "${10:-$I0}" "${11:-$E29}" 0.22.0; h sign "$9" "$1/$2"
}
vf() { (cd "$(dirname "$2")" && node "$V" --pubkeys "${3:-$PRODK}" --env "${4:-prod}" "${@:5}" "$(basename "$2")") >"$TMP/o" 2>&1; } # <beklenen> <dosya> ...
expv() { # <ok|ret> <açıklama> <dosya> [pubkeys] [env] [ek seçenekler…] [-- mesaj parçası MSG değişkeniyle]
  local want="$1" d="$2"; shift 2; local rc=0
  vf x "$@" || rc=$?
  if [ "$want" = ok ] && [ "$rc" = 0 ]; then ok "$d"
  elif [ "$want" = ret ] && [ "$rc" = 1 ] && { [ -z "${MSG:-}" ] || grep -q -- "$MSG" "$TMP/o"; }; then ok "$d"
  else no "$d (rc=$rc: $(tail -1 "$TMP/o"))"; fi
  MSG=""
}

echo "== (1) verify-manifest.mjs"
D="$TMP/v"; mkdir -p "$D"
mkm "$D" update-client-windows-amd64.json prod windows amd64 client 0.22.1 "$SW" "$TMP/prod.seed"
expv ok "geçerli istemci manifesti (etkin anahtar)" "$D/update-client-windows-amd64.json"
expv ok "iki yuvalı anahtar listesi (ikinci yuva eşleşir)" "$D/update-client-windows-amd64.json" "$PRODK2,$PRODK"
MSG=MANIFEST_SIGNATURE expv ret "başka anahtar (staging) -> MANIFEST_SIGNATURE" "$D/update-client-windows-amd64.json" "$STGK"
MSG=ENV_MISMATCH expv ret "env prod manifest, beklenen staging -> ENV_MISMATCH" "$D/update-client-windows-amd64.json" "$PRODK" staging
expv ok "--expect-name: ad = hedef" "$D/update-client-windows-amd64.json" "$PRODK" prod --expect-name
cp "$D/update-client-windows-amd64.json" "$D/update-client-linux-amd64.json"; cp "$D/update-client-windows-amd64.json.sig" "$D/update-client-linux-amd64.json.sig"
MSG="dosya adı" expv ret "--expect-name: linux adlı dosyada windows manifesti -> ret" "$D/update-client-linux-amd64.json" "$PRODK" prod --expect-name
sed 's/0\.22\.1/0.22.2/' "$D/update-client-windows-amd64.json" >"$D/t.json"; cp "$D/update-client-windows-amd64.json.sig" "$D/t.json.sig"
MSG=MANIFEST_SIGNATURE expv ret "imzadan sonra değiştirilmiş bayt -> MANIFEST_SIGNATURE" "$D/t.json"
neg() { # <açıklama> <ham manifest metni> [mesaj]
  printf '%s' "$2" >"$D/n.json"; h sign "$TMP/prod.seed" "$D/n.json"; MSG="${3:-}" expv ret "$1" "$D/n.json"
}
G="\"schema\":1,\"env\":\"prod\",\"platform\":\"windows\",\"arch\":\"amd64\",\"component\":\"client\",\"version\":\"0.22.1\",\"sha256\":\"$SW\",\"size\":1048576,\"issuedAt\":\"$I0\",\"expiresAt\":\"$E29\",\"minUpdaterVersion\":\"0.22.0\""
neg "imzalı ama boşluklu -> ret (kanonik)" "{${G/,\"env\"/, \"env\"}}" "ASCII\|kanonik"
neg "imzalı ama sonda yeni satır -> ret" "{$G}
" "ASCII"
neg "imzalı ama alan sırası farklı -> ret" "{${G/\"schema\":1,\"env\":\"prod\"/\"env\":\"prod\",\"schema\":1}}" "kanonik"
neg "imzalı ama yinelenen anahtar -> ret" "{$G,\"version\":\"0.22.1\"}" "alan kümesi\|kanonik"
neg "imzalı ama fazladan alan -> ret" "{$G,\"url\":\"x\"}" "alan kümesi"
neg "imzalı ama kaçışlı dizgi (\\u0030) -> ret" "{${G/0.22.0\"/0.22.\\u0030\"}}" "kanonik"
neg "imzalı ama baştaki sıfırlı size -> ret" "{${G/1048576/01048576}}" "JSON\|kanonik"
neg "imzalı ama Sha256 harf farkı -> ret" "{${G/\"sha256\"/\"Sha256\"}}" "alan kümesi"
printf '\357\273\277{%s}' "$G" >"$D/n.json"; h sign "$TMP/prod.seed" "$D/n.json"; MSG=ASCII expv ret "imzalı ama BOM'lu -> ret" "$D/n.json"
neg "imzalı ama schema 2 -> ret" "{${G/\"schema\":1/\"schema\":2}}" "schema"
H2="${G/\"component\":\"client\"/\"component\":\"service\"}"
neg "imzalı ama servis macos/universal hedefi -> ret" "{${H2/\"platform\":\"windows\",\"arch\":\"amd64\"/\"platform\":\"macos\",\"arch\":\"universal\"}}" "hedef"
mkm "$D" e.json prod windows amd64 client 0.22.1 "$SW" "$TMP/prod.seed" "$(iso -20)" "$(iso -1)"
MSG=EXPIRED expv ret "süresi dolmuş -> EXPIRED" "$D/e.json"
mkm "$D" l.json prod windows amd64 client 0.22.1 "$SW" "$TMP/prod.seed" "$I0" "$(iso 31)"
MSG="30 günü" expv ret "istemci manifesti > 30 g -> ret (r2 T-7)" "$D/l.json"
mkm "$D" s.json prod windows amd64 service 0.22.1 "$SS" "$TMP/prod.seed" "$I0" "$E89"
expv ok "servis manifesti 90 g -> geçerli" "$D/s.json"
mkm "$D" f.json prod windows amd64 client 0.22.1 "$SW" "$TMP/prod.seed" "$(iso 2)" "$(iso 20)"
MSG="gelecekte" expv ret "issuedAt > şimdi + 24 sa -> ret" "$D/f.json"
MSG="kalan süre" expv ret "--min-remaining-days 30 (kalan ~29) -> ret" "$D/update-client-windows-amd64.json" "$PRODK" prod --min-remaining-days 30
# --same-as (update-resign): yalnız tarih değişebilir
mkm "$D/r" update-client-windows-amd64.json prod windows amd64 client 0.22.1 "$SW" "$TMP/prod.seed" "$(iso 0)" "$(iso 30)"
expv ok "--same-as: yalnız issuedAt/expiresAt farklı -> geçerli" "$D/r/update-client-windows-amd64.json" "$PRODK" prod --same-as "$D/update-client-windows-amd64.json"
mkm "$D/r2" update-client-windows-amd64.json prod windows amd64 client 0.22.1 "$SL" "$TMP/prod.seed"
MSG="sha256 eski" expv ret "--same-as: sha256 değişmiş -> ret" "$D/r2/update-client-windows-amd64.json" "$PRODK" prod --same-as "$D/update-client-windows-amd64.json"
printf 'x' >"$D/k.json"; printf 'kisa' >"$D/k.json.sig"; MSG="86 karakter" expv ret ".sig biçimsiz -> ret" "$D/k.json"
rc=0; node "$V" --pubkeys "$PRODK" --env prod "$D/yok.json" >"$TMP/o" 2>&1 || rc=$?
[ "$rc" = 1 ] && grep -q "yok" "$TMP/o" && ok "dosya yok -> 1" || no "dosya yok rc=$rc"
rc=0; node "$V" --pubkeys "kisa" --env prod "$D/s.json" >"$TMP/o" 2>&1 || rc=$?
[ "$rc" = 2 ] && ok "geçersiz açık anahtar -> kullanım hatası 2" || no "geçersiz anahtar rc=$rc"
printf '# yorum\n%s\n\n%s\n' "$PRODK" "$PRODK2" >"$TMP/prod.pub"
(cd "$D" && node "$V" --pubkeys-file "$TMP/prod.pub" --env prod s.json) >/dev/null 2>&1 && ok "--pubkeys-file (yorum/boş satır yok sayılır)" || no "--pubkeys-file"
grep -q "$(head -c 20 "$TMP/prod.seed")" "$TMP/o" && no "tohum çıktıda" || ok "tohum doğrulayıcı çıktısında yok"

echo "== (2) --apply (sunucu tarafı)"
mk() { # <ad> <.env satırları...>
  local d="$TMP/$1"; shift; mkdir -p "$d"
  cp "$HERE/../docker-compose.yml" "$HERE/../docker-compose.staging.yml" "$d/"; printf '%s\n' "$@" >"$d/.env"
}
SHAS=("AGENT_SHA256=$SW" "UNATTENDED_AGENT_SHA256=$SS" "LINUX_AGENT_SHA256=$SL")
mk prod 'DEPLOY_ENV=production' 'PUBLIC_BASE_URL=https://remote.test' "UPDATE_MANIFEST_PUBKEYS=$PRODK,$PRODK2" "${SHAS[@]}"
mk prodnokey 'DEPLOY_ENV=production' 'PUBLIC_BASE_URL=https://remote.test' 'UPDATE_MANIFEST_PUBKEYS=' "${SHAS[@]}"
mk prodnosha 'DEPLOY_ENV=production' 'PUBLIC_BASE_URL=https://remote.test' "UPDATE_MANIFEST_PUBKEYS=$PRODK" 'AGENT_SHA256='
mk prodoldsha 'DEPLOY_ENV=production' 'PUBLIC_BASE_URL=https://remote.test' "UPDATE_MANIFEST_PUBKEYS=$PRODK" "AGENT_SHA256=$SL"
mk prodbad 'DEPLOY_ENV=production' 'COMPOSE_PROJECT_NAME=remote-stg' "UPDATE_MANIFEST_PUBKEYS=$PRODK" "${SHAS[@]}"
mk stg 'DEPLOY_ENV=staging' 'COMPOSE_PROJECT_NAME=remote-stg' 'COMPOSE_FILE=docker-compose.yml:docker-compose.staging.yml' \
  'PUBLIC_BASE_URL=https://stg.remote.test' "UPDATE_MANIFEST_PUBKEYS=$STGK" "${SHAS[@]}"
mk empty 'DEPLOY_ENV=' "UPDATE_MANIFEST_PUBKEYS=$PRODK" "${SHAS[@]}"
ST="$TMP/st-prod"; mkm "$ST" update-client-windows-amd64.json prod windows amd64 client 0.22.1 "$SW" "$TMP/prod.seed"
mkm "$ST" update-service-windows-amd64.json prod windows amd64 service 0.22.1 "$SS" "$TMP/prod.seed" "$I0" "$E89"
SG="$TMP/st-stg"; mkm "$SG" update-client-windows-amd64.json staging windows amd64 client 0.22.1 "$SW" "$TMP/stg.seed"
expa() { # <ok|ret> <açıklama> <klasör> <etiket> <aşama> [mesaj]
  local rc=0; AGENT_PUBLISH_RESTART=0 bash "$P" --apply "$TMP/$3" "$4" "$5" >"$TMP/o" 2>&1 || rc=$?
  if [ "$1" = ok ] && [ "$rc" = 0 ]; then ok "$2"
  elif [ "$1" = ret ] && [ "$rc" != 0 ] && { [ -z "${6:-}" ] || grep -q -- "$6" "$TMP/o"; }; then ok "$2"
  else no "$2 (rc=$rc: $(tail -1 "$TMP/o"))"; fi
}
U="agent/downloads/update"
expa ret "production + dir-* -> ret" prod dir-1 "$ST" "yalnız Release"
expa ret "production + staging (env=staging) manifesti -> ret" prod v0.22.1 "$SG" "doğrulaması başarısız"
expa ret "UPDATE_MANIFEST_PUBKEYS boş -> ret" prodnokey v0.22.1 "$ST" "PUBKEYS boş"
expa ret "hedefte AGENT_SHA256 boş (ikili yayınlanmamış) -> ret" prodnosha v0.22.1 "$ST" "önce ikiliyi"
expa ret "manifest sha256 ≠ yayımlanmış ikili -> ret" prodoldsha v0.22.1 "$ST" "yayımlanmış ikili değil"
expa ret "S13C-1: production ama proje remote-stg -> ret" prodbad v0.22.1 "$ST" "compose projesi"
expa ret "DEPLOY_ENV boş -> ret" empty v0.22.1 "$ST" "development|staging|production"
for d in prodnokey prodnosha prodoldsha prodbad empty; do [ ! -e "$TMP/$d/$U" ] || no "reddedilen $d hedefine dosya yazıldı"; done
ok "reddedilen hedeflere dosya yazılmadı"
expa ok "production + vX.Y.Z + hedef anahtarı + SHA eşleşir -> yayın (istemci + servis)" prod v0.22.1 "$ST"
cmp -s "$ST/update-client-windows-amd64.json" "$TMP/prod/$U/update-client-windows-amd64.json" \
  && cmp -s "$ST/update-service-windows-amd64.json.sig" "$TMP/prod/$U/update-service-windows-amd64.json.sig" && ok "volume'a bayt bayt aynı yazıldı (.json + .sig)" || no "yazılan dosya farklı"
compgen -G "$TMP/prod/$U/.*.new" >/dev/null && no "geçici .new dosyası kaldı" || ok "geçici dosya kalmadı"
grep -q " manifest v0.22.1 update-service-windows-amd64.json 0.22.1 " "$TMP/prod/agent/PUBLISHED.log" && ok "PUBLISHED.log manifest satırı" || no "PUBLISHED.log"
ST2="$TMP/st-old"; mkm "$ST2" update-client-windows-amd64.json prod windows amd64 client 0.22.0 "$SW" "$TMP/prod.seed"
expa ret "sürüm düşürme (yayında 0.22.1, gelen 0.22.0) -> ret" prod v0.22.0 "$ST2" "geri gidilmez"
ST3="$TMP/st-resign"; mkm "$ST3" update-client-windows-amd64.json prod windows amd64 client 0.22.1 "$SW" "$TMP/prod.seed" "$(iso 0)" "$(iso 30)"
expa ok "aynı sürüm yeniden imza (update-resign) -> yayın" prod v0.22.1 "$ST3"
cmp -s "$ST3/update-client-windows-amd64.json" "$TMP/prod/$U/update-client-windows-amd64.json" && ok "yeniden imzalı manifest yerinde" || no "resign yazılmadı"
ST4="$TMP/st-yedek"; mkm "$ST4" update-client-windows-amd64.json prod windows amd64 client 0.22.2 "$SW" "$TMP/prod2.seed"
expa ok "yedek anahtarla imzalı manifest (rotasyon) -> yayın" prod v0.22.2 "$ST4"
ST5="$TMP/st-x"; mkm "$ST5" update-client-windows-amd64.json prod windows amd64 client 0.22.3 "$SW" "$TMP/prod.seed"; printf 'x' >"$ST5/zararli.sh"
expa ret "aşamada beklenmeyen dosya -> ret" prod v0.22.3 "$ST5" "beklenmeyen dosya"
expa ok "staging (ikinci yığın) + stg-run-* + staging anahtarı -> yayın" stg stg-run-7 "$SG"
expa ret "staging hedefe prod manifesti -> ret (env/anahtar)" stg stg-run-7 "$ST" "doğrulaması başarısız"

echo "== (3) --apply-withdraw (acil durdurma provası)"
rc=0; AGENT_PUBLISH_RESTART=0 bash "$P" --apply-withdraw "$TMP/prod" client >"$TMP/o" 2>&1 || rc=$?
[ "$rc" = 0 ] && [ ! -e "$TMP/prod/$U/update-client-windows-amd64.json" ] && [ ! -e "$TMP/prod/$U/update-client-windows-amd64.json.sig" ] \
  && [ -e "$TMP/prod/$U/update-service-windows-amd64.json" ] && ok "withdraw client: istemci manifestleri silindi, servis yerinde" || no "withdraw client rc=$rc $(tail -1 "$TMP/o")"
grep -q " manifest withdraw client$" "$TMP/prod/agent/PUBLISHED.log" && ok "PUBLISHED.log withdraw satırı" || no "withdraw log"
rc=0; AGENT_PUBLISH_RESTART=0 bash "$P" --apply-withdraw "$TMP/prod" all >/dev/null 2>&1 || rc=$?
[ "$rc" = 0 ] && [ -z "$(ls "$TMP/prod/$U")" ] && ok "withdraw all: update/ boş" || no "withdraw all"
expa ok "geri çekmeden sonra yeniden yayın (geri alma geri alınabilir)" prod v0.22.2 "$ST4"
rc=0; AGENT_PUBLISH_RESTART=0 bash "$P" --apply-withdraw "$TMP/prod" hepsi >"$TMP/o" 2>&1 || rc=$?
[ "$rc" != 0 ] && ok "withdraw bilinmeyen bileşen -> ret" || no "withdraw bilinmeyen"
rc=0; AGENT_PUBLISH_RESTART=0 bash "$P" --apply-withdraw "$TMP/empty" client >"$TMP/o" 2>&1 || rc=$?
[ "$rc" != 0 ] && ok "withdraw DEPLOY_ENV boş -> ret" || no "withdraw empty"

echo "== (4) operatör tarafı"
cp "$TMP/prod.pub" "$TMP/stg.pub"; printf '%s\n' "$STGK" >"$TMP/stg.pub"
rc=0; ALLOW_UNATTESTED=staging bash "$P" --dir "$SG" --no-attestation --env staging --pubkeys-file "$TMP/stg.pub" --dry-run >"$TMP/o" 2>&1 || rc=$?
[ "$rc" = 0 ] && grep -q 'dry-run: yayınlanmadı' "$TMP/o" && ok "--dir --no-attestation staging --dry-run" || no "--dir dry-run rc=$rc $(tail -2 "$TMP/o")"
rc=0; bash "$P" --dir "$SG" --no-attestation --env staging --pubkeys-file "$TMP/stg.pub" --dry-run >"$TMP/o" 2>&1 || rc=$?
[ "$rc" != 0 ] && grep -q ALLOW_UNATTESTED "$TMP/o" && ok "--no-attestation ALLOW_UNATTESTED olmadan -> ret" || no "noatt kapısı rc=$rc"
rc=0; ALLOW_UNATTESTED=staging bash "$P" --dir "$ST" --no-attestation --env prod --pubkeys-file "$TMP/prod.pub" --dry-run >"$TMP/o" 2>&1 || rc=$?
[ "$rc" != 0 ] && grep -q "attestation'sız yalnız staging" "$TMP/o" && ok "prod manifesti attestation'sız -> ret" || no "prod noatt rc=$rc"
# --tag: sahte gh (Release indirme + attestation argüman kaydı)
mkdir -p "$TMP/bin" "$TMP/rel"; cp "$ST"/update-* "$TMP/rel/"; rm -f "$TMP/rel/"*.verify.out
(cd "$TMP/rel" && for f in update-*; do printf '%s  %s\n' "$(shasum -a 256 "$f" | cut -d' ' -f1)" "$f"; done >SHA256SUMS)
cat >"$TMP/bin/gh" <<EOF
#!/bin/sh
echo "gh \$*" >>"$TMP/gh.log"
case "\$1 \$2" in
  "release download") d=""; while [ \$# -gt 0 ]; do [ "\$1" = -D ] && d="\$2"; shift; done; cp "$TMP/rel/"* "\$d/" ;;
  "attestation verify") exit 0 ;;
esac
EOF
chmod 755 "$TMP/bin/gh"
rc=0; PATH="$TMP/bin:$PATH" bash "$P" --tag v0.22.1 --pubkeys-file "$TMP/prod.pub" --dry-run >"$TMP/o" 2>&1 || rc=$?
[ "$rc" = 0 ] && grep -q 'SHA256SUMS: OK' "$TMP/o" && grep -q 'attestation: OK' "$TMP/o" && ok "--tag --dry-run: SHA256SUMS + imza + attestation" || no "--tag rc=$rc $(tail -2 "$TMP/o")"
grep -q -- "--signer-workflow NoktaBilisim/Remote/.github/workflows/agent-win.yml --cert-oidc-issuer https://token.actions.githubusercontent.com --deny-self-hosted-runners --source-ref refs/tags/v0.22.1" "$TMP/gh.log" \
  && ok "attestation kimliği sabit (§14.7: signer-workflow, OIDC issuer, source-ref etiket, barındırmalı runner)" || no "attestation argümanları: $(tail -1 "$TMP/gh.log")"
rc=0; PATH="$TMP/bin:$PATH" bash "$P" --tag v0.22.9 --pubkeys-file "$TMP/prod.pub" --dry-run >"$TMP/o" 2>&1 || rc=$?
[ "$rc" != 0 ] && grep -q "beklenen 0.22.9" "$TMP/o" && ok "--tag: manifest sürümü ≠ etiket -> ret" || no "--tag sürüm rc=$rc"
printf 'deadbeef  update-client-windows-amd64.json\n' >>"$TMP/rel/SHA256SUMS"
rc=0; PATH="$TMP/bin:$PATH" bash "$P" --tag v0.22.1 --pubkeys-file "$TMP/prod.pub" --dry-run >"$TMP/o" 2>&1 || rc=$?
[ "$rc" != 0 ] && grep -q "SHA256SUMS" "$TMP/o" && ok "--tag: SHA256SUMS çift/uyuşmaz satır -> ret" || no "--tag sums rc=$rc"
rc=0; bash "$P" --tag v0.22.1 >"$TMP/o" 2>&1 || rc=$?
[ "$rc" = 2 ] && ok "hedef (--ssh/--local/--dry-run) yok -> kullanım hatası" || no "kullanım rc=$rc"

echo
if [ "$F" = 0 ]; then echo "SONUÇ: GEÇTİ"; else echo "SONUÇ: $F FAIL"; exit 1; fi
