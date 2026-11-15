# QA Raporu — Tur 2 (P13b, Tur 1 düzeltmeleri + WhatsApp servis anahtarı S-P13b-3)

Tarih: 2026-11-15 · Denetçi: qa-denetci · Kapsam: Tur 1 maddeleri; implementation.md "P13b — devops düzeltme turu 1", "P13b QA #5", "S-P13b-3 (frontend)", "P13b — backend, WhatsApp servis anahtarı"; migration `20261115090000_whatsapp_api_key` (db-notlari incelemesiyle). Staging'e bağlanılmadı, dind kullanılmadı.

DURUM: DÜZELTİLMELİ

## Test sonucu

| Komut                                                                                                                             | Sonuç                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm -r run lint`                                                                                                                | temiz (çıkış 0)                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm -r run typecheck`                                                                                                           | temiz (çıkış 0)                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm -r run test`                                                                                                                | contracts 78/78, web 253/253, server unit 351/351. Skip yok                                                                                                                                                                                                                                                                                                                                                                           |
| `test-db.sh up` (`rs-qa-p13b2-8374`, port 33392) + `pnpm --filter @remote/server test:int`                                        | **540/541, 1 kırmızı**: `settings-p11.test.ts:118` AC-78 (MySQL bağlantı testi `ok:false`). Bu koşu `test-backup.sh` ile eşzamanlıydı (makinede 2. MySQL ayağa kalkıyordu). Dosya tek başına yeni konteynerde (`rs-qa-p13b2r-*`, 33393) yeniden koşuldu: **14/14 geçti**. P13b bu dosyaya ve MySQL ayar koduna dokunmuyor. Sonuç: yük altında kararsız (flaky) test, regresyon değil; bkz. Öneriler. İki konteyner `down` ile silindi |
| `deploy/backup/test-backup.sh`                                                                                                    | **SONUÇ: GEÇTİ (55 PASS)**, ~2,5 dk; compose projesi `rstb1794692451944` + yardımcı konteyner trap ile silindi (`docker ps -a` ve volume listesinde `rstb`/`rs-qa` yok)                                                                                                                                                                                                                                                               |
| `pnpm --filter @remote/web e2e` (mock)                                                                                            | **308 geçti, 0 kalan, 123 skip**. Skip'lerin hepsi proje kapılı ve gerekçeli: `test.skip(name !== "desktop", "masaüstü akışı")` ve `test.skip(name !== "mobile", "mobil")`. Yeni S-P13b-3 senaryoları (env rozeti, kayıt/geri yazılmama/kaldırma onayı/401, köken değişiminde yeniden giriş) ve axe light/dark yeşil                                                                                                                  |
| `bash -n` (deploy/**/*.sh, apps/server/scripts)                                                                                   | hepsi temiz                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `shellcheck -x -S warning` (koalaman stable, `LC_ALL=C.UTF-8`, salt okunur bağlama): deploy/backup, ops, turn, mysql, deploy/*.sh | **temiz** (çıkış 0)                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Tur 1 maddelerinin durumu

| #   | Madde                                                  | Durum                  | Kanıt                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [devops] yedek test betiği repoda yok                  | ✅ kapandı             | `deploy/backup/test-backup.sh` + `test-backup-inner.sh` var, bu turda koşuldu: 55 PASS. Kurcalanmış döküm senaryosu açık: `test-backup-inner.sh:139-146` (`CREATE USER`, `GRANT ALL ON *.*`, `SET PERSIST`, `INSTALL COMPONENT`, `SELECT 1; USE mysql; INSERT`), TRUNCATE `:100-101`, tek DELETE `:96`, DROP TRIGGER `:103-104`, `x-api-key` kanca reddi `:116-117`                             |
| 2   | [devops] ≤ 300 satır                                   | ✅ kapandı (gerekçeli) | `backup.sh` 296, `restore.sh` 277 (+ `lib-audit.sh` 133, `lib-offsite.sh` 126, `lib-restore.sh` 89). `host-firewall.sh` 344 ve `remote-watch.sh` 313 bölünmedi; gerekçe kabul edilebilir: root timer'ının çalıştırdığı tek dosyalık kurulu kopya, ikinci root `source` dosyası yeni sahip/izin denetimi ister. Aşım 44 ve 13 satır. `check-app-grants.sh` 493 (önceden 460) dba'da, test betiği |
| 3   | [frontend-dev/backend-dev] `source:"default"` ölü kodu | ✅ kapandı             | `whatsapp-form.tsx`'te `default` dalı yok, `tr.json`'da `defaultBadge/defaultSource/urlHintDefault` yok, contracts `source: "panel" \| "env"` (`system-settings.ts:207`). Tek kalan `whatsapp.test.ts:50` eski yanıtın savunma amaçlı `env`'e indirgenmesini test ediyor (gerekçeli)                                                                                                            |
| 4   | [dba] `audit-continuity.sql` kural 2                   | ✅ kapandı             | Başlık kural 2a/2b/2c (`:34-39`) `lib-audit.sh:61-81` ile aynı: `sifirlandi` (işaret eşleşir), `isaretsiz`, `kaydi-kayboldu`. Testte üçü de sınanıyor                                                                                                                                                                                                                                           |
| 5   | [devops] shellcheck uyarıları                          | ✅ kapandı             | shellcheck temiz (yukarıda)                                                                                                                                                                                                                                                                                                                                                                     |
| 6   | [teknik-yazar] `README.md:672` varsayılan adres        | ❌ açık (W1)           | `README.md:672` hâlâ "o da yoksa varsayılan `http://89.252.189.211:3000`" ve "Kimlik bilgisi yok" diyor. Artık iki yönden yanlış: varsayılan adres yok, servis anahtarı (S-P13b-3) var                                                                                                                                                                                                          |

## Kabul kriterleri

| AC                                               | Durum                  | Kanıt veya eksik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-298 imza / migrator / CHECKSUM / ortam kilidi | ✅                     | `test-backup.sh` 55 PASS (bu tur): imzasız, değiştirilmiş manifest, bozuk imza, yabancı anahtar → `FAIL (imza)`, çözme yok; yanlış `--confirm`, staging→production, `DEPLOY_ENV` uyuşmazlığı, TTY yok → ret; kurcalanmış döküm → migrator yükleyemez, canlı hesap/persist/bileşen sayısı aynı, scratch kalmadı; CHECKSUM canlı = scratch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| AC-299 reset-superadmin                          | ✅                     | Tur 1'deki kanıt; `superadmin-reset-p13b.test.ts` bu turda da yeşil (entegrasyon koşusu)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| AC-300 site dışı kanca                           | ✅                     | test-backup: kanca başarılı (sır okunamıyor, ortamda sır yok, sonra 700/600, komut metni logda yok); `exit 7` → `OFFSITE-FAILED rc=7` + alarm + birim rc 0; `x-api-key` → rc 126                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| AC-301 audit süreklilik                          | ✅                     | test-backup: TRUNCATE → `kaydi-kayboldu`; tetikleyici düşür + tek DELETE → `FAILED gun=`; DROP TRIGGER → `adım=tetikleyici`; S-P13b-1 işaret kuralları                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| AC-302 remote-watch                              | ✅ (kayıtla)           | `test-watch.sh` 49 PASS kaydı (root yardımcı konteyner ister; bu turda koşulmadı)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| AC-126 (revize) HSTS                             | ✅                     | `ops-headers.test.ts` yeşil                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| AC-21/22 TURN                                    | ✅ (kayıtla)           | Tur 1 ile aynı; `signaling-lifecycle.test.ts` yeşil                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| AC-23, AC-91, AC-200, AC-88                      | ⚠️ prod ölçümü/provası | T6/R1'e bağlı; kod tarafı hazır. P13b kod kapısını bloklamaz ama prod açılış listesinde kalır                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| AC-90 (CLI, kanca)                               | ✅                     | CLI testi + test-backup "komut metni logda yok"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| AC-196 + S-P13b-3 WhatsApp servis anahtarı       | ✅ davranış / ⚠️ belge | Entegrasyon `whatsapp-admin-p12b.test.ts` "S-P13b-3" bloğu (3 test) okundu ve kriteri gerçekten doğruluyor: env anahtarı yalnız env adresine; panel anahtarı DB'de şifreli (düz metin taraması), yanıtta ve audit'te değer yok (`apiKey:"***"`, `apiKeySet`, `apiKeyChanged`); alan yok/`""` → korunur, audit yok; köken değişince 400 `fields.apiKey = WA_API_KEY_REENTER`; `null` → silinir ve başlık gitmez (env anahtarı panel adresine sızmaz); DELETE → `secret_enc` NULL, env anahtarı geri gelir; servis 401 → "Servis anahtarı reddetti." + audit `reason: unauthorized`; geçersiz anahtarlar 400. Unit `whatsapp-runtime-p12b`: 401'de yeniden deneme yok. Migration CHECK'i `whatsapp-setting.test.ts` ve `check-app-grants.sh` (387) ile sınanıyor. **Ancak** bu iş için `docs/gereksinimler-p13b.md`'de AC yok, `docs/mimari.md:112` hâlâ "`secret_enc` NULL — servis API anahtarı desteklenince Sonra" diyor (Düzeltilmeli 3) |
| G-P13b-2                                         | ✅ kodda / ❌ README   | Tur 1 madde 6 açık                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

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

| Madde                                                       | ✅/❌    | Not                                                                                                                                                                             |
| ----------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint / typecheck temiz                                      | ✅       |                                                                                                                                                                                 |
| Unit testler yeşil, skip yok                                | ✅       | 682/682                                                                                                                                                                         |
| Entegrasyon testleri yeşil                                  | ✅ (not) | 540/541 + kırmızı dosya tek başına 14/14. Kararsız test P13b dışında (Öneriler)                                                                                                 |
| e2e (mock) yeşil                                            | ✅       | 308 geçti, skip'ler proje kapılı ve gerekçeli                                                                                                                                   |
| Her AC'nin tekrar üretilebilir test kanıtı                  | ✅       | AC-298/300/301 artık `test-backup.sh` ile (55 PASS). Prod ölçümleri T6/R1'de                                                                                                    |
| Özellik için AC + mimari karşılığı                          | ❌       | S-P13b-3 (madde 3)                                                                                                                                                              |
| Tasarım–kod uyumu; sapmalar gerekçeli                       | ✅       | Anahtarın adresle gitmesi, köken değişiminde 400, DELETE'te silme, CHECK gevşetmesi implementation.md'de gerekçeli; dba incelemesi db-notlari'nda (up/down/yeniden up, drift 0) |
| Yeni env kuralı (.env.example + env.ts + compose + runbook) | ✅       | `WHATSAPP_SERVICE_API_KEY`: `.env.example:54` boş, `env.ts:73` şemalı, compose `:116`, runbook `:82`, `:211`, `:1949`                                                           |
| Dosya ≤ 300 satır                                           | ❌       | madde 1 (yeni aşım), madde 2 (gerekçesiz büyüme)                                                                                                                                |
| Ölü kod yok                                                 | ✅       | Tur 1 madde 3 kapandı                                                                                                                                                           |
| shellcheck / bash -n                                        | ✅       | temiz                                                                                                                                                                           |
| Gizli bilgi / PII log yok                                   | ✅       | Anahtar yanıtta, logda (`*.apiKey` redakte, `keySet` bool) ve audit'te yok; DB'de AES-256-GCM, köken AAD'li. Test bunu düz metin taramasıyla doğruluyor                         |
| Hata yutma yok                                              | ✅       | `decryptWaKey` catch → alarm logu + başlıksız gönderim (gerekçeli, fail-visible: servis 401 → kullanıcıya mesaj)                                                                |
| Transaction                                                 | ✅       | `saveWhatsappSettings` okuma, köken kontrolü, upsert ve audit tek TX'te; route `waSerial` ile serileştiriliyor                                                                  |
| Yeni bağımlılık                                             | ✅       | yok                                                                                                                                                                             |
| Grants / migration                                          | ✅       | yeni tablo yok; CHECK değişikliği dba onaylı, `check-app-grants` +3                                                                                                             |
| 5 durum + a11y (yeni UI)                                    | ✅       | anahtar bölümü: boş/rozet, hata (alan hatası + odak), yükleniyor (`busy`/`loading`), onaylı `alertdialog`; axe light/dark + 390 px yeşil; ikon `KeyRound`/`Trash2` lucide       |
| Runbook / dokümanlar                                        | ⚠️       | runbook env satırı var; README/kılavuz W1 (madde 4)                                                                                                                             |

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

| Komut                                                                                                                                                                          | Sonuç                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm -r run lint`                                                                                                                                                             | temiz (çıkış 0)                                                                                                                                                                                                                                                                                                                   |
| `pnpm -r run typecheck`                                                                                                                                                        | temiz (çıkış 0)                                                                                                                                                                                                                                                                                                                   |
| `pnpm -r run test`                                                                                                                                                             | contracts 78/78, web 249/249, server unit 350/350. Skip yok                                                                                                                                                                                                                                                                       |
| `eval "$(apps/server/scripts/test-db.sh up)" && pnpm --filter @remote/server test:int` (geçici konteyner `rs-qa-p13b-*`, port 33391, iş sonunda `test-db.sh down` ile silindi) | **54 dosya, 538/538 geçti**, skip yok; konteyner `rs-qa-p13b-12bb4e` silindi (docker ps boş)                                                                                                                                                                                                                                      |
| `bash -n` (deploy/backup, turn, ops, mysql, test-caddy)                                                                                                                        | hepsi temiz                                                                                                                                                                                                                                                                                                                       |
| `shellcheck -x -S warning` (`koalaman/shellcheck:stable`, salt okunur bağlama)                                                                                                 | backup.sh, restore.sh, lib.sh, cert-deploy-hook.sh, test-cert-hook.sh, host-firewall.sh, remote-watch.sh, test-watch.sh, check-app-grants.sh, test-caddy.sh **temiz**. Kalan uyarılar: `turn/test-denied.sh:26` SC2164, `:99` SC2034; `turn/test-local.sh:12` SC2155; `turn/entrypoint.sh:40` SC2154. P13b'de üç dosya da değişti |

Yeniden çalıştırılmayanlar: `deploy/ops/test-watch.sh`, `deploy/turn/test-cert-hook.sh`, `deploy/turn/test-local.sh`, `deploy/test-caddy.sh`. Bunlar root yardımcı konteyner ya da gerçek coturn/caddy istiyor. Kanıt olarak implementation.md'deki kayıtlar kabul edildi: test-watch 48 PASS, test-cert-hook 14+25 PASS, test-local 65 PASS, test-caddy GEÇTİ. T1 yedek testlerinin (49/49) betiği **repoda yok**; bkz. Düzeltilmeli 1.

## Kabul kriterleri

| AC                                                       | Durum                   | Kanıt veya eksik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-299 reset-superadmin                                  | ✅                      | `superadmin-reset-p13b.test.ts` (7 test): hash değişimi, `must_change`, kilit ve sayaç sıfırlama, oturum ve sıfırlama bağlantısı iptali, eski çerez 401, parolanın çıktıda tam 1 kez görünmesi, audit ve logda parola/hash olmaması (AC-90), `--reset-mfa`, ADMIN/PASSIVE/silinmiş/olmayan hesap → 3 ve değişiklik yok, dry-run 0/3, pipe ile gerçek süreçte 4, kullanım hatası 2, DB hatası 5 ve ref. Testleri okudum; her biri kriteri gerçekten doğruluyor                                                                                                              |
| AC-126 (revize) HSTS                                     | ✅                      | `app.ts` helmet `includeSubDomains: true, preload: false`; `ops-headers.test.ts` değeri birebir doğruluyor; Caddyfile `?Strict-Transport-Security "max-age=31536000; includeSubDomains"`; `test-caddy.sh` başlık bölümü (kayıt: GEÇTİ, yeniden çalıştırılmadı)                                                                                                                                                                                                                                                                                                             |
| AC-298 yedek imzası / migrator / CHECKSUM / ortam kilidi | ⚠️ kanıtsız             | Kod tasarıma uygun: `restore.sh` önce imzayı doğruluyor, `--target`, `--confirm`, TTY ve `manifest.env` kontrollerini yapıyor; yükleme migrator ile `--system-command=OFF --local-infile=0`; `checksum-tables.sql` var. Olumsuz testler (imzasız, bozuk imza, değiştirilmiş manifest, kurcalanmış döküm, yanlış ortam) yalnız implementation.md'de "49/49 PASS" olarak anlatılıyor. Test betiği repoda yok, tekrar üretilemiyor (Düzeltilmeli 1). "Kurcalanmış döküm (`CREATE USER`, `GRANT ON *.*`) → FAIL, kalıcı iz yok" maddesinin test kaydında açık karşılığı da yok |
| AC-300 site dışı kanca                                   | ⚠️ kanıtsız             | Kod var: `backup.sh` kancası (setpriv, timeout, `OFFSITE OK`/`OFFSITE-FAILED`/`OFFSITE-UNCONFIGURED`, `status.prom` `offsite_configured`). Kanıt AC-298 ile aynı nedenle tekrar üretilemiyor                                                                                                                                                                                                                                                                                                                                                                               |
| AC-301 audit süreklilik                                  | ⚠️ kanıtsız             | `audit-continuity.sql` + `backup.sh` karşılaştırması mevcut. TRUNCATE ve tek DELETE testleri yalnız anlatımda var (Düzeltilmeli 1). Ayrıca devops'un sıkılaştırdığı "taban-cizgisi-kaydi-kayboldu" kuralı `audit-continuity.sql` başlığındaki kural 2'ye işlenmemiş (Düzeltilmeli 4)                                                                                                                                                                                                                                                                                       |
| AC-302 remote-watch                                      | ✅ (kayıtla)            | `deploy/ops/test-watch.sh` repoda; 48 PASS kaydı var: servis durdurma → ALERT, tekrar bastırma, 360 dk sonra yeniden alarm, DUZELDI bir kez. Bu turda yeniden çalıştırılmadı                                                                                                                                                                                                                                                                                                                                                                                               |
| AC-21/22 (TURN aralık, kota, bps)                        | ✅ (kayıtla)            | `turnserver.base.conf` 49160–49479, `total-quota=300`; `TURN_MAX_BPS=1000000` ölçümü kayıtlı; `signaling-lifecycle.test.ts` "G-P13b-1/AC-22": yeniden bağlanmada aynı username, ≤ 2 geçerli credential                                                                                                                                                                                                                                                                                                                                                                     |
| AC-23 (revize) 5349                                      | ⚠️ prod ölçümü          | Kod tarafı hazır (cert-deploy-hook, compose bağlaması). Ölçüm R1/T6'da; bu turda kanıt olamaz                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| AC-91, AC-200 (revize), AC-88                            | ⚠️ prod provası         | T6/R1'e bağlı; kod tarafı AC-298 ile aynı açığı taşıyor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| AC-90 (CLI ve kanca)                                     | ✅ / ⚠️                 | CLI tarafı test ile ✅. Kanca komut metninin loglanmaması yalnız anlatımda kanıtlı (Düzeltilmeli 1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| S-P13a-8 (file.transfer audit)                           | ✅                      | P13a'da kapanmış; `signaling-collab-p5*` ve `file-names` testleri yeşil                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| G-P13b-2 (varsayılan WhatsApp adresi)                    | ✅ kodda / ⚠️ dokümanda | `env.ts`'te `DEFAULT_WHATSAPP_URL` kaldırıldı, boş adres "yapılandırılmamış" yoluna gidiyor; `env-logger`, `whatsapp-admin-p12b` ve `whatsapp-setting` testleri yeni davranışı doğruluyor. Kod ve deploy ağacında `89.252.189.211` kalmadı. `README.md:672` hâlâ "o da yoksa varsayılan `http://89.252.189.211:3000`" diyor: hem kodla çelişiyor hem repo public öncesi temizlenecek adres (W1)                                                                                                                                                                            |
| G-P13b-10 (geçici parola süresi)                         | ✅                      | `auth/service.ts:136` + `superadminTempPasswordExpired`; test 25 sa → 401 + audit `temp_password_expired`, 23 sa → 200, yanlış parolada genel mesaj                                                                                                                                                                                                                                                                                                                                                                                                                        |

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

| Madde                                                       | ✅/❌              | Not                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint / typecheck temiz                                      | ✅                 |                                                                                                                                                                                                                                                                                                                                                                                  |
| Unit testler yeşil, skip yok                                | ✅                 | 677/677                                                                                                                                                                                                                                                                                                                                                                          |
| Entegrasyon testleri yeşil                                  | ✅                 | 538/538                                                                                                                                                                                                                                                                                                                                                                          |     |
| Her AC'nin tekrar üretilebilir test kanıtı                  | ❌                 | AC-298/300/301 test betiği repoda yok (madde 1)                                                                                                                                                                                                                                                                                                                                  |
| Tasarım–kod uyumu; sapmalar implementation.md'de gerekçeli  | ✅                 | Gerekçeli sapmalar: audit etiketi `labels.ts` yerine `actions.ts`; `mustChangePassword` mask izni; dry-run de TTY ister; geçici parola süresi audit kaydından okunur (sütun yok); `watch.env` `/etc/remote-watch/`'e taşındı; `TURN_BPS_CAPACITY=0` + host hashlimit; `audit.days` `{n,h}`; §7.9 "env.ts değişmez" ihlali G-P13b-2 ile gerekçeli (yalnız kaldırma, yeni env yok) |
| Yeni env kuralı (.env.example + env.ts + compose + runbook) | ✅ (runbook T5'te) | `DEPLOY_ENV`, `TURN_FW_RELAY_MAX_BPS`, `TURN_CERT_DIR` `.env.example`'da boş; env.ts ve compose istisnası gerekçeli (server okumuyor). `WHATSAPP_SERVICE_URL: ${WHATSAPP_SERVICE_URL:-}` compose'da. Runbook T5 bekleniyor                                                                                                                                                       |
| Dosya ≤ 300 satır                                           | ❌                 | madde 2                                                                                                                                                                                                                                                                                                                                                                          |
| Ölü kod yok                                                 | ❌                 | madde 3                                                                                                                                                                                                                                                                                                                                                                          |
| shellcheck / bash -n                                        | ⚠️                 | bash -n tamamı temiz; shellcheck 4 eski uyarı (madde 5)                                                                                                                                                                                                                                                                                                                          |
| Gizli bilgi / PII log yok                                   | ✅                 | CLI parolası audit ve logda yok (test); kanca/alarm komutu metni loglanmıyor, sır deseni reddi var (kod); `.env.example` değerleri boş                                                                                                                                                                                                                                           |
| Hata yutma yok                                              | ✅                 | CLI `catch` blokları ya kullanım hatası (2) ya ref'li 5 dönüyor; `close().catch` yalnız kapanışta                                                                                                                                                                                                                                                                                |
| Transaction                                                 | ✅                 | `resetSuperadmin` tek TX + koşullu UPDATE (yarışta `not_found`); argon2 TX dışında                                                                                                                                                                                                                                                                                               |
| Yeni bağımlılık                                             | ✅                 | yok (`node:util parseArgs`, mevcut pino/zod; host araçları openssh/age/jq/setpriv runbook önkoşulu)                                                                                                                                                                                                                                                                              |
| Grants (yeni tablo → grants.sql)                            | ✅                 | yeni tablo yok; `check-app-grants.sh` 384 kontrol, anonim hesap = 0 eklendi, CI'a `MIGRATOR_PW` geçildi                                                                                                                                                                                                                                                                          |
| Runbook / dokümanlar                                        | —                  | T5/W1 kapsam dışı (madde 6 not)                                                                                                                                                                                                                                                                                                                                                  |

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

| Komut                                                                                                 | Sonuç                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm -r run lint`                                                                                    | temiz (çıkış 0, uyarı yok)                                                                                                                                                                                                                                                       |
| `pnpm -r run typecheck`                                                                               | temiz (çıkış 0)                                                                                                                                                                                                                                                                  |
| `pnpm -r run test` (unit)                                                                             | contracts 78/78, web **271/271** (27 dosya; yeni `lib/lobby/diff.test.ts` 10 test, `lib/tab-title.test.ts` 8 test), server **367/367** (yeni `lobby-count-p13bl.test.ts` 13 test). Skip yok                                                                                      |
| `test-db.sh up` (konteyner `rs-p13bl-qa-93483`, port 34783) + `pnpm --filter @remote/server test:int` | **553/553** (55 dosya). Ardından `down`; konteyner silindiği doğrulandı                                                                                                                                                                                                          |
| AC-314 perf çıktısı                                                                                   | `GET /sessions/waiting 1000 istek, 100 oda/300 misafir: p50=5.60 ms p95=8.94 ms` (hedef ≤ 100 ms). test-operatoru `docs/test-raporu.md`'ye aktarır                                                                                                                               |
| `pnpm --filter @remote/web e2e` (tam paket)                                                           | **329 geçti, 0 kaldı, 132 skip** (çıkış 0). `p13bl-lobby.spec.ts`: 14 test × 2 proje → 19 geçti, 9 skip. Skip'lerin tamamı `mobile` projesinde, `desktopOnly(...)` "masaüstü akışı" gerekçesiyle (mevcut desen). Mobilde koşanlar: AC-305, 306/312 (360 px), 312 (axe), 315 (×2) |

### Kabul kriterleri

| AC     | Durum                       | Kanıt veya eksik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-304 | ✅                          | e2e `AC-304/305/307/311: liste açıkken misafir gelir …`: gerçek misafir join, ardından tek yoklama turu (`clock.runFor(10_000)`) → "Müşteri bekliyor (1)" bağlantısı. Tık → `/sessions/:id/console`, `lobby-panel` `toBeInViewport` (1280×800). Kabul kodu girilince "Aktif". Sunucu: entegrasyon `AC-305/309: USER listesinde …` `waitingGuests` 1/3                                                                                                                                                                                              |
| AC-305 | ✅                          | Unit `lobby-count-p13bl`: 0/1/3, TICKETED sayılmıyor; ayrılma, ret, 5 dk zaman aşımı, kabul (`admitted`), iptal (`closeSession`), `ending`, `expiresAt` geçmiş → 0; ön-kabullü misafir sayılmıyor. Entegrasyon: ret ve ADMIN iptali sonrası uç ve liste 0, ENDED satır 0; P8 liste testi her öğede `waitingGuests === 0`, detayda alan yok. e2e `AC-305: waiting 3 → (3); 0 → rozet kaybolur`: tek turda (≤ 10 sn), yuva kalıyor; ACTIVE/EXPIRED satırda yuva yok                                                                                  |
| AC-306 | ✅                          | e2e `AC-306/312` (`u-noreq`, Talepler menüsü yok): "/" sayfasında tek turda sayaç "1"; 0'da gizli; 360 px'te `toBeInViewport`; erişilebilir ad "1 müşteri bekleme odasında". Entegrasyon: `session_history.view` ile liste 200 alınıyor, uç 403; layout koşulu yalnız `sessions.view`. Konsolda sayaç: e2e `AC-306/307`. **Not:** AC'deki "menü düğmesinde işaret" maddesi için panelde açılır/kapanır menü düğmesi yok, menü yatay şerit (mimari K-L3). AC metni bununla uyumlu değil (madde 3)                                                   |
| AC-307 | ✅                          | Unit `diff.test.ts`: temel çizgi, tek/iki oturum, aynı misafir, çık-gir, gelip giden, restart, açık konsol. e2e `AC-307`: tek toast; ikinci turda yeni toast yok ve ilki 10 sn sonra hâlâ görünür (`durationMs` 15 000); yeniden yükleme → toast yok, sayaç var; 2 misafir → "Bekleme odasında 2 müşteri var" + "Oturumlara git" `/sessions`; bölge `role="status"`. Konsolda toast yok: e2e `AC-306/307`                                                                                                                                          |
| AC-308 | ✅                          | Unit `tab-title.test.ts`: önek, 0'da eski başlık, lobi önce + talep sonra, idempotent, `/console` istisnası. e2e: gizli sekmede `(1) Müşteri bekliyor — (3) Talepler · …`, görünür olunca yalnız talep öneki; yalnız lobi senaryosu                                                                                                                                                                                                                                                                                                                |
| AC-309 | ✅                          | Entegrasyon: USER-A/B/C yalnız kendi sayısını görüyor; ADMIN `count` 0 ama listede B'nin satırında 2; tenant-1 ADMIN listesinde tenant-2 oturumu yok; sorgu dizesiyle (`technicianId`, `tenantId`) süzme atlatılamıyor. Unit: `waitingFor` tenant + teknisyen süzmesi. e2e `AC-309`: başkasının satırında bağlantısız rozet, tek bağlantı, sayaç 1                                                                                                                                                                                                 |
| AC-310 | ✅                          | Entegrasyon: firma seçmemiş SA → 403 "Önce bir firma seçin."; liste `waitingGuests` döndürüyor; firma A'da kendi oturumu sayılıyor, B'de sayılmıyor. e2e `AC-310`: rozet var, bağlantı yok ("Konsolu aç" de yok), sayaç ve `lobby-live` yok, waiting ucu hiç çağrılmıyor. Firma seçmiş SA'da sayaç ve toast çalışıyor                                                                                                                                                                                                                              |
| AC-311 | ✅                          | `waitingSessionsResponseSchema` strict (unit: ek alan reddi). Entegrasyon gövdesinde ad, e-posta, IP, `admitCode`, `BROWSER` yok. e2e: "Ayşe Yılmaz" rozet, toast, menü, `main` ve başlıkta yok, yalnız konsol lobi listesinde var                                                                                                                                                                                                                                                                                                                 |
| AC-312 | ⚠️ kanıt eksik              | Metin + `BellRing`, `navSr`, `aria-live` tekrar duyurmama (MutationObserver sayacı 0), axe açık/koyu 0 ihlal (desktop 1280 ve mobile **412 px** Pixel 7), Enter ile konsol: kanıtlı. **Eksik:** (a) AC "360 px genişlikte yatay taşma yok" ve mimari §9.3 "axe 360 ve 1280 px" ister. 360 px yalnız "/" sayfasında taşma için ölçülüyor; rozetin bulunduğu `/sessions` kart görünümü 360 px'te ne taşma ne axe ile ölçülüyor. (b) "Klavyeyle odaklanabilir" `locator.focus()` ile sınanıyor; Tab sırasında erişilebilirlik kanıtlanmıyor (madde 1) |
| AC-313 | ✅                          | e2e `AC-313` (desktop): menü sayacı ve satır rozetinde hesaplanan `transition-property: opacity, transform`, 0.2 sn, `linear`/`ease-in` yok, animasyon yok/sonsuz değil; reduced-motion'da `opacity`. Kaybolurken yer kayması yok: n = 0 yuvası `invisible` (e2e `waiting-slot`). Panelde açılır/kapanır menü yok                                                                                                                                                                                                                                  |
| AC-314 | ✅                          | Entegrasyon: 401 çerezsiz, 403 yetkisiz, başka tenant/teknisyen yok, `Cache-Control: no-store`, audit satırı sayısı değişmiyor, 60 istek 200 / 61. istek 429 `RATE_LIMITED` + `Retry-After`, başka kullanıcı etkilenmiyor; perf p95 8.94 ms. Tenant matrisi (`tenant-matrix.ts`) uca `scoped` sınıfı atıyor. e2e: 429'da `Retry-After` (30 sn) boyunca ek yoklama yok                                                                                                                                                                              |
| AC-315 | ✅                          | e2e `AC-315: 500 → son değer` ve `ağ kesilir → son değer; sunucu yeniden başlar → ≤ 10 sn sayaç 0`: toast yok; `afterEach` konsol bekçisi (uygulama `console.error/warn` + `pageerror` = 0; yalnız tarayıcının ağ satırları süzülüyor). Unit: yeni `Rooms` örneği → 0. Liste "Liste güncellenemedi…" uyarısı değişmedi (mevcut `sessions.spec` yeşil)                                                                                                                                                                                              |
| AC-316 | — staging'de test-operatoru | Bloklayıcı sayılmadı (koordinatör talimatı). Senaryo: mimari-lobi §9.4                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

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

| Madde                                   | ✅/❌ | Not                                                                                                                        |
| --------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------- |
| Lint / typecheck temiz                  | ✅    |                                                                                                                            |
| Unit testler yeşil, skip yok            | ✅    | 78 + 271 + 367                                                                                                             |
| Entegrasyon testleri yeşil              | ✅    | 553/553                                                                                                                    |
| e2e yeşil; skip'ler gerekçeli           | ✅    | 329 geçti; P13b-L mobil skip'leri `desktopOnly` gerekçeli                                                                  |
| Her AC'nin test kanıtı                  | ❌    | AC-312'de 360 px kanıtı eksik (madde 1); AC-316 staging (beklemede, bloklayıcı değil)                                      |
| Tasarım–kod uyumu; sapmalar gerekçeli   | ✅    | Bkz. "Tasarım–kod uyumu"                                                                                                   |
| Katman: route ince, iş mantığı serviste | ✅    | `routes.ts` guard + sınır; `sessions/lobby.ts` servis; tenant ve teknisyen `auth`'tan                                      |
| `any` / hata yutma                      | ✅    | `any` yok. Web'de sessiz `catch`, AC-315'in açık şartı (son değer + yeniden deneme)                                        |
| Sayfalı liste / transaction             | ✅    | Uç bellekte ve sınırlı (≤ açık oturum sınırı); yazma yok                                                                   |
| PII log / yanıt                         | ✅    | Yalnız sayı + kendi oturum ULID'i; audit/log yazılmıyor                                                                    |
| 5 durum (frontend)                      | ✅    | Boş (0 → gizli/yuva), yükleniyor (temel çizgi), hata (sessiz son değer), 403 (dur), dolu                                   |
| Erişilebilirlik                         | ⚠️    | axe 1280/412 px'te 0 ihlal, metin + ikon, `aria-live`; 360 px kanıtı eksik (madde 1)                                       |
| Token / ham renk-spacing                | ✅    | `warning`, `warning-surface`, `border-warning/30`; ham hex yok                                                             |
| İkon (Projeler §1.8)                    | ✅    | `BellRing` anlamlı ve DESIGN.md'ye işlendi; menü sayacı mevcut `MonitorSmartphone` öğesinde                                |
| Animasyon (§1.8)                        | ✅    | Yalnız opacity/transform, 200 ms ease-out, `scale(.95)`, reduced-motion global kural, nabız yok                            |
| Dosya ≤ 300 satır                       | ❌    | Yeni üretim dosyaları ≤ 157 satır; `rooms.ts` gerekçesiz büyüme (madde 2)                                                  |
| Yeni bağımlılık / env / grant           | ✅    | Yok                                                                                                                        |
| Dokümanlar                              | ✅    | mimari-api, runbook, DESIGN.md, implementation.md güncellendi. Kılavuz, api.md ve CHANGELOG teknik-yazar'da (mimari §10.3) |

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

| Komut                                                                     | Sonuç                                                                                                                                |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm -r run lint`                                                        | temiz (çıkış 0)                                                                                                                      |
| `pnpm -r run typecheck`                                                   | temiz (çıkış 0)                                                                                                                      |
| `pnpm -r run test` (unit)                                                 | contracts 78/78, web 271/271, server **368/368** (+1: `AC-305/S13L-1`); skip yok                                                     |
| `test-db.sh up` (konteyner `rs-p13bl-qa2-97372`, port 35172) + `test:int` | **554/554** (+1: `AC-314/S13L-1`). `down` çıkış 0, konteyner silindi (doğrulandı)                                                    |
| AC-314 perf                                                               | p50=5.61 ms, p95=9.26 ms (hedef ≤ 100 ms)                                                                                            |
| `pnpm --filter @remote/web e2e` (tam paket)                               | **329 geçti, 0 kaldı, 132 skip** (çıkış 0). `p13bl-lobby.spec.ts`: 19 geçti, 9 skip (mobil, `desktopOnly` gerekçeli; Tur 1 ile aynı) |

### Tur 1 maddelerinin durumu

| #      | Madde                                                     | Durum      | Kanıt                                                                                                                                                                                                                                                                                                                                                    |
| ------ | --------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | [frontend-dev] AC-312: 360 px axe + taşma, Tab ile erişim | ✅ kapandı | `p13bl-lobby.spec.ts:304-345`: rozet görünürken `/sessions` desktop projesinde 1280 ve 360 px'te, mobile projesinde 360 px'te açılıyor; açık ve koyu temada `axeScan` 0 ihlal, `noHorizontalOverflow`. Rozete sayfa başlığından en çok 40 Tab'la ulaşılıyor, `toBeFocused`, Enter → konsol URL'si. Test iki projede de yeşil (desktop #125, mobile #346) |
| 2      | [backend-dev] `rooms.ts` / `history.ts` büyümesi          | ✅ kapandı | Sayım `signaling/lobby-count.ts`'e (41 satır, saf fonksiyonlar + yapısal `LobbyRooms`) taşındı. Liste eki `sessions/lobby.ts` `withWaitingGuests`'te. `rooms.ts` 327 → 329 (+2: `lobbyArrivals++` ve salt okunur `values()`), `history.ts` 419 → 419. +2 satırın gerekçesi implementation.md "P13b-L — backend düzeltme turu 1"de                        |
| 3      | [proje-yoneticisi] AC-306 metni ve K-L3                   | ✅ kapandı | `gereksinimler-lobi-gostergesi.md:39`: "360 px genişlikte sayaç 'Oturumlar' öğesinde görünür … açılır mobil menü P14b'de geldiğinde menü düğmesine işaret eklenir (r1, K-L3)". e2e parantezi de buna göre güncellenmiş; kapsam satırı (§3 madde 3) uyumlu                                                                                                |
| S13L-1 | (güvenlik) `sessions.view` yoksa `waitingGuests` sızmasın | ✅         | `withWaitingGuests`: `auth.permissions.has("sessions.view")` yoksa her satır 0. `GET /sessions` ve `GET /customers/:id/sessions` aynı fonksiyonu kullanıyor (tek kaynak). Entegrasyon `AC-314/S13L-1`: yalnız geçmiş/müşteri yetkili kullanıcının kendi PENDING oturumunda 2 misafir → iki uçta 0, ADMIN aynı satırda 2. Unit `AC-305/S13L-1`            |

### Kabul kriterleri

| AC     | Durum                       | Kanıt                                                                                 |
| ------ | --------------------------- | ------------------------------------------------------------------------------------- |
| AC-304 | ✅                          | Tur 1 kanıtları yeşil (e2e rozet → konsol, lobi `toBeInViewport`)                     |
| AC-305 | ✅                          | Unit (çıkış yolları; artık `lobby-count.ts` üzerinden) + entegrasyon + e2e            |
| AC-306 | ✅                          | e2e `u-noreq` 360 px sayaç; düzeltilmiş AC metniyle birebir                           |
| AC-307 | ✅                          | Unit `diff.test.ts` + e2e                                                             |
| AC-308 | ✅                          | Unit `tab-title.test.ts` + e2e                                                        |
| AC-309 | ✅                          | Entegrasyon sahiplik/tenant matrisi + e2e ADMIN                                       |
| AC-310 | ✅                          | Entegrasyon 403 + e2e (rozet var, bağlantı/sayaç yok, uç çağrılmıyor)                 |
| AC-311 | ✅                          | Strict şema + entegrasyon gövde taraması + e2e ad yok                                 |
| AC-312 | ✅                          | Madde 1 (360/1280 px, iki tema axe 0, taşma yok, Tab + Enter) + `aria-live` tekrarsız |
| AC-313 | ✅                          | e2e hesaplanan stil + reduced-motion                                                  |
| AC-314 | ✅                          | Entegrasyon 401/403/no-store/audit yok/60–61 sınırı/perf; S13L-1 sıkılaştırması       |
| AC-315 | ✅                          | e2e 500/ağ kesme/restart + unit yeni `Rooms` → 0                                      |
| AC-316 | — staging'de test-operatoru | Bloklayıcı değil (koordinatör talimatı)                                               |

### Düzeltilmeli

Yok.

### Definition of Done

| Madde                                 | ✅/❌ | Not                                                                 |
| ------------------------------------- | ----- | ------------------------------------------------------------------- |
| Lint / typecheck temiz                | ✅    |                                                                     |
| Unit testler yeşil, skip yok          | ✅    | 78 + 271 + 368                                                      |
| Entegrasyon testleri yeşil            | ✅    | 554/554                                                             |
| e2e yeşil; skip'ler gerekçeli         | ✅    | 329 geçti                                                           |
| Her AC'nin test kanıtı                | ✅    | AC-316 staging adımı (test-operatoru)                               |
| Tasarım–kod uyumu; sapmalar gerekçeli | ✅    | `lobby-count.ts` ayrımı ve S13L-1 implementation.md'de              |
| Katman / `any` / hata yutma / PII     | ✅    | Değişmedi; `withWaitingGuests` yetkiyi arka uçta uyguluyor          |
| Erişilebilirlik                       | ✅    | 360 ve 1280 px, iki tema axe 0; Tab erişimi                         |
| Token, ikon, animasyon (§1.6/§1.8)    | ✅    | Tur 1'deki gibi                                                     |
| Dosya ≤ 300 satır                     | ✅    | Yeni dosyalar ≤ 157; `rooms.ts` +2 gerekçeli, `history.ts` büyümedi |
| Yeni bağımlılık / env / grant         | ✅    | Yok                                                                 |
| Dokümanlar                            | ✅    | Kılavuz, api.md ve CHANGELOG teknik-yazar adımında (mimari §10.3)   |

### Öneriler (zorunlu değil)

- Tur 1 önerileri geçerli: AC-304 kabul akışında yeniden yükleme yerine `tick`; AC-316'da ekran okuyucuyla çift duyuru (K-L4) gözlemi; 360 px kartta n = 0 yuvasının görsel değerlendirmesi.

### Olumlu

- S13L-1 tek fonksiyonda çözülmüş ve iki uç aynı yolu kullanıyor; yetki kontrolü arka uçta, testle sabit.
- `lobby-count.ts` saf ve `Rooms`'tan bağımsız; `rooms.ts` yalnız 2 satır büyüdü.

## P13c (kod kısmı) — Tur 1

Tarih: 2026-11-15 · Denetçi: qa-denetci · Kapsam: C1, C2, C4 (commit edilmemiş değişiklikler). C3 kurulum, C5 duman testi ve C6 bilerek kapsam dışı (DNS + §20 terfisi bekleniyor). Staging'e bağlanılmadı.
DURUM: DÜZELTİLMELİ

### Test sonucu

| Komut                                                                 | Sonuç                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy/test-caddy.sh`                                                | 66 PASS / 0 FAIL / 0 skip, rc 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `deploy/ops/test-watch.sh`                                            | 57 PASS / 0 FAIL / 0 skip, rc 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `deploy/ops/test-proxy-guard.sh`                                      | 44 PASS / 0 FAIL / 0 skip, rc 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `deploy/backup/test-backup.sh`                                        | 60 PASS / 0 FAIL / 0 skip, rc 0 (bölüm H: 4 yeni madde)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| shellcheck (`koalaman/shellcheck:stable -S warning`): değişen 8 betik | 0 uyarı. Değişmeyen `backup.sh`/`restore.sh`'teki SC2034/SC2154 uyarıları, kaynak alınan lib dosyalarından gelen yanlış alarmlar; P13c'den önce de vardı                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| actionlint `rhysd/actionlint:1.7.7` (`agent-win.yml`, `ci.yml`)       | 0 bulgu                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **C1 fark 0 (QA yeniden üretti, scratch, sahte değerler)**            | `HEAD` compose + `HEAD` `.env.example` ↔ yeni compose + yeni `.env.example` (prod biçimi: `CADDY_BIND=127.0.0.1`, `DEPLOY_ENV=production`, `IMAGE_TAG`, `SITE_HOST`): 258/258 satır, dizin yolu normalleştirilince `diff` boş. Yeni compose + **eski** `.env` (prod `.env` değişmeden): `diff` boş. `caddy adapt` (prod env, HEAD ↔ yeni Caddyfile): 1318/1318 satır, `diff` boş. Staging `.env`: `name: remote-stg`, 4460/4461, 172.30.1.2/.3, subnet/ip_range 172.30.1.x, `TRUSTED_PROXY_CIDR 172.30.1.2/31`, `CADDY_TRUSTED_PROXIES`, `ROBOTS_NOINDEX: "1"`, volume'lar `remote-stg_*`. `CADDY_TRUSTED_PROXIES` eksik olunca compose duruyor |

Konteynerler: `rs-qa-p13c-*` (`--rm`) ve testlerin kendi konteynerleri (`remote-caddy-test*`, `rstb*`) silindi; kalıntı yok. `anomali-*`, `pam-*` ve `rs-mysql-test` konteynerlerine dokunulmadı, prune yapılmadı.

### Kabul ölçütleri (mimari-e11 §3.4)

| Ölçüt                                                 | Durum         | Kanıt / eksik                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1: prod `.env` ile `docker compose config` farkı 0   | ✅            | Yukarıdaki QA yeniden üretimi (iki biçim + eski `.env`) ve `caddy adapt` farkı 0. CI adımı `ci.yml:117-122`: staging katmanı geçerli, prod çıktısında `ROBOTS_NOINDEX` yok                                                                                                                                                                                  |
| C1: shellcheck temiz                                  | ✅            | Değişen betiklerde 0 uyarı                                                                                                                                                                                                                                                                                                                                  |
| C2: staging yedeği prod'da reddedilir                 | ✅            | `test-backup-inner.sh` H: prod dizininde `--target staging` → ret (DEPLOY_ENV), `--target production` → ret (manifest `env=staging`). Ters yönde de ret (prod yedeği staging dizininde). Canlıya dokunulmuyor (`restore-reset`/`durduruluyor` yok). Proje adı `.env` `COMPOSE_PROJECT_NAME` ile çözülüyor; compose `name:` bilerek yanlış verilerek sınandı |
| C2: betiklerde sabit `remote-mysql-1` yok             | ✅            | `backup.sh`/`restore.sh` zaten `docker compose ps -q mysql` kullanıyordu. Runbook'taki 5 sabit ad `$(docker compose ps -q mysql)` ile değiştirildi                                                                                                                                                                                                          |
| C2 (ek): `remote-watch@stg` ve `proxy-guard` çok port | ✅            | test-watch 5b (8 madde: ayrı env/durum, `[stg]` alarm, coturn kontrolü yok, `@stg` birimi prod'da sayılmaz, `WATCH_PUBLIC_HOST` zorunlu). test-proxy-guard P13c (10 madde; tek port kural metni P13b ile aynı)                                                                                                                                              |
| C4: stg artifact Release'de görünmez                  | ✅ (statik)   | `release` job `if: github.ref_type == 'tag'` ve `name: agent-win` değişmedi. Staging adresi yalnız `workflow_dispatch` + `refs/heads/main` ile gömülüyor; etikette dispatch build adımında reddediliyor; artifact `agent-win-stg`. GitHub üzerinde gerçek dispatch koşusu yapılmadı (kapsam: yerel)                                                         |
| C4: prod Release akışı değişmez                       | ✅            | Etiket push'unda `server=$VAR_SERVER_URL`, artifact/exe adı `agent-win`/`NoktaDestek.exe`; `attest` ad çıktısını aynı değerle alıyor; `release` job diff'te yok                                                                                                                                                                                             |
| C4: S6-4 korunur                                      | ✅            | PR ve main dışı dallar yer tutucu adresle derleniyor; dispatch'te `choice` + betik içi tam eşitlik (`STG_SERVER_URL`), ref ve sürüm regex'i var. Girdiler `env:` ile veriliyor (ifade enjeksiyonu yok)                                                                                                                                                      |
| C4: stg exe stg sunucusuna bağlanır                   | — kapsam dışı | Çalışma anı kanıtı C3/C5'te                                                                                                                                                                                                                                                                                                                                 |

### Proje CLAUDE.md değişmez kuralları

| Kural                                                          | Durum | Not                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Yeni env → `.env.example` (boş) + `env.ts` + compose + runbook | ✅    | Yeni anahtarlar server env'i değil (mimari §3.2 "env.ts değişmez"). `.env.example` (boş + açıklamalı; `COMPOSE_*` bilinçli olarak yorum satırı, gerekçeli), compose ve runbook §21.1 tamam. `deploy/.env.example` yerine kök `.env.example` kullanılması gerekçeli bir sapma |
| Action'lar SHA ile sabit, `permissions` en az                  | ✅    | Yeni action yok; mevcut `uses` satırları SHA'lı; izinler değişmedi                                                                                                                                                                                                           |
| Caddy log / CSP                                                | ✅    | Log maskesi testleri geçiyor (test-caddy)                                                                                                                                                                                                                                    |
| Yeni bağımlılık                                                | ✅    | Yok                                                                                                                                                                                                                                                                          |

### Düzeltilmeli

1. **[devops] `docs/runbook.md:653-659` (§11.5) ve `:661-665` (§11.6), ayrıca `:680` sorun giderme satırı.** Bu bölümler hâlâ `verify-and-publish.sh --run <id> --ssh root@185.126.217.99`'u "staging test yayını" olarak anlatıyor (hedef varsayılanı `/opt/remote/deploy`). Oysa yeni `apply` ortam kilidi `run-*` etiketini hem `DEPLOY_ENV=production` hem `DEPLOY_ENV=staging` hedefte reddediyor (`verify-and-publish.sh:50-57`). Sonuç: §11.5 yolu, `--allow-failed-run` ve §11.6'daki `--run … --no-attestation` örneği sunucuda artık çalışmıyor. Bugünkü sunucu §20 terfisine kadar `DEPLOY_ENV=staging` olduğundan, §11.5 terfiden önce de reddediliyor. **Beklenen:** §11.5 ve §11.6 yeni davranışa göre yeniden yazılsın: staging exe yalnız `--stg-run` ile (§21.3/10); `--run`/`--dir` yalnız yerel/development hedef; prod'a yalnız `--tag`. Sorun giderme tablosuna "DEPLOY_ENV=production hedefe yalnız Release etiketi" ve "staging hedefe yalnız --stg-run" ret mesajları eklensin. §20 geri dönüş yolunda (`:2136`, `.env` yeniden `DEPLOY_ENV=staging` olur) istemci yeniden yayınının hangi bayrakla yapılacağı bir cümleyle yazılsın.
2. **[devops] `deploy/agent/verify-and-publish.sh:8-9, 17-18, 36`.** Kullanım metni yeni davranışla çelişiyor. `--tag … # Release (prod/staging)`: staging hedef artık Release'i reddediyor. `--run … # main push artifact'i (staging)`: staging de reddediyor. `--allow-failed-run … Yalnız staging`: staging'de ulaşılamaz. Ayrıca `usage()` yalnız `sed -n '2,24p'` basıyor, yeni "Ortam kilidi" satırları (26-28) yardım çıktısına girmiyor. **Beklenen:** Başlık yorumları kilitle tutarlı olsun (`--run`/`--dir`: yalnız development/yerel; `--tag`: yalnız production; `--stg-run`: yalnız staging), `usage` aralığı kilit açıklamasını da kapsasın. Davranış değişmeyecek, yalnız metin düzeltilecek.

### Definition of Done (P13c kod kısmı)

| Madde                                                | ✅/❌ | Not                                                                                                                                                        |
| ---------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Testler yeşil (4 betik)                              | ✅    | 66 + 57 + 44 + 60                                                                                                                                          |
| Lint (shellcheck, actionlint)                        | ✅    | 0                                                                                                                                                          |
| §3.4 C1/C2/C4 ölçütleri kanıtlı                      | ✅    | Yukarıda                                                                                                                                                   |
| Tasarımdan sapmalar `implementation.md`'de gerekçeli | ✅    | Staging katman dosyası, kök `.env.example`, `EDGE_TRUSTED_PROXY_CIDR` adı, `COMPOSE_*` yorum satırı, `verify-and-publish` ek kilit ve proxy-guard çok port |
| Runbook davranışla tutarlı                           | ❌    | Madde 1 ve 2                                                                                                                                               |
| Gizli bilgi repoda yok                               | ✅    | `.env.example` boş; staging sırlarının ayrı üretileceği runbook'ta yazılı                                                                                  |
| Kapsam dışı iş yok (spekülatif kod)                  | ✅    | `remote-watch` örnek desteği ve proxy-guard çok port C3 için gerekli ve gerekçeli                                                                          |

### Öneriler (zorunlu değil)

- `agent-win.yml:27-29` concurrency grubu `agent-win-${{ github.ref }}`, `cancel-in-progress` main'de açık. Main'de yapılan staging dispatch'i süren bir main push koşusunu (ya da tersini) iptal eder. Grup adına `github.event_name` eklenmesi düşünülebilir.
- `verify-and-publish.sh` `apply`: hedef `.env`'de `DEPLOY_ENV` boş ya da yoksa `run-*`/`dir-*` etiketleri kabul ediliyor (fail-open). Prod'da `DEPLOY_ENV` yedek için zaten zorunlu, risk düşük. Yine de `--ssh` hedefinde boş değer için ret düşünülebilir.
- `--stg-run --local` birlikte verilince hedef `/opt/remote-stg/deploy` oluyor, betiğin üst klasörü değil. Fail-closed (klasör yoksa "deploy klasörü değil" hatası), ama beklenmedik. Ya `--local` ile birlikte reddedilsin ya da varsayılan yalnız `--ssh` için atansın.
- `deploy/test-caddy.sh` sabit `remote-caddy-test` adı kullanıyor (P13c öncesinden). Paralel koşularda çakışmaması için rastgele bir ek düşünülebilir.
- `remote-backup-failed@.service` alarm metni `remote-backup.service`'e işaret ediyor. Runbook §21.6'da belgelenmiş, ama örnek adının metne geçirilmesi daha temiz olur.

### Olumlu

- Fark 0 ölçütü katman dosyası seçimiyle gerçekten sağlanmış: compose ve `caddy adapt` çıktıları birebir aynı. `robots_{$ROBOTS_NOINDEX:0}` ayrıştırma anı seçimi prod JSON'una dokunmuyor.
- `agent_downloads` volume adının sabit değere geri düşmesi kaldırılmış; staging dizininden prod volume'una yazma riski kapandı.
- Ortamlar arası geri yükleme kilidi iki yönde de testli. Prod `remote-watch` ile staging `@stg` birim alarmları birbirine karışmıyor.
- C4'te ifade enjeksiyonu yok, girdi hem `choice` hem betik içinde doğrulanıyor, Release job'una dokunulmamış.

## P13c (kod kısmı) — Tur 2

Tarih: 2026-11-15 · Denetçi: qa-denetci · Kapsam: devops düzeltme turu 1 (QA Tur 1 maddeleri 1-2, güvenlik S13C-1/2/3/5) ve düzeltme turu 2 (S13C-13). Değerlendirilen ağaç, son değişiklik saatleri 03:06–03:07 olan sürüm. Staging'e bağlanılmadı, prettier çalıştırılmadı.
DURUM: DÜZELTİLMELİ

### Test sonucu (son ağaç)

| Komut                                                                               | Sonuç                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy/agent/test-publish-lock.sh`                                                 | **20/20**, rc 0                                                                                                                                                                                                                                                                                             |
| `deploy/backup/test-backup.sh`                                                      | Kararlı ağaçta 2 koşu yapıldı. Koşu A: **69 PASS / 1 FAIL**, rc 1 (`sıfırlama sonrası uyarı + rc 0, fark yalnız bilgi (S-P13b-10)`; çıktı `FAILED adım=audit-sureklilik rc=141`). Koşu B: **70/70**, rc 0. Bu denetimin ilk koşusu devops'un eşzamanlı düzenleme ve test koşusuyla çakıştığı için sayılmadı |
| `deploy/ops/test-watch.sh`                                                          | 57/57                                                                                                                                                                                                                                                                                                       |
| `deploy/ops/test-proxy-guard.sh`                                                    | 44/44                                                                                                                                                                                                                                                                                                       |
| `deploy/test-caddy.sh`                                                              | 66/66                                                                                                                                                                                                                                                                                                       |
| shellcheck `-S warning` (değişen/yeni 11 betik, `lib.sh` ve `lib-offsite.sh` dahil) | 0                                                                                                                                                                                                                                                                                                           |
| actionlint 1.7.7 (`agent-win.yml`, `ci.yml`)                                        | 0                                                                                                                                                                                                                                                                                                           |
| C1 prod `docker compose config` farkı (QA yeniden üretimi)                          | HEAD ↔ son ağaç (yeni `.env.example` ve eski `.env` ile): 258/258 satır, `diff` **0**. `caddy adapt` (prod env): 1318 satır, `diff` **0**                                                                                                                                                                   |

Konteyner ve volume kalıntısı yok (`rstb*`, `rs-qa-p13c2-*`, `remote-caddy-test*`). `anomali-*`, `pam-*` ve `rs-mysql-test` konteynerlerine dokunulmadı, prune yapılmadı.

### Tur 1 maddeleri

| #                           | Durum | Kanıt                                                                                                                                                                                                                                                                                                     |
| --------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 runbook §11.5/§11.6/§11.7 | ✅    | §11.5 kilit tablosu (prod yalnız `--tag`, staging `--stg-run`/`--dir`, tek yığın staging yalnız `--tag`, development yerel); §11.6 yerel/staging/prod ayrımı; §11.7'de ret mesajları; §20.8(a)/(b) geri dönüşte yedek ve istemci yolu. Kodla tutarlı (`verify-and-publish.sh` `apply`, test-publish-lock) |
| 2 betik kullanım metni      | ✅    | `--help` çıktısı kilit açıklamasını kapsıyor; `--tag` "YALNIZ prod", `--run` "YALNIZ yerel", `--allow-failed-run` "yalnız development"                                                                                                                                                                    |

### Güvenlik düzeltmelerinin davranışa etkisi

| Madde                                                         | Durum | Not                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S13C-1: proje adı kilidi                                      | ✅    | prod + proje `remote-stg` → ret; staging + proje `remote` → yalnız `vX.Y.Z` (tek yığın: bugünkü sunucu ve §20.8 geri dönüşü). `AGENT_PUBLISH_LEGACY_STAGING` bayrağı kaldırıldı; repoda kalan referans yok. `docker-compose.staging.yml` `name: remote-stg` prod çıktısını etkilemiyor (fark 0)                                                                                                                                               |
| S13C-2: `remote-backup@` yolları + `nonprod_paths_guard`      | ✅    | Şablon birimler üç yolu ve `BACKUP_UNIT_NAME`'i `Environment=` ile zorluyor. test-backup I: ikinci yığın + prod yolları → status yazılmadan ret; production'da koruma devre dışı; `--alert` metni örnek birimine işaret ediyor                                                                                                                                                                                                                |
| S13C-13: regresyon (bugünkü tek yığın staging gecelik yedeği) | ✅    | Tur 2 ara durumunda bulduğum bir sorun devops'un düzeltme turu 2'siyle kapandı: koruma `DEPLOY_ENV != production` iken her zaman çalışıyordu ve §20 terfisi öncesi sunucunun (`/opt/remote`, `DEPLOY_ENV=staging`, prod yolları) gecelik yedeğini ve §20.2/2 "son staging yedeği" adımını durduracaktı. Artık yalnız ikinci yığında (proje ≠ `remote` ya da şablon örneği) çalışıyor; test-backup I "legacy staging → yedek geçer" kanıtlıyor |
| S13C-3: `DEPLOY_ENV` fail-closed                              | ✅    | Boş, bilinmeyen değer ya da satırın hiç olmaması → ret; reddedilen hedefe dosya yazılmıyor (test-publish-lock)                                                                                                                                                                                                                                                                                                                                |
| S13C-5: watch kurulumu prod ağacından                         | ✅    | runbook §21.3/8                                                                                                                                                                                                                                                                                                                                                                                                                               |

### Düzeltilmeli

1. **[devops] `deploy/backup/test-backup.sh` kararsız; kök neden P13b yedek kodunda (`deploy/backup/lib-audit.sh`, `backup.sh:169-176` "audit-sureklilik" adımı).** Değişmemiş ağaçta iki koşudan biri `remote-backup: FAILED adım=audit-sureklilik rc=141` (SIGPIPE) ile kırmızı. Bu kod P13c'de değişmedi, ama aynı durum sunucuda gecelik yedeği ara ara FAILED yapabilir. `set -euo pipefail` altında SIGPIPE'a açık iki yer var: `lib-audit.sh:34` (`find … | LC_ALL=C sort -r | head -n 1`; `head` erken kapanınca `sort` 141 alır) ve `lib-audit.sh:47-48` (`{ printf …; cat audit-continuity.sql; } | sql_backup`; `mysql` girdiyi bitirmeden çıkarsa yazan taraf 141 alır). **Beklenen:** kök neden belirlensin ve giderilsin; örneğin `head -n 1` yerine girdinin tamamını okuyan `sed -n 1p` ya da `awk 'NR==1'` kullanılsın, ya da boru durumu açıkça ele alınsın. Ardından `test-backup.sh` **arka arkaya 3 koşuda 70/70** yeşil olsun ve sonuç `implementation.md`'ye yazılsın.

### Definition of Done (P13c kod kısmı)

| Madde                                | ✅/❌ | Not                                                                  |
| ------------------------------------ | ----- | -------------------------------------------------------------------- |
| Testler yeşil                        | ❌    | test-backup kararsız (madde 1); diğerleri yeşil                      |
| shellcheck / actionlint              | ✅    | 0 / 0                                                                |
| C1 fark 0, C2 ret, C4 Release ayrımı | ✅    | Tur 1 kanıtları geçerli; C1 ve `adapt` yeniden üretildi              |
| Runbook davranışla tutarlı           | ✅    | Tur 1 maddeleri 1-2 kapandı; S13C-13 sonrası §20.8 ve §21.3/7 güncel |
| Sapmalar gerekçeli                   | ✅    | implementation.md düzeltme turu 1-2                                  |

### Öneriler (zorunlu değil)

- **Güvenlik yeniden bakmalı (devops da not etmiş):** Bayrak kaldırılınca tek yığın istisnası koşulsuz oldu. Proje adı yanlış ayarlanmış bir ikinci yığına (`/opt/remote-stg`, `COMPOSE_PROJECT_NAME`/`COMPOSE_FILE` unutulmuş, `DEPLOY_ENV=staging`) `--tag … --deploy-dir /opt/remote-stg/deploy` verilirse `apply` kabul ediyor. Volume adı `remote_agent_downloads` (prod) çözülüyor, prod volume'una yazılıyor ve `AGENT_SHA256` staging `.env`'ine gidiyor; prod'da `mismatch` alarmı çıkabilir. Kötü niyet değil, yapılandırma hatası senaryosu. Yedek tarafındaki gibi şablon/dizin ölçütüyle sınırlama düşünülebilir (ör. `dir` `/opt/remote/deploy` değilse ve proje `remote` ise ret).
- Tur 1 önerileri (concurrency grubu, `--stg-run --local`, `test-caddy` sabit konteyner adı) açık; zorunlu değil.

### Olumlu

- test-publish-lock konteynersiz ve hızlı; kilidin tüm dallarını (ret mesajları dahil) kapsıyor.
- Yedek yol koruması status yazmadan önce duruyor; prod `status.prom` kirlenmiyor ve bu testle kanıtlı.
- S13C-13 regresyonu QA raporuna gelmeden devops tarafından yakalanıp testle kapatılmış.

## P13c (kod kısmı) — Tur 3

Tarih: 2026-11-15 · Denetçi: qa-denetci · Kapsam: devops düzeltme turu 3 (QA Tur 2 madde 1 SIGPIPE + güvenlik S13C-14/15). Odaklı tur. Staging'e bağlanılmadı.
DURUM: GEÇTİ

### Test sonucu

| Komut                                                                                                                                              | Sonuç                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy/backup/test-backup.sh` arka arkaya 2 koşu                                                                                                  | **73/73** ve **73/73**, ikisi de rc 0 (yeni S13C-14 maddeleri 3)                                                                       |
| `deploy/agent/test-publish-lock.sh`                                                                                                                | **24/24** (yeni S13C-15 maddeleri 4)                                                                                                   |
| `deploy/ops/test-watch.sh`                                                                                                                         | **57/57**                                                                                                                              |
| shellcheck `-S warning` (13 betik: `lib.sh`, `lib-audit.sh`, `lib-restore.sh`, `lib-offsite.sh`, `verify-and-publish.sh`, `remote-watch.sh` dahil) | **0**. `backup.sh`/`restore.sh` `-x` ile bakıldığında yalnız eski, değişmemiş SC2034/SC2154 yanlış alarmları var (Tur 1'den beri aynı) |

Kalıntı yok: `rstb*` konteyner/volume 0, `rs-qa-p13c3-*` `--rm` ile silindi. Diğer projelerin konteynerlerine dokunulmadı.

### Tur 2 madde 1 (SIGPIPE) — ✅

- Kök neden doğru tespit edilmiş: `pipefail` + `set -e` altında erken kapanan okuyucu. `lib-audit.sh:34` `head -n 1` → `awk 'NR == 1'` (girdinin tamamını okuyor). SQL besleyen borular önce değişkene alınıp here-string ile veriliyor; ayrı bir yazıcı süreç kalmadı: `lib-audit.sh` audit-continuity, `restore.sh` reset, `lib-restore.sh` 4 sorgu. `lib.sh` imza doğrulamasındaki iki `head` ve `verify-and-publish.sh` volume/imaj seçimi de aynı yöntemle düzeltilmiş.
- Tarama: üretim betiklerinde (`backup.sh`, `restore.sh`, `lib*.sh`, `verify-and-publish.sh`, `remote-watch.sh`, `proxy-guard.sh`) `| head`, `| grep -q`, `| grep -m` kalmadı.
- **Davranış eşdeğerliği (restore dahil):** Komut ikamesi sondaki yeni satırları siliyor, here-string tek `\n` ekliyor; SQL içeriği ve sonucu aynı. `cat` hatası `set -e` ile yine durduruyor. Restore yolu testle kanıtlı: scratch geri yükleme `restore-verify: OK`; canlı geri yükleme (reset migrator, CHECKSUM canlı = scratch, `/ready`); host işareti; staging hedefinde scratch FAIL olunca canlıya dokunulmuyor; yanlış proje ve ortam kilitleri reddediyor; kalıcı iz yok. İki koşuda da yeşil.

### S13C-14/15 — ✅

- `stg_name_guard` (yedek) ve `apply` (yayın): proje `remote` iken `PUBLIC_BASE_URL` host'u ya da `SITE_HOST` `stg.` ile başlıyorsa ret. Tırnaklı değerler soyuluyor. Proje ≠ `remote` (gerçek ikinci yığın) etkilenmiyor. Prod ve bugünkü tek yığın staging (`stg.` adı yok) etkilenmiyor. Tur 2 önerisindeki "yanlış kurulmuş ikinci yığına `--tag`" senaryosu böylece kapanmış.
- `deploy_env_of` ortak `env_value_of` yardımcısına taşınmış; tırnak ve CR soyma korunuyor (test-publish-lock'taki tırnaklı `DEPLOY_ENV` maddesi yeşil).

### Düzeltilmeli

Yok.

### Definition of Done (P13c kod kısmı: C1, C2, C4)

| Madde                                | ✅/❌ | Not                                                                                                               |
| ------------------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------- |
| Testler yeşil                        | ✅    | test-backup 2/2 koşu tam; publish-lock, watch yeşil. caddy ve proxy-guard Tur 2'de yeşildi, bu turda değişmediler |
| shellcheck / actionlint              | ✅    | 0 / 0 (workflow'lar Tur 2'den beri değişmedi)                                                                     |
| C1 fark 0, C2 ret, C4 Release ayrımı | ✅    | Tur 1-2 kanıtları. Bu tur compose, Caddyfile ve workflow'lara dokunmadı                                           |
| Runbook ve implementation tutarlı    | ✅    | Düzeltme turu 1-3 gerekçeli                                                                                       |
| Kapsam dışı bekleyenler              | —     | C3 kurulum, C5 duman testi, C6 `CLAUDE.md` (DNS + §20 terfisi sonrası)                                            |

### Öneriler (zorunlu değil)

- `stg_name_guard`/`apply` yalnız `stg.` önekine bakıyor. Staging için başka bir ad seçilirse kural sessizce devre dışı kalır; ad tek yerde (ör. `STG_SERVER_URL` ile aynı kaynak) tutulabilir.
- Tur 1 önerileri hâlâ açık: `agent-win` concurrency grubu, `--stg-run --local`, `test-caddy` sabit konteyner adı.

### Olumlu

- SIGPIPE düzeltmesi tek noktayla sınırlı kalmamış; aynı sınıftaki bütün üretim borularını taramış, imza doğrulamasındaki gizli bir yanlış FAIL olasılığını da kapatmış.

## P14a/P14b — Tur 1

Tarih: 2026-11-15 · Denetçi: qa-denetci · Kapsam: AC-201..219 (P14a), AC-220..230 (P14b); implementation.md "P14a A0", "A5", "A1/B1", "B3 bölüm 1", "A3", "A2+B2", "S14-2", "P14 güvenlik düzeltmeleri", "A4+B3 bölüm 2"; `git diff b2e5771` + izlenmeyen dosyalar. Staging'e bağlanılmadı.

DURUM: DÜZELTİLMELİ

### Test sonucu

| Komut                                                                                                                                                                                                        | Sonuç                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `pnpm -r run lint` / `pnpm -r run typecheck` / `pnpm format:check`                                                                                                                                           | temiz / temiz / "All matched files use Prettier code style!"                                                                  |
| server `test` (unit)                                                                                                                                                                                         | 23 dosya / 377 geçti                                                                                                          |
| server `test:int` (geçici `mysql:8.4.13` `rs-qa-p14t1-x7k3`, 01-users.sh + `db:migrate` + `check-app-grants.sh` 393 PASS)                                                                                    | 62 dosya / **604 geçti**, 0 düştü, 0 skip                                                                                     |
| contracts `test`                                                                                                                                                                                             | 11 dosya / 84 geçti                                                                                                           |
| web `test` (vitest)                                                                                                                                                                                          | 34 dosya / 321 geçti                                                                                                          |
| web `e2e` (tam)                                                                                                                                                                                              | **356 geçti**, 0 düştü, 150 skip (hepsi `test.skip(project.name …)` proje ayrımı: desktopOnly/mobil/perf; `fixme`/`only` yok) |
| `scripts/repeat-tests.sh 3 int` (retry 0)                                                                                                                                                                    | 3/3 yeşil (604/604 her koşu; 85/103/121 sn)                                                                                   |
| `deploy/ops/test-watch.sh` · `deploy/agent/test-publish-lock.sh` · `deploy/backup/test-backup.sh`                                                                                                            | GEÇTİ · GEÇTİ · GEÇTİ (73 PASS)                                                                                               |
| shellcheck 0.11.0 `-S warning` (29 dosya: `deploy/**/*.sh`, `scripts/*.sh`)                                                                                                                                  | 0 bulgu                                                                                                                       |
| AC-201 elle: `down.sql` → `$` CHECK'ler geri, iki sütun yok, migration kaydı silindi; `\n` sonlu satırla `migrate deploy` → 1644 `P14A_PRECHECK customers=1` (durdu); satır düzeltilince up temiz, `\z` geri | GEÇTİ                                                                                                                         |
| Gecikme kancalı testler (AC-202 ×2, AC-206, AC-214): her biri test içinde 20 tur; tam koşu + tekrar koşularında hepsi yeşil                                                                                  | 20/20                                                                                                                         |

AC-219 notu: 20 ardışık koşu `.github/workflows/stability.yml` (workflow_dispatch + haftalık, int + e2e, retry 0) ile CI'da yapılacak; henüz koşulmadı (commit/push yok). Yerel örnek yukarıda.

### Kabul kriterleri

| AC  | Durum       | Kanıt veya eksik                                                                                                                                                                                                                                                                                                                                |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 201 | ✅          | `security-p14a-db` "AC-201" ×3 (6 CHECK × `\n` → 3819, 8 sonlandırıcı, information_schema `\z`); ön kontrol + down/up elle doğrulandı                                                                                                                                                                                                           |
| 202 | ✅          | `security-p14a-users` "AC-202" ×3 (gecikme kancalı 20/20 → FORBIDDEN + `denied:["users.edit"]`, id sıralı kilit deadlock yok, pasif aktör)                                                                                                                                                                                                      |
| 203 | ✅          | "AC-203" ×3 (POST 10/dk, toplam 30/dk, /admin 30/dk, Retry-After, 409 `result:fail` e-postasız). `/admin/settings/*` 10/dk'da kaldı (daha sıkı, sapma 5)                                                                                                                                                                                        |
| 204 | ✅          | "AC-204" + "AC-204/S14-5"                                                                                                                                                                                                                                                                                                                       |
| 205 | ✅          | `security-p14a-tenants` "AC-205" ×2 (commit sonrası adımlar düşse de iptal/geçersiz, yeniden etkinleştirmede geri gelmez) + `p14a-a3` "AC-205/S14-4"                                                                                                                                                                                            |
| 206 | ✅          | `security-p14a-users` "AC-206" ×3 (428/409/mesaj, sürüm artışı, kancalı 20/20) + e2e `p14a-a4` "AC-206" ×2 (rol geri alma, If-Match + 409 + Yeniden yükle)                                                                                                                                                                                      |
| 207 | ✅          | "AC-207" (tam harita + kilitli anahtar + rol → 200, tekrar → audit/sürüm yok). Not: AC "users-p9" diyor, test `security-p14a-users`'da                                                                                                                                                                                                          |
| 208 | ✅          | `p14a-a3` "AC-208" (/metrics) + unit "AC-208/S14-6"; runbook §22.2 eşik; test-watch 11 yeni test                                                                                                                                                                                                                                                |
| 209 | ✅          | `p14a-a3` "AC-209" ×2 + "AC-209/S14-1"                                                                                                                                                                                                                                                                                                          |
| 210 | ✅          | `p14a-a3` "AC-210" (35 güvenilen açık, dışı 31. → 429)                                                                                                                                                                                                                                                                                          |
| 211 | ✅          | `p14a-a3` "AC-211" ×2 (sahte TLS'siz + gerçek MySQL → `tls`), unit (loopback/özel/public), `p14a-a3-settings` kalıcılık + CHECK, e2e "AC-211"                                                                                                                                                                                                   |
| 212 | ✅          | `p14a-a3` "AC-212" + runbook §22.2 (1 sa ≥ 10)                                                                                                                                                                                                                                                                                                  |
| 213 | ✅          | `mail-starttls-p14a` "AC-213" ×4 (yanlış ad → `tls` ileti 0; ilan etmeyen → düz metne düşmez; desteklemeyen → gönderim yok)                                                                                                                                                                                                                     |
| 214 | ✅          | `security-p14a-auth` "AC-214" (kancalı 20/20, kazananın sırrı geçerli)                                                                                                                                                                                                                                                                          |
| 215 | ✅          | `security-p14a-auth` "AC-215" ×4 (403 SETUP, 401 STEP_UP, 5 dk, TOTP tekrar ret, kurtarma kodu tüketimi + e-posta + `remaining`, sayaç ortak) + e2e ×2 + web `p14a-a4.test`. Not: audit adı `auth.step_up{method:"RECOVERY"}` — AC metni `mfa.step_up{method:"recovery_code"}` (mimari §4.2'ye uyuldu, sapma 2; AC metni hizalanmalı, Öneriler) |
| 216 | ✅          | `p14a-a3` "AC-216" (31. → 4429 `retry=`, oturum kovası) + e2e ×2 (sessiz yeniden bağlanma, 12 gezinti tek bağlantı, konsol 0) + `requests.test` jitter                                                                                                                                                                                          |
| 217 | ✅          | `p14a-a3-settings` "AC-217" ×3 (değişmeyen mysql/turn audit yok, `_` filtre), `dark-tokens.test`, `startup-check.test`, contracts `RETENTION_DEFAULT_DAYS`/`canonicalWaUrl` web'de contracts'tan, global retention fonksiyonları silindi, CI shellcheck                                                                                         |
| 218 | ✅          | ADR-0024 + `pnpm format:check` 0 fark + CI `quality` adımı (AC adlı test gerekmez)                                                                                                                                                                                                                                                              |
| 219 | ⚠️ kanıtsız | CI 20 koşu henüz yok; yerel 3/3 örnek. `stability.yml` çalıştırılıp sonucu raporlanmalı                                                                                                                                                                                                                                                         |
| 220 | ✅          | e2e `p14b-ui` "AC-220" (HTTP 404, tek h1, axe iki tema; var olan kayıt 200)                                                                                                                                                                                                                                                                     |
| 221 | ✅          | `switch-contrast.test` "AC-221" (iki tema × zeminler ≥ 3:1, kilitli opaklık yok)                                                                                                                                                                                                                                                                |
| 222 | ✅          | e2e "AC-222" (375/390, `toBeInViewport`, ipucu)                                                                                                                                                                                                                                                                                                 |
| 223 | ✅          | e2e "AC-223" + `customers.spec`                                                                                                                                                                                                                                                                                                                 |
| 224 | ✅          | e2e "AC-224" ×2 (alanlar, istemci/sunucu hata, salt okunur, hata durumu, 390 px, axe iki tema) + `security-p14a-tenants` "AC-224" (alan doğrulama, audit eski→yeni) + `limits.test`                                                                                                                                                             |
| 225 | ❌          | Tenant kapsamlı yol ✅ (`security-p14a-users` "AC-225" ×2, e2e 150 seçenek). **Eksik:** firma seçmemiş Super Admin'de `/history` teknisyen seçenekleri hâlâ **sayfadaki kayıtlardan** üretiliyor (`history/page.tsx:40-48, 88, 112-115`) — AC "sayfadaki kayıtlardan değil seçenek uçlarından" der (madde 1)                                    |
| 226 | ✅          | `security-p14a-tenants` "AC-226" ×4 (≤ 20, sıralama, joker kaçışı, 250 firmada p95 ≤ 500 ms, yalnız SA) + e2e ×2 (klavye, 250 ms debounce)                                                                                                                                                                                                      |
| 227 | ✅          | e2e `p5-collab` "AC-227", `chat-rate.test` (alıcı ≥ gönderen, gecikmeli simülasyonda 0 düşme)                                                                                                                                                                                                                                                   |
| 228 | ✅          | e2e "AC-228" (+ LeaveDialog Esc kök neden düzeltmesi)                                                                                                                                                                                                                                                                                           |
| 229 | ✅          | e2e `p12-branding` "AC-229" (gerçek `type:""` File), `branding.test`                                                                                                                                                                                                                                                                            |
| 230 | ✅          | `large-write.test` "AC-230" (altı/tam/üstü); `files-panel.tsx:169` aynı fonksiyonu kullanır. DOM bileşen test altyapısı yok — mimari §5.1 saf fonksiyon kararıyla uyumlu                                                                                                                                                                        |

### Sapma değerlendirmesi

Kabul (gerekçeli, davranış AC'yi karşılıyor): A2 sapma 1 (hatalı kod 400), 3 (`CONFLICT` + `fields.email`), 4 (`TENANT_PASSIVE`), 5, 6, 7, 8; A3 `p14a_mysql_tls` ek migration; B3 AC-220 `[id]/layout.tsx` yazılmaması (404 doğrulandı), AC-223 bağlam/ref, AC-227 kayan pencere; A0 `eslint-config-prettier` eklenmemesi; B1 indeks yok (ölçümlü). Kabul edilmeyen: A2 sapma 9 + A4 sapma 1 (AC-225 Super Admin yolu, madde 1).

### Düzeltilmeli

1. [backend-dev] `apps/server/src/users/routes.ts` `/users/options` — firma seçmemiş Super Admin 403 alıyor, bu yüzden web sayfa kayıtlarına düşüyor → Super Admin için isteğe bağlı `?tenantId=<id>` kabul et (yalnız SUPER_ADMIN; tenant varlığı doğrulanır; aynı 1.000 üst sınır ve `fullName` sırası); diğer rollerde parametre yok sayılır veya 400. Entegrasyon testi adında "AC-225": SA + tenantId → o firmanın tam listesi, ADMIN tenantId ile başka firmayı göremez.
2. [frontend-dev] `apps/web/app/(panel)/history/page.tsx:40-48,88,112-115` — `options(items, s => s.technician)` yedeğini kaldır. Super Admin firma filtresi seçiliyse `/users/options?tenantId=<filters.tenantId>` ile tam liste; firma seçili değilse teknisyen seçicisi pasif + "Önce firma seçin" ipucu (URL'deki seçili id "Seçili (…)" olarak korunur). e2e adı "AC-225": SA'da firma seçilmeden seçici pasif, firma seçilince uçtan gelen liste (sayfa kayıtlarında olmayan teknisyen de görünür).
3. [backend-dev] `docs/api.md:1406-1412` (`/ws/panel`) — oturum başına 30 upgrade/dk aşımında upgrade kabul + `close(4429, "retry=<sn>")` ve `too_many` (6. soket) ayrımı yazılmamış → ekle. Aynısını `docs/mimari-protokol.md` §5.3 tablosuna (kapanış kodları) ekle.
4. [backend-dev] `docs/api.md:200-201` ve §1820 civarı MySQL ayarları — `requireTls: boolean` (GET/PUT/test gövdesi, varsayılan false), test sonucu yeni sınıf `tls` ve `allowPublicKeyRetrieval` kuralı (yalnız loopback/özel IP) belgelenmemiş → ekle.
5. [dba] `docs/db-notlari.md` "P14a" bölümü — ikinci migration `20261116010000_p14a_mysql_tls` (CHECK JSON şemasına `requireTls`, down'ı, up/down doğrulaması) hiç geçmiyor → kayıt ekle.
6. [devops] `scripts/repeat-tests.sh:7` ve `docs/implementation.md` (A2 "Test": "`scripts/test-db.sh`") var olmayan `scripts/test-db.sh`'a atıf yapıyor → ya betiği ekle (geçici benzersiz MySQL + 01-users + migrate + grants; CI test işiyle aynı adımlar) ya da atıfları CI/runbook adımına çevir.
7. [devops] AC-219 — push sonrası `stability.yml`'ı `runs=20` ile çalıştır; int ve e2e sonucunu (`SONUÇ: x/y`) `docs/implementation.md` "Kararsız testler" altına yaz (liste boş kalmalı). Bu yapılmadan AC-219 ✅ olamaz.

### Definition of Done

| Madde                                                           | Durum | Not                                                                                          |
| --------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------- |
| Tüm AC'ler testle kanıtlı                                       | ❌    | AC-225 eksik, AC-219 CI kanıtı yok                                                           |
| Testler yeşil (unit/int/e2e/contracts/deploy)                   | ✅    | yukarıdaki tablo                                                                             |
| Lint, typecheck, format temiz                                   | ✅    |                                                                                              |
| Gecikme kancalı testler 20/20                                   | ✅    |                                                                                              |
| Tasarım–kod uyumu, sapmalar gerekçeli                           | ✅    | sapma 9 hariç kabul                                                                          |
| API dokümanı güncel (api.md, mimari-api.md)                     | ❌    | madde 3, 4 (mimari-api.md'de yeni uçlar/hata kodları var)                                    |
| db-notlari güncel                                               | ❌    | madde 5                                                                                      |
| Runbook alarmları (AC-208/212)                                  | ✅    | §22.2 + remote-watch eşikleri                                                                |
| Yeni env → .env.example/env.ts/compose/runbook                  | ✅    | uygulama env'i yok; `WATCH_*` watch.env.example + runbook'ta                                 |
| Yeni tablo → grants.sql                                         | ✅    | yeni tablo yok; check-app-grants 393 PASS                                                    |
| Yeni bağımlılık gerekçeli, AGPL/GPL yok                         | ✅    | yalnız `prettier` 3.10.1 (MIT, A0'da gerekçeli)                                              |
| Kalite taraması (`any`, hata yutma, ham renk, `.only`, PII log) | ✅    | yeni renkler yalnız `globals.css` token tanımı; tek gerekçeli `eslint-disable` (`stage.tsx`) |
| 5 durum + iki temada axe (yeni ekranlar)                        | ✅    | `/settings/general`, step-up diyaloğu, firma seçici                                          |
| Güvenlik Kritik/Yüksek 0                                        | ✅    | guvenlik-raporu "P14a/P14b — kod turu 2" GEÇTİ                                               |
| Kararsız test listesi boş                                       | ⚠️    | yerelde boş; CI 20 koşu bekleniyor                                                           |

### Öneriler (zorunlu değil)

- AC-215 metnindeki `mfa.step_up{method:"recovery_code"}` ile koddaki/mimarideki `auth.step_up{method:"RECOVERY"}` farkı: proje-yöneticisi AC metnini mimariye hizalasın.
- `history/[id]` olmayan id'de hâlâ 200 (B3 notu); aynı route group düzeltmesi P15'te uygulanabilir.
- AC-207 testi `users-p9.test.ts` dosyasına da bir referansla bağlanabilir (AC metni o dosyayı anıyor).

### Olumlu

- Gecikme kancaları zamanlama varsayımsız (kilit tutan TX bekletiliyor); 20 tur test içinde, tam ve tekrar koşularında kararlı.
- AC-201 ön kontrolü gerçekten durduruyor (`P14A_PRECHECK customers=1`), down/up döngüsü temiz.
- AC-229 ve AC-228'de önceki "geçen ama geçersiz" test ve kök neden yarış düzeltilmiş; CI e2e kırmızıları kök nedenle kapatılmış (retry yok).
- Yeni bağımlılık yok; shellcheck 0; format 0 fark.

## P14a/P14b — Tur 2

Tarih: 2026-11-15 · Denetçi: qa-denetci · Kapsam: Tur 1'in 7 maddesi (implementation.md "P14 QA Tur 1 düzeltmesi — AC-225", api.md, mimari-protokol §5.3, db-notlari, repeat-tests.sh) + son güvence tam e2e. Geçici konteyner `rs-qa-p14t2-m4q8` (mysql:8.4.13), iş sonunda silindi.

DURUM: DÜZELTİLMELİ — yalnız madde 7 (AC-219, CI 20 koşu) açık. Kod ve doküman tarafında düzeltilecek madde kalmadı; `stability.yml` 20/20 yeşil raporlanınca GEÇTİ olur.

### Test sonucu

| Komut                                                              | Sonuç                                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `pnpm -r run lint` / `pnpm -r run typecheck` / `pnpm format:check` | temiz / temiz / 0 fark                                                                           |
| web `test` (vitest)                                                | 35 dosya / 323 geçti                                                                             |
| server `test:int` (tam)                                            | 62 dosya / **605 geçti** (Tur 1: 604; +1 AC-225 `?tenantId=` izolasyon testi)                    |
| `security-p14a-users` `-t AC-225`                                  | 3/3 geçti                                                                                        |
| web `e2e` (tam)                                                    | **358 geçti**, 0 düştü, 150 skip (proje ayrımı; Tur 1: 356 + yeni AC-225 testi desktop + mobile) |

### Tur 1 maddeleri

| #                                          | Durum   | Doğrulama                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 [backend-dev] `/users/options?tenantId=` | ✅      | `users/service.ts:260` `userOptionsTenant`: etkin tenant önce gelir (başka rol parametreyle kapsam dışına çıkamaz), yalnız firma seçmemiş SUPER_ADMIN için `findTenant` (silinmemiş) → yoksa 404; şema `strictObject` (ULID). Entegrasyon "AC-225: ?tenantId= izolasyonu": SA A/B ayrı, parametresiz 403, bozuk 400, olmayan 404; ADMIN/USER `tenantId=B` ile B kimliği görmez |
| 2 [frontend-dev] `/history`                | ✅      | Sayfa kayıtlarından seçenek üreten `options()` kaldırıldı; e2e "AC-225: Super Admin — firma seçilmeden teknisyen seçici pasif + ipucu …" (desktop + mobile): seçici pasif ve tek "Tümü" seçeneği var, `/users/options` çağrısı yok; firma seçilince `?tenantId=` ile kayıtlarda olmayan teknisyen dahil liste geliyor; uygula + yenile sonrasında da seçim korunuyor           |
| 3 `/ws/panel` 4429                         | ✅      | `docs/api.md:1413-1415` (6. soket `too_many` ↔ oturum başına 30/dk `retry=<sn>`), `docs/mimari-protokol.md:236`                                                                                                                                                                                                                                                                |
| 4 MySQL `requireTls`/`tls`                 | ✅      | `docs/api.md:1922-1978` (alan, PUT gövdesi, `tls` sınıfı, rebinding'siz çözümleme, `allowPublicKeyRetrieval` kuralı)                                                                                                                                                                                                                                                           |
| 5 [dba] db-notlari                         | ✅      | `docs/db-notlari.md:949` "İkinci migration: `20261116010000_p14a_mysql_tls`"                                                                                                                                                                                                                                                                                                   |
| 6 [devops] `test-db.sh` atfı               | ✅      | **Düzeltme (denetçi hatası):** betik Tur 1'de de vardı (`apps/server/scripts/test-db.sh`); ben yalnız kök `scripts/`'e bakmıştım. `repeat-tests.sh:7` artık doğru yolu gösteriyor. Bulgu geçersizdi                                                                                                                                                                            |
| 7 [devops] AC-219                          | ⚠️ açık | Push sonrası `stability.yml` `runs=20` (int + e2e, retry 0) çalıştırılmalı; sonuç `docs/implementation.md` "Kararsız testler" altına yazılmalı                                                                                                                                                                                                                                 |

### Kabul kriterleri (değişenler)

| AC  | Durum       | Kanıt                                                                                                     |
| --- | ----------- | --------------------------------------------------------------------------------------------------------- |
| 225 | ✅          | Tur 1 kanıtları + yukarıdaki entegrasyon ve e2e testleri                                                  |
| 219 | ⚠️ kanıtsız | Yerel kanıt Tur 1'de: `repeat-tests.sh 3 int` 3/3 ve bu turda tam koşular yeşil. CI'da 20 koşu bekleniyor |

Diğer 28 AC Tur 1'deki gibi ✅; bu turdaki tam koşularda da yeşil.

### Düzeltilmeli

1. [devops] AC-219: push sonrası `.github/workflows/stability.yml`'ı `runs=20` ile tetikle; int ve e2e `SONUÇ: x/y` çıktısını `docs/implementation.md` "Kararsız testler" bölümüne yaz (liste boş kalmalı). Kırmızı koşu olursa kök nedeni düzelt; retry yasak.

### Definition of Done

| Madde                             | Durum | Not                                                                                                                                            |
| --------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Tüm AC'ler testle kanıtlı         | ⚠️    | yalnız AC-219 (CI)                                                                                                                             |
| Testler yeşil                     | ✅    | int 605, e2e 358, web 323; lint/typecheck/format temiz                                                                                         |
| API/protokol dokümanı, db-notlari | ✅    | madde 3-5                                                                                                                                      |
| Sapmalar gerekçeli                | ✅    | Yeni karar: SA dışı rollerde `tenantId` yok sayılıyor (`/sessions`, `/audit` kalıbı), izolasyon testli; bilinmeyen sorgu parametresi artık 400 |
| Yeni bağımlılık / env / tablo     | ✅    | yok                                                                                                                                            |

### Olumlu

- Düzeltme kapsamı dar: iş mantığı serviste, `techOptions` saf modüle taşınmış ve birim testi var. e2e "sayfa kayıtlarından seçenek yok" koşulunu doğrudan ölçüyor (istek sayısı 0, tek seçenek).

---

## P15 — Tur 1

# QA Raporu — P15 Tur 1

DURUM: DÜZELTİLMELİ

Tarih: 2026-11-15 · Denetçi: qa-denetci · Kapsam: AC-231..239 (mimari-e11 §6), `git diff 0dd1d99` + izlenmeyen P15 dosyaları, implementation.md "P15 — dba/frontend/backend", db-notlari "P15". Geçici konteyner `rs-qa-p15t1-k7w2` (mysql:8.4.13, port 33515) iş sonunda `test-db.sh down` ile silindi; env dosyası silindi.

### Test sonucu

| Komut                                                              | Sonuç                                                                                                            |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `pnpm -r run lint` · `pnpm -r run typecheck` · `pnpm format:check` | temiz · temiz · "All matched files use Prettier code style"                                                      |
| server `test` (unit)                                               | 23 dosya / **377 geçti**                                                                                         |
| server `test:int` (tam, geçici MySQL)                              | 65 dosya / **632 geçti**, 0 düştü, 0 skip                                                                        |
| contracts `test`                                                   | 12 dosya / **94 geçti**                                                                                          |
| web `test` (vitest)                                                | 36 dosya / **333 geçti**                                                                                         |
| web `e2e` (tam)                                                    | **379 geçti**, 0 düştü, 169 atlandı (mobil projede `desktopOnly`, bilinen ve gerekçeli kalıp)                    |
| `check-app-grants.sh`                                              | **425/425 PASS** (migrate sonrası ve down→up sonrası iki kez)                                                    |
| Migration `down.sql` → `db:migrate` (int test verisi dolu DB'de)   | down: `request_blocks` yok, `reported_by` yok, P15 migration kaydı 0; up + grants OK; `migrate diff` drift **0** |

### Kabul kriterleri

| AC  | Durum          | Kanıt / eksik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 231 | ✅             | int `AC-231: geçerli TOTP → 10 yeni kod; eski kodlar aynı TX'te silinir; audit kod içermez…`, `AC-231: 5 hatalı TOTP sonrası kilit (429)…`; web `p15.test.ts` AC-231; e2e `AC-231: Hesabım — kurtarma kodlarını yenile…` (bir kez gösterim, Kaydettim'siz kapanmaz) + axe                                                                                                                                                                                                                                                                                                                                                                                                                |
| 232 | ✅             | int `AC-232: step-up'lı SA başka SA'yı sıfırlar → geçici parola, oturumları kapanır, must_change, audit; kendi id 403; step-up yoksa…`, `AC-232: hedef SA değil / yok → 404…`; e2e AC-232 (liste, tek SA → CLI boş durumu, axe). P13b çekirdeği `resetSuperadminById` ile yeniden kullanılmış (kopya yok)                                                                                                                                                                                                                                                                                                                                                                                |
| 233 | ✅             | int `system-logo-p15` (`{path:null}`, dosya silinir, `/public/branding` varsayılan, audit, idempotent, Admin 403), `security-p15-db` (app DELETE yok); `check-app-grants` 425/425; e2e `p12-branding` AC-233. PDF aynı `systemLogoUrl` kaynağını kullanıyor (ayrı PDF testi yok — not)                                                                                                                                                                                                                                                                                                                                                                                                   |
| 234 | ✅             | int `AC-234: reason/method konsola iletilir; 0.10.x yükü (alansız) hatasız; S17-2…`, `AC-234: gerçek WS…; biçim dışı reason 1008`; web `p15.test.ts`; e2e `AC-234: … ≤ 2 sn; bilinmeyen kod ham; 0.10.x eski metin`. İstemci kısmı P17 (mimari §13)                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 235 | ✅             | int `AC-235: IP/önek ve cihaz engeli → tek tip 429, talep yazılmaz…; tenant izolasyonu`, `AC-235: 1.000 sınırı → 409; süresi dolmuş hedef yeniden; saklama 30 g`, `AC-235: başka tenant'ın engeli kaldırılamaz (404)`; contracts önek sınırları (/23, /47 red); `security-p15-db` CHECK'leri; e2e AC-235 (liste, 5 durum, kısayol, axe)                                                                                                                                                                                                                                                                                                                                                  |
| 236 | ⚠️             | int `AC-236: resolve imzalı URL…; bozuk imza 403; oturum bitince 403; avatarsız null`; e2e AC-236. **Eksik:** "≤ 10 dk geçerli" testle kanıtlanmıyor — test yalnız `exp+1` (imza bozulur) deniyor; geçerli imzalı ama süresi geçmiş (`exp < now`) ya da `exp > now+600` URL'nin 403 döndüğünü sınayan test yok (kod `verifyTechAvatarSig` doğru görünüyor)                                                                                                                                                                                                                                                                                                                               |
| 237 | ⏭ P15 kısmı ✅ | int `AC-237: users.delete toggle listesinde; USER kapalı, ADMIN açık`; e2e AC-237. Uç ve "silme düğmesi görünmez / uç 403" kanıtı mimari §6 gereği P16'da ("uç P16"); P16 QA'sında kapanmalı. dba riski (eski `users.delete` grant'leri) açık — Öneriler                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 238 | ❌             | Sunucu tarafı testli (int `AC-238: fid'li iki rapor…`, `security-p15-db`, `p8-history` e2e mock'la). **Ancak gerçek akış bozuk:** web istemcisi `apps/web/lib/dc/files.ts:311-318` (`meta`) ve `:338` (`senderMeta`) `file.meta`'ya `fid` eklemiyor (güvenlik raporu bulgusu doğrulandı). Sonuç: tarayıcı misafirli TO_CUSTOMER aktarımda teknisyenin gönderen raporu satıra yazılmaz (`collab.ts` fid'siz gönderen → yalnız audit), tek satır müşteri (alıcı) raporu `CUSTOMER` + rastgele `legacy:` match_key → teknisyenin gönderdiği her dosya geçmiş/CSV'de **"Müşteri bildirimi"** görünür. Testler `handleFileMeta`'yı elle `fid` ile çağırdığından bu açığı yakalamıyor          |
| 239 | ⚠️             | int `AC-239: kapalıyken akış değişmez (regresyon)`, `AC-239: açıkken müşteri 4 haneli kod alır, lobiye düşer; yanlış kod tüketmez; doğru kodla ACTIVE`; web `requests.test.ts`, e2e AC-239. **Eksik:** "müşterinin okuduğu kod" uçtan uca mümkün değil: talep istemcisi `apps/agent-win` `signal.DecodeStrict` (`internal/signal/strict.go`) bilinmeyen `admitCode` alanını reddeder ve kodu gösteren istemci yok; AC-239 istemci kısmı mimari §13'te hiçbir pakete atanmamış (yalnız "234 istemci P17"). Sunucu sürüm kapısı yok, ayar ekranı uyarısız açılabiliyor → Admin açarsa 0.10.x'teki **tüm talepler bağlanamaz** (implementation.md sapma 2 bunu kabul ediyor ama koruma yok) |

### Düzeltilmeli

1. [frontend-dev] `apps/web/lib/dc/files.ts:311-318` ve `:338` — `file.meta` gövdesine transferin `fid`'i (`file.offer.fid`, contracts `ws.ts` `fid` alanı) eklenmeli; alıcı raporu ve gönderen raporu aynı `fid`'i taşımalı. vitest'e "file.meta her iki yönde `fid` içerir" testi; e2e/`mock-ws` ile TO_CUSTOMER aktarımın geçmişte "Doğrulanmış" göründüğü bir AC-238 testi.
2. [backend-dev] AC-238 için gerçek iki uçlu akış testi: tarayıcı istemcisinin ürettiği biçimde (fid'li) TO_CUSTOMER aktarımda geçmiş `verified:true, reportedBy:"TECH"`; ayrıca fid'siz (0.10.x / mevcut Go istemci) alıcı-müşteri raporunun nasıl etiketleneceği kararı implementation.md'ye yazılmalı (bugün "Müşteri bildirimi" — eski P5 davranışında bu satır tek kaynaktı; Go istemci fid gönderene kadar TO_CUSTOMER'da regresyon).
3. [mimari] AC-239 istemci kısmını (Go istemcinin `request.accepted.admitCode`'u kabul edip müşteriye göstermesi) bir pakete ata (P17) ve mimari §13 eşlemesini güncelle.
4. [backend-dev] `apps/server/src/requests/panel.ts` `acceptRequest` — `admitCode` yalnız istemci sürümü kodu destekliyorsa (`r.clientVersion` ≥ P17 sürümü) üretilmeli; desteklemeyen istemcide ayar açık olsa da bugünkü akış (kodsuz) sürmeli ve audit'e `acceptCode:false, reason:"client_unsupported"` yazılmalı. Entegrasyon testi: ayar açık + 0.10.x `clientVersion` → `request.accepted` alanı yok, misafir doğrudan `hello`.
5. [frontend-dev] `settings/support-requests` "Talep kabulünde kabul kodu iste" açıklamasına hangi istemci sürümünden itibaren geçerli olduğu notu (madde 4 ile tutarlı metin, `messages/tr.json` `srs.ac.desc`).
6. [backend-dev] `apps/server/test/integration/p15-backend.test.ts` AC-236 (veya `uploads/tech-avatar.ts` birim testi) — geçerli MAC ile `exp = now-1` ve `exp = now+601` URL'lerinin 403 verdiği, `techAvatarSignedUrl`'in `exp − now ≤ 600` ürettiği sınanmalı.

### Sözleşme uyumu (frontend ↔ backend)

| Konu                             | Sonuç                                                                                                                                                                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engel hata kodları               | 409 `CONFLICT` + `REQUEST_BLOCK_EXISTS_MESSAGE` + `fields.cidr`/`fields.target`; web `blockErrorOf` mesaja göre `cidr` alanına, kısayolda form üstüne yazar (`m.message ?? m.fields.cidr`) — uyumlu. Sınır / kaynak yok (409 farklı mesaj) form üstü — uyumlu |
| `requireAcceptCode`              | contracts input opsiyonel; sunucu `?? before` ile korur; web `acceptCode ↔ requireAcceptCode` gönderir/okur — uyumlu                                                                                                                                          |
| `reportedBy` / `verified`        | Sunucu `SessionFileRecord`'a ekliyor, web `FileVerification verified` kullanıyor — uyumlu (veri kaynağı sorunu madde 1)                                                                                                                                       |
| Avatar URL yolu                  | Sunucu `/api/v1/public/sessions/<ULID>/tech-avatar?exp=&sig=` (token değil ULID); web mock aynı desen; `guest-welcome` `Avatar src` ile göreli kullanır, Caddy `/api/*` → server — uyumlu                                                                     |
| Kurtarma / SA sıfırlama hataları | 400 `fields.code`, 429 `retryAfterSec`, `MFA_STEP_UP_REQUIRED`, 403 self, 404 — web `stepUpErrorOf` / `StepUpProvider` / 404 toast — uyumlu                                                                                                                   |

### Definition of Done

| Madde                                  | ✅/❌ | Not                                                                                                                                                             |
| -------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tüm AC'ler testle kanıtlı              | ❌    | 238 ❌, 236/239 ⚠️, 237 P16'ya devir                                                                                                                            |
| Testler yeşil, skip gerekçeli          | ✅    | 632 + 377 + 94 + 333 + 379 e2e; skip yalnız `desktopOnly`                                                                                                       |
| lint / typecheck / format              | ✅    | temiz                                                                                                                                                           |
| Migration + down.sql + grants          | ✅    | down→up drift 0; grants 425/425; `request_blocks` grants.sql'de                                                                                                 |
| Tenant izolasyonu (arka uç)            | ✅    | request-blocks `tenantScope` + `{id, tenantId}`; çapraz tenant 404 testli                                                                                       |
| Yetki tek tanımdan, arka uç + arayüz   | ✅    | `support_requests.block` contracts'ta; route `requirePerm`; menü `perm`; toggle otomatik (e2e)                                                                  |
| Audit (sırsız)                         | ✅    | `mfa.recovery_regenerated {count}`, `auth.superadmin_reset` (geçici parola yok), `settings.system_logo.removed`, `request_block.created/deleted` (not yazılmaz) |
| Liste sayfalı / sınırlı                | ✅    | request-blocks `pageSize ≤ 100`; superadmins ≤ 100                                                                                                              |
| Transaction                            | ✅    | yenileme, sıfırlama, logo kaldırma, engel ekle/kaldır tek TX; dosya commit sonrası silinir                                                                      |
| `any` / hata yutma / PII log / ölü kod | ✅    | taramada yok; `catch` blokları loglu ya da bilinçli (P2002 → duplicate/409)                                                                                     |
| 5 durum + a11y + ikon                  | ✅    | Engellenenler 5 durum e2e; axe iki tema; `ShieldBan`, `ShieldUser`, `KeyRound` anlamlı                                                                          |
| Bağımlılık                             | ✅    | yeni bağımlılık yok (yalnız contracts `exports` girdisi)                                                                                                        |
| Sapmalar gerekçeli                     | ✅    | `reported_by` VARCHAR+CHECK (ADR-0014), AC-238 sütun yerine hap, 60 sn kabul kodu penceresi, URL'de ULID, güvenilir CIDR muaf değil — implementation.md'de      |
| Dokümantasyon                          | not   | api.md ve mimari-protokol.md güncellemesi teknik yazarda sürüyor (bu turda bulgu sayılmadı)                                                                     |

### Öneriler (zorunlu değil)

- dba açık riski: P16 öncesi `SELECT user_id FROM user_permissions WHERE perm_key='users.delete' AND granted=1` denetimi ve sıfırlama kararı (mimar/kullanıcı) — P16 ucu açılınca eski USER grant'i kalıcı silme yetkisi verir.
- AC-233 PDF yolunu doğrudan sınayan küçük bir test (PDF logo kaynağı `systemLogoUrl`).
- Engel kapısında engellenen her deneme `rateAudit` ile kısılıyor; ayrı bir `rs_request_blocked_total` metriği izlemeyi kolaylaştırır.

### Olumlu

- P13b sıfırlama çekirdeği tek fonksiyona çıkarıldı (CLI + panel aynı TX ve audit); kopya yok.
- DB CHECK'leri (gerçek CIDR hizası, önek sınırları, `\z`) uygulama doğrulamasını ikinci katmanda zorluyor; grants ve down.sql dolu veritabanında sorunsuz.
- `share.state` birleştirme (S17-2) son durumu kaybetmiyor; 0.10.x uyumluluğu testli.
- İmzalı avatar URL'si token yerine ULID taşıyor, ayrı HKDF etiketi, `private, no-store`.

---

## P15 — Tur 2

DURUM: GEÇTİ

Tarih: 2026-11-15 · Denetçi: qa-denetci · Kapsam: Tur 1'in 6 maddesi (implementation.md "P15 düzeltme turu 1", mimari-e11 §8/§13) + tam test. Geçici konteyner `rs-qa-p15t2-r8n4` (mysql:8.4.13, port 33516) iş sonunda silindi (doğrulandı), env dosyası silindi.

### Test sonucu

| Komut                           | Sonuç                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| lint · typecheck · format:check | temiz · temiz · temiz                                                                                                           |
| server `test`                   | 24 dosya / **383 geçti**                                                                                                        |
| server `test:int` (tam)         | 65 dosya / **635 geçti**, 0 düştü, 0 skip (bu koşuda `account-p10` AC-67 kararsızlığı görülmedi)                                |
| contracts                       | 12 dosya / **94 geçti**                                                                                                         |
| web vitest                      | 37 dosya / **335 geçti**                                                                                                        |
| web e2e (tam)                   | **380 geçti**, 0 düştü, 169 atlandı (`desktopOnly`, gerekçeli)                                                                  |
| Migration down → up (dolu DB)   | down sonrası TO_CUSTOMER 151 / TO_TECH 26 satır; up sonrası backfill TO_CUSTOMER→`CUSTOMER` 151, TO_TECH→`TECH` 26; drift **0** |
| `check-app-grants.sh`           | **425/425 PASS**                                                                                                                |

Raporlanan sayılar (383 / 635 / 335 / 380) bağımsız koşuyla birebir doğrulandı.

### Tur 1 maddeleri

| #                                         | Durum | Doğrulama                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 [frontend] `fid`                        | ✅    | `lib/dc/files.ts` `meta()` ve `senderMeta()` `fid: st.t.fid` gönderiyor. vitest `p15-fid.test.ts` (iki yön, ret raporu dahil, sunucu şemasına uyum); e2e `p5-collab` "AC-238: … iki uç aynı fid … tek 'Doğrulanmış' grup"                                                                                                                                                                                                                                                   |
| 2 [backend] iki uçlu test + fid'siz karar | ✅    | int `AC-238: tarayıcı istemcisi biçimi (fid'li iki uç) TO_CUSTOMER → 'Doğrulanmış'; fid'siz (0.10.x Go) müşteri raporu TECH raporuyla eşlenir…`; unit `p15-fix1` 4 test (bire bir eşleme, farklı boyut/özet eşlenmez, eşli TECH yeniden kullanılmaz, eski satırlar). Karar implementation.md'de yazılı. `groupFileReports` okundu: müşteri satırı TECH satırını değiştiremez, gösterilen satır her zaman TECH; CSV `fileReportsOf` gerekli alanları seçiyor                 |
| 3 [mimari] AC-239 istemci → P17           | ✅    | mimari-e11 §8.1 satır 239 (`RequestAccepted.AdmitCode`, `DecodeStrict` şeması, kabul ekranında kod), §8.3 I1 "234 + 239 (istemci…; sürüm ≥ 0.11.0)", §13 "P15 (234 ve 239 istemci P17)"                                                                                                                                                                                                                                                                                     |
| 4 [backend] sürüm kapısı                  | ✅    | `requests/panel.ts:155` `compareVersions(r.clientVersion, ACCEPT_CODE_MIN_CLIENT_VERSION) >= 0` (contracts `"0.11.0"`); audit `acceptVerification` + `reason:"client_unsupported"`, info logu. int `AC-239: ayar açık + 0.10.x istemci → admitCode yok, misafir doğrudan hello; audit…` ve `ayar açık + 0.11.0 istemci → acceptVerification:true`. **Sapma kabul:** `acceptCode` anahtarı audit maskesine (`code` deseni) takıldığı için `acceptVerification` adı gerekçeli |
| 5 [frontend] ayar metni                   | ✅    | `tr.json` `srs.ac.desc` "Yalnız 0.11 ve sonraki istemcilerde uygulanır; daha eski istemciler kodsuz bağlanır."                                                                                                                                                                                                                                                                                                                                                              |
| 6 [backend] AC-236 süre testleri          | ✅    | int AC-236: `exp − now ≤ 600` (ve > 570), geçerli MAC ile `now+60` → 200, `now−1` → 403, `now+601` → 403                                                                                                                                                                                                                                                                                                                                                                    |

### Kabul kriterleri

| AC  | Durum          | Kanıt                                                                                   |
| --- | -------------- | --------------------------------------------------------------------------------------- |
| 231 | ✅             | Tur 1 kanıtları değişmedi, yeşil                                                        |
| 232 | ✅             | Tur 1 kanıtları, yeşil                                                                  |
| 233 | ✅             | Tur 1 kanıtları, yeşil                                                                  |
| 234 | ✅             | Sunucu + konsol testli; istemci kısmı P17 (mimari §13)                                  |
| 235 | ✅             | Tur 1 kanıtları + S15-5 önbellek düzeltmesi unit testli (`p15-fix1` S15-5 ×2)           |
| 236 | ✅             | madde 6                                                                                 |
| 237 | ✅ (P15 kısmı) | anahtar/toggle testli; uç + düğme kanıtı mimari §6 gereği P16 QA'sında kapanacak        |
| 238 | ✅             | madde 1–2; S15-2 backfill migration'da, dolu DB'de doğrulandı                           |
| 239 | ✅ (P15 kısmı) | sunucu akışı + sürüm kapısı + regresyon testli; müşteriye kod gösterimi P17 I1'e atandı |

### Düzeltilmeli

Yok.

### Definition of Done

| Madde                         | ✅/❌ | Not                                                                                       |
| ----------------------------- | ----- | ----------------------------------------------------------------------------------------- |
| AC'ler testle kanıtlı         | ✅    | 237 uç kısmı P16, 234/239 istemci kısmı P17 — mimaride açıkça atanmış                     |
| Testler yeşil, skip gerekçeli | ✅    | yukarıda                                                                                  |
| lint / typecheck / format     | ✅    |                                                                                           |
| Migration + down + grants     | ✅    | backfill ve down→up dolu DB'de doğrulandı                                                 |
| Sapmalar gerekçeli            | ✅    | `acceptVerification`, fid'siz eşleme kararı, S15-4 "Sonra" gerekçesi implementation.md'de |
| Bağımlılık                    | ✅    | yeni bağımlılık yok                                                                       |
| Dokümantasyon                 | not   | api.md / mimari-protokol.md teknik yazarda (bulgu sayılmadı)                              |

### Öneriler (zorunlu değil)

- `20261117000000_p15_g3/migration.sql` P15 turunda yeniden düzenlendi (backfill eklendi). Staging'e P15 migration'ı uygulanmış ise checksum uyuşmazlığı çıkar; deploy öncesi `_prisma_migrations` kontrol edilmeli (uygulanmadıysa sorun yok).
- `account-p10` AC-67 TOTP adım sınırı kararsızlığı (implementation.md'de bir kez görüldü) AC-219 kapsamında takip edilmeli.
- Tur 1 önerileri geçerli: P16 öncesi eski `users.delete` grant denetimi; AC-233 PDF logo testi.

### Olumlu

- fid'siz eski istemci için okuma tarafında bire bir, içerik eşlemeli birleştirme: veri modeli değişmeden geriye uyum sağlandı ve müşteri raporu TECH satırını ezemiyor.
- Sürüm kapısı ayarı güvenli hâle getirdi: eski istemcide akış bozulmuyor, audit'te neden görünüyor.

---

## P16 — Tur 1

DURUM: DÜZELTİLMELİ

Kapsam: G4 kalıcı silme (AC-240..244) ve AC-237'nin silme ucu. Kod commit edilmemiş (git diff ve untracked dosyalar).
Kaynaklar: gereksinimler-kabul-kriterleri-e11 G4, mimari-e11 §7.1–7.10, ADR-0030 r2, implementation.md P16 G1/G2+G5/G3/G4/G6/G7,
db-notlari P16, runbook §23, DESIGN.md. Ortam: geçici `rs-qa-p16-bbf7d3` (mysql 8.4.13, `--max-connections=300`,
binlog açık + bayrak). Ortam iş sonunda silindi.

### Test sonucu

| Komut                                                                                         | Sonuç                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm -r run lint`                                                                            | 0 hata                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `pnpm -r run typecheck`                                                                       | 0 hata                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `pnpm format:check`                                                                           | temiz                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| server unit                                                                                   | 24 dosya, **383/383**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| server `test:int` (tam, temiz DB P1→P16)                                                      | 70 dosya, **673/673**, 0 skip. P16 dosyaları: users-delete 9, retention-p16-purge 6, orphan-scan 6, tenant-purge 9, tenant-purge-meta 7                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| contracts                                                                                     | 13 dosya, **99/99** (p16-contracts 5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| web vitest                                                                                    | 38 dosya, **345/345** (p16 10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| web e2e (tam)                                                                                 | **1. koşu: 387 geçti, 1 düştü, 1 çalışmadı, 178 atlandı.** Düşen test: `p9-users.spec.ts:325` "AC-70 Super Admin: firma seç → … pasife al", satır 390 `data-acting` "" beklenirken `01JTN…B` kaldı. **2. koşu: 389 geçti, 0 düştü.** Test tek başına `--repeat-each=10` ile 10/10 geçti. Sonuç: yük altında kararsız. Önceki turlarda kayıtlı değil. P16, Super Admin panel kabuğuna yoklamalı bant ekledi (`layout.tsx` + `purge-banner.tsx`), ilişki dışlanamadı                                                                                                                                             |
| Temiz up                                                                                      | drift 0 (`migrate diff --exit-code` 0). `check-app-grants.sh` **501/501 PASS**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Dolu DB down/up/up (test:int sonrası: 1.216 kullanıcı, 971 firma, 13.215 oturum, 4.712 audit) | 1) `down.sql` → `p16_down_guard_chk` 3819. Hiçbir şey değişmedi, tetikleyici 22 kaldı (5 DELETED kullanıcı, 10 iş satırı, 38 firması olmayan audit satırı). 2) Koruma koşulları migrator ile temizlendi: iş satırları silindi, DELETED → PASSIVE, firması olmayan audit için yer tutucu firma. Ardından down OK: tetikleyici 3, `tenant_purge_jobs` yok, P15 şemasına diff 0. 3) up OK: drift 0, tetikleyici 22, `migration.p16_users_delete_reset` audit `grantedAfter: 0`, PASSIVE firmada `passive_at` boş 0. 4) `check-app-grants.sh` **501/501 PASS**, `audit-continuity.sql` `triggers.ok=true count=22` |

Implementation.md'deki sayılar (383 / 99 / 345 / 673 / 501) bu bağımsız koşuyla birebir doğrulandı.

### Kabul kriterleri

| AC              | Durum                     | Kanıt veya eksik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 237 (silme ucu) | ✅                        | int `AC-237: users.delete anahtarı olmayan Admin → 403 (step-up'lı olsa da); USER → 403`: hedef PASSIVE kalıyor. Düğme gizliliği: vitest `AC-241 … düğme: yetki/yönetim/kendi hesabı → yok` (`userDeleteState` → `hidden`; `user-editor.tsx` bunu kullanıyor). Kendi hesabında düğme 0: e2e                                                                                                                                                                                                                                 |
| 240             | ✅                        | int `retention-p16-purge` 6/6: DB saatiyle 30 g ± 1 sa sınırı, FK sırası, kayda bağlı oturumun kalması, ikinci koşuda 0; S16-8 uygulama saati +2 sa; `dry` 0 silme; `db_signal` metrik ve fail audit; açık işli firma atlanır; S16-10 iş satırı 730 g. `retention.run` audit'inde `purged*` sayıları var                                                                                                                                                                                                                    |
| 241             | ✅                        | int `users-delete-p16` 9/9: ACTIVE 409, ad uyuşmazlığı 400, 428, 401, 403 (fail audit PII'siz), 404. Mezar taşı alanları ADR m.4'te, avatar dosyası yok, alt tablolar silinir, defter satırı yazılır. Liste, CSV ve zaman çizelgesi gövdelerinde eski e-posta ve ad 0 kez geçer, `s***@***`, `Silinmiş kullanıcı #<6>`. Satırı hiç olmayan kullanıcı ve firmada da maske var. S16-7: 6 deneme 401/423, fallback logu yok. e2e kullanıcı silme ve maskeli audit satırı                                                       |
| 242             | ✅ (staging maddesi ayrı) | int `tenant-purge-p16` 9/9 ve `tenant-purge-meta-p16` 7/7: önizleme = silinen; +24 sa DB zorlaması; iptal sonrası 0 silme; previewId 428 (ikinci kullanım, başka oturum, durum değişimi, süre); `afterBatch` çökme + yeniden başlatma; `system` ve aktif firma için `invalid_job`; sembolik bağlantının hedefi korunur; firma ve klasör yok; audit değişmez; S16-1 e-posta 0; replay/verify. e2e önizleme → SCHEDULED → bant → iptal; RUNNING → DONE; FAILED → Sürdür                                                       |
| 243             | ✅                        | int `orphan-scan-p16` 6/6: 0/6/8 gün, sonradan bağlanan dosya, `.tmp` 24 sa, sembolik bağlantı, devre kesici (boş küme ve %21 → silme yok, fail audit; %20 → silme), `*_path` meta-testi, pazar 04:30 TR. Sayılar metrikte ve audit'te                                                                                                                                                                                                                                                                                      |
| 244             | ❌                        | Runbook ✅: §23.7 "≤ 14 gün" yaşam döngüsü kontrolü; §23.5 ve §23.7 silinen firmanın geri yüklenmesi (replay) ve scratch dışa aktarımı. **Kılavuz ❌:** `docs/KULLANIM_KILAVUZU.md`'de kalıcı silme bölümü yok. Satır 1326 hâlâ "bu işlem henüz ekranda yoktur" diyor. Satır 1798–1799'daki 14 gün cümlesi yalnız anonimleştirme bağlamında; "Yedekten geri dönülürse silinmiş veri geri gelebilir" cümlesi P16 replay davranışıyla çelişiyor. G8 (teknik-yazar) yapılmamış: KULLANIM_KILAVUZU, CHANGELOG ve PDF değişmemiş |

### Düzeltilmeli

1. [teknik-yazar] `docs/KULLANIM_KILAVUZU.md`. Şunları ekleyin:
   - kullanıcı kalıcı silme (pasif şartı, ad yazarak onay, step-up, "Silinmiş kullanıcı #…");
   - firma kalıcı silme (30 gün pasiflik, önizleme, 24 saat iptal penceresi, bant, durum kartı, FAILED → Sürdür);
   - "Kalıcı silinen veri yedeklerden en geç 14 günde düşer" cümlesi (AC-244).

   Ayrıca satır 1326'daki "henüz ekranda yoktur" notunu kaldırın. Satır 1799'u replay davranışına göre düzeltin ("geri yüklemeden sonra kalıcı silinenler yeniden silinir"). Ardından CHANGELOG'a P16 girdisini yazın ve `scripts/build-docs.sh` ile PDF'leri yeniden üretin (mimari §7.10 G8).

2. [backend-dev] `docs/implementation.md` P16. Paket kabulü "S16-1..11 kapanış kanıtları implementation.md'de" diyor. Bugün kanıt tabloları G2+G5 ve G3 bölümlerine dağılmış durumda. **S16-3** ve **S16-7** için kanıt satırı yok:
   - S16-3'ün kanıtı yalnız db-notlari'nda;
   - S16-7'nin testi var (`AC-241: mezar taşı e-postasıyla 6 deneme …`) ama tabloda yer almıyor.

   Tek bir "P16 S16 kapanış" tablosu ekleyin. S16-1..11 için her satırda bulgu → test adı veya check-app-grants satırı olsun. S16-12..15 için de durum yazın.

3. [frontend-dev] `apps/web/app/(panel)/admin/tenants/[id]/purge-panel.tsx` 457 satır, yeni dosya. Kalite standardının dosya ≤ 300 hedefi aşılmış ve implementation.md'de gerekçe yok. Durum kartlarını (SCHEDULED / RUNNING / FAILED / DONE) ve önizleme diyaloğunu ayrı bileşenlere bölün ya da gerekçeyi G6 "Sapmalar"a yazın.

4. [frontend-dev] `apps/web/e2e/p9-users.spec.ts:390` (AC-70) tam e2e koşusunda yük altında kararsız: 2 koşunun 1'inde düştü. Tenant seçici "temizle" sonrası `data-acting` boşalmıyor. Yalnız bu turda görüldü ve P16 Super Admin kabuğuna bant ekledi (`components/purge-banner.tsx` 60 sn yoklama; `router.refresh` ile ilk değer). Kök nedeni bulun: bant yoklaması ya da yenilemesi seçici durumuyla yarışıyor mu? Ardından düzeltin. Beklenen: `scripts/repeat-tests.sh` ile tam e2e'nin 5 ardışık koşusunda 0 kırmızı. Kararsızlık P16'dan bağımsızsa implementation.md "Kararsız testler" listesine yazın (AC-219).

### Staging'de doğrulanacak (bulgu sayılmadı)

- Migration sonrası ilk gece yedeği PASS (tetikleyici 22). Staging `backup.env`'de `BACKUP_EXPECTED_TRIGGERS=3` elle yazılıysa önce boşaltılmalı (runbook §23).
- Staging restore provasında `erasure:replay` + `erasure:verify` PASS (G7 kabulü).
- Bir test firmasının 24 saat beklemeli uçtan uca silinmesi ve gerçek uçlarla web akışı (e2e sahte API ile).
- `remote-watch` yeni alarmlarının gerçek kanala (`WATCH_ALERT_CMD`) ulaşması. S16-12: prod açılışının ön koşulu.

### Definition of Done

| Madde                                                     | ✅/❌ | Not                                                                                                                                                                                                       |
| --------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Her AC'de adında AC no geçen yeşil test                   | ❌    | 240–243 ve 237 ✅; 244 bir doküman AC'si ve kılavuz kısmı eksik                                                                                                                                           |
| Testler yeşil, skip gerekçeli                             | ❌    | AC-70 e2e kararsız (Düzeltilmeli 4). Skip'ler `desktopOnly` (gerekçeli kalıp)                                                                                                                             |
| lint / typecheck / format                                 | ✅    |                                                                                                                                                                                                           |
| Migration up/down/up + drift + grants                     | ✅    | dolu DB'de; down korumaları 3819 ile doğru duruyor                                                                                                                                                        |
| Tasarım-kod uyumu, sapmalar gerekçeli                     | ✅    | `fields` zarfı, uygunluk sınırı (`≤ TENANT_ROW`), `purgedFiles`, `{class}` metriği, replay'in firmayı hazırlaması, dosya boyutları (tenant-purge 306/321) gerekçeli. Gerekçesiz tek madde: Düzeltilmeli 3 |
| Katman, `any`, hata yutma, PII log                        | ✅    | Yeni dosyalarda `any`, `console`, eslint-disable, ham renk/px yok. Avatar ve defter hataları alarm loguyla (PII'siz `userId`)                                                                             |
| Sayfalı liste / TX                                        | ✅    | `purge-jobs` ≤ 100; mezar taşı tek TX + `FOR UPDATE` + koşullu UPDATE                                                                                                                                     |
| 5 durum, a11y, 390 px, iki tema axe 0                     | ✅    | e2e `P16: axe iki temada + taşma yok` 1280/390                                                                                                                                                            |
| Yeni env/volume (`RETENTION_PURGE_MODE`, `remote_ledger`) | ✅    | .env.example, env.ts, compose, runbook                                                                                                                                                                    |
| Yeni bağımlılık                                           | ✅    | yok                                                                                                                                                                                                       |
| S16-1..11 kapanış kanıtları implementation.md'de          | ❌    | Düzeltilmeli 2                                                                                                                                                                                            |
| Kılavuz / CHANGELOG / PDF                                 | ❌    | Düzeltilmeli 1 (G8)                                                                                                                                                                                       |

### Öneriler (zorunlu değil)

- `apps/server/scripts/test-db.sh`'a `--max-connections=300` eklenmesi (G3 notu). Bu turda 300 ile koşuldu ve bağlantı kaynaklı kırmızı görülmedi.
- `deploy/ops/remote-watch.sh` 449 satıra çıktı. QA #2'deki "tek dosya kurulu kopya" gerekçesi 313 satır içindi; gerekçe güncellenmeli ya da bölünme yeniden değerlendirilmeli.
- AC-237 "anahtarsız Admin'e düğme görünmez" maddesi bugün birim testiyle kanıtlı. Bunun için `users.delete`'siz bir Admin ile tek bir e2e adımı eklenebilir.
- `gereksinimler-kabul-kriterleri-e11.md` "Uygulama durumu" tablosuna P16 satırları (240–244) eklenmeli.

### Olumlu

- Fail-closed audit maskesi gövde düzeyinde "0 kez geçer" testleriyle kanıtlı. Satırı hiç olmayan kullanıcı ve firma da kapsanıyor.
- 30 gün ve 24 saat kuralları DB tetikleyicisiyle zorlanıyor, 501 negatif/pozitif grants satırıyla sınanıyor. down korumaları dolu DB'de doğru yerde duruyor.
- Çökme dayanıklılığı (`afterBatch`) ve FK meta-testleri (`DELETE_RULE = RESTRICT`), şema değişince sessiz bozulmayı yakalıyor.

---

## P16 — Tur 2

DURUM: DÜZELTİLMELİ

Tur 1'in 4 maddesi kapandı. Kalan iki iş küçük ama zorunlu: biri doküman sapması, diğeri bu turda görülen ve kayda
geçmemiş bir kararsız test (AC-219 kuralı). Ortam: geçici `rs-qa-p16-42b633` (mysql 8.4.13, `--max-connections=300`),
iş sonunda silindi.

### Test sonucu

| Komut                                | Sonuç                                                                                                                                                                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm -r run lint` / `typecheck`     | 0 / 0                                                                                                                                                                                                                         |
| `pnpm format:check`                  | Tur başında `docs/guvenlik-raporu.md` uyarısı vardı (güvenlik ajanının eşzamanlı yazdığı dosya). Tur sonunda temiz                                                                                                            |
| server unit / contracts / web vitest | **383/383** / **99/99** / **345/345**                                                                                                                                                                                         |
| server `test:int` (tam, 3 koşu)      | 1. koşu 675/676: **`security-p14a-users` AC-206 "yetki değişimi … sürüm artırır" `PATCH` 503**. Bu, geçici DB çekişmesinin (`isTransientDbError` → `NOT_READY`) yanıtı. 2. ve 3. koşu **676/676**. Dosya tek başına 3 × 15/15 |
| web e2e (tam, 2 ardışık koşu)        | **390 geçti / 0 düştü / 179 atlandı** (iki koşuda da). AC-70, p12b AC-196, p13bl AC-312 ve TEST-P5-1 dahil hepsi yeşil                                                                                                        |
| Temiz up                             | drift 0; `check-app-grants.sh` **501/501**                                                                                                                                                                                    |
| `deploy/backup/test-backup.sh`       | Bu turda koşulmadı (dind yok kuralı). Koordinatör koşumu 100 PASS (S16-16 rc 3 vakası dahil); kabul edildi                                                                                                                    |

### Tur 1 maddeleri

| #                                          | Durum | Doğrulama                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 [teknik-yazar] kılavuz / CHANGELOG / PDF | ⚠️    | Kılavuz tamam: "Kullanıcıyı kalıcı silme" (1362), "Firmayı kalıcı silme" (1998), "Yedekler ve kalıcı silme" (14 gün cümlesi, replay ile yeniden silme). Eski "henüz ekranda yoktur" notu kalktı. CHANGELOG P16 girdisi ve DATASHEET var. KULLANIM_KILAVUZU.pdf metni güncel (pymupdf ile doğrulandı). **Kalan iki sapma (madde 1 aşağıda):** (a) `README.md` 07:51'de düzenlenmiş, `README.pdf` ise 07:50'de üretilmiş. PDF'te çıkış kodu 3 (kurcalama şüphesi) yok. (b) `docs/api.md:2453` Super Admin hedefini hâlâ 403 sayıyor, oysa S16-17 ile 404 oldu |
| 2 [backend-dev] S16 kapanış tablosu        | ✅    | implementation.md "P16 S16 kapanış tablosu": S16-1..19 her biri test adı, check-app-grants satırı ya da migration bloğu. S16-3 için yeni test (`tpm` "AC-240 S16-3 …"), S16-7 kanıt satırı var. S16-12 prod ön koşulu açık olarak yazılı, S16-19 "Sonra"                                                                                                                                                                                                                                                                                                    |
| 3 [frontend-dev] purge-panel boyutu        | ✅    | `purge-panel.tsx` 176, `purge-status-card.tsx` 123, `purge-dialog.tsx` 206 satır. `p16.spec.ts` yeşil. Ek olarak AC-237 e2e adımı geldi ("users.delete anahtarı olmayan Admin'e Kalıcı sil düğmesi görünmez")                                                                                                                                                                                                                                                                                                                                               |
| 4 [frontend-dev] AC-70 kararsızlığı        | ✅    | Test iki aşamalı oldu: önce toast, sonra 10 sn içinde `data-acting=""`. Gerçek hata gizlenmiyor (retry yok). Kök neden yorumu (`startTransition` + `router.refresh` yük altında) "Kararsız testler" tablosunda. P16 bandıyla ilişkisi kod incelemesiyle dışlandı: bant `router.refresh` çağırmıyor, `ussa` senaryosunda 404. Benim 2 tam koşumda 2/2 yeşil. p12b AC-196 ve p13bl AC-312 kök nedenli test düzeltmeleri de makul ve yeşil                                                                                                                     |

**Backend S16-16/17/18 (güvenlik turu düzeltmeleri):**

- S16-16: `cli/erasure.ts`, rc 3 ile uygunsuz satırı reddeden test (`tpm` S16-16).
- S16-17: `users/service.ts:588`; `loadOrThrow` kapsamlı sorgusu Super Admin'i ve başka firmayı 404'e düşürüyor; `readRole` silindi.
- S16-18: defterde `intent` ve `done` satırları. `intent` TX içinde, denetimlerden sonra yazılıyor (gerekçeli sapma).
- Hepsi testli ve yeşil. `test-db.sh` `--max-connections=300` eklendi ✅.

### TEST-P5-1 kararı (AC-219)

- `p5-collab` TEST-P5-1 (koordinatörün 15 tam koşusunda 2 düşüş) P16'dan bağımsız. Dosya aktarım teklifinin reddi `desktop-rtc` projesinde ve P5 kodunda; P16 bu dosyalara dokunmadı. Bu turdaki 2 tam koşumda yeşil.
- Kayıt AC-219 kuralına uygun: implementation.md "Kararsız testler"de oran, şüphelenilen neden ve sonraki adım yazılı; retry ile gizlenmemiş.
- **Karar: P16'yı engellemez.** AC-219 bir P16 AC'si değil (durumu "Bekliyor"). Ancak bu kayıt açık kaldıkça AC-219 kapanamaz: kök neden kanıtlanıp düzeltilmeli (sahibi frontend-dev / P5).

### Kabul kriterleri

| AC              | Durum                       | Kanıt                                                                                                                                                 |
| --------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 237 (silme ucu) | ✅                          | int `AC-237 …403`; e2e "AC-237: users.delete anahtarı olmayan Admin'e Kalıcı sil düğmesi görünmez"; vitest `userDeleteState`                          |
| 240             | ✅                          | `retention-p16-purge` 6/6 + `tpm` "AC-240 S16-3"                                                                                                      |
| 241             | ✅                          | `users-delete-p16` (S16-17 404, defter `intent` + `done`, reddedilen istekte defter yok)                                                              |
| 242             | ✅ (staging uçtan uca ayrı) | `tenant-purge-p16` (+S16-18), `tenant-purge-meta-p16` (+S16-16)                                                                                       |
| 243             | ✅                          | `orphan-scan-p16` 6/6                                                                                                                                 |
| 244             | ✅                          | runbook §23.5 ve §23.7; kılavuz "Yedekler ve kalıcı silme" ("en geç 14 gün içinde düşer", geri yüklemede yeniden silme); KULLANIM_KILAVUZU.pdf güncel |

### Düzeltilmeli

1. [teknik-yazar]
   - `docs/api.md:2453`: `DELETE /users/:id` 403 satırından "Super Admin hedef" çıkarılmalı. 404 satırına "Super Admin hedef (S16-17; rol ayırt edilmez)" eklenmeli.
   - `scripts/build-docs.sh` ile `docs/pdf/README.pdf` yeniden üretilmeli. Bugünkü PDF, README'deki "3 replay … tutarsız defter satırını reddetti (kurcalama şüphesi)" çıkış kodunu içermiyor; README.md PDF'ten 1 dakika sonra değişmiş.
   - Üretimden sonra üç PDF'in metni md ile karşılaştırılmalı.
2. [backend-dev] `apps/server/test/integration/security-p14a-users.test.ts:276–278` (AC-206) tam `test:int`'te 3 koşunun 1'inde `PATCH /users/:id` → **503** döndü: geçici DB çekişmesi, `errors.ts:101` `db_busy`. Bu kararsızlık "Kararsız testler" listesinde yok.
   - Kök nedeni bulun: hangi paralel dosya aynı `users` / `user_permissions` satır veya aralık kilitlerini tutuyor? P16'nın kullanıcı TX'leri (`lockActor` + `FOR UPDATE`, `deleteUserChildren`) adaydır.
   - Testi ya da sorguyu düzeltin, veya oranı ve kök nedeni implementation.md "Kararsız testler"e yazın (AC-219; retry ile gizlemek yasak).
   - Beklenen: tam `test:int` 5 ardışık koşuda 0 kırmızı, ya da gerekçeli kayıt.

### Staging'de doğrulanacak (bulgu sayılmadı)

Tur 1 listesi aynen geçerli:

- ilk gece yedeği (tetikleyici 22);
- restore + `erasure:replay` / `erasure:verify`;
- 24 saat beklemeli uçtan uca firma silme ve gerçek uçlarla web akışı;
- `WATCH_ALERT_CMD` alarm kanalı (S16-12, prod ön koşulu).

### Definition of Done

| Madde                                   | ✅/❌ | Not                                                                                    |
| --------------------------------------- | ----- | -------------------------------------------------------------------------------------- |
| Her AC'de adında AC no geçen yeşil test | ✅    | 237, 240–244                                                                           |
| Testler yeşil, kararsızlar kayıtlı      | ❌    | AC-206 503 kayıtsız (madde 2). TEST-P5-1 kayıtlı ve P16'dan bağımsız                   |
| lint / typecheck / format               | ✅    |                                                                                        |
| Migration + grants                      | ✅    | 501/501, drift 0. Dolu DB down/up/up Tur 1'de doğrulandı; bu turda migration değişmedi |
| Sapmalar gerekçeli                      | ✅    | S16-18 TX içi `intent`, verify'ın reddedilenleri saymaması, AC-70 kök neden yorumu     |
| S16 kapanış kanıtları                   | ✅    | tek tablo                                                                              |
| Dosya boyutu                            | ✅    | purge-panel bölündü; `remote-watch.sh` 449 satır gerekçesi yazıldı                     |
| Dokümantasyon / PDF güncel              | ❌    | madde 1                                                                                |
| Yeni bağımlılık                         | ✅    | yok                                                                                    |

### Olumlu

- Kararsız testler retry'la örtülmeden kök nedenleriyle çözüldü (p12b'de gizli Suspense düğümü, p13bl'de `@starting-style` geçişi). Çözülemeyen kayıt (TEST-P5-1) dürüstçe "açık" olarak yazıldı.
- S16-16 replay süzgeci ve rc 3, geri yükleme sonrası kurcalanmış defterin canlı veriyi silmesini engelliyor ve testli.

---

## P16 — Tur 3

DURUM: GEÇTİ

Ortam: geçici `rs-qa-p16-d19f4a` (mysql 8.4.13, `--max-connections=300`). Ortam iş sonunda silindi.

### Test sonucu

| Komut                                                        | Sonuç                                   |
| ------------------------------------------------------------ | --------------------------------------- |
| `pnpm -r run lint` / `typecheck` / `pnpm format:check`       | 0 / 0 / temiz                           |
| server `test:int` (tam, temiz DB P1→P16, **3 ardışık koşu**) | **679/679 · 679/679 · 679/679**, 0 skip |

Web e2e bu turda koşulmadı: web kodu değişmedi. Tur 2'deki 2 tam koşu 390/390'dı.

### Tur 2 maddeleri

| #                             | Durum | Doğrulama                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 [teknik-yazar] api.md + PDF | ✅    | `docs/api.md:2453–2455`: 403 satırında artık Super Admin yok; 404 satırında "Super Admin hedef (S16-17 …)" var. Üç PDF 08:49'da yeniden üretildi; md dosyalarının hepsi bundan önce değişmiş. `README.pdf` metni pymupdf ile çıkarıldı: "reddetti" ve "kurcalama" geçiyor, yani çıkış kodu 3 PDF'te                                                                                                                                                                                                                                                                                                                   |
| 2 [backend-dev] AC-206 503    | ✅    | Kök neden olarak iki ürün kilidi hatası düzeltildi. `users/repo.ts:111` `replacePermissions` artık sil+ekle yerine fark yazıyor: delete / update / createMany yalnız değişen anahtarlarda. `jobs/tenant-purge-repo.ts:41` `byTenantUser` partisi `IN (SELECT …) LIMIT` yerine önceden okunan sabit kimlik listesiyle çalışıyor. Regresyon testleri: `security-p14a-users` "AC-206 kilitlenme: iki firmada eşzamanlı yetki yazımı … 1213 deadlock / 503 vermez" ve `tenant-purge-meta-p16` "AC-242 kilit kapsamı: USER_CHILDREN partisi açıkken başka firmanın yetki yazımı beklemez". Bağımsız 3 tam koşuda 0 kırmızı |

S16-20 (replay: yalnız `intent` satırı olan kullanıcıda PASSIVE şartı, CANCELLED iş sayılmaz) testli: `tenant-purge-meta-p16` "AC-242 S16-20 replay …" yeşil. 2FA'daki benzer kalıp gereksinimler §9'da "Sonra" olarak kayıtlı (P16 dışı).

### Kabul kriterleri

237 (silme ucu), 240, 241, 242, 243, 244: ✅. Kanıtlar Tur 1–2'deki gibi; testlerin hepsi yeşil.

### Definition of Done

Bütün maddeler ✅. Tur 2'nin iki ❌'i kapandı: kararsız AC-206'nın kök nedeni düzeltildi; doküman ve PDF güncel.

### Açık kalanlar (P16 kabulünü engellemez)

- Staging'de doğrulanacaklar:
  - ilk gece yedeği (tetikleyici 22);
  - restore + `erasure:replay` / `verify`;
  - 24 saat beklemeli uçtan uca firma silme;
  - `WATCH_ALERT_CMD` (S16-12, prod açılışının ön koşulu).
- TEST-P5-1 (P5, AC-219 kaydında açık; sahibi frontend-dev). P16'dan bağımsız.

## P17 — Tur 1

DURUM: DÜZELTİLMELİ

Kapsam: mimari-e11 §8; AC-234 (istemci kısmı), AC-239 (istemci), AC-245..252. Denetlenen kod: `ac20df3` ve çalışma
alanındaki commitlenmemiş değişiklikler (konsol frontend, I5 `agent-win.yml`, runbook §24). Kod değiştirilmedi.

### Test sonucu

| Komut                                                                                  | Sonuç                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @remote/contracts --filter @remote/web run lint` / `typecheck`          | 0 / 0                                                                                                                                                                                                |
| `pnpm format:check`                                                                    | temiz                                                                                                                                                                                                |
| contracts vitest                                                                       | 14 dosya, **103/103**                                                                                                                                                                                |
| web vitest                                                                             | 39 dosya, **351/351**                                                                                                                                                                                |
| e2e `--project=desktop p17-console p15 -g "AC-248\|AC-234"`                            | **2/2**                                                                                                                                                                                              |
| e2e tam takım (yanlışlıkla tümü koştu)                                                 | 389 geçti, **1 kaldı**, 180 atlandı (proje bazlı `desktopOnly`/mobil), 1 koşmadı (`desktop-perf` bağımlılığı). Kalan test: `p5-collab` TEST-P5-1 (`desktop-rtc`). Ayrı koşu (`--repeat-each=3`): 5/6 |
| Go (golang:1.26, linux) `gofmt -l .` / `go vet ./...` / `go test -race -count=1 ./...` | temiz / 0 / **19 paket ok**                                                                                                                                                                          |
| Go `GOOS=windows GOARCH=amd64` `vet` / `build` / `test -c ./internal/capture`          | 0 / 0 / 0                                                                                                                                                                                            |
| Windows CI 43685515034 (`ac20df3`, workflow_dispatch)                                  | tüm işler yeşil; `go test (Windows)` 20 paket `ok`. **Ama** adım `-v` olmadan koşuyor; `SKIP`'ler günlükte görünmüyor (Düzeltilmeli 1)                                                               |

TEST-P5-1 P17'den önce de vardı. P16 Tur 2–3'te AC-219 kaydına açık olarak yazıldı (sahibi frontend-dev). P17 dosya
aktarımı koduna dokunmuyor (`tech-machine`/`control/machine` yalnız `share.state` dalı). P16 kararıyla tutarlı olarak P17
kapısını engellemiyor; ancak artık tek başına da düşüyor (5/6), öncelik yükselmeli (Öneriler 1).

Kodda `t.Skip` yalnız gerekçeli durumlarda var: WGC duman testinde 3 durum, dosya sembolik bağlantısı ayrıcalığı
(diag/remember AC-249 testleri). Kod incelemesinde sorun yok. CI'da gerçekten atlanıp atlanmadıkları ise bilinmiyor.

### Kabul kriterleri

| AC            | Durum                                         | Kanıt veya eksik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 234 (istemci) | ✅                                            | `flow.TestAC234ShareFailureFields` (her Reason → JSON), `TestAC234StoppedReasonOnOpenFailure`, `TestAC234StoppedRepeatLimit` (5 sn sınırı), `TestAC234StoppedResentAfterReconnect`, `TestAC234StoppedReachesFakeServerWithin1s` (gerçek `signal.Dial` + TLS sahte sunucu, ≤ 1 sn), `capture.TestAC234MethodIsLastTriedPath`, `signal.TestAC234ShareStateReasonMethod`. Konsol: e2e `p15` AC-234 ve `p17-console` (WINDOW_CLOSED Türkçe ≤ 2 sn). Kontrat: `p17-share-reasons.test.ts`, Go `reason.go` ile etiket tablosunun iki yönlü eşitliğini denetliyor. Desen sapması (`[A-Z0-9_]`) gerekçeli (I1 sapma 3)                                                                                                                                                                       |
| 239 (istemci) | ✅                                            | `request.TestAC239AcceptedAdmitCodeStrict`, `flow.TestAC239RunTicketAdmitCodeShowsLobby`, `ui.TestAC239AdmitLine`. Alanın yeri (`request/ws.go`) gerekçeli (I1 sapma 2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 245           | ✅ birim · elle test I6                       | `TestAC245HardwareErrorSwitchesToSoftwareWithIDR`, `TestAC245HardwareSilenceSwitchesWithinFiveSeconds` (sahte saat, boşluk [3, 5] sn, neden `EncoderStall`), `TestAC245ShortEncoderLatencyDoesNotSwitch`, `TestAC245SoftwareUnavailableKeepsHardwareError`, `TestAC245SelectEncoderOrder`. Yerel log: `source_windows.go` `onFallback` → `encoder_fallback`. AC metnindeki Windows elle testi I6'ya bırakıldı; kullanıcıda Windows makinesi olmadığı için kabul edildi. Senkron MFT'nin askıda kalması sınırı gerekçeli (I2 sapma 7)                                                                                                                                                                                                                                                 |
| 246           | ✅ birim · CPU ölçümü I6 (açık)               | `TestAC246PartialConversionEqualsFull` (bayt eşitliği, 4 döndürme, ölçek, imleç), `TestAC246FullConversionTriggers`, `TestAC246RegionsAligned16AndClipped`. Benchmark yalnız dönüşüm maliyetini gösteriyor (%87–99,7 az). AC ölçütü ise **süreç CPU'sunda ≥ %40 düşüş**; bu henüz kanıtlanmadı. Ölçüm I6'da kullanıcıya bırakıldı, gerekçeli kabul edildi. P17 Release'inden önce `docs/test-raporu.md`'ye yazılmalı                                                                                                                                                                                                                                                                                                                                                                 |
| 247           | ✅ birim · görsel I6                          | `ui.TestAC247ContrastTableWCAGAA` (iki temada her metin/zemin çifti ≥ 4.5:1, gerçek WCAG hesabı), `TestAC247LightPaletteMatches010x` (regresyon), `TestAC247DarkPaletteDesignTokens`, `TestAC247UseDarkDecision`, `TestAC247ContrastFunction`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 248           | ⚠️ mantık ✅ · gerçek WGC yakalaması kanıtsız | Mantık katmanı sağlam: S17-1 `input/scope_test.go` (örtüşen pencere tıklaması düşüyor, odak başka uygulamadayken tuş düşüyor, sahipli diyalog/menü kabul ediliyor, simge durumu/kapalı pencerede girdi düşüyor, düşme logu 5 sn'de 1), `flow.TestAC248WindowModeSharesOnlyWindowAndStopsOnClose`, `TestAC248WindowOpenFailureSendsReason`, `TestAC248WindowOptionOnlyWhenSupported`, capture/ui süzgeç testleri, konsol rozeti (vitest + e2e + axe açık/koyu). **Eksik:** WGC'nin gerçekten kare aldığını gösteren tek otomatik kanıt `TestAC248WGCWindowSmoke`. CI günlüğü `-v`'siz olduğu için testin PASS mı SKIP mi olduğu belli değil. I0 kapısı SKIP durumunda Windows VM kanıtı istiyordu; bu kanıt alınmadı. I4'teki "ok → K-E11-3 GO kesinleşti" ifadesi bu yüzden kanıtsız |
| 249           | ✅ (Windows CI) · SKIP görünürlüğü            | Windows CI `internal/diag` ve `internal/remember` `ok`: junction, üst zincir, hard link, handle rename/remove testleri; kurban dosyanın SHA'sı değişmiyor. Kod incelemesi: yol ile `os.Remove`/`os.Rename` kalmamış. Symlink alt testleri ayrıcalık yoksa atlanıyor; junction testlerinde Skip yok. Düzeltilmeli 1 bunların görünürlüğünü de kapsar                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 250           | ✅                                            | `flow.TestAC250DisconnectResetsBindingPending`: istek → kopuş → yeni teklif → tam 1 istek ve 1 kayıt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 251           | ✅                                            | `launch.TestAC251SameNameDifferentTenantShowsChange`. Tenant kimliği yerine sunucunun `renewed` kararı kullanılıyor; bu, `bindings/service.ts:230` `target !== null` (aynı tenant'ın etkin kaydı) ile doğrulandı. Sapma gerekçeli (I1 sapma 1, G-E10-4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 252           | Uygulanamaz (gerekçeli)                       | SignPath hesabı yok. `sign` işi `vars.SIGNPATH_ORGANIZATION_ID` boşsa atlanıyor; boş değilse fail-closed (attest/release koşmaz, imzasız ikili reddedilir). Action SHA ile sabit, `permissions` en az. Değişiklikler commitlenmemiş, CI'da hiç koşmadı (yalnız yerel actionlint)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Düzeltilmeli

1. [devops] `.github/workflows/agent-win.yml:93` — `test-windows` adımı `go test -count=1 ./...` `-v` olmadan koşuyor.
   Bu yüzden `TestAC248WGCWindowSmoke` ve AC-249 symlink testlerinin PASS mı SKIP mi olduğu CI günlüğünde görünmüyor.
   Beklenen: adım `-v` ile koşsun (ya da ek bir `go test -count=1 -v -run 'AC248WGC|AC249' ./internal/capture ./internal/diag ./internal/remember`
   adımı eklensin). `--- SKIP: TestAC248WGCWindowSmoke` görülürse iş kırmızı olsun ya da en azından `::warning::` versin.
   Sonra I5 değişiklikleriyle birlikte bir `workflow_dispatch` koşusu yapılsın; koşu numarası ve sonuç runbook §24'e yazılsın.
2. [backend-dev] `docs/implementation.md` "P17 I4" girişi (I0 kapısı paragrafı) — "`internal/capture` `ok` → K-E11-3
   GO kesinleşti" ifadesi kanıt değil (atlanan test de `ok` verir). Beklenen: madde 1'deki koşuda
   `TestAC248WGCWindowSmoke` için `--- PASS` (açılış/ilk kare süresi logu ile) ya da `--- SKIP` + neden yazılsın.
   SKIP ise I0 kararına göre AC-248, I6 Windows elle testi (senaryo 2) geçene kadar "kanıtsız" kalır; bu, I6 kapısı olarak açıkça yazılsın.

### Definition of Done

| Madde                                           | ✅/❌ | Not                                                                                                                                                                                                                                         |
| ----------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Her AC'nin kanıtlayan testi var                 | ❌    | AC-248'in gerçek yakalama kanıtı belirsiz (Düzeltilmeli 1–2). Diğer AC'ler ✅; 246 CPU ve 245/247 görsel/elle kısımlar I6'da gerekçeli                                                                                                      |
| Testler yeşil (lint/type/unit/e2e, Go vet/test) | ✅    | P17 kapsamı tamamen yeşil. Tek kırmızı, P17'den bağımsız ve önceden açık olan TEST-P5-1                                                                                                                                                     |
| Format (prettier, gofmt)                        | ✅    |                                                                                                                                                                                                                                             |
| Tasarım–kod uyumu, sapmalar gerekçeli           | ✅    | I0–I5 ve konsol sapmalarının hepsi `implementation.md`'de yazılı. mimari §8 "Sürüm" satırı `v0.11.0` olarak güncellenmiş (AC-94 ile tutarlı)                                                                                                |
| Katman / tip güvenliği                          | ✅    | Web değişikliklerinde `any` yok. `sharingMethodOf` dışarıdan gelen değeri `SHARE_METHODS` ile süzüyor. Go'da `unsafe.Pointer` dönüşümleri çağrı argümanında (vet temiz)                                                                     |
| Hata yutma / PII log                            | ✅    | `share.state.reason` yalnız sabit kod (HRESULT/Op/başlık gitmez). `input_dropped` ve `encoder_fallback` loglarında içerik/başlık yok. Pencere modunda tanılama hedefi `"window"` (başlık yazılmıyor)                                        |
| Yeni bağımlılık                                 | ✅    | Yok (`go.mod`, `package.json` değişmedi)                                                                                                                                                                                                    |
| Frontend 5 durum / a11y / token                 | ✅    | Rozet token sınıfları (`bg-primary-surface`, `text-primary`), `AppWindow` ikonu `aria-hidden`, `sr-only` açıklama; axe açık/koyu temiz; animasyon yok. Rozet durumları (yok/WGC/DXGI/durdu/ayrıldı/yenileme) reducer testleriyle kapsanıyor |
| Dokümantasyon (DESIGN.md, runbook)              | ✅    | DESIGN.md rozet satırı, runbook §24                                                                                                                                                                                                         |
| CHANGELOG / kullanım kılavuzu                   | —     | Zincirin dokümantasyon adımında (teknik-yazar); QA kapısı değil. CHANGELOG'da henüz 0.11.0 bölümü yok                                                                                                                                       |
| Commit                                          | —     | Konsol ve I5 değişiklikleri commitlenmemiş (kullanıcı kararı); I5 workflow'u CI'da hiç koşmadı                                                                                                                                              |

### Açık kalanlar (gerekçeli, P17 kapanışından önce kullanıcıda / I6)

- AC-246 1080p durağan masaüstünde 60 sn CPU ölçümü (0.10.x tabanına göre ≥ %40 düşüş): AC'nin asıl ölçütü, henüz ölçülmedi.
- I6 Windows 10/11 elle turu: implementation.md "P17 I6" 10 senaryo + donanım MFT kapatma + açık/koyu tema + 0.10.x
  ile karışık sürüm. Sonuçlar `docs/test-raporu.md`'ye yazılacak.
- S17-2 yayın ön koşulu: P15 prod'da olmadan `v0.11.0` itilmeyecek. Bekleyen `v1.0.0` koşusu (43649073915) için
  runbook §24.1/4 önerisi: Reject.

### Öneriler (zorunlu değil)

1. [frontend-dev] TEST-P5-1 artık tek başına da düşüyor (`--repeat-each=3` → 5/6, `offerAndCancel` satır 332).
   P16 notundaki şüphe (`files-panel` `onClose` reddinin fid'e bağlanmaması) için kök neden çalışması P18'den önce yapılmalı.
2. [devops] `release` işi özetine `- [x]` kutularını kendisi yazıyor. Onaylayan kontrol etmeden de işaretli görünür.
   Kutular `- [ ]` + "onaylayan doğrular" metniyle yazılsın.
3. [backend-dev] Klavye kapsamı, sahipli diyalog öndeyken tuşları düşürüyor (I4 sapma 3). I6 gözleminden sonra mimar kararı alınsın.
4. [backend-dev] 386 `mf_windows.go:270` taşması: `capture` Windows dosyalarına `amd64 || arm64` build tag'i eklensin (I5 notu 5).

### Olumlu

- Kontrat ile Go arasındaki tutarlılık otomatik denetleniyor: `reason.go` ile etiket tablosu iki yönlü eşit tutuluyor. Yeni neden kodu etiketsiz kalırsa test kırmızı olur.
- S17-1 testleri gerçek tehdit senaryolarını hedefliyor: sahte z sırası/ön plan/sahiplik masaüstü, yabancı PID ve başka iş parçacığı menüsünün reddi, tuşların kuyruklanmaması, bırakma muafiyeti.
- AC-249 hard link ve TOCTOU (`GetFinalPathNameByHandle`) korumaları AC'nin istediğinin ötesinde. CI'da yakalanan rename hatası kök nedeniyle düzeltilmiş ve regresyon testi eklenmiş.
- AC-246 bayt eşitliği testi kapsamlı: 4 döndürme, ölçekleme, tek boyutlar, imleç izi.
- I5 fail-closed tasarlanmış: `sign` başarısızsa attest/Release koşmuyor; SignPath tanımlıyken imzasız ikili reddediliyor; sürüm geri gidemiyor.

## P17 — Tur 2

DURUM: DÜZELTİLMELİ (yalnız dokümantasyon; kod, test ve AC tarafı tam)

Kapsam: P17 Tur 1 Düzeltilmeli 1 (devops) ve 2 (backend-dev); güvenlik düzeltmeleri S-P17-1, S-P17-4, S-P17-5
(+ 386 `mf_windows.go`/`WorkAreaAt`); implementation.md "P17 güvenlik düzeltmeleri (Go)" ve "(CI)". Denetlenen commit
`f862e0e` (`p17-wip`, çalışma alanı temiz). Kod değiştirilmedi.

### Test sonucu

| Komut                                                                                                   | Sonuç                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Go (golang:1.26, linux, repo kökü bağlı) `gofmt -l .` / `go vet ./...` / `go test -race -count=1 ./...` | boş / 0 / **19 paket ok**                                                                                                                                                                                          |
| `GOOS=windows GOARCH=amd64 \| arm64 \| 386 go vet ./...`                                                | 0 / 0 / 0 (386 vet artık temiz)                                                                                                                                                                                    |
| `go test -v -run 'TestSP171\|TestAC248S171' ./internal/input` (linux)                                   | 15/15 PASS (6 yeni S-P17-1 testi dahil)                                                                                                                                                                            |
| contracts / web vitest                                                                                  | 14 dosya **103/103** · 39 dosya **351/351**                                                                                                                                                                        |
| contracts+web lint / typecheck · `pnpm format:check`                                                    | 0 / 0 · temiz                                                                                                                                                                                                      |
| actionlint 1.7.8 `agent-win.yml`                                                                        | 0 bulgu                                                                                                                                                                                                            |
| **Windows CI 43687183097** (`f862e0e`, workflow_dispatch)                                               | `success`. `go test (Windows)` 20 paket `ok`; yeni "-v" adımında 31 `--- PASS: TestAC248*/TestAC249*`, **0 SKIP**, `::warning::`/`::error::` yok. Etiket dışı olduğundan sign/approve/release `skipped` (beklenen) |

**`TestAC248WGCWindowSmoke`: PASS (0.59 s)** — günlük: `oturum açılışı 77.599ms`, `ilk kare 134.0155ms sonra, 306x233,
orta piksel BGRA=[0 0 255 255]` (kırmızı test penceresinin gerçek WGC karesi). Böylece AC-248'in gerçek yakalama kanıtı
otomatik olarak alındı; I6 elle testine bağlı kalmıyor (I6 yine pencere taşıma/küçültme ve S-P17-1 Win+R senaryosu için
gerekli). AC-249 symlink alt testleri (`TestAC249SymlinkLogFileAndRotationRefused`, `TestAC249SymlinkFileNotFollowed`)
runner'da PASS — atlanmadılar.

### Tur 1 maddeleri ve güvenlik düzeltmeleri

| Madde                                  | Durum             | Kanıt                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tur 1 / 1 [devops] `-v` + SKIP uyarısı | ✅ kod · ❌ kayıt | `agent-win.yml` ayrı adım `go test -count=1 -v -run 'TestAC248\|TestAC249' ./internal/... \| tee` (bash `pipefail` ile test hatası işi düşürür); SKIP → `::warning::`, test yoksa `::error::` + `exit 1`. CI 43687183097'de doğru çalıştı. **Eksik:** maddenin istediği "koşu numarası ve sonuç runbook §24'e" yazılmadı (§24.2 yalnız mekanizmayı anlatıyor)                                                                                                                  |
| Tur 1 / 2 [backend-dev] PASS/SKIP notu | ❌                | `docs/implementation.md:6788` hâlâ "`internal/capture` … `ok` → K-E11-3 **GO** kesinleşti"; `:6855` "(I0, CI'da ok)". PASS kanıtı artık var ama implementation.md'ye yazılmadı                                                                                                                                                                                                                                                                                                 |
| S-P17-1 kabuk kısayolları              | ✅                | `scope.go:229-305`: kabuk denetimi ön plan denetiminden önce; Win basması hiç enjekte edilmez, Alt+Tab/Alt+Esc/Ctrl+Esc/Ctrl+Shift+Esc/PrintScreen düşer; değiştiriciler bırakılana dek kilit (Win+R+metin, Alt+Tab+Tab); bırakmalar geçer; ön plan kaçınca basılı tuşlar bırakılır; pencere modu tuş kovası 40/sn. Testler: `TestSP171*` 6 test (monitör modu değişmedi testi dahil). `mimari-e11.md:466` AC-248 satırına kural eklendi. Win+R gerçek davranışı I6 senaryo 11 |
| S-P17-4 kabuk pencereleri              | ✅                | `win.ClassName` (`GetClassName`) → `screens_windows.go:434` → `share.go:24,44` `Progman/WorkerW/Shell_TrayWnd/Shell_SecondaryTrayWnd` süzülüyor; `TestAC248ShareableWindowsFilter` (Gezgin `CabinetWClass` kalıyor) linux ve Windows'ta PASS                                                                                                                                                                                                                                   |
| S-P17-5 + 386                          | ✅                | `diag/reparse_windows.go` ve testi `windows && (amd64 \|\| arm64)`; `reparse_unsupported_windows.go` her işlemde `ErrUnsupported` (fail-closed, zayıf denetime dönüş yok). `setUINT64` 32 bit ABI'de iki sözcük; `WorkAreaAt` düzeltildi. Üç mimaride vet 0                                                                                                                                                                                                                    |

### Kabul kriterleri (Tur 1'e göre değişen)

| AC  | Durum | Kanıt                                                                                                                                      |
| --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 248 | ✅    | Tur 1'deki mantık testleri + **CI 43687183097 `TestAC248WGCWindowSmoke` PASS** (gerçek WGC karesi, 306x233, doğru renk) + S-P17-1 testleri |
| 249 | ✅    | CI 43687183097: junction, üst zincir, symlink (atlanmadı), hard link, handle rename/remove, `RenameInfoLayout` PASS                        |

Diğer AC'ler (234, 239, 245, 246, 247, 250, 251, 252) Tur 1'deki gibi; regresyon yok. 245/246/247 elle/ölçüm kısımları
gerekçeli olarak I6'da.

### Düzeltilmeli

1. [backend-dev] `docs/implementation.md:6788` (P17 I4 "I0 kapısı") ve `:6855` — "`ok` → GO kesinleşti" / "CI'da ok"
   yerine: "CI 43687183097 (`f862e0e`): `--- PASS: TestAC248WGCWindowSmoke (0.59s)`, oturum 77.6 ms, ilk kare 134 ms,
   306x233, orta piksel kırmızı → K-E11-3 GO kanıtlandı" yazılsın.
2. [devops] `docs/runbook.md` §24.2 WGC paragrafı — Tur 1 / 1'in istediği koşu kaydı eklensin: "CI 43687183097
   (`f862e0e`, dispatch): AC-248/249 adımı 31 PASS, 0 SKIP; WGC duman PASS".

Yalnız metin; kod/test tekrarı gerekmez. Uygulanınca Tur 3 belge kontrolüyle kapanır.

### Definition of Done

| Madde                                           | ✅/❌ | Not                                                                                     |
| ----------------------------------------------- | ----- | --------------------------------------------------------------------------------------- |
| Her AC'nin kanıtlayan testi var                 | ✅    | AC-248 gerçek yakalama kanıtı CI'da alındı                                              |
| Testler yeşil (lint/type/unit, Go vet/test, CI) | ✅    | Linux Go 19 paket, Windows CI 20 paket + -v adımı, vitest 103+351                       |
| Format (prettier, gofmt) · actionlint           | ✅    |                                                                                         |
| Tasarım–kod uyumu, sapmalar gerekçeli           | ✅    | S-P17-1 sapmaları (Alt+F4, Alt+harf, PrintScreen, ContextMenu) gerekçeli; mimari güncel |
| Hata yutma / PII log                            | ✅    | Yeni nedenler `SHELL_SHORTCUT`/`KEY_BURST` yalnız sabit kod, tuş içeriği yok            |
| Yeni bağımlılık                                 | ✅    | Yok                                                                                     |
| Dokümantasyon (implementation.md, runbook)      | ❌    | Düzeltilmeli 1–2 (Tur 1 maddelerinin kayıt kısmı uygulanmadı)                           |

### Öneriler (zorunlu değil)

1. [backend-dev] `internal/remember/reparse_windows_test.go` `//go:build windows` — 386'da `ErrReparse` beklediği için
   koşarsa düşer (implementation.md'de yazılı). `diag` testiyle aynı `windows && (amd64 || arm64)` etiketi verilsin.
2. Tur 1 Öneriler 1 (TEST-P5-1) ve 2 (release özeti kutuları; S-P17-3 ile `reproducible` özetine taşınmış, boş kutu) —
   ilki hâlâ açık.

### Olumlu

- CI adımı üç durumu (PASS / SKIP uyarı / koşmadı hata) ayırıyor ve ilk koşuda gerçek kare kanıtını görünür kıldı.
- S-P17-1 düzeltmesi raporun istediğinin ötesinde: kilit mantığı type-ahead'i (Win+R+metin) kesiyor, PrintScreen
  eklendi, ön plan kaybında basılı tuşlar bırakılıyor.
- 386 için sessiz zayıf denetime dönmek yerine fail-closed eş seçilmiş.

## P17 — Tur 3

DURUM: GEÇTİ

Kapsam: Tur 2 Düzeltilmeli 1–2 ve Öneri 1; güvenlik tur 2 düzeltmeleri S-P17-7 (Orta), S-P17-8 (Düşük); regresyon.
Denetlenen commit `16956a2` (`p17-wip`, çalışma alanı temiz). Kod değiştirilmedi.

### Test sonucu

| Komut                                                                                      | Sonuç                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Go (golang:1.26, linux) `go test -race ./...` · `GOOS=windows go vet ./...` · `gofmt -l .` | **19 paket ok** · 0 · boş; `GOOS=windows go test -c` (input, remember, ui) derleniyor                                                                                                                                                                                                      |
| contracts / web vitest · `pnpm format:check`                                               | 14 dosya **103/103** · 39 dosya **351/351** · temiz                                                                                                                                                                                                                                        |
| **Windows CI 43688024372** (`16956a2`, workflow_dispatch)                                  | `success`. `go test (Windows)` 20 paket `ok`; `-v` adımında 31 `--- PASS: TestAC248*/TestAC249*`, 0 SKIP, `::warning::`/`::error::` yok; **`TestAC248WGCWindowSmoke` PASS (0.53 s)**. build 1/2, tekrarlanabilirlik, attestation yeşil; imza/onay/release `skipped` (etiket yok, beklenen) |

### Tur 2 maddeleri

| Madde                                 | Durum | Kanıt                                                                                                                                                        |
| ------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Düzeltilmeli 1 [backend-dev] impl.md  | ✅    | `implementation.md:6788` "koşu 43687183097 (`f862e0e`): `--- PASS: TestAC248WGCWindowSmoke (0.59s)` … K-E11-3 GO kanıtlı"; `:6855` "PASS 0.59 s, SKIP değil" |
| Düzeltilmeli 2 [devops] runbook §24.2 | ✅    | `runbook.md:2850` "Kayıt: … 43687183097 (`f862e0e`) … 31 PASS, 0 SKIP; `TestAC248WGCWindowSmoke` PASS"                                                       |
| Öneri 1 remember reparse build tag    | ✅    | `remember/reparse_windows_test.go:1` `//go:build windows && (amd64 \|\| arm64)`                                                                              |

### Güvenlik tur 2 düzeltmeleri

| Bulgu   | Durum | Kanıt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-P17-7 | ✅    | `scope.go` `shellShortcut` artık neden döner; Alt/Ctrl/Win = alıcı ∨ `GetAsyncKeyState`; Yapışkan Tuşlar bas-bırak izi (`tapCand`/`stickyArmed`, oturum başında kurulu), 5. Shift, Fare Tuşları'nda `Numpad*`/`NumLock`, Alt+Shift+NumLock her zaman; ayar 2 sn önbellek, okunamazsa "açık" (fail-closed). `STICKYKEYS` cbSize 8, `MOUSEKEYS` cbSize 28 doğru. 8 test `TestSP177*` gerçekten kuralları sınıyor: OS değiştiricisi (3 alt durum + değiştiricisiz Tab geçer), Ctrl↓↑Esc / Alt↓↑Tab / Ctrl↓↑Shift↓↑Esc düşer, Ctrl+C sonrası Esc geçer, odak kaybı bırakması izi kurar, ayar kapalıyken davranış aynı, 5. Shift ve sayaç sıfırlama, Numpad/üst sıra rakam ayrımı, periyodik ve oturum başı okuma, monitör modu değişmedi. Linux ve Windows CI'da PASS. Sapmalar 1–5 implementation.md'de gerekçeli; Windows çalışma zamanı I6 senaryo 12'de yazılı |
| S-P17-8 | ✅    | `share.go` `windowShareWarning` + `screens_windows.go:364` kalın etiket, form 40 px uzadı (butonlar 444); `TestSP178WindowShareWarningText`. Görsel yerleşim I6 senaryo 12                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Kabul kriterleri

Tur 2 tablosu geçerli (234, 239, 245–252 ✅; 245/246/247 elle/ölçüm kısımları gerekçeli olarak I6'da). AC-248 kanıtı
bu commit'te yeniden alındı (CI 43688024372 WGC duman PASS); S-P17-7 ile girdi kapsamı genişledi, regresyon yok
(`TestAC248S171*`, `TestSP171*` yeşil).

### Düzeltilmeli

Yok.

### Definition of Done

| Madde                                         | ✅/❌ | Not                                                                 |
| --------------------------------------------- | ----- | ------------------------------------------------------------------- |
| Her AC'nin kanıtlayan testi var               | ✅    |                                                                     |
| Testler yeşil (unit, Go vet/test, Windows CI) | ✅    | Linux 19 paket, Windows 20 paket + -v adımı, vitest 103+351         |
| Format (prettier, gofmt)                      | ✅    |                                                                     |
| Tasarım–kod uyumu, sapmalar gerekçeli         | ✅    | Denetim sırası değişikliği (sapma 1) gerekçeli                      |
| Hata yutma / PII log                          | ✅    | Yeni nedenler `STICKY_KEYS`/`MOUSE_KEYS` sabit kod, tuş içeriği yok |
| Yeni bağımlılık                               | ✅    | Yok                                                                 |
| Dokümantasyon (implementation.md, runbook)    | ✅    | Tur 2 maddeleri işlendi                                             |

### Öneriler (zorunlu değil)

1. [guvenlik → backend-dev] Yapışkan Tuşlar **kilit** durumu ("art arda iki kez basınca kilitle", `SKF_TRISTATE`,
   Windows'ta varsayılan açık) izde yok: Ctrl↓↑ Ctrl↓↑ (kilitli) → harf (iz temizlenir, Ctrl OS'ta kilitli kalır) → Esc
   iletilir → Ctrl+Esc. Etki sınırlı (Başlat/Görev Yöneticisi ön planı alınca sonraki tuşlar `UNFOCUSED` düşer, fare
   örtüşme denetimi var), ama S-P17-7'nin kapattığı yolun bir varyantı. Öneri: aynı Ctrl/Alt'ın araya tuş girmeden iki
   ardışık bas-bırakı "kilitli" sayılsın; üçüncü bas-bırak gelene dek `stickyArmed` harfle temizlenmesin (ya da
   `SKF_TRISTATE` açıksa Yapışkan Tuşlar açıkken pencere modunda Tab/Esc hep düşsün) + test. Güvenlik tur 3 değerlendirsin.
2. Tur 1 Öneri 1 (TEST-P5-1) hâlâ açık.

### Olumlu

- Tur 2'nin iki metin maddesi ve öneri tek commit'te, istenen ayrıntıyla (koşu no, commit, süre) kapandı.
- S-P17-7 testleri yalnız "düşer" değil "geçmesi gereken geçer" tarafını da (Ctrl+C sonrası Esc, üst sıra rakam,
  monitör modu) doğruluyor; erişilebilirlik ayarı okunamazsa kapalı tarafta kalınıyor.

---

# P18 — Tur 1

DURUM: DÜZELTİLMELİ

Kapsam: dal `p18-wip` @ `06e9ab3` (`git diff main...HEAD`, 114 dosya); mimari-e11 §8b; AC-255..258; S-P18-T1..T12;
K-P18-1..12; implementation.md "P18 H1/H2/H3/H4/H5".

## Test sonucu

| Komut                                                                       | Sonuç                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm -r run lint` / `pnpm -r run typecheck`                                | temiz (çıkış 0)                                                                                                                                                                                                                     |
| `pnpm -r run test`                                                          | contracts 133/133 · web 368/368 · server birim 410/410; skip 0                                                                                                                                                                      |
| `pnpm format:check`                                                         | temiz                                                                                                                                                                                                                               |
| server `test:int` (geçici DB `rs-mysql-qa-p18-t1`, migrate + grants)        | 73 dosya / **723/723**; skip 0; konteyner silindi                                                                                                                                                                                   |
| `pnpm --filter @remote/web e2e` (tam takım çalıştı; p18-h4, p16, p15 dahil) | **404 geçti, 0 kırmızı, 191 skip**. Skip'ler proje kapsamlı (`desktopOnly`/mobil projesi); p18-h4'te 11 skip = mobil projede `test.skip(name !== "desktop")`, 390 px kontrolü desktop projesinde viewport ile yapılıyor — gerekçeli |
| Go `go test ./...` (golang:1.26)                                            | 19 paket ok (fikstür `ws-request.json` yeni girdileriyle `ParseServer` uyumlu)                                                                                                                                                      |
| `deploy/ops/test-watch.sh`                                                  | GEÇTİ (P18 crypto-decrypt / calendar-fallback / msg-tenant-rate / p18-metrics dahil)                                                                                                                                                |
| `deploy/backup/test-backup.sh`                                              | GEÇTİ (102 PASS; manifest tetikleyici 23 = lib.sh `REMOTE_EXPECTED_TRIGGERS`)                                                                                                                                                       |

Test konteynerleri (DB, watch, backup) silindi; prune/restart yapılmadı. `check-app-grants.sh` ayrı koşulmadı
(H1 notu 561/561; tetikleyici/yetki negatiflerinin bir kısmı `p18-schema-h1.test.ts` ile bu turda yeşil).

## Kabul kriterleri

| AC     | Durum | Kanıt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-255 | ✅    | Sunucu+protokol+panel (K-P18-1: müşteri arayüzü P19/P20). `p18-messages-h3.test.ts`: çift yönlü (yetenekli sahte istemci ↔ panel, talep PENDING kalır), 1.001 → 400, < 1 sn → 429/`RATE_LIMITED` soket açık, view yok → 403 / message yok → yazma 403, başka tenant 404, PENDING dışı 409, `body_enc` düz metin içermez + AAD taşınınca çözülmez, INSERT hatasında iletim yok, retention aynı TX'te mesaj 0, firma silmede iki tablo 0; geriye uyum (yeteneksiz soket 0 çerçeve, POST 409 `CHAT_UNSUPPORTED`, 1008 + satır 0); Go fikstür testi yeşil. Web: `p18-h4.spec.ts` yazışma 5 durumu + UNSUPPORTED + 429 + XSS metin düğümü |
| AC-256 | ✅    | `p18-backend-h2.test.ts` "AC-256 atama" (403, 400 başka tenant/pasif/kabul yetkisiz/Super Admin, atanana `request.updated`, audit eski→yeni; 404/409; K-P18-3), `assignable=1`; S-P18-T5 yaşam döngüsü; DB FK 1452 (`p18-schema-h1`). Web e2e: ata → çip + ikinci tarayıcıda "Atandı: <ad>", atanana toast                                                                                                                                                                                                                                                                                                                           |
| AC-257 | ✅    | Birim `compareQueue`/`slaBreachedAt` sınırları (tam due aşım değil, +1 ms aşım); entegrasyon HIGH → position 1, FIFO, müşteri > firma varsayılanı, SLA dondurulur, liste `slaBreached`, CSV "SLA aşıldı" Evet/Hayır/boş; web e2e kuyruk sırası + SLA due anında kırmızı (sahte saat), müşteri formu/talep ayarı alanları                                                                                                                                                                                                                                                                                                             |
| AC-258 | ✅    | `calendar-p18.test.ts` İstanbul + New York DST tabloları, tatil + arife 13:00, 24:00, 366 gün sınırı, mesaj biçimi; entegrasyon REJECT 0.12.0 → 409 `OUTSIDE_HOURS` + `nextOpeningAt`, 0.11.0 → 429 `QUEUE_FULL` aynı mesaj (Retry-After yok), bindingKey yolu, ACCEPT `after_hours=1` + SLA açılıştan, açık an yoksa NULL, önbellek geçersiz kılma; tatil uçları + ≤ 200 kilit testi; web e2e mesai kaydet/önizleme, tatil ekle/sil/içe aktar                                                                                                                                                                                       |

S-P18-T1..T12: her birinin adında `S-P18-Tn` taşıyan en az bir testi var ve yeşil (T1, T2 CLI, T3, T4, T5/T5c, T6, T7, T8,
T9 log, T10 metrik, T11 tetikleyici, T12 fallback + tatil kilidi).

## Düzeltilmeli

1. [frontend-dev] `apps/web/app/(panel)/history/*` — mimari-e11 §8b.8 "Geçmiş: talep detayında SLA hedefi/aşım satırı"
   uygulanmamış (history ekranında SLA ile ilgili hiçbir şey yok; sunucu yalnız CSV hücresi üretiyor) ve
   implementation.md "P18 H4 → Sapmalar"da gerekçesi yok. Beklenen: ya oturum/talep detayında "SLA hedefi: <saat> —
   aşıldı/aşılmadı" satırı (detay API'sine `slaDueAt`/`slaBreached` eklenerek [backend-dev] ile) + e2e, ya da
   implementation.md'ye gerekçeli sapma notu (AC-257 CSV ile karşılandığı için ertelendi vb.) ve mimarın onayı.
2. [mimar] `docs/mimari-protokol.md` §5 — §8b.9 dosya planındaki "§5 eki" (`rs.cap.chat1`, `request.message(s)`,
   `request.chat`, `request.activity`, `request.updated`, `request.new` ek alanları) yapılmamış; P20 Go istemcisi bu
   belgeye bakacak. Beklenen: §5'e P18 mesaj tabloları ve yetenek bildirimi kuralı eklensin (H8 ile birlikte de olabilir;
   o zaman H8 görev kartına yazılsın).

## Definition of Done

| Madde                                                       | ✅/❌ | Not                                                                                                                             |
| ----------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------- |
| Testler yeşil (unit, int, e2e, Go, ops, backup)             | ✅    | Yukarıdaki tablo; skip'ler gerekçeli                                                                                            |
| Lint / typecheck / format                                   | ✅    |                                                                                                                                 |
| Her AC'nin adında AC no taşıyan testi                       | ✅    |                                                                                                                                 |
| Katman (route → servis → repo), tenant guard, IDOR 404      | ✅    | `tenant-matrix.ts` 2 uç + çapraz tenant vakaları; atama DB bileşik FK                                                           |
| `any` / `@ts-ignore` / boş `catch` / `console.log`          | ✅    | Diff taramasında 0                                                                                                              |
| Transaction (atama, öncelik, tatil tavanı, retention silme) | ✅    | Kilit sırası belgeli                                                                                                            |
| PII/gövde log ve audit                                      | ✅    | Logger redakte + S-P18-T9 testi; audit `{sender, chars}`                                                                        |
| Audit (atama, öncelik, ayar, tatil, mesaj, ret, rewrap)     | ✅    |                                                                                                                                 |
| Yetki toggle'ı tek tanımdan otomatik                        | ✅    | `permissions.ts` `assign`, `message`; ADMIN açık / USER kapalı testli; UI menü/gönder alanı yetkiye bağlı                       |
| Sayfalı/sınırlı listeler                                    | ✅    | Mesaj ≤ 100/≤ 50, tatil ≤ 200, kuyruk ≤ 50                                                                                      |
| 5 durum, a11y (axe 0 iki tema, 1280/390)                    | ✅    | p18-h4 e2e                                                                                                                      |
| İkonlar (lucide, anlamlı), ham renk/px yok                  | ✅    | `CalendarClock`, `UserPlus/UserMinus/UserCheck`, `Flag`, `MoonStar`, `Timer/AlarmClock`; diff'te hex/ham Tailwind renk/`[px]` 0 |
| Yeni bağımlılık                                             | ✅    | Yok (Vaul yerine mevcut `Dialog`, gerekçeli)                                                                                    |
| Tasarım-kod uyumu; sapmalar gerekçeli                       | ❌    | Düzeltilmeli 1 (geçmiş SLA satırı gerekçesiz eksik), 2 (protokol eki)                                                           |
| Env/compose/runbook                                         | ✅    | `migrate` servisine mevcut `APP_ENCRYPTION_KEYS`; runbook §25                                                                   |
| Dokümantasyon (kılavuz, api.md, CHANGELOG, PDF)             | —     | H8 (teknik-yazar) kapsamı; bu turda değerlendirilmedi                                                                           |

## Öneriler (zorunlu değil)

1. `request.new.customerChat` panelde kullanılmıyor (implementation.md'de not var); yazışma paneli açılmadan önce kartta
   "müşteri mesajlaşmayı desteklemiyor" ipucu için kullanılabilir ya da P19'a kadar sözleşmeden çıkarılabilir.
2. Okunmamış sayacı sayfa yenilemede sıfırlanıyor (gerekçeli); H7'de teknisyenlerin bunu sorun sayıp saymadığı not edilsin.
3. Web e2e'de `-- p18-h4 p16 p15` süzgeci uygulanmayıp tam takım koşuyor; `e2e` betiğine dosya argümanı geçişi
   kontrol edilebilir.

## Olumlu

- Geriye uyum (0.11.0 istemci) tip düzeyinde ayrım + Go fikstürü + sözleşme testiyle üç katmanda kanıtlı.
- DST, var olmayan/iki kez yaşanan saat ve 366 gün sınırı tablo testleriyle; mesai reddi ref ve bindingKey yollarında aynı sırada.
- Saklama-önce-iletim, AAD bağlama, retention aynı TX ve firma silme regresyonu gerçek DB'de test ediliyor; tetikleyici
  sayısı (23) tek kaynaktan backup/ops testlerine kadar tutarlı.

# P18 — Tur 2

DURUM: GEÇTİ

Kapsam: dal `p18-wip` @ `80e07cc` ("P18 düzeltme turu 1"); QA Tur 1 maddeleri 1–2 ve güvenlik S-P18-K1..K3 düzeltmeleri;
implementation.md "P18 düzeltme turu 1 (devops/backend/frontend)".

## Test sonucu

| Komut                                                                | Sonuç                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `pnpm -r run lint` / `pnpm -r run typecheck` / `pnpm format:check`   | temiz (çıkış 0)                                                                                         |
| `pnpm -r run test`                                                   | contracts 133/133 · web 371/371 (+3 `closedSlaView`) · server birim 410/410; skip 0                     |
| server `test:int` (geçici DB `rs-mysql-qa-p18-t2`, migrate + grants) | 73 dosya / **726/726** (+3: SLA detay, K1, K2); skip 0; konteyner silindi                               |
| `pnpm --filter @remote/web e2e p8-history p18-h4 p16`                | **48 geçti, 0 kırmızı, 34 skip** (mobil projede `desktopOnly`; 390 px kontrolü desktop'ta viewport ile) |

Go, ops ve backup testleri bu turda koşulmadı (değişen dosyalar onları etkilemiyor; fikstür ve tetikleyici değişmedi).

## Önceki tur maddeleri ve güvenlik düzeltmeleri

| Madde                                    | Durum | Kanıt                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QA-1 geçmiş detayında SLA satırı         | ✅    | `SessionRequestInfo.slaDueAt/slaBreached` (`history.ts` CSV ile aynı `slaBreachedAt`); int `p18-backend-h2` "AC-257 / §8b.8" aşıldı=true, içinde=false, SLA'sız null/null, talepsiz `request` null. Web `RequestInfo` satırı + `SlaBadge met`; e2e `p8-history` "AC-257: geçmiş detayı SLA satırı" aşıldı/içinde/SLA'sız satır yok, iki tema axe 0, 390 px taşma yok |
| QA-2 `mimari-protokol.md` §5 P18 eki     | ✅    | §5.4.1–5.4.6: yetenek bildirimi, ek mesajlar, işleme sırası (K1 dahil), gövde kuralları, panel ekleri, P19/P20 kontrol listesi                                                                                                                                                                                                                                       |
| S-P18-K1 gövde hatası soketi kapatmaz    | ✅    | `ws.ts` zarf geçerli + gövde geçersiz → `error VALIDATION`; int "S-P18-K1": 21 satır/yumuşak tire/bidi → VALIDATION, mesaj gövdeyi içermez, soket açık, satır 0, PENDING; ardından geçerli mesaj iletilir; zarf bozuk → 1008                                                                                                                                         |
| S-P18-K2 rewrap hata yolunda audit       | ✅    | `crypto.ts` `finally` audit; int "S-P18-K2": 2. partide simüle DB hatası → audit `fail` `{rows:500, batches:1, error:"SimulatedDbError"}`, gövde yok; yeniden çalıştırma kalan 1 satırı taşır, check-retire 0                                                                                                                                                        |
| S-P18-K3 anahtar migrate ortamında değil | ✅    | `docker-compose.yml` migrate'te `APP_ENCRYPTION_KEYS` yok (server `:?` aynı); runbook §25.5 tek seferlik `-e`; `crypto.ts` baş yorumu hizalı. Otomatik test yok (compose yapılandırması; devops `docker compose config` doğrulaması implementation.md'de)                                                                                                            |

AC-255..258 durumları Tur 1'deki gibi ✅; regresyon yok.

## Düzeltilmeli

Yok.

## Definition of Done

| Madde                                     | ✅/❌ | Not                                                                     |
| ----------------------------------------- | ----- | ----------------------------------------------------------------------- |
| Testler yeşil (unit, int, ilgili e2e)     | ✅    | Skip'ler gerekçeli (mobil proje)                                        |
| Lint / typecheck / format                 | ✅    |                                                                         |
| Yeni davranışların testi                  | ✅    | SLA detay (int + birim + e2e), K1, K2                                   |
| `any` / boş `catch` / gövde log           | ✅    | K1 yolunda gövde loglanmıyor; rewrap `catch` yeniden fırlatır           |
| Sözleşme ↔ kod ↔ belge uyumu              | ✅    | contracts `SessionRequestInfo`, `requestMessageEnvelopeSchema` ↔ §5.4.3 |
| Erişilebilirlik / iki tema / ikon / token | ✅    | axe 0; `CircleCheck` + `success` tokenları                              |

## Öneriler (zorunlu değil)

1. [mimar] `docs/mimari-protokol.md` §5.4.3 madde 4'teki "düzeltme `p18-wip` çalışma ağacında… birleşmeden önceki kod gövde
   hatasında da 1008 kapatır" notu `80e07cc` ile commit edildiği için artık geçici; P18 kapanışında sadeleştirilebilir
   (§5.4.6 son madde eski istemci/sunucu uyumu için yeterli).
2. [backend-dev] K1 yolunda VALIDATION çerçeveleri yalnız genel 5/sn kovasıyla sınırlı (belgeli). Gözlemlenebilirlik için
   `request_message_rejected{reason:"validation"}` benzeri bir sayaç düşünülebilir.

## Olumlu

- K2 testi Proxy ile gerçek bir ara parti hatası üretip audit içeriğini birebir doğruluyor; idempotent yeniden koşu da test ediliyor.
- SLA kararı tek kaynakta (`slaBreachedAt`) — CSV ve detay ayrışamaz; web sunucu kararını aynen kullanıyor.
