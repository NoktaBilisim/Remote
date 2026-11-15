# PT kapanış ölçümü (PT-K17) — KISMİ

Tarih: 2026-11-15 · Ölçülen kod: **`440aa07`** (dal `pt-wip`, temiz çalışma kopyası) · Baseline: **`c661ea0`**
(`docs/temizlik/baseline.md`, `baseline/*.json`) · Betik: `scripts/pt-olcum.sh` (tüm adımlar, çıkış 0) + `karsilastir` modu ·
Ham veri: `docs/temizlik/sonuc/*.json` · Tasarım: `docs/mimari-temizlik.md` §5, §7 · AC: `docs/gereksinimler.md` §10.

> **Durum: kısmi.** Tur sınırı nedeniyle ölçüm + karşılaştırma tamamlandı; aşağıdaki "yapılmadı" işaretli tam koşular
> (lint, typecheck, format:check, ayrı e2e, Go `-race`) ve kapsam düşüşlerinin dosya bazında incelemesi **yapılmadı**.
> AC-319 ve AC-321 şu an **KALDI** (ayrıntı aşağıda).

Yöntem: `test-db.sh up` ile kendi MySQL 8.4 konteyneri (`rs-pt-k17-2950ee`, `--max-connections=300`, iş sonunda silindi);
`TEST_DATABASE_URL` verildiği için betik kendi konteynerini açmadı. Kapsam adımı server (unit + entegrasyon), web vitest ve
contracts testlerini v8 kapsamıyla koşturdu; hepsi geçti.

## Özet

| AC     | Konu                  | Sonuç                         | Kısa kanıt                                                                                            |
| ------ | --------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| AC-317 | Test listesi eşitliği | **GEÇTİ** (liste)             | vitest 1230/386/142, playwright 643, Go 398/424 — sayı ve ad farkı 0; Playwright koşusu yapılmadı     |
| AC-318 | Sözleşme yüzeyi       | **GEÇTİ**                     | `pt-surface` testleri yeşil; `prisma/` diff boş; `contracts/src` diff boş (K1 baseline'da)            |
| AC-319 | Kapsam düşmez         | **KALDI** (inceleme ister)    | web satır −0,26 / dal −0,32; Go `internal/signal` −1,1, `internal/ui` −0,6                            |
| AC-320 | Boyut / işlev / cx    | **GEÇTİ**                     | > 500 üretim 19 → 3 (contracts `requests.ts` + 2 Win32/medya); §5 hedef öğelerinin tamamı ≤ 60/cx 15  |
| AC-321 | Ölü kod               | **KALDI**                     | knip export 22 (hedef ≤ 19), tip 20 (hedef ≤ 15); deadcode 2 (yalnız test sahtesi); i18n ölü 0        |
| AC-322 | Kopya                 | **GEÇTİ**                     | üretim klonu 25 → 2, toplam 70 → 16                                                                   |
| AC-323 | Statik analiz         | **Kısmi**                     | staticcheck 10 → 0 (linux + windows), go vet 0/0, CI'da (K16); lint/typecheck/format koşusu yapılmadı |
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

Go (`go test -cover`, linux): düşenler `internal/signal` 84,8 → **83,7**, `internal/ui` 96,6 → 96,0, `internal/files` 96,8 → 96,7;
artanlar `api` +2,2, `rtc` +1,3, `launch` +0,8, `remember` +0,7, `request` +0,6, `diag` +0,5, `flow`/`input`/`tray` +0,1; diğerleri aynı.

Değerlendirme: baseline gürültüsü server ±0,05, Go `flow` ±0,2. Server işlev −0,13 ve Go `files` −0,1 sınırda; web satır/dal
(−0,26/−0,32) ve Go `signal` (−1,1), `ui` (−0,6) gürültünün dışında. Olası neden (doğrulanmadı): bölmede eklenen yeni, testsiz
dallar/işlevler paydayı büyütüyor (ör. K6 `ParseServer` → tip başına ayrıştırıcı tablosu; K14/K15 `lib/**` kancaları).
**Yapılmadı:** dosya bazında kapsam karşılaştırması (baseline `c661ea0` worktree'sinde json-summary per-file) ve düşüşün
"mevcut test edilen satır kaybı mı, yeni testsiz satır mı" ayrımı. Bu ayrım yapılmadan AC-319 KALDI sayılır.

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

| Ölçüt                                   | Baseline       | Son             | Hedef      | Sonuç     |
| --------------------------------------- | -------------- | --------------- | ---------- | --------- |
| knip kullanılmayan export (server+web)  | 96 + 101 = 197 | 14 + 8 = **22** | ≤ 19       | **KALDI** |
| knip kullanılmayan tip (server+web)     | 83 + 72 = 155  | 8 + 12 = **20** | ≤ 15       | **KALDI** |
| Go deadcode windows (`-test`)           | 3              | 2               | 0          | bkz. not  |
| Go deadcode linux (`-test`)             | 7              | 6               | —          | bilgi     |
| Go yalnız testte erişilen üretim işlevi | 7              | **0**           | 0          | GEÇTİ     |
| i18n ölü aday                           | 27             | 8               | 0 (gerçek) | GEÇTİ     |

- **knip kalanları** (hepsi "yalnız tanımlandığı dosyada kullanılıyor, `export` gereksiz" türü; grep ile başka dosyada
  kullanımı yok, `turnCredential` test dosyalarında metin olarak geçiyor): server export — `lib/csv.ts CSV_SEPARATOR`
  (yeniden dışa aktarım), `signaling/collab.ts` ×5 (`FILE_META_PER_SESSION`, `FILE_META_ACCEPTED_PER_SESSION`,
  `QUALITY_MIN_INTERVAL_MS`, `QUALITY_MAX_BYTES`, `isCheckViolation`), `handlers.ts parseFrame`, `turn.ts turnCredential`,
  `jobs/retention.ts failureClass`, `customers/csv-export.ts customerCsvCells`, `file-meta-store.ts` ×2, `control-revoke.ts revokeControl`,
  `ws-auth.ts RECONNECT_CONFLICT_AUDIT_MS`; server tip — `QualityResult`, `WaitingSession`, `RoomsDeps`, `TechnicianLiveControl`,
  `OrphanScanDeps`, `TenantPurgeDeps`, `AdmitResult`, `RequestResult`; web export — `theme-provider.tsx` ×3, `lobby-notifier useLobby`,
  `csv-export-button fileNameFrom`, `history-list SourceNote`, `customer-list LinkCell`, `lib/dc/file-model DEFAULT_MAX_FILE_BYTES`;
  web tip — `ToastOptions`, `NotifierEvent` ve **PT'nin yeni dosyalarında oluşan 10 tip** (`lib/dc/files.ts TransferStatus`,
  `use-audit-filters Draft`, `use-history-filters Draft/Errors/TechState`, `use-request-queue QueueFilter`, `tenant-status-dialog StatusAction`,
  `console-stage DrawState`, `stage-strip StripView/StripFit`).
  Gerekçe yazılmış olanlar: K11 5 ad ("graphify teyitsiz, dokunulmadı"), K15c `theme-provider` 3 ad ("görev maddesi yalnız lib").
  Diğerlerinin gerekçesi yok. Hedefe inmek için en az 3 export + 5 tip daha budanmalı (ör. yeni oluşan 10 tip) — **kod işi,
  ilgili göreve (K10/K14/K15) geri dönmeli**; K17 kod değiştirmez.
- **deadcode:** kalan 2 (windows) `capture/select_test.go fakeGrabber.rotation/cursor` — test dosyasındaki sahte nesnenin
  arayüz yöntemleri, üretim kodu değil; `SameRegistration` silindi (K5). Linux'taki ek 4 (`Client.HTTPClient`, `WSConn.Send/Close`,
  `Peer.SetICEServers`) Windows yolundan çağrılır (PT-K4.md). AC "deadcode 0" metninin test sahtesini kapsayıp kapsamadığı qa kararıdır.
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

1. lint, typecheck, format:check, tam e2e, Go `-race` koşuları.
2. AC-319: dosya bazında kapsam karşılaştırması (web `lib/**`, Go `signal`, `ui`); gerekirse ilgili göreve test eklemesi için dönüş.
3. AC-321: knip export 22 → ≤ 19, tip 20 → ≤ 15 (kod görevi: K10/K14/K15) ve kalanların tek tek gerekçesi.
4. AC-322 grep teyidi (K2/K3 yerel yardımcı tanımları).
