# QA Raporu — P6 (Windows istemci) — Tur 2
DURUM: GEÇTİ (Tur 2, 2026-11-11 — Tur 1 bulguları kapandı; ayrıntı en altta "Tur 2" bölümü. Aşağıdaki Tur 1 içeriği tarihçe olarak korunmuştur.)

Önceki rapor: `docs/arsiv/p5-qa-raporu.md`. Kapsam: commit edilmemiş P6 değişiklikleri (`apps/agent-win/**`,
`apps/server/src/public/*` + testleri, `deploy/` Caddyfile/compose/`agent/verify-and-publish.sh`,
`.github/workflows/agent-win.yml` + `agent-watch.yml`, runbook §11, implementation.md P6 bölümleri).

## Test sonucu (2026-11-11, yerel)
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` | temiz (contracts, server, web) |
| `pnpm -r run typecheck` | temiz |
| `pnpm -r run test` | contracts 32/32, server 166/166, web 83/83; skip yok |
| `test-db.sh up` (kendi konteyner: `rs-mysql-qa6`, port 33386) + `pnpm --filter @remote/server test:int` | **21 dosya / 137 test yeşil**, skip yok; konteyner sonra silindi |
| Go (`golang:1.26.11-bookworm`, ayrı kopyada): `gofmt -l`, `go vet`, `go mod verify`, `go test -race -count=1 ./...`, `GOOS=windows go vet` | gofmt boş, vet temiz, modüller doğrulandı, **10/10 paket ok**, windows vet temiz |
| `govulncheck` (linux) | erişilebilir zafiyet 0. windows/amd64 taramasını koordinatörün kanıtı karşılıyor (go1.26.11 + x/net v0.60.0 sonrası 0) |
| `build/build.sh` ×2 (arada `go clean -cache`) | iki SHA-256 eşit `d8f7fc78…`, 11 798 016 B (≤ 40 MB), `MZ`, `UPX` izi yok, VERSIONINFO dolu (CompanyName/ProductName/FileVersion 0.6.0.0/LegalCopyright), manifest `asInvoker` + `permonitorv2,system`, ikilide `/src` veya `/Users` yolu yok |

İlk Go koşusunda `files` ve `signal` fixture testleri kırmızıydı. Neden, benim kopyamın dizin düzeniydi: `apps/` seviyesi yoktu, bu yüzden `../../../../packages` yolu çözülemedi. Düzen düzeltilince testler yeşil oldu, yani ürün hatası değil. Bu testler repo kökünün yapısına bağımlı ve CI'da bu yapı var.

## Kabul kriterleri
| AC | Durum | Kanıt / eksik |
|---|---|---|
| 27 (istemci + indirme ucu) | ⚠️ | İstemci tarafı ✅: `pairing.TestAC97FromFileName` (`Destek-<8>.exe`, ` (1)` eki, Unicode rakam red). İndirme ucu ✅: `agent-download.test.ts:50,62,84,95,107,122,137`. **Eksik:** web karşılamadaki birincil "Hızlı Destek uygulamasını indir" butonu ve SmartScreen rehberi yok (implementation.md:1110). Uç kullanıcıya ulaşmıyor → QA-P6-3 |
| 36 (istemci) | ✅ | `files.TestAC36WarningMatchesContractsFixture` (TS ile aynı fixture), `transfer.TestAC36RejectCooldownAndSingleOffer`. Diyalog davranışı Windows elle testinde |
| 37 / 56 (istemci, işaretleme) | ✅ (kod) / Windows elle | `dc.TestAC35AC56CtlValidMessages`. Overlay çizimi yalnız Windows'ta görülebilir |
| 52 | ✅ | `rtc.TestAC52SignalMappingVideoAndChat` (iki gerçek Pion eşi), `flow.TestAC106AC107HappyPath` (sohbet iki yönde) |
| 53 | ✅ | `dc.TestAC53MaxFileBytes`, `transfer.TestAC53ExceededCancels`, `TestAC53OverLimitAutoRejected` |
| 54 | ✅ | `dc.TestAC54ReceiverVerifiesSizeAndSHA256`, `transfer.TestAC54ReceiveVerifyRenameMOTW`, `TestAC54CorruptDeletesPart` |
| 55 | ✅ | `dc.TestAC55ReceiverGuardBoundaries`. İçerik yalnız DC'den geçer, WS'ye yalnız `file.meta` gider |
| 94 (istemci build) | ✅ (yerel) / Sonra | Workflow incelendi: Action'lar SHA ile sabit, varsayılan izin `contents: read`, `id-token`/`attestations` yalnız `attest` job'unda, `contents: write` yalnız `release` job'unda (`v*` + `environment`). Gate'ler: gofmt/vet/test-race/govulncheck/go-licenses. İki ayrı runner'da hash eşitliği aranıyor. Yerelde hash eşitliği kanıtlandı. Gerçek CI koşusu ve attestation, repo public olana kadar yapılamaz → Sonra |
| 95 | Windows elle testi bekliyor | Manifest `asInvoker` ikilide doğrulandı |
| 96 | ✅ (boyut, tek dosya, UPX yok, hash) / Sonra | ≤ 40 MB ve SHA256SUMS üretimi doğrulandı. Sunucuda hash uyuşmazlığında 503: `agent-download.test.ts:146`, `agent-binary.test.ts`. `gh attestation verify` ve "≤ 5 sn karşılama" → Sonra / Windows |
| 97 | ✅ | `pairing.TestAC97*`, `flow.TestAC97ManualCodeAfterInvalidAndNotFound`, `TestAC97ExpiredAndConsumedShowFinalMessage`, `api.TestAC97ResolveErrorEnvelopeNotRetried` |
| 98 | ❌ | Onaysız join yok: `flow.TestAC98NoJoinWithoutConsent`. Teknisyen, kod, sunucu, uyarı ve KVKK ekranda var. **Firma logosu yok** (implementation.md:939, 990) → QA-P6-1 |
| 103 (izleniyor) | ✅ (kod) / Windows elle | `overlay_windows.go:44` 1000 ms timer, `:73` `HWND_TOPMOST`, her monitörde bir pencere. Davranış Windows'ta gözle doğrulanmalı |
| 106 | ✅ (akış) / Windows elle | `flow.TestAC106AC107HappyPath`; gerçek monitör eşlemesi Windows'ta |
| 107 | ✅ | `flow.TestAC106AC107HappyPath`. `main.go` `closeDelay` 2,5 sn ≤ 3 sn |
| 108 | ⚠️ | `transfer.TestAC108CloseRemovesPart` var. Mimarinin iz testi betiği `apps/agent-win/test/trace-check.ps1` yazılmamış (§9, §10.3 DoD) → QA-P6-2. Kalan kısım Windows elle testi |
| 109 | ✅ | `config.TestAC109ParseAcceptsHTTPSOnly`, `TestAC109LoadWithoutLdflagsFails`, `api.TestAC109RejectsUntrustedCertificate`, `signal.TestAC109DialRejectsUntrustedCertAndBadCredential`. Kodda `os.Args`, `Getenv`, `flag` ya da registry kullanımı yok (grep). Proxy env yalnız tüneli etkiler, TLS sunucu adına doğrulanır (implementation.md:871, gerekçeli) |
| 110 | Windows elle testi bekliyor | Arayüz metinleri Türkçe. DPI kodu `GetDpiForWindow`/`WM_DPICHANGED` kullanıyor |
| 112 (istemci UI) | ✅ | `flow.TestAC112LobbyRejected`, `signal.TestAC112ServerMessagesMatchContractsFixture`, `TestLobbyCancelSendsSessionEnd` |
| 117 (Go) | ✅ / Windows elle | `files.TestAC117SanitizeMatchesContractsFixture` (TS ile aynı fixture), `TestAC117InvalidUTF8AndLength`, `TestAC54AvailableNameNoOverwrite`. MOTW yalnız sahte fonksiyonla test ediliyor, gerçek ADS yazımı Windows'ta denenmeli (QA-P6-4) |
| 118 | Windows elle testi bekliyor (Procmon) | `dllsafe.Harden` `main`'in ilk işi. Yalnız `NewLazySystemDLL` kullanılıyor, `NewLazyDLL`/`LoadDLL` yok (grep) |
| 119 (Go) | ✅ | `dc.TestAC119CtlRejectsInvalidAndControl`, `rtc.TestAC119FileOfferRejectedWithoutCap`, `signal.TestAC119GuestOutboundMatchesContractsFixture` |
| 125 (istemci) | ✅ (kod) / Windows elle | Uyarı metni ve `screens_windows.go:159-184` "Kötüye kullanımı bildir" → `mailto:`. `ABUSE_EMAIL` boşsa buton gizleniyor. AC-25 ile aynı davranış |
| 128 | ✅ (istemci + gözcü kodu) / Sonra | `config.TestAC128FingerprintIsFirst8HexOfSHA256`. Alt satırda sunucu, sürüm ve parmak izi var (`screens_windows.go:75`). `agent-watch.yml` günlük çalışır ve uyuşmazlıkta issue açar (`issues: write` yalnız ilgili job'da). Gözcünün gerçek koşusu için repo public olmalı → Sonra |

## Düzeltilmeli
1. **QA-P6-1 · Orta · AC-98 · [backend-dev (Go)]** `apps/agent-win/internal/ui/screens_windows.go` karşılama ekranı (~:150-190) ve `internal/flow/flow.go:161` civarı. Karşılamada firma logosu yok. Beklenen: resolve yanıtındaki `logoUrl`, yalnız yapılandırılmış sunucu alan adından (aynı `http.Client`, TLS doğrulamalı, boyut sınırlı, yalnız PNG/JPG) indirilip gösterilmeli. Logo yoksa ya da indirilemezse sistem logosu (Nokta) gösterilmeli. `flow` testine "karşılama verisinde logo URL'si yalnız sunucu host'undan" kontrolü eklenmeli.
2. **QA-P6-2 · Orta · AC-108 (DoD §10.3) · [devops]** `apps/agent-win/test/trace-check.ps1` yok. Beklenen: betik HKCU/HKLM `Software`, servisler, zamanlanmış görevler, Startup klasörü, `%APPDATA%`, `%LOCALAPPDATA%` ve `%TEMP%` için çalıştırma öncesi ve sonrası fark alsın; istemciye ait iz bulursa çıkış kodu ≠ 0 versin. Kullanımı runbook §11'e eklenmeli. Betiğin koşturulması Windows elle testinde yapılır.
3. **QA-P6-3 · Orta · AC-27 · [frontend-dev] (paket ataması için proje-yoneticisi)** `apps/web/app/session/[token]/` karşılama. Windows masaüstünde birincil buton "Hızlı Destek uygulamasını indir" (`href="/api/v1/public/agent/download?ref=<sessionRef>"`) ve aynı adımda SmartScreen "Ek bilgi → Yine de çalıştır" rehberi olmalı. İkincil seçenek tarayıcı modu olmalı. macOS/Linux'ta yalnız tarayıcı modu sunulmalı. 503 `NOT_READY` alınırsa tarayıcı moduna yönlendirilmeli. Bu buton olmadan P6 indirme ucu dikey olarak tamamlanmış sayılmaz. Buton P6 dışında kalacaksa proje-yoneticisi AC-27'yi hangi pakete verdiğini mimari §11'e işlemeli.
4. **QA-P6-4 · Düşük · AC-117/118 · [backend-dev (Go)]** Windows'a özel birim testi yok. CI `test-windows` job'u yalnız platformdan bağımsız testleri koşuyor. Beklenen: `internal/files/motw_windows_test.go` (geçici dosyaya `WriteMOTW` → `:Zone.Identifier` okununca `ZoneId=3`) ve `internal/dllsafe/dllsafe_windows_test.go` (`Harden` hatasız döner).
5. **QA-P6-5 · Düşük · sözleşme · [mimar]** `docs/mimari-api.md:92` hâlâ "302 → `/downloads/NoktaDestek.exe` + Content-Disposition" diyor. Kodda hedef `/downloads/Destek-<kod>.exe`. Sapma implementation.md:1080-1086'da teknik olarak doğru gerekçelendirilmiş (tarayıcılar 3xx yanıtındaki Content-Disposition'ı yok sayar), ancak sözleşme güncellenmemiş. Beklenen: mimari-api ve ADR-0006 güncellenmeli. Ayrıca ADR-0004:18'deki "%TEMP%\NoktaDestek-<rand>" ve "müşterinin seçtiği klasör" ifadeleri uygulanan kararla (İndirilenler, %TEMP% yazımı yok; implementation.md:935-937) eşitlenmeli.

## Sonra / Windows elle testi (DÜZELTİLMELİ sebebi değil)
- AC-95 UAC'siz çalışma; AC-96 çift tıktan karşılamaya ≤ 5 sn; SmartScreen "Yine de çalıştır" yolu (DoD).
- AC-118 Procmon'da Downloads klasöründe DLL araması 0; G-06 alınan dosyada `Zone.Identifier`.
- AC-103 gösterge her monitörde ve 1 sn'de en üste; AC-106 gerçek monitör eşlemesi; AC-110 %100/%125/%150 ölçek.
- AC-108 iz testi (QA-P6-2 betiğiyle); gerçek DXGI + MF yakalama, FPS ve donanım/yazılım MFT (implementation.md adım 15-24).
- AC-94/96/128: gerçek CI koşusu, iki runner hash eşitliği, `gh attestation verify`, agent-watch koşusu. Repo private olduğu için attestation yok; repo public olunca doğrulanacak (implementation.md:1150).
- SignPath başvurusu (süreç işi, kullanıcıda).

## Definition of Done (P6, mimari §10.3)
| Madde | ✅/❌ | Not |
|---|---|---|
| İki CI build'inin SHA-256'sı eşit | ✅ yerel / Sonra CI | Yerelde `d8f7fc78…` ×2. Workflow iki ayrı runner'da karşılaştırıyor |
| `SHA256SUMS` Release'de | ✅ (workflow) / Sonra | `reproducible` + `release` job'ları |
| UPX/packer yok | ✅ | grep 0; CI'da gate var |
| versioninfo dolu | ✅ | strings ile doğrulandı. CI bunu kontrol etmiyor (Öneri 1) |
| ≤ 40 MB | ✅ | 11,8 MB; CI'da gate var |
| SmartScreen yolu, UAC'siz, Procmon, Zone.Identifier | Windows elle | yukarıdaki liste |
| `trace-check.ps1` temiz | ❌ | betik yok (QA-P6-2) |
| `go test` yeşil | ✅ | 10/10 (-race) |
| `gh attestation verify` | Sonra | repo private |
| `--server`/env ile URL değiştirilemiyor | ✅ | config yalnız ldflags; testli |
| İndirme ucu entegrasyon testi (302 / 410 / 404 / 429) | ✅ | `agent-download.test.ts`, 137/137 |
| Lint / typecheck / test | ✅ | |
| Tüm AC'ler testle kanıtlandı | ❌ | AC-98 ❌, AC-27 ve AC-108 ⚠️ |
| Sapmalar implementation.md'de gerekçeli | ✅ | Sözleşme dokümanı senkronu açık (QA-P6-5) |
| Yeni bağımlılık gerekçesi | ✅ | Pion, coder/websocket, x/sys (§10.4); go-winres yalnız build aracı olarak gerekçeli. AGPL/GPL yok (go-licenses gate'i var) |

## Öneriler (zorunlu değil)
1. [devops] `agent-win.yml` `reproducible` job'una VERSIONINFO kontrolü eklenebilir (ör. `strings -el | grep FileVersion`).
2. [devops/güvenlik] Caddy `http.log.error`, upstream hatasında tam URI'yi (`ref`, `/session/<token>`) filtresiz yazıyor (implementation.md:1115-1117). G-10 kapsamında güvenlik raporunda ele alınmalı.
3. [backend-dev (Go)] Desktop Duplication imleci kareye çizmiyor. P7 (uzaktan kontrol) öncesinde `GetFramePointerShape` eklenmeli.
4. [backend-dev (Go)] Win32 istemcide koyu tema yok (ortak standart 1.6). Ya ayrı iş olarak planlanmalı ya da kapsam dışı olduğu gerekçeyle yazılmalı.
5. Go fixture testleri repo düzenine (`../../../../packages`) bağlı. Kök dizin yoksa anlaşılır bir hata mesajı vermeleri iyi olur.

## Olumlu
- Platformdan bağımsız çekirdek (flow/rtc/transfer/signal/dc) yüksek kapsamla test edilmiş. Gerçek iki Pion eşiyle WebRTC testi var; TS ile ortak fixture'lardan sözleşme uyumu kanıtlanıyor.
- AC-109 sıkı uygulanmış: yalnız ldflags; TLS reddi hem HTTP hem WS için testli; yönlendirme izlenmiyor; join tekrar denenmiyor.
- İndirme ucu fail-closed (hash uyuşmazlığında 503) ve resolve ile aynı başarısız deneme kovalarını kullanıyor. ref/kod log ve audit'e yazılmıyor, bu da testli.
- CI en az yetkiyle kurulmuş: SHA ile sabit Action'lar, iki ayrı runner'da tekrarlanabilirlik, yazma izinleri yalnız ilgili job'larda. Operatör makinesinde attestation doğrulaması (G-07) yapılıyor.


---

# Tur 2 — 2026-11-11
DURUM: GEÇTİ

## Test sonucu (yerel, bu turda koşturuldu)
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` | temiz (çıkış 0) |
| `pnpm -r run typecheck` | temiz (çıkış 0) |
| `pnpm -r run test` | contracts 32/32 · server (unit) 178/178 · web 99/99 · skip 0 |
| `pnpm test:int` (server; geçici `qa-p6t2-mysql` konteyneri, port 33419, `test-db.sh up/down`, iş bitince silindi) | 21 dosya, 142/142, skip 0 |
| Go (docker `golang:1.26.11-bookworm`, repo kökü mount): `go vet ./...`, `go test -race -count=1 ./...` | 12/12 paket ok (api, capture, config, dc, files, flow, pairing, rtc, signal, transfer, ui, win) |
| `GOOS=windows go vet ./...` + `GOOS=windows go test -c` (files, dllsafe, transfer) | temiz; Windows testleri derleniyor. **Koşumu yalnız CI `test-windows` (windows-2025)**, burada koşturulamadı |
| `build/build.sh https://destek.example.com 1.0.0` ×2 | SHA-256 eşit: `ac0e5c1b64ac7848eb1f38701232c1e928d795cc285bd9ad2b22fc6210ed7dca` (ikisi de) |
| `pnpm --filter @remote/web e2e e2e/p6-agent-download.spec.ts` | 7 geçti / 7 atlandı / 0 kalan. Atlananların hepsi gerekçeli proje ayrımı: Windows/macOS senaryoları `mobile` projesinde, mobil senaryo `desktop` projesinde `test.skip` |

## Tur 1 bulgularının doğrulaması
| Bulgu | Durum | Kanıt |
|---|---|---|
| QA-P6-1 (AC-98 logo) | ✅ kapandı | `internal/api/logo.go`: `LogoURL` yalnız kök-göreli yol ya da gömülü sunucuyla aynı şema+host+port kabul ediyor (`//host`, userinfo, fragment, opaque, ters bölü, CR/LF red; çözümden sonra köken yeniden denetleniyor). `Logo` aynı TLS'li istemci (yönlendirme izlenmiyor), yalnız 200 + `image/png`/`image/jpeg` + aynı türün sihirli baytları, ≤ 2 MB (Content-Length ve okunan bayt), çözmeden önce ≤ 2048 px. `ui/logo.go`: gömülü `nokta-kucuk.png` sistem logosu. `screens_windows.go:155-160`: `w.Logo` nil ise sistem logosu. `flow.go:173,201-207`: 3 sn üst süre, her hatada nil. `main.go:81` `Logo: client.Logo` bağlı. Testler: `flow.TestAC98WelcomeLogoOnlyFromServerHost` (göreli ve aynı köken → indirilir; `https://evil.example`, `//evil.example` → indirme çağrısı yapılmaz, Logo nil), `TestAC98WelcomeLogoFetchErrorFallsBack`, `api.TestAC98LogoURLOnlySameOrigin`, `TestAC98LogoDownloadedWithLimits` (httptest; boyut, piksel, tür, köken), `TestAC98DecodeLogoChecksMagicBytes`. Not: sunucu resolve'da `logoUrl: null` dönüyor (`apps/server/src/sessions/public.ts:214`, logo servisi P9). Uçtan uca firma logosu P9'da görünür olacak; o zamana kadar sistem logosu gösterilir. Bu, mimarideki paket planına uygun |
| QA-P6-2 (trace-check) | ✅ kapandı | `apps/agent-win/test/trace-check.ps1` (265 satır, salt okunur): HKCU/HKLM `Software` (+WOW6432Node), Run/RunOnce, servisler (ImagePath), zamanlanmış görevler (eylem komutu), kullanıcı ve ortak Startup (.lnk hedefi), `%APPDATA%`, `%LOCALAPPDATA%`, `%TEMP%`, İndirilenler'de `*.part`, açık süreç. Snapshot, Compare ve Check modları var. Çıkış kodları: 0 temiz, 1 iz, 2 kullanım hatası. CI `agent-win.yml` `test-windows`: yer tutucu `.invalid` adresli exe derleniyor, snapshot alınıyor, exe çalıştırılıp WM_CLOSE ile kapatılıyor, sonra Compare koşuyor ve iz bulunursa job kırmızı oluyor. Runbook §11.8 ve sorun tablosu (runbook.md:504, 515) eklenmiş. CI koşusu burada görülemedi (Sonra) |
| QA-P6-3 (AC-27 web) | ✅ kapandı | `agent-download.tsx`: birincil "Hızlı Destek uygulamasını indir" bağlantısı (`/api/v1/public/agent/download?ref=`) + aynı adımda SmartScreen rehberi; tarayıcı yolu ikincil. `p6-agent-download.spec.ts` gerçekten kriterleri ölçüyor: href biçimi, rehberde "Ek bilgi"/"Yine de çalıştır"/"imzasız", birincil seçeneğin tarayıcı yolundan önce gelmesi, ≥ 44 px, indirilen dosya adı `^Destek-\d{8}\.exe$`, sayfanın yerinde kalması, 503 → uyarı + "Tarayıcıdan devam et" + odağın ad alanına gitmesi (indirme yok), 410 → iptal ekranı, macOS'ta ve mobilde indirme seçeneğinin olmaması, 375 px'te taşma olmaması, açık ve koyu temada axe 0. Linux yolu e2e'de yok, birim testte (`lib/device-support.ts` testleri) var. Sapmalar implementation.md "Frontend P6" bölümünde gerekçeli |
| QA-P6-4 (Windows testleri) | ✅ kod / CI'da koşacak | `files/motw_windows_test.go` (gerçek ADS'de `[ZoneTransfer]` + `ZoneId=3`, ana akış değişmiyor), `dllsafe/dllsafe_windows_test.go` (`Harden` iki kez hatasız, System32 DLL'i yükleniyor), `transfer/rename_windows_test.go` (S6-3: MOTW `.part`'tan `MoveFileEx` ile taşınıyor, hedef varken `errExists` dönüyor, üzerine yazılmıyor). Üçü de `GOOS=windows` ile derleniyor. Yeşil oldukları yalnız CI `test-windows` koşusunda görülecek (bu ortamda Windows yok) |
| QA-P6-5 (sözleşme) | ✅ kapandı | `mimari-api.md:92`: 302 → `/downloads/Destek-<8 hane>.exe`, 302'de Content-Disposition yok, son yanıtta Caddy `attachment`; S6-2 kapısı (`forward_auth` → `/internal/agent-ready`) eklenmiş. `ADR-0004` r2 (satır 2, 17, 19): `%TEMP%` yazımı yok, İndirilenler + `.part`, Kaydet diyaloğu yok, proxy kararı. Eski "%TEMP%\NoktaDestek-<rand>" ve "müşterinin seçtiği klasör" metinleri kalmadı (grep 0). `ADR-0006` r3 (satır 2, 7) güncel. `gereksinimler.md:115` İstemci NFR'si ADR-0004 r2 ile eşit |

## Güvenlik düzeltmeleri (S6-1..8): AC etkisi
Tüm testler yeşil; hiçbir AC kırılmadı.
- **S6-1:** `uintptr` dönüşümleri yalnız `Call` argümanında; `win.unsafeptr_test.go` AST taramasıyla bunu koruyor. Davranış değişikliği yok.
- **S6-2:** `/downloads/*` için `forward_auth` + 503 kapısı. AC-27 akışı için web ön kontrolü aynı 503'ü uyarıya çeviriyor (e2e 503 testi). Caddy zinciri e2e'de mock ile sınanıyor, gerçek Caddy ile değil (Sonra).
- **S6-3:** MOTW `.part`'a yazılıyor, üzerine yazılmayan rename yapılıyor. MOTW yazılamazsa tehlikeli dosya teslim edilmiyor. Bu AC-36/54/117'yi daraltıyor, kırmıyor (`transfer_test` + Windows testi).
- **S6-6:** Proxy davranışı korundu, ADR-0004 r2'de karar olarak yazıldı. AC-109 (yalnız ldflags URL) testleri yeşil.
- **S6-7:** Geçersiz `abuseEmail` → bağlantı gizleniyor (sunucunun null davranışıyla aynı). ICE kuyruğu 64 ile sınırlı (`rtc` testi).
- **S6-8:** Uzantı listesi genişledi; `TestS68DangerousExtMatchesContracts` Go ve TS listelerini birebir karşılaştırıyor. Server fixture testi yeşil.

## Kabul kriterleri (Tur 1'de açık kalanlar)
| AC | Durum | Kanıt |
|---|---|---|
| 27 | ✅ | `agent-download.test.ts` (uç, entegrasyon) + `p6-agent-download.spec.ts` (6 masaüstü + 1 mobil senaryo) + `pairing.TestAC97FromFileName` |
| 98 | ✅ | `flow.TestAC98NoJoinWithoutConsent`, `TestAC98WelcomeLogoOnlyFromServerHost`, `TestAC98WelcomeLogoFetchErrorFallsBack`, `api.TestAC98*` (3). Firma logosunun uçtan uca görünmesi P9 logo servisine bağlı (yukarıdaki not) |
| 108 | ✅ (otomatik kısım) / Windows elle | `transfer.TestAC108CloseRemovesPart` + `trace-check.ps1` + CI iz adımı. Tam senaryo (dosya aktarımlı oturum) runbook §11.8 elle testi |
| 117/118 | ✅ (Go) / CI-Windows | Tur 1 kanıtları + Windows ADS/Harden testleri (CI'da koşacak) |
Tur 1'de ✅ olan diğer AC'ler bu turda yeniden koşturulan testlerle yeşil kaldı.

## Düzeltilmeli
Yok.

## Definition of Done (Tur 2 güncellemesi)
| Madde | ✅/❌ | Not |
|---|---|---|
| İki build SHA-256 eşit | ✅ yerel / Sonra CI | `ac0e5c1b…` ×2 |
| `trace-check.ps1` temiz | ✅ betik + CI adımı / Sonra | İlk yeşil CI koşusu ve VM elle testi bekleniyor |
| `go test` yeşil | ✅ | 12/12 paket (-race); Windows testleri derleniyor, CI'da koşacak |
| Lint / typecheck / test / entegrasyon / e2e (p6) | ✅ | 32 + 178 + 99 + 142 + 7 (7 skip gerekçeli) |
| Tüm AC'ler testle kanıtlandı | ✅ | Windows'a özgü kısımlar elle teste ayrıldı |
| Sapmalar gerekçeli, sözleşme senkron | ✅ | QA-P6-5 kapandı |
| Yeni bağımlılık | ✅ | Yeni bağımlılık yok (stdlib `image/png`, `image/jpeg`) |
Diğer DoD maddeleri Tur 1'deki gibi.

## Sonra / Windows elle testi ve CI (DÜZELTİLMELİ sebebi değil)
- CI `test-windows`'un ilk yeşil koşusu: Windows birim testleri (MOTW ADS, Harden, MoveFileEx) ve trace-check adımı. CI'da exe pencere açamazsa adım `::warning::` verip süreci zorla sonlandırıyor; bu durumda iz testi yalnız açılış-kapanış izini ölçmüş olur.
- AC-108 tam iz testi: dosya aktarımlı oturum, ardından trace-check Compare (runbook §11.8).
- Gerçek Caddy ile S6-2 kapısı: hash uyuşmazlığında `/downloads/Destek-<kod>.exe` → 503.
- Tur 1 "Sonra" listesindeki diğer maddeler (UAC, ≤ 5 sn, SmartScreen, Procmon, monitör/ölçek, attestation) aynen geçerli.

## Öneriler (zorunlu değil)
1. [backend-dev, P9] Ortak standart 1.5 WEBP logo yüklemeye izin veriyor, ancak istemci yalnız PNG/JPG kabul ediyor. P9'da logo ucu PNG/JPG'ye dönüştürüp sunmalı ya da bu kısıt mimari-api'ye yazılmalı. Aksi halde WEBP logolu firmada istemci sessizce sistem logosunu gösterir.
2. [frontend-dev] `agent-download.tsx:72` `active:scale-[0.99]` standarttaki 0.97'den farklı; `:153` `align-[-3px]` ham px. İkisi küçük token sapması.
3. [devops] `trace-check.ps1` saf fonksiyonları (`Compare-TraceSnapshot`, `Test-TraceEntry`) nokta-kaynakla test edilebilir yazılmış, ancak Pester testi yok. CI'da küçük bir Pester testi eklenebilir.

## Olumlu
- Logo indirme derin savunmalı: köken çözümden sonra yeniden denetleniyor, sihirli bayt ve tür eşleşmesi aranıyor, sıkıştırma bombasına karşı önce `DecodeConfig`, yalnız tek türün çözücüsü kullanılıyor.
- S6-8 için Go ve TS listeleri artık birebir karşılaştırılıyor; Tur 1'deki "fixture yalnız örnek içeriyor" açığı kapandı.
- e2e testleri AC metnini gerçekten ölçüyor (dosya adı deseni, odak taşınması, sıralama, 44 px hedef, iki temada axe).
