# Test Raporu — P12b (WhatsApp servisi sekmesi, AC-196) — Tur 1
DURUM: GEÇTİ
Ortam: yerel, sahte API (`apps/web/e2e/mock-api.mjs` :4217, `mock-audit.mjs` senaryoları ausa / ausawa0 / ausains / ausabrk + auadm / auview / aunone) + üretim derlemesi (standalone, gerçek CSP) :3217; `main` @ 3431f69 + commit edilmemiş P12b çalışma ağacı; 2026-11-13. Staging'e bağlanılmadı.

Betikler ve kanıtlar: `docs/test-raporu/e2e/p12b/` (`scan.mjs`, `flows.mjs`, `flows2.mjs`, `audit-flow.mjs`, `audit-proxy.mjs`, `reuse.config.ts`; `scan.jsonl`, `flows.jsonl`; ekranlar `img/`).

## Özet
| Ölçüt | Sonuç |
|---|---|
| Taranan sayfa görünümü | 48 (7 senaryo × rota × açık/koyu × 1280/390) + audit 4 görünüm |
| Açılmayan sayfa / 5xx | 0 (ausabrk'teki 500 kasıtlı; SSR'de yakalanıp "Tekrar dene" durumu gösteriliyor) |
| Konsol / JS hatası | 0 kendiliğinden. Yalnız kasıtlı tetiklenen 403/429/500/ağ kesintisinin tarayıcı "Failed to load resource" satırları var |
| Kırık iç link | 0 (14 link, ausa ve auadm ile kontrol edildi) |
| axe (wcag2a/aa, 21aa) | 0 ihlal (tarama + audit ekranı, iki tema, iki genişlik) |
| 390 px mobil taşma | 0 |
| Yavaş sayfa | yok (en uzun 0,95 sn, /admin/settings → mysql yönlendirmesi) |
| Proje e2e (`p12b-whatsapp` + `p11-admin`) | 28 geçti, 0 kaldı (16 test bilerek yalnız masaüstünde koşuyor) |

## Bulgular (öncelik sırasıyla)

### [ORTA] Audit ekranında WhatsApp testinin maskeli numarası görünmüyor
Sayfa/akış: /audit → "WhatsApp test mesajı" satırı → Ayrıntı
Adımlar: 1. `audit-proxy.mjs` ile listeye sunucunun yazdığı biçimde bir `settings.whatsapp.test` kaydı ekle (`newValue {recipient: maskeli, result, reason}`). 2. /audit'te satırın "Ayrıntı"sını aç.
Beklenen: AC-196 "Kayıt, kaldırma ve test … audit'e yazılır; numara maskeli görünür."
Gerçekleşen: Detayda yalnız "Neden unreachable" ve "Gönderim ve test kayıtlarında yalnız sonuç nedeni gösterilir; alıcı … burada yer almaz" notu var. Sunucu tarafı da aynı süzmeyi yapıyor (`apps/server/src/audit/view.ts:10`, `/^settings\..+\.test$/`). Kayıt DB'de maskeli tutuluyor, ancak ekranda hiçbir yerde görünmüyor. Ayrıca neden kodu Türkçeye çevrilmeden ham gösteriliyor ("unreachable").
Kanıt: `docs/test-raporu/e2e/p12b/img/a-detail-0.png`, flows.jsonl `auditdetail i=0`
Atanan: backend-dev + frontend-dev. AC metni ile mail kaydı kuralı (alıcı gizli) çelişiyor. Önce proje-yoneticisi hangisinin geçerli olacağına karar vermeli: maskeli numara gösterilecek ya da AC metni düzeltilecek.

### [DÜŞÜK] Büyük harfli şema (`HTTPS://…`) genel bir hata mesajıyla reddediliyor
Sayfa/akış: /admin/settings/whatsapp → Servis URL'si
Adımlar: 1. ausa ile aç. 2. `HTTPS://WA.ORNEK.COM` yaz. 3. Kaydet.
Beklenen: URL şeması büyük/küçük harf duyarlı değildir (RFC 3986). Adres ya küçük harfe çevrilip kabul edilmeli ya da mesaj "http:// veya https:// (küçük harf)" demeli.
Gerçekleşen: "Geçerli bir adres girin (ör. https://wa.ornek.com:3000)" mesajı çıkıyor ve kullanıcı nedenini anlayamıyor. (İstemci ön kontrolü `/^https?:\/\//i` geçiyor, `waServiceUrlSchema` reddediyor.)
Kanıt: `img/f-buyuk-harf-sema.png`
Atanan: frontend-dev (mesaj ya da normalize) + backend-dev (contracts şeması)

### [DÜŞÜK] Hiç yapılandırılmamış serviste kaynak rozeti "Ortam değişkeni" yazıyor
Sayfa/akış: ausawa0 → /admin/settings/whatsapp
Adımlar: 1. Panel kaydı yok, env yok (`url: null`) senaryosuyla sayfayı aç.
Beklenen: Rozet durumla tutarlı olmalı ("Yapılandırılmamış" veya rozet hiç olmamalı).
Gerçekleşen: Bilgi kutusu "WHATSAPP_SERVICE_URL tanımlı değil" diyor, ama kartın sağ üstündeki rozet "Ortam değişkeni" gösteriyor. Bu ikisi birbiriyle çelişiyor.
Kanıt: `img/s-light-390-ausawa0-admin_settings_whatsapp.png`
Atanan: frontend-dev

### [DÜŞÜK / bilgi] IDN ve IPv6 loopback adresleri kabul ediliyor
`https://wa.örnek.com` ve `http://[::1]:3000` istemci ve contracts doğrulamasından geçiyor (sahte API kaydetti). Sunucuda fetch IDN'i punycode'a çeviriyor. Loopback/SSRF değerlendirmesi güvenlik ajanının işi, burada yalnız gözlem olarak not edildi. `:99999` portu doğru şekilde reddediliyor.
Atanan: guvenlik (değerlendirme)

## Akış sonuçları
| Akış | Sonuç | Not |
|---|---|---|
| Sekme gezinmesi mysql → turn → system-logo → whatsapp → mysql | ✅ | URL, `aria-current="page"`, başlık "WhatsApp servisi · Sistem ayarları" doğru. /admin/settings → /mysql (istemci yönlendirmesi). Geri tuşu formu geri getiriyor. Klavyede Tab sırası doğru |
| 5 durum: dolu (Panel), kısmi (env), boş (ausawa0), hata (ausabrk → Tekrar dene), yetkisiz (auadm/auview/aunone) | ✅ | Yükleniyor: `loading.tsx` mevcut (SSR, ayrıca ölçülmedi) |
| Kaydet: sondaki `/` kırpılıyor, kaynak Panel'e geçiyor, son güncelleme doluyor | ✅ | e2e kritik akış |
| Geçersiz URL: boş, `<script>`, `' OR 1=1`, `javascript:`, `https://`, boşluklu, şemasız, `#`, `?`, `@`, ftp, 201 karakter | ✅ | Hiçbirinde PUT gitmiyor, `aria-invalid` ve odak doğru. Tam 200 karakter kabul ediliyor. Sunucu 400 `fields.url` alanın altında gösteriliyor |
| PUT 500 / ağ kesintisi | ✅ | Form üstünde hata ve istek kimliği gösteriliyor, girilen değer korunuyor |
| Çift tıklama ile kaydet | ✅ | Tek PUT gidiyor |
| Yenileme / kaydedilmemiş değer | ✅ | Yenilemede kayıtlı değer geliyor. Sekme değiştirirken "Kaydedilmemiş değişiklikler var" diyaloğu açılıyor, "Sayfada kal" değeri koruyor |
| Ortam değişkenine dön diyaloğu | ✅ | Odak Vazgeç'te. Esc ve Vazgeç ile DELETE gitmiyor, odak tetikleyiciye dönüyor. Onaylayınca kaynak env oluyor, uyarı kalkıyor. DELETE ağ hatasında hata gösteriliyor, Panel kaynağı kalıyor |
| Güvensiz adres uyarısı (ausains) | ✅ | AC metni birebir. Test isteği gönderilmeden "Servis güvenli yapılandırılmamış." çıkıyor. Özel ağ adresine geçince uyarı kalkıyor |
| Test Mesajı Gönder: başarı / servis hatası / 429 (6. deneme) / ağ kesintisi / 500 | ✅ | Başarıda `role=status`, hatada `role=alert`. 429'da kilit tonu çıkıyor (mobil koyu temada da). Test butonuna çift tıklayınca tek POST gidiyor |
| Telefon girdileri: boş, `<script>`, `' OR 1=1`, fazla hane | ✅ | İstemcide reddediliyor, POST gitmiyor. `0532…`, `90…`, `+49…`, `532…` kabul ediliyor |
| Yapılandırılmamışken test | ✅ | Buton pasif, "Önce servis adresini kaydedin" yazıyor |
| Yetkisiz: çerezsiz → `/login?next=…`; Admin/User → yetkisiz uyarısı, menüde Sistem ayarları yok; GET/PUT/test API 403; CSRF'siz PUT 403 | ✅ | |
| Audit: 3 yeni eylem etiketi listede (masaüstü tablo + mobil kart) ve İşlem filtresinde | ✅ | "WhatsApp servis adresi güncellendi", "WhatsApp servisi ortam değerine döndü", "WhatsApp test mesajı". Ham eylem adı yalnız ikincil satırda. Güncelleme/kaldırma detayında eski→yeni `{url}` var |
| axe + 390 px taşma, açık/koyu | ✅ | 0 / 0 |

## Kabul kriterleri (uçtan uca, sahte API)
| AC | Sonuç | Nasıl doğrulandı |
|---|---|---|
| AC-196 | ✅ (ORTA bulgu ile) | Görme, kaydetme, kaldırma, kaynak ve son güncelleme; adres kuralları ve 400; env'e dönüş; güvensiz uyarı ve kanalın kapalı kalması; test başarı/hata, güvensiz adreste istek gitmemesi, 429; Admin/User 403; audit etiketleri. "Numara maskeli görünür" kısmı ekranda karşılanmıyor (bkz. ORTA bulgu). Yeniden başlatmasız geçiş ve yönlendirmenin izlenmemesi sunucu tarafı konusu, bu turda kapsam dışı (backend entegrasyon testleri) |
| AC-152 (r3, tenant ekranında adres yok) | — | Bu turun kapsamında değil |

## Görsel gözlemler (ekran görüntülerinden)
- Masaüstü açık ve koyu temada düzen temiz. Sekme ikonları anlamlı (Database / Waypoints / Image / MessageCircle). Etkin adres monospace yazılmış ve okunaklı. Koyu temada güvensiz uyarısı (sarı) iyi kontrastlı (`s-dark-1280-ausains-…`).
- 390 px'te sekmeler 4 sütuna sığıyor, "WhatsApp servisi" iki satıra kırılıyor ama taşma yok. Test butonu tam genişlikte, 44 px'in üzerinde.
- "Ortam değişkenine dön" diyaloğunda gövde metninin son satırı ("gönderilmez.") alt ayırıcı çizgiye çok yakın; alt boşluk dar (`img/f-reset-dialog.png`). Kozmetik.
- Yapılandırılmamış senaryoda rozet ile bilgi kutusu çelişiyor (DÜŞÜK bulgu).
- Audit mobil kartlarında yeni etiketler tam okunuyor, koyu temada sorun yok (`img/a-dark-390-audit.png`).
