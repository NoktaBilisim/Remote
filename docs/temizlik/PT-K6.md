# PT-K6 — Go `internal/flow` + `internal/signal` bölme (backend-dev)

Tarih: 2026-11-15 · Dal: `pt-wip` · Tasarım: `docs/mimari-temizlik.md` §5 K6 (+ §1 kısıtlar) · AC: AC-317, AC-318, AC-320, AC-322, AC-323.
Davranış değişmez: yalnız "işlev çıkar", "dosyaya taşı" ve test yardımcısı birleştirme yapıldı. Yeni bağımlılık, yeni
soyutlama katmanı, dışa açık ad/imza değişikliği yok. WS tel biçimi (struct'lar, JSON etiketleri) ve hata metinleri aynı.

## Dosyalar (üretim, satır)

| Önce                     | Sonra                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flow/flow.go` 923       | `flow.go` 294 (arayüzler, `Deps`, `Run`, `RunTicket`, `admitStage`, `askCode`, `welcomeData`, `tenantLogo`)                                                               |
|                          | `session.go` 299 (`withDefaults`, `session` tipi, `run` + `loop`, `onInbound`, `startReconnect`, `attach`, `reconnect`, `send`, `onUser`, `chatMessage`, `cleanup`)       |
|                          | `session_server.go` 176 (`onServer`, `onSignaling`, `onPresence`, `onError`, `onHello`, `applyHello`, `initFiles`)                                                        |
|                          | `session_media.go` 270 (`firstShare`, `chooseShare`, `openCapture`, `beginShare`, paylaşım durumu, yayın, eş olayları `onPeer`/`onChunk`, `onCtl`)                        |
| `flow/control.go` 274    | `control.go` 291 (`onControlServer`/`onControlUser` dallarından `onControlRelease`, `onControlRevoke`, `onCapsUpdate`, `grantControl` çıkarıldı)                          |
| `signal/messages.go` 661 | `messages.go` 130 (paket belgesi, sınırlar, regex'ler, `fail`/`isISO`/`utf16Len`/`IsISO`, `decodeValid`, `check`, ortak alan doğrulayıcıları)                             |
|                          | `outbound.go` 285 (misafir → sunucu tipleri + `validate`, `Encode`; `validateShare`'den `checkMonitors` çıkarıldı)                                                        |
|                          | `inbound.go` 276 (sunucu → misafir tipleri, `ParseServer` + `serverParsers` tip başına tablo, `validHello`, `validPeerJoined`, `parseBindingOffer`, `validBindingIssued`) |

Dokunulmayan: `flow/binding.go` 62, `flow/messages.go` 156, `signal/conn.go` 118, `signal/strict.go` 65.
Sonuç: kapsamda > 300 satırlık üretim dosyası yok (en büyüğü `session.go` 299).

## İşlev uzunluğu / karmaşıklık (go/ast `scripts/pt-olcum/golen.go`; `gocyclo@v0.6.0` docker'da, repoya girmedi)

| İşlev                     | Önce (satır / cx) | Sonra                                                   |
| ------------------------- | ----------------- | ------------------------------------------------------- |
| `signal.ParseServer`      | 79 / 55           | 15 / 4 (+ `serverParsers` tablosu; `validHello` 6 / 13) |
| `session.onHello`         | 82 / 24           | 32 / 8                                                  |
| `session.run`             | 72 / 21           | `run` 22 / 4 + `loop` 29 / 12                           |
| `session.onServer`        | 63 / 25           | 27 / 10                                                 |
| `admitStage`              | 56 / 13           | 40 / 10                                                 |
| `session.onControlServer` | 44 / 18           | 18 / 10                                                 |
| `session.onControlUser`   | 43 / 16           | 34 / 12                                                 |
| `session.onPeer`          | 36 / 17           | 24 / 12                                                 |
| `signal.validateShare`    | 24 / 19           | 18 / 11 (+ `checkMonitors` 12 / 10)                     |

Kapsamdaki tüm üretim işlevleri ≤ 40 satır (en uzunu `admitStage` 40). Karmaşıklık > 15 kalan tek işlev aşağıdaki istisna.

## İstisnalar (1 / en çok 2)

1. `flow/messages.go` `classify` cx 17 (31 satır, değişmedi): API hata kodu/HTTP durumu → son ekran mesajı eşlemesi, düz
   bir `switch`. Bölmek (ör. kod ve durum için iki işlev) sırayı (önce kod, sonra `Status==0 && TLS`, sonra durum) iki yere
   dağıtır ve okunurluğu düşürür; tablo yapmak sıralı koşullar (`Status==0 && TLS`) nedeniyle ek soyutlama ister.

## Tasarımdan küçük sapmalar (gerekçeli)

- `signal/messages.go` silinmedi, 130 satırlık ortak dosya olarak kaldı: paket belgesi, `ws.ts` sınır sabitleri, regex'ler
  ve hem giden hem gelen tarafın kullandığı yardımcılar (`fail`, `utf16Len`, `isISO`, `IsISO`). Ayrıca `inbound.go`'yu
  ≤ 300'de tutmak için çözme yardımcıları (`decodeValid`, `literalTrueIfPresent`, `check`) ve alan doğrulayıcıları
  (`validIceServers`, `validCaps`, `validMaxFileMb`, `validGuestKind`) da burada.
- `flow/control.go` §5 satırında adıyla geçmiyor ama K6 glob'u (`internal/flow/**`) içinde; `onControlServer` (cx 18) ve
  `onControlUser` (cx 16) sınır üstünde olduğundan dal gövdeleri işlev olarak çıkarıldı (mekanik, sıra aynı;
  `onControlUser`'daki `now := s.d.Now()` hâlâ switch'ten önce çağrılıyor).
- `ParseServer` tablosundaki basit doğrulayıcılar satır içi kapanış olarak kaldı (bir satırlık koşullar); karmaşık olanlar
  (`hello`, `peer.joined`, `binding.issued`) adlı işlev oldu. `check[M]` iki satırlık bir uyarlayıcıdır
  (`decodeValid` çağrısını tabloya koymak için), yeni katman değil.

## Davranış eşdeğerliği notları

- `ParseServer` sırası aynı: JSON zarfı → `techOnlyTypes` (`ErrNotForGuest`) → tip tablosu → `fail(t, "bilinmeyen tip")`.
  Hata metinleri (`signal: ?: json`, `…: şema ihlali`, `…: bilinmeyen tip`) birebir. Doğrulayıcılar yan etkisiz; `hello`'da
  caps döngüsü ayrı işleve alındı (`validHelloCaps`; nil geçerli — `validCaps` nil'i reddeder, bu yüzden birleştirilmedi).
- `onServer`: `techLost` okunup sıfırlanması yine ilk iş; dal başına çağrılar aynı sırada. Bilinmeyen tip yine no-op.
- `onHello`: `Admitted` → `closeControl` → `helloEnv` → belirteç/ICE/caps/dosya sınırı → `dropPeer` → `NewPeer` →
  `initFiles` → (ilk) seçim/`Active`/yakalama veya (sonraki) "yeniden bağlandı" → `phActive` → girdi monitörü → ortam →
  paylaşım. Sıra değişmedi.
- `run`: `defer cleanup` `run`'da kaldı; döngü `loop`'ta. Okuma hatası dalı `onInbound` + `startReconnect`'e taşındı
  (`reconnectDeadline` yalnız bu dalda kullanılıyordu, yerel oldu).
- `admitStage`: geçersiz kodda yeniden sorma `askCode` içinde döngü (eskiden dış döngü `continue`); gözlenen çağrı dizisi aynı.

## Test klonları (yalnız yardımcı birleştirme; test adı, sayısı, assertion ve hata metinleri aynı)

- `signal/binding_test.go`: iki fikstür okuyucusu → `readBindings`; iki testte tekrarlanan "geçerli ayrışır / geçersiz
  red" döngüsü → `expectServerParse`; iki testte tekrarlanan `binding.request` gidiş-dönüş döngüsü → `expectRequestRoundTrip`.
- `flow/binding_test.go`: 8 testte tekrarlanan "harness + Binding + start + conn + hello + ilk share.state" başı →
  `startAdmitted(t, b)` (Binding'siz testte `nil`, eskisiyle aynı: alan atanmıyordu = nil); iki "durum satırına yazılmamalı"
  boşaltma döngüsü → `noCall`.

## Doğrulama (golang:1.26, docker)

- `go test -race ./...` (apps/agent-win): 21 paketin hepsi `ok` (flow 7,5 sn, signal 1,1 sn).
- `GOOS=windows go vet ./...`: temiz. `gofmt -l .`: boş.
- `go test -list . ./internal/flow/... ./internal/signal/...`: önce/sonra **75 test, liste birebir aynı** (diff boş).
- Değişen dosyalar yalnız `apps/agent-win/internal/flow/**`, `apps/agent-win/internal/signal/**` ve bu not.
  `packages/contracts/fixtures` dokunulmadı.

## PT bulguları

Yok (bölme sırasında hata görülmedi).
