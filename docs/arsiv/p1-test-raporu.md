# Test Raporu — P1, Tur 1
DURUM: GEÇTİ
Ortam: https://localhost:4450 (Caddy `tls internal`, gerçek yığın: caddy/web/server/mysql, `docker compose up -d --build` + seed), git commit yok (repo commit'siz), 2026-11-11
Araç: geçici Playwright 1.65 + @axe-core/playwright 4.14 betikleri (scratchpad; repoya eklenmedi), chromium, `ignoreHTTPSErrors`.
Ekran görüntüleri: `/private/tmp/claude-501/-Users-mennan--claude-spares-spare-XfEfpU/fa15848a-dcdd-4f1b-abf9-1c72703d5eac/scratchpad/p1-*.png` (40 dosya).

## Özet
| Ölçüt | Değer |
|---|---|
| Taranan sayfa (oturumsuz + oturumlu, her biri açık/koyu masaüstü + 375 px mobil) | 10 tarama (`/login` x2, `/change-password` x3, `/`, 404 x2, `/session/xyz` x2) |
| JS hatası (pageerror) | 0 |
| Konsol hatası | Yalnız tarayıcının kendi "Failed to load resource" satırı: 404 sayfalarında belge 404'ü ve hatalı girişte 401 (beklenen davranış, bkz. T-4) |
| Konsol uyarısı | 0 |
| 4xx/5xx | Yalnız beklenenler: 404 sayfası belgesi, hatalı girişte 401, kilitte 423; 5xx 0 |
| Kırık kaynak | 0 (logo, nokta-kucuk, favicon.ico 16/32/48, favicon-32x32, apple-touch-icon 180 → 200; `<link rel=icon/apple-touch-icon>` her sayfada var) |
| axe WCAG 2.1 AA | Açık 0 / Koyu 0 / Mobil 0 ihlal (tüm taramalar) |
| Mobil yatay taşma (375 px) | 0 (scrollWidth = clientWidth = 375) |
| Yavaş sayfa | Yok (ilk yükleme 560–625 ms, networkidle) |

## Bulgular (öncelik sırasıyla)
Engelleyici/Yüksek/Orta bulgu yok.

### T-1 [DÜŞÜK] Kilit mesajında süre bilgisi yok
Sayfa/akış: `/login`, 5 hatalı giriş. Adımlar: 1. Aynı hesapla 5 kez yanlış şifre gir. 2. Mesajı oku.
Beklenen: Kullanıcı ne kadar bekleyeceğini bilmeli (`messages/tr.json` `login.error.locked` "…15 dakika sonra tekrar deneyin." metni zaten var; yanıt `Retry-After: 878` dönüyor).
Gerçekleşen: Sunucu mesajı gösteriliyor: "Çok fazla hatalı deneme. Hesap geçici olarak kilitlendi." — süre yok.
Kanıt: p1-login-locked.png, p1-login-locked-mobile.png. Atanan: frontend-dev (423'te i18n metni veya Retry-After'dan dakika), gerekirse backend-dev (mesaj metni).

### T-2 [DÜŞÜK] Panelden şifre değiştirme ekranına gidiş yok; gönüllü değişimde geri dönüş yok
Sayfa/akış: `/` → `/change-password`. Adımlar: 1. Şifresi değişmiş kullanıcıyla gir. 2. Panelde şifre değiştirme bağlantısı ara. 3. URL ile `/change-password`'e git.
Beklenen: Ortak standart 1.3 "şifre değiştirme ekranı olmalı" — üst menü/avatar menüsünde bağlantı; sayfada "Vazgeç / Panele dön".
Gerçekleşen: Menüde bağlantı yok; sayfa yalnız URL ile açılıyor, geri dönüş bağlantısı yok. Gönüllü modda alt başlık, alan ipucunu ("En az 12 karakter…") tekrarlıyor.
Kanıt: p1-panel-light.png, p1-voluntary-change-password.png. Atanan: frontend-dev (profil menüsü P12'ye bırakılacaksa implementation.md'ye not).

### T-3 [DÜŞÜK] Oturumu açık kullanıcı `/login`'e gidince form gösteriliyor
Adımlar: 1. Giriş yap. 2. `https://localhost:4450/login` aç. Beklenen: panele yönlenme (veya "zaten giriş yaptınız"). Gerçekleşen: giriş formu gösteriliyor; yeniden giriş eski oturumu iptal ediyor (S1-10), işlevsel sorun yok.
Kanıt: p1-auth-login-light.png. Atanan: frontend-dev.

### T-4 [DÜŞÜK / bilgi] Beklenen 4xx yanıtlar konsolda "Failed to load resource" olarak görünüyor
Adımlar: hatalı şifreyle giriş (401) veya `/session/xyz`, `/boyle-bir-sayfa-yok` (404). Tarayıcının kendi ağ satırıdır, uygulama `console.error` çağırmıyor; JS hatası yok. Engellemez. Atanan: — (e2e "konsol 0" kuralı bu satırları filtrelemeli: frontend-dev).

### T-5 [DÜŞÜK / bilgi] Oturumsuz kullanıcı bilinmeyen yolda 404 değil login görüyor
`/boyle-bir-sayfa-yok` (oturumsuz) → 307 `/login?next=%2Fboyle-bir-sayfa-yok`; `/robots.txt` ve `/manifest.webmanifest` de login'e yönleniyor. Tasarım gereği (varsayılan korumalı); oturumluyken 404 sayfası doğru. `robots.txt` P4 public sayfası öncesi değerlendirilebilir. Atanan: frontend-dev.

## Akış sonuçları
| Akış | Sonuç | Not |
|---|---|---|
| Boş form | ✅ | 2 alan hatası, odak ilk hatalı alana |
| Hatalı şifre | ✅ | 401, "E-posta/kullanıcı adı veya şifre hatalı." (varlık sızdırmaz) |
| Klavye: Tab sırası | ✅ | login → şifre → "Şifreyi göster" → "Giriş yap"; hepsinde görünür 2px odak halkası (p1-login-focus.png) |
| Klavye: Enter ile gönderim | ✅ | Enter → istek → `/change-password` |
| SA ilk giriş → zorunlu şifre değişimi | ✅ | mustChange iken `/` → `/change-password` |
| Şifre formu doğrulama | ✅ | <12 karakter, tekrar uyuşmazlığı, yeni=mevcut, yanlış mevcut (400 alan hatası) |
| Değişim → panel | ✅ | Yeni şifreyle panel; eski şifre 401; DB `must_change_password=0`, hash `$argon2id$` |
| Panel yenileme | ✅ | Oturum korunuyor |
| Çıkış | ✅ | `/login?reason=logout` + "Çıkış yaptınız"; çerezler silindi |
| Çıkış sonrası `/`, `/change-password` | ✅ | `/login` ve `/login?next=%2Fchange-password` |
| Çıkış sonrası geri tuşu | ✅ | Panel içeriği görünmüyor, `/login` |
| Geçersiz oturum çerezi | ✅ | `/login?reason=expired` + "Oturumunuz sona erdi" |
| Açık yönlendirme `?next=%2F%09%2Fevil.example` | ✅ | Panelde (`/`) kaldı; ayrıca `//evil.example`, `https://evil.example`, `/\evil.example`, `javascript:alert(1)` → `/` |
| Meşru `?next=%2Fchange-password` | ✅ | Hedefe gitti |
| `/session/xyz` oturumsuz | ✅ | Login'e yönlenmeden 404 sayfası (P4'e kadar beklenen) |
| Özel girdi `' OR 1=1 --`, `<script>` | ✅ | 401 genel mesaj, diyalog/çalışan betik 0, audit'e düz metin olarak yazıldı |
| Çok uzun (300) / kısa (2) girdi | ✅ | İstemci doğrulaması "3 ile 190 karakter", istek gitmedi |
| Ağ hatası (route.abort) | ✅ | "Sunucuya ulaşılamadı…" |
| 500 (zorlanmış) | ✅ | Hata kutusu + "Hata kodu: req-test-123" |
| 429 (zorlanmış) | ✅ | Mesaj gösterildi |
| Çift tıklama | ✅ | Tek POST /auth/login |
| Yabancı Origin login (API) | ✅ | 403 |
| 5 hatalı giriş → kilit (hayalet hesap, sonra SA) | ✅ | 401×4 → 423; kilitliyken doğru şifre de 423; `Retry-After` var (mesajda süre yok → T-1) |

## Kabul kriterleri (uçtan uca, P1 kapsamı)
| AC | Durum | Nasıl doğrulandı |
|---|---|---|
| AC-64 giriş, argon2id, ≥12 | ✅ | Tarayıcıyla giriş; DB hash öneki `$argon2id$`; <12 şifre reddi |
| AC-65 kilit + audit | ✅ (e-posta P10) | 5. hatada 423; audit: `auth.login` success/fail(reason), `auth.locked` scope=account_ip, `auth.logout`, `auth.password_change`; audit'te parola 0 |
| AC-66 zorunlu değişim | ✅ (sıfırlama P10) | mustChange iken panele geçilemedi; değişimden sonra panel |
| AC-82 login logosu | ✅ | `/img/logo.png` yüklü (naturalWidth>0), açık/koyu temada açık kart üzerinde |
| AC-86 favicon | ✅ | 3 `<link>` her sayfada, dosyalar 200 |
| AC-89 health/ready dışarıya kapalı | ✅ | `/health`, `/ready`, `/metrics` dışarıdan 404; server healthy |
| AC-90 log | ✅ | server/web/caddy loglarında test parolaları, sahte token: 0; `X-Request-Id` var |
| AC-126 başlıklar | ✅ | CSP nonce'lu, `unsafe-inline` yok, `connect-src wss://localhost:4450`, worker/manifest `'self'`, `upgrade-insecure-requests`, CORP/COOP same-origin; `Server`/`X-Powered-By` yok |

## Görsel gözlemler (ekran görüntülerinden)
- Login (açık/koyu/mobil): ortalanmış kart, logo açık zemin kartında (koyu temada okunur), taşma/çakışma yok. Mobilde üstte geniş boşluk var (dikey ortalama), kabul edilebilir.
- Panel: üst menü logo + "Nokta Uzaktan Destek", kullanıcı adı + rol, "Çıkış yap"; kenar çubuğunda ikonlu "Ana sayfa"; boş durum kartı. Koyu tema kontrastı iyi. Mobilde kullanıcı adı/rol gizleniyor, çıkış yalnız ikon (erişilebilir adı var, axe temiz); menü yatay şerit.
- Açık temada üst menüdeki küçük logonun zemin kartı yok, koyuda var (tutarlı ama farklı); sorun değil.
- Şifre formu: hata durumunda kırmızı çerçeve ve alan altı mesaj net. Gönüllü modda alt başlık tekrarı (T-2).
- 404: ikon, başlık, "Ana sayfaya dön" butonu; logo yok (bilinçli sade).
- 500/ağ/kilit/oturum sona erdi uyarıları uygun renk + ikonla gösteriliyor.

## Temizlik
`docker compose --profile setup down -v` (volume'lar silindi), `deploy/.env` ve geçici kimlik/storageState dosyaları silindi; geçici betikler yalnız scratchpad'de.
