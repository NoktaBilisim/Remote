# PT-K13 — 3. tur, parça C (talepler sayfası/yazışma/diyaloglar, ayar artıkları) — frontend-dev

Tarih: 2026-11-15 · Dal: `pt-wip` · Tasarım: `docs/mimari-temizlik.md` §1, §5 K13 · Yöntem/kararlar: `PT-K13.md` §3, §6.
Kural: davranış ve görünüm değişmez; dışa açık adlar yerinde (`RequestsPage`, `RequestThread`, `RejectDialog`,
`AssignMenuItems`, `AssignDialog`, `AssignActions`, `RevokeBindingDialog`, `RequestCustomerFilter`,
`SupportRequestSettingsPage`, `HolidayActions`, `buildInput`); yalnız dosya-içi yardımcılar çıkarıldı. Yeni bağımlılık yok.

**Durum: kod tamam (kapsam ölçümü 15 → 0 uyarı); hedefli e2e bu turda koşulmadı (§4).**

## 1. Sonuç

| Hedef                                        | Önce                    | Sonra                                                                                                                                                          |
| -------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requests/page.tsx` `RequestsPage`           | dosya 318 · 258 · cx 47 | dosya 86 · ≤ 40 · cx ≤ 15; `query.ts` (URL ayrıştırma, `href`, `linkFor`, `listPath`), `page-parts.tsx` (başlık, sekme/filtreler, hata, Geçmiş, Bekleyenler) |
| `request-thread.tsx` `RequestThread`         | dosya 357 · 303 · cx 32 | dosya 67 · ≤ 40; `use-thread.ts` (`useThreadMessages`, `useScrollToEnd`, `useThreadSend`), `thread-parts.tsx`                                                  |
| gönderim işlevi                              | 44 · cx 19              | ≤ 40, cx ≤ 15 (`optimistic`, `applySendError`)                                                                                                                 |
| `RejectDialog`                               | 122                     | ≤ 40 (`useRejectState`, `useRejectForm`, `RejectChoices`, `RejectOther`, `RejectFooter`)                                                                       |
| `AssignMenuItems` / `AssignDialog`           | 63 / 82                 | ≤ 40 (`MenuButton`, `PriorityGroup`, `loadAssignable`, `AssignFooter`, `useAssignPick`)                                                                        |
| `RevokeBindingDialog`                        | 58                      | ≤ 40 (`useRevoke`)                                                                                                                                             |
| `RequestCustomerFilter`                      | 52                      | ≤ 40 (`useCustomerFilter`)                                                                                                                                     |
| `SupportRequestSettingsPage`                 | 58                      | ≤ 40 (`SrsHeader`, `Forbidden`)                                                                                                                                |
| `HolidayActions`                             | 46                      | ≤ 40 (`HolidayButtons`)                                                                                                                                        |
| `lib/requests/settings-form.ts` `buildInput` | 60 · cx 18              | ≤ 40, cx ≤ 15 (`uniqueList`, `hasRowError`, `parsePhone/Email/Cidr`, `checkWait/Whatsapp/Email`)                                                               |

Kapsam ölçümü (`max-lines-per-function` 40, `complexity` 15; dizinler `requests`, `settings/{support-requests,business-hours}`,
`lib/requests/settings-form.ts`, `components/settings`): **15 → 0**. Kapsamda > 300 satır dosya yok (en büyük `request-queue` 286).
Gerekçeli istisna: yok.

## 2. Değişen / eklenen dosyalar (`apps/web/` altında)

Değişen: `app/(panel)/requests/{page,request-thread,reject-dialog,assign-menu,revoke-binding-dialog,customer-filter}.tsx`,
`app/(panel)/settings/support-requests/page.tsx`, `app/(panel)/settings/business-hours/holiday-parts.tsx`, `lib/requests/settings-form.ts`.
Eklenen: `app/(panel)/requests/{query.ts,page-parts.tsx,use-thread.ts,thread-parts.tsx}`.
Kapsam dışına dokunulmadı (`components/settings/**` değişmedi).

## 3. Kararlar

1. **DOM/testid/aria/sınıf/metin aynı.** Sayfa dalları (yetki yok, firma seç, hata/403, Geçmiş, Bekleyenler) aynı öğe
   sırasını üretir; `header`/`tabs` JSX değişkenleri bileşen oldu (DOM aynı). Atama filtresi Geçmiş'te yine çizilmez.
   Kaynak/atama filtreleri tek `OptionNav` ile (öğeler, `key`, `aria-current`, sınıflar aynı).
2. **Efekt sırası (RequestThread):** öğe ref eşitleme → ilk yükleme → `activity` → yoklama → kaydırma. Kaydırma efekti
   `useScrollToEnd` içinde ve `useThreadMessages`'dan **sonra** çağrılır (ref kancada oluşur; React Compiler
   `react-hooks/immutability` kanca argümanı olan ref'in DOM düğümüne yazmayı reddettiği için). `fetchMessages`
   bağımlılığına kararlı `itemsRef` eklendi (yeniden oluşma koşulu aynı).
3. **`useId`:** radyo grubu adı `RejectChoices`'a, yazışma kimlikleri aynı bileşende; opak değerler farklı olabilir,
   eşleşmeler (`htmlFor`↔`id`, `aria-describedby`, `aria-labelledby`) aynı.
4. **`AssignDialog` yükleyici:** `useCallback(…, [])` → modül düzeyi `loadAssignable` (kimlik zaten kararlıydı; gövde aynı).
5. **`buildInput`:** üç liste döngüsü `uniqueList` ile; boş satır atlama, hata anahtarları, tekrar/üst sınır ve
   "gerekli" kontrollerinin `errors`'a ekleme **sırası aynı** (ilk hataya odak sırası korunur). E-postada boş satır
   denetimi `trim()` ile (önce `trim().toLowerCase()` boşluğu — eşdeğer).
6. PT bulguları: yok.

## 4. Doğrulama

- `pnpm --filter @remote/web typecheck`: temiz.
- `eslint` (kapsam dizinleri + `lib/requests`, `components/settings`): 0 hata/uyarı (React Compiler kuralları dahil).
- `vitest run`: 43 dosya / 386 test geçti; `vitest list` önce/sonra sıralı **aynı** (351 satır).
- `playwright test --list`: önce/sonra **aynı** (643 test, 24 dosya, satır numaraları dahil).
- Prettier yalnız kapsam dosyalarına.
- _*Hedefli e2e (p8b-requests, p18, p19, p15, p13*, ayar spec'leri) bu turda koşulmadı_* (tur sınırı) — sonraki adım.
