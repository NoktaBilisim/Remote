# PT-K14 — konsol / misafir / işbirliği / kontrol / WebRTC / DC temizliği (frontend-dev)

Tarih: 2026-11-15 · Dal: `pt-wip` · Tasarım: `docs/mimari-temizlik.md` §5 K14 · AC: `docs/gereksinimler.md` §10.
Kural: davranış ve görünüm değişmez; dışa açık adlar bulundukları modül yolundan verilmeye devam eder; yeni bağımlılık yok.

## 1. Durum özeti

| Hedef (§5 K14)                                                                                 | Önce                                                                                 | Sonra                                                                                                     | Durum                       |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | --------------------------- |
| `components/console/stage.tsx` `Stage`                                                         | dosya 411 · 300 satır · cx 87                                                        | 58 satır · cx ≤ 15 (karar işlevi `stageFlags`; katmanlar: şerit, üst katman, video, kancalar)             | tamam (≤ 60; hedef 40 üstü) |
| `console-view.tsx` `ConsoleView`                                                               | dosya 327 · 278 satır · cx 51                                                        | 42 satır · cx ≤ 15 (`ConsoleStage`, `useEndConfirm`, `collabOptions`)                                     | tamam (≤ 60)                |
| `guest-session.tsx` `GuestSession`                                                             | dosya 304 · 251 satır · cx 23                                                        | ≤ 40 satır · cx ≤ 15 (`GuestLive`, `useShareControls`)                                                    | tamam                       |
| `lib/control/machine.ts` `onMsg`                                                               | 77 satır · cx 58                                                                     | işleyici tablosu (`ON_MSG`), her işleyici ≤ 20 satır, cx ≤ 15; dosya 299                                  | tamam                       |
| `lib/webrtc/tech-machine.ts` `onMsg`                                                           | 54 satır · cx 41                                                                     | işleyici tablosu (`ON_MSG`), cx ≤ 15                                                                      | tamam                       |
| `lib/dc/files.ts`                                                                              | 614 satır, `onCtl` cx 24                                                             | 109 (cephe) + `file-model` 180 / `file-send` 163 / `file-receive` 221 / `file-disk` 95                    | tamam                       |
| `use-tech-session.ts` `useTechSession`                                                         | dosya 310 · 218 satır · `onMessage` cx 25                                            | 56 satır · cx ≤ 15 (+ `use-tech-peer` 49, `use-tech-control`; `handleMessage`/`handleClose`/`closeOnEnd`) | tamam (≤ 60; hedef 40 üstü) |
| Diyalog klonu `cancel-dialog` ↔ `terminate-dialog` (20 satır)                                  | jscpd klon                                                                           | ortak `use-session-action.ts`                                                                             | tamam                       |
| Kanca klonu `use-guest-session` ↔ `use-tech-session` (12)                                      | jscpd klon                                                                           | klon artık eşleşmiyor (jscpd 0); ortak kanca **eklenmedi** (§3)                                           | tamam (gerekçeli)           |
| Sohbet paneli klonu `collab-side` ↔ `guest-collab` (10)                                        | jscpd klon                                                                           | ortak `components/collab/tab-options.tsx`                                                                 | tamam                       |
| `protocol.ts` ad takması                                                                       | `inputMsgSchema` + kullanılmayan `CONTROL_SOURCES`, `ControlSource`, `MOUSE_BUTTONS` | takma ad yerinde; kullanılmayan 3 ad budandı                                                              | tamam                       |
| Ek: `controlReducer` cx 21, `techReducer` cx 17, `guestReducer` cx 16, `sampleFromStats` cx 25 | > 15                                                                                 | hepsi ≤ 15 (kapanış/geri yükleme/istatistik yardımcıları çıkarıldı)                                       | tamam                       |

Kapsamdaki üretim dosyalarında ESLint ölçümü (`max-lines-per-function` 40, `complexity` 15): **59 → 46 uyarı**,
karmaşıklık uyarısı **20 → 8** (kalanların hepsi §4.3 "Sonra" işlevleri). Kapsamda > 300 satır dosya: **5 → 0**. jscpd (≥ 8 satır / 70 belirteç) kapsamda **3 → 0** klon.

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

## 4. Kalan

### 4.1 Tur 2 (8c6f1ad sonrası) — 60 satır üstü işlevler indirildi

| İşlev            | Tur 1                  | Tur 2        | Yöntem                                                                                                                             |
| ---------------- | ---------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `Stage`          | 76 · cx 24             | 58 · cx ≤ 15 | `stageFlags` (gösterim/yakalama/şerit kararları), `overlayInput`, `stripContent`; şerit prop'ları `fit`/`view`/`content` nesneleri |
| `GuestSession`   | 78                     | ≤ 40         | `useShareControls` (meşgul/ret durumu), props arayüzü, `useResumeStore(storeKey, state, join, …)`                                  |
| `useTechPeer`    | 73 · `onPeerMsg` cx 17 | 49 · cx ≤ 15 | `wirePeer` (PeerLink olayları), `linkMsg` (peer.left/sdp.answer/ice); hello ve peer.joined{guest} aynı dalda (sıra aynı)           |
| `ConsoleView`    | 69                     | 42           | `useEndConfirm` (bitir/iptal onayı), `collabOptions`                                                                               |
| `useTechSession` | 69                     | 56           | `handleMessage` (ICE kapısı → peer → makineler), `closeOnEnd`                                                                      |
| `StageStrip`     | 64                     | ≤ 40         | `StripViewArea` (monitör + görünüm/tam ekran; geniş/dar sahne)                                                                     |
| `ConsoleStage`   | 63                     | ≤ 40         | `DrawState` nesnesi, `controlBar`, `comboSender`, `nativeSizeOf`                                                                   |
| `GuestLive`      | 61                     | ≤ 40         | props arayüzü                                                                                                                      |

Hook çağrı sırası ve efekt sırası her bileşende korundu (yeni kancalar eski `useState`/`useEffect` yerlerinde çağrılır).
Gerekçeli istisna kullanılmadı (hepsi ≤ 60, cx ≤ 15).

### 4.2 Hedef (40) üstü, kesin sınır (60) altı — kalabilir

`ConsoleHeader` 59, `Stage` 58, `GuestLobby` 58, `useTechSession` 56, `useTechPeer` 49, `useControlActions` 44, `StageView` 43, `ConsoleView` 42.

### 4.3 Sonra (görev metninde adı geçmeyen, dokunulmayan > 40 işlevler)

`useGuestSession` 148 (+ `onClose` cx 16), `useRemoteInput` 123, `ControlButton` 103 / cx 31, `MonitorPicker` 45 / cx 16, `FilesPanel` 118 / cx 17,
`Row` (files-panel) 55 / cx 17, `NewSessionDialog` 153 / cx 24, `SessionSendLink` 160, `JoinForm` 155 (+ submit cx 16), `AgentDownload` 140,
`SessionList` 145 (+ satır cx 18), `SessionsView` 145, `GuestWelcome` 122, `CreatedSession` 107, `AnnotLayer` 104, `ChatPanel` 104, `AnnotToolbar` 93,
`useCollab` 87, `SessionEmail` 85, `LobbyPanel` 82, `ShareStrip` 60, `drawAnnotations` 44, `Sha256.block` 42, `ConsolePage` 41, `SessionsPage` 41
(ölçüm: `scripts/pt-olcum.sh` `fonk`).

## 5. Doğrulama

Tur 2 (son durum):

- `pnpm --filter @remote/web typecheck` · `lint`: temiz.
- `vitest`: 43 dosya / 386 test geçti; `vitest list` önce/sonra **aynı**. Test dosyalarına dokunulmadı.
- `e2e` (mock API): **443 geçti, 0 kırmızı, 200 atlandı**. `playwright test --list` test adları önce/sonra **aynı** (643 test);
  satır numarası farkları K3'ün eşzamanlı `e2e/*.spec.ts` düzenlemesinden (K14 e2e dosyalarına dokunmadı).
- Kapsamda ESLint ölçümü (40 / cx 15): 59 → 46 uyarı; kapsamda > 300 satır dosya 0; jscpd klon 0.
- Prettier yalnız K14 dosyalarına uygulandı.

Tur 1:

- e2e: 443 geçti, 0 kırmızı. Değişiklik öncesi: 441 geçti, 1 kırmızı (`p13bl-lobby.spec.ts` AC-305 — K14 dosyalarıyla ilgisiz,
  kararsız aday), 1 "did not run" (desktop-perf, kırmızı bağımlılık yüzünden).
