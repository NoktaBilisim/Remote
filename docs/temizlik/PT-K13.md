# PT-K13 — talepler / ayar formları / web talep temizliği (frontend-dev)

Tarih: 2026-11-15 · Dal: `pt-wip` · Tasarım: `docs/mimari-temizlik.md` §5 K13 · AC: `docs/gereksinimler.md` §10.
Kural: davranış ve görünüm değişmez; dışa açık adlar bulundukları modül yolundan verilir; yeni bağımlılık yok.
**Durum: KISMİ (1. ve 2. tur; ayrıntı §6).** Ayar formları (SMTP, SMS, destek talepleri, mesai saatleri, tatiller) bitti; talep kuyruğu
(`app/(panel)/requests/**`) ve web talep (`app/r/**`) sonraki turda.

## 1. Durum özeti

| Hedef (§5 K13)                                                                             | Önce                          | Sonra                                                                 | Durum                      |
| ------------------------------------------------------------------------------------------ | ----------------------------- | --------------------------------------------------------------------- | -------------------------- |
| `SettingsForm` (support-requests)                                                          | dosya 611 · 440 satır · cx 20 | dosya 71 · ≤ 40 satır (+ bölüm bileşenleri, kancalar)                 | tamam                      |
| `SmtpForm`                                                                                 | dosya 360 · 298 · cx 28       | dosya 57 · ≤ 40 (+ `smtp-sections`, `use-smtp-form`)                  | tamam                      |
| `SmsForm`                                                                                  | dosya 294 · 251 · cx 26       | dosya 61 · ≤ 40 (+ `sms-sections`, `use-sms-form`)                    | tamam                      |
| `BusinessHoursForm`                                                                        | dosya 283 · 207               | ≤ 40 (+ `hours-parts`, `use-business-hours`)                          | tamam                      |
| `HolidaysSection`                                                                          | dosya 345 · 297 · cx 16       | ≤ 40 (+ `holiday-parts`, `use-holidays`); `HolidayActions` 46         | tamam (1 hedef üstü, < 60) |
| Ayar formu iskelet klonu (3 form) `Section`                                                | jscpd klon (19/17 satır)      | `components/settings/section.tsx` (`SettingsSection`)                 | tamam                      |
| Test-telefon klonu sms ↔ srs (11 satır)                                                    | jscpd klon                    | `components/settings/phone-test.tsx` (`usePhoneTest`, `PhoneTestRow`) | tamam                      |
| Kirli kaydet çubuğu (sms ↔ srs)                                                            | kopya                         | `components/settings/dirty-bar.tsx` (`DirtyBar`)                      | tamam                      |
| `RequestQueue` 364, `RequestThread` 303, `RequestCard` 196/cx 38, `RequestsPage` 258/cx 47 | —                             | —                                                                     | **kalan**                  |
| `request-history` ↔ `request-queue` klonu                                                  | jscpd klon                    | —                                                                     | **kalan**                  |
| `WaitingRoom` 271, `WebRequestForm` 198                                                    | —                             | —                                                                     | **kalan**                  |
| Kapsam knip export'ları (11 export, 11 tip)                                                | —                             | —                                                                     | **kalan**                  |

Kapsam ESLint ölçümü (`max-lines-per-function` 40, `complexity` 15; `scratchpad` betiği, `scripts/pt-olcum.sh fonk`
ile aynı kurallar): **43 → 29 uyarı** (ayar dizinleri 23 → 4). Kapsamda > 300 satır dosya: **8 → 6** (kalanların hepsi
`requests/` ve `r/`). Ayar dizinlerinde kalan: `HolidayActions` 46, `SupportRequestSettingsPage` 58 (dokunulmadı),
`lib/requests/settings-form.ts buildInput` 60 / cx 18 (dokunulmadı).

## 2. Değişen / eklenen dosyalar (`apps/web/` altında)

Değişen: `app/(panel)/settings/{smtp/smtp-form,sms/sms-form,support-requests/settings-form,business-hours/business-hours-form,business-hours/holidays-section}.tsx`.

Eklenen:

| Dosya                                                                                               | İçerik                                                                                                                                           |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `components/settings/section.tsx`                                                                   | `SettingsSection` — kart + ikonlu `h2` (`${id}-h`), isteğe bağlı `testId`, `after` (kart içi, yığın dışı)                                        |
| `components/settings/dirty-bar.tsx`                                                                 | `DirtyBar` — form içi yapışkan "kaydedilmemiş değişiklik" çubuğu (srs, SMS)                                                                      |
| `components/settings/phone-test.tsx`                                                                | `usePhoneTest` + `PhoneTestRow` — WhatsApp/SMS test gönderimi (alan, düğme, sonuç bandı)                                                         |
| `components/settings/use-unauth.ts`                                                                 | `useUnauthRedirect` — 401 → `EXPIRED_LOGIN_PATH` `replace`                                                                                       |
| `settings/support-requests/{use-settings-form.ts,sections.tsx,notify-section.tsx,list-editor.tsx}`  | durum/kaydet/ref yenileme/kopyala kancaları; bölümler; bildirim (WA + e-posta); liste düzenleyici + `SettingsList` (wa/mail/cidr yapılandırması) |
| `settings/smtp/{use-smtp-form.ts,smtp-sections.tsx}`                                                | durum/düzenleme/PUT kancaları; sunucu, kimlik, gönderen, test bölümleri, temizleme diyaloğu                                                      |
| `settings/sms/{use-sms-form.ts,sms-sections.tsx}`                                                   | durum/kaydet; bantlar, bağlantı, anahtar bölümleri, anahtar silme diyaloğu                                                                       |
| `settings/business-hours/{use-business-hours.ts,hours-parts.tsx,use-holidays.ts,holiday-parts.tsx}` | mesai formu kancası + önizleme/saat dilimi/mod/hafta; tatil listesi/ekle/sil/içe aktar kancaları + liste durumları ve diyaloglar                 |

## 3. Kararlar ve sapmalar

1. **DOM/aria/seçiciler aynı.** Tüm `data-testid`, `role`, `aria-*`, sınıflar ve metinler korundu. `useId` ile üretilen
   kimlikler (liste düzenleyici hata kimliği, mesai modu açıklaması, `TextField` iç kimlikleri) bileşen ağacı değiştiği
   için farklı opak değer alır; eşleşmeler (`aria-describedby` ↔ `id`) aynı. Prop sırası yüzünden bazı öznitelik sıraları farklı.
2. **Efekt sırası.** Etkilenen formlarda tek efektler: `useLeaveGuard` (yer değişmedi), SMTP hata odağı (`useEffect`
   aynı kancada; `formRef` bileşende oluşturulup kancaya verildi — React Compiler `react-hooks/refs` kuralı ref'i içeren
   dönüş nesnesini ref sayıyor; bağımlılık listesine sabit `formRef` eklendi, çalışma koşulu aynı), tatil yılı yüklemesi
   (aynı). Saat dilimi `useMemo/useCallback` `TimeZoneField` içine taşındı (bileşen sürekli bağlı; `load` kimliği kararlı).
3. **`normalizePhone`:** srs `@/lib/requests/validate` yeniden-dışa-aktarımını, SMS contracts'ı kullanıyordu; ortak
   kanca contracts'tan alır (aynı işlev).
4. **DESIGN.md:** `components/settings/` yeni primitifleri DESIGN.md'ye işlenmedi (görev dosya listesi dışında) —
   K15/teknik yazar için not: `SettingsSection`, `DirtyBar`, `PhoneTestRow` belgelenmeli.
5. **PT bulguları:** yok.

## 4. Kalan (sonraki tur)

`app/(panel)/requests/{page,request-queue,request-thread,request-card,request-history,assign-menu,reject-dialog,revoke-binding-dialog,customer-filter}.tsx`,
`app/r/[ref]/{waiting-room,web-request-form,web-request-flow,request-chat}.tsx`, `settings/support-requests/page.tsx` (58),
`HolidayActions` (46), `lib/requests/settings-form.ts buildInput` (60/cx 18), `request-history ↔ request-queue` klonu,
kapsamdaki knip adları (`lib/requests/{contract,business-hours,blocks,thread,panel-socket,sound,p18,source}.ts`,
`lib/notify/send-link.ts`, `lib/web-request/flow.ts`, `request-card.tsx SourceIndicator/RequestCode`). e2e koşusu
(`pnpm --filter @remote/web e2e`) bu turda **yapılmadı**.

## 5. Doğrulama (1. tur sonu)

- `pnpm --filter @remote/web typecheck`: temiz.
- `eslint .`: K13 dosyalarında 0 hata/uyarı. Depoda 14 hata var, hepsi `app/(panel)/users/new-user-dialog.tsx`
  (`react-hooks/refs`) — K15'in yarım dosyası, K13 ile ilgisiz.
- `vitest`: 43 dosya / 386 test geçti; `vitest list` önce/sonra sıralı karşılaştırmada **aynı** (351 satır; yalnız dosya
  sırası farklı). Test dosyalarına dokunulmadı.
- `playwright test --list` önce: 643 test (sonra karşılaştırması ve e2e koşusu sonraki turda).
- Prettier yalnız değişen/eklenen dosyalara; `prettier --check` temiz.

## 6. 2. tur (2026-11-15) — talep kuyruğu, kart, Geçmiş klonu, knip

**Durum: KISMİ (2. tur, tur sınırında tutarlı noktada durdu).** Yöntem 1. turla aynı (dosya-içi yardımcı çıkarma,
dışa açık adlar yerinde; `RequestStatusBadge`, `RequestCard`, `RequestQueue`, `RequestHistory` aynı dosyalarda).

### 6.1 Biten

| Hedef                                 | Önce                                    | Sonra                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RequestQueue` (`request-queue.tsx`)  | dosya 448 · 364 satır · cx 28 (+ cx 18) | dosya 286 · ≤ 40; kancalar `use-request-queue.ts` (`useQueueThread`, `useQueueList`/`useQueueRefresh`, `useQueueLive`, `useWide`), `use-queue-actions.ts` (`useAcceptFlow`, `useAssignFlow`, `usePriority`)                                                                                                                                                                                                                                                                                                          |
| `RequestCard` (`request-card.tsx`)    | dosya 432 · 196 · cx 38                 | dosya 201 · ≤ 40, cx ≤ 15 (`cardMenu`, `DangerItem`, `ThreadButton`, `PendingBar`, `CardMain`); çizim parçaları `request-card-parts.tsx` (`SourceIndicator`, `RequestCode`, `CardFacts`, `P18Badges`, `ClosedInfo`)                                                                                                                                                                                                                                                                                                  |
| `SourceIndicator` 65, `ClosedInfo` 53 | —                                       | ≤ 40 (`BindingNotes`, `KnownSource`, `Fact`, `ClosedRow`)                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `request-history` ↔ `request-queue`   | jscpd klon (engelle + kayıt iptali)     | `card-dialogs.tsx` (`useCardMenus`, `CardMenuDialogs`); `RequestHistory` 51 → ≤ 40                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Kapsam knip (11 export + 11 tip)      | 22                                      | 0 — hepsi `git grep` ile teyitli (yalnız tanımlandığı dosyada kullanılıyor): `contract.ts` 3 export + 3 tip yeniden-dışa-aktarımı silindi; `export` kaldırıldı: `DEFAULT_TIME_ZONE` (yeniden-dışa-aktarım), `DURATION_NONE`, `durationLabel`, `MESSAGE_LINES_MAX`, `MessageSender`, `RequestMessage`, `BodyCheck`, `PANEL_RETRY_JITTER`, `SOUND_KEY`, `RequestUpdate`, `SendLinkFailure`, `SourceReason`, `SourceView`, `SubmitFailure`; `SourceIndicator`/`RequestCode` parça dosyasına taşındı (kart içi kullanım) |
| DESIGN.md                             | `components/settings` belgesiz          | §6 tablosuna `SettingsSection`, `DirtyBar`, `PhoneTestRow`/`usePhoneTest` satırları                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Kararlar: (1) DOM/testid/aria/sınıf/metin aynı; `RequestCard` menüsü bileşen değil öğe üreten işlev (`cardMenu`) — öğe
ağacı ve "menü var mı" koşulu aynı. (2) Efekt sırası aynı: yazışma ref'i → liste ref'i → saat ofseti → panel olayları →
pageshow → yoklama; `useNow`/`useWide`/`useRequestNotifier` yine `RequestQueue` içinde. Efekt bağımlılık listelerine
kanca dönüşündeki kararlı ref/setter'lar eklendi (yeniden çalışma koşulu aynı). (3) `assignTo` hata dalı
`userIdError` ile sadeleştirildi: gösterilen mesaj/nesne (`{ message, tone, requestId }`) ve dal sırası aynı.
(4) `CardMenuDialogs` iptal sonrası sıra: diyalog kapat → `onRemoved` (kuyruk: kart düşer) → toast → `onRefresh`
(kuyruk `refresh()`, Geçmiş `router.refresh()`) — her iki çağıranda önceki sıra.

### 6.2 Kalan (3. tur)

`page.tsx` `RequestsPage` 258 / cx 47 (dosya 318), `request-thread.tsx` `RequestThread` 303 / cx 32 (+ gönderim 44 / cx 19,
dosya 357), `reject-dialog` 122, `assign-menu` `AssignMenuItems` 63 / `AssignDialog` 82, `revoke-binding-dialog` 58,
`customer-filter` 52; `app/r/[ref]/` `WaitingRoom` 271 (dosya 329), `WebRequestForm` 198, `WebRequestFlow` 92,
`RequestChat` 102; `settings/support-requests/page.tsx` 58, `HolidayActions` 46, `lib/requests/settings-form.ts buildInput` 60 / cx 18.
Kapsam ESLint ölçümü (test dosyaları hariç): **32 → 24** uyarı;
kapsamda > 300 satır dosya: **6 → 3** (`page.tsx` 318, `request-thread.tsx` 357, `waiting-room.tsx` 329; `request-queue` 286, `request-card` 201).

### 6.3 Doğrulama (2. tur sonu)

- `pnpm --filter @remote/web typecheck` (`tsc --noEmit`): temiz.
- `eslint` (`app/(panel)/requests`, `lib/requests`, `lib/notify`, `lib/web-request`): 0 hata/uyarı (React Compiler kuralları dahil).
- `vitest run`: 386 / 386 geçti; `vitest list` önce/sonra sıralı karşılaştırma **aynı** (351 satır).
- `playwright test --list`: önce/sonra **aynı** (643 test, 24 dosya; satır numaraları dahil — test dosyalarına dokunulmadı).
- e2e (hedefli): `playwright test p8b-requests p18 p19 p15 customers` → **100 geçti, 64 atlandı (proje/genişlik koşullu), 0 kırmızı**. Tam e2e koşusu 3. tura bırakıldı.
- Prettier yalnız değişen/eklenen dosyalara.
