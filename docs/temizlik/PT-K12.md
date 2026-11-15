# PT-K12 — sunucu servis modülleri temizliği (backend-dev) — KISMİ (tur sınırı)

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

## Kalan iş (bu turda yapılmadı — K12 kapanmadı)

1. `sessions/history.ts` 586 bölünmesi (`buildDetail` 90/cx 20, `exportHistoryCsv` 77, `deriveControlPeriods` 46).
2. `tenants/service.ts` 416 bölünmesi (`deactivateTenant` 58, `updateTenantSettings` 61/cx 17).
3. `bindings/service.ts` `issueTx` 108 / iç TX cx 43.
4. `auth/routes.ts` `authRoutes` 128; `sessions/routes.ts` `sessionRoutes` 106.
5. `settings/system.ts` `testMysql` 57 / cx 25.
6. Kalan knip export/tip'leri (baseline: export 48, tip 50; bu turda yalnız `RaceHooks` ve `LockHooks`/`UserPurgeEffects`
   yerleri düzenlendi). Yeni `users/guard.ts` / `writes.ts` export'larının hepsi başka K12 dosyasında kullanılıyor;
   knip yeniden koşulmadı.

## PT bulguları (düzeltilmedi, R-PT9)

- Yok.
