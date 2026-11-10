# ADR-0010 — İstemci imzasız dağıtılır (kod imzalama sertifikası yok)
Durum: Kabul (kullanıcı kararı 2026-11-10; R1/S9 kapandı) · ADR-0004'ün "Build/imza" satırını değiştirir
## Bağlam
Proje ticari değil, GitHub'da açık kaynak. Authenticode sertifikası alınmayacak. İmzasız exe'de Windows SmartScreen "Windows bilgisayarınızı korudu" uyarısı gösterir; standart kullanıcı "Ek bilgi → Yine de çalıştır" ile geçebilir. AppLocker/WDAC/kurumsal SmartScreen politikası varsa geçemez.
## Karar
| Konu | Karar |
|---|---|
| İmza | Yok. AC-96'daki `signtool verify` ve AC-94'teki "imzalı istemci build" → **"tekrarlanabilir build + SHA-256 yayınlama"** ile değiştirilir (proje-yoneticisi AC metnini günceller) |
| AV/EDR yanlış pozitif azaltma | UPX/packer **yok**, obfuscation yok, `-trimpath`, `-ldflags "-s -w -buildid="` sabit; `versioninfo` (CompanyName, ProductName, FileDescription, sürüm) dolu; manifest `asInvoker` + PerMonitorV2; tek amaçlı ağ davranışı (yalnız yapılandırılmış sunucu) |
| Tekrarlanabilir build | Sabit Go sürümü (`go.mod` toolchain), `CGO_ENABLED=0`, `SOURCE_DATE_EPOCH`; CI aynı commit'ten iki build alıp hash eşitliğini doğrular |
| Hash yayını + köken (r2, G-07) | SHA-256 GitHub Release notunda + `SHA256SUMS`; `agent-win.yml`'de **GitHub build provenance attestation** (`actions/attest-build-provenance`, Sigstore, anahtarsız — anahtar yönetimi yok). Deploy: `deploy/agent/verify-and-publish.sh` Release'den indirir, `gh attestation verify --repo <org>/Remote` + `SHA256SUMS` doğrular, ancak sonra volume'a koyar ve `AGENT_SHA256` yazar; sunucu açılışta karşılaştırır, uyuşmazsa indirme 503. **Dış gözcü** `agent-watch.yml` (günlük cron): public indirme ucundaki exe'yi çeker, hash'i Release ile karşılaştırır, uyuşmazlıkta issue + e-posta. Sunucu ele geçirilse de değiştirilmiş binary en geç 24 saatte tespit edilir |
| İstemci kimlik gösterimi (G-07) | Karşılama/hakkında: sürüm, kendi SHA-256'sının ilk 8 hanesi, bağlı alan adı. `serverURL` yalnız ldflags (CLI/env/registry override yok) |
| DLL güvenliği (G-08) | `main` başında `SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32)`; yalnız `windows.NewLazySystemDLL`; `go-ole` ve üçüncü parti paketlerin DLL yüklemesi incelenir; `%TEMP%`'e DLL/exe çıkarma yasak; Procmon kanıtı (AC-118) |
| CI sertleştirme (G-18) | Action'lar commit SHA ile, varsayılan `permissions: contents: read`; release işi `contents: write, id-token: write, attestations: write`, korumalı `v*` etiketi + onaylı `environment`; fork PR'larına secret yok; `GOFLAGS=-mod=readonly`, sabit `GOTOOLCHAIN`; Dependabot |
| Karşılama sayfası | "Uyarı çıkarsa: **Ek bilgi → Yine de çalıştır**" adımı ekran görüntülü (2 görsel, `apps/web/public/img/smartscreen-*.png`, Türkçe Windows); "Çalıştıramadınız mı? Tarayıcıdan paylaş" bağlantısı aynı adımda görünür (kurumsal politika → tarayıcı-yalnız mod) |
| AV üreticileri | Yeni sürümde Microsoft Defender + yaygın AV'lere false-positive gönderimi (runbook adımı) |
| Kurumsal müşteri | Kılavuzda hash/yol tabanlı AppLocker allowlist rehberi (imza kuralı mümkün değil) |
| SignPath | **SignPath Foundation** başvurusu P6 ile **paralel** başlatılır (G-07; ön koşul OSI lisansı = Apache-2.0 sağlandı). Kabul edilirse `agent-win.yml`'e imza adımı eklenir; geri kalan tasarım değişmez |
| Reddedilen sadeleştirme | minisign/cosign anahtarlı imza + sunucu açılışında imza doğrulama: ele geçirilmiş sunucu kendi kontrolünü atlar, anahtar saklama/rotasyon yükü getirir; bağımsız kanıtı attestation + dış gözcü sağlar |
| macOS (Faz 8, not) | İmzasız/notarize edilmemiş binary Gatekeeper'da engellenir; kullanıcı sağ tık → Aç (macOS 15+ Sistem Ayarları → Gizlilik ve Güvenlik → "Yine de aç") yapmalıdır; karşılama sayfası benzer anlatım içerir |
## Alternatifler
OV/EV sertifika (maliyet, kullanıcı reddetti); MSIX/Store (kurulum gerektirir, kapsam dışı); yalnız tarayıcı modu (tam erişim kaybı).
## Sonuçlar
- R1 risk seviyesi artar: SmartScreen her yeni sürümde uyarır (itibar biriktirmez). Ölçüm: test-operatoru temiz Win10/11'de "Yine de çalıştır" yolunu doğrular.
- AV/EDR karantina riski (R2) yüksek kalır → tarayıcı modu birincil yedek.
- Sürüm bütünlüğünü müşteri hash ile doğrulayabilir; TLS sunucu doğrulaması (AC-109) aynen geçerli.
