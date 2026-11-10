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
