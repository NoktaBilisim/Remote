# QA Raporu — P12 Tur 2
DURUM: DÜZELTİLMELİ

Tur 1 maddeleri ve düzeltme turu 1 (backend QA-1, B-P12-2, B-P12-4, customers-p8c kararsızlığı; frontend B-P12-1, QA-2;
devops runbook §16; mimari/mimari-api yolları) doğrulandı. Tek açık madde P12 dışı, kararsız bir P11 e2e testi (aşağıda).

## Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` / `typecheck` | temiz |
| `pnpm -r run test` | contracts 71/71, web 237/237, server **339/339**; skip yok |
| server `test:int` (yeni `rs-mysql-p12qa2:33381`, sonra `down`) | 48 dosya, **471/471**; skip yok |
| `pnpm --filter @remote/web e2e` 1. koşu | **279 geçti, 1 KALDI**, 106 atlandı: `p11-admin.spec.ts:333` "aydınlatma metni: PUT 429…" — `consent-body` beklenen metin yerine "yazılan metin + yüklü metin" birleşimi |
| aynı test tek başına `--repeat-each=5` | 5/5 geçti |
| `pnpm --filter @remote/web e2e` 2. koşu | **281 geçti, 0 hata**, 106 atlandı |

Atlamalar Tur 1'deki gibi gerekçeli (`desktopOnly`/proje eşlemesi). Konteyner silindi, 3217/4217 portlarında süreç kalmadı.

## Tur 1 maddelerinin doğrulaması
| Tur 1 maddesi | Durum | Kanıt |
|---|---|---|
| 1 [backend-dev] karşılama + istemci logosu testi | ✅ | `branding-api-p12` "AC-81 karşılama sayfası ve istemci logosu (QA-1)" (iki describe): `POST /public/sessions/resolve`, `GET /public/requests/tenant`, `POST /public/bindings/status` firma logosu → kaldırınca sistem/`/img/logo.png`; resolve `technician.avatarUrl` avatar varken de null |
| 2 [frontend-dev] müşteri sayfası logo e2e | ✅ | `p12-branding.spec.ts` "AC-81 (QA-2)": `L` token → `guest-logo` `data-logo="custom"`, `alt`, `src` firma URL'si ve yüklenmiş; `A` → `data-logo="system"`; masaüstü + mobil |
| 3 [devops] runbook §16 tutarsızlıkları | ✅ | §16: yalnız `/api/v1/files/...` üç uç; multipart bellekte, `/tmp` kullanılmaz; "üç yükleme ucu"; dosya 0640 / dizin 0750. `mimari.md`'de `/public/files` kalmadı; `mimari-api.md`'de yalnız sapma notunda tarihsel olarak geçiyor |

Ek düzeltmeler (güvenlik kaynaklı) kod ve testte görüldü: `image.ts` boyut/oran (`dimensionsOk`, ≥16 px, logo 20:1, avatar 4:1) kod çözmeden önce; `imageGate` 2 çalışan/4 bekleyen/10 sn → 429 `Retry-After: 5` (unit "en çok 2 resim işi aynı anda", "kuyruk doluyken…429"); avatar `Cache-Control: private, no-cache` + 304/401 int testi; login marka çağrısı `publicGet` ile XFF'i yalnız `X-Edge-Auth` doğruysa iletir (e2e "B-P12-1").

## Kabul kriterleri
| AC | Durum | Kanıt |
|---|---|---|
| AC-81 | ✅ | Tur 1 kanıtları + QA-1 int + QA-2 e2e (eksik kalan karşılama/istemci kısmı kapandı) |
| AC-82 | ✅ | Tur 1 ile aynı; B-P12-1 e2e |
| AC-83 | ✅ | Tur 1 ile aynı |
| AC-84 | ✅ | Tur 1 + boyut/oran ve eşzamanlılık unit testleri |
| AC-85 | ✅ | Tur 1 ile aynı |
| AC-87 | ✅ | Tur 1 ile aynı |

## Düzeltilmeli
1. [frontend-dev] `apps/web/e2e/p11-admin.spec.ts:339` (`await area.fill(text)`) — tam takımda yük altında kararsız: `fill`, sunucuda çizilen `consent-body` hidrasyondan önce yapılınca React yüklü metni yazılanın sonuna ekliyor ve `:349` `toHaveValue(text)` düşüyor (1. koşu kırmızı; tek başına 5/5 ve 2. koşu yeşil). Beklenen: `fill`'den önce hidrasyon beklensin (P12 yükleyicilerindeki `data-ready="true"` deseni gibi bir işaret `consent-form.tsx`'e eklenip test onu beklesin, ya da `fill` sonrası değer doğrulanıp gerekirse yeniden doldurulsun). Aynı `fill`-hemen-sonra deseni p11-admin'deki diğer aydınlatma metni testlerinde de varsa aynı işaret kullanılsın. Kabul: tam takım arka arkaya 3 koşuda 0 hata.

## Definition of Done
| Madde | ✅/❌ | Not |
|---|---|---|
| Testler yeşil | ❌ | 1 kararsız e2e (P11 testi, madde 1); diğer tüm takımlar yeşil |
| Lint + typecheck | ✅ | |
| Her AC testle kanıtlı | ✅ | AC-81 eksiği kapandı |
| Tasarım-kod uyumu, sapmalar gerekçeli | ✅ | mimari/mimari-api yolları düzeltildi; yeni kararlar (boyut/oran, kapı, no-cache, B-P12-3 P13 devri) implementation.md'de |
| İzolasyon, audit, transaction | ✅ | kapı reddi `upload.rejected` yazmıyor — gerekçeli (dosya geçersiz değil) |
| Yeni bağımlılık | ✅ | bu turda yok (`lib/gate.ts` mevcut) |
| Dokümanlar güncel | ✅ | runbook §16, mimari, mimari-api |
| İki tema / mobil / a11y | ✅ | QA-2 testi masaüstü + mobil |

## Öneriler (zorunlu değil)
- Web `uploadError` boyut/oran reddinde genel tür mesajını gösteriyor; sunucu `IMAGE_DIMENSIONS_MESSAGE` döndüğünde o mesajın gösterilmesi kullanıcıya daha açıklayıcı olur.
- B-P12-3 (silme/retention'da dosya temizliği) P13 kapsamına devredildi; P13 AC listesine madde olarak girdiği teyit edilmeli.
- Tur 1 önerileri (koyu token kopyası, boş `file.type` ön kontrolü) geçerli.

## Olumlu
- Tur 1'in üç maddesi de hedefe tam uygun ve testle kapatıldı; QA-1 testi üç ucu ve avatar sızmazlığını birlikte doğruluyor.
- Paralel testte görülen `customers-p8c` kararsızlığı kök nedeniyle (paylaşılan sistem logosu) açıklanıp giderildi.

---

# QA Raporu — P12 Tur 1 (arşiv)
DURUM: DÜZELTİLMELİ

Kapsam: P12 (git diff HEAD, commit edilmemiş). AC-81, 82, 83, 84, 85, 87 (`docs/gereksinimler-kabul-kriterleri-e5-e8.md`), mimari §10 P12,
mimari-api P12 sapma notu, db-notlari P12, implementation.md P12 (devops/backend/frontend), runbook §16, ortak std §1.5/1.6/1.8, DESIGN.md.
Denetçi kod değiştirmedi, staging'e bağlanmadı.

## Test sonucu
| Komut | Sonuç |
|---|---|
| `pnpm -r run lint` | temiz (contracts, server, web; `remote/design-tokens` kuralı `error`) |
| `pnpm -r run typecheck` | temiz |
| `pnpm -r run test` | contracts 71/71, web 237/237, server 335/335 — skip yok |
| server `test:int` (geçici `rs-mysql-p12qa:33371`, sonra `down`) | 48 dosya, **469/469**, skip yok |
| `pnpm --filter @remote/web e2e` | **278 geçti, 0 hata, 105 atlandı** (1,3 dk) |

Atlananlar: `desktopOnly` (`test.skip(name !== "desktop", …)`) ve mobil/desktop proje eşlemeleri; gerekçe testte ve implementation.md'de yazılı → bulgu değil.
Arka plan süreçleri ve test konteyneri kapatıldı.

## Kabul kriterleri
| AC | Durum | Kanıt / eksik |
|---|---|---|
| AC-81 firma logosu yükle/değiştir/kaldır, önizleme; üst menü, karşılama, istemci, e-posta; kaldırınca sistem logosu | ⚠️ kısmen kanıtsız | Kanıtlı: `branding-api-p12` "AC-81/84: Admin yükler…" (512 px PNG, `/auth/me`, `/settings/tenant`, `mailLogoUrl`, audit), "AC-81: değiştirince eski dosya silinir…kaldırınca null + sistem logosu", "settings.edit yoksa 403"; e2e "AC-81 kritik akış: firma logosu önizleme → kaydet → üst menüde…kaldır → sistem logosu"; e-posta `security-p10` `<img src=…logo>`. **Kanıtsız:** (a) müşteri karşılama sayfası `/session/[token]` firma logosu — sunucuda `/public/sessions/resolve` `tenant.logoUrl` dolu döndüğünü sınayan test yok, e2e mock (`mock-sessions.mjs:112`) hep `logoUrl: null`, `guest-logo` hiçbir testte yok; (b) istemci (talep/bağlama uçları `requests/*`, `bindings/*` `tenant.logoUrl`) — değişen kod için test yok |
| AC-82 login her zaman logo (tenant → sistem) | ✅ | `branding-api-p12` "AC-82: Super Admin sistem logosunu yükler; bilinmeyen/geçersiz/pasif slug…", "60/dk/IP"; e2e "AC-82: login her zaman logo gösterir — ?tenant=<slug>…", "AC-82: Super Admin sistem logosunu değiştirir". Sistem logosu kaldırma yok → bilinen karar (Sonra), gerekçe implementation.md sapma 2 + db-notlari açık nokta 1 |
| AC-83 avatar kare kırpma önizlemeli yükle/değiştir/kaldır; yoksa baş harf | ✅ | `branding-api-p12` "AC-83/84: kullanıcı kendi avatarını (me)…WEBP 256×256", "Admin aynı tenant kullanıcısının avatarını…", "Super Admin avatarı system/"; e2e "AC-83 kritik akış: avatar yükle (kare kırp) → üst menüde → kaldır (onaylı)" + kırpma diyaloğu axe. Müşteri ekranında teknisyen avatarı yok (baş harf) → bilinen karar, sapma 3 (KVKK) |
| AC-84 magic bytes PNG/JPG/WEBP, SVG/sahte uzantı ret, 2 MB, 512/256 px, EXIF sil, `uploads/{tenant}/` rastgele ad, başka tenant 404 | ✅ | unit `image-p12` (SVG/sahte uzantı/bozuk/piksel bombası/EXIF-ICC-XMP yok/rastgele ad/traversal/şema=CHECK); int "SVG, uzantısı .png yapılmış SVG/HTML, bozuk PNG → 400", "2 MB + 1 bayt → 413", "path traversal…404", "20/sa → 429", avatar başka tenant 404; `tenant-matrix` +3 çapraz vaka; DB CHECK `branding-p12`. Logo dosyaları tasarım gereği herkese açık (login/e-posta) — avatar için 404 kanıtlı |
| AC-85 tema Açık/Koyu/Sistem, üst menü + profil, DB, başka cihaz, flaş yok | ✅ | int "AC-85: PATCH /auth/me/preferences → DB…başka cihazda aynı tema", "geçersiz tema 400/401/403"; e2e "AC-85 kritik akış…yenilemede ilk boyamada doğru; başka cihaz aynı tema", "kayıt başarısızsa geri alınır", "oturumsuz giriş ekranı…çerez". İlk HTML `<html class>` sunucuda, satır içi betik yok |
| AC-87 lucide ikon, token lint, reduced-motion | ✅ | `lib/design-tokens-rule.test.ts` (10), lint temiz; e2e "AC-87: menü, sekme ve hesap menüsü bağlantılarının hepsinde ikon var", "prefers-reduced-motion…yalnız opaklık"; DESIGN.md ikon tablosu güncel |

İki tema / mobil: e2e `scanBothThemes` — `/account` (+ hesap menüsü), `/settings/logo`, `/admin/settings/system-logo` light+dark × 1280/390 px, axe 0 ihlal + yatay taşma yok. 5 durum: yükleyicilerde boş (baş harf/sistem logosu), yükleniyor (`loading`/`aria-busy`), hata (`FormError`, 400/413/429 eşlemesi), başarı (toast), salt okunur (`canEdit` yoksa) mevcut.

## Düzeltilmeli
1. [backend-dev] `apps/server/test/integration/` — AC-81 "karşılama sayfası ve istemci" kanıtı yok. Beklenen: firma logosu yüklenmiş tenant için (a) `GET /api/v1/public/sessions/resolve` (müşteri karşılama) yanıtında `tenant.logoUrl === /api/v1/files/logo/<tenantId>/…png`, logo yokken sistem logosu/`/img/logo.png`; (b) istemcinin kullandığı talep/bağlama uçları (`requests/service.ts`, `bindings/service.ts`'te değişen `tenant.logoUrl` alanı) aynı zinciri döndürüyor — her biri için en az bir entegrasyon iddiası ve `technician.avatarUrl === null` iddiası.
2. [frontend-dev] `apps/web/e2e/mock-sessions.mjs:112` + yeni e2e — müşteri sayfası `/session/[token]` firma logosu hiç sınanmıyor (`guest-logo` test kimliği kullanılmıyor). Beklenen: mock'ta `tenant.logoUrl` dolu bir token senaryosu; `getByTestId("guest-logo")` `data-logo="custom"` ve `img[src]` firma URL'si; `logoUrl: null` senaryosunda `data-logo="system"`.
3. [devops] `docs/runbook.md:1150` — "`/api/v1/public/files/...` ile sunar" yolu yok (gerçek: yalnız `/api/v1/files/...`); `:1146-1147` "/tmp (tmpfs; multipart geçici dosyaları)" backend ile çelişiyor (işleme tamamen bellekte, `/tmp`'ye yazılmaz); `:1237` "dört yükleme ucu" → 3 uç (+ `users/me` yolu ise açıkça belirtilsin). Metin backend sözleşmesine eşitlenmeli.

## Definition of Done
| Madde | ✅/❌ | Not |
|---|---|---|
| Testler yeşil (unit, int, e2e) | ✅ | yukarıda; skip'ler gerekçeli |
| Lint + typecheck temiz | ✅ | |
| Her AC'nin testle kanıtı | ❌ | AC-81 karşılama/istemci kısmı (madde 1, 2) |
| Tasarım-kod uyumu, sapmalar gerekçeli | ✅ | mimari-api P12 sapma notu (yollar, tema ucu, sistem logosu kaldırma yok, avatar müşteriye yok) ve implementation.md "Tasarımdan sapmalar" 1–6 |
| Tenant izolasyonu arka uçta | ✅ | avatar dosyası 404, tenant-matrix, DB CHECK öndek=tenant |
| Audit (logo/avatar/sistem logosu/ret/tema) | ✅ | testte doğrulandı; değer maskeleme gerektiren gizli bilgi yok |
| Transaction / hata yutma | ✅ | yol değişimi + audit tek TX, TX düşünce yeni dosya silinir; temizlik hatası alarm logu |
| `any` / ölü kod / PII log | ✅ | taramada bulunmadı |
| Yeni bağımlılık gerekçeli, AGPL/GPL yok | ✅ | sharp, file-type, @fastify/multipart, react-easy-crop mimari §10.4'te; libvips LGPL dinamik — check-licenses temiz |
| Env/compose/runbook (CLAUDE.md değişmez kuralı) | ✅ | `UPLOADS_DIR` `.env.example` + `env.ts` + compose + runbook §3/§16 |
| İki tema, mobil, a11y (axe) | ✅ | yeni ekranlar için; müşteri sayfasının yeni logo durumu hariç (madde 2) |
| Dokümanlar güncel | ❌ | runbook tutarsızlıkları (madde 3) |

## Öneriler (zorunlu değil)
- `globals.css` koyu token seti iki blokta kopya (sınıf seçicisi + medya sorgusu); DESIGN.md uyarıyor. Bir kural testi (iki bloktaki değişken değerlerinin eşitliği) ileride sapmayı önler.
- `precheckFile` tarayıcının bildirdiği MIME'a dayanır; bazı Windows kurulumlarında `.webp` için `file.type` boş gelebilir → geçerli dosya istemcide reddedilir. Boş tür için ön kontrolü atlayıp sunucuya bırakmak düşünülebilir.
- `sendFile` 304'ü dosya varlığından önce döner (DB kaydı doğrulandıktan sonra; risk düşük).
- Kök layout oturum çerezi olan her istekte `getMe()` çağırır (panel ile önbellek paylaşılıyor); oturumu dolmuş çerezle `/session/*` gibi public sayfalarda ek API çağrısı olur — ölçülebilir değil, not.

## Olumlu
- Çift tür denetimi (file-type + sharp formatı), `limitInputPixels`, metadata silme ve atomik yazımın hepsi birim testle kanıtlı.
- Dosya yalnız DB'de o an kayıtlı yolsa sunuluyor; eski URL, çapraz uç (logo↔avatar) ve traversal 404 testli.
- Gövde, yetki/hedef doğrulanmadan okunmuyor; multipart yalnız yükleme eklentisinde.
- Flaşsız tema satır içi betik olmadan (CSP korunarak) çözülmüş; hata geri alma e2e'de.
- Migration up/down guard'ları ve 330/330 grant kontrolü belgeli.
