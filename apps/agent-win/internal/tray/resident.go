package tray

import (
	"context"
	"time"

	"remote-support/agent-win/internal/autorun"
	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/remember"
	"remote-support/agent-win/internal/signal"
)

// IsTrayLaunch G-P20-6: `--tray` yalnız tek ve tam argümanken; `/tray`, `--tray=…`, ek argüman → normal açılış.
func IsTrayLaunch(args []string) bool { return len(args) == 2 && args[1] == autorun.TrayArg }

// Eligible tepsi koşulu (katı): dosya okundu, gömülü kökende en az bir kayıt var ve tepsi tercihi açık. Normal açılışta
// X ile tepsiye inme kararı buna göredir (okunamayan dosyada tepsiye inilmez).
func Eligible(r remember.LoadResult, origin string) bool {
	return r.Status == remember.StatusOK && r.Data.Prefs != nil && r.Data.Prefs.Tray && len(r.Data.ForOrigin(origin)) > 0
}

// Keep yerleşik süreç tepside kalmalı mı: Eligible ya da dosya geçici olarak okunamıyor (G-P20-3: "kayıt yok" kararı
// verilmez, Run korunur).
func Keep(r remember.LoadResult, origin string) bool {
	return r.Status == remember.StatusUnreadable || Eligible(r, origin)
}

// AutorunBalloon Verify sonucunun balon metni: değer silinmediyse "", eksik exe (S-P20-K1) için "program bulunamadı",
// diğer silmelerde "klasör izinleri" (G-P20-15). Balon sabit metindir, yol taşımaz.
func AutorunBalloon(c autorun.Check) string {
	switch {
	case !c.Removed:
		return ""
	case c.Reason == autorun.ReasonMissing:
		return BalloonAutorunMissing
	default:
		return BalloonAutorunOff
	}
}

// StartMode `--tray` açılış kararı (ağsız; mimari-e11 §8d.3).
type StartMode int

const (
	// StartResident simge eklenir; pencere ve ağ isteği yok, kullanıcı komutu beklenir.
	StartResident StartMode = iota
	// StartDisable kayıt yok ya da tepsi tercihi kapalı: Run değeri silinir, süreç çıkar.
	StartDisable
	// StartQuit yükseltilmiş süreç (K-P20-8): tepsi yok, kayıt defterine dokunulmaz (yanlış hive olabilir), çıkış.
	StartQuit
)

// DecideStart `--tray` açılışı. hasStore=false: LocalAppData yok (kayıt tutulamaz).
func DecideStart(r remember.LoadResult, origin string, hasStore, elevated bool) StartMode {
	switch {
	case elevated:
		return StartQuit
	case hasStore && Keep(r, origin):
		return StartResident
	}
	return StartDisable
}

// IconAPI tepsi simgesi (Windows'ta *Icon; testte sahte).
type IconAPI interface {
	Commands() <-chan Command
	SetTip(text string)
	Balloon(text string)
	Confirm(text string) bool
	Close()
}

// Scope tek pencere kapsamı (G-P20-5). Süreç ömürlü olan yalnız UI çerçevesi, tepsi, Store ve api.Client'tır; her
// Session yeni izin kapısı (kapalı başlar), yeni global kısayol/kanca (yalnız kapsam süresince) ve yeni akış
// bağımlılıklarıyla (Run içinde kurulur) çalışır, sonunda hepsini bırakır.
type Scope struct {
	// Hotkey kapatma kısayolunu ve kapıya bağlı yerel öncelik kancalarını kurar (input.Start); stop kaldırır.
	Hotkey func(gate *control.Gate) (label string, stop func())
	// Reset UI'yi kapsama hazırlar ve kapsam sonunda temizler (ui.ResetScope; gate nil = kapsam sonu).
	Reset func(gate *control.Gate, hotkey string)
	// Run açılış akışını yürütür (launch.Run). first: normal açılışın ilk kapsamı — dosya adı yalnız burada
	// değerlendirilir; `--tray` ve tepsiden açılışta değerlendirilmez. active oturum başlayınca çağrılır.
	Run func(ctx context.Context, first bool, gate *control.Gate, hotkey string, active func()) flow.Outcome
	// Ended son ekran (AC-107/187); ardından CloseDelay kadar (veya ctx bitene dek) beklenir.
	Ended      func(out flow.Outcome)
	CloseDelay time.Duration
	// Idle kapsam sonu: bağlantı havuzu kapatılır (CloseIdleConnections).
	Idle func()
}

// Session bir kapsamı baştan sona yürütür.
func (s Scope) Session(ctx context.Context, first bool, active func()) {
	gate := &control.Gate{}
	label, stop := s.Hotkey(gate)
	s.Reset(gate, label)
	out := s.Run(ctx, first, gate, label, active)
	if out.Message != (flow.Message{}) {
		s.Ended(out)
		t := time.NewTimer(s.CloseDelay)
		select {
		case <-ctx.Done():
		case <-t.C:
		}
		t.Stop()
	}
	gate.Close()
	stop()
	s.Reset(nil, "")
	if s.Idle != nil {
		s.Idle()
	}
}

// Resident yerleşik süreç döngüsü (mimari-e11 §8d.3; AC-253, K-P20-7 AC-107 istisnası).
type Resident struct {
	Scope Scope
	// StartTray tek örnek mutex'ini alır ve simgeyi ekler; alınamazsa (aynı kullanıcının başka tepsi örneği) false —
	// G-P20-13: bu süreç tepsiye inmez, bugünkü gibi kapanır.
	StartTray func() (IconAPI, bool)
	// State kayıt dosyasının güncel durumu ve gömülü köken (kapsam içinde tercih/kayıt değişebilir).
	State  func() remember.LoadResult
	Origin string
	// Verify tepsiden pencere açılışında Run denetimi (G-P20-15, ağsız); değer silindiyse balon metni (AutorunBalloon),
	// silinmediyse "".
	Verify func() string
	// Disable tepsi koşulu kalmadığında Run değerini siler (idempotent).
	Disable func()
	// Raise açık kapsamın penceresini öne getirir; EndSession süren oturumu kullanıcı bitirmiş gibi sonlandırır.
	Raise      func()
	EndSession func()
	// Elevated yükseltilmiş süreç: tepsi yok (K-P20-8).
	Elevated bool
	// ExitGrace "Çık" sonrası oturumun session.end ile kapanması için beklenen süre; sonra bağlam iptal edilir.
	ExitGrace time.Duration
}

// RunNormal normal açılış: ilk kapsam dosya adıyla; bittiğinde (X, oturum sonu) koşullar sağlanıyorsa ve mutex
// alınabiliyorsa süreç tepsiye iner (bir kez balon), değilse döner (AC-107: çıkış). Dosya türünden (firma dosyası, kod
// dosyası, yeniden adlandırılmış) bağımsızdır (tek ekran kararı 2026-11-15); kod oturumu bitince de aynı kural.
func (r Resident) RunNormal(ctx context.Context) {
	r.scope(ctx, nil, true)
	if ctx.Err() != nil || r.Elevated || !Eligible(r.State(), r.Origin) {
		return
	}
	ic, ok := r.StartTray()
	if !ok {
		return
	}
	ic.Balloon(BalloonResident)
	r.loop(ctx, ic)
}

// RunTray `--tray` açılışı: simge eklenmiştir; pencere ve ağ isteği ilk kullanıcı komutuna kadar yok. balloon boş
// değilse (Run zayıf izin nedeniyle silindi) bir kez gösterilir.
func (r Resident) RunTray(ctx context.Context, ic IconAPI, balloon string) {
	if balloon != "" {
		ic.Balloon(balloon)
	}
	r.loop(ctx, ic)
}

func (r Resident) loop(ctx context.Context, ic IconAPI) {
	defer ic.Close()
	for {
		select {
		case <-ctx.Done():
			return
		case c := <-ic.Commands():
			if c == CmdExit {
				return
			}
			if r.Verify != nil {
				if b := r.Verify(); b != "" {
					ic.Balloon(b)
				}
			}
			if r.scope(ctx, ic, false) {
				return
			}
			if !Keep(r.State(), r.Origin) { // son firma unutuldu / tepsi kapatıldı: tepsi kapanır, süreç biter
				if r.Disable != nil {
					r.Disable()
				}
				return
			}
		}
	}
}

// scope bir kapsamı yürütür; kapsam sürerken tepsi komutlarını da işler ("Aç" → öne getir, "Çık" → onay → oturum
// biter → çıkış). true: süreç çıkmalı.
func (r Resident) scope(ctx context.Context, ic IconAPI, first bool) bool {
	sctx, cancel := context.WithCancel(ctx)
	defer cancel()
	done := make(chan struct{})
	active := func() {}
	var cmds <-chan Command
	if ic != nil {
		cmds = ic.Commands()
		active = func() { ic.SetTip(TipSession) }
	}
	go func() {
		defer close(done)
		r.Scope.Session(sctx, first, active)
	}()
	for {
		select {
		case <-done:
			if ic != nil {
				ic.SetTip(Tip)
			}
			return false
		case <-ctx.Done():
			<-done
			return true
		case c := <-cmds:
			if c == CmdOpen {
				r.Raise()
				continue
			}
			if !ic.Confirm(ExitConfirm) {
				continue
			}
			r.EndSession()
			t := time.NewTimer(r.ExitGrace)
			select {
			case <-done:
			case <-t.C:
			}
			t.Stop()
			cancel()
			<-done
			return true
		}
	}
}

// WithActive flow arayüzünü sarar: oturum başladığında (Active) active çağrılır (tepsi ipucu "oturum sürüyor").
// P28e: akışın d.UI'den tür iddiasıyla aradığı isteğe bağlı arayüz (flow.RecUI) iç arayüzde varsa sarmalayıcı da
// onu iletir; yoksa iletmez (göstergesi çizilemeyen arayüzde rec1 bildirilmez, K-P28e-7).
func WithActive(ui flow.UI, active func()) flow.UI {
	if active == nil {
		return ui
	}
	a := activeUI{UI: ui, active: active}
	if r, ok := ui.(flow.RecUI); ok {
		return activeRecUI{activeUI: a, RecUI: r}
	}
	return a
}

// activeRecUI activeUI + iç arayüzün flow.RecUI'si.
type activeRecUI struct {
	activeUI
	flow.RecUI
}

type activeUI struct {
	flow.UI
	active func()
}

func (a activeUI) Active(techName string, mon signal.Monitor) {
	a.UI.Active(techName, mon)
	a.active()
}
