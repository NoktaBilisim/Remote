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
