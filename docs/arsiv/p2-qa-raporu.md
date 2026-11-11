# P2 QA raporu — Tur 1
DURUM: DÜZELTİLMELİ

Paket P2: destek oturumu oluşturma, listeleme ve iptal, müşteri link çözümleme ve durum ekranları.
Denetim tarihi 2026-11-11. Denetçi kod değiştirmedi.

Kabul edilmiş notlar (bulgu sayılmadı): seed teknisyen oluşturmuyor (P9), istek logunda IP yok.

## Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` | temiz (exit 0) |
| `pnpm -r run typecheck` | temiz (contracts, web, server) |
| `pnpm -r run test` | contracts 2/2, web 12/12, server unit 16/16. Kalan 0, skip 0 |
| `test-db.sh up` + `pnpm --filter @remote/server test:int` (MySQL 8.4 geçici konteyner) | 12 dosya, 56/56 geçti. Konteyner silindi |
| `pnpm --filter @remote/web e2e` | 85 geçti, 1 skip, 0 kalan |

Skip olan test: `sessions.spec.ts:107` AC-61 sütun testi, yalnız mobil projede. Gerekçe test içinde yazılı ("sütun başlıkları masaüstü tablosunda") ve aynı test masaüstünde koşup geçiyor. Kabul edildi.

## Kabul kriterleri
| AC | Durum | Kanıt veya eksik |
|---|---|---|
| AC-1 | ✅ | `sessions.test.ts` "AC-1, AC-2: 256 bit base64url link…"; e2e `AC-1/3/9` link biçimi `/session/[A-Za-z0-9_-]{43}`; `codes.ts` `newSecretToken` |
| AC-2 | ✅ | `sessions.test.ts` aynı test: DB ve audit dökümünde düz token yok, yalnız SHA-256 |
| AC-3 (rev.) | ✅ | 8 hane + UQ çakışma tekrarı (`sessions.test.ts:56`), kod yalnız PENDING iken var (`sessions-lifecycle.test.ts:30`, DB CHECK `code_pending_chk`), IP 10/dk ve /24 30/dk limitleri, diğer kaynak etkilenmiyor (`sessions-public.test.ts:58,69`), `ip.test.ts` /24 ve /56, e2e `#### ####` gösterimi |
| AC-4 | ⚠️ kısmi | Okuma kısmı kanıtlı (`sessions.test.ts:46` expiresAt = oluşturma + `session_ttl_min`, DB CHECK `ttl_chk`). "Aralık dışı 400" kısmı yok. Bu kısım `PUT /settings/tenant` ucuna bağlı (mimari-api:99), uç P9/P10'da. Erteleme implementation.md Backend sapma 6'da gerekçeli, ama mimari §13 tablosu (satır 436) AC-4'ü hâlâ tümüyle P2'de gösteriyor (QA-P2-7) |
| AC-5 | ⚠️ | 410 `SESSION_EXPIRED` + EXPIRED/SYSTEM durumu (`sessions-lifecycle.test.ts:99`), expiry işi + audit `session.expired` (`:110`), e2e `guest-expired` ekranı. Eksik: mimari §13'teki "audit fail" (`session.resolve` result=fail) testsiz (QA-P2-1); durum yoklama yolundaki expiry (`public.ts:103-106`) testsiz (QA-P2-2) |
| AC-7 (P2 kısmı) | ✅ | `sessions-public.test.ts:43` ACTIVE/ENDED → 410 `SESSION_CONSUMED`; e2e `guest-consumed` |
| AC-8 | ✅ | `sessions-lifecycle.test.ts:60` iptal ≤1 sn, link 410, kod 404, yoklama CANCELLED, ikinci iptal 409, audit `session.cancelled`; e2e uçtan uca iptal → müşteri sayfası ≤5 sn'de "Oturum iptal edildi"; onay diyaloğunda odak "Vazgeç"te |
| AC-9 | ✅ | e2e `AC-1/3/9`: pano içeriği linkle aynı + "Kopyalandı" toast'ı |
| AC-11 | ✅ | `sessions.test.ts:70` 6 paralel istek → 3×201, 3×409 `OPEN_SESSION_LIMIT`; e2e 409 mesajı. Düşük önemli sınır durumu için bkz. QA-P2-3 |
| AC-12 | ✅ | `sessions.test.ts:79` 21. istek 429 + Retry-After; e2e "10 dakika" gösterimi |
| AC-61 (kısmi) | ✅ | `sessions-lifecycle.test.ts:30` USER yalnız kendi oturumunu görüyor, `technicianId` filtresi kapsamı ezemiyor, başkasının oturumu 404, ADMIN tümünü görüyor; tenant-matrix "list"/"tenant" sınıfı; iptal 404/403 (`:87`); e2e Teknisyen sütunu |
| AC-69 (P2 rotaları) | ✅ | `tenant-matrix.ts:21-26` altı P2 rotasının tümü sınıflı; GET `/:id` ve POST `/:id/cancel` cross-tenant 404 (`tenant-isolation.test.ts:55`) |

## Düzeltilmeli
1. **QA-P2-1 — Orta — [backend-dev]** `apps/server/test/integration/sessions-public.test.ts` (kod: `apps/server/src/sessions/public.ts:51-53, 79, 84`). Resolve'un 410 yolunda yazılan `session.resolve` / `result: "fail"` audit kaydının hiçbir testi yok (grep: testlerde `session.resolve` geçmiyor). Mimari §13 bu kaydı AC-5/7 için şart koşuyor. Beklenen: EXPIRED, CANCELLED ve CONSUMED için 410 sonrası `auditLog` içinde `action="session.resolve", result="fail", newValue.reason=<kod>` kaydı tam 1 tane olmalı; kayıtta token ve kod yazmamalı.
2. **QA-P2-2 — Orta — [backend-dev]** `apps/server/src/sessions/public.ts:97-107`. `GET /public/sessions/status` iki yolu testsiz: (a) süresi dolmuş PENDING'de `{status:"EXPIRED"}` dönüp satırı EXPIRED yapması ve `session.expired` audit'i yazması, (b) 60/dk/ipKey limitinde 61. istekte 429 + `Retry-After` dönmesi. Beklenen: `sessions-public.test.ts`'e bu iki entegrasyon testi eklenmeli.
3. **QA-P2-3 — Düşük — [backend-dev]** `apps/server/src/sessions/repo.ts:45-47` `countOpen`. Süresi dolmuş ama henüz EXPIRED yapılmamış PENDING oturumları da sayıyor. Expiry işi 30 sn'de bir çalıştığı için teknisyen bu aralıkta haksız 409 `OPEN_SESSION_LIMIT` alabilir (AC-11'e göre bu oturumlar açık sayılmamalı). Beklenen: sayım `status=ACTIVE OR (status=PENDING AND expiresAt > now)` olmalı, ya da aynı TX'te önce `expireOne` çalışmalı. Regresyon testi eklenmeli: süresi dolmuş 3 PENDING varken POST 201 dönmeli.
4. **QA-P2-4 — Düşük — [backend-dev]** Gereksiz `export`'lar (proje kuralı: kullanılmayan kod yok). `apps/server/src/sessions/service.ts:14` `HOURLY_CREATE_LIMIT`, `:27` `sessionScope`, `:31` `toView`, `:46` `sessionLink`; `apps/server/src/jobs/scheduler.ts:8` `EXPIRY_INTERVAL_MS`; `apps/server/src/sessions/codes.ts:6` `ACTIVE_CODE_INDEX`. Hepsi yalnız tanımlandığı dosyada kullanılıyor. Beklenen: `export` kaldırılmalı, ya da test bunları kullanıyorsa testte referans verilmeli. `packages/contracts/src/api/sessions.ts` içindeki `CreateSessionInput`, `SESSION_PAGE_SIZE_MAX`, `sessionCodeSchema` sözleşme paketi oldukları için kabul; ama dışarıda kullanılmıyorsa kaldırılmaları değerlendirilsin.
5. **QA-P2-5 — Orta — [frontend-dev]** `apps/web/e2e/sessions.spec.ts`. 5 durumdan ikisi kanıtsız: (a) partial durum, yani yenileme başarısız olunca son verinin korunup `refresh-error` uyarısının çıkması (`sessions-view.tsx:43-46, 91-97`); (b) loading iskeleti (`app/(panel)/sessions/loading.tsx`) ve diyalogdaki `creating` iskeleti (`new-session-dialog.tsx:93-103`). Beklenen: mock API ile ilk liste başarılı, sonraki yenileme 500 olan bir senaryo (satırlar duruyor, `refresh-error` görünür) ve geciktirilmiş POST `/sessions` ile `data-testid="creating"` + `aria-busy` görünürlüğü test edilmeli.
6. **QA-P2-6 — Düşük — [frontend-dev]** `apps/web/app/(panel)/sessions/cancel-dialog.tsx:42-43`. İptal sırasında 401 gelirse (oturum süresi dolmuş) genel hata gösteriliyor, login'e yönlendirme yok. Liste yenilemesi 401'i `/login?reason=expired`'e yönlendiriyor (`sessions-view.tsx:44`), bu tutarsız. `new-session-dialog.tsx:46-49` için de aynı durum geçerli. Beklenen: iki diyalogda da 401 → `router.replace("/login?reason=expired")`.
7. **QA-P2-7 — Düşük — [backend-dev]** `docs/mimari.md:436` (§13 eşleme, mimar onayıyla). AC-4'ün "aralık dışı 400" kısmı fiilen P9/P10'daki `PUT /settings/tenant` ucuna ertelendi (implementation.md Backend sapma 6), ama §13 tablosu AC-4'ü tümüyle P2'de gösteriyor. Beklenen: tabloda "4 (okuma P2; 400 doğrulaması `/settings/tenant` ile P9/P10)" yazmalı ve P9/P10 AC listesine AC-4 (400) eklenmeli. Bu yapılmazsa AC-4 P2'de ⚠️ kalır.
8. **QA-P2-8 — Düşük — [backend-dev]** `apps/server/src/jobs/scheduler.ts:16-36`. Örtüşme koruması (`running`), hatada loglayıp sıradaki turda devam etme ve `stop` davranışı testsiz; yalnız `expireDue` test ediliyor. Beklenen: birim testi (sahte `db` ile çift `runExpiry` → ikinci 0 döner, atılan hata yutulmayıp `log.error`'a gider, `stop` sonrası interval tetiklenmez).

## Definition of Done
| Madde | ✅/❌ | Not |
|---|---|---|
| Lint, tip ve birim testleri yeşil | ✅ | |
| Entegrasyon testleri yeşil (gerçek MySQL) | ✅ | 56/56 |
| e2e yeşil, skip gerekçeli | ✅ | 85 + 1 gerekçeli skip |
| Her P2 AC'si testle kanıtlı | ❌ | AC-4 kısmi, AC-5 audit/yoklama kısmı kanıtsız (QA-P2-1, 2, 7) |
| Sözleşme uyumu (mimari-api) | ✅ | Alanlar, 201/409/410/429 kodları ve hata zarfı uyumlu. Resolve'daki P3 alanlarının yokluğu ve `logoUrl/avatarUrl:null` gerekçeli |
| Tenant izolasyonu (AC-69 matrisi) | ✅ | 6 P2 rotası sınıflı, cross-tenant 404 |
| Yetki: arka uç + UI | ✅ | create/view/delete arka uçta test edildi (403); menü ve düğmeler yetkiye göre gizleniyor (e2e "yetkisiz kullanıcı") |
| Audit (oluştur/iptal/expiry/resolve-fail) | ❌ | created, cancelled ve expired testli; resolve-fail testsiz (QA-P2-1) |
| Transaction / yarış | ✅ | users FOR UPDATE + sayım + INSERT + audit tek TX'te, yarış testli |
| Sayfalı liste | ✅ | `pageSize` ≤100, `total` dönüyor |
| PII/gizli log yok | ✅ | Token ve kod audit'e yazılmıyor (test var); Caddy maskesi devops doğrulamasında |
| 5 durum (loading/empty/error/partial/success) | ❌ | empty, error ve success testli; partial ve loading testsiz (QA-P2-5) |
| a11y (axe açık + koyu), mobil 375 px | ✅ | Liste, diyalog ve müşteri sayfası |
| İkon kuralı (lucide, anlamlı) | ✅ | Oturumlar `MonitorSmartphone`, kopyala `Copy`, iptal `CircleX`, süre `Timer`, uyarı `ShieldAlert` |
| Ham renk/px yok, `any` yok | ✅ | Tarama temiz |
| Kullanılmayan kod/export yok | ❌ | QA-P2-4 |
| Yeni bağımlılık yok / gerekçeli | ✅ | Yeni bağımlılık yok. Sonner yerine kendi toast bileşeni, CSP nonce gerekçesiyle |
| Migration + grants | ✅ | `app` kullanıcısı SELECT/INSERT/UPDATE, DELETE REVOKE; CHECK kısıtları var |
| Sapmalar implementation.md'de gerekçeli | ✅ | Frontend 1–8, Backend 1–8, DevOps notları |

## Öneriler (zorunlu değil)
- AC-5 metni "HTTP 410 döner" diyor. API 410 dönüyor, ama `/session/[token]` sayfası süresi dolmuş ekranı HTTP 200 ile veriyor (404 için gerçek 404 seçilmişti). Tutarlılık için sayfa yanıtı da 410 olabilir. Ekran metni "Bu destek bağlantısının süresi doldu", AC'deki "Bağlantının süresi doldu" ile anlamca aynı.
- `guest-welcome.tsx:15-19` `END` eşlemesinde ACTIVE yok. P3'te başka bir misafir kabul edildiğinde açık karşılama sayfası yoklamaya devam eder; P3'te ele alınmalı.
- Seed'deki kullanılmayan `lib/api.ts` `API_BASE` export'u P1'den kalma; P2 kapsamı dışında, ama temizlenebilir.

## Olumlu
- Oluşturmada kilit + sayım + audit tek TX'te ve yarış testi var (3×201 / 3×409).
- Token DB'de yalnız SHA-256 olarak tutuluyor ve bu, dökümle test edilmiş. `sessionRef` HMAC'li, sahte ref 404 dönüyor.
- K11/S3-1 (kilitli kayıt atılmaz, fail-closed) birim testli.
- AC-8 uçtan uca e2e (panel iptali → müşteri ekranı) ve `--repeat-each=4` ile kararlılık kontrolü yapılmış.
- Sapmaların tümü implementation.md'de belgelenmiş; tenant matrisi sınıfsız uç eklenmesini engelliyor.

---

# P2 QA raporu — Tur 2
DURUM: DÜZELTİLMELİ

Tarih 2026-11-11. Denetçi kod değiştirmedi. Tur 1 bulguları (QA-P2-1..8) ve güvenlik düzeltmeleri (S-P2-1/2/3/6/7, frontend 401 yardımcısı) doğrulandı. Kalan tek bulgu düşük önemli (QA-P2-9). Bu bulgu tur 1'deki QA-P2-4 ile aynı sınıfta olduğu için DoD maddesi ❌ kalıyor.

## Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` | temiz (contracts, web, server) |
| `pnpm -r run typecheck` | temiz |
| `pnpm -r run test` | contracts 2/2, web 20/20 (3 dosya), server unit 22/22 (6 dosya). Kalan 0, skip 0 |
| `test-db.sh up` + `pnpm test:int` (geçici mysql:8.4, 2 migration) | 12 dosya, 61/61 geçti. Konteyner `down` ile silindi |
| `pnpm --filter @remote/web e2e` | 97 geçti, 1 skip, 0 kalan (14,9 sn) |

Skip: `sessions.spec.ts:108` `test.skip(isMobile, "sütun başlıkları masaüstü tablosunda")`. Gerekçeli ve masaüstünde koşuyor. Kabul edildi.

## Tur 1 bulgularının durumu
| Bulgu | Durum | Kanıt |
|---|---|---|
| QA-P2-1 resolve-fail audit | Kapandı | `sessions-public.test.ts:59`. EXPIRED (kod + token yolu), CANCELLED ve CONSUMED için 3 tekrar sonrası tam 1 `session.resolve` satırı var: `result:"fail"`, `newValue.reason` = kod. Dökümde token ve kod yok. Test S-P2-6 tekilleştirmesini de kapsıyor |
| QA-P2-2 yoklama | Kapandı | `:140` süresi dolmuş PENDING → `{status:"EXPIRED"}`; satır EXPIRED/SYSTEM, `activeCode` null, 1 `session.expired` audit. `:152` 61. istek 429 + `Retry-After`, başka IP 200 |
| QA-P2-3 countOpen | Kapandı | `repo.ts:46-49` `ACTIVE OR (PENDING AND expiresAt > now)`. Regresyon testi `sessions.test.ts:79` (3 süresi dolmuş PENDING → 201) |
| QA-P2-4 export'lar | Kapandı | Altı sembolün export'u kaldırıldı (grep doğrulandı) |
| QA-P2-5 loading/partial e2e | Kapandı | `sessions.spec.ts:145` iskelet + `aria-busy`. `:155` diyalogda `creating` + `role=status` metni. `:169` `page.clock` ile yenileme 500 → 4 satır ve "son güncelleme" korunuyor, `refresh-error` görünüyor |
| QA-P2-6 diyalog 401 | Kapandı | `lib/api.ts:26,29` `EXPIRED_LOGIN_PATH` / `isUnauthenticated` tek kaynak. `cancel-dialog.tsx:45`, `new-session-dialog.tsx:49` ve 5 eski kullanım buna geçti. e2e `:184`, `:193` |
| QA-P2-7 AC-4 eşlemesi | Kapandı | `mimari.md:436-437` ikiye bölündü. P9 satırına (`:401`) "4(400 — `/settings/tenant` ilk açıldığı pakette)" eklendi. P2 satırı (`:394`) "1–4(3 rev.)" diyor; §13'teki ayrımla birlikte okununca tutarlı |
| QA-P2-8 scheduler | Kapandı | `test/unit/scheduler.test.ts`: üst üste binmeme (ikinci çağrı 0, db'ye gitmiyor), hata `log.error`'a gidiyor ve yeniden deneniyor, `stop` sonrası tetiklemiyor |

## Düzeltmelerin yan etkileri
- **Yeni env kuralı (EDGE_PROXY_SECRET, SESSION_REF_KEY):** İkisi için de tam. `.env.example:25,31` boş değerli. Doğrulama: server `env.ts:30,37` (production'da zorunlu, ≥32 karakter; unit testli), web `edge-forward.ts:30` `readEdgeSecret` (production'da ≥32 karakter, testli). Compose `:?` ile zorunlu (server:89, caddy:110, web:127). Runbook §1 tablosu (:54-55) ve sorun giderme (:103) yazılı. CI `ci.yml:99-100` sahte değerleri dolduruyor. Playwright `webServer.env` içinde test sırrı var.
- **Regresyon:** Yok. Bütün paketler yeşil. `resolveSessionToken`'ın kullanılmayan XFF parametresi kaldırılmış (`server-api.ts:88`), `@deprecated` artığı kalmamış.
- **Kapsam dışı ekleme:** Yok. Alarm (S-P2-3) mimari §11/G-02 karşılığı, `/metrics` P13'e bırakılmış.
- **Yeni kullanılmayan export:** 1 tane var (QA-P2-9).

## Kabul kriterleri
| AC | Durum | Kanıt |
|---|---|---|
| AC-1, AC-2 | ✅ | `sessions.test.ts:24`, e2e link biçimi |
| AC-3 (rev.) | ✅ | `sessions.test.ts:56`, `sessions-public.test.ts:36,89,100,107,115`, `resolve-alarm.test.ts` |
| AC-4 (okuma, P2) | ✅ | `sessions.test.ts:46`, DB CHECK `ttl_chk` |
| AC-4 (aralık dışı 400) | Ertelendi (P9) | `mimari.md:437` ve P9 satırı `:401`. P2 kapsamında değil |
| AC-5 | ✅ | `sessions-lifecycle` 410/expiry testleri, `sessions-public.test.ts:59` (resolve-fail audit), `:140` (yoklamada expiry), `scheduler.test.ts`, e2e `guest-expired` |
| AC-7 (P2 kısmı) | ✅ | `sessions-public.test.ts:50,59`, e2e `guest-consumed` |
| AC-8 | ✅ | `sessions-lifecycle` iptal testleri, `sessions-public.test.ts:152,163`, e2e uçtan uca iptal |
| AC-9 | ✅ | e2e pano + toast |
| AC-11 | ✅ | `sessions.test.ts:70` (yarış), `:79` (süresi dolmuş PENDING sayılmıyor) |
| AC-12 | ✅ | `sessions.test.ts:86` |
| AC-61 (kısmi) | ✅ | `sessions.test.ts:98`, lifecycle kapsam testleri, e2e yetkisiz kullanıcı |
| AC-69 (P2 rotaları) | ✅ | tenant-matrix ve `tenant-isolation.test.ts` |

## Düzeltilmeli
1. **QA-P2-9 — Düşük — [frontend-dev]** `apps/web/lib/edge-forward.ts:12` `export const EDGE_AUTH_HEADER`. Bu sabit yalnız aynı dosyanın 42. satırında kullanılıyor; test dahil başka hiçbir dosya import etmiyor. QA-P2-4 ile aynı kural ihlali. Beklenen: `export` kaldırılmalı, ya da `edge-forward.test.ts` başlık adını bu sabitten almalı.

## Definition of Done
| Madde | ✅/❌ | Not |
|---|---|---|
| Lint, tip ve birim testleri yeşil | ✅ | 2 + 20 + 22 |
| Entegrasyon (gerçek MySQL) | ✅ | 61/61 |
| e2e yeşil, skip gerekçeli | ✅ | 97 + 1 gerekçeli skip |
| Her P2 AC'si testle kanıtlı | ✅ | AC-4'ün 400 kısmı mimaride P9'a taşındı |
| Sözleşme uyumu | ✅ | Sözleşme değişikliği yok |
| Tenant izolasyonu | ✅ | |
| Yetki: arka uç + UI | ✅ | |
| Audit (oluştur/iptal/expiry/resolve-fail) | ✅ | resolve-fail ve tekilleştirme testli |
| Transaction / yarış | ✅ | |
| Sayfalı liste | ✅ | |
| PII/gizli log yok | ✅ | Alarm logunda IP/kod yok (test `:115`). Sır loglanmıyor (devops tablosu) |
| 5 durum | ✅ | loading, empty, error, partial ve success e2e'de |
| a11y (axe açık + koyu), mobil | ✅ | |
| Ham renk/px yok, `any` yok | ✅ | |
| Kullanılmayan kod/export yok | ❌ | QA-P2-9 |
| Yeni bağımlılık yok / gerekçeli | ✅ | Yeni bağımlılık yok |
| Env kuralı (.env.example + doğrulama + compose + runbook + CI) | ✅ | İki yeni değişken için tam |
| Sapmalar implementation.md'de gerekçeli | ✅ | Düzeltme turu 1 notları |

## Öneriler (zorunlu değil)
- **S-P2-6:** `goneAudit` tablosu dolduğunda (50.000 anahtar) 410 audit'i yazılmıyor ve bu sessizce oluyor. Bunun bir `warn` logu bırakması değerlendirilsin; karar güvenlik ekibinin.
- **Web sır doğrulaması:** Web'deki sır kontrolü açılışta değil ilk resolve isteğinde yapılıyor. Compose `:?` bunu telafi ediyor. Compose dışı bir dağıtımda hata ilk müşteri isteğinde görülür; runbook'ta bu zaten yazılı.
- Tur 1 önerileri geçerli: sayfa 410 yanıtı, `guest-welcome` ACTIVE eşlemesi (P3), `API_BASE` export'u (P1 artığı).

## Olumlu
- Tur 1'in sekiz bulgusunun tamamı testle kapatılmış. Testler gerçekten kriteri doğruluyor: audit satır sayısı, dökümde token/kod yokluğu, DB durumu ve saat taklidiyle partial durum.
- Edge sırrı sabit zamanlı (özet + `timingSafeEqual`) karşılaştırılıyor. Env zinciri beş noktada da eksiksiz.
- 401 mantığı tek yardımcıda toplandı, beş eski kopya temizlendi.

---

# P2 QA raporu — Tur 3
DURUM: GEÇTİ

Tarih 2026-11-11. Denetçi kod değiştirmedi. Bu turda QA-P2-9 ve güvenlik S-P2-T2-1 düzeltmeleri doğrulandı (bkz. `implementation.md` "Düzeltme turu 2").

## Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` | temiz (contracts, web, server) |
| `pnpm -r run typecheck` | temiz |
| `pnpm -r run test` | contracts 2/2, web 20/20 (3 dosya), server unit 26/26 (6 dosya; tur 2'de 22 idi, artan 4 test `cidrMatcher` ve `ClientIpIsProxyAlarm` için). Kalan 0, skip 0 |
| `test-db.sh up` + `test:int` (geçici mysql:8.4, 2 migration) | 12 dosya, 62/62 geçti. Konteyner `down` ile silindi (çıkış 0) |
| `pnpm --filter @remote/web e2e` | 97 geçti, 1 skip, 0 kalan (14,7 sn) |

Skip: yine yalnız `sessions.spec.ts:108` (`isMobile`, sütun başlıkları masaüstü tablosunda). Gerekçesi var ve test masaüstünde koşuyor. Kabul edildi.

## Tur 2 bulgusu ve güvenlik düzeltmeleri
| Konu | Durum | Kanıt |
|---|---|---|
| QA-P2-9 `EDGE_AUTH_HEADER` | Kapandı | `edge-forward.test.ts:2` sabiti import ediyor ve `:9,14,21-23,27` satırlarında başlık anahtarı olarak kullanıyor. Literal `"x-edge-auth"` yalnız tanımda (`edge-forward.ts:12`) kalmış |
| S-P2-T2-1 açılış kontrolü (web) | Doğrulandı | `instrumentation.ts`: yalnız nodejs + production koşulunda dinamik import ile `startup-check.ts` çağrılıyor. `assertEdgeSecretOrExit` → `readEdgeSecret()`, hata olursa sır değeri yazılmadan mesaj basılıp `process.exit(1)`. Açılış davranışını gösteren otomatik bir test yok. Bunun yerine implementation.md'de standalone ile yapılan elle doğrulama yazılı (sır yokken exit=1, 32 karakterlik sırla `/login` 200). Asıl mantık (`readEdgeSecret`) birim testli |
| `server-only` (web) | Doğrulandı | `server-api.ts:1`. Yeni bağımlılık eklenmemiş, Next'in derlenmiş kopyası kullanılıyor (gerekçesi yazılı). Build, Vitest ve e2e yeşil |
| `cidrMatcher` + `ClientIpIsProxyAlarm` (server) | Doğrulandı | `ip.ts:37` için `ip.test.ts:35-52` kapsıyor: IPv4 /31, mapped IPv6, zone id, IPv6 alt ağ, CIDR boşsa false. Alarm için `resolve-alarm.test.ts:30-51`: proxy dışı IP alarm üretmiyor, dakikada en fazla 1 alarm, CIDR boşsa alarm yok. Bağlantılar: `app.ts:95` → `createPublicLimits(..., env.TRUSTED_PROXY_CIDR)` → `public.ts:150` `check(ctx.ip)`. Log satırında IP ve token yok. Throttle zamanlayıcısız (`sweepIntervalMs: 0`), bu yüzden `closePublicLimits` listesinde bulunmaması kaynak sızıntısı yaratmıyor |

## Regresyon / kullanılmayan kod
- Regresyon yok. Bütün paketler yeşil, server entegrasyon testleri 61'den 62'ye çıktı.
- Yeni export'ların hepsi kullanılıyor: `cidrMatcher` (public.ts ve test), `ClientIpIsProxyAlarm` (PublicLimits ve test), `assertEdgeSecretOrExit` (instrumentation), `register` (Next konvansiyonu). Kullanılmayan export veya ölü kod bulunmadı.

## Kabul kriterleri
Tur 2 tablosu aynen geçerli: P2'nin bütün AC'leri ✅. AC-4'ün aralık dışında 400 dönme kısmı mimari gereği P9'a ertelendi. Bu turdaki düzeltmeler AC kapsamını değiştirmiyor.

## Düzeltilmeli
Yok.

## Definition of Done
Tur 2'deki bütün maddeler ✅. Tek ❌ olan "Kullanılmayan kod/export yok" maddesi QA-P2-9 kapandığı için artık ✅. Ek kontrol: yeni bağımlılık yok, env zincirinde değişiklik yok, PII/sır log yok.

## Öneriler (zorunlu değil)
- `startup-check.ts` için `process.exit` taklit edilerek küçük bir birim testi yazılabilir (sır yokken exit(1) çağrılıyor, sır varken çağrılmıyor). Şu an doğrulama yalnız elle yapılmış.
- Tur 2 önerileri geçerliliğini koruyor (goneAudit dolduğunda warn logu, `API_BASE` export'u).

## Olumlu
- Next'in `register()` hatasını yutması fark edilmiş. Gerekçe belgelenmiş ve kalıcı çözüm bulunmuş (exit(1) + edge bundle'ına girmeyen dinamik import).
- Alarm tasarımı yerinde: engelleme yapmıyor, zamanlayıcısız throttle kullanıyor ve log satırında PII yok.
