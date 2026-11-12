# Test Raporu — Tur P11 (audit log, sistem ayarları MySQL/TURN, aydınlatma metni)
DURUM: GEÇTİ (ENGELLEYİCİ/YÜKSEK yok; P11 AC'lerinin hepsi sahte API ile uçtan uca ✅; 1 ORTA + 1 DÜŞÜK bulgu var, P12'den önce düzeltilmesi önerilir)
Ortam: YEREL. Üretim derlemesi (standalone) `http://localhost:3217` ve sahte API `e2e/mock-api.mjs` (:4217, `mock-audit.mjs` senaryoları).
Kod: `main` 5ef9911 ve çalışma ağacı (P11 commit edilmemiş). Tarih: 2026-11-12. Staging'e bağlanılmadı, ACCESS.txt okunmadı, kod değiştirilmedi.
Gerçek server ortamı da kuruldu (`docs/test-raporu/e2e/p11/setup.sh`: geçici MySQL `rs-mysql-p11op:33346`, seed, server :3323, web :3248) ve hazır hale geldi.
Ancak tur süresi dolduğu için gerçek server ile akış koşulamadı (bkz. "Kapsam dışı kalanlar").
Başlatılan bütün süreçler kapatıldı: mock, web, server ve DB konteyneri silindi, geçici sır klasörü silindi.

Betikler `docs/test-raporu/e2e/p11/` altında: `common.mjs`, `mock-scan.mjs` (senaryo × rota × tema × genişlik taraması),
`probe-sa-audit*.mjs` (taşma kök nedeni), `setup.sh`, `totp.mjs`. Sonuçlar `mock-scan.jsonl`, ekran görüntüleri `img/` (89 adet).

## Özet
| Ölçüt | Değer |
|---|---|
| Mevcut e2e takımı (desktop + mobile) | **245 geçti, 0 kaldı**, 95 atlandı (masaüstü/mobil ayrımı, tasarım gereği). `p11-admin.spec.ts` dahil, P1–P10 regresyonu da dahil |
| Taranan görünüm | 6 senaryo (Admin, Super Admin, yalnız görüntüleme, yetkisiz, boş, hatalı API), 22 rota, açık/koyu, 1280/390 px: **88 görünüm** |
| Açılamayan sayfa / 5xx | 0 / 0 (`aubroken` senaryosundaki kasıtlı 500 yerinde "Tekrar dene" gösteriliyor) |
| JS hatası (pageerror) / konsol hatası | 0 / 0 |
| axe (WCAG 2.1 AA) | 88 görünümde **0 ihlal** (e2e'de ayrıca ayrıntı penceresi, onay diyalogları ve TURN/MySQL formları da 0) |
| Yatay taşma | 87 görünümde 0. **1 görünümde 45 px**: Super Admin `/audit`, 1280 px, iki tema (Bulgu 1) |
| Kırık iç link | 0 (14 farklı iç bağlantı, Admin ve Super Admin çereziyle) |
| > 3 sn açılan | 0 (sayfalar 0,54–0,74 sn) |

## Bulgular (öncelik sırasıyla)

### [ORTA] Super Admin audit tablosu 1280 px'te sayfayı yatay kaydırıyor; "Ayrıntı" sütunu kenardan taşıyor
Sayfa/akış: `/audit`, Super Admin (firma seçilmemiş, tablo "Firma" sütunuyla çiziliyor). 1280×800, açık ve koyu tema.
Adımlar: 1. Super Admin ile giriş yapın. 2. Pencere genişliği 1280 px iken `/audit` açın. 3. Sayfayı yatay kaydırın.
Beklenen: Geniş tablo yalnız kendi kabı içinde kayar (`overflow-x-auto`); sayfanın kendisi (`html`) yatay kaymaz.
Gerçekleşen: Tablo 1064 px, kabı 976 px; tablo kap içinde doğru kayıyor. Buna karşın son sütundaki "Ayrıntı" düğmesinin
`<span class="sr-only">Ayrıntı</span>` öğesi `position:absolute` ve kaydırma kabı konumlandırılmış (`relative`) değil.
Bu yüzden öğe kabın kırpmasından kaçıyor ve belgeyi 1325 px'e genişletiyor (`html.scrollWidth=1325`, `clientWidth=1280`).
Sonuç: sayfa 45 px yatay kaydırma çubuğu gösteriyor, üst bar sağda kısa kalıyor. Kabın görünen kenarında ayrıntı (göz) simgesi
yarım kesik duruyor ve satırın eylemi ilk bakışta görünmüyor.
1366 px ve üstünde sorun yok. Admin görünümünde (Firma sütunu yok) 1280 px'te de yok; mevcut QA-2 e2e testi yalnız Admin ile
koştuğu için bunu yakalamıyor.
Kanıt: `docs/test-raporu/e2e/p11/img/m-light-1280-ausa-audit.png` (sağda boş şerit ve kesik simge),
`img/sa-audit-1280-table.png`, `mock-scan.jsonl` ("ausa light/dark 1280 /audit" `overflow.doc=45`),
`probe-sa-audit2.mjs` çıktısı: `SPAN.sr-only right=1325 pos=absolute txt=Ayrıntı`.
Öneri: tablo kabına `relative` verin (sr-only kırpılır) ve Super Admin görünümünde sütun genişliklerini daraltın.
Örneğin Varlık ve IP sütunları `xl` altında gizlenebilir ya da Ayrıntı sütunu `sticky right-0` yapılabilir; amaç eylemin her
genişlikte görünmesi. Testte QA-2 taşma kontrolü `ausa` senaryosuyla da koşmalı.
Atanan: frontend-dev

### [DÜŞÜK] Ayarlar bölüm yorumu güncel değil (3 sekme yazıyor, sekme sayısı 4)
Yer: `apps/web/app/(panel)/settings/layout.tsx:3`. Yorumda "Destek talepleri · E-posta (SMTP) · Güvenlik" yazıyor,
"Aydınlatma metni" sekmesi eksik. Davranışa etkisi yok. Atanan: frontend-dev

### Bilgi (bulgu değil)
- P10 DÜŞÜK bulgusu (375 px'te Ayarlar alt menüsü "Güvenlik"i kırpıyordu) giderildi. Yeni `TabNav` dar ekranda 4 eşit sütun
  çiziyor (ikon üstte, etiket altta) ve bütün sekmeler görünüyor (`img/m-*-390-auadm-settings_consent_text.png`).
- Sistem ayarları 390 px koyu temada: Alert info tonu (mavi) ve uyarı tonu (TLS notu) okunaklı, şifre alanı maskeli ve boş,
  ipucu "Kayıtlı — değiştirmek için yazın" (`img/m-dark-390-ausa-admin_settings_mysql.png`).
- Tarih alanları (`input type=date`) başsız Chromium'da "mm/dd/yyyy" biçiminde görünüyor. Biçimi tarayıcının arayüz dili
  belirliyor (sayfanın `lang` özniteliği değil); Türkçe Chrome'da "gg.aa.yyyy" beklenir. Bulgu sayılmadı.

## Akış sonuçları
| Akış | Sonuç | Not |
|---|---|---|
| Audit: liste (50) → Daha fazla yükle (60) → ayrıntı (JSON düz metin, `<img onerror>` yorumlanmıyor) → Esc → CSV indir | ✅ | e2e AC-76 kritik akış; CSV isteğinde `cursor` yok, dosya adı `audit-YYYY-MM-DD.csv` |
| Audit filtreleri: İşlem grubu + Sonuç + Kullanıcı URL'de; Filtreleri temizle; geçersiz URL değeri uyarısı; 731 gün sınırı | ✅ | e2e ve tarama (`/audit?result=hepsi` → "yok sayıldı" uyarısı) |
| Audit yetkisiz: menüde yok, sayfa 403 durumu; yalnız görüntüleme yetkisinde CSV düğmesi yok | ✅ | e2e ve tarama ekranları `m-*-aunone-audit`, `m-*-auview-audit` |
| Audit boş durum; liste 500 → Tekrar dene; "Daha fazla yükle" 500 → yeniden dene | ✅ | e2e ve tarama (`auempty`, `aubroken`) |
| Audit mobil: kart görünümü, karta dokununca ayrıntı açılıyor, taşma yok | ✅ | e2e mobil |
| Super Admin audit: Firma filtresi (`/admin/tenants`'tan) | ✅ | e2e. 1280 px yerleşim sorunu Bulgu 1'de |
| MySQL: test hata (süre gösterilmiyor, `role=alert`), bekleme metni "10 saniyeye kadar", başarı ve süre, 429 | ✅ | e2e AC-77 |
| MySQL: şifre forma geri yazılmıyor (kayıttan ve yenilemeden sonra boş); aynı hedefte boş şifre gönderilmiyor | ✅ | e2e AC-78 |
| MySQL: host, port veya kullanıcı değişip şifre boşken 400, hata şifre alanının altında ve odak şifre alanında | ✅ | e2e (QA-1) |
| TURN: satır ekle (odak yeni satırda) → geçersiz URL satır hatası → satırı kaldır → kısa secret hatası → Sıfırla → Ortam değerlerine dön (onay, odak Vazgeç'te) → env | ✅ | e2e AC-78 TURN |
| Sistem ayarları yalnız Super Admin: Admin'de menüde yok, 3 rotada "yetkisiz" durumu; `/admin/settings` → `/mysql` | ✅ | e2e ve tarama |
| Aydınlatma metni: sayaç, 50 karakter alt sınırı, onaylı yeni sürüm (odak Vazgeç'te), "Sürüm 3 kaydedildi", geçmiş 3 satır, HTML düz metin | ✅ | e2e |
| Aydınlatma metni salt okunur (`settings.edit` yok) | ✅ | e2e |
| /history CSV düğmesi (ortak `csv-export-button` regresyonu) | ✅ | e2e `p8-history.spec.ts` geçti |
| Yan menü yeni öğeleri: Audit log (ScrollText), Sistem ayarları (ServerCog), anlamlı ve tekil ikonlar, `aria-current` doğru | ✅ | tarama ekranları ve e2e |
| Klavye: diyaloglarda başlangıç odağı (Kapat / Vazgeç), Esc ile kapanma, hata sonrası odak hatalı alanda | ✅ | e2e iddiaları. Sayfa boyu serbest Tab dolaşımı ayrıca kaydedilmedi |
| Tüm panel regresyonu (P1–P10 e2e: oturumlar, talepler, müşteriler, geçmiş, kullanıcılar, firmalar, hesap/2FA, SMTP) | ✅ | 245/245 |

## Kabul kriterleri (uçtan uca)
| AC | Durum | Nasıl doğrulandı |
|---|---|---|
| AC-76 audit ekranı: filtre (tarih, kullanıcı, işlem, sonuç), sayfalı, avatar, düzenle/sil yok | ✅ | e2e ve tarama. Sahte API PUT/DELETE için 405 dönüyor; gerçek server 405'i backend entegrasyon testine dayanıyor (bu turda arayüzden denenmedi) |
| AC-77 MySQL ayar ekranı, port 3306, test sonucu 10 sn içinde | ✅ | e2e (sahte API) |
| AC-78 gizli değer forma yazılmaz, boşsa korunur (MySQL, TURN) | ✅ | e2e. Şifreli saklama ve audit yazımı backend testine dayanıyor |
| AC-124 audit CSV (düğme ve indirme) | ✅ (arayüz) | e2e. Formül kaçışı sunucu birim testine dayanıyor |
| Aydınlatma metni yeni sürüm (AC-127 ile ilişkili) | ✅ | e2e |

## Görsel gözlemler (ekran görüntülerinden)
- `m-light-1280-ausa-audit.png`: Bulgu 1. Sağda 45 px boş şerit var, son sütundaki göz simgesi kesik. Satırlar, rozetler
  (Başarılı/Başarısız metinle) ve avatarlar (resim veya baş harf) düzgün.
- `m-dark-390-ausa-admin_settings_mysql.png`: iki sekme eşit genişlikte, kartlar ikonlu; info ve uyarı kutuları koyu temada
  okunaklı; taşma yok.
- Admin `/admin/settings/*` görünümü: başlık ve tek uyarı kutusu, sekme ve form yok (doğru). Boş, hata ve yetkisiz audit
  durumları iki temada da okunaklı.

## Kapsam dışı kalanlar (sonraki turda)
- Gerçek server ve gerçek MySQL ile akışlar koşulamadı: SA girişi + 2FA kurulumu, MySQL testinin geçici DB'ye karşı başarı,
  yanlış şifre ve zaman aşımı sonuçları, PUT/DELETE `/audit` 405, gerçek audit kayıtlarının listelenmesi ve CSV formül kaçışı.
  Ortam betiği hazır: `WORK=<klasör> docs/test-raporu/e2e/p11/setup.sh up|down`.
- `sayfa-tarayici.mjs` aracı koşulmadı; yerine senaryo bazlı `mock-scan.mjs` koşuldu (aynı ölçütler, daha geniş durum kapsamı).
