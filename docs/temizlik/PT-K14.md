# PT-K14 — konsol / misafir / işbirliği / kontrol / WebRTC / DC temizliği (frontend-dev)

Tarih: 2026-11-15 · Dal: `pt-wip` · Tasarım: `docs/mimari-temizlik.md` §5 K14 · AC: `docs/gereksinimler.md` §10.
Kural: davranış ve görünüm değişmez; dışa açık adlar bulundukları modül yolundan verilmeye devam eder; yeni bağımlılık yok.

## 1. Durum özeti

| Hedef (§5 K14)                                                                                 | Önce                                                                                 | Sonra                                                                                  | Durum             |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ----------------- |
| `components/console/stage.tsx` `Stage`                                                         | dosya 411 · 300 satır · cx 87                                                        | dosya 215 · 76 satır · cx 24 (+ katmanlar: şerit, üst katman, video, kancalar)         | kısmi (kalan, §4) |
| `console-view.tsx` `ConsoleView`                                                               | dosya 327 · 278 satır · cx 51                                                        | dosya 99 · 69 satır · cx ≤ 15                                                          | kısmi (kalan, §4) |
| `guest-session.tsx` `GuestSession`                                                             | dosya 304 · 251 satır · cx 23                                                        | dosya 212 · 78 satır · cx ≤ 15                                                         | kısmi (kalan, §4) |
| `lib/control/machine.ts` `onMsg`                                                               | 77 satır · cx 58                                                                     | işleyici tablosu (`ON_MSG`), her işleyici ≤ 20 satır, cx ≤ 15; dosya 299               | tamam             |
| `lib/webrtc/tech-machine.ts` `onMsg`                                                           | 54 satır · cx 41                                                                     | işleyici tablosu (`ON_MSG`), cx ≤ 15                                                   | tamam             |
| `lib/dc/files.ts`                                                                              | 614 satır, `onCtl` cx 24                                                             | 109 (cephe) + `file-model` 180 / `file-send` 163 / `file-receive` 221 / `file-disk` 95 | tamam             |
| `use-tech-session.ts` `useTechSession`                                                         | dosya 310 · 218 satır · `onMessage` cx 25                                            | dosya 189 · 69 satır · cx ≤ 15 (+ `use-tech-peer`, `use-tech-control`)                 | kısmi (kalan, §4) |
| Diyalog klonu `cancel-dialog` ↔ `terminate-dialog` (20 satır)                                  | jscpd klon                                                                           | ortak `use-session-action.ts`                                                          | tamam             |
| Kanca klonu `use-guest-session` ↔ `use-tech-session` (12)                                      | jscpd klon                                                                           | klon artık eşleşmiyor (jscpd 0); ortak kanca **eklenmedi** (§3)                        | tamam (gerekçeli) |
| Sohbet paneli klonu `collab-side` ↔ `guest-collab` (10)                                        | jscpd klon                                                                           | ortak `components/collab/tab-options.tsx`                                              | tamam             |
| `protocol.ts` ad takması                                                                       | `inputMsgSchema` + kullanılmayan `CONTROL_SOURCES`, `ControlSource`, `MOUSE_BUTTONS` | takma ad yerinde; kullanılmayan 3 ad budandı                                           | tamam             |
| Ek: `controlReducer` cx 21, `techReducer` cx 17, `guestReducer` cx 16, `sampleFromStats` cx 25 | > 15                                                                                 | hepsi ≤ 15 (kapanış/geri yükleme/istatistik yardımcıları çıkarıldı)                    | tamam             |

Kapsamdaki üretim dosyalarında ESLint ölçümü (`max-lines-per-function` 40, `complexity` 15): **59 → 52 uyarı**,
karmaşıklık uyarısı **20 → 10**. Kapsamda > 300 satır dosya: **5 → 0**. jscpd (≥ 8 satır / 70 belirteç) kapsamda **3 → 0** klon.

## 2. Değişen / eklenen dosyalar (`apps/web/` altında)

Değişen: `app/(panel)/sessions/{cancel-dialog,terminate-dialog}.tsx`, `app/(panel)/sessions/[id]/console/console-view.tsx`,
`app/session/[token]/{guest-session,guest-flow}.tsx`, `components/console/{stage,collab-side}.tsx`,
`components/guest/{guest-collab,share-strip}.tsx`, `lib/control/{machine,input,protocol}.ts`,
`lib/dc/{files,annot,chat,use-collab}.ts`, `lib/webrtc/{tech-machine,guest-machine,stats,peer,signal,use-tech-session,use-guest-session}.ts`.

Eklenen (hepsi görev dizinlerinde):

| Dosya                                                                     | İçerik                                                                                                  |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `components/console/stage-hooks.ts`                                       | `useStageVideo` (akış, "%100" boyutu), `useStripFit` (compact/tight ölçümü), `useFullscreen`            |
| `components/console/stage-overlay.tsx`                                    | `Msg` + `stageOverlay()` (bağlantı / bekleme / canlı katman mesajları, aynı öncelik sırası)             |
| `components/console/stage-strip.tsx`                                      | `StageStrip` (araç şeridi), görünüm segmenti, tam ekran düğmesi, WGC rozeti, dar sahne "Görünüm" menüsü |
| `components/collab/tab-options.tsx`                                       | `chatFilesOptions()` — Sohbet/Dosyalar sekme seçenekleri (konsol + müşteri)                             |
| `app/(panel)/sessions/use-session-action.ts`                              | İptal / zorla sonlandır diyaloğu ortak durumu (meşgul, 401 yönlendirme, 409/404 metni)                  |
| `app/(panel)/sessions/[id]/console/console-header.tsx`                    | Konsol üst barı + durum rozeti                                                                          |
| `app/(panel)/sessions/[id]/console/console-stage.tsx`                     | Konsol sahnesi bağlama (lobi, işaretleme, P7 kontrol çubuğu, monitör seçimi)                            |
| `app/(panel)/sessions/[id]/console/console-parts.tsx`                     | Bitti ekranı, bitir/iptal onayı, işaretleme araçları, kontrol çubuğu                                    |
| `app/(panel)/sessions/[id]/console/use-control-toasts.ts`                 | Kontrol/monitör durum geçişi bildirimleri                                                               |
| `app/session/[token]/guest-session-parts.tsx`                             | Dönüş kaydı kancası, lobi, yeniden bağlanma ekranı, uyarılar, önizleme (+PiP), bitir onayı              |
| `lib/control/counters.ts`                                                 | Sekme sayaç doğrulama yardımcıları (`num`, `ts`, `later`)                                               |
| `lib/webrtc/msg-table.ts`                                                 | `MsgTable<S>` / `applyMsg` — iki makinenin ortak işleyici tablosu tipi ve dağıtıcısı                    |
| `lib/webrtc/use-tech-peer.ts`                                             | Teknisyen PeerConnection, `input` DC, ICE yenileme, peer'e ait sunucu mesajları                         |
| `lib/webrtc/use-tech-control.ts`                                          | Kontrol makinesi + sekme sayaçları + kontrol/monitör istekleri                                          |
| `lib/dc/file-model.ts`, `file-send.ts`, `file-receive.ts`, `file-disk.ts` | Dosya transferi: model/depo, gönder, al, bellek/disk hedefi                                             |

## 3. Kararlar ve sapmalar

1. **`lib/dc/files.ts` yeniden dışa verme (taşıma kuralı yorumu).** Sınıfı bölebilmek için gönderen/alan parçaların kullandığı
   sabit ve tipler yaprak modüllere (`file-model.ts`, `file-disk.ts`) alındı; `files.ts` aynı adları **aynı yoldan** yeniden verir
   (`FileTransfers`, `diskSink`, `DISK_MIN_BYTES`, `sha256Hex`, `OFFER_LIMIT` …). Hiçbir çağıranın / testin import satırı
   değişmedi (K1'in `api/shared.ts` yaklaşımıyla aynı). Aksi halde ya `files.ts` > 300 kalırdı ya da import döngüsü oluşurdu.
   `FileTransfers` artık cephe: `TransferStore` (liste/prune) + `FileSender` + `FileReceiver`; `inCount`/`dropped` salt-okunur
   alıcıya (getter) dönüştü (hiçbir yer yazmıyordu). `onCtl` dağıtım sırası (file.cancel'da önce giden, sonra gelen) korundu.
2. **Kanca klonu için ortak kanca eklenmedi.** `useSignalBase` denendi; React Compiler lint kuralı (`react-hooks/immutability`)
   kancadan dönen ref'lerin `.current` yazımını hata sayıyor (ad `…Ref` ile bitmeli). Tüm kullanım yerlerini yeniden adlandırmak
   diff'i büyütür; `useTechSession` bölünürken ref bildirimleri yeniden düzenlendi ve jscpd klonu kendiliğinden kalktı.
   Kullanıcı ilkesi (gereksiz soyutlama yok) gereği ortak kanca bırakıldı.
3. **Efekt sırası.** Kancalar ayrılırken efektler aynı çağrı sırasında kaldı. Tek fark `Stage`: pasif efektler
   `srcObject → video boyutu dinleyicisi → stil → ResizeObserver → tam ekran` sırasında (önce `srcObject → ResizeObserver → …`);
   bu efektler birbirinden bağımsız, gözlenebilir fark yok. `useLayoutEffect` (şerit ölçümü) yine her çizimde çalışır.
4. **DOM/aria/seçiciler.** Tüm `data-testid`, `role`, `aria-*`, `id` ve sınıflar aynı; `stage-scroll` üzerindeki
   `tabIndex/role/aria-label` artık bir yardımcıdan yayılıyor (değerler aynı, yalnız öznitelik sırası farklı).
   `useId` ile üretilen kimlikler (örn. konsoldaki pasif kontrol ipucu) yine aynı bileşende (`ConsoleView`) üretilir.
5. **Kullanılmayan dışa açık adlar (knip) budandı:** `export` kaldırıldı (dosya içinde kullanılmaya devam): `DENY_COOLDOWN_MS`,
   `shareFailOf`, `KEY_CODE`, `Box`, `KeyLike`, `CHAT_KEEP`, `ChatItem`, `ChatState`, `ChatAction`, `MAX_PTS`, `MAX_STROKES`,
   `LASER_FADE_MS`, `SUSTAIN_MS`, `RESUME_RETRY_MS`, `RESUME_MAX_ATTEMPTS`, `toRtcIce`, `GuestEvent`, `SignalHandlers`, `GuestInfo`,
   `StripState`, `CollabOptions`, `ChatSendResult`, `StageControl`, `useResumeKey`, `KEEP`, `DEFAULT_MAX_FILE_BYTES` (files.ts yolundan),
   `TransferDeps` (files.ts yolundan), files.ts'deki `sanitizeFileName`/`CHUNK_BYTES`/`REJECT_COOLDOWN_MS` yeniden verme satırı.
   Silinen: `protocol.ts` `CONTROL_SOURCES`, `ControlSource`, `MOUSE_BUTTONS`. `TechEvent` artık `use-tech-session.ts` kullandığı için dışa açık.
6. **PT bulguları (davranış değişmedi, düzeltilmedi):** yok.

## 4. Kalan (bu turda hedefe inmeyenler)

Hedef işlev ≤ 40 (kesin ≤ 60), cx ≤ 15. Aşağıdakiler kısaltıldı ama sınırın üstünde; çoğu JSX prop listesi (prettier satır başına bir prop).

| İşlev                                                                       | Şimdi                        | Not                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Stage` (`components/console/stage.tsx`)                                    | 76 satır · cx 24             | cx'in çoğu `strip` koşulu ve `?.` zincirleri; `StageStrip`/`StageView` prop listeleri gruplanarak inebilir                                                                                                                                                                                                                                                        |
| `GuestSession`                                                              | 78 satır                     | `useCollab` seçenekleri + `useResumeStore` argümanları + lobi çağrısı                                                                                                                                                                                                                                                                                             |
| `ConsoleView`                                                               | 69 satır                     | `useCollab` seçenekleri + `confirmEnd`                                                                                                                                                                                                                                                                                                                            |
| `useTechSession`                                                            | 69 satır                     | `onMessage` + bağlanma efekti; `onMessage` ayrı kancaya alınabilir                                                                                                                                                                                                                                                                                                |
| `useTechPeer`                                                               | 73 satır · `onPeerMsg` cx 17 | mesaj tipi başına küçük tablo ile inebilir                                                                                                                                                                                                                                                                                                                        |
| `StageStrip` 64, `ConsoleStage` 63, `GuestLive` 61                          | > 60                         | prop listeleri                                                                                                                                                                                                                                                                                                                                                    |
| `useControlActions` 44, `StageView` 43, `ConsoleHeader` 59, `GuestLobby` 58 | 40–60                        | hedef üstü, kesin sınır altı                                                                                                                                                                                                                                                                                                                                      |
| Görev listesinde adı geçmeyen, dokunulmayan > 40 işlevler                   | —                            | `useGuestSession` 148, `useRemoteInput` 123, `ControlButton` 103/cx 31, `FilesPanel` 118, `NewSessionDialog` 153/cx 24, `SessionSendLink` 160, `JoinForm` 155, `AgentDownload` 140, `SessionList` 145, `SessionsView` 145, `GuestWelcome` 122, `AnnotLayer` 104, `ChatPanel` 104, `useCollab` 87, `LobbyPanel` 82 … (ölçüm listesi: `scripts/pt-olcum.sh` `fonk`) |

## 5. Doğrulama

- `pnpm --filter @remote/web typecheck` · `lint`: temiz.
- `vitest`: 43 dosya / 386 test geçti; `vitest list` önce/sonra **aynı** (351 satır, fark yok). Test dosyalarına dokunulmadı.
- `e2e` (mock API, `pnpm --filter @remote/web e2e`): **443 geçti, 0 kırmızı, 200 atlandı** (tasarım gereği atlananlar). Önce
  (aynı çalışma kopyası, değişiklik öncesi): 441 geçti, 1 kırmızı (`p13bl-lobby.spec.ts:143` AC-305 — K14 dosyalarıyla ilgisiz,
  kararsız aday), 1 "did not run" (desktop-perf, kırmızı bağımlılık yüzünden). `playwright test --list` önce/sonra **aynı** (643 test).
- Prettier yalnız değişen/eklenen dosyalara uygulandı; `prettier --check` temiz.
