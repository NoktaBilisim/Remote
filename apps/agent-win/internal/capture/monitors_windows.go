//go:build windows

// Package capture ekran yakalama (DXGI Desktop Duplication) ve H.264 kodlamadır (Media Foundation), CGO'suz COM
// vtable çağrılarıyla (ADR-0004, K4). Monitör kimliği EnumDisplayMonitors sırasının 1 tabanlı indeksidir; aynı kimlik
// share.state, gösterge/işaretleme katmanı ve DXGI çıkışı eşlemesinde kullanılır.
package capture

import (
	"fmt"

	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/win"
)

const maxMonitors = 16

// Monitors share.state için monitör listesi (AC-106).
func Monitors() ([]signal.Monitor, error) {
	ms := win.Monitors()
	if len(ms) == 0 {
		return nil, fmt.Errorf("capture: monitör bulunamadı")
	}
	out := make([]signal.Monitor, 0, len(ms))
	for i, m := range ms {
		if i == maxMonitors {
			break
		}
		w, h := int(m.Rect.Right-m.Rect.Left), int(m.Rect.Bottom-m.Rect.Top)
		out = append(out, signal.Monitor{ID: i + 1, Name: fmt.Sprintf("Ekran %d", i+1), W: w, H: h, Primary: m.Primary})
	}
	return out, nil
}

// MonitorRect kimliğe göre fiziksel masaüstü dikdörtgeni.
func MonitorRect(id int) (win.RECT, bool) {
	ms := win.Monitors()
	if id < 1 || id > len(ms) {
		return win.RECT{}, false
	}
	return ms[id-1].Rect, true
}
