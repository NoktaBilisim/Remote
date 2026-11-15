# PT-K15 — web kod temizliği (frontend-dev) — TUR 1 (yarım; sonraki ajan sürdürür)

Tarih: 2026-11-15 · Dal: `pt-wip` · Tasarım: `docs/mimari-temizlik.md` §5 K15 (+ §3.4, §3.7-2) · Örnek: `PT-K14.md`.
Kural: davranış ve görünüm değişmez; testid / role / aria-* / sınıf / metin aynı; efekt sırası korunur; commit yok.

## 1. Durum özeti (tur 1)

| Hedef                                                                              | Önce                          | Şimdi                                                                                                                                                                                                               | Durum                                 |
| ---------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `users/[id]/user-editor.tsx` `UserEditor`                                          | dosya 533 · 304 satır · cx 36 | dosya 51 · `UserEditor` ≤ 40; `use-user-editor.ts` (`useUserDraft`, `useSaveError`, `useUserSave` 51, `useUserEditor`), `user-editor-parts.tsx`, `user-dialogs.tsx` (`StatusDialog` 50, `DeleteDialog` + kancaları) | tamam (≤ 60)                          |
| Klon `new-user-dialog` ↔ `user-editor` (28 satır)                                  | jscpd klon                    | ortak `users/user-fields.tsx` (`UserFields`, `serverFieldErrors`, `forbiddenMessage`); jscpd 0                                                                                                                      | tamam                                 |
| Liste sayfalama klonu `customers/(list)/page` ↔ `users/(list)/page` (25) + tenants | jscpd klon                    | ortak `components/list-page.tsx` (`ListPageHeader`, `ListNotice`, `LinkEmpty`, `ListFooter`, `LIST_LINK_CLS`); `customers/general-link.tsx` ayrıldı                                                                 | tamam (bkz. §4 yeni 10 satırlık klon) |
| Filtre klonları users / customers / tenants (12–15)                                | jscpd 3 klon                  | ortak `components/list-search.tsx` (`useListSearch`, `ListSearch`); jscpd 0                                                                                                                                         | tamam                                 |
| Filtre klonu `audit-filters` ↔ `history-filters` (13)                              | jscpd klon                    | ortak `components/filter-buttons.tsx`; jscpd 0                                                                                                                                                                      | tamam                                 |
| `HistoryFiltersForm` 217 · cx 20                                                   |                               | durum `use-history-filters.ts`'e taşındı (`useTechOptions`, `usePickers`, `useHistoryFilters` 42); bileşen hâlâ **154** (JSX bölünmedi)                                                                             | **yarım**                             |
| Ortak odak kancası                                                                 | 6 dosyada kopya efekt         | `lib/use-focus-error.ts` (`useFocusFirstError`) — şimdilik yalnız users'ta kullanılıyor                                                                                                                             | kısmi                                 |
| `validateDraft` (history-filters) knip                                             | gereksiz export               | export kaldırıldı (yalnız dosya içinde kullanılıyordu)                                                                                                                                                              | tamam                                 |

Kapsam ESLint ölçümü (40 / cx 15, `scratchpad/pt-k15/olc.sh` ile aynı dosya kümesi): **117 → 114 uyarı, cx 29 → 24**.
Kapsamda > 300 satır dosya: **7 → 6** (user-editor çıktı). Kapsamdaki üretim jscpd klonları: **12 → 7** (+1 yeni küçük, §4).

## 2. Değişen / eklenen dosyalar (`apps/web/` altında)

Değişen: `app/(panel)/users/{new-user-dialog,user-filters}.tsx`, `users/(list)/page.tsx`, `users/[id]/user-editor.tsx`,
`customers/(list)/page.tsx`, `customers/customer-filters.tsx`, `admin/tenants/{page,tenant-filters}.tsx`,
`audit/audit-filters.tsx`, `history/history-filters.tsx`.

Eklenen: `app/(panel)/users/user-fields.tsx`, `users/[id]/{use-user-editor.ts,user-editor-parts.tsx,user-dialogs.tsx}`,
`customers/general-link.tsx`, `history/use-history-filters.ts`, `components/{list-page,list-search,filter-buttons}.tsx`,
`lib/use-focus-error.ts`.

K13/K14 dosyalarına dokunulmadı (`lib/notify`, `lib/web-request`, `requests/`, `settings/{sms,smtp,support-requests,business-hours}`,
`components/settings` değişiklikleri K13'ündür).

## 3. Kararlar

1. **React Compiler `react-hooks/refs`:** ref içeren nesne (`formRef`) kanca sonucuyla birlikte dönünce tüm nesne
   "ref değeri" sayılıp çizimde erişim hatası veriyor. Bu yüzden `useFocusFirstError()` bileşenin kendisinde çağrılır,
   `focusError` form kancasına parametre olarak geçer (`useUserEditor(..., focusError)`, `useNewUserForm(locked, focusError)`).
   Sonraki dosyalarda (customer-form-dialog, turn/mysql-form, tenant-form-dialog) aynı desen kullanılmalı.
2. **Efekt sırası:** taşınan bileşenlerde tek efekt vardı (odak / zamanlayıcı temizliği / abort); sıra değişmedi.
3. **`UserFields`:** `mode="new"` → `required` + `data-autofocus` + `uf-*`; `mode="edit"` → `ue-*`, öznitelik yok (eskisi gibi).
4. **`ListSearch`:** `hint` verilirse `aria-describedby` + ipucu satırı + Enter ile hemen arama (users, customers);
   firmalarda (eskisi gibi) yok. `useId` artık `ListSearch` içinde (kimlik değeri farklı, görünür/gözlenebilir fark yok).
5. **`LinkEmpty` / `ListFooter`:** sunucu bileşeni (`"use client"` yok); `hrefFor` işlevi sunucu→sunucu prop.

## 4. Kalan (sonraki ajan — öncelik sırasıyla)

1. **`HistoryFiltersForm` 154** → JSX'i parçalara böl (tarih alanları, oturum seçimleri, teknisyen seçici, firma combobox,
   müşteri firma alanları). Durum zaten `use-history-filters.ts`'te. `useHistoryFilters` 42 (≤ 60).
2. **`history/[id]/sections.tsx` 448** (Summary cx 19, DataTable 62, ControlPeriods 49, Timeline 42, Files 43) — dosyalara böl.
3. **`ImportWizard` 340 / cx 22 (dosya 411)**, **`CustomerFormDialog` 235** — `useFocusFirstError` deseniyle.
4. **Şifre formu klonu** `change-password-form` ↔ `reset-form` (24 satır) — ortak alan/kanca (`app/(auth)/**`).
5. **Admin ayar sayfa kabuğu** klonu `turn` / `mysql` / `whatsapp` `page.tsx` (16) ve **`loading.tsx`** klonu
   (`admin/tenants` ↔ `users/(list)`, 17).
6. **`MysqlForm` 257 (dosya 302)**, **`TurnForm` 242**, **`WhatsappForm` 244 / cx 18 (dosya 302)**, **`ConsentForm` 217 / cx 21**,
   **`Combobox` 233 / cx 40** (+ `lib/combobox.ts` `comboKey` cx 24), **`AvatarUploader` 224** (+ logo-uploader klonu 14 satır).
7. Dosya > 300 kalanlar: `audit/audit-log.tsx` 381, `admin/tenants/tenant-list.tsx` 375.
8. **Yeni küçük klon (10 satır):** `admin/tenants/page.tsx` ↔ `users/(list)/page.tsx` (`tenantsBody`/`usersBody` "sayfa dışı" `LinkEmpty`
   bloğu) — tek yardımcıyla (ör. `BeyondEmpty`) kaldırılabilir. `UsersPage` 50, `usersBody` 49, `CustomersPage` 71 (40 üstü).
9. `AuditFiltersForm` 116 — kancaya + parçalara böl.
10. **Ölü i18n anahtarları:** başlanmadı. Baseline 27 aday + 145 dinamik aday (`docs/temizlik/baseline/i18n.json`); her biri
    grep ile iki yoldan doğrulanmadan silinmez (şablon önekleri `t(\`${k}.done\`)`vb. dikkat — ör.`us.d/us.r/us.m.*`).
11. **Kapsamdaki lib knip export'ları:** başlanmadı (baseline K15: export 71, tip 46; `baseline/graphify-capraz.json` K15 listesi).
12. `useFocusFirstError`'u kalan 4 kapsam dosyasına yay (customer-form-dialog, turn-form, mysql-form, tenant-form-dialog);
    `settings/smtp/use-smtp-form.ts` K13'ündür, dokunma.
13. Sonra listesi (görev metninde adı geçmeyen > 40): `UserList` 77, `UserPage` 45, `TenantList` 179, `StatusDialog` (tenant) 110,
    `TenantFormDialog` 148, `Purge*` (132–140), `AuditLog` 157, `AuditPage` 123 / cx 36, `HistoryList` 139, `HistoryPage` 139 / cx 30,
    `NoteForm` 132, `CustomerActions` 102, `CustomerPage` 149, `LimitsForm` 113, `RetentionForm` 130, `SuperadminList` 110,
    `LoginForm` 75, `MfaVerifyForm` 97, `ForgotForm` 72, `RequestNotifier` 144, `LobbyNotifier` 87, `TemporaryPasswordDialog` 118,
    `ConfirmNameDialog` 118, `Dialog` 94, `Menu` 77, `api.ts send` cx 25 (tam liste: `scratchpad/pt-k15/olc.sh` çıktısı).

## 5. Doğrulama (tur 1 sonu)

- `tsc --noEmit`: K15 dosyalarında hata yok. Ara koşuda `app/(panel)/requests/request-card.tsx` kaynaklı TS2304 hataları
  görüldü — **K13'ün yarım değişikliği** (sonraki koşuda kendiliğinden temizdi), K15 ile ilgisiz.
- ESLint (React Compiler dahil): K15 değişen/eklenen dosyalarda temiz. Prettier yalnız bu dosyalara uygulandı.
- `vitest`: 386/386 geçti; `vitest list` önce/sonra **aynı**. Test dosyalarına dokunulmadı.
- e2e (desktop + mobile; `customers`, `p11-admin`, `p13a`, `p14a-a4`, `p8-history`, `p9-users`, `p16`, `p10-account`):
  **142 geçti, 0 kırmızı**, 84 atlandı. Tam takım bu turda koşulmadı (sonraki tur sonunda koşulmalı).
- `playwright test --list` adları önce/sonra **aynı** (645 satır, satır numarası hariç).
- Ölçüm betiği ve listeler: `scratchpad/pt-k15/` (oturum dizini; kalıcı değil — sonraki ajan `olc.sh`'yi yeniden üretebilir:
  kapsam dosyaları üzerinde `eslint --rule max-lines-per-function 40 --rule complexity 15`).
