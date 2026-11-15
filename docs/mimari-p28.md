# Mimari — P28 (G8 ürün genişlemeleri): çatı + P28a ayrıntılı tasarım

Tarih: 2026-11-15 · Durum: **TASLAK r1** (mimar; kullanıcı uyurken "soru sorma" talimatıyla, belirsizlikler K-P28a-n kararı olarak yazıldı) · Dal tabanı: P27 sonrası
Girdiler: `docs/gereksinimler-p28.md` (AC-343..352, AC-404, V41..V54, R39..R50), `docs/gereksinimler-kabul-kriterleri-e11-b.md` (AC-282, AC-283, AC-285..290),
`docs/mimari-protokol.md` (§3 WS, §4 DataChannel), `docs/mimari-e11.md` §11 (P28 notları), `docs/mimari-p27.md` (desen), ADR-0004, ADR-0009, ADR-0025, ADR-0028.
Yeni ADR: **ADR-0031** (uzaktan yazdırma: yalnız Windows istemci, Windows.Data.Pdf + GDI, yalıtılmış işleyici süreç).
Kontrol listesi: `docs/tasarim-kontrol.md` "P28a" bölümü.

**Bağlayıcı ilke — sadelik (kullanıcı kararı):** tek ekran, tek yol; açılış yoluna (kod, bağlantı, talep, kayıtlı bilgisayar) göre değişen davranış
yok. Pano ve yazdırma, oturum hangi yoldan açılmış olursa olsun **aynı** konsol düğmeleri, **aynı** WS/DC mesajları ve **aynı** istemci diyaloğuyla çalışır.

---

## 0. P28 çatısı (tüm alt paketler için genel ilkeler)

1. **İçerik uçtan uca kalır (P28b hariç).** Pano metni, PDF baytları, dosya adı, ses, görüntü sunucudan geçmez; WS yalnız **yetkilendirme,
   durum ve audit** taşır, içerik DataChannel'dadır. (Aydınlatma metni bugün "görüntü, kontrol ve dosya uçtan uca" der — AC-292; P28a bu
   cümleyi bozmaz, P28b tenant ayarıyla bilinçli olarak daraltır, AC-363.)
2. **Sunucu kapısı + istemci kapısı (iki katman, ADR-0009 kalıbı).** Her yeni yetenek için: sunucu yetki/durum denetler ve isteği **tek
   kullanımlık kimlikle** (cid/pid) misafire iletir; misafir yalnız sunucunun ilettiği kimliğe ait DC içeriğini uygular. Konsolun DC'den
   doğrudan gönderdiği (sunucudan geçmemiş) içerik misafirde reddedilir. Böylece "yetkisiz mesaj sunucuda 403" iddiası gerçek bir kapıdır.
3. **Yetenek bildirimi (feature) sürüme değil alt protokol belirtecine dayanır** (P18 `rs.cap.chat1` kalıbı): misafir `/ws/guest`'e
   `rs.cap.<özellik><sürüm>` belirteçleriyle bağlanır. Sunucu, misafirin bildirmediği bir özelliğe ait **hiçbir** yeni değer/tip göndermez
   (eski Go istemcisi `caps` ve mesaj tiplerini katı ayrıştırır — `internal/signal/inbound.go` `caps` listesi; bilinmeyen değer = bağlantı kopar).
4. **Müşteri onayı isteyen özellik gözetimsiz oturumda yoktur** (V45): P27 yardımcısı (`internal/unattended/helper`) özellik belirteci
   bildirmez → sunucu kapısı kapalıdır. Ayrı kod yolu yazılmaz; konsol yalnız neden metnini gösterir.
5. **Yetki anahtarları yalnız `packages/contracts/src/permissions.ts`'e** eklenir (AC-404); rol varsayılanı değişmez (Admin açık, User kapalı);
   anahtar rol hesabıyla üretildiği için **migration gerekmez** (P27 §4.1 ile aynı).
6. **Metinler tek ileti tablosunda:** web `apps/web/messages/tr.json`, Go `internal/flow/messages.go` kalıbında yeni `internal/flow/messages_p28.go`
   (P23 çevirisi için tek yer; mimari-e11 §11 notu).
7. **Platform ayrımı:** platforma özgü kod (Win32 pano, PDF yazdırma) arayüz arkasındadır (`internal/clip`, `internal/printing`); P28f/P28g yalnız
   `_darwin.go` / `_linux.go` uygulamasını ekler, protokol ve akış değişmez.
8. **Çoklu teknisyen hazırlığı (P28c genişleme noktası):** sunucu kapısındaki "bu teknisyen" denetimi tek fonksiyondadır
   (`signaling/clip-print.ts` `actorMay(room, conn, feature)`); P28c bunu "kontrol sahibi mi / katılımcı mı / izleyici mi" kuralıyla değiştirir.

### 0.1 P28b–g yol haritası notu (ayrıntı her paketin kendi tasarım turunda)

| Paket | Bu belgeden devraldığı                                                                                                    | Ayrıntılı tasarımda ele alınacak (mimar)                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| P28b  | Yazdırma baytları `PrintSource` arayüzüyle alınır (bugün DC). Ayar açıkken yazdırma da sunucu yolundan gelir (AC-355)     | ADR: depolama düzeni, AES-256-GCM anahtar türetme, clamd konteyneri, kota, 03:30 silme, DC dosya kanalının reddi |
| P28c  | `actorMay` tek noktası; pano yalnız kontrol sahibine, yazdırma katılımcılara (izleyiciye değil, AC-368)                   | Oda modeli (N teknisyen), davet/devir, `hello`/`peer.joined` çok teknisyenli biçim, mesh bant önceliği           |
| P28d  | Özellik belirteci kalıbı (`rs.cap.voice1`), onay diyaloğu kalıbı (AC-116), 60 sn yanıtsızlık = ret                        | ADR: Go'da Opus (cgo/saf Go), yankı giderme yok, N katılımcı ses akışı                                           |
| P28e  | Rıza = ayrı onay satırı; gözetimsizde yok (V45); depolama P28b                                                            | Kayıt teknisyen tarafında mı (V48), parça yükleme, oynatıcı, saklama işi                                         |
| P28f  | `internal/clip` + `internal/printing` arayüzleri; macOS'ta yazdırma CUPS (`lp` PDF'i doğrudan kabul eder, JS çalıştırmaz) | ADR: universal ikili, imza/notarization, TCC izinleri, iz testi                                                  |
| P28g  | Aynı arayüzler; Linux'ta CUPS; pano X11 (`CLIPBOARD` seçimi) / Wayland (portal — yoksa özellik bildirilmez)               | Wayland portal sınırları, destek matrisi                                                                         |

---

## 1. P28a kapsamı

| Kapsamda                                                                                                                    | Kapsam dışı / Sonra (neden)                                                                        |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Elle iki düğme: "Panoyu gönder" (teknisyen → müşteri), "Müşteri panosunu al" (müşteri → teknisyen), düz metin ≤ 64 KB       | Otomatik pano eşitleme, dosya/görsel/zengin metin panosu (AC-282, R47)                             |
| Müşteri istemcisinde oturum başına "Pano paylaşımına izin ver" anahtarı (varsayılan kapalı)                                 | Tarayıcı modu müşterisi: kontrol yok → pano yok (AC-343 kontrol izni şartı); yazdırma yok (AC-348) |
| "Uzaktan yazdır": PDF (`%PDF-`), ≤ 20 MB, müşterinin varsayılan yazıcısı, tek kopya, iş başına müşteri onayı                | Yazıcı seçimi, kopya sayısı, çift yüz, PDF dışı biçim (Sonra, §4 madde 3)                          |
| Windows istemci (Go) + teknisyen konsolu (web) + sunucu kapısı/audit                                                        | macOS/Linux (P28f/g), gözetimsiz oturum (V45), sunucu üzerinden dosya yolu (P28b)                  |
| Yeni yetki: `remote_control.clipboard`, `file_transfer.print`; audit `clipboard.transfer`, `clipboard.consent`, `print.job` | Yeni tablo/migration (gerek yok; olaylar audit'te, K-P28a-9), tenant ayarı (K-P28a-10)             |

## 2. Bileşenler ve sorumluluklar

```mermaid
flowchart LR
  subgraph Konsol[Teknisyen konsolu - apps/web]
    CP[collab/clip-print-panel.tsx]
    CL[lib/clip/*  lib/print/*]
  end
  subgraph Sunucu[apps/server]
    G[signaling/clip-print.ts\nkapı + bekleyen iş + audit]
    H[signaling/handlers.ts\ndağıtım]
    A[(audit_logs)]
  end
  subgraph Istemci[Windows istemci - apps/agent-win]
    F[flow/clipprint.go\ndurum makinesi]
    C[internal/clip\nWin32 pano]
    P[internal/printing\nüst süreç: GDI yazdırma]
    W[[noktadestek --pdf-isleyici\nLow IL + job: Windows.Data.Pdf]]
    U[ui: anahtar + onay diyaloğu + bildirim]
  end
  CP --> CL
  CL -- WS clip.*/print.* (içerik yok) --> H --> G --> A
  G -- WS clip.*/print.* (cid/pid yetkisi) --> F
  CL <-. DC ctl clip.data / file kanalı PDF .-> F
  F --> C
  F --> P --> W
  F --> U
```

| Bileşen                                  | Sorumluluk                                                                                                                                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signaling/clip-print.ts` (yeni)         | Kapı sırası (§4.3), oda başına tek bekleyen pano işi + tek bekleyen yazdırma işi, zaman aşımları, `clipboard.consent` durumu, audit + metrik, iletimde alanları **yeniden kurma**                              |
| `signaling/handlers.ts` (ek, ≤ 20 satır) | Yeni tiplerin `switch` dalları → `clip-print.ts`                                                                                                                                                               |
| `signaling/ws-auth.ts` (ek)              | `rs.cap.clip1`, `rs.cap.print1` belirteçlerini okuyup bağlantıya `features` olarak koyar (doğrulamaya girmez; bilinmeyen `rs.cap.*` yok sayılır)                                                               |
| `signaling/control*.ts` (kanca)          | Kontrol `VIEW`'a her geçişte `clipPrint.onControlClosed(room)` (pano izni sunucuda kapanır)                                                                                                                    |
| Go `internal/clip` (yeni)                | `Read() (text, sensitive bool, err)`, `Write(text) error`; Windows: `OpenClipboard`/`CF_UNICODETEXT`, gizli içerik biçimleri (§5.3)                                                                            |
| Go `internal/printing` (yeni)            | `DefaultPrinter()`, `Inspect(pdf) (pages)`, `Print(pdf, printer)`; işleyici süreci başlatır (job + düşük bütünlük), sayfa bitmap'lerini GDI ile varsayılan yazıcıya basar (ADR-0031)                           |
| Go `flow/clipprint.go` (yeni)            | Yetkili cid/pid kümesi, anahtar durumu, DC alma/gönderme, sonuç raporu (`clip.report`, `print.report`)                                                                                                         |
| Go `ui` (ek)                             | Oturum penceresinde anahtar (yalnız gerçek yerel girdiyle değişir), 3 sn bildirim, yazdırma onay diyaloğu (`consentDlg` yeniden kullanılır)                                                                    |
| Web `lib/clip`, `lib/print` (yeni)       | Tarayıcı Clipboard API, PDF doğrulama (ilk 5 bayt + boyut + SHA-256), DC gönderim (mevcut `file-send.ts` çerçeveleme/akış kontrolü yeniden kullanılır), düğme durum işlevi `featureState()` (saf, test edilir) |

## 3. Veri modeli

**Yeni tablo, sütun veya migration yok (K-P28a-9).** Gerekçe: AC-347/351 yalnız audit ister; pano içeriği ve PDF hiçbir yerde saklanmaz.
Olaylar mevcut `audit_logs`'a `entity = "support_sessions"`, `entity_id = sessionId`, `tenant_id` ile yazılır; silme/anonimleştirme mevcut
audit saklama kuralına (730 gün, P13a) tabidir. Oda durumu bellektedir (ADR-0005):

| `Room` alanı (`signaling/types.ts`, ek)                  | Anlam                                                                                                                   |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `guestFeatures: ReadonlySet<"clipboard" \| "print">`     | Bağlı ADMITTED misafirin bildirdiği belirteçler; misafir ayrılınca boşalır, yeniden bağlanan soketin kendisinden okunur |
| `clipConsent: boolean`                                   | Müşteri anahtarı açık mı (sunucu aynası); kontrol `VIEW`'a dönünce, misafir kopunca, oturum bitince `false`             |
| `clipPending: {cid, dir, techUserId, at} \| null`        | Oda başına tek bekleyen pano işi, 10 sn zaman aşımı                                                                     |
| `clipTimes: number[]`                                    | Son 60 sn'lik pano istekleri (≤ 30/dk)                                                                                  |
| `printPending: {pid, sizeBytes, techUserId, at} \| null` | Oda başına tek bekleyen yazdırma işi, 10 dk sert zaman aşımı                                                            |
| `printCount: number`, `printCooldownUntil: number`       | Oturum başına ≤ 20 iletilen istek; müşteri reddi / yanıtsızlık sonrası 30 sn bekleme (G-03 kalıbı)                      |

## 4. Protokol ve sözleşme (`packages/contracts`)

### 4.1 Yetki anahtarları (`permissions.ts`, AC-404)

```ts
{ key: "remote_control", actions: ["use", "clipboard"] },
{ key: "file_transfer", actions: ["use", "print"] },
```

`PERMISSION_DESCRIPTIONS`:

- `remote_control.clipboard`: "Kontrol izni verilmiş oturumda, müşteri ayrıca izin verirse düz metin panosunu gönderir ve alır."
- `file_transfer.print`: "Müşterinin onayıyla PDF belgeyi müşterinin varsayılan yazıcısına gönderir (yalnız Windows uygulaması)."

`caps` eşlemesi (G-09, `signaling/ws-auth.ts`/`rooms.ts` mevcut üretim): `remote_control.clipboard` → `"clipboard"`, `file_transfer.print` → `"print"`.
`CAPS = ["remote_control", "file_transfer", "clipboard", "print"]`. **Kural:** misafire giden `hello.caps` ve `caps.update` yeni değerleri
yalnız misafir ilgili özelliği bildirdiyse içerir (`capsFor(perms, guestFeatures)`); eski istemciye bugünkü iki değer gider (geri uyum testi).
`file_transfer.print` `file_transfer.use`'dan **bağımsızdır** (AC-348 yalnız print yetkisini sayar); `remote_control.clipboard` pratikte
`remote_control.use` ister çünkü kontrol izni olmadan pano kapısı açılmaz.

### 4.2 Özellik bildirimi (WS alt protokolü)

`/ws/guest` istemcisi: `Sec-WebSocket-Protocol: rs.v1, rs.ticket.<t>|rs.reconnect.<r>, rs.cap.clip1, rs.cap.print1`. Sunucu yanıtı yine yalnız
`rs.v1`. Sabitler `ws.ts`: `WS_GUEST_CAP_CLIP = "rs.cap.clip1"`, `WS_GUEST_CAP_PRINT = "rs.cap.print1"`. Tarayıcı misafir sayfası bildirmez.
P27 yardımcısı bildirmez (`signal.Dial(..., features)` parametresi; helper boş geçer). Belirteçler kimlik değildir; Caddy bu başlığı loglamaz (G-10).

Teknisyene: `hello` (tech) ve `peer.joined{role:"guest"}` yeni isteğe bağlı alan `guestFeatures?: ("clipboard"|"print")[]` (yoksa `[]`),
`hello` ayrıca `clipConsent?: boolean` (teknisyen yeniden bağlandığında kontrol zaten `VIEW`'a döndüğü için pratikte `false`; alan şemada tutarlılık için).

### 4.3 WS mesajları (`ws.ts`, `z.strictObject`; Go eşi `internal/signal`)

Kimlikler: `cid`, `pid` = `/^[A-Za-z0-9_-]{8,26}$/` (konsol üretir, 16 bayt rastgele base64url). Sunucu her iletimde alanları yeniden kurar.

| t               | Yön          | Alanlar                                                                                                      | Sunucu davranışı                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------- | ------------ | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clip.consent`  | guest→S→tech | `on: boolean`                                                                                                | Yalnız `clipboard` özelliği bildiren ADMITTED misafirden (aksi 1008). `on:true` yalnız `controlState=GRANTED` iken kabul; değilse yok say + misafire `clip.consent{on:false}` (istemci anahtarı geri kapatır). Değişimde `room.clipConsent` + audit `clipboard.consent{on, by:"customer"}` + teknisyene iletim. Aynı değer tekrarında no-op                                                                                                                                                                                                                                                                          |
| `clip.consent`  | S→guest      | `on: false`                                                                                                  | Sunucunun kapattığını bildirir (kontrol kapandı / yetki daraldı); istemci anahtarı kapatır, **yanıt göndermez**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `clip.push`     | tech→S→guest | `cid`, `bytes: int 1..65536`                                                                                 | Kapı sırası (ilk tutan döner, iletilmez): (1) `remote_control.clipboard` yetkisi yok veya `caps`'te yok → `error{FORBIDDEN}`; (2) ADMITTED misafir yok → `error{CONFLICT}`; (3) misafir `clipboard` özelliği yok → `error{FORBIDDEN}` "Müşterinin uygulaması bu özelliği desteklemiyor"; (4) `controlState≠GRANTED` → `error{FORBIDDEN}` "Kontrol izni yok"; (5) `clipConsent=false` → `error{FORBIDDEN}` "Müşteri pano iznini açmadı"; (6) `clipPending` var → `error{CONFLICT}`; (7) son 60 sn'de ≥ 30 istek → `error{RATE_LIMITED}`. Geçerse `clipPending` kurulur, misafire iletilir (`techUserId` teknisyenden) |
| `clip.pull`     | tech→S→guest | `cid`                                                                                                        | `clip.push` ile aynı kapı                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `clip.report`   | guest→S      | `cid`, `dir: "TO_CUSTOMER"\|"TO_TECH"`, `bytes: int 0..65536`, `result` (aşağıda)                            | Yalnız `clipPending.cid` eşleşirse (aksi yok say + log). Audit `clipboard.transfer{direction, bytes, result}` (actor = isteyen teknisyen, `reportedBy:"customer"`), metrik, `clipPending=null`, teknisyene `clip.status{cid, result, bytes}`                                                                                                                                                                                                                                                                                                                                                                         |
| `clip.status`   | S→tech       | `cid`, `result`, `bytes`                                                                                     | Konsol sonuç metnini gösterir. 10 sn içinde rapor gelmezse sunucu `result:"TIMEOUT"` üretir (audit dahil); misafir koparsa `"DISCONNECTED"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `print.request` | tech→S→guest | `pid`, `sizeBytes: int 5..20971520`                                                                          | Kapı: (1) `file_transfer.print` / `caps.print` yok → `FORBIDDEN`; (2) misafir yok → `CONFLICT`; (3) misafir BROWSER veya `print` özelliği yok → `FORBIDDEN` (AC-348, AC-352); (4) `printPending` var → `CONFLICT`; (5) `printCooldownUntil > now` → `RATE_LIMITED`; (6) `printCount ≥ 20` → `RATE_LIMITED`. Geçerse `printCount++`, `printPending` kurulur, misafire `print.request{pid, sizeBytes}` iletilir. **Dosya adı ve hash WS'den geçmez** (DC `print.offer`'da)                                                                                                                                             |
| `print.cancel`  | tech→S→guest | `pid`                                                                                                        | Bekleyen eşleşirse misafire iletilir (istemci aktarımı keser / diyaloğu kapatır, `print.report{CANCELLED}` gönderir). Eşleşmezse yok say. Teknisyen koparsa sunucu aynı mesajı kendisi üretir (K3 simetriği)                                                                                                                                                                                                                                                                                                                                                                                                         |
| `print.report`  | guest→S      | `pid`, `decision: "APPROVED"\|"REJECTED"\|"TIMEOUT"\|"NONE"`, `result`, `pages?: int 1..100000`, `sizeBytes` | Yalnız `printPending.pid` eşleşirse. Audit `print.job{decision, pages, sizeBytes, result}` (actor = teknisyen, `reportedBy:"customer"`; ad/içerik yok, AC-351), metrik; `REJECTED`/`TIMEOUT` → `printCooldownUntil = now + 30 sn`; teknisyene `print.status`                                                                                                                                                                                                                                                                                                                                                         |
| `print.status`  | S→tech       | `pid`, `result`, `pages?`                                                                                    | Sunucu 10 dk içinde rapor almazsa `result:"ABANDONED"`, misafir koparsa `"DISCONNECTED"` üretir (audit dahil)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Sonuç kümeleri (`ws.ts` sabitleri, Go eşi; fikstür `fixtures/clip-print.json`):

- `CLIP_RESULTS = ["OK", "EMPTY", "TOO_LARGE", "SENSITIVE", "INVALID", "DENIED", "ERROR", "TIMEOUT", "DISCONNECTED"]` (son ikisini yalnız sunucu üretir).
- `PRINT_RESULTS = ["PRINTED", "NO_PRINTER", "REJECTED", "TIMEOUT", "INVALID_PDF", "TOO_LARGE", "BUSY", "CANCELLED", "ERROR", "ABANDONED", "DISCONNECTED"]` (son ikisi yalnız sunucu).

Misafirden gelen `clip.*`/`print.*` mesajları yalnız ilgili özelliği bildiren sokette şemadadır (P18 S-P18-T1 kalıbı: şema sokete göre seçilir;
yeteneksiz sokette bu tipler → 1008). WS `maxPayload` (64 KB) değişmez; içerik WS'den geçmediği için yeterlidir.

### 4.4 DataChannel mesajları (`dc.ts`; `ctl` ≤ 16 KB; Go eşi `internal/dc`)

| t             | Yön        | Alanlar                                                                                      | Kural                                                                                                                                                                               |
| ------------- | ---------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clip.ready`  | guest→tech | `cid`                                                                                        | Misafir WS `clip.push`'u aldı ve kabul etti; konsol ancak bundan sonra veri gönderir (WS/DC sıralama yarışı yok)                                                                    |
| `clip.data`   | iki yön    | `cid`, `seq: int 0..7`, `last: boolean`, `b64: string` (≤ 8192 ham bayt → ≤ 10 924 karakter) | UTF-8 baytları 8 KB parçalarla base64; alıcı `seq` ardışık, toplam ≤ 65 536 bayt, `last` sonrası UTF-8 geçerliliği + U+0000 yok denetler. Push'ta toplam = `clip.push.bytes` olmalı |
| `print.ready` | guest→tech | `pid`                                                                                        | Misafir bayt almaya hazır (varsayılan yazıcı var, başka TO_CUSTOMER aktarım yok)                                                                                                    |
| `print.offer` | tech→guest | `pid`, `idx: uint16`, `name: string(1..255)`, `size`, `sha256`                               | `size` = WS'de yetkilenen `sizeBytes` olmalı; ad gösterimden önce `sanitizeFileName` + gösterim süzgeci (G-06)                                                                      |
| `print.done`  | tech→guest | `pid`                                                                                        | Son parçadan sonra; alıcı bayt sayısı + SHA-256 + ilk 5 bayt `%PDF-` denetler                                                                                                       |

PDF baytları mevcut `file` kanalında, mevcut çerçeveyle (`fidIndex = print.offer.idx | seq | payload ≤ 16 KB`) ve mevcut akış kontrolüyle gider
(§4.2 mimari-protokol). Yön başına tek aktif aktarım kuralı yazdırmayı da kapsar: TO_CUSTOMER dosya aktarımı sürerken `print.ready` gönderilmez
(`print.report{NONE, BUSY}`), yazdırma aktarımı sürerken konsol dosya teklifini başlatmaz.

**Misafir alıcı kuralı (bağlayıcı, §0 madde 2):** `clip.data` / `print.offer` / `file` çerçevesi yalnız (a) `caps`'te ilgili değer varsa, (b) cid/pid
sunucudan WS ile gelmiş ve hâlâ bekleyen ise, (c) pano için anahtar açık **ve** kontrol kapısı (`control/gate.go`) açıksa uygulanır. Aksi hâlde düşürülür,
sayaç artar, `report{DENIED}` (cid biliniyorsa) gönderilir. Bu denetim panoya yazmadan **hemen önce** atomik yapılır (AC-344: anahtar kapandıktan sonra
gelen mesaj uygulanmaz; test < 100 ms).

### 4.5 Akışlar

**Pano gönder (teknisyen → müşteri):** konsol tıklama → `navigator.clipboard.readText()` → boş ise "Panoda metin yok", > 65 536 bayt ise
"Pano metni 64 KB sınırını aşıyor" (gönderilmez) → WS `clip.push{cid, bytes}` → sunucu kapısı → misafir: denetim (b,c) → DC `clip.ready` → konsol
`clip.data` parçaları → misafir panoya yazar → 3 sn "Teknisyen panonuza metin koydu" → WS `clip.report{OK}` → audit → konsol `clip.status` "Müşterinin
panosuna kopyalandı".

**Pano al (müşteri → teknisyen):** konsol WS `clip.pull{cid}` → sunucu kapısı → misafir: denetim → `clip.Read()` → yoksa `report{EMPTY}`; gizli
işaretliyse `report{SENSITIVE}` (içerik okunmaz, §5.3); > 64 KB `report{TOO_LARGE}`; değilse DC `clip.data` → 3 sn "Teknisyen panonuzu okudu" →
`report{OK}`. Konsol tüm parçalar gelince `navigator.clipboard.writeText()`; başarısızsa "Tarayıcı panoya yazmaya izin vermedi" (metin ekranda
**gösterilmez**, bellekten atılır).

**Yazdır:** konsol dosya seçici (`accept="application/pdf"`) → ilk 5 bayt `%PDF-` değil → alan hatası "Yalnız PDF dosyası yazdırılabilir"; > 20 MB →
"Dosya 20 MB sınırını aşıyor" (gönderilmez) → SHA-256 → WS `print.request{pid, sizeBytes}` → sunucu kapısı → misafir: varsayılan yazıcı yok →
`report{NONE, NO_PRINTER}`; meşgul → `report{NONE, BUSY}`; değilse DC `print.ready` → konsol `print.offer` + `file` parçaları + `print.done` →
misafir bellekte toplar (yalnız bellek, diske yazmaz) → doğrula → işleyici süreçle sayfa sayısı (`INVALID_PDF` → rapor) → onay diyaloğu (60 sn) →
Yazdır: işleyici sayfaları çizer, üst süreç GDI ile basar → `report{APPROVED, PRINTED|ERROR, pages}`; Reddet/Esc/kapatma → `REJECTED`; 60 sn →
`TIMEOUT`. Her durumda bellek tamponu sıfırlanır ve bırakılır. Konsol: "Gönderiliyor (%)" → "Müşteri onayı bekleniyor" → sonuç.

## 5. Windows istemci (Go) — `apps/agent-win`

### 5.1 Neden yalnız Windows yerel istemci (yazdırma) — ADR-0031 özeti

Tarayıcı müşterisi PDF'i sessizce varsayılan yazıcıya gönderemez (`window.print()` her zaman tarayıcı yazdırma diyaloğunu açar, yazıcı adı ve sayfa
sayısı sayfaya verilmez, PDF görüntüleyicisi tarayıcınındır ve gömülü JS çalıştırabilir). AC-348 zaten tarayıcı modunda düğmeyi gizler. Yazdırma
yalnız Windows istemcisindedir; macOS/Linux P28f/g'de CUPS ile aynı arayüzü uygular.

**Windows yöntemi: Windows.Data.Pdf (WinRT, Windows 10+ yerleşik) ile sayfa → bitmap, GDI ile varsayılan yazıcıya.** Reddedilenler:
`ShellExecute "printto"` (kayıtlı PDF işleyicisine bağlı: Edge sessiz yazdırmayı desteklemez, Adobe Reader JS çalıştırır ve pencere açık kalır,
işleyici yoksa hata — AC-350 "eylem çalıştırılmaz" garantisi verilemez); PDFium DLL'i (ek ~5 MB ikili, diske çıkarma = iz + DLL arama riski,
"istemci kendi dosyasını yazmaz" kuralı — gereksinimler §İstemci); UWP `PrintDocument` (CoreWindow/yazdırma arayüzü ister, sessiz basmaz);
Ghostscript/MuPDF (AGPL — yasak). Yeni Go bağımlılığı **yok**: WinRT çağrıları `golang.org/x/sys/windows` + vtable `syscall.SyscallN` ile
(`capture/wgc_windows.go`'daki WinRT kalıbı aynen: `RoGetActivationFactory` + vtable; `PdfDocument` statik fabrikası, `InMemoryRandomAccessStream` için `RoActivateInstance`; async işlemler `IAsyncInfo.Status` yoklamasıyla, 10 ms aralık).

### 5.2 PDF işleyici süreç (yalıtım, R45)

- Aynı ikili, yeni çalışma kipi `--pdf-isleyici` (`cmd/noktadestek/main.go` dalı; yalnız stdin/stdout borusu devralınır).
- Üst süreç başlatır: `CreateRestrictedToken(DISABLE_MAX_PRIVILEGE)` + **düşük bütünlük düzeyi** (`S-1-16-4096`); job: `KILL_ON_JOB_CLOSE`,
  `ACTIVE_PROCESS_LIMIT=1` (PDF "Launch" eylemi süreç açamaz), `PROCESS_MEMORY=512 MB`, `DIE_ON_UNHANDLED_EXCEPTION`, UI kısıtları (masaüstü,
  pano okuma/yazma, sistem parametreleri, global atom, diğer süreçlerin USER tanıtıcıları). Kalıp `internal/servis/launch_windows.go`
  `helperAttrs`/`helperJob` — kod `internal/proclimit` (yeni, ortak) paketine taşınır, iki çağıran da onu kullanır (kopya yok).
- İşleyicinin ilk işi `dllsafe` (AC-341 kalıbı). Pencere, ağ çağrısı, dosya açma kodu yoktur (`printing/boundary_test.go`: yasak sembol
  listesi — `ShellExecute`, `CreateProcess`, `CreateFile`, `net/*`, `os.Create/WriteFile`).
- Boru protokolü (uzunluk önekli ikili): üst → `{op:"inspect"|"render", dpi, pdf}`; işleyici → `{pages}` veya sayfa başına
  `{w,h,stride, BGR bayt}`; hata kodu `INVALID_PDF` (parola korumalı, bozuk) / `ERROR`. Zaman aşımı: inspect 15 sn, sayfa başına 15 sn, toplam 10 dk;
  aşımda job kapatılır → `ERROR`.
- PDF yalnız bellekte: `InMemoryRandomAccessStream` → `PdfDocument.LoadFromStreamAsync`. Windows.Data.Pdf bir **görüntüleyicidir**: JavaScript,
  form eylemi, `OpenAction`, `Launch`, `URI` çalıştırmaz (AC-350); job ve düşük bütünlük ikinci savunma hattıdır.
- **K0 prototipi** (Windows elle): düşük bütünlükte WinRT etkinleştirmesi ve render çalışıyor mu? Çalışmazsa düşük bütünlük kaldırılır, kısıtlı
  jeton + job kalır (K-P28a-4; güvenlik turuna bildirilir). GDI yazdırma **üst süreçte** olduğundan bu sonuç yazdırmayı etkilemez.

### 5.3 Yazdırma ve pano ayrıntıları

- **Yazıcı:** `GetDefaultPrinterW`; yoksa `NO_PRINTER` (diyalog açılmaz). `CreateDCW("WINSPOOL", ad)`, varsayılan DEVMODE üzerine `dmCopies=1`
  (`DM_COPIES`), sayfa yönü sayfa en/boy oranına göre `ResetDCW` (`DMORIENT_LANDSCAPE/PORTRAIT`), render DPI = `min(yazıcı DPI, 300)`, yazdırılabilir
  alana oranı koruyarak sığdırma, `StretchDIBits`. Spool belge adı **sabit** "NoktaDestek uzaktan yazdırma" (dosya adı yazdırma kuyruğuna da
  düşmez). Sonuç `EndDoc` başarısında `PRINTED`. Varsayılan yazıcı "Microsoft Print to PDF" ise Windows kayıt diyaloğu açar — müşterinin seçimi,
  kılavuzda yazılır.
- **Bellek:** alınan bayt sayacı `> size` veya `> 20 MiB` → iptal (`TOO_LARGE`), beyan edilen boyuta güvenilmez (G-06 m.5). İş bitince tampon
  sıfırlanır; diske hiçbir şey yazılmaz (AC-350 iz testi: `%TEMP%`, İndirilenler, `%LOCALAPPDATA%` boş; OS yazdırma kuyruğu istisnası kılavuzda).
- **Onay diyaloğu** (`ui/consent_windows.go` `consentDlg`, AC-116/G-03 kuralları aynen: Reddet varsayılan ve odakta, "Yazdır" 1,5 sn kilitli,
  Enter/Space tetiklemez, enjekte tıklama yok sayılır, imleç altında açılmaz): başlık "Uzaktan yazdırma", gövde "<teknisyen> bir belgeyi
  yazıcınıza göndermek istiyor" + "Dosya: <ad>" + "Sayfa: <n>" + "Yazıcı: <ad>" + "Kalan süre: <s> sn"; düğmeler "Yazdır" / "Reddet". 60 sn → TIMEOUT.
  Aynı anda tek diyalog (pending tek).
- **Pano anahtarı:** oturum penceresinde (`ui/session_windows.go`) "Pano paylaşımına izin ver" onay kutusu; yalnız `clipboard` yeteneği varken
  görünür, yalnız kontrol kapısı açıkken etkin, her oturumda kapalı başlar. **Yalnız gerçek yerel girdiyle** değişir (`thread.userInput`, S7-5:
  kontrol sahibi teknisyen `SendInput` ile kutuyu işaretleyemez; ayrıca kendi pencerelerimiz girdi kapsamı dışında — `input/scope.go`). Kapı
  kapanınca (kısayol, "Kontrolü kapat", revoke, kopma, oturum sonu) yerel olarak hemen kapanır; bu kapanışlarda WS `clip.consent` **gönderilmez**
  (sunucu kontrolü `VIEW`'a aldığında kendisi kapatır — §3.3 K6 kalıbı). Kullanıcının kendi tıklamasıyla aç/kapa → `clip.consent{on}`.
- **Win32 pano:** `OpenClipboard(sahip pencere)` UI iş parçacığında, meşgulse 10 × 50 ms yeniden dene → `ERROR`. Okuma yalnız `CF_UNICODETEXT`;
  pano `ExcludeClipboardContentFromMonitorProcessing` veya `Clipboard Viewer Ignore` biçimini taşıyorsa (parola yöneticilerinin "gizli" işareti)
  içerik **okunmaz**, `SENSITIVE` (K-P28a-6). Yazmada `CF_UNICODETEXT` + `CanIncludeInClipboardHistory=0` + `CanUploadToCloudClipboard=0`
  (Win+V geçmişine ve bulut panosuna düşmez — iz azaltma). UTF-16 ↔ UTF-8 dönüşümü kayıpsız; satır sonu dönüştürülmez (AC-345 "birebir").
  Teknisyenin koyduğu metin oturum sonunda silinmez (müşterinin yapıştırması amaçtır; kılavuzda yazılır).
- **Bildirim:** 3 sn, AC-103 göstergesinin (`ui/overlay_windows.go`) altında metin satırı (odak çalmaz): "Teknisyen panonuza metin koydu" /
  "Teknisyen panonuzu okudu" / "Belge yazıcıya gönderildi".
- **Metinler:** `internal/flow/messages_p28.go` (tek tablo); web misafir sayfası bu özellikleri göstermediği için `tr.json` eşi yalnız konsol tarafındadır.

## 6. Web — teknisyen konsolu (`apps/web`; DESIGN.md token'ları, `lucide-react`, iki tema, 390 px, axe 0)

- Yeni `components/collab/clip-print-panel.tsx`, `collab-side.tsx`'e bir bölüm olarak eklenir ("Pano ve yazdırma"). Düğmeler: `ClipboardPaste`
  "Panoyu gönder", `ClipboardCopy` "Müşteri panosunu al", `Printer` "Uzaktan yazdır". Animasyonsuz (sık işlem).
- `lib/clip/feature-state.ts` saf işlev `featureState(input) → {enabled, reason}`; neden önceliği (ilk tutan): yetki yok (düğme **gizli**, AC-72
  kalıbı) → müşteri bağlı değil → tarayıcı modu (yazdırma gizli, pano "Pano yalnız müşteri uygulamasında ve kontrol izniyle kullanılır") →
  gözetimsiz oturum ("Gözetimsiz oturumda kullanılamaz — müşteri onayı gerekir") → özellik bildirilmemiş (AC-352: "Müşterinin uygulaması bu
  özelliği desteklemiyor — güncel sürümü indirmesini isteyin") → (pano) kontrol izni yok ("Önce uzaktan kontrol izni alın") → (pano) müşteri
  izni kapalı ("Müşteri pano paylaşımına izin vermedi") → iş sürüyor. Neden metni düğmenin altında görünür (AC-343); `aria-describedby`.
- Durumlar: pano işi "Gönderiliyor…" → sonuç toast (Sonner); yazdırma satırı: ilerleme (%) → "Müşteri onayı bekleniyor (kalan sn)" + "Vazgeç"
  (`print.cancel`) → sonuç metni (`PRINTED` "Belge müşterinin yazıcısına gönderildi (<n> sayfa)", `NO_PRINTER` "Müşterinin varsayılan yazıcısı yok",
  `REJECTED` "Müşteri yazdırmayı reddetti", `TIMEOUT` "Müşteri yanıt vermedi", `INVALID_PDF` "Belge açılamadı (bozuk veya parola korumalı)",
  `BUSY` "Başka bir aktarım sürüyor", `ERROR` "Yazdırma başarısız oldu"). Ret/yanıtsızlık sonrası 30 sn yerel sayaçla düğme pasif (K7 kalıbı).
- 5 durum: düğme bölümü yükleniyor (oturum `hello` bekleniyor → iskelet), boş (müşteri yok → neden metni), hata (sonuç metni), kısmi (yalnız
  pano veya yalnız yazdırma uygun), başarılı.
- Tarayıcı izinleri: `readText` reddi → "Tarayıcı pano okumasına izin vermedi — adres çubuğundaki site izinlerinden açın". Firefox'ta okuma
  "Yapıştır" menüsü gösterir (kılavuz notu). Pano içeriği hiçbir zaman DOM'a basılmaz, `console.*`'a yazılmaz (lint kuralı + test).
- Misafir tarayıcı sayfası (`components/guest/*`) **değişmez**.

## 7. Güvenlik tasarımı

### 7.1 Tehdit modeli girdisi (STRIDE; güvenlik ajanı S-P28a-n numaralarını bu listeden verir)

| #   | Tehdit                                                                                            | Önlem                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Teknisyen müşterinin panosundaki parolayı/kişisel veriyi okur (R47)                               | Elle düğme, yetki + kontrol izni + ayrı müşteri anahtarı (varsayılan kapalı, kontrolle kapanır), her okumada bildirim, `SENSITIVE` biçim saygısı, audit |
| T2  | Teknisyen anahtarı/onayı kendi `SendInput`'u ile verir (kontrol açıkken)                          | `thread.userInput` enjekte süzgeci (S7-5) + kendi pencereler girdi kapsamı dışı; test: enjekte tıklama → durum değişmez                                 |
| T3  | Değiştirilmiş konsol sunucuyu atlayıp DC'den doğrudan pano/PDF gönderir                           | Misafir yalnız sunucunun WS ile yetkilediği bekleyen cid/pid içeriğini uygular (§4.4); test: WS'siz `clip.data` → uygulanmaz                            |
| T4  | Kötü niyetli PDF render motorunu sömürür (R45); onaydan **önce** ayrıştırılır (sayfa sayısı için) | Düşük bütünlük + job (süreç açamaz, 512 MB, zaman aşımı) + ayrı süreç (çökme oturumu düşürmez); Windows.Data.Pdf JS/eylem yok; risk kabulü K-P28a-5     |
| T5  | Yazdırma/pano spam'i (müşteriyi rahatsız etme, kâğıt israfı)                                      | Oda başına tek bekleyen iş; ret/yanıtsızlık sonrası 30 sn; oturum başına 20 yazdırma; pano 30/dk; her yazdırma ayrı onay                                |
| T6  | İçerik sızıntısı: log, audit, metrik, Sentry, yazdırma kuyruğu                                    | İçerik WS'ye hiç girmez; dosya adı WS/audit'e girmez; spool adı sabit; Go ve web loglarında içerik yok (log tarama testi, AC-347)                       |
| T7  | Eski istemci yeni `caps` değeriyle kopar (kullanılabilirlik)                                      | `capsFor(perms, features)`; eski istemci fikstürüyle geri uyum testi                                                                                    |
| T8  | Yazdırılan PDF'in diskte kalması                                                                  | Yalnız bellek, sıfırlama; iz testi                                                                                                                      |
| T9  | Teknisyenin koyduğu metin Win+V geçmişinde / bulutta kalır                                        | `CanIncludeInClipboardHistory=0`, `CanUploadToCloudClipboard=0`                                                                                         |
| T10 | Oturum kapandıktan sonra gelen pano/PDF                                                           | Oturum sonu/kopma: anahtar kapanır, bekleyen kümeler temizlenir, işleyici job kapatılır                                                                 |

### 7.2 Hassas veri

Pano metni ve PDF: **gizli** sınıf, aktarım DTLS (DC), saklama yok. Dosya adı: kişisel veri olabilir → yalnız DC ve müşteri diyaloğunda.
Audit alanları yalnız sayısal/numaralandırılmış. Başlık/CSP değişmez: `Permissions-Policy` (`apps/server/src/app-hooks.ts`) pano
yönergesi içermez, tarayıcı varsayılanı zaten `self`'tir; iframe'e izin verilmez (mevcut `frame-ancestors`). P28d'de `microphone=()` değişecektir (not).

## 8. Audit, metrik, operasyon

### 8.1 Audit (`packages/contracts/src/audit.ts` → yeni `CLIP_PRINT_AUDIT`; Türkçe etiketler mevcut audit etiket tablosuna)

| Action               | Ne zaman                                                                                                            | Actor                    | `new_value` (JSON)                                                                                     | result                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `clipboard.consent`  | Müşteri anahtarı açtı/kapattı; sunucu kapattı (kontrol kapandı, yetki daraldı, kopma, oturum sonu — yalnız açıkken) | müşteri (guest) / sistem | `{on, by:"customer"\|"system", reason?:"control_closed"\|"permission"\|"disconnect"\|"session_ended"}` | success                           |
| `clipboard.transfer` | `clip.report` geldi veya sunucu TIMEOUT/DISCONNECTED üretti                                                         | isteyen teknisyen        | `{direction:"TO_CUSTOMER"\|"TO_TECH", bytes, result, reportedBy:"customer"\|"server"}`                 | `OK` → success, diğer → fail      |
| `print.job`          | `print.report` geldi veya sunucu ABANDONED/DISCONNECTED üretti                                                      | isteyen teknisyen        | `{decision, pages?, sizeBytes, result, reportedBy}` — **dosya adı ve hash yok** (AC-351)               | `PRINTED` → success, diğer → fail |

Sunucu kapısında reddedilen istekler (FORBIDDEN/CONFLICT/RATE_LIMITED) audit'e yazılmaz; metrik + log (`ws_clip_print_denied`, neden) — konsol
düğmeyi önceden pasifler, ret yalnız değiştirilmiş istemcide olur (K-P28a-8). Audit yazımı başarısız olursa iş geri alınmaz (kapatma yönü değil
ama içerik zaten teslim edilmiş olur); log + ref (P5 `file.meta` kalıbı). Oturum geçmişi zaman çizelgesi bu olayları mevcut audit okumasıyla gösterir.

### 8.2 Metrikler (`ops/metrics.ts`)

`rs_clipboard_transfer_total{direction,result}`, `rs_print_job_total{result}`, `rs_clip_print_denied_total{kind,reason}`. Alarm yok (düşük hacim);
runbook'ta "ERROR oranı > %20 / gün → istemci logu iste" notu.

### 8.3 Config / env

**Yeni env değişkeni yok.** Sabitler contracts'ta: `CLIP_MAX_BYTES = 65536`, `CLIP_CHUNK_BYTES = 8192`, `CLIP_PER_MIN = 30`,
`CLIP_PENDING_TIMEOUT_MS = 10000`, `PRINT_MAX_BYTES = 20 * 1024 * 1024`, `PRINT_CONSENT_TIMEOUT_MS = 60000`, `PRINT_PENDING_TIMEOUT_MS = 600000`,
`PRINT_PER_SESSION = 20`, `PRINT_DENY_COOLDOWN_MS = 30000`. Feature flag yok: yetki toggle'ı + istemci sürümü yeterli.

### 8.4 Migration, rollback, yedek

Migration yok. Geri alma: sunucu ve web önceki imaja döner; yeni istemci eski sunucuya bağlanırsa `rs.cap.*` belirteçleri yok sayılır (sunucu
yalnız `rs.v1` seçer), özellik görünmez — ileri/geri uyumlu. İstemci sürümü **0.13.0** (P27 sonrası ilk artım; staging'e çıkar, prod P28 sonu, V53).
Yedek etkisi yok.

## 9. Test stratejisi

| Seviye                                 | Kapsam                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Komut                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| contracts birim + fikstür              | `fixtures/clip-print.json` (WS + DC örnekleri, geçerli/geçersiz); aynı dosya Go testinde aynen; `capsFor` tablo testi; AC-72 toggle testi yeni anahtarları görür                                                                                                                                                                                                                                                                                                                               | `pnpm --filter @remote/contracts test`      |
| Sunucu entegrasyon (gerçek WS)         | Kapı matrisi (yetki yok → FORBIDDEN, BROWSER → FORBIDDEN, özellik yok → FORBIDDEN, VIEW → FORBIDDEN, izin kapalı → FORBIDDEN, bekleyen → CONFLICT, 31. istek → RATE_LIMITED, 21. yazdırma → RATE_LIMITED, ret sonrası 30 sn); yeteneksiz sokette `clip.*` → 1008; eski istemci `hello.caps` iki değer; kontrol VIEW'a dönünce `clip.consent{false}` + audit; TIMEOUT/ABANDONED/DISCONNECTED (sahte saat); yetki daralmasında `caps.update` + bekleyenin iptali; audit alanları (dosya adı yok) | `pnpm --filter @remote/server test`         |
| Log/içerik taraması (AC-347, 351)      | e2e boyunca işaretli metin (`P28A-ISARET-…`) ve dosya adı (`gizli-ad-…pdf`) kullanılır; sunucu logu, `audit_logs` tablosu, `/metrics` çıktısı ve tarayıcı konsolunda **0** eşleşme                                                                                                                                                                                                                                                                                                             | e2e + `scripts/log-scan` adımı (backend K2) |
| Web birim                              | `featureState` neden önceliği (tüm dallar), PDF doğrulama (`%PDF-`, 20 MiB sınırı ±1 bayt), UTF-8 bayt sayımı (64 KB sınırı), parçalama/birleştirme (ç ğ ı ö ş ü İ, emoji, `\r\n`/`\n` birebir), Clipboard API ret dalları                                                                                                                                                                                                                                                                     | `pnpm --filter @remote/web test`            |
| Web e2e (Playwright, sahte misafir)    | Düğme görünürlüğü/pasiflik + neden metinleri (AC-343, 348, 352); tarayıcı modunda "Uzaktan yazdır" yok; `page.clock` ile 60 sn → "Müşteri yanıt vermedi" (AC-349); iki tema axe 0, 390 px                                                                                                                                                                                                                                                                                                      | `pnpm --filter @remote/web e2e`             |
| Go birim (Linux CI)                    | `internal/dc` + `signal` fikstürleri; `flow/clipprint`: yetkisiz cid → uygulanmaz; anahtar kapandıktan sonra gelen `clip.data` 100 ms içinde uygulanmaz (sahte saat, uygulama sayacı 0 — AC-344); bellek sınırı (`> size`, `> 20 MiB`); SHA uyuşmazlığı; `%PDF-` denetimi; sahte işleyiciyle TIMEOUT/ERROR; `printing/boundary_test.go` yasak semboller                                                                                                                                        | `go test ./...`                             |
| Go Windows (CI windows çalıştırıcısı)  | Win32 pano gidiş-dönüş (fikstür metinleri), `SENSITIVE` biçim, geçmiş-dışı biçimler yazıldı; Windows.Data.Pdf sayfa sayısı fikstürleri (1, 3 sayfa, parola korumalı → INVALID_PDF, bozuk, `OpenAction` JS + `Launch` eylemli → sayfa sayısı döner, job süreç sayısı 1 kalır); varsayılan yazıcı yok → `NO_PRINTER`; enjekte tıklama anahtarı değiştirmez                                                                                                                                       | `go test ./...` (windows)                   |
| İz testi (AC-350, AC-289)              | `trace-check.ps1`: yazdırma + pano sonrası `%TEMP%`, İndirilenler, `%LOCALAPPDATA%`, kayıt defterinde istemciye ait yeni iz yok; iki tekrarlanabilir build hash'i eşit                                                                                                                                                                                                                                                                                                                         | CI `agent-win.yml`                          |
| Windows elle (D-P28a listesi, staging) | Not Defteri ile iki yön Türkçe metin; ≤ 1 sn ölçümü (AC-346, RTT < 100 ms ağ); gerçek/sanal yazıcıya 3 sayfalık PDF ≤ 5 sn sonuç (AC-350); Reddet; 60 sn; yazıcısız makine; kontrol açıkken teknisyenin "Yazdır"a tıklaması yok sayılır; 0.12.x istemciyle AC-352 metni; gözetimsiz oturumda pasif                                                                                                                                                                                             | `docs/test-raporu.md`                       |

## 10. Görev paketleri (P28a-K0..K10)

Sıra: **K9a güvenlik tasarım turu (kod öncesi)** ‖ K0 ‖ K1 → (K2 ‖ K3 ‖ K4 ‖ K5 ‖ K6) → K7 → (K8 qa ‖ güvenlik) → düzeltme → K9 test-operatoru → K10 teknik-yazar.
dba görevi **yok** (migration yok). İki görev aynı dosyaya dokunmaz; "dokunan böler" (mimari-temizlik §9) geçerlidir.

| Paket | Ajan                  | Bağımlı      | Paralel              | İş ve dosyalar                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----- | --------------------- | ------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K0    | backend-dev (Go)      | —            | K1, K9a ile          | **Prototip (Windows elle, 1 gün sınırı):** düşük bütünlükte Windows.Data.Pdf `LoadFromStreamAsync` + `RenderToStreamAsync`; GDI ile "Microsoft Print to PDF" ve bir fiziksel/ağ yazıcısına basma; sonuç `docs/implementation.md` "P28a K0" (K-P28a-4 kesinleşir). Kod `internal/printing` taslağı olarak kalır                                                                                                              |
| K1    | backend-dev           | —            | K0, K9a ile          | contracts: `permissions.ts` (+2 anahtar + açıklama), `ws.ts` (yeni tipler → ws.ts 367 satır olduğundan **yeni `ws-clip-print.ts`**'e; `ws.ts`'e yalnız birlik bağlantısı + `CAPS` + `guestFeatures`/`clipConsent` alanları), `dc.ts` (+5 tip; 265 → aşarsa `dc-clip-print.ts`), `audit.ts` (`CLIP_PRINT_AUDIT`), `labels.ts`, sabitler; `fixtures/clip-print.json`; contracts testleri                                      |
| K2    | backend-dev           | K1           | K3–K6 ile            | Sunucu: yeni `signaling/clip-print.ts` (+ `clip-print.test.ts`); ekler `handlers.ts` (dağıtım), `ws-auth.ts` (`rs.cap.*` okuma), `types.ts` (Room alanları), `rooms.ts` (`capsFor`, misafir ayrılınca temizlik; ≤ 30 satır, aşarsa `rooms-features.ts`), `control.ts`/`control-revoke.ts` (VIEW kancası, tek satır çağrı), `ops/metrics.ts`; entegrasyon testleri `test/integration/clip-print-*.test.ts`; log tarama adımı |
| K3    | backend-dev (Go)      | K1 (fikstür) | K2, K4–K6 ile        | Go protokol + akış: `internal/signal` (alt protokol `features` parametresi, yeni tipler, `caps` listesine iki değer), `internal/dc` (yeni tipler; `ctl.go` 190 + ek > 300 olursa `ctl_clip_print.go`), yeni `internal/flow/clipprint.go` (+ test), `flow/messages_p28.go`; helper çağrısı `features=nil`                                                                                                                    |
| K4    | backend-dev (Go)      | K0           | K2, K3, K5, K6 ile   | Yeni `internal/clip/{clip.go, clip_windows.go, clip_other.go}`, `internal/printing/{printing.go, worker.go, worker_windows.go, gdi_windows.go, winrt_pdf_windows.go, boundary_test.go}`, `internal/proclimit` (servis `launch_windows.go`'dan job/jeton kodunun taşınması — servis davranışı değişmez, mevcut testleri yeşil), `cmd/noktadestek/main.go` `--pdf-isleyici` dalı                                              |
| K5    | backend-dev (Go)      | K3 (arayüz)  | K4, K6 ile           | UI: `ui/session_windows.go` (anahtar; 158 satır), yeni `ui/print_windows.go` (onay diyaloğu `consentDlg` ile), `ui/overlay_windows.go` (3 sn bildirim satırı; 221 + ek ≤ 30), koyu/açık tema kontrastı (AC-247 testi)                                                                                                                                                                                                       |
| K6    | frontend-dev          | K1           | K2–K5 ile (sahte WS) | Yeni `components/collab/clip-print-panel.tsx`, `lib/clip/{feature-state.ts, clipboard.ts, chunks.ts}`, `lib/print/{pdf-check.ts, print-send.ts}` (`lib/dc/file-send.ts` çerçeveleme/akış kontrolü yeniden kullanılır; gerekirse ondan ortak `chunk-sender.ts` ayrılır), ek `components/console/collab-side.tsx`, `lib/dc/use-collab.ts` (yeni DC tipleri), `messages/tr.json`; birim + e2e                                  |
| K7    | devops                | K3, K4       | —                    | `.github/workflows/agent-win.yml`: Windows test adımına `internal/clip`, `internal/printing` (Windows.Data.Pdf fikstürleri, yazıcısız çalıştırıcı); `test/trace-check.ps1` yazdırma/pano senaryosu; istemci 0.13.0 staging yayını; runbook §28a (metrik okuma, "yazdırma başarısız" adımları)                                                                                                                               |
| K8    | qa-denetci ‖ guvenlik | K2–K7        | birbiriyle           | Paket sonu denetimi (AC-343..352, 404, 285..290); güvenlik kod turu (T1–T10)                                                                                                                                                                                                                                                                                                                                                |
| K9a   | guvenlik              | bu belge     | K0/K1 ile (kod yok)  | Tasarım tehdit modeli turu (§7.1) → `docs/guvenlik-raporu.md` "P28a tasarım turu"; Kritik/Yüksek bulgular bu belgeye r2 olarak işlenmeden K2–K6 **birleştirilmez** (AC-290)                                                                                                                                                                                                                                                 |
| K9    | test-operatoru        | K8 GEÇTİ     | —                    | Staging: konsol akışları + Windows elle D-P28a listesi (§9); `docs/test-raporu.md`                                                                                                                                                                                                                                                                                                                                          |
| K10   | teknik-yazar          | K9           | —                    | KULLANIM_KILAVUZU (Teknisyen: pano/yazdırma; Müşteri: anahtar, onay, yazdırma kuyruğu istisnası, "Microsoft Print to PDF" notu, Firefox pano notu; Admin: iki yeni toggle), DATASHEET (yalnız Windows istemci), CHANGELOG, `docs/api.md` (WS/DC tipleri), PDF'ler (AC-288)                                                                                                                                                  |

**Paket kabulü:** AC-343..352 + AC-404 + AC-285..290 yeşil; Windows elle tur kanıtı; qa GEÇTİ, güvenlik Kritik/Yüksek 0; yeni > 500 satırlık üretim dosyası yok.

## 11. Kabul kriterleri eşlemesi

| AC     | Bileşen / uç                                                                                                  | Paket           | Test                                       |
| ------ | ------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------ |
| AC-343 | `featureState` + panel; sunucu kapısı §4.3 (yetki/kontrol/izin → FORBIDDEN); misafir alıcı kuralı §4.4        | K1, K2, K3, K6  | entegrasyon kapı matrisi, web birim, e2e   |
| AC-344 | Go anahtar (varsayılan kapalı, kapıyla kapanır), sunucu `onControlClosed`, uygulama öncesi atomik denetim     | K2, K3, K5      | Go birim (100 ms), entegrasyon             |
| AC-345 | `CLIP_MAX_BYTES`, UTF-8 parçalama, `EMPTY`/`TOO_LARGE`, dönüşümsüz Win32 pano                                 | K1, K3, K4, K6  | fikstür (web + Go + Windows)               |
| AC-346 | §4.5 akışlar, `clip.ready` el sıkışması, 3 sn bildirim                                                        | K3, K5, K6      | Windows elle ölçüm                         |
| AC-347 | `clipboard.transfer`, `clipboard.consent` audit; içerik WS'de yok                                             | K1, K2          | entegrasyon + log tarama                   |
| AC-348 | `featureState` (yetki + AGENT + `print` özelliği), `pdf-check.ts`, sunucu kapısı                              | K2, K6          | web birim + e2e + entegrasyon              |
| AC-349 | `ui/print_windows.go` (`consentDlg`, 60 sn), `print.report{TIMEOUT}` → "Müşteri yanıt vermedi"                | K3, K5, K6      | Go birim, e2e (`page.clock`), Windows elle |
| AC-350 | `internal/printing` (ADR-0031), bellek tamponu, işleyici yalıtımı, `print.status`                             | K0, K4, K7      | Windows CI fikstürleri, iz testi, elle     |
| AC-351 | `print.job` audit (ad/içerik yok)                                                                             | K1, K2          | entegrasyon + log tarama                   |
| AC-352 | `rs.cap.*` bildirimi, `guestFeatures`, `capsFor`, neden metni                                                 | K1, K2, K3, K6  | entegrasyon (eski istemci fikstürü), e2e   |
| AC-404 | `permissions.ts` + açıklamalar; panel 5 durum/axe/390 px; metinler `tr.json` + `messages_p28.go`; AC-288..290 | K1, K6, K7, K10 | AC-72 testi, axe, iz testi, doküman        |
| AC-282 | Çerçeve: AC-343..347 ile karşılanır                                                                           | —               | —                                          |
| AC-283 | Çerçeve: AC-348..351 ile karşılanır                                                                           | —               | —                                          |

## 12. Kararlar (K-P28a-n; mimar kararı — kullanıcı "soru sorma" dedi, en basit güvenli seçenek)

| #         | Konu                                     | Karar                                                                                                                                                    | Gerekçe                                                                                     |
| --------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| K-P28a-1  | Pano içeriği hangi yoldan                | DataChannel (uçtan uca); WS yalnız yetki/durum                                                                                                           | Aydınlatma metni "kontrol/dosya uçtan uca" der; WS 64 KB sınırı; sunucu parola görmez (R47) |
| K-P28a-2  | "Sunucuda 403" nasıl gerçek olur         | Sunucunun WS ile ilettiği tek kullanımlık cid/pid olmadan misafir DC içeriğini uygulamaz                                                                 | İçerik sunucudan geçmeden sunucu kapısı                                                     |
| K-P28a-3  | Yazdırma hangi istemcide                 | Yalnız Windows yerel istemci (macOS/Linux P28f/g'de CUPS)                                                                                                | Tarayıcı sessiz/varsayılan yazıcıya basamaz; AC-348 zaten tarayıcıda gizler                 |
| K-P28a-4  | PDF render yöntemi                       | Windows.Data.Pdf + GDI, ayrı işleyici süreç (düşük bütünlük + job); K0 prototipi düşük bütünlüğü doğrular, olmazsa kısıtlı jeton + job                   | ADR-0031                                                                                    |
| K-P28a-5  | Sayfa sayısı için onay öncesi ayrıştırma | Kabul (risk kabulü): teknisyen kimlikli + yetkili, ayrıştırma yalıtılmış süreçte                                                                         | AC-349 diyalogda sayfa sayısı ister                                                         |
| K-P28a-6  | Parola yöneticisi "gizli" pano           | `SENSITIVE`: içerik okunmaz, teknisyende "Müşteri panosundaki içerik gizli olarak işaretli, gönderilmedi"                                                | R47 azaltımı; AC-345 metinlerine ek bir metin — **proje-yöneticisi onayı gerekir** (§13)    |
| K-P28a-7  | Yazdırma sınırları                       | Tek bekleyen iş, ret/yanıtsızlık sonrası 30 sn, oturum başına 20; sayfa sınırı yok (müşteri sayfa sayısını görüp onaylar); "Vazgeç" (`print.cancel`) var | G-03 kalıbı; yanlış belgenin onaylanmasını önler (K2 simetriği)                             |
| K-P28a-8  | Sunucuda reddedilen istek audit'i        | Audit yok; metrik + log                                                                                                                                  | Konsol önceden pasifler; ret yalnız değiştirilmiş istemcide; tablo şişirme yok              |
| K-P28a-9  | Veri modeli                              | Tablo/migration yok; audit yeterli                                                                                                                       | AC'ler yalnız audit ister                                                                   |
| K-P28a-10 | Tenant ayarı                             | Yok; yetki toggle'ı (Admin açık, User kapalı) yeterli                                                                                                    | Gereksinim §8'de P28a ayarı yok; sadelik                                                    |
| K-P28a-11 | Yetenek bildirimi                        | `rs.cap.clip1`, `rs.cap.print1` alt protokol belirteçleri; sürüme bakılmaz                                                                               | P18 kalıbı; gözetimsiz yardımcı bildirmez (V45)                                             |
| K-P28a-12 | Pano metninin oturum sonrası durumu      | Teknisyenin koyduğu metin silinmez; geçmiş/bulut biçimleri kapalı                                                                                        | Amaç müşterinin yapıştırması; iz azaltma                                                    |
| K-P28a-13 | `file_transfer.print` bağımsızlığı       | `file_transfer.use` gerekmez                                                                                                                             | AC-348 yalnız print yetkisini sayar                                                         |
| K-P28a-14 | Satır sonu / normalizasyon               | Dönüşüm yok (NFC, CRLF yok); yalnız geçerli UTF-8 + U+0000 yok (aksi `INVALID`)                                                                          | AC-345 "birebir"; `CF_UNICODETEXT` NUL ile biter                                            |

## 13. Riskler ve açık kararlar

| #        | Risk / açık nokta                                                                                                                | Önlem / sahibi                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| R-P28a-1 | Düşük bütünlükte WinRT render çalışmayabilir                                                                                     | K0 prototipi; geri dönüş kısıtlı jeton + job (backend-dev Go)                              |
| R-P28a-2 | Bazı yazıcı sürücülerinde GDI bitmap yazdırma yavaş/büyük spool (300 DPI, çok sayfa)                                             | DPI ≤ 300, sayfa başına akış; AC-350 ≤ 5 sn sonucu spool bitişinden ölçülür (Windows elle) |
| R-P28a-3 | Firefox/Safari'de `readText` her seferinde yapıştırma menüsü; `writeText` kullanıcı etkinliği süresi (~5 sn) aşılırsa reddedilir | Al işlemi ≤ 1 sn; ret metni + kılavuz; Chrome/Edge önerilir (frontend-dev)                 |
| R-P28a-4 | WinRT vtable çağrıları saf Go'da hataya açık                                                                                     | `capture/wgc_windows.go` kalıbı; Windows CI fikstür testleri                               |
| R-P28a-5 | Onay öncesi PDF ayrıştırma (T4)                                                                                                  | Yalıtım + güvenlik tasarım turu (K9a)                                                      |
| Açık-1   | K-P28a-6 `SENSITIVE` metni AC listesinde yok                                                                                     | proje-yöneticisi onayı (AC-345'e ek cümle); onay gelmezse yine uygulanır, metin kılavuzda  |
| Açık-2   | DATASHEET "uzaktan yazdırma yalnız Windows uygulamasında" ifadesi                                                                | teknik-yazar K10                                                                           |
