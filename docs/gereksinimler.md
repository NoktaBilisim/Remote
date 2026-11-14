# Gereksinimler — Remote Support (Uzaktan Destek) Platformu
Tarih: 2026-11-12   Durum: TASLAK (2026-11-10: tam erişim MVP'de; 2026-11-11: `docs/mimari.md` §13 AC değişiklik talebi ve K8 işlendi; 2026-11-12: E9 Müşteri destek talebi eklendi — kullanıcı kararı, model A)

> Kabul kriterleri (AC-n) boyut nedeniyle ayrı dosyadadır (bu dokümanın 5. bölümüdür, ayrılmaz parçasıdır):
> `/Users/mennan/Projeler/Remote/docs/gereksinimler-kabul-kriterleri.md` (dizin) →
> `/Users/mennan/Projeler/Remote/docs/gereksinimler-kabul-kriterleri-e1-e4.md`,
> `/Users/mennan/Projeler/Remote/docs/gereksinimler-kabul-kriterleri-e5-e8.md` ve
> `/Users/mennan/Projeler/Remote/docs/gereksinimler-kabul-kriterleri-e9.md` (E9, AC-129..AC-164).
> E9'un kapsamı, NFR'leri, varsayımları, riskleri, açık soruları ve paket önerisi: `/Users/mennan/Projeler/Remote/docs/gereksinimler-e9.md`.
> E10 (Müşteri firmalar ve kalıcı istemci) kabul kriterleri: `/Users/mennan/Projeler/Remote/docs/gereksinimler-kabul-kriterleri-e10.md` (AC-165..AC-195). Kapsamı, NFR'leri, varsayımları (V21–V28), riskleri (R19–R24), açık soruları (S18–S21) ve paket önerisi: `/Users/mennan/Projeler/Remote/docs/gereksinimler-e10.md`.
> Bölüm 9'un "Sonra / açık" tabloları (P2..P8b-1): `/Users/mennan/Projeler/Remote/docs/gereksinimler-sonra-acik.md` (2026-11-12'de içerik değiştirilmeden taşındı). Yeni paketlerin tabloları (P8b-2, P8c, P9) aynı dosyanın en üstündedir.
> E11 (ertelenen ve kapsam dışı işlerin yol haritası, 2026-11-14): `/Users/mennan/Projeler/Remote/docs/gereksinimler-e11.md`; AC'ler `gereksinimler-kabul-kriterleri-e11.md` (AC-201..AC-244) ve `gereksinimler-kabul-kriterleri-e11-b.md` (AC-245..AC-297).
> P13b (prod açılışı, 2026-11-14; r2 2026-11-15): kapsam, revize AC'ler (AC-23, 91, 126, 200), yeni AC-298..AC-303 (AC-303: WhatsApp servis anahtarı, güvenlik S-P13b-3), K1/K3 kapanışı, riskler (R4 güncel, R34–R36, R38) ve ortamlar notu: `/Users/mennan/Projeler/Remote/docs/gereksinimler-p13b.md`. Tasarım: `docs/mimari-p13.md` §7, ADR-0018/0019/0020.
> Toplam: **65 kullanıcı hikâyesi, 303 kabul kriteri** (AC-1..AC-303; AC-196 2026-11-13, E9 WhatsApp servisi sistem ayarı; AC-197..AC-200 2026-11-14, E7 saklama ve yedek — P13a; AC-201..AC-297 2026-11-14, E11; AC-298..AC-302 2026-11-14 ve AC-303 2026-11-15, P13b prod açılışı).

## 1. Amaç ve iş değeri
Kurumsal müşterilere teknik destek verirken AnyDesk/TeamViewer gibi üçüncü taraf SaaS'a bağımlılığı kaldırmak. Tamamen self-hosted, uçtan uca şifreli (DTLS-SRTP), **tam erişimli** (uzaktan klavye/fare) bir destek platformu: teknisyen web panelinden çalışır; müşteri **kurulum ve admin yetkisi gerektirmeyen** taşınabilir "Hızlı Destek" uygulamasıyla tam erişim verir veya bu uygulama çalıştırılamıyorsa tarayıcıdan yalnızca görüntü paylaşır. Medya ve veri firmanın kendi sunucusundan çıkmaz; tüm oturumlar audit log ile denetlenir. Proje açık kaynaktır (Apache-2.0).
E9 (2026-11-12): Sık destek alan kurumsal müşteri, firmasına ait Hızlı Destek dosyasından teknisyene **destek talebi** açabilir. Talep kabul edildiğinde link veya kod gerekmeden bağlantı kurulur.

## 2. Kullanıcılar / roller
| Rol | Açıklama |
|---|---|
| Super Admin | Nokta Bilişim. Tenant yönetimi, sistem ayarları (MySQL, sistem logosu, TURN), tüm oturum ve audit kayıtları, aktif oturumu zorla sonlandırma. |
| Admin | Destek veren firmanın (tenant) yöneticisi. Teknisyenler, yetki toggle'ları, tenant ayarları (SMTP, logo, TTL, aydınlatma metni), tenant oturum geçmişi, `sessions.terminate` yetkisiyle tenant'taki aktif oturumu zorla sonlandırma. E9: sabit indirme bağlantısı ve yenileme, talep bildirim kanalları ve alıcıları. |
| User (Teknisyen) | Oturum açar, bekleyen katılımcıyı kabul/ret eder, müşteri ekranını izler/kontrol eder (müşteri izin verirse), chat/dosya/işaretleme. Yalnızca kendi oturumlarını görür. E9: yetkisi varsa tenant'ın talep kuyruğunu görür ve talepleri kabul/ret eder. |
| Müşteri (Misafir) | Hesabı yok; standart (admin olmayan) Windows kullanıcısı varsayılır. Yalnızca geçerli oturum linki/kodu ile ve teknisyen kabulünden sonra o oturuma erişir. E9: firma dosyasıyla kimliksiz destek talebi açar; talebi kabul edilince o oturuma bağlanır. |

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
- **Müşteri destek talebi (Epik E9, 2026-11-12):** tenant başına sabit indirme bağlantısı ve firma dosyası; istemcide "Destek iste" formu (KVKK onayı aynı formda, bilgiler bu bilgisayarda hatırlanır ve "Bilgilerimi unut" ile silinir); tenant talep kuyruğu; panel (ses + toast), WhatsApp ve e-posta bildirimi; kabulle otomatik bağlanma; `support_requests.view/accept` yetkileri; hız sınırları; audit; oturum geçmişine bağlantı. Ayrıntı `docs/gereksinimler-e9.md`, AC-129..AC-164.
- **Müşteri firmalar ve kalıcı istemci (Epik E10, 2026-11-12):** "Müşteriler" modülü (CRUD, pasife alma, arama/filtre, müşteri başına kalıcı indirme bağlantısı ve `NoktaDestek-<etiket>-<ref>.exe`, bağlantı yenileme, `customers.view/create/edit/delete`, audit); Genel bağlantı adlandırması; talep/oturum → müşteri ilişkisi, Talepler ve geçmişte sütun/filtre/CSV, müşteri detayında talep/oturum geçmişi; Yeni Destek Oturumu'nda müşteri seçimi; başarılı oturumdan sonra bilgisayar kaydı (DPAPI), "Destek iste" + "Bağlantı kodum var" ana ekranı, "Bu bilgisayarı unut"; "Müşteriye nasıl gönderilir?" yardımı; istemci 0.10.0, 0.9.x uyumu. Ayrıntı `docs/gereksinimler-e10.md`, AC-165..AC-195.
- **Operasyon:** Docker Compose (uygulama + coturn + MySQL), publish sunucusuna deploy, health/metrics, yedekleme, runbook; istemci için imzasız, tekrarlanabilir build + SHA-256 + GitHub build attestation hattı (K8, ADR-0010).
- **Dokümantasyon:** README, KULLANIM_KILAVUZU, DATASHEET, PDF'ler.

### Kapsam DIŞI (açıkça)
1. **Gözetimsiz erişim (unattended access)** ve yeniden başlatma sonrası otomatik yeniden bağlanma. Kalıcı servis gerektirir; açık soru S7. E9 bunu değiştirmez (Sonra; kullanıcı ileride ayrı paket isteyebilir).
2. **UAC yükseltilmiş pencereler ve Secure Desktop** (UAC onay penceresi, Ctrl+Alt+Del ekranı, kilit/login ekranı) üzerinde kontrol. Admin'siz süreç Windows UIPI nedeniyle bunlara girdi gönderemez. Ekranda görünür olabilir ama kontrol edilemez; konsolda "Yükseltilmiş pencere — kontrol edilemiyor" uyarısı gösterilir (AC-105).
3. **macOS ve Linux istemcisi** MVP'de yok. Sıra: Faz 8 macOS (Ekran Kaydı + Erişilebilirlik izni, Developer ID + notarization), Faz 9 Linux (Wayland portal onayı). Bu platformlarda MVP'de tarayıcı-yalnız mod kullanılır.
4. **Oturum kaydı (video recording).** KVKK rızası, şifreli depolama, saklama politikası gerektirir. Sonra; açık soru S6.
5. **Çoklu teknisyen** (ikinci teknisyen, süpervizör izleme, oturum devri). Sonra.
6. **Sesli/görüntülü görüşme.** Sonra; MVP'de iletişim chat + telefon.
7. **Mobil cihazlar** (müşteri ve teknisyen konsolu). Mobil müşteri "desteklenmiyor" ekranı görür; yönetim ekranları responsive'dir.
8. **Pano (clipboard) senkronizasyonu**, uzaktan yazdırma, ses aktarımı, ters yön (teknisyen ekranını paylaşma). Sonra.
9. **Sunucuda dosya saklama / virüs taraması.** Dosyalar P2P DataChannel ile aktarılır.
10. **Chat içeriğinin sunucuda saklanması** (açık soru S5), SSO/LDAP, faturalama/lisanslama, public API, ITSM entegrasyonu, SMS/WhatsApp ile link gönderimi, İngilizce arayüz (altyapı i18n uyumlu; sonra), Windows ARM64. (Not 2026-11-12: E9'da WhatsApp yalnız **teknisyene talep bildirimi** için kullanılır; müşteriye link/durum gönderimi kapsam dışı kalır.)
11. **Ekran karartma / gizli mod** (müşteriden gizli işlem yapma) — kötüye kullanım riski; hiçbir fazda planlanmaz (G-17).
12. **E9'a özgü kapsam dışı maddeler:** tepsi simgesi/otomatik başlatma, web formundan talep, talep atama/SLA/mesai saatleri, kabul öncesi mesajlaşma. Tam liste `docs/gereksinimler-e9.md` §3.
13. **E10'a özgü kapsam dışı maddeler:** pencere bazlı paylaşım, müşteri portalı/girişi, müşteriye sistemden bağlantı gönderimi ve WhatsApp'ta müşteri firma bilgisi, müşteri başına SLA/fatura/Paraşüt eşlemesi, kalıcı silme ve CSV içe/dışa aktarma, bir bilgisayarda birden çok firma kaydı, tarayıcı modunda kayıt, kod alanına link yapıştırma; gözetimsiz erişim yine kapsam dışı (kayıt yalnız talep açar). Tam liste `docs/gereksinimler-e10.md` §3.

> Not (2026-11-14, E11): madde 1, 2 (gözetimsiz erişimle), 3–9, 10 (Windows ARM64 hariç), 12 ve 13'teki maddeler E11 yol haritasına taşındı (`gereksinimler-e11.md` §3). Madde 11 ve Windows ARM64 kapsam dışı kalır.

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

**Paket önerisi (2026-11-12):** E9, P9'dan **önce** yeni paket olarak yürür ve iki alt pakete bölünür: **P8b-1** (sunucu + panel: dba → backend ‖ frontend ‖ devops) ve **P8b-2** (Go istemci 0.9.0). E-posta bildirim kanalı (AC-151) SMTP ile birlikte P10'da kapanır. Ayrıntı ve AC dağılımı `docs/gereksinimler-e9.md` §9. `docs/mimari.md` §10 tablosunun güncellenmesi mimarındır.

**Paket önerisi P8c (2026-11-12, E10):** siyah ekran bug fix (yapıldı, 6701567) → **P8c-1** (sunucu + panel) → **P8c-2** (istemci 0.10.0) → P9. Ayrıntı ve AC dağılımı `docs/gereksinimler-e10.md` §9; mimari karşılığı `docs/mimari-e10.md` §12 ve `docs/mimari.md` §10.2.

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

**E9 — Müşteri destek talebi (2026-11-12)** — metinleri `docs/gereksinimler-e9.md` §4
- US-29: Firma dosyasını bir kez indirip saklama.
- US-30: "Destek iste" formuyla talep açma.
- US-31: Bilgilerin hatırlanması ve "Bilgilerimi unut".
- US-32: Durum, sıra ve bekleme bilgisi; iptal.
- US-33: Teknisyene panel, WhatsApp ve e-posta bildirimi.
- US-34: Talebi kabul edip linksiz bağlanma veya mesajla reddetme.
- US-35: Sabit bağlantı ve bildirim ayarlarının yönetimi (Admin).
- US-36: Talep kaynaklı oturumların geçmişte görünmesi.
- US-37: Kimliksiz talep ucunun kötüye kullanıma karşı korunması ve audit kaydı.

**E10 — Müşteri firmalar ve kalıcı istemci (2026-11-12)** — metinleri `docs/gereksinimler-e10.md` §4
- US-38: Müşteri firmaları kaydetme ve her birine ayrı, kalıcı indirme bağlantısı verme (Admin).
- US-39: Müşterinin bağlantısını yenileme veya müşteriyi pasife alma (Admin).
- US-40: Talepleri ve oturumları müşteri firmaya göre görme ve süzme (Teknisyen).
- US-41: Yeni destek oturumu açarken müşteri firmayı seçme (Teknisyen).
- US-42: Daha önce destek alınan dosyayı yeniden açınca "Destek iste" diyebilme (Müşteri).
- US-43: Aynı programda teknisyenin verdiği kodu girebilme — "Bağlantı kodum var" (Müşteri).
- US-44: Bilgisayarın hatırlandığını görme ve "Bu bilgisayarı unut" ile silme (Müşteri).
- US-45: Müşteriye dosyanın nasıl gönderileceğini panelde görme (Admin).

Not: US-27 ve US-28 2026-11-11'de eklendi; numaralar epik sırasına göre değil eklenme sırasına göre verilir (mevcut numaralar değişmez).

## 6. Fonksiyonel olmayan gereksinimler
- **Performans:** ilk kare p95 < 5 sn (doğrudan) / < 8 sn (TURN); uçtan uca görüntü gecikmesi p95 < 400 ms (RTT < 50 ms); uzaktan girdi gecikmesi p95 < 150 ms (RTT < 50 ms); işaretleme p95 < 200 ms. Tek sunucuda (4 vCPU / 8 GB) 50 eşzamanlı aktif oturum sinyalizasyonu; liste uçları 10.000 kayıtta < 500 ms.
- **Güvenlik:** TLS zorunlu (getDisplayMedia güvenli bağlam ister); DTLS-SRTP; medya uygulama sunucusundan geçmez (TURN yalnızca şifreli paket görür); strict CORS ve nonce tabanlı CSP, HSTS, `frame-ancestors 'none'`; rate limiting; WS Origin + kimlik doğrulama; tüm girdiler zod ile; uzaktan kontrol izni **istemci tarafında** uygulanır (sunucu P2P input'u engelleyemez, istemci izin yokken gelen her input olayını düşürür); teknisyen kabulü olmadan SDP/ICE ve TURN kimlik bilgisi verilmez (AC-112).
- **İstemci:** Windows 10 22H2+ ve Windows 11, x64; tek dosya ≤ 40 MB; çift tıktan karşılama ekranına ≤ 5 sn; istemci kendi dosyası yazmaz (`%TEMP%` dahil); tek disk yazımı müşterinin Kabul ettiği dosyadır (İndirilenler, `.part` → doğrulama → MOTW; yarım kalan `.part` silinir — ADR-0004 r2, 2026-11-11); kayıt defteri, servis, zamanlanmış görev, başlangıç kısayolu yok; imzasız, tekrarlanabilir build, SHA-256 `SHA256SUMS` ile ve GitHub build attestation ile doğrulanabilir (K8, AC-96). **Değişiklik talebi (E9, 2026-11-12):** tek istisna, müşterinin "Bu bilgisayarda hatırla" seçimiyle yazılan DPAPI korumalı ayar dosyasıdır (AC-136..AC-138); ADR-0004 revizyonu mimarındır.
- **E9 ekleri:** talepten panel bildirimine p95 ≤ 3 sn, kabulden bağlantı ekranına p95 ≤ 3 sn, WhatsApp/e-posta gönderimi ≤ 60 sn; kimliksiz talep ucu hız sınırları (AC-143/AC-144). Ayrıntı `docs/gereksinimler-e9.md` §5.
- **E10 ekleri:** müşteri listesi 1.000 müşteri / 10.000 talepte < 500 ms; kayıtlı bilgisayarda açılıştan ana ekrana ≤ 5 sn; talep oturumunda kabulden ilk kareye p95 ≤ 8 sn; kayıt anahtarı ≥ 128 bit, sunucuda yalnız özet; ref/kayıt geçersizlik yanıtları tek tip. İstemcinin tek iz istisnası (ayar dosyası) bilgisayar kaydını da kapsar (ADR-0004 eki). Ayrıntı `docs/gereksinimler-e10.md` §5.
- **Tarayıcı desteği:** teknisyen ve müşteri: Chrome/Edge son 2 sürüm (tam), Firefox son 2 sürüm (Document PiP yok), Safari macOS son 2 sürüm (müşteri, best-effort).
- **Erişilebilirlik:** WCAG 2.1 AA; klavye ile tam kullanım; durumlar yalnız renkle anlatılmaz.
- **Yerelleştirme:** arayüz Türkçe; tarihler UTC saklanır, Europe/Istanbul gösterilir; metinler i18n anahtarlarından.
- **Veri saklama:** oturum meta verisi ve onay kayıtları tenant ayarı (90–730 gün, varsayılan 365); audit log 730 gün; süresi dolan kayıtlar günlük işle anonimleştirilir/silinir. E9 talep kayıtları oturum meta verisiyle aynı süreye tabidir (AC-159). Ölçüt: AC-197..AC-199 (P13a; anonim kayıtların kalıcı silinmesi ertelendi, mimari §12 K27).
- **Ortamlar (P13b, 2026-11-14):** P13c'ye kadar ayrı staging yoktur; staging yığını yerinde prod'a terfi eder (ADR-0019). Prod kontrolleri "Nokta Test" firmasıyla yapılır. P13c (`stg.remote.noktabilisim.net`) prod açılışından sonra ve E11 kod paketlerinden önce kurulur.
- **K13 notu (P13b):** prod WhatsApp kanalı kapalı başlayabilir (Admin'ler e-posta bildirimi kullanır). Servisin başka tüketicileri olduğundan IP kısıtı yerine TLS ters vekil önerilir (mimari-p13 §7.11).
- **Gözlemlenebilirlik:** JSON log + korelasyon ID; `/health`, `/ready`, `/metrics` (aktif oturum, WS bağlantı, TURN tahsis sayısı).
- **Yedekleme:** MySQL günlük döküm, 14 gün saklama, geri yükleme testi runbook'ta. Ölçüt: AC-91, AC-200 (şifreli, uploads dahil, RPO ≤ 24 sa, RTO ≤ 60 dk).
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
- V14–V20 (E9): tenantRef yalnız dosya adında; "hatırla" kutucuğu varsayılan işaretsiz (2026-11-12 r2); talep kabulünde lobi kodu yok; kuyruk tenant genelinde; WhatsApp URL sistem düzeyinde; bekleme 30 dk / en çok 50 bekleyen; talep saklama süresi oturumla aynı. Metinler `docs/gereksinimler-e9.md` §6.
- V21–V28 (E10): bilgisayar kaydı başarılı oturumla kendiliğinden yazılır (kişisel veri yok); kayıt anahtarı bilgisayar başına sunucu üretimli; pasife alma `customers.delete` ile, kalıcı silme yok; toplam talep sayısı tüm durumları sayar; müşteri adı tenant içinde tekil; talep kabulünde lobi kodu yok; müşteri dosyası adı E9 biçimiyle aynı; kayıt tenant saklama süresi kadar kullanılmazsa geçersizleşir. Metinler `docs/gereksinimler-e10.md` §6.

## 8. Riskler ve açık sorular
### Riskler
| # | Risk | Etki | Önlem | Sahibi |
|---|---|---|---|---|
| R1 | Kod imzalama sertifikası yok (K8, ADR-0010): SmartScreen/AV imzasız istemciyi uyarır veya engeller | Yüksek: tam erişim çalışmayabilir | SmartScreen "Ek bilgi → Yine de çalıştır" rehberi (AC-27), tekrarlanabilir build + SHA-256 + attestation (AC-94, AC-96), AV yanlış pozitif bildirimi, kurumsal politikada tarayıcı moda düşüş; SignPath Foundation başvurusu Faz 4 ile paralel | devops |
| R2 | AV/EDR uzaktan destek araçlarını "remote access tool" olarak işaretleyebilir | Yüksek | Tekrarlanabilir build, AV üreticilerine false-positive bildirimi, kurumsal müşteriye SHA-256 hash allowlist dokümanı | devops, teknik-yazar |
| R3 | UIPI: admin'siz süreç yükseltilmiş pencerelere, UAC ve Secure Desktop'a girdi gönderemez; yeniden başlatma sonrası bağlantı kopar | Orta: bazı destek işleri yapılamaz | Kapsam dışı olarak belgelendi, konsolda uyarı, kılavuzda anlatım | proje-yoneticisi |
| R4 | Kurumsal ağlarda yalnızca 443 açık olabilir; 443 sunucuda dolu, TURN-TLS 5349'da (K3, 2026-11-14) | Yüksek: o ağlarda medya kurulamaz | Risk kabulü (ADR-0018); kılavuz ve DATASHEET'te ağ gereksinimleri (443/TCP, 3478 UDP/TCP, 5349/TCP, 49160–49479/UDP); 3 ayda bir gözden geçirme; ayda ≥ 3 vaka olursa ek IP talebi ve TURN 443 yeniden açılır (ADR-0018 m.6). Ayrıntı `docs/gereksinimler-p13b.md` §5 | kullanıcı, devops |
| R5 | AppLocker/WDAC kurumsal politikaları imzasız, bilinmeyen exe'yi engeller | Orta | Tarayıcı-yalnız yedek mod; kurumsal müşteriye hash allowlist rehberi | teknik-yazar |
| R6 | Kötüye kullanım (sosyal mühendislik dolandırıcılığı) | Yüksek itibar riski | Kimliği doğrulanmış teknisyenler; teknisyen doğrulama kodu + lobi kabul kodu (AC-112); dolandırıcılık uyarısı ve kötüye kullanım bildirimi (AC-125); görünür kontrol göstergesi; zorla sonlandırma (AC-114); gizli mod yok; audit | guvenlik |
| R7 | TURN relay bant genişliği: 50 oturum × ~4 Mbps ≈ 200 Mbps; sunucu kapasitesi bilinmiyor | Orta | Kapasite ölçümü, oturum başına 8 Mbps relay tavanı (AC-21, S4) | devops |
| R8 | **Karar:** RustDesk kodu kullanılmaz (yalnız ilham); proje lisansı **Apache-2.0** (K7, ADR-0011). — AGPL kod kullanımı kaynak açma yükümlülüğü doğurabilirdi | Kapandı | CI lisans taraması, AGPL yasağı (AC-94) | mimar |
| R9 | Müşterinin destek sekmesini/önizlemeyi de paylaşması "sonsuz ayna" etkisi | Düşük | Kılavuzda uyarı, istemcide kendi penceresini yakalamadan hariç tutma | frontend-dev |
| R10 | Gecikme hedefleri istemci teknolojisine bağlıdır (donanım encoder) | Orta | Faz 4 başında prototip ölçümü (K4) | mimar |
| R11–R18 | E9: firma dosyasının sızması (başkası o firma adına talep açar), değiştirilmiş firma dosyası, WhatsApp servisinin tek nokta olması, hatırlanan kişisel veri, kimliksiz uçta DoS, AC-108 ilke değişimi, P9/P10 bağımlılığı, uzun WS bağlantısı | Orta–Yüksek | `docs/gereksinimler-e9.md` §7 | guvenlik, mimar, devops |
| R19–R24 | E10: müşteri ref'i/bilgisayar kaydının sızması, kendiliğinden yazılan kaydın "iz bırakmaz" ilkesini zorlaması, 0.9.x uyumsuzluğu, müşteri yetkili kişi verisinin süresiz kalması, paylaşılan bilgisayar, siyah ekran düzeltmesinin gecikmesi | Düşük–Yüksek | `docs/gereksinimler-e10.md` §7; tehdit modeli `docs/mimari-e10.md` §5.5 | guvenlik, mimar, dba, backend-dev |

### Açık sorular
| # | Soru | Varsayılan (cevap gelmezse) | Sahibi |
|---|---|---|---|
| S1 | **Karar (2026-11-10):** Go + Pion WebRTC, ekran yakalama + SendInput Windows API; RustDesk kodu kullanılmaz, yalnız tasarım ilhamı (ADR-0004, ADR-0011). | — | Kapandı |
| S2 | Yayın alan adı ve TLS sertifikası nedir? (mimari K1) | **Kapandı (2026-11-14):** `remote.noktabilisim.net`, Let's Encrypt; staging yerinde prod'a terfi eder (ADR-0019). `docs/gereksinimler-p13b.md` §2 | Kapandı |
| S3 | TURN-TLS için ayrı IP/443 (mimari K3) | **Kapandı (2026-11-14):** aynı sunucu, TURN-TLS 5349/TCP, 443 yok (ADR-0018 risk kabulü, R4). `docs/gereksinimler-p13b.md` §2 | Kapandı |
| S4 | Beklenen eşzamanlı oturum sayısı ve sunucu bant genişliği? | 50 eşzamanlı, 1 Gbps | Kullanıcı |
| S5 | Chat geçmişi oturum kaydına saklansın mı? | Hayır (V9); 2026-11-14: E11'e taşındı (S25) | Kullanıcı |
| S6 | Oturum kaydı (video) ileride istenecek mi; hangi fazda? | Sonra, ayrı doküman | Kullanıcı |
| S7 | Gözetimsiz erişim (unattended) ileride istenecek mi? Bu admin kurulumlu servis demektir | Kapsam dışı (2026-11-12: E9'da da kapsam dışı; kullanıcı ileride ayrı paket isteyebilir); 2026-11-14: E11'e taşındı (S24) | Kullanıcı |
| S8 | **Karar:** ikisi birden — dosya adındaki kod (`Destek-48291376.exe`) otomatik + ad değişirse 8 haneli kodun elle girişi; kod kısa ömürlü (yalnız PENDING), deneme sınırlı (ADR-0006, AC-3, AC-97). | — | Kapandı |
| S9 | **Karar (K8):** sertifika ALINMAYACAK; istemci imzasız + tekrarlanabilir build + SHA-256 + GitHub build attestation; SignPath Foundation başvurusu Faz 4 ile paralel (ADR-0010). AC-27, AC-92, AC-94, AC-96 2026-11-11'de revize edildi. | — | Kapandı |
| S10 | Platform önceliği Windows → macOS → Linux doğru mu? | Evet (V11) | Kullanıcı |
| S11 | Kötüye kullanım bildirim adresi (`ABUSE_EMAIL`, mimari K10) nedir? | Super Admin e-postası (V13) | Kullanıcı |
| S12–S17 | E9: talep kabulünde kabul kodu, "hatırla" varsayılanı, mesai dışı talep, WhatsApp alıcı tipi, dosya adında firma adı, SMTP'nin öne çekilmesi | `docs/gereksinimler-e9.md` §8 | Kullanıcı + mimar |
| S18–S21 | E10: kayıt için ayrı "hatırla" onayı, birden çok firma kaydı, WhatsApp'ta müşteri firma adı, müşteri başına logo/aydınlatma | **Varsayılanlarla kabul edildi (2026-11-12):** onay yok (bilgi satırı + unut), tek kayıt, WhatsApp değişmez, tenant logosu/metni. `docs/gereksinimler-e10.md` §8, `docs/mimari-e10.md` §14 K16 | Kapandı |

## 9. Kontrol listesi kararları
Kaynak: `~/.claude/checklists/tasarim-kontrol-listesi.md` bölüm 1, 5, 8, 9.

| Madde | Karar | Gerekçe |
|---|---|---|
| 1. Kimlik doğrulama yöntemi | Kapsamda: e-posta+şifre (argon2/bcrypt) + TOTP 2FA; SSO/LDAP Sonra | Güvenlik ürünü; ortak standart 1.3 |
| 1. Şifre politikası, sıfırlama, kilit | Kapsamda: min 12 karakter, e-posta ile sıfırlama (SMTP), hesap+IP 5 hatalı → 15 dk, hesap geneli 20/saat → 15 dk + bildirim (AC-65) | Ortak standart 1.3, G-23 |
| 1. Yetkilendirme / IDOR | Kapsamda: rol + yetki toggle; her uçta tenant + sahiplik kontrolü; `sessions.terminate` alt yetkisi (Admin açık, User kapalı); E9: `support_requests.view/accept` | Ortak standart 1.3, G-04 |
| 1. Oturum yönetimi | Kapsamda: oturum süresi 8 saat, boşta 30 dk; "tüm cihazlardan çıkış"; hesap/yetki değişiminde aktif destek oturumunun sonlanması (AC-115) | Teknisyen hesabı yüksek ayrıcalıklı |
| 1. Davet / hesap silme (KVKK) | Kapsamda: Admin kullanıcı oluşturur (ilk girişte şifre değişimi); müşteri verisi anonimleştirme; self-servis kayıt Kapsam dışı; E9: "Bilgilerimi unut" | Kurumsal ürün |
| 1. Servis hesapları / API anahtarları | Kapsam dışı (public API yok); TURN secret rotasyonu Kapsamda (runbook); E9: tenantRef yenileme (AC-131) | — |
| 5. 5 durum | Kapsamda: her ekran; ayrıca bağlantı durumları (bekliyor/lobide/bağlanıyor/aktif/koptu/bitti) ve E9 talep durumları | Kalite standardı |
| 5. Form doğrulama | Kapsamda: alan bazlı hata, sunucu hatası forma yansır | Kalite standardı |
| 5. Yıkıcı işlem onayı | Kapsamda: oturum sonlandırma/iptal/zorla sonlandırma, kullanıcı pasife alma onaylı; müşterinin "Kontrolü kapat" butonu onaysız ve anlık (güvenlik gereği) | — |
| 5. Responsive | Kısmen: yönetim ekranları responsive; canlı konsol ≥ 1280 px masaüstü; mobil müşteri Kapsam dışı | Teknik kısıt |
| 5. Erişilebilirlik | Kapsamda: WCAG 2.1 AA | — |
| 5. Yerelleştirme | Türkçe Kapsamda; İngilizce Sonra; RTL Kapsam dışı | — |
| 5. Bildirim stratejisi | Kapsamda: toast (Sonner) anlık olaylar, e-posta yalnız link gönderimi, şifre sıfırlama ve hesap kilidi bildirimi; push Kapsam dışı. **Revize (E9):** yeni talep için panel toast + ses, isteğe bağlı WhatsApp ve e-posta (tenant ayarı) | Kullanıcı kararı 2026-11-12 |
| 5. Yavaş ağ | Kapsamda: adaptif bitrate, kalite göstergesi, 120 sn reconnect | WebRTC doğası |
| 5. Başlıklar, 404/500 | Kapsamda; müşteri için özel 410 (süresi dolmuş/kullanılmış) ekranları | — |
| 5. Tasarım token'ları | Kapsamda: tek token seti, DESIGN.md | Ortak standart 1.8 |
| 8. KVKK | Kapsamda: müşteri aydınlatma metni (tenant düzenler, sürümlü, AC-127), açık onay kaydı (görüntüleme ve kontrol için ayrı), saklama süresi, anonimleştirme; E9: talep formunda her talepte onay, yerel saklama aydınlatmada | Ekran içeriği kişisel veri içerebilir |
| 8. Çerez / lisanslar | Kapsamda: yalnız zorunlu çerezler (bilgi notu); proje Apache-2.0; 3. parti lisans taraması, AGPL yasağı | K7, R8 |
| 8. Finansal veri | Kapsam dışı | Ürün finansal işlem içermez |
| 9. Kapsam dışı listesi | Yazıldı (12 madde + E9 için 8 madde) | — |
| 9. Ölçülebilir AC | Yazıldı (ayrı dosyalar, 195 AC) | — |
| 9. Riskler / açık sorular | Yazıldı (R1–R24, S1–S21) | — |
| 9. Definition of Done | `~/.claude/checklists/kalite-standartlari.md` geçerli; ek: istemci imzasız, tekrarlanabilir build + SHA-256 + attestation doğrulaması ve temiz-makine iz testi | K8 |
| 9. Dokümantasyon planı | Kapsamda: README, docs/api.md, KULLANIM_KILAVUZU, DATASHEET, PDF, ADR'ler, kurumsal hash allowlist rehberi, SmartScreen rehberi; E9: kılavuzda "Destek iste" ve "Talepler" bölümleri | Ortak standart 1.7 |
| Sonra | Oturum kaydı, çoklu teknisyen, ses, clipboard, macOS/Linux istemci, SSO, SMS/WhatsApp link, İngilizce, ITSM entegrasyonu, SAS (DTLS parmak izi) doğrulaması (G-14), oturum sonu müşteri özeti (G-17-6; AC-107 ile çelişir, tasarım gerekir), OpenSSF Scorecard (G-18), SignPath Foundation imzası (ADR-0010); E9'dan: gözetimsiz erişim (S7), web talep formu, atama/SLA/mesai saatleri, kabul öncesi mesajlaşma, talepte kabul kodu (S12) | Unutulmasın diye |

### Sonra / açık — P2..P8b-1 (2026-11-12)
Tablolar içerik değiştirilmeden taşındı: `/Users/mennan/Projeler/Remote/docs/gereksinimler-sonra-acik.md`.
