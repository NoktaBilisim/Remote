package helper

import (
	"bufio"
	"context"
	"errors"
	"io"
	"sync"
	"time"

	"remote-support/agent-win/internal/servis/helperio"
)

// Durum borusunun yardımcı ucu (mimari-p28u §7.4, D-P28u-1, K-P28u-19). Servis okuyucusu olay × durum tablosunu
// uygular ve beklenmeyen olayda yardımcıyı sonlandırır; bu uç yalnız tablonun kabul ettiği olayları üretir:
// `consent` bir kez (yalnız Consent=="ask"), `control` yalnız değer değişiminde (başlangıç değeri off, yazılmaz),
// `lock` yalnız servisin gönderdiği komut kimliğiyle.

type statusPipe struct {
	mu      sync.Mutex
	w       io.Writer
	control bool
}

func newStatusPipe(w io.Writer) *statusPipe {
	if w == nil {
		w = io.Discard
	}
	return &statusPipe{w: w}
}

func (s *statusPipe) send(st helperio.Status) error {
	b, err := helperio.EncodeStatus(st)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err = s.w.Write(b)
	return err
}

func (s *statusPipe) consent(decision string, ms int) error {
	return s.send(helperio.Status{Ev: "consent", Decision: decision, Ms: &ms})
}

// setControl değer değiştiyse `control` olayı yazar; değişim olduysa true.
func (s *statusPipe) setControl(on bool) bool {
	s.mu.Lock()
	if s.control == on {
		s.mu.Unlock()
		return false
	}
	s.control = on
	s.mu.Unlock()
	_ = s.send(helperio.Status{Ev: "control", On: &on}) // boru koptuysa servis yardımcıyı zaten sonlandırır
	return true
}

func (s *statusPipe) lock(id string, ok bool, reason string) {
	_ = s.send(helperio.Status{Ev: "lock", ID: id, Ok: &ok, Reason: reason})
}

// Locker oturumu kilitleme yolu (AC-443). Varsayılan: yardımcıda LockWorkStation (stationLocker). K-P28u-5b geri dönüşü
// gerekirse (K6s elle ölçümü) kilit servise taşınır ve yardımcıya `lock` komutu hiç gelmez; arayüz değiştirilebilir.
type Locker interface {
	Lock(ctx context.Context) (ok bool, reason string)
}

// stationLocker LockWorkStation çağırır ve giriş masaüstünün ≤ wait içinde `Winlogon` olmasını bekler (§7.5).
type stationLocker struct {
	lock     func() error
	desktop  func() (string, error)
	wait     time.Duration
	interval time.Duration
}

// lockWait §7.5 / AC-443: kilit ≤ 2 sn içinde görülmeli.
const lockWait = 2 * time.Second

func (l stationLocker) Lock(ctx context.Context) (bool, string) {
	if l.lock() != nil {
		return false, helperio.ReasonNotLocked
	}
	interval := l.interval
	if interval <= 0 {
		interval = 100 * time.Millisecond
	}
	deadline := time.NewTimer(l.wait)
	defer deadline.Stop()
	tick := time.NewTicker(interval)
	defer tick.Stop()
	for {
		if name, err := l.desktop(); err == nil && name == "Winlogon" {
			return true, ""
		}
		select {
		case <-ctx.Done():
			return false, helperio.ReasonNotLocked
		case <-deadline.C:
			return false, helperio.ReasonNotLocked
		case <-tick.C:
		}
	}
}

// serveCommands giriş borusunun komut satırlarını işler (tek bekleyen komut; sırayla). EOF/okuma hatası döngüyü
// bitirir (oturum sürer); bozuk satır atlanır. Locker yoksa kilit `not_locked` yanıtlanır.
func serveCommands(ctx context.Context, br *bufio.Reader, lk Locker, st *statusPipe) {
	for ctx.Err() == nil {
		c, err := helperio.ReadCommand(br)
		if errors.Is(err, helperio.ErrInvalid) {
			continue
		}
		if err != nil {
			return
		}
		ok, reason := false, helperio.ReasonNotLocked
		if lk != nil {
			ok, reason = lk.Lock(ctx)
		}
		st.lock(c.ID, ok, reason)
	}
}
