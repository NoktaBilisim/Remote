# ADR-0041 — macOS'ta firma kimliği: zip/klasör adından ref

Tarih: 2026-11-20 · Durum: **Önerildi r2** (güvenlik tasarım turu S-P31-1, -4, -5 işlendi; kod turu bekliyor) · İlgili: AC-509..AC-513, `docs/gereksinimler.md` §14,
`docs/mimari-p31.md` K-P31-1..3, ADR-0006 r4 (Windows firma dosyası adı), ADR-0037 (macOS `.app` + zip, klasör adından kod)

## Bağlam

- Windows'ta firma kimliği indirilen dosyanın adındadır: `NoktaDestek-<label>-<ref>.exe` (ADR-0006 r4). İkili her adda aynıdır,
  imza/SHA tek.
- macOS istemcisi `.app` paketidir ve zip içinde dağıtılır. `.app` içeriği kod imzasıyla mühürlüdür; paket içine dosya eklemek ya
  da değiştirmek imzayı bozar ve Gatekeeper açmaz. Paketin kendi adı imzaya dahil değildir ama zip içindeki adı değiştirmek zip
  baytlarını firma başına değiştirir (tek SHA, attestation ve P29 manifesti kırılır).
- P28f (ADR-0037 m.5) bu sorunu kod için çözdü: zip iki üst öğelidir, Arşiv İzlencesi onu zip adıyla klasöre açar
  (`Destek-<kod>/Nokta Destek.app`), istemci kodu translocation çözülmüş üst klasör adından okur. K0s-5 çift tık yolunda GEÇTİ.
- Sadelik ilkesi: tek açılış yolu, Windows ile aynı kullanıcı deneyimi.

## Karar

1. Sunucu jenerik macOS zip'ini firma bağlantısında `NoktaDestek-<label>-<ref>.zip` adıyla sunar (aynı bayt). Firma bağlantısı
   tek kalır; platformu `os` parametresi ya da User-Agent seçer.
2. İstemci ref'i yalnız `.app`'in (translocation çözülmüş) üst klasör adından okur; bundle adından ref okunmaz (bundle adı
   yedeği yalnız P28f kodu için kalır). Desen Windows dosya adı deseniyle ortak çekirdekten türetilir, büyük/küçük harf
   duyarsızdır, ref küçük harfe çevrilir, tarayıcı / Arşiv İzlencesi kopya eklerini kabul eder (tek tanım: mimari-p31 §15.2).
   Öncelik: klasör kod > klasör ref > bundle adı (yalnız kod) > kaynak yok. Klasör adındaki etiket gösterilmez; firma adı sunucudan gelir.
3. Caddy firma zip yolunu forward_auth ile doğrular (ref aktif + label güncel), **ayrı iç uç** `/internal/agent-ready/macos-firm`
   üzerinden; uç fail-closed'dur (eksik, maskeli ya da desen dışı URI 404; eski sunucuda uç yok → 404). Yayın sırası önce
   sunucu, sonra Caddyfile; geri alma ters sırayla (mimari-p31 §15.1).
4. Ref okunamazsa istemci kod/AC-190 ana ekranına düşer ve Mac'e özgü bir bilgi satırı gösterir; başka bir kaynak denenmez.
5. İzin sonrası yeniden başlatma `open -n` ile translocation çözülmüş özgün yoldan yapılır; ref hiçbir dosyaya yazılmaz
   (yedek yok; mimari-p31 A-P31-5).

## Alternatifler

| Seçenek                                                  | Neden seçilmedi                                                                                                             |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `.app` içinde yan dosya (`Contents/Resources/firma.txt`) | Mühürlü kaynak → imza bozulur, Gatekeeper reddeder                                                                          |
| Zip'e üçüncü öğe olarak ref dosyası                      | Zip baytları firma başına değişir (SHA, attestation, P29 manifesti); klasör adı aynı bilgiyi zaten taşır                    |
| `.app` adında ref                                        | Zip içeriği firma başına değişir; Dock ve menüde ref görünür                                                                |
| `noktadestek://` URL şeması                              | İkinci açılış yolu; `Info.plist` + Launch Services kaydı (iz, AC-394); tarayıcıdan uygulama tetikleme yüzeyi                |
| İlk açılışta ref/bağlantı yapıştırma                     | İkinci yol ve fazladan adım; yalnız klasör adı gerçek tarayıcılarda tutmazsa yedek (A-P31-1)                                |
| Bundle (`.app`) adından ref yedeği                       | `.app` adı hiç ref taşımaz (zip sabit); yedek yalnız elle yeniden adlandırma yüzeyi ve öncelik belirsizliği ekler (S-P31-4) |
| `.dmg`                                                   | ADR-0037'de reddedildi; bağlanan birimin adı yine ad taşır ama ek imza ve sürükleme adımı                                   |

## Sonuçlar

- Olumlu: imza, SHA, attestation, TCC kimliği ve P29 manifesti değişmez; istemci kodu P28f'in kod okuma yolunu genişletir.
  Windows ile aynı "bağlantıdan indir, aç, Destek iste" deneyimi.
- Olumsuz: müşteri klasörü yeniden adlandırır ya da uygulamayı klasör dışına (ör. Programlar) taşırsa ref kaybolur (R-P31-1).
  Kılavuz ve OKUBENI bunu yazar; istemci açıklayıcı bilgi satırı gösterir.
- Geri dönüş: Caddyfile'dan `@agentZipFirm` kaldırılırsa ya da sunucu geri alınıp `macos-firm` ucu kaybolursa firma zip yolu
  404 olur (fail-closed); eski sunucu Mac kullanıcısına bugünkü gibi `.exe` yönlendirir; istemci kaynaksız açılışta kod
  alanına iner. Veri göçü yok.
