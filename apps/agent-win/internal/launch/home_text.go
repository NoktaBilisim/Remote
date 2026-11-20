package launch

import (
	"net/url"
	"strings"

	"remote-support/agent-win/internal/remember"
	"remote-support/agent-win/internal/request"
)

// Ana ekran metinleri.
const (
	NoticeUnreadable = "Bu bilgisayardaki kayıtlar şu an okunamıyor; kayıtlar silinmedi, program kayıtsız gibi çalışıyor. " +
		"Sorun sürerse Bu bilgisayarı unut ile kayıtları silebilirsiniz (firmalardaki kayıtlar bu durumda iptal edilemez)."
	NoticeSuggestForget = "Kayıtlar art arda okunamadı. Bu bilgisayarı unut ile silmeniz önerilir; firmalardaki kayıtlar " +
		"okunamadığı için iptal edilemez, firmanızdan yeni dosya isteyin."
	NoticeTrimmed = "Kayıt dosyasında sınırı aşan eski kayıtlar vardı; en eski kullanılanlar listeden çıkarıldı."
	// NoticeOldVersion G-P20-9 ek cümlesi.
	NoticeOldVersion    = "Eski sürüm dosyasını açmayın; tam temizlik için bu programda Bu bilgisayarı unut'u kullanın."
	NoticeRunRemoved    = "Windows açılışında başlatma kapatıldı: "
	NoticeRunNotFreed   = "Windows açılışında başlatma kaydı silinemedi; kullanım kılavuzundaki elle kaldırma adımını uygulayın."
	hintTrayFirst       = "Windows açılışında başlatmak için önce Tepside çalıştır'ı açın."
	hintStateFailed     = "Windows açılışında başlatma durumu okunamadı."
	hintWindowsOff      = "Windows ayarlarında devre dışı"
	hintTrayNoFirm      = "Tepside çalıştır, bu bilgisayar bir firmaya kaydolduktan sonra (ilk destek oturumunun ardından) açılabilir."
	fileRowPrefix       = "Bu dosyanın firması"
	noteForgetAllFailed = "Bu bilgisayardaki kayıt silinemedi. Pencereyi kapatıp yeniden deneyin."
	// NoticeMacFolder P31 AC-512: macOS'ta kaynak (klasör adı) okunamadığında ana ekranın bilgi satırı (Deps.SourceHint).
	NoticeMacFolder = "Firmanızın bağlantısından indirdiyseniz zip'i açtığınız klasörü yeniden adlandırmadan ve " +
		"uygulamayı klasörden çıkarmadan açın. Teknisyen size kod verdiyse Bağlantı kodum var ile devam edin."
)

// BlockedText K-P20-5 + G-P20-9: 5 sınırı nedeniyle eski sürümden kalan kayıt eklenemedi.
func BlockedText(firm string) string {
	return "Eski sürümden kalan bir kayıt (" + firm + ") eklenemedi; 5 firma sınırı. Eklemek için bir firmayı unutun. " +
		NoticeOldVersion
}

// InvalidText BINDING_INVALID olan öğe silindi.
func InvalidText(label string) string {
	return label + ": bu bilgisayarın kaydı artık geçerli değil, listeden çıkarıldı."
}

// ForgotOneText "Bu firmayı unut" sonrası.
func ForgotOneText(label string) string { return label + " bu bilgisayardan unutuldu." }

func joinNotes(n []string) string {
	var out []string
	for _, s := range n {
		if s != "" {
			out = append(out, s)
		}
	}
	return strings.Join(out, " ")
}

func bindingLabel(b remember.Binding) string {
	return request.Label(request.Display(b.TenantName, ""), request.Display(b.CustomerName, ""))
}

// rowText G-P20-12: her satırda yerel kayıt tarihi.
func rowText(b remember.Binding) string {
	return bindingLabel(b) + " (kayıt: " + b.IssuedAt.Local().Format("02.01.2006") + ")"
}

// originHost "https://host:443" → "host" (443 dışı port korunur).
func originHost(origin string) string {
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return origin
	}
	if u.Port() == "443" {
		return u.Hostname()
	}
	return u.Host
}

// startupNotes açılış bilgileri (bir kez): okuma durumu, göç, otomatik başlatma doğrulaması (G-P20-15 normal açılış).
func (d Deps) startupNotes(st remember.MigrateResult) []string {
	var n []string
	switch {
	case st.Status == remember.StatusUnreadable && st.SuggestForget:
		n = append(n, NoticeSuggestForget)
	case st.Status == remember.StatusUnreadable:
		n = append(n, NoticeUnreadable)
	}
	if st.Trimmed {
		n = append(n, NoticeTrimmed)
	}
	if st.Blocked != "" {
		n = append(n, BlockedText(request.Display(st.Blocked, "Firma")))
	}
	if d.Autostart != nil {
		if c, _ := d.Autostart.Verify(); c.Removed { // eksik exe dahil (S-P20-K1): "… kapatıldı: program bulunamadı; …"
			n = append(n, NoticeRunRemoved+c.Reason.Message()+".")
		}
	}
	return n
}
