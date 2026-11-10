# WS Sinyalizasyon ve DataChannel Protokolü
Ana belge: `docs/mimari.md` §4. Şemalar: `packages/contracts/src/ws.ts` ve `src/dc.ts` (zod, `z.discriminatedUnion("t", ...)`).
Go istemci aynı sözleşmeyi elle yazılmış struct'larla uygular; uyum `packages/contracts/fixtures/*.json` örnekleriyle
iki tarafta (Vitest + `go test`) doğrulanır (kod üretici yok — ADR-0004).

## 1. WS bağlantısı
| | Teknisyen | Müşteri (tarayıcı) | Müşteri (Go istemci) |
|---|---|---|---|
| URL | `wss://<host>:<port>/ws/tech?sessionId=<id>` (id gizli değildir) | `wss://<host>:<port>/ws/guest` (**sorgu dizesi yok**) | aynı |
| Kimlik bilgisi taşıma (G-10) | `rs_session` çerezi | `Sec-WebSocket-Protocol: rs.v1, rs.ticket.<wsTicket>` — yeniden bağlanmada `rs.reconnect.<reconnectToken>`; sunucu yanıtta yalnız `rs.v1` seçer | aynı (coder/websocket `Subprotocols`) |
| Doğrulama (upgrade anında) | `Origin ∈ ALLOWED_ORIGINS` + çerez + `auth_sessions` geçerli + oturum sahibi (Admin dahil başkası **hayır**, AC-15) | Origin + `wsTicket` (join'den, 60 sn, tek kullanımlık) | Origin yoksa `ticket.kind === "AGENT"` (AC-14) |
| Ret | HTTP 403 (upgrade öncesi) | 403 (URL'de `ticket`/`reconnect` sorgu parametresi varsa da 403 — sızmış biçim reddedilir) | 403 |
Not: tarayıcı Origin başlığını gönderir ve **sahte gönderemez**; native istemci Origin'siz gelir. Kural: `Origin` varsa allowlist'te olmalı; yoksa `ticket.kind === "AGENT"` olmalı. `User-Agent` **hiçbir karara girmez**, yalnız log bilgisidir (G-20).
Teknisyen soketi 60 sn'de bir `auth_sessions`'ı yeniden doğrular; geçersizse `session.ended{auth_revoked}` + 4401 kapanış (G-04).
Yeniden bağlanma (G-10): `rs.reconnect.*` yalnız odada `guestSocket` **yokken** kabul edilir; misafir bağlıyken gelen istek 403 + audit `reconnect.conflict`. Başarılı kullanımda token yenilenir (`hello.reconnectToken`). Yeniden bağlanan misafir lobiye girmez; kontrol `VIEW` başlar.

Sınırlar (AC-17..19): `maxPayload` 64 KB (aşım → 1009 yerine kontrollü 1008), zod hatası → 1008 + log, 50 mesaj/sn token-bucket aşımı → 1008 + log `ws_rate_exceeded`, sunucu ping 30 sn, 2 pong kaçarsa terminate.

## 2. Mesaj zarfı
Her mesaj: `{ "t": "<tip>", "id"?: string(≤26), ...alanlar }`. Sunucu karşı tarafa iletirken alanları **yeniden kurar** (gelen nesneyi olduğu gibi aktarmaz; ekstra alan `strict()` ile reddedilir).

## 3. Mesaj tipleri
| t | Yön | Alanlar (zod) | Sunucu davranışı |
|---|---|---|---|
| `hello` | S→iki taraf | `role: "tech"\|"guest"`, `sessionId`, `peerPresent: bool`, `guestKind?`, `iceServers[]`, `maxEndsAt: iso`, `caps?: ("remote_control"\|"file_transfer")[]` (yalnız guest, G-09), `reconnectToken?` (yalnız guest) | Teknisyene bağlanınca; **misafire yalnız admit sonrası** (G-01). TURN credential ilk kez burada |
| `lobby.wait` | S→guest | `expiresAt: iso` | Ticket ile bağlanan misafire ilk mesaj; misafir bu durumda yalnız `session.end` gönderebilir, diğer her tip → 1008 |
| `peer.pending` | S→tech | `guestId`, `name: string(≤100)`, `guestKind`, `since: iso` | Lobiye giren her misafir (≤3); `peer.pending.left{guestId, reason: "left"\|"timeout"\|"rejected"}` ile düşer |
| `guest.admit` | tech→S | `admitCode: /^\d{4}$/` | Sunucu kodu lobi misafirlerinin hash'leriyle `timingSafeEqual` karşılaştırır; eşleşen misafir admit edilir (TX: tüketim + consent + audit `guest.admitted`), diğer lobi misafirlerine `session.ended{rejected}`; eşleşme yoksa `error{ADMIT_CODE_INVALID}` + audit; oturum başına 5. hatada lobi boşaltılır |
| `guest.reject` | tech→S | `guestId` | Misafire `session.ended{rejected}`; ipKey o oturumun ret listesine; kod geçerli kalır; audit `guest.rejected` |
| `ice.servers` | S→iki taraf | `iceServers[]` | Credential bitişinden 5 dk önce (G-13); alıcı `setConfiguration`, teknisyen ardından `ice.restart` akışını başlatır |
| `control.revoke` | S→guest | `reason: "permission"\|"audit"\|"admin"` | Yetki kaldırıldı veya kontrol audit'i yazılamadı (G-04, G-15); istemci kapıyı **kapatır** (açamaz) ve `control.state{VIEW, source:"SYSTEM"}` döner |
| `caps.update` | S→guest | `caps[]` | Teknisyen yetkisi değişince (G-09) |
| `peer.joined` / `peer.left` | S→karşı | `role`, `reason?: "disconnect"\|"ended"` | `peer.left(disconnect)` → UI "Bağlantı koptu, yeniden bağlanılıyor" (AC-24) |
| `sdp.offer` / `sdp.answer` | tech↔guest | `sdp: string(≤60000)` | Yalnız aynı odadaki karşı tarafa (AC-20). Offer'ı **teknisyen** oluşturur (recvonly video + DC'ler); guest answer verir |
| `ice` | tech↔guest | `candidate: string(≤2000)`, `sdpMid?: string(≤32)`, `sdpMLineIndex?: int 0..16` | Aynı |
| `ice.restart` | tech→guest | — | ICE yeniden başlatma isteği (ağ değişimi) |
| `share.state` | guest→S→tech | `state: "sharing"\|"stopped"`, `monitors?: [{id:int,name:string(≤64),w,h,primary}]`, `activeMonitor?: int` | AC-31, AC-43 |
| `monitor.request` | tech→S→guest | `monitorId: int` | Yalnız AGENT; müşteri diyaloğu (AC-43); `control.request` ile aynı 30 sn / 5 istek kuralı (G-03) |
| `control.request` | tech→S→guest | — | **Yetki** `remote_control.use` yoksa → `error{FORBIDDEN}` (AC-51); guestKind BROWSER → ret (AC-34); **ret sonrası 30 sn** ve **oturum başına 5. istekten sonra** → `error{RATE_LIMITED}`, iletilmez (G-03); `controlState=REQUESTED` |
| `control.state` | guest→S→tech | `state: "VIEW"\|"GRANTED"`, `source: "UI"\|"HOTKEY"\|"DENIED"\|"RECONNECT"\|"SYSTEM"` | Sunucu `session_consents` + audit yazar (AC-29, 111); GRANTED audit'i yazılamazsa → `control.revoke{audit}` + teknisyene `error` (fail-closed, G-15); bilgi amaçlı — **izin kararı istemcide** |
| `env.state` | guest(AGENT)→S→tech | `elevatedForeground: bool`, `secureDesktop: bool` | AC-105 |
| `quality.summary` | tech→S | `fps{avg,min,max}`, `kbps{...}`, `rttMs{...}`, `connType: "host"\|"srflx"\|"relay"` | Oturum sonunda/periyodik 60 sn; DB'ye yazılır (AC-46) |
| `file.meta` | iki taraf→S | `direction`, `fileName: string(1..255)`, `sizeBytes`, `sha256: /^[a-f0-9]{64}$/`, `result` | session_files + audit (AC-55). İçerik asla WS'den geçmez |
| `session.end` | iki taraf→S | — | `ENDED`, `ended_by`; iki tarafa `session.ended` |
| `session.ended` | S→iki taraf | `reason: "tech"\|"customer"\|"timeout"\|"max_duration"\|"cancelled"\|"tenant_passive"\|"server"\|"admin"\|"auth_revoked"\|"rejected"\|"lobby_timeout"` | Kapanış; istemci 3 sn içinde çıkar (AC-107). `rejected`/`lobby_timeout` yalnız o misafire, oturum PENDING kalır |
| `session.warning` | S→iki taraf | `kind: "max_duration_5min"`, `endsAt` | AC-13 |
| `error` | S→taraf | `code`, `message` | — |

### 3.1 Misafir durum makinesi (G-01)
`TICKETED` →(WS)→ `LOBBY` →(`guest.admit` doğru kod)→ `ADMITTED` (oturum ACTIVE; `hello` + `peer.joined`) ; `LOBBY` →(ret / 5 dk / 5 hatalı kod / başka misafir kabul edildi)→ kapalı. Lobi kuralları: oda başına ≤ 3 misafir (4.'süne join `409 LOBBY_FULL`), ret listesindeki ipKey join'de `403`, teknisyen bağlı değilse misafir yine bekler (5 dk). Oturumda 3 ret olunca konsol "Oturumu iptal edip yenisini açın" önerir (kod sızmış kabul edilir). `sdp.*`, `ice`, `share.state` vb. yalnız `ADMITTED` misafirden kabul edilir, aksi 1008.

Teknisyen `control.request` yalnız **istek**tir; izin müşteri UI'ında verilir. Yeniden bağlanmada sunucu `controlState=VIEW` yapar, istemci de yeni PeerConnection'da kapıyı kapalı başlatır (AC-24).

## 4. DataChannel'lar (teknisyen offer'da açar)
Alıcı kuralı (G-09): misafir tarafı (istemci + müşteri sayfası) `hello.caps`/`caps.update`'te olmayan yeteneğe ait DC mesajını reddeder (`file.offer` → otomatik `file.reject`; `input` → düşür). DC sözleşmesinde `control.*` tipi **yoktur**; kontrol isteği yalnız WS'den gelir (zod `strict` bilinmeyen tipi zaten reddeder).
| Label | Ayar | Taşıdığı |
|---|---|---|
| `ctl` | ordered, reliable | chat, annotation, file offer/accept/cancel/done, ping |
| `file` | ordered, reliable, binary | dosya parçaları |
| `input` | ordered, reliable | fare/klavye olayları (yalnız AGENT; BROWSER guest bu kanalı **kabul etmez**/kapatır) |

### 4.1 `ctl` mesajları (JSON, ≤ 16 KB)
| t | Alanlar | Kural |
|---|---|---|
| `chat` | `id`, `text: string(1..2000)`, `ts: int (ms)` | Alıcı `textContent` ile basar (AC-35); okunmamış sayaç UI'da |
| `annot.stroke` | `id`, `tool: "pen"\|"arrow"\|"rect"`, `color: "red"\|"yellow"\|"green"\|"blue"`, `pts: [[x,y],...] (0..1, ≤ 500 nokta)` | Normalize (AC-56) |
| `annot.laser` | `x, y (0..1)` | Throttle 30/sn; alıcıda 1 sn sönümleme (AC-57) |
| `annot.undo` / `annot.clear` | `id?` | — |
| `file.offer` | `fid`, `name: string(1..255)`, `size: int ≤ maxFileBytes`, `sha256` | Alıcı onay ister; ad **gösterimden önce** `sanitizeFileName` ile temizlenir; tehlikeli uzantı/çift uzantı uyarısı (AC-36); kabul diyaloğu odak/gecikme kuralları §4.3 (G-03); alıcı ret sonrası 30 sn yeni teklifi otomatik reddeder, aynı anda tek bekleyen teklif |
| `file.accept` / `file.reject` / `file.cancel` | `fid` | Kabul gelmeden gönderen parça yollamaz |
| `file.done` | `fid` | Alıcı SHA-256 doğrular → `file.result{fid, ok}`; uyuşmazsa sil + "Dosya bozuk" (AC-54) |

### 4.2 `file` kanalı
Çerçeve: `fidIndex(uint16) | seq(uint32) | payload(≤ 16 KB)`. Akış kontrolü: `bufferedAmountLowThreshold = 1 MB`, gönderen
`bufferedAmount > 4 MB` iken bekler. Alıcı tarayıcıda `showSaveFilePicker` varsa akışla diske yazar, yoksa bellek
(≤ maxFileMb) + Blob; Go istemci `%USERPROFILE%\Downloads` altına **müşteri seçimiyle** yazar (AC-36). Tek seferde tek aktif transfer/yön.
Alıcı güvenliği (G-06, iki tarafta aynı; kural `packages/contracts/src/files.ts`, Go eşi `internal/files`, ortak `fixtures/file-names.json`):
1. `sanitizeFileName`: son yol bileşeni (`/` ve `\` ile böl) → `[\\/:*?"<>|\x00-\x1F]` ve Unicode `Cf` (RTLO `U+202E` dahil) sil → sondaki nokta/boşluk sil → `CON PRN AUX NUL COM1-9 LPT1-9` (uzantılı da) ise `_` önek → boşsa `dosya` → ≤ 255 karakter (uzantı korunarak kısalt).
2. Çakışmada ` (1)`, ` (2)` eklenir; üzerine yazma yok. Dosya önce `<ad>.part` olarak yazılır, SHA-256 doğrulanınca yeniden adlandırılır (AC-54).
3. Go: dosya kapanınca `<yol>:Zone.Identifier` ADS'ine `[ZoneTransfer]\r\nZoneId=3` yazılır (MOTW → SmartScreen/Office korumalı görünüm). Tarayıcı indirmesinde MOTW'yi tarayıcı ekler.
4. Tehlikeli uzantı listesi tek sabit (`DANGEROUS_EXT`, AC-36 rev. listesi); çift uzantı (`.pdf.exe`) ayrıca vurgulanır.
5. Sınır **alınan bayt** sayacıyla: `received > offer.size` veya `> maxFileBytes` → transfer iptal + `.part` silinir (beyan edilen `size`'a güvenilmez).

### 4.3 `input` kanalı ve izin kapısı (AC-47..50, 99..104)
| t | Alanlar |
|---|---|
| `m.move` | `x, y: number 0..1` (aktif monitöre göre normalize, AC-49) |
| `m.btn` | `b: "l"\|"r"\|"m"`, `down: bool`, `x, y` |
| `m.wheel` | `dx, dy: int (-1200..1200)` |
| `k` | `code: KeyboardEvent.code (≤ 32)`, `down: bool`, `key?: string(≤ 4)` (Türkçe karakter için `key` → `KEYEVENTF_UNICODE`) |
| `k.release_all` | — (odak kaybında takılı tuş önleme) |

**İzin kapısı (Go istemci, `internal/control/gate.go`) — tek doğruluk kaynağı:**
1. `gate` durumları `CLOSED` (vars.) / `OPEN`. Yalnız **yerel, enjekte olmayan** kullanıcı etkileşimi (`Erişime izin ver` tıklaması; `LLMHF_INJECTED` bayraklı tıklamalar istemci penceresinde yok sayılır) `OPEN` yapar.
2. `CLOSED` yapanlar: "Kontrolü kapat", global kısayol **Ctrl+Shift+F12** (`RegisterHotKey`, AC-102; başarısızsa **Ctrl+Shift+F11**, ekranda kaydedilen yazılır; ikisi de alınamazsa "İzin ver" devre dışı + açıklama — G-21), oturum sonu, PeerConnection/WS kopması, yeniden bağlanma, `control.revoke` (G-04/G-15).
   **İzin diyaloğu kuralları (G-03; kontrol, monitör, dosya kabul diyaloglarında ortak `ui/consent_dialog.go`):** varsayılan/odak düğme "Reddet"; Enter ve Space "İzin ver"i tetiklemez (yalnız fare tıklaması veya Tab ile odaklanıp Alt+İ erişim tuşu); butonlar diyalog göründükten **1,5 sn** sonra etkin; diyalog fare imlecini içermeyecek konumda açılır (imleç merkezdeyse üst-orta); diyalog açıkken gelen ikinci istek yeni diyalog açmaz.
3. Her `input` mesajında `SendInput`'tan **hemen önce** atomik `gate.IsOpen()` kontrolü; kapalıysa düşür + sayaç (AC-101; test sahte mesaj enjekte eder, < 100 ms).
4. Yerel girdi önceliği: `WH_MOUSE_LL`/`WH_KEYBOARD_LL` hook'unda enjekte olmayan olay → `suspendUntil = now+1s` (AC-104).
5. `Ctrl+Alt+Del` ve `Win+L` iletilmez (konsolda buton yok, AC-48); Alt+Tab, Win kombinasyonları `SendInput` ile.
Tarayıcı modunda input kanalı yoktur; sunucu `control.request`'i reddeder — iki katmanlı (AC-34).
