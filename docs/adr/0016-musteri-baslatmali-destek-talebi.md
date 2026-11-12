# ADR-0016 — Müşteri başlatmalı destek talebi (model A): tenantRef, bekleme WS'i, ön-kabullü oturum
Durum: Kabul, **r2 2026-11-12** (güvenlik tasarım turu E9, G-E9-1..14 — aşağıda "Revizyon r2"; kullanıcı kararı model A; S12–S17 varsayılanlarla, S13 r2de değişti) · Tarih: 2026-11-12 · İlgili: ADR-0004 r3, ADR-0005, ADR-0006 r4, ADR-0010, ADR-0012, ADR-0014 · Ayrıntı: `docs/mimari-e9.md`

## Bağlam
E9: müşteri, firmasına özel dosyadan talep açar; teknisyen kabul edince link/kod olmadan bağlanılır (AC-129..164). Kısıtlar: ikili jenerik kalmalı (tekrarlanabilir build, ADR-0010); istemci kurulumsuz ve iz bırakmaz (tek istisna ADR-0004 r3); tek instance, bellek içi durum (ADR-0005); kontrol izni istemcide (ADR-0009); public uçlarda Origin kuralı (ADR-0012).

## Karar
1. **tenantRef:** tenant başına 16 karakter base32 (`[a-z2-7]`, 80 bit), düz ve UQ saklanır (gizli değil, tahmin edilemez); dosya adında taşınır (`NoktaDestek-<file_label>-<ref>.exe`, ADR-0006 r4); Admin yeniler (eski ref anında 404). Ayar satırı tembel oluşturulur.
2. **Müşteri bekleme kanalı = yeni WS `/ws/request`**; kimlik `rs.req.<talep sırrı>` subprotocol'de (G-10 kalıbı), yalnız Origin'siz AGENT. Kapanış 1000 = iptal; diğer kopma 120 sn tolerans. Sıra/durum ve kabul bu kanaldan itilir.
3. **Kabul = atomik TX + ön-kabullü misafir:** talep `PENDING→ACCEPTED` koşullu UPDATE + `support_sessions` INSERT (`request_id`, kodsuz, 60 sn) tek TX; commit sonrası sunucu talebin onay kaydıyla bir `Guest(requestId)` ve tek kullanımlık `wsTicket` üretir, yalnız sır sahibinin soketine iter. İstemcinin `/ws/guest` bağlantısında **lobi ve admitCode atlanır** (V16); tüketim mevcut §3.2 UPDATE'ine `AND request_id` eklenerek yapılır. Teknisyen doğrulama kodu ve kontrol izni akışı değişmez.
4. **Panel anlık bildirim = yeni WS `/ws/panel`** (çerez + Origin + 60 sn yeniden doğrulama, tek yönlü). WhatsApp: sistem düzeyi `WHATSAPP_SERVICE_URL`, tenant alıcı/anahtar; süreç içi 3 deneme. E-posta: şema şimdi, gönderim P10.
5. **Kuyruk = DB tablosu** (`support_requests`), sınırlar DB sayımı + `tenant_request_settings FOR UPDATE` serileştirmesi + `rate.ts` kovaları; kuyruk sistemi/Redis yok.

## Alternatifler
- **Uzun yoklama / kısa yoklama (müşteri):** iptal ve kopma tespiti için ek durum/HTTP trafiği; WS altyapısı ve Go WS istemcisi zaten var. Reddedildi.
- **Mevcut `/ws/guest` lobisini talep için kullanmak:** lobi oturuma bağlıdır; talep anında oturum yoktur (teknisyen belli değil). Her talepte "sahipsiz oturum" açmak açık oturum sınırlarını ve P2 CHECK'lerini bozar. Reddedildi.
- **SSE (panel):** ikinci kimlik yolu + proxy tamponlama ayarı. Reddedildi.
- **tenantRef'i ikiliye gömmek / imzalı token:** tekrarlanabilir build'i bozar (ADR-0010). Reddedildi. **HMAC'li ref (tenantId + anahtar):** yenileme için yine durum gerekir; düz rastgele ref daha basit.
- **Talepte de 4 haneli kabul kodu:** S12 varsayılanı "hayır"; genişleme noktası `Guest.requestId` yolunda admitCode üretimi (tenant ayarı).
- **`support_sessions.source` sütunu:** `request_id` boş/dolu aynı bilgiyi verir. Reddedildi.

## Sonuçlar
- Yeni bağımlılık yok. Yeni uçlar: 4 public REST, 9 panel REST, 2 WS yolu; 5 hata kodu; 2 yetki anahtarı.
- `support_sessions` P2 CHECK'leri (kod ve TTL) `request_id`'ye göre ikiye ayrılır (dba).
- Kalan riskler: sızan dosya ile spam talep (sınırlar + ref yenileme), tenant kovasının 15 dk kapanması, WhatsApp'a PII'nin düz HTTP ile gitmesi (prod ön koşulu K13), sunucu yeniden başlarken WhatsApp denemelerinin kaybı, talep doğrulamasının teknisyenin telefonuna kalması (V16).
- Çok instance gerekirse `requests/hub.ts` RoomBus ile aynı yerden genişler (ADR-0005).

## Revizyon r2 (2026-11-12 — güvenlik tasarım turu E9; ayrıntı `docs/mimari-e9.md` §13)
**Bağlam:** Güvenlik raporu (Yüksek 1, Orta 6, Düşük 7) şunları buldu: lobinin kaldırılmasıyla talep, makine ve kişi arasında doğrulanabilir bir bağ kalmamıştı (G-E9-1). Ayrıca paylaşım müşteri etkileşimi olmadan başlıyordu (G-E9-3), WhatsApp kanalı kişisel veri ve oltalama taşıyordu (G-E9-5/6) ve tenant kovası kapatmaya açıktı (G-E9-7).
**Karar (Karar 3 ve 4 değişir, diğerleri aynı kalır):**
1. **Gösterim kodu + bilinen kaynak (kapı değil):** her talebe 6 haneli `requestCode` verilir. Kod istemcide, panelde ve WhatsApp'ta görünür. Teknisyen müşteriyi **firmanın kayıtlı numarasından** arar ve kodu sorar. Panelde "bilinen kaynak" bayrağı gösterilir: ağ öneki (IPv4 /24, IPv6 /48) son 90 günde oturuma girmiş ya da güvenilen CIDR'de mi, cihaz anahtarı (yalnız hatırlama açıkken) daha önce oturuma bağlanmış mı. S12 (kabul kodu zorunluluğu) Sonra listesinin başına alındı.
2. **Karar 3 değişikliği:** kabulden sonra istemci **her seferinde** tek tık "Ekranımı paylaş / Vazgeç" onayı ister. Otomatik onay ve geri sayım yok; P7 diyalog kuralları geçerli. Vazgeç ve iptal-sonrası-kabul tek decline yoluna bağlanır (ACCEPTED → CANCELLED). Onay kaydı bağlantı anının IP/UA'sı ve `request_id` ile yazılır. Caps admit anında DB'deki yetkilerden hesaplanır; teknisyen yoksa 120 sn zamanlayıcı çalışır.
3. **Karar 4 değişikliği:** WhatsApp mesajında kişisel veri ve müşteri serbest metni yoktur (firma + talep kodu + sabit panel bağlantısı). Gönderim sınırları: tenant 30/sa, alıcı 10/sa, global 300/sa, aşımda saatlik özet. Prod'da güvensiz adres verilirse kanal kapalı kalır (fail-closed). `/ws/panel` çıkış ve yetki kaybında servis çağrısıyla anında kapanır.
4. **Asgari istemci sürümü:** `MIN_AGENT_VERSION` → 426 `CLIENT_OUTDATED`; istemci yeni sürümün indirme bağlantısını açar.
5. **Sınırlar:** IPv6 /48 kovası eklendi. Ağ öneki başına en çok 10 bekleyen talep olur. Tenant kuyruğu 40'a dolunca yalnız bilinen kaynaklardan talep alınır. Tenant kovası aşılınca tenant kilitlenmez, yalnız bilinmeyen kaynaklar reddedilir. Admin isteğe bağlı güvenilen CIDR listesi tanımlayabilir.
**Alternatifler:** (a) Talepte zorunlu kabul kodu: S12 kararıyla çelişir, Sonra'ya alındı. (b) Onayı yalnız 2 dk'dan uzun beklemelerde istemek: iki yol oluşur ve kısa beklemede de müşteri masada olmayabilir. Reddedildi. (c) WhatsApp'ta tenant tercihine bağlı kişisel veri şablonu: yurt dışı aktarım için aydınlatma ve rıza yükü getirir. Koordinatör kararıyla reddedildi.
**Sonuçlar:** Müşteri akışına bir tıklama eklenir. AC-133, 134, 136, 139, 143, 144, 146, 150, 152, 154 ve 157'nin metni değişti; AC sayısı aynı kaldı. Veri modeline 9 sütun ve 3 indeks eklenir (mimari-e9 §13.8). Kalan riskler: bilinen önekten gelen spam, istemcinin beyan ettiği sürüm ve cihaz anahtarı, kurumsal NAT'ta paylaşılan önek. Bayrak doğrulama değil, yalnız bilgi amaçlıdır.

## Not r3 (2026-11-12, E10)
Talep artık müşteri ref'i veya bilgisayar kaydıyla da açılabilir ve `customer_id`/`binding_id` taşır. Yeni iptal nedeni `CUSTOMER_PASSIVE` eklendi (0.9.x'e `TENANT_PASSIVE` olarak iletilir). Kabul akışı, onay ve sınırlar değişmez. Ayrıntı `docs/mimari-e10.md`, ADR-0017.
