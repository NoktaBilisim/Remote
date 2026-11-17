// Package glib Linux sistem kitaplıklarına CGO'suz erişimin (purego v0.11.3, ADR-0038 m.1–m.2) tek ince katmanıdır:
// izin listeli mutlak yoldan yükleme, GLib/GObject temel çağrıları ve ana döngüye (GTK ana iş parçacığı) gönderme.
// Linux dışında yalnız izin listesi ve C dizgisi yardımcıları derlenir (her platformda test edilir).
//
// FFI kuralları (mimari-p28g §5.4, S-P28f-11 Linux eşi; bu paketi ve onu kullanan her linux dosyasını bağlar):
//
//  1. Kitaplık yalnız Open ile ve yalnız izin listesindeki mutlak yoldan açılır (`/usr/lib/x86_64-linux-gnu/<soname>`;
//     mimari-p28g §5.1 T5). Göreli yol, ortam değişkeni (`LD_LIBRARY_PATH` vb.; zaten süzülür) ya da başka dizin yok.
//     Paket init'inde dlopen yapılmaz; yükleme Load ile açıkça yapılır (CI'da kitaplıksız derlenir/test edilir).
//  2. C'de saklanan bağlam olarak Go işaretçisi VERİLMEZ; tamsayı tutamaç verilir (objc.Handles — platformdan bağımsız
//     tek tutamaç tablosu, kopyalanmaz).
//  3. purego.NewCallback yalnız paket init'inde, sabit sayıda çağrılır. C → Go geri çağrısı yalnız ana iş parçacığında
//     (GLib ana döngüsü) gelir; başka C iş parçacığından geri çağrı alınmaz (ADR-0038 m.2).
//  4. Sembol çözülemezse hata döner (purego.RegisterLibFunc'ın paniği yerine); güvenlik işlevli sembolde çağıran
//     özelliği kapatır (fail-closed).
//  5. Değerle yapı geçirilmez, değişken argümanlı C işlevi çağrılmaz.
//  6. C'ye giden dizgi CString ile: uzunluk ≤ MaxStringBytes, geçerli UTF-8, gömülü NUL yok. C'den okunan dizgi
//     uzunluk sınırlı ve UTF-8 doğrulanmış kopyalanır.
package glib
