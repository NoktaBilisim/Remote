# Güvenlik Raporu — İstemci 0.10.2 — Tur 2

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 0 / Düşük 1

Kapsam: yalnız `apps/agent-win/`. Tur 1 bulgularının düzeltmeleri, `internal/diag/{diag,reparse,reparse_windows}.go`, `cmd/noktadestek/main.go:88-95`, `internal/remember/remember.go:42-47,169-182`, `internal/capture/select.go`, `go.mod`. Denetim kod okuması ve Linux'ta (docker) test ile yapıldı; Windows'ta çalıştırılmadı.

## Tur 1 bulgularının durumu

| Tur 1                                              | Durum                                  | Kanıt                                                                                                                                                                                                                                                                              |
| -------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ORTA — kod modunda tanılama logu (AC-108/ADR-0004) | **KAPANDI**                            | `main.go:94` `diag.NewLog(store.Dir, selfElevated, store.Persistent)`. `diag.go:179-183`: elevated, dir boş ya da persistent nil ise `nil` döner. `diag.go:209`: `Enabled()` **her yazımda** sorulur. `remember.go:44-47`: `Persistent()` = dosyada `Personal` veya `Binding` var. |
| DÜŞÜK — CWE-59 reparse (yükseltilmiş süreç)        | **KAPANDI** (TOCTOU kalıntısı aşağıda) | `diag.go:180`: yükseltilmiş süreçte log tamamen kapalı. Ek olarak `diag.go:223-233` klasör, dosya ve `.1` için `Lstat` + `isReparse` denetimi yapılıyor. `reparse_windows.go:11-19`: `ModeSymlink                                                                                  | ModeIrregular`ya da`FILE_ATTRIBUTE_REPARSE_POINT`. |

**Kod modunda iz oluşmadığının koddan doğrulanması:**

- Agent-win içinde dosya/klasör oluşturan çağrılar `git grep`/`grep` ile tarandı. Sonuç: `diag.go:226,241`, `remember.go:143,147,150`, `transfer.go:135` (kullanıcının İndirilenler klasörüne alınan dosya; tasarım gereği) ve `motw_windows.go:14` (aynı dosyanın ADS'i).
- `diag.Write` çağrısında `MkdirAll` ve `OpenFile` adımları, `Enabled()==false` dönüşünden (`diag.go:209-211`) **sonra** geliyor. Kod modunda `Persistent()` false olduğu için klasör de dosya da oluşmaz.
- `Persistent()` → `Load()` yalnız `os.Open` (okuma) yapar. Bozuk dosyada `forgetAll` yalnız siler (`remember.go:169-182`), hiçbir şey oluşturmaz.
- `capture.Opener.write` `o.Log == nil` durumunda hemen döner (`source_windows.go:80-82`). `probeSystem` yalnız bellekte çalışır.
- Sonuç: kod modunda (kayıt yok, "hatırla" yok) istemci `%LOCALAPPDATA%\NoktaDestek` altında dosya ya da klasör oluşturmaz.
- Not: aynı oturumda müşteri sonradan "hatırla"yı seçerse `SavePersonal` sonrasında `Persistent()` true olur ve sonraki yakalama sorunları loglanır. Bu, kalıcı modun tanımına uygundur.

## Bulgular

### [DÜŞÜK] Reparse denetiminde TOCTOU kalıntısı; `remember` deposu yükseltilmiş süreçte hâlâ korumasız — A01 / CWE-367, CWE-59

Yer: `apps/agent-win/internal/diag/diag.go:223-245`; `apps/agent-win/internal/remember/remember.go:143-163,169-182`; `internal/launch/run.go:123`

Sorun:

- (1) `safe()` (`Lstat`) ile `os.Rename` / `os.OpenFile` arasında pencere var. Klasör ya da dosya bu arada junction veya symlink ile değiştirilebilir.
- `diag.go:245` kontrolü (`f.Stat` + `isReparse`) bu durumu yakalamaz. `os.OpenFile` bağlantıyı izlemiş olur ve handle hedef dosyanın özniteliklerini döndürür.
- `FILE_FLAG_OPEN_REPARSE_POINT` ile açma ve `GetFileInformationByHandle` doğrulaması yapılmıyor.
- (2) `remember.Store` (`hatirla.bin` yazma/silme; `forgetAll` artık `tanilama.log` ve `.1`'i de siliyor) yükseltilmiş süreçte hâlâ çalışıyor ve reparse denetimi yok.

İstismar senaryosu:

- (1) Tanılama logu yalnız **yükseltilmemiş** süreçte yazılıyor. Saldırgan zaten aynı kullanıcı haklarına sahip. Yarışı kazansa da yetki kazanmaz, sonuç en fazla kendi dosyasına ekleme olur. Pratik etkisi yok (bilgi düzeyi).
- (2) İstemci "Yönetici olarak çalıştır" ile açılır. Aynı oturumdaki orta bütünlüklü (medium IL) bir süreç `NoktaDestek` klasörünü `\RPC Control` junction'ı ile değiştirir. "Bu bilgisayarı unut" (`ForgetAll`) ya da bozuk `hatirla.bin` sonrası `forgetAll`, yönetici yetkisiyle keyfi dosya silmeye dönüşebilir.
- Bu davranış 0.10.2 öncesinden beri var; yeni dosya adları yalnız hedef sayısını artırıyor.
- Microsoft aynı kullanıcının UAC'ını güvenlik sınırı saymaz ve saldırganın zaten kullanıcı oturumunda olması gerekir. Bu yüzden önem derecesi Düşük.

Düzeltme (backend-dev, "Sonra"):

- `remember.DefaultStore` için de `SelfElevated` durumunda salt-okunur ya da kapalı mod uygulanır, veya yazma/silme öncesinde `diag.safe` eşdeğeri denetim yapılır.
- Tam çözüm: dosyaları `CreateFile(FILE_FLAG_OPEN_REPARSE_POINT)` ile açıp handle'ı doğrulamak, silmeyi handle üzerinden yapmak (`FILE_DISPOSITION_INFO`).
- Önerilir: `docs/gereksinimler.md` §9 "Sonra" listesine eklenmesi.

## Diğer değişiklik — `select.go` BGRA dışı yüzey

- `dxgi_windows.go:276-277`: ilk karede yüzey formatı `B8G8R8A8` veya `_SRGB` değilse `ReasonDXGIUnsupported` dönüyor.
- `select.go:102-105` (`awaitFirst`): kaynak kapatılıp hemen dönülüyor. `select.go:57-65`: DXGI1 deneniyor.
- Güvenlik açısından olumlu: FP16 (8 bayt/piksel) yüzeyin BGRA (4 bayt) olarak yorumlanması engelleniyor; dönüşümde hatalı boyut ya da pitch ile bellek okuma riski kalkıyor.
- Hata yolunda kaynak sızıntısı yok (`g.close()`).

## Otomatik tarama çıktıları

- **govulncheck** v1.9.0, `GOOS=windows`, `-show verbose ./...`. İmaj: `golang:1.26.11-bookworm@sha256:dc40a13b…`.
  - Sonuç: **"No vulnerabilities found."**
  - Modüller: `golang.org/x/crypto@v0.59.0`, `golang.org/x/net@v0.62.0`, `golang.org/x/sys@v0.50.0`.
  - Tur 1'de modül düzeyinde görülen GO-2026-6866, GO-2026-6860 ve GO-2026-5932 artık listelenmiyor.
- **gitleaks** v8.30.1, `dir /repo/apps/agent-win --redact --config .gitleaks.toml`: `GITLEAKS_EXIT=0`.
- **Gizli bilgi grep'i** (`git grep -nE … -- apps/agent-win`): eşleşme yok (exit 1).
- **Testler** (docker): `go test -count=1 ./internal/{diag,capture,remember,flow}` sonucu hepsi `ok`. `GOOS=windows go vet ./internal/{diag,capture,remember} ./cmd/...` temiz.

## Tasarımda vaat edilip kodda bulunmayanlar

- Yok. AC-108/AC-138 "kod modunda iz yok" kuralı koddan doğrulandı. Windows'ta `trace-check.ps1 -Diagnostics off` ile çalıştırılarak ayrıca teyit edilmesi önerilir (test-operatoru).

## Olumlu

- Log kapısı her yazımda yeniden değerlendiriliyor; "Bu bilgisayarı unut" sonrasında log anında kapanıyor.
- Yükseltilmiş süreçte log tamamen kapalı; savunma derinliği için ayrıca `Lstat` denetimi var.
- Bağımlılıklar güncel; erişilebilir ya da modül düzeyinde zafiyet yok.

---

# [Tur 1] Güvenlik Raporu — İstemci 0.10.2 (ekran yakalama tanılama + DXGI1 + GDI yedeği)

DURUM: GEÇTİ
Özet: Kritik 0 / Yüksek 0 / Orta 1 / Düşük 1

Kapsam: yalnız `apps/agent-win/` değişiklikleri (git diff + yeni dosyalar `internal/capture/{reason,select,gdi_windows,sysinfo_windows}.go`,
`internal/diag/`, `internal/flow`, `internal/remember`, `cmd/noktadestek/main.go`, `test/trace-check.ps1`) ve
`docs/implementation.md` "Düzeltme — istemci 0.10.2" bölümü. Sunucu, web ve contracts kapsam dışıdır.
Denetim yalnız kod okuması ve Linux'ta (docker) test ile yapıldı. Windows'ta çalıştırılarak doğrulanmadı.

## Bulgular (öncelik sırasıyla)

### [ORTA] Tanılama logu AC-108 / ADR-0004 "tek istisna" ilkesini onay ve tasarım kararı olmadan genişletiyor — A04 Insecure Design

Yer: `apps/agent-win/cmd/noktadestek/main.go:90-104`, `apps/agent-win/internal/capture/source_windows.go:66,118,158,169`, `apps/agent-win/internal/diag/diag.go:176-207`
Sorun:

- AC-108 ve AC-138 (ADR-0004 r3/r4) iz kuralını koyar. Buna göre istemcinin `%LOCALAPPDATA%` altında bırakabileceği tek dosya, müşterinin "hatırla" seçimiyle yazılan `hatirla.bin`'dir.
- 0.10.2 ile `tanilama.log` ve `tanilama.log.1` dosyaları yakalama sorunu yaşanınca yazılıyor. Bu, kod modunda (tek seferlik oturum) ve müşteri "hatırla"yı seçmemişken de oluyor. Dosyalar oturumdan sonra süresiz kalıyor.
- Müşteriye dosyanın yazıldığı söylenmiyor.
- `implementation.md` "sorunsuz oturumda dosya oluşmuyor, AC-108 bozulmuyor" diyor. Ama AC-108 koşulsuz bir kuraldır: sorunlu makinede iz testi (`trace-check.ps1 -Diagnostics off`) başarısız olur.
- ADR-0004 revizyonu veya AC değişikliği yok. Mimarın ve PM'in kararı alınmamış.
- İçerik kişisel veri değildir (bkz. Olumlu). Risk; gizlilik vaadinin ("iz bırakmaz") ve kabul kriterinin sessizce değişmesidir.

İstismar senaryosu: Saldırı değil, uyum riski.

- Paylaşılan veya kiosk bir bilgisayarda kod moduyla destek alınır.
- Yakalama sorunu yaşandıysa makinede NoktaDestek'e ait bir klasör ve log kalır. Klasör, destek alındığını ve donanım parmak izini (GPU vendor/aygıt kimliği, Windows build, monitör çözünürlükleri, zaman damgası) ortaya koyar.
- Bu, datasheet ve kılavuzdaki "iz bırakmaz" iddiasıyla çelişir.

Düzeltme (birini seçin):

- (a) **mimar + proje-yoneticisi:** ADR-0004'e r5 eklenir: tanılama logu ikinci istisna olur; sınırı ≤ 256 KB'dir ve kişisel veri içermez. AC-108/AC-138 metni güncellenir. Kılavuza ve datasheet'e "yakalama sorunu olursa yerel tanılama dosyası" notu eklenir (teknik-yazar).
- (b) **backend-dev:** Log yalnız kalıcı mod etkinken yazılır (bilgisayar kaydı veya "hatırla" açık). Kod modunda `diag.Log` nil verilir; neden kodu yine durum satırında görünür.

Hangi seçenek seçilirse seçilsin, `-Diagnostics on` iz testi beklentisi buna göre belgelenir.

### [DÜŞÜK] Yükseltilmiş süreç kullanıcı-yazılabilir klasörde reparse point'leri izleyerek oluşturuyor, taşıyor ve siliyor — A01 / CWE-59

Yer: `apps/agent-win/internal/diag/diag.go:190-201` (`MkdirAll`, `Stat` → `Rename(.1)`, `OpenFile(O_CREATE|O_APPEND)`), `apps/agent-win/internal/remember/remember.go:164` (`forgetAll` artık `tanilama.log` ve `.1`'i de siliyor)
Sorun:

- İstemci "Yönetici olarak çalıştır" ile açılabiliyor (`env.SelfElevated()`, main.go:74).
- Bu durumda yükseltilmiş süreç, aynı kullanıcının orta bütünlükte (medium IL) yazabildiği `%LOCALAPPDATA%\NoktaDestek` klasöründe çalışıyor.
- Yol bileşenlerinde junction/symlink denetimi yok.
- 0.10.2 öncesinde de `hatirla.bin` aynı klasördeydi. Yeni olan şey, döndürmedeki `os.Rename` ile gelen **keyfi dosya taşıma** ilkelidir.

İstismar senaryosu:

1. Aynı kullanıcı oturumundaki orta bütünlüklü kötü amaçlı yazılım `NoktaDestek` klasörünü `\RPC Control` hedefli bir junction ile değiştirir. Ardından `tanilama.log` → kendi dosyası, `tanilama.log.1` → `C:\Windows\System32\<dll>` nesne yöneticisi symlink'lerini kurar.
2. Yükseltilmiş istemci yakalama sorunu yaşar (ör. HDR açıkken her oturumda `acilis_yedek` yazılır) ve boyut sınırında döndürme yapar.
3. `MoveFileEx` yönetici yetkisiyle saldırgan dosyasını korumalı bir konuma taşır. Sonuç: UAC atlatma veya DLL yerleştirme.

Microsoft, aynı kullanıcının UAC'ını güvenlik sınırı saymaz; ayrıca saldırganın zaten kullanıcı oturumunda olması gerekir. Bu yüzden önem derecesi Düşük.

Düzeltme (backend-dev):

- Süreç yükseltilmişse (`SelfElevated`) tanılama logunu kapatın. `hatirla.bin` için de aynı değerlendirme yapılmalı.
- Ya da yazmadan önce `os.Lstat` ile klasör ve dosyada `ModeSymlink|ModeIrregular` (reparse) reddedilir. Dosya `FILE_FLAG_OPEN_REPARSE_POINT` ile açılıp `GetFileInformationByHandle` ile doğrulanır.
- Döndürme `Rename` yerine "dosyayı kısalt ve yeniden yaz" ile yapılır.

## Otomatik tarama çıktıları

- **gitleaks** v8.30.1, `dir /repo/apps/agent-win`, `--config .gitleaks.toml`: `GITLEAKS_EXIT=0` (bulgu yok).
- **Gizli bilgi grep'i** (`git grep -nE "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][^'\"]{8,}" -- apps/agent-win`): eşleşme yok (exit 1).
- **`.env` geçmişi** (`git log --all -- '*.env*'`): yalnız `.env.example`.
- **Testler** (docker `golang:1.26.11-bookworm`): `go test -count=1 ./internal/{diag,capture,remember,flow}` hepsi ok. `GOOS=windows go vet ./internal/capture ./internal/diag` temiz.
- **govulncheck** v1.9.0 (`GOOS=windows`, `-show verbose`):
  - Symbol: "No vulnerabilities found". Kod etkilenmiyor.
  - Module düzeyinde 3 kayıt var, hiçbirine koddan erişilmiyor: GO-2026-6866 ve GO-2026-6860 (`golang.org/x/net` v0.60.0 → v0.62.0), GO-2026-5932 (`golang.org/x/crypto` v0.57.0).
  - go.mod bu değişiklikte değişmedi. Bu kayıtlar 0.10.2'den bağımsızdır; Dependabot/backend-dev bir sonraki istemci sürümünde yükseltmeli.

## Tasarımda vaat edilip kodda bulunmayanlar

- **AC-108 / ADR-0004 tek istisna:** yukarıdaki ORTA bulgu. Kodda log var, tasarım dokümanında karşılığı yok.
- **GDI yolunda WDA_EXCLUDEFROMCAPTURE doğrulanmadı** (implementation.md elle test adım 5 bekliyor).
  - Koddan görülen: gösterge ve işaretleme pencereleri `win.ExcludeFromCapture` (`win_windows.go:462`, `overlay_windows.go:56,115`) ile işaretli. Win10 2004+ (hedef 22H2+) üzerinde DWM bu bayrağı ekran DC'sinden yapılan BitBlt'e de uygular.
  - Bu pencerelerde müşteri sırrı yok. Sızsalar bile etki görsel (yansıma) düzeyinde kalır.
  - Yayından önce Windows'ta doğrulanmalıdır (test-operatoru).

## Olumlu

- **Log içeriği:**
  - Yalnız sabit anahtarlar ve sabit neden/işlem kodları var.
  - Serbest alanlar (adaptör adı, aygıt adı, kayıt defteri DisplayVersion/EditionID) `clean()` ile yazdırılabilir ASCII'ye indiriliyor. Satır sonu, `=` ve `"` → `?`; 64 karakter sınırı var. Log enjeksiyonu engelleniyor (`diag.go:96-110`).
  - Ad, telefon, e-posta, kullanıcı/bilgisayar adı, yol, URL, oturum kodu, `rsb_` anahtarı veya token kayda girmiyor.
  - `Opener`'a yalnız `Version` ve `Log` veriliyor; oturum verisi bu katmana hiç ulaşmıyor.
  - `tag()` ve `procHR` yabancı hata metnini (DLL yolu vb.) atıyor (`reason.go:111-125`, `com_windows.go`). Testler (`diag_test.go`) hostname, home ve USER değerlerinin kayda girmediğini sınıyor.
- **Boyut ve ömür:** dosya başına 128 KB, `.1` ile toplam ≤ 256 KB. Tek kayıt sınırı aşarsa kısaltılıyor. Yayın hatası oturum başına bir kez yazılıyor (`logged`). Sorunsuz oturumda dosyaya dokunulmuyor.
- **Silme:** "Bu bilgisayarı unut" `tanilama.log` ve `.1`'i siliyor, klasör boşsa onu da kaldırıyor; bunun testi var.
  - Ek etki (sorun değil, bilgi): `update()` iki alan da boşalınca ve bozuk `hatirla.bin` okununca `forgetAll` çağrılıyor (`remember.go:59-82`). Bu durumda log da siliniyor. Gizlilik açısından olumlu.
- **Dosya izinleri:** Windows'ta Go `0o700/0o600` modlarını uygulamaz, ACL `%LOCALAPPDATA%`'dan miras alınır (kullanıcı, SYSTEM, Administrators). Diğer kullanıcılar okuyamaz.
- **Müşteri ekranındaki mesaj:** yalnız sabit neden kodu gösteriliyor; HRESULT yalnız `OTHER`'da çıkıyor (`reason.go:42-47`, `messages.go`). Bilgi ifşası yok, mesaj teknisyene okunmaya uygun.
- **Bellek güvenliği:**
  - Struct düzenleri SDK ile örtüşüyor: `DXGI_ADAPTER_DESC1`, `DXGI_OUTPUT_DESC1` (gömülü 96 bayt `DXGI_OUTPUT_DESC` + BitsPerColor ofset 96), `BITMAPINFOHEADER` (40 bayt), `CURSORINFO` (24), `ICONINFO` (32).
  - vtable dizinleri doğru: Factory1.EnumAdapters1 = 12, Adapter1.GetDesc1 = 10, Output5.DuplicateOutput1 = 26, Output6.GetDesc1 = 27. `DuplicateOutput1` argüman sırası (device, flags, count, formats, out) doğru.
  - DIB section 32 bpp ve yukarıdan aşağı; dilim uzunluğu `w*h*4` ve pitch `w*4` gerçek düzene eşit. `ConvertBGRA` kaynak uzunluğunu ayrıca denetliyor (`nv12.go:69-71`).
  - `GetIconInfo` bitmap'leri siliniyor; `release()` tüm GDI tutamaçlarını (SelectObject geri alma, DeleteObject, DeleteDC, ReleaseDC) bırakıyor.
  - BGRA dışı (FP16) yüzey reddediliyor (`dxgi_windows.go:276`).
- **Başka masaüstü/oturum:**
  - GDI `GetDC(NULL)` yalnız sürecin kendi masaüstünü (Default) okuyor.
  - Güvenli masaüstü (UAC) veya kilit ekranında BitBlt başarısız oluyor veya siyah dönüyor. Hata yolunda kaynak kapatılıp geri çekilmeli olarak yeniden açılıyor ve son kare tekrarlanıyor. Winlogon veya başka oturum görüntüsü sızmıyor.
  - DRM korumalı içerik GDI'da da maskeli.
- **Bağımlılık:** yeni modül yok; `x/sys/windows/registry` mevcut modülden. Kayıt defteri yalnız `QUERY_VALUE` ile okunuyor, yazılmıyor.
