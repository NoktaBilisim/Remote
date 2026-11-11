# Gereksinimler — Remote Support (Uzaktan Destek) Platformu
Tarih: 2026-11-11   Durum: TASLAK (2026-11-10: tam erişim MVP'de; 2026-11-11: `docs/mimari.md` §13 AC değişiklik talebi ve K8 işlendi)

> Kabul kriterleri (AC-n) boyut nedeniyle ayrı dosyadadır (bu dokümanın 5. bölümüdür, ayrılmaz parçasıdır):
> `/Users/mennan/Projeler/Remote/docs/gereksinimler-kabul-kriterleri.md` (dizin) →
> `/Users/mennan/Projeler/Remote/docs/gereksinimler-kabul-kriterleri-e1-e4.md` ve
> `/Users/mennan/Projeler/Remote/docs/gereksinimler-kabul-kriterleri-e5-e8.md`.
> Toplam: **28 kullanıcı hikâyesi, 128 kabul kriteri** (AC-1..AC-128).

## 1. Amaç ve iş değeri
Kurumsal müşterilere teknik destek verirken AnyDesk/TeamViewer gibi üçüncü taraf SaaS'a bağımlılığı kaldırmak. Tamamen self-hosted, uçtan uca şifreli (DTLS-SRTP), **tam erişimli** (uzaktan klavye/fare) bir destek platformu: teknisyen web panelinden çalışır; müşteri **kurulum ve admin yetkisi gerektirmeyen** taşınabilir "Hızlı Destek" uygulamasıyla tam erişim verir veya bu uygulama çalıştırılamıyorsa tarayıcıdan yalnızca görüntü paylaşır. Medya ve veri firmanın kendi sunucusundan çıkmaz; tüm oturumlar audit log ile denetlenir. Proje açık kaynaktır (Apache-2.0).

## 2. Kullanıcılar / roller
| Rol | Açıklama |
|---|---|
| Super Admin | Nokta Bilişim. Tenant yönetimi, sistem ayarları (MySQL, sistem logosu, TURN), tüm oturum ve audit kayıtları, aktif oturumu zorla sonlandırma. |
| Admin | Destek veren firmanın (tenant) yöneticisi. Teknisyenler, yetki toggle'ları, tenant ayarları (SMTP, logo, TTL, aydınlatma metni), tenant oturum geçmişi, `sessions.terminate` yetkisiyle tenant'taki aktif oturumu zorla sonlandırma. |
| User (Teknisyen) | Oturum açar, bekleyen katılımcıyı kabul/ret eder, müşteri ekranını izler/kontrol eder (müşteri izin verirse), chat/dosya/işaretleme. Yalnızca kendi oturumlarını görür. |
| Müşteri (Misafir) | Hesabı yok; standart (admin olmayan) Windows kullanıcısı varsayılır. Yalnızca geçerli oturum linki/kodu ile ve teknisyen kabulünden sonra o oturuma erişir. |

## 3. Kapsam
### Kapsamda (MVP)
- **Oturum yaşam döngüsü:** süreli (15–30 dk), tek kullanımlık, kriptografik oturum linki + 8 haneli oturum kodu; kopyalama ve e-posta ile gönderim; iptal; Admin/Super Admin tarafından zorla sonlandırma.
- **Katılımcı kabulü (lobi):** müşteri katılım isteği teknisyen konsolunda bekler; teknisyen müşterinin telefonda okuduğu 4 haneli kabul kodunu girerek kabul eder veya reddeder (AC-112, AC-113; ADR-0006).
- **Sinyalizasyon:** Fastify + TypeScript + ws; SDP/ICE, oturum durum makinesi, yeniden bağlanma; coturn STUN/TURN (UDP/TCP/TLS), geçici TURN kimlik bilgileri.
- **Hızlı Destek istemcisi (Windows, MVP):** tek dosya, taşınabilir, kurulumsuz, admin gerektirmeyen, kullanıcı oturumunda çalışan uygulama. Ekran yakalama (çoklu monitör seçimi), WebRTC video, DataChannel üzerinden klavye/fare olayı uygulama, chat, dosya, işaretleme overlay'i. Belirgin **"Erişime izin ver / Kontrolü kapat / Oturumu bitir"** butonları, her zaman görünür **"Uzaktan kontrol aktif"** göstergesi, anlık kesme, dolandırıcılık uyarısı ve "Kötüye kullanımı bildir" bağlantısı. Servis, otomatik başlatma, kayıt defteri kalıcılığı yok; kapanınca iz bırakmaz.
- **İzin seviyeleri:** varsayılan **yalnızca görüntüleme**; kontrol için müşterinin ayrı, açık onayı; müşteri kontrolü istediği an geri alır.
- **Tarayıcı-yalnız mod (yedek):** getDisplayMedia ile görüntüleme + işaretleme + chat + dosya; uygulama çalıştırılamadığında (AppLocker, SmartScreen, kurumsal politika).
- **Teknisyen web konsolu:** canlı video, ölçekleme/tam ekran, uzaktan kontrol (izin varsa), chat, iki yönlü dosya transferi, işaretleme (kalem, ok, dikdörtgen, lazer), bağlantı kalitesi (FPS, bitrate, RTT, kayıp, bağlantı tipi).
- **Oturum geçmişi:** filtre, detay, not/ticket no, CSV dışa aktarma.
- **Ortak Nokta standartları (Epik E6, /Users/mennan/Projeler/CLAUDE.md):** login + 2FA (TOTP), tenant, rol, yetki toggle'ları, audit log + salt okunur ekran, MySQL ayar + test, SMTP ayar + test maili, logo/avatar, açık/koyu/sistem tema, favicon, UI standardı.
- **Yetki listesi eki:** Oturumlar modülüne `sessions.terminate` ("Oturumu zorla sonlandır") alt yetkisi eklenir; Admin varsayılan açık, User varsayılan kapalı (AC-71, AC-114; G-04).
- **Operasyon:** Docker Compose (uygulama + coturn + MySQL), publish sunucusuna deploy, health/metrics, yedekleme, runbook; istemci için imzasız, tekrarlanabilir build + SHA-256 + GitHub build attestation hattı (K8, ADR-0010).
- **Dokümantasyon:** README, KULLANIM_KILAVUZU, DATASHEET, PDF'ler.

### Kapsam DIŞI (açıkça)
1. **Gözetimsiz erişim (unattended access)** ve yeniden başlatma sonrası otomatik yeniden bağlanma. Kalıcı servis gerektirir; açık soru S7.
2. **UAC yükseltilmiş pencereler ve Secure Desktop** (UAC onay penceresi, Ctrl+Alt+Del ekranı, kilit/login ekranı) üzerinde kontrol. Admin'siz süreç Windows UIPI nedeniyle bunlara girdi gönderemez. Ekranda görünür olabilir ama kontrol edilemez; konsolda "Yükseltilmiş pencere — kontrol edilemiyor" uyarısı gösterilir (AC-105).
3. **macOS ve Linux istemcisi** MVP'de yok. Sıra: Faz 8 macOS (Ekran Kaydı + Erişilebilirlik izni, Developer ID + notarization), Faz 9 Linux (Wayland portal onayı). Bu platformlarda MVP'de tarayıcı-yalnız mod kullanılır.
4. **Oturum kaydı (video recording).** KVKK rızası, şifreli depolama, saklama politikası gerektirir. Sonra; açık soru S6.
5. **Çoklu teknisyen** (ikinci teknisyen, süpervizör izleme, oturum devri). Sonra.
6. **Sesli/görüntülü görüşme.** Sonra; MVP'de iletişim chat + telefon.
7. **Mobil cihazlar** (müşteri ve teknisyen konsolu). Mobil müşteri "desteklenmiyor" ekranı görür; yönetim ekranları responsive'dir.
8. **Pano (clipboard) senkronizasyonu**, uzaktan yazdırma, ses aktarımı, ters yön (teknisyen ekranını paylaşma). Sonra.
9. **Sunucuda dosya saklama / virüs taraması.** Dosyalar P2P DataChannel ile aktarılır.
10. **Chat içeriğinin sunucuda saklanması** (açık soru S5), SSO/LDAP, faturalama/lisanslama, public API, ITSM entegrasyonu, SMS/WhatsApp ile link gönderimi, İngilizce arayüz (altyapı i18n uyumlu; sonra), Windows ARM64.
11. **Ekran karartma / gizli mod** (müşteriden gizli işlem yapma) — kötüye kullanım riski; hiçbir fazda planlanmaz (G-17).

## 4. Fazlar (MVP yol haritası)
| Faz | İçerik | Çıkış kriteri |
|---|---|---|
| 0 | Mimari, sequence akışları (oturum oluşturma, link/kod eşleme, katılım + lobi kabulü, SDP/ICE, izin yükseltme/geri alma, reconnect, sonlandırma), dizin yapısı, veri modeli, tehdit modeli, istemci teknoloji ADR'si (S1) | `docs/mimari.md`, `docs/tasarim-kontrol.md`, ADR'ler onaylı |
| 1 | Monorepo iskeleti, auth/tenant/rol temeli, audit log altyapısı, oturum API'si, WS sinyalizasyon + lobi, coturn, Docker Compose; staging'e ilk deploy ve gerçek NAT/TURN testi | E1, E2 AC'leri yeşil |
| 2 | Tarayıcı-yalnız müşteri istemcisi (medya hattını erken kanıtlar) | E3 AC'leri |
| 3 | Teknisyen konsolu (video, chat, dosya, işaretleme, kalite, kontrol UI'ı), oturum geçmişi | E4, E5 AC'leri |
| 4 | Windows Hızlı Destek istemcisi (yakalama, input, izin UI'ı; imzasız, tekrarlanabilir build + SHA-256 + attestation) | E8 AC'leri |
| 5 | Ortak standartların yönetim ekranları (yetki toggle, MySQL, SMTP, logo/avatar, tema, 2FA, audit ekranı) | E6 AC'leri |
| 6 | Prod deploy, yedekleme, runbook, dokümantasyon + PDF | E7 AC'leri, DoD |
| 8+ | macOS istemcisi, Linux istemcisi, kayıt, çoklu teknisyen, ses (ayrı dokümanlar) | — |

Not: Audit log ve tenant izolasyonu Faz 1'de kurulur ("en baştan" kuralı). Faz 4'ün kritik yolu SmartScreen/AV davranışıdır: kod imzalama sertifikası yoktur (K8, ADR-0010); tekrarlanabilir build, SHA-256 yayını, GitHub build attestation ve SmartScreen "Ek bilgi → Yine de çalıştır" rehberi ile yönetilir. SignPath Foundation başvurusu Faz 4 ile paralel başlatılır (R1).

## 5. Kullanıcı hikâyeleri
Kabul kriterleri: `/Users/mennan/Projeler/Remote/docs/gereksinimler-kabul-kriterleri.md`

**E1 — Oturum yaşam döngüsü**
- US-1: Teknisyen olarak tek tıkla süreli, tek kullanımlık bir destek linki/kodu üretmek istiyorum ki müşteriye güvenle iletebileyim.
- US-2: Teknisyen olarak linki sistemden e-postayla göndermek veya kopyalamak istiyorum ki ayrı araç kullanmayayım.
- US-3: Teknisyen olarak bekleyen oturumu iptal etmek istiyorum ki yanlış kişiye giden link kullanılamasın.
- US-28: Admin/Super Admin olarak aktif bir destek oturumunu zorla sonlandırmak istiyorum ki şüpheli veya kötüye kullanılan bir oturumu hemen durdurabileyim. (G-04)

**E2 — Sinyalizasyon ve bağlantı**
- US-4: Teknisyen olarak müşteri kurumsal NAT/firewall arkasında olsa da bağlanabilmek istiyorum.
- US-5: Taraflar olarak kısa ağ kopmalarında oturumun yeni link gerekmeden toparlanmasını istiyorum.
- US-27: Teknisyen olarak bağlanmak isteyen kişiyi telefonda okuduğu kabul koduyla doğrulayıp kabul etmek veya reddetmek istiyorum ki link/kod başkasının eline geçse bile yanlış kişiye bağlanmayayım. (G-01)

**E3 — Tarayıcı-yalnız müşteri modu (yedek)**
- US-6: Müşteri olarak bağlanmadan önce kimin, hangi firmadan bağlanacağını görmek ve açıkça onay vermek istiyorum ki dolandırıcılığa kurban gitmeyeyim.
- US-7: Müşteri olarak uygulama çalıştıramadığımda tarayıcıdan seçtiğim pencere/ekranı paylaşıp istediğim an durdurmak istiyorum.
- US-8: Müşteri olarak teknisyenle yazışmak, dosya alıp göndermek ve teknisyenin neyi işaret ettiğini görmek istiyorum.

**E4 — Teknisyen konsolu**
- US-9: Teknisyen olarak müşteri ekranını düşük gecikmeyle net görmek istiyorum.
- US-10: Teknisyen olarak müşteri izin verdiğinde klavye/fare ile ekranı kontrol etmek istiyorum ki sorunu kendim çözeyim.
- US-11: Teknisyen olarak görüntü üzerine çizim/lazer ile yön göstermek istiyorum.
- US-12: Teknisyen olarak bağlantı kalitesini anlık görmek ve dosya alıp göndermek istiyorum.

**E5 — Oturum geçmişi**
- US-13: Admin olarak tenant'ımdaki tüm oturumları görmek ve dışa aktarmak istiyorum ki hizmeti raporlayabileyim.
- US-14: Teknisyen olarak oturuma not ve ticket numarası eklemek istiyorum.

**E6 — Ortak platform standartları**
- US-15: Kullanıcı olarak e-posta + şifre (+2FA) ile güvenli giriş yapmak, şifremi değiştirmek/sıfırlamak istiyorum.
- US-16: Super Admin olarak tenant oluşturmak, pasife almak, tenant'lar arası geçiş yapmak istiyorum.
- US-17: Admin olarak teknisyen yetkilerini modül bazlı toggle'larla yönetmek istiyorum (ör. "Uzaktan kontrol" yetkisi ayrı).
- US-18: Admin/Super Admin olarak kritik işlemleri salt okunur audit log ekranında filtreleyerek izlemek istiyorum.
- US-19: Super Admin olarak MySQL bağlantısını, Admin olarak SMTP ayarlarını girip test etmek istiyorum.
- US-20: Admin olarak firma logomu, kullanıcı olarak avatarımı ve tema tercihimi yönetmek istiyorum.

**E7 — Operasyon ve dokümantasyon**
- US-21: Sistem yöneticisi olarak platformu `docker compose up` ile kurmak, sağlığını izlemek ve yedeğini almak istiyorum.
- US-22: Yönetici/son kullanıcı olarak Türkçe kullanım kılavuzu ve datasheet'e (PDF) erişmek istiyorum.

**E8 — Hızlı Destek istemcisi (Windows)**
- US-23: Standart yetkili müşteri olarak hiçbir şey kurmadan, admin şifresi istemeden tek dosyayı çalıştırıp teknisyene erişim vermek istiyorum.
- US-24: Müşteri olarak önce yalnızca görüntü paylaşmak, kontrolü ayrıca onaylamak ve tek tıkla anında geri almak istiyorum ki bilgisayarım üzerinde söz hakkım kalsın.
- US-25: Müşteri olarak uzaktan kontrol aktifken bunu her an görmek istiyorum.
- US-26: Müşteri olarak oturum bitince uygulamanın kapanmasını ve sistemde kalıcı iz bırakmamasını istiyorum.

Not: US-27 ve US-28 2026-11-11'de eklendi; numaralar epik sırasına göre değil eklenme sırasına göre verilir (mevcut numaralar değişmez).

## 6. Fonksiyonel olmayan gereksinimler
- **Performans:** ilk kare p95 < 5 sn (doğrudan) / < 8 sn (TURN); uçtan uca görüntü gecikmesi p95 < 400 ms (RTT < 50 ms); uzaktan girdi gecikmesi p95 < 150 ms (RTT < 50 ms); işaretleme p95 < 200 ms. Tek sunucuda (4 vCPU / 8 GB) 50 eşzamanlı aktif oturum sinyalizasyonu; liste uçları 10.000 kayıtta < 500 ms.
- **Güvenlik:** TLS zorunlu (getDisplayMedia güvenli bağlam ister); DTLS-SRTP; medya uygulama sunucusundan geçmez (TURN yalnızca şifreli paket görür); strict CORS ve nonce tabanlı CSP, HSTS, `frame-ancestors 'none'`; rate limiting; WS Origin + kimlik doğrulama; tüm girdiler zod ile; uzaktan kontrol izni **istemci tarafında** uygulanır (sunucu P2P input'u engelleyemez, istemci izin yokken gelen her input olayını düşürür); teknisyen kabulü olmadan SDP/ICE ve TURN kimlik bilgisi verilmez (AC-112).
- **İstemci:** Windows 10 22H2+ ve Windows 11, x64; tek dosya ≤ 40 MB; çift tıktan karşılama ekranına ≤ 5 sn; istemci kendi dosyası yazmaz (`%TEMP%` dahil); tek disk yazımı müşterinin Kabul ettiği dosyadır (İndirilenler, `.part` → doğrulama → MOTW; yarım kalan `.part` silinir — ADR-0004 r2, 2026-11-11); kayıt defteri, servis, zamanlanmış görev, başlangıç kısayolu yok; imzasız, tekrarlanabilir build, SHA-256 `SHA256SUMS` ile ve GitHub build attestation ile doğrulanabilir (K8, AC-96).
- **Tarayıcı desteği:** teknisyen ve müşteri: Chrome/Edge son 2 sürüm (tam), Firefox son 2 sürüm (Document PiP yok), Safari macOS son 2 sürüm (müşteri, best-effort).
- **Erişilebilirlik:** WCAG 2.1 AA; klavye ile tam kullanım; durumlar yalnız renkle anlatılmaz.
- **Yerelleştirme:** arayüz Türkçe; tarihler UTC saklanır, Europe/Istanbul gösterilir; metinler i18n anahtarlarından.
- **Veri saklama:** oturum meta verisi ve onay kayıtları tenant ayarı (90–730 gün, varsayılan 365); audit log 730 gün; süresi dolan kayıtlar günlük işle anonimleştirilir/silinir.
- **Gözlemlenebilirlik:** JSON log + korelasyon ID; `/health`, `/ready`, `/metrics` (aktif oturum, WS bağlantı, TURN tahsis sayısı).
- **Yedekleme:** MySQL günlük döküm, 14 gün saklama, geri yükleme testi runbook'ta.
- **Lisans:** proje Apache-2.0; bağımlılıklar izinli lisanslı (MIT/BSD/Apache), AGPL yasak; CI lisans taraması (AC-94).

## 7. Varsayımlar
- V1: **Karar:** MySQL + Prisma, tek DB, tenant_id (ADR-0003). — Veritabanı **MySQL** (Nokta ortak standardı 1.2 tek DB/MySQL ayar ekranı ister); ORM mimar kararıdır. Varsayılan stack'teki PostgreSQL bu proje için geçersizdir.
- V2: Frontend Next.js (App Router) + Tailwind; API ve WS ayrı Fastify servisi; ikisi aynı alan adı altında reverse proxy ile sunulur.
- V3: Publish sunucusunda 80/443 dolu; uygulama ayrı bir TLS portundan yayınlanır (ITSM 4444 kullanıyor; varsayılan 4450, devops kararı). Geçerli sertifika ve alan adı gereklidir (S2).
- V4: TURN portları: 3478 UDP/TCP, 5349 TLS, relay aralığı (ör. 49160–49200 UDP); sunucu firewall'unda açılır.
- V5: **Revize (G-01):** Token/kod tüketimi: link GET ile ve müşterinin katılım isteğiyle tüketilmez; yalnız teknisyen katılımcıyı kabul ettiğinde (admit) tüketilir (AC-6). Katılım sonrası oturuma bağlı yeniden bağlanma kimliği 120 sn kopma toleransı sağlar.
- V6: **Karar:** S8 ile aynı (ADR-0006). — İstemci–oturum eşlemesi: karşılama sayfası jenerik, imzasız istemciyi indirtir; oturum, dosya adına gömülü 8 haneli kod (ör. `NoktaDestek_48291376.exe`) ile veya müşteri kodu elle girerek eşlenir. Binary'nin içine token gömülmez (tekrarlanabilir build ve SHA-256 doğrulamasını bozar).
- V7: İstemci teknisyen paneliyle aynı WebRTC protokolünü kullanır; teknisyen tarafı istemci tipinden bağımsızdır.
- V8: Bir teknisyenin aynı anda en fazla 3 açık oturumu olur (tenant ayarı 1–10); aktif oturum en fazla 4 saat (tenant ayarı).
- V9: Chat ve dosya içeriği sunucuda saklanmaz; yalnızca meta veri (dosya adı, boyut, SHA-256, yön, sonuç) tutulur.
- V10: Müşteri yerel girdisi önceliklidir: müşteri fare/klavye kullandığında uzaktan girdi 1 sn askıya alınır.
- V11: Platform önceliği: Windows (MVP) → macOS → Linux.
- V12: 2FA (TOTP) Super Admin ve Admin için zorunlu, teknisyen için tenant ayarıyla zorunlu kılınabilir (varsayılan açık).
- V13: "Kötüye kullanımı bildir" bağlantısı `ABUSE_EMAIL` ortam değişkenine gider; değer verilmezse Super Admin e-postası kullanılır (S11).

## 8. Riskler ve açık sorular
### Riskler
| # | Risk | Etki | Önlem | Sahibi |
|---|---|---|---|---|
| R1 | Kod imzalama sertifikası yok (K8, ADR-0010): SmartScreen/AV imzasız istemciyi uyarır veya engeller | Yüksek: tam erişim çalışmayabilir | SmartScreen "Ek bilgi → Yine de çalıştır" rehberi (AC-27), tekrarlanabilir build + SHA-256 + attestation (AC-94, AC-96), AV yanlış pozitif bildirimi, kurumsal politikada tarayıcı moda düşüş; SignPath Foundation başvurusu Faz 4 ile paralel | devops |
| R2 | AV/EDR uzaktan destek araçlarını "remote access tool" olarak işaretleyebilir | Yüksek | Tekrarlanabilir build, AV üreticilerine false-positive bildirimi, kurumsal müşteriye SHA-256 hash allowlist dokümanı | devops, teknik-yazar |
| R3 | UIPI: admin'siz süreç yükseltilmiş pencerelere, UAC ve Secure Desktop'a girdi gönderemez; yeniden başlatma sonrası bağlantı kopar | Orta: bazı destek işleri yapılamaz | Kapsam dışı olarak belgelendi, konsolda uyarı, kılavuzda anlatım | proje-yoneticisi |
| R4 | Kurumsal ağlarda yalnızca 443 açık olabilir; 443 sunucuda dolu | Yüksek: bağlantı kurulamaz | TURN-TLS 443 ayrı IP/VM (ADR-0007, K3) | mimar, devops |
| R5 | AppLocker/WDAC kurumsal politikaları imzasız, bilinmeyen exe'yi engeller | Orta | Tarayıcı-yalnız yedek mod; kurumsal müşteriye hash allowlist rehberi | teknik-yazar |
| R6 | Kötüye kullanım (sosyal mühendislik dolandırıcılığı) | Yüksek itibar riski | Kimliği doğrulanmış teknisyenler; teknisyen doğrulama kodu + lobi kabul kodu (AC-112); dolandırıcılık uyarısı ve kötüye kullanım bildirimi (AC-125); görünür kontrol göstergesi; zorla sonlandırma (AC-114); gizli mod yok; audit | guvenlik |
| R7 | TURN relay bant genişliği: 50 oturum × ~4 Mbps ≈ 200 Mbps; sunucu kapasitesi bilinmiyor | Orta | Kapasite ölçümü, oturum başına 8 Mbps relay tavanı (AC-21, S4) | devops |
| R8 | **Karar:** RustDesk kodu kullanılmaz (yalnız ilham); proje lisansı **Apache-2.0** (K7, ADR-0011). — AGPL kod kullanımı kaynak açma yükümlülüğü doğurabilirdi | Kapandı | CI lisans taraması, AGPL yasağı (AC-94) | mimar |
| R9 | Müşterinin destek sekmesini/önizlemeyi de paylaşması "sonsuz ayna" etkisi | Düşük | Kılavuzda uyarı, istemcide kendi penceresini yakalamadan hariç tutma | frontend-dev |
| R10 | Gecikme hedefleri istemci teknolojisine bağlıdır (donanım encoder) | Orta | Faz 4 başında prototip ölçümü (K4) | mimar |

### Açık sorular
| # | Soru | Varsayılan (cevap gelmezse) | Sahibi |
|---|---|---|---|
| S1 | **Karar (2026-11-10):** Go + Pion WebRTC, ekran yakalama + SendInput Windows API; RustDesk kodu kullanılmaz, yalnız tasarım ilhamı (ADR-0004, ADR-0011). | — | Kapandı |
| S2 | Yayın alan adı ve TLS sertifikası nedir (`destek.<domain>`)? (mimari K1) | Staging: IP:port + Caddy `tls internal`; prod: Let's Encrypt, ayrı portta | Kullanıcı |
| S3 | **Karar:** TURN-TLS 443 ayrı public IP/VM üzerinde; dev/staging'de coturn publish sunucusunda farklı portlarda (ADR-0007, K3). Prod IP'si açık. | 5349 TLS ile başlanır, R4 izlenir | Kullanıcı + devops |
| S4 | Beklenen eşzamanlı oturum sayısı ve sunucu bant genişliği? | 50 eşzamanlı, 1 Gbps | Kullanıcı |
| S5 | Chat geçmişi oturum kaydına saklansın mı? | Hayır (V9) | Kullanıcı |
| S6 | Oturum kaydı (video) ileride istenecek mi; hangi fazda? | Sonra, ayrı doküman | Kullanıcı |
| S7 | Gözetimsiz erişim (unattended) ileride istenecek mi? Bu admin kurulumlu servis demektir | Kapsam dışı | Kullanıcı |
| S8 | **Karar:** ikisi birden — dosya adındaki kod (`Destek-48291376.exe`) otomatik + ad değişirse 8 haneli kodun elle girişi; kod kısa ömürlü (yalnız PENDING), deneme sınırlı (ADR-0006, AC-3, AC-97). | — | Kapandı |
| S9 | **Karar (K8):** sertifika ALINMAYACAK; istemci imzasız + tekrarlanabilir build + SHA-256 + GitHub build attestation; SignPath Foundation başvurusu Faz 4 ile paralel (ADR-0010). AC-27, AC-92, AC-94, AC-96 2026-11-11'de revize edildi. | — | Kapandı |
| S10 | Platform önceliği Windows → macOS → Linux doğru mu? | Evet (V11) | Kullanıcı |
| S11 | Kötüye kullanım bildirim adresi (`ABUSE_EMAIL`, mimari K10) nedir? | Super Admin e-postası (V13) | Kullanıcı |

## 9. Kontrol listesi kararları
Kaynak: `~/.claude/checklists/tasarim-kontrol-listesi.md` bölüm 1, 5, 8, 9.

| Madde | Karar | Gerekçe |
|---|---|---|
| 1. Kimlik doğrulama yöntemi | Kapsamda: e-posta+şifre (argon2/bcrypt) + TOTP 2FA; SSO/LDAP Sonra | Güvenlik ürünü; ortak standart 1.3 |
| 1. Şifre politikası, sıfırlama, kilit | Kapsamda: min 12 karakter, e-posta ile sıfırlama (SMTP), hesap+IP 5 hatalı → 15 dk, hesap geneli 20/saat → 15 dk + bildirim (AC-65) | Ortak standart 1.3, G-23 |
| 1. Yetkilendirme / IDOR | Kapsamda: rol + yetki toggle; her uçta tenant + sahiplik kontrolü; `sessions.terminate` alt yetkisi (Admin açık, User kapalı) | Ortak standart 1.3, G-04 |
| 1. Oturum yönetimi | Kapsamda: oturum süresi 8 saat, boşta 30 dk; "tüm cihazlardan çıkış"; hesap/yetki değişiminde aktif destek oturumunun sonlanması (AC-115) | Teknisyen hesabı yüksek ayrıcalıklı |
| 1. Davet / hesap silme (KVKK) | Kapsamda: Admin kullanıcı oluşturur (ilk girişte şifre değişimi); müşteri verisi anonimleştirme; self-servis kayıt Kapsam dışı | Kurumsal ürün |
| 1. Servis hesapları / API anahtarları | Kapsam dışı (public API yok); TURN secret rotasyonu Kapsamda (runbook) | — |
| 5. 5 durum | Kapsamda: her ekran; ayrıca bağlantı durumları (bekliyor/lobide/bağlanıyor/aktif/koptu/bitti) | Kalite standardı |
| 5. Form doğrulama | Kapsamda: alan bazlı hata, sunucu hatası forma yansır | Kalite standardı |
| 5. Yıkıcı işlem onayı | Kapsamda: oturum sonlandırma/iptal/zorla sonlandırma, kullanıcı pasife alma onaylı; müşterinin "Kontrolü kapat" butonu onaysız ve anlık (güvenlik gereği) | — |
| 5. Responsive | Kısmen: yönetim ekranları responsive; canlı konsol ≥ 1280 px masaüstü; mobil müşteri Kapsam dışı | Teknik kısıt |
| 5. Erişilebilirlik | Kapsamda: WCAG 2.1 AA | — |
| 5. Yerelleştirme | Türkçe Kapsamda; İngilizce Sonra; RTL Kapsam dışı | — |
| 5. Bildirim stratejisi | Kapsamda: toast (Sonner) anlık olaylar, e-posta yalnız link gönderimi, şifre sıfırlama ve hesap kilidi bildirimi; push Kapsam dışı | — |
| 5. Yavaş ağ | Kapsamda: adaptif bitrate, kalite göstergesi, 120 sn reconnect | WebRTC doğası |
| 5. Başlıklar, 404/500 | Kapsamda; müşteri için özel 410 (süresi dolmuş/kullanılmış) ekranları | — |
| 5. Tasarım token'ları | Kapsamda: tek token seti, DESIGN.md | Ortak standart 1.8 |
| 8. KVKK | Kapsamda: müşteri aydınlatma metni (tenant düzenler, sürümlü, AC-127), açık onay kaydı (görüntüleme ve kontrol için ayrı), saklama süresi, anonimleştirme | Ekran içeriği kişisel veri içerebilir |
| 8. Çerez / lisanslar | Kapsamda: yalnız zorunlu çerezler (bilgi notu); proje Apache-2.0; 3. parti lisans taraması, AGPL yasağı | K7, R8 |
| 8. Finansal veri | Kapsam dışı | Ürün finansal işlem içermez |
| 9. Kapsam dışı listesi | Yazıldı (11 madde) | — |
| 9. Ölçülebilir AC | Yazıldı (ayrı dosya, 128 AC) | — |
| 9. Riskler / açık sorular | Yazıldı (R1–R10, S1–S11) | — |
| 9. Definition of Done | `~/.claude/checklists/kalite-standartlari.md` geçerli; ek: istemci imzasız, tekrarlanabilir build + SHA-256 + attestation doğrulaması ve temiz-makine iz testi | K8 |
| 9. Dokümantasyon planı | Kapsamda: README, docs/api.md, KULLANIM_KILAVUZU, DATASHEET, PDF, ADR'ler, kurumsal hash allowlist rehberi, SmartScreen rehberi | Ortak standart 1.7 |
| Sonra | Oturum kaydı, çoklu teknisyen, ses, clipboard, macOS/Linux istemci, SSO, SMS/WhatsApp link, İngilizce, ITSM entegrasyonu, SAS (DTLS parmak izi) doğrulaması (G-14), oturum sonu müşteri özeti (G-17-6; AC-107 ile çelişir, tasarım gerekir), OpenSSF Scorecard (G-18), SignPath Foundation imzası (ADR-0010) | Unutulmasın diye |

### Sonra / açık — P7'den (2026-11-11)
Kaynak: `docs/qa-raporu.md` (P7, Tur 2 — QA-P7-T2-1), `docs/implementation.md` Agent P7 bölümleri, `docs/guvenlik-raporu.md` (P7, S7-x), `docs/db-notlari.md` (P7).

| Madde | Ne yapılacak | Sahip | Ne zaman |
|---|---|---|---|
| Windows elle testi (P7) | `docs/implementation.md` Agent P7 bölümlerindeki adım 25–42 gerçek Windows makinesinde koşulur; her adımın sonucu (geçti/kaldı + kanıt) implementation.md'ye yazılır. Kapsar: AC-48, AC-49, AC-100, AC-102, AC-103, AC-104, AC-105 ve AC-116 Win32 bağlaması; S7-3, S7-5, S7-6, S7-7, S7-12 bulgularının gerçek ortam doğrulaması | kullanıcı (Windows test makinesi) (+ backend-dev/Go düzeltme) | **P8 kod turundan önce** (S7-12 düzeltildi — P7 Tur 3; P6 Windows elle testiyle aynı oturumda) |
| S7-11 — commit sonrası oda çağrıları | P9/P10 servisleri oturum sonlandırma ve yetki değişikliğinde `app.rooms.endByTechnician` / `app.rooms.applyPermChange`'i DB commit'inden **sonra** çağırmalı; qa bunu kontrol eder | backend-dev (P9/P10) + qa-denetci | P9/P10 giriş şartı |
| govulncheck — çağrılmayan kayıtlar | Bildirilen ama çağrılmayan `golang.org/x/net` v0.60.0 ve `golang.org/x/crypto` v0.57.0 kayıtları Dependabot ile yükseltilir; govulncheck yeşil kalır | backend-dev (Go) / devops (Dependabot) | Sonraki bağımlılık turu (en geç P13) |
| Kararsız test — AC-39 axe e2e | P5 AC-39 axe e2e testi ara sıra 30 sn zaman aşımına düşüyor; kök neden giderilir (yalnız süreyi artırmak çözüm sayılmaz); CI'da 20 ardışık koşuda 0 hata | frontend-dev | P8 ilk turu |
| DB enum CHECK harf duyarsızlığı | `utf8mb4_unicode_ci` nedeniyle enum CHECK kısıtları harf duyarsız karşılaştırıyor; binary harmanlama / `BINARY` karşılaştırma ya da risk kabulü kararı (`docs/db-notlari.md` P7) | mimar (+ dba uygulama) | P8 öncesi |

Not: S7-9 (yönetici olarak çalışan istemci, `selfElevated`) mimar kararıyla P7 Tur 2 içinde uygulanıyor (`docs/mimari-protokol.md` K8); ertelenmedi.

### Sonra / açık — P6'dan (2026-11-11)
Kaynak: `docs/implementation.md` "Agent (P6)" Aşama 1–3, "Backend P6", "DevOps (P6)"; `docs/guvenlik-raporu.md` "P6 kod turu 1"; `docs/qa-raporu.md` (P6); mimar kararı (ADR-0004 r2, ADR-0006 r3, ADR-0010 r3). TEST-P5-4 P5 tablosunda, burada tekrarlanmaz.

| Madde | Ne yapılacak | Sahip | Ne zaman |
|---|---|---|---|
| TEST-NAT-3 (Yüksek, ortam şüphesi) / AC-41 | NAT sonrası 1080p ölçümünde UDP relay yolunda ~42. sn'den sonra kayıp patlaması (%12,7, BWE 2500→71 kbps); TCP/TLS relay'de kayıp 0; sunucuda kayıp izi yok (NIC/UDP buffer/conntrack temiz). İki tarayıcı aynı Mac'te (tek upload hattı) → ölçüm iki ayrı ağdan tekrarlanır; eşzamanlı sunucu `tcpdump`/`nstat` + pfSense `pfctl -si` ile kaybın yeri ayrılır. AC-41 (1080p ≥15 FPS) bu tekrar ve gerçek Windows/Chrome testiyle kapanır | test-operatoru + devops (+ kullanıcı: ikinci ağ) | ~~P7 başlamadan~~ → **P8 kod turundan önce** (2026-11-11: yapılmadı, ortam/Windows makinesi gerekiyor; yeniden tarihlendi) |
| TEST-NAT-2 (Orta) | Uygulama akışında yalnız `turn:…:3478?transport=tcp` verilince ICE `checking→disconnected`; minimal Chrome ve `turnutils_uclient` ile aynı yol çalışıyor (altyapı temiz, devops tanısı implementation.md). `chrome://webrtc-internals` dökümüyle `ice.servers`/`setConfiguration` zamanlaması incelenecek | frontend-dev + test-operatoru | P7 ilk turu |
| TEST-NAT-1 (Orta, kurulum) | Staging TURN-TLS sertifikası özel CA ile; test makinesine `deploy/turn/certs/ca.crt` kök depoya kurulmadan yalnız-TLS (AC-23) yolu çalışmaz. Prod'da genel CA'lı sertifika (P13) | kullanıcı (staging testi) / devops (P13) | Staging testinde |
| TEST-NAT-4 (Düşük) | İlk ölçüm koşusunda 1 işaretleme çizgisi müşteriye ulaşmadı; sonraki 440 örnekte tekrarlanmadı, spec kayıpları ayrıca sayıyor | test-operatoru | İzlenecek |
| Windows elle testi | Temiz Win10 22H2 / Win11 VM'de: AC-95 (tek dosya ≤ 40 MB, açılış ≤ 5 sn), AC-96 (SHA-256/SmartScreen "Yine de çalıştır" yolu), AC-103, AC-106 (monitör seçimi, gösterge), AC-110 (DPI/manifest), AC-118 (Procmon DLL araması 0), gerçek NTFS'te `Zone.Identifier`, AC-108 iz testi (`apps/agent-win/test/trace-check.ps1` yazılacak), gerçek yakalama FPS — AC-41 (1080p ≥ 15 fps; DXGI/MF kodu bu ortamda hiç çalıştırılamadı) | test-operatoru (+ backend-dev/Go düzeltme) | ~~P7 başlamadan~~ → **P8 kod turundan önce** (2026-11-11: yapılmadı, ortam/Windows makinesi gerekiyor; yeniden tarihlendi) |
| Fare imleci | İmleç görüntüye çizilmiyor (DXGI kare imleci içermez): `DXGI_OUTDUPL_FRAME_INFO.PointerPosition` + `GetFramePointerShape` ile NV12 karesine bindirme | backend-dev (Go) | P8 öncesi / ayrı küçük iş — **hedef "P7 öncesi" idi, P7'de yapılmadı; 2026-11-11'de yenilendi** (uzaktan kontrol imleçsiz zor kullanılır) |
| Donanım MFT yedeği | Donanım H.264 MFT oturum sırasında hata verirse/takılırsa yazılım MFT'ye otomatik geçiş (bugün yalnız açılışta seçim yapılıyor) | backend-dev (Go) | Windows elle testi sonucuna göre; en geç P13 |
| Dirty-rect | `GetFrameDirtyRects`/`MoveRects` ile yalnız değişen bölgenin dönüştürülmesi (CPU BGRA→NV12 maliyeti); AC-41 ölçümü 15 fps altında kalırsa öne çekilir | backend-dev (Go) | Sonra (ölçüme bağlı) |
| Koyu tema (istemci) | Windows istemci pencerelerinde sistem koyu temasına uyum (ortak standart 1.6; bugün yalnız açık) | backend-dev (Go) | P13 |
| Repo görünürlüğü + attestation | Repo private iken GitHub build provenance attestation üretilemiyor/doğrulanamıyor (T13, G-07); repo public yapılacak (veya Enterprise), environment onayı + `v*` tag ruleset etkinleştirilecek, `verify-and-publish.sh` `--no-attestation` olmadan çalıştırılacak | kullanıcı + devops | Prod açılışı öncesi (P10) |
| Staging istemci testi | Staging (185.126.217.99:4450) Caddy iç CA kullanıyor; istemci sistem kökleriyle doğruladığı için (AC-109) test makinesine Caddy kök CA'sı kurulmalı **veya** staging'e gerçek alan adı + genel sertifika verilmeli. Karar ve adımlar runbook'a | devops (+ kullanıcı: alan adı) | Windows elle testinden önce |
| SignPath | SignPath Foundation başvurusu (ADR-0010; kod yok, süreç). Kabul edilirse `agent-win.yml`'e imza adımı | kullanıcı (+ devops) | P6 ile paralel başladı; sonuç gelince |
| x/net v0.62 | `golang.org/x/net` v0.60.0 → v0.62.0: GO-2026-6866 / GO-2026-6860 (`x/net/html`) ve GO-2026-5932 (`x/crypto/openpgp`) istemciden erişilemiyor, yalnız modül düzeyinde (govulncheck 0 erişilebilir); bir sonraki Dependabot/sürüm yükseltmesinde güncellenecek, govulncheck yeşil kalmalı | backend-dev (Go) | Sonraki bağımlılık turu (en geç P13) |

### Sonra / açık — P5'ten (2026-11-11)
Kaynak: `docs/guvenlik-raporu.md` (P5 turları), `docs/qa-raporu.md` (P5); mimar kararı (`docs/mimari.md` §3.1 `session_files` risk kabulü, §10.3 P5).

| Madde | Ne yapılacak | Sahip | Ne zaman |
|---|---|---|---|
| S-P5-T2-4 (risk kabulü) | `session_files` satırı raporlayan tarafı taşımıyor; gönderen/alıcı raporları `fid` ile eşleşmiyor → değiştirilmiş müşteri istemcisi sahte `TO_CUSTOMER` satırı yazabilir (bugün yalnız audit actor ile ayrılır). Çözüm: `reporter` kolonu (`TECH\|CUSTOMER`) **veya** iki taraf raporunun `fid` ile eşleştirilmesi; geçmiş/CSV yalnız eşleşen ya da teknisyen raporlu satırı "doğrulanmış" gösterir | dba + backend-dev | P12/P13 |
| S-P5-T2-1 kalanı | Chromium `showSaveFilePicker` seçim anında hedef dosyayı oluşturuyor/boşaltıyor: özet bozuk (CORRUPT) çıkarsa 0 baytlık dosya kalır veya üzerine yazılan mevcut dosya kaybolur. Gerçek tarayıcıda doğrulanacak; kayıt diyaloğu öncesine "Var olan bir dosyanın üzerine yazmayın; aktarım bozulursa dosya boş kalabilir" uyarı metni eklenecek | frontend-dev | P13 öncesi |
| QA-P5-4 / AC-41 | 1080p ≥15 FPS ölçümü: frontend headless Chromium'da deniyor; headless'ta anlamlı ölçülemezse staging gerçek tarayıcı ölçümüne ertelenir (NAT ölçümleriyle birlikte, bkz. QA-P4-10), sonuç `docs/test-raporu.md` | test-operatoru (+ frontend-dev) | NAT açılınca staging ölçümü; en geç P6 başlamadan |
| TEST-P5-4 (Düşük) | Sohbet: alıcı tarafı saniyede 5 mesaj sınırı (`apps/web/lib/dc/rate.ts` `IN_LIMITS.chat`) aşılınca fazla mesajlar sessizce düşüyor; gönderen tarafa aynı sınır + "çok hızlı yazıyorsunuz" uyarısı eklenecek (dosya teklif öz-sınırı gibi) | frontend-dev | P7 ilk turu |
| AC-57 p95 | İşaretlemenin müşteri tarafında görünme gecikmesi (RTT < 100 ms ağda p95 < 200 ms) staging'de gerçek ağ/TURN yolu üzerinden tekrar ölçülür; yerel/headless sonuç ön kanıttır | test-operatoru | NAT açılınca staging ölçümü |

### Sonra / açık — P4 düzeltme turundan (2026-11-11)
Kaynak: `docs/qa-raporu.md` QA-P4-10; mimar kararı (`docs/mimari.md` §10.3 P4).

| Madde | Ne yapılacak | Sahip | Ne zaman |
|---|---|---|---|
| QA-P4-10 — AC-23, AC-40, AC-42 staging ölçümleri | P4 kapanışından ayrıldı. pfSense'te TURN NAT kuralları (3478/udp+tcp, 5349/tcp, 49160–49199/udp; mimari §8.3.1) açılınca: UDP kapalı/5349 açık ağda TURN-TLS bağlantısı (AC-23; 443 doğrulaması P13), medya gecikme/akıcılık (AC-40) ve encoder/çözünürlük ayarları (AC-42) staging'de ölçülüp `docs/test-raporu.md`'ye yazılır. coturn kurulu, sunucu içi testler geçti | kullanıcı (NAT) → test-operatoru (+ devops) | NAT açılınca; en geç P6 başlamadan (P6 istemci ölçümleri aynı yolu kullanır) |
| S-P4-T3-1 (Düşük) | Misafir `rs.resume.*` kaydına zaman damgası; 120 sn'den eski kayıt okunmaz (kapatılan sekmeyi yeniden açma/çoğaltma ile paylaşılan bilgisayarda dönüş riski) | frontend-dev | P5 ilk düzeltme turu |
| S-P4-T3-2 (Düşük) | Misafir reconnect yeniden deneme süresi ≥100 sn (sunucu ölü soketi ~90 sn'de düşürür); `reconnect.conflict` audit'i oda başına dakikada 1 | frontend-dev + backend-dev | P5 ilk düzeltme turu |
| ~~S-P4-T2-2 kalan~~ **kapandı 2026-11-11** | `apps/server/scripts/` prod imajına giriyor (koruma: `NODE_ENV` + `E2E_REAL_ALLOW=1`); imajdan çıkarılması | devops | Kapandı (P5): `apps/server/Dockerfile` `prod-deps` aşamasında `rm -rf apps/server/scripts`; yerel `docker build --target runtime` imajında `/app/apps/server/scripts` yok, `migrate` hedefinde `prisma/seed.ts` + `tsx` mevcut (implementation.md DevOps P5) |
| TEST-P4-3 (Düşük) | "Permissions policy violation: camera" konsol uyarısı — kod kamera istemiyor; gerçek Chrome'da doğrulanacak (Chromium fake-media yan etkisi şüphesi) | kullanıcı / test-operatoru | Staging testinde |

### Sonra / açık — P3 kod turundan (2026-11-11)
Kaynak: `docs/guvenlik-raporu.md` "P3 kod turu", `docs/qa-raporu.md` P3. S-P3-1/2/4/5/6/7/9 P3 düzeltme turunda kapatılır (buraya yazılmaz).

| Madde | Ne yapılacak | Sahip | Ne zaman |
|---|---|---|---|
| S-P3-8 (Düşük, **P7 giriş şartı**) | WS 60 sn yeniden doğrulaması yetki daraltmasını yansıtmıyor; `rooms.endByTechnician` çağıransız (AC-115). P7'de: yeniden doğrulamada `user_permissions` tazelenir, caps daralırsa `caps.update`/`control.revoke`; pasifleştirme/rol değişimi/logout-all servisleri `endByTechnician`'ı çağırır; entegrasyon testi (mimari §10.2/§10.3 P7) | backend-dev | P7 (P7 başlamadan şart) |
| ~~S-P3-T2-1 (Düşük)~~ **kapandı 2026-11-11** | `deploy/turn/host-firewall.sh`: kurallar geçici zincirde kurulup atomik değiştirilecek (yarım uygulamada fail-open olmasın); IP doğrulaması oktet ≤ 255 + çok satırlı değer reddi (entrypoint dahil); `reserved_ok` kapsama kontrolü; `check` hatası journald'a `err` | devops | Kapandı: staging `install` geçici zincir + atomik değiştirme ile uygulandı, `check` OK, `journalctl -u remote-turn-fw -p err` boş (test-raporu "P3 staging altyapı kanıtı") |
| ~~S-P3-T2-2 (Düşük)~~ **kapandı 2026-11-11** | systemd timer repo klonundaki betiği root olarak çalıştırıyor: `install` betiği `/usr/local/sbin/remote-turn-fw` (root 0755) olarak kopyalasın, değerler `/etc/default/remote-turn-fw` (0600); runbook §9.2.1'e "betik güncellenince `install` yeniden çalıştırılır" notu | devops | Kapandı: staging'de `ExecStart=/usr/local/sbin/remote-turn-fw ensure`, `cmp` kurulu kopya = repo, `/etc/default/remote-turn-fw` root 0644 (secret içermez; runbook §9.2.1 gerekçesi), runbook notu var |
| S-P3-2 staging kanıtı — **güvenlik kısmı kapandı 2026-11-11, pozitif relay↔relay açık** | Staging yayınında `systemctl is-active remote-turn-fw.timer`, `ss -tlnp` (5766 yok, 9641 yalnız 127.0.0.1) ve `ss -ulnp` çıktısı test raporuna eklenecek (runbook §9.2.3) | devops + test-operatoru | Kapandı (güvenlik): §9.2.3 çıktıları + `test-denied.sh` bölüm 4 DROP satırları (3480/3478/53) PASS, test-raporu "P3 staging altyapı kanıtı". **Açık:** aralık içi relay↔relay echo (49199) staging'de hairpin gerektirir — pfSense NAT + NAT reflection açılınca `sudo -E ./test-denied.sh` yeniden koşulur (runbook §8.2) |
| S-P3-3 (Düşük) — prod IPv6 | TURN host'unda global IPv6 varsa relay'in IPv6 peer'lara açılmadığı (relay-ip/listening-ip yalnız IPv4 ya da host /64 + sağlayıcı IPv6 bloğu denied listede) prod ağında doğrulanacak; `test-denied.sh` IPv6 allocation denemesi PASS, sonuç runbook'a (ADR-0007 r5 madde 5). Staging'de global IPv6 yok | devops | P13 / prod açılışı öncesi |

### Sonra / açık — P2 kapanışından (2026-11-11)
Kaynak: `docs/guvenlik-raporu.md` (P2 turları), `docs/qa-raporu.md` (P2 tur 3). Kritik/Yüksek açık yok.

| Madde | Ne yapılacak | Sahip | Ne zaman |
|---|---|---|---|
| S-P2-4 (Düşük, kabul edilen kalan risk) | CGNAT arkasında aynı /24'ü paylaşan müşteriler, birinin hatalı kod denemeleriyle birlikte 15 dk kilitlenebilir (link yolu etkilenmez). 429 ekranı linke yönlendiriyor (metin düzeltildi); önek bazında 429 sayısı alarm sayacına eklenecek | backend-dev | P3 |
| S-P2-5 (Düşük) | Staging'de Caddy'nin gerçek istemci IP'sini gördüğü IPv4 ve IPv6 ile ayrı ayrı doğrulanacak (`request.remote_ip`); `172.30.0.1` görünürse userland-proxy kapatılıp IPv6 açılacak ya da yayın yalnız IPv4'e bağlanacak; sonuç runbook'a | devops | P3 öncesi **Durum (2026-11-11): IPv4 GEÇTİ.** NAT 4450 açıldı (kaynak adres korunuyor); dış makineden audit IP ve Caddy `remote_ip` istemcinin genel IPv4'üyle eşleşti. IPv6: staging VM'de global IPv6 yok, yayın yalnız IPv4 → prod ağında ayrıca doğrulanacak (açık) |
| P3 giriş şartı 1 | `GET /public/agent/download?ref=` kod yolu gibi hız sınırlı olacak ve yalnız PENDING oturumda yanıt verecek (`sessionRef` süresiz geçerli, dosya adı kodu taşır) | backend-dev | **P6'ya bağlandı (2026-11-11):** bağlayıcı gereksinim mimari-api public tablosu (download satırı) + mimari §10.2/§10.3 P6 satırı (test: 302/410/404/429) |
| P3 giriş şartı 2 | join/admit tüketimi tek atomik `UPDATE … WHERE status='PENDING' AND expires_at > now` ile; iptal/süre dolumu ile yarışta tek kazanan (P2 iptal kalıbı örnek) | backend-dev | P3 — **Karara bağlandı (2026-11-11):** mimari-protokol §3.2 (SQL, count=0 eşlemesi, yarış testi), mimari-akislar A1/A2 |
| P3 giriş şartı 3 | Public resolve `Origin` zorunlu tutuyor (routes.ts), Agent (P6) tarayıcı değil: ayrı, belgelenmiş bir Origin değeri ya da `clientKind=AGENT` için Origin muafiyeti kararı (mimari/ADR) | mimar | **Kapandı (2026-11-11): ADR-0012** — Origin varsa allowlist + BROWSER, yoksa yalnız AGENT (+`Sec-Fetch-*` yok); join'de kind nonce'tan; mimari-api "Public istemci türü", T27. Guard P3'te (backend-dev) |
| P3 coturn staging NAT | Üst NAT'ta 185.126.217.99 → 192.168.25.10: 3478/udp, 3478/tcp, 5349/tcp, 49160–49199/udp (1:1, kaynak adres korunarak; tercihen hairpin) — mimari §8.3.1 | Kullanıcı (ağ yöneticisi) + devops (runbook) | P3 coturn testinden önce |
| QA önerisi | `apps/web/lib/startup-check.ts` için birim testi: `process.exit` taklit edilerek sır yokken `exit(1)`, sır varken çağrılmadığı doğrulanacak | frontend-dev | Sonra |
| Staging teknisyen hesabı | Seed teknisyen oluşturmuyor; P9 kullanıcı yönetimine kadar ADMIN/USER hesabı SQL ile eklenir. Prosedür runbook §6'ya yazılacak | devops | P3 öncesi **Durum: tamam (2026-11-11)** — `deploy/staging-users.sh`, runbook §6; staging'de demo tenant + ADMIN + USER oluşturuldu, parolalar `/opt/remote/deploy/ACCESS.txt` |
