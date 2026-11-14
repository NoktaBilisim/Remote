# QA Raporu — Tur 2 (P13b, Tur 1 düzeltmeleri + WhatsApp servis anahtarı S-P13b-3)
Tarih: 2026-11-15 · Denetçi: qa-denetci · Kapsam: Tur 1 maddeleri; implementation.md "P13b — devops düzeltme turu 1", "P13b QA #5", "S-P13b-3 (frontend)", "P13b — backend, WhatsApp servis anahtarı"; migration `20261115090000_whatsapp_api_key` (db-notlari incelemesiyle). Staging'e bağlanılmadı, dind kullanılmadı.

DURUM: DÜZELTİLMELİ

## Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` | temiz (çıkış 0) |
| `pnpm -r run typecheck` | temiz (çıkış 0) |
| `pnpm -r run test` | contracts 78/78, web 253/253, server unit 351/351. Skip yok |
| `test-db.sh up` (`rs-qa-p13b2-8374`, port 33392) + `pnpm --filter @remote/server test:int` | **540/541, 1 kırmızı**: `settings-p11.test.ts:118` AC-78 (MySQL bağlantı testi `ok:false`). Bu koşu `test-backup.sh` ile eşzamanlıydı (makinede 2. MySQL ayağa kalkıyordu). Dosya tek başına yeni konteynerde (`rs-qa-p13b2r-*`, 33393) yeniden koşuldu: **14/14 geçti**. P13b bu dosyaya ve MySQL ayar koduna dokunmuyor. Sonuç: yük altında kararsız (flaky) test, regresyon değil; bkz. Öneriler. İki konteyner `down` ile silindi |
| `deploy/backup/test-backup.sh` | **SONUÇ: GEÇTİ (55 PASS)**, ~2,5 dk; compose projesi `rstb1794692451944` + yardımcı konteyner trap ile silindi (`docker ps -a` ve volume listesinde `rstb`/`rs-qa` yok) |
| `pnpm --filter @remote/web e2e` (mock) | **308 geçti, 0 kalan, 123 skip**. Skip'lerin hepsi proje kapılı ve gerekçeli: `test.skip(name !== "desktop", "masaüstü akışı")` ve `test.skip(name !== "mobile", "mobil")`. Yeni S-P13b-3 senaryoları (env rozeti, kayıt/geri yazılmama/kaldırma onayı/401, köken değişiminde yeniden giriş) ve axe light/dark yeşil |
| `bash -n` (deploy/**/*.sh, apps/server/scripts) | hepsi temiz |
| `shellcheck -x -S warning` (koalaman stable, `LC_ALL=C.UTF-8`, salt okunur bağlama): deploy/backup, ops, turn, mysql, deploy/*.sh | **temiz** (çıkış 0) |

## Tur 1 maddelerinin durumu
| # | Madde | Durum | Kanıt |
|---|---|---|---|
| 1 | [devops] yedek test betiği repoda yok | ✅ kapandı | `deploy/backup/test-backup.sh` + `test-backup-inner.sh` var, bu turda koşuldu: 55 PASS. Kurcalanmış döküm senaryosu açık: `test-backup-inner.sh:139-146` (`CREATE USER`, `GRANT ALL ON *.*`, `SET PERSIST`, `INSTALL COMPONENT`, `SELECT 1; USE mysql; INSERT`), TRUNCATE `:100-101`, tek DELETE `:96`, DROP TRIGGER `:103-104`, `x-api-key` kanca reddi `:116-117` |
| 2 | [devops] ≤ 300 satır | ✅ kapandı (gerekçeli) | `backup.sh` 296, `restore.sh` 277 (+ `lib-audit.sh` 133, `lib-offsite.sh` 126, `lib-restore.sh` 89). `host-firewall.sh` 344 ve `remote-watch.sh` 313 bölünmedi; gerekçe kabul edilebilir: root timer'ının çalıştırdığı tek dosyalık kurulu kopya, ikinci root `source` dosyası yeni sahip/izin denetimi ister. Aşım 44 ve 13 satır. `check-app-grants.sh` 493 (önceden 460) dba'da, test betiği |
| 3 | [frontend-dev/backend-dev] `source:"default"` ölü kodu | ✅ kapandı | `whatsapp-form.tsx`'te `default` dalı yok, `tr.json`'da `defaultBadge/defaultSource/urlHintDefault` yok, contracts `source: "panel" \| "env"` (`system-settings.ts:207`). Tek kalan `whatsapp.test.ts:50` eski yanıtın savunma amaçlı `env`'e indirgenmesini test ediyor (gerekçeli) |
| 4 | [dba] `audit-continuity.sql` kural 2 | ✅ kapandı | Başlık kural 2a/2b/2c (`:34-39`) `lib-audit.sh:61-81` ile aynı: `sifirlandi` (işaret eşleşir), `isaretsiz`, `kaydi-kayboldu`. Testte üçü de sınanıyor |
| 5 | [devops] shellcheck uyarıları | ✅ kapandı | shellcheck temiz (yukarıda) |
| 6 | [teknik-yazar] `README.md:672` varsayılan adres | ❌ açık (W1) | `README.md:672` hâlâ "o da yoksa varsayılan `http://89.252.189.211:3000`" ve "Kimlik bilgisi yok" diyor. Artık iki yönden yanlış: varsayılan adres yok, servis anahtarı (S-P13b-3) var |

## Kabul kriterleri
| AC | Durum | Kanıt veya eksik |
|---|---|---|
| AC-298 imza / migrator / CHECKSUM / ortam kilidi | ✅ | `test-backup.sh` 55 PASS (bu tur): imzasız, değiştirilmiş manifest, bozuk imza, yabancı anahtar → `FAIL (imza)`, çözme yok; yanlış `--confirm`, staging→production, `DEPLOY_ENV` uyuşmazlığı, TTY yok → ret; kurcalanmış döküm → migrator yükleyemez, canlı hesap/persist/bileşen sayısı aynı, scratch kalmadı; CHECKSUM canlı = scratch |
| AC-299 reset-superadmin | ✅ | Tur 1'deki kanıt; `superadmin-reset-p13b.test.ts` bu turda da yeşil (entegrasyon koşusu) |
| AC-300 site dışı kanca | ✅ | test-backup: kanca başarılı (sır okunamıyor, ortamda sır yok, sonra 700/600, komut metni logda yok); `exit 7` → `OFFSITE-FAILED rc=7` + alarm + birim rc 0; `x-api-key` → rc 126 |
| AC-301 audit süreklilik | ✅ | test-backup: TRUNCATE → `kaydi-kayboldu`; tetikleyici düşür + tek DELETE → `FAILED gun=`; DROP TRIGGER → `adım=tetikleyici`; S-P13b-1 işaret kuralları |
| AC-302 remote-watch | ✅ (kayıtla) | `test-watch.sh` 49 PASS kaydı (root yardımcı konteyner ister; bu turda koşulmadı) |
| AC-126 (revize) HSTS | ✅ | `ops-headers.test.ts` yeşil |
| AC-21/22 TURN | ✅ (kayıtla) | Tur 1 ile aynı; `signaling-lifecycle.test.ts` yeşil |
| AC-23, AC-91, AC-200, AC-88 | ⚠️ prod ölçümü/provası | T6/R1'e bağlı; kod tarafı hazır. P13b kod kapısını bloklamaz ama prod açılış listesinde kalır |
| AC-90 (CLI, kanca) | ✅ | CLI testi + test-backup "komut metni logda yok" |
| AC-196 + S-P13b-3 WhatsApp servis anahtarı | ✅ davranış / ⚠️ belge | Entegrasyon `whatsapp-admin-p12b.test.ts` "S-P13b-3" bloğu (3 test) okundu ve kriteri gerçekten doğruluyor: env anahtarı yalnız env adresine; panel anahtarı DB'de şifreli (düz metin taraması), yanıtta ve audit'te değer yok (`apiKey:"***"`, `apiKeySet`, `apiKeyChanged`); alan yok/`""` → korunur, audit yok; köken değişince 400 `fields.apiKey = WA_API_KEY_REENTER`; `null` → silinir ve başlık gitmez (env anahtarı panel adresine sızmaz); DELETE → `secret_enc` NULL, env anahtarı geri gelir; servis 401 → "Servis anahtarı reddetti." + audit `reason: unauthorized`; geçersiz anahtarlar 400. Unit `whatsapp-runtime-p12b`: 401'de yeniden deneme yok. Migration CHECK'i `whatsapp-setting.test.ts` ve `check-app-grants.sh` (387) ile sınanıyor. **Ancak** bu iş için `docs/gereksinimler-p13b.md`'de AC yok, `docs/mimari.md:112` hâlâ "`secret_enc` NULL — servis API anahtarı desteklenince Sonra" diyor (Düzeltilmeli 3) |
| G-P13b-2 | ✅ kodda / ❌ README | Tur 1 madde 6 açık |

## Düzeltilmeli (somut, uygulanabilir; her madde bir ajana atanır)
1. **[frontend-dev] — Önem: Orta** — `apps/web/app/(panel)/admin/settings/whatsapp/whatsapp-form.tsx` 274 satırdan **378**'e çıktı. Böylece P13b'de 300 satır sınırını yeni aşmış oldu ve implementation.md'de gerekçesi yok (kalite-standartlari §15). **Beklenen:** "Servis anahtarı" bölümü (`Section id="wa-key"`, `TextField`, kaldırma butonu, `alertdialog`, `doKeyRemove`) ayrı bir bileşene, ör. `whatsapp/whatsapp-key-section.tsx`, taşınmalı ve form ≤ 300 satıra inmeli. e2e `p12b-whatsapp.spec.ts` S-P13b-3 senaryoları yeşil kalmalı.
2. **[backend-dev] — Önem: Düşük** — `apps/server/src/settings/system.ts` 364'ten **409**'a, `apps/server/src/notify/whatsapp.ts` 333'ten **345**'e büyüdü. İkisi de zaten sınırın üstündeydi ve büyüme gerekçelenmemiş. **Beklenen:** WhatsApp ayar bölümü (`asWaUrl`, `readWhatsapp`, `effectiveWhatsappTarget`, `decryptWaKey`, `get/save/deleteWhatsappSettings`, test kovaları) `settings/whatsapp.ts`'e taşınmalı. Taşınmıyorsa gerekçe implementation.md'ye yazılmalı. `notify/whatsapp.ts` için gerekçe yeterli.
3. **[proje-yoneticisi + mimar] — Önem: Orta (kural: AC'si ve mimari karşılığı olmayan özellik kodlanmaz)** — S-P13b-3 servis anahtarı bir kullanıcı kararıyla P13b'ye eklendi, ama:
   - `docs/gereksinimler-p13b.md`'de AC'si yok (AC sayımı hâlâ "AC-298..AC-302");
   - `docs/mimari.md:112` `system_settings.whatsapp` satırı "`secret_enc` NULL — servis API anahtarı desteklenince Sonra" diyor;
   - `docs/mimari-e9.md:344` K13 "Sonra" diyor.

   **Beklenen:**
   - proje-yoneticisi: `gereksinimler-p13b.md`'ye bir AC eklemeli (ör. AC-303). İçeriği implementation.md'deki sözleşmeyle aynı olmalı: `x-api-key`, adrese bağlı anahtar, köken değişince yeniden giriş, maskeli/şifreli saklama, 401 mesajı, audit'te değer yok.
   - mimar: `mimari.md` veri modeli satırını ve K13'ü güncellemeli. Gerekirse `mimari-p13.md`'ye bir bölüm eklemeli: AAD `system_settings.secret_enc:whatsapp:<origin>`, DELETE'te panel anahtarının silinmesi.

   Davranış testlerle zaten kanıtlı; eksik olan yalnız izlenebilirlik.
4. **[teknik-yazar] — Önem: Orta (W1, Tur 1 madde 6 devam)** — `README.md:672`: varsayılan adres cümlesi silinmeli, "Kimlik bilgisi yok" yerine "isteğe bağlı servis anahtarı (`x-api-key`): panelde şifreli alan ya da `WHATSAPP_SERVICE_API_KEY`" yazılmalı. Kılavuza "Servis anahtarı" alanı eklenmeli (backend notu). Repo public olmadan önce kapanmalı (G-P13b-2/S-P13b-3).

## Definition of Done
| Madde | ✅/❌ | Not |
|---|---|---|
| Lint / typecheck temiz | ✅ | |
| Unit testler yeşil, skip yok | ✅ | 682/682 |
| Entegrasyon testleri yeşil | ✅ (not) | 540/541 + kırmızı dosya tek başına 14/14. Kararsız test P13b dışında (Öneriler) |
| e2e (mock) yeşil | ✅ | 308 geçti, skip'ler proje kapılı ve gerekçeli |
| Her AC'nin tekrar üretilebilir test kanıtı | ✅ | AC-298/300/301 artık `test-backup.sh` ile (55 PASS). Prod ölçümleri T6/R1'de |
| Özellik için AC + mimari karşılığı | ❌ | S-P13b-3 (madde 3) |
| Tasarım–kod uyumu; sapmalar gerekçeli | ✅ | Anahtarın adresle gitmesi, köken değişiminde 400, DELETE'te silme, CHECK gevşetmesi implementation.md'de gerekçeli; dba incelemesi db-notlari'nda (up/down/yeniden up, drift 0) |
| Yeni env kuralı (.env.example + env.ts + compose + runbook) | ✅ | `WHATSAPP_SERVICE_API_KEY`: `.env.example:54` boş, `env.ts:73` şemalı, compose `:116`, runbook `:82`, `:211`, `:1949` |
| Dosya ≤ 300 satır | ❌ | madde 1 (yeni aşım), madde 2 (gerekçesiz büyüme) |
| Ölü kod yok | ✅ | Tur 1 madde 3 kapandı |
| shellcheck / bash -n | ✅ | temiz |
| Gizli bilgi / PII log yok | ✅ | Anahtar yanıtta, logda (`*.apiKey` redakte, `keySet` bool) ve audit'te yok; DB'de AES-256-GCM, köken AAD'li. Test bunu düz metin taramasıyla doğruluyor |
| Hata yutma yok | ✅ | `decryptWaKey` catch → alarm logu + başlıksız gönderim (gerekçeli, fail-visible: servis 401 → kullanıcıya mesaj) |
| Transaction | ✅ | `saveWhatsappSettings` okuma, köken kontrolü, upsert ve audit tek TX'te; route `waSerial` ile serileştiriliyor |
| Yeni bağımlılık | ✅ | yok |
| Grants / migration | ✅ | yeni tablo yok; CHECK değişikliği dba onaylı, `check-app-grants` +3 |
| 5 durum + a11y (yeni UI) | ✅ | anahtar bölümü: boş/rozet, hata (alan hatası + odak), yükleniyor (`busy`/`loading`), onaylı `alertdialog`; axe light/dark + 390 px yeşil; ikon `KeyRound`/`Trash2` lucide |
| Runbook / dokümanlar | ⚠️ | runbook env satırı var; README/kılavuz W1 (madde 4) |

## Öneriler (zorunlu değil)
- [backend-dev] `settings-p11.test.ts:118` (AC-78) gerçek MySQL'e bağlantı testi yapıyor ve makine yüklüyken `ok:false` dönebiliyor (bu turda bir kez, eşzamanlı ikinci MySQL kurulumu sırasında). Test içindeki bağlantı zaman aşımı test ortamında artırılabilir ya da hata nedeni assertion mesajına eklenebilir, böylece kararsızlık teşhis edilebilir.
- `whatsapp-form.tsx` anahtar alanında `maxLength={300}`, sözleşme 256. İstemci kontrolü `checkWaApiKey` bunu yakalıyor; `maxLength` `WA_API_KEY_MAX`'tan alınırsa tek kaynak olur.
- `wa-key-remove-dialog` iptal metni `rq.rj.cancel` (talep reddi modülü) anahtarından geliyor; ortak bir `common.cancel` anahtarı daha temiz olur.
- Üretim dışı ortamda `http://` + genel adres kullanılırsa `x-api-key` düz metin gider (prod'da kanal zaten kapalı). Staging için runbook'ta "anahtar yalnız https/özel ağ adresiyle" notu yazılabilir. Karar güvenlik ajanına bırakıldı.

## Olumlu
- Tur 1'in Yüksek maddesi tam kapandı. Yedek testi tek komutla, dind olmadan ve kendini temizleyerek çalışıyor; bu turda bağımsız olarak 55/55 doğrulandı. Kurcalanmış döküm senaryosu sunucu tarafı yolunu da sınıyor (`SELECT 1; USE mysql`).
- Bölme sırasında testin yakaladığı bir hata var: işaret dosyasının 600'e normalleştirilmesi işareti geçerli kılıyordu. Hata daraltılarak düzeltilmiş.
- Anahtar tasarımı sağlam: anahtar köken AAD'sine bağlı, env anahtarı panel adresine sızmıyor ve bu testle sabit. Audit'te var/yok/değişti ayrımı da korunmuş.
- Migration tek ALTER ile yazılmış, down betiği var, dba up/down/up döngüsünü sınamış.

---

# QA Raporu — Tur 1 (P13b prod açılışı, kod denetimi)
Tarih: 2026-11-15 · Denetçi: qa-denetci · Kapsam: `apps/server` (reset-superadmin CLI, HSTS, TURN credential önbelleği, WhatsApp varsayılan adresinin kaldırılması, geçici parola süresi), `packages/contracts`, `deploy/mysql/*`, `deploy/backup/*`, `deploy/turn/*`, `deploy/ops/*`, Caddyfile/test-caddy, compose, `.env.example`, CI. T5 (runbook) ve W1 (dokümanlar) denetim dışı; yalnız kodla tutarsızlıklar not edildi.

DURUM: DÜZELTİLMELİ

## Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` | temiz (çıkış 0) |
| `pnpm -r run typecheck` | temiz (çıkış 0) |
| `pnpm -r run test` | contracts 78/78, web 249/249, server unit 350/350. Skip yok |
| `eval "$(apps/server/scripts/test-db.sh up)" && pnpm --filter @remote/server test:int` (geçici konteyner `rs-qa-p13b-*`, port 33391, iş sonunda `test-db.sh down` ile silindi) | **54 dosya, 538/538 geçti**, skip yok; konteyner `rs-qa-p13b-12bb4e` silindi (docker ps boş) |
| `bash -n` (deploy/backup, turn, ops, mysql, test-caddy) | hepsi temiz |
| `shellcheck -x -S warning` (`koalaman/shellcheck:stable`, salt okunur bağlama) | backup.sh, restore.sh, lib.sh, cert-deploy-hook.sh, test-cert-hook.sh, host-firewall.sh, remote-watch.sh, test-watch.sh, check-app-grants.sh, test-caddy.sh **temiz**. Kalan uyarılar: `turn/test-denied.sh:26` SC2164, `:99` SC2034; `turn/test-local.sh:12` SC2155; `turn/entrypoint.sh:40` SC2154. P13b'de üç dosya da değişti |

Yeniden çalıştırılmayanlar: `deploy/ops/test-watch.sh`, `deploy/turn/test-cert-hook.sh`, `deploy/turn/test-local.sh`, `deploy/test-caddy.sh`. Bunlar root yardımcı konteyner ya da gerçek coturn/caddy istiyor. Kanıt olarak implementation.md'deki kayıtlar kabul edildi: test-watch 48 PASS, test-cert-hook 14+25 PASS, test-local 65 PASS, test-caddy GEÇTİ. T1 yedek testlerinin (49/49) betiği **repoda yok**; bkz. Düzeltilmeli 1.

## Kabul kriterleri
| AC | Durum | Kanıt veya eksik |
|---|---|---|
| AC-299 reset-superadmin | ✅ | `superadmin-reset-p13b.test.ts` (7 test): hash değişimi, `must_change`, kilit ve sayaç sıfırlama, oturum ve sıfırlama bağlantısı iptali, eski çerez 401, parolanın çıktıda tam 1 kez görünmesi, audit ve logda parola/hash olmaması (AC-90), `--reset-mfa`, ADMIN/PASSIVE/silinmiş/olmayan hesap → 3 ve değişiklik yok, dry-run 0/3, pipe ile gerçek süreçte 4, kullanım hatası 2, DB hatası 5 ve ref. Testleri okudum; her biri kriteri gerçekten doğruluyor |
| AC-126 (revize) HSTS | ✅ | `app.ts` helmet `includeSubDomains: true, preload: false`; `ops-headers.test.ts` değeri birebir doğruluyor; Caddyfile `?Strict-Transport-Security "max-age=31536000; includeSubDomains"`; `test-caddy.sh` başlık bölümü (kayıt: GEÇTİ, yeniden çalıştırılmadı) |
| AC-298 yedek imzası / migrator / CHECKSUM / ortam kilidi | ⚠️ kanıtsız | Kod tasarıma uygun: `restore.sh` önce imzayı doğruluyor, `--target`, `--confirm`, TTY ve `manifest.env` kontrollerini yapıyor; yükleme migrator ile `--system-command=OFF --local-infile=0`; `checksum-tables.sql` var. Olumsuz testler (imzasız, bozuk imza, değiştirilmiş manifest, kurcalanmış döküm, yanlış ortam) yalnız implementation.md'de "49/49 PASS" olarak anlatılıyor. Test betiği repoda yok, tekrar üretilemiyor (Düzeltilmeli 1). "Kurcalanmış döküm (`CREATE USER`, `GRANT ON *.*`) → FAIL, kalıcı iz yok" maddesinin test kaydında açık karşılığı da yok |
| AC-300 site dışı kanca | ⚠️ kanıtsız | Kod var: `backup.sh` kancası (setpriv, timeout, `OFFSITE OK`/`OFFSITE-FAILED`/`OFFSITE-UNCONFIGURED`, `status.prom` `offsite_configured`). Kanıt AC-298 ile aynı nedenle tekrar üretilemiyor |
| AC-301 audit süreklilik | ⚠️ kanıtsız | `audit-continuity.sql` + `backup.sh` karşılaştırması mevcut. TRUNCATE ve tek DELETE testleri yalnız anlatımda var (Düzeltilmeli 1). Ayrıca devops'un sıkılaştırdığı "taban-cizgisi-kaydi-kayboldu" kuralı `audit-continuity.sql` başlığındaki kural 2'ye işlenmemiş (Düzeltilmeli 4) |
| AC-302 remote-watch | ✅ (kayıtla) | `deploy/ops/test-watch.sh` repoda; 48 PASS kaydı var: servis durdurma → ALERT, tekrar bastırma, 360 dk sonra yeniden alarm, DUZELDI bir kez. Bu turda yeniden çalıştırılmadı |
| AC-21/22 (TURN aralık, kota, bps) | ✅ (kayıtla) | `turnserver.base.conf` 49160–49479, `total-quota=300`; `TURN_MAX_BPS=1000000` ölçümü kayıtlı; `signaling-lifecycle.test.ts` "G-P13b-1/AC-22": yeniden bağlanmada aynı username, ≤ 2 geçerli credential |
| AC-23 (revize) 5349 | ⚠️ prod ölçümü | Kod tarafı hazır (cert-deploy-hook, compose bağlaması). Ölçüm R1/T6'da; bu turda kanıt olamaz |
| AC-91, AC-200 (revize), AC-88 | ⚠️ prod provası | T6/R1'e bağlı; kod tarafı AC-298 ile aynı açığı taşıyor |
| AC-90 (CLI ve kanca) | ✅ / ⚠️ | CLI tarafı test ile ✅. Kanca komut metninin loglanmaması yalnız anlatımda kanıtlı (Düzeltilmeli 1) |
| S-P13a-8 (file.transfer audit) | ✅ | P13a'da kapanmış; `signaling-collab-p5*` ve `file-names` testleri yeşil |
| G-P13b-2 (varsayılan WhatsApp adresi) | ✅ kodda / ⚠️ dokümanda | `env.ts`'te `DEFAULT_WHATSAPP_URL` kaldırıldı, boş adres "yapılandırılmamış" yoluna gidiyor; `env-logger`, `whatsapp-admin-p12b` ve `whatsapp-setting` testleri yeni davranışı doğruluyor. Kod ve deploy ağacında `89.252.189.211` kalmadı. `README.md:672` hâlâ "o da yoksa varsayılan `http://89.252.189.211:3000`" diyor: hem kodla çelişiyor hem repo public öncesi temizlenecek adres (W1) |
| G-P13b-10 (geçici parola süresi) | ✅ | `auth/service.ts:136` + `superadminTempPasswordExpired`; test 25 sa → 401 + audit `temp_password_expired`, 23 sa → 200, yanlış parolada genel mesaj |

## Düzeltilmeli (somut, uygulanabilir; her madde bir ajana atanır)
1. **[devops] — Önem: Yüksek** — T1 yedek testleri repoda yok. `deploy/backup/` altında `test-*.sh` bulunmuyor; implementation.md'deki "49/49 PASS" (imzasız, bozuk imza, değiştirilmiş manifest, yabancı anahtar, yanlış DEPLOY_ENV, `env=staging` → production, TTY yok, kanca rc≠0, `x-api-key` reddi, TRUNCATE, tek DELETE, tetikleyici DROP, imza anahtarı 644) tekrar üretilemiyor. Bu durum AC-298, 300 ve 301'i kanıtsız bırakıyor. **Beklenen:** `deploy/ops/test-watch.sh` kalıbında `deploy/backup/test-backup.sh` commit edilmeli. Benzersiz compose projesi kullanmalı, dind olmamalı, kendini temizlemeli. AC-298'deki "kurcalanmış döküm (`CREATE USER`, `GRANT … ON *.*`, `SET PERSIST`, `INSTALL COMPONENT`, `USE mysql; INSERT`) → yükleme FAIL ve kalıcı iz yok" senaryosu açık bir test olarak eklenmeli. Komut ve son PASS sayısı implementation.md'ye yazılmalı.
2. **[devops] — Önem: Orta** — Dosya ≤ 300 satır kuralı (kalite-standartlari §15; B1 kabul ölçütü de ≤ 300 diyor) gerekçesiz aşılmış:
   - `deploy/backup/backup.sh` 454 satır (P13a: 246);
   - `deploy/backup/restore.sh` 351 satır (270);
   - `deploy/turn/host-firewall.sh` 344 satır (294);
   - `deploy/ops/remote-watch.sh` 313 satır (yeni).

   **Beklenen:** bölünmeli. Örneğin `backup.sh` → `lib-offsite.sh` (kanca + status.prom) ve `lib-audit.sh` (süreklilik karşılaştırması); `restore.sh` → imza/ortam kilidi ile yükleme ayrılır. Bölünmüyorsa gerekçe implementation.md'ye yazılmalı. `check-app-grants.sh` (489 satır) önceden de 300'ün üstündeydi; dba bilgisine.
3. **[frontend-dev] — Önem: Düşük** — Ölü kod: sunucu artık `source:"default"` göndermiyor. Şu yerler temizlenmeli:
   - `apps/web/app/(panel)/admin/settings/whatsapp/whatsapp-form.tsx:154` (`wa-svc-default-source` uyarısı), `:166` (`fallback` rozeti), `:184` (`urlHintDefault` dalı) ve ilgili i18n anahtarları (`wa.svc.defaultSource`, `defaultBadge`, `urlHintDefault`);
   - **[backend-dev]** `packages/contracts/src/api/system-settings.ts:189` tipindeki `"default"` üyesi (sözleşme yalnız `"panel" | "env"` olmalı).

   **Beklenen:** tip daraltıldığında typecheck ölü dalları gösterir; ilgili web ve contracts testleri buna göre güncellenir.
4. **[dba] — Önem: Düşük** — `deploy/mysql/audit-continuity.sql` başlığındaki karşılaştırma kuralı 2, devops'un uyguladığı sıkılaştırmayı içermiyor. Kural şu: `baseline.id` farkı yalnız `baseline.at > P.audit.measuredAtUtc` ise uyarıdır, aksi hâlde `FAILED taban-cizgisi-kaydi-kayboldu`; bkz. implementation.md T1 "Kararlar". **Beklenen:** SQL başlığı ile `backup.sh` aynı kuralı söylemeli; db-notlari "P13b" de güncellenmeli.
5. **[devops] — Önem: Düşük** — P13b'de değişen `deploy/turn/test-denied.sh` (`:26` SC2164, `:99` SC2034 `v6_ok` kullanılmıyor), `deploy/turn/test-local.sh:12` (SC2155) ve `deploy/turn/entrypoint.sh:40` (SC2154) shellcheck uyarısı veriyor. T2 kabul ölçütü "shellcheck temiz". **Beklenen:** uyarılar giderilmeli ya da gerekçeli `# shellcheck disable=` ile kapatılmalı.
6. **[teknik-yazar] — Önem: Orta (W1'de yapılacak, kodla tutarsızlık)** — `README.md:672` hâlâ yerleşik varsayılan adresi (`http://89.252.189.211:3000`) anlatıyor. Kod artık varsayılan kullanmıyor; boş adres "kanal kapalı" demek. Ayrıca G-P13b-2 gereği bu adres repo public olmadan önce kaldırılmalı. **Beklenen:** "panel kaydı yoksa `WHATSAPP_SERVICE_URL`; o da boşsa kanal yapılandırılmamış/kapalı."

## Definition of Done
| Madde | ✅/❌ | Not |
|---|---|---|
| Lint / typecheck temiz | ✅ | |
| Unit testler yeşil, skip yok | ✅ | 677/677 |
| Entegrasyon testleri yeşil | ✅ | 538/538 | |
| Her AC'nin tekrar üretilebilir test kanıtı | ❌ | AC-298/300/301 test betiği repoda yok (madde 1) |
| Tasarım–kod uyumu; sapmalar implementation.md'de gerekçeli | ✅ | Gerekçeli sapmalar: audit etiketi `labels.ts` yerine `actions.ts`; `mustChangePassword` mask izni; dry-run de TTY ister; geçici parola süresi audit kaydından okunur (sütun yok); `watch.env` `/etc/remote-watch/`'e taşındı; `TURN_BPS_CAPACITY=0` + host hashlimit; `audit.days` `{n,h}`; §7.9 "env.ts değişmez" ihlali G-P13b-2 ile gerekçeli (yalnız kaldırma, yeni env yok) |
| Yeni env kuralı (.env.example + env.ts + compose + runbook) | ✅ (runbook T5'te) | `DEPLOY_ENV`, `TURN_FW_RELAY_MAX_BPS`, `TURN_CERT_DIR` `.env.example`'da boş; env.ts ve compose istisnası gerekçeli (server okumuyor). `WHATSAPP_SERVICE_URL: ${WHATSAPP_SERVICE_URL:-}` compose'da. Runbook T5 bekleniyor |
| Dosya ≤ 300 satır | ❌ | madde 2 |
| Ölü kod yok | ❌ | madde 3 |
| shellcheck / bash -n | ⚠️ | bash -n tamamı temiz; shellcheck 4 eski uyarı (madde 5) |
| Gizli bilgi / PII log yok | ✅ | CLI parolası audit ve logda yok (test); kanca/alarm komutu metni loglanmıyor, sır deseni reddi var (kod); `.env.example` değerleri boş |
| Hata yutma yok | ✅ | CLI `catch` blokları ya kullanım hatası (2) ya ref'li 5 dönüyor; `close().catch` yalnız kapanışta |
| Transaction | ✅ | `resetSuperadmin` tek TX + koşullu UPDATE (yarışta `not_found`); argon2 TX dışında |
| Yeni bağımlılık | ✅ | yok (`node:util parseArgs`, mevcut pino/zod; host araçları openssh/age/jq/setpriv runbook önkoşulu) |
| Grants (yeni tablo → grants.sql) | ✅ | yeni tablo yok; `check-app-grants.sh` 384 kontrol, anonim hesap = 0 eklendi, CI'a `MIGRATOR_PW` geçildi |
| Runbook / dokümanlar | — | T5/W1 kapsam dışı (madde 6 not) |

## Öneriler (zorunlu değil)
- CI'a `shellcheck -S warning` adımı (SHA sabitli) eklenirse deploy betiklerindeki uyarılar regresyon olmaktan çıkar. Şu an CI yalnız `test-caddy.sh` ve `check-app-grants.sh` çalıştırıyor.
- `superadminTempPasswordExpired` audit kaydına dayanıyor. Audit saklama/anonimleştirme işi (P13a) `auth.superadmin_reset` kaydını 24 saatten önce silmediği sürece doğru çalışır; bunu bir yorumla ya da testle sabitlemek iyi olur.
- `reset-superadmin` bant dışı bildirimi (G-P13b-10 kalanı): T5'te host sarmalayıcı ya da `remote-watch` sayacı.
- `grant()` önbelleği (`active.ts`) `rooms.turn` nesne kimliğine bakıyor. Panel TURN ayarı değişince yeni nesne geldiği test ediliyor; ileride config yeniden kullanılırsa `cfg` karşılaştırması sessizce eski credential döndürebilir. Nesne kimliği yerine sürüm sayacı daha sağlam olur.

## Olumlu
- CLI tasarıma birebir uyuyor: argüman → TTY → env/DB sırası sayesinde TTY yokken DB'ye hiç bağlanılmıyor. Bu, gerçek süreçte pipe ile test edildi.
- Testler parolanın çıktıda tam bir kez görünmesini, audit/log taramasını ve yarış durumunu (koşullu UPDATE) kapsıyor.
- Deploy ve kod ağacında altyapı IP'si kalmadı (README hariç); boş WhatsApp adresi fail-closed çalışıyor.
- TURN credential önbelleği, yeniden bağlanmanın coturn `user-quota`'sını şişirmesini engelliyor ve testle sabitlenmiş.
- Sertifika hook'u ve remote-watch'ta sembolik bağlantı, sahiplik ve izin denetimleri ile sır deseni reddi kapsamlı.

---

## P13b-L — Tur 1
Tarih: 2026-11-15 · Kapsam: bekleme odası (lobi) göstergesi, AC-304..316 (`docs/gereksinimler-lobi-gostergesi.md`, `docs/mimari-lobi.md`, ADR-0029). Değişiklikler commit edilmemiş çalışma ağacında. Kod değiştirilmedi.

DURUM: DÜZELTİLMELİ

### Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` | temiz (çıkış 0, uyarı yok) |
| `pnpm -r run typecheck` | temiz (çıkış 0) |
| `pnpm -r run test` (unit) | contracts 78/78, web **271/271** (27 dosya; yeni `lib/lobby/diff.test.ts` 10 test, `lib/tab-title.test.ts` 8 test), server **367/367** (yeni `lobby-count-p13bl.test.ts` 13 test). Skip yok |
| `test-db.sh up` (konteyner `rs-p13bl-qa-93483`, port 34783) + `pnpm --filter @remote/server test:int` | **553/553** (55 dosya). Ardından `down`; konteyner silindiği doğrulandı |
| AC-314 perf çıktısı | `GET /sessions/waiting 1000 istek, 100 oda/300 misafir: p50=5.60 ms p95=8.94 ms` (hedef ≤ 100 ms). test-operatoru `docs/test-raporu.md`'ye aktarır |
| `pnpm --filter @remote/web e2e` (tam paket) | **329 geçti, 0 kaldı, 132 skip** (çıkış 0). `p13bl-lobby.spec.ts`: 14 test × 2 proje → 19 geçti, 9 skip. Skip'lerin tamamı `mobile` projesinde, `desktopOnly(...)` "masaüstü akışı" gerekçesiyle (mevcut desen). Mobilde koşanlar: AC-305, 306/312 (360 px), 312 (axe), 315 (×2) |

### Kabul kriterleri
| AC | Durum | Kanıt veya eksik |
|---|---|---|
| AC-304 | ✅ | e2e `AC-304/305/307/311: liste açıkken misafir gelir …`: gerçek misafir join, ardından tek yoklama turu (`clock.runFor(10_000)`) → "Müşteri bekliyor (1)" bağlantısı. Tık → `/sessions/:id/console`, `lobby-panel` `toBeInViewport` (1280×800). Kabul kodu girilince "Aktif". Sunucu: entegrasyon `AC-305/309: USER listesinde …` `waitingGuests` 1/3 |
| AC-305 | ✅ | Unit `lobby-count-p13bl`: 0/1/3, TICKETED sayılmıyor; ayrılma, ret, 5 dk zaman aşımı, kabul (`admitted`), iptal (`closeSession`), `ending`, `expiresAt` geçmiş → 0; ön-kabullü misafir sayılmıyor. Entegrasyon: ret ve ADMIN iptali sonrası uç ve liste 0, ENDED satır 0; P8 liste testi her öğede `waitingGuests === 0`, detayda alan yok. e2e `AC-305: waiting 3 → (3); 0 → rozet kaybolur`: tek turda (≤ 10 sn), yuva kalıyor; ACTIVE/EXPIRED satırda yuva yok |
| AC-306 | ✅ | e2e `AC-306/312` (`u-noreq`, Talepler menüsü yok): "/" sayfasında tek turda sayaç "1"; 0'da gizli; 360 px'te `toBeInViewport`; erişilebilir ad "1 müşteri bekleme odasında". Entegrasyon: `session_history.view` ile liste 200 alınıyor, uç 403; layout koşulu yalnız `sessions.view`. Konsolda sayaç: e2e `AC-306/307`. **Not:** AC'deki "menü düğmesinde işaret" maddesi için panelde açılır/kapanır menü düğmesi yok, menü yatay şerit (mimari K-L3). AC metni bununla uyumlu değil (madde 3) |
| AC-307 | ✅ | Unit `diff.test.ts`: temel çizgi, tek/iki oturum, aynı misafir, çık-gir, gelip giden, restart, açık konsol. e2e `AC-307`: tek toast; ikinci turda yeni toast yok ve ilki 10 sn sonra hâlâ görünür (`durationMs` 15 000); yeniden yükleme → toast yok, sayaç var; 2 misafir → "Bekleme odasında 2 müşteri var" + "Oturumlara git" `/sessions`; bölge `role="status"`. Konsolda toast yok: e2e `AC-306/307` |
| AC-308 | ✅ | Unit `tab-title.test.ts`: önek, 0'da eski başlık, lobi önce + talep sonra, idempotent, `/console` istisnası. e2e: gizli sekmede `(1) Müşteri bekliyor — (3) Talepler · …`, görünür olunca yalnız talep öneki; yalnız lobi senaryosu |
| AC-309 | ✅ | Entegrasyon: USER-A/B/C yalnız kendi sayısını görüyor; ADMIN `count` 0 ama listede B'nin satırında 2; tenant-1 ADMIN listesinde tenant-2 oturumu yok; sorgu dizesiyle (`technicianId`, `tenantId`) süzme atlatılamıyor. Unit: `waitingFor` tenant + teknisyen süzmesi. e2e `AC-309`: başkasının satırında bağlantısız rozet, tek bağlantı, sayaç 1 |
| AC-310 | ✅ | Entegrasyon: firma seçmemiş SA → 403 "Önce bir firma seçin."; liste `waitingGuests` döndürüyor; firma A'da kendi oturumu sayılıyor, B'de sayılmıyor. e2e `AC-310`: rozet var, bağlantı yok ("Konsolu aç" de yok), sayaç ve `lobby-live` yok, waiting ucu hiç çağrılmıyor. Firma seçmiş SA'da sayaç ve toast çalışıyor |
| AC-311 | ✅ | `waitingSessionsResponseSchema` strict (unit: ek alan reddi). Entegrasyon gövdesinde ad, e-posta, IP, `admitCode`, `BROWSER` yok. e2e: "Ayşe Yılmaz" rozet, toast, menü, `main` ve başlıkta yok, yalnız konsol lobi listesinde var |
| AC-312 | ⚠️ kanıt eksik | Metin + `BellRing`, `navSr`, `aria-live` tekrar duyurmama (MutationObserver sayacı 0), axe açık/koyu 0 ihlal (desktop 1280 ve mobile **412 px** Pixel 7), Enter ile konsol: kanıtlı. **Eksik:** (a) AC "360 px genişlikte yatay taşma yok" ve mimari §9.3 "axe 360 ve 1280 px" ister. 360 px yalnız "/" sayfasında taşma için ölçülüyor; rozetin bulunduğu `/sessions` kart görünümü 360 px'te ne taşma ne axe ile ölçülüyor. (b) "Klavyeyle odaklanabilir" `locator.focus()` ile sınanıyor; Tab sırasında erişilebilirlik kanıtlanmıyor (madde 1) |
| AC-313 | ✅ | e2e `AC-313` (desktop): menü sayacı ve satır rozetinde hesaplanan `transition-property: opacity, transform`, 0.2 sn, `linear`/`ease-in` yok, animasyon yok/sonsuz değil; reduced-motion'da `opacity`. Kaybolurken yer kayması yok: n = 0 yuvası `invisible` (e2e `waiting-slot`). Panelde açılır/kapanır menü yok |
| AC-314 | ✅ | Entegrasyon: 401 çerezsiz, 403 yetkisiz, başka tenant/teknisyen yok, `Cache-Control: no-store`, audit satırı sayısı değişmiyor, 60 istek 200 / 61. istek 429 `RATE_LIMITED` + `Retry-After`, başka kullanıcı etkilenmiyor; perf p95 8.94 ms. Tenant matrisi (`tenant-matrix.ts`) uca `scoped` sınıfı atıyor. e2e: 429'da `Retry-After` (30 sn) boyunca ek yoklama yok |
| AC-315 | ✅ | e2e `AC-315: 500 → son değer` ve `ağ kesilir → son değer; sunucu yeniden başlar → ≤ 10 sn sayaç 0`: toast yok; `afterEach` konsol bekçisi (uygulama `console.error/warn` + `pageerror` = 0; yalnız tarayıcının ağ satırları süzülüyor). Unit: yeni `Rooms` örneği → 0. Liste "Liste güncellenemedi…" uyarısı değişmedi (mevcut `sessions.spec` yeşil) |
| AC-316 | — staging'de test-operatoru | Bloklayıcı sayılmadı (koordinatör talimatı). Senaryo: mimari-lobi §9.4 |

### Tasarım–kod uyumu
- Sözleşme (§4.3) birebir: sabitler, strict şema, `SessionListItem.waitingGuests`, `SessionHistoryDetail` Omit. Guard sırası (§4.1) `requirePerm` → `tenantScope` → hız sınırı; `/:id`'den önce kayıtlı. `LOBBY_MAX = LOBBY_GUEST_MAX` tek kaynak.
- Bellek sayımı §3 koşullarıyla aynı (`LOBBY` durumu, `!ending && !admitted && expiresAt > now`); DB'ye gidilmiyor.
- Web §6.1–6.8 birebir: layout `lobby` koşulu ve `scopeKey`, `setTimeout` zinciri, gizli sekmede yoklama, hata tablosu (401/403/429/ağ), `arrivals` tabanlı tekilleştirme, tek başlık yazıcısı (`TabTitle`), `role="status"`, i18n anahtarları, warning token'ları, `BellRing`.
- implementation.md'de gerekçeli sapmalar: `customers/service.ts` aynı tipte tutarlılık için `rooms` geçiriyor; perf 20 kullanıcıya bölündü; mock "restart" oda başına; `/__e2e/lobby-extra`; `LobbyDot` P14b'ye (K-L3). Hepsi kabul edilebilir.
- DB, migration, grant, env değişikliği yok. Runbook satırı ve `mimari-api.md` güncellendi. Yeni bağımlılık yok.

### Düzeltilmeli (somut, uygulanabilir; her madde bir ajana atanır)
1. **[frontend-dev] — Önem: Orta (AC-312 kanıtı)** — `apps/web/e2e/p13bl-lobby.spec.ts:299-332` (`AC-312: axe …`). Bu test desktop'ta 1280 px'te, mobile projesinde Pixel 7 (412 px) genişliğinde koşuyor. AC-312 ise 360 px'te taşma olmadığının ve axe kontrolünün kanıtını ister (mimari-lobi §9.3 "axe (iki tema, 360 ve 1280 px)"). Bugün 360 px yalnız `:162-181` testinde "/" sayfası için ölçülüyor. **Beklenen:** `/sessions` sayfasında rozet görünürken (`setLobby` + `tick`) `page.setViewportSize({ width: 360, height: 740 })` ile kart görünümünde `noHorizontalOverflow` ve iki temada `axeScan` 0 ihlal sağlanmalı. Rozetin klavye erişimi `focus()` yerine `page.keyboard.press("Tab")` döngüsüyle kanıtlanmalı: rozet bağlantısı Tab sırasında odak alabilmeli, sonra Enter konsolu açmalı.
2. **[backend-dev] — Önem: Düşük (DoD dosya boyutu, önceki turlarla tutarlı)** — `apps/server/src/signaling/rooms.ts` 327 satırdan 355 satıra çıktı (+28: `waitingIn`, `waitingFor`, `lobbyWaiting`). Dosya zaten 300 sınırını aşıyordu ve büyümenin implementation.md'de gerekçesi yok (kalite-standartlari §15). `sessions/history.ts` de 419'dan 427'ye çıktı. **Beklenen:** ya sayım fonksiyonları `Rooms`'un `rooms` haritasını alan saf bir modüle (ör. `signaling/lobby-count.ts`) taşınmalı, ya da implementation.md "P13b-L — backend" bölümüne gerekçe yazılmalı (tasarım §10.1 yeri `rooms.ts` olarak belirledi; özel `rooms` haritasına erişim gerekiyor).
3. **[proje-yoneticisi] — Önem: Düşük (AC metni ile tasarım uyumu)** — `docs/gereksinimler-lobi-gostergesi.md` AC-306 "Mobil genişlikte menü kapalıyken menü düğmesinde de bir işaret görünür … 360 px genişlikte menü düğmesinde işaret" diyor. Panelde açılır/kapanır menü düğmesi yok; mimari K-L3 bunu P14b'ye bıraktı ama AC metni güncellenmedi (K-L1, K-L2 ve R-L7 güncellendi). **Beklenen:** AC-306 şöyle düzeltilmeli: "360 px'te sayaç 'Oturumlar' öğesinde görünür; açılır mobil menü geldiğinde (P14b, AC-222) menü düğmesinde işaret". P14b AC listesine `LobbyDot` bağlantısı eklenmeli.

### Definition of Done
| Madde | ✅/❌ | Not |
|---|---|---|
| Lint / typecheck temiz | ✅ | |
| Unit testler yeşil, skip yok | ✅ | 78 + 271 + 367 |
| Entegrasyon testleri yeşil | ✅ | 553/553 |
| e2e yeşil; skip'ler gerekçeli | ✅ | 329 geçti; P13b-L mobil skip'leri `desktopOnly` gerekçeli |
| Her AC'nin test kanıtı | ❌ | AC-312'de 360 px kanıtı eksik (madde 1); AC-316 staging (beklemede, bloklayıcı değil) |
| Tasarım–kod uyumu; sapmalar gerekçeli | ✅ | Bkz. "Tasarım–kod uyumu" |
| Katman: route ince, iş mantığı serviste | ✅ | `routes.ts` guard + sınır; `sessions/lobby.ts` servis; tenant ve teknisyen `auth`'tan |
| `any` / hata yutma | ✅ | `any` yok. Web'de sessiz `catch`, AC-315'in açık şartı (son değer + yeniden deneme) |
| Sayfalı liste / transaction | ✅ | Uç bellekte ve sınırlı (≤ açık oturum sınırı); yazma yok |
| PII log / yanıt | ✅ | Yalnız sayı + kendi oturum ULID'i; audit/log yazılmıyor |
| 5 durum (frontend) | ✅ | Boş (0 → gizli/yuva), yükleniyor (temel çizgi), hata (sessiz son değer), 403 (dur), dolu |
| Erişilebilirlik | ⚠️ | axe 1280/412 px'te 0 ihlal, metin + ikon, `aria-live`; 360 px kanıtı eksik (madde 1) |
| Token / ham renk-spacing | ✅ | `warning`, `warning-surface`, `border-warning/30`; ham hex yok |
| İkon (Projeler §1.8) | ✅ | `BellRing` anlamlı ve DESIGN.md'ye işlendi; menü sayacı mevcut `MonitorSmartphone` öğesinde |
| Animasyon (§1.8) | ✅ | Yalnız opacity/transform, 200 ms ease-out, `scale(.95)`, reduced-motion global kural, nabız yok |
| Dosya ≤ 300 satır | ❌ | Yeni üretim dosyaları ≤ 157 satır; `rooms.ts` gerekçesiz büyüme (madde 2) |
| Yeni bağımlılık / env / grant | ✅ | Yok |
| Dokümanlar | ✅ | mimari-api, runbook, DESIGN.md, implementation.md güncellendi. Kılavuz, api.md ve CHANGELOG teknik-yazar'da (mimari §10.3) |

### Öneriler (zorunlu değil)
- AC-304 e2e'de kabulden sonra rozetin kaybolması `page.goto("/sessions")` (yeniden yükleme) ile kontrol ediliyor. 10 sn'lik liste yenilemesiyle kaybolması ayrı bir testte (`AC-305 … 0 → rozet kaybolur`) kanıtlanıyor; yine de kabul akışında yeniden yükleme yerine `tick` kullanılırsa senaryo AC'deki gibi uçtan uca olur.
- `toast.tsx` bölgesine `role="status"` eklendi. Bu bölgede eylem bağlantıları (`Konsolu aç`) var. axe ihlal vermiyor, ama AC-316 sırasında NVDA/VoiceOver ile bir kez dinlenip çift duyuru (K-L4) gözlemlenmeli.
- Kartta n = 0 yuvası PENDING kartı ~44 px uzatıyor (implementation.md'de belirtilmiş). test-operatoru 360 px'te görsel olarak değerlendirmeli.

### Olumlu
- Sahiplik süzmesi tek fonksiyonda (`Rooms.waitingFor`) ve sunucuda. Entegrasyon testi sorgu dizesiyle atlatma denemesini, ADMIN/USER/SA ve iki tenant kombinasyonlarını kapsıyor.
- `arrivals` monoton sayacı, misafir kimliği yanıta girmeden "çık + gir" ve restart durumlarında doğru toast kararını veriyor. Saf fonksiyon olarak birim testli.
- İki başlık yazıcısının birbirinin önekini silmesi tasarımda öngörülmüş ve tek yazıcıyla (`TabTitle`) çözülmüş; mevcut talep sayacı regresyonsuz.
- e2e konsol bekçisi uygulama kaynaklı `console.error/warn` ve `pageerror` için sıfır tolerans uyguluyor. 429'da `Retry-After`'a uyulduğu çağrı sayacıyla kanıtlanıyor.
- p95 8.94 ms; hedefin (100 ms) çok altında.

---

## P13b-L — Tur 2
Tarih: 2026-11-15 · Kapsam: Tur 1 maddelerinin (1–3) ve güvenlik S13L-1 düzeltmesinin doğrulanması, tam regresyon. Kod değiştirilmedi.

DURUM: GEÇTİ

### Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` | temiz (çıkış 0) |
| `pnpm -r run typecheck` | temiz (çıkış 0) |
| `pnpm -r run test` (unit) | contracts 78/78, web 271/271, server **368/368** (+1: `AC-305/S13L-1`); skip yok |
| `test-db.sh up` (konteyner `rs-p13bl-qa2-97372`, port 35172) + `test:int` | **554/554** (+1: `AC-314/S13L-1`). `down` çıkış 0, konteyner silindi (doğrulandı) |
| AC-314 perf | p50=5.61 ms, p95=9.26 ms (hedef ≤ 100 ms) |
| `pnpm --filter @remote/web e2e` (tam paket) | **329 geçti, 0 kaldı, 132 skip** (çıkış 0). `p13bl-lobby.spec.ts`: 19 geçti, 9 skip (mobil, `desktopOnly` gerekçeli; Tur 1 ile aynı) |

### Tur 1 maddelerinin durumu
| # | Madde | Durum | Kanıt |
|---|---|---|---|
| 1 | [frontend-dev] AC-312: 360 px axe + taşma, Tab ile erişim | ✅ kapandı | `p13bl-lobby.spec.ts:304-345`: rozet görünürken `/sessions` desktop projesinde 1280 ve 360 px'te, mobile projesinde 360 px'te açılıyor; açık ve koyu temada `axeScan` 0 ihlal, `noHorizontalOverflow`. Rozete sayfa başlığından en çok 40 Tab'la ulaşılıyor, `toBeFocused`, Enter → konsol URL'si. Test iki projede de yeşil (desktop #125, mobile #346) |
| 2 | [backend-dev] `rooms.ts` / `history.ts` büyümesi | ✅ kapandı | Sayım `signaling/lobby-count.ts`'e (41 satır, saf fonksiyonlar + yapısal `LobbyRooms`) taşındı. Liste eki `sessions/lobby.ts` `withWaitingGuests`'te. `rooms.ts` 327 → 329 (+2: `lobbyArrivals++` ve salt okunur `values()`), `history.ts` 419 → 419. +2 satırın gerekçesi implementation.md "P13b-L — backend düzeltme turu 1"de |
| 3 | [proje-yoneticisi] AC-306 metni ve K-L3 | ✅ kapandı | `gereksinimler-lobi-gostergesi.md:39`: "360 px genişlikte sayaç 'Oturumlar' öğesinde görünür … açılır mobil menü P14b'de geldiğinde menü düğmesine işaret eklenir (r1, K-L3)". e2e parantezi de buna göre güncellenmiş; kapsam satırı (§3 madde 3) uyumlu |
| S13L-1 | (güvenlik) `sessions.view` yoksa `waitingGuests` sızmasın | ✅ | `withWaitingGuests`: `auth.permissions.has("sessions.view")` yoksa her satır 0. `GET /sessions` ve `GET /customers/:id/sessions` aynı fonksiyonu kullanıyor (tek kaynak). Entegrasyon `AC-314/S13L-1`: yalnız geçmiş/müşteri yetkili kullanıcının kendi PENDING oturumunda 2 misafir → iki uçta 0, ADMIN aynı satırda 2. Unit `AC-305/S13L-1` |

### Kabul kriterleri
| AC | Durum | Kanıt |
|---|---|---|
| AC-304 | ✅ | Tur 1 kanıtları yeşil (e2e rozet → konsol, lobi `toBeInViewport`) |
| AC-305 | ✅ | Unit (çıkış yolları; artık `lobby-count.ts` üzerinden) + entegrasyon + e2e |
| AC-306 | ✅ | e2e `u-noreq` 360 px sayaç; düzeltilmiş AC metniyle birebir |
| AC-307 | ✅ | Unit `diff.test.ts` + e2e |
| AC-308 | ✅ | Unit `tab-title.test.ts` + e2e |
| AC-309 | ✅ | Entegrasyon sahiplik/tenant matrisi + e2e ADMIN |
| AC-310 | ✅ | Entegrasyon 403 + e2e (rozet var, bağlantı/sayaç yok, uç çağrılmıyor) |
| AC-311 | ✅ | Strict şema + entegrasyon gövde taraması + e2e ad yok |
| AC-312 | ✅ | Madde 1 (360/1280 px, iki tema axe 0, taşma yok, Tab + Enter) + `aria-live` tekrarsız |
| AC-313 | ✅ | e2e hesaplanan stil + reduced-motion |
| AC-314 | ✅ | Entegrasyon 401/403/no-store/audit yok/60–61 sınırı/perf; S13L-1 sıkılaştırması |
| AC-315 | ✅ | e2e 500/ağ kesme/restart + unit yeni `Rooms` → 0 |
| AC-316 | — staging'de test-operatoru | Bloklayıcı değil (koordinatör talimatı) |

### Düzeltilmeli
Yok.

### Definition of Done
| Madde | ✅/❌ | Not |
|---|---|---|
| Lint / typecheck temiz | ✅ | |
| Unit testler yeşil, skip yok | ✅ | 78 + 271 + 368 |
| Entegrasyon testleri yeşil | ✅ | 554/554 |
| e2e yeşil; skip'ler gerekçeli | ✅ | 329 geçti |
| Her AC'nin test kanıtı | ✅ | AC-316 staging adımı (test-operatoru) |
| Tasarım–kod uyumu; sapmalar gerekçeli | ✅ | `lobby-count.ts` ayrımı ve S13L-1 implementation.md'de |
| Katman / `any` / hata yutma / PII | ✅ | Değişmedi; `withWaitingGuests` yetkiyi arka uçta uyguluyor |
| Erişilebilirlik | ✅ | 360 ve 1280 px, iki tema axe 0; Tab erişimi |
| Token, ikon, animasyon (§1.6/§1.8) | ✅ | Tur 1'deki gibi |
| Dosya ≤ 300 satır | ✅ | Yeni dosyalar ≤ 157; `rooms.ts` +2 gerekçeli, `history.ts` büyümedi |
| Yeni bağımlılık / env / grant | ✅ | Yok |
| Dokümanlar | ✅ | Kılavuz, api.md ve CHANGELOG teknik-yazar adımında (mimari §10.3) |

### Öneriler (zorunlu değil)
- Tur 1 önerileri geçerli: AC-304 kabul akışında yeniden yükleme yerine `tick`; AC-316'da ekran okuyucuyla çift duyuru (K-L4) gözlemi; 360 px kartta n = 0 yuvasının görsel değerlendirmesi.

### Olumlu
- S13L-1 tek fonksiyonda çözülmüş ve iki uç aynı yolu kullanıyor; yetki kontrolü arka uçta, testle sabit.
- `lobby-count.ts` saf ve `Rooms`'tan bağımsız; `rooms.ts` yalnız 2 satır büyüdü.
