# ADR-0034 — Oturum kaydını teknisyen konsolu (tarayıcı MediaRecorder) alır; tek yol

Tarih: 2026-11-16 · Durum: Kabul (mimar; güvenlik tasarım turu P28e-K0'da incelenir) · Paket: P28e · İlgili: V48, AC-380..388, AC-447..450, ADR-0032, ADR-0033

## Bağlam

P28e oturumun görüntü kaydını ister: katılımlı oturumda müşteri rızasıyla, gözetimsiz oturumda tenant politikasıyla. Görüntü üç farklı kaynaktan
gelir: Go yerel istemci (Media Foundation H.264), tarayıcı misafir (`getDisplayMedia`) ve gözetimsiz servis/yardımcı (P27/P28u). Hepsinde
görüntünün **tek ortak alıcısı** teknisyen konsoludur (WebRTC, uçtan uca; sunucu medyayı görmez). V48 kaydın teknisyen tarafında alınmasını,
medyanın sunucudan geçmemesini önerir. Sadelik ilkesi tek yol ister.

## Karar

1. Kayıt, odadaki **kaydedici teknisyenin** konsolunda alınır: gelen video izinden yalnız video içeren yeni bir `MediaStream`
   (`new MediaStream([videoTrack])`) kurulur, `MediaRecorder` ile `video/webm;codecs=vp8` olarak kodlanır, 5 sn'lik parçalar halinde HTTPS
   ile sunucuya yüklenir. Sunucu her parçayı P28b `box.ts` biçiminde (AES-256-GCM, parça başına HKDF anahtarı) saklar.
2. Kaynak hangisi olursa olsun (yerel istemci, tarayıcı, gözetimsiz) kod yolu **aynıdır**. Kaynak tarafa yalnız rıza kutusu, gösterge ve
   (katılımlıda) "Kaydı durdur" eklenir.
3. Otorite sunucudur: kaydın açık olup olmadığı, hangi parçanın kabul edileceği, göstergenin durumu ve kota sunucu oda durumundan türer.
   Konsol yalnız kodlayıcı ve yükleyicidir.
4. Kaydedici bugün oturumun tek teknisyenidir. P28c'de tek bir fonksiyon (`recorderOf(room)`) "oturum sahibi"ni döndürür. Bu yalnız genişleme
   noktası olarak tanımlanır, P28e'de çok teknisyen kodu yazılmaz.

## Alternatifler

| Alternatif                                                                  | Neden seçilmedi                                                                                                                                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kaynak tarafta kayıt (Go istemci + servis + tarayıcı misafir ayrı ayrı)     | Üç uygulama (Go'da WebM muxer + H.264→kayıt, tarayıcıda MediaRecorder). Müşteri yükleme hattını ikinci kez kullanır. Tarayıcı misafiri kaydı keserse yine "hata" olur. Sadelik ilkesine aykırı (üç yol) |
| Observe tarzı servis tarafı sürekli kayıt (JPEG kareler / video, Session 0) | Yalnız gözetimsiz cihazda çalışır, katılımlı yol için ikinci bir yol gerekir. S-P28u-3: kayıt yalnız bağlantı süresince yapılır. V48'e aykırı                                                           |
| Sunucuda SFU/medya sonlandırma ve kayıt                                     | Uçtan uca ilkesini bozar (mimari-p28 §0 m.1), sunucuya kodlama yükü ve yeni bağımlılık (GStreamer/ffmpeg, lisans) getirir                                                                               |
| Konsolda kayıt + sunucuda ffmpeg ile MP4/Cues remux                         | ffmpeg ikilisi ve lisans/saldırı yüzeyi gerektirir. MSE + parça dizini, remux olmadan seek sağlar (K-P28e-5)                                                                                            |

Üç kriter (yeni teknoloji): MediaRecorder ve MSE tarayıcıya gömülüdür, yeni bağımlılık eklenmez. Bakımı tarayıcı üreticisindedir. Geri dönüş
için tenant ayarı kapatılır, kod yolu kapanır.

## Sonuçlar

- (+) Tek kod yolu. Yerel istemci, tarayıcı ve gözetimsiz kaynak aynı biçimde kaydedilir. Ses izi yapısal olarak yoktur (AC-375): akış yalnız video izinden kurulur, sunucu da WebM başlığında ses izi görürse parçayı reddeder.
- (+) Medya sunucudan geçmez. Sunucu yalnız teknisyenin yeniden kodladığı kaydı saklar (V48).
- (−) Kaydedici teknisyen kontrolündedir. Sekmeyi kapatarak veya ağı keserek kayıtta boşluk oluşturabilir. Sunucu bu durumu görünür kılar:
  parça gözcüsü, `recording.stop{reason:"error"}` ve oynatıcıda boşluk gösterimi (K-P28e-8). Kötü niyetli teknisyene karşı
  tam koruma kapsam dışıdır (R-PE1).
- (−) Teknisyen hattından sürekli yaklaşık 1,5 Mbit/s yükleme gider (R-PE2). Konsol tarayıcısında VP8 kodlama CPU'su kullanılır (K0s ölçer).
- (−) Safari'de MediaRecorder ve MSE WebM desteği sınırlıdır. Desteklenmeyen tarayıcıda kayıt başlamaz ve neden görünür olur (K-P28e-9).
