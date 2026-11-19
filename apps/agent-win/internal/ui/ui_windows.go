//go:build windows

package ui

import (
	"context"
	"fmt"
	"strings"

	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/request"
	"remote-support/agent-win/internal/ui/uicore"
	"remote-support/agent-win/internal/win"
)

const appTitle = "Nokta Destek"

// Denetim kimlikleri. IDOK (1) Enter'ın, IDCANCEL (2) Esc'in tetiklediği komuttur.
const (
	idOK         = win.IDOK
	idCancel     = win.IDCANCEL
	idAbuse      = 20
	idConsent    = 21
	idName       = 22
	idChatInput  = 30
	idFileCancel = 31
	idEndSession = 32
	idGrant      = 41
	idCtlClose   = 42
	idClipSwitch = 43
	idRecStop    = 44
	idRecConsent = 45
	timerTopmost = 2
)

// UI flow.UI'nin Win32 uygulaması.
type UI struct {
	t      *thread
	events chan flow.Event
	footer string

	lobby *form
	sess  *sessionWin
	// endNote AC-187: oturum sonu ekranında gösterilecek kayıt değişikliği bilgisi (EndedNote).
	endNote  string
	offer    *consentDlg // dosya teklifi (ortak izin diyaloğu, S7-5)
	offerFID string
	ind      *indicator
	ov       *overlay
	ended    *form
	// strip P28e kayıt şeridi (rec_windows.go; S-P28e-12).
	strip *recStrip

	// P28d sesli görüşme (voice_windows.go): kabul diyaloğu ve callId'si, gösterge şeridi, son çizilen durum, tepsi
	// göstergesi/balon işlevleri (süreç ömrü; SetVoiceTray).
	voiceDlg     *consentDlg
	voiceAskID   string
	vstrip       *recStrip
	voiceOn      bool
	voiceMuted   bool
	voiceTray    func(on, muted bool)
	voiceBalloon func(text string)
	licenses     *form

	// P7
	gate     *control.Gate
	techName string
	ctlDlg   *consentDlg
	monDlg   *consentDlg
	granted  bool
	// hotkeyLabel kaydedilen kapatma kısayolu; boşsa kontrol izni verilemez (G-21).
	hotkeyLabel string
	// elevated istemci yönetici olarak çalışıyor (S7-9): oturum penceresinde ve kontrol diyaloğunda uyarı.
	elevated bool
	// windowShare AC-248: müşteri "Yalnız bir pencere" seçti (gösterge metni, işaretleme katmanı yok).
	windowShare bool
	// fileServer P28b: oturumun dosya modu SERVER (ilk hello'da bir kez; oturum penceresinde AC-363 satırı).
	fileServer bool
	// P28a yazdırma onay diyaloğu (print_windows.go) ve onun pid'i.
	printDlg *consentDlg
	printPID string

	// P8b-2 talep modu (request_windows.go)
	reqEvents chan request.UserAction
	reqForm   *reqForm
	reqWait   *reqWait
	reqAccept *consentDlg
	// reqAcceptKey açık onay diyaloğunun teknisyen adı + doğrulama kodu (S8b2-3, S8b2-4).
	reqAcceptKey uicore.AcceptKey
	// P20 K6 talep sohbeti (chat_windows.go): "Gönder" metinleri ve tepsideyken gövdesiz balon.
	reqChat        chan string
	reqChatBalloon func(text string)
}

type sessionWin struct {
	f        *form
	watch    *ctrl
	status   *ctrl
	history  *ctrl
	input    *ctrl
	fileLbl  *ctrl
	fileBtn  *ctrl
	endBtn   *ctrl
	sendBtn  *ctrl
	grantBtn *ctrl
	closeBtn *ctrl
	hotkey   *ctrl
	// P28a pano anahtarı (D-P28a-1): clipOn mantıksal durum; görünüm yalnız ondan yazılır.
	clipChk     *ctrl
	clipOn      bool
	clipEnabled bool
	// P28e kayıt göstergesi, "Kaydı durdur" ve bilgi satırı (rec_windows.go); kayıt yokken gizli.
	recLbl, recBtn, recNote *ctrl
	// P28d ses satırı (voice_windows.go); görüşme yokken gizli.
	voiceLbl, voiceMute, voiceEnd *ctrl
	// P28c bağlı teknisyen satırları (roster_windows.go); roster gelene kadar gizli.
	techs [rosterRows]rosterRow
	// P22-G oturum sohbeti (chat_windows.go): durum satırı, son çizilen görünüm sürümü, giriş etkin mi.
	chatNote *ctrl
	chatRev  int
	chatOn   bool
	unread   int
	active   bool
	finished bool
}

// New UI iş parçacığını başlatır. footer "Hakkında" satırıdır (alan adı + sürüm + parmak izi, AC-128). gate izin
// kapısıdır: "Kontrolü kapat" onu UI iş parçacığında, akışı beklemeden kapatır (AC-101).
func New(host, version, fingerprint string, gate *control.Gate) (*UI, error) {
	t, err := startThread(version)
	if err != nil {
		return nil, err
	}
	return &UI{t: t, events: make(chan flow.Event, 16), gate: gate, reqEvents: make(chan request.UserAction, 8),
		reqChat: make(chan string, 4),
		footer:  fmt.Sprintf("Sunucu: %s  ·  Sürüm %s  ·  Parmak izi %s", host, version, fingerprint)}, nil
}

// Events kullanıcı olayları (flow.Deps.Events).
func (u *UI) Events() <-chan flow.Event { return u.events }

func (u *UI) emit(e flow.Event) {
	select {
	case u.events <- e:
	default:
	}
}

// Close tüm pencereleri kapatır.
func (u *UI) Close() { u.t.Quit() }

// ShowError başlangıç hatası (UI iş parçacığı gerekmez).
func ShowError(msg string) {
	win.MessageBox(0, msg, appTitle, win.MB_OK|win.MB_ICONERROR|win.MB_TOPMOST)
}

func primaryWork() win.RECT {
	for _, m := range win.Monitors() {
		if m.Primary {
			return m.Work
		}
	}
	return win.WorkAreaAt(win.CursorPos())
}

func crlf(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, "\r\n", "\n"), "\n", "\r\n")
}

// await UI iş parçacığındaki ekranın sonucunu bekler; bağlam biterse zero döner (ekran açık kalır).
func await[T any](ctx context.Context, ch <-chan T, zero T) T {
	select {
	case r := <-ch:
		return r
	case <-ctx.Done():
		return zero
	}
}

// textResult metin + onay sonucu (AskCode kodu, Welcome adı).
type textResult struct {
	text string
	ok   bool
}

// closeLobby bekleme odası / bağlanıyor penceresi açıksa kapanır.
func (u *UI) closeLobby() {
	if u.lobby != nil {
		u.lobby.destroy()
		u.lobby = nil
	}
}
