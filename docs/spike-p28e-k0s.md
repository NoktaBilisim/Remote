# P28e K0s — tarayıcı kayıt spike'ı (sonuç ve karar önerisi)

**Karar önerisi: bölüm süresi 5 dk** (mimar onayı gerekir). Eşik 200 ms; Google Chrome 157'de 16 bölüm geçişinin 4'ünde boşluk
1,1–1,5 sn çıktı. Bu 4 olayın 3'ü kayıt sayfasının önünde ikinci bir sekme açıkken görüldü (4 geçişte 3). Ön planda yalnız 1 olay
var: 60 sn bölümlü 4 geçişte 1, 10 sn bölümlü 5 geçişte 0. O tek olay da kodlama hattının yavaşladığı bir dönemde oldu (bkz. §4.1).
Ön plan kanıtı tek olaya dayanıyor, ancak kural gereği kapıyı aşıyor. Teknisyen konsolu kayıt sırasında arka planda kalabileceği
için öneri 5 dk. Playwright Chromium 158'de 12 geçişin hiçbiri eşiği aşmadı (en çok 65 ms).

Tarih: 2026-11-16 · Branch: `p28e` · Kaynak: `docs/mimari-p28e.md` §7, §14 K0s, R-PE2/R-PE3 · Sahip: frontend-dev · Makine: Apple M4 Pro
(14 çekirdek), macOS 26.3 · Üretim koduna dokunulmadı, yeni bağımlılık yok.

## 1. Düzenek

| Dosya                         | İçerik                                                                                                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/spike-p28e/spike.html`  | Sentetik kaynak, kaydedici ve MSE oynatıcı ölçümleri (`window.K0s`)                                                                                                                       |
| `docs/spike-p28e/k0s.mjs`     | Playwright sürücüsü. Sayfayı geçici bir 127.0.0.1 sunucusundan açar. `--browser=chromium\|chrome\|firefox\|msedge`, `--smoke`, `--headed`, `--only=main\|short\|rate\|resize\|background` |
| `docs/spike-p28e/ozet.mjs`    | Ham JSON'dan özet üretir. Ham JSON blob içermez; scratchpad'de kaldı, repoya girmez                                                                                                       |
| `docs/spike-p28e/ozet-*.json` | Tarayıcı başına özet (`deviceId` çıkarıldı)                                                                                                                                               |

- **Kaynak:** `canvas.captureStream(30)` ile 1920×1080 (ayrıca 1280×720) çizim, 30 fps. Kare içeriği:
  - 400 satırlık metin, her karede 4 px kayar
  - hareket eden mavi kutu
  - sol üstte 24 bitlik zaman damgası şeridi: 32 px siyah/beyaz bloklar, çizim anını ms olarak taşır
- **Çizim tetiği:** Worker `setInterval`. Gizli sayfada rAF durduğu için kullanılmadı.
- **Kaydedici (§7 biçimi):**
  - `MediaRecorder(new MediaStream([track]), {mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 1_500_000})`, `start(5000)`
  - Bölüm sonunda `stop()`. Yeni MediaRecorder aynı görev içinde `start()` edilir (`sync`). Ek deneme olarak yeni kaydedici `onstop` olayında başlatıldı (`onstop`).
- **Bölüm boşluğu çözülmüş karelerden ölçüldü.** Her bölüm ayrı bir MSE'ye eklendi, ardından `endOfStream` çağrıldı. İlk ve son kareye seek edilip şerit okundu.
  - `frameGap` = ilkKare(N+1) − sonKare(N) − 33,3 ms
  - `endToStart` = ilkKare(N+1) − (ilkKare(N) + `buffered.end`(N))
  - İki ölçünün de 0'a yakın çıkması kesintisiz geçiş demektir.
- **Koşular:**
  - CPU: 20 sn taban (yalnız çizim) + 20 sn kayıt
  - Ana koşu: 1080p kaydırma, 3 × 60 sn
  - Kısa bölümler: 6 × 10 sn `sync` ve 4 × 10 sn `onstop`
  - Bit hızı: 1080p durağan 30 sn, 720p kaydırma 30 sn
  - Çözünürlük değişimi: 24 sn
  - Arka plan: 3 × 10 sn
- **Arka plan bayrakları:** Playwright'ın arka plan kısıtlamasını kapatan varsayılan bayrakları (`--disable-background-timer-throttling`, `--disable-renderer-backgrounding`, `--disable-backgrounding-occluded-windows`) `ignoreDefaultArgs` ile çıkarıldı.

Yeniden koşmak için `node docs/spike-p28e/k0s.mjs --browser=chrome` (yaklaşık 8 dk), ardından `node docs/spike-p28e/ozet.mjs <json>`.

## 2. Tarayıcılar

| Tarayıcı                                                                             | Durum                                                                                        |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Playwright Chromium 158.0.8127.18 (headless shell)                                   | Ölçüldü                                                                                      |
| Google Chrome 157.0.8103.52 (`channel: "chrome"`, headless; arka plan ayrıca headed) | Ölçüldü                                                                                      |
| Microsoft Edge (`msedge`)                                                            | **Ölçülemedi**: bu makinede kurulu değil. Chrome ile aynı motor olsa da onun yerine sayılmaz |
| Firefox                                                                              | **Ölçülemedi**: Playwright Firefox kurulu değil, indirme yapılmadı                           |
| Safari                                                                               | Kapsam dışı (§14: yalnız gözlem)                                                             |

## 3. Ölçüm tablosu

| #   | Ölçüm                                                           | Chromium 158 (headless shell)                                                                                                                                                       | Chrome 157                                                                                                                                                      |
| --- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `frameGap`, 60 sn `sync`, ön plan (koşu 1 / tekrar koşusu)      | 9 / −1 ms                                                                                                                                                                           | **1288** / −2 ms · tekrar: −2 / 0 ms                                                                                                                            |
| 1   | `frameGap`, 10 sn `sync`, ön plan (n=5)                         | medyan 25, en çok 42 ms                                                                                                                                                             | medyan 33, en çok 36 ms                                                                                                                                         |
| 1   | `frameGap`, 10 sn `onstop`, ön plan (n=3)                       | medyan 30, en çok 33 ms                                                                                                                                                             | medyan 1, en çok 38 ms                                                                                                                                          |
| 1   | `frameGap`, 10 sn `sync`, ikinci sekme önde (headless / headed) | 1 / 1 ms                                                                                                                                                                            | **1154 / 1486** · headed **1250** / 30 ms                                                                                                                       |
| 1   | Kırılım (> 200 ms olan geçiş / tüm geçişler)                    | 60 sn sync 0/2 · 10 sn sync 0/5 · onstop 0/3 · ikinci sekme 0/2 → **0/12**, en çok 65 ms (`endToStart`)                                                                             | 60 sn sync **1/4** · 10 sn sync 0/5 · onstop 0/3 · ikinci sekme **3/4** → **4/16**, boşluklar 1,15–1,49 sn; diğer 12 geçiş ≤ 58 ms (`endToStart`)               |
| 1   | Boşluğun yeri                                                   | —                                                                                                                                                                                   | Eski bölümün **sonu** eksik: `buffered.end` 58,83 / 60 sn ve 8,6–8,9 / 10 sn. Yeni bölüm zamanında başlıyor (ilk kare `start()` çağrısına göre −33..+1 ms)      |
| 1   | `stop()` → yeni `onstart`                                       | 17–31 ms                                                                                                                                                                            | 22–28 ms; boşluklu geçişlerde 68–542 ms                                                                                                                         |
| 2   | Bit hızı, 1080p kaydırma (180 sn)                               | 1,20 Mbit/s → **0,54 GB/sa** (0,50 GiB/sa)                                                                                                                                          | Koşu 1: 0,89 Mbit/s → 0,40 GB/sa. Yavaş dönemde parçalar 180–380 KiB'ye düştü; değer düşük, kare kaybı olabilir. Tekrar koşusu: **1,31 Mbit/s → 0,59 GB/sa**    |
| 2   | Bit hızı, 1080p durağan (30 sn)                                 | 1,14 Mbit/s → 0,51 GB/sa                                                                                                                                                            | 1,07 Mbit/s → 0,48 GB/sa                                                                                                                                        |
| 2   | Bit hızı, 720p kaydırma (30 sn)                                 | 1,17 Mbit/s → 0,53 GB/sa                                                                                                                                                            | 1,10 Mbit/s → 0,49 GB/sa                                                                                                                                        |
| 2   | Bütün koşuların en yükseği                                      | 1,32 Mbit/s → 0,59 GB/sa                                                                                                                                                            | 1,31 Mbit/s → 0,59 GB/sa                                                                                                                                        |
| 3   | Parça boyutu (en çok / medyan)                                  | 1144 / 720–784 KiB; > 2 MiB: 0                                                                                                                                                      | 1177 / 543–832 KiB; > 2 MiB: 0                                                                                                                                  |
| 3   | Bölümün ilk parçası (başlık + anahtar kare)                     | 754–1144 KiB                                                                                                                                                                        | 231–1177 KiB (en büyük parça her zaman ilk parça değil)                                                                                                         |
| 3   | `dataavailable` aralığı                                         | medyan 5020 ms (4688–5065)                                                                                                                                                          | medyan 5017 ms (4253–5193)                                                                                                                                      |
| 4   | Bölüm içinde 1080p → 720p → 1440p                               | `onerror` yok, durum `recording`, kayıt kesilmeden sürdü. Tek WebM'de 3 çözünürlük; MSE seek doğru boyutu verdi (1920/1280/2560); oynatma sınırları geçti (`resize` 5, `waiting` 2) | Aynı (`resize` 6, `waiting` 2)                                                                                                                                  |
| 4   | `track.getSettings()` değişimden hemen sonra                    | Eski boyutu döndürüyor (gecikmeli)                                                                                                                                                  | Aynı                                                                                                                                                            |
| 5   | Arka plan / gizli sekme                                         | **Ölçülemedi**: ikinci sekme öne alındığında `visibilityState` `visible` kaldı                                                                                                      | **Ölçülemedi**: headed Chrome'da da `visible` kaldı (Playwright sayfaları görünür tutuyor). Çizim 30/sn, parça aralığı ≈ 5 sn, 10 sn zamanlayıcı kayması ≤ 6 ms |
| 6   | CPU (tarayıcı süreç ağacı `ps` farkı, kayıt − taban)            | **+37 % tek çekirdek** (taban %22)                                                                                                                                                  | Koşu 1: **+255 % tek çekirdek** (taban %19), yavaş dönemle aynı zamanda. Tekrar koşusu: **+48 %** (taban %18)                                                   |
| 7   | Bölüm başına `buffered.start` (`timestampOffset=0`)             | Her bölüm 0                                                                                                                                                                         | Her bölüm 0                                                                                                                                                     |
| 7   | Bölümler arasında `timestampOffset` atama                       | **`InvalidStateError`**; önce `sourceBuffer.abort()` gerekiyor                                                                                                                      | Aynı                                                                                                                                                            |
| 7   | Tek MSE'de 3 bölüm, seek doğruluğu (4 nokta)                    | −19..−34 ms                                                                                                                                                                         | −14..−73 ms (≤ 2 kare). Tekrar koşusunda tek kesintisiz aralık `[0, 179.95]`; `abort()` yine gerekti                                                            |
| 7   | Sınırın 1 sn öncesinden oynatma                                 | İki sınırı da geçti, `waiting` 0                                                                                                                                                    | İki sınırı da geçti, `waiting` 0. **1,17 sn'lik delik** (`[0, 58.83]`, `[60.00, …]`) atlanarak geçildi                                                          |
| 7   | Yalnız hedef bölüm kendi ofsetinde (§7 seek yolu)               | Çalışıyor, hata −34 ms                                                                                                                                                              | Çalışıyor, hata −21 ms                                                                                                                                          |
| —   | Konsol hatası                                                   | Yok                                                                                                                                                                                 | Yok                                                                                                                                                             |

## 4. Değerlendirme ve öneriler

1. **Bölüm süresi: karar kapısı aşıldı, öneri 5 dk.**
   - Ölçülen: Chrome bazı geçişlerde eski bölümün son 1,1–1,5 sn'sini kaydetmiyor. Yeni bölüm zamanında başlıyor.
   - Ölçülmeyen (hipotez): kareler kodlayıcıda bekleyip `stop()` anında boşaltılmıyor olabilir.
   - Gözlenen ilişki: Chrome koşu 1'de ilk ≈ 90 sn boyunca parçalar 180–380 KiB'ye düştü (normalde 700–950 KiB). Aynı dönemde CPU +255 % ölçüldü ve ön plandaki tek olay bu dönemde oldu. İkinci sekme koşusunda boşluklu bir bölümün parçaları da küçüktü (231/334 KiB). Bir boşluklu bölümün parçaları ise normaldi (headed, 912/625 KiB).
   - Bu bulgulara göre aşırı yüklü (yavaşlamış) bir kodlama hattı hipotezi güçlü, ama kanıtlanmadı. Aynı ayarlarla tekrar koşusunda yavaşlama olmadı (CPU +48 %, parçalar normal, 2/2 geçiş ≤ 16 ms).
   - İkinci sekme öndeyken görülen 3/4 ile ön plandaki 0/5 arasındaki farkın nedeni ayrılamadı. `visibilityState` `visible` okunsa da tarayıcı sayfayı kendi içinde arka plana almış olabilir.
   - Bölüm 5 dk olursa geçiş sayısı 5 kat azalır. Kayıp, 60 sn bölümde en çok %2, 5 dk bölümde en çok %0,4 olur.
   - Seek birimi büyür. Hedef bölüm baştan çekildiği için en kötü seek 60 parça (≈ 45–55 MB) olur. §7'deki "en çok 12 parça" sınırı 5 dk ile tutmaz; mimar §7'yi buna göre güncellemeli.
   - Ölçülmemiş seçenek (mimar kararı): yeni kaydediciyi eskisini durdurmadan önce başlatmak. İki kaydedici kısa süre örtüşür ve kuyruk kaybı boşluk bırakmaz.
   - Açık nokta (mimar): kayıt sonu da aynı `stop()` olduğundan son 1–1,5 sn kaybolabilir. Bunun kabul edilip edilmeyeceğine mimar karar vermeli. Oynatıcıda süre `buffered` değerinden alınmalı.
2. **Bütçe:**
   - Gerçek bit hızı hedefin altında kaldı: en kötü 1,32 Mbit/s ≈ 0,59 GB/sa. Bu değer ≤ 1 GB/sa ve sunucu tavanı 1 GiB/sa × süre + 32 MiB içindedir.
   - En büyük parça 1177 KiB oldu, 2 MiB sınırının yarısı kadar. §7 aynen geçerli. R-PE2 için 1 Mbit/s'e inmek gerekmedi.
3. **Çözünürlük değişimi:**
   - Chromium ailesinde MediaRecorder hata vermiyor ve iz değişmiyor; kayıt sessizce sürüyor. Bu yüzden §6'daki "hata ya da iz değişimi" tetikleyicisi Chromium'da hiç çalışmaz.
   - Değişen çözünürlüklü tek bölüm MSE'de oynatılabildi ve doğru seek edildi. Bu yüzden Chromium için yeni bölüm açmak gerekmiyor.
   - Firefox ölçülemedi. Firefox MediaRecorder'ın çözünürlük değişiminde hata verme ya da kırpma olasılığı K7'de gerçek tarayıcıyla denenmeli.
   - Koşulsuz yeni bölüm isteniyorsa tetik olarak kaynak `<video>` öğesinin `resize` olayı kullanılmalı. `track.getSettings()` gecikmeli dönüyor.
4. **MSE oynatıcı (K7 için bağlayıcı bulgular):**
   - Her bölümün medya zamanı 0'dan başlıyor. `timestampOffset = series.offsetMs/1000` varsayımı doğru.
   - Bir bölüm bitip yenisine geçerken `timestampOffset` atanmadan önce **`sourceBuffer.abort()` zorunlu**. Aksi halde `InvalidStateError` çıkıyor (son parça ayrıştırma ortasında kalıyor).
   - Seek hatası ≤ 2 kare. Yalnız hedef bölümü ekleme yolu çalışıyor.
   - Chrome 1,17 sn'lik deliği kendiliğinden atladı. Daha büyük deliklerde (eksik bölüm) "sonraki bölüme atla" mantığı §7'deki gibi uygulama tarafında kalmalı.
5. **CPU:**
   - Ölçülen ek yük: Chromium headless shell'de +0,37 çekirdek, Chrome tekrar koşusunda +0,48 çekirdek. Chrome koşu 1'de +2,55 çekirdek çıktı (yavaş dönem, bkz. §4.1).
   - Değerler kaba; GPU süreci ve canvas geri okuması da dahil.
   - Gerçek kaynak WebRTC'den çözülen H.264 olduğundan canvas geri okuması olmayacak, ancak çözme yükü eklenecek.
   - K7 gerçek tarayıcı testinde teknisyen makinesinde Görev Yöneticisi ile ölçülmeli. Yüksek çıkarsa 720p'ye ölçekleme önerilir.

## 5. Sınırlamalar

- Kaynak sentetik canvas. Gerçek oturumdaki uzak WebRTC izi, H.264 çözme yükü ve WebRTC çözünürlük uyarlaması ölçülmedi. Canvas geri okuması CPU sonucunu şişirebilir.
- Headless ve otomasyon altında koşuldu. Chrome bayrakları Playwright varsayılanı, eksi arka plan bayrakları. Kayıt sürerken makinede başka yük de vardı (CPU ölçümü kaba).
- **Arka plan / gizli sekme (5) ölçülemedi.** Playwright headed modda bile sayfayı `visible` tutuyor. Yoğun zamanlayıcı kısıtlaması (5 dk sonrası, dakikada 1) kısa koşuda da görünmezdi.
  - K7 gerçek tarayıcı testinde elle ölçülmeli: kayıt sürerken sekmeyi 6+ dk arka plana alıp parça aralığına ve bölüm zamanlayıcı kaymasına bakılmalı.
  - Zamanlayıcı kısıtlanırsa bölüm `setTimeout`'u gecikir. `dataavailable`'ın sürmesi beklenir ama ölçülmedi (hipotez).
  - K7 elle testine eklenecek madde: sekme arka plandayken `stop()` kuyruk kaybı (bölüm sonu `buffered.end` / bölüm süresi).
- Edge ve Firefox ölçülemedi (kurulu değil). Safari kapsam dışı.
- Boşluk örneklemi küçük: Chrome 16, Chromium 12 geçiş; ön planda 60 sn bölüm geçişi Chrome'da yalnız 4. Chrome'daki kuyruk kaybı sıklığı uzun koşuda farklı çıkabilir. Chrome iki kez koşuldu; davranış koşudan koşuya değişti.
- Projeksiyonlar 3 dk'lık ölçümden doğrusal. İçerik yoğun (tam ekran video vb.) olursa tarayıcı hedef bit hızına (1,5 Mbit/s ≈ 0,68 GB/sa) çıkar.
- §13 K0s satırı sonucun `docs/implementation.md`'ye yazılmasını ve spike sayfasının commit edilmemesini söylüyor. Koordinatör talimatıyla sonuç bu dosyada, spike dosyaları `docs/spike-p28e/` altında. `implementation.md`'de bu dosyaya işaretçi var. Commit edilip edilmeyeceği koordinatörün kararı.
