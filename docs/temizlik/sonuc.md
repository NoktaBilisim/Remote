# PT kapanış ölçümü (PT-K17 + PT-K18) — TAMAM

Tarih: 2026-11-15 · Ölçülen kod: **`440aa07`** (dal `pt-wip`, temiz çalışma kopyası) · Baseline: **`c661ea0`**
(`docs/temizlik/baseline.md`, `baseline/*.json`) · Betik: `scripts/pt-olcum.sh` (tüm adımlar, çıkış 0) + `karsilastir` modu ·
Ham veri: `docs/temizlik/sonuc/*.json` · Tasarım: `docs/mimari-temizlik.md` §5, §7 · AC: `docs/gereksinimler.md` §10.

> **Durum: tamam — AC-317..324 GEÇTİ.** K17 ölçümü `440aa07` üzerinde; AC-319 ve AC-321 K17'de **KALDI** idi,
> **PT-K18 düzeltmesiyle GEÇTİ** (`1374d99` Go, ardından web/server). K17'de "yapılmadı" kalan tam koşular K18'de
> koşuldu: `pnpm -r run lint`, `pnpm -r run typecheck`, `pnpm format:check` temiz; vitest server 1230/1230, web 386,
> contracts 142; Playwright tam koşu 443 geçti / 0 kırmızı / 200 atlandı; Go `go test -race ./...` 21 paket ok,
> staticcheck linux + windows 0. AC-322 grep teyidi: `desktopOnly` tek tanım (`e2e/helpers.ts`); sunucu testlerinde kalan
> yerel `signIn`/`login` tanımları K2'de gövde farkı gerekçesiyle bırakılanlar (PT-K2.md).

Yöntem: `test-db.sh up` ile kendi MySQL 8.4 konteyneri (`rs-pt-k17-2950ee`, `--max-connections=300`, iş sonunda silindi);
`TEST_DATABASE_URL` verildiği için betik kendi konteynerini açmadı. Kapsam adımı server (unit + entegrasyon), web vitest ve
contracts testlerini v8 kapsamıyla koşturdu; hepsi geçti.

## Özet

| AC     | Konu                  | Sonuç                         | Kısa kanıt                                                                                            |
| ------ | --------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| AC-317 | Test listesi eşitliği | **GEÇTİ** (liste)             | vitest 1230/386/142, playwright 643, Go 398/424 — sayı ve ad farkı 0; Playwright tam koşu 443/0 (K18) |
| AC-318 | Sözleşme yüzeyi       | **GEÇTİ**                     | `pt-surface` testleri yeşil; `prisma/` diff boş; `contracts/src` diff boş (K1 baseline'da)            |
| AC-319 | Kapsam düşmez         | **GEÇTİ** (K18)               | server/web/contracts satır, dal, işlev, ifade ≥ baseline; Go her paket ≥ baseline (K18, `1374d99`)    |
| AC-320 | Boyut / işlev / cx    | **GEÇTİ**                     | > 500 üretim 19 → 3 (contracts `requests.ts` + 2 Win32/medya); §5 hedef öğelerinin tamamı ≤ 60/cx 15  |
| AC-321 | Ölü kod               | **GEÇTİ** (K18)               | knip export 22 → **0**, tip 20 → **0** (hedef ≤ 19 / ≤ 15); Go deadcode windows **0**; i18n ölü 0     |
| AC-322 | Kopya                 | **GEÇTİ**                     | üretim klonu 25 → 2, toplam 70 → 16                                                                   |
| AC-323 | Statik analiz         | **GEÇTİ**                     | staticcheck 10 → 0 (linux + windows), go vet 0/0, CI'da (K16); lint/typecheck/format temiz (K18)      |
| AC-324 | İz ve sınır           | **GEÇTİ (2 gerekçeli sapma)** | 28 commit; dosya listesi dışı yalnız `DESIGN.md` (K13, K15c) ve `gereksinimler.md` (AC-321 revizyonu) |

## AC-317 — davranış eşdeğerliği (test listeleri)

| Liste                                | Baseline |   Son | Eksik | Not                                            |
| ------------------------------------ | -------: | ----: | ----: | ---------------------------------------------- |
| vitest server (unit + entegrasyon)   |    1 230 | 1 230 |     0 | hepsi geçti (kapsam koşusu)                    |
| vitest web                           |      386 |   386 |     0 | hepsi geçti                                    |
| vitest contracts                     |      142 |   142 |     0 | hepsi geçti                                    |
| Playwright `--list` (desktop+mobile) |      643 |   643 |     0 | ad karşılaştırması satır numarasından bağımsız |
| Go `go test -list` linux             |      398 |   398 |     0 |                                                |
| Go `go test -list` windows derleme   |      424 |   424 |     0 |                                                |

Ad kümeleri birebir aynı (`karsilastir` "eksik 0"; sayılar eşit olduğundan fazla da 0). Yüzey testleri (`pt-surface`)
K1'de baseline'dan önce eklendiği için iki listede de vardır. Test dosyası diff denetimi (assertion silinmedi/gevşetilmedi)
qa'nın işidir; burada yapılmadı.

## AC-318 — sözleşme

- `apps/server/test/integration/pt-surface.test.ts` ve `packages/contracts/test/pt-surface.test.ts`: kapsam koşusunda geçti
  (anlık görüntüler değişmedi).
- `git diff c661ea0..HEAD --stat -- apps/server/prisma/` → **boş** (şema, migration, `grants.sql`).
- `git diff c661ea0..HEAD --stat -- packages/contracts/src` → **boş**. K1 döngü kırma değişikliği (`c661ea0`: `api/{customers,requests,sessions}.ts`
  - yeni `api/shared.ts`, 4 dosya +74/−34) baseline'ın içindedir; contracts'ta başka değişiklik yok. `packages/contracts/package.json`
    yalnız K0 (`test:cov` + `@vitest/coverage-v8`).
- Env: `.env.example`, `deploy/` diff boş; `apps/server/src/env.ts` tek satır (`isWeakEncryptionKey` `export`'u kaldırıldı, K12) —
  env değişken kümesi aynı. `apps/agent-win/go.mod`/`go.sum` diff boş.

## AC-319 — kapsam (baseline → son)

| Paket     | Satır %         | Dal %           | İşlev %         | İfade %         |
| --------- | --------------- | --------------- | --------------- | --------------- |
| server    | 94,87 → 94,95   | 86,69 → 86,77   | 93,77 → 93,64 ↓ | 92,18 → 92,30   |
| web (lib) | 64,09 → 63,83 ↓ | 66,49 → 66,17 ↓ | 64,41 → 64,91   | 63,36 → 63,20 ↓ |
| contracts | 86,27 =         | 60,75 =         | 70,95 =         | 84,11 =         |

Yukarıdaki tablo K17 ara ölçümüdür (`440aa07`). **K18 sonrası** (aynı `test:cov`, baseline worktree'si aynı makinede yeniden
ölçüldü; baseline sayıları K0 ile aynı çıktı — server satır 94,88 / dal 86,60, web ve contracts birebir):

| Paket     | Satır %           | Dal %             | İşlev %           | İfade %           |
| --------- | ----------------- | ----------------- | ----------------- | ----------------- |
| server    | 94,87 → **95,16** | 86,69 → **86,85** | 93,77 → **94,22** | 92,18 → **92,53** |
| web (lib) | 64,09 → **64,42** | 66,49 → **66,54** | 64,41 → **65,38** | 63,36 → **63,81** |
| contracts | 86,27 =           | 60,75 =           | 70,95 =           | 84,11 =           |

Go (`go test -cover`, linux): düşenler `internal/signal` 84,8 → **83,7**, `internal/ui` 96,6 → 96,0, `internal/files` 96,8 → 96,7;
artanlar `api` +2,2, `rtc` +1,3, `launch` +0,8, `remember` +0,7, `request` +0,6, `diag` +0,5, `flow`/`input`/`tray` +0,1; diğerleri aynı.

Değerlendirme: baseline gürültüsü server ±0,05, Go `flow` ±0,2. Server işlev −0,13 ve Go `files` −0,1 sınırda; web satır/dal
(−0,26/−0,32) ve Go `signal` (−1,1), `ui` (−0,6) gürültünün dışında. Olası neden (doğrulanmadı): bölmede eklenen yeni, testsiz
dallar/işlevler paydayı büyütüyor (ör. K6 `ParseServer` → tip başına ayrıştırıcı tablosu; K14/K15 `lib/**` kancaları).
K17'de dosya bazında karşılaştırma yapılmamıştı; K18'de yapıldı (aşağıda).

**server / web / contracts — PT-K18 (dosya bazında inceleme; AC-319 GEÇTİ).** Yöntem: `git worktree` `c661ea0` (+ K0
`test:cov`/`@vitest/coverage-v8` paket satırları), iki kopyada `test:cov` (server: kendi MySQL 8.4 konteyneri, sıralı koşu),
`coverage-summary.json` dosya dosya karşılaştırması (testsiz satır/dal/işlev farkı). Bulgular — **mevcut testli satır kaybı yok**,
düşüş yeni testsiz satırların paydaya girmesinden:

- web (`lib/**` ölçülür): `lib/webrtc/use-tech-session.ts` (174 testsiz satır) K14'te `use-tech-session` 91 + `use-tech-peer` 55 +
  `use-tech-control` 50 = 196'ya bölündü (+22 testsiz; React kancası, node vitest ortamında çizilemez); `lib/use-focus-error.ts`
  (K15, 7 bileşendeki kopya odak kancası `lib`'e alındı) +11 testsiz satır — önce `components/`/`app/` içindeydi, ölçüm
  dışındaydı. `lib/dc/files.ts` → `file-model/-send/-receive/-disk` bölmesi testsiz satırı yalnız +3 artırdı. Kod sadeleştirmesi
  seçilmedi: kancalar tek yol (kopya giderme sonucu), içlerinde gereksiz savunma dalı yok.
  Telafi (yeni `it`/`describe` adı yok; mevcut testlerin sonuna assertion): `lib/dc/p5.test.ts` "teklifin idx alanıyla eşler…"
  (+ `dispose()` indirme adresini `revokeObjectURL` ile serbest bırakır), "sınır ALINAN bayt ile…" (+ kullanıcı iptali gelen yön:
  `cancelled` + `file.cancel` + CANCELLED; bitmiş alımda ikinci iptal/kabul/ret ve `dispose` yeni ctl üretmez);
  `lib/dc/p5-teklif.test.ts` "gönderen kendi teklif hızını sınırlar…" (+ bilinmeyen fid iptali etkisiz; `dispose` bekleyen teklifin
  zaman aşımını temizler → `timeout` olmaz).
- server: satır/dal K17'de de ≥ baseline idi; işlev −0,13'ün kaynağı `jobs/scheduler.ts` (K11 iş tablosu: iş başına
  `start/tick/delay` kapanışları, testsiz işlev 17 → 32) ve `signaling/control-grant.ts`, `app-hooks.ts` bölmeleri.
  Telafi: `test/unit/scheduler.test.ts` "AC-5: zamanlayıcı aralıkta tetikler; stop sonrası tetiklemez" testine (mevcut
  assertion'lar aynen) outbox + firma silme işli ikinci zamanlayıcı: açılış adımı (`recover`, `refreshMetrics`) 1 kez, ilk tur
  `OUTBOX_POLL_MS`'de, `stop()` sonrası yeni tur yok.
- contracts: `src` diff boş, sayılar birebir.

Test listeleri: vitest server 1230, web 386, contracts 142 — K18 öncesiyle aynı (yalnız mevcut `it` gövdelerine satır eklendi).

**Go — PT-K18 düzeltmesi (dosya bazında inceleme yapıldı; Go için AC-319 GEÇTİ).** Yöntem: baseline `c661ea0` worktree'si
ile çalışma kopyasında `go test -coverprofile` + blok bazında karşılaştırma (golang:1.26). Neden üç pakette de "test edilen
satırın paydadan çıkması" (bölme/kopya giderme), mevcut testli satır kaybı yok:

| Paket    | Baseline kapsanan/toplam (testsiz) | K17 (testsiz) | Neden                                                                                                                                                                    | Ek (mevcut Test işlevine satır)                                                              | Son      |
| -------- | ---------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | -------- |
| `signal` | 217/256 (39) 84,8                  | 206/246 (40)  | K6 tablo/ayrıştırıcı birleşmesi 10 testli ifadeyi azalttı; `checkMonitors` çıkarımı 1 yeni testsiz dal (`if err := checkMonitors(...)`); monitör dalları zaten testsizdi | `TestEncodeRejectsInvalidOutbound` +3 satır (17 monitör, `W: 0` monitör, `activeMonitor` 65) | **85,4** |
| `ui`     | 113/117 (4) 96,6                   | 95/99 (4)     | `fitBGR` alan toplamı `tray.AreaSum`'a taşındı (K kopya), `theme.go` yalnız-test işlevleri test dosyasına (`contrast_test.go`); testsiz 4 blok aynı                      | `TestAC98FitBGRNilAndSmall` + yükseklik sınırlı logo (`fitSize` `else` dalı)                 | **97,0** |
| `files`  | 60/62 (2) 96,8                     | 59/61 (2)     | `IsSanitized` yalnız testte → `export_test.go` (K7, AC-321); testsiz 2 blok aynı                                                                                         | `TestAC54AvailableNameNoOverwrite` + uzantı > 32 karakter çakışması                          | **98,4** |

Kod sadeleştirme seçilmedi: yeni testsiz tek dal (`signal` `validateShare` → `checkMonitors` hata dönüşü) kaldırılırsa denetim
sırası değişir (monitör hatası `activeMonitor`'dan önce). Son `go test -count=1 -cover ./...` (linux): **her paket ≥ baseline** —
api 85,9→88,1, autorun 94,4=, capture 97,1=, config 85,7=, control 96,4=, dc 94,3=, diag 81,3→81,8, env 100=, files 96,8→98,4,
flow 84,3→84,4, input 95,1→95,2, launch 85,5→86,3, pairing 100=, remember 91,2→91,9, request 83,9→84,5, rtc 84,6→85,9,
signal 84,8→85,4, transfer 78,3=, tray 95,6→95,7, ui 96,6→97,0. Test listeleri (baseline worktree ↔ çalışma kopyası, aynı
yöntem): `go test -list .` linux 398 = 398, Windows derleme (`GOOS=windows go test -c` + `go tool nm`) 458 = 458, ad farkı 0;
yeni `TestXxx` yok.

## AC-320 — boyut, işlev uzunluğu, karmaşıklık

| Ölçüt (üretim)    | server  | web       | contracts | Go      |
| ----------------- | ------- | --------- | --------- | ------- |
| > 300 satır dosya | 24 → 9  | 20 → 0    | 9 → 9     | 25 → 9  |
| > 500 satır dosya | 8 → 0   | 3 → 0     | 1 → 1     | 8 → 2   |
| > 40 satır işlev  | 99 → 39 | 174 → 109 | 0 → 0     | 53 → 15 |
| > 80 satır işlev  | 23 → 1  | 95 → 50   | 0 → 0     | 7 → 0   |
| > 150 satır işlev | 6 → 0   | 35 → 5    | 0 → 0     | 1 → 0   |
| cx > 15           | 42 → 16 | 66 → 25   | 2 → 2     | —       |

- **> 500 üretim dosyası: 19 → 3** (hedef ≤ 5): contracts `api/requests.ts` 981, Go `win/win_windows.go` 597,
  `capture/mf_windows.go` 537 — üçü de AC'de adı geçen izinli kalanlar.
- **§5 hedef listesi:** listede adı geçen dosya ve işlevlerin tamamı hedefte; > 60 satır kalan işlevlerin hiçbiri §5'te
  adı geçen öğe değil, cx > 15 kalanların da. Gerekçeli istisnalar: K6 `flow/messages.go` `classify` cx 17 (PT-K6.md),
  K9 `requests/service.ts` 469 satır (PT-K9.md). Go > 60 kalanlar yalnız kapsam dışı Win32/medya dosyalarında
  (`source.run` 75, `encoder.configure` 61, `encoder.processOutput` 61).
- **Yeni > 300 satırlık üretim dosyası:** yok (web 0; server'da kalan 9 dosyanın hepsi baseline'da > 300 idi:
  `requests/service.ts` 469 [istisna], `signaling/rooms.ts` 417, `requests/messages.ts` 398, `notify/outbox.ts` 387,
  `notify/whatsapp.ts` 387, `requests/hours.ts` 351, `settings/system.ts` 339, `requests/blocks.ts` 338, `requests/hub.ts` 322).
  Not: bu son cümle baseline `liste300` ile dosya dosya karşılaştırılarak teyit edilmedi (yapılmadı).

### Sonra (görev listesi dışı; dokunulmadı, "dokunan böler" kuralı §9)

Kaynak: PT-K12.md "Kalan", PT-K14.md §4.3, PT-K15.md §4-13, PT-K15c.md 3. tur, son ölçüm.

- server > 60: `supportRequestRoutes` 96, `seedPerfSessions` 78, `adminSettingsRoutes` 77, `outbound.postJson` 75,
  `createSupportSession` 74, `sendSessionLink` 70 / cx 20, `adminTenantRoutes` 70, `cli/crypto.ts main` 67 / cx 26,
  `createBlock` 67, `auth login` 66 / cx 22, `createMetrics` 65, `resolvePublicSession` 64, `runResetSuperadmin` 63,
  `mail deliver` 63, `emailSessionLink` 63; cx: `classifyMysqlError` 24, `parseLedgerLine` 21, `historyWhere` 17 vb.
- web > 60 (59 işlev; en büyükler): `MfaSetup` 169, `SessionSendLink` 160, `PermissionMatrix` 159, `JoinForm` 155,
  `NewSessionDialog` 153 / cx 24, `CustomerPage` 149, `useGuestSession` 148, `StepUpDialog` 146, `SessionList` 145,
  `SessionsView` 145, `RequestNotifier` 144, `HistoryPage` 139 / cx 30, `AuditPage` 123 / cx 36, `ControlButton` 103 / cx 31,
  `api.ts send` cx 25. Tam liste: `sonuc/fonksiyon.json`.
- Kod tekrarı adayı: `lib/users/form.ts` ↔ `lib/admin-settings/forms.ts` `splitServerFields` ikizi (PT-K15c).

## AC-321 — ölü kod

| Ölçüt                                   | Baseline       | Son                          | Hedef      | Sonuç |
| --------------------------------------- | -------------- | ---------------------------- | ---------- | ----- |
| knip kullanılmayan export (server+web)  | 96 + 101 = 197 | 0 + 0 = **0** (K18; K17: 22) | ≤ 19       | GEÇTİ |
| knip kullanılmayan tip (server+web)     | 83 + 72 = 155  | 0 + 0 = **0** (K18; K17: 20) | ≤ 15       | GEÇTİ |
| Go deadcode windows (`-test`)           | 3              | **0** (K18)                  | 0          | GEÇTİ |
| Go deadcode linux (`-test`)             | 7              | 4 (K18)                      | —          | bilgi |
| Go yalnız testte erişilen üretim işlevi | 7              | **0**                        | 0          | GEÇTİ |
| i18n ölü aday                           | 27             | 8                            | 0 (gerçek) | GEÇTİ |

- **knip (K18):** K17'de kalan 22 export + 20 tipin tamamı "yalnız tanımlandığı dosyada kullanılıyor" türüydü; `export`
  anahtar sözcüğü kaldırıldı (mekanik dönüşüm, §1 madde 4). knip giriş noktaları test dosyalarını da içerdiğinden hiçbiri test
  veya başka modülce import edilmiyordu; ayrıca `git grep -w` ile teyit edildi (`turnCredential` testlerde yalnız maske anahtarı
  metni, `parseFrame`/`revokeControl`/`TechState` aynı adlı başka dosya-yerel tanımlar). Yeniden dışa aktarımlar listeden
  çıkarıldı: server `lib/csv.ts` `CSV_SEPARATOR` (contracts'taki tanım ve contracts yüzeyi aynı), web `lib/dc/files.ts`
  `TransferStatus` (tip `file-model.ts`'te dışa açık kalır, `file-receive.ts` oradan alır). Gerekçeli kalan: **yok**
  (K11 "graphify teyitsiz" 5 ad ve K15c `theme-provider` 3 ad dahil hepsi budandı). Test yardımcılarındaki bulgular
  (server-test 1 export + 6 tip, web-test 16 export + 1 tip) AC sayımı dışında (üretim kodu değil; dokunulmadı).
  Ölçüm: `scripts/pt-olcum.sh <dizin> knip` → `server.exports`/`server.types`/`web.exports`/`web.types` anahtarları yok (0).
- **deadcode:** K17'de kalan 2 (windows) `capture/select_test.go fakeGrabber.rotation/cursor` K18'de kaldırıldı: testlerde
  hiç çağrılmıyorlardı (yalnız Windows `source.run` çağırır, o da sahteyi kullanmaz); `grabber` arayüzü gereği sahteye gömülü
  `grabber` (nil) eklendi, yanlışlıkla çağrılırsa panikler. `deadcode -test` ve testsiz `deadcode` (windows) **0**;
  `SameRegistration` silindi (K5). Linux'taki 4 (`Client.HTTPClient`, `WSConn.Send/Close`, `Peer.SetICEServers`) Windows
  yolundan çağrılır (PT-K4.md).
- **i18n:** 19 ölü anahtar silindi (PT-K15c, iki yoldan teyit). Ölçümün saydığı 8 aday (`us.r.*`, `us.m.*`) `users/[id]/user-dialogs.tsx`'te
  değişken önekle (``t(`${k}.title`)``) kullanılıyor — gerçek ölü 0. Dinamik aday 145 → 153 (ölçüm sezgiseli; dokunulmadı).
- knip diğer: `@types/smtp-server` kaldırıldı (K16); `@prisma/client` yanlış pozitif, `postcss`/`server-only` unlisted ve contracts
  duplicate baseline ile aynı.

## AC-322 — kopya (jscpd ≥ 8 satır, ≥ 70 belirteç)

| Ölçüt         | Baseline | Son | Hedef | Sonuç |
| ------------- | -------: | --: | ----: | ----- |
| Üretim klonu  |       25 |   2 |   ≤ 5 | GEÇTİ |
| Toplam klon   |       70 |  16 |  ≤ 25 | GEÇTİ |
| Üretim satırı |      418 |  40 |     — |       |

Kalan üretim klonlarından biri Go `Dir.Rename` ↔ `reparse.go` (yapı etiketiyle ayrık, PT-K7.md). e2e `desktopOnly` tek tanım (K3),
sunucu entegrasyon `signIn`/`boot`/`errorText`/`login` dosya-yerel tanımları kaldırıldı (K2) — commit notlarına göre; burada
ayrıca grep ile teyit **yapılmadı**.

## AC-323 — statik analiz

| Denetim                     | Sonuç                                               |
| --------------------------- | --------------------------------------------------- |
| staticcheck linux / windows | 10 / 10 → **0 / 0**                                 |
| go vet linux / windows      | 0 / 0                                               |
| staticcheck Go CI'da        | evet — `agent-win.yml` `check` işi (K16, `d49f4ee`) |
| `pnpm -r run lint`          | **yapılmadı** (bu turda)                            |
| `pnpm -r run typecheck`     | **yapılmadı**                                       |
| `pnpm format:check`         | **yapılmadı**                                       |

## AC-324 — iz ve sınır

`c661ea0..HEAD` 28 commit, her biri `PT-Kn` etiketli. Her commit'in dosyaları §5 görev listesiyle (+ `docs/implementation.md`,
`docs/temizlik/PT-Kn.md`) otomatik karşılaştırıldı; liste dışı yalnız:

- `DESIGN.md` — K13 (`1952218`: `SettingsSection`, `DirtyBar`, `PhoneTestRow` satırları) ve K15c (`440aa07`: `ListPageSkeleton`
  notu). Gerekçe: ortak standart 1.8 "yeni bileşen eklendiğinde DESIGN.md güncellenir"; yalnız belge.
- `docs/gereksinimler.md` — `8a520c7` AC-321 eşik revizyonu (belge, kod değil).

PT bulguları her görev notunda "PT bulguları" başlığıyla yazıldı (aşağıda toplu); hiçbiri düzeltilmedi.

## PT bulguları (toplu; düzeltilmedi — ayrı `fix:` işi)

| #          | Bulgu                                                                                                                                                             | Kaynak       | Öneri / sahip                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------- |
| PT-K11-B1  | `jobs/scheduler.ts` saklama işi `stop()` sonrası, o an süren turun `.finally`'sinde yeniden zamanlayıcı kuruyor (diğer işler `stopped` bayrağını denetler). Düşük | PT-K11.md    | backend-dev `fix:`                        |
| PT-K15c-B1 | `ConsentForm` 400 `body` hatasında textarea o an `disabled` olduğu için odak etkisiz kalıyor (eski davranış, aynen korundu)                                       | PT-K15c.md   | frontend-dev `fix:`                       |
| Kararsız-1 | e2e `p13bl-lobby.spec.ts` AC-305 — ara sıra kırmızı (mobile/desktop); `--repeat-each=3` 1/6 kırmızı                                                               | PT-K14, K15b | test kararlılığı işi                      |
| Kararsız-2 | e2e `p5-collab` TEST-P5-1 (`desktop-rtc`, dosya teklifi `offered` yerine `rejected`) — tekrar koşuda 3/3 geçti                                                    | PT-K15c      | test kararlılığı işi                      |
| Kararsız-3 | entegrasyon `customers-csv-p19` AC-263 (5 000 satır ≤ 30 sn) — yük altında 33–35 sn; bu ölçümde geçti                                                             | PT-K9        | perf eşiği / CI makinesi                  |
| Elle test  | Windows duman testi (K8): `--tray` açılışı ve ikinci örnek, tepsi kutuları, çoklu firma ana ekranı, talep formu + bekleme, logo/tema, kod oturumu ekranları       | PT-K8.md     | test-operatoru (Windows VM, A–H grupları) |

## Test koşuları

| Koşu                                               | Sonuç                                                       |
| -------------------------------------------------- | ----------------------------------------------------------- |
| server unit + entegrasyon (v8 kapsamlı, MySQL 8.4) | 1 230 / 1 230 geçti (konteyner `rs-pt-k17-2950ee`, silindi) |
| web vitest                                         | 386 / 386 geçti                                             |
| contracts vitest                                   | 142 / 142 geçti                                             |
| Go `go test -cover ./...` (linux, golang:1.26.11)  | geçti (betik çıkışı 0)                                      |
| `pnpm -r run lint` / `typecheck` / `format:check`  | **yapılmadı**                                               |
| web e2e (Playwright koşusu)                        | **yapılmadı** (yalnız `--list`)                             |
| Go `go test -race ./...` + staticcheck ayrı koşu   | **yapılmadı** (staticcheck ölçüm adımında 0/0)              |

## Kalan iş (K17'yi kapatmak için)

1. ~~lint, typecheck, format:check, tam e2e, Go `-race`~~ — K18'de koşuldu, temiz.
2. ~~AC-319~~ — K18'de kapandı (server/web/contracts ve Go).
3. ~~AC-321~~ — K18'de kapandı (knip 0/0, Go deadcode windows 0).
4. ~~AC-322 grep teyidi~~ — yapıldı (Durum notu).
