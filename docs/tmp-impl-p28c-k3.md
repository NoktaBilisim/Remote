# P28c K3 — Go istemci + gözetimsiz yardımcı (backend-dev Go, 2026-11-16) — geçici not

Kaynak: `docs/mimari-p28c.md` r2 (§4.4, §4.5, §5.1, §6, §6.1, §11, Y-PC-4), ADR-0035, K0 adları. Sürüm 0.17.0: kodda
sabit sürüm yok; `build/build.sh <sunucu> 0.17.0` parametresiyle verilir.

## Yapılanlar

- **rtc** (`rtc.go`, yeni `media.go`): `Media`: paylaşılan `main`/`low` `TrackLocalStaticSample` + yayın pompası
  (`Stream`), `SetLow`, `LowSource` arayüzü. `New(ice, caps, h, *Media)`. `Peer.SetMain(bool)`, `RTPSender.ReplaceTrack`
  ile çalışır ve ardından anahtar kare ister. PLI/FIR eşin o anki izinin saatine gider. Yeni eşte ilk AddTrack'ten sonra
  anahtar kare istenir. `Peer.Stream` kaldırıldı; yayın artık eşten bağımsız.
- **capture** (yeni `low.go`, `source_windows.go`): ikinci kodlayıcı `lowStage`. Aynı NV12 kareyi alır; en çok
  `signal.LowFPS` (8) kare/sn kodlar, bit hızı sabit `signal.LowBPS` (1 Mbps), ayrı `keyClock` kullanır. Yalnız
  `EnableLow(true)` ve alıcı (sink) varken çalışır, kapanınca kodlayıcıyı da kapatır. Düşük kodlayıcı açılamaz ya da hata
  verirse yalnız düşük akış kapanır, ana akış sürer. `source` `rtc.LowSource`'u uygular.
- **desktop** (`gated.go`): `gatedSource` `LowSource`'u alttaki kaynağa iletir. Masaüstü değişip kaynak yeniden
  açılınca düşük akış ayarı yeniden uygulanır.
- **flow**
  - Yeni `peers.go` ve `messages_p28c.go`: eş haritası `tid → eş` (en çok `MaxTechs`).
  - Kabul listesi: offer yalnız son roster'da olan ve `RosterUI.ShowRoster` ile çizimi doğrulanmış tid'den kabul edilir;
    çizilemeyen ad için eş kurulmaz. Multi kipinde `from`'suz offer düşer.
  - Gönderilen `SdpAnswer.To` ve `Ice.To` alanları doldurulur.
  - Roster'dan düşen ya da `connected:false` olan tid'in eşi hemen kapanır.
  - Kontrol sahibi değişince kapı ve diyaloglar kapanır, yerel dosya aktarımı iptal edilir, izler takas edilir. Düşük
    kodlayıcı yalnız en az bir ikincil eş varken açıktır.
  - Girdi, Pion goroutine'inde atomik denetimle yalnız kontrol sahibinin eşinden geçer. Dosya parçası, `file.*`,
    işaretleme, pano ve yazdırma DC'si de yalnız kontrol sahibinden kabul edilir. Diğer eşten gelen `file.offer` o eşe
    `file.reject` alır.
  - Sohbet: izleyiciden gelen düşer. Katılımcının sohbeti adıyla gösterilir (`RosterUI.TechChat`) ve diğer eşlere
    `by=tid` ile yayılır (ad taşınmaz). Müşterinin sohbeti `by`'sız tüm eşlere gider.
  - Kontrol izni diyaloğu ve AC-103 göstergesindeki ad roster'daki kontrol sahibinden gelir.
  - `EvTechRemove` → `tech.remove`. Sahip ve gözetimsiz odada gönderilmez.
  - Roster değişmezi bozulursa (`signal.ValidRoster`; ParseServer zaten 1008 ile reddeder, akış ikinci savunmadır) kapı
    kapanır ve oturum `msgProtocol` ile biter.
  - Multi1 sokette `peer.left/joined{tech}` gelmez; kontrol sahibinin bağlantı durumu roster'dan izlenir.
  - Eski sokette (roster gelmezse) tek eş `""` kalır; davranış önceki gibidir.
  - `Features`: `RosterUI` bağlıysa `rs.cap.multi1` bildirilir, gözetimsiz kipte de.
  - `peerEvent` artık `tid` ve `gen` taşır; kapatılmış eşin geç olayları düşer.
- **ui** (yeni `roster_windows.go`): oturum penceresinde en çok 3 satır listelenir (ad, rol etiketi, "Oturum sahibi",
  "bağlantı koptu"). "Çıkar" yalnız gerçek yerel girdiyle çalışır (`thread.userInput`). Onay diyaloğunda varsayılan
  düğme "Vazgeç"tir (`MB_DEFBUTTON2`). `ShowRoster` yazılan metni geri okuyarak doğrular, en çok 2 sn bekler.
  `watchText` AC-103 metnini kontrol sahibinin adıyla kurar.
- **helper**: `headless` `RosterUI`'yi uygular. Göstergeye `" · Bağlı: A, B"` eki yazılır; yalnız sunucu metnindeki tek
  sahip bağlıysa ek yoktur. Bu, `no_user` ve `silent` kiplerinde geçerlidir; "Çıkar" yoktur.
  - `liveIndicator.SetNames` çizimin doğrulanmasını bekler: `winIndicator.Drawn` son doğrulanmış etiketi en çok 2 sn
    yoklar. Doğrulanamazsa eş kurulmaz ve mevcut fail-closed kuralıyla oturum biter.
  - Güvensiz karakterli ad (`helperio.Text`) çizilmez. Ad 40 karakterde "…" ile kesilir.
  - Yardımcının `Dial`'ı `rs.cap.multi1` bildirir.
- **cmd/noktadestek/deps.go**, **helper/main_windows.go**: `rtc.NewMedia` (kapsam başına bir tane), `Deps.Media`,
  `RosterUI: u`.
- **signal/multi.go**: `ValidTID` ve `ValidRoster` dışa açıldı (yalnız sarmalayıcı).

## Tasarımdan sapmalar ve kararlar

1. **Roster arayüzü:** `RosterUI` açık bir `Deps` alanıdır, `d.UI` üzerinden tip iddiasıyla alınmaz. Gerekçe:
   `tray.WithActive` sarmalayıcısı isteğe bağlı arayüzleri iletmiyor.
   **Bulgu (P28e):** `recUI(d)` aynı nedenle tepside yerleşik kipte nil döner, yani kayıt özelliği bildirilmez. Bu
   pakette düzeltilmedi; ayrı iş olarak açılmalı.
2. **Ad çizim doğrulaması eşzamanlıdır:** `ShowRoster` en çok 2 sn bekler ve akış döngüsünü o kadar bekletebilir.
   Gerekçe: offer çizim onayından önce işlenemez (Y-PC-4).
3. **Sunucu roster göndermezse** (eski sunucu ya da K1 öncesi) eski tek eş yolu sürer. Multi kipi ilk roster ile açılır.
4. **Gösterge etiketi:** sunucu metni + ad eki + kayıt eki. Sunucu metnindeki "TEST — imzasız" öneki korunur.
5. **Düşük kodlayıcı hatası** yalnız o kaynağın düşük akışını kapatır, ana akışı düşürmez. Kaynak yeniden açılınca düşük
   akış yeniden denenir.
6. **Pencere yüksekliği** roster satırları için 96 px büyüdü. En kötü durumda (fsrv + yönetici uyarısı) yükseklik
   yaklaşık 776 px; 768 px ekranlarda taşabilir. Elle kontrol edilmeli.
7. **"Çıkar"da `userInput` denetimi** tasarımda yoktu, eklendi. Gerekçe: kontrol sahibi teknisyen `SendInput` ile
   başka bir üyeyi çıkaramasın.

## Yapılmayanlar / açık maddeler

- Win32 roster UI ve `winIndicator.Drawn` Linux'ta derleme ve vet ile denetlendi; Windows'ta elle denenmedi.
  Staging'de test-operatoru ve kullanıcı denemeli.
- AC-371 ölçümü (10 Mbps, 3 teknisyen) yalnız staging'de elle yapılabilir; birim testi yalnız ≤ 8 FPS'i doğrular.
- Helper'ın `ShowRoster`/`namesSuffix` yolu ve gösterge adı birim testi **yazılmadı** (kalan iş).
- Konsoldaki kontrol sahibi `connected:false` → `true` olduğunda durum satırı metni roster'dan türetiliyor; bunun ayrı
  bir testi yok.

## Testler (agent-win.yml zorunlu listesine eklenecek adlar)

- `internal/flow` (`peers_test.go`): `TestAC366OfferOnlyFromDrawnRosterTid`, `TestAC366OfferRejectedWhenNameNotDrawn`,
  `TestAC366RemoveSendsTechRemoveAndRosterDropClosesPeer`, `TestAC366UnattendedHasNoRemove`,
  `TestAC371AC367TracksAndFilesFollowController`, `TestAC367InputGateFollowsController`,
  `TestP28cChatRelayAndObserverDropped`, `TestP28cInvalidRosterEndsSession`
- `internal/capture` (`low_test.go`): `TestAC371LowEncoderAtMost8FPS`, `TestAC371LowEncoderOnlyWhileEnabled`,
  `TestAC371LowEncoderFailureIsolated`
- `internal/rtc`: `TestAC367SetMainReplacesTrack`
- K0'dan gelenler: `internal/signal/multi_test.go`, `internal/dc/chat_multi_test.go`

## Komutlar ve son çıktı

Tümü `docker run … golang:1.26` içinde, depo kökü `/src`'ye bağlı, `-w /src/apps/agent-win` ile koşuldu.

- `go test ./...` → tüm paketler ok.
- `go test -race ./internal/flow/ ./internal/rtc/ ./internal/capture/` → ok.
- `GOOS=windows go vet ./... && GOOS=windows go build ./...` → temiz.
- staticcheck v0.8.2 (linux + `GOOS=windows GOARCH=amd64`) → uyarı yok.
- `gofmt -l .` → boş.

Yeni bağımlılık yok.

### K3b

- **P28e hatası (tepsi kipinde rec1 yok):** kök neden `tray.WithActive` → `activeUI` yalnız `flow.UI` gömüyordu;
  `flow.recUI` `d.UI.(RecUI)` iddiasıyla aradığı için yerleşik (tepsi) kipte kayıt yeteneği hiç bildirilmiyor, talep
  formundaki kutu sessizce düşüyordu. Düzeltme (`internal/tray/resident.go`): iç arayüz `flow.RecUI` ise sarmalayıcı
  `activeRecUI` döner ve onu iletir; değilse iletmez (K-P28e-7 korunur). Diğer isteğe bağlı arayüzler (ClipPrintUI,
  FileServerUI, RosterUI) açık `flow.Deps` alanı ve sarmalanmamış `u` ile bağlı; `d.UI` üzerinde başka tür iddiası yok
  → etkilenmiyor. Test: `TestP28cP28eTrayWithActiveForwardsRecUI`.
- **Eksik testler:** `TestP28cNamesSuffix`, `TestP28cHeadlessShowRoster`, `TestP28cLiveSetNamesDrawsSuffix` (yardımcı
  gösterge adı yolu); `TestP28cControllerDisconnectAndReturnStatus` (roster `connected` → "koptu"/"yeniden bağlandı").
- **768 px:** `internal/ui/session_fit.go` `chatSqueeze` — pencere birincil çalışma alanına (16 px alt payla) sığmazsa
  sohbet geçmişi kısalır (en az 64 px), altındaki denetimler kayar. Test `TestP28cSessionWindowFits768`. Gerçek ekranda
  doğrulanmadı; %125+ DPI'da 768 px ekranda tavan (132 px) yetmeyebilir.
- **CI:** "P28c çoklu teknisyen testleri" adımı `-run 'P28c|AC366|AC367|AC371'` + `./internal/tray/...`; zorunlu PASS
  listesine K3 ve K3b testleri eklendi (actionlint temiz).
- **Not (değiştirilmedi):** `liveIndicator.SetNames` aynı ek zaten yazılıysa doğrulamadan true döner; önceki çizim
  doğrulaması zaman aşımına uğramışsa sonraki aynı roster'da tid'ler doğrulamasız kabul edilir (gösterge gerçekten
  çizemezse `fail()` oturumu bitirir; risk düşük). Güvenlik incelemesine bırakıldı.
