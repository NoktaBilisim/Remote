# PT-K10 — sinyalizasyon + WS başları temizliği (backend-dev)

Tasarım: `docs/mimari-temizlik.md` §5 PT-K10 (+ §1–4). AC: `docs/gereksinimler.md` §10 (AC-320, AC-322, AC-324).
Davranış değişmez: WS kapanış kodları/nedenleri, mesaj sırası, audit eylem/alanları, metrik adları/etiketleri, hız kovaları aynen.
Yeni bağımlılık yok. Commit yapılmadı.

## Değişen / yeni dosyalar (hepsi görev listesinde)

| Dosya                                      | Önce → sonra (satır) | İş                                                                                                                                                                                                                            |
| ------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/lib/ws-upgrade.ts` (yeni) | — → 33               | İki WS başının 12 satırlık klonu: `jsonPeer`, `cookieValue`; ayrıca ortak `UpgradeReject` tipi ve `offeredProtocols` (subprotocol okuma)                                                                                      |
| `signaling/ws.ts`                          | 340 → 168            | `attachSignaling` 254 → 25 satır: `upgradeCtx` (kabul/IP/ctx), `roleOf`, `onUpgrade` (yönlendirici), `startTimers` (ping + yeniden doğrulama)                                                                                 |
| `signaling/ws-auth.ts` (yeni)              | — → 227              | Kimlik dalları: `techUpgrade` + `openTech`; `guestUpgrade` (cx 34) → `guestCredential`, `ticketGuest`, `reconnectGuest`, `auditReconnectConflict`, `openGuest`, `bindGuest`; `revalidateTech`                                 |
| `requests/ws.ts`                           | 247 → 281            | `requestChannels` 163 → 20: `requestUpgrade` + `requestSecret` + `rowGate` + `agentGate`, `openRequest`, `onRequestMessage`, `onRequestClose`, `panelUpgrade`                                                                 |
| `signaling/control.ts`                     | 624 → 267            | Teknisyen istekleri + misafir mesaj girişleri kaldı; `controlRefusal`/`monitorRefusal` ön koşul işlevleri (cx 18/17 → ≤ 15)                                                                                                   |
| `signaling/control-record.ts` (yeni)       | — → 166              | Ortak kayıt yardımcıları (onay+audit TX, sıralı kuyruk, `settleWithin`, `logFail`, `recordClose`, `closeState`, `auditBeforeForward`)                                                                                         |
| `signaling/control-grant.ts` (yeni)        | — → 136              | İzin: `onGranted` (56/cx 21 → `grantAllowed` + `grantFailed`), `onView` (+ `onDenied`)                                                                                                                                        |
| `signaling/control-revoke.ts` (yeni)       | — → 112              | Geri alma: `revokeControl`, `resetOnGuestGone`, `revokeOnTechChange`, `closeControlOnEnd`, `narrowCaps`                                                                                                                       |
| `signaling/collab.ts`                      | 279 → 217            | `handleFileMeta` 84/cx 21 → akış + `refuseFileMeta`                                                                                                                                                                           |
| `signaling/file-meta-store.ts` (yeni)      | — → 115              | `file.meta` DB/audit yolları: `recordFileMeta` (TX), `senderReportOnly`, `auditRateLimited`, `fileMatchKey`                                                                                                                   |
| `signaling/admit.ts`                       | 234 → 281            | `admitGuest` 81/cx 23 ve `admitRequestGuest` 91/cx 19 → `auditAdmit`, `admitConflict`, `codeMismatch`, `consumeLobbyGuest` (TX), `admitLost`, `activeTechPerms`, `consumeRequestGuest` (TX), `activateRequestGuest`, `capsOf` |
| `signaling/handlers.ts`                    | 243 → 266            | `onTechMessage` 58/cx 27 → `relayToGuest` + `techAction`; `onGuestMessage` 65/cx 22 → `guestAction` + `onShareState`                                                                                                          |
| `signaling/rooms.ts`                       | 416 → 417            | Yalnız import satırı (revoke işlevleri `control-revoke.ts`'ten)                                                                                                                                                               |

Ölçüm (`scripts/pt-olcum.sh` ile aynı ESLint kuralları: işlev > 40 satır, karmaşıklık > 15), görev dosyaları:
önce 23 uyarı → sonra **1** (`rooms.ts` `preAdmitGuest` 42 satır; görev listesinde yok, kesin sınır 60'ın altında, dokunulmadı).
jscpd (≥ 8 satır, ≥ 70 belirteç): `requests/ws.ts ↔ signaling/ws.ts` klonu giderildi; görev dosyalarında klon 0.

## Tasarımdan sapmalar / yorumlar (gerekçeli)

1. **Taşıma kuralı (§1-3) yorumu — `control.ts` geri alma işlevleri.** `revokeControl`, `resetOnGuestGone`,
   `revokeOnTechChange`, `closeControlOnEnd`, `narrowCaps` dışa açıktı ama yalnız `signaling/rooms.ts` (bu görevin
   dosyası) kullanıyordu; test veya başka modül import etmiyor. `control-revoke.ts`'e taşındı ve yalnız `rooms.ts`'in
   import satırı değişti. Kuralın amacı (görev listesi dışındaki import satırı değişmez) korunur. Testlerin import ettiği
   adlar (`handleControl*`, `handleMonitor*`, `handleEnvState`, `onShareMonitor`, `CONTROL_AUDIT_TIMEOUT_MS`) `control.ts`'te.
2. **`CONTROL_AUDIT_TIMEOUT_MS` yeniden dışa aktarım.** Sabit `control-record.ts`'te tanımlı (hem istek hem izin
   yolu kullanıyor; `control.ts` ↔ `control-grant.ts` döngüsü olmasın diye). Test `control.ts`'ten import ettiği için
   `control.ts`'te `export { CONTROL_AUDIT_TIMEOUT_MS } from "./control-record.ts"` var. Görevdeki tek yeniden dışa aktarım.
3. **Kullanılmayan export'lar kaldırıldı/taşındı:** `requests/ws.ts` `jsonPeer` ve `UpgradeReject` (import eden yoktu) →
   `lib/ws-upgrade.ts`; `signaling/ws.ts` `RECONNECT_CONFLICT_AUDIT_MS` → `ws-auth.ts` (export olarak, dışarıdan kullanan yok);
   `collab.ts` `FileMetaResult`, `Reporter`, `fileMatchKey`, `FILE_META_RATE_AUDIT_MS` → `file-meta-store.ts` (kullanıcıları
   yalnız signaling içi). `isCheckViolation`, `fileExtOf`, `FILE_META_*` kota sabitleri ve `QUALITY_*` `collab.ts`'te kaldı.
4. **Mekanik olmayan tek ayrıntı:** `handleMonitorRequest`'te `rooms.clock.now()` artık monitör doğrulama koşullarından
   önce okunuyor (aynı eşzamanlı blokta, araya `await` yok; ön koşul işlevine geçirilir). Sahte saatte değer aynı; gerçek
   saatte fark en çok mikrosaniye. Gözlemlenebilir davranış değişmez.
5. **`recordRevoked`** (`control-record.ts`): aynı `recordControl(rooms, room, "REVOKED", rec.source, rec.ctx, rec.actor,
rec.action, rec.extra)` çağrısının üç kopyası tek satırlık yardımcıya alındı; çağrılar ve sıra aynı.
6. **`rooms.ts` 417 satır** (> 300) bölünmedi: §5 PT-K10 iş sütununda yok, `Rooms` sınıf yöntemleri (bölmek sınıf
   yapısını değiştirir; "gereksiz soyutlama yok" ilkesi). §9 "dokunan böler" kuralı gereği P27/P28 bu dosyaya > 30 satır
   eklerse o paket böler.
7. Ek işlevlerde bağlam nesneleri (`UpgradeCtx` — ws-auth.ts; `Ctx`/`RequestSocket` — requests/ws.ts; `FileMetaWrite` —
   file-meta-store.ts) yalnız önceden kapanış (closure) değişkeni olan değerleri taşır; yeni durum yok.

## P27 / P28 için sınırlar

- Yeni bir WS bağlantı türü (ör. P27 gözetimsiz ajan) → `signaling/ws.ts` `roleOf` + `onUpgrade` dalı, kimlik `ws-auth.ts`'e
  yeni `*Upgrade` işlevi; ortak `UpgradeCtx.accept` aynı ping/metrik/hata dinleyicisini verir.
- Çoklu teknisyen (P28) → `ws-auth.ts` `techUpgrade`/`openTech`, `handlers.ts` `techAction`, kontrol yaşam döngüsü
  `control-grant.ts`/`control-revoke.ts` ayrı okunur.

## Doğrulama (2026-11-15, çalışma kopyası `pt-wip`)

| Adım                                                                                                                                    | Sonuç                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @remote/server typecheck`                                                                                                | Görev dosyalarında 0 hata. Koşu sırasında yalnız K9'un yarım `requests/create-*.ts` dosyalarında hata vardı (K9'un işi)                                                                                                                |
| `eslint src/signaling src/requests/ws.ts src/lib/ws-upgrade.ts`                                                                         | 0 hata                                                                                                                                                                                                                                 |
| `pnpm --filter @remote/server test` (unit)                                                                                              | 30 dosya, 434/434 geçti                                                                                                                                                                                                                |
| `pnpm --filter @remote/server test:int` (MySQL 8.4, `test-db.sh up`, `--max-connections=300`, konteyner `rs-pt-k10-*`, sonunda silindi) | 79 dosya, 796/796 geçti (server `pt-surface` rota anlık görüntüsü dahil, değişmedi)                                                                                                                                                    |
| `packages/contracts` `test/pt-surface.test.ts`                                                                                          | 4/4 geçti, anlık görüntü değişmedi                                                                                                                                                                                                     |
| Test listesi (`vitest list`, unit + entegrasyon) önce ↔ sonra                                                                           | 3389 = 3389, fark yok                                                                                                                                                                                                                  |
| Prettier                                                                                                                                | Yalnız değişen/yeni 13 dosyaya                                                                                                                                                                                                         |
| R-PT1 çağrı sayımı (görev dosyaları, HEAD ↔ çalışma kopyası)                                                                            | `writeAudit` 16=16, `metrics.inc` 52=52, kova (`hit`/`blockedFor`/`blocked`/`hitBlocked`) 11=11, log 17=17, `$transaction` 5=5; `.close(` 19→18 (birleştirilen `jsonPeer` klonu). Dizgi sabitleri (olay/eylem/neden) kümesi: kayıp yok |

## PT bulguları (düzeltilmedi, R-PT9)

- Yok.
