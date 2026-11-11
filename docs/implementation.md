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
