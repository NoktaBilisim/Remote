# QA Raporu — PT (kod temizliği) Tur 4

DURUM: GEÇTİ

Tarih: 2026-11-15 · Dal `pt-wip` @ `e219894` (temiz) · Kapsam: yalnız Tur 3 "Düzeltilmeli" 1 (HEAD CI kanıtı). Kod
değişmedi, yerelde test koşulmadı, staging'e bağlanılmadı.

Özet: Tur 3'ün tek açık maddesi kapandı. Son kod değişikliğini (`64e6301`) içeren `90dfe1d` için `ci` ve `agent-win`
koşularının tüm işleri **success**. Bu işler arasında Tur 3'te iptal olan `test (MySQL 8.4)` ve `web e2e` de var.
`e219894` yalnız belge değiştiriyor. Onun koşuları rapor anında hâlâ sürüyordu (aşağıdaki birleştirme koşuluna bakın).

## Test sonucu (Tur 4)

| SHA              | `ci`                                                                                                                                                | `agent-win`                                                                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `90dfe1d`        | 43729189569 **success**: lint + type-check, test (MySQL 8.4), web e2e (Playwright), build (+ Docker), audit + lisans + gitleaks, coturn, shellcheck | 43729189584 **success**: gofmt + vet + test -race + govulncheck, go test (Windows), build 1/2 ve 2/2, tekrarlanabilirlik. SignPath, ONAY, attestation, Release: skipped (PR'da beklenen) |
| `e219894` (HEAD) | 43729991671 rapor anında **in_progress**                                                                                                            | 43729991799 rapor anında **in_progress**                                                                                                                                                 |

`git diff 90dfe1d e219894` `docs/` dışında boş, yani kod `90dfe1d` ile aynı. `e219894`'ün değiştirdiği iki belge
(`docs/qa-raporu.md`, `docs/temizlik/sonuc.md`) yerelde `prettier --check` ile temiz. Bu yüzden `e219894` CI'ında
format kaynaklı bir kırılma beklenmiyor.

## Tur 3 maddesinin durumu

| Tur 3 maddesi                     | Durum | Kanıt                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — HEAD `ci` + `agent-win` yeşil | ✅    | `gh run view` ile iş bazında doğrulandı: 43729189569 ve 43729189584, headSha `90dfe1d`. `sonuc.md:322-325` Kalan iş 8 bu numaraları ve sonuçları doğru yazıyor. `259a6f0` ci 43728760018 "cancelled (yeni push)" olarak düzeltildi. Seçim yazılmış: kanıt `90dfe1d`'ye bağlanır, belge commit'inin CI'ı birleştirmeden önce yeşil görülür |

## Kabul kriterleri

| AC             | Durum | Kanıt veya eksik                                                     |
| -------------- | ----- | -------------------------------------------------------------------- |
| AC-317..AC-324 | ✅    | Tur 2-3'teki gibi. Artık CI kanıtı da var (`90dfe1d` ci + agent-win) |

## Düzeltilmeli

Yok.

Birleştirme koşulu (madde değil, `sonuc.md`'deki kendi taahhüdü): `e219894` ci 43729991671 ve agent-win 43729991799
`main`'e birleştirmeden önce success görülmeli. Kırmızı biterse kod aynı olduğu için R-PT8 (kararsız test
karşılaştırması) uygulanır.

## Definition of Done (Tur 4)

| Madde                                         | ✅/❌ | Not                                                        |
| --------------------------------------------- | ----- | ---------------------------------------------------------- |
| Lint / typecheck / format temiz               | ✅    | `90dfe1d` ci lint + type-check success                     |
| Unit + entegrasyon testleri yeşil             | ✅    | `90dfe1d` ci test (MySQL 8.4) success                      |
| Go test + vet + staticcheck (linux + windows) | ✅    | `90dfe1d` agent-win success (go test Windows dahil)        |
| e2e (Playwright) yeşil                        | ✅    | `90dfe1d` ci web e2e success                               |
| Güvenlik taraması (audit, gitleaks, lisans)   | ✅    | `90dfe1d` ci audit + lisans + gitleaks success             |
| Belgeler güncel ve tutarlı                    | ✅    | `sonuc.md` Kalan iş 8, `implementation.md` PT bölümü       |
| K8 Windows elle testi                         | ✅    | Kapsam dışı: istemci yayın kapısı (K-PT-4), PT'yi bağlamaz |

## Öneriler (zorunlu değil)

- `sonuc.md` "Test koşuları" tablosu hâlâ yalnız `e280551` koşusunu gösteriyor. `90dfe1d` numaraları yalnız Kalan iş
  8'de var. Bir sonraki belge düzenlemesinde tabloya da eklenebilir.

## Olumlu

- Tur 3'teki "kapanmamış işi kapalı gösterme" sorunu düzeltildi. Üstü çizili gösterim artık gerçek yeşil koşulara
  dayanıyor.

---

# QA Raporu — PT (kod temizliği) Tur 3

DURUM: DÜZELTİLMELİ

Tarih: 2026-11-15 · Dal `pt-wip` @ `90dfe1d` (temiz) · Kapsam: yalnız Tur 2 "Düzeltilmeli" 1–2. Kod değişmedi
(`90dfe1d` yalnız `docs/`), test yerelde koşulmadı. Staging'e bağlanılmadı, ACCESS.txt okunmadı.

Özet: Belge maddesi (Tur 2 Düzeltilmeli 1) tam kapandı. Kalan tek engel CI kanıtı. `259a6f0`'ın `ci` koşusu yeşil
bitmedi, **iptal edildi** (`90dfe1d` itilince eşzamanlılık grubu yüzünden). İptal olan işler `test (MySQL 8.4)` ve
`web e2e`. Yani `64e6301` kod düzeltmesi için CI'da henüz bir test sonucu yok. HEAD `90dfe1d` koşuları rapor anında
sürüyordu.

## Test sonucu (Tur 3)

| SHA              | `ci`                                                                                                                                                                                                                               | `agent-win`                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `e280551`        | 43727719947 **success**                                                                                                                                                                                                            | 43727719960 **success**               |
| `259a6f0`        | 43728760018 **cancelled**: lint+type, build, audit/gitleaks, coturn, shellcheck success. **`test (MySQL 8.4)` ve `web e2e (Playwright)` cancelled.** Neden: aynı dalda `90dfe1d` itildi, eşzamanlılık grubu eski koşuyu iptal etti | 43728760055 **success**               |
| `90dfe1d` (HEAD) | 43729189569 rapor anında **queued**: bekliyor                                                                                                                                                                                      | 43729189584 **in_progress**: bekliyor |

Yerelde test koşulmadı. Tur 2'deki server unit 435/435 ve mutasyon sağlaması (`64e6301`) geçerliliğini koruyor:
`90dfe1d` yalnız belgedir (`git show --stat`: `gereksinimler.md`, `implementation.md`, `mimari-temizlik.md`,
`qa-raporu.md`, `temizlik/sonuc.md`).

## Tur 2 maddelerinin durumu

| Tur 2 maddesi                                              | Durum | Kanıt / eksik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — `sonuc.md` / `implementation.md` eski durum satırları  | ✅    | `sonuc.md:8-12` durum notu: AC-317..324 GEÇTİ, K8 = yayın kapısı (K-PT-4), `64e6301` PT ölçümü dışında. Özet tablo `:22` AC-317 "GEÇTİ (K18 istisnası)", `:29` AC-324 "GEÇTİ (gerekçeli sapma)". `:276-280` K18 paragrafı "§5 K18 satırı ve §1-2 test istisnası eklendi". `:295` Elle test satırında "istemci yayın kapısı (K-PT-4)". Kalan iş 7-8 güncel. Test koşuları e2e hücresi CI `e280551` (43727719947). `implementation.md:8994` Elle test, `:9005` K18 "eklendi", `:9008` AC-322 "revize edildi (K-PT-3), GEÇTİ". `mimari-temizlik.md:294-297` ve `gereksinimler.md` K-PT-3: 6 gövde, `login` ×2. Eski ifadeler için grep ("ekleniyor", "QA Düzeltilmeli 6", "PT kapanış koşulu", "karar mimar") PT bölümlerinde sonuç vermedi |
| 2 — HEAD `ci` + `agent-win` yeşil, numaralar `sonuc.md`'de | ❌    | `259a6f0` ci iptal oldu, `90dfe1d` ci/agent-win sürüyor. `sonuc.md:322-323` Kalan iş 8'in üstü çizilmiş ("~~HEAD CI~~") ama metni "ci koşusu … yeniden doğrulanır" diyor. Yani kapanmamış bir iş kapalı gösteriliyor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Kabul kriterleri

| AC             | Durum | Kanıt veya eksik                                                                                                       |
| -------------- | ----- | ---------------------------------------------------------------------------------------------------------------------- |
| AC-317..AC-323 | ✅    | Tur 2'de olduğu gibi, değişiklik yok                                                                                   |
| AC-324         | ✅    | Kapanış raporu artık kendi içinde tutarlı (Tur 2 Düzeltilmeli 1 kapandı). §5 tam, `implementation.md` PT bölümü güncel |

## Düzeltilmeli

1. **[devops]** HEAD'in (`90dfe1d` ya da sonraki SHA) `ci` (43729189569) ve `agent-win` (43729189584) koşuları
   **success** bitmeli. Özellikle `test (MySQL 8.4)` ve `web e2e` işleri, çünkü `64e6301` bu işlerden hiç geçmedi.
   Koşular bittikten sonra:
   - `sonuc.md` "Kalan iş" 8'e ve "Test koşuları" tablosuna HEAD koşu numaralarını ve sonucunu yaz.
   - `259a6f0` ci 43728760018'i "cancelled (yerine geçen koşu: …)" olarak düzelt.
   - Üstü çizili gösterimi ancak koşular yeşil olunca bırak.

   Kırmızı biterse R-PT8 uygulanır: 3 tekrar ve kararsız test listesiyle (Kararsız-1..3) karşılaştırma. Yalnız bu
   belge commit'ini itmek yeni bir koşu başlatır ve süren koşuyu iptal eder. Bu yüzden ya sonuçlar belgeye yazılıp
   **yeni koşu da yeşil** bitmeli, ya da sonuç numaraları bir sonraki ilgisiz commit'e bırakılmalı. Hangisinin
   seçildiği `sonuc.md`'de belirtilmeli.

## Definition of Done (Tur 3)

| Madde                                              | ✅/❌ | Not                                                                      |
| -------------------------------------------------- | ----- | ------------------------------------------------------------------------ |
| Lint / typecheck / format temiz                    | ✅    | Tur 1-2. `259a6f0` ci lint+type success                                  |
| Unit + entegrasyon testleri yeşil                  | ✅    | Yerelde Tur 1-2 (435/435 + entegrasyon 796). CI kanıtı aşağıdaki satırda |
| Go test + vet + staticcheck (linux + windows)      | ✅    | `259a6f0` agent-win success                                              |
| e2e (Playwright) yeşil                             | ✅    | `e280551` ci success. `64e6301`/`90dfe1d` web'e dokunmuyor               |
| HEAD CI yeşil                                      | ❌    | `259a6f0` ci cancelled, `90dfe1d` bekliyor. Düzeltilmeli 1               |
| Her AC ✅                                          | ✅    | AC-317..324                                                              |
| Tasarım ↔ kod uyumu, sapmalar gerekçeli            | ✅    | K-PT-3/4, §5 K18                                                         |
| Davranış değişmedi / bilinçli düzeltme ayrı commit | ✅    | `64e6301`                                                                |
| Yeni bağımlılık yok                                | ✅    | `90dfe1d` yalnız belge                                                   |
| `implementation.md` kaydı / PT bulguları           | ✅    | Güncel                                                                   |

## Olumlu

- Tur 2'deki belge düzeltmesinin tüm alt maddeleri, isteğe bağlı K-PT-3 "6 gövde + `login` ×2" dahil, beş belgede
  tutarlı işlendi. Grep ile kalan eski ifade bulunmadı.
- `64e6301` PT ölçümünün dışında tutuldu ve bu açıkça yazıldı (434 → 435).

---

# QA Raporu — PT (kod temizliği) Tur 2

DURUM: DÜZELTİLMELİ

Tarih: 2026-11-15 · Dal `pt-wip` @ `259a6f0` (temiz) · Kapsam: yalnız Tur 1 "Düzeltilmeli" 1–6 ve `64e6301`
(`fix(jobs)` PT-K11-B1). Baştan tam denetim yapılmadı. Kod değiştirilmedi, staging'e bağlanılmadı, ACCESS.txt okunmadı.

Özet: Tur 1'in esas maddeleri kapandı. AC-317 için K18 istisnası, AC-322 revizyonu (K-PT-3), §5 K18 satırı,
`implementation.md` PT bölümü ve K8 kararı (K-PT-4) yazıldı. `64e6301` düzeltmesi doğru ve regresyon testi gerçekten
koruyor: test eski kodda kırmızı, yeni kodda yeşil. DÜZELTİLMELİ kararının iki nedeni var. (1) Aynı commit'te güncellenen
`sonuc.md` ve `implementation.md`'de, yeni kararlarla çelişen eski durum satırları kalmış. Örneğin K8 testi bir yerde
"PT kapanış koşulu", K-PT-4'te "PT'yi engellemez" diye geçiyor. (2) HEAD'in CI koşusu denetim sırasında bitmedi.
Kalan iş yalnız belge ve CI kanıtı. Kod tarafında açık bulgu yok.

## Test sonucu (Tur 2)

| Komut                                                                                      | Sonuç                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @remote/server exec vitest run test/unit/scheduler.test.ts`                 | 4/4 geçti                                                                                                                                                                                                                                                                             |
| Mutasyon sağlaması: scratch worktree'de `64e6301` testleri + `e280551`'in `scheduler.ts`'i | yeni test **kırmızı**: `expected "vi.fn()" to be called 1 times, but got 2 times` (`scheduler.test.ts:90`). Diğer 3 test yeşil. Worktree kaldırıldı                                                                                                                                   |
| `pnpm --filter @remote/server run test` (unit)                                             | 30 dosya, **435/435**. 434'e eklenen tek test PT-K11-B1. PT dışı `fix:` olarak belgelenmiş (sonuc.md, PT liste karşılaştırması `e280551`'e göre)                                                                                                                                      |
| server `typecheck` / `lint`, kök `pnpm format:check`                                       | temiz / temiz / temiz                                                                                                                                                                                                                                                                 |
| GitHub `e280551` (PT'nin son commit'i)                                                     | `ci` 43727719947 **success**: lint/type, test MySQL 8.4, web e2e Playwright, build, audit/gitleaks, coturn, shellcheck. `agent-win` 43727719960 **success**: go test Windows, `-race`/vet/govulncheck, build, SHA256SUMS. Yalnız etiketle çalışan yayın işleri tasarım gereği atlandı |
| GitHub HEAD `259a6f0` (`64e6301` dahil)                                                    | `agent-win` 43728760055 **success** (son kontrol). `ci` 43728760018 rapor anında **in_progress**                                                                                                                                                                                      |

Entegrasyon, e2e ve Go yerelde yeniden koşulmadı. `64e6301` yalnız `scheduler.ts` ile unit testine dokunuyor; Tur 2'deki
belge commit'i kod içermiyor.

## Tur 1 maddelerinin durumu

| Tur 1 maddesi                                           | Durum | Kanıt / eksik                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. §5 K18 satırı, §1-2 test istisnası, AC-317 revizyonu | ✅    | `mimari-temizlik.md:21-25` istisna (yalnız K18; yeni ad yok, assertion silinmez). `:207` K18 satırında dosya listesi `e280551`/`1374d99` ile uyumlu. `gereksinimler.md` AC-317 altında tarihli _Revizyon_ var.                                                                                                                                                                                                                           |
| 2. AC-322 (`boot`/`signIn` yerel)                       | ✅    | Yol (a) seçilmiş: AC-322 _Revizyon_ ve K-PT-3 (`mimari-temizlik.md:294`). QA grep'i: `boot` 7 dosya. `requests-p8b-5` ile `customers-p8c-api` gövdeleri metin olarak aynı, ama her biri kendi dosyasının `live` değişkenine atıyor; revizyon bunu açıkça gerekçe sayıyor. Küçük yanlışlık: K-PT-3 "5 farklı gövde" diyor, metin olarak 6 farklı gövde var. K-PT-3'te `login` ×2 geçmiyor (gereksinimler'de geçiyor). Öneri, engel değil. |
| 3. `sonuc.md` tutarlılığı                               | ⚠️    | Kapananlar: Go sayısı tek yöntemle 397/423, 398/424/458'in kaynağı açıklandı, baseline.md düzeltildi. Başlık `e280551`/33 commit. Test koşuları tablosu güncel. > 300 dosya dosya dosya teyit edildi (`sonuc.md:165-182`). K1 ignore ve K18 sapma listesinde. **Kalan:** durum notu ve özet tabloda eski "açık" ifadeleri duruyor (Düzeltilmeli 1).                                                                                      |
| 4. `implementation.md` PT bölümü                        | ⚠️    | Bölüm var (görev notları, bulgular, sapmalar, `docs/temizlik/` gerekçesi). PT-K11-B1 "kapandı" olarak işaretli. **Kalan:** üç satırda eski durum yazıyor (Düzeltilmeli 1).                                                                                                                                                                                                                                                               |
| 5. HEAD için CI yeşil                                   | ⚠️    | `e280551` için `ci` ve `agent-win` tamamen yeşil; bu, Tur 1'in istediği SHA'ydı. HEAD `259a6f0` `64e6301` kod değişikliğini içeriyor ve koşusu sürüyor. Koşu bağlantıları sonuc.md'ye yazılmamış (Düzeltilmeli 2).                                                                                                                                                                                                                       |
| 6. K8 Windows elle testi                                | ✅    | K-PT-4 (`mimari-temizlik.md:299-302`, mimar kararı): test PT birleştirmesini değil, bir sonraki istemci sürümünün yayınını engeller. Gerekçe: staging deploy'u exe yayınlamıyor. Takip satırı `docs/test-raporu.md` "PT — Windows elle duman testi" (sonuç sütunu boş, bekliyor). QA bu kararı kabul eder.                                                                                                                               |
| PT-K11-B1 (`64e6301`)                                   | ✅    | `TimedJob.stoppable` kaldırıldı. `startTimedJob.arm` her işte `isStopped()` denetliyor. Aralık, ilk tetik ve log davranışı aynı. Regresyon testi sürmekte olan saklama turunda `stop()` ve `release()` sonrası 3 gün ilerletiyor: `run` 1 kez çağrılıyor, `getTimerCount() === 0`. Mutasyonla kanıtlandı (eski kodda 2 kez). PT-K11.md'deki "P27/P28 sınırları" `stoppable`'sız güncellendi.                                             |

## Kabul kriterleri (Tur 2)

| AC     | Durum | Kanıt veya eksik                                                                                                                                                                                                                                        |
| ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-317 | ✅    | Revize metne göre: test adları ve sayıları `e280551`'de baseline'la aynı (Tur 1: 1230/386/142, Go 397/423). K18 gövde eklemeleri istisna kapsamında. `e280551` CI e2e ve Go Windows yeşil. 435. test PT sonrası `fix:` ve ayrıca belgelenmiş.           |
| AC-318 | ✅    | Tur 1, değişiklik yok.                                                                                                                                                                                                                                  |
| AC-319 | ✅    | Tur 1'deki tek engel yöntemin kabulüydü; §1-2 istisnası ve AC-317 revizyonu bunu çözdü. Sayılar `sonuc.md`'den alındı; QA kapsamı yeniden ölçmedi.                                                                                                      |
| AC-320 | ✅    | Tur 1 + `sonuc.md` dosya dosya > 300 teyidi.                                                                                                                                                                                                            |
| AC-321 | ✅    | Tur 1, değişiklik yok.                                                                                                                                                                                                                                  |
| AC-322 | ✅    | Revize metne göre (K-PT-3). Klon hedefleri 2/16.                                                                                                                                                                                                        |
| AC-323 | ✅    | Tur 1 + Tur 2 server lint/typecheck/format.                                                                                                                                                                                                             |
| AC-324 | ⚠️    | Gereken belgeler var (§5 tam, `implementation.md` "PT bulguları", kapanış raporu). Ancak kapanış raporunun özet tablosu AC-317'yi hâlâ "belge ⚠️", AC-324'ü "K18 §5 satırı ⚠️" gösteriyor. "Tüm AC'leri gösteren kapanış raporu" kendi içinde tutarsız. |

## Düzeltilmeli

1. **[devops]** Belge durum satırlarını `259a6f0`'daki kararlara göre güncelle. Yalnız metin değişikliği; sayılar doğru.
   - `docs/temizlik/sonuc.md:8-14` durum notu: "Açık kalanlar: AC-317 ve AC-324 için K18 test istisnası ve §5 K18 satırı …; AC-322 … (mimar kararı …)" yazıyor. Bunlar yapıldı. Açık kalan yalnız HEAD CI ve K8 yayın kapısı olmalı (K-PT-4).
   - `sonuc.md:25` AC-317 "belge ⚠️" → GEÇTİ (revize AC). `sonuc.md:32` AC-324 "K18 §5 satırı ⚠️" → "4 sapma, gerekçeli; GEÇTİ".
   - `sonuc.md:283-284` "§5'e K18 satırı … mimar tarafından ekleniyor … o güncelleme girene kadar AC-317 ve AC-324 ⚠️" → "eklendi (`mimari-temizlik.md` §1-2, §5)".
   - `sonuc.md:326-327` ("Kalan iş" 7): K8 için "QA Düzeltilmeli 6" yerine "istemci yayın kapısı (K-PT-4), PT'yi engellemez" yaz. `sonuc.md` "PT bulguları" tablosundaki "Elle test" satırına da aynı notu ekle.
   - `docs/implementation.md` "Gerekçeli sapmalar" K18 satırı: "§5 K18 satırı ve §1-2 test istisnası mimar tarafından ekleniyor (QA Düzeltilmeli 1)" → "eklendi". AC-322 satırı: "AC metniyle çelişiyor, karar mimar → proje-yoneticisinde" → "AC revize edildi (K-PT-3)". "PT bulguları" tablosundaki "Elle test" satırı: "PT kapanış koşulu (QA Düzeltilmeli 6)" → "istemci yayın kapısı (K-PT-4), `docs/test-raporu.md`".
   - (isteğe bağlı) `mimari-temizlik.md` K-PT-3: "5 farklı gövde" → 6 (metin olarak; ya da "`live` ataması nedeniyle hepsi dosyaya bağlı"); `login` ×2'yi gereksinimlerdeki gibi ekle.
2. **[devops]** HEAD'in (`259a6f0` ya da Düzeltilmeli 1'den sonraki SHA) `ci` ve `agent-win` koşuları **yeşil** bitmeli. Koşu numaraları ve sonuçları `sonuc.md` "Test koşuları" tablosuna yazılmalı. `e280551` için: `ci` 43727719947 ve `agent-win` 43727719960, ikisi de success. Kırmızı biterse R-PT8 (3 tekrar, kararsız test listesiyle karşılaştırma) uygulanmalı.

## Definition of Done (Tur 2)

| Madde                                                     | ✅/❌ | Not                                                                               |
| --------------------------------------------------------- | ----- | --------------------------------------------------------------------------------- |
| Lint / typecheck / format temiz                           | ✅    | Tur 1 tümü + Tur 2 server ve format                                               |
| Unit + entegrasyon testleri yeşil                         | ✅    | Tur 1 + server unit 435/435 (`64e6301` dahil)                                     |
| Go test + vet + staticcheck (linux + windows)             | ✅    | Tur 1 + `e280551` agent-win (Windows go test, `-race`) success                    |
| e2e (Playwright) yeşil                                    | ✅    | `e280551` ci "web e2e (Playwright, mock API)" success. `64e6301` web'e dokunmuyor |
| HEAD CI yeşil                                             | ❌    | `259a6f0` agent-win success, ci sürüyor — Düzeltilmeli 2                          |
| Her AC ✅                                                 | ❌    | AC-324 ⚠️ (kapanış raporunda tutarsız durum) — Düzeltilmeli 1                     |
| Tasarım ↔ kod uyumu (dosya sahipliği, sapmalar gerekçeli) | ✅    | §5 K18 satırı, K1 ignore notu, K-PT-3/4                                           |
| Davranış değişmedi (PT) / bilinçli düzeltme ayrı commit   | ✅    | `64e6301` ayrı `fix:` commit'i, belgelenmiş, regresyon testli                     |
| Yeni bağımlılık yok                                       | ✅    | `64e6301`/`259a6f0` paket dosyalarına dokunmuyor                                  |
| `implementation.md` kaydı / PT bulguları                  | ✅    | Bölüm var; eski durum satırları Düzeltilmeli 1'de                                 |

## Olumlu

- PT-K11-B1 düzeltmesi en küçük doğru değişiklik: bayrak kaldırıldı ve dört iş tek kurala bağlandı. Test sahte
  zamanlayıcıyla sürmekte olan tur senaryosunu tam kuruyor. Ayrıca bekleyen zamanlayıcı kalmadığını
  (`getTimerCount() === 0`) da doğruluyor.
- Go test sayısı çelişkisinin kökü (Benchmark ve derleyici kapanışları) belgelendi; baseline da aynı yöntemle düzeltildi.
- K8 için verilen karar (yayın kapısı) somut bir takip satırına bağlandı. Belirsiz bir "sonra" olarak bırakılmadı.

---

# Tur 1 (önceki tur, arşiv)

Tarih: 2026-11-15 · Dal `pt-wip` @ `e280551` (temiz) · Aralık `14b2629..pt-wip` (33 commit) · Denetçi: qa-denetci (kod değiştirilmedi)

Özet: Kod tarafı sağlam: lint, typecheck, format temiz. vitest unit, entegrasyon ve Go test/vet/staticcheck/deadcode yeşil.
Sözleşme diff'i yalnız K1. knip 0/0, jscpd 2/16 ve > 500 satırlık dosya sayısı bağımsız olarak doğrulandı. Test diff'inde
assertion silinmemiş, `skip`/`only` eklenmemiş, test adı değişmemiş. **Düzeltilmesi gerekenler davranışla ilgili değil.**
Üç AC'nin (317, 322, 324) yazılı metni karşılanmıyor ve tasarım belgesine işlenmemiş: K18 görevi §5'te yok, test
gövdelerine yeni senaryo eklenmiş ve dosya-yerel `boot`/`signIn` tanımları duruyor. Ayrıca `sonuc.md`'de çelişkili
satırlar var ve HEAD için CI kanıtı yok.

## Test sonucu

| Komut (QA tarafından koşuldu)                                                                                        | Sonuç                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm -r run lint`                                                                                                   | temiz (çıkış 0)                                                                                                                                              |
| `pnpm -r run typecheck`                                                                                              | temiz (çıkış 0)                                                                                                                                              |
| `pnpm format:check`                                                                                                  | temiz ("All matched files use Prettier code style")                                                                                                          |
| `pnpm -r run test` (unit)                                                                                            | contracts 142/142 (18 dosya), web 386/386 (43), server 434/434 (30)                                                                                          |
| server entegrasyon `vitest run test/integration` (kendi MySQL 8.4 konteynerim `rs-qa-pt-b13d72`, iş sonunda silindi) | **796/796** geçti, 0 skip                                                                                                                                    |
| Go `go test -count=1 ./...` (golang:1.26, linux)                                                                     | 21 paket ok                                                                                                                                                  |
| Go `go vet` linux / `GOOS=windows`                                                                                   | 0 / 0                                                                                                                                                        |
| Go `GOOS=windows go test` derlemesi (`-exec /bin/true`)                                                              | derlendi (çıkış 0)                                                                                                                                           |
| staticcheck v0.8.2 linux / windows                                                                                   | 0 / 0                                                                                                                                                        |
| deadcode v0.52.0 `-test` windows                                                                                     | 0                                                                                                                                                            |
| `scripts/pt-olcum.sh <scratch> knip jscpd boyut fonk i18n`                                                           | knip server/web export ve tip anahtarı yok (= 0); jscpd üretim 2 / toplam 16; > 500 üretim 0+0+1+2 = 3; i18n ölü aday 8 (dinamik `us.r/us.m`)                |
| Playwright e2e tam koşu                                                                                              | **yapılmadı** (tur sınırı; geliştiricinin raporladığı 443/0 bağımsız doğrulanmadı)                                                                           |
| GitHub CI `ci` + `agent-win` (HEAD `e280551`)                                                                        | **bitmedi**: denetim sırasında `in_progress`. `440aa07` ikisi de success; `11dd81e` ve `1bb205f` `ci` failure (kararsız e2e olduğu söyleniyor, doğrulanmadı) |
| Go `go test -race`, kapsam yeniden ölçümü                                                                            | **yapılmadı** (kapsam sayıları `sonuc.md`'den alındı, bağımsız doğrulanmadı)                                                                                 |

Skip: unit ve entegrasyonda yok. e2e'de 200 "skipped" görülüyor (`desktopOnly` proje filtresi; baseline ile aynı tasarım).

## Kabul kriterleri

| AC     | Durum | Kanıt veya eksik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-317 | ⚠️    | **Doğrulanan:** vitest sayıları 1230 (434+796) / 386 / 142 = baseline. 71 test dosyası diff'inde `skip`/`only` eklenmemiş (tek `test.skip` satırı taşınan `desktopOnly` tanımı). `it`/`test`/`describe`/`func Test` adı eklenmemiş, silinmemiş (pt-surface baseline'da var). Azalan `expect` sayıları ortak yardımcılara taşınmış: örnekler `rejectsWith` → `helpers/db-grants.ts`, `newSession`/`scanBoth` → `e2e/helpers.ts`, Go `noCall`/`startAdmitted`/`expectServerParse`; okundu, gövdeler birebir. **Eksik 1:** K18 test dosyalarına fikstür dışı değişiklik yapmış. `scheduler.test.ts` "AC-5" testine outbox ve purge zamanlayıcı senaryosu, `lib/dc/p5.test.ts` ve `p5-teklif.test.ts`'e yeni iptal/dispose senaryoları, Go `signal_test`, `files_test`, `logo_test`'e yeni tablo satırları, `capture/select_test.go`'da sahte yapı değişikliği eklenmiş. AC metni "test dosyalarındaki değişiklik yalnız fikstür/yardımcı çağrısıdır" diyor; değişiklikler testi güçlendiriyor ama bu istisna kayıtlı değil (mimari §1-2, gereksinim). **Eksik 2:** Go liste sayısı: QA `go test -list . ./... \| grep -c ^Test` = **397**, sonuc.md 398. Windows sayısı sonuc.md içinde iki yerde farklı (424 ve 458). Yöntem farkı olabilir; uzlaştırılmadı. **Eksik 3:** HEAD için e2e ve CI kanıtı bağımsız değil. |
| AC-318 | ✅    | `git diff 14b2629..pt-wip -- apps/server/prisma packages/contracts/src .env.example deploy go.mod go.sum` yalnız K1 (`api/{customers,requests,sessions}.ts` + yeni `shared.ts`). `env.ts`'te tek `export` kaldırma, env kümesi aynı. `pt-surface` testleri entegrasyon (796) ve contracts (142) koşusunda yeşil. Döngü testi `[]`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| AC-319 | ⚠️    | Kapsam QA tarafından yeniden ölçülmedi. `sonuc.md` K18 tablosu her paket için ≥ baseline gösteriyor. Ancak yükseliş, AC-317 ile çatışan test gövdesi eklemeleriyle elde edildi (bkz. AC-317 Eksik 1). Bu yöntemin kabulü mimar kararı gerektiriyor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| AC-320 | ✅    | Bağımsız ölçüm: > 500 üretim dosyası 3 (contracts `api/requests.ts`, Go `win_windows.go`, `mf_windows.go`; izinli). web > 300 dosya 0, server 9, Go 9. §5 hedefleri ve 2 gerekçeli istisna (K6 `classify` cx 17, K9 `service.ts` 469) notlarda var. "Yeni > 300 dosya yok" iddiası sonuc.md'de "teyit edilmedi" diye işaretli; QA de dosya bazında teyit etmedi (bkz. Düzeltilmeli 3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| AC-321 | ✅    | knip üretim export/tip 0/0 (QA ölçümü; yalnız test yardımcılarında 1+16 / 6+1 var, AC dışı). deadcode windows `-test` 0 (QA). `@types/smtp-server` kaldırılmış. i18n: 8 aday dinamik `us.r/us.m` öneki (sonuc.md gerekçesi).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| AC-322 | ❌    | jscpd üretim 25 → 2, toplam 70 → 16 ✅. `desktopOnly` tek tanım ✅ (16+1 yerel tanım silinmiş, `e2e/helpers.ts:24`). **Karşılanmayan:** AC metni "sunucu entegrasyon testlerinde `signIn`/`boot`/`errorText`/`login` dosya-yerel tanımı kalmaz" diyor. Grep sonucu: `boot` **7 dosyada** (ör. `requests-p8b-3.test.ts:21`, `bindings-p20.test.ts:33`, `customers-csv-p19.test.ts:21`), `signIn` **2 dosyada** (`account-p10.test.ts:66`, `p15-backend.test.ts:52`). PT-K2.md gerekçe veriyor (gövde farkı) ama AC revize edilmemiş. sonuc.md özetteki "GEÇTİ" kararı bu maddede yanlış.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| AC-323 | ✅    | lint, typecheck, format (QA koşusu), go vet ve staticcheck linux + windows 0 (QA koşusu). staticcheck `agent-win.yml`'de (K16 `d49f4ee`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| AC-324 | ⚠️    | QA'nın commit bazında sahiplik karşılaştırmasının (33 commit) sonuçları şöyle. (a) **K18'in §5'te satırı yok.** `e280551` ve `1374d99` K10, K11, K13, K14 ve K15'e ait 24 üretim dosyasına ve K2/K3 dışındaki test dosyalarına dokunuyor. Değişiklikler sıralı, eşzamanlı çakışma yok; ama mimari §6'daki "durur, mimara döner, tabloya işlenir" adımı yapılmamış. `PT-K18.md` ve `implementation.md` kaydı da yok. (b) K1 (`c661ea0`) `.gitignore` ve `.prettierignore`'a dokunmuş (graphify-out). Liste dışı, sonuc.md sapma listesinde yok. (c) "PT bulguları" AC'nin istediği `docs/implementation.md` yerine `docs/temizlik/PT-Kn.md` ve `sonuc.md`'de. `implementation.md`'de yalnız PT-K0/K1 başlığı var; gerekçe yalnız PT-K9.md'de ("koordinatör talimatı"). (d) Kalan liste dışı dosyalar `DESIGN.md` (K13, K15c) ve `gereksinimler.md` (K0 AC-321 revizyonu); bunlar gerekçeli.                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Düzeltilmeli

1. **[mimar]** `docs/mimari-temizlik.md` §5: **PT-K18** satırını ekle. İçerik: dosya listesi (`e280551` ve `1374d99` diff'i), ajan, iş ("knip kalanı export kaldırma + kapsam telafisi"). §1-2'ye de K18 test istisnasını yaz: mevcut `it`/`Test` gövdelerine assertion ve senaryo eklemek serbest; yeni ad yok, mevcut assertion'a dokunulmaz. `docs/gereksinimler.md` §10 AC-317'ye AC-321'deki gibi tarihli bir _Revizyon_ notu ekle (AC-319 ile çatışmanın çözümü). Bu iki belge güncellenmeden AC-317 ve AC-324 ✅ olamaz.
2. **[mimar → proje-yoneticisi]** AC-322 karşılanmıyor. `boot` 7 dosyada ve `signIn` 2 dosyada (`account-p10`, `p15-backend`) dosya-yerel olarak duruyor. İki yol var, biri seçilmeli:
   - (a) AC-322'ye revizyon notu: "gövdesi farklı olanlar yerinde kalır, gerekçe PT-K2.md". Bu yalnız belge değişikliği.
   - (b) [backend-dev] bu tanımları parametreli ortak yardımcıya taşı; davranış ve assertion aynı kalmalı.
3. **[devops]** `docs/temizlik/sonuc.md` K18 sonrası tutarlı hale getirilmeli:
   - AC-323 tablosu ve "Test koşuları" tablosunda lint, typecheck, format, e2e ve `-race` için "yapılmadı" yazıyor; üstteki durum notu ise koşulduklarını söylüyor. Tablolar güncellenmeli.
   - AC-317 tablosunda Go windows 424, Go bölümünde 458 yazıyor. Tek sayıya ve tek yönteme indirilmeli. QA'nın linux `go test -list` sayımı 397, belgedeki 398; fark açıklanmalı.
   - Başlıktaki "Ölçülen kod `440aa07`" ve AC-324'teki "28 commit" `e280551` / 33 commit olarak güncellenmeli.
   - AC-324 sapma listesine K1'in `.gitignore` ve `.prettierignore` değişikliği ile K18 eklenmeli.
   - AC-322 satırındaki "dosya-yerel tanımlar kaldırıldı / grep yapılmadı" ifadesi gerçek durumla değiştirilmeli (bkz. madde 2).
   - AC-320'deki "yeni > 300 dosya yok" iddiası baseline `liste300` ile dosya dosya teyit edilip sonuç yazılmalı.
4. **[devops]** `docs/implementation.md` sonuna "PT bulguları ve görev notları" başlığı ekle. İçerik: `docs/temizlik/PT-K2..K18.md` ve `sonuc.md` bağlantıları, açık bulgular (PT-K11-B1, PT-K15c-B1) ve notların neden burada değil `docs/temizlik/` altında tutulduğunun gerekçesi (koordinatör kararı). AC-324 bunu istiyor.
5. **[devops]** HEAD `e280551` için GitHub `ci` (lint, typecheck, unit, entegrasyon, Playwright desktop + mobile) ve `agent-win` (Windows test + staticcheck) koşuları **yeşil** bitmeli. Koşu bağlantıları sonuc.md'ye yazılmalı. Kırmızı biterse kararsız test listesiyle karşılaştırılıp 3 tekrar kuralı (R-PT8) uygulanmalı.
6. **[test-operatoru]** PT-K8 Windows elle duman testi (PT-K8.md A–H grupları: `--tray`, ikinci örnek, tepsi, çoklu firma ana ekranı, talep formu ve bekleme, logo/tema, kod oturumu). R-PT2 gereği K8 Windows UI'ı otomatik testsiz böldü. PT kapanmadan, en geç P27 kodu başlamadan önce yapılmalı; sonuç `docs/test-raporu.md`'ye yazılmalı.

## Definition of Done

| Madde                                                        | ✅/❌ | Not                                                                                                                 |
| ------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------- |
| Lint / typecheck / format temiz                              | ✅    | QA koşusu                                                                                                           |
| Unit + entegrasyon testleri yeşil                            | ✅    | 142 / 386 / 434 + 796                                                                                               |
| Go test + vet + staticcheck (linux + windows)                | ✅    | QA koşusu (Windows için yalnız derleme; çalıştırma CI'da)                                                           |
| e2e (Playwright desktop + mobile) yeşil                      | ❌    | HEAD için bağımsız kanıt yok (QA koşmadı, CI bitmedi) — madde 5                                                     |
| Her AC ✅                                                    | ❌    | AC-322 ❌; AC-317, 319, 324 ⚠️                                                                                      |
| Tasarım ↔ kod uyumu (dosya sahipliği, sapmalar gerekçeli)    | ❌    | K18 §5'te yok; K1 `.gitignore` belgelenmemiş — madde 1, 3                                                           |
| Davranış değişmedi (mekanik dönüşüm)                         | ✅    | Örneklenen diff'ler ve güvenlik PT turu GEÇTİ (`docs/guvenlik-raporu.md`); sözleşme ve rota anlık görüntüleri yeşil |
| Yeni bağımlılık yok (yalnız PT-D1 `@vitest/coverage-v8` MIT) | ✅    | `@types/smtp-server` kaldırıldı; `go.mod`/`go.sum` diff boş                                                         |
| `implementation.md` kaydı / PT bulguları                     | ❌    | Madde 4                                                                                                             |
| Gizli bilgi, `any`, hata yutma, PII log yeni eklenmedi       | ✅    | Diff taramasında bulgu yok (mekanik bölme; örneklem incelemesi)                                                     |

## Açık konular — nereye işlenmeli (öneri)

| Konu                                                                                                                                       | Öneri                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PT-K11-B1 (`scheduler` saklama işi `stop()` sonrası yeniden kuruluyor, Düşük)                                                              | `gereksinimler.md` §9 "Sonra" tablosuna satır (atanan backend-dev, `fix:`). P27 gözetimsiz erişimde uzun yaşayan süreç olduğu için P27 öncesi kapatılması önerilir.                                                      |
| PT-K15c-B1 (`ConsentForm` 400 `body` hatasında odak etkisiz, a11y)                                                                         | §9 "Sonra" (frontend-dev `fix:`); a11y kalemi olduğu için bir sonraki test-operatoru taramasında kontrol edilmeli.                                                                                                       |
| Kararsız testler: `p13bl-lobby` AC-305 (1/6), `p5-collab` TEST-P5-1, `customers-csv-p19` AC-263 (33–35 sn)                                 | `docs/test-raporu.md` "Kararsız testler" bölümü + §9 "Sonra" tek satır "test kararlılığı işi". AC-305 CI'ı kırdığı (`11dd81e`, `1bb205f`) için öncelikli. AC-263 için eşik ya da CI makinesi kararı proje-yoneticisinde. |
| K8 Windows elle duman testi                                                                                                                | Sonra'ya **değil**: PT kapanış koşulu (Düzeltilmeli 6).                                                                                                                                                                  |
| "Sonra" listeleri (server/web > 60 satır işlevler, `splitServerFields` ikizi, contracts `api/requests.ts` bölünmesi, knip CI kararı PT-D4) | §9 "Sonra (PT, 2026-11-15)" tek satır + `sonuc.md` bağlantısı. "Dokunan böler" kuralı (mimari §9) P27/P28 mimari turunda görev olarak yazılmalı.                                                                         |

## Öneriler (zorunlu değil)

- `scripts/pt-olcum.sh` testler adımına Go test listesi için yöntemi açıkça yazan bir alan eklenmeli (`-list` ile `nm` farkı). 397/398/424/458 karışıklığı buradan çıkıyor.
- Kapsam telafisi için testi adı verilen kritere bağlı tutun: `scheduler.test.ts` "AC-5" testi artık outbox ve purge senaryosunu da taşıyor. Sonraki pakette ayrı ve adı doğru bir test olarak bölünmesi izlenebilirliği artırır.

## Olumlu

- Sözleşme korkuluğu (K1 `pt-surface`: rota tablosu, ad kümesi, WS tipleri, hata kodları, döngü) gerçek bir güvence ağı. Geçici bozma ile sağlaması yapılmış.
- Ölçüm tekrarlanabilir: QA aynı betikle aynı knip, jscpd ve boyut sayılarını aldı.
- 71 test dosyasında assertion kaybı yok. Yardımcıya taşınan her assertion yeni yerinde birebir duruyor.
- Bulgular düzeltilmeden kaydedilmiş (R-PT9'a uyulmuş). Güvenlik PT turu Kritik/Yüksek/Orta/Düşük 0.
