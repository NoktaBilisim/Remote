package servis

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"remote-support/agent-win/internal/servis/helperio"
	"remote-support/agent-win/internal/signal"
)

// P28u K5 servis birim testleri (mimari-p28u §14.2): kip kararı, durum borusu tablosu, müdahale, yeniden katılım.

type fakeSess struct {
	mu        sync.Mutex
	console   uint32
	noConsole bool
	info      map[uint32]SessionInfo
	gone      map[uint32]bool
	logoffs   []uint32
	logoffErr error
}

func newSess(user, locked bool) *fakeSess {
	return &fakeSess{console: 1, info: map[uint32]SessionInfo{1: {User: user, Locked: locked}}, gone: map[uint32]bool{}}
}

func (s *fakeSess) Console() (uint32, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.console, !s.noConsole
}

func (s *fakeSess) Info(id uint32) (SessionInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.gone[id] {
		return SessionInfo{}, errors.New("yok")
	}
	return s.info[id], nil
}

func (s *fakeSess) Logoff(id uint32) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.logoffs = append(s.logoffs, id)
	return s.logoffErr
}

func (s *fakeSess) set(f func(s *fakeSess)) { s.mu.Lock(); f(s); s.mu.Unlock() }

// p28uCore features alınmış çekirdek; yardımcının durum borusu test tarafından yazılır.
type p28uRig struct {
	c    *Core
	l    *fakeLauncher
	out  *sent
	ev   *memEvents
	sess *fakeSess
	mu   sync.Mutex
	pw   []*io.PipeWriter
}

func newP28u(t *testing.T, sess *fakeSess) *p28uRig {
	t.Helper()
	c, l, _, out, ev := newCore(true)
	r := &p28uRig{c: c, l: l, out: out, ev: ev, sess: sess}
	c.Consent1 = func() bool { return true }
	c.Sessions = sess
	c.tm = timing{userDebounce: 20 * time.Millisecond, lockWait: 100 * time.Millisecond,
		logoffWait: 200 * time.Millisecond, poll: 5 * time.Millisecond, consoleWait: 300 * time.Millisecond}
	l.win = 1
	l.status = func() io.Reader {
		pr, pw := io.Pipe()
		r.mu.Lock()
		r.pw = append(r.pw, pw)
		r.mu.Unlock()
		return pr
	}
	t.Cleanup(func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		for _, w := range r.pw {
			_ = w.Close()
		}
	})
	return r
}

// status i. yardımcının durum borusuna satır yazar.
func (r *p28uRig) status(t *testing.T, i int, line string) {
	t.Helper()
	r.mu.Lock()
	w := r.pw[i]
	r.mu.Unlock()
	done := make(chan struct{})
	go func() { _, _ = w.Write([]byte(line + "\n")); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("durum satırı okunmadı")
	}
}

func askConnect() *Connect {
	m := connectMsg()
	m.Consent, m.ExpiresInSec = helperio.ConsentAsk, 150
	return m
}

func silentConnect() *Connect {
	m := connectMsg()
	m.Consent, m.IndicatorText = ConsentSilent, "Uzaktan izleniyor: Mehmet — Nokta Destek"
	m.IndicatorControl = "Uzaktan kontrol: Mehmet — Nokta Destek"
	return m
}

func lastOf[T any](out *sent) (T, bool) {
	msgs := out.all()
	for i := len(msgs) - 1; i >= 0; i-- {
		if v, ok := msgs[i].(T); ok {
			return v, true
		}
	}
	var zero T
	return zero, false
}

func waitFor[T any](t *testing.T, out *sent, match func(T) bool) T {
	t.Helper()
	for i := 0; i < 400; i++ {
		for _, m := range out.all() {
			if v, ok := m.(T); ok && match(v) {
				return v
			}
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("beklenen mesaj gelmedi: %+v", out.all())
	var zero T
	return zero
}

func count[T any](out *sent) int {
	n := 0
	for _, m := range out.all() {
		if _, ok := m.(T); ok {
			n++
		}
	}
	return n
}

// ---- Fikstür eşliği (contracts fixtures/ws-device.json consent1* + constants) ----

type consentFixture struct {
	Constants map[string]any               `json:"constants"`
	Valid     map[string][]json.RawMessage `json:"valid"`
	Invalid   map[string][]json.RawMessage `json:"invalid"`
}

func loadConsentFixture(t *testing.T) consentFixture {
	t.Helper()
	var f consentFixture
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "ws-device.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

// serverRejects consent1 sokette sunucu mesajının reddi: şema hatası ya da (connect) `connect.result{protocol}`.
func serverRejects(raw []byte) bool {
	m, err := ParseServer(raw)
	if err != nil {
		return true
	}
	if c, ok := m.(*Connect); ok {
		return !connectConsent(c)
	}
	return false
}

func parseConsentInbound(raw []byte) error {
	var head struct {
		T string `json:"t"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return err
	}
	types := map[string]func() any{tUser: func() any { return &DeviceUser{} },
		tConsentResult: func() any { return &ConsentResult{} }, tInterveneResult: func() any { return &InterveneResult{} },
		tConnectResult: func() any { return &ConnectResult{} }, tState: func() any { return &State{} },
		tClosed: func() any { return &Closed{} }, tUnregister: func() any { return &Unregister{} }}
	mk, ok := types[head.T]
	if !ok {
		return errSchema
	}
	m := mk()
	if err := signal.DecodeStrict(raw, m); err != nil {
		return err
	}
	if !validateClient(m) {
		return errSchema
	}
	return nil
}

func TestAC435Consent1FixtureOutbound(t *testing.T) {
	f := loadConsentFixture(t)
	if len(f.Valid["consent1Outbound"]) == 0 || len(f.Invalid["consent1Outbound"]) == 0 {
		t.Fatal("fikstür consent1Outbound boş")
	}
	for _, raw := range f.Valid["consent1Outbound"] {
		if serverRejects(raw) {
			t.Errorf("geçerli consent1 sunucu mesajı reddedildi: %s", raw)
		}
	}
	for _, raw := range f.Invalid["consent1Outbound"] {
		if !serverRejects(raw) {
			t.Errorf("geçersiz consent1 sunucu mesajı kabul edildi: %s", raw)
		}
	}
}

func TestAC435Consent1FixtureInbound(t *testing.T) {
	f := loadConsentFixture(t)
	for _, raw := range f.Valid["consent1Inbound"] {
		if err := parseConsentInbound(raw); err != nil {
			t.Errorf("geçerli consent1 cihaz mesajı reddedildi: %s: %v", raw, err)
		}
	}
	for _, raw := range f.Invalid["consent1Inbound"] {
		if parseConsentInbound(raw) == nil {
			t.Errorf("geçersiz consent1 cihaz mesajı kabul edildi: %s", raw)
		}
	}
}

func TestAC443FixtureConstantsMatchGo(t *testing.T) {
	k := loadConsentFixture(t).Constants
	want := map[string]float64{"consentResultMsMax": helperio.MaxConsentMs, "rejoinWindowSec": RejoinWindowSec,
		"rejoinTicketTtlSec": RejoinTicketTTLSec, "rejoinConsoleWaitSec": RejoinConsoleWaitSec,
		"deviceUserDebounceMs": float64(DeviceUserDebounce / time.Millisecond)}
	for key, v := range want {
		if got, ok := k[key].(float64); !ok || got != v {
			t.Errorf("%s = %v, Go %v", key, k[key], v)
		}
	}
	if k["wsDeviceCapConsent"] != DeviceCapConsent {
		t.Errorf("belirteç = %v", k["wsDeviceCapConsent"])
	}
	// Servis içi beklemeler sunucu zaman aşımının altında kalmalı (sonuç sunucu vazgeçmeden gitsin).
	if lt, _ := k["interveneLockTimeoutMs"].(float64); time.Duration(lt)*time.Millisecond <= lockWait {
		t.Errorf("lockWait %v ≥ sunucu %v ms", lockWait, lt)
	}
	if lo, _ := k["interveneLogoffTimeoutMs"].(float64); time.Duration(lo)*time.Millisecond <= logoffWait {
		t.Errorf("logoffWait %v ≥ sunucu %v ms", logoffWait, lo)
	}
}

// ---- Kip kararı (§7.2) ----

func TestAC432ConsentMissingOnConsent1SocketIsProtocol(t *testing.T) {
	for _, mut := range []func(*Connect){
		func(m *Connect) { m.Consent = "" },
		func(m *Connect) { m.Consent = "none" },
		func(m *Connect) { m.Consent = helperio.ConsentAsk; m.IndicatorControl = "Uzaktan kontrol: X" },
		func(m *Connect) { m.Consent = ConsentSilent; m.IndicatorControl = "" },
	} {
		rg := newP28u(t, newSess(true, false))
		m := connectMsg()
		mut(m)
		rg.c.Connect(m)
		r, ok := lastOf[*ConnectResult](rg.out)
		if rg.l.launched.Load() != 0 || !ok || r.Reason != RejectProtocol {
			t.Fatalf("consent=%q: yardımcı=%d sonuç=%+v", m.Consent, rg.l.launched.Load(), r)
		}
	}
}

func TestAC433ModeDecidedFromLiveUserState(t *testing.T) {
	cases := []struct {
		sess          *fakeSess
		consent, mode string
		noUserResult  bool
	}{
		{newSess(true, false), helperio.ConsentAsk, helperio.ModeAsked, false},
		{newSess(true, true), helperio.ConsentNone, helperio.ModeNoUser, true},
		{newSess(false, false), helperio.ConsentNone, helperio.ModeNoUser, true},
		{&fakeSess{noConsole: true}, helperio.ConsentNone, helperio.ModeNoUser, true},
	}
	for i, tc := range cases {
		rg := newP28u(t, tc.sess)
		rg.c.Connect(askConnect())
		in := rg.l.inputs[0]
		if in.Consent != tc.consent || in.Mode != tc.mode || in.Validate() != nil {
			t.Fatalf("durum %d: girdi %+v", i, in)
		}
		cr, ok := lastOf[*ConsentResult](rg.out)
		if tc.noUserResult != ok || (ok && (cr.Mode != helperio.ModeNoUser || cr.Decision != "" || cr.Ms != nil)) {
			t.Fatalf("durum %d: consent.result %+v", i, cr)
		}
	}
}

func TestAC433UnreadableSessionMeansActive(t *testing.T) {
	s := newSess(false, false)
	s.gone[1] = true
	if got := userStateOf(s); got != UserActive {
		t.Fatalf("okunamayan oturum = %s, beklenen active (fail-safe)", got)
	}
	if userStateOf(nil) != UserActive {
		t.Fatal("Sessions yokken active değil")
	}
}

func TestAC438SilentNoDialogNoConsentResult(t *testing.T) {
	rg := newP28u(t, newSess(true, false))
	rg.c.Connect(silentConnect())
	in := rg.l.inputs[0]
	if in.Consent != helperio.ConsentNone || in.Mode != helperio.ModeSilent || in.IndicatorControl == "" {
		t.Fatalf("silent girdi %+v", in)
	}
	if count[*ConsentResult](rg.out) != 0 {
		t.Fatal("silent'ta consent.result gönderildi")
	}
	if !hasEvent(rg.ev, EvStarted, "izinsiz") {
		t.Fatal("1001 kip yok")
	}
}

func TestAC435LegacyServerKeepsP27(t *testing.T) {
	c, l, _, out, _ := newCore(true) // Consent1 nil: device.features alınmadı
	c.Connect(connectMsg())
	if in := l.inputs[0]; in.Consent != helperio.ConsentNone || in.Mode != helperio.ModeNoUser {
		t.Fatalf("P27 girdi %+v", in)
	}
	if count[*ConsentResult](out) != 0 {
		t.Fatal("eski sunucuya yeni mesaj")
	}
	c2, l2, _, out2, _ := newCore(true)
	c2.Connect(askConnect()) // features'sız sokette onay alanı: sözleşme dışı, fail-closed
	if r, ok := lastOf[*ConnectResult](out2); l2.launched.Load() != 0 || !ok || r.Reason != helperio.ReasonHelperFailed {
		t.Fatalf("features'sız consent = %+v", out2.all())
	}
}

// ---- Durum borusu tablosu (§7.4, K-P28u-19) ----

func TestAC431StatusTable(t *testing.T) {
	ms := func(v int) *int { return &v }
	on := func(v bool) *bool { return &v }
	cases := []struct {
		name    string
		h       helperStatus
		s       helperio.Status
		wantErr bool
	}{
		{"none'da consent", helperStatus{consent: helperio.ConsentNone}, helperio.Status{Ev: "consent", Decision: "granted", Ms: ms(1)}, true},
		{"ask ilk consent", helperStatus{consent: helperio.ConsentAsk}, helperio.Status{Ev: "consent", Decision: "granted", Ms: ms(1)}, false},
		{"ikinci consent", helperStatus{consent: helperio.ConsentAsk, decided: true, granted: true}, helperio.Status{Ev: "consent", Decision: "granted", Ms: ms(1)}, true},
		{"ms aralık dışı", helperStatus{consent: helperio.ConsentAsk}, helperio.Status{Ev: "consent", Decision: "granted", Ms: ms(65001)}, true},
		{"bilinmeyen karar", helperStatus{consent: helperio.ConsentAsk}, helperio.Status{Ev: "consent", Decision: "evet", Ms: ms(1)}, true},
		{"karar öncesi control", helperStatus{consent: helperio.ConsentAsk}, helperio.Status{Ev: "control", On: on(true)}, true},
		{"red sonrası control", helperStatus{consent: helperio.ConsentAsk, decided: true}, helperio.Status{Ev: "control", On: on(true)}, true},
		{"izin sonrası control", helperStatus{consent: helperio.ConsentAsk, decided: true, granted: true}, helperio.Status{Ev: "control", On: on(true)}, false},
		{"aynı değer control", helperStatus{consent: helperio.ConsentNone}, helperio.Status{Ev: "control", On: on(false)}, true},
		{"beklenmeyen lock", helperStatus{consent: helperio.ConsentNone}, helperio.Status{Ev: "lock", ID: "01JD0000000000000000000009", Ok: on(true)}, true},
		{"bekleyen lock", helperStatus{consent: helperio.ConsentNone, pendingLock: "01JD0000000000000000000009"}, helperio.Status{Ev: "lock", ID: "01JD0000000000000000000009", Ok: on(true)}, false},
		{"lock ok+reason", helperStatus{consent: helperio.ConsentNone, pendingLock: "01JD0000000000000000000009"}, helperio.Status{Ev: "lock", ID: "01JD0000000000000000000009", Ok: on(true), Reason: "timeout"}, true},
		{"bilinmeyen olay", helperStatus{consent: helperio.ConsentNone}, helperio.Status{Ev: "logoff"}, true},
	}
	for _, tc := range cases {
		h := tc.h
		if _, err := h.apply(tc.s); (err != nil) != tc.wantErr {
			t.Errorf("%s: hata=%v", tc.name, err)
		}
	}
}

func TestAC431ConsentFlowAndProtocolViolationKills(t *testing.T) {
	rg := newP28u(t, newSess(true, false))
	rg.c.Connect(askConnect())
	rg.status(t, 0, `{"ev":"consent","decision":"granted","ms":4200}`)
	cr := waitFor(t, rg.out, func(m *ConsentResult) bool { return m.Mode == helperio.ModeAsked })
	if cr.Decision != helperio.DecisionGranted || *cr.Ms != 4200 {
		t.Fatalf("consent.result %+v", cr)
	}
	rg.status(t, 0, `{"ev":"consent","decision":"granted","ms":1}`) // ikinci karar → sonlandırma
	waitInactive(t, rg.c)
	cl := waitFor(t, rg.out, func(m *Closed) bool { return true })
	if cl.Reason != helperio.ReasonHelperFailed {
		t.Fatalf("ihlal sonrası neden %s", cl.Reason)
	}
	if !hasEvent(rg.ev, EvRejected, ReasonHelperProtocol) {
		t.Fatal("1004 helper_protocol yazılmadı")
	}
}

func TestAC431MalformedOrOversizedStatusLineKills(t *testing.T) {
	for _, line := range []string{`{"ev":"control","on":true,"x":1}`, `nojson`, strings.Repeat("a", 600)} {
		rg := newP28u(t, newSess(true, false))
		rg.c.Connect(silentConnect())
		rg.status(t, 0, line)
		waitInactive(t, rg.c)
	}
}

func TestAC432ConsentDeniedExitReportsConnectResult(t *testing.T) {
	for code, reason := range map[uint32]string{helperio.ExitConsentDenied: helperio.ReasonConsentDenied,
		helperio.ExitConsentTimeout: helperio.ReasonConsentTimeout} {
		rg := newP28u(t, newSess(true, false))
		rg.c.Connect(askConnect())
		rg.l.procs[0].exit(code)
		r := waitFor(t, rg.out, func(m *ConnectResult) bool { return !m.OK })
		if r.Reason != reason {
			t.Fatalf("çıkış %d → %s", code, r.Reason)
		}
		if _, err := encodeClient(r); err != nil {
			t.Fatalf("%s gönderilemiyor: %v", reason, err)
		}
	}
}

// ---- Müdahale (§7.5, AC-442..444) ----

func grantControl(t *testing.T, rg *p28uRig, i int) {
	t.Helper()
	rg.status(t, i, `{"ev":"control","on":true}`)
	for j := 0; j < 200; j++ {
		rg.c.mu.Lock()
		on := rg.c.cur != nil && rg.c.cur.st.control
		rg.c.mu.Unlock()
		if on {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("ev:control işlenmedi")
}

func grantConsent(t *testing.T, rg *p28uRig) {
	t.Helper()
	rg.status(t, 0, `{"ev":"consent","decision":"granted","ms":10}`)
	waitFor(t, rg.out, func(m *ConsentResult) bool { return m.Mode == helperio.ModeAsked })
}

func interveneMsg(cmd string) *Intervene {
	return &Intervene{SessionID: sid, ID: "01JD0000000000000000000009", Cmd: cmd}
}

func TestAC442InterveneRejections(t *testing.T) {
	rg := newP28u(t, newSess(true, false))
	rg.c.Intervene(interveneMsg(CmdLock))
	if r, _ := lastOf[*InterveneResult](rg.out); r.Reason != InterveneNoSession {
		t.Fatalf("yardımcısız = %+v", r)
	}
	rg.c.Connect(silentConnect())
	rg.c.Intervene(interveneMsg(CmdLock))
	if r, _ := lastOf[*InterveneResult](rg.out); r.Reason != InterveneNotInControl {
		t.Fatalf("kontrol kapalı = %+v", r)
	}
	grantControl(t, rg, 0)
	other := interveneMsg(CmdLock)
	other.SessionID = "01JD0000000000000000000003"
	rg.c.Intervene(other)
	if r, _ := lastOf[*InterveneResult](rg.out); r.Reason != InterveneNoSession {
		t.Fatalf("başka oturum = %+v", r)
	}
	rg.sess.set(func(s *fakeSess) { s.console = 2; s.info[2] = SessionInfo{User: true} }) // hızlı kullanıcı değiştirme
	rg.c.Intervene(interveneMsg(CmdLogoff))
	if r, _ := lastOf[*InterveneResult](rg.out); r.Reason != InterveneNoSession || len(rg.sess.logoffs) != 0 {
		t.Fatalf("konsol ≠ yardımcı oturumu = %+v, logoff %v", r, rg.sess.logoffs)
	}
}

func TestAC443LockViaHelperPipeAndEventLog(t *testing.T) {
	rg := newP28u(t, newSess(true, false))
	rg.c.Connect(silentConnect())
	grantControl(t, rg, 0)
	rg.c.Intervene(interveneMsg(CmdLock))
	p := rg.l.procs[0]
	p.cmdMu.Lock()
	cmds := append([]helperio.Command(nil), p.cmds...)
	p.cmdMu.Unlock()
	if len(cmds) != 1 || cmds[0].Cmd != helperio.CmdLock || cmds[0].ID != "01JD0000000000000000000009" {
		t.Fatalf("boru komutu %+v", cmds)
	}
	rg.status(t, 0, `{"ev":"lock","id":"01JD0000000000000000000009","ok":true}`)
	r := waitFor(t, rg.out, func(m *InterveneResult) bool { return m.Cmd == CmdLock })
	if !r.OK {
		t.Fatalf("kilit sonucu %+v", r)
	}
	if !hasEvent(rg.ev, EvLock, "başarılı") {
		t.Fatal("olay 1006 yok")
	}
}

func TestAC443LockTimeoutThenLateEventTolerated(t *testing.T) {
	rg := newP28u(t, newSess(true, false))
	rg.c.Connect(silentConnect())
	grantControl(t, rg, 0)
	rg.c.Intervene(interveneMsg(CmdLock))
	r := waitFor(t, rg.out, func(m *InterveneResult) bool { return m.Cmd == CmdLock })
	if r.OK || r.Reason != InterveneTimeout {
		t.Fatalf("zaman aşımı = %+v", r)
	}
	rg.status(t, 0, `{"ev":"lock","id":"01JD0000000000000000000009","ok":true}`)
	time.Sleep(20 * time.Millisecond)
	if !rg.c.Active() {
		t.Fatal("geç ev:lock yardımcıyı sonlandırdı")
	}
}

func TestAC443InterveneAfterHelperExitIsNoSession(t *testing.T) {
	rg := newP28u(t, newSess(true, false))
	rg.c.Connect(silentConnect())
	grantControl(t, rg, 0)
	rg.l.procs[0].exit(helperio.ExitEnded)
	waitInactive(t, rg.c)
	rg.c.Intervene(interveneMsg(CmdLock))
	if r, _ := lastOf[*InterveneResult](rg.out); r.Reason != InterveneNoSession {
		t.Fatalf("çıkış sonrası = %+v", r)
	}
}

func TestAC443LogoffNoUser(t *testing.T) {
	rg := newP28u(t, newSess(true, false))
	rg.c.Connect(silentConnect())
	grantControl(t, rg, 0)
	rg.sess.set(func(s *fakeSess) { s.info[1] = SessionInfo{User: false} })
	rg.c.Intervene(interveneMsg(CmdLogoff))
	if r, _ := lastOf[*InterveneResult](rg.out); r.Reason != InterveneNoUser || len(rg.sess.logoffs) != 0 {
		t.Fatalf("kullanıcısız logoff = %+v", r)
	}
}

// logoffAndExit logoff'u kabul ettirir, yardımcıyı öldürür ve oturumu "kapatır".
func logoffAndExit(t *testing.T, rg *p28uRig) {
	t.Helper()
	grantControl(t, rg, 0)
	rg.c.Intervene(interveneMsg(CmdLogoff))
	rg.sess.mu.Lock()
	lo := append([]uint32(nil), rg.sess.logoffs...)
	rg.sess.mu.Unlock()
	if len(lo) != 1 || lo[0] != 1 {
		t.Fatalf("WTSLogoffSession hedefi %v", lo)
	}
	rg.l.procs[0].exit(helperio.ExitSessionChanged) // yardımcı onaydan önce ölür
	waitInactive(t, rg.c)
	rg.c.SessionEvent(SessionConsoleDisconnect) // beklenen geçiş: bitiş değil
	rg.sess.set(func(s *fakeSess) { s.gone[1] = true })
	r := waitFor(t, rg.out, func(m *InterveneResult) bool { return m.Cmd == CmdLogoff })
	if !r.OK {
		t.Fatalf("logoff sonucu %+v", r)
	}
	if count[*Closed](rg.out) != 0 {
		t.Fatalf("rejoinPending'de session.closed gönderildi: %+v", rg.out.all())
	}
	if !hasEvent(rg.ev, EvLogoff, "başarılı") {
		t.Fatal("olay 1007 yok")
	}
}

func rejoinMsg(mode string) *Rejoin {
	m := &Rejoin{SessionID: sid, Ticket: "OSTHxpIxRYOEvsy1t7jssmOfVM9-lMgf5dSNuly4uso", Mode: mode,
		IndicatorText: "Uzaktan bağlantı: Mehmet — Nokta Destek", ExpiresInSec: 30}
	if mode == helperio.ModeSilent {
		m.IndicatorText, m.IndicatorControl = "Uzaktan izleniyor: Mehmet", "Uzaktan kontrol: Mehmet"
	}
	return m
}

func TestAC443LogoffThenRejoinLaunchesHelperControlOff(t *testing.T) {
	rg := newP28u(t, newSess(true, false))
	rg.c.Connect(silentConnect())
	logoffAndExit(t, rg)
	rg.c.Connect(askConnect()) // pencere boyunca meşgul
	if r, _ := lastOf[*ConnectResult](rg.out); r.Reason != RejectBusy {
		t.Fatalf("pencerede yeni connect = %+v", r)
	}
	rg.sess.set(func(s *fakeSess) { s.console = 3; s.info[3] = SessionInfo{} }) // giriş ekranı
	rg.c.Rejoin(rejoinMsg(helperio.ModeSilent))
	for i := 0; i < 200 && rg.l.launched.Load() < 2; i++ {
		time.Sleep(5 * time.Millisecond)
	}
	if rg.l.launched.Load() != 2 {
		t.Fatal("yeniden katılım yardımcısı başlamadı")
	}
	in := rg.l.inputs[1]
	if in.Consent != helperio.ConsentNone || in.Mode != helperio.ModeSilent || in.TechName != "Mehmet" || in.Validate() != nil {
		t.Fatalf("rejoin girdisi %+v", in)
	}
	rg.c.Intervene(interveneMsg(CmdLock)) // control=off başlar
	if r, _ := lastOf[*InterveneResult](rg.out); r.Reason != InterveneNotInControl {
		t.Fatalf("yeniden katılım sonrası kontrol = %+v", r)
	}
}

func TestAC433AskedLogonAfterLogoffEndsSessionChanged(t *testing.T) {
	// Yeniden katılım öncesi: WTS_SESSION_LOGON → yardımcı hiç başlatılmaz.
	rg := newP28u(t, newSess(true, false))
	rg.c.Connect(askConnect())
	grantConsent(t, rg)
	logoffAndExit(t, rg)
	rg.c.SessionEvent(SessionLogon)
	cl := waitFor(t, rg.out, func(m *Closed) bool { return true })
	if cl.Reason != KillSessionChanged {
		t.Fatalf("neden %s", cl.Reason)
	}
	rg.c.Rejoin(rejoinMsg(helperio.ModeAsked))
	time.Sleep(30 * time.Millisecond)
	if rg.l.launched.Load() != 1 {
		t.Fatal("onay aklandı: yardımcı başlatıldı")
	}

	// Yeni konsol oturumunda kullanıcı zaten var: başlatılmaz, session_changed.
	rg2 := newP28u(t, newSess(true, false))
	rg2.c.Connect(askConnect())
	grantConsent(t, rg2)
	logoffAndExit(t, rg2)
	rg2.sess.set(func(s *fakeSess) { s.console = 3; s.info[3] = SessionInfo{User: true} })
	rg2.c.Rejoin(rejoinMsg(helperio.ModeAsked))
	if cl := waitFor(t, rg2.out, func(m *Closed) bool { return true }); cl.Reason != KillSessionChanged ||
		rg2.l.launched.Load() != 1 {
		t.Fatalf("kullanıcılı yeni oturum: %+v, yardımcı %d", cl, rg2.l.launched.Load())
	}

	// Yeniden katılım sonrası logon: yeni yardımcı session_changed ile kesilir.
	rg3 := newP28u(t, newSess(true, false))
	rg3.c.Connect(askConnect())
	grantConsent(t, rg3)
	logoffAndExit(t, rg3)
	rg3.sess.set(func(s *fakeSess) { s.console = 3; s.info[3] = SessionInfo{} })
	rg3.c.Rejoin(rejoinMsg(helperio.ModeAsked))
	for i := 0; i < 200 && rg3.l.launched.Load() < 2; i++ {
		time.Sleep(5 * time.Millisecond)
	}
	rg3.c.SessionEvent(SessionLogon)
	if cl := waitFor(t, rg3.out, func(m *Closed) bool { return true }); cl.Reason != KillSessionChanged {
		t.Fatalf("yeniden katılım sonrası logon: %+v", cl)
	}
}

func TestAC433NoUserAndSilentLogonDoesNotEnd(t *testing.T) {
	rg := newP28u(t, newSess(true, false))
	rg.c.Connect(silentConnect())
	logoffAndExit(t, rg)
	rg.c.SessionEvent(SessionLogon)
	time.Sleep(20 * time.Millisecond)
	if count[*Closed](rg.out) != 0 {
		t.Fatal("silent'ta logon oturumu bitirdi")
	}
}

func TestAC443RejoinPendingDropsAfterWindow(t *testing.T) {
	rg := newP28u(t, newSess(true, false))
	now := time.Now()
	var clockMu sync.Mutex
	rg.c.now = func() time.Time { clockMu.Lock(); defer clockMu.Unlock(); return now }
	rg.c.Connect(silentConnect())
	logoffAndExit(t, rg)
	clockMu.Lock()
	now = now.Add(RejoinWindowSec * time.Second)
	clockMu.Unlock()
	rg.c.Connect(silentConnect())
	if rg.l.launched.Load() != 2 {
		t.Fatalf("45 sn sonra işaret düşmedi: %+v", rg.out.all())
	}
}

func TestAC443LogoffFailureClearsRejoin(t *testing.T) {
	rg := newP28u(t, newSess(true, false))
	rg.sess.logoffErr = errors.New("erişim reddedildi")
	rg.c.Connect(silentConnect())
	grantControl(t, rg, 0)
	rg.c.Intervene(interveneMsg(CmdLogoff))
	if r, _ := lastOf[*InterveneResult](rg.out); r.Reason != InterveneAPIError {
		t.Fatalf("api hatası = %+v", r)
	}
	rg.l.procs[0].exit(helperio.ExitEnded)
	waitFor(t, rg.out, func(m *Closed) bool { return true }) // işaret yok: normal bitiş

	rg2 := newP28u(t, newSess(true, false)) // kullanıcı oturumu kapanmıyor → timeout, aynı temizlik
	rg2.c.Connect(silentConnect())
	grantControl(t, rg2, 0)
	rg2.c.Intervene(interveneMsg(CmdLogoff))
	if r := waitFor(t, rg2.out, func(m *InterveneResult) bool { return true }); r.Reason != InterveneTimeout {
		t.Fatalf("logoff zaman aşımı = %+v", r)
	}
	rg2.c.SessionEvent(SessionConsoleDisconnect) // işaret kalktı: P27 kuralı geçerli
	if cl := waitFor(t, rg2.out, func(m *Closed) bool { return true }); cl.Reason != KillSessionChanged {
		t.Fatalf("temizlik sonrası konsol geçişi = %+v", cl)
	}
}

func TestAC295LocalDisableDuringRejoinEnds(t *testing.T) {
	rg := newP28u(t, newSess(true, false))
	rg.c.Connect(silentConnect())
	logoffAndExit(t, rg)
	if err := rg.c.Disable(`PC\k`); err != nil {
		t.Fatal(err)
	}
	if cl := waitFor(t, rg.out, func(m *Closed) bool { return true }); cl.Reason != KillLocalDisabled {
		t.Fatalf("yerel kapatma = %+v", cl)
	}
}

// ---- Kullanıcı durumu (§7.2, AC-429) ----

func TestAC429UserWatchAnnounceAndDebounce(t *testing.T) {
	rg := newP28u(t, newSess(true, false))
	rg.c.Features()
	if u, ok := lastOf[*DeviceUser](rg.out); !ok || u.State != UserActive {
		t.Fatalf("features sonrası durum %+v", rg.out.all())
	}
	rg.sess.set(func(s *fakeSess) { s.info[1] = SessionInfo{User: true, Locked: true} })
	for i := 0; i < 5; i++ {
		rg.c.SessionEvent(7) // WTS_SESSION_LOCK: sönümlenir
	}
	waitFor(t, rg.out, func(m *DeviceUser) bool { return m.State == UserLocked })
	time.Sleep(50 * time.Millisecond)
	if n := count[*DeviceUser](rg.out); n != 2 {
		t.Fatalf("device.user sayısı %d, beklenen 2 (sönüm)", n)
	}
	rg.c.SessionEvent(8) // değişmeyen durum gönderilmez
	time.Sleep(50 * time.Millisecond)
	if n := count[*DeviceUser](rg.out); n != 2 {
		t.Fatalf("değişmeyen durum gönderildi (%d)", n)
	}
}

func TestEventLogNoTicket(t *testing.T) {
	e := evIntervene(CmdLogoff, "Mehmet‮", sid, InterveneTimeout)
	if e.ID != EvLogoff || !e.Warning || strings.ContainsRune(e.Text, '‮') {
		t.Fatalf("1007 = %+v", e)
	}
}

func hasEvent(ev *memEvents, id uint32, sub string) bool {
	for i := 0; i < 200; i++ {
		ev.mu.Lock()
		for _, e := range ev.evs {
			if e.ID == id && strings.Contains(e.Text, sub) {
				ev.mu.Unlock()
				return true
			}
		}
		ev.mu.Unlock()
		time.Sleep(5 * time.Millisecond)
	}
	return false
}
