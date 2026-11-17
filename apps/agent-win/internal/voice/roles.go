package voice

// Uç nokta rolleri (mmdeviceapi.h ERole; mingw-w64 10.0.0). P28d saha düzeltmesi 1: çalma iletişim varsayılanında
// (eCommunications) açılıyordu; birçok PC'de bu, kullanıcının dinlediği hoparlör değildir (kulaklık/HDMI/USB kamera
// ya da bağlı olmayan ön panel jakı varsayılan iletişim aygıtı olabilir) → müşteri teknisyeni duymaz. Çalma artık
// varsayılan aygıtta (eConsole: sistem seslerinin ve diğer uygulamaların çaldığı yer); yakalama iletişim varsayılanında
// kalır (kullanıcı kulaklık mikrofonunu iletişim aygıtı seçmişse onu kullanır; sahada çalıştığı doğrulandı).
const (
	roleConsole        = 0 // eConsole
	roleCommunications = 2 // eCommunications

	captureRole = roleCommunications
	renderRole  = roleConsole
)
