package input

import (
	"testing"
	"time"
)

// S-P28f-1 / §5.2a localClick beyaz listesi (saf karar; AppKit okuma click_darwin.go).
func TestSP28f1LocalClickWhitelist(t *testing.T) {
	const mark = 0x1234
	press := ClickEvent{Present: true, Type: NSLeftMouseDown, StateID: 1, PID: 0, UserData: 0, At: 10 * time.Second}
	rel := press
	rel.Type, rel.At = NSLeftMouseUp, 10*time.Second+80*time.Millisecond
	now := rel.At + 5*time.Millisecond
	if !localClick(press, rel, now, mark) {
		t.Fatal("gerçek yerel tıklama kabul edilmeli")
	}
	cases := map[string]func(p, r *ClickEvent, n *time.Duration, m *int64){
		"olay yok (AXPress/VoiceOver/performClick:)": func(p, r *ClickEvent, n *time.Duration, m *int64) { *r = ClickEvent{} },
		"basış kaydı yok":                            func(p, r *ClickEvent, n *time.Duration, m *int64) { *p = ClickEvent{} },
		"klavye etkinleştirmesi (keyDown)":           func(p, r *ClickEvent, n *time.Duration, m *int64) { r.Type = 10 },
		"sağ tık":                                    func(p, r *ClickEvent, n *time.Duration, m *int64) { p.Type, r.Type = 3, 4 },
		"bırakma HID durum kaynağı değil":            func(p, r *ClickEvent, n *time.Duration, m *int64) { r.StateID = 0 },
		"basış HID durum kaynağı değil":              func(p, r *ClickEvent, n *time.Duration, m *int64) { p.StateID = 0 },
		"bırakma sentetik (PID)":                     func(p, r *ClickEvent, n *time.Duration, m *int64) { r.PID = 4242 },
		"basış sentetik (PID)":                       func(p, r *ClickEvent, n *time.Duration, m *int64) { p.PID = 4242 },
		"kendi işaretimiz bırakmada":                 func(p, r *ClickEvent, n *time.Duration, m *int64) { r.UserData = mark },
		"kendi işaretimiz basışta":                   func(p, r *ClickEvent, n *time.Duration, m *int64) { p.UserData = mark },
		"bayat bırakma":                              func(p, r *ClickEvent, n *time.Duration, m *int64) { *n = r.At + 2*time.Second },
		"gelecekteki bırakma":                        func(p, r *ClickEvent, n *time.Duration, m *int64) { *n = r.At - time.Millisecond },
		"basış bırakmadan sonra":                     func(p, r *ClickEvent, n *time.Duration, m *int64) { p.At = r.At + time.Millisecond },
		"çok uzun basılı":                            func(p, r *ClickEvent, n *time.Duration, m *int64) { p.At = r.At - 11*time.Second },
		"işaret üretilemedi (fail-closed)":           func(p, r *ClickEvent, n *time.Duration, m *int64) { *m = 0 },
	}
	for name, mut := range cases {
		p, r, n, m := press, rel, now, int64(mark)
		mut(&p, &r, &n, &m)
		if localClick(p, r, n, m) {
			t.Errorf("%s: kabul edildi", name)
		}
	}
}

func TestSP28f1MarkerAndLocalInput(t *testing.T) {
	if marker == 0 {
		t.Fatal("işaret üretilmeli")
	}
	if !LocalInput(0, 0) || LocalInput(0, marker) || LocalInput(777, 0) {
		t.Fatal("yerel girdi: PID 0 ve işaretsiz")
	}
}
