# QA Raporu — P28b (sunucuda dosya + ClamAV + kota) Tur 2 (K8 düzeltme doğrulaması)

DURUM: DÜZELTİLMELİ

Tarih: 2026-11-16 · Dal `p28b`, HEAD `1047d64` + commitlenmemiş çalışma ağacı (K8 backend + K8 web + mimari r3). Kod değiştirilmedi.
Kapsam: tur 1 "Düzeltilmeli" 1–8, güvenlik "P28b kod turu 1" D-P28b-K1-1..4; kaynak `docs/implementation.md` "P28b K8 backend" / "P28b K8 web", `git diff`.

Tur 1 maddeleri 1–8 ve D-P28b-K1-1..4 yazıldıkları kapsamda kapandı; testler yeşil. Karar nedeni, tur 1'in gözden kaçırdığı ve madde 7 ile
aynı sınıftan **yeni bir Düşük bulgu**: silinen yükleme akışının sinyal yarısı `signal.FsrvInit` (tip + `validate()`) üretimde kullanılmıyor
(Düzeltilmeli 1). Bu kapanınca kod + yerel test düzeyinde GEÇTİ verilebilir. Staging/CI kapıları (AC-357 ölçümü, Windows CI, PR CI) commit sonrası K9'dadır.

## Test sonucu

| Komut                                                           | Sonuç                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm -r run lint && pnpm -r run typecheck && pnpm -r run test` | çıkış 0. contracts 22 / 203 · web 50 / 446 · server birim 39 / 577 + 1 skip (gerekçeli: gerçek clamd, `it.skipIf(!CLAMD_TEST_HOST)`, tur 1 ile aynı)                                                                                                                                                                                                          |
| server `test:int` (`rs-mysql-qa28b2:33330`)                     | **99 dosya / 1003 test geçti**, skip 0, 79 sn. Tur 1'e göre +9 test; yeni testlerle birebir (retention 3, settings 2, files 2, signaling 2). S-P19-T12, P27 zamanlama, AC-344 bu koşuda yeşil. Konteyner kapatıldı; tur 1'deki `rs-mysql-qa28b` de artık yok                                                                                                  |
| Go `golang:1.26`: `go test ./... && GOOS=windows go vet ./...`  | İlk koşuda `internal/input` `TestS73HotkeyOnHookThreadDoesNotDeadlockWithSendInput` kırmızı ("Shut sonrası 1 olay uygulandı"). Bu koşu Playwright ile eşzamanlıydı (yük altı); P28b bu pakete dokunmuyor. Tek başına `-count=20` yeşil, tam `go test ./...` ikinci koşuda tamamı `ok`, `GOOS=windows go vet` temiz. Bilinen dışı kararsız test, bkz. Öneriler |
| `pnpm --filter @remote/web exec playwright test p28b p28a`      | **17 geçti / 9 atlandı**, çıkış 0. Atlananların tamamı `mobile` projesinde konsol akışları; gerekçe `beforeEach` `test.skip(project !== "desktop", "konsol masaüstü akışı")`. Yeni iki test desktop'ta yeşil: konsol "AC-287 koyu tema + 390 px" (viewport testte 390'a ayarlanıyor) ve "misafir web AC-363/287"                                              |

## Tur 1 maddelerinin kapanışı

| #   | Madde                                          | Durum | Kanıt                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ---------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | AC-360 kalıcı silme + firma silme disk testi   | ✅    | `fsrv-p28b-retention`: "AC-360 kalıcı silme (purgeAnonymized)…" satır 0 + `FILES_DIR/{tenant}` boş; "AC-360 firma silme…" gerçek purge API'si (dryRun → onay → `runJob` "done") sonrası satır 0 + klasör `ENOENT`. Test gerçek bir eksiği yakaladı: `purgeSessionsBatch` satırı siliyor, diski bırakıyordu. Düzeltme `beforeTx` ile diski TX'ten önce siliyor (`retention-repo.ts`, `retention.ts`)                                                                 |
| 2   | §12 log taraması                               | ✅    | `signaling-fsrv-p28b` "AC-356 dosya adı ve yükleme/indirme belirteci…": gerçek WS + HTTP PUT/GET, debug pino yakalanıyor. Ad, iki belirteç ve `gizli-ad-` öneki için log, audit ve `/metrics` içinde 0 eşleşme. Pozitif kontroller (log ve audit fid'i içeriyor, metrik var) taramanın boş veri üzerinde koşmadığını kanıtlıyor                                                                                                                                     |
| 3   | `rs_av_scan_total{result}`                     | ✅    | `fsrv-p28b-files`: clean, infected, failed_error için önce/sonra +1 `/metrics` üzerinden; öz-sınama bayrağı da `failed_error` +1                                                                                                                                                                                                                                                                                                                                    |
| 4   | Eşzamanlı kota rezervasyonu                    | ✅    | "AC-362 kalan kotası tek dosyalık firmada iki eşzamanlı begin": `Promise.all` → tam olarak bir `{reject:"QUOTA"}`, bir `fid`, UPLOADING sayısı 4. Kod değişmedi, `FOR UPDATE` yeterli                                                                                                                                                                                                                                                                               |
| 5   | Mimari r3                                      | ✅    | `mimari-p28b.md` §r3 (s. 637+): §7.1 `256M`/`512M` + değişmez `akış + açılım ≤ /scratch/2 (768M)` (s. 304, 319–320); §4 `storedFiles` → `GET /sessions/:id/history` (s. 183); §5.4 "`file` DC kanalı açılır ama dinlenmez" (s. 257)                                                                                                                                                                                                                                 |
| 6   | ClamAV env→panel geçişi                        | ✅    | Yol (a). `writeLastTest` satır yoksa aynı TX'te `settings.clamav {host, port, source:"env→panel"}` yazıyor. Testler: elle test → Super Admin aktörlü tek audit, ikinci test yeni audit üretmiyor; `markMisconfigured` → `system` aktörlü audit. Runbook §28b.2 m.7 notu eklendi                                                                                                                                                                                     |
| 7   | Kullanılmayan Go kodu (`upload.go` + `Digest`) | ✅    | `upload.go`, `uploadPath`, `ErrQuota`, `backoff`, `retryable`, `sleep` silindi; Go testleri buna göre azaltıldı; `fsrv` paketi `ok`; artık çağrı kalmadı. **Tur 2 yeni bulgu (tur 1'de gözden kaçtı):** `internal/signal/fsrv.go:157-166` `FsrvInit` tipi ve `:198-206` `validate()` üretimde hiç örneklenmiyor (yalnız `signal/fsrv_test.go:46`). `signal` paketindeki diğer giden tiplerin hepsi kullanılıyor, yani bu bir konvansiyon değil. Bkz. Düzeltilmeli 1 |
| 8   | e2e koyu tema + 390 px + misafir web           | ✅    | Yukarıdaki iki test yeşil. Koyu tema assert'i (`expectDark`) `globals.css:103-104` mekanizmasıyla tutarlı: sınıf yoksa "Sistem" + `prefers-color-scheme: dark`. Misafir testi bilgi satırını birebir, teklif → kabul → SHA-256 → `fsrv.result{ok}` → "Teslim edildi" akışını, misafir yüklemesinin konsola teklif düşmesini, URL'de belirteç olmamasını, axe 0 ve temiz konsolu doğruluyor                                                                          |
| 9   | DATASHEET / kılavuz                            | ⏭ K10 | teknik-yazar yazıyor                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 10  | e2e + PR CI yeniden koşusu                     | ◐     | e2e bu turda koşuldu, yeşil. PR CI eski HEAD'i koşuyor; değişiklikler commitlenmediği için commit sonrası (koordinatör)                                                                                                                                                                                                                                                                                                                                             |

## Güvenlik D-P28b-K1-1..4

| Bulgu       | Durum | Kanıt                                                                                                                                                                                                                                                                                                                                         |
| ----------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-P28b-K1-1 | ✅    | `service.ts`: `t.writing` denetimi ve bayrağın açılması arada `await` olmadan aynı blokta, `finally`'de kapanıyor; `next`/hash güncellemesi `finally`'den sonra aynı devam adımında. Test: `writePart` 50 ms yavaşlatılmış iki eşzamanlı farklı gövde → [200, 409], 409 gövdesi `{next:0}`, `writePart` bir kez çağrılıyor                    |
| D-P28b-K1-2 | ✅    | `dropAuthSession` silindi; `tokens.ts` başlık yorumu GET anı denetimini anlatıyor; implementation'da gerekçe var                                                                                                                                                                                                                              |
| D-P28b-K1-3 | ✅    | `fsrv.ts` `techMayFile` hem kapı 2'de hem `fsrv.accept`'te; `narrowCaps` `file_transfer` düşünce `fsrvSideGone(…,"TECH")`. Test: `applyPermChange` (oda bitmiyor, yalnız `narrowCaps`; `rooms.ts:280-293` okundu) → eski belirteç 404, yeni accept `fsrv.download` üretmiyor (indirme hakkı 3 olduğu için kapı olmasa üretirdi; test anlamlı) |
| D-P28b-K1-4 | ✅    | `liveRows` `orderBy id` + `id > cursor`; `sweepOrphanRows` bellekteki aktarımları atlayıp sayfalıyor, kısa sayfada bitiyor. Test sayfa boyu 1 ile: bellekteki aktarım (küçük id) UPLOADING ve `.part`'ı duruyor, yetim CANCELLED ve `.part`'ı silindi                                                                                         |

## Kabul kriterleri (tur 1'den değişenler)

| AC     | Durum                                 | Kanıt veya eksik                                                                                                             |
| ------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| AC-353 | ✅ otomatik · ⏭ K9                    | + env→panel audit testleri. Port taraması staging'de (K9)                                                                    |
| AC-357 | ⏭ K9 (staging ölçümü)                 | Akış testli. 50 MB ≤ 30 sn (amd64, 5 tekrar) ve K6 kapı 4/6 staging'de (tur 1 madde 11). Kod/yerel denetimin kapsamı dışında |
| AC-359 | ✅                                    | + metrik sayaç testleri (madde 3)                                                                                            |
| AC-360 | ✅                                    | + kalıcı silme / firma silme disk testleri (madde 1), yetim süpürme sayfalaması                                              |
| AC-362 | ✅                                    | + eşzamanlı rezervasyon testi (madde 4)                                                                                      |
| AC-363 | ✅ web · ⏭ K9 Windows · ⏭ K10 doküman | Misafir web e2e eklendi. Windows satırı elle K9'da, DATASHEET/kılavuz K10'da                                                 |
| AC-287 | ✅                                    | Konsol SERVER paneli koyu tema + 390 px + axe 0; misafir koyu tema axe 0                                                     |
| AC-289 | ⏭ commit sonrası CI                   | Windows CI `agent-win` PR #13'te; değişiklikler commitlenince                                                                |
| AC-290 | ✅ (kod tarafı)                       | Güvenlik kod turu 1 GEÇTİ (K/Y 0); dört Düşük bulgu kapandı                                                                  |
| AC-284 | ❌ (Düzeltilmeli 1) · ⏭ K9/K10        | Çerçeve AC; kod tarafında yalnız `FsrvInit` kalıntısı açık, kalan kapılar K9/K10                                             |

Diğer AC'ler (AC-354, 355, 356, 358, 361, 404, 285, 286) tur 1'deki gibi ✅; K8 değişiklikleri bunları geriletmedi (entegrasyon + e2e yeşil). AC-288 K10'da.

## Düzeltilmeli

1. [backend-dev (Go)] **Düşük**, `apps/agent-win/internal/signal/fsrv.go:157-166` (`type FsrvInit`) ve `:198-206` (`func (m FsrvInit) validate()`).
   İstemci `fsrv.init` göndermiyor; tip üretim kodunda hiç örneklenmiyor. Bu, tur 1 madde 7'de silinen yükleme akışının sinyal yarısı.
   Not: `signal/fsrv_test.go:42-62` `decodeFsrvGuest`, `packages/contracts/fixtures/fsrv.json` `valid.inbound` ile sözleşme eşlik testidir ve
   fixture `fsrv.init` içerir. İki yoldan biri seçilmeli:
   - (a) tip ve `validate()` silinsin; eşlik testi `fsrv.init` örneklerini "Windows istemci göndermez" diye açıkça atlasın (fixture değişmez);
   - (b) mimar onayıyla `docs/implementation.md`'ye "`FsrvInit` P28f/g yükleme istemcisi için sözleşme eşlik tipi; üretimde kullanılmaz" istisnası yazılsın.

   Her iki yolda paylaşılan yardımcılar
   (`validFsrvName`, `validFsrvSize`, `validPrintShape`) `FsrvOffer` doğrulamasında kullanıldığı için kalsın. Gelen `fsrv.upload` doğrulayıcısı
   ve `files_server.go:107` no-op dalı savunma amaçlı protokol işleme; dokunulmasın. Ya da mimar onayıyla implementation'a
   "P28f/g sözleşme tipi" istisnası yazılsın. Sonra `go test ./... && GOOS=windows go vet ./...` yeniden koşulsun.

2. [koordinatör] Değişiklikler commitlenince PR #13 CI'nin tamamı (`agent-win` Windows, `web e2e`, `test (MySQL 8.4)`) yeşil görülmeli
   (tur 1 madde 10'un kalanı). K9 kapıları (tur 1 madde 11) aynen geçerli.

## Definition of Done

| Madde                                     | Durum | Not                                                                                                               |
| ----------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------- |
| Lint / tip / birim temiz                  | ✅    | 3/3 paket                                                                                                         |
| Entegrasyon yeşil                         | ✅    | 1003/1003                                                                                                         |
| Go test + Windows vet                     | ✅    | `internal/input` S73 bir kez kırmızı, P28b dışı, tekrarda yeşil (Öneriler)                                        |
| Web e2e yeşil                             | ✅    | p28b + p28a: 17 geçti, 9 gerekçeli atlama                                                                         |
| CI yeşil                                  | ⏭     | Commit sonrası (koordinatör)                                                                                      |
| Her AC için test kanıtı                   | ✅    | Otomatiklenebilen tüm maddeler kanıtlı; AC-357 ölçümü ve Windows elle K9'da, AC-284 yalnız Düzeltilmeli 1'e bağlı |
| Mimari uyumu / sapmalar gerekçeli         | ✅    | Mimari r3                                                                                                         |
| Katman, `any`, hata yutma, sayfasız liste | ✅    | Yetim süpürmesi artık imleçle sayfalı                                                                             |
| Transaction                               | ✅    | env→panel audit, upsert ile aynı TX                                                                               |
| PII / gizli değer logda yok               | ✅    | Log taraması testi (madde 2)                                                                                      |
| Kullanılmayan kod yok                     | ❌    | `signal.FsrvInit` (Düzeltilmeli 1)                                                                                |
| Yeni bağımlılık                           | ✅    | Yok                                                                                                               |
| Env kuralı                                | ✅    | Yeni env yok; runbook notu eklendi                                                                                |
| 5 durum / a11y / ikonlar                  | ✅    | Konsol + misafir koyu tema/390 px axe 0                                                                           |
| Dokümantasyon                             | ⏭     | K10                                                                                                               |

## Öneriler (zorunlu değil)

- D-P28b-K1-3 sonrası yetkisi daraltılan teknisyene açık teklif sessizce bekliyor; müşteri "Teknisyenin onayı bekleniyor" satırını oda kapanana ya da süre dolana kadar görüyor. `narrowCaps`'te TECH alıcılı açık teklifler `REJECTED` yapılabilir.
- `settings/clamav.ts:28` sistem aktörü için `requests/service.ts`'teki `SYSTEM`'i alıyor (modüller arası bağ). Aynı sabit `signaling/control-record.ts`'te de var; ortak bir `audit` sabitine taşınabilir.
- `writeLastTest` var/yok denetimini kilitsiz yapıyor; iki eşzamanlı ilk testte iki "env→panel" audit yazılabilir. Etkisi yalnız fazladan audit satırı.
- `retention-repo.ts` `beforeTx` aday listesini TX dışında hesaplıyor. TX içinde fazladan bir oturum seçilirse onun diski bu turda kalır, satır savunma yolu ile silinir. Bugünkü anonimleştirme diski zaten sildiği için pratik risk yok.
- `internal/input` `TestS73HotkeyOnHookThreadDoesNotDeadlockWithSendInput` yük altında kararsız ("Shut sonrası 1 olay uygulandı"); P17 sahibi kararlı hâle getirmeli.

## Olumlu

- Madde 1'in testi gerçek bir veri kalıntısı hatası buldu (kalıcı silmede disk dosyası kalıyordu) ve kod düzeltildi.
- Yarış testleri (D-P28b-K1-1, kota) yavaşlatma ve `Promise.all` ile gerçekten eşzamanlılık kuruyor. Implementation, testlerin önce kırmızı olduğunu belirtmiş.
- Log taraması pozitif kontrollerle kurulmuş, boş veriyle geçemiyor.
- Sözleşme değişmedi, yeni bağımlılık ve env yok.

---

# QA Raporu — P28b (sunucuda dosya + ClamAV + kota) Tur 1 (K8 paket sonu denetimi)

DURUM: DÜZELTİLMELİ

Tarih: 2026-11-16 · Dal `p28b`, commit `1047d64` (temiz çalışma ağacı). Kod değiştirilmedi, staging'e bağlanılmadı.
Kapsam: AC-353..363, AC-404, AC-285..290 (`docs/gereksinimler-p28.md` r2, `docs/gereksinimler-kabul-kriterleri-e11-b.md`); `docs/mimari-p28b.md` r2
uyumu; `docs/implementation.md` "P28b K0..K6" sapmaları; DESIGN.md / §1.8 ikonlar; `~/.claude/checklists/kalite-standartlari.md`.

Kod kalitesi genel olarak iyi: kapılar sunucuda, fail-closed yolu testli, gerekçesiz bağımlılık yok, yeni yetki yok.
DÜZELTİLMELİ kararının nedeni şu: mimari §12/§14'te zorunlu tutulan dört test yazılmamış (firma silmede disk temizliği, log
taraması, tarama metriği, eşzamanlı kota rezervasyonu). Ayrıca web e2e ve PR CI bu turda bağımsız olarak doğrulanamadı.

## Test sonucu

| Komut                                                          | Sonuç                                                                                                                                                                                                                               |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm -r run lint`                                             | temiz (çıkış 0)                                                                                                                                                                                                                     |
| `pnpm -r run typecheck`                                        | temiz (çıkış 0)                                                                                                                                                                                                                     |
| `pnpm -r run test`                                             | contracts 22 dosya / 203 · web 50 / 446 · server birim 39 / 577 + **1 skip**. Skip gerekçeli: `fsrv-p28b.test.ts:362` `it.skipIf(!CLAMD_TEST_HOST)` gerçek clamd testi                                                              |
| server `test:int` (ayrı konteyner `rs-mysql-qa28b:33328`)      | **99 dosya / 994 test geçti**, skip 0, 77 sn. P27 zamanlama ve clip-print-ws AC-344 bu koşuda kararsızlık göstermedi                                                                                                                |
| Go `golang:1.26`: `go test ./... && GOOS=windows go vet ./...` | 30 paket `ok` (`proclimit` test dosyası yok); vet temiz                                                                                                                                                                             |
| `pnpm --filter @remote/web exec playwright test p28b p28a`     | **Koşulamadı.** Komut aracı (Bash izin sınıflandırıcısı) üst üste yanıt vermedi. `p28b-files.spec.ts` (8 test) kod düzeyinde okundu; yeşil olduğu iddiası yalnız implementation K4'te (496 geçti / 215 atlandı), bağımsız kanıt yok |
| `gh pr checks 13`                                              | Denetimin başında 11 işin 10'u `pending`, yalnız shellcheck + actionlint `pass`. Sonuç beklenemedi                                                                                                                                  |

**Ortam notu:** `rs-mysql-qa28b` test konteyneri aynı araç sorunu yüzünden kaldırılamadı. Koordinatör `TEST_DB_CONTAINER=rs-mysql-qa28b apps/server/scripts/test-db.sh down` komutuyla kaldırmalı.

## Kabul kriterleri

| AC     | Durum                   | Kanıt veya eksik                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-353 | ✅ otomatik · ⏭ staging | `fsrv-p28b-settings` testleri: env kaynağı, CIDR dışı veya loopback host → `HOST_NOT_ALLOWED`, kayıt + audit `settings.clamav`; test: PONG + EICAR + şifreli zip → ok, `lastTest` yazılıyor, audit `settings.clamav.test`; şifreli algılama kapalı → ok:false; Admin 403; 6/dk sınırı. e2e ClamAV ekranı (kod okundu). Port taraması yalnız yerelde yapıldı (K6 kapı 3); staging'de K9'da yapılacak                                          |
| AC-354 | ✅                      | Entegrasyon `AC-354 lastTest başarısızken açma → 409 AV_NOT_READY; onaysız → 400 consentUpdated; onaylı → açılır + audit consentAck`. Web `files-form.tsx`: anahtar pasif, neden metni, onay kutusu yalnız açarken görünüyor (e2e `AC-354/362`, `AC-354: ClamAV testi yoksa…`)                                                                                                                                                               |
| AC-355 | ✅                      | `signaling-fsrv-p28b`: sabitleme (açılıştan sonra ayar kapanınca oda SERVER kalıyor), `file.meta` → `session_files` 0 + `dc_meta` metriği, eski istemci UNSUPPORTED + `print.request` FORBIDDEN + misafir `fsrv.*` 1008, P2P → MODE. Go: `files_server_test.go` (DC ret), mod ilk hello'da sabit. Gözetimsiz odada `hasFsrv` ilk koşulu `!room.unattended`                                                                                   |
| AC-356 | ✅                      | Birim `box.ts` (segment/AAD). Entegrasyon: diskte düz metin işareti yok; GET başlıkları (sandbox CSP, CORP, no-store, nosniff, RFC 5987); başka fid'in belirteci, belirteçsiz, çerezle → 404; başka tenant link → 404; oda kapanınca belirteç 404; çıkış yapınca HISTORY belirteci 404. Not: "başka oturum URL'si + bu fid" link vakası tek başına yazılmamış (bkz. Öneriler)                                                                |
| AC-357 | ⚠️ kanıtsız             | Akış testli: yükle → SCANNING → CLEAN → teklif → kabul → DELIVERED. **50 MB ≤ 30 sn ölçümü (staging amd64, 5 tekrar) yok.** K6 kapısı 4 ve 6 (bellek, host RAM) staging'de bekliyor. Mimari §13 "paket kabulü" bu ölçümü şart koşuyor                                                                                                                                                                                                        |
| AC-358 | ✅                      | Entegrasyon `AC-358 virüslü dosya → INFECTED + imza iki tarafa; disk silinir; file.infected audit`. Yanıt iki tarafa poll ≤ 1 sn içinde ulaşıyor. Audit alanları `{fid, signature, ext, sizeBytes}` (`service.ts:335-340`); imza `classifyReply` içinde desene göre süzülüyor (`clamd.ts:34`). e2e metni doğru                                                                                                                               |
| AC-359 | ⚠️ kısmi                | Sınıflandırma birim testli (ENCRYPTED, MaxScanTime → TIMEOUT, Limits ve akış sınırı → LIMIT, bütçe aşımı → TIMEOUT, veri yazıldıktan sonra kopma → ERROR). Entegrasyonda ERROR ve öz-sınama bayrağı testli. Runbook ve `remote-watch` alarmı (`av-scan-failed`) var. **`rs_av_scan_total{result}` artışını doğrulayan test yok** (`scan.ts:79`)                                                                                              |
| AC-360 | ⚠️ kısmi                | Ret, iptal, 3 başarısız indirme, PRINT → EXPIRED, oda kapanışı, 03:30 süre dolumu, mutabakat (a/b/c), anonimleştirme sonrası disk boş, geçmişten link + `file.download` audit ve yetki geri alınınca 404 testli. **Kalıcı silme / firma silme sonrası `FILES_DIR/{tenant}` boş testi yok.** AC metni "kalıcı silmede de silinir (diskte dosya kalmaz testi)" diyor ve mimari §12 bunu istiyor; implementation K3 eksikliği kendisi de yazmış |
| AC-361 | ✅ otomatik · ⏭ staging | Entegrasyon `AC-361 imza yaşı > 3 gün → stale:true (test + /health); /health 200 kalır`; e2e uyarı bandı. freshclam `--checks=6` (K6). Gerçek SelfCheck sonrası imza yaşı staging'de kontrol edilecek                                                                                                                                                                                                                                        |
| AC-362 | ⚠️ kısmi                | Kota doluyken QUOTA, 2 GiB → SESSION_LIMIT, disk %10 → QUOTA ve PUT 409 `STORAGE_QUOTA`, Super Admin PATCH + audit, Admin 403 testli. Web kullanım çubuğu var. **Mimari §12/§14'teki "eşzamanlı iki init kota rezervasyonu" testi yok** (kodda `tenants FOR UPDATE` var, testi yok)                                                                                                                                                          |
| AC-363 | ⚠️ kısmi                | Konsol: e2e `fsrv-notice` metni birebir. Misafir web aynı `FilesPanel`'i kullanıyor, ancak e2e testi yok (K4 kalan maddesi). Windows satırı: elle K9. **DATASHEET ve kılavuz güncellenmemiş.** DATASHEET:34'teki "dosya içeriği sunucudan geçmez" cümlesi bu mod açıkken yanlış olacak. Bu iş K10'a bırakılmış ama metin şu hâliyle AC-363 ile çelişiyor                                                                                     |
| AC-404 | ✅                      | Yeni yetki anahtarı yok (contracts testi sabit). Metinler contracts + `tr.json` + `messages_p28.go` içinde. İkonlar anlamlı: Dosyalar `FolderLock`, Virüs tarama `ShieldCheck`, kullanım `HardDrive`, saklama `CalendarClock`, indir `Download`                                                                                                                                                                                              |
| AC-284 | ⚠️                      | Çerçeve AC; yukarıdaki ⚠️ maddeler kapanınca karşılanır                                                                                                                                                                                                                                                                                                                                                                                      |
| AC-285 | ✅                      | Yetki tek tanımdan geliyor; AC-72 testi yeşil                                                                                                                                                                                                                                                                                                                                                                                                |
| AC-286 | ✅                      | ClamAV ayarı: test düğmesi, gizli değer yok, audit eski→yeni, step-up                                                                                                                                                                                                                                                                                                                                                                        |
| AC-287 | ⚠️                      | Yeni ayar ekranlarında axe ve 390 px testli; `TenantSettingsPage` yükleniyor ve hata durumlarını ortak karşılıyor. **Konsol dosya paneli (SERVER satırı) 390 px ve koyu tema axe taraması yok** (K4 kendi notu). Koyu temada axe'nin koşup koşmadığı e2e koşulamadığı için doğrulanamadı                                                                                                                                                     |
| AC-288 | ⏭ K10                   | Kılavuz, DATASHEET, CHANGELOG ve PDF teknik-yazar turunda                                                                                                                                                                                                                                                                                                                                                                                    |
| AC-289 | ⚠️ kanıtsız             | Windows CI `agent-win` (iz testi SERVER senaryosu, K7) PR #13'te `pending`                                                                                                                                                                                                                                                                                                                                                                   |
| AC-290 | ⚠️                      | Tasarım güvenlik turu GEÇTİ (r2). Kod turu (K8 güvenlik) sonucu bekleniyor; bu rapor DÜZELTİLMELİ                                                                                                                                                                                                                                                                                                                                            |

### Sapmaların değerlendirmesi (implementation K0..K6)

| Sapma                                                                                 | Karar                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SERVER odasında eski istemciye `print.request` FORBIDDEN (K3 sinyal)                  | Kabul. AC-355 "eski istemcide bu modda yazdırma kapalı" kuralını sunucuda zorluyor; entegrasyon testi var                                                                                                                                             |
| `storedFiles` `/sessions/:id/history` yanıtında (mimari §4 `GET /sessions/:id` diyor) | Kabul, gerekçeli. **Mimari §4 güncellenmemiş** (madde 5)                                                                                                                                                                                              |
| ClamAV env kaynağında başarılı testin panel satırı açması (K3 sapma 1)                | Kısmen kabul. Bu davranış belgelenmemiş ve audit'siz bir kaynak değişimine yol açıyor: ilk testten (ya da `markMisconfigured` çağrısından) sonra `CLAMAV_HOST`/`CLAMAV_PORT` env değişikliği etkisiz kalıyor ve geri dönüş ucu (DELETE) yok (madde 6) |
| `file` DataChannel'ı SERVER'da açılıyor ama dinlenmiyor (K4)                          | Kabul. Gelen `file.offer` reddediliyor, sunucu `file.meta`'yı yok sayıyor, risk yok. Mimari §5.4 "açılmaz" ifadesi güncellenmeli (madde 5)                                                                                                            |
| Windows istemcide müşteri→teknisyen yükleme düğmesi yok (K5 sapma 2)                  | Davranış kabul: P5'ten beri yok, SERVER modunda baypas da yok. **Ama `internal/fsrv` `Upload`/`Digest` akışa bağlanmamış**, yani kullanılmayan kod. Proje kuralına ("kullanılmayan kod yok") aykırı (madde 7)                                         |
| `StreamMaxLength`/`MaxFileSize` 256M + `MaxScanSize` 512M, "yarı" değişmezi (K6)      | Değerler kabul, K6 kapı 5 ölçümüyle gerekçeli (`deploy/clamav/clamd.conf:22-31` doğru). **Mimari §7.1 hâlâ 260M ve eski /scratch hesabını yazıyor** (`mimari-p28b.md:304,319`) (madde 5)                                                              |

## Düzeltilmeli

1. [backend-dev] **Orta**, `apps/server/test/integration/fsrv-p28b-retention.test.ts` (yeni test). AC-360 ve mimari §12 gereği firma silme
   (`tenant-purge.ts` `SESSION_FILES` adımı) ve `purgeAnonymized` sonrası `FILES_DIR/{tenantId}` klasörü boş olmalı ve
   `session_stored_files` satırı 0 kalmalı. Disk dosyası olan bir CLEAN satırla iki ayrı test yazılmalı.
2. [backend-dev] **Orta**, yeni entegrasyon testi (mimari §12 "Log tarama", §10.2). İşaretli dosya adı (`gizli-ad-…`) ve indirme/yükleme
   belirteci tam akıştan geçtikten sonra sunucu logu, `audit_logs` ve `/metrics` içinde 0 eşleşme olmalı. P28a
   `clip-print-ws.test.ts:157-165` kalıbı kullanılabilir.
3. [backend-dev] **Düşük**, `apps/server/test/integration/fsrv-p28b-files.test.ts` AC-358/359 blokları. Her sonuçtan sonra
   `rs_av_scan_total{result="clean|infected|failed_error"}` sayacının 1 arttığı `/metrics` üzerinden doğrulanmalı (`scan.ts:79`).
4. [backend-dev] **Düşük**, `fsrv-p28b-files.test.ts` AC-362. Kalan kotası tek dosyalık olan bir firmada iki `svc.begin` `Promise.all` ile
   eşzamanlı çağrılmalı. Beklenen: biri kabul edilir, diğeri `QUOTA` alır. Bu, mimari §14'te zorunlu tutulan testtir.
5. [mimar] **Düşük**, `docs/mimari-p28b.md`. Üç yer güncellenmeli: §7.1 satır 304 ve 319 → `StreamMaxLength`/`MaxFileSize 256M`, değişmez "akış + açılım ≤ /scratch / 2 (256 + 512 = 768M)"; §4 satır 183 → `storedFiles` `GET /sessions/:id/history` yanıtında; §5.4 "Konsol / misafir web" satırı → "`file` kanalı açılır ama dinlenmez". Bunlar implementation K6 madde (3) ve K4 sapmalarından gelen mimar işleridir.
6. [backend-dev] **Düşük**, `apps/server/src/settings/clamav.ts:122-142`. Env kaynağında `writeLastTest`/`markMisconfigured`
   env değerlerini panel satırına donduruyor. Bu kaynak değişimi `settings.clamav` audit'i üretmiyor ve sonraki env değişikliği sessizce
   etkisiz kalıyor. Beklenen iki yoldan biri:
   - (a) panel satırı env'den açılırken `settings.clamav` audit'i `{source:"env→panel"}` ile yazılsın ve runbook §28b'ye "ilk testten sonra ClamAV adresi panelden yönetilir" notu eklensin [devops];
   - (b) `lastTest` env kaynağında ayrı tutulsun ve `source` değişmesin.
7. [backend-dev (Go)] **Düşük**, `apps/agent-win/internal/fsrv/upload.go` (+ `Digest`). Bu kod hiçbir akıştan çağrılmıyor (K5 sapma 2). Proje kuralı
   "kullanılmayan kod yok" gereği silinmeli ve testleriyle birlikte P28f/g'ye bırakılmalı. Ya da mimar onayıyla implementation'a "P28f/g'de
   kullanılacak sözleşme kodu" istisnası yazılmalı.
8. [frontend-dev] **Düşük**, `apps/web/e2e/p28b-files.spec.ts`. Konsol dosya panelinde (SERVER) `fsrv-notice` için koyu temada axe 0 ve 390 px'te
   taşma olmadığı denetlenmeli (AC-287). Misafir sayfası (`/session/[token]`) SERVER modunda bilgi satırı (AC-363) ve teklif → kabul için
   en az bir e2e testi eklenmeli (K4 "Kalan").
9. [teknik-yazar] **Orta (K10'da zorunlu)**, `docs/DATASHEET.md:34` ve `:30`. "dosya içeriği sunucudan geçmez" ifadesi sunucu modu açıkken
   yanlış. AC-363 ayrımı yazılmalı: varsayılan modda uçtan uca; sunucu modunda taranır ve uçtan uca değildir. Mutlak ifade
   kullanılmamalı. Kılavuzda Super Admin ClamAV + kota, Admin Dosyalar sekmesi ve gözetimsizde dosyanın kapalı olduğu anlatılmalı (mimari §13 K10).
10. [koordinatör] Şunlar yeniden koşulup sonuçları rapora eklenmeli:
    - `pnpm --filter @remote/web exec playwright test p28b p28a` (bu turda koşulamadı);
    - PR #13 CI'nin tamamı (özellikle `agent-win` Windows, `web e2e`, `test (MySQL 8.4)`).

    Ayrıca `rs-mysql-qa28b` konteyneri kaldırılmalı.

11. [devops / test-operatoru] **K9 kapısı (QA sonrası, bilgi)**:
    - AC-357 staging amd64 ölçümü: 50 MB, 5 tekrar, ≤ 30 sn;
    - K6 kapısı 4 ve 6;
    - staging'de 3310 port taraması;
    - Windows elle: AC-363 satırı, 0.13 istemcide AC-352 metni, iz testi.

## Definition of Done

| Madde                                                  | Durum | Not                                                                                   |
| ------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------- |
| Lint / tip / birim temiz                               | ✅    | 3/3 paket                                                                             |
| Entegrasyon yeşil                                      | ✅    | 994/994                                                                               |
| Go test + Windows vet                                  | ✅    |                                                                                       |
| Web e2e yeşil                                          | ❌    | Bu turda koşulamadı, kanıt yok                                                        |
| CI yeşil                                               | ❌    | PR #13 pending                                                                        |
| Her AC için test kanıtı                                | ❌    | AC-357, 359, 360, 362, 363 kısmi (madde 1–4, 8)                                       |
| Mimari uyumu / sapmalar gerekçeli                      | ⚠️    | Gerekçeler var; mimari belgeye işlenmemiş (madde 5)                                   |
| Katman, `any`, hata yutma, sayfasız liste              | ✅    | Taramada bulgu yok. `.catch(() => undefined)` yalnız disk silmede, mutabakat kapsıyor |
| Transaction                                            | ✅    | Rezervasyon + INSERT tek TX (`FOR UPDATE`); `deliver` + `session_files` aynı TX       |
| PII / gizli değer logda yok                            | ⚠️    | Kod okumasında sorun yok; zorunlu log taraması testi yok (madde 2)                    |
| Kullanılmayan kod yok                                  | ❌    | Go `internal/fsrv.Upload` (madde 7)                                                   |
| Yeni bağımlılık                                        | ✅    | Eklenmedi                                                                             |
| Env kuralı (.env.example + env.ts + compose + runbook) | ✅    | K6: `FILES_DIR`, `CLAMAV_*`, `AV_SUBNET`, `CLAMAV_ALLOWED_CIDR`                       |
| 5 durum / a11y / ikonlar                               | ⚠️    | Ayar ekranları tamam; konsol paneli koyu tema + 390 px eksik (madde 8)                |
| Dokümantasyon                                          | ⏭     | K10 (madde 9)                                                                         |
| > 500 satırlık yeni üretim dosyası yok                 | ✅    | En büyüğü `service.ts` (365 satır)                                                    |

## Öneriler (zorunlu değil)

- `fsrv-p28b-files.test.ts` AC-360 link testine "B oturumunun URL'si + A oturumunun fid'i → 404" vakası eklenebilir. Bugün tenant-matrix bunu dolaylı kapsıyor.
- `docs/implementation.md` "P28b K3 — sunucu (KISMİ; devam ediyor)" başlığı artık eskidi; tur 2 bölümüne yönlendirme notu eklenebilir.

## Olumlu

- Kapı sırası (§5.2) sunucuda birebir uygulanmış. Fail-closed yolları ve öz-sınama bayrağı entegrasyonda kanıtlı.
- Belirteçler yalnız `Authorization` başlığında taşınıyor. Çerezle istek, başka fid'in belirteci ve çıkış/yetki geri alımı → 404 testli; IP başına 404 sınırı var.
- Disk dosyası yalnız CLEAN durumunda tutuluyor ve her son durumda silindiği testli. Diskte düz metin olmadığı işaretle doğrulanıyor.
- K6 ENOSPC fail-open bulgusunu ölçümle yakalayıp yapılandırmayı düzeltmiş. `clamd.conf` yorumları gerekçeyi taşıyor.
- Yeni bağımlılık yok, yeni yetki anahtarı yok, ikonlar anlamlı ve tutarlı.
