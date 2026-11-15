# Test Raporu

Önceki paketlerin sayfa testi raporları `docs/arsiv/*-test-raporu.md` ve `docs/test-raporu/` altındadır.

## P20 — Windows elle test listesi (bekliyor)

**Durum:** koşulmadı. test-operatoru Windows'ta koşamıyor; bu liste gerçek Windows 10 ve Windows 11 bilgisayarda (standart
kullanıcı, %100 ve %150 DPI, açık ve koyu tema) bir kişi tarafından uygulanır. Sonuç sütunu doldurulup tarih ve sürüm (`v0.12.0`
staging artifact'ı, SHA-256) yazılır.

**Kaynaklar:** `docs/implementation.md` "P20 K3", "P20 K5", "P20 K6", "P20 K8" elle test maddeleri; `docs/qa-raporu.md` öneri 6
(G-P20-16); runbook §24.9 (tepsi / Windows açılışı iz testi), §24.10 (AV kapısı), §24.11 (elle kaldırma). Otomatik kanıt:
Windows CI `test-windows` (`TestAC253*`, `TestAC254*` zorunlu PASS listesi) — bu liste onların yerine geçmez.

**Ön koşul:** staging sunucusu P20 K1 ekiyle güncel; 0.12.0 staging artifact'ı runbook §24.8 ile indirildi; SHA-256
`SHA256SUMS` ile eşleşiyor. İz testi için `apps/agent-win/test/trace-check.ps1` (runbook §24.9).

### A. Tepsi ve `--tray` (K5, AC-253)

| #   | Adım                                                                                     | Beklenen                                                                                                 | Sonuç |
| --- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----- |
| A1  | En az bir firmaya kayıtlı, "Tepside çalıştır" açık bilgisayarda `NoktaDestek.exe --tray` | Yalnız tepsi simgesi; pencere yok. Kaynak İzleyicisi'nde sürecin ağ bağlantısı yok                       |       |
| A2  | Simgeye tıkla; ayrıca klavyeyle seçip Enter                                              | Firma listeli ana ekran açılır                                                                           |       |
| A3  | Simgeye sağ tık                                                                          | Menüde yalnız 3 öğe: Destek iste / Aç / Çık                                                              |       |
| A4  | Ana ekranı X ile kapat (oturum yok)                                                      | Süreç tepside kalır; normal açılıştan tepsiye ilk inişte "Program tepside çalışmaya devam ediyor" balonu |       |
| A5  | Tepsiden talep → oturum → oturumu bitir                                                  | Son ekran ≈ 2,5 sn görünür, pencere kapanır, süreç tepside kalır                                         |       |
| A6  | Oturum sürerken tepsi → Çık → Hayır, sonra Çık → Evet                                    | Hayır: hiçbir şey değişmez. Evet: teknisyen konsolunda oturum biter, süreç çıkar                         |       |
| A7  | Tepsi örneği çalışırken ikinci kez `--tray`                                              | İkinci simge çıkmaz; ilk örnek öne gelir, ikinci süreç çıkar                                             |       |
| A8  | Görev Yöneticisi'nden Windows Gezgini'ni yeniden başlat                                  | Tepsi simgesi geri gelir                                                                                 |       |
| A9  | Açık ve koyu tema, %150 DPI                                                              | Simge ve balon okunaklı                                                                                  |       |
| A10 | Geçerli `NoktaDestek-<firma>-<ref>.exe` ile aç, X ile kapat ("Tepside çalıştır" açık)    | Süreç çıkar, tepsiye inmez (kod/ref dosyası bağımsız çalışır)                                            |       |
| A11 | Programı "Yönetici olarak çalıştır" ile aç                                               | "Tepside çalıştır" ve "Windows açılışında başlat" pasif; altında "Program yönetici olarak çalışıyor; …"  |       |
| A12 | Ana ekranda "Tepside çalıştır" işaretini kaldır, pencereyi kapat                         | Süreç çıkar; `HKCU\…\Run\NoktaDestek` değeri yok                                                         |       |

### B. Windows açılışında başlat (K4/K8, AC-253)

| #   | Adım                                                                                                    | Beklenen                                                                                                                             | Sonuç |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| B1  | İndirilenler'deki exe ile "Tepside çalıştır" + "Windows açılışında başlat" işaretle, oturumu kapatıp aç | `reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v NoktaDestek` → REG_SZ `"<yol>" --tray`; girişte yalnız simge        |       |
| B2  | "Tepside çalıştır" kapalıyken                                                                           | "Windows açılışında başlat" pasif, "Windows açılışında başlatmak için önce Tepside çalıştır'ı açın."                                 |       |
| B3  | Exe'yi `C:\Users\Public\` altına kopyalayıp oradan aç                                                   | Kutu pasif, "Bu klasöre başka kullanıcılar yazabiliyor; programı İndirilenler'e veya kendi klasörünüze taşıyın"                      |       |
| B4  | Zip içinden doğrudan çalıştır; USB bellekten çalıştır                                                   | Kutu pasif; sırasıyla "geçici bir klasörden" ve "ağ veya çıkarılabilir bir konumdan" metni                                           |       |
| B5  | Run değeri açıkken exe'yi başka klasöre taşı, programı yeni yerinden aç (S-P20-K1)                      | Run değeri silinmiş; ana ekranda "Windows açılışında başlatma kapatıldı: program bulunamadı; yeniden açmak için kutuyu işaretleyin." |       |
| B6  | B5'in tepsi yolu: değer eski yolu gösterirken başka kopyayla `--tray` başlat, simgeden pencere aç       | Tepside "Windows açılışında başlatma kapatıldı (program bulunamadı)" balonu; "(klasör izinleri)" balonu çıkmaz                       |       |
| B7  | Çalışan exe'nin klasörüne `icacls <klasör> /grant *S-1-5-32-545:(OI)(CI)M`, sonra tepsiden pencere aç   | Run değeri silinir, "Windows açılışında başlatma kapatıldı (klasör izinleri)" balonu                                                 |       |
| B8  | Görev Yöneticisi > Başlangıç uygulamaları > Nokta Destek > Devre dışı bırak, ana ekranı aç              | Altında "Windows ayarlarında devre dışı"                                                                                             |       |
| B9  | Kılavuzdaki elle kaldırma komutu (`reg delete … /v NoktaDestek /f`)                                     | Değer silinir, yönetici gerekmez                                                                                                     |       |
| B10 | Görev Yöneticisi > Başlangıç'ta görünen ad ve simge                                                     | Ad "Nokta Destek"; simge genel (bilinen sınırlama, exe'de simge kaynağı yok) — not düş                                               |       |

### C. Çoklu firma ana ekranı (K3, AC-254)

| #   | Adım                                                                                                         | Beklenen                                                                                                                         | Sonuç |
| --- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ----- |
| C1  | 0.11 ile kayıt al (`hatirla.bin`), 0.12 aç                                                                   | Kayıt listede; `hatirla.bin` silinmiş, `kayitlar.bin` + `kayitlar.lock` var                                                      |       |
| C2  | 5 ayrı firmayla oturum                                                                                       | Her yenisinde "Bu bilgisayar artık <firma> için de kayıtlı (n/5)."; liste 5 satır, her satırda "(kayıt: GG.AA.YYYY)"             |       |
| C3  | 6. firmayla oturum                                                                                           | Oturum sürer; sonunda "Bu bilgisayar 5 firmaya kayıtlı; <firma> için kayıt alınmadı. …"; panelde başka firmanın kaydı düşmemiş   |       |
| C4  | FirmHome yerleşimi: 5 satır + "Başka sunucu (<host>) — talep için seçilemez" bloğu, açık/koyu tema, %150 DPI | Taşma yok, metinler okunaklı, Tab sırası Destek iste → Bağlantı kodum var → Bu firmayı unut → Bu bilgisayarı unut (tüm firmalar) |       |
| C5  | Firma seç → Destek iste                                                                                      | Talep o firmaya düşer; bekleme penceresi başlığında seçilen firmanın adı                                                         |       |
| C6  | Bu firmayı unut → onay → Evet                                                                                | Yalnız o satır gider; panelde yalnız o firmanın kaydı iptal                                                                      |       |
| C7  | Bu bilgisayarı unut (tüm firmalar) → onay → Evet                                                             | `%LOCALAPPDATA%\NoktaDestek` yok, Run değeri yok, tepsi simgesi kalkar; `trace-check.ps1` temiz                                  |       |
| C8  | Panelde bir firmanın kaydını iptal et, programı aç                                                           | "<firma>: bu bilgisayarın kaydı artık geçerli değil, listeden çıkarıldı."; diğerleri kalır                                       |       |
| C9  | Ağ kapalıyken ana ekranı aç                                                                                  | Hiçbir kayıt silinmez                                                                                                            |       |
| C10 | Onay diyaloglarında Hayır                                                                                    | Hiçbir şey silinmez                                                                                                              |       |

### D. Talep öncesi sohbet (K6, AC-255)

| #   | Adım                                       | Beklenen                                              | Sonuç |
| --- | ------------------------------------------ | ----------------------------------------------------- | ----- |
| D1  | Staging panel ↔ istemci mesaj gidiş-dönüşü | İki yönde görünür; panel kartı "sohbet destekleniyor" |       |
| D2  | Enter ile gönderim                         | Enter = Gönder; "Siz (gönderiliyor…)" sonra onaylı    |       |
| D3  | 200+ mesajlık uzun geçmişte kaydırma       | Kaydırma çalışır, en eski mesajlar düşer              |       |
| D4  | Pencere arka plandayken teknisyen mesajı   | Görev çubuğu simgesi yanıp söner                      |       |
| D5  | Teknisyen talebi kabul eder                | "Talep kabul edildi; sohbet kapandı."; giriş pasif    |       |
| D6  | Açık ve koyu tema                          | Sohbet alanı okunaklı                                 |       |

### E. Başka kullanıcının oluşturduğu tepsi mutex'i / penceresi (G-P20-16, S-P20-K2)

İkinci bir yerel Windows kullanıcısı (B) gerekir; sınama kullanıcısı A.

| #   | Adım                                                                                                                                                          | Beklenen                                                                                                      | Sonuç |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----- |
| E1  | B oturumunda (aynı konsol oturumunda `runas /user:B`) A'nın mutex adını (`Local\NoktaDestek.Tray.<A SID SHA-256 ilk 16 hane>`) önceden oluştur; A'da `--tray` | A'nın tepsisi yine başlar (yabancı sahipli mutex yok sayılır); A'nın `tanilama.log`'unda `tray_mutex_foreign` |       |
| E2  | B, `runas` ile `NoktaDestekTray` sınıflı bir pencere açık tutarken A'da ikinci `--tray`                                                                       | A'nın ikinci örneği B'nin penceresini öne getirmez, ileti göndermez                                           |       |
| E3  | A'da tepsi çalışırken ikinci `--tray`                                                                                                                         | A'nın ilk örneği öne gelir (aynı kullanıcı)                                                                   |       |

### F. AV kapısı ve iz (runbook §24.9–24.10)

| #   | Adım                                                                            | Beklenen                    | Sonuç |
| --- | ------------------------------------------------------------------------------- | --------------------------- | ----- |
| F1  | Defender (W10 + W11) `MpCmdRun -Scan -ScanType 3 -File`; tepsi + Run açık 24 sa | Temiz, Defender geçmişi boş |       |
| F2  | `trace-check.ps1 -Tray on -Autostart on -ExePath <yol>`                         | Yalnız izinli izler         |       |
