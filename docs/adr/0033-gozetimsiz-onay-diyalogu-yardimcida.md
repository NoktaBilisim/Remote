# ADR-0033 — Gözetimsiz erişimde cihaz onay diyaloğu yardımcı süreçte; kip kararı cihazda

> **Durum: Yerine geçildi (r3, 2026-11-18).** Kullanıcı kararıyla gözetimsiz bağlantı her zaman cihaz kullanıcısına sorulmadan
> açılır; onay diyaloğu, örtülme kuralı, durum borusundaki `ev:consent` ve `NoktaDestekOnay` pencere sınıfı kaldırılır. Yerine geçen
> karar: `docs/mimari-p28u.md` §r3 (K-P28u-r3-1..12). Durum borusu (`ev:control`, `ev:lock`), giriş borusu komutları ve yardımcının
> tek pencere sınıfı (`NoktaDestekGosterge`) kalır. Bu ADR tarihsel kayıt olarak korunur.

Tarih: 2026-11-16 · Durum: Kabul edildi (P28u güvenlik tasarım turu GEÇTİ; r2 bulguları işlendi — mimari-p28u §r2) · İlgili: ADR-0028 (değiştirir), AC-341, AC-429..446,
`docs/mimari-p28u.md` §7, mimari-p27 §5.2–5.5

## Bağlam

P28u (US-76, V-PU1) gözetimsiz bağlantıda cihazda oturum açmış kullanıcı varsa izin istemeyi varsayılan yapar. ADR-0028
"yerel onay penceresi"ni S24 gereği reddetmişti; P27 tasarımı yardımcıda ileti kutusunu yasaklar (AC-341) ve "gösterge dışında
pencere yok" der (R-PU3). Diyalog sahteciliği ve girdi enjeksiyonuyla otomatik onay (R-PU4) ana tehditlerdir.

## Karar

1. Onay diyaloğunu **yardımcı** (`--helper`, kısıtlı SYSTEM jetonu, konsol oturumu) çizer: yardımcı paketinde, `internal/win`
   ile ham Win32, tek amaçlı pencere (`NoktaDestekOnay`). `internal/ui`, `MessageBox`, URL/e-posta açma, dosya seçici,
   `ShellExecute` yasağı aynen kalır. Diyalog yalnız `Default` masaüstünde çizilir; karar verilmeden gösterge çizilmez ve
   `/ws/guest` açılmaz. AC-116 kuralı (`internal/control.Consent`: 1,5 sn, enjekte süzgeci, varsayılan Reddet) aynen.
2. `asked` / `no_user` kipini **servis** canlı oturum durumuyla seçer (okunamazsa `active` → sorar). `silent` yalnız sunucudan
   gelir (politika + yetki + step-up + gerekçe sunucuda).
3. Yardımcıya ikinci devralınan tanıtıcı eklenir: **durum borusu** (yardımcı → servis, tek yön, satır JSON ≤ 512 B; onay kararı,
   kilit sonucu). Giriş borusu ilk satırdan sonra komut satırları taşır. `HANDLE_LIST` = bu iki uç.
4. Yetenek `rs.cap.consent1` alt protokol belirteciyle bildirilir; bildirmeyen servise gözetimsiz bağlantı açılmaz
   (`DEVICE_OUTDATED`).
5. ADR-0028'in "Yerel onay penceresi: reddedildi" alternatifi şu şekilde değişir: kullanıcı varken onay varsayılandır; onaysız yol
   yalnız `no_user` ve politika ile açılan `silent` kipidir. ADR-0028'in diğer telafi kontrolleri (gösterge fail-closed, yerel
   anahtar, step-up, bildirim) değişmez.
6. **(r2, O-P28u-1) Örtülme kuralı:** diyalog z-sırasında üstünde kendi gösterge HWND'leri dışında görünür (katmanlı/saydam dahil)
   bir pencere diyalog dikdörtgenini kesiyorsa "İzin ver" pasiftir; örtülme kalkınca 1,5 sn kilit yeniden başlar; tıklama anında
   ayrıca `WindowFromPoint` doğrulanır. Karar mantığı `internal/control/occlusion.go` (platformdan bağımsız).
7. **(r2, D-P28u-1) Durum borusu durum makinesi:** servis okuyucusu olay × durum tablosu uygular (`ev:consent` yalnız `ask` iken
   ve bir kez, `ev:lock` yalnız bekleyen `id` için); beklenmeyen olay = `helper_protocol` + `TerminateProcess`; `control` değeri
   yardımcı başlatılırken/çıkışında `off`. `ChangeWindowMessageFilter(Ex)` sınır testi yasak listesine eklenir.
8. **(r2, O-P28u-3) Onay aklama yok:** `asked` onayı yalnız o anki kullanıcıyı kapsar; logoff sonrası konsolda kullanıcı oturumu
   açılırsa bağlantı `session_changed` ile biter.

## Alternatifler

- **Tepsi süreci (kullanıcı jetonu):** aynı kullanıcıdaki zararlı yazılım tıklayabilir/sahteleyebilir; tepsi kapalı olabilir. Ret.
- **Servis `WTSSendMessage`:** 1,5 sn kilit, enjekte süzgeci ve geri sayım uygulanamaz. Ret.
- **Sunucu son durumuna göre kip:** eski durum gizlilik aleyhine kullanılabilir. Ret.

## Sonuçlar

- (+) UIPI: Medium IL süreçler System IL pencereye ileti/`SendInput` ile etki edemez; karar öncesi kare/girdi kanalı yapısal olarak yok.
- (−) Sınır: UIPI **yalnız enjeksiyonu** kapatır; üst üste bindirilmiş saydam pencereyle görsel aldatma (fiziksel tıklamanın
  "İzin ver"e geçmesi) UIPI'nin kapsamı dışındadır — karar 6 (örtülme kuralı) bu boşluğu kapatır; Windows elle testinde saydam
  katman maddesi zorunludur.
- (+) Mevcut masaüstü izleme, job ve jeton kısıtları yeniden kullanılır; yeni bağımlılık yok.
- (−) Yardımcının saldırı yüzeyi bir pencere ve bir boru kadar büyür; `boundary_test` ve `launch` testi yeni tanıtıcıyı ve pencere
  sınıfını denetler.
- (−) Diyalog güvenli masaüstünde/kilit ekranında gösterilmez; kilitliyken onay sorulmaz (V-PU2, R-PU6 kabulü).
- Windows elle testi zorunlu: enjeksiyonla tıklama denemesi, saydam TOPMOST katman ile tıklama denemesi, iki monitör, UAC sırasında
  diyalog davranışı.
- Genişleme noktası: örtülme kuralının P20 katılımlı onay penceresine taşınması Sonra (S-P28u-6).
