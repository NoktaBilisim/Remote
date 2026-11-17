package flow

// P28g Linux istemci metinleri (mimari-p28g §2.1, §5.2b, §13–§15; AC-399, AC-400; AC-404 tek tablo). GTK ekranları
// (internal/ui/gtk, K4) ve cmd/noktadestek/main_linux.go yalnız buradan okur; satır sonu "\n". Teknisyen konsolundaki
// AC-399 karşılığı ("Müşterinin masaüstü uzaktan kontrole izin vermiyor (Wayland)") web `tr.json`'dadır.

// LinuxTexts Linux'a özgü ekran metinleri.
var LinuxTexts = struct {
	NoDisplay string // §2 main_linux: grafik oturum yok (WAYLAND_DISPLAY ve DISPLAY boş) → stderr + çıkış 2
	TestBand  string // S-P28g-9: gömülü adres prod değilse pencere başlığı ve Hakkında'da

	PortalOpening   string // §2.1 Wayland: kendi monitör seçim ekranı yok, sistem diyaloğu açılıyor
	ShareNotStarted string // AC-399: portal reddi/iptali
	Retry           string // AC-399: "Tekrar dene"
	PortalMissing   string // §14 m.11 / A-PG-2: xdg-desktop-portal arayüzü yok
	AllowControl    string // §14 m.6: "Uzaktan etkileşime izin ver" varsayılan kapalı

	WaylandWarning string // §5.2b m.4 (r3): Wayland onay diyaloğu, oturum penceresi
	WaylandHotkey  string // §2.1: Wayland'de kısayol metni yerine
	StopEnds       string // §14 m.8: Durdur paylaşımı ve oturumu bitirir
	A11yChanged    string // §5.2a m.5 / S-P28g-3: a11y tıklama ayarı oturumda açıldı → korunan denetim reddeder
	EndConfirm     string // S-P28g-8: oturum penceresi ✕ → onay

	ProxyFailed string // D-P28g-T2-1: vekil hatası; vekil URL'si hiçbir metne yazılmaz
	VoiceDevice string // K5: VoiceTexts.Device'ın Linux eşi (Windows gizlilik yolu Linux'a uymaz)
}{
	NoDisplay: "Nokta Destek bir masaüstü oturumunda (X11 ya da Wayland) çalıştırılmalıdır.",
	TestBand:  "TEST",

	PortalOpening:   "Sistem izin penceresi açılıyor…",
	ShareNotStarted: "Paylaşım başlatılmadı",
	Retry:           "Tekrar dene",
	PortalMissing:   "Bu masaüstünde ekran paylaşımı bileşeni eksik",
	AllowControl:    "Teknisyenin kontrol etmesini istiyorsanız sistem penceresinde 'Uzaktan etkileşime izin ver'i açın.",

	WaylandWarning: "Bu masaüstünde fareniz teknisyenin hareketini durdurmaz; kesmek için Super+L (ekranı kilitle) ya da " +
		"üst çubukta Durdur. Super+L hemen çalışmazsa birkaç kez basın; yine olmazsa önce Super+Esc, sonra Super+L.",
	WaylandHotkey: "Üst çubuktaki ekran paylaşımı simgesi → Durdur",
	StopEnds:      "Üst çubuktaki ekran paylaşımı simgesinden Durdur, paylaşımı ve oturumu bitirir",
	A11yChanged:   "Erişilebilirlik ayarı oturum sırasında değişti; onay için oturumu yeniden başlatın",
	EndConfirm:    "Oturumu bitir?",

	ProxyFailed: "Vekil sunucuya bağlanılamadı",
	VoiceDevice: "Mikrofonunuz açılamadı. Mikrofonun bağlı olduğunu ve Ayarlar > Ses altında giriş aygıtı olarak " +
		"seçildiğini kontrol edin; teknisyen yeniden isteyebilir.",
}

// FileTexts P28g alınan dosya metinleri (S-P28g-6 m.3; her platformun arayüzü dosya sonucu satırında kullanır).
var FileTexts = struct {
	ExecContent string // transfer.Result.Executable: içerik ELF ya da `#!` betiği (uzantıdan bağımsız)
}{
	ExecContent: " (Dikkat: bu dosya bir program ya da betik. Beklemediyseniz açmayın, silin.)",
}
