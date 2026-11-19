package update

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"io"
	"sync"
	"testing"
	"time"
)

// fakeStage bellek içi hazırlık (yer değiştirme sayaçlarıyla).
type fakeStage struct {
	mu                 sync.Mutex
	buf                bytes.Buffer
	committed, aborted bool
	commitErr          error
}

func (s *fakeStage) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.Write(p)
}

func (s *fakeStage) Commit() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.commitErr != nil {
		s.aborted = true
		return s.commitErr
	}
	s.committed = true
	return nil
}

func (s *fakeStage) Abort() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.committed {
		s.aborted = true
	}
}

func (s *fakeStage) state() (bool, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.committed, s.aborted
}

type fakeReplacer struct {
	mu        sync.Mutex
	err       error
	commitErr error
	stages    []*fakeStage
}

func (r *fakeReplacer) Prepare() (Staging, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.err != nil {
		return nil, r.err
	}
	s := &fakeStage{commitErr: r.commitErr}
	r.stages = append(r.stages, s)
	return s, nil
}

func (r *fakeReplacer) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.stages)
}

// harness sahte sunucu: teklif, politika, olay gönderimi ve indirme.
type harness struct {
	mu       sync.Mutex
	offer    *Offer
	checks   int
	policy   Policy
	keys     []string
	polErr   error
	sendErr  error
	sent     [][]Event
	sentKeys [][]string
	dlErr    error
	dlBlock  bool
	downs    int
	notified []string
	tray     bool
	rep      *fakeReplacer
}

func newHarness(t *testing.T, version string) *harness {
	m := baseManifest()
	m.Version = version
	raw, sig := signed("prod-active", m)
	return &harness{offer: &Offer{Manifest: base64.StdEncoding.EncodeToString(raw), Signature: EncodeSignature(sig)},
		policy: PolicyAuto, rep: &fakeReplacer{}}
}

func (h *harness) setOffer(version string) {
	m := baseManifest()
	m.Version = version
	raw, sig := signed("prod-active", m)
	h.mu.Lock()
	h.offer = &Offer{Manifest: base64.StdEncoding.EncodeToString(raw), Signature: EncodeSignature(sig)}
	h.mu.Unlock()
}

func (h *harness) portable(t *testing.T) *Portable {
	return NewPortable(PortableDeps{
		Trust:   prodTrust(),
		Running: windowsClient(t, "0.22.0"),
		Check: func(context.Context) (*Offer, error) {
			h.mu.Lock()
			defer h.mu.Unlock()
			h.checks++
			return h.offer, nil
		},
		Policy: func(context.Context) (Policy, []string, error) {
			h.mu.Lock()
			defer h.mu.Unlock()
			return h.policy, h.keys, h.polErr
		},
		Send: func(_ context.Context, keys []string, ev []Event) error {
			h.mu.Lock()
			defer h.mu.Unlock()
			if h.sendErr != nil {
				return h.sendErr
			}
			h.sent = append(h.sent, ev)
			h.sentKeys = append(h.sentKeys, keys)
			return nil
		},
		Download: func(ctx context.Context, m Manifest, dst io.Writer) error {
			h.mu.Lock()
			h.downs++
			block, err := h.dlBlock, h.dlErr
			h.mu.Unlock()
			if block {
				<-ctx.Done()
				return &DownloadError{Reason: ReasonDownload, Err: ctx.Err()}
			}
			if err != nil {
				return err
			}
			_, werr := dst.Write([]byte("test"))
			return werr
		},
		Replacer: h.rep,
		Link:     "https://destek.example/",
		Notify: func(text string) bool {
			h.mu.Lock()
			defer h.mu.Unlock()
			h.notified = append(h.notified, text)
			return h.tray
		},
		Now: func() time.Time { return testNow },
	})
}

// events gönderilen olayların tür[/neden] listesi.
func (h *harness) events() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	var out []string
	for _, b := range h.sent {
		for _, e := range b {
			s := e.Type
			if e.Reason != "" {
				s += "/" + string(e.Reason)
			}
			out = append(out, s)
		}
	}
	return out
}

func eq(a []string, b ...string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestAC479InstallDeferredUntilSessionEnds(t *testing.T) {
	h := newHarness(t, "0.22.1")
	p := h.portable(t)
	p.Begin() // oturum sürüyor
	p.check(context.Background())
	st := h.rep.stages[0]
	if c, _ := st.state(); c || st.buf.String() != "test" {
		t.Fatal("oturum sürerken indirilip doğrulanmalı ama kurulmamalı")
	}
	if got := h.events(); !eq(got, "available") {
		t.Fatalf("olaylar: %v", got)
	}
	p.End()
	if c, _ := st.state(); !c {
		t.Fatal("oturum bitince kurulmalı")
	}
	p.Close(time.Second)
	if got := h.events(); !eq(got, "available", "installed") {
		t.Fatalf("olaylar: %v", got)
	}
	h.mu.Lock()
	last := h.sent[len(h.sent)-1]
	h.mu.Unlock()
	if e := last[len(last)-1]; e.Version != "0.22.1" || e.FromVersion != "0.22.0" {
		t.Fatalf("installed eski→yeni: %+v", e)
	}
}

func TestAC482ReadyNoticeOnceAtEndScreen(t *testing.T) {
	h := newHarness(t, "0.22.1")
	p := h.portable(t)
	p.Begin()
	p.check(context.Background())
	if n := p.Notice(); n != "" {
		t.Fatalf("kurulmadan bilgi yok: %q", n)
	}
	p.End()
	if n := p.Notice(); n != MessageReady("0.22.1") {
		t.Fatalf("son ekran bilgisi: %q", n)
	}
	if n := p.Notice(); n != "" {
		t.Fatalf("bir kez: %q", n)
	}
}

func TestAC482IdleInstallShowsTrayBalloon(t *testing.T) {
	h := newHarness(t, "0.22.1")
	h.tray = true
	p := h.portable(t)
	p.check(context.Background()) // tepside boşta: hemen kurulur
	if c, _ := h.rep.stages[0].state(); !c {
		t.Fatal("boşta hemen kurulmalı")
	}
	h.mu.Lock()
	notified := append([]string(nil), h.notified...)
	h.mu.Unlock()
	if !eq(notified, MessageReady("0.22.1")) {
		t.Fatalf("balon: %v", notified)
	}
	if n := p.Notice(); n != "" {
		t.Fatalf("balonda gösterilen bilgi ana ekranda tekrar gösterilmemeli: %q", n)
	}
	if got := h.events(); !eq(got, "available", "installed") {
		t.Fatalf("olaylar: %v", got)
	}
}

func TestAC484OneInstallPerProcess(t *testing.T) {
	h := newHarness(t, "0.22.1")
	p := h.portable(t)
	p.check(context.Background())
	h.setOffer("0.22.2")
	p.check(context.Background())
	if h.checks != 1 || h.rep.count() != 1 {
		t.Fatalf("kurulumdan sonra yeni denetim/indirme olmamalı (çalışan imaj .eski): checks=%d stages=%d", h.checks, h.rep.count())
	}
}

func TestAC485PolicyOffNotifiesWithoutDownload(t *testing.T) {
	h := newHarness(t, "0.22.1")
	h.policy, h.keys = PolicyNotify, []string{"k1", "k2"}
	p := h.portable(t)
	p.check(context.Background())
	if h.rep.count() != 0 || h.downs != 0 {
		t.Fatal("politika kapalıyken indirme/hazırlık olmamalı")
	}
	if got := h.events(); !eq(got, "available", "skipped/POLICY_OFF") {
		t.Fatalf("olaylar: %v", got)
	}
	if !eq(h.sentKeys[0], "k1", "k2") {
		t.Fatalf("olay kimliği kayıt anahtarlarıyla: %v", h.sentKeys)
	}
	if n := p.Notice(); n != MessageAvailableLink("https://destek.example/") {
		t.Fatalf("bilgi: %q", n)
	}
}

func TestAC485OfferPolicyNotifyFromRef(t *testing.T) {
	h := newHarness(t, "0.22.1")
	h.offer.Policy = "notify" // müşteri dosyası ?ref= → tenant kapalı
	p := h.portable(t)
	p.check(context.Background())
	if got := h.events(); !eq(got, "available", "skipped/POLICY_OFF") || h.rep.count() != 0 {
		t.Fatalf("olaylar: %v", got)
	}
}

func TestAC485PolicyUnknownSkipsCycle(t *testing.T) {
	h := newHarness(t, "0.22.1")
	h.polErr = errors.New("kayıt durumu okunamadı")
	p := h.portable(t)
	p.check(context.Background())
	if got := h.events(); len(got) != 0 || h.rep.count() != 0 {
		t.Fatalf("politika bilinmiyorsa bu dönem karar yok (fail-closed): %v", got)
	}
}

func TestAC483NotWritableAndManualOnly(t *testing.T) {
	for _, c := range []struct {
		err  error
		want string
	}{{ErrNotWritable, "skipped/NOT_WRITABLE"}, {ErrManualOnly, "skipped/MANUAL_ONLY"}} {
		h := newHarness(t, "0.22.1")
		h.rep.err = c.err
		p := h.portable(t)
		p.check(context.Background())
		if got := h.events(); !eq(got, "available", c.want) || h.downs != 0 {
			t.Fatalf("%v: olaylar %v, indirme %d", c.err, got, h.downs)
		}
		if n := p.Notice(); n != MessageAvailableLink("https://destek.example/") {
			t.Fatalf("bilgi: %q", n)
		}
		p.check(context.Background()) // sürüm başına bir kez
		if got := h.events(); len(got) != 2 || p.Notice() != "" {
			t.Fatalf("tekrar olay/bilgi olmamalı: %v", got)
		}
	}
}

func TestAC483BusySilent(t *testing.T) {
	h := newHarness(t, "0.22.1")
	h.rep.err = ErrBusy
	p := h.portable(t)
	p.check(context.Background())
	if got := h.events(); !eq(got, "available") || p.Notice() != "" {
		t.Fatalf("başka örnek güncelliyorsa yalnız available: %v", got)
	}
}

func TestAC487DownloadFailureEventAndCleanup(t *testing.T) {
	h := newHarness(t, "0.22.1")
	h.dlErr = &DownloadError{Reason: ReasonHashMismatch}
	p := h.portable(t)
	p.check(context.Background())
	if got := h.events(); !eq(got, "available", "failed/HASH_MISMATCH") {
		t.Fatalf("olaylar: %v", got)
	}
	if c, a := h.rep.stages[0].state(); c || !a {
		t.Fatal("ret sonrası geçici dosya silinmeli, kurulum yok (AC-474/484)")
	}
}

func TestAC487InstallFailureEvent(t *testing.T) {
	h := newHarness(t, "0.22.1")
	h.rep.commitErr = errors.New("erişim engellendi")
	p := h.portable(t)
	p.check(context.Background())
	if got := h.events(); !eq(got, "available", "failed/INSTALL") {
		t.Fatalf("olaylar: %v", got)
	}
	if p.Notice() != "" {
		t.Fatal("kurulamayınca hazır bilgisi olmamalı")
	}
}

func TestAC487CanceledDownloadNoEvent(t *testing.T) {
	h := newHarness(t, "0.22.1")
	h.dlBlock = true
	p := h.portable(t)
	done := make(chan struct{})
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		defer close(done)
		p.check(ctx)
	}()
	for h.rep.count() == 0 {
		time.Sleep(time.Millisecond)
	}
	cancel()
	<-done
	p.Close(time.Second)
	for _, e := range h.events() {
		if e != "available" {
			t.Fatalf("iptal edilen indirme olay üretmemeli: %v", h.events())
		}
	}
	if _, a := h.rep.stages[0].state(); !a {
		t.Fatal("iptalde geçici dosya silinmeli (AC-484)")
	}
}

func TestAC484AbortOnSignalRemovesPending(t *testing.T) {
	h := newHarness(t, "0.22.1")
	h.dlBlock = true
	p := h.portable(t)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		p.check(ctx)
	}()
	for h.rep.count() == 0 {
		time.Sleep(time.Millisecond)
	}
	p.Abort() // sinyal yolu: indirme sürerken (os.Exit öncesi) eşzamanlı
	if _, a := h.rep.stages[0].state(); !a {
		t.Fatal("sinyal yolunda geçici dosya eşzamanlı silinmeli")
	}
	cancel()
	<-done
	for _, e := range h.events() {
		if e != "available" {
			t.Fatalf("Abort sonrası olay olmamalı: %v", h.events())
		}
	}
}

func TestAC487AckOnlyOnSuccess(t *testing.T) {
	h := newHarness(t, "0.22.1")
	h.policy = PolicyNotify
	h.sendErr = errors.New("ağ yok")
	p := h.portable(t)
	p.check(context.Background())
	if len(p.q.Pending()) != 2 {
		t.Fatalf("gönderilemeyen olaylar kuyrukta kalmalı: %v", p.q.Pending())
	}
	h.mu.Lock()
	h.sendErr = nil
	h.mu.Unlock()
	p.flush(context.Background())
	if len(p.q.Pending()) != 0 || !eq(h.events(), "available", "skipped/POLICY_OFF") {
		t.Fatalf("başarıda düşülmeli: %v", h.events())
	}
}

func TestAC475MaxSeenInMemoryReplay(t *testing.T) {
	h := newHarness(t, "0.23.0")
	h.rep.err = ErrBusy // kurulmasın; yalnız görülsün
	p := h.portable(t)
	p.check(context.Background())
	h.setOffer("0.22.5")
	p.check(context.Background())
	if got := h.events(); !eq(got, "available", "failed/DOWNGRADE") {
		t.Fatalf("0.23.0 görülmüşken 0.22.5 → DOWNGRADE: %v", got)
	}
}

func TestAC478StartDisabledWithoutKeysAndRunsAtLaunch(t *testing.T) {
	h := newHarness(t, "0.22.1")
	p := h.portable(t)
	p.d.Trust = Trust{}
	p.Start(context.Background())
	p.Close(10 * time.Millisecond)
	if h.checks != 0 {
		t.Fatal("anahtarsız derlemede ağ isteği olmamalı")
	}

	h = newHarness(t, "0.22.0") // eşit sürüm: sessiz
	p = h.portable(t)
	fire := make(chan time.Time)
	p.d.Timer = func(time.Duration) <-chan time.Time { return fire }
	p.Start(context.Background())
	deadline := time.Now().Add(2 * time.Second)
	for {
		h.mu.Lock()
		n := h.checks
		h.mu.Unlock()
		if n == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("açılışta hemen denetlenmeli")
		}
		time.Sleep(time.Millisecond)
	}
	fire <- testNow // dönem
	for {
		h.mu.Lock()
		n := h.checks
		h.mu.Unlock()
		if n == 2 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("dönemde yeniden denetlenmeli")
		}
		time.Sleep(time.Millisecond)
	}
	p.Close(time.Second)
	if got := h.events(); len(got) != 0 {
		t.Fatalf("güncel istemci olay göndermez (AC-487): %v", got)
	}
}

func TestMessageAvailableLink(t *testing.T) {
	if MessageAvailableLink("") != MessageAvailable+"." {
		t.Fatal("bağlantısız")
	}
	if MessageAvailableLink("https://x/") != MessageAvailable+": https://x/" {
		t.Fatal("bağlantılı")
	}
}

func TestAC476PlatformSignatureFailureEvent(t *testing.T) {
	h := newHarness(t, "0.22.1")
	h.rep.commitErr = errors.Join(ErrPlatformSignature, errors.New("yayıncı farklı"))
	p := h.portable(t)
	p.check(context.Background())
	if got := h.events(); !eq(got, "available", "failed/PLATFORM_SIGNATURE") || !ReasonPlatformSignature.Security() {
		t.Fatalf("olaylar: %v", got)
	}
}
