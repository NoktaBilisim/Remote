# Gereksinimler — Bekleme odası (lobi) göstergesi ve bildirimi

Tarih: 2026-11-15 Durum: TASLAK (kullanıcı kararı 2026-11-15: oturum listesine "müşteri bekliyor" göstergesi + bildirim). Ana doküman: `/Users/mennan/Projeler/Remote/docs/gereksinimler.md` (ayrılmaz parçasıdır). Epik: E4 Teknisyen konsolu (ek). Tasarım: mimar tarafından yazılacak (bu dosya mekanizma seçmez, davranışı bağlar).

## 1. Amaç

Staging'de (2026-11-15) müşteri Hızlı Destek ile oturuma katıldı ve 75 sn bekleme odasında kaldı (audit `guest.pending`). Teknisyen bunu göremedi, çünkü bekleme odası yalnız oturum konsolunda (`/sessions/:id/console`, "Bekleme odası (n)") görünüyor. "Talepler" ekranını boş buldu ve oturumu iptal etti. Amaç: müşteri bekleme odasına girdiğinde teknisyen panelin hangi sayfasında olursa olsun bunu **en geç 10 sn içinde** görsün ve konsola tek tıkla geçebilsin.

## 2. Mevcut durum (çift iş açılmaz)

- Konsoldaki lobi listesi (ad, mod, bekleme süresi, kabul kodu, Kabul et/Reddet; AC-112, AC-113) **değişmez**. Müşteri adı yalnız orada görünmeye devam eder.
- Oturum listesi (`GET /sessions`, `SessionListItem`) 10 sn'de bir yenilenir ("Son güncelleme"). Yeni gösterge bu yenilemeye eklenir; ayrı bir liste ekranı açılmaz.
- Destek talepleri için aynı desen zaten var: menü rozeti (`GET /support-requests/count` ilk yükleme, sonra `/ws/panel` `queue.count`), toast (`rq.toast.*`), sekme başlığı sayacı, ekran okuyucu metni `rq.badgeSr`. Yeni gösterge bu desenin bileşenlerini (rozet, toast, başlık sayacı) yeniden kullanır; ikinci bir toast/başlık altyapısı yazılmaz.
- **Kısıt:** `/ws/panel` yalnız `support_requests.view` yetkisi olan kullanıcıya açılır (mimari-protokol §5.3). Oturum açabilen her teknisyende bu yetki bulunmayabilir. Gösterge bu yetkiye bağlı olamaz (AC-306). Taşıma yolunu (yoklama, `/ws/panel` genişletmesi ya da ikisi) mimar seçer.

## 3. Kapsam

### Kapsamda

1. Oturum listesinde PENDING oturum satırında "Müşteri bekliyor (n)" rozeti ve kendi oturumunda tek tıkla konsola geçiş (AC-304, 305).
2. Liste yanıtında satır başına bekleyen misafir sayısı (AC-305).
3. Panel genelinde "Oturumlar" menü öğesinde sayaç (her sayfada; 360 px dahil) (AC-306).
4. Uygulama içi toast ve sekme gizliyken sekme başlığı sayacı (AC-307, 308).
5. Rol, tenant ve firma seçmemiş Super Admin davranışı (AC-309, 310).
6. Kişisel veri en aza indirme (AC-311).
7. Erişilebilirlik, tema, mobil ve animasyon (AC-312, 313).
8. Sayım ucu güvenliği, performansı ve dayanıklılık (AC-314, 315).
9. Olayı yeniden üreten uçtan uca senaryo (AC-316).

### Kapsam DIŞI (açıkça)

1. **Tarayıcı (işletim sistemi) bildirimi ve sesli uyarı** → **Sonra** (kullanıcı tercihiyle açılır biçimde; izin isteme akışı, profil ayarı ve tercih saklaması gerekir; §6 L-S1).
2. Admin veya Super Admin'in başka teknisyenin lobisinden müşteri kabul etmesi. Mevcut kural değişmez: yalnız oturumun teknisyeni kabul eder (mimari.md "Teknisyen–oturum sahipliği" satırı, G-04: Admin/Super Admin "odaya katılamaz").
3. Lobi kurallarının değişmesi: en çok 3 misafir, 5 dk bekleme, 5 hatalı kodda boşaltma (AC-113) aynen kalır.
4. Müşteri tarafı ekranları (Hızlı Destek, tarayıcı karşılama) değişmez.
5. WhatsApp, e-posta, SMS veya mobil push ile lobi bildirimi.
6. Çok sunuculu (birden fazla server instance) kurulumda lobi durumu paylaşımı (§5 R-L1).
7. PENDING durum etiketinin ("Bekliyor") yeniden adlandırılması ve "Talepler" boş ekranına yönlendirme satırı → **Sonra** (§6 L-S2, L-S3).

## 4. Kabul kriterleri

Tanımlar: **Bekleyen misafir** = bir oturumun bekleme odasında olan, henüz kabul edilmemiş, reddedilmemiş, çıkmamış ve 5 dk süresi dolmamış misafir (audit `guest.pending` yazılmış, `guest.admitted`/`guest.rejected`/çıkış/zaman aşımı olmamış). **Kendi oturumu** = `technician_id = oturum açan kullanıcı` olan, `status = PENDING` ve `expires_at > now` oturum. **Gösterge** = liste rozeti, menü sayacı, toast ve sekme başlığı sayacının toplamı.

- **AC-304:** (liste rozeti, kendi oturumu) Teknisyen oturum listesindeyken kendi PENDING oturumuna bir misafir bekleme odasına girdiğinde, en geç 10 sn içinde o satırda "Müşteri bekliyor (n)" rozeti görünür (n = o oturumdaki bekleyen misafir sayısı, 1..3). Rozete ya da satırdaki "Konsolu aç" düğmesine tek tıklama `/sessions/:id/console` sayfasını açar ve "Bekleme odası (n)" bölümü ilk ekranda görünür. (e2e: misafir join → ≤ 10 sn rozet → tık → konsol URL'si ve lobi bölümü görünür.)
- **AC-305:** (rozetin güncellenmesi ve liste yanıtı) Oturum listesi yanıtı her satır için bekleyen misafir sayısını (tam sayı, 0..3) içerir; PENDING olmayan satırlarda değer 0'dır. Sayı sunucunun anlık lobi durumundan gelir, DB'deki audit kayıtlarından türetilmez. Misafir kabul edildiğinde, reddedildiğinde, ayrıldığında, 5 dk süresi dolduğunda ya da oturum iptal edildiğinde veya süresi dolduğunda rozet en geç 10 sn içinde güncellenir (n azalır ya da rozet kaybolur). ACTIVE, ENDED, EXPIRED ve CANCELLED satırlarda rozet yoktur. (API testi: 0, 1, 3 misafir ve her çıkış yolu için değer; e2e: kabul sonrası ≤ 10 sn rozet yok.)
- **AC-306:** (panel genel sayaç) Kenar menüdeki "Oturumlar" öğesinin yanında, kullanıcının kendi oturumlarındaki bekleyen misafirlerin toplamını gösteren sayaç bulunur. Sayaç panelin bütün sayfalarında (Talepler, Müşteriler, Ayarlar, Profil, konsol dahil) görünür. 0 iken gizlidir. Değişiklik en geç 10 sn içinde yansır. 360 px genişlikte sayaç "Oturumlar" öğesinde görünür (bugün mobilde açılır menü yok, menü yatay şerit); açılır mobil menü P14b'de geldiğinde menü düğmesine işaret eklenir (r1, K-L3). Sayaç `sessions.view` yetkisi olan kullanıcıda çalışır ve `support_requests.view` yetkisine bağlı değildir. (e2e: `support_requests.view` kapalı USER ile Talepler sayfasındayken misafir join → ≤ 10 sn sayaç "1"; 360 px genişlikte sayaç "Oturumlar" öğesinde görünür.)
- **AC-307:** (toast) Kendi oturumuna yeni bir misafir bekleme odasına girdiğinde, en geç 10 sn içinde "Bekleme odasında müşteri var" toast'ı ve "Konsolu aç" eylemi gösterilir. Eylem ilgili oturumun konsolunu açar. Aynı misafir için toast bir kez gösterilir. Sayfa yüklenirken zaten bekleyen misafirler için toast gösterilmez; onlar sayaç ve rozetle görünür. Kullanıcı o oturumun konsolundaysa toast gösterilmez. Aynı anda birden çok misafir gelirse tek toast "Bekleme odasında {n} müşteri var" olur ve eylem, kullanıcının birden çok oturumu varsa oturum listesini açar. Toast projenin mevcut `ui/toast` bileşeniyle (Sonner CSP nedeniyle projede yok; r1 K-L1), `role="status"` olarak verilir ve kullanıcı kapatana kadar en az 10 sn ekranda kalır. (e2e: tek misafir → 1 toast; aynı misafir için ikinci yoklamada yeni toast yok; reload → toast yok, sayaç var; konsoldayken toast yok.)
- **AC-308:** (sekme başlığı) Sekme gizliyken (`document.visibilityState = "hidden"`) bekleyen misafir sayısı > 0 olursa sekme başlığı "({n}) Müşteri bekliyor — " ön ekiyle başlar. Sekme görünür olduğunda ya da sayı 0'a indiğinde başlık eski haline döner. Destek talebi başlık sayacı da aynı anda etkinse ikisi birbirini silmez: lobi ön eki önce gelir, talep ön eki ardından gelir. İstisna (r1 R-L7): konsol sayfalarında (`/sessions/:id/console`) başlık ön eki uygulanmaz (mevcut kural); orada toast ve menü sayacı çalışır. (Birim/e2e testi: hidden + 1 misafir → başlık ön eki; visible → ön ek yok; talep sayacı + lobi birlikte → iki ön ek, sıra doğru.)
- **AC-309:** (rol ve tenant kapsamı) Liste rozeti yalnız kullanıcının listede zaten görebildiği satırlarda görünür: USER yalnız kendi oturumlarında; ADMIN kendi tenant'ının bütün PENDING oturumlarında. ADMIN'in başka teknisyene ait satırında rozet bilgi amaçlıdır, konsola geçiş bağlantısı yoktur (mevcut kural: yalnız oturumun teknisyeni kabul eder). Menü sayacı, toast ve sekme başlığı **yalnız kendi oturumlarını** sayar (ADMIN dahil). Hiçbir yanıt başka tenant'ın ya da USER için başka teknisyenin oturumuna ait bekleyen sayısını içermez. (Entegrasyon testi: iki tenant, iki teknisyen; USER-A'nın sayacı B'nin misafirinden etkilenmez; tenant-1 ADMIN yanıtında tenant-2 oturumu yok.)
- **AC-310:** (firma seçmemiş Super Admin) Firma seçmemiş Super Admin, mevcut kural gereği tüm firmaların oturum listesini görür ve listede PENDING satırların rozeti görünür. Rozet tıklanabilir değildir ve konsol bağlantısı yoktur; sayfadaki mevcut "Yeni oturum açmak … için üst menüden bir firma seçin" notu geçerlidir. Bu durumda menü sayacı, toast ve sekme başlığı sayacı **çalışmaz**. Firma seçildikten sonra Super Admin o firmadaki kendi oturumları için AC-306..308 ile aynı davranışı görür. (e2e: firma seçmemiş SA → rozet var, bağlantı yok, sayaç yok; firma seç + kendi oturumuna misafir → sayaç ve toast.)
- **AC-311:** (kişisel veri) Rozet, menü sayacı, toast, sekme başlığı ve bu iş için eklenen her yanıt alanı **yalnız sayı** taşır; tek istisna, konsol bağlantısı için kullanıcının kendi oturumunun kimliğidir (ULID; listede zaten görünür, r1 K-L2). Müşteri adı, e-posta, IP, misafir türü, kabul kodu ve oturum kodu içermez. Müşteri adı yalnız konsoldaki bekleme odası listesinde görünür (AC-112, değişmez). Gerekçe: teknisyen ekran paylaşımı yaparken ya da ortak ekranda çalışırken ad üçüncü kişilere görünmesin (KVKK veri en aza indirme). Konsola geçmek için ad gerekli değildir. (Test: yanıt şemasında bu alanlar yok; e2e'de misafir adı rozet, toast ve başlık metninde geçmez.)
- **AC-312:** (erişilebilirlik, tema, mobil) Rozet anlamı yalnız renkle verilmez: rozette görünür metin ("Müşteri bekliyor (n)") ve anlama uygun bir `lucide-react` ikonu bulunur. Menü sayacının erişilebilir adı "{n} müşteri bekleme odasında" olur. Sayı değiştiğinde `aria-live="polite"` bölgesi bir kez duyurur; değer değişmeden yapılan yenilemeler tekrar duyurulmaz. Rozet ve sayaç klavyeyle odaklanabilir ve Enter ile konsolu açar (bağlantı varsa). Açık ve koyu temada axe ihlali 0'dır ve metin kontrastı en az 4.5:1'dir. 360 px genişlikte yatay taşma yoktur. Renkler DESIGN.md token'larından gelir. (Playwright + axe, iki tema, 360 px ve 1280 px.)
- **AC-313:** (animasyon, Projeler/CLAUDE.md §1.8) Rozet ve sayaç belirirken yalnız `opacity` ve `transform` (`scale(0.95)` → 1) ≤ 200 ms `ease-out` ile canlandırılır. Kaybolurken ya da sayı değişirken yer kayması olmaz. `prefers-reduced-motion: reduce` açıkken yalnız opacity kalır. Menü açılıp kapanması animasyonsuzdur. Yanıp sönen veya sürekli tekrarlayan animasyon kullanılmaz. (Birim/e2e: hesaplanan stil; reduced-motion emülasyonu.)
- **AC-314:** (sayım ucu güvenliği ve performansı) Bekleyen sayısını veren her yeni uç ya da mesaj: oturum çerezi ister; `sessions.view` yetkisi yoksa 403 döner; tenant guard ve rol kapsamı arka uçta uygulanır (AC-309); `Cache-Control: no-store` döner; audit yazmaz (salt okuma). Kullanıcı başına hız sınırına tabidir: 5 açık sekmenin 10 sn aralıkla yoklaması 429 almaz, sınırın aşılması 429 `RATE_LIMITED` döner. Sunucu tarafı yanıt süresi, 100 açık oturum ve 300 bekleyen misafirde p95 ≤ 100 ms'dir. (Entegrasyon testi: yetkisiz 403, başka tenant 0/yok, sınır aşımında 429; yük testi p95 ölçümü `docs/test-raporu.md`'ye yazılır.)
- **AC-315:** (dayanıklılık) Sayı alınamazsa (ağ hatası, 5xx, 429) gösterge son bilinen değeri korur, hata toast'ı ve tarayıcı konsolu hatası üretmez ve sonraki yenilemede sessizce yeniden dener. Mevcut "Liste güncellenemedi; son bilinen durum gösteriliyor." uyarısı oturum listesinde aynen çalışır. Sunucu yeniden başlarsa (bellekteki lobi sıfırlanır) gösterge en geç 10 sn içinde gerçek duruma (genellikle 0) iner; sunucu "bekliyor" bilgisini kalıcı tutmadığı için hayalet rozet kalmaz. (e2e: ağ kesme → son değer, konsol hatası 0; server restart → ≤ 10 sn sayaç 0.)
- **AC-316:** (olayın yeniden üretimi, staging testi) Teknisyen yeni oturum açıp "Talepler" sayfasına geçer. Müşteri Hızlı Destek (Windows) ile kodu girip bekleme odasına düşer. En geç 10 sn içinde menü sayacı "1" olur ve toast görünür. Teknisyen toast'taki "Konsolu aç" ile tek tıkla konsola geçer, kabul kodunu girer ve oturum ACTIVE olur. Sayaç ve rozet en geç 10 sn içinde kaybolur. Aynı test tarayıcı modundaki misafirle de tekrarlanır. Ölçülen süreler `docs/test-raporu.md`'ye yazılır.

## 5. Riskler

| #    | Risk                                                                                             | Etki                                   | Azaltma                                                                                                                                | Sahibi                   |
| ---- | ------------------------------------------------------------------------------------------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| R-L1 | Lobi durumu tek server instance'ın belleğinde. İkinci instance eklenirse sayım yanlış olur       | Orta (bugün tek instance)              | Mimari kayda "tek instance varsayımı" düşülür; çok instance'a geçişte paylaşımlı durum (ör. pub/sub) zorunlu ön koşul olur             | mimar                    |
| R-L2 | Yoklama ile 10 sn gecikme: müşteri bu sürede "bekliyor" ekranında kalır                          | Düşük                                  | 10 sn üst sınır AC'de; mimar `/ws/panel` genişletmesini seçerse gecikme ~3 sn'ye iner (AC-149 düzeyi). İkisi de AC'yi karşılar         | mimar                    |
| R-L3 | Liste satırında "Bekliyor" (PENDING etiketi) ile "Müşteri bekliyor" yan yana durunca karışabilir | Orta (olayın kök nedeni anlaşılmazlık) | Rozet farklı metin, ikon ve renk token'ıyla ayrılır (AC-312). Etiketin "Müşteri bekleniyor" olarak yeniden adlandırılması Sonra (L-S2) | frontend-dev + kullanıcı |
| R-L4 | Çok sekmede aynı toast birden çok kez görünür                                                    | Düşük                                  | Kabul edildi: her sekme kendi toast'ını gösterir. Sekmeler arası tekilleştirme Sonra                                                   | —                        |
| R-L5 | Yoklama kullanıcı başına yük ekler                                                               | Düşük                                  | Değer bellekten gelir, DB'ye gitmez (hedef); hız sınırı ve p95 AC-314'te                                                               | backend-dev              |

## 6. Sonra (unutulmasın)

| #    | Madde                                                                                                                | Not                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| L-S1 | Tarayıcı (OS) bildirimi ve sesli uyarı, kullanıcı tercihiyle (profilde aç/kapa, izin akışı, varsayılan kapalı)       | İlk kullanım geri bildirimine göre; sekme başlığı ve toast yetmezse öne çekilir               |
| L-S2 | PENDING durum etiketi "Bekliyor" → "Müşteri bekleniyor" (liste, geçmiş, CSV `labels.ts`)                             | Metin değişikliği; geçmiş ve CSV etkisi değerlendirilmeli                                     |
| L-S3 | "Talepler" boşken ve kullanıcının bekleyen lobisi varken bilgi satırı: "Bekleme odasında müşteriniz var — Oturumlar" | Olaydaki yanlış yöne bakmayı doğrudan kapatır; menü sayacı (AC-306) çoğunu çözdüğü için Sonra |
| L-S4 | Sekmeler arası toast tekilleştirme (BroadcastChannel)                                                                | R-L4                                                                                          |

## 7. Varsayımlar (kullanıcıya sorulmadı; koordinatör talimatıyla makul varsayım)

- V-L1: Gecikme üst sınırı **10 sn**'dir (mevcut liste yenileme aralığı). Daha hızlı yol (WS) serbesttir ama zorunlu değildir.
- V-L2: Menü sayacı, toast ve sekme başlığı **yalnız kendi oturumlarını** sayar. ADMIN başkasının lobisinden kabul yapamadığı için kendi sayacına başkasının misafiri eklenmez; liste rozeti ise ADMIN'e bilgi verir.
- V-L3: Firma seçmemiş Super Admin'de liste rozeti var (bilgi), sayaç/toast/başlık yok. Gerekçe: bu modda eylem yok (commit a71d80e notu) ve tüm firmaların lobileri gürültü üretir.
- V-L4: Göstergede müşteri adı **yoktur**. Destek talebi toast'ında ad gösterilmesi (AC-149) bilinçli bir farktır: talepte ad, talebi kabul edip etmeme kararı için gerekir; lobide karar konsolda verilir.
- V-L5: Göstergenin yetkisi `sessions.view`'dir; yeni bir yetki anahtarı eklenmez (yetki toggle listesi değişmez).
- V-L6: Sayfa yüklenirken zaten bekleyen misafir için toast gösterilmez; sayaç ve rozet yeterlidir.
- V-L7: Kendi oturumu listesinde "Konsolu aç" düğmesi PENDING satırlarda zaten var ya da bu işle eklenir; rozet de aynı hedefe gider.
- V-L8: Bu iş P13b'den bağımsız, küçük bir E4 eki olarak ele alınır. Prod'a çıkışı ayrı staging (P13c) kuralına tabidir; paket sırası koordinatörde.

Toplam: AC-304..AC-316 ile proje **316 kabul kriteri**ne çıkar.
