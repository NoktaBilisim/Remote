// Package diag istemcinin yerel tanılama logudur (istemci 0.10.2): `%LOCALAPPDATA%\NoktaDestek\tanilama.log`.
// Yalnız ekran yakalama sorunu olduğunda (açılamama, yedek yönteme geçiş, yayın sırasında kodlayıcı hatası) yazılır;
// sorunsuz oturum dosya bırakmaz (AC-108). İçerik sabit anahtarlı satırlardır: zaman, istemci sürümü, Windows
// sürümü, monitör/adaptör/çıkış bilgisi, denenen yöntemler, neden kodu ve HRESULT. Ad, telefon, e-posta, kullanıcı/
// bilgisayar adı, dosya yolu, sunucu adresi, kod, anahtar veya bilet YAZILMAZ; serbest metin alanları (adaptör adı,
// aygıt adı) yazdırılabilir ASCII'ye indirgenip kısaltılır. Dosya MaxSize'ı aşacaksa `.1`'e döner (toplam ≤ 2×MaxSize).
// "Bu bilgisayarı unut" (internal/remember) iki dosyayı da siler.
package diag

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

const (
	FileName = "tanilama.log"
	OldName  = FileName + ".1"
	MaxSize  = 128 << 10 // dosya başına; dönen kopyayla birlikte en çok 256 KB
)

// Olay türleri.
const (
	EventOpenFail   = "acilis_hata"  // kaynak açılamadı (müşteri "Ekran görüntüsü alınamadı" gördü)
	EventOpenFallbk = "acilis_yedek" // DXGI açılamadı, yedek yöntemle (DXGI1/GDI) paylaşılıyor
	EventStreamFail = "yayin_hata"   // yayın sırasında kodlama/yakalama hatası
)

// Monitor EnumDisplayMonitors kaydı.
type Monitor struct {
	Device  string // \\.\DISPLAYn
	W, H    int
	Primary bool
}

// Adapter DXGI adaptörü.
type Adapter struct {
	Name     string
	Vendor   uint32
	Device   uint32
	Software bool
}

// Output DXGI çıkışı. Desc1 IDXGIOutput6 varsa (Windows 10 1803+) BitsPerColor/ColorSpace geçerlidir.
type Output struct {
	Adapter      int
	Device       string
	W, H         int
	Rotation     int // DXGI_MODE_ROTATION
	Attached     bool
	Desc1        bool
	BitsPerColor int
	ColorSpace   int // DXGI_COLOR_SPACE_TYPE; 12 = HDR10 (G2084/P2020)
}

// HDR çıkış HDR/gelişmiş renk modunda mı (DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020).
func (o Output) HDR() bool { return o.Desc1 && o.ColorSpace == 12 }

// Attempt denenen yakalama yöntemi; Reason boşsa başarılı.
type Attempt struct {
	Method string
	Reason string
	Op     string
	HR     uint32
}

// Report tek tanılama kaydı.
type Report struct {
	Time     time.Time
	Event    string
	Version  string // istemci sürümü
	OS       string // ör. 10.0.22631.4317
	Release  string // DisplayVersion (ör. 23H2)
	Edition  string // EditionID (ör. ProfessionalN)
	Target   string // paylaşılmak istenen monitörün aygıt adı
	Monitors []Monitor
	Adapters []Adapter
	Outputs  []Output
	Attempts []Attempt
	Method   string // seçilen yöntem (DXGI, DXGI1, GDI); başarısızsa boş
	Encoder  string // HW / SW; kurulamadıysa boş
	HWReason string // donanım kodlayıcı kurulamadıysa nedeni
	Reason   string // sonuç neden kodu (başarılı yedekte boş)
	Op       string
	HR       uint32
}

const maxField = 64

// clean serbest metni yazdırılabilir ASCII'ye indirger (satır sonu, '=' ve '"' dahil denetim karakterleri '?' olur)
// ve kısaltır; böylece bir alan kayda yeni satır/anahtar ekleyemez.
func clean(s string) string {
	var b strings.Builder
	n := 0
	for _, r := range s {
		if n == maxField {
			break
		}
		if r < 0x20 || r > 0x7E || r == '"' || r == '=' {
			r = '?'
		}
		b.WriteRune(r)
		n++
	}
	return b.String()
}

func b01(v bool) int {
	if v {
		return 1
	}
	return 0
}

func hex(v uint32) string { return fmt.Sprintf("0x%08X", v) }

// Format kaydı metne çevirir: "--- " ile başlayan başlık ve sabit anahtarlı satırlar.
func (r Report) Format() string {
	var b strings.Builder
	fmt.Fprintf(&b, "--- %s olay=%s\n", r.Time.UTC().Format(time.RFC3339), clean(r.Event))
	fmt.Fprintf(&b, "istemci=%s windows=%s surum=%s edisyon=%s\n", clean(r.Version), clean(r.OS), clean(r.Release), clean(r.Edition))
	fmt.Fprintf(&b, "hedef=%s monitor_sayisi=%d\n", clean(r.Target), len(r.Monitors))
	for i, m := range r.Monitors {
		fmt.Fprintf(&b, "monitor=%d aygit=%s boyut=%dx%d birincil=%d\n", i+1, clean(m.Device), m.W, m.H, b01(m.Primary))
	}
	for i, a := range r.Adapters {
		fmt.Fprintf(&b, "adaptor=%d ad=\"%s\" vendor=%s aygit_id=%s yazilim=%d\n", i, clean(a.Name), hex(a.Vendor), hex(a.Device), b01(a.Software))
	}
	for _, o := range r.Outputs {
		fmt.Fprintf(&b, "cikis=%s adaptor=%d boyut=%dx%d dondurme=%d masaustu=%d", clean(o.Device), o.Adapter, o.W, o.H, o.Rotation, b01(o.Attached))
		if o.Desc1 {
			fmt.Fprintf(&b, " renk_bit=%d renk_uzayi=%d hdr=%d", o.BitsPerColor, o.ColorSpace, b01(o.HDR()))
		} else {
			b.WriteString(" renk=bilinmiyor")
		}
		b.WriteByte('\n')
	}
	for _, a := range r.Attempts {
		if a.Reason == "" {
			fmt.Fprintf(&b, "deneme=%s sonuc=OK\n", clean(a.Method))
			continue
		}
		fmt.Fprintf(&b, "deneme=%s sonuc=%s islem=%s hr=%s\n", clean(a.Method), clean(a.Reason), clean(a.Op), hex(a.HR))
	}
	fmt.Fprintf(&b, "yontem=%s kodlayici=%s", orDash(r.Method), orDash(r.Encoder))
	if r.HWReason != "" {
		fmt.Fprintf(&b, " donanim_kodlayici=%s", clean(r.HWReason))
	}
	b.WriteByte('\n')
	if r.Reason != "" {
		fmt.Fprintf(&b, "neden=%s islem=%s hr=%s\n", clean(r.Reason), clean(r.Op), hex(r.HR))
	}
	return b.String()
}

func orDash(s string) string {
	if s == "" {
		return "-"
	}
	return clean(s)
}

// Log tanılama dosyası. Dir boşsa yazım yapılmaz. Enabled verilmişse her yazımda sorulur ve false ise yazılmaz
// (0.10.2 tur 1: yalnız kalıcı modda — bilgisayar kaydı veya "hatırla" açık; kod modunda AC-108/AC-138 gereği iz
// bırakılmaz). Eşzamanlı Write çağrıları sıralanır.
type Log struct {
	Dir     string
	Max     int64 // 0 → MaxSize
	Enabled func() bool
	mu      sync.Mutex
}

// NewLog main'in kullandığı kurucu: süreç yükseltilmişse (elevated token; CWE-59 — kullanıcı-yazılabilir klasörde
// yönetici yetkisiyle dosya taşıma/oluşturma) veya klasör yoksa nil (log kapalı). persistent kalıcı modu bildirir.
func NewLog(dir string, elevated bool, persistent func() bool) *Log {
	if dir == "" || elevated || persistent == nil {
		return nil
	}
	return &Log{Dir: dir, Enabled: persistent}
}

// ErrReparse yol (veya klasör zincirindeki bir bileşen) bağlantı/reparse noktası, beklenen türde değil ya da yazma
// için açılan dosyanın birden çok bağı var (AC-249, CWE-59); hiçbir şey yazılmaz/taşınmaz/silinmez.
var ErrReparse = errors.New("diag: yol bağlantı/reparse noktası; işlem yapılmadı")

// Mode Dir.Open kipi.
type Mode int

const (
	ModeRead   Mode = iota // var olan dosyayı okuma
	ModeAppend             // sona ekleme (yoksa oluşturur)
	ModeCreate             // yalnız yeni dosya (varsa os.ErrExist)
	ModeLock               // okuma+yazma, yoksa oluşturur; başka handle'larla okuma/yazma paylaşımlı (remember kilit dosyası, P20 G-P20-16)
)

// Write kaydı dosyanın sonuna ekler; sınır aşılacaksa önce mevcut dosya `.1`'e döner. Klasör zinciri, dosya ve dönen
// kopya Dir üzerinden (Windows: handle ile, AC-249) açılır/taşınır; reparse noktasıysa hiçbir şey yazılmaz/taşınmaz.
// Hata çağırana bilgi içindir (akış etkilenmez).
func (l *Log) Write(r Report) error {
	if l == nil || l.Dir == "" {
		return nil
	}
	if l.Enabled != nil && !l.Enabled() {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	limit := l.Max
	if limit <= 0 {
		limit = MaxSize
	}
	rec := r.Format()
	if int64(len(rec)) > limit {
		rec = rec[:limit]
	}
	d, err := OpenDir(l.Dir, true)
	if err != nil {
		return err
	}
	defer d.Close()
	f, err := d.Open(FileName, ModeAppend)
	if err != nil {
		return err
	}
	st, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return err
	}
	if st.Size()+int64(len(rec)) > limit {
		_ = f.Close()
		if err := d.Rename(FileName, OldName); err != nil {
			return err
		}
		if f, err = d.Open(FileName, ModeAppend); err != nil {
			return err
		}
	}
	_, werr := f.WriteString(rec)
	return errors.Join(werr, f.Close())
}
