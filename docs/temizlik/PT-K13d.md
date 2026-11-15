# PT-K13 3. tur, parça D — herkese açık web talep sayfası (`app/r/**`, `lib/web-request/**`)

Tarih: 2026-11-15 · Dal: `pt-wip` · Tasarım: `docs/mimari-temizlik.md` §1, §5 K13 · Yöntem: `docs/temizlik/PT-K13.md`.
Kural: davranış ve görünüm değişmez. Güvenlik davranışı (CSRF/başlık/hız sınırı yanıtları, metin kaçışlama, dış bağlantı yok) birebir.
**Durum: TAMAM** (kapsamda işlev > 40 yok, cx > 15 yok, dosya > 300 yok; istisna yok).

## 1. Ölçüm (`max-lines-per-function` 40, `complexity` 15; test dosyaları hariç)

| İşlev / dosya                      | Önce                                                 | Sonra                                                                                            |
| ---------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `WaitingRoom` (`waiting-room.tsx`) | dosya 329 · 271 satır · cx 20; soket efekti 79/63/42 | dosya 64 · ≤ 40                                                                                  |
| `WebRequestForm`                   | dosya 262 · 198 · cx 22                              | dosya 48 · ≤ 40                                                                                  |
| `WebRequestFlow`                   | 92                                                   | ≤ 40 (dosya 154)                                                                                 |
| `RequestChat`                      | 102                                                  | ≤ 40 (dosya 150)                                                                                 |
| Kapsam uyarısı                     | 9                                                    | 0 (yalnız `lib/web-request/flow.test.ts` `describe` 51 — test dosyası, kapsam dışı, dokunulmadı) |

## 2. Eklenen / değişen dosyalar (`apps/web/app/r/[ref]/`)

Değişen: `waiting-room.tsx`, `web-request-form.tsx`, `web-request-flow.tsx`, `request-chat.tsx`. `lib/web-request/flow.ts` değişmedi.

| Eklenen                   | İçerik                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request-socket.ts`       | `Phase` (+ `ClosedPhase`, `AcceptedPhase`), çerçeve işleme (`applyChatFrame`, `applyFrame`, `parseFrame`), `startRequestSocket` (yeniden bağlanma; `halt`/`close`) |
| `use-waiting-room.ts`     | `useWaitingRoom` = `useRequestChannel` (durum, ref'ler, `finish`, soket + 1 sn sayaç efekti) + `useWaitingActions` (sohbet, iptal, vazgeç)                         |
| `waiting-parts.tsx`       | `ClosedScreen` (+ `endOf`), `AcceptedCard` (+ `VerifyCodes`), `LostBanner`, `WaitingCard` (+ `PendingFacts`)                                                       |
| `use-web-request-form.ts` | `WebRequestFormProps`, `useWebRequestForm`, `useSubmitWait` (2 sn sayacı), `applyFailure`, `fixError`, `failureMessage`                                            |
| `web-request-fields.tsx`  | `AfterHoursNote`, `ContactFields` (+ `Honeypot`, `Description`), `NotifyChoices`, `ConsentFields`, `SubmitButton`                                                  |

`request-chat.tsx` içinde `ChatHeader`, `ChatList`, `ChatComposer`; `web-request-flow.tsx` içinde `useWebRequestFlow`, `saveStored`/`clearStored`,
`FlowLoading`, `flowBody` (öğe döndüren işlev; ağaç önceki gibi doğrudan `GuestShell` çocuğu).

## 3. Kararlar

1. **DOM/testid/aria/sınıf/metin aynı.** `useId` kimlikleri ağaç değiştiği için farklı opak değer alır, eşleşmeler aynı
   (`${hintId}-c`, saklama satırı `id` ↔ gönder `aria-describedby`, açıklama `-e`, sohbet etiketi).
2. **Efekt sırası aynı:** `phaseRef` → `onFinishedRef` → soket + sayaç (bekleme); form: tek sayaç efekti; sohbet: kaydırma efekti
   (`listRef` `ChatList`'e prop olarak verilir, efekt `RequestChat`'te). Soket efekti bağımlılığına sabit `ws` ref'i eklendi
   (yeniden çalışma koşulu aynı). Temizlik sırası aynı: durdur + zamanlayıcı → sayaç → soketi kapat.
3. **React Compiler `react-hooks/refs`:** `ws` ref'i `useWaitingRoom` içinde oluşturulup alt kancalara verilir; kanca dönüşlerinde ref yok.
4. **Sohbet taslağı** (`text`, `last`) `RequestChat`'te kaldı: gönderim kutusu (`enabled`) kapanıp açılınca taslak önceki gibi korunur.
5. **Form hata dalı:** `catch` içinde `applyFailure` eşzamanlı (404 → `onNotFound`, yenileme yok; diğerleri → mesaj, gerekirse
   `await refreshInfo()`); `finally` sırası ve mikro-görev sayısı önceki gibi.
6. **Güvenlik davranışı:** POST/GET yolları, `submitFailure` eşlemesi (429/503/4xx → yeni token), 2 sn kapısı, gizli `website`
   alanı, metin düğümü + `pre-wrap` (HTML yok), indirme bağlantısı (aynı köken) değişmedi; `page.tsx` (`no-referrer`, `noindex`) dokunulmadı.
7. Kapanış ekranı artık `ClosedScreen` bileşeni: kök `div` önceki bekleme `div`'i ile aynı türde olduğu için eskiden DOM düğümü
   yeniden kullanılıyordu, şimdi yeniden bağlanıyor — çocukların hepsi zaten yeniden bağlanıyordu; görünür/erişilebilir fark yok.
8. `ContactFields` adı `app/(panel)/customers` içindeki aynı adlı bileşenle çakışmaz (ayrı modül).

## 4. Doğrulama

- `pnpm --filter @remote/web` `tsc --noEmit`: temiz. `eslint app/r lib/web-request`: 0 hata/uyarı (React Compiler kuralları dahil).
- `vitest run`: 386 / 386; `vitest list` önce/sonra **aynı** (351 satır).
- `playwright test --list`: önce/sonra **aynı** (643 test, 24 dosya).
- e2e: `playwright test p19-j5 --project=desktop --project=mobile` → **37 geçti, 7 atlandı** (`desktopOnly` koşullu), 0 kırmızı.
  `app/r` seçicilerini (`wr-*`, `chat-retention-notice`) kullanan tek spec `p19-j5`.
- Prettier yalnız kapsam dosyalarına; `--check` temiz.
