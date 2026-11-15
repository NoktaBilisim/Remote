# PT-K15 parça B: web kod temizliği (history / audit / customers / admin/tenants). Tur 1 (yarım)

Tarih: 2026-11-15 · Dal: `pt-wip` · Önceki: `PT-K15.md` (tur 1, 1bb205f) · Commit yok.
Kural: davranış ve görünüm değişmez. testid, role, aria-*, sınıflar ve metinler aynı kalır, efekt sırası korunur.
Kapsam: `app/(panel)/{history,audit,customers,admin/tenants}/**` (`loading.tsx` hariç) ve klon maddesi için `users/(list)/page.tsx`.
Yeni ortak bileşenler yalnızca yeni dosya olarak `components/` altına eklenir.

## 1. Durum (PT-K15.md §4 maddeleri)

| Madde                                                                         | Önce                                    | Şimdi                                                                                                                                                                                                                                                                                                       | Durum                                                                                                |
| ----------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1 `HistoryFiltersForm`                                                        | 154                                     | ≤ 40. Parçalar `history/history-filter-fields.tsx` içinde (`DateFields`, `SessionSelects`, `TechSelect`, `TenantPicker`, `CustomerFields` 41). `useHistoryFilters` 42'den ≤ 40'a indi (`nextFilters` ayrıldı)                                                                                               | tamam                                                                                                |
| 2 `history/[id]/sections.tsx`                                                 | 448                                     | 43 (yalnızca `Section`, `Muted`, `Rows`, `none` ve `D`/`RowList` tipleri). Yeni dosyalar: `summary.tsx` (Summary, RequestInfo; cx 19'dan ≤ 15'e), `data-table.tsx` (WideTable + CardGrid), `control-periods.tsx`, `timeline.tsx` (+Quality), `files.tsx` (+ConsentsList). `page.tsx` importları güncellendi | tamam                                                                                                |
| 3 `ImportWizard`                                                              | 340 / cx 22 (dosya 411)                 | 17. Dosyalar: `use-import-wizard.ts` (`useImportFile`, `useImportCommit`, `useImportWizard` 45, `downloadErrorReport`), `import-steps.tsx` (StepNav, DropZone, FileStep, DoneStep), `import-preview.tsx`. `inputRef` bileşende tutulup kancaya parametre olarak geçer (React Compiler refs deseni)          | tamam (`useImportWizard` 45 ≤ 60)                                                                    |
| 3 `CustomerFormDialog`                                                        | 235                                     | 47. Dosyalar: `use-customer-form.ts` (`useCustomerForm` 56), `customer-form-fields.tsx` (`ContactFields` 61, `NoteField`, `SlaFields`)                                                                                                                                                                      | **kısmi**: `ContactFields` 61, kesin sınır 60'ı 1 satır aşıyor. Bölünmeli (ör. ad+etiket / iletişim) |
| 7 `audit/audit-log.tsx`                                                       | 381                                     | 227. Dosyalar: `audit-cells.tsx` (who, tenantOf, detailLabel, MaskedBadge, ResultBadge, UserCell, ActionCell), `audit-detail-dialog.tsx` (DetailRows, ReasonBlock, DetailBody). `AuditLog` 157'den ≤ 40'a indi (`useAuditMore`, AuditHead/Row/Table/Card/Cards/Footer)                                      | tamam                                                                                                |
| 7 `admin/tenants/tenant-list.tsx`                                             | 375                                     | ~170. Dosyalar: `tenant-row-parts.tsx` (TenantActions 47, NameCell, PurgeBadge, `Action` tipi), `tenant-status-dialog.tsx` (`useStatusAction` 48, DeactivateBody, StatusFooter, StatusDialog). `TenantList` 179'dan ≤ 40'a indi (`useSwitchTenant`, TenantTable, TenantCards)                               | tamam                                                                                                |
| 8 `tenants/page.tsx` ↔ `users/(list)/page.tsx` "sayfa dışı" `LinkEmpty` klonu | 10 satır                                | dokunulmadı                                                                                                                                                                                                                                                                                                 | **kalan**                                                                                            |
| 9 `AuditFiltersForm`                                                          | 116                                     | 42. Kanca `audit/use-audit-filters.ts` (`useAuditFilters`, `rangeErrors`), parçalar `DateFields` ve `EventSelects`                                                                                                                                                                                          | tamam (≤ 60)                                                                                         |
| 12 `useFocusFirstError`                                                       | customer/tenant formlarında kopya efekt | iki formda da kullanılıyor: bileşen çağırıyor, `focusError` kancaya parametre olarak geçiyor                                                                                                                                                                                                                | tamam                                                                                                |

Ek iş (klon temizliği): `components/form-dialog-parts.tsx` (yeni dosya) eklendi. İçinde `useCloseGuard` (kirli formda kapatma onayı), `FormLeaveDialog` ve `FormDialogActions` (Vazgeç + kaydet) var. Customer ve tenant formları bunu kullanıyor.
**Kapsam dışı kalan aynı klon:** `users/new-user-dialog.tsx` içindeki yerel `LeaveDialog` ve alt çubuk. Bu bileşenler kullanılarak kaldırılabilir. Users dizini bu parçanın kapsamında değildi.

Kapsam ölçümü (`max-lines-per-function` 40, `complexity` 15; history + audit + customers + admin/tenants + users/(list)/page; aynı betik): **52 → 42 uyarı**. 40'ın üstünde kalan yeni/kısmi işlevler şunlar: `TenantFormDialog` 42, `TenantActions` 47, `useStatusAction` 48, `useTenantForm` 47, `AuditFiltersForm` 42, `CustomerFormDialog` 47, `ContactFields` **61**, `useImportWizard` 45, `useCustomerForm` 56, `CustomerFields` 41.
Kapsamda 300 satırı aşan dosya: **4 → 0** (en büyüğü `audit-log.tsx` 227).

## 2. Değişen / eklenen dosyalar (`apps/web/` altında)

Değişenler:

- `app/(panel)/history/{history-filters.tsx,use-history-filters.ts}`
- `history/[id]/{page,sections}.tsx`
- `audit/{audit-filters,audit-log}.tsx`
- `customers/customer-form-dialog.tsx`
- `customers/import/import-wizard.tsx`
- `admin/tenants/{tenant-list,tenant-form-dialog}.tsx`

Eklenenler:

- `history/history-filter-fields.tsx`
- `history/[id]/{summary,data-table,control-periods,timeline,files}.tsx`
- `audit/{use-audit-filters.ts,audit-cells.tsx,audit-detail-dialog.tsx}`
- `customers/{use-customer-form.ts,customer-form-fields.tsx}`
- `customers/import/{use-import-wizard.ts,import-steps.tsx,import-preview.tsx}`
- `admin/tenants/{use-tenant-form.ts,tenant-row-parts.tsx,tenant-status-dialog.tsx}`
- `components/form-dialog-parts.tsx`

`loading.tsx` dosyalarına, `components/ui`'ye ve mevcut `components/*.tsx` dosyalarına dokunulmadı. `admin/tenants/loading.tsx` dosyasındaki değişiklik parça C'ye ait.

## 3. Kararlar

1. Kanca sırası yer yer değişti, ör. `useFocusFirstError` artık bileşenin ilk kancası. Her bileşende en fazla bir efekt var (odak / `useLeaveGuard`). Bu yüzden efekt sırası aynı kaldı.
2. `ImportWizard`: `useId` ve `inputRef` bileşende kaldı. `useImportWizard(inputRef)` ref'i yalnızca olay işleyicide okuyor.
3. Hücre ve satır parçaları ayrı bileşen yapıldı (`FirmCell`, `ConsentTextCell`, `DirectionCell`, `ResultCell`, `RevokedAt`, `ClosedRows` …). DOM çıktısı aynı. Yalnızca React `key` değerleri bileşen düzeyine taşındı.
4. Tablo başlıkları dizi + `map` ile üretiliyor (tenants `COLS`, import `COLS`). Sınıflar ve metinler birebir aynı.

## 4. Kalan (sonraki ajan)

1. **Madde 8:** `admin/tenants/page.tsx` `tenantsBody` ↔ `users/(list)/page.tsx` `usersBody` "sayfa dışı" `LinkEmpty` bloğu. Önerilen yol: yeni dosya, ör. `components/beyond-empty.tsx` (`BeyondEmpty({pages, testId, href})`, `SearchX`, `us.beyond`/`us.beyondBody`/`h.firstPage`). `components/list-page.tsx` parça C'nin alanında, ona dokunulmamalı. `UsersPage` 50, `usersBody` 49, `TenantsPage` 49.
2. `ContactFields` 61 → iki parçaya böl (kesin sınır 60).
3. İsteğe bağlı olarak 40–56 arasındakileri düşür: `useCustomerForm` 56, `useStatusAction` 48, `TenantActions` 47, `useTenantForm` 47, `CustomerFormDialog` 47, `useImportWizard` 45.
4. **e2e bu turda koşulmadı.** Etkilenen spec'ler (desktop + mobile): `customers`, `p11-admin`, `p13a`, `p14a-a4`, `p16`, `p8-history`, `p15`, `p18-h4`, `p9-users`. Ardından tam `pnpm --filter @remote/web e2e`.
5. PT-K15.md §4'teki öteki kalanlar (13. madde listesi: `HistoryPage`, `AuditPage`, `NoteForm`, `HistoryList`, `CustomerPage` …) bu parçanın görev listesinde yoktu.

## 5. Doğrulama (tur sonu)

- `tsc --noEmit`: 0 hata. Bir ara koşuda `requests/request-thread.tsx` TS hataları görüldü. Bunlar K13'ün yarım işiydi ve sonraki koşuda temizdi.
- ESLint (React Compiler dahil): değişen/eklenen 28 dosyada temiz. Prettier yalnızca bu dosyalara uygulandı.
- `vitest run`: 386/386. `vitest list` önce ve sonra **aynı**.
- `playwright test --list`: önce ve sonra **aynı** (645, satır numarası hariç).
- e2e: koşulmadı (bkz. §4-4).
- Ölçüm betiği: `scratchpad/pt-k15b/olc.sh` (oturum dizini, kalıcı değil). Kapsam dosyaları üzerinde `eslint --rule max-lines-per-function 40 --rule complexity 15 -f json`.

---

# 2. tur

Tarih: 2026-11-15 · Dal: `pt-wip` · Önceki: 1. tur (fe7c1ab) · Commit yok.
Kural aynı: davranış ve görünüm değişmez. testid, role, aria-*, sınıflar ve metinler aynı kalır, efekt sırası korunur.
Kapsam: `app/(panel)/{history,audit,customers,admin/tenants}/**` ve `users/**` (`loading.tsx` dosyaları hariç). Ortak bileşen olarak `components/beyond-empty.tsx` yeni eklendi, `components/form-dialog-parts.tsx` (1. turda eklenen dosya) genişletildi.

## 2.1 Durum

| Madde                                                                                                                | Önce        | Şimdi                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8 "sayfa dışı" `LinkEmpty` klonu (`tenantsBody` ↔ `usersBody`)                                                       | 2 kopya     | `components/beyond-empty.tsx` → `BeyondEmpty({ pages, testId, href })`. İçinde `SearchX`, `us.beyond`/`us.beyondBody`/`h.firstPage` ve `LinkEmpty` var. `components/list-page.tsx` dosyasına dokunulmadı                                                                                                                                                                                              |
| `TenantsPage` 49 / `UsersPage` 50 / `usersBody` 49                                                                   |             | ≤ 40. Başarılı yanıt dalı `tenantsLoaded` / `usersLoaded` işlevlerine taşındı (bileşen değil, düz işlev, yani ağaç aynı). `BodyCtx` tipi eklendi                                                                                                                                                                                                                                                      |
| `ContactFields` 61                                                                                                   |             | ≤ 40. `NameFields` (ad + dosya etiketi) ve `ReachFields` (yetkili/telefon ızgarası + e-posta) parçalarına bölündü. Fragment içinde render ediliyor, DOM aynı                                                                                                                                                                                                                                          |
| `useCustomerForm` 56                                                                                                 |             | ≤ 40. `labelTouched` ve `set` kancası `useCustomerDraft` içine taşındı. `fail` düz işlev oldu: `failHandler(setErrors, setFormError, focusError)`                                                                                                                                                                                                                                                     |
| `CustomerFormDialog` 47 / `TenantFormDialog` 42                                                                      |             | ≤ 40. Prop tipleri `Props` olarak ayrıldı                                                                                                                                                                                                                                                                                                                                                             |
| `TenantActions` 62*                                                                                                  |             | ≤ 40. `EditButton`, `SwitchButton`, `DeactivateButton` ve `ReactivateButton` ayrı bileşen oldu (`ActionProps`)                                                                                                                                                                                                                                                                                        |
| `useStatusAction` 48                                                                                                 |             | ≤ 40. `useTypedSlug` (kısa ad onay alanı) ve `statusFail(deps)` ayrıldı                                                                                                                                                                                                                                                                                                                               |
| `useTenantForm` 47                                                                                                   |             | ≤ 40. `failHandler` ayrıldı                                                                                                                                                                                                                                                                                                                                                                           |
| `TenantTable` 44                                                                                                     |             | ≤ 40. Satır `TenantRow` bileşenine taşındı (`key` bileşen düzeyinde)                                                                                                                                                                                                                                                                                                                                  |
| `useImportWizard` 45                                                                                                 |             | ≤ 40. `useUnauth()` ayrıldı (401 → giriş). İlk kanca yine `useRouter`                                                                                                                                                                                                                                                                                                                                 |
| 4 `new-user-dialog.tsx` yerel `LeaveDialog` + alt çubuk klonu                                                        | yerel kopya | `useCloseGuard`, `FormLeaveDialog` ve `FormDialogActions` kullanılıyor. `FormDialogActions`'a isteğe bağlı `Icon` prop'u eklendi (varsayılanı `Save`, kullanıcı formunda `UserPlus`). Yerel `confirmClose` durumu kaldırıldı, nöbetçi `useNewUserForm(locked, onClose, focusError)` içinde. `useNewUserForm` 44, `NewUserDialog` 59, ikisi de ≤ 40 (`failHandler`, `NewUserFieldset`, `PasswordStep`) |
| users/** diğer: `UserFields` 57, `UserFilters` 44, `UserList` 77, `UserPage` 45, `useUserSave` 51, `StatusDialog` 50 |             | Hepsi ≤ 40. `UserFields` → `IdentityFields` + rol seçimi (`Props` tipiyle). `UserFilters` → seçenekler `ROLE_OPTIONS()` / `STATUS_OPTIONS()` dizilerine taşındı. `UserList` → `NameCell`, `UserTable` (+ `COLS` map), `UserRow`, `UserCards`. `UserPage` → `crumbs`, `forbidden()`, `notice()`. `useUserSave` → `useUserReload`. `StatusDialog` → `StatusProps`, `StatusFooter`                       |

\* 1. turdaki 47 değeri eski ölçümdü. Bu tur başında aynı betik 62 ölçtü.

Kapsam ölçümü (`max-lines-per-function` 40, `complexity` 15; history + audit + customers + admin/tenants + **users/** tamamı + iki ortak bileşen; betik `scratchpad/pt-k15b2/olc.sh`): **50 → 30 uyarı**.
users/** altında 40'ı aşan işlev kalmadı. Kalanların hepsi PT-K15.md §4-13 listesinden: `HistoryPage`, `HistoryList`, `HistoryDetailPage`, `NoteForm`, `AuditPage`, `CustomerPage`, `CustomerList`, `CustomerActions`, `CustomersActions`, `CustomersPage`, `TenantPage`, `PurgeDialog`, `PurgePanel`, `PurgeStatusCard`, `Pagination`. Bunlara ek olarak 41–44 arası dört işlev var: `AuditFiltersForm` 42, `CustomerFields` 41, `SessionsTab` 41, `HelpDialog` 41, `ConfirmDialog` 44.

## 2.2 Değişen / eklenen dosyalar (`apps/web/` altında)

- Yeni: `components/beyond-empty.tsx`
- Değişen ortak bileşen: `components/form-dialog-parts.tsx` (`FormDialogActions` içinde `Icon?`)
- `admin/tenants/{page,tenant-form-dialog,tenant-list,tenant-row-parts,tenant-status-dialog}.tsx`, `admin/tenants/use-tenant-form.ts`
- `customers/{customer-form-dialog,customer-form-fields}.tsx`, `customers/use-customer-form.ts`, `customers/import/use-import-wizard.ts`
- `users/(list)/page.tsx`, `users/[id]/{page,user-dialogs}.tsx`, `users/[id]/use-user-editor.ts`, `users/{new-user-dialog,user-fields,user-filters,user-list}.tsx`

## 2.3 Kararlar

1. `new-user-dialog`: eski `LeaveDialog` ile `FormLeaveDialog` aynı çıktıyı veriyor (alertdialog, sm, `user-form-leave`, `us.f.leaveTitle`/`leaveBody`/`stay`, "Kal" varsayılan odak + `sm:ml-auto`, `h.n.discard` danger-ghost). Yalnızca bir fark var: "Kaydetmeden kapat" düğmesi artık `onStay(); onLeave()` yerine `guard.leave` çağırıyor, bu da aynı sırayı izliyor (`setConfirmClose(false)` → `onClose()`). Kirli form koşulu aynı: `fullName`, `email` veya `role !== "USER"`.
2. Kanca sırası yer yer değişti (`labelTouched` taslak kancasına, `reloading` kaydetme kancasının sonuna, `confirmClose` nöbetçiye taşındı). Etkilenen kancaların hiçbirinde efekt yok, yani efekt sırası aynı.
3. React Compiler deseni korundu: `useFocusFirstError` bileşende çağrılıyor, `focusError` kancaya parametre olarak geçiyor.

## 2.4 Doğrulama

- `tsc --noEmit`: 0 hata.
- ESLint (React Compiler dahil) değişen/eklenen 20 dosyada temiz. Prettier yalnızca bu dosyalara uygulandı, `--check` temiz.
- `vitest run`: 386/386. `vitest list` önce ve sonra **aynı**.
- `playwright test --list`: önce ve sonra **aynı** (645, satır numarası hariç).
- Hedefli e2e (desktop + mobile; customers, p11-admin, p13a, p14a-a4, p16, p8-history, p15, p18-h4, p9-users): **150 geçti / 0 kırmızı** (104 atlandı, bunlar projeye özgü atlamalar).
- Tam `pnpm --filter @remote/web e2e`:
  - 1. koşu: 441 geçti, 1 kırmızı. Kırmızı test `p13bl-lobby.spec.ts` AC-305 [mobile] (PT-K14.md'de kararsız aday olarak kayıtlı, `/sessions` lobi rozeti, bu parçanın dosyalarıyla ilgisiz). Ona bağlı olarak `desktop-perf` 1 "did not run".
  - Spec tek başına `--repeat-each=3` ile koşulunca 1/6 kırmızı verdi (bu kez desktop'ta), yani kararsız.
  - 2. tam koşu: **443 geçti / 0 kırmızı**.
