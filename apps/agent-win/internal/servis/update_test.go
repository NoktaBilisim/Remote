package servis

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/update"
)

// ---- Fikstür eşliği (contracts fixtures/ws-device.json update1*) ----

func parseUpdateInbound(raw []byte) error {
	var head struct {
		T string `json:"t"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return err
	}
	var m any
	switch head.T {
	case tUpdateCheck:
		m = &UpdateCheck{}
	case tUpdateTokenRequest:
		m = &UpdateTokenRequest{}
	case tUpdateState:
		m = &UpdateStateMsg{}
	case tUpdateEvent:
		var raw2 map[string]json.RawMessage
		if err := json.Unmarshal(raw, &raw2); err != nil {
			return err
		}
		delete(raw2, "t")
		inner, _ := json.Marshal(raw2)
		var e update.Event
		if err := signal.DecodeStrict(inner, &e); err != nil {
			return err
		}
		if !validUpdateEvent(e) {
			return errSchema
		}
		return nil
	default:
		return errSchema
	}
	if err := signal.DecodeStrict(raw, m); err != nil {
		return err
	}
	if !validateClient(m) {
		return errSchema
	}
	return nil
}

func TestAC493Update1FixtureParity(t *testing.T) {
	f := loadConsentFixture(t)
	if f.Constants["wsDeviceCapUpdate"] != DeviceCapUpdate {
		t.Fatalf("cap = %v", f.Constants["wsDeviceCapUpdate"])
	}
	for _, raw := range f.Valid["update1Outbound"] {
		if _, err := ParseServer(raw); err != nil {
			t.Errorf("geçerli sunucu mesajı reddedildi: %s: %v", raw, err)
		}
	}
	for _, raw := range f.Invalid["update1Outbound"] {
		if _, err := ParseServer(raw); err == nil {
			t.Errorf("geçersiz sunucu mesajı kabul edildi: %s", raw)
		}
	}
	for _, raw := range f.Valid["update1Inbound"] {
		if err := parseUpdateInbound(raw); err != nil {
			t.Errorf("geçerli cihaz mesajı reddedildi: %s: %v", raw, err)
		}
	}
	for _, raw := range f.Invalid["update1Inbound"] {
		if err := parseUpdateInbound(raw); err == nil {
			t.Errorf("geçersiz cihaz mesajı kabul edildi: %s", raw)
		}
	}
	if len(f.Valid["update1Outbound"]) == 0 || len(f.Invalid["update1Inbound"]) == 0 {
		t.Fatal("fikstür update1* boş")
	}
}

// ---- AC-493: eski sunucu (offer/none yok) → 0 update.* yazımı; yeni sunucu offer/none sonrası yazılır ----

func collectTypes(announce string, got chan<- string) func(context.Context, *websocket.Conn) {
	return func(ctx context.Context, ws *websocket.Conn) {
		if announce != "" {
			_ = ws.Write(ctx, websocket.MessageText, []byte(announce))
		}
		for {
			_, data, err := ws.Read(ctx)
			if err != nil {
				return
			}
			var h struct {
				T string `json:"t"`
			}
			_ = json.Unmarshal(data, &h)
			got <- h.T
		}
	}
}

func runUpdateGateCase(t *testing.T, announce string) []string {
	t.Helper()
	got := make(chan string, 32)
	c, _, _, _ := startDevice(t, collectTypes(announce, got))
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	go func() { _ = c.Run(ctx) }()
	for c.State() != StateOnline && ctx.Err() == nil {
		time.Sleep(5 * time.Millisecond)
	}
	if announce != "" {
		for !c.UpdateGate() && ctx.Err() == nil {
			time.Sleep(5 * time.Millisecond)
		}
	}
	ev := update.NewEvent(update.EventAvailable, "0.22.1", "0.22.0", "", time.Now())
	e1 := c.SendWait(&UpdateCheck{}, time.Second)
	e2 := c.SendWait(&UpdateEventMsg{Event: ev}, time.Second)
	c.Send(&State{LocalEnabled: true}) // sınır işareti: her sunucuya yazılır
	var types []string
	for {
		select {
		case typ := <-got:
			types = append(types, typ)
			if typ == tState {
				if announce == "" && (e1 == nil || e2 == nil) {
					t.Errorf("eski sunucuda SendWait başarı döndü: %v %v", e1, e2)
				}
				return types
			}
		case <-ctx.Done():
			t.Fatalf("zaman aşımı: %v", types)
		}
	}
}

func TestAC493NoUpdateMessagesWithoutOffer(t *testing.T) {
	for _, typ := range runUpdateGateCase(t, "") {
		if strings.HasPrefix(typ, "update.") {
			t.Fatalf("eski sunucuya %s yazıldı", typ)
		}
	}
	types := runUpdateGateCase(t, `{"t":"update.none"}`)
	if len(types) < 3 || types[0] != tUpdateCheck || types[1] != tUpdateEvent {
		t.Fatalf("update.none sonrası mesajlar = %v", types)
	}
}

func TestAC493SubprotocolAnnounced(t *testing.T) {
	c, fs, _, _ := startDevice(t, func(ctx context.Context, ws *websocket.Conn) { _, _, _ = ws.Read(ctx) })
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	go func() { _ = c.Run(ctx) }()
	hdr := <-fs.header
	if !strings.Contains(hdr.Get("Sec-WebSocket-Protocol"), DeviceCapUpdate) {
		t.Fatalf("alt protokol = %q", hdr.Get("Sec-WebSocket-Protocol"))
	}
}

// ---- durum.json katı şema (T-6) ----

func TestAC480StateStrictSchema(t *testing.T) {
	good := `{"maxSeen":"0.22.1","phase":"staged","target":"0.22.1","prev":"0.22.0","sha256":"` + strings.Repeat("a", 64) +
		`","nonce":"` + strings.Repeat("A", 43) + `"}`
	if s := ParseUpdateState([]byte(good)); s.Phase != phaseStaged || s.MaxSeen != "0.22.1" {
		t.Fatalf("geçerli durum = %+v", s)
	}
	unknown := strings.Replace(good, `"maxSeen"`, `"x":1,"maxSeen"`, 1)
	if s := ParseUpdateState([]byte(unknown)); s.Phase != "" || s.Nonce != "" || s.MaxSeen != "0.22.1" {
		t.Fatalf("bilinmeyen alanla faz yok sayılmadı: %+v", s)
	}
	badNonce := strings.Replace(good, strings.Repeat("A", 43), "kısa", 1)
	if s := ParseUpdateState([]byte(badNonce)); s.Phase != "" {
		t.Fatalf("geçersiz nonce ile faz kaldı: %+v", s)
	}
	if s := ParseUpdateState(bytes.Repeat([]byte(" "), stateMaxBytes+1)); s.Phase != "" || s.MaxSeen != "" {
		t.Fatal("8 KiB üstü kabul edildi")
	}
}

func TestAC487StateFullFitsLimit(t *testing.T) {
	s := UpdateState{MaxSeen: "999.999.999", Phase: phaseStaged, Target: "999.999.999", Prev: "999.999.998",
		SHA256: strings.Repeat("f", 64), Nonce: strings.Repeat("A", 43),
		Blocked:  &BlockedVersion{Version: "999.999.999", Until: "2026-11-20T00:00:00Z"},
		Recovery: &RecoveryBackup{ResetSec: 86400, Command: strings.Repeat("c", recoveryCmdMax), NonCrash: true}}
	for i := 0; i < recoveryStepMax; i++ {
		s.Recovery.Actions = append(s.Recovery.Actions, RecoveryStep{Type: 3, DelayMs: 4294967295})
	}
	for i := 0; i < update.QueueMax; i++ {
		s.Queue = append(s.Queue, update.Event{Type: update.EventRolledBack, Version: "999.999.999",
			FromVersion: "999.999.998", Reason: update.ReasonPlatformSignature, At: "2026-11-19T10:00:00Z"})
		s.Sent = append(s.Sent, "skipped/999.999.999")
	}
	b, err := s.encode()
	if err != nil || len(b) > stateMaxBytes {
		t.Fatalf("tam durum %d bayt, %v", len(b), err)
	}
	back := ParseUpdateState(b)
	if len(back.Queue) != update.QueueMax || back.Recovery == nil || back.Phase != phaseStaged {
		t.Fatalf("gidiş-dönüş kaybı: kuyruk %d, yedek %v, faz %q", len(back.Queue), back.Recovery, back.Phase)
	}
}

// ---- Açılış uzlaştırması (toplam tablo) ----

func TestAC480PlanStartupTable(t *testing.T) {
	run := update.Version{Minor: 22, Patch: 1}
	base := UpdateState{Target: "0.22.1", Prev: "0.22.0"}
	other := UpdateState{Target: "0.23.0", Prev: "0.22.5"}
	cases := []struct {
		name  string
		phase string
		st    UpdateState
		alive bool
		want  startupPlan
	}{
		{"boşta", "", UpdateState{}, false, startupPlan{finalize: true}},
		{"done", phaseDone, base, false, startupPlan{finalize: true}},
		{"rolled_back", phaseRolledBack, base, false, startupPlan{finalize: true}},
		{"bayat staged", phaseStaged, base, false, startupPlan{write: true, removeStaged: true, finalize: true}},
		{"swapped yeni", phaseSwapped, base, false, startupPlan{}},
		{"swapping yeni", phaseSwapping, base, false, startupPlan{}},
		{"swapped eski", phaseSwapped, UpdateState{Target: "0.23.0", Prev: "0.22.1"}, false,
			startupPlan{write: true, newPhase: phaseRolledBack, rolledBack: "0.23.0", removeStaged: true, finalize: true}},
		{"swapped başka", phaseSwapped, other, false, startupPlan{write: true, removeStaged: true, finalize: true}},
		{"healthy yeni", phaseHealthy, base, false, startupPlan{write: true, newPhase: phaseDone, removeStaged: true, finalize: true}},
		{"healthy başka", phaseHealthy, other, false, startupPlan{write: true, removeStaged: true, finalize: true}},
		{"gözetmen canlı staged", phaseStaged, base, true, startupPlan{}},
		{"gözetmen canlı healthy", phaseHealthy, base, true, startupPlan{awaitSupervisor: true}},
	}
	for _, c := range cases {
		st := c.st
		st.Phase = c.phase
		if got := planStartup(st, run, c.alive); got != c.want {
			t.Errorf("%s: %+v, beklenen %+v", c.name, got, c.want)
		}
	}
}

// ---- Sahte platform ----

type fakeUpdSys struct {
	mu        sync.Mutex
	calls     []string
	alive     bool
	restoreOK bool
	staged    *bytes.Buffer
	nonce     string
	launched  int
	platErr   error
}

func (f *fakeUpdSys) rec(c string) { f.mu.Lock(); f.calls = append(f.calls, c); f.mu.Unlock() }
func (f *fakeUpdSys) callList() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.calls...)
}
func (f *fakeUpdSys) PrepareDir() (bool, error) { return false, nil }

type memStaged struct{ f *fakeUpdSys }

func (m memStaged) Write(p []byte) (int, error) {
	m.f.mu.Lock()
	defer m.f.mu.Unlock()
	return m.f.staged.Write(p)
}
func (m memStaged) Commit() error { m.f.rec("commit"); return nil }
func (m memStaged) Abort()        { m.f.rec("abort") }

func (f *fakeUpdSys) CreateStaged() (StagedFile, error) {
	f.mu.Lock()
	f.staged = &bytes.Buffer{}
	f.mu.Unlock()
	return memStaged{f}, nil
}
func (f *fakeUpdSys) RemoveStaged()             { f.rec("removeStaged") }
func (f *fakeUpdSys) WriteNonce(n string) error { f.mu.Lock(); f.nonce = n; f.mu.Unlock(); return nil }
func (f *fakeUpdSys) PlatformSignature() error  { return f.platErr }
func (f *fakeUpdSys) SupervisorAlive() bool     { f.mu.Lock(); defer f.mu.Unlock(); return f.alive }
func (f *fakeUpdSys) SetDisplayVersion(string)  { f.rec("displayVersion") }
func (f *fakeUpdSys) Cleanup() error            { f.rec("cleanup"); return nil }
func (f *fakeUpdSys) RestoreFailureActions(*RecoveryBackup) error {
	f.rec("restore")
	if !f.restoreOK {
		return errors.New("scm")
	}
	return nil
}
func (f *fakeUpdSys) LaunchSupervisor() (func(), error) {
	f.mu.Lock()
	f.launched++
	f.mu.Unlock()
	return func() {}, nil
}

type fakeLink struct {
	mu   sync.Mutex
	gate bool
	sent []any
}

func (l *fakeLink) UpdateGate() bool { l.mu.Lock(); defer l.mu.Unlock(); return l.gate }
func (l *fakeLink) SendWait(m any, _ time.Duration) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if !l.gate {
		return errUpdateGate
	}
	l.sent = append(l.sent, m)
	return nil
}
func (l *fakeLink) msgs() []any {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]any(nil), l.sent...)
}

// ---- R2-1: önce FailureActions, sonra artık silme ----

func TestR21RestoreBeforeCleanup(t *testing.T) {
	for _, ok := range []bool{true, false} {
		sys := &fakeUpdSys{restoreOK: ok}
		store := &StateStore{Dir: t.TempDir()}
		_, _ = store.Update(func(s *UpdateState) bool {
			s.Phase = phaseDone
			s.Recovery = &RecoveryBackup{ResetSec: 86400, Actions: []RecoveryStep{{Type: 1, DelayMs: 10000}}}
			return true
		})
		u := &Updater{Store: store, Sys: sys, Events: &memEvents{}, Link: &fakeLink{}, Running: update.Version{Minor: 22}}
		u.Startup(context.Background())
		calls := strings.Join(sys.callList(), ",")
		if ok && !strings.Contains(calls, "restore,cleanup") {
			t.Fatalf("sıra = %s", calls)
		}
		if !ok && strings.Contains(calls, "cleanup") {
			t.Fatalf("geri yükleme başarısızken exe.eski silindi: %s", calls)
		}
		if (store.Load().Recovery == nil) != ok {
			t.Fatalf("yedek durumu yanlış (ok=%v)", ok)
		}
	}
}

// ---- Uçtan uca servis akışı (sahte sunucu dosyası + imzalı manifest) ----

type updFixture struct {
	trust  update.Trust
	priv   ed25519.PrivateKey
	body   []byte
	origin *url.URL
	client *http.Client
	bearer chan string
}

func newUpdFixture(t *testing.T) *updFixture {
	t.Helper()
	pub, priv, _ := ed25519.GenerateKey(nil)
	trust, err := update.ParseTrust(update.EnvProd, update.EncodePublicKey(pub))
	if err != nil {
		t.Fatal(err)
	}
	f := &updFixture{trust: trust, priv: priv, body: bytes.Repeat([]byte("MZ-yeni-servis"), 64), bearer: make(chan string, 4)}
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != update.PathServiceFile || r.URL.RawQuery != "" {
			http.NotFound(w, r)
			return
		}
		f.bearer <- r.Header.Get("Authorization")
		_, _ = w.Write(f.body)
	}))
	t.Cleanup(srv.Close)
	f.origin, _ = url.Parse(srv.URL)
	f.client = srv.Client()
	return f
}

func (f *updFixture) offer(t *testing.T, version, policy string, body []byte) *UpdateOffer {
	t.Helper()
	sum := sha256.Sum256(body)
	now := time.Now().UTC().Truncate(time.Second)
	m := update.Manifest{Schema: 1, Env: update.EnvProd, Platform: update.PlatformWindows, Arch: "amd64",
		Component: update.ComponentService, Version: version, SHA256: hex.EncodeToString(sum[:]), Size: int64(len(body)),
		IssuedAt: now.Add(-time.Hour), ExpiresAt: now.Add(30 * 24 * time.Hour), MinUpdaterVersion: "0.22.0"}
	raw := m.Canonical()
	sig := ed25519.Sign(f.priv, update.SignedMessage(raw))
	return &UpdateOffer{Manifest: base64.StdEncoding.EncodeToString(raw), Signature: update.EncodeSignature(sig), Policy: policy}
}

func newTestUpdater(t *testing.T, f *updFixture) (*Updater, *fakeUpdSys, *fakeLink, *Core) {
	t.Helper()
	sys := &fakeUpdSys{restoreOK: true}
	link := &fakeLink{gate: true}
	core := &Core{}
	u := &Updater{Trust: f.trust, Running: update.Version{Minor: 22}, HTTP: f.client, Origin: f.origin,
		Store: &StateStore{Dir: t.TempDir()}, Sys: sys, Events: &memEvents{}, Link: link, Session: core,
		rnd: func() float64 { return 0 }, sleep: func(ctx context.Context, d time.Duration) bool {
			if d >= time.Hour { // belirteç bekleme süresi: test bitene dek dolmaz
				<-ctx.Done()
				return false
			}
			return ctx.Err() == nil
		},
		tm: updTiming{tokenWait: time.Hour}}
	ctx, cancel := context.WithCancel(context.Background())
	// TempDir temizliğinden ÖNCE (LIFO): bağlam iptal + arka plan işleri beklenir (QA P29 Tur 1 m.2).
	t.Cleanup(func() { cancel(); u.Wait() })
	u.Startup(ctx)
	return u, sys, link, core
}

func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	for i := 0; i < 400; i++ {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("beklenen olmadı: %s", what)
}

func hasMsg(link *fakeLink, pred func(any) bool) bool {
	for _, m := range link.msgs() {
		if pred(m) {
			return true
		}
	}
	return false
}

func TestAC480ServiceFlowStagesAndLaunches(t *testing.T) {
	f := newUpdFixture(t)
	u, sys, link, _ := newTestUpdater(t, f)
	u.Offer(f.offer(t, "0.22.1", "auto", f.body))
	eventually(t, "token.request", func() bool {
		return hasMsg(link, func(m any) bool { r, ok := m.(*UpdateTokenRequest); return ok && r.Version == "0.22.1" })
	})
	u.Token(&UpdateToken{Version: "0.22.1", Token: strings.Repeat("A", 43)})
	if got := <-f.bearer; got != "Bearer "+strings.Repeat("A", 43) {
		t.Fatalf("Authorization = %q", got)
	}
	nonce := func() string { sys.mu.Lock(); defer sys.mu.Unlock(); return sys.nonce }
	eventually(t, "staged", func() bool { return u.Store.Load().Phase == phaseStaged && nonce() != "" })
	s := u.Store.Load()
	if s.Target != "0.22.1" || s.Prev != "0.22.0" || s.MaxSeen != "0.22.1" || s.Nonce == "" || nonce() != s.Nonce {
		t.Fatalf("durum = %+v nonce=%q", s, nonce())
	}
	u.flush()
	if !hasMsg(link, func(m any) bool { e, ok := m.(*UpdateEventMsg); return ok && e.Type == update.EventAvailable }) {
		t.Fatal("available olayı gönderilmedi")
	}
	if len(u.Store.Load().Queue) != 0 {
		t.Fatal("gönderilen olay kuyruktan çıkmadı")
	}
	u.tryInstall()
	if sys.mu.Lock(); sys.launched != 1 {
		t.Fatalf("gözetmen başlatma = %d", sys.launched)
	}
	sys.mu.Unlock()
	if !hasMsg(link, func(m any) bool { st, ok := m.(*UpdateStateMsg); return ok && st.Version == "0.22.1" }) {
		t.Fatal("update.state{installing} yok")
	}
}

func TestAC479NoInstallDuringSession(t *testing.T) {
	f := newUpdFixture(t)
	u, sys, _, core := newTestUpdater(t, f)
	_, _ = u.Store.Update(func(s *UpdateState) bool {
		s.Phase, s.Target, s.Prev, s.SHA256, s.Nonce = phaseStaged, "0.22.1", "0.22.0", strings.Repeat("a", 64), strings.Repeat("A", 43)
		return true
	})
	core.cur = &running{sessionID: "01JD0000000000000000000002"}
	u.tryInstall()
	if sys.launched != 0 {
		t.Fatal("oturum sürerken gözetmen başlatıldı")
	}
	core.cur = nil
	// 2 sn penceresinde connect gelirse kurulum iptal (K-P29-12).
	u.sleep = func(ctx context.Context, _ time.Duration) bool {
		core.mu.Lock()
		core.updateConnectLocked()
		core.mu.Unlock()
		return true
	}
	u.tryInstall()
	if sys.launched != 0 {
		t.Fatal("connect sonrası kurulum iptal edilmedi")
	}
	// Kurulum kapısında connect busy ile reddedilir.
	if !core.UpdateBegin() || !core.UpdateCommit() {
		t.Fatal("kapı açılamadı")
	}
	core.mu.Lock()
	busy := core.updateConnectLocked()
	core.mu.Unlock()
	if !busy {
		t.Fatal("kurulum sırasında connect kabul edilir")
	}
}

func TestAC489HashMismatchFails(t *testing.T) {
	f := newUpdFixture(t)
	u, _, link, _ := newTestUpdater(t, f)
	other := bytes.Clone(f.body) // aynı boyut, farklı bayt → HASH_MISMATCH (boyut aşımı DOWNLOAD olurdu)
	other[0] ^= 0xff
	u.Offer(f.offer(t, "0.22.1", "auto", other))
	eventually(t, "token.request", func() bool {
		return hasMsg(link, func(m any) bool { _, ok := m.(*UpdateTokenRequest); return ok })
	})
	u.Token(&UpdateToken{Version: "0.22.1", Token: strings.Repeat("A", 43)})
	<-f.bearer
	eventually(t, "failed(HASH_MISMATCH)", func() bool {
		for _, e := range u.Store.Load().Queue {
			if e.Type == update.EventFailed && e.Reason == update.ReasonHashMismatch {
				return true
			}
		}
		return false
	})
	if u.Store.Load().Phase != "" {
		t.Fatal("bozuk indirme sahnelendi")
	}
	// Olay günlüğü kuyruk kaydından hemen sonra yazılır; yarış olmasın diye beklenir (CI linux-gui'de görüldü).
	eventually(t, "olay günlüğü 1012", func() bool {
		ids := u.Events.(*memEvents).ids()
		return len(ids) > 0 && ids[len(ids)-1] == EvUpdateRejected
	})
}

func TestAC485PolicyNotifyNoDownload(t *testing.T) {
	f := newUpdFixture(t)
	u, _, link, _ := newTestUpdater(t, f)
	u.Offer(f.offer(t, "0.22.1", "notify", f.body))
	time.Sleep(20 * time.Millisecond)
	if hasMsg(link, func(m any) bool { _, ok := m.(*UpdateTokenRequest); return ok }) {
		t.Fatal("notify politikasında belirteç istendi")
	}
	q := u.Store.Load().Queue
	if len(q) != 2 || q[1].Reason != update.ReasonPolicyOff {
		t.Fatalf("kuyruk = %+v", q)
	}
}

func TestAC480BlockedVersionSkipped(t *testing.T) {
	f := newUpdFixture(t)
	u, _, link, _ := newTestUpdater(t, f)
	_, _ = u.Store.Update(func(s *UpdateState) bool { s.block("0.22.1", time.Now()); return true })
	u.Offer(f.offer(t, "0.22.1", "auto", f.body))
	time.Sleep(20 * time.Millisecond)
	if hasMsg(link, func(m any) bool { _, ok := m.(*UpdateTokenRequest); return ok }) || len(u.Store.Load().Queue) != 0 {
		t.Fatal("24 sa blok uygulanmadı")
	}
}

func TestAC480NewServiceMarksHealthy(t *testing.T) {
	f := newUpdFixture(t)
	u, sys, _, _ := newTestUpdater(t, f)
	u.Running = update.Version{Minor: 22, Patch: 1}
	_, _ = u.Store.Update(func(s *UpdateState) bool {
		s.Phase, s.Target, s.Prev, s.SHA256, s.Nonce = phaseSwapped, "0.22.1", "0.22.0", strings.Repeat("a", 64), strings.Repeat("A", 43)
		return true
	})
	sys.alive = true
	var cmu sync.Mutex
	clock := time.Unix(0, 0)
	u.now = func() time.Time { cmu.Lock(); defer cmu.Unlock(); return clock }
	u.sleep = func(ctx context.Context, d time.Duration) bool {
		cmu.Lock()
		clock = clock.Add(d)
		cmu.Unlock()
		return ctx.Err() == nil
	}
	u.markHealthy() // gözetmen 90 sn boyunca canlı: done yazılmaz (sahte saat)
	s := u.Store.Load()
	if s.Phase != phaseHealthy || s.Nonce != strings.Repeat("A", 43) || len(s.Queue) != 1 || s.Queue[0].Type != update.EventInstalled {
		t.Fatalf("durum = %+v", s)
	}
	// Gözetmen yoksa tamamlamayı servis yapar (done + R2-1 sırası).
	sys.mu.Lock()
	sys.alive = false
	sys.mu.Unlock()
	u.finishAfterHealthy()
	if u.Store.Load().Phase != phaseDone || !strings.Contains(strings.Join(sys.callList(), ","), "restore,cleanup") {
		t.Fatalf("tamamlama = %q, çağrılar %v", u.Store.Load().Phase, sys.callList())
	}
}

// ---- Gözetmen / kurtarma ----

type fakeApplySys struct {
	calls     []string
	system    bool
	busy      bool
	nonce     string
	copyErr   error
	stopped   bool
	store     *StateStore
	healthy   bool
	recreated bool
}

func (f *fakeApplySys) rec(c string)        { f.calls = append(f.calls, c) }
func (f *fakeApplySys) IsLocalSystem() bool { return f.system }
func (f *fakeApplySys) AcquireSupervisor() (func(), bool) {
	if f.busy {
		return nil, false
	}
	return func() { f.rec("release") }, true
}
func (f *fakeApplySys) PrepareDir() (bool, error)    { f.rec("prepare"); return f.recreated, nil }
func (f *fakeApplySys) ReadNonce() (string, error)   { f.rec("nonce"); return f.nonce, nil }
func (f *fakeApplySys) CopyStagedToNew(string) error { f.rec("copy"); return f.copyErr }
func (f *fakeApplySys) QueryFailureActions() (RecoveryBackup, error) {
	return RecoveryBackup{ResetSec: 86400, Actions: []RecoveryStep{{Type: 1, DelayMs: 10000}}}, nil
}
func (f *fakeApplySys) SetRecoverActions() error                    { f.rec("setRecover"); return nil }
func (f *fakeApplySys) RestoreFailureActions(*RecoveryBackup) error { f.rec("restore"); return nil }
func (f *fakeApplySys) StopService() error                          { f.rec("stop"); return nil }
func (f *fakeApplySys) StartService() error {
	f.rec("start")
	if f.healthy {
		_, _ = f.store.Update(func(s *UpdateState) bool {
			if s.Phase == phaseSwapped {
				s.Phase = phaseHealthy
			}
			return true
		})
	}
	return nil
}
func (f *fakeApplySys) ServiceStopped() (bool, error) { return f.stopped, nil }
func (f *fakeApplySys) Swap() error                   { f.rec("swap"); return nil }
func (f *fakeApplySys) RollbackFiles() error          { f.rec("rollbackFiles"); return nil }
func (f *fakeApplySys) RemoveStaged()                 { f.rec("removeStaged") }
func (f *fakeApplySys) RemoveNew()                    { f.rec("removeNew") }

func stagedSupervisor(t *testing.T, sys *fakeApplySys) *Supervisor {
	t.Helper()
	store := &StateStore{Dir: t.TempDir()}
	nonce := strings.Repeat("N", 43)
	_, _ = store.Update(func(s *UpdateState) bool {
		s.Phase, s.Target, s.Prev, s.SHA256, s.Nonce = phaseStaged, "0.22.1", "0.22.0", strings.Repeat("a", 64), nonce
		return true
	})
	if sys.nonce == "" {
		sys.nonce = nonce
	}
	sys.store = store
	clock := time.Unix(0, 0)
	return &Supervisor{Sys: sys, Store: store, Events: &memEvents{}, now: func() time.Time { return clock },
		sleep: func(d time.Duration) { clock = clock.Add(d) }}
}

func TestAC480SupervisorSuccess(t *testing.T) {
	sys := &fakeApplySys{system: true, healthy: true}
	sup := stagedSupervisor(t, sys)
	if r := sup.Apply(); r != ApplyOK {
		t.Fatalf("Apply = %d, çağrılar %v", r, sys.calls)
	}
	want := "prepare,nonce,copy,setRecover,stop,swap,start,restore,removeStaged,release"
	if got := strings.Join(sys.calls, ","); got != want {
		t.Fatalf("sıra %s, beklenen %s", got, want)
	}
	if s := sup.Store.Load(); s.Phase != phaseDone || s.Recovery != nil {
		t.Fatalf("durum = %+v", s)
	}
}

func TestAC480SupervisorHealthTimeoutRollsBack(t *testing.T) {
	sys := &fakeApplySys{system: true}
	sup := stagedSupervisor(t, sys)
	if r := sup.Apply(); r != ApplyRolledBack {
		t.Fatalf("Apply = %d", r)
	}
	if got := strings.Join(sys.calls, ","); !strings.Contains(got, "swap,start,stop,rollbackFiles,start,restore") {
		t.Fatalf("geri dönüş sırası = %s", got)
	}
	s := sup.Store.Load()
	if s.Phase != phaseRolledBack || !s.blocked("0.22.1", time.Unix(0, 0)) || len(s.Queue) != 1 ||
		s.Queue[0].Type != update.EventRolledBack || s.Queue[0].Reason != update.ReasonHealth {
		t.Fatalf("durum = %+v", s)
	}
}

func TestAC480SupervisorGuards(t *testing.T) {
	cases := []struct {
		name string
		sys  *fakeApplySys
		want int
	}{
		{"LocalSystem değil", &fakeApplySys{}, ApplyDenied},
		{"mutex tutulu (ikinci gözetmen)", &fakeApplySys{system: true, busy: true}, ApplyBusy},
		{"nonce uyuşmuyor", &fakeApplySys{system: true, nonce: strings.Repeat("X", 43)}, ApplyNothing},
	}
	for _, c := range cases {
		sup := stagedSupervisor(t, c.sys)
		if r := sup.Apply(); r != c.want {
			t.Errorf("%s: %d, beklenen %d", c.name, r, c.want)
		}
		for _, call := range c.sys.calls {
			if call == "stop" || call == "swap" || call == "copy" {
				t.Errorf("%s: %s çağrıldı", c.name, call)
			}
		}
	}
	sys := &fakeApplySys{system: true, copyErr: ErrStagedHash}
	sup := stagedSupervisor(t, sys)
	if r := sup.Apply(); r != ApplyFailed {
		t.Fatalf("hash: %d", r)
	}
	if q := sup.Store.Load().Queue; len(q) != 1 || q[0].Reason != update.ReasonHashMismatch {
		t.Fatalf("kuyruk = %+v", q)
	}
}

func TestT3RecoverRollsBackOnlyWhenSwapped(t *testing.T) {
	sys := &fakeApplySys{system: true}
	sup := stagedSupervisor(t, sys)
	_, _ = sup.Store.Update(func(s *UpdateState) bool { s.Phase = phaseSwapped; return true })
	if r := sup.Recover(); r != ApplyRolledBack || !strings.HasPrefix(strings.Join(sys.calls, ","), "rollbackFiles,start,restore") {
		t.Fatalf("Recover = %d, %v", r, sys.calls)
	}
	sys2 := &fakeApplySys{system: true}
	sup2 := stagedSupervisor(t, sys2)
	_, _ = sup2.Store.Update(func(s *UpdateState) bool { s.clearPhase(phaseDone); return true })
	if r := sup2.Recover(); r != ApplyNothing || strings.Contains(strings.Join(sys2.calls, ","), "rollbackFiles") {
		t.Fatalf("done fazında geri dönüldü: %v", sys2.calls)
	}
	sys3 := &fakeApplySys{system: true, busy: true}
	if r := stagedSupervisor(t, sys3).Recover(); r != ApplyBusy || len(sys3.calls) != 0 {
		t.Fatalf("gözetmen canlıyken kurtarma çalıştı: %v", sys3.calls)
	}
}

func TestKP2921PipeStatusVersion(t *testing.T) {
	c := &Core{Switch: &memSwitch{on: true}, Version: "0.22.1"}
	resp := HandlePipe(c, []byte(`{"cmd":"status"}`), "", false)
	if !resp.OK || resp.Version != "0.22.1" || len(EncodePipeResponse(resp)) > MaxPipeLine {
		t.Fatalf("yanıt = %+v", resp)
	}
}

// Gözetmen staged'i tüketmeden çıkarsa (nonce/mutex reddi) sahne temizlenir: ikinci tryInstall yeni gözetmen başlatmaz.
func TestAC480SupervisorExitWithoutApplyNoLoop(t *testing.T) {
	f := newUpdFixture(t)
	u, sys, _, _ := newTestUpdater(t, f)
	_, _ = u.Store.Update(func(s *UpdateState) bool {
		s.Phase, s.Target, s.Prev, s.SHA256, s.Nonce = phaseStaged, "0.22.1", "0.22.0", strings.Repeat("a", 64), strings.Repeat("A", 43)
		return true
	})
	u.tryInstall()
	eventually(t, "gözetmen çıkışı işlendi", func() bool {
		u.mu.Lock()
		defer u.mu.Unlock()
		return !u.applying
	})
	u.tryInstall()
	sys.mu.Lock()
	n := sys.launched
	sys.mu.Unlock()
	if n != 1 {
		t.Fatalf("gözetmen %d kez başlatıldı", n)
	}
	s := u.Store.Load()
	if s.Phase != "" || len(s.Queue) != 1 || s.Queue[0].Reason != update.ReasonInstall {
		t.Fatalf("durum = %+v", s)
	}
}

// ---- P29 düzeltme turu 1 ----

// S-P29-K-2: klasör doğrulaması durum.json/apply.nonce okunmadan önce; güvensiz klasör → okuma yok.
func TestSP29K2VerifyDirBeforeRead(t *testing.T) {
	sys := &fakeApplySys{system: true, recreated: true}
	sup := stagedSupervisor(t, sys)
	if r := sup.Apply(); r != ApplyFailed {
		t.Fatalf("Apply = %d", r)
	}
	if got := strings.Join(sys.calls, ","); got != "prepare,release" {
		t.Fatalf("çağrılar = %s (nonce/kopya olmamalı)", got)
	}
	if ids := sup.Events.(*memEvents).ids(); len(ids) != 1 || ids[0] != EvUpdateRejected {
		t.Fatalf("olay 1012 yok: %v", ids)
	}
}

// AC-476 karar tablosu: çalışan imzasız → atla; imzalı → yeni imzalı + aynı yaprak sertifika.
func TestAC476CheckPublisher(t *testing.T) {
	d1, d2 := [32]byte{1}, [32]byte{2}
	cases := []struct {
		name               string
		selfSigned, newSig bool
		newDigest          [32]byte
		digestErr          error
		ok                 bool
	}{
		{"çalışan imzasız → atla", false, false, d2, nil, true},
		{"çalışan imzasız, yeni imzalı → atla", false, true, d2, nil, true},
		{"imzalı → imzasız ret", true, false, d1, nil, false},
		{"imzalı → farklı yayıncı ret", true, true, d2, nil, false},
		{"imzalı → özet okunamadı ret", true, true, d1, errors.New("crypt32"), false},
		{"imzalı → aynı yayıncı kabul", true, true, d1, nil, true},
	}
	for _, c := range cases {
		signed := func(p string) bool {
			if p == "self" {
				return c.selfSigned
			}
			return c.newSig
		}
		digest := func(p string) ([32]byte, error) {
			if p == "self" {
				return d1, nil
			}
			return c.newDigest, c.digestErr
		}
		err := checkPublisher(signed, digest, "self", "new")
		if (err == nil) != c.ok || (err != nil && !errors.Is(err, ErrPlatformSignature)) {
			t.Errorf("%s: %v", c.name, err)
		}
	}
}

// AC-476 servis akışı: platform imzası reddi → failed(PLATFORM_SIGNATURE) + yeni.bin silinir + gözetmen yok + 1012 + blok.
func TestAC476ServicePlatformSignatureRejected(t *testing.T) {
	f := newUpdFixture(t)
	u, sys, link, _ := newTestUpdater(t, f)
	sys.platErr = ErrPlatformSignature
	u.Offer(f.offer(t, "0.22.1", "auto", f.body))
	eventually(t, "token.request", func() bool {
		return hasMsg(link, func(m any) bool { _, ok := m.(*UpdateTokenRequest); return ok })
	})
	u.Token(&UpdateToken{Version: "0.22.1", Token: strings.Repeat("A", 43)})
	<-f.bearer
	eventually(t, "failed(PLATFORM_SIGNATURE)", func() bool {
		for _, e := range u.Store.Load().Queue {
			if e.Type == update.EventFailed && e.Reason == update.ReasonPlatformSignature {
				return true
			}
		}
		return false
	})
	s := u.Store.Load()
	if s.Phase != "" || !s.blocked("0.22.1", time.Now()) {
		t.Fatalf("durum = %+v", s)
	}
	if !strings.Contains(strings.Join(sys.callList(), ","), "commit,removeStaged") {
		t.Fatalf("yeni.bin silinmedi: %v", sys.callList())
	}
	u.tryInstall()
	sys.mu.Lock()
	n := sys.launched
	sys.mu.Unlock()
	if n != 0 {
		t.Fatal("imza reddinden sonra gözetmen başlatıldı")
	}
	if ids := u.Events.(*memEvents).ids(); len(ids) == 0 || ids[len(ids)-1] != EvUpdateRejected {
		t.Fatalf("olay günlüğü 1012 yok: %v", ids)
	}
	// S-P29-K-3: engelli sürüm aynı teklifte yeniden indirilmez.
	before := len(link.msgs())
	u.Offer(f.offer(t, "0.22.1", "auto", f.body))
	time.Sleep(20 * time.Millisecond)
	for _, m := range link.msgs()[before:] {
		if _, ok := m.(*UpdateTokenRequest); ok {
			t.Fatal("başarısız sürüm 24 sa içinde yeniden istendi")
		}
	}
}

// S-P29-K-3: süresi dolan / önceki bağlantıda kuyruğa alınan update.state sonraki sokete yazılmaz.
func TestSP29K3StaleUpdateStateDropped(t *testing.T) {
	got := make(chan string, 32)
	c, _, _, _ := startDevice(t, collectTypes(`{"t":"update.none"}`, got))
	if err := c.SendWait(&UpdateStateMsg{Phase: UpdatePhaseInstalling, Version: "0.22.1"}, time.Millisecond); err == nil {
		t.Fatal("bağlantı yokken SendWait başarı döndü")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	go func() { _ = c.Run(ctx) }()
	for !c.UpdateGate() && ctx.Err() == nil {
		time.Sleep(5 * time.Millisecond)
	}
	c.Send(&State{LocalEnabled: true})
	for {
		select {
		case typ := <-got:
			if typ == tUpdateState {
				t.Fatal("bayat update.state yeni sokete yazıldı")
			}
			if typ == tState {
				return
			}
		case <-ctx.Done():
			t.Fatal("zaman aşımı")
		}
	}
}
