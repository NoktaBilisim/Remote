# Implementation notları

## Frontend (P1) — Rotalar

Yazan: frontend-dev · Paket P1 · Uygulama `apps/web` (Next.js 16 App Router, TS strict, Tailwind 4, zod, lucide-react).

### Rotalar

| Yol                | Auth         | Ne yapar                                                                                                                                                                                                    |
| ------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/login`           | Hayır        | Sistem logosu (AC-82) + giriş formu (AC-64). Durumlar: alan hatası, 401 genel hata, 423 kilit, 429, 5xx (+ hata kodu), ağ hatası, gönderimde disabled. `?next=` (yalnız uygulama içi yol), `?reason=expired | logout` bilgi mesajı |
| `/change-password` | Evet (çerez) | Şifre değişimi (AC-66); `mustChangePassword` iken panel yerine buraya yönlendirilir. Yanlış mevcut şifre → alan hatası; 401 → login                                                                         |
| `/`                | Evet         | Panel kabuğu (üst menü: logo, kullanıcı adı/rol/firma, çıkış; kenar çubuğu: Ana sayfa) + boş durum                                                                                                          |
| diğer              | —            | `not-found` (404), `error` (500 + Tekrar dene), panel `loading` iskeleti                                                                                                                                    |

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

| Yol                                          | Auth                     | Ne yapar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/sessions`                                  | Evet (`sessions.view`)   | Oturum listesi: durum rozetleri, kod, oluşturma saati, PENDING için kalan süre geri sayımı; Segmented filtre Tümü/Açık/Bitmiş (sayılı); 10 sn'de bir yenileme (sekme gizliyken yok) + "Son güncelleme"; boş / filtre-boş / iskelet (`loading.tsx`) / hata (Tekrar dene) / yenileme başarısız (uyarı, son veri korunur) / yetkisiz (uyarı). ≥ md tablo, dar ekranda kart. Satırda "kodu kopyala" + "iptal et" (onay diyaloğu, odak "Vazgeç"te; `sessions.delete`). ADMIN/SUPER_ADMIN'de Teknisyen sütunu.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `/sessions` → "Yeni destek oturumu" diyaloğu | Evet (`sessions.create`) | Açılınca `POST /sessions`: iskelet → link (salt okunur, "sonradan tekrar görüntülenemez" notu), oturum kodu `CodeDisplay`, teknisyen doğrulama kodu, Kopyala düğmeleri (toast "Kopyalandı"), geçerlilik geri sayımı + bitiş saati (Europe/Istanbul), "Oturumu iptal et" (onaylı), Kapat. 409 `OPEN_SESSION_LIMIT` → uyarı + sunucu mesajı + "listeden iptal ederek yer açın"; 429 → `Retry-After` dakikası; diğer → hata + Tekrar dene. Süre dolunca / iptalde kopyalama pasif + bilgi.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/session/[token]`                           | Hayır                    | Müşteri karşılama (P2 kısmı). Resolve **sunucuda** (`lib/server-api.ts resolveSessionToken`, `Origin` = `PUBLIC_BASE_URL` origin'i, gövde `{token, clientKind:"BROWSER"}`); başarıda başlık + teknisyen kartı (Avatar baş harf, ad, "Teknisyen · firma", doğrulama kodu) → dolandırıcılık uyarısı (`ShieldAlert`) → "Bağlantı adımları hazırlanıyor" yer tutucu + kalan süre. İstemci yalnız opak `sessionRef` ile 2 sn'de bir `GET /public/sessions/status` yoklar: CANCELLED → "Oturum iptal edildi", EXPIRED (veya yerel süre bitti) → "süresi doldu", ENDED → "sona erdi", 404 → geçersiz; 429'da `Retry-After` kadar bekler. 410 SESSION_EXPIRED/CANCELLED/CONSUMED → ilgili ekran, 429 → "Çok fazla deneme", 5xx/ağ → hata + Tekrar dene. Biçimsiz token (API'ye sorulmaz) ve 404 → **HTTP 404** + müşteri `not-found.tsx` ekranı. `<meta name="referrer" content="no-referrer">` + `robots noindex,nofollow,nocache`; proxy zaten `Referrer-Policy: no-referrer` verir ve `/session/` yolunu `next=`'e yazmaz. Tema: sistem. |

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

| Uç                                             | Girdi                                                    | Başarı                                                                                                                                                                       | Hatalar                                                                                                                                                    |
| ---------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/auth/login`                             | `{ login, password, tenantSlug? }` + `Origin`            | 200 `{ user, mfaRequired:false, mustChangePassword }` + `__Host-rs_session` (HttpOnly) + `__Host-rs_csrf` (JS okunur) çerezleri; ikisi Secure, SameSite=Strict, Path=/, 8 sa | 400 VALIDATION, 401 UNAUTHENTICATED (genel mesaj), 403 CSRF_INVALID (Origin yok/izinsiz), 423 ACCOUNT_LOCKED + Retry-After, 429 RATE_LIMITED + Retry-After |
| POST `/auth/logout`                            | çerez + `X-CSRF-Token` + `Origin`                        | 204, çerezler silinir, oturum revoke                                                                                                                                         | 401, 403 CSRF_INVALID                                                                                                                                      |
| POST `/auth/password/change`                   | `{ current, next (12..200, current'tan farklı) }` + CSRF | 204, `mustChangePassword=false`                                                                                                                                              | 400 VALIDATION (`fields.current` yanlış mevcut şifre, `fields.next`), 401, 403                                                                             |
| GET `/auth/me`                                 | çerez                                                    | `{ user, permissions: string[], tenant: {id,name,slug}\|null, actingTenant: null }`                                                                                          | 401                                                                                                                                                        |
| GET `/health` · `/ready` (kök, `/api` dışında) | —                                                        | `{status:"ok"}` · `{status:"ready", migration}`                                                                                                                              | 503 NOT_READY                                                                                                                                              |

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

| Kontrol                                                                                      | Sonuç                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker compose up -d` (imajlar hazır, boş volume) → server healthy                          | Tur 1: **19 sn**; tur 2 (QA-12 sonrası): **34 sn** (mysql init + migrate dahil; hedef ≤120 sn) — GEÇTİ                                                                                       |
| Servis durumu                                                                                | mysql/server/web healthy, migrate exited 0, caddy up                                                                                                                                         |
| `check-app-grants.sh`                                                                        | **22/22 PASS** (tur 1 ve tur 2)                                                                                                                                                              |
| Server konteynerinde `MIGRATE_DATABASE_URL`                                                  | 0 — GEÇTİ                                                                                                                                                                                    |
| Caddy (https://localhost:4450, `tls internal`) üzerinden seed Super Admin girişi (Origin'li) | 200; tur 2: `__Host-rs_session` HttpOnly+Secure+SameSite=Strict+Path=/, `__Host-rs_csrf` Secure+SameSite=Strict+Path=/, `Domain` özniteliği yok; `mustChangePassword=true`                   |
| `/api/v1/auth/me`                                                                            | 200                                                                                                                                                                                          |
| `POST /auth/password/change`                                                                 | 204; tur 2: yanıtta **yeni** iki `__Host-` çerezi (oturum token'ı değişti); eski çerezle `/auth/me` **401**, yeni çerezle 200                                                                |
| `POST /auth/logout` (gövdesiz, web istemcisi gibi)                                           | 204; tur 2: iki çerez `Max-Age=0` ile silindi (jar'da 0); sonra `/auth/me` 401, logout öncesi token ile de 401                                                                               |
| Yabancı Origin ile login                                                                     | 403                                                                                                                                                                                          |
| 5 hatalı giriş                                                                               | 1–4: 401, 5–6: **423** `ACCOUNT_LOCKED`; kilitliyken doğru parola da 423                                                                                                                     |
| Web `/login` Caddy üzerinden                                                                 | 200; uygulamanın nonce'lu CSP'si korunuyor; HSTS/nosniff/Referrer-Policy var; `Server` ve `X-Powered-By` yok                                                                                 |
| Playwright (tek seferlik betik, repoya eklenmedi), gerçek tarayıcıyla giriş                  | Panel "Ana sayfa" açıldı, konsolda hata 0, çerezler Secure                                                                                                                                   |
| Caddy erişim logu                                                                            | tur 1 (38 satır) ve tur 2 (9 satır): çerez değerleri (eski/yeni oturum, CSRF), `__Host-`, sorgu dizesi, ticket, subprotocol, Cookie, Set-Cookie, Location, parola: 0; `/session/***` maskeli |
| Server logu                                                                                  | parola (eski/yeni), oturum token'ları, ticket, subprotocol: 0                                                                                                                                |

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

| Uç                                                                          | Yetki                  | Yanıt                                                                                                       | Hatalar                                                                                          |
| --------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| POST `/api/v1/sessions` `{}`                                                | sessions.create        | 201 `{ id, link, code, techVerifyCode, expiresAt, status:"PENDING" }`                                       | 403 (yetki / başka tenant'ta açma), 409 `OPEN_SESSION_LIMIT`, 429 `RATE_LIMITED` + `Retry-After` |
| GET `/api/v1/sessions?status=&technicianId=&page=&pageSize=`                | sessions.view          | `{ items: SessionView[], page, pageSize, total }`, sıra createdAt desc, pageSize ≤ 100                      | 400                                                                                              |
| GET `/api/v1/sessions/:id`                                                  | sessions.view          | `SessionView` (link YOK; `code` yalnız PENDING iken)                                                        | 404                                                                                              |
| POST `/api/v1/sessions/:id/cancel`                                          | sessions.delete        | `{ status:"CANCELLED" }`                                                                                    | 404, 409 `CONFLICT` (PENDING değil / süresi dolmuş)                                              |
| POST `/api/v1/public/sessions/resolve` `{ token }｜{ code }` + `clientKind` | public, Origin zorunlu | `{ sessionRef, tenant:{name, logoUrl:null}, technician:{name, avatarUrl:null}, techVerifyCode, expiresAt }` | 400, 403 `CSRF_INVALID`, 404, 410 `SESSION_EXPIRED`/`SESSION_CONSUMED`/`SESSION_CANCELLED`, 429  |
| GET `/api/v1/public/sessions/status?ref=`                                   | public                 | `{ status }`                                                                                                | 404 (geçersiz/sahte ref), 429                                                                    |

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

| Adım                                                                                                   | Sonuç                                                                                                                       |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Servisler                                                                                              | mysql/server/web healthy, migrate 0, caddy up; web=172.30.0.3, caddy=172.30.0.2                                             |
| Seed (`NODE_ENV=development` → demo tenant) + teknisyen (ADMIN, demo tenant, SQL ile test kullanıcısı) | GEÇTİ                                                                                                                       |
| login → POST /sessions → GET /sessions                                                                 | 200 → 201 (link 43 karakter token) → 200 total=1 PENDING                                                                    |
| Müşteri (ayrı konteyner 172.30.0.50, sahte `X-Forwarded-For: 6.6.6.6`) `/session/<token>`              | 200, teknisyen adı sayfada                                                                                                  |
| status?ref                                                                                             | PENDING → cancel 200 → CANCELLED; sayfa "iptal edildi"; geçersiz token 404                                                  |
| Audit `session.resolve` IP                                                                             | web üzerinden gelen resolve **172.30.0.50** (web .3 değil); 6.6.6.6 hiçbir yerde yok                                        |
| Token limiti ayrışması                                                                                 | .50'den 33 istek → limit doldu ("Çok fazla deneme"); aynı anda .51 ve host "iptal edildi" görüyor (limit artık ortak değil) |
| Caddy logu                                                                                             | token 0, `/session/***` maskeli; server/web logunda token 0                                                                 |
| Testler                                                                                                | contracts 2, web 12, server unit 16, server entegrasyon (test-db.sh) 12 dosya/56 test — hepsi geçti; server typecheck temiz |

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

| Senaryo                                                                                      | Audit `ip_address` / `user_agent`                                            |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Caddy üzerinden; istemci sahte `X-Forwarded-For: 6.6.6.6` + sahte `X-Edge-Auth` gönderir     | `172.30.0.128` (Docker Desktop'ta host; Linux'ta gerçek IP) / tarayıcı UA'sı |
| Edge ağından (172.30.0.50) `web:3000`'e doğrudan; `XFF: 9.9.9.9` + yanlış sır                | `172.30.0.3` (web) / gönderilen UA                                           |
| 6.6.6.6 veya 9.9.9.9 audit'te                                                                | 0                                                                            |
| Sır caddy, web ve server loglarında; istemcinin `X-Edge-Auth` başlığı ve token caddy logunda | 0 / 0 / 0                                                                    |

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

| Madde   | Değişiklik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-P3-1  | `ws` 8.18.3 → **8.21.0** (`apps/server/package.json`, `pnpm-lock.yaml`); `pnpm audit`: **No known vulnerabilities**. `signaling/ws.ts` `maxPayload = WS_MAX_PAYLOAD` (64 KB): aşan çerçeve artık ws tarafından **1009** ile kapanır (eski sapma 6 kalktı; handlers.ts'teki 1008 kontrolü savunma olarak duruyor). Sunucu soketine `error` dinleyicisi eklendi (1009 durumunda dinleyicisiz `error` olayı süreci düşürüyordu — entegrasyon testinde "Unhandled Error" olarak yakalandı); yalnız `role` + hata kodu loglanır. |
| S-P3-4  | `expireDue(db, ctx, now, rooms?, batch)` başarılı her expiry'den sonra `rooms.closeSession(id, "timeout")` → teknisyen + lobi `session.ended{timeout}`, oda silinir. `RoomNotifier` reason'a `"timeout"` eklendi; `startScheduler(db, log, rooms?, intervalMs)` (app.ts `rooms` geçirir). `Room.expiresAt` eklendi: ret listesi / hatalı kod taşıyan boş oda yalnız PENDING bitişine kadar tutulur, `timers.idle` ile o anda yeniden kontrol edilip silinir.                                                                |
| S-P3-5  | Tüm sahte secret'lar tek dosyada: `apps/server/test/helpers/secrets.ts` (`FAKE_TURN_SECRET*`, `FAKE_METRICS_TOKEN`); `.gitleaks.toml` allowlist `(^                                                                                                                                                                                                                                                                                                                                                                         | /)apps/server/test/helpers/(app | secrets)\.ts$`(dir ve git modunda eşleşir). gitleaks v8.30.1 dir taraması: 10 bulgu, **hepsi`apps/web/.next/**`** (git-ignore, derleme çıktısı); commit edilecek dosyalarda **0**. |
| S-P3-6  | `TURN_CRED_TTL_MIN` varsayılanı **20** (env.ts, `.env.example` açıklaması). Compose varsayılanı devops tarafından zaten `${TURN_CRED_TTL_MIN:-20}`. **devops:** `docs/runbook.md:181` tablosu hâlâ "60 (5..60)" diyor → 20 olmalı (bu turda runbook'a dokunulmadı).                                                                                                                                                                                                                                                         |
| S-P3-7  | `/ws/tech` upgrade'i IP başına `FixedWindowCounter(31, 60 sn, 60 sn kilit)` — Origin/çerez/DB kontrollerinden **önce**; aşımda 429 (`rs_ws_rejected_total{role="tech",reason="rate"}`). Misafir sayacından ayrı.                                                                                                                                                                                                                                                                                                            |
| QA-P3-1 | Join'de 410 (`SESSION_EXPIRED/CONSUMED/CANCELLED`, `addGuest` içinden gelen `SESSION_CONSUMED` dahil) → audit `session.join` `result=fail`, `newValue {reason}` (token/kod/ad yok). Nonce tek kullanımlık + IP limitli olduğundan tekilleştirme yok.                                                                                                                                                                                                                                                                        |
| QA-P3-2 | Ping/pong testi (pingMs 50, `autoPong:false` soket → 1006 terminate, pong veren soket açık); AC-120 log tarama testi (gerçek `createLogger("trace", sink)`; joinNonce, wsTicket, iki reconnectToken, link token, auth token, admitCode (hatalı kod denemesi dahil) ve alan adları logda yok; sorguda sızmış ticket 403); `signaling.test.ts` test adı AC-18.                                                                                                                                                                |
| QA-P3-3 | `/metrics`: `rs_ws_connections` (gauge, `wss.clients.size`), `rs_active_sessions` (gauge, admit edilmiş ve bitmekte olmayan oda), `rs_resolve_failed_total` → **`rs_resolve_failed`** (gauge; `_total` soneki kaldırıldı). `rs_active_rooms` ve `rs_ws_connections_total` (counter) duruyor. **devops:** alarm/panel bu adı kullanıyorsa güncellenmeli.                                                                                                                                                                     |
| QA-P3-4 | `guest.pending` audit testi (1 kayıt, yalnız `guestId/name/guestKind`, admitCode yok).                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| QA-P3-5 | `rooms.endByTechnician` entegrasyon testi (aynı teknisyenin iki ACTIVE odası: 4 tarafa `session.ended{auth_revoked}`, teknisyene 4401, DB ENDED/SYSTEM/auth_revoked + 1'er audit). Çağıran uç P7/P9'da (S-P3-8).                                                                                                                                                                                                                                                                                                            |

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

| Yol                      | Auth                             | Ne yapar                                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/session/[token]`       | Hayır (token)                    | Karşılama (teknisyen + doğrulama kodu, dolandırıcılık uyarısı + "Kötüye kullanımı bildir", ad + aydınlatma onayı, "Yalnız ekranımı tarayıcıdan paylaş") → lobi (4 haneli kabul kodu, kalan bekleme, "Vazgeç ve çık") → oturum (paylaş/durdur/yeniden paylaş, önizleme, oturumu bitir onaylı) → bitiş/ret/bekleme doldu/bağlantı kesildi ekranları |
| `/sessions/[id]/console` | Evet, yalnız oturumun teknisyeni | Teknisyen konsolu (varsayılan koyu): üst bar (müşteri, durum, kalan süre, doğrulama kodu, bitir/iptal onaylı), sahne (bekleniyor, lobi paneli: kod girişi + kalan hak + satır başına Reddet, bağlanıyor, video, paylaşım durdu, müşteri koptu 120 sn, kendi WS koptu)                                                                             |
| `/sessions` (değişti)    | Evet                             | Satır eylemleri: "Konsolu aç" (PENDING/ACTIVE, yalnız kendi oturumu), "Zorla sonlandır" (ACTIVE, `sessions.terminate`, onay diyaloğu)                                                                                                                                                                                                             |

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

| #   | Bulgu                                                                                                                                                                                                                                                                           | Neden mock saklıyordu                                                                   | Düzeltme                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Teknisyen yeniden bağlanınca paylaşım durumu kayboluyordu: sahne `data-share` "unknown" kalıyor, "paylaşım durdu/bekleniyor" mesajı videonun üstünde. Gerçek server teknisyen dönünce misafire `peer.joined{role:"tech"}` gönderir ama `share.state`'i saklamaz/tekrar iletmez. | Mock teknisyen bağlantısında misafire `peer.joined`/`peer.left` (tech) hiç göndermiyor. | `lib/webrtc/use-guest-session.ts`: `peer.joined{tech}` alınınca paylaşım sürüyorsa `share.state: sharing` yeniden gönderilir (hello'daki mevcut davranışın eşi).                                                                        |
| 2   | Konsol yenilenince müşteri adı "Müşteri"ye düşüyordu: protokolde ad yalnız `peer.pending`'de var; `hello`/`peer.joined` adı taşımaz.                                                                                                                                            | Mock tek oturum içi akışı test ediyordu; yenileme senaryosu yoktu.                      | `use-tech-session.ts` + `tech-machine.ts` (`restoreName`): kabul edilen adın sekme belleğinde (`sessionStorage`, `rs.guestName.<sessionId>`) tutulması, ACTIVE `hello` sonrası geri yüklenmesi, bitişte silinmesi. Birim testi eklendi. |
| 3   | `SessionView` (liste) müşteri adı taşımaz — Admin zorla sonlandırırken hangi satırın hangi müşteri olduğu yalnız teknisyen adı/zamanla anlaşılır.                                                                                                                               | Mock'ta da yok; bilgi notu.                                                             | Kod değişmedi (sözleşmede alan yok).                                                                                                                                                                                                    |

### backend-dev / mimar notu (sözleşme önerisi, bu turda değiştirilmedi)

- `hello` (role tech, ACTIVE) ve `peer.joined{role:"guest"}` mesajlarına opsiyonel `guestName` eklenmesi önerilir: (a) farklı sekme/cihazdan açılan konsolda ad yine "Müşteri" görünür (sessionStorage sekmeye özel), (b) lobide >1 bekleyen varken kabulde ad istemcide bilinmez (kod→misafir eşlemesi sunucuda). Server ayrıca son `share.state`'i odada saklayıp teknisyen `hello`'suna koyabilir; o zaman #1'deki istemci yeniden bildirimi gereksiz kalır (zararsız).
- Server ve contracts tarafında kod değişikliği yapılmadı; server testleri bu yüzden yeniden koşulmadı.
- Server logu tüm koşularda temiz: WS upgrade reddi 0, beklenmeyen 4xx/5xx yok (yalnız AC-12 sınırının 409'u).

### Değişen / eklenen dosyalar

`apps/web/e2e/p4-real.spec.ts` (yeni), `apps/web/playwright.real.config.ts` (yeni), `apps/web/playwright.config.ts` (`testIgnore`), `apps/web/lib/webrtc/use-guest-session.ts`, `apps/web/lib/webrtc/use-tech-session.ts`, `apps/web/lib/webrtc/tech-machine.ts`, `apps/web/lib/webrtc/machines.test.ts`, `DESIGN.md` (§6: Button `danger`/`danger-ghost`, CodeDisplay `xl`, share-strip, stage, lobby-panel, konsol koyu teması; §6.1 "yazıldı").

### Düzeltme turu 1 (Frontend P4) — 2026-11-11

| Madde               | Yapılan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QA-P4-1 / S-P4-2    | `apps/web` devDependency `ws` 8.18.3 → **8.21.0** (server ile aynı), lockfile güncel; `pnpm audit --audit-level high` → "No known vulnerabilities found".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| QA-P4-2 (AC-34)     | Konsol üst barında `live` + `guestKind=BROWSER` iken pasif **Uzaktan kontrol** (`MousePointer2`, `disabled`, `aria-describedby`) + "Müşteri tarayıcı modunda: yalnız görüntüleme" (`console-control`, `console-control-hint`). Kontrol akışı P7.                                                                                                                                                                                                                                                                                                                                                                                          |
| QA-P4-3 (AC-33)     | `lib/device-support.ts` (+birim): `getDisplayMedia` yok **veya** UA-CH `mobile` **veya** yalnız kaba işaretçi (`pointer: coarse` ve `any-pointer: fine` yok) **veya** mobil UA → karşılamada form yerine `guest-unsupported` ("Bu cihaz desteklenmiyor; masaüstü Chrome, Edge veya Firefox kullanın", `MonitorX`). Teknisyen + doğrulama kodu + uyarı görünür kalır; `join-form` render edilmez → lobiye girilemez. SSR'da bilinmez (`useSyncExternalStore` sunucu anlık görüntüsü `null`) → masaüstünde form anında gelir. Mobil axe testi (AC-39) bu ekranı tarar.                                                                      |
| QA-P4-4 (AC-30)     | `NotAllowedError` → danger Alert "Paylaşım başlatılmadı" + açıklama + **Tekrar dene** (`share-retry`, `RotateCw`); stub'lı e2e ilk çağrıyı reddeder, tekrar denemede paylaşım + teknisyende `data-share=sharing`. `p4-real.spec.ts` "REAL AC-30, 59" → "REAL AC-59".                                                                                                                                                                                                                                                                                                                                                                      |
| QA-P4-5 (AC-43)     | `console/stage.tsx`: paylaşım görünürken sağ üstte `Segmented` **Sığdır** (`Expand`, `object-contain`) / **%100** (`ScanSearch`, doğal boyut, `overflow-auto` kaydırma bölgesi `tabIndex=0`, `role=region`) + **Tam ekran** düğmesi (`Maximize`/`Minimize`, `aria-pressed`, `requestFullscreen` sahne bölümüne, `fullscreenchange` dinlenir). `data-mode`, `data-fullscreen`. `ui/segmented.tsx` opsiyonel `icon` aldı (DESIGN.md §6'ya işlendi — düzeltme turu 2).                                                                                                                                                                       |
| QA-P4-8 (AC-38)     | e2e: `/session/<token>` yanıtında `content-security-policy` `frame-ancestors 'none'`; `X-Frame-Options` varsa `DENY`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| QA-P4-9 (AC-26/125) | e2e: karşılama `guest-verify-code` = konsol `console-verify-code` (yeni testId) ve `mailto:` href. Mock'a `B×43` token (resolve `abuseEmail: null`) → "Kötüye kullanımı bildir" bağlantısının gizlendiği e2e (bileşen zaten koşullu render ediyordu).                                                                                                                                                                                                                                                                                                                                                                                     |
| QA-P4-11            | `apps/server/scripts/e2e-real-users.ts` (yeni; seed.ts kalıbı: PrismaMariaDb + argon2id aynı parametre): demo tenant'ta iki ADMIN, `must_change_password=0`, idempotent (varsa parola/kilit sıfırlanır, başka tenant/rolde ise dokunmaz), audit kaydı, `NODE_ENV=production`'da çalışmaz. Komutlar (apps/web/package.json): `pnpm --filter @remote/web e2e:real:users` (env: `DATABASE_URL`, `E2E_REAL_LOGIN`, `E2E_REAL_LOGIN2`, `E2E_REAL_PASSWORD`) → `pnpm --filter @remote/web e2e:real`. Yukarıdaki "Kurulum" 2. ve 4. adımlarının yerine geçer. apps/server'da mevcut dosya değiştirilmedi (bu yüzden script web package.json'da). |
| S-P4-4              | `lib/session-storage.ts` `clearSessionData()` (+birim): çıkışta (`logout-button.tsx`) sekme belleğindeki tüm `rs.*` anahtarları (`rs.guestName.*`) silinir.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| QA-P4-12 (istemci)  | `tech-machine.ts` `extras()`: `hello{tech}.guestName` / `.share.state` ve `peer.joined{guest}.guestName` varsa kullanılır (sunucu adı sekme belleğini ezer, `restoreName` yalnız ad yoksa). Yoksa: yalnız tek bekleyen varken kabul edilenin adı; >1 bekleyende tahmin yok → "Müşteri". Birim testi eklendi.                                                                                                                                                                                                                                                                                                                              |

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

| Yol                      | Auth                     | P5 ile gelen                                                                                                                                                                        |
| ------------------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/sessions/[id]/console` | Evet (oturum teknisyeni) | Yan panel: Sohbet / Dosyalar / Kalite (`collab-side`); sahnede işaretleme araç çubuğu (kalem, ok, dikdörtgen, lazer, 4 renk, geri al, temizle — yalnız "Sığdır" görünümü)           |
| `/session/[token]`       | Hayır (link + lobi)      | "Teknisyenle iletişim" bölümü (Sohbet; `caps.file_transfer` varsa Dosyalar), önizleme üstünde işaretleme/lazer katmanı, "Yüzen pencere" (Document PiP, yalnız destekleyen tarayıcı) |

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

| Dosya                               | İçerik                                                                                                                                                                                                                                                                                                                                                           | AC                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `go.mod` / `go.sum`                 | Modül `remote-support/agent-win`, `go 1.25.0`, `toolchain go1.25.14` (ADR-0010 sabit sürüm)                                                                                                                                                                                                                                                                      | 94                 |
| `cmd/noktadestek/main.go` (windows) | İlk iş `dllsafe.Harden()`, sonra `config.Load()` + kendi SHA-256 parmak izi; hata kodlarıyla çıkar                                                                                                                                                                                                                                                               | 109, 118, 128      |
| `internal/config`                   | `serverURL`/`version` YALNIZ `-ldflags -X`; https://host[:port] dışı (http, yol, sorgu, userinfo) red; ldflags'sız build `ErrNotConfigured`; `Fingerprint` = ilk 8 hex                                                                                                                                                                                           | 109, 128           |
| `internal/dllsafe` (windows)        | `SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32)` + `SetDllDirectory("")`                                                                                                                                                                                                                                                                                 | 118                |
| `internal/pairing`                  | `Destek-<8 hane>.exe` (+ tarayıcının ` (1)` eki) → kod; `Normalize` elle giriş ("1234 5678", "1234-5678"); yalnız ASCII rakam                                                                                                                                                                                                                                    | 27, 97             |
| `internal/files`                    | `SanitizeFileName`, `NameWarning` (tehlikeli/çift uzantı, `DANGEROUS_EXT` ile aynı liste), `AvailableName` (` (n)`, üzerine yazma yok, 255 sınırı korunur); `motw_windows.go` `WriteMOTW` (`:Zone.Identifier` ZoneId=3)                                                                                                                                          | 36, 54, 117        |
| `internal/api`                      | resolve (`clientKind=AGENT`) / join (gövdede clientKind yok); Origin/Sec-Fetch/Cookie göndermez; sistem kökleriyle TLS ≥1.2, pinning yok; yönlendirme izlenmez; 15 sn timeout; resolve yalnız ağ hatası/502-504'te 3 deneme, 4xx ve join asla tekrar denenmez (nonce tek kullanımlık); hata zarfı → tipli `*api.Error{Status, Code, Message, Fields, RequestID}` | 14, 97, 98, 109    |
| `internal/signal`                   | `wss://host/ws/guest` (sorgu yok) + `Sec-WebSocket-Protocol: rs.v1, rs.ticket.<t>` / `rs.reconnect.<t>`; sunucu rs.v1 seçmezse kapat; read limit 64 KB; `ParseServer` (zod strictObject eşi: harf duyarlı anahtar, bilinmeyen/eksik alan, enum, ULID, ISO, sınırlar); teknisyene özgü tipler `ErrNotForGuest`; `Encode` gönderimden önce doğrular; ihlalde 1008  | 14, 112, 119       |
| `internal/dc`                       | `ParseCtl` (12 ctl tipi, strict, ≤16 KB, `control.*` yok), `Allowed` (caps filtresi), `DecodeChunk` (BE başlık), `Receiver` = `FileReceiveGuard` + artımlı SHA-256 + sabit zamanlı karşılaştırma, `FileReply`/`FileResult`                                                                                                                                       | 35, 36, 53–56, 119 |

### Tasarımdan sapmalar (gerekçeli)

1. **Paket adı `pairing`** (görev metninde `internal/code`): mimari §dizin planı `internal/pairing (8 hane)` diyor; mimariye uyuldu.
2. **Parmak izi ldflags ile gömülmedi:** ikilinin kendi SHA-256'sı kendi içine gömülemez (gömmek hash'i değiştirir).
   AC-128'deki "SHA-256 ilk 8 hane" çalışma anında `os.Executable()` dosyasından hesaplanır; `SHA256SUMS` ile aynı değerdir.
   ldflags'ta yalnız `serverURL` ve `version` var.
3. **Pion henüz eklenmedi:** Aşama 1'de rtc kodu yok; kullanılmayan bağımlılık eklenmedi. Aşama 2'de `github.com/pion/webrtc/v4` (MIT) eklenecek.
4. **`golang.org/x/sys` v0.45.0'a sabitlendi:** v0.50.0 `go >= 1.26` istiyor; toolchain 1.25.14.
5. **Proxy:** `http.ProxyFromEnvironment` açık (kurumsal ağ). Hedef adres değişmez, TLS uçtan uca sunucu adına doğrulanır; AC-109 korunur.

### Bağımlılıklar (mimari §10.4 içinde)

| Paket                        | Sürüm   | Lisans       | Gerekçe                                             |
| ---------------------------- | ------- | ------------ | --------------------------------------------------- |
| `github.com/coder/websocket` | v1.8.15 | ISC          | WS istemcisi, `Subprotocols` desteği (mimari §10.4) |
| `golang.org/x/sys`           | v0.45.0 | BSD-3-Clause | `windows.SetDefaultDllDirectories` (mimari §10.4)   |

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

| Dosya                                  | İçerik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | AC                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `internal/flow` (platformdan bağımsız) | Akış durum makinesi: kod (dosya adı/elle, `pairing.Normalize`) → resolve → karşılama/KVKK → join → WS (ticket) → lobi (admitCode) → `hello` → monitör seçimi → `share.state` → offer/answer/ice → `session.ended`. Hata eşleme web misafir metinleriyle aynı (`messages/tr.json` g.*): 404/400 → kod alanına dön, `SESSION_EXPIRED/CONSUMED/CANCELLED`, 429, `LOBBY_FULL`, 403 → son ekran; `NONCE_INVALID` → yeniden resolve + karşılama. AC-24: kabul sonrası kopuşta `rs.reconnect.<token>` ile 120 sn yeniden bağlanma, her `hello`'da **yeni PeerConnection** + `share.state` yeniden; protokol ihlali/4401'de yeniden bağlanmaz. Lobide "Vazgeç" → `session.end`                                                                                                                                                                                                                                                                        | 24, 97, 98, 106, 107, 112                            |
| `internal/rtc`                         | Pion v4: offer'a answer; H.264 `TrackLocalStaticSample` offer'daki recvonly video transceiver'ına bağlanır (yerel sendonly); `hello.iceServers`/`ice.servers` → `SetConfiguration`; remote description'dan önce gelen ICE kuyruğa alınır; `ctl` → `dc.ParseCtl` + `dc.Allowed` (caps dışı `file.offer` → otomatik `file.reject`); `file` → `dc.DecodeChunk`; `input` ve bilinmeyen kanal kapatılır (P7). `Source` arayüzü: `NextFrame(ctx) (Frame{Annex-B, Duration})`                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 52, 53, 119                                          |
| `internal/transfer`                    | TO_CUSTOMER alımı: temizlenmiş ad + uyarı → diyalog; kabulde `İndirilenler\<ad>.part` (O_EXCL), alınan bayt sayacı (beyan/tenant sınırı aşımı → `file.cancel` + `.part` silinir), `file.done` → SHA-256 + boyut → yeniden adlandır (üzerine yazma yok, ` (n)`) → MOTW → `file.result` + WS `file.meta` (alıcı raporu). Ret sonrası 30 sn otomatik ret, tek bekleyen teklif, oturum sonunda yarım `.part` silinir                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 36, 53, 54, 55, 108                                  |
| `internal/win` (windows)               | CGO'suz user32/gdi32/shell32 bağlamaları, yalnız `NewLazySystemDLL` (G-08)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 118                                                  |
| `internal/ui` (windows)                | Tek UI iş parçacığı (LockOSThread) + form çatısı; 96-DPI birimli yerleşim, `GetDpiForWindow` + `WM_DPICHANGED` ile ölçek; ekranlar: kod girişi, karşılama (teknisyen, doğrulama kodu, sunucu, dolandırıcılık uyarısı, "Kötüye kullanımı bildir" → `mailto:`, KVKK metni + ad + onay kutusu; onay+ad olmadan "Bağlan" pasif), lobi (admitCode), monitör seçimi, oturum penceresi (izleniyor etiketi, durum satırı, zaman damgalı sohbet + okunmamış sayacı başlıkta, dosya ilerleme/iptal, "Oturumu bitir"), dosya kabul diyaloğu (Reddet varsayılan/odak, Kabul 1,5 sn kilitli, Enter/Space Kabul'e ulaşmaz, imleç altında açılmaz, tehlikeli/çift uzantı uyarısı), gösterge (her monitörde kırmızı kenarlık + üst-orta etiket, 1 sn'de bir `HWND_TOPMOST`), işaretleme katmanı (renk anahtarlı, tıklama geçirgen; kalem/ok/dikdörtgen/lazer 1 sn/geri al/temizle, 4 renk). Gösterge ve katman `WDA_EXCLUDEFROMCAPTURE` ile yakalamadan hariç | 36, 37, 52, 53, 56, 98, 103, 106, 110, 112, 125, 128 |
| `internal/capture/monitors_windows.go` | `EnumDisplayMonitors` → `signal.Monitor` (kimlik = 1 tabanlı sıra, "Ekran n") + kimlik → dikdörtgen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 106                                                  |
| `internal/capture/source_windows.go`   | `Open` şimdilik `ErrUnavailable` döner (bkz. Eksikler); akış `share.state{stopped}` + "Ekran görüntüsü alınamadı" gösterir                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —                                                    |
| `cmd/noktadestek/main.go`              | dllsafe → config → parmak izi → UI → `flow.Run`; son ekran 2,5 sn sonra çıkış (AC-107 "3 sn içinde" için pay)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 107, 109, 118, 128                                   |
| `build/winres.json`, `build/build.sh`  | go-winres v0.3.3 (MIT, yalnız build aracı — ikiliye girmez): manifest `asInvoker`, `permonitorv2,system`, common controls v6, Win10 min; VERSIONINFO (sürüm build argümanından). `.syso` build sonunda silinir, git'e girmez                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 95, 96, 110                                          |
| `internal/signal/conn.go`              | `ErrProtocol` + `Fatal(err)` (1008/4401 → yeniden bağlanma yok)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 24                                                   |

### Tasarımdan sapmalar (gerekçeli)

1. **Sohbet ayrı pencere değil, oturum penceresinin bölmesi:** tek pencere, "Oturumu bitir" her an görünür (AC-100 ile uyumlu), daha az kod.
2. **Dosya kaydetme konumu sorulmaz:** her zaman `İndirilenler` (KnownFolder), müşteri seçimi = Kabul/Reddet. Kaydet-diyaloğu (comdlg32) eklenmedi.
3. **Kapanış 2,5 sn:** görev "3 sn sonra", AC-107 "3 sn içinde" diyor; ikisini de karşılamak için.
4. **%TEMP% temizliği kodu yok:** istemci %TEMP%'e hiç yazmıyor (Go runtime, Pion, UI dosya oluşturmaz); tek disk yazımı İndirilenler'deki `.part`'tır ve oturum sonunda/iptalde silinir (`transfer.Close`). Kullanılmayan temizlik kodu yazılmadı; AC-108 iz testi Windows'ta elle doğrulanmalı.
5. **Yeniden bağlanırken üretilen `file.meta` gönderilmez** (soket yok); kayıp nadir, kabul edildi.
6. Karşılamada **firma logosu yok** (aşağıda Eksikler) — AC-98'in bu parçası açık.

### Bağımlılıklar

| Paket                                                                                                             | Sürüm   | Lisans              | Gerekçe                                                       |
| ----------------------------------------------------------------------------------------------------------------- | ------- | ------------------- | ------------------------------------------------------------- |
| `github.com/pion/webrtc/v4` (+ pion/* alt paketleri, `google/uuid`, `wlynxg/anet`, `x/net`, `x/crypto`, `x/time`) | v4.2.26 | MIT / BSD-3 / BSD-3 | mimari §10.4 (Pion). `x/sys` v0.45.0'da kaldı (go 1.25 uyumu) |
| `github.com/tc-hib/go-winres` (yalnız `go run`, go.mod'a girmez)                                                  | v0.3.3  | MIT                 | manifest + VERSIONINFO `.syso`                                |

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

| Dosya                                                  | İçerik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `internal/capture/nv12.go` (yeni, platformsuz)         | `ConvertBGRA` BGRA → NV12 (BT.601 sınırlı aralık, 2×2 renk ortalaması), DXGI döndürmesi (90/180/270, satır/sütun ofset tablolarıyla — iç döngüde ek maliyet yok), en yakın komşu küçültme; `OutputSize` 1920×1080 sınırına (iki yönde) en-boy korunarak sığdırma, çift boyut                                                                                                                                                                                                                                                                                                            |
| `internal/capture/annexb.go` (yeni, platformsuz)       | Annex-B NAL ayrıştırma (3/4 baytlık başlangıç kodu), SPS/PPS önbelleği: her IDR önünde SPS/PPS garantisi (`MF_MT_MPEG_SEQUENCE_HEADER`'dan da öğrenir)                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `internal/capture/ratectl.go` (yeni, platformsuz)      | Kare hızı denetimi (hedef 30, alt sınır 15 — AC-41; maliyet EWMA'sı bütçenin %90'ını aşarsa −5, 2 sn %50 altında kalırsa +5), CBR bit hızı (~0,075 bpp, 0,3–8 Mbit/s; 1080p30 ≈ 4,7 Mbit/s), anahtar kare saati (GOP 2 sn + istek, PLI selinde en sık 500 ms'de bir)                                                                                                                                                                                                                                                                                                                    |
| `internal/capture/com_windows.go` (yeni)               | `comObj` vtable çağrısı (`//go:uintptrescapes`), HRESULT, `NewLazySystemDLL` ile d3d11/dxgi/mfplat/ole32 (G-08), IID'ler                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `internal/capture/dxgi_windows.go` (yeni)              | `CreateDXGIFactory1` → adaptör/çıkış taraması, monitör eşlemesi GDI aygıt adıyla (`\\.\DISPLAYn` = `win.Monitors()[id-1].Device`) → `D3D11CreateDevice(adapter)` → `IDXGIOutput1::DuplicateOutput` → `AcquireNextFrame`/staging `CopyResource`/`Map`/`ReleaseFrame`; döndürme `DXGI_OUTDUPL_DESC.Rotation`'dan; yalnız fare hareketi (`LastPresentTime=0`) yeni kare sayılmaz                                                                                                                                                                                                           |
| `internal/capture/mf_windows.go` (yeni)                | H.264 MFT: önce `MFTEnumEx(HARDWARE)` (asenkron → `MF_TRANSFORM_ASYNC_UNLOCK` + `IMFMediaEventGenerator` olay döngüsü, NO_WAIT yoklama, 500 ms zaman aşımı), olmazsa senkron yazılım MFT (`MFTEnumEx(SYNCMFT)`, son çare `CoCreateInstance(CLSID_CMSH264EncoderMFT)`); Baseline (66), CBR, düşük gecikme, GOP = 2 sn, hız öncelikli; `CODECAPI_AVEncVideoForceKeyFrame` ile anahtar kare; `MF_E_TRANSFORM_STREAM_CHANGE`'de çıkış türü yeniden anlaşılır; çıktı örneğini MFT sağlamıyorsa biz ayırırız                                                                                  |
| `internal/capture/source_windows.go` (yeniden yazıldı) | `Open` → kilitli tek OS iş parçacığında worker (COM MTA + `MFStartup(LITE)`); `NextFrame` kanal üzerinden; ilk kare + kodlayıcı kurulamazsa `Open` hata döner (mevcut "Ekran görüntüsü alınamadı" yolu korunur). Çoğaltma kaybında (ACCESS_LOST, UAC/Güvenli Masaüstü, kilit ekranı, mod/çözünürlük değişimi) oturum kapatılır, 250 ms → 2 sn geri çekilmeyle yeniden açılır; bu sürede son kare 1 sn'de bir yeniden kodlanır. Çözünürlük değişirse kodlayıcı yeniden kurulur + anahtar kare. Ekran değişmiyorsa kodlama yapılmaz (1 sn canlı tutma hariç). `ErrUnavailable` kaldırıldı |
| `internal/rtc/rtc.go`                                  | `KeyframeRequester` (isteğe bağlı kaynak yeteneği): `Stream` başında anahtar kare ister (yeniden bağlanmada yeni eş IDR ile başlar); RTCP okuyucu PLI/FIR'de kaynaktan anahtar kare ister (`drainRTCP` → `readRTCP`)                                                                                                                                                                                                                                                                                                                                                                    |
| `go.mod`                                               | `github.com/pion/rtcp` dolaylıdan doğrudana taşındı (zaten Pion bağımlılığı; yeni modül yok)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| testler                                                | `internal/capture/capture_test.go` (yeni), `internal/rtc/rtc_test.go` (+1 test)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### Tasarımdan sapmalar (gerekçeli)

1. **NV12 dönüşümü CPU'da** (Video Processor MFT değil): sürücü bağımsız, birim testli; 1080p'de tek geçiş + ofset tabloları. Ölçülemedi; Windows'ta 1080p'de dönüşüm + kodlama > 66 ms çıkarsa (≤ 15 fps) GPU dönüşümüne geçmek ayrı iş.
2. **Kodlanan çözünürlük ≤ 1920×1080** (4K/ultra geniş ekranlar en-boy korunarak küçültülür): AC-41 kare hızı ve SDP'deki `profile-level-id=42e01f` (Level 3.1) ile uyum için. Koordinatlar P7'de (uzaktan kontrol) oransal eşlenmeli.
3. **GOP 2 sn** (Aşama 2 planındaki "≤ 2 sn") + PLI/FIR ile anında IDR (500 ms sınırlı).

### Testler ve son çıktı

Komut Aşama 2 ile aynı (`gofmt -l` boş → `go vet` → `go test -race` → `GOOS=windows go vet` → iki `build/build.sh` + `sha256sum`).
Son çıktı: gofmt temiz; linux `go vet` temiz; `go test -race` **10/10 paket ok** (capture yeni); `GOOS=windows go vet` temiz;
iki build aynı SHA-256 (`9d49966c…`, arada `go clean -cache`); exe 11,5 MB; `go mod verify` tamam.
Yeni testler: `capture` — `TestNV12SolidColorsBT601` (siyah/beyaz/kırmızı/mavi Y/U/V), `TestNV12RotationAndStride` (0/90/180/270

- satır dolgulu stride), `TestNV12ScaleDownAndInvalid` (küçültme, kısa kaynak/tek genişlik/kısa stride reddi),
  `TestAC41OutputSizeFitsEncoderLimit` (4K, 1440p, 21:9, dikey, tek boyut), `TestAnnexBSplitAndParamSets` (karışık başlangıç
  kodu, IDR'ye SPS/PPS ekleme, sıra başlığından öğrenme), `TestAC41RateControlKeepsAtLeast15FPS`, `TestBitrateBounds`,
  `TestKeyClockPLIRateLimited`; `rtc` — `TestAC41KeyframeOnStreamStartAndPLI` (gerçek iki Pion eşi; yayın başı + teknisyenden
  PLI ve FIR → kaynakta anahtar kare isteği).

### Windows'ta elle doğrulanacaklar (Aşama 2 listesinin 14 adımına ek)

Adım 7 artık geçersiz: görüntü gelmeli. Konsolda `chrome://webrtc-internals` açık tutulursa fps/bit hızı/çözünürlük okunur. 15. **Görüntü (AC-41):** 1920×1080 monitör paylaşımı ≤ 3 sn içinde konsolda görünür; video oynatırken/pencere sürüklerken `framesPerSecond` ≥ 15 (hedef 30); `webrtc-internals`'da `keyFramesDecoded` 2 sn'de bir artar; masaüstü durgunken bant genişliği düşer. 16. **Donanım/yazılım kodlayıcı:** Intel/AMD/NVIDIA GPU'lu makinede ve GPU'suz VM'de (Hyper-V/VirtualBox, "Microsoft Basic Display Adapter") ayrı ayrı görüntü gelmeli (VM'de yazılım MFT). Görüntü yeşil/bozuksa veya hiç gelmiyorsa makine/GPU modeli not edilsin (asenkron MFT olay döngüsü). 17. **Monitör eşlemesi:** iki monitörde "Ekran 2" seçilince gerçekten 2. monitör gelmeli; göstergenin çizildiği monitörle aynı olmalı. 18. **Gösterge yakalamaya girmez:** konsoldaki görüntüde kırmızı kenarlık/üst çubuk ve işaretleme çizimleri **görünmemeli** (Win10 2004+). Win10 1909 ve öncesinde görünebilir — sürümü not edin. 19. **Ölçek/DPI:** %150 ölçekli 4K monitörde görüntü tam masaüstü (kesik değil), 1920×1080'e küçültülmüş ve keskin; yazılar okunur. 20. **Döndürme:** Ekran ayarlarından monitörü "Dikey" ve "Dikey (ters çevrilmiş)" yap → görüntü konsolda doğru yönde (dik, ayna değil); yan yatık/ters gelirse hangi yön olduğu not edilsin (90/270 eşlemesi Windows'ta doğrulanmadı). 21. **Kayıp ve yeniden kurulum:** paylaşım sürerken (a) UAC isteyen bir şey çalıştır (Güvenli Masaüstü), (b) Win+L kilit + aç, (c) çözünürlüğü değiştir, (d) tam ekran bir oyun/video aç-kapa → her birinde görüntü en çok ~2 sn donar, sonra kendiliğinden devam eder; akış "durdu"ya düşmemeli. 22. **PLI:** konsol sekmesini 30 sn arka plana alıp geri getir / ağ kesintisi sonrası yeniden bağlanma (adım 12) → görüntü gri/bozuk kalmadan ≤ 1 sn içinde düzelmeli. 23. **Kaynak tüketimi:** Görev Yöneticisi'nde 1080p paylaşımda istemci CPU'su not edilsin (yazılım kodlayıcıda yüksek olabilir); oturum bitince istemci süreci kapanmalı (iş parçacığı/COM sızıntısı yok). 24. **Windows N:** Media Feature Pack yoksa paylaşım "Ekran görüntüsü alınamadı" ile durmalı, program çökmemeli.

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

**S6-6 (HTTP(S)\_PROXY):** davranış değiştirilmedi (`Proxy: http.ProxyFromEnvironment` duruyor). Gerekçe: kurumsal
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

| Dosya                                                                                                                                                                     | Değişiklik                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/public/routes.ts` (yeni)                                                                                                                                 | `publicAgentRoutes` (`/api/v1/public/agent`), `Cache-Control: no-store` hata yanıtlarında da; ref biçimi `sessionStatusQuerySchema` (aynı opak sessionRef)                                                                                                                                                                                    |
| `apps/server/src/public/agent.ts` (yeni)                                                                                                                                  | Servis: tüm istekler ipKey 20/dk → kod yolu kova kilidi → ref HMAC → PENDING + süresi dolmamış → ikili kapısı → `/downloads/Destek-<kod>.exe`. Geçersiz ref / 410 başarısız deneme sayılır (resolve ile **aynı** `codeIp`/`codePrefix` kovaları + `rs_resolve_failed`). Süresi dolmuş PENDING aynı istekte EXPIRED yapılır (resolve ile aynı) |
| `apps/server/src/public/agent-binary.ts` (yeni)                                                                                                                           | `AgentBinary`: volume'daki ikilinin SHA-256'sı `AGENT_SHA256` ile eşleşmedikçe indirme 503 (fail-closed). Dosya değişince (boyut/mtime/inode) yeniden hesaplanır; eşzamanlı çağrılar tek hesaplama; sorun durumu geçişte bir kez `alarm: "agent_binary"` logu (yol/hash yazılmaz)                                                             |
| `apps/server/src/sessions/public.ts`                                                                                                                                      | `consume`, `GONE` dışa açıldı; resolve kod yolundaki kilit kontrolü/başarısız sayım `assertLookupAllowed` + `countFailedLookup` olarak çıkarıldı (davranış aynı, indirme ucu ortak kullanır); `downloadIp` (21/dk eşik = 20 serbest) eklendi                                                                                                  |
| `apps/server/src/sessions/repo.ts`                                                                                                                                        | `findForDownload` (id, tenantId, status, expiresAt, activeCode)                                                                                                                                                                                                                                                                               |
| `apps/server/src/app.ts`                                                                                                                                                  | `agentBinary` dekoratörü + açılışta ısıtma (`onReady`), rota kaydı                                                                                                                                                                                                                                                                            |
| `apps/server/src/env.ts`                                                                                                                                                  | `AGENT_BINARY_PATH` (mutlak yol), `AGENT_SHA256` (64 hex, küçük harfe indirilir); ikisi de opsiyonel — boşsa indirme 503, server açılır                                                                                                                                                                                                       |
| `apps/server/src/lib/logger.ts`                                                                                                                                           | Redaksiyona `*.ref` (savunma; URL serileştiricisi sorgu dizesini zaten yazmıyor)                                                                                                                                                                                                                                                              |
| `deploy/Caddyfile`                                                                                                                                                        | `@agentExe` (`/downloads/(NoktaDestek\|Destek-<8 hane>).exe` → aynı `NoktaDestek.exe`, `Content-Disposition: attachment; filename="<ad>.exe"`, `octet-stream`, `no-store`, `nosniff`); diğer `/downloads/*` 404. Log filtresi: `/downloads/Destek-***`, `resp_headers>Content-Disposition delete`                                             |
| `deploy/docker-compose.yml`                                                                                                                                               | `agent_downloads` volume'u (server `/data/downloads:ro`, caddy `/srv/downloads:ro`); server env `AGENT_BINARY_PATH` (sabit), `AGENT_SHA256: ${AGENT_SHA256:-}`                                                                                                                                                                                |
| `.env.example`, `docs/runbook.md` (§3 env, §5 log, §7 sorun giderme)                                                                                                      | Yeni değişkenler ve 503/`agent_binary` alarmı                                                                                                                                                                                                                                                                                                 |
| `apps/server/test/integration/agent-download.test.ts` (yeni), `apps/server/test/unit/agent-binary.test.ts` (yeni), `test/helpers/tenant-matrix.ts` (rota sınıfı `public`) | Testler                                                                                                                                                                                                                                                                                                                                       |

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

| Dosya                                | İçerik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | AC        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `.github/workflows/agent-win.yml`    | `check` (Go imajı digest sabit konteyner: toolchain=go.mod, gofmt, `go mod verify`, vet, `go test -race`, windows vet, govulncheck v1.7.0 windows+linux, go-licenses v2.0.1 forbidden/restricted/unknown yasak) · `test-windows` (windows-2025, `go test`) · `build` ×2 ayrı runner (`build/build.sh`, `SOURCE_DATE_EPOCH`=commit) · `reproducible` (iki SHA-256 eşit, ≤40 MB, MZ, UPX yok, `SHA256SUMS`) · `attest` (push/dispatch; yalnız bu job `id-token`/`attestations: write`) · `release` (yalnız `v*`, `environment: agent-release`, yalnız bu job `contents: write`) | 94, 96    |
| `.github/workflows/agent-watch.yml`  | günlük: `AGENT_WATCH_URL` exe hash'i ∈ herhangi bir Release `SHA256SUMS` (rollback alarm değil); 503 veya uyuşmazlık → `agent-watch` etiketli issue + kırmızı koşu; günlük govulncheck                                                                                                                                                                                                                                                                                                                                                                                        | 128, G-07 |
| `.github/dependabot.yml`             | `gomod` `/apps/agent-win` haftalık                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | G-18      |
| `deploy/agent/verify-and-publish.sh` | `--tag`/`--run`/`--dir`; SHA256SUMS + PE/boyut/packer + `gh attestation verify` (repo, signer-workflow, source-ref, self-hosted red) operatör makinesinde; `--ssh` ile betik kendini `--apply` modunda sunucuya taşır: bayt eşitliği → `remote_agent_downloads` volume'una 0644 atomik yazım (compose'daki caddy imajı, ağsız) → `.env` `AGENT_SHA256` → `up -d --no-deps server` → Caddy üzerinden hash kontrolü; `PUBLISHED.log`                                                                                                                                            | 96, 128   |
| `docs/runbook.md` §11                | ayarlar, yerel doğrulama, yayın, rollback, private repo yolu, alarm                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 92        |
| `.gitignore`                         | `deploy/agent/PUBLISHED.log` (`.env.bak.*` zaten `.env.*` kapsamında)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | —         |

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
  - "İndirme başladı"; 503 `NOT_READY` → uyarı + **Tarayıcıdan devam et** (eksik varsa ad alanına, hazırsa paylaş düğmesine odak);
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

| Dosya                                                                                                                                                                                           | Değişiklik                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/ws.ts`                                                                                                                                                                  | `controlRequestSchema`, `monitorRequestSchema`, `controlStateSchema` (GRANTED yalnız UI), `envStateSchema`; tech/guest inbound birleşimlerine eklendi; sunucu çıkışına `control.request`, `monitor.request`, `control.revoke`, `caps.update`, `control.state`, `env.state`; sabitler `CONTROL_STATES/SOURCES/REVOKE_REASONS`, `CONTROL_REQUEST_MAX=5`, `CONTROL_DENY_COOLDOWN_MS=30000`; `WS_ERROR_CODES += INTERNAL` |
| `packages/contracts/src/dc.ts`                                                                                                                                                                  | `input` kanalı: `m.move`, `m.btn`, `m.wheel` (±1200), `k` (`code` ≤32, `key?` ≤4), `k.release_all`; `inputMessageSchema`, `parseInputMessage`                                                                                                                                                                                                                                                                         |
| `packages/contracts/src/audit.ts` (yeni, `exports["./audit"]`)                                                                                                                                  | `CONTROL_AUDIT` action adları (tek kaynak; P8 zaman çizelgesi aynı adları okur)                                                                                                                                                                                                                                                                                                                                       |
| `packages/contracts/fixtures/ws-messages.json`                                                                                                                                                  | P7 geçerli/geçersiz örnekleri; eski "P7 öncesi bilinmiyor" `control.request` geçersiz örneği kaldırıldı                                                                                                                                                                                                                                                                                                               |
| `packages/contracts/fixtures/dc-input.json` (yeni)                                                                                                                                              | `input` kanalı geçerli/geçersiz örnekleri (Go `internal/input` için)                                                                                                                                                                                                                                                                                                                                                  |
| `apps/server/src/signaling/control.ts` (yeni)                                                                                                                                                   | istek süzgeci, `control.state` kaydı (fail-closed), `revokeControl`, `resetControl`, `narrowCaps`, `env.state` iletimi                                                                                                                                                                                                                                                                                                |
| `apps/server/src/signaling/types.ts`                                                                                                                                                            | `Room.control: ControlRoom`, `TechConn.role`, `Guest.ctx`                                                                                                                                                                                                                                                                                                                                                             |
| `apps/server/src/signaling/rooms.ts`                                                                                                                                                            | `TechnicianLiveControl` arayüzü (`endByTechnician`, `applyPermChange`); kopmada/sekme değişiminde VIEW'a sıfırlama; `attachTech` güncel yetkiyle caps daraltır                                                                                                                                                                                                                                                        |
| `apps/server/src/signaling/handlers.ts`                                                                                                                                                         | yeni tiplerin yönlendirmesi; `share.state` bekleyen monitör isteğini karşılar                                                                                                                                                                                                                                                                                                                                         |
| `apps/server/src/signaling/ws.ts`                                                                                                                                                               | TechConn `role`; misafir bağlam (ip/UA) saklanır; 60 sn yeniden doğrulama: geçerli → `applyPermChange`, rol değişti / kullanıcı-tenant pasif → `endByTechnician`, yalnız oturum geçersiz → o oda `auth_revoked`                                                                                                                                                                                                       |
| `apps/server/src/ops/metrics.ts`                                                                                                                                                                | `rs_control_total{event}`                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/server/test/integration/signaling-control-p7.test.ts`, `test/unit/dc-input-fixtures.test.ts`, `packages/contracts/test/control-p7.test.ts` (yeni); `test/helpers/ws.ts` (TechConn `role`) | testler                                                                                                                                                                                                                                                                                                                                                                                                               |
| `docs/mimari-protokol.md`                                                                                                                                                                       | sonuna "P7 backend uygulama notları" (aşağıdaki sapmalar)                                                                                                                                                                                                                                                                                                                                                             |

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

| Dosya                                                                                                  | İçerik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | AC                                                                       |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `internal/control/gate.go` (yeni, platformsuz)                                                         | İzin kapısı: varsayılan CLOSED, atomik `IsOpen/Allow`; `Close` açıktan kapanınca dinleyicileri (takılı tuş bırakma) çalıştırır; `Suspend` yerel öncelik (1 sn); düşürülen olay sayacı                                                                                                                                                                                                                                                                                                                               | 24, 101, 104                                                             |
| `internal/control/requests.go`                                                                         | İstek sayacı (kontrol ve monitör ayrı): diyalog açıkken ikinci istek diyalog açmaz, ret sonrası 30 sn, oturum başına 5                                                                                                                                                                                                                                                                                                                                                                                              | 116                                                                      |
| `internal/control/consent.go`                                                                          | G-03 kuralları: 1,5 sn kilit, Enter/Space asla izin vermez, enjekte etkileşim yok sayılır, kısayol kaydı yoksa izin yok                                                                                                                                                                                                                                                                                                                                                                                             | 102, 116                                                                 |
| `internal/control/place.go`                                                                            | `PlaceAway`: diyalog imleci içermez (orta → üst-orta → alt-orta → sol → sağ); `ui.showAwayFromCursor` buna taşındı                                                                                                                                                                                                                                                                                                                                                                                                  | 116                                                                      |
| `internal/control/hotkey.go`                                                                           | `RegisterHotkey`: Ctrl+Shift+F12, olmazsa Ctrl+Shift+F11, ikisi de olmazsa `ErrNoHotkey`                                                                                                                                                                                                                                                                                                                                                                                                                            | 102                                                                      |
| `internal/input/messages.go`                                                                           | `input` DC katı şema (m.move, m.btn, m.wheel, k, k.release_all; ≤ 512 bayt, null/bilinmeyen alan reddi)                                                                                                                                                                                                                                                                                                                                                                                                             | 47–49                                                                    |
| `internal/input/keys.go`                                                                               | `KeyboardEvent.code` → VK + genişletilmiş bayrak tablosu (harf, rakam, F1–F12, oklar, numpad, değiştiriciler)                                                                                                                                                                                                                                                                                                                                                                                                       | 48                                                                       |
| `internal/input/applier.go`                                                                            | Alıcı: doğrula → **kilit altında** `gate.Allow` → çevir → enjekte. Kapalı/askıdaysa düşer + sayar. Yazı tuşunda `key` tek karakterse ve Ctrl/AltSol/Win basılı değilse `KEYEVENTF_UNICODE` (Türkçe karakterler düzenden bağımsız); kısayollar VK. Ctrl+Alt+Del ve Win+L iletilmez. Normalize koordinat → aktif monitör → sanal masaüstü mutlak (`ABSOLUTE                                                                                                                                                           | VIRTUALDESK`). Kapı kapanınca yalnız kendi bastığı tuş/düğmeleri bırakır | 48, 49, 101 |
| `internal/input/sendinput_windows.go`                                                                  | `SendInput` (amd64 INPUT düzeni, tek çağrıda toplu), `MapVirtualKey` ile scan kodu, `VirtualScreen`                                                                                                                                                                                                                                                                                                                                                                                                                 | 48                                                                       |
| `internal/input/host_windows.go`                                                                       | Kilitli iş parçacığı: `WH_MOUSE_LL`/`WH_KEYBOARD_LL` (enjekte olmayan olay → `gate.Suspend`; son basışın `INJECTED` bayrağı tutulur) + `RegisterHotKey` (yedekli). WM_HOTKEY → **önce `gate.Close()`**, sonra akışa bildirim                                                                                                                                                                                                                                                                                        | 102, 104                                                                 |
| `internal/env/env.go` + `probe_windows.go`                                                             | 500 ms'de bir yoklama, yalnız değişimde bildirim. Yükseltilmiş ön plan: kendi süreç yükseltilmemişse ön plan sürecinin belirteci `TokenElevation` (açılamıyorsa yükseltilmiş sayılır). Güvenli masaüstü: `OpenInputDesktop` başarısız veya adı `Default` değil                                                                                                                                                                                                                                                      | 105                                                                      |
| `internal/signal/messages.go`                                                                          | Gelen: `control.request`, `monitor.request{monitorId 0..64}`, `control.revoke{permission\|audit\|admin}`, `caps.update{caps[]}`; giden: `control.state` (GRANTED yalnız `UI`), `env.state`; `control.state`/`env.state` misafire gelirse `ErrNotForGuest`; `error.code` `INTERNAL` eklendi                                                                                                                                                                                                                          | 99, 105, 111, 115                                                        |
| `internal/rtc/rtc.go`                                                                                  | `input` kanalı: `Handlers.Input` yoksa kapatılır; yalnız metin ve yalnız `remote_control` yeteneği varken alıcıya gider (Pion goroutine'inden doğrudan, akış kuyruğu yok)                                                                                                                                                                                                                                                                                                                                           | 101, 115                                                                 |
| `internal/flow/control.go` (yeni) + `flow.go`                                                          | Kontrol akışı: istek → diyalog; izin → `gate.Open` + `control.state{GRANTED,UI}`; ret → `{VIEW,DENIED}`; düğme/kısayol → `{VIEW,UI\|HOTKEY}`; `control.revoke` → kapı + `{VIEW,SYSTEM}`; `caps.update` → `peer.SetCaps` + yetki yoksa kapı kapanır; `peer.left/peer.joined{tech}`, WS kopması, PeerConnection disconnected/failed/closed, her `hello` (AC-24) ve oturum sonu kapıyı kapatır; monitör isteği diyaloğu + kaynak değişimi + `share.state`; `env.state` (ilk değer, değişim, yeniden bağlanmada tekrar) | 24, 43, 47, 50, 99, 102, 105, 111, 115, 116                              |
| `internal/ui/control_windows.go` (yeni), `screens_windows.go`, `overlay_windows.go`, `form_windows.go` | Ortak izin diyaloğu (kontrol + monitör): Reddet varsayılan/odak, "İzin ver" 1,5 sn sonra etkin, `noKey` ile Enter/Space yutulur, `input.LastPressInjected()` ise yok sayılır, imleç altında açılmaz, kısayol yoksa kırmızı açıklama + izin düğmesi hiç etkinleşmez. Oturum penceresi: "Erişime izin ver" (bekleyen istek varken ve 1,5 sn sonra), "Kontrolü kapat" (UI iş parçacığında anında `gate.Close`), kısayol satırı, "Oturumu bitir". Gösterge metni "Ekranınız izleniyor" ↔ "Uzaktan kontrol aktif — <ad>" | 100, 102, 103, 116                                                       |
| `cmd/noktadestek/main.go`                                                                              | Kapı → UI → Applier → Host (kısayol) → flow bağlantısı                                                                                                                                                                                                                                                                                                                                                                                                                                                              | —                                                                        |

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

Ön koşul: staging P7 sunucusu + konsol; istemci `build/build.sh https://<staging-alan-adı>:4450 0.7.0`; iki monitörlü makine tercih edilir. Konsoldan "Kontrol iste". 25. **Diyalog (G-03/AC-116):** imleci ekran ortasına koyup istek gönder → diyalog imlecin altında değil (üst-orta); odak "Reddet"te; Enter → reddeder (konsol "Kontrol reddedildi"); "İzin ver" ilk 1,5 sn gri; Tab ile "İzin ver"e gelip Space/Enter → hiçbir şey olmamalı; 1,5 sn sonra fareyle veya Alt+İ ile izin. Ret sonrası 30 sn içindeki istek diyalog açmamalı; 6. istek hiç gelmemeli. 26. **Gösterge (AC-103):** izin sonrası her monitörde üst etiket "Uzaktan kontrol aktif — <ad>"; kapatınca "Ekranınız izleniyor — <ad>". 27. **Türkçe karakter (AC-48):** Not Defteri'nde konsoldan `çğıöşüİ ÇĞIÖŞÜ` + rakamlar + `@ € { }` (AltGr) yaz; müşteri klavyesi TR-Q ve ayrıca EN-US düzenindeyken aynı metin çıkmalı. Ctrl+C/Ctrl+V, Ctrl+Z çalışmalı. 28. **Alt+Tab ve Win:** konsoldan Alt basılı tutup Tab'a iki kez bas → pencere değiştirici açılıp seçim yapılmalı; Win+E Gezgin'i açmalı; Win+L kilitlememeli; F1–F12 ve oklar çalışmalı. 29. **Fare (AC-48/49):** sol/sağ/orta tık, çift tık (masaüstü simgesi açılır), sürükle (pencere taşıma), tekerlek dikey/yatay; %100/%150 ölçekte ve ikinci monitörde (monitör değişiminden sonra) tıklama hedefe ±2 piksel düşmeli. 30. **Kontrolü kapat (AC-50/101):** fare sürekli hareket ederken "Kontrolü kapat" → hareket anında durmalı, konsol ≤ 1 sn "Kontrol müşteri tarafından kapatıldı"; basılı Ctrl/Shift kalmamalı (Not Defteri'nde yazı normal). 31. **Kısayol (AC-102):** istemci arka planda (başka pencere odakta) Ctrl+Shift+F12 → kontrol kapanmalı, konsolda kaynak HOTKEY. Yedek: başka bir programla (ör. AutoHotkey `^+F12::return`) F12'yi önceden kapıp istemciyi başlat → oturum penceresinde "Ctrl+Shift+F11" yazmalı ve çalışmalı; F11'i de kapınca diyalogda kırmızı açıklama ve "İzin ver" hiç etkinleşmemeli. 32. **Yerel öncelik (AC-104):** teknisyen fareyi hareket ettirirken müşteri kendi faresini oynatınca uzaktan hareket ~1 sn durmalı, sonra devam etmeli. 33. **UAC / Güvenli Masaüstü (AC-105):** kontrol açıkken yönetici olarak bir program başlat → UAC sırasında konsolda "Müşteri güvenli masaüstünde"; UAC'ı onayla ve yükseltilmiş pencereye (ör. yönetici CMD) odaklan → konsolda "Yükseltilmiş pencere — kontrol edilemiyor" ve o pencereye tuş/tık gitmemeli; normal pencereye geçince uyarı kalkmalı. Win+L kilit ekranı da güvenli masaüstü sayılır. 34. **Monitör izni (AC-43):** konsoldan diğer ekranı iste → aynı kurallı diyalog; izin → görüntü ve işaretleme katmanı yeni ekrana geçmeli, tıklamalar yeni ekrana düşmeli; ret → değişmemeli. 35. **Revoke (AC-115):** kontrol açıkken yöneticiden teknisyenin "Uzaktan kontrol" yetkisini kaldır → ≤ 5 sn içinde kapı kapanmalı, istemcide "Uzaktan kontrol sunucu tarafından kapatıldı", gösterge "izleniyor"a dönmeli; yeni istek diyalog açmamalı. 36. **Kopma (AC-24):** kontrol açıkken Wi-Fi'ı 10 sn kapat/aç → yeniden bağlandıktan sonra kontrol kapalı (yalnız görüntüleme); teknisyen sekmesini yenileyince de kontrol kapanmalı.

### frontend-dev / backend için sözleşme notları

Sözleşme değişikliği yok. Konsolun dikkat etmesi gerekenler: `k.key` yalnız tek yazdırılabilir karakter için gönderilmeli (`"Shift"` gibi ≥5 karakterlik adlar şema gereği reddedilir; mesaj tamamen düşer); `code` yalnız harf/rakam (`^[A-Za-z0-9]{1,32}$`); tekerlek WHEEL_DELTA biriminde, `dy>0` aşağı. İstemci yeniden bağlanmada `RECONNECT` göndermez (sunucu üretir); monitör reddine yanıt yoktur.

## Frontend P7 — konsol uzaktan kontrol (frontend-dev, 2026-11-11)

Kapsam: yalnız teknisyen konsolu (`apps/web`). Tipler `packages/contracts`'tan (`ws.ts` control.*/monitor.request/env.state/caps.update, `dc.ts` input şeması); contracts'a dokunulmadı. İş başında tipler yoktu, geçici yerel şema yazıldı; backend contracts'a ekleyince ona geçildi — `lib/control/protocol.ts` artık yalnız contracts'tan yeniden dışa aktarım.

### Rotalar

| Yol                                | Auth                       | Ne yapar                                                                                                                                                                                                                        |
| ---------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
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

| Yol                                | Auth                       | Ne yapar                                                                                                                              |
| ---------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
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

| ID                        | Ne yapıldı                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S7-1 (sunucu + contracts) | `control.release` (tech→S→guest). GRANTED iken önce bellek VIEW + misafire `control.release` + teknisyene `control.state{VIEW, TECH}` (DB beklenmez), sonra sırada `session_consents(CONTROL, REVOKED, TECH)` + audit `control.released` (aktör teknisyen, `newValue.via`) tek TX; yazılamazsa log + ref. Açılış kaydı yazılırken (granting) gelen bırakma: GRANTED teknisyene iletilmez, geç commit REVOKED/TECH ile dengelenir (`ControlRoom.interrupt`).                                                                     |
| S7-2 / QA-P7-4            | `control.cancel`: REQUESTED → VIEW, misafire `control.cancel`, teknisyene `{VIEW, TECH}`, audit `control.cancelled` (consent yok); GRANTED iken = bırakma; VIEW'da yok sayılır. Sayaç düşmez, 30 sn ret beklemesi başlamaz. `control.state{GRANTED}` yalnız REQUESTED'de işlenir: VIEW'da kayıt/iletim yok + misafire `control.revoke{stale}`, GRANTED'de yok sayılır; ikisinde de metrik + log `control_state_unexpected` (oda başına dakikada ≤ 1 log).                                                                       |
| S7-4                      | Teknisyen kopması (`detachTech`) ve sekme değişimi / yeniden bağlanma (`attachTech`): ADMITTED misafir bağlıysa **her zaman** önce `control.revoke{reconnect}`, ardından `peer.left{tech}` / `peer.joined{tech}`; bekleyen monitör isteği temizlenir; açık kontrol REVOKED/RECONNECT (`newValue.side: "tech"`).                                                                                                                                                                                                                 |
| S7-10                     | `controlStateSchema` refine: GRANTED yalnız UI; VIEW yalnız UI\|HOTKEY\|DENIED\|SYSTEM (`GUEST_VIEW_SOURCES`). Misafirden RECONNECT/TECH → şema hatası → 1008 (uçtan uca test).                                                                                                                                                                                                                                                                                                                                                 |
| QA-P7-3                   | `dc.ts` `keySchema.code` → `^[A-Za-z0-9]{1,32}$`; `fixtures/dc-input.json` invalid'e `Key-A` ve 33 karakterlik kod.                                                                                                                                                                                                                                                                                                                                                                                                             |
| QA-P7-5                   | `control.requested` (ve aynı kalıpla `monitor.requested`) audit'i iletimden **önce** yazılır (zaman çizelgesinde istek satırı karardan önce). Mimar tablosu istek için fail-closed istemiyor (ADR-0013: yalnız açma yönü) → yazılamazsa (hata / 800 ms) log + ref + metrik `control_request_audit_failed`, istek yine iletilir. Yazım sürerken iptal/kopma olduysa istek müşteriye gitmez (`superseded`).                                                                                                                       |
| K4 / K5-e                 | `monitor.denied` (guest(AGENT)→S→tech): yalnız bekleyen istekle aynı `monitorId` için — bekleyen temizlenir, 30 sn bekleme, audit `monitor.denied`, teknisyene alanlar yeniden kurularak iletilir; diğer kimlik / bekleyen yok → yok say + metrik/log; BROWSER → yok say. Tek bekleyen istek: bekleyen varken yeni `monitor.request` → `error{CONFLICT}`. 30 sn yanıtsızlık ret gibi işler (audit/mesaj yok, sonraki 30 sn `RATE_LIMITED`). `share.state.activeMonitor === bekleyen` → audit `monitor.granted`, bekleme kalkar. |
| K5-d                      | Oturum sonu (`teardown`, hem `finish` hem `closeSession`): `session.ended` gönderildikten sonra açık kontrol için en iyi çabayla REVOKED/SYSTEM + `control.revoked{reason: "session_ended"}`; beklenmez, yazılamazsa log + ref, bitiş engellenmez.                                                                                                                                                                                                                                                                              |
| `rs_control_total`        | Olay değerleri `metrics.ts` HELP metninde listelendi (yeni: `cancelled`, `released`, `released_by_cancel`, `{release,cancel}_ignored`, `revoke_reconnect`, `revoke_session_ended`, `reset_guest_gone`, `control_state_unexpected`, `monitor_{granted,denied}`, `monitor_denied_{unexpected,ignored}`, `*_request_{conflict,superseded}`, `*_request_audit_failed`).                                                                                                                                                             |

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

| Dosya                                                      | Değişiklik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Bulgu                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| `internal/signal/messages.go`                              | Gelen `control.release`, `control.cancel`; `control.revoke.reason` += `reconnect`, `stale`; giden `monitor.denied{monitorId 0..64}`; misafir `control.state` VIEW kaynağı yalnız UI\|HOTKEY\|DENIED\|SYSTEM (RECONNECT/TECH gönderilemez); `monitor.denied` sunucudan misafire gelirse `ErrNotForGuest`                                                                                                                                                                                                                                                                                                                                                                                    | S7-1, S7-2, S7-4, S7-10, K4 |
| `internal/flow/control.go`, `flow.go`                      | release/cancel: kapı + kontrol diyaloğu kapanır, yanıt yok; metin "Teknisyen kontrolü bıraktı" (kapı açıktıysa) / "Teknisyen isteği geri çekti" (yalnız diyalog açıktıysa). revoke (her reason): kapı + kontrol ve monitör diyaloğu kapanır, `{VIEW,SYSTEM}` **yalnız kapı açıktıysa** (önceden her zaman gidiyordu). `reconnect`: "Teknisyenin bağlantısı koptu — uzaktan kontrol kapatıldı" yalnız kapı/diyalog açıktıysa; ardından gelen `peer.left/joined{tech}` bu metni ezmez. `peer.left/joined{tech}` ile kapatma (K3 ikinci katman) korundu. Monitör diyaloğunda ret → `monitor.denied{monitorId}`. `UI.MonitorPromptClosed()` eklendi (kontrol ve monitör diyaloğu ayrı kapanır) | S7-1, S7-2, S7-4, K4        |
| `internal/control/gate.go`                                 | `Shut(after)`: kapıyı atomik kapatır, kapanış dinleyicileri + `after` ayrı goroutine'de, asla bloklamaz (kanca/kısayol iş parçacığı için). `OnOpen` dinleyicisi (kapalı→açık geçişinde)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | S7-3, S7-7                  |
| `internal/input/host_windows.go`                           | WM_HOTKEY → `gate.Shut(onHotkey)` (kilit beklenmez). LL kancaları yalnız kapı açıkken kurulu: `gate.OnOpen/OnClose` → `Host.Hooks(on)` → `PostThreadMessage` ile Host iş parçacığında kur/kaldır. Global "son basış enjekte mi" bayrağı (`LastPressInjected`) kaldırıldı; kancalar yalnız AC-104 yerel önceliği için                                                                                                                                                                                                                                                                                                                                                                       | S7-3, S7-5, S7-7            |
| `internal/input/applier.go`                                | Kilit sırası belgelendi (Host iş parçacığı `a.mu`'yu asla almaz). Kapı kapalıyken ayrıştırmadan erken düşürme; jeton kovası 250 msg/sn, ani 500; aşan basma/hareket/tekerlek düşer ve `Limited()` sayar; bırakma olayları (`k`/`m.btn` down=false, `k.release_all`) sınırdan muaf (takılı tuş kalmasın). 512 bayt sınırı `Parse`'ta sürüyor                                                                                                                                                                                                                                                                                                                                                | S7-8                        |
| `internal/win/win_windows.go`                              | `InputInjected()` = `GetCurrentInputMessageSource` (IMO_INJECTED; bilinmiyorsa known=false); WM_SYSKEYDOWN/WM_SYSCHAR/WM_LBUTTON* sabitleri                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | S7-5                        |
| `internal/ui/form_windows.go`                              | UI mesaj döngüsü her form girdi mesajının kaynağını kaydeder (sol tık = basış + bırakma, ikisi de yerel olmalı; Alt+İ = WM_SYSCHAR, kaynağı bilinmiyorsa onu üreten tuş basışı). `thread.userInput(f)`: şu an işlenen mesaj bu forma gelen, enjekte olmayan girdi mi; girdi mesajı işlenmiyorsa (başka süreçten WM_COMMAND/BM_CLICK) false                                                                                                                                                                                                                                                                                                                                                 | S7-5                        |
| `internal/ui/control_windows.go`                           | Ortak `consentDlg` (kontrol, monitör, **dosya teklifi**): `consentSpec` + `present()` (imleç dışında yerleşim, Reddet odağı, 1,5 sn kilidi yeniden başlatır); `tryGrant` olay-özgü kaynağa bakar; birden çok kırmızı uyarı satırı; yönetici uyarısı                                                                                                                                                                                                                                                                                                                                                                                                                                        | S7-5, S7-6, S7-9            |
| `internal/ui/screens_windows.go`                           | Oturum penceresinde "Erişime izin ver" artık izin **vermez**: bekleyen kontrol diyaloğunu `present()` ile öne getirir (imleç dışı + 1,5 sn + Reddet odağı); bekleyen istek varken etkin. Dosya teklifi ortak diyaloğa taşındı ("Kabul et" enjekte tıklamayla verilemez). Yönetici olarak çalışıyorsa oturum penceresinde kırmızı uyarı                                                                                                                                                                                                                                                                                                                                                     | S7-5, S7-6, S7-9            |
| `internal/env/probe_windows.go`, `cmd/noktadestek/main.go` | `env.SelfElevated()`; `u.SetElevated(...)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | S7-9                        |

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

| Dosya                                 | Değişiklik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Bulgu        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `internal/control/origin.go` (yeni)   | winuser.h adlarıyla `IMO_UNAVAILABLE=0, IMO_HARDWARE=1, IMO_INJECTED=2, IMO_SYSTEM=4`. Saf `OriginInjected(origin, ok)`: yalnız başarılı sorguda `IMO_HARDWARE` yerel, diğer her değer enjekte (fail-closed). `CharInjected(keyInjected, origin, ok)`: WM_CHAR/WM_SYSCHAR kaynağı yoksa tuş basışının kararı                                                                                                                                                                                                                                 | S7-12        |
| `internal/win/win_windows.go`         | Yanlış `imoInjected = 0x01` ve `InputInjected` kaldırıldı. Yerine yorumsuz `InputOrigin() (originId, ok)` geldi; karar `control`'da                                                                                                                                                                                                                                                                                                                                                                                                          | S7-12        |
| `internal/ui/form_windows.go`         | `track` kararı `control.OriginInjected`/`CharInjected` ile veriyor. Mesaj döngüsünde `t.cur` her mesaj işlendikten sonra sıfırlanıyor (`handle` ayrıldı)                                                                                                                                                                                                                                                                                                                                                                                     | S7-12, S7-14 |
| `internal/input/applier.go`           | `isRelease` yerine `heldReleaseLocked`: yalnız basılı tuş/düğmenin bırakılması sınırdan muaf. Basılı olmayan düğmeyi bırakma no-op (hareket de enjekte edilmez) ve jeton harcar                                                                                                                                                                                                                                                                                                                                                              | S7-13        |
| `internal/control/gate.go`            | Durum tek atomik `state = nesil<<1 \| açık`; her açılış yeni nesil. Kapanış dinleyicisi kapanan neslin değerini alır (`OnCloseGen`). `StillClosed(gen)` eklendi. `OnOpen`/`OnClose` imzaları değişmedi                                                                                                                                                                                                                                                                                                                                       | S7-16        |
| `internal/input/host_windows.go`      | `wmHooksOff` wParam'da nesil taşıyor. Kanca yalnız `gate.StillClosed(nesil)` ise kaldırılıyor; bayat Shut isteği yeni açılışın kancalarını kaldırmıyor. `Hooks(on)` → `post(msg, wp)`                                                                                                                                                                                                                                                                                                                                                        | S7-16        |
| `internal/signal/messages.go`         | ``EnvState.SelfElevated bool `json:"selfElevated"` `` (omitempty yok, strict zorunlu)                                                                                                                                                                                                                                                                                                                                                                                                                                                        | K8 / S7-9    |
| `internal/flow/control.go`, `flow.go` | **K8:** `Deps.SelfElevated`. Her `hello`'dan hemen sonra (closeControl'den sonra, monitör seçiminden önce) `helloEnv` ile tek `env.state` gidiyor; alanlar o an ölçülüyor, yoklayıcı yoksa false. İzleyici olayları yalnız son gönderilenden farklıysa gönderiliyor. `envKnown` kaldırıldı. **K6:** `onPeer` disconnected/failed/closed dalında `closeControl` sonucu "kontrol diyaloğu açıktı ve kapı kapalıydı" ise ek `control.state{VIEW,SYSTEM}` gidiyor. `closeControl` genel davranışı değişmedi; monitör diyaloğu mesajsız kapanıyor | K6, K8       |
| `cmd/noktadestek/main.go`             | `env.SelfElevated()` açılışta bir kez ölçülüyor; hem `u.SetElevated` hem `Deps.SelfElevated`                                                                                                                                                                                                                                                                                                                                                                                                                                                 | K8           |
| Testler                               | `control/control_test.go`, `input/input_test.go`, `flow/control_test.go`, `flow/flow_test.go` (fakeConn `env.state`'i ayrı `env` kanalına yazıyor), `signal/signal_test.go`                                                                                                                                                                                                                                                                                                                                                                  | —            |

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

| Yol                                | Auth                       | Ne yapar                                                                                         |
| ---------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------ |
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

| Yol                                | Auth                       | Ne yapar                                                                                                                                     |
| ---------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
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

| Dosya                                                     | Değişiklik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `internal/capture/cursor.go` (yeni, platformdan bağımsız) | `PointerShape` (Type/W/H/Pitch/Data) ve `Cursor` (Visible, X/Y = şeklin sol üst köşesi, masaüstü yönünde fiziksel piksel). `Size()` şekli doğrular: bilinmeyen tür, kısa tampon, yetersiz satır adımı, tek satır sayılı mono → geçersiz, çizilmez. `BlendPointer` BGRA yamasına çizer: **mono** AND/XOR (1 bpp, MSB önce; AND=1,XOR=0 saydam, 0/0 siyah, 0/1 beyaz, 1/1 ters), **renkli** düz alfa `(c·a + d·(255−a))/255`, **maskeli renkli** alfa 0 → kopya, ≠0 → XOR. `OverlayCursor` imleci masaüstü kenarında kırpar, altındaki pikselleri salt okunur yüzeyden yamaya alıp karıştırır. Yalnız imlecin örneklendiği çıkış 2×2 bloklarının Y/UV değerlerini, `ConvertBGRA` ile aynı formül ve aynı en yakın komşu eşlemesiyle yeniden hesaplar (döndürme ve kodlayıcı küçültmesi dahil) |
| `internal/capture/dxgi_windows.go`                        | `vtDuplGetPointerShape = 11` (IDXGIOutputDuplication vtable: GetDesc 7, AcquireNextFrame 8, …, GetFramePointerShape 11, ReleaseFrame 14) ve `dxgiOutduplPointerShapeInfo`. `acquire` bölündü: `updatePointer` konum ve görünürlüğü yalnız `LastMouseUpdateTime ≠ 0` iken alır. `PointerShapeBufferSize > 0` ise şekli yeniden kullanılan tampona okur. `copyFrame` önceki kopyalama koduyla aynı. **Davranış değişikliği:** yalnız imleç değiştiyse (`LastPresentTime == 0`) yeni yüzey kopyalanmıyor. Staging dokusu son masaüstü görüntüsünü tuttuğu için o yeniden eşleniyor ve `changed=true` dönüyor. Önceden fare hareketi kare üretmiyordu                                                                                                                                           |
| `internal/capture/source_windows.go`                      | `grab` içinde `ConvertBGRA`'dan sonra `OverlayCursor(p.frame, px, …, &p.dup.cur)` çağrılıyor. Süre `convCost`'a dahil (AC-41 hız denetimi bunu görüyor)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `internal/capture/cursor_test.go` (yeni)                  | Aşağıda                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

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

| Yol             | Auth                                                          | Ne yapar                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/history`      | Oturum + `session_history.view` (yoksa uyarı, menüde öğe yok) | Filtreli, sayfalı oturum geçmişi. Sorgu: `from`, `to` (YYYY-AA-GG, İstanbul günü), `status`, `mode` (AGENT/BROWSER), `technicianId` (ADMIN/SA), `tenantId` (yalnız firma seçmemiş SA), `customer`, `page`, `pageSize` (10/25/50/100; 1..100). Geçersiz değer API'ye gönderilmez, "yok sayıldı" uyarısı çıkar. "Dışa aktar (CSV)" yalnız `session_history.export` ile ve kayıt varken          |
| `/history/[id]` | Oturum + `session_history.view`                               | Özet (oluşturma/başlangıç/bitiş/süre, mod, teknisyen, [firma], müşteri adı/e-posta, sonlandıran + yönetici adı, bitiş nedeni), ticket + not formu (`session_history.edit`; yoksa salt okunur), onay kayıtları, kontrol dönemleri, zaman çizelgesi, kalite özeti, dosya meta verisi. Kapsam dışı/yok → "Oturum bulunamadı" (not-found; Next akışlı yanıtta HTTP 200 kalır, içerik 404 sayfası) |

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

| Yol                                       | Auth                                                                                              | Ne yapar                                                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/requests`                               | Oturum + `support_requests.view` (Super Admin firma seçmiş olmalı; seçmemişse "Önce firma seçin") | Bekleyen talepler kuyruğu (canlı, `/ws/panel`); Kabul et (`accept` → `/sessions/<id>/console`) / Reddet (diyalog); ses aç/kapa                                   |
| `/requests?tab=history[&status=][&page=]` | Aynı                                                                                              | Son 30 günün kapanan talepleri, durum filtresi (link), sayfalama (25)                                                                                            |
| `/requests#talep-<id>`                    | Aynı                                                                                              | Toast "Görüntüle" hedefi (kart vurgulanır)                                                                                                                       |
| `/settings/support-requests`              | Oturum + `settings.edit` (Super Admin firma seçmeli)                                              | İndirme bağlantısı + kopyala + onaylı "Bağlantıyı yenile", bekleme süresi 10–120, WhatsApp aç/kapa + ≤5 alıcı + test, e-posta pasif (P10), güvenilen IP/CIDR ≤10 |
| `/history?source=REQUEST\|TECH`           | Mevcut                                                                                            | P8 listesi + "Kaynak" filtresi; talepten doğan satırda "Talep" hapı (bekleme `title`/kartta görünür)                                                             |
| `/history/<id>`                           | Mevcut                                                                                            | Özet'te "Kaynak"; talepten doğan oturumda "Destek talebi" bölümü (talep/kabul zamanı, bekleme, ad, telefon, e-posta, açıklama düz metin)                         |

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

| Dosya                                                                               | Değişiklik                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `internal/pairing/pairing.go`                                                       | `RefFromFileName` (ADR-0006 r4 ifadesi, contracts `REQUEST_FILE_NAME_RE` ile aynı); 8 hane yolu aynen                                                                                                                                                                                                                                                       |
| `internal/api/api.go`, `requests.go`                                                | `do()` (GET/POST ortak), `Error.RetryAfter`, resolve gövdesine `clientVersion` (G-E9-4); `TenantInfo` (GET, en çok 3 deneme), `CreateRequest` (yeniden denemesiz), `CancelRequest`                                                                                                                                                                          |
| `internal/request/` (yeni)                                                          | `validate.go` (AC-134, zod eşi), `ws.go` (`/ws/request` strict şema + `Dial` `rs.v1, rs.req.<sır>`), `machine.go` (bekleme durum makinesi, `CANCELLING` yarışı), `policy.go` (503 yeniden deneme, sürüm karşılaştırma, indirme URL'si), `types.go`, `run.go` (firma bilgisi → form → talep), `wait.go` (bekleme, yeniden bağlanma, onay, kapanış ekranları) |
| `internal/remember/` (yeni)                                                         | `remember.go` (platformsuz depo: v1 JSON ≤ 4 KB, tmp O_EXCL + bir kez yeniden deneme, rename, unut + boşsa klasör), `dpapi_windows.go` (`CryptProtectData` CurrentUser + `UI_FORBIDDEN` + sabit entropi, `FOLDERID_LocalAppData\NoktaDestek`)                                                                                                               |
| `internal/flow/flow.go`, `messages.go`                                              | `RunTicket` (ön-kabul: kod/karşılama/join/lobi yok), `Deps.Admitted` (ilk `hello`'da bir kez), `UI.Connecting`, 426 `CLIENT_OUTDATED` → son ekran (kod modu)                                                                                                                                                                                                |
| `internal/ui/request_windows.go` (yeni), `control_windows.go`, `screens_windows.go` | Firma penceresi + form, engel ekranı, bekleme, onay (ortak `consentDlg`: `denyText`, `logo`), kapanış, `Connecting`                                                                                                                                                                                                                                         |
| `internal/win/win_windows.go`                                                       | `OpenURL` (yalnız `https://`), `BM_SETCHECK`                                                                                                                                                                                                                                                                                                                |
| `internal/signal/strict.go`, `messages.go`                                          | `DecodeStrict`, `IsISO` dışa açıldı (strict kural tek yerde)                                                                                                                                                                                                                                                                                                |
| `cmd/noktadestek/main.go`                                                           | Mod seçimi: firma dosyası → `request.Run`; `OutCodeMode` → `flow.Run`; `OutShare` → `flow.RunTicket` + `Release`                                                                                                                                                                                                                                            |
| `test/trace-check.ps1`                                                              | `-Remember on\|off`                                                                                                                                                                                                                                                                                                                                         |

### AC eşlemesi (istemci tarafı)

| AC            | Karşılık                                                                                                                                                                                                                                                                                                                                                                                                                                      | Test                                                                                                                                                                                                                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 133           | `pairing.RefFromFileName`; `request.loadInfo` (firma adı/logo yalnız sunucudan, footer sunucu+sürüm+SHA ilk 8, dolandırıcılık uyarısı, "Kötüye kullanımı bildir"); ağ/TLS ayrı mesaj + "Tekrar dene"; `minAgentVersion` → form yok, "Yeni sürümü indir" (`DownloadURL` sabit biçim, `win.OpenURL` yalnız https); 404 → "Bu dosya artık geçerli değil" + yalnız kod yolu                                                                       | `TestAC133RefFromFileNameMatchesContractsFixture`, `TestAC133InfoProblemsAndCodeMode`, `TestAC133OutdatedBlocksFormAndOpensFixedURL`, `TestAC133OutdatedAndDownloadURL`, `TestAC133TenantInfoGetWithRefNoOrigin`, `TestAC133ResolveOutdatedIsFinal` + Windows elle (≤ 5 sn)                          |
| 134           | `request.Validate` (ortak fixture `request-form.json`: telefon, ad, açıklama, e-posta); alan bazında hata + sunucu 400 `fields` aynı alanlara                                                                                                                                                                                                                                                                                                 | `TestAC134FormMatchesContractsFixture`, `TestAC134ValidateFieldErrorsAndOrder`, `TestAC134BoundaryLengths`, `TestAC134AC164ValidationErrorsFocusFirstField`                                                                                                                                          |
| 135 (form)    | KVKK metni + onay kutusu aynı formda; `consentTextId` 400 → firma bilgisi yeniden alınır, "Aydınlatma metni güncellendi"                                                                                                                                                                                                                                                                                                                      | (run.go `VALIDATION consentTextId` dalı)                                                                                                                                                                                                                                                             |
| 136           | Kutucuk varsayılan işaretsiz; yalnız 201 sonrası yazım; `deviceKey` yalnız hatırla açıkken üretilir/gönderilir; hatırlanan bilgiyle açılışta ipucu                                                                                                                                                                                                                                                                                            | `TestAC136SaveLoadOnlyAllowedFields`, `TestAC136CorruptOrForeignFileDeletedSilently`, `TestAC139AC154HappyPathRememberAndShare`, `TestAC136UncheckedSubmitForgetsAndSendsNoDeviceKey`                                                                                                                |
| 137           | "Bilgilerimi unut": dosya + tmp + boşsa klasör, form boşalır, "Bilgileriniz silindi"; işaretsiz gönderimde silme                                                                                                                                                                                                                                                                                                                              | `TestAC137ForgetRemovesFileAndEmptyDir`, `TestAC137ForgetKeepsNonEmptyDir`, `TestAC137ForgetClearsForm` + `trace-check.ps1 -Remember off`                                                                                                                                                            |
| 138           | Tek iz `hatirla.bin`                                                                                                                                                                                                                                                                                                                                                                                                                          | `trace-check.ps1 -Remember on` (Windows elle)                                                                                                                                                                                                                                                        |
| 139           | Bekleme ekranı: talep kodu `123 456` büyük punto, "Sırada n. talepsiniz", geçen süre (serverTime−createdAt + yerel), 1 sn yenileme                                                                                                                                                                                                                                                                                                            | `TestAC139StateOnlyWhileWaiting`, mutlu yol testi                                                                                                                                                                                                                                                    |
| 141           | "Talebi iptal et" → `request.cancel` (+ 4 sn yanıt beklemesi, sonra 1000); pencere kapatma → `request.cancel` + 1000; soket yoksa REST iptal; kopmada 110 sn içinde aynı sırla yeniden bağlanma                                                                                                                                                                                                                                               | `TestAC141WindowCloseSendsCancelThenClose`, `TestAC141CancelTimeoutEndsWithIntent`, `TestAC141ReconnectAfterDropAnd403Ends`, `TestAC141CancelRequest204`                                                                                                                                             |
| 142           | EXPIRED → "Talebiniz zaman aşımına uğradı" + "Yeniden talep oluştur" (form dolu)                                                                                                                                                                                                                                                                                                                                                              | `TestAC142ExpiredRecreateKeepsForm`, `TestAC142AC157ClosedViews`                                                                                                                                                                                                                                     |
| 154           | `request.accepted` → onay diyaloğu (ortak `consentDlg`: odak "Vazgeç", 1,5 sn kilit, Enter/Space paylaşmaz, yalnız donanım tıklaması + enjekte uyarısı, imleç dışında, `FlashWindow`); teknisyen adı, doğrulama kodu, talep kodu, kalan süre; "Ekranımı paylaş" → `/ws/guest` ticket; `/ws/request` **hello gelene kadar açık** kalır (öncesinde 1000 sunucuda vazgeçme sayılır); `CANCELLING`'de gelen kabul yok sayılır + `request.decline` | `TestAC154AcceptedThenShare`, `TestAC154ShareIgnoredBeforeAccept`, `TestAC154CancellingIgnoresLateAccept`, `TestAC154DeclineAndWindowCloseWhenAccepted`, `TestAC154CancelRaceDeclinesLateAccept`, `TestAC154WsRequestMatchesContractsFixture`, `TestAC154AC156RunTicketSkipsLobbyAndSignalsAdmitted` |
| 155 (istemci) | Kalan süre 0 → "Bağlantı süresi doldu", soket **1001** ile kapanır (sunucu CONNECT_FAILED yazar, "müşteri vazgeçti" değil)                                                                                                                                                                                                                                                                                                                    | `TestAC155TicketExpiry`                                                                                                                                                                                                                                                                              |
| 156           | `RunTicket` sonrası P7 yolu değişmeden (`session.run`)                                                                                                                                                                                                                                                                                                                                                                                        | `TestAC154AC156RunTicketSkipsLobbyAndSignalsAdmitted` + mevcut P7 testleri                                                                                                                                                                                                                           |
| 157           | REJECTED → "Firmanızın mesajı:" + düz statik metin (`SS_NOPREFIX`, bağlantı değil)                                                                                                                                                                                                                                                                                                                                                            | `TestAC142AC157ClosedViews`                                                                                                                                                                                                                                                                          |
| 161           | Ad eşleşmezse 8 hane / elle kod akışı aynen; mevcut tüm Go testleri değişmeden yeşil (yalnız resolve gövde testi `clientVersion` için güncellendi)                                                                                                                                                                                                                                                                                            | `TestAC161FileNameModesAreDisjoint`, tüm `go test ./...`                                                                                                                                                                                                                                             |
| 162           | "Teknisyenden kod aldım" (form, engel ekranları) → `flow.Run(ctx, deps, "")`                                                                                                                                                                                                                                                                                                                                                                  | main.go + Windows elle                                                                                                                                                                                                                                                                               |
| 163           | Kurulum/servis/tepsi yok; bekleme penceresi kapatma → iptal + süreç sonu (`OutClose` → `exitOK`)                                                                                                                                                                                                                                                                                                                                              | `TestAC136UncheckedSubmitForgetsAndSendsNoDeviceKey` (kapatma yolu) + Windows elle                                                                                                                                                                                                                   |
| 164           | Tab sırası = oluşturma sırası ((varsa) kötüye kullanımı bildir → ad → telefon → e-posta → açıklama → metin → onay → hatırla → unut → Destek iste → kod → kapat); Enter = "Destek iste" (`BS_DEFPUSHBUTTON`, açıklama `ES_WANTRETURN`'süz); hatada ilk hatalı alana odak                                                                                                                                                                       | `TestAC134AC164ValidationErrorsFocusFirstField` + Windows elle                                                                                                                                                                                                                                       |

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

| Madde         | Düzeltme                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Dosya                                                                                                                        | Test                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| S8b2-1 [Orta] | Saf karar `rememberPlan`: ad **veya** telefon hatırlanandan farklıysa ve müşteri kutuya bu oturumda dokunmadıysa (`Form.RememberChosen=false`) kayıt yok, eski dosya silinir, `deviceKey` gönderilmez. Müşteri kutuyu kendisi işaretlediyse kişi değişince **yeni** `deviceKey`. Arayüz: ad/telefon `EN_CHANGE` (programatik `SetText` hariç) kutuyu, müşteri dokunmadıysa, işaretsize çeker; `BN_CLICKED` → `chosen`                                                                                                                                                                             | `request/run.go`, `request/validate.go` (`Form.RememberChosen`), `ui/request_windows.go`                                     | `TestAC136RememberPlan`, `TestAC136ChangedIdentityNotSavedWithoutOptIn`                          |
| QA-P8b2-1     | `remember.NewDeviceKey` (ve test kullanımı) kaldırıldı; tek üretim yolu `request.newKey()` (`clientInstanceId` + `deviceKey`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `remember/remember.go`, `remember_test.go`, `request/run.go`                                                                 | mevcut testler                                                                                   |
| QA-P8b2-2     | `forget()` başarısızlığı yutulmuyor: `forgetWarn`, başarılı bir silmeye kadar formda (`Notice` başına) ve bekleme ekranında (`WaitView.Warning`; yeniden bağlanma bildirimiyle silinmez) görünür. "Bilgilerimi unut" başarısızsa "silindi" denmez                                                                                                                                                                                                                                                                                                                                                 | `request/run.go`, `request/wait.go`, `request/types.go`, `ui/request_windows.go`                                             | `TestAC137ForgetFailureVisible`, `TestAC137ForgetButtonFailureVisible`                           |
| S8b2-2        | `/ws/request` dial: her başarısız denemeden sonra (429, ağ hatası dahil) `dialRetryDelay`: 2→4→8→15 sn + 0..1 sn `crypto/rand` jitter; `Retry-After` (upgrade yanıtı, `DialError.RetryAfter`) en az o kadar, ≤ 60 sn; bekleme kalan kopma bütçesini (110 sn < sunucu 120 sn) aşmaz. `api.retryAfter` → `api.ParseRetryAfter` (REST ve WS aynı kural)                                                                                                                                                                                                                                              | `request/policy.go`, `request/wait.go`, `request/ws.go`, `api/api.go`                                                        | `TestS8b22DialRetryDelay`, `TestS8b22DialBackoffInWaitLoop`                                      |
| S8b2-3        | Tek süzgeç `request.Display`: satır/paragraf ayırıcı ve sekme → boşluk, diğer Cc/Cf (bidi dahil), U+034F, U+180E çıkarılır. Uygulandığı yerler: `tenant.name` (loadInfo), `technicianName` (boşsa "Teknisyen"), `request.closed.message`, WS `error.message`, REST hata `message`/`fields`. Reddetmek yerine süzme seçildi (kaynak TLS doğrulamalı gömülü sunucu; müşteri engellenmez). Açık onay diyaloğuna **farklı** teknisyen adıyla yeni `request.accepted` gelirse diyalog kapatılıp yeniden açılır (başlık doğru, 1,5 sn kilit yeniden başlar); aynı adla gelirse yalnız gövde güncellenir | `request/validate.go`, `request/ws.go`, `request/run.go`, `ui/request_windows.go`, `ui/screens_windows.go` (`reqAcceptTech`) | `TestS8b23Display`, `TestS8b23ServerTextsSanitized`; başlık yenileme Windows elle                |
| QA öneri 2    | `Outcome.Release(ReleaseKind)`: `ReleaseAdmitted` (hello → 1000), `ReleaseAbandoned` (müşteri vazgeçti/sunucu bitirdi → 1000, kopuksa REST iptal), `ReleaseFailed` (hello'dan önce ağ/protokol hatası → **1001**, REST iptal yok). `flow.Outcome.Failed` yalnız `/ws/guest` kurulamadı/koptu/protokol ihlali yollarında true. mimari-protokol §5.1 kapanış semantiğiyle tutarlı: 1001 ACCEPTED talebi değiştirmez, 60 sn sonra CONNECT_FAILED / `connect_timeout` ("Müşteri bağlanamadı")                                                                                                         | `request/types.go`, `request/wait.go`, `flow/flow.go`, `cmd/noktadestek/main.go`                                             | `TestAC154ReleaseKinds`, `TestRunTicketDialFailureIsFailed`, flow testlerinde `Failed` iddiaları |
| QA öneri 3    | "Kötüye kullanımı bildir" dolandırıcılık uyarısının hemen ardından oluşturuluyor; Tab sırası belgesi (kod yorumu + AC-164 satırı) güncellendi; açılış odağı yine ad alanı                                                                                                                                                                                                                                                                                                                                                                                                                         | `ui/request_windows.go`                                                                                                      | Windows elle (madde 5 klavye kaydı)                                                              |

**Sözleşme:** Sunucu/contracts değişmedi; frontend-dev için değişiklik yok.
**teknik-yazar için:** Kılavuza (S8b2-1) "Hatırlanan bilgilerden ad veya telefonu değiştirirseniz 'Bilgilerimi bu bilgisayarda hatırla' kutusu kendiliğinden kaldırılır; yeni bilgileri hatırlatmak için kutuyu yeniden işaretleyin." cümlesi eklenmeli.
**Windows elle ek adımlar:** (a) hatırlanan veriyle açılan formda adı değiştir → kutu işaretsize düşmeli; yeniden işaretleyip gönder → yeniden açılışta yeni ad; (b) `hatirla.bin`'i başka süreçte kilitli tutup işaretsiz gönder → bekleme ekranında "Bilgileriniz silinemedi…" görünmeli; (c) onay diyaloğu açıkken teknisyen değişimi (ikinci teknisyen yeniden kabul) → başlık yeni adla, kilit yeniden; **aynı adlı teknisyen senaryosu (S8b2-4):** panelde aynı görünen adla iki teknisyen hesabı aç; biri kabul etsin, diyalog açıkken diğeri yeniden kabul etsin → başlık aynı kalsa da diyalog kapanıp yeniden açılmalı, gövdede **yeni** doğrulama kodu görünmeli ve "Ekranımı paylaş" 1,5 sn yeniden devre dışı olmalı; aynı teknisyen ağ kopması sonrası yeniden kabul ederse (aynı ad + aynı kod) diyalog yerinde kalır, kilit yeniden başlamaz.

**Doğrulama** (docker `golang:1.26.11-bookworm@sha256:dc40a1…`, `-mod=readonly`, `GOTOOLCHAIN=local`): `gofmt -l .` boş; `go test -count=1 ./...` 17 paket ok (186 üst düzey PASS, 0 FAIL); `go test -race` (request, remember, flow) ok; `go vet ./...` ve `GOOS=windows GOARCH=amd64 go vet ./...` temiz. `build/build.sh https://remote.noktabilisim.net 0.9.0` iki kez (arada `go clean -cache`) → iki ikili SHA-256 `f3df8585837ca578b26653d6f76277bbdaad30d755ba401ebab6fc699ff49a78` (eşit, 12 304 384 bayt).

### Backend (Go) P8b-2 — düzeltme turu 2 (backend-dev, 2026-11-12)

Kaynak: `docs/guvenlik-raporu.md` S8b2-4 [Düşük] ve `docs/qa-raporu.md` önerisi. Yeni bağımlılık yok; go.mod/go.sum, sunucu/contracts değişmedi — frontend-dev için değişiklik yok.

| Madde                  | Düzeltme                                                                                                                                                                                                                                                                                                                                                   | Dosya                                                                                               | Test                                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| S8b2-4 [Düşük]         | Açık onay diyaloğu `TechName + TechVerifyCode` ile eşleştirilir. Saf, platformdan bağımsız karar `acceptDecision(open, cur, next acceptKey)`: diyalog yok/karar verilmiş → aç; aynı ad + aynı kod → gövde yerinde güncellenir; ad **veya** kod farklı → kapat, yeniden aç (1,5 sn kilit yeniden başlar). `reqAcceptTech string` → `reqAcceptKey acceptKey` | `ui/accept.go` (yeni), `ui/accept_test.go` (yeni), `ui/request_windows.go`, `ui/screens_windows.go` | `TestS8b24AcceptDecision`; diyalog davranışı Windows elle (c)                                                                                      |
| QA öneri (sürü etkisi) | Kopmadan sonra (`lost`) ilk `/ws/request` denemesi de `Deps.Jitter(retryJitter)` = 0..1 sn `crypto/rand` jitter bekler (`startDial(start, first)`); ilk bağlantı beklemez; bekleme `wctx` iptaliyle kesilir. Sonraki denemeler mevcut `dialRetryDelay`                                                                                                     | `request/wait.go`                                                                                   | `TestAC141ReconnectAfterDropAnd403Ends` güncellendi (ilk bağlantıda `After` çağrılmaz; kopma sonrası tek bekleme = jitter, jitter üst sınırı 1 sn) |

**Doğrulama** (docker `golang:1.26.11-bookworm@sha256:dc40a1…`, `-mod=readonly`, `GOTOOLCHAIN=local`): `gofmt -l .` boş; `go test -count=1 ./...` 17 paket ok (187 üst düzey PASS, 0 FAIL); `go test -race -count=3` (request, ui) ok; `go vet ./...` ve `GOOS=windows GOARCH=amd64 go vet ./...` temiz. `build/build.sh https://remote.noktabilisim.net 0.9.0` iki kez (arada `go clean -cache`) → SHA-256 `eab236227aad20747847cf64999160cafa83e7a56a9b5cbe2d7daf0416b127c8` (iki ikili eşit, 12 305 920 bayt). Windows elle test adımı (c) aynı adlı teknisyen senaryosuyla genişletildi (yukarıda).

## Düzeltme — TURN'süz ilk teklif (siyah ekran) (backend-dev, 2026-11-12)

Küçük hata düzeltmesi (AC gerekmez); kaynak `docs/gereksinimler-sonra-acik.md` "İlk teklifte TURN yok". Yeni bağımlılık yok; contracts/WS şeması değişmedi.

**Neden:** Teknisyen odaya önce girip PENDING bekliyorsa (talepten doğan oturumlar dahil) `hello{tech}` boş ICE listesi taşır (G-01). Admit'te `scheduleActive` teknisyene önce `peer.joined`, sonra `ice.servers` gönderiyordu; konsol `peer.joined` ile hemen `new PeerLink([])` + offer üretiyor, ardından gelen liste `have-local-offer` durumunda restart tetiklemediği için ICE toplama TURN/STUN'suz bitiyordu → farklı NAT'larda siyah ekran.

| Katman                  | Düzeltme                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Dosya                                                                            | Test                                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sunucu                  | Admit sonrası teknisyene `ice.servers` artık `peer.joined`'dan **önce** gider (G-01 korunur: yine yalnız admit sonrası). `peer.joined`'a iceServers eklenmedi (sözleşme değişmesin)                                                                                                                                                                                                                                                                                                                            | `apps/server/src/signaling/active.ts` (`scheduleActive`)                         | `signaling-rooms.test.ts` "AC-112/G-01: teknisyen admit sonrası ice.servers'ı (TURN'lü) peer.joined'dan ÖNCE alır"                                                   |
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

| Uç                                          | Yetki                                                         | Not                                                                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/customers`                     | customers.view                                                | `q` (≥2; ad/yetkili/telefon, Türkçe katlama), `status=active\|passive\|all`, `page`, `pageSize≤100` (vars. 50), `sort=name:asc\|createdAt:desc`; sayaçlar tek `groupBy` |
| `GET /customers/general-link`               | customers.view                                                | salt okunur Genel bağlantı                                                                                                                                              |
| `GET /customers/options`                    | customers.view ∨ support_requests.view ∨ session_history.view | ≤20, `status=active\|all`                                                                                                                                               |
| `POST /customers`                           | customers.create                                              | 201; ad çakışması 409 `fields.name`                                                                                                                                     |
| `GET/PATCH /customers/:id`                  | view / edit                                                   | PATCH yalnız değişen alanlar; boşaltma (`null`/`""`)                                                                                                                    |
| `POST /customers/:id/rotate-ref`            | edit                                                          | yeni ref + müşteri kayıtları CUSTOMER_ROTATED                                                                                                                           |
| `POST /customers/:id/deactivate`            | **delete**                                                    | 409 zaten pasif; kayıtlar CUSTOMER_PASSIVE; bekleyenler CANCELLED/CUSTOMER_PASSIVE                                                                                      |
| `POST /customers/:id/reactivate`            | edit                                                          | **yeni** ref                                                                                                                                                            |
| `GET /customers/:id/requests` · `/sessions` | view + support_requests.view · view + session_history.view    | vars. 25, yeniden eskiye; oturumlar `historyScope`                                                                                                                      |
| `POST /support-requests/:id/revoke-binding` | customers.edit                                                | 204; kayıt zaten geçersiz 409; kayıtsız talep 404; bekleyenler BINDING_REVOKED                                                                                          |
| `POST /public/bindings/status`              | AGENT (çerezsiz)                                              | `{bindingKey, clientVersion}` → `TenantRequestInfo + customer{name}\|null`; geçersiz/hiç yok → tek 404 `BINDING_INVALID`                                                |
| `POST /public/bindings/revoke`              | AGENT                                                         | her durumda 204 (oracle yok); etkin satır → FORGOTTEN                                                                                                                   |
| `POST /public/requests`                     | —                                                             | `ref` (Genel **veya** müşteri ref'i) **ya da** `bindingKey` (tam biri)                                                                                                  |
| `POST /sessions`                            | sessions.create (+ customers.view `customerId` varsa)         | `{}` veya `{customerId}`; pasif/başka tenant 404                                                                                                                        |
| WS `/ws/guest`                              | —                                                             | ≥0.10.0 AGENT'a hello sonrası `binding.offer`; `binding.request{previousKey?}` → `binding.issued` (yalnız isteyen sokete); oturum başına 3                              |

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

| Komut                                      | Sonuç                                                                                                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm -r run typecheck`                    | contracts, web, server: temiz                                                                                                                                                               |
| `pnpm -r run lint`                         | temiz                                                                                                                                                                                       |
| `pnpm -r run test`                         | contracts 64/64, web 172/172, server unit 285/285                                                                                                                                           |
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

| Yol                                | Auth | Yetki                                                                                    | Ne yapar                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | ---- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/customers`                       | Evet | `customers.view` (menü öğesi de bununla)                                                 | Müşteri listesi: Genel bağlantı şeridi (salt okunur, Kopyala), arama (`?q=`, ≥ 2 karakter, 300 ms), durum (`?status=active\|passive\|all`), `?page=` (50/sayfa), Yeni müşteri (`customers.create`), "Müşteriye nasıl gönderilir?" yardım diyaloğu. Super Admin firma seçmeden → "Önce firma seçin" |
| `/customers/[id]`                  | Evet | `customers.view`; düzenle/yenile/aktif et `customers.edit`, pasife al `customers.delete` | Müşteri detayı: bağlantı (Kopyala, Bağlantıyı yenile), bilgiler, durum eylemleri, sekmeler Talepler (`support_requests.view`) / Oturumlar (`session_history.view`; yoksa kilitli durum). Yok/başka tenant → 404 sayfası                                                                            |
| `/requests?customer=general\|<id>` | Evet | `support_requests.view`                                                                  | Kuyruk ve Geçmiş sekmesinde müşteri filtresi (Tümü / Genel / müşteri seç + combobox); kartta firma satırı, kayıtlı bilgisayar rozetleri, "Diğer" menüsünde kayıt iptali (`customers.edit`)                                                                                                         |
| `/history?customerFirm=none\|<id>` | Evet | `session_history.view`                                                                   | Oturum geçmişi müşteri firma filtresi (sorgu adı backend'in `customerFirm`'ü; P8 `customer` misafir adı araması olarak kalır), "Müşteri firma" sütunu; detayda firma (bağlantı `customers.view` ile)                                                                                               |
| `/sessions` → Yeni destek oturumu  | Evet | `sessions.create` (+ `customers.view` → müşteri seçimi)                                  | Yetki varsa önce isteğe bağlı "Müşteri firma" combobox'ı (yalnız aktif) + "Oturum oluştur"; yetki yoksa bugünkü gibi anında oluşturur. Oluşan kartta firma adı                                                                                                                                     |
| `/settings/support-requests`       | Evet | `settings.edit`                                                                          | Bağlantı bölümünün adı "Genel bağlantı" (davranış aynı, AC-175)                                                                                                                                                                                                                                    |

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

| Madde          | Yapılan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-P8c-1 (Orta) | Talep TX'inde `lockSettings`'ten sonra müşteri `SELECT status … FOR SHARE` (`customers/repo.shareStatus`); ACTIVE değilse ref yolunda tek 404 `REQUEST_REF_INVALID`, kayıt yolunda `BINDING_INVALID` (ikisi de `req.ref_invalid` kovası). Kabul TX'inde müşteri, talep satırından **önce** FOR SHARE ile okunur (pasife alma ile aynı kilit sırası customers → support_requests; bu **kabul yolunda** döngü yok — §15.4 kayıt verme yolu ters sıralı, bkz. düzeltme turu 2 / B-P8c2-2); pasifse kabul yok → talep commit sonrası `CANCELLED(CUSTOMER_PASSIVE)` + 409 `REQUEST_CLOSED`. Pasife alma bekleyenleri artık **kendi TX'inde** iptal eder (kullanıcı aktörlü `request.cancelled` audit), commit sonrası `closedAfterCommit`; süpürücü yalnız yedek |
| B-P8c-2 (Orta) | QA 1–5 testleriyle kapandı (aşağıda)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| B-P8c-3        | `revoke-binding` = `support_requests.view` + `customers.edit`; web `requests/page.tsx` `canRevoke` ikisini birden arar; mimari-e10 §15.2'ye not                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| B-P8c-4        | `rs_binding_denied_total{reason: stale_source\|inactive\|rate\|no_offer\|browser}`; `stale_source` ve `inactive` için `binding.denied{reason}` audit (oturum başına ≤ 3 istek → sel yok); runbook metrik satırı                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| B-P8c-5        | Biçim dışı `bindingKey`: `/public/bindings/status` ve `/public/requests` → 404 `BINDING_INVALID` + `req.ref_invalid` kovası (yalnız `clientVersion` hatası 400)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| B-P8c-6        | `cancelledRequests` = aynı TX'te gerçekten iptal edilen sayı (B-P8c-1 ile)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| QA 8           | `docs/mimari-akislar.md` A7a/A7b/A7c sequence diyagramları                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| QA 9           | P8c-1 Backend "sapmalar" madde 7'ye `session-history-p8` CHECK 17→19 gerekçesi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

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

| Komut                            | Sonuç                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm -r run typecheck`          | contracts / web / server temiz                                               |
| `pnpm -r run lint`               | temiz                                                                        |
| `pnpm -r run test`               | contracts 64/64, web 172/172, server unit 285/285                            |
| `apps/server: pnpm run test:int` | **37 dosya, 355/355** (342 + 13); eşzamanlı test ayrıca 3 kez art arda yeşil |

### frontend-dev için

- `revoke-binding` artık `support_requests.view` da istiyor (403 aksi); panel koşulu güncellendi. İsterseniz e2e mock'u
  (`e2e/mock-customers.mjs`) aynı koşula getirin — bu turda e2e'ye dokunulmadı.
- Kabulde müşteri pasifse yanıt 409 `REQUEST_CLOSED` (mevcut kod; yeni kod yok) ve talep `CANCELLED/CUSTOMER_PASSIVE` olarak
  kuyruktan düşer (`request.removed`).

## P8c-1 — düzeltme turu 2 (backend) (backend-dev, 2026-11-12)

Kaynak: `docs/guvenlik-raporu.md` "E10/P8c-1 — Kod turu 2" (B-P8c2-1, B-P8c2-2, gözlem). Sözleşme değişikliği yok.

| Madde            | Değişiklik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B-P8c2-1         | `test/integration/bindings-p8c.test.ts`: düz metin TURN secret → `FAKE_TURN_SECRET` (`test/helpers/secrets.ts`). Allowlist genişletilmedi. gitleaks v8.30.1 `dir /repo/apps/server --redact --config .gitleaks.toml` → **no leaks found, çıkış 0**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| B-P8c2-2         | `customers/service.ts`: `withRefRetry` → `withTxRetry`; ref çakışması (en çok 5) korunur, ek olarak `isTransientDbError` (P2028/P2034, 1205/1213, 45028) için **tek** yeniden deneme. `deactivateCustomer` artık da bu sarmalayıcıdan geçer; `rotateCustomerRef`, `reactivateCustomer`, `createCustomer` aynı sarmalayıcıyı zaten kullanıyordu (geçici hata denemesi onlara da uygulanır — geri alınan TX audit/revoke'u da geri aldığı için çift yazım yok). İkinci geçici hata mevcut davranışla 503 `NOT_READY` + `Retry-After`. Düzeltme turu 1'deki "kilitlenme yok" ifadesi kabul yoluyla sınırlandırıldı: §15.4 yolu (`device_bindings X → customers S`) ile pasife alma/yenileme (`customers X → device_bindings`) arasında 1213 mümkün; iki taraf da artık tek kez yeniden dener. |
| Gözlem (B-P8c-1) | Talep TX'indeki `shareStatus` dalını doğrudan sınayan regresyon testi: `RequestService.prototype.resolveRef` sarılıp peek ACTIVE döndükten sonra müşteri pasife çekilir → 404 `REQUEST_REF_INVALID`, talep satırı yok.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Sapma: `customers/service.ts` biçimlendirmesi düzenleme sırasında prettier ile (printWidth 200) yeniden yazıldı; davranış farkı yok, yalnız birkaç nesne literali çok satırlı oldu (projede prettier yapılandırması yok, eslint temiz).

Yeni testler (`bindings-p8c.test.ts`, +4): B-P8c-1 TX içi kilitli kontrol; B-P8c2-2 pasife alma ve ref yenileme ilk denemede P2034/1213 → 200 + tek audit; iki ardışık geçici hata → 503 `NOT_READY`, müşteri ACTIVE. Geçici hata, `testDb().$transaction` üzerine `vi.spyOn(...).mockRejectedValueOnce` ile Prisma 7 bağdaştırıcı şeklinde (`P2034`, `meta.driverAdapterError.cause.code = 1213`) enjekte edilir. Mutasyon kontrolü: TX içi `shareStatus` kontrolü ve `TRANSIENT_RETRIES` kapatılınca ilgili 3 test kırmızı.

### Doğrulama (geçici DB `rs-mysql-p8c-fix2`, port 33324 — iş sonunda silindi)

| Komut                                       | Sonuç                           |
| ------------------------------------------- | ------------------------------- |
| `apps/server: pnpm typecheck` / `pnpm lint` | temiz                           |
| `apps/server: pnpm test`                    | 285/285                         |
| `apps/server: pnpm test:int`                | **37 dosya, 359/359** (355 + 4) |
| gitleaks `dir /repo/apps/server`            | no leaks found, çıkış 0         |

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

| Dosya                                                                                                    | Değişiklik                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `internal/launch/{decide.go, run.go, keeper.go}` (yeni) + `decide_test.go`, `run_test.go`                | §8.1 karar tablosu (`Decide`, saf), açılış yürütme (resolve/firma bilgisi bir kez; `onceResolve` ile kod akışına aktarılır), `keeper` = `flow.BindingHandler` (DPAPI'ye yazar, AC-187 etiketi), "Bu bilgisayarı unut" (önce yerel silme, sonra yalnız aynı kökenli anahtarla revoke) |
| `internal/remember/{data.go (yeni), origin.go (yeni), remember.go, dpapi_windows.go, remember_test.go}`  | Format v2 (`personal`, `binding`, `deviceKey`), v1 bellekte yükseltme, ilk yazımda v2; `SavePersonal/ClearPersonal/SaveBinding/ClearBinding/ForgetAll`, oku-değiştir-yaz tek kilit; `CanonicalOrigin`; `NoticeText` (AC-188). Entropi değişmedi                                      |
| `internal/api/{bindings.go (yeni), requests.go}` + `bindings_test.go`                                    | `BindingStatus`, `RevokeBinding`; `CreateRequestBody.Ref/BindingKey` `omitempty`                                                                                                                                                                                                     |
| `internal/signal/messages.go` + `binding_test.go`                                                        | `binding.offer`, `binding.issued` sıkı ayrıştırma; `BindingRequest`                                                                                                                                                                                                                  |
| `internal/flow/{flow.go, binding.go (yeni), messages.go}` + `binding_test.go`                            | `Deps.Binding`, `Outcome.BindingChanged`, `Welcome.RememberNote`, `ResolveMessage`                                                                                                                                                                                                   |
| `internal/request/{types.go, run.go, home.go (yeni), wait.go, ws.go}` + `home_test.go`, mevcut testler   | Ana ekran, kayıt modu, AC-185 yolu, `CUSTOMER_PASSIVE`/`BINDING_REVOKED`, `Remember` v2 arayüzü                                                                                                                                                                                      |
| `internal/ui/{home.go, home_windows.go (yeni), request_windows.go, screens_windows.go}` + `home_test.go` | Ana ekran, AC-188 satırları, düğme metni, oturum sonu notu                                                                                                                                                                                                                           |
| `cmd/noktadestek/main.go`                                                                                | Mod seçimi `launch.Run` (161 satır; ≤ 100 hedefi tutmadı: UI/girdi/kısayol kurulumu main'de kaldı, davranış değişmesin diye taşınmadı)                                                                                                                                               |
| `test/trace-check.ps1`                                                                                   | `-Binding on                                                                                                                                                                                                                                                                         | off` |

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

| Eski test                                                    | Yeni test                                                                                                                                                                   | Değişiklik türü                                                                                                                                                                                             | Assert değişti mi                                               |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `remember.TestAC136SaveLoadOnlyAllowedFields`                | aynı ad                                                                                                                                                                     | API uyarlaması (`Save` → `SavePersonal`, `Load` → `LoadPersonal`) + v2 biçim beklentisi                                                                                                                     | **Evet:** sürüm 1 → 2, yasak anahtar araması tırnaklı           |
| `remember.TestAC137ForgetRemovesFileAndEmptyDir`             | **geri getirildi** (aynı ad, `ClearPersonal` ile; kayıt yokken dosya + tmp + boş klasör silinir, ikinci çağrı hatasız) + yeni `TestAC186ForgetAllRemovesFileTmpAndEmptyDir` | API uyarlaması                                                                                                                                                                                              | Hayır (aynı üç iddia)                                           |
| `remember.TestAC137ForgetKeepsNonEmptyDir`                   | aynı ad                                                                                                                                                                     | API uyarlaması (`Forget` → `ClearPersonal`)                                                                                                                                                                 | Hayır + ek iddia (dosya silinmiş)                               |
| `remember.TestGE913StaleTmpRetriedOnce`                      | aynı ad                                                                                                                                                                     | API uyarlaması                                                                                                                                                                                              | Hayır                                                           |
| `remember.TestAC136CorruptOrForeignFileDeletedSilently`      | aynı ad                                                                                                                                                                     | Tablo genişledi (v2 bozuk biçimleri). `"yanlış sürüm"` vakası **aynı adla geri getirildi** (v1 alanlarıyla `v:2` → reddedilir). İlk turda yalnız adı değişmişti ("v1 biçimi v2 etiketiyle"); içerik aynıydı | Hayır (aynı vakalar + yeni vakalar)                             |
| `remember.TestSaveRejectsInvalidData`                        | aynı ad                                                                                                                                                                     | API uyarlaması + kayıt vakaları                                                                                                                                                                             | Hayır + ek iddialar                                             |
| `request.TestAC136RememberPlan` (`hardening_test.go`)        | aynı ad                                                                                                                                                                     | Tip uyarlaması (`remember.Data{V:1,…}` → `remember.Personal{…}`)                                                                                                                                            | Hayır                                                           |
| `hardening_test.go` diğerleri, `run_test.go` (`memRemember`) | aynı adlar                                                                                                                                                                  | Sahte depo yöntemleri `Load/Save/Forget` → `LoadPersonal/SavePersonal/ClearPersonal`; tip `remember.Personal`                                                                                               | Hayır (`forgot` sayacı `ClearPersonal`'da artar, iddialar aynı) |
| `request` testlerinin sahte UI'ı (`fakeUI`)                  | —                                                                                                                                                                           | `RequestHome` eklendi. Varsayılan dönüş `HomeSupport` (kaynak yoksa `HomeClose`); böylece E9 testleri ana ekrandan doğrudan forma geçiyor (S2)                                                              | Hayır                                                           |
| `request` sahte API (`fakeAPI`)                              | —                                                                                                                                                                           | `BindingStatus` eklendi (arayüz genişledi)                                                                                                                                                                  | Hayır                                                           |
| `flow`, `signal`, `api`, `pairing` eski testleri             | —                                                                                                                                                                           | Değişmedi                                                                                                                                                                                                   | —                                                               |

### Doğrulama

`gofmt -l .` temiz. `GOOS=windows go vet ./...` ve linux `go vet ./...` temiz. `go test -count=1 ./...`: 18 paketin hepsi geçti. Tüm Windows test ikilileri derlendi. go.mod ve go.sum değişmedi.
Derleme: `build.sh https://remote.noktabilisim.net 0.10.0` iki ayrı docker koşusunda çalıştırıldı, ikisi aynı çıktı:
**SHA-256 `5255edc87840f18b28eb608c705bf2c16230a3a7cb0da49145a46e5ecbf721f3`** (12.376.576 bayt). Dosyalar `/private/tmp/claude-501/-Users-mennan-Projeler-Remote/fa15848a-dcdd-4f1b-abf9-1c72703d5eac/scratchpad/agent-0.10.0-r2/{1,2}/NoktaDestek.exe`. İlk turdaki `716e9f98…` geçersiz.
Elle test adımları değişmedi. Adım 10'a ek olarak: sunucu ya da proxy kodsuz 404 dönerse kayıt korunur ve "Sunucuya ulaşılamıyor" + "Tekrar dene" görünür.

**Değişen dosyalar (bu tur):** `internal/request/{run.go, home.go, home_test.go}`, `internal/flow/{flow.go, binding.go, binding_test.go}`, `internal/launch/{run.go, run_test.go}`, `internal/remember/remember_test.go`, `docs/implementation.md`.

## Düzeltme — istemci 0.10.1 dosya alımı (backend-dev/Go, 2026-11-12)

**Hata:** TO_CUSTOMER alımında `file.done` (ctl DataChannel) ile parçalar (`file` DataChannel) arasında sıra garantisi yok. TURN/relay gecikmesinde done son parçalardan önce geliyordu. `transfer.Manager.Done` hemen `rx.Verify` çağırıyordu, alınan < beyan olduğu için sonuç CORRUPT oluyordu (staging audit: 270 KB ve 989 KB PNG). Web alıcısı aynı durumu `DONE_WAIT_MS = 10_000` ile çözüyor (`apps/web/lib/dc/files.ts`). İstemci bu davranışa getirildi.

**Değişiklik:**

- `internal/transfer/transfer.go`:
  - `DoneWait = 10 sn`.
  - `Deps.After(d, fid) (stop)` zamanlayıcı enjeksiyonu eklendi.
  - Done geldiğinde alınan < beyan ise transfer `doneWait` durumuna alınır, zamanlayıcı kurulur ve nil döner. Tekrarlanan done etkisizdir.
  - `Chunk` bekleme sırasında alınan == beyan olunca zamanlayıcıyı durdurur ve doğrulama + yerleştirmeyi yapar. Eski Done gövdesi ortak `finish` fonksiyonuna taşındı, davranışı aynı.
  - `DoneTimeout(fid)`: done hâlâ bekliyorsa `file.result{ok:false}` + `file.meta CORRUPT` + `.part` silinir. Aksi halde (iptal edilmiş, tamamlanmış ya da başka fid) etkisizdir.
  - `abort` (Cancel, CancelLocal, dropPeer, sınır aşımı) ve `Close` zamanlayıcıyı durdurur.
  - Alınan > beyan durumu zaten `Receiver` sınırıyla CANCELLED.
- `internal/flow/flow.go`: `peerEvent.doneTimeout` alanı eklendi. `After`, `time.AfterFunc` ile kuruluyor ve olayı `s.peerEv` üzerinden oturum döngüsüne gönderiyor. Böylece Manager yine tek goroutine'den kullanılıyor. Döngü olayı `files.DoneTimeout` ile işliyor ve sonucu `UI.FileResult` ile gösteriyor.

**Testler** (`internal/transfer/transfer_test.go`):

- `TestAC54DoneBeforeLastChunksOK`: done önce, parçalar sonra → OK. Zamanlayıcı durdurulur, geç tetiklenmesi etkisizdir.
- `TestAC54DoneWaitTimeoutCorrupt`: parçalar gelmez, süre dolar → CORRUPT, `.part` silinir.
- `TestAC53DoneWaitCancelled`: gönderen ve müşteri iptali → CANCELLED, zamanlayıcı etkisiz.
- `TestAC108DoneWaitCloseStopsTimer`.
- `TestAC54FullBytesWrongSHAImmediateCorrupt`: bayt sayısı tam ama SHA yanlış → hemen CORRUPT, bekleme yok.
- Normal sıra regresyonu: mevcut `TestAC54ReceiveVerifyRenameMOTW`.

**Doğrulama** (docker `golang:1.26.11-bookworm@sha256:dc40a1…`, `-mod=readonly`, `GOTOOLCHAIN=local`):

- `gofmt -l .` boş.
- `go vet ./...` ve `GOOS=windows go vet ./...` temiz.
- `go test -count=1 ./...`: 18 paketin hepsi ok.
- go.mod ve go.sum değişmedi, yeni bağımlılık yok.
- `build/build.sh https://remote.noktabilisim.net 0.10.1` iki ayrı docker koşusunda çalıştırıldı, iki ikili eşit: **SHA-256 `81acc316c58c751eaca3e0bce4536a490aaee5d8ee4313dbcbb2226f573f0284`** (12.380.672 bayt).

**Sözleşme:** protokol ve ctl mesajları değişmedi. Web tarafında değişiklik yok.

## Düzeltme — istemci 0.10.2 ekran yakalama (backend-dev/Go, 2026-11-12)

**Hata:** Fiziksel bir notebook'ta 0.10.1 "Ekran görüntüsü alınamadı; teknisyen ekranınızı göremiyor." diyordu.
Talep, dosya ve mesaj çalışıyordu, ama hatanın nedeni hiçbir yere yazılmıyordu. Olası nedenler: hibrit GPU'da
`DuplicateOutput` → `DXGI_ERROR_UNSUPPORTED`, HDR/gelişmiş renk (`DuplicateOutput` desteklemiyor), Windows N (MF/H.264
yok), ilk karenin zaman aşımına uğraması.

**Değişiklik (yalnız `apps/agent-win`; protokol yok):**

- `internal/capture/reason.go` (yeni, platformdan bağımsız):
  - `Reason` neden kodları ve tipli `*capture.Error{Reason, Op, HR}`.
  - `classify(adım, HRESULT)` tablosu. `tag` ise sabit `Op` ve `HR`'yi korur; yabancı hata metni (DLL yükleme iletisi vb.) kayda girmez.
  - `hresult.err` ve `procHR` artık `*Error` döndürüyor.
- `internal/capture/select.go` (yeni, platformdan bağımsız): `grabber` arayüzü, `selectMethod` (DXGI → DXGI1 → GDI) ve `awaitFirst`.
  - `awaitFirst` ilk kareyi en çok 2 sn bekler. Kayıpta kaynağı kapatıp yeniden açar. Süre dolunca son HRESULT ile `FIRST_FRAME_TIMEOUT` döner.
- `dxgi_windows.go`:
  - `openDuplicator(device, dup1)`. `dup1` true ise `IDXGIOutput5::DuplicateOutput1` çağrılır (vtable 26), formatlar `[DXGI_FORMAT_B8G8R8A8_UNORM]`.
  - Kopyalanan yüzey BGRA (87/91) değilse reddedilir; mevcut BGRA→NV12 hattı değişmedi.
  - Adımlar sınıflandırılıyor: D3D cihazı, çıkış bulunamadı, Duplicate.
- `gdi_windows.go` (yeni): GDI yedek yakalama.
  - `BitBlt(SRCCOPY|CAPTUREBLT)` ile 32 bit, yukarıdan aşağı DIB section'a kopyalanır (BGRA).
  - İmleç `GetCursorInfo`, `GetIconInfo` ve `DrawIconEx` ile sıcak noktaya göre kareye çizilir.
  - Hız `gdiFPS = 10`. Kare bir öncekiyle aynıysa "değişmedi" sayılır. Monitör dikdörtgeni saniyede bir yeniden denetlenir.
  - Aynı NV12 dönüşümü ve aynı H.264 kodlayıcı kullanılır (fps 10 ile).
- `sysinfo_windows.go` (yeni): tanılama için sistem bilgisi.
  - Windows sürümü: `RtlGetVersion` + UBR, DisplayVersion ve EditionID (`x/sys/windows/registry`, aynı modül).
  - Monitörler, DXGI adaptörleri (`GetDesc1`: ad, vendor/aygıt id, yazılım bayrağı) ve çıkışlar.
  - `IDXGIOutput6::GetDesc1` ile BitsPerColor ve ColorSpace; 12 değeri HDR demek.
- `mf_windows.go`: kodlayıcı hataları sınıflandırılıyor (`NO_H264_ENCODER` / `ENCODER_CONFIG`). Donanım ya da yazılım bilgisi ve donanım kodlayıcının başarısızlık nedeni tutuluyor.
- `ratectl.go`: `newRateCtlCap(top)` eklendi; GDI'da hız 10'da sabit.
- `source_windows.go`:
  - `capture.Opener{Version, Log}.Open`. `pipeline` artık `grabber` üzerinden çalışıyor; yeniden açma seçilen yöntemle yapılıyor.
  - Kodlama hatası `ENCODE_FAILED` olarak dönüyor.
  - Log yalnız şu durumlarda yazılıyor: açılış hatası, yedek yönteme geçiş, ilk yayın hatası.
- `internal/diag` (yeni): `Report.Format` sabit anahtarlar kullanıyor. Serbest alanlar yazdırılabilir ASCII'ye indiriliyor; `=`, `"` ve satır sonu `?` oluyor; alanlar 64 karakterle sınırlı.
  - `Log.Write` dosya başına 128 KB sınırı uyguluyor ve `.1` olarak dönüyor (toplam ≤ 256 KB).
- `internal/remember`: `forgetAll` `tanilama.log` ve `tanilama.log.1` dosyalarını da siliyor, ardından klasör boşsa onu da kaldırıyor. Tur 1'de bu kapsam kabul edildi: veri boşaltan her yol logu da siler (ayrıntı aşağıda).
- `internal/flow`: `captureStatus(err)` "Ekran görüntüsü alınamadı (KOD). <yönlendirme>" metnini üretiyor. Hem açılış hatasında (`s.captureErr`) hem yayın hatasında (`shareErr`) kullanılıyor. Tipsiz hatada eski metin gösteriliyor.
- `cmd/noktadestek/main.go`: `diag.NewLog(dir, selfElevated, store.Persistent)`. Log yalnız kalıcı modda açık (tur 1).
- `test/trace-check.ps1`: `-Diagnostics on|off` eklendi. Varsayılan `off`, yani log da iz sayılıyor.

**Neden kodları**

| Kod                 | Ne zaman                                                                                                                             | Müşteri yönlendirmesi                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| DXGI_UNSUPPORTED    | Duplicate adımında 0x887A0004 veya E_NOINTERFACE; ilk kare beklenirken BGRA dışı yüzey (`SurfaceFormat`, hemen döner, DXGI1 denenir) | Ekran kartı ayarını kontrol edin.                 |
| DXGI_ACCESS_DENIED  | E_ACCESSDENIED (güvenli masaüstü, kilit)                                                                                             | Kilit ekranı veya onay penceresi açıksa kapatın.  |
| DXGI_NOT_AVAILABLE  | 0x887A0022 NOT_CURRENTLY_AVAILABLE, 0x887A0028 SESSION_DISCONNECTED                                                                  | Tam ekran uygulamayı kapatıp tekrar deneyin.      |
| NO_OUTPUT           | Monitör DXGI çıkışında/GDI'da yok, geçersiz monitör no                                                                               | Ekran bağlantısını kontrol edin.                  |
| D3D_DEVICE          | CreateDXGIFactory1 / D3D11CreateDevice                                                                                               | Ekran kartı sürücüsünü kontrol edin.              |
| FIRST_FRAME_TIMEOUT | Açıldı ama 2 sn içinde kare gelmedi (son HR korunur)                                                                                 | Ekran yanıt vermedi; tekrar deneyin.              |
| GDI_FAILED          | GDI yedeği de başarısız (yalnız logda; ekranda ilk denemenin kodu)                                                                   | Ekran okunamadı; teknisyeninize bu kodu bildirin. |
| MF_STARTUP          | MFStartup veya mfplat.dll yok (Windows N)                                                                                            | Windows Medya Özellik Paketi gerekli.             |
| NO_H264_ENCODER     | H.264 MFT yok (donanım + yazılım)                                                                                                    | Windows Medya Özellik Paketi gerekli.             |
| ENCODER_CONFIG      | SetInput/OutputType vb. reddedildi                                                                                                   | Görüntü kodlayıcı başlatılamadı; …                |
| ENCODE_FAILED       | Yayın sırasında kodlama hatası                                                                                                       | Görüntü kodlanamadı; …                            |
| OTHER               | Diğer (ekranda `OTHER 0xHHHHHHHH`)                                                                                                   | Teknisyeninize bu kodu bildirin.                  |

**Yöntem sırası:**

1. DXGI `DuplicateOutput`.
2. DXGI1 `DuplicateOutput1`. Yalnız 1. adım hiç açılamadıysa veya yüzeyi BGRA dışıysa (DXGI_UNSUPPORTED) denenir; açılıp kare vermediyse atlanır.
3. GDI.

Kodlayıcı hatası yöntem değiştirmez. Hepsi başarısızsa ekranda ilk denemenin kodu görünür.

**Tasarım kararları ve sapmalar:**

- **Log yalnız sorun olduğunda ve yalnız kalıcı modda yazılıyor** (tur 1 kararı; AC-108/AC-138 değişmedi). Ayrıntı: tur 1 bölümü.
- **GetDIBits yerine DIB section kullanıldı.** Bayt düzeni aynı (BGRA). Kare başına bir kopya az, bitmap'i DC'den ayırma gerekmiyor.
- **WDA_EXCLUDEFROMCAPTURE:** DWM uygular; Windows 10 2004+ sürümünde ekran DC'sinden yapılan BitBlt'te de pencere görünmez. Daha eski sürümlerde bayrak zaten reddediliyor (DXGI ile aynı sınır). Gerçek Windows'ta elle doğrulanmalı (adım 5).
- Yeni Go modülü yok. go.mod ve go.sum değişmedi. `golang.org/x/sys/windows/registry` mevcut modülün paketi.
- vtable dizinleri ve IID'ler mingw-w64 başlıklarından doğrulandı: `dxgi1_5.h` DuplicateOutput1 = 26, `dxgi1_6.h` GetDesc1 = 27, IDXGIAdapter1::GetDesc1 = 10. IDXGIOutput5 ve IDXGIOutput6 GUID'leri de buradan alındı.

**Örnek log kaydı** (`Report.Format`, birim testi örneği). İçinde ad, telefon, e-posta, kullanıcı/bilgisayar adı, yol, URL, kod veya anahtar yok:

```
--- 2026-11-12T09:30:00Z olay=acilis_hata
istemci=0.10.2 windows=10.0.22631.4317 surum=23H2 edisyon=ProfessionalN
hedef=\\.\DISPLAY1 monitor_sayisi=1
monitor=1 aygit=\\.\DISPLAY1 boyut=2880x1800 birincil=1
adaptor=0 ad="Intel(R) Iris(R) Xe Graphics" vendor=0x00008086 aygit_id=0x00009A49 yazilim=0
adaptor=1 ad="NVIDIA GeForce RTX 3050 Laptop GPU" vendor=0x000010DE aygit_id=0x000025A2 yazilim=0
cikis=\\.\DISPLAY1 adaptor=0 boyut=2880x1800 dondurme=1 masaustu=1 renk_bit=10 renk_uzayi=12 hdr=1
deneme=DXGI sonuc=DXGI_UNSUPPORTED islem=DuplicateOutput hr=0x887A0004
deneme=DXGI1 sonuc=FIRST_FRAME_TIMEOUT islem=AcquireNextFrame hr=0x887A0026
deneme=GDI sonuc=GDI_FAILED islem=BitBlt hr=0x00000000
yontem=- kodlayici=-
neden=DXGI_UNSUPPORTED islem=DuplicateOutput hr=0x887A0004
```

**Testler:**

- `internal/capture/select_test.go`:
  - `TestClassifyReasonTable`
  - `TestTagKeepsOpAndHRAndHidesForeignText`
  - `TestAwaitFirst*`: ilk kare; tekrar tekrar kayıp → yeniden açma → zaman aşımı; kaynaklar kapatılıyor.
  - `TestSelectMethodChain`: 6 senaryo (normal, HDR→DXGI1, hibrit→GDI, kare yok→DXGI1 atlanır, hepsi başarısız, çıkış yok).
  - `TestGDIRateCapped`
- `internal/diag/diag_test.go`:
  - Yalnız izinli anahtarlar var.
  - PII ve enjeksiyon yok: satır sonu, `=`, Unicode ve uzun değer temizleniyor; hostname, home ve USER kayda girmiyor.
  - Başarılı yedek kaydı doğru biçimde.
  - Dönme ve boyut sınırı; büyük kayıt kısaltılıyor.
  - Log kapalıyken yazım yapılmıyor.
  - Toplam 256 KB.
- `internal/remember`: `TestAC186ForgetAllRemovesDiagnosticsLog` (kayıtla ve kayıtsız).
- `internal/flow/capture_status_test.go`:
  - Durum metni tablosu, her kod için yönlendirme var ve uzunluk ≤ 110.
  - Açılış hatasında `share.state stopped` gidiyor ve durum satırında kod görünüyor.

**Doğrulama** (docker `golang:1.26.11-bookworm@sha256:dc40a1…`, `-mod=readonly`, `GOTOOLCHAIN=local`):

- `gofmt -l .` boş.
- `go vet ./...` ve `GOOS=windows go vet ./...` temiz.
- `go test -count=1 ./...`: 19 paketin hepsi ok.
- `GOOS=windows go test -c ./internal/capture` derleniyor.
- `build/build.sh https://remote.noktabilisim.net 0.10.2` iki ayrı docker koşusunda çalıştırıldı, iki ikili eşit: SHA-256 `158e2cb1…` (tur 1 öncesi, geçersiz; güncel SHA tur 1 bölümünde).

**Windows elle test adımları (bekliyor):**

1. Normal masaüstü regresyonu: tek ve çift monitör; imleç, döndürülmüş ekran, UAC/kilit ekranı dönüşü.
   - Görüntü 0.10.1 ile aynı olmalı.
   - `%LOCALAPPDATA%\NoktaDestek\tanilama.log` OLUŞMAMALI.
   - Ek: kod modunda (kayıt ve "hatırla" yok) HDR açıkken bile log OLUŞMAMALI; durum satırı/yedek yöntem yine çalışmalı. Yönetici olarak çalıştırılınca da log yok.
   - `trace-check.ps1 -Mode Compare` temiz çıkmalı.
2. HDR açık (Ayarlar › Ekran › HDR): paylaşım çalışmalı.
   - Log `olay=acilis_yedek` içermeli.
   - `deneme=DXGI sonuc=DXGI_UNSUPPORTED`, ardından `deneme=DXGI1 sonuc=OK` görünmeli.
   - `hdr=1` görünmeli.
   - HDR'yi kapatıp yeni oturum açınca DXGI kullanılmalı ve yeni kayıt eklenmemeli.
3. Hibrit GPU (ör. Sekuro notebook): Windows Grafik ayarlarında NoktaDestek.exe "Yüksek performans" (harici GPU) olarak ayarlanır.
   - Paylaşım çalışmalı; büyük olasılıkla GDI ile, ~10 fps.
   - Log `yontem=GDI` ve iki adaptörü göstermeli.
   - Ardından "Güç tasarrufu" / "Windows karar versin" ile DXGI kullanılmalı.
4. Log içeriği kontrolü: dosyada müşteri adı, telefon, e-posta, kullanıcı adı, bilgisayar adı, sunucu adresi ve kod OLMAMALI. Yalnız tablodaki anahtarlar bulunmalı.
5. GDI yolunda kontrol ve işaretleme göstergesi pencereleri teknisyen görüntüsünde görünmemeli (WDA_EXCLUDEFROMCAPTURE). İmleç doğru konumda olmalı.
6. "Bu bilgisayarı unut" sonrasında `tanilama.log`, `.1` ve boş klasör silinmeli. `trace-check.ps1 -Binding off -Remember off` (Diagnostics varsayılanı `auto`) temiz çıkmalı.
7. Windows N (Media Feature Pack yok): durum satırında `(MF_STARTUP)` veya `(NO_H264_ENCODER)` görünmeli ve log yazılmalı.

**Sözleşme:** protokol, ctl mesajları ve web değişmedi; frontend-dev için değişiklik yok.

**Sonra (sonraki paket):** neden kodunun ve yöntemin teknisyen paneline iletilmesi. Örnek: `share.state` içinde `reason` ve `method` alanları. Bu, contracts ve sunucu şeması değişikliği gerektiriyor. Bu tur kapsam dışı.

### Düzeltme turu 1 (qa-raporu-0.10.2, guvenlik-raporu-0.10.2)

1. **QA#1 / Güvenlik ORTA (AC-108/AC-138 değişmedi).** Log yalnız kalıcı modda yazılıyor: bilgisayar kaydı varsa veya "hatırla" açıksa.
   - `diag.NewLog(dir, elevated, persistent)` ekledim. `Log.Enabled` her yazımda soruluyor; oturum içinde kayıt alınırsa log oradan sonra açılıyor.
   - `remember.Store.Persistent()` ekledim.
   - Kod modunda klasör bile oluşmuyor. Neden kodu ekranda yine görünüyor.
   - `trace-check.ps1 -Diagnostics` artık `auto|on|off`, varsayılan `auto`. `auto`'da log yalnız `-Remember on` veya `-Binding on` iken izinli; aksi hâlde iz sayılıyor.
   - Testler: `TestNewLogOnlyPersistentAndNotElevated`, `TestPersistentMode`.
2. **Güvenlik DÜŞÜK (CWE-59).**
   - Süreç yükseltilmişse (`env.SelfElevated`) `NewLog` nil döndürüyor, log kapalı.
   - Yazmadan önce klasör, `tanilama.log` ve `.1` `Lstat` ile denetleniyor. Symlink, `ModeIrregular` (Windows junction) veya `FILE_ATTRIBUTE_REPARSE_POINT` görülürse hiçbir şey yazılmıyor ve taşınmıyor (`reparse_windows.go` / `reparse.go`).
   - Açılan dosya da `Stat` ile düzenli dosya mı diye doğrulanıyor.
   - Test: `TestLogRefusesReparsePoints` (bağlantı klasör, bağlantı log, bağlantı `.1`; hedef dosya ve mevcut log değişmiyor).
   - `hatirla.bin` için aynı değerlendirme bu turun kapsamı dışında; ayrı iş olarak öneriliyor.
3. **QA#2 (kabul edilen davranış).** Veri boşaltan her `forgetAll` yolu logu da siliyor: "Bu bilgisayarı unut", kayıt yokken "Bilgilerimi unut" ya da işaretsiz talep, kişisel bilgi yokken geçersiz kayıt (AC-185), bozuk dosya.
   - Kişisel bilgi veya kayıt kalıyorsa log da kalıyor.
   - CHANGELOG buna göre düzeltildi.
   - Test: `TestAC185AC137ClearPathsRemoveDiagnosticsLog`.
4. **QA#3.** `awaitFirst`, `DXGI_UNSUPPORTED` tipli hatada (BGRA dışı yüzey, `SurfaceFormat`) kaynağı yeniden açmıyor, hemen dönüyor. `selectMethod` bunu "açılamadı" sayıp DXGI1'i deniyor.
   - Neden tablosu düzeltildi.
   - Testler: `TestAwaitFirstNonBGRASurfaceReturnsUnsupported`, `TestSelectMethodChain` (+2 senaryo: BGRA dışı → DXGI1; DXGI1'de de → GDI).
5. **QA#4.** `TestCaptureStreamFailureStatusHasReason`: yayın `ENCODE_FAILED` ile bitince önce `share.state sharing`, sonra `stopped` gidiyor ve durum satırında "(ENCODE_FAILED) Görüntü kodlanamadı…" görünüyor.
6. **govulncheck.** `go get golang.org/x/net@v0.62.0 golang.org/x/crypto@v0.59.0 && go mod tidy`.
   - GO-2026-5932'nin düzeltmesi yalnız bir pseudo-version'da (`v0.58.1-0.20261009…`). v0.59.0 bu düzeltmeyi içeren ilk etiketli sürüm.
   - x/net bunu gerektirdiği için `golang.org/x/sys` v0.48.0 → v0.50.0 oldu.
   - Yeni modül yok. `govulncheck` v1.9.0 (`GOOS=windows`) çıktısı: "No vulnerabilities found".

**Doğrulama (tur 1)** (docker `golang:1.26.11-bookworm@sha256:dc40a1…`, `-mod=readonly`):

- `gofmt -l .` boş.
- `go vet ./...` ve `GOOS=windows go vet ./...` temiz.
- `go test -count=1 ./...`: 19/19 ok.
- `GOOS=windows go test -c ./internal/capture` derleniyor.
- govulncheck temiz.
- `build/build.sh https://remote.noktabilisim.net 0.10.2` iki ayrı docker koşusunda çalıştırıldı, iki ikili eşit: **SHA-256 `85142c14bf6941c2d5c3803b2818f0b1645c95b77704e640c8ff49d4059687bc`** (12.457.472 bayt).

**Açık:** Windows elle testleri 1–7 (test-operatoru) yapılmadı. QA Tur 2 üzerine kalıcı moddaki tanılama logu AC-138/AC-188 notu, ADR-0004 revizyonu ve kılavuz gizlilik bölümüne işlendi (teknik-yazar).

## P9 — Backend (backend-dev, 2026-11-12)

Durum: **tamamlandı** (commit yok). Şema değişikliği, yeni env, yeni bağımlılık, yeni grant **yok**.

### Uçlar (`/api/v1`)

| Uç                                                                                                              | Yetki                         | Not                                                                                                       |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| GET `/users`                                                                                                    | users.view + tenantScope      | sayfalı (vars. 25, üst 100), `q/role/status/sort`; SUPER_ADMIN hesapları hiç dönmez                       |
| POST `/users`                                                                                                   | users.create                  | 201 `{ user, temporaryPassword }`; must_change_password=1; argon2id; 409 `fields.email`                   |
| GET `/users/:id`                                                                                                | users.view                    | `UserDetail` (tüm anahtarlar, `isSelf`, `canManage`); başka tenant/SA → 404                               |
| PATCH `/users/:id`                                                                                              | users.edit                    | email/fullName/role/permissions (en az biri); 403 sahip olunmayan yetki / üstün hesap / kendi rol-yetkisi |
| POST `/users/:id/deactivate` · `/reactivate`                                                                    | users.edit                    | 204; 409 zaten o durumda; kendisi 403                                                                     |
| GET/PUT `/settings/tenant`                                                                                      | settings.view / settings.edit | AC-4 aralıkları → 400 `fields.<alan>`; audit eski → yeni                                                  |
| GET/POST `/admin/tenants`, GET/PATCH `/admin/tenants/:id`, POST `/admin/tenants/:id/deactivate` · `/reactivate` | SUPER_ADMIN                   | 409 `fields.slug`; pasif/aktif 409 tekrar                                                                 |
| POST `/admin/switch-tenant` `{ tenantId \| null }`                                                              | SUPER_ADMIN                   | `{ actingTenant }`; pasif/yok firma 404; audit `tenant.switched`                                          |

`/users/:id/reset-mfa` **P10** (kapsam dışı). Avatar/logo uçları P9 tablosunda değil (AC-81..84 başka pakette).

### Kurallar (uygulanan)

- AC-73: etkin kümede değişen her anahtar işlemi yapanda olmalı (Super Admin tümüne sahip); ADMIN rolü varsayılanı
  "verme" sayılır. Ezme satırları normalize: yalnız rol varsayılanından farklı anahtar saklanır (yeni anahtar ADMIN'de
  açık, USER'da kapalı başlar).
- Üstünlük: Admin, etkin yetkileri kendi kümesini aşan hesabı yönetemez. Kendi rol/yetkisi değişmez, kendini pasife alamaz.
- AC-74: anahtar başına `user.permission_changed` (user_id = kim, entity_id = kime, `{permKey, granted}` eski → yeni), aynı TX.
- AC-115 / G-04 (commit sonrası): pasif ve rol değişimi → `rooms.endByTechnician` + `requestHub.closeByUser`; yalnız
  yetki → `rooms.applyPermChange` (+ `support_requests.view` kalktıysa panel 4401). Hata → log `user_live_effect`, 60 sn yedek.
- AC-70: firma pasif TX'i: durum + kullanıcı oturumları iptal + bekleyen kod oturumları `CANCELLED(tenant_passive)` +
  audit; sonra `rooms.endByTenant` (yeni), `requestHub.closeByTenant` (yeni), `requests.cancelAllForTenant` (AC-145),
  `bindings.revokeForTenant` (mimari-e10 §3.4). Firma oluşturma aynı TX'te ayar satırı + sistem aydınlatma metni v1.

### Değişen / eklenen dosyalar

- contracts: `src/api/users.ts` (yeni), `src/api/tenants.ts` (yeni), `src/permissions.ts` (`PERMISSION_DESCRIPTIONS`,
  `roleDefaultGranted`, `permissionKeysOf`, `effectivePermissionsFrom`; davranış aynı), `src/audit.ts` (`USER_AUDIT`,
  `TENANT_AUDIT`), `package.json` (exports), `test/users-tenants-p9.test.ts`.
- server: `src/users/{repo,service,routes}.ts`, `src/tenants/{repo,service,routes}.ts` (yeni); `src/app.ts` (kayıt);
  `src/auth/guards.ts` (`requireSuperAdmin`); `src/lib/ids.ts` (`newTemporaryPassword`, G-20 tek yer);
  `src/signaling/rooms.ts` (`endByTenant`); `src/requests/hub.ts` (`closeByTenant`); `src/public/consent.ts`
  (`defaultConsentBody` `prisma/seed-consent.ts`'ten taşındı — metin aynı, seed yeniden dışa aktarır; `createInitialConsent`).
- testler: `test/integration/{users-p9,tenants-p9,permissions-ac72-p9}.test.ts`, `test/helpers/tenant-matrix.ts`
  (P9 uçları; yeni sınıf `system`), `test/integration/tenant-isolation.test.ts` (sistem uçları ADMIN/USER → 403).
- dokümanlar: `docs/mimari-api.md` (sapma notu), `docs/runbook.md` §14 (firma doğrulaması, pasif alarmları).

### Tasarımdan sapmalar (gerekçe mimari-api "backend-dev sapma notu (P9)")

reactivate uçları (pasifi geri alma ihtiyacı), `GET /admin/tenants/:id`, rol üstünlük kuralı (mimaride tanımsızdı;
yetki yükseltme/devralma önlemi), `/settings/tenant` P9 alt kümesi (SMTP/2FA P10), bekleyen kod oturumlarının da iptali
(resolve teknisyen/tenant durumuna bakmıyordu — pasif hesabın kodu açık kalmasın).

### Testler (geçici DB `rs-mysql-p9:33325`)

`pnpm -r run typecheck` ✓ · `pnpm -r run lint` ✓ · contracts `test` 7 dosya / 68 ✓ · server `test` (unit) 17 / 285 ✓ ·
server `test:int` 40 dosya / 384 ✓ (P9: users-p9 16, tenants-p9 7, permissions-ac72-p9 1, tenant-isolation +1).
AC eşlemesi: AC-4, AC-69 (matris + liste izolasyonu), AC-70, AC-71, AC-72 (`vi.mock` ile geçici `p9_gecici` modülü →
/auth/me, detay, PATCH, audit'te görünür), AC-73, AC-74, AC-115 (pasif, yetki daraltma caps.update, rol değişimi,
tenant pasif — gerçek WS), AC-145 servis yolu.

### frontend-dev'in bilmesi gerekenler

- `lib/users/contract.ts` geçici tipleri contracts'a taşınmalı; farklar: `UserListItem` ek alanlar `username`,
  `mustChangePassword`, `totpEnabled`, `createdAt`; `UserDetail.permissions` tam `Record<PermissionKey, boolean>` +
  `isSelf`, `canManage`; `TenantListResponse` sayfalı (`page/pageSize/total`), `TenantItem.activeUserCount/updatedAt`.
- `lastLoginAt: null` "hiç giriş yapmadı" demek değildir (eski oturum kayıtları silinebilir) — "—" gösterin.
- Liste sorgusu: `q/role/status/page/pageSize` + `sort` (fullName:asc vars.); frontend'in `usersApiPath`'i uyumlu.
- 403 `fields["permissions.<anahtar>"]` hangi anahtarın verilemediğini söyler; `canManage=false` → düzenle/pasif butonları kapalı.
- `POST /users` ve deactivate/reactivate gövdesi `{}` veya boş; deactivate/reactivate 204 döner (tenant uçları `TenantItem`).
- switch-tenant sonrası `/ws/panel` 4401 ile kapanır, yeni bağlamla yeniden bağlanın; `/auth/me` yeniden okunmalı.
- `/settings/tenant` PUT kısmi gövde (en az bir alan); aralıklar `TENANT_SETTINGS_LIMITS`.
- Toggle açıklamaları `PERMISSION_DESCRIPTIONS` (yalnız bazı anahtarlar).

### Düzeltme turu 1 (backend-dev, 2026-11-12)

- B-P9-1 (Orta): `apps/server/src/lib/ids.ts` `TEMP_PASSWORD_ALPHABET` satırına gerekçeli satır içi `// gitleaks:allow`
  eklendi (davranış aynı, dosya istisnası yok). `gitleaks v8.30.1 dir apps/server/src --config .gitleaks.toml` → çıkış 0.
  `apps/web/e2e/mock-users.mjs` yarısı frontend-dev'de.
- B-P9-2..6 (Düşük): kodlanmadı; `docs/gereksinimler-sonra-acik.md` "Sonra / açık — P9'dan" tablosuna eklendi
  (`docs/gereksinimler.md` §9 yönlendirme satırı güncellendi).
- Doğrulama: server `lint` ✓ · `typecheck` ✓ · `test` (unit) 17 / 285 ✓ · `test:int` (geçici DB `rs-mysql-p9fix:33326`,
  `apps/server/scripts/test-db.sh`) 40 / 384 ✓. Sözleşme değişikliği yok.

## P9 — Frontend (Rotalar) (frontend-dev, 2026-11-12)

Durum: **tamam**. tsc + eslint temiz, vitest 191/191, e2e 220 geçti / 77 atlandı (`pnpm --filter @remote/web e2e`).
Sözleşme: `@remote/contracts/api/{users,tenants}` + `permissions` (`PERMISSION_MODULES`, `PERMISSION_DESCRIPTIONS`). `lib/users/contract.ts` yalnız yeniden dışa aktarım yapar.
Tasarım skill dosyaları okunmadı; esas alınanlar DESIGN.md ve onaylı taslak `docs/tasarim/07-kullanici-yetki.html`.

### Rotalar

| Yol                   | Auth                                                                                                | Ne yapar                                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/users`              | Oturum + `users.view`. Super Admin için firma bağlamı gerekir; yoksa "Firma seçin" boş durumu çıkar | Kullanıcı listesi: arama (ad/e-posta, en az 2 karakter), rol ve durum filtresi (URL'de), sayfalama. "Yeni kullanıcı" (`users.create`) geçici şifreyi bir kez gösterir            |
| `/users/[id]`         | Oturum + `users.view`. Düzenleme için `users.edit` + `canManage`                                    | Profil (ad, e-posta, rol), hesap durumu, 2FA durumu, yetki toggle matrisi + kaydet çubuğu, pasife al / yeniden etkinleştir. Kapsam dışı veya olmayan id → "Kullanıcı bulunamadı" |
| `/admin/tenants`      | Oturum + SUPER_ADMIN (diğer rollere uyarı gösterilir; arka uç 403 verir)                            | Firma listesi (arama, durum), oluştur/düzenle (kısa ad önerisi), pasife al (etkiler + kısa adı yazarak onay), yeniden etkinleştir, satırdan firmaya geçiş                        |
| Üst menü firma seçici | SUPER_ADMIN                                                                                         | Etkin firma göstergesi + `POST /admin/switch-tenant` (firma seç / bağlamdan çık). Ardından `router.refresh()`; /auth/me sunucuda yeniden okunur                                  |

Menü: "Kullanıcılar" (`Users`, `users.view`), "Firmalar" (`Building`, yalnız SUPER_ADMIN).

### Davranış kuralları (sunucuyla aynı)

- Yetki matrisi `PERMISSION_MODULES`'tan üretilir. Sözlükte etiketi olmayan yeni modül veya eylem, anahtar adıyla görünür (AC-72, birim testi).
- İşlemi yapanın sahip olmadığı anahtar kilitlidir: `aria-disabled` + `Lock` + açıklama. Grup "Tümünü aç/kapat" kilitli anahtara dokunmaz. Rol değişince kilitsiz anahtarlar rol varsayılanına döner.
- PATCH yalnız değişen alanları ve **değişen** yetki anahtarlarını gönderir. Oluşturmada tam harita gider; kilitli anahtarlar açıkça `false` olur.
- `isSelf` iken rol ve yetkiler pasiftir, pasife alma yoktur. `canManage=false` veya pasif kullanıcı salt okunurdur. 403 yanıtında `fields["permissions.<anahtar>"]` varsa mesaj yetkiyi adıyla söyler; form korunur.
- Geçici şifre yalnız oluşturma yanıtından gelir ve bileşen state'inde tutulur; diyalog kapanınca düşer. Kopyalanmadan kapatılırsa uyarı çıkar (odak "Şifreye dön"de).

### Dosyalar (apps/web)

- Yeni: `lib/users/{contract,permissions,form,query,tenant-query}.ts`, `lib/users/users.test.ts`, `components/ui/save-bar.tsx`, `components/admin/permission-matrix.tsx`,
  `app/(panel)/tenant-switcher.tsx`, `app/(panel)/users/{page,loading,user-list,user-filters,users-actions,new-user-dialog}.tsx`,
  `app/(panel)/users/[id]/{page,loading,not-found,user-editor}.tsx`, `app/(panel)/admin/tenants/{page,loading,tenant-list,tenant-filters,tenant-form-dialog}.tsx`,
  `e2e/mock-users.mjs`, `e2e/p9-users.spec.ts`.
- Değişen: `components/ui/switch.tsx` (`ToggleSwitch`: mixed/kilitli), `components/ui/menu.tsx` (`ariaLabel`, `labelClassName`, `onOpen`),
  `app/(panel)/layout.tsx` (`ToastProvider` artık tüm kabuğu sarıyor; Super Admin'de firma seçici), `app/(panel)/side-nav.tsx`, `messages/tr.json`,
  `e2e/mock-api.mjs`, `e2e/mock-requests.mjs` (u-us* kullanıcıları için /ws/panel kabulü), `DESIGN.md` (§4 ikonlar, §6 primitifler).

### Testler

- Birim (`lib/users/users.test.ts`, 19 test): matris üretimi, AC-72 geçici modül, rol varsayılanı, kilit, grup aç/kapat (mixed, kilitli), rol değişimi, PATCH farkı, sunucu alan hatası, 403 etiketi, kısa ad önerisi, sorgu.
- E2E `p9-users.spec.ts` (desktop + mobile, 14 test): kullanıcı oluştur → 409 → geçici şifre bir kez + kopyala; kopyalamadan kapatma uyarısı; grup aç/kapat + mixed + klavye + ayrılma uyarısı + PATCH gövdesi; kilitli yetki / salt okunur / kendi hesabı; pasife alma (odak Vazgeç) + yeniden etkinleştirme; filtreler, eşleşme yok, bulunamadı; 5 durum (boş, 500 + tekrar dene, iskelet, salt okunur); Super Admin firma seç → kullanıcılar, firma oluştur (slug önerisi, 409), pasife al (etkiler + kısa ad onayı), satırdan geçiş, bağlamdan çık; firma düzenle; Admin'e kapalı; açık/koyu axe + taşma + 44 px.

### Sapmalar

1. 2FA "Sıfırla" düğmesi yok (P10'a ait); avatar yükleme yok (P12'ye ait).
2. Firma pasife almaya kısa adı yazarak onay eklendi (taslakta yoktu).
3. Firma geçişinden sonra yönlendirme yapılmıyor; `router.refresh()` kullanılıyor.

### Backend entegrasyonunda kontrol edilecekler

- `GET /users` sorgusu (`q, role, status, page, pageSize`) ve seçicinin kullandığı `GET /admin/tenants?status=active&pageSize=100` gerçek sunucuda denenmeli.
- deactivate/reactivate çağrıları gövde `{}` ile gidiyor; 409 bir toast'a çevriliyor.
- PATCH `/users/:id` ve `/admin/tenants/:id` yanıtının güncel `UserDetail` / `TenantItem` döndüğü varsayılıyor.
- AC-73: 403 yanıtında `fields["permissions.<anahtar>"]` olmalı (yoksa genel metin gösterilir).
- switch-tenant sonrası `/ws/panel` 4401 → `RequestNotifier`'ın yeniden bağlandığı gerçek sunucuda doğrulanmalı.

### Düzeltme turu 1 (QA P9 Tur1 #1, güvenlik B-P9-1)

- **QA #1 (rol değişiminde AC-73 403'ü):** `lib/users/form.ts` `buildUpdateUser` rol değiştiğinde yetki anahtarlarının TÜMÜNÜ ekrandaki değerleriyle gönderiyor (rol aynıysa eskisi gibi yalnız değişenler). Sebep: sunucu (`users/service.ts` `normalizeRows`) gövdede olmayan, ezmesi de olmayan anahtarı yeni rolün varsayılanıyla (`roleDefaultGranted`) hesaplıyor. Kilitli anahtar USER→ADMIN'de ekranda kapalı kalıyor, gönderilmezse sunucuda açılıyor ve 403 dönüyordu. Yalnız kilitli anahtarları değil tümünü göndermemizin nedeni şu: rol değişiminden sonra elle eski değerine çekilen kilitsiz bir anahtar da aynı biçimde sapıyordu. Etkin değeri değişmeyen anahtarı göndermek sunucunun küme kontrolünü tetiklemiyor. `user-editor.tsx` değişmedi.
- `e2e/mock-users.mjs` PATCH kuralı sunucunun mantığına göre yeniden yazıldı: anahtar başına önce gövde, sonra mevcut ezme, en son yeni rolün varsayılanı. Etkin kümede değişen anahtar aktörde yoksa 403 ve `fields["permissions.<k>"]` dönüyor. Kendi hesabında yalnız gerçek rol/yetki değişikliği 403 alıyor.
- **B-P9-1:** `mock-users.mjs` sahte `temporaryPassword` satırına gerekçeli `// gitleaks:allow` eklendi. `gitleaks dir apps/web/e2e` çıkış kodu 0. Kontrol olarak yorumsuz kopya taratıldı, çıkış kodu 1.
- Testler: `lib/users/users.test.ts` dosyasına 2 birim testi eklendi. Biri sunucu kuralının kopyasıyla etkin kümenin ekranla aynı olduğunu ve 403 olmadığını gösteriyor. Diğeri tüm anahtarların gönderildiğini doğruluyor. `e2e/p9-users.spec.ts` dosyasına "AC-73 rol yükseltme: …" testi eklendi. Bu test önce yalnız rol içeren gövdenin mock'ta 403 aldığını gösteriyor, ardından UI kaydının 200 döndüğünü ve yeniden yüklemede kalıcı olduğunu doğruluyor. Mevcut AC-73 testindeki `"audit.export" in body.permissions === false` beklentisi hatalı davranışı kodluyordu; `false` değerine çevrildi.

### Düzeltme turu 2 (sayfa testi P9: Bulgu 1 ORTA, Bulgu 6 DÜŞÜK, paket kodu metni)

- **Bulgu 1 + 6 (Super Admin üst menüsü 375 px'te 6 px taşıyordu):** Kök neden: sağ grup `min-w-0` ile daralıyordu ama içindeki öğeler daralmıyordu. Bu yüzden "Çıkış yap" kırpılıyordu. `layout.tsx`: Super Admin'de uygulama adı < sm gizli, sağ grup boşluğu `gap-2 sm:gap-3`, avatar sarmalayıcısı `shrink-0`. `logout-button.tsx`: kap `shrink-0`. `tenant-switcher.tsx`: kap `min-w-0`. Etkin firma adı (veya "Firma seçilmedi") artık her genişlikte görünüyor ve yer kalmazsa kısaltılıyor (`min-w-0 max-w-48 truncate`, tam ad `title`'da ve erişilebilir adda). `ui/menu.tsx`: `title` prop'u, tetikleyici `max-w-full`, ok `shrink-0`. DESIGN.md menü satırı güncellendi.
- **Paket kodu metni:** `srs.mail.p10` → "SMTP ayarlarıyla birlikte sonraki sürümde gelecek.", `us.e.twofaHint` → "İki adımlı doğrulamayı sıfırlama ve zorunlu kılma sonraki sürümde gelecek." (anahtar adları değişmedi). `tr.json`'da kullanıcıya görünen başka paket kodu yok.
- Test: `e2e/p9-users.spec.ts` "TO-P9-1/6" (SA, 375 px, desktop + mobile projeleri): firma seçilmeden ve seçildikten sonra yatay taşma yok, çıkış düğmesi tam görünür ve ≥ 44 px, seçicide firma adı görünür, açık menüde de taşma yok.

## P10 — Veri katmanı (dba, 2026-11-12)

Migration `apps/server/prisma/migrations/20261112180000_p10_account_security/` (+ `down.sql`), `prisma/sql/grants.sql`, `deploy/mysql/check-app-grants.sh`. Ayrıntı ve gerekçe: `docs/db-notlari.md` "P10". `pnpm db:generate` sonrası Prisma modelleri: `RecoveryCode`, `PasswordResetToken`, `User.totpLastStep (bigint | null)`.

### Backend için alan adları ve kullanım

- **TOTP setup** (`/auth/mfa/setup`): `users.totpSecretEnc = encrypt(secret)` (lib/crypto.ts, §3.2), `totpEnabled` false kalır, `totpLastStep: null`. 2FA zaten etkinse setup reddedilmeli (önce sıfırlama), aksi halde etkin sır ezilir.
- **TOTP enable** (`/auth/mfa/enable`): tek TX'te `totpEnabled: true`, `totpLastStep: <doğrulanan adım>`, eski kodlar `recoveryCode.deleteMany({ userId })` + 10 yeni `createMany` (`codeHash = sha256hex(normalize(code))`, küçük harf hex; düz kod yalnız yanıtta).
- **TOTP verify (tekrar oynatma koruması):** kod doğrulanınca adım `s` ile `updateMany({ where: { id, totpLastStep: null } | { id, totpLastStep: { lt: s } }, data: { totpLastStep: s } })` → `count === 0` ise 401 (aynı/eski kod). Tek koşullu UPDATE yarışsızdır.
- **Kurtarma kodu:** `recoveryCode.updateMany({ where: { userId, codeHash, usedAt: null }, data: { usedAt: now } })` → `count === 1` başarı. Kalan sayı: `count({ where: { userId, usedAt: null } })`. app yalnız `used_at/updated_at` güncelleyebilir; DELETE izinli.
- **MFA sıfırlama** (`/users/:id/reset-mfa`): tek TX'te `users` `{ totpSecretEnc: null, totpEnabled: false, totpLastStep: null }` (üçü birlikte, yoksa CHECK 3819) + `recoveryCode.deleteMany` + `authSession.updateMany` revoke; commit **sonrası** `rooms.endByTechnician` (S7-11).
- **2FA zorunluluğu:** `role ∈ {SUPER_ADMIN, ADMIN}` veya (`USER` ve `tenant_settings.requireTech2fa`) ve `!totpEnabled` → oturum yalnız setup/enable uçları. Mevcut P1–P9 oturumları `mfa_passed=true` taşır; guard her istekte `totpEnabled`'ı kontrol ettiği sürece veri taşıma gerekmez.
- **Şifre sıfırlama:** forgot → hesap başına sayım `passwordResetToken.count({ where: { userId, createdAt: { gte: now-1sa } } })` (IX(user_id, created_at)); önce açıkları kapat `updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } })`, sonra INSERT (`tokenHash`, `expiresAt = now + 30 dk`; CHECK ≤ 31 dk). reset → `updateMany({ where: { tokenHash, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } })` `count===1` değilse 410 `RESET_TOKEN_INVALID`; aynı TX'te şifre + `mustChangePassword:false` + tüm `auth_sessions` revoke. Şifre değişiminde de açık tokenlar `usedAt` ile kapatılmalı. app DELETE yapamaz (retention P13).
- **Hesap geneli kilit e-postası:** alanlar mevcut (`lockedUntil`); e-posta yalnız kilidin **konduğu** UPDATE'te (count 20'ye ulaştığında) gönderilir. Super Admin'in SMTP'si yok → yalnız audit (db-notlari P10 açık nokta 1).
- **SMTP kaydı** (`PUT /settings/tenant`): yapılandırılmamış = yedi `smtp*` alanının hepsi `null`; yapılandırılmış = `smtpHost, smtpPort, smtpSecurity, smtpFromEmail` zorunlu. `smtpPassEnc` yalnız `smtpUser` doluyken. Şifre boş gelirse mevcut `smtpPassEnc` korunur; kullanıcı silinirse şifre de `null` yazılmalı (auth CHECK). Host: ASCII (IDN → `domainToASCII`), IPv6 köşeli parantezli; `smtpFromName` kırpılmış, kontrol karakteri yok. CHECK ihlali 3819 → servis zod ile önceden 400 vermeli; 3819 gelirse 500 değil hata kodu eşlemesi kontrol edilmeli.
- **AC-151:** `tenant_request_settings.emailEnabled/emailRecipients` mevcut; "SMTP yapılandırılmış" = `tenantSettings.smtpHost != null`.
- **Oturum linki 20/sa (AC-10):** tablo yok; bellek ya da audit sayımı (db-notlari P10 açık nokta 2).

### Frontend için

Yeni API alanı DB'den doğrudan gelmez; `hasPassword` = `smtpPassEnc != null`, "2FA etkin" = `totpEnabled`. Kalan kurtarma kodu sayısı gösterilecekse backend ayrı alan döndürmeli.

## P10 — Backend (backend-dev, 2026-11-12)

Kapsam: AC-10 (rev.), 65 (e-posta), 66, 67, 68, 78 (SMTP), 79, 80, 115 (logout-all, MFA sıfırlama), 122, 151.
Sözleşme sapmaları (frontend için bağlayıcı): `docs/mimari-api.md` "backend-dev sapma notu (P10)".

### Değişen / eklenen dosyalar

- **contracts:** `errors.ts` (`HOST_NOT_ALLOWED`, `MFA_REQUIRED`, `MFA_SETUP_REQUIRED`, `RESET_TOKEN_INVALID`), `api/auth.ts` (MFA aşaması/`MfaStatus`, verify/setup/enable, logout-all, forgot/reset şemaları, `RESET_PASSWORD_PATH`), `api/tenants.ts` (SMTP şemaları, `SMTP_DEFAULT_PORTS`, `SMTP_ERROR_MESSAGES`, `requireTech2fa`, `smtp` görünümü), `api/sessions.ts` (`sessionEmailInputSchema`), `api/requests.ts` (`emailTestInputSchema`), `audit.ts` (`AUTH_AUDIT`, `MAIL_AUDIT`, `USER_AUDIT.MFA_RESET`).
- **server yeni:** `lib/crypto.ts` (AES-256-GCM `SecretBox`, sürümlü anahtar), `lib/netguard.ts` (G-12), `auth/mfa.ts` (TOTP + kurtarma kodu), `auth/account.ts` (2FA, logout-all, forgot/reset, kilit bildirimi), `mail/service.ts` (nodemailer, IP'ye bağlanma + SNI, 10 sn, 1 yeniden deneme, hata sınıfı, audit `mail.sent`), `mail/templates.ts`, `tenants/smtp-routes.ts` (`POST /settings/smtp/test` + ortak test gövdesi), `sessions/email.ts` (`POST /sessions/:id/email`).
- **server değişen:** `env.ts` (`APP_ENCRYPTION_KEYS`), `app.ts` (secrets/netguard/mail/account dekorasyonu, `AppDeps.netguard|mailTransport|mfaSetupEnforcement`), `auth/{session,guards,repo,service,routes}.ts` (2FA aşaması, yarım oturum WS'de geçersiz, girişte `mfa_passed=!totpEnabled`, kilit bildirimi, şifre değişiminde açık sıfırlama bağlantıları kapanır), `tenants/{repo,service,routes}.ts` (SMTP + `requireTech2fa`), `users/{service,routes}.ts` (`reset-mfa`), `requests/{service,panel,routes}.ts` (AC-151 e-posta kanalı, `smtpConfigured`, `email/test`), `sessions/routes.ts`, `ops/metrics.ts` (`rs_mail_total`), `lib/errors.ts` (mesajlar).
- **env/deploy:** `.env.example`, `deploy/docker-compose.yml` (`APP_ENCRYPTION_KEYS` `:?` zorunlu), `docs/runbook.md` (§3 satırı + §14 P10 notları: Super Admin kurtarma).
- **testler:** `test/unit/security-p10.test.ts` (9), `test/integration/account-p10.test.ts` (16, süreç içi `smtp-server`), mevcut testlere küçük uyarlamalar (`tenant-matrix.ts` yeni uçlar + çapraz tenant vakaları, `tenants-p9` görünüm alanları, `env-logger` + `requests-p8b-2` prod anahtarı, `AuthContext` fixture alanları, doğrudan `buildApp` çağrılarında `mfaSetupEnforcement:false`).

### Tasarımdan sapmalar (gerekçeli)

1. **TOTP `otplib` yerine `node:crypto`** (mimari §5.1/§10.4 otplib diyor): otplib 13 dört geçişli paket (noble/scure eklentileri) getiriyor; ihtiyaç 25 satırlık HMAC + tekrar koruması için **eşleşen adım numarası**. RFC 6238 Ek B vektörleriyle test edildi (`security-p10.test.ts`). Karşılaştırma sabit süreli.
2. **`/sessions/:id/email` gövdesine `link`**: düz token DB'de yok (G-22), sunucu bağlantıyı üretemez; gelen bağlantı biçim + token hash'iyle doğrulanır → başka adres gönderilemez.
3. **20/sa sınırı audit sayımıyla** (koordinatör kararı 2): TX + `users FOR UPDATE` + `session.email` satırı gönderimden önce yazılır (rezervasyon); sonuç ayrıca `mail.sent`.
4. **Super Admin** (koordinatör kararı 1): forgot/kilit bildirimi gönderilmez, istek 202, audit `fail{reason:no_smtp}`; kurtarma runbook §14.
5. **MFA hata kodları** `MFA_REQUIRED` / `MFA_SETUP_REQUIRED` eklendi (mimaride kod yoktu). `verify` başarısında oturum token'ı yenilenir; `enable` diğer oturumları iptal eder (yalnız şifreyle açılmış oturum 2FA'yı atlamasın).
6. **Test anahtarı `mfaSetupEnforcement`** (yalnız `AppDeps`, env ile değiştirilemez, `server.ts` vermez): P1–P9 entegrasyon testlerindeki Admin hesapları 2FA kurulum aşamasına düşmesin diye testte kapalı; P10 testleri açık çalışır. Etkin 2FA'nın doğrulama aşaması her zaman uygulanır.
7. **netguard enjeksiyonu** (`AppDeps.netguard`): testte yalnız `127.0.0.1` sahte SMTP'ye izin verilir; üretim yolu her zaman `createNetGuard()`.
8. E-posta logosu: tenant logo yükleme henüz yok (P12) → sistem logosu `${PUBLIC_BASE_URL}/img/logo.png`. Logo gelince `mail/templates.ts` `wrap()` güncellenir.
9. E-posta kanalı (AC-151) tenant başına saatlik 30 ileti tavanı (WhatsApp tenant sınırıyla aynı), aşım bastırılır + metrik `rs_request_notify_total{channel:"email",result:"suppressed"}`.

### Eklenen bağımlılıklar

`nodemailer` 10.5.0 (MIT-0, §10.4'te onaylı), `qrcode` 1.5.4 (MIT, onaylı); dev: `smtp-server` 3.21.4 (MIT-0, yerel sahte SMTP — mimari §10.3 "MailHog/mailpit ile test" yerine süreç içi; konteyner gerekmez), `@types/qrcode`, `@types/smtp-server` (MIT). AGPL/GPL yok.

### Güvenlik kontrol listesi

Sırlar (SMTP şifresi, TOTP sırrı) AES-256-GCM; kurtarma kodu/sıfırlama token'ı yalnız SHA-256; şifre/kod/token audit ve loga yazılmaz (alıcılar `maskEmail`); SMTP hatası istemciye genel mesaj, ayrıntı `smtp_send_failed` logunda; forgot zamanlama sızdırmaz (iş yanıt sonrası); tek kullanım ve tekrar koruması koşullu UPDATE; çoklu yazmalar tek TX; dış çağrı 10 sn + 1 yeniden deneme + sınıflandırma; `any`/`console.log` yok.

### Komutlar ve son çıktı (2026-11-12, test DB `rs-mysql-p10be:33331`)

`pnpm -r run lint` temiz · `pnpm -r run typecheck` temiz · contracts `test` 68/68 · server `test` 295/295 · server `test:int` 400 testin 399'u ilk koşuda geçti; tek hata `signaling-lifecycle` AC-13 (zamanlama, P10 dışı) tek başına tekrar koşuda 9/9 geçti; P10 dosyası 16/16.

### frontend-dev'in bilmesi gerekenler

- Giriş sonrası `mfaRequired` → kod ekranı (`POST /auth/mfa/verify`, yeni çerezler gelir); `mfaSetupRequired` → kurulum (`setup` → QR/`secret` → `enable` → 10 kodu bir kez göster). Her 403 `MFA_REQUIRED`/`MFA_SETUP_REQUIRED` ilgili ekrana yönlendirir; `GET /auth/me` `mfa.stage` kaynak.
- Şifre sıfırlama sayfası `/reset-password`, token `location.hash` içindeki `token=`; 410 `RESET_TOKEN_INVALID`.
- `/settings/tenant` `smtp` iç içe nesne; şifre alanı boş gönderilirse korunur, `hasPassword` ile "kayıtlı" gösterilir. `requireTech2fa` anahtarı.
- Oturum e-postası gövdesi `{ to, link }` (oluşturma yanıtındaki `link`; sayfa yenilenip link kaybolduysa gönderim yapılamaz).
- Kullanıcı detayında "2FA'yı sıfırla" → `POST /users/:id/reset-mfa` (P9 ipucu metni güncellenebilir).
- Destek talepleri ayarında e-posta kanalı `smtpConfigured` doğruysa açılabilir; "Test maili gönder" → `POST /settings/support-requests/email/test`.

### Düzeltme turu 1 (backend-dev, 2026-11-12) — güvenlik B-P10-1..9 + QA 1–5

**Güvenlik**

- B-P10-1: `contracts/api/tenants.ts` `SMTP_ALLOWED_PORTS` {25,465,587,2525} (zod) + `mail/service.ts` `deliver` gönderimde de denetler (`port_not_allowed`). DB CHECK değişmedi (yalnız uygulama katmanı). `lib/netguard.ts` `denyHosts`: `app.ts` `PUBLIC_BASE_URL` hostunu verir, her denetimde çözülür (kendi genel IP'miz hedef olamaz). Kullanıcıya tek mesaj `SMTP_SEND_FAILED_MESSAGE`; sınıf (connect/tls/auth/rejected/port_not_allowed/insecure_auth) yalnız log + `mail.sent` audit'inde. Etkileşimli gönderim (`sendForTenant(..., {interactive:true})`: SMTP testi, e-posta kanal testi, oturum linki) tek deneme, deneme başına mutlak tavan `MAIL_ATTEMPT_CAP_MS` = 12 sn ve başarısızlıkta yanıt bu tabana çekilir → kapalı port / zaman aşımı / TLS ayrımı süreden okunamaz. `NETGUARD_EXTRA_DENY` env'i eklenmedi (yeni env → compose/runbook işi; port allowlist + kendi IP reddi bulguyu kapatıyor). Not: audit ekranı tenant Admin'e açık olduğundan sınıf audit'te görünür; port allowlist sonrası tarama yüzeyi 4 SMTP portuyla sınırlı (koordinatör talimatı: sınıf audit'te kalsın).
- B-P10-2: sahte SMTP şifresi `test/helpers/secrets.ts` `FAKE_SMTP_PASSWORD`. gitleaks v8.30.1 `apps/server/test` 0, `apps/server/src` 0, `packages` 0.
- B-P10-3: `buildApp` — `NODE_ENV=production` + `mfaSetupEnforcement:false` → hata. `test/helpers/app.ts` `makeApp` varsayılanı production env'de `true` (requests-p8b-2 prod testi tenant `requireTech2fa=false` ile gerçek kapıdan geçer).
- B-P10-4: netguard IPv6 yalnız global unicast 2000::/3, içinden 2001::/23 (Teredo dahil), 2001:db8::/32, 2002::/16 (6to4 tamamen), 3fff::/20 engelli; IPv4-mapped her yazımıyla gömülü IPv4 kuralıyla (`canonicalIp`); ::/96, SIIT, NAT64 (/96 ve /48), fec0::/10, ULA, link-local, multicast, `::` ve bölge kimlikli adres engelli.
- B-P10-5: güvenlik "Yok" + kullanıcı/şifre → 400 `fields["smtp.security"]`; DB'de kalmış böyle ayar → gönderim yok (`insecure_auth`).
- B-P10-6: `mfaEnable` UPDATE `totpSecretEnc: { equals: <doğrulanan şifreli sır> }` koşullu (paralel `setup` → 409); commit sonrası `mfaEnabledMail` (SMTP yoksa `mail.sent{not_configured}` audit). `mfaVerify` sırrı TX içinde `tx` ile okur. Yarış durumu deterministik test edilemedi (koşul kodda; bildirim ve not_configured yolu testli).
- B-P10-7: kurtarma kodu `SecretBox.mac("recovery-code")` = HMAC-SHA-256, anahtar HKDF(APP_ENCRYPTION_KEYS sürümü, info `remote-support/recovery-code/v1`); doğrulama tüm anahtar sürümleriyle (`codeHash IN`). **Eski biçim (düz SHA-256) okunmaz**: bu kod öncesi üretilmiş kurtarma kodları geçersizdir; P10 henüz yayınlanmadığı için prod/staging verisi yok. Etkilenen kullanıcı için yol: Admin "2FA sıfırla". `schema.prisma` `code_hash` yorumu ("SHA-256 hex") dba'ya: "HMAC-SHA-256 hex" olarak güncellenmeli (migration gerekmez, CHAR(64) aynı).
- B-P10-8: `SecretBox.encrypt/decrypt(plain, aad)` zorunlu AAD; bağlamlar `lib/crypto.ts` `aadFor` (`users.totp_secret_enc:<userId>`, `tenant_settings.smtp_pass_enc:<tenantId>`). Sürüm baytı değişmedi; AAD'siz yazılmış eski değer çözülemez (SMTP: "ayar okunamadı" alarmı → şifre yeniden girilir; TOTP: Admin sıfırlaması). P10 yayınlanmadığı için geçiş gerekmedi.
- B-P10-9: kilit e-postası kullanıcı başına saatte 1 (`limits.lockMail`). 2FA sınırı hesap+IP 5/5 dk + hesap geneli 15/15 dk (G-23 kalıbı): tek IP'den gerçek kullanıcının doğrulaması kilitlenemez; hesap başına deneme hızı önceki tavanla aynı (60/sa) → kaba kuvvet direnci düşmez. Birden çok IP'li saldırgan hesap geneli kilidi yine tetikleyebilir (G-23'te kabul edilmiş DoS).

**QA**

1. AC-151: "yeni talep → ayarlı her alıcıya e-posta…" (iki alıcı, gövdede ad/telefon/e-posta/açıklama yok, `request.notify{email}` ×2 + `mail.sent{request_notify}` ×2; SMTP kapalı portta talep yine 201, `request.notify` fail ×2).
2. AC-115: "logout-all sonrası… 5 sn içinde biter" ve "Admin 2FA sıfırlayınca…" (misafire `session.ended{auth_revoked}` ≤ 5 sn, DB ENDED).
3. AC-10: e-postada teknisyen adı, link, `Intl` Europe/Istanbul son geçerlilik, logo `img src`; `session.email` audit'inde konu + maskeli alıcı.
4. "yarım oturum WS'te (panel + teknisyen sinyal) reddedilir, veri ucu 403 MFA_REQUIRED" (test dosyası artık gerçek dinleyen sunucu kullanır).
5. = B-P10-3 (`security-p10.test.ts` "B-P10-3 …").

- Ek: `test/integration/mail-tls-p10.test.ts` — TLS'li sahte SMTP (openssl ile anlık sertifika, SAN `smtp.test`), bağlantı 127.0.0.1'e, `tls.servername=smtp.test` ile başarılı; aynı IP + başka ad → `tls` hatası, ileti gitmez. (CI'da `openssl` gerekir — ubuntu runner'da var.)
- Test altyapısı: sahte SMTP sözleşme gereği 2525'te kayıtlı; test taşıyıcısı 2525'i süreç içi sunucuya, diğer portları kapalı port 9'a yönlendirir (üretim seçenekleri değişmez).

**Değişen dosyalar:** `packages/contracts/src/api/tenants.ts`; `apps/server/src/{app.ts, lib/crypto.ts, lib/netguard.ts, auth/mfa.ts, auth/account.ts, mail/service.ts, mail/templates.ts, tenants/service.ts, tenants/smtp-routes.ts, requests/routes.ts, sessions/email.ts}`; testler `test/unit/security-p10.test.ts`, `test/integration/{account-p10,mail-tls-p10(yeni),requests-p8b-2}.test.ts`, `test/helpers/{app,secrets}.ts`. Yeni bağımlılık yok.

**Komutlar ve sonuç:** `pnpm -r run lint` temiz · `pnpm -r run typecheck` temiz (web dahil) · contracts 68/68 · web 205/205 · server unit 304/304 · `test:int` (rs-mysql-p10fix:33333, sonra `down`) 42 dosya 408/408, skip 0.

**frontend-dev için:** `SMTP_ERROR_MESSAGES` kaldırıldı; hata metni `SMTP_SEND_FAILED_MESSAGE`. Port alan hatası `SMTP_PORT_MESSAGE`, güvenlik alan hatası `fields["smtp.security"]` = `SMTP_INSECURE_AUTH_MESSAGE`. SMTP testi başarısızlıkta ~12 sn sürer (yükleniyor durumu buna göre). 2FA doğrulamada 429 eşiği hesap+IP 5 / hesap geneli 15.

### Düzeltme turu 2 (backend-dev, 2026-11-12) — prod öncesi (güvenlik Kod turu 2 B-P10-10/11, QA Tur 2 önerisi, runbook)

- **B-P10-10** `lib/netguard.ts`: kendi-ad (`denyHosts`) çözümü başarısızsa **son başarılı çözüm** (süreç içi, ad başına,
  kanonik) kullanılır; hiç başarılı çözüm yoksa her hedef `HOST_NOT_ALLOWED` (fail-closed). Gerekçe: G-12/T22 "yasak hedefe
  bağlanılmaz" garantisi DNS hatasında da korunur (önbellek yoksa ret); salt fail-closed yerine önbellek, geçici DNS
  kesintisinde tüm e-posta gönderimini (talep bildirimi, kilit/2FA e-postası) durdurmamak için — kendi IP'miz değişmeden
  önbellek doğru kalır, değiştiyse bir sonraki başarılı çözümde güncellenir. Alarm logu `netguard_self_unresolved
{host, cached}` (`createNetGuard({ onSelfUnresolved })`, `app.ts`). `canonicalIp` artık IPv6'yı RFC 5952 metnine çevirir
  (küçük harf, sıfır dolgusuz, en uzun sıfır grubu `::`); küme hem eklemede hem sorguda kanonik → sıfır dolgulu/uzun yazım
  kuralı atlatamaz. `isBlockedIp` davranışı değişmedi.
- **B-P10-11** `mail/service.ts`: taşıyıcıya `getSocket` verilir; düz TCP soketi (`node:net`, hedef = taşıyıcı `host` =
  netguard IP'si) serviste açılır, TLS yükseltmesini (465 örtük / STARTTLS) nodemailer `tls.servername` ile yapar (SNI ve
  sertifika adı değişmedi; `mail-tls-p10` geçiyor). Tavan aşımı veya herhangi bir başarısızlıkta denemenin soketleri
  `destroy()` edilir (üstteki TLS soketi de kapanır). Başarılı gönderimde nodemailer QUIT ile kendisi kapatır.
- **QA önerisi** `auth/session.ts`: modül global'i `setupEnforced` ve `setMfaSetupEnforcement` kaldırıldı. Bayrak uygulama
  örneğinde `app.mfaSetupEnforced` (buildApp `mfaSetupEnforcement ?? true`; production'da `false` yine hata — B-P10-3).
  `mfaStageOf(u, mfaPassed, setupEnforced)` ve `resolveSession(db, token, now, { setupEnforced, allowPartial? })` bayrağı
  açıkça alır (zorunlu parametre — unutulan çağıran tip hatası verir); `login(..., input, setupEnforced, ...)`. Çağıranlar:
  `auth/guards.ts`, `auth/routes.ts`, `signaling/ws.ts`, `requests/ws.ts` (`app.mfaSetupEnforced`). Bir test örneğinin
  `false` ile kurulması (ör. `startLive({mfaSetupEnforcement:false})`) artık diğer örnekleri etkilemez.
- **Dokümantasyon:** `docs/runbook.md` §14 P10 "Anahtar rotasyonu / emekliye ayırma" (eski sürüm verisi kalmayana kadar
  listede; erken çıkarma TOTP/SMTP/kurtarma kodu HMAC'lerini geri dönüşsüz bozar; anahtar yedeği zorunlu) + alarm
  `netguard_self_unresolved` + 12 sn bağlantı tavanı notu; §3 `APP_ENCRYPTION_KEYS` satırından bağlantı. `docs/mimari-api.md`
  P10 sapma notu (7)'ye "(11) ile geçersiz" eklendi.
- **Testler:** `test/unit/security-p10.test.ts` — "B-P10-10 …" (kanonik IPv6, sıfır dolgulu hedef ve kendi-ad, DNS hatası +
  önbellek yok → ret, geçici DNS hatasında önbellek), "QA-P10: … uygulama örneğine ait", "AC-67: mfaStageOf …";
  `test/integration/mail-cap-p10.test.ts` (yeni) — EHLO yanıtını her 9 sn'de bir satır damlatan süreç içi sahte SMTP: gerçek
  tavanla `deliver` 12 sn'de `{ok:false, reason:"connect"}` döner ve sunucu tarafında soket ≤ 1 sn içinde kapanır. Negatif
  kontrol: `destroy()` satırı devre dışıyken test kırmızı (soket açık kalıyor) — düzeltme olmadan bulgu yeniden üretildi.
  `test/integration/sessions.test.ts` doğrudan `resolveSession` çağrısı yeni imzaya uyarlandı.
- **Değişen dosyalar:** `apps/server/src/{app.ts, lib/netguard.ts, mail/service.ts, auth/session.ts, auth/service.ts,
auth/routes.ts, auth/guards.ts, signaling/ws.ts, requests/ws.ts}`; testler `test/unit/security-p10.test.ts`,
  `test/integration/{mail-cap-p10 (yeni), sessions}.test.ts`; `docs/{runbook.md, mimari-api.md}`. Yeni bağımlılık, env,
  migration yok. Sapma yok.
- **Komutlar ve sonuç:** `pnpm -r run lint` temiz · `pnpm -r run typecheck` temiz · server unit 18 dosya 310/310 ·
  `test:int` (rs-mysql-p10fix2:33335, sonra `down`) 43 dosya 409/409 · gitleaks v8.30.1 `apps/server/src` 0,
  `apps/server/test` 0.
- **frontend-dev için:** sözleşme değişikliği yok.

## P10 — Frontend (Rotalar) (frontend-dev, 2026-11-12)

Kapsam: AC-10, 66, 67, 68, 79, 80, 115 (logout-all, 2FA sıfırlama), 122 (UI yüzü), 151. Tipler `@remote/contracts`
(api/auth, api/tenants, api/sessions, api/requests); web yüzü `apps/web/lib/account/contract.ts` yalnız yeniden dışa aktarım.

### Rotalar

| Yol                                | Auth                                        | Ne yapar                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/login`                           | Hayır                                       | "Şifremi unuttum" bağlantısı eklendi; `?reason=reset` başarı mesajı. Girişten sonra sıra: 2FA kodu → zorunlu şifre → zorunlu 2FA kurulumu → hedef                                                                                                                                                                                                                                                                                  |
| `/login/2fa`                       | Yarı oturum                                 | 6 haneli TOTP ya da kurtarma kodu (geçiş düğmesi); 401 alan hatası + alan temizlenir; 429 kilit tonu; "Çıkış yap"                                                                                                                                                                                                                                                                                                                  |
| `/2fa/setup`                       | Oturum                                      | 2FA kurulumu: QR (`logo-surface` kartı) + elle anahtar (4'lü grup, kopyala) → kod → 10 kurtarma kodu (bir kez; kopyala / .txt indir; "Kaydettim" işaretlenmeden devam yok). Zorunlu ve kurulmamışsa panel buraya yönlendirir (kapı; kaçış yalnız çıkış)                                                                                                                                                                            |
| `/forgot-password`                 | Hayır                                       | E-posta → 202; mesaj hesabın varlığını söylemez ("kayıtlı bir hesap varsa…")                                                                                                                                                                                                                                                                                                                                                       |
| `/reset-password#token=…`          | Hayır                                       | Token yalnız URL parçasından okunur, adres çubuğundan silinir; yeni şifre + tekrar; 410 → "bağlantı geçersiz/süresi dolmuş" + "Yeni bağlantı iste"                                                                                                                                                                                                                                                                                 |
| `/account`                         | Evet (herkes)                               | Hesap güvenliği: profil özeti, şifre değiştir (sayfada kalır, toast), 2FA durumu + kalan kurtarma kodu (≤ 3 uyarı) / kur bağlantısı, "Tüm cihazlardan çıkış" (onay diyaloğu, `revokedSessions` toast). Üst menüde avatar bu sayfaya bağlantıdır                                                                                                                                                                                    |
| `/settings/smtp`                   | `settings.view` (düzenleme `settings.edit`) | SMTP Ayarları: sunucu, port, güvenlik Yok/SSL/TLS (port önerisi 25/465/587; özel port korunur; "Yok"ta uyarı), kullanıcı, şifre (maskeli, geri yazılmaz, boş = korunur), gönderen adı/adresi; kaydet çubuğu + ayrılma uyarısı; `HOST_NOT_ALLOWED` sunucu alanına; "SMTP ayarlarını kaldır" (onaylı `smtp: null`); "Test Maili Gönder" (kayıtlı ayarla, kirliyken pasif; diyalog alıcı sorar, sonucu gösterir; 502/429 genel mesaj) |
| `/settings/security`               | `settings.view` (düzenleme `settings.edit`) | "Teknisyenler için 2FA zorunlu" anahtarı (`requireTech2fa`; anında kayıt, hata olursa geri döner)                                                                                                                                                                                                                                                                                                                                  |
| `/settings/support-requests`       | `settings.edit`                             | AC-151: e-posta kanalı anahtarı (SMTP yoksa pasif + "Önce SMTP ayarlarını yapın" + SMTP bağlantısı), e-posta alıcıları (≤ 5, küçük harf, tekil), "Test maili gönder"                                                                                                                                                                                                                                                               |
| `/sessions` (yeni oturum diyaloğu) | `sessions.create`                           | AC-10: "Linki e-postayla gönder" → alıcı → `{ to, link }`; sonuç satır içinde (başarı / 429 saatlik sınır / 502 / oturum artık beklemede değil)                                                                                                                                                                                                                                                                                    |
| `/users/[id]`                      | `users.edit`                                | "2FA'yı sıfırla" (yalnız 2FA etkin, yönetilebilir, kendi hesabı olmayan etkin kullanıcıda; `alertdialog`, odak Vazgeç); P9 ipucu metni güncellendi                                                                                                                                                                                                                                                                                 |

Ayarlar bölümüne alt menü eklendi (`settings/layout.tsx`): Destek talepleri (`Inbox`) · E-posta (SMTP) (`Mail`) · Güvenlik (`ShieldCheck`); kenar çubuğundaki "Ayarlar" tüm `/settings/*` altında etkin.

### Davranış notları

- Panel kabuğu ve oturumlu sayfalar `lib/server-api.ts` `gateOf()` ile yönlendirir (`mfa.stage` verify → `/login/2fa`; `mustChangePassword` → `/change-password`; stage setup → `/2fa/setup`). `/auth/me` 403 `MFA_REQUIRED`/`MFA_SETUP_REQUIRED` dönerse de aynı karar. İstemci `lib/api.ts`: bu iki 403 kodunda ilgili ekrana gider.
- AC-68 istemci yüzü `app/(panel)/session-watch.tsx` + `lib/account/idle.ts`: istemci kendi başına oturum düşürmez; 31,5 dk kullanıcı etkinliği yoksa ve sekmeye dönüldüğünde (≥ 60 sn arayla) tek `GET /auth/me`; 401 → `/login?reason=expired`.
- Kurtarma kodu "yenile" işlevi **yok**: sözleşmede uç yok (mimari-api'de yalnız setup/enable/verify). Hesap sayfası kalan kod ≤ 3'te "yöneticinizden 2FA sıfırlamasını isteyin" der. Kendi 2FA'sını kapatma da sözleşmede yok. İhtiyaç olursa backend-dev + mimar: `POST /auth/mfa/recovery-codes { code }` → `{ recoveryCodes }` önerisi.

### Değişen / eklenen dosyalar (apps/web)

- Yeni: `app/(auth)/login/2fa/{page,mfa-verify-form}.tsx`, `app/(auth)/2fa/setup/page.tsx`, `app/(auth)/forgot-password/{page,forgot-form}.tsx`, `app/(auth)/reset-password/{page,reset-form}.tsx`, `app/(panel)/account/{page,account-security}.tsx`, `app/(panel)/session-watch.tsx`, `app/(panel)/settings/{layout,settings-tabs,tenant-settings-page}.tsx`, `app/(panel)/settings/smtp/{page,smtp-form}.tsx`, `app/(panel)/settings/security/{page,security-form}.tsx`, `app/(panel)/sessions/session-email.tsx`, `components/auth-exit.tsx`, `components/account/{mfa-setup,recovery-codes,mail-test-dialog}.tsx`, `lib/account/{contract,smtp-form,idle,recovery,reset-token}.ts`, `lib/account/account.test.ts`, `e2e/mock-account.mjs`, `e2e/p10-account.spec.ts`.
- Değişen: `proxy.ts` (public `/forgot-password`, `/reset-password`), `lib/server-api.ts` (`gateOf`, `mfa` durumu), `lib/api.ts`, `lib/auth-schema.ts` (`parseNewPassword`), `app/(auth)/login/{page,login-form}.tsx`, `app/(auth)/change-password/{page,change-password-form}.tsx` (`onDone`), `app/(panel)/layout.tsx` (kapı, avatar → `/account`, SessionWatch), `app/(panel)/side-nav.tsx`, `app/(panel)/settings/support-requests/settings-form.tsx`, `lib/requests/settings-form.ts` (+test), `app/(panel)/sessions/created-session.tsx`, `app/(panel)/users/[id]/user-editor.tsx`, `messages/tr.json`, `e2e/mock-api.mjs`, `e2e/mock-requests.mjs` (`u-rqmail-*` SMTP'li firma, e-posta testi), `e2e/mock-users.mjs` (reset-mfa; Can Aydın 2FA etkin), `e2e/p8b-requests.spec.ts` (yorum).

### Sapmalar

- Ayarlar alt menüsü breadcrumb'ın üstünde (ortak `settings/layout.tsx`); sayfa başlıkları sayfalarda kalır.
- `mfa.v.*` doğrulamada 400 de "kod hatalı" sayılır (enable 400 `fields.code`, verify 401).
- Tasarım skill dosyaları okunmadı (tur sınırı); DESIGN.md token/primitifleri kullanıldı, yeni token yok.

### Testler

- Vitest: `lib/account/account.test.ts` (SMTP formu, port önerisi, şifre korunur, kaldırma, sunucu alan eşleme, token okuma, anahtar gruplama, kod dosyası, boşta yoklama), `lib/requests/requests.test.ts` (e-posta kanalı).
- Playwright `e2e/p10-account.spec.ts` (desktop + mobile): giriş+2FA, kurtarma kodu + yarı oturumda panel kapalı, zorunlu kurulum kapısı (QR/anahtar/kodlar/indir), şifremi unuttum + sıfırlama + geçersiz bağlantı, SMTP (port önerisi, maskeli şifre, iç ağ reddi, test maili başarı/hata, 375 px taşma, axe), SMTP yok / salt okunur, 2FA zorunluluk anahtarı, hesap güvenliği (logout-all onaylı, şifre değiştir), AC-151 e-posta kanalı (SMTP var/yok), AC-10 oturum linki e-postası (başarı/429), AC-115 2FA sıfırlama.
- Sonuç: `lint` ✓ · `typecheck` ✓ · `test` 203/203 ✓ · `e2e` 243 geçti / 84 atlandı (proje filtreleri) / 0 hata.

### Düzeltme turu 1 (frontend-dev, 2026-11-12) — B-P10-1, B-P10-5 arayüz tarafı

- **Port (B-P10-1):** `/settings/smtp` port alanı serbest metin yerine `SelectField`; seçenekler sözleşmedeki `SMTP_ALLOWED_PORTS` (25/465/587/2525). Güvenlik önerisi korunur (SSL→465, TLS→587, Yok→25; 2525 seçiliyse değişmez). Kayıtlı değer listede değilse (kısıt öncesi kayıt) seçim kutusu onu sessizce değiştirmez, "`<port>` (artık desteklenmiyor)" seçeneği olarak gösterir; kaydetmede `SMTP_PORT_MESSAGE` alan altında. Sunucu 400 `fields["smtp.port"]` port alanının altında.
- **Yok + kimlik (B-P10-5):** "Yok" seçilince kullanıcı adı/şifre alanları pasif ve boş görünür, "Şifresiz bağlantıda kimlik bilgisi gönderilmez; SSL veya TLS seçin." açıklaması (kayıtlı kullanıcı varsa "kaydederseniz silinir" eki) çıkar. Gövdede `user: ""`, `password` yok. Yazılmış değer durumda kalır, SSL/TLS'e dönülünce geri gelir. Sunucu 400 `fields["smtp.security"]` (`SMTP_INSECURE_AUTH_MESSAGE`) güvenlik seçiminin altında (`smtp-security-error`, port ipucunun yerine). `smtp.insecure` uyarı metninden "şifre" ifadesi çıkarıldı.
- **Tek genel hata (B-P10-1):** `MailTestDialog` 502/`ok:false` mesajını olduğu gibi gösterir, mesaj yoksa `SMTP_SEND_FAILED_MESSAGE`. "Test maili gönderilemedi." öneki ve `smtp.testFail` anahtarı kaldırıldı. Web'deki `SMTP_ERROR_MESSAGES` yeniden dışa aktarımı kaldırıldı (contracts'ta `@deprecated`; backend-dev silebilir).
- Dosyalar: `lib/account/contract.ts`, `lib/account/smtp-form.ts` (`smtpCredsAllowed`, `effectiveCreds`, `smtpPortOptions`), `app/(panel)/settings/smtp/smtp-form.tsx`, `components/account/mail-test-dialog.tsx`, `messages/tr.json`, `e2e/mock-account.mjs` (genel mesaj; `red.ornek.com` → sunucu port/güvenlik alan hataları), `e2e/mock-requests.mjs` (kanal testi `ok:false` genel mesaj), `lib/account/account.test.ts`, `e2e/p10-account.spec.ts`.
- Sonuç: `lint` ✓ · `typecheck` ✓ · `test` 205/205 ✓ · `e2e` 243 geçti / 84 atlandı / 0 hata.

### Düzeltme turu 2 (frontend-dev, 2026-11-12) — P10 sayfa testi bulguları 1–4 (`docs/test-raporu.md`)

- **1 [ORTA] Test maili diyaloğu:** `MailTestDialog` artık `onDismiss={close}` veriyor; gönderim sürerken Esc / X / Kapat no-op. Bekleme sırasında `role=status` satırı (`mail-test-waiting`, `LoaderCircle` + "Sunucuya bağlanılıyor… Bu işlem 15 saniyeye kadar sürebilir"). `ui/dialog.tsx`: Chrome art arda Esc'de `cancel`'ı iptal ettirmeden kapatıyor (doğrulandı — koruma kaldırılınca e2e kırmızı); sahibi kapanmayı reddedip `open` true bırakırsa diyalog `showModal()` ile geri açılır → React durumu ile DOM eşit kalır, sonraki "Test Maili Gönder" diyaloğu yeniden açar. Tüm `Dialog` kullanıcıları için geçerli; davranış değişikliği yalnız `open`'ı true bırakan sahiplerde.
- **2 [DÜŞÜK] Ayarlar sekmeleri 375 px:** `settings-tabs.tsx` < sm'de üç eşit sütun (ikon üstte, `text-xs` etiket sarar), sm+ önceki gibi yatay tek satır → kırpma/kaydırma yok, etkin sekme her genişlikte görünür. DESIGN.md "Ayarlar alt menüsü" satırı güncellendi.
- **3 [DÜŞÜK] `/login/2fa` ziyaretçi:** `/auth/me` 401'de oturum çerezi yoksa `/login` (mesajsız), çerez var ama geçersizse `/login?reason=expired` (yol proxy'de herkese açık olduğundan ayrım sayfada).
- **4 [DÜŞÜK] Kurtarma kodu şeması (contracts):** `recoveryCodeSchema` önce tüm boşlukları siler + büyük harfe çevirir, sonra `^[A-Z2-7]{5}-?[A-Z2-7]{5}$` (`ABCDE - 23456` → `ABCDE-23456`). Sunucu `normalizeRecoveryCode` (`mfa.ts`, tire+boşluk silip küçük harf) aynı değere indirgiyor → sunucu değişmedi. Base32 dışı karakter (0/1/8/9) artık istemcide reddedilir (gerçek kodlarda yok); e2e sahte kurtarma kodu `abcde-12345` → `abcde-23456`, sahte API karşılaştırması sunucu normalizasyonuna eşitlendi.
- Testler: `packages/contracts/test/auth-p10.test.ts` (yeni: normalize vakaları, biçim/uzunluk, verify gövdesi); `e2e/p10-account.spec.ts` (+3: Esc gönderim sırasında kapatmaz + bekleme metni + kapat/yeniden aç; 375 px sekme taşması; `/login/2fa` ziyaretçi vs geçersiz çerez; kurtarma kodu `" ABCDE - 23456 "` ile giriş).
- Dosyalar: `components/account/mail-test-dialog.tsx`, `components/ui/dialog.tsx`, `app/(panel)/settings/settings-tabs.tsx`, `app/(auth)/login/2fa/page.tsx`, `messages/tr.json` (`smtp.testWaiting`), `packages/contracts/src/api/auth.ts`, `e2e/mock-account.mjs`, `DESIGN.md`.
- Sonuç: `lint` ✓ · `typecheck` ✓ · contracts 71/71 ✓ · server unit 310/310 ✓ · web 205/205 ✓ · `e2e` 247 geçti / 86 atlandı / 0 hata.

## P11 — DevOps (devops, 2026-11-13)

- **dba değişiklikleri gözden geçirildi** (compose `--log-bin-trust-function-creators=1`, CI `SET GLOBAL`, `test-db.sh`,
  `check-app-grants.sh` root kontrolleri): SHA sabitleme ve `permissions: contents: read` korunuyor, yeni Action yok;
  `app` yetkisi genişlemedi, SUPER verilmedi. İki düzeltme:
  1. `ci.yml`: root parolası `docker exec -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD"` ile docker CLI argümanına konuyordu →
     konteynerin kendi env'inden okunuyor (`sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" …'`, check-app-grants ile aynı desen).
     Adım ayrıca `SELECT @@log_bin, @@log_bin_trust_function_creators` = `1 1` doğrular; değilse migrate'ten önce düşer.
  2. `test-db.sh`: `mysql:8.4` yüzen etiketi compose/CI ile aynı `mysql:8.4.13@sha256:a81d…` digest'ine sabitlendi
     (`MYSQL_IMAGE`; bayrak 8.4'te deprecated, sessiz alt sürüm geçişi davranışı değiştirmesin). Compose güncellenince birlikte.
- Yeni env değişkeni yok (`.env.example`/`env.ts`/compose değişmedi).
- Runbook §15 (yayın, 1419 kurtarma, geri alma, panel MySQL → `.env`, panel TURN ↔ coturn secret, yedek notu, sorun
  giderme) ve §14 P10 prod kontrol listesine 7–10. maddeler.
- **Yerel prova (2026-11-13):** named volume'lu bayraksız mysql → bayrakla `compose up -d mysql` → `1 1`, veri korundu;
  P1→P11 migrate + CI adım komutu rc 0; `check-app-grants.sh` 320 PASS / 0 FAIL, çıktıda parola yok; down guard 3819
  (hiçbir şey değişmedi) → satır silinip down OK (son migration P10); bayrak 0 → migrate P3018/1419, şema değişmedi →
  bayrak 1 + `resolve --rolled-back` + migrate → `up to date`, 320 PASS; sabitlenmiş `test-db.sh up` → 8.4.13, `1 1`.
  Geçici konteyner/volume'lar silindi. Staging'e bağlanılmadı.
- backend-dev'e not: TURN secret çözülemezse env'e değil yalnız STUN'a düşülüyor (runbook §15.5'te belgelendi; bilinçli
  ise sorun yok). Panel TURN secret'ı için coturn kuralı (≥ 32 karakter, boşluk/`#` yok) zod'da yoksa eklenmeli; aksi halde
  panelde kabul edilen secret coturn'e yazılamaz.

## P11 — Backend (backend-dev, 2026-11-13)

Kapsam: mimari §3.3, §10 P11; mimari-api "Yönetim"; ADR-0003; AC-76, 77, 78, 123, 124 (+ AC-29 aydınlatma metni düzenleme). Yeni bağımlılık yok, yeni env değişkeni yok.

### Değişen / eklenen dosyalar

- **contracts:** `src/api/audit.ts` (yeni: sorgu şeması, `AuditItem`, CSV sütunları, işlem grupları), `src/api/system-settings.ts` (yeni: MySQL/TURN/aydınlatma metni şemaları ve görünümleri, sınıflı mesajlar), `src/audit.ts` (`SYSTEM_AUDIT`: `settings.mysql.updated|test`, `settings.turn.updated|deleted`, `settings.consent_text.updated`, `audit.exported`), `src/errors.ts` (`METHOD_NOT_ALLOWED` 405), `package.json` export yolları.
- **server:** `src/audit/{routes,read,repo,view}.ts` (yeni), `src/settings/{routes,system,consent,mysql-probe}.ts` (yeni), `src/public/consent.ts` (`publishConsentText` — sürüm geçişinin tek yeri), `prisma/seed-consent.ts` (aynı fonksiyonu kullanır, davranış aynı), `src/lib/crypto.ts` (`aadFor.systemSecret`), `src/lib/errors.ts` (405 mesajı), `src/signaling/rooms.ts` (`turn` artık değiştirilebilir alan), `src/app.ts` (rota kaydı, açılışta panel TURN yükleme, test için `mysqlProbe` enjeksiyonu).
- **testler:** `test/unit/p11.test.ts` (13), `test/integration/audit-p11.test.ts` (10), `test/integration/settings-p11.test.ts` (11), `test/helpers/text-sql.ts` (yeni: metin protokolü yardımcısı), `test/integration/db-grants.test.ts` (madde 7 düzeltmesi), `test/integration/audit-immutability-p11.test.ts` (dba testi ortak yardımcıya bağlandı, 3 lint hatası giderildi; test içeriği aynı), `test/helpers/{app,tenant-matrix}.ts` (`p11` seçeneği; 24 yeni uç sınıflandırıldı).

### Uçlar (özet)

- `GET /audit`: `audit.view`. Sayfa 50, sıralama `created_at desc, id desc`, keyset imleç (opak base64url), COUNT yok. `from` verilmezse son 30 gün; aralık > 731 gün ise 400 `fields.from`. Tarihler Europe/Istanbul günü (`YYYY-MM-DD`, `to` dahil; P8 ile aynı). `action` tam değer ya da `x.*` önek (LIKE jokerleri kaçışlı). Kapsam: tenant kullanıcısında ve firmaya geçmiş Super Admin'de yalnız etkin tenant (`tenantId` yok sayılır); firma seçmemiş Super Admin'de tüm tenant'lar + sistem kayıtları (NULL) + isteğe bağlı `tenantId`. `userFullName` ayrı sorguyla gelir (user_id FK değil), `avatarUrl` P12'ye kadar null.
- **Okuma süzgeci (`audit/view.ts`, güvenlik koşulu B-P10):** `maskValue` okumada yeniden uygulanır. `mail.*`, `session.email`, `settings.*.test` ve adında `smtp` geçen eylemlerde yalnız izinli ilkel alanlar döner (`kind, recipient, subject, result, reason, channel, latencyMs, host, port, database, user`). `reason` yalnız `[a-z_]{1,40}` biçiminde bir sınıfsa geçer, değilse `"other"` döner. Ham hata metni, yanıt kodu ve banner hiçbir anahtar üzerinden dönmez.
- `GET /audit/export.csv`: `audit.export`, 5/dk/kullanıcı. Sayım üst sınırlı yapılır (`count take 50001`); 50.000'i aşarsa 400 `fields.to` döner ve yarım dosya oluşmaz. Akış P8 deseniyle, 1000'lik keyset partileriyle ilerler; hücrelere `lib/csv.ts` formül kaçışı uygulanır. Firma seçmemiş Super Admin için "Firma" sütunu eklenir. `audit.exported` kaydı filtre özeti ve satır sayısını tutar.
- `/audit`, `/audit/export.csv`, `/audit/:id` için POST/PUT/PATCH/DELETE → 405 `METHOD_NOT_ALLOWED`. `Allow: GET, HEAD` döner; `/audit/:id` için okunabilir tekil kaynak olmadığından `Allow` boştur. Bu uçlar kimlik doğrulamadan önce çalışır (deterministik, veri dönmez).
- `GET/PUT /admin/settings/mysql`, `POST /admin/settings/mysql/test`, `GET/PUT/DELETE /admin/settings/turn`: yalnız SUPER_ADMIN. `GET/PUT /settings/consent-text`: `settings.view` / `settings.edit`, etkin tenant.

### Tasarımdan sapmalar (gerekçeli)

1. **MySQL sürücüsü `mysql2` yerine `mariadb` (3.5.4):** Prisma adaptörünün zaten getirdiği paket. pnpm katı yapısında doğrudan import edilemediği için `@prisma/adapter-mariadb` üzerinden `createRequire` ile çözülüyor (`settings/mysql-probe.ts`). Yeni bağımlılık eklenmedi.
2. **MySQL testi hata durumunda 502 değil, 200 `{ ok:false, message, latencyMs }` döner:** Bağlantı denendi ve başarısız oldu; ekran sonucu ve süreyi gösterir (AC-77). 429 (5/dk/kullanıcı) ve 400 aynen geçerli. Mesajlar sınıflıdır: bağlanılamadı / kimlik reddedildi / veritabanı yok / zaman aşımı / kayıtlı şifre okunamadı. Ham sürücü hatası yalnız server logunda (`mysql_test_failed` + ref). Zaman aşımı 10 sn ve kesindir: sürücü süreleri artı yarış zamanlayıcısı; geç kurulan bağlantı hemen kapatılır.
3. **Güvenlik kararı — şifre geri düşüşü:** Test ucunda şifre boşsa kayıtlı (ya da env) şifre **yalnız hedef host + port + kullanıcı o kaynakla aynıysa** kullanılır. Aksi halde 400 `fields.password` (`MYSQL_PASSWORD_REQUIRED_MESSAGE`) döner. Gerekçe: caching_sha2 açık anahtar akışında karşı sunucu düz şifreyi alabilir; kayıtlı DB şifresi başka bir sunucuya gönderilemez.
4. **MySQL görünümüne ek alan:** `matchesRunning` (panel kaydı çalışan DATABASE_URL ile aynı mı). PUT yanıtında ayrıca `restartRequired: true` ve `message` (`MYSQL_APPLY_NOTE`) var. Canlı geçiş yok (ADR-0003).
5. **TURN DELETE satır silmez:** dba, `system_settings` için app kullanıcısına DELETE yetkisini bilerek vermedi ("kaldırma = varsayılana dönüş, satır kalır", grants.sql + check-app-grants.sh + dba testi). DELETE satırı `{urls: []}` ve secret NULL yapar; okuyucular bunu "panel yok → env" sayar. Bu yüzden PUT en az 1 URL ister. DELETE idempotenttir: zaten env ise değişiklik ve audit yazılmaz. Grants değiştirilmedi.
6. **TURN secret çözülemezse yalnız STUN (devops notu 1 — bilinçli):** Panel kaydı varken env'in URL/secret'ı kullanılmaz. Super Admin env sunucularını panelle değiştirmiştir; sessizce eski sunuculara dönmek hem beklenmedik olur hem de anahtar rotasyonu hatasını gizler. Bu durumda `system_secret_unreadable` alarmı loglanır; çözüm secret'ı panelde yeniden girmek ya da DELETE ile env'e dönmektir. Açılışta DB'ye hiç ulaşılamazsa env ile devam edilir (`turn_settings_load` alarmı).
7. **TURN secret kuralı (devops notu 2):** 32..256 karakter, yazdırılabilir ASCII, boşluk ve `#` yok (coturn yapılandırma satırında kesilirler).
8. **Aydınlatma metni, gövde değişmediyse:** 409 yerine 200 `{ changed: false }` döner. Yeni sürüm ve audit oluşmaz, böylece çift gönderim güvenlidir. Eşzamanlı iki farklı kayıtta kaybeden tarafa 409 `CONFLICT` döner (koşullu `is_current` geçişi 0 satır etkiler); tek güncel sürüm DB UQ'larıyla da korunur. Gövde CRLF → LF normalize edilir ve kırpılır; satır sonu/sekme dışı kontrol karakterleri, bidi ve sıfır genişlikli karakterler reddedilir. `versions` en çok 100 kayıt döner (yeniden eskiye). GET yanıtına `createdByName` eklendi (null = sistem metni).
9. **Audit tarih filtresi gün biçiminde** (`YYYY-MM-DD`, P8 ile aynı). Sözleşmede yalnız `from/to` adı vardı.
10. **Panel TURN etkisi:** `rooms.turn` PUT/DELETE sonrası ve açılışta güncellenir (tek instance, ADR-0005). Açık odalar yeni ayarı bir sonraki credential yenilemesinde alır.

### Madde 7 (dba bulgusu) — db-grants yanlış pozitifi

`db-grants.test.ts` artık tüm ifadeleri metin protokolüyle çalıştırıyor (`test/helpers/text-sql.ts`). Hata metninde 1295 / "not supported in the prepared statement" **olmamalı** ve yetki reddi (`command denied`/1142…) **olmalı**. `DROP TRIGGER audit_logs_retention_only_delete` satırı eklendi. dba'nın testi aynı yardımcıya bağlandı (kod kopyası kaldırıldı).

### frontend-dev için sözleşme notları

- Tipler: `@remote/contracts/api/audit`, `@remote/contracts/api/system-settings`.
- `AuditListResponse = { items, nextCursor }`, toplam sayı yok ("Daha fazla yükle" ya da imleç yığını kullanın). `AUDIT_ACTION_GROUPS` filtre listesi için, `AUDIT_RESULT_LABELS` sonuç etiketleri için.
- 405 hata kodu `METHOD_NOT_ALLOWED` eklendi.
- MySQL test yanıtı başarısızlıkta 200 `{ ok:false }`; 400 `fields.password` = "Farklı sunucu veya kullanıcı için şifreyi girin".
- TURN PUT en az 1 URL ister; "Varsayılana dön" düğmesi = DELETE.
- Aydınlatma metni PUT yanıtındaki `changed:false` → "Metin değişmedi" bildirimi. 409 → "Başka biri değiştirdi, yenileyin".

### Komutlar ve son çıktı (2026-11-13, geçici `rs-mysql-p11be:33361`, mysql:8.4 + binlog bayrağı; sonra silindi)

- `pnpm -r run typecheck` → 3/3 Done. `pnpm -r run lint` → hata yok (web'de önceden var olan 1 uyarı).
- `apps/server`: `vitest run test/unit` → **19 dosya, 323 test geçti** (P11: 13). `vitest run test/integration` → **46 dosya, 442 test geçti** (P11: audit 10 + ayarlar 11 + db-grants 1; tenant izolasyonu yeni uçlarla yeşil).
- `packages/contracts`: 8 dosya, 71 test geçti.

### Düzeltme turu 1 (backend-dev, 2026-11-12) — qa-raporu madde 1, guvenlik-raporu "P11 turu"

Yalnız atanan maddeler: B-P11-1 (= QA-1), B-P11-2, B-P11-4 (kısmi), B-P11-5, B-P11-6. B-P11-3 (TLS) backend'de "Sonra", bu turda yalnız frontend uyarısı.

**Değişen dosyalar**

- `apps/server/src/settings/system.ts`: (B-P11-1) PUT `/admin/settings/mysql`'de kayıtlı şifre varken host/port/kullanıcı değişip `password` gelmezse 400 `fields.password` dönüyor; kayıtlı şifre yeni hedefe taşınmıyor. Şifre artık hedefe bağlı AAD ile saklanıyor (`openMysqlSecret`). Çözülemeyen şifre "kayıtlı şifre yok" sayılıyor: GET `hasPassword:false`, test `secret_unreadable` dönüyor ve probe çağrılmıyor. Alarm logu `system_secret_unreadable` olarak düşülüyor, değer yazılmıyor. (B-P11-4) `testMysql` iki kova alıyor (`MysqlTestLimits { perUser, global }`). Başarısızlıkta `latencyMs: null` dönüyor ve audit `newValue`'ya süre yazılmıyor.
- `apps/server/src/lib/crypto.ts`: `aadFor.mysqlSecret({host,port,user})` → `system_settings.secret_enc:mysql:<host küçük harf>:<port>:<user>`. `aadFor.systemSecret` artık yalnız `"turn"` kabul ediyor.
- `apps/server/src/settings/routes.ts`: MySQL testinde kişi başı 5/dk sınırına ek olarak global 20/dk kova (21. istek → 429 + `Retry-After`). (B-P11-6) PUT `/settings/consent-text` için tenant başına 10/saat sınırı (`CONSENT_SAVE_PER_HOUR`; 11. istek → 429). Sayaca yalnız doğrulamayı geçen PUT'lar giriyor; `changed:false` dönenler de sayılıyor.
- `apps/server/src/audit/read.ts`: (B-P11-5) `decodeCursor`, id > 9223372036854775807 ise 400 `VALIDATION fields.cursor` dönüyor (önceden Prisma'da 500 verebiliyordu).
- `packages/contracts/src/api/system-settings.ts`: `MysqlTestResponse.latencyMs: number | null`.
- `apps/server/test/helpers/secrets.ts`: (B-P11-2) `FAKE_P11_TURN_SECRET` eklendi; `settings-p11.test.ts` bunu import ediyor. `.gitleaks.toml` allowlist'i genişletilmedi.
- Testler: `test/integration/settings-p11.test.ts` (B-P11-1 iki adımlı akış, global kova, consent 10/saat, AAD hedef bağı, başarısızlıkta `latencyMs:null`), `test/integration/audit-p11.test.ts` (taşan imleç → 400), `test/unit/p11.test.ts` (BIGINT sınırı).

**Sapmalar / kararlar (gerekçeli)**

- B-P11-1: Panelde kayıtlı şifre **yokken** (secret NULL ya da env kaynağı) hedef değişen şifresiz PUT reddedilmiyor, çünkü taşınacak bir şifre yok. Kayıt şifresiz oluşuyor, test sırasında şifre isteniyor (env şifresi yalnız env hedefiyle kullanılıyor; bu kural değişmedi).
- AAD geçişi: P11 henüz prod'da ve staging'de yayınlanmadı (P10 sonrası staging kaydında `system_settings.mysql` satırı yok), dolayısıyla eski biçimle şifrelenmiş kayıt beklenmiyor. Olursa da fail-closed davranıyor: kayıt "kayıtlı şifre yok" sayılıyor ve alarm logu düşülüyor. Şifre panelden yeniden girilince düzeliyor.
- **B-P11-4 bilinçli risk kabulü (port tarama / parola deneme oracle'ı):** MySQL testi bilerek host kısıtı olmadan çalışıyor, çünkü hedef DB iç ağda ya da compose servis adında olabilir (mimari-api: "host kısıtı yok"). Bu yüzden `connect / timeout / auth / database` sınıfları sunucunun eriştiği ağda port durumu ve MySQL varlığı hakkında sinyal veriyor. Riski sınırlayan önlemler şunlar: uç yalnız SUPER_ADMIN'e açık (P10 sonrası 2FA zorunlu), sınır 5/dk/kullanıcı ve global 20/dk (en çok ~1200 deneme/saat, tüm Super Admin'ler toplamı), her deneme audit'e yazılıyor (`settings.mysql.test`, hedef + sınıf), başarısızlıkta süre dönmüyor (zamanlama sinyali yok), ham hata yalnız logda. Kalan risk: ele geçirilmiş bir Super Admin hesabıyla yavaş iç ağ taraması yapılabilir. Bu risk kabul edildi. `rs_mysql_test_failed_total` alarm metriği "Sonra" (devops) olarak kaldı.
- B-P11-6: Sınır kullanıcı başına değil **tenant başına** uygulanıyor. Amaç kalıcı tablo büyümesini sınırlamak; sürümler tenant'a ait olduğu için kova da tenant'ta. Bellek içi sayaç kullanılıyor (tek instance, ADR-0005), yeniden başlatmada sıfırlanıyor.

**Eklenen bağımlılık:** yok. **Yeni env değişkeni:** yok.

**frontend-dev için sözleşme değişiklikleri**

- `POST /admin/settings/mysql/test` → başarısızlıkta `latencyMs: null` dönüyor. `mysql-form.tsx` zaten yalnız `r.ok && typeof r.latencyMs === "number"` olduğunda süre gösteriyor; kod değişikliği gerekmiyor. `e2e/mock-audit.mjs` başarısız yanıt mock'u eklenirse `latencyMs: null` kullanılmalı.
- `PUT /admin/settings/mysql` → kayıtlı şifre varken host/port/kullanıcı değişip şifre boşsa yeni **400 `fields.password`** dönüyor (mesaj `MYSQL_PASSWORD_REQUIRED_MESSAGE`). Form bu hatayı şifre alanının altında göstermeli; ortak alan hatası eşlemesi bunu karşılıyor olmalı.
- `GET /admin/settings/mysql` → kayıtlı şifre çözülemiyorsa `hasPassword:false` dönüyor.
- `POST /admin/settings/mysql/test` → global sınır nedeniyle 429 başka Super Admin'lerin denemelerinden de gelebilir (aynı `Retry-After`).
- `PUT /settings/consent-text` → tenant başına 10/saat aşılınca **429** + `Retry-After` dönüyor. Formda genel hız sınırı mesajı gösterilmeli.

**Komutlar ve son çıktı (2026-11-12, geçici `rs-mysql-p11fix1:33461`; sonra `down` ile silindi)**

- `pnpm -r run typecheck` → 3/3 Done. `pnpm -r run lint` → hata yok.
- `pnpm -r run test` → server birim **19 dosya, 324 test**; web 22 dosya, 218 test; contracts geçti.
- `apps/server` `vitest run test/integration` → **46 dosya, 445 test geçti** (yeni: B-P11-1, global kova, consent 10/saat).
- gitleaks v8.30.1 (`dir apps packages docs deploy`, `--redact`, JSON rapor yalnız dosya/satır/kural olarak okundu, değer yazdırılmadı) → exit 1, 13 eşleşme. **13'ünün tamamı `apps/web/.next/**`** içinde (git-ignored derleme çıktısı). `.next` dışında **0** eşleşme var; `settings-p11.test.ts` artık eşleşmiyor.

## P11 — Frontend (Rotalar) (frontend-dev, 2026-11-13)

AC-76, 77, 78, 124 (audit CSV düğmesi); AC-29 (aydınlatma metni düzenleme). Sözleşme: `@remote/contracts/api/{audit,system-settings}`
(web yüzü `lib/audit/contract.ts`, `lib/admin-settings/contract.ts` yalnız yeniden dışa aktarır). Tasarım skill'i
(`~/.claude/skills/ui-ux-pro-max`) okundu; proje DESIGN.md'si esas alındı. Audit/sistem ayarı için onaylı taslak yok →
mevcut panel desenleri (Oturum geçmişi, SMTP formu) birebir izlendi.

### Rotalar

| Yol                      | Auth                                                                                      | Ne yapar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/audit`                 | Oturum + `audit.view` (yoksa menüde yok, sayfada 403 durumu `audit-forbidden`)            | Salt okunur audit log. Filtreler URL'de: `from`/`to` (YYYY-MM-DD, boşsa son 30 gün, aralık ≤ 731 gün istemcide de denetlenir), `userId` (Admin: `/users`; Super Admin firma seçmemişse sayfadaki kayıtlardan), `action` (tam ad veya `grup.*`, `<optgroup>` ile `AUDIT_ACTION_GROUPS`), `result`, `tenantId` (yalnız firma seçmemiş Super Admin; `/admin/tenants`). İlk 50 kayıt SSR, "Daha fazla yükle" `nextCursor` ile ekler. ≥ lg tablo (zaman, avatar + ad, firma, işlem Türkçe etiket + ham ad, varlık, sonuç rozeti, IP, Ayrıntı), dar ekranda kart. Ayrıntı diyaloğu: tüm alanlar `<dl>`, eski/yeni değer `JSON.stringify` metni `<pre>` metin düğümünde (HTML yorumlanmaz); `mail.*`, `session.email`, `settings.*.test` kayıtlarında yalnız `reason`. Düzenle/sil yok. "CSV indir" yalnız `audit.export` |
| `/admin/settings`        | Super Admin                                                                               | `/admin/settings/mysql`'e yönlendirir (Super Admin değilse yetkisiz durumu)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/admin/settings/mysql`  | Super Admin (rol; değilse `system-forbidden`, veri istenmez)                              | MySQL host/port (3306)/veritabanı/kullanıcı/şifre. Şifre forma yazılmaz (yer tutucu "Kayıtlı — değiştirmek için yazın"), boş = korunur; farklı sunucu/kullanıcıda 400 `fields.password` şifre alanına düşer. "Bağlantıyı Test Et" formdaki değerlerle (kaydetmeden): bekleme satırı "10 saniyeye kadar", sonuç başarı/hata + ms, 429 kilit tonu. `source: env` → bilgi notu; `matchesRunning:false` → uyarı; kayıttan sonra sunucunun `message`'ı (yeniden başlatma) kalıcı uyarı. Kaydet çubuğu + ayrılma uyarısı                                                                                                                                                                                                                                                                                                 |
| `/admin/settings/turn`   | Super Admin                                                                               | TURN adres listesi (satır ekle/kaldır, ≤ 10, en az 1; satır hatası ilgili satırda), secret maskeli aynı kurallar (32–256, boşluk/`#` yok; turn:/turns: varken secret yoksa engel). Kalıcı uyarı: secret coturn static-auth-secret ile aynı olmalı. "Ortam değerlerine dön" (yalnız `source: panel`) → `alertdialog` (odak Vazgeç) → DELETE → GET ile env görünümü                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/settings/consent-text` | `settings.view` (düzenleme `settings.edit`; yoksa salt okunur); Super Admin firma seçmeli | Güncel sürüm no/tarih/hazırlayan, textarea + sayaç (kod noktası, 50–20.000; sınır dışı `danger`), "Yeni sürüm olarak kaydet" → onay ("Yeni oturumlar bu metni gösterecek; eski onaylar eski sürüme bağlı kalır") → PUT. `changed:false` → bilgi toast'ı "Metin güncel sürümle aynı"; 409 → form üstü hata (metin korunur). Sürüm geçmişi listesi (güncel rozeti, SHA-256 kısaltılmış + `title`)                                                                                                                                                                                                                                                                                                                                                                                                                    |

Menü: "Audit log" (`ScrollText`, `audit.view`), "Sistem ayarları" (`ServerCog`, yalnız Super Admin). Ayarlar alt menüsüne "Aydınlatma metni" (`FileText`); sistem ayarları sekmeleri MySQL (`Database`) / TURN (`Waypoints`).

### Değişen / eklenen dosyalar

- Yeni: `apps/web/app/(panel)/audit/{page,loading,audit-filters,audit-log}.tsx`, `app/(panel)/admin/settings/{layout,page,loading,section,system-tabs}.tsx`, `admin/settings/mysql/{page,mysql-form}.tsx`, `admin/settings/turn/{page,turn-form}.tsx`, `app/(panel)/settings/consent-text/{page,consent-form}.tsx`, `components/csv-export-button.tsx`, `components/ui/tab-nav.tsx`, `lib/audit/{contract,actions,query}.ts` (+ `audit.test.ts`), `lib/admin-settings/{contract,forms}.ts` (+ `admin-settings.test.ts`), `e2e/mock-audit.mjs`, `e2e/p11-admin.spec.ts`.
- Değişen: `side-nav.tsx` (2 öğe), `settings/settings-tabs.tsx` (TabNav'a taşındı + 4. sekme), `settings/tenant-settings-page.tsx` (genel `path` + tip parametresi), `history/export-button.tsx` (ortak `CsvExportButton` sarmalayıcısı; görünüm/testId aynı), `components/ui/{alert (info tonu), avatar (src + hata yedeği, "use client"), select-field (groups → optgroup), save-bar (saveLabel)}.tsx`, `messages/tr.json`, `e2e/mock-api.mjs` (audit modülü bağlandı), `DESIGN.md`.

### Sapmalar / notlar

- Audit işlem etiketleri web'de `lib/audit/actions.ts` (contracts sabitleri + `AUDIT_ACTION_GROUPS`); bilinmeyen ad ham gösterilir. backend-dev'e öneri: etiket sözlüğü CSV ile ortak kullanılacaksa `contracts/labels.ts`'e taşınabilir.
- Audit kullanıcı filtresi firma seçmemiş Super Admin'de `/users` çağrılamadığından (tenantScope 403) yüklenen kayıtlardan üretilir (ipucu metniyle — kısmi durum).
- `/admin/settings` kökü yönlendirme; Super Admin değilse yönlendirmeden önce layout yetkisiz durumunu çizer.
- "Ayarlar" menü öğesi hâlâ `settings.edit` ister (P8b kararı); yalnız `settings.view` olan kullanıcı aydınlatma metnine doğrudan URL ile salt okunur erişir.
- Avatar `avatarUrl` (P12'ye kadar null) varsa `<img alt="">`, yüklenemezse baş harf.

### Testler

- Vitest: 218 (yeni 2 dosya: `lib/audit/audit.test.ts` 7, `lib/admin-settings/admin-settings.test.ts` 6).
- Playwright `e2e/p11-admin.spec.ts`: 11 test (desktop + mobile; 15 koşu geçti): audit filtre/sayfalama/detay (XSS metin)/mail reason/CSV/düzenle-sil yok, yalnız-görüntüleme ve yetkisiz (menü + 403), boş/hata/daha-fazla-yükle hatası, mobil kart, Super Admin MySQL test başarı/hata/429 + şifre geri yazılmıyor + fields.password, TURN satır/secret/env'e dön, Admin'de sistem ayarları yok, Super Admin firma filtresi, aydınlatma metni yeni sürüm + salt okunur. Tam takım: 262 geçti, 0 hata.
- lint / typecheck temiz.

### Düzeltme turu 1 (frontend-dev, 2026-11-13)

Kaynak: `docs/qa-raporu.md` Düzeltilmeli 2, `docs/guvenlik-raporu.md` P11 turu B-P11-3 (arayüz) + B-P11-4 (süre).

- **QA-2:** `e2e/p11-admin.spec.ts` sonuna P8 deseninde `for (const scheme of ["light","dark"])` + `page.emulateMedia({ colorScheme })` testi eklendi. Her temada 1280 ve 390 px genişlikte `/audit`, audit ayrıntı penceresi (masaüstünde satır düğmesi, 390 px'te kart), `/settings/consent-text`, `/admin/settings/mysql` (hata sonucu Alert'i açıkken) ve `/admin/settings/turn` için axe 0 ihlal ve yatay taşma yok. Testte temanın gerçekten uygulandığı da (`color-scheme`) doğrulanıyor. Koyu temada da, iki genişlikte de **gerçek ihlal çıkmadı**; kodda bunun için değişiklik gerekmedi.
- **B-P11-3:** MySQL ekranındaki "Bağlantı testi" bölümüne kalıcı `Alert tone="warning"` (`data-testid="mysql-tls-note"`, `my.tlsNote`) eklendi: "Bağlantı testi TLS kullanmaz; şifre ağda şifrelenmeden gider. Yalnız güvenilir iç ağdaki … MySQL sunucularını test edin." Not, test sonucundan bağımsız olarak her zaman görünür.
- **B-P11-4 (arayüz):** Başarısız testte süre artık gösterilmiyor. Süre yalnız `ok:true` ve `latencyMs` sayı olduğunda çiziliyor (`mysql-test-latency`). Böylece backend alanı kaldırsa da `null` yapsa da arayüz doğru davranıyor. Mock (`e2e/mock-audit.mjs`) başarısız yanıtta `latencyMs` dönmüyor. Not: `packages/contracts/src/api/system-settings.ts` `MysqlTestResponse.latencyMs` şu an hâlâ `number` (zorunlu). Sözleşmeyi backend-dev güncelleyecek (`latencyMs?: number` veya `number | null`); web kodu iki biçimle de tip hatası vermez.
- **QA-1 kanıtı (arayüz):** MySQL e2e'sine şu adımlar eklendi: port (3306→3307) veya kullanıcı (app→app2) değişip şifre boşken PUT → 400. Hata şifre alanına düşüyor (`aria-invalid`, odak şifrede, "şifreyi girin"). Host değişikliği zaten kapsanıyordu. Mock bu kuralı host/port/kullanıcı için uyguluyor.
- Değişen dosyalar: `app/(panel)/admin/settings/mysql/mysql-form.tsx`, `messages/tr.json` (`my.tlsNote`), `e2e/mock-audit.mjs`, `e2e/p11-admin.spec.ts`.
- Sonuç: lint ve typecheck temiz; Vitest 218 geçti; Playwright tam takım 264 geçti, 0 hata (p11-admin: 13 test).

### Sayfa testi düzeltmeleri (frontend-dev, 2026-11-13)

Kaynak: `docs/test-raporu.md` ve QA önerisi.

- **[ORTA] Super Admin `/audit` 1280 px'te 45 px yatay taşma:** Firma sütunlu tablo kaba sığmıyordu. Son sütundaki "Ayrıntı" `th` öğesinin `sr-only` (absolute) metni konumlu bir ataya bağlı olmadığı için kaptan kaçıp sayfayı genişletiyordu. `audit-log.tsx` içinde şunlar değişti:
  - Tablo kabı `relative` yapıldı (`data-testid="audit-table-box"`).
  - Ayrıntı sütunu `sticky right-0` ile sağa sabitlendi; satır hover rengi `group-hover` ile korunuyor.
  - Ayrıntı düğmesi 2xl altında yalnız ikon gösteriyor; `aria-label` aynı kaldı.
  - Kullanıcı ve varlık sütunları biraz daraltıldı.
  - Firma sütunu varken (Super Admin) IP sütunu 2xl altında gizleniyor. IP ayrıntı penceresinde ve mobil kartta görünmeye devam ediyor (sapma: yer kazanmak için).

  Ölçüm: önce sayfa +45 px, kap 974 / tablo 1064. Sonra sayfa 0, kap 974 / tablo 974. İki temalı P11 testi artık Super Admin `/audit` görünümünü de tarıyor: 1280 px'te hem sayfa hem tablo kabı taşmıyor, Firma sütunu var, axe 0 ihlal. Admin görünümünde de kap taşma kontrolü eklendi.

- **[DÜŞÜK]** `app/(panel)/settings/layout.tsx` yorumu 4 sekmeye güncellendi (Aydınlatma metni dahil).
- **QA önerisi:** `e2e/p10-account.spec.ts:190`'daki toast seçicisi toast metnine göre daraltıldı (`filter({ hasText }).last()`). İki toast açıkken strict mode hatası artık oluşmuyor.
- **Aydınlatma metni PUT 429 (10/saat, B-P11-6):** `consent-form.tsx` 429'u ayrı ele alıyor. Kilit tonunda `FormError` gösteriliyor: "Saatte en çok 10 yeni sürüm kaydedilebilir. {dk} dakika sonra tekrar deneyin; yazdığınız metin korunuyor." Süre `Retry-After`'dan hesaplanıyor; başlık yoksa süresiz metin (`ct.rateLimited`, `ct.rateLimitedNoTime`). Onay penceresi kapanıyor, metin ve kaydet çubuğu korunuyor. Mock'ta gövdede `[hiz-siniri]` geçerse 429 + `Retry-After: 1500` dönüyor. Yeni e2e testi şunları doğruluyor: 429 durumunda "25 dakika sonra" mesajı ve `role=alert`, metin korunuyor, sürüm değişmiyor; ardından yeniden kayıt başarılı oluyor ve hata kalkıyor.
- Değişen dosyalar: `app/(panel)/audit/audit-log.tsx`, `app/(panel)/settings/layout.tsx`, `app/(panel)/settings/consent-text/consent-form.tsx`, `messages/tr.json`, `e2e/mock-audit.mjs`, `e2e/p11-admin.spec.ts`, `e2e/p10-account.spec.ts`.
- Sonuç: lint ve typecheck temiz; Vitest 218 geçti; Playwright tam takım 265 geçti, 0 hata.

## P12 — DevOps (devops, 2026-11-13)

- **Env `UPLOADS_DIR`:** adı backend `env.ts` ile teyit edildi (`UPLOADS_DIR`, mutlak yol, varsayılan `/data/uploads`; env.ts'e
  dokunulmadı). `.env.example` (boş, açıklamalı), compose `server` (`UPLOADS_DIR: /data/uploads`), runbook §3 + §16.
  Not (mimar): `docs/mimari.md` §8.1 tablosu hâlâ `UPLOAD_DIR` yazıyor → `UPLOADS_DIR` olarak düzeltilmeli.
- **Compose:** named volume `uploads` (`remote_uploads`) → server `/data/uploads` (rw); Caddy'ye bağlanmaz. Kök fs salt okunur kalır.
- **Dockerfile (`runtime`):** `/data/uploads` `node:node 0700` oluşturulur; Docker boş named volume'u bu sahiplikle doldurur
  (chown/init konteyneri yok). Taban imaj değişmedi: bookworm-slim (glibc 2.36) + npm `@img/sharp-linux-{x64,arm64}` →
  apt/libvips paketi gerekmez.
- **Caddy:** `/api/*` `request_body 2MB` (= 2.000.000 bayt, SI) tam 2 MiB'lık dosyayı + multipart zarfını kesiyordu. Yükleme
  uçlarına (POST `settings/logo`, `admin/settings/system-logo`, `users/<id>/avatar`) birbirini dışlayan `@upload`/`@notUpload`
  matcher'larıyla 3 MiB; diğer `/api` 2MB'ta kaldı. Host nginx `client_max_body_size 2m → 3m` (yayında vhost güncellenir, §16.1/3).
  CSP değişmedi (`img-src 'self' data: blob:`, `/api/v1/files/*` aynı köken). Log: `/api/v1/files/...` yolu yazılır, sorgu dizesi yazılmaz.
- **Lisans:** `@img/sharp-libvips-*` LGPL-3.0-or-later; `scripts/check-licenses.mjs` LGPL'i izinli sayıyor → istisna gerekmedi.
- **backend-dev'e not:** (1) Yeni yükleme ucu eklenirse (ör. Super Admin'in başka firma logosu için `/admin/tenants/:id/logo`)
  Caddyfile `@upload` + `@notUpload` + `test-caddy.sh` listesine eklenmeli, yoksa 2 MB dosya Caddy'de 413 alır.
  (2) ~~multipart geçici dosyası~~ — kapandı: backend gövdeyi bellekte okuyor (`multipart.ts` `toBuffer`, ≤ 2 MB), geçici dosya yok.
- **Düzeltme turu 1 (devops, 2026-11-13; QA-3 / B-P12-5):** runbook §16 kod gerçeğine göre düzeltildi: dosya uçları
  `/api/v1/files/logo/:tenantId/:file`, `/api/v1/files/system-logo/:file`, `/api/v1/files/avatar/:tenantId/:file`
  (`/api/v1/public/files/...` yok — compose `UPLOADS_DIR` yorumu da düzeltildi); multipart bellekte, `/tmp`'ye yazılmaz;
  yükleme ucu **3** (Caddyfile `@upload`/`@notUpload` ve `test-caddy.sh` ile tutarlı; test avatar ucunu `me` ve `<id>` ile
  iki kez dener); dosya izni **0640**, dizin 0750 (`store.ts`) — gerçek `UploadStore.save()` ile yedek/geri yükleme yeniden
  prova edildi, modlar ve SHA-256 korunuyor. Caddyfile yorumları zaten doğruydu, değişmedi.
  **mimar'a not:** `docs/mimari.md` §(güvenlik başlıkları) CORP istisnası ve `docs/mimari-api.md` tablosu hâlâ
  `/public/files/logo/*` yazıyor; gerçek yol `/files/logo/*` + `/files/system-logo/*` (mimari-api sapma notunda kayıtlı).
- **Doğrulama (yerel, 2026-11-13):**
  - Gerçek server imajı (`runtime`, backend lockfile'ıyla, arm64): `--read-only --cap-drop ALL --tmpfs /tmp` + named volume →
    sharp yüklendi (vips 8.18.7), PNG(EXIF'li) → `file-type` `image/png` → 256×256 webp, EXIF yok, volume'a yazıldı (uid 1000);
    kök fs `EROFS`; volume `node:node 700`.
  - linux/amd64 (staging mimarisi): gerçek imajın emülasyonlu derlemesi Docker Desktop'ta `pnpm fetch` adımında 133 (SIGTRAP,
    emülasyon) ile düştü; aynı taban imaj + aynı sharp 0.35.5 + pnpm 9.15.9 ile kurulan ayrı imajda amd64 duman testi GEÇTİ
    (x64, glibc 2.36, vips 8.18.7). **Staging'de ilk derlemede §16.1/0 (CPU x86-64-v2) ve §16.1/5 (`require('sharp')`) zorunlu.**
  - `deploy/test-caddy.sh` GEÇTİ (yeni "gövde sınırı" bölümü + log kontrolü), `deploy/nginx/test-nginx.sh` GEÇTİ (2 MiB geçer, 3,2 MB 413).
  - `docker compose config` volume/env'i doğru üretiyor. Lisans: gerçek `pnpm licenses list --prod` (sharp dahil) → temiz.
  - Yedek/geri yükleme provası (§16.3): tar (600, `gzip -t`) → boş volume'a geri yükleme → sahiplik `node:node`, SHA-256 listeleri aynı.
  - Geçici imaj/volume'lar silindi. Staging'e bağlanılmadı; commit yapılmadı.

## P12 — Backend (backend-dev, 2026-11-13)

AC-81..85, T16. Sözleşme `packages/contracts/src/api/branding.ts` (yeni; `exports` `./api/branding`).

### Değişen / yeni dosyalar

- contracts: `api/branding.ts` (tema şeması + `rs_theme` çerez sabitleri, yükleme sabitleri, DB CHECK ile birebir yol şemaları, URL kurucular, yanıt tipleri), `errors.ts` (+`INVALID_IMAGE` 400, +`PAYLOAD_TOO_LARGE` 413), `audit.ts` (+`BRANDING_AUDIT`), `api/auth.ts` (`AuthUser.avatarUrl`, `MeResponse.logoUrl`), `api/users.ts` (`UserListItem.avatarUrl`), `api/tenants.ts` (`TenantSettingsView.logoUrl`).
- server: `src/uploads/{image,store,multipart,urls,service,routes,files}.ts` (yeni); `app.ts` (depo + 3 eklenti, mail logo çözümleyici, açılışta `uploads_not_writable` alarmı); `env.ts` (`UPLOADS_DIR`, vars. `/data/uploads`; `.env.example` satırını devops eklemişti); `auth/{repo,session,routes}.ts` (avatar/logo yolu, `PATCH /auth/me/preferences`, `rs_theme` çerezi login + /auth/me + tema PATCH'te); `users/{repo,service}.ts` (`avatarUrl`, `manageableUser`); `tenants/{repo,service}.ts` (`logoUrl`); `audit/{repo,read}.ts` (avatar); `sessions/{repo,public}.ts`, `requests/{repo,service}.ts`, `bindings/{repo,service}.ts` (tenant logosu); `mail/{templates,service}.ts`, `auth/account.ts`, `tenants/smtp-routes.ts`, `sessions/email.ts` (e-posta logosu).
- testler: `test/unit/image-p12.test.ts` (11), `test/integration/branding-api-p12.test.ts` (14), `helpers/tenant-matrix.ts` (+10 uç, +3 çapraz tenant vakası), `helpers/app.ts` (`TEST_UPLOADS_DIR` geçici dizin); P12'nin beklenen sonucu olarak güncellenen: `auth-login` (rs_theme çerezi), `tenants-p9` (`logoUrl`), `account-p10` (e-posta logosu), `mail-*`/`security-p10` (`bodyHtml`, logo bağımlılığı), `signaling-rooms`/`sessions-history-api-p8`/`history-p8` (yeni AuthUser/AuthContext alanları).

### Uçlar (frontend-dev için sözleşme)

| Uç                                                                          | Yetki                                                                                          | Yanıt                                                    |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| POST/DELETE `/api/v1/settings/logo`                                         | `settings.edit`, tenantScope (Super Admin seçili firma)                                        | `{ logoUrl: string\|null }`                              |
| POST/DELETE `/api/v1/users/:id/avatar`                                      | `me`/kendi id serbest; başkası `users.edit` + aynı tenant (404) + canManage (403)              | `{ avatarUrl: string\|null }`                            |
| POST `/api/v1/admin/settings/system-logo`                                   | SUPER_ADMIN                                                                                    | `{ logoUrl: string }`                                    |
| GET `/api/v1/files/logo/:tenantId/:file`, `/api/v1/files/system-logo/:file` | herkese açık                                                                                   | PNG, `public, max-age=300` + ETag/304, CORP cross-origin |
| GET `/api/v1/files/avatar/:tenantId/:file`                                  | oturumlu; kendi tenant'ı değilse 404 (Super Admin hepsi); `system/` avatarı yalnız Super Admin | WEBP, `private, max-age=300`                             |
| GET `/api/v1/public/branding?tenant=<slug>`                                 | herkese açık, 60/dk/IP                                                                         | `{ name: string\|null, logoUrl: string }`                |
| PATCH `/api/v1/auth/me/preferences` `{ theme }`                             | oturum (şifre değişimi/2FA kurulumu aşamasında da)                                             | `{ theme }` + `rs_theme`                                 |

- Yükleme: `multipart/form-data`, tek alan `file`; 2 MB+ → 413 `PAYLOAD_TOO_LARGE`; tür/bozuk/piksel bombası → 400 `INVALID_IMAGE` (mesaj `INVALID_IMAGE_MESSAGE`); alan yok/yanlış → 400 `fields.file`; 20/sa/kullanıcı (üç yükleme ucu ortak kova) → 429. Gövde, hedef/yetki doğrulanmadan okunmaz.
- Logo zinciri (her yerde aynı, `uploads/urls.ts`): firma logosu → sistem logosu → `/img/logo.png`. `MeResponse.logoUrl` ve müşteri uçlarındaki `tenant.logoUrl` her zaman doludur; `TenantSettingsView.logoUrl` yalnız firmanın kendi logosu (null → "Kaldır" gizlenir).
- `rs_theme`: `light|dark|system`, HttpOnly değil, SameSite=Lax, Secure yalnız `NODE_ENV=production`, Max-Age 1 yıl, Path=/; çıkışta silinmez.

### Güvenlik (T16)

Tür yalnız içerikten (`file-type`) PNG/JPEG/WEBP; ayrıca sharp'ın algıladığı biçim aynı kümede olmalı (sharp librsvg/heif ile SVG/AVIF de açabildiği için çift kontrol). `limitInputPixels` 24 MP, `failOn: "error"`, `pages: 1`. Logo → PNG ≤512 px (fit inside, büyütülmez), avatar → WEBP 256×256 (cover, orta). `rotate()` sonrası tüm metadata atılır (EXIF/ICC/XMP — testle). Dosya adı `randomBytes(18)` base64url (24 karakter), `UPLOADS_DIR/{tenantId|system}/`; geçici dosya (`wx`, 0640) + fsync + rename; öndek/ad regex + kök altı kontrolü → traversal imkânsız. Dosya yalnız DB'de **o anda kayıtlı** yolsa sunulur (logo ucu avatarı, avatar ucu logoyu, eski dosyayı vermez). Değiştirme/kaldırmada eski dosya commit sonrası silinir; TX düşerse yeni dosya silinir. Yanıt başlıkları: Content-Type sunucudan, `nosniff`, `inline`, CSP `default-src 'none'; frame-ancestors 'none'; sandbox`. multipart ayrıştırıcısı yalnız yükleme eklentisinin bağlamında; diğer uçlar multipart'ı 400 ile reddeder (testli). İşleme tamamen bellekte (`toBuffer`, 2 MB sınırı) — server `/tmp` tmpfs'e hiçbir şey yazılmaz.

### Audit kararları

`tenant.logo_updated|logo_removed`, `user.avatar_updated|avatar_removed`, `settings.system_logo.updated` (değer `{ path }` + boyut), reddedilen yüklemeler `upload.rejected` (fail, `{ kind, reason: invalid_image|too_large }`). **Tema: `user.theme_changed` yazılır** (ortak standart 1.1 "kayıt güncelleme"); yalnız değer gerçekten değiştiğinde, aynı değer tekrarında yazım ve audit yok → gürültü sınırlı. Kaldırma idempotent: logo/avatar yoksa 200 null, audit yok.

### Tasarımdan sapmalar (gerekçeli)

1. **Yollar**: mimari-api'deki `/public/tenants/:slug/branding` → `GET /public/branding?tenant=` ve `/public/files/logo/*` → `/files/logo/*` (+ `/files/system-logo/*`); koordinatörün sözleşmesi. CORP istisnası (mimari §5.4) yeni yollara uygulandı. `mimari-api.md`'ye sapma notu yazıldı.
2. **Sistem logosu kaldırma yok** (yalnız yükle/değiştir): app'in `system_settings` DELETE yetkisi yok ve CHECK `value_json` NULL'a izin vermiyor (db-notlari P12 açık nokta 1, seçenek A). AC-82 değiştirmeyi ister; "Kaldır" → Sonra. Mevcut sistem logosu `GET /public/branding` (slug'sız) ile okunur.
3. **Teknisyen avatarı müşteriye verilmez** (`/public/sessions/resolve` `technician.avatarUrl: null`): avatar oturumlu uçtan sunulur; kimliksiz müşteriye açmak çalışan fotoğrafını herkese açık URL'ye çevirir (KVKK). AC-26/R8 "teknisyen adı/avatarı" → müşteri ekranı baş harf rozeti gösterir. Açılması istenirse oturuma bağlı kısa ömürlü imzalı URL gerekir (mimar kararı).
4. **Tema ucu** `PATCH /auth/me` yerine `PATCH /auth/me/preferences { theme }` → `{ theme }` (koordinatör sözleşmesi; `fullName` düzenlemesi bu pakette yok).
5. **E-posta**: şablonlar artık `bodyHtml` üretir; logo `MailService.sendForTenant` içinde tenant'a göre (mutlak `PUBLIC_BASE_URL` + public URL) eklenir; çözülemezse `/img/logo.png` (gönderim logoya takılmaz).
6. Audit ekranında avatar yalnız görüntüleyenin erişebildiği dosyaysa döner (başka tenant / Super Admin avatarı → null); kırık resim yerine baş harf.

### Bağımlılıklar (mimari §10.4 listesinde)

`sharp@0.35.5` (Apache-2.0; libvips `@img/sharp-libvips-*` LGPL-3.0-or-later, **ayrı paylaşımlı kütüphane olarak dinamik bağlı**, değiştirilmeden dağıtılır → LGPL koşulları karşılanır; GPL/AGPL yok; install betiği yok, ön derlenmiş ikili), `file-type@22.3.0` (MIT), `@fastify/multipart@10.1.8` (MIT). Lockfile güncellendi; kilitte `@img/sharp-linux-x64` + `@img/sharp-libvips-linux-x64` (glibc, bookworm-slim imajına uygun) var. İmaj doğrulaması devops bölümünde (`require('sharp')`, x86-64-v2).

### devops'a not

Caddy `@upload`/`@notUpload` matcher'ları uçlarla birebir (settings/logo, admin/settings/system-logo, users/:id/avatar — POST); yeni yükleme ucu eklenmedi. Uygulama Content-Length > 2 MiB + 16 KiB'ı okumadan 413'ler (Caddy 3 MiB tavanının altında). `UPLOADS_DIR` yazılamazsa açılışta `alarm: uploads_not_writable` logu.

### Test

`eval "$(TEST_DB_CONTAINER=rs-mysql-p12be TEST_DB_PORT=33361 apps/server/scripts/test-db.sh up)"` → `pnpm --filter @remote/server test` **335/335**, `test:int` **469/469** (48 dosya; P12: 14 + matris), `pnpm -r run typecheck` temiz (contracts, server, web), `pnpm -r run lint` temiz. Konteyner silindi. Commit yapılmadı, staging'e bağlanılmadı.

### Düzeltme turu 1 (backend-dev, 2026-11-13) — qa-raporu madde 1, guvenlik-raporu "P12 turu"

Yalnız atanan maddeler: QA-1, B-P12-2, B-P12-4 (kod + test), B-P12-3 (yalnız P13'e devir notu; kod değişikliği yok).

**Değişen dosyalar**

- `packages/contracts/src/api/branding.ts`: `IMAGE_MIN_EDGE_PX = 16`, `LOGO_MAX_ASPECT = 20`, `AVATAR_MAX_ASPECT = 4`, `IMAGE_DIMENSIONS_MESSAGE`, `IMAGE_BUSY_MESSAGE`.
- `apps/server/src/uploads/image.ts` (B-P12-2): `metadata()` sonrasında, kod çözmeden önce boyut/oran kontrolü yapılıyor (`dimensionsOk`); ihlal `INVALID_IMAGE` (400) döner, mesaj `IMAGE_DIMENSIONS_MESSAGE`. Kod çözme ve kodlama adımı süreç genelinde tek bir `ConcurrencyGate`'ten geçiyor (`imageGate`, mevcut `lib/gate.ts`, yeni kod yok): en çok 2 iş çalışır, en çok 4 iş bekler, bekleme sınırı 10 sn. Kuyruk dolarsa ya da süre aşılırsa 429 `RATE_LIMITED`, `Retry-After: 5`. Reddedilen dosya kapıya hiç girmez. Kapı reddi `upload.rejected` audit'i yazmaz (dosya geçersiz değil, sunucu meşgul).
- `apps/server/src/uploads/files.ts` (B-P12-4): avatar yanıtı `Cache-Control: private, no-cache` (önceden `private, max-age=300`). ETag/304 korunuyor; 304 yolu yetki denetiminden (oturum, tenant, DB'de kayıtlı yol) sonra geliyor. Logo ve sistem logosu `public, max-age=300` olarak kaldı.
- `apps/server/test/integration/branding-api-p12.test.ts`: QA-1 için 2 yeni test (aşağıda), avatar `Cache-Control` için tam eşitlik + 304/401 iddiaları. Yükleme hız sınırı testindeki 8×8 PNG, yeni alt sınır nedeniyle 16×16 yapıldı.
- `apps/server/test/unit/image-p12.test.ts`: 4 yeni test (aşağıda).

**Kararlar (B-P12-2)**

- **Alt sınır her kenar ≥ 16 px.** Daha küçük bir logo ya da avatar ekranda anlamlı görünmez. 1×N ve N×1 şerit saldırısını da kapatır.
- **Oran sınırı logoda 20:1, avatarda 4:1 (sınır dahil).** Yatay firma logoları 6–10:1 civarındadır, 20:1 bunlara pay bırakır. Avatar ortadan kare kırpılıyor (`cover`), 4:1'in ötesinde görüntünün %25'inden azı kalır, ayrıca web kare kırpıp gönderiyor. En kötü kabul edilen girdi artık 24 MP / 20:1 (~21.900×1.095); güvenlik raporundaki 1×23,9M (4,4 sn) sınıfı reddediliyor.
- **Eşzamanlılık: 2 çalışan + 4 bekleyen, 10 sn, sonra 429 (503 değil).** Bekleme, kısa süreli ani yüklerde kullanıcıya hata göstermez. Kuyruk ise belleği sınırlar: bekleyen her iş en çok 2 MB tampon tutar. 429'u seçtim çünkü web `uploadError` 429'u zaten "biraz sonra tekrar deneyin" (`br.rateLimited`) olarak gösteriyor; yeni bir istemci yolu gerekmiyor. Tek instance (ADR-0005) olduğu için süreç içi kapı yeterli.

**B-P12-3 — P13'e devir (bu turda kod değişikliği yok)**
Bugün kullanıcı ve firma için kalıcı silme yok, yalnız pasife alma var (`deletedAt` set eden bir akış yok). Pasif kullanıcının avatarı ve pasif firmanın logosu bilinçli olarak korunuyor, çünkü yeniden etkinleştirmede geri gelmeleri gerekiyor. P13 retention/silme işi aşağıdakileri yapmalı:

1. Kullanıcı kalıcı silinir ya da anonimleştirilirse (soft-delete `deletedAt` dahil): aynı TX'te `users.avatar_path = NULL` yapılır, commit sonrasında dosya `uploads/service.ts` `dropFile` kalıbıyla silinir (hata olursa `alarm: upload_cleanup` logu). Audit `user.avatar_removed` yazılır, `reason: "user_deleted"`.
2. Firma kalıcı silinirse: firmanın logosu ve `uploads/{tenantId}/` altındaki tüm avatarlar silinir. Klasör de kaldırılır (`UploadStore` içinde klasör silme yardımcısı, kök kontrolüyle). `logo_path` ve kullanıcıların `avatar_path` alanları null'lanır.
3. Pasif kayıtlar için saklama süresi tanımlanırsa (ör. pasif kullanıcının avatarı N gün sonra silinir), bu iş P13 retention job'ına eklenir, tetikleyici `deletedAt`/pasife alma zamanıdır.
4. Yedek döngüsü: `uploads` volume yedeklerinde silinen dosyalar yedek saklama süresi dolana kadar kalır. Runbook §16.5'e "silinen avatar/logo en geç yedek saklama süresi (N gün) sonunda yedeklerden de düşer" notu (devops) eklenmeli. Geri yükleme sonrasında DB'de karşılığı olmayan dosyalar için yetim dosya temizliği (DB'deki yollarla karşılaştırma) P13'te tanımlanmalı.
5. Yetim dosya taraması (DB'de yolu olmayan `uploads/**` dosyaları) P13 job'ına eklenmeli. Bu tarama TX düşüp temizlik de başarısız olduğunda kalan dosyaları da kapsar.

**frontend-dev için sözleşme notları**

- Boyut/oran ihlali de `INVALID_IMAGE` (400) döner, ama mesaj farklıdır (`IMAGE_DIMENSIONS_MESSAGE`, contracts'ta). Web `uploadError` bugün `INVALID_IMAGE` için sabit tür mesajını gösteriyor. Ayrıntılı mesaj istenirse sunucu mesajı (`e.message`) gösterilebilir; bu frontend'in kararı, sözleşme bozulmadı.
- Resim işleme kuyruğu doluysa 429 `RATE_LIMITED` + `Retry-After: 5` döner (saatlik 20 sınırından ayrı); mevcut 429 eşlemesi yeterli.
- Avatar artık her görüntülemede ETag ile yeniden doğrulanıyor (304, gövde yok). UI değişikliği gerekmiyor.

**Testler**

- int `branding-api-p12`: "AC-81: firma logosu yüklüyse resolve, talep bilgisi ve bilgisayar kaydı uçları firma logosu URL'sini döner; teknisyenin avatarı olsa da resolve'da avatarUrl null; kaldırınca (sistem logosu yok) `/img/logo.png`" ve "AC-81: firma logosu yokken üç uç sistem logosuna düşer; firma logosu yüklenince firma, kaldırılınca yine sistem logosu". Üç uç: `POST /public/sessions/resolve`, `GET /public/requests/tenant`, `POST /public/bindings/status`. Sistem logosu süreç genelinde tek bir değer olduğu için bu testler onu kendileri değiştirmiyor. "Sistem logosu yok" vakası AC-82'den önce, "sistem logosu var" vakası sonra koşuyor; boş DB ön koşulu açık mesajla doğrulanıyor.
- int avatar: `Cache-Control` tam olarak `private, no-cache`; ETag ile 304 dönüyor, oturumsuz istekte aynı ETag 401 alıyor.
- unit `image-p12`: "1×N ve N×1 PNG (logo ve avatar) kod çözülmeden INVALID_IMAGE" (1×100.000, 100.000×1, 2×50.000, 15×15). "oran sınırı logo 20:1, avatar 4:1" (sınır değerleri + gerçek işleme). "en çok 2 resim işi aynı anda" (6 iş, tepe = 2). "kuyruk doluyken geçerli resim 429; geçersiz resim yine 400; boşalınca işlenir".
- Komutlar: `pnpm -r run typecheck` temiz, `pnpm -r run lint` temiz. `pnpm --filter @remote/server test` **339/339**. `test:int` (geçici `rs-mysql-p12fix1be:33381`, sonra `down`) **471/471**, 48 dosya.
- Kararsızlık giderildi: `customers-p8c-api.test.ts` "ref ayırt edilemez" iddiası `ci.json()`/`gi.json()` eşitliğini artık `tenant.logoUrl` hariç karşılaştırıyor. Firma logosu yokken bu alan sistem logosudur ve paralel koşan `branding-api-p12` AC-82 testi iki istek arasında değiştirebiliyordu (ilk koşuda bir kez düştü). Logo zinciri `branding-api-p12` QA-1 testlerinde sınanıyor. Dosya tek başına 19/19; server typecheck/lint temiz.

## P12 — Frontend (Rotalar) (frontend-dev, 2026-11-13)

AC-81, 82, 83, 85, 87 (AC-84'ün istemci ön kontrolü). Sözleşme: `@remote/contracts/api/branding` (backend'in yazdığı gerçek tipler;
`AuthUser.avatarUrl`, `MeResponse.logoUrl`, `UserListItem.avatarUrl`, `TenantSettingsView.logoUrl`). Tasarım skill'i
`~/.claude/skills/ui-ux-pro-max/SKILL.md` mevcut; proje DESIGN.md'si esas alındı, mevcut panel desenleri (ayar sekmeleri,
`Section`, `Dialog`, `Menu`) izlendi.

### Rotalar

| Yol                                                      | Auth                                                                                             | Ne yapar                                                                                                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/account` (değişti)                                     | Oturum (herkes, kendi hesabı)                                                                    | Profil kartında profil resmi yükle (kare kırp) / değiştir / kaldır (onaylı); yeni **Görünüm** bölümü: tema Açık/Koyu/Sistem (anında, DB'ye kaydedilir)                           |
| `/settings/logo` (yeni)                                  | `settings.view` (değiştirme `settings.edit`, yoksa salt okunur uyarı); Super Admin firma seçmeli | Firma logosu: geçerli logo, dosya seç → önizleme → kaydet, değiştir, kaldır (onaylı → sistem logosu). Ayarlar alt menüsünde 5. sekme "Logo" (`Image`)                            |
| `/admin/settings/system-logo` (yeni)                     | Super Admin (layout rol denetimi)                                                                | Sistem logosu yükle/değiştir (kaldırma bu pakette yok). Sistem ayarları 3. sekme "Sistem logosu" (`Image`)                                                                       |
| `/users/[id]` (değişti)                                  | `users.view`; resim değişikliği `users.edit` + yönetilebilir + etkin hesap                       | Profil kartında aynı avatar yükleyici (`/users/:id/avatar`)                                                                                                                      |
| `/users` (değişti)                                       | `users.view`                                                                                     | Liste/kartta `avatarUrl` varsa resim, yoksa baş harf                                                                                                                             |
| `/login?tenant=<slug>` (değişti; tüm `(auth)` ekranları) | Herkes                                                                                           | Logo her zaman: slug geçerli ve firma varsa firma logosu, yoksa Super Admin'in sistem logosu, o da yoksa/API yoksa Nokta logosu (sunucuda çözülür, flaş yok)                     |
| `/session/[token]` (değişti)                             | Herkes (token)                                                                                   | Üstte resolve `tenant.logoUrl` (yoksa sistem logosu)                                                                                                                             |
| Üst menü (tüm panel)                                     | Oturum                                                                                           | Sol: firma logosu (`me.logoUrl`; varsayılan URL'de Nokta amblemi). Sağ: **hesap menüsü** (avatar) → Hesabım, Şifre değiştir, Tema, Çıkış; ayrıca tek dokunuş "Çıkış yap" düğmesi |

### Tema (AC-85) — nasıl çalışır

- `lib/theme.ts`: `resolveTheme` (oturum varsa DB, yoksa `rs_theme` çerezi, yoksa Sistem), `htmlThemeClass`, `applyThemeToDocument`.
- `app/layout.tsx` (sunucu): oturum çerezi varsa `getMe()` (istek başına önbellekli, panel layout'uyla ortak) → `<html class="light|dark" data-theme>`.
  Satır içi betik yok, CSP değişmedi. Başka cihaz (yalnız oturum çerezi) ilk HTML'de doğru sınıfı alır.
- `globals.css`: koyu token'lar `:root.dark`, `:root:not(.light):has(.theme-dark)` (konsol: Sistem → koyu, Açık seçildiyse açık),
  `@media (prefers-color-scheme: dark) :root:not(.light)`.
- `ThemeProvider` iyimser değişim + hata geri alma + toast; çerez DB'den farklıysa açılışta eşitlenir (çıkıştan sonra giriş ekranı son tercihe uyar).

### AC-87

- ESLint kuralı `apps/web/eslint-rules/design-tokens.mjs` (`remote/design-tokens`, `eslint.config.mjs`'te `error`). Tek ihlal
  düzeltildi: `agent-download.tsx` `align-[-3px]` → `align-[-0.1875em]`. İstisna gerekmedi. Kural testi `lib/design-tokens-rule.test.ts`.
- İkonlar: yeni tüm menü/sekme/bağlantı öğeleri ikonlu; e2e ana menü + ayar sekmeleri + hesap menüsündeki her öğede `svg` olduğunu doğrular.
- `prefers-reduced-motion`: mevcut global kural (yalnız `opacity` geçişi, animasyon yok) korundu, belgelendi ve e2e ile doğrulandı.

### Değişen / eklenen dosyalar

- Yeni: `lib/theme.ts`, `lib/branding/{image,constants}.ts`, `lib/branding/branding.test.ts`, `lib/design-tokens-rule.test.ts`,
  `components/branding/{theme-provider,avatar-uploader,logo-uploader}.tsx`, `app/(panel)/user-menu.tsx`,
  `app/(panel)/settings/logo/page.tsx`, `app/(panel)/admin/settings/system-logo/page.tsx`, `eslint-rules/design-tokens.{mjs,d.mts}`,
  `e2e/mock-branding.mjs`, `e2e/p12-branding.spec.ts`.
- Değişen: `app/layout.tsx`, `app/globals.css`, `proxy.ts` (`?tenant=` → `x-rs-tenant`, dışarıdan gelen başlık silinir),
  `app/(auth)/layout.tsx`, `app/(panel)/{layout,logout-button}.tsx` (`useLogout`), `account/page.tsx`, `users/[id]/user-editor.tsx`,
  `users/user-list.tsx`, `settings/settings-tabs.tsx`, `admin/settings/system-tabs.tsx`, `session/guest-ui.tsx`, `session/[token]/page.tsx`,
  `session/[token]/agent-download.tsx`, `components/brand-logo.tsx` (`LogoImage`), `components/ui/{menu,tab-nav}.tsx`, `lib/api.ts`
  (FormData gövdesi), `messages/tr.json`, `eslint.config.mjs`, `package.json` (`react-easy-crop` 6.2.5, MIT — mimari §10.4 listesinde),
  `e2e/mock-api.mjs`, `e2e/p10-account.spec.ts` (Hesabım artık avatar menüsünde).

### Sapmalar / notlar

- Hesap menüsünde "Çıkış" var; üst menüdeki tek dokunuş "Çıkış yap" düğmesi de korundu (std. §1.3 görünür çıkış, P9 375 px testi).
- Avatar istemcide 256×256 WEBP'e kırpılıp yüklenir; sunucu yine magic bytes + yeniden boyut uygular. Önizleme/kırpma kaynağı
  `data:` URL: `blob:` kullanıldığında Playwright izi kaynağı fetch ediyor ve CSP `connect-src` ihlali konsola düşüyordu.
- `react-easy-crop` kendi `<style>` etiketini enjekte etmesin diye `disableAutomaticStylesInjection`; CSS'i `globals.css`'te içe aktarılır.
  Kütüphanenin satır içi `style` değerleri istemcide CSSOM ile yazılır (SSR'da çizilmez) → CSP ihlali yok.
- "Talep sayfaları" (`/public/requests/tenant`) web uygulamasında yok (talep istemcide); web'de müşteri tarafı yalnız `/session/[token]`.
- Müşteri ekranında `technician.avatarUrl` null (backend) → baş harf rozeti; kod değişmedi.
- Sistem logosu yüklendiğinde üst menü amblemi firma logosu yoksa `me.logoUrl` (sistem logosu) olur; tam genişlik logo `mark` kutusuna `object-contain` ile sığar.
- Eski e2e mock'ları `theme`/`logoUrl`/`avatarUrl` döndürmediği için panel layout tema değerini `resolveTheme` ile savunmacı okur.

### Testler

- Vitest: 237 (yeni: `lib/branding/branding.test.ts` 9 — tema çözümleme, çerez, ön kontrol, kare kırpma, hata eşleme, multipart;
  `lib/design-tokens-rule.test.ts` 10).
- Playwright `e2e/p12-branding.spec.ts` (13 test): tema seç → anında → yenile/ilk HTML sınıfı (flaş yok) → başka cihaz aynı tema →
  profilde değiştir; kayıt hatasında geri alma; oturumsuz login çerez/sistem; avatar SVG/2 MB+/sahte uzantı reddi, kırp/kaydet
  (multipart, 256 px), üst menüde, onaylı kaldır; logo sunucu reddi (400), önizleme/kaydet/üst menü/kaldır; login firma/sistem
  logosu ve biçim dışı slug; Super Admin sistem logosu; iki temada axe + 1280/390 px taşma (hesabım + menü, logo, sistem logosu);
  ikon denetimi; reduced-motion.
- Sonuç: lint ve typecheck temiz; Vitest 237 geçti; Playwright tam takım 278 geçti, 0 hata (105 atlandı: proje bazlı desktopOnly/mobil eşlemeleri).

### Düzeltme turu 1 (frontend-dev, 2026-11-13)

Kaynak: `docs/guvenlik-raporu.md` B-P12-1 (Orta), `docs/qa-raporu.md` madde 2 (QA-2).

| Bulgu                                                                                                                        | Çözüm                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Test                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **B-P12-1** login marka çağrısı istemci IP'sini iletmiyordu (tüm ziyaretçiler web konteynerinin 60/dk kovasını paylaşıyordu) | `lib/server-api.ts`'e `publicGet<T>()` eklendi: çerez göndermez, `forwardHeaders(headers(), readEdgeSecret())` ile XFF'i **yalnız `X-Edge-Auth` doğruysa** iletir (`resolveSessionToken` ile aynı desen, S-P2-1). `app/(auth)/layout.tsx` `serverGet` yerine bunu kullanır. Server tarafı değişmedi: `trustProxy = TRUSTED_PROXY_CIDR` (web konteyneri bu aralıkta) olduğundan `req.ip` iletilen XFF olur ve `/public/branding` limiti (`ipKey(req.ip)`) ziyaretçi başına işler. | `e2e/p12-branding.spec.ts` "B-P12-1": sahte API sunucu gibi XFF başına 60/dk sayar; A IP'si 61. istekte yedek logoyu görür, B IP'si firma logosunu görmeye devam eder; `X-Edge-Auth` yok/yanlışken gelen XFF iletilmez (taklit IP sayılmaz). Eski kodla bu test kırmızı olmalı (XFF hiç gelmez → sayaç işlemez → 61. istekte de firma logosu); eski kodla ayrıca koşturulmadı. |
| **QA-2** `/session/[token]` dolu `tenant.logoUrl` senaryosu yoktu                                                            | `e2e/mock-sessions.mjs`: sabit `L` token'ı (`"L".repeat(43)`) resolve'da `tenant.logoUrl = /api/v1/files/logo/demo/public-demo-logo-0001.png` döner (dosya `mock-branding.mjs`'den sunulur).                                                                                                                                                                                                                                                                                     | `e2e/p12-branding.spec.ts` "AC-81 (QA-2)": `L` → `guest-logo` `data-logo="custom"`, resim `alt="Demo Firma logosu"`, `src` firma URL'si ve gerçekten yüklenmiş; `A` (null) → `data-logo="system"`, Nokta logosu. Masaüstü + mobil.                                                                                                                                             |

Değişen dosyalar: `apps/web/lib/server-api.ts`, `apps/web/app/(auth)/layout.tsx`, `apps/web/e2e/mock-branding.mjs` (XFF başına sayaç; XFF'siz istekler sayılmaz — aksi hâlde paralel e2e'lerin `/login` açılışları ortak kovayı doldururdu), `apps/web/e2e/mock-sessions.mjs`, `apps/web/e2e/p12-branding.spec.ts`.

Sapmalar / notlar:

- Sunucu tarafı önbellek **eklenmedi**: IP iletimiyle kova ziyaretçi başına ayrıldığından gerek kalmadı; önbellek logo değişikliğinin login'e geç yansımasına (≤ TTL) yol açardı. Saldırgan yalnız kendi IP'sinde yedek logoyu görür.
- Geliştirmede (`EDGE_PROXY_SECRET` yok, Caddy yok) XFF iletilmez → tüm istekler yine tek kova; yalnız yerel ortamı etkiler. Üretimde `readEdgeSecret()` sır yoksa açılışta hata verir.
- Backend'e iş yok.

Doğrulama: `pnpm --filter @remote/web lint` · `typecheck` · `test` (237) yeşil; `playwright test e2e/p12-branding.spec.ts e2e/guest.spec.ts e2e/auth.spec.ts` 86 geçti / 10 atlandı (masaüstü-yalnız testlerin mobil kopyaları).

### QA Tur 2 düzeltmesi — hidrasyon hazır işareti (frontend-dev, 2026-11-13)

Bulgu: `e2e/p11-admin.spec.ts` aydınlatma metni testleri textarea'yı hidrasyon bitmeden dolduruyordu; yük altında yazılan metin ile yüklü metin birleşip değer kontrolü düşüyordu (kararsız test).

- `apps/web/lib/use-hydrated.ts` (yeni, `useSyncExternalStore` — `join-form` / P12 yükleyicileriyle aynı yöntem, ortak kancaya alındı).
- `data-ready="true|false"` eklendi: `settings/consent-text/consent-form.tsx` (`consent-form`), `admin/settings/mysql/mysql-form.tsx` (`mysql-form`), `admin/settings/turn/turn-form.tsx` (`turn-form`) — aynı desen (sayfa açılır açılmaz yazma/tıklama) bu P11 formlarında da vardı. P12 yükleyicileri zaten işaretliydi.
- `e2e/p11-admin.spec.ts`: bu formlara yazmadan/tıklamadan önce `data-ready="true"` beklenir (aydınlatma 4 yer, MySQL 2, TURN 1).
- Davranış değişmedi (yalnız işaret özniteliği). Kabul: tam e2e takımı (`pnpm --filter @remote/web e2e`) art arda 3 koşu: her biri 281 geçti, 0 hata, 0 flaky (106 atlandı: proje bazlı desktopOnly/mobil). lint, typecheck, Vitest 237 yeşil.

### Sayfa testi düzeltmesi (frontend-dev, 2026-11-13)

Kaynak: `docs/test-raporu.md` (P12).

- **[ORTA] Boyut/oran reddi yanlış mesajla gösteriliyordu.** Sunucu, tür ve boyut/oran reddinin ikisinde de 400 `INVALID_IMAGE` döndürüyor; arayüz ise her durumda sabit "Yalnız PNG, JPG veya WEBP" metnini gösteriyordu.
  - `lib/branding/image.ts` `uploadError`: `INVALID_IMAGE` gelince **sunucunun mesajı** gösteriliyor; mesaj boşsa tür mesajı kullanılıyor.
  - Yeni `precheckDimensions(w, h, "logo"|"avatar")` ön kontrolü, contracts sabitlerini kullanıyor (`IMAGE_MIN_EDGE_PX` 16, `LOGO_MAX_ASPECT` 20, `AVATAR_MAX_ASPECT` 4; kural sunucudaki `hi <= lo * oran` ile aynı) ve ihlalde `IMAGE_DIMENSIONS_MESSAGE` dönüyor.
  - `logo-uploader.tsx` ön kontrolü önizlemeden önce, `avatar-uploader.tsx` kırpma diyaloğundan önce, seçilen kaynak resme uyguluyor. Sunucu, kırpılmış 256×256 avatarı her zaman kabul ettiğinden avatar kuralı istemcide kaynak resme uygulanıyor; kural ve mesaj sunucuyla aynı.
  - Testler: Vitest `branding.test.ts` (sınır değerleri: 20:1 / 4:1 tam sınır, 16 px, 0). Sahte API (`mock-branding.mjs`) PNG IHDR'den boyut/oran denetimi yapıyor; adı `srvdims` içeren dosyada sunucu reddi yolu çalışıyor. e2e `p12-branding.spec.ts` "boyut/oran reddi" testi: logo ve avatarda 3000×40 ile 8×8 (avatarda ayrıca 500×100) doğru mesajı gösteriyor, önizleme ya da kırpma diyaloğu açılmıyor; ön kontrolü geçen resmin sunucu reddinde sunucunun mesajı görünüyor.
- **[DÜŞÜK] `/account` başlığı ve breadcrumb.** `acc.title` artık "Hesabım"; sayfa başlığı (`<title>`), breadcrumb ve h1 bu anahtardan geliyor. Alt başlık profil resmi ve temayı da kapsayacak şekilde güncellendi. `p10-account.spec.ts` başlığı ve breadcrumb'ı ("Konum" navigasyonu) doğruluyor.
- Değişen dosyalar: `apps/web/lib/branding/image.ts`, `components/branding/{logo,avatar}-uploader.tsx`, `messages/tr.json`, `app/(panel)/account/page.tsx` (yorum), `lib/branding/branding.test.ts`, `e2e/{mock-branding.mjs,p12-branding.spec.ts,p10-account.spec.ts}`.
- Doğrulama: lint, typecheck temiz; Vitest 238 test geçti. Tam e2e takımında 282 test geçti, 0 hata (107 atlandı).

## P12b — Frontend: WhatsApp servisi (frontend-dev, 2026-11-13)

AC-196 (sözleşme: `docs/mimari-api.md` "Yönetim" whatsapp satırları). Yeni primitif yok; P11 MySQL/TURN deseni (`section.tsx`, `SourceBadge`, `SaveBar`, `Dialog alertdialog`, `useHydrated` → `data-ready`).

### Rotalar

| Yol                               | Auth                                                                                           | Ne yapar                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin/settings/whatsapp` (yeni) | Super Admin (layout rol denetimi + uç 403; Admin/User "yalnız Super Admin" uyarısı, sekme yok) | Sistem ayarları 4. sekme "WhatsApp servisi" (`MessageCircle`). Etkin adres, kaynak rozeti (Panel / Ortam değişkeni), son güncelleme; Servis URL'si kaydet (PUT); "Ortam değişkenine dön" (DELETE, onaylı, yalnız panel kaydı varken); `insecure` uyarısı; "Test Mesajı Gönder" (telefon numarası → POST `/test`, sonuç ekranda, 429 kilit mesajı) |

### Durumlar

- loading: `admin/settings/loading.tsx` iskeleti (ortak). error: GET hatası → `LoadError` + Tekrar dene; 403 → yetkisiz uyarısı.
- empty: `url: null` → bilgi kutusu (ne panel ne env), özet "Yapılandırılmamış", test pasif + "Önce servis adresini kaydedin".
- partial: `source: "env"` → bilgi notu (WHATSAPP_SERVICE_URL kullanılıyor), alan boş; `insecure: true` → kalıcı uyarı: ilk cümle sözleşme sabiti `WA_INSECURE_WARNING` (AC-196 metni "Güvensiz adres: canlı ortamda WhatsApp kanalı kapalı"), ikinci cümle "Kalıcı çözüm TLS veya özel ağ." (QA P12b Tur 1 Düzeltilmeli 1)
- success: panel kaydı, toast "kaydedildi"; kaydedilmemiş değişiklikte SaveBar + ayrılma uyarısı; formda kaydedilmemiş adres varken test bölümünde "test kayıtlı adresle yapılır" notu.

### Değişen / eklenen dosyalar

- Yeni: `apps/web/app/(panel)/admin/settings/whatsapp/{page.tsx,whatsapp-form.tsx}`, `apps/web/lib/admin-settings/whatsapp.ts` (+ `whatsapp.test.ts`), `apps/web/e2e/p12b-whatsapp.spec.ts`.
- Değişen: `apps/web/app/(panel)/admin/settings/system-tabs.tsx` (4. sekme), `apps/web/messages/tr.json` (`sys.tab.whatsapp`, `wa.svc.*`), `apps/web/e2e/mock-audit.mjs` (whatsapp uçları; senaryolar `ausawa0` boş, `ausains` güvensiz, `ausabrk` ilk GET 500; `ausa` env kaynaklı), `DESIGN.md` (ikonlar + bileşen satırı).

### Sapmalar / notlar

- **Sözleşme tipleri — giderildi (backend-dev entegrasyonu):** `apps/web/lib/admin-settings/whatsapp.ts` tipleri (`WhatsappSettingsView`, `WhatsappAdminTestInput/Response`), `WA_URL_MAX` ve `WA_INSECURE_WARNING`'i `@remote/contracts/api/system-settings`'ten yeniden dışa aktarır; `checkWaUrl` alan bazlı Türkçe mesajlardan sonra son kapıda `waServiceUrlSchema` kullanır. Yerel tip kalmadı. Sunucu 400 `fields.url` yine alana yazılır.
- Test numarası istemcide `normalizePhone` (contracts) ile E.164'e (`+90…`) çevrilip `{ phoneNumber }` olarak gönderilir; servise `90…` dönüşümü sunucuda (sözleşme).
- Env adresi forma yazılmaz (yanlışlıkla env değerini panel kaydına çevirmemek için); etkin adres özet `<dl>`'de görünür.
- DELETE yanıtı gövdeliyse kullanılır, değilse GET ile görünüm yenilenir (TURN deseni).
- Bileşen testi: projede Vitest yalnız `lib/**` (node ortamı); form mantığı `lib/admin-settings/whatsapp.ts`'te birim testli, bileşen davranışı e2e'de.
- Skill dosyaları okunmadı: yeni görsel dil yok, P11 deseni birebir uygulandı.

### Testler

- Vitest `lib/admin-settings/whatsapp.test.ts` (URL kuralları, kirli durum, sunucu alan hatası, telefon normalize) — 243/243 geçti.
- e2e `p12b-whatsapp.spec.ts` (desktop + mobile, 10 geçti / 6 masaüstü-yalnız atlandı): kritik akış (env → ön kontrol, PUT gitmez → sunucu 400 → kaydet Panel → test başarı/hata → onaylı ortama dön), 429 (6. deneme), güvensiz adres, boş durum, yükleme hatası + Tekrar dene, Admin yetkisiz, axe açık/koyu 1280/390 px + taşma + 44 px hedef. `p11-admin.spec.ts` regresyon yeşil.
- `pnpm --filter @remote/web lint typecheck test` temiz.

## P12b — Backend: WhatsApp servisi sistem ayarı (backend-dev, 2026-11-13)

AC-196 (+AC-152 r3). Sözleşme `docs/mimari-api.md` "Yönetim" whatsapp satırları, mimari §3.1 / §10 P12b, mimari-e9 T33, db-notlari "WhatsApp servis ayarı". Migration `20261114090000_whatsapp_service_setting` (dba) kullanıldı; şema/grant değişikliği yok. Desen: P11 TURN (upsert, DELETE = `{url:null}`, `apply*` ile çalışan sürece uygulama).

### Uçlar (`/api/v1/admin/settings/whatsapp`, yalnız SUPER_ADMIN; requireAuth + CSRF + requireSuperAdmin, `Cache-Control: no-store`)

| Uç           | Girdi                                                                              | Yanıt                                                                                                     | Hatalar                                                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET          | —                                                                                  | `WhatsappSettingsView = { url: string\|null, source: "panel"\|"env", insecure, updatedAt: string\|null }` | 401, 403                                                                                                                                           |
| PUT          | `whatsappSettingsInputSchema = { url: waServiceUrlSchema }` (sondaki `/` kırpılır) | `WhatsappSettingsView`                                                                                    | 400 `VALIDATION` `fields.url = WA_URL_MESSAGE`, 401, 403                                                                                           |
| DELETE       | —                                                                                  | **200** + `WhatsappSettingsView` (env görünümü; idempotent — panel kaydı yoksa değişiklik/audit yok)      | 401, 403                                                                                                                                           |
| POST `/test` | `whatsappAdminTestInputSchema = { phoneNumber: phoneSchema }`                      | 200 `{ ok, message }` (`WA_TEST_MESSAGES`, sabit)                                                         | 400 `fields.phoneNumber`, 429 `RATE_LIMITED` + `Retry-After` (5/dk/kullanıcı, 6. → 429; tüm Super Admin'ler 20/dk, 21. → 429 — B-P12b-5), 401, 403 |

### Davranış

- Etkin adres = panel kaydı (`system_settings.whatsapp.value_json.url` dolu) > `WHATSAPP_SERVICE_URL`. `WhatsappNotifier` artık `setUrl()` ile çalışırken değişir; `configured`/`insecure`/`usable` getter (etkin adresten). Açılışta `onReady` → `applyWhatsapp(app)` (DB okunamazsa env + `alarm: whatsapp_settings_load`). PUT/DELETE: yazım TX'i + yazılan değerin `setUrl` ile uygulanması süreç içi sıralı kuyrukta (B-P12b-2; DB yeniden okunmaz, son commit = bellek). Güvensiz adrese her geçişte `alarm: whatsapp_insecure` (adres loga yazılmaz). Notifier `app.whatsapp` olarak dekore edildi; RequestService aynı örneği kullanır → kayıttan sonraki ilk bildirim ve tenant/admin testi yeni adrese.
- Test: yapılandırılmamış / güvensiz → istek GÖNDERİLMEDEN 200 `{ok:false}` (`"Servis yapılandırılmamış."` / `"Servis güvenli yapılandırılmamış."`); aksi `POST {url}/test-send {phoneNumber: "90…"}`, tek deneme, 8 sn (mevcut `WA_TIMEOUT_MS`), `redirect: "manual"` (3xx = başarısız). Nedenler `unconfigured|insecure|timeout|http_error|redirect|unreachable` yalnız audit/log'da; yanıtta sabit mesaj (servis gövdesi, adres, iç hata yok).
- Audit (SYSTEM_AUDIT, entity `system_settings`, entity_id `whatsapp`, tenant_id null): `settings.whatsapp.updated` old `{url, source}` → new `{url, source:"panel"}`; `settings.whatsapp.deleted` old `{url, source:"panel"}` → new `{url(env), source:"env"}`; `settings.whatsapp.test` `{recipient: maskPhone, result, reason?}` (tenant testiyle aynı anahtar; audit görünümü `OUTBOUND_KEYS` gösterir). Yazım + audit tek TX.
- Tenant `/settings/support-requests` yanıtı değişmedi (yalnız `serviceConfigured`/`insecure`, adres yok); tenant test ucu artık açıkça yalnız `{ok, message}` döndürür.

### Değişen / eklenen dosyalar

- contracts: `packages/contracts/src/api/system-settings.ts` (`waServiceUrlSchema`, `whatsappSettingsInputSchema`, `WhatsappSettingsView`, `whatsappAdminTestInputSchema`, `WhatsappAdminTestResponse`, `WA_URL_MAX`, `WA_URL_MESSAGE`, `WA_INSECURE_WARNING`, `WA_TEST_REASONS`, `WA_TEST_MESSAGES`), `packages/contracts/src/audit.ts` (`SYSTEM_AUDIT.WHATSAPP_*`).
- server: `src/notify/whatsapp.ts` (çalışan adres, `PostOutcome` sınıflandırma, `test()` → `{ok,message,reason}`), `src/settings/system.ts` (get/save/delete/test + `effectiveWhatsappUrl`), `src/settings/routes.ts` (4 uç, `applyWhatsapp`), `src/app.ts` (`app.whatsapp` dekorasyonu + açılış yüklemesi), `src/requests/panel.ts` (tenant test yanıtı yalnız `{ok,message}`).
- web (koordinatör isteği): `apps/web/lib/admin-settings/whatsapp.ts` yerel tipler contracts'tan yeniden dışa aktarım (`WhatsappServiceView = WhatsappSettingsView` vb., `WA_SERVICE_URL_MAX = WA_URL_MAX`); `checkWaUrl` alan bazlı mesajları korur, son kapı `waServiceUrlSchema.safeParse` (harf duyarlı şema, kontrol karakterleri — sunucu/DB ile birebir). `apps/web/e2e/mock-audit.mjs` whatsapp uçları contracts şemaları + `WA_TEST_MESSAGES` ile; DELETE 204 → 200 + görünüm. `apps/web/e2e/p12b-whatsapp.spec.ts` iki metin beklentisi sunucu mesajlarına çekildi.
- testler: `packages/contracts/test/whatsapp-setting-p12b.test.ts`, `apps/server/test/unit/whatsapp-runtime-p12b.test.ts`, `apps/server/test/integration/whatsapp-admin-p12b.test.ts`, `apps/server/test/helpers/tenant-matrix.ts` (4 uç "system"), `apps/web/lib/admin-settings/whatsapp.test.ts` (+2 beklenti), `apps/server/vitest.config.ts`.

### Sapmalar / notlar

- **PUT/DELETE hız sınırı yok:** mysql/turn PUT'larıyla aynı (yalnız SUPER_ADMIN + audit). Düzeltme turu 1'de koordinatör kapsamı yalnız test ucu global tavanı (B-P12b-5'in PUT/DELETE kısmı açık; mimari karar).
- **Servis yolu birleştirme:** önce `new URL("/send-message", url)` idi (adresteki yol düşüyordu); sözleşme `{url}/send-message` → artık `url` (sondaki `/` kırpılmış) + yol. Env adresi yolsuzken davranış aynı.
- **`redirect: "error"` → `"manual"`** (mimari-api test satırı); 3xx her iki uçta (gönderim/test) yine başarısız, yönlendirme izlenmez (S8b-1 testi yeşil). `FetchLike` tipi buna göre.
- **Zaman aşımı mesajı** ayrıldı (`"Servis 8 saniye içinde yanıt vermedi (zaman aşımı)."`); diğer hatalar eski genel mesaj. Tenant test ucu da aynı sabit mesajları kullanır.
- **Test altyapısı:** `system_settings.whatsapp` her uygulama örneğinin açılışta okuduğu paylaşılan satır; paralel dosyalar (ör. `requests-p8b-2` env `WHATSAPP_SERVICE_URL`'e güvenir) etkilenmesin diye `vitest.config.ts` iki projeye ayrıldı: `main` + `serial-system-settings` (`sequence.groupOrder: 1`, yalnız `whatsapp-admin-p12b.test.ts`, diğerleri bittikten sonra). Yeni bağımlılık yok.
- Audit eylem etiketleri (`apps/web/lib/audit/actions.ts`) frontend kapsamında; `settings.whatsapp.updated|deleted` etiketi yoksa audit ekranında ham ad görünür.

### Testler

- `pnpm -r run lint` ve `pnpm -r run typecheck` temiz. `pnpm -r run test`: contracts 75/75, web 243/243, server unit 343/343.
- `test:int` (geçici `rs-mysql-wabe:33371`, temiz DB, silindi): **50 dosya, 488/488**. AC-196 entegrasyon: env görünümü; PUT → panel, audit eski→yeni, gerçek talep akışında ilk bildirim + test yeni adrese, env adresine istek yok; yeni süreç açılışta panel kaydını okur, tenant yanıtında adres yok; DELETE env'e dönüş + idempotent; 400 `fields.url` (13 örnek + fazla alan); Admin/User 403, oturumsuz 401, CSRF'siz 403; test 500/307 (izlenmez)/ulaşılamaz → sabit mesaj, audit maskeli numara + neden, 400 `fields.phoneNumber`; 5/dk → 6. 429 + Retry-After, başka Super Admin etkilenmez; production'da http+genel adres kaydedilir, `insecure:true`, kanal kapalı, test istek göndermeden ok:false, tenant `insecure:true`, https'e geçince açılır.
- e2e `p12b-whatsapp.spec.ts` 10 geçti / 6 atlandı, `p8b-requests.spec.ts` yeşil (mock güncellemesi sonrası).

### Düzeltme turu 1 (backend-dev, 2026-11-13) — `docs/guvenlik-raporu.md` "P12b turu" + QA önerisi

- **B-P12b-1:** `setUrl` önce sınıflandırır (fırlatmaz), sonra atar. Ayrıştırılamayan adres (DB CHECK'ten geçen `http://a:99999` vb.) her ortamda kanal kapalı (`insecure=true`, `usable=false`), `alarm: whatsapp_invalid_url` (adres loga yazılmaz); test istek göndermez (`reason: insecure`). `isInsecureServiceUrl` ayrıştırılamayan adreste `true` (GET görünümü 500 vermez); yeni `isParsableServiceUrl`. Açılış `catch` artık yalnız DB okuma hatasında → "env kullanılıyor" logu doğru.
- **B-P12b-2:** `saveWhatsappSettings` / `deleteWhatsappSettings` yazılan etkin adresi döndürür; route `serialQueue()` içinde TX + `app.whatsapp.setUrl(yazılan)` sıralı. `applyWhatsapp` yalnız açılışta.
- **B-P12b-3:** `env.ts` `WHATSAPP_SERVICE_URL = waServiceUrlSchema.default(...)` (panel kuralı; sondaki `/` kırpılır; boş/boşluk → varsayılan). Uymazsa açılış durur; hata mesajında yalnız anahtar adı + kural (değer yok). Runbook notu devops'ta.
- **B-P12b-5:** test ucu `{perUser 5/dk, global 20/dk}` (MySQL testi kalıbı).
- **B-P12b-6:** `FetchLike` dönüşüne `body?.cancel()`; her sonuçta (2xx/3xx/4xx/5xx) gövde iptal edilir (gönderim + test), iptal hatası yutulur.
- **QA önerisi:** Super Admin test audit'i `phone` → `recipient` (tenant ucunun anahtarı korundu). `recipient` audit görünümünde (`audit/view.ts` OUTBOUND_KEYS) zaten izinli → önceki `phone` alanı ekranda düşüyordu, artık görünür (maskeli).
- **B-P12b-4** (normalize + CHECK) kapsam dışı — Sonra.
- Testler: unit `whatsapp-runtime-p12b` (+3: geçersiz adres fail-closed her ortamda/constructor, gövde iptali 200/500/307 + reddedilen cancel, audit görünümü `recipient`), `env-logger` (+1: 7 geçersiz env değeri açılışı durdurur, değer mesajda yok; kırpma; boş → varsayılan); int `whatsapp-admin-p12b` (+3: 6 PUT + DELETE eşzamanlı ×5 tur → bellek = DB = GET; DB'de ayrıştırılamayan panel adresiyle açılış kanal kapalı, GET 200 insecure, test istek yok; 5 Super Admin × 5 → 20 başarılı, 21.+ 429) ve audit anahtarı `recipient`.
- Sonuç: `pnpm -r run lint` / `typecheck` temiz; `pnpm -r run test` contracts 75, web 243, server unit 347; `test:int` (temiz DB `rs-mysql-wabe2:33372`, silindi) **50 dosya, 491/491**. Not: ilk tam koşuda `bindings-p8c` AC-192 (TURN) bir kez düştü; tek başına 2/2 ve temiz DB tam koşuda yeşil — `system_settings.turn` satırını paralel `settings-p11` değiştirdiği için mevcut bir yarış (P12b ile ilgisiz; aynı ayrı-proje kalıbı TURN için de uygulanabilir).

## P13a — Frontend (frontend-dev, 2026-11-14)

Görevler F1–F4 (`docs/mimari-p13.md` §3, §6; AC-197, AC-199; sonra-açık T-P12b, P12b sayfa testi, S-P5-T2-1). `packages/contracts` ve
`apps/server`'a dokunulmadı (backend paralel): sözleşme alanları web'de yerel/opsiyonel tiplerle karşılandı.

### Rotalar (yeni rota yok; değişen ekranlar)

| Yol                                             | Auth                                                      | P13a değişikliği                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/history`                                      | `session_history.view`                                    | Anonim oturumda müşteri hücresinde "Anonimleştirildi" rozeti (`Eraser`) — tablo ve kart                                                                                                                                                                                                                                                                                                                                                                      |
| `/history/[id]`                                 | `session_history.view` (düzenleme `session_history.edit`) | Anonimse: başlık yanında rozet, `Alert info` (silinen/korunan veriler), not/ticket formu yerine salt okunur görünüm ("Anonimleştirilmiş oturum düzenlenemez."), müşteri adı/e-posta "Anonimleştirildi", dosya boş durumu "saklama süresi dolduğu için silindi". Sayfa açıkken anonimleşirse PATCH 409 `SESSION_ANONYMIZED` → form kilitlenir, kaydet gizlenir, hata + toast, `router.refresh()` ile salt okunur görünüme geçer (ayrılma uyarısı tetiklenmez) |
| `/audit`                                        | `audit.view`                                              | `retention.run` → "Saklama süresi işi", grup "Veri saklama" (filtre `retention.*`); dış gönderim/test ayrıntısında `reason` Türkçe etiket + altında mono ham kod                                                                                                                                                                                                                                                                                             |
| `/admin/settings/whatsapp`                      | Super Admin                                               | Kaynak `default` → "Varsayılan" rozeti + bilgi notu; büyük harfli şema/host istemcide reddedilmez, WHATWG kanonik biçime çevrilip gönderilir                                                                                                                                                                                                                                                                                                                 |
| Konsol / müşteri sayfası dosya teklifi diyaloğu | oturum                                                    | 256 MB üstü + diske akış destekli tarayıcıda, kabul (= kayıt penceresi) ÖNCESİ uyarı: "Var olan bir dosyanın üzerine yazmayın; aktarım bozulursa dosya boş kalabilir." (S-P5-T2-1)                                                                                                                                                                                                                                                                           |

### Durumlar

- Geçmiş detayı: loading/error/404/403 değişmedi; partial = anonim (bilgi notu + salt okunur); success = normal form. Liste boş/hata durumları değişmedi.
- Audit: bilinmeyen reason kodu ham gösterilir (`labelOf`); reason yoksa "—" metni (mevcut).
- WhatsApp: empty (`url: null`), partial (`env` / `default` / `insecure`), success (panel) — `default` için ayrı bilgi notu ve alan ipucu.

### Değişen / eklenen dosyalar

- Yeni: `apps/web/lib/history/anonymized.ts` (`isAnonymized`, `isAnonymizedError`), `apps/web/e2e/p13a.spec.ts`.
- Değişen: `apps/web/components/ui/badge.tsx` (`AnonymizedBadge`), `apps/web/app/(panel)/history/{history-list.tsx,[id]/page.tsx,[id]/sections.tsx,[id]/note-form.tsx}`,
  `apps/web/lib/audit/actions.ts` (`retention.run`, `EXTRA_GROUP_LABELS`, `OUTBOUND_REASON_LABELS`, `reasonLabel`), `apps/web/app/(panel)/audit/audit-log.tsx`
  (reason etiketi; reason satırı `<dl>` içine alındı — önceden `dt/dd` `dl` dışındaydı, axe `dlitem` ihlali), `apps/web/lib/admin-settings/whatsapp.ts`
  (`WhatsappSource`, `normalizeWaView`, `canonicalWaUrl`, görünmez karakter ön kontrolü, kanonik `waDirty`), `apps/web/app/(panel)/admin/settings/{section.tsx,whatsapp/whatsapp-form.tsx}`,
  `apps/web/components/collab/files-panel.tsx`, `apps/web/messages/tr.json` (`h.anon.*`, `wa.svc.defaultBadge|defaultSource|urlHintDefault`, `p5.files.bigDisk` düzeltildi + `p5.files.bigDiskWarn`),
  testler `lib/{audit/audit,admin-settings/whatsapp,history/history}.test.ts`, mock'lar `e2e/mock-history.mjs` (`anonymized` alanı, `ANON_ID`, ticket `ANON-409` → 409), `e2e/mock-audit.mjs`
  (`retention.run` + `settings.whatsapp.test{reason:unreachable}` kayıtları — toplam 60 korunarak; `ausadef` senaryosu; PUT kanonikleştirme), `DESIGN.md` (rozet, ikon, kaynak hapı).

### Sapmalar / backend-dev'e notlar

- **`source` harf biçimi:** mimari-p13 §3 `"PANEL" | "ENV" | "DEFAULT"` yazıyor, contracts `"panel" | "env"` (küçük). Contracts'a uyuldu: `"default"`. `normalizeWaView` yanıtı küçük harfe indirir, büyük harfli gelse de çalışır. Contracts'a `source: "panel" | "env" | "default"` eklenince `WhatsappServiceView` yerel genişletmesi kaldırılabilir.
- **`anonymized`:** `SessionListItem`/`SessionHistoryDetail`'e henüz eklenmedi; `isAnonymized(s)` alan yoksa `false` döner (kırılmaz). Contracts'a eklenince tip doğrudan kullanılabilir. `SESSION_ANONYMIZED` sabiti web'de yerel; `contracts/errors.ts`'e kod eklenince oradan alınmalı.
- **Reason etiketleri:** mimari §3 tabloyu `contracts/src/labels.ts`'e koyuyor; contracts'a dokunulmadığı için tablo `apps/web/lib/audit/actions.ts` `OUTBOUND_REASON_LABELS`'ta. Backend contracts'a eklerse web oradan yeniden dışa aktarmalı (tek kaynak). Kapsanan kodlar: SMTP `connect, auth, tls, rejected, port_not_allowed, insecure_auth, not_configured` (+ hesap akışındaki `no_smtp`), MySQL `connect, auth, database, timeout, secret_unreadable`, WhatsApp `unconfigured, insecure, timeout, http_error, redirect, unreachable` (+ mimarideki `invalid_response`), izdüşüm `other`. Aynı kod tüm kanallarda tek anlamlı.
- **`retention.*` grubu:** contracts `AUDIT_ACTION_GROUPS`'ta yok; web'de yerel "Veri saklama" başlığı (contracts'a eklenirse o önceliklidir).
- **Kanonikleştirme:** istemci `new URL().href` (+ sondaki `/` kırpma) ile sunucuyla aynı WHATWG kuralını uygular ve kanonik değeri gönderir; son kapı hâlâ contracts `waServiceUrlSchema`. `/api/` gibi kök dışı yolda sondaki `/` istemcide kırpılır (eski davranış); sunucu kökte kırpıyorsa kirli karşılaştırması iki tarafı da kanonikleştirdiği için tutarlı kalır.
- **F4 e2e:** uyarı 256 MB üstü teklifte görünür; e2e'de dosya sınırı 1 MB olduğundan otomatik test yok (metin değişikliği). Gerçek tarayıcı (Chromium `showSaveFilePicker`) doğrulaması test-operatoru'nda (sonra-açık S-P5-T2-1).
- Skill dosyaları okunmadı: yeni görsel dil yok, mevcut rozet/Alert desenleri kullanıldı.

### Testler

- Vitest: 25 dosya, 248/248 (yeni: retention etiketi/grubu, reason tablosu; büyük harfli şema/IDN/ondalık IP kanonikleştirme, görünmez karakter, `default` kaynak; `isAnonymized`/`isAnonymizedError`).
- e2e `p13a.spec.ts`: AC-197 liste rozeti + anonim detay (desktop + mobile), 409 yarışı, AC-199 audit etiketi + `retention.*` filtresi + reason etiketi (axe), WhatsApp "Varsayılan" + büyük harfli şema kanonik kayıt, axe açık/koyu 1280/390 px.
- Tam e2e (`playwright test`, tüm projeler): 299 geçti / 118 atlandı (masaüstü-yalnız / perf), 0 hata. `pnpm --filter @remote/web lint`, `typecheck` temiz.

### Güvenlik turu 1 (frontend-dev, 2026-11-14) — S-P13a-5 ipucu, müşteri IP öneki görünümü

- **S-P13a-5:** `h.n.ticketHint` → "… Kişisel veri (ad, telefon, e-posta) yazmayın; ticket no saklama süresinden sonra da korunur." (alanın `aria-describedby` ipucu). **Sonlandırma gerekçesi:** arayüzde gerekçe alanı yok — `TerminateDialog` (`/sessions`, Admin "Zorla sonlandır") gövdeyi `{}` gönderir; `reason` yalnız API ile girilebilir, bu yüzden ipucu eklenecek bir form yok. İleride alan eklenirse aynı ipucu metni kullanılmalı.
- **Audit IP öneki / boş UA:** müşteri kaynaklı kayıtlarda `ipAddress` artık `203.0.113.0/24` / `2001:db8:1234::/48`, `userAgent` null. Ayrıntı penceresinde UA satırı zaten koşullu (boşken basılmaz); öneki tam gösterir. **Düzeltme:** IPv6 öneki 1280 px'te audit tablo kabını taşırıyordu (`p11-admin` taşma testi yakaladı) → IP hücresi `max-w-32 truncate` + `title` (tam değer ayrıntıda). Mock `e2e/mock-audit.mjs`'e `guest.pending` (/24, UA null) ve `request.created` (IPv6 /48, UA null) kayıtları eklendi (toplam 60 korunarak).
- Testler: `p13a.spec.ts` +2 (IP öneki liste + ayrıntı, UA satırı yok, axe, taşma — desktop + mobile; ticket ipucu + `aria-describedby`). Tam e2e 302 geçti, 0 hata; Vitest 248/248; lint/typecheck temiz.

### Firma veri saklama süresi alanı (frontend-dev, 2026-11-14)

- **Yer:** `/settings/security` (Ayarlar › Güvenlik; auth: `settings.view` görür, `settings.edit` değiştirir — sekmenin mevcut kuralı), 2FA bölümünün altında yeni bölüm **"Veri saklama"** (`CalendarClock`). Alan etiketi **"Veri saklama süresi (gün)"**, ipucu "90–730 gün (varsayılan 365). Süresi dolan oturum, onay ve talep kayıtları her gece anonimleştirilir; audit 730 gün tutulur." Sayfa alt başlığı "… giriş güvenliği kuralları ve kişisel verilerin saklama süresi." olarak güncellendi.
- **Davranış:** PUT `/settings/tenant` `{ retentionDays }` (sözleşme `updateTenantSettingsInputSchema`, sunucu zaten destekliyor). Aralık tek kaynaktan (`TENANT_SETTINGS_LIMITS.retentionDays`); istemci boş/ondalık/harf/aralık dışını istek göndermeden alan hatasıyla reddeder ve odağı alana taşır; sunucu 400 `fields.retentionDays` alana, diğer hatalar form üstüne. Kirliyken `SaveBar` + ayrılma uyarısı; başarıda toast "Veri saklama süresi N gün olarak kaydedildi". Salt okunurda alan pasif (2FA bölümündeki "yalnız görüntüleme" uyarısı ortak).
- **Dosyalar:** yeni `apps/web/lib/account/retention.ts`, `apps/web/app/(panel)/settings/security/retention-form.tsx`; değişen `settings/security/page.tsx`, `messages/tr.json` (`ret.*`, `sec.subtitle`), `lib/account/account.test.ts`, `e2e/mock-account.mjs` (`retentionDays` uygulanır; 729 → sunucu alan hatası taklidi), `e2e/p13a.spec.ts` (+2), `DESIGN.md` (ikon).
- **Testler:** Vitest 249/249; tam e2e 305 geçti, 0 hata; lint/typecheck temiz. Kılavuz/PDF güncellenmedi (teknik-yazar: Ayarlar › Güvenlik › Veri saklama).
- **QA önerisi — düşürmede onay:** yeni değer kayıtlı değerden küçükse kayıttan önce `Dialog role=alertdialog` (odak "Vazgeç", Escape vazgeçer): "Saklama süresini N günden M güne düşürüyorsunuz. Bu gece M günden eski oturum, onay ve talep kayıtları geri alınamaz biçimde anonimleştirilir." Onay düğmesi `danger` "Süreyi düşür" (`TriangleAlert`). Artırmada onay yok. Vazgeçince istek gitmez, değer formda (kirli) kalır. e2e: onay metni + odak + axe, Vazgeç ve Escape → PUT yok, onay → PUT, artırma → diyalogsuz PUT.
- **Varsayılan 365:** contracts'ta sabit yok (`TENANT_SETTINGS_LIMITS` yalnız aralık); contracts'a dokunulmadı, `apps/web/lib/account/retention.ts` `RETENTION_DEFAULT_DAYS = 365` yerel kaldı (yalnız ipucu metninde kullanılır). Contracts'a eklenirse oradan alınmalı.

## P13a — Backend (backend-dev, 2026-11-14)

Görevler B1–B5 (`docs/mimari.md` §10.5, `docs/mimari-p13.md` §2–§3, §6; AC-197, 198, 199; sonra-açık B-P12b-4, B-P12b-5, T33, test yarışı). DB: dba migration `20261114120000_p13a_retention` (değiştirilmedi).

### Değişen / eklenen dosyalar

| Dosya                                                                                                                         | Değişiklik                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/jobs/retention.ts` (yeni)                                                                                    | `RetentionJob`: tenant döngüsü (talep → müşteri → kayıt → oturum), 1000'lik oturum partileri, global silmeler (audit 730 g, auth_sessions / password_reset_tokens +7 g, 5000'lik partiler); fail-soft (tenant hatası loglanır, sonraki tenant), üst üste binmez (`run()` eşzamanlıda `null`), idempotent; `retention.run` audit (tenant başına + `tenant_id NULL` global), metrikler. Genişleme noktası `purgeAnonymized()` yalnız yorum (K-P13-1) |
| `apps/server/src/jobs/retention-repo.ts` (yeni)                                                                               | `anonymizeSessionBatch` (tek TX: aday seçimi → `session_files` DELETE → `session_consents` ip/UA NULL → oturum PII NULL + `anonymized_at`, `anonymized_at IS NULL` koşullu), `deleteOldAudit` (`created_at < LEAST(iş saati − 730 g, UTC_TIMESTAMP − 730 g)` → tetikleyici hiçbir zaman ifadeyi geri almaz), `deleteOldAuthSessions` (expires ve revoked < kesme), `deleteOldResetTokens`                                                          |
| `apps/server/src/jobs/scheduler.ts`                                                                                           | 03:30 zamanlayıcısı `RetentionJob.run()`'ı çağırır (ikinci zamanlayıcı yok); bir sonraki tur önceki bittikten sonra kurulur                                                                                                                                                                                                                                                                                                                        |
| `apps/server/src/app.ts`                                                                                                      | `app.retention` (tek örnek; zamanlayıcı + testler)                                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/server/src/requests/jobs.ts`                                                                                            | `dailyRetention` kaldırıldı (yerine `RetentionJob`); `anonymizeRequestsOf` (tenant başına)                                                                                                                                                                                                                                                                                                                                                         |
| `apps/server/src/customers/service.ts`, `bindings/service.ts`                                                                 | `anonymizeCustomersOf`, `expireIdleBindingsOf` (tenant başına; eski global fonksiyonlar onları çağırır, davranış aynı)                                                                                                                                                                                                                                                                                                                             |
| `apps/server/src/ops/metrics.ts`                                                                                              | `rs_retention_rows_total{kind}`, `rs_retention_failures_total` (counter); `rs_retention_last_success_timestamp_seconds` (gauge, `RetentionJob` kaydeder)                                                                                                                                                                                                                                                                                           |
| `apps/server/src/audit/mask.ts`                                                                                               | `resetTokens` izinli anahtar (sayı; `token` kalıbı yüzünden `***` oluyordu)                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/server/src/sessions/history-repo.ts`, `history.ts`                                                                      | `anonymized` (liste/detay); anonimse `customerEmail`, `note`, talep PII null, `files: []`, zaman çizelgesinde `details.name` silinir ve CUSTOMER `actorName` null; PATCH → 409 `SESSION_ANONYMIZED` (`updateNotes` `anonymized_at IS NULL` koşullu, eşzamanlı anonimleştirmede de 409, DB 3819'a gitmez); CSV "Müşteri" hücresi `Anonimleştirildi`, "Not" boş                                                                                      |
| `apps/server/src/lib/errors.ts`                                                                                               | `SESSION_ANONYMIZED` mesajı (contracts)                                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/server/src/env.ts`                                                                                                      | `WHATSAPP_SERVICE_URL` artık opsiyonel; yoksa `DEFAULT_WHATSAPP_URL` + türetilmiş `WHATSAPP_URL_SOURCE: "env" \| "default"`; env adresi de kanonikleşir                                                                                                                                                                                                                                                                                            |
| `apps/server/src/settings/system.ts`, `routes.ts`                                                                             | WhatsApp `source: "panel" \| "env" \| "default"`; değişmeyen PUT (mysql: aynı hedef + db, şifre yok; turn: aynı liste, secret yok; whatsapp: aynı kanonik adres) → yazım/audit yok; PUT/DELETE mysql/turn/whatsapp kullanıcı başına toplam 10/dk (`FixedWindowCounter`, 11. → 429 + `Retry-After`; girdi doğrulamasından sonra sayılır)                                                                                                            |
| `apps/server/src/notify/whatsapp.ts`                                                                                          | K13: `169.254.0.0/16` ve `fe80::/10` özel ağ listesinden çıkarıldı (T33)                                                                                                                                                                                                                                                                                                                                                                           |
| `packages/contracts/src/api/sessions.ts`                                                                                      | `SessionListItem.anonymized`, `SESSION_ANONYMIZED_MESSAGE`, `SESSION_CSV_ANONYMIZED`                                                                                                                                                                                                                                                                                                                                                               |
| `packages/contracts/src/errors.ts`                                                                                            | `SESSION_ANONYMIZED: 409`                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `packages/contracts/src/api/system-settings.ts`                                                                               | `canonicalWaUrl()` (WHATWG kanonik, `\p{Cc}\p{Cf}\p{Zl}\p{Zp}` reddi, şema harf duyarsız girdi, kod noktasıyla ≤ 200); `waServiceUrlSchema` kanonik değer döndürür; `WhatsappSettingsView.source` += `"default"`                                                                                                                                                                                                                                   |
| `packages/contracts/src/audit.ts`                                                                                             | `RETENTION_AUDIT.RUN = "retention.run"`                                                                                                                                                                                                                                                                                                                                                                                                            |
| `packages/contracts/src/api/audit.ts`                                                                                         | `AUDIT_ACTION_GROUPS` += `retention.*` "Veri saklama"                                                                                                                                                                                                                                                                                                                                                                                              |
| `packages/contracts/src/labels.ts`                                                                                            | `OUTBOUND_REASON_LABELS` (web'den taşındı, tek kaynak)                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/web/lib/history/anonymized.ts`, `lib/audit/actions.ts`, `lib/admin-settings/whatsapp.ts`, `lib/history/history.test.ts` | Frontend'in yerel kopyaları contracts'a bağlandı (`anonymized` tipi, `SESSION_ANONYMIZED` `ErrorCode`, `OUTBOUND_REASON_LABELS`, `retention.*` grubu, `WhatsappSettingsView` doğrudan)                                                                                                                                                                                                                                                             |
| `apps/server/vitest.config.ts`                                                                                                | B4: `bindings-p8c` ayrı proje (groupOrder 2), `retention-p13a-job` ayrı proje en sonda (groupOrder 3)                                                                                                                                                                                                                                                                                                                                              |
| Testler                                                                                                                       | yeni `test/integration/retention-p13a-job.test.ts` (AC-197/198/199, 14 test); `whatsapp-admin-p12b.test.ts` += P13a describe (5 test), B-P12b-2 testi tur başına ayrı Super Admin (10/dk), "HTTP://x" artık geçerli; `test/unit/env-logger.test.ts`, `whatsapp-runtime-p12b.test.ts` (K13), `packages/contracts/test/whatsapp-setting-p12b.test.ts` (kanonik + Cf/Zl/Zp)                                                                           |

### Tasarımdan sapmalar (gerekçeli)

- **`source` harf biçimi:** mimari-p13 §3 `PANEL/ENV/DEFAULT` diyor; mevcut sözleşme ve frontend küçük harf kullanıyor → `"default"` eklendi (kırılmaz).
- **CSV:** mimari "şema değişmez; müşteri hücreleri boş" diyor, AC-197 "CSV'de Anonimleştirildi olarak görünür" diyor. Sütun kümesi değişmedi; "Müşteri" hücresine `Anonimleştirildi` yazılır, "Not" boş. İkisini birlikte karşılar.
- **Son başarı zamanı:** `rs_retention_last_success_timestamp_seconds` yalnız hatasız turda ilerler (herhangi bir tenant/global adım ya da audit yazımı hatasında ilerlemez; `failures_total` artar).
- **Hatalı tenant audit'i:** hata olan tenant için de `retention.run` yazılır (`result: "fail"`, o ana kadarki sayılar). Mimari yalnız "değişiklik olan tenant" diyor; hata görünürlüğü için eklendi (kişisel veri/hata metni yok).
- **Audit silme kesme noktası:** iş saati ile DB saatinden küçüğü (sahte saat ileride olsa da tetikleyici ifadeyi geri almaz).
- **Hız sınırı sayımı:** girdi doğrulamasından sonra (aydınlatma metni kalıbı); 400'ler kotayı tüketmez. Üç ayarın PUT/DELETE'i tek kova.
- Yeni bağımlılık yok.

### frontend-dev için sözleşme değişiklikleri

- `SessionListItem.anonymized: boolean` (detay da). Anonimse `customerName/customerEmail/note` null, `files: []`, `request.*` PII null, zaman çizelgesinde `details.name` yok ve CUSTOMER `actorName` null.
- PATCH `/sessions/:id` → 409 `SESSION_ANONYMIZED`, mesaj `SESSION_ANONYMIZED_MESSAGE`.
- `WhatsappSettingsView.source: "panel" | "env" | "default"`; PUT yanıtındaki `url` kanonik biçimdir (`HTTPS://X/` → `https://x`).
- Sistem ayarı PUT/DELETE 429 `RATE_LIMITED` + `Retry-After` dönebilir (10/dk/kullanıcı). Değişmeyen PUT 200 döner, audit yazılmaz.
- `OUTBOUND_REASON_LABELS` ve `retention.*` grubu artık contracts'ta; web yeniden dışa aktarıyor.

### Test durumu (2026-11-14)

- `pnpm -r run lint` temiz · `pnpm -r run typecheck` temiz · `pnpm -r run test` (birim): contracts 78/78, web 248/248, server 349/349.
- **Entegrasyon (`test:int`, `rs-mysql-p13b:33392`):** ilk tam koşu P13a'nın doğurduğu 5 hatayı gösterdi. Hepsi test tarafındaydı ve düzeltildi:
  - Saklama testinde sahte saatli tur giriş oturumlarını da (+7 g) sildiği için sonraki API testleri 401 aldı → her test yeni oturumla.
  - Kalite özeti fikstürü şemaya uymuyordu.
  - `requests-p8b-2` testi `169.254.1.1`'i özel varsayıyordu; T33 gereği artık özel sayılmıyor.
  - Ardından **temiz DB** (down → up) üzerinde ardışık 3 tam koşu: **525/525 ×3 yeşil** (52 dosya). İlk 3'lü denemede 2. ve 3. koşuda `branding-api-p12` düştü: P12'den kalan "boş DB ön koşulu" (önceki koşunun `system_logo` satırı). Bu bir yarış değil, testin yeniden çalıştırılabilir olmamasıydı. Dosya açılışında satır migrator ile siliniyor (`test/integration/branding-api-p12.test.ts`); ardından temiz DB + 3 ardışık koşu yeşil.
- **B4:** `bindings-p8c` ayrı projede; ardışık 3 tam koşuda yarış gözlenmedi (koordinatör kararıyla kabul 5 → 3).
- **B5 (Go, `golang:1.26.11-bookworm@sha256:dc40a13b…`):**
  - `golang.org/x/crypto` v0.59.0 ve `golang.org/x/net` v0.62.0 zaten en güncel sürüm (`go list -m -versions`); `go get @latest` + `go mod tidy` sonrası `go.mod`/`go.sum` değişmedi.
  - `gofmt -l` boş; `go vet` (linux + windows/amd64) temiz; `go mod verify` ok.
  - `go test -race -count=1 ./...` 19/19 paket ok; tüm paketlerin Windows test ikilileri derlendi.
  - `build/build.sh` iki kez (arada `go clean -cache`) → aynı SHA-256 `d8006b8f…16f9858c`.
  - govulncheck v1.7.0 linux ve windows/amd64: "No vulnerabilities found".
  - İstemci sürümü yayımlanmadı.

## P13a — DevOps (devops, 2026-11-14)

Görevler T1–T4 (mimari §10.5, mimari-p13 §4–5). Dosyalar: `deploy/backup/{backup.sh,restore.sh,lib.sh,remote-backup.service,
remote-backup.timer,remote-backup-failed.service,backup.env.example}`, `.gitignore` (`deploy/backup/backup.env`), `docs/runbook.md`
§2 (temiz kurulum kaydı), §3 (`MYSQL_BACKUP_PASSWORD`), §15.6, §18 (yedek/geri yükleme, saklama alarmları, yayın, geri alma), §19 (senaryo dizini).
Uygulama kodu değişmedi.

| Karar                                                                                                                             | Gerekçe                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`jq` host aracı** (mimari §10.4 dışında; lisans **MIT**; Ubuntu `apt-get install jq`)                                           | `manifest.json`'u güvenli üretmek ve okumak için (tablo adları, sayılar, sha256'lar). Elle `printf`/`awk` ile JSON üretmek kaçış hatasına açık. npm/Go bağımlılığı değil, yalnız yedek host'unda gerekiyor. AGPL/GPL değil. `age` (BSD-3) zaten §10.4'te                                                                                                                                                                                                                                                                                                                                                               |
| **`mysqldump --skip-extended-insert --no-autocommit --hex-blob`**                                                                 | Satır başına bir INSERT olduğundan tablo satır sayıları dökümün kendisinden kesin okunur (`lib.sh dump_row_counts`). Bunlar manifeste yazılıp `restore-verify`'da karşılaştırılır. Ayrı `COUNT(*)` sorgusu başka bir anlık görüntü olurdu ve sürekli yazılan `audit_logs` yüzünden sahte FAIL üretirdi. Bedeli: döküm büyür, yükleme satır sayısıyla doğrusal yavaşlar. `--no-autocommit` tablo başına tek COMMIT ile bunu hafifletir. RTO aylık provada ölçülür (runbook §18.4; 30 dk'yı aşarsa dba ile paralel yükleme)                                                                                              |
| **`MYSQL_BACKUP_PASSWORD`** (mimari-p13'teki `BACKUP_DB_PASSWORD` yerine)                                                         | db-notlari P13a önerisi: parola yalnız `mysql` konteynerinin env'indedir. Döküm `docker exec` ile konteyner içinden alınır (`'backup'@'localhost'`, soket). Parola `backup.env`'de, süreç argümanında veya logda bulunmaz. Server okumadığı için `env.ts`'te yoktur (proje CLAUDE.md "yeni env" kuralının gerekçeli istisnası; runbook §3 ve §18)                                                                                                                                                                                                                                                                      |
| **`BACKUP_MIN_FREE_MB`** (vars. 1024; mimari listesinde yok)                                                                      | Disk dolmadan önce açık bir hata (`FAILED adım=önkoşul`) vermek için. Yarım döküm yazıp diski tamamen doldurmak, MySQL'i de durdurur ("DB dolu" senaryosu, runbook §19.9)                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **`backup.env` `source` edilmez**                                                                                                 | Yalnız izinli anahtarlar okunur (`lib.sh load_env_file`); dosyada kod çalışmaz. Ortamdaki değer dosyadakini ezer (test ve elle çalıştırma için)                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Atomik çalıştırma dizini** (`.partial-<zaman>` → `<zaman>`), rotasyon yalnız başarıdan sonra, ad tabanlı (KEEP_DAYS gün + 1 sa) | Yarım yedek geçerli gibi görünmez. Başarısız günlerde eski yedekler silinmez. Her yedek en az 14 gün kalır (AC-91). Ölü `.partial-*` her çalıştırmanın başında, kilit alındıktan sonra yaşına bakılmadan silinir (S-P13a-3)                                                                                                                                                                                                                                                                                                                                                                                            |
| **uploads özeti arşivden hesaplanır** (canlı volume'dan değil), MySQL imajı içinde (`LC_ALL=C`, GNU araçları)                     | Yedekle doğrulama aynı içeriği karşılaştırır; arada yüklenen dosya sahte alarm üretmez. Yedeği alan Linux ile doğrulayan iş istasyonu (macOS) aynı çıktıyı verir                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **`fix_trigger_dump`** (`lib.sh`, `restore.sh` yüklemeden önce)                                                                   | Yerel provada P11 `audit_logs_no_update` gövdesinin sonda `;` ile saklandığı bulundu. Döküm düz `mysql` ile 1064 veriyordu. **dba P13a migration'ı tetikleyiciyi BEGIN…END ile yeniden kurarak düzeltti** (db-notlari P13a "Ek"). Bu yüzden P13a sonrası dökümlerde sed hiçbir şey değiştirmez. Fonksiyon yalnız **P13a öncesi** dökümleri (eski `remote-pre-*.sql.gz`) yükleyebilmek için kalır. Yalnız tetikleyici `CREATE` satırının sonundaki `; */;;` → ` */;;`; gövde anlamı aynı. `lib.sh`'teki yorum "kalıcı çözüm dba'da" diyor; bir sonraki kod dokunuşunda "P13a migration'ı düzeltti" olarak güncellenecek |
| **systemd birimleri**                                                                                                             | `Type=oneshot`, `OnFailure=remote-backup-failed.service` (journal + `BACKUP_ALERT_CMD`), timer 02:00 Europe/Istanbul `Persistent=true`. Sertleştirme: `ProtectSystem=full`, `PrivateTmp`, `NoNewPrivileges`, `UMask=0077`. `ProtectHome` konmadı (docker CLI `/root/.docker`'a yazabilir). Linux'ta `systemd-analyze verify` henüz koşulmadı → staging kurulumunda (runbook §18.2)                                                                                                                                                                                                                                     |

**Doğrulama (yerel, 2026-11-14):** shellcheck temiz, `bash -n` OK. Ayrı compose projesinde uçtan uca prova yapıldı: `backup.sh` OK; `restore.sh` scratch `restore-verify: OK` (8 sn); `--target staging` OK (kesinti 14 sn, veri ve uploads geri döndü, grants 373/373). Olumsuz testler: kurcalanmış dosya, yanlış anahtar, MySQL durdurulmuş (`FAILED` + alarm komutu) ve rotasyon. AC-88: `/ready` 28 sn; coturn `test-local.sh` 62/0. Ayrıntı runbook §2 ve §18.4. Staging kurulumu ve provası §18.7'de bekliyor.

### Güvenlik turu 1 (backend-dev, 2026-11-14) — S-P13a-1, S-P13a-5

Kaynak: `docs/guvenlik-raporu.md` "P13a turu"; karar `docs/mimari-p13.md` K-P13-3 r1 (seçenek a).

**S-P13a-1 [Orta] — müşteri audit kayıtlarında ad, tam IP ve UA yok**

- **Ad:** `guest.pending` (`public/service.ts`), `guest.admitted` ve `guest.rejected` (`signaling/admit.ts`) artık `name` yazmıyor. Talep yolunun `guest.admitted{via:"request"}` kaydı zaten ad taşımıyordu.
- **IP ve UA (merkezi kural):** kural tek noktada, `audit/service.ts` `writeAudit` içinde. `username === "customer"` olan her kayıtta:
  - `ip_address` = `netKey(ip)`: IPv4 /24, IPv6 /48; IPv4-mapped IPv6 → IPv4 /24.
  - `user_agent` = NULL.
  - Kapsadığı kayıtlar: misafir/oturum (`guest.pending`, `session.join`, `reconnect.conflict`, müşteri kontrol/monitör olayları, müşteri dosya olayları), talep formu (`request.created/cancelled/rate_limited`) ve istemci kayıt olayları (`binding.*` müşteri tarafı).
  - `session.resolve` (fail) kaydına `username: "customer"` eklendi; aktör zaman çizelgesinde yok, etkilenen ekran olmadı.
  - Çalışan (teknisyen/yönetici) kayıtları değişmedi.
- **UA kararı:** müşteri UA'sı audit'e hiç yazılmaz. Kısaltma yerine silme seçildi, çünkü kısaltılmış UA bile parmak izine katkı verir ve audit amacı (kim/ne/ne zaman) için gereksizdir. KVKK onay kanıtı için tam IP ve UA `session_consents`'te kalır ve saklama işiyle NULL'lanır (mimari-p13 §2 ile tutarlı).
- **Zaman çizelgesi:** CUSTOMER `actorName` için öncelik sırası:
  1. eski kayıtlarda `details.name`,
  2. yoksa oturum satırındaki `customer_name`; bu yalnız kabul edilen misafirin olaylarında gösterilir (`guestId` eşleşmesi; `guestId`'siz müşteri olayları kabul edilen misafirdir).
  - Reddedilen misafirin `guest.pending` satırında ad null kalır; böylece kabul edilen müşterinin adı yanlış satıra yazılmaz.
  - Anonim oturumda oturum adı zaten NULL olduğu için sonuç da null.
- `TIMELINE_DETAIL_KEYS` `name` anahtarını koruyor (P13a öncesi kayıtlar 730 gün okunabilir; tetikleyici UPDATE'e izin vermez).

**S-P13a-5 [Düşük]:** anonim oturumun zaman çizelgesinde `session.terminated` `details.reason` (serbest metin) silinir. `ticket_no` AC-197 gereği kalır. "Kişisel veri yazmayın" ipucu frontend-dev'in işi.

**Değişen dosyalar:**

- Kod: `apps/server/src/audit/service.ts` (`CUSTOMER_USERNAME`, önek/UA kuralı), `public/service.ts`, `signaling/admit.ts`, `sessions/public.ts`, `sessions/history.ts`.
- Testler: yeni `test/integration/audit-customer-p13a.test.ts` (4 test: writeAudit IPv4/IPv6/mapped/çalışan; gerçek resolve→join→admit akışı; reddedilen misafir; S-P13a-5). Güncellenen: `signaling-fix1.test.ts` (guest.pending anahtarlarında `name` yok), `security-p8b-fix1.test.ts` (request.created `ip_address` = /24 öneki, UA null).

**frontend-dev'e etkisi:**

- Audit ekranında müşteri kayıtlarının IP sütunu artık `203.0.113.0/24` biçiminde, UA boş.
- Sözleşme tipi değişmedi.

**Test:** lint ve typecheck temiz; birim testleri 78 + 248 + 349; temiz DB'de `test:int` **529/529** (53 dosya), `rs-mysql-p13b:33392`. Konteyner silindi.

### P13a — DevOps güvenlik düzeltmeleri (güvenlik raporu "P13a turu", 2026-11-14)

| Bulgu                        | Uygulanan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-P13a-2 (yedek bütünlüğü)   | Yükleme `mysql --system-command=OFF` ile yapılıyor (8.4.13 istemcisi destekliyor). **Döküm denetimi** (`lib.sh dump_client_command_count`, durum tutan awk tarayıcısı): tırnaklı veri (`'`/`"`/`` ` ``, `\` kaçışı, `''` ikilemesi, satırlar arası) atlanıyor; tırnak dışındaki her ters bölü (satır içi `SELECT 1; \! id`, `\.`, `\T` vb.) ve satır başındaki system/source/tee/pager/connect/use/edit/charset işaretleniyor; dosya sonunda kapanmamış tırnak da işaretleniyor. mysqldump tırnak dışında ters bölü üretmediği için gerçek dökümde yanlış pozitif yok. Yorum içi de taranıyor (ihtiyatlı: yorumunda ters bölü olan elle düzenlenmiş döküm işaretlenebilir; kabul edildi). BSD awk, mawk ve busybox ile aynı sonuç alındı (`\x` kaçışı yerine `-v sq="'"`). **Anlık görüntü** (scratch + canlı, öncesi/sonrası): hesap listesi, `CHECKSUM TABLE` mysql.user (plugin + authentication_string dahil, değer asla yazılmaz)/global_grants/db/tables_priv/columns_priv/procs_priv/proxies_priv/role_edges/default_roles/component, ROUTINES/EVENTS sayıları, `persisted_variables` SHA-256 özeti (ilk 16 hane). Farkta yalnız değişen öğenin adı yazılıyor (`sec_check`). **Kalan (P13b, site dışı yedekten önce zorunlu):** manifest imzası (`ssh-keygen -Y sign`/minisign), tablo içeriği için `CHECKSUM TABLE` tam karşılaştırması, yüklemenin `migrator` ile yapılması (dba). Runbook §18.4 |
| S-P13a-3 (düz veri artığı)   | `backup.sh` akış biçiminde çalışıyor: `mysqldump → dump_tee_meta (awk, akışı değiştirmeden sayım/son satır/tetikleyici adları) → gzip → tee(FIFO: sha256, boyut[, uploads özeti]) → age`. Düz döküm/arşiv diske hiç yazılmıyor; `.partial`'da yalnız sayılar ve özetler duruyor. `restore.sh` çözülmüş dosyaları `/dev/shm`'e yazıyor (manifestteki düz boyut + %10 boş alan kontrolü). `/dev/shm` yoksa (macOS) veya yer yetmiyorsa açık hata veriyor; bilinçli seçim `--work-dir` ile                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| S-P13a-4 (tetikleyici kaybı) | DB'deki tetikleyici sayısı `BACKUP_EXPECTED_TRIGGERS` (vars. 3) değilse `FAILED adım=tetikleyici` (OnFailure alarmı). Tetikleyici adları manifeste yazılıyor (`triggerNames`). `check-app-grants.sh`'teki "backup DROP TRIGGER yapabilir (kabul edilen risk)" yorumu dba'ya bırakıldı                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| S-P13a-6 (ortam doğrulaması) | `--target staging` için `--confirm <db>@<hostname -s>` (staging `remote@develop`) ve compose projesi `RESTORE_EXPECT_PROJECT` (vars. `remote`) zorunlu. `--target production` açık bir hatayla reddediliyor (P13b'de ayrı bayrak + ayrı onay)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S-P13a-7 (backup.env)        | Dosya varsa sahibi root (uid 0) ve izni tam 600/400 değilse okunmuyor: normal modda `FAILED adım=önkoşul`, `--alert` modunda `BACKUP_ALERT_CMD` **çalıştırılmıyor** (yalnız journal satırı)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

**Doğrulama (güvenlik düzeltmeleri sonrası, 2026-11-14):** shellcheck temiz, `bash -n` OK. Yerel uçtan uca prova Linux root konteynerinde (dind kullanılmadı; compose `rsp13ae2e`, sonra `down -v` ve imajlar silindi) yapıldı. AC-88 `/ready` 20 sn; yedek OK; scratch `restore-verify: OK` (7 sn); `--target staging` OK (kesinti 13 sn). Tüm olumsuz senaryolar beklendiği gibi FAIL verdi ya da durdu. Ayrıntı runbook §2 ve §18.4 prova kaydında.

### Güvenlik turu 2 (backend-dev, 2026-11-14) — S-P13a-8

Kaynak: `docs/guvenlik-raporu.md` (kod turu 2, S-P13a-8 [Orta]).

- **Sorun:** dosya aktarım audit kayıtları (`file.transfer`, `file.transfer.sender_report`, `file.meta.rejected_by_db`) dosya adı ve sha256'yı 730 gün tutuyordu. Bu iki alan `session_files`'ta da var ve saklama işiyle siliniyor; audit'te kalmaları anonimleştirmeyi boşa çıkarıyordu.
- **Düzeltme (`apps/server/src/signaling/collab.ts`):** üç kayıt da artık `{sessionId, direction, ext, sizeBytes, result}` yazıyor.
  - `ext` = `fileExtOf(temizlenmiş ad)`: son noktadan sonrası, ASCII harf/rakam, 1–10 karakter, küçük harf; adın başındaki nokta uzantı sayılmıyor; uymazsa null.
  - Ad ve sha256 artık audit'e yazılmıyor.
  - Kullanılmayan `FILE_NAME_DB_REJECTED` yer tutucusu kaldırıldı.
- **Ekranlara etkisi:**
  - Zaman çizelgesi dosya olaylarını göstermiyor (`TIMELINE_DETAIL_KEYS`'te yok).
  - Geçmiş detayındaki dosya listesi `session_files`'tan geliyor; anonim oturumda zaten boş.
  - Audit ekranı `newValue`'yu genel JSON olarak gösteriyor; sunucu `audit/view.ts` bu alanlara özel izdüşüm yapmıyor.
  - Eski kayıtlarda ad ve sha256 730 gün görünmeye devam eder (tetikleyici UPDATE'e izin vermez; P13a öncesi yalnız staging).
- **Frontend etkisi:** yok. Sözleşme tipi değişmedi. Audit detayında yeni kayıtlar `fileName`/`sha256` yerine `ext` gösterir.
- **Testler:**
  - Yeni birim testi `test/unit/file-names.test.ts` "S-P13a-8" (10 vaka).
  - `signaling-collab-p5.test.ts`: `file.transfer` ve `sender_report` audit değerleri; ad ve sha256 yok.
  - `signaling-collab-p5-dbcheck.test.ts`: `rejected_by_db` audit'inde ad ve sha256 yok, `ext` null.
- **Sonuç:** lint ve typecheck temiz; server birim testleri 350/350; temiz DB'de `test:int` **529/529** (53 dosya). `rs-mysql-p13b` silindi.

**Doğrulama (güvenlik kod turu 2, 2026-11-14):** shellcheck temiz. Olumsuz testler Linux root konteynerinde koşuldu (compose `rsp13asec`, dind yok; sonra `down -v`, imajlar silindi). Meşru ters bölülü veride sonuç OK. Satır içi `\!`/`\.`/`pager`, `CREATE USER`, db yetkisi, dinamik yetki, `ALTER USER`, `SET PERSIST`, `INSTALL COMPONENT` ve `CREATE PROCEDURE` içeren sahte yedeklerin hepsi FAIL verdi; değişen öğe adıyla gösterildi (runbook §18.4 prova kaydı).

## P13b — backend (backend-dev, 2026-11-14)

Kaynak: `docs/mimari-p13.md` §7.5, §7.7, §7.11, §7.16 (B1–B3). `docs/guvenlik-raporu.md`'de bu iş bitirilirken "P13b tasarım turu" bölümü yoktu; uygulanacak güvenlik maddesi olmadı.

**B1 — `reset-superadmin` CLI (§7.7)**

- `apps/server/src/cli/reset-superadmin.ts` (127 satır): `parseArgs` (strict, konumsal argüman yok, `--email` tam bir kez, '@' zorunlu), TTY kontrolü, çıkış kodları 0/2/3/4/5. Sıra: önce argüman (2), sonra TTY (4), en son env ve DB. Bu yüzden TTY yokken DB'ye hiç bağlanılmaz. Env `loadEnv()` ile okunur, DB kullanıcısı `app`'tir. Log JSON olarak stderr'e yazılır; logda parola yok, yalnız `userId`, `mfaReset`, `revokedSessions`, `runId` var. DB hatasında ekrana `ref <ULID>` yazılır, ayrıntı logdadır.
- `apps/server/src/auth/superadmin-reset.ts` (74 satır): argon2 hash'i TX dışında alınır. Tek TX içinde şunlar yapılır:
  - koşullu `users` UPDATE (`role=SUPER_ADMIN`, `status=ACTIVE`, `deleted_at IS NULL`; arada durum değişirse `not_found`);
  - oturumlar `revoked_at`, açık sıfırlama bağlantıları `used_at`;
  - `--reset-mfa` verilmişse TOTP alanları NULL yapılır ve `recovery_codes` silinir;
  - audit yazılır.
    Bulunamazsa `result=fail`, `{reason:"not_found"}` yazılır (dry-run'da audit yok). Geçici parola mevcut `newTemporaryPassword(20)` ile üretilir (karışmayan 56 sembol).
- `packages/contracts/src/audit.ts`: `AUTH_AUDIT.SUPERADMIN_RESET = "auth.superadmin_reset"`.
- DB yetkisi: mevcut `grants.sql` yeterli (users UPDATE, auth_sessions UPDATE, `password_reset_tokens.used_at` ve `recovery_codes` DELETE). Yeni grant gerekmedi; dba D2 doğrulaması ayrıca yapılıyor.

**B2 — HSTS (§7.5):** `apps/server/src/app.ts` helmet `includeSubDomains: true, preload: false`. Başlık artık `max-age=31536000; includeSubDomains`. Test `ops-headers.test.ts` AC-126'da güncellendi. Caddyfile devops'un işi (T3).

**B3 — S-P13a-8:** P13a güvenlik turu 2'de zaten uygulanmış ve commit'li (`collab.ts` `fileExtOf`; bkz. yukarıdaki "Güvenlik turu 2" bölümü). Bu turda kod değişikliği yok. Yeniden doğrulandı: `signaling-collab-p5*.test.ts` ve `file-names.test.ts` yeşil.

**Tasarımdan sapmalar (gerekçeli)**

1. Audit etiketi `contracts/src/labels.ts` yerine `apps/web/lib/audit/actions.ts`'e eklendi ("Super Admin şifresi sunucudan sıfırlandı"). Gerekçe: audit işlem etiketlerinin tek kaynağı bu dosya; `labels.ts`'te audit işlem haritası yok. Sabit adı contracts'tan geliyor.
2. `audit/mask.ts` izinli listesine `mustChangePassword` eklendi. Gerekçe: §7.7'deki `newValue.mustChangePassword` alanı `pass` kalıbı yüzünden `***` olarak yazılıyordu. Değer boolean bir bayrak; parola ya da hash hiçbir yerde audit'e girmiyor.
3. `ip_address`: proje kalıbına uyuldu. Diğer sistem aktörlerinde olduğu gibi (scheduler, retention, notify) boş dize yazılıyor; okuma katmanı (`audit/read.ts`) bunu `null` olarak gösteriyor. `writeAudit` değiştirilmedi.
4. `--dry-run` da TTY ister: §7.7'deki "TTY zorunlu" kuralı her mod için uygulandı.

**Bağımlılık:** yeni yok (`node:util parseArgs`, mevcut pino/zod).

**frontend-dev:** sözleşme değişikliği yok. Audit ekranında yeni işlem adı `auth.superadmin_reset` görünür (`auth.*` grubunda, etiketi eklendi).

**Runbook / devops notu:** komut `docker compose exec server node src/cli/reset-superadmin.ts --email <e-posta> [--reset-mfa] [--dry-run]` (`-T` verilmez). Açık WebSocket bir sonraki yeniden doğrulamada kapanır.

**Test:** `test/integration/superadmin-reset-p13b.test.ts`, 7 test:

- hash, `must_change`, kilit/sayaç, oturum ve sıfırlama bağlantısı iptali; eski çerez 401; geçici parola ile giriş; parola çıktıda tam bir kez, audit ve logda yok (AC-90);
- `--reset-mfa`;
- ADMIN, PASSIVE, silinmiş ve olmayan hesap → 3, değişiklik yok;
- dry-run → 0/3, değişiklik ve audit yok;
- TTY yok → 4 (süreç içi ve gerçek süreç, pipe); kullanım hataları → 2;
- DB erişilemez → 5 + ref, SQL sızmıyor.

**Sonuç:**

- `pnpm -r run lint` ve `pnpm -r run typecheck` temiz.
- Birim testleri: contracts 78/78, web 249/249, server 350/350.
- Temiz DB'de `test:int` **536/536** (54 dosya). Geçici konteyner `rs-p13b-be-cfbd44` silindi.

### P13b — backend, güvenlik tasarım turu düzeltmeleri (2026-11-14)

Kaynak: `docs/guvenlik-raporu.md` "P13b tasarım turu".

- **G-P13b-1 (Yüksek, backend payı) — KAPANDI (backend):**
  - Sorun: her `hello` / yeniden bağlanma yeni bir TURN username'i (`<bitiş>:<sessionId>`) üretiyordu; bu da her seferinde yeni bir coturn `user-quota` demekti.
  - Düzeltme: `apps/server/src/signaling/active.ts` `grant()` artık oda başına önbellek kullanıyor (`Room.iceGrant`, `types.ts`). Credential, yenileme eşiğine (`iceRefreshBeforeMs`, 5 dk) kadar aynı username ile yeniden veriliyor. Yeni credential yalnız yenileme zamanlayıcısında üretiliyor (`fresh=true`).
  - Sonuç: oturum başına aynı anda en çok 2 geçerli credential var (yeni olan ve süresi dolmak üzere olan).
  - TURN ayarı panelden değişirse (`rooms.turn` yeni nesne olur) önbellek kullanılmıyor.
  - Test: `signaling-lifecycle.test.ts`, "G-P13b-1/AC-22". 5 yeniden bağlanmada username değişmiyor; 55. dakikada yenisi geliyor; geçerli username sayısı ≤ 2.
  - Kapasite hesabı, `bps-capacity` ve `remote-watch` alarmı devops'ta (T2/T4).
- **G-P13b-2 (Yüksek, backend payı) — KAPANDI (kod/test/.env.example):**
  - `apps/server/src/env.ts`'te `DEFAULT_WHATSAPP_URL` ve `WHATSAPP_URL_SOURCE` kaldırıldı. Env verilmezse ya da boşsa `WHATSAPP_SERVICE_URL = ""`.
  - Boş adreste mevcut "yapılandırılmamış" yolu çalışıyor (K13 "kanal kapalı" ile aynı): gönderim yok, Super Admin testi `{ok:false, "Servis yapılandırılmamış."}` döner, tenant testi 502 `UPSTREAM` döner.
  - Adres artık yalnız env'den ya da panel kaydından geliyor. `settings/system.ts` ve `settings/routes.ts`'ten `whatsappEnvSource` çıkarıldı; kaynak artık `panel` | `env`.
  - Testlerde gerçek adres yerine belge aralığı `203.0.113.10` kullanılıyor: `requests-p8b-2`, `whatsapp-setting`, contracts `whatsapp-setting-p12b`.
  - `env-logger` ve `whatsapp-admin-p12b` testleri yeni davranışı doğruluyor: url null, kaynak `env`, test isteği servise gitmiyor.
  - `.env.example` yorumu yer tutucuya çevrildi.
  - **Kalan yerler (gerçek servis IP'si için `git grep`; bana ait değil):**
    - teknik-yazar: `README.md:672`;
    - devops: `deploy/backup/backup.env.example:20`, `deploy/docker-compose.yml:112` (yorum);
    - dba: `deploy/mysql/check-app-grants.sh:408` (test verisi);
    - mimar / teknik-yazar: `docs/` altındaki eski karar ve rapor metinleri (`mimari.md:352`, `mimari-e9.md:18,262`, `gereksinimler-kabul-kriterleri-e9.md` AC-152, `runbook.md:81,727,1305`, `guvenlik-raporu.md`).
  - **Operasyon etkisi (devops):** staging bugün varsayılana güveniyordu. Bu değişiklikten sonra WhatsApp kanalı, `WHATSAPP_SERVICE_URL` (env) ya da panel kaydı girilene kadar kapalı kalır.
  - **frontend-dev:** sözleşme değişmedi (`source` tipinde `"default"` duruyor). Ancak sunucu artık `"default"` göndermiyor; `whatsapp-form.tsx`'teki "Varsayılan" rozeti ve ipucu dalı ölü kod oldu ve temizlenebilir.
  - Servise kimlik doğrulama eklemek ve repo taraması kullanıcı/devops işi (U1, G-P13b-11).
- **G-P13b-3 (Orta) — backend'de değişiklik yok, gerekçe:**
  - Server zaten raporun önerdiği daraltılmış durumda. `trustProxy = TRUSTED_PROXY_CIDR = 172.30.0.2/31`, yani yalnız caddy (.2) ve web (.3). Compose'da `server` servisinin `ports` tanımı yok; host'a hiç yayınlanmıyor.
  - Açık, Caddy'nin 4451 dinleyicisinde. Burada `trusted_proxies static 172.30.0.128/32`: host'tan gelen her yerel bağlantı userland-proxy üzerinden aynı adresten geliyor. Bu yüzden ne Caddy ne server, nginx ile başka bir yerel süreci ayırt edemiyor. Server'da yapılacak bir daraltma bu sınırı değiştirmez.
  - **devops'a not:** raporun tercih ettiği yol uygulanmalı: nftables OUTPUT kuralı, `oif lo tcp dport {4450,4451} meta skuid != {www-data, root} reject`, ve olumsuz testi. Alternatif: nginx'in eklediği sabit sır başlığı + Caddy'de 403. Compose'a dokunmadım.
- **G-P13b-10 (Düşük) — KAPANDI (süre), bildirim Sonra:**
  - **Süre:** CLI ile verilen geçici parola 24 saat geçerli (`SUPERADMIN_TEMP_TTL_MS`).
    - Kontrol `auth/service.ts` login'inde, parola doğrulandıktan sonra: `must_change_password` açık bir SUPER_ADMIN'in son başarılı `auth.superadmin_reset` audit kaydı 24 saatten eskiyse 401 dönüyor. Mesaj: "Geçici şifrenin süresi doldu…". Audit: `auth.login` fail `{reason:"temp_password_expired"}`.
    - Yanlış parolada genel mesaj değişmedi; süre bilgisi parolayı bilmeyene sızmıyor.
    - CLI çıktısı süreyi yazıyor.
    - **Sapma:** yeni sütun (`password_changed_at`) yerine append-only audit kaydı kullanıldı (migration ve grant gerekmedi). Bu güvenli, çünkü parolayı değiştiren diğer bütün yollar (değiştirme, e-posta ile sıfırlama) `must_change_password`'ü kapatıyor; bayrak açıksa son parola CLI'nin verdiğidir. Audit `(tenant_id, entity, entity_id, created_at)` indeksiyle okunuyor.
  - **`--reset-mfa`:** sonraki ilk girişte 2FA kurulumunun zorunlu olduğu (P10, `mfaSetupRequired: true`) testle doğrulandı.
  - **Bant dışı bildirim — Sonra:** CLI `docker compose exec` içinde çalışıyor; host'taki `WATCH_ALERT_CMD` / `BACKUP_ALERT_CMD`'ye erişimi yok ve stderr logu docker logs / journal'a değil, operatörün terminaline düşüyor. Ayrıca Super Admin'in tenant'ı olmadığı için tenant SMTP'si ile e-posta da gönderilemiyor.
    - Öneri (devops T5): runbook'ta CLI'yi saran bir host betiği, rc=0 olunca alarm komutunu "Super Admin parolası CLI ile sıfırlandı" metniyle çağırır (parola yok).
    - Ya da `remote-watch`, son çalıştırmadan bu yana `auth.superadmin_reset` audit sayısını izler.
- **Test:**
  - `superadmin-reset-p13b.test.ts` +1: "G-P13b-10". `--reset-mfa` → `mfaSetupRequired`; 25 saatlik kayıt → 401 + audit; 23 saatlik kayıt ve CLI ile verilmemiş parola → 200; CLI yeniden çalışınca yeni parola geçerli.
  - `signaling-lifecycle` +1.
  - `env-logger` ve `whatsapp-admin-p12b` güncellendi.
- **Sonuç:**
  - `pnpm -r run lint` ve `pnpm -r run typecheck` temiz.
  - Birim testleri: contracts 78/78, web 249/249, server 350/350.
  - Temiz DB'de `test:int` **538/538** (54 dosya).
  - Geçici konteyner `rs-p13b-be-4cd57d` silindi.

## P13b — dba (dba, 2026-11-14)

Ayrıntı ve test kayıtları: `docs/db-notlari.md` "P13b". Şema, migration, seed ve `grants.sql` değişmedi; yeni bağımlılık yok.

- **Yeni SQL arayüzü (`deploy/mysql/`, devops T1 `restore.sh`/`backup.sh`'den çağırır; kullanım komutları her dosyanın başlığında):**
  - `restore-sec-snapshot.sql` (root, salt okuma): P13a `sec_snapshot` heredoc'unun yerine geçer. Ek öğeler: `plugins`, `views`, `anon`, `migratorExtra`. Yüklemeden önce mutlak koşul: `anon=0` ve `migratorExtra=0`.
  - `restore-reset-db.sql` (migrator): canlıda `DROP` + `CREATE DATABASE`. Guard ister: `@rs_confirm_db`, migrator hesabı ve DB adı.
  - Döküm yükleme migrator ile yapılır: `--protocol=socket --system-command=OFF --local-infile=0`. Scratch'e `01-users.sh` bağlanır ve rastgele app/migrator parolaları verilir.
  - `checksum-tables.sql` (migrator): bütün BASE TABLE'ların CHECKSUM'u. scratch ve canlı çıktısı birebir aynı olmalı; fark varsa yalnız tablo adı yazılır.
  - `audit-continuity.sql` (backup): manifest `audit` JSON'u (`format: 2`). İçerik: tetikleyici özeti + `ok`, günlük `{n, h}` (SHA-256 zinciri), `tail`/`prevTail`, `baseline`, `instanceId`. Karşılaştırma kuralı dosya başlığında.
  - `audit-baseline-reset.sql` (migrator): elle, gerekçeyle ve audit'li taban çizgisi sıfırlama. `restore.sh` canlı yüklemeden sonra da çağırır.
- **`check-app-grants.sh`: 373 → 384 kontrol.** Eklenenler:
  - anonim hesap = 0;
  - `migratorExtra = 0`;
  - migrator için 7 DENIED denemesi;
  - tetikleyici özeti `ok`;
  - `reset-superadmin` CLI ifadeleri (app ile; yeni grant gerekmedi).
  - Yeni isteğe bağlı değişken `MIGRATOR_PW`; `.github/workflows/ci.yml`'deki ilgili adıma eklendi.
- **Sapmalar (gerekçeli):**
  - (1) Manifest `audit.days` değerleri sayı yerine `{n, h}` oldu; ek alanlar geldi (G-P13b-5).
  - (2) Tam süreklilik sorgusu 2 M satırda 4,6 sn sürüyor; < 2 sn ölçütünü yalnız histogram (0,44 sn) karşılıyor. Ek süre içerik özetinin bedeli.
  - (3) G-P13b-5'in önerdiği `BIT_XOR(CRC32)` yerine sıralı SHA-256 kullanıldı; XOR özeti sil+ekle ile eşlenebilir.
  - (4) "Son 48 saat" için `prevMaxIdCount` yerine zamana bağlı `tail`/`prevTail` kullanıldı. AUTO_INCREMENT ile commit sırası arasındaki yarış yanlış FAIL üretmesin diye 5 dk pay bırakıldı.
  - Kalan kör aralık (≤ 24 sa + 5 dk) belgelendi.
- **Diğer ajanlara:**
  - **devops (T1):**
    - Scratch'e `-v mysql/init:/docker-entrypoint-initdb.d:ro` ve `MYSQL_APP_PASSWORD`/`MYSQL_MIGRATOR_PASSWORD` (rastgele) eklenecek.
    - Canlıdaki root `DROP/CREATE` printf'i kalkacak; yerine `restore-reset-db.sql` gelecek.
    - CHECKSUM `up -d`'den önce alınacak.
    - Başarılı canlı yüklemeden sonra `audit-baseline-reset.sql` çalıştırılacak.
    - `backup.sh`'de: `triggers.ok=false` → `FAILED adım=tetikleyici`; `baseline.id` değişimi → uyarı + alarm; karşılaştırma yalnız aynı `instanceId`/env/host/database ile yapılacak.
    - Runbook §18/§19 bu adımlarla güncellenecek. Elle sıfırlama komutu dosya başlığında.
  - **backend-dev:** audit etiketi `backup.audit_baseline_reset` = "Yedek audit taban çizgisi sıfırlandı" (contracts `labels.ts`).
  - **Tetikleyici değiştiren her migration:** `audit-continuity.sql`'deki beklenen özet sabiti ve `BACKUP_EXPECTED_TRIGGERS` güncellenecek; `check-app-grants` bunu zorlar.

## P13b — devops T2–T4 (devops, 2026-11-14)

Kapsam: mimari-p13 §7.4 (T2), §7.5 (T3), §7.8 (T4) ve güvenlik raporu "P13b tasarım turu"nda devops'a atanan G-P13b-1, 4, 7, 12, 13.
T1 (yedek) ve T5 (runbook) bu turda yok; `deploy/backup/*` ve `docs/runbook.md` değişmedi. Sunucuya bağlanılmadı.

### Değişen / eklenen dosyalar

- `deploy/turn/turnserver.base.conf`: `max-port=49479` (320 port), `total-quota=300`.
- `deploy/turn/entrypoint.sh`, `deploy/turn/docker-compose.yml`: `TURN_MAX_BPS` varsayılanı 8000000 → **1000000**. `TURN_BPS_CAPACITY`
  varsayılanı 0 ve yorumu "0 bırakın". Sertifika bağlaması `${TURN_CERT_DIR:-./certs}`. Başlık yorumu ADR-0018'e göre güncellendi.
- `deploy/turn/host-firewall.sh`:
  - Aralık değişiminde önceki reserved ports kaydını geri alır (`reserved.range`; eski kurulumda `/etc/default/remote-turn-fw`).
  - `preflight`: `ss -Hlunp` ile aralıkta coturn dışı UDP dinleyici varsa `apply` ve `install` yazmadan çıkar.
  - `TURN_FW_RELAY_MAX_BPS`: hashlimit ile toplam relay tavanı (G-P13b-1 a yolu).
- `deploy/turn/cert-deploy-hook.sh` (yeni), `deploy/turn/test-cert-hook.sh` (yeni).
- `deploy/turn/test-denied.sh`: "0) aralık/kapasite" bölümü eklendi (49160-49479, 320 port, son port 49479, `total-quota` 300 ≤ 320, `user-quota` 8).
- `deploy/turn/test-local.sh`: prod bps değerleri, hashlimit, aralık değişimi, preflight, AC-21 ölçümü, G-P13b-1 kapasite testi.
- `deploy/Caddyfile`: `?Strict-Transport-Security "max-age=31536000; includeSubDomains"`. `deploy/test-caddy.sh` başlık bölümü
  (HSTS değeri, preload yok, Server yok, nosniff).
- `deploy/docker-compose.yml`: yalnız caddy `CADDY_BIND` yorumu (prod 127.0.0.1; kontrolün UFW değil bu değer olduğu, G-P13b-9 notu).
- `deploy/ops/{remote-watch.sh,remote-watch.service,remote-watch.timer,watch.env.example,test-watch.sh}` (yeni). `.gitignore` += `deploy/ops/watch.env`.
- `.env.example`:
  - TURN yorumları güncellendi (birim bayt/sn, allocation başına).
  - Yeni anahtarlar (değer boş): `TURN_FW_RELAY_MAX_BPS`, `TURN_CERT_DIR`. İkisi de yalnız `deploy/turn/.env` / host betiği içindir;
    server okumaz, `env.ts` değişmedi.
  - `CADDY_BIND` yorumu.
  - `DEPLOY_ENV` T1'e bırakıldı.

### AC-21 ölçümü (G-P13b-12) — `TURN_MAX_BPS` birimi

Ortam: yerel coturn 4.18.0 (sabit imaj), bridge ağı, `turnutils_uclient` → relay → `turnutils_peer` echo. Mesajlar 1200 B, 1 ms
aralıklı (teklif ≈ 1,2 MB/s). Her saniyede gönderilen ve alınan bayt farkı ölçüldü:

| `max-bps`      | Teklif (B/s) | Teslim (B/s, kararlı saniyeler) | Kayıp |
| -------------- | ------------ | ------------------------------- | ----- |
| 1000000        | ~1 204 800   | **~1 000 800** (≈ 8,0 Mbit/s)   | %14   |
| 8000000 (eski) | ~1 201 200   | ~1 201 200                      | %0    |

- Sonuç: birim **bayt/sn**. Bit/sn olsaydı tavan ~125 KB/s olurdu. AC-21'deki 8 Mbit/s'nin karşılığı `TURN_MAX_BPS=1000000`'dir.
  `test-local.sh` bunu her koşuda doğrular: teklif > 1,1 MB/s, teslim 0,9–1,1 MB/s.
- G-P13b-12: Aynı credential ile 2 allocation açılınca toplam teslim ~1 987 200 B/s oldu. Tavan oturum ya da kullanıcı başına değil,
  **allocation başına** uygulanıyor. Bir oturum en çok 6 allocation açar; yön başına teorik üst sınır 48 Mbit/s'tir.
  AC-21 kanıtı "allocation başına 8 Mbit/s" olarak kaydedilmeli (proje-yoneticisi AC metni).
- Yön: ölçülen tavan istemci→peer yönündedir (echo dönüşü tavanın altında kalır). coturn belgesine göre giriş ve çıkış ayrı sayılır.
  Peer→istemci yönünü bağımsız ölçmek için peer'dan relay'e akış üreten bir araç gerekir; bu bir **Sonra** maddesidir.
- Not: > ~1500 B'lik (parçalanan) UDP mesajlar yerel bridge ağında max-bps değerinden bağımsız olarak %100 kayboldu. Bu, test
  ortamına özgüdür. WebRTC paketleri ≤ 1200 B'dir.

### G-P13b-1 kapasite ölçümü ve karar

| `bps-capacity` / `max-bps`   | Açık allocation                             | Sonraki deneme                                          |
| ---------------------------- | ------------------------------------------- | ------------------------------------------------------- |
| 62500000 / 1000000 (tasarım) | 62 (Prometheus `turn_total_allocations` 63) | **63. allocation `error 486`** (rezervasyon doğrulandı) |
| 0 / 1000000                  | 62                                          | 63. allocation açıldı (kayıp 0)                         |
| 0 / 1000000                  | 300                                         | 301. allocation `486` (`total-quota=300`, beklenen)     |

- **Karar (rapordaki a yolu):** `TURN_BPS_CAPACITY=0` ve `TURN_MAX_BPS=1000000`. Paylaşımlı sunucunun toplam koruması host'tadır:
  `host-firewall.sh` `TURN_FW_RELAY_MAX_BPS=62500000` (500 Mbit/s) değeriyle `REMOTE-TURN-OUT` zincirine 3 `hashlimit` kuralı ekler:
  relay→peer (UDP, kaynak port relay aralığı), relay→istemci UDP 3478, relay→istemci TCP 3478/5349. Her kural ayrı tavandır.
  Birim kb = 1024 B; değer yukarı yuvarlanır.
- mimar ADR-0018 m.2 ve mimari-p13 §7.4/§7.9 tablosundaki `TURN_BPS_CAPACITY=62500000` değerini 0 olarak ve "host tavanı"
  notuyla güncellemelidir. Prod `deploy/turn/.env`: `TURN_BPS_CAPACITY=0`, `TURN_MAX_BPS=1000000`, `TURN_FW_RELAY_MAX_BPS=62500000`.
- Kalan (backend-dev, raporun 3. maddesi): oturum başına credential sınırı ve `turn_allocations > 2×active+10` alarmı. `remote-watch`'a
  bu alarm eklenmedi; backend metriği netleşince eklenir (**Sonra**).

### TURN sertifika hook'u (§7.4 m.2–4, G-P13b-4)

- **Hedef:** `/etc/remote/turn-certs` (git dışı, root:65533 0750). Compose bunu `TURN_CERT_DIR` ile bağlar. `turn.crt` 0:0 0444,
  `turn.key` 65534:65533 0400.
- **Lineage:** `RENEWED_LINEAGE` = `/etc/letsencrypt/live/remote-turn` tam yol eşitliği aranır; `eski-remote-turn` atlanır.
- **Yol denetimi:** dizin ve bütün üstleri bağlantı olmamalı, sahibi root olmalı, g/o yazamamalı. Hedef dosya bağlantı ya da dizinse
  ret. Bu koşullardan biri tutmazsa hiçbir şey yazılmaz ve rc=1 döner.
- **Yazma sırası:** `mktemp` → `chown -h`/`chmod` içerikten önce → `mv -fT` (GNU).
- **Kurulum:** `install` kalıbı `host-firewall.sh` ile aynıdır: `/usr/local/sbin/remote-turn-cert-deploy` ve `/etc/default/remote-turn-cert`
  (`TURN_CERT_DIR`, `TURN_CERT_LINEAGE`, `TURN_CONTAINER`, `TURN_TLS_NAME`, `TURN_TLS_CONNECT`). Kurulu kopya yalnız bu dosyayı okur.
- **Doğrulama sırası:** sertifika, ad (SAN) ve anahtar eşleşmesi doğrulanır → kopyalanır → SIGUSR2 gönderilir → parmak izi en çok
  10 sn beklenir → gerekirse `restart` (30 sn) → yine olmazsa err + rc 1.
- **SIGUSR2 doğrulandı (coturn 4.18.0):** `docker kill -s USR2` sonrası 5349'dan yeni sertifika sunuldu ve konteyner yeniden
  başlamadı (`StartedAt` aynı). Hook önce SIGUSR2'yi dener, restart yalnız yedek yoldur.
- `test-cert-hook.sh` A (gerçek coturn) + B (Linux root, taslak docker): **14 + 25 PASS, 0 FAIL**. Olumsuz testler:
  - benzer adlı lineage;
  - anahtar uyuşmazlığı;
  - SAN'da ad yok;
  - ulaşılamayan 5349 → restart + rc 1;
  - SIGUSR2 etkisiz → restart;
  - restart etkisiz → rc 1;
  - `certs` symlink → hedefe yazılmadı;
  - `turn.key` symlink → hedef chown'lanmadı;
  - üst dizin g+w;
  - sahibi root olmayan dizin;
  - çok satırlı/boş `RENEWED_LINEAGE`;
  - kurulu kopyada env yok sayılır ve `TEST_NONROOT` reddedilir;
  - `/etc/default` 0666 → çalışmaz.

### Diğer test sonuçları (yerel; benzersiz adlı konteynerler, hepsi silindi, dind yok)

- `deploy/turn/test-local.sh`: test-denied **65 PASS / 0 FAIL**, bunun üzerine ek bölümler PASS:
  - aralık değişimi: `1000-1001,49160-49199` → `1000-1001,49160-49479`, `remove` sonrası `1000-1001`;
  - preflight 49300 dinleyicisi → rc 1;
  - 5 kural (3 hashlimit) idempotent; `check` OK;
  - AC-21 ve G-P13b-12 ölçümleri;
  - 64. allocation açıldı.
- `deploy/test-caddy.sh`: GEÇTİ (HSTS = `max-age=31536000; includeSubDomains`, preload yok).
- `deploy/ops/test-watch.sh`: **48 PASS / 0 FAIL**.
- shellcheck (`koalaman/shellcheck:stable`): yeni ve değişen betiklerde uyarı yok, yalnız bilgi notları var (bilinçli alt kabuk,
  `A && B || C` test kalıbı). Önceden kalan uyarılar dokunulmadan duruyor: `entrypoint.sh:40` SC2154, `test-local.sh:12` SC2155,
  `test-denied.sh` SC2164/SC2034. `sh -n` ve `bash -n` bütün betiklerde temiz.

### remote-watch (§7.8, G-P13b-7, G-P13b-13)

- **Kurulum:** `sudo deploy/ops/remote-watch.sh install` şunları yapar:
  - kurulu kopya `/usr/local/lib/remote/remote-watch.sh` (root 0755) — systemd birimi git ağacından çalışmaz;
  - `/etc/remote-watch/` (0700) ve `watch.env` (örnekten, 600);
  - `remote-watch.service` (`ExecStart` kurulu kopya, `StateDirectory`) + `.timer` (10 dk).

  `uninstall` kopyayı ve birimleri siler; watch.env ve durum dosyaları kalır.

- **Sapma:** tasarım `deploy/ops/watch.env` diyor; yapılandırma git dışına, `/etc/remote-watch/watch.env`'e taşındı (G-P13b-13 ile
  aynı gerekçe). `.gitignore`'a yine de eklendi.
- **Ek anahtarlar** (isteğe bağlı, varsayılan prod): `WATCH_PROJECT`, `WATCH_SERVICES`, `WATCH_TURN_CONTAINER`, `WATCH_TURN_TLS`,
  `WATCH_TURN_CERT_FILE`, `WATCH_LE_DIR`, `WATCH_BACKUP_STATUS`, `WATCH_BACKUP_DIR`, `WATCH_DISK_PATHS`, `WATCH_OFFSITE_REMIND_DAYS`,
  `WATCH_TREE_DIR`, `WATCH_TIMERS`.
- **Kontroller ve kullanılan veri:**
  - compose servisleri: Docker etiketleri kullanılır, compose/.env çözülmez;
  - `/ready`;
  - nginx `/login` (`--resolve`);
  - coturn health + STUN;
  - 2 timer;
  - `status.prom` yaşı, audit sürekliliği, site dışı (26 sa; yapılandırılmamışsa 7 günde bir HATIRLATMA, durum OK kalır);
  - saklama işi: metrik + süreç yaşı; hata sayacı artışı 24 sa alarmda kalır;
  - sertifikalar: LE web, LE remote-turn, 5349'dan sunulan sertifikanın süresi ve dosyayla eşitliği;
  - disk;
  - `systemctl --failed remote-*`;
  - `tree-perms`: `/opt/remote`'ta root dışı sahip ya da o+w dosya (G-P13b-13'ün izleme yarısı).
- **G-P13b-7:** Alarm mesajı `$REMOTE_WATCH_MSG` ile ve **stdin**'den verilir. Komut metninde Telegram token'ı, `x-api-key:`,
  `Authorization:` ya da `AGE-SECRET-KEY` varsa komut çalıştırılmaz ve `ALERT check=alert-cmd-unsafe` yazılır. Önerilen kullanım
  `curl -K /etc/remote-watch/telegram.curl --data-urlencode text@-` (root 600 dosya); örneği `watch.env.example`'da.
- **Test (48 PASS):**
  - her kontrol için olumsuz test: servis durdurma, unhealthy, eksik konteyner, eski/eksik `status.prom`, audit 0, site dışı eski,
    saklama metriği yok/eski/artış, 5 günlük sertifika, eksik LE dosyası, farklı sertifika sunma, 5349 kapalı, disk eşiği %1,
    failed birim, o+w ve uid 1000 dosya;
  - tekrar bastırma; 360 dk dolunca yeniden alarm; DUZELDI bir kez; alarm komutu başarısızsa sonraki koşuda yeniden deneme;
  - watch.env 644, uid 1000 ve symlink → rc 1 ve alarm komutu çalışmaz;
  - sır içeren komut çalışmaz ve token loga düşmez;
  - install/uninstall izinleri.

### Sonra / açık

- **G-P13b-3 (not):** backend `trustProxy`'yi daraltıyor. 127.0.0.1:4451'e yerel süreçlerin sahte XFF göndermesi için nftables
  `skuid` kuralı ya da nginx sır başlığı, T1/T5 turunda koordinatörle birlikte ele alınacak. Compose'da server portu host'a yayımlanmıyor
  (yalnız caddy 4450/4451).
- **G-P13b-13'ün yedek tarafı** (`backup.sh`/`restore.sh` kurulu kopya) ve `BACKUP_ALERT_CMD` sır deseni reddi (G-P13b-7) T1'de yapılacak.
  `remote-watch` `status.prom`'u okuyor ama dosyayı T1 üretecek. T1 bitene kadar staging'de `backup-age` ALERT'i beklenir.
- Peer→istemci yönünün bağımsız bant ölçümü (yukarıda).
- `turn_allocations` alarmı (G-P13b-1 backend kısmı).

### T5 için runbook notları (§9, §20)

1. **Relay aralığı (ağ yöneticisinden önce):**
   - pfSense NAT 49160–49479/udp (1:1);
   - UFW: `ufw delete allow 49160:49199/udp` → `ufw allow 49160:49479/udp`;
   - `sudo deploy/turn/host-firewall.sh preflight` → `preflight OK`;
   - `sudo deploy/turn/host-firewall.sh install`. Beklenen: `önceki relay aralığı 49160-49199 reserved ports'tan geri alındı`.
     `cat /proc/sys/net/ipv4/ip_local_reserved_ports` aralığı 49160-49479'u kapsamalı.
2. **`deploy/turn/.env` (prod):** `TURN_REALM=remote.noktabilisim.net`, `TURN_MAX_BPS=1000000`, `TURN_BPS_CAPACITY=0`,
   `TURN_FW_RELAY_MAX_BPS=62500000`, `TURN_CERT_DIR=/etc/remote/turn-certs`, yeni `TURN_SECRET`. Doğrulama:
   `iptables -S REMOTE-TURN-OUT | grep -c hashlimit` → 3.
3. **Sertifika:**
   - `sudo deploy/turn/cert-deploy-hook.sh install` (dizini oluşturur);
   - `certbot certonly --webroot -w /var/www/remote-acme -d remote.noktabilisim.net --cert-name remote-turn --non-interactive --deploy-hook /usr/local/sbin/remote-turn-cert-deploy`;
   - ilk alımda hook çalışır; elle çalıştırma: `RENEWED_LINEAGE=/etc/letsencrypt/live/remote-turn /usr/local/sbin/remote-turn-cert-deploy`
     → `OK: coturn SIGUSR2 ile yeni sertifikayı sunuyor`;
   - `docker compose -p remote-turn up -d --force-recreate` (yeni bağlama);
   - `/usr/local/sbin/remote-turn-cert-deploy check` → `check OK`;
   - `certbot renew --dry-run --cert-name remote-turn`;
   - eski `deploy/turn/certs/` (CA dahil) `shred -u`.
4. **`test-denied.sh`:** 0 FAIL; "0)" bölümü 49160-49479 / 300 gösterir. ~60 allocation açar (600 sn yaşar); yoğun saatte
   çalıştırılmaz.
5. **remote-watch kurulumu:**
   - `sudo deploy/ops/remote-watch.sh install`;
   - `/etc/remote-watch/telegram.curl` (600) ve `WATCH_ALERT_CMD` (watch.env.example);
   - `systemctl start remote-watch.service; journalctl -u remote-watch -n 20` → `remote-watch: OK` (ya da yalnız
     `offsite-unconfigured` uyarısı);
   - §7.13/10 alarm testi: `docker compose stop web` → ≤ 10 dk'da ALERT → `start` → DUZELDI.
   - Alarm kanalı: birincil Telegram (G-P13b-11).
6. **4450:** `CADDY_BIND=127.0.0.1`. Kanıt: `ss -tlnp | grep 4450` yalnız 127.0.0.1; dış makineden `nc -vz <ip> 4450` zaman aşımı
   (G-P13b-9).
7. **HSTS kanıtı:** `curl -sI https://remote.noktabilisim.net/login | grep -i strict` → `max-age=31536000; includeSubDomains`.

## P13b — devops T1 (devops, 2026-11-15)

Yedek imzası, audit süreklilik, site dışı kanca, `status.prom`, imza-önce geri yükleme, ortam kilidi, migrator ile yükleme ve
CHECKSUM (mimari-p13 §7.6, ADR-0020, db-notlari "P13b"; güvenlik G-P13b-2/6/7/8, G-P13b-9 notu). `docs/runbook.md`'ye
dokunulmadı; aşağıdaki "Runbook notları (T5)" §18/§19/§20'ye taşınacak.

### Değişen dosyalar

- `deploy/backup/lib.sh`: `deploy_env_of` (deploy/.env'den DEPLOY_ENV; ortam değişkeni sayılmaz), `file_root_600`,
  `cmd_has_inline_secret` (G-P13b-7), `verify_manifest_sig` (find-principals + verify, `-Overify-time=<createdUtc>`),
  `sig_time_of`, `utc_to_epoch`, `sql_dir`; `BACKUP_ENV_KEYS` += SIGNING_KEY, OFFSITE_CMD/TIMEOUT_SEC/USER, UNIT_TIMEOUT_SEC, STATUS_FILE.
- `deploy/backup/backup.sh`: manifest `format: 2` + `env`, `host` (`hostname -s`), `signer`, `seq`, `prevRun`, `audit`
  (audit-continuity.sql, backup kullanıcısı), `auditContinuity {result, detail, comparedWith}`; `ssh-keygen -Y sign` →
  `manifest.json.sig` (600); karşılaştırma kuralı; kanca; `status.prom` (6 metrik, FAILED'da da yazılır).
- `deploy/backup/restore.sh`: `--allowed-signers`, imza her şeyden önce (atlama yok), tazelik/replay, ortam kilidi,
  `--target production` + TTY, scratch'te `01-users.sh`, migrator ile yükleme (`--system-command=OFF --local-infile=0`),
  `restore-sec-snapshot.sql` (anon=0, migratorExtra=0 mutlak), `restore-reset-db.sql`, CHECKSUM canlı = scratch,
  `audit-baseline-reset.sql`. P13a'daki root `DROP/CREATE DATABASE` kalktı; root yalnız salt okunur anlık görüntü.
- `deploy/backup/backup.env.example`: P13b anahtarları; alarm örneğinde gerçek adres yerine `http://<whatsapp-servis>:3000` (G-P13b-2).
- `deploy/backup/remote-backup.service`: `TimeoutStartSec=2h` (G-P13b-6).
- `.env.example`: `DEPLOY_ENV` (development|staging|production).
- `deploy/docker-compose.yml`: `WHATSAPP_SERVICE_URL: ${WHATSAPP_SERVICE_URL:-}` (env'den; yerleşik varsayılan yok), yorumdaki IP kaldırıldı (G-P13b-2).

### Kararlar / sapmalar (gerekçeli)

- **`DEPLOY_ENV` env.ts'te ve compose servislerinde YOK** (CLAUDE.md "yeni env → env.ts + compose" kuralına istisna): hiçbir
  konteyner okumaz; yalnız backup.sh/restore.sh `deploy/.env`'den `awk` ile okur (backup.env anahtarlarıyla aynı gerekçe, mimari-p13 §4).
- **Audit FAILED olsa da yedek yayımlanır ve imzalanır** (kanıt + site dışı kopya), çıkış 1 → OnFailure alarmı. Sonraki
  karşılaştırma son **İYİ** manifestle yapılır, rotasyon o referansı silmez → taban çizgisi sıfırlanana kadar her gün alarm.
  `prev` manifestin imzası backup.sh'in kendi açık anahtarıyla doğrulanır; geçersizse FAILED (yerel dizin kurcalanmış).
- **Taban çizgisi kuralı sıkılaştırıldı (test bulgusu):** `baseline.id` farkı yalnız `baseline.at > P.audit.measuredAtUtc`
  ise "taban-cizgisi-sifirlandi" (uyarı) sayılır; aksi hâlde `FAILED taban-cizgisi-kaydi-kayboldu`. Gerekçe: TRUNCATE
  sıfırlama satırını da siler; db-notlari kuralı 2 (yalnız "farklı mı") bunu sessiz bir sıfırlama gibi gösteriyordu. **dba'ya:**
  `audit-continuity.sql` başlığındaki kural 2'ye bu koşul eklenmeli.
- `triggers.ok=false` → `FAILED adım=tetikleyici`, yedek alınmaz (P13a'daki tetikleyici sayısı davranışıyla tutarlı).
- **Kanca (G-P13b-6, tek birim seçeneği):** `timeout -k 60 <süre> setpriv --reuid/--regid=remote-offsite --clear-groups
--inh-caps=-all --bounding-set=-all --no-new-privs env -i PATH HOME REMOTE_BACKUP_* sh -c "$BACKUP_OFFSITE_CMD"`, cwd `/`.
  Süre = min(`BACKUP_OFFSITE_TIMEOUT_SEC`, `BACKUP_UNIT_TIMEOUT_SEC` − geçen − 10 dk − 60 sn). Okuma izni yalnız kanca
  süresince: BACKUP_DIR 710, run 750, `*.age`/manifest/imza 640 (grup remote-offsite); kancadan sonra 700/600'e döner.
  Kullanıcı yok/uid 0, setpriv yok, üst dizine girilemiyor ya da komut metninde sır var → kanca çalışmaz, `OFFSITE-FAILED rc=126`.
  Ayrı systemd birimi (`remote-backup-offsite@`) seçeneği konteynerde test edilemediği için seçilmedi.
- **G-P13b-7 (T1 payı):** `BACKUP_ALERT_CMD` / `BACKUP_OFFSITE_CMD` metninde `api.telegram.org/bot<rakam>`, `x-api-key:`,
  `Authorization: Bearer <değer>` → çalıştırılmaz (fail-closed), uyarı yazılır.
- **G-P13b-8:** manifest `seq` (en yeni manifest +1) ve `prevRun`; restore: dizin adı run biçimindeyse `= manifest.run`
  (değilse uyarı), yaş ve sıra yazılır, aynı üst dizinde daha yeni yedek varsa uyarı; production'da yaş > 48 sa ya da daha
  yenisi varsa TTY'de ayrıca `ESKI-<run>`. Doğrulama `-Overify-time=<createdUtc>`; imzalayan parmak izi = `manifest.signer`.
- Ortam kilidi: staging|production → `deploy/.env DEPLOY_ENV = --target = manifest.env`, `--confirm <db>@<hostname -s>`,
  root, compose projesi = `RESTORE_EXPECT_PROJECT`; production ek: `manifest.host = hostname -s`, TTY'de `PRODUCTION-<host>`.
  Hepsi **çözmeden önce**. P13a (format 1, imzasız) yedekler yeni restore.sh ile yüklenmez (bilinçli; gerekirse P13a commit'indeki betik).
- **G-P13b-2 kalan:** `deploy/mysql/check-app-grants.sh:409` test değerinde gerçek WhatsApp servis adresi duruyor (dba dosyası,
  geri alınan TX içinde) → dba yer tutucuyla değiştirmeli. `deploy/turn`, Caddyfile, `deploy/ops` paralel ajanın alanında taranmadı.

### Test (2026-11-15; yerel, alpine 3.20 root yardımcı konteyner + docker.sock, dind yok; geçici `rst1<rand>` compose

projesi: mysql 8.4.13 (compose imajı) + init + güncel migration'lar `remote-migrate:local` ile + sahte server/web; geçici age ve
ed25519 anahtarları konteyner içinde) — **49/49 PASS**. Konteynerler, volume'lar, ağlar, yardımcı imaj ve anahtarlar silindi.

- Yedek: ilk → `audit-sureklilik: ilk`, `OFFSITE-UNCONFIGURED`, status.prom 644 (`offsite_configured 0`); manifest alanları, imza 600.
- Kanca: başarılı (remote-offsite olarak; imza anahtarı, `deploy/.env`, backup.env okunamadı, BACKUP_DIR listelenemedi, ortamda
  sır yok; 4 dosya kopyalandı; izinler sonra 700/600'e döndü; komut metni logda yok); `exit 7` → `OFFSITE-FAILED rc=7` + alarm,
  birim rc 0, `offsite_last_rc 7`; metinde `x-api-key:` → rc 126.
- Restore scratch meşru → `restore-verify: OK` (7 sn). İmzasız / değiştirilmiş manifest / bozuk imza / yabancı anahtar →
  `FAIL (imza)`, sha256 ve çözme yok. Eski yedek yeni ada kopyalanmış → ret.
- Ortam: yanlış DEPLOY_ENV → ret; env=staging yedek → production ret; production + TTY yok → ret; yanlış `--confirm` → ret;
  DEPLOY_ENV boş → yedek `FAILED adım=önkoşul`, `last_run_ok 0`; yanlış compose projesi → ret.
- Canlı taklidi (staging): reset migrator ile `restore-reset: OK`, CHECKSUM 19 tablo canlı = scratch, `audit-baseline-reset: OK`,
  `/ready` 200, kesinti 7 sn; sonradan eklenen satır gitti.
- Audit: restore sonrası `taban-cizgisi-sifirlandi` + alarm (rc 0); değişiksiz → ok; tetikleyiciler düşürülüp tek geçmiş satır
  silinip birebir geri kurulunca → `FAILED adım=audit-sureklilik gun=…` (triggers.ok kaldı), yedek yayımlandı, status
  `audit_continuity_ok 0`; ertesi çalıştırma yine FAILED; baseline reset → uyarı + ok; TRUNCATE → `FAILED taban-cizgisi-kaydi-kayboldu`;
  tetikleyici DROP → `FAILED adım=tetikleyici`. `--alert` metninde sır → çalıştırılmadı. İmza anahtarı 644 → `FAILED adım=imza`.
- `shellcheck -x` (koalaman stable; `-S warning` temiz, info yok) ve `bash -n` temiz: backup.sh, restore.sh, lib.sh.
- Ortam notu: macOS virtiofs bağlamasında dosya izinleri uygulanmıyor; erişim testleri konteyner dosya sisteminde yapıldı.

### Runbook notları (T5'e)

- **§18.1 önkoşullar:** `age`, `jq`, `openssh-client` ≥ 8.9 (Ubuntu 24.04: 9.6; `-Overify-time`), `util-linux` (setpriv).
  `deploy/.env`'e `DEPLOY_ENV=staging|production`. İmza anahtarı:
  `install -d -m 755 /etc/remote-backup && ssh-keygen -t ed25519 -N '' -C remote-backup@$(hostname -s) -f /etc/remote-backup/manifest_ed25519`
  (root 600), `allowed_signers` (644) satırı `remote-backup@<host> namespaces="remote-backup" ssh-ed25519 AAAA…` + parola kasası.
  `/var/backups` 755 kalmalı (kanca kullanıcısı geçebilmeli). Unit kopyalanırken `TimeoutStartSec=2h` ve `daemon-reload`.
- **Kanca kurulumu:** `useradd --system --home-dir /var/lib/remote-offsite --create-home --shell /usr/sbin/nologin remote-offsite`;
  hedef kimliği bu kullanıcının 600 dosyasında; `BACKUP_OFFSITE_CMD` metninde sır yok. Hedef şartı (ADR-0020 m.4 + G-P13b-8):
  kimlik yalnız yazar, üzerine yazma/yeniden adlandırma yok, 14 + 1 gün.
- **Beklenen satırlar:** `remote-backup: OK …`, `audit-sureklilik: ilk|ok|taban-cizgisi-sifirlandi …`, `OFFSITE OK|OFFSITE-FAILED|OFFSITE-UNCONFIGURED`.
  `status.prom`: `/var/lib/remote-backup/status.prom`.
- **§18.4 geri yükleme:** komut `restore.sh --identity <key> --allowed-signers <kasadaki kopya> [--target …] <run>`; ilk
  satırlar `CHECK OK manifest imzası SHA256:…`. Olumsuz prova: manifestte tek bayt → `restore-verify: FAIL (imza)`.
  Canlı sıra: ön yedek → stop web server → anlık görüntü → reset (migrator) → yükleme (migrator) → CHECKSUM → baseline reset → up -d.
  Rotasyon: eski satıra `valid-before="<rotasyon anı>"`, sızıntıda `<sızma anı>`.
- **§19 "audit süreklilik alarmı":** `journalctl -u remote-backup -n 50 | grep audit-sureklilik` → gün listesi/maxId/tail;
  incele (Audit ekranı, son İYİ yedekle scratch karşılaştırması); meşru ise `audit-baseline-reset.sql` (gerekçe, operatör);
  değilse olay müdahalesi. FAILED süren yedekler yine imzalı ve yerelde (kanıt).
- **§19 "site dışı kanca başarısız":** `OFFSITE-FAILED rc=<n>`: 124/137 süre aşımı, 126 kullanıcı/izin/metinde sır, 127 setpriv yok,
  diğerleri aracın kodu. Elle tekrar: `sudo -u remote-offsite env -i … sh -c "$BACKUP_OFFSITE_CMD"` (REMOTE_BACKUP_RUN_DIR verilerek;
  önce run dizinine geçici grup okuması).
- **G-P13b-9 (terfi, §20/T6):** (1) Adım 2'deki staging-final yedeği `/var/backups/remote-staging-final/<run>/` olarak
  taşınır (dizin adı = run kalmalı; replay denetimi). (2) Prod anahtarı üretilmeden ÖNCE staging açık anahtar satırı
  `cp -p /etc/remote-backup/allowed_signers /root/allowed_signers.staging-final` (644, 14 gün); prod `allowed_signers`'ta
  **yalnız** prod anahtarı olur; staging özel anahtarı `shred -u` (sınır: ext4 journal/SSD — asıl kontrol prod'un yeni anahtarla
  başlaması). (3) Adım 3'te `grep -c '^DEPLOY_ENV=staging$' /root/.env.staging-final.*` = 1 denetlenir; yoksa geri dönüşte restore reddeder.
  (4) Geri dönüş: `.env.staging-final` geri konur → `restore.sh --identity <staging age> --allowed-signers /root/allowed_signers.staging-final
--target staging --confirm remote@develop /var/backups/remote-staging-final/<run>`; staging-final yaşı > 48 sa olsa da staging'de ek onay yok
  (yalnız uyarı). (5) Prod ilk yedeği yeni volume → `audit-sureklilik: ilk` (instanceId farkı) beklenir. (6) 14 gün sonra
  staging-final dizini ve `allowed_signers.staging-final` silinir.

### P13b QA #5 — WhatsApp "Varsayılan" kaynağı kaldırıldı (frontend)

- `WhatsappSettingsView.source` artık `"panel" | "env"` (contracts); `SourceBadge` `fallback`/`default` dalı, `whatsapp-form.tsx` varsayılan bilgi notu/ipucu ve `tr.json` içindeki `wa.svc.defaultBadge|defaultSource|urlHintDefault` anahtarları silindi.
- Adres yokken mevcut `wa-svc-empty` boş durumu ("Servis yapılandırılmamış", test pasif) gösterilir; eski `default` yanıtı savunma olarak `env`e indirgenir.
- Güncellenen: `lib/admin-settings/whatsapp(.test).ts`, `e2e/p13a.spec.ts` (Varsayılan senaryosu boş duruma çevrildi). E2E çalıştırılmadı (yığın/DB gerekir); lint, typecheck, vitest yeşil.

### S-P13b-3 — WhatsApp servis anahtarı alanı (frontend)

- `whatsapp-form.tsx`: "Servis anahtarı" bölümü (maskeli, `revealable`, geri yazılmaz; boşsa PUT'ta `apiKey` yok = korunur; `fields.apiKey` hatası alanda). Rozet `SourceBadge` (`testId`/`none` eklendi): Kayıtlı (panel) / Kayıtlı (env) / Tanımlı değil. "Anahtarı kaldır" (yalnız panel anahtarı) onaylı `alertdialog` → PUT `{url, apiKey:null}`.
- Test 401 mesajı sunucudan gelir ("Servis anahtarı reddetti."), mevcut test sonucu uyarısında görünür. `lib/admin-settings/whatsapp.ts` `checkWaApiKey`; i18n `wa.svc.key*`.
- Test: birim (`whatsapp.test.ts`), e2e `p12b-whatsapp.spec.ts` (env rozet, kayıt/kaldırma onayı, 401); mock `mock-audit.mjs` (`apiKey*`, telefon sonu 8888888 → unauthorized).

### P13b — backend, WhatsApp servis anahtarı (S-P13b-3, kullanıcı kararı, 2026-11-15)

Kaynak: koordinatör sözleşmesi. WhatsApp servisi `x-api-key` başlığı isteyecek; servis tarafı ayrı projede.

**Sözleşme** (`packages/contracts/src/api/system-settings.ts`):

- `whatsappSettingsInputSchema` yeni alan `apiKey?: "" | null | waApiKeySchema`.
  - Anahtar 16–256 kod noktası; boşluk ve `\p{Cc}` yok.
  - Alan yok ya da `""` → mevcut anahtar korunur; `null` → anahtar silinir.
- `WhatsappSettingsView` yeni alanlar `apiKeySet: boolean`, `apiKeySource: "panel" | "env" | null`.
- `WA_TEST_REASONS` + `unauthorized`; `WA_TEST_MESSAGES.unauthorized = "Servis anahtarı reddetti."`.
- Yeni sabitler: `WA_API_KEY_MIN`, `WA_API_KEY_MAX`, `WA_API_KEY_MESSAGE`, `WA_API_KEY_REENTER`.

**Server:**

- `env.ts`: `WHATSAPP_SERVICE_API_KEY`, aynı şemayla doğrulanıyor. Ayrıca `.env.example` (boş) ve `deploy/docker-compose.yml` server servisine `${WHATSAPP_SERVICE_API_KEY:-}` satırı eklendi; compose'da yalnız bu satır değişti.
- `settings/system.ts`:
  - Anahtar `system_settings.whatsapp.secret_enc`'te AES-256-GCM ile saklanıyor. AAD: `aadFor.whatsappApiKey(origin)` = `system_settings.secret_enc:whatsapp:<şema+host+port>`.
  - Değer hiçbir yanıtta dönmüyor.
  - `effectiveWhatsappTarget` adres ve anahtarı birlikte veriyor. Notifier'a `setUrl(url, apiKey)` ile uygulanıyor: açılışta ve her PUT/DELETE sonrası.
  - Anahtar çözülemezse başlıksız gönderiliyor ve `alarm: whatsapp_api_key_unreadable` logu düşüyor.
- `notify/whatsapp.ts`:
  - Anahtar varsa `send-message` ve `test-send` isteklerine `x-api-key` ekleniyor.
  - Servis 401 dönerse sonuç `unauthorized` oluyor (`alarm: whatsapp_unauthorized`; logda yalnız anahtar var mı bilgisi, değer yok). Bildirimde yeniden deneme yapılmıyor.
  - Hem Super Admin hem tenant test yanıtında mesaj "Servis anahtarı reddetti." oluyor.
- `lib/logger.ts`: `*.apiKey` redakte ediliyor.
- `audit/mask.ts`: `apiKeySet` ve `apiKeyChanged` izinli listeye eklendi.
  - Audit `settings.whatsapp.updated|deleted` kayıtlarında anahtar yalnız `apiKey: "***"` olarak (varsa) ve `apiKeySet` olarak geçiyor; PUT'ta ek olarak `apiKeyChanged`.
  - Sebep: `null` değer de `key` kalıbıyla `***` olarak yazılıyordu, var/yok ayırt edilemiyordu.

**Tasarım kararları ve sapmalar (gerekçeli):**

1. **Anahtar adresiyle birlikte gelir.** Panel adresine yalnız panel anahtarı, env adresine yalnız env anahtarı gider.
   - Gerekçe: env anahtarı, panelde girilen başka bir adrese gönderilmesin; anahtar sızdırma yolu kapanır (MySQL B-P11-1 kalıbı).
   - Sonuç: panelde adres var ama panel anahtarı yoksa `apiKeySource: null` olur; env anahtarı kullanılmaz.
2. **Adres kökeni değişirken anahtar verilmezse 400 VALIDATION** (`fields.apiKey = WA_API_KEY_REENTER`). Kayıtlı anahtar eski kökene bağlı olduğu için yeni adrese taşınmıyor. Aynı kökende (yol değişikliği dahil) anahtar korunuyor. Frontend alan hatasını genel kalıpla göstermeli; mock'ta bu durum yoksa eklenmeli.
3. **DELETE (env'e dön)** panel anahtarını da siliyor.
4. **DB CHECK değişikliği** (`secret_enc IS NULL` kuralı gevşedi) için `apps/server/prisma/migrations/20261115090000_whatsapp_api_key/{migration.sql,down.sql}` yazıldı. **dba incelemesi gerekli.**
   - Yeni kural: adres null ise `secret_enc` NULL olmak zorunda; adres doluysa NULL ya da şifreli değer olabilir.
   - Adres kuralı P13a ile birebir aynı. Uzunluk alt sınırını genel `system_settings_secret_enc_chk` (≥ 30) sağlıyor.
   - Prisma şeması değişmedi; yetki değişmedi (app zaten `secret_enc` yazıyor).
   - `deploy/mysql/check-app-grants.sh:415`'teki DENIED senaryosu (`url:null` + secret) yeni kuralla da DENIED. dba bu kurala "url dolu + secret → OK" satırını eklemek isteyebilir.

**Diğer ajanlara notlar:**

- **devops:** runbook env tablosuna `WHATSAPP_SERVICE_API_KEY` eklenmeli (§12 / §17). Değer `deploy/.env`'de root 600 dosyada tutulur ve loglanmaz.
- **teknik-yazar:** README/kılavuzda WhatsApp ayar ekranına "Servis anahtarı" alanı anlatılmalı.

**Test:**

- `whatsapp-admin-p12b.test.ts` +3 (S-P13b-3), seri projede:
  - env anahtarı env adresine gidiyor;
  - panel anahtarı şifreli saklanıyor; yanıtta, DB'de düz metin olarak ve audit'te değer yok;
  - alan yok ya da `""` → korunuyor (değişiklik yoksa audit yok);
  - köken değişikliğinde 400; `null` → siliniyor ve başlık gitmiyor; DELETE → env;
  - 401 → mesaj ve audit `reason: unauthorized`; geçersiz anahtarlar 400.
- `whatsapp-setting.test.ts`: yeni CHECK kuralı.
- `whatsapp-runtime-p12b.test.ts` +1 (unit): başlık, adresle birlikte değişme, 401 alarmı.
- `test/helpers/requests.ts`: sahte servis artık `x-api-key` başlığını kaydediyor.

**Sonuç:**

- `pnpm -r run lint` ve `pnpm -r run typecheck` temiz.
- Unit: contracts 78/78, web 252/252, server 351/351.
- Temiz DB'de (yeni migration uygulanmış) `test:int` **541/541** (54 dosya).
- Geçici konteyner `rs-p13b-be-33e990` silindi.

## P13b — devops düzeltme turu 1 (devops, 2026-11-15)

Kapsam: `docs/qa-raporu.md` (Tur 1) devops maddeleri 1, 2, 5 ve `docs/guvenlik-raporu.md` "P13b kod turu" S-P13b-1, G-P13b-3,
S-P13b-2, S-P13b-4 (kısmen), S-P13b-6. `docs/runbook.md` ve `apps/` değişmedi; runbook'a girecek adımlar aşağıda (T5'e).
Sunucuya bağlanılmadı, dind kullanılmadı, docker prune yapılmadı; test konteynerleri/volume'ları trap ile silindi (kontrol: boş).

### S-P13b-1 — taban çizgisi sıfırlaması host işaretine bağlandı

- Yeni root komutu `backup.sh --reset-audit-baseline "<gerekçe>"`: `audit-baseline-reset.sql`'i migrator ile çalıştırır,
  dönen id ile `$BACKUP_DIR/audit-baseline-reset.json` (root 600; `{format,id,createdUtc,operator,reason,host,env}`) yazar.
  `restore.sh` canlı yüklemeden sonra artık SQL'i doğrudan değil bu komutu çağırır (tek kod yolu).
- `backup.sh` kural 2: `baseline.at > P.measuredAtUtc` **ve** işaret root 600 normal dosya **ve** `işaret.id = baseline.id`
  → `taban-cizgisi-sifirlandi` (uyarı); işaret imzalı manifeste `auditContinuity.baselineMarker` olarak girer, dosya silinir.
  İşaret yok/id farklı/izin yanlış → `FAILED taban-cizgisi-isaretsiz`. Kayıt kayboldu/eski kuralı aynen (`kaydi-kayboldu`).
- SQL davranışı değişmedi; yalnız başlık yorumları (`audit-continuity.sql` kural 2a/2b/2c, `audit-baseline-reset.sql`
  "Çalıştırma") ve `docs/db-notlari.md` (komut tablosu, P13b 716-717 ve kural 2) güncellendi. QA #4 (dba) bununla birlikte kapandı.

### G-P13b-3 — 4451 yerel bağlantı kısıtı (`deploy/ops/proxy-guard.sh`)

- **Seçilen yol: nftables `meta skuid`.** Ayrı tablo `inet remote_proxy_guard`, zincir `output` (hook output, priority filter
  = NAT'tan sonra): `tcp dport 4451`, hedef `{127.0.0.0/8, 172.30.0.0/24}` ya da `::1`, `ct state new`, soket sahibi
  `{root, www-data}` dışında → `reject with tcp reset` (sayaçlı). Hedefe edge ağı da dahil: host'tan `172.30.0.2:4451`'e
  doğrudan bağlantı da Caddy'ye 172.30.0.128'den (güvenilen) görünür; yalnız 127.0.0.1 kuralı bunu kaçırırdı.
- Sır başlık (nginx → Caddy) yolu seçilmedi: Caddyfile + nginx conf + yeni sır/env + test-caddy değişikliği ister ve sır
  nginx conf'ta (çoğu kurulumda 644) durur; skuid kuralı uygulama/Caddy'ye dokunmadan aynı tehdidi kapatır.
- Kalan risk (gerekçeli): `www-data` ile çalışan başka süreçler (paylaşımlı sunucuda php-fpm havuzları) hâlâ bağlanabilir.
  `check` bunları `UYARI: www-data ile nginx dışı süreç` olarak yazar; kapatmak için nginx'e ya da php-fpm havuzlarına ayrı
  kullanıcı (`PROXY_GUARD_USERS`).
- Alt komutlar `print|apply|check|ensure|remove|verify|install|uninstall` (host-firewall.sh kalıbı): kurulu kopya
  `/usr/local/sbin/remote-proxy-guard`, `/etc/default/remote-proxy-guard` (root 0644, g/o yazılabilirse çalışmaz),
  `remote-proxy-guard.service` (açılış) + `.timer` (5 dk ensure). `nft -f` tek işlem: hata olursa mevcut tablo değişmez.
- Test: `deploy/ops/test-proxy-guard.sh` (alpine, NET_ADMIN, kendi netns, gerçek nftables) **34/34 PASS**: korumasız açık
  kanıtı; root/www-data bağlanır, nobody/uid 4242 RST; 172.30.0.2:4451 doğrudan; DNAT yolu (nat output 127.0.0.1:4451 →
  172.30.0.2:4451, userland-proxy kapalı taklidi) — kural NAT'tan sonra da tutar; ::1; kapsam dışı 4450 ve başka adres
  etkilenmez; idempotent; hatalı kullanıcı adında mevcut tablo korunur; flush/silme → check 1 → ensure onarır; verify; UYARI;
  install/uninstall izinleri.

### QA #1 — `deploy/backup/test-backup.sh` (AC-298/300/301 kanıtı)

- `deploy/backup/test-backup.sh` (host sürücüsü) + `test-backup-inner.sh` (senaryolar, yardımcı konteynerde). Benzersiz
  compose projesi `rstb<epoch><rand>` (mysql compose imajı + init, sahte server/web), migration host'tan `pnpm db:migrate`,
  yardımcı alpine 3.20 + docker.sock (dind yok). Anahtarlar, BACKUP_DIR, deploy/.env ve remote-offsite kullanıcısı konteyner
  dosya sisteminde (macOS virtiofs bağlamasında izinler uygulanmaz); repo aynı mutlak yolla salt okunur. Trap: compose
  down -v, yardımcı ve volume'lar silinir.
- Sonuç (2026-11-15, ~2,5 dk): **55/55 PASS** — `deploy/backup/test-backup.sh` → `SONUÇ: GEÇTİ (55 PASS)`. Kapsam:
  meşru yedek/imza/verify, scratch OK; imzasız, değiştirilmiş manifest, bozuk imza, yabancı anahtar → `FAIL (imza)` ve
  sha256/çözme yok; şifreli dosya değişti → çözülmedi; replay (eski yedek yeni ada); yanlış --confirm, staging→production,
  DEPLOY_ENV uyuşmazlığı, production+TTY yok, DEPLOY_ENV boş (`FAILED adım=önkoşul`), yanlış compose projesi; canlı taklidi
  (reset migrator, CHECKSUM canlı = scratch, /ready, sonradan eklenen satır gitti, host işareti yazıldı); S-P13b-1 (sahte app
  satırı, yanlış id'li işaret, 644 işaret → FAILED; meşru sıfırlama → uyarı); tetikleyici düşür + tek DELETE + birebir geri
  kur → `FAILED gun=` (iki gün üst üste); TRUNCATE → `kaydi-kayboldu`; DROP TRIGGER → `adım=tetikleyici`; kanca başarılı
  (imza anahtarı/deploy .env okunamadı, BACKUP_DIR listelenemedi, ortamda sır yok, sonra 700/600, komut metni logda yok),
  kanca `exit 7` → `OFFSITE-FAILED rc=7` + alarm + birim rc 0, `x-api-key` → rc 126; **"kurcalanmış döküm yüklenemez, iz
  bırakmaz"**: imzalı ama `CREATE USER`, `GRANT ALL ON *.*`, `SET PERSIST`, `INSTALL COMPONENT`, `USE mysql; INSERT` içeren
  döküm → migrator yükleyemez FAIL; `\!` → yükleme denenmeden FAIL; staging hedefinde scratch FAIL → canlıya dokunulmadı;
  canlı hesap/persist/bileşen sayısı aynı, scratch konteyneri kalmadı; `--alert` sır → çalışmadı; imza anahtarı 644 → FAILED.
- Bulgu (düzeltildi): `USE mysql` satır başındaysa istemci komutu taramasına zaten takılıyor; test, sunucu tarafı yolunu da
  sınamak için `SELECT 1; USE mysql; …` kullanır. Çalıştırma adı saniye çözünürlüklü: test her yedekten önce 1 sn bekler.

### QA #2 — 300 satır sınırı

- Bölündü: `backup.sh` 454 → **296** (+ `lib-audit.sh` 133: önceki manifest, ölçüm, işaret, karşılaştırma, sıfırlama
  komutu; `lib-offsite.sh` 126: status.prom, alarm, kanca; `lib.sh` 246: `side/wait_side/count_bytes`, `rotate_runs`).
  `restore.sh` 351 → **277** (+ `lib-restore.sh` 89: scratch, migrator, güvenlik anlık görüntüsü, CHECKSUM, verify_db).
  Bölmeden sonra test-backup 55/55.
- Bölünmedi (gerekçe): `deploy/turn/host-firewall.sh` (344) ve `deploy/ops/remote-watch.sh` (313). İkisi de root timer'ının
  çalıştırdığı **tek dosyalık kurulu kopya** kalıbıdır (`/usr/local/sbin/remote-turn-fw`, `/usr/local/lib/remote/remote-watch.sh`;
  G-P13b-13/S-P3-T2-2): kurulu kopya git ağacını değil yalnız kendisini okur. Bölmek ikinci bir root kodu dosyası (source)
  getirir; onun da sahip/izin denetimi, kurulum ve kaldırması gerekir, yani saldırı yüzeyi ve kurulum adımı artar. Aşım
  44 ve 13 satır; host-firewall.sh'in tam testi (test-local 65) gerçek coturn ister. `check-app-grants.sh` (489) dba'da.

### QA #5 — shellcheck

- `turn/test-denied.sh` (`cd … || exit 1`; kullanılmayan `v6_ok` iki yerden kaldırıldı), `turn/test-local.sh` (SC2155:
  ayrı atama), `turn/entrypoint.sh` (SC2154: `val=""` ön tanımı). `shellcheck -x -S warning` (koalaman stable,
  `LC_ALL=C.UTF-8`) `deploy/backup/*.sh deploy/ops/*.sh deploy/turn/*.sh` **temiz**; `bash -n` hepsi temiz.

### Düşük maddeler

- **S-P13b-2 (yapıldı):** `restore.sh` manifest ve imzayı önce 700 bir geçici dizine kopyalar; doğrulama ve sonraki bütün
  `jq` okumaları kopyadan. `M_RUN` `^[0-9]{8}T[0-9]{6}Z$`, `M_ENV` development|staging|production, `M_HOST`
  `^[A-Za-z0-9.-]{1,64}$`, `M_SEQ` sayı; değilse ret (test: imzalı ama `run` geçersiz → ret).
- **S-P13b-6 (yapıldı):** kanca izni `OFFSITE_OPEN` bayrağıyla izlenir, `on_exit` → `offsite_close` geri alır (test: kanca
  sırasında TERM → 700/600). SIGKILL'de trap çalışmadığı için sonraki çalıştırma kilitten sonra **yalnız çalıştırma
  dizinlerini** 700/600'e normalleştirir (test: KILL → 750 kaldı → sonraki yedek düzeltti). Not: ilk denemede bütün
  BACKUP_DIR normalleştiriliyordu; 644 bir işaret dosyasını 600 yapıp geçerli kılıyordu (test yakaladı, daraltıldı).
- **S-P13b-4 (kısmen):** `remote-watch` `tree-perms` artık root dışı gruba yazılabilir dosyayı da yakalar
  (`-perm -0020 ! -group 0`); test-watch'a olumsuz test eklendi → **49/49 PASS**. Yedek biriminin `/usr/local/lib/remote/`
  altındaki kurulu kopyadan çalışması → **Sonra** (backup.sh, restore.sh, lib*.sh ve `../mysql/*.sql` birlikte kurulmalı;
  `sql_dir` yolu ve restore'un `backup.sh` çağrısı buna göre uyarlanmalı).

### Runbook notları (T5'e)

1. **Audit taban çizgisi sıfırlama (§18/§19 "audit süreklilik alarmı"):** elle SQL çalıştırmak artık yetmez. Tek yol:
   `sudo /opt/remote/deploy/backup/backup.sh --reset-audit-baseline "<gerekçe 10-200 karakter, ' ve \ yok>"` → beklenen
   `audit-baseline-reset: OK id=<n> isaret=/var/backups/remote/audit-baseline-reset.json`. Sonraki yedek
   `taban-cizgisi-sifirlandi` (uyarı). `FAILED taban-cizgisi-isaretsiz` görülürse: DB'ye sıfırlama satırı işaretsiz yazılmış
   → olay müdahalesi (Audit ekranında `backup.audit_baseline_reset` satırının kullanıcı/IP'si incelenir); meşruysa komut
   yeniden çalıştırılır. restore.sh canlı yüklemede bunu kendisi yapar.
2. **proxy-guard kurulumu (prod, nginx kurulduktan sonra; staging'de de önerilir):**
   `sudo apt install nftables` (yalnız `nft` aracı; nftables.service etkinleştirmek gerekmez) →
   `ps -o user= -C nginx | sort -u` ile işçi kullanıcısını doğrula (vars. www-data; farklıysa `PROXY_GUARD_USERS="root <kullanıcı>"`)
   → `sudo deploy/ops/proxy-guard.sh install` → `sudo remote-proxy-guard check` (`OK`; www-data ile nginx dışı süreç varsa
   UYARI satırlarını değerlendir) → `sudo remote-proxy-guard verify` → `verify OK: root bağlandı, 'nobody' reddedildi`
   → `curl -sI https://remote.noktabilisim.net/login` 200 (nginx yolu çalışıyor) → `nft list table inet remote_proxy_guard`.
   Geri alma: `sudo remote-proxy-guard uninstall`. Prod açılış kontrol listesine (§20.3) "G-P13b-3 verify OK" satırı.
3. **Yedek testi:** değişiklikten sonra yerelde `deploy/backup/test-backup.sh` (GEÇTİ 55 PASS beklenir) ve
   `deploy/ops/test-proxy-guard.sh`, `deploy/ops/test-watch.sh` (49).

### Güvenlik tur 2 düşük maddeleri (devops, 2026-11-15)

- **S-P13b-11:** Kilit `lib.sh` `backup_lock` olarak tek yere taşındı (`$BACKUP_DIR/.lock`, mkdir + pid, ölü kilit temizliği;
  `flock` yerine mevcut kilitle aynı mekanizma, böylece iki komut gerçekten aynı kilidi paylaşır). `backup.sh` ve
  `--reset-audit-baseline` bunu kullanır; kilit doluyken sıfırlama `başka bir yedek/sıfırlama çalışıyor` ile reddedilir,
  işaret yazılmaz (test eklendi).
- **S-P13b-10:** `lib-audit.sh` farklar jq `def why` içinde tek yerde. Meşru sıfırlama kabul edilince de hesaplanır ve sonuca
  ` fark-bilgi=<maxId;gun=…;tail=…>` olarak eklenir. Bu metin journal'a, manifest `auditContinuity.detail`'e ve uyarı alarmına
  gider. **Yalnız bilgi**dir: sonuç `taban-cizgisi-sifirlandi` olarak kalır, rc 0 (test: DELETE sonrası sıfırlamada alarmda `fark-bilgi=…gun=`).
- **S-P13b-12:** `remote-proxy-guard.service`: `Before=docker.service`, `After=network-pre.target nftables.service`,
  `WantedBy=multi-user.target nftables.service`. nftables.service (yeniden) başlatılınca bu birim de onun ardından çalışır ve
  tabloyu yeniden kurar. nftables **stop** (`nft flush ruleset`) tabloyu siler; timer en geç 5 dk içinde `ensure` ile onarır
  (bu süre kalan pencere, runbook'a yazılmalı). Değişiklikten sonra `install` yeniden çalıştırılır (`systemctl reenable` gerekmez; install enable eder).
- **docker grubu notu (runbook'a):** `docker` grubundaki her kullanıcı root eşdeğeridir (docker.sock ile `--privileged`,
  host bağlama, `--network host` + `--user 0`). proxy-guard `skuid` kuralı, ayrıca yedek imza anahtarı ve backup.env'in root
  600 olması bu kullanıcılara karşı koruma DEĞİLDİR. Prod'da docker grubu boş tutulur: `getent group docker` → üye yok;
  deploy kullanıcısı `sudo` ile çalışır.
- **S-P13b-5 (runbook notu, T5'e):** `-Overify-time` doğrulamayı manifestin imzalı `createdUtc` anına göre yapar. Bu yüzden
  **rotasyonda** eski anahtar satırına `valid-before="<rotasyon anı>"` yazılır (o andan önceki yedekler doğrulanmaya devam
  eder). **Anahtar sızarsa** eski `allowed_signers` satırına `valid-before="<sızma anından önce, kesin güvenli an>"` konur.
  Sızan anahtarla geriye tarihli `createdUtc` yazılarak imzalanan sahte manifest bu sınırı geçebileceği için sızma şüphesinde
  satır kaldırılır. Sızma öncesi yedekler yalnız kasadaki ayrı `allowed_signers` kopyasıyla ve tarih penceresi elle
  doğrulanarak yüklenir. production'daki 48 sa yaş onayı ikinci engeldir.
- Testler: `deploy/backup/test-backup.sh` → **GEÇTİ (56 PASS)**, `deploy/ops/test-proxy-guard.sh` → **GEÇTİ** (birim
  `Before=`/`WantedBy=` kontrolü eklendi). shellcheck (`deploy/backup`, `deploy/ops`, `deploy/turn`) temiz. Test konteynerleri silindi.

### P13b — backend, QA tur 2 + güvenlik tur 2 düzeltmeleri (2026-11-15)

- **QA (dosya boyutu):** WhatsApp bölümü `apps/server/src/settings/system.ts`'ten (409 satır) yeni `apps/server/src/settings/whatsapp.ts`'e (≈ 160 satır) taşındı; `system.ts` artık 260 satır.
  - Ortak `SystemDeps`, `who` ve `GLOBAL_KEY` `system.ts`'ten export ediliyor.
  - `routes.ts` importları güncellendi.
  - Taşımada davranış değişmedi. Aynı turda `whatsapp.ts`'teki `insecure` hesabı S-P13b-8 gereği değişti (aşağıda).
- **S-P13b-7 — KAPANDI:** sahte WhatsApp anahtarları `test/helpers/secrets.ts`'e taşındı (`FAKE_WA_ENV_API_KEY`, `FAKE_WA_PANEL_API_KEY`). Allowlist genişletilmedi.
  - `gitleaks dir … apps` sonucunda takip edilen dosyalarda bulgu yok.
  - Kalan 13 bulgunun hepsi git'te izlenmeyen (ignored) Next.js derleme çıktısında: `apps/web/.next/**` (preview/prerender manifest anahtarları).
- **S-P13b-9 — KAPANDI:** `waApiKeySchema` artık `/^[\x21-\x7E]{16,256}$/` (yalnız yazdırılabilir ASCII). Aynı şema `env.ts`'te `WHATSAPP_SERVICE_API_KEY` için de kullanılıyor. Hata mesajı (`WA_API_KEY_MESSAGE`) güncellendi.
  - Testler: entegrasyonda `ç…` ve U+200B → 400; `env-logger`'da env hatası, değer mesajda yok.
- **S-P13b-8 — KAPANDI:** `notify/whatsapp.ts`'e `keyOverPlainHttp` ve `isInsecureServiceTarget` eklendi.
  - Anahtar varken loopback dışı `http://` adres:
    - production'da kanal güvensiz sayılır ve kapalı kalır: istek yok, `alarm: whatsapp_key_over_http`, ayar ekranında `insecure: true`, test mesajı "Servis güvenli yapılandırılmamış.";
    - geliştirme/testte izin var, `event: whatsapp_key_over_http` uyarı logu düşer.
  - Loopback (127/8, ::1, localhost) ve https her ortamda açık. Anahtar değeri hiçbir logda yok.
  - `setUrl` yalnız anahtar değiştiğinde de yeniden sınıflandırıyor.
  - **Staging etkisi:** staging (`NODE_ENV=production`) bugün genel IP'ye http ile zaten kapalıydı; anahtar da henüz tanımlı değil. Kural mevcut bir akışı kırmıyor.
  - **Prod'da anahtar kullanılacaksa:** servis https'e (TLS vekil, U1/K13) ya da loopback'e alınmalı. Özel ağda http + anahtar artık kapalı.
- **Test:**
  - `pnpm -r run lint` ve `pnpm -r run typecheck` temiz.
  - Unit: contracts 78/78, web 253/253, server 354/354.
  - Temiz DB'de `test:int` **541/541**.
  - Geçici konteyner `rs-p13b-be-ca3127` silindi.

## P13b-L — backend (backend-dev, 2026-11-15)

Kapsam: `docs/mimari-lobi.md` §10.1 L-B (ADR-0029; AC-304..315 sunucu yüzü).

- **Değişen dosyalar**
  - `packages/contracts/src/api/sessions.ts`: §4.3 aynen — `LOBBY_GUEST_MAX`, `LOBBY_POLL_MS`, `SESSIONS_WAITING_PER_MIN`, `waitingSessionsResponseSchema` (strict), `WaitingSessionsResponse`; `SessionListItem.waitingGuests: number`; `SessionHistoryDetail extends Omit<SessionListItem, "waitingGuests">`.
  - `apps/server/src/signaling/types.ts`: `Room.lobbyArrivals`; `LOBBY_MAX = LOBBY_GUEST_MAX` (tek kaynak).
  - `apps/server/src/signaling/rooms.ts`: `getOrCreate` → `lobbyArrivals: 0`; `attachGuest` → `++`; `waitingIn(id)`, `waitingFor(tenantId, techId)` (LOBBY durumlu misafir; `!ending && !admitted && expiresAt > now`; `id` sıralı).
  - `apps/server/src/sessions/lobby.ts` (yeni): `LobbyCounts`, `getWaitingSessions` (count = Σ waiting).
  - `apps/server/src/sessions/history.ts`: `toListBase` (ortak alanlar) + `toListItem(..., lobby?)` → `waitingGuests` (PENDING değilse/lobi yoksa 0); detay `toListBase` kullanır, alan taşımaz; `listHistorySessions(..., lobby?)`.
  - `apps/server/src/sessions/routes.ts`: `GET /waiting` (`requireAuth` → `requirePerm("sessions.view")` → `tenantScope` → `FixedWindowCounter(61, 60 sn, 60 sn)` anahtar `user.id` → servis; `no-store`; `onClose` ile sayaç kapanır); liste `app.rooms` geçirir.
  - Testler: `test/unit/lobby-count-p13bl.test.ts` (13), `test/integration/sessions-lobby-p13bl.test.ts` (12, perf dahil), `sessions-history-api-p8.test.ts` (liste `waitingGuests` = 0, detayda alan yok), `test/helpers/tenant-matrix.ts` (yeni uç `scoped` sınıfı — AC-69 matrisi sınıfsız ucu kırmızı yapar).
  - Doküman: `docs/mimari-api.md` (uç satırı + `SessionListItem` notu), `docs/runbook.md` (§ alarm/bilgi tablosu: restart sonrası 0 beklenen).
- **Tasarımdan sapmalar**
  1. `apps/server/src/customers/service.ts` (plan dışı, tek satır): `GET /customers/:id/sessions` da `SessionListItem` döndürür; alan zorunlu olduğundan `svc.d.rooms` geçirildi. Böylece aynı tipte PENDING satırın değeri iki uçta tutarlıdır (0 sabiti yanlış bilgi olurdu).
  2. Perf testi (§9.1 "1000 ardışık inject, ölçüm kullanıcısının 3 odası"): 60/dk kullanıcı sınırı tek kullanıcıyla 1000 isteğe izin vermez. 1000 istek 20 ölçüm kullanıcısına bölündü (her biri 50 istek, 3 oda); 40 oda başka teknisyende → toplam 100 oda / 300 LOBBY misafir. Oturum çerezleri giriş IP sınırına (20/dk) takılmamak için `openSession` ile doğrudan açıldı. Ölçüm `onResponse` `reply.elapsedTime` (auth DB doğrulaması dahil).
  3. Hız sınırı mevcut kalıpla handler'da (settings/routes.ts gibi) uygulanır; iş mantığı `lobby.ts`'te.
- **Bağımlılık:** yok. **Env/migration/grant:** yok.
- **frontend-dev için sözleşme:** §4.3 aynen; `SessionHistoryDetail` artık `waitingGuests` içermez (Omit). 403 iki durumda gelir: `sessions.view` yok veya firma seçmemiş Super Admin (mesaj "Önce bir firma seçin."). 429'da `Retry-After` saniye.
- **Test (Node 22, pnpm 9):**
  - `pnpm -r run lint`, `pnpm -r run typecheck`: temiz.
  - Unit: server 367/367, contracts 78/78.
  - `test-db.sh up` (benzersiz konteyner `rs-p13bl-be-90271`, port 33417) + `pnpm --filter @remote/server test:int`: **553/553** (55 dosya). Konteyner `down` ile silindi.
  - AC-314 perf çıktısı (tam koşu, yük altında): `GET /sessions/waiting 1000 istek, 100 oda/300 misafir: p50=6.48 ms p95=12.35 ms` (tek başına koşu: p50 2.40 / p95 3.05 ms). test-operatoru `docs/test-raporu.md`'ye aktarır.

## P13b-L — frontend (frontend-dev, 2026-11-15)

Kapsam: mimari-lobi §10.2 (L-F), AC-304..315 web tarafı. Sözleşme `@remote/contracts/api/sessions`'tan (`waitingSessionsResponseSchema`, `LOBBY_POLL_MS`, `SessionListItem.waitingGuests`); yerel tip yok.

### Rotalar

| Yol                                    | Auth                   | Ne değişti                                                                                                                                                                                                                                                                              |
| -------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/sessions`                            | Evet (`sessions.view`) | PENDING satırda "Müşteri bekliyor (n)" rozeti (`BellRing`): kendi oturumumda konsola bağlantı, ADMIN'de başkasının satırında ve firma seçmemiş Super Admin'de bilgi amaçlı. n = 0 iken görünmez yuva. Firma seçmemiş SA'da "Konsolu aç" da gizlendi (a71d80e davranışı korunur, AC-310) |
| Tüm panel sayfaları (`(panel)` kabuğu) | Evet                   | "Oturumlar" menü öğesinde lobi sayacı (yalnız kendi oturumlarım), yeni gelişte toast, gizli sekmede başlık öneki "(n) Müşteri bekliyor — ". `sessions.view` + (SA ise firma seçili) koşulu; `support_requests.view` gerekmez                                                            |
| `/sessions/:id/console`                | Evet                   | Değişmedi; lobi paneli 1280×800'de ilk ekranda (e2e `toBeInViewport`) → `#bekleme-odasi` çapası gerekmedi                                                                                                                                                                               |

### Dosyalar

- Yeni: `apps/web/components/lobby-notifier.tsx` (`LobbyNotifier`, `LobbyCountBadge`, `useLobby`), `apps/web/components/tab-title.tsx`, `apps/web/lib/tab-title.ts` (+ `.test.ts`), `apps/web/lib/lobby/diff.ts` (+ `.test.ts`), `apps/web/app/(panel)/sessions/waiting-badge.tsx`, `apps/web/e2e/p13bl-lobby.spec.ts`.
- Değişen: `components/request-notifier.tsx` (başlık efekti → `setTitlePart("requests", n)`; MutationObserver `TabTitle`'a taşındı), `components/ui/toast.tsx` (bölgeye `role="status"`), `app/(panel)/layout.tsx` (`lobby` koşulu, `<LobbyNotifier scopeKey>`, `<TabTitle />`), `app/(panel)/side-nav.tsx`, `app/(panel)/sessions/session-list.tsx` (tip `SessionListItem`, `pickTenant`), `sessions-view.tsx`, `messages/tr.json` (`s.lobby.*`), `e2e/mock-sessions.mjs` (waiting ucu, `/__e2e/lobby`, `/__e2e/lobby-calls`, `/__e2e/lobby-extra`, senaryolar `u-lob*`, `u-noreq-`, `u-lobadm-`, `u-sa-`, `u-sat-`, `u-lobbyfail-`, `u-lobbyrate-`; liste öğelerine `waitingGuests`), `e2e/mock-api.mjs` (`resolveMe` ile `/auth/me` ve waiting ucu tek çözücü; kancalar), `e2e/sessions.spec.ts` (bir seçici), `DESIGN.md` (ikon + 4 bileşen satırı).

### Sapmalar / notlar

- **Toast bölgesi `role="status"`** (mimari §6.7): diyalog içindeki toast bölgesi de artık `status` rolünde; `sessions.spec.ts`'te `dlg.getByRole("status")` metinle süzüldü (davranış değişikliği değil, seçici belirsizliği).
- **Sahte API'de waiting ucu tüm sahte kullanıcılar için** `mock-api.mjs`'te erken yönlendirilir (panel kabuğu her sayfada yokladığı için); P10/P12 hesap/marka kullanıcıları (`resolveMe` → null) boş yanıt alır.
- `/__e2e/lobby` "restart": sorgusuz çağrı yalnız o oturumun kaydını siler (paralel testler birbirinin durumunu silmesin diye, tasarımdaki "sıfırla" yerine oda başına).
- `/__e2e/lobby-extra/<çerez>` (tasarımda yok): talep + lobi başlık sırası e2e'si için; talep kullanıcısının (`u-rqadm-`) oturum listesi ayrı sahte modülde olduğu için o çerezin "kendi oturumu" kaydı buradan verilir.
- Satır rozeti n = 0 yuvası kartta da ayrı satırı kaplar (tasarım §6.5 "yer kayması yok" kuralı; PENDING kartı ~44 px uzar).
- 429 sonrası görünürlük olayı ek yoklama yapmaz (`Retry-After` dolana kadar).
- `LobbyDot` (mobil açılır menü düğmesi) P14b'ye kaldı (mimari K-L3); bugün 360 px'te sayaç "Oturumlar" öğesinde görünür (e2e).
- Tasarım skill'i (`ui-ux-pro-max`) okunmadı: görünüm tamamen DESIGN.md token/primitifleri ve mimari-lobi §6.4–6.5 ile tanımlıydı.

### P13b-L QA Tur 1 #1 (frontend, 2026-11-15)

`e2e/p13bl-lobby.spec.ts` AC-312 testi genişletildi: rozet görünürken `/sessions` desktop projesinde 1280 ve 360 px'te, mobile projesinde 360 px'te açılır. Her genişlikte iki temada axe 0 ihlal ve yatay taşma yok kontrol edilir. Rozete artık `focus()` ile değil, sayfa başlığından Tab tuşuyla ulaşılır ve Enter konsolu açar. UI düzeltmesi gerekmedi: 360 px kart görünümünde taşma ya da axe ihlali çıkmadı.

### P13b-L — backend düzeltme turu 1 (QA madde 2, güvenlik S13L-1)

- **QA 2 (dosya boyutu):** Lobi sayımı `signaling/lobby-count.ts`'e (yeni) taşındı: `waitingIn(rooms, id)`, `waitingFor(rooms, tenantId, techId)`, `LobbyRooms` yapısal arayüzü (`get`, `values`, `clock`). Liste `waitingGuests` eki `sessions/lobby.ts` `withWaitingGuests`'e taşındı; `history.ts` önceki haline döndü (yalnız `toListItem`/`listHistorySessions` dönüş tipleri `Omit<…, "waitingGuests">` oldu). Satır: `history.ts` 419 → **419**; `rooms.ts` 327 → **329** (+2). Taşınamayan 2 satır: (a) `attachGuest` içindeki `room.lobbyArrivals++` — sayaç LOBBY geçişinin olduğu tek yerde artmalı (kanca/olay eklemek daha fazla satır ve dolaylılık getirirdi); (b) özel `rooms` haritasının salt okunur `values()` erişimcisi — haritayı `public` yapmak yerine tek satırlık gezinme. `Room` literaline `lobbyArrivals: 0` mevcut satırda.
- **S13L-1:** `withWaitingGuests` kullanıcıda `sessions.view` yoksa her satırda `waitingGuests = 0` döner; `GET /sessions` (routes.ts) ve `GET /customers/:id/sessions` (customers/service.ts) aynı fonksiyonu kullanır. Test: entegrasyon "AC-314/S13L-1" (yalnız `session_history.view` + `customers.view` kullanıcısının kendi PENDING oturumunda 2 bekleyen → iki uçta 0; ADMIN aynı satırda 2), unit "AC-305/S13L-1".
- **Test:** lint + typecheck temiz; server unit **368/368**; temiz konteynerde (`rs-p13bl-be2-97011`, 33418) `test:int` **554/554**, konteyner silindi. Perf: p50=5.53 ms, p95=9.11 ms (tam koşu).

## P13c — devops (kod kısmı: C1, C2, C4; devops, 2026-11-15)

Kaynak: `docs/mimari-e11.md` §3, ADR-0019 m.5, ADR-0021. Kurulum (C3) **yapılmadı**: DNS kaydı ve §20 terfisi bekleniyor →
`docs/runbook.md` §21 (taslak). Sunucuya bağlanılmadı. `apps/` ve `env.ts` değişmedi (server env'ine yeni değişken yok).

**C1 — compose/Caddy parametreleri (varsayılanlar = prod)**

- `deploy/docker-compose.yml`: `EDGE_SUBNET`, `EDGE_IP_RANGE`, `EDGE_CADDY_IP`, `EDGE_WEB_IP`, `EDGE_TRUSTED_PROXY_CIDR` (server
  `TRUSTED_PROXY_CIDR`), `CADDY_TLS_PORT` (4450), `CADDY_HTTP_PORT` (4451). Konteyner içi portlar sabit; yalnız host portu değişir.
  Proje adı `name: remote` kalır; staging `.env` `COMPOSE_PROJECT_NAME=remote-stg` ile ezer (denendi: volume/ağ `remote-stg_*`).
- Yeni `deploy/docker-compose.staging.yml` (yalnız staging `.env` `COMPOSE_FILE` ile yüklenir): caddy `CADDY_TRUSTED_PROXIES`
  (zorunlu) + `ROBOTS_NOINDEX: "1"`. **Sapma (gerekçe):** mimari Caddy değişkenlerini ana dosyada varsayardı; ana dosyadaki caddy
  `environment`'a eklenen her anahtar prod `config` çıktısını değiştirirdi (kabul ölçütü fark 0). Katman dosyası bu yüzden seçildi.
- `deploy/Caddyfile`: `trusted_proxies static {$CADDY_TRUSTED_PROXIES:172.30.0.128/32}`; `import robots_{$ROBOTS_NOINDEX:0}` —
  `robots_0` boş, `robots_1` = her yanıta `X-Robots-Tag: noindex, nofollow` + `/robots.txt` 200 `Disallow: /`. Ayrıştırma anında
  seçildiği için prod adapt JSON'u değişmez; 0/1 dışı değer Caddy'yi açtırmaz.
- `.env.example`: yeni anahtarlar boş + açıklamalı. **Sapma:** görevde `deploy/.env.example` geçiyor; repoda yok, deploy `.env`'i kök
  `.env.example`'dan üretilir (compose başlığı, CI). `COMPOSE_PROJECT_NAME`/`COMPOSE_FILE` **yorum satırı**: boş `COMPOSE_FILE=`
  satırı compose'u durdurur (denendi: "compose file "" … is invalid"); CI `.env.example`'ı kopyaladığı için kırılırdı.
- `ci.yml` compose adımı: staging katmanı `config --quiet` + prod çıktısında `ROBOTS_NOINDEX` olmadığı kontrolü.
- **Fark 0 kanıtı (yerel, `docker compose config`):** değişiklik öncesi dosyalar scratch'e kopyalandı; `.env.example`'dan sahte
  (sır olmayan) değerlerle iki `.env` (CI biçimi; prod biçimi: `CADDY_BIND=127.0.0.1`, `DEPLOY_ENV=production`, `IMAGE_TAG`, `SITE_HOST`).
  Eski compose + eski örnek ↔ yeni compose + yeni örnek (`deploy/.env` ile varsayılan yükleme ve `--env-file`): **iki biçimde de
  `diff` boş (258 satır)**; eski compose + yeni `.env` de aynı. Caddy `caddy adapt` (prod env) öncesi/sonrası JSON `diff` boş
  (1318 satır). Staging `.env` ile: `name: remote-stg`, 4460/4461, 172.30.1.x, `CADDY_TRUSTED_PROXIES`, `ROBOTS_NOINDEX: "1"`;
  `CADDY_TRUSTED_PROXIES` eksikse compose durur.

**C2 — betiklerde proje adı, ortam kilidi, ikinci izleme örneği**

- `backup.sh`/`restore.sh` zaten `docker compose ps -q mysql` ile çözüyordu (sabit ad yok); değişmedi. `RESTORE_EXPECT_PROJECT`
  (vars. `remote`) ve `DEPLOY_ENV` = `--target` = manifest env kilidi korunur. Sabit `remote-mysql-1` yalnız runbook komutlarındaydı
  → `CONTAINER=$(docker compose ps -q mysql)` (5 yer). `check-app-grants.sh` `CONTAINER` girdisi zaten parametreli.
- Yeni şablon birimler `deploy/backup/remote-backup@.service`, `remote-backup@.timer` (03:30), `remote-backup-failed@.service`
  (`/opt/remote-%i/deploy/backup/backup.sh`, `SyslogIdentifier=remote-backup-%i`). Prod birimleri değişmedi.
- `test-backup-inner.sh` bölüm **H**: staging dizini (compose `name:` bilerek yanlış, `.env` `COMPOSE_PROJECT_NAME` doğru) yedek alır;
  staging yedeği prod dizininde `--target staging` ve `--target production` ile, prod yedeği staging dizininde **reddedilir**,
  canlıya dokunulmaz.
- `remote-watch.sh`: `install|uninstall|run <örnek>`; şablon `remote-watch@.service/.timer`; `/etc/remote-watch/<örnek>.env`,
  durum `/var/lib/remote-watch/<örnek>/`, etiket `remote-watch-<örnek>`, alarm metni `remote-watch[<örnek>] …`. Örnekte
  varsayılanlar örnek adından türer; `WATCH_PUBLIC_HOST` zorunlu; yeni `WATCH_TURN_CHECKS` (örnekte 0: coturn prod'da izlenir).
  `systemd-failed`: prod örneği `@` birimlerini, örnek yalnız `@<örnek>.` birimlerini sayar (alarm karışmaz). Prod örneğinin
  davranışı ve mesajları değişmedi (mevcut testler aynen geçti).
- **Ek (mimaride yoktu, gerekçe G-P13b-3):** staging Caddy `127.0.0.1:4461` de XFF'e güvenir → yerel süreçler sahteleyebilirdi.
  `proxy-guard.sh` `PROXY_GUARD_PORT` virgüllü liste (en çok 4) kabul eder; tek port kural metni öncekiyle aynı (testle kanıt).
- **Ek (C4 yayın yolu):** `verify-and-publish.sh` `--stg-run <run-id>` (artifact `agent-win-stg`, main + workflow_dispatch + success,
  build-meta adresi staging, attestation `--source-ref refs/heads/main`; volume'a `NoktaDestek.exe` adıyla). `apply` ortam kilidi:
  `stg-` etiketi yalnız `DEPLOY_ENV=staging`; `DEPLOY_ENV=production` hedefe yalnız `vX.Y.Z`; staging hedefe Release/main push exe'si
  (prod adresi gömülü) yazılmaz. `agent_downloads` volume adı çözülemezse artık **durur** (eskiden `remote_agent_downloads`'a
  düşerdi: staging dizininden prod volume'una yazma riski). **Davranış değişikliği:** prod'a `--run`/`--dir` yayını artık reddedilir
  (runbook prod akışı zaten yalnız `--tag`).

**C4 — `agent-win.yml`**

- `workflow_dispatch` girdileri: `server_url` (choice: `yer-tutucu` | `https://stg.remote.noktabilisim.net`, vars. yer-tutucu = eski
  davranış) ve `version` (x.y.z). Betik ayrıca doğrular: adres yalnız `STG_SERVER_URL`, ref yalnız `refs/heads/main`, sürüm x.y.z.
  Girdiler `env:` ile verilir (ifade enjeksiyonu yok). S6-4 korunur: PR ve main dışı dallar gerçek adres üretmez.
- `reproducible` job build-meta'ya bakar: staging adresi → `NoktaDestek-stg-<sürüm>.exe`, artifact `agent-win-stg`; değilse
  `NoktaDestek.exe`/`agent-win` (değişmedi). `attest` job artifact/exe adını `needs.reproducible.outputs`'tan alır.
  `release` job (`if: github.ref_type == 'tag'`, `agent-win` artifact'ı) **değişmedi**; dispatch dal ref'inde koştuğu için Release'e
  hiç girmez. Yeni action yok. actionlint (rhysd/actionlint 1.7.7, shellcheck dahil) `agent-win.yml` + `ci.yml`: 0 bulgu.

**Doğrulama (yerel, 2026-11-15)**

- shellcheck (`koalaman/shellcheck:stable`, `-S warning`): değişen/yeni betiklerde 0 uyarı; bilgi notları mevcut stille aynı türde.
- `deploy/test-caddy.sh` 66/66 (yeni: prod'da X-Robots-Tag/robots Disallow yok; staging katmanında başlık, `/robots.txt`, proxy
  yanıtında başlık, `trusted_proxies` = 172.30.1.128/32). `deploy/ops/test-watch.sh` 57/57 (yeni stg örneği 8 madde).
  `deploy/ops/test-proxy-guard.sh` 44/44 (yeni çok port 10 madde). `deploy/backup/test-backup.sh` 60/60 (yeni bölüm H 4 madde).
  `verify-and-publish.sh --apply` ortam kilidi `AGENT_PUBLISH_RESTART=0` ile 6 durumda elle denendi.
- Test konteynerleri benzersiz adlı (`rs-p13c-*`, `rstb*`, `rs-pguard-test-*`, `rs-watch-test-*`, `remote-caddy-test*`), bitince silindi.

**Kalan / bekleyen:** C3 kurulum, kaynak ölçümü (§21.2), C5 duman testi, C6 `CLAUDE.md` satırı (kullanıcı).

### P13c — devops düzeltme turu 1 (QA Tur 1 + güvenlik S13C-1/2/3/5; 2026-11-15)

- **QA 1 (runbook):** §11.5/§11.6 P13c kilidine göre yeniden yazıldı (prod yalnız `--tag`; staging `--stg-run`/`--dir`; `--run` ve
  `--allow-failed-run` yalnız `--local`); §11.7 tablosuna 7 yeni ret mesajı; §20.8 geri dönüşüne istemci ve yedek yolu notu.
- **QA 2 (betik metni):** `verify-and-publish.sh` kullanım metni kilitle uyumlu; `usage()` artık `set -euo`'ya kadar tüm başlığı basar.
- **S13C-3 (fail-closed):** `apply` `DEPLOY_ENV`'i `lib.sh deploy_env_of` ile aynı mantıkla ayrıştırır (betik sunucuya tek başına
  gittiği için kopya); boş/bilinmeyen/satır yok → RET. `development` `stg-*` dışında hepsini kabul eder (yerel prova).
- **S13C-1:** `docker-compose.staging.yml` `name: remote-stg`. `apply` hedefin compose proje adını (`docker compose config
--no-interpolate`, sır gerekmez) ortamla eşleştirir: production ⇒ `remote`, staging ⇒ `remote` değil. **Tek istisna (gerekçe):**
  §20.8 geri dönüşü P13c öncesi staging'i proje `remote` ile geri getirir; kilit orada istemci yayınını tamamen engellerdi. Hedef
  `.env`'de bilinçli `AGENT_PUBLISH_LEGACY_STAGING=1` varken staging + `remote` yalnız `vX.Y.Z` Release kabul eder (uyarı basar).
  Prod `docker compose config` farkı yine 0 (yeni `.env.example` ile CI ve prod biçimi).
- **S13C-2:** `remote-backup@.service` ve `remote-backup-failed@.service` `Environment=` ile `BACKUP_DIR`, `BACKUP_STATUS_FILE`,
  `BACKUP_SIGNING_KEY` (`-%i` yolları) ve `BACKUP_UNIT_NAME` zorlar (systemd ortamı `backup.env`'i ezer). `lib.sh`
  `nonprod_paths_guard`: `DEPLOY_ENV != production` iken prod varsayılan yollarından biri görülürse `backup.sh` (normal ve
  `--reset-audit-baseline`) trap/status'tan **önce** durur → prod `status.prom`'a yazılmaz. `--alert` metni `BACKUP_UNIT_NAME`'e
  işaret eder (önceki "Sonra" notu kapandı). **Davranış etkisi:** test ortamı (`DEPLOY_ENV=staging`) artık `-t` yollarını kullanır.
- **S13C-5:** runbook §21.3/8 `remote-watch.sh install stg` prod ağacından (`/opt/remote/deploy/ops`).
- **Test:** yeni `deploy/agent/test-publish-lock.sh` (konteynersiz, `docker compose config` + `AGENT_PUBLISH_RESTART=0`) 20/20;
  `deploy/backup/test-backup.sh` bölüm I (S13C-2) eklendi; shellcheck `-S warning` 0. S13C-4 ve S13C-6 "Sonra".

### P13c — devops düzeltme turu 2 (S13C-13 regresyonu; 2026-11-15)

- **Sorun:** `nonprod_paths_guard` `DEPLOY_ENV != production` iken her zaman çalışıyordu. Bugünkü tek sunucu (§20 terfisine kadar
  `/opt/remote/deploy`, `DEPLOY_ENV=staging`, proje `remote`, şablonsuz `remote-backup.service`, prod varsayılan yolları) gecelik
  yedeği durdururdu.
- **Düzeltme:** koruma yalnız **ikinci yığında** çalışır. Ölçütlerden biri yeterli: (1) birim şablon örneği
  (`BACKUP_UNIT_NAME=remote-backup@…`, şablon `Environment=` ile verir); (2) compose projesi birincil ad (`remote`) değil.
  Proje adı sırsız çözülür (`docker compose config --no-interpolate`, verify-and-publish ile aynı); çözülemezse ikinci yığın sayılır
  (fail-closed). **Gerekçe:** birincil ölçüt proje adı. Elle `backup.sh`/`restore.sh` çalıştırmada birim adı yoktur, dizin yolu
  ise taşınabilir; proje adı ise yedeğin hangi yığının konteynerinden alındığını belirleyen değerin kendisidir (`docker compose ps`
  aynı adı kullanır). Şablon ölçütü bunu tamamlar: proje adı yanlış ayarlanmış (remote) bir staging örneği de prod yollarına düşemez.
  `BACKUP_PRIMARY_PROJECT` (vars. `remote`) yalnız test içindir (bu makinede gerçek `remote` projesi başlatılmaz).
- **Publish ile tutarlılık:** önceki turdaki `AGENT_PUBLISH_LEGACY_STAGING=1` bayrağı **kaldırıldı**. Tek yığın staging (proje
  `remote`) bayraksız yalnız `vX.Y.Z` Release kabul eder; `run-*`/`stg-*`/`dir-*` reddedilir. Bugünkü sunucu hiçbir ayar
  değişikliği olmadan yedek almaya ve `--tag` ile istemci yayınına devam eder. (Not: `docs/guvenlik-raporu.md` bayraklı hâli
  değerlendirmişti; bayraksız hâl güvenlik tarafından yeniden görülmeli.) `.env.example`'daki yorum satırı silindi.
- **Test:** `test-backup.sh` bölüm I'ya iki madde: şablon örneği + prod yolları (proje birincil olsa da) → ret; legacy staging
  (proje birincil, şablonsuz, prod yolları) → yedek geçer, prod `status.prom` yazılır. `test-publish-lock.sh` legacy maddeleri
  bayraksız hâle getirildi. shellcheck `-S warning` 0. Runbook §20.8(a)/(b), §21.3/7, §11.5 tablosu ve §11.7 satırı güncellendi.

### P13c — devops düzeltme turu 3 (QA Tur 2 SIGPIPE + güvenlik S13C-14/15; 2026-11-15)

- **Kök neden (QA 2-1, ara ara 69/70, `adım=audit-sureklilik`):** `set -euo pipefail` altında okuyucusu erken kapanan boru hattı.
  `lib-audit.sh` `find | sort -r | head -n 1`: `head` ilk satırdan sonra çıkar, `sort` kalan çıktıyı yazarken SIGPIPE alır (rc 141),
  pipefail bunu `$(…)` atamasının sonucu yapar, `set -e` betiği `audit-sureklilik` adımında düşürür. Yarış koşulu: sort'un tek
  `write`'ı head kapanmadan biterse sorun çıkmaz; dizin sayısı arttıkça (gecelik yedek, 14 gün saklama) olasılık artar → sunucuda da
  aynı risk. `{ printf; cat sql; } | sql_backup` aynı sınıftan (mysql/docker girdiyi erken kapatırsa yazıcı SIGPIPE).
- **Düzeltme (yalnız akış, davranış aynı):** `| head -n 1` → `| awk 'NR == 1'` (girdinin tamamını okur): `lib-audit.sh` (en yeni
  çalıştırma), `lib.sh` `verify_manifest_sig` (2 yer; SIGPIPE imza doğrulamasını yanlışlıkla FAIL yapabilirdi),
  `verify-and-publish.sh` volume adı; `grep -m1 '^caddy:'` → `awk '/^caddy:/ && !n++'`. SQL besleyen borular → önce değişken,
  sonra here-string (`sql_backup <<<"$sql"`; ayrı yazıcı süreç yok): `lib-audit.sh` audit-continuity, `restore.sh`
  restore-reset-db, `lib-restore.sh` 4 `echo … | sql_migrator`. `lib-restore.sh` hazır bekleme `docker logs | grep -q` → `grep … >/dev/null`
  (döngüde gereksiz yeniden deneme). `remote-watch.sh` `awk | head -1` → `awk '{print; exit}' <<<` (`set -e` yok, risk düşük; tutarlılık).
  Taranan: `deploy/backup`, `deploy/ops`, `deploy/agent`, `deploy/mysql/check-app-grants.sh`; dosya üzerinde `grep -q` (boru yok)
  ve test betikleri (pipefail/`-e` olmadan `&&` zinciri) bırakıldı.
- **S13C-14/15:** compose projesi birincil ad (`remote`) iken `PUBLIC_BASE_URL` host'u ya da `SITE_HOST` `stg.` ile başlıyorsa yığın
  yanlış kurulmuştur (staging `.env`'inde `COMPOSE_PROJECT_NAME`/`COMPOSE_FILE` unutulmuş → prod volume'ları). `backup.sh`
  (`lib.sh stg_name_guard`, `--alert` hariç, trap/status'tan önce) ve `verify-and-publish.sh apply` durur. Değerler sırsız okunur:
  yalnız bu iki anahtar satırı (`env_value_of`, `.env` source edilmez); proje adı `compose_project_of` (`config --no-interpolate`).
  `deploy_env_of` ve `nonprod_paths_guard` aynı yardımcıları kullanır.
- `backup.sh` `STEP=site-disi` tırnaklandı (shellcheck SC2100 yanlış pozitif; değer aynı).
- **Test:** `test-publish-lock.sh` 24/24 (yeni S13C-15 4 madde); `test-backup.sh` bölüm I'ya S13C-14 3 madde; **arka arkaya 3 koşu**
  (sonuçlar aşağıda); `test-watch.sh` GEÇTİ; shellcheck `-S warning` 0.
- **Sonuç:** `test-backup.sh` arka arkaya 3 koşu: 73/73, 73/73, 73/73 (rc 0). Test konteynerleri silindi.

## P14a A0 — devops (Prettier kurulumu + tek seferlik biçimlendirme; AC-218, ADR-0024; 2026-11-15)

- **Bağımlılık:** kök `devDependencies` `prettier` **3.10.1** (MIT, `--save-exact`). Lock'ta yalnız bu paket eklendi.
  ADR-0024'teki `eslint-config-prettier` **eklenmedi**: üç ESLint yapılandırmasında (`@eslint/js` recommended,
  `typescript-eslint` strict, `eslint-config-next`) biçim kuralı yok; çakışma olmadığı `pnpm -r run lint` ile doğrulandı.
  Biçim kuralı eklenirse o gün eklenir.
- **Seçenekler (`.prettierrc`):** printWidth 140, çift tırnak, noktalı virgül, trailingComma all, arrowParens always,
  LF, `proseWrap: preserve`, `embeddedLanguageFormatting: off`. Ölçüm (446 dosyalık kapsamda değişen satır):
  140 → +23.1k/−9.2k; 120 → +30.8k; tek tırnak → +42k; `semi:false` → +55k; `arrowParens: avoid` / `bracketSpacing:false` /
  `trailingComma: es5` hepsi daha büyük fark. 160–200 daha küçük fark verir ama ADR-0024 140 dedi ve satır okunurluğu için 140 tutuldu.
  `embeddedLanguageFormatting: off`: dokümanlardaki sıkıştırılmış JSON/TS örnekleri (ör. `docs/api.md`) olduğu gibi kalır.
  `proseWrap: preserve`: elle kırılmış Markdown paragrafları birleştirilmez (`never` 2.800+ satırı tek satıra çekiyordu).
- **Hariç (`.prettierignore`, ayrıca `.gitignore`'daki her şey):** build/test çıktıları, `apps/web/next-env.d.ts`,
  `pnpm-lock.yaml`, `apps/agent-win/` (gofmt), `apps/server/prisma/migrations/`, `apps/server/src/generated/`,
  `*.yml`/`*.yaml` (ADR kapsamı TS/JS/JSON/MD/CSS; CI/compose dosyaları elle bakılır), `docs/pdf/`, `docs/img/`
  (ölçüm/ekran çıktıları), `docs/test-raporu/` (test-operatoru kanıt betikleri), `docs/tasarim/` (statik prototip),
  `docs/arsiv/`. `packages/contracts/fixtures/*.json` dahil (Go testleri `json.Unmarshal` ile okur, biçimden bağımsız).
- **Markdown tablo koruması:** Prettier tabloları hizalar (görünüm değişmez). Ancak 107 yerde tablonun son satırından
  hemen sonra boş satırsız metin vardı; GFM bunu zaten tablo satırı olarak gösteriyordu ve Prettier bunu `| metin |`
  satırına çevirip sütunu yüzlerce karakter genişletiyordu. Biçimlendirmeden önce bu 107 yere **boş satır** eklendi
  (yazarın niyeti: tablo biter, paragraf başlar). Tek içerik düzeltmesi: `docs/db-notlari.md` "Up guard" satırında
  `smtp_*/totp_*` → `` `smtp_*`/`totp_*` `` (Prettier bunu vurgu olarak okuyup `smtp__/totp__` yapıyordu).
- **Doğrulama:** 66 Markdown dosyası `marked` (GFM) ile biçim öncesi/sonrası HTML'e çevrilip karşılaştırıldı; kalan
  farklar zararsız: liste içi boşluk (sıkı → gevşek liste, `guvenlik-raporu.md`), satır sonu boşluğu, `api.md`'de
  satır başındaki "5." (CommonMark'a göre zaten paragraf; marked liste sanıyordu). Prettier iki dosyada (`p5-collab.spec.ts`,
  `db-notlari.md`) ikinci geçişte sabitlendi; `pnpm format:check` 0 fark.
- **CI:** `quality` işinde `pnpm format:check`, lint'ten önce. Yeni Action/izin yok.
- **Kullanım:** `pnpm format` (yaz), `pnpm format:check` (denetle). Ajanlar kendiliğinden `pnpm format` çalıştırmaz;
  değiştirdikleri dosyaları `pnpm exec prettier --write <dosya>` ile biçimler. Blame: `git config blame.ignoreRevsFile .git-blame-ignore-revs`.
- **Test:** `pnpm format:check` temiz; `pnpm -r run lint` 0 hata; `pnpm -r run typecheck` temiz; birim: contracts 78/78,
  web 271/271, server 368/368. MySQL entegrasyon (`test:int`) ve e2e yerelde koşulmadı (CI'da koşar).

## P14a A5 — devops (CI shellcheck/actionlint, kararlılık koşusu, AC-208/212 alarmları, CI build düzeltmesi; devops, 2026-11-15)

Kapsam: mimari-e11 §4.4, §4.6 A5; AC-219 (CI kısmı), AC-208/212 (runbook + izleme). Ayrıntılı işletim: runbook §22.

| Dosya                                                              | Değişiklik                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.github/workflows/ci.yml`                                         | Yeni iş `shellcheck + actionlint` (shellcheck 0.11.0 `-S warning`, `deploy/**/*.sh` + `scripts/*.sh`; actionlint 1.7.8; imajlar digest ile, ek Action yok, izin `contents: read`). `build` → "compose yapılandırması geçerli": `APP_ENCRYPTION_KEYS` için CI'ya özgü sahte değer (32 sıfır bayt) |
| `.github/workflows/stability.yml` (yeni)                           | `workflow_dispatch` (`runs`, varsayılan 20) + haftalık cron; iki iş: entegrasyon (MySQL servis, ci.yml test işiyle aynı hazırlık) ve e2e; Action'lar SHA ile, izin `contents: read`, secret yok                                                                                                  |
| `scripts/repeat-tests.sh` (yeni)                                   | `<n> [int\|e2e\|all]`: vitest `test/integration` n ayrı süreç (`--retry 0`), Playwright `--repeat-each n --retries 0`; düşen koşu/test adları + `SONUÇ: x/y`                                                                                                                                     |
| `deploy/ops/remote-watch.sh`, `test-watch.sh`, `watch.env.example` | Kontroller `guest-code-prefix` (≥15 dk'da +20) ve `mysql-test-failed` (1 sa'te +10); sayaç örnekleri durum dosyasında (90 dk), yeniden başlama farkı, metrik yoksa değerlendirilmez. Eşikler `WATCH_GUEST_PREFIX_MAX` / `WATCH_MYSQL_FAIL_MAX`. 11 yeni test                                     |
| `deploy/turn/test-local.sh`                                        | 2 allocation bant ölçümü `-n 3000` → `-n 8000` + düşerse teklif/saniyelik seri (kararsızlık kök nedeni: kısa örtüşme; eşik aynı, retry yok)                                                                                                                                                      |
| `scripts/e2e-real.sh`                                              | SC2155 (export + komut ikamesi): atama ve `export` ayrıldı; davranış aynı                                                                                                                                                                                                                        |
| `docs/runbook.md`                                                  | §22: CI/kararlılık işletimi, AC-208/212 alarm satırları + izleme yöntemi + elle kontrol, yayın/geri alma                                                                                                                                                                                         |

Kararlar / gerekçeler:

- **shellcheck eşiği `warning`:** mevcut `deploy/**/*.sh` 0 uyarı/hata, 160 not (SC2016 67: bilinçli tek tırnaklı `sh -c '$X'`;
  SC2015 63: `a && pass || fail` test deyimi; SC2031/2030/2094 host-firewall alt kabuk kalıbı; SC2086 `set -- $1` bilinçli
  bölme). Bunları "düzeltmek" davranış riski taşır; `info/style` düşürmez. `scripts/e2e-real.sh`'daki 3 SC2155 uyarısı düzeltildi.
- **Yeni Action yok:** shellcheck/actionlint Docker imajı (digest) ile; runner'daki sürüme bağlı kalınmaz, yerel komut aynıdır.
- **Vitest tekrarı ayrı süreçte** (`--repeats` değil): entegrasyon fikstürleri aynı süreçte tekrarlanınca benzersiz anahtar
  çakışması yapay hata üretebilir; ayrı süreç her koşuyu CI'daki gibi bağımsız tutar.
- **CI `build` kök nedeni:** P10 (f537cbe) compose'a `APP_ENCRYPTION_KEYS:?` ekledi; CI adımı `.env.example`'dan üretilen
  `.env`'e bu anahtarı doldurmuyordu → `docker compose config` "required variable … missing" ile düşüyordu. Prod compose
  değişmedi; yalnız CI'nın sahte `.env` listesi. Yerelde aynı komutlarla doğrulandı (prod + staging katmanı `config --quiet`,
  iki jq koruması, `caddy validate`).
- **remote-watch pencere hassasiyeti:** 10 dk timer → etkin pencere 15 dk kuralı için ~20 dk, 1 sa için ~70 dk (en az pencere;
  biraz daha hassas). Prometheus kurulursa runbook §22.2'deki PromQL birebir kullanılır.

Doğrulama (yerel, 2026-11-15): shellcheck `-S warning` 0 · actionlint 0 (3 iş akışı) · `deploy/ops/test-watch.sh` GEÇTİ (yeni 11
dahil) · `deploy/turn/test-local.sh` (TURN_TEST_CAP=0) 65 PASS + bant: tek 1002000 B/s, 2 allocation 2000400 B/s ·
`repeat-tests.sh` argüman/çıkış kodu (taslak `pnpm` ile 1 düşen koşu → rc 1, `SONUÇ: 3/4`); vitest/playwright bayrakları
gerçek araçla ayrıştı (`--list`: 462 test = 231 × 2) · compose adımı düzeltmeyle geçti. 20 koşuluk `stability` çalıştırması
GitHub'da push sonrası yapılır (commit yok); sonuç qa raporuna.

Açık (bu paketin dışı): CI `e2e` işi de kırmızı (8517725: p7-control AC-47, p8b-requests AC-164 axe light/dark, customers
AC-194 390 px taşma) → frontend-dev. Yeni `shellcheck + actionlint` işi branch korumasında zorunlu kontrol yapılmalı (repo sahibi).

### Kararsız testler

(Boş — AC-219. Kararsız test bulunursa: test adı, koşu/oran, kök neden, düzelten commit. Retry ile gizlemek yasak.)

## P14a A1 / P14b B1 — dba (2026-11-15)

Ayrıntı ve test kayıtları: `docs/db-notlari.md` "P14a".

| Dosya                                                                      | Değişiklik                                                                                                                                                                        |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/prisma/migrations/20261116000000_p14a_security/migration.sql` | Ön kontrol (geçici yordam + `SIGNAL 45000 'P14A_PRECHECK <tablo>=<n>'`). 6 CHECK `$` → `\z` (COPY, tablo başına tek ALTER). `users.version`, `auth_sessions.step_up_at` (INSTANT) |
| `.../down.sql`                                                             | Kalıntı yordamı siler, iki sütunu düşürür, 6 CHECK'i `$`'a döndürür, migration kaydını siler. Guard yok (gevşetme yönünde)                                                        |
| `apps/server/prisma/schema.prisma`                                         | `User.version Int @default(0) @db.UnsignedInt`, `AuthSession.stepUpAt DateTime? @db.DateTime(3)` (`prisma format` ilişki satırlarını hizaladı)                                    |
| `apps/server/test/integration/security-p14a-db.test.ts`                    | Yeni: AC-201 (6 CHECK × `\n` + 8 sonlandırıcı + information_schema), version/step_up_at                                                                                           |
| `deploy/mysql/check-app-grants.sh`                                         | 6 `CHAR(10)` negatifi (393 PASS)                                                                                                                                                  |

- **Migration adı:** `20261116000000_p14a_security`. Son migration `20261115090000`'den ve bugünden sonra sıralanıyor.
- **SIGNAL için saklı yordam:** SIGNAL saklı program dışında geçersiz. Ön kontrol sayıları tablo bazında veriyor (mimarideki `<tablo>=<n>` biçimi). Sütun bazında döküm sorgusu db-notlari'nde.
- **grants.sql değişmedi:** yeni tablo yok, tablo düzeyi UPDATE yeni sütunları kapsıyor.
- **B1:** `tenants(name)` indeksi **eklenmedi**. Gerekçe: 250 firmada tam tarama 0,1 ms, 10.000 firmada 2,6 ms; içerir araması B-tree kullanamıyor. Eşik ve backend (B2) notları db-notlari'nde.
- **Backend'e (A2):** `version` artışı koşullu `UPDATE users SET …, version = version + 1 WHERE id = ? AND version = ?` ile yapılmalı (etkilenen 0 → 409 `STALE_WRITE`). Prisma'da `updateMany({ where: { id, version }, data: { version: { increment: 1 } } })`. `step_up_at` UTC yazılır.
- **Açık bulgu (mimara, kapsam dışı):** 4 e-posta CHECK'i de sondaki tek satır sonlandırıcıyı (`\n`, `\r\n` …) kabul ediyor. `tenant_settings_smtp_from_email_chk` SMTP başlığına gidiyor. Öneri P15 dba: aynı kalıpla `\z`.

## P14b B3 — frontend (bölüm 1) (frontend-dev, 2026-11-15)

Kapsam: mimari-e11 §5.1 AC-220, 221, 222, 223, 224, 227, 228, 229, 230 + koordinatör ek işi (CI web e2e 4 kırmızı test).
**AC-225/226 yapılmadı** (backend uçları `GET /users/options`, `GET /admin/tenants/options` henüz yok; B2 sonrası ayrı iş).
Tasarım skill'i (`ui-ux-pro-max`) mevcut; değişiklikler DESIGN.md token/primitifleriyle yapıldı, yeni primitif yok.

### Rotalar

| Yol                                 | Auth                                              | Ne yapar                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/settings/general` (yeni)          | evet, `settings.view` (düzenleme `settings.edit`) | Ayarlar > Genel: kod geçerliliği (15–30 dk), en uzun oturum (1–8 sa), açık oturum sınırı (1–10), dosya sınırı (1–2048 MB); PUT `/settings/tenant` |
| `/users/<yok>` , `/customers/<yok>` | evet                                              | Artık gerçek HTTP 404 + tek h1 "Kullanıcı bulunamadı" / "Müşteri bulunamadı" (AC-220)                                                             |

### AC → yapılan

- **AC-220 (404):** Kök neden `curl -I` ile doğrulandı: düzeltme öncesi `/users/01JKS…ZZ`, `/users/abc`, `/customers/01JKS…ZZ` → **200**.
  Neden mimaridekiyle aynı: `(panel)/loading.tsx` ve `[id]/loading.tsx` Suspense sınırı yanıtı akışla 200 başlatıyordu. **Ek bulgu:**
  liste segmentinin `users/loading.tsx` / `customers/loading.tsx` dosyası da `[id]` alt segmentini sarıyordu (loading.tsx tüm alt
  ağacı sarar). Yapılan: `(panel)/loading.tsx`, `users/[id]/loading.tsx`, `customers/[id]/loading.tsx` silindi; liste sayfası ve
  iskeleti `users/(list)/`, `customers/(list)/` route group'una taşındı (URL değişmez, iskelet yalnız listeyi sarar);
  `[id]/not-found.tsx` → `users/not-found.tsx`, `customers/not-found.tsx`; `EmptyState` `headingLevel={1}` ile tek h1. Sonrası
  `curl`: üçü de **404**, var olan kayıt ve listeler 200. **Sapma:** mimarideki `[id]/layout.tsx` varlık kontrolü yazılmadı — sayfa
  zaten Suspense sınırı olmadan `notFound()` çağırıyor, 404 için yeterli; `users/[id]/page.tsx`'e dokunulmadı (A4 çakışması).
  **Not:** React SSR'da hata sınırı çalışmadığından Next 404'te `<html id="__next_error__">` kabuğu döner ve not-found içeriğini RSC
  yükünden istemcide çizer (`<title>` sunucuda var); JS'li tarayıcıda tek h1 görünür (e2e doğrular). Genel panel iskeleti kalktığı için
  ayarlar sayfalarına `settings/loading.tsx` eklendi (o segmentte `[id]` yok). `history/[id]` aynı kalıpta 200 dönmeye devam ediyor
  (`history/loading.tsx` alt segmenti sarıyor) — AC kapsamında değil, aynı route group düzeltmesiyle kapatılabilir (öneri).
- **AC-221:** `--rs-switch-track-off` / `--rs-switch-track-locked` (açık #717d8a/#7b8794, koyu #7b8794/#66717e), üç koyu seçicide aynı;
  Tailwind `bg-switch-track-*`. `Track` kapalı/kilitli rayda bu token'ları kullanır; kilitli `ToggleSwitch`'te `opacity-60` kaldırıldı
  (kontrastı düşürüyordu). Birim testi `lib/switch-contrast.test.ts` değerleri `globals.css`'ten okuyup surface/surface-muted/canvas
  zemininde ≥ 3:1 hesaplar. DESIGN.md §2 ve §6 güncellendi.
- **AC-222:** `side-nav.tsx`: rota değişince etkin öğe yatay şeritte "nearest" mantığıyla görünür alana alınır (animasyonsuz;
  `scrollIntoView` yerine yalnız `scrollLeft` — sayfa dikeyde kaymasın, maske genişliği kadar pay). Kaydırma ipucu: `globals.css`
  `.scroll-hint-x[data-more-start|end]` kenar `mask-image` + `aria-hidden` `ChevronLeft/Right`; md+ dikey menüde yok.
- **AC-223:** `status=all` boşken varsayılan boş durum ("Yeni müşteri" + yardım); pasif filtre boş durumu ayrı kalır. Yardım ve form
  diyaloğu `CustomersActionsProvider` ile sayfa düzeyinde tek örnek; tetikleyiciler bağlamdan açar. **Sapma:** mimari "ref'le açar"
  diyor; React bağlamı aynı sonucu verir (odak native `<dialog>` ile tetikleyene döner).
- **AC-224:** `/settings/general` (`limits-form.tsx`): istemci doğrulaması contracts `updateTenantSettingsInputSchema` ile
  (`lib/account/limits.ts`), ilk hatalı alana odak, istek gitmez; yalnız değişen alanlar gönderilir; 400 `fields.*` alana, diğer hata
  form üstüne; SaveBar + ayrılma uyarısı; salt okunurda alanlar pasif + uyarı; GET hatası `LoadError`; iskelet `settings/loading.tsx`.
  **Audit:** sunucu `updateTenantSettings` bu dört alanı `SCALARS` içinde zaten eski→yeni yazıyor — backend'e ek iş yok.
- **AC-227:** `contracts/dc.ts` `CHAT_SEND_PER_SEC = 5`. Gönderen: `chatSendLimiter()` (kayan 1 sn penceresi, mevcut `RateWindow`;
  **sapma:** mimari "token bucket" diyor — token bucket 1 sn penceresinde 2×'e kadar izin verebildiği için alıcı penceresini aşabilirdi;
  kayan pencere daha sıkı). Aşımda `sendChat` → `"rate"`; mesaj gönderilmez/kuyruğa alınmaz, metin girişte kalır, giriş altında
  `role=status` "Çok hızlı yazıyorsunuz…". Alıcı `IN_LIMITS.chat` = 2 × gönderen (10/sn): ağ gecikmesinde sıkışan meşru mesaj düşmez
  (birim testi rastgele gecikmeli simülasyonla 0 düşme doğrular). `sendChat` dönüş tipi `boolean` → `"sent" | "rate" | "error"`.
- **AC-228:** Davranış P8b'de `useLeaveGuard`'a eklenmişti (nöbetçi `pushState`, `popstate` → diyalog, vazgeçte yeniden itme,
  `beforeunload`); AC-63 testi kapsıyordu. Kod değişmedi; AC-228 adlı e2e eklendi (istemci gezinmesi → not → geri → başlık
  "Kaydedilmemiş değişiklikler var", Esc ile kal, ikinci geri yine yakalanır, "Kaydetmeden ayrıl").
- **AC-229:** `precheckFile`: `file.type === ""` ise `.png .jpg .jpeg .webp` uzantısıyla ön kabul; bildirilen izinsiz MIME (SVG) yine
  red; `accept` özniteliğine uzantılar eklendi (MIME eşlemesi olmayan sistemde seçicide görünsün). Karar sunucuda (magic bytes).
- **AC-230:** `shouldWarnLargeWrite(bytes, streamToDisk?)` (`lib/dc/files.ts`); `files-panel.tsx` bunu kullanır. Projede DOM bileşen
  test altyapısı (RTL/jsdom) yok; eşik altı/tam eşik/üstü ve disk-akışı yok durumları saf fonksiyon testinde.

### CI web e2e — 4 kırmızı testin kök nedeni (52518ac'den beri)

1. **AC-164 (p8b-requests, light+dark) ve AC-194 (customers, mobil): 390 px'te 2 px taşma.** Yerelde geçiyordu; Linux font metriğiyle
   (Verdana zorlanarak, DejaVu Sans ile aynı genişlik sınıfı) yeniden üretildi. Kök neden: mobil menü `<ul overflow-x-auto>` içindeki
   sayaç rozetinin `sr-only` metni `position:absolute`; içerme bloğu kaydırma kapsayıcısı olmadığından kayan şeridin dışındaki öğede
   kırpılmıyor ve belgeyi taşırıyordu (geniş fontta öğe 390 px'in hemen dışına düşüyor). Düzeltme: `<ul>`'ye `relative` (CSS; test
   değişmedi). Doğrulama: aynı tanıda 5 sayfada taşma 2 → 0. Kalıcı regresyon: `p14b-ui.spec.ts` "CI 390 px taşması" (yalnız o blokta
   `bypassCSP` ile geniş font).
2. **AC-47/48/49/99/50 (p7-control): `strip.height ≤ 64`, CI 113.** Gerçek kırılma: kontrol sırasında şerit 580 px, içerik
   (Kontrol sizde 109 + Kontrolü bırak 157 + Özel tuşlar 149 + Görünüm 140 + boşluklar) Linux fontunda 595 px. Kök neden: `compact`
   kararı sabit piksel eşiğine (`COMPACT_BELOW_PX`) bağlı, font metriğine değil. Düzeltme (`stage.tsx`): her çizimden sonra
   `useLayoutEffect` şerit öğelerinin tek satırda olup olmadığını ölçer; kırılıyorsa "Görünüm" menü etiketi `sr-only` olur (ikon + ok
   kalır, `title` ipucu), genişlik değişince yeniden ölçülür. Test eşiği değiştirilmedi.
   **Doğrulanamadı:** düzeltme sonrası e2e koşusu başlatılamadı — paralel bir değişiklik (`MysqlSettingsView.requireTls`, contracts)
   `apps/web/lib/admin-settings/admin-settings.test.ts`'i tip hatasına soktu, `next build` "Failed to type check" ile duruyor
   (A4/backend alanı, dokunulmadı). Bu düzeltildikten sonra `p7-control` ve `p14b-ui` koşulmalı.

### Değişen / eklenen dosyalar (web + contracts)

`app/(panel)/{users,customers}/(list)/{page,loading}.tsx` (taşındı), `{users,customers}/not-found.tsx` (taşındı), silinen
`(panel)/loading.tsx`, `users/[id]/loading.tsx`, `customers/[id]/loading.tsx`; `customers/customers-actions.tsx`, `side-nav.tsx`,
`settings/{settings-tabs.tsx,loading.tsx,general/page.tsx,general/limits-form.tsx}`, `app/globals.css`, `components/ui/{switch,empty-state}.tsx`,
`components/collab/{chat-panel,files-panel}.tsx`, `components/console/stage.tsx`, `lib/account/limits.ts`, `lib/branding/image.ts`,
`lib/dc/{rate,files,use-collab}.ts`, `messages/tr.json`, `packages/contracts/src/dc.ts`; testler `lib/switch-contrast.test.ts`,
`lib/account/limits.test.ts`, `lib/dc/{chat-rate,large-write}.test.ts`, `lib/branding/branding.test.ts`, `lib/dc/p5-guvenlik.test.ts`,
`e2e/p14b-ui.spec.ts` (yeni), `e2e/{customers,p12-branding,p5-collab}.spec.ts`, `e2e/mock-account.mjs` (`u-accbad-*`, sınır alanları,
`maxFileMb 2047` sunucu alan hatası). DESIGN.md (token, ikon, `EmptyState.headingLevel`).

## P14a A3 — backend

Kapsam: mimari-e11 §4.2 AC-208..213, 216 (sunucu) + §4.3 sunucu maddeleri (AC-217). A2 (users/tenants/auth) dosyalarına
dokunulmadı.

**Değişen dosyalar**

- `src/sessions/public.ts`, `src/app.ts`, `src/ops/metrics.ts` — AC-208: `rs_guest_code_rate_limited_total{scope: ip|prefix}`
  (kod yolu ve agent indirme ucu ortak kovası; kilitli kova başına bir sayım). `createPublicLimits(log, cidr, metrics)`.
  `rs_mysql_test_failed_total{class}` da kaydedildi; ikisi de `/metrics`'te sıfırla yayımlanır.
- `src/requests/service.ts` — AC-209: sıra ön bakış → **kapı** (503 NOT_READY) → IP/önek/net48 kovaları → zod → … → TX →
  **commit sonrası** tenant kovası `add`. Tenant kovası TX öncesi yalnız okunur (reddi aynen). Ref/kayıt çözülemezse TX'e
  varılmadığı için kapı kullanılmaz (tek 404 yolu değişmedi). Kabul edilen not: tenant kovası okuma/sayım arasında tenant başına
  en çok `perKey` (2) talep taşabilir.
- `src/requests/ws.ts`, `src/requests/limits.ts` — AC-210: `/ws/request` `wsUpgrade` sayımı güven belirlendikten sonra, yalnız
  güvenilmeyen IP için; zaten kilitli anahtar baştan (sayımsız) reddedilir; `refInvalid` kovası aynen. AC-216: `/ws/panel`
  `panelSession` kovası (oturum token'ının SHA-256'sı, 30/dk); aşımda upgrade kabul + `close(4429, "retry=<sn>")` (kalan kilit
  süresi), `rs_ws_rejected_total{role="panel",reason="session_rate"}`. IP kovası (HTTP 429) değişmedi.
- `src/lib/netguard.ts` — `classifyIp` / `classifyHost` (loopback | private | public | unresolved; tek çözümleme, ilk IP döner).
- `src/settings/mysql-probe.ts`, `src/settings/system.ts`, `src/settings/routes.ts` (yalnız `systemDeps`'e `metrics`) — AC-211:
  `requireTls` saklanır/döner; değişmeyen kayıt karşılaştırmasına girer. Test bağlantısı çözülen IP'ye yapılır (rebinding yok);
  `requireTls` → `ssl:{rejectUnauthorized:true, servername, checkServerIdentity(ayar adı)}`, açık anahtar isteği kapalı. TLS
  yokken `allowPublicKeyRetrieval` yalnız loopback/özel/tek etiketli adda. Sınıf `tls`: 45023 (sunucu TLS'siz), 3159, sertifika/
  TLS kodları. AC-212: `rs_mysql_test_failed_total{class: connect|auth|tls|timeout|other}` (database/secret_unreadable → other).
- `prisma/migrations/20261116010000_p14a_mysql_tls/{migration,down}.sql` — **sapma (gerekçeli, mimari-e11 §4.1 notu):** P11
  `system_settings_mysql_chk` JSON şeması ek anahtarı reddediyordu; yalnız isteğe bağlı `requireTls: boolean` eklendi.
- `src/requests/jobs.ts`, `src/customers/service.ts`, `src/bindings/service.ts` — AC-217: çağrılmayan global sarmalayıcılar
  (`anonymizeRequests`, `anonymizeCustomers`, `expireIdleBindings`) silindi; testler `test/helpers/retention.ts` ile `*Of`
  fonksiyonlarını kullanır. `bindings/service.ts` varsayılan 365 → `RETENTION_DEFAULT_DAYS`.
- `packages/contracts`: `api/system-settings.ts` (`requireTls`, `MysqlSettingsView.requireTls`, `tls` nedeni + mesajı),
  `ws-request.ts` (`WS_PANEL_UPGRADES_PER_MIN`, `panelRetryReason`, `parsePanelRetry`), `api/tenants.ts`
  (`RETENTION_DEFAULT_DAYS = 365`), `audit.ts` (`SYSTEM_AUDIT` JSDoc koda uyduruldu: servis `"changed"` yazar, mask.ts `***`).
  `canonicalWaUrl` contracts'ta zaten vardı ve sunucu `waServiceUrlSchema` üzerinden kullanıyor (ek kod gerekmedi).
- `vitest.config.ts` — `p14a-a3-settings.test.ts` paylaşılan `system_settings` satırlarını yazdığı için seri projede.
- Web (koordinatör isteğiyle asgari): `apps/web/lib/admin-settings/admin-settings.test.ts` fixture'ına `requireTls`;
  `apps/web/lib/startup-check.test.ts` (AC-217 startup-check birim testi; yeni dosya).

**Testler (adında AC no)**: `test/unit/p14a-a3.test.ts` (208, 211, 212, 216), `test/integration/p14a-a3.test.ts` (208 /metrics,
209 beş 503 → 201 + tenant kovası, 210 35 güvenilen upgrade / 31. güvenilmeyen 429, 211 sahte TLS'siz MySQL ve gerçek MySQL
kendinden imzalı sertifika → `tls`, 212 metrik, 216 30 upgrade → 31. kapanış 4429 `retry=` + ayrı oturum etkilenmez),
`test/integration/p14a-a3-settings.test.ts` (211 kalıcılık + DB CHECK, 217 değişmeyen mysql/turn → audit yok, `password/secret:"***"`,
`tenant_settings.*` filtresi `_`'yi harfiyen eşler), `test/integration/mail-starttls-p14a.test.ts` (213: 587 STARTTLS doğru ad
gönderir; yanlış ad → `tls`, ileti 0; STARTTLS ilan etmeyen sunucuda nodemailer `requireTLS` yine yükseltir → ileti yalnız TLS
oturumunda; STARTTLS'i hiç desteklemeyen → `tls`, ileti 0), `packages/contracts/test/p14a-a3-contracts.test.ts`.
Güncellenen: `settings-p11` (görünüm/probe şekline `requireTls:false`), `unit/p11` (probe imzası), retention testleri (yardımcı).

**Bağımlılık:** yeni yok (`smtp-server` MIT P10'dan beri devDependency).

**Komutlar ve sonuç (2026-11-15, geçici konteyner `rs-p14a-a3-q7m2`, iş sonunda silindi):**
`pnpm --filter @remote/server lint` temiz · contracts/web lint + typecheck temiz · server `test` 23 dosya / 376 test geçti ·
contracts 84 · web 31 dosya / 308 test · server `test:int` 61 dosya: 587 geçti, 7 düştü — A3 kapsamındaki dosyaların hepsi
yeşil; düşenler A2'nin süren işine ait (`security-p14a-auth` AC-215 kurtarma kodu, `whatsapp-admin-p12b` iki test
`mfa/setup` yanıtı); `settings-p11` güncellemeden sonra 14/14. Server `typecheck`: yalnız A2'nin `security-p14a-users.test.ts`
dosyasında 1 tip hatası (A3 dosyalarında yok).

**frontend-dev'in bilmesi gerekenler (A4)**

- `GET/PUT /admin/settings/mysql`: yanıtta `requireTls: boolean`; PUT/test gövdesinde `requireTls` (yoksa false). Form bu alanı
  göndermezse kayıtlı `true` değeri `false`'a döner → "TLS gerekli" kutusu A4'te eklenmeli. Test yanıtında yeni mesaj sınıfı `tls`.
- `/ws/panel` kapanışı `4429`: gerekçe `retry=<sn>` → `parsePanelRetry(reason)` ile bekle (± %20 jitter); `too_many` (kullanıcı
  başına 6. soket) `null` döner.
- `RETENTION_DEFAULT_DAYS` ve `canonicalWaUrl` contracts'tan alınabilir (web kopyaları A4'te kaldırılacak; web'in "geçersizse ham
  değer" davranışı için `canonicalWaUrl(normalizeWaUrl(v)) ?? normalizeWaUrl(v)`).
- Devops (A5): runbook alarmları — `rs_guest_code_rate_limited_total{scope="prefix"}` 15 dk'da ≥ 20, `rs_mysql_test_failed_total`
  1 sa'te ≥ 10.

## P14a A2 + P14b B2 — backend (2026-11-15)

Kapsam: mimari-e11 §4.2 (AC-202..207, 214, 215) ve §5.1 (AC-224..226). Migration hazırdı (`20261116000000_p14a_security`).

### Değişen dosyalar

- **contracts** (A4/B3 bunlara bağlı): `src/errors.ts` (+`MFA_STEP_UP_REQUIRED` 401, `STALE_WRITE` 409, `PRECONDITION_REQUIRED` 428),
  `src/api/auth.ts` (`stepUpInputSchema`, `StepUpResponse`, `STEP_UP_MAX_AGE_SEC=300`, `RECOVERY_CODES_LOW_THRESHOLD=3`),
  `src/api/users.ts` (`UserDetail.version`, `userEtag`, `parseUserIfMatch`, `USER_STALE_WRITE_MESSAGE`, `USERS_WRITES_PER_MIN=30`,
  `USERS_CREATES_PER_MIN=10`, `UserOption`, `UserOptionsResponse`, `USER_OPTIONS_MAX=1000`), `src/api/tenants.ts`
  (`tenantOptionsQuerySchema`, `TenantOption`, `TenantOptionsResponse`, `TENANT_OPTIONS_MAX=20`), `src/audit.ts`
  (`AUTH_AUDIT.STEP_UP`); test `test/p14a-contracts.test.ts`.
- **server**: `src/auth/{session,guards,account,routes}.ts` (step-up servisi + `requireStepUp()`; giriş doğrulaması ve step-up
  ortak `consumeSecondFactor`; `mfaSetup` koşullu `version` UPDATE + `RaceHooks.afterLock`), `src/mail/templates.ts`
  (`recoveryCodeUsedMail`), `src/users/{repo,service,routes}.ts` (kilit + aktör yeniden okuma, 403/e-posta audit'i, version,
  If-Match/ETag, hız sınırı, `/users/options`), `src/tenants/{repo,service,routes}.ts` (pasifte talep/kayıt aynı TX, `/admin`
  hız sınırı, `/admin/tenants/options`), `src/settings/routes.ts` (yalnız `requireStepUp` bağlama), `src/lib/errors.ts` (3 mesaj).
- **testler**: yeni `test/integration/security-p14a-{users,auth,tenants}.test.ts`; `test/helpers/app.ts` (`loginStepUp`,
  `markStepUp`), `test/helpers/tenant-matrix.ts` (3 yeni rota sınıfı, PATCH `If-Match`), `users-p9`/`permissions-ac72-p9`
  (PATCH öncesi ETag okunur), `settings-p11`/`whatsapp-admin-p12b` (sistem ayarı yazımları step-up'lı oturumla),
  `AuthContext` fikstürlerine `stepUpAt: null`.

### Tasarımdan sapmalar (gerekçeli)

1. **Step-up'ta hatalı kod 400 `fields.code`** (§4.2 hata listesi 401/403/429): 401 web istemcisinde "oturum düştü" yoluna
   girer; 401 yalnız `MFA_STEP_UP_REQUIRED` (guard) için kullanılır.
2. **Audit adları:** step-up `auth.step_up` + `method: "TOTP"|"RECOVERY"` (ADR-0022/§4.2; AC-215 metnindeki `mfa.step_up` /
   `recovery_code` ile farklı — mevcut `auth.*` grubu korundu). 403 audit'i `user.updated` (oluşturmada `user.created`)
   `result:"fail"`, `newValue:{op, denied}`; §4.2'deki `user.update` yazımı mevcut sabite (`USER_AUDIT.UPDATED`) eşlendi.
   `denied`: AC-73 için eksik yetki anahtarları, üstünlük için hedefte olup aktörde olmayan anahtarlar, kendi hesabı için
   `role`/`status`/`mfa` + değişen anahtarlar, aktör pasif/silinmiş/başka firmada için `actor`.
3. **E-posta çakışması** 409 kodu `CONFLICT` kalır (`fields.email`; yeni `EMAIL_TAKEN` kodu açılmadı — web zaten bunu işliyor);
   audit `{op, reason:"email_taken"}`, e-posta değeri yazılmaz.
4. **Talep iptal nedeni `TENANT_PASSIVE`** (§4.2 `TENANT_INACTIVE` diyor; CHECK/enum'da yok, mevcut değer kullanıldı).
   Talep iptali satır başı `request.cancelled` audit'i ve kayıtlar için tek `binding.revoked {reason, count}` artık pasife alma
   TX'inde, aktör Super Admin. Commit sonrası yalnız bildirimler (oda, panel, `request.closed`, metrik). `requests/service.ts
cancelAllForTenant` artık tenants'tan çağrılmıyor (A3 alanı, dokunulmadı — kullanılmıyorsa A3/sonraki tur silebilir).
5. **Hız sınırı kapsamı:** `/users*` (avatar hariç — uploads modülünün 20/sa kovası) ve `/admin/tenants*` + `/admin/switch-tenant`
   için eklenti başına ayrı kova (30/dk); `/admin/settings/*` mevcut daha sıkı 10/dk kovasında kaldı.
6. **Sürüm artışı:** değişiklik içermeyen PATCH sürümü artırmaz (AC-207 "fark yoksa"); `mfa/setup` sürümü +1 artırır (yarış
   kontrolünün çalışması için zorunlu — salt `WHERE version=?` iki paralel kurulumu da geçirirdi). `mfa/enable` ve avatar artırmaz.
7. **AC-202 kapsamı:** create/patch/deactivate/reactivate/reset-mfa TX'leri `lockUsers([aktör, hedef])` (id sırası, `IN … ORDER BY
id FOR UPDATE`) + aktörün rol/durum/firma/yetkisi TX içinde okunur; uç yetkisi (`users.create`/`users.edit`) de TX içinde
   yeniden denetlenir. `argon2` hash kilit dışında.
8. **If-Match** yalnız güçlü `"v<n>"`; `*`, `W/"v<n>"`, liste → 428 (eşleşme kuralı belirsiz kalmasın). 428 gövde
   doğrulamasından önce döner.
9. **`/users/options`** `tenantScope` kullanır: firma seçmemiş Super Admin 403 (tüm firmalar listesi yok). USER rolü — yetkisi
   `support_requests.view` olsa da — yalnız kendisini görür (§5.1 "USER ve historyScope=own").

### Bağımlılık

Yeni bağımlılık yok.

### frontend-dev için sözleşme notları

- `GET /users/:id` → `version` + `ETag`; `PATCH` `If-Match: userEtag(version)` gönderilmeli. 428 `PRECONDITION_REQUIRED`,
  409 `STALE_WRITE` (mesaj `USER_STALE_WRITE_MESSAGE`) → "Yeniden yükle". PATCH yanıtı yeni `version`/`ETag` taşır.
- Step-up: 401 `MFA_STEP_UP_REQUIRED` → diyalog → `POST /auth/step-up {method, code}` → isteği bir kez tekrarla. Hatalı kod 400
  `fields.code`; 429 `Retry-After`. `recoveryCodesLeft ≤ RECOVERY_CODES_LOW_THRESHOLD` → yenileme uyarısı. 403
  `MFA_SETUP_REQUIRED` → 2FA kurulumuna yönlendir.
- `GET /users/options` → `{items:[{id, fullName, status}]}`; `GET /admin/tenants/options?q=&limit=` → `{items:[{id, name, slug, status}]}`.
- Kullanıcı yazma uçları 429 + `Retry-After` dönebilir.

### Test

Geçici MySQL `rs-p14a-a2-k9x4` (127.0.0.1:33461, `apps/server/scripts/test-db.sh`), bitince silindi.

- `pnpm --filter @remote/contracts typecheck|lint|test` temiz; yeni `p14a-contracts.test.ts` 3/3.
- `apps/server`: `pnpm typecheck` ve `pnpm lint` temiz; `pnpm test` 23 dosya / 376 test geçti.
- Yeni entegrasyon: `security-p14a-users` 13/13, `security-p14a-auth` 5/5, `security-p14a-tenants` 7/7. Gecikme kancalı
  testler (AC-202 ×2, AC-206, AC-214) her biri 20 ardışık tur içerir; kanca kilidi tutan TX'i bekletir, ikinci istek kilitte
  sıraya girer (zamanlama varsayımı yok).
- `pnpm test:int` tam koşu: **62 dosya / 601 test geçti** (seri projeler dahil).

### Kararsız testler

Yok. (Not: ortak scratchpad'teki `testdb.env` başka bir ajan tarafından üzerine yazıldığı için bir ara koşu silinmiş bir DB'ye
bağlandı; bindings/retention hataları buradandı, kod kaynaklı değil. Benzersiz dosya adıyla yeniden koşuldu.)

### P14a A5 — S14-2 düzeltmesi (devops, 2026-11-15)

`deploy/ops/remote-watch.sh`: konteyner çıktısından gelen `r_last`, `r_fail`, `st_epoch` ve durum dosyasındaki örnek zaman
damgaları `$(( ))`'e girmeden önce `^[0-9]+$` ile doğrulanır. Geçersizse: `r_last` → uyarı + `ALERT retention` (metrik değeri
geçersiz), `r_fail` → yok sayılır + uyarı, `st_epoch` → şimdi + uyarı. Tarama: diğer `$(( ))` girdileri (yedek `status.prom`,
`last_sent`/`offsite_remind`/`retention_fail_at`, disk yüzdesi, sayaç örnekleri) zaten doğrulanıyordu; `[ -gt ]` (`[[ ]]`
değil) aritmetik değerlendirmez. `test-watch.sh`: `a[$(touch …)]` metrik/`StartedAt`/durum değerleriyle 7 enjeksiyon → dosya
oluşmuyor; eski ifadenin savunmasız olduğu ayrıca gösterildi. test-watch GEÇTİ, shellcheck `-S warning` 0.

## P14 güvenlik düzeltmeleri — backend

Kaynak: `docs/guvenlik-raporu.md` "P14a/P14b (backend+db+devops) — kod turu 1" (S14-1, S14-3..S14-7). S14-2 devops, S14-8 dba.

| Bulgu        | Değişiklik                                                                                                                                                                                                                                                                                                                                                                                                                                                | Test                                                                                                                                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S14-1 (Orta) | `requests/service.ts` `create()`: kapıdan (`gated`) ÖNCE `assertCreateNotBlocked` — ip/önek/net48 kovası `blockedFor` ile (sayımsız) kilitliyse 429 + `request.rate_limited` audit (dakikada 1). `hit` kapının içinde kaldı → AC-209 "503'te kova tüketilmez" aynen. Güvenilen CIDR muaf (eskisi gibi).                                                                                                                                                   | `integration/p14a-a3.test.ts` "AC-209/S14-1": kilitli IP'den 50 paralel istek (ayar kilidi tutulurken) hepsi 429, `gateLoad` {0,0}; aynı anda başka firmanın talebi 201, kilit kalkınca meşru IP 201. Mevcut AC-209 testleri geçiyor. |
| S14-3        | `settings/mysql-probe.ts`: `localish = cls !== "public"` (tek etiketli ad istisnası ve `SINGLE_LABEL` kaldırıldı).                                                                                                                                                                                                                                                                                                                                        | `unit/p14a-a3.test.ts` AC-211: `db` → genel IP ⇒ `allowPublicKeyRetrieval:false`; `mysql` → 172.18.x ⇒ true.                                                                                                                          |
| S14-4        | Oluşturma TX'inde `lockSettings` sonrası `repo.shareTenantActive` (`SELECT status, deleted_at FROM tenants … FOR SHARE`); pasif/silinmiş → tek 404 yolu (ref: `REQUEST_REF_INVALID`, kayıt: `BINDING_INVALID`). Kilit sırası settings → tenants; pasife alma settings istemez → döngü yok.                                                                                                                                                                | `integration/p14a-a3.test.ts` "AC-205/S14-4": talep ayar kilidinde beklerken tenant PASSIVE → 404, satır 0.                                                                                                                           |
| S14-5        | `users/service.ts` `updateUser`: sürüm karşılaştırması (409) `assertManage` / kendi hesabı / `assertGrantable`'dan SONRA.                                                                                                                                                                                                                                                                                                                                 | `integration/security-p14a-users.test.ts` "AC-204/S14-5": üstün hesaba ve kendi rolüne yanlış `If-Match` → 403 + `denied` audit; yetkili düzenleme yanlış sürümle hâlâ 409.                                                           |
| S14-6        | `sessions/public.ts` `assertLookupAllowed` artık sayaç artırmaz; `rs_guest_code_rate_limited_total{scope}` yalnız kilit başlarken (`countFailedLookup`) — **kilitli kova başına bir** (bu dokümandaki A3 tanımı doğruydu, kod ona eşitlendi). `docs/runbook.md` §22.2 alarm satırı buna göre açıklandı: eşik (20 / 15 dk, mimari-e11) artık "15 dk'da kilitlenen ≥ 20 farklı önek kovası" demek; tek istemci tetikleyemez. Eşik değeri değişmedi.         | `unit/p14a-a3.test.ts` AC-208/S14-6: kilitliyken 25 + 5 ret sonrası sayaçlar 1/1. Entegrasyon AC-208 aynen.                                                                                                                           |
| S14-7        | `env.ts`: `isWeakEncryptionKey` (tüm baytlar aynı; CI'daki 32 sıfır bayt dahil) — `NODE_ENV=production`'da listedeki herhangi bir sürüm zayıfsa başlangıç hatası (değer mesaja yazılmaz). CI etkilenmez: sıfır anahtar yalnız `docker compose config` adımında, server production modunda başlatılmıyor (ci.yml `NODE_ENV: test`). Test sahte anahtarı (`test/helpers/secrets.ts`, eskiden 32×0x11 — artık reddedilirdi) 32 baytlık ASCII metne çevrildi. | `unit/env-logger.test.ts` "S14-7": sıfır / tekrarlı / rotasyon listesinde zayıf v2 → hata; test modunda kabul.                                                                                                                        |
| Temizlik     | Kullanılmayan `RequestService.cancelAllForTenant` ve tek kullanıcısı `repo.findPendingOfTenant` silindi (pasife alma P14a'dan beri `tenants/repo.ts cancelTenantRequests` ile aynı TX'te); `tenants/service.ts` başlık yorumundaki atıf güncellendi.                                                                                                                                                                                                      | —                                                                                                                                                                                                                                     |

Sözleşme değişikliği yok (frontend etkilenmez). Yeni bağımlılık yok. Migration yok.

Komutlar (apps/server): `pnpm run typecheck` ✓, `pnpm run lint` ✓, `pnpm run test` 23 dosya / 377 test ✓,
`pnpm run test:int` (geçici MySQL 8.4 konteyneri, iş bitince silindi) 62 dosya / 604 test ✓.

## P14a A4 + P14b B3 bölüm 2 — frontend (frontend-dev, 2026-11-15)

Kapsam: mimari-e11 §4.6 A4 (AC-206 web, 211 web, 215 web, 216 web, 217 web maddeleri) + §5.1 AC-225/226. Sunucu dosyalarına
dokunulmadı. Tasarım skill'i okunmadı (yeni ekran yok; mevcut primitifler genişletildi, DESIGN.md §6 güncellendi).

### Rotalar

Yeni rota yok. Değişen ekranlar:

| Yol                     | Auth                                  | Değişen davranış                                                                                               |
| ----------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `/admin/settings/mysql` | Super Admin                           | "Bağlantı güvenliği > TLS gerekli" anahtarı (AC-211); kayıt/test step-up isteyebilir (AC-215)                  |
| `/admin/settings/*`     | Super Admin                           | WhatsApp/TURN/MySQL yazımlarında 401 `MFA_STEP_UP_REQUIRED` → kod diyaloğu → istek bir kez tekrarlanır         |
| `/users/[id]`           | `users.view` (düzenleme `users.edit`) | PATCH `If-Match`; 409/428 → uyarı + "Yeniden yükle"; rol geri alınınca kayıtlı ezmeler geri gelir (AC-206)     |
| `/history`              | `session_history.view`                | Teknisyen seçenekleri `GET /users/options` (tam liste); Super Admin firma filtresi aramalı seçici (AC-225/226) |
| Üst menü firma seçici   | Super Admin                           | Aramalı combobox `GET /admin/tenants/options?q=&limit=20`, 250 ms gecikme, klavye (AC-226)                     |
| Panel kabuğu            | `support_requests.view`               | `/ws/panel` 4429 `retry=<sn>` → ± %20 bekleyip sessiz yeniden bağlanma (AC-216)                                |

### AC → yapılan

- **AC-215 (step-up):** `components/account/step-up-dialog.tsx` (`StepUpProvider`, `(panel)/layout`'ta tek örnek) +
  `lib/account/step-up.ts` (saf mantık). `lib/api.ts`: 401 `MFA_STEP_UP_REQUIRED` → kayıtlı işleyici → diyalog → başarıda
  istek **bir kez** tekrarlanır (ikinci 401 çağırana gider, döngü yok); eşzamanlı istekler tek diyalog bekler; vazgeçilirse
  `ApiError(401, MFA_STEP_UP_REQUIRED, "İşlem yapılmadı: kimliğinizi doğrulamadınız…")`. `isUnauthenticated` bu kodu
  **oturum düşmesi saymaz** (girişe yönlendirme yok). Diyalog: odak tuzağı (native `showModal` + `ui/dialog.tsx`'e eklenen açık
  Tab döngüsü — tüm diyaloglara yarar), TOTP 6 hane ↔ "Kurtarma kodu kullan", hata `aria-live="assertive"`, 400 `fields.code`
  (backend sapması) → "Kod hatalı…" + alan temizlenir, 429/423 → "N dakika sonra". Kurtarma koduyla `recoveryCodesLeft ≤
RECOVERY_CODES_LOW_THRESHOLD` → diyalog "Kurtarma kodlarınız azaldı" + Hesabım bağlantısı, "İşleme devam et" ile istek
  tekrarlanır. `RECOVERY_LOW` artık contracts sabitinin yeniden dışa aktarımı. 403 `MFA_SETUP_REQUIRED` mevcut yolla `/2fa/setup`.
- **AC-206:** `user-editor.tsx` PATCH `If-Match: userEtag(saved.version)` (`api()` 5. parametre `init.headers`). 409
  `STALE_WRITE` veya 428 → `user-stale` uyarısı (`USER_STALE_WRITE_MESSAGE`) + "Yeniden yükle" (GET, taslak atılır, toast).
  Rol: `permsForRole()` (`lib/users/permissions.ts`) — kayıtlı role dönülünce kayıtlı harita (`basePerms`, taslaktan ayrı state)
  olduğu gibi geri gelir; başka role geçişte eski `applyRoleDefaults` davranışı.
- **AC-211:** `MysqlState.requireTls` — kayıtlı değer yüklenir, her PUT/test gövdesinde açıkça gönderilir, kirli
  karşılaştırmasına girer. `Switch` primitifi ("TLS gerekli"); test notu açıkken "TLS ile yapılır, sertifika doğrulanır".
- **AC-216:** `lib/requests/panel-socket.ts`: `panelCloseAction(code, …, reason)` — 4429 + `retry=` → yeniden dene, gerekçesiz /
  `too_many` → dur; `panelRetryDelay()` = `parsePanelRetry` sn × [0,8; 1,2]. Konsola yazma yok. Bağlantı zaten
  `(panel)/layout`'taki `RequestNotifier`'da tek örnek (layout istemci içi gezintide yeniden bağlanmaz); e2e ile doğrulandı.
- **AC-217 (web):** `canonicalWaUrl` contracts'tan (web sarmalayıcısı geçersiz değerde kırpılmış ham değeri döner);
  `RETENTION_DEFAULT_DAYS` contracts'tan; `lib/dark-tokens.test.ts` iki koyu bloğun anahtar+değer eşitliği.
- **AC-225:** `/history` sunucuda `GET /users/options` (liste isteğiyle paralel). Pasif hesap "(pasif)"; URL'deki ama listede
  olmayan id "Seçili (…)". **Sapma:** firma seçmemiş Super Admin'de uç 403 (tenantScope, backend sapması 9) → teknisyen
  seçenekleri eskisi gibi sayfadaki kayıtlardan, alan altında "tam liste için önce firma seçin" ipucu. Talepler ekranında
  teknisyen filtresi yok; müşteri filtresi zaten aramalı combobox (P8c).
- **AC-226:** `lib/users/tenant-options.ts` (`limit=20`, `q` kırpılır, 250 ms). `ui/combobox.tsx`'e `debounceMs`, `openOnFocus`,
  `inline`, `inputRef` ve "işlenen Esc yayılmaz" eklendi (yeni primitif yok). `tenant-switcher.tsx` combobox'a geçti (yalnız
  aktif firmalar seçilebilir, etkin firma "Etkin" ipucuyla). Ek düzeltme: seçimden sonra `closeMenu` artık `<summary>`'den çağrılır.
  `/history` firma filtresi aynı yükleyiciyle (pasif firma "Pasif" ipucu); seçilen adın istemci içi belleği
  (`rememberTenantLabel`) uygulanmış filtrede adı korur.

### Değişen / eklenen dosyalar (yalnız apps/web + DESIGN.md)

Yeni: `components/account/step-up-dialog.tsx`, `lib/account/step-up.ts`, `lib/users/tenant-options.ts`, `lib/p14a-a4.test.ts`,
`lib/dark-tokens.test.ts`, `e2e/p14a-a4.spec.ts`. Değişen: `lib/api.ts`, `lib/account/{contract,retention}.ts`,
`lib/admin-settings/{forms,whatsapp}.ts`, `lib/admin-settings/admin-settings.test.ts`, `lib/requests/{panel-socket,requests.test}.ts`,
`lib/users/{contract,permissions}.ts`, `components/ui/{combobox,dialog}.tsx`, `components/request-notifier.tsx`,
`app/(panel)/{layout,tenant-switcher}.tsx`, `app/(panel)/admin/settings/mysql/mysql-form.tsx`,
`app/(panel)/users/[id]/user-editor.tsx`, `app/(panel)/history/{page,history-filters}.tsx`, `messages/tr.json`; e2e mock'ları
`mock-audit.mjs` (`u-ausasu-*` step-up senaryosu), `mock-users.mjs` (sürüm/ETag/If-Match, `/users/options`,
`/admin/tenants/options`, test kancası `GET /api/v1/users/:id/__bump`), `mock-history.mjs` (150 teknisyen / 250 firma),
`mock-requests.mjs` (`/__e2e/rq/limit4429/<çerez>?n=`, `/__e2e/rq/upgrades/<çerez>`); güncellenen spec'ler `p8-history`,
`p9-users` (firma seçici combobox; çıplak PATCH'e `If-Match`), `p11-admin` (PUT gövdesinde `requireTls:false`). DESIGN.md §6.

### Bağımlılık

Yeni bağımlılık yok.

### Önceki ajanın doğrulanmamış işleri ve bulunan kararsızlıklar

- **p7-control şerit kompakt modu ve side-nav taşması (B3 bölüm 1):** artık build tip hatası yok; tam koşuda `p7-control`
  (AC-47/48/49/99/50 dahil) ve `p14b-ui` ("CI 390 px taşması" dahil) yeşil.
- **p12-branding AC-229 testi kendi başına geçersizdi:** Playwright `setInputFiles({ mimeType: "" })` türü dosya adından
  doldurduğu için test boş türü hiç üretmiyordu; ayrıca yükleyici `change` sonrası input'u boşalttığından `files[0]` okuması
  yarışa giriyordu (tam koşuda düştü). Düzeltme (yalnız test): dosya tarayıcıda `new File([...], "firma.webp", { type: "" })`
  ile oluşturulup `DataTransfer` üzerinden atanır, tür `change` anında okunur. 5/5 tekrar yeşil.
- **AC-228 kararsızlığı (kod kök nedeni):** `LeaveDialog`'da Esc yerel kapanışı hemen yapıyor, `stay()` (geri nöbetçisini
  yeniden iten `pushState`) kuyruktaki asenkron `close` olayında çalışıyordu → hızlı ikinci "geri" yakalanmıyordu (15 koşuda
  5 düşme). Düzeltme: `components/leave-dialog.tsx` `onDismiss={guard.stay}` (Esc/X eşzamanlı). Sonrası AC-228 + AC-63 20×
  tekrar: 100/100.

### Test

- `pnpm --filter @remote/web lint` temiz · `typecheck` temiz · `test` **34 dosya / 321 test** geçti (yeni: `lib/p14a-a4.test.ts`
  10 test — AC-215 tek tekrar/döngü yok/vazgeç/eşzamanlı tek diyalog/işleyicisiz, AC-206 If-Match ve rol geri alma;
  `lib/dark-tokens.test.ts` AC-217; `requests.test.ts` AC-216 jitter; `admin-settings.test.ts` AC-211).
- Yeni e2e `e2e/p14a-a4.spec.ts` (adlarında AC no): AC-215 diyalog akışı (odak tuzağı Tab/Shift+Tab, boş/hatalı kod
  `aria-live`, kurtarma kodu, kalan ≤ 3 uyarısı, PUT tam 2 kez), AC-215 vazgeç + 429, AC-215 390 px taşma + axe (açık/koyu),
  AC-211 kalıcılık, AC-206 rol geri alma, AC-206 If-Match + 409 + "Yeniden yükle", AC-216 4429 `retry=1` sonrası sessiz yeniden
  bağlanma (≥ 0,8 sn), AC-216 12 istemci içi gezinti < 60 sn: tek upgrade, konsol hatası 0 (`guardConsole`), AC-225 150 teknisyen
  → 151 seçenek, AC-226 250 firma `q=ege&limit=20` tek istek (250 ms gecikme), ≤ 500 ms, ↓↓ Enter seçimi, AC-226 üst menü
  klavye + Esc, AC-225/226 390 px + axe (açık/koyu).
- **Tam e2e** `pnpm --filter @remote/web e2e`: **356 geçti, 0 düştü**, 150 atlandı (mobil projede `desktopOnly` olanlar ve
  koşul atlamaları).
- `pnpm format:check`: değiştirdiğim dosyalar temiz; tek uyarı `docs/guvenlik-raporu.md` (güvenlik ajanının dosyası, dokunulmadı).

### Sapmalar (özet)

1. AC-225: firma seçmemiş Super Admin'de `/users/options` 403 olduğundan teknisyen seçenekleri sayfadaki kayıtlardan (ipuçlu).
2. AC-226 sunucu p95 ≤ 500 ms ölçümü gerçek sunucuda değil; e2e sahte API yanıt süresini ölçer (backend testi kapsamında).
3. Kurtarma kodu uyarısı yalnız step-up diyaloğunda; "her girişte" uyarısı (AC-273 (3)) P10 hesap sayfası dışında bu pakette yok.
4. Mimari "TLS gerekli kutusu" → mevcut `Switch` primitifi (anahtar) kullanıldı; yeni checkbox primitifi açılmadı.

### P14a A5 — QA Tur 1 madde 6 (devops, 2026-11-15)

`scripts/test-db.sh` yoktu; betik `apps/server/scripts/test-db.sh`'tadır (yeni betik eklenmedi). Atıflar düzeltildi:
`scripts/repeat-tests.sh` başlığı (`eval "$(apps/server/scripts/test-db.sh up)"` / `down`) ve bu dosyadaki iki kısa yol
(P9 test satırı, A2 "Test"). Test dosyalarındaki ve `vitest.config.ts`'teki `scripts/test-db.sh` iletileri `apps/server`
dizinine göre doğrudur, dokunulmadı.

## P14 QA Tur 1 düzeltmesi — AC-225

QA madde 1 (backend-dev) + madde 2 (frontend-dev), tek ajan. Firma seçmemiş Super Admin'de `/history` teknisyen
seçenekleri artık sayfadaki kayıtlardan üretilmiyor; liste her zaman `/users/options` ucundan geliyor.

### Değişen dosyalar

- `packages/contracts/src/api/users.ts`: `userOptionsQuerySchema` eklendi (`strictObject({ tenantId?: ULID })`) ve uç açıklaması güncellendi.
- `apps/server/src/users/service.ts`: `userOptionsTenant(db, auth, requested)` eklendi. Etkin tenant varsa (firma seçili Super Admin ya da diğer roller) o döner, parametre yok sayılır. Firma seçmemiş Super Admin + `tenantId` verilirse `findTenant` (silinmemiş) ile kontrol edilir, firma yoksa 404. Diğer durumlarda mevcut 403 korunuyor.
- `apps/server/src/users/routes.ts`: `/options` artık zod + `userOptionsTenant` kullanıyor. İş mantığı serviste.
- `apps/server/test/integration/security-p14a-users.test.ts`: yeni test "AC-225: ?tenantId= izolasyonu …". Super Admin A/B firmalarını ayrı ayrı görüyor. Parametresiz istek 403, bozuk değer 400, olmayan firma 404, bilinmeyen parametre 400. ADMIN ve USER, `tenantId=B` gönderse bile yalnız kendi firmasını ya da kendisini görüyor; yanıtta B'nin kimlikleri yok.
- `apps/web/lib/users/user-options.ts` (yeni): `userOptionsPath`, `techOptions` (page.tsx'ten taşındı) ve istemci tarafı `loadUserOptions`. Testi `lib/users/user-options.test.ts`.
- `apps/web/app/(panel)/history/page.tsx`: `options()` yedeği silindi. Firma seçmemiş Super Admin'de URL'de `tenantId` varsa `/users/options?tenantId=` çağrılıyor, yoksa istek atılmıyor ve liste boş kalıyor (URL'deki seçili id "Seçili (…)" olarak korunuyor).
- `apps/web/app/(panel)/history/history-filters.tsx`: `techniciansFromPage` kaldırıldı, yerine `techniciansError` geldi. Firma filtresi boşken teknisyen seçici pasif ve "Önce firma seçin…" ipucunu gösteriyor. Firma seçilince istemci `/users/options?tenantId=` ile listeyi yüklüyor (abort, yükleniyor ve hata ipucu var). Firma değişince teknisyen seçimi sıfırlanıyor.
- `apps/web/messages/tr.json`: `h.f.techPickTenant`, `h.f.techLoading`, `h.f.techError` eklendi. `h.f.optionsHint` audit sayfasında kullanıldığı için kaldı.
- `apps/web/e2e/mock-history.mjs`: Super Admin `?tenantId=` desteği eklendi (Demo Firma → 150 teknisyen, Örnek Lojistik → kayıtlarda olmayan "Lojistik Teknisyeni" dahil 2, diğer firmalar boş, bilinmeyen firma 404, parametresiz 403). Diğer rollerde parametre yok sayılıyor.
- `apps/web/e2e/p14a-a4.spec.ts`: yeni test "AC-225: Super Admin — firma seçilmeden teknisyen seçici pasif + ipucu; firma seçilince liste /users/options?tenantId= ucundan …". Desktop ve mobile'da çalışıyor.
- `docs/api.md`, `docs/mimari-api.md` (`/users/options` satırı), `docs/db-notlari.md` (P14a ikinci migration `20261116010000_p14a_mysql_tls` kaydı).

### Tasarım kararları

- Super Admin dışındaki rollerde `tenantId` **yok sayılıyor**, 400 dönmüyor. Bu, `GET /sessions` ve `GET /audit`'teki "kapsam ezer" kalıbıyla aynı. Etkin tenant her zaman önce geldiği için izolasyon bozulmuyor.
- Sorgu şeması `strictObject`: bilinmeyen parametre artık 400 dönüyor (önceden sorgu tamamen yok sayılıyordu). Web istemcisi yalnız `tenantId` gönderiyor.
- Pasif firmalar için de liste dönüyor, çünkü geçmiş kayıtları görüntülenebiliyor.
- Yeni bağımlılık yok.

### Frontend sözleşme notu

`GET /users/options?tenantId=<ULID>` yalnız firma seçmemiş Super Admin'de anlamlı. Diğer durumlarda etkin firma dönüyor.

### Test

- contracts, server ve web: typecheck ve lint temiz. `pnpm format:check` 0.
- server `test`: **377/377**. `test:int` (geçici `rs-mysql-ac225-*:33391`, sonra silindi): **62 dosya / 605/605**.
- web `test`: **35 dosya / 323** geçti.
- e2e `p8-history.spec.ts` + `p14a-a4.spec.ts`, desktop + mobile: **42 geçti, 20 atlandı** (`desktopOnly`), 0 hata.
