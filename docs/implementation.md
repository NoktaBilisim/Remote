# Implementation notları

## Frontend (P1) — Rotalar
Yazan: frontend-dev · Paket P1 · Uygulama `apps/web` (Next.js 16 App Router, TS strict, Tailwind 4, zod, lucide-react).

### Rotalar
| Yol | Auth | Ne yapar |
|---|---|---|
| `/login` | Hayır | Sistem logosu (AC-82) + giriş formu (AC-64). Durumlar: alan hatası, 401 genel hata, 423 kilit, 429, 5xx (+ hata kodu), ağ hatası, gönderimde disabled. `?next=` (yalnız uygulama içi yol), `?reason=expired|logout` bilgi mesajı |
| `/change-password` | Evet (çerez) | Şifre değişimi (AC-66); `mustChangePassword` iken panel yerine buraya yönlendirilir. Yanlış mevcut şifre → alan hatası; 401 → login |
| `/` | Evet | Panel kabuğu (üst menü: logo, kullanıcı adı/rol/firma, çıkış; kenar çubuğu: Ana sayfa) + boş durum |
| diğer | — | `not-found` (404), `error` (500 + Tekrar dene), panel `loading` iskeleti |
Oturum çerezi (`__Host-rs_session`, adı `@remote/contracts` `SESSION_COOKIE`) yoksa `proxy.ts` korumalı her yolu `/login?next=…`'e yönlendirir; çerez geçersizse panel layout'u (`GET /auth/me`, sunucu tarafı) `/login?reason=expired`'e yönlendirir.

### Dosyalar
`apps/web/{package.json, next.config.ts, tsconfig.json, eslint.config.mjs, postcss.config.mjs, vitest.config.ts, playwright.config.ts, proxy.ts}`,
`app/{layout.tsx, globals.css, error.tsx, not-found.tsx}`, `app/(auth)/{layout.tsx, login/{page,login-form}.tsx, change-password/{page,change-password-form}.tsx}`,
`app/(panel)/{layout.tsx, page.tsx, loading.tsx, side-nav.tsx, logout-button.tsx}`, `components/{brand-logo,breadcrumb,form-error,load-error}.tsx`, `components/ui/{button,alert,text-field}.tsx`,
`lib/{api.ts (+test), server-api.ts, auth-schema.ts (contracts sarmalayıcı), error-message.ts, i18n.ts}`, `messages/tr.json`, `public/{favicon.ico, favicon-32x32.png, apple-touch-icon.png, img/logo.png, img/nokta-kucuk.png}`,
`scripts/make-icons.mjs`, `e2e/{auth.spec.ts, mock-api.mjs}`; kökte `DESIGN.md`, `.gitignore` (web derleme/test çıktıları eklendi).

### Testler
- `pnpm --filter @remote/web test` (Vitest, **7/7**: CSRF başlığı (`CSRF_COOKIE` contracts'tan), hata zarfı, 423/Retry-After, ağ hatası, açık yönlendirme) — yeşil.
- `pnpm --filter @remote/web e2e` (Playwright; üretim derlemesi + `e2e/mock-api.mjs`; masaüstü + mobil Pixel 7): 18 senaryo × 2 = **36/36 yeşil** (ilk teslimde 16 × 2 = 32). Kapsam: AC-64 başarılı/hatalı/boş form, AC-65 423 + çıkış (CSRF'siz çıkışı mock 403 ile reddeder), 500 hata kodu, AC-66 zorunlu şifre değişimi + yanlış mevcut şifre, korumalı sayfa yönlendirmesi, geçersiz çerez, API erişilemez hata durumu, AC-82/86 logo + favicon, AC-126 (web) başlıklar, axe (WCAG 2.1 AA) login açık+koyu, panel koyu + yatay taşma yok; her testte konsol hatası/uyarısı 0.
- `pnpm --filter @remote/web lint` ve `typecheck` temiz.

### Sapmalar / kararlar
- **`middleware.ts` → `proxy.ts`:** Next 16'da middleware'in adı `proxy`'dir (eski ad deprecation uyarısı verir). Görev aynı: CSP nonce + oturum ön elemesi.
- **CSP (mimari §5.4):** web sayfaları için `proxy.ts` üretir. `upgrade-insecure-requests` yalnız HTTPS'te (`X-Forwarded-Proto: https`, Caddy) eklenir; düz http yerel/e2e'de istekleri kırıyordu. Dev modunda `'unsafe-eval'` + `ws:` (yalnız `next dev`).
- **`next/image` kullanılmadı:** satır içi `style` üretir (CSP ihlali); logolar sabit boyutlu `<img>`.
- **Sonner P1'de eklenmedi:** P1'de toast gerektiren akış yok (başarıda yönlendirme); ayrıca Sonner `<style>` enjekte eder — P2'de nonce ile eklenmeli.
- **E2E mock:** Panel `/auth/me`'yi sunucuda çağırdığı için Playwright route mock'u yetmez; küçük bir sahte HTTP API (`e2e/mock-api.mjs`) ve `next.config.ts` rewrite'ı (`/api/*` → `API_INTERNAL_URL`) kullanıldı. Rewrite yalnız Caddy'siz yerel/e2e içindir; prod'da `/api` Caddy'de server'a gider. Not: Next rewrite'ları derleme anında sabitlenir.
- **Kaydedilmemiş değişiklik uyarısı:** şifre formunda yok (değişiklik saklanmaz; ilk girişte sayfadan çıkış zaten yönlendirmeyle engellenir).
- **Tema:** P1'de yalnız sistem teması (`prefers-color-scheme`); kullanıcı tercihi + flaşsız açılış P12.
- **Kontrat tipleri:** `@remote/contracts` (`workspace:*`, `transpilePackages`) — `loginInputSchema`, `passwordChangeInputSchema`, `LoginResponse`, `MeResponse`, `CSRF_COOKIE`/`CSRF_HEADER`. `lib/auth-schema.ts` yalnız zod hatalarını Türkçe alan mesajına çevirir + "şifre tekrar" kontrolü (arayüze özgü). `tsconfig` `allowImportingTsExtensions` (contracts `.ts` uzantılı import kullanıyor).
- **Docker:** `next.config.ts` → `output: "standalone"`, `outputFileTracingRoot` = repo kökü. `docker build -f apps/web/Dockerfile .` başarılı; imaj `node apps/web/server.js` ile açılıyor (`/login` 200, `/` → `/login` 307, CSP başlığı var, `X-Powered-By` yok). Çalışma anı env: `API_INTERNAL_URL`, `PUBLIC_BASE_URL`; `NEXT_PUBLIC_*` yok.
- **Origin:** e2e sahte API, backend gibi durum değiştiren isteklerde `Origin` allowlist kontrolü yapar (`MOCK_ALLOWED_ORIGIN`, varsayılan `http://localhost:3217`); tarayıcı same-origin fetch'te Origin'i gönderir, Next rewrite iletir.
- Yeni bağımlılıklar yalnız §10.4 listesinden (`next`, `react`, `tailwindcss`, `zod`, `lucide-react`, `@playwright/test`, `@axe-core/playwright`, `vitest`) + araç: `sharp` (dev; favicon üretimi, §10.4 server listesinde onaylı), `eslint`/`eslint-config-next`, `typescript` 5.9 (TS 7 Next ile henüz doğrulanmadı).
- Tasarım skill'i `ui-ux-pro-max` okundu; önerdiği indigo palet "jenerik AI görünümü" kuralı gereği alınmadı, Nokta logosu mavisi esas alındı (DESIGN.md).

### backend-dev'den beklenenler (entegrasyon)
1. `POST /auth/login` başarıda `__Host-rs_session` (HttpOnly) **ve `__Host-rs_csrf` (HttpOnly OLMAYAN, Secure, SameSite=Strict, Path=/, Domain yok)** çerezlerini set etmeli; web `__Host-rs_csrf`'i okuyup `X-CSRF-Token`'a yazar. Adlar yalnız contracts sabitlerinden.
2. `user` nesnesi: `{ id, email, fullName, role: "SUPER_ADMIN"|"ADMIN"|"USER", mustChangePassword: boolean }` — `GET /auth/me` içinde **`user.mustChangePassword` zorunlu** (panel yönlendirmesi buna bakar). `tenant: { id, name } | null`.
3. `POST /auth/password/change`: yanlış mevcut şifre → **400 `VALIDATION` + `fields.current`** (401 yalnız oturum yok/düşmüş anlamında kullanılmalı; web 401'de login'e yönlendirir). Başarıda `mustChangePassword=false` olmalı (sonraki `/auth/me`).
4. 423 `ACCOUNT_LOCKED` ve 429 yanıtlarında `error.message` Türkçe, varlık sızdırmayan metin; varsa `Retry-After`.
5. `POST /auth/logout` CSRF ister, 204 döner ve iki çerezi temizler.
6. Hata zarfında `requestId` (web kullanıcıya "Hata kodu" olarak gösterir).

### devops'tan beklenenler
- Web konteyneri: `API_INTERNAL_URL=http://server:3001`; `pnpm --filter @remote/web build && start` (port 3000). Caddy `X-Forwarded-Proto` iletmeli (CSP `upgrade-insecure-requests` buna bağlı); `Server` başlığı Caddy'de silinir. CI: `lint`, `typecheck`, `test`, `e2e` (Playwright chromium kurulumu gerekir).

### Düzeltme turu 1 (qa-raporu QA-3/6/7, güvenlik S1-1/S1-4/S1-9)
- **S1-1 (Orta):** `lib/api.ts` `safeNext(next, origin)` — kontrol karakterleri (ham ve `%09/%0a/%0d` kodlu), ters bölü ve `//` içeren değerler reddedilir; son karar `new URL(next, origin)` origin karşılaştırması. Birim testi: `%2F%09%2Fevil.example`, `/%0a/evil`, `//evil`, `/\evil`, `https://evil`, `/%2F/evil` → `/`; `/x?y` geçerli. E2E: `?next=%2F%09%2Fevil.example` ile girişte `/`'e gider.
- **QA-3 / S1-4:** `proxy.ts` `next=`'e yalnız pathname yazar (sorgu yok); `/session/` yolları asla `next`'e yazılmaz. `PUBLIC_PATHS` önek eşleşmesi (`/login`, `/session/`); `/session/*` oturumsuz açılır (P4'e kadar 404). E2E ile doğrulandı.
- **QA-6 / S1-9:** `SESSION_COOKIE`, `CSRF_COOKIE`, `CSRF_HEADER` yalnız `@remote/contracts/api/auth`'tan (proxy, `lib/api.ts`, e2e spec ve `e2e/mock-api.mjs` — mock, Node 24 tür ayıklamayla contracts `.ts` dosyasını doğrudan import eder). Mock çerezleri `Secure` (`__Host-` önekine hazır; Chromium localhost'u güvenli bağlam sayar).
- **QA-7:** Playwright webServer üretim imajı yolunu kullanır: `next build` → `.next/static` ve `public` standalone'a kopyalanır → `node .next/standalone/apps/web/server.js`. `next start` uyarısı kalktı.
- Sonuç: lint, typecheck temiz; Vitest 7/7; Playwright **36/36** (18 senaryo × masaüstü+mobil).
- **Düzeltme turu 2 (QA-9, QA-11):** `lib/api.test.ts` çerez adını contracts `CSRF_COOKIE`'dan alır (eski `rs_csrf` kalmadı); `lib/api.ts` yorumu güncellendi; bu bölümdeki çerez adları `__Host-` ile, test sayıları gerçek değerle yazıldı. Sonuç: lint/typecheck temiz, Vitest 7/7, Playwright 36/36.
- **Kararsız test incelemesi (mobil/masaüstü "panel koyu tema + axe"):** Kök neden yakalandı: ihlal `document-title: html`. Girişten sonra panele istemci tarafında geçilir (`router.replace`); Next 16 metadata'yı içerikten sonra akıttığı için `<title>` birkaç ms yoktur ve axe tam o an tararsa düşer. Test yalnız `toHaveURL("/")` bekliyordu. Yeniden üretme: `--repeat-each=10 -g "erişilebilirlik" --workers=10` ile ~180 koşuda 1 düşüş (masaüstünde de). Düzeltme (testte, uygulama davranışı değil — kullanıcı açısından başlık ms içinde gelir, AC-“sayfa başlığı” sağlanır): tarama öncesi `toHaveTitle(/Ana sayfa/)`, `empty-state` görünür ve "Çıkış yap" etkin beklenir. Ek kararlılık önlemleri (ortak `axeScan()`): `reducedMotion: "reduce"` (geçiş/pulse ara renkleri yok), `mouse.move(0,0)` (tıklamadan kalan `:hover`), `document.fonts.ready` + iki kare; ihlal mesajı düğüm seçicilerini içerir. Retry eklenmedi. Düzeltme sonrası: axe testleri `--repeat-each=10 --workers=10` × 8 tur = **480/480**, `--repeat-each=10 -g "koyu tema"` 20/20, `/auth/me` 600 ms gecikmeyle (`MOCK_ME_DELAY_MS`) 20/20, tam paket 36/36.

- **Sayfa testi düzeltmeleri (docs/test-raporu.md):** T-1 — 423'te süre `Retry-After`'dan yukarı yuvarlanmış dakika olarak `login.error.locked` metniyle gösterilir (başlık yoksa `login.error.lockedNoTime`); `t()` artık `{değişken}` yer tutucusu alır; e2e 423 senaryosu "15 dakika" metnini doğrular (mock `Retry-After: 878`). T-3 — oturum çereziyle `/login` açılırsa login sayfası sunucuda `GET /auth/me` sorar: 200 → `/` (veya `/change-password`), 401/hata → form gösterilir (döngü yok). Bu kontrol `proxy.ts` yerine sayfada, çünkü çerezin geçerliliği yalnız `/auth/me` ile bilinir; proxy'de her istekte API çağrısı yapılmaz. 2 yeni e2e. T-2 (panelden şifre değiştirme bağlantısı + "Panele dön") P12 profil/avatar menüsüyle gelecek; T-4 (beklenen 4xx'in tarayıcı "Failed to load resource" kaydı) ve T-5 (oturumsuz bilinmeyen yolda login, 404 değil — yol varlığı sızdırılmaz) tasarım gereği. Sonuç: lint/typecheck temiz, Vitest 7/7, Playwright 40/40 (20 senaryo × 2).

## Frontend (P2) — Rotalar
Yazan: frontend-dev · Paket P2 · AC (UI kısmı): 1, 3 (rev.; `4829 1376` gösterimi), 4 (TTL okuma), 5, 7 (410 CONSUMED ekranı), 8, 9, 11, 12, 61 (kısmi). Hedef görünüm: `docs/tasarim/01-oturumlar.html`, `02-musteri-karsilama.html` (P2 kısmı).

### Rotalar
| Yol | Auth | Ne yapar |
|---|---|---|
| `/sessions` | Evet (`sessions.view`) | Oturum listesi: durum rozetleri, kod, oluşturma saati, PENDING için kalan süre geri sayımı; Segmented filtre Tümü/Açık/Bitmiş (sayılı); 10 sn'de bir yenileme (sekme gizliyken yok) + "Son güncelleme"; boş / filtre-boş / iskelet (`loading.tsx`) / hata (Tekrar dene) / yenileme başarısız (uyarı, son veri korunur) / yetkisiz (uyarı). ≥ md tablo, dar ekranda kart. Satırda "kodu kopyala" + "iptal et" (onay diyaloğu, odak "Vazgeç"te; `sessions.delete`). ADMIN/SUPER_ADMIN'de Teknisyen sütunu. |
| `/sessions` → "Yeni destek oturumu" diyaloğu | Evet (`sessions.create`) | Açılınca `POST /sessions`: iskelet → link (salt okunur, "sonradan tekrar görüntülenemez" notu), oturum kodu `CodeDisplay`, teknisyen doğrulama kodu, Kopyala düğmeleri (toast "Kopyalandı"), geçerlilik geri sayımı + bitiş saati (Europe/Istanbul), "Oturumu iptal et" (onaylı), Kapat. 409 `OPEN_SESSION_LIMIT` → uyarı + sunucu mesajı + "listeden iptal ederek yer açın"; 429 → `Retry-After` dakikası; diğer → hata + Tekrar dene. Süre dolunca / iptalde kopyalama pasif + bilgi. |
| `/session/[token]` | Hayır | Müşteri karşılama (P2 kısmı). Resolve **sunucuda** (`lib/server-api.ts resolveSessionToken`, `Origin` = `PUBLIC_BASE_URL` origin'i, gövde `{token, clientKind:"BROWSER"}`); başarıda başlık + teknisyen kartı (Avatar baş harf, ad, "Teknisyen · firma", doğrulama kodu) → dolandırıcılık uyarısı (`ShieldAlert`) → "Bağlantı adımları hazırlanıyor" yer tutucu + kalan süre. İstemci yalnız opak `sessionRef` ile 2 sn'de bir `GET /public/sessions/status` yoklar: CANCELLED → "Oturum iptal edildi", EXPIRED (veya yerel süre bitti) → "süresi doldu", ENDED → "sona erdi", 404 → geçersiz; 429'da `Retry-After` kadar bekler. 410 SESSION_EXPIRED/CANCELLED/CONSUMED → ilgili ekran, 429 → "Çok fazla deneme", 5xx/ağ → hata + Tekrar dene. Biçimsiz token (API'ye sorulmaz) ve 404 → **HTTP 404** + müşteri `not-found.tsx` ekranı. `<meta name="referrer" content="no-referrer">` + `robots noindex,nofollow,nocache`; proxy zaten `Referrer-Policy: no-referrer` verir ve `/session/` yolunu `next=`'e yazmaz. Tema: sistem. |

### Dosyalar
- Yeni: `app/(panel)/sessions/{page,loading,sessions-view,session-list,new-session-dialog,created-session,cancel-dialog}.tsx`, `app/session/{guest-ui,retry-button}.tsx`, `app/session/[token]/{page,not-found,guest-welcome}.tsx`, `components/ui/{badge,dialog,code-display,empty-state,skeleton,segmented,avatar,toast}.tsx`, `lib/{format.ts (+format.test.ts), use-now.ts}`, `e2e/{helpers.ts, sessions.spec.ts, guest.spec.ts, mock-sessions.mjs}`.
- Değişen: `app/(panel)/layout.tsx` (ToastProvider, yetkiler kenar çubuğuna), `app/(panel)/side-nav.tsx` ("Oturumlar" `MonitorSmartphone`, yalnız `sessions.view` ile), `lib/server-api.ts` (`getMe` React `cache` ile istek başına tek; `serverGet`, `resolveSessionToken`), `messages/tr.json`, `e2e/mock-api.mjs` (oturum uçları + `u-*` yalıtılmış test kullanıcıları), `e2e/auth.spec.ts` (S1-4: `/session/<biçimsiz>` artık müşteri 404 ekranı), `playwright.config.ts` (`PUBLIC_BASE_URL`), kökte `DESIGN.md` (§6 P2 bileşenleri, `Link2Off`).

### Testler (2026-11-11)
- `pnpm --filter @remote/web lint` · `typecheck` temiz.
- Vitest **12/12** (yeni `lib/format.test.ts` 5: kod 4+4, geri sayım yuvarlama/negatif/saat, Europe/Istanbul, Retry-After dakikası, Türkçe baş harf).
- Playwright **85 geçti, 1 atlandı** (43 senaryo × masaüstü+Pixel 7; AC-61 sütun testi yalnız masaüstü). Yeni senaryolar: AC-1/3/9 boş liste → diyalog (link biçimi, `#### ####` kod, doğrulama kodu, not, geçerlilik, e-posta/konsol düğmesi yok) + pano içeriği + toast; AC-8 diyalogdan iptal (onay odağı Vazgeç) ve satırdan iptal (Vazgeç değiştirmez); filtre sayıları; AC-11 409; AC-12 429 "10 dakika"; yetkisiz menü/sayfa; liste hata durumu; AC-61 teknisyen sütunu; axe açık+koyu (liste + açık diyalog); 375 px taşma yok (liste + diyalog); müşteri: geçerli karşılama + meta referrer/noindex, 410 süresi doldu/iptal/kullanıldı, 404 (HTTP 404), 429, biçimsiz token 404, **AC-8 uçtan uca**: panelde oluştur → linki ikinci sekmede aç → panelden iptal → müşteri sayfası ≤5 sn'de "Oturum iptal edildi"; axe açık+koyu; 375 px. Kararlılık: yeni iki dosya `--repeat-each=4` → 180/180. Her testte konsol hatası/uyarısı 0.

### Taslaktan sapmalar (gerekçeli)
1. **Liste sütunları:** Müşteri, Bağlantı (Hızlı Destek/Tarayıcı), aktif oturum süresi, "Kabul et / Konsola git / Konsolu aç / Ayrıntı", lobi şeridi ve arama kutusu yok — `SessionView`'da müşteri/bağlantı alanı yok, bunlar P3/P4/P8. Teknisyen sütunu yalnız yönetici görünümünde (AC-61).
2. **Filtre istemci tarafında:** API tek `status` alır; "Açık" = PENDING+ACTIVE, "Bitmiş" = diğerleri. Liste `pageSize=100` (son 100) çekilip süzülür; sayfalama/geçmiş P8.
3. **Alt başlık TTL/limit sayısı içermez** ("15 dakika", "en fazla 3"): tenant ayarı ucu P9/P10; sayılar ancak diyalogda yanıttan (TTL) ve 409 mesajından (limit) gelir.
4. **"E-posta ile gönder" (P10) ve "Konsolu aç" (P4) gösterilmez;** kenar çubuğunda yalnız Ana sayfa + Oturumlar.
5. **Toast = kendi bileşen** (Sonner değil; nonce'suz `<style>`). Modal `<dialog>` üst katmanda ve dışı inert olduğundan açık diyalog kendi toast bölgesini taşır.
6. **Müşteri sayfası:** "Uçtan uca şifreli bağlantı" etiketi, "Kötüye kullanımı bildir" bağlantısı (ABUSE_EMAIL K10), form/KVKK/indirme/paylaşım/SmartScreen yok (P3/P4). Tenant logosu ve teknisyen avatarı `null` → sistem logosu + baş harf (P9/P12).
7. **Müşteri sayfasında `loading.tsx` yok:** akış (streaming) sınırı HTTP durumunu 200'e sabitliyor; 404'ün gerçek 404 dönmesi tercih edildi. Resolve iç ağda tek istek; yüklenme süresi kısa.
8. **P1 S1-4 testi güncellendi:** `/session/gizli-token` hâlâ 404 + `next=` yok, ama artık panel 404'ü yerine müşteri "Bağlantı geçersiz" ekranı.

### backend-dev / devops notu (açık konu)
- **Resolve IP sınırı:** resolve web konteynerinden yapıldığı için server istemci IP'si olarak web'in IP'sini görür → token limiti (30/dk/ipKey) tüm müşteriler için ortak sayılır. Web, Caddy'den gelen `X-Forwarded-For`'u iletir; server bunu yalnız web konteyneri `TRUSTED_PROXY_CIDR`'da ise kullanır. **Öneri:** web'e de sabit IP verip `TRUSTED_PROXY_CIDR`'a eklemek (caddy → web → server zinciri) veya ayrı bir iç başlık. Bu yapılmadan staging'de yoğun kullanımda yanlış 429 görülebilir.
- Web çalışma anı env'i `PUBLIC_BASE_URL` resolve `Origin`'i için zorunlu (compose web servisinde zaten var; değer server `ALLOWED_ORIGINS` ile aynı origin olmalı).

### Bağımlılık
Yeni bağımlılık yok. Tasarım skill'i okunmadı (P1'de okundu; P2 görünümü onaylı taslak + DESIGN.md token'larıyla yapıldı).

### Düzeltme turu 1 (qa QA-P2-5, QA-P2-6; güvenlik S-P2-4)
- **QA-P2-6:** P1'de paylaşılan bir yardımcı yoktu; 401 → giriş mantığı 5 yerde satır içi tekrarlanıyordu. Tek kaynak olarak `lib/api.ts`'e `EXPIRED_LOGIN_PATH` ve `isUnauthenticated(e)` eklendi. `cancel-dialog.tsx` ve `new-session-dialog.tsx` 401'de `router.replace(EXPIRED_LOGIN_PATH)` yapıyor. Mevcut kullanımlar da buna geçirildi: `sessions-view.tsx`, `change-password-form.tsx`, `(panel)/layout.tsx`, `sessions/page.tsx`, `change-password/page.tsx`. Birim testi `lib/api.test.ts`'te.
- **QA-P2-5:** e2e `sessions.spec.ts` dosyasına eklenen testler: loading (`sessions-loading` iskeleti, `aria-busy`), diyalogda `creating` iskeleti, partial (ilk liste 200, `page.clock` ile 10 sn sonraki yenileme 500 → satırlar ve "son güncelleme" saati korunuyor, `refresh-error` görünüyor), 401 (yeni oturum ve iptal → `/login?reason=expired` + uyarı). Mock'a yeni senaryolar eklendi (`e2e/mock-sessions.mjs`): `u-slow-*` (1,5 sn gecikme), `u-flaky-*`, `u-expire-*` (POST 401, sonrasında `/auth/me` de 401).
- **S-P2-4:** `g.rateBody` metni şöyle değişti: "Kod girişi geçici olarak engellendi. Teknisyeninizin gönderdiği bağlantıyı kullanın veya birkaç dakika sonra tekrar deneyin." Testi `guest.spec.ts`'te.
- **Doğrulama:** lint, typecheck ve vitest (20/20) yeşil. Yeni e2e testleri `--repeat-each=3` ile 42/42 geçti. Tam e2e 97 geçti, 1 skip (gerekçeli).
- **EDGE_PROXY_SECRET (kapandı):** `playwright.config.ts` web `webServer.env`'e test amaçlı sabit `EDGE_PROXY_SECRET` eklendi. Değer gerçek sır değil, yorumla belirtildi. Tam e2e artık ortam değişkeni verilmeden geçiyor (97 geçti, 1 skip).
- **server-api:** `resolveSessionToken`'ın kullanılmayan 2. parametresi (XFF) silindi. `session/[token]/page.tsx` artık bu parametreyi ve `headers()` importunu kullanmıyor.

### Düzeltme turu 2 (qa QA-P2-9; güvenlik S-P2-T2-1)
- **QA-P2-9:** `EDGE_AUTH_HEADER` export'u yerinde kaldı. `lib/edge-forward.test.ts` artık başlık adını literal `"x-edge-auth"` yerine bu sabitten alıyor (`[EDGE_AUTH_HEADER]: ...`). Böylece kullanılmayan export kalmadı ve test başlık adıyla senkron.
- **S-P2-T2-1:** Yeni `apps/web/instrumentation.ts` dosyasında `register()`, yalnız `NEXT_RUNTIME=nodejs` ve `NODE_ENV=production` koşulunda yeni `lib/startup-check.ts` modülünü dinamik import edip `assertEdgeSecretOrExit()` fonksiyonunu çağırıyor. Bu fonksiyon `readEdgeSecret()`'i çalıştırıyor. **Sapma:** Next 16, `register()` içinde fırlatılan hatayı yakalıyor, "Failed to prepare server" yazıyor ama süreci **açık bırakıyor**. Yalnızca throw etmek bu yüzden yetmedi. Hata yakalanınca mesaj (sır değeri olmadan) yazılıyor ve `process.exit(1)` çağrılıyor. Edge bundle'ına `process.exit` girmesin diye bu çağrı ayrı modülde ve dinamik import ile.
  - Doğrulama (standalone `server.js`): Sır yokken açılışta `[web] açılış durduruldu: EDGE_PROXY_SECRET gerekli ...` yazıyor ve exit=1. 32 karakterlik sırla süreç ayakta kalıyor, `/login` 200 dönüyor. `next build` sırrı vermeden (`env -u EDGE_PROXY_SECRET`) başarılı, çünkü build sırasında register çalışmıyor.
- **server-only:** `lib/server-api.ts` başına `import "server-only"` eklendi. **Yeni bağımlılık eklenmedi.** Next 16, `server-only` modülünü kendi derlenmiş kopyasına (`next/dist/compiled/server-only`) yönlendiriyor (`create-compiler-aliases.js`). TS side-effect import'u çözümlemeye zorlamıyor (`noUncheckedSideEffectImports` kapalı). Vitest `server-api.ts`'i import etmiyor.
- **Doğrulama:** lint, typecheck ve vitest (20/20) yeşil. `pnpm --filter @remote/web build` başarılı. e2e'de 97 geçti, 1 skip (önceki turla aynı gerekçe).

### Düzeltme turu 3 (sayfa testi TO-P2-1..3)
- **TO-P2-1:** `lib/error-message.ts`'e `withoutLeadingTitle(message, title)` eklendi. 409 uyarısı artık başlık + tek açıklama gösteriyor: sunucu mesajının ilk cümlesi başlıkla aynıysa atılıyor, geriye bir şey kalmazsa `d.limitHint` gösteriliyor. Birim testi `lib/error-message.test.ts`. e2e mock'taki 409 metni gerçek sunucu metniyle eşitlendi (`e2e/mock-sessions.mjs`), AC-11 testi başlığın bir kez geçtiğini doğruluyor.
- **TO-P2-2:** `created-session.tsx` içinde kod "Kopyala" düğmesi `ghost` yerine `secondary` yapıldı, link düğmesiyle aynı. AC-1/3/9 e2e testi iki düğmenin kenarlığını karşılaştırıyor.
- **TO-P2-3:** `(panel)/layout.tsx`: üst menüde `Avatar` (baş harf rozeti) her genişlikte görünüyor. Ad/rol/firma bloğu `sr-only sm:not-sr-only` oldu: mobilde ekran okuyucu yine okuyor, sm ve üstünde görünür kalıyor. `Avatar` primitifine isteğe bağlı `testId` eklendi. Mobil 375 e2e testi rozeti ve yatay taşma olmadığını doğruluyor.
- **Doğrulama:** lint, typecheck, vitest (23/23) yeşil. e2e (desktop + mobile): 97 geçti, 1 skip (önceki gerekçe).

## Backend (P1)
Sahibi: backend-dev · Tarih: 2026-11-11 · AC: 64, 65 (rev.; e-posta kısmı P10), 66 (zorunlu değişim kısmı), 69 (çatı + test aracı), 75 (rev.), 89 (health/ready), 90, 121, 123 (kullanıcı ayrımı testi), 126 (API başlıkları).

### Dosyalar
- `packages/contracts/`: `src/permissions.ts` (tek yetki tanımı, `PERMISSION_KEYS`, `effectivePermissions`, etiketler), `src/errors.ts` (kod→HTTP, hata zarfı zod şeması), `src/api/auth.ts` (login/şifre şemaları, `AuthUser`/`MeResponse`/`LoginResponse`, çerez/başlık adları), `test/permissions.test.ts`, `package.json`, `tsconfig.json`, `eslint.config.mjs`.
- `apps/server/src/`: `app.ts` (Fastify, helmet/CSP, trustProxy, requestId), `server.ts`, `env.ts`, `lib/{db,errors,ids,ip,logger,rate}.ts`, `auth/{routes,service,session,guards,password,repo}.ts`, `audit/{service,mask}.ts`, `ops/health.ts`.
- `apps/server/test/{unit,integration,helpers}/`, `apps/server/scripts/test-db.sh`, `vitest.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `package.json` (scriptler + bağımlılıklar).

### Uçlar (taban `/api/v1`)
| Uç | Girdi | Başarı | Hatalar |
|---|---|---|---|
| POST `/auth/login` | `{ login, password, tenantSlug? }` + `Origin` | 200 `{ user, mfaRequired:false, mustChangePassword }` + `__Host-rs_session` (HttpOnly) + `__Host-rs_csrf` (JS okunur) çerezleri; ikisi Secure, SameSite=Strict, Path=/, 8 sa | 400 VALIDATION, 401 UNAUTHENTICATED (genel mesaj), 403 CSRF_INVALID (Origin yok/izinsiz), 423 ACCOUNT_LOCKED + Retry-After, 429 RATE_LIMITED + Retry-After |
| POST `/auth/logout` | çerez + `X-CSRF-Token` + `Origin` | 204, çerezler silinir, oturum revoke | 401, 403 CSRF_INVALID |
| POST `/auth/password/change` | `{ current, next (12..200, current'tan farklı) }` + CSRF | 204, `mustChangePassword=false` | 400 VALIDATION (`fields.current` yanlış mevcut şifre, `fields.next`), 401, 403 |
| GET `/auth/me` | çerez | `{ user, permissions: string[], tenant: {id,name,slug}\|null, actingTenant: null }` | 401 |
| GET `/health` · `/ready` (kök, `/api` dışında) | — | `{status:"ok"}` · `{status:"ready", migration}` | 503 NOT_READY |
`user` = `{ id, email, username, fullName, role, tenantId, theme, mustChangePassword }`.

### Frontend için
- Çerez: `__Host-rs_session`, `__Host-rs_csrf` (tur 1, S1-9); başlık: `X-CSRF-Token` (= `__Host-rs_csrf` değeri). POST/PUT/PATCH/DELETE'te `Origin` başlığı **zorunlu** ve `ALLOWED_ORIGINS` içinde olmalı (Next sunucu tarafından durum değiştiren istek iletilirse Origin'i de iletmeli).
- Hata kodları: `VALIDATION` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `CSRF_INVALID` 403, `PASSWORD_CHANGE_REQUIRED` 403 (must_change iken me/logout/password/change dışındaki her oturumlu uç), `NOT_FOUND` 404, `ACCOUNT_LOCKED` 423, `RATE_LIMITED` 429, `INTERNAL` 500, `NOT_READY` 503. Zarf `{ error: { code, message, fields?, requestId } }`; yanıtta `X-Request-Id`.
- Tipler `@remote/contracts/{permissions,errors,api/auth}` — `lib/auth-schema.ts` geçici kopyası bunlarla değiştirilebilir. Paket TS kaynağı olarak tüketilir: `next.config.ts`'e `transpilePackages: ["@remote/contracts"]` ve web `package.json`'a `"@remote/contracts": "workspace:*"` gerekir.
- Frontend'in "backend-dev'den beklenenler" listesi (1–6) karşılandı.

### Devops için
- Server derleme adımı yok: `node src/server.ts` (Node ≥ 22.18 yerleşik type stripping; Prisma 7 üretilen istemcisi de `.ts`). İmajda önce `pnpm --filter @remote/server db:generate`. `pnpm --filter @remote/server start` / `dev`.
- Env (`src/env.ts`): `NODE_ENV`, `HOST` (0.0.0.0), `PORT` (3001), `PUBLIC_BASE_URL` (zorunlu; CSP `connect-src wss://host:port` buradan), `DATABASE_URL` (zorunlu, `mysql://`), `TRUSTED_PROXY_CIDR` (production'da zorunlu), `ALLOWED_ORIGINS` (boşsa PUBLIC_BASE_URL origin'i), `LOG_LEVEL`. `MIGRATE_DATABASE_URL` server tarafından okunmaz. `APP_ENCRYPTION_KEYS`, `SESSION_REF_KEY`, `COOKIE_SECRET` P1'de kullanılmıyor (ilgili pakette doğrulanacak).
- CI komutları: `pnpm --filter @remote/server lint|typecheck|test` + entegrasyon için MySQL servisi ve `TEST_DATABASE_URL` (app kullanıcısı, migrate+grants uygulanmış) ile `test:int`; `pnpm --filter @remote/contracts lint|typecheck|test`.

### Testler
```
eval "$(apps/server/scripts/test-db.sh up)"     # geçici mysql:8.4 + migrate + grants
pnpm --filter @remote/server test:int; pnpm --filter @remote/server test; pnpm --filter @remote/contracts test
apps/server/scripts/test-db.sh down
```
Son çıktı (2026-11-11, düzeltme turu 2 sonrası): server **13 dosya / 48 test yeşil**, contracts **2/2 yeşil** (ilk teslimde 36; tur 1: 45; tur 2: 48); `tsc --noEmit` ve `eslint` iki pakette temiz; konteyner silindi.
Kapsam: AC-64 (argon2id parametreleri, e-posta/kullanıcı adı, genel 401, pasif kullanıcı/tenant), AC-65 (hesap+IP 5. hatada 423, başka IP serbest, var olmayan hesapta aynı davranış, hesap geneli 20/sa DB kilidi, IP 20/dk 429, login/kilit/çıkış audit'i), AC-66 (zorunlu değişim kapısı), AC-68 (boşta/mutlak süre — oturum modeli), AC-69 (tüm uçların sınıflandırılması, B→A sızıntı taraması, çapraz tenant 404 vaka listesi, Super Admin tenantScope 403), AC-73 (requirePerm reddi/override), AC-75 (DB'de maske, perm_key açık, tüm alanlar), AC-89, AC-90 (log tarama, 500'de sızıntı yok), AC-121 (sahte XFF, güvenilen proxy zinciri, IPv6 /64), AC-123 (app kullanıcısıyla UPDATE/ALTER/DROP/TRIGGER/CREATE reddi), AC-126 (API başlıkları; web e2e frontend'de).

### AC-69 test aracı
`test/helpers/tenant-matrix.ts`: `collectRoutes` onRoute ile tüm uçları toplar; her uç `ROUTE_CLASSES`'ta `public|self|tenant` olarak sınıflandırılmazsa test kırmızı. `tenant` uçları `CROSS_TENANT_CASES`'e (B kullanıcısıyla A kaydı → 404) satır eklemek zorunda. Sonraki paketler yalnız bu iki listeye satır ekler.

### Sapmalar (gerekçeli)
- **Hesap geneli kilit P1'de kuruldu** (DB `locked_until`, 20 hata/sa); yalnız bildirim e-postası P10'da (şimdilik audit `auth.locked {scope:"account"}`). AC-65 tek AC, şema hazırdı.
- **Kilidi tetikleyen 5. (veya 20.) hatalı deneme doğrudan 423 döner** (sonraki istek değil) — kullanıcı kilidi hemen görür.
- **Kilit/limit sayacı `lib/rate.ts` (FixedWindowCounter)** — mimari §5.1 "bellek, rate.ts"; `@fastify/rate-limit` eklenmedi (aynı sayaç her iki kural için yeter, ek bağımlılık yok).
- **`auth/session.ts` ve `auth/repo.ts`** §6'daki auth dosyalarına eklendi (oturum modeli ve veri erişimi; servis/repo ayrımı kuralı). `lib/errors.ts`, `lib/db.ts` hata zarfı ve Prisma istemcisi için.
- **P1'de yazılmayanlar (kullanıcısı yok):** `lib/crypto.ts` (ilk gizli alan P10), `prefixKey` (P3). `tenantSlug` girdisi kabul edilir ama kullanılmaz (yalnız marka/logo bağlamı; e-posta global tekil).
- **Başarısız `mfaRequired`**: P1'de daima `false`, oturum `mfa_passed=true` (2FA P10).
- **`contracts/src/api/auth.ts`** görev listesindeki iki dosyaya ek: frontend ile paylaşılan girdi şemaları/yanıt tipleri tek yerde olsun diye (mimari §6 `api/*.ts`).
- **CSRF Origin zorunluluğu**: durum değiştiren isteklerde Origin yoksa da 403 (ADR-0008 "ayrıca Origin kontrolü"nün katı yorumu).
- ~~dba bulgusu: `prisma/seed.ts` tsconfig dışında~~ — **kapandı** (QA-8): seed tipli, `prisma/**/*.ts` server tsconfig kapsamında, `tsc` temiz.

### Bağımlılıklar
§10.4'ten: `fastify`, `@fastify/cookie`, `@fastify/helmet`, `zod`, `pino`, `argon2`, `ulid`, `@prisma/client`/`prisma`, `vitest`. Liste dışı: `@prisma/adapter-mariadb` (Prisma 7 sürücü bağdaştırıcısı zorunlu; dba sapma notu 5), `typescript` 5.9.3 + `eslint` 9.39.5 + `@eslint/js` + `typescript-eslint` 8.72 (lint/type DoD; web ile aynı sürümler; TS 7 typescript-eslint ile uyumsuz — peer `<6.1`).

### Düzeltme turu 1 (qa-raporu QA-1/2/4/5, güvenlik S1-2/3/5/6/7/8/9/10)
- **QA-1 / S1-2 hesap geneli sayaç atomik:** `repo.bumpAccountFailures` tek TX'te `UPDATE … failed_login_count = IF(pencere içinde, +1, 1)` + `SELECT … FOR UPDATE`; eşikte `locked_until = UTC_TIMESTAMP(3) + 15 dk`. Test: 25 paralel, farklı IP → kilit + tek `auth.locked{scope:account}`.
- **S1-6 hesap+IP sayacı:** deneme doğrulamadan ÖNCE senkron sayılır (Node tek iş parçacığı → atomik), başarıda sıfırlanır. Test: aynı IP+hesaptan 10 paralel → tam 5 doğrulama (4×401 + 6×423), tek kilit kaydı.
- **QA-2 / S1-5 varlık sızmaz:** olmayan hesap için aynı 20/sa kuralı bellekte (`ghostAccount`, login anahtarlı); kilitli dalda da argon2 doğrulaması (sabit maliyet). Test: var olan/olmayan hesapta 20. ve 21. deneme durum + gövde (requestId hariç) eşit.
- **S1-3 şifre değişimi:** başarıda kullanıcının diğer tüm `auth_sessions` kayıtları aynı TX'te iptal (audit `revokedSessions` sayısı); oturum başına 5 hatalı mevcut şifre → oturum iptal + 401 `UNAUTHENTICATED` (audit `reason: too_many_attempts`). Mevcut oturum yenilenmiyor (token aynı kalır) — çalınmış çerez senaryosunda saldırganın oturumu zaten "diğer" değilse saldırgan değişimi yapan taraftır; P10 `logout-all` bunu tamamlar.
- **QA-4:** `application/json` ayrıştırıcısı boş gövdeyi `undefined` kabul eder (dolu gövde Fastify'ın prototip korumalı varsayılan ayrıştırıcısıyla). Test: gövdesiz logout 204.
- **QA-5:** kaldırıldı: `ACTION_LABELS`, modül `label` alanları, `errorCodeSchema`/`errorEnvelopeSchema` (zarf artık TS arayüzü `ErrorEnvelope`), `isPermissionKey`. P9 toggle ekranı etiketleri o pakette ekler.
- **S1-7:** izinli anahtarın değeri nesne/diziyse içi yine maskelenir; ilkel değer açık kalır. Birim test.
- **S1-8:** giriş girdisi `@` içeriyorsa yalnız e-posta, değilse yalnız kullanıcı adı ile `findUnique`. Kullanıcı adı kalıbı (`@` yasağı) kullanıcı oluşturma ucu gelince (P9) contracts'a eklenecek — P1'de tüketicisi yok.
- **S1-9:** çerez adları `__Host-rs_session`, `__Host-rs_csrf` (`@remote/contracts/api/auth` sabitleri; Secure, Path=/, Domain yok). **Frontend:** sabitleri contracts'tan almaya devam etmesi yeterli.
- **S1-10:** başarılı girişte gelen eski oturum çerezinin DB oturumu iptal edilir. Çıkışta doğrulama/CSRF hatasında (401/403) yanıt yine iki çerezi temizler, **sunucu oturumu iptal edilmez**. Güvenlik değerlendirmesi: temizlik yalnız istemci çerezini siler, saldırgana yetki kazandırmaz; çapraz siteden tetiklenen isteğe SameSite=Strict çerez gönderilmez ve tarayıcılar çapraz site yanıtındaki SameSite=Strict `Set-Cookie`'yi uygulamaz → en kötü durum kullanıcının kendi tarayıcısında oturumdan düşmesi (CSRF'siz çıkış), oturumu sunucuda sonlandırmak ise yalnız geçerli CSRF ile mümkün.
- Sonuç (2026-11-11, geçici mysql:8.4): server **13 dosya / 45 test yeşil** (3 ardışık koşu, eşzamanlılık testleri kararlı), contracts 2/2; `tsc` + `eslint` temiz; konteyner silindi. Yeni test dosyası `test/integration/auth-fix1.test.ts`. Yeni bağımlılık yok.

### Düzeltme turu 2 (güvenlik S2-1/S2-2/S2-3, qa QA-10)
- **S2-1 bellek sayaçları:** `FixedWindowCounter` kayıt sayısı üst sınırlı (`maxEntries`, varsayılan 50.000; dolunca en eski kayıt atılır — Map ekleme sırası, penceresi yenilenen kayıt sona taşınır); `hit` O(1). Süresi dolan kayıtlar istek yolunda değil, 30 sn'lik `unref`'li zamanlayıcıyla (`prune`) silinir; uygulama kapanışında (`onClose`) durdurulur. `ghostAccount` ve hesap+IP anahtarları `sha256(login)` (sabit uzunluk). Kalan risk (kabul): sınır dolduğunda atılan en eski kayıt etkin bir kilit olabilir; bunun için 15 dk içinde ~50.000 yeni anahtar gerekir (IP başına 20/dk → ~170 IP). Testler: sınır aşımında boyut sabit, 100.000 `hit` ortalaması < 0,05 ms, `prune` biteni siler ve etkin kilidi korur.
- **S2-2:** başarılı şifre değişiminde mevcut oturum dahil tüm oturumlar iptal; yanıtta yeni `__Host-rs_session` + yeni `__Host-rs_csrf` set edilir (mutlak bitiş eski oturumunkini aşmaz). **Frontend:** değişimden sonra CSRF değeri çerezden yeniden okunmalı (lib/api.ts her istekte çerezden okuyorsa ek iş yok). Test: eski çerez 401, yeni çerez 200, diğer cihaz 401.
- **S2-3:** `SELECT … FOR UPDATE` kaldırıldı; artış + eşik + kilit + pencere sıfırlama tek `UPDATE` ifadesinde (MySQL atamaları soldan sağa, güncel değerle), sonuç aynı TX'te tek düz `SELECT` ile okunur. 25 paralel test yeşil.
- **QA-10:** bu bölümdeki çerez adları, test sayısı ve seed notu güncellendi.
- Sonuç (geçici mysql:8.4): server **13 dosya / 48 test yeşil** (3 ardışık koşu), contracts 2/2; `tsc` + `eslint` temiz; konteyner silindi. Yeni bağımlılık yok.

## DevOps (P1)
### Dosyalar
`apps/server/Dockerfile` (hedefler: `migrate` = prisma CLI + tsx, `runtime` = yalnız prod bağımlılığı, `node src/server.ts`), `apps/web/Dockerfile` (Next standalone), `.dockerignore`, `deploy/docker-compose.yml` (mysql, migrate, seed[profil setup], server, web, caddy), `deploy/Caddyfile`, `.github/workflows/ci.yml`, `.github/dependabot.yml`, `.gitleaks.toml`, `scripts/check-licenses.mjs`, `.env.example` (eklenen anahtarlar), `.gitignore`, `CLAUDE.md`, `docs/runbook.md`. `git init` yapıldı, commit yok.

### Kararlar
- İmajlar sabit sürüm: `node:22.23.4-bookworm-slim` (glibc: argon2 prebuild + Prisma schema-engine sorunsuz; migrate hedefinde `openssl`), `mysql:8.4.13`, `caddy:2.11.9-alpine`. pnpm 9.15.9 corepack ile imaja gömülü (`COREPACK_HOME`), çalışma anında indirme yok — `db` ağı `internal` (internetsiz) olduğu için gerekli.
- Server imajında `pnpm deploy` yok: workspace `.ts` paketleri `node_modules` altına kopyalanırsa Node tip ayıklamayı reddeder; symlink'li yapı korunur. Prisma client `tooling` aşamasında üretilip kopyalanır.
- Her servise env **açıkça** listelenir (env_file yok); `DATABASE_URL`/`MIGRATE_DATABASE_URL` parolalardan compose'da üretilir. Server'da `MIGRATE_DATABASE_URL` ve root parolası yok (doğrulandı: `0`).
- Ağlar: `edge` (caddy/web/server; caddy sabit `172.30.0.2`, dinamik havuz `.128/25` → `TRUSTED_PROXY_CIDR=172.30.0.2/32`), `db` (internal; mysql/migrate/seed/server). MySQL portu yayımlanmaz; yalnız caddy `4450/tcp`. HTTP/3 kapalı (yalnız TCP yayımlanır).
- Sertleştirme: node konteynerleri `read_only`, `cap_drop: ALL`, `no-new-privileges`, `init`, uid 1000; json-file log 10 MB × 5.
- Caddy: `/api/*`, `/ws/*` → server; geri kalan → web; `/health|/ready|/metrics` → 404. Başlıkların sahibi uygulama: Caddy yalnız `Server`/`X-Powered-By`/`Via` siler, HSTS/nosniff/Referrer-Policy'yi **yalnız yoksa** (`?`) ekler; CSP'ye dokunmaz. `X-Forwarded-Proto` reverse_proxy varsayılanıyla gider; `trusted_proxies` yok → istemci XFF'i ezilir (G-11). Gövde sınırı API 2 MB / web 1 MB; read_header 10 sn, read_body 30 sn, idle 2 dk. Rate limit uygulamada (Caddy çekirdeğinde yok).
- Log filtresi (G-10): `request>uri` iki regexp (sorgu dizesi silinir, `/session/<token>` → `/session/***`), `Cookie`, `Authorization`, `X-Csrf-Token`, `Referer`, `Sec-Websocket-Protocol`, yanıt `Set-Cookie` silinir.
- CI: job'lar `quality` (lint+typecheck), `test` (MySQL 8.4.13 servis + `01-users.sh` + migrate + `check-app-grants.sh` + unit + `test:int`), `e2e` (Playwright chromium, mock API), `build` (pnpm build + 3 Docker hedefi + compose/Caddyfile doğrulama + server'da MIGRATE yok kontrolü), `supply-chain` (`pnpm audit --audit-level high`, lisans, gitleaks tüm geçmiş). Action'lar SHA sabit, `permissions: contents: read`, secret kullanılmaz. actionlint temiz.
- Lisans: `pnpm licenses list --prod` + betik; GPL/AGPL yasak, LGPL izinli (şu an LGPL-2.1/3.0-or-later paketler var).
- Henüz eklenmeyenler (paketlerine ertelendi): `APP_ENCRYPTION_KEYS`, `SESSION_REF_KEY`, `COOKIE_SECRET`, TURN/coturn, `/metrics`, yedek, uploads volume.

### Doğrulama (2026-11-11, yerel Docker 29.8 / Compose 5.5)
- `docker compose up mysql migrate`: migration + grants uygulandı, `db` ağı internetsizken corepack/pnpm çalıştı; ikinci çalıştırma "No pending migrations". Seed iki kez: `created` → `exists`.
- `docker compose up -d server`: server **14 sn**'de healthy, `/ready` → `200 {"status":"ready","migration":"20261111000000_p1_init"}`; konteynerde `MIGRATE_DATABASE_URL` sayısı 0, uid 1000.
- Caddy (sahte upstream'lerle): yönlendirme, `/health` 404, `Server`/`Via` silindi, upstream HSTS korunuyor, 3 MB POST → 413, logda gizli değer 0.
- `check-app-grants.sh`: 16/17 PASS; tek FAIL `UPDATE tenant_settings SET session_ttl_min=5` → `NODE_ENV=production` seed demo tenant oluşturmadığı için tablo boş, CHECK tetiklenmedi (yetki sorunu değil). CI'da `NODE_ENV=test` ile satır olur; dba betiği satır yoksa önce ekleyecek şekilde sağlamlaştırabilir.
- gitleaks: test sabit parolası (`apps/server/test/helpers/app.ts`) `.gitleaks.toml`'da tek yol istisnası; kalan bulgular git-ignore'lu `.next/` içinde.
- **Web imajı build olmadı:** `apps/web/next.config.ts`'de `output: "standalone"` yok → frontend eklemeli (bkz. açık işler). Tam yığın (`web` + `caddy`) uçtan uca doğrulaması bu düzeltmeden sonra yapılacak.
- Sonunda `docker compose down -v` ile temizlendi; geçici `deploy/.env` silindi.

### Açık işler
- frontend-dev: `next.config.ts` → `output: "standalone"`, `outputFileTracingRoot: path.join(__dirname, "../..")`.
- devops (entegrasyon turu): web düzeltmesinden sonra temiz makinede tam `docker compose up -d` → `/ready` ≤120 sn, Caddy üzerinden giriş (Secure çerez), Caddy logunda sorgu/subprotocol yok kanıtı.

### Entegrasyon doğrulaması (2026-11-11, temiz ortam: `down -v` → `up -d --build`; tur 2 = QA-12 `__Host-` çerezleri + backend düzeltme turu 2 sonrası tekrar)
| Kontrol | Sonuç |
|---|---|
| `docker compose up -d` (imajlar hazır, boş volume) → server healthy | Tur 1: **19 sn**; tur 2 (QA-12 sonrası): **34 sn** (mysql init + migrate dahil; hedef ≤120 sn) — GEÇTİ |
| Servis durumu | mysql/server/web healthy, migrate exited 0, caddy up |
| `check-app-grants.sh` | **22/22 PASS** (tur 1 ve tur 2) |
| Server konteynerinde `MIGRATE_DATABASE_URL` | 0 — GEÇTİ |
| Caddy (https://localhost:4450, `tls internal`) üzerinden seed Super Admin girişi (Origin'li) | 200; tur 2: `__Host-rs_session` HttpOnly+Secure+SameSite=Strict+Path=/, `__Host-rs_csrf` Secure+SameSite=Strict+Path=/, `Domain` özniteliği yok; `mustChangePassword=true` |
| `/api/v1/auth/me` | 200 |
| `POST /auth/password/change` | 204; tur 2: yanıtta **yeni** iki `__Host-` çerezi (oturum token'ı değişti); eski çerezle `/auth/me` **401**, yeni çerezle 200 |
| `POST /auth/logout` (gövdesiz, web istemcisi gibi) | 204; tur 2: iki çerez `Max-Age=0` ile silindi (jar'da 0); sonra `/auth/me` 401, logout öncesi token ile de 401 |
| Yabancı Origin ile login | 403 |
| 5 hatalı giriş | 1–4: 401, 5–6: **423** `ACCOUNT_LOCKED`; kilitliyken doğru parola da 423 |
| Web `/login` Caddy üzerinden | 200; uygulamanın nonce'lu CSP'si korunuyor; HSTS/nosniff/Referrer-Policy var; `Server` ve `X-Powered-By` yok |
| Playwright (tek seferlik betik, repoya eklenmedi), gerçek tarayıcıyla giriş | Panel "Ana sayfa" açıldı, konsolda hata 0, çerezler Secure |
| Caddy erişim logu | tur 1 (38 satır) ve tur 2 (9 satır): çerez değerleri (eski/yeni oturum, CSRF), `__Host-`, sorgu dizesi, ticket, subprotocol, Cookie, Set-Cookie, Location, parola: 0; `/session/***` maskeli |
| Server logu | parola (eski/yeni), oturum token'ları, ticket, subprotocol: 0 |

**Bulunan ve düzeltilen (devops):** Web'in kimliksiz istekte döndüğü yönlendirme (`Location: /login?next=<tam yol + sorgu>`)
Caddy logunda `resp_headers>Location` alanından `/session/<token>` ve `?ticket=` değerini sızdırıyordu (G-10). Caddyfile'a
`resp_headers>Location delete` eklendi; yönlendiren sahte upstream ile tekrar denendi → sızıntı 0.

**Başka ajanlara ait notlar (düzeltilmedi):**
- frontend-dev (Düşük): `proxy.ts` kimliksiz istekte `next=` parametresine yolun tamamını ve sorgu dizesini koyuyor. `/session/<token>` (P4 public rota) ve sorgu dizesi `next`'e taşınmamalı; token tarayıcı geçmişine ve login URL'sine yayılıyor.
- backend-dev (Bilgi): `POST /auth/logout`, `Content-Type: application/json` ile gövdesiz istekte 400 `VALIDATION` dönüyor (Fastify boş JSON gövdesi). Web istemcisi gövdesizken bu başlığı göndermediği için kullanıcıyı etkilemiyor; Go istemci/3. taraf için gövdesiz JSON kabul edilebilir.
- Runbook: `deploy/.env`'de boşluk içeren değerler tırnaklanmalı (kabukta `. ./.env` için). Runbook §3'e eklendi.

Temizlik: `docker compose --profile setup down -v`, geçici `deploy/.env` ve test dosyaları silindi.

### Düzeltme turu 1 (güvenlik raporu "P1 kod turu")
- **S1-11 (G-18):** tüm imaj referansları `etiket@sha256:<özet>` ile sabitlendi: `node:22.23.4-bookworm-slim` (iki Dockerfile `NODE_IMAGE`), `mysql:8.4.13` (compose + CI servis), `caddy:2.11.9-alpine` (compose + CI doğrulama), `ghcr.io/gitleaks/gitleaks:v8.30.1` (CI). Etiket okunabilirlik için korunur; Dependabot `docker` ekosistemi (`/apps/server`, `/apps/web`) etiket+özeti birlikte günceller. Özet değişimi: `docker buildx imagetools inspect <imaj:etiket>`.
- **minimatch GHSA-g3hv-75wg-m249 (orta):** kök `package.json` → `pnpm.overrides` `"minimatch@>=7.0.0 <11.0.1": "^11.0.1"` (yalnız etkilenen aralık; eslint'in minimatch 3.1.5'i dokunulmadan kalır). `pnpm install` → 21 yol 11.0.6'ya çıktı; `pnpm audit --audit-level moderate` → **No known vulnerabilities**. `pnpm -r run lint` temiz, server Dockerfile digest'li base ile build oldu, actionlint temiz.
- **gitleaks (yerel, digest'li imaj, `dir` modu, `.gitleaks.toml`):** 10 bulgu, hepsi git-ignore'lu `apps/web/.next/` (Next derleme çıktısı preview anahtarları) → repoya girmez; izlenebilir dosyada bulgu **0**. Repo'da henüz commit yok; CI `git` modu tüm geçmişi tarar.

## Backend (P2)
Kapsam: oturum yaşam döngüsü (teknisyen) + public resolve/durum yoklaması (P2 kısmı) + expiry işi + K11. AC: 1, 2, 3, 4 (TTL okuma), 5, 7 (yalnız 410 CONSUMED), 8, 11, 12, 61 (kısmi), 69.

### Değişen / yeni dosyalar
- `packages/contracts/src/api/sessions.ts` (yeni; export `@remote/contracts/api/sessions`), `packages/contracts/src/errors.ts` (+`CONFLICT`, `OPEN_SESSION_LIMIT` 409; `SESSION_EXPIRED`/`SESSION_CONSUMED`/`SESSION_CANCELLED` 410)
- `apps/server/src/sessions/{codes,repo,service,public,routes}.ts` (yeni), `src/jobs/scheduler.ts` (yeni)
- `src/lib/rate.ts` (K11/S3-1), `src/lib/ip.ts` (+`prefixKey` /24 · /56), `src/lib/errors.ts` (mesajlar), `src/env.ts` (+`SESSION_REF_KEY`), `src/app.ts` (rotalar, `publicLimits`, `sessionRefKey`, `startJobs`), `src/server.ts` (`startJobs: true`), `.env.example`
- Testler: `test/unit/{rate,ip}.test.ts`, `test/integration/{sessions,sessions-lifecycle,sessions-public}.test.ts`, `test/helpers/{app,tenant-matrix}.ts`, `test/integration/tenant-isolation.test.ts` ("list" sınıfı), `test/integration/ops-headers.test.ts` (/ready migration beklentisi artık son migration adı — P2 migration'ı eklendiği için)

### Uçlar
| Uç | Yetki | Yanıt | Hatalar |
|---|---|---|---|
| POST `/api/v1/sessions` `{}` | sessions.create | 201 `{ id, link, code, techVerifyCode, expiresAt, status:"PENDING" }` | 403 (yetki / başka tenant'ta açma), 409 `OPEN_SESSION_LIMIT`, 429 `RATE_LIMITED` + `Retry-After` |
| GET `/api/v1/sessions?status=&technicianId=&page=&pageSize=` | sessions.view | `{ items: SessionView[], page, pageSize, total }`, sıra createdAt desc, pageSize ≤ 100 | 400 |
| GET `/api/v1/sessions/:id` | sessions.view | `SessionView` (link YOK; `code` yalnız PENDING iken) | 404 |
| POST `/api/v1/sessions/:id/cancel` | sessions.delete | `{ status:"CANCELLED" }` | 404, 409 `CONFLICT` (PENDING değil / süresi dolmuş) |
| POST `/api/v1/public/sessions/resolve` `{ token }｜{ code }` + `clientKind` | public, Origin zorunlu | `{ sessionRef, tenant:{name, logoUrl:null}, technician:{name, avatarUrl:null}, techVerifyCode, expiresAt }` | 400, 403 `CSRF_INVALID`, 404, 410 `SESSION_EXPIRED`/`SESSION_CONSUMED`/`SESSION_CANCELLED`, 429 |
| GET `/api/v1/public/sessions/status?ref=` | public | `{ status }` | 404 (geçersiz/sahte ref), 429 |

- Kapsam: USER yalnız `technician_id = kendisi` (liste, detay, iptal; `technicianId` filtresi kapsamı ezemez); ADMIN etkin tenant'ın tümü. Başka tenant/başkasının oturumu → 404.
- Limitler: açık (PENDING+ACTIVE) oturum `tenant_settings.max_open_sessions` (vars. 3) ve 20/sa/teknisyen — ikisi de users satırı `FOR UPDATE` + sayım + INSERT + audit tek TX'te (yarış testi: 6 paralel istek → 3×201, 3×409). Resolve: başarısız kod ipKey 10/dk + prefixKey 30/dk → yalnız o anahtar 15 dk 429; token 30/dk/ipKey; status 60/dk/ipKey.
- Kod çakışması: P2002 + index `support_sessions_active_code_key` → tüm TX yeni kodla, en çok 5 deneme (sonra 500).
- Audit: `session.created`, `session.cancelled`, `session.expired` (SYSTEM), `session.resolve` fail (410 nedeni). Token hiç yazılmaz; kod yazılmaz (test: DB+audit dökümünde düz token/kod yok).
- Expiry: `jobs/scheduler.ts` 30 sn'de bir, unref'li, örtüşmesiz, `onClose`'da durur; satır başına koşullu UPDATE + audit TX'i. Resolve ve status yolları süresi dolmuş PENDING'i aynı istekte EXPIRED yapar.
- K11/S3-1: `FixedWindowCounter` kapasite doluyken en eskiden en çok 32 kayda bakıp kilidi bitmiş ilkini atar; hepsi kilitliyse kayıt eklenmez ve `hit` true döner (fail-closed). Birim testli.

### Tasarımdan sapmalar (gerekçeli)
1. `sessions/public.ts` ek dosya (§6 planında 4 dosya): public servis + limitler teknisyen servisinden ayrı, dosyalar ≤150 satır.
2. `SESSION_REF_KEY` env'de opsiyonel (≥32 karakter); boşsa süreç başına rastgele. Gerekçe: deploy/ bu turda değiştirilmedi; yeniden başlatmada yalnız eski `sessionRef`'ler 404 olur. **devops:** compose `server` servisine + runbook'a ekle.
3. Resolve yanıtında `consentText`, `joinNonce`, `nonceExpiresAt` yok (P3). `logoUrl`/`avatarUrl` şimdilik null (P9).
4. 20/sa limiti bellekte değil DB sayımıyla (IX technician_id, created_at): yeniden başlatmada sıfırlanmaz, aynı TX kilidiyle yarışa güvenli.
5. Liste filtreleri P2'de yalnız `status`, `technicianId`, `page`, `pageSize`; `from/to/customer/mode/sort` P8. SUPER_ADMIN tenant seçmeden (`tenantScope`) 403 — tenant geçişi P9.
6. AC-4'ün "aralık dışı 400" kısmı ayar ucuyla gelir (ayar ekranı P9/P10); P2 değeri `tenant_settings`'ten okur (DB CHECK 15..30).
7. Global başarısız-kod sayacı (metrik/alarm) P3 `/metrics` ile.
8. İptal, süresi dolmuş PENDING'i iptal etmez (409); expiry yoluna bırakılır.

### Bağımlılık
Yeni bağımlılık yok.

### Komutlar ve son çıktı
`pnpm -r run lint` · `pnpm -r run typecheck` temiz. `pnpm -r run test`: contracts 2, server unit 16, web 7 geçti. Entegrasyon: `eval "$(apps/server/scripts/test-db.sh up)" && pnpm --filter @remote/server test:int` → **12 dosya, 56 test geçti** (iki kez koşuldu), konteyner silindi.

### frontend-dev için
- Tipler: `@remote/contracts/api/sessions` (`CreateSessionResponse`, `SessionView`, `SessionListResponse`, `ResolveSessionResponse`, `PublicSessionStatusResponse`, `resolveSessionInputSchema`).
- Link biçimi: `${PUBLIC_BASE_URL}/session/<43 karakter token>`; link yalnız POST yanıtında — kaybolursa iptal + yeni oturum. Kod boşluksuz 8 hane gelir, ekranda `4829 1376`.
- Karşılama sayfası: POST resolve (`Origin` başlığı, gövde `{ token, clientKind:"BROWSER" }`) → 410 kodlarına göre ekran (`SESSION_EXPIRED` "Bağlantının süresi doldu", `SESSION_CANCELLED` "Oturum iptal edildi", `SESSION_CONSUMED`); başarılıysa `sessionRef` ile 2 sn'de bir `GET /public/sessions/status?ref=` → `CANCELLED`/`EXPIRED` görünce ilgili ekran. 429'da `Retry-After`.
- Konsol: 409 `OPEN_SESSION_LIMIT` ve 429 mesajları `error.message`'dan gösterilebilir.

### P2
- **`SESSION_REF_KEY`:** compose `server` servisine `${SESSION_REF_KEY:?…}` ile **zorunlu** eklendi (P2 düzeltme turu 1'den beri env.ts production'da da zorunlu — S-P2-7; önceden opsiyoneldi ve boşsa süreç başına rastgele anahtar → her restart/deploy'da açık oturum linkleri 404 olur, compose bunu engeller). `.env.example`'da boş anahtar mevcut, açıklaması `openssl rand -base64 48` olarak güncellendi; runbook §3'e üretim komutu ve rotasyon uyarısı eklendi. CI compose doğrulama adımı sahte değerle dolduruyor (gitleaks: sızıntı yok). `docker compose config`: anahtar boşken "required variable" hatası, doluyken geçerli; server env'inde var, `MIGRATE_DATABASE_URL` yok. actionlint temiz.
- **Caddy log filtresi (P2 uçları):** değişiklik gerekmedi. Sahte upstream'le denendi: `/api/v1/public/sessions/status?ref=…` (ref tek başına ve başka parametreyle) → `"uri":"/api/v1/public/sessions/status"`; `/session/<token>`, `/session/<token>/?x=…`, `/session/<token>#frag` → `/session/***`. Logda gizli değer 0.

### Düzeltme turu 1 (qa-raporu QA-P2-1/2/3/4/7/8, güvenlik S-P2-3/6/7)
- **QA-P2-1:** `sessions-public.test.ts` — EXPIRED (kod + token yolu), CANCELLED, CONSUMED için 410 sonrası `session.resolve/fail` audit'i tam 1 satır, `newValue.reason` = kod, dökümde token/kod yok.
- **QA-P2-2:** aynı dosyada yoklama testleri: süresi dolmuş PENDING → `{status:"EXPIRED"}` + satır EXPIRED/SYSTEM + `session.expired` audit; 60/dk/IP → 61. istek 429 + `Retry-After`, başka IP etkilenmez.
- **QA-P2-3:** `repo.countOpen(db, technicianId, now)` artık `ACTIVE OR (PENDING AND expiresAt > now)`; `now` TX içinde sayımdan önce alınıyor. Regresyon: `sessions.test.ts` "süresi dolmuş 3 PENDING varken POST 201".
- **QA-P2-4:** `HOURLY_CREATE_LIMIT`, `sessionScope`, `toView`, `sessionLink` (service.ts), `EXPIRY_INTERVAL_MS` (scheduler.ts), `ACTIVE_CODE_INDEX` (codes.ts) export'ları kaldırıldı. Contracts'taki şemalar sözleşme paketi olduğu için dokunulmadı.
- **QA-P2-7:** mimari §11 eşleme tablosunda AC-4 ikiye bölündü (okuma P2; aralık dışı 400 → P9/P10 `/settings/tenant`); P9 AC listesine "4(400)" eklendi.
- **QA-P2-8:** `test/unit/scheduler.test.ts` (sahte db/log): üst üste binmeme, hata `log.error`'a gider ve sonraki tur yeniden dener, `stop` sonrası interval tetiklemez.
- **S-P2-3 (G-02, mimari §11 alarm):** `public.ts` `ResolveFailedAlarm` — kod yolunda her başarısız çözümleme (404 ya da limiti tetikleyen) global sayaca girer; 60 sn sabit pencerede 100'ü aşınca pencere başına bir `warn` (`alarm:"resolve_failed", failed, prefixes, windowSec`). IP/önek/kod loga yazılmaz; engelleme yok. Bellek: tek sayaç + en çok 10.000 öneklik küme. `/metrics` bağlantısı P13'te. `createPublicLimits(log)` imzası değişti (app.ts). Testler: unit `resolve-alarm.test.ts` (2), entegrasyon 101 dağıtık hata → tek warn.
- **S-P2-6:** 410 audit'i `goneAudit` sayacıyla (`FixedWindowCounter(2, 10 dk, 10 dk)`, anahtar `oturumId:sebep`, en çok 50.000 kayıt) aynı oturum + sebep için 10 dk'da tek satıra indirildi; kod ve token yolu için ortak. Tablo doluysa yazım atlanır (gürültü bastırma tarafı).
- **S-P2-7:** `env.ts` — `SESSION_REF_KEY` production'da zorunlu (refine). Unit test eklendi; mevcut production testi anahtarla güncellendi.
- Sözleşme değişikliği yok (frontend-dev için etkisiz).
- Komutlar: `pnpm --filter @remote/server lint|typecheck` temiz; `test` → 6 dosya, **22 test** (önce 16); `eval "$(apps/server/scripts/test-db.sh up)" && pnpm --filter @remote/server test:int` → 12 dosya, **61 test** (önce 56), iki kez koşuldu; konteyner silindi.

### Düzeltme turu 2 (güvenlik S-P2-T2-1 (b))
- **S-P2-T2-1 (b):** Caddy↔web edge sırrı uyuşursa web XFF iletmez ve server'da `req.ip` web adresi (172.30.0.3) olur. Artık görünür: `resolvePublicSession` başında `limits.clientIpIsProxy.check(ctx.ip)` — istemci IP'si `TRUSTED_PROXY_CIDR` içindeyse (yani XFF gelmemiş) dakikada en çok bir `warn` (`alarm:"client_ip_is_proxy"`); IP/token/kod loga yazılmaz, istek engellenmez. Kod ve token yolu ikisi de kapsanır.
  - `lib/ip.ts` `cidrMatcher(cidr)` — Node yerleşik `net.BlockList` (yeni bağımlılık yok); zone id atılır, IPv4-mapped IPv6 IPv4 olarak denetlenir; CIDR boşsa hep false (geliştirmede alarm yok).
  - `sessions/public.ts` `ClientIpIsProxyAlarm` — kısma için mevcut `FixedWindowCounter(1, 60 sn, 60 sn)` (tek anahtar, zamanlayıcısız) yeniden kullanıldı. `createPublicLimits(log, trustedProxyCidr?)` imzası değişti (app.ts `env.TRUSTED_PROXY_CIDR` geçer). Env değişkeni eklenmedi.
  - Testler: unit `ip.test.ts` (+2: IPv4 /31, mapped, IPv6, boş CIDR), `resolve-alarm.test.ts` (+2: dakikada tek alarm / pencere sonrası yeniden; CIDR boşsa alarm yok); entegrasyon `sessions-public.test.ts` (+1: XFF'li ve proxy dışı istek alarm üretmez, XFF'siz 3 istek → tek warn, hepsi 200, logda IP/token yok).
- (a) maddesi (web açılışında sır doğrulaması) frontend-dev'e atanmıştır; bu turda dokunulmadı.
- Sözleşme değişikliği yok.
- Komutlar: lint/typecheck temiz; `test` → 6 dosya, **26 test**; `test:int` → 12 dosya, **62 test**; test konteyneri silindi.

## DevOps (P2)
### Dosyalar
`deploy/docker-compose.yml` (web sabit `172.30.0.3`; server `TRUSTED_PROXY_CIDR=172.30.0.2/31`), `.env.example` ve `apps/server/src/env.ts` (yalnız açıklama), `docs/runbook.md` (§1 IP zinciri, §7 sorun giderme). `server-api.ts` değişmedi.

### Müşteri IP'si (G-11)
- Zincir: istemci → Caddy (.2; `trusted_proxies` yok → gelen XFF ezilir, gerçek adres yazılır) → web (.3; Caddy XFF'ini iletir) → server. Fastify `trustProxy` (proxy-addr) sağdan yürür: soket .3 güvenilir → XFF'teki Caddy değeri = istemci. `env.ts` tek CIDR kabul ettiği için liste yerine /31 (yalnız .2 ve .3). .3, dinamik aralık (.128/25) dışında.
- Not: `ip_range` verildiği için Docker edge ağ geçidini **172.30.0.128** seçiyor; Docker Desktop'ta host'tan gelen istekler bu adresten görünür (Linux'ta gerçek istemci IP'si). Güven listesi dışında, sorun yok.

### Entegrasyon doğrulaması (2026-11-11, temiz yığın `up -d --build`, sahte .env)
| Adım | Sonuç |
|---|---|
| Servisler | mysql/server/web healthy, migrate 0, caddy up; web=172.30.0.3, caddy=172.30.0.2 |
| Seed (`NODE_ENV=development` → demo tenant) + teknisyen (ADMIN, demo tenant, SQL ile test kullanıcısı) | GEÇTİ |
| login → POST /sessions → GET /sessions | 200 → 201 (link 43 karakter token) → 200 total=1 PENDING |
| Müşteri (ayrı konteyner 172.30.0.50, sahte `X-Forwarded-For: 6.6.6.6`) `/session/<token>` | 200, teknisyen adı sayfada |
| status?ref | PENDING → cancel 200 → CANCELLED; sayfa "iptal edildi"; geçersiz token 404 |
| Audit `session.resolve` IP | web üzerinden gelen resolve **172.30.0.50** (web .3 değil); 6.6.6.6 hiçbir yerde yok |
| Token limiti ayrışması | .50'den 33 istek → limit doldu ("Çok fazla deneme"); aynı anda .51 ve host "iptal edildi" görüyor (limit artık ortak değil) |
| Caddy logu | token 0, `/session/***` maskeli; server/web logunda token 0 |
| Testler | contracts 2, web 12, server unit 16, server entegrasyon (test-db.sh) 12 dosya/56 test — hepsi geçti; server typecheck temiz |
Temizlik: `down -v`, geçici env/parola dosyaları ve curl imajı silindi.

### Açık notlar
- ~~(Bilgi, kabul edilen risk) Edge ağından web:3000'e doğrudan XFF ile IP taklidi.~~ Düzeltme turu 1'de kapatıldı (S-P2-1), aşağıya bakın.
- (backend-dev, Bilgi) Server istek logu `remoteAddress` içermiyor; IP yalnız audit'te görülebiliyor. Operasyonda istemci IP'li iz için req serializer'a `ip` eklenmesi değerlendirilebilir.
- (Bilgi) Seed teknisyen/ADMIN kullanıcısı oluşturmuyor (kullanıcı yönetimi P9); staging'de oturum açabilen kullanıcı için şimdilik elle SQL gerekir.

### Düzeltme turu 1 (S-P2-1, S-P2-2)
**Dosyalar:** `deploy/Caddyfile`, `deploy/docker-compose.yml`, `.env.example`, `.github/workflows/ci.yml` (compose doğrulama adımına sahte `EDGE_PROXY_SECRET` eklendi; eklenmeseydi CI kırılırdı), `apps/web/lib/edge-forward.ts` (yeni) ve testi, `apps/web/lib/server-api.ts`, `docs/runbook.md` (§1, §3, §7).
- **S-P2-1:** Caddy `reverse_proxy web:3000 { header_up X-Edge-Auth {env.EDGE_PROXY_SECRET} }` ile değer atar; bu, istemcinin gönderdiği başlığı ezer. `/api` ve `/ws` isteklerinde `header_up -X-Edge-Auth` ile başlık silinir. Log filtresine `request>headers>X-Edge-Auth delete` eklendi. **Tuzak:** Aynı blokta `header_up -X-Edge-Auth` ve ardından set yazılırsa Caddy silmeyi set'ten sonra uygular ve başlık hiç gitmez. Bu denendi: audit'e .3 yazıldı. Bu yüzden web bloğunda yalnız set kullanılıyor.
  Web tarafında `edge-forward.ts` başlıkları SHA-256 özetleri üzerinden `timingSafeEqual` ile karşılaştırır, böylece uzunluk bilgisi de sızmaz. Eşleşirse XFF'in ilk öğesi `isIP` ile doğrulanıp iletilir; eşleşmezse XFF gönderilmez. `readEdgeSecret` production'da 32 karakterden kısa ya da eksik sırda hata fırlatır. Bu kontrol `next build` sırasında patlamasın diye ilk kullanımda yapılır. Compose caddy ve web için `:?` ile değeri zorunlu tutar.
- **S-P2-2:** `user-agent` en çok 512 karaktere kırpılarak iletilir. Server bu değeri `audit/service.ts:29` içinde `req.headers["user-agent"]` ile okuyup 300 karaktere keser; server tarafında değişiklik gerekmedi.
- **frontend-dev notu:** `resolveSessionToken`'ın 2. parametresi (`h.get("x-forwarded-for")`) artık **yok sayılıyor** (`@deprecated`). Başlıklar fonksiyon içinde `headers()` ile okunuyor. Bu tur yalnız lib'e dokunulabildiği için `app/session/[token]/page.tsx:26` değiştirilmedi. Bu argüman orada kaldırılmalı.
- **Doğrulama (2026-11-11, temiz yığın, sahte .env scratchpad'de):** `pnpm --filter @remote/web` lint temiz, typecheck temiz, test hepsi geçti (yeni 7 test; tur sonunda 20/20). `caddy validate` geçerli. `docker compose config` sırla geçerli; sır yokken "required variable EDGE_PROXY_SECRET" hatası veriyor. İptal edilmiş oturumlarla (410 → audit) yapılan denemeler:

| Senaryo | Audit `ip_address` / `user_agent` |
|---|---|
| Caddy üzerinden; istemci sahte `X-Forwarded-For: 6.6.6.6` + sahte `X-Edge-Auth` gönderir | `172.30.0.128` (Docker Desktop'ta host; Linux'ta gerçek IP) / tarayıcı UA'sı |
| Edge ağından (172.30.0.50) `web:3000`'e doğrudan; `XFF: 9.9.9.9` + yanlış sır | `172.30.0.3` (web) / gönderilen UA |
| 6.6.6.6 veya 9.9.9.9 audit'te | 0 |
| Sır caddy, web ve server loglarında; istemcinin `X-Edge-Auth` başlığı ve token caddy logunda | 0 / 0 / 0 |

Temizlik: `down -v` yapıldı, geçici env, çerez ve token dosyaları silindi. actionlint yerelde yok; CI'daki değişiklik tek bir `sed -e` satırından ibaret.

## DBA (P3)
- Migration `apps/server/prisma/migrations/20261111020000_p3_session_admit` (+ `down.sql`): `support_sessions.mode`, `consumed_at`, `terminated_by` (FK users RESTRICT, IX) + 5 CHECK (mode enum, consumed⇔mode, ACTIVE⇒consumed / PENDING·EXPIRED·CANCELLED⇒¬consumed, consumed≤expires, ADMIN⇔terminated_by⇒ENDED). Yeni tablo yok; `grants.sql` değişmedi. Nonce/ticket/lobi/admitCode/reconnect bellekte (mimari §3.5).
- Sapma/erteleme: `started_at` eklenmedi (anlamı tanımsız; admit anı `consumed_at`); `end_reason` değer biçimi backend'e bırakıldı (protokoldeki küçük harf önerildi). Mimari §3.1'e not mimar/koordinatör tarafından düşülmeli.
- **Backend-dev yapacak:** `apps/server/test/helpers/app.ts` `createSupportSessionRow`: ACTIVE/ENDED satırda `consumedAt: createdAt, mode: "BROWSER"` ekle — şu an `sessions-public.test.ts` 2 test `consumed_status_chk` ile düşüyor. Admit/terminate/açılış sorgu kalıpları `docs/db-notlari.md` P3.
- Doğrulama: drift 0, up/down/up OK, `deploy/mysql/check-app-grants.sh` 48/48 PASS, typecheck temiz, test:int 60/62 (yukarıdaki yardımcı nedeniyle).

## DBA (P4)
- Migration `apps/server/prisma/migrations/20261111030000_p4_consents` (+ `down.sql`): `consent_texts` (tenant bazlı, sürümlü, değişmez; tenant başına tek `is_current` fonksiyonel UQ; `sha256 = SHA2(body,256)` CHECK) ve `session_consents` (append-only; bileşik FK'lerle oturum/metin/özet aynı tenant'ta) + `support_sessions` UQ(id, tenant_id). Ayrıntı ve sorgu kalıpları `docs/db-notlari.md` P4.
- `grants.sql`: app `consent_texts` SELECT/INSERT, `session_consents` SELECT/INSERT (UPDATE(is_current) P11, retention UPDATE/DELETE P13). `check-app-grants.sh` +19 kontrol.
- Seed: metni olmayan her tenant'a Türkçe KVKK metni v1 (`is_current`) + audit; idempotent, üretimde de çalışır.
- Sapma (mimar §3.1'e not düşmeli): `body` MEDIUMTEXT; `ip/user_agent` NULL'lı; `session_consents` IX(session_id, tenant_id, created_at). Açık nokta: ileride tenant oluşturma servisi v1'i aynı TX'te eklemeli.
- **Backend-dev yapacak:** join'de `consentTextId` zorunlu + `{id, tenantId, isCurrent:true}` kontrolü (400); admit TX'ine `sessionConsent.create` (VIEW/GRANTED/UI, join anındaki textId+sha256); test yardımcılarında tenant için consent text.
- Doğrulama: drift 0, up/down/up OK, check-app-grants 67/67 PASS, test:int 93/93, typecheck/lint temiz.

## DevOps (P3)
**Dosyalar:** `deploy/turn/{docker-compose.yml, docker-compose.test.yml, turnserver.base.conf, entrypoint.sh, denied-peer-ip.local.conf.example, gen-cert.sh, test-denied.sh, test-local.sh}` (yeni), `deploy/docker-compose.yml` (server: `TURN_URLS`/`TURN_SECRET` `:?`, `TURN_CRED_TTL_MIN` 60, `METRICS_TOKEN` opsiyonel), `.env.example` (coturn bölümü; backend'in `TURN_URLS/TURN_SECRET/TURN_CRED_TTL_MIN/METRICS_TOKEN` satırları korundu), `.gitignore` (`deploy/turn/certs/`), `.github/workflows/ci.yml` (yeni `turn` job'ı; build job compose adımına sahte `TURN_URLS`/`TURN_SECRET`), `docs/runbook.md` §9. `Caddyfile` değişmedi: `/ws/*` → server ve `/metrics` 404 P1'de vardı; subprotocol log filtresi mevcut.

**Kararlar / sapmalar**
- coturn ayrı compose projesi (`remote-turn`, mimari §8 ağacı `deploy/turn/docker-compose.yml`); staging'de aynı sunucuda, prod VM'de aynı dosya. Uygulama yığınının `edge` ağına girmez (host network).
- İmaj `coturn/coturn:4.18.0-alpine` digest'le; nobody, salt okunur, `cap_drop ALL` + **`NET_BIND_SERVICE`** (ikili dosya yeteneği taşıyor; olmadan `exec` EPERM — denendi).
- coturn 4.18 farkları: `no-cli` artık hata (CLI varsayılan kapalı), `no-loopback-peers` tanınmıyor (loopback varsayılan yasak + 127/8, ::1 listede), DTLS varsayılan kapalı, TLS ≥ 1.2 varsayılan. `denied-peer-ip` CIDR değil `a-b` aralığıyla yazıldı (ADR izin veriyor).
- **Bulgu (güvenlik ekibine bilgi):** ADR'deki `::/128` satırı (`denied-peer-ip=::`) coturn 4.18'de tüm adresleri reddediyor (1.1.1.1 dahil 403; log `denied in the range: ::`). Satır kaldırıldı; belirsiz adres coturn'ce zaten reddediliyor, `test-denied.sh` `::`'i ayrıca dener (PASS). ADR-0007 listesine not düşülmeli (mimar).
- Secret komut satırına konmaz; `/tmp/turnserver.conf` tmpfs (700) içinde 600. Rotasyon için `TURN_SECRET_PREVIOUS` (coturn çoklu `static-auth-secret` kabul ediyor — testte doğrulandı).
- `entrypoint.sh` her TURN VM'de relay↔relay için `allowed-peer-ip=<public IP>` ekler (mimari §8.3 G-05 notu); bu IP local listede de olsa allowed öncelikli (testte doğrulandı).
- Prometheus 9641 varsayılan `127.0.0.1`; dış scrape yok (UFW kapalı). Server `rs_turn_allocations` için ayrı scrape P13'e kalır.
- Test için `TURN_TEST_MAX_PORT` (yalnız `docker-compose.test.yml`): 40 portluk aralık ~60 negatif denemeye yetmiyor (allocation 600 sn yaşar → 508). Staging'de aralık değişmez; `test-denied.sh` 508'de bekleyip tekrar dener (runbook §9.7).
- Staging'e yayın yapılmadı (paket denetimi sonrası). UFW/NAT adımları runbook §9.2/9.3'te; NAT talebi ağ yöneticisine.

**Doğrulama (2026-11-11, yerel Docker 29.8 / macOS):** `./test-local.sh` → **57 PASS, 0 FAIL**: HMAC UDP/TCP/TLS(5349, IP SAN'lı staging CA) allocation, kontrol peer'ları 1.1.1.1 ve 2606:4700:4700::1111 izinli, yanlış secret ve süresi geçmiş username reddedildi, base + örnek local listedeki her satırın ilk/son adresi 403 (IPv4 14 aralık, IPv6 10 aralık + `::`). `TURN_SECRET_PREVIOUS` ile üretilen credential kabul edildi. Prometheus iç ağdan `turn_*` metrikleri döndü. Entrypoint fail-closed: kısa secret ve eksik local dosya → başlamadı (exit 1). `docker compose config` (ana + turn) sahte değerlerle geçerli, `TURN_EXTERNAL_IP` yokken `:?` hatası; `caddy validate` geçerli; ci.yml YAML geçerli (actionlint yerelde yok). Test konteyner/ağları kaldırıldı.

**backend-dev ile uyuşma:** env adları `TURN_URLS`, `TURN_SECRET`, `TURN_CRED_TTL_MIN`, `METRICS_TOKEN` (env.ts ile aynı). Uyumsuzluk: env.ts `TURN_SECRET` min 16, coturn entrypoint ≥ 32 ister → env.ts min 32'ye çekilmeli (öneri). Credential algoritması test-denied.sh'ta `user=<unixExpiry>:<id>`, `pass=base64(HMAC-SHA1(secret,user))` ile doğrulandı — `signaling/turn.ts` aynı biçimi kullanmalı.

### DevOps (P3) — Düzeltme turu 1 (güvenlik "P3 kod turu", ADR-0007 r5)
**Dosyalar:** `deploy/turn/host-firewall.sh` (yeni), `deploy/turn/{entrypoint.sh, docker-compose.yml, test-denied.sh, test-local.sh}`, `deploy/docker-compose.yml`, `.github/workflows/ci.yml` (turn job: `host-firewall.sh` sözdizimi + `print`), `docs/runbook.md` §9 (9.2.1–9.2.3, 9.7, 9.8, 9.8.1).
- **S-P3-2 (Orta):** `host-firewall.sh apply|ensure|check|remove|install|uninstall|print` — filter/OUTPUT başına tek atlama → `REMOTE-TURN-OUT`: UDP `--sport 49160:49199`, hedef public/özel IP + `addrtype LOCAL`, `! --dport 49160:49199` → DROP (IPv4; ip6tables varsa IPv6 LOCAL + `TURN_FW_SELF_IPS`). Aralık base.conf'tan okunur. Yan etkiyi daraltmak için aralık `ip_local_reserved_ports`'a eklenir (mevcut liste korunur, remove'da yalnız bizim aralık çıkar) → aralıktan kaynak port yalnız coturn'de. Kalıcılık: systemd `remote-turn-fw.service` (oneshot `ensure`) + `.timer` (açılış + 5 dk) — UFW reload/disable atlamayı silerse onarır; UFW before.rules seçilmedi (UFW yönetimine bağımlı olur, ufw disable'da kural da gider). Docker/UFW zincirlerine dokunulmaz.
- **S-P3-3:** entrypoint `relay-ip=<TURN_EXTERNAL_IP iç kısmı>` (public-only'de public) → IPv6 relay 440. `test-denied.sh`: kontrol peer'ı IPv6 testi "IPv6 relay allocation reddedildi" negatifine çevrildi; IPv6 denied satırları 403 **veya** 440/443 kabul (ikisi de erişilemez); host'ta global IPv6 yoksa INFO gerekçesi (staging S-P2-5). Prod IPv6 doğrulaması P13.
- **S-P3-6:** `deploy/docker-compose.yml` `TURN_CRED_TTL_MIN` varsayılanı 60 → 20 (env.ts ile aynı); runbook tablo + rotasyon adımı güncellendi.
- **S-P3-9:** json-file 5×10 MB → 3×5 MB; süre tavanı haftalık cron (aktif log boşaltılır, döndürülmüş dosyalar silinir → ≤ 7 gün), KVKK notu runbook §9.8.1. Log seviyesi zaten normal; entrypoint base.conf'ta `cli*`/`verbose`/`log-binding` görürse başlamaz.
- **CLI/no-cli:** güvenlik raporu `no-cli` eklenmesini öneriyordu; koordinatör/ADR-0007 r5 m.3 gereği **eklenmedi**. Yerelde doğrulandı: 4.18 `no-cli` ile `ERROR no-cli option is deprecated, see --cli` basıyor (süreç çalışıyor, CLI zaten kapalı). Kanıt çalışma zamanında: `test-local.sh` konteynerde 5766 dinlenmiyor (PASS); staging için runbook §9.2.3 kontrol listesi (`ss -tlnp`: 5766 yok, 9641 yalnız 127.0.0.1; `ss -ulnp` çıktısı test raporuna).
- Metrik adları runbook §9.8'de backend'e uyarlandı: `rs_resolve_failed` (eski `_total` değil), `rs_ws_connections`, `rs_active_sessions`.

**Doğrulama (2026-11-11, yerel Docker / macOS):** `./test-local.sh` → **62 PASS, 0 FAIL** (+ yerel ön kontroller: 5766 yok, 9641 var, `host-firewall.sh` iki kez apply → 2 kural/1 atlama). Bölüm 4 coturn ağ ad alanında yardımcı konteynerle (NET_ADMIN): kendi IP'sine aralık içi port (49990) echo döndü; aralık dışı 3480 echo yok + DROP +1; `:3478` DROP +1; `:53` DROP +1. Ayrıca ayrıcalıklı konteynerde tam yaşam döngüsü: check(önce)=1 → apply×2 → OK, IPv4 3 / IPv6 2 kural / 1 atlama, reserved `1000-1010,49160-49199` (mevcut değer korundu) → atlama elle silinince `ensure` onardı → remove sonrası reserved `1000-1010`, zincir yok. `install` (systemd) macOS'ta denenemedi — staging yayınında `systemctl is-active remote-turn-fw.timer` ile doğrulanacak (runbook §9.2.3). Staging'e yayın yapılmadı.

### DevOps (P3) — Düzeltme turu 2 (güvenlik "P3 Tur 2" Düşük: S-P3-T2-1, S-P3-T2-2)
**Dosyalar:** `deploy/turn/host-firewall.sh`, `deploy/turn/entrypoint.sh`, `docs/runbook.md` §9.2.1/§9.2.3.
- **S-P3-T2-1:** apply kuralları `REMOTE-TURN-OUT-NEW`'de kurar; hata olursa geçici zinciri siler, eski zincir/atlama korunur (fail-closed). Başarıda yeni atlama önce eklenir, eski silinir, `-E` ile yeniden adlandırılır. IP doğrulaması `case` + oktet (0..255, baştaki sıfır yok) / IPv6 grup-`::` kuralı; çok satırlı/CR değer reddi. `entrypoint.sh`'te aynısı + config'e yazılan tüm env'ler (`TURN_REALM`, `TURN_TEST_MAX_PORT`, `TURN_PROMETHEUS_ADDRESS`…) için yeni satır reddi, `TURN_REALM` boşluk/`#` reddi. Reserved ports: kapsama kontrolü; remove eklemeden önceki listeyi saklayıp yalnız bizim portları çıkarır. `ensure` sapma/onarım hatasını journald'a `<3>` (err) ile yazar, onaramazsa exit 1. Ek düzeltme: runbook `TURN_FW_SELF_IPS`'i `.env`'de söylüyordu ama betik okumuyordu → artık okunuyor.
- **S-P3-T2-2:** `install` → `/usr/local/sbin/remote-turn-fw` (root:root 0755, `install -o root -m 0755` + atomik mv), `/etc/default/remote-turn-fw` (root 0644, yalnız IP/port; görevdeki 0644 seçildi — secret yok). Birim yalnız kurulu kopyayı çalıştırır; kurulu kopya yalnız bu dosyayı okur, sahibi root değilse/g-o yazabiliyorsa çalışmaz. `uninstall` hepsini + `/var/lib/remote-turn-fw` siler. Runbook: betik/.env değişince `install` yeniden.
- **Doğrulama (yerel):** `bash -n`/`sh -n` temiz; `print` (staging + CI girdisi) beklenen 3+1 kural. busybox'ta 21 doğrulama vakası + entrypoint 7 vaka (çok satırlı IP/realm/test port/prometheus → başlamadı). Ayrıcalıklı Ubuntu 24.04: apply×2 → 3 kural/1 atlama/NEW yok; enjekte `-A` hatası → exit 1, eski zincir ve atlama yerinde, check OK; ensure onarım + `<3>` öneki; onaramayınca exit 1; çekirdeğin birleştirdiği `49100-49250` üzerinde check OK, remove → `49100-49159,49200-49250`; önceden örtüşen `49150-49170` korundu; kurulu kopya `/etc/default`'tan okudu, 0664 ve root dışı sahip reddedildi. `./test-local.sh` → **62 PASS, 0 FAIL** (+3 ön kontrol). systemd `install` macOS'ta denenemedi → staging yayınında runbook §9.2.3 (`ExecStart`, `cmp`, `is-active`). Staging'e dokunulmadı.

## Backend (P3) — sinyalizasyon sunucusu (2026-11-11)
Durum: **tamam** (kod + testler yeşil). Kalanlar aşağıda "Kalan / sonraki paket".

### Dosyalar
- `packages/contracts/src/ws.ts` (yeni; `./ws` export) — WS mesaj şemaları tek kaynak (strict, discriminatedUnion), kapanış kodları, ended reason listesi, WS hata kodları. `packages/contracts/fixtures/ws-messages.json` (geçerli/geçersiz örnekler; Go P6 aynı dosyayı kullanır).
- `packages/contracts/src/api/sessions.ts` — resolve yanıtına `joinNonce`, `nonceExpiresAt`; `joinSessionInputSchema`/`JoinSessionResponse`; `terminateSessionInputSchema`/`TerminateSessionResponse`. `errors.ts` — `LOBBY_FULL` (409), `NONCE_INVALID` (410).
- `apps/server/src/signaling/{types,store,turn,rooms,active,admit,handlers,ws}.ts` — oda/lobi durum makinesi, tek kullanımlık nonce/ticket deposu, TURN HMAC, max süre/120 sn/ICE yenileme zamanlayıcıları, admit/reject (tek atomik UPDATE), mesaj doğrulama + relay + token-bucket, upgrade/auth/ping/60 sn yeniden doğrulama.
- `apps/server/src/public/service.ts` — join (nonce → checkPublicClient(nonce.kind) → PENDING okuma → lobi + ticket + admitCode, audit `guest.pending`), `issueJoinNonce`.
- `apps/server/src/ops/metrics.ts` — `/metrics` (Bearer `METRICS_TOKEN`).
- `apps/server/src/sessions/{repo,service,routes,public}.ts` — `consumeForAdmit`, `endActive`, `terminateActive`, `endAllActive`, `findForSignal`, `maxActiveHours`; `terminateSession`, `endOrphanedActive`; cancel artık odaya `session.ended{cancelled}` bildirir; POST `/sessions/:id/terminate`, POST `/public/sessions/join`; resolve `checkOrigin` → `checkPublicClient` (ADR-0012).
- `apps/server/src/auth/guards.ts` — `checkPublicClient(req, kind)` + saf `publicClientAllowed(headers, allowedOrigins, kind)` (WS upgrade'de de kullanılır).
- `apps/server/src/env.ts`, kök `.env.example` — `TURN_URLS`, `TURN_SECRET` (≥ 32 karakter, devops coturn başlatıcısıyla uyumlu; turn:/turns: URL varsa zorunlu), `TURN_CRED_TTL_MIN` (5..60, vars. 60), `METRICS_TOKEN` (opsiyonel, ≥ 16). Credential biçimi devops `test-denied.sh` ile aynı: username=`<unixExpiry>:<sessionId>`, credential=base64(HMAC-SHA1(TURN_SECRET, username)).
- `apps/server/src/app.ts` — `rooms`, `metrics` dekorasyonu, `attachSignaling`, açılışta ACTIVE → ENDED{server}.
- Testler: `test/helpers/{ws,signal-flow}.ts`, `test/integration/signaling-{rooms,ws,lifecycle}.test.ts`, `test/unit/{signaling,ws-fixtures}.test.ts`; `test/helpers/app.ts` (createSupportSessionRow ACTIVE/ENDED için `consumedAt`+`mode`; makeApp `signaling` seçeneği), `tenant-matrix.ts` (3 yeni rota + terminate çapraz tenant).

### Sözleşme (frontend-dev / P4 için)
- Resolve: `{ ..., joinNonce, nonceExpiresAt }`; tarayıcı `clientKind: "BROWSER"` + Origin, agent `AGENT` + Origin'siz.
- Join: `POST /api/v1/public/sessions/join { joinNonce, customerName(2..100), customerEmail?, consentTextId?, consentAccepted: true }` → `{ wsTicket, admitCode, technicianName }`. Hatalar: 400, 403 `CSRF_INVALID` (istemci türü) / `FORBIDDEN` (ret listesi), 409 `LOBBY_FULL`, 410 `NONCE_INVALID`/`SESSION_*`, 429 (20/dk/IP).
- WS misafir: `new WebSocket(wss://host/ws/guest, ["rs.v1", "rs.ticket."+wsTicket])` → `lobby.wait` → (admit) `hello{iceServers, reconnectToken, caps, maxEndsAt}`. Yeniden bağlanma: `["rs.v1","rs.reconnect."+token]`; her hello yeni token verir.
- WS teknisyen: `/ws/tech?sessionId=<id>` (çerez + Origin); PENDING'de `hello{iceServers: [], maxEndsAt: null}`, lobi için `peer.pending`/`peer.pending.left`; `guest.admit{admitCode}` → `peer.joined{role:"guest", guestKind}` + `ice.servers`; hatalar `error{code: ADMIT_CODE_INVALID|CONFLICT|NOT_FOUND}`.
- Terminate: `POST /api/v1/sessions/:id/terminate { reason? }` → `{ status:"ENDED", endedBy:"ADMIN" }` (sessions.terminate; 404 başka tenant, 409 ACTIVE değil).
- Kapanış kodları: 1000 normal, 1008 politika, 4401 auth_revoked, 4409 teknisyen başka sekmeden bağlandı.

### Tasarımdan sapmalar (gerekçeli)
1. `hello.maxEndsAt` **nullable**: PENDING oturumda teknisyen hello'sunda max süre henüz yok (başlangıç = admit). Teknisyene de iceServers PENDING'de boş; admit sonrası `ice.servers` ile gelir (TURN yalnız admit sonrası kuralının teknisyen tarafına da uygulanması).
2. `peer.joined` ek alan `guestKind?` (A1/A2 akış diyagramlarında var, protokol tablosunda yoktu).
3. `consentText` (resolve) ve `consentTextId` doğrulaması **P4'e** bırakıldı: `consent_texts`/`session_consents` tabloları P4'te (db-notlari P3). Join şemasında `consentTextId` şimdilik opsiyonel; P4 zorunlu yapar. Admit TX'inde consent kaydı yok (yalnız UPDATE + audit).
4. Public uç dosya yerleşimi: rotalar P2'deki gibi `sessions/routes.ts` `publicSessionRoutes` içinde; join servisi `public/service.ts`. Mimari §6'daki `public/routes.ts` ayrı dosyası açılmadı (tek rota için kopya kayıt gereksiz).
5. Ek dosyalar `signaling/{types,store,active,admit}.ts` (≤150 satır kuralı; rooms.ts'i bölmek için).
6. `maxPayload`: ws kütüphanesi sınırı 1 MB (bellek tavanı, aşımda ws 1009); 64 KB üstü kendi kontrolümüzle 1008. Yani 64 KB–1 MB arası kontrollü 1008 (AC-17), 1 MB üstü 1009.
7. `prom-client` eklenmedi; /metrics küçük elde yazılmış sayaç/gösterge (yalnız counter+gauge gerekiyor). `rs_resolve_failed` gauge olarak yayınlanır (süreç sayacı). `METRICS_TOKEN` yoksa `/metrics` 404 (env opsiyonel; devops compose'da verirse açılır).
8. `end_reason` biçimi: protokoldeki küçük harf değerler (`tech`, `customer`, `timeout`, `max_duration`, `admin`, `auth_revoked`, `server`). §3.5/A4 metnindeki `TIMEOUT`/`SERVER_RESTART` büyük harf yazımları bu değerlere karşılık gelir (dba kararı ile uyumlu). `ended_by`: teknisyen TECH, müşteri CUSTOMER, zaman aşımı/max süre/auth_revoked/açılış SYSTEM, terminate ADMIN.
9. Açılışta ACTIVE → ENDED{server} toplu UPDATE; oturum başına audit yazılmaz, yalnız log (sayı). `started_at` yok (consumed_at = başlangıç, dba kararı).
10. Teknisyen `session.end` PENDING oturumda → `error{CONFLICT}` (bekleyen oturum REST iptal ile kapanır).
11. Teknisyen yeniden bağlanması eski soketi 4409 ile kapatır (sayfa yenileme/ikinci sekme); çakışma reddi yalnız misafir reconnect'inde (G-10).
12. join hız sınırı 20/dk/ipKey ve /ws/guest upgrade 30/dk/ipKey (mimaride sayı yoktu; resolve kovalarından bağımsız, en basit güvenli değer).
13. Admit yarışı: aynı oda içinde ikinci admit bellek bayrağıyla (`room.admitting`) DB'ye gitmeden CONFLICT + audit fail alır; DB düzeyi tek kazanan ayrıca repo testinde (consumeForAdmit ‖ consumeForAdmit ×50) ve admit ‖ cancel ×50 ile doğrulandı.

### Bağımlılıklar
- `ws@8.18.3` (mimari §10.4 onaylı), `@types/ws@8.18.1` (dev). Başka bağımlılık yok.

### Testler
Komutlar: `pnpm -r run lint` · `pnpm -r run typecheck` · `pnpm --filter @remote/server test` · `eval "$(apps/server/scripts/test-db.sh up)" && pnpm --filter @remote/server test:int`.
Son çıktı: lint temiz, typecheck temiz (3 paket), unit **69/69**, entegrasyon **85/85** (15 dosya; P3 yeni: signaling-rooms 9, signaling-ws 7, signaling-lifecycle 7 + tenant-matrix'e 3 rota). Kapsanan: iki sahte istemci offer/answer/ICE/share.state aktarımı, çapraz oturum sızıntısı yok, lobi (≤3, LOBBY_FULL, 5 hatalı kod, ret listesi, lobby_timeout, ticket 60 sn), admit öncesi iceServers yok, admit‖admit ve admit‖cancel 50'şer tur (tek kazanan, tek audit), süresi dolmuş admit, reconnect (çakışma 403 + audit, yeni token, eski token geçersiz), 120 sn timeout (sahte saat), max süre uyarı + bitiş (sahte saat) + ICE yenileme, terminate (403/409/200 + DB ADMIN/terminated_by + audit), auth iptali → 4401, 1008 durumları (JSON, ekstra alan, 64 KB, 50/sn, lobi misafiri SDP), upgrade retleri (sorgu dizesi, rs.v1 yok, ticket tekrar, izinsiz Origin, sahip olmayan teknisyen, çerezsiz), ADR-0012 matrisi, /metrics 404/401/200, fixture uyumu.

### Kalan / sonraki paket
- Ping/pong (30 sn, 2 kaçırma → terminate) kodda var, otomatik testi yok (ws istemcisi pong'u otomatik yanıtlar; test için soket duraklatma gerekir).
- `rooms.endByTechnician(userId)` hazır ama henüz çağıran uç yok (logout-all/deactivate/reset-mfa P9/P10); şimdilik 60 sn yeniden doğrulama G-04'ü karşılar. `applyPermChange`/`caps.update` P7/P9.
- Expiry işi (PENDING → EXPIRED) lobi misafirlerine anında bildirim göndermez; misafir 5 dk lobi süresiyle ya da admit denemesinde (`session.ended{timeout}`) düşer.
- Bekleyen oturumda teknisyenin auth'u iptal edilirse oda kapanır ama DB'de oturum PENDING kalır (süre dolumu kapatır).
- coturn tarafı (`deploy/turn/*`, `turnutils_uclient`, `test-denied.sh`) devops işi.

### Düzeltme turu 1 (qa-raporu QA-P3-1..5, güvenlik S-P3-1/4/5/6/7) — 2026-11-11
Sapma 6 ve 7 ile "Kalan" maddelerindeki ping/pong, endByTechnician testi ve expiry bildirimi aşağıdaki değişikliklerle **geçersizdir**.

| Madde | Değişiklik |
|---|---|
| S-P3-1 | `ws` 8.18.3 → **8.21.0** (`apps/server/package.json`, `pnpm-lock.yaml`); `pnpm audit`: **No known vulnerabilities**. `signaling/ws.ts` `maxPayload = WS_MAX_PAYLOAD` (64 KB): aşan çerçeve artık ws tarafından **1009** ile kapanır (eski sapma 6 kalktı; handlers.ts'teki 1008 kontrolü savunma olarak duruyor). Sunucu soketine `error` dinleyicisi eklendi (1009 durumunda dinleyicisiz `error` olayı süreci düşürüyordu — entegrasyon testinde "Unhandled Error" olarak yakalandı); yalnız `role` + hata kodu loglanır. |
| S-P3-4 | `expireDue(db, ctx, now, rooms?, batch)` başarılı her expiry'den sonra `rooms.closeSession(id, "timeout")` → teknisyen + lobi `session.ended{timeout}`, oda silinir. `RoomNotifier` reason'a `"timeout"` eklendi; `startScheduler(db, log, rooms?, intervalMs)` (app.ts `rooms` geçirir). `Room.expiresAt` eklendi: ret listesi / hatalı kod taşıyan boş oda yalnız PENDING bitişine kadar tutulur, `timers.idle` ile o anda yeniden kontrol edilip silinir. |
| S-P3-5 | Tüm sahte secret'lar tek dosyada: `apps/server/test/helpers/secrets.ts` (`FAKE_TURN_SECRET*`, `FAKE_METRICS_TOKEN`); `.gitleaks.toml` allowlist `(^|/)apps/server/test/helpers/(app|secrets)\.ts$` (dir ve git modunda eşleşir). gitleaks v8.30.1 dir taraması: 10 bulgu, **hepsi `apps/web/.next/**`** (git-ignore, derleme çıktısı); commit edilecek dosyalarda **0**. |
| S-P3-6 | `TURN_CRED_TTL_MIN` varsayılanı **20** (env.ts, `.env.example` açıklaması). Compose varsayılanı devops tarafından zaten `${TURN_CRED_TTL_MIN:-20}`. **devops:** `docs/runbook.md:181` tablosu hâlâ "60 (5..60)" diyor → 20 olmalı (bu turda runbook'a dokunulmadı). |
| S-P3-7 | `/ws/tech` upgrade'i IP başına `FixedWindowCounter(31, 60 sn, 60 sn kilit)` — Origin/çerez/DB kontrollerinden **önce**; aşımda 429 (`rs_ws_rejected_total{role="tech",reason="rate"}`). Misafir sayacından ayrı. |
| QA-P3-1 | Join'de 410 (`SESSION_EXPIRED/CONSUMED/CANCELLED`, `addGuest` içinden gelen `SESSION_CONSUMED` dahil) → audit `session.join` `result=fail`, `newValue {reason}` (token/kod/ad yok). Nonce tek kullanımlık + IP limitli olduğundan tekilleştirme yok. |
| QA-P3-2 | Ping/pong testi (pingMs 50, `autoPong:false` soket → 1006 terminate, pong veren soket açık); AC-120 log tarama testi (gerçek `createLogger("trace", sink)`; joinNonce, wsTicket, iki reconnectToken, link token, auth token, admitCode (hatalı kod denemesi dahil) ve alan adları logda yok; sorguda sızmış ticket 403); `signaling.test.ts` test adı AC-18. |
| QA-P3-3 | `/metrics`: `rs_ws_connections` (gauge, `wss.clients.size`), `rs_active_sessions` (gauge, admit edilmiş ve bitmekte olmayan oda), `rs_resolve_failed_total` → **`rs_resolve_failed`** (gauge; `_total` soneki kaldırıldı). `rs_active_rooms` ve `rs_ws_connections_total` (counter) duruyor. **devops:** alarm/panel bu adı kullanıyorsa güncellenmeli. |
| QA-P3-4 | `guest.pending` audit testi (1 kayıt, yalnız `guestId/name/guestKind`, admitCode yok). |
| QA-P3-5 | `rooms.endByTechnician` entegrasyon testi (aynı teknisyenin iki ACTIVE odası: 4 tarafa `session.ended{auth_revoked}`, teknisyene 4401, DB ENDED/SYSTEM/auth_revoked + 1'er audit). Çağıran uç P7/P9'da (S-P3-8). |

Değişen dosyalar: `apps/server/{package.json, src/signaling/{ws,rooms,types}.ts, src/sessions/{service,public}.ts, src/public/service.ts, src/jobs/scheduler.ts, src/app.ts, src/env.ts}`, `.env.example`, `.gitleaks.toml`, `pnpm-lock.yaml`; testler `test/helpers/{secrets(yeni),ws,signal-flow}.ts`, `test/integration/signaling-fix1.test.ts` (yeni, 9 test), `test/integration/signaling-{ws,lifecycle}.test.ts`, `test/unit/{signaling,scheduler}.test.ts`. packages/contracts değişmedi.

Sözleşme etkisi (frontend-dev): 64 KB üstü mesajda kapanış kodu artık **1009** (1008 değil). Bekleyen oturumun süresi dolunca teknisyen ve lobi `session.ended{reason:"timeout"}` alır (30 sn expiry turu gecikmesiyle). `/ws/tech` çok sık yeniden denemede HTTP 429.

Komutlar ve son çıktı: `pnpm -r run lint` temiz · `pnpm -r run typecheck` temiz (3 paket) · unit **69/69** · entegrasyon **93/93** (16 dosya; iki kez koşuldu, ikisi de yeşil, unhandled error yok) · `pnpm audit` temiz · gitleaks (commit edilecek dosyalar) 0.

## Backend (P4) — karşılama onayı, consent kaydı (2026-11-11)

### Sözleşme (P4) — frontend-dev için (erken yazıldı)
- **POST `/public/sessions/resolve`** yanıtına eklendi (`ResolveSessionResponse`, `@remote/contracts/api/sessions`):
  - `consentText: { id, version, body, sha256 }` (`ConsentTextView`) — tenant'ın `is_current` sürümü. `body` düz metindir; `textContent`/`white-space: pre-line` ile basın (HTML değil).
  - `abuseEmail: string | null` — "Kötüye kullanımı bildir" `mailto:` adresi (AC-125): sunucu env `ABUSE_EMAIL`, yoksa ilk aktif Super Admin e-postası (V13); ikisi de yoksa `null` → bağlantıyı gizleyin.
  - Tenant'ın güncel metni yoksa (seed eksik) 500 `INTERNAL` (loglanır; müşteriye ayrıntı yok).
- **POST `/public/sessions/join`** gövdesi: `consentTextId` artık **zorunlu** (ULID, 26 karakter). Resolve'daki `consentText.id` aynen gönderilir. Yanlış / eski sürüm / başka tenant'ın metni → **400 `VALIDATION`**, `fields.consentTextId` = "Aydınlatma metni güncellendi; sayfayı yenileyip tekrar onaylayın." (G-24, AC-127). Diğer alanlar ve yanıt değişmedi (`customerName` 2..100, `consentAccepted: true`, `customerEmail?`).
- **Onay kaydı:** misafir admit edildiğinde (WS `guest.admit`) sunucu aynı TX'te `session_consents` satırı yazar (VIEW/GRANTED/UI, metin id + sha256, join anındaki zaman/IP/UA) ve audit `guest.admitted` `newValue.consent = { textId, version, sha256 }` (AC-29). İstemcinin ek bir çağrısı yok.
- **WS (değişiklik yok, P3'teki gibi):** müşteri `share.state{state:"sharing"|"stopped"}` gönderir → teknisyene aynen (alanlar yeniden kurularak) iletilir (AC-31); `session.end` (iki taraf) → iki tarafa `session.ended{tech|customer}`; Admin `POST /sessions/:id/terminate` (`sessions.terminate` yetkisi, ADMIN aynı tenant / SUPER_ADMIN) → `session.ended{admin}` (AC-114). Lobideki misafir yalnız `session.end` gönderebilir.
- **`@remote/contracts/dc`** (yeni): `DC_LABELS {ctl,file,input}`, `DC_CTL_MAX_BYTES` (16 KB), `dcEnvelopeSchema` (`{t, id?}`), `parseDcEnvelope(raw)` (null → düşür). Tipe özgü ctl mesajları P5.
- **Dolandırıcılık uyarısı metni** (AC-125) sabit UI metnidir; sunucudan gelmez.

### Dosyalar
- Yeni: `apps/server/src/public/consent.ts` (güncel metin, join doğrulaması, admit TX onay kaydı, abuse adresi), `packages/contracts/src/dc.ts`, `apps/server/test/integration/consent-p4.test.ts`, `apps/server/test/unit/dc.test.ts`.
- Değişen: `packages/contracts/src/api/sessions.ts` (ConsentTextView, resolve `consentText`/`abuseEmail`, join `consentTextId` zorunlu ULID), `packages/contracts/package.json` (yalnız `"./dc"` export satırı — web'in import edebilmesi için gerekli), `apps/server/src/env.ts` (`ABUSE_EMAIL?`), `sessions/public.ts` + `sessions/routes.ts` (resolve), `public/service.ts` (join: nonce → oturum durumu → `acceptConsent` → lobi; audit `guest.pending` + consentTextId/version), `signaling/{types,rooms,admit}.ts` (Guest.consent; admit TX: `consumeForAdmit` count=1 → `session_consents` → audit `guest.admitted` + consent özeti), test yardımcıları (`createTenant` v1 güncel metin ekler; `createConsentText`, `currentConsentId`; `techSession().consentTextId`; `roomFixture().consent`), P3 testlerinde join gövdesine `consentTextId`, admit yarış testlerine consent sayımı.

### Tasarımdan sapmalar / kararlar (gerekçeli)
1. **Resolve yanıtına `abuseEmail`** (mimari-api'de yok): AC-125 `mailto:` adresi web'e başka yoldan gelmiyordu; V13 gereği `ABUSE_EMAIL`, yoksa ilk aktif Super Admin e-postası. **devops:** `ABUSE_EMAIL` → `.env.example` (boş) + `deploy/docker-compose.yml` server servisi + runbook (env.ts eklendi; ben deploy'a dokunmadım). **mimar:** mimari-api resolve satırına `abuseEmail` notu.
2. **Join'de 400 nonce'u yakar:** nonce tek kullanımlık ve consent kontrolü nonce alındıktan sonra yapılır; istemci 400'de yeniden resolve edip güncel metni göstermeli (zaten "sayfayı yenileyin" akışı).
3. **Eski/başka tenant/bilinmeyen id ayırt edilmez** (hepsi aynı 400 + `fields.consentTextId`) — tenant varlığı sızmaz.
4. **Onay zaman çizelgesi ucu (AC-62) eklenmedi:** mimari §10.2'de AC-62 P8 satırında; P4 yalnız kaydı yazar (sorgu kalıbı db-notlari'nde hazır). GET `/sessions/:id` değişmedi (konsol açılışı mevcut `SessionView` + WS `hello`/`peer.pending` ile yeterli).
5. **Müşteri adı DB'ye yazılmaz:** `support_sessions.customer_*` sütunları P4 migration'ında yok (P8); ad lobide bellekte ve audit `guest.pending`/`guest.admitted`'da.
6. **share.state, session.end (iki taraf), terminate** P3'te kurulmuştu; P4'te yalnız testle doğrulandı (AC-31/32/59/114 — başka tenant Admin 404, USER 403).
7. Tenant'ın güncel metni yoksa resolve 500 (bilinmeyen hata yolu: loglanır, referans ID; müşteriye ayrıntı yok). Yeni tenant servisi gelene dek `pnpm db:seed` v1'i ekler (db-notlari P4 #6).
8. `dc.ts` UTF-8 bayt sayımı elle (contracts tsconfig'inde DOM/Node lib yok; TextEncoder kullanılamadı).

### Bağımlılıklar
Yok.

### Testler (2026-11-11, temiz `test-db.sh up` → sonra `down`)
`pnpm typecheck` + `pnpm lint` (server, contracts) temiz; `pnpm test` 71/71 (server unit), contracts 2/2; `pnpm test:int` **99/99** (17 dosya). Yeni: AC-127 resolve metni + ABUSE_EMAIL; AC-127/G-24 consentTextId yok/eski sürüm/başka tenant/bilinmeyen → 400 VALIDATION, doğru → 200, join'de consent satırı yok; AC-29 admit → tek VIEW/GRANTED/UI satırı (metin id + sha256 + IP + UA, join anı ≤ consumed_at) + audit özeti; admit‖admit ve admit‖cancel 50 tekrarında consent sayısı = kazanan admit sayısı (kaybeden/geri alınan TX yazmaz); AC-31 share.state stopped→sharing; AC-32/59 müşteri session.end; AC-114 tenant sınırı/USER 403; dc zarfı unit.
**Not:** `apps/web` typecheck şu an frontend'in devam eden işinden (`components/guest/share-strip.tsx` i18n anahtarları `gs.*`) kırmızı — backend sözleşmesiyle ilgisiz.

### Düzeltme turu 1 (S-P4-1, S-P4-3, QA-P4-12) — 2026-11-11
- **S-P4-1:** `abuseEmail(db, { fromEnv, superAdminFallback })` (`public/consent.ts`); `routes.ts` `superAdminFallback = NODE_ENV !== "production"`. Production'da `ABUSE_EMAIL` yoksa resolve `abuseEmail: null` (Super Admin sorgulanmaz bile). `ABUSE_EMAIL` formatı env.ts'te `z.email().max(190)` (zaten vardı; testle sabitlendi). Not: compose'da `ABUSE_EMAIL=` boş dize olarak geçilirse e-posta doğrulaması başlatmayı durdurur — devops değişkeni tanımsız bırakmalı.
- **S-P4-3:** `joinSessionInputSchema.customerName` (contracts): trim'den **önce** `UNSAFE_NAME_CHARS` refine — C0/C1 (U+0000–001F, U+007F–009F), U+200B–200F, U+202A–202E, U+2066–2069, U+FEFF → 400 `VALIDATION` `fields.customerName`. Baştaki/sondaki `\n`/`\t` da reddedilir (kontrol karakteri). Trim sonrası < 2 → 400 (boş/boşluklu ad).
- **QA-P4-12 (sözleşme, frontend için):** `serverOutboundSchema`:
  - `hello` (yalnız role=tech, admit edilmiş misafir varken): `guestName?: string(≤100)`, `share?: { state, monitors?, activeMonitor? }`. PENDING oturumda ikisi de yok; `share` misafir hiç `share.state` göndermediyse yok.
  - `peer.joined{role:"guest"}` (admit + misafir yeniden bağlanma): `guestName?`.
  - Sunucu: ad = admit edilen lobi misafirinin adı (`room.admitted.name`, peer.pending'deki ad); `room.share` misafirin son `share.state`'i; misafir koparsa `{state:"stopped"}`; oturum bitince oda silinir. `ShareSnapshot` tipi contracts'tan export; `fixtures/ws-messages.json`'a iki örnek eklendi.
- **Boş env (devops isteği):** `loadEnv` ayrıştırmadan önce boş/yalnız boşluk değerleri atar (tanımsız sayılır). Compose `${METRICS_TOKEN:-}`, `${ABUSE_EMAIL:-}` vb. artık sunucuyu durdurmaz; varsayılanlı alanlar (`TURN_CRED_TTL_MIN`, `LOG_LEVEL` …) varsayılana düşer. Zorunlu alanlar (prod'da `SESSION_REF_KEY`/`TRUSTED_PROXY_CIDR`, her ortamda `DATABASE_URL`) boşken yine hata verir. Birim test +2 (`env-logger.test.ts`). Yukarıdaki "`ABUSE_EMAIL=` boş dize" notu bununla geçersiz.
- Dosyalar: `packages/contracts/src/{ws.ts,api/sessions.ts}`, `packages/contracts/fixtures/ws-messages.json`, `apps/server/src/{env.ts,public/consent.ts,sessions/public.ts,sessions/routes.ts}`, `apps/server/src/signaling/{types,active,rooms,handlers}.ts`, testler `test/unit/env-logger.test.ts` (+3), `test/integration/consent-p4.test.ts` (+4).
- Komutlar: `pnpm -r run lint` · `pnpm -r run typecheck` temiz; `pnpm -r run test` contracts 2, server unit **76**, web 42 geçti; `eval "$(apps/server/scripts/test-db.sh up)" && pnpm --filter @remote/server test:int` → 17 dosya, **103/103**; konteyner silindi. Bağımlılık yok.
- **Düzeltme turu 2 (S-P4-T2-1, S-P4-T2-2):** `UNSAFE_NAME_CHARS` Unicode kategori tabanlı `/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u034F\u180E]/u` (U+00AD, U+061C, U+2028/2029, U+2060–2064, U+FFF9–FFFB, etiketler U+E0000–E007F dahil; trim öncesi kontrol korunur; ZWJ'li emoji kabul edilmez) — yeni birim test `packages/contracts/test/sessions.test.ts` (+22), `consent-p4.test.ts` örnekleri genişletildi. `scripts/e2e-real-users.ts` `NODE_ENV=production` kontrolüne ek olarak `E2E_REAL_ALLOW=1` yoksa açıklayıcı hatayla çıkar; `apps/web` `e2e:real:users` bayrağı geçer, `playwright.real.config.ts` notu güncellendi (imajdan `scripts/` çıkarma devops'ta). Sonuç: lint/typecheck temiz; contracts 24, server unit 78, server int 103/103. Sözleşme değişikliği: frontend'de ek iş yok (aynı hata kodu/alan).
- **Sayfa testi düzeltmesi (TEST-P4-2, TEST-P4-1 sunucu tarafı) — 2026-11-11:**
  - **TEST-P4-2 (sözleşme, frontend için):** `peer.joined{role:"guest"}` → `maxEndsAt?: iso` (consumedAt + max_active_hours; guest hello'sundaki değerle aynı). Admit sonrası ve misafir yeniden bağlandığında teknisyene gider (`active.ts sendGuestJoined`, iki çağrı yeri tek fonksiyon). Konsol "Kalan süre"yi bu alandan güncellemeli. Fixture'a örnek eklendi.
  - **TEST-P4-1 (yarış):** F5'te tarayıcı 1001 kapanış çerçevesi gönderip hemen yeni WS açıyor; sunucu soketi CLOSING iken `close` olayı henüz işlenmediğinden `guest.peer` dolu → `reconnect.conflict` 403. Düzeltme: `Peer.isOpen()` (ws `readyState === OPEN`); `/ws/guest` reconnect'te yalnız **OPEN** eski soket çakışma sayılır. `reattachGuest` eski (kapanmakta olan) peer'ı önce `detachGuest` ile ayırır (teknisyene `peer.left` + `share: stopped`), sonra yeni peer'ı bağlar; eski soketin geç `close`'u `guest.peer !== peer` korumasıyla etkisiz. Düzeltmesiz kodla yeni test 3/3 `HTTP 403`, düzeltmeyle 3/3 geçti. Kalan risk: eski TCP kapanış çerçevesi olmadan kopmuşsa (çökme/ağ) soket ping zaman aşımına (≤ 60 sn) kadar OPEN kalır → 403; frontend 403'te 120 sn pencere içinde birkaç sn aralıkla yeniden denemeli. Resolve'un ACTIVE oturumda 410 dönmesi tasarım gereği, değişmedi (dönüş yolu yalnız `rs.reconnect.<token>`).
  - Dosyalar: `packages/contracts/src/ws.ts`, `packages/contracts/fixtures/ws-messages.json`, `apps/server/src/signaling/{types,active,rooms,ws}.ts`, `apps/server/test/helpers/ws.ts` (FakePeer `isOpen`), `test/integration/signaling-lifecycle.test.ts` (+2: AC-13/TEST-P4-2, AC-24/TEST-P4-1), `consent-p4.test.ts` (peer.joined beklentisi `maxEndsAt`).
  - Komutlar: server+contracts lint/typecheck temiz; unit contracts 24, server 79; `test:int` 17 dosya **105/105** (iki kez); test konteyneri silindi. Bağımlılık yok. Not: `pnpm -r run lint` şu an `apps/web/app/session/[token]/guest-resume-gate.tsx:22` (frontend'in devam eden işi, setState-in-effect) nedeniyle kırmızı — backend ile ilgisiz.

## Frontend (P4) — tarayıcı modu medya hattı (2026-11-11)
Durum: **tamam** (lint/typecheck/unit/e2e yeşil). Backend P4 sözleşmesine uyarlandı (resolve `consentText` + `abuseEmail`, join `consentTextId` zorunlu).

### Rotalar
| Yol | Auth | Ne yapar |
|---|---|---|
| `/session/[token]` | Hayır (token) | Karşılama (teknisyen + doğrulama kodu, dolandırıcılık uyarısı + "Kötüye kullanımı bildir", ad + aydınlatma onayı, "Yalnız ekranımı tarayıcıdan paylaş") → lobi (4 haneli kabul kodu, kalan bekleme, "Vazgeç ve çık") → oturum (paylaş/durdur/yeniden paylaş, önizleme, oturumu bitir onaylı) → bitiş/ret/bekleme doldu/bağlantı kesildi ekranları |
| `/sessions/[id]/console` | Evet, yalnız oturumun teknisyeni | Teknisyen konsolu (varsayılan koyu): üst bar (müşteri, durum, kalan süre, doğrulama kodu, bitir/iptal onaylı), sahne (bekleniyor, lobi paneli: kod girişi + kalan hak + satır başına Reddet, bağlanıyor, video, paylaşım durdu, müşteri koptu 120 sn, kendi WS koptu) |
| `/sessions` (değişti) | Evet | Satır eylemleri: "Konsolu aç" (PENDING/ACTIVE, yalnız kendi oturumu), "Zorla sonlandır" (ACTIVE, `sessions.terminate`, onay diyaloğu) |

### Dosyalar
- `lib/webrtc/{signal,peer,guest-machine,tech-machine,use-guest-session,use-tech-session}.ts`, `lib/webrtc/machines.test.ts`
- `app/session/[token]/{page,guest-flow,guest-welcome,join-form,guest-session}.tsx`, `app/session/guest-ui.tsx` (yeni bitiş türleri, şifreli bağlantı notu, alt bilgi)
- `app/(panel)/sessions/[id]/console/{page,console-view}.tsx`, `components/console/{stage,lobby-panel}.tsx`, `components/guest/share-strip.tsx`
- `app/(panel)/sessions/{session-list,sessions-view,page,terminate-dialog}.tsx`
- `components/ui/button.tsx` (`danger`, `danger-ghost` varyantları), `components/ui/code-display.tsx` (`xl` kabul kodu kutuları), `app/globals.css` (`:root:has(.theme-dark)` — konsol koyu), `messages/tr.json`
- `next.config.ts` (`/ws/*` rewrite — yalnız Caddy'siz geliştirme/e2e), `proxy.ts` (matcher `/ws/` hariç)
- e2e: `e2e/mock-ws.mjs` (sahte sinyalizasyon), `e2e/mock-sessions.mjs` (resolve nonce/consentText/abuseEmail, join, GET `/sessions/:id`, terminate), `e2e/mock-api.mjs` (upgrade), `e2e/p4-media.spec.ts`, `playwright.config.ts` (sahte ekran kaynağı bayrakları)

### Kararlar / sapmalar
1. **Medya yönü:** teknisyen recvonly video offer'ı oluşturur; misafir answer'da transceiver'ı `sendonly` yapar ve ekran izini `replaceTrack` ile bağlar. Paylaş/durdur/yeniden paylaş yeniden anlaşma gerektirmez; durum `share.state` ile gider. `getDisplayMedia` yalnız kullanıcı tıklamasıyla (tarayıcı kuralı) — bu yüzden kabul sonrası "Ekranımı paylaş" düğmesi var (taslakta doğrudan paylaşım şeridi).
2. **Yeniden bağlanma:** misafir yalnız kabul sonrası (`reconnectToken`, 120 sn, üstel geri çekilme ≤10 sn). Lobide kopan misafir için yeniden bağlanma yok (ticket tek kullanımlık; sunucuda lobi reconnect'i yok) → "Bağlantı kesildi" + "Tekrar katıl" (sayfa yeniden resolve). Taslaktaki "lobi: koptu, yeniden deneniyor, kodunuz değişmedi" durumu bu yüzden uygulanmadı. Teknisyen WS kopması: 120 sn boyunca geri çekilmeyle yeniden dener (`/ws/tech` 429/403 tarayıcıda yalnız kapanış olarak görünür); 4401/4409/1008/1009 son.
3. **joinNonce 60 sn:** token istemciye verilmez; nonce eskiyse veya `NONCE_INVALID`/`fields.consentTextId` gelirse `router.refresh()` ile sunucuda yeniden resolve edilir, form durumu korunur (consent hatasında onay kutusu sıfırlanır).
4. **Kabul edilen misafirin adı:** sunucu `peer.joined`'da ad göndermez; kabul anında lobide tek kişi varsa onun adı, yoksa "Müşteri" gösterilir.
5. **Konsol koyu:** tema tercihi P12'ye dek konsol sayfası `.theme-dark` ile koyu; panel kabuğu (üst menü/kenar) da `:root:has()` ile koyulaşır.
6. Kalite göstergesi, sohbet, dosya, işaretleme, sağ panel **P5** — yer ayrılmadı. Konsol üst barında "Süre" yerine "Kalan süre" (`hello.maxEndsAt`'e geri sayım; oturum başlangıcı istemciye gelmiyor).
7. **Bağımlılık:** `ws@8.18.3` + `@types/ws@8.18.1` **yalnız apps/web devDependency** (e2e sahte WS sunucusu; mimari §10.4'te server için onaylı sürüm). Üretim paketine girmez.
8. Form hidrasyon öncesi pasif (`useSyncExternalStore`): hidrasyondan önce tıklama yerel form gönderimi yapmasın.
9. ICE yenileme yarışı: admit anında gelen ilk `ice.servers` ICE restart tetiklemez; restart yalnız `signalingState=stable` ve uzak tanım varken (aksi hâlde ilk offer yanıtlanmadan ikinci offer üretiliyordu).
10. `guest.spec.ts` P2 varsayımı ("formda textbox yok") P4 formuna göre güncellendi; `guest-next` test kimliği kalan süre satırına taşındı.
11. Hata dili: 400 `fields.consentTextId` (metin güncellendi) → mesaj + onay kutusu sıfırlanır + sayfa yeniden resolve edilir (nonce yanmış).

### Testler (2026-11-11)
- `pnpm --filter @remote/web lint` temiz · `typecheck` temiz · `test` **34/34** (yeni `lib/webrtc/machines.test.ts`: misafir/teknisyen durum makineleri, kapanış kodları 1008/1009/4401/4409, yeniden bağlanma, şema dışı mesaj, URL'de kimlik bilgisi yok).
- `pnpm --filter @remote/web e2e` **212/212** (`--repeat-each=2`, desktop + mobile). `e2e/p4-media.spec.ts`: karşılama → KVKK → lobi → hatalı kod (kalan hak) → kabul → müşteri paylaşır → teknisyen videosu `readyState≥2 && videoWidth>0` (Chromium sahte ekran kaynağı) → durdur/yeniden paylaş → müşteri bitirir (onaylı) → iki tarafta bitiş ekranı; ret akışı (AC-113); Admin zorla sonlandır (AC-114, odak "Vazgeç"te); müşteri ekranları axe açık/koyu + 375 px yatay taşma yok; konsol koyu axe + klavyeyle kabul kodu + teknisyen bitirir.
- Varsayılan e2e sahte WS'ye karşı (gerçek sunucu e2e'si sonradan eklendi: aşağıda "Gerçek sunucu entegrasyonu", `E2E_REAL=1`) (`e2e/mock-ws.mjs`): gerçek server + test DB kurulumu bu turda ağır bulundu; sunucu davranışı backend entegrasyon testlerinde (P3/P4) doğrulanıyor. Staging NAT/TURN ölçümü (AC-23, 40–42) test-operatörü/devops işi.

### devops / backend notu
- Caddy'de `/ws/*` → server yönlendirmesi P3'ten var olmalı; `next.config.ts` `/ws` rewrite'ı yalnız Caddy'siz ortam içindir.
- CSP değişmedi: `connect-src 'self' wss://host` (WS aynı origin), `Permissions-Policy display-capture=(self)`. Video `srcObject` (MediaStream) `media-src` gerektirmez.

## Frontend (P4) — Gerçek sunucu entegrasyonu (2026-11-11)
Amaç: sahte WS (`e2e/mock-ws.mjs`) ile geçen e2e'nin gerçek `apps/server` ile uyuşmazlık saklamadığını doğrulamak.

### Kurulum (yerel, Caddy'siz)
0. **Tek komut (önerilen, QA-P5-6):** `scripts/e2e-real.sh` — aşağıdaki adımların hepsi + temizlik (runbook §10).
1. `eval "$(apps/server/scripts/test-db.sh up)"` (migrate + grants) → `DATABASE_URL=$TEST_DATABASE_URL SEED_SUPERADMIN_EMAIL=<e-posta> SEED_SUPERADMIN_PASSWORD=<≥12 karakter> pnpm --filter @remote/server db:seed` (Super Admin + demo tenant + KVKK v1; iki SEED_* değişkeni zorunlu).
2. Demo tenant'ta iki ADMIN teknisyen (`must_change_password=0`, hash `src/auth/password.ts`) — `deploy/staging-users.sh` mantığı, yerelde küçük bir Prisma betiğiyle.
3. Server: `PUBLIC_BASE_URL=http://localhost:3218 PORT=3302 DATABASE_URL=… node src/server.ts` (TURN yok → `iceServers` boş, yerel P2P).
4. `cd apps/web && E2E_REAL=1 E2E_REAL_LOGIN=<admin1> E2E_REAL_LOGIN2=<admin2> E2E_REAL_PASSWORD=<parola> pnpm exec playwright test -c playwright.real.config.ts`
   (standalone build; `next.config.ts` rewrite'ı `/api` ve `/ws`'yi `E2E_REAL_API`'ye — varsayılan `http://127.0.0.1:3302` — yollar).
- `playwright.config.ts` (normal CI e2e) `p4-real.spec.ts`'i `testIgnore` ile dışlar; spec ayrıca `E2E_REAL` yoksa atlanır.
- Not: saatlik oturum oluşturma sınırı (AC-12, 20/teknisyen) aynı saatte ~4 tam koşudan sonra 409 verir — beklenen davranış; yeni DB ya da bir saat bekleme.

### Senaryolar (`e2e/p4-real.spec.ts`, gerçek server + MySQL) — 5/5 geçti
1. Teknisyen UI ile giriş → yeni oturum → link → konsol; ikinci bağlamda müşteri link → ad + KVKK → lobi → teknisyen yanlış kod ("4 hatalı girişte" uyarısı) → müşteri ekranından okunan doğru kod → Aktif → paylaş (sahte ekran) → `videoWidth>0` → durdur → yeniden paylaş → video → teknisyen bitirir → iki taraf bitiş.
2. Müşteri bitirir → konsol "Müşteri oturumu bitirdi", müşteri bitiş ekranı.
3. **Teknisyen konsolu paylaşım sürerken yenilenir** → yeniden bağlanır, Aktif, müşteri adı, `data-share=sharing`, video geri gelir (AC-24) — sahte WS'de yoktu, iki uyuşmazlık buldu (aşağıda).
4. Ret (AC-113) → müşteri ret ekranı, konsol tekrar "Müşteri bekleniyor".
5. Zorla sonlandır (AC-114): admin2'nin aktif oturumunu admin1 `/sessions` listesinden onaylı sonlandırır → müşteri ve konsol bitiş.

### Bulunan uyuşmazlıklar ve düzeltmeler
| # | Bulgu | Neden mock saklıyordu | Düzeltme |
|---|---|---|---|
| 1 | Teknisyen yeniden bağlanınca paylaşım durumu kayboluyordu: sahne `data-share` "unknown" kalıyor, "paylaşım durdu/bekleniyor" mesajı videonun üstünde. Gerçek server teknisyen dönünce misafire `peer.joined{role:"tech"}` gönderir ama `share.state`'i saklamaz/tekrar iletmez. | Mock teknisyen bağlantısında misafire `peer.joined`/`peer.left` (tech) hiç göndermiyor. | `lib/webrtc/use-guest-session.ts`: `peer.joined{tech}` alınınca paylaşım sürüyorsa `share.state: sharing` yeniden gönderilir (hello'daki mevcut davranışın eşi). |
| 2 | Konsol yenilenince müşteri adı "Müşteri"ye düşüyordu: protokolde ad yalnız `peer.pending`'de var; `hello`/`peer.joined` adı taşımaz. | Mock tek oturum içi akışı test ediyordu; yenileme senaryosu yoktu. | `use-tech-session.ts` + `tech-machine.ts` (`restoreName`): kabul edilen adın sekme belleğinde (`sessionStorage`, `rs.guestName.<sessionId>`) tutulması, ACTIVE `hello` sonrası geri yüklenmesi, bitişte silinmesi. Birim testi eklendi. |
| 3 | `SessionView` (liste) müşteri adı taşımaz — Admin zorla sonlandırırken hangi satırın hangi müşteri olduğu yalnız teknisyen adı/zamanla anlaşılır. | Mock'ta da yok; bilgi notu. | Kod değişmedi (sözleşmede alan yok). |

### backend-dev / mimar notu (sözleşme önerisi, bu turda değiştirilmedi)
- `hello` (role tech, ACTIVE) ve `peer.joined{role:"guest"}` mesajlarına opsiyonel `guestName` eklenmesi önerilir: (a) farklı sekme/cihazdan açılan konsolda ad yine "Müşteri" görünür (sessionStorage sekmeye özel), (b) lobide >1 bekleyen varken kabulde ad istemcide bilinmez (kod→misafir eşlemesi sunucuda). Server ayrıca son `share.state`'i odada saklayıp teknisyen `hello`'suna koyabilir; o zaman #1'deki istemci yeniden bildirimi gereksiz kalır (zararsız).
- Server ve contracts tarafında kod değişikliği yapılmadı; server testleri bu yüzden yeniden koşulmadı.
- Server logu tüm koşularda temiz: WS upgrade reddi 0, beklenmeyen 4xx/5xx yok (yalnız AC-12 sınırının 409'u).

### Değişen / eklenen dosyalar
`apps/web/e2e/p4-real.spec.ts` (yeni), `apps/web/playwright.real.config.ts` (yeni), `apps/web/playwright.config.ts` (`testIgnore`), `apps/web/lib/webrtc/use-guest-session.ts`, `apps/web/lib/webrtc/use-tech-session.ts`, `apps/web/lib/webrtc/tech-machine.ts`, `apps/web/lib/webrtc/machines.test.ts`, `DESIGN.md` (§6: Button `danger`/`danger-ghost`, CodeDisplay `xl`, share-strip, stage, lobby-panel, konsol koyu teması; §6.1 "yazıldı").

### Düzeltme turu 1 (Frontend P4) — 2026-11-11
| Madde | Yapılan |
|---|---|
| QA-P4-1 / S-P4-2 | `apps/web` devDependency `ws` 8.18.3 → **8.21.0** (server ile aynı), lockfile güncel; `pnpm audit --audit-level high` → "No known vulnerabilities found". |
| QA-P4-2 (AC-34) | Konsol üst barında `live` + `guestKind=BROWSER` iken pasif **Uzaktan kontrol** (`MousePointer2`, `disabled`, `aria-describedby`) + "Müşteri tarayıcı modunda: yalnız görüntüleme" (`console-control`, `console-control-hint`). Kontrol akışı P7. |
| QA-P4-3 (AC-33) | `lib/device-support.ts` (+birim): `getDisplayMedia` yok **veya** UA-CH `mobile` **veya** yalnız kaba işaretçi (`pointer: coarse` ve `any-pointer: fine` yok) **veya** mobil UA → karşılamada form yerine `guest-unsupported` ("Bu cihaz desteklenmiyor; masaüstü Chrome, Edge veya Firefox kullanın", `MonitorX`). Teknisyen + doğrulama kodu + uyarı görünür kalır; `join-form` render edilmez → lobiye girilemez. SSR'da bilinmez (`useSyncExternalStore` sunucu anlık görüntüsü `null`) → masaüstünde form anında gelir. Mobil axe testi (AC-39) bu ekranı tarar. |
| QA-P4-4 (AC-30) | `NotAllowedError` → danger Alert "Paylaşım başlatılmadı" + açıklama + **Tekrar dene** (`share-retry`, `RotateCw`); stub'lı e2e ilk çağrıyı reddeder, tekrar denemede paylaşım + teknisyende `data-share=sharing`. `p4-real.spec.ts` "REAL AC-30, 59" → "REAL AC-59". |
| QA-P4-5 (AC-43) | `console/stage.tsx`: paylaşım görünürken sağ üstte `Segmented` **Sığdır** (`Expand`, `object-contain`) / **%100** (`ScanSearch`, doğal boyut, `overflow-auto` kaydırma bölgesi `tabIndex=0`, `role=region`) + **Tam ekran** düğmesi (`Maximize`/`Minimize`, `aria-pressed`, `requestFullscreen` sahne bölümüne, `fullscreenchange` dinlenir). `data-mode`, `data-fullscreen`. `ui/segmented.tsx` opsiyonel `icon` aldı (DESIGN.md §6'ya işlendi — düzeltme turu 2). |
| QA-P4-8 (AC-38) | e2e: `/session/<token>` yanıtında `content-security-policy` `frame-ancestors 'none'`; `X-Frame-Options` varsa `DENY`. |
| QA-P4-9 (AC-26/125) | e2e: karşılama `guest-verify-code` = konsol `console-verify-code` (yeni testId) ve `mailto:` href. Mock'a `B×43` token (resolve `abuseEmail: null`) → "Kötüye kullanımı bildir" bağlantısının gizlendiği e2e (bileşen zaten koşullu render ediyordu). |
| QA-P4-11 | `apps/server/scripts/e2e-real-users.ts` (yeni; seed.ts kalıbı: PrismaMariaDb + argon2id aynı parametre): demo tenant'ta iki ADMIN, `must_change_password=0`, idempotent (varsa parola/kilit sıfırlanır, başka tenant/rolde ise dokunmaz), audit kaydı, `NODE_ENV=production`'da çalışmaz. Komutlar (apps/web/package.json): `pnpm --filter @remote/web e2e:real:users` (env: `DATABASE_URL`, `E2E_REAL_LOGIN`, `E2E_REAL_LOGIN2`, `E2E_REAL_PASSWORD`) → `pnpm --filter @remote/web e2e:real`. Yukarıdaki "Kurulum" 2. ve 4. adımlarının yerine geçer. apps/server'da mevcut dosya değiştirilmedi (bu yüzden script web package.json'da). |
| S-P4-4 | `lib/session-storage.ts` `clearSessionData()` (+birim): çıkışta (`logout-button.tsx`) sekme belleğindeki tüm `rs.*` anahtarları (`rs.guestName.*`) silinir. |
| QA-P4-12 (istemci) | `tech-machine.ts` `extras()`: `hello{tech}.guestName` / `.share.state` ve `peer.joined{guest}.guestName` varsa kullanılır (sunucu adı sekme belleğini ezer, `restoreName` yalnız ad yoksa). Yoksa: yalnız tek bekleyen varken kabul edilenin adı; >1 bekleyende tahmin yok → "Müşteri". Birim testi eklendi. |

- **Yeni metinler** (`messages/tr.json`): `g.unsupportedTitle/Body`, `gs.deniedTitle`, `gs.retry`, `c.control`, `c.controlBrowser`, `cs.view/fit/actual/fullscreen/exitFullscreen/scroll`.
- **Değişen/eklenen dosyalar:** `apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/app/session/[token]/guest-welcome.tsx`, `apps/web/app/session/[token]/guest-session.tsx`, `apps/web/app/(panel)/sessions/[id]/console/console-view.tsx`, `apps/web/app/(panel)/logout-button.tsx`, `apps/web/components/console/stage.tsx`, `apps/web/components/ui/segmented.tsx`, `apps/web/lib/device-support.ts` (+test), `apps/web/lib/session-storage.ts` (+test), `apps/web/lib/webrtc/tech-machine.ts`, `apps/web/lib/webrtc/machines.test.ts`, `apps/web/messages/tr.json`, `apps/web/e2e/guest.spec.ts`, `apps/web/e2e/p4-media.spec.ts`, `apps/web/e2e/p4-real.spec.ts`, `apps/web/e2e/mock-sessions.mjs`, `apps/web/playwright.real.config.ts`, `apps/server/scripts/e2e-real-users.ts` (yeni).
- **Doğrulama:** web lint ✓, typecheck ✓, birim 44/44 ✓, mock e2e 116 geçti / 8 atlandı (masaüstü-only akışların mobil kopyaları) / 0 hata; `pnpm audit --audit-level high` temiz. Gerçek sunucu e2e'si bu turda koşulmadı.
- **Kapandı (düzeltme turu 2, QA-P4-13):** DESIGN.md §6'ya stage görüntü modları (Sığdır / %100 kaydırmalı / Tam ekran; `data-mode`, `data-fullscreen`), Segmented `icon` seçeneği, konsol pasif "Uzaktan kontrol" (disabled + `aria-describedby`), müşteri "Bu cihaz desteklenmiyor" ve "Paylaşım başlatılmadı / Tekrar dene" durumları işlendi; §6.1 satırları ve §8 kötüye kullanım adresi kararı (production'da boşsa bağlantı gizlenir) güncellendi. Aynı turda `ABUSE_EMAIL` boş bırakma uyarıları (runbook §3, `.env.example`, `deploy/docker-compose.yml` yorumu) env.ts `withoutBlanks` davranışına göre düzeltildi.

### Sayfa testi düzeltmesi (TEST-P4-1..5) — 2026-11-11
- **TEST-P4-1 (müşteri F5):** kabul sonrası `hello.reconnectToken` (her yenilenende tekrar) + teknisyen adı, müşteri adı, doğrulama kodu ve opak `sessionRef` yalnız bu sekmenin sessionStorage'ında `rs.resume.<SHA-256(link token) ilk 16 bayt hex>` anahtarında tutulur (link token'ı depoya yazılmaz; `rs.` öneki çıkışta `clearSessionData` ile de silinir). `/session/<token>` resolve 410/4xx döndürünce `GuestResumeGate` (yeni, `app/session/[token]/guest-resume-gate.tsx`) kaydı okur; `consumed` ise `rs.reconnect.<token>` ile doğrudan WS'ye bağlanır, lobiye girmez ("Oturumunuza yeniden bağlanılıyor…" durumu). Paylaşım otomatik başlamaz; "Paylaş" düğmesi gerekir. Dönüş reddedilirse (hello öncesi kapanış): 4401/1008/1009'da hemen; diğerlerinde `GET /public/sessions/status?ref=` ACTIVE değilse (veya 4xx) durur, ACTIVE ise 3 sn arayla en çok 20 deneme (sunucunun ≤60 sn ping zaman aşımında eski soketi OPEN sayması için — backend notu). Sonuç `resumeFailed` → "Bu bağlantı zaten kullanıldı"; kayıt silinir. Oturum bitince/müşteri ayrılınca/`consumed` dışı sonlarda kayıt silinir. Web Crypto/depo yoksa 1,5 sn sonra eski davranış.
- **TEST-P4-2:** `tech-machine` `peer.joined{role:"guest", maxEndsAt?}` ile `maxEndsAt`'i kurar (alan yoksa önceki değer korunur, geçersiz tarih yok sayılır). Sahte WS ilk kabulde alanı yollar.
- **TEST-P4-3:** kod kaynaklı değil — uygulamada `getUserMedia` çağrısı yok, `getDisplayMedia({ video, audio: false })`; Permissions-Policy `camera=()` bilinçli (proxy.ts, server app.ts). Uyarı yalnız sahte medya bayraklı Chromium'da paylaşım sürerken yenilemede görülüyor → Chromium fake-media yan etkisi olarak kabul edildi; gerçek tarayıcıda staging'de bir kez bakılmalı.
- **TEST-P4-4:** konsol üst barı `xl:flex-nowrap`, `gap-x-3`; sabit öğeler `shrink-0`, "tarayıcı modunda" açıklaması daralıp satır kırar (`min-w-20 max-w-48`). 1280 px'te "Oturumu bitir" aynı satırda (e2e AC-34 içinde ölçülür).
- **TEST-P4-5:** `GuestShell` alt bilgisi `GuestEndScreen` (`data-guest-end`) varken CSS `group-has-[[data-guest-end]]:hidden` ile gizlenir (sunucu ve istemci ekranlarında aynı kural).
- Sahte API: ACTIVE/ENDED oturumun resolve'u gerçek sunucu gibi 410 `SESSION_CONSUMED`.
- Değişen dosyalar (apps/web): `lib/guest-resume.ts` (+test), `lib/webrtc/{guest-machine,tech-machine,use-guest-session}.ts`, `lib/webrtc/machines.test.ts`, `app/session/[token]/{page,guest-flow,guest-session,guest-resume-gate}.tsx`, `app/session/guest-ui.tsx`, `app/(panel)/sessions/[id]/console/console-view.tsx`, `messages/tr.json` (`gs.resuming`), `e2e/{p4-media.spec.ts,mock-ws.mjs,mock-sessions.mjs}`.
- Yeni e2e: "TEST-P4-1: müşteri aktif oturumda sayfayı yeniler…", "TEST-P4-1: oturum bittikten sonra kalan dönüş kaydı…"; AC-34 testine kalan süre + tek satır kontrolü. Rota değişikliği yok.
- Doğrulama: `pnpm -r run lint` yeşil; web typecheck yeşil; unit 50/50; mock e2e 118 geçti / 10 atlandı (mobil projede konsol akışları). Gerçek e2e (`e2e:real`) bu turda koşulmadı.

## DevOps (P4)
### Düzeltme turu 1 (QA-P4-6, S-P4-1 + coturn sertleştirme) — 2026-11-11
- **ABUSE_EMAIL zinciri:** `.env.example` (boş, açıklamalı), `deploy/docker-compose.yml` server `ABUSE_EMAIL:` (değersiz anahtar: tanımsızsa konteynere geçmez; `${ABUSE_EMAIL:-}` boş dize verip env.ts `z.email()`'i düşürürdü), runbook §3 tablo. Kalan risk: `.env`'de `ABUSE_EMAIL=` boş satırı hâlâ `""` geçirir → **backend-dev:** env.ts'de boş dizeyi `undefined`'a çeviren preprocess önerilir (aynı durum `METRICS_TOKEN: ${METRICS_TOKEN:-}` + `min(16)` için de var). Davranış: production'da boşsa misafir ekranındaki "Kötüye kullanımı bildir" gizlenir (Super Admin fallback yok — backend tarafında); staging/prod'da doldurulması önerilir.
- **test-denied.sh:** bekleme/yeniden deneme döngüsü artık 508'e ek olarak 486 (user-quota) ve yalnız "Cannot complete Allocation" çıktısını da yeniden dener. Beklenen ret testleri (`wrong`, `expired`, `v6relay`) ve 401/403/437/438/44x içeren çıktılar yeniden denenmez (negatif testler 700 sn beklemesin).
- **coturn listening-ip:** yeni `TURN_LISTEN_IPS` (`deploy/turn/docker-compose.yml`, `.env.example`, runbook §9.1). `auto` → `listening-ip=<TURN_EXTERNAL_IP özel IPv4>` + `listening-ip=127.0.0.1`; virgüllü IPv4 listesi de kabul (IPv4 doğrulaması, çok satır reddi; 127.0.0.1 healthcheck için her zaman eklenir). Boşsa eski davranış (tüm arayüzler) + entrypoint UYARI. Staging `deploy/turn/.env`'e `TURN_LISTEN_IPS=auto` eklenmeli (sunucuya bu turda dokunulmadı).
- **Doğrulama:** `deploy/turn/test-local.sh` `TURN_LISTEN_IPS=auto` ile koşar; yeni kontrol: 3478 yalnız `127.0.0.1` + `172.31.250.2`'de dinleniyor; healthcheck (`turnutils_stunclient 127.0.0.1`) healthy. Sonuç (2026-11-11, Docker Desktop): **62 PASS, 0 FAIL**, çıkış 0.

## DevOps (P5) — 2026-11-11
- **S-P4-T2-2 kalan (kapandı):** `apps/server/Dockerfile` `prod-deps` aşamasına `RUN rm -rf apps/server/scripts` eklendi. `runtime` yalnız bu aşamadan kopyaladığı için `e2e-real-users.ts` / `test-db.sh` prod imajına (katmanlar dahil) girmez. `migrate` hedefi (`tooling` tabanlı; compose'da `migrate` ve `seed` servisleri `remote-migrate:${IMAGE_TAG}` imajını kullanır) değişmedi; seed `tsx prisma/seed.ts` çalıştırır, `scripts/`'e bağımlı değil.
- **Doğrulama (yerel, Docker Desktop):** `docker build -f apps/server/Dockerfile --target runtime` ve `--target migrate` başarılı. Runtime: `ls /app/apps/server/scripts` → yok; kullanıcı `node`; `node src/server.ts` env doğrulamasına kadar açılıyor (modül eksiği yok). Migrate: `prisma/seed.ts`, `prisma/sql/grants.sql`, `node_modules/.bin/{tsx,prisma}` mevcut (`tsx v4.23.15`).
- **Not (kapsam dışı, öneri):** runtime imajında `apps/server/test/`, `vitest.config.ts`, `eslint.config.mjs` de bulunuyor (çalıştırılabilir giriş noktası değil, gizli bilgi yok). İleride hedefli COPY (`src`, `prisma`, `package.json`, `prisma.config.ts`) ile daraltılabilir.
- **Runbook:** §8 "Yayın geçmişi" tablosu (P3+P4 yayını 2026-11-11, `0f1b89a`, migration `20261111030000_p4_consents`, coturn `TURN_LISTEN_IPS=auto`, dış TURN pfSense NAT bekliyor); §8.1 TURN değişkenleri artık server tarafından okunuyor, `deploy/turn` ilk `git pull` prosedürü "uygulandı (tarihçe)" olarak işaretlendi.

### QA-P5-6 — Gerçek sunucu e2e tek komut (`scripts/e2e-real.sh`) — 2026-11-11
- **Betik:** `scripts/e2e-real.sh` (bash, `set -euo pipefail`, trap temizliği). Adımlar: çalışma ağacının APFS klonu
  (`$TMPDIR/rs-e2e-real.*/repo`, `.git`/`.next` hariç) → `test-db.sh up` (`rs-mysql-e2e-real`, 127.0.0.1:33317;
  `rs-mysql-test`/33307 ile çakışmaz) → `db:seed` (`SEED_SUPERADMIN_EMAIL`/`SEED_SUPERADMIN_PASSWORD` rastgele) →
  `e2e:real:users` (iki ADMIN, rastgele) → server :3302 (`/ready` beklenir) → `e2e:real --trace off` (Playwright
  webServer `next build`, `API_INTERNAL_URL=E2E_REAL_API`) → server/web/konteyner/kopya temizliği. Ön kontroller:
  araçlar, Docker, portlar 33317/3302/3218, konteyner adı, macOS kilitli ekran uyarısı. Çıkış 0/1/2/3 (geçti / test /
  ön koşul / kurulum). `E2E_REAL_REF=<ref>` commit'lenmiş sürümü koşturur (kurulum-ürün ayrımı). Runbook §10, README.
- **Bu turda bulunan kurulum sorunları (betikte çözüldü):** (1) `NODE_ENV=development` dışa aktarılınca `next build`
  `/_global-error` prerender'ında `useContext` null hatasıyla çöküyor → NODE_ENV yalnız server'a verilir. (2) Paralel
  ajanın `next build`'i ortak `apps/web/.next`'i koşu ortasında ezdi → `ChunkLoadError`, 5/5 kırmızı → kod anlık
  görüntüsü ile yalıtıldı. (3) Playwright trace `fill` değerini (parola) kaydeder → varsayılan kapalı.
- **Sonuç (P5 çalışma ağacı, yalıtılmış koşu, 3 kez tekrar — son koşu dahil hepsi aynı): 2/5.** Geçen: AC-113 ret, AC-114 zorla sonlandırma.
  Kırmızı: AC-28..33/59/112 (2. paylaşımda video), AC-59 ve AC-24 (ilk paylaşımda video) — `console-video`
  `videoWidth>0` poll'u 20 sn'de dolmuyor; sinyalizasyon sağlam (konsol "Aktif", `data-share=sharing`), server logu
  temiz (error/fatal 0).
- **Ayrım: ORTAM, ürün değil.** Aynı betik `E2E_REAL_REF=0f1b89a` (P4 commit'i; P4'te 5/5 kayıtlı) ile de **aynı 3
  testte aynı satırlarda** kırmızı. Koşu sırasında macOS ekranı kilitliydi (`CGSSessionScreenIsLocked=true`, ekran
  03:34'ten beri kapalı); `getDisplayMedia` `--auto-select-desktop-capture-source=Entire screen` ile **gerçek ekranı**
  yakalar, kilitli ekranda kare üretmez (ilk karenin ardından akış durur). `caffeinate -u` ile denendi, kilit
  kalkmadığı için sonuç değişmedi. **QA-P5-6 5/5 kanıtı için:** ekran açık/kilitsizken `scripts/e2e-real.sh` tekrar koşturulup
  sonuç buraya yazılmalı (devops; sunucu/kod değişikliği gerekmiyor).
- **frontend-dev notu (öneri, kalıcı çözüm):** `p4-real.spec.ts`/`playwright.real.config.ts`'te `getDisplayMedia`,
  mock e2e'deki gibi `addInitScript` ile canvas `captureStream()` (sürekli çizim) döndürecek şekilde stub'lanırsa
  gerçek sunucu e2e'si fiziksel ekran/kilit durumuna bağımlı olmaz ve CI'da da koşabilir (medya hattı gerçek
  RTCPeerConnection ile yine sınanır).
- **Kalıcı çözüm uygulandı (frontend-dev, 2026-11-11):** `apps/web/e2e/p4-real.spec.ts` `openGuest()` müşteri
  bağlamına `addInitScript(fakeDisplayMedia)` ekler: `getDisplayMedia` → 1280x720 canvas, her karede değişen çizim,
  `captureStream(30)` (track `ended` olunca çizim zamanlayıcısı durur). Medya hattı (RTCPeerConnection, sinyal, gerçek
  server/DB) gerçek kalır; yalnız kaynak sentetik. `apps/web/playwright.real.config.ts`: gerçek ekran yakalama bayrakları
  (`--auto-select-desktop-capture-source`, `--auto-accept-this-tab-capture`) kaldırıldı;
  `--disable-features=WebRtcHideLocalIpsWithMdns` eklendi (mock config ile aynı mDNS gerekçesi).
- **QA Tur 3 açık maddesi kapandı — test DB hazır olma (devops, 2026-11-11):**
  - **Kök neden:** MySQL konteyneri `[Entrypoint]: Switching to dedicated user 'mysql'` satırında asılı kalıyordu.
    PID 1 `gosu` (1.19, go1.24.6) setuid adımında %100 CPU'da dönüyor, `mysqld`'ye hiç geçmiyordu. `gosu mysql id` ve
    `gosu root id` tek başına da asılıyor, eski `mysql:8` imajında da aynı; `gosu --version` çalışıyor, ulimit/seccomp/
    `--cpus` etkisiz. Sorun imajda değil, uzun yük sonrası Docker Desktop (29.8, arm64) VM'sinde. Eski 90 sn döngü hata
    vermeden geçtiği için hata yalnız `P1017` olarak görünüyordu.
  - **`apps/server/scripts/test-db.sh`:** (1) `--user mysql`: entrypoint root değilken gosu'yu atlar, init 4-6 sn.
    (2) Hazır olma koşulu: logda gerçek sunucunun satırı (`mysqld: ready for connections ... port: 3306`) **ve** konteyner
    içinden TCP ile `app` ve `migrator` kullanıcılarıyla `SELECT 1`. Yalnız satır saymak yetmez, çünkü geçici init
    sunucusunda X Plugin de "ready for connections" yazar (port 0). (3) Süre `TEST_DB_READY_TIMEOUT` (varsayılan 180 sn).
    (4) Zaman aşımında veya konteyner durursa `docker logs --tail 30` ile açık hata verir, çıkış 3 (inceleme için
    konteyner bırakılır, `down` ile silinir).
  - **`scripts/e2e-real.sh`:** test-db hatası `fail_setup` → rc=3 (denendi: asılı konteynerle 180 sn sonra rc=3, açık
    log). Artık geçersiz "macOS ekranı kilitli" kontrolü, uyarısı ve ilgili yorumlar kaldırıldı (kaynak sentetik).
    Başlığa `TEST_DB_READY_TIMEOUT` eklendi. Runbook §10: değişken tablosu + "test DB / migrate" belirti satırı (ekran
    kilidi satırının yerine).
  - **Sonuç (yük ~3-5):** `bash scripts/e2e-real.sh` **5/5 geçti, rc=0** (iki ardışık koşu; DB 5 sn'de hazır, server
    logunda error/fatal 0). `eval "$(apps/server/scripts/test-db.sh up)" && pnpm --filter @remote/server test:int` →
    **20 dosya, 128/128**; `down` ile silindi. Koşu sonunda açık konteyner/port (33307/33317/3302/3218) yok.
  - **Not:** `E2E_REAL_REF=<eski ref>` koşuları o ref'teki eski `test-db.sh`'i kullanır (gosu düzeltmesi yok).
    `deploy/docker-compose.yml` mysql servisi değişmedi; Linux sunucuda bu asılma görülmedi.
  **Sonuç: `bash scripts/e2e-real.sh` → 5/5 geçti (15 sn), server logu error/fatal 0, ekran kilitli ortamda.**
  Temizlik sonrası konteyner/port/süreç kalmadı. Not (devops): `scripts/e2e-real.sh`'teki "ekran kilitli" uyarısı ve
  baş yorumu artık geçersiz (zararsız; betik frontend kapsamı dışında olduğu için değiştirilmedi).
- **Değişen dosyalar:** `scripts/e2e-real.sh` (yeni), `apps/web/playwright.real.config.ts` (yalnız baş yorumu),
  `README.md` (gerçek e2e alt bölümü), `docs/runbook.md` (§9.8 dosya meta kota alarmı, §10 yeni),
  `docs/implementation.md`.
- **Runbook §9.8 alarm (S-P5-T2-3 metriği):** `rate(rs_file_meta_rate_limited_total{class="sender"}[5m]) > 0` uyarı
  (olası audit şişirme / değiştirilmiş istemci); `accepted` için `increase(...[1h]) > 0` bilgi; `declined` yalnız pano.

## Backend (P5) — 2026-11-11
- **Sözleşme hazır (frontend-dev için):** `@remote/contracts/files` (`sanitizeFileName`, `isSanitizedFileName`, `DANGEROUS_EXT`, `isDangerousExtension`, `isDoubleExtension`, `fileNameWarning`), `@remote/contracts/dc` (`ctlMessageSchema`/`parseCtlMessage`, `ctlAllowed`, `FILE_CTL_TYPES`, `encodeFileChunk`/`decodeFileChunk`, `FileReceiveGuard`, `maxFileBytes`, sabitler), `@remote/contracts/ws` (`fileMetaSchema`, `qualitySummarySchema`, `hello.maxFileMb`, `peer.joined.maxFileMb`). Fixture: `packages/contracts/fixtures/file-names.json`.
- **Değişen dosyalar:** `packages/contracts/src/{files.ts (yeni), dc.ts, ws.ts}`, `packages/contracts/package.json` (`./files` export), `packages/contracts/fixtures/{file-names.json (yeni), ws-messages.json}`, `packages/contracts/test/dc-files.test.ts` (yeni); `apps/server/src/signaling/{collab.ts (yeni), handlers.ts, active.ts, admit.ts, types.ts, rooms.ts, ws.ts}`, `apps/server/src/sessions/repo.ts` (`maxActiveHours` → `activeLimits`), `apps/server/src/ops/metrics.ts` (`rs_file_meta_total`); testler `apps/server/test/unit/file-names.test.ts` (yeni), `test/integration/signaling-collab-p5.test.ts` (yeni), `signaling-lifecycle.test.ts` (S-P4-T3-2), `consent-p4.test.ts` (peer.joined `maxFileMb`).
- **Sunucu davranışı:**
  - `file.meta` (tech + ADMITTED guest): `caps` içinde `file_transfer` yoksa `error{FORBIDDEN}`, kayıt yok (AC-119). **Tek kaynak alıcı tarafın raporu** (TO_CUSTOMER → misafir, TO_TECH → teknisyen); gönderenin raporu sessizce yok sayılır (metrik `ignored`). `result=OK` ve `sizeBytes > max_file_mb` → `FORBIDDEN`. Oturum başı hız sınırı: dakikada 20, oturum boyunca 500 → `error{RATE_LIMITED}`. Ad sunucuda `sanitizeFileName` ile yeniden temizlenir; `session_files` insert + audit `file.transfer` (entity `session_files`, result OK → success, diğerleri fail) **tek TX**. DB hatası loglanır (ref ID), istemciye ayrıntı gitmez. PENDING oturumda teknisyenden `file.meta` → `error{CONFLICT}`; lobi misafirinden → 1008 (mevcut kural).
  - `quality.summary` (yalnız teknisyen): `updateMany({ id, tenantId, consumedAt: not null })` ile üzerine yazar; 5 sn'den sık gelen özet DB'ye gitmez (son özetin kaybolmaması için aralık kısa tutuldu); JSON > 4096 bayt yazılmaz.
  - `hello.caps` `file_transfer`: P3'ten beri teknisyenin `file_transfer.use` etkin yetkisinden (tenant + kullanıcı) üretiliyor; değişiklik gerekmedi.
  - S-P4-T3-2 (backend): `reconnect.conflict` audit'i oda başına 60 sn'de en çok 1 kayıt (`RECONNECT_CONFLICT_AUDIT_MS`); bağlantı yine 403.
- **Sözleşme değişiklikleri / tasarımdan sapmalar (frontend-dev bilmeli):**
  1. `hello.maxFileMb?` (iki rol, ACTIVE iken) ve `peer.joined.maxFileMb?` (teknisyene) eklendi — mimari-protokol `maxFileBytes` sınırının istemciye nasıl ulaşacağını tanımlamıyordu. Bayt için `maxFileBytes(mb)`.
  2. `file.offer` alanına `idx: uint16` eklendi — §4.2 `file` çerçevesindeki `fidIndex`'in teklife bağlanması için gerekli (protokolde eşleme tanımsızdı). Alıcı `decodeFileChunk(...).fidIndex === offer.idx` kontrol eder.
  3. `file.result{fid, ok}` ctl mesajı şemaya eklendi (protokol §4.1 `file.done` satırında geçiyor, tabloda ayrı satır yoktu).
  4. `file.meta`'yı yalnız alıcı gönderir; gönderenin göndermesi zararsızdır ama kaydedilmez.
  5. Çift uzantı: son uzantı tehlikeli ve önceki parça 1–5 karakter, en az bir harf içeriyorsa (`v1.2.3.msi` çift değil). `fileNameWarning()` → `none | dangerous | double_extension`.
  Mimar: 1–3 numaralı maddeler mimari-protokol §3/§4.1'e işlenmeli.
- **Yeni bağımlılık:** yok.
- **Test (2026-11-11, `scripts/test-db.sh up` → mysql 8.4, sonra `down`):** contracts `test` 32/32, server `test` (unit) 132/132, server `test:int` **122/122** (19 dosya; P5: 10 yeni test), lint + typecheck (server, contracts) temiz. `apps/web` typecheck'teki `p5.chat.*` i18n hataları frontend'in devam eden işine ait (bu pakete dokunulmadı).

### Güvenlik düzeltmesi (S-P5-1, S-P5-3, S-P5-7, S-P5-8) — 2026-11-11
- **S-P5-1 (Yüksek):** `collab.ts` `file.meta` kotası **raporlayan taraf × sonuç sınıfı** başına ayrı sayaç (`room.fileMeta.quotas`, anahtar `tech|guest:accepted|declined`). `declined` (REJECTED/CANCELLED) dakikada 20 / oturum 500 (eski değerler); `accepted` (OK/CORRUPT) dakikada 60 / oturum 2000 (`FILE_META_ACCEPTED_PER_*`). Taraf ayrımı tasarım kararı: aynı sınıf ortak sayılsaydı teknisyen kendi sahte gönderen raporlarıyla (S-P5-3 sonrası artık sayılıyor) müşterinin OK kotasını doldurabilirdi. Kota aşımı: `error{RATE_LIMITED}` + audit `file.meta.rate_limited` (entity `support_sessions`, `newValue {sessionId, side, class}`), oda + sınıf başına dakikada en çok 1 satır (`room.fileMeta.auditAt`). Sıra değişti: tenant sınırı (`too_large`) kontrolü kotadan önce kaldı; kota kontrolü artık alıcı/gönderen ayrımından önce.
- **S-P5-3 (karar: risk azaltma, şema değişikliği yok):** gönderenin raporu artık yok sayılmıyor; `session_files`'a yazılmaz, audit `file.transfer.sender_report` (entity `support_sessions`, entityId oturum, `newValue {sessionId, direction, fileName (temizlenmiş), sizeBytes, sha256, result}`, OK → success) yazılır; aynı kota sınıflarına tabi. Dönüş `"sender_reported"` (eski `"ignored"` kaldırıldı; metrik etiketi `sender_reported`). mimari-protokol §3 güncellendi.
- **S-P5-7 (contracts):** `DANGEROUS_EXT`'e eklendi: `vbe jse ws wsh msp mst inf ps1xml psc1 psd1 settingcontent-ms library-ms searchconnector-ms appref-ms gadget xbap xlam xla pptm dotm html htm mht mhtml svg` (`hta wsf scf lnk url cpl msc reg application` zaten vardı). `RESERVED`: `CONIN$`, `CONOUT$`, `COM¹-³`, `LPT¹-³` (U+00B9/B2/B3). Fixture `file-names.json`: 6 sanitize + 22 uyarı örneği. DB CHECK ayrılmış ad kuralını içermediği için migration gerekmez. **Not:** `docs/gereksinimler.md` AC-36 listesi bilerek güncellenmedi (görev talimatı); güncel liste tek kaynak olarak `packages/contracts/src/files.ts`'tedir — proje-yöneticisi AC-36 metnini "liste koddaki `DANGEROUS_EXT`" olarak revize etmeli. Go eşi (P6 `internal/files`) aynı fixture'ı geçmeli.
- **S-P5-8:** `sessionFile` insert MySQL 3819 (CHECK ihlali; Prisma 7 + mariadb: `meta.driverAdapterError.cause.code === 3819`, `isCheckViolation`) → TX geri alınır, ardından ayrı audit `file.meta.rejected_by_db` (`fileName` yerine yer tutucu `FILE_NAME_DB_REJECTED`, sha256/boyut/yön/sonuç korunur) + istemciye `error{VALIDATION}`; metrik `rejected_by_db`. Rapordaki "FALLBACK adla yeniden yaz" yerine görev kararı uygulandı (session_files'a yer tutucu adlı satır yazılmaz).
- **Sözleşme değişikliği (frontend-dev bilmeli):** `WS_ERROR_CODES`'a `"VALIDATION"` eklendi (`file.meta` DB reddinde gelir; kullanıcıya "dosya kaydı yapılamadı" türü uyarı yeterli). `file.meta` gönderenin de göndermesi artık **kayıt** üretir (audit); alıcı tarafın otomatik ret meta'larını tekilleştirmesi (S-P5-1 frontend kısmı) hâlâ gerekli.
- **Değişen dosyalar:** `apps/server/src/signaling/{collab.ts, types.ts, rooms.ts}`, `packages/contracts/src/{files.ts, ws.ts}`, `packages/contracts/fixtures/file-names.json`, `apps/server/test/integration/signaling-collab-p5.test.ts` (3 yeni test + güncelleme), `apps/server/test/integration/signaling-collab-p5-dbcheck.test.ts` (yeni; `vi.mock` ile sürüm farkı benzetimi), `docs/mimari-protokol.md` (§3 `file.meta`, §4.2 madde 1/4).
- **Yeni bağımlılık:** yok.
- **Test:** `pnpm -r run lint` · `pnpm -r run typecheck` temiz; `pnpm -r run test` → contracts 32, server unit 160, web 65 geçti; `test-db.sh up` (ayrı konteyner adı/port) + `pnpm --filter @remote/server test:int` → **20 dosya, 126 test geçti** (iki kez), konteyner silindi.

### Güvenlik turu 2 düşükleri (S-P5-T2-2, S-P5-T2-3) — 2026-11-11
- **S-P5-T2-2:** `file.meta.rate_limited` audit seyreltmesi artık `${side}:${cls}` anahtarıyla (`room.fileMeta.auditAt: Map<string, number>`); teknisyenin aşımı müşterinin aynı dakikadaki aşım kaydını bastırmaz.
- **S-P5-T2-3:** gönderen raporu (`file.transfer.sender_report`) sonuçtan bağımsız ayrı `sender` kota sınıfında: taraf başına dakikada 10 / oturum 200 (`FILE_META_SENDER_PER_*`); aşımda `error{RATE_LIMITED}` + seyreltilmiş `file.meta.rate_limited` audit (`class: "sender"`). Alıcı kotaları (20/500, 60/2000) değişmedi. Yeni metrik `rs_file_meta_rate_limited_total{class=accepted|declined|sender}` (runbook alarmı devops'a: `rate(rs_file_meta_rate_limited_total{class="sender"}[5m]) > 0` uyarı adayı). Sınıf, alıcı/gönderen ayrımı kotadan önce yapılarak belirleniyor.
- **Değişen dosyalar:** `apps/server/src/signaling/{collab.ts, types.ts, rooms.ts}`, `apps/server/src/ops/metrics.ts`, `apps/server/test/integration/signaling-collab-p5.test.ts` (2 yeni test; S-P5-1 gönderen seli testi yeni kotaya uyarlandı), `docs/mimari-protokol.md` §3 `file.meta`.
- **Sözleşme:** WS mesajları değişmedi. frontend-dev: meşru akışta gönderen transfer başına 1 rapor gönderdiği sürece etkilenmez.
- **Yeni bağımlılık:** yok.
- **Test:** server lint + typecheck temiz; unit 160/160; `test-db.sh up` (konteyner `rs-mysql-test-p5t2`, port 33327) + `test:int` → **20 dosya, 128 test geçti**; konteyner silindi.

## Frontend (P5) — konsol işbirliği (frontend-dev, 2026-11-11)

### Rotalar
Yeni rota yok; mevcut iki rotaya P5 eklendi.
| Yol | Auth | P5 ile gelen |
|---|---|---|
| `/sessions/[id]/console` | Evet (oturum teknisyeni) | Yan panel: Sohbet / Dosyalar / Kalite (`collab-side`); sahnede işaretleme araç çubuğu (kalem, ok, dikdörtgen, lazer, 4 renk, geri al, temizle — yalnız "Sığdır" görünümü) |
| `/session/[token]` | Hayır (link + lobi) | "Teknisyenle iletişim" bölümü (Sohbet; `caps.file_transfer` varsa Dosyalar), önizleme üstünde işaretleme/lazer katmanı, "Yüzen pencere" (Document PiP, yalnız destekleyen tarayıcı) |

### Dosyalar
- Yeni: `apps/web/lib/dc/{ctl.ts, chat.ts, files.ts, annot.ts, use-collab.ts, p5.test.ts}`, `lib/webrtc/{stats.ts, use-quality.ts}`,
  `components/collab/{chat-panel, files-panel, annot-layer}.tsx`, `components/console/{collab-side, quality-panel}.tsx`, `components/guest/guest-collab.tsx`.
- Değişen: `lib/webrtc/{peer.ts (ctl+file DC, input DC kapatılır), signal.ts, use-tech-session.ts, use-guest-session.ts}`, `components/console/stage.tsx`,
  `app/(panel)/sessions/[id]/console/{page,console-view}.tsx`, `app/session/[token]/guest-session.tsx`, `lib/guest-resume.ts`, `lib/format.ts` (`formatBytes`, `formatNumber`), `app/globals.css`, `messages/tr.json` (`p5.*`).
- Sözleşme: contracts `dc.ts` (parseCtlMessage, encode/decodeFileChunk, FileReceiveGuard, maxFileBytes), `files.ts` (sanitizeFileName, fileNameWarning), `ws.ts` (file.meta, quality.summary, `maxFileMb`) doğrudan kullanılır; yerel kopya yok.

### Davranış notları
- Chat: React metin düğümü (HTML yorumlanmaz), 2000 karakter, zaman damgası, okunmamış sayaç (sekme rozetinde).
- Dosya: teklif `idx` ile çerçeve eşlemesi; aynı fid ile ikinci teklif ret; FileReceiveGuard (alınan bayt + seq sırası; aşım → iptal + CANCELLED, sıra dışı → bozuk); SHA-256 uyuşmazlığında tampon atılır, indirme sunulmaz, `file.result{ok:false}` + meta CORRUPT; ret sonrası 30 sn otomatik ret; tek bekleyen teklif; kabul diyaloğu alertdialog, varsayılan odak "Reddet", butonlar 1,5 sn sonra etkin; tehlikeli/çift uzantı uyarısı. `file.meta` yalnız alıcı gönderir. Yetki: konsolda `file_transfer.use`, müşteride `hello.caps` — yoksa gönderim pasif/sekme gizli, gelen teklif otomatik ret, diğer file.* düşer.
- Kalite: 1 sn getStats (FPS, kbps, RTT, kayıp, çözünürlük, bağlantı tipi); 3 sn süren RTT>300 / kayıp>%5 / FPS<5 → "zayıf" (sarı), RTT>600 / kayıp>%10 / FPS<2 → "kötü" (kırmızı), metinle neden. `quality.summary` 60 sn'de bir; "Oturumu bitir"de son özet `session.end`'den önce.
- P4 düşükleri: S-P4-T3-1 — `rs.resume.*` kaydına `savedAt`, 120 sn'den eskisi okunmaz; canlı oturumda damga 30 sn'de bir ve `pagehide`'da tazelenir (uzun oturumda F5 bozulmasın). S-P4-T3-2 — `RESUME_MAX_ATTEMPTS` 35 × 3 sn = 105 sn.

### Sapmalar / eklenenler
- DESIGN token'ları eklendi: `annot-red/yellow/green/blue` (`--rs-annot-*`, iki temada aynı; protokol 4 renk istiyor, DESIGN'da tek `annotate` vardı → lazer rengi olarak kaldı). İkon: Geri al → `Undo2`, Yüzen pencere → `PictureInPicture2`. DESIGN.md §2/§4/§6/§6.1'e işlendi (tamamlama turu).
- `showSaveFilePicker` akışla diske yazma yok: alıcı tarayıcıda bellek + Blob (≤ tenant sınırı). Büyük sınırlı tenant'larda bellek baskısı — P6/P12'de ele alınmalı.
- E2E bozuk-SHA kancası: `NEXT_PUBLIC_RS_E2E=1` derlemesinde `globalThis.__rsCorruptSha` giden özeti bozar (üretim derlemesinde ölü kod). playwright.config env'ine henüz eklenmedi.
- `caps.update` (sunucu→misafir) web'de işlenmiyor: contracts serverOutbound'da yok; eklenince `use-guest-session` hello ile aynı şekilde `setCaps` yapmalı.

### Doğrulama
- `pnpm --filter @remote/web lint` / `typecheck` / `test` yeşil (p5.test.ts: idx eşleme, aynı fid, alınan bayt sınırı, sıra dışı parça, bozuk SHA, caps/cooldown otomatik ret, sohbet XSS düz metin, normalize/simplify/undo/laser, kalite eşik/özet, resume yaşı).
- ~~Yapılmadı: mock e2e, iki tema/375 px~~ → aşağıdaki tamamlama turunda yapıldı.

### Tamamlama turu (frontend-dev, 2026-11-11)
**E2E** `apps/web/e2e/p5-collab.spec.ts` (yalnız `desktop` projesi; mobil müşteri lobiye giremez, AC-33): sohbet iki yön + XSS (`<img onerror>`/`<script>` düz metin, DOM'da img/script yok, `__rsXss` tanımsız) + okunmamış rozeti; dosya teknisyen→müşteri (kabul diyaloğu odak "Reddet", "Kabul et" 1,5 sn kilit, alıcıda `receiving` + `<progress>` gözlendi, indirilen içerik bayt bayt aynı, file.meta OK) ve müşteri→teknisyen (çift/tek uzantı uyarısı, ret → meta REJECTED; kabul → indirme); 1 MB tenant sınırı üstü (1 MiB + 1 bayt) → "Dosya 1 MB sınırını aşıyor.", teklif çıkmaz, meta yok; bozuk SHA (`__rsCorruptSha`) → alıcıda "Dosya bozuk", indirme yok, meta CORRUPT; kalite paneli (FPS/kbps/"Doğrudan") + bitirişte `quality.summary`; kalem/dikdörtgen/geri al/temizle ve lazer müşteri katmanında (`data-strokes`, `data-laser`); `file_transfer` yetkisiz → müşteride Dosyalar sekmesi yok, konsolda uyarı; axe açık/koyu (sohbet, dosyalar, kalite, kabul diyaloğu) + müşteri 375 px taşma yok.
**Mock:** `mock-ws.mjs` `wsLog` (file.meta, quality.summary; kimden) → `GET /__e2e/ws-log/:id` (`mock-api.mjs`); hello/peer.joined'a `caps` + `maxFileMb`. `mock-sessions.mjs`: `u-p5-*` `file_transfer.use` + caps `[file_transfer]`, `u-p5nf-*` yetkisiz; ikisinde `maxFileMb=1` (100 MB dosya üretilmez). `playwright.config.ts` webServer env `NEXT_PUBLIC_RS_E2E=1`.
**E2E'nin bulduğu hatalar (düzeltildi):**
- `lib/webrtc/stats.ts`: `RTCStatsReport` `Map` örneği değil → `[...report]` [anahtar, değer] çifti veriyordu; kalite paneli gerçek tarayıcıda **hiç ölçüm göstermiyordu**, `quality.summary` hiç gitmiyordu. `values()` ile okunur; birim testi eklendi.
- `lib/dc/files.ts`: `file.done` (ctl DC) son parçalardan (file DC) önce gelebiliyor → ~1 MB dosyalar alıcıda **"bozuk"** işaretleniyordu. Eksik baytta en çok 10 sn beklenir, tamamlanınca doğrulanır; birim testi eklendi.
- Kabul diyaloğu: "Reddet" de `disabled` başlıyordu → `data-autofocus` odak alamıyordu (AC-116 varsayılan odak "Reddet" ihlali). Reddet hep etkin; yalnız "Kabul et" 1,5 sn kilitli.
- Teklif, alıcı Sohbet sekmesindeyken gelirse diyalog hiç görünmüyordu (FilesPanel monte değil). Yeni teklifte Dosyalar sekmesine geçilir (konsol `collab-side`, müşteri `guest-collab`; yetkisizde geçiş yok).
- Sohbet: `<ol role="log">` axe `listitem` ihlali → `role=log` kapsayıcı `div`, içinde `<ol>`.
- Sınır metinleri "100 MB" sabitti; tenant `maxFileMb` ile (`collab.maxMb`, `p5.files.limit/err.tooLarge/auto.tooLarge` `{mb}`).
- `annot-layer`: `data-laser` test özniteliği.
**DESIGN.md:** `annot-*` token'ları (§2; `annotate` artık lazer), §4 P5 ikonları (`Undo2`, `PictureInPicture2`, …), §6 chat paneli, dosyalar paneli, kabul diyaloğu davranışı, kalite paneli eşik renkleri, işaretleme araç çubuğu/katmanı, müşteri iletişim + PiP; §6.1 `ui/tabs` yerine `Segmented` kullanıldığı not edildi.
**Doğrulama:** web lint / typecheck yeşil, unit 65/65, `pnpm --filter @remote/web e2e` 128 geçti / 20 atlandı (p5 `--repeat-each=3` 30/30). Atlanan: mobil projede masaüstü akışları (mevcut desen). Görsel (ekran görüntüsü) kontrol yapılmadı; iki tema axe + 375 px taşma testle kapsandı. Skill dosyaları okunmadı (görünüm değişmedi; yalnız test/davranış + doküman).

### Güvenlik düzeltmesi (S-P5-1, S-P5-2, S-P5-3 istemci, S-P5-4, S-P5-5, S-P5-6) — frontend-dev, 2026-11-11
Rota değişikliği yok.
- **S-P5-1/2 (`lib/dc/files.ts`):** gelen `file.offer` alıcıda 10 sn'de en çok 3 (`OFFER_LIMIT`); aşan teklif hiç işlenmez (ctl reddi yok, listeye girmez, `file.meta` yok; `dropped` sayacı). Karşı tarafın tetiklediği raporlar (otomatik ret: caps/tooLarge/cooldown/busy + onay beklerken gelen `file.cancel`) ad+boyut+özet+sonuç anahtarıyla dakikada bir kez tekilleştirilir ve toplam dakikada en çok 5 (`PEER_META_LIMIT`). Kullanıcı kararıyla oluşan raporlar (elle ret, kabul sonrası iptal, OK/CORRUPT) sınırsız. `inc`/`out` Map'leri en çok 100 kayıt (`KEEP`; önce en eski bitmiş kayıt düşer, object URL bırakılır), listede otomatik ret satırı en çok 20 (`AUTO_KEEP`). Sapma: 100 kaydı aşınca en eski tamamlanmış gelen dosyanın indirme bağlantısı da kalkar.
- **Gönderen raporu (mimari-protokol §3 `file.meta`):** gönderen transfer başına bir kez `file.meta` gönderir, yön = giden (müşteri `TO_TECH`, konsol `TO_CUSTOMER`). Sonuç: `file.result` → OK/CORRUPT, karşı taraf reddi → REJECTED, iki taraftan iptal → CANCELLED (yalnız teklif gittiyse). Şema değişikliği yok.
- **S-P5-4:** `lib/dc/sha256.ts` — artımlı saf-TS SHA-256 (bağımlılık yok; WebCrypto `digest` artımlı değil). Alıcı özeti parçalar gelirken hesaplar (ikinci tam kopya ve `blob.arrayBuffer()` yok); gönderen dosyayı 4 MB dilimlerle özetler. Bellek yolu: parçalar 8 MB'lık Blob gruplarına toplanır (tek kopya). Teklif 256 MB'ı aşarsa ve `showSaveFilePicker` varsa kabulde kayıt yeri sorulur, içerik doğrudan diske akar; Chromium yazmayı `close()`'a kadar geçici dosyada tuttuğu için özet uyuşmazsa `abort()` → dosya hiç kaydedilmez. Kayıt penceresi kapatılırsa teklif beklemede kalır. Destek yoksa 512 MB üstünde kabul diyaloğunda bellek uyarısı (`p5.files.bigMem`), destek varsa disk bilgisi (`p5.files.bigDisk`) çıkar.
- **S-P5-5:** indirme Blob'u `type: "application/octet-stream"`. Tamamlanmış satırda tehlikeli/çift uzantı uyarısı indirme bağlantısının yanında yeniden gösterilir (`file-row-danger`).
- **S-P5-6 (`lib/dc/rate.ts`, `use-collab.ts`):** gelen ctl mesajlarında alıcı tarafı sınır var: chat 5/sn, annot (stroke/undo/clear) 30/sn, lazer 30/sn. Aşan mesaj düşer.
- Yeni bileşen/primitif yok (`Alert tone="warning"` kullanıldı). Yeni i18n anahtarları: `p5.files.rowDanger`, `rowDouble`, `bigDisk`, `bigMem`.
- Testler: `lib/dc/p5-guvenlik.test.ts` (SHA-256 = WebCrypto, farklı boyut ve parça sınırlarında; teklif seli; 21 sahte teklif + gerçek transfer → OK raporu var; tekilleştirme; iptal seli; liste sınırı; gönderen raporu; octet-stream; chat/annot sınırı). `e2e/p5-collab.spec.ts` beklentileri gönderen raporunu (ikinci `file.meta` satırı) içerecek şekilde güncellendi.
- Doğrulama: web typecheck, lint, unit (73/73) ve `pnpm --filter @remote/web e2e` (128 geçti, 20 atlandı; atlananlar mevcut mobil atlamaları) temiz.

### QA düzeltmesi (QA-P5-1..4) + S-P5-T2-1 kısmi — frontend-dev, 2026-11-11
Rota değişikliği yok. Yeni bileşen/primitif, yeni bağımlılık, yeni i18n anahtarı yok.
- **QA-P5-1 / AC-53 iptal (`e2e/p5-collab.spec.ts`):** iki senaryo tek testte. (1) teknisyen → müşteri, aktarım sürerken ALICI (müşteri) "İptal"; (2) müşteri → teknisyen, aktarım sürerken GÖNDEREN (müşteri) "İptal". Her ikisinde iki tarafta `data-status=cancelled` + "İptal edildi", alıcıda `file-download` yok, mock ws-log'da iki taraftan `file.meta` CANCELLED (doğru yönle); 1 sn sonra durum değişmiyor. Aktarımı gözlemek için e2e kancası: `FileTransfers` deps'e `chunkDelayMs` eklendi; `use-collab.ts` bunu yalnız `NEXT_PUBLIC_RS_E2E=1` derlemesinde `globalThis.__rsSlowFileMs`'ten okur (üretimde 0). 900 KB × 60 ms/parça ≈ 3,4 sn.
- **QA-P5-2 / AC-37 PiP:** başsız Chromium'da (localhost, güvenli bağlam) `documentPictureInPicture` mevcut → `pip-open` görünür, tıklanınca `pip-close` + "Önizleme yüzen pencerede gösteriliyor." ve önizleme ana belgeden PiP penceresine taşınır, kapatınca buton geri gelir. Test, API yoksa açıkça başarısız olur (sessiz atlama yok). İkinci test: `addInitScript` ile global silinince `pip-open`/`pip-close` hiç render edilmez.
- **QA-P5-3 / AC-57 gecikme:** 20 kalem çizgisi; teknisyende canvas `pointerup` anı, müşteride `annot-layer` `data-strokes` artışı (MutationObserver), ikisi `performance.timeOrigin + performance.now()`. p95 < 200 ms assert. Ölçülen (localhost, 4 koşu): p95 1,1–1,4 ms, en kötü 1,5 ms. Not: localhost'ta ağ gecikmesi yok; gerçek ağ RTT'si bu sayıya eklenir (AC eşiği RTT < 100 ms varsayımıyla).
- **QA-P5-4 / AC-41 1080p FPS:** müşteri bağlamında `addInitScript` ile `getDisplayMedia` stub'ı: 1920×1080 canvas, her 33 ms'de içerik değişir, `captureStream(30)`. Teknisyen Kalite panelinde (kaynak `getStats` `inbound-rtp` `framesPerSecond` / `frameWidth`) "1920×1080" beklenir. Yöntem: ısınma (BWE düşük başlar; `contentHint="detail"` çözünürlüğü koruyup FPS'i düşürür) — ilk ≥ 15 FPS okumasına en çok 30 sn; ardından 6 sn'lik pencerenin medyanı ≥ 15 assert. Sonuçlar: ısınma 4,1–7,7 sn; medyan 30 FPS (P5 dosyası 3 koşu + tam takım 1 koşu, hepsi geçti). İlk sürüm (ısınma beklemeden 8 sn ortalama) tam paralel takımda 0–3 FPS'lik başlangıç örnekleriyle bir kez düştü; bu yüzden ısınma ayrıldı. Gerçek ağ/donanım kodlayıcı ölçümü P6/staging'e kalır (yerel ölçüm yalnız istemci hattını kanıtlar).
- **E2E ortam düzeltmesi (`playwright.config.ts`):** `--disable-features=WebRtcHideLocalIpsWithMdns`. Bu makinede mDNS (`.local`) host adayları çözülemediği için ICE kurulmuyordu (P4 medya testi ve tüm P5 testleri DC hazır beklerken düşüyordu; uygulama hatası değil). Bayrakla host adayı gerçek IP olur; yalnız test tarayıcısı.
- **S-P5-T2-1 (kısmi):** `files-panel.tsx` — tamamlanmış gelen satırda tehlikeli/çift uzantı uyarısı artık `x.url` koşulsuz (disk yolunda da görünür). `diskSink` ve `WritableLike` dışa açıldı; `lib/dc/disk-sink.test.ts` (6 test): özet tuttu → `close` (abort yok), tutmadı → `abort` (close yok), yazım hatası → bozuk + `abort`, `discard` → `abort` ve bitmiş sink'e dokunulmaz; `FileTransfers` kabulünde 256 MB üstü teklifte `showSaveFilePicker` çağrılır, karşı taraf iptalinde yazıcı `abort` edilir, kayıt penceresi kapatılırsa (AbortError) teklif beklemede kalır. Açık kalanlar (bu turda yapılmadı): kabul diyaloğunda "mevcut dosyanın üzerine yazmayın" metni, isteğe bağlı `handle.remove()`; disk yolunun e2e'si (256 MB eşiği e2e'de pratik değil).
- Doğrulama: web lint + typecheck temiz; unit 79/79; tam `pnpm --filter @remote/web e2e` 133 geçti / 25 atlandı (mevcut mobil atlamaları); `p5-collab.spec.ts` desktop 3 ayrı koşu 15/15.

### P5 sayfa testi + QA Tur 2 düzeltmesi (TEST-P5-1..3, QA-P5-7) — frontend-dev, 2026-11-11
Rota değişikliği yok. Yeni bileşen/primitif, yeni bağımlılık yok. Yeni i18n anahtarı: `p5.files.err.rate`, `p5.files.st.timeout`. Contracts değişmedi.
- **TEST-P5-1 [YÜKSEK] — seçilen çözüm: (a) gönderen zaman aşımı + (b) iptal + gönderenin kendi teklif sınırı; (c) alıcıda `file.reject{reason}` YOK.** Gerekçe: `fileRejectSchema` `strictObject` (`reason` alanı contracts değişikliği ister, kapsam dışı) ve alıcının sınır aşımında hiçbir şey göndermemesi S-P5-2'yi olduğu gibi korur (sel büyütülmez, ek ctl/meta yok). `lib/dc/files.ts`:
  - Gönderen kendi tekliflerini `SELF_OFFER_LIMIT` (3 / 11 sn = alıcı penceresi + 1 sn ağ payı; damga teklif gerçekten gittiği an) ile sınırlar → aşınca `send()` `"rate"` döner, teklif hiç çıkmaz, panelde `Alert danger` "Kısa sürede en çok 3 dosya teklif edilebilir; birkaç saniye sonra tekrar deneyin." Dürüst istemcide kilit hiç oluşmaz.
  - Yine de yanıtsız kalan teklif (eski/kötü istemci, kayıp): `OFFER_TIMEOUT_MS = 30 sn` sonra satır `timeout` ("Yanıt yok — teklif zaman aşımına uğradı, yeniden gönderebilirsiniz", `text-warning`), karşıya `file.cancel` (teklif ulaştıysa alıcının diyaloğu kapanır, geç kabul yok sayılır), gönderen raporu `CANCELLED`; `activeOut()` artık serbest. Zamanlayıcı kabul/ret/iptal/dispose'da temizlenir.
  - "offered" satırındaki İptal zaten kilidi açıyordu (durum `cancelled` → aktif değil); artık zamanlayıcıyı da temizliyor; birim testle kanıtlandı.
  - e2e kancaları (yalnız `NEXT_PUBLIC_RS_E2E=1`, `use-collab.ts`): `globalThis.__rsOfferTimeoutMs` (zaman aşımı), `__rsNoSelfThrottle` (gönderen sınırını kapatır → alıcıda düşme yolu).
  - Testler: `lib/dc/p5-teklif.test.ts` (4 test: kendi sınırı + pencere sonrası gönderim; alıcı düşürünce 30 sn'de `timeout` + `file.cancel` + CANCELLED + yeni gönderim; iptal kilidi açar ve geç kabul yok sayılır; kabulde zaman aşımı tetiklenmez). e2e `p5-collab.spec.ts`: "TEST-P5-1: 10 sn'de 4. teklif — gönderen kendi sınırıyla hemen uyarılır…" ve "TEST-P5-1: alıcı 4. teklifi düşürürse gönderen 30 sn içinde 'Yanıt yok' ile çözülür…" (rapordaki kur.ps1/a.js/x.msi/y.scr dizisi, müşteri → teknisyen).
- **TEST-P5-2:** `chat-panel.tsx` `role="log"` kaydırma kabına `tabIndex={0}` + `focus-visible:outline-2 -outline-offset-2 outline-ring` (halka içe, kap kenarında kesilmez). AC-39 axe testine 2000 karakterlik mesaj eklendi; müşteri günlüğü kaydırılabilir hâlde açık/koyu axe temiz ve odaklanabilir.
- **TEST-P5-3:** balon `wrap-anywhere` (`overflow-wrap:anywhere`) + `max-w-full`, `li` `min-w-0` (eski `break-words` flex öğesinin min-content genişliğini küçültmüyordu). AC-39 testi iki tarafta balon ve günlükte yatay taşma olmadığını ölçer.
- **QA-P5-7 kök neden:** `files-panel.tsx` ARM zamanlayıcısının bağımlılığı yalnız `pending?.fid`; ilerleme/başka render'larda yeniden KURULMUYOR (yeni teklif gelmedikçe fid sabit). Düşme yükten: tam paralel takımda misafir sayfası ayrı bağlamda arka planda çalışıyor, 1,5 sn'lik `setTimeout` + yeniden çizim varsayılan 5 sn'lik `expect` bütçesini aşabiliyor. Ürün kodu değişmedi; `acceptOffer()` → `toBeEnabled({ timeout: 10_000 })`.
- **Konsol koyu görünümü (test raporu görsel gözlem):** bulgu değil — DESIGN.md §"Konsol koyu teması (P4)" ve §8 "Konsol varsayılan koyu" kararı: konsol kökünde `.theme-dark` ile kullanıcı tercihinden bağımsız koyu token seti (kullanıcı tema tercihi P12). Değişiklik yapılmadı.

## Agent (P6) — Aşama 1: platformdan bağımsız çekirdek (backend-dev/Go, 2026-11-11)
Kapsam: yalnız `apps/agent-win/` (server, web, contracts, .github değişmedi). Win32 UI, DXGI/MF yakalama, Pion/rtc,
gösterge, overlay, cleanup, CI workflow'ları Aşama 2'de.

### Dosyalar
| Dosya | İçerik | AC |
|---|---|---|
| `go.mod` / `go.sum` | Modül `remote-support/agent-win`, `go 1.25.0`, `toolchain go1.25.14` (ADR-0010 sabit sürüm) | 94 |
| `cmd/noktadestek/main.go` (windows) | İlk iş `dllsafe.Harden()`, sonra `config.Load()` + kendi SHA-256 parmak izi; hata kodlarıyla çıkar | 109, 118, 128 |
| `internal/config` | `serverURL`/`version` YALNIZ `-ldflags -X`; https://host[:port] dışı (http, yol, sorgu, userinfo) red; ldflags'sız build `ErrNotConfigured`; `Fingerprint` = ilk 8 hex | 109, 128 |
| `internal/dllsafe` (windows) | `SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32)` + `SetDllDirectory("")` | 118 |
| `internal/pairing` | `Destek-<8 hane>.exe` (+ tarayıcının ` (1)` eki) → kod; `Normalize` elle giriş ("1234 5678", "1234-5678"); yalnız ASCII rakam | 27, 97 |
| `internal/files` | `SanitizeFileName`, `NameWarning` (tehlikeli/çift uzantı, `DANGEROUS_EXT` ile aynı liste), `AvailableName` (` (n)`, üzerine yazma yok, 255 sınırı korunur); `motw_windows.go` `WriteMOTW` (`:Zone.Identifier` ZoneId=3) | 36, 54, 117 |
| `internal/api` | resolve (`clientKind=AGENT`) / join (gövdede clientKind yok); Origin/Sec-Fetch/Cookie göndermez; sistem kökleriyle TLS ≥1.2, pinning yok; yönlendirme izlenmez; 15 sn timeout; resolve yalnız ağ hatası/502-504'te 3 deneme, 4xx ve join asla tekrar denenmez (nonce tek kullanımlık); hata zarfı → tipli `*api.Error{Status, Code, Message, Fields, RequestID}` | 14, 97, 98, 109 |
| `internal/signal` | `wss://host/ws/guest` (sorgu yok) + `Sec-WebSocket-Protocol: rs.v1, rs.ticket.<t>` / `rs.reconnect.<t>`; sunucu rs.v1 seçmezse kapat; read limit 64 KB; `ParseServer` (zod strictObject eşi: harf duyarlı anahtar, bilinmeyen/eksik alan, enum, ULID, ISO, sınırlar); teknisyene özgü tipler `ErrNotForGuest`; `Encode` gönderimden önce doğrular; ihlalde 1008 | 14, 112, 119 |
| `internal/dc` | `ParseCtl` (12 ctl tipi, strict, ≤16 KB, `control.*` yok), `Allowed` (caps filtresi), `DecodeChunk` (BE başlık), `Receiver` = `FileReceiveGuard` + artımlı SHA-256 + sabit zamanlı karşılaştırma, `FileReply`/`FileResult` | 35, 36, 53–56, 119 |

### Tasarımdan sapmalar (gerekçeli)
1. **Paket adı `pairing`** (görev metninde `internal/code`): mimari §dizin planı `internal/pairing (8 hane)` diyor; mimariye uyuldu.
2. **Parmak izi ldflags ile gömülmedi:** ikilinin kendi SHA-256'sı kendi içine gömülemez (gömmek hash'i değiştirir).
   AC-128'deki "SHA-256 ilk 8 hane" çalışma anında `os.Executable()` dosyasından hesaplanır; `SHA256SUMS` ile aynı değerdir.
   ldflags'ta yalnız `serverURL` ve `version` var.
3. **Pion henüz eklenmedi:** Aşama 1'de rtc kodu yok; kullanılmayan bağımlılık eklenmedi. Aşama 2'de `github.com/pion/webrtc/v4` (MIT) eklenecek.
4. **`golang.org/x/sys` v0.45.0'a sabitlendi:** v0.50.0 `go >= 1.26` istiyor; toolchain 1.25.14.
5. **Proxy:** `http.ProxyFromEnvironment` açık (kurumsal ağ). Hedef adres değişmez, TLS uçtan uca sunucu adına doğrulanır; AC-109 korunur.

### Bağımlılıklar (mimari §10.4 içinde)
| Paket | Sürüm | Lisans | Gerekçe |
|---|---|---|---|
| `github.com/coder/websocket` | v1.8.15 | ISC | WS istemcisi, `Subprotocols` desteği (mimari §10.4) |
| `golang.org/x/sys` | v0.45.0 | BSD-3-Clause | `windows.SetDefaultDllDirectories` (mimari §10.4) |
AGPL/GPL yok.

### Testler (AC adlı, `go test`)
Fixture uyumu: `files` ↔ `packages/contracts/fixtures/file-names.json` (sanitize + warning), `signal` ↔
`fixtures/ws-messages.json` (valid.guest strict çöz + yeniden kodla birebir; invalid.guest red; valid.server misafir
tipleri kabul, teknisyen tipleri `ErrNotForGuest`; iletilen sdp.offer/ice/ice.restart id'siz kabul). TLS: httptest
sertifikası sistem köklerinde değil → resolve ve WS dial reddedilir, sunucuya istek ulaşmaz (AC-109). WS: gerçek TLS
httptest sunucusunda yol `/ws/guest`, sorgu yok, Origin yok, subprotocol `[rs.v1, rs.ticket.<t>]` doğrulanır.

### Komutlar (makinede Go yok → docker)
```bash
cd /Users/mennan/Projeler/Remote
docker run --rm -v "$PWD":/src -v remote-gomod:/go/pkg/mod -w /src/apps/agent-win golang:1.25-bookworm sh -c '
  export GOFLAGS=-mod=readonly; test -z "$(gofmt -l .)" && go vet ./... && go test -count=1 ./... &&
  GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go vet ./... &&
  GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -buildid= \
    -X remote-support/agent-win/internal/config.serverURL=https://<alan-adı>:4450 \
    -X remote-support/agent-win/internal/config.version=<sürüm>" -o bin/NoktaDestek.exe ./cmd/noktadestek'
```
Son çıktı: gofmt temiz; linux `go vet` + `go test` 6/6 paket `ok` (api, config, dc, files, pairing, signal);
`GOOS=windows go vet` temiz; windows/amd64 exe 2,0 MB; `go clean -cache` sonrası ikinci build aynı SHA-256
(`8dad75e5…`, tekrarlanabilir build ön kontrolü); ikilide `/src` veya kullanıcı yolu yok (`-trimpath`).

### Frontend/sunucu için sözleşme notları
Sözleşme değişikliği yok. İstemci resolve/join'i `/api/v1/public/sessions/*` yolundan çağırır, User-Agent
`NoktaDestek/<sürüm>` (yalnız log, G-20). P7'nin `control.*` WS tipleri (`control.request`, `monitor.request`,
`caps.update`, `control.revoke`) contracts'a eklenince `signal.ParseServer` genişletilmeli (şu an bilinmeyen tip → 1008).

### Aşama 2 listesi
- `internal/ui` Win32: karşılama (logo, teknisyen adı, techVerifyCode, sunucu adresi, dolandırıcılık uyarısı, KVKK onayı — AC-98/125), kod giriş alanı (AC-97), lobi bekleme/admitCode (AC-112), hakkında (sürüm + parmak izi + alan adı, AC-128), monitör seçimi (AC-106), Türkçe + PerMonitorV2 (AC-110); `main.go` çıkış kodlarının Türkçe diyalogları.
- `internal/capture` (DXGI Desktop Duplication), `internal/encode` (MF H.264; K4 prototipi), `internal/rtc` (Pion v4: answer, DC'ler, caps filtresi, `file` alıcısı `dc.Receiver` + `files.AvailableName` + `.part` + `WriteMOTW`).
- "İzleniyor" göstergesi her monitörde, 1 sn topmost (AC-103); chat/annotation overlay; `session.ended` → 3 sn çıkış (AC-107); `%TEMP%` cleanup (AC-108); `quality.summary` yok (yalnız tech gönderir).
- `build/app.manifest` (asInvoker, PerMonitorV2), `versioninfo.json`; `test/trace-check.ps1`; `.github/workflows/agent-win.yml` (iki build hash eşitliği, SHA256SUMS, attestation, `go-licenses`), `agent-watch.yml`, `deploy/agent/verify-and-publish.sh` (devops); sunucu indirme ucu (backend).
- Windows runner'da `go test` (dllsafe/MOTW için gerçek Windows testi: Procmon kanıtı AC-118, Zone.Identifier G-06).
- **AC-39 axe ek düzeltmesi (yalnız test):** tam takım koşularından birinde 375 px kabul diyaloğu taramasında `color-contrast: .bg-primary` çıktı. Nedeni: "Kabul et" düğmesi ARM_MS dolunca `disabled:opacity-60` → 1 geçişini (150 ms) yapıyor, tarama bu geçişin ortasına denk geldi. Test artık taramadan önce düğmenin etkin olmasını ve `opacity: 1` olmasını bekliyor. Ürün kodunda değişiklik yok.
- Doğrulama: web lint ve typecheck temiz; unit 83/83 (önceki 79). Tam `pnpm --filter @remote/web e2e` art arda 5 koşu: her birinde 135 geçti, 27 atlandı (mobil atlamaları gerekçeli), kırmızı yok. Önceki iki deneme dizisi tam yeşil değildi. Birinci dizideki bir kırmızı AC-39 axe kararsızlığıydı, yukarıda düzeltildi. Bir koşu, aynı anda başlattığım ikinci `next build` yüzünden bozuldu; bu benim hatamdı, aynı anda iki dizi koşturdum. İkinci dizide makine yük ortalaması yaklaşık 97 iken 2 koşu düştü: 1 ve 4 test, `live()` kurulumunda DC hazır beklerken ve 30 sn test zaman aşımında takıldı. Bu durum altyapı yüküne bağlı olabilir; yeni kodla ilişkisi görülmedi.

## Agent (P6) — Aşama 2: akış, WebRTC, Win32 arayüz (backend-dev/Go, 2026-11-11)
Kapsam: yalnız `apps/agent-win/` (+ kök `.gitignore`'a `.syso` satırı). Öncelik sırası 4 → 1 → 3 → 2 uygulandı;
**2 (DXGI + MF H.264) bu turda yazılmadı** — aşağıda "Eksikler".

### Dosyalar
| Dosya | İçerik | AC |
|---|---|---|
| `internal/flow` (platformdan bağımsız) | Akış durum makinesi: kod (dosya adı/elle, `pairing.Normalize`) → resolve → karşılama/KVKK → join → WS (ticket) → lobi (admitCode) → `hello` → monitör seçimi → `share.state` → offer/answer/ice → `session.ended`. Hata eşleme web misafir metinleriyle aynı (`messages/tr.json` g.*): 404/400 → kod alanına dön, `SESSION_EXPIRED/CONSUMED/CANCELLED`, 429, `LOBBY_FULL`, 403 → son ekran; `NONCE_INVALID` → yeniden resolve + karşılama. AC-24: kabul sonrası kopuşta `rs.reconnect.<token>` ile 120 sn yeniden bağlanma, her `hello`'da **yeni PeerConnection** + `share.state` yeniden; protokol ihlali/4401'de yeniden bağlanmaz. Lobide "Vazgeç" → `session.end` | 24, 97, 98, 106, 107, 112 |
| `internal/rtc` | Pion v4: offer'a answer; H.264 `TrackLocalStaticSample` offer'daki recvonly video transceiver'ına bağlanır (yerel sendonly); `hello.iceServers`/`ice.servers` → `SetConfiguration`; remote description'dan önce gelen ICE kuyruğa alınır; `ctl` → `dc.ParseCtl` + `dc.Allowed` (caps dışı `file.offer` → otomatik `file.reject`); `file` → `dc.DecodeChunk`; `input` ve bilinmeyen kanal kapatılır (P7). `Source` arayüzü: `NextFrame(ctx) (Frame{Annex-B, Duration})` | 52, 53, 119 |
| `internal/transfer` | TO_CUSTOMER alımı: temizlenmiş ad + uyarı → diyalog; kabulde `İndirilenler\<ad>.part` (O_EXCL), alınan bayt sayacı (beyan/tenant sınırı aşımı → `file.cancel` + `.part` silinir), `file.done` → SHA-256 + boyut → yeniden adlandır (üzerine yazma yok, ` (n)`) → MOTW → `file.result` + WS `file.meta` (alıcı raporu). Ret sonrası 30 sn otomatik ret, tek bekleyen teklif, oturum sonunda yarım `.part` silinir | 36, 53, 54, 55, 108 |
| `internal/win` (windows) | CGO'suz user32/gdi32/shell32 bağlamaları, yalnız `NewLazySystemDLL` (G-08) | 118 |
| `internal/ui` (windows) | Tek UI iş parçacığı (LockOSThread) + form çatısı; 96-DPI birimli yerleşim, `GetDpiForWindow` + `WM_DPICHANGED` ile ölçek; ekranlar: kod girişi, karşılama (teknisyen, doğrulama kodu, sunucu, dolandırıcılık uyarısı, "Kötüye kullanımı bildir" → `mailto:`, KVKK metni + ad + onay kutusu; onay+ad olmadan "Bağlan" pasif), lobi (admitCode), monitör seçimi, oturum penceresi (izleniyor etiketi, durum satırı, zaman damgalı sohbet + okunmamış sayacı başlıkta, dosya ilerleme/iptal, "Oturumu bitir"), dosya kabul diyaloğu (Reddet varsayılan/odak, Kabul 1,5 sn kilitli, Enter/Space Kabul'e ulaşmaz, imleç altında açılmaz, tehlikeli/çift uzantı uyarısı), gösterge (her monitörde kırmızı kenarlık + üst-orta etiket, 1 sn'de bir `HWND_TOPMOST`), işaretleme katmanı (renk anahtarlı, tıklama geçirgen; kalem/ok/dikdörtgen/lazer 1 sn/geri al/temizle, 4 renk). Gösterge ve katman `WDA_EXCLUDEFROMCAPTURE` ile yakalamadan hariç | 36, 37, 52, 53, 56, 98, 103, 106, 110, 112, 125, 128 |
| `internal/capture/monitors_windows.go` | `EnumDisplayMonitors` → `signal.Monitor` (kimlik = 1 tabanlı sıra, "Ekran n") + kimlik → dikdörtgen | 106 |
| `internal/capture/source_windows.go` | `Open` şimdilik `ErrUnavailable` döner (bkz. Eksikler); akış `share.state{stopped}` + "Ekran görüntüsü alınamadı" gösterir | — |
| `cmd/noktadestek/main.go` | dllsafe → config → parmak izi → UI → `flow.Run`; son ekran 2,5 sn sonra çıkış (AC-107 "3 sn içinde" için pay) | 107, 109, 118, 128 |
| `build/winres.json`, `build/build.sh` | go-winres v0.3.3 (MIT, yalnız build aracı — ikiliye girmez): manifest `asInvoker`, `permonitorv2,system`, common controls v6, Win10 min; VERSIONINFO (sürüm build argümanından). `.syso` build sonunda silinir, git'e girmez | 95, 96, 110 |
| `internal/signal/conn.go` | `ErrProtocol` + `Fatal(err)` (1008/4401 → yeniden bağlanma yok) | 24 |

### Tasarımdan sapmalar (gerekçeli)
1. **Sohbet ayrı pencere değil, oturum penceresinin bölmesi:** tek pencere, "Oturumu bitir" her an görünür (AC-100 ile uyumlu), daha az kod.
2. **Dosya kaydetme konumu sorulmaz:** her zaman `İndirilenler` (KnownFolder), müşteri seçimi = Kabul/Reddet. Kaydet-diyaloğu (comdlg32) eklenmedi.
3. **Kapanış 2,5 sn:** görev "3 sn sonra", AC-107 "3 sn içinde" diyor; ikisini de karşılamak için.
4. **%TEMP% temizliği kodu yok:** istemci %TEMP%'e hiç yazmıyor (Go runtime, Pion, UI dosya oluşturmaz); tek disk yazımı İndirilenler'deki `.part`'tır ve oturum sonunda/iptalde silinir (`transfer.Close`). Kullanılmayan temizlik kodu yazılmadı; AC-108 iz testi Windows'ta elle doğrulanmalı.
5. **Yeniden bağlanırken üretilen `file.meta` gönderilmez** (soket yok); kayıp nadir, kabul edildi.
6. Karşılamada **firma logosu yok** (aşağıda Eksikler) — AC-98'in bu parçası açık.

### Bağımlılıklar
| Paket | Sürüm | Lisans | Gerekçe |
|---|---|---|---|
| `github.com/pion/webrtc/v4` (+ pion/* alt paketleri, `google/uuid`, `wlynxg/anet`, `x/net`, `x/crypto`, `x/time`) | v4.2.26 | MIT / BSD-3 / BSD-3 | mimari §10.4 (Pion). `x/sys` v0.45.0'da kaldı (go 1.25 uyumu) |
| `github.com/tc-hib/go-winres` (yalnız `go run`, go.mod'a girmez) | v0.3.3 | MIT | manifest + VERSIONINFO `.syso` |
AGPL/GPL yok. `go-licenses` CI adımı devops'ta (agent-win.yml).

### Testler ve son çıktı
```bash
cd /Users/mennan/Projeler/Remote
docker run --rm -v "$PWD":/src -v remote-gomod:/go/pkg/mod -w /src/apps/agent-win golang:1.25-bookworm sh -c '
  export GOFLAGS=-mod=readonly; test -z "$(gofmt -l .)" && go vet ./... && go test -race -count=1 ./... &&
  GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go vet ./... &&
  build/build.sh https://<alan-adı>:4450 <sürüm> bin/a.exe && go clean -cache &&
  build/build.sh https://<alan-adı>:4450 <sürüm> bin/b.exe && sha256sum bin/a.exe bin/b.exe'
```
Son çıktı: gofmt temiz; linux `go vet` temiz; `go test -race` 9/9 paket ok (api, config, dc, files, **flow, rtc, transfer** yeni,
pairing, signal); `GOOS=windows go vet` temiz; iki build aynı SHA-256 (`fd2dc705…`, `go clean -cache` arasında); exe 10,9 MB
(≤ 40 MB); manifestte `asInvoker` ve `permonitorv2` var.
Yeni testler: `flow` (AC-97 elle kod/404 sonrası tekrar, AC-97 süresi dolmuş/tüketilmiş son ekran, AC-98 onaysız join yok +
karşılama verisi, NONCE_INVALID yeniden resolve, AC-106/107 mutlu yol: ticket → lobi → hello → monitör seçimi → share.state →
offer/answer → chat iki yön → annot → session.ended, AC-24 token ile yeniden bağlanma + yeni PeerConnection, protokol ihlalinde
yeniden bağlanmama, lobide vazgeç → session.end, AC-112 lobide ret); `rtc` (gerçek iki Pion eşi: tarayıcı gibi recvonly+DC offer →
answer, ICE `signal.Encode`/`ParseServer` ile taşınır, H.264 track teknisyene ulaşır, ctl chat iki yön, şema dışı ctl düşer;
AC-119 caps yokken `file.offer` → otomatik `file.reject`; ICE kuyruğu); `transfer` (AC-54 doğrula+yeniden adlandır+MOTW, bozuk →
silinir, AC-53 sınır aşımı iptal / sınır üstü teklif otomatik ret, AC-36 30 sn ret beklemesi + tek teklif + çift uzantı uyarısı,
üzerine yazmama + ad temizleme, AC-108 kapanışta `.part` silinir).

### Windows'ta elle doğrulanacaklar (sabah testi)
Ön koşul: staging çalışıyor; exe `build/build.sh https://<staging-alan-adı>:4450 0.6.0` ile (sertifikası sistem köklerinde
olan alan adı — IP ile TLS doğrulaması başarısız olur, AC-109). Konsolda yeni oturum aç, 8 haneli kodu not et.
1. **Dosya adından kod:** exe'yi `Destek-<kod>.exe` olarak kaydet, çift tıkla → doğrudan karşılama açılmalı (kod sorulmaz). SmartScreen'de "Ek bilgi → Yine de çalıştır"; UAC çıkmamalı (AC-95).
2. **Elle kod:** exe'yi `NoktaDestek.exe` adıyla çalıştır → kod penceresi; `12` → "8 rakam" uyarısı; yanlış 8 hane → "Kod geçersiz"; doğru kod → karşılama.
3. **Karşılama:** teknisyen adı, doğrulama kodu (konsoldakiyle aynı), "Bağlanılan sunucu: <alan>", kırmızı dolandırıcılık uyarısı, (ABUSE_EMAIL tanımlıysa) "Kötüye kullanımı bildir" → e-posta istemcisi açılmalı; KVKK metni kaydırılabilir; ad boş veya kutu işaretsizken "Bağlan" pasif; alt satırda sürüm + parmak izi = `SHA256SUMS` ilk 8 hane (AC-128).
4. **Lobi:** 4 haneli kabul kodu büyük yazı; konsolda yanlış kod → bekleme sürer; doğru kod → lobi kapanır. Ayrı denemede konsoldan "Reddet" → "Teknisyen bağlantıyı reddetti" ve ~2,5 sn sonra program kapanır.
5. **Monitör:** iki monitörde seçim penceresi, birincil seçili; tek monitörde sorulmaz.
6. **Gösterge (AC-103):** her monitörde kırmızı kenarlık + üstte "Ekranınız izleniyor — <ad>"; tıklamalar alttaki pencereye geçmeli; başka bir "her zaman üstte" pencere açıp ≤1 sn içinde göstergenin üste döndüğünü gözle.
7. **Görüntü:** bu derlemede ekran yakalama yok → oturum penceresinde "Ekran görüntüsü alınamadı" beklenir, konsol "paylaşım durdu" gösterir; WebRTC bağlantısı yine kurulmalı (sohbet/dosya çalışır).
8. **Sohbet:** iki yönlü, saatli; pencere arka plandayken gelen mesajda başlıkta "(n yeni)" ve görev çubuğu yanıp söner.
9. **Dosya:** konsoldan `rapor.pdf` gönder → diyalog imlecin altında değil, "Reddet" odakta; Enter → reddeder; Kabul ilk 1,5 sn pasif; Tab ile Kabul'e gelip Space/Enter → tetiklememeli; fareyle Kabul → İndirilenler'e kaydedilir, PowerShell `Get-Content <yol> -Stream Zone.Identifier` → `ZoneId=3`. `.exe`/`belge.pdf.exe` → kırmızı uyarı. Reddettikten sonra 30 sn içindeki teklif sessizce reddedilmeli. Aktarım sırasında "Aktarımı iptal et" → `.part` silinmeli.
10. **İşaretleme:** konsoldan kalem/ok/dikdörtgen/lazer/geri al/temizle → paylaşılan monitörde görünmeli, tıklamayı engellememeli, lazer 1 sn'de sönmeli.
11. **Bitiş:** "Oturumu bitir" ve ayrı denemede konsoldan bitir → son metin + ≤3 sn içinde kapanış (AC-107). Pencere X → onay sorusu.
12. **Yeniden bağlanma:** oturumda Wi-Fi'ı 10 sn kapat/aç → "Bağlantı koptu, yeniden bağlanılıyor…" → "Bağlantı yeniden kuruldu".
13. **Ölçek (AC-110):** %100/%125/%150'de karşılama ve oturum penceresi taşmadan okunmalı; pencereyi farklı DPI'lı monitöre sürükle.
14. **İz (AC-108):** kapanıştan sonra `%TEMP%`, `%APPDATA%`, `%LOCALAPPDATA%`, HKCU\Software'de istemciye ait kayıt yok (İndirilenler'deki kabul edilen dosyalar hariç). Procmon: Downloads'ta DLL araması 0 (AC-118).
    Betikle: adım 1'den ÖNCE `pwsh -File apps\agent-win\test\trace-check.ps1 -Mode Snapshot -SnapshotPath C:\iz\once.json`, program kapandıktan sonra `... -Mode Compare -SnapshotPath C:\iz\once.json -ExePath "$env:USERPROFILE\Downloads\Destek-<kod>.exe"` → `TEMİZ`, çıkış 0 (runbook §11.8).
Hata görülürse ekran görüntüsü + adım numarası yeterli.

### Eksikler (Aşama 3)
1. **`internal/capture` DXGI Desktop Duplication + Media Foundation H.264 kodlayıcı yazılmadı** (en büyük parça; K4 prototipi). `Open` açıkça `ErrUnavailable` döner; arayüz (`rtc.Source`) ve akış hazır, kaynak takılınca başka değişiklik gerekmez. Plan: D3D11 cihazı + `IDXGIOutput1.DuplicateOutput` → staging texture → BGRA→NV12 → `CLSID_CMSH264EncoderMFT` (Baseline, GOP ≤ 2 sn — yeniden bağlanmada IDR için) → Annex-B; yakalanamayan karede (Secure Desktop) son kare tekrarı.
2. **Karşılamada firma logosu** (AC-98): `logoUrl` yalnız sunucu alan adından indirilip PNG → DIB ile gösterilecek.
3. **Koyu tema** (1.6): klasik Win32 denetimleri sistem açık temasında; koyu tema desteği yok.
4. `caps.update` / `control.*` WS tipleri (P7) `signal.ParseServer`'da yok; `rtc.Peer.SetCaps` hazır.
5. `peer.joined.maxFileMb` oturum ortasında gelirse alım sınırı güncellenmez (hello değeri kullanılır).
6. CI (`agent-win.yml`, `agent-watch.yml`, `verify-and-publish.sh`, `trace-check.ps1`) devops işi; `build/build.sh` CI'dan çağrılacak biçimde.

### frontend-dev / backend için sözleşme notları
Sözleşme değişikliği yok. İstemci monitör kimliklerini 1'den başlatır ("Ekran 1"…); `share.state.activeMonitor` bu kimliktir
(P7 `monitor.request.monitorId` aynı kimliği kullanmalı). Gösterge ve işaretleme katmanı yakalamaya girmez (konsol kendi çizimini gösterir).

## Agent (P6) — Aşama 3: ekran yakalama + H.264 (backend-dev/Go, 2026-11-11)
Aşama 2 eksiği 1 kapatıldı: `capture.Open` artık gerçek kaynak döner (DXGI Desktop Duplication → CPU BGRA→NV12 →
Media Foundation H.264 → Annex-B). CGO yok; COM vtable çağrıları `syscall.SyscallN` ile, dizinler ve GUID'ler mingw-w64
SDK başlıklarından (d3d11.h, dxgi1_2.h, mfobjects.h, mftransform.h, mfapi.h, codecapi.h, wmcodecdsp.h) betikle doğrulandı.
Bu ortamda (Windows yok) COM/MF kodu **çalıştırılamadı**; yalnız derleme + vet + platformdan bağımsız birim testleri.

### Dosyalar (`apps/agent-win/`)
| Dosya | İçerik |
|---|---|
| `internal/capture/nv12.go` (yeni, platformsuz) | `ConvertBGRA` BGRA → NV12 (BT.601 sınırlı aralık, 2×2 renk ortalaması), DXGI döndürmesi (90/180/270, satır/sütun ofset tablolarıyla — iç döngüde ek maliyet yok), en yakın komşu küçültme; `OutputSize` 1920×1080 sınırına (iki yönde) en-boy korunarak sığdırma, çift boyut |
| `internal/capture/annexb.go` (yeni, platformsuz) | Annex-B NAL ayrıştırma (3/4 baytlık başlangıç kodu), SPS/PPS önbelleği: her IDR önünde SPS/PPS garantisi (`MF_MT_MPEG_SEQUENCE_HEADER`'dan da öğrenir) |
| `internal/capture/ratectl.go` (yeni, platformsuz) | Kare hızı denetimi (hedef 30, alt sınır 15 — AC-41; maliyet EWMA'sı bütçenin %90'ını aşarsa −5, 2 sn %50 altında kalırsa +5), CBR bit hızı (~0,075 bpp, 0,3–8 Mbit/s; 1080p30 ≈ 4,7 Mbit/s), anahtar kare saati (GOP 2 sn + istek, PLI selinde en sık 500 ms'de bir) |
| `internal/capture/com_windows.go` (yeni) | `comObj` vtable çağrısı (`//go:uintptrescapes`), HRESULT, `NewLazySystemDLL` ile d3d11/dxgi/mfplat/ole32 (G-08), IID'ler |
| `internal/capture/dxgi_windows.go` (yeni) | `CreateDXGIFactory1` → adaptör/çıkış taraması, monitör eşlemesi GDI aygıt adıyla (`\\.\DISPLAYn` = `win.Monitors()[id-1].Device`) → `D3D11CreateDevice(adapter)` → `IDXGIOutput1::DuplicateOutput` → `AcquireNextFrame`/staging `CopyResource`/`Map`/`ReleaseFrame`; döndürme `DXGI_OUTDUPL_DESC.Rotation`'dan; yalnız fare hareketi (`LastPresentTime=0`) yeni kare sayılmaz |
| `internal/capture/mf_windows.go` (yeni) | H.264 MFT: önce `MFTEnumEx(HARDWARE)` (asenkron → `MF_TRANSFORM_ASYNC_UNLOCK` + `IMFMediaEventGenerator` olay döngüsü, NO_WAIT yoklama, 500 ms zaman aşımı), olmazsa senkron yazılım MFT (`MFTEnumEx(SYNCMFT)`, son çare `CoCreateInstance(CLSID_CMSH264EncoderMFT)`); Baseline (66), CBR, düşük gecikme, GOP = 2 sn, hız öncelikli; `CODECAPI_AVEncVideoForceKeyFrame` ile anahtar kare; `MF_E_TRANSFORM_STREAM_CHANGE`'de çıkış türü yeniden anlaşılır; çıktı örneğini MFT sağlamıyorsa biz ayırırız |
| `internal/capture/source_windows.go` (yeniden yazıldı) | `Open` → kilitli tek OS iş parçacığında worker (COM MTA + `MFStartup(LITE)`); `NextFrame` kanal üzerinden; ilk kare + kodlayıcı kurulamazsa `Open` hata döner (mevcut "Ekran görüntüsü alınamadı" yolu korunur). Çoğaltma kaybında (ACCESS_LOST, UAC/Güvenli Masaüstü, kilit ekranı, mod/çözünürlük değişimi) oturum kapatılır, 250 ms → 2 sn geri çekilmeyle yeniden açılır; bu sürede son kare 1 sn'de bir yeniden kodlanır. Çözünürlük değişirse kodlayıcı yeniden kurulur + anahtar kare. Ekran değişmiyorsa kodlama yapılmaz (1 sn canlı tutma hariç). `ErrUnavailable` kaldırıldı |
| `internal/rtc/rtc.go` | `KeyframeRequester` (isteğe bağlı kaynak yeteneği): `Stream` başında anahtar kare ister (yeniden bağlanmada yeni eş IDR ile başlar); RTCP okuyucu PLI/FIR'de kaynaktan anahtar kare ister (`drainRTCP` → `readRTCP`) |
| `go.mod` | `github.com/pion/rtcp` dolaylıdan doğrudana taşındı (zaten Pion bağımlılığı; yeni modül yok) |
| testler | `internal/capture/capture_test.go` (yeni), `internal/rtc/rtc_test.go` (+1 test) |

### Tasarımdan sapmalar (gerekçeli)
1. **NV12 dönüşümü CPU'da** (Video Processor MFT değil): sürücü bağımsız, birim testli; 1080p'de tek geçiş + ofset tabloları. Ölçülemedi; Windows'ta 1080p'de dönüşüm + kodlama > 66 ms çıkarsa (≤ 15 fps) GPU dönüşümüne geçmek ayrı iş.
2. **Kodlanan çözünürlük ≤ 1920×1080** (4K/ultra geniş ekranlar en-boy korunarak küçültülür): AC-41 kare hızı ve SDP'deki `profile-level-id=42e01f` (Level 3.1) ile uyum için. Koordinatlar P7'de (uzaktan kontrol) oransal eşlenmeli.
3. **GOP 2 sn** (Aşama 2 planındaki "≤ 2 sn") + PLI/FIR ile anında IDR (500 ms sınırlı).

### Testler ve son çıktı
Komut Aşama 2 ile aynı (`gofmt -l` boş → `go vet` → `go test -race` → `GOOS=windows go vet` → iki `build/build.sh` + `sha256sum`).
Son çıktı: gofmt temiz; linux `go vet` temiz; `go test -race` **10/10 paket ok** (capture yeni); `GOOS=windows go vet` temiz;
iki build aynı SHA-256 (`9d49966c…`, arada `go clean -cache`); exe 11,5 MB; `go mod verify` tamam.
Yeni testler: `capture` — `TestNV12SolidColorsBT601` (siyah/beyaz/kırmızı/mavi Y/U/V), `TestNV12RotationAndStride` (0/90/180/270
+ satır dolgulu stride), `TestNV12ScaleDownAndInvalid` (küçültme, kısa kaynak/tek genişlik/kısa stride reddi),
`TestAC41OutputSizeFitsEncoderLimit` (4K, 1440p, 21:9, dikey, tek boyut), `TestAnnexBSplitAndParamSets` (karışık başlangıç
kodu, IDR'ye SPS/PPS ekleme, sıra başlığından öğrenme), `TestAC41RateControlKeepsAtLeast15FPS`, `TestBitrateBounds`,
`TestKeyClockPLIRateLimited`; `rtc` — `TestAC41KeyframeOnStreamStartAndPLI` (gerçek iki Pion eşi; yayın başı + teknisyenden
PLI ve FIR → kaynakta anahtar kare isteği).

### Windows'ta elle doğrulanacaklar (Aşama 2 listesinin 14 adımına ek)
Adım 7 artık geçersiz: görüntü gelmeli. Konsolda `chrome://webrtc-internals` açık tutulursa fps/bit hızı/çözünürlük okunur.
15. **Görüntü (AC-41):** 1920×1080 monitör paylaşımı ≤ 3 sn içinde konsolda görünür; video oynatırken/pencere sürüklerken `framesPerSecond` ≥ 15 (hedef 30); `webrtc-internals`'da `keyFramesDecoded` 2 sn'de bir artar; masaüstü durgunken bant genişliği düşer.
16. **Donanım/yazılım kodlayıcı:** Intel/AMD/NVIDIA GPU'lu makinede ve GPU'suz VM'de (Hyper-V/VirtualBox, "Microsoft Basic Display Adapter") ayrı ayrı görüntü gelmeli (VM'de yazılım MFT). Görüntü yeşil/bozuksa veya hiç gelmiyorsa makine/GPU modeli not edilsin (asenkron MFT olay döngüsü).
17. **Monitör eşlemesi:** iki monitörde "Ekran 2" seçilince gerçekten 2. monitör gelmeli; göstergenin çizildiği monitörle aynı olmalı.
18. **Gösterge yakalamaya girmez:** konsoldaki görüntüde kırmızı kenarlık/üst çubuk ve işaretleme çizimleri **görünmemeli** (Win10 2004+). Win10 1909 ve öncesinde görünebilir — sürümü not edin.
19. **Ölçek/DPI:** %150 ölçekli 4K monitörde görüntü tam masaüstü (kesik değil), 1920×1080'e küçültülmüş ve keskin; yazılar okunur.
20. **Döndürme:** Ekran ayarlarından monitörü "Dikey" ve "Dikey (ters çevrilmiş)" yap → görüntü konsolda doğru yönde (dik, ayna değil); yan yatık/ters gelirse hangi yön olduğu not edilsin (90/270 eşlemesi Windows'ta doğrulanmadı).
21. **Kayıp ve yeniden kurulum:** paylaşım sürerken (a) UAC isteyen bir şey çalıştır (Güvenli Masaüstü), (b) Win+L kilit + aç, (c) çözünürlüğü değiştir, (d) tam ekran bir oyun/video aç-kapa → her birinde görüntü en çok ~2 sn donar, sonra kendiliğinden devam eder; akış "durdu"ya düşmemeli.
22. **PLI:** konsol sekmesini 30 sn arka plana alıp geri getir / ağ kesintisi sonrası yeniden bağlanma (adım 12) → görüntü gri/bozuk kalmadan ≤ 1 sn içinde düzelmeli.
23. **Kaynak tüketimi:** Görev Yöneticisi'nde 1080p paylaşımda istemci CPU'su not edilsin (yazılım kodlayıcıda yüksek olabilir); oturum bitince istemci süreci kapanmalı (iş parçacığı/COM sızıntısı yok).
24. **Windows N:** Media Feature Pack yoksa paylaşım "Ekran görüntüsü alınamadı" ile durmalı, program çökmemeli.

### Yazılamayan / doğrulanamayan kısımlar
1. **Fare imleci görüntüye çizilmiyor:** Desktop Duplication imleci kareye katmaz; `GetFramePointerShape` + birleştirme yapılmadı. Teknisyen imleci göremez (P7 uzaktan kontrol öncesi gerekli olabilir).
2. **COM/MF çalışma zamanı doğrulanmadı:** vtable dizinleri/GUID'ler başlıklardan doğrulandı ama donanım MFT'lerinin (özellikle sistem belleği NV12 kabul etmeyen, D3D yöneticisi isteyenler) davranışı denenmedi; donanım kurulumu hata verirse yazılım MFT'ye düşülür, ancak donanım MFT kurulup **çalışma sırasında** hata verirse yazılıma otomatik geçiş yok (akış durur → adım 16).
3. **Kirli dikdörtgen (dirty rect) optimizasyonu yok:** her yeni karede tam yüzey kopyalanıp dönüştürülür.
4. **Win10 2004 öncesi** `WDA_EXCLUDEFROMCAPTURE` desteklenmez; gösterge görüntüde görünebilir (adım 18).
5. Aşama 2 eksiklerinin 2–6. maddeleri (logo, koyu tema, P7 tipleri, `maxFileMb` güncellemesi, CI) değişmedi.

### frontend-dev / backend için sözleşme notları
WS/DC sözleşmesi değişmedi. Video H.264 Constrained Baseline, en çok 1920×1080 (büyük ekranlar küçültülür); tarayıcı
PLI/FIR gönderirse istemci ≤ 500 ms içinde IDR üretir.

### Bakım: Go 1.26 + x/net güvenlik yükseltmesi (backend-dev/Go, 2026-11-11)
- Neden: CI govulncheck 12 erişilebilir zafiyet buldu. Kaynakları Go 1.25.14 stdlib'i (net/http, crypto/tls,
  crypto/x509, net/textproto; Go 1.25 desteği bitti, düzeltme go1.26.11'de) ve `golang.org/x/net v0.50.0`
  (düzeltme v0.60.0'da).
- `apps/agent-win/go.mod`: `go 1.26.0`, `toolchain go1.26.11` (Docker Hub'daki en güncel 1.26.x yaması).
  `golang.org/x/net v0.50.0 → v0.60.0`. MVS bunun gereği olarak `golang.org/x/sys v0.45.0 → v0.48.0` ve
  `golang.org/x/crypto v0.48.0 → v0.57.0` yükseltti. Pion ve diğer bağımlılıklar değişmedi.
- İmaj: `golang:1.26.11-bookworm@sha256:dc40a13b61304647ed7e5d581d246b86413dfc29d63c6d018310feb93cd98fc0`.
  Güncellenen yerler: `.github/workflows/agent-win.yml` (`GO_IMAGE`, `GO_VERSION`, container'lar),
  `.github/workflows/agent-watch.yml`, `docs/runbook.md` §11.2. `build/build.sh` sürüm sabiti taşımıyor, değişmedi.
- Doğrulama (aynı imaj): gofmt temiz, `go vet` ve `GOOS=windows go vet` temiz, `go test -race ./...` 10/10 paket ok.
  `govulncheck` (windows/amd64 + linux) **0 erişilebilir zafiyet** verdi. `build.sh` iki kez çalıştırıldı ve
  SHA-256'lar eşit çıktı. actionlint temiz.
- Açık kalan (erişilemez, yalnız modül düzeyinde): GO-2026-6866 ve GO-2026-6860 (x/net/html, v0.62.0'da
  düzeltildi), GO-2026-5932 (x/crypto/openpgp). Kod bu paketleri içe aktarmıyor ve CI kapısını etkilemiyor.
  Görev "en küçük yükseltme" olduğu için x/net v0.62.0'a çıkılmadı. Günlük `agent-watch` izliyor.

### Düzeltme turu 1 (backend-dev/Go, 2026-11-11) — S6-1, S6-3, S6-6 (not), S6-7, S6-8, QA-P6-1, QA-P6-4
**Değişen / eklenen dosyalar (`apps/agent-win/`)**
- `internal/win/win_windows.go`, `internal/win/doc.go`, `internal/win/unsafeptr_test.go` — **S6-1:** `ptr()` kaldırıldı;
  her UTF-16 tamponu yerel değişkende tutulup `uintptr(unsafe.Pointer(p))` dönüşümü yalnız `LazyProc.Call(...)`
  argümanında yapılıyor (CreateWindow, SendMessageStr, SetText, MessageBox, DrawText, Font, OpenMailto).
  `SendMessageStr` artık `SendMessage(…, uintptr)` sarmalayıcısından geçmiyor. Paket belgesi `doc.go`'ya taşındı
  (testin Linux'ta da koşması için). `unsafeptr_test.go` AST ile tüm `internal/**` + `cmd/**` dosyalarını tarar:
  `uintptr(unsafe.Pointer(…))` yalnız `Call`/`call`/`procHR`/`SyscallN` argümanında olabilir; `call` ve `procHR`'ın
  `//go:uintptrescapes` taşıdığını da denetler. Mutasyonla doğrulandı (yardımcıya geri eklenen dönüşüm testi kırıyor).
- `internal/capture/com_windows.go` — **S6-1 (tarama bulgusu):** değişken argümanlı `procHR` sarmalayıcısında
  `//go:uintptrescapes` yoktu; `&yerel` dönüşümleri (MFCreateSample, D3D11CreateDevice, MFTEnumEx…) yığın büyümesinde
  bayatlayabilirdi. İşaret eklendi (`comObj.call`'da zaten vardı). ui/files/dllsafe'de kalıp yok; `form_windows.go`
  WM_DPICHANGED `lParam` okuması işletim sistemi belleği olduğu için kapsam dışı.
- `internal/api/logo.go` (+`logo_test.go`) — **QA-P6-1 / AC-98:** `Client.LogoURL` resolve yanıtındaki
  `tenant.logoUrl`'i (mimari-api `/public/sessions/resolve`; logo ucu `/public/files/logo/:tenantId/:file`) yalnız
  kök-göreli yol veya gömülü sunucuyla aynı şema+host+port olan mutlak URL olarak kabul eder (`//host`, userinfo,
  fragment, `data:`/`file:`, ters bölü, CR/LF reddedilir). `Client.Logo` aynı TLS doğrulamalı, yönlendirme izlemeyen
  istemciyi kullanır; yalnız 200 + `image/png|image/jpeg` başlığı + aynı türün sihirli baytları, ≤ 2 MB
  (Content-Length ve okunan bayt), çözmeden önce `DecodeConfig` ile ≤ 2048×2048; yalnız o türün çözücüsü.
  `ValidAbuseEmail` (**S6-7**): basit e-posta biçimi, ≤ 190 (sunucu `ABUSE_EMAIL` z.email().max(190) ile aynı);
  `?`, `&`, boşluk, denetim karakteri biçim gereği reddedilir.
- `internal/flow/flow.go` (+test) — `Welcome.Logo image.Image`, `Deps.Logo`; logo 3 sn zaman aşımıyla indirilir, her
  hatada nil (sistem logosu). Geçersiz `abuseEmail` → boş ("Kötüye kullanımı bildir" gizli).
- `internal/ui/logo.go` (+`logo_test.go`), `internal/ui/assets/nokta-kucuk.png` (NOKTA_LOGO'dan kopya, `go:embed`),
  `form_windows.go` (`picture` denetimi: SS_BITMAP + 24 bit DIB, her DPI değişiminde yeniden üretilir, bitmap'ler
  form kapanınca silinir), `screens_windows.go` (karşılamada sağ üstte 128×68 logo kutusu; firma logosu yoksa Nokta
  amblemi). `win.Bitmap24` (CreateDIBSection) eklendi. `cmd/noktadestek/main.go`: `Logo: client.Logo`.
- `internal/transfer/transfer.go`, `rename_windows.go`, `rename_other.go` (+testler) — **S6-3:** MOTW artık
  `.part`'a, kapanıştan sonra ve yeniden adlandırmadan önce yazılıyor (ADS taşınır). Yeniden adlandırma
  `MoveFileEx(src, dst, 0)` (değiştirme bayrağı yok); `ERROR_ALREADY_EXISTS/ERROR_FILE_EXISTS` → `AvailableName` ile
  en çok 5 deneme. MOTW yazılamazsa: tehlikeli/çift uzantılı dosya silinir, `file.result ok=false`, `file.meta
  REJECTED`, kullanıcıya "Dosya kaydedilmedi … güvenlik işareti yazılamıyor"; uyarısız türde eskisi gibi uyarıyla
  teslim. Windows dışı eş (yalnız test): `os.Link` + `Remove` (hedef varsa EEXIST).
- `internal/rtc/rtc.go` (+test) — **S6-7:** offer öncesi uzak ICE kuyruğu `MaxPendingICE = 64`; fazlası sessizce düşer.
- `internal/files/files.go` (+test), `packages/contracts/src/files.ts`, `packages/contracts/fixtures/file-names.json`
  — **S6-8:** `one onepkg wsc sct diagcab website ade adp mde mshxml jnlp cab` iki listeye eklendi; fixture'a 12 örnek.
  Yeni `TestS68DangerousExtMatchesContracts` Go listesini `files.ts` içindeki `DANGEROUS_EXT` ile birebir karşılaştırır
  (önceki fixture yalnız örnek içeriyordu, liste farkını yakalamıyordu). `apps/server` testine dokunulmadı; mevcut
  fixture testi yeni örnekleri otomatik kapsıyor.
- **QA-P6-4:** `internal/files/motw_windows_test.go` (gerçek ADS'de `ZoneId=3`), `internal/dllsafe/dllsafe_windows_test.go`
  (`Harden` iki kez hatasız + System32 DLL yüklenir), `internal/transfer/rename_windows_test.go` (MOTW'un
  MoveFileEx ile taşınması + üzerine yazmama). Yerelde `GOOS=windows go vet` ve tüm paketler için
  `GOOS=windows go test -c` derlendi; koşumu CI `test-windows` job'unda.

**S6-6 (HTTP(S)_PROXY):** davranış değiştirilmedi (`Proxy: http.ProxyFromEnvironment` duruyor). Gerekçe: kurumsal
müşteri ağlarında açık proxy zorunlu olabilir; sunucu adresi değişmez ve TLS sunucu adına sistem kökleriyle
doğrulandığından MITM yok, etkisi meta veri/engelleme ile sınırlı. Mimar kararı (T13 metni "yalnız URL" mı, `Proxy: nil`
mı) bekleniyor; karar `nil` olursa tek satırlık değişiklik (`internal/api/api.go` `newClient`).

**Sapmalar:** QA "logo URL'si flow testinde" dedi; köken kuralı `api.Client.LogoURL`'de (temel URL orada) ve flow testi
(`TestAC98WelcomeLogoOnlyFromServerHost`) aynı fonksiyonu kullanarak yabancı kökende Welcome.Logo'nun nil kaldığını
doğruluyor. Logo ekranı geciktirmesin diye üst süre 3 sn (AC-96 ≤ 5 sn bütçesi). Yeni bağımlılık yok (stdlib
`image/png`, `image/jpeg`).

**Doğrulama (docker `golang:1.26.11-bookworm@sha256:dc40a13b…`, repo kökü bağlı, 2026-11-11):**
gofmt temiz; `go vet ./...` + `GOOS=windows go vet ./...` temiz; `go mod verify` ok; `go test -race -count=1 ./...`
12/12 paket ok; govulncheck v1.7.0 (windows/amd64 + linux) "No vulnerabilities found"; `build/build.sh` iki kez →
SHA-256 `471023c7d02128050c8b7b91cc5a4416c8385ef07fa258fea8ae25e2f83c311e` ×2 (11,97 MB). contracts değiştiği için
`pnpm -r run typecheck` (3/3) ve `pnpm -r run test`: contracts 32/32, server 178/178, web 99/99; contracts lint temiz.

**Windows'ta elle:** karşılamada logo (firma logosu P9'a kadar sunucuda `logoUrl: null` → Nokta amblemi görünmeli),
%100/%150 ölçekte logo netliği, FAT32/exFAT USB'ye yönlendirilmiş İndirilenler'de `.exe` teklifinin kaydedilmemesi.

## Backend P6 — Windows istemcisi indirme ucu (backend-dev, 2026-11-11)
Kapsam: yalnız sunucu tarafı `GET /api/v1/public/agent/download?ref=<sessionRef>` (mimari-api public tablosu, P3 giriş
şartı 1; AC-27 sunucu kısmı, AC-96 sunucu bütünlük kapısı, G-07, G-10). `apps/agent-win/**` değiştirilmedi.

### Değişen dosyalar
| Dosya | Değişiklik |
|---|---|
| `apps/server/src/public/routes.ts` (yeni) | `publicAgentRoutes` (`/api/v1/public/agent`), `Cache-Control: no-store` hata yanıtlarında da; ref biçimi `sessionStatusQuerySchema` (aynı opak sessionRef) |
| `apps/server/src/public/agent.ts` (yeni) | Servis: tüm istekler ipKey 20/dk → kod yolu kova kilidi → ref HMAC → PENDING + süresi dolmamış → ikili kapısı → `/downloads/Destek-<kod>.exe`. Geçersiz ref / 410 başarısız deneme sayılır (resolve ile **aynı** `codeIp`/`codePrefix` kovaları + `rs_resolve_failed`). Süresi dolmuş PENDING aynı istekte EXPIRED yapılır (resolve ile aynı) |
| `apps/server/src/public/agent-binary.ts` (yeni) | `AgentBinary`: volume'daki ikilinin SHA-256'sı `AGENT_SHA256` ile eşleşmedikçe indirme 503 (fail-closed). Dosya değişince (boyut/mtime/inode) yeniden hesaplanır; eşzamanlı çağrılar tek hesaplama; sorun durumu geçişte bir kez `alarm: "agent_binary"` logu (yol/hash yazılmaz) |
| `apps/server/src/sessions/public.ts` | `consume`, `GONE` dışa açıldı; resolve kod yolundaki kilit kontrolü/başarısız sayım `assertLookupAllowed` + `countFailedLookup` olarak çıkarıldı (davranış aynı, indirme ucu ortak kullanır); `downloadIp` (21/dk eşik = 20 serbest) eklendi |
| `apps/server/src/sessions/repo.ts` | `findForDownload` (id, tenantId, status, expiresAt, activeCode) |
| `apps/server/src/app.ts` | `agentBinary` dekoratörü + açılışta ısıtma (`onReady`), rota kaydı |
| `apps/server/src/env.ts` | `AGENT_BINARY_PATH` (mutlak yol), `AGENT_SHA256` (64 hex, küçük harfe indirilir); ikisi de opsiyonel — boşsa indirme 503, server açılır |
| `apps/server/src/lib/logger.ts` | Redaksiyona `*.ref` (savunma; URL serileştiricisi sorgu dizesini zaten yazmıyor) |
| `deploy/Caddyfile` | `@agentExe` (`/downloads/(NoktaDestek\|Destek-<8 hane>).exe` → aynı `NoktaDestek.exe`, `Content-Disposition: attachment; filename="<ad>.exe"`, `octet-stream`, `no-store`, `nosniff`); diğer `/downloads/*` 404. Log filtresi: `/downloads/Destek-***`, `resp_headers>Content-Disposition delete` |
| `deploy/docker-compose.yml` | `agent_downloads` volume'u (server `/data/downloads:ro`, caddy `/srv/downloads:ro`); server env `AGENT_BINARY_PATH` (sabit), `AGENT_SHA256: ${AGENT_SHA256:-}` |
| `.env.example`, `docs/runbook.md` (§3 env, §5 log, §7 sorun giderme) | Yeni değişkenler ve 503/`agent_binary` alarmı |
| `apps/server/test/integration/agent-download.test.ts` (yeni), `apps/server/test/unit/agent-binary.test.ts` (yeni), `test/helpers/tenant-matrix.ts` (rota sınıfı `public`) | Testler |

### Tasarımdan sapmalar (gerekçeli) — mimar onayı / mimari-api güncellemesi gerekir
1. **302 hedefi `/downloads/NoktaDestek.exe` değil `/downloads/Destek-<kod>.exe`.** Tarayıcılar 3xx yanıtındaki
   `Content-Disposition`'ı yok sayar; dosya adı son yanıttan (ya da URL yolundan) gelir. Sözleşmedeki biçimle dosya
   `NoktaDestek.exe` olarak kaydedilir ve istemci kodu dosya adından okuyamaz (AC-27/AC-97 kırılır). Çözüm: Caddy her
   iki adı da aynı jenerik ikiliyle sunar, `Content-Disposition` son yanıtta. Bu statik yol kod doğrulamaz ve sızdırmaz
   (her 8 hane aynı ikiliyi verir); kod yalnız müşterinin tarayıcısına giden `Location`'da (Caddy logunda silinir) ve
   istek yolunda (logda `Destek-***`) bulunur. 302 yanıtına `Content-Disposition` **konmadı** (etkisiz + Caddy loguna kod yazardı).
2. **503 kodu:** mimari "uyuşmazlıkta indirme 503" diyor, kod belirtmiyor. Yeni hata kodu eklemek yerine mevcut
   `NOT_READY` (503) özel mesajla kullanıldı (contracts değişmedi). Yapılandırma eksik / dosya yok da 503 (fail-closed).
3. **Başarılı indirme audit'e yazılmaz:** mimari bu uç için audit tanımlamıyor; süresi dolmuş PENDING için mevcut
   `session.expired` satırı yazılır. ref/kod hiçbir audit/log satırında yok (testle kanıtlı).
4. **Sürüm env'i eklenmedi:** mimari §8.1'de sunucu tarafı sürüm değişkeni yok; sürüm ikilide ldflags ile (G-07).
   SHA-256 API'ye eklenmedi: mimari parmak izini web'de değil istemci karşılama penceresinde gösteriyor (T13, AC-128).

### Bağımlılık
Yok.

### Testler ve son çıktı
- `pnpm -r run lint` · `pnpm -r run typecheck`: temiz. `pnpm -r run test`: contracts 32, server unit 166, web 83 — yeşil.
- `eval "$(apps/server/scripts/test-db.sh up)" && pnpm --filter @remote/server test:int`: **21 dosya / 137 test yeşil**.
  Yeni (AC adlı): PENDING → 302 + no-store + çerez yok + tüketmez; CANCELLED/EXPIRED/ACTIVE/ENDED/süresi dolmuş PENDING → 410
  (sebep kodlu, DB EXPIRED olur); geçersiz ref (yanlış HMAC, biçimsiz, eksik, bilinmeyen) → 404; 11. başarısız/dk → 429
  (Retry-After ≈ 15 dk, kilit geçerli ref'i de keser, başka IP etkilenmez); 410'lar resolve kod yolu kovasını doldurur;
  /24 önek kovası 31. başarısızlıkta 429 + global sayaç; tüm istekler 20/dk; hash uyuşmazlığı/yapılandırma yok/dosya yok → 503;
  ref ve kod log ve audit'te yok. Birim: `AgentBinary` durumları, dosya değişince yeniden hesaplama, env doğrulama, `*.ref` redaksiyonu.
- Caddy (`caddy:2.11.9-alpine`, sabit digest) konteynerde elle doğrulandı: iki ad 200 + doğru `Content-Disposition`,
  `Destek-1234.exe`/`x.exe` 404, erişim logunda `uri: /downloads/Destek-***`, `Content-Disposition` silinmiş.
  `docker compose config` geçerli.

### frontend-dev / devops için notlar
- **frontend-dev:** AC-27 web karşılamadaki "Hızlı Destek uygulamasını indir" butonu P6'ya atanmadığı için yapılmadı.
  Yapılacaksa bağlantı `href="/api/v1/public/agent/download?ref=<sessionRef>"` (resolve yanıtındaki `sessionRef`);
  503 `NOT_READY` → "indirme şu anda kullanılamıyor, tarayıcı modu" yolu; 410/404/429 standart hata zarfı. Contracts değişmedi.
- **devops:** `verify-and-publish.sh` ikiliyi `agent_downloads` volume'una `NoktaDestek.exe` adıyla (0644) koymalı ve
  `AGENT_SHA256`'yı yazıp `docker compose up -d server` çalıştırmalı. `agent-watch` kodsuz `GET /downloads/NoktaDestek.exe`'yi çekebilir.
- **Açık bulgu (devops/güvenlik, mevcut durum):** Caddy `log { format filter }` yalnız erişim logunu süzer. Upstream'e
  ulaşılamadığında (`http.log.error`, ör. 502) tam URI — sorgu dizesindeki `ref`, `/session/<token>` dahil — filtresiz
  yazılır (konteynerde doğrulandı). G-10 kapsamında error logger'ın da süzülmesi/kapatılması gerekir.

## Backend P6 — düzeltme turu 1 (backend-dev, 2026-11-11)
Kapsam: güvenlik raporu "P6 kod turu 1" **S6-2 (Orta)** ve **S6-9 bilinen 3 (G-10, Caddy hata logu)**. Başka madde açılmadı.

### Karar: `forward_auth` (dosyayı server'dan akıtma değil)
Caddy statik sunumu (Range, HEAD, sendfile) korunur; server yalnız önbellekli hash durumunu (`AgentBinary.check()`,
boyut/mtime/inode anahtarlı) döner, büyük gövde Node'dan geçmez. Server erişilemezse forward_auth 502 → yine fail-closed.

### Değişen dosyalar
- `apps/server/src/public/agent.ts` — `assertAgentReady(binary)` (503 `NOT_READY`); indirme ucu ve iç uç aynı kapıyı kullanır.
- `apps/server/src/public/routes.ts` — `internalAgentRoutes`: `GET /internal/agent-ready` → 204 / 503, `Cache-Control: no-store`.
  Erişim: soket adresi `TRUSTED_PROXY_CIDR` içinde (tanımsızsa yalnız loopback) **ve** `X-Forwarded-Method` başlığı (forward_auth
  işareti) yoksa 404. XFF değil soket adresi esas alınır (XFF ile taklit edilemez; test var).
- `apps/server/src/app.ts` — `internalAgentRoutes` `/internal` önekiyle kaydı (tek satır).
- `apps/server/test/helpers/tenant-matrix.ts` — AC-69 sınıflandırması: `GET /internal/agent-ready` = public.
- `apps/server/test/integration/agent-download.test.ts` — 5 yeni test (hazır 204; uyuşmazlık/dosya yok/yapılandırma yok 503;
  yayından sonra tahrif → yeniden başlatmadan 503; dış soket / başlıksız / CIDR dışı / XFF taklidi 404; sorgu dizesi loga yazılmaz).
- `deploy/Caddyfile` — `@agentExe` bloğu `route { forward_auth server:3001 { uri /internal/agent-ready; header_up X-Forwarded-Uri "/downloads/***" } … file_server }`
  (`route` sırayı sabitler: kapı `header`/`rewrite`'tan önce; aksi halde 503 JSON `Content-Disposition: …exe` ile inerdi; koddan
  oluşan ad server'a gitmez). `@ops`'a `/internal /internal/*` eklendi (dışarıya 404). Global `log default` + aynı `filter` alanları
  (G-10): Caddy 2.11'de hata logu `http.log.error.log0` adıyla **default** logger'a düşüyor (site `log` yalnız `http.log.access.log0`'ı
  içeriyor), bu yüzden filtre orada da gerekli.
- `docs/mimari-api.md` (Operasyon) — iç uç satırı. `docs/runbook.md` §5 (hata logu maskesi), §10 (503 satırı + iç uç kontrolü), §11.
- `deploy/docker-compose.yml` değişmedi (caddy zaten `edge`'de 172.30.0.2; server `TRUSTED_PROXY_CIDR=172.30.0.2/31`).

### Tasarımdan sapmalar
- Yeni iç uç `GET /internal/agent-ready` (mimari-api'ye işlendi; güvenlik raporundaki önerinin `/api/v1/public/agent/ready` yolu
  yerine `/api` dışı seçildi: Caddy `/api/*`'ı server'a yönlendirdiği için `/api` altında olsaydı dışarıdan erişilebilirdi).
- 503 gövdesi server'ın standart JSON hata zarfı (Caddy forward_auth yanıtı olduğu gibi döner); `.exe` adı/Content-Disposition yok.

### Bağımlılık
Yok.

### Testler ve son çıktı (2026-11-11)
- Test DB: `TEST_DB_CONTAINER=rs-mysql-s62 TEST_DB_PORT=33362 apps/server/scripts/test-db.sh up` (sonra `down`).
- `pnpm --filter @remote/server lint` ✓ · `typecheck` ✓ · `test` 11 dosya / 166 test ✓ · `test:int` 21 dosya / 142 test ✓.
- `caddy validate` (caddy:2.11.9-alpine, proje imajı) → `Valid configuration`; `caddy adapt` → default logger `exclude: [http.log.access.log0]`
  korunuyor, `request>uri` `multi_regexp` 3 işlem.
- Konteyner denemesi (gerçek server host'ta, Caddy konteynerde; `server:3001` → host): hash eşleşirken `/downloads/NoktaDestek.exe` ve
  `/downloads/Destek-12345678.exe` 200 (hash doğru); dosyaya 1 bayt eklenince ikisi de **503** `NOT_READY` (Content-Disposition yok,
  `no-store`), server logunda bir kez `alarm: "agent_binary" state: "mismatch"`; geri yüklenince 200; dosya silinince 503;
  `/internal/agent-ready` dışarıdan 404; `/downloads/Destek-1.exe` 404.
- Gerçek 502 (server durduruldu, web yok): `?ref=SECRETREF…`, `/downloads/Destek-87654321.exe`, `/session/TOKEN…?x=…`, Cookie/Authorization/Referer
  başlıklı istekler → Caddy logunda gizli dizelerin sayısı **0**; hata satırlarında `uri` `/api/v1/public/agent/download`, `/downloads/Destek-***`,
  `/session/***`. Aynı denemede eski Caddyfile (global filtre yok) hata logunda `"uri":"/api/v1/public/agent/download?ref=SECRETREF123"` ve
  `"/downloads/Destek-87654321.exe"` yazıyordu (açık doğrulandı ve kapandı).

### devops / frontend-dev için notlar
- `.github/workflows/agent-watch.yml` (dokunulmadı): `server503` dalı artık gerçek dağıtım yolunda tetiklenebilir (Caddy 503 döner);
  ölü kod değil. Server ayakta değilse Caddy 502 döner — gözcünün 502'yi nasıl sınıflandırdığı devops'a ait.
- Frontend sözleşmesi değişmedi.

## DevOps (P6) — istemci CI, yayın, dış gözcü (2026-11-11)
### Dosyalar
| Dosya | İçerik | AC |
|---|---|---|
| `.github/workflows/agent-win.yml` | `check` (Go imajı digest sabit konteyner: toolchain=go.mod, gofmt, `go mod verify`, vet, `go test -race`, windows vet, govulncheck v1.7.0 windows+linux, go-licenses v2.0.1 forbidden/restricted/unknown yasak) · `test-windows` (windows-2025, `go test`) · `build` ×2 ayrı runner (`build/build.sh`, `SOURCE_DATE_EPOCH`=commit) · `reproducible` (iki SHA-256 eşit, ≤40 MB, MZ, UPX yok, `SHA256SUMS`) · `attest` (push/dispatch; yalnız bu job `id-token`/`attestations: write`) · `release` (yalnız `v*`, `environment: agent-release`, yalnız bu job `contents: write`) | 94, 96 |
| `.github/workflows/agent-watch.yml` | günlük: `AGENT_WATCH_URL` exe hash'i ∈ herhangi bir Release `SHA256SUMS` (rollback alarm değil); 503 veya uyuşmazlık → `agent-watch` etiketli issue + kırmızı koşu; günlük govulncheck | 128, G-07 |
| `.github/dependabot.yml` | `gomod` `/apps/agent-win` haftalık | G-18 |
| `deploy/agent/verify-and-publish.sh` | `--tag`/`--run`/`--dir`; SHA256SUMS + PE/boyut/packer + `gh attestation verify` (repo, signer-workflow, source-ref, self-hosted red) operatör makinesinde; `--ssh` ile betik kendini `--apply` modunda sunucuya taşır: bayt eşitliği → `remote_agent_downloads` volume'una 0644 atomik yazım (compose'daki caddy imajı, ağsız) → `.env` `AGENT_SHA256` → `up -d --no-deps server` → Caddy üzerinden hash kontrolü; `PUBLISHED.log` | 96, 128 |
| `docs/runbook.md` §11 | ayarlar, yerel doğrulama, yayın, rollback, private repo yolu, alarm | 92 |
| `.gitignore` | `deploy/agent/PUBLISHED.log` (`.env.bak.*` zaten `.env.*` kapsamında) | — |
Compose (`agent_downloads` volume), Caddyfile (`/downloads/{NoktaDestek,Destek-<8 hane>}.exe`), `.env.example`
`AGENT_SHA256`/`AGENT_BINARY_PATH` backend-dev'in; ben yalnız betiği onlara uydurdum (aynı anda eklediğim kopyaları geri aldım).

### Kararlar / sapmalar
1. Go adımları `setup-go` yerine **digest sabit `golang` imajında** (yerel provayla bire bir aynı ortam); yalnız Windows testi `setup-go` (cache kapalı).
2. Tekrarlanabilirlik iki **ayrı runner**'da (aynı runner + `go clean` değil) kanıtlanır.
3. Attestation `check`'e bağlı değil (köken ≠ güvenli); Release `check` + `test-windows` + `attest` ister.
4. Doğrulama sunucuda değil operatör makinesinde (sunucuda GitHub kimliği yok; ele geçirilmiş sunucu kendi doğrulamasını atlar — G-07).
5. Path filtresi yok: required check her PR'da raporlansın diye.
6. PR/main build'lerinde `AGENT_SERVER_URL` yoksa yer tutucu `https://destek.example.invalid:4450`; etiket build'inde değişken zorunlu.

### Doğrulama (yerel, 2026-11-11)
- actionlint (rhysd/actionlint, shellcheck dahil): 0 bulgu (ci.yml dahil tüm workflow'lar).
- İki ayrı temiz konteynerde build.sh: SHA-256 eşit `1e127543…`, 11 527 168 B, MZ, UPX yok.
- `check` adımları: toolchain eşleşmesi, gofmt, `go mod verify`, vet, `go test -race` 10/10 ok, windows vet ok, go-licenses ok.
- **govulncheck: KIRMIZI** — 12 erişilebilir zafiyet: stdlib `go1.25.14` (net/http, crypto/tls, crypto/x509, net/textproto; düzeltme yalnız go1.26.9+/1.26.11 — Go 1.25 desteği bitti) ve `golang.org/x/net v0.50.0` (düzeltme v0.60.0). Gate doğru çalışıyor; istemci koduna dokunmadım → backend-dev.
- Betik: red senaryoları (onaysız `--no-attestation`, SHA256SUMS uyuşmazlığı, attestation'sız exe → 404 red) ve `--local` yayın A → B → A (rollback) provası geçti; volume yazımı (caddy imajı, 0644, yanlış hash → çıkış 3, uid 1000 okuyabiliyor) ayrıca denendi; `gh attestation verify` bayrakları herkese açık attestation'lı bir Release ile denendi (doğru ref geçer, yanlış ref red).
- `docker compose config` + `caddy validate` geçerli; değişen dosyalarda gitleaks 0.

### Açık
- backend-dev: `go.mod` toolchain → go1.26.11 (veya 1.27.x) + `x/net` ≥ v0.60.0; sonra iki workflow'da `GO_IMAGE`/`GO_VERSION`/container imajı aynı sürüme (devops). govulncheck yeşil olmadan Release çıkmaz.
- Repo private → attestation yok; prod öncesi public (veya Enterprise). Environment onayı/tag ruleset private repoda ücretli plan gerektirebilir.
- `apps/agent-win/test/trace-check.ps1` (mimari §11) yok; Windows VM elle testi (test-operatoru).
- SignPath Foundation başvurusu (süreç, kod yok) kullanıcıda.

## Frontend P6 — AC-27 web karşılamada "Hızlı Destek" indirme (frontend-dev, 2026-11-11, QA-P6-3)
Rota değişmedi: `/session/[token]` (auth yok). Windows masaüstünde "Nasıl bağlanmak istersiniz?" bölümünde birincil
**Hızlı Destek uygulamasını indir** (`Download`, "Önerilen · tam destek") + hemen altında SmartScreen rehberi (numaralı 4 adım,
"Ek bilgi → Yine de çalıştır" şema kutuları, imzasız olduğu, 4. adımda doğrulama kodu + sunucu adresi, BT yöneticisi için
SHA256SUMS/parmak izi notu). Tarayıcı yolu ikincil: "Uygulama çalışmıyor mu? Tarayıcıdan yalnızca görüntü paylaş" (AC metni).
macOS/Linux/mobilde indirme ve rehber hiç render edilmez (eski metin "Yalnız ekranımı tarayıcıdan paylaş" kalır).

### Davranış
- Bağlantı `href=/api/v1/public/agent/download?ref=<sessionRef>` (resolve yanıtındaki `sessionRef`). Tıklamada önce
  `fetch(..., { redirect: "manual" })` ön kontrolü: opaqueredirect/3xx → `location.assign(href)` (Caddy attachment, sayfa yerinde)
  + "İndirme başladı"; 503 `NOT_READY` → uyarı + **Tarayıcıdan devam et** (eksik varsa ad alanına, hazırsa paylaş düğmesine odak);
  410 → bitiş ekranı (iptal/süre/kullanıldı), 404 → geçersiz bağlantı; 429 → `Retry-After` dakikalı mesaj; diğer → hata + hata kodu.
- Windows tespiti istemcide (`isWindowsDesktop`: UA'da `Windows NT`, mobil değil); SSR'da false → hidrasyon sonrası görünür.
- Windows'ta tarayıcı modu desteklenmiyorsa (getDisplayMedia yok) indirme yine sunulur, "desteklenmiyor" kartı altında kalır.

### Değişen / eklenen dosyalar
- `apps/web/app/session/[token]/agent-download.tsx` (yeni), `join-form.tsx`, `guest-welcome.tsx`
- `apps/web/lib/agent-download.ts` (+ `.test.ts`, 10 test), `lib/device-support.ts` (+ 6 test)
- `apps/web/components/ui/text-field.tsx`: React 19 `ref` prop tipi (odak taşıma için; davranış aynı)
- `apps/web/messages/tr.json`: `ga.*`, `gj.browserWin*`
- `apps/web/e2e/p6-agent-download.spec.ts` (yeni), `e2e/mock-sessions.mjs` (indirme ucu + `/downloads/Destek-<kod>.exe`; token
  `D`=503, `G`=410), `e2e/helpers.ts` (konsol filtresinde beklenen 503)

### Sapmalar (gerekçeli)
1. **İndirme ad/onaya bağlı değil** (taslak 02'de iki seçenek de form dolunca etkin). Gerekçe: web formundaki ad ve onay yalnız
   tarayıcı modu join'i içindir, istemciye gitmez; istemci kendi karşılamasında onay ister (AC-98). Bağlamak yanıltıcı olurdu.
2. **Rehber ayrı ekran değil, düğmenin altında hep görünür** (taslakta "İndirildi + rehber" ayrı durum). AC-27 "aynı adımda"
   diyor; indirme başlayınca rehber vurgulanır (`border-primary`) ve üstte başarı mesajı çıkar.
3. **Ön kontrol bir istek daha harcar:** başarılı indirme ucun `ipKey` 20/dk kovasından 2 hak kullanır (ön kontrol + asıl
   indirme). Başarısız ön kontrol tek başarısız deneme sayılır. Düz bağlantı 503/410 JSON'una gideceği için bilinçli tercih.
4. Dosya boyutu ve kod karşılamada gösterilmez: resolve yanıtında yok (sözleşmede olmayan alan uydurulmadı).
5. Not (S6-2): `/downloads/*` hash uyuşmazsa 503 dönüyor; ön kontrol aynı kontrolü uçta yaptığı için kullanıcı 503'ü
   uyarı olarak görür. Ön kontrol ile indirme arasındaki çok kısa pencerede uyuşmazlık başlarsa tarayıcı 503 sayfasına gider (kabul).

### Testler
`pnpm --filter @remote/web lint typecheck test` temiz (99 birim). `pnpm --filter @remote/web e2e` 142 geçti / 34 atlandı
(yeni spec: indirme + `Destek-\d{8}.exe` dosya adı, 503 → tarayıcı önerisi + odak, 410 → iptal ekranı, macOS'ta yok, mobilde
yok, 375 px taşma yok, açık/koyu axe 0). Tasarım skill'i (`ui-ux-pro-max`) mevcut; DESIGN.md §8 kararı esas alındı.
Windows'ta gerçek SmartScreen yolu elle testte (DoD) doğrulanacak.

## DevOps — TEST-NAT-2 / TEST-NAT-3 tanısı (devops, 2026-11-11; değişiklik YOK)
**TEST-NAT-2 (yalnız `turn:…:3478?transport=tcp`, ICE kurulmuyor):** altyapı kaynaklı değil. Kanıt (staging, 10:06–10:10Z):
- `turnutils_uclient` iki TCP istemci relay↔relay (`-t -y`, `-t -y -c` Send/Data, `-y -c` UDP): 0 kayıp, RTT < 1 ms.
- coturn `external-ip=public/özel` eşlemesiyle peer = kendi public IP'si → özel IP'ye çevrilir; paket pfSense hairpin'e
  hiç çıkmaz (`-e 185.126.217.99` testinde DROP sayacı `192.168.25.10` kuralında artıyor). Hairpin/conntrack/`allowed-peer-ip` dışı.
- Uygulamasız minimal Chrome (tek sayfa, iki `RTCPeerConnection`, yalnız tcp URL + `relay`, sunucuda üretilen 600 sn HMAC):
  4/4 koşu `connected` (~100 ms), aday çifti `succeeded`.
- `udp send: Operation not permitted`: EPERM = `REMOTE-TURN-OUT` DROP'u (tetiklendiğinde sayaç +1 artıyor; relay → kendi adresi,
  aralık dışı port: test-denied bölüm 1/4'te beklenen). tcp koşularındaki 3 satır (koşu başına 1, kabul anında) sayaç artmadan
  görüldü; kaynağı ayrıştırılamadı ama tek paket ve bağlantıyı kesmez (aynı yol uclient/minimal Chrome'da çalışıyor).
  `nf_conntrack_count` 209/262144, UFW OUTPUT'ta drop/limit yok.
Sonuç: fark uygulama/harness katmanında (ör. `ice.servers` → `setConfiguration` ile toplama sırasında tek TCP TURN sunucusunun
yeniden kurulması, harness sarmalayıcısının `setConfiguration` süzgeci). `host-firewall.sh`/`turnserver.base.conf` değiştirilmedi;
bu nedenle test-denied yeniden koşulmadı. Devir: frontend-dev + test-operatoru — app akışında `chrome://webrtc-internals` dökümü
ve `ice.servers` geliş zamanı ile `TURNOP_MODES=tcp` tekrarı.

**TEST-NAT-3 (UDP relay'de kayıp patlaması, 1080p'de %12,7, BWE 2500→71 kbps):** sunucu tarafında iz yok: ens18 RX/TX
errors/dropped 0, `UdpRcvbufErrors/UdpSndbufErrors/UdpInErrors` 0, yük ~1,7, conntrack dolu değil, EPERM sayısı günde 9 (tek paket,
kayıpla ilişkisiz). Aynı dakikalarda TCP/TLS relay 0 kayıp. En olası neden: iki tarayıcı aynı Mac'te → Mac uplink'i hem medya
gönderimini hem relay'e çıkışı taşıyor + ev ağı/pfSense UDP kuyruğu; TCP tıkanıklık denetimi bunu maskeliyor. Tanı trafiğim
(10:06–10:10Z) yalnız loopback, ~24 KB + 4 kısa Chrome allocation; kayıpla ilişkilendirilemez. Öneri: ölçümü iki ayrı ağdan
(farklı uplink) tekrarla; pfSense'te UDP state/limiter ve WAN kuyruk istatistiklerini (`pfctl -si`, Status › Queues) koşu
sırasında oku; sunucuda koşu sırasında `nstat` + `tcpdump -ni ens18 udp portrange 49160-49199 -w` ile sunucuya giren/çıkan
paket sayısını istemci kaybıyla karşılaştır (kayıp sunucuya varmadan mı oluyor).

## Backend P7 — sunucu (backend-dev, 2026-11-11)
Kapsam: `control.*`, `monitor.request`, `env.state`, `caps.update`, `control.revoke` sunucu tarafı + S-P3-8 giriş şartı + contracts tipleri. **Şema değişikliği yok, dba gerekmiyor** (P4 `session_consents` CHECK kümesi yeterli: `CONTROL` + `GRANTED/DENIED/REVOKED` + `UI/HOTKEY/RECONNECT/SYSTEM`; protokoldeki `source: DENIED` DB'ye `decision=DENIED, source=UI` olarak yazılır). Yeni bağımlılık yok.

### Değişen dosyalar
| Dosya | Değişiklik |
|---|---|
| `packages/contracts/src/ws.ts` | `controlRequestSchema`, `monitorRequestSchema`, `controlStateSchema` (GRANTED yalnız UI), `envStateSchema`; tech/guest inbound birleşimlerine eklendi; sunucu çıkışına `control.request`, `monitor.request`, `control.revoke`, `caps.update`, `control.state`, `env.state`; sabitler `CONTROL_STATES/SOURCES/REVOKE_REASONS`, `CONTROL_REQUEST_MAX=5`, `CONTROL_DENY_COOLDOWN_MS=30000`; `WS_ERROR_CODES += INTERNAL` |
| `packages/contracts/src/dc.ts` | `input` kanalı: `m.move`, `m.btn`, `m.wheel` (±1200), `k` (`code` ≤32, `key?` ≤4), `k.release_all`; `inputMessageSchema`, `parseInputMessage` |
| `packages/contracts/src/audit.ts` (yeni, `exports["./audit"]`) | `CONTROL_AUDIT` action adları (tek kaynak; P8 zaman çizelgesi aynı adları okur) |
| `packages/contracts/fixtures/ws-messages.json` | P7 geçerli/geçersiz örnekleri; eski "P7 öncesi bilinmiyor" `control.request` geçersiz örneği kaldırıldı |
| `packages/contracts/fixtures/dc-input.json` (yeni) | `input` kanalı geçerli/geçersiz örnekleri (Go `internal/input` için) |
| `apps/server/src/signaling/control.ts` (yeni) | istek süzgeci, `control.state` kaydı (fail-closed), `revokeControl`, `resetControl`, `narrowCaps`, `env.state` iletimi |
| `apps/server/src/signaling/types.ts` | `Room.control: ControlRoom`, `TechConn.role`, `Guest.ctx` |
| `apps/server/src/signaling/rooms.ts` | `TechnicianLiveControl` arayüzü (`endByTechnician`, `applyPermChange`); kopmada/sekme değişiminde VIEW'a sıfırlama; `attachTech` güncel yetkiyle caps daraltır |
| `apps/server/src/signaling/handlers.ts` | yeni tiplerin yönlendirmesi; `share.state` bekleyen monitör isteğini karşılar |
| `apps/server/src/signaling/ws.ts` | TechConn `role`; misafir bağlam (ip/UA) saklanır; 60 sn yeniden doğrulama: geçerli → `applyPermChange`, rol değişti / kullanıcı-tenant pasif → `endByTechnician`, yalnız oturum geçersiz → o oda `auth_revoked` |
| `apps/server/src/ops/metrics.ts` | `rs_control_total{event}` |
| `apps/server/test/integration/signaling-control-p7.test.ts`, `test/unit/dc-input-fixtures.test.ts`, `packages/contracts/test/control-p7.test.ts` (yeni); `test/helpers/ws.ts` (TechConn `role`) | testler |
| `docs/mimari-protokol.md` | sonuna "P7 backend uygulama notları" (aşağıdaki sapmalar) |

### Davranış özeti
- `control.request`: sıra `remote_control.use` + `caps` yok → `FORBIDDEN` (AC-51) · misafir yok → `CONFLICT` · BROWSER → `FORBIDDEN` "Müşteri tarayıcı modunda: yalnız görüntüleme." (AC-34) · zaten açık → `CONFLICT` · ret sonrası 30 sn → `RATE_LIMITED` · 5 iletilmiş istekten sonra → `RATE_LIMITED` (G-03, AC-116). İletilirse `controlState=REQUESTED` + audit `control.requested`.
- `control.state` (yalnız AGENT; BROWSER'dan gelen yok sayılır, oda başına sıralı işlenir): `GRANTED` → `session_consents(CONTROL,GRANTED,UI)` + audit `control.granted` tek TX, **ancak commit sonrası** teknisyene `control.state{GRANTED}`; TX hata verir ya da 800 ms'de bitmezse misafire `control.revoke{audit}`, teknisyene `error{INTERNAL, ref}` (AC-111, G-15); geç commit edilen GRANTED bir `REVOKED/SYSTEM` ile dengelenir. `VIEW/DENIED` yalnız REQUESTED iken kaydedilir (30 sn sayacı başlar); `VIEW/UI|HOTKEY` açık kontrolü `REVOKED/<kaynak>` olarak kaydeder (AC-50, 111). Tekrarlanan/no-op mesajlar kayıt şişirmez.
- `monitor.request` (AC-43): yalnız AGENT; `room.share.monitors` biliniyorsa kimlik doğrulanır (`VALIDATION`); 5 istek / 30 sn kuralı.
- `env.state` (AC-105): AGENT → teknisyene alanlar yeniden kurularak.
- Kopma (AC-24): misafir/teknisyen kopunca `controlState=VIEW`, açık kontrol `REVOKED/RECONNECT`; misafir kopunca teknisyene `control.state{VIEW, RECONNECT}`; yeniden bağlanan taraf VIEW ile başlar.
- **S-P3-8 / AC-115:** `app.rooms.applyPermChange(userId, effectivePermissions)` ve `app.rooms.endByTechnician(userId)` P9/P10 servislerinden commit sonrası doğrudan çağrılmalı (60 sn yalnız yedek yol). Daralmada misafire `caps.update`, `remote_control` düştüyse `control.revoke{permission}` + teknisyene `control.state{VIEW, SYSTEM}` + `REVOKED/SYSTEM` + audit `session.caps_changed`.

### Sapmalar (gerekçeli; `docs/mimari-protokol.md` sonuna da not düşüldü)
1. **monitor.request 30 sn kuralı:** protokolde müşteri ret mesajı yok; sunucu yanıtlanmamış (share.state ile karşılanmamış) isteği 30 sn bekletir — ret ile aynı koruma, yeni mesaj tipi icat edilmedi.
2. **`error.code = INTERNAL`** eklendi: fail-closed hatasını teknisyen UI'ı ayırt edebilsin (mesajda log referansı).
3. **Sunucu teknisyene `control.state` gönderir** (revoke → `SYSTEM`, misafir kopması → `RECONNECT`): misafir onayına güvenmeden konsol girdi göndermeyi kessin (AC-115 "5 sn içinde").
4. **caps yalnız daralır:** oturum içinde yetki eklenmesi yeni oturumda geçerli (G-09 güvenli varsayılan; protokol yalnız daralmayı tanımlıyor).
5. **Teknisyen kopmasında misafire `control.revoke` yok** (`reason` kümesinde uygun değer yok). Agent `peer.left{role:"tech"}` / `peer.joined{role:"tech"}` aldığında kapıyı kapatmalı. **Mimar kararı bekleniyor** (alternatif `reason: "reconnect"`).
6. Oturum bitişinde açık kontrol için ayrı `REVOKED` satırı yazılmaz (bitiş `session.ended` audit'iyle zaten zaman çizelgesinde; P8 görüntülemesi bunu kontrolün sonu sayabilir).

### Frontend ve Go için sözleşme notları
- Yeni tipler `@remote/contracts/ws` ve `@remote/contracts/dc` (input) içinde; action adları `@remote/contracts/audit`.
- Konsol: input göndermeye yalnız sunucudan `control.state{GRANTED}` gelince başla; `control.state{VIEW,*}`, `error{INTERNAL}`, `peer.left` ile dur. Hata metinleri sunucudan gelir (`RATE_LIMITED` bekleme mesajı dahil).
- **web:** `apps/web/lib/webrtc/machines.test.ts:147` `control.revoke`'u şema dışı varsayıyor; artık geçerli tip → test güncellenmeli (frontend-dev).
- **Go:** `internal/signal` `ParseServer`'a `control.request`, `monitor.request`, `control.revoke`, `caps.update` eklenmeli; `control.state` ve `env.state` sunucu çıkışında teknisyene özel (`techOnlyTypes`); `decodeGuest`'e `control.state` (GRANTED yalnız UI) ve `env.state`. `signal_test.go` `TestServerMessageStrictness`'teki `{"t":"control.request"}` "P7 öncesi bilinmiyor" satırı artık geçerli → kaldırılmalı. `dc-input.json` `internal/input` testinde kullanılmalı. Teknisyen kopmasında kapı kapatma (sapma 5).

### Test
Komutlar: `pnpm -r run lint` · `pnpm -r run typecheck` · `pnpm --filter @remote/server test` · `pnpm --filter @remote/contracts test` · entegrasyon `eval "$(apps/server/scripts/test-db.sh up)" && pnpm --filter @remote/server test:int`.
Son çıktı: lint 3/3 temiz, typecheck 3/3 temiz; server unit **218/218**; contracts **39/39**; server tümü (unit + entegrasyon, ayrı MySQL 8.4 konteyneri) **374/374**, P7 dosyası 3 tekrarda 14/14. P7 testleri: AC-51 FORBIDDEN, AC-34 BROWSER reddi, AC-47/99/116 ret + 30 sn, AC-116 5 istek, AC-111 zaman çizelgesi (GRANTED→REVOKED/HOTKEY), AC-111 fail-closed (DB hatası ve 800 ms asılı DB), AC-24 kopmada sıfırlama, AC-43 monitör kuralları, AC-105 env.state, AC-115 oda katmanı + **uçtan uca** (kontrol açıkken `remote_control.use` kaldırılınca 60 sn yeniden doğrulamasında `control.revoke{permission}` + `caps.update`; pasif teknisyenin teknisyeni kopuk oda dahil tüm odaları `auth_revoked` + 4401; rol değişimi).
Bilinen kırmızı (bu paketin dışında): `pnpm --filter @remote/web test` 98/99 — yukarıdaki web test satırı.

## Agent P7 — Windows istemci kontrol (backend-dev/Go, 2026-11-11)
Kapsam: yalnız `apps/agent-win/`. Sözleşme `packages/contracts/src/{ws,dc}.ts` (P7) ve `fixtures/{ws-messages,dc-input}.json` ile birebir; yeni bağımlılık yok, CGO yok.

### Dosyalar
| Dosya | İçerik | AC |
|---|---|---|
| `internal/control/gate.go` (yeni, platformsuz) | İzin kapısı: varsayılan CLOSED, atomik `IsOpen/Allow`; `Close` açıktan kapanınca dinleyicileri (takılı tuş bırakma) çalıştırır; `Suspend` yerel öncelik (1 sn); düşürülen olay sayacı | 24, 101, 104 |
| `internal/control/requests.go` | İstek sayacı (kontrol ve monitör ayrı): diyalog açıkken ikinci istek diyalog açmaz, ret sonrası 30 sn, oturum başına 5 | 116 |
| `internal/control/consent.go` | G-03 kuralları: 1,5 sn kilit, Enter/Space asla izin vermez, enjekte etkileşim yok sayılır, kısayol kaydı yoksa izin yok | 102, 116 |
| `internal/control/place.go` | `PlaceAway`: diyalog imleci içermez (orta → üst-orta → alt-orta → sol → sağ); `ui.showAwayFromCursor` buna taşındı | 116 |
| `internal/control/hotkey.go` | `RegisterHotkey`: Ctrl+Shift+F12, olmazsa Ctrl+Shift+F11, ikisi de olmazsa `ErrNoHotkey` | 102 |
| `internal/input/messages.go` | `input` DC katı şema (m.move, m.btn, m.wheel, k, k.release_all; ≤ 512 bayt, null/bilinmeyen alan reddi) | 47–49 |
| `internal/input/keys.go` | `KeyboardEvent.code` → VK + genişletilmiş bayrak tablosu (harf, rakam, F1–F12, oklar, numpad, değiştiriciler) | 48 |
| `internal/input/applier.go` | Alıcı: doğrula → **kilit altında** `gate.Allow` → çevir → enjekte. Kapalı/askıdaysa düşer + sayar. Yazı tuşunda `key` tek karakterse ve Ctrl/AltSol/Win basılı değilse `KEYEVENTF_UNICODE` (Türkçe karakterler düzenden bağımsız); kısayollar VK. Ctrl+Alt+Del ve Win+L iletilmez. Normalize koordinat → aktif monitör → sanal masaüstü mutlak (`ABSOLUTE|VIRTUALDESK`). Kapı kapanınca yalnız kendi bastığı tuş/düğmeleri bırakır | 48, 49, 101 |
| `internal/input/sendinput_windows.go` | `SendInput` (amd64 INPUT düzeni, tek çağrıda toplu), `MapVirtualKey` ile scan kodu, `VirtualScreen` | 48 |
| `internal/input/host_windows.go` | Kilitli iş parçacığı: `WH_MOUSE_LL`/`WH_KEYBOARD_LL` (enjekte olmayan olay → `gate.Suspend`; son basışın `INJECTED` bayrağı tutulur) + `RegisterHotKey` (yedekli). WM_HOTKEY → **önce `gate.Close()`**, sonra akışa bildirim | 102, 104 |
| `internal/env/env.go` + `probe_windows.go` | 500 ms'de bir yoklama, yalnız değişimde bildirim. Yükseltilmiş ön plan: kendi süreç yükseltilmemişse ön plan sürecinin belirteci `TokenElevation` (açılamıyorsa yükseltilmiş sayılır). Güvenli masaüstü: `OpenInputDesktop` başarısız veya adı `Default` değil | 105 |
| `internal/signal/messages.go` | Gelen: `control.request`, `monitor.request{monitorId 0..64}`, `control.revoke{permission\|audit\|admin}`, `caps.update{caps[]}`; giden: `control.state` (GRANTED yalnız `UI`), `env.state`; `control.state`/`env.state` misafire gelirse `ErrNotForGuest`; `error.code` `INTERNAL` eklendi | 99, 105, 111, 115 |
| `internal/rtc/rtc.go` | `input` kanalı: `Handlers.Input` yoksa kapatılır; yalnız metin ve yalnız `remote_control` yeteneği varken alıcıya gider (Pion goroutine'inden doğrudan, akış kuyruğu yok) | 101, 115 |
| `internal/flow/control.go` (yeni) + `flow.go` | Kontrol akışı: istek → diyalog; izin → `gate.Open` + `control.state{GRANTED,UI}`; ret → `{VIEW,DENIED}`; düğme/kısayol → `{VIEW,UI\|HOTKEY}`; `control.revoke` → kapı + `{VIEW,SYSTEM}`; `caps.update` → `peer.SetCaps` + yetki yoksa kapı kapanır; `peer.left/peer.joined{tech}`, WS kopması, PeerConnection disconnected/failed/closed, her `hello` (AC-24) ve oturum sonu kapıyı kapatır; monitör isteği diyaloğu + kaynak değişimi + `share.state`; `env.state` (ilk değer, değişim, yeniden bağlanmada tekrar) | 24, 43, 47, 50, 99, 102, 105, 111, 115, 116 |
| `internal/ui/control_windows.go` (yeni), `screens_windows.go`, `overlay_windows.go`, `form_windows.go` | Ortak izin diyaloğu (kontrol + monitör): Reddet varsayılan/odak, "İzin ver" 1,5 sn sonra etkin, `noKey` ile Enter/Space yutulur, `input.LastPressInjected()` ise yok sayılır, imleç altında açılmaz, kısayol yoksa kırmızı açıklama + izin düğmesi hiç etkinleşmez. Oturum penceresi: "Erişime izin ver" (bekleyen istek varken ve 1,5 sn sonra), "Kontrolü kapat" (UI iş parçacığında anında `gate.Close`), kısayol satırı, "Oturumu bitir". Gösterge metni "Ekranınız izleniyor" ↔ "Uzaktan kontrol aktif — <ad>" | 100, 102, 103, 116 |
| `cmd/noktadestek/main.go` | Kapı → UI → Applier → Host (kısayol) → flow bağlantısı | — |

### Tasarımdan sapmalar / kararlar (gerekçeli)
1. **Kapı `internal/control/gate.go`'da, kapı denetimi `input.Applier` kilidi altında:** `Close` → `OnClose(ReleaseAll)` aynı kilidi aldığından `Close` döndükten sonra tek bir basma olayı bile uygulanamaz (AC-101 "≤ 100 ms" yerine fiilen anında). Kapatan her yol önce kapıyı kapatır, akışı beklemez (UI düğmesi UI iş parçacığında, kısayol kanca iş parçacığında).
2. **Yeniden bağlanmada istemci `control.state{VIEW, RECONNECT}` göndermez:** sunucu misafir kopunca durumu kendisi VIEW yapıp teknisyene `RECONNECT` bildiriyor (Backend P7 not 4); çift audit olmasın diye. Kapı istemcide kopuşta kapanır ve her `hello`'da kapalı başlar.
3. **Teknisyen kopması (`peer.left`/`peer.joined{role:"tech"}`):** sunucu notu 6'ya uygun olarak kapı kapanır; kontrol açıksa `control.state{VIEW, SYSTEM}` gönderilir.
4. **Monitör reddi WS'e bildirilmez** (sözleşmede mesaj yok; sunucu yanıtsız isteği ret sayıyor). İstemci de 30 sn / 5 istek kuralını ayrı sayaçla uygular.
5. **Unicode kuralı:** Ctrl, AltSol, Win basılıyken harf tuşları VK gider (Ctrl+C, Win+E çalışsın); AltGr (AltRight) Unicode'u engellemez (`@`, `€`). Boşluk her zaman VK.
6. **Tekerlek birimi WHEEL_DELTA** (contracts `WHEEL_MAX = 120×10`); `dy` işareti çevrilir (tarayıcıda +aşağı, Windows'ta +yukarı).
7. **Kanca ve kısayol program açıkken kayıtlı** (yalnız oturum sırasında değil): kısayolun kontrol istenmeden önce alınabildiği bilinsin ve izin diyaloğu buna göre açılsın (G-21). Kancalar yalnız atomik yazma yapar.
8. **"Erişime izin ver" (oturum penceresi)** yalnız bekleyen bir kontrol isteği varken ve diyalogla aynı 1,5 sn sonra etkinleşir; G-03 kurallarını atlamaz.
9. Fare imleci hâlâ görüntüye çizilmiyor (P6 Aşama 3 açığı); teknisyen kendi imlecini görür. Uzaktan kontrolde kullanılabilirlik için ayrı iş önerilir.

### Bağımlılık
Yeni bağımlılık yok (`golang.org/x/sys/windows`, stdlib). AGPL/GPL yok.

### Testler ve son çıktı
Komut (docker `golang:1.26.11-bookworm`, repo kökü bağlı, `apps/agent-win`): `gofmt -l` boş → `go vet ./...` → `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go vet ./...` → `go mod verify` → `go test -race -count=1 ./...` → tüm paketler için `GOOS=windows go test -c` → `build/build.sh` iki kez (arada `go clean -cache`) → govulncheck (linux + windows/amd64).
Son çıktı: gofmt temiz; iki vet temiz; `go mod verify` ok; `go test -race` **15/15 paket ok** (yeni: control, env, input); Windows test ikilileri derlendi; iki build aynı SHA-256 `86370035…3d220e92` (12,08 MB); govulncheck v1.1.4 iki hedefte "Your code is affected by 0 vulnerabilities" (modül düzeyinde 3 erişilemez kayıt P6'dakilerle aynı).
Yeni testler: `control` — AC-101 kapı varsayılan kapalı/Close dinleyicisi, eşzamanlı Close yarışsız; AC-104 1 sn askı; AC-116 30 sn + 5 istek + tek diyalog; AC-116 diyalog zamanlama/odak (ilk 1,5 sn tıklama, Enter/Space, enjekte tıklama, Alt+İ); AC-102 kısayolsuz izin yok, yedeğe düşüş ve ikisi de başarısız; AC-116 imleç altında açılmama (6 konum + büyük diyalog). `input` — **AC-101 sahte enjektörle kapalı kapıda 0 olay**, sürekli hareket akarken Close → Close sonrası 0 olay (< 100 ms), kapanışta takılı tuş/düğme bırakma; AC-104; AC-48 Türkçe ş ı i ğ ü ö ç İ → `KEYEVENTF_UNICODE`, Ctrl+C / Alt+Tab / F12 / ok (genişletilmiş) VK; Ctrl+Alt+Del ve Win+L engeli; AC-49 iki monitörlü sanal masaüstünde ±2 piksel; tekerlek/sağ tık; şema katılığı + `fixtures/dc-input.json`. `signal` — P7 sunucu tipleri kabul/red, `control.state` GRANTED yalnız UI, `env.state` kodlaması, misafire gelen `control.state/env.state` → `ErrNotForGuest`. `rtc` — gerçek iki Pion eşiyle `input` kanalı yalnız `remote_control` varken iletilir, `SetCaps` ile daralınca düşer. `flow` — AC-99 ret + 30 sn bekleme, AC-50/111 düğme ve kısayol, AC-102 kısayolsuz izin yok, AC-115 revoke ve caps.update, AC-24 kopuşta kapanma + yeniden bağlanmada kapalı, teknisyen kopması, AC-43 monitör izni (girdi monitörü güncellenir), AC-105 env.state.

### Windows'ta elle doğrulanacaklar (P6 listesinin 24 adımına ek)
Ön koşul: staging P7 sunucusu + konsol; istemci `build/build.sh https://<staging-alan-adı>:4450 0.7.0`; iki monitörlü makine tercih edilir. Konsoldan "Kontrol iste".
25. **Diyalog (G-03/AC-116):** imleci ekran ortasına koyup istek gönder → diyalog imlecin altında değil (üst-orta); odak "Reddet"te; Enter → reddeder (konsol "Kontrol reddedildi"); "İzin ver" ilk 1,5 sn gri; Tab ile "İzin ver"e gelip Space/Enter → hiçbir şey olmamalı; 1,5 sn sonra fareyle veya Alt+İ ile izin. Ret sonrası 30 sn içindeki istek diyalog açmamalı; 6. istek hiç gelmemeli.
26. **Gösterge (AC-103):** izin sonrası her monitörde üst etiket "Uzaktan kontrol aktif — <ad>"; kapatınca "Ekranınız izleniyor — <ad>".
27. **Türkçe karakter (AC-48):** Not Defteri'nde konsoldan `çğıöşüİ ÇĞIÖŞÜ` + rakamlar + `@ € { }` (AltGr) yaz; müşteri klavyesi TR-Q ve ayrıca EN-US düzenindeyken aynı metin çıkmalı. Ctrl+C/Ctrl+V, Ctrl+Z çalışmalı.
28. **Alt+Tab ve Win:** konsoldan Alt basılı tutup Tab'a iki kez bas → pencere değiştirici açılıp seçim yapılmalı; Win+E Gezgin'i açmalı; Win+L kilitlememeli; F1–F12 ve oklar çalışmalı.
29. **Fare (AC-48/49):** sol/sağ/orta tık, çift tık (masaüstü simgesi açılır), sürükle (pencere taşıma), tekerlek dikey/yatay; %100/%150 ölçekte ve ikinci monitörde (monitör değişiminden sonra) tıklama hedefe ±2 piksel düşmeli.
30. **Kontrolü kapat (AC-50/101):** fare sürekli hareket ederken "Kontrolü kapat" → hareket anında durmalı, konsol ≤ 1 sn "Kontrol müşteri tarafından kapatıldı"; basılı Ctrl/Shift kalmamalı (Not Defteri'nde yazı normal).
31. **Kısayol (AC-102):** istemci arka planda (başka pencere odakta) Ctrl+Shift+F12 → kontrol kapanmalı, konsolda kaynak HOTKEY. Yedek: başka bir programla (ör. AutoHotkey `^+F12::return`) F12'yi önceden kapıp istemciyi başlat → oturum penceresinde "Ctrl+Shift+F11" yazmalı ve çalışmalı; F11'i de kapınca diyalogda kırmızı açıklama ve "İzin ver" hiç etkinleşmemeli.
32. **Yerel öncelik (AC-104):** teknisyen fareyi hareket ettirirken müşteri kendi faresini oynatınca uzaktan hareket ~1 sn durmalı, sonra devam etmeli.
33. **UAC / Güvenli Masaüstü (AC-105):** kontrol açıkken yönetici olarak bir program başlat → UAC sırasında konsolda "Müşteri güvenli masaüstünde"; UAC'ı onayla ve yükseltilmiş pencereye (ör. yönetici CMD) odaklan → konsolda "Yükseltilmiş pencere — kontrol edilemiyor" ve o pencereye tuş/tık gitmemeli; normal pencereye geçince uyarı kalkmalı. Win+L kilit ekranı da güvenli masaüstü sayılır.
34. **Monitör izni (AC-43):** konsoldan diğer ekranı iste → aynı kurallı diyalog; izin → görüntü ve işaretleme katmanı yeni ekrana geçmeli, tıklamalar yeni ekrana düşmeli; ret → değişmemeli.
35. **Revoke (AC-115):** kontrol açıkken yöneticiden teknisyenin "Uzaktan kontrol" yetkisini kaldır → ≤ 5 sn içinde kapı kapanmalı, istemcide "Uzaktan kontrol sunucu tarafından kapatıldı", gösterge "izleniyor"a dönmeli; yeni istek diyalog açmamalı.
36. **Kopma (AC-24):** kontrol açıkken Wi-Fi'ı 10 sn kapat/aç → yeniden bağlandıktan sonra kontrol kapalı (yalnız görüntüleme); teknisyen sekmesini yenileyince de kontrol kapanmalı.

### frontend-dev / backend için sözleşme notları
Sözleşme değişikliği yok. Konsolun dikkat etmesi gerekenler: `k.key` yalnız tek yazdırılabilir karakter için gönderilmeli (`"Shift"` gibi ≥5 karakterlik adlar şema gereği reddedilir; mesaj tamamen düşer); `code` yalnız harf/rakam (`^[A-Za-z0-9]{1,32}$`); tekerlek WHEEL_DELTA biriminde, `dy>0` aşağı. İstemci yeniden bağlanmada `RECONNECT` göndermez (sunucu üretir); monitör reddine yanıt yoktur.

## Frontend P7 — konsol uzaktan kontrol (frontend-dev, 2026-11-11)
Kapsam: yalnız teknisyen konsolu (`apps/web`). Tipler `packages/contracts`'tan (`ws.ts` control.*/monitor.request/env.state/caps.update, `dc.ts` input şeması); contracts'a dokunulmadı. İş başında tipler yoktu, geçici yerel şema yazıldı; backend contracts'a ekleyince ona geçildi — `lib/control/protocol.ts` artık yalnız contracts'tan yeniden dışa aktarım.

### Rotalar
| Yol | Auth | Ne yapar |
|---|---|---|
| `/sessions/[id]/console` (değişti) | Evet (oturumun teknisyeni) | Hızlı Destek (AGENT) misafirde ve `remote_control.use` varsa "Kontrol iste" akışı, izinde fare/klavye yakalama, özel tuşlar, monitör seçimi, `env.state` uyarıları. Tarayıcı misafirde P4 pasif "Uzaktan kontrol" düğmesi aynen |
Yeni rota yok.

### Dosyalar
- Yeni: `apps/web/lib/control/machine.ts` (saf durum makinesi: idle → requested → granted/paused → ended/denied; ≤5 istek, 30 sn ret beklemesi, FORBIDDEN/RATE_LIMITED eşleme, `error{INTERNAL}` = G-15 fail-closed, revoke/caps.update, kopma/yeniden bağlanma/oturum sonu → yakalama kapanır, monitör isteği + 30 sn yanıtsızlık, `env.state`), `lib/control/input.ts` (koordinat normalize, düğme/tekerlek/klavye eşleme, Ctrl+Alt+Shift çıkış kısayolu, özel kombinasyonlar), `lib/control/use-remote-input.ts` (DOM dinleyicileri → `input` DC; tam ekranda Keyboard Lock), `lib/control/protocol.ts`, `components/console/control-button.tsx` (`ControlButton`, `MonitorPicker`, özel tuşlar menüsü), testler `lib/control/{machine,input}.test.ts`, e2e `e2e/p7-control.spec.ts` + `e2e/fake-agent.ts`.
- Değişen: `lib/webrtc/peer.ts` (AGENT misafire `input` DC, `onInput`), `lib/webrtc/use-tech-session.ts` (kontrol reducer'ı, `requestControl/requestMonitor/releaseControl/resumeControl`, `input` kanalı), `components/console/stage.tsx` (araç şeridi görüntünün dışına, kontrol çerçevesi, yakalama, `stage-elevated`/`stage-secure`), `app/(panel)/sessions/[id]/console/{page,console-view}.tsx` (`canControl` = `remote_control.use`, bildirimler), `components/console/collab-side.tsx` (`AnnotToolbar.disabledHint`), `components/ui/button.tsx` (React 19 `ref` prop), `messages/tr.json` (`p7.*`), `lib/webrtc/machines.test.ts` (control.revoke artık tanınan tip), e2e sahte sunucu `e2e/mock-{ws,sessions,api}.mjs` (AGENT misafir `rs.e2eagent.<id>`, control/monitor/env aktarımı, FORBIDDEN/30 sn/≤5 kuralları, `GET /__e2e/revoke/:id`), `DESIGN.md` §4 ikonlar + §6 üç yeni satır.

### Davranış özeti
- Girdi yalnız sunucudan `control.state{GRANTED}` gelince ve görüntü varken gönderilir; `VIEW` (UI/HOTKEY/SYSTEM/RECONNECT), `control.revoke`, `caps.update` (remote_control yok), `error{INTERNAL}`, `peer.left`, kendi WS kopması, oturum sonu, güvenli masaüstü → dinleyiciler anında sökülür + `k.release_all` (AC-50 e2e: < 1 sn).
- Koordinatlar videonun görünen içerik alanına göre 0..1, 5 ondalık (AC-49); %100 kipinde kaydırma çubuğu tıkları gönderilmez. Klavye: `code` (`^[A-Za-z0-9]{1,32}$`) her zaman, `key` yalnız tek yazdırılabilir karakterde (Türkçe ç ğ ı ö ş ü İ); örnekler testte contracts `parseInputMessage` ile doğrulanır. Tekerlek WHEEL_DELTA birimi, `dy>0` aşağı (Go istemci ters çevirir — uyumlu).
- Klavyeyle çıkış: Ctrl+Alt+Shift birlikte basılıp başka tuş olmadan bırakılınca odak "Kontrolü bırak"a geçer (Tab uzak ekrana gittiği için).
- Özel tuşlar menüsü: Alt+Tab, Win, Win+D/R/E, Alt+F4, Ctrl+Shift+Esc, Print Screen; Ctrl+Alt+Del yok (AC-48). Tam ekranda Chromium Keyboard Lock sistem tuşlarını doğrudan yakalar.
- İşaretleme ↔ kontrol: kontrol yakalanırken işaretleme araç çubuğu pasif, katman girdi almaz.
- Görsel bulgu düzeltildi: işaretleme araç çubuğu + görüntü kontrolleri artık görüntü üstünde değil, sahnenin üst şeridinde (e2e: şeridin altı ≤ görüntü alanının üstü).

### Sapmalar (gerekçeli)
1. **[KAPANDI — düzeltme turu 1, §3.3 K1]** ~~**"Kontrolü bırak" yerel duraklatmadır.** Protokolde teknisyenden müşteriye bırakma mesajı yok (mimari-protokol §3); konsol girdi göndermeyi keser, müşteri izni açık kalır ("Kontrole devam" yeni istek gerektirmez) ve bu açıkça yazılır. Öneri (mimar/backend): `control.release` (tech→S→guest) eklenirse istemci kapıyı kapatır; konsolda tek satırlık değişiklik.~~ Artık `control.release` gönderilir (bkz. "Frontend P7 — düzeltme turu 1").
2. **[KAPANDI — §3.3 K2]** ~~**"Vazgeç" (istek iptali) yok** (taslakta var): protokolde istek iptali mesajı yok.~~ "Vazgeç" → `control.cancel`.
3. **[KAPANDI — §3.3 K4]** ~~**Monitör reddi bilinmez:** istemci ret yanıtı göndermiyor; 30 sn içinde `share.state.activeMonitor` istenen değere dönmezse "Müşteri monitör değişikliğini onaylamadı" yazılır.~~ `monitor.denied` gelince hemen "Müşteri monitör değişikliğini reddetti"; 30 sn yanıtsızlık yedek yol olarak kalır.
4. **Sonner yerine projenin `ui/toast`'ı** (DESIGN §6: Sonner nonce'suz `<style>` enjekte eder → CSP).
5. **Bileşen testleri Vitest + DOM yerine Playwright'ta:** projede jsdom/testing-library yok (mimari §10.4 dışı bağımlılık eklenmedi); saf mantık Vitest'te (machine/input), bileşen davranışı + a11y (axe) e2e'de.
6. "Uzaktan kontrol aktif" çipi taslaktaki gibi görüntü üstünde değil: görüntüyü kapatmamak için kırmızı 4 px çerçeve + şeritte "Kontrol sizde" hapı (`control-frame`).
7. `remote_control.use` yoksa düğme hiç yok (AC-51); sunucu sonradan FORBIDDEN/revoke verirse not "Uzaktan kontrol yetkiniz yok" + düğme kalkar.

### Testler
- `pnpm --filter @remote/web lint` / `typecheck` temiz; `test` 15 dosya / 114 test yeşil (yeni: `lib/control/machine.test.ts`, `input.test.ts`).
- `pnpm --filter @remote/web e2e` 147 geçti / 39 atlandı (mobil projede konsol testleri atlanır). P7: `e2e/p7-control.spec.ts` — AC-47/48/49/99/50 (iste → bekleniyor, onaysız girdi 0 → izin → tık/klavye/Alt+Tab input DC'de → Ctrl+Alt+Shift → bırak/devam → müşteri kısayolla kapatır, < 1 sn, sonrasında girdi 0), AC-99/116 (ret, "Kontrol reddedildi", 0:30 geri sayım ilerler, "4 istek hakkı kaldı"), AC-115 (canlı revoke → yakalama biter, girdi 0), AC-51 (yetkisiz → düğme yok), AC-43/105 (monitör isteği → onay → Ekran 2; yükseltilmiş pencere / güvenli masaüstü). Her durumda axe 0 ihlal, konsol hata/uyarı 0.
- Sahte istemci (`e2e/fake-agent.ts`) gerçek WebRTC ile teklifi yanıtlar ve `input` DC'yi kaydeder; doğrudan sahte sunucuya bağlanır (Next yok, gerçek istemci gibi).
- Elle (test-operatörü / gerçek Windows istemcisi): Türkçe karakter + Alt+Tab'ın uzak ekranda uygulanması, tam ekranda Keyboard Lock, farklı DPI'da ±2 px.
- Tasarım skill dosyaları okunmadı: iş P5 sahnesinin düzen düzeltmesi + mevcut primitiflerle yeni durum çubuğu; DESIGN.md ve `docs/tasarim/04-konsol.html` taslağı esas alındı.

## Frontend P7 — düzeltme turu 1 (frontend-dev, 2026-11-11)
Kaynak: `docs/mimari-protokol.md` §3.3 K1–K4, ADR-0013, güvenlik raporu "P7 — Tur 1" S7-1/S7-2, qa-raporu QA-P7-6. Kapsam yalnız teknisyen konsolu (`apps/web`). Tipler `packages/contracts`'tan (`control.release`, `control.cancel`, `monitor.denied`, kaynak `TECH`, revoke `reconnect`/`stale`) — sunucu ajanı paralelde eklemişti, iş başında mevcuttu; geçici yerel tip yazılmadı, contracts'a dokunulmadı.

### Rotalar
| Yol | Auth | Ne yapar |
|---|---|---|
| `/sessions/[id]/console` (değişti) | Evet (oturumun teknisyeni) | "Kontrolü bırak" artık müşteri kapısını kapatır; "Kontrole devam" yeni istek; bekleyen istekte "Vazgeç"; monitör reddi anında yazılır |
Yeni rota yok.

### Davranış
- **S7-1 / K1:** "Kontrolü bırak" → önce `input` kanalına `k.release_all` (kapı kapanmadan takılı tuş kalmasın), makine `granted → ended{tech}` (yakalama dinleyicileri anında sökülür), WS `control.release`. Yerel duraklatma (`paused`, `resume`) kaldırıldı. Düğme yerine `primary` **Kontrole devam** gelir = yeni `control.request` (müşteri yeniden onaylar); not: "Kontrolü bıraktınız; devam etmek için müşteri yeniden onaylamalı · saat · bu oturumda n istek hakkı kaldı". Kendi bırakması bildirim (toast) üretmez. Odak kalkan düğmeden "Kontrole devam"a geçer.
- **K2:** bekleyen istekte `secondary` **Vazgeç** (`X`) → `control.cancel`, makine `requested → ended{cancel}`; hak iade edilmez (sunucu sayacıyla aynı), 30 sn beklemesi başlamaz. Not: "Kontrol isteğini geri çektiniz".
- **S7-2:** `control.state{GRANTED}` yalnız `requested` fazında (ve yetki varken) izne çevrilir. Diğer her fazda (idle/ended/denied/forbidden) durum değişmez, yakalama başlamaz ve hook WS'e `control.release` yollar (`isUnexpectedGrant`). Zaten `granted`'ken tekrar GRANTED yalnız yok sayılır (açık kontrol bozulmaz, gereksiz bırakma yok).
- **`{VIEW, TECH}`** (bırak/iptal sunucu onayı) sessiz geçer; açık kontrolde gelirse de kapatır (neden `tech`, bildirim yok).
- **K4:** `monitor.denied{monitorId}` bekleyen istekle eşleşirse hemen "Müşteri monitör değişikliğini reddetti" (görünür `role=status`); başka monitöre ait geç ret yok sayılır. 30 sn yanıtsızlık yedek yolu ("onaylamadı") kalır.
- **`control.revoke{reconnect|stale}`:** protokolde S→guest'tir; konsola gelirse de kapatma yönünde işlenir (`reconnect` → `idle`/"Bağlantı yenilendi", `stale` → sistem kapanışı, yetki bayrağı değişmez). Asıl doğrulama e2e sahte istemcide (aşağıda).
- **QA-P7-6:** bekleme düğmesi metni AC-47 ile birebir **"Kontrol bekleniyor"**; açıklama not satırında "Müşterinin onayı bekleniyor; şu an yalnız görüntüleme".
- Hook: makinenin eşzamanlı kopyası (`ctl` ref) artık her olayda `dispatchCtl` içinde güncellenir (önceden render sonrası efektle) — beklenmeyen-izin/bırak/vazgeç kararları render beklemeden verilir.

### Değişen dosyalar
- `apps/web/lib/control/machine.ts` (`paused`/`resume` kaldırıldı; `release`/`cancel` olayları, `canRelease`/`canCancel`/`isUnexpectedGrant`, `ControlEndCause` + `tech`/`cancel`, `monitorOutcome` + `denied`, `TECH` kaynağı, revoke nedenleri), `lib/control/machine.test.ts` (+4 senaryo: K1, K2, S7-2, K4; K3/stale revoke).
- `apps/web/lib/webrtc/use-tech-session.ts` (`releaseControl` → `k.release_all` + `control.release`, yeni `cancelControl`, `resumeControl` kaldırıldı, beklenmeyen GRANTED → `control.release`, `inputRef`).
- `apps/web/components/console/control-button.tsx` (Vazgeç, Kontrole devam = yeni istek, odak yönetimi, monitör reddi notu), `app/(panel)/sessions/[id]/console/console-view.tsx` (`onCancel`, kendi bırakmasında toast yok).
- `apps/web/messages/tr.json` (`p7.waiting` = "Kontrol bekleniyor", yeni `p7.waitingNote`, `p7.cancel`, `p7.end.tech`, `p7.end.cancel`, `p7.monitorDenied`; `p7.paused` kaldırıldı).
- e2e: `e2e/mock-ws.mjs` (oda kontrol durumu VIEW/REQUESTED/GRANTED; `control.release`/`cancel` → misafire aynı mesaj + teknisyene `{VIEW, TECH}`; GRANTED yalnız REQUESTED'da, VIEW'da misafire `control.revoke{stale}`; `monitor.denied` aktarımı; teknisyen kopması/değişimi → misafire `control.revoke{reconnect}`; ws-log'a `control.release`/`cancel`), `e2e/mock-api.mjs` (`GET /__e2e/stray-grant/:id` — sunucu kuralını atlayan istenmemiş izin), `e2e/fake-agent.ts` (Go `gate` taklidi + `closes` kaydı), `e2e/p7-control.spec.ts`.
- `DESIGN.md` §4 ikon satırı, §6 `console/control-button.tsx` satırı.

### Testler
- `pnpm --filter @remote/web lint` / `typecheck` temiz; `test` 15 dosya / 117 test yeşil.
- `pnpm --filter @remote/web e2e` tam paket **148 geçti / 40 atlandı** (mobil projede konsol testleri atlanır). P7 6/6: ana akış artık "Kontrol bekleniyor" + Vazgeç görünür → izin → … → **bırak**: sahte istemci `release` alır, kapı kapalı, `k.release_all` bırakmadan önce input DC'de, teknisyen `control.request, control.release` göndermiş, "Kontrole devam" odakta, girdi 0 → devam = 2. istek → yeniden izin → kısayolla kapanış ("3 istek hakkı kaldı"). Yeni test **"K2/S7-2"**: Vazgeç → `cancel`; müşteri geç onaylar → sahte sunucu `revoke:stale`, konsola izin gelmez; istenmemiş izin (`/__e2e/stray-grant`) → yakalama yok, "Kontrol sizde" yok, konsol `control.release` yollar, girdi 0; izin açıkken sekme yenilenir → misafire `revoke:reconnect`, kapı kapalı. AC-43/105'e **K4**: Ekran 1 isteği → `monitor.denied` → ≤ 2 sn "Müşteri monitör değişikliğini reddetti". axe 0 ihlal, konsol hata/uyarı 0.
- Not: üç tam koşudan birinde P5 `AC-39 axe (light/dark)` yük altında 30 sn zaman aşımına düştü; tek başına ve sonraki tam koşuda geçti (P7 değişikliğiyle ilgisiz, kararsız test adayı).

### Sapmalar
- Yok. (Önceki Frontend P7 sapma 1–3 yukarıda KAPANDI olarak işaretlendi; 4–7 değişmedi.)
- Tasarım skill dosyaları okunmadı: görsel dil değişmedi, mevcut `Button`/not satırı primitifleriyle iki düğme durumu eklendi.

## Backend P7 — düzeltme turu 1 (backend-dev, sunucu + contracts, 2026-11-11)
Kaynak: `docs/mimari-protokol.md` §3 tablo + §3.3 (K1–K5), ADR-0013, `docs/qa-raporu.md` (QA-P7-3/4/5), `docs/guvenlik-raporu.md` "P7 — Tur 1" (S7-1, S7-2, S7-4, S7-10, S7-11). Commit yapılmadı.

### Kapanan maddeler
| ID | Ne yapıldı |
|---|---|
| S7-1 (sunucu + contracts) | `control.release` (tech→S→guest). GRANTED iken önce bellek VIEW + misafire `control.release` + teknisyene `control.state{VIEW, TECH}` (DB beklenmez), sonra sırada `session_consents(CONTROL, REVOKED, TECH)` + audit `control.released` (aktör teknisyen, `newValue.via`) tek TX; yazılamazsa log + ref. Açılış kaydı yazılırken (granting) gelen bırakma: GRANTED teknisyene iletilmez, geç commit REVOKED/TECH ile dengelenir (`ControlRoom.interrupt`). |
| S7-2 / QA-P7-4 | `control.cancel`: REQUESTED → VIEW, misafire `control.cancel`, teknisyene `{VIEW, TECH}`, audit `control.cancelled` (consent yok); GRANTED iken = bırakma; VIEW'da yok sayılır. Sayaç düşmez, 30 sn ret beklemesi başlamaz. `control.state{GRANTED}` yalnız REQUESTED'de işlenir: VIEW'da kayıt/iletim yok + misafire `control.revoke{stale}`, GRANTED'de yok sayılır; ikisinde de metrik + log `control_state_unexpected` (oda başına dakikada ≤ 1 log). |
| S7-4 | Teknisyen kopması (`detachTech`) ve sekme değişimi / yeniden bağlanma (`attachTech`): ADMITTED misafir bağlıysa **her zaman** önce `control.revoke{reconnect}`, ardından `peer.left{tech}` / `peer.joined{tech}`; bekleyen monitör isteği temizlenir; açık kontrol REVOKED/RECONNECT (`newValue.side: "tech"`). |
| S7-10 | `controlStateSchema` refine: GRANTED yalnız UI; VIEW yalnız UI\|HOTKEY\|DENIED\|SYSTEM (`GUEST_VIEW_SOURCES`). Misafirden RECONNECT/TECH → şema hatası → 1008 (uçtan uca test). |
| QA-P7-3 | `dc.ts` `keySchema.code` → `^[A-Za-z0-9]{1,32}$`; `fixtures/dc-input.json` invalid'e `Key-A` ve 33 karakterlik kod. |
| QA-P7-5 | `control.requested` (ve aynı kalıpla `monitor.requested`) audit'i iletimden **önce** yazılır (zaman çizelgesinde istek satırı karardan önce). Mimar tablosu istek için fail-closed istemiyor (ADR-0013: yalnız açma yönü) → yazılamazsa (hata / 800 ms) log + ref + metrik `control_request_audit_failed`, istek yine iletilir. Yazım sürerken iptal/kopma olduysa istek müşteriye gitmez (`superseded`). |
| K4 / K5-e | `monitor.denied` (guest(AGENT)→S→tech): yalnız bekleyen istekle aynı `monitorId` için — bekleyen temizlenir, 30 sn bekleme, audit `monitor.denied`, teknisyene alanlar yeniden kurularak iletilir; diğer kimlik / bekleyen yok → yok say + metrik/log; BROWSER → yok say. Tek bekleyen istek: bekleyen varken yeni `monitor.request` → `error{CONFLICT}`. 30 sn yanıtsızlık ret gibi işler (audit/mesaj yok, sonraki 30 sn `RATE_LIMITED`). `share.state.activeMonitor === bekleyen` → audit `monitor.granted`, bekleme kalkar. |
| K5-d | Oturum sonu (`teardown`, hem `finish` hem `closeSession`): `session.ended` gönderildikten sonra açık kontrol için en iyi çabayla REVOKED/SYSTEM + `control.revoked{reason: "session_ended"}`; beklenmez, yazılamazsa log + ref, bitiş engellenmez. |
| `rs_control_total` | Olay değerleri `metrics.ts` HELP metninde listelendi (yeni: `cancelled`, `released`, `released_by_cancel`, `{release,cancel}_ignored`, `revoke_reconnect`, `revoke_session_ended`, `reset_guest_gone`, `control_state_unexpected`, `monitor_{granted,denied}`, `monitor_denied_{unexpected,ignored}`, `*_request_{conflict,superseded}`, `*_request_audit_failed`). |

### P9/P10 için zorunlu not (S7-11 — kod değişikliği yok)
`app.rooms` `TechnicianLiveControl` arayüzü (`apps/server/src/signaling/rooms.ts`): **`endByTechnician(userId)`** ve **`applyPermChange(userId, permissions)`**. P9 (kullanıcı deaktivasyonu, yetki toggle, rol değişimi) ve P10 (logout-all, reset-MFA) servisleri bunları **DB TX commit edildikten sonra** doğrudan çağırmak zorundadır (TX içinde değil — geri alınan değişiklik canlı odayı kapatmasın; commit'ten önce değil — yarışta eski yetki okunmasın). Çağrılmazsa AC-115 "5 sn" hedefi tutmaz, yetki kaldırıldıktan sonra kontrol /ws/tech 60 sn yeniden doğrulamasına kadar (yedek yol) açık kalabilir. P9/P10 qa/güvenlik turunda giriş şartı olarak denetlenmeli; her biri için "commit sonrası çağrı + ≤ 5 sn'de `control.revoke{permission}` / `session.ended{auth_revoked}`" entegrasyon testi beklenir.

### Değişen dosyalar
- `packages/contracts/src/ws.ts` — `CONTROL_SOURCES += TECH`, `GUEST_VIEW_SOURCES`, `CONTROL_REVOKE_REASONS += reconnect, stale`, `controlReleaseSchema`, `controlCancelSchema` (tech inbound), `monitorDeniedSchema` (guest inbound), sunucu çıkışına `control.release`, `control.cancel`, `monitor.denied`; misafir `control.state` refine.
- `packages/contracts/src/audit.ts` — `RELEASED`, `CANCELLED`, `MONITOR_GRANTED`, `MONITOR_DENIED`.
- `packages/contracts/src/dc.ts` — `keySchema.code` regex.
- `packages/contracts/fixtures/ws-messages.json` (geçerli: tech release/cancel, guest monitor.denied + VIEW/UI, server release/cancel/monitor.denied/revoke reconnect+stale/control.state TECH+RECONNECT/error INTERNAL; geçersiz: tech release+alan, cancel+alan, tech'ten monitor.denied ve control.state, guest VIEW/RECONNECT, VIEW/TECH, GRANTED/TECH, kimliksiz/65 monitor.denied, guest'ten release/cancel), `fixtures/dc-input.json`.
- `packages/contracts/test/control-p7.test.ts` — S7-10, K1–K2, K4, revoke nedenleri, audit adları, QA-P7-3.
- `apps/server/src/signaling/control.ts` — `handleControlClose` (release/cancel), `handleMonitorDenied`, `onShareMonitor` (monitor.granted; imza `rooms, room, guest, activeMonitor`), `revokeOnTechChange` (K3), `resetOnGuestGone` (eski `resetControl`'ün misafir yolu), `closeControlOnEnd` (K5-d), `recordClose` / `interrupt` dengelemesi, `auditBeforeForward` (QA-P7-5); `onGranted` yalnız REQUESTED.
- `apps/server/src/signaling/types.ts` — `ConsentSource` (+TECH), `CloseRecord`, `ControlRoom.{interrupt, monitorDeniedAt, unexpectedLogAt}`.
- `apps/server/src/signaling/rooms.ts` — `attachTech`/`detachTech` K3 sırası, `teardown` → `closeControlOnEnd`.
- `apps/server/src/signaling/handlers.ts` — `control.release`, `control.cancel`, `monitor.denied` yönlendirme; `share.state` iletimden sonra `onShareMonitor`.
- `apps/server/src/ops/metrics.ts` — `rs_control_total` HELP.
- `apps/server/test/integration/signaling-control-p7.test.ts` — mevcut testler yeni kurala uyarlandı (GRANTED öncesi istek; 5 istek döngüsü iptalle; monitör CONFLICT) + yeni testler (aşağıda).
- Dokunulmadı: migration `20261111050000_p7_consent_source_tech/` ve `schema.prisma` (dba); testten önce klasörün tamam olduğu ve uygulandığı doğrulandı.

### Testler ve son çıktı
- `pnpm -r run lint` · `pnpm -r run typecheck` → 3/3 temiz.
- `pnpm -r run test` → contracts **43/43**, server unit **243/243**, web **117/117**.
- Entegrasyon: `TEST_DB_CONTAINER=rs-mysql-p7fix1 TEST_DB_PORT=33371 apps/server/scripts/test-db.sh up` (MySQL 8.4, P7 TECH migration'ı dahil uygulandı) → `pnpm --filter @remote/server test:int` → **23 dosya / 179 test** yeşil (iki kez); konteyner `down` ile silindi.
- Yeni entegrasyon testleri: S7-1 (DB asılıyken bırakma anında mesajlar; REVOKED/TECH + `control.released`; granting sırasında bırakma dengelemesi), §3.3 VIEW'da release/cancel no-op, S7-2 (cancel, GRANTED'de cancel = release), QA-P7-4 (iptal sonrası ve istek yokken GRANTED → `revoke{stale}`, kayıt yok; çift GRANTED), bekleyen istekte ikinci istek CONFLICT, QA-P7-5 (audit iletimden önce; audit hatasında iletim + metrik), S7-4 (kopmada revoke→peer.left sırası; yeni sekmede revoke→peer.joined, VIEW'da da), K5-d (kapanış satırı; DB hatasında bitiş sürer; kapalı kontrolde satır yok), K4 (monitor.denied kimlik eşleşmesi, audit, 30 sn; yanıtsızlık yedek yolu; BROWSER), uçtan uca WS (cancel/release yönlendirme, sekme kapanınca `revoke{reconnect}`, S7-10 1008, `monitor.denied` iletimi).

### Sapmalar (gerekçeli)
1. **`control.request` REQUESTED iken → `error{CONFLICT}`** ("Önceki kontrol isteği müşteride bekliyor."). §3.3 tablosu isteği yalnız VIEW'dan tanımlıyor; önceki kod REQUESTED'de yeniden iletiyordu. Teknisyen tekrar istemek için önce `control.cancel` göndermeli (sayaçtan düşer). **frontend-dev:** "Kontrol iste" REQUESTED'de devre dışı / "Vazgeç" sonrası etkin olmalı.
2. **S7-2'deki "misafir başına `control.state` kotası (dakikada 20)" eklenmedi.** Mimar tablosunda yok; durum kuralı DB yazımını zaten sınırlıyor: GRANTED yalnız REQUESTED'de, REQUESTED yalnız teknisyen isteğiyle (oturum başına ≤ 5), DENIED yalnız REQUESTED'de, REVOKED yalnız GRANTED'den → oturum başına en çok ~10 consent satırı. Beklenmeyen mesajlar kayıt üretmez; log oda başına dakikada ≤ 1 (metrik her zaman). Genel 50 msg/sn token bucket geçerli.
3. **`control.requested` için fail-closed yok** (QA-P7-5): ADR-0013 fail-closed'u yalnız açma yönüne (GRANTED) bağlıyor; istek kapıyı açmaz. Audit iletimden önce, 800 ms sınırlı bekleme ile yazılır.
4. **Açılış yazılırken kapatma:** misafire `control.release`/`revoke` hemen gider; geç commit edilen GRANTED satırı **ilk** kapatmanın kaydıyla dengelenir (önceden her durumda REVOKED/SYSTEM `superseded`). Tabloyla uyumlu (aktör doğru), ek şema yok.
5. **Teknisyen kopması REVOKED/RECONNECT `newValue`'una `side: "tech" | "guest"` eklendi** (P8 zaman çizelgesi kim koptu ayrımı için; consent şeması değişmedi).

### Diğer ajanlar için sözleşme notları
- **Go (backend-dev):** `fixtures/ws-messages.json` genişledi — `internal/signal` fixture testi yeni tipleri (`control.release`, `control.cancel`, `monitor.denied`, `control.revoke{reconnect|stale}`, `control.state{TECH|RECONNECT}`, `error{INTERNAL}`) tanıyana kadar kırmızı olur. Misafir tarafından gönderilen `control.state` kaynakları: VIEW → UI\|HOTKEY\|DENIED\|SYSTEM (RECONNECT/TECH göndermeyin → 1008). `monitor.denied{monitorId}` yalnız bekleyen istekle aynı kimlikle anlamlıdır. `dc-input.json` invalid'e `Key-A` eklendi (Go zaten reddediyor).
- **frontend-dev:** teknisyen `control.release` / `control.cancel` gönderir; yanıt `control.state{VIEW, source:"TECH"}`. Sunucudan `monitor.denied{monitorId}` gelir. Bekleyen monitör isteği varken yeni istek `error{CONFLICT}`. Teknisyen yeniden bağlandığında konsol `hello` ile VIEW başlar. Bkz. sapma 1.
- Yeni bağımlılık yok.

## Agent P7 — düzeltme turu 1 (backend-dev/Go, 2026-11-11)
Kaynak: `docs/mimari-protokol.md` §3/§3.3 K1–K4/§4.3, ADR-0013, `docs/guvenlik-raporu.md` "P7 — Tur 1" (S7-1 istemci, S7-3, S7-5..S7-9, S7-4/S7-10 istemci tarafı). Yalnız `apps/agent-win/`. Yeni bağımlılık yok.

### Değişen dosyalar
| Dosya | Değişiklik | Bulgu |
|---|---|---|
| `internal/signal/messages.go` | Gelen `control.release`, `control.cancel`; `control.revoke.reason` += `reconnect`, `stale`; giden `monitor.denied{monitorId 0..64}`; misafir `control.state` VIEW kaynağı yalnız UI\|HOTKEY\|DENIED\|SYSTEM (RECONNECT/TECH gönderilemez); `monitor.denied` sunucudan misafire gelirse `ErrNotForGuest` | S7-1, S7-2, S7-4, S7-10, K4 |
| `internal/flow/control.go`, `flow.go` | release/cancel: kapı + kontrol diyaloğu kapanır, yanıt yok; metin "Teknisyen kontrolü bıraktı" (kapı açıktıysa) / "Teknisyen isteği geri çekti" (yalnız diyalog açıktıysa). revoke (her reason): kapı + kontrol ve monitör diyaloğu kapanır, `{VIEW,SYSTEM}` **yalnız kapı açıktıysa** (önceden her zaman gidiyordu). `reconnect`: "Teknisyenin bağlantısı koptu — uzaktan kontrol kapatıldı" yalnız kapı/diyalog açıktıysa; ardından gelen `peer.left/joined{tech}` bu metni ezmez. `peer.left/joined{tech}` ile kapatma (K3 ikinci katman) korundu. Monitör diyaloğunda ret → `monitor.denied{monitorId}`. `UI.MonitorPromptClosed()` eklendi (kontrol ve monitör diyaloğu ayrı kapanır) | S7-1, S7-2, S7-4, K4 |
| `internal/control/gate.go` | `Shut(after)`: kapıyı atomik kapatır, kapanış dinleyicileri + `after` ayrı goroutine'de, asla bloklamaz (kanca/kısayol iş parçacığı için). `OnOpen` dinleyicisi (kapalı→açık geçişinde) | S7-3, S7-7 |
| `internal/input/host_windows.go` | WM_HOTKEY → `gate.Shut(onHotkey)` (kilit beklenmez). LL kancaları yalnız kapı açıkken kurulu: `gate.OnOpen/OnClose` → `Host.Hooks(on)` → `PostThreadMessage` ile Host iş parçacığında kur/kaldır. Global "son basış enjekte mi" bayrağı (`LastPressInjected`) kaldırıldı; kancalar yalnız AC-104 yerel önceliği için | S7-3, S7-5, S7-7 |
| `internal/input/applier.go` | Kilit sırası belgelendi (Host iş parçacığı `a.mu`'yu asla almaz). Kapı kapalıyken ayrıştırmadan erken düşürme; jeton kovası 250 msg/sn, ani 500; aşan basma/hareket/tekerlek düşer ve `Limited()` sayar; bırakma olayları (`k`/`m.btn` down=false, `k.release_all`) sınırdan muaf (takılı tuş kalmasın). 512 bayt sınırı `Parse`'ta sürüyor | S7-8 |
| `internal/win/win_windows.go` | `InputInjected()` = `GetCurrentInputMessageSource` (IMO_INJECTED; bilinmiyorsa known=false); WM_SYSKEYDOWN/WM_SYSCHAR/WM_LBUTTON* sabitleri | S7-5 |
| `internal/ui/form_windows.go` | UI mesaj döngüsü her form girdi mesajının kaynağını kaydeder (sol tık = basış + bırakma, ikisi de yerel olmalı; Alt+İ = WM_SYSCHAR, kaynağı bilinmiyorsa onu üreten tuş basışı). `thread.userInput(f)`: şu an işlenen mesaj bu forma gelen, enjekte olmayan girdi mi; girdi mesajı işlenmiyorsa (başka süreçten WM_COMMAND/BM_CLICK) false | S7-5 |
| `internal/ui/control_windows.go` | Ortak `consentDlg` (kontrol, monitör, **dosya teklifi**): `consentSpec` + `present()` (imleç dışında yerleşim, Reddet odağı, 1,5 sn kilidi yeniden başlatır); `tryGrant` olay-özgü kaynağa bakar; birden çok kırmızı uyarı satırı; yönetici uyarısı | S7-5, S7-6, S7-9 |
| `internal/ui/screens_windows.go` | Oturum penceresinde "Erişime izin ver" artık izin **vermez**: bekleyen kontrol diyaloğunu `present()` ile öne getirir (imleç dışı + 1,5 sn + Reddet odağı); bekleyen istek varken etkin. Dosya teklifi ortak diyaloğa taşındı ("Kabul et" enjekte tıklamayla verilemez). Yönetici olarak çalışıyorsa oturum penceresinde kırmızı uyarı | S7-5, S7-6, S7-9 |
| `internal/env/probe_windows.go`, `cmd/noktadestek/main.go` | `env.SelfElevated()`; `u.SetElevated(...)` | S7-9 |

### Kararlar / sapmalar (gerekçeli)
1. **S7-3 kilit tasarımı:** `SendInput` yine `Applier` kilidi altında (AC-101: `Close` döndükten sonra 0 olay, `Close` uçuştaki enjeksiyonu bekler). Kilitlenme döngüsü "Host iş parçacığı hiçbir kilit beklemez" kuralıyla kırıldı: kancalar yalnız atomik yazar, kısayol `Shut` kullanır. `Shut` sonrası yeni olay uygulanmaz; `Shut` anında zaten `SendInput` içinde olan tek parti (olayları sisteme verilmiş, kancayı bekleyen) tamamlanır — bu olaylar kapanıştan önce verilmiştir. UI düğmesi ve akış yolları senkron `Close` kullanmaya devam eder (bu iş parçacıklarında LL kanca yok).
2. **S7-5 olay kaynağı:** Görevdeki "LLMHF/LLKHF_INJECTED olayın kendisinde" isteği, kancadaki bayrak yerine tıklamayı üreten pencere mesajının kendi kaynağıyla (`GetCurrentInputMessageSource`, Win8+; hedef Win10 22H2+) karşılandı. Kanca bayrağını mesajla eşlemek zaman/nokta tahmini gerektirirdi; mesaj kaynağı tam olarak o olayın IMO_INJECTED bilgisidir ve global duruma bağlı değildir. Kaynak bilinmiyorsa enjekte sayılır (fail-closed).
3. **S7-7:** LL kancaları yalnız **kapı açıkken** kurulu (izin diyaloğu açıkken değil): S7-5 sonrası diyalogların kancaya ihtiyacı kalmadı; kancanın tek işi AC-104 yerel önceliği, o da yalnız kapı açıkken anlamlı. Böylece KVKK onayı/lobi/görüntüleme boyunca sistem girdisi Go geri çağrısından geçmez ve AV/EDR keylogger buluşsalı daha az tetiklenir. `RegisterHotKey` başlangıçta kalır (G-21: diyalog kısayolun alınıp alınamadığını bilmeli).
4. **S7-8 sınır değeri:** 250/sn + 500 patlama (güvenlik önerisi). Konsol hareketi 16 ms'de bir (~62/sn) gönderiyor; 4 kat pay. Görevde örnek verilen ~1000/sn yerine bu seçildi çünkü normal kullanımı etkilemeden daha sıkı.
5. **S7-9 (mimar kararı yok → en güvenli bilgi uyarısı):** İstemci yükseltilmişse oturum penceresinde ve kontrol izni diyaloğunda kırmızı uyarı; izin engellenmez. `env.state`'e `selfElevated` **eklenmedi**: sunucu şeması `strict`, bilinmeyen alan 1008 ile bağlantıyı keser; sözleşme değişikliği mimar + sunucu + konsol işidir. Mimardan karar beklenir (teknisyene gösterilsin / audit'e yazılsın mı).
6. **release/cancel yalnız kontrol diyaloğunu kapatır**, monitör diyaloğu sürer (sunucu bu mesajlarda bekleyen monitör isteğine dokunmuyor, K2). revoke, kopma, hello, PeerConnection kopması ve `peer.left/joined{tech}` ikisini de kapatır. Kullanıcının "Kontrolü kapat"ı/kısayolu artık monitör diyaloğunu kapatmaz (o diyalog kendi kararını `monitor.denied` ile bildirir).
7. **Bilinmeyen `control.revoke.reason`:** `ParseServer` katı kalır; şema hatası WS'i kapatır, oturum sonlanır ve `cleanup` kapıyı kapatır — kapatma yönü fail-closed.

### Testler ve son çıktı
Komut (docker `golang:1.26.11-bookworm`, `apps/agent-win`): `gofmt -l .` (boş) → `go vet ./...` → `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go vet ./...` → `go mod verify` → `go test -race -count=1 ./...` (+ flow/input/control/signal `-count=3`) → tüm paketler `GOOS=windows go test -c` → `build/build.sh https://staging.example:4450 0.7.1` iki kez (arada `go clean -cache`) → govulncheck v1.1.4 (linux + `GOOS=windows`).
Son çıktı: gofmt temiz; iki vet temiz; `all modules verified`; **15/15 paket ok** (-race), güncel `fixtures/ws-messages.json` ve `dc-input.json` ile fixture testleri yeşil; Windows test ikilileri derlendi; iki build aynı SHA-256 `482a7a9b…edb60943b` (12,09 MB); govulncheck iki hedefte "Your code is affected by 0 vulnerabilities".
Yeni testler: `control` — `TestS73ShutNeverBlocksAndClosesAtomically` (dinleyici bloklu iken Shut hemen döner, kapı anında kapalı), `TestS77OpenListenerOnlyOnTransition`. `input` — `TestS73HotkeyOnHookThreadDoesNotDeadlockWithSendInput` (SendInput'u "kanca iş parçacığı" onayına bağlayan sahte enjektör; enjeksiyon kilit altında beklerken kısayol → kilitlenme yok, ≤ 100 ms, sonrasında 0 olay), `TestS78InputRateLimit` (patlama/dolum, bırakma muafiyeti, kapalı kapıda erken düşürme). `signal` — release/cancel/revoke{reconnect,stale} kabulü, ek alan reddi, `monitor.denied` kodlama/sınır, misafirden RECONNECT/TECH reddi. `flow` — `TestK1ReleaseClosesGateWithoutReply`, `TestK2CancelClosesPromptAndLateGrantIgnored`, `TestK1K2IdleAndPromptTexts`, `TestK2CancelKeepsMonitorPromptRevokeClosesIt`, `TestK2StaleRevokeWhileViewSendsNothing`, `TestK3ReconnectRevokeThenPeerLeft`, `TestK3PeerJoinedClosesPromptWithoutRevoke`, `TestK4MonitorDeniedSent`.

### Windows'ta elle doğrulanacaklar (adım 25–36'ya ek)
37. **S7-3 (kısayol + sürekli hareket):** kontrol açıkken teknisyen fareyi konsolda kesintisiz dairesel hareket ettirsin; müşteri bu sırada başka bir pencere odaktayken Ctrl+Shift+F12'ye bassın → hareket anında durmalı, sistemde girdi takılması (fare/klavye donması) olmamalı, konsolda kaynak HOTKEY. Ardından yeni kontrol izni verip AC-104'ü (adım 32) tekrar et: yerel fare hareketi uzaktan girdiyi hâlâ ~1 sn askıya almalı (kanca Windows tarafından kaldırılmamış). 10 kez tekrarla.
38. **S7-5 (enjekte tıklama):** kontrol açıkken konsoldan monitör isteği gönder ve teknisyen kendi faresiyle müşteri ekranındaki diyalogda 1,5 sn sonra "İzin ver"e tıklasın → hiçbir şey olmamalı; bu sırada müşteri klavyede bir tuşa bassa bile (eski global bayrak açığı) teknisyenin tıklaması izin vermemeli. Teknisyen Alt+İ gönderirse de izin olmamalı. Müşteri kendi faresiyle tıklayınca izin verilmeli. Aynı adımı dosya teklifinde ("Kabul et") tekrarla: teknisyenin enjekte tıklaması dosyayı kabul etmemeli; müşterinin tıklaması etmeli. **Tur 2 (S7-12) ek kontrol:** müşterinin kendi gerçek fare tıklaması (ve kendi Alt+İ'si) izin **verir**; SendInput ile üretilen tıklama (teknisyen girdisi veya yerelde bir SendInput test aracı) izin **vermez**. Bu kontrol kontrol izni, monitör izni ve dosya kabulü diyaloglarının üçünde de yapılır; yalnız "hiçbir şey olmuyor" sonucu yeterli değildir.
39. **S7-6:** kontrol isteği gelince oturum penceresindeki "Erişime izin ver"e tıkla → izin verilmemeli; diyalog imlecin altında olmayacak şekilde öne gelmeli, odak "Reddet"te, "İzin ver" 1,5 sn gri.
40. **S7-7:** Görüntüleme sırasında (kontrol yok) Process Explorer/`Get-Process` yerine Spy++ veya AV loguyla LL kanca yokluğunu; kontrol verildiğinde kurulduğunu, kapatınca kalktığını gözle (adım 32 kontrol açıkken çalışmalı, kapalıyken anlamsız).
41. **K1–K4:** konsolda "Kontrolü bırak" → müşteride gösterge "izleniyor", durum "Teknisyen kontrolü bıraktı"; bekleyen istekte konsol "Vazgeç" → diyalog kapanır, "Teknisyen isteği geri çekti"; teknisyen sekmesini kapat/yenile → "Teknisyenin bağlantısı koptu — uzaktan kontrol kapatıldı" (yalnız kontrol veya diyalog açıkken); monitör diyaloğunda Reddet/Esc/X → konsol 30 sn beklemeden "reddetti".
42. **S7-9:** istemciyi "Yönetici olarak çalıştır" ile aç → oturum penceresinde ve kontrol izni diyaloğunda kırmızı yönetici uyarısı görünmeli; normal açılışta görünmemeli.

### frontend-dev / backend için sözleşme notları
Sözleşme değişikliği yok (contracts sunucu turuyla geldi; Go buna uyar). İstemci: release/cancel'a yanıt göndermez; revoke'ta yalnız kapı açıktıysa `{VIEW,SYSTEM}` döner (VIEW'daki `stale`'e yanıt yok); monitör reddinde `monitor.denied{monitorId}` gönderir; RECONNECT/TECH kaynağı göndermez. S7-9 için `env.state.selfElevated` önerisi mimar kararı bekliyor.

## Backend P7 — düzeltme turu 2 (sunucu, S7-15)

Kaynak: `docs/guvenlik-raporu.md` "P7 — Tur 2" S7-15 [DÜŞÜK]. Yalnız sunucu; `apps/agent-win` ve konsola dokunulmadı.

### Değişen dosyalar
- `apps/server/src/signaling/types.ts` — `ControlRoom.monitorPending` artık isteğin iletildiği misafir bağlantısını taşır: `{ id, at, peer }`.
- `apps/server/src/signaling/control.ts`
  - `resetOnGuestGone`: bekleyen monitör isteği **her kopmada** temizlenir (`closeState`'ten önce; kontrol VIEW'da olsa bile). Teknisyen kopmasındaki K3 temizliğinin simetriği. Teknisyen artık 30 sn `CONFLICT` + 30 sn `RATE_LIMITED` almaz.
  - `onShareMonitor`: `monitor.granted` yalnız `guest.peer === monitorPending.peer` iken yazılır. Yeniden bağlanan istemcinin ilk `share.state`'i karşılama sayılmaz. `reattachGuest` F5 yarışında da `detachGuest` → temizlik çalışır.
  - `handleMonitorRequest`: zaten etkin monitör (`room.share.activeMonitor === monitorId`) için istek açılmaz: `error{VALIDATION, "Bu monitör zaten paylaşılıyor."}`, sayaç düşmez, metrik `monitor_request_already_active`. İletim `pending.peer`'e yapılır, süpersede koşulu bağlantı değişimini de kapsar.
- `docs/mimari-protokol.md` §3 `monitor.request` satırı: etkin monitör → VALIDATION, karşılanma aynı bağlantıdan, kopmada temizlik.
- `apps/server/test/integration/signaling-control-p7.test.ts` — yeni testler + mevcut testlerin uyarlanması (aşağıda).

### Sapma / gerekçe
- Raporun ikinci önerisi ("etkin monitör istenirse no-op / VALIDATION") **VALIDATION** olarak uygulandı. Sessiz no-op konsolu 30 sn yanıt bekletirdi; hata hemen bildirilir. Mevcut hata kodu kullanıldı, yeni kod yok.
- Bağlantı eşlemesi `Peer` nesnesiyle yapıldı (Guest nesnesi yeniden bağlanmada aynı kalıyor, `peer` değişiyor). Ek sayaç/epoch gerekmedi.

### Testler
- Yeni: `S7-15/AC-43` (oda katmanı: istek → `detachGuest` → bekleyen temizlendi → `reattachGuest` → `share.state{activeMonitor = istenen}` → **monitor.granted YOK** → yeni istek CONFLICT değil, yeni bağlantıya iletilir); `S7-15` (farklı bağlantı kimliğiyle bekleyen istek karşılanmaz); `S7-15` uçtan uca gerçek WS (AGENT misafir monitör isteği bekliyorken kopar, `rs.reconnect` ile döner, ilk `share.state` istenen monitörü bildirir → `monitor.granted` audit 0, `monitor.requested` 2, ikinci istek iletilir).
- Uyarlanan: AC-43 testi etkin monitör 0'ı CONFLICT örneği olarak kullanıyordu. Artık `already_active`/VALIDATION bekleniyor; CONFLICT için 3. monitör eklendi. `monitorPending` literal'lerine `peer` eklendi.
- Mutasyon kontrolü: iki koruma (kopmada temizlik + bağlantı eşlemesi) geçici kaldırılınca 3 yeni test kırmızı. Geri alınınca yeşil.
- Komutlar ve son çıktı: `pnpm -r run lint` ✓ · `pnpm -r run typecheck` ✓ · `pnpm --filter @remote/server test` → 12 dosya / 243 test ✓ · `TEST_DB_CONTAINER=rs-mysql-p7fix2 TEST_DB_PORT=33372 apps/server/scripts/test-db.sh up` (MySQL 8.4, 6 migration) + `pnpm --filter @remote/server test:int` → **23 dosya / 182 test** ✓ (iki kez). Konteyner `down` ile silindi.

### Ek iş: mimar kararları K6 + K8/S7-9 (koordinatör ataması, `mimari-protokol.md` §3.3, ADR-0013 Ek)
- **Contracts (önce bitti):** `packages/contracts/src/ws.ts` `envStateSchema` (strict) şemasına zorunlu `selfElevated: z.boolean()` eklendi. Teknisyene giden şema `envStateSchema.omit({id})` olduğu için alan oraya da kendiliğinden geçti. `fixtures/ws-messages.json`: 3 env.state örneğine alan eklendi (valid.guest `false`, valid.server `true`, invalid.guest `true` — o örnek `secureDesktop` eksik olduğu için yine geçersiz). Yeni geçersiz örnek: `selfElevated` eksik env.state. `test/control-p7.test.ts`: eksik alan / null / teknisyen şeması durumları test ediliyor.
- **K8 sunucu:** `types.ts` içinde `GuestEnv` tipi ve `Room.guestEnv` alanı. `handleEnvState` son değeri saklıyor ve alanları yeniden kurarak iletiyor. `resetOnGuestGone` alanı temizliyor. `onGranted` GRANTED audit `newValue`'suna `selfElevated: "true"|"false"|"unknown"` yazıyor (`session_consents` değişmedi, migration yok).
- **K6 sunucu:** `onView` içinde `REQUESTED` + `{VIEW, UI|HOTKEY|SYSTEM}` durumunda oda VIEW'a geçiyor ve teknisyene `{VIEW, <gelen kaynak>}` gidiyor. Consent yazılmıyor; `deniedAt` ve sayaç değişmiyor. Audit `control.cancelled` `{by:"agent", source}` (aktör müşteri) fire-and-forget yazılıyor; hata olursa log + ref. Metrik: `cancelled_by_agent`. Önceden bu durumda kayıt hiç yazılmıyordu.
- `ops/metrics.ts` yardım metnine `already_active` ve `cancelled_by_agent` eklendi.
- **Testler:**
  - K6 oda katmanı: SYSTEM, UI ve HOTKEY kaynakları için consent 0, cancelled audit, bekleme yok, yeni istek hemen iletiliyor, VIEW'da tekrar gelen mesaj ek kayıt üretmiyor.
  - K6 gerçek WS testi.
  - K8 oda katmanı: env.state saklanıyor, iletiliyor ve kopmada temizleniyor. GRANTED audit'inde önce `unknown`, env.state geldikten sonra `true`.
  - K8 gerçek WS: alan iletiliyor, GRANTED audit'inde `selfElevated:"true"` var, alan eksikse **1008**.
  - Tarayıcı misafirinden gelen env.state `guestEnv`'e yazılmıyor.
- **Son çıktı:** `pnpm -r run lint` ✓ · `pnpm -r run typecheck` ✓ · `pnpm -r run test` → contracts 43, server unit 244, web 124 ✓ · `test-db.sh up` (rs-mysql-p7fix2, MySQL 8.4) + `test:int` → **23 dosya / 186 test** ✓ (iki kez). Konteyner silindi.
- **Go istemci için:** Fixture artık `selfElevated` içeriyor. Go struct alanı eklenene kadar `apps/agent-win/internal/signal` fixture testleri kırmızı olur (beklenen). Alan `omitempty` olmadan eklenmeli (K8).

### frontend-dev için sözleşme notu
- **K8:** Teknisyene giden `env.state` artık `selfElevated: boolean` taşıyor (zorunlu). Konsol `true` iken K8 rozetini gösterir.
- **K6:** `requested` fazında gelen `{VIEW, SYSTEM}` (veya UI/HOTKEY) isteği kapatır. Bekleme yoktur, yeni istek hemen gönderilebilir.
- **Monitör (S7-15):** Şema değişikliği yok. Konsol, zaten paylaşılan monitörü isterse artık `error{code: "VALIDATION"}` alır; mevcut VALIDATION işleme yeterli. Misafir koptuğunda sunucu bekleyen monitör isteğini düşürür ve teknisyene ayrı mesaj göndermez (`peer.left{guest}` gelir). Konsol kendi bekleme göstergesini `peer.left`'te kapatabilir.

## Agent P7 — düzeltme turu 2 (backend-dev/Go, 2026-11-11)
Kaynak: `docs/guvenlik-raporu.md` "P7 — Tur 2" (S7-12, S7-13, S7-14, S7-16), mimar kararları `docs/mimari-protokol.md` §3.3 K6, K8 ve ADR-0013 "Ek — P7 Tur 2". Yalnız `apps/agent-win/` (+ bu dosya). Yeni bağımlılık yok.

### Değişen dosyalar
| Dosya | Değişiklik | Bulgu |
|---|---|---|
| `internal/control/origin.go` (yeni) | winuser.h adlarıyla `IMO_UNAVAILABLE=0, IMO_HARDWARE=1, IMO_INJECTED=2, IMO_SYSTEM=4`. Saf `OriginInjected(origin, ok)`: yalnız başarılı sorguda `IMO_HARDWARE` yerel, diğer her değer enjekte (fail-closed). `CharInjected(keyInjected, origin, ok)`: WM_CHAR/WM_SYSCHAR kaynağı yoksa tuş basışının kararı | S7-12 |
| `internal/win/win_windows.go` | Yanlış `imoInjected = 0x01` ve `InputInjected` kaldırıldı. Yerine yorumsuz `InputOrigin() (originId, ok)` geldi; karar `control`'da | S7-12 |
| `internal/ui/form_windows.go` | `track` kararı `control.OriginInjected`/`CharInjected` ile veriyor. Mesaj döngüsünde `t.cur` her mesaj işlendikten sonra sıfırlanıyor (`handle` ayrıldı) | S7-12, S7-14 |
| `internal/input/applier.go` | `isRelease` yerine `heldReleaseLocked`: yalnız basılı tuş/düğmenin bırakılması sınırdan muaf. Basılı olmayan düğmeyi bırakma no-op (hareket de enjekte edilmez) ve jeton harcar | S7-13 |
| `internal/control/gate.go` | Durum tek atomik `state = nesil<<1 \| açık`; her açılış yeni nesil. Kapanış dinleyicisi kapanan neslin değerini alır (`OnCloseGen`). `StillClosed(gen)` eklendi. `OnOpen`/`OnClose` imzaları değişmedi | S7-16 |
| `internal/input/host_windows.go` | `wmHooksOff` wParam'da nesil taşıyor. Kanca yalnız `gate.StillClosed(nesil)` ise kaldırılıyor; bayat Shut isteği yeni açılışın kancalarını kaldırmıyor. `Hooks(on)` → `post(msg, wp)` | S7-16 |
| `internal/signal/messages.go` | ``EnvState.SelfElevated bool `json:"selfElevated"` `` (omitempty yok, strict zorunlu) | K8 / S7-9 |
| `internal/flow/control.go`, `flow.go` | **K8:** `Deps.SelfElevated`. Her `hello`'dan hemen sonra (closeControl'den sonra, monitör seçiminden önce) `helloEnv` ile tek `env.state` gidiyor; alanlar o an ölçülüyor, yoklayıcı yoksa false. İzleyici olayları yalnız son gönderilenden farklıysa gönderiliyor. `envKnown` kaldırıldı. **K6:** `onPeer` disconnected/failed/closed dalında `closeControl` sonucu "kontrol diyaloğu açıktı ve kapı kapalıydı" ise ek `control.state{VIEW,SYSTEM}` gidiyor. `closeControl` genel davranışı değişmedi; monitör diyaloğu mesajsız kapanıyor | K6, K8 |
| `cmd/noktadestek/main.go` | `env.SelfElevated()` açılışta bir kez ölçülüyor; hem `u.SetElevated` hem `Deps.SelfElevated` | K8 |
| Testler | `control/control_test.go`, `input/input_test.go`, `flow/control_test.go`, `flow/flow_test.go` (fakeConn `env.state`'i ayrı `env` kanalına yazıyor), `signal/signal_test.go` | — |

### Doğrulanan çağrı yolları (S7-12)
Kontrol izni (`u.ctlDlg`), monitör izni (`u.monDlg`) ve dosya kabulü (`u.offer`) üçü de `newConsent` → `consentDlg.tryGrant` → `thread.userInput` → `track` → `control.OriginInjected`/`CharInjected` yolunu kullanıyor. `win.InputOrigin`'in başka çağıranı yok.

### Kararlar / sapmalar (gerekçeli)
1. **S7-12 bilinen sınır:** UIAccess yetkili bir uygulamanın SendInput'u da `IMO_HARDWARE` görünür. Bu yerel ve yetkili yazılım gerektirir, teknisyen bu yolu kullanamaz. Kapsam dışı olarak kabul edildi.
2. **S7-12 WM_CHAR:** TranslateMessage ile üretilen karakter mesajının kaynağı çoğunlukla `IMO_UNAVAILABLE`. Bu durumda onu üreten WM_SYSKEYDOWN'ın kararı kullanılıyor (o da fail-closed). Kaynak biliniyorsa yalnız `IMO_HARDWARE` kabul ediliyor.
3. **S7-13:** Basılı olmayan düğmeyi bırakma tamamen no-op (rapor "en fazla hareket" diyordu). Hareketin ayrı enjekte edilmesi gereksiz ve yine hareket mesajıyla yapılabiliyor.
4. **S7-16:** Rapordaki `!g.IsOpen()` denetimi yerine görevdeki nesil sayacı uygulandı. Açıklık ve nesil tek atomik değerde, bu yüzden Open/Shut arası yarış da kapsanıyor. `ReleaseAll` dinleyicisi nesilden bağımsız çalışmaya devam ediyor; eski açılıştan basılı kalan tuşlar yine bırakılıyor.
5. **K6:** WS kopmasında ve sunucunun bildiği kapanışlarda (revoke, release, cancel, caps.update, peer.left/joined{tech}, hello) diyalog için mesaj gitmiyor. Bunu testler doğruluyor.

### Testler ve son çıktı
Komut (docker `golang:1.26.11-bookworm`, repo kökü bağlı, `apps/agent-win`): `gofmt -l .` → `go vet ./...` → `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go vet ./...` → `go test -race -count=1 ./...` → `build/build.sh https://staging.example:4450 0.7.2` iki kez → govulncheck v1.1.4 (linux + `GOOS=windows`).
Son çıktı: gofmt temiz, iki vet temiz, **15/15 paket ok** (-race; güncel `fixtures/ws-messages.json` ile fixture testleri yeşil). İki build aynı SHA-256 `0f8b8433…7528357a` (12,09 MB). govulncheck iki hedefte "Your code is affected by 0 vulnerabilities"; çağrılmayan 3 modül kaydı önceki turdakiyle aynı (x/net, x/crypto; Dependabot).
Yeni testler:
- `control`: `TestS712OriginInjectedFailClosed` (her IMO sabiti, bilinmeyen 8, birleşik 1\|2, 0xFFFFFFFF, başarısız sorgu), `TestS712CharInjected`, `TestS716StaleHooksOffIgnoredAfterReopen` (Shut → dinleyici bekletilir → yeniden Open → bayat kaldırma yok sayılır, geçerli kapanış kaldırır), `TestS716GenerationRaceFree`.
- `input`: `TestS713ReleaseExemptionOnlyForHeld` (basılı olmayan bırakma seli 0 olay enjekte ediyor ve jeton harcıyor; basılı olanın bırakılması boş kovada da geçiyor).
- `flow`: `TestK8EnvStateAfterEveryHelloWithSelfElevated` (ilk ve yeniden bağlanma hello'su başına tek env.state, tekrar yok), `TestK8EnvStateWithoutProbe`, `TestK6PeerDropWithOpenPromptSendsViewSystemOnce` (disconnected/failed/closed), `TestK6PeerDropGrantedIdleAndMonitorPrompt`, `TestK6ServerKnownClosuresSendNothingForPrompt` (6 sunucu mesajı + hello + WS kopması).
- `signal`: selfElevated false da kodlanıyor, eksikse reddediliyor.
S7-14 Win32 mesaj döngüsünde olduğu için birim testi yok; değişiklik tek satır ve statik.

### Windows'ta elle doğrulanacaklar
Adım 38'e S7-12 ek kontrolü eklendi: müşterinin gerçek tıklaması izin verir, SendInput tıklaması vermez (üç diyalogda). Adım 37 (S7-16 sonrası: kısayol + hemen yeniden izin → AC-104 yerel önceliği çalışmalı) ve adım 42 (yönetici açılışında konsol rozeti, K8) tekrar koşulmalı.

### frontend-dev / backend için sözleşme notları
- İstemci her `hello`'dan hemen sonra `env.state{elevatedForeground, secureDesktop, selfElevated}` gönderiyor (selfElevated her zaman var). Sonra yalnız değişimde gönderiyor.
- PeerConnection koptuğunda (WS açık) bekleyen kontrol diyaloğu varsa `control.state{VIEW, SYSTEM}` gidiyor (K6). Kapı açıksa önceki davranış sürüyor (tek mesaj). Bekleyen monitör diyaloğu mesajsız kapanıyor.

## Frontend P7 — düzeltme turu 2 (frontend-dev, 2026-11-11)
Kaynak: `docs/mimari-protokol.md` §3.3 K6–K8 + "P7 Tur 2 kararları", ADR-0013 "Ek — P7 Tur 2", koordinatör notu (sunucu S7-15: zaten paylaşılan monitör → `error{VALIDATION}`; misafir kopmasında yalnız `peer.left{guest}`). Kapsam yalnız `apps/web`; contracts'a dokunulmadı — `env.state.selfElevated` (zorunlu) iş sırasında sunucu ajanınca eklendi, doğrudan contracts tipine geçildi (geçici yerel tip kaldırıldı).

### Rotalar
| Yol | Auth | Ne yapar |
|---|---|---|
| `/sessions/[id]/console` (değişti) | Evet (oturumun teknisyeni) | K6 istek kapanma metni, monitör seçiminde bekleme/geri sayım, "yönetici olarak çalışıyor" rozeti |
Yeni rota yok.

### Davranış
- **K6:** `requested` fazında `control.state{VIEW, SYSTEM}` → istek kapanır (`ended{agent}`), not "Müşteri tarafında bağlantı kesildi; istek kapandı"; ret sayılmaz, 30 sn bekleme yok, düğme hemen kullanılabilir (sayaç düşmez — sunucuyla aynı). Açık kontrolde `{VIEW, SYSTEM}` eskisi gibi sistem kapanışı.
- **K7 (monitör):** `monitor.denied` veya yerel 30 sn yanıtsızlıkta `monitorBlockedUntil = now + CONTROL_DENY_COOLDOWN_MS + 1 sn` (`MONITOR_BLOCK_MS` = 31 sn). Bu süre ve `monitorPending` varken `canRequestMonitor(s, now)` = false → `Segmented` grubu `disabled`, notta "… · yeni istek 0:2x sonra" geri sayımı. Monitör isteğine `error{CONFLICT|RATE_LIMITED}` (FORBIDDEN da) → bekleme kapanır, `monitorRequests` geri alınır, bekleme `now + 31 sn`'ye uzar, metin "Önceki istek henüz kapanmadı / müşteri onaylamadı; biraz sonra tekrar deneyin".
- **K7 (kontrol):** kontrol isteğine `error{CONFLICT}` → faz değişmez (`requested` kalır), not satırında yalnız sunucunun metni (`notice`, uyarı rengi); sonraki GRANTED/kapanışta temizlenir. Eşleme mevcut 5 sn `lastSent` penceresiyle.
- **S7-15:** monitör isteğine `error{VALIDATION}` ("Bu monitör zaten paylaşılıyor.") → bekleme kapanır, sayaç geri alınır, ek bekleme yok, not "Bu monitör zaten paylaşılıyor". Kontrol isteğine gelen VALIDATION yok sayılır.
- **Misafir kopması:** `peer.left{guest}` bekleyen monitör (`monitorPending`) ve kontrol göstergesini zaten kapatıyordu (`idle`, "Müşteri bağlantısı koptu; kontrol kapandı"); birim testle güvenceye alındı.
- **K8 / S7-9:** `env` → `{ elevated, secure, self }`; `selfElevated=true` iken şerit altında kalıcı `warning-surface` rozeti (`ShieldUser`, `role=status`, `stage-self-elevated`): "Müşteri istemcisi yönetici olarak çalışıyor — yükseltilmiş pencereler ve UAC ekranı denetlenebilir". Görüntü olmasa da gösterilir; kontrol engellenmez. Yeni PeerConnection / `hello` / kopma `env`'i sıfırlar.

### Değişen dosyalar
- `apps/web/lib/control/machine.ts` (`ControlEndCause` + `agent`, `notice`, `monitorBlockedUntil`, `MONITOR_BLOCK_MS`, `monitorBlockLeft`, `canRequestMonitor(s, now)`, `monitorOutcome` + `already`, hata eşlemesine CONFLICT/VALIDATION, `env.self`), `lib/control/machine.test.ts` (+7 test: K6, K7 ×3, S7-15, peer.left, K8).
- `apps/web/lib/webrtc/use-tech-session.ts` (`canRequestMonitor(c, now)`).
- `apps/web/components/console/control-button.tsx` (`MonitorPicker` `now` + pasif grup + geri sayım; `notice`), `components/console/stage.tsx` (`StageControl.selfElevated`, rozet), `app/(panel)/sessions/[id]/console/console-view.tsx`.
- `apps/web/components/ui/segmented.tsx`: opsiyonel `disabled` prop (mevcut primitife küçük ek; yeni primitif yok — DESIGN §6 güncellendi).
- `apps/web/messages/tr.json` (`p7.end.agent`, `p7.monitorAlready`, `p7.monitorRetryIn`, `p7.selfElevated`; `p7.monitorRate` metni K7'ye göre).
- e2e: `e2e/mock-ws.mjs` (K6 iletimi; monitör kuralları: bekleyen varken CONFLICT, ret sonrası 30 sn RATE_LIMITED, aktif monitör → VALIDATION; `selfElevated` aktarımı), `e2e/p7-control.spec.ts`.
- `DESIGN.md` §6 (`segmented`, kontrol modu sahnesi, `MonitorPicker`).

### Testler
- `lint` / `typecheck` temiz; `test` 15 dosya / 124 test yeşil.
- `pnpm --filter @remote/web e2e` tam paket **149 geçti / 41 atlandı**. P7 7/7: yeni **"K6"** testi (istek → `{VIEW, SYSTEM}` → metin, "Kontrol iste" etkin, "Kontrol reddedildi" yok, 2. istek gider); AC-43/105'e K7 (ret sonrası "yeni istek 0:3x sonra", Ekran 1 pasif, geri sayım ilerler) ve K8 (`stage-self-elevated` metni; güvenli masaüstü adımında `selfElevated=false` ile kalkar) + axe 0 ihlal.
- Monitör CONFLICT/RATE_LIMITED/VALIDATION ve `peer.left` yolları birim testte (konsol arayüzü aktif monitörü ve bekleyen istekte ikinci isteği zaten engellediği için e2e'de tetiklenemez).

### Sapmalar
- Yok.

## Frontend P7 — sayfa testi düzeltmeleri (frontend-dev, 2026-11-11)
Kaynak: `docs/test-raporu.md` (P7) TEST-P7-1, TEST-P7-2, TEST-P7-3 ve "kontrol açıkken müşteri kopar" gözlemi. Kapsam yalnız `apps/web`; contracts'a dokunulmadı.

### Rotalar
| Yol | Auth | Ne yapar |
|---|---|---|
| `/sessions/[id]/console` (değişti) | Evet (oturumun teknisyeni) | "%100" müşteri monitörüyle 1:1; dar sahnede monitör/görünüm/tam ekran "Görünüm" menüsünde; kopma notu sahnede; yenilemede hak sayacı korunur |
Yeni rota yok.

### TEST-P7-1 — kök neden ve düzeltme
- Ölçüm: normalizasyon (`pointFromClient`, `getBoundingClientRect` → kaydırmayı zaten içerir) doğru. Raporun (50,50) tıklaması gösterilen 320×180 karede `50/320 = 0.15625`, `50/180 = 0.27778` verdi — yani **alınan akış 320×180'di** (WebRTC ilk saniyelerde/bant darlığında çözünürlüğü düşürür) ve "%100" kipi videoyu doğal (küçültülmüş) boyutunda çiziyordu. Tıklanan ekran pikseli uzak ekranda 4× uzaktaki piksele düşüyordu; AC-49 "görüntüye göre normalize" sağlanıyor ama "%100" 1:1 değildi.
- Düzeltme: "%100" artık görüntülenen monitörün piksel boyutunda çizilir (`share.state.monitors[].w×h`; akış oranı ±%2 tutmazsa veya monitör bilinmiyorsa doğal video boyutu) — `lib/control/input.ts` `actualViewSize`. Boyut `element.style` (CSSOM) ile verilir; CSP `style-src` nonce'u `style` özniteliğine izin vermez. Video `resize` olayında yeniden hesaplanır.
- Testler: birim `input.test.ts` (kaydırılmış/kaydırılmamış %100 ve Sığdır letterbox ±1 px, `actualViewSize`); e2e "TEST-P7-1 / AC-49": Sığdır (123,456), %100 (50,50) ve 300/200 kaydırılmış (350,250) — hepsi ±1 px; video CSS 1280×720.

### TEST-P7-2 — şerit
- Sahne 960 px'ten darsa monitör seçimi + Sığdır/%100 + Tam ekran sağda tek **Görünüm** menüsüne toplanır (yeni primitif `components/ui/menu.tsx`; Özel tuşlar da buna taşındı — ikisi aynı `<details>` deseni). Genişte satır içi kalır.
- Kontrol sırasında pasif işaretleme grubu şeritte gösterilmez; Ctrl+Alt+Shift ipucu not satırında yalnız ekran okuyucuya, görünür olarak Özel tuşlar menüsünün altında; "Kontrol sizde" hapı ikonsuz (durum metin + kırmızı çerçeve). Sonuç: 1280 px'te kontrol şeridi **tek satır** (e2e: ≤ 64 px); kontrol yokken işaretleme + kontrol düğmesi iki satır (tasarım gereği — işaretleme grubu tek başına 512 px).
- Kontrol çubuğu `display: contents`: dar ekranda (390 px) öğeler şeritte birlikte sarar. Tam ekranda menü/şerit düzeni donar (genişleyen sahne odaktaki düğmeyi yeniden oluşturmasın).
- Menüdeki monitör sonuçları (reddetti/onaylamadı/iletilmedi/zaten paylaşılıyor) toast'la da duyurulur; bekleyen istekte menü tetikleyicisinde dönen gösterge + ekran okuyucu metni.

### TEST-P7-3 — sahte sunucu ve iki akış
- `e2e/mock-ws.mjs`: teknisyen `hello`'su misafir varken `guestKind`/`guestName` taşır (`active.ts sendHelloTech` gibi); yanıtsız monitör isteği 30 sn sonra düşer ve bekleme `at + 30 sn`'den başlar (`control.ts` gibi); `ageRoom` + `GET /__e2e/age/:id?ms=` zaman damgalarını geçmişe çeker.
- Konsol: kontrol/monitör sayaçları (`requests`, `deniedAt`, `monitorRequests`, `monitorBlockedUntil`) sekmede `sessionStorage` `rs.ctl.<id>`'de tutulur, yenilemede `restore` olayıyla birleştirilir (büyük olan kazanır; bozuk değer 0/null; izin durumu asla geri yüklenmez; oturum bitince silinir). Önceden yenileme yerel sayacı sıfırlıyordu ("5 hak" gösterip sunucudan RATE_LIMITED alırdı).
- e2e "TEST-P7-3: yenileme sonrası hak sayacı" (2 istek → yenile → "3 istek hakkı kaldı" → 3 istek daha → "hakkı doldu (5/5)", düğme pasif) ve "TEST-P7-3: yanıtsız monitör" (`page.clock` ile 30 sn → "onaylamadı · yeni istek 0:3x sonra", seçim pasif → 31 sn → etkin → ikinci istek iletilir, CONFLICT yok).

### Gözlem — kopma notu
- Kontrol açıkken müşteri koparsa "Bağlantı koptu" katmanında "Müşteri bağlantısı koptu; kontrol kapandı" yazılır (`stage-control-ended`); toast zaten vardı. Not satırı da `idle`'a dönen `peer` nedenini artık gösterir (şerit geri gelince). e2e "gözlem: …" + axe 0.

### Değişen dosyalar
- Yeni: `apps/web/components/ui/menu.tsx`.
- `apps/web/lib/control/input.ts` (+`actualViewSize`), `input.test.ts` (+3), `lib/control/machine.ts` (`restore` olayı, `ControlCounters`), `machine.test.ts` (+1), `lib/webrtc/use-tech-session.ts` (sayaç depolama), `components/console/stage.tsx` (%100 boyutu, uyarlanır şerit + Görünüm menüsü, `monitors`/`monitorBusy`/`nativeSize`/`endedNote`), `components/console/control-button.tsx` (Özel tuşlar → `Menu`, `contents`, ikonsuz hap, `peer` notu), `app/(panel)/sessions/[id]/console/console-view.tsx`, `messages/tr.json` (`cs.viewMenu`, `cs.viewMenuBusy`).
- e2e: `mock-ws.mjs`, `mock-api.mjs`, `p7-control.spec.ts` (+4 test, menü açma), `p4-media.spec.ts` (AC-43 görünüm araçları menüden, klavyeyle).
- `DESIGN.md` §4 ikonlar, §6 `ui/menu.tsx`, kontrol modu sahnesi, ControlButton satırı.

### Testler
- `lint` / `typecheck` temiz; `test` 15 dosya / 128 test yeşil.
- `pnpm --filter @remote/web e2e` tam paket **153 geçti / 45 atlandı** (mobil projede konsol testleri atlanır). P7 11 test + P4 AC-43 dahil. Görsel kontrol: 1280 (boş, kontrol + menü açık) ve 390 px ekran görüntüleri.

### Sapmalar
1. Menü adı "Daha fazla" değil **"Görünüm"** (`MonitorCog`): içerik yalnız görünümle ilgili (monitör, ölçek, tam ekran) ve ikon kuralı anlamlı başlık istiyor.
2. Kontrol yokken (işaretleme açıkken) şerit 1280 px'te iki satır kalır: işaretleme grubu tek başına 512 px; bulgu kontrol modundaki üç satırdı, o artık tek satır.


## Agent — fare imleci (P8 öncesi) (backend-dev/Go, 2026-11-11)
Kaynak: `docs/gereksinimler.md` "Sonra / açık — P6'dan" tablosundaki "Fare imleci" satırı. DXGI Desktop Duplication karesinde imleç yok. Şimdi konum (`DXGI_OUTDUPL_FRAME_INFO.PointerPosition`) ve şekil (`GetFramePointerShape`) okunuyor ve imleç NV12 karesine bindiriliyor. Yalnız `apps/agent-win/internal/capture` değişti. Sunucu, konsol, contracts ve protokol aynı kaldı. Yeni bağımlılık yok, CGO yok.

### Değişen dosyalar
| Dosya | Değişiklik |
|---|---|
| `internal/capture/cursor.go` (yeni, platformdan bağımsız) | `PointerShape` (Type/W/H/Pitch/Data) ve `Cursor` (Visible, X/Y = şeklin sol üst köşesi, masaüstü yönünde fiziksel piksel). `Size()` şekli doğrular: bilinmeyen tür, kısa tampon, yetersiz satır adımı, tek satır sayılı mono → geçersiz, çizilmez. `BlendPointer` BGRA yamasına çizer: **mono** AND/XOR (1 bpp, MSB önce; AND=1,XOR=0 saydam, 0/0 siyah, 0/1 beyaz, 1/1 ters), **renkli** düz alfa `(c·a + d·(255−a))/255`, **maskeli renkli** alfa 0 → kopya, ≠0 → XOR. `OverlayCursor` imleci masaüstü kenarında kırpar, altındaki pikselleri salt okunur yüzeyden yamaya alıp karıştırır. Yalnız imlecin örneklendiği çıkış 2×2 bloklarının Y/UV değerlerini, `ConvertBGRA` ile aynı formül ve aynı en yakın komşu eşlemesiyle yeniden hesaplar (döndürme ve kodlayıcı küçültmesi dahil) |
| `internal/capture/dxgi_windows.go` | `vtDuplGetPointerShape = 11` (IDXGIOutputDuplication vtable: GetDesc 7, AcquireNextFrame 8, …, GetFramePointerShape 11, ReleaseFrame 14) ve `dxgiOutduplPointerShapeInfo`. `acquire` bölündü: `updatePointer` konum ve görünürlüğü yalnız `LastMouseUpdateTime ≠ 0` iken alır. `PointerShapeBufferSize > 0` ise şekli yeniden kullanılan tampona okur. `copyFrame` önceki kopyalama koduyla aynı. **Davranış değişikliği:** yalnız imleç değiştiyse (`LastPresentTime == 0`) yeni yüzey kopyalanmıyor. Staging dokusu son masaüstü görüntüsünü tuttuğu için o yeniden eşleniyor ve `changed=true` dönüyor. Önceden fare hareketi kare üretmiyordu |
| `internal/capture/source_windows.go` | `grab` içinde `ConvertBGRA`'dan sonra `OverlayCursor(p.frame, px, …, &p.dup.cur)` çağrılıyor. Süre `convCost`'a dahil (AC-41 hız denetimi bunu görüyor) |
| `internal/capture/cursor_test.go` (yeni) | Aşağıda |

### Kararlar / sapmalar (gerekçeli)
1. **Bindirme BGRA'da değil, NV12'de bölgesel yeniden dönüştürmeyle yapılıyor.** Eşlenmiş staging yüzeyi `D3D11_MAP_READ` ile açılıyor, yazılamaz. Tam karenin yazılabilir kopyası 4K'da kare başına yaklaşık 33 MB demek. Bunun yerine imleç alanı küçük bir BGRA yamasında karıştırılıyor ve yalnız etkilenen bloklar yeniden hesaplanıyor. Sonuç, "imleci BGRA'ya çiz, sonra tüm kareyi `ConvertBGRA`'dan geçir" yolunun çıktısıyla **bayt bayt aynı**. Test bunu 3 şekil × 3 boyut (küçültmeli/küçültmesiz) × 4 döndürme × 6 konum (kenar kırpma dahil) üzerinde doğruluyor. Testin hatayı yakaladığı mutasyonla gösterildi: blok aralığı yuvarlaması bozulunca test kırılıyor.
2. **Yalnız imleç hareketinde kare yeniden üretiliyor.** Tam kare yeniden dönüştürülüyor. Kare hızı bütçesi (`rateCtl`) bunu zaten sınırlıyor, ek darboğaz yok. Ekran durgunken bile imleç akıcı hareket etsin diye gerekli.
3. **Çoklu monitör:** her monitörün kendi çoğaltma oturumu var. İmleç başka monitördeyse DXGI o çıktı için `Visible=false` bildiriyor ve imleç çizilmiyor. Ek kod gerekmedi.
4. **DPI:** süreç Per-Monitor V2. Konum da şekil de fiziksel pikselde geliyor, Windows imleci DPI'ya göre büyütülmüş veriyor. Ek ölçek yok. 1080p üstü masaüstlerinde imleç karenin geri kalanıyla aynı oranda küçülüyor. Çok küçük ölçekte 1 px'lik kenar çizgisi örnekler arasına düşüp kaybolabilir (en yakın komşu, karenin geri kalanıyla tutarlı).
5. **Döndürülmüş monitör:** konum ve şekil masaüstü yönünde yorumlanıyor (Microsoft DesktopDuplication örneğiyle aynı). Bu varsayım Windows'ta elle doğrulanmalı (adım 46).
6. **Sıcak nokta tutulmuyor:** DXGI `PointerPosition` zaten şeklin sol üst köşesi. Sıcak nokta yalnız bilgi amaçlı geliyor, kullanılmadığı için saklanmıyor.
7. **Oturum yeniden kurulunca** (UAC, kilit, mod değişimi) imleç durumu sıfırlanıyor. DXGI imleç bilgisini bir sonraki imleç güncellemesinde (hareket ya da şekil) verirse imleç o ana kadar görünmeyebilir. Adım 47'de kontrol edilecek.

### Testler ve son çıktı
Komut (docker `golang:1.26.11-bookworm`, repo kökü bağlı, `apps/agent-win`): `gofmt -l .` → `go vet ./...` → `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go vet ./...` → `go test -race -count=1 ./...` → `build/build.sh https://staging.example:4450 0.7.3` iki kez.
Son çıktı: gofmt temiz, iki vet temiz, **15/15 paket ok** (-race). İki derleme aynı SHA-256 `70f17aad…ced73055` (12,10 MB).
Yeni testler (`internal/capture/cursor_test.go`):
- `TestPointerMonoAndXor`: dört AND/XOR birleşimi, alfa baytı korunuyor.
- `TestPointerMonoWideRowsUseByteBoundaries`: 10 px genişlik, bayt sınırı ve satır adımı.
- `TestPointerColorAlpha`: alfa 0 / 255 / 128.
- `TestPointerMaskedColor`: kopya, XOR 0 (saydam), XOR FFFFFF (ters).
- `TestPointerShapeValidation`: 7 geçersiz şekil reddediliyor ve çizilmiyor.
- `TestOverlayMatchesComposedConversion`: denklik testi (karar 1).
- `TestOverlayLeavesFrameUnchanged`: görünmez, nil, geçersiz şekil, tamamen dışarıda (sol / sağ alt), saydam maske.
- `TestOverlayChangesOnlyCursorBlocks`: tek piksellik imleç yalnız kendi Y örneğini değiştiriyor.
- `TestOverlayRejectsBadFrame`.

COM tarafı (`updatePointer`, yalnız imleç değişiminde yeniden eşleme) Win32 gerektirdiği için birim testi yok. Aşağıdaki elle doğrulama adımlarıyla kapsanıyor.

### Windows'ta elle doğrulanacaklar (adım 42'ye ek)
43. **İmleç görünüyor:** paylaşım açıkken konsolda müşterinin imleci görünmeli ve ekran durgunken de fareyle gecikmesiz hareket etmeli. Görev çubuğu köşesine götürünce yarısı kırpılarak çizilmeli, kenarda bozulma olmamalı.
44. **Şekil değişiyor:** Not Defteri metin alanında metin imleci (I, mono XOR: koyu ve açık zeminde ters renk görünmeli), bağlantı üstünde el, pencere kenarında yeniden boyutlandırma okları, "meşgul" (dönen halka, renkli alfa) görünmeli. Ayarlar > Erişilebilirlik > Fare işaretçisi'nde "Ters" şema (maskeli renkli/XOR) ve büyük/renkli işaretçi denenmeli.
45. **İkinci monitör:** imleç paylaşılan monitördeyken çizilmeli. Diğer monitöre geçince konsoldaki görüntüden kaybolmalı, geri gelince yine görünmeli. Konsoldan monitör değiştirince (adım 34) imleç yeni ekranda çizilmeli.
46. **DPI ve döndürme:** monitör ölçeği %150 iken imleç doğru boyutta (yerel ekranla orantılı) ve tıklanan noktayla hizalı olmalı. Uzaktan kontrolde konsolda tıklanan nokta imlecin sıcak noktasına düşmeli. 4K (küçültülen) monitörde de denenmeli. Mümkünse dikey (90°) döndürülmüş monitörde imleç konumu ve yönü doğru olmalı.
47. **Oturum yeniden kurulumu:** Win+L ile kilitleyip açınca veya bir UAC isteminden sonra imleç yeniden görünmeli. En geç ilk fare hareketinde görünmesi kabul edilir.

### frontend-dev / backend için sözleşme notları
Sözleşme değişmedi. İmleç video karesinin içinde geliyor. Konsolun ayrıca imleç çizmesine gerek yok, çizerse çift imleç olur. Fare hareketi artık durgun ekranda da kare üretiyor, yani video bant genişliği hareket sırasında biraz artabilir.

## Backend P8 — oturum geçmişi (backend-dev, 2026-11-11)
Sözleşme: `docs/mimari-api.md` "Oturum geçmişi (P8)" §1–6; AC-60..63, 124. Veri katmanı: dba migration'ları `20261111060000_p8_session_history` ve `20261111070000_enum_check_binary` (bu iş onlara dokunmadı).

### Değişen / eklenen dosyalar
- `packages/contracts/src/api/sessions.ts`: `listSessionsQuerySchema` (strict; status, mode, from/to, technicianId, tenantId, customer, page, pageSize, sort; from > to → `fields.to`), `exportSessionsQuerySchema` (aynı şema), `SessionListItem`, `SessionHistoryDetail`, `SessionConsentRecord`, `ControlPeriod`, `SessionFileRecord`, `TimelineEvent`, `TIMELINE_DETAIL_KEYS`/`TIMELINE_ACTIONS` (izin listesi + izinli alanlar), `storedQualitySummarySchema`, `updateSessionInputSchema` (PATCH), `SESSION_CSV_COLUMNS`, `SESSION_EXPORT_MAX_ROWS`. `SessionListResponse.items` artık `SessionListItem[]` (`SessionView`'ı genişletir, kırılma yok).
- `packages/contracts/src/labels.ts` (yeni, `@remote/contracts/labels`): durum, mod, sonlandıran, `end_reason`, onay seviye/karar/kaynak, kontrol kapanış nedeni, dosya yön/sonuç ve zaman çizelgesi etiketleri; `labelOf` (bilinmeyen değer ham döner) ve `describeTimelineEvent` (§3 "UI gösterimi").
- `apps/server/src/lib/csv.ts` (yeni): `csvCell` önce formül kaçışını, sonra RFC 4180 tırnaklamayı uygular. Ayrıca `csvRow`, BOM, `istanbulDateTime` ve `hms`.
- `apps/server/src/sessions/history-repo.ts` (yeni): markalı `HistoryScope` (`{kind:"all"}` elle kurulamaz), `historyWhere` (kapsam filtreden sonra yazıldığı için filtreyi ezer), LIKE kaçışı, liste/count, keyset CSV partisi, detay alt sorguları (zaman çizelgesi `tenant_id` + entity + entity_id ile), `updateNotes` (kapsam UPDATE'in where koşulunda).
- `apps/server/src/sessions/history.ts` (yeni): liste, detay (izdüşüm, actor/actorName, `deriveControlPeriods`, kalite ayrıştırma; ayrıştırılamazsa uyarı logu ve null), PATCH (UPDATE ve audit tek TX'te), CSV.
- `apps/server/src/sessions/service.ts`: `historyScope(auth)` tek kaynak. `GET /:id` bu kapsamı kullanır. Eski `listSessions` ve `repo.listInScope` kaldırıldı (artık ölü koddu).
- `apps/server/src/sessions/routes.ts`: `GET /sessions` (any-of yetki, `no-store`), `GET /sessions/export.csv`, `GET /sessions/:id/history`, `PATCH /sessions/:id`.
- `apps/server/src/auth/guards.ts`: `requireAnyPerm(...keys)`.
- `apps/server/src/audit/mask.ts`: `ticketNo` izinli anahtarlara eklendi. Nedeni: `ticket` kara liste kalıbı `session.updated` içindeki ticket numarasını `***` yapıyordu; ticket numarası gizli bir değer değil.
- Admit (dba "Backend-dev için" A1): `repo.consumeForAdmit(…, customer)` tek atomik UPDATE'te `customer_name` ve `customer_email` yazar. `Guest.email` join'den gelir (`public/service.ts`, `signaling/{types,rooms,admit}.ts`).
- Testler: `packages/contracts/test/history-p8.test.ts`, `apps/server/test/unit/history-p8.test.ts`, `apps/server/test/integration/sessions-history-api-p8.test.ts`. `test/helpers/tenant-matrix.ts` güncellendi: 3 yeni uç sınıflandırıldı, CROSS_TENANT_CASES'e `:id/history` ve PATCH eklendi, fixture USER'a `session_history.view/export` verildi; böylece export "list" sınıfında da sınanıyor. `signaling-rooms.test.ts` yeni imzaya uyarlandı.

### Tasarımdan sapmalar (gerekçeli)
1. **CSV akışı:** `reply.raw`'a yazmak yerine `reply.send(Readable.from(generator))` kullanıldı. Böylece Fastify kancaları (helmet/CSP başlıkları, istek logu) devrede kalıyor. Davranış aynı: önce count, sonra 1000'lik keyset partileri. Akış sırasındaki hata log'a ref ile yazılır ve bağlantı kesilir. Akış sırasında yeni kayıt eklenirse çıktı yine en çok 50.000 satırla sınırlanır.
2. **PATCH notunda CRLF → LF normalize ediliyor** (zod `overwrite`; dba/koordinatör isteği). Tek başına `\r` gelirse yine 400 döner.
3. **Admit, kısa ad:** zod `customerName` uzunluğunu UTF-16 birimiyle sayıyor, DB CHECK ise kod noktasıyla. 2 kod noktasından kısa bir ad (ör. tek emoji) CHECK'i bozup admit'i düşürmesin diye o durumda `customer_name`/`customer_email` NULL yazılır (`admit.ts customerOf`).
4. Rate limit 5/dk: `FixedWindowCounter(6, 60 sn, 60 sn)`, yani 6. istek 429 + `Retry-After` alır (auth IP limitiyle aynı kalıp).
5. `control.revoked` kapanış nedeni etiketlerine §3'te olmayan `reconnect`, `stale` ve `tech` de eklendi. `revokeControl` bu değerleri yazabiliyor; etiket bulunmazsa değer zaten ham gösterilirdi.

Yeni bağımlılık yok. Yeni env değişkeni yok.

### frontend-dev için sözleşme
- İçe aktarma: `@remote/contracts/api/sessions` (`SessionListItem`, `SessionHistoryDetail`, `listSessionsQuerySchema`, `updateSessionInputSchema`, `TimelineEvent`, `ControlPeriod`, …) ve **`@remote/contracts/labels`** (`labelOf`, `*_LABELS`, `describeTimelineEvent` → `{label, note, warn}`; `warn=true` ise "Müşteri istemcisi yönetici olarak çalışıyordu" rozeti gösterilir).
- `GET /sessions` bilinmeyen sorgu parametresinde 400 döner. Varsayılan sıra `createdAt:desc`. `tenant` alanı yalnız firma seçmemiş SUPER_ADMIN için dolu gelir.
- PATCH yanıtı tam `SessionHistoryDetail`. `ticketNo` trim edilir; `""` ve `null` NULL olarak kaydedilir; notta CRLF LF'e çevrilir.
- `GET /sessions/export.csv?<liste filtreleri>`: 400 `fields.to` (> 50.000 satır), 429 + `Retry-After`. Dosya adı `Content-Disposition`'dan alınır.

### Test komutları ve son çıktı (geçici `mysql:8.4`, `rs-mysql-be-p8:33328`, 8 migration uygulandı, iş bitince silindi)
- `pnpm -r run lint` temiz · `pnpm -r run typecheck` temiz · `pnpm -r run test`: contracts **49/49**, server **255/255**, web **128/128**.
- `pnpm --filter @remote/server test:int`: **214/214** (25 dosya; P8 dosyası 22 test: AC-60 filtreleri ve İstanbul gün sınırı, LIKE kaçışı, sayfalama; AC-61 IDOR — USER başka teknisyen/başka tenant/var olmayan id için `:id`, `:id/history`, PATCH'te 404, ADMIN için 404/200, SUPER_ADMIN tüm tenant ve firma seçili, any-of yetki; AC-62 detay — ip/UA yok, kontrol dönemleri, izdüşüm, kırpma, bozuk kalite; AC-63 PATCH (audit'te not metni yok, çift gönderim, 400/403) ve CSV (BOM, `;`, CRLF, İstanbul saati, formül kaçışı, audit, USER kapsamı, Firma sütunu, 5/dk, 1205 satırda keyset)).
- **AC-60 ölçümü** (10.000 oturum, `seedPerfSessions` + `ANALYZE TABLE`, ilk sayfa findMany+count, 5 tekrarın medyanı): ADMIN 2,4 ms · USER 2,5 ms · SUPER_ADMIN tüm tenant'lar (DB'de ~30 bin satır) 2,5 ms · API uçtan uca ADMIN 4,8 ms. Hepsi 500 ms sınırının çok altında.

## Frontend P8 — oturum geçmişi (frontend-dev, 2026-11-11)

Kapsam: AC-60, 61 (arayüz tarafı), 62, 63, 124 (indirme) + ertelenen iş "AC-39 axe kararsızlığı". Tipler ve etiketler
`@remote/contracts/api/sessions` ve `@remote/contracts/labels`'tan gelir (geçici yerel tipler silindi; etiket tablosu çoğaltılmadı —
`labelOf`, `*_LABELS`, `describeTimelineEvent`). Tasarım skill dosyaları okunmadı (görünüm DESIGN.md primitifleriyle; yeni hareket yok).

### Rotalar
| Yol | Auth | Ne yapar |
|---|---|---|
| `/history` | Oturum + `session_history.view` (yoksa uyarı, menüde öğe yok) | Filtreli, sayfalı oturum geçmişi. Sorgu: `from`, `to` (YYYY-AA-GG, İstanbul günü), `status`, `mode` (AGENT/BROWSER), `technicianId` (ADMIN/SA), `tenantId` (yalnız firma seçmemiş SA), `customer`, `page`, `pageSize` (10/25/50/100; 1..100). Geçersiz değer API'ye gönderilmez, "yok sayıldı" uyarısı çıkar. "Dışa aktar (CSV)" yalnız `session_history.export` ile ve kayıt varken |
| `/history/[id]` | Oturum + `session_history.view` | Özet (oluşturma/başlangıç/bitiş/süre, mod, teknisyen, [firma], müşteri adı/e-posta, sonlandıran + yönetici adı, bitiş nedeni), ticket + not formu (`session_history.edit`; yoksa salt okunur), onay kayıtları, kontrol dönemleri, zaman çizelgesi, kalite özeti, dosya meta verisi. Kapsam dışı/yok → "Oturum bulunamadı" (not-found; Next akışlı yanıtta HTTP 200 kalır, içerik 404 sayfası) |

Kenar menüsü: "Oturum geçmişi" (`History`), `session_history.view` yoksa gizli. Dar ekranda yatay menü artık kaydırılabilir (`overflow-x-auto`, 3 öğe 390 px'e sığmıyordu).

### Durumlar
- Yükleniyor: `history/loading.tsx`, `history/[id]/loading.tsx` iskeletleri; filtre/sayfa boyutu geçişinde düğme `loading` (useTransition).
- Boş: hiç kayıt → `History` + "Oturumlara git" (sessions.view varsa); filtrede boş → "Filtreleri temizle"; toplamı aşan sayfa → "İlk sayfaya dön".
- Hata: liste/detay 5xx → `LoadError` + Tekrar dene; 403 → uyarı; 401 → giriş. CSV 400 (`fields.to`) / 429 (`Retry-After` dk) / ağ → düğme altında `Alert danger`.
- Kısmi: yok sayılan URL filtreleri; adı olmayan müşteri ("Ad kaydı yok"); bağlanılmamış oturum ("Bağlanılmadı", "Müşteri bağlanmadı"); kapanışsız kontrol dönemi ("Kapanış kaydı yok", bitiş tahmin edilmez); `timelineTruncated` ("Yalnız ilk 500 olay"); `quality: null`; BROWSER modda "Tarayıcı modunda uzaktan kontrol yoktur".
- Not formu: alan bazlı hata (contracts `updateSessionInputSchema`), sayaçlar (ticket x/50, not x/4.000; aşımda kırmızı), gönderimde alanlar + düğme pasif, sunucu `fields` → alana, diğer hata → `FormError`; başarı → toast "Ticket ve not kaydedildi" + `router.refresh()` (aynı sayfada kalınır — yönlendirme yok, düzenleme ayrıntı ekranının parçası); kaydedilmemiş değişiklikte `beforeunload` + uygulama içi bağlantıda onay diyaloğu (odak "Sayfada kal").

### Değişen / eklenen dosyalar
- `apps/web/app/(panel)/history/{page,loading,history-filters,history-list,pagination,export-button,live-duration}.tsx` (yeni)
- `apps/web/app/(panel)/history/[id]/{page,loading,not-found,sections,note-form}.tsx` (yeni)
- `apps/web/lib/history/query.ts` (URL ↔ filtre, API yolları), `lib/history/note.ts` (patch + doğrulama), `lib/history/history.test.ts` (yeni)
- `apps/web/lib/format.ts`: `formatDuration`, `istanbulDay`
- `apps/web/components/ui/select-field.tsx` (yeni primitif, DESIGN.md §6'da)
- `apps/web/app/(panel)/side-nav.tsx`, `apps/web/messages/tr.json` (`nav.history`, `h.*`)
- `apps/web/e2e/mock-history.mjs` (yeni), `e2e/mock-api.mjs` (bağlama), `e2e/p8-history.spec.ts` (yeni)
- AC-39: `apps/web/e2e/helpers.ts` (`axeScan` legacy mod + `include`), `apps/web/e2e/p5-collab.spec.ts`
- `DESIGN.md` (SelectField, oturum geçmişi ekranları, P8 ikonları)

### AC-39 axe kararsızlığı — kök neden ve düzeltme
Yeniden üretim: eski test `--repeat-each=14`, 7 işçi → **28/28 zaman aşımı** (tek tek ~40–48 sn). İz (trace) adım süreleri:
1. **Tarama başına yeni sekme:** `@axe-core/playwright` varsayılan modu her `analyze()`'da axe'ı sayfaya enjekte edip `runPartial` çalıştırıyor,
   sonra aynı context'te **boş bir sekme açıp** axe'ı oraya ikinci kez enjekte ederek `finishRun` yapıyor. Yük altında bu tarama başına 4–9 sn;
   test 8 tam tarama yapıyordu (≈ 40 sn). Yeni sekme ayrıca taranan (WebRTC'li) sayfayı arka plana atıyor.
2. **Misafir context kapanışı:** ekran yakalama açıkken `g.context().close()` yük altında 3–10 sn sürüyor (ölçüldü).
Düzeltme: (a) `axeScan` legacy modda (tek enjeksiyon, aynı sayfada `axe.run`; uygulamada iframe yok, kurallar ve DOM aynı) + isteğe bağlı
`include` — sekme değiştiğinde yalnız değişen bölge taranır; (b) test ikiye bölündü ("konsol panelleri" / "müşteri 375 px + kabul diyaloğu",
her biri açık/koyu); (c) `closeGuest`: önce paylaşım durdurulur, sonra context kapanır (kapanış 4–8 sn → 1,5–3 sn). Zaman aşımı değiştirilmedi.
Sonuç (7 işçi, tam paralel yük): 40/40 ve 20/20 geçti, test süresi 6–25 sn. Bir ara koşuda (makinede eşzamanlı başka ajan testleri varken,
paylaşım durdurma eklenmeden önce) 40'ın 6'sı ~31 sn ile düştü; (c) bu koşudan sonra eklendi. Son doğrulama aşağıda.

### Sapmalar
1. **Teknisyen/firma filtre seçenekleri** o sayfadaki kayıtlardan + URL'deki seçili değerden üretilir (ipucu metni ekranda). Kullanıcı ve firma
   listesi uçları P9'da (`GET /users`, `/admin/tenants`). **backend-dev / P9 notu:** filtre için hafif bir `GET /users?fields=id,fullName` (ADMIN/SA)
   ve tenant listesi gelince seçenekler oradan alınacak.
2. Liste/detay durum rozeti mevcut `StatusBadge`'i kullanır ("Aktif", "İptal"); contracts `SESSION_STATUS_LABELS` ("Etkin", "İptal edildi") CSV'de.
   Ekranlar arası tutarlılık için oturumlar ekranıyla aynı rozet bırakıldı. Mod etiketi contracts'tan ("İstemci"/"Tarayıcı").
3. Kaydetme sonrası yönlendirme yok (bkz. Durumlar). Ticket/not için `maxLength` konmadı: yapıştırılan uzun metin kesilmeden sayaç + hata gösterilir.
4. Kalite bağlantı yolu P5 konsoluyla aynı etiketler (`p5.q.conn.*`).

### Testler
- Birim: `lib/history/history.test.ts` (filtre ayrıştırma/URL, geçersiz değer, from>to, export yolu, takvim günü, müşteri denetimi, süre, İstanbul günü, patch/doğrulama).
- E2E `p8-history.spec.ts`: AC-60 liste/sayfalama/sayfa boyutu/menü, filtre URL + yenileme + temizle, istemci doğrulaması + yok sayılan URL filtresi;
  AC-61 USER/ADMIN/SUPER_ADMIN sütun ve filtreleri, kapsam dışı id → bulunamadı; AC-62 tüm bölümler (kısayolla kapanan dönem + selfElevated rozeti,
  kapanışsız dönem, bilinmeyen action ham, başarısız olay, kırpılmış çizelge, BROWSER); AC-63 sayaç, doğrulama, sunucu alan hatası, ayrılma uyarısı,
  kaydet + toast + kalıcılık, salt okunur yetki; AC-63/124 CSV indirme (filtre iletimi, dosya adı, BOM, `;`, formül kaçışı) + 400/429; 5 durum;
  yetkisiz kullanıcı; axe açık/koyu liste + detay + 390 px kart görünümü ve taşma (masaüstü + mobil proje).

### Son doğrulama
- `pnpm -r run lint` temiz · `pnpm -r run typecheck` temiz · web birim **136/136**.
- Tam `pnpm --filter @remote/web e2e`: **174 geçti, 0 kırmızı**, 54 atlandı (gerekçeli mobil/masaüstü atlamaları; P8 akışlarının çoğu masaüstüne özel, mobilde axe/390 px + durum testleri koşar).
- AC-39 son tekrar (`-g "AC-39: P5" --repeat-each=10`, 7 işçi): **40/40**, en uzun 16,4 sn (bütçe 30 sn). Önceki iki dizi: 40/40 ve 20/20.
- Kalan: yok. Elle kontrol önerisi: gerçek backend ile (staging) CSV'nin tr-TR Excel'de sütunlara açılması (mimari §10.3 P8 kanıtı, test-operatoru).

### Frontend P8 — test bulguları (frontend-dev, 2026-11-11)
Rota değişmedi (`/history`, `/history/[id]`). Tasarım skill dosyaları okunmadı (yerleşim düzeltmesi; DESIGN.md primitifleriyle, yeni hareket yok).
- **TEST-P8-1** `/history/[id]`: "Dosyalar" bölümü artık tam genişlikte; yarım sütunda 6 sütunlu tablo sığmıyordu. Onay ve dosya tabloları ortak
  `DataTable` ile çiziliyor. xl ve üstünde tablo gösteriliyor; taşarsa odaklanabilir kaydırma kabı korunuyor. Daha dar alanda aynı veri `<dl>`
  kartlarıyla gösteriliyor (sm+ iki sütun), iç kaydırma yok. Kart görünümü xl altında açılıyor, çünkü 1024 px'te kenar menüsüyle tablo
  94 px taşıyordu (ölçüldü). Dosya adında `break-all` kaldırıldı; yerine `min-w-48` ve `wrap-break-word` geldi, ad artık harf harf bölünmüyor.
  SHA-256 `abababab…abababab` biçiminde kısaltılıyor. Tam değer `title`'da ve kopyala düğmesinde (`[id]/copy-hash.tsx`, `copyText` + toast).
- **TEST-P8-2** `/history`: hücre dolgusu `px-4` yerine `px-3`. Firma, Teknisyen, Bağlantı ve Ticket tek satırda, `truncate` + `title` ile.
  Bu yetmedi: SA 1280'de taşma 17 px'ten 18 px'e çıktı (Süre sütunu "· sürüyor" ile geniş). Bu yüzden Firma sütunu açıkken 2xl altında en az
  öncelikli **Bağlantı** sütunu gizleniyor. Bilgi filtrede, mobil kartta ve ayrıntı sayfasında duruyor. Ölçüm: kap 974 px, tablo 974 px.
- **Gözlem: tarayıcı geri tuşu** (`note-form.tsx` `useLeaveGuard`): form kirlenince aynı URL'ye bir nöbetçi geçmiş kaydı ekleniyor. Bunun için
  Next 16'nın desteklediği yerel `history.pushState(history.state, "", aynı URL)` kullanılıyor. Geri basılınca URL değişmiyor, Next aynı ağacı
  geri yüklüyor, form değeri korunuyor ve aynı onay diyaloğu açılıyor. "Sayfada kal" nöbetçiyi yeniden ekliyor. "Kaydetmeden ayrıl" bir adım
  daha geri gidiyor. Kayıt ya da geri alma sonrası form temizse, nöbetçiden geri basınca otomatik bir adım daha geri gidiliyor; tek basış
  listeye döndürüyor. Nöbetçi üzerindeyken bağlantıyla ayrılınca `router.replace` kullanılıyor, böylece çift kayıt oluşmuyor.
  Sınırlar: geçmiş menüsünden birden çok adım geri gidiş engellenemiyor (tarayıcı API'si izin vermiyor), bu durumda yalnız uyarı gösterilmiyor.
  Form temizken bağlantıyla ayrılınca nöbetçi geçmişte kalıyor: hedeften geri dönüşte aynı sayfa iki kez geçiliyor (zararsız).
- Değişen dosyalar: `apps/web/app/(panel)/history/history-list.tsx`, `history/[id]/{page,sections,note-form}.tsx`, `history/[id]/copy-hash.tsx` (yeni),
  `apps/web/messages/tr.json` (`h.file.copySha`), `apps/web/e2e/p8-history.spec.ts`, `DESIGN.md`.
- E2E (yeni): "TEST-P8-2" (SA/ADMIN/USER 1280 px, `pageSize=100`: kap taşması ≤ 0, tüm satırlar aynı yükseklikte, sayfa taşması yok);
  "TEST-P8-1" (1440/1280: dosya ve onay kabı taşması ≤ 0, dosya adı tek satır, SHA kısa metin + `title` + panoya tam değer; 1024/390: tablo gizli,
  kartlar görünür, kart ve sayfa taşması yok); "AC-63: … tarayıcı geri tuşu onay ister" (istemci gezinmesiyle gelinip `goBack` → diyalog,
  değer korunuyor; kal → yeniden yakalanıyor; ayrıl → `/history`; temiz formda tek geri → `/history`).
- Sonuç: web `lint` ve `typecheck` temiz, birim 136/136, `pnpm --filter @remote/web e2e p8-history` 22 geçti, 10 atlandı (masaüstüne özel akışlar mobilde), axe açık/koyu 0.

### Backend P8 — düşük bulgular (Tur 1 sonrası, 2026-11-11)
- **S8-1** `apps/server/src/lib/csv.ts`: formül kaçışı artık baştaki boşluk/NBSP/ideografik boşluktan (U+3000) sonra gelen tetikleyicileri ve tam genişlikli ＝＋－＠ varyantlarını da yakalıyor: `/^[\s 　]*[=+\-@\t\r＝＋－＠]/`. Her varyant için birim testi var (`test/unit/history-p8.test.ts`).
- **S8-2** `sessions/service.ts toView(r, viewerId)`: bekleyen oturumun `code` alanı liste, `:id/history` ve `:id` uçlarında yalnız oturumun kendi teknisyenine dönüyor; ADMIN ve SUPER_ADMIN `null` görüyor. Contracts'ta `code: string | null` zaten nullable, şema değişmedi; web typecheck ve testleri yeşil. Entegrasyon testi üç rolü ve üç ucu kapsıyor.
- **S8-3** `GET /sessions`: `customer` filtresi doluyken kullanıcı başına 60/dk sınırı var (`FixedWindowCounter(61, 60 sn, 60 sn)`); aşılınca 429 + `Retry-After`. Filtresiz liste bu sınırdan etkilenmiyor. Entegrasyon testi var.
- **QA-P8-2** `joinSessionInputSchema.customerName`: uzunluk artık kod noktasıyla sayılıyor (2..100), DB `CHAR_LENGTH` ile tutarlı. Tek emoji reddediliyor; 100 emoji (200 UTF-16 birimi) kabul ediliyor. Admit'teki NULL'a düşme yalnız gerçekten geçersiz değerde devreye giriyor (savunma amaçlı); geçerli adla e-posta artık kaybolmuyor.
- Sonuç: `pnpm -r run lint` ve `pnpm -r run typecheck` temiz. `pnpm -r run test`: contracts 50/50, server 256/256, web 136/136. `test:int` 216/216 (geçici mysql 8.4 `rs-mysql-be-p8`, iş bitince silindi). AC-60 ölçümü değişmedi: ADMIN 2,4 ms, USER 2,2 ms, SUPER_ADMIN 2,0 ms, API 6,7 ms.

### Ajan — TLS hata mesajı (P8)
- **Sorun:** Windows sunucu sertifikasına güvenmediğinde `api` istemcisinin TLS hatası `Status==0` olarak sınıflanıyordu. Bu yüzden ajan "Sunucuya ulaşılamıyor" mesajını gösterip kod giriş ekranına dönüyordu ve kullanıcı kodunun geçersiz olduğunu sanıyordu.
- `apps/agent-win/internal/api/api.go`: `Error` tipine `TLS bool` alanı eklendi. `isCertError` fonksiyonu `*tls.CertificateVerificationError`, `x509.UnknownAuthorityError`, `x509.CertificateInvalidError` ve `x509.HostnameError` hatalarını ayırt ediyor. TLS hatasında `Retryable()` artık false döndüğü için resolve isteği boşuna 3 kez denenmiyor. Doğrulama gevşetilmedi, pinning eklenmedi (AC-109).
- `apps/agent-win/internal/flow/messages.go`: yeni `msgTLS` mesajı eklendi ("Sunucu sertifikası doğrulanamadı" / "Bu bilgisayar sunucunun güvenlik sertifikasına güvenmiyor. Teknisyeninize bildirin; kod girmeniz sorunu çözmez."). `classify` bu hatayı `outFinal` ile döndürüyor, böylece kod giriş ekranına düşülmüyor. Bu metnin web tarafında karşılığı yok, çünkü tarayıcı sertifika hatasını kendisi gösteriyor.
- **Testler:**
  - `api_test.go` `TestAC109TLSErrorClassification`: httptest TLS sunucusuyla iki durum deneniyor: güvenilmeyen kök ve ad uyuşmazlığı. İkisinde de `TLS=true` ve yeniden deneme yok. Kapalı porta bağlanma ise `TLS=false` ve yeniden denenebilir sayılıyor.
  - `TestAC109RejectsUntrustedCertificate` testine `TLS` ve `Retryable` kontrolleri eklendi.
  - `flow_test.go` `TestClassifyTable` ile tüm sınıflar tablo halinde test ediliyor.
  - `TestAC109TLSErrorShowsFinalNotCodeEntry`: son ekranın gösterildiğini, `askcode` çağrısı yapılmadığını ve tek resolve yapıldığını doğruluyor.
- **Komut ve sonuç:** Docker `golang:1.26.11-bookworm@sha256:dc40…`, repo kökü bağlı, `GOFLAGS=-mod=readonly GOTOOLCHAIN=local`. `gofmt -l` temiz. `GOOS=windows go vet ./...` ve `go vet ./...` temiz. `go test -count=1 ./...` sonucunda 15 paketin tamamı ok.

### Ajan — enjekte tıklama uyarısı (0.8.1)
- **Sorun:** İzin diyaloglarında (kontrol, monitör, dosya kabulü; hepsi ortak `consentDlg`) IMO_HARDWARE dışı tıklama (TeamViewer/RDP/VNC/SendInput) sessizce yok sayılıyordu; kullanıcı "İzin ver çalışmıyor" sanıyordu.
- `apps/agent-win/internal/control/consent.go`: `Reason` (`ReasonOK`, `ReasonNoHotkey`, `ReasonEnterSpace`, `ReasonTooEarly`, `ReasonInjected`) ve `Consent.Check`; `CanGrant` artık `Check(...) == ReasonOK` (kural aynı). Kısayol/tetikleyici/zaman enjeksiyondan önce denetlenir, böylece kilitli veya kısayolsuz diyalogda uyarı çıkmaz. Uyarı metni `InjectedWarning` sabitinde.
- `apps/agent-win/internal/ui/control_windows.go`: `tryGrant` `Check` sonucuna göre ayrılır; `ReasonInjected` → `warnInjected`: bir kez (`warned`) danger satırı eski düğme satırına eklenir, düğmeler `consentWarn` kadar aşağı kayar, istemci yüksekliği büyür, pencere konumu korunarak (`SWP_NOMOVE`) yeniden boyutlanır. Diyalog açık kalır, karar verilmez.
- **Sapma (gerekçeli):** Düğme yeri değiştiği için 1,5 sn kilit yeniden başlatılır ve odak "Reddet"e döner (kayan düğmeye kaza tıklaması olmasın; G-03 yalnız sıkılaşır). Diyalog yeniden konumlandırılmaz.
- **Testler:** `control_test.go` `TestConsentCheckReasonInjectedWarning` (yerel → OK, enjekte tık/Alt+İ → Injected, kilitliyken/kısayolsuz/Enter enjekte → uyarısız neden, `CanGrant` ile tutarlılık). Mevcut AC-116/AC-102 testleri değişmeden geçer.
- **Komut ve sonuç:** Docker `golang:1.26.11-bookworm@sha256:dc40…`, `GOFLAGS=-mod=readonly GOTOOLCHAIN=local`: `go test ./...` 15 paket ok; `GOOS=windows go vet ./...` temiz; `gofmt -l` temiz. Web/sunucu sözleşmesi değişmedi.

## Devops P8b-1 — müşteri destek talebi altyapısı (devops, 2026-11-12)
**Değişen dosyalar:** `.env.example`, `deploy/docker-compose.yml` (server: `WHATSAPP_SERVICE_URL`, `MIN_AGENT_VERSION` — çıplak anahtar, `ABUSE_EMAIL` kalıbı), `deploy/Caddyfile`, `deploy/nginx/remote.noktabilisim.net.conf`, yeni `deploy/test-caddy.sh`, yeni `deploy/nginx/test-nginx.sh`, `.github/workflows/ci.yml` (build job'a iki adım; yeni Action yok, izinler değişmedi), `docs/runbook.md` §3/§5/§12.
- **Caddy:** yeni `@agentExeFirm` = `^/downloads/(NoktaDestek-[A-Za-z0-9]{1,20}-[a-z2-7]{16})\.exe$` → aynı volume ikilisi; `forward_auth server:3001` uri **`/internal/agent-ready`** (mimari-api'deki ad, değişmedi), `X-Forwarded-Uri: /downloads/NoktaDestek-<label>-<ref>.exe` (yalnız yol, sorgu dizesi yok). P6 yolları eskisi gibi `X-Forwarded-Uri: /downloads/***` gönderir (server ad görmez). Dosya sunma bloğu `(agent_exe_file)` snippet'inde ortak. Biçim dışı adlar server'a gitmez (404).
- **Log:** iki Caddy filtresine `request>uri regexp "NoktaDestek-[^/?]+" "NoktaDestek-***"`; nginx'e üçüncü map (ilk `NoktaDestek-`ten sonrası silinir). **Bulgu (mevcut, düzeltildi):** `resp_headers>Sec-Websocket-Protocol delete` 101 yanıtında etkisizdi — Caddy başlığı `Sec-WebSocket-Protocol` yazımıyla logluyor. İkinci yazım eklendi. Gerçek sızıntı yoktu (server yanıtta yalnız `rs.v1` seçer); test, sırrı geri yazan sahte upstream'le en kötü durumu sınar.
- **WS:** `/ws/request`, `/ws/panel` mevcut `/ws/*` kuralıyla gider; ek ayar gerekmez — 40 sn açık tutulan WS'e Caddy `read_body 30s`/`read_header 10s` uygulanmadı (test-caddy `CADDY_TEST_WS_HOLD=1`).
- **Metrik/alarm:** runbook §12.5 PromQL tabloları (Prometheus sunucusu yığında yok; mevcut uygulama gibi kurallar runbook'ta).

### Backend-dev için
1. `/internal/agent-ready`: `X-Forwarded-Uri` `^/downloads/NoktaDestek-([A-Za-z0-9]{1,20})-([a-z2-7]{16})\.exe$` ise ref aktif + label güncel `file_label` → 204, değilse 404 (aynı gövde/süre); diğer değerler (`/downloads/***`) yalnız ikili kapısı. Ref loglanmaz.
2. `env.ts`: boş dize = tanımsız (mevcut `withoutBlanks`) — `WHATSAPP_SERVICE_URL=""` → varsayılan, `MIN_AGENT_VERSION=""` → kontrol yok. Compose boş değeri `""` olarak geçirir (doğrulandı).
3. Metrik etiketleri runbook'taki kurallarla aynı olmalı: `rs_request_notify_total{channel="whatsapp", result="ok"|"failed"|"suppressed"}`, `rs_request_rate_limited_total{bucket="tenant",…}`, `rs_ws_connections{role="request"|"panel"}`. Farklı ad/etiket seçilirse runbook §12.5 güncellenmeli (devops'a not).

### Doğrulama (yerel, 2026-11-12)
- `deploy/test-caddy.sh` (+`CADDY_TEST_WS_HOLD=1`): GEÇTİ — firma adı 200 + doğru `Content-Disposition`; kapı 404/503/502'de dosya sunulmuyor; 10 biçim dışı ad 404 ve server'a gitmiyor; P6 regresyonu; `/internal`,`/metrics`,`/ready` 404; erişim + hata logunda ref, firma adı, sorgu dizesi, talep sırrı yok.
- `deploy/nginx/test-nginx.sh` (nginx 1.24.0 = sunucu sürümü): `nginx -t` + maske GEÇTİ.
- `caddy validate`, `docker compose config` (boş ve dolu env), ci.yml YAML ayrıştırma: temiz. gitleaks `dir`: repo dosyalarında 0 bulgu (13 bulgu yalnız git-ignore `apps/web/.next/` derleme çıktısında; CI `git` modu bunu taramaz).
- Sunucuya dokunulmadı; nginx/Caddy/env yayını runbook §12.1 adımlarıyla yapılır.
- **QA/güvenlik düzeltmesi (2026-11-12):** `deploy/test-caddy.sh`e ikinci firma adı (`NoktaDestek-IkinciFirma2-<ref2>.exe`) indirmesi + iki indirmenin ve volume ikilisinin aynı SHA-256 kontrolü (AC-130) ve logda ikinci ad/ref yok kontrolü; runbook §12.5'e server log `alarm:"db_busy"` eşik satırı (5 dk > 20 veya 15 dk süren; kod dağılımı, S8b-5 havuz/S8b-6 giriş sayacı bağlamı, ilk adımlar — metrik yok, log sayımı; backend `rs_db_busy_total` gibi bir sayaç eklerse satır PromQL'e çevrilir). `bash deploy/test-caddy.sh`: GEÇTİ (41 PASS, 0 FAIL).

## Frontend P8b-1 — müşteri destek talebi (panel) (frontend-dev, 2026-11-12)
Kaynak: `docs/mimari-e9.md` §13, `docs/mimari-api.md` "Destek talepleri (P8b)", `docs/mimari-protokol.md` §5.3, AC-146..149, 152, 153, 157, 158, 164.
Sözleşme: `@remote/contracts/api/requests` + `ws-request` (backend-dev) — web yalnız yeniden dışa aktarır (`lib/requests/contract.ts`), alan/şema tanımı yok.

### Rotalar
| Yol | Auth | Ne yapar |
|---|---|---|
| `/requests` | Oturum + `support_requests.view` (Super Admin firma seçmiş olmalı; seçmemişse "Önce firma seçin") | Bekleyen talepler kuyruğu (canlı, `/ws/panel`); Kabul et (`accept` → `/sessions/<id>/console`) / Reddet (diyalog); ses aç/kapa |
| `/requests?tab=history[&status=][&page=]` | Aynı | Son 30 günün kapanan talepleri, durum filtresi (link), sayfalama (25) |
| `/requests#talep-<id>` | Aynı | Toast "Görüntüle" hedefi (kart vurgulanır) |
| `/settings/support-requests` | Oturum + `settings.edit` (Super Admin firma seçmeli) | İndirme bağlantısı + kopyala + onaylı "Bağlantıyı yenile", bekleme süresi 10–120, WhatsApp aç/kapa + ≤5 alıcı + test, e-posta pasif (P10), güvenilen IP/CIDR ≤10 |
| `/history?source=REQUEST\|TECH` | Mevcut | P8 listesi + "Kaynak" filtresi; talepten doğan satırda "Talep" hapı (bekleme `title`/kartta görünür) |
| `/history/<id>` | Mevcut | Özet'te "Kaynak"; talepten doğan oturumda "Destek talebi" bölümü (talep/kabul zamanı, bekleme, ad, telefon, e-posta, açıklama düz metin) |
Ws: `/ws/panel` (çerez; sorgu dizesi yok) — panel kabuğu `support_requests.view` + tenant bağlamı varken açar.

### Değişen / eklenen dosyalar (apps/web)
- Yeni: `app/(panel)/requests/{page,loading,request-card,request-queue,reject-dialog,sound-toggle}.tsx`, `app/(panel)/settings/support-requests/{page,loading,settings-form}.tsx`, `components/request-notifier.tsx`, `components/ui/switch.tsx`, `lib/requests/{contract,validate,source,sound,panel-socket,settings-form,errors}.ts`, `lib/requests/requests.test.ts` (22 test), `e2e/mock-requests.mjs`, `e2e/p8b-requests.spec.ts` (10 senaryo).
- Değişen: `app/(panel)/layout.tsx` (notifier), `side-nav.tsx` (Talepler `Inbox` + rozet, Ayarlar `Settings`), `components/ui/toast.tsx` (`info` tonu, `action`, `durationMs`), `history/{page,history-filters,history-list}.tsx`, `history/[id]/{page,sections}.tsx`, `lib/history/query.ts` (`source`), `messages/tr.json` (`rq.*`, `srs.*`, `h.r.*`), `e2e/{mock-api,mock-ws,mock-history,helpers}.mjs|ts` (502 beklenen ağ hatası listesine eklendi — WhatsApp testi `UPSTREAM`).

### Kararlar / sapmalar
- Bilinen kaynak: koordinatör kararı + contracts `networkBadge`: IP/TRUSTED veya `knownDevice` → "Bilinen kaynak" (nedenleri contracts etiketleriyle); PREFIX nötr satır, uyarıyı kaldırmaz; aksi `FIRST_SEEN_SOURCE_LABEL` uyarısı. PREFIX metni brifteki "Aynı ağ bloğu" yerine contracts `NETWORK_MATCH_LABELS.PREFIX` ("Benzer ağdan önceki oturum var") — tek kaynak ilkesi; değişecekse contracts'ta değişir.
- Toast Sonner değil, mevcut CSP uyumlu `ui/toast` genişletildi (DESIGN §6). Ses: WebAudio iki ton, yeni bağımlılık yok; tercih `localStorage` `rs.requests.sound` (sunucu tercihi P12).
- `RequestNotifier` sayfa içeriğini **sarmaz**: istemci sağlayıcıyla sarıldığında `loading.tsx` akışında içerik geçici olarak çift (gizli `S:0` + görünür) çiziliyor, katı e2e konumlandırıcıları bozuluyordu. Durum küçük modül deposunda (`useSyncExternalStore`).
- `/ws/panel` yeniden bağlanma: 4401 → dene; 4429/1008 → dur; hiç açılamayan 3 denemeden sonra dur (upgrade 403 tarayıcıda 1006 görünür). Bağlanınca sayı `/support-requests/count`'tan, liste REST'ten tazelenir; soket yokken kuyruk 15 sn'de bir yoklar (kısmi durum uyarısı).
- `request.new` liste kaydını değil yalnız önizlemeyi taşır → kuyruk REST'ten yeniden çekilir (telefon/e-posta WS'te yok).
- Kabul yanıtındaki `consoleUrl` yalnız `/sessions/<ULID>/console` biçimindeyse kullanılır (açık yönlendirme savunması).
- Ayar formu: CIDR/telefon/ret mesajı kuralları contracts'tan (`checkTrustedCidr`, `normalizePhone`, `rejectMessageSchema`); sunucu 400 `fields` yolları ("whatsapp.recipients.1", "trustedCidrs.0") alanlara yansır. Kaydedilmemiş değişiklikte `beforeunload` uyarısı (uygulama içi bağlantı yakalama P9 `ui/save-bar` ile).
- Tasarım skill'i `~/.claude/skills/ui-ux-pro-max/SKILL.md` tur sınırı nedeniyle okunmadı; DESIGN.md token/primitifleri esas alındı.

### Test durumu
`pnpm -r lint` ✓ · `typecheck` ✓ · web `test` 158/158 ✓ · `e2e` 188/188 ✓ (68 atlandı).
- **AC-63 geri tuşu düzeltmesi:** `p8-history.spec.ts:314` yarış nedeniyle kalıyordu (notifier'dan bağımsız; yük arttıkça sıklaşıyordu): `dialog.close()` "close" olayını kuyruğa koyar; "Sayfada kal"ın hemen ardından ikinci geri basışta diyalog yeniden `showModal` ile açılıyor, ilk kapanışın gecikmiş "close" olayı gelip `onClose` (stay) ile onu kapatıyordu. `components/ui/dialog.tsx`: `onClose` yalnız öğe gerçekten kapalıyken (`!e.currentTarget.open`) çağrılır; test değişmedi.

### Düzeltme turu 2 (qa-raporu Tur 2) (frontend-dev, 2026-11-12)
- **QA-P8b-12 (AC-149) kök neden:** test, `/ws/panel` soketi açılmadan `request.new` kancasını tetikleyebiliyordu; mock olayı yalnız açık soketlere ittiği için olay kayboluyordu (rozet `3` REST'ten geldiği için senkron noktası değildi). Düzeltme yalnız test tarafında: `e2e/mock-requests.mjs`'e `GET /__e2e/rq/sockets/<çerez>` → `{ open }` (yalnız `readyState=1` soketler) eklendi; `p8b-requests.spec.ts` olaydan önce, "Görüntüle" geçişinden sonra ve 4401 kapanışından sonra `expect.poll(open) ≥ 1` bekler (önceki sabit `waitForTimeout(2500)` kaldırıldı). Ürün kodu değişmedi.
- **QA-P8b-13 (AC-161) kök neden — ürün hatası, notifier/layout değil:** `lib/control/machine.ts` `{VIEW, TECH}` onayını her fazda kapatma olarak işliyordu. Vazgeç → hemen "Kontrol iste" sırasında sunucu önce iptali işleyip `{VIEW, TECH}` yollar, sonra yeni isteği misafire iletir; onay konsola yeni istekten **sonra** varınca bekleyen istek yerelde `ended` oluyor, "Vazgeç" düğmesi kayboluyordu (sunucu ve müşteri `REQUESTED`'de kalırken konsol "bıraktınız" gösteriyordu — gerçek sunucuda da aynı sıralama, `control.ts:170/177`). P8b-1 ile tam koşudaki ek yük (panel soketi, `standalone` sunucu) yalnız gecikmeyi büyütüp yarışı görünür yaptı. Düzeltme: `requested` fazında gelen `{VIEW, TECH}` yok sayılır (o fazda teknisyenin son eylemi istektir; TECH onayı ancak önceki Vazgeç/Bırak'a aittir). Birim testi `machine.test.ts` "QA-P8b-13/K2". `TEST-P7-3` döngüsü artık "Vazgeç" görünürlüğünü açıkça bekler, tıklama sonrası `data-phase="ended"` doğrular (gevşetilmedi).
- Aynı ailede tam koşuda görülen ikinci yarış (`AC-115/G-04`, `stage` `on` olmadı): test `grant(a)`'yı müşteri isteği almadan yollayabiliyordu → sunucu `stale` sayıyordu. Gerçek müşteri istek görmeden izin veremez; test hatası. `e2e/fake-agent.ts`'e `asked` (yanıtlanmamış istek ulaştı) eklendi, `grant()` önce `asked=true` bekler. Bilerek geç izin senaryosu (K2/S7-2) doğrudan `agentSend` kullanır.
- Kanıt: web lint ✓ · typecheck ✓ · test 159/159 ✓ · tam e2e üst üste 3 koşu 188/188 (68 atlandı) · `p7-control` + `p8b-requests` `--repeat-each=5` 105/105.

### Düzeltme turu 3 (test-raporu P8b-1 Tur 1) (frontend-dev, 2026-11-12)
- **TEST-P8b-1:** `useLeaveGuard` `history/[id]/note-form.tsx`'ten `lib/use-leave-guard.ts`'e taşındı (davranış aynı: bağlantı yakalama + geri tuşu nöbetçisi + `beforeunload`); onay diyaloğu `components/leave-dialog.tsx` (bileşim, yeni primitif değil). `settings-form.tsx` kendi `beforeunload`'ı yerine bunu kullanır; metin `srs.leaveBody`. e2e "TEST-P8b-1" (menü bağlantısı + geri tuşu, Sayfada kal / Kaydetmeden ayrıl).
- **TEST-P8b-2:** `request-queue.tsx` sekme ömürlü `acceptedHere` kümesi: kabul edilen id önbellekten gelen `initial`'dan ve sonraki tazelemelerden düşülür; bfcache dönüşünde (`pageshow.persisted`) liste tazelenir. e2e "TEST-P8b-2".
- **TEST-P8b-3:** kaydet çubuğu yalnız `dirty || saving` iken çizilir; tek satır (durum metni + geri al + Kaydet), mobilde "geri al" yalnız ikon (`sr-only` etiket, ad korunur), `-mx-4` kaldırıldı (iç taşma). `srs.clean` metni kullanılmadığı için silindi. e2e "TEST-P8b-3" (390: yükseklik ≤ 72 px, taşma yok).
- **TEST-P8b-4:** "Bilinen kaynak" rozeti `whitespace-nowrap`, nedenler altında liste (`request-source-reasons`). AC-146 e2e'ye tek satır yükseklik denetimi.
- **Ek (tam koşuda yakalandı, AC-149 aralıklı):** `request-notifier.tsx` soket açılışında başlatılan REST `/support-requests/count` yanıtı, daha sonra gelen WS `queue.count`'un üzerine eski değeri yazabiliyordu (rozet 4 yerine 3). Sıra sayacı `countSeq`: REST yanıtı yalnız arada WS sayısı gelmediyse uygulanır.
- Kanıt: web lint ✓ · typecheck ✓ · test 159/159 ✓ · `p8b-requests --repeat-each=3` 42/42 ✓ · tam e2e 191/191 (71 atlandı). Server/deploy dosyalarına dokunulmadı.

## Backend P8b-1 — müşteri destek talebi (sunucu) (backend-dev, 2026-11-12)

### Değişen / eklenen dosyalar
- **contracts:** `src/api/requests.ts` (yeni: durum makinesi, alan şemaları, CIDR doğrulayıcı, uç şemaları/tipleri), `src/ws-request.ts` (yeni: `/ws/request` + `/ws/panel` mesajları, kapanış kodları 4409/4429/4401), `permissions.ts` (`support_requests.view|accept`), `errors.ts` (REQUEST_REF_INVALID 404, REQUEST_PENDING/TAKEN/CLOSED 409, CLIENT_OUTDATED 426, QUEUE_FULL 429, UPSTREAM 502), `labels.ts`, `api/sessions.ts` (`source`, `waitSec`, `request`, CSV Kaynak/Bekleme, resolve `clientVersion`), `package.json` exports, `fixtures/ws-request.json`, `fixtures/request-form.json`.
- **server (yeni):** `src/requests/{ref,limits,hub,repo,service,panel,jobs,ws,public-routes,routes}.ts`, `src/notify/whatsapp.ts`, `src/lib/version.ts`.
- **server (değişen):** `app.ts` (hub/limits/notifier/RequestService, rotalar, işler), `env.ts` (`WHATSAPP_SERVICE_URL`, `MIN_AGENT_VERSION`; boş → tanımsız), `lib/{logger,errors,ids,ip}.ts`, `audit/mask.ts` (`maskPhone`), `ops/metrics.ts` (etiketli gösterge), `signaling/{types,rooms,admit,handlers,ws}.ts` (ön-kabullü talep misafiri, ticket kuşağı, `/ws/request`/`/ws/panel` yönlendirme, 426), `sessions/{repo,public,routes,history,history-repo}.ts`, `public/{service,consent,routes}.ts` (forward_auth firma yolu), `auth/routes.ts` (logout → `closeByAuthToken`, şifre değişimi → `closeByUser`), `jobs/scheduler.ts` (30 sn süpürücü + 00:30 UTC anonimleştirme).
- **testler:** `test/unit/requests-contract-p8b.test.ts`, `test/integration/requests-p8b.test.ts` (17 test), `test/helpers/requests.ts`, `test/helpers/tenant-matrix.ts` (yeni uçlar + `requestId` fikstürü), `test/integration/sessions-history-api-p8.test.ts` (CSV sütunları).
- **docs:** `mimari-api.md`, `mimari-protokol.md` — `knownNetwork` → `networkMatch` + `knownDevice` (koordinatör kararı a / G-E9-15).

### Tasarımdan sapmalar (gerekçeli)
1. **CSV başlığı değişti (P8 testi güncellendi):** AC-158 "Mod"dan sonra "Kaynak", "Bekleme" sütunlarını istiyor; P8 testinin sabit başlık beklentisi buna göre güncellendi (AC-61 regresyonu değil, bilinçli sözleşme genişlemesi).
2. **Super Admin talep kabul edemez (403):** oturum teknisyenin kendi tenant'ında açılır (P2 kuralı); Super Admin seçili firmada kuyruğu görür, kabul/ret yapamaz.
3. **Talep oturumu genel oturum-expiry işinden hariç** (`requestId: null` filtresi); 60 sn bağlanma penceresi ve CONNECT_FAILED talep süpürücüsünde/zamanlayıcısında.
4. **G-E9-17 kara liste:** koordinatör kararı c ile "Sonra" listesinde; kodlanmadı.
5. **G-E9-16:** güvenilen CIDR kaynakları `/ws/request` IP başına soket sınırından ve IP/prefix/net hız + bekleyen sınırlarından muaf; tenant bekleyen sınırı (50) geçerli.
6. **Matris sınıfı `scoped`:** tenantScope'lu id'siz koleksiyon/ayar uçları (liste, count, ayarlar) mevcut `list`/`self` sınıflarına uymadığı için `tenant-matrix.ts`'e `scoped` sınıfı eklendi; izolasyonu `requests-p8b.test.ts` (AC-148/149) test eder. `:id` uçları CROSS_TENANT_CASES'te (404).
7. **Metrik:** `rs_ws_connections{role="request|panel"}` etiketli gösterge (devops adlarıyla aynı); `rs_request_notify_total{result=ok|failed|suppressed}`.
8. İstemci talep oluşturup hiç bağlanmazsa da 120 sn kopma kuralı uygulanır (açılışta `armOrphanedPending` dahil).

### Bağımlılık
Yeni bağımlılık yok (CIDR ayrıştırıcı saf TS; WhatsApp istemcisi yerleşik `fetch`).

### frontend-dev için sözleşme notları
- `SupportRequestItem` ve `request.new`: `knownNetwork` YOK → `networkMatch: "NONE"|"PREFIX"|"IP"|"TRUSTED"` + `knownDevice`. Rozet: `networkBadge(networkMatch)` (yalnız IP/TRUSTED).
- `/ws/panel`: alt protokol `rs.v1`, çerez + Origin; tek yönlü (gelen mesaj → 1008); kullanıcı başına 5 soket (fazlası 4429); logout/şifre değişimi/yetki kaybı → 4401. Mesajlar: `queue.count`, `request.new`, `request.removed`, `request.connect_failed`, `request.declined`, `queue.alert`.
- Kabul yanıtı `{ sessionId, consoleUrl }`; yarış kaybı 409 `REQUEST_TAKEN`, kapalı 409 `REQUEST_CLOSED`, açık oturum sınırı 409 `OPEN_SESSION_LIMIT` (talep PENDING kalır).
- Ayarlar `email.enabled=true` iken SMTP yoksa 400 (`SMTP_REQUIRED_MESSAGE`).
- Geçmiş: liste öğesinde `source`, `waitSec`; detayda `request` (anonimleştirilmişse PII null); `?source=REQUEST|TECH` filtresi.

### Test komutları ve son çıktı
- `pnpm -r run lint` → 3 paket temiz. `pnpm -r run typecheck` → hatasız.
- `pnpm -r run test` → contracts 50/50, server 270/270, web 158/158.
- `cd apps/server && pnpm test:int` (geçici MySQL 8.4) → **26 dosya, 233/233** (AC-1..128 regresyonu dahil).

### Kapsanmayan / eksik test (açık)
Kod yazıldı, otomatik entegrasyon testi henüz yok:
- WhatsApp: 3 deneme/zaman aşımı, tenant/alıcı/global sınırları, saatlik özet, fail-closed (`http://` + genel host), `request.notify` audit (sahte fetch ile test edilmeli).
- Ayarlar PUT / `rotate-ref` (eski ref 404) / WhatsApp test ucu (502).
- 120 sn kopma → DISCONNECTED, 60 sn CONNECT_FAILED, pasif tenant → TENANT_PASSIVE (süpürücü), müşteri `request.decline` (ACCEPTED).
- Hız kovaları ayrıntısı (ref_invalid 15 dk blok, create IP/prefix/net48, tenant 60/120 + `queue.alert`), `/ws/request` IP başına 5 soket ve güvenilen CIDR muafiyeti, panel kullanıcı başına 5 soket.
- forward_auth firma yolu (`/internal/agent-ready` + `NoktaDestek-<label>-<ref>.exe`), `request-download` 302 başarılı yolu.
- `MIN_AGENT_VERSION` 426: yalnız talep oluşturma test edildi; resolve/join/`/ws/guest`/`/ws/request` yolları test edilmedi.
- Talep oturumunda teknisyen pasifse `auth_revoked`; caps'in DB'deki etkin yetkilerden hesaplanması ayrı testle doğrulanmadı.

### Test turu (backend-dev, 2026-11-12)
Yukarıdaki "Kapsanmayan / eksik test" listesinin tamamı entegrasyon testine bağlandı (gerçek MySQL 8.4 + dinleyen sunucu; zamanlayıcılar `FakeClock`, WhatsApp yalnız yerel sahte HTTP sunucusu).
- **Yeni dosyalar (35 test):** `test/integration/requests-p8b-2.test.ts` (13: WhatsApp şablonu/PII yok/alıcı başına maskeli audit, 3 deneme +5/+20 sn, 8 sn zaman aşımı, alıcı 10/sa + tenant 30/sa + sistem 300/sa ve saatlik özet, fail-closed; ayarlar PUT doğrulama sınırları, `rotate-ref`, WhatsApp test ucu + 5/dk; production'da 502), `requests-p8b-3.test.ts` (12: 120 sn kopma + tolerans içi yeniden bağlanma, 60 sn CONNECT_FAILED + yalnız kabul edene `request.connect_failed`, süpürücü CONNECT_FAILED yedek yolu, TENANT_PASSIVE, `request.decline`, süre dolumu; ön-kabullü misafirde teknisyen pasif → `auth_revoked`, caps'in admit anındaki DB yetkilerinden hesaplanması; 426 resolve/join/`/ws/guest`/`/ws/request`), `requests-p8b-4.test.ts` (10: create ip/prefix/net48 kovaları, ref_invalid 15 dk kilidi, tenant 60/120 + `queue.alert`, bilinen kaynak ayrıcalığı yalnız TRUSTED/known_device, `/ws/request` IP başına 5 soket + güvenilen CIDR muafiyeti, panel kullanıcı başına 5 soket, forward_auth firma yolu, request-download 302/503/30 sa).
- **Kod değişikliği (1):** `notify/whatsapp.ts` 8 sn çağrı zaman aşımı global `setTimeout` yerine enjekte `clock` ile kuruluyor (deneme beklemeleriyle aynı saat; `realClock` unref'li olduğundan üretim davranışı aynı). Gerekçe: zaman aşımı yolu gerçek 8 sn beklemeden test edilebilsin.
- **Test altyapısı:** `test/helpers/app.ts` `testEnv` varsayılan `WHATSAPP_SERVICE_URL=http://127.0.0.1:9` (env varsayılanı canlı servis; bir test yanlışlıkla `wa_enabled`/test ucu çağırırsa dışarı istek gitmesin). `helpers/requests.ts`: `startFakeWhatsapp`, `requestClient`, `waitMsg/hasMsg`. `helpers/ws.ts` `FakeClock.pending`, `hasTimerIn(ms)`.
- **Bulunan hata:** sözleşmeyi bozan hata bulunmadı. Notlar (değişiklik yapılmadı): (1) `WHATSAPP_SERVICE_URL` env'de varsayılanlı olduğundan `serviceConfigured` her zaman true; "Servis yapılandırılmamış" 502 dalı ulaşılamaz (ölü değil, savunma). (2) `/ws/guest`'te ticket sürüm kontrolünden önce tüketiliyor; 426 alan eski istemcinin ticket'ı yanar (yeni ticket `/ws/request` yeniden bağlanmasıyla alınır — sözleşmeyle çelişmiyor). (3) Tenant 120/sa bilinen tavanı testinde sayaç doğrudan dolduruldu (120 gerçek talep bekleyen sınırları nedeniyle kurulamıyor).
- **Komutlar:** `pnpm -r run lint` temiz · `typecheck` hatasız · `test` contracts 50, server 270, web 158 · `pnpm test:int` (geçici MySQL 8.4, sonra silindi) **29 dosya, 268/268**.

### Backend P8b-1 — düzeltme turu 1 (testler) (backend-dev, 2026-11-12)
Kapsam: `docs/qa-raporu.md` P8b-1 Tur 1 eksik test maddeleri QA-P8b-2..10 + AC-129. Üretim kodu **değiştirilmedi** (paralel ajan kod düzeltmelerini yürütüyor); bulunan hatalar aşağıda, `it.fails` ile kayıtlı.
- **Yeni dosyalar:**
  - `test/integration/requests-p8b-5.test.ts` (13): AC-135 eski `consentTextId` → 400 `fields.consentTextId` (başka tenant'ın metni ve `consentAccepted:false` da 400, satır yazılmaz) + talep satırında metin/sha/`consentedAt`/IP, her talep ayrı onay; AC-135/§13.3 `session_consents.request_id` + metin/sha (VIEW/GRANTED/UI); AC-147 yalnız `view` → liste/sayaç/detay 200, kabul/ret 403, audit yok; AC-148 Super Admin firma seçmeden 7 uçta 403 "Önce bir firma seçin.", seçili tenant'ta yalnız o tenant'ın talepleri, başka tenant 404, kabul 403 (sapma 2); AC-160/157 `request.accepted{status,sessionId,waitSec}` + `request.rejected{status,message}` (kullanıcı, tenant, sonuç) ve tüm `request.*` audit'lerinde ad/telefon/e-posta/açıklama/sır taraması, müşteri IP'si yalnız `request.created`'da (AC-160 gereği orada bulunur); AC-143 IP başına 3 bekleyen (4. → 429 + genel mesaj, iptal sonrası yer açılır), /24 başına 10 (11. → 429, komşu /24 serbest), IPv6 /64 tek IP, güvenilen CIDR muafiyeti + örnek sınırı yine 409; AC-129 Admin ayarlarından ref `^[a-z2-7]{16}$` (80 bit), tenant'lar arası farklı, `settings.edit`'siz kullanıcı 4 ayar ucunda 403 (gövdede ref yok), oturumsuz 401; AC-158 geçmiş detayı talep bölümü (zaman, `acceptedAt`, `waitSec`, ad, telefon, e-posta, açıklama) + CSV `Kaynak=Talep`, `Bekleme`, talepten gelen `=HYPERLINK(...)` adı kaçışlı; AC-159 ad/telefon/e-posta/açıklama/ip/`ip_key`/`net_key`/`device_hash` boşaltılır, `retention_days` 90 ve 730 sınırları.
  - `test/integration/requests-p8b-6.test.ts` (4): AC-156 talep oturumunda P7 akışı (gerçek WS + `FakeClock`): `hello.caps`, ilk seviye VIEW (istenmemiş GRANTED → `revoke{stale}`, kayıt yok), `control.request` → DENIED + 30 sn bekleme → GRANTED yalnız `source=UI` → HOTKEY ile REVOKED, GRANTED/HOTKEY şema reddi 1008; yetki kaldırılınca `revoke{permission}` + `caps.update`, `session.end` sonrası istemci < 3 sn kapanır (AC-107). AC-130 iki tenant (`Çağrı Özel Bilişim Ticaret A.Ş.`, `Güneş İnşaat Ltd`) → farklı ad, forward_auth 204, `deploy/Caddyfile` `@agentExeFirm` eşleşmesi + `agent_exe_file` root/rewrite → aynı dosya, SHA-256 = `AGENT_SHA256`. AC-146 performans.
  - `test/unit/requests-ref-p8b.test.ts` (6): `newTenantRef` biçim/benzersizlik/konum dağılımı, `base32Lower` RFC 4648 vektörleri; `fileLabelOf` Türkçe → ASCII, ≤ 20, boş/indirgenemeyen → `Firma`, ayrıştırıcıyla tutarlılık.
- **Değişen:** `requests-p8b.test.ts` 9 test adı (QA-P8b-10; yalnız adlar), `test/helpers/tenant-matrix.ts` yorumu (var olmayan `requests-isolation-p8b.test.ts` atfı → gerçek dosyalar), `test/helpers/requests.ts` (`createRequestRow` isteğe bağlı ad/e-posta/açıklama/`deviceHash`; `createReq` `extra` gövde alanları).
- **AC-146 ölçümü (QA-P8b-8):** hedef tenant 1.000 talep (40 bekleyen + 960 geçmiş) + 1.000 kayıtlı gürültü tenant'ı, `createMany` 500'lük partiler; 5 ölçümün medyanı (yerel MySQL 8.4, inject): `tab=pending` **6,1 ms**, `tab=history&pageSize=100` **6,6 ms**, 10. sayfa **7,1 ms** (eşik 500 ms).
- **AC-130 sınırı:** gerçek Caddy kanıtı devops `deploy/test-caddy.sh`'tedir (şu an tek firma adı). Sunucu testi Caddyfile'daki eşleştirici + rewrite hedefini okuyup çözümler. **devops önerisi:** test-caddy.sh'e ikinci firma adı ve iki indirmenin SHA-256 eşitliği satırı.
- **Bulunan üretim hataları (düzeltilmedi, `it.fails` ile kayıtlı — düzeltilince test kırmızıya döner, `it` yapılmalı):**
  1. **AC-147 (Orta):** `src/requests/routes.ts` accept/reject yalnız `support_requests.accept` ister; `view` yok + `accept` var kullanıcı kabul/ret yapabilir. AC-147 "view yoksa tüm talep uçları 403". Öneri: iki uçta `requirePerm("support_requests.view")` + `accept` (veya `preHandler` dizisi).
  2. **AC-148 / sapma 2 (Orta):** `src/requests/panel.ts rejectRequest` Super Admin (`auth.user.tenantId !== tenantId`) kontrolü yok → seçili tenant'ta ret 204 + REJECTED. `acceptRequest`'teki kontrol ret için de uygulanmalı.
  3. **Düşük:** `service.ts:249` IP ve önek bekleyen sınırı aşımında audit kovası ikisi için de `pending.ip`/`keyType:"ip"` (önek aşımı ayırt edilemiyor). Öneri: `pending.net`/`net`.
- **Komutlar:** `pnpm -r run lint` temiz · `pnpm -r run typecheck` hatasız · `pnpm -r run test` contracts 50, server 276, web 158 · `pnpm test:int` (geçici MySQL 8.4 `rs-mysql-test-p8btests:33357`, sonra silindi) **33 dosya, 289 geçti + 2 beklenen başarısız (it.fails), 0 kırmızı**; yeni dosyalar + `requests-p8b.test.ts` 2 ek koşuda 32/32 + 2.

### Backend P8b-1 — düzeltme turu 1 (backend-dev, 2026-11-12)
Kapsam: QA-P8b-1, QA-P8b-11, S8b-1..4 ve koordinatörün ek maddeleri (AC-147 view şartı, AC-148 Super Admin reti, bekleyen sınır audit'i).

**Kök neden (QA-P8b-1), ölçüldü:** Yük altında 60 eşzamanlı talepte 201/429 dışı yanıtların hepsi **500 = Prisma P2028** ("Unable to start a transaction in the given time"). Talep TX'inin ilk ifadesi `tenant_request_settings … FOR UPDATE` (G-E9-10) TX'leri seri kuyruğa sokuyor; havuzdaki 10 bağlantının 9'u kilitte beklerken diğer istekler Prisma'nın varsayılan `maxWait` 2 sn'sini aşıyor. Kanıt: MySQL CPU'su kısılınca (`docker update --cpus 0.03`) 3 turda 17/21/21 × 201, 43/39/39 × 500, logda 121 × P2028; ayar kilidi 3 sn tutulunca eski varsayılanla deterministik kırmızı (yeni testte doğrulandı).

**Düzeltmeler**
- `src/lib/db.ts`: `transactionOptions` = `TX_OPTIONS {maxWait 8 sn, timeout 15 sn}`; seri kuyruklu talep oluşturma TX'i için `SERIAL_TX_OPTIONS {20 sn, 30 sn}`; havuz `acquireTimeout` varsayılanı 20 sn (URL'de verilmişse ona uyulur). `isTransientDbError`: P2028, P2034, MySQL 1205/1213/45028.
- `src/lib/errors.ts`: geçici DB çekişmesi → **503 `NOT_READY` + `Retry-After: 5`**, mesaj "Sunucu şu an yoğun…", `warn` log `alarm:"db_busy"` (stack/SQL yok). 429 yerine 503 seçildi: istemci hatası değil, karar verilmedi ve TX geri alındı; Go istemcisi 503'ü zaten `Retryable()` sayıyor. `mimari-api.md` hata tablosuna (`NOT_READY` satırı) işlendi. **Sözleşme değişikliği:** tüm uçlar aşırı yükte 500 yerine 503 + `Retry-After` dönebilir.
- `src/requests/repo.ts` + `service.ts`: kilit altındaki 4 sayım + kod listesi (5 sorgu) tek `pendingSnapshot` sorgusuna indirildi (≤ 50 satır, `(tenant_id,status)` indeksi). Davranış aynı; TX gidiş-dönüşü 10 → 6.
- S8b-1 `notify/whatsapp.ts`: `fetch(..., { redirect: "error" })`; `FetchLike` tipine `redirect` eklendi.
- S8b-2 `signaling/admit.ts` + `ws.ts`: `admitRequestGuest(rooms, room, guest, peer, ctx)`. `room.admitting` ilk await'ten (teknisyen sorgusu) önce kurulur; `guest.peer` yalnız admit kazanılınca atanır. Admitting/admitted iken gelen ikinci bağlantı yalnız kendi soketini `1008 conflict` ile kapatır (`session.ended` gönderilmez, oturum diğer bağlantıda sürüyor). Ret/zaman aşımı kendi soketine gider. Soket admit sürerken kapanmışsa kazanıldıktan sonra `detachGuest` uygulanır. Yan etki: admit öncesi talep misafirinin mesajları artık policy-close yerine yok sayılır (`guest.peer !== peer`).
- S8b-3 `requests/service.ts`: `request.created` newValue = `{ clientVersion }`. IP yalnız audit `ip_address` sütununda.
- QA-P8b-11 `admit.ts`: talep yolunda `guest.admitted` newValue = `{via, requestId, acceptedBy, guestKind, consentTextId, consentSha256}`, ad yok. Kod yolu (P3/P4) değişmedi. Geçmiş zaman çizelgesi adı `support_sessions.customer_name`'den alıyor (`history.ts` geri dönüşü).
- S8b-4 `requests-p8b-4.test.ts`: deviceKey sabitleri `fakeDeviceKey()` ile (randomBytes, base64url 22) üretiliyor.
- AC-147 `requests/routes.ts`: accept/reject `support_requests.view` + `.accept` ister. AC-148 `requests/panel.ts` `rejectRequest`: `auth.user.tenantId !== tenantId` → 403 ("Talep yalnız kendi firmanızda reddedilebilir."). `requests-p8b-5.test.ts`'teki iki `it.fails` testi `it` yapıldı (AC-147 testine accept 403 + PENDING assert'i eklendi).
- Bekleyen sınır audit'i: `request.rate_limited` kovası/anahtarı ayrıştı. IP başına 3 → `{bucket:"pending.ip", keyType:"ip"}`, önek başına 10 → `{bucket:"pending.prefix", keyType:"prefix"}`, tenant → `pending.tenant/tenant`.
- Test kararlılığı: `vitest.config.ts` `testTimeout` 60 sn ve `expect.poll` tavanı 10 sn; `helpers/ws.ts` `waitFor` varsayılanı 10 sn. Bunlar yalnız tavan, koşul sağlanınca hemen dönüyor. `signaling-rooms.test.ts` 50 turlu üç yarış testi 60 sn; `requests-p8b-2.test.ts` 300/sa testi 60 sn ve poll'ları 30 sn.

**Yeni testler:** `test/integration/db-busy-p8b.test.ts` (kilit 3 sn tutulurken 60 eşzamanlı → 50×201 + 10×429, 5xx yok; havuz dolu → 503 + Retry-After, gövdede SQL/stack yok). `test/integration/security-p8b-fix1.test.ts` (S8b-1 307 → başarısız ve hedefe istek yok; S8b-3; QA-P8b-11; S8b-2 eşzamanlı iki /ws/guest, admit TX'i oturum satırı kilidinde bekletilerek deterministik; pending.ip/pending.prefix audit'i).

**Bağımlılık:** yok.

**Test (geçici MySQL `rs-mysql-test-p8bfix`/33347):** `pnpm -r run lint` temiz · `typecheck` temiz · unit contracts 50, web 158, server 276 · `test:int` (yük yokken) **33 dosya, 292/292**.
**Kararlılık (test:int ‖ e2e, 3 tur, son seri):** e2e 188/187/187. Kırmızılar p7-control ve p5-collab zamanlama testleri; bunlar bu turun kapsamı dışında. test:int sonuçları 290/289/**292** oldu. Kalan kırmızılar iki AC-143 ani yığılma testi (60 talep) ve bir kez 300/sa. Bu koşularda host yük ortalaması **45–53** idi (14 çekirdek; makinede başka ajanların koşuları da vardı). Yanıtların bir kısmı artık **kontrollü 503 + Retry-After** dönüyor (9–17 adet), **500 hiç yok**. QA'nın "3 koşuda yeşil" şartı bu yük düzeyinde **karşılanmadı**. Yük yokken ve orta yükte (yalnız e2e ‖ AC-143) 3/3 yeşil. Daha uzun beklemeyle zorlamak müşteriyi 20 sn'den fazla bekletir, bu yüzden tercih edilmedi.

**frontend-dev için:** 503 `NOT_READY` (+`Retry-After`) artık "yoğunluk" anlamına da gelebilir. Talep reddinde Super Admin 403 alır (accept ile aynı mesaj kalıbı).

### Backend P8b-1 — düzeltme turu 2 (backend-dev, 2026-11-12)
Kapsam: güvenlik "P8b-1 — Tur 2" S8b-5, S8b-6; QA Tur 2 Öneri 1. Yeni iş açılmadı.

**S8b-5 — talep oluşturma havuzu tüketmesin**
- Yeni `src/lib/gate.ts` `ConcurrencyGate`: süreç içi kapı (tek instance, ADR-0005). Anahtar başına ve toplamda eşzamanlı iş sınırı, FIFO kuyruk (başka anahtarın sınırına takılan bekleyen atlanır), kuyruk üst sınırı (dolunca hemen `GateBusyError("full")`), bekleme süresi (aşılınca `"timeout"`). Bekleyen iş DB bağlantısı tutmaz.
- `src/requests/service.ts`: `REQUEST_GATE = { perKey 2, global 4, maxWaitingPerKey 16, maxWaiting 64, waitMs 5 sn }`. **Tenant kovası + TX döngüsü** kapının içinde. Böylece talepler 10'luk havuzun en çok 4 bağlantısını tutar; panel, giriş ve WS admit için en az 6 bağlantı kalır. Kapı dolunca **503 `NOT_READY` + `Retry-After: 5`** döner (mevcut `DB_BUSY_MESSAGE`). Tenant saatlik kovası tüketilmez, çünkü sayım kapının içinde yapılıyor. Metrik `rs_request_gate_rejected_total{reason=full|timeout}` artar. Log `alarm:"request_gate_busy"` (tenantId + reason; PII yok; 10 sn'de en çok 1). `RequestServiceDeps.gate?` yalnız test içindir.
- `src/lib/db.ts`: `SERIAL_TX_OPTIONS {20 sn, 30 sn}` kaldırıldı. Yerine talebe özel **`REQUEST_TX_OPTIONS {maxWait 3 sn, timeout 10 sn}`** geldi; genel `TX_OPTIONS {8 sn, 15 sn}` değişmedi. Kapı sayesinde kilit kuyruğu en çok 2 TX uzunluğunda olduğundan uzun maxWait'e gerek kalmadı.
- Tasarımdan sapma: yok. Güvenlik raporunun önerdiği "tenant başına tek uçuşlu kuyruk/semafor" seçeneği uygulandı.

**S8b-6 — hesap kilidi geçici DB hatasında fail-closed**
- `src/auth/repo.ts` `bumpAccountFailures(db, …)` artık **TX dışında** çalışıyor. (1) Sayaç artışı tek atomik `UPDATE`. (2) Kilit ayrı bir koşullu `UPDATE … WHERE failed_window_at IS NOT NULL AND failed_login_count >= limit` ile yazılıyor; etkilenen satır > 0 ise kilidi bu istek başlatmış demektir. Eşzamanlı isteklerden yalnız biri satırı değiştirir, bu yüzden kilit audit'i yine bir kez yazılır (S2-3 değişmezi; `auth-fix1` 25 paralel testi yeşil).
- `src/auth/service.ts` `recordFailure`: sayaç yazılamazsa (hangi hata olursa olsun) **bellek içi yedek kova** `AuthLimits.accountFallback` (kullanıcı id anahtarlı, 20/sa, 15 dk) kullanılır. Kilit kararı = kovanın kendi eşiği **veya** girişte okunan DB sayımı (pencere açıksa) + kova sayımı ≥ 20 (`FixedWindowCounter.block`). `accountWait` yedek kilidi de hesaba katar. Başarılı giriş kovayı sıfırlar. Log `alarm:"auth_fail_counter_fallback"` (userId, code, lockedNow).
- Audit (`auth.login fail`, `auth.locked`) sayaçtan ayrı tek TX'te yazılır. Yazılamazsa `alarm:"auth_fail_unrecorded"` logu düşülür (userId, pairLocked, lockedNow, code; login/IP/şifre yok) ve yanıt yine 401/423 olur. Bu dalda artık 503 dönmüyor, dolayısıyla durum kodundan bir sinyal de çıkmıyor.
- `src/lib/rate.ts`: `count(key)` ve `block(key)` eklendi. `block`, tablo kilitli kayıtlarla doluysa kayıt eklemez (S3-1 kuralı).
- İmza değişikliği (yalnız sunucu içi): `login(db, limits, ctx, log, input, previousToken?)`; `auth/routes.ts` `req.log` geçiyor.

**QA Öneri 1:** `test/helpers/requests.ts` `retryNotReady()` 503'ü `Retry-After` × 40 ms (+ jitter) bekleyerek en çok 30 kez yeniden deniyor; Retry-After başlığı yoksa testi düşürüyor. `requests-p8b.test.ts` AC-143 (60 eşzamanlı) ve `db-busy-p8b.test.ts` AC-143 (kilit 3 sn) testleri bu yardımcıyı kullanıyor. Doğrulanan değişmez: **tam 50×201 + 10×429 QUEUE_FULL, hiç 500 yok**. db-busy testi kapının gerçekten devreye girdiğini de (`retries > 0`) kontrol ediyor.

**Yeni testler**
- `test/unit/gate.test.ts` (4): anahtar/toplam sınırı + FIFO atlama, kuyruk dolu → `full`, bekleme aşımı → `timeout` (sahte saat), hata atan iş yeri serbest bırakır.
- `test/unit/rate.test.ts` (+1): `count`/`block`.
- `test/integration/security-p8b-fix2.test.ts` (6):
  - S8b-5: iki tenant'ta ayar kilidi 4 sn tutulurken 60 eşzamanlı talep sürerken giriş + `/auth/me` **< 2 sn**. Sonunda tümü 201 (30+30 PENDING), hiç 500 yok. **Ayrım kanıtı:** kapı geçici olarak 100/100'e açıldığında aynı test 3,9 sn ile kırmızı oldu.
  - S8b-5: kapı 503'ü `Retry-After: 5` + `NOT_READY` ile dönüyor, gövdede SQL/stack yok, tenant kovası yalnız kabul edilen talepler kadar sayılmış.
  - S8b-6: sayaç ve audit TX'i P2028 ile düşerken 20 hatalı deneme (20 ayrı IP) → 20.'de 423, doğru şifre de 423. Alarm logunda e-posta/şifre/IP yok.
  - S8b-6: DB'de 15 hata + sayaç yazılamıyor → 5. denemede 423. Audit'te tek `auth.locked{scope:account}`.
  - S8b-6: yalnız audit TX'i düşerse sayaç yine artıyor, DB `locked_until` yazılıyor, hiç 503 yok.
  - Başarılı giriş yedek kovayı sıfırlıyor.

**Bağımlılık:** yok.

**Komutlar:** `pnpm -r run lint` temiz · `pnpm -r run typecheck` hatasız · `pnpm -r run test`: contracts 50/50, server 281/281, web 159/159 · `cd apps/server && pnpm test:int` (geçici MySQL 8.4 `rs-mysql-be-p8b1t2:33341`, 9 migration + grants, sonra silindi; yük ort. ~9–13) **34 dosya, 298/298 yeşil**.

**frontend-dev / devops için:**
- Sözleşme değişmedi. `POST /public/requests` aşırı yükte artık daha erken **503 `NOT_READY` + `Retry-After`** dönebilir (eskiden 20 sn'ye kadar bekleyip 503 dönüyordu). İstemci tarafında 503'ün Retry-After'a uyarak yeniden denenmesi P8b-2'nin işi (QA Öneri 2).
- devops: yeni metrik `rs_request_gate_rejected_total{reason}` ve log alarmları `request_gate_busy`, `auth_fail_counter_fallback`, `auth_fail_unrecorded` runbook'un alarm tablosuna eklenebilir. `db_busy` satırı ile birlikte değerlendirilmeli; sürekli artış havuz ya da DB kaynak yetersizliği demektir.

### Backend P8b-1 — düzeltme turu 3 (backend-dev, 2026-11-12)
**QA-P8b-14** (`test/integration/security-p8b-fix2.test.ts`, AC-143/S8b-5): mutlak `elapsed < 2_000` eşiği kaldırıldı. Kapının etkisi artık doğrudan kanıtlanıyor:
- Sabit `sleep(300)` yerine `expect.poll`: kapı dolu (`running === REQUEST_GATE.global`) ve kuyrukta bekleyen var.
- Flood boyunca 5 ms'de bir örnekleme: `max(running) ≤ global`.
- Havuzda boş bağlantı: kilitsiz `SELECT 1` ayar kilitleri **bitmeden** dönüyor (sıra kanıtı). Kapı olmasaydı 10 bağlantının hepsi kilit kuyruğunda kalırdı.
- Giriş + `/auth/me` de kilit bitmeden dönüyor. Zaman eşiği kilit süresine göreli: `elapsed < HOLD_MS - 1000`. Kilit 6 sn olduğu için ayrım korunuyor; kapı olmasaydı ölçülen süre ~6 sn olurdu.
- Ölçümler try/finally içinde. `flood` ve `holds` her durumda `Promise.allSettled` ile bekleniyor. Hata durumunda `AbortController` yeniden denemeleri durduruyor. `retryNotReady` (`test/helpers/requests.ts`) yeni `signal` seçeneğini alıyor: iptal edilince send'den sonra ve beklemeden sonra son yanıtla dönüyor, bu yüzden kapalı app'e istek atılmıyor. Kilit 6 sn olduğundan flood için `attempts: 200` verildi.
- Yeni okunur sayaç: `RequestService.gateLoad` (`{running, waiting}`, `src/requests/service.ts`). Salt okunur ve davranışı değiştirmiyor.
- QA Öneri (`ConcurrencyGate` birim testi): `test/unit/gate.test.ts` önceki turdan beri var (FIFO, full/timeout, kuyruk boşalması; 4 test). Değişiklik yapılmadı.

**S8b-7** (`src/auth/service.ts` kilitli dal): `writeAudit` try/catch içine alındı. Hata durumunda `alarm:"auth_fail_unrecorded"` (userId, `locked:true`, code; login/IP/şifre yok) loglanıyor ve yanıt her durumda 423 dönüyor. Test (`security-p8b-fix2`, "AC-65/S8b-7"): sayaç, TX ve `auditLog.create` düşerken kilitli hesap yanlış/doğru şifreyle 423 (+Retry-After), kilitsiz hesap 401, ghost 401 dönüyor. Hiç 5xx yok, audit gerçekten yazılmamış ve alarm logunda PII yok.

**Bağımlılık:** yok. **Sözleşme değişikliği:** yok.

**Komutlar:**
- `pnpm -r run lint` temiz.
- `pnpm -r run test`: contracts 50/50, server 281/281, web 159/159.
- server ve contracts typecheck hatasız. `apps/web` typecheck, başka bir ajanın şu an yazdığı izlenmeyen `e2e/p8b-op.spec.ts` dosyasında 3 TS hatası veriyor (bu turun kapsamı dışında).
- `test:int` (geçici MySQL 8.4 `rs-mysql-p8b3:33331`, sonra silindi) 4 tam koşu yaptı, hepsi **34 dosya, 299/299 yeşil**, unhandled rejection yok. 3. ve 4. koşular art arda ve `pnpm --filter @remote/web e2e` ile eşzamanlı koştu (yük ort. 13–19). Aynı e2e koşusu: **188 geçti, 68 atlandı, 0 kırmızı**.

## Backend (Go) P8b-2 — Windows istemci 0.9.0: müşteri başlatmalı destek talebi (backend-dev, 2026-11-12)
Kaynak: mimari.md §10 P8b-2, mimari-e9 §13 (r2, bağlayıcı), ADR-0016, ADR-0004 r3 (+ek), ADR-0006 r4 (+ek), mimari-protokol §5.1–5.2,
mimari-api "Destek talepleri". Sunucu/web dosyalarına **dokunulmadı**; sözleşme uyuşmazlığı bulunmadı.

### Değişen / yeni dosyalar (`apps/agent-win`)
| Dosya | Değişiklik |
|---|---|
| `internal/pairing/pairing.go` | `RefFromFileName` (ADR-0006 r4 ifadesi, contracts `REQUEST_FILE_NAME_RE` ile aynı); 8 hane yolu aynen |
| `internal/api/api.go`, `requests.go` | `do()` (GET/POST ortak), `Error.RetryAfter`, resolve gövdesine `clientVersion` (G-E9-4); `TenantInfo` (GET, en çok 3 deneme), `CreateRequest` (yeniden denemesiz), `CancelRequest` |
| `internal/request/` (yeni) | `validate.go` (AC-134, zod eşi), `ws.go` (`/ws/request` strict şema + `Dial` `rs.v1, rs.req.<sır>`), `machine.go` (bekleme durum makinesi, `CANCELLING` yarışı), `policy.go` (503 yeniden deneme, sürüm karşılaştırma, indirme URL'si), `types.go`, `run.go` (firma bilgisi → form → talep), `wait.go` (bekleme, yeniden bağlanma, onay, kapanış ekranları) |
| `internal/remember/` (yeni) | `remember.go` (platformsuz depo: v1 JSON ≤ 4 KB, tmp O_EXCL + bir kez yeniden deneme, rename, unut + boşsa klasör), `dpapi_windows.go` (`CryptProtectData` CurrentUser + `UI_FORBIDDEN` + sabit entropi, `FOLDERID_LocalAppData\NoktaDestek`) |
| `internal/flow/flow.go`, `messages.go` | `RunTicket` (ön-kabul: kod/karşılama/join/lobi yok), `Deps.Admitted` (ilk `hello`'da bir kez), `UI.Connecting`, 426 `CLIENT_OUTDATED` → son ekran (kod modu) |
| `internal/ui/request_windows.go` (yeni), `control_windows.go`, `screens_windows.go` | Firma penceresi + form, engel ekranı, bekleme, onay (ortak `consentDlg`: `denyText`, `logo`), kapanış, `Connecting` |
| `internal/win/win_windows.go` | `OpenURL` (yalnız `https://`), `BM_SETCHECK` |
| `internal/signal/strict.go`, `messages.go` | `DecodeStrict`, `IsISO` dışa açıldı (strict kural tek yerde) |
| `cmd/noktadestek/main.go` | Mod seçimi: firma dosyası → `request.Run`; `OutCodeMode` → `flow.Run`; `OutShare` → `flow.RunTicket` + `Release` |
| `test/trace-check.ps1` | `-Remember on\|off` |

### AC eşlemesi (istemci tarafı)
| AC | Karşılık | Test |
|---|---|---|
| 133 | `pairing.RefFromFileName`; `request.loadInfo` (firma adı/logo yalnız sunucudan, footer sunucu+sürüm+SHA ilk 8, dolandırıcılık uyarısı, "Kötüye kullanımı bildir"); ağ/TLS ayrı mesaj + "Tekrar dene"; `minAgentVersion` → form yok, "Yeni sürümü indir" (`DownloadURL` sabit biçim, `win.OpenURL` yalnız https); 404 → "Bu dosya artık geçerli değil" + yalnız kod yolu | `TestAC133RefFromFileNameMatchesContractsFixture`, `TestAC133InfoProblemsAndCodeMode`, `TestAC133OutdatedBlocksFormAndOpensFixedURL`, `TestAC133OutdatedAndDownloadURL`, `TestAC133TenantInfoGetWithRefNoOrigin`, `TestAC133ResolveOutdatedIsFinal` + Windows elle (≤ 5 sn) |
| 134 | `request.Validate` (ortak fixture `request-form.json`: telefon, ad, açıklama, e-posta); alan bazında hata + sunucu 400 `fields` aynı alanlara | `TestAC134FormMatchesContractsFixture`, `TestAC134ValidateFieldErrorsAndOrder`, `TestAC134BoundaryLengths`, `TestAC134AC164ValidationErrorsFocusFirstField` |
| 135 (form) | KVKK metni + onay kutusu aynı formda; `consentTextId` 400 → firma bilgisi yeniden alınır, "Aydınlatma metni güncellendi" | (run.go `VALIDATION consentTextId` dalı) |
| 136 | Kutucuk varsayılan işaretsiz; yalnız 201 sonrası yazım; `deviceKey` yalnız hatırla açıkken üretilir/gönderilir; hatırlanan bilgiyle açılışta ipucu | `TestAC136SaveLoadOnlyAllowedFields`, `TestAC136CorruptOrForeignFileDeletedSilently`, `TestAC139AC154HappyPathRememberAndShare`, `TestAC136UncheckedSubmitForgetsAndSendsNoDeviceKey` |
| 137 | "Bilgilerimi unut": dosya + tmp + boşsa klasör, form boşalır, "Bilgileriniz silindi"; işaretsiz gönderimde silme | `TestAC137ForgetRemovesFileAndEmptyDir`, `TestAC137ForgetKeepsNonEmptyDir`, `TestAC137ForgetClearsForm` + `trace-check.ps1 -Remember off` |
| 138 | Tek iz `hatirla.bin` | `trace-check.ps1 -Remember on` (Windows elle) |
| 139 | Bekleme ekranı: talep kodu `123 456` büyük punto, "Sırada n. talepsiniz", geçen süre (serverTime−createdAt + yerel), 1 sn yenileme | `TestAC139StateOnlyWhileWaiting`, mutlu yol testi |
| 141 | "Talebi iptal et" → `request.cancel` (+ 4 sn yanıt beklemesi, sonra 1000); pencere kapatma → `request.cancel` + 1000; soket yoksa REST iptal; kopmada 110 sn içinde aynı sırla yeniden bağlanma | `TestAC141WindowCloseSendsCancelThenClose`, `TestAC141CancelTimeoutEndsWithIntent`, `TestAC141ReconnectAfterDropAnd403Ends`, `TestAC141CancelRequest204` |
| 142 | EXPIRED → "Talebiniz zaman aşımına uğradı" + "Yeniden talep oluştur" (form dolu) | `TestAC142ExpiredRecreateKeepsForm`, `TestAC142AC157ClosedViews` |
| 154 | `request.accepted` → onay diyaloğu (ortak `consentDlg`: odak "Vazgeç", 1,5 sn kilit, Enter/Space paylaşmaz, yalnız donanım tıklaması + enjekte uyarısı, imleç dışında, `FlashWindow`); teknisyen adı, doğrulama kodu, talep kodu, kalan süre; "Ekranımı paylaş" → `/ws/guest` ticket; `/ws/request` **hello gelene kadar açık** kalır (öncesinde 1000 sunucuda vazgeçme sayılır); `CANCELLING`'de gelen kabul yok sayılır + `request.decline` | `TestAC154AcceptedThenShare`, `TestAC154ShareIgnoredBeforeAccept`, `TestAC154CancellingIgnoresLateAccept`, `TestAC154DeclineAndWindowCloseWhenAccepted`, `TestAC154CancelRaceDeclinesLateAccept`, `TestAC154WsRequestMatchesContractsFixture`, `TestAC154AC156RunTicketSkipsLobbyAndSignalsAdmitted` |
| 155 (istemci) | Kalan süre 0 → "Bağlantı süresi doldu", soket **1001** ile kapanır (sunucu CONNECT_FAILED yazar, "müşteri vazgeçti" değil) | `TestAC155TicketExpiry` |
| 156 | `RunTicket` sonrası P7 yolu değişmeden (`session.run`) | `TestAC154AC156RunTicketSkipsLobbyAndSignalsAdmitted` + mevcut P7 testleri |
| 157 | REJECTED → "Firmanızın mesajı:" + düz statik metin (`SS_NOPREFIX`, bağlantı değil) | `TestAC142AC157ClosedViews` |
| 161 | Ad eşleşmezse 8 hane / elle kod akışı aynen; mevcut tüm Go testleri değişmeden yeşil (yalnız resolve gövde testi `clientVersion` için güncellendi) | `TestAC161FileNameModesAreDisjoint`, tüm `go test ./...` |
| 162 | "Teknisyenden kod aldım" (form, engel ekranları) → `flow.Run(ctx, deps, "")` | main.go + Windows elle |
| 163 | Kurulum/servis/tepsi yok; bekleme penceresi kapatma → iptal + süreç sonu (`OutClose` → `exitOK`) | `TestAC136UncheckedSubmitForgetsAndSendsNoDeviceKey` (kapatma yolu) + Windows elle |
| 164 | Tab sırası = oluşturma sırası ((varsa) kötüye kullanımı bildir → ad → telefon → e-posta → açıklama → metin → onay → hatırla → unut → Destek iste → kod → kapat); Enter = "Destek iste" (`BS_DEFPUSHBUTTON`, açıklama `ES_WANTRETURN`'süz); hatada ilk hatalı alana odak | `TestAC134AC164ValidationErrorsFocusFirstField` + Windows elle |

### S8b-8 — 503 NOT_READY yeniden deneme mantığı (`internal/request/policy.go`)
Sunucu IP/önek kovalarını (5/sa/IP) talep kapısından **önce** tüketir; her otomatik deneme müşterinin saatlik kotasını yer.
- Yalnız **503 + `NOT_READY`** (yazma geri alınmış, karar yok) otomatik denenir. Ağ hatası, 502/504 ve diğer her yanıt **denenmez**: talep oluşmuş olabilir; ikinci deneme 409 `REQUEST_PENDING`/kota tüketir. Müşteri "Destek iste"ye yeniden basabilir.
- En çok **2 deneme** (1 otomatik tekrar) → kotanın en çok 2/5'i.
- Bekleme `Retry-After` (yoksa 5 sn), 1..15 sn'ye kırpılır, + 0..1 sn `crypto/rand` jitter (eşzamanlı istemciler aynı anda dönmesin). Beklerken formda "Sunucu şu an yoğun, birkaç saniye içinde yeniden deneniyor…".
- GET `/public/requests/tenant` (yan etkisiz, `req.info` 60/dk) resolve gibi ağ/502–504'te en çok 3 deneme.
- Sunucu tarafı düzeltmesi (kapı 503'ünde kova iadesi, tenant kovası `add`'inin commit sonrasına alınması) **yapılmadı** — `docs/gereksinimler-sonra-acik.md` S8b-8 satırında backend için açık kalır.

### Tasarımdan sapmalar / yorumlar (gerekçeli)
1. **Hatırlanan bilgiyle açılışta kutucuk işaretli gelir.** AC-136 "varsayılan işaretsiz" = önceki tercih yokken. Dosya varsa müşteri daha önce kendisi işaretlemiştir; işaretsiz gelseydi her gönderim (AC-137 kuralıyla) dosyayı silerdi ve hatırlama hiç çalışmazdı. İlk açılışta ve "unut" sonrası işaretsiz. qa/güvenlik aksini isterse tek satır (`run.go` `Run` içinde `Remember: true`).
2. **Firma penceresi ile form tek pencere.** AC-133'teki birincil "Destek iste" formun gönder düğmesidir; ayrı ara pencere tıklama sayısını artırırdı.
3. **"Bilgilerimi unut" düğmesi her zaman görünür** (dosya yoksa da zararsız); ipucu satırı yalnız hatırlanan veriyle açılışta.
4. **Yeniden bağlanma penceresi 110 sn** (sunucunun 120 sn kopma süresinin altında), 2 sn aralık; upgrade 403 → "Talebiniz artık geçerli değil", 426 → eski sürüm ekranı, 4409/1008 → kesin son.
5. **Onay süresi dolumunda 1001** ile kapanış (yukarıda AC-155). Pencere kapatma/Vazgeç 1000 + `request.decline` (§13.3).
6. **Görev çubuğu yanıp sönmesi** mevcut `win.FlashWindow` (FlashWindow) ile; `FlashWindowEx` için yeni bağlama eklenmedi (aynı etki, tek çağrı).
7. Sunucu `tenant.logoUrl`'i şu an hep `null` döndürür → sistem logosu (Nokta) gösterilir; logo gelirse mevcut `api.Client.Logo` kuralları (köken, PNG/JPG, ≤ 2 MB, 3 sn) uygulanır.
8. `signal.DecodeStrict` / `signal.IsISO` dışa açıldı: `/ws/request` aynı strictObject kuralını kopyalamadan kullanır.
9. `remember` yazımında `MoveFileExW` yerine `os.Rename` — Go'nun Windows uygulaması zaten `MoveFileEx(MOVEFILE_REPLACE_EXISTING)`; depo böylece macOS/Linux'ta birim testlenir. DPAPI `x/sys/windows` (`crypt32.dll` `NewLazySystemDLL`, G-08).

**Bağımlılık:** yeni bağımlılık **yok** (go.mod/go.sum değişmedi). Lisans değişikliği yok.

**frontend-dev / sunucu için sözleşme notu:** değişiklik yok. İstemci resolve gövdesine `clientVersion` gönderir (sözleşmede zaten opsiyonel). İstemci `request.cancel`'ı yalnız PENDING'de, ACCEPTED'de `request.decline` gönderir.

### Doğrulama (docker `golang:1.26.11-bookworm@sha256:dc40a1…`, `GOFLAGS=-mod=readonly`)
- `go test -count=1 ./...` → 17 paket **ok**; `go test -race ./internal/request/` ok.
- `go vet ./...` ve `GOOS=windows GOARCH=amd64 go vet ./...` → temiz; `GOOS=windows go test -c` tüm paketler derlenir; `gofmt -l .` boş.
- `build/build.sh https://remote.noktabilisim.net 0.9.0` iki ayrı derleme: SHA-256 **eşit** `94f167d5a7692f28780b2d75d58e07ee6cef17b437b1bd8bbc8cf487c1f59e2e` (12 298 240 bayt).
- `trace-check.ps1` pwsh ile ayrıştırma 0 hata; `Compare-TraceSnapshot -Allowed` birim denemesi: on → yalnız `hatirla.bin.tmp` iz, off → `hatirla.bin` iz.

### Windows elle test adımları (kullanıcı / test-operatoru koşacak; Win10 ve Win11 standart kullanıcı)
Hazırlık: staging panelinde Ayarlar → Destek talepleri'nden indirme bağlantısını al; dosya `NoktaDestek-<Firma>-<ref>.exe` adıyla iner. `D:\` gibi taranmayan bir yere snapshot.
1. **İz testi, hatırla kapalı:** `pwsh -File apps\agent-win\test\trace-check.ps1 -Mode Snapshot -SnapshotPath D:\once.json` → dosyayı çift tıkla (UAC çıkmamalı, pencere ≤ 5 sn) → kutucuk **işaretsiz** gönder → panelden kabul → "Ekranımı paylaş" → oturumu bitir → `-Mode Compare -SnapshotPath D:\once.json -ExePath "$env:USERPROFILE\Downloads\NoktaDestek-…exe" -Remember off` → **TEMİZ**.
2. **İz testi, hatırla açık:** aynı akış, kutucuk **işaretli** → `-Remember on` → TEMİZ (tek iz `%LOCALAPPDATA%\NoktaDestek\hatirla.bin`). Dosyayı Not Defteri ile aç: ad/telefon düz metin **görünmemeli**.
3. **Yeniden açılış:** form ad/telefon/e-posta dolu, kutucuk işaretli, "Bu bilgiler size ait değilse: Bilgilerimi unut" ipucu var; açıklama boş.
4. **Bilgilerimi unut:** tıkla → form boşalır, "Bilgileriniz silindi", ≤ 1 sn; `-Remember off` Compare → TEMİZ (klasör de silinmiş).
5. **Başka Windows kullanıcısı:** 2'deki `hatirla.bin`'i başka kullanıcının aynı yoluna kopyala → istemci formu boş açar ve dosyayı siler.
6. **Klavye (AC-164):** fareye dokunmadan Tab ile alanlar sırayla; boş formda Enter → ilk hatalı alana (Ad) odak + alan altında kırmızı hata; doldurup Enter → gönderilir. Kaydı (ekran videosu) test-raporuna ekle.
7. **Firma penceresi (AC-133):** firma adı sunucudaki ad (dosya adındaki etiket değil); alt satırda "Sunucu: remote.noktabilisim.net · Sürüm 0.9.0 · Parmak izi 94f167d5"; dolandırıcılık uyarısı; abuse e-postası tanımlıysa "Kötüye kullanımı bildir".
8. **Ağ / TLS:** ağ kablosunu çek → "Sunucuya ulaşılamıyor" + "Tekrar dene"; (mümkünse) TLS kesen proxy → "Sunucu sertifikası doğrulanamadı".
9. **Bekleme (AC-139/141):** kod `123 456` büyük, "Sırada n. talepsiniz", süre her saniye artar; ikinci bir talep aç-kapat ile sıra ≤ 10 sn'de güncellenir. "Talebi iptal et" → panelden ≤ 3 sn'de kalkar, forma "Talebiniz iptal edildi" ile dönülür. Bekleme penceresini X ile kapat → süreç biter (Görev Yöneticisi), talep ≤ 5 sn'de İPTAL.
10. **Kopma:** beklerken ağı 30 sn kes → "Bağlantı koptu, yeniden bağlanılıyor…" → geri gelince sıra yeniden görünür; 2 dk+ kes → "Sunucuyla bağlantı kesildi" + "Yeniden talep oluştur".
11. **Kabul/onay (AC-154):** panelden kabul → ≤ 3 sn'de onay diyaloğu öne gelir, görev çubuğu yanıp söner; teknisyen adı, 4 haneli doğrulama kodu, talep kodu, kalan süre; odak "Vazgeç"; Enter → **Vazgeç** (paylaşmaz); ilk 1,5 sn "Ekranımı paylaş" devre dışı; uzak masaüstünden (RDP/başka uzak araç) tıklama → kırmızı enjekte uyarısı, paylaşım başlamaz. Yerel tıklama → "Teknisyen bağlanıyor…" → ekran paylaşımı; kontrol için ayrıca izin diyaloğu (AC-156).
12. **Vazgeç:** onayda "Vazgeç" → "Ekranınız paylaşılmadı" + panelde toast "Müşteri bağlantıyı kabul etmedi".
13. **İptal–kabul yarışı:** "Talebi iptal et"e basıp hemen panelden kabul → onay ekranı **çıkmamalı**, talep İPTAL.
14. **Onay süresi:** kabul edip 60 sn bekle → "Bağlantı süresi doldu"; panelde "Müşteri bağlanamadı".
15. **Ret (AC-157):** panelden hazır mesajla reddet → ≤ 3 sn'de "Firmanızın mesajı:" altında düz metin; `&` içeren ret mesajı alt çizgiye dönüşmemeli.
16. **Süre dolumu (AC-142):** tenant bekleme süresini 10 dk yap → süre dolunca "Talebiniz zaman aşımına uğradı" + "Yeniden talep oluştur" → form dolu açılır.
17. **Eski sürüm:** sunucuda `MIN_AGENT_VERSION=0.9.1` → firma dosyası açılınca form yok, "Bu Hızlı Destek dosyası eski" + "Yeni sürümü indir" tarayıcıda `…/request-download?ref=…` açar. Kod modunda (`Destek-<8>.exe`) aynı ayarla "Teknisyeninizden yeni bağlantı isteyin". Sonra ayarı boşalt.
18. **Ref yenileme:** panelde "Bağlantıyı yenile" → eski dosya "Bu dosya artık geçerli değil" + yalnız "Teknisyenden kod aldım".
19. **Kod yolu (AC-161/162):** `NoktaDestek.exe` ve `Destek-12345678.exe` eski akışla (kod → karşılama → lobi kabul kodu) çalışır; firma dosyasında "Teknisyenden kod aldım" → 8 hane girişi → karşılamada firma adı.
20. **İki tenant dosyası** SHA-256 eşit (`certutil -hashfile … SHA256`), `SHA256SUMS` ile aynı.

**Açık kalanlar:** `v0.9.0` etiketi/attestation ve staging ikili yayını (devops), yukarıdaki Windows elle testleri, S8b-8 sunucu tarafı (kova iadesi) — "Sonra" listesinde.

### Backend (Go) P8b-2 — düzeltme turu 1 (backend-dev, 2026-11-12)
Kaynak: `docs/qa-raporu.md` (P8b-2 Tur 1) ve `docs/guvenlik-raporu.md` (P8b-2 Tur 1). Yeni bağımlılık yok; go.mod/go.sum değişmedi.

| Madde | Düzeltme | Dosya | Test |
|---|---|---|---|
| S8b2-1 [Orta] | Saf karar `rememberPlan`: ad **veya** telefon hatırlanandan farklıysa ve müşteri kutuya bu oturumda dokunmadıysa (`Form.RememberChosen=false`) kayıt yok, eski dosya silinir, `deviceKey` gönderilmez. Müşteri kutuyu kendisi işaretlediyse kişi değişince **yeni** `deviceKey`. Arayüz: ad/telefon `EN_CHANGE` (programatik `SetText` hariç) kutuyu, müşteri dokunmadıysa, işaretsize çeker; `BN_CLICKED` → `chosen` | `request/run.go`, `request/validate.go` (`Form.RememberChosen`), `ui/request_windows.go` | `TestAC136RememberPlan`, `TestAC136ChangedIdentityNotSavedWithoutOptIn` |
| QA-P8b2-1 | `remember.NewDeviceKey` (ve test kullanımı) kaldırıldı; tek üretim yolu `request.newKey()` (`clientInstanceId` + `deviceKey`) | `remember/remember.go`, `remember_test.go`, `request/run.go` | mevcut testler |
| QA-P8b2-2 | `forget()` başarısızlığı yutulmuyor: `forgetWarn`, başarılı bir silmeye kadar formda (`Notice` başına) ve bekleme ekranında (`WaitView.Warning`; yeniden bağlanma bildirimiyle silinmez) görünür. "Bilgilerimi unut" başarısızsa "silindi" denmez | `request/run.go`, `request/wait.go`, `request/types.go`, `ui/request_windows.go` | `TestAC137ForgetFailureVisible`, `TestAC137ForgetButtonFailureVisible` |
| S8b2-2 | `/ws/request` dial: her başarısız denemeden sonra (429, ağ hatası dahil) `dialRetryDelay`: 2→4→8→15 sn + 0..1 sn `crypto/rand` jitter; `Retry-After` (upgrade yanıtı, `DialError.RetryAfter`) en az o kadar, ≤ 60 sn; bekleme kalan kopma bütçesini (110 sn < sunucu 120 sn) aşmaz. `api.retryAfter` → `api.ParseRetryAfter` (REST ve WS aynı kural) | `request/policy.go`, `request/wait.go`, `request/ws.go`, `api/api.go` | `TestS8b22DialRetryDelay`, `TestS8b22DialBackoffInWaitLoop` |
| S8b2-3 | Tek süzgeç `request.Display`: satır/paragraf ayırıcı ve sekme → boşluk, diğer Cc/Cf (bidi dahil), U+034F, U+180E çıkarılır. Uygulandığı yerler: `tenant.name` (loadInfo), `technicianName` (boşsa "Teknisyen"), `request.closed.message`, WS `error.message`, REST hata `message`/`fields`. Reddetmek yerine süzme seçildi (kaynak TLS doğrulamalı gömülü sunucu; müşteri engellenmez). Açık onay diyaloğuna **farklı** teknisyen adıyla yeni `request.accepted` gelirse diyalog kapatılıp yeniden açılır (başlık doğru, 1,5 sn kilit yeniden başlar); aynı adla gelirse yalnız gövde güncellenir | `request/validate.go`, `request/ws.go`, `request/run.go`, `ui/request_windows.go`, `ui/screens_windows.go` (`reqAcceptTech`) | `TestS8b23Display`, `TestS8b23ServerTextsSanitized`; başlık yenileme Windows elle |
| QA öneri 2 | `Outcome.Release(ReleaseKind)`: `ReleaseAdmitted` (hello → 1000), `ReleaseAbandoned` (müşteri vazgeçti/sunucu bitirdi → 1000, kopuksa REST iptal), `ReleaseFailed` (hello'dan önce ağ/protokol hatası → **1001**, REST iptal yok). `flow.Outcome.Failed` yalnız `/ws/guest` kurulamadı/koptu/protokol ihlali yollarında true. mimari-protokol §5.1 kapanış semantiğiyle tutarlı: 1001 ACCEPTED talebi değiştirmez, 60 sn sonra CONNECT_FAILED / `connect_timeout` ("Müşteri bağlanamadı") | `request/types.go`, `request/wait.go`, `flow/flow.go`, `cmd/noktadestek/main.go` | `TestAC154ReleaseKinds`, `TestRunTicketDialFailureIsFailed`, flow testlerinde `Failed` iddiaları |
| QA öneri 3 | "Kötüye kullanımı bildir" dolandırıcılık uyarısının hemen ardından oluşturuluyor; Tab sırası belgesi (kod yorumu + AC-164 satırı) güncellendi; açılış odağı yine ad alanı | `ui/request_windows.go` | Windows elle (madde 5 klavye kaydı) |

**Sözleşme:** Sunucu/contracts değişmedi; frontend-dev için değişiklik yok.
**teknik-yazar için:** Kılavuza (S8b2-1) "Hatırlanan bilgilerden ad veya telefonu değiştirirseniz 'Bilgilerimi bu bilgisayarda hatırla' kutusu kendiliğinden kaldırılır; yeni bilgileri hatırlatmak için kutuyu yeniden işaretleyin." cümlesi eklenmeli.
**Windows elle ek adımlar:** (a) hatırlanan veriyle açılan formda adı değiştir → kutu işaretsize düşmeli; yeniden işaretleyip gönder → yeniden açılışta yeni ad; (b) `hatirla.bin`'i başka süreçte kilitli tutup işaretsiz gönder → bekleme ekranında "Bilgileriniz silinemedi…" görünmeli; (c) onay diyaloğu açıkken teknisyen değişimi (ikinci teknisyen yeniden kabul) → başlık yeni adla, kilit yeniden; **aynı adlı teknisyen senaryosu (S8b2-4):** panelde aynı görünen adla iki teknisyen hesabı aç; biri kabul etsin, diyalog açıkken diğeri yeniden kabul etsin → başlık aynı kalsa da diyalog kapanıp yeniden açılmalı, gövdede **yeni** doğrulama kodu görünmeli ve "Ekranımı paylaş" 1,5 sn yeniden devre dışı olmalı; aynı teknisyen ağ kopması sonrası yeniden kabul ederse (aynı ad + aynı kod) diyalog yerinde kalır, kilit yeniden başlamaz.

**Doğrulama** (docker `golang:1.26.11-bookworm@sha256:dc40a1…`, `-mod=readonly`, `GOTOOLCHAIN=local`): `gofmt -l .` boş; `go test -count=1 ./...` 17 paket ok (186 üst düzey PASS, 0 FAIL); `go test -race` (request, remember, flow) ok; `go vet ./...` ve `GOOS=windows GOARCH=amd64 go vet ./...` temiz. `build/build.sh https://remote.noktabilisim.net 0.9.0` iki kez (arada `go clean -cache`) → iki ikili SHA-256 `f3df8585837ca578b26653d6f76277bbdaad30d755ba401ebab6fc699ff49a78` (eşit, 12 304 384 bayt).

### Backend (Go) P8b-2 — düzeltme turu 2 (backend-dev, 2026-11-12)
Kaynak: `docs/guvenlik-raporu.md` S8b2-4 [Düşük] ve `docs/qa-raporu.md` önerisi. Yeni bağımlılık yok; go.mod/go.sum, sunucu/contracts değişmedi — frontend-dev için değişiklik yok.

| Madde | Düzeltme | Dosya | Test |
|---|---|---|---|
| S8b2-4 [Düşük] | Açık onay diyaloğu `TechName + TechVerifyCode` ile eşleştirilir. Saf, platformdan bağımsız karar `acceptDecision(open, cur, next acceptKey)`: diyalog yok/karar verilmiş → aç; aynı ad + aynı kod → gövde yerinde güncellenir; ad **veya** kod farklı → kapat, yeniden aç (1,5 sn kilit yeniden başlar). `reqAcceptTech string` → `reqAcceptKey acceptKey` | `ui/accept.go` (yeni), `ui/accept_test.go` (yeni), `ui/request_windows.go`, `ui/screens_windows.go` | `TestS8b24AcceptDecision`; diyalog davranışı Windows elle (c) |
| QA öneri (sürü etkisi) | Kopmadan sonra (`lost`) ilk `/ws/request` denemesi de `Deps.Jitter(retryJitter)` = 0..1 sn `crypto/rand` jitter bekler (`startDial(start, first)`); ilk bağlantı beklemez; bekleme `wctx` iptaliyle kesilir. Sonraki denemeler mevcut `dialRetryDelay` | `request/wait.go` | `TestAC141ReconnectAfterDropAnd403Ends` güncellendi (ilk bağlantıda `After` çağrılmaz; kopma sonrası tek bekleme = jitter, jitter üst sınırı 1 sn) |

**Doğrulama** (docker `golang:1.26.11-bookworm@sha256:dc40a1…`, `-mod=readonly`, `GOTOOLCHAIN=local`): `gofmt -l .` boş; `go test -count=1 ./...` 17 paket ok (187 üst düzey PASS, 0 FAIL); `go test -race -count=3` (request, ui) ok; `go vet ./...` ve `GOOS=windows GOARCH=amd64 go vet ./...` temiz. `build/build.sh https://remote.noktabilisim.net 0.9.0` iki kez (arada `go clean -cache`) → SHA-256 `eab236227aad20747847cf64999160cafa83e7a56a9b5cbe2d7daf0416b127c8` (iki ikili eşit, 12 305 920 bayt). Windows elle test adımı (c) aynı adlı teknisyen senaryosuyla genişletildi (yukarıda).

## Düzeltme — TURN'süz ilk teklif (siyah ekran) (backend-dev, 2026-11-12)
Küçük hata düzeltmesi (AC gerekmez); kaynak `docs/gereksinimler-sonra-acik.md` "İlk teklifte TURN yok". Yeni bağımlılık yok; contracts/WS şeması değişmedi.

**Neden:** Teknisyen odaya önce girip PENDING bekliyorsa (talepten doğan oturumlar dahil) `hello{tech}` boş ICE listesi taşır (G-01). Admit'te `scheduleActive` teknisyene önce `peer.joined`, sonra `ice.servers` gönderiyordu; konsol `peer.joined` ile hemen `new PeerLink([])` + offer üretiyor, ardından gelen liste `have-local-offer` durumunda restart tetiklemediği için ICE toplama TURN/STUN'suz bitiyordu → farklı NAT'larda siyah ekran.

| Katman | Düzeltme | Dosya | Test |
|---|---|---|---|
| Sunucu | Admit sonrası teknisyene `ice.servers` artık `peer.joined`'dan **önce** gider (G-01 korunur: yine yalnız admit sonrası). `peer.joined`'a iceServers eklenmedi (sözleşme değişmesin) | `apps/server/src/signaling/active.ts` (`scheduleActive`) | `signaling-rooms.test.ts` "AC-112/G-01: teknisyen admit sonrası ice.servers'ı (TURN'lü) peer.joined'dan ÖNCE alır" |
| Web (savunma derinliği) | Saf kapı `iceGate` (`tech-machine.ts`): bu WS bağlantısında admit sonrası ICE listesi (ACTIVE hello veya `ice.servers`) alınmadan gelen `peer.joined` teklifi **erteler**; ilk `ice.servers` ile `startPeer()` bir kez çağrılır. Misafir ayrılırsa bekleyen teklif düşer; WS kopunca kapı sıfırlanır. TURN yapılandırılmamışsa boş liste de "hazır" sayılır (sonsuz bekleme yok). Peer'i teklif sonrası yeniden kurmak yerine erteleme seçildi: eski teklifin `sdp.answer`'ı yeni peer'e düşüp yarış yaratamaz | `apps/web/lib/webrtc/tech-machine.ts`, `apps/web/lib/webrtc/use-tech-session.ts` | `machines.test.ts` "teknisyen ilk teklif kapısı" (4 test: erteleme + tek başlatma, sunucu sırası/boş TURN, ACTIVE hello + misafir dönüşü, bekleyen teklifin düşmesi) |

**frontend-dev için:** sözleşme değişmedi; yalnız admit sonrası mesaj sırası `ice.servers → peer.joined` oldu.

**Doğrulama:** `pnpm --filter @remote/server test` 281/281; `vitest run test/integration` (geçici `mysql:8.4`, `scripts/test-db.sh up`, sonra silindi) 300/300; `pnpm --filter @remote/web test` 163/163; `pnpm -r run typecheck` ve `pnpm -r run lint` temiz.

**E2E mock uyumu (frontend-dev, 2026-11-12):** p7-control.spec.ts masaüstünde 11 hata (`data-share="unknown"`) bu
düzeltmeden kaynaklanıyordu; sorun uygulamada değil, mock'taydı. `e2e/mock-ws.mjs`'te `admitted()` teknisyene önce
`peer.joined` gönderiyordu, `ice.servers`'ı da yalnız lobi admit'inde ve sonra gönderiyordu. P7'nin sahte AGENT yolunda
(`rs.e2eagent.*`) hiç `ice.servers` gitmiyordu, bu yüzden `iceGate` teklifi hiç başlatmıyordu. Mock artık gerçek sunucu
sırasını (`scheduleActive`) izliyor: ilk kabulde (`first`) teknisyene `ice.servers` → `peer.joined`; yeniden bağlanmada
`ice.servers` gönderilmiyor (sunucu da göndermiyor, kapı aynı WS'te açık). Uygulama kodu değişmedi.
Doğrulama: `pnpm --filter @remote/web e2e` (masaüstü + mobil) art arda üç koşuda 201 geçti / 81 atlandı / 0 hata.
Ayrıca makine yükünün yüksek olduğu bir ara koşuda p5/p7/p8-history'de 7 zamanlama kaynaklı hata görüldü; sonraki
üç koşuda tekrarlanmadı.

## DBA (P8c-1) — müşteri firmalar, ref ad alanı, bilgisayar kaydı (dba, 2026-11-12)
- Migration `apps/server/prisma/migrations/20261112120000_p8c_customers` (+ `down.sql`): `customers`, `request_refs` (append-only, Genel ref geri doldurma idempotent), `device_bindings` (`active_session_id` STORED + UQ, revoke CHECK'leri, `ADMIN_REVOKED`), `support_requests.customer_id/binding_id`, `support_sessions.customer_id`, `cancel_reason` += `CUSTOMER_PASSIVE`, `BINDING_REVOKED`. Ayrıntı, sorgu kalıpları ve "Backend-dev için" maddeleri: `docs/db-notlari.md` P8c-1.
- Şema: `apps/server/prisma/schema.prisma` (`Customer`, `RequestRef`, `DeviceBinding`, ilişkiler). `grants.sql`: customers/device_bindings SELECT/INSERT/UPDATE, request_refs SELECT/INSERT. `deploy/mysql/check-app-grants.sh` +50 kontrol. Seed: aydınlatma yeni sürüm, demo Genel ref kaydı, dev örnek müşteri.
- **Sapmalar (mimari-e10 §3'e not düşülmeli — mimar):** (1) bileşik müşteri FK sırası `(tenant_id, customer_id) → customers(tenant_id, id)`, hedef `UQ(tenant_id, id)`. Gerekçe indeks ekonomisi: mevcut `IX(tenant_id, customer_id, …)` FK'yi taşır. (2) Müşteri oluşturmada INSERT sırası `customers` → `request_refs`: FK yüzünden "önce request_refs" uygulanamaz. (3) search_key/name_key için ek CHECK'ler. (4) not CHECK'i `\t`'yi reddeder.
- **Backend-dev yapacak:** PII yazan UPDATE'te `anonymizedAt: null`; `activeSessionId` asla yazılmaz; geçersizleştirmede üç alan birlikte; P2002 hedef adları (`PRIMARY`, `customers_request_ref_key`, `customers_tenant_id_name_key_key`, `device_bindings_active_session_id_key`); seed'deki demo müşteri katlanmış anahtarları contracts `foldKey` gelince ondan üretilmeli.
- Doğrulama: drift 0, up/down/up OK, down koruması test edildi, check-app-grants 261/261, `customers-p8c-db.test.ts` 12/12, test 281/281, test:int 312/312, typecheck/lint temiz.

## P8c-1 — Devops (devops, 2026-11-12)
Kaynak: mimari-e10 §10, §12.1 devops satırı, §15.2 (r2). Env, `docker-compose.yml`, Caddyfile, nginx vhost **değişmedi** (mimariyle uyumlu).
### Değişen dosyalar
- `docs/runbook.md` §13 (yeni): P8c-1 yayın sırası (yedek ve `git pull` ayrı ssh çağrısında, `umask 077` yok + izin kontrolü — P8b-1 dersi), seed/aydınlatma yayın notu (eski sürümle açık karşılama sayfaları join'de 400), `check-app-grants.sh`, ref ad alanı tutarlılık sorgusu, doğrulama curl'leri; geri alma (imaj → `down.sql`, `p8c_down_guard_chk` 3819 davranışı); tek kayıt iptali (`POST /support-requests/:id/revoke-binding`) ve müşteri bağlantısı yenileme/pasif/aktif etki tablosu; sızan dosya/kayıt olay müdahalesi + inceleme SQL'leri; P8c metrik/alarm tablosu; sorun giderme; istemci 0.10.0 yayın satırı. §6 teknisyen yetki listesi ve §8'e umask notu güncellendi; başlık P1–P8c.
- `deploy/staging-users.sh`: `USER_PERMS` += `customers.view customers.create customers.edit customers.delete` (mevcut USER hesabına `INSERT IGNORE`; `perm_key` serbest VARCHAR, sunucu sürümünden bağımsız yazılabilir ama P8c server'ı yayındayken çalıştırılmalı).
### Kararlar
- **CI değişikliği yok:** `ci.yml` zaten `pnpm db:migrate` (yeni migration dahil) → `check-app-grants.sh` (P8c 50 yeni denetim) → `test:int` koşuyor; yeni action/SHA eklenmedi.
- **Metrik panosu:** repoda Prometheus/Grafana yok (P13). Pano/alarm kuralları runbook §13.5'te PromQL olarak; yayında `/metrics` elle okunur. `/metrics` okuma komutu `node fetch` ile (runtime imajı `bookworm-slim`'de `wget`/`curl` yok).
- Mimaride olmayan iki "Bilgi" seviyesi kural eklendi: saatte > 10 `ADMIN_REVOKED` (kötüye kullanım dalgası) ve boşta kalma işinin haftalık SQL kontrolü (730 gün + 1).
### backend-dev için
- mimari-e10 §10 metrikleri `apps/server/src/ops/metrics.ts`'te henüz kayıtlı değil (2026-11-12 bu bölüm yazılırken): `rs_customers_active`, `rs_bindings_issued_total{renewed}`, `rs_binding_invalid_total`, `rs_bindings_revoked_total{reason}`, `rs_requests_created_total{via}` (mevcut sayaç etiketsiz). Runbook §13.1/8 doğrulaması bu beş `# TYPE` satırını bekler. Ayrıca mevcut `Metrics.render()` gauge etiketini yalnız `role` olarak yazıyor; `rs_customers_active` etiketsiz olduğu için sorun yok.
### Doğrulama
- `bash -n deploy/staging-users.sh` OK; sahte `docker` ile kuru çalıştırma: mevcut USER için 14 `INSERT IGNORE` (4 yeni `customers.*` dahil), çıkış 0. Gerçek yığına karşı çalıştırma staging yayınında (§13.1/7).
- Runbook komutları: yedek tek satırı (iç içe tırnak, `chmod 600`, `gzip -t`) ve `/metrics` `node fetch` komutu yerelde sahte hedefle denendi. `down.sql` guard + geri alma provası dba'nın 2026-11-12 geçici DB provasına dayanır (`docs/db-notlari.md` P8c-1 Test); staging'de yayın yapılmadı (istenmedi).

## P8c-1 — Backend (backend-dev, 2026-11-12)

Kapsam: E10 müşteri firmalar + bilgisayar kaydı sunucu tarafı (mimari-e10 §15 r2, mimari-api "Müşteriler ve bilgisayar
kaydı (P8c)", mimari-protokol §6, ADR-0017). Yeni bağımlılık **yok**, yeni env **yok**.

### Uçlar
| Uç | Yetki | Not |
|---|---|---|
| `GET /api/v1/customers` | customers.view | `q` (≥2; ad/yetkili/telefon, Türkçe katlama), `status=active\|passive\|all`, `page`, `pageSize≤100` (vars. 50), `sort=name:asc\|createdAt:desc`; sayaçlar tek `groupBy` |
| `GET /customers/general-link` | customers.view | salt okunur Genel bağlantı |
| `GET /customers/options` | customers.view ∨ support_requests.view ∨ session_history.view | ≤20, `status=active\|all` |
| `POST /customers` | customers.create | 201; ad çakışması 409 `fields.name` |
| `GET/PATCH /customers/:id` | view / edit | PATCH yalnız değişen alanlar; boşaltma (`null`/`""`) |
| `POST /customers/:id/rotate-ref` | edit | yeni ref + müşteri kayıtları CUSTOMER_ROTATED |
| `POST /customers/:id/deactivate` | **delete** | 409 zaten pasif; kayıtlar CUSTOMER_PASSIVE; bekleyenler CANCELLED/CUSTOMER_PASSIVE |
| `POST /customers/:id/reactivate` | edit | **yeni** ref |
| `GET /customers/:id/requests` · `/sessions` | view + support_requests.view · view + session_history.view | vars. 25, yeniden eskiye; oturumlar `historyScope` |
| `POST /support-requests/:id/revoke-binding` | customers.edit | 204; kayıt zaten geçersiz 409; kayıtsız talep 404; bekleyenler BINDING_REVOKED |
| `POST /public/bindings/status` | AGENT (çerezsiz) | `{bindingKey, clientVersion}` → `TenantRequestInfo + customer{name}\|null`; geçersiz/hiç yok → tek 404 `BINDING_INVALID` |
| `POST /public/bindings/revoke` | AGENT | her durumda 204 (oracle yok); etkin satır → FORGOTTEN |
| `POST /public/requests` | — | `ref` (Genel **veya** müşteri ref'i) **ya da** `bindingKey` (tam biri) |
| `POST /sessions` | sessions.create (+ customers.view `customerId` varsa) | `{}` veya `{customerId}`; pasif/başka tenant 404 |
| WS `/ws/guest` | — | ≥0.10.0 AGENT'a hello sonrası `binding.offer`; `binding.request{previousKey?}` → `binding.issued` (yalnız isteyen sokete); oturum başına 3 |

Filtreler: `GET /support-requests?customer=general|<id>` (pending **ve** history sekmesi); `GET /sessions` ve
`/sessions/export.csv` `?customerFirm=none|<id>`.

### Değişen / eklenen dosyalar
- contracts: `src/permissions.ts`, `src/errors.ts`, `src/api/customers.ts` (yeni), `src/api/bindings.ts` (yeni),
  `src/api/requests.ts`, `src/api/sessions.ts`, `src/ws.ts`, `src/ws-request.ts`, `src/labels.ts`, `src/audit.ts`,
  `package.json` (exports), `fixtures/customers.json`, `fixtures/bindings.json` (yeni), `fixtures/ws-request.json`,
  `test/customers-p8c.test.ts` (yeni).
- server yeni: `src/customers/{repo,service,routes}.ts`, `src/bindings/{repo,service,public-routes}.ts`, `src/signaling/binding.ts`.
- server değişen: `src/app.ts`, `src/audit/mask.ts` (customerAuditView, maskEmail), `src/lib/{db,errors,ids,logger}.ts`,
  `src/ops/metrics.ts`, `src/jobs/scheduler.ts`, `src/requests/{hub,jobs,limits,panel,ref,repo,routes,service,ws}.ts`,
  `src/sessions/{history-repo,history,routes,service}.ts`, `src/signaling/{active,handlers,rooms,types}.ts`, `prisma/seed.ts` (yorum).
- testler: `test/integration/customers-p8c-api.test.ts` (yeni, 19), `test/integration/bindings-p8c.test.ts` (yeni, 11),
  `test/unit/customers-p8c.test.ts` (yeni, 4), `test/helpers/{requests,tenant-matrix}.ts`; beklenti güncellemeleri
  aşağıda.

### Metrikler (mimari-e10 §10, devops notu)
`rs_customers_active` (gauge; açılışta + her müşteri yazımı/günlük işte tazelenir), `rs_bindings_issued_total{renewed}`,
`rs_binding_invalid_total`, `rs_bindings_revoked_total{reason}`, `rs_requests_created_total{via=ref|binding}` (mevcut
sayaca etiket eklendi; ad değişmedi → panolar geriye uyumlu, toplam `sum()` ile aynı). Test: bindings-p8c "AC-181".

### Tasarımdan sapmalar / yorumlar (gerekçeli)
1. **Oturum geçmişi müşteri firma filtresi `customerFirm`** (mimari-api `customer` der): P8'deki `customer` parametresi
   misafir adı araması; ad çakışması P8 istemcisini kırardı. Değerler `none|<ULID>`.
2. **`foldKey` noktalamayı korur** ("ŞİŞLİ Ltd." → "sisli ltd."): tekillik ad üzerinde; noktalama atmak "A.Ş." ile "AŞ"
   gibi farklı kayıtları çakıştırırdı. Fixture'da sabit.
3. **`customer.updated` audit şekli** `oldValue = view(eski)`, `newValue = {changed:[...], ...view(yeni)}` — yalnız değişen
   alanlar, K19 izinli liste (kişi/not `<dolu>`, telefon/e-posta maskeli).
4. **Pasife alma audit'indeki `cancelledRequests`** pasife alma TX'inde sayılan bekleyenlerdir; TX sonrası yarışta kalanlar
   60 sn süpürücüde (`sweepCustomerPassive`) CUSTOMER_PASSIVE ile düşer (AC-171 "60 sn içinde").
5. **`ensureSettings` her kayıt verme / müşteri oluşturmada çağrılır** (Genel ayar satırı yoksa oluşturur): §3.4 (2) kilit
   sırası ayar satırını varsayar; Genel ref'i hiç açılmamış tenant'ta da kayıt verilebilsin.
6. **Seed müşteri sabitleri contracts'tan import edilmez** (migrate imajı contracts'a bağımlı olmasın); tutarlılık birim
   testle (`test/unit/customers-p8c.test.ts` "AC-168") doğrulanır.
7. **AC-1..164 test beklentisi güncellemeleri** (AC-193 "değiştirilmeden" maddesine karşı, spesifikasyon gereği):
   - `requests-p8b-5` ve `sessions-history-api-p8` CSV başlığı/satırı: "Kaynak"tan sonra "Müşteri firma" sütunu (AC-179).
   - `security-p8b-fix1` `request.created` newValue: `{clientVersion, via, customerId}` (mimari-e10 §8 audit alanları; IP yine yok).
   - `customers-p8c-db` (dba testi) geri doldurma: `createRequestSettings` yardımcısı artık ad alanına yazdığı için test
     P8b şeklini (ad alanına yazılmamış ref) doğrudan kurar.
   - `tenant-matrix` (AC-69 aracı): 14 yeni uç sınıflandırıldı; 9 `tenant` uç için çapraz-tenant 404 durumu eklendi.
   - `session-history-p8` "ADR-0014 enum CHECK ikili karşılaştırma" sayısı **17 → 19** (düzeltme turu 1'de eklendi, QA 9):
     test şemadaki `CAST(x AS BINARY)` enum CHECK'lerini sayıyor; P8c migration'ı ADR-0014 kuralıyla iki yeni enum CHECK
     getiriyor — `customers_status_chk` ve `device_bindings.revoke_reason` CHECK'i (mimari-e10 §3.1/§3.3, §15.8). Yeni
     şemanın zorunlu sonucu; iddia zayıflamadı (her enum CHECK'in ikili olması şartı aynen, yalnız sayı arttı).
8. **`revoke-binding` yetkisi `customers.edit`** (düzeltme turu 1'de `+ support_requests.view`, B-P8c-3) (talep ekranından; kayıt müşteri varlığı sayıldı) ve hız kovası
   `customersWrite` (kullanıcı başına 30/dk).

### dba notları üzerine (db-notlari "P8c-1")
FK sırası (müşteri ref'inde önce `customers`, sonra `request_refs`), geçersizleştirmede `revoked_at + revoke_reason +
key_hash=NULL` birlikte, PII yazan UPDATE'te `anonymized_at=NULL`, `search_key` `name_key` ile başlar, not alanında `\t`
yasak (CHECK) — servis ve test yardımcısı (`createCustomerRow`) bu sıraya uyar. `active_session_id` hiç yazılmaz
(STORED); eşzamanlı verme `device_bindings_active_session_id_key` P2002'sinde bir kez yeniden denenir.

### Testler (geçici DB `rs-mysql-p8c-be`, port 33320)
| Komut | Sonuç |
|---|---|
| `pnpm -r run typecheck` | contracts, web, server: temiz |
| `pnpm -r run lint` | temiz |
| `pnpm -r run test` | contracts 64/64, web 172/172, server unit 285/285 |
| `apps/server: vitest run test/integration` | **342/342** (iki ardışık koşu). Bir koşuda `requests-p8b-5` AC-159 bir kez düştü, tek başına ve sonraki iki tam koşuda yeşil — paralel dosya yükü kaynaklı kararsızlık, P8c kodu dokunmuyor |

AC-166/176 performans (1.000 müşteri + 10.000 talep, medyan): liste 8 ms, arama 8 ms, `createdAt:desc` 7 ms, talep
müşteri filtresi 6 ms, Genel filtresi 7 ms (tam koşu altında ≤ 34 ms) — sınır 500 ms.

### frontend-dev için (sözleşme)
- Frontend'in "Backend entegrasyonunda kontrol edilecekler" listesindeki maddelerin tümü sağlandı ve testli:
  `request.new`/`SupportRequestItem` her yanıtta `customerFirm`, `viaBinding`, `bindingRevoked`, `staleSource`;
  `?customer=` pending + history; options `status=all|active`; 409 `fields.name`; `POST /sessions` `{}`/`{customerId}`;
  geçmiş ve CSV `customerFirm=none|<id>`; sekme öğeleri `SupportRequestItem` / `SessionListItem`.
- **p7-control.spec.ts masaüstü 11 hata P8c kaynaklı değil**: `packages/contracts/src/ws.ts` geçici olarak HEAD sürümüne
  alınıp spec yeniden koşuldu — aynı 11 test yine düştü (`data-share="unknown"`). P8c ws.ts değişikliği `hello` /
  `share.state` şemalarına dokunmuyor (yalnız `binding.*` eklendi). Muhtemel kaynak: son commit (6701567 "TURN'süz ilk
  teklif") sonrası e2e mock'un (`e2e/mock-ws.mjs`) teknisyene `ice.servers`/TURN akışını sağlamaması; frontend/e2e
  tarafında ayrıca bakılmalı. **Çözüldü:** mock sırası düzeltildi, bkz. "Düzeltme — TURN'süz ilk teklif" / E2E mock uyumu.

## P8c-1 — Frontend (Rotalar) (frontend-dev, 2026-11-12)
Kaynak: `docs/mimari-e10.md` §9 + §15 (r2), `docs/mimari-api.md` "Müşteriler ve bilgisayar kaydı (P8c)", AC-165..180, 194, 195 (panel kısmı). Tipler/şemalar yalnız `@remote/contracts` (`api/customers`, `api/requests`, `api/sessions`, `labels`); web'de alan tanımı yok (`lib/customers/contract.ts` yalnız yeniden dışa aktarım).

### Rotalar
| Yol | Auth | Yetki | Ne yapar |
|---|---|---|---|
| `/customers` | Evet | `customers.view` (menü öğesi de bununla) | Müşteri listesi: Genel bağlantı şeridi (salt okunur, Kopyala), arama (`?q=`, ≥ 2 karakter, 300 ms), durum (`?status=active\|passive\|all`), `?page=` (50/sayfa), Yeni müşteri (`customers.create`), "Müşteriye nasıl gönderilir?" yardım diyaloğu. Super Admin firma seçmeden → "Önce firma seçin" |
| `/customers/[id]` | Evet | `customers.view`; düzenle/yenile/aktif et `customers.edit`, pasife al `customers.delete` | Müşteri detayı: bağlantı (Kopyala, Bağlantıyı yenile), bilgiler, durum eylemleri, sekmeler Talepler (`support_requests.view`) / Oturumlar (`session_history.view`; yoksa kilitli durum). Yok/başka tenant → 404 sayfası |
| `/requests?customer=general\|<id>` | Evet | `support_requests.view` | Kuyruk ve Geçmiş sekmesinde müşteri filtresi (Tümü / Genel / müşteri seç + combobox); kartta firma satırı, kayıtlı bilgisayar rozetleri, "Diğer" menüsünde kayıt iptali (`customers.edit`) |
| `/history?customerFirm=none\|<id>` | Evet | `session_history.view` | Oturum geçmişi müşteri firma filtresi (sorgu adı backend'in `customerFirm`'ü; P8 `customer` misafir adı araması olarak kalır), "Müşteri firma" sütunu; detayda firma (bağlantı `customers.view` ile) |
| `/sessions` → Yeni destek oturumu | Evet | `sessions.create` (+ `customers.view` → müşteri seçimi) | Yetki varsa önce isteğe bağlı "Müşteri firma" combobox'ı (yalnız aktif) + "Oturum oluştur"; yetki yoksa bugünkü gibi anında oluşturur. Oluşan kartta firma adı |
| `/settings/support-requests` | Evet | `settings.edit` | Bağlantı bölümünün adı "Genel bağlantı" (davranış aynı, AC-175) |

### Değişen / eklenen dosyalar (apps/web)
- Yeni: `app/(panel)/customers/{page,loading,customer-list,customer-filters,customer-form-dialog,customers-actions,help-dialog}.tsx`, `app/(panel)/customers/[id]/{page,loading,not-found,customer-actions,customer-tabs}.tsx`, `app/(panel)/requests/{revoke-binding-dialog,request-history,customer-filter}.tsx`, `components/ui/combobox.tsx` (yeni primitif), `components/customer-combobox.tsx`, `components/copy-link.tsx`, `lib/combobox.ts`, `lib/customers/{contract,query,form}.ts`, `lib/customers/customers.test.ts`, `e2e/customers.spec.ts`, `e2e/mock-customers.mjs`.
- Değişen: `app/(panel)/side-nav.tsx` (Müşteriler, `Building2`, Talepler'den sonra), `requests/{page,request-card,request-queue}.tsx`, `sessions/{page,sessions-view,new-session-dialog,created-session}.tsx`, `history/{page,history-filters,history-list}.tsx`, `history/[id]/{page,sections}.tsx`, `components/request-notifier.tsx` (toast "Yeni destek talebi: <ad> — <firma\|Genel>"), `components/ui/dialog.tsx` (`onDismiss`), `lib/history/query.ts` (`customerFirm`), `lib/requests/requests.test.ts` (request.new fixture'ına P8c alanları — sözleşme gereği), `messages/tr.json`, `e2e/{mock-api,mock-requests,mock-sessions}.mjs`, `DESIGN.md` (§4 ikonlar, §6 bileşenler).

### Yetki toggle ekranı (AC-165)
Panelde kullanıcı/yetki toggle ekranı henüz yok (P9). `customers.*` yalnız `packages/contracts/src/permissions.ts` `PERMISSION_MODULES`'a eklendi (backend); P9 ekranı listeyi bu sabitten ürettiğinde elle ekleme gerekmez. Web'de elle tutulan yetki listesi yok (`grep PERMISSION_MODULES apps/web` → yalnız contracts).

### Sapmalar / kararlar
1. **Bileşen testleri:** web'de jsdom/testing-library yok (yeni bağımlılık eklenmedi). Saf mantık (`lib/combobox.ts` klavye, `lib/customers/form.ts` doğrulama/PATCH, `lib/customers/query.ts` URL) Vitest'te; bileşen davranışı Playwright'ta (`e2e/customers.spec.ts`).
2. **Onay diyalogları** mimarideki ayrı `rotate-dialog.tsx`/`status-dialog.tsx` yerine `customers/[id]/customer-actions.tsx` içinde tek `ConfirmDialog` (aynı davranış: `alertdialog`, odak Vazgeç, AC-170/171 metinleri).
3. **Geçmiş "Müşteri firma" sütunu** yalnız sayfada müşterili oturum varsa görünür; filtre etiketi "Kayıtlı müşteri". Neden: AC-193 — P8 testi (`p8-history.spec.ts` AC-61) `columnheader`/`getByLabel("Firma")`'yı alt dize eşleşmesiyle arıyor; değiştirilmeden yeşil kalması için. Kart/detay/CSV firmayı her zaman taşır.
4. **Talepler combobox etiketi** "Müşteri ara" (seçim kutusu "Müşteri firma" ile erişilebilir ad çakışmasın).
5. **Kayıtlı bilgisayar rozeti** §15.7'ye göre nötr (`surface-muted` + `fg`); mevcut P8b "Bilinen kaynak" rozeti yeşil kalır (P8b kapsamı, değiştirilmedi). Kayıtla gelen talepte "İlk kez görülen kaynak" uyarısı gösterilmez (bilinen kaynak sayılır); iptal edilmiş kayıtta uyarı rozeti onun yerini alır.
6. Yeni Destek Oturumu: `customers.view` varken bir adım eklenir (seç → Oluştur); yetki yoksa akış birebir aynı (AC-1..14 testleri değişmedi).
7. Tasarım skill'i (`ui-ux-pro-max`) mevcut; proje DESIGN.md token/primitifleri esas alındı, yeni token eklenmedi.

### Testler
- `pnpm --filter @remote/web typecheck` ✓, `lint` ✓ (0 uyarı), `test` ✓ 172/172 (yeni: `lib/customers/customers.test.ts` — AC-166, 167, 176, 195, combobox klavyesi).
- Playwright: `customers.spec.ts` (kritik akış: müşteri oluştur → bağlantıyı kopyala → talep listesinde müşteri filtresi; form 409/sekme/kaydedilmemiş değişiklik; yenile/pasif/aktif onayları; pano reddi → seçili metin; arama; yardım klavye/Esc + axe açık/koyu (liste, form, detay, yardım); K23 sekme yetkisi; kart menüsünden kayıt iptali; Yeni oturumda müşteri seçimi; 390 px taşma yok) + `p8b-requests`, `sessions`, `p8-history` → 79 geçti, 0 hata.
- **Not:** `p7-control.spec.ts` masaüstünde 11 test `stage data-share` "unknown" ile düşüyor; e2e sahte oturum mock'u eski hâline alınınca da aynı (bu paketin web değişikliğinden bağımsız görünüyor; konsol/sahne dosyalarına dokunulmadı). Backend'in eşzamanlı `contracts/ws.ts` değişikliğiyle birlikte qa'da yeniden koşulmalı.

### Backend entegrasyonunda kontrol edilecekler
- `GET /customers/options` `status=all` filtrede (pasifler dahil), yeni oturumda `status=active`; `q` boşken ilk 20.
- `POST /sessions` gövdesi `{}` veya `{ customerId }`; 404/403 → panel seçime döner.
- `SupportRequestItem`/`request.new` P8c alanları (`customerFirm`, `viaBinding`, `bindingRevoked`, `staleSource`) her yanıtta dolu olmalı — `panelOutboundSchema` strict; eksikse toast/kuyruk tazelemesi sessizce düşer.
- `GET /support-requests?customer=` kuyruk (pending) sekmesinde de uygulanmalı.
- 409 ad çakışması `fields.name` ile dönmeli (yoksa panel `message`'ı ad alanına yazar).
- `GET /customers/:id/requests` öğeleri `SupportRequestItem`; `/sessions` öğeleri `SessionListItem` (teknisyen, `startedAt`, `durationSec`, `source`).
- Geçmiş filtresi parametre adı `customerFirm` (contracts), CSV aynı parametreyi almalı (`exportApiPath` filtreyi taşır).

## P8c-1 — düzeltme turu 1 (backend-dev, 2026-11-12)

Kaynak: `docs/qa-raporu.md` P8c-1 Tur 1 [backend-dev] 1–9, `docs/guvenlik-raporu.md` "E10/P8c-1 — Kod turu 1" B-P8c-1..6.
Durum: **tamam**. Yeni bağımlılık yok, yeni env yok, şema/migration değişikliği yok.

### Madde → yapılan
| Madde | Yapılan |
|---|---|
| B-P8c-1 (Orta) | Talep TX'inde `lockSettings`'ten sonra müşteri `SELECT status … FOR SHARE` (`customers/repo.shareStatus`); ACTIVE değilse ref yolunda tek 404 `REQUEST_REF_INVALID`, kayıt yolunda `BINDING_INVALID` (ikisi de `req.ref_invalid` kovası). Kabul TX'inde müşteri, talep satırından **önce** FOR SHARE ile okunur (pasife alma ile aynı kilit sırası customers → support_requests; bu **kabul yolunda** döngü yok — §15.4 kayıt verme yolu ters sıralı, bkz. düzeltme turu 2 / B-P8c2-2); pasifse kabul yok → talep commit sonrası `CANCELLED(CUSTOMER_PASSIVE)` + 409 `REQUEST_CLOSED`. Pasife alma bekleyenleri artık **kendi TX'inde** iptal eder (kullanıcı aktörlü `request.cancelled` audit), commit sonrası `closedAfterCommit`; süpürücü yalnız yedek |
| B-P8c-2 (Orta) | QA 1–5 testleriyle kapandı (aşağıda) |
| B-P8c-3 | `revoke-binding` = `support_requests.view` + `customers.edit`; web `requests/page.tsx` `canRevoke` ikisini birden arar; mimari-e10 §15.2'ye not |
| B-P8c-4 | `rs_binding_denied_total{reason: stale_source\|inactive\|rate\|no_offer\|browser}`; `stale_source` ve `inactive` için `binding.denied{reason}` audit (oturum başına ≤ 3 istek → sel yok); runbook metrik satırı |
| B-P8c-5 | Biçim dışı `bindingKey`: `/public/bindings/status` ve `/public/requests` → 404 `BINDING_INVALID` + `req.ref_invalid` kovası (yalnız `clientVersion` hatası 400) |
| B-P8c-6 | `cancelledRequests` = aynı TX'te gerçekten iptal edilen sayı (B-P8c-1 ile) |
| QA 8 | `docs/mimari-akislar.md` A7a/A7b/A7c sequence diyagramları |
| QA 9 | P8c-1 Backend "sapmalar" madde 7'ye `session-history-p8` CHECK 17→19 gerekçesi |

### Testlerin yakaladığı gerçek hata (§15.3 eşzamanlı istek)
Eşzamanlı iki `binding.request` testinde ikinci istek `INTERNAL` alıyordu. Nedenler: (1) iki TX aynı boş
`active_session_id` aralığını FOR UPDATE ile kilitleyip INSERT ettiğinden InnoDB kilitlenmesi (1213) — yeniden deneme yalnız
P2002'yi kapsıyordu; (2) yeniden denemede `lockActiveOfSession` kilitli okumadan sonra satırı `findUnique` ile REPEATABLE READ
anlık görüntüsünden okuyordu, kazananın commit'ini görmüyordu (→ P2002); (3) `renew` Prisma `update` kullanıyordu (MySQL'de önce
anlık görüntüden SELECT → P2025). Düzeltme: yeniden deneme `isTransientDbError`'ı da kapsar; `lockActiveOfSession` /
`lockActiveByHash` sütunları kilitli sorgunun kendisinden döndürür; `renew` tek `updateMany` (count≠1 → hata); müşteri durum
okumaları (`issueTx` §15.4 dahil) kilitli okumadan. Aynı anlık görüntü sorunu `issueTx`'teki eski müşteri durumu kontrolünde de
vardı (FOR SHARE alınıyor ama durum ilk okumanın anlık görüntüsünden bakılıyordu) — `shareStatus` ile kapandı.

### Değişen dosyalar
- server: `src/customers/{repo,service}.ts` (`shareStatus`; ölü `pendingCount` silindi; pasife alma TX içi iptal),
  `src/requests/{service,panel,repo,routes}.ts`, `src/bindings/{service,repo}.ts`, `src/signaling/binding.ts`,
  `src/ops/metrics.ts`, `prisma/seed.ts` + **yeni** `prisma/seed-consent.ts` (aydınlatma seed'i test edilebilir modüle
  taşındı; davranış aynı, migrate imajı `COPY . .` ile alır).
- web: `app/(panel)/requests/{page,request-queue,request-card}.tsx` (görünürlük koşulu + yorumlar). `apps/web/e2e`'ye dokunulmadı
  (mock `revoke-binding` yalnız `customers.edit` bakıyor; e2e kullanıcılarında iki yetki birlikte olduğundan etkisiz).
- docs: `mimari-akislar.md` (A7), `mimari-e10.md` §15.2 notu, `runbook.md` (metrik), bu bölüm.
- test: `test/integration/bindings-p8c.test.ts` (+13 test).

### Eklenen testler (`bindings-p8c.test.ts`)
AC-181 lobi(admit öncesi)/BROWSER/teklifsiz → kayıt yok; AC-181/B-P8c-1 pasif müşteride `inactive` ret; §15.1 (2)(3);
§15.3 sıralı (iki farklı previousKey + anahtarsız) ve eşzamanlı; AC-184 `/ws/request`, `/ws/guest` reconnect/ticket,
`/ws/tech` (TURN kimlik bilgisi yalnız WS `hello`/`ice.servers` ile verildiğinden ayrı REST TURN ucu yok — "TURN ucu" bu WS
yollarıyla sınandı); K20 `req.create.ip` (aynı IP 6. istek 429 + audit) ve `req.create.binding` 6/sa; B-P8c-5; B-P8c-1
kabul yarışı + pasife alma `cancelledRequests` = 2; B-P8c-3 403; AC-192 müşteri ref'li talepten doğan oturumda teknisyenin
`ice.servers`'ı TURN'lü ve `peer.joined`'dan önce; AC-188 seed yeni sürüm (tek tenant üzerinde `seedTenantConsent`; bütün DB'ye
seed koşmak paralel test dosyalarının aydınlatma kimliklerini değiştirirdi). "Reddedilen misafir" ayrı sınanmadı: ret soketi
kapatır, kapalı soketten istek gelemez; admit öncesi yol lobi testiyle kapsanıyor.

### Doğrulama (geçici DB `rs-mysql-p8c-fix`, port 33322 — iş sonunda silindi)
| Komut | Sonuç |
|---|---|
| `pnpm -r run typecheck` | contracts / web / server temiz |
| `pnpm -r run lint` | temiz |
| `pnpm -r run test` | contracts 64/64, web 172/172, server unit 285/285 |
| `apps/server: pnpm run test:int` | **37 dosya, 355/355** (342 + 13); eşzamanlı test ayrıca 3 kez art arda yeşil |

### frontend-dev için
- `revoke-binding` artık `support_requests.view` da istiyor (403 aksi); panel koşulu güncellendi. İsterseniz e2e mock'u
  (`e2e/mock-customers.mjs`) aynı koşula getirin — bu turda e2e'ye dokunulmadı.
- Kabulde müşteri pasifse yanıt 409 `REQUEST_CLOSED` (mevcut kod; yeni kod yok) ve talep `CANCELLED/CUSTOMER_PASSIVE` olarak
  kuyruktan düşer (`request.removed`).

## P8c-1 — düzeltme turu 2 (backend) (backend-dev, 2026-11-12)
Kaynak: `docs/guvenlik-raporu.md` "E10/P8c-1 — Kod turu 2" (B-P8c2-1, B-P8c2-2, gözlem). Sözleşme değişikliği yok.

| Madde | Değişiklik |
|---|---|
| B-P8c2-1 | `test/integration/bindings-p8c.test.ts`: düz metin TURN secret → `FAKE_TURN_SECRET` (`test/helpers/secrets.ts`). Allowlist genişletilmedi. gitleaks v8.30.1 `dir /repo/apps/server --redact --config .gitleaks.toml` → **no leaks found, çıkış 0**. |
| B-P8c2-2 | `customers/service.ts`: `withRefRetry` → `withTxRetry`; ref çakışması (en çok 5) korunur, ek olarak `isTransientDbError` (P2028/P2034, 1205/1213, 45028) için **tek** yeniden deneme. `deactivateCustomer` artık da bu sarmalayıcıdan geçer; `rotateCustomerRef`, `reactivateCustomer`, `createCustomer` aynı sarmalayıcıyı zaten kullanıyordu (geçici hata denemesi onlara da uygulanır — geri alınan TX audit/revoke'u da geri aldığı için çift yazım yok). İkinci geçici hata mevcut davranışla 503 `NOT_READY` + `Retry-After`. Düzeltme turu 1'deki "kilitlenme yok" ifadesi kabul yoluyla sınırlandırıldı: §15.4 yolu (`device_bindings X → customers S`) ile pasife alma/yenileme (`customers X → device_bindings`) arasında 1213 mümkün; iki taraf da artık tek kez yeniden dener. |
| Gözlem (B-P8c-1) | Talep TX'indeki `shareStatus` dalını doğrudan sınayan regresyon testi: `RequestService.prototype.resolveRef` sarılıp peek ACTIVE döndükten sonra müşteri pasife çekilir → 404 `REQUEST_REF_INVALID`, talep satırı yok. |

Sapma: `customers/service.ts` biçimlendirmesi düzenleme sırasında prettier ile (printWidth 200) yeniden yazıldı; davranış farkı yok, yalnız birkaç nesne literali çok satırlı oldu (projede prettier yapılandırması yok, eslint temiz).

Yeni testler (`bindings-p8c.test.ts`, +4): B-P8c-1 TX içi kilitli kontrol; B-P8c2-2 pasife alma ve ref yenileme ilk denemede P2034/1213 → 200 + tek audit; iki ardışık geçici hata → 503 `NOT_READY`, müşteri ACTIVE. Geçici hata, `testDb().$transaction` üzerine `vi.spyOn(...).mockRejectedValueOnce` ile Prisma 7 bağdaştırıcı şeklinde (`P2034`, `meta.driverAdapterError.cause.code = 1213`) enjekte edilir. Mutasyon kontrolü: TX içi `shareStatus` kontrolü ve `TRANSIENT_RETRIES` kapatılınca ilgili 3 test kırmızı.

### Doğrulama (geçici DB `rs-mysql-p8c-fix2`, port 33324 — iş sonunda silindi)
| Komut | Sonuç |
|---|---|
| `apps/server: pnpm typecheck` / `pnpm lint` | temiz |
| `apps/server: pnpm test` | 285/285 |
| `apps/server: pnpm test:int` | **37 dosya, 359/359** (355 + 4) |
| gitleaks `dir /repo/apps/server` | no leaks found, çıkış 0 |

### frontend-dev için
- Değişiklik yok. Pasife alma/yenileme 503 `NOT_READY` artık yalnız iki ardışık geçici DB hatasında döner.


## P8c-1 — düzeltme turu 2 (frontend) (frontend-dev, 2026-11-12)

Kaynak: `docs/qa-raporu.md` Tur 2 "Düzeltilmeli" 1–4 + öneri (mock revoke-binding). Uygulama kodu değişmedi; yalnız e2e, sahte API ve Playwright yapılandırması. Yeni rota yok.

1. **`customers.spec` AC-174/194 kararsızlığı — kök neden: test yarışı (uygulama hatası değil).** Trace + tanılama: `page.goto` `load` olayında döner, ama React 19 Suspense açılışı (`$RC`) ~300 ms kısılır; sayfa içeriği o anda hâlâ `<div hidden id="S:0">` içinde, ekranda `loading.tsx` iskeleti var. `trigger.focus()` gizli düğmede etkisiz, Enter `body`'ye gidiyordu (hata görüntüsünde odak `body`). Açılış sonrası düğme 8/8 ölçümde hidrasyonluydu; kullanıcı gizli düğmeye zaten ulaşamaz. Düzeltme: önce `toBeVisible()`, sonra `toPass` içinde odak doğrulanıp Enter (diyalog açıksa yeniden basılmaz; yalnız yük altında hidrasyon öncesi basılan Enter'ı yineler). `--repeat-each=10 --project=desktop`: **140/140** (AC-174/194 10/10).
2. **AC-166 / AC-178 durum testleri.** `mock-customers.mjs` senaryoları (rqcu yetkileriyle; `mock-requests.mjs` `requestUser`'a eklendi): `rqcuempty` (müşteri yok), `rqcubroken` (liste ve detay Talepler sekmesi ilk istekte 500, sonra 200), `rqcuslow` (aynı uçlar 1,5 sn gecikmeli). Yeni testler: "AC-166: müşterisiz firma — boş durum" (`customers-empty`, yardım + Esc + odak dönüşü, `customer-new-empty` → form), "AC-166/178: hata durumları … Tekrar dene ile toparlanır" (`load-error` + Genel bağlantı şeridi kısmi durum; `customer-tab-error` → yeniden deneme → satır sayısı = detay sayacı), "AC-178: detay sekmeleri boş durumu" (`customer-requests-empty`, `customer-sessions-empty`), "AC-166/178: yükleniyor" (`customers-loading` `aria-busy`, `customer-tab-loading`, ardından içerik).
3. **p5-collab zamanlaması.** (a) `acceptOffer` (:71, TEST-P5-1 ve tüm dosya kabulleri): anlık `toBeDisabled` yerine `watchArm` gözlemcisi (`live()` iki sayfaya kurar) her yeni "Kabul et" düğmesinin DOM'a **kilitli girdiğini** ve kilidin **≥ 1,4 sn** sürdüğünü sayfa saatiyle kaydeder → iddia daha güçlü, yükten bağımsız. (b) AC-41 (:491): `@perf` etiketi + `desktop-perf` projesi — eşik (FPS ≥ 15, 1920 genişlik) aynı; diğer projeler bittikten sonra tek başına koşar. (c) Tam koşularda p5'in diğer testleri de aynı nedenle düşüyordu (AC-39 light: misafir DC 15 sn'de açılmadı; AC-44/46: FPS "—"): `p5-collab.spec.ts` ayrı `desktop-rtc` projesinde, `workers: 3` (proje bazlı sınır), iddialar değişmedi. Toplam süre değişmedi (~1,0 dk).
   - Sapma/not: `desktop-perf` bağımlı projelerden (desktop, mobile, desktop-rtc) biri kırmızıysa "did not run" olur — önce o hata düzeltilir.
4. **AC-176 toast tam metni.** `p8b-requests` AC-149: `toast p` = "Yeni destek talebi: Yeni Müşteri — Genel". Yeni `customers.spec` "AC-176: … toast'ında firma adı (tam metin)": mock kancası `GET /__e2e/rq/newfirm/<çerez>` (firmalı `request.new`) → "Yeni destek talebi: Firma Müşterisi — Şişli Bilişim Ltd." + Görüntüle → kartta firma. Mock notu: `ws-request` `customerFirm` `strictObject {id,name}` — mock önce `status` ekleyince istemci iletiyi (doğru olarak) reddetti; mock sözleşmeye uyduruldu.
5. **Öneri uygulandı:** mock `revoke-binding` sunucu gibi `customers.edit && support_requests.view` ister.

Gözlem (bulgu değil, sonra): boş durumda `CustomersActions` iki kez çizildiği için sayfada iki `customers-help` diyaloğu (başlık + boş durum) var; test boş durum kapsamına daraltıldı. İstenirse tek diyaloğa indirilebilir.

**Değişen dosyalar:** `apps/web/e2e/customers.spec.ts`, `e2e/p8b-requests.spec.ts`, `e2e/p5-collab.spec.ts`, `e2e/mock-customers.mjs`, `e2e/mock-requests.mjs`, `apps/web/playwright.config.ts`.

**Doğrulama:** web `typecheck` / `lint` temiz, `test` 172/172. Tam `pnpm --filter @remote/web e2e` art arda 3 koşu: **206 geçti / 0 kaldı / 67 skip** (×3; skip = mevcut desktop/mobile ayrımı; p5 dosyası artık mobil projede listelenmediği için 85 → 67). AC-41 medyan 30 FPS.


## P8c-2 — İstemci 0.10.0 (backend-dev/Go, 2026-11-12)

Kaynak: `docs/mimari-e10.md` §8, §12.2, §15 (r2; G-E10-5, G-E10-6, G-E10-9), `docs/mimari-protokol.md` §6, `docs/mimari-api.md` P8c Public; AC-181..190, 191 (istemci), 193. Sözleşme sunucu kodundan doğrulandı (`apps/server/src/bindings/*`, `signaling/binding.ts`, `packages/contracts/src/{ws.ts,api/bindings.ts,api/requests.ts}`, `fixtures/bindings.json`).

**İlerleme (çalışma notu):**
- [x] `internal/remember` format v2 + v1 geçişi + `CanonicalOrigin` (`origin.go`) — testler yeşil.
- [x] `internal/api/bindings.go` (status ≤ 3 deneme yalnız ağ/502–504; revoke 2 sn tek deneme), `CreateRequestBody` `ref`/`bindingKey` `omitempty` — testler yeşil.
- **Sapma S1 (G-E10-6):** `golang.org/x/net/idna` kullanılamadı: paket `golang.org/x/text`'i içe aktarır, o modül go.sum'da yok → "yeni modül yok" kısıtını bozar (docker'da `missing go.sum entry … x/text` ile doğrulandı). `CanonicalOrigin` aynı kanonik biçimi (`https://host:port`, küçük harf, sondaki nokta yok, port 443 varsayılan, yol/sorgu/parça/kullanıcı red) üretir; host yalnız ASCII LDH (punycode `xn--` dahil) veya IP. Unicode (IDN) host **reddedilir** → anahtar hiç kullanılmaz/gönderilmez (fail-closed). go.mod/go.sum **değişmedi**. mimar/güvenlik onayına: IDN sunucu adresiyle derlenen ikilide kayıt özelliği kapalı kalır (gömülü adres ASCII).
- [x] `internal/signal`: `BindingOffer`, `BindingIssued` (sıkı; `customerFirmName` zorunlu/null), `BindingRequest` (giden, `previousKey` biçim denetimi) — `fixtures/bindings.json` ile test. Testler artık repo kökü salt okunur bağlanarak koşar (fixture yolu `../../../../packages/...`).
- [x] `internal/flow`: `Deps.Binding` (`BindingHandler`), teklif başına ≤ 1 istek, kayıt alındıktan sonra teklif yok sayılır, istenmemiş `issued` yazılmaz, istek sonrası `error` yutulur (oturum sürer), `Outcome.BindingChanged` (AC-187), `Welcome.RememberNote` (AC-188).
- [x] `internal/request`: `Deps.BindingKey/Registered/Notice/Info/InfoErr/OnBindingInvalid/ForgetComputer`, ana ekran döngüsü (`home.go`), kayıt modunda status + `BINDING_INVALID` (status ve oluşturma) → kaynaksız ana ekran + AC-185, kayıtla talepte `deviceKey` yok, `CUSTOMER_PASSIVE`/`BINDING_REVOKED` genel metin, "Teknisyenden kod aldım" → "Bağlantı kodum var", `Remember` arayüzü v2 kişisel bölüm.
- [x] `internal/launch` (yeni): `Decide` (tablo), `Run` (ağ + depo + akış), `keeper` (`flow.BindingHandler`, DPAPI'ye yazar, AC-187 etiketi) — testler yeşil.
- [x] `internal/ui`: `home_windows.go` (yeni ana ekran), `home.go` (saf Tab sırası + test), form/karşılamada AC-188 satırı, "Bağlantı kodum var", `EndedNote` (AC-187). `cmd/noktadestek/main.go` mod seçimi `launch.Run`'a taşındı. `test/trace-check.ps1 -Binding on|off`. `CHANGELOG.md` 0.10.0.
- [x] Testler + Windows vet/derleme + iki tekrarlanabilir derleme (aşağıda).

### Değişen / yeni dosyalar (`apps/agent-win/`)
| Dosya | Değişiklik |
|---|---|
| `internal/launch/{decide.go, run.go, keeper.go}` (yeni) + `decide_test.go`, `run_test.go` | §8.1 karar tablosu (`Decide`, saf), açılış yürütme (resolve/firma bilgisi bir kez; `onceResolve` ile kod akışına aktarılır), `keeper` = `flow.BindingHandler` (DPAPI'ye yazar, AC-187 etiketi), "Bu bilgisayarı unut" (önce yerel silme, sonra yalnız aynı kökenli anahtarla revoke) |
| `internal/remember/{data.go (yeni), origin.go (yeni), remember.go, dpapi_windows.go, remember_test.go}` | Format v2 (`personal`, `binding`, `deviceKey`), v1 bellekte yükseltme, ilk yazımda v2; `SavePersonal/ClearPersonal/SaveBinding/ClearBinding/ForgetAll`, oku-değiştir-yaz tek kilit; `CanonicalOrigin`; `NoticeText` (AC-188). Entropi değişmedi |
| `internal/api/{bindings.go (yeni), requests.go}` + `bindings_test.go` | `BindingStatus`, `RevokeBinding`; `CreateRequestBody.Ref/BindingKey` `omitempty` |
| `internal/signal/messages.go` + `binding_test.go` | `binding.offer`, `binding.issued` sıkı ayrıştırma; `BindingRequest` |
| `internal/flow/{flow.go, binding.go (yeni), messages.go}` + `binding_test.go` | `Deps.Binding`, `Outcome.BindingChanged`, `Welcome.RememberNote`, `ResolveMessage` |
| `internal/request/{types.go, run.go, home.go (yeni), wait.go, ws.go}` + `home_test.go`, mevcut testler | Ana ekran, kayıt modu, AC-185 yolu, `CUSTOMER_PASSIVE`/`BINDING_REVOKED`, `Remember` v2 arayüzü |
| `internal/ui/{home.go, home_windows.go (yeni), request_windows.go, screens_windows.go}` + `home_test.go` | Ana ekran, AC-188 satırları, düğme metni, oturum sonu notu |
| `cmd/noktadestek/main.go` | Mod seçimi `launch.Run` (161 satır; ≤ 100 hedefi tutmadı: UI/girdi/kısayol kurulumu main'de kaldı, davranış değişmesin diye taşınmadı) |
| `test/trace-check.ps1` | `-Binding on|off` |
Repo kökü: `CHANGELOG.md` (0.10.0), `docs/mimari-e10.md` (S1 uygulama notu). **go.mod / go.sum değişmedi.** Yeni bağımlılık yok.

### Tasarımdan sapmalar (gerekçeli)
- **S1 — G-E10-6 IDNA:** yukarıda. Güvenlik özelliği korunur (anahtar yalnız dize-eşit kanonik kökene); IDN sunucuyla derlenen ikilide kayıt kapalı kalır. mimar/güvenlik onayına sunuldu.
- **S2 — Ana ekran her kaynakta gösterilir** (satır 4 dahil): E9'da firma dosyası doğrudan formu açıyordu; AC-189 "iki yolu tek yerde" gereği önce ana ekran, "Destek iste" ile form (E9 formu aynen). "Yeniden talep oluştur" ana ekrana değil doğrudan forma döner (E9 davranışı).
- **S3 — Satır 3 metni:** kayıt yoksa süresi dolmuş/kullanılmış/iptal/bulunamayan kodda bugünkü mesaj (flow `classify` metni) ana ekranın bilgi satırında, "Destek iste" pasif + "Bağlantı kodum var" etkin. 404 (kod bulunamadı) de bu satıra girer (tablo "404 / 410"); önceki "kod giriş alanına dön" davranışı yerine ana ekran → "Bağlantı kodum var" ile aynı giriş alanı.
- **S4 — `deviceKey` (G-E10-5) "yeniler" uygulaması:** `ClearPersonal` anahtarı siler; bir sonraki hatırlamada `rememberPlan` (değişmedi) yenisini üretir. v2'de `deviceKey` yalnız `personal` ile birlikte bulunabilir (aksi dosya bozuk sayılır).
- **S5 — Kayıt reddi:** istekten sonra gelen ilk `error` (kod ne olursa olsun) kayıt yanıtı sayılır ve yutulur; kayıt alınmadıysa sonraki teklifte (yeniden bağlanma) yeniden istenir (sunucu oturum başına ≤ 3 sınırı korur). İstenmemiş `binding.issued` yazılmaz.
- **S6 — `customerName`** Genel kayıtta dosyaya hiç yazılmaz (`omitempty`), şemadaki `null` yerine.

### Sözleşme (frontend-dev / backend için)
Değişiklik yok. İstemci yalnız mevcut uçları kullanır: `POST /public/bindings/status {bindingKey, clientVersion}`, `POST /public/bindings/revoke {bindingKey}`, `POST /public/requests {bindingKey, …}` (ref'siz, `deviceKey`'siz), `/ws/guest` `binding.request{previousKey?}`. Metinler `fixtures/bindings.json` `messages` ile test edilir.

### Test komutu ve son çıktı
```
docker run --rm -v "$PWD:/repo:ro" -v "$PWD/apps/agent-win:/repo/apps/agent-win" -w /repo/apps/agent-win \
  -e GOFLAGS=-mod=readonly -e GOTOOLCHAIN=local golang:1.26.11-bookworm@sha256:dc40a13b… \
  sh -c 'gofmt -l .; GOOS=windows go vet ./... && go vet ./... && go test -count=1 ./... && for p in $(GOOS=windows go list ./...); do GOOS=windows go test -c -o /dev/null $p; done; go mod verify'
```
(Repo kökü salt okunur bağlanır: signal/request/pairing testleri `packages/contracts/fixtures`'ı okur; yalnız `apps/agent-win` bağlanırsa fixture testleri "no such file" ile düşer.)
Sonuç: gofmt temiz; `GOOS=windows go vet` ve linux `go vet` temiz; 18 paket `ok` (api, capture, config, control, dc, env, files, flow, input, launch, pairing, remember, request, rtc, signal, transfer, ui, win); tüm paketlerin Windows test ikilileri derlendi; `all modules verified`.
Yeni testler: `launch` (karar tablosu 12 satır + 9 akış testi), `remember` (v2, v1 geçişi, ClearPersonal/ClearBinding/ForgetAll, bozuk v2 biçimleri, `CanonicalOrigin` tablo), `signal` (bindings.json fixture), `api` (status/revoke/gövde), `flow` (teklif/istek/issued, teklifsiz, hata yutma, lobide kapanış), `request` (AC-190/182/185/186, ön yüklü bilgi, eski sürüm, kapanış nedenleri, fixture metinleri), `ui` (Tab sırası).

### Derleme (yayınlanmadı)
`apps/agent-win/build/build.sh https://remote.noktabilisim.net 0.10.0 <çıkış>` iki ayrı docker koşusu:
`716e9f983add278e8f6f4049839fb3238f29ebdd6818cefba3838a4edfe62d01` (iki derleme aynı, 12.375.552 bayt). Dosyalar: `/private/tmp/claude-501/-Users-mennan-Projeler-Remote/fa15848a-dcdd-4f1b-abf9-1c72703d5eac/scratchpad/agent-0.10.0/{1,2}/NoktaDestek.exe`. Yayın devops'ta (`v0.10.0` etiketi, SHA256SUMS + attestation; workflow değişikliği gerekmiyor — sürüm etiketten okunur).

### Windows elle test adımları (test-operatoru, staging / prod adresine göre derlenmiş 0.10.0)
1. Temiz profil: `%LOCALAPPDATA%\NoktaDestek` yok. `trace-check.ps1 -Mode Snapshot -SnapshotPath D:\once.json`.
2. **Satır 8 / AC-190:** dosyayı `NoktaDestek.exe` adıyla çalıştır → ana ekran: "Destek iste" pasif, altında "Destek istemek için firmanızın gönderdiği dosyayı kullanın veya teknisyeninizin verdiği kodu girin"; odak "Bağlantı kodum var". Tab: Destek iste (atlanır, pasif) → Bağlantı kodum var → Bu bilgisayarı unut → Kapat. Alt satırda sunucu · sürüm · parmak izi, üstte dolandırıcılık uyarısı.
3. **Satır 1 + AC-181/188:** panelde müşteri seçerek oturum oluştur, `Destek-<kod>.exe` ile aç → karşılamada "Oturumdan sonra bu bilgisayar <firma> için hatırlanır…" satırı. Lobi → kabul → paylaşım başlar. Oturumu bitir. `hatirla.bin` oluştu; `trace-check.ps1 -Mode Compare -SnapshotPath D:\once.json -Binding on` → 0.
4. **Lobide vazgeç (AC-181 negatif):** yeni profilde (veya "Bu bilgisayarı unut" sonrası) kod oturumunda lobide "Vazgeç ve çık" → `hatirla.bin` yok.
5. **Satır 7 / AC-182:** `NoktaDestek.exe` yeniden çalıştır → ≤ 5 sn'de ana ekran, "Bu bilgisayar <firma> – <müşteri> için kayıtlı", "Destek iste" etkin ve odakta; Enter → E9 formu (KVKK onayının üstünde AC-188 satırı). Talep gönder → panelde kart müşteriye düşer, "Kayıtlı bilgisayar — <müşteri>" rozeti. Kabul → "Ekranımı paylaş" → oturum.
6. **Satır 2 / AC-183:** kullanılmış `Destek-<kod>.exe`'yi tekrar çalıştır → kayıt ana ekranı, bilgi "Bu destek bağlantısının süresi doldu."; "Destek iste" ile talep panele düşer.
7. **Satır 5 (K22):** kaydın bağlı **olmadığı** başka bir müşterinin bağlantısını panelden yenile ve o müşterinin eski dosyasını çalıştır (kaydın müşterisini yenilemek kaydı da geçersiz kılar, bu yüzden başka müşteri) → kayıt ana ekranı + "Bu dosya artık geçerli değil; bu bilgisayarın kaydıyla destek isteyebilirsiniz."
8. **Satır 4:** geçerli müşteri dosyası `NoktaDestek-<etiket>-<ref>.exe` → ref ana ekranı (firma adı), talep o ref'in müşterisine düşer.
9. **AC-187:** farklı bir müşteriyle (veya başka tenant'ın koduyla) oturum yap → oturum sonu ekranında sohbet geçmişinde "Bu bilgisayar artık <yeni firma> için kayıtlı."; sonraki açılışta ana ekran yeni firmayı gösterir.
10. **AC-185:** panelde ilgili müşteri için "Bağlantıyı yenile" (veya talep kartından "Bu bilgisayarın kaydını iptal et") → `NoktaDestek.exe` çalıştır → "Bu bilgisayarın destek kaydı artık geçerli değil. Firmanızdan yeni dosya isteyin ya da teknisyeninizin verdiği kodla bağlanın.", "Destek iste" pasif, "Bağlantı kodum var" etkin; hatırlanan ad/telefon sonraki formda hâlâ dolu.
11. **AC-185 (gönderimde):** kayıt ana ekranı açıkken panelden kaydı iptal et, sonra formu gönder → form kapanır, ana ekran AC-185 metniyle.
12. **AC-186:** kayıt + hatırlanan bilgilerle "Bu bilgisayarı unut" → ≤ 1 sn'de "Bu bilgisayar unutuldu"; `%LOCALAPPDATA%\NoktaDestek` klasörü silinmiş; panelde kayıt FORGOTTEN (audit `binding.revoked`). Ağ kapalıyken tekrarla → yerel silme yine olur. Programı kapat, `trace-check.ps1 -Mode Compare -SnapshotPath D:\once.json -Binding off -Remember off` → 0.
13. **"Bilgilerimi unut" (AC-186/137):** formda "Bilgilerimi unut" → kayıt kalır (sonraki açılışta kayıt ana ekranı), ad/telefon silinmiş.
14. **İptal metinleri:** kayıtla açılmış bekleyen talepte panelden müşteriyi pasife al → istemci "Talebiniz kapatıldı / Firmanız bu talebi şu an kabul edemiyor…" (yeniden talep düğmesi yok). Aynısı "Bu bilgisayarın kaydını iptal et" ile (`BINDING_REVOKED`).
15. **AC-193 regresyon:** tarayıcı modu, `Destek-<kod>.exe` ilk açılış (kayıt yok), Genel dosyadan talep, lobi kabul kodu, dosya aktarımı ve uzaktan kontrol 0.9.1 ile aynı davranır; ağ kapalıyken `Destek-<kod>.exe` → bugünkü "Sunucuya ulaşılamıyor" + kod girişi.
16. **AC-192 ölçümü (staging):** müşteri dosyasından ve kayıttan açılan taleplerde farklı NAT'larda 10/10 görüntü, kabulden ilk kareye p95 ≤ 8 sn.


## P8c-2 — düzeltme turu 1 (backend-dev/Go, 2026-11-12)

Kaynak: `docs/qa-raporu.md` P8c-2 Tur 1 "Düzeltilmeli" 1–2 + Öneri 1 (S5); `docs/guvenlik-raporu.md` "E10/P8c-2 — Kod turu 1" B-P8c2-1, B-P8c2-2.

1. **QA-1, AC-188 form satırı koşulu:** `request.Deps.BindingEnabled` eklendi. launch bu alanı `d.Flow.Binding != nil` ile dolduruyor (depo var ve kanonik köken var). Alan kapalıyken `FormView.RememberNote` boş; karşılama ekranındaki kuralla aynı (`request/home.go rememberNote`). Testler: `request.TestAC188FormNoteOnlyWhenBindingEnabled`, `launch.TestNoStoreDisablesBinding`. Bu test genişletildi: depo yok → boş, depo var → dolu, IDN gömülü adres → boş.
2. **B-P8c2-1:** Status yolunda kayıt artık yalnız `ae.Code == "BINDING_INVALID"` ise siliniyor. Kodsuz ya da başka kodlu 404 (geri alınmış sunucu, proxy) kaydı korur ve bugünkü engel ekranını gösterir (`msgNetwork` + "Tekrar dene"). Test: `request.TestBP8c21Status404WithoutCodeKeepsBinding` (`NOT_FOUND`, `UNKNOWN`).
3. **B-P8c2-2:** `flow.onBinding` teklifi yalnız `s.phase == phActive` iken (hello sonrası) işliyor. Lobide ya da yeniden bağlanırken gelen teklif yok sayılıyor. Test: `flow.TestBP8c22OfferInLobbyIgnored`.
4. **Öneri 1 (S5 daraltma):** İstek beklerken yalnız sunucunun kayıt yolunda gönderdiği kodlar yutuluyor: `FORBIDDEN`, `CONFLICT`, `RATE_LIMITED`, `INTERNAL` (`signaling/binding.ts`). Diğer `error` mesajları durum satırında gösterilir. Test: `flow.TestS5OnlyBindingErrorCodesSwallowed`.
5. **B-P8c2-3 (bilgi):** Ek kod gerekmedi. `decodeStrict`, `omitempty` olmayan her alanın JSON'da **bulunmasını** zaten şart koşuyor; `customerFirmName` alanı hiç gelmezse mesaj reddediliyor. Fixture'ın `invalid.serverOutbound[2]` örneği (`customerFirmName` yok) `signal.TestAC181BindingServerMessagesStrict` içinde reddediliyor.

### AC-193 izlenebilirlik — değişen eski testler (QA-2)
Gerekçe: AC-186 ve AC-188, AC-137 ve AC-138'i açıkça değiştiriyor. "Bilgilerimi unut" artık yalnız kişisel bilgiyi siliyor ve kayıt varsa dosya kalıyor. Hatırlama dosyası kişisel bilgi **veya** kayıt nedeniyle bulunabiliyor. Bu yüzden `remember` API'si ikiye ayrıldı: `Forget` → `ClearPersonal` / `ForgetAll`, `Save` → `SavePersonal` / `SaveBinding`. Ayrıca dosya biçimi v2'ye geçti (ADR-0004 r4).

**Assert'i değişen AC-1..164 testi:** Yalnız `TestAC136SaveLoadOnlyAllowedFields`. Değişiklikler:
- Yasak alan araması `"`+anahtar (JSON anahtar adı) biçimine daraltıldı. Nedeni: v2 dosyasında değerler (ör. kayıt sunucusu URL'si) "ref" gibi alt dizeleri içerebilir; arama değer yerine anahtar adına bakmalı. Bu testteki dosyada kayıt olmadığı için iki biçim aynı sonucu verir. Yasak anahtar listesi aynı kaldı.
- `v` beklentisi 1'den 2'ye çıktı.

Diğer testlerde assert'ler aynı ya da daha sıkı.

| Eski test | Yeni test | Değişiklik türü | Assert değişti mi |
|---|---|---|---|
| `remember.TestAC136SaveLoadOnlyAllowedFields` | aynı ad | API uyarlaması (`Save` → `SavePersonal`, `Load` → `LoadPersonal`) + v2 biçim beklentisi | **Evet:** sürüm 1 → 2, yasak anahtar araması tırnaklı |
| `remember.TestAC137ForgetRemovesFileAndEmptyDir` | **geri getirildi** (aynı ad, `ClearPersonal` ile; kayıt yokken dosya + tmp + boş klasör silinir, ikinci çağrı hatasız) + yeni `TestAC186ForgetAllRemovesFileTmpAndEmptyDir` | API uyarlaması | Hayır (aynı üç iddia) |
| `remember.TestAC137ForgetKeepsNonEmptyDir` | aynı ad | API uyarlaması (`Forget` → `ClearPersonal`) | Hayır + ek iddia (dosya silinmiş) |
| `remember.TestGE913StaleTmpRetriedOnce` | aynı ad | API uyarlaması | Hayır |
| `remember.TestAC136CorruptOrForeignFileDeletedSilently` | aynı ad | Tablo genişledi (v2 bozuk biçimleri). `"yanlış sürüm"` vakası **aynı adla geri getirildi** (v1 alanlarıyla `v:2` → reddedilir). İlk turda yalnız adı değişmişti ("v1 biçimi v2 etiketiyle"); içerik aynıydı | Hayır (aynı vakalar + yeni vakalar) |
| `remember.TestSaveRejectsInvalidData` | aynı ad | API uyarlaması + kayıt vakaları | Hayır + ek iddialar |
| `request.TestAC136RememberPlan` (`hardening_test.go`) | aynı ad | Tip uyarlaması (`remember.Data{V:1,…}` → `remember.Personal{…}`) | Hayır |
| `hardening_test.go` diğerleri, `run_test.go` (`memRemember`) | aynı adlar | Sahte depo yöntemleri `Load/Save/Forget` → `LoadPersonal/SavePersonal/ClearPersonal`; tip `remember.Personal` | Hayır (`forgot` sayacı `ClearPersonal`'da artar, iddialar aynı) |
| `request` testlerinin sahte UI'ı (`fakeUI`) | — | `RequestHome` eklendi. Varsayılan dönüş `HomeSupport` (kaynak yoksa `HomeClose`); böylece E9 testleri ana ekrandan doğrudan forma geçiyor (S2) | Hayır |
| `request` sahte API (`fakeAPI`) | — | `BindingStatus` eklendi (arayüz genişledi) | Hayır |
| `flow`, `signal`, `api`, `pairing` eski testleri | — | Değişmedi | — |

### Doğrulama
`gofmt -l .` temiz. `GOOS=windows go vet ./...` ve linux `go vet ./...` temiz. `go test -count=1 ./...`: 18 paketin hepsi geçti. Tüm Windows test ikilileri derlendi. go.mod ve go.sum değişmedi.
Derleme: `build.sh https://remote.noktabilisim.net 0.10.0` iki ayrı docker koşusunda çalıştırıldı, ikisi aynı çıktı:
**SHA-256 `5255edc87840f18b28eb608c705bf2c16230a3a7cb0da49145a46e5ecbf721f3`** (12.376.576 bayt). Dosyalar `/private/tmp/claude-501/-Users-mennan-Projeler-Remote/fa15848a-dcdd-4f1b-abf9-1c72703d5eac/scratchpad/agent-0.10.0-r2/{1,2}/NoktaDestek.exe`. İlk turdaki `716e9f98…` geçersiz.
Elle test adımları değişmedi. Adım 10'a ek olarak: sunucu ya da proxy kodsuz 404 dönerse kayıt korunur ve "Sunucuya ulaşılamıyor" + "Tekrar dene" görünür.

**Değişen dosyalar (bu tur):** `internal/request/{run.go, home.go, home_test.go}`, `internal/flow/{flow.go, binding.go, binding_test.go}`, `internal/launch/{run.go, run_test.go}`, `internal/remember/remember_test.go`, `docs/implementation.md`.
