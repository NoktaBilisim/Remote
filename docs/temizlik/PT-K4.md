# PT-K4 — Go `internal/request` bölme (backend-dev)

Tarih: 2026-11-15 · Dal: `pt-wip` · Tasarım: `docs/mimari-temizlik.md` §5 K4 (+ §1 kısıtlar) · AC: AC-317, AC-318, AC-320, AC-322, AC-323.
Davranış değişmez: yalnız "işlev çıkar", "dosyaya taşı" ve test yardımcısı birleştirme yapıldı. Yeni bağımlılık, yeni
soyutlama katmanı, dışa açık ad/imza değişikliği yok. WS tel biçimi (struct'lar, JSON etiketleri), sohbet süzgeç/önek
kuralları (G-P20-7), hata ve kullanıcı metinleri aynı. P20 tek ekran sonrası `run.go`/`home.go` güncel hali esas alındı.

## Dosyalar (üretim, satır)

| Önce          | Sonra                                                                                                                                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat.go` 582 | `chat_wire.go` 214 (sözleşme sabitleri, gövde hata metinleri, regex'ler, `ChatItem`/`ChatMessage`/`ChatHistory`/`ChatToggle`, tel eşleri, `validChatItem`, `parseChat` + tip başına `parseChatMessage`/`parseChatHistory`/`parseChatToggle`, `ChatBody`, `EncodeMessage`, `newClientMsgID`) |
|               | `chat.go` 293 (durum modeli: `Chat`, `NewChat`, `Submit`, `merge`, `OnMessage`, `OnHistory`, `Online`, `OnToggle`, `OnAccepted`, `OnError`, `Due`, `Wake`, `SendFailed`, durum satırı metinleri)                                                                                            |
|               | `chat_view.go` 112 (gösterim tavanları, `ChatBalloonText`, `ChatView`, `ChatDisplayBody`, `View`, `text`, `block`, `trim`)                                                                                                                                                                  |
| `run.go` 451  | `run.go` 289 (`Deps`, metinler, `runner`, `Run`, `withDefaults`, `loadRemembered`, `newKey`, `randJitter`, engel ekranı, firma bilgisi)                                                                                                                                                     |
|               | `form.go` 220 (`formView`, `forget`, `rememberPlan`, `form` + `formAction`, `createBody`, `savePersonal`, `createFailed`, `createNotice`, `create`)                                                                                                                                         |
| `wait.go` 444 | `wait.go` 279 (`waiter`, `wait`, `openWait`, `event`, `received`, `step`, `ended`, `read`, `startDial` + `dialLoop`, `dialed`, `cancelMsg`, `lost`, `closeConn`)                                                                                                                            |
|               | `wait_screen.go` 218 (`restCancel`, `release`, `elapsed`, `remaining`, `tick`, `apply` + `onState`/`onAccept`/`sendStep`/`finish`, `closedScreen`, `closedView`, sohbet alanı)                                                                                                              |
| `ws.go` 281   | `ws.go` 297 (`ParseServer` tip başına `parseState`/`parseAccepted`/`parseClosed`/`parseError`)                                                                                                                                                                                              |

Dokunulmayan üretim dosyaları: `home.go`, `machine.go`, `policy.go`, `types.go`, `validate.go`.
Sonuç: kapsamda > 300 satırlık üretim dosyası yok (en büyüğü `ws.go` 297).

## İşlev uzunluğu / karmaşıklık (go/ast `scripts/pt-olcum/golen.go`; `gocyclo@v0.6.0` docker'da, repoya girmedi)

| İşlev              | Önce (satır / cx) | Sonra                                                                                                          |
| ------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `runner.form`      | 99 / 34           | 29 / 7 (+ `formAction` 16/4, `createBody` 16/5, `savePersonal` 8/4, `createFailed` 38/13, `createNotice` 18/9) |
| `ParseServer`      | 59 / 33           | 21 / 7 (+ `parseState` 11/8, `parseAccepted` 12/8, `parseClosed` 16/10, `parseError` 11/4)                     |
| `runner.wait`      | 72 / 17           | 12 / 3 (+ `openWait` 11/1, `event` 33/9, `received` 12/4, `step` 8/2, `ended` 6/2)                             |
| `waiter.apply`     | 52 / 19           | 14 / 4 (+ `onState` 9/3, `onAccept` 6/1, `sendStep` 17/9, `finish` 18/6)                                       |
| `Run`              | 49 / 16           | 23 / 7 (+ `withDefaults` 24/8, `loadRemembered` 8/3)                                                           |
| `parseChat`        | 49 / 14           | 11 / 4 (+ `parseChatHistory` 25/7 …)                                                                           |
| `waiter.startDial` | 43 / 14           | 9 / 2 (+ `dialLoop` 35/13)                                                                                     |

Kapsamdaki tüm üretim işlevleri ≤ 40 satır (en uzunu `createFailed` 38), karmaşıklık ≤ 15 (en yükseği `loadInfo` 15,
değişmedi). İstisna yok. Test işlevlerinde cx > 15 kalanlar (`TestAC134FormMatchesContractsFixture` 24 vb.) §3.2'ye göre
hedef değil; dokunulmadı.

## Tasarımdan küçük sapmalar (gerekçeli)

- `chat.go` ikiye değil üçe bölündü (`chat_view.go` eklendi): durum modeli tek başına ~330 satırdı; gösterim kısmı
  (`ChatDisplayBody`, `View`/`text`/`block`, tavan sabitleri, `trim`) ayrılmadan ≤ 300 sağlanamıyordu. `chat_wire.go`
  §5'teki ~170 tahmini yerine 214 satır (tip başına ayrıştırma işlevleri dahil).
- §5 yalnız `form`/`wait` işlevlerini sayıyor; `run.go` 451 ve `wait.go` 444 dosyaları da ≤ 300 hedefi için `form.go` ve
  `wait_screen.go`'ya taşındı. `ParseServer` (cx 33), `apply` (cx 19), `Run` (cx 16), `parseChat`, `startDial` da
  sınır üstünde olduğundan aynı yöntemle bölündü.
- `waiter`'a `cancel` alanı eklendi (eski yerel `wcancel`): döngü olay işlevine (`event`) çıkarılınca bitişte wctx'i
  kapatmak için. `release(wcancel)` imzası aynı, `w.cancel` geçilir.

## Davranış eşdeğerliği notları

- `wait`: açılış sırası aynı (wctx → `sentAt` → görünüm → `RequestFormClose` → `RequestWaiting` → `showChat` →
  `RequestChatSends` → `startDial` → ticker). Eskiden `wcancel()` çağrılan her bitiş yolu (`ctx.Done`, `lost`, `dialed`,
  `apply` done) yine çağırır (`ended`/`ctx.Done` dalı); paylaşım (`OutShare`) yine çağırmaz, `Release`'e bırakır.
  `continue` olan dallar (eski nesil okuma, sohbet mesajı, sohbet gönderimi/zamanlayıcısı, bitmemiş kopma/dial) adım
  işlemeden döner (`apply` çağrılmaz, `Now()` fazladan çağrılmaz).
- `startDial`: `Deps` kopyası eskisi gibi goroutine başlamadan alınır ve `dialLoop`'a parametre geçer.
- `form`: sıra aynı (karar → `r.vals = f` → `Validate` → `rememberPlan`/forget/yeni anahtar → gövde → `RequestFormBusy`
  → `create` → başarıda kaydet). Hata dalları `createFailed`'da aynı sırada: `ctx.Err` → `api.Error` değil → `switch`
  (`Status==0` önce; tek fark, ağ/TLS ve PENDING/RATE/QUEUE/NOT_READY/varsayılan bildirimleri `createNotice`'ten gelir —
  aynı koşul sırası, aynı metin).
- `ParseServer` / `parseChat`: JSON zarfı → tip dalı → `DecodeStrict` → alan kuralı → `Display`; hata metinleri
  (`request: ?: json`, `…: alan`, `…: items`, `…: öğe`, `…: enabled`, `…: bilinmeyen tip`) birebir.

## staticcheck ST1018 (9 → 0)

`hardening_test.go` (169, 170, 171, 174, 186, 191, 195, 199) ve `home_test.go` (41): görünmez biçim karakterleri `\uXXXX`
kaçışıyla yazıldı; bayt değeri aynı. Ham (backtick) JSON dizgilerinde kaçış JSON'a değil Go'ya ait olsun diye dizge
bölündü (`` `…"Meh` + "‮" + `met"…` ``), böylece `ParseServer`'a giden baytlar değişmedi. `staticcheck`
(v0.8.2) `./internal/request/...` linux ve GOOS=windows: 0 uyarı.

## Test klonları (yalnız yardımcı birleştirme; test adı, sayısı, assertion ve hata metinleri aynı)

- `expectServerParse` (chat_test.go): `chat_test` ve `machine_test`'teki aynı "geçerli ayrışır / geçersiz red" döngüsü.
- `home_test.go` `TestAC185MessagesMatchContractsFixture`: elle dosya okuma + `json.Unmarshal` → mevcut `loadFixture`.
- `connectedAt(t, u, conn, pos)` (run_test.go): `connected` (7) ve mutlu yol testindeki (1) aynı `request.state` +
  bekleme döngüsü.
- `submits(f)` (run_test.go): 14 yerde tekrarlanan `[]func(FormView) (FormAction, Form){submit(f)}`.

## Doğrulama (golang:1.26, docker)

- `go test -race ./...` (apps/agent-win): 21 paketin hepsi `ok` (request 1,1 sn).
- `GOOS=windows go vet ./...`: temiz. `gofmt -l .`: boş.
- `go test -list . ./internal/request/...`: önce/sonra **62 test, liste birebir aynı** (diff boş).
- Değişen dosyalar yalnız `apps/agent-win/internal/request/**` ve bu not.

## PT bulguları

Yok (bölme sırasında hata görülmedi). Bilgi: baseline `deadcode.linux`'ta `request/ws.go` `WSConn.Send`/`WSConn.Close`
"erişilemez" görünüyor; bunlar `Conn` arayüzünün Windows yolundan çağrılır, K4 görevinde yok — dokunulmadı.
