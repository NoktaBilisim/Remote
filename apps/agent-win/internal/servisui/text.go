// Package servisui gözetimsiz erişim ikilisinin (`NoktaDestekServis.exe`) kullanıcı arayüzüdür (P27-K7; mimari-p27
// §5.1, §5.3, §5.4): tek ayar penceresi, tepsi simgesi (`--tray`), kurulumdaki kayıt kodu iletişim kutusu ve kaldırma
// onayı. Kullanıcının gördüğü tek ekran ayar penceresidir; tepsi "Ayarlar…" aynı pencereyi açar (sadelik). "Kapalı"
// durumu boru yanıtından değil HKLM `LocalEnabled` okumasından gelir (O-P27-1, AC-338). Bu dosya platformsuzdur
// (Linux'ta test edilir); Win32 uygulaması *_windows.go.
package servisui

import (
	"strings"
	"unicode"

	"remote-support/agent-win/internal/servis"
	"remote-support/agent-win/internal/ui/uicore"
)

// Status penceredeki durum.
type Status int

const (
	StNotInstalled Status = iota // HKLM kaydı yok
	StUnverified                 // boru sunucusu SCM servis PID'i değil (AC-338)
	StLocalOff                   // HKLM LocalEnabled ≠ 1 (okunamazsa da kapalı — fail-closed)
	StRevoked                    // sunucu cihazı iptal etti
	StSession                    // bağlantı var
	StOnline                     // sunucuya bağlı
	StOffline                    // bağlanamıyor (servis çalışmıyor, bağlanıyor, reddedildi, açılış denetimi)
)

// PipeResult boru `status` çağrısının sonucu.
type PipeResult int

const (
	PipeOK         PipeResult = iota
	PipeDown                  // boru yok: servis çalışmıyor
	PipeUnverified            // servis.ErrServiceUnverified
	PipeBusy                  // tüm örnekler meşgul ya da geçici hata: önceki durum korunur
)

// Snapshot pencere/tepsi için okunan anlık durum.
type Snapshot struct {
	Installed    bool
	DeviceID     string
	TenantName   string
	CustomerName string
	Enabled      bool // HKLM LocalEnabled == 1
	Pipe         PipeResult
	State        string // boru durumu (servis.State*, "session", "unsafe")
	TechName     string
	// Güncelleme: kurulu sürüm (Uninstall DisplayVersion) ile çalışan ikilinin sürümü farklı ve çalışan ikili kurulu
	// kopya değilse "Güncelle…" (§5.3).
	InstalledVersion string
	SelfVersion      string
	SelfIsInstalled  bool
	// ServiceVersion P29 (K-P29-21): boru `status` yanıtındaki çalışan servis sürümü (eski servis: boş).
	ServiceVersion string
}

// TrayRestart K-P29-21: tepsi kendi sürümünden farklı bir servisle konuşuyorsa ve kurulu sürüm (DisplayVersion,
// yeni servis öz-onarımla yazar) servisle aynıysa kurulu yoldan yeniden başlamalı. Eski servis (sürüm yok) → hayır.
func TrayRestart(s Snapshot) bool {
	return s.Pipe == PipeOK && s.ServiceVersion != "" && s.ServiceVersion != s.SelfVersion &&
		s.InstalledVersion == s.ServiceVersion
}

// Action birincil düğmenin eylemi.
type Action int

const (
	ActNone    Action = iota
	ActInstall        // "Kur…" → UAC → --install
	ActUpdate         // "Güncelle…" → UAC → --install (kayıt korunur)
	ActDisable        // boru `disable` (standart kullanıcı)
	ActEnable         // UAC → --enable
)

// View pencere ve tepside gösterilecek her şey.
type View struct {
	Status       Status
	StatusText   string
	Detail       string // durum altındaki açıklama (boş olabilir)
	Lines        []string
	Primary      Action
	PrimaryText  string
	Update       bool // ek "Güncelle…" düğmesi
	CanUninstall bool
	Tip          string
}

// Kullanıcıya görünen metinler.
const (
	Title            = "Nokta Destek — Gözetimsiz Erişim"
	TextUnverified   = "Servis doğrulanamadı"
	textNotInstall   = "Kurulu değil"
	textLocalOff     = "Yerel olarak kapalı"
	textRevoked      = "İptal edildi"
	textOnline       = "Çevrimiçi"
	textOffline      = "Bağlanamıyor"
	textSession      = "Bağlantı var: "
	TipPrefix        = "Gözetimsiz erişim: "
	MenuDisable      = "Gözetimsiz erişimi &kapat"
	MenuEnable       = "Gözetimsiz erişimi &aç…"
	MenuSettings     = "Aya&rlar…"
	ButtonInstall    = "Kur…"
	ButtonUpdate     = "Güncelle…"
	ButtonDisable    = "Gözetimsiz erişimi kapat"
	ButtonEnable     = "Gözetimsiz erişimi aç…"
	ButtonUninstall  = "Kaldır…"
	ButtonClose      = "Kapat"
	detailNotInstall = "Kurulum için bu bilgisayarın yönetici onayı ve destek firmanızın verdiği kayıt kodu gerekir."
	stateSession     = "session"
	stateUnsafe      = "unsafe"
	maxShownName     = 64
)

// Kullanıcıya gösterilen hata ve bilgi metinleri.
const (
	ErrPipeDownText   = "Servise ulaşılamadı. Servis çalışmıyorsa bu bilgisayara uzaktan bağlanılamaz."
	ErrDisableText    = "Gözetimsiz erişim kapatılamadı. Tekrar deneyin."
	ErrElevateText    = "İşlem başlatılamadı."
	DoneOnlineText    = "Kuruldu — çevrimiçi."
	DonePendingText   = "Kuruldu — sunucuya bağlanılıyor. Durumu ayar penceresinden izleyebilirsiniz."
	CodePrompt        = "Destek firmanızın verdiği kayıt kodunu girin. Kurulumu bu bilgisayarın yöneticisi yapar."
	CodeTitle         = "Gözetimsiz erişim kurulumu"
	ButtonInstallNext = "Kur"
	ButtonCancel      = "Vazgeç"
)

// Compute anlık durumdan görünümü üretir. Öncelik: kurulu değil → doğrulanamadı → yerel kapalı → iptal → bağlantı →
// çevrimiçi → bağlanamıyor.
func Compute(s Snapshot) View {
	if !s.Installed {
		return View{Status: StNotInstalled, StatusText: textNotInstall, Detail: detailNotInstall, Primary: ActInstall,
			PrimaryText: ButtonInstall, Tip: uicore.VersionedTitle(TipPrefix+textNotInstall, s.SelfVersion)}
	}
	v := View{CanUninstall: true, Lines: infoLines(s), Update: needsUpdate(s)}
	v.Status, v.Detail = status(s)
	v.StatusText = statusText(v.Status, s.TechName)
	v.Tip = uicore.VersionedTitle(TipPrefix+tipText(v), s.SelfVersion) // sürüm gösterimi (2026-11-18)
	switch {
	case v.Status == StRevoked:
	case s.Enabled:
		v.Primary, v.PrimaryText = ActDisable, ButtonDisable
	default:
		v.Primary, v.PrimaryText = ActEnable, ButtonEnable
	}
	return v
}

func status(s Snapshot) (Status, string) {
	switch {
	case s.Pipe == PipeUnverified:
		return StUnverified, "Bu bilgisayardaki servis beklenen servis değil. Bilgisayar yöneticinize başvurun."
	case !s.Enabled:
		return StLocalOff, "Destek firmanız bu bilgisayara gözetimsiz bağlanamaz."
	case s.Pipe == PipeDown:
		return StOffline, "Servis çalışmıyor."
	case s.State == servis.StateRevoked:
		return StRevoked, "Destek firmanız bu cihazın kaydını iptal etti. Programı kaldırabilirsiniz."
	case s.State == stateSession:
		return StSession, "Destek firmanız şu anda bu bilgisayara bağlı."
	case s.State == servis.StateOnline:
		return StOnline, "Destek firmanız bu bilgisayara onay istemeden bağlanabilir."
	case s.State == stateUnsafe:
		return StOffline, "Program klasörünün izinleri bozuk. Bilgisayar yöneticinize başvurun."
	case s.State == servis.StateRejected:
		return StOffline, "Sunucu bu cihazı kabul etmedi; yeniden denenecek."
	}
	return StOffline, "Sunucuya bağlanılıyor."
}

func statusText(st Status, tech string) string {
	switch st {
	case StUnverified:
		return TextUnverified
	case StLocalOff:
		return textLocalOff
	case StRevoked:
		return textRevoked
	case StSession:
		if n := CleanName(tech); n != "" {
			return textSession + n
		}
		return strings.TrimSuffix(textSession, ": ")
	case StOnline:
		return textOnline
	}
	return textOffline
}

// tipText §5.4 ipucu: Açık / Kapalı / Bağlantı var: <teknisyen>; diğer durumlar durum metniyle.
func tipText(v View) string {
	switch v.Status {
	case StOnline:
		return "Açık"
	case StLocalOff:
		return "Kapalı"
	}
	return v.StatusText
}

func infoLines(s Snapshot) []string {
	var out []string
	if n := CleanName(s.TenantName); n != "" {
		out = append(out, "Destek firması: "+n)
	}
	if n := CleanName(s.CustomerName); n != "" {
		out = append(out, "Müşteri: "+n)
	}
	if id := ShortID(s.DeviceID); id != "" {
		out = append(out, "Cihaz kimliği: "+id)
	}
	return out
}

func needsUpdate(s Snapshot) bool {
	return !s.SelfIsInstalled && s.InstalledVersion != "" && s.SelfVersion != "" && s.InstalledVersion != s.SelfVersion
}

// Merge boru meşgulse (PipeBusy) önceki boru sonucunu korur; ilk okumada meşgulse durum "bağlanılıyor" olur.
func Merge(prev, cur Snapshot) Snapshot {
	if cur.Pipe != PipeBusy {
		return cur
	}
	cur.Pipe, cur.State, cur.TechName = PipeOK, "", ""
	if prev.Installed {
		cur.Pipe, cur.State, cur.TechName = prev.Pipe, prev.State, prev.TechName
	}
	return cur
}

// ShortID cihaz kimliğinin ilk 8 karakteri (§5.4).
func ShortID(id string) string {
	id = CleanName(id)
	if r := []rune(id); len(r) > 8 {
		return string(r[:8])
	}
	return id
}

// CleanName sunucu/kayıt kaynaklı adı gösterime hazırlar: denetim ve biçim karakterleri (yön değiştiriciler dahil)
// atılır, boşluklar tekleşir, en çok 64 karakter. Menüde gösterilecekse ayrıca MenuText (etiketler SS_NOPREFIX).
func CleanName(s string) string {
	var b strings.Builder
	n, space := 0, false
	for _, r := range s {
		if unicode.IsSpace(r) {
			space = b.Len() > 0
			continue
		}
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			continue
		}
		if n >= maxShownName {
			break
		}
		if space {
			b.WriteByte(' ')
			n++
			space = false
		}
		b.WriteRune(r)
		n++
	}
	return b.String()
}

// MenuText menü öğesinde (& erişim tuşu öneki) düz gösterim için & çiftlenir.
func MenuText(s string) string { return strings.ReplaceAll(s, "&", "&&") }

// utf16Trunc Win32 sabit uzunluklu dizi alanı için (sonlandırıcı dahil n UTF-16 birimi); vekil çift bölünmez.
func utf16Trunc(s string, n int) []uint16 {
	u := make([]uint16, 0, n)
	for _, r := range s {
		units := []uint16{uint16(r)}
		if r >= 0x10000 {
			r -= 0x10000
			units = []uint16{uint16(0xD800 + (r>>10)&0x3FF), uint16(0xDC00 + r&0x3FF)}
		}
		if len(u)+len(units) > n-1 {
			break
		}
		u = append(u, units...)
	}
	return u
}
