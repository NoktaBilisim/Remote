//go:build windows

package ui

import (
	"sync"

	"remote-support/agent-win/internal/win"
)

// Panel P27-K7 (gözetimsiz servis ayar penceresi ve kayıt kodu iletişim kutusu; mimari-p27 §5.4): P20 form
// altyapısının (tek UI iş parçacığı, DPI ölçeği, AC-247 tema tablosu, logo kutusu) dışa açık ince kabuğu. Mevcut
// P20 ekranlarını değiştirmez; aynı süreçte New ile birlikte kullanılmaz (servis ikilisi yalnız Panel kullanır).
// Bu dosya MessageBox, dosya seçici, ShellExecute ya da URL açma çağırmaz (K6 derleme sınırı).

// ItemKind panel öğesi türü.
type ItemKind int

const (
	ItemLogo   ItemKind = iota // gömülü Nokta amblemi (logo-surface zemini)
	ItemTitle                  // kalın başlık
	ItemLabel                  // düz metin
	ItemDanger                 // uyarı satırı (danger)
	ItemButton                 // düğme; Default Enter'ın tetiklediği düğmedir
	ItemEdit                   // tek satır metin kutusu (Limit karakter)
)

// Item tek denetim; ölçüler 96 DPI birimindedir.
type Item struct {
	Kind       ItemKind
	ID         int
	Text       string
	X, Y, W, H int32
	Default    bool
	Limit      int
}

// PanelSpec pencere tanımı. Geri çağrılar UI iş parçacığında çalışır.
type PanelSpec struct {
	Title     string
	W, H      int32
	Items     []Item
	Focus     int                    // ilk odak (öğe ID'si; 0: yok)
	OnCommand func(p *Panel, id int) // düğme (IDOK = Enter, IDCANCEL = Esc dahil)
	OnClose   func(p *Panel)         // başlık çubuğu kapatma; nil ise pencere kapanır
	OnTimer   func(p *Panel)         // TimerMS > 0 ise her dilimde
	TimerMS   uint32
}

// Panel açık bir pencere.
type Panel struct {
	t     *thread
	f     *form
	hwnd  uintptr // oluşturulduktan sonra değişmez (UAC sahibi penceresi)
	ctrls map[int]*ctrl
	done  chan struct{}
	once  sync.Once
}

const panelTimer = 7

var (
	panelThreadOnce sync.Once
	panelThread     *thread
	panelThreadErr  error
)

// OpenPanel UI iş parçacığını (gerekirse) başlatır, pencereyi kurar ve ortada gösterir.
func OpenPanel(spec PanelSpec) (*Panel, error) {
	panelThreadOnce.Do(func() { panelThread, panelThreadErr = startThread() })
	if panelThreadErr != nil {
		return nil, panelThreadErr
	}
	p := &Panel{t: panelThread, ctrls: map[int]*ctrl{}, done: make(chan struct{})}
	ready := make(chan struct{})
	p.t.Do(func() { p.build(spec); close(ready) })
	<-ready
	return p, nil
}

func (p *Panel) build(spec PanelSpec) {
	f := p.t.newForm(spec.Title, spec.W, spec.H, false)
	p.f, p.hwnd = f, f.h
	for _, it := range spec.Items {
		if c := p.addItem(it); c != nil && it.ID != 0 {
			p.ctrls[it.ID] = c
		}
	}
	f.command = func(id, code int) {
		if code == win.BN_CLICKED && spec.OnCommand != nil {
			spec.OnCommand(p, id)
		}
	}
	f.close = func() {
		if spec.OnClose != nil {
			spec.OnClose(p)
			return
		}
		p.destroy()
	}
	if spec.TimerMS > 0 && spec.OnTimer != nil {
		f.timer = func(uintptr) { spec.OnTimer(p) }
		win.SetTimer(f.h, panelTimer, spec.TimerMS)
	}
	f.show(win.WorkAreaAt(win.CursorPos()), true, p.ctrls[spec.Focus])
}

func (p *Panel) addItem(it Item) *ctrl {
	f := p.f
	switch it.Kind {
	case ItemLogo:
		return f.picture(systemLogo(), it.X, it.Y, it.W, it.H)
	case ItemTitle:
		return f.label(it.Text, it.X, it.Y, it.W, it.H, fontBold)
	case ItemDanger:
		return f.danger(it.Text, it.X, it.Y, it.W, it.H, fontNormal)
	case ItemButton:
		return f.button(it.Text, it.ID, it.X, it.Y, it.W, it.Default)
	case ItemEdit:
		return f.edit(it.ID, it.X, it.Y, it.W, it.H, win.ES_AUTOHSCROLL, it.Limit)
	}
	return f.label(it.Text, it.X, it.Y, it.W, it.H, fontNormal)
}

// SetText denetim metnini değiştirir (her iş parçacığından; değişmediyse dokunmaz — titreme yok).
func (p *Panel) SetText(id int, s string) {
	p.t.Do(func() {
		if c := p.ctrls[id]; c != nil && p.f.h != 0 && win.GetText(c.h) != s {
			win.SetText(c.h, s)
		}
	})
}

// Show denetimi gösterir ya da gizler (her iş parçacığından).
func (p *Panel) Show(id int, on bool) {
	p.t.Do(func() {
		if c := p.ctrls[id]; c != nil && p.f.h != 0 {
			cmd := win.SW_HIDE
			if on {
				cmd = win.SW_SHOWNORMAL
			}
			win.ShowWindow(c.h, cmd)
		}
	})
}

// Enable denetimi etkinleştirir ya da pasifleştirir (her iş parçacığından).
func (p *Panel) Enable(id int, on bool) {
	p.t.Do(func() {
		if c := p.ctrls[id]; c != nil && p.f.h != 0 {
			win.EnableWindow(c.h, on)
		}
	})
}

// Text metin kutusunun içeriği; yalnız geri çağrı içinden (UI iş parçacığı).
func (p *Panel) Text(id int) string {
	if c := p.ctrls[id]; c != nil && p.f.h != 0 {
		return win.GetText(c.h)
	}
	return ""
}

// Raise pencereyi öne getirir (her iş parçacığından).
func (p *Panel) Raise() {
	p.t.Do(func() {
		if p.f.h != 0 {
			win.ShowWindow(p.f.h, swRestore)
			win.SetForegroundWindow(p.f.h)
		}
	})
}

// Close pencereyi kapatır (her iş parçacığından; birden çok çağrı güvenli).
func (p *Panel) Close() { p.t.Do(p.destroy) }

// Handle pencere tanıtıcısı (UAC iletişim kutusunun sahibi; pencere kapandıktan sonra geçersizdir).
func (p *Panel) Handle() uintptr { return p.hwnd }

// Done pencere kapanınca kapanır.
func (p *Panel) Done() <-chan struct{} { return p.done }

func (p *Panel) destroy() {
	if p.f != nil && p.f.h != 0 {
		win.KillTimer(p.f.h, panelTimer)
		p.f.destroy()
	}
	p.once.Do(func() { close(p.done) })
}
