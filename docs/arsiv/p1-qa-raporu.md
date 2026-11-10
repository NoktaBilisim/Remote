# QA Raporu — Tur 3 (P1)  (Tur 1 ve Tur 2 aşağıda korunmuştur)
DURUM: GEÇTİ

Kapsam: mimari §10.2 P1 AC'leri (64, 65 rev., 75 rev., 86, 90, 69 çatı, 82 sistem logosu, 88 kısmi, 89 health/ready,
94 kısmi, 121, 123, 126), §10.3 P1 "bitti" kanıtı, §10.1 kuralları. Tarih: 2026-11-11. Denetçi kod değiştirmedi.

## Test sonucu
| Komut | Sonuç |
|---|---|
| `apps/server/scripts/test-db.sh up` → migrate + grants | Başarılı (sonunda `down` ile silindi) |
| `pnpm --filter @remote/server test:int` | 8 dosya, **28/28 geçti**, skip 0 |
| `pnpm --filter @remote/server test` (birim) | 4 dosya, **8/8 geçti**, skip 0 |
| `pnpm --filter @remote/contracts test` | **2/2 geçti** |
| `pnpm -r lint` | Temiz (3 paket) |
| `pnpm -r typecheck` | Temiz (3 paket); **not:** `apps/server/prisma/**` tsconfig kapsamı dışında (QA-8) |
| `pnpm --filter @remote/web test` | **7/7 geçti** |
| `pnpm --filter @remote/web e2e` | **32/32 geçti** (desktop + mobile); uyarı: `"next start" does not work with "output: standalone"` (QA-7) |

Toplam 77 test, kırmızı 0, skip 0. `docker compose up -d` (AC-88) QA tarafından yeniden koşulmadı; kanıt devops
entegrasyon tablosu (`docs/implementation.md`, 19 sn, 22/22 grant PASS).

## Kabul kriterleri
| AC | Durum | Kanıt (test adı) veya eksik |
|---|---|---|
| AC-64 | ✅ | `auth-login.test.ts` "AC-64: e-posta veya kullanıcı adıyla giriş; argon2id (m=19456,t=2,p=1)", "aynı 401 mesajı", "pasif kullanıcı/tenant"; contracts `PASSWORD_MIN=12` (`passwordChangeInputSchema`); e2e AC-64 ×3 |
| AC-65 (rev., e-posta P10) | ⚠️ | Testler geçiyor ("5. hatalı denemede 423", "olmayan hesapta da aynı kilit", "20 hatalı → hesap geneli", "21. deneme 429", logout audit). Ancak hesap geneli sayaç kaybolan güncellemeye açık (QA-1) ve hesap geneli kilit hesabın varlığını sızdırıyor (QA-2); paralel/çok-IP senaryosu testi yok |
| AC-75 (rev.) | ✅ | `mask.test.ts` (ticket, TURN credential, kurtarma kodu, çerez, Authorization, SDP/ICE, kabul kodu → `***`; `perm_key` açık), `audit.test.ts` (tüm alanlar, DB'de maske) |
| AC-86 | ✅ | e2e "AC-82, AC-86: login'de sistem logosu ve favicon linkleri"; `public/{favicon.ico,favicon-32x32.png,apple-touch-icon.png}` `scripts/make-icons.mjs` ile `nokta-kucuk.png`'den |
| AC-90 | ✅ | `logs.test.ts` "AC-90: loglar JSON + korelasyon ID; şifre, token, çerez, /session/<token>, sorgu yok", `ops-headers.test.ts` "500'de sızıntı yok", `env-logger.test.ts` maskUrl; Caddy log filtresi + devops log taraması (38 satır, 0 sızıntı) |
| AC-69 (çatı + test aracı) | ✅ | `tenant-isolation.test.ts` ×3 (sınıfsız uç eklenemez, B→A kimlik sızıntısı yok, çapraz 404), `auth-session.test.ts` "Super Admin tenant seçmeden 403"; `test/helpers/tenant-matrix.ts` |
| AC-82 (sistem logosu) | ✅ | e2e AC-82; `(auth)/layout.tsx` `BrandLogo` her zaman |
| AC-88 (kısmi) | ✅ | Kanıt belge düzeyinde (devops temiz ortam: server healthy 19 sn, `/ready` 200). coturn P3'te. QA yeniden koşmadı |
| AC-89 (health/ready) | ✅ | `ops-headers.test.ts` "AC-89: /health 200, /ready DB + son migration 200", "DB yoksa 503"; Caddy `/health|/ready|/metrics` → 404 |
| AC-94 (kısmi) | ✅ | `ci.yml`: quality/test/e2e/build/supply-chain job'ları; tüm `uses:` 40 hane SHA; `permissions: contents: read`; `dependabot.yml`; `pnpm audit --audit-level high`, lisans betiği, gitleaks. Statik inceleme; GitHub'da koşum kanıtı yok (repo push edilmedi) |
| AC-121 | ✅ | `proxy-ip.test.ts` ×3 (sahte XFF, güvenilen proxy zinciri, IPv6 /64), `ip.test.ts`, `env-logger.test.ts` (prod'da `TRUSTED_PROXY_CIDR` zorunlu) |
| AC-123 (kullanıcı ayrımı) | ✅ | `db-grants.test.ts` "app kullanıcısı audit_logs'ta UPDATE, DDL ve tetikleyici işlemi yapamaz"; server konteynerinde `MIGRATE_DATABASE_URL` yok (devops) |
| AC-126 | ✅ | `ops-headers.test.ts` (API), e2e "AC-126 (web): CSP nonce'lu, unsafe-inline yok, X-Powered-By yok"; Caddy `Server`/`Via` siler |

## Düzeltilmeli
1. **QA-1 [backend-dev] Orta** — `apps/server/src/auth/service.ts:38-50` (`recordFailure`): `failedLoginCount` işlem
   dışında okunan `user` nesnesinden `count+1` olarak mutlak değer yazılıyor. Aynı anda gelen N hatalı deneme aynı
   eski değeri okur, sayaç 1 artar → hesap geneli 20/sa kilidi (AC-65, G-23) paralel isteklerle atlatılabilir.
   Beklenen: atomik artış (`UPDATE users SET failed_login_count = failed_login_count + 1 ...` / Prisma `increment`)
   veya TX içinde `SELECT ... FOR UPDATE`; pencere/kilit kararı güncel değerden. Test: 25 eşzamanlı hatalı deneme
   (farklı IP'ler) sonrası `locked_until` dolu olmalı — adında "AC-65".
2. **QA-2 [backend-dev] Orta** — `service.ts:41-56, 70-74`: hesap geneli kilit yalnız var olan hesapta oluşuyor.
   5 IP × 4 deneme (çift kilidi tetiklemeden) sonrası var olan hesap 423, olmayan 401 döner → hesap varlığı sızar
   (mimari §5.1 "yanıt hesabın varlığını sızdırmaz"). Ayrıca kilitli dalda argon2 doğrulaması atlanıyor (zamanlama
   farkı). Beklenen: olmayan hesap için de hesap anahtarlı (bellek, `login` küçük harf) 20/sa sayaç ve aynı 423;
   kilitli dalda da sabit maliyetli doğrulama. Test: "AC-65: olmayan hesapta hesap geneli kilit de aynı (çok IP)".
3. **QA-3 [frontend-dev] Düşük** — `apps/web/proxy.ts:37`: `next=` parametresine `pathname + search` konuyor; sorgu
   dizesi (ileride `ticket`, token vb.) login URL'ine ve tarayıcı geçmişine taşınır. Beklenen: yalnız `pathname`;
   `/session/` ile başlayan yollar hiç `next`'e konmaz. Ek not: `/session/[token]` (P4, müşteri, oturumsuz)
   `PUBLIC_PATHS`'te olmadığından P4'te login'e yönlenecek — P4'te public önek listesine eklenmeli.
   e2e: "korumalı sayfa ... next korunur" testi sorgu dizesinin atıldığını doğrulamalı.
4. **QA-4 [backend-dev] Düşük** — `apps/server/src/lib/errors.ts:57-60` + Fastify JSON ayrıştırıcı: gövdesiz
   `Content-Type: application/json` ile `POST /auth/logout` 400 `VALIDATION` dönüyor (auth/CSRF'ten önce). Web
   etkilenmiyor; Go istemci/3. taraf için kırıcı. Beklenen: boş JSON gövdesi gövdesiz uçlarda (logout) kabul
   edilir (ör. `addContentTypeParser` ile boş gövde → `undefined`) → 204. Entegrasyon testi ekle.
5. **QA-5 [backend-dev] Düşük** — §10.1 kural 3 (kullanılmayan kod): `packages/contracts/src/permissions.ts:23-31`
   `ACTION_LABELS` ve modül `label` alanları (P9 toggle ekranı), `errors.ts:24-33` `errorCodeSchema` /
   `errorEnvelopeSchema` (hiçbir tüketici yok; web `lib/api.ts:76-85` zarfı elle ayrıştırıyor), `isPermissionKey`
   (yalnız testte). Beklenen: ya kaldır (P9'da eklenir) ya da web `api.ts` zarf ayrıştırmasında
   `errorEnvelopeSchema` kullanılsın; kalanlar için gerekçe `implementation.md`'ye.
6. **QA-6 [frontend-dev] Düşük** — `apps/web/proxy.ts:9`: `SESSION_COOKIE = "rs_session"` contracts'taki sabitin
   kopyası (tek kaynak ilkesi). Beklenen: `@remote/contracts/api/auth`'tan import.
7. **QA-7 [frontend-dev] Düşük** — `apps/web/playwright.config.ts:17`: e2e `next start` ile koşuyor; `output:
   "standalone"` ile Next uyarı veriyor ve prod imajı (`node server.js`) test edilmiyor. Beklenen: e2e standalone
   sunucuyu (`.next/standalone/apps/web/server.js` + statik kopya) başlatsın; uyarı 0.
8. **QA-8 [dba] Düşük** — `apps/server/prisma/seed.ts`: strict tip kontrolünden geçmediği için `prisma/**` server
   tsconfig dışında (backend notu). DoD "type temiz" seed için kanıtsız. Beklenen: `ARGON2_OPTIONS` `as const`,
   `prisma/**` tsconfig `include`'a geri; `pnpm -r typecheck` temiz.

## Definition of Done (§10.3 ortak + P1 kanıtı)
| Madde | ✅/❌ | Not |
|---|---|---|
| Paket AC testleri yeşil, adında AC no | ✅ | 77/77; AC-65 içerik eksikleri QA-1/QA-2 |
| Lint / type temiz | ⚠️ | Temiz; seed kapsam dışı (QA-8) |
| qa GEÇTİ | ❌ | Bu rapor: DÜZELTİLMELİ |
| Güvenlik Kritik/Yüksek 0 | — | guvenlik ajanının raporuna bağlı (QA-1/QA-2 güvenliğe de bildirilmeli) |
| test-operatoru 0 hata | — | Düzeltme sonrası adım |
| Migration geri alınabilir + seed güncel | ✅ | `migrations/20261111000000_p1_init/down.sql` var; seed `created`→`exists` (devops) |
| `docs/implementation.md` güncel | ✅ | Backend/Frontend/DevOps + entegrasyon bölümleri, sapmalar gerekçeli |
| `/ready` 200 ≤120 sn (temiz makine) | ✅ | 19 sn (devops kanıtı) |
| Seed Super Admin ile giriş; 5 hatalı → 423 | ✅ | Entegrasyon testi + Caddy üzerinden manuel |
| Audit'te login kayıtları maskeli | ✅ | `audit.test.ts` |
| AC-69 test aracı en az `/auth/me` ile | ✅ | `tenant-isolation.test.ts` |
| Server konteynerinde `MIGRATE_DATABASE_URL` yok | ✅ | devops + CI build job kontrolü |
| Caddy logunda sorgu/subprotocol yok | ✅ | Caddyfile filtre (uri query regexp, Sec-Websocket-Protocol, Location delete) + log taraması |
| Liste dışı bağımlılıklar gerekçeli (§10.1-4) | ✅ | `@prisma/adapter-mariadb`, `tsx`, eslint/typescript araçları, `@tailwindcss/postcss` — implementation.md'de gerekçeli (`@tailwindcss/postcss` tailwind'in parçası, not düşülmesi önerilir) |
| Action SHA sabit, en az permissions, Dependabot | ✅ | `ci.yml`, `dependabot.yml` |

## Öneriler (zorunlu değil)
- `proxy.ts:42` CSP `connect-src` Host başlığından üretiliyor; mimari §5.4 ve server tarafı `PUBLIC_BASE_URL`
  kullanıyor — tutarlılık için web de `PUBLIC_BASE_URL`'den üretebilir.
- `service.ts:35` bilinmeyen hesapta audit `username` olarak denenen giriş dizesi yazılıyor; kullanıcı yanlışlıkla
  şifreyi kullanıcı adı alanına yazarsa audit'e düşer. 190 karakter sınırı var; yaygın kabul, bilinçli karar olarak
  belgelenebilir.
- `@tailwindcss/postcss` ve `@types/*` için implementation.md bağımlılık satırına bir cümle eklenmesi.

## Olumlu
- Ortak altyapı (requireAuth/requirePerm/tenantScope, hata zarfı, audit + iki listeli maske, logger redaksiyonu)
  tek yerde, ince ve mimariyle birebir; katman ihlali, `any`, hata yutma görülmedi; çok yazımlı işlemler TX içinde.
- AC-69 test aracı sınıfsız uç eklenmesini kırmızıya çeviriyor — sonraki paketler için güçlü bir emniyet.
- Login'de kullanıcı yoksa da argon2 doğrulaması, `safeEqual` ile CSRF karşılaştırması, katı Origin kontrolü.
- Web: 5 durum (boş/yükleniyor/hata/ağ hatası/başarı), axe açık+koyu temiz, ikonlar lucide ve anlamlı, `style`
  prop yok, `next/image` CSP gerekçesiyle bilinçli olarak dışarıda.
- Devops entegrasyonu Caddy `Location` sızıntısını kendisi bulup kapatmış; konteyner sertleştirmesi iyi.

---

# Tur 2 (P1, düzeltme turu 1 sonrası) — 2026-11-11
DURUM: DÜZELTİLMELİ (tek sebep: web birim testi kırmızı + belge güncelliği; geri kalan her şey yeşil)

## Test sonucu (QA kendisi koştu)
| Komut | Sonuç |
|---|---|
| `test-db.sh up` → server `vitest run` (unit + integration) | 13 dosya, **45/45 geçti**, skip 0 (`auth-fix1.test.ts` dahil); `down` ile silindi |
| `pnpm --filter @remote/contracts test` | **2/2** |
| `pnpm -r lint` / `pnpm -r typecheck` | Temiz / temiz (`prisma/**/*.ts` artık tsconfig'te) |
| `pnpm audit --audit-level high` | "No known vulnerabilities found" |
| `pnpm --filter @remote/web e2e` (yeni `__Host-` çerez adlarıyla, standalone sunucu) | **36/36 geçti**, `next start` uyarısı yok |
| `pnpm --filter @remote/web test` | **1 KIRMIZI / 6 geçti** — 3 koşuda aynı (aşağıda QA-9) |

## Tur 1 bulgularının doğrulaması
| ID | Durum | Kanıt |
|---|---|---|
| QA-1 | Kapandı | `auth/repo.ts:40-53` `bumpAccountFailures`: tek UPDATE ile atomik `IF(pencere, +1, 1)` + `FOR UPDATE` okuma, eşikte `locked_until`; test "AC-65: farklı IP'lerden 25 paralel hatalı deneme → hesap geneli kilit (atomik sayaç)" yeşil |
| QA-2 | Kapandı | `service.ts:36,49,62` olmayan hesap için `ghostAccount` 20/sa sayaç; kilitli dalda da `verifyPassword`; test "AC-65: hesap geneli kilit var olan ve olmayan hesapta aynı (durum + gövde), çok IP" yeşil |
| QA-3 | Kapandı | `proxy.ts:39-43` `next=` yalnız pathname, `/session/` asla; `/session/` public önek; e2e yeşil |
| QA-4 | Kapandı | `app.ts:90-95` boş JSON gövde → `undefined`, dolu gövde varsayılan (prototip korumalı) ayrıştırıcı; test "AC-65: gövdesiz application/json logout 204" yeşil |
| QA-5 | Kapandı | `ACTION_LABELS`, `label`, `errorCodeSchema`/`errorEnvelopeSchema`, `isPermissionKey` kodda yok (grep 0) |
| QA-6 | Kapandı | `proxy.ts:1`, `e2e/auth.spec.ts:3`, `e2e/mock-api.mjs:5` sabitleri contracts'tan alıyor |
| QA-7 | Kapandı | Playwright standalone `server.js` ile; uyarı yok |
| QA-8 | Kapandı | `seed.ts:12` `as const`; `apps/server/tsconfig.json:17` `prisma/**/*.ts`; typecheck temiz |

Ek güvenlik düzeltmeleri (S1-3/6/7/8/10) için testler yeşil: şifre değişiminde diğer oturumların iptali, oturum başına
5 hatalı mevcut şifre → 401, 10 paralel aynı hesap+IP → tam 5 doğrulama, `@` girdisinde yalnız e-posta araması,
yeni girişte eski oturumun iptali. Yeni bağımlılık yok.

## Kabul kriterleri (Tur 2)
| AC | Durum | Not |
|---|---|---|
| AC-65 | ✅ | QA-1/QA-2 kapandı; eşzamanlılık ve varlık sızmazlık testleri yeşil |
| AC-64, 75, 86, 90, 69, 82, 88 (kısmi), 89, 94 (kısmi), 121, 123, 126 | ✅ | Tur 1 kanıtları geçerli, testler yeniden koşuldu ve yeşil |

AC'lerin hepsi ✅. Ancak paket "bitti" tanımı "lint/type/test temiz" der ve bir test kırmızı.

## Düzeltilmeli (Tur 2)
1. **QA-9 [frontend-dev] Yüksek (DoD engeli)** — `apps/web/lib/api.test.ts:8-20, 45-46`: test eski çerez adı `rs_csrf`
   ile yazılmış; `lib/api.ts` artık `CSRF_COOKIE = "__Host-rs_csrf"` okuyor → "POST isteğinde rs_csrf çerezini
   X-CSRF-Token başlığına yazar" testi `undefined !== "tok=1"` ile kırmızı. İmplementation.md'deki "Vitest 7/7"
   ifadesi bu haliyle doğru değil. Beklenen: test çerez adını `CSRF_COOKIE` sabitinden alsın (ad sabit metin olarak
   yazılmasın), `lib/api.ts:3` yorumundaki ad güncellensin; `pnpm --filter @remote/web test` 7/7.
2. **QA-10 [backend-dev] Düşük (DoD: belge güncel)** — `docs/implementation.md` Backend bölümü satır 70 ve 78 hâlâ
   `rs_session`/`rs_csrf`; "Sapmalar" altındaki "dba bulgusu: seed tsconfig dışında" maddesi artık geçersiz; "Testler"
   satırı 36 test diyor (güncel 45). Beklenen: `__Host-` adları, 45 test, seed notu kapandı olarak işaretlensin.
3. **QA-11 [frontend-dev] Düşük** — `docs/implementation.md` Frontend bölümü satır 13 ve 42'de eski çerez adları.
   Beklenen: `__Host-rs_session` / `__Host-rs_csrf`.
4. **QA-12 [devops] Düşük** — Entegrasyon doğrulaması (`implementation.md` 163, 172) eski çerez adlarıyla yapılmış.
   `__Host-` öneki Caddy üzerinden (https://…:4450, `tls internal`) tarayıcıda kabul edilmeli; ad değişikliğinden
   sonra uçtan uca giriş/çıkış bir kez yeniden doğrulanıp tablo güncellenmeli. Caddy log filtresi ad bağımsız
   (`Cookie`/`Set-Cookie` başlık bazında siliniyor) → filtre değişikliği gerekmez.

Not (mimar, bulgu değil): `docs/mimari-api.md:6-7` çerez adları `rs_session`/`rs_csrf`; S1-9 kararı mimari-api'ye
işlenmeli.

## Yeni sorun / gereksiz kod taraması
- Düzeltmelerde gereksiz/spekülatif kod görülmedi; kaldırılan exportlar kodda geri yok.
- `ghostAccount` bellek sayacı denenen giriş dizesiyle anahtarlanıyor; büyüme IP başına 20/dk limitiyle ve
  `FixedWindowCounter` 10.000 kayıtta süpürmeyle sınırlı — kabul edilebilir.
- `bumpAccountFailures` UPDATE'i satırı zaten kilitliyor; sonraki `FOR UPDATE` okuma gereksiz ama zararsız.

## Definition of Done (Tur 2)
| Madde | ✅/❌ | Not |
|---|---|---|
| AC testleri yeşil (adında AC no) | ✅ | server 45, contracts 2, e2e 36 |
| Lint / type / tüm testler temiz | ❌ | Web birim 1 kırmızı (QA-9) |
| `pnpm audit` high 0 | ✅ | |
| `docs/implementation.md` güncel | ❌ | QA-10, QA-11, QA-12 |
| Migration geri alınabilir + seed güncel, tipli | ✅ | QA-8 kapandı |
| qa GEÇTİ | ❌ | QA-9..12 düzeltilince Tur 3 kısa doğrulama yeter (yalnız web test + belge) |
| Güvenlik Kritik/Yüksek 0, test-operatoru | — | İlgili ajanlara bağlı |

---

# Tur 3 (P1, düzeltme turu 2 sonrası, son tur) — 2026-11-11
DURUM: GEÇTİ

## Test sonucu (QA kendisi koştu)
| Komut | Sonuç |
|---|---|
| `test-db.sh up` → server `vitest run` (unit + integration) | 13 dosya, **48/48**, skip 0; konteyner `down` ile silindi |
| `pnpm --filter @remote/contracts test` | **2/2** |
| `pnpm --filter @remote/web test` | **7/7** (QA-9 kapandı) |
| `pnpm --filter @remote/web e2e` | **36/36** (`__Host-` çerezleri, standalone sunucu) |
| `pnpm -r lint` / `pnpm -r typecheck` | Temiz / temiz |
| `pnpm audit --audit-level high` | Açık yok |

Toplam 93 test, kırmızı 0, skip 0.

## Tur 2 bulgularının doğrulaması
| ID | Durum | Kanıt |
|---|---|---|
| QA-9 | Kapandı | `lib/api.test.ts` çerez adını `CSRF_COOKIE`'den alıyor; web birim 7/7 |
| QA-10 | Kapandı | `implementation.md` Backend: `__Host-` adları, 48 test, seed notu güncel |
| QA-11 | Kapandı | `implementation.md` Frontend: eski `rs_session`/`rs_csrf` adı kalmadı (grep 0) |
| QA-12 | Kapandı | DevOps entegrasyon tablosu `__Host-` çerezleriyle Caddy üzerinden yeniden doğrulanmış (belge kanıtı; QA compose'u yeniden koşmadı) |

## Düzeltme turu 2 değişikliklerinin incelemesi
- **S2-1 `lib/rate.ts`:** üst sınırlı Map + `unref`'li 30 sn `prune` zamanlayıcısı, `onClose`'ta durdurma; anahtarlar
  `sha256(login)`. Birim testleri (boyut sabit, `prune` etkin kilidi korur) yeşil. Kabul edilen kalan risk
  implementation.md'de gerekçeli.
- **S2-2:** şifre değişiminde tüm oturumlar iptal + yeni `__Host-` çerez çifti. `lib/api.ts` CSRF'i her istekte
  çerezden okuduğu için web tarafında ek iş gerekmiyor; e2e AC-66 akışı yeşil.
- **S2-3:** `FOR UPDATE` kaldırıldı (Tur 2 notu), tek UPDATE; 25 paralel testi yeşil.
- **Regresyon:** görülmedi. Bütün AC testleri ve önceki düzeltme testleri yeşil.

## Gereksiz kod sorusu (koordinatörün sorusu)
- **`axeScan()` (e2e/auth.spec.ts:24):** 2 testte kullanılıyor (login açık/koyu döngüsü + panel). Kararlılık
  önlemlerini (fare, font, iki kare) tek yerde topluyor. Gerekli; bulgu değil.
- **`MOCK_ME_DELAY_MS` (e2e/mock-api.mjs:75-76):** CI'da ya da config'te ayarlanmıyor; yalnız kararsızlığı elle
  yeniden üretmek için 2 satırlık bir test aracı düğmesi, yorumu ve implementation.md'de kullanımı yazılı. Üretim
  kodu değil, varsayılanı 0 (etkisiz). Bulgu sayılmadı. Öneri: kalıcı değeri yoksa P2'de kaldırılabilir, ya da
  yavaş API durumunu sınayan bir e2e senaryosunda kullanılırsa kalıcı gerekçe kazanır.

## Kabul kriterleri (Tur 3)
AC-64, 65, 75, 86, 90, 69 (çatı), 82 (sistem logosu), 88 (kısmi), 89 (health/ready), 94 (kısmi), 121, 123, 126: **hepsi ✅**.
Testler yeniden koşuldu ve yeşil; Tur 1/Tur 2 kanıtları geçerli.

## Definition of Done (Tur 3)
| Madde | ✅/❌ | Not |
|---|---|---|
| AC testleri yeşil (adında AC no) | ✅ | |
| Lint / type / tüm testler temiz | ✅ | 93/93 |
| `pnpm audit` high 0 | ✅ | |
| `docs/implementation.md` güncel | ✅ | |
| Migration geri alınabilir + seed güncel, tipli | ✅ | |
| qa GEÇTİ | ✅ | Bu tur |
| Güvenlik Kritik/Yüksek 0 | — | guvenlik raporuna bağlı (QA kapsamı dışı) |
| test-operatoru 0 hata | — | Sıradaki adım |

Açık QA bulgusu yok. Mimar notu (bulgu değil, Tur 2'den): `docs/mimari-api.md:6-7` çerez adları `__Host-` ile
güncellenmeli.
