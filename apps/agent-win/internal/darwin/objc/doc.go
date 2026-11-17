// Package objc macOS sistem çerçevelerine CGO'suz erişimin (purego v0.11.3, ADR-0037 m.1) tek ince katmanıdır:
// izin listeli kütüphane yükleme, sınıf/selector çözme, NSString dönüşümleri, autorelease havuzu, dispatch kuyruğuna
// gönderme ve C'ye verilen bağlam için tamsayı tutamaç tablosu. Darwin dışında yalnız tutamaç tablosu derlenir.
//
// FFI kuralları (S-P28f-11, mimari-p28f §5.4; bu paketi ve onu kullanan her darwin dosyasını bağlar):
//
//  1. C'de saklanan bağlam (dispatch, temsilci, geri çağrı bağlamı) olarak Go işaretçisi VERİLMEZ; Handles tablosunun
//     tamsayı tutamacı verilir. Yalnız çağrı süresince yaşayan geçişlerde Go belleği argüman olabilir (gerekirse
//     runtime.Pinner); `uintptr(unsafe.Pointer(…))` dönüşümü çağrı argümanı dışında yapılmaz (S6-1 testi).
//  2. purego.NewCallback ve objc.RegisterClass yalnız paket `init`'inde, bir kez çağrılır (geri çağrı yuvaları
//     serbest bırakılamaz).
//  3. Ağdan/teknisyenden gelen metinden NSString yalnız NSString ile: uzunluk ≤ MaxStringBytes, UTF-8 doğrulanmış,
//     `initWithBytes:length:encoding:`. Güvenilmeyen metin biçim dizesi (`stringWithFormat:`, NSLog) olarak
//     kullanılmaz. `CGEventKeyboardSetUnicodeString` ≤ 20 UTF-16 birimlik parçalarla çağrılır (K3).
//  4. CVPixelBuffer düzlem kopyası `bytesPerRow × height` taşma denetimli; kilit/serbest bırakma eşli (K2).
//  5. Güvenlik işlevli çağrılarda (gösterge, `canHide`, izin kapısı, quarantine, `localClick`) sınıf ya da selector
//     çözülemezse fail-closed: Class hata döner, Responds false döner; çağıran özelliği kapatır (kontrol yok, dosya
//     silinir).
//  6. darwin testleri CI'da `MallocScribble=1` + `NSZombieEnabled=YES` ile ve x86_64 dilim Rosetta altında koşar.
//  7. Dinamik kütüphane yalnız Open/Framework ile ve yalnız izin listesindeki mutlak yoldan açılır:
//     `/System/Library/Frameworks/<Ad>.framework/<Ad>`, `/usr/lib/libobjc.A.dylib`, `/usr/lib/libSystem.B.dylib`
//     (mimari-p28f §5.1 T5). Göreli yol, `@rpath`, ortam değişkeni yok.
package objc
