# QA Raporu — P8c-1 (Müşteriler + bilgisayar kaydı, sunucu+panel) — Tur 3
DURUM: GEÇTİ

Tarih: 2026-11-12 · Kapsam (dar): Tur 2 "Düzeltilmeli" 1–4 (frontend-dev) + güvenlik kod turu 2 düşük bulguları B-P8c2-1/2 (backend-dev). Kaynak: `docs/implementation.md` "P8c-1 — düzeltme turu 2 (backend)" ve "(frontend)". Server entegrasyon testleri yeniden koşulmadı (backend-dev 359/359 bildirdi; QA Tur 2'de 355/355 bağımsız doğrulanmıştı, +4 test aşağıda kod okumasıyla incelendi).

## Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm --filter @remote/web e2e` (tam, tek koşu, 4217/3217 boş) | **206 geçti / 0 kaldı / 67 skip** (1,0 dk). AC-41 medyan 30 FPS, AC-57 p95 1,6 ms |
| `pnpm --filter @remote/web typecheck` / `lint` | temiz (çıkış 0) |
| `pnpm --filter @remote/web test` | 18 dosya, 172/172 |
| `pnpm --filter @remote/server typecheck` / `lint` | temiz (çıkış 0) |
| `.only` / `test.fixme` (e2e) | yok |

### Proje bölmesi testi gizliyor mu? — Hayır
`playwright test --list`: **toplam 273** = desktop 127 + mobile 127 + desktop-rtc 18 + desktop-perf 1.
- `p5-collab.spec.ts` 19 test içeriyor: 18'i `desktop-rtc`'de, `@perf` etiketli AC-41 `desktop-perf`'te; `desktop`/`mobile` yalnız p5'i (ve zaten `p4-real`'i) dışlıyor. Hiçbir p5 testi kaybolmadı; dosyadaki `beforeEach` `startsWith("desktop")` kullandığı için yeni projelerde skip olmuyor (çıktıda 19'u da ✓).
- `@perf` yalnız `p5-collab.spec.ts`'te var; `desktop-perf`'in `grep` filtresi başka dosyadan test çekmiyor/kaçırmıyor. `info.project.name !== "desktop"` kullanan p4/p7 dosyaları yeni projelerde listelenmediği için etkilenmiyor.
- Skip hesabı: Tur 2 = 282 test (199+2+81). −19 (p5'in mobil kopyaları, hepsi zaten skip'ti) + 10 (5 yeni customers testi × 2 proje; mobil kopyaları `desktopOnly`) = 273 ✓. Skip: 81 − 19 + 5 = **67** ✓. Sonuç doğru; ancak implementation.md'deki "85 → 67" başlangıç sayısı yanlış (Tur 2 ölçümü 81 idi) — bkz. Öneriler 1.

## Tur 2 maddelerinin kapanışı
| # | Durum | Kanıt |
|---|---|---|
| 1 AC-174/194 kararsızlık | ✅ | `customers.spec.ts:170-205`: önce `toBeVisible()`, sonra `toPass` içinde diyalog kapalıysa odak **doğrulanıp** Enter; iddia gevşemedi (5 adım, SmartScreen, tek seferlik destek metni, axe yardım/form/detay açık+koyu, Esc + odak dönüşü). Kök neden açıklaması (Suspense gizli kök, Enter `body`'ye gidiyor) Tur 2 hata görüntüsüyle (odak body, diyalog kapalı) tutarlı. Tam koşuda yeşil; frontend 10/10 tekrar bildirdi |
| 2 AC-166/178 durumları | ✅ | "AC-166: müşterisiz firma — boş durum …" (`customers-empty`, Yeni müşteri, yardım), "AC-166/178: hata durumları — liste 500 ve detay Talepler sekmesi 500 → Tekrar dene ile toparlanır" (`load-error` → 0, `customer-tab-error`), "AC-178: detay sekmeleri boş durumu", "AC-166/178: yükleniyor" (`customers-loading` `aria-busy=true` → içerik, `customer-tab-loading`) |
| 3 p5-collab zamanlaması | ✅ | `watchArm` MutationObserver: "Kabul et" düğmesinin DOM'a kilitli girdiği (`disabledAtStart === true`) ve kilidin **≥ 1400 ms** sürdüğü sayfa saatiyle iddia ediliyor — eski anlık `toBeDisabled`'dan daha güçlü. AC-41 eşiği (FPS ≥ 15, 1920) değişmedi, `desktop-perf`'te tek başına; diğer p5 iddiaları değişmedi, `desktop-rtc` `workers: 3`. Tam koşuda 0 hata |
| 4 AC-176 toast tam metni | ✅ | `p8b-requests.spec.ts:75` `toHaveText("Yeni destek talebi: Yeni Müşteri — Genel")`; `customers.spec.ts:275` "AC-176 … (tam metin)" → "Yeni destek talebi: Firma Müşterisi — Şişli Bilişim Ltd." + kartta firma |
| B-P8c2-1 | ✅ | `bindings-p8c.test.ts:13,38` `FAKE_TURN_SECRET` (helpers/secrets.ts) kullanıyor; `apps/server/test` altında helpers dışında `test-turn-secret` literali yok. Allowlist değişmedi |
| B-P8c2-2 | ✅ | `customers/service.ts:65-80` `withTxRetry`: ad çakışması 409, ref çakışması `REF_ATTEMPTS` ile, `isTransientDbError` `TRANSIENT_RETRIES = 1` ile sınırlı (sonsuz döngü yok); oluştur/yenile/pasife al/yeniden aktif et (`:237,:332,:375,:430`) bu sarmalayıcıdan geçiyor. Testler (implementation.md: ilk denemede P2034/1213 → 200 + tek audit; iki ardışık → 503 `NOT_READY`, müşteri ACTIVE) mutasyonla kırmızıya döndüğü bildirilmiş. Güvenlik gözlemi (TX içi `shareStatus` dalı) için ayrı regresyon testi eklenmiş |

### `customers/service.ts` prettier ile yeniden biçimlenmesi — bulgu değil, kabul
`apps/server/src/customers/` dizini bu paketin yeni (henüz commit edilmemiş) kodu; geçmişte bir sürümü olmadığından yeniden biçimleme diff gürültüsü ya da blame kaybı yaratmıyor. Davranış farkı yok; typecheck/lint temiz; en uzun satır 161 karakter (projede başka dosyalarda 291'e kadar satır var, yani biçim projenin geniş satır alışkanlığıyla çelişmiyor). Sapma implementation.md'de beyan edilmiş. Projede biçimlendirici yapılandırması olmadığı için bu, tek seferlik elle biçimleme ile aynı statüde (bkz. Öneriler 2).

## Kabul kriterleri (Tur 2'de ⚠️ olanlar)
| AC | Durum | Kanıt |
|---|---|---|
| 166 | ✅ | Sunucu (Tur 2) + panel dolu/sonuç yok/ipucu + yeni boş/hata/yükleniyor testleri |
| 174 | ✅ | "AC-174/194: yardım klavyeyle açılır …" — kararlı (madde 1) |
| 176 | ✅ | Toast tam metni Genel ve firmalı varyantlarda (madde 4) |
| 178 | ✅ | Sekme yükleniyor/boş/hata testleri (madde 2) + "AC-178/K23" |
| 193 | ✅ | P1..P8b e2e'nin tamamı (p5 dahil) tam koşuda yeşil |
| 194 | ✅ | 390 px (mobil) + axe açık/koyu + klavye (madde 1) |
Diğer tüm AC'ler Tur 2 tablosundaki ✅ durumunu koruyor (bu turda sunucu/uygulama kodu yalnız `customers/service.ts` yeniden deneme sarmalayıcısında değişti; typecheck/lint temiz, web 172/172).

## Düzeltilmeli
Yok.

## Definition of Done
| Madde | ✅/❌ | Not |
|---|---|---|
| Testler yeşil (unit + int) | ✅ | web 172/172; server int 359/359 (backend bildirimi, bu turda yeniden koşulmadı) |
| E2E yeşil | ✅ | 206/0/67, skip'ler gerekçeli (masaüstü/mobil ayrımı) |
| Her AC için adında AC no geçen test | ✅ | 166/174/176/178/194 eksikleri kapandı |
| Typecheck / lint temiz | ✅ | web + server |
| Tasarım-kod uyumu | ✅ | Sözleşme değişikliği yok; mock `ws-request` `customerFirm` sözleşmeye uyduruldu |
| Katman/kalite | ✅ | Yeniden deneme sınırlı; hata yutma yok (son hata yeniden atılıyor) |
| PII log/audit | ✅ | Değişiklik yok |
| Yeni bağımlılık / env | ✅ | Yok |
| Gizli bilgi / gitleaks | ✅ | B-P8c2-1 kapandı |
| 5 durum / a11y / iki tema / 390 px | ✅ | Boş/hata/yükleniyor/kısmi + axe açık/koyu + 390 px testli |
| Dokümantasyon | ✅ | implementation.md düzeltme notları (sayı düzeltmesi öneride) |

## Öneriler (zorunlu değil)
1. [frontend-dev] `docs/implementation.md` "P8c-1 — düzeltme turu 2 (frontend)" Doğrulama satırı: "85 → 67" yerine "Tur 2: 81 skip; −19 (p5 mobil kopyaları) +5 (yeni customers testlerinin mobil kopyaları) = 67" yazılmalı.
2. [devops] Projeye ortak bir biçimlendirici yapılandırması (ör. `.prettierrc` printWidth 200 + `format:check`) ya da "biçimlendirici yok, elle biçim" kararı eklenirse ajanların tek dosyayı farklı biçimle yeniden yazması önlenir.
3. [frontend-dev] Boş durumda `CustomersActions`'ın iki kez çizilmesiyle oluşan çift `customers-help` diyaloğu (implementation.md gözlemi) tek diyaloğa indirilebilir.
4. `desktop-perf` bağımlılık nedeniyle diğer projelerden biri kırmızıyken "did not run" olur; Playwright çıkış kodu yine sıfırdan farklı olduğundan CI'da maskelenmez — yalnız raporda AC-41'in koşmadığı açıkça okunmalı.

## Olumlu
- Kararsızlık "timeout artır"la değil kök nedenle çözülmüş; p5 kilit iddiası güçlendirilerek kararlı hale getirilmiş, ölçüm eşiği gevşetilmemiş.
- Proje bölmesi test kaybettirmiyor; sayılar uçtan uca tutarlı.

---

# QA Raporu — P8c-1 (Müşteriler + bilgisayar kaydı, sunucu+panel) — Tur 2
DURUM: DÜZELTİLMELİ

Tarih: 2026-11-12 · Kapsam: Tur 1 "Düzeltilmeli" 1–10'un kapanışı + gerileme kontrolü + Tur 1'de kanıtsız kalan web e2e (AC-169, AC-174, AC-194, panel 5 durumu). Kaynak notlar: `docs/implementation.md` "P8c-1 — düzeltme turu 1", "Düzeltme — TURN'süz ilk teklif" → "E2E mock uyumu". Kod commit edilmemiş çalışma ağacında incelendi.

## Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run typecheck` | contracts / server / web temiz |
| `pnpm -r run lint` | temiz |
| `pnpm -r run test` | contracts 64/64, web 172/172, server unit 285/285 |
| `apps/server: pnpm run test:int` (geçici DB `rs-mysql-p8c-qa2`:33323, koşu sonrası `test-db.sh down` ile silindi) | **37 dosya, 355/355** (Tur 1: 342 + 13 yeni). Perf ölçümü (AC-166/176, medyan): liste 36 ms, arama 28 ms, talep filtresi 50 ms (sınır 500 ms) |
| `pnpm --filter @remote/web e2e` (tam koşu, port 4217/3217 boş) | **199 geçti / 2 kaldı / 81 skip** — kalanlar: `customers.spec.ts:170` "AC-174/194 …" (desktop) ve `p5-collab.spec.ts:216` "TEST-P5-1 …" (desktop) |
| Tekrar: `playwright test e2e/customers.spec.ts e2e/p5-collab.spec.ts --project=desktop --repeat-each=3` | **80 geçti / 4 kaldı** — `customers.spec.ts:170` 3 koşudan 1'inde yine kaldı (aynı hata); p5-collab'da AC-41 (×2) ve TEST-P5-1 `:198` |

**customers.spec.ts:170 hatası** (4 koşudan 2'sinde): `trigger.focus()` + `Enter` sonrasında yardım diyaloğu açılmıyor → `getByTestId('customers-help').locator('ol li')` 0 öğe (beklenen 5). Hata bağlamındaki sayfa görüntüsünde düğme var, diyalog kapalı. Kararsız (flaky) ve AC-174/AC-194 kanıtının tamamı bu teste dayanıyor.

**p5-collab hataları:** `file-accept` 1,5 sn kilidi (`toBeDisabled`) ve AC-41 FPS/genişlik — yük altında zamanlama. P5 dosyaları ve ilgili uygulama kodu bu pakette değişmedi (`git status`: yalnız `components/ui/dialog.tsx` geriye uyumlu `onDismiss` eki, `e2e/mock-*.mjs`); frontend-dev de "E2E mock uyumu" notunda yük altında p5/p7/p8-history zamanlama hatalarını kaydetmiş. P8c gerilemesi değil; yine de kırmızı test.

Skip: `customers.spec.ts` proje bazlı `test.skip` (masaüstü/mobil akış ayrımı) — gerekçeli. Diğer 81 skip mevcut speclerin aynı desktop/mobile ayrımı. `.only` yok.

## Tur 1 maddelerinin kapanışı
| # | Durum | Kanıt |
|---|---|---|
| 1 AC-181 negatif yollar | ✅ | `bindings-p8c` "AC-181: lobideki (admit öncesi) misafirin binding.request'i 1008 …; BROWSER … FORBIDDEN; teklifsiz AGENT CONFLICT — hiçbirinde kayıt yok" + "AC-181 / B-P8c-1 … inactive" + mevcut 0.9.x testi. Test gövdesi tenant'ta `deviceBinding.count = 0` ve `rs_binding_denied_total{reason="browser"}` doğruluyor. "Reddedilen misafir" ayrı test yok; gerekçe (ret soketi kapatır) implementation.md'de, kabul |
| 2 §15.1 (2)(3) | ✅ | "§15.1 (2)(3) / AC-185 …": iptal sonrası öğe `viaBinding=false, bindingRevoked=true, staleSource=true`; kabulde `binding.request` → `CONFLICT`, etkin satır 0, `binding.denied{reason:"stale_source", requestId}` audit |
| 3 §15.3 servis | ✅ | "§15.3 / AC-181: … iki farklı previousKey + anahtarsız" (tek etkin satır, kb dokunulmadı) + "§15.3: eşzamanlı iki binding.request" (Promise yerine art arda iki gönderim; `renewed` [false,true], toplam 1 satır). Test gerçek bir kilitlenme hatasını yakalamış ve düzeltilmiş (implementation.md) |
| 4 AC-184 uçlar | ✅ | "AC-184: bindingKey ile /ws/request, /ws/guest reconnect ve /ws/tech … reddedilir" (HTTP 403/404), log'da anahtar yok. Ayrı REST TURN ucu olmadığı doğrulandı (`app.ts` TURN yalnız `Rooms`'a veriliyor; `/admin/settings/turn` SUPER_ADMIN ayar ucu, kimlik bilgisi vermiyor) — gerekçe kabul |
| 5 K20 / req.create.binding | ✅ | "K20: … req.create.ip kovasına sayılır (6. istek 429 + rate audit)", "K20 / §5.3: req.create.binding kayıt başına 6/sa → farklı IP'lerden 7. talep 429" (audit `bucket` doğrulanıyor) |
| 6 AC-188 seed testi | ✅ | "AC-188: seed, eski sistem metnindeki tenant'a yeni sürüm yazar …; yeniden çalıştırma idempotent". `seed.ts` `seed-consent.ts`'i import ediyor (test edilen kod üretimde koşan kod) |
| 7 AC-192 talepten doğan oturum | ✅ | "AC-192: müşteri ref'iyle açılmış talep kabulünde teknisyenin ilk ice.servers'ı TURN girdisi içerir ve peer.joined'dan ÖNCE gelir" — PENDING hello'da `iceServers: []`, sonra sıra ve `turn:` + kullanıcı/kimlik doğrulanıyor, oturum `customerId` taşıyor |
| 8 A7 diyagramı | ✅ | `docs/mimari-akislar.md` §A7 / A7a / A7b / A7c |
| 9 CHECK 17→19 gerekçesi | ✅ | implementation.md P8c-1 Backend sapmalar madde 7, son alt madde |
| 10 Web e2e tam koşu | ⚠️ | QA koştu (yukarıda); 2 kırmızı. AC-174/194 testi kararsız (bkz. Düzeltilmeli 1) |

Ek (güvenlik turu kaynaklı, gerileme kontrolü): B-P8c-1 kabul yarışı + `cancelledRequests = 2`, B-P8c-3 403, B-P8c-5 biçim dışı anahtar 404 + kova testleri yeşil. Web `requests/page.tsx` `canRevoke = customers.edit && support_requests.view`.

**Mock `revoke-binding` notu:** `e2e/mock-customers.mjs:66` yalnız `customers.edit` bakıyor, sunucu `support_requests.view` da istiyor. E2E'de **etkisi yok**: menü öğesi yalnız `/requests` sayfasında (o sayfa `support_requests.view` ister) ve `canRevoke` iki yetkiyi birden arıyor; müşteri sayfalarında iptal eylemi yok; e2e kullanıcıları (`mock-requests.mjs:27`) iki yetkiye birlikte sahip. Bulgu değil, öneri.

## Kabul kriterleri
| AC | Durum | Kanıt (test adı) veya eksik |
|---|---|---|
| 165 | ✅ | api "AC-165 …" (4), contracts tek tanım; e2e kritik akışta menü öğesi `aria-current`, "AC-178/K23" USER'da `customer-new`/düzenle yok |
| 166 | ⚠️ | Sunucu ✅ (arama, PII, perf 36 ms). Panel: dolu liste ✅ (kritik akış), "sonuç yok" ✅ ("AC-166 arama"), 2 karakter ipucu ✅. **Yükleniyor / boş ("Henüz müşteri yok" + Yeni müşteri + yardım) / hata ("Tekrar dene") durumlarının hiçbir testi yok** — kodda var (`customers/loading.tsx`, `page.tsx` `customers-empty`, `LoadError`), AC metni bu durumları açıkça sayıyor |
| 167 | ✅ | api + db + contracts + e2e "AC-167 form" |
| 168 | ✅ | Tur 1 ile aynı |
| 169 | ✅ | e2e "AC-169: pano API'si reddederse bağlantı seçili metin olarak gösterilir" — 4/4 koşuda geçti; test seçimin > 10 karakter ve odakta olduğunu doğruluyor; kritik akışta başarılı kopyalama + "Kopyalandı" + pano içeriği eşitliği |
| 170 / 171 | ✅ | api + bindings + e2e "AC-170/171" (diyalog metni, odak Vazgeç, pasifte bağlantı yok) |
| 172 / 173 | ✅ | Tur 1 ile aynı |
| 174 | ⚠️ | e2e "AC-174/194: yardım klavyeyle açılır …" **kararsız**: 4 masaüstü koşusunun 2'sinde Enter ile diyalog açılmadı. Geçtiği koşularda 5 adım, SmartScreen, tek seferlik destek metni, Esc + odak dönüşü doğrulanıyor |
| 175 | ✅ | Tur 1 ile aynı |
| 176 | ⚠️ | Sunucu ✅; kart firma satırı + filtre (kuyruk/Genel/Geçmiş geçişi) e2e ✅. **"Yeni talep toast'ında müşteri firma adı görünür" testle iddia edilmiyor**: `p8b-requests` AC-149 toast'ı `hasText: "Yeni destek talebi: Yeni Müşteri"` alt dizesiyle arıyor, " — Genel"/firma kısmı doğrulanmıyor (kod `request-notifier.tsx:89` doğru görünüyor) |
| 177 | ✅ | Tur 1 ile aynı |
| 178 | ⚠️ | Sunucu ✅; e2e "AC-178/K23" sayı tutarlılığı + yetkisiz sekme ✅. **AC metnindeki "her sekmede yükleniyor, boş ve hata durumu" testsiz** (`customer-tab-loading`, `customer-tab-error` kodda var) |
| 179 | ✅ | Tur 1 ile aynı |
| 180 | ✅ | api + e2e "AC-180: Yeni Destek Oturumu …" (pasif müşteri listelenmez, kartta firma) |
| 181 (sunucu) | ✅ | Madde 1 ve 3 |
| 182 / 183* / 186 / 187 (sunucu) | ✅ | Tur 1 ile aynı (*183 bu paketin kapsamında değil) |
| 184 (sunucu) | ✅ | Madde 4 ve 5 |
| 185 (sunucu) | ✅ | Madde 2 + B-P8c-5; e2e "r2 §15.2: talep kartı menüsünden …" |
| 188 (seed) | ✅ | Madde 6 |
| 191 (sunucu) | ✅ | Tur 1 ile aynı |
| 192 (konsol entegrasyon) | ✅ | Madde 7 |
| 193 | ✅ (sunucu/contracts/web unit) · ⚠️ e2e | Eski P1..P8b e2e'nin tamamı geçti, **p5-collab hariç** (zamanlama, P8c dışı; bkz. Düzeltilmeli 3) |
| 194 | ⚠️ | 390 px: e2e "AC-194: 390 px …" (mobil) ✅. Axe açık/koyu (liste, yardım, form, detay) ve klavye: AC-174 ile aynı kararsız teste bağlı |
| 195 | ✅ | Tur 1 ile aynı |

## Düzeltilmeli
1. [frontend-dev] `apps/web/e2e/customers.spec.ts:170-197` ("AC-174/194") — tam koşuda ve `--repeat-each=3`'te 4 masaüstü koşusunun 2'sinde `customers-help` açılmıyor (`ol li` 0). Trace: `apps/web/test-results/customers-AC-174-194-*/trace.zip`. Kök nedeni belirle: (a) düğme hidrasyondan önce odaklanıp Enter'a basılıyorsa testte hidrasyonu bekle (ör. diyalog görünür olana kadar `expect(...).toPass()` ile Enter'ı yinele ya da sayfanın etkileşime hazır olduğunu gösteren bir koşul bekle); (b) uygulamada `HelpDialog` açılış durumu kaybediliyorsa (`emulateMedia` + `goto` sonrası) kodu düzelt. Beklenen: `--repeat-each=10 --project=desktop` ile 10/10 yeşil, sonucu implementation.md'ye yaz.
2. [frontend-dev] `apps/web/e2e/customers.spec.ts` + `e2e/mock-customers.mjs` — AC-166 ve AC-178'in saydığı durumların testi yok → mock'a senaryolar ekle ve test et: (i) müşterisiz tenant'ta `/customers` → `customers-empty` ("Henüz müşteri yok", `customer-new-empty`, `customers-help-open-empty`); (ii) liste ucu 500 → `load-error` + "Tekrar dene" (p8b-requests'teki `rqbroken` kalıbı gibi); (iii) detayda Talepler sekmesi ucu 500 → `customer-tab-error`, boş müşteri → sekme boş durumu. Yükleniyor iskeleti için en az `customers-loading`/`customer-tab-loading`'in render edildiğini (ör. yanıtı geciktirilmiş mock ile) doğrula.
3. [frontend-dev] `apps/web/e2e/p5-collab.spec.ts:71` (TEST-P5-1, `file-accept` `toBeDisabled` kilidi) ve `:491` (AC-41 FPS/1920) — tam paralel koşuda kararsız; P8c değişikliğinden kaynaklanmıyor ama "E2E yeşil" DoD'sini kırıyor. Yük altında kilidin 1,5 sn'lik penceresi kaçırılıyorsa iddiayı zamanlamaya dayanmayacak şekilde (ör. `data-armed` niteliği ya da kilit başlangıcının sahte saatle sabitlenmesi) yaz; AC-41 için serial/ayrı worker ya da mevcut eşikle tutarlı bekleme. Beklenen: tam `pnpm --filter @remote/web e2e` art arda 2 koşuda 0 hata.
4. [frontend-dev] AC-176 toast firma adı — `apps/web/e2e/p8b-requests.spec.ts:72` (veya customers.spec) toast metnini tam olarak doğrula: Genel talepte "Yeni destek talebi: <ad> — Genel", müşterili `request.new`'de (mock `mock-requests.mjs:121` `customerFirm` dolu bir varyant) "— Şişli Bilişim Ltd.".

## Definition of Done
| Madde | ✅/❌ | Not |
|---|---|---|
| Testler yeşil (unit + int) | ✅ | 64 + 172 + 285 + 355 |
| E2E yeşil | ❌ | 2 kırmızı (customers AC-174/194 kararsız, p5-collab zamanlama) |
| Her AC için adında AC no geçen test | ⚠️ | Tur 1 eksikleri (188, 192, 181, 184) kapandı; AC-166/178 durumları ve AC-176 toast firması testsiz |
| Typecheck / lint temiz | ✅ | |
| Tasarım-kod uyumu | ✅ | Düzeltme turu sapmaları (revoke yetkisi, TX içi iptal, metrik etiketi) mimari-e10 §15.2 ve runbook'a işlenmiş |
| Katman/kalite (any, hata yutma, sayfasız liste, TX) | ✅ | Düzeltmede ölü `pendingCount` silinmiş; yeniden deneme `isTransientDbError` ile sınırlı (1 kez) |
| PII log/audit | ✅ | AC-184 testinde log'da anahtar yok; `binding.denied` newValue yalnız `reason/requestId` |
| Yeni bağımlılık / env | ✅ | Yok |
| grants.sql + check-app-grants | ✅ | Şema değişmedi |
| İkonlar / ham renk-px | ✅ | Tur 1'den değişiklik yok |
| 5 durum / a11y / iki tema / 390 px | ❌ | 390 px ✅; axe/klavye kararsız testte; boş/hata/yükleniyor testsiz |
| Dokümantasyon | ✅ | A7 diyagramı, implementation.md madde 7, runbook metrik satırı |

## Öneriler (zorunlu değil)
- `e2e/mock-customers.mjs:66` `revoke-binding` koşulunu sunucuyla aynı yap (`customers.edit && support_requests.view`); bugün e2e'ye etkisi yok, ileride yanlış yeşil üretebilir.
- `playwright.config.ts` portlarını env ile değiştirilebilir yapmak (Tur 1 önerisi, açık).
- Tur 1 mimar/proje-yöneticisi önerileri (mimari-api `customerFirm`, §3.6 `foldKey` örneği, AC-193 şerhi) hâlâ açık.

## Olumlu
- Backend düzeltme turu tüm 9 maddeyi kapattı; yeni testler AC'yi gerçekten iddia ediyor (DB sayımı, audit `reason`, metrik etiketi, mesaj sırası), sadece durum kodu değil.
- §15.3 eşzamanlılık testi gerçek bir InnoDB kilitlenme + REPEATABLE READ anlık görüntü hatasını yakalatıp düzelttirdi.
- Seed mantığı test edilebilir modüle taşınarak AC-188 üretimde koşan kod üzerinden kanıtlandı.
- Gerileme yok: 355/355 entegrasyon, P1..P8b e2e'nin p5-collab dışındaki tamamı yeşil.

---

# (Arşiv) QA Raporu — P8c-1 (Müşteriler + bilgisayar kaydı, sunucu+panel) — Tur 1
DURUM: DÜZELTİLMELİ

Tarih: 2026-11-12 · Kapsam: AC-165..180, 181/182/184/185/186/187 (sunucu), 188 (seed), 191 (sunucu), 192 (konsol entegrasyon), 193, 194, 195 — mimari-e10 §12.1/§13, bağlayıcı §15 r2. Kod commit edilmemiş çalışma ağacında incelendi.

## Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run typecheck` | contracts / server / web temiz |
| `pnpm -r run lint` | temiz |
| `pnpm -r run test` | contracts 64/64, web 172/172, server unit 285/285 |
| `apps/server: pnpm run test:int` (geçici DB `rs-mysql-p8c-qa`:33321, sonra silindi) | **37 dosya, 342/342 geçti**, kırmızı yok |
| `pnpm --filter @remote/web e2e` | **QA tarafından koşulamadı**: mock API portu 4217 paralel frontend düzeltmesinin süreci tarafından dolu (`playwright.config` portları sabit). frontend-dev'in beyanı (customers + p8b-requests + sessions + p8-history 79/79) bağımsız doğrulanmadı. `p7-control.spec` masaüstü hataları bilinen mock sorunu, **paralel düzeltmede** (`e2e/mock-ws.mjs` değişikliği), bulgu yazılmadı |

Skip: yalnız `customers.spec.ts` içinde proje bazlı `test.skip(name !== "desktop" / "mobile")` (masaüstü/mobil akış ayrımı) — gerekçeli. `.only` yok.

## Kabul kriterleri
| AC | Durum | Kanıt (test adı) veya eksik |
|---|---|---|
| 165 | ✅ (e2e menü gizleme ⚠️ QA koşmadı) | api "AC-165: customers.view/create/edit/delete …" (4 test), contracts "AC-165: customers.* tek tanımda"; side-nav `perm: "customers.view"` |
| 166 | ✅ sunucu / ⚠️ panel 5 durum | api "AC-166: arama … listede PII yok", "AC-166 / AC-176: 1.000 müşteri + 10.000 talep < 500 ms"; panel durumları yalnız e2e'de |
| 167 | ✅ | api "AC-167: ad … 409 fields.name", "AC-167: istemci atlatılsa da sunucu 400"; db "AC-167 …"; contracts şema testleri |
| 168 | ✅ | api "AC-168: müşteri ref'i …", db "AC-168: aynı ref ikinci kez kaydedilemez", unit "AC-168: seed …" |
| 169 | ⚠️ kanıtsız | Yalnız Playwright ("AC-169: pano API'si reddederse …"); QA koşamadı |
| 170 | ✅ | api "AC-170: bağlantı yenileme …", bindings "AC-185/170"; dialog metni tr.json `cu.rotate.body` |
| 171 | ✅ | api "AC-171: pasife alma … süpürücü yarışta kalanı iptal eder", bindings "AC-185/171" |
| 172 | ✅ | api "AC-172" (2 test), tenant-matrix (14 yeni uç, 9 çapraz-tenant), db bileşik FK testleri |
| 173 | ✅ | api "AC-173/195 …ham PII hiçbir audit satırında yok", unit "AC-173: izinli liste" |
| 174 | ⚠️ kanıtsız | Yalnız Playwright ("AC-174/194: yardım klavyeyle …"); QA koşamadı |
| 175 | ✅ | api "AC-175/176/177" (Genel ref → `customerFirm=null`); general-link ucu |
| 176 | ✅ sunucu / ⚠️ toast+kart e2e | api "AC-175/176/177", perf testi filtre; fixture `ws-request.json` |
| 177 | ✅ | api "AC-175/176/177 … kabulde oturuma kopya", db "AC-176/177" |
| 178 | ✅ sunucu / ⚠️ panel | api "AC-178: detay sekmesi … tutarlı" |
| 179 | ✅ | api "AC-179/180 … CSV 'Müşteri firma' sütunu + filtre, formül kaçışı" |
| 180 | ✅ sunucu / ⚠️ panel | api "AC-179/180 … yetkisiz 403, geçersiz 404" |
| 181 (sunucu) | ⚠️ eksik | "AC-181: ≥0.10.0 …" ve "0.9.x teklif almaz" var. **AC metnindeki "tarayıcı modunda ve onay verilmeden kapanan oturumda kayıt yazılmaz (test)"** ve mimari §11 "lobi/ret/BROWSER/admit öncesi/teklifsiz istek → kayıt yok" testi yok; §15.3 eşzamanlı/çift `previousKey` servis testi yok (yalnız DB UQ testi) |
| 182 (uç) | ✅ | bindings "AC-182/184: kayıtla talep kaydın müşterisine düşer …" |
| 184 (sunucu) | ⚠️ eksik | "AC-184: … resolve/join (400/404)" + `/ws/guest` ticket var; **TURN kimlik bilgisi ucu ve `/ws/request` için negatif test yok**; K20 (§15.7-1) "kayıtla talep ip/önek/net48/tenant kovalarından muaf değil — testle sabitlenir" testi ve `req.create.binding` 6/sa testi yok |
| 185 (sunucu) | ✅ (§15.1 kısmen) | bindings "AC-185/170", "AC-185: panelden tek kayıt iptali", "AC-185/171". **§15.1 test (2) iptal edilmiş kayıttan açılan talebin kabulünde kayıt verilmez ve (3) `viaBinding=false, bindingRevoked=true` testi yok** (yalnız (1) var) |
| 186 (uç) | ✅ | bindings "AC-186: public revoke her durumda 204" |
| 187 (sunucu) | ✅ | bindings "AC-187: müşterisiz oturum … REPLACED" |
| 188 (seed) | ⚠️ kanıtsız | `seed.ts` aydınlatma yeni sürüm metni var; mimari §11 "seed aydınlatma yeni sürüm testi" yok, adında AC-188 geçen test yok |
| 191 (sunucu) | ✅ | api "AC-191: 0.9.1 gövdesiyle …", unit "AC-191: CUSTOMER_PASSIVE / BINDING_REVOKED → TENANT_PASSIVE" |
| 192 (konsol entegrasyon) | ⚠️ | İçerik olarak `signaling-rooms` "AC-112/G-01: … ice.servers (TURN'lü) peer.joined'dan ÖNCE" kanıtlıyor; ancak **talepten doğan oturum** üzerinde değil ve adı AC-192 içermiyor |
| 193 | ✅ (aşağıdaki karar) | Tüm eski server/contracts/web birim+entegrasyon testleri yeşil; e2e regresyonu QA koşamadı |
| 194 | ⚠️ kanıtsız | Yalnız Playwright (axe iki tema, 390 px); QA koşamadı |
| 195 | ✅ | api "AC-195: … anonimleşir (saat ileri)", "AC-173/195", db "AC-181/195 özet NULL" |

### AC-193 kararı (eski test beklenti güncellemeleri)
- **CSV "Müşteri firma" sütunu** (`requests-p8b-5`, `sessions-history-api-p8`): AC-179 sütunun "Kaynak"tan sonra eklenmesini zorunlu kılıyor; tam başlık eşitliği yapan eski iddia değişmeden geçemez. Değişiklik yalnız sütunu ekliyor, formül kaçışı ve diğer iddialar aynen. **Meşru** (AC-179 ↔ AC-193 çelişkisi spesifikasyon gereği çözülmüş).
- **`request.created` newValue `{clientVersion, via, customerId}`** (`security-p8b-fix1`): mimari-e10 §5.7 zorunlu kılıyor; IP yokluğu iddiası korunmuş. **Meşru.**
- **`session-history-p8` CHECK sayısı 17 → 19**: yeni şemanın (customers.status, device_bindings.revoke_reason ikili CHECK) zorunlu sonucu, **meşru** — ancak implementation.md madde 7 listesinde **yazılmamış** (bulgu 9).
- **tenant-matrix eklemeleri**: aracın kendi sözleşmesi ("yeni paket uç eklediğinde ROUTE_CLASSES + CROSS_TENANT_CASES'e satır ekler"); kapsam genişletme, gevşetme yok. **Meşru.**
- web `requests.test.ts` / `ws-request.json` fixture: strict `panelOutboundSchema` yeni zorunlu alanları istiyor; **meşru**.
Sonuç: hiçbir değişiklik iddia zayıflatmıyor; AC-193 karşılanmış sayıldı.

### Sapmaların değerlendirmesi
| Sapma | Karar |
|---|---|
| Geçmiş filtresi `customerFirm` (mimari-api `customer`) | Kabul — P8 `customer` misafir adı aramasıyla çakışma gerçek; mimari-api güncellenmeli (öneri) |
| `foldKey` noktalamayı korur | Kabul — AC-167 yalnız harf/Türkçe duyarsızlık ister; ancak mimari §3.6 örneği ("ŞİŞLİ Ltd." = "şişli ltd") artık yanlış; mimar düzeltmeli (öneri) |
| `cancelledRequests` TX içi bekleyen sayısı | Kabul — kalan yarış 60 sn süpürücüde, testli |
| Onay diyalogları tek `customer-actions.tsx` | Kabul — davranış aynı, dosya sayısı azalır |
| Geçmiş "Müşteri firma" sütunu koşullu | Kabul — AC-193 (P8 e2e `getByLabel("Firma")` alt dize) gerekçesi geçerli; CSV/kart/detay her zaman taşır |

## Düzeltilmeli
1. [backend-dev] `apps/server/test/integration/bindings-p8c.test.ts` — AC-181 negatif yollar testi yok → "AC-181: BROWSER misafir, lobide bekleyen/reddedilen, admit öncesi ve teklif almadan gönderilen `binding.request` → kayıt yazılmaz" testi (AC metni "(test)" diyor).
2. [backend-dev] aynı dosya — §15.1 test (2) ve (3) eksik → kayıtla açılan talep, kayıt `revoke-binding` ile iptal edildikten sonra (bekleyen kalacak şekilde iptal sırası ayarlanarak ya da DB'den) kabul edilince `binding.request` → `error{CONFLICT}`, satır yok, `binding.denied` audit; ve iptal edilmiş kayıttan talepte liste öğesi `viaBinding=false, bindingRevoked=true`.
3. [backend-dev] aynı dosya — §15.3 servis testi eksik → aynı oturumda iki farklı `previousKey` + anahtarsız istek sonrası tek etkin satır; eşzamanlı iki `binding.request` (Promise.all) → tek etkin satır (P2002 yeniden deneme yolu).
4. [backend-dev] aynı dosya — AC-184 eksik uçlar → `bindingKey` ile TURN kimlik bilgisi ucu ve `/ws/request` bağlantısı reddedilir (401/403/404) testi.
5. [backend-dev] aynı dosya — K20/§15.7-1 "testle sabitlenir" maddesi ve §5.3 `req.create.binding` 6/sa → kayıtla gelen taleplerin E9 ip/önek/tenant kovalarına sayıldığını ve kayıt başına 7. talebin 429 aldığını doğrulayan test.
6. [backend-dev] AC-188 (seed) testi yok → adında AC-188 geçen test: seed sonrası tenant'ın `is_current` aydınlatma metni yeni sürüm ve metinde bilgisayar kaydı/saklama/“Bu bilgisayarı unut” ifadeleri var.
7. [backend-dev] AC-192 (P8c-1 konsol entegrasyon) → talepten doğan oturumda (müşteri ref'iyle açılmış talep kabulü) teknisyenin admit sonrası ilk `ice.servers` mesajının TURN girdisi içerdiğini ve `peer.joined`'dan önce geldiğini doğrulayan, adında AC-192 geçen entegrasyon testi.
8. [backend-dev] `docs/mimari-akislar.md` — mimari-e10 §2.1 ve §12.1 A7 (A7a/A7b/A7c) sequence diyagramını backend P8c-1'e atıyor; dosyada A7 yok → ekle.
9. [backend-dev] `docs/implementation.md` P8c-1 Backend "Tasarımdan sapmalar" madde 7 — `session-history-p8.test.ts` CHECK sayısı 17→19 güncellemesi listede yok → gerekçesiyle ekle.
10. [frontend-dev] Web e2e bağımsız doğrulanamadı (port 4217 paralel süreçte) → p7-control düzeltmesi bitince `pnpm --filter @remote/web e2e` tam koşu çıktısını (geçen/kalan/skip) implementation.md'ye yaz; QA Tur 2'de AC-169/174/194 ve panel 5 durumu yeniden koşulacak.

## Definition of Done
| Madde | ✅/❌ | Not |
|---|---|---|
| Testler yeşil (unit + int) | ✅ | 64 + 172 + 285 + 342 |
| E2E yeşil | ❌ | QA koşamadı (port çakışması); p7-control paralel düzeltmede |
| Her AC için adında AC no geçen test | ❌ | AC-188, AC-192 yok; AC-181/184 kısmi |
| Typecheck / lint temiz | ✅ | |
| Tasarım-kod uyumu | ✅ | Uçlar, şema (`active_session_id` STORED+UQ, CHECK'ler), r2 §15.1–15.7 kodda; sapmalar gerekçeli |
| Katman/kalite (any, hata yutma, sayfasız liste, TX) | ✅ | `any`/boş catch yok; liste 50/sayfa, sekmeler 25, options ≤20; çoklu yazmalar tek TX + audit |
| PII log/audit | ✅ | `customerAuditView` izinli liste, REDACT += bindingKey/previousKey/PII; testli |
| Yeni bağımlılık | ✅ | Yok (combobox kendi primitifi) |
| Yeni env | ✅ | Yok |
| grants.sql + check-app-grants | ✅ | Yeni tablolar eklendi, CI'da `check-app-grants.sh` |
| İkonlar (lucide, anlamlı) | ✅ | Building2, Link2, CircleHelp, Plus, SearchX, Archive/ArchiveRestore, RefreshCw, PenLine, Inbox, MonitorSmartphone, Lock |
| Ham renk/px | ✅ | customers/combobox/copy-link/revoke dialog'da taranmış, yok |
| 5 durum / a11y / iki tema / 390 px | ⚠️ | Kodda iskelet, boş, sonuç yok, hata, yetkisiz sekme, anonim var; axe/klavye/390 px yalnız e2e — doğrulanmadı |
| Dokümantasyon (implementation, runbook, db-notlari, DESIGN.md) | ❌ | A7 akış diyagramı eksik; implementation.md test değişikliği listesi eksik |

## Öneriler (zorunlu değil)
- mimar: `docs/mimari-api.md` geçmiş filtresi parametre adını `customerFirm` olarak; `docs/mimari-e10.md` §3.6 `foldKey` örneğini noktalama korunur şekilde; dba sapmalarını (FK sütun sırası, INSERT sırası) §3'e işle.
- proje-yoneticisi: AC-193'e "spesifikasyonun zorunlu kıldığı genişletmeler (yeni CSV sütunu, audit alanı, CHECK sayısı) hariç" şerhi düş.
- `playwright.config` portlarını env ile değiştirilebilir yapmak (paralel koşu çakışmasını önler) — devops/frontend-dev.
- Geçmiş sütunu koşullu görünürlüğü kalıcı çözüm değil; ileride P8 testi değiştirilebilir olduğunda sütun her zaman gösterilmeli.

## Olumlu
- Ref ad alanı (`request_refs`), `active_session_id` STORED UQ ve ikili CHECK'ler DB değişmezi olarak testli; bileşik FK'lerle tenant tutarlılığı DB seviyesinde.
- K19 audit maskesi tek izinli liste fonksiyonunda; ham PII'nin hiçbir audit satırında geçmediği dize araması ile test edilmiş.
- 1.000 müşteri / 10.000 talep performans testi gerçek DB'de (sınır 500 ms, ölçüm ≤ 34 ms).
- 0.9.x uyumu (teklif yok, `CUSTOMER_PASSIVE`→`TENANT_PASSIVE` eşleme) hem birim hem entegrasyon testli.
- Eski test değişiklikleri minimal ve iddia zayıflatmıyor.
