// Package helper gözetimsiz erişimin yardımcı sürecidir (`NoktaDestekServis.exe --helper`, P27 K6; mimari-p27 §5.2,
// §5.5, §5.6). Servis onu SYSTEM jetonunun kısıtlı kopyasıyla konsol oturumunda başlatır; girdi (bilet dahil) yalnız
// devralınan borudan gelir (internal/servis/helperio). Sıra kesindir: süreç kimliği denetimi → girdi → gösterge tüm
// monitörlerde çizilip doğrulanır → ancak sonra `/ws/guest` (mevcut flow oturumu, bilet yolu). Kullanıcı arayüzü yoktur:
// kontrol isteği anında GRANTED{UNATTENDED}, dosya teklifi ve monitör isteği otomatik kabul. Gösterge dışında pencere,
// diyalog, URL/e-posta açma yoktur (derleme sınırı: boundary_test.go, AC-341; pencere sınıfları windows_test.go). Çıkış
// kodu bitiş nedenidir. P28u: giriş borusunun sonraki satırları servis komutlarıdır (kilit, kayıt eki); durum borusuna
// kontrol/kilit olayları yazılır. r3 (mimari-p28u §r3, K-P28u-r3-1): onay diyaloğu yoktur — bağlantı cihaz kullanıcısına
// sorulmadan açılır; gösterge çizilemezse bağlantı açılmaz (AC-294/AC-438, fail-closed).
package helper

import (
	"bufio"
	"context"
	"io"
	"sync/atomic"
	"time"

	"remote-support/agent-win/internal/desktop"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/servis/helperio"
)

// Indicator AC-294 göstergesi (her monitörde kırmızı kenarlık + üst-orta etiket, kapatılamaz, her zaman üstte).
type Indicator interface {
	// Failed oturum sırasında gösterge yeniden doğrulanamadığında (pencere kayboldu, monitör değişimi sonrası
	// çizilemedi) kapanır.
	Failed() <-chan struct{}
	// Desktop göstergenin çizildiği giriş masaüstü (K6b; Default / Winlogon …).
	Desktop() string
	Close()
}

// Deps yardımcının bağımlılıkları (Windows: main_windows.go; Linux testte sahteler).
type Deps struct {
	// ShowIndicator göstergeyi o anki giriş masaüstünde, tüm monitörlerde çizer ve doğrular; hata → bağlantı hiç
	// açılmaz (fail-closed). Masaüstü değişiminde (K6b) yeniden çağrılır.
	ShowIndicator func(text string) (Indicator, error)
	// InputDesktop giriş masaüstünün adı (Windows: desktop.InputName); 250 ms'de bir yoklanır.
	InputDesktop func() (string, error)
	// Gate yakalama/girdi masaüstü kapısı (Windows: girdi enjektörü de aynı kapıya bakar). nil → yeni kapı.
	Gate *desktop.Gate
	// Resumed kapı doğrulamadan sonra açılınca (Windows: Applier.ReleaseAll — geçişte düşen bırakma olayları).
	Resumed func()
	// FollowInterval / FollowTimeout masaüstü yoklama aralığı ve doğrulama bütçesi; 0 → 250 ms / 2 sn.
	FollowInterval, FollowTimeout time.Duration
	// Flow oturum bağımlılıkları (Dial, NewPeer, Monitors, Capture, Input, DownloadDir, CheckDir, MOTW …). UI, Events,
	// Unattended, Hotkey, Admitted ve kullanıcıya dönük alanları Run doldurur/boşaltır.
	Flow flow.Deps
	// Status durum borusunun yazma ucu (yardımcı → servis); nil → atılır (yalnız test).
	Status io.Writer
	// Commands giriş borusunun Input'tan sonraki kısmı (komut satırları); nil → komut yok.
	Commands *bufio.Reader
	// Locker kilit yolu (AC-443); nil → `lock` komutu not_locked yanıtlanır.
	Locker Locker
	// EndGrace gösterge hatasında `session.end` sonrası akışın kendiliğinden bitmesi için beklenen süre; dolarsa bağlam
	// kesilir. 0 → DefaultEndGrace.
	EndGrace time.Duration
}

// DefaultEndGrace gösterge hatasından sonra en geç bu sürede oturum biter (AC-342'deki 2 sn bütçesinin kalanı).
const DefaultEndGrace = time.Second

// eventBuffer otomatik kararların akış döngüsüne iletildiği kanalın kapasitesi.
const eventBuffer = 16

// Run göstergeyi açar ve doğrular, sonra bilet yoluyla oturumu yürütür. Dönen değer çıkış kodudur (helperio.Exit*).
func Run(ctx context.Context, d Deps, in helperio.Input) uint32 {
	st := newStatusPipe(d.Status)
	if in.Consent == "" { // P27 girdisi (eski sunucu): servis durum tablosu yok; boruya hiçbir olay yazılmaz
		st = newStatusPipe(nil)
	}
	ind, err := d.ShowIndicator(helperio.IndicatorLabel(in.IndicatorText, in.Recording))
	if err != nil || ind == nil {
		return helperio.ExitIndicatorFailed // AC-294 / AC-438 / AC-448 (ek çizilemedi): `/ws/guest` çağrılmadı
	}
	live := newLive(ind, in.IndicatorText, in.Recording)
	defer live.Close()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	if d.Gate == nil {
		d.Gate = desktop.NewGate()
	}
	follow(ctx, d, live) // K6b: masaüstü değişiminde önce durdur → gösterge doğrula → devam
	if d.Commands != nil {
		go serveCommands(ctx, d.Commands, d.Locker, st, live)
	}
	events := make(chan flow.Event, eventBuffer)
	ui := newHeadless(ctx, events)
	ui.st, ui.live, ui.techName = st, live, in.TechName
	var admitted, indFailed atomic.Bool
	fd := unattendedDeps(gatedFlow(d.Flow, d.Gate), ui, events, func() { admitted.Store(true) })
	go watchIndicator(ctx, live.Failed(), &indFailed, ui, cancel, grace(d.EndGrace))
	out := flow.RunTicket(ctx, fd, in.Ticket, in.TechName, "")
	return exitCode(indFailed.Load(), admitted.Load(), out)
}

// unattendedDeps akış bağımlılıklarını gözetimsiz kipe getirir: arayüz yok, kısayol yok, kayıt/logo/pencere modu yok.
func unattendedDeps(d flow.Deps, ui flow.UI, events chan flow.Event, admitted func()) flow.Deps {
	d.UI, d.Events, d.Unattended, d.Hotkey, d.Admitted = ui, events, true, "", admitted
	if r, ok := ui.(flow.RosterUI); ok { // P28c: gösterge adları (multi1)
		d.RosterUI = r
	}
	d.API, d.Logo, d.Binding = nil, nil, nil
	d.WindowCapture, d.CaptureWindow, d.SetInputWindow = nil, nil, nil // birincil monitör; pencere seçimi yok
	return d
}

func grace(d time.Duration) time.Duration {
	if d <= 0 {
		return DefaultEndGrace
	}
	return d
}

// watchIndicator gösterge oturum sırasında doğrulanamazsa oturumu `session.end` ile bitirir; akış grace içinde
// bitmezse bağlamı keser.
func watchIndicator(ctx context.Context, failed <-chan struct{}, flag *atomic.Bool, ui *headless,
	cancel context.CancelFunc, grace time.Duration) {
	select {
	case <-ctx.Done():
		return
	case <-failed:
	}
	flag.Store(true)
	ui.push(flow.Event{Kind: flow.EvEnd})
	t := time.NewTimer(grace)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
		cancel()
	}
}

// exitCode akış sonucunun çıkış kodu. Katılım (hello) öncesi bağlantı/protokol hatası helper_failed (servis
// `connect.result{ok:false}` gönderir); katılım sonrası her bitiş olağan bitiştir (sunucu oturumu zaten yönetir).
func exitCode(indicatorFailed, admitted bool, out flow.Outcome) uint32 {
	switch {
	case indicatorFailed:
		return helperio.ExitIndicatorFailed
	case out.Failed && !admitted:
		return helperio.ExitHelperFailed
	}
	return helperio.ExitEnded
}
