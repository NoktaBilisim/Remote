# Mimari — P32 Prod'da imzasız gözetimsiz servis, risk kabulüyle (AC-523..AC-533)

Tarih: 2026-11-20 · Durum: r2 (güvenlik tasarım turu S-P32-1..10 işlendi, §14) · Dal: `p32-prod-imzasiz-gozetimsiz` · ADR-0042
Girdiler: `docs/gereksinimler.md` §15, `docs/mimari-p27.md` §4.5 / §8.1 (K-P27-3, K-P27-22), `docs/mimari-p29.md` K-P29-5
(AC-492), ADR-0028, ADR-0040, runbook §20, §27, §31. Sürüm: yalnız server + web imajı; Go servisi, istemci ve DB değişmez.

## 1. Özet ve kısıtlar

Kullanıcı kararı (2026-11-20): gözetimsiz servis prod'da imzasız çalışacak, risk kabul. Çözüm (tek yol): `UNATTENDED_MODE`'a
**ayrı bir değer** eklenir: `unsigned-accepted`. Bu değer:

- yalnız `DEPLOY_ENV ∈ {production, staging}` iken kabul edilir (staging = prod provası);
- **izinli SHA-256 listesi** (`UNATTENDED_SIGNED_SHA256`, adı tarihsel) ister; cihazın beyan ettiği SHA listede olmalı;
- listeyi elle değil `publish-servis.sh` doldurur ve **tüm ortamlarda yalnız `vX.Y.Z` (attestation'lı Release)** SHA'sını ekler;
  prod'da betik zaten yalnız attestation'ı doğrulanmış Release kabul eder (S-P32-3);
- "TEST" etiketlerini taşımaz; yerine açılış alarm logu, remote-watch BİLGİ satırı + değişim/uyuşmazlık ALERT'i, Super Admin
  bandı ve müşteri mesajında doğrulama bilgisi (alan adı, dosya, sürüm, SHA; AC-533) vardır.

Neden düz `unsigned` + bayrak değil (değerlendirilen öneri): bugün `mode === "unsigned"` üç yerde "TEST" anlamı taşır —
`connect.ts:209` ve `intervene.ts:126` gösterge metnine "TEST — imzasız" öneki koyar, `unattended-shell.tsx:43` "Gerçek müşteri
cihazı kaydetmeyin" bandını gösterir. Prod'da `unsigned`'ı açmak bu üç yerde `DEPLOY_ENV` dalı ister ve `production + unsigned →
açılış hatası` korkuluğunu (K-P27-22: staging `.env` kopyası) kaldırır. Ayrı değer: bu siteler **değişmez**, korkuluk kalır, mod
değerinin kendisi açık risk kabulüdür (ek bayrak gereksiz — iki anahtar, tek karar olurdu). Ayrıntı ADR-0042.

Kısıtlar ve dürüstlük notu: kapı cihaz **beyanına** dayanır (`gate.ts` başlığı, AC-297): değiştirilmiş ikili listedeki bir SHA'yı
beyan edebilir. Liste bu yüzden kimlik doğrulama değil, **kullanılabilirlik ve sürüm kapısıdır**: yanlış/staging/yerel derlemenin
prod'a bağlanmasını önler ve açıklı bir sürümü listeden çıkararak devre dışı bırakmayı sağlar — bedeli: çıkarılan SHA'daki cihaz
P29 güncellemesini de alamaz (aynı soket), elle yeniden kurulum gerekir; bu yüzden geri çekme iki aşamalıdır (§8.3, S-P32-2). Bütünlük, attestation'lı
yayından (`publish-servis.sh`) ve P29 manifest imzasından (ADR-0040) gelir; cihaz güvenliği AC-273, 293..296'ya dayanır.
Authenticode'un sağlayacağı yayıncı doğrulaması ve SmartScreen/AV itibarı **yoktur** — kalan risk (§5, ADR-0042).

Değişmeyenler: migration yok, yeni uç yok, yeni yetki yok, Go/servis sürüm artışı yok, P29 manifest biçimi aynı. Yeni env: yalnız
`UNATTENDED_AGENT_VERSION` (betik yazar, §4.1, AC-533).

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
  LOG --> RW[remote-watch BİLGİ + ALERT<br/>liste↔PUBLISHED.log, DEPLOY_ENV, değişim]
  SRV --> WEB[/unattended: SA bilgi bandı]
```

| Bileşen                                                                                         | Sorumluluk (P32 farkı)                                                                |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `packages/contracts/src/api/unattended.ts`                                                      | `UNATTENDED_MODES` += `"unsigned-accepted"`; `UNATTENDED_RISK_BANNER` metni; yorumlar |
| `apps/server/src/env.ts` `deployEnvRules`                                                       | §4.1 kuralları                                                                        |
| `apps/server/src/unattended/gate.ts`                                                            | `unsigned-accepted` → `list.has(sha)`; `status()` aynı biçim                          |
| `apps/server/src/update/wiring.ts`                                                              | liste kuralı `signed` **veya** `unsigned-accepted` modda zorlanır (AC-530)            |
| `apps/server/src/server.ts`                                                                     | açılışta bir kez `warn` alarm satırı (AC-527a)                                        |
| `registration.ts`, `connect.ts`                                                                 | audit `new_value`'ya `gateMode`, `binarySha256` (+ connect'te `signed`) (AC-528)      |
| `apps/server/src/unattended/device-auth.ts`                                                     | gate ret audit'i + `warn`'a `sha256Prefix` (12 hane) (AC-527a, S-P32-4)               |
| `apps/server/src/notify/customer-templates.ts`, `customer-send/targets.ts`                      | kayıt kodu mesajında doğrulama bloğu (AC-533)                                         |
| `apps/web/app/(panel)/unattended/unattended-shell.tsx`, `device-badges.tsx`, `messages/tr.json` | SA bandı, rozet metni                                                                 |
| `deploy/agent/publish-servis.sh`                                                                | `apply` yalnız `vX.Y.Z` SHA'sını listeye ekler, sürümü yazar (AC-529)                 |
| `deploy/ops/remote-watch.sh`                                                                    | BİLGİ satırı; liste↔`PUBLISHED.log`, `DEPLOY_ENV`, değişim ALERT'i (AC-527b)          |

## 3. Veri modeli

Değişiklik yok. `unattended_devices.signed` / `binary_sha256` her `device.auth`'ta zaten güncellenir (`device-auth.ts`
`recordAuth`), bu yüzden P29 güncellemesinden sonraki ilk bağlantıda kapı yeni SHA'yı değerlendirir. Silme stratejisi değişmez.

## 4. Sözleşmeler

### 4.1 Env kuralları (`env.ts` `deployEnvRules`; mesajlar yalnız anahtar adı + kural)

| Koşul                                                                                                | Sonuç                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNATTENDED_MODE=unsigned` ∧ `DEPLOY_ENV ≠ staging`                                                  | hata (değişmez, K-P27-22)                                                                                                                                       |
| `UNATTENDED_MODE=unsigned-accepted` ∧ `DEPLOY_ENV ∉ {production, staging}`                           | hata "unsigned-accepted yalnız DEPLOY_ENV=production\|staging"                                                                                                  |
| `UNATTENDED_MODE ∈ {signed, unsigned-accepted}` ∧ liste boş                                          | hata "`UNATTENDED_SIGNED_SHA256`: signed/unsigned-accepted modda zorunlu"                                                                                       |
| `UNATTENDED_MODE=unsigned-accepted` ∧ `UNATTENDED_AGENT_SHA256` dolu ∧ listede değil                 | hata "`UNATTENDED_AGENT_SHA256` izinli listede değil (publish-servis.sh ile yayınlayın)"                                                                        |
| `UNATTENDED_MODE=unsigned-accepted` ∧ `UNATTENDED_AGENT_SHA256` ya da `UNATTENDED_AGENT_VERSION` boş | hata "unsigned-accepted modda `UNATTENDED_AGENT_SHA256` ve `UNATTENDED_AGENT_VERSION` zorunlu (publish-servis.sh --tag)" (AC-533: mesajda boş SHA/sürüm olamaz) |
| `UNATTENDED_SIGNED_SHA256` > 20 öğe                                                                  | hata (regex/refine üst sınırı; bugün sınırsız `env.ts:235`, S-P32-6)                                                                                            |
| `UNATTENDED_MODE≠off` ∧ `DEPLOY_ENV` yok                                                             | hata (değişmez)                                                                                                                                                 |

"İzinli listede değil" ve "SHA/sürüm zorunlu" kuralları `signed` için eklenmez (kapsam: `signed` hiç kullanılmadı; imza gelince
ayrı karar). Liste en çok 20 öğe (env.ts'te zorlanır; betik 16'da uyarır, 20'de durur; §8.3).
`UNATTENDED_AGENT_VERSION`: `^\d+\.\d+\.\d+$`, isteğe bağlı (diğer modlarda boşsa mesajda sürüm satırı yazılmaz). Yeni env kuralı
gereği `.env.example` (boş) + `env.ts` + `deploy/docker-compose.yml` server servisi + runbook env tablosu (K1/K3).

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

`UNATTENDED_AUDIT.DEVICE_REGISTERED` ve `CONNECT` satırlarının `new_value`'suna `gateMode: UnattendedMode` ve `binarySha256` (tam 64
hane, cihazın o anki beyanı) eklenir; `CONNECT`'e ayrıca `signed` beyanı (her mod, başarılı ve başarısız). `device-auth.ts` gate ret
audit'i (`reason=gate`) ve `warn` logu `{deviceId, tenantId, sha256Prefix}` (ilk 12 hane) taşır; mevcut log kalıbına göre hız
sınırlı (S-P32-4). Gerekçe: cihaz satırı yalnız son beyanı tutar (`device-auth.ts:95` üzerine yazar); geriye dönük iz audit'tedir. `packages/contracts/src/audit.ts` yorumunda alan belgelenir. Audit ekranı alanı JSON ayrıntıda zaten gösterir; ek
etiket gerekmez. Mod değişimi için kalıcı kayıt yok (env değişimi panel işlemi değil; emsal `WHATSAPP_ALLOW_INSECURE_HTTP`); değişim remote-watch
ALERT'i ile bildirilir (§8.5, S-P32-5).

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
- Admin kurulum notu (S-P32-8; bant değil): kayıt kodu/indirme diyaloğunda `status.mode === "unsigned-accepted"` iken tek satır
  "Windows 'Bilinmeyen yayıncı' gösterebilir; SHA-256: <ilk 8>…<son 8>". SHA kaynağı diyaloğun mevcut kayıt kodu yanıtı; yoksa
  K2 sözleşmede ekler (yeni uç yok).

### 4.8 Müşteri bağlantı mesajı (AC-533, S-P32-1)

Karar (varsayılan, §13 m.3): AC-419 oturumsuz indirme bağlantısı `unsigned-accepted`'te **kapanmaz**, sertleşir. `customer-templates.ts`
`unattendedMail` ve `unattendedShort` (SMS/WhatsApp) **mod bağımsız** aynı doğrulama bloğunu taşır (tek şablon; sadelik ilkesi):

```
Yalnız <host> adresinden indirin. Dosya: NoktaDestekServis.exe · Sürüm: <X.Y.Z> · SHA-256: <ilk8>…<son8>
Size başka yoldan gönderilen dosyayı çalıştırmayın.
```

- `<host>` = `PUBLIC_BASE_URL` alan adı (`targets.ts` `publicBaseUrl`'den; tam kanonik ad, port varsa dahil). Sürüm
  `UNATTENDED_AGENT_VERSION` (boşsa "Sürüm" parçası yazılmaz; `unsigned-accepted`'te boş olamaz, §4.1). E-posta tam 64 haneyi de
  korur (bugünkü satır); kısa mesaj kısaltmayı kullanır.
- `UnattendedTemplateInput` += `host`, `version?`; `targets.ts` `TargetDeps` += `unattendedVersion`.
- Mevcut şablon testleri değişir (yeni satırlar); yeni test: `AC-533` adlı vakalar — mail ve kısa mesajda host, dosya adı, sürüm,
  SHA kısaltması ve uyarı cümlesi var; sürüm boşken parça yok.
- Alternatif (kullanıcı isterse): `unsigned-accepted`'te `UNATTENDED_CODE` gönderimi 409; yalnız oturumlu indirme kalır.

## 5. Güvenlik tasarımı

Tehdit özeti (STRIDE; güvenlik ajanı S-P32-n verir):

| No  | Tehdit                                                            | Azaltım                                                                                                                                                                                                                                                                                                                                               | Kalan                                                                                           |
| --- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| T-1 | Sahte "NoktaDestekServis.exe" (imza yok → kullanıcı ayırt edemez) | indirme oturumlu panelden **ve** AC-419 bağlantısıyla (oturumsuz; kayıt koduna bağlı, kod kullanılana/süresi dolana dek geçerli belirteç); `/downloads` Caddy public yolu yok; mesajda alan adı + dosya + sürüm + SHA ve "başka yoldan geleni çalıştırmayın" (AC-533); kılavuzda `Get-FileHash` karşılaştırması (AC-532); kayıt kodu zorunlu (AC-273) | Yüksek — kabul (R-P32-1); benzer alan adıyla oltalama SHA kontrolünü yapmayan kullanıcıda kalır |
| T-2 | Yerel/staging derleme prod'a bağlanır                             | izinli liste (tüm ortamlarda yalnız `vX.Y.Z` SHA'sı) + prod yayın kilidi (attestation)                                                                                                                                                                                                                                                                | beyan sahtelenebilir (kapı ≠ kimlik)                                                            |
| T-3 | Staging `.env` prod'a kopyalanır (`unsigned`)                     | K-P27-22 korunur: prod + `unsigned` açılış hatası; `DEPLOY_ENV` ≠ beklenen ortam → remote-watch ALERT (S-P32-3)                                                                                                                                                                                                                                       | tüm `.env` kopyası (`DEPLOY_ENV=staging` ile) açılır; ALERT ≤ 1 tur (10 dk) içinde              |
| T-4 | Operatör listeye elle rastgele SHA ekler                          | runbook: elle ekleme yasak, yalnız betik; §20.3 imzalı madde; remote-watch her turda liste ↔ `PUBLISHED.log` `v*` satırları, eşleşmeyen → ALERT; liste değişimi → tek seferlik ALERT                                                                                                                                                                  | root `PUBLISHED.log`'u da yazabilir                                                             |
| T-5 | Güncelleme listede olmayan sürüme götürür → kilit                 | §4.6 manifest kuralı                                                                                                                                                                                                                                                                                                                                  | yok                                                                                             |
| T-6 | AV/EDR servisi siler/karantinaya alır                             | kılavuz: istisna Admin kararı, **dosya özeti (SHA-256) ya da tam yol + özet** ile, klasör joker değil; her sürümde yenilenir (S-P32-8)                                                                                                                                                                                                                | operasyonel                                                                                     |
| T-7 | Tek CI hesabı ele geçirilir (S-P29-T-1)                           | ADR-0040 sertleştirmeleri; `v*` ruleset + `agent-release` ortamı `gh api` kanıtı §20.3 m.16 (S-P32-10); Authenticode olmadığı için ikinci kapı yok                                                                                                                                                                                                    | Kritik — 2026-11-19'da kabul edilmişti; P32 genişletmez                                         |
| T-8 | Açıklı sürüm listede tutulur (geri çekme bedeli)                  | iki aşamalı geri çekme (§8.3)                                                                                                                                                                                                                                                                                                                         | aşama 1 süresince açıklı sürüm bağlanır                                                         |

Hassas veri: yeni yok. SHA-256 gizli değildir (yayınlanan ikilinin herkese açık özeti): audit tam SHA, ret logu ilk 12 hane, açılış
alarmı `allowedCount` + `listFingerprint` (sıralı listenin `,` ile birleşiminin SHA-256'sının ilk 12 hanesi) yazar. Token, kayıt kodu
ve indirme belirteci yazılmaz (değişmez). Başlıklar/CSP değişmez. Risk kabul kaydı: ADR-0042
"Sonuçlar" + runbook §20.3 madde 16 (kullanıcı imzası).

## 6. Dosya/klasör planı

| Dosya                                                                                                                                                     | Değişiklik                                                                                | Paket |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----- |
| `packages/contracts/src/api/unattended.ts`                                                                                                                | mod değeri, `UNATTENDED_RISK_BANNER`, yorumlar                                            | K1    |
| `packages/contracts/src/audit.ts`                                                                                                                         | `gateMode` yorumu                                                                         | K1    |
| `apps/server/src/env.ts`                                                                                                                                  | §4.1 + alan yorumları                                                                     | K1    |
| `apps/server/src/unattended/gate.ts` (+ test)                                                                                                             | §4.2                                                                                      | K1    |
| `apps/server/src/update/wiring.ts` (+ `manifest-store` testi)                                                                                             | §4.6                                                                                      | K1    |
| `apps/server/src/server.ts`                                                                                                                               | alarm `warn`                                                                              | K1    |
| `apps/server/src/unattended/{registration,connect,device-auth}.ts`                                                                                        | `gateMode`/`binarySha256` audit, ret `sha256Prefix`                                       | K1    |
| `apps/server/src/notify/customer-templates.ts` (+ test), `apps/server/src/customer-send/targets.ts`, `app-routes.ts`/wiring (deps)                        | §4.8 doğrulama bloğu (AC-533)                                                             | K1    |
| `apps/server/test/integration/env-deploy.test.ts`, `unattended-*.test.ts`                                                                                 | AC-523..528, 530, 533 testleri                                                            | K1    |
| `apps/web/app/(panel)/unattended/{unattended-shell,device-badges}.tsx`, `apps/web/messages/tr.json`, `lib/unattended/*.test.ts`, `e2e/unattended.spec.ts` | §4.7                                                                                      | K2    |
| `deploy/agent/publish-servis.sh`, `deploy/agent/test-publish-lock.sh`                                                                                     | §8.1                                                                                      | K3    |
| `deploy/ops/remote-watch.sh` (+ betik testi)                                                                                                              | §8.5 (BİLGİ, liste/`DEPLOY_ENV`/değişim ALERT'leri, `WATCH_DEPLOY_ENV`)                   | K3    |
| `.env.example`, `deploy/docker-compose.yml`                                                                                                               | mod açıklaması; `UNATTENDED_AGENT_VERSION` (boş) + server servisine                       | K3    |
| `docs/runbook.md`                                                                                                                                         | §8.4'teki değişiklikler                                                                   | K3    |
| `docs/KULLANIM_KILAVUZU.md`, `CHANGELOG.md`, `docs/DATASHEET.md`, PDF                                                                                     | SmartScreen öncesi `Get-FileHash` adımı, AV istisnası özetle, sürüm notu, güvenlik satırı | K6    |
| indirme sayfası/diyaloğu (`apps/web/app/(panel)/unattended/*`)                                                                                            | Admin kurulum notu + SHA kısaltması (§4.7)                                                | K2    |

## 7. Performans ve ölçek

Etkisiz: kapı bir `Set` araması; liste ≤ 20.

## 8. Operasyon

### 8.1 `publish-servis.sh` (AC-529)

- Operatör tarafı değişmez: `--tag` attestation'sız kullanılamaz; `--no-attestation` yalnız `ALLOW_UNATTESTED=staging`.
- Sunucu tarafı `apply` değişmez kilit: `production` → yalnız `^v\d+\.\d+\.\d+$` etiketi (`dir-*`, `*-unattested` reddedilir).
- **Yeni:** `UNATTENDED_AGENT_SHA256` satırını yazdığı aynı `awk` geçişinde, **etiket `^v[0-9]+\.[0-9]+\.[0-9]+$` ise** (tüm
  ortamlarda) `UNATTENDED_SIGNED_SHA256` satırına SHA'yı ekler (yoksa satırı oluşturur; varsa ve listede yoksa `,<sha>` ekler; varsa
  dokunmaz) ve `UNATTENDED_AGENT_VERSION=X.Y.Z` yazar. `dir-*` / `*-unattested` (yalnız staging) `UNATTENDED_AGENT_SHA256` yazar,
  listeye eklemez, `UNATTENDED_AGENT_VERSION`'ı boşaltır (S-P32-3). Tek `.env` yazımı; geçici dosya `umask 077`, yedek
  `.env.bak.servis.<ts>` `chmod 600`, son 10 yedek tutulur (S-P32-9). Liste 16 öğeye ulaşınca uyarı; 20'yi aşacaksa betik durur:
  "liste dolu — runbook §27.9 acil yol" (S-P32-6).
- `PUBLISHED.log` satırı aynı; temizlikte karşılaştırma kaynağıdır.
- `test-publish-lock.sh` yeni vakalar: prod+`v0.23.0` → listede tek satır + `UNATTENDED_AGENT_VERSION=0.23.0`; aynı SHA yeniden →
  tekrar yok; ikinci sürüm → iki öğe, sıra korunur; prod+`dir-*` → ret ve `.env` değişmedi; **staging+`dir-*` → liste değişmedi**;
  16 → uyarı; 20 dolu → ret; geçici dosya ve yedek kipi 600.

### 8.2 Prod açılış sırası (runbook'a yazılacak, §8.4)

1. P32 imajı prod'da, `UNATTENDED_MODE=off` (bugünkü durum). Ön koşul: P29-K0s/K7 Windows maddeleri staging'de GEÇTİ (P29 servis
   güncellemesi için; değilse servis manifesti yayınlanmaz, elle güncelleme sürer).
2. Staging provası (test-operatoru): önce `publish-servis.sh --tag vX.Y.Z` (yalnız Release listeye girer; `dir-*` ile §4.1 açılışı
   durdurur) → staging `.env` `UNATTENDED_MODE=unsigned-accepted` → AC-525..527, 533 + `Get-FileHash` + SmartScreen duman → staging
   `unsigned`'a döner.
3. `deploy/agent/publish-servis.sh --tag vX.Y.Z --ssh root@<prod>` → ikili + `UNATTENDED_AGENT_SHA256` + liste.
4. `sed -i 's/^UNATTENDED_MODE=.*/UNATTENDED_MODE=unsigned-accepted/' .env && docker compose up -d --no-deps server` → healthy;
   `docker compose logs server --since 5m | grep -c unattended_unsigned_risk_accepted` → `1`.
5. (P29 açıksa) `publish-manifest.sh --tag vX.Y.Z` — manifest SHA listede olduğu için sunulur.
6. §20.3 madde 16 kullanıcı imzası; Windows VM duman: indir → SmartScreen "Ek bilgi → Yine de çalıştır" → kayıt → bağlan → bildirim
   e-postası → yerel kapat → iptal.

Geri alma: `UNATTENDED_MODE=off` → `up -d --no-deps server` (cihazlar 4403, kayıtlar silinmez; §27.6). İmaj geri alınırsa eski
`env.ts` `unsigned-accepted`'i tanımaz → açılış hatası; bu yüzden **önce `off`, sonra imaj**. Bu ön koşul §27.9'a ek olarak runbook'un
**genel** imaj geri alma adımına da yazılır ve komutun yanına `grep -q '^UNATTENDED_MODE=unsigned-accepted' .env && echo DUR` konur
(S-P32-7).

### 8.3 Liste temizliği (elle)

Panel → Gözetimsiz → sürüm dağılımında bir SHA'yı kullanan cihaz kalmayınca `.env`'den çıkarılır → `up -d --no-deps server`.
`UNATTENDED_AGENT_SHA256` listeden çıkarılamaz (açılış hatası, §4.1) — önce yeni sürüm yayınlanır.

Açıklı sürümün geri çekilmesi **iki aşamalıdır** (S-P32-2; listeden çıkarılan SHA'daki cihaz 4403 alır ve P29 güncelleme teklifini
de alamaz → elle yeniden kurulum):

1. Olağan: düzeltilmiş sürüm `--tag` ile yayınlanır, manifest sunulur; sürüm dağılımında (`rs_unattended_agent_versions`, sürüm bazlı;
   sürüm↔SHA eşlemesi `PUBLISHED.log`) eski sürüm 0'a iner ya da en çok N=7 gün beklenir; ardından SHA çıkarılır.
2. Aktif istismar: SHA hemen çıkarılır, etkilenen cihazlarda elle yeniden kurulum kabul edilir (Admin'lere duyuru).

Acil yol (liste dolu, S-P32-6): önce kullanımı 0 olan en eski SHA çıkarılır, sonra yayınlanır.

### 8.4 Runbook değişiklikleri (K3 uygular; şimdi değiştirilmez)

| Yer                           | Değişiklik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Env tablosu satır ~99–100     | `UNATTENDED_MODE` += `unsigned-accepted` (prod risk kabul, ADR-0042); `UNATTENDED_SIGNED_SHA256` = "izinli servis SHA listesi (`signed`/`unsigned-accepted`); publish-servis.sh yalnız `vX.Y.Z` ekler, elle yalnız çıkarılır, ≤ 20"; yeni `UNATTENDED_AGENT_VERSION` (betik yazar; mesajda sürüm)                                                                                                                                                                                                                                                                                |
| §27.1 tablo                   | Prod satırı: `unsigned-accepted`, liste = yayınlanmış Release SHA'ları, ikili `--tag` ile; kurallar paragrafı: `unsigned` hâlâ yalnız staging                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| §27 yeni §27.9                | "Prod imzasız (risk kabul)": §8.2 sırası, §8.3 temizlik + **iki aşamalı geri çekme** + acil yol, elle ekleme yasağı, `Get-FileHash` + SmartScreen notu, `.env.bak.servis.*` 600 / son 10                                                                                                                                                                                                                                                                                                                                                                                         |
| Genel geri alma (rollback)    | ön koşul "`UNATTENDED_MODE=unsigned-accepted` ise önce `off`" + `grep … && echo DUR` denetimi (S-P32-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| remote-watch kurulumu (§20.4) | `WATCH_DEPLOY_ENV` (beklenen ortam: `production`/`staging`) `watch.env`'e; boşsa kontrol `ATLANDI` satırı yazar                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| §27.5 m.2                     | liste artık betikle dolar; `signed`'a geçişte yalnız mod değişir                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| §27.8                         | yeni satırlar: "`unsigned-accepted yalnız DEPLOY_ENV=…`", "`UNATTENDED_AGENT_SHA256 izinli listede değil`", "cihaz rozeti 'İzinli sürüm değil'" → eylemler; R-P27-2 satırı "prod'da beklenen; kılavuz"                                                                                                                                                                                                                                                                                                                                                                           |
| §20.3                         | madde 16: risk kabul imzası (mod, liste = `PUBLISHED.log` Release satırları, alarm logu 1 + `listFingerprint`, SA bandı, AC-533 mesaj örneği, `Get-FileHash` + SmartScreen duman, iki aşamalı geri çekme bedeli) + **kanıt:** `gh api repos/NoktaBilisim/Remote/rulesets` (ve ayrıntı `rulesets/<id>`) çıktısında `v*` etiket kuralı etkin, oluşturma yalnız yönetici, silme ve yeniden yazma (`non_fast_forward`/`update`) yasak, bypass listesi boş; `gh api repos/NoktaBilisim/Remote/environments/agent-release` → `can_admins_bypass=false` + gerekli onaylayıcı (S-P32-10) |
| §31.4 m.4                     | "`signed` ya da `unsigned-accepted` ise SHA'yı betik ekler; elle eklemeyin"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| §4063 civarı (P28 prod notu)  | "prod'da `off`" → "§27.9"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Alarm tablosu (~§12)          | `alarm:"unattended_unsigned_risk_accepted"` = Bilgi (WhatsApp K13 satırı kalıbı); remote-watch `unattended-list-unpublished`, `unattended-deploy-env`, `unattended-mode-changed` = ALERT (§8.5)                                                                                                                                                                                                                                                                                                                                                                                  |

### 8.5 Log / metrik

Yeni metrik yok. remote-watch (`docker exec "$SERVER_C" printenv …`):

- `UNATTENDED_MODE` = `unsigned-accepted` → her turda `log "BILGI check=unattended-unsigned-accepted gozetimsiz servis imzasiz (risk
kabul, ADR-0042)"`; durum OK (offsite `UYARI` satırı kalıbı). Liste ≥ 16 öğe → BİLGİ "liste dolmak üzere".
- `check=unattended-list-unpublished` (mod `signed`/`unsigned-accepted`): listedeki her SHA için `$DEPLOY_DIR/agent/PUBLISHED.log`'da
  `servis v<X.Y.Z> <sha>` satırı aranır; eşleşmeyen → **ALERT** (yalnız SHA'nın ilk 12 hanesi).
- `check=unattended-deploy-env`: `DEPLOY_ENV` ≠ `WATCH_DEPLOY_ENV` → **ALERT** (her iki değer; sır değil). `WATCH_DEPLOY_ENV` boşsa
  `ATLANDI` satırı.
- `check=unattended-mode-changed`: durum dosyası `$BASE_STATE/unattended.state` (`UNATTENDED_MODE`, `listFingerprint`); değişimde
  **bir kez** ALERT "gözetimsiz mod/liste değişti: eski → yeni", sonra sessiz. İlk koşuda yalnız durum yazılır.
- Betik testi: her kontrol için geçen/kalan vakası + değişim tek ALERT + ikinci turda sessizlik (S-P32-5).

## 9. Test stratejisi

| AC       | Seviye                                                                                              | Komut                                    |
| -------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 523, 524 | entegrasyon (`env-deploy.test.ts`)                                                                  | `pnpm --filter @remote/server test`      |
| 525      | birim `gate.test.ts` + entegrasyon auth 4403                                                        | aynı                                     |
| 526      | birim (gösterge metni) + web birim `ModeBanner`                                                     | aynı + `pnpm --filter @remote/web test`  |
| 527      | server birim (log), web birim + e2e, `remote-watch` betik testi                                     | + `pnpm --filter @remote/web e2e`        |
| 528      | entegrasyon (audit `gateMode`, `binarySha256`, ret `sha256Prefix`)                                  | server test                              |
| 529      | `deploy/agent/test-publish-lock.sh`                                                                 | `bash deploy/agent/test-publish-lock.sh` |
| 530      | birim `manifest-store.test.ts`                                                                      | server test                              |
| 531      | web birim (rozet)                                                                                   | web test                                 |
| 532      | qa doküman denetimi + staging provası (test-operatoru)                                              | elle, `docs/test-raporu.md`              |
| 533      | birim `customer-templates.test.ts` + entegrasyon (gönderim önizlemesi) + env-deploy (sürüm zorunlu) | server test                              |

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

| AC  | Bileşen / uç                                                                                      | Paket      |
| --- | ------------------------------------------------------------------------------------------------- | ---------- |
| 523 | `env.ts` `deployEnvRules`, contracts `UNATTENDED_MODES`                                           | K1         |
| 524 | `env.ts`                                                                                          | K1         |
| 525 | `gate.ts`, `device-auth.ts`, `registration.ts`, `connect.ts`, `service.ts` (mevcut çağrılar)      | K1         |
| 526 | `connect.ts` / `intervene.ts` (değişmeden), `ModeBanner`                                          | K1, K2     |
| 527 | `server.ts`, `device-auth.ts` (ret logu), `remote-watch.sh`, `ModeBanner`                         | K1, K3, K2 |
| 528 | `registration.ts`, `connect.ts`, `device-auth.ts`, `audit.ts`                                     | K1         |
| 529 | `publish-servis.sh`, `test-publish-lock.sh`                                                       | K3         |
| 530 | `update/wiring.ts`, `manifest-store`                                                              | K1         |
| 531 | `device-badges.tsx`, `tr.json`                                                                    | K2         |
| 532 | ADR-0042, runbook, kılavuz, CHANGELOG, DATASHEET, indirme diyaloğu notu                           | K2, K3, K6 |
| 533 | `customer-templates.ts`, `targets.ts`, `env.ts` (`UNATTENDED_AGENT_VERSION`), `publish-servis.sh` | K1, K3     |

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
2. "İmzasız (risk kabul)" bandını firma Admin'leri de görsün mü? **Varsayılan: yalnız Super Admin**; Admin'e bant değil, indirme/
   kayıt kodu diyaloğunda kısa kurulum notu (§4.7, S-P32-8) ve kılavuz.
3. `unsigned-accepted`'te AC-419 oturumsuz indirme bağlantısı müşteriye gönderilmeye devam etsin mi? **Varsayılan (uygulandı, ana
   oturum 2026-11-20): evet, sertleştirilmiş mesajla (AC-533).** Alternatif: gönderim kapanır, yalnız oturumlu indirme. Bu karar
   §20.3 m.16 imzasına girdi olur; kullanıcı imzada alternatifi seçerse K1 şablon yerine `UNATTENDED_CODE` 409 uygular.

## 14. Güvenlik turu izi (K0, `docs/guvenlik-raporu.md` P32 tasarım turu)

| Bulgu            | Karar                                                                                                                                       | AC / dosya                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| S-P32-1 (Yüksek) | T-1/ADR/R-P32-1 metni düzeltildi (oturumsuz AC-419 yolu var); bağlantı kapanmaz, mesaj doğrulama bloğu; kılavuzda `Get-FileHash`            | AC-533 (yeni), AC-532; §4.8, §5 T-1, §13 m.3, ADR-0042 |
| S-P32-2 (Orta)   | iki aşamalı geri çekme runbook'a; bedel ADR "Sonuçlar"a; "yalnız güncelleme" durumu **Sonra**                                               | AC-532; §8.3, §8.4 §27.9, ADR-0042                     |
| S-P32-3 (Orta)   | betik listeye yalnız `vX.Y.Z` ekler (tüm ortamlar); remote-watch liste↔`PUBLISHED.log` ve `DEPLOY_ENV`↔beklenen ALERT; T-3 kalan düzeltildi | AC-529, AC-527b; §8.1, §8.5, §5 T-3/T-4                |
| S-P32-4 (Orta)   | audit `binarySha256` (+ connect `signed`), ret `sha256Prefix` 12, açılış `listFingerprint`; "SHA yazılmaz" düzeltildi                       | AC-528, AC-527a; §4.5, §5                              |
| S-P32-5 (Düşük)  | mod/liste değişiminde tek seferlik ALERT (durum dosyası)                                                                                    | AC-527b; §8.5                                          |
| S-P32-6 (Düşük)  | 16'da uyarı, 20'de dur; acil yol runbook; sınır env.ts'te                                                                                   | AC-529, AC-524; §4.1, §8.1, §8.3                       |
| S-P32-7 (Düşük)  | genel geri alma adımına "önce `off`" ön koşulu + `grep … DUR`                                                                               | AC-532; §8.2, §8.4                                     |
| S-P32-8 (Düşük)  | Admin'e indirme diyaloğunda kurulum notu + SHA; AV istisnası özetle (klasör joker değil), her sürümde yenilenir                             | AC-527c, AC-532; §4.7, §5 T-6                          |
| S-P32-9 (Düşük)  | geçici dosya `umask 077`, yedek 600, son 10 yedek                                                                                           | AC-529; §8.1                                           |
| S-P32-10 (Düşük) | §20.3 m.16'ya `gh api` ruleset + `agent-release` ortam kanıtı                                                                               | AC-532; §8.4 §20.3, §5 T-7                             |

Sonra (bilinçli): "yalnız güncelleme" durumu (listeden çıkarılmış eski SHA yalnız `update.*` alır; Go/WS protokol işi, S-P32-2);
listeden otomatik SHA çıkarma; mod değişiminin kalıcı audit'i (remote-watch ALERT'i yeterli sayıldı).
