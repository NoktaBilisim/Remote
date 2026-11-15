# PT-K15 parça C — web kod temizliği (frontend-dev) — TUR 1 (yarım; tur sınırında durdu)

Tarih: 2026-11-15 · Dal: `pt-wip` · Önceki: `PT-K15.md` (1bb205f) · Tasarım: `docs/mimari-temizlik.md` §1, §5 K15.
Kural: davranış ve görünüm değişmez; testid / role / aria-* / sınıf / metin aynı; efekt sırası korunur; commit yok.

## 1. Durum (PT-K15.md §4 kalan listesine göre)

| Madde                                                                                                                                         | Önce                                                     | Şimdi                                                                                                                                                                                                                                                | Durum     |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 4) Şifre formu klonu `change-password-form` ↔ `reset-form`                                                                                    | jscpd 24 satır; `ChangePasswordForm` 64*, `ResetForm` 86 | ortak `app/(auth)/password-fields.tsx` (`NewPasswordFields`, `PasswordSubmit`, `focusFirstField`); `ChangePasswordForm` ≤ 40 + `useChangePassword` 49; `ResetForm` ≤ 40 (`useResetToken`, `useResetSubmit`, `ResetReading`, `ResetInvalid`); jscpd 0 | tamam     |
| 5a) Admin ayar sayfa kabuğu klonu (turn/mysql/whatsapp page)                                                                                  | jscpd 16 satır ×3                                        | `admin/settings/page-error.tsx` `settingsPageError(status)` — **bileşen değil, sayfa işlevi içinde çağrılan işlev** (401 `redirect` eskisi gibi sayfanın kendisinden atılır)                                                                         | tamam     |
| 5b) `loading.tsx` klonu `admin/tenants` ↔ `users/(list)`                                                                                      | jscpd 17                                                 | `components/ui/skeleton.tsx` `ListPageSkeleton({ testId, label })`; iki `loading.tsx` 7 satır                                                                                                                                                        | tamam     |
| 6) `MysqlForm` 257 / cx 16 (dosya 302)                                                                                                        |                                                          | `mysql-form.tsx` 44 (`MysqlForm` ≤ 40), `use-mysql-form.ts` 137 (`useMysqlDraft`, `useMysqlErrors`, `useMysqlSave`, `useMysqlTest`, `useMysqlForm`), `mysql-parts.tsx` 196 (`ServerSection` 49, diğerleri ≤ 40)                                      | tamam     |
| 6) `TurnForm` 242                                                                                                                             |                                                          | `turn-form.tsx` 59 (`TurnForm` ≤ 40), `use-turn-form.ts` 161, `turn-parts.tsx` 143; ortak `admin/settings/env-reset.tsx` (`EnvResetButton`, `EnvResetDialog`) — WhatsApp'ta da kullanılmak üzere                                                     | tamam     |
| 12) `useFocusFirstError` → turn-form, mysql-form                                                                                              | kopya efekt                                              | iki formda `useFocusFirstError()` bileşende, `focusError` kancaya parametre (PT-K15.md §3-1 deseni)                                                                                                                                                  | tamam     |
| 6) `WhatsappForm` 244 / cx 18 (dosya 302)                                                                                                     |                                                          | dokunulmadı (yalnız `page.tsx`). Plan §3                                                                                                                                                                                                             | **kalan** |
| 6) `ConsentForm` 217 / cx 21, `Combobox` 233 / cx 40, `comboKey` cx 24, `AvatarUploader` 224 + logo-uploader klonu (13 satır, jscpd hâlâ var) |                                                          | dokunulmadı                                                                                                                                                                                                                                          | **kalan** |
| 11) Kapsam lib knip export'ları                                                                                                               |                                                          | başlanmadı                                                                                                                                                                                                                                           | **kalan** |
| 10) Ölü i18n anahtarları                                                                                                                      | baseline 27 aday / 153 dinamik aday (bu turun ölçümü)    | başlanmadı (EN SON yapılacak)                                                                                                                                                                                                                        | **kalan** |

\* `ChangePasswordForm` 64, ilk ortak alan çıkarımından sonraki ölçüm (öncesi daha uzundu).

Kapsamdaki jscpd (≥ 8 satır / 70 belirteç; `app/(auth)`, `admin/settings`, `settings`, `components/{ui,branding}`):
yalnız **1** klon kaldı — `avatar-uploader.tsx` ↔ `logo-uploader.tsx` (13 satır, madde 6).

## 2. Değişen / eklenen dosyalar (`apps/web/` altında)

Değişen: `app/(auth)/change-password/change-password-form.tsx`, `app/(auth)/reset-password/reset-form.tsx`,
`app/(panel)/admin/settings/{mysql,turn,whatsapp}/page.tsx`, `admin/settings/mysql/mysql-form.tsx`, `admin/settings/turn/turn-form.tsx`,
`components/ui/skeleton.tsx` (yeni dışa açık `ListPageSkeleton`), `app/(panel)/admin/tenants/loading.tsx`, `app/(panel)/users/(list)/loading.tsx`.

Eklenen: `app/(auth)/password-fields.tsx`, `admin/settings/{page-error,env-reset}.tsx`, `admin/settings/mysql/{use-mysql-form.ts,mysql-parts.tsx}`,
`admin/settings/turn/{use-turn-form.ts,turn-parts.tsx}`.

Parça B / K13 dosyalarına dokunulmadı (`users/(list)/loading.tsx` ve `admin/tenants/loading.tsx` görev metnindeki
"tüm loading.tsx" kapsamında).

## 3. Kararlar / notlar

1. **Efekt sırası:** `TurnForm`'da önce hata odağı (`useFocusFirstError`, bileşende), sonra satır odağı (`useTurnRows`, kancada)
   — eskisiyle aynı. `formRef`/`addRef` bileşende oluşturulup kancaya parametre geçer; efekt bağımlılıklarına eklendi (kararlı ref, davranış aynı).
2. **Otomatik odak** `ChangePasswordForm`/`ResetForm`'da eskisi gibi senkron, ada göre (`focusFirstField`); `useFocusFirstError`'a
   çevrilmedi (çizim sonrası odaklamak davranış farkı olurdu).
3. **`ListPageSkeleton`** `ui/skeleton.tsx`'e eklendi (yeni dosya/primitif değil, mevcut iskeletin bileşimi). DESIGN.md
   bileşen tablosundaki `ui/skeleton.tsx` satırına "liste sayfası iskeleti" notu eklenebilir — DESIGN.md bu parçanın dosya
   listesinde olmadığı için güncellenmedi.
4. **Sonraki adım `WhatsappForm` planı:** `use-whatsapp-form.ts` (taslak/apply/reset, kaydet, ortama dön), iki odak efekti
   (`urlRef` → `keyRef`, sıra korunmalı) bileşende küçük bir `useFocusOn(ref)` kancasıyla iki kez; `whatsapp-parts.tsx`
   (uyarılar, servis bölümü); "Ortam değişkenine dön" düğmesi + diyaloğu `env-reset.tsx` ile (`testId="wa-svc-reset"` →
   `wa-svc-reset-dialog` / `wa-svc-reset-confirm`, metin `wa.svc.reset*`). `aria-invalid` odaklı değil → `useFocusFirstError` uygulanmaz.

## 4. Doğrulama (tur sonu)

- `tsc --noEmit` (web): temiz.
- ESLint (React Compiler dahil) değişen/eklenen dosyalarda: 0 hata; 40-satır uyarısı 2 (`useChangePassword` 49, `ServerSection` 49; ≤ 60).
- Prettier yalnız bu dosyalara uygulandı.
- `vitest`: 386/386; `vitest list` önce = sonra (aynı).
- `playwright test --list`: önce = sonra (645 satır, satır numarası hariç).
- Etkilenen e2e (`auth`, `p10-account`, `p11-admin`, `p12b-whatsapp`, `p14a-a4`, `p9-users`, `p16`): 142 geçti, 0 kırmızı, 58 atlandı.
- **Tam e2e** (`pnpm --filter @remote/web e2e`): **443 geçti, 0 kırmızı**, 200 atlandı.
- Ölçüm (tur başı): `scripts/pt-olcum.sh <dizin> boyut fonk knip jscpd i18n` — scratchpad `pt-k15c/once/` (oturum dizini, kalıcı değil);
  kapsam dosya listesi + ESLint ölçümü için `files.sh` / `olc.sh` aynı yerde (yeniden üretilebilir: §1'deki kapsam tanımı).

## 5. 2. tur (yarım; tur sınırında durdu)

Kural aynı: davranış / görünüm değişmez; testid / role / aria-* / sınıf / metin aynı; efekt sırası korunur; commit yok.

| Madde                                | Önce                                  | Şimdi                                                                                                                                                                                                                                                                                                                                                                                                                   | Durum     |
| ------------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1) `WhatsappForm`                    | 244 / cx 18 (dosya 302), submit cx 17 | `whatsapp-form.tsx` 56 (`WhatsappForm` ≤ 40); `use-whatsapp-form.ts` 171 (`useWaDraft`, `validateWa`, `applyServerFields`, `useWaSave`, `useWaReset`, `useWaKeyRemove`, `useWhatsappForm`); `whatsapp-parts.tsx` 146 (`WhatsappAlerts`, `ServiceSummary`, `ServiceSection`, `WhatsappFields`, `WhatsappDialogs`); "Ortam değişkenine dön" → `EnvResetButton` / `EnvResetDialog` (`wa-svc-reset`, `-dialog`, `-confirm`) | tamam     |
| 2) `ConsentForm`                     | 217 / cx 21, save cx 18               | `consent-form.tsx` 57; `use-consent-form.ts` 117 (`saveFailure`, `useConsentDraft`, `useConsentSave`, `useConsentForm`); `consent-parts.tsx` 204 (`ConsentAlerts`, `CurrentSection`, `CurrentMeta`, `BodyCount`, `BodyField`, `VersionRow`, `VersionHistory`, `ConfirmDialog`). `consentLength` artık dışa açık değil (yalnız kanca kullanıyordu)                                                                       | tamam     |
| 3) `Combobox` + `comboKey`           | 233 / cx 40; `comboKey` cx 24         | `ui/combobox.tsx` 187 (`Combobox`, `ComboList`, `ComboStatusLine`, `ComboMessages`, `ComboInput`, `ClearButton`; hepsi ≤ 40 / cx ≤ 15); yeni `ui/use-combobox.ts` 162 (`useComboData`, `useComboText`, `comboActions`, `runAction`, `useScrollActive`, `useCombobox`); `lib/combobox.ts` `comboKey` → tuş tablosu (`Map`) + `step`/`jump`, cx ≤ 15                                                                      | tamam     |
| 4) `AvatarUploader` 224 + logo klonu | jscpd 13 satır                        | okundu, dokunulmadı                                                                                                                                                                                                                                                                                                                                                                                                     | **kalan** |
| 5) Kapsam lib knip export'ları       |                                       | başlanmadı                                                                                                                                                                                                                                                                                                                                                                                                              | **kalan** |
| 6) Ölü i18n anahtarları (EN SON)     | 27 aday / 153 dinamik aday            | başlanmadı                                                                                                                                                                                                                                                                                                                                                                                                              | **kalan** |

Kapsam ESLint ölçümü (40 / cx 15, `olc.sh`): **52 → 43 uyarı**. Kapsamda kalan (görev listesinde olmayan) WhatsApp uyarıları:
`WhatsappTestSection` 111, `WhatsappApiKeyField` 67, `WhatsappApiKeyRemoveDialog` 53 — bu tur dokunulmadı.

### Kararlar / notlar (2. tur)

1. **Odak (WhatsApp):** yeni `lib/use-focus-error.ts` `useFocusOn<T>()` → `{ ref, focus }`; bileşende iki kez (önce adres, sonra anahtar —
   eski efekt sırası). `focus` işlevleri forma parametre geçer (PT-K15.md §3-1 deseni); `useHydrated` yine ilk çağrı.
2. **Odak (Consent):** eskisi gibi **senkron** (olay işleyicisinde `areaRef.current?.focus()`); `areaRef` bileşende oluşturulup kancaya
   geçer. 400 `body` hatasında textarea o anda `disabled` olduğu için odak etkisiz kalıyordu — davranış korunmak için aynen bırakıldı
   (ayrı düzeltme konusu; davranış değişikliği bu işin kapsamı dışında).
3. **WhatsApp diyalog:** eski elle yazılmış "Ortam değişkenine dön" `Dialog`'u `EnvResetDialog` ile birebir aynı DOM (alertdialog, sm,
   Vazgeç `data-autofocus`, `rq.rj.cancel`, `RotateCcw`); DELETE gövdesizse GET ile yeniden alma mantığı WhatsApp'a özgü kaldı.
4. **Combobox:** efekt sırası korunur — önce söküm temizliği (`useComboData`), sonra etkin seçenek kaydırma (`useScrollActive`).
   Dışarıdan değişen seçim çizim sırasında yansıtılır (efektsiz, eskisi gibi). `useId` tek çağrı (kimlikler aynı biçim). `ComboOption`
   dışa açık arayüzü değişmedi; `ComboboxProps` / `ComboStatus` yalnız yeni kanca dosyası için dışa açıldı (tip). `use-combobox.ts`
   bir primitif değil, `combobox.tsx`'in kancası — DESIGN.md'ye eklenmedi.
5. **Sonraki adım `AvatarUploader` planı:** klon `onFile` (ön kontrol → data URL → `loadImage` → boyut kontrolü) + `noop`/`useSyncExternalStore`
   hidrasyon kalıbı + gizli `input[type=file]` → `components/branding/` altında ortak `useImagePick(kind, onPicked)` kancası ve `HiddenFileInput`;
   avatar: `use-avatar-uploader.ts` (kaydet / kaldır), `CropDialog`, `RemoveDialog`. Logo ayrımları (hata `setError` tek alan, avatar `dialogError`)
   korunmalı; testid'ler `${testId}-input|-pick|-remove|-error`, `avatar-crop-*`, `logo-remove-*`.

### Doğrulama (2. tur sonu)

- `tsc --noEmit` (web): temiz.
- ESLint (proje yapılandırması, React Compiler dahil) değişen/eklenen dosyalarda: 0 hata, 0 uyarı; 40/cx15 kuralıyla bu dosyalarda uyarı yok
  (dokunulmayan `whatsapp-test-section`, `whatsapp-api-key-field` hariç).
- Prettier yalnız değişen/eklenen dosyalara uygulandı.
- `vitest`: 386/386; `vitest list` önce = sonra (aynı).
- `playwright test --list`: önce = sonra (645 satır, satır numarası hariç).
- **e2e bu turda koşulmadı:** ölçüm anında paralel bir ajanın `playwright test` süreci çalışıyordu (mock API 4217 portu çakışır). Sonraki
  turda etkilenen spec'ler (`p12b-whatsapp`, `p13a`, `p19-j5`, `p11-admin`, combobox kullananlar: `p8-history`, `customers`, `p14a-a4`,
  `p16`, `p13bl-lobby`, `sessions`) ve tur sonunda tam `pnpm --filter @remote/web e2e` koşulmalı.

### Değişen / eklenen dosyalar (2. tur, `apps/web/` altında)

Değişen: `app/(panel)/admin/settings/whatsapp/whatsapp-form.tsx`, `app/(panel)/settings/consent-text/consent-form.tsx`,
`components/ui/combobox.tsx`, `lib/combobox.ts`, `lib/use-focus-error.ts` (`useFocusOn` eklendi).

Eklenen: `admin/settings/whatsapp/{use-whatsapp-form.ts,whatsapp-parts.tsx}`, `settings/consent-text/{use-consent-form.ts,consent-parts.tsx}`,
`components/ui/use-combobox.ts`.
