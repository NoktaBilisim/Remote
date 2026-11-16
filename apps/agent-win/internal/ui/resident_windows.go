//go:build windows

package ui

import (
	"image"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/win"
)

const swRestore = 9

// SystemLogo gömülü Nokta amblemi (tepsi simgesi; exe'de simge kaynağı yok). Çözülemezse nil.
func SystemLogo() image.Image { return systemLogo() }

// ResetScope P20 K5 (G-P20-5): yerleşik süreçte her pencere kapsamının başında ve sonunda çağrılır; bekler. Önceki
// kapsamın tüm pencereleri (son ekran, oturum, gösterge, işaretleme katmanı, diyaloglar) kapanır, oturuma ait UI
// durumu (teknisyen adı, kontrol izni, pencere paylaşımı, kabul anahtarı, son ekran notu) sıfırlanır, bekleyen kullanıcı
// olayları atılır; izin kapısı ve kapatma kısayolu etiketi bu kapsamınkiyle değişir (gate nil olabilir: kapsam sonu).
// Süreç ömürlü olanlar (tema, sürüm satırı, yükseltilmişlik, sohbet balonu işlevi) korunur.
func (u *UI) ResetScope(gate *control.Gate, hotkey string) {
	done := make(chan struct{})
	u.t.Do(func() {
		defer close(done)
		u.teardownSession()
		closeDlg(u.reqAccept)
		for _, f := range u.t.forms {
			f.destroy()
		}
		u.lobby, u.sess, u.offer, u.offerFID, u.ended, u.endNote = nil, nil, nil, "", nil, ""
		u.ctlDlg, u.monDlg, u.granted, u.techName, u.windowShare, u.fileServer = nil, nil, false, "", false, false
		u.printDlg, u.printPID = nil, ""
		u.reqForm, u.reqWait, u.reqAccept, u.reqAcceptKey = nil, nil, nil, acceptKey{}
		u.gate, u.hotkeyLabel = gate, hotkey
		drain(u.events)
		drain(u.reqEvents)
		drain(u.reqChat)
	})
	<-done
}

func drain[T any](ch chan T) {
	for {
		select {
		case <-ch:
		default:
			return
		}
	}
}

// Raise tepsiden "Aç" pencere açıkken: kapsamın görünür penceresi öne gelir (simge durumundaysa geri yüklenir).
func (u *UI) Raise() {
	u.t.Do(func() {
		var pick uintptr
		for h, f := range u.t.forms {
			if !f.themed || !windows.IsWindowVisible(windows.HWND(h)) {
				continue
			}
			if pick == 0 || (u.sess != nil && h == u.sess.f.h) {
				pick = h
			}
		}
		if pick == 0 {
			return
		}
		if win.IsIconic(pick) {
			win.ShowWindow(pick, swRestore)
		}
		win.SetForegroundWindow(pick)
	})
}

// EndSession tepsiden "Çık" (onaylandıktan sonra): süren oturum kullanıcı bitirmiş gibi sonlanır (session.end).
// Oturum yoksa olay ResetScope'ta atılır.
func (u *UI) EndSession() { u.emit(flow.Event{Kind: flow.EvEnd}) }
