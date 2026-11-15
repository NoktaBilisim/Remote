# ADR-0031 — Uzaktan yazdırma: yalnız Windows istemci, Windows.Data.Pdf + GDI, yalıtılmış işleyici süreç

Tarih: 2026-11-15 · Durum: Önerildi (mimar; K0 prototipiyle kesinleşir) · İlgili: AC-283, AC-348..351, R45, `docs/mimari-p28.md` §5, ADR-0004, ADR-0009

## Bağlam

AC-283/348..351: teknisyendeki PDF (≤ 20 MB) müşterinin **varsayılan yazıcısına**, tek kopya, müşteri onayıyla basılacak; onay diyaloğu sayfa
sayısını ve yazıcı adını gösterecek; gömülü JavaScript/eylem çalışmayacak; geçici PDF iz bırakmayacak. Kısıtlar: istemci tek dosya, kendi dosyasını
yazmaz (`%TEMP%` dahil), cgo yok, AGPL/GPL yasak, sadelik ilkesi. Tarayıcı müşterisinde sessiz yazdırma mümkün değildir (`window.print()` daima
diyalog açar; yazıcı adı/sayfa sayısı sayfaya verilmez).

## Karar

1. Yazdırma yalnız Windows yerel istemcisinde (tarayıcı modunda düğme gizli). macOS/Linux (P28f/g) aynı `internal/printing` arayüzünü CUPS ile uygular.
2. PDF **yalnız bellekte** tutulur; Windows 10+ yerleşik **Windows.Data.Pdf** (WinRT) ile `InMemoryRandomAccessStream` üzerinden açılır, sayfa
   sayısı okunur, onaydan sonra sayfalar bitmap'e çizilir.
3. Ayrıştırma ve çizim aynı ikilinin `--pdf-isleyici` kipinde, **ayrı süreçte**: kısıtlı jeton (ayrıcalıklar kaldırılmış) + düşük bütünlük +
   job nesnesi (tek süreç, 512 MB, kill-on-close, UI kısıtları) + zaman aşımları; yalnız stdin/stdout borusu.
4. Bitmap'ler **üst süreçte** GDI ile basılır: `GetDefaultPrinterW` → `CreateDCW` → `StartDoc` (sabit belge adı) → sayfa başına `StretchDIBits`
   → `EndDoc`; `dmCopies = 1`, DPI ≤ 300.
5. WinRT çağrıları saf Go (`golang.org/x/sys/windows` + vtable), `capture/wgc_windows.go` kalıbı. Yeni bağımlılık yok.

## Alternatifler

| Seçenek                              | Neden seçilmedi                                                                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `ShellExecute(..., "printto", ...)`  | Kayıtlı PDF uygulamasına bağlı: Edge sessiz basmaz, Adobe Reader JS çalıştırır ve açık kalır, uygulama yoksa çalışmaz; diske dosya ister |
| PDFium DLL (BSD/Apache)              | ~5 MB ek; DLL diske çıkarılmalı (iz + DLL arama riski) veya bellekten yükleme karmaşıklığı; JS'siz derleme seçimi ayrıca doğrulanmalı    |
| UWP `PrintDocument` / `PrintManager` | CoreWindow ve yazdırma arayüzü ister; sessiz varsayılan yazıcıya basmaz                                                                  |
| Ghostscript / MuPDF                  | AGPL — proje kuralı yasaklar                                                                                                             |
| Aynı süreçte render                  | Render motoru çökmesi oturumu düşürür; sömürüde tam istemci yetkisi; R45 için zayıf                                                      |
| Tarayıcı müşterisinde yazdırma       | Sessiz/varsayılan yazıcı yok, AC-349 alanları sağlanamaz                                                                                 |

Yeni teknoloji ölçütleri: ekip bilgisi var (WGC ile WinRT vtable kalıbı kodda), bakım Microsoft'ta (OS bileşeni, Windows Update ile yamalanır),
geri dönüş var (özellik bildirimi `rs.cap.print1` kaldırılırsa düğme pasifleşir; protokol değişmez).

## Sonuçlar

- (+) Ek ikili/bağımlılık yok, diske yazım yok, JS/eylem çalışmaz, render çökmesi oturumu düşürmez.
- (+) Spool belge adı sabit → dosya adı yazdırma kuyruğunda da görünmez.
- (−) Bitmap yazdırma: büyük spool, metin seçilebilirliği yok, çok sayfalı belgede yavaş olabilir (R-P28a-2).
- (−) Sayfa sayısı için onaydan **önce** ayrıştırma (risk kabulü K-P28a-5; yalıtımla azaltılır).
- (−) Düşük bütünlükte WinRT etkinleştirmesi doğrulanmadı → K0 prototipi; olmazsa kısıtlı jeton + job ile devam (güvenlik turuna bildirilir).
- Genişleme: yazıcı seçimi/kopya/çift yüz (Sonra) aynı GDI katmanında DEVMODE alanlarıdır; P28b'de baytlar sunucu yolundan gelir (`PrintSource`).
