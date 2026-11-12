# Gereksinimler — E9 Müşteri destek talebi (model A)
Tarih: 2026-11-12   Durum: TASLAK. Ana doküman: `/Users/mennan/Projeler/Remote/docs/gereksinimler.md` (ayrılmaz parçasıdır).
AC'ler: `/Users/mennan/Projeler/Remote/docs/gereksinimler-kabul-kriterleri-e9.md` (AC-129..AC-164).

## 1. Amaç ve iş değeri
Bugün destek akışı yalnız teknisyenden başlıyor: teknisyen link gönderir, müşteri dosyayı indirir, çalıştırır ve KVKK onayı verir. Sık destek alan kurumsal müşteri için bu akış zahmetli. E9 ile müşteri, firmasına özel ve bir kez indirilen Hızlı Destek dosyasını açıp "Destek iste" der. Talep tenant'ın kuyruğuna düşer ve teknisyene bildirim gider. Teknisyen talebi kabul edince link veya kod gerekmeden bağlanır. Kurulumsuz istemci ilkesi ve müşteri kontrolündeki izin modeli korunur.

## 2. Roller (ek)
- **Müşteri (Misafir):** Hesabı yoktur. Firma dosyasıyla kimliksiz destek talebi açar, talebinin durumunu izler, talebi iptal eder ve hatırlanan bilgilerini siler.
- **User (Teknisyen):** `support_requests.view` yetkisiyle kuyruğu görür, `support_requests.accept` yetkisiyle talebi kabul eder veya reddeder.
- **Admin:** Sabit indirme bağlantısını görür ve yeniler; bildirim kanallarını, alıcıları ve bekleme süresini ayarlar (`settings.edit`).
- **Super Admin:** Talepleri seçili tenant bağlamında görür; WhatsApp servis URL'si sistem düzeyindedir.

## 3. Kapsam
### Kapsamda
- Tenant başına tahmin edilemez tenantRef, sabit indirme bağlantısı, "Bağlantıyı yenile".
- Firma dosyası: `NoktaDestek-<firma>-<tenantRef>.exe`. tenantRef yalnız dosya adında taşınır; binary tektir ve SHA-256 değişmez.
- İstemci penceresi: "Destek iste" formu (ad, telefon, isteğe bağlı e-posta, açıklama, KVKK onayı aynı formda) ve "Teknisyenden kod aldım" seçeneği (eski yol).
- Bu bilgisayarda hatırlama (ad, telefon, e-posta; DPAPI ile korunan tek dosya) ve "Bilgilerimi unut".
- Talep yaşam döngüsü: BEKLİYOR → KABUL_EDİLDİ / İPTAL / SÜRESİ_DOLDU / REDDEDİLDİ / BAĞLANAMADI. Müşteri penceresinde durum, sıra ve bekleme süresi gösterilir.
- Panel "Talepler" ekranı; anlık toast ve ses bildirimi; WhatsApp (whatsapp-bildirim servisi) ve e-posta (tenant SMTP) bildirimi. Kanallar tenant ayarıyla açılıp kapanır, alıcılar ve test butonları ayardadır.
- Kabul → oturum oluşturma → istemcinin otomatik bağlanması (teknisyen adı ve doğrulama kodu gösterilir). Kontrol izni akışı (P7) değişmez.
- Kötüye kullanım koruması: IP, önek ve tenant hız sınırları; bekleyen talep üst sınırları; pasif tenant reddi; zod doğrulaması; dolandırıcılık uyarısı.
- Yetkiler: `support_requests.view` ve `support_requests.accept`, tek `permissions` tanımından gelir.
- Audit: talep, kabul, ret, bildirim, ayar ve bağlantı yenileme olayları.
- Oturum geçmişi bağlantısı: talep→oturum ilişkisi, detayda talep bilgileri, kaynak filtresi, CSV sütunları.

### Kapsam DIŞI (bu epikte)
1. **Gözetimsiz erişim** — S7 olarak kalır; kullanıcı ileride ayrı paket isteyebilir (Sonra).
2. **Tepsi simgesi, otomatik başlatma, servis, kurulum, kayıt defteri** — mevcut ilke korunur.
3. **Mobil müşteri** (talep dahil); macOS/Linux talep istemcisi.
4. Tarayıcıdan (web formundan) destek talebi — talep yalnız Windows firma dosyasından açılır (Sonra).
5. Talebi belirli bir teknisyene atama, öncelik, SLA, mesai saatleri, teknisyen müsaitlik durumu (Sonra).
6. Kabul öncesi müşteri–teknisyen mesajlaşması (Sonra).
7. Müşteriye SMS/WhatsApp/e-posta ile durum bildirimi — müşteri durumu yalnız pencerede görür.
8. ITSM/ticket sistemine talep aktarımı (genel kapsam dışı maddesi 10 geçerli).

## 4. Kullanıcı hikâyeleri
- US-29: Sık destek alan kurumsal müşteri olarak firmama ait Hızlı Destek dosyasını bir kez indirip saklamak istiyorum ki her seferinde teknisyenden link beklemeyeyim.
- US-30: Müşteri olarak dosyayı açıp adımı, telefonumu ve sorunumu yazarak destek istemek istiyorum ki teknisyeni aramadan sıraya girebileyim.
- US-31: Müşteri olarak bilgilerimin bu bilgisayarda hatırlanmasını ve istediğimde tek tıkla silinmesini istiyorum.
- US-32: Müşteri olarak talebimin durumunu, sıramı ve bekleme süremi görmek, istersem talebi iptal etmek istiyorum.
- US-33: Teknisyen olarak yeni bir talepten panelde anında (ses ve toast), ayarlıysa WhatsApp ve e-postayla haberdar olmak istiyorum.
- US-34: Teknisyen olarak kuyruktaki talebi tek tıkla kabul edip link veya kod iletmeden bağlanmak ya da mesajla reddetmek istiyorum.
- US-35: Admin olarak firmamın sabit indirme bağlantısını kopyalamak ve yenilemek, bildirim kanallarını ve alıcılarını ayarlamak istiyorum.
- US-36: Admin olarak talepten doğan oturumları geçmişte talep bilgisi ve bekleme süresiyle görmek istiyorum.
- US-37: Super Admin/Admin olarak kimliksiz talep ucunun kötüye kullanımının sınırlanmasını ve tüm talep olaylarının audit'te görünmesini istiyorum.

## 5. Fonksiyonel olmayan gereksinimler (ek)
- **Performans:** Talepten panel bildirimine p95 ≤ 3 sn; kabulden istemcide bağlantı ekranına p95 ≤ 3 sn; WhatsApp/e-posta gönderimi ≤ 60 sn; Talepler listesi 1.000 kayıtta < 500 ms; istemci açılışı ≤ 5 sn.
- **Bağlantı dayanıklılığı:** Bekleyen istemci 30 dk'ya kadar sunucuya bağlı kalır; heartbeat proxy/NAT zaman aşımlarının altında tutulur; 120 sn kopma toleransı vardır.
- **Güvenlik:** Talep ucu kimliksizdir; AC-143/AC-144 sınırları geçerlidir. Talep sırrı yalnız ilgili istemcide bulunur ve loglanmaz. tenantRef gizli değildir ama tahmin edilemez (≥ 64 bit) ve yenilenebilir. WhatsApp servis URL'si tenant tarafından değiştirilemez (SSRF önlemi). Bildirim çağrıları zaman aşımı ve yeniden denemeyle yapılır.
- **KVKK:** Ad, telefon, e-posta ve açıklama kişisel veridir. Aydınlatma metni yerel saklamayı ve sunucudaki saklama süresini belirtir; onay her talepte alınır; saklama ve anonimleştirme AC-159'a göre yapılır.
- **İstemci (değişiklik talebi):** "İstemci kendi dosyasını yazmaz" ilkesine tek istisna, kullanıcının onayıyla yazılan hatırlama dosyasıdır (AC-136..AC-138). ADR-0004'te revizyon gerekir (mimar).
- **Erişilebilirlik / yerelleştirme:** WCAG 2.1 AA; arayüz Türkçe; süreler Europe/Istanbul saat diliminde gösterilir.

## 6. Varsayımlar
- V14: tenantRef yalnız dosya adında taşınır (V6/ADR-0006 kalıbı). Dosya adı değişirse istemci yalnız kod girişini gösterir ve "Destek iste için firmanızın dosyasını yeniden indirin" mesajını verir.
- V15: "Bu bilgisayarda hatırla" kutucuğu varsayılan olarak **işaretsizdir**; bilgiler hatırlanabilir ama kutucuğu müşteri işaretler (kullanıcı kararı 2026-11-12, güvenlik tasarım turu G-E9-13 sonrası; önceki varsayılan "işaretli" idi).
- V16: Talep kabulünde 4 haneli lobi kabul kodu (AC-112) istenmez; bağlama talep sırrıyla yapılır. Teknisyen kabulden önce müşteriyi telefonla arayarak doğrulayabilir (kılavuzda önerilir).
- V17: Kuyruk tenant genelindedir: `view` yetkili tüm teknisyenler bekleyen tüm talepleri görür (oturumların aksine "yalnız kendi" kuralı uygulanmaz).
- V18: WhatsApp servis URL'si sistem düzeyindedir (`WHATSAPP_SERVICE_URL`); tenant yalnız alıcıları ve kanalın açık/kapalı durumunu yönetir.
- V19: Bekleme süresi varsayılan 30 dk'dır (10–120 dk aralığında tenant ayarı); tenant başına en çok 50 bekleyen talep olur.
- V20: Talep kayıtlarının saklama süresi oturum meta verisininkiyle aynıdır (tenant ayarı 90–730 gün).

## 7. Riskler
| # | Risk | Etki | Önlem | Sahibi |
|---|---|---|---|---|
| R11 | Firma dosyası veya bağlantısı sızar; firmayla ilgisi olmayan biri o firma adına talep açar | Orta. Kuyrukta spam ve bildirim yorgunluğu; teknisyen sahte bir "müşteri" makinesine bağlanabilir. Teknisyen ekranı paylaşılmaz; risk sahte ekranla sosyal mühendislik ve teknisyene zararlı dosya gönderilmesidir | Hız sınırları ve bekleyen talep üst sınırları (AC-143/144); "Bağlantıyı yenile" (AC-131); audit'te IP; kılavuzda "tanımadığınız talebi telefonla doğrulayın"; teknisyene müşteriden gelen dosya için uyarı (mevcut AC-117); gerekirse ileride tenant ayarıyla kabul kodu (S12) | guvenlik + mimar |
| R12 | Saldırgan değiştirilmiş bir "NoktaDestek-<firma>.exe" dağıtır; firma dosyası "tanıdık" göründüğü için güven artar | Yüksek itibar riski | SHA-256/attestation doğrulama rehberi (AC-96); dosya hash'i tüm tenant'larda aynıdır (AC-130); teknisyen adı ve doğrulama kodu; dolandırıcılık uyarısı (AC-125) | guvenlik + teknik-yazar |
| R13 | whatsapp-bildirim servisi kimliksiz, tek örnek ve whatsapp-web.js tabanlıdır; servis çökebilir veya numara engellenebilir | Orta. Bildirim gecikir | Panel bildirimi birincil kanaldır; yeniden deneme ve başarısızlık audit'i; test butonu; servis ağ erişimi kısıtlanır (devops) | devops |
| R14 | Paylaşılan bilgisayarda hatırlanan kişisel veriyi başkası görebilir | Düşük | DPAPI CurrentUser koruması; kutucuk ve "Bilgilerimi unut"; aydınlatma metninde belirtilir | backend-dev (Go) |
| R15 | Kimliksiz uç DB doldurma veya DoS için kullanılabilir | Orta | AC-143/AC-144; alan uzunluk sınırları; anonimleştirme işi | backend-dev |
| R16 | "İstemci dosya yazmaz" ilkesi ve AC-108 değişir | Orta. Mimari tutarlılık | ADR-0004 revizyonu; AC-138 ile tek istisna tanımlanır; iz testi güncellenir | mimar |
| R17 | Paket sırası: toggle ekranı P9'da, SMTP P10'da; P8b bunlardan önce geliyor | Orta | Anahtarlar P8b'de tanıma eklenir (Admin varsayılan açık; User için P9'a kadar staging'de SQL). E-posta kanalı (AC-151) P10'da kapanır. Tenant ayar ekranının ilk açılışı P8b'ye çekilir (mimar kararı) | mimar + proje-yoneticisi |
| R18 | Bekleyen istemcinin uzun süreli WS bağlantısı kurumsal proxy'de düşebilir | Orta | Heartbeat ve 120 sn toleransla yeniden bağlanma; düşerse talep İPTAL olur ve müşteri yeniden talep açabilir | backend-dev |

## 8. Açık sorular
| # | Soru | Varsayılan (cevap gelmezse) | Sahibi |
|---|---|---|---|
| S12 | Talep kabulünde de 4 haneli kabul kodu (telefonla doğrulama) istensin mi; tenant ayarı mı olsun? | Hayır (V16); R11 gerçekleşirse tenant ayarı olarak eklenir | Kullanıcı |
| S13 | "Hatırla" kutucuğu varsayılan işaretli mi olmalı, yoksa hatırlama tamamen otomatik mi? | **Kapandı (2026-11-12):** işaretsiz kutucuk; müşteri işaretler (V15) | Kullanıcı |
| S14 | Mesai dışında talep alınsın mı (çalışma saatleri, otomatik "mesai dışı" mesajı)? | Her zaman alınır; mesai saatleri Sonra | Kullanıcı |
| S15 | WhatsApp alıcıları kişisel numaralar mı, grup mu (servis grup gönderimini destekliyor mu)? | En çok 5 bireysel numara | Kullanıcı + backend-dev |
| S16 | Dosya adında firma adı geçsin mi? Dosya adından müşteri ile destek firması arasındaki ilişki görünür | Evet, ASCII kısa ad (≤ 20 karakter) | Kullanıcı |
| S17 | P8b'nin e-posta kanalı için SMTP'yi P10'dan öne çekmek gerekir mi? | Hayır; AC-151 P10'da kapanır | Kullanıcı + mimar |

## 9. Yol haritası önerisi — P8b (P9'dan önce)
Sıra: P8 → **P8b-1 → P8b-2** → P9. Paket kuralları (mimari §10.1) geçerlidir: her alt paket qa GEÇTİ ve güvenlikte Kritik/Yüksek bulgu sayısı 0 olmadan sonrakine geçilmez.

| Paket | İçerik | AC | Ekip |
|---|---|---|---|
| P8b-1 — Talep sunucusu + panel | Veri modeli (`support_requests`, tenantRef, bildirim ayarları, talep→oturum ilişkisi, onay kaydı), public talep/durum/iptal uçları ve hız sınırları, sabit indirme ucu, kuyruk ve durum makinesi, süre dolum işi, kabul (atomik) ve ret, permissions anahtarları, Talepler ekranı, toast ve ses, WhatsApp bildirimi ve testi, ayar ekranı, geçmiş bağlantısı ve CSV, audit, anonimleştirme kapsamı, aydınlatma seed metni | 129–132, 134 (sunucu), 135, 139–149, 150, 152, 153, 155, 157–161 (sunucu/web) | dba → (backend ‖ frontend ‖ devops: env `WHATSAPP_SERVICE_URL`) |
| P8b-2 — İstemci (Go, sürüm 0.9.0) | Dosya adından tenantRef okuma, firma penceresi, form ve doğrulama, KVKK, hatırlama dosyası (DPAPI) ve silme, bekleme/sıra/iptal ekranı, talep sırrıyla otomatik bağlanma, "Teknisyenden kod aldım", Windows elle testleri (iz testi dahil) | 133, 134 (istemci), 136–138, 141 (istemci), 154, 156, 161 (istemci), 162–164 | backend-dev (Go) → qa ‖ güvenlik → test-operatoru |
| P10'a bağlı | E-posta bildirim kanalı | 151 | P10 ile |

Mimarın yapacakları: `docs/mimari.md` §10 tablosuna P8b satırları, mimari-api (public talep uçları, panel uçları), mimari-protokol (talep sırrı ile bağlama, bekleme WS'i), ADR-0004 revizyonu (hatırlama dosyası), ADR-0006 eki (tenantRef dosya adı biçimi), tehdit modeli (R11/R12).

## 10. Kontrol listesi kararları (E9)
| Madde | Karar | Gerekçe |
|---|---|---|
| 1. Kimlik doğrulama | Talep ucu kimliksizdir; tenantRef ile bağlam, talep sırrı ile bağlama yapılır | Müşterinin hesabı yoktur |
| 1. Brute-force | tenantRef denemesi IP başına 10/dk (AC-144) | Ref tahmini ve enumeration önlenir |
| 1. Yetki / IDOR | `support_requests.view/accept`; tenant izolasyonu (AC-147/148) | Ortak standart 1.3 |
| 1. Hesap silme (KVKK) | "Bilgilerimi unut" (yerel); sunucuda saklama ve anonimleştirme | Unutulma hakkı |
| 1. API anahtarı / rotasyon | tenantRef yenilenebilir (AC-131) | Sızma önlemi |
| 5. 5 durum | Talepler ekranı ve istemci penceresi: yükleniyor / boş / hata / bekliyor / sonuç | Kalite standardı |
| 5. Form doğrulama | Alan bazlı hata; sunucuda zod | AC-134 |
| 5. Yıkıcı işlem onayı | "Bağlantıyı yenile" ve "Reddet" onaylıdır; müşterinin "İptal" ve "Bilgilerimi unut" işlemleri anlıktır | Müşteri kontrolü |
| 5. Bildirim stratejisi | Panel toast ve ses (birincil); WhatsApp ve e-posta isteğe bağlı (tenant ayarı); müşteriye dış bildirim yok | Kullanıcı kararı |
| 5. Yavaş ağ | 120 sn tolerans, heartbeat | R18 |
| 5. Erişilebilirlik | WCAG 2.1 AA, klavye, axe (AC-164) | — |
| 8. KVKK | Aydınlatma ve onay aynı formda, her talepte; yerel saklama açıklanır; saklama süresi tenant ayarıdır | Kişisel veri |
| 9. Kapsam dışı | 8 madde (bölüm 3) | — |
| 9. Ölçülebilir AC | AC-129..AC-164 (36 AC) | — |
| Sonra | Gözetimsiz erişim (S7), web talep formu, atama/SLA/mesai saatleri, kabul öncesi mesajlaşma, talepte kabul kodu (S12), müşteriye durum bildirimi | Unutulmasın diye |
