# Mimari — P32 Prod'da imzasız gözetimsiz servis, risk kabulüyle (AC-523..AC-532)

Tarih: 2026-11-20 · Durum: r1 (güvenlik tasarım turu bekliyor) · Dal: `p32-prod-imzasiz-gozetimsiz` · ADR-0042
Girdiler: `docs/gereksinimler.md` §15, `docs/mimari-p27.md` §4.5 / §8.1 (K-P27-3, K-P27-22), `docs/mimari-p29.md` K-P29-5
(AC-492), ADR-0028, ADR-0040, runbook §20, §27, §31. Sürüm: yalnız server + web imajı; Go servisi, istemci ve DB değişmez.

## 1. Özet ve kısıtlar

Kullanıcı kararı (2026-11-20): gözetimsiz servis prod'da imzasız çalışacak, risk kabul. Çözüm (tek yol): `UNATTENDED_MODE`'a
**ayrı bir değer** eklenir: `unsigned-accepted`. Bu değer:

- yalnız `DEPLOY_ENV ∈ {production, staging}` iken kabul edilir (staging = prod provası);
- **izinli SHA-256 listesi** (`UNATTENDED_SIGNED_SHA256`, adı tarihsel) ister; cihazın beyan ettiği SHA listede olmalı;
- listeyi elle değil `publish-servis.sh` doldurur; prod'da betik yalnız attestation'ı doğrulanmış Release (`vX.Y.Z`) kabul eder;
- "TEST" etiketlerini taşımaz; yerine açılış alarm logu, remote-watch BİLGİ satırı ve Super Admin bandı vardır.

Neden düz `unsigned` + bayrak değil (değerlendirilen öneri): bugün `mode === "unsigned"` üç yerde "TEST" anlamı taşır —
`connect.ts:209` ve `intervene.ts:126` gösterge metnine "TEST — imzasız" öneki koyar, `unattended-shell.tsx:43` "Gerçek müşteri
cihazı kaydetmeyin" bandını gösterir. Prod'da `unsigned`'ı açmak bu üç yerde `DEPLOY_ENV` dalı ister ve `production + unsigned →
açılış hatası` korkuluğunu (K-P27-22: staging `.env` kopyası) kaldırır. Ayrı değer: bu siteler **değişmez**, korkuluk kalır, mod
değerinin kendisi açık risk kabulüdür (ek bayrak gereksiz — iki anahtar, tek karar olurdu). Ayrıntı ADR-0042.

Kısıtlar ve dürüstlük notu: kapı cihaz **beyanına** dayanır (`gate.ts` başlığı, AC-297): değiştirilmiş ikili listedeki bir SHA'yı
beyan edebilir. Liste bu yüzden kimlik doğrulama değil, **kullanılabilirlik ve sürüm kapısıdır**: yanlış/staging/yerel derlemenin
prod'a bağlanmasını önler ve açıklı bir sürümü listeden çıkararak tek hamlede devre dışı bırakmayı sağlar. Bütünlük, attestation'lı
yayından (`publish-servis.sh`) ve P29 manifest imzasından (ADR-0040) gelir; cihaz güvenliği AC-273, 293..296'ya dayanır.
Authenticode'un sağlayacağı yayıncı doğrulaması ve SmartScreen/AV itibarı **yoktur** — kalan risk (§5, ADR-0042).

Değişmeyenler: migration yok, yeni uç yok, yeni yetki yok, Go/servis sürüm artışı yok, P29 manifest biçimi aynı.

## 2. Bileşenler ve akış

```mermaid
flowchart LR
  CI[agent-win.yml Release vX.Y.Z<br/>SHA256SUMS + attestation] -->|gh release download| OP[publish-servis.sh --tag<br/>operatör makinesi]
  OP -->|gh attestation verify| OP
  OP -->|scp + --apply| AP[apply: DEPLOY_ENV=production<br/>yalnız vX.Y.Z]
  AP --> VOL[(unattended_downloads)]
  AP --> ENV[.env: UNATTENDED_AGENT_SHA256<br/>+ UNATTENDED_SIGNED_SHA256 += sha]
  ENV --> SRV[server env.ts: unsigned-accepted<br/>liste dolu, AGENT_SHA listede]
  SRV --> GATE[gate.ts: sha ∈ liste]
  SRV --> MS[manifest-store: servis sha ∈ liste]
  GATE --> DEV[NoktaDestekServis cihazı<br/>device.auth beyanı]
  SRV --> LOG[açılış logu + alarm warn]
  LOG --> RW[remote-watch BİLGİ]
  SRV --> WEB[/unattended: SA bilgi bandı]
```

| Bileşen                                                                                         | Sorumluluk (P32 farkı)                                                                |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `packages/contracts/src/api/unattended.ts`                                                      | `UNATTENDED_MODES` += `"unsigned-accepted"`; `UNATTENDED_RISK_BANNER` metni; yorumlar |
| `apps/server/src/env.ts` `deployEnvRules`                                                       | §4.1 kuralları                                                                        |
| `apps/server/src/unattended/gate.ts`                                                            | `unsigned-accepted` → `list.has(sha)`; `status()` aynı biçim                          |
| `apps/server/src/update/wiring.ts`                                                              | liste kuralı `signed` **veya** `unsigned-accepted` modda zorlanır (AC-530)            |
| `apps/server/src/server.ts`                                                                     | açılışta bir kez `warn` alarm satırı (AC-527a)                                        |
| `registration.ts`, `connect.ts`                                                                 | audit `new_value`'ya `gateMode` (AC-528)                                              |
| `apps/web/app/(panel)/unattended/unattended-shell.tsx`, `device-badges.tsx`, `messages/tr.json` | SA bandı, rozet metni                                                                 |
| `deploy/agent/publish-servis.sh`                                                                | `apply` SHA'yı listeye ekler (AC-529)                                                 |
| `deploy/ops/remote-watch.sh`                                                                    | BİLGİ satırı (AC-527b)                                                                |

## 3. Veri modeli

Değişiklik yok. `unattended_devices.signed` / `binary_sha256` her `device.auth`'ta zaten güncellenir (`device-auth.ts`
`recordAuth`), bu yüzden P29 güncellemesinden sonraki ilk bağlantıda kapı yeni SHA'yı değerlendirir. Silme stratejisi değişmez.

## 4. Sözleşmeler

### 4.1 Env kuralları (`env.ts` `deployEnvRules`; mesajlar yalnız anahtar adı + kural)

| Koşul                                                                                | Sonuç                                                                                    |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `UNATTENDED_MODE=unsigned` ∧ `DEPLOY_ENV ≠ staging`                                  | hata (değişmez, K-P27-22)                                                                |
| `UNATTENDED_MODE=unsigned-accepted` ∧ `DEPLOY_ENV ∉ {production, staging}`           | hata "unsigned-accepted yalnız DEPLOY_ENV=production\|staging"                           |
| `UNATTENDED_MODE ∈ {signed, unsigned-accepted}` ∧ liste boş                          | hata "`UNATTENDED_SIGNED_SHA256`: signed/unsigned-accepted modda zorunlu"                |
| `UNATTENDED_MODE=unsigned-accepted` ∧ `UNATTENDED_AGENT_SHA256` dolu ∧ listede değil | hata "`UNATTENDED_AGENT_SHA256` izinli listede değil (publish-servis.sh ile yayınlayın)" |
| `UNATTENDED_MODE≠off` ∧ `DEPLOY_ENV` yok                                             | hata (değişmez)                                                                          |

Son kural `signed` için eklenmez (kapsam: `signed` hiç kullanılmadı; imza gelince ayrı karar). Liste en çok 20 öğe (regex'e üst
sınır; büyüme elle temizlenir, §8.3).

### 4.2 Kapı (`gate.ts`)

```
allows(d): off → false · unsigned → true · unsigned-accepted → list.has(d.sha256.toLowerCase()) · signed → d.signed ∧ list.has(…)
status(): { mode, available: mode !== "off" }
```

Reddetme yolları mevcut: kayıt 409 `UNATTENDED_DISABLED`, `device.auth` 4403 (`WS_DEVICE_CLOSE.GATE`), bağlantı 409
`UNATTENDED_DISABLED`, liste satırında `signatureOk=false` → Bağlan pasif (`service.ts` neden `unsigned`) + rozet.

### 4.3 REST / WS

Yeni uç yok. `GET /unattended/status` yanıtındaki `mode` alanı dördüncü değeri alabilir (sözleşme tipi `UnattendedMode` genişler;
web `ModeBanner` dışında bu alanı okuyan yok — `grep` ile doğrulandı). `/ws/device` protokolü aynı.

### 4.4 Gösterge metni

`connect.ts` / `intervene.ts` `test = gate.mode === "unsigned"` **aynen kalır** → `unsigned-accepted`'te önek yok (AC-526).

### 4.5 Audit (AC-528)

`UNATTENDED_AUDIT.DEVICE_REGISTERED` ve `CONNECT` satırlarının `new_value`'suna `gateMode: UnattendedMode` eklenir (her mod, başarılı
ve başarısız). `packages/contracts/src/audit.ts` yorumunda alan belgelenir. Audit ekranı alanı JSON ayrıntıda zaten gösterir; ek
etiket gerekmez. Mod değişimi için kalıcı kayıt yok (env değişimi panel işlemi değil; emsal `WHATSAPP_ALLOW_INSECURE_HTTP`).

### 4.6 P29 etkileşimi (AC-530)

`wiring.ts:38` `signedMode: { signed: env.UNATTENDED_MODE === "signed", … }` →
`{ signed: env.UNATTENDED_MODE === "signed" || env.UNATTENDED_MODE === "unsigned-accepted", … }` (alan adı ve `manifest-store`
mantığı değişmez; yorum "liste zorlanır" olarak güncellenir). Sonuç: servis manifesti `sha256` listede değilse sunulmaz →
servis listede olmayan bir sürüme güncellenip 4403'te kilitlenemez. Manifest `sha256 = UNATTENDED_AGENT_SHA256` zaten zorunlu ve
§4.1 bu SHA'nın listede olmasını garanti eder; iki kural birlikte "yayınlanan = izinli = sunulan" zincirini kapatır.
Not: P29 servis güncellemesinin prod'da açılması P29-K0s/K7 Windows maddelerine bağlıdır (implementation.md); P32 bunu
değiştirmez, §8.2 açılış sırasında ön koşul olarak denetlenir.

### 4.7 Web

- `ModeBanner`: `status.mode === "unsigned-accepted" && role === "SUPER_ADMIN"` → `Alert tone="info"` `testId="un-risk-banner"`
  metin `UNATTENDED_RISK_BANNER` = "Gözetimsiz servis kod imzasız çalışıyor (risk kabul, ADR-0042). Kurulumda Windows SmartScreen
  uyarısı görülebilir." Admin/User'a bant yok. `ShieldAlert` ikonu (lucide, mevcut). Token'lar DESIGN.md; iki tema; axe 0.
- `tr.json` `un.badge.unsigned`: "İmzasız" → "İzinli sürüm değil"; ipucu anahtarı `un.badge.unsignedHint` "Servisi güncelleyin ya
  da yeniden yayınlayın". Anahtar adı değişmez (test kimlikleri korunur).

## 5. Güvenlik tasarımı

Tehdit özeti (STRIDE; güvenlik ajanı S-P32-n verir):

| No  | Tehdit                                                            | Azaltım                                                                                                       | Kalan                                                   |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| T-1 | Sahte "NoktaDestekServis.exe" (imza yok → kullanıcı ayırt edemez) | indirme yalnız oturumlu panelden (Caddy public yolu yok), SHA panelde/runbook'ta, kayıt kodu zorunlu (AC-273) | Yüksek — kabul (R-P32-1)                                |
| T-2 | Yerel/staging derleme prod'a bağlanır                             | izinli liste + prod yayın kilidi (yalnız `vX.Y.Z` + attestation)                                              | beyan sahtelenebilir (kapı ≠ kimlik)                    |
| T-3 | Staging `.env` prod'a kopyalanır (`unsigned`)                     | K-P27-22 korunur: prod + `unsigned` açılış hatası                                                             | yok                                                     |
| T-4 | Operatör listeye elle rastgele SHA ekler                          | runbook: elle ekleme yasak, yalnız betik; §20.3 imzalı madde; `PUBLISHED.log` ile karşılaştırma               | root zaten her şeyi yapabilir                           |
| T-5 | Güncelleme listede olmayan sürüme götürür → kilit                 | §4.6 manifest kuralı                                                                                          | yok                                                     |
| T-6 | AV/EDR servisi siler/karantinaya alır                             | kılavuz: istisna Admin kararı; olay günlüğü                                                                   | operasyonel                                             |
| T-7 | Tek CI hesabı ele geçirilir (S-P29-T-1)                           | ADR-0040 sertleştirmeleri; Authenticode olmadığı için ikinci kapı yok                                         | Kritik — 2026-11-19'da kabul edilmişti; P32 genişletmez |

Hassas veri: yeni yok. Loglar SHA değeri yazmaz (yalnız `allowedCount`). Başlıklar/CSP değişmez. Risk kabul kaydı: ADR-0042
"Sonuçlar" + runbook §20.3 madde 16 (kullanıcı imzası).

## 6. Dosya/klasör planı

| Dosya                                                                                                                                                     | Değişiklik                                                            | Paket |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----- |
| `packages/contracts/src/api/unattended.ts`                                                                                                                | mod değeri, `UNATTENDED_RISK_BANNER`, yorumlar                        | K1    |
| `packages/contracts/src/audit.ts`                                                                                                                         | `gateMode` yorumu                                                     | K1    |
| `apps/server/src/env.ts`                                                                                                                                  | §4.1 + alan yorumları                                                 | K1    |
| `apps/server/src/unattended/gate.ts` (+ test)                                                                                                             | §4.2                                                                  | K1    |
| `apps/server/src/update/wiring.ts` (+ `manifest-store` testi)                                                                                             | §4.6                                                                  | K1    |
| `apps/server/src/server.ts`                                                                                                                               | alarm `warn`                                                          | K1    |
| `apps/server/src/unattended/{registration,connect}.ts`                                                                                                    | `gateMode` audit                                                      | K1    |
| `apps/server/test/integration/env-deploy.test.ts`, `unattended-*.test.ts`                                                                                 | AC-523..528, 530 testleri                                             | K1    |
| `apps/web/app/(panel)/unattended/{unattended-shell,device-badges}.tsx`, `apps/web/messages/tr.json`, `lib/unattended/*.test.ts`, `e2e/unattended.spec.ts` | §4.7                                                                  | K2    |
| `deploy/agent/publish-servis.sh`, `deploy/agent/test-publish-lock.sh`                                                                                     | §8.1                                                                  | K3    |
| `deploy/ops/remote-watch.sh` (+ betik testi)                                                                                                              | BİLGİ satırı                                                          | K3    |
| `.env.example`, `deploy/docker-compose.yml` (yalnız yorum)                                                                                                | mod açıklaması                                                        | K3    |
| `docs/runbook.md`                                                                                                                                         | §8.4'teki değişiklikler                                               | K3    |
| `docs/KULLANIM_KILAVUZU.md`, `CHANGELOG.md`, `docs/DATASHEET.md`, PDF                                                                                     | SmartScreen adımı, sürüm notu, güvenlik satırı ("servis kod imzasız") | K6    |

## 7. Performans ve ölçek

Etkisiz: kapı bir `Set` araması; liste ≤ 20.

## 8. Operasyon

### 8.1 `publish-servis.sh` (AC-529)

- Operatör tarafı değişmez: `--tag` attestation'sız kullanılamaz; `--no-attestation` yalnız `ALLOW_UNATTESTED=staging`.
- Sunucu tarafı `apply` değişmez kilit: `production` → yalnız `^v\d+\.\d+\.\d+$` etiketi (`dir-*`, `*-unattested` reddedilir).
- **Yeni:** `UNATTENDED_AGENT_SHA256` satırını yazdığı aynı `awk` geçişinde `UNATTENDED_SIGNED_SHA256` satırına SHA'yı ekler (yoksa
  satırı oluşturur; varsa ve listede yoksa `,<sha>` ekler; varsa dokunmaz). Tek `.env` yazımı, mevcut `.env.bak.servis.<ts>`
  yedeği. Tüm ortamlarda (staging `unsigned`'da liste yok sayılır — zararsız; staging provası için hazır olur). Liste 20'yi aşacaksa
  betik durur: "liste dolu — runbook §27.9 temizlik".
- `PUBLISHED.log` satırı aynı; temizlikte karşılaştırma kaynağıdır.
- `test-publish-lock.sh` yeni vakalar: prod+`v0.23.0` → listede tek satır; aynı SHA yeniden → tekrar yok; ikinci sürüm → iki öğe,
  sıra korunur; prod+`dir-*` → ret ve `.env` değişmedi; 20 dolu → ret.

### 8.2 Prod açılış sırası (runbook'a yazılacak, §8.4)

1. P32 imajı prod'da, `UNATTENDED_MODE=off` (bugünkü durum). Ön koşul: P29-K0s/K7 Windows maddeleri staging'de GEÇTİ (P29 servis
   güncellemesi için; değilse servis manifesti yayınlanmaz, elle güncelleme sürer).
2. Staging provası (test-operatoru): staging `.env` `UNATTENDED_MODE=unsigned-accepted` → AC-525..527 + SmartScreen duman → staging
   `unsigned`'a döner.
3. `deploy/agent/publish-servis.sh --tag vX.Y.Z --ssh root@<prod>` → ikili + `UNATTENDED_AGENT_SHA256` + liste.
4. `sed -i 's/^UNATTENDED_MODE=.*/UNATTENDED_MODE=unsigned-accepted/' .env && docker compose up -d --no-deps server` → healthy;
   `docker compose logs server --since 5m | grep -c unattended_unsigned_risk_accepted` → `1`.
5. (P29 açıksa) `publish-manifest.sh --tag vX.Y.Z` — manifest SHA listede olduğu için sunulur.
6. §20.3 madde 16 kullanıcı imzası; Windows VM duman: indir → SmartScreen "Ek bilgi → Yine de çalıştır" → kayıt → bağlan → bildirim
   e-postası → yerel kapat → iptal.

Geri alma: `UNATTENDED_MODE=off` → `up -d --no-deps server` (cihazlar 4403, kayıtlar silinmez; §27.6). İmaj geri alınırsa eski
`env.ts` `unsigned-accepted`'i tanımaz → açılış hatası; bu yüzden **önce `off`, sonra imaj** (runbook'a yazılır).

### 8.3 Liste temizliği (elle)

Panel → Gözetimsiz → sürüm dağılımında bir SHA'yı kullanan cihaz kalmayınca (ya da açıklı sürüm acil devre dışı) `.env`'den çıkarılır →
`up -d --no-deps server`. `UNATTENDED_AGENT_SHA256` listeden çıkarılamaz (açılış hatası, §4.1) — önce yeni sürüm yayınlanır.

### 8.4 Runbook değişiklikleri (K3 uygular; şimdi değiştirilmez)

| Yer                          | Değişiklik                                                                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Env tablosu satır ~99–100    | `UNATTENDED_MODE` += `unsigned-accepted` (prod risk kabul, ADR-0042); `UNATTENDED_SIGNED_SHA256` = "izinli servis SHA listesi (`signed`/`unsigned-accepted`); publish-servis.sh ekler, elle yalnız çıkarılır" |
| §27.1 tablo                  | Prod satırı: `unsigned-accepted`, liste = yayınlanmış Release SHA'ları, ikili `--tag` ile; kurallar paragrafı: `unsigned` hâlâ yalnız staging                                                                 |
| §27 yeni §27.9               | "Prod imzasız (risk kabul)": §8.2 sırası, §8.3 temizlik, elle ekleme yasağı, SmartScreen notu                                                                                                                 |
| §27.5 m.2                    | liste artık betikle dolar; `signed`'a geçişte yalnız mod değişir                                                                                                                                              |
| §27.8                        | yeni satırlar: "`unsigned-accepted yalnız DEPLOY_ENV=…`", "`UNATTENDED_AGENT_SHA256 izinli listede değil`", "cihaz rozeti 'İzinli sürüm değil'" → eylemler; R-P27-2 satırı "prod'da beklenen; kılavuz"        |
| §20.3                        | madde 16: risk kabul imzası (mod, liste = `PUBLISHED.log` Release satırları, alarm logu 1, SA bandı, SmartScreen duman)                                                                                       |
| §31.4 m.4                    | "`signed` ya da `unsigned-accepted` ise SHA'yı betik ekler; elle eklemeyin"                                                                                                                                   |
| §4063 civarı (P28 prod notu) | "prod'da `off`" → "§27.9"                                                                                                                                                                                     |
| Alarm tablosu (~§12)         | `alarm:"unattended_unsigned_risk_accepted"` = Bilgi (WhatsApp K13 satırı kalıbı)                                                                                                                              |

### 8.5 Log / metrik

Yeni metrik yok. remote-watch: `docker exec "$SERVER_C" printenv UNATTENDED_MODE` = `unsigned-accepted` → her turda
`log "BILGI check=unattended-unsigned-accepted gozetimsiz servis imzasiz (risk kabul, ADR-0042)"`; `fail`/`send` yok (offsite
`UYARI` satırı kalıbı).

## 9. Test stratejisi

| AC       | Seviye                                                          | Komut                                    |
| -------- | --------------------------------------------------------------- | ---------------------------------------- |
| 523, 524 | entegrasyon (`env-deploy.test.ts`)                              | `pnpm --filter @remote/server test`      |
| 525      | birim `gate.test.ts` + entegrasyon auth 4403                    | aynı                                     |
| 526      | birim (gösterge metni) + web birim `ModeBanner`                 | aynı + `pnpm --filter @remote/web test`  |
| 527      | server birim (log), web birim + e2e, `remote-watch` betik testi | + `pnpm --filter @remote/web e2e`        |
| 528      | entegrasyon (audit `gateMode`)                                  | server test                              |
| 529      | `deploy/agent/test-publish-lock.sh`                             | `bash deploy/agent/test-publish-lock.sh` |
| 530      | birim `manifest-store.test.ts`                                  | server test                              |
| 531      | web birim (rozet)                                               | web test                                 |
| 532      | qa doküman denetimi + staging provası (test-operatoru)          | elle, `docs/test-raporu.md`              |

Test adları AC numarasını içerir (`AC-523 …`).

## 10. Görev paketleri

| Paket | Ajan                             | Bağımlı olduğu                                                                          | Paralel mi |
| ----- | -------------------------------- | --------------------------------------------------------------------------------------- | ---------- |
| K0    | guvenlik (tasarım turu)          | bu doküman + ADR-0042                                                                   | — (önce)   |
| K1    | backend-dev                      | K0                                                                                      | ‖ K2, K3   |
| K2    | frontend-dev                     | K0 (K1 sözleşme satırı: `UNATTENDED_MODES`, `UNATTENDED_RISK_BANNER` — K1 ilk commit'i) | ‖ K1, K3   |
| K3    | devops                           | K0                                                                                      | ‖ K1, K2   |
| K4    | qa-denetci ‖ guvenlik (kod turu) | K1–K3                                                                                   | ‖          |
| K5    | test-operatoru                   | K4 GEÇTİ; staging `unsigned-accepted` provası (§8.2 m.2)                                | —          |
| K6    | teknik-yazar                     | K4                                                                                      | ‖ K5       |

dba paketi yok (migration yok).

## 11. AC eşlemesi

| AC  | Bileşen / uç                                                                                 | Paket      |
| --- | -------------------------------------------------------------------------------------------- | ---------- |
| 523 | `env.ts` `deployEnvRules`, contracts `UNATTENDED_MODES`                                      | K1         |
| 524 | `env.ts`                                                                                     | K1         |
| 525 | `gate.ts`, `device-auth.ts`, `registration.ts`, `connect.ts`, `service.ts` (mevcut çağrılar) | K1         |
| 526 | `connect.ts` / `intervene.ts` (değişmeden), `ModeBanner`                                     | K1, K2     |
| 527 | `server.ts`, `remote-watch.sh`, `ModeBanner`                                                 | K1, K3, K2 |
| 528 | `registration.ts`, `connect.ts`, `audit.ts`                                                  | K1         |
| 529 | `publish-servis.sh`, `test-publish-lock.sh`                                                  | K3         |
| 530 | `update/wiring.ts`, `manifest-store`                                                         | K1         |
| 531 | `device-badges.tsx`, `tr.json`                                                               | K2         |
| 532 | ADR-0042, runbook, kılavuz, CHANGELOG, DATASHEET                                             | K3, K6     |

## 12. Geçersiz kılınan / revize edilen ifadeler (birleşmede güncellenir)

| Yer                                                                                         | Eski                                | Yeni                                                                      |
| ------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------- |
| AC-297 r3 (`gereksinimler-kabul-kriterleri-e11-b.md`)                                       | prod'da imzasız beyanda kapalı      | r4: prod'da yalnız `unsigned-accepted` ile açık (§15)                     |
| AC-342, K-P27-3, K-P27-22 (`mimari-p27.md` §4.5, §8.1, §11)                                 | `unsigned` ⇔ staging; prod `off`    | `unsigned` ⇔ staging **korunur**; prod/staging ek mod `unsigned-accepted` |
| R25, R30 (`gereksinimler-e11.md`)                                                           | imza yoksa P27 prod'da kapalı       | risk kabul (R-P32-1); azaltım §5                                          |
| ADR-0028 m. imza kapısı, ADR-0010                                                           | imzasız yalnız staging              | ADR-0042                                                                  |
| ADR-0040 / mimari-p29 K-P29-5                                                               | liste yalnız `signed` kipte         | `signed` ∨ `unsigned-accepted`                                            |
| contracts `unattended.ts` yorumları, `.env.example` satır 146–156, compose satır 161 yorumu | "unsigned yalnız staging, prod off" | yeni mod açıklaması                                                       |
| runbook                                                                                     | §8.4 tablosu                        |                                                                           |

## 13. Açık kararlar (kullanıcıya; varsayılan uygulanır)

1. Müşteri ekranındaki göstergede "imzasız" ibaresi olsun mu? **Varsayılan: hayır** (gösterge `signed` ile aynı; imza müşteri
   için anlamlı bir uyarı değil, kurulumda zaten SmartScreen görülür).
2. "İmzasız (risk kabul)" bandını firma Admin'leri de görsün mü? **Varsayılan: yalnız Super Admin** (Admin'e kurulum notu
   kılavuzda).
