# ADR-0006 — İstemci–oturum eşleme: dosya adındaki 8 haneli kod + lobi ve teknisyen kabulü
Durum: Kabul, r4 (r2: güvenlik raporu Tur 0: G-01, G-02, G-22; K6 kapandı · r3 2026-11-11: indirme 302 hedefi, QA-P6-5 · **r4 2026-11-12: firma dosyası adı ve tenantRef — aşağıda "Revizyon r4"**) · Tarih: 2026-11-10
## Bağlam
Binary jeneriktir ve tekrarlanabilir build hash'i (ADR-0010) bozulmamalıdır; oturum verisi gömülmez. Müşteri dosyayı yeniden adlandırabilir; tarayıcı `(1)` ekleyebilir.
r1'de iki zayıflık bulundu (G-01, G-02): `verifyCode` resolve yanıtında herkese dönüyordu, yani kodu tahmin eden saldırgan da aynı 4 haneyi görüyor ve müşteriyi doğrulamıyordu; join oturumu tüketiyordu, bu yüzden saldırgan gerçek müşteriyi kilitliyordu; global başarısız-kod limiti de tek saldırgana tüm tenant'ları kapatma imkânı veriyordu.
## Karar
- Tek jenerik `NoktaDestek.exe`. İndirme ucu (`GET /public/agent/download?ref=`) **302 → `/downloads/Destek-<8 hane>.exe`** döner (r3, QA-P6-5: tarayıcı 3xx yanıtındaki `Content-Disposition`'ı yok sayar, ad son yanıttan gelir); Caddy aynı ikiliyi `NoktaDestek.exe` ve `Destek-<8 hane>.exe` adlarıyla, son yanıtta `Content-Disposition: attachment; filename="<ad>.exe"` ile sunar. Statik yol kod doğrulamaz (her 8 hane aynı ikili), kodun geçerliliği yalnız indirme ucunda (PENDING + süre + hız kovaları) denetlenir; ikili kapısı kapalıysa (hash uyuşmazlığı/yapılandırma yok/dosya yok) hem uç hem `/downloads/*` 503 (sözleşme: `docs/mimari-api.md` public tablosu). İstemci `filepath.Base(os.Executable())` üzerinde `(?:^|\D)(\d{8})(?:\D|$)` arar; bulamazsa 8 haneli kod giriş alanı (AC-97). Ekranda `4829 1376` biçiminde gösterilir.
- Kod: `crypto.randomInt(0, 10⁸)`, tek sütun `active_code`, **yalnız PENDING iken dolu** ve global tekil (UQ; çakışmada yeniden üretilir, 5 deneme). Ayrı `short_code` sütunu yok (G-22).
- **Limitler (G-02):** başarısız kod çözümlemesi `ipKey` (IPv4 /32, IPv6 /64) için 10/dk, `prefixKey` (IPv4 /24, IPv6 /56) için 30/dk; aşımda **yalnız o anahtar** 15 dk 429 alır. Global sayaç engellemez, yalnız alarm üretir (> 100/dk). Token yolu: 30/dk/ipKey.
- **Lobi + kabul (G-01, K6):**
  1. `join` oturumu **tüketmez**; `wsTicket` + misafire özel 4 haneli `admitCode` döner (yalnız o misafire; bellekte SHA-256).
  2. Misafir WS'e bağlanır → `lobby.wait`; teknisyene `peer.pending{guestId, name, guestKind}`.
  3. Teknisyen müşteriden telefonda kodu okumasını ister ve **kodu konsola girer** → `guest.admit{admitCode}`. Sunucu lobi misafirlerinin hash'leriyle sabit zamanlı karşılaştırır.
  4. Eşleşme olunca tek TX içinde `consumed_at`, `ACTIVE`, `active_code=NULL`, consent ve audit yazılır; ardından misafire `hello` (TURN credential, reconnectToken, caps) gider. Diğer lobi misafirleri `session.ended{rejected}` alır.
  5. Kabul gelmeden SDP/ICE iletilmez ve TURN credential verilmez.
  6. `guest.reject` ya da 5 dk bekleme → `session.ended{rejected|lobby_timeout}`; kod geçerli kalır; reddedilen ipKey o oturuma tekrar giremez.
  7. Sınırlar: lobide ≤ 3 misafir; oturum başına 5 hatalı admitCode girişinde lobi boşaltılır; 3 ret sonrasında konsol "iptal et, yenisini aç" önerir.
- `tech_verify_code` (4 hane, eski `verifyCode`) yalnız **müşterinin teknisyeni teyidi** içindir ve müşteriyi doğrulamaz.
- Token (43 karakter base64url) link içindir, kod alternatif giriş yoludur; ikisi de aynı lobi/tüketim kuralına bağlıdır. Plain token yalnız oluşturma yanıtında verilir; kaybolursa iptal edilip yeni oturum açılır.
## Alternatifler
- Teknisyenin kodu yalnız gözle karşılaştırması: tek tık onaya kayar. Kod girişi, kodu sorgulamayı zorunlu kılar ve ek kod getirmez.
- Lobi yerine yalnız 8 hane: oturum ele geçirilirse etki aynı kalır.
- Alfanumerik kod: telefonda okunması zor.
- Üstel ceza: sabit 15 dk blok aynı caydırıcılığı daha az durumla sağlar.
- Kodu binary'ye gömmek: tekrarlanabilir build'i bozar.
## Sonuçlar
- Kod tahmininin etkisi artık "lobiye girmek" ile sınırlı: saldırgan müşterinin telefonda okuyacağı kodu bilemez, bu yüzden kabul edilemez ve gerçek müşteriyi kilitleyemez. Kalan risk lobi spam'i (≤ 3 misafir, ret listesi, iptal önerisi).
- Olasılık (8 hane): P adet /24'ten 30 dk'da 900·P·N/10⁸ lobi girişi (P=10, N=50 → %0,45); başarı yine kabul adımına takılır.
- Müşteri akışına bir telefon adımı ekleniyor (zaten telefondalar). UI maliyeti P4 (konsol lobi paneli + bekleme ekranı) ve P6'da (istemci bekleme ekranı).
- Sunucu yeniden başlarsa lobi düşer; PENDING oturum korunur, misafir yeniden katılır.

## Revizyon r4 (2026-11-12, E9 — AC-129..133, 162; V14; ADR-0016)
**Bağlam:** Müşteri başlatmalı talep için istemcinin hangi tenant'a talep açacağını bilmesi gerekir; ikili yine jenerik kalmalıdır (AC-130).
**Karar:**
- İkinci dosya adı biçimi: `NoktaDestek-<file_label>-<tenantRef>.exe`. `file_label` = firma adının ASCII'ye indirgenmiş, `[A-Za-z0-9]{1,20}` hali (boşsa `Firma`); `tenantRef` = `[a-z2-7]{16}` (80 bit). İkili aynıdır, SHA-256 değişmez.
- İndirme: `GET /public/agent/request-download?ref=<ref>` → 302 `/downloads/NoktaDestek-<label>-<ref>.exe`; Caddy `@agentExe` matcher'ı bu biçimi de aynı volume ikilisine bağlar (r3 kalıbı; `forward_auth` ikili kapısı aynen). Statik yol ref doğrulamaz; ref'in geçerliliği yalnız uçta ve talep oluşturmada denetlenir. Log filtresi yolu `/downloads/NoktaDestek-***` yapar.
- İstemcinin ayrıştırma sırası (`internal/pairing`): `name = filepath.Base(os.Executable())`; (1) `(?i)^NoktaDestek-[A-Za-z0-9]{1,20}-([a-z2-7]{16})(?: ?\(\d+\))?\.exe$` eşleşirse **talep modu** (ref küçük harfe indirilir; tarayıcının eklediği ` (1)` kabul); (2) değilse mevcut 8 hane kuralı `(?:^|\D)(\d{8})(?:\D|$)` → oturum kodu modu; (3) hiçbiri → kod giriş alanı. Talep modunda da "Teknisyenden kod aldım" ile 8 hane girilebilir (AC-162). Ad değiştirilmişse talep modu açılmaz; mesaj "Destek iste için firmanızın dosyasını yeniden indirin" (V14).
- Ref yenilenince eski dosya `REQUEST_REF_INVALID` alır: "Bu dosya artık geçerli değil; firmanızdan yenisini isteyin" (AC-131); pasif tenant aynı yanıtı alır (AC-132/145).
**Alternatifler:** Ref'i ikiliye gömmek (ADR-0010'u bozar); ref'i ADS/yan dosyada taşımak (tarayıcı indirmesinde korunmaz, iz bırakır); yalnız ref (firma adı yok) — S16 varsayılanı firma adını ister.
**Sonuçlar:** Dosya adı müşteri–destek firması ilişkisini görünür kılar (S16 kabulü). Ref gizli değildir; sızarsa etkisi "talep açabilmek"tir (R11, ADR-0016 sınırları). 8 haneli kod yolu ve lobi kuralları değişmez.
**r4 eki (2026-11-12, güvenlik tasarım turu E9 — G-E9-11, G-E9-8):**
- Statik firma yolu artık doğrulanır. `forward_auth` iç ucu `/internal/agent-ready`, `X-Forwarded-Uri` içindeki `NoktaDestek-<label>-<ref>.exe` değerini ayrıştırır. Ref aktif ve label güncel `file_label` ise 204, değilse 404 döner (ikili kapısı ayrıca 503). Böylece resmi alan adında keyfi adlı bağlantı üretilemez.
- İstemci firma penceresinde dosya adındaki label'ı göstermez, yalnız sunucudan gelen firma adını gösterir. Pencerede P6 karşılamasındaki gibi bağlanılan sunucu, sürüm ve SHA-256 ilk 8 hane satırı bulunur.
- Firma dosyası yolu yalnız Caddy filtresinde değil, host nginx erişim logunda da `/downloads/NoktaDestek-***` olarak maskelenir.

## Revizyon r5 (2026-11-12, E10 — AC-168, 170, 171, 182, 183, 190, 191; V27; ADR-0017; `docs/mimari-e10.md` §3.2, §8.1)
**Bağlam:** Tenant müşteri firmalarına ayrı kalıcı dosya vermek istiyor. 0.9.x istemci bu dosyayla çalışmalı. Ayrıca bilgisayar kaydı üçüncü bir eşleme girdisi olur.
**Karar:**
- **Müşteri ref'i** Genel (tenant) ref'iyle aynı biçimdedir (`[a-z2-7]{16}`, 80 bit). Dosya adı da aynıdır: `NoktaDestek-<müşteri file_label>-<ref>.exe`. İstemcinin ayrıştırıcısı değişmez. 0.9.x müşteri dosyasıyla talep açar ve sunucu ref'i müşteriye çözer.
- **Tek ad alanı:** her ref, sahibine yazılmadan önce aynı TX'te append-only `request_refs` tablosuna (PK `ref`) eklenir. Böylece Genel ve müşteri ref'leri DB kısıtıyla tekildir ve emekli bir ref asla yeniden verilmez (eski dosya başka sahibe geçemez). Geri doldurma mevcut tenant ref'lerini kapsar.
- **Çözümleme:** tenant ve müşteri sorguları paralel çalışır. Geçersiz, yenilenmiş, pasif müşteri ve pasif tenant aynı 404'ü alır. Yanıt ref'in Genel'e mi müşteriye mi ait olduğunu göstermez.
- **Yenileme / pasif:** müşteri ref'i yenilenebilir. Pasif müşterinin ref'i 404 döner. Yeniden aktif etmede yeni ref üretilir (V23).
- **İstemci mod önceliği (0.10.0, `internal/launch`):** (1) adında geçerli PENDING kod → kod akışı; (2) adında ref → talep o ref'e; (3) aksi halde bilgisayar kaydı. Süresi geçmiş kod veya geçersiz ref + geçerli kayıt → kayıt ana ekranı. Hiçbiri yoksa ana ekranda "Destek iste" pasif, "Bağlantı kodum var" etkin olur. Mevcut "Teknisyenden kod aldım" metni "Bağlantı kodum var" olur.
**Alternatifler:** Müşteri ref'ini farklı biçimde/önekte vermek: 0.9.x uyumu bozulur ve dosya türü dosya adından anlaşılır (AC-168). Reddedildi. Tekilliği yalnız uygulama koduyla sağlamak: yarışta çakışma olur, AC-168 DB kısıtı ister. Reddedildi. `request_refs`'i tek çözümleme kaynağı yapmak: sahibin sütunuyla iki kopya senkron tutulmalı. Reddedildi; tablo yalnız tekillik ve iz içindir.
**Sonuçlar:** `MIN_AGENT_VERSION` değişmez. 8 hane ve lobi kuralları değişmez. `request_refs` büyür (her yenilemede bir satır; ihmal edilebilir).
