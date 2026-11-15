# PT-K11 — app.ts + jobs + customers + lib/csv temizliği (backend-dev)

Tasarım: `docs/mimari-temizlik.md` §5 PT-K11 (+ §1–4, §6). AC: `docs/gereksinimler.md` §10 (AC-320, AC-321, AC-322, AC-324).
Davranış değişmez: rota/eklenti kayıt sırası, kanca (onReady/onClose/onRequest) sırası, audit eylem/alanları, metrik
adları/etiketleri, log nesneleri ve mesajları, TX sınırları ve yeniden deneme kapsamı aynen. Yeni bağımlılık yok. Commit yapılmadı.

## Değişen / yeni dosyalar (hepsi görev listesinde)

| Dosya                                | Önce → sonra (satır) | İş                                                                                                                                                                                                                                             |
| ------------------------------------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/app.ts`             | 442 → 254            | `buildApp` 259 → 23 satır: `decorateCore`, `netguardFor`, `createMail`, `decorateIo`, `decorateRooms`; Fastify modül genişletmesi ve `AppDeps` yerinde                                                                                         |
| `src/app-routes.ts` (yeni)           | — → 106              | `registerRoutes` → `registerCoreRoutes` + `registerAdminRoutes` (34 `register` çağrısı **aynı sırayla**); `helmetOptions` buraya taşındı                                                                                                       |
| `src/app-hooks.ts` (yeni)            | — → 241              | Talep/bildirim kurulumu (`decorateRequests`, `createNotifier`, `decorateOutbox`), işler (`decorateJobs`, `createTenantPurge`, `accountDeps`), `addStartupJobs` (açılış onReady + zamanlayıcı), `addRequestHooks` (hata zarfı, JSON, başlıklar) |
| `jobs/scheduler.ts`                  | 161 → 197            | `startScheduler` 131 → 28: **iş tablosu** (`TimedJob`: `start`/`tick`/`delay`/`stoppable`; `retentionJob`, `orphanScanJob`, `tenantPurgeJob`, `outboxJob`) + ortak `startTimedJob`; `requestSweeper`, `sessionExpiry`. İmza aynı               |
| `jobs/retention.ts`                  | 323 → 274            | `runOnce` 62/cx 19 → `runTenant`, `runGlobal`, `recordMetrics`; teyitli 8 export/tip `export`'suz                                                                                                                                              |
| `jobs/retention-counts.ts` (yeni)    | — → 72               | Sayaç tipleri, sıfır değerleri, `KINDS`, `PURGE_KEYS`/`isPurgeKey`/`candidateName`, `sum`                                                                                                                                                      |
| `jobs/orphan-scan.ts`                | 143 → 168            | `runOnce` 57 → akış + `circuitOpen`, `removeExpired`, `removeOldTmp`, `recordSuccess`; teyitli 4 export `export`'suz                                                                                                                           |
| `jobs/tenant-purge.ts`               | 306 → 287            | Hata sınıflandırması taşındı; teyitli 3 export/tip `export`'suz                                                                                                                                                                                |
| `jobs/tenant-purge-errors.ts` (yeni) | — → 24               | `FsStepError`, `isFkError`, `classifyPurgeError`                                                                                                                                                                                               |
| `jobs/tenant-purge-repo.ts`          | 336 → 287            | Tablo parçası kurucuları taşındı; `OPEN_STATES` `export`'suz. `DATA_STEPS` (testler import eder) yerinde                                                                                                                                       |
| `jobs/tenant-purge-parts.ts` (yeni)  | — → 57               | `byTenant`, `byTenantUser`, `unlinkBindings`, `USERS_OF`, `n`, `TablePart`; `PURGE_BATCH` (export'suz)                                                                                                                                         |
| `jobs/retention-repo.ts`             | 229 → 229            | Teyitli 5 export/tip `export`'suz (gövde değişmedi; testlerin `vi.mock`'u aynı modülde)                                                                                                                                                        |
| `customers/service.ts`               | 586 → 200            | Yazma uçları + işler kaldı; TX gövdeleri `write-tx.ts`'e, görünümler `view.ts`'e, okuma uçları `read.ts`'e. `$transaction` + `withTxRetry` çağrıları burada                                                                                    |
| `customers/write-tx.ts` (yeni)       | — → 271              | `insertCustomerTx` (+ `insertData`), `updateCustomerTx` (+ `mergeFields`), `rotateRefTx`, `deactivateTx` (+ `cancelPendingTx`), `reactivateTx`, `PII`                                                                                          |
| `customers/view.ts` (yeni)           | — → 88               | `link`, `listItem`, `detail`, `auditFields`, `who`, `nameConflict`, `ENTITY`                                                                                                                                                                   |
| `customers/read.ts` (yeni)           | — → 135              | `listCustomers`, `getCustomer`, `customerOptions`, `generalLink`, `customerRequests`, `customerSessions` (gövdeler aynen)                                                                                                                      |
| `customers/csv-import.ts`            | 472 → 226            | `previewImport` 99/cx 30 → `parseUpload` + `mapHeader` + `addRecord`; `commitImport` 166 → 32 (`planImport` + `applyCreates`/`applyUpdates`); `readCsvUpload` cx 17 → `uploadError`                                                            |
| `customers/import-rows.ts` (yeni)    | — → 162              | Sütun eşleme tabloları, `viaSchema`, `checkField`, `mapHeader`, `readFields`, `addRecord`                                                                                                                                                      |
| `customers/import-apply.ts` (yeni)   | — → 179              | `chunks`, `createRow`, `insertBatchTx`, `applyCreates`, `updateOneTx`, `updateBatchTx`, `applyUpdates`                                                                                                                                         |
| `customers/csv-export.ts`            | 95 → 102             | `exportCustomersCsv` 49 → iç üreteç modül düzeyi `exportStream`'e; `CustomerCsvExport` `export`'suz                                                                                                                                            |
| `customers/routes.ts`                | 190 → 202            | `customerRoutes` 117 → `csvRoutes` + `previewRoute`, `firmRoutes`, `actionRoutes`, `tabRoutes` (kayıt sırası aynı); import satırı `read.ts`                                                                                                    |
| `customers/repo.ts`                  | 183 → 179            | Kullanılmayan `countActive` silindi (knip teyitli, hiçbir yerde çağrılmıyor)                                                                                                                                                                   |
| `lib/csv.ts`                         | 165 → 183            | `parseCsv` 98/cx 27 → durum makinesi: `readRecord` + `quotedStep` + `plainStep` (`RecordState`), `nextLineStart`, `pushRecord`, `failRecord`; `CsvRecord`/`CsvParseResult` `export`'suz                                                        |

## Ölçüm

ESLint (`scripts/pt-olcum.sh` ile aynı kurallar: işlev > 40 satır boş/yorum hariç, karmaşıklık > 15), görev dosyaları:
**önce 24 uyarı → sonra 0** (`buildApp` 259/cx 16, `startScheduler` 131, `parseCsv` 98/cx 27, `previewImport` 99/cx 30,
`commitImport` 166 + 3 iç işlev, `readCsvUpload` cx 17, `customerRoutes` 117, `exportCustomersCsv` 49, service.ts 7 işlev,
`orphan-scan` `runOnce` 57, `retention` `runOnce` 62/cx 19 → hepsi ≤ 40 / ≤ 15). Gerekçeli istisna yok.

Dosya boyu: görevdeki > 300 satırlık 6 dosya (app.ts 442, customers/service.ts 586, csv-import.ts 472, retention.ts 323,
tenant-purge.ts 306, tenant-purge-repo.ts 336) → **0**; en büyük `jobs/tenant-purge.ts` / `tenant-purge-repo.ts` 287.

knip (`scripts/pt-olcum.sh <dizin> knip`): baseline'daki K11 teyitli 26 aday (export 14 + tip 12) → **0** (25'i `export`
kaldırıldı/iç modüle taşındı, `countActive` silindi). Görev dosyalarında kalan 5 knip bulgusu graphify teyitsiz olduğu
için dokunulmadı: `retention.ts failureClass`, `lib/csv.ts CSV_SEPARATOR` (yeniden dışa aktarım), `csv-export.ts
customerCsvCells`, `OrphanScanDeps`, `TenantPurgeDeps`. (Baseline'daki `classifyPurgeError` artık `tenant-purge.ts`
tarafından kullanıldığı için bulgu değil.) Yeni dosyalarda knip bulgusu yok.
jscpd (≥ 8 satır, ≥ 70 belirteç): görev dosyalarında klon önce 0, sonra 0.

## Doğrulama (2026-11-15, çalışma kopyası `pt-wip`)

| Adım                                                                                                                                                                         | Sonuç                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @remote/server typecheck` (`tsc --noEmit`)                                                                                                                    | 0 hata                                                                                                                                                   |
| `pnpm --filter @remote/server lint` (`eslint .`)                                                                                                                             | 0 hata                                                                                                                                                   |
| Prettier (yalnız değişen/yeni 23 dosya)                                                                                                                                      | temiz                                                                                                                                                    |
| Unit `pnpm --filter @remote/server test`                                                                                                                                     | 30 dosya, 434/434 geçti                                                                                                                                  |
| Entegrasyon `test:int` (MySQL 8.4, `test-db.sh up`, `--max-connections=300`, konteyner `rs-pt-k11-ed5f9c`, silindi)                                                          | 79 dosya, **796/796** geçti — `pt-surface.test.ts` rota tablosu anlık görüntüsü değişmeden geçti; `customers-csv-p19` (AC-263 5 000 satır ≤ 30 sn) dahil |
| Test listesi (`vitest list`, unit + entegrasyon) önce ↔ sonra                                                                                                                | 1619 = 1619, fark yok                                                                                                                                    |
| `parseCsv` eşdeğerlik denemesi (scratchpad, repoya girmedi): eski ↔ yeni, 300 000 rastgele girdi (`"`, `""`, `;`, `,`, CR/LF/CRLF, BOM; rastgele `maxRows`/`maxRecordChars`) | 0 fark (sonuç nesnesi ve `CsvTooManyRowsError` birebir)                                                                                                  |

R-PT1 çağrı sayımı (görev dosyaları + yeni dosyalar, HEAD ↔ çalışma kopyası):

| Çağrı                                          |    Önce |   Sonra |
| ---------------------------------------------- | ------: | ------: |
| `writeAudit(`                                  |      18 |      18 |
| `.inc(` (metrik)                               |       9 |       9 |
| `.gauge(` / `.counter(`                        |   9 / 3 |   9 / 3 |
| log (`log.info/warn/error`)                    |      32 |      32 |
| `$transaction(`                                |      18 |      18 |
| `addHook(` / `decorate(Request)(`              | 14 / 25 | 14 / 25 |
| `.register(` / rota (`get/post/patch`)         | 34 / 14 | 34 / 14 |
| `new AppError(`                                |      19 |      19 |
| `setTimeout(` / `clearTimeout`+`clearInterval` |   4 / 5 |   1 / 2 |
| `throw `                                       |      50 |      48 |

Zamanlayıcı satırları iş tablosunda tek `startTimedJob`'a toplandığı için azaldı (4 kopya → 1); `throw` farkı
`readCsvUpload`'ın catch dalındaki 3 `throw`'un `uploadError` içinde `return` + tek `throw uploadError(err)` olmasından.
Dizgi sabitleri (audit eylemi, metrik adı, log mesajı, hata kodu, yol) kümesi: kayıp yok (yalnız yeni yorumlardaki ifadeler eklendi).

## Tasarımdan sapmalar / yorumlar (gerekçeli)

1. **`app-hooks.ts` kapsamı.** Görev tanımı "app-routes.ts (rota kaydı) + app-hooks.ts" diyor; yalnız kancaları taşımak
   `app.ts`'i 418 satırda bırakıyordu ve görev yeni dosyayı yalnız bu iki adla sınırlıyor. Bu yüzden `app-hooks.ts`
   kurulumun ikinci yarısını da (talep/bildirim servisleri ve arka plan işleri; her biri kendi onReady/onClose kancasıyla)
   içeriyor. `buildApp` bu işlevleri orijinal ifade sırasıyla çağırır: decorate/kanca/gauge sırası birebir aynı (her
   işlevde kendi bölümünün ifadeleri ardışık ve aynı sırada). `RequestHub` geri çağrısının `requests`'e başvurusu aynı
   işlev kapsamında kaldı (önceki gibi geç bağlama).
2. **Taşıma kuralı (§1-3) yorumu — `customers/read.ts`.** Okuma uçları (`listCustomers` …) dışa açıktı ama yalnız
   `customers/routes.ts` (bu görevin dosyası) kullanıyordu; `read.ts`'e taşındı ve yalnız `routes.ts`'in import satırı
   değişti (PT-K10 sapma 1 ile aynı yorum). Görev dışından import edilen adlar yerinde: `sweepCustomerPassive`,
   `anonymizeCustomersOf` (`service.ts`), `DATA_STEPS` (`tenant-purge-repo.ts`), `tenantFiles` (`tenant-purge.ts`),
   `SESSION_BATCH`, `RetentionJob`, `nextOrphanScanAt`, `OrphanScanJob`, `TenantPurgeRunner`, `registerPurgeMetrics`,
   `withTxRetry`, `ImportPreviewStore`, lib/csv yeniden dışa aktarımları.
3. **Mock uyumu.** Entegrasyon testleri `jobs/retention-repo.ts` ve `requests/repo.ts`'i `vi.mock` ile sarıyor; bu
   modüllerin işlevleri taşınmadı, çağıranlar aynı modül yolundan import eder (mock etkisi aynı).
4. **Zamanlayıcı iş tablosu** (`scheduler.ts`): saklama işinin yeniden kurulumu `stopped` denetlemiyordu; tabloda
   `stoppable: false` ile **aynen korundu** (bkz. PT bulguları). Açılış adımları (`orphanScan.init` → kur,
   `tenantPurge.refreshMetrics` + hemen kur, `outbox.recover` → kur) ve sıra (saklama, yetim, firma silme, outbox,
   sonra 30 sn aralığı) aynı. `startScheduler` imzası (testler konumsal argümanla çağırır) değişmedi.
5. **Bağlam nesneleri** (`Wiring`/`RequestWiring` — app.ts/app-hooks.ts; `RecordState` — csv.ts; `PreviewAcc` —
   import-rows.ts; `ImportActor` — import-apply.ts) yalnız önceden kapanış/yerel değişken olan değerleri taşır; yeni durum yok.
   TX içindeki `now` ve `newTenantRef()` hâlâ TX geri çağrısı içinde üretilir (yeniden denemede yeni değer, önceki gibi);
   içe aktarma partisinin `ids`'i yeniden deneme dışında (önceki gibi).

## P27 / P28 için sınırlar

- Yeni periyodik iş → `scheduler.ts` tablosuna bir `TimedJob` satırı (`start`/`tick`/`delay`/`stoppable`).
- Yeni servis/decorate → `app.ts` (`decorate*`) ya da `app-hooks.ts` (talep/iş tarafı); yeni rota → `app-routes.ts`
  (sıra önemli: `registerCoreRoutes`/`registerAdminRoutes` içinde ilgili yere).

## PT bulguları (düzeltilmedi, R-PT9)

- **PT-K11-B1 (düşük):** `jobs/scheduler.ts` saklama işi `stop()` sonrası yeniden kurulabiliyor: `stop()` yalnız bekleyen
  zamanlayıcıyı iptal eder; o anda bir saklama turu sürüyorsa turun `.finally`'si yeni (unref'li) zamanlayıcı kurar —
  diğer üç iş `stopped` bayrağını denetler, saklama denetlemez. Etki: kapanmış uygulamada ertesi 03:30'da kapalı DB'ye tur
  (unref olduğu için süreci açık tutmaz). Davranış aynen korundu (`stoppable: false`); `fix:` işi olarak ayrı ele alınmalı.
  - **Düzeltildi:** `TimedJob.stoppable` alanı kaldırıldı; `startTimedJob` her işte (saklama dahil) yeniden kurmadan önce
    `stopped` bayrağını denetler. Aralık, ilk tetik, hata/log davranışı aynı. Regresyon testi
    `test/unit/scheduler.test.ts` "PT-K11-B1: …" (düzeltme öncesi kırmızı: `run` 2 kez çağrıldı).
