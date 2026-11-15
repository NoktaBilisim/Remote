# PT-K12 — sunucu servis modülleri temizliği (backend-dev)

Tarih: 2026-11-15 · Tasarım: `docs/mimari-temizlik.md` §5 K12 (+ §1–4, §6). AC: AC-317, 318, 320, 321, 324.
Davranış değişmez: HTTP uçları, hata kodları/mesajları, audit eylem/alanları, log mesajları, TX sınırları, kilit sırası aynı.
Yeni bağımlılık yok. Commit yapılmadı. Koordinatörün tur sınırı talimatıyla **tutarlı bir ara noktada** durduruldu:
`users` ve `auth/account` bölümü tamam ve doğrulandı; kalan iş aşağıda listelendi.

## Değişen / yeni dosyalar (hepsi K12 listesinde)

| Dosya                               | Önce → sonra  | İş                                                                                                                                                 |
| ----------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/users/service.ts`              | 666 → 299     | Dışa açık işlevlerin hepsi yerinde; TX gövdeleri devredildi (`updateUser` 59, `setStatus` 46, `resetUserMfa` 44, `purgeUser` 47 → ≤ 25)            |
| `src/users/guard.ts` (yeni)         | 178           | Ortak yetki/kilit yardımcıları: `DeniedError`, `lockActor`, `auditFailures`, `permissionAudits`, `normalizeRows`, `assertGrantable`, `LockHooks` … |
| `src/users/writes.ts` (yeni)        | 224           | `createTx`, `updateTx` (+`planUpdate`, `fieldDiff`; eski iç TX 41/cx 19), `setStatusTx` (+`writeStatus`), `resetMfaTx`                             |
| `src/users/purge.ts` (yeni)         | 80            | `purgeTx` (+`assertPurgeable`), `UserPurgeEffects`, `appendUserLedger`                                                                             |
| `src/users/view.ts` (yeni)          | 35            | `toItem`, `toDetail`                                                                                                                               |
| `src/users/routes.ts`               | 160 → 185     | `userRoutes` 80 → 14: `userHooks`, `readRoutes`, `editRoutes`, `actionRoutes`; kapılar bir kez kurulur (`RouteKit`), kayıt sırası aynı             |
| `src/auth/account.ts`               | 509 → 227     | 2FA kurulum/etkinleştirme/doğrulama + logoutAll; `mfaEnable` 50 → `enableTx` çıkarıldı; `RaceHooks` export kaldırıldı (knip)                       |
| `src/auth/account-shared.ts` (yeni) | 81            | `who`, `hitLimit`, `hitMfaLimit`, `resetMfaLimit`, `loadSecret`, `consumeSecondFactor`, `MIN`                                                      |
| `src/auth/step-up.ts` (yeni)        | 119           | `stepUp` (46 → `stepUpTx` çıkarıldı), `regenerateRecoveryCodes`                                                                                    |
| `src/auth/password-reset.ts` (yeni) | 138           | `forgotPassword`, `processForgot` (42 → `issueResetToken` çıkarıldı), `resetPassword`, `lockNotifier`                                              |
| `src/auth/routes.ts`                | yalnız import | `account.ts`'ten alınan adlar üç dosyaya bölündü                                                                                                   |

Test dosyalarına dokunulmadı.

## Taşıma kuralı (§1-3)

- Test/başka modülün import ettiği adlar yerinde: `users/service.ts` (`updateUser`, `UserLiveEffects`, `manageableUser`),
  `auth/account.ts` (`mfaSetup`, `createAccountLimits`, `closeAccountLimits`, `AccountDeps`).
- **Sapma (K10 §1 ile aynı yorum):** `forgotPassword`, `resetPassword`, `lockNotifier`, `stepUp`, `regenerateRecoveryCodes`
  yalnız `auth/routes.ts` (K12 dosyası) tarafından import ediliyordu; yeni dosyalara taşındı, yalnız `auth/routes.ts`'in
  import satırı değişti. K12 dışında hiçbir import satırı değişmedi.
- TX'li yardımcılar TX nesnesini parametre alır (`WriteCtx.tx`, `enableTx(d, tx, …)`, `stepUpTx`, `issueResetToken`);
  hiçbiri kendi TX'ini açmaz. İfade ve `await` sırası aynen (ör. `setStatus`'ta `now` CONFLICT denetiminden sonra okunur).

## Davranış eşdeğerliği (R-PT1) — K12 dosya kümesinin tamamı (audit/service.ts hariç), HEAD ↔ çalışma kopyası

| Çağrı                                                 | Önce        | Sonra                                            |
| ----------------------------------------------------- | ----------- | ------------------------------------------------ |
| `writeAudit(`                                         | 89          | 89                                               |
| `metrics.inc/observe(`                                | 22          | 22                                               |
| `$transaction(`                                       | 56          | 56                                               |
| log (`log/logger.info/warn/error…`)                   | 46          | 46                                               |
| `requireAuth` / `requirePerm(` / `requireStepUp(`     | 44 / 31 / 5 | 44 / 31 / 5                                      |
| `requireSuperAdmin` / `tenantScope(` / `checkOrigin(` | 11 / 27 / 5 | 11 / 27 / 5                                      |
| hız kovası (`.hit/.blockedFor/…(`)                    | 86          | 86                                               |
| `new AppError(` / `throw`                             | 187 / 263   | 187 / 263                                        |
| maske (`***` / `mask*(`)                              | 36          | 36                                               |
| `FOR UPDATE/SHARE`                                    | 31          | 31                                               |
| `app.get/post/put/patch/delete(`                      | 86          | 86                                               |
| `preHandler/onRequest/rateLimit` sözcüğü              | 59          | 60 (yeni `Gate` tipinde geçen ad; çağrı değil)   |
| `await`                                               | 750         | 753 (çıkarılan yardımcıların TX gövdesi çağrısı) |

## Ölçüm (pt-olcum kuralları: işlev > 40 satır, karmaşıklık > 15) — K12 dosya kümesi

- Uyarı sayısı: önce **70** → sonra **59**. `users/**` 0 uyarı; `auth/account.ts`, `step-up.ts`, `password-reset.ts`,
  `account-shared.ts` 0 uyarı.
- Dosya > 300: önce `users/service.ts` 666, `auth/account.ts` 509 → ikisi de ≤ 300.

## Doğrulama

| Adım                                                                                     | Sonuç                                                                                 |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `tsc --noEmit` (server)                                                                  | temiz                                                                                 |
| `eslint src/users src/auth`                                                              | temiz                                                                                 |
| `prettier --check` (değişen/yeni dosyalar)                                               | temiz                                                                                 |
| Unit `vitest run test/unit`                                                              | 30 dosya, 434/434 (ilk koşuda 1 kararsız başarısızlık, tekrar koşuda yeşil; K12 dışı) |
| Test listesi (`vitest list`, 1619)                                                       | önce = sonra (dosya + ad birebir)                                                     |
| Entegrasyon (MySQL 8.4, `test-db.sh`, konteyner `rs-pt-k12-d48fae`, max-connections=300) | 79 dosya, **796/796** (server `pt-surface` rota anlık görüntüsü değişmedi)            |
| Konteyner                                                                                | iş bitince adıyla silindi                                                             |

## `@types/smtp-server` (yalnız doğrulama — package.json'a dokunulmadı, K16)

`smtp-server` yalnız 4 entegrasyon testinde import ediliyor. `smtp-server@3.21.4` kendi tiplerini taşıyor
(`package.json` `"types": "./dist/cjs/smtp-server.d.ts"`); TypeScript paket içi tipi `@types`'tan önce kullanır →
`@types/smtp-server` **gereksiz görünüyor**. K16 kaldırıp `pnpm --filter @remote/server typecheck` ile teyit etmeli.

## 2. tur (1. tur 61b84b0 olarak commit'lendi)

### Değişen / yeni dosyalar (hepsi K12 listesinde)

| Dosya                               | Önce → sonra            | İş                                                                                                                                                                                                                              |
| ----------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessions/history.ts`               | 586 → 156               | Liste/detay/PATCH/CSV giriş işlevleri yerinde; `exportHistoryCsv` 77 → 17. `deriveControlPeriods`, `groupFileReports`, `projectDetails`, `toListItem` **yeniden dışa verilir** (test + `customers/service.ts` aynı yoldan alır) |
| `sessions/history-view.ts` (yeni)   | 223                     | Saf izdüşümler: `toListItem`, `firmOf`, `projectDetails`, `deriveControlPeriods` (46 → 38; iç `take` → `takeMatch`), dosya raporu tekilleştirme, `fileSummaryCell`                                                              |
| `sessions/history-detail.ts` (yeni) | 149                     | `buildDetail` 90/cx 20 → 33 satır: `qualityOf`, `timelineOf`, `actorNameOf` (iç içe üçlü koşul), `consentRecordOf`, `requestOf`                                                                                                 |
| `sessions/history-csv.ts` (yeni)    | 148                     | `slaCell`, `csvCells`, `exportFilename`, `auditExport`, `batchCsv`, `csvStream` (eski iç `generate`)                                                                                                                            |
| `sessions/routes.ts`                | `sessionRoutes` 106 → 8 | `createRoute`, `listRoutes`, `detailRoutes`, `sendLinkRoutes`, `endRoutes` — kayıt ve `onClose` kanca sırası aynı                                                                                                               |
| `auth/routes.ts`                    | `authRoutes` 128 → 8    | `loginRoute`, `mfaRoutes`, `passwordRoutes`, `logoutRoute`, `profileRoutes`, `meRoute` — kayıt sırası aynı                                                                                                                      |
| `tenants/service.ts`                | 416 → 248               | `deactivateTenant` 58 → 10, `updateTenantSettings` 61/cx 17 → 11; dışa açık adlar yerinde                                                                                                                                       |
| `tenants/deactivate.ts` (yeni)      | 109                     | `deactivateTx` (+`revokeAllBindings`, `auditCancellations`), `afterDeactivate`, ortak `ENTITY`/`actor`                                                                                                                          |
| `tenants/settings.ts` (yeni)        | 126                     | `settingsView`, `smtpAudit`, `smtpChange` (şifre maskesi `"***"` aynen), `settingsTx`                                                                                                                                           |
| `bindings/service.ts`               | 405 → 268               | `issueTx` 108 / iç TX cx 43 → 20 satır; TX nesnesi `issueWrite`'a parametre; yeniden deneme döngüsü `issueBinding`'de değişmedi                                                                                                 |
| `bindings/issue-tx.ts` (yeni)       | 209                     | `admitSession`, `pickTarget`/`pickMulti`, `writeBinding`, `firmNameOf`, `issueWrite`; `Denied`, `IssueInput/Result`, `denied`, `tenantActive`, `ENTITY`                                                                         |
| `settings/system.ts`                | 321 → 339               | `testMysql` 57/cx 25 → ≤ 40 / ≤ 15: `hitTestLimits`, `testPassword`, `logProbeFailure`                                                                                                                                          |
| knip (43 dosya)                     | —                       | 91 gereksiz `export` kaldırıldı; gerçekten ölü 2 öğe silindi: `bindings/repo.ts` `revokeByHash` (hiç çağrılmıyor), `notify/whatsapp.ts` `SendResult` tipi                                                                       |

### Sıra / eşdeğerlik notları

- Kilit ve SQL sırası aynı: `issueWrite` = saat → oturum → müşteri FOR SHARE → bayat kaynak → oturum kaydı FOR UPDATE →
  (çoklu: tenant satırları + fazlası REPLACED | tekli: önceki anahtar) → yenile/INSERT → audit ISSUED → firma adı. Deactivate:
  kilit → UPDATE → oturumlar → bekleyenler → atamalar → talepler → kayıt partileri → talep audit'leri → kayıt audit'i → tenant audit'i.
- **Mekanik olmayan tek ayrıntı:** CSV başlık dizisi eskiden `exportHistoryCsv` içinde hemen kuruluyordu, şimdi
  `csvStream` üretecinin ilk adımında kuruluyor (saf hesap, yan etkisi yok; ilk `yield` ile aynı anda).
- `revokedAudit` (`issue-tx.ts`): aynı REPLACED audit nesnesinin iki kopyası tek kurucuya alındı; `writeAudit` çağrı sayısı aynı.
- `settings/system.ts` 339 satır (> 300): §5'te dosya bölmesi istenmiyor (yalnız `testMysql` cx); TURN bölümü taşınabilir ama
  testler/`routes.ts` aynı yoldan alıyor → yeniden dışa vermeyle sonraki "dokunan böler" işine bırakıldı (istisna 1).

### Doğrulama (2. tur)

| Adım                                                                       | Sonuç                                                                   |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `tsc --noEmit` (server)                                                    | 0 hata (K2'nin ara durumundaki test hataları koşu sonunda giderilmişti) |
| `eslint` K12 dosya kümesi                                                  | temiz                                                                   |
| Prettier                                                                   | yalnız değişen/yeni dosyalar                                            |
| Unit (iki koşu)                                                            | 434/434, 434/434 — kararsız test çıkmadı                                |
| Test listesi (`vitest list`)                                               | 1619 = 1619, dosya + ad birebir                                         |
| Entegrasyon (konteyner `rs-pt-k12-45c252`, MySQL 8.4, max-connections=300) | 79 dosya, **796/796** (`pt-surface` dahil); konteyner silindi           |
| ESLint ölçümü (işlev > 40 / cx > 15), K12 kümesi                           | 70 (baseline) → 59 (1. tur) → **43**                                    |

### Çağrı sayımları (K12 kümesi, baseline HEAD ↔ 2. tur sonu)

`writeAudit(` 89=89 · `metrics.*(` 22=22 · `$transaction(` 56=56 · log 46=46 · `requireAuth` 44=44 · `requirePerm(` 31=31 ·
`requireStepUp(` 5=5 · `requireSuperAdmin` 11=11 · `tenantScope(` 27=27 · `checkOrigin(` 5=5 · `checkPublicClient(` 6=6 ·
hız kovası 86=86 · `new AppError(` 187=187 · `throw` 263=263 · `app.<metot>(` 86=86 · `enqueue(` 4=4.
Yorum satırları hariç: `FOR UPDATE/SHARE` 19=19, maske (`***`/`mask*(`) 25=25 (ham sayımdaki +5/+1 yalnız yeni başlık yorumları).
`preHandler` sözcüğü 59→60 (`Gate` tipi), `await` 750→761 (çıkarılan yardımcı çağrıları) — çağrı değil/davranış değil.

## Kalan (K12 hedef listesi dışında, dokunulmadı)

> 40 / cx > 15 olarak kalan 43 uyarı K12 satırında adı geçmeyen işlevler (ör. `auth/service.ts login` 66/cx 22,
> `sessions/service.ts createSupportSession` 74, `sessions/send-link.ts sendSessionLink` 70/cx 20, `mail/service.ts deliver` 63,
> `cli/crypto.ts main` 67/cx 26, `settings/mysql-probe.ts classifyMysqlError` cx 24, `tenants/routes.ts adminTenantRoutes` 70).
> Sonra / dokunan böler (§9).

## PT bulguları (düzeltilmedi, R-PT9)

- Yok.
