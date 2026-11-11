# ADR-0006 — İstemci–oturum eşleme: dosya adındaki 8 haneli kod + lobi ve teknisyen kabulü
Durum: Kabul, r3 (r2: güvenlik raporu Tur 0: G-01, G-02, G-22; K6 kapandı · r3 2026-11-11: indirme 302 hedefi, QA-P6-5) · Tarih: 2026-11-10
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
