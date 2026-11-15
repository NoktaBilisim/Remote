# Gereksinimler — E10 / P8c Müşteri firmalar ve kalıcı istemci

Tarih: 2026-11-12 Durum: TASLAK. Ana doküman: `/Users/mennan/Projeler/Remote/docs/gereksinimler.md` (ayrılmaz parçasıdır).
AC'ler: `/Users/mennan/Projeler/Remote/docs/gereksinimler-kabul-kriterleri-e10.md` (AC-165..AC-195).

## 1. Amaç ve iş değeri

Sahadan gelen geri bildirime göre (2026-11-12) teknisyen link akışı çalışıyor. Ancak müşteri, elindeki dosyayı yeniden çalıştırdığında teknisyene talep düşmüyor (madde 3, 6). Firmaya özel dosyalar da panelde bir yerde görünmüyor (madde 7). P8c ile tenant, kendi müşteri firmalarını kaydeder ve her birine kalıcı bir indirme bağlantısı verir. Müşterinin elindeki hangi NoktaDestek dosyası olursa olsun, bir kez başarılı oturum yaptıktan sonra o bilgisayar firmayı hatırlar ve "Destek iste" ile talep açabilir. Teknisyenin link/kod gönderme yolu (madde 5) aynı programda "Bağlantı kodum var" olarak korunur.

## 2. Roller (ek)

- **Admin:** Müşteri firmaları oluşturur, düzenler, bağlantılarını yeniler, pasife alır (`customers.*` varsayılan açık).
- **User (Teknisyen):** Yetkisi varsa müşteri listesini görür, oturum açarken müşteri seçer, talepleri müşteriye göre süzer (`customers.*` varsayılan kapalı).
- **Super Admin:** Müşterileri seçili tenant bağlamında yönetir.
- **Müşteri (Misafir):** Hesabı yoktur. Müşteri dosyası veya bilgisayar kaydıyla talep açar, "Bu bilgisayarı unut" ile kaydı siler.

## 3. Kapsam

### Mevcut olan (çift iş açılmaz)

- Genel (tenant) bağlantı, firma dosyası, talep formu, kuyruk, bildirim, kabul ve otomatik bağlanma: E9/P8b (AC-129..AC-164). P8c bunları yeniden yazmaz; müşteri kimliğini ekler.
- DPAPI ayar dosyası ve "Bilgilerimi unut": P8b-2 (`apps/agent-win/internal/remember`). P8c aynı dosyaya bilgisayar kaydını ekler; yeni dosya açılmaz.
- "Teknisyenden kod aldım" ikincil yolu: P8b-2 (AC-162). P8c bunu "Bağlantı kodum var" olarak tüm dosya türlerinin ana ekranına taşır.
- Talepteki `knownDevice` (cihaz anahtarı) rozeti: P8b. Kayıtla birlikte cihaz anahtarı her zaman bulunacağından rozet kendiliğinden daha sık dolar.
- Siyah ekran (ilk offer'da TURN yok) ayrı bug fix olarak düzeltiliyor. P8c yalnız regresyon kriterini (AC-192) taşır.

### Kapsamda

- A) "Müşteriler" modülü: CRUD (silme yok, pasife alma var), arama/filtre, 5 durum, müşteri başına kalıcı bağlantı ve `NoktaDestek-<etiket>-<ref>.exe`, bağlantı yenileme, `customers.view/create/edit/delete`, audit.
- B) Genel bağlantı adlandırması; müşteri atanmamış talepler "Genel".
- C) Talep → müşteri ilişkisi; Talepler ekranında sütun ve filtre; müşteri detayında talep/oturum geçmişi; oturum geçmişinde sütun, filtre ve CSV.
- D) Yeni Destek Oturumu'nda isteğe bağlı müşteri seçimi.
- E) Bilgisayar kaydı (kalıcı istemci): başarılı oturumdan sonra DPAPI'li kayıt, tekrar çalıştırmada "Destek iste", "Bu bilgisayarı unut", geçersizleşme kuralları.
- F) İstemci ana ekranı: "Destek iste" (birincil) + "Bağlantı kodum var".
- G) Panelde "Müşteriye nasıl gönderilir?" yardımı.
- İstemci sürümü 0.10.0; 0.9.x ile geriye uyumluluk.

### Kapsam DIŞI (bu pakette)

1. Pencere bazlı paylaşım (yalnız seçili pencere) — Sonra listesinde.
2. macOS ve Linux istemci (genel kapsam dışı madde 3).
3. Müşteri portalı / müşteri girişi / müşterinin kendi talep geçmişini görmesi.
4. WhatsApp bildirimine müşteri firma bilgisi eklenmesi veya müşteriye WhatsApp/SMS/e-posta ile bağlantı gönderimi (staging'de WhatsApp kapalı; bağlantıyı teknisyen elle kopyalar).
5. Müşteri başına SLA, sözleşme, fatura, kontör/süre takibi, Paraşüt cari eşlemesi.
6. Gözetimsiz erişim (S7): kayıt yalnız talep açar, teknisyen kendiliğinden bağlanamaz.
7. Müşterinin kalıcı silinmesi (hard delete); toplu içe/dışa aktarma (CSV import).
8. Aynı bilgisayarda birden fazla firma kaydı (tek kayıt; AC-187).
9. Tarayıcı-yalnız modda bilgisayar kaydı.
10. "Bağlantı kodum var" alanına link yapıştırma (yalnız 8 haneli kod).

## 4. Kullanıcı hikâyeleri

- US-38: Admin olarak müşteri firmalarımı kaydetmek ve her birine ayrı, kalıcı bir indirme bağlantısı vermek istiyorum ki hangi müşteriye hangi dosyayı gönderdiğimi tek yerde göreyim. (madde 7)
- US-39: Admin olarak bir müşterinin bağlantısını yenilemek veya müşteriyi pasife almak istiyorum ki sızan ya da artık hizmet vermediğim müşterinin dosyaları çalışmasın.
- US-40: Teknisyen olarak talepleri ve oturumları müşteri firmaya göre görmek ve süzmek istiyorum ki kimin ne sıklıkla destek aldığını bileyim.
- US-41: Teknisyen olarak yeni destek oturumu açarken müşteri firmayı seçmek istiyorum ki o müşteri bir sonraki seferde doğrudan bana talep gönderebilsin. (madde 5)
- US-42: Müşteri olarak daha önce destek aldığım dosyayı yeniden açtığımda "Destek iste" diyebilmek istiyorum ki teknisyenden yeni link beklemeyeyim. (madde 3, 6)
- US-43: Müşteri olarak aynı programda teknisyenin verdiği kodu da girebilmek istiyorum ki iki ayrı dosyayla uğraşmayayım. (madde 5)
- US-44: Müşteri olarak bilgisayarımın hatırlandığını görmek ve istediğimde "Bu bilgisayarı unut" ile silmek istiyorum.
- US-45: Admin olarak müşteriye dosyayı nasıl göndereceğimi panelde kısaca görmek istiyorum.

## 5. Fonksiyonel olmayan gereksinimler (ek)

- **Performans:** Müşteri listesi 1.000 müşteri / 10.000 talepte < 500 ms (AC-166). Kayıtlı bilgisayarda açılıştan ana ekrana ≤ 5 sn. Talepten panel bildirimine p95 ≤ 3 sn (AC-149 aynen). Talep oturumunda kabulden ilk kareye p95 ≤ 8 sn (AC-192).
- **Güvenlik:** Müşteri ref'i gizli değildir ama tahmin edilemez (≥ 64 bit) ve yenilenebilir. Kayıt anahtarı gizlidir (≥ 128 bit); sunucuda yalnız özeti tutulur, log ve audit'e yazılmaz. Kayıt yalnız talep açar (AC-184). E9 hız sınırları aynen geçerlidir. Ref ve kayıt geçersizlik yanıtları tek tiptir (enumeration yok).
- **İstemci:** ADR-0004 r3'teki "tek iz = ayar dosyası" istisnası genişler. Dosya kişisel bilgi olmadan da yalnız kayıt için bulunabilir (AC-188). Mimar ADR-0004 eki yazar.
- **KVKK:** Yetkili kişi alanları kişisel veridir (AC-195). Bilgisayar kaydı aydınlatma metninde açıklanır (AC-188).
- **Erişilebilirlik / yerelleştirme:** WCAG 2.1 AA, açık/koyu tema, Türkçe, Europe/Istanbul.

## 6. Varsayımlar

- V21: Bilgisayar kaydı müşteri onayıyla değil, başarılı oturumla **kendiliğinden** yazılır. Kayıt kişisel veri içermez (tenant/müşteri adı, sunucu, kayıt anahtarı, cihaz anahtarı). Müşteri bunu karşılama ekranındaki bilgi satırından öğrenir ve her an silebilir. Ad/telefon/e-posta hatırlama E9'daki gibi işaretsiz kutucuğa bağlı kalır (V15 değişmez).
- V22: Kayıt anahtarı bilgisayar başına sunucunun ürettiği ayrı bir anahtardır; müşteri ref'inin kopyası değildir. Böylece tek bilgisayar ("Bu bilgisayarı unut") tek tek geçersizleşebilir. Uygulama biçimi mimarındır; AC-184/185 sağlanmalıdır.
- V23: Pasife alma `customers.delete` yetkisiyle yapılır; kalıcı silme yoktur. Yeniden aktif etmede yeni ref üretilir.
- V24: "Toplam talep sayısı" tüm durumları sayar (bekleyen, kabul, ret, iptal, süre dolumu, bağlanamadı); anonimleştirilmiş talepler de sayılır.
- V25: Müşteri adı tenant içinde (pasifler dahil) tekildir; etiket tekil değildir (ref zaten tekildir).
- V26: Talep kabulünde lobi kabul kodu istenmez (V16 aynen). Kayıtlı bilgisayardan açılan talep de aynı akıştır.
- V27: Müşteri dosyası adı biçimi E9 firma dosyasıyla aynıdır. Bu nedenle 0.9.x istemciler müşteri dosyasıyla talep açabilir (AC-191).
- V28: Kayıt, son kullanımdan itibaren tenant saklama süresi (90–730 gün) kadar kullanılmazsa geçersizleşir.

## 7. Riskler

| #   | Risk                                                                                      | Etki                                                  | Önlem                                                                                                                                                                                                 | Sahibi                     |
| --- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| R19 | Kalıcı müşteri ref'i veya bilgisayar kaydı sızar; başkası o müşteri adına talep açar      | Orta: kuyrukta spam, sahte ekranla sosyal mühendislik | Kayıt/ref yalnız talep açar, oturum açamaz (AC-184); teknisyen kabulü ve müşteri onayı şart; E9 hız sınırları; bağlantı yenileme / pasife alma (AC-170/171); "İlk kez görülen kaynak" rozeti (AC-146) | guvenlik + mimar           |
| R20 | Kendiliğinden yazılan kayıt "istemci iz bırakmaz" ilkesini ve müşteri beklentisini zorlar | Orta: güven ve KVKK algısı                            | Bilgi satırı (AC-188), "Bu bilgisayarı unut" (AC-186), aydınlatma metni, ADR-0004 eki                                                                                                                 | mimar + proje-yoneticisi   |
| R21 | Eski 0.9.x istemcilerle uyumsuzluk                                                        | Orta                                                  | Dosya adı biçimi aynı (V27, AC-191); `MIN_AGENT_VERSION` değişmez; kayıt özelliği yalnız 0.10.0+                                                                                                      | backend-dev + devops       |
| R22 | KVKK: müşteri firma yetkili kişi verisi süresiz kalır                                     | Orta                                                  | Pasif + saklama süresi sonunda anonimleştirme, elle boşaltma (AC-195)                                                                                                                                 | dba + backend-dev          |
| R23 | Paylaşılan bilgisayarda (tek Windows profili) başka biri kayıtla talep açar               | Düşük                                                 | Talep kişinin kendi adıyla açılır; teknisyen telefonla doğrular (AC-146 ipucu); "Bu bilgisayarı unut"                                                                                                 | — (kabul edilen risk)      |
| R24 | Siyah ekran düzeltmesi P8c'den önce bitmezse talep akışı sahada yine başarısız görünür    | Yüksek: kullanıcı memnuniyeti                         | Bug fix P8c'den önce yayınlanır; AC-192 P8c kapanış şartıdır                                                                                                                                          | backend-dev ‖ frontend-dev |

## 8. Açık sorular

| #   | Soru                                                                                                            | Varsayılan (cevap gelmezse)                     | Sahibi               |
| --- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------- |
| S18 | Bilgisayar kaydı için müşteriye ayrıca "hatırla" onayı (kutucuk) sorulsun mu?                                   | Hayır, kendiliğinden; bilgi satırı + unut (V21) | Kullanıcı + guvenlik |
| S19 | Bir bilgisayar birden fazla destek firmasına kayıtlı olabilsin mi?                                              | Hayır, tek kayıt, sonuncusu geçerli (AC-187)    | Kullanıcı            |
| S20 | WhatsApp talep bildiriminde müşteri firma adı geçsin mi (müşterinin yazdığı metin değil, tenant'ın girdiği ad)? | Hayır, AC-150 değişmez                          | Kullanıcı            |
| S21 | Müşteri firma için ayrı logo/aydınlatma metni gerekir mi?                                                       | Hayır; tenant logosu ve metni kullanılır        | Kullanıcı            |

## 9. Yol haritası önerisi — P8c (P9'dan önce)

Sıra: siyah ekran bug fix → **P8c-1 → P8c-2** → P9. Paket kuralları (mimari §10.1) geçerlidir.

| Paket                       | İçerik                                                                                                                                                                                                                                                                                                                                                         | AC                                                                 | Ekip                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------- |
| P8c-1 — Sunucu + panel      | `customers` tablosu ve ref ad alanı, talep/oturum `customer_id`, bilgisayar kaydı tablosu ve uçları (oluştur, talep, iptal, unut), geçersizleşme kuralları, `CUSTOMER_PASSIVE` iptal nedeni, permissions, Müşteriler listesi/form/detay/yardım, Talepler ve geçmiş sütun/filtre/CSV, Yeni Oturum müşteri seçimi, audit, anonimleştirme, aydınlatma seed sürümü | 165–180, 181/184/185 (sunucu), 191 (sunucu), 192 (konsol), 193–195 | dba → (backend ‖ frontend ‖ devops)               |
| P8c-2 — İstemci 0.10.0 (Go) | Kaydın yazılması/okunması, dosya öncelik kuralı, süresi geçmiş kodda ana ekran, ana ekran iki yol, "Bu bilgisayarı unut", geçersiz kayıt mesajı, bilgi satırı, Windows elle testleri (iz testi dahil)                                                                                                                                                          | 181–190, 191 (istemci), 192 (staging ölçümü), 193                  | backend-dev (Go) → qa ‖ güvenlik → test-operatoru |

Mimarın yapacakları: `docs/mimari.md` §10'a P8c satırları; veri modeli (`customers`, bilgisayar kaydı); mimari-api (müşteri uçları, kayıt uçları, mevcut public talep ucunun müşteri ref'i ve kayıt anahtarı kabul etmesi); mimari-protokol (admit/onay anında kaydın verilmesi); ADR-0004 eki (kendiliğinden yazılan kayıt); ADR-0006 eki (müşteri ref'i ve tek ad alanı); tehdit modeli (R19, R20).

## 10. Kontrol listesi kararları (E10)

| Madde                           | Karar                                                                                                                                                                                                                                   | Gerekçe            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1. Kimlik doğrulama             | Müşteri hesabı yok; talep bağlamı ref veya kayıt anahtarıyla kurulur                                                                                                                                                                    | Kapsam dışı 3      |
| 1. Yetki / IDOR                 | `customers.*` tek tanımdan; tenant izolasyonu her uçta (AC-165, AC-172)                                                                                                                                                                 | Ortak standart 1.3 |
| 1. Hesap silme (KVKK)           | Müşteri: pasif + anonimleştirme (AC-195); istemci: "Bu bilgisayarı unut" (AC-186)                                                                                                                                                       | Unutulma hakkı     |
| 1. API anahtarı / rotasyon      | Müşteri ref'i yenilenebilir (AC-170); kayıt tek tek geçersizleşir (V22)                                                                                                                                                                 | Sızma önlemi       |
| 5. 5 durum                      | Müşteriler listesi, detay sekmeleri, istemci ana ekranı                                                                                                                                                                                 | Kalite standardı   |
| 5. Form doğrulama               | Alan bazlı; zod; ad tekilliği 409 (AC-167)                                                                                                                                                                                              | —                  |
| 5. Yıkıcı işlem onayı           | Bağlantı yenileme, pasife alma, yeniden aktif etme onaylı; müşterinin "Bu bilgisayarı unut" işlemi anlık                                                                                                                                | Müşteri kontrolü   |
| 5. Arama / filtre               | Müşteriler arama + durum; Talepler ve geçmişte müşteri filtresi                                                                                                                                                                         | Kullanıcı isteği C |
| 5. Bildirim                     | Değişiklik yok; toast'ta müşteri adı                                                                                                                                                                                                    | AC-176             |
| 5. Erişilebilirlik / responsive | axe 0, klavye, 390 px (AC-194)                                                                                                                                                                                                          | —                  |
| 8. KVKK                         | Yetkili kişi verisi saklama/anonimleştirme; kayıt aydınlatmada                                                                                                                                                                          | AC-188, AC-195     |
| 9. Kapsam dışı                  | 10 madde (bölüm 3)                                                                                                                                                                                                                      | —                  |
| 9. Ölçülebilir AC               | AC-165..AC-195 (31 AC)                                                                                                                                                                                                                  | —                  |
| 9. Dokümantasyon                | Kılavuza "Müşteriler" bölümü, "Destek iste / Bağlantı kodum var / Bu bilgisayarı unut" anlatımı; DATASHEET'e müşteri firma özelliği; CHANGELOG 0.10.0                                                                                   | Ortak standart 1.7 |
| Sonra                           | Pencere bazlı paylaşım, çoklu firma kaydı (S19), müşteri portalı, müşteri başına SLA/fatura, müşteriye bağlantıyı WhatsApp/e-posta ile sistemden gönderme, CSV içe aktarma, müşteri başına logo/aydınlatma (S21), linkle bağlanma alanı | Unutulmasın diye   |
