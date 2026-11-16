# QA Raporu — P28u (gözetimsiz izinli / izinsiz bağlantı, müdahale) Tur 1

DURUM: DÜZELTİLMELİ

Tarih: 2026-11-16 · Dal `p28u`, HEAD `d42cc70` (K1–K7 commitli). K8 (devops) çalışma ağacında (`deploy/ops/*`); kapsam dışı
sayıldı. Kod değiştirilmedi. Önceki rapor: `docs/arsiv/p28b-qa-raporu.md`. AC-447..450 (P28e eki) kapsam dışı.

## Test sonucu

| Komut                                                                | Sonuç                                                                                                                                                                       |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm -r run lint && pnpm -r run typecheck && pnpm -r run test`      | Yeşil. contracts 222/222, web 461/461, server birim 583 + 1 skip (`fsrv-p28b` AC-353 `skipIf(!CLAMD_TEST_HOST)`, gerekçeli)                                                 |
| `pnpm format:check` (CI adımı)                                       | **Kırmızı**: `docs/db-notlari.md` prettier'a uymuyor                                                                                                                        |
| Sunucu entegrasyon (izole `rs-mysql-qa28u:33335`)                    | 1040/1041. Tek kırmızı AC-263 (P19 CSV perf, 38,9 sn > 30 sn), e2e ile paralel yükte; tek başına yeniden koşu 12/12 yeşil. P28u ile ilgisiz. Konteyner kapatıldı ve silindi |
| Go `go test ./... && GOOS=windows go vet ./...` (docker golang:1.26) | Yeşil (tüm paketler `ok`)                                                                                                                                                   |
| Playwright `p28u unattended p17-console p8-history`                  | 65 geçti, 21 atlandı (hepsi `[mobile]`, `desktopOnly` gerekçeli), 0 kırmızı                                                                                                 |
| PR #16 CI (`gh pr checks 16`)                                        | **Kırmızı**: `lint + type-check` (format:check) ve `gofmt + vet + … ` (staticcheck); MySQL testi, web e2e ve Windows go test hâlâ pending                                   |

## Kabul kriterleri

| AC     | Durum | Kanıt / eksik                                                                                                                                                                                                                                                                                               |
| ------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-429 | ⚠️    | Kanıtlanan: Go `TestAC429UserWatchAnnounceAndDebounce`, entegrasyon "AC-429 D-P28u-6: device.user → liste userState", e2e liste sütunu. Kanıtlanmayan: AC'nin istediği Windows elle testi (kilitle, aç, oturumu kapat; her geçiş ≤ 10 sn) yapılmadı                                                         |
| AC-430 | ✅    | e2e "AC-430 kutu yalnız politika açık + unattended.silent varken", entegrasyon "AC-430: GET /status.silentAllowed"                                                                                                                                                                                          |
| AC-431 | ⚠️    | Go birim testleri (`consent.go`, helper, `TestAC431*`) ve entegrasyon testi var. Kanıtlanmayan: diyalog, örtülme taraması ve süzgeç **Windows'ta hiç çalıştırılmadı** (K6 notu); "≤ 3 sn" ve T2 enjeksiyon/saydam katman elle testleri yok                                                                  |
| AC-432 | ✅    | Entegrasyon "AC-432: denied … step-up tüketilmiş (yeni connect 401)", "AC-432: timeout … protocol"                                                                                                                                                                                                          |
| AC-433 | ⚠️    | Kanıtlanan: `no_user` entegrasyon testi, Go `TestAC433AskedLogonAfterLogoffEndsSessionChanged` ve `TestAC433NoUserAndSilentLogonDoesNotEnd`. Sunucu yolu doğru (`device-msg.ts:157`, `session_changed` pencerede yutulmuyor), ancak mimari §14.2'nin istediği entegrasyon testi yok. Windows elle testi yok |
| AC-434 | ✅    | Entegrasyon "AC-434: … ikinci ask → 429, cihaza ikinci connect gitmez", "AC-434: … 409 DEVICE_BUSY"                                                                                                                                                                                                         |
| AC-435 | ✅    | Entegrasyon "AC-435: consent1 bildirmeyen … 409 DEVICE_OUTDATED", "AC-435 §6.1" (1008), e2e rozet + pasif Bağlan                                                                                                                                                                                            |
| AC-436 | ✅    | `unattended-policy.test.ts` (ack 400, step-up 401, audit eski→yeni, e-posta alıcıları), e2e politika açma/kapatma ve salt okunur görünüm                                                                                                                                                                    |
| AC-437 | ✅    | Entegrasyon "AC-437: yetki matrisi" ve "gerekçe sınırları 19/20/500/501", e2e gövde `{silent, reason}`                                                                                                                                                                                                      |
| AC-438 | ✅    | Go `TestAC438SilentNoDialogNoConsentResult`, entegrasyon "AC-438: UNATTENDED_STARTED … İzin istenmeden bağlanıldı; gerekçe yok"                                                                                                                                                                             |
| AC-439 | ✅    | Go `p28u_test.go` (izleme kipinde girdi 0, dosya ret, etiket), entegrasyon "AC-439 K-P28u-9", e2e "Müdahale et" onayı                                                                                                                                                                                       |
| AC-440 | ⚠️    | Politika ≤ 5 sn, ≤ 60 sn yedek yol, `applyPermChange`, admit yarışı: hepsi testli. Mimari §14.2'nin açıkça istediği "politika kapalıyken silent **rejoin** → `permission`" dalı testsiz (`rejoin-device.ts`)                                                                                                |
| AC-441 | ✅    | Entegrasyon "AC-441 AC-445: silent bağlantı → diğer manage sahiplerine", "başka manage sahibi yoksa", "3 deneme (0/10/30 sn)"                                                                                                                                                                               |
| AC-442 | ✅    | Entegrasyon "AC-442: izleme kipi 403; … katılımlı oturum 403", Go `TestAC442InterveneRejections`, e2e izleme kipinde düğme yok                                                                                                                                                                              |
| AC-443 | ⚠️    | Sunucu ve Go mantığı testli (kilit, ok:false, logoff → rejoin, zaman aşımı). Kanıtlanmayan: AC'nin istediği Windows elle testi (kilit ≤ 2 sn, Not Defteri ile zorla logoff ≤ 10 sn). `LockWorkStation` kısıtlı jetonla çalışıyor mu sorusu (K6s spike) açık, K-P28u-5b geri dönüşü kodlanmadı               |
| AC-444 | ⚠️    | Audit (entegrasyon) ve olay günlüğü (Go `TestAC443LockViaHelperPipeAndEventLog`) testli. "Eski servis → düğmeler pasif + AC-352 metni" için web birim veya e2e testi yok (`unattended-actions.tsx`, `intervene:false` dalı)                                                                                 |
| AC-445 | ⚠️    | Sunucu filtresi yalnız `silent` (pozitif) ve `asked` (negatif) ile test edildi. `no_user` hiç filtrelenmedi. e2e yalnız URL'ye yazılmayı doğruluyor; AC'nin istediği "üç kip ayrı ayrı filtrelenir" e2e kanıtı yok                                                                                          |
| AC-446 | ❌    | Geçmiş detayı, 404, yetki rozeti ve axe testli. Ancak `docs/KULLANIM_KILAVUZU.md` ve `docs/DATASHEET.md`'de üç kip, KVKK uyarısı ve "gizli izleme yoktur" beyanı yok (grep: 0 eşleşme)                                                                                                                      |

## Düzeltilmeli

1. [backend-dev, Yüksek] Go staticcheck CI'ı kırıyor:
   - `apps/agent-win/internal/servis/helperio/p28u_test.go:31` ve `internal/servis/p28u_test.go:743`: dize içinde ham U+202E var. `'‮'` kaçışı kullanılmalı.
   - `internal/unattended/helper/status.go:79`: `lockWait` Linux'ta kullanılmıyor (U1000). Sabit `lock_windows.go`'ya taşınmalı ya da build etiketiyle sınırlanmalı.
2. [dba, Yüksek] `docs/db-notlari.md` prettier'a uymuyor ve CI `format:check` adımı kırmızı. Düzeltme: `pnpm exec prettier --write docs/db-notlari.md`.
3. [backend-dev + frontend-dev, Yüksek] `docs/implementation.md`'de **P28u K3, K5 ve K7 bölümleri yok**. K4 ve K6 bölümleri de commitlenmemiş (yalnız çalışma ağacında). Gerekçesi yazılmamış sapmalar:
   - K5: `svc_windows.go:63` oturum olayında EventData okunmuyor, olay yalnız tetikleyici.
   - K5: `intervene.go:111-115` logoff onayı `WTS_SESSION_LOGOFF` olayıyla değil yoklamayla alınıyor (mimari §7.5).
   - K7: "Yeniden dene" konsoldan cihaz ayrıntısına gidiyor.
   - K7: e2e dosya adı `p28u-unattended.spec.ts` (mimari `unattended-p28u.spec.ts`), `connect-button.tsx` ve `lib/errors.ts` değişmedi.
   - K3: bölümün tamamı yok.

   Her biri dosya ve gerekçe ile yazılmalı.

4. [backend-dev, Orta] AC-440 / T15: `apps/server/test/integration` altında "silent odada politika kapatıldıktan (ya da `unattended.silent` geri alındıktan) sonra rejoin bileti → `endDeviceRoom("permission")` + audit `unattended.rejoin{result:fail, failReason:"permission"}`" testi eklenmeli. Mimari §11 K4'teki `unattended-rejoin-*.test.ts` dosyası hiç yok.
5. [backend-dev, Orta] AC-433 / T13: entegrasyon testi eklenmeli. Senaryo: `asked` odada logoff kabul edilir, sonra `session.closed{session_changed}` gelir; yeniden katılım penceresinde (`rejoinUntil` varken) ve yeniden katılımdan sonra oda `session_changed` ile bitmeli. `asked`/`no_user` rejoin kipinin korunması da test edilmeli (`rejoin.mode`).
6. [backend-dev, Orta] Sınırlar testsiz:
   - `unattended/intervene.ts:59` oda başına 6/dk sınırı: 7. komut → 429 `RATE_LIMITED`.
   - `signaling/unattended-control.ts:35` 30/dk sınırı: 31. kontrol isteği → `RATE_LIMITED` + metrik.

   Sahte saatli entegrasyon testi eklenmeli.

7. [backend-dev + frontend-dev, Orta] AC-445: entegrasyonda `consentMode=no_user` filtresi test edilmeli. Fikstür gerçek REST connect zincirinden geçmeli ki `unattended.connect` satırının silent filtresinde görünmesi de doğrulansın; `silentPending` bu zinciri atlıyor. e2e `p28u-unattended.spec.ts:141` testi üç kipi ayrı ayrı seçip satırların süzüldüğünü doğrulamalı.
8. [frontend-dev, Orta] AC-444: `intervene:false` (eski servis) durumunda "Oturumu kilitle" ve "Oturumu kapat" düğmelerinin pasif olduğunu ve AC-352 metninin göründüğünü doğrulayan e2e veya web birim testi eklenmeli.
9. [teknik-yazar, Yüksek — K11] AC-446 / AC-288: `docs/KULLANIM_KILAVUZU.md` ve `docs/DATASHEET.md`'ye eklenmeli: üç kip, KVKK uyarısı, "gizli izleme yoktur", D-P28u-6 aydınlatma notu, tek kişilik tenant'ta dört göz uyarısı, "önce kilitle" önerisi. Ardından PDF'ler yeniden üretilmeli.
10. [devops + backend-dev, Yüksek — K8/K10] Windows elle test kanıtı yazılmalı: AC-429 (üç geçiş ≤ 10 sn), AC-431 (≤ 3 sn, SendInput/AutoHotkey ve saydam TOPMOST katman reddi), AC-433, AC-443 (kilit ≤ 2 sn, Not Defteri ile zorla logoff ≤ 10 sn). `LockWorkStation` kısıtlı jetonla çalışmıyorsa K-P28u-5b `--lock` kodlanmalı. Sonuçlar `docs/test-raporu.md`'ye ya da spike belgesine işlenmeli.

## Definition of Done

| Madde                                       | Durum | Not                                                                                                                                                             |
| ------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tüm AC'ler kanıtlı                          | ❌    | 1 ❌, 7 ⚠️                                                                                                                                                      |
| Yerel testler yeşil                         | ✅    | AC-263 perf testi yük altında kırmızı oldu, tek başına yeşil (öneri 1)                                                                                          |
| CI yeşil                                    | ❌    | format:check ve staticcheck kırmızı (madde 1, 2)                                                                                                                |
| Lint / tip / prettier                       | ❌    | Yerel lint ve tip temiz; prettier `docs/db-notlari.md`'de kırmızı                                                                                               |
| Tasarım-kod uyumu, sapmalar gerekçeli       | ❌    | K3, K5, K7 notları yok (madde 3)                                                                                                                                |
| Katman, `any`, hata yutma, PII log          | ✅    | İncelenen dosyalarda ihlal görülmedi. Gerekçe log'a yazılmıyor; audit'te çıplak `reason` yok (testli)                                                           |
| Yetki tek kaynak + sunucuda zorlama         | ✅    | `unattended.silent` yalnız `permissions.ts`'de; sunucu zinciri ve tenant matrisi testli                                                                         |
| 5 durum / a11y / tema / 390 px / ikonlar    | ✅    | e2e `scanBoth` iki tema ve 390 px, axe 0; ikonlar §10 ile uyumlu; ham renk/px yok; skeleton üst `settings/loading.tsx`'ten geliyor                              |
| Yeni bağımlılık / env                       | ✅    | Yok                                                                                                                                                             |
| Dokümantasyon (kılavuz, DATASHEET, runbook) | ❌    | Kılavuz ve DATASHEET eksik (madde 9). Runbook'ta P28u notları var (≈ satır 3867); K8 §28u alarm/geri alma metni çalışma ağacında değil, K8 ile kontrol edilecek |
| Windows elle test                           | ❌    | Yapılmadı (madde 10)                                                                                                                                            |

## Öneriler (zorunlu değil)

1. `customers-csv-p19.test.ts:341` testindeki 30 sn perf sınırı paralel yükte kırılıyor. Testi seri koşuya alın ya da yalnız CI ölçümüne bağlayın; kararsız testi bulgu olarak izleyin (K4 aynı türden AC-261 kararsızlığı bildirmişti).
2. `wsdevice.go` 287 satır ("dokunan böler" sınırına yakın). Bir sonraki dokunuşta bölünmeli.

## Olumlu

- Sunucu zinciri (AC-437 matrisi, 19/20/500/501 sınırları, AC-434 "cihaza connect 0") gövdeleri AC'yi gerçekten doğruluyor.
- Onay aklama (T13) Go tarafında üç senaryoyla testli. Sunucu `session_changed`'i yeniden katılım penceresinde yutmuyor.
- Gerekçe log'a, olay günlüğüne ve müşteri bildirimine sızmıyor. Audit'te `silentReason` ve `failReason` alanları ayrı tutuluyor (testli).
