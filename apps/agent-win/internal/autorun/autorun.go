// Package autorun "Windows açılışında başlat" seçeneğidir (AC-253; ADR-0004 r6; mimari-e11 §8d.3, G-P20-1/6/14/15):
// yalnız `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` altında sabit adlı tek REG_SZ değer
// (`NoktaDestek` = `"<exe kanonik yolu>" --tray`). Değer yalnız açık kullanıcı eylemiyle (Enable) yazılır; yükseltilmiş
// süreçte, ağ/çıkarılabilir/geçici/paylaşılan konumda, reparse bileşenli yolda ve başka yerel kullanıcının exe'yi
// veya yolunu değiştirebildiği ACL'de yazılmaz. Verify her normal açılışta, `--tray` açılışında ve tepsiden pencere
// açılışında çağrılır: değerin gösterdiği hedef zayıfsa değer silinir ve sonuç döndürülür (bildirim çağıranın işidir).
// `…\Explorer\StartupApproved\Run` yalnız okunur. Mantık platformdan bağımsızdır (kayıt defteri ve dosya sistemi
// arayüzle enjekte edilir); Windows eşleri registry_windows.go ve inspect_windows.go.
package autorun

import (
	"errors"
	"os"
	"strings"
)

const (
	// ValueName Run değerinin sabit adı.
	ValueName = "NoktaDestek"
	// RunKey HKCU altındaki Run anahtarı.
	RunKey = `Software\Microsoft\Windows\CurrentVersion\Run`
	// ApprovedKey Windows "Başlangıç uygulamaları" ayarının tutulduğu anahtar (yalnız okunur).
	ApprovedKey = `Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run`
	// TrayArg değerdeki tek argüman (G-P20-6).
	TrayArg = "--tray"
)

// Kind kayıt defteri değerinin türü (yalnız REG_SZ kabul edilir; REG_EXPAND_SZ ve diğerleri KindOther).
type Kind uint8

const (
	// KindString REG_SZ.
	KindString Kind = iota + 1
	// KindOther REG_SZ dışı her tür.
	KindOther
)

var (
	// ErrNotFound değer (veya anahtar) yok.
	ErrNotFound = errors.New("autorun: değer yok")
	// ErrBadPath yol Run değerine yazılabilir biçimde değil (UNC, tırnak, sürücü harfsiz).
	ErrBadPath = errors.New("autorun: yol biçimi geçersiz")
)

// Registry HKCU Run ve StartupApproved erişimi.
type Registry interface {
	// Read Run altındaki değeri okur; yoksa ErrNotFound. REG_SZ dışı türde val boş, kind KindOther döner.
	Read(name string) (val string, kind Kind, err error)
	// WriteString Run altına REG_SZ yazar (anahtar yoksa oluşturur).
	WriteString(name, val string) error
	// Delete Run altındaki değeri siler; yoksa nil.
	Delete(name string) error
	// Approved StartupApproved\Run altındaki ikili değeri okur; yoksa ErrNotFound.
	Approved(name string) ([]byte, error)
}

// Prober süreç ve dosya sistemi bilgisi.
type Prober interface {
	// Elevated süreç yükseltilmiş belirteçle mi çalışıyor.
	Elevated() bool
	// Self çalışan exe'nin yolu (çözümlenmemiş; `\\?\` önekli olabilir).
	Self() (string, error)
	// Env geçerli kullanıcı SID'i ve konum kuralları için klasörler.
	Env() (Env, error)
	// Inspect yolu çözümler ve kökten exe'ye her bileşenin sahibini, DACL'ini ve reparse durumunu okur. Dosya yoksa
	// os.ErrNotExist (errors.Is); kanonik yol biçimsizse ErrBadPath.
	Inspect(path string) (Target, error)
}

// Reason etkinleştirme reddinin (veya Verify'da silmenin) nedeni.
type Reason uint8

const (
	// ReasonOK ret yok.
	ReasonOK Reason = iota
	// ReasonElevated süreç yükseltilmiş (yanlış hive / yükseltilmiş kalıcılık).
	ReasonElevated
	// ReasonBadPath UNC, tırnak içeren veya biçimsiz yol ya da bozuk Run değeri.
	ReasonBadPath
	// ReasonNotFixed ağ veya çıkarılabilir sürücü.
	ReasonNotFixed
	// ReasonTempLocation %TEMP%, INetCache, zip geçici klasörü.
	ReasonTempLocation
	// ReasonSharedLocation C:\Users\Public veya %ProgramData% altı.
	ReasonSharedLocation
	// ReasonReparse yol veya bileşenlerinden biri reparse noktası (junction, sembolik bağ, bağlama noktası).
	ReasonReparse
	// ReasonWeakACL başka SID yazabiliyor/silebiliyor/izin değiştirebiliyor veya sahip izinli değil.
	ReasonWeakACL
	// ReasonCheckFailed izinler okunamadı veya tanınmayan ACE (denetlenemeyen hedef reddedilir).
	ReasonCheckFailed
)

const moveHint = "programı İndirilenler'e veya kendi klasörünüze taşıyın"

// Message kullanıcıya gösterilecek açıklama (seçenek pasifken veya değer silindiğinde).
func (r Reason) Message() string {
	switch r {
	case ReasonOK:
		return ""
	case ReasonElevated:
		return "Program yönetici olarak çalışıyor; Windows açılışında başlatma bu durumda açılamaz"
	case ReasonBadPath, ReasonNotFixed:
		return "Program ağ veya çıkarılabilir bir konumdan çalışıyor; " + moveHint
	case ReasonTempLocation:
		return "Program geçici bir klasörden (ör. zip içinden) çalışıyor; " + moveHint
	case ReasonSharedLocation, ReasonWeakACL:
		return "Bu klasöre başka kullanıcılar yazabiliyor; " + moveHint
	case ReasonReparse:
		return "Program bağlantılı bir klasörden çalışıyor; " + moveHint
	default:
		return "Klasör izinleri denetlenemedi; Windows açılışında başlatma kullanılamıyor"
	}
}

// Command Run değerinin verisi: `"<yol>" --tray`.
func Command(path string) string { return `"` + path + `" ` + TrayArg }

// ParseCommand Command biçimindeki veriden yolu çıkarır; biçim tam değilse ok false.
func ParseCommand(s string) (path string, ok bool) {
	rest, found := strings.CutPrefix(s, `"`)
	if !found {
		return "", false
	}
	i := strings.IndexByte(rest, '"')
	if i <= 0 || rest[i+1:] != " "+TrayArg {
		return "", false
	}
	return rest[:i], true
}

// NormalizePath GetFinalPathNameByHandleW(VOLUME_NAME_DOS) çıktısını Run değerine yazılabilir DOS yoluna çevirir:
// `\\?\` öneki atılır; `\\?\UNC\`, başka `\\` biçimleri, tırnak ve `X:\` ile başlamayan yollar ErrBadPath (G-P20-6).
func NormalizePath(p string) (string, error) {
	if rest, ok := strings.CutPrefix(p, `\\?\`); ok {
		p = rest
	}
	if len(p) < 4 || strings.HasPrefix(p, `\\`) || !isDriveLetter(p[0]) || p[1] != ':' || p[2] != '\\' ||
		strings.HasSuffix(p, `\`) || strings.ContainsAny(p, "\"\x00/") || strings.Contains(p, `\\`) {
		return "", ErrBadPath
	}
	for _, r := range p {
		if r < 0x20 {
			return "", ErrBadPath
		}
	}
	return p, nil
}

func isDriveLetter(c byte) bool { return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') }

// Components NormalizePath'ten geçmiş yolun kökten kendisine kadar önekleri: `C:\a\x.exe` → `C:\`, `C:\a`, `C:\a\x.exe`.
func Components(p string) []string {
	out := []string{p[:3]}
	for i := 3; i < len(p); i++ {
		if p[i] == '\\' {
			out = append(out, p[:i])
		}
	}
	return append(out, p)
}

// Manager Run değerinin tek sahibi.
type Manager struct {
	Reg   Registry
	Probe Prober
	// Name boşsa ValueName (Windows testleri geçici ad kullanır).
	Name string
}

func (m *Manager) name() string {
	if m.Name != "" {
		return m.Name
	}
	return ValueName
}

// State ana ekrandaki "Windows açılışında başlat" onay kutusunun durumu.
type State struct {
	// On değer bu exe'yi doğru biçimde (REG_SZ, `"<yol>" --tray`) gösteriyor.
	On bool
	// Other değer var ama başka yolu veya bozuk biçimi gösteriyor (etkinleştirme üzerine yazar).
	Other bool
	// DisabledInWindows Windows ayarlarında (Başlangıç uygulamaları) kapatılmış: "Windows ayarlarında devre dışı".
	DisabledInWindows bool
	// Blocked ReasonOK değilse seçenek pasif, açıklama Blocked.Message().
	Blocked Reason
}

// self kanonik exe hedefini ve ret nedenini döndürür (yükseltilmişlik dahil). İnceleme başarısızsa Target.Path
// normalleştirilmiş Self yoludur (karşılaştırma için).
func (m *Manager) self() (Target, Reason, error) {
	raw, err := m.Probe.Self()
	if err != nil {
		return Target{}, ReasonCheckFailed, err
	}
	p, err := NormalizePath(raw)
	if err != nil {
		return Target{}, ReasonBadPath, nil
	}
	t, reason, err := m.evaluate(p)
	if t.Path == "" {
		t.Path = p
	}
	if m.Probe.Elevated() {
		reason = ReasonElevated
	}
	return t, reason, err
}

// evaluate yolu inceler ve saf kuralı uygular.
func (m *Manager) evaluate(p string) (Target, Reason, error) {
	env, err := m.Probe.Env()
	if err != nil {
		return Target{}, ReasonCheckFailed, err
	}
	t, err := m.Probe.Inspect(p)
	switch {
	case errors.Is(err, ErrBadPath):
		return Target{}, ReasonBadPath, nil
	case err != nil:
		return Target{}, ReasonCheckFailed, err
	}
	return t, Evaluate(t, env), nil
}

// State değeri okur (yazmaz); exe hedefini de denetler (seçenek pasif mi). İnceleme hatası Blocked =
// ReasonCheckFailed ile birlikte döner; kayıt defteri yine okunur.
func (m *Manager) State() (State, error) {
	var st State
	t, reason, ierr := m.self()
	st.Blocked = reason
	val, kind, err := m.Reg.Read(m.name())
	if errors.Is(err, ErrNotFound) {
		return st, ierr
	}
	if err != nil {
		return st, errors.Join(ierr, err)
	}
	p, ok := ParseCommand(val)
	st.On = kind == KindString && ok && strings.EqualFold(p, t.Path)
	st.Other = !st.On
	data, err := m.Reg.Approved(m.name())
	switch {
	case errors.Is(err, ErrNotFound):
	case err != nil:
		return st, errors.Join(ierr, err)
	default:
		st.DisabledInWindows = disabledByWindows(data)
	}
	return st, ierr
}

// disabledByWindows StartupApproved verisinin ilk baytı tekse (0x03, 0x07…) kullanıcı Windows ayarlarından kapatmıştır.
func disabledByWindows(data []byte) bool { return len(data) > 0 && data[0]&1 == 1 }

// Enable açık kullanıcı eylemiyle değeri yazar. Ret durumunda değer yazılmaz ve (yükseltilmiş süreç dışında) bu exe'yi
// gösteren mevcut değer silinir. Değer başka yolu gösteriyorsa ya da REG_SZ değilse üzerine yazılır ("son açan sürüm
// kazanır"). Dönen hata yalnız tanılama içindir; kullanıcıya Reason.Message() gösterilir.
func (m *Manager) Enable() (Reason, error) {
	t, reason, err := m.self()
	if reason == ReasonElevated {
		return reason, nil
	}
	if reason != ReasonOK {
		return reason, errors.Join(err, m.removeIfSelf(t.Path))
	}
	_, kind, err := m.Reg.Read(m.name())
	switch {
	case errors.Is(err, ErrNotFound):
	case err != nil:
		return ReasonOK, err
	case kind != KindString:
		if err := m.Reg.Delete(m.name()); err != nil {
			return ReasonOK, err
		}
	}
	return ReasonOK, m.Reg.WriteString(m.name(), Command(t.Path))
}

// removeIfSelf değer bu exe'yi (veya bozuk biçimi) gösteriyorsa siler; başka geçerli yolu gösteren değere Verify bakar.
func (m *Manager) removeIfSelf(self string) error {
	val, kind, err := m.Reg.Read(m.name())
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if p, ok := ParseCommand(val); ok && kind == KindString && !strings.EqualFold(p, self) {
		return nil
	}
	return m.Reg.Delete(m.name())
}

// Disable değeri siler (yoksa hata yok).
func (m *Manager) Disable() error { return m.Reg.Delete(m.name()) }

// Check Verify sonucu.
type Check struct {
	// Present değer vardı.
	Present bool
	// Removed değer zayıf/bozuk hedef nedeniyle silindi; normal açılışta ana ekran bilgisi, tepside balon
	// "Windows açılışında başlatma kapatıldı (klasör izinleri)".
	Removed bool
	// Missing değerin gösterdiği exe yok (Windows atlar; ana ekran uyarır), değer silinmez.
	Missing bool
	// Reason Removed ise neden.
	Reason Reason
}

// Verify (G-P20-1/15) mevcut değerin gösterdiği hedefi yerel ve ağsız olarak yeniden denetler; zayıfsa değeri siler.
// Değer yoksa hiçbir şey yapmaz. Yükseltilmişlik burada ret nedeni değildir (hedefin izinleri süreçten bağımsızdır).
func (m *Manager) Verify() (Check, error) {
	val, kind, err := m.Reg.Read(m.name())
	if errors.Is(err, ErrNotFound) {
		return Check{}, nil
	}
	if err != nil {
		return Check{}, err
	}
	c := Check{Present: true}
	p, ok := ParseCommand(val)
	if ok {
		if np, nerr := NormalizePath(p); nerr != nil || np != p {
			ok = false
		}
	}
	if kind != KindString || !ok {
		c.Reason = ReasonBadPath
		return m.remove(c, nil)
	}
	_, reason, ierr := m.evaluate(p)
	if errors.Is(ierr, os.ErrNotExist) {
		c.Missing = true
		return c, nil
	}
	if reason == ReasonOK {
		return c, nil
	}
	c.Reason = reason
	return m.remove(c, ierr)
}

func (m *Manager) remove(c Check, cause error) (Check, error) {
	if err := m.Reg.Delete(m.name()); err != nil {
		return c, errors.Join(cause, err)
	}
	c.Removed = true
	return c, cause
}
