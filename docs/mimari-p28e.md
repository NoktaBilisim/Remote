# Mimari — P28e: Oturum kaydı (katılımlı rıza + gözetimsiz politika eki)

Tarih: 2026-11-16 · Durum: r1 (mimar; güvenlik tasarım turu K0 bekler) · Gereksinim: `docs/gereksinimler-p28.md` P28e (AC-380..388, V48, V49,
AC-375 "ses kaydedilmez"), `docs/gereksinimler-p28u.md` P28e eki (AC-447..450, V-PU8, V-PU12) · Bağlam: `docs/mimari-p28b.md` (şifreli depolama,
kota, saklama/silme, belirteç), `docs/mimari-p28u.md` §13 (kancalar), `docs/mimari-p28.md` §0 · Yeni ADR: **ADR-0034**
(`docs/adr/0034-oturum-kaydi-teknisyen-konsolunda.md`). Kontrol listesi: `docs/tasarim-kontrol.md` "P28e".
Kullanıcı "soru sorma, işleri bitir" dedi. Belirsizlikler en sade ve güvenli seçenekle **K-P28e-n** kararı ya da **Varsayım (V-PE-n)** olarak yazıldı.

**Bağlayıcı ilke — sadelik:** tek ekran, tek yol. Kaydı her oturumda aynı bileşen alır (teknisyen konsolu). Kaynak tarafa (Go istemci,
tarayıcı misafir, gözetimsiz yardımcı) yalnız rıza kutusu, gösterge ve durdurma eklenir. Açılış yoluna göre değişen kayıt davranışı yoktur.
Tek fark rızanın **dayanağıdır**: katılımlı oturumda müşteri rızası, gözetimsiz oturumda tenant politikası.

---

## 1. Özet ve kısıtlar

| Kapsamda                                                                                                                  | Kapsam dışı / Sonra (neden)                                                                 |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Tenant ayarı "Oturum kaydı" + saklama 1–90 gün + aydınlatma kutusu (AC-380); "Gözetimsiz bağlantıları da kaydet" (AC-447) | Ses kaydı (AC-375: hiçbir yerde yok; yapısal olarak engellenir)                             |
| Müşteri onay ekranında ayrı, işaretsiz rıza kutusu, rızanın `session_consents`'e yazılması (AC-381)                       | Kaydı indirme, dışa aktarma, paylaşım bağlantısı (V49)                                      |
| İlk kareyle otomatik başlama, gizlenemez gösterge (müşteri + tüm teknisyenler), "Kaydı durdur" ≤ 2 sn (AC-382)            | Çok teknisyen (P28c): yalnız `recorderOf(room)` genişleme noktası; kod yazılmaz (K-P28e-11) |
| Konsolda MediaRecorder (WebM/VP8), 5 sn parça, sunucuda AES-256-GCM (P28b `box.ts`) (AC-383, ADR-0034)                    | Sürekli (Observe tarzı) cihaz kaydı, olay zaman çizelgesi (S-P28u-3)                        |
| Kota: başta doluysa kutu yok, ortada dolarsa kayıt durur (AC-384, AC-450)                                                 | Kayıt yedeği (K-P28b-11 ile aynı: dosyalar yedeğe girmez, kullanıcı kararı S-P28-3)         |
| Geçmiş detayında "Kaydı izle": MSE oynatıcı, Bearer belirteç, indirme ucu yok, `recording.view` (AC-385)                  | macOS/Linux istemcisi (P28f/g aynı `rs.cap.rec1` protokolünü uygular)                       |
| Saklama süresi, anonimleştirme, kalıcı silme, elle silme (AC-386)                                                         | Kayıt üzerinde arama, küçük resim, hızlandırılmış oynatma dışındaki özellikler              |
| Gözetimsizde politika kaydı, diyalog satırı, gösterge eki (AC-447..450); anahtar kapalıyken AC-387                        | Oturum ortasında rızayı yeniden verme (AC-382: geri alınan rıza o oturumda dönmez)          |
| Audit `recording.start/stop/view/delete` (+ `recording.expired`, ayar) (AC-388)                                           | Safari'de kayıt alma (K-P28e-9: desteklenmeyen tarayıcıda kayıt başlamaz, neden görünür)    |

Kısıtlar (değişmez): görüntünün uçtan uca yolu değişmez (AC-383). Sunucu medyayı çözmez, yalnız konsolun yüklediği kaydı saklar. Gösterge
çizilemeyen yerde kayıt yapılmaz (K-P28e-7). Yeni bağımlılık yoktur (MediaRecorder, MSE tarayıcıya gömülü; WebM başlık denetimi kendi kodumuz).
Yeni env yoktur. Sabitler contracts'ta tutulur.

## 2. Bileşenler ve akış

```mermaid
flowchart LR
  subgraph Kaynak[Görüntü kaynağı]
    GO[Go istemci 0.16.0\nrıza kutusu, gösterge, Kaydı durdur\nrs.cap.rec1]
    BR[Tarayıcı misafir\nguest-session + join/web-request\nrs.cap.rec1]
    DV[Gözetimsiz servis+yardımcı 0.16.0\nrs.cap.record1, diyalog satırı, gösterge eki]
  end
  subgraph Konsol[apps/web konsol]
    RC[lib/rec/recorder.ts\nMediaRecorder VP8, 5 sn parça, 60 sn bölüm]
    UP[lib/rec/upload.ts\nPUT Bearer, yeniden deneme]
    IND[console/rec-indicator.tsx]
    PL[history/[id]/recording-player.tsx\nMSE + fetch Bearer]
  end
  subgraph Sunucu[apps/server]
    SIG[signaling/rec.ts\nrec.consent/revoke/state/error, gözcü]
    RS[rec/service.ts\ndurum, kota, belirteç]
    RR[rec/routes.ts\nPUT parça, GET parça, meta, view, delete, ayar]
    WM[rec/webm.ts\nEBML başlık denetimi]
    BX[fsrv/box.ts + store.ts\nyeniden kullanım]
    US[fsrv/usage.ts\nstorageUsage + kayıt toplamı]
    JB[jobs/retention-rec.ts\n03:30, anonimleştirme, mutabakat]
    DB[(session_recordings\nsession_recording_parts)]
  end
  GO & BR -- WebRTC video uçtan uca --> Konsol
  DV -- WebRTC video --> Konsol
  GO & BR -- /ws/guest rec.* --> SIG
  DV -- /ws/device connect.recording, rec.state --> SIG
  Konsol -- /ws/tech rec.state/rec.error --> SIG
  UP -- HTTPS PUT parça --> RR --> RS --> WM
  RS --> BX
  RS --> US
  RS --> DB
  PL -- GET meta/view + parça --> RR
  JB --> RS
```

| Bileşen                                                                                                     | Sorumluluk                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `signaling/rec.ts` (yeni)                                                                                   | Oda kayıt durumu (`room.rec`), `rec.consent`/`rec.revoke` kapısı, `rec.state` yayını (tüm teknisyen soketleri + `rec1` misafir + `record1` cihaz), parça gözcüsü, `recorderOf` |
| `rec/service.ts` (yeni)                                                                                     | Kayıt satırı yaşam döngüsü (§3.2), parça kabulü (sıra, oran tavanı, kota + disk %10 tek TX), belirteçler (P28b `TokenTable` yeniden kullanılır, yeni `kind`ler), audit/metrik  |
| `rec/routes.ts` (yeni)                                                                                      | §5 uçları; handler → service → repo                                                                                                                                            |
| `rec/webm.ts` (yeni, ≤ 150 satır)                                                                           | Bölümün ilk parçasında EBML başlığı + `Tracks`: yalnız 1 video izi (`TrackType=1`, `V_VP8`/`V_VP9`); ses/diğer iz → ret (AC-375)                                               |
| `rec/repo.ts` (yeni)                                                                                        | Prisma/SQL; `storageUsage` eki `fsrv/usage.ts` içinde (tek kota fonksiyonu korunur)                                                                                            |
| `fsrv/box.ts`, `fsrv/store.ts`, `fsrv/tokens.ts`                                                            | **Değişmeden** yeniden kullanılır: parça = bir `.rsf` (plainSize parça yüklenirken bilinir), `fid` = parça ULID'i, yol `{tenantId}/{rastgele24}.rsf` (aynı `STORAGE_REL_RE`)   |
| `jobs/retention-rec.ts` (yeni) + `retention.ts`, `retention-fsrv.ts reconcile`, `tenant-purge-repo.ts` (ek) | 03:30 süre dolumu, anonimleştirme/kalıcı silme/firma silme adımları, yetim dosya mutabakatının kayıt parçalarını da "canlı" sayması (§3.4)                                     |
| `unattended/connect*.ts`, `signaling/admit-device.ts`, `rejoin-device.ts` (ek)                              | P28u §13 kancaları: `connect.recording`, admit TX'inde politika kaydı, rejoin'de yeni bölüm                                                                                    |
| Web konsol `lib/rec/*`, `components/console/rec-indicator.tsx`                                              | Kaydedici, yükleyici, gösterge, uyarılar                                                                                                                                       |
| Web misafir/onay: `components/consent/recording-consent.tsx` (yeni, tek bileşen)                            | Join formu (kod/bağlantı) ve web talep formunda aynı kutu; misafir şeridinde gösterge + "Kaydı durdur"                                                                         |
| Web geçmiş: `history/[id]/recording.tsx`, `recording-player.tsx`                                            | Meta, oynatıcı, sil diyaloğu; listede "Kayıt" rozeti + süzgeç                                                                                                                  |
| Web ayar: `settings/recording/*`                                                                            | "Oturum kaydı" ayar bölümü                                                                                                                                                     |
| Go istemci `internal/flow` + `internal/ui` (ek)                                                             | Onay ekranında kutu (kod/bağlantı + talep formu), `rs.cap.rec1`, oturum penceresinde gösterge + "Kaydı durdur", `messages_p28e.go`                                             |
| Go servis/yardımcı `internal/servis`, `helperio`, `unattended` (ek)                                         | `rs.cap.record1`, `connect.recording` → `ConsentSpec.RecordingLine`, gösterge eki, `rec.state`                                                                                 |

### 2.1 Ana akış (katılımlı)

1. Müşteri onay ekranını açar. `ConsentTextView`'e eklenen `recording: {offered: boolean, line: string, lineSha256: string}` yanıtı,
   `offered = tenant.recording_enabled ∧ kota boş ∧ disk ≥ %10` iken kutuyu gösterir (AC-381, AC-384). Kutu **varsayılan işaretsizdir**.
2. Müşteri kutuyu işaretleyip katılır. İşaret yalnız istemci belleğinde tutulur. `admit` sonrası ilk `hello`'yu alan `rec1` soketi
   `rec.consent{lineSha256}` gönderir (K-P28e-3). İşaretsizse hiçbir şey gönderilmez ve oturum kayıtsız sürer.
3. Sunucu kapıdan geçirir (§6.2): tenant ayarı hâlâ açık, kota/disk uygun, oda gözetimsiz değil, satır yok. Sonra **tek TX** çalışır:
   `session_recordings` INSERT (`basis=CONSENT`, `ACTIVE`), `session_consents(level=RECORDING, decision=GRANTED, line_sha256)`, audit
   `recording.start{basis:"consent"}`. Commit sonrası tüm teknisyen soketlerine ve `rec1` misafire `rec.state{on:true}` gider. Kaydediciye
   ayrıca yükleme belirteci gönderilir.
4. Konsol ilk video karesinde (`requestVideoFrameCallback` veya `loadeddata`) MediaRecorder'ı başlatır. Teknisyen düğmesi yoktur (AC-382).
5. Müşteri "Kaydı durdur"a basar → `rec.revoke`. Sunucu `STOPPED{REVOKED}`, `session_consents(RECORDING, REVOKED)`, audit
   `recording.stop{reason:"revoked"}` ve `rec.state{on:false, reason:"revoked"}` yayını yapar. Konsol kaydediciyi durdurur, son parçayı
   15 sn yükleme payı içinde gönderir. Sonra belirteç düşer. Aynı oturumda kayıt yeniden başlamaz.

### 2.2 Gözetimsiz akış (P28e eki)

`POST /unattended/devices/:id/connect` zincirinde `recording = tenant.unattended_recording_enabled ∧ recording_enabled ∧ cihaz record1 ∧ kota/disk uygun`
hesaplanır ve bekleyen bağlantıya yazılır. `connect` mesajına `recording` eklenir (yalnız `record1` cihaza). `asked` kipinde yardımcı diyalogda
"Bu bağlantının ekran kaydı alınacaktır" satırını çizer (AC-449). `admit-device.ts` admit TX'i kip yazıldığı yerde ayarı yeniden okur.
`recording ∧ hâlâ açık` ise satır `basis=TENANT_POLICY` ile açılır ve `recording.start{basis:"tenant_policy", consentMode}` yazılır (AC-448).
Rıza satırı yazılmaz. Cihaz kullanıcısına "Kaydı durdur" verilmez (AC-448); tek yol yerel kapatma anahtarıdır (AC-295).
Anahtar kapalıyken `recording=false` olur ve AC-387 aynen geçerlidir (ayrı kod yolu yok).

## 3. Veri modeli — migration `20261125000000_p28e_recordings` (dba)

Tek migration, expand. Rollback: önce tenant ayarları kapatılır, sonra `down.sql` (tablolar + kolonlar düşer; yalnız P28e verisi kaybolur).
CHECK'ler ikili karşılaştırmayla yazılır (ADR-0014). Tetikleyici eklenmez.

### 3.1 Kolon ekleri

| Tablo / kolon                                     | Tip                                                    | Not                                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `tenant_settings.recording_enabled`               | `BOOLEAN NOT NULL DEFAULT FALSE`                       | AC-380                                                                                                               |
| `tenant_settings.recording_retention_days`        | `TINYINT NOT NULL DEFAULT 30`, CHECK 1..90             | Servis ayrıca `≤ retention_days` doğrular (bugün `retention_days ≥ 90` olduğundan hep sağlanır; kural yine kodda)    |
| `tenant_settings.unattended_recording_enabled`    | `BOOLEAN NOT NULL DEFAULT FALSE`                       | AC-447. CHECK: `unattended_recording_enabled = FALSE OR recording_enabled = TRUE`                                    |
| `tenant_settings.unattended_recording_ack_at/_by` | `DATETIME(3) NULL` / `CHAR(26) NULL` FK users RESTRICT | P28u `unattended_silent_ack_*` kalıbı. Açıkken dolu (CHECK). Kullanıcı silmede `_by` NULL (`deleteUserChildren` eki) |
| `session_consents.level` CHECK                    | `+ 'RECORDING'`                                        | AC-381                                                                                                               |
| `session_consents.line_sha256`                    | `CHAR(64) NULL`                                        | CHECK `(level = 'RECORDING') = (line_sha256 IS NOT NULL)`. Rıza cümlesinin SHA-256'sı = "metin sürüm özeti"          |

`RECORDING` satırında `consent_text_id/consent_sha256` oturumun `VIEW GRANTED` satırından kopyalanır. Böylece aydınlatma metni sürümü de bağlanır
ve mevcut çift CHECK'i ile bileşik FK aynen geçerli kalır. `source` `UI` olur.

### 3.2 `session_recordings` (oturum başına en çok bir satır)

| Kolon                                    | Tip                                                                                     | Not                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `id`                                     | `CHAR(26)` PK (ULID = protokoldeki `rid`)                                               |                                                                        |
| `tenant_id`, `session_id`                | `CHAR(26)` NOT NULL; bileşik FK `(session_id, tenant_id)` → `support_sessions` RESTRICT | `UNIQUE(session_id)`; ayrıca `UNIQUE(id, tenant_id)` (parça FK hedefi) |
| `basis`                                  | `VARCHAR(14)` CHECK ikili `CONSENT\|TENANT_POLICY`                                      |                                                                        |
| `state`                                  | `VARCHAR(8)` CHECK ikili `ACTIVE\|STOPPED\|DELETED`                                     | ACTIVE → STOPPED → DELETED; geri dönüş yok                             |
| `stop_reason`                            | `VARCHAR(12)` NULL, CHECK ikili `REVOKED\|QUOTA\|SESSION_END\|ERROR\|POLICY_OFF`        | STOPPED/DELETED'da dolu                                                |
| `delete_reason`                          | `VARCHAR(10)` NULL, CHECK ikili `EXPIRED\|MANUAL`                                       | Yalnız DELETED. Anonimleştirmede satır tümden silinir                  |
| `recorder_user_id`                       | `CHAR(26)` NULL (FK değil; `audit_logs.user_id` kalıbı)                                 | Son kaydeden teknisyen                                                 |
| `started_at`, `stopped_at`               | `DATETIME(3)`; `stopped_at` NULL                                                        |                                                                        |
| `expires_at`                             | `DATETIME(3)` NOT NULL                                                                  | `started_at + recording_retention_days` (başlangıçtaki değer)          |
| `duration_ms`                            | `INT UNSIGNED NOT NULL DEFAULT 0`                                                       | Parçaların toplam süresi                                               |
| `size_bytes`                             | `BIGINT NOT NULL DEFAULT 0`                                                             | Düz metin parça toplamı. Kota bu kolondan toplanır                     |
| `part_count`                             | `INT UNSIGNED NOT NULL DEFAULT 0`                                                       |                                                                        |
| `deleted_at`, `created_at`, `updated_at` | `DATETIME(3)`                                                                           |                                                                        |

İndeksler: `IX(tenant_id, state)` (kota toplamı + firma silme), `IX(state, expires_at)` (03:30), `UNIQUE(session_id)`.

### 3.3 `session_recording_parts`

| Kolon                       | Tip                                                                   | Not                                                                               |
| --------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `id`                        | `CHAR(26)` PK (ULID; HKDF `info`'daki `fid`)                          |                                                                                   |
| `recording_id`, `tenant_id` | `CHAR(26)`; bileşik FK → `session_recordings(id, tenant_id)` RESTRICT |                                                                                   |
| `series_no`                 | `SMALLINT UNSIGNED` (0..65535)                                        | Bölüm = bir MediaRecorder çalışması (kendi WebM başlığı)                          |
| `part_no`                   | `SMALLINT UNSIGNED` (0..11)                                           | Bölüm içi sıra (60 sn / 5 sn)                                                     |
| `offset_ms`                 | `INT UNSIGNED`                                                        | Kayıt başından itibaren bölüm başlangıcı + bölüm içi süre (sunucu sınırlar, §5.2) |
| `duration_ms`               | `SMALLINT UNSIGNED` 1..15000                                          |                                                                                   |
| `size_bytes`                | `INT UNSIGNED` 1..`REC_PART_MAX_BYTES`                                |                                                                                   |
| `storage_rel`               | `VARCHAR(80)` NULL, CHECK `^{tenant_id}/[A-Za-z0-9_-]{24}\.rsf$`      | Disk silinince satır da silinir (NULL ara durumu yalnız TX içi)                   |
| `key_ver`                   | `TINYINT UNSIGNED NOT NULL`                                           | `crypto:check-retire` bu kolonu da sayar (K-P28e-12)                              |
| `created_at`                | `DATETIME(3)`                                                         | Append-only; UPDATE grant'ı yok                                                   |

İndeks: `UNIQUE(recording_id, series_no, part_no)` (idempotans + oynatma sırası + FK öneki), `IX(tenant_id)`.
Büyüme: 5 sn parça → saatte 720 satır. 20 GB kota ≈ 30 saat ≈ 22 bin satır/tenant.

### 3.4 Silme, anonimleştirme, kalıcı silme (ADR-0030 uyumu)

- **03:30 (`retention.ts` yeni adım `recExpire`):** `state='STOPPED' AND expires_at <= now` → disk dosyaları silinir → aynı TX'te parça satırları
  DELETE edilir, kayıt `DELETED{EXPIRED}`, `size_bytes=0` olur. Tenant başına bir `recording.expired{count, bytes}` audit yazılır. `ACTIVE` kayıt
  süresi dolsa bile beklenir (oturum en çok 8 sa sürer).
- **Açılış süpürmesi + mutabakat:** süreç çökmesinde `ACTIVE` kalan ve odası olmayan kayıt → `STOPPED{ERROR}` + audit. `reconcile` (a) yetim dosya
  taramasında `storage_rel`'i `session_recording_parts`'ta olan dosyaları da **canlı** sayar. Bu ek yapılmazsa 24 saatten eski kayıt parçaları
  silinir (**kritik ek**, K4 testi).
- **Anonimleştirme (`anonymizeSessionBatch`):** disk dosyaları TX'ten önce silinir, sonra TX'te parçalar → kayıtlar DELETE edilir (AC-386). Satır
  kalmaz. `session_consents` RECORDING satırları mevcut kurala tabidir (ip/UA NULL).
- **Kalıcı silme (`purgeAnonymized`):** sıra `session_recording_parts` → `session_recordings` → `session_stored_files` → `session_files` →
  `session_consents` → `support_sessions`.
- **Firma silme (`tenant-purge-repo.ts DATA_STEPS`):** `stored_files` klasör adımı kayıt dosyalarını da kapsar (aynı kök). Ardından
  `byTenant("session_recording_parts")`, `byTenant("session_recordings")` oturum adımından önce çalışır.
- **Elle silme (AC-386):** §5 `DELETE`. Disk → parçalar → `DELETED{MANUAL}`. Audit satırı silinmez.

### 3.5 Grant (`prisma/sql/grants.sql`, `check-app-grants.sh`)

`app`: `session_recordings` SELECT, INSERT, UPDATE(state, stop_reason, delete_reason, recorder_user_id, stopped_at, duration_ms, size_bytes,
part_count, deleted_at, updated_at), DELETE. `session_recording_parts` SELECT, INSERT, DELETE. `tenant_settings` UPDATE'e yeni 5 kolon.
`session_consents` mevcut grant (INSERT) yeterlidir.

## 4. Yetki ve rıza metni

- `packages/contracts/src/permissions.ts`: `sessions` modülüne `view_recording` eklenir. Açıklama: "Oturum kayıtlarını izler (hassas — yalnız
  gerekene verin)." Rol varsayılanı Admin açık, User kapalı (V54, AC-404). Migration gerekmez.
- İzleme: `session_history.view ∧ sessions.view_recording ∧ historyScope` (teknisyen yalnız kendi oturumları, Admin tenant'ı). Silme:
  `session_history.edit ∧ historyScope`.
- Ayar: `settings.view` / `settings.edit`. Gözetimsiz anahtarın açılması step-up ister (AC-447).
- **Rıza cümlesi** contracts'ta tek sabittir (`REC_CONSENT_LINE = "Oturumun görüntü kaydının alınmasına izin veriyorum"`,
  `REC_CONSENT_LINE_SHA256` derleme zamanında hesaplanır). Go eşi fikstürden test edilir (`fixtures/rec.json`). Cümle değişirse SHA değişir.
  Sunucu yalnız güncel SHA'yı kabul eder. Eski istemci kutuyu farklı metinle gösterdiyse rıza reddedilir (kayıt yok, güvenli yön).
  Gözetimsiz diyalog satırı `REC_UNATTENDED_LINE = "Bu bağlantının ekran kaydı alınacaktır"`.

## 5. REST API sözleşmesi (`/api/v1`; zod `packages/contracts/src/api/recording.ts`, sabitler `packages/contracts/src/ws-rec.ts`)

Ortak: hata zarfı `docs/mimari-api.md`. Belirteçler yalnız `Authorization: Bearer` başlığında taşınır, URL'de asla (P28b kuralı; Caddy yol loglar).
Çerezli uçlarda CSRF + Origin denetlenir. Yeni hata kodu yoktur. `STORAGE_QUOTA` (409) P28b'den yeniden kullanılır. Başka tenant ya da
kapsam dışı istek her yerde **404** döner.

| Uç                                                                              | Kimlik / yetki                                                                          | Girdi                                                                                                                                                                        | Çıktı / hata                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUT /rec/:rid/series/:s/parts/:p`                                              | Bearer **yükleme** belirteci (WS `rec.state`'ten; rid + userId + oturum); çerez okunmaz | `Content-Type: video/webm`; gövde ≤ `REC_PART_MAX_BYTES` (2 MiB, rota `bodyLimit`); başlıklar `X-Rec-Duration-Ms` 1..15000, `X-Rec-Series-Start-Ms` (yalnız `p=0`, epoch ms) | Belirteç **`onRequest`'te, gövde okunmadan** denetlenir. 200 `{next}`. Var olan (s,p) → 200, yazmaz (idempotent). `p≠next` → 409 `{next}`. `s` yeni ise `s > son s ∧ p=0` olmalı, aksi 409. `p=0`'da `webm.ts` başlık denetimi: ses/ikinci iz/başka kodek → 400 + `recording.stop{error}`. Oran tavanı (§7) aşımı → 409 + stop{error}. Kota/disk → 409 `STORAGE_QUOTA` + stop{quota}. Kayıt `ACTIVE` değil ve son parça payı (15 sn) geçti → 404                                 |
| `GET /sessions/:id/recording`                                                   | Çerez; `session_history.view` + `sessions.view_recording` + historyScope                | —                                                                                                                                                                            | 200 `{id, state, basis, stopReason?, startedAt, stoppedAt?, durationMs, sizeBytes, expiresAt, consentMode?, silentReason?, series: {s, offsetMs, parts: {p, offsetMs, durationMs}[]}[], canDelete}`; kayıt yok/DELETED → 404 (DELETED için geçmiş detay alanı yeter)                                                                                                                                                                                                             |
| `POST /sessions/:id/recording/view`                                             | Çerez + CSRF; aynı yetki; 20/dk/kullanıcı                                               | —                                                                                                                                                                            | 200 `{token, idleTtlMs, maxUntil}`. **Audit `recording.view` burada, izleme oturumu başına bir kez yazılır** (parça GET'lerinde değil). Belirteç `authSessionId`'ye bağlıdır                                                                                                                                                                                                                                                                                                     |
| `GET /rec/:rid/series/:s/parts/:p`                                              | Bearer **izleme** belirteci; çerez okunmaz                                              | —                                                                                                                                                                            | 200 düz WebM baytları, `Content-Type: video/webm`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin`, `Content-Security-Policy: sandbox; default-src 'none'`. **`Content-Disposition` yok, `Range` yok** (parça zaten ≤ 2 MiB rastgele erişim birimidir, K-P28e-5). Her GET'te kullanıcı ve `auth_session` etkin mi, yetki hâlâ var mı denetlenir. Belirteç/rid uyuşmazlığı → 404; IP başına 60/dk 404 → 429             |
| `DELETE /sessions/:id/recording`                                                | Çerez + CSRF; `session_history.edit` + historyScope                                     | `{confirm: true}`                                                                                                                                                            | 204. `ACTIVE` → 409 `CONFLICT` ("Oturum sürerken kayıt silinemez"). Audit `recording.delete{recordingId, durationMs, sizeBytes}`. İdempotent: DELETED → 204                                                                                                                                                                                                                                                                                                                      |
| `GET /settings/recording`                                                       | `settings.view`                                                                         | —                                                                                                                                                                            | `{enabled, retentionDays, unattendedEnabled, unattendedAckAt?, storage: {usedBytes, quotaBytes}, maxRetentionDays}`                                                                                                                                                                                                                                                                                                                                                              |
| `PUT /settings/recording`                                                       | `settings.edit`; `unattendedEnabled` false→true ise step-up (mevcut `stepUp`)           | `{enabled, retentionDays: 1..90, unattendedEnabled, consentUpdated?: true, employeeNoticeAck?: true}`                                                                        | `enabled` false→true ve `consentUpdated !== true` → 400 `fields.consentUpdated` (AC-380/354). `unattendedEnabled ∧ !enabled` → 400 `fields.unattendedEnabled`. `unattendedEnabled` false→true ve `employeeNoticeAck !== true` → 400 `fields.employeeNoticeAck` (AC-436 kutusu). `enabled=false` → `unattendedEnabled=false` (AC-447). `retentionDays > tenant.retentionDays` → 400. Kapatma etkin kayıtları durdurur (§6.5). Audit `settings.recording` eski→yeni + `consentAck` |
| `GET /sessions/:id/history` (ek)                                                | mevcut                                                                                  | —                                                                                                                                                                            | yeni alan `recording: {state, basis, stopReason?, durationMs, expiresAt, canView, canDelete} \| null`                                                                                                                                                                                                                                                                                                                                                                            |
| `GET /sessions/history` (ek, liste)                                             | mevcut                                                                                  | süzgeç `recorded=true`                                                                                                                                                       | satırda `hasRecording: boolean` (DELETED hariç). Süzgeç `EXISTS` alt sorgusu `UNIQUE(session_id)` ile yapılır                                                                                                                                                                                                                                                                                                                                                                    |
| `ConsentTextView` (ek; resolve + talep formu + web talep formu metin yanıtları) | mevcut                                                                                  | —                                                                                                                                                                            | `recording?: {offered: boolean, line, lineSha256}`. Alan **yalnız `offered=true`** iken eklenir. Go `internal/api` katı ayrıştırmaz; K5 bunu test eder                                                                                                                                                                                                                                                                                                                           |

**Belirteçler (P28b `TokenTable`, bellek, ADR-0005):** iki yeni `kind`:
`recUpload {rid, sessionId, tenantId, userId}` ve `recView {rid, tenantId, userId, authSessionId, idleUntil, maxUntil}`. Yükleme belirteci kayıt
`STOPPED` olunca 15 sn sonra, teknisyen odadan ayrılınca ve oda kapanınca (15 sn pay sonrası) düşer. İzleme belirteci **kayan** süreyle çalışır:
her GET `idleUntil = now + 5 dk` yapar, `maxUntil = now + durationMs + 30 dk` (en çok 8 sa). Süre dolarsa oynatıcı yeni `POST /view` ister ve
yeni audit yazılır. Sunucu yeniden başlarsa belirteçler düşer (kabul edilen sınır).

### 5.1 Parça kabulü (tek TX, `rec/service.ts acceptPart`)

1. Belirteç → `rid`. Gövde ≤ 2 MiB ise bellekte tamamlanır. `p=0` ise `webm.ts` denetimi yapılır.
2. `box.ts` ile `.part`'a şifrelenir (`fid` = yeni parça ULID'i, plainSize = gövde boyu), `fsync`, `rename → .rsf`.
3. TX: `SELECT … FROM tenants WHERE id=? FOR UPDATE` (P28b serileştirme kalıbı) → kayıt `FOR UPDATE`, `state='ACTIVE'` ya da pay içinde mi
   denetlenir → `storageUsage + size > kota` mı → disk %10 → oran tavanı → parça INSERT, kayıt `size_bytes/duration_ms/part_count` UPDATE.
   Ret durumunda TX dışında `.rsf` silinir (güvenli yön: dosya var, satır yok → mutabakat 24 saatte siler).
4. `offset_ms`: bölüm başlangıcı `clamp(X-Rec-Series-Start-Ms, son parça bitişi, now)` (istemci saati yalnız bu aralıkta kabul edilir) + bölüm
   içi önceki parçaların süresi.

### 5.2 `storageUsage` (tek kota fonksiyonu, `fsrv/usage.ts`)

`SUM(session_stored_files.size_bytes …)` + `SUM(session_recordings.size_bytes) WHERE tenant_id=? AND state <> 'DELETED'`. Görünüm (`tenantStorage`)
değişmez. Dosya ve kayıt tek kota kavramıdır (V50).

## 6. Protokol mesajları (`packages/contracts/src/ws-rec.ts`, `z.strictObject`; Go eşi `internal/signal` + `internal/servis/wire.go`; fikstür `fixtures/rec.json`)

### 6.1 Yetenek bildirimi

- `/ws/guest`: `rs.cap.rec1`. Go istemci 0.16.0 ve tarayıcı misafir sayfası bildirir (tarayıcı da aynı kurala uyar, tek kural). Sunucu `rec.*`
  mesajlarını **yalnız `rec1` soketine** gönderir; `rec1` olmayan sokette `rec.*` gelen mesajı şema hatasıdır (1008).
- `/ws/tech`: konsol `MediaRecorder.isTypeSupported("video/webm;codecs=vp8")` doğruysa `rs.cap.rec1` bildirir. Bildirmeyen konsolda kayıt
  başlatılamaz (K-P28e-9).
- `/ws/device`: servis `rs.cap.record1` bildirir. Bildirmeyen cihaza `connect.recording` ve `rec.state` gönderilmez, o cihazda kayıt yapılmaz
  (gösterge eki çizilemez, K-P28e-7). Konsol "Cihaz istemcisi eski; kayıt için 0.16.0 gerekli" uyarısını gösterir.
- Gözetimsiz odada `/ws/guest` belirteçleri okunmaz (O-P28a-4 aynen). Gözetimsiz yol yalnız `/ws/device` üzerinden çalışır.

### 6.2 Mesajlar

| t              | Yön                  | Alanlar                                                                                                       | Sunucu davranışı                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------- | -------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rec.consent`  | guest→S              | `lineSha256: /^[0-9a-f]{64}$/`                                                                                | Kapı (ilk tutan döner, sessiz yok sayılır + log): ADMITTED `rec1` misafir değil → 1008; oda gözetimsiz → yok say; SHA ≠ `REC_CONSENT_LINE_SHA256` → yok say; ilk admit `hello`'sundan > 30 sn geçti → yok say; oturumda kayıt satırı zaten var (geri alınmış dahil) → yok say; tenant ayarı kapalı → `rec.state{on:false, reason:"unavailable"}`; kota/disk → `rec.state{off,"quota"}` + audit `recording.start` fail `{reason:"quota"}`. Geçerse §2.1 m.3 |
| `rec.revoke`   | guest→S              | —                                                                                                             | Yalnız `rec1` misafir ve `basis=CONSENT ∧ ACTIVE` iken işlenir; aksi yok sayılır. §2.1 m.5. Hedef: müşteri tıklamasından konsol kaydedicisinin durmasına ≤ 2 sn (AC-382)                                                                                                                                                                                                                                                                                   |
| `rec.state`    | S→guest (`rec1`)     | `on: boolean`, `reason?: "revoked"\|"quota"\|"session_end"\|"error"\|"policy_off"\|"unavailable"`             | İstemci göstergeyi ve "Kaydı durdur"u yalnız buna göre çizer. Yeniden bağlanan misafirin `hello`'suna `rec?: {on}` eklenir (yalnız `rec1`)                                                                                                                                                                                                                                                                                                                 |
| `rec.state`    | S→tech (tümü)        | `on`, `reason?`, `rid?`, `basis?: "consent"\|"tenant_policy"`, `upload?: {token, series: int, nextPart: int}` | Tüm teknisyen soketlerine gider (gösterge, AC-382 "tüm teknisyenler"). `upload` **yalnız `recorderOf(room)`** soketine gider. Teknisyen `hello`'suna `rec?` aynı biçimde eklenir (yeniden bağlanma → yeni belirteç, `series = son+1`)                                                                                                                                                                                                                      |
| `rec.error`    | tech→S               | `code: "unsupported"\|"recorder_failed"\|"upload_failed"`                                                     | Yalnız kaydediciden kabul edilir. `ACTIVE` kayıt → `STOPPED{ERROR}` + audit `recording.stop{reason:"error", code}` + `rec.state{off,"error"}` yayını                                                                                                                                                                                                                                                                                                       |
| `connect` (ek) | S→device             | `recording?: true` (yalnız `record1`)                                                                         | P28u §6.2 mesajına isteğe bağlı alan. Servis → yardımcı `ConsentSpec.RecordingLine` (asked) ve `IndicatorControl.Recording`                                                                                                                                                                                                                                                                                                                                |
| `rec.state`    | S→device (`record1`) | `on: boolean`                                                                                                 | Kayıt ortada durursa (kota/hata/politika) gösterge eki kalkar. Cihaz yanıt göndermez                                                                                                                                                                                                                                                                                                                                                                       |

Sunucu tarafında oda durumu `room.rec = {rid, basis, state, recorderConnId, series, nextPart, lastPartAt}` olarak tutulur ve `hello`/`peer.joined`
bundan türetilir. Gösterge "kayıt olabilir" sürenin tamamında yanar: `ACTIVE` başladığı andan `STOPPED`'a kadar, parça gelmese bile.

### 6.3 Kaydedici değişimi, kopma, rejoin

- **Teknisyen kopar:** kayıt `ACTIVE` kalır, gösterge sürer. Belirteç 15 sn pay sonrası düşer. Arada yüklenemeyen ≤ 10 sn kaybolur (AC-383).
  Teknisyen yeniden bağlanınca `hello.rec.upload` ile **yeni bölüm** (`series+1`) başlar. Oynatıcı boşluğu gösterir.
- **Misafir kopar / gözetimsiz rejoin (`rejoin-device.ts`):** görüntü yoksa kaydedici bölümü kapatır (iz `ended`). İz yeniden gelince yeni bölüm
  açılır (P28u §13 "yeni parça dizisi").
- **Çözünürlük/monitör değişimi:** MediaRecorder hata verirse ya da iz değişirse konsol yeni bölüm açar. K0s ölçer.
- **Parça gözcüsü (K-P28e-8):** kaydedici bağlı, görüntü akıyor (misafir `share.state=sharing` ya da cihaz bağlı) ve 30 sn parça gelmediyse
  `STOPPED{ERROR}` + audit `{code:"no_upload"}` olur. Bu, sekmeyi kapatmadan kaydı bastırmayı görünür kılar. Sekme kapanırsa teknisyen kopar
  (yukarıdaki kural); 120 sn içinde dönmezse ve oturum sürerse aynı stop yazılır.
- **P28c genişleme noktası:** `recorderOf(room)` bugün odadaki tek teknisyeni döndürür. P28c bunu "oturum sahibi" yapar. Sahip değişince eski
  sahibe `rec.state{on:true}` (upload'sız) gider, belirteci düşer; yeni sahibe `upload{series+1}` gider. Kayıt durmaz. P28e'de kodlanmaz.

### 6.4 Oturum bitişi

Oda kapanınca `STOPPED{SESSION_END}`, audit `recording.stop{reason:"session_end"}`. Son parça için 15 sn pay tanınır, sonra belirteç düşer.

### 6.5 Politika/ayar kapatma

`PUT /settings/recording` `enabled=false` ya da gözetimsiz anahtar kapandığında ilgili `ACTIVE` kayıtlar (`basis` uygun olanlar) `STOPPED{POLICY_OFF}`
olur ve yayın yapılır. **Varsayım V-PE-1:** AC-388 neden listesine `policy_off` eklenir (ayar kapatma KVKK yönünde güvenlidir; listede karşılığı
yoktu).

## 7. Konsol kaydedici, format ve bütçe (K-P28e-4)

- `MediaRecorder(new MediaStream([videoTrack]), {mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 1_500_000})`, `start(5000)` (timeslice
  5 sn). **Bölüm** = bir MediaRecorder çalışması, en çok 60 sn: 60 sn'de `stop()` ve hemen yeni `start()` (dakikada bir kısa geçiş; seek
  birimi). Ses izi akışa hiç eklenmez (AC-375).
- 1,5 Mbit/s → yaklaşık 0,68 GB/saat (1080p ekran içeriği). Bit hızı tarayıcı için yalnız hedeftir. **Sunucu tavanı** kaydın toplam baytını
  `≤ 1 GiB/sa × geçen süre + 32 MiB` ile sınırlar; aşım `STOPPED{ERROR}` olur (AC-384 "≤ 1 GB/saat" sunucuda zorlanır). Parça ≤ 2 MiB
  (5 sn × 1,5 Mbit ≈ 0,94 MB, anahtar kare payı). Mevcut nginx `3m` / Caddy `read_body 30s` / ayrı rota `bodyLimit` ile uyumludur.
  Yeni proxy ayarı gerekmez.
- Yükleme sırası: tek eşzamanlı PUT, bellekte en çok 3 parça kuyruğu (≈ 15 sn). Taşarsa en eski atılır ve `rec.error{upload_failed}` gönderilmez
  (gözcü karar verir). Yeniden deneme 1/2/4 sn.
- Kayıt `ACTIVE` iken konsol sekmesi arka plandaysa MediaRecorder çalışmaya devam eder. Zamanlayıcı kısıtlamasının etkisini K0s ölçer.
- **Oynatıcı (MSE):** `MediaSource` + `SourceBuffer("video/webm; codecs=vp8")`, `mode="sequence"` değil `segments` + `timestampOffset = series.offsetMs`
  ile her bölüm kendi zaman konumuna eklenir. Bölüm başı = `p=0` (başlık içerir). Seek: hedef zamanı içeren bölüm baştan, en çok 12 parça
  (≈ 11 MB) çekilir. Boşluklar zaman çizgisinde taralı gösterilir ve oynatma sonraki bölüme atlar. Önden en çok 30 sn tamponlanır. Kaynak:
  `blob:` URL, `controlsList="nodownload"`, `disablePictureInPicture`, sağ tık menüsü kapatılır (caydırıcı; ekran kaydı her zaman mümkündür, R-PE5).
- CSP (`apps/web/proxy.ts`): `media-src 'self' blob:` eklenir.

## 8. Go istemci, servis, yardımcı (0.16.0, `apps/agent-win`)

| Parça                                                  | Değişiklik                                                                                                                                                                                                                        |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `internal/api`                                         | `ConsentTextView.Recording *struct{Offered bool; Line, LineSha256 string}`. Katı ayrıştırma yoktur; eski istemci alanı yok sayar (test)                                                                                           |
| `internal/ui` onay ekranı (kod/bağlantı + talep formu) | `Recording.Offered` ise aydınlatma metninin altında ayrı, **işaretsiz** onay kutusu (`REC_CONSENT_LINE`); `LineSha256` ≠ derlemedeki sabit → kutu gösterilmez (güvenli yön). Seçim yalnız bellekte                                |
| `internal/signal`                                      | `rs.cap.rec1` bildirir; `rec.state` / `hello.rec` ayrıştırma; `rec.consent`, `rec.revoke` gönderimi (strict şema + fikstür)                                                                                                       |
| `internal/flow` + oturum penceresi                     | `hello` sonrası işaretliyse bir kez `rec.consent`. `rec.state{on}` → oturum penceresi göstergesine "● Kayıt yapılıyor" + **Kaydı durdur** (onaysız; geri alınamaz, metin açıkça yazar). `on:false` + `reason` → kısa bilgi satırı |
| `internal/servis` (`wire.go`)                          | `rs.cap.record1`; `connect.recording`; `rec.state{on}`                                                                                                                                                                            |
| `helperio` (strict, servis ve yardımcı aynı ikili)     | `ConsentSpec.RecordingLine bool`, `IndicatorControl.Recording bool`                                                                                                                                                               |
| Yardımcı onay diyaloğu (ADR-0033)                      | `RecordingLine` ise "Bu bağlantının ekran kaydı alınacaktır" satırı çizilir. Satır çizilmeden "İzin ver" etkinleşmez (AC-449, AC-292 kalıbı: çizim doğrulaması başarısız → diyalog açılmaz → `consent.result{error}`)             |
| Gösterge (`deviceIndicatorText`)                       | `Recording` → metne " — Kayıt yapılıyor" eki. Eki çizilemezse servis bağlantıyı açmaz (AC-294 kalıbı)                                                                                                                             |
| `messages_p28e.go`                                     | Tüm yeni metinler tek tabloda                                                                                                                                                                                                     |

Sürüm `0.16.0`. Eski istemci/servis yeni sunucuyla kayıtsız çalışır (rıza gönderemez, `record1` yok). Yeni istemci eski sunucuyla `rec1`'i
boşa bildirir (sunucu okumaz) ve kayıt olmaz.

## 9. Web (`apps/web`; DESIGN.md token'ları, `lucide-react`, iki tema, 390 px, axe 0, `prefers-reduced-motion`)

| Ekran / bileşen                                                    | İçerik ve durumlar                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/consent/recording-consent.tsx` (yeni)                  | Tek bileşen: join formu (`session/[token]/join-form.tsx`) ve web talep formu (`r/[ref]/web-request-form.tsx`). `recording.offered` yoksa render edilmez. Ayrı satırda işaretsiz `checkbox` + `label` (`Video` ikonu), aydınlatma onayından bağımsızdır. Seçim `sessionStorage`'da değil bellekte (sayfa yenilenirse rıza yok sayılır)                                                                                                                            |
| Misafir şeridi (`guest/share-strip.tsx` ek)                        | `rec.on` → `CircleDot` + "Kayıt yapılıyor" (`control-frame` rengi, `role=status`, kapatılamaz) + `danger-ghost` **Kaydı durdur** (`CircleStop`). Basınca onay yok, düğme `loading` olur, `rec.state{off}` gelince "Kayıt durduruldu; o ana kadarki kısım saklanır" satırı. `quota`/`error` → nötr bilgi satırı                                                                                                                                                   |
| Konsol `console/rec-indicator.tsx` (yeni)                          | Üst şeritte `CircleDot` "Kayıt yapılıyor" rozeti (yanıp sönme yok, `prefers-reduced-motion` gereksiz). Kaydedici değilse de görünür. Durdu → `reason`'a göre `Alert`: `quota` "Depolama kotası doldu, kayıt durdu" (`warning`, AC-384), `revoked` "Müşteri kayıt iznini geri aldı", `error` "Kayıt durdu (hata)", `unsupported` "Bu tarayıcı oturum kaydını desteklemiyor; Chrome, Edge veya Firefox kullanın"                                                   |
| Konsol `lib/rec/recorder.ts`, `upload.ts` (yeni)                   | §7. Kaydedici durumu UI'ya yansımaz (teknisyen düğmesi yok, AC-382); yalnız hata sayısı test kancası                                                                                                                                                                                                                                                                                                                                                             |
| Gözetimsiz konsol (`unattended-actions.tsx` ek)                    | `rec.on` aynı rozet; cihaz `record1` yoksa ve politika açıksa `warning` "Cihaz istemcisi eski; kayıt yapılamıyor"                                                                                                                                                                                                                                                                                                                                                |
| `settings/recording/*` (yeni bölüm, Ayarlar menüsü, `Video` ikonu) | Anahtar "Oturum kaydı", sayı alanı "Kayıt saklama süresi (gün)" 1–90 (yardım: firma oturum saklama süresini aşamaz), açarken aydınlatma onay kutusu (AC-354 metni), depolama kullanım çubuğu (P28b `storage`). Altında "Gözetimsiz bağlantıları da kaydet" (yalnız ana anahtar açıkken etkin) + çalışan bilgilendirme kutusu (AC-436 metni) + step-up diyaloğu. 5 durum, alan hataları `fields.*`                                                                |
| Geçmiş listesi (ek)                                                | "Kayıt" sütununda `Video` ikonu (`aria-label`), süzgeç düğmesi "Kayıtlı" (`Segmented` ile)                                                                                                                                                                                                                                                                                                                                                                       |
| Geçmiş detayı `history/[id]/recording.tsx` (yeni)                  | Bölüm başlığı + meta: süre, boyut, dayanak ("Müşteri rızası" / "Firma politikası"), gözetimsizse kip ve (`silent`) gerekçe (AC-450), silinme tarihi. `canView` → **Kaydı izle** (`Play`), oynatıcı satır içinde açılır. `canDelete` → `danger-ghost` **Kaydı sil** (`Trash2`) + onay diyaloğu (varsayılan odak Vazgeç). Durumlar: yok (bölüm gizli), silindi (`Eraser` "Kayıt silindi — süresi doldu / elle silindi"), yükleniyor, hata, oynatıcı desteklenmiyor |
| `recording-player.tsx` (yeni)                                      | §7 MSE. Zaman çizgisinde boşluklar taralı. Klavye: Space oynat/duraklat, ←/→ 5 sn. İndir düğmesi yok                                                                                                                                                                                                                                                                                                                                                             |

DESIGN.md'ye eklenecek ikonlar: Kayıt göstergesi → `CircleDot`, Kayıt/oturum kaydı ayarı → `Video`, Kaydı izle → `Play`, Kaydı durdur → `CircleStop`.

## 10. Güvenlik tasarımı — tehdit modeli (STRIDE; güvenlik ajanı S-P28e-n numaralarını buradan verir)

| #   | Tehdit                                                           | Önlem                                                                                                                                                                                        |
| --- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | (S) Rızasız kayıt: sahte/eski istemci `rec.consent` gönderir     | Rıza yalnız `rec1` + ADMITTED misafirden, 30 sn penceresinde, güncel SHA ile kabul edilir. İstemci kutuyu varsayılan işaretsiz gösterir (Go/web birim testi). `session_consents` izi tutulur |
| T2  | (T) Teknisyen kaydı bastırır (sekme kapatma, ağ kesme, devtools) | Gözcü + `recording.stop{error}` + oynatıcıda boşluk. Tam önlem kapsam dışı (R-PE1, ADR-0034)                                                                                                 |
| T3  | (T) Teknisyen sahte içerik yükler (başka video)                  | Kapsam dışı: kaydın kaynağı teknisyendir. Kayıt "teknisyen tarafının gördüğü"dür; kılavuzda açıkça yazılır. Belirteç teknisyene ve oturuma bağlıdır                                          |
| T4  | (I) Başka tenant'ın kaydına erişim / IDOR                        | Her uçta `tenantScope` + historyScope. Parça GET'i yalnız `recView` belirteciyle, `rid` eşleşmesiyle; uyuşmazlık 404. Dosya yolu `{tenantId}/` öneki CHECK + `store.ts` doğrulaması          |
| T5  | (I) Belirtecin sızması (log, URL, Referer)                       | Yalnız `Authorization` başlığında taşınır. Caddy/nginx başlık loglamaz. İzleme belirteci `authSessionId`'ye bağlıdır; çıkış veya yetki kaybı sonraki GET'te 404 döner                        |
| T6  | (I) Kaydın indirilmesi                                           | İndirme ucu/düğmesi yok. `no-store`, CSP sandbox, `blob:` MSE. Ekran kaydına karşı teknik önlem yoktur (R-PE5)                                                                               |
| T7  | (I) Diskte düz metin                                             | Parça bellekte tamamlanır ve doğrudan `box.ts` ile şifrelenir. nginx gövde tamponu server düzeyinde 3m (P28b D-P28b-4). Sunucu düz WebM'i diske yazmaz                                       |
| T8  | (D) Disk/kota tüketimi (büyük parça, hızlı yükleme)              | Parça ≤ 2 MiB, oran tavanı 1 GiB/sa, kota + disk %10 tek TX'te, IP başına 404 sınırı, oturum başına tek kayıt                                                                                |
| T9  | (T) Kötü niyetli WebM ile tarayıcı/oynatıcı istismarı            | Sunucu başlığı denetler (tek video izi, VP8/VP9). İçerik yalnız aynı tenant'ın yetkili izleyicisine ve tarayıcının sandbox'lı medya çözücüsüne gider                                         |
| T10 | (R) Kim izledi / sildi inkârı                                    | `recording.view` izleme oturumu başına, `recording.delete`. Audit silinmez                                                                                                                   |
| T11 | (E) Yetkisiz kişinin ayarı açması / gözetimsiz kaydı açması      | `settings.edit`, gözetimsiz anahtarda step-up + çalışan bilgilendirme kutusu, audit eski→yeni                                                                                                |
| T12 | (I) Gizli kayıt (göstergesiz)                                    | Gösterge sunucu durumundan türer. Çizemeyen kaynakta (eski istemci/servis) kayıt başlamaz. Gözetimsizde ek çizilemezse bağlantı açılmaz                                                      |
| T13 | (I) Ses kaydı                                                    | Akış yalnız video izinden kurulur. Sunucu WebM başlığında ses izini reddeder. Test: kayıt dosyasında ses izi 0 (AC-375)                                                                      |
| T14 | (I) Anahtar rotasyonu sonrası eski kaydın açılamaması            | `check-retire` kayıt parçalarının `key_ver`'ini sayar. Eski anahtar en uzun saklama (90 gün) dolmadan emekliye ayrılmaz (K-P28e-12)                                                          |

**Hassas veri:** kayıt kişisel veridir (ekranda görülen her şey). Yalnız şifreli saklanır, yedeğe girmez, loga/metriğe içerik ya da süre dışında
alan yazılmaz. `silentReason` yalnız yetkili izleyiciye meta olarak gösterilir.

**KVKK:** varsayılan kapalı, aydınlatma onay kutusu, ayrı ve işaretsiz rıza, rızanın geri alınması, görünür gösterge, en çok 90 gün saklama,
anonimleştirmede silme, izleme audit'i. DATASHEET/kılavuzda "kayıt teknisyen tarafında alınır, sunucuda şifreli saklanır, ses kaydedilmez,
indirilemez" açık beyanı (AC-363 kalıbı) yer alır.

## 11. Audit, metrik, operasyon

### 11.1 Audit (`packages/contracts/src/audit.ts` → `RECORDING_AUDIT`; Türkçe etiketler mevcut etiket tablosuna, audit süzgecinde "Kayıt" grubu)

| Action               | Ne zaman                        | `new_value`                                                                                                           | result                      |
| -------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `recording.start`    | Kayıt satırı açıldı / açılamadı | `{recordingId?, basis: "consent"\|"tenant_policy", consentMode?, reason?: "quota"\|"device_outdated"\|"unsupported"}` | açıldı → success, aksi fail |
| `recording.stop`     | Her kapanış                     | `{recordingId, reason: "revoked"\|"quota"\|"session_end"\|"error"\|"policy_off", code?, durationMs, sizeBytes}`       | success                     |
| `recording.view`     | `POST /view`                    | `{recordingId}`                                                                                                       | success                     |
| `recording.delete`   | Elle silme                      | `{recordingId, durationMs, sizeBytes}`                                                                                | success                     |
| `recording.expired`  | 03:30, tenant başına            | `{count, bytes}`                                                                                                      | success                     |
| `settings.recording` | Ayar değişimi                   | eski→yeni `{enabled, retentionDays, unattendedEnabled}` + `consentAck` / `employeeNoticeAck`                          | success                     |

`entity="support_sessions"`, `entity_id=sessionId` (oturum zaman çizelgesinde görünür). `recording.expired` için `entity="retention"`. Actor:
`start{consent}` ve `stop{revoked}` → müşteri. `tenant_policy` → bağlanan teknisyen. Diğerleri → sistem ya da isteyen kullanıcı.
**Varsayım V-PE-2:** başlamayan kayıt `recording.start` result=fail ile yazılır (AC-388 listesinin doğal uzantısı).

### 11.2 Metrikler (`ops/metrics.ts`; tenant etiketi yok)

`rs_rec_active` (gauge), `rs_rec_part_total{result="ok|dup|order|quota|rate|invalid|gone"}`, `rs_rec_stop_total{reason}`, `rs_rec_bytes_total`,
`rs_rec_part_bytes` (histogram). `rs_storage_used_bytes` kayıtları da içerir.

### 11.3 Alarmlar (runbook §28e)

`rs_rec_stop_total{reason="error"}` / tüm stop oranı > %20 / 1 sa → uyarı (konsol tarayıcı sorunu ya da bastırma). `rs_rec_part_total{result=~"invalid|rate"}`

> 10 / 10 dk → uyarı. Disk alarmları P28b'den aynen (< %15 uyarı, < %10 kritik; kayıt %10'da kendiliğinden durur).

### 11.4 Config, migration, yedek, geri dönüş

- Yeni env yok. Sabitler `ws-rec.ts`: `REC_PART_MS = 5000`, `REC_SERIES_MS = 60000`, `REC_PART_MAX_BYTES = 2097152`,
  `REC_TARGET_BPS = 1500000`, `REC_MAX_BYTES_PER_HOUR = 1073741824`, `REC_RATE_SLACK_BYTES = 33554432`, `REC_CONSENT_WINDOW_MS = 30000`,
  `REC_STOP_GRACE_MS = 15000`, `REC_WATCHDOG_MS = 30000`, `REC_VIEW_IDLE_MS = 300000`, `REC_RETENTION_MIN/MAX/DEFAULT = 1/90/30`.
- Dosyalar `stored_files` volume'unda (`FILES_DIR`) tutulur, **yedeğe girmez** (K-P28b-11, kullanıcı kararı S-P28-3). Yedekten dönüşte DB'de olup
  dosyası olmayan parça mutabakatta → kayıt `DELETED{EXPIRED}` (geçmişte "silindi").
- Geri alma: ayarlar kapatılır → önceki imaj → tablolar kalabilir (expand). Eski istemci/servis zaten kayıtsızdır.
- `crypto:check-retire` raporuna `session_recording_parts` `key_ver` sayısı eklenir. Runbook: "eski anahtar, en son yazılan kaydın saklama süresi
  (≤ 90 gün) dolmadan kaldırılmaz". `crypto:rewrap` kayıtlara dokunmaz.
- Kapasite: R41. 20 GB kota ≈ 30 sa kayıt/tenant. Disk planı runbook §28e'de tenant sayısı × kota ile yazılır.

## 12. Test stratejisi

| Seviye                                        | Kapsam                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Birim (server, Vitest)                        | `webm.ts` (video-only geçer; ses izi/iki iz/bozuk EBML reddedilir — `AC-375`), oran tavanı, `offset_ms` sınırlama, `rec.consent` kapı tablosu, belirteç kayan süresi, `storageUsage` toplamı                                                                                                                                                                                                                                                                                                           |
| Entegrasyon (gerçek MySQL)                    | AC-380 ayar + ack + audit; AC-381 rıza satırı + `line_sha256`; AC-382 revoke → sonrası parça 404, yeniden rıza yok sayılır; AC-383 parça idempotans/sıra, `.rsf` şifreli (düz WebM imzası diskte yok); AC-384 kota başta (`offered=false`) ve ortada (409 + stop); AC-385 izleme yetkisi, başka tenant 404, view audit; AC-386 03:30, anonimleştirme, kalıcı silme sırası, firma silme, elle silme; mutabakat kayıt parçasını silmez; AC-387/448 politika kapalı/açık admit; AC-388 tüm stop nedenleri |
| Go birim                                      | Kutu varsayılan işaretsiz; SHA uyuşmazsa kutu yok; `rec.consent` yalnız işaretliyse; `rec.state` → gösterge; helper `RecordingLine` çizilmeden İzin ver etkin değil (AC-449); `record1` + `connect.recording` fikstürü; gösterge eki (AC-448)                                                                                                                                                                                                                                                          |
| Web birim + e2e (Playwright)                  | Join/web talep kutusu (offered/değil), misafir gösterge + Kaydı durdur ≤ 2 sn (sahte MediaRecorder ile zaman ölçümü), konsol rozeti + kota uyarısı, ayar ekranı 5 durum + step-up, geçmiş "Kaydı izle" (fikstür WebM ile MSE oynatma), indirme düğmesi yok, kip/gerekçe görünür (AC-450), iki tema axe 0, 390 px                                                                                                                                                                                       |
| Gerçek tarayıcı (`playwright.real.config.ts`) | Chromium + Firefox: sahte ekran akışı → 2 dk kayıt → oynatma, seek, boşluk; ses izi 0 (`AC-375`)                                                                                                                                                                                                                                                                                                                                                                                                       |
| Elle (Windows, kullanıcıya liste)             | Go istemci kutu + gösterge + durdur; gözetimsiz `asked` diyalog satırı, `silent` gösterge eki; 1 sa kayıt boyutu ≤ 1 GB (AC-384)                                                                                                                                                                                                                                                                                                                                                                       |

Komutlar: `pnpm -r run test`, `pnpm --filter @remote/web e2e`, `go test ./...` (`apps/agent-win`).

## 13. Dosya/klasör planı (görev başına ayrık sahiplik)

| Görev | Yeni / değişen dosyalar                                                                                                                                                                                                                                                                                                                      |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K0s   | yalnız `docs/implementation.md` "P28e K0s" bölümü (+ geçici spike sayfası commit edilmez)                                                                                                                                                                                                                                                    |
| K1    | `apps/server/prisma/schema.prisma`, `prisma/migrations/20261125000000_p28e_recordings/{migration,down,precheck}.sql`, `prisma/sql/grants.sql`, `scripts/check-app-grants.sh`, `docs/db-notlari.md`                                                                                                                                           |
| K2    | `packages/contracts/src/{ws-rec.ts, api/recording.ts, permissions.ts, audit.ts, ws.ts (hello/caps ekleri), ws-device.ts (connect.recording, rec.state), api/sessions.ts (ConsentTextView)}`, `fixtures/rec.json`, `fixtures/ws-device.json` eki                                                                                              |
| K3    | `apps/server/src/rec/{service,routes,repo,webm}.ts`, `fsrv/usage.ts`, `fsrv/tokens.ts` (yalnız yeni `kind` tipleri), `settings/recording.ts`, `sessions/history*` (alan + süzgeç), `app-routes.ts` kayıt                                                                                                                                     |
| K4    | `apps/server/src/signaling/{rec.ts, admit.ts, handlers.ts, ws.ts, admit-device.ts, rejoin-device.ts, types.ts}`, `unattended/connect*.ts`, `jobs/{retention-rec.ts, retention.ts, retention-fsrv.ts (reconcile), tenant-purge-repo.ts}`, anonimleştirme/purge repo, `cli` check-retire, `ops/metrics.ts`, `users/repo.ts deleteUserChildren` |
| K5    | `apps/agent-win/internal/{api, ui, signal, flow}` + `flow/messages_p28e.go` (istemci)                                                                                                                                                                                                                                                        |
| K6    | `apps/agent-win/internal/{servis, servis/helperio, unattended}` (servis + yardımcı)                                                                                                                                                                                                                                                          |
| K7    | `apps/web/{lib/rec/*, components/console/rec-indicator.tsx, components/consent/recording-consent.tsx, components/guest/share-strip.tsx, app/session/[token]/*, app/r/[ref]/web-request-form.tsx, app/(panel)/settings/recording/*, app/(panel)/history/**, proxy.ts (media-src), messages/tr.json, e2e/*}`, `DESIGN.md` ikon satırları       |
| K8    | `.github/workflows/*` (0.16.0), `docs/runbook.md` §28e, alarm kuralları, staging yayını                                                                                                                                                                                                                                                      |

## 14. Görev paketleri ve atama

Sıra: **K0 güvenlik tasarım turu ‖ K0s tarayıcı spike** → K1 → K2 → (K3 ‖ K4 ‖ K5 ‖ K6 ‖ K7) → K8 → (K9 qa ‖ güvenlik kod turu) → düzeltme →
K10 test-operatoru → K11 teknik-yazar. K5/K6/K7, K2 fikstürü (`fixtures/rec.json`) ve sözleşmesiyle mock üzerinden paralel çalışır. K3 ve K4
yalnız `rec/service.ts` arayüzünde buluşur: K3 servisi yazar, K4 signaling'den çağırır. Arayüz K2'de `rec/types.ts` olarak sabitlenir.

| Paket | Ajan                  | Bağımlı olduğu | Paralel mi     | İş                                                                                                                                                                                                                                                                                                                                                                      | AC                               |
| ----- | --------------------- | -------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| K0    | guvenlik              | bu belge       | K0s ile        | Tasarım turu: §10 T1–T14, ADR-0034                                                                                                                                                                                                                                                                                                                                      | 290                              |
| K0s   | frontend-dev          | —              | K0 ile         | Spike (Chromium, Edge, Firefox; Safari yalnız gözlem): 5 sn timeslice + 60 sn bölüm geçiş boşluğu (ms), çözünürlük/monitör değişimi, arka plan sekmesi, H.264 çözme + VP8 kodlama CPU, gerçek bit hızı 1080p, çok bölümlü MSE `timestampOffset` + seek. Sonuç `docs/implementation.md`. Bölüm geçiş boşluğu > 200 ms ise bölüm 5 dk yapılır (karar kapısı, mimar onayı) | 383, 384 (ön koşul)              |
| K1    | dba                   | K0             | —              | Migration §3, CHECK'ler, down/precheck, grants, db-notlari (silme sırası)                                                                                                                                                                                                                                                                                               | 380, 381, 386, 447               |
| K2    | backend-dev           | K1             | —              | Sözleşmeler §4–6, fikstürler, `rec/types.ts` arayüzü                                                                                                                                                                                                                                                                                                                    | 381, 385, 388, 404               |
| K3    | backend-dev           | K2             | K4, K5, K6, K7 | Parça yükleme/oynatma/silme/ayar uçları, `webm.ts`, kota, belirteçler, geçmiş alanları                                                                                                                                                                                                                                                                                  | 380, 383–386, 447, 450           |
| K4    | backend-dev           | K2             | K3, K5, K6, K7 | `signaling/rec.ts` kapıları, yayın, gözcü, admit/rejoin/admit-device/connect kancaları, politika kapatma, 03:30 + anonimleştirme + purge + mutabakat, check-retire, audit, metrik                                                                                                                                                                                       | 381, 382, 384, 386–388, 448, 450 |
| K5    | backend-dev (Go)      | K2             | K3, K4, K6, K7 | İstemci: kutu, `rec1`, `rec.consent/revoke`, gösterge + Kaydı durdur, mesaj tablosu                                                                                                                                                                                                                                                                                     | 381, 382                         |
| K6    | backend-dev (Go)      | K2             | K3, K4, K5, K7 | Servis/yardımcı: `record1`, `connect.recording`, diyalog satırı, gösterge eki, `rec.state`                                                                                                                                                                                                                                                                              | 448, 449                         |
| K7    | frontend-dev          | K2, K0s        | K3–K6          | §9 ekranları, kaydedici/yükleyici/oynatıcı, CSP, DESIGN.md, e2e + gerçek tarayıcı testi                                                                                                                                                                                                                                                                                 | 380–385, 447, 450                |
| K8    | devops                | K5, K6         | K3, K4, K7     | CI 0.16.0 derleme/imza adımı, runbook §28e (alarm, disk planı, anahtar emekliliği, kayıt sorgulama), staging yayını                                                                                                                                                                                                                                                     | §11                              |
| K9    | qa-denetci ‖ guvenlik | K1–K8          | birbiriyle     | AC/DoD + kod turu                                                                                                                                                                                                                                                                                                                                                       | tümü                             |
| K10   | test-operatoru        | K9 GEÇTİ       | —              | Web tarama + staging duman (kayıt → izle → sil); Windows elle listesi kullanıcıya                                                                                                                                                                                                                                                                                       | 382, 384, 385, 449               |
| K11   | teknik-yazar          | K10            | —              | Kılavuz (Admin: ayar, KVKK, saklama, izleme/silme; müşteri: rıza ve durdurma; gözetimsiz kayıt), DATASHEET açık beyan, api.md, CHANGELOG, PDF                                                                                                                                                                                                                           | 380, 386                         |

## 15. Kabul kriterleri eşlemesi

| AC     | Bileşen / uç                                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-375 | Konsol yalnız video izinden akış kurar (§7); `rec/webm.ts` ses izini reddeder; gerçek tarayıcı testi "ses izi 0"                                       |
| AC-380 | `tenant_settings.recording_*`, `GET/PUT /settings/recording`, `settings/recording/*`, audit `settings.recording`                                       |
| AC-381 | `ConsentTextView.recording`, `recording-consent.tsx`, Go onay ekranı, `rec.consent`, `session_consents(RECORDING, line_sha256)`                        |
| AC-382 | `rec.state` yayını (tüm teknisyenler + `rec1` misafir), `rec-indicator.tsx`, share-strip ve Go göstergesi, `rec.revoke`, 15 sn pay, yeniden rıza reddi |
| AC-383 | §7 kaydedici (5 sn parça), `PUT /rec/:rid/series/:s/parts/:p`, `box.ts` AES-256-GCM, `{tenantId}/` yolu                                                |
| AC-384 | Oran tavanı (§7), `offered` kota denetimi, parça TX'inde kota → `STOPPED{QUOTA}` + konsol uyarısı                                                      |
| AC-385 | `GET /sessions/:id/recording`, `POST …/view` (audit), `GET /rec/:rid/.../parts/:p` Bearer, MSE oynatıcı, indirme ucu yok, 404                          |
| AC-386 | `recExpire` 03:30, anonimleştirme, kalıcı silme sırası, firma silme, `DELETE /sessions/:id/recording`                                                  |
| AC-387 | Gözetimsiz odada `rec.consent` yok sayılır, `connect.recording` yalnız politika açıkken; tek kod yolu (entegrasyon + Go testi)                         |
| AC-388 | `RECORDING_AUDIT` (§11.1)                                                                                                                              |
| AC-447 | `tenant_settings.unattended_recording_*`, PUT ayar ucu (step-up + kutu), ana anahtar kapanınca kapanır                                                 |
| AC-448 | `connect` zinciri + `admit-device.ts` TX'i `basis=TENANT_POLICY`, gösterge eki, cihazda durdurma yok                                                   |
| AC-449 | `connect.recording` → `ConsentSpec.RecordingLine`, yardımcı diyalog satırı, satırsız "İzin ver" yok                                                    |
| AC-450 | Aynı uçlar ve kurallar; meta `consentMode/silentReason`, oynatıcı ve geçmişte görünür (e2e)                                                            |
| AC-404 | `sessions.view_recording` yalnız `permissions.ts`'te; yeni ekranlar AC-287; metinler `tr.json` + `messages_p28e.go`                                    |

## 16. Kararlar (K-P28e-n; mimar kararı, en sade ve güvenli seçenek)

| #         | Karar                                                                                                                                    | Gerekçe                                                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| K-P28e-1  | Kaydı teknisyen konsolu MediaRecorder ile alır; katılımlı, tarayıcı misafir ve gözetimsiz tek yolda (ADR-0034)                           | V48; görüntünün tek ortak alıcısı konsol; tek uygulama                                                                          |
| K-P28e-2  | Otorite sunucudur: durum, gösterge, parça kabulü, kota, tavan sunucu oda durumundan türer                                                | Kaydedici teknisyen kontrolünde; rıza geri alma ve kota istemciye bırakılamaz                                                   |
| K-P28e-3  | Rıza onay ekranındaki tek bileşende verilir, sunucuya admit sonrası `rec.consent` WS mesajıyla gider (REST join/talep şemaları değişmez) | Kod, bağlantı, talep ve web talep yolları için tek gönderim noktası; talep tablosunda rıza saklamak gerekmez                    |
| K-P28e-4  | WebM/VP8, 1,5 Mbit/s hedef, 5 sn parça, 60 sn bölüm; sunucu tavanı 1 GiB/sa, parça ≤ 2 MiB                                               | VP8 tüm hedef tarayıcılarda kodlanır/çözülür, CPU düşüktür; 2 MiB mevcut proxy sınırlarına sığar; ≤ 10 sn kayıp sözü korunur    |
| K-P28e-5  | Oynatma: MSE + Bearer `fetch` + parça dizini; `<video src>` ve `Range` yok                                                               | Belirteç URL'ye konmaz (P28b); MediaRecorder WebM'inde Cues yoktur; parça rastgele erişim birimidir; remux bağımlılığı gerekmez |
| K-P28e-6  | Her parça ayrı `.rsf` (P28b `box.ts`/`store.ts` değişmeden)                                                                              | `.rsf` başlığı plainSize ister; büyüyen dosyaya ekleme yapılamaz; kopya kod yok                                                 |
| K-P28e-7  | Göstergesi çizilemeyen kaynakta kayıt yok: `rec1`/`record1` bildirmeyen istemci/servis kaydedilmez                                       | Gizli kayıt olmaz (G-17, AC-294 kalıbı); eski istemci güvenli yöne düşer                                                        |
| K-P28e-8  | Parça gözcüsü 30 sn → `STOPPED{ERROR}`; teknisyen kopmasında kayıt açık kalır, dönünce yeni bölüm                                        | Bastırma görünür olur; kısa kopmalar kaydı bitirmez                                                                             |
| K-P28e-9  | `rec1` bildirmeyen konsol (Safari vb.) kaydedemez; kayıt `STOPPED{ERROR, unsupported}`, uyarı görünür                                    | Sessiz başarısızlık yerine görünür hata; destek matrisi kılavuzda                                                               |
| K-P28e-10 | Oturum başına tek kayıt; geri alma, kota, hata ya da politika kapanışı sonrası yeniden başlamaz                                          | AC-382 (geri alma); sadelik; kota sonrası tutarlı davranış                                                                      |
| K-P28e-11 | P28c/P28d bağımlılığı kaldırıldı: P28e tek teknisyenle kodlanır, `recorderOf(room)` genişleme noktasıdır; ses yapısal olarak kaydedilmez | Gereksinim §3 notu; P28d sesi gelse bile akışa yalnız video izi girer ve sunucu ses izini reddeder                              |
| K-P28e-12 | Kayıtlar 90 güne kadar yaşadığından anahtar emekliliği kayıt `key_ver`'ini sayar; rewrap yok                                             | P28b'nin "≤ 7 gün" varsayımı kayıtta geçerli değil                                                                              |
| K-P28e-13 | Kayıt yedeğe girmez                                                                                                                      | K-P28b-11 ve kullanıcı kararı S-P28-3; yedekten silinmiş kayıt geri gelmez                                                      |
| K-P28e-14 | Ayrı "Kayıtlar" sayfası yok; geçmiş listesinde rozet + süzgeç, detayda oynatıcı                                                          | Tek ekran ilkesi; AC-450 "kayıt listesi" geçmiş listesindeki süzgeçle karşılanır (V-PE-3)                                       |
| K-P28e-15 | Elle silme step-up istemez, onay diyaloğu ister (AC-386); `ACTIVE` kayıt silinemez                                                       | AC metni; yıkıcı işlem kalıbı                                                                                                   |

**Varsayımlar:** V-PE-1 `policy_off` stop nedeni (§6.5). V-PE-2 başlamayan kayıt `recording.start` fail. V-PE-3 "kayıt listesi" = geçmiş listesi
"Kayıtlı" süzgeci. V-PE-4 rıza zamanı = sunucunun `rec.consent`'i aldığı an (admit'ten ≤ 30 sn sonra), tıklama anı değil. V-PE-5 tarayıcı desteği:
Chrome/Edge/Firefox güncel sürüm; Safari'de kayıt alınmaz ve oynatma "desteklenmiyor" der.

## 17. Riskler ve açık noktalar

| #     | Risk                                                                                                              | Etki       | Önlem / sahip                                                                                                          |
| ----- | ----------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| R-PE1 | Kaydedici teknisyen kontrolünde: bastırma veya sahte içerik mümkün                                                | Orta       | Gözcü, stop audit, oynatıcıda boşluk; kılavuzda sınır açıkça yazılır (guvenlik + teknik-yazar)                         |
| R-PE2 | Teknisyen hattına sürekli ≈ 1,5 Mbit/s yükleme; zayıf hatta parça kaybı                                           | Orta       | 3 parçalık kuyruk, gözcü, K0s ölçümü; gerekirse hedef 1 Mbit/s (frontend-dev)                                          |
| R-PE3 | 60 sn bölüm geçişinde kısa boşluk/takılma; çözünürlük değişiminde MediaRecorder davranışı tarayıcıya göre değişir | Düşük–Orta | K0s karar kapısı (bölüm 5 dk'ya çıkarılabilir)                                                                         |
| R-PE4 | Disk büyümesi: 20 GB × tenant; yedeğe girmediği için disk kaybında kayıt da kaybolur                              | Orta       | Kota, %10 koruma, alarm, runbook disk planı (devops); kullanıcı kararıyla kabul                                        |
| R-PE5 | İzleyici ekran kaydı alabilir (indirme yok ama ekran yakalama engellenemez)                                       | Düşük      | `recording.view` audit, `view_recording` hassas yetki uyarısı (V54)                                                    |
| R-PE6 | Anahtar rotasyonu 90 gün beklemesi                                                                                | Düşük      | K-P28e-12, runbook                                                                                                     |
| R-PE7 | Tenant satırı kilidi: her parça `tenants FOR UPDATE` alır; çok eşzamanlı kayıtta bekleme                          | Düşük      | Dakikada 12 kısa TX/kayıt; metrik `rs_rec_part_total`; gerekirse kayıt satırı rezervasyonuna geçiş (genişleme noktası) |

Açık karar (mimar onayı K0s sonrası): bölüm süresi 60 sn ↔ 5 dk.
