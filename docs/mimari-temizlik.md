# Mimari — PT (P-temizlik): davranış değiştirmeyen kod temizliği

Tarih: 2026-11-15 · Durum: TASLAK (mimar) · Sıra (kullanıcı kararı 2026-11-15): P20 → **PT** → P27 → P28 → P21–P26
AC: `docs/gereksinimler.md` §10 (AC-317..AC-324). Yol haritası: `docs/mimari-e11.md` §11.
Standart: `~/.claude/checklists/kalite-standartlari.md` (fonksiyon ≤ 40, dosya ≤ 300 satır hedefi; ölü kod yok).

## 1. Özet ve kısıtlar

PT, P27 (gözetimsiz erişim) ve P28 (macOS/Linux istemci, çoklu teknisyen + ses, pano, kayıt) öncesinde bu
paketlerin dokunacağı sıcak bölgeleri (sinyalizasyon, konsol, Go `flow`/`signal`/`request`, talep servisi)
okunur ve bölünebilir hale getirir. **Davranış değişmez.**

Bağlayıcı kısıtlar:

1. **Dışa açık sözleşme değişmez:** `packages/contracts/src/**` diff'i yalnız PT-K1'in döngü kırma değişikliğini içerir ve her `exports` yolunun dışa verdiği ad kümesi aynıdır (yüzey anlık görüntüsü); HTTP uç listesi (metot + yol), WS mesaj
   tipleri, hata kodları, DB şeması (`apps/server/prisma/schema.prisma`, `migrations/`, `sql/grants.sql`), env
   değişkenleri, i18n'de **görünen** metinler, Go istemcinin kayıt dosyası biçimi ve tel protokolü aynı kalır.
2. **Testler değişmez:** mevcut test adları/sayısı korunur; assertion silinmez, gevşetilmez, `skip` eklenmez.
   Test dosyalarına yalnız fikstür görevleri (PT-K2, PT-K3) ve Go paket görevleri (aynı paketteki `_test.go`,
   yalnız fikstür/yardımcı birleştirme ve staticcheck uyarısı) dokunur.
3. **Taşıma kuralı (dosya ayrıklığını sağlayan kural):** başka modülün veya testin import ettiği dışa açık adlar
   **bulundukları dosyada kalır**; bölme yalnız dosya-içi yardımcıların yeni dosyalara çıkarılmasıyla yapılır.
   Böylece bir görev kendi dosya listesi dışındaki hiçbir import satırını değiştirmez. Go'da aynı paket içi taşıma
   import değiştirmez; serbesttir.
4. **Mekanik dönüşüm:** yalnız "fonksiyon çıkar", "dosyaya taşı", "kopyayı ortak yardımcıya al", "kullanılmayanı sil",
   "gereksiz `export`'u kaldır". İfade sırası, `await` sırası, TX sınırı, hata sınıfı, log/audit/metrik adı ve
   alanları değişmez. Bulunan hata **düzeltilmez**: `docs/implementation.md` "PT bulguları" altına yazılır, ayrı
   `fix:` işi olarak ele alınır (R-PT9).
5. **Yeni bağımlılık yok** (tek istisna PT-D1: test kapsam ölçümü). Ölçüm araçları docker içinde, sürüm sabit,
   repoya girmez.
6. PT, P20'nin qa GEÇTİ + güvenlik Kritik/Yüksek 0 durumundan **sonra** başlar (CLAUDE.md §10.1). P20 güvenlik
   düzeltmesinin dokunduğu dosyaların (`autorun/autorun.go`, `tray/tray_windows.go`, `cmd/noktadestek/main.go`,
   `launch/keeper.go`) son hali esas alınır.

## 2. Kapsam

| Kapsamda                                                                                                        | Kapsam dışı (neden)                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| > 500 satırlık üretim dosyalarının bölünmesi (contracts ve Win32 bağlama dosyaları hariç, §3.1)                 | `packages/contracts/src/**` (public sözleşme) — **tek istisna PT-K1:** `api/` içi import döngülerinin kırılması (§3.7), dışa açık adlar ve `exports` yolları aynı kalır. `api/requests.ts` 985 satır bölünmesi → Sonra                   |
| P27/P28'in dokunacağı sıcak bölgelerdeki 300–500 satırlık dosyalar ve > 80 satırlık / karmaşıklık > 20 işlevler | Win32/COM bağlama ve medya hattı: `win/win_windows.go` (597), `capture/mf_windows.go` (537), `capture/source_windows.go`, `dxgi_windows.go`, `wgc_windows.go` (bildirimsel bağlama; bölmek okunurluğu artırmaz, Windows elle test ister) |
| Kullanılmayan export/tip, ölü Go işlevi, ölü i18n anahtarı                                                      | Test dosyalarının yeniden adlandırılması (`p18-backend-h2.test.ts` gibi paket adlı dosyalar; qa/güvenlik raporları ve AC izlenebilirliği bu adlara bağlı)                                                                                |
| Üretim kodundaki kopyalar (jscpd ≥ 8 satır)                                                                     | i18n anahtar önekleri (`us.`, `tn.`, `p5.`) ve tekrar eden değerler (175 değer) — P23 (TR/EN) işi; EN'de bağlama göre farklılaşabilir                                                                                                    |
| Test fikstür tekrarları (sunucu entegrasyon yerel yardımcıları, e2e `desktopOnly`)                              | e2e sahte API'leri (`e2e/mock-*.mjs`, 14 dosya, 4 629 satır) — zaten modüler (`mock-api.mjs` toplayıcı + ortak `send/err`); davranışları e2e sözleşmesidir                                                                               |
| staticcheck uyarıları (10), test-only üretim işlevleri                                                          | `docs/test-raporu/e2e/**`, `docs/arsiv/**`, `docs/tasarim/*.js` (66 betik; test-operatörü kanıt arşivi, çalıştırılmaz) — yalnız ölçüm yapılandırmasında hariç tutulur                                                                    |
| Ölçüm betiği + baseline + sözleşme yüzeyi korkuluk testleri                                                     | Saf yeniden-dışa-aktarım cepheleri (`apps/web/lib/*/contract.ts`, 7 dosya, 56 kullanım) — belgelenmiş karar (implementation.md P8c/P9/P10), web'in tek sözleşme sınırı; yalnız kullanılmayan adları budanır (PT-D3)                      |

## 3. Ölçüm sonuçları (2026-11-15, `p20-wip` çalışma kopyası)

Yöntem (repoya dokunmadan): `wc -l`; ESLint mevcut yapılandırmayla CLI kural geçersiz kılması
(`max-lines-per-function: 40 (boş/yorum hariç)`, `complexity: 15`); Go `go/ast` ile işlev uzunluğu; `go vet`,
`staticcheck@latest`, `deadcode@latest` (`golang:1.26` konteyneri, GOOS=windows ve linux); `knip@5` ve
`jscpd@4` (`node:22` konteyneri, repo salt-okunur bağlandı; vitest eklentisi kapatılmış özel yapılandırma); i18n
için `messages/tr.json` anahtarlarının kaynakta tırnaklı geçişi + şablon önek analizi. Hiçbir paket repoya eklenmedi.
`graphify-out/GRAPH_REPORT.md` ölçüm anında oluşmamıştı; PT-K0 onu (varsa) çapraz kontrol kaynağı olarak kullanır.

### 3.1 Dosya boyutu (üretim kodu; test/e2e hariç)

| Alan                                                          | Dosya | Satır   | > 300  | > 500  |
| ------------------------------------------------------------- | ----- | ------- | ------ | ------ |
| `apps/server/src`                                             | 128   | 24 555  | 24     | 8      |
| `apps/web` (app + components + lib)                           | 335   | 37 194  | 21     | 3      |
| `packages/contracts/src`                                      | 22    | 5 814   | 9      | 1      |
| `apps/agent-win` (üretim)                                     | ~110  | ~21 000 | 24     | 7      |
| **Toplam üretim**                                             |       |         | **77** | **19** |
| Test dosyaları (server test, web e2e/lib test, Go `_test.go`) |       |         | 73     | 13     |

> 500 üretim dosyaları: server `requests/service.ts` 1063, `users/service.ts` 666, `requests/panel.ts` 628,
> `signaling/control.ts` 624, `sessions/history.ts` 586, `customers/service.ts` 586, `requests/repo.ts` 534,
> `auth/account.ts` 509 · web `lib/dc/files.ts` 614, `settings/support-requests/settings-form.tsx` 611,
> `users/[id]/user-editor.tsx` 533 · contracts `api/requests.ts` 985 · Go `flow/flow.go` 923,
> `ui/screens_windows.go` 719, `signal/messages.go` 661, `win/win_windows.go` 597, `request/chat.go` 582,
> `capture/mf_windows.go` 537, `launch/home.go` 518. (`remember/remember.go` 499 sınırda.)

### 3.2 İşlev uzunluğu ve karmaşıklık

| Alan             | > 40 satır (üretim) | > 80 satır | > 150 satır | Karmaşıklık > 15 | En kötüler                                                                                                                                                                                                                                            |
| ---------------- | ------------------- | ---------- | ----------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| server           | 99                  | 23         | 6           | 42               | `requests/service.ts` `createCore` 264 satır / iç TX işlevi karmaşıklık **48**; `app.ts` `buildApp` 259; `signaling/ws.ts` `attachSignaling` 254 (`guest` cx 34); `bindings/service.ts` `issueTx` cx 43; `customers/csv-import.ts` `commitImport` 166 |
| web              | 172                 | 95         | 35          | 84               | `settings-form.tsx` `SettingsForm` 440; `RequestQueue` 364; `ImportWizard` 340; `components/console/stage.tsx` `Stage` 300 / cx **87**; `lib/control/machine.ts` `onMsg` cx 58; `lib/webrtc/tech-machine.ts` `onMsg` cx 41                            |
| contracts        | 0                   | 0          | 0           | 3                | —                                                                                                                                                                                                                                                     |
| Go (1 709 işlev) | 55                  | 7          | 1           | —                | `cmd/noktadestek/main.go` `run` 178; `ui` `ChooseShare` 129, `FirmHome` 127; `request/run.go` `form` 100; `ui` `Active` 88; `flow` `onHello` 82; `signal` `ParseServer` 79                                                                            |

Testlerde > 40 satırlık işlev: server 244, web 93, contracts 12, Go 30 (çoğu `describe`/tablo testi; hedef değil).

### 3.3 Ölü kod

| Bulgu                                    | Sayı                  | Not                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| knip "unused exports" (server + web)     | **93** ad / ~70 dosya | Neredeyse tamamı dosya içinde kullanılan ama gereksiz `export`'lu sabit/işlev (ör. `OUTBOX_MAX_ATTEMPTS`, `WA_LIMITS`, `revokeControl`); testler giriş olarak sayıldığı için testte kullanılanlar listede **yok**. Next özel export'ları (`default`, `metadata`, `generateMetadata`, rota işleyicileri) hariç tutulur |
| knip "unused exported types"             | **93**                | Çoğu imzada geçen sonuç/bağımlılık tipleri                                                                                                                                                                                                                                                                            |
| knip "duplicate exports"                 | 1                     | contracts `listSessionsQuerySchema` = `exportSessionsQuerySchema` (contracts kapsam dışı; Sonra)                                                                                                                                                                                                                      |
| Kullanılmayan bağımlılık                 | 1 aday                | `@types/smtp-server` (server dev) — doğrulanacak. `@prisma/client` yanlış pozitif (üretilen istemci kullanır). Listelenmemiş `server-only` (Next iç takma adı), `postcss` (geçişli) — değişiklik yok, not düşülür                                                                                                     |
| Kullanılmayan dosya                      | 0 (uygulama)          | 66 dosya yalnız `docs/test-raporu/e2e`, `docs/arsiv`, `docs/tasarim` (kapsam dışı); `apps/web/vitest.config.ts` yanlış pozitif                                                                                                                                                                                        |
| Go `deadcode` (testler dahil erişilemez) | 1                     | `remember/origin.go` `SameRegistration`                                                                                                                                                                                                                                                                               |
| Go yalnız testte erişilen üretim işlevi  | 7                     | `files.IsSanitized`, `input.Applier.Limited`, `input.Applier.ScopeDropped`, `ui/theme.go` `textPairs`/`linear`/`luminance`/`contrastRatio` (kontrast testi yardımcıları)                                                                                                                                              |
| Ölü i18n anahtarı (aday)                 | **27 + 14**           | 2 007 anahtardan 27'si hiç geçmiyor (`us.*` 12, `h.*` 3, `tn.*` 3 …); `c.*` öneki şablonla (`c.${id}` — aslında anahtar değil, sohbet satır kimliği) gizlendiğinden 42 `c.*` anahtarından 14'ü ek aday. 41 şablon önekli dinamik kullanım var → silmeden önce tek tek doğrulama                                       |
| TODO/FIXME/XXX/HACK                      | **0**                 | —                                                                                                                                                                                                                                                                                                                     |
| `eslint-disable`                         | 8 (hepsi gerekçeli)   | Değişiklik yok                                                                                                                                                                                                                                                                                                        |
| `@deprecated`                            | 0                     | —                                                                                                                                                                                                                                                                                                                     |
| Yorumlanmış/geçici kod                   | 0                     | "legacy" geçenler `remember` v1/v2 göç kodu — **gerekli** (dokunulmaz)                                                                                                                                                                                                                                                |

### 3.4 Kopya kod (jscpd, ≥ 8 satır ve ≥ 70 belirteç)

Toplam **70 klon / 882 satır (%0,56)** — düşük. Üretim kodunda **25 klon / 398 satır**, testte 45.

Üretimdeki başlıca kümeler: kullanıcı formu (`new-user-dialog` ↔ `user-editor`, 28 satır); liste sayfası
sayfalama (`customers/(list)/page` ↔ `users/(list)/page`, 25); şifre formu (`change-password-form` ↔
`reset-form`, 24); ayar formu iskeleti (`smtp-form` ↔ `support-requests/settings-form` ↔ `sms-form`, 17–19);
filtre çubukları (`users` / `customers` / `tenants` / `audit` ↔ `history`, 12–15); oturum diyaloğu (`cancel-dialog`
↔ `terminate-dialog`, 20); admin ayar sayfa kabuğu (`turn` / `mysql` / `whatsapp` `page.tsx`, 16); `loading.tsx`
iskeleti (17); logo/avatar yükleyici (14); sohbet paneli (`collab-side` ↔ `guest-collab`, 10); oturum kancaları
(`use-guest-session` ↔ `use-tech-session`, 12); WS yükseltme başı (`requests/ws.ts` ↔ `signaling/ws.ts`, 12);
`requests/panel.ts` iç tekrar (10); Go HTTP istemci gövdesi (`api/api.go` ↔ `bindings.go` ↔ `requests.go`, 18);
Go logo çözme (`tray/tray.go` ↔ `ui/logo.go`, 17); `ui/screens_windows.go` iç tekrar (13).

Test fikstürleri: sunucu entegrasyonunda dosya-yerel yardımcılar `signIn` ×7, `boot` ×7, `errorText` ×6,
`login` ×5 (`test/helpers/` varken); TLS posta testleri (`mail-tls-p10` ↔ `mail-starttls-p14a`, 3 klon);
DB yetki testlerinin baş kısmı (`security-p14a-db`, `security-p15-db`, `retention-p13a-db`, `whatsapp-setting`,
`branding-p12`). e2e: `const desktopOnly = …` **17 spec dosyasında** ayrı ayrı; spec başlarındaki giriş/kurulum
blokları 9–15 satırlık 10 klon. Go: `signal/binding_test.go`, `flow/binding_test.go` iç tekrarlar.

### 3.5 Statik analiz

`go vet` (windows + linux): **0**. `staticcheck`: **10** (hepsi testte: 9× ST1018 — görünmez Unicode biçim
karakteri kaçışsız, `request/hardening_test.go`, `request/home_test.go`; 1× S1017 `diag/diag_test.go`).
ESLint/tsc (proje yapılandırması): temiz (CI). Prettier: temiz (ADR-0024).

### 3.6 Adlandırma ve sarmalayıcılar

- Web `lib/*/contract.ts` 7 saf yeniden-dışa-aktarım cephesi (bkz. §2, PT-D3); `lib/control/protocol.ts` ad
  değiştirerek dışa aktarır (`inputMessageSchema as inputMsgSchema`) — tek ad tutarsızlığı, kapsamda (K14).
- Test dosyası adları karışık (konu adlı `users-p9.test.ts` / paket adlı `p18-backend-h2.test.ts`, web
  `lib/p15.test.ts`); kapsam dışı (§2).
- Go test adları tutarlı (`TestAC…` 298, `TestS…`/`TestGP…` güvenlik bulgu numaralı).

### 3.7 graphify bulguları (`graphify-out/GRAPH_REPORT.md`, 9 458 düğüm, 250 topluluk)

1. **Import döngüleri (yalnız `packages/contracts/src/api`):** `customers.ts ↔ requests.ts`,
   `customers.ts ↔ sessions.ts` ve üçlü `customers → requests → sessions → customers`. İnceleme: çalışma
   zamanında döngü **yok** (geri yöndeki `CustomerFirmRef` importları `import type`, derlemede silinir); döngü tip
   düzeyinde ve değer yönünde `customers.ts` iki modülden değer (`normalizePhone`, `REQUEST_PRIORITIES`,
   `SLA_MINUTES_*`, `UNSAFE_NAME_CHARS`) alıyor. Karar: PT-K1 ortak öğeleri yeni iç modül
   `packages/contracts/src/api/shared.ts`'e (exports haritasına **eklenmez**) taşır; üç modül oradan alır ve
   bugünkü adları **aynı yoldan yeniden dışa verir** (ör. `requests.ts` `normalizePhone`'u dışa vermeye devam
   eder). Dışa açık ad kümesi K1'in yüzey anlık görüntüsüyle kanıtlanır; davranış değişmez.
2. **Düşük kohezyonlu topluluklar:** "Web müşteri ve talep geçmişi" (0,023) ve "Web şifre/hesap formları" (0,049)
   bölme adayıdır. İlki `history/[id]/sections.tsx` (448), `history-filters.tsx` (`HistoryFiltersForm` 217 satır)
   ve müşteri liste/filtre kopyalarıyla örtüşür → PT-K15; ikincisi `change-password-form` ↔ `reset-form` kopyası
   (24 satır) ve `settings/smtp`'deki hesap/SMTP form yardımcılarıyla örtüşür → şifre formları PT-K15, SMTP PT-K13.
3. **261 zayıf bağlı düğüm:** ölü kod adayı, tek başına silme gerekçesi **değil**. Her aday knip/deadcode/grep ile
   doğrulanmadan silinmez (PT-K0 listeyi §3.3 sonuçlarıyla birleştirir; yalnız iki araçla da teyitli olanlar ilgili
   göreve "silinecek" olarak girer, diğerleri "doğrulandı, kullanılıyor" notuyla kapanır).
4. **En bağlı düğümler:** `t()` 476, `AppError` 210, `writeAudit()` 179, `Button()` 179, `testDb()` 168,
   `newId()` 151 kenar. Bunların **imzası ve davranışı PT'de değişmez**; bunlara dokunan her değişiklik (ör.
   `writeAudit` çağrısının yeni dosyaya taşınması) yalnız çağrı yerinin taşınmasıdır. Geniş etkili oldukları için
   bu düğümlerin tanım dosyaları (`apps/web/lib/i18n.ts`, `apps/server/src/lib/errors.ts`,
   `apps/server/src/audit/service.ts`, `apps/web/components/ui/button.tsx`, `apps/server/src/lib/ids.ts`) **hiçbir PT
   görevinin dosya listesinde yoktur**; `testDb` (`apps/server/test/helpers/app.ts`) değiştirilmez, K2 yeni
   yardımcıları ayrı dosyaya yazar; sıralamada bunları yoğun çağıran
   görevler (K9, K12, K15) düşük riskli görevlerden (ölü export, fikstür) sonra birleştirilir (§6).

## 4. Önceliklendirme

Ölçüt: (a) P27/P28'in dokunacağı bölge mi, (b) bölünmeden önce anlaşılması zor mu (uzunluk × karmaşıklık),
(c) test güvencesi (otomatik test var mı; Windows UI'da yok), (d) etki alanı (graphify bağlantı sayısı).

| Öncelik | Neden                                                                                                                                                                                                                                             | Görevler                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| P0      | Güvence ağı olmadan temizlik yapılmaz                                                                                                                                                                                                             | K0, K1                             |
| P1      | P28 macOS/Linux istemcisi platformdan bağımsız Go paketlerini (`flow`, `signal`, `request`) yeniden kullanacak; P27/P28 (gözetimsiz, çoklu teknisyen, ses, pano) sinyalizasyonu ve konsolu genişletecek; `createCore` cx 48 talep akışının tamamı | K6, K10, K14, K9, K4               |
| P2      | Büyük ama P27/P28 dışı servis ve formlar; fikstür tekrarı                                                                                                                                                                                         | K2, K3, K5, K11, K12, K13, K15, K7 |
| P3      | Windows'a özgü UI: otomatik test yok, elle duman testi ister, P28'de yeniden kullanılmaz; süre baskısında **atlanabilir** (kapsamdan çıkarma kararı mimar + kullanıcı)                                                                            | K8                                 |
| Son     | Bağımlılık/CI korkuluğu ve ölçüm kapanışı                                                                                                                                                                                                         | K16, K17                           |

## 5. Görev paketleri (PT-K0..PT-K17)

Kural: **iki görev aynı dosyaya dokunmaz.** Dosya listesi glob ise, listede adı geçen başka görevin dosyaları hariçtir.
"Yeni" dosyalar yalnız o görevin dizininde oluşturulur. Hedef: listelenen her üretim dosyası ≤ 300 satır, listelenen
her işlev ≤ 40 satır hedef / **≤ 60 kesin üst sınır**, karmaşıklık ≤ 15 (gerekçeli istisna implementation.md'de,
görev başına en fazla 2). Büyüklük: S ≤ 0,5 g, M 1–2 g, L 3–4 g.

| Görev | Ajan                                  | Dosyalar (yalnız bunlar)                                                                                                                                                                                                                                                                                                 | İş                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Bağımlı         | Paralel    | Boy |
| ----- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ---------- | --- |
| K0    | devops                                | yeni `scripts/pt-olcum.sh`, yeni `scripts/pt-olcum/knip.json`, yeni `docs/temizlik/baseline.md` + `baseline/*.json`; `apps/server/package.json`, `apps/web/package.json`, `packages/contracts/package.json` (yalnız `test:cov` betiği + PT-D1 devDep), `pnpm-lock.yaml`, `vitest.config.ts` ×3 (yalnız `coverage` bloğu) | Ölçümü tek komutla tekrarlanabilir yap (§3 yöntemleri, docker, araç sürümleri **sabit**: knip, jscpd, staticcheck, deadcode; çıktı JSON). Baseline: §3 metrikleri + test listeleri (`vitest list --json` ×3 + entegrasyon, `playwright test --list`, `go test -list . ./...` linux + windows derleme) + kapsam (vitest v8, `go test -cover`). graphify zayıf düğüm listesini knip/deadcode ile birleştirip görevlere dağıt (§3.7-3)                                                      | P20 qa GEÇTİ    | K1 ile     | M   |
| K1    | backend-dev                           | yeni `apps/server/test/integration/pt-surface.test.ts` + anlık görüntüsü; yeni `packages/contracts/test/pt-surface.test.ts` + anlık görüntüsü; `packages/contracts/src/api/{customers,requests,sessions}.ts` (yalnız import/yeniden dışa aktarım satırları), yeni `packages/contracts/src/api/shared.ts`                 | Sözleşme korkuluğu: (1) Fastify rota tablosu (metot + yol + `schema` varlığı) anlık görüntüsü; (2) contracts'ta her `exports` yolunun ad kümesi + `ws.ts`/`ws-request.ts`/`dc.ts` mesaj `type` literal listesi + `errors.ts` kod listesi anlık görüntüsü. Ardından §3.7-1 döngü kırma; anlık görüntü değişmeden geçmeli                                                                                                                                                                  | —               | K0 ile     | M   |
| K2    | backend-dev                           | `apps/server/test/integration/*.test.ts` (yalnız dosya-yerel yardımcıların kaldırılıp çağrının değişmesi), yeni `apps/server/test/helpers/{auth,mail-tls,db-grants}.ts`                                                                                                                                                  | `signIn` ×7, `boot` ×7, `errorText` ×6, `login` ×5 tek tanım; posta TLS ve DB yetki test başları ortak fikstür. Assertion, test adı, `describe` yapısı değişmez; yardımcılar saf (paylaşılan değişebilir durum yok)                                                                                                                                                                                                                                                                      | K0, K1          | K3–K16 ile | M   |
| K3    | frontend-dev                          | `apps/web/e2e/*.spec.ts`, `apps/web/e2e/helpers.ts` (`mock-*.mjs` **hariç**)                                                                                                                                                                                                                                             | `desktopOnly` ×17 → `helpers.ts`'te tek tanım; spec başlarındaki 10 kurulum klonu ortak yardımcı. Seçiciler, adımlar, beklentiler aynı                                                                                                                                                                                                                                                                                                                                                   | K0              | hepsiyle   | S   |
| K4    | backend-dev (Go)                      | `apps/agent-win/internal/request/**` (testler dahil)                                                                                                                                                                                                                                                                     | `chat.go` 582 → `chat_wire.go` (tel tipleri, `parseChat`, `EncodeMessage`, `ChatBody`, doğrulama; ~170 satır) + `chat.go` (durum makinesi); `run.go` `form` 100 satır → adım işlevleri; `wait.go` `wait` 72 satır bölünür. staticcheck ST1018 (9): test dizgilerinde `‮` kaçışı (bayt değeri aynı). Test fikstür tekrarları                                                                                                                                                              | K0              | hepsiyle   | M   |
| K5    | backend-dev (Go)                      | `internal/launch/{home,run}.go` + testleri (**`keeper.go`, `keeper_test.go` hariç**), `internal/remember/**`                                                                                                                                                                                                             | `home.go` 518 → `home.go` (akış) + `home_text.go` (metinler/etiket) + `home_actions.go` (unut/kaldır/toggle) + `observed_api.go`; `run.go` `Run` 64 satır; `remember.go` 499 → `store_lock.go` (`held`, `acquire`, sayaç) + `remember.go`; `migrate.go` `Migrate` 61; `SameRegistration` silinir (deadcode). Dosya biçimi ve göç sırası aynı                                                                                                                                             | K0              | hepsiyle   | M   |
| K6    | backend-dev (Go)                      | `internal/flow/**`, `internal/signal/**`                                                                                                                                                                                                                                                                                 | `flow.go` 923 → `flow.go` (arayüzler, `Run`, `admitStage`) + `session.go` (`run`/`attach`/`reconnect`/`send`) + `session_server.go` (`onServer`, `onHello` 82→≤ 60) + `session_media.go` (paylaşım, akış, eş, `onCtl`); `messages.go` 661 → `outbound.go` + `inbound.go` (`ParseServer` 79 → tip başına ayrıştırıcı tablosu, **aynı hata metinleri**). Binding test klonları                                                                                                             | K0              | hepsiyle   | L   |
| K7    | backend-dev (Go)                      | `internal/api/**`, `internal/input/**`, `internal/files/**`, `internal/diag/**`                                                                                                                                                                                                                                          | HTTP gövde klonu (18 satır ×3) → paket-içi yardımcı; `translateScoped` 72; test-only `IsSanitized`, `Applier.Limited`, `ScopeDropped` → `_test.go` yardımcısına veya `export_test.go`; S1017                                                                                                                                                                                                                                                                                             | K0              | hepsiyle   | S   |
| K8    | backend-dev (Go) + elle Windows testi | `internal/ui/**`, `internal/tray/tray.go`, `cmd/noktadestek/main.go`                                                                                                                                                                                                                                                     | `screens_windows.go` 719 → ekran başına dosya; `ChooseShare` 129, `FirmHome` 127, `Active` 88, `newReqForm` 81, `RequestHome` 67, `Welcome` 66, `dispatch` 65; `main.go` `run` 178 → kurulum/mod seçimi/çalıştırma işlevleri (bayrak ve çıkış kodları aynı); `tray.go` ↔ `ui/logo.go` logo çözme klonu; `theme.go` kontrast yardımcıları → `_test.go`                                                                                                                                    | K0              | hepsiyle   | L   |
| K9    | backend-dev                           | `apps/server/src/requests/**` (**`ws.ts` hariç**)                                                                                                                                                                                                                                                                        | `service.ts` 1063: `createCore` (264 satır, iç TX cx 48) ve 97 satırlık ikinci TX işlevi → yeni `create-steps.ts` (doğrulama, müşteri eşleme, limit, kayıt, bildirim kuyruğu adımları; **aynı TX nesnesi parametre**); `panel.ts` 628 `acceptRequest` 117 → `panel-accept.ts`; panel iç klon; `repo.ts` 534 → sorgu grupları; requests altındaki knip export'ları                                                                                                                        | K0, K1          | hepsiyle   | L   |
| K10   | backend-dev                           | `apps/server/src/signaling/**`, `apps/server/src/requests/ws.ts`, yeni `apps/server/src/lib/ws-upgrade.ts`                                                                                                                                                                                                               | `attachSignaling` 254 → yükseltme/kimlik/misafir/teknisyen dalları ayrı işlevler (`guest` cx 34); `control.ts` 624 → izin/istek/geri alma; `collab.ts` `handleFileMeta` 84; `admit.ts` 91/81; `handlers.ts` `onTechMessage` cx 27; `requestChannels` 163; iki WS başının 12 satır klonu → `lib/ws-upgrade.ts`. Kapanış kodları, mesaj sırası, hız kovaları aynı                                                                                                                          | K0, K1          | hepsiyle   | L   |
| K11   | backend-dev                           | `apps/server/src/app.ts`, `src/jobs/**`, `src/customers/**`, `src/lib/csv.ts`                                                                                                                                                                                                                                            | `buildApp` 259 → yeni `app-routes.ts` (rota kaydı, **aynı sıra**) + `app-hooks.ts`; `startScheduler` 131 → iş tablosu; `customers/service.ts` 586, `csv-import.ts` (`commitImport` 166, `previewImport` 99/cx 30); `parseCsv` 98/cx 27 (durum makinesi işlevleri). jobs/customers knip export'ları                                                                                                                                                                                       | K0, K1          | hepsiyle   | L   |
| K12   | backend-dev                           | `apps/server/src/{users,auth,sessions,tenants,bindings,settings,notify,uploads,mail,cli,audit,public}/**`, `src/env.ts`, `src/lib/{netguard,outbound,rate,crypto}.ts`, `prisma/seed-consent.ts` (**`audit/service.ts`, `lib/errors.ts`, `lib/ids.ts` hariç**)                                                            | `users/service.ts` 666, `auth/account.ts` 509, `sessions/history.ts` 586 (`buildDetail` 90), `tenants/service.ts` 416, `bindings/service.ts` `issueTx` 108/cx 43, `authRoutes` 128, `sessionRoutes` 106, `userRoutes` 80, `testMysql` cx 25; kalan knip export/tip'leri; `@types/smtp-server` doğrulaması K16'ya not                                                                                                                                                                     | K0, K1          | hepsiyle   | L   |
| K13   | frontend-dev                          | `apps/web/app/(panel)/requests/**`, `app/(panel)/settings/{support-requests,sms,smtp,business-hours}/**`, `app/r/**`, `lib/requests/**`, `lib/notify/**`, `lib/web-request/**`, yeni `components/settings/**`                                                                                                            | `SettingsForm` 440 (dosya 611) → bölüm bileşenleri; `RequestQueue` 364, `RequestThread` 303, `RequestCard` 196/cx 38, `RequestsPage` 258/cx 47, `HolidaysSection` 297, `BusinessHoursForm` 207, `SmtpForm` 298, `SmsForm` 251, `WaitingRoom` 271, `WebRequestForm` 198; ayar formu iskelet klonu (3 form) → `components/settings/`; `request-history` ↔ `request-queue` klonu                                                                                                            | K0              | hepsiyle   | L   |
| K14   | frontend-dev                          | `apps/web/components/{console,guest,collab}/**`, `app/(panel)/sessions/**`, `app/session/**`, `lib/{control,webrtc,dc}/**`                                                                                                                                                                                               | `Stage` 300/cx **87** → katman bileşenleri (video, imleç, şerit, kontrol çubuğu); `ConsoleView` 278/cx 51; `GuestSession` 251; `lib/control/machine.ts` `onMsg` cx 58 ve `tech-machine.ts` `onMsg` cx 41 → mesaj tipi başına işleyici tablosu (**aynı geçişler**, mevcut birim testleri birebir); `lib/dc/files.ts` 614 → gönder/al/disk; `useTechSession` 218; diyalog ve kanca klonları; `protocol.ts` ad takması (`inputMsgSchema`) yerinde kalır, yalnız kullanılmayan adlar budanır | K0              | hepsiyle   | L   |
| K15   | frontend-dev                          | `apps/web/app/(panel)/{users,customers,admin,history,audit}/**`, `app/(panel)/settings/**` (K13'tekiler hariç), `app/(auth)/**`, `components/{ui,branding}/**` (**`ui/button.tsx` hariç**), `components/*.tsx`, `lib/**` (K13/K14'tekiler ve `lib/i18n.ts` hariç), `messages/tr.json`                                    | `UserEditor` 304 (dosya 533) ↔ `new-user-dialog` klonu; `ImportWizard` 340; `CustomerFormDialog` 235; `HistoryFiltersForm` 217 + `history/[id]/sections.tsx` 448 (kohezyon 0,023); şifre formları klonu (kohezyon 0,049); filtre/liste/`loading`/admin ayar sayfası klonları; `MysqlForm`, `TurnForm`, `WhatsappForm`, `ConsentForm`, `Combobox` 233/cx 40, `AvatarUploader`; ölü i18n anahtarları (doğrulanmış olanlar); lib knip export'ları                                           | K0              | hepsiyle   | L   |
| K16   | devops                                | `.github/workflows/agent-win.yml`, `apps/server/package.json` (yalnız `@types/smtp-server` satırı, doğrulanırsa), `pnpm-lock.yaml`                                                                                                                                                                                       | Go CI'a `staticcheck` (sürüm sabit, `go run …@vX`; go.mod değişmez) ekle — K4/K7 sonrası 0 uyarı ile; `@types/smtp-server` gerçekten kullanılmıyorsa kaldır (tip denetimi temiz kalmalı)                                                                                                                                                                                                                                                                                                 | K0, K4, K7, K12 | —          | S   |
| K17   | devops                                | `docs/temizlik/sonuc.md`                                                                                                                                                                                                                                                                                                 | Kapanış ölçümü (`scripts/pt-olcum.sh`), baseline'a karşı tablo: AC-317..324 kanıtları                                                                                                                                                                                                                                                                                                                                                                                                    | tümü            | —          | S   |

Notlar: `pnpm-lock.yaml` ve `apps/server/package.json` K0 ve K16 tarafından kullanılır; K16, K0 birleştikten sonra
çalıştığı için eşzamanlı değildir (bağımlılık sütunu). `docs/implementation.md` tüm görevlerin **ekleme** yaptığı
ortak günlüktür; her görev kendi "PT-Kn" başlığı altında yazar (çakışma birleştirmede mekaniktir).

## 6. Akış ve birleştirme sırası

```
P20 (qa GEÇTİ, güvenlik K/Y = 0)
  └─ Dalga 0: K0 ‖ K1
       └─ Dalga 1 (tamamı paralel; dosya kümeleri ayrık):
            K2 ‖ K3 ‖ K4 ‖ K5 ‖ K6 ‖ K7 ‖ K8 ‖ K9 ‖ K10 ‖ K11 ‖ K12 ‖ K13 ‖ K14 ‖ K15
            └─ K16 → K17 → (qa-denetci ‖ guvenlik) → düzeltme → test-operatoru → P27
```

- **Birleştirme sırası** (paralel çalışılır, sıra yalnız ana dala alışta): önce düşük riskli ve geniş etkili düğümlere
  dokunmayanlar (K3, K2, K7, K4, K5), sonra P1 sıcak bölgeler (K6, K10, K14), sonra `writeAudit`/`t()` yoğun
  görevler (K9, K11, K12, K13, K15), en son K8 (Windows elle testi). Her birleştirme öncesi tam koşu: lint, typecheck,
  `format:check`, vitest unit + integration, Playwright (desktop + mobile), Go linux test + Windows CI.
- Her görev **tek commit dizisi** (`refactor(PT-Kn): …`, Conventional Commits) ve `git diff --name-only` ⊆ görev
  dosya listesi + `docs/implementation.md`.
- Görev, kendi dosyaları dışında bir değişiklik gerektiğini görürse durur ve mimara döner (dosya sahipliği değişir,
  tabloya işlenir).
- Güvenlik denetimi hafif tur: odak "davranış eşdeğerliği" — yetki/tenant guard, hız kovası, audit çağrılarının
  taşınırken düşmediği (§8 R-PT1). Sayfa testi tam tarama (UI bölündüğü için).

## 7. Kabul kriterleri eşlemesi (AC-317..AC-324 → kanıt)

| AC     | Kanıt / bileşen                                                                                                      | Görev               |
| ------ | -------------------------------------------------------------------------------------------------------------------- | ------------------- |
| AC-317 | Test listeleri baseline ↔ son (`docs/temizlik/sonuc.md`); tüm koşular yeşil; test dosyası diff denetimi              | K0, K17, qa         |
| AC-318 | `pt-surface.test.ts` (server rota tablosu, contracts ad kümesi, WS `type` listesi, hata kodları); `prisma/` diff boş | K1, K17             |
| AC-319 | vitest v8 + `go test -cover` paket başına, baseline ↔ son                                                            | K0, K17             |
| AC-320 | `pt-olcum.sh` boyut/uzunluk/karmaşıklık raporu, §5 hedef listesi                                                     | K4–K15, K17         |
| AC-321 | knip, deadcode, i18n ölü anahtar raporu                                                                              | K5, K7, K9–K15, K17 |
| AC-322 | jscpd raporu                                                                                                         | K2–K15, K17         |
| AC-323 | CI: lint, typecheck, format, go vet, staticcheck                                                                     | K4, K7, K16         |
| AC-324 | Görev başına `git diff --name-only` ⊆ §5 listesi; `docs/implementation.md` PT başlıkları                             | tümü, qa            |

## 8. Riskler

| #      | Risk                                                                                                                                                                    | Olasılık / etki | Önlem                                                                                                                                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-PT1  | İşlev çıkarırken gizli davranış değişikliği: `await` sırası, Prisma TX nesnesi yerine `db` kullanılması, `finally`/hata sınıfı kayması, audit/metrik çağrısının düşmesi | Orta / Yüksek   | Mekanik dönüşüm kuralı (§1-4); TX'li adımlar TX nesnesini parametre alır, kendi `db`'si olmaz; inceleme listesi: her taşınan blokta `writeAudit`/`metrics`/`rate` çağrı sayısı aynı (grep sayımı commit notunda) |
| R-PT2  | Windows'a özgü kod (K8, K5'in `_windows.go` kısmı) Linux'ta derlenmez/test edilmez                                                                                      | Orta / Orta     | Windows CI zorunlu; K8 için runbook duman testi (karşılama, paylaşım seçimi, firma ana ekranı, talep formu, tepsi); K8 atlanabilir (P3)                                                                          |
| R-PT3  | P20 düzeltmesi veya P27 başlangıcıyla çakışma                                                                                                                           | Orta / Orta     | PT P20 qa GEÇTİ'den sonra başlar; PT bitmeden P27 kodu başlamaz (P27 tasarım/güvenlik turu paralel yürüyebilir, kod yazmaz)                                                                                      |
| R-PT4  | knip yanlış pozitifi: Next özel export'ları, dinamik import, `exports` haritası                                                                                         | Orta / Düşük    | Silmeden önce grep; Next özel adları ve contracts dokunulmaz; typecheck + build                                                                                                                                  |
| R-PT5  | i18n dinamik anahtarlar (41 şablon önek) yanlışlıkla silinir → arayüzde ham anahtar                                                                                     | Orta / Orta     | Önekle eşleşen anahtar silinmez; silinen her anahtar için grep kanıtı; `lib/i18n.test.ts` + e2e                                                                                                                  |
| R-PT6  | Ortak fikstür testler arası durum paylaşımı yaratır, sıra bağımlılığı doğar                                                                                             | Düşük / Orta    | Yardımcılar saf; `stability.yml` 3 tekrar + rastgele sıra (`--sequence.shuffle`) koşusu                                                                                                                          |
| R-PT7  | Kapsam aracı (PT-D1) bağımlılık olarak reddedilir                                                                                                                       | Düşük / Düşük   | Geri dönüş: aynı ölçüm `scripts/pt-olcum.sh` içinde docker'da geçici kurulumla (repo dışı)                                                                                                                       |
| R-PT8  | e2e kararsızlığı gerilemeyle karıştırılır                                                                                                                               | Orta / Düşük    | Baseline'da kararsız test listesi (stability.yml) kaydedilir; kırmızıda 3 tekrar                                                                                                                                 |
| R-PT9  | Kapsam kayması ("buradayken düzelteyim")                                                                                                                                | Yüksek / Orta   | Hata düzeltmesi yasak; "PT bulguları" listesine yazılır, ayrı `fix:` işi; qa diff'te davranış değişikliği arar                                                                                                   |
| R-PT10 | 14 paralel görev → inceleme yükü, birleştirme çatışması `docs/implementation.md`'de                                                                                     | Orta / Düşük    | Sabit birleştirme sırası (§6); implementation.md yalnız ekleme                                                                                                                                                   |

## 9. Kararlar

| #     | Karar                                                                                                                                                                                                                            | Alternatif ve neden seçilmedi                                                                                                                                                  |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PT-D1 | TS kapsam ölçümü için `@vitest/coverage-v8` **5.1.0** (vitest ile aynı sürüm, aynı ekip, MIT, yalnız devDependency, imaja girmez). 3 kriter: ekip vitest'i biliyor; vitest ile birlikte bakılıyor; geri dönüş = paketi kaldırmak | Kapsamsız (yalnız test listesi eşitliği) — AC "coverage düşmez" ölçülemez. Docker'da geçici kurulum — her ölçümde ağ + sürüm kayması; geri dönüş yolu olarak tutulur (R-PT7)   |
| PT-D2 | Taşıma kuralı: dışa açık ad yerinde kalır, yalnız iç yardımcı taşınır (§1-3)                                                                                                                                                     | Adları yeni modüllere taşıyıp importları güncellemek — görevler arası dosya çakışması (testler, çağıranlar) ve büyük diff                                                      |
| PT-D3 | `apps/web/lib/*/contract.ts` cepheleri kalır; yalnız kullanılmayan adlar budanır                                                                                                                                                 | Cepheleri silip 56 import'u `@remote/contracts`'a çevirmek — belgelenmiş sınır kararını bozar, değer düşük                                                                     |
| PT-D4 | knip/jscpd CI'a eklenmez; elle `scripts/pt-olcum.sh`. staticcheck Go CI'a eklenir (K16)                                                                                                                                          | knip'i CI'da zorunlu kılmak — Next/vitest eklenti yanlış pozitifleri (bu ölçümde vitest yapılandırması yüklenemedi) gürültü üretir; Sonra: P23 sonrası yeniden değerlendirilir |
| PT-D5 | contracts'ta yalnız döngü kırma (K1); `api/requests.ts` 985 satır bölünmesi Sonra                                                                                                                                                | Şimdi bölmek — tüm tüketicilerin (server, web, e2e mock) aynı anda doğrulanmasını ister, P27 öncesi değer düşük                                                                |

**Genişleme noktası (dosya ≤ 300 kuralının kalıcılaşması):** PT dışında kalan 300–500 satırlık dosyalar "dokunan
böler" kuralıyla ele alınır: bir paket bu dosyalardan birine > 30 satır eklerse o paket dosyayı aynı kurallarla
böler (mimari turunda görev olarak yazılır). `scripts/pt-olcum.sh` her paketin kapanışında koşulur, sayılar
`docs/temizlik/` altında güncellenir; > 500 satırlık yeni üretim dosyası qa bulgusudur.

## 10. Tasarım kontrol listesi özeti (PT'ye uygulanan maddeler)

Kapsamda: test stratejisi (§7), geri alınabilirlik (her görev ayrı commit; `git revert` yeterli, migration yok),
gözlemlenebilirlik (log/metrik/audit adları değişmez), güvenlik (yetki/tenant guard taşınırken düşmez — R-PT1),
performans (sorgu ve TX sınırları değişmez). Kapsam dışı (davranış değişmediği için): veri modeli, API sözleşmesi,
env/config, yedek, KVKK, UI/a11y (DOM ve görünüm aynı; axe e2e taramaları mevcut haliyle kanıt), i18n içerik.
Bu nedenle `docs/tasarim-kontrol.md` güncellenmedi.

## 11. Açık kararlar

- K-PT-1: K8 (Windows UI) PT'de mi kalsın, P28 sonrasına mı ertelensin? Varsayılan: PT'de, en son; süre baskısında
  ertelenir (mimar + kullanıcı).
- K-PT-2: PT-D1 bağımlılığının kalıcı olması (sonraki paketlerin DoD'sine "kapsam düşmez" eklenmesi). Varsayılan: evet,
  ölçüm raporu olarak; eşik koymadan.
