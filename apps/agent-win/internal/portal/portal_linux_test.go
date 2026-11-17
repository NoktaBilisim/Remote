//go:build linux

package portal

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/godbus/dbus/v5"
)

const (
	me      = ":1.77"
	portalU = ":1.5"
	foreign = ":1.99"
)

// fakeBus sahte oturum veri yolu: gerçek uyarlayıcıyla aynı router; Call betikli işleyiciye gider.
type fakeBus struct {
	r      *router
	mu     sync.Mutex
	owners map[string]string
	calls  []string
	handle func(dest string, path dbus.ObjectPath, method string, args []any) ([]any, error)
}

func newFake() *fakeBus {
	return &fakeBus{r: newRouter(), owners: map[string]string{desktopName: portalU}}
}

func (f *fakeBus) Unique() string { return me }
func (f *fakeBus) Owner(name string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if o, ok := f.owners[name]; ok {
		return o, nil
	}
	return "", errors.New("yok")
}
func (f *fakeBus) Call(_ context.Context, dest string, path dbus.ObjectPath, method string, args ...any) ([]any, error) {
	f.mu.Lock()
	f.calls = append(f.calls, method)
	h := f.handle
	f.mu.Unlock()
	return h(dest, path, method, args)
}
func (f *fakeBus) Watch(m Match) (*Sub, error) {
	if m.Sender == "" {
		return nil, errNoSender
	}
	return f.r.add(m, nil), nil
}
func (f *fakeBus) Close() error { return nil }

func (f *fakeBus) emit(sender string, path dbus.ObjectPath, name string, body ...any) {
	f.r.deliver(&dbus.Signal{Sender: sender, Path: path, Name: name, Body: body})
}

// portalScript tipik başarılı portal davranışı; değiştirilebilir alanlarla.
type portalScript struct {
	f          *fakeBus
	startCode  uint32
	devices    *uint32
	streams    [][]any
	badPath    bool
	foreignRes bool // önce yabancı gönderenden sahte yanıt
	fd         int
}

func socketFD(t *testing.T) int {
	t.Helper()
	fds, err := syscall.Socketpair(syscall.AF_UNIX, syscall.SOCK_STREAM, 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = syscall.Close(fds[1]) })
	return fds[0]
}

func size(w, h int32) dbus.Variant { return dbus.MakeVariant(struct{ W, H int32 }{w, h}) }

func (p *portalScript) install() {
	p.f.handle = func(dest string, path dbus.ObjectPath, method string, args []any) ([]any, error) {
		if dest != portalU {
			return nil, errors.New("hedef sahip değil")
		}
		switch method {
		case ifProps + ".Get":
			return []any{dbus.MakeVariant(uint32(2))}, nil
		case ifCast + ".OpenPipeWireRemote":
			return []any{dbus.UnixFD(p.fd)}, nil
		case ifSession + ".Close", ifRequest + ".Close":
			return nil, nil
		}
		if strings.HasPrefix(method, ifRemote+".Notify") {
			if p.devices == nil || *p.devices == 0 {
				return nil, errors.New("Session is not allowed to call NotifyPointer methods")
			}
			return nil, nil
		}
		opts := args[len(args)-1].(map[string]dbus.Variant)
		tok := opts["handle_token"].Value().(string)
		rp := requestPath(me, tok)
		ret := rp
		if p.badPath {
			ret = "/org/freedesktop/portal/desktop/request/x/y"
		}
		res := map[string]dbus.Variant{}
		code := uint32(0)
		switch {
		case strings.HasSuffix(method, "CreateSession"):
			res["session_handle"] = dbus.MakeVariant(string(sessionPath(me, opts["session_handle_token"].Value().(string))))
		case strings.HasSuffix(method, ".Start"):
			code = p.startCode
			res["streams"] = dbus.MakeVariant(p.streams)
			if p.devices != nil {
				res["devices"] = dbus.MakeVariant(*p.devices)
			}
		}
		go func() {
			time.Sleep(5 * time.Millisecond)
			if p.foreignRes {
				p.f.emit(foreign, rp, ifRequest+".Response", uint32(0), map[string]dbus.Variant{})
			}
			p.f.emit(portalU, rp, ifRequest+".Response", code, res)
		}()
		return []any{ret}, nil
	}
}

func okStreams() [][]any {
	return [][]any{{uint32(42), map[string]dbus.Variant{"size": size(1920, 1080)}}}
}

func u32(v uint32) *uint32 { return &v }

func open(t *testing.T, p *portalScript, control bool) (*Session, error) {
	t.Helper()
	p.install()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return Open(ctx, p.f, Options{Parent: "x11:1a", Control: control})
}

func TestAC399P28gPortalAcceptControl(t *testing.T) {
	p := &portalScript{f: newFake(), devices: u32(3), streams: okStreams(), fd: socketFD(t)}
	s, err := open(t, p, true)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if !s.CanControl() || s.Stream() != (Stream{Node: 42, W: 1920, H: 1080}) {
		t.Fatalf("sonuç: %+v %v", s.Stream(), s.Devices())
	}
	if fl, _ := fcntl(s.FD()); fl&syscall.FD_CLOEXEC == 0 {
		t.Fatal("fd CLOEXEC değil")
	}
	want := []string{ifProps + ".Get", ifProps + ".Get", ifRemote + ".CreateSession", ifRemote + ".SelectDevices",
		ifCast + ".SelectSources", ifRemote + ".Start", ifCast + ".OpenPipeWireRemote"}
	if strings.Join(p.f.calls, ",") != strings.Join(want, ",") {
		t.Fatalf("çağrı sırası: %v", p.f.calls)
	}
}

func fcntl(fd int) (int, error) {
	r, _, e := syscall.Syscall(syscall.SYS_FCNTL, uintptr(fd), syscall.F_GETFD, 0)
	if e != 0 {
		return 0, e
	}
	return int(r), nil
}

func TestAC399P28gPortalDevicesZeroIsViewOnly(t *testing.T) {
	p := &portalScript{f: newFake(), devices: u32(0), streams: okStreams(), fd: socketFD(t)}
	s, err := open(t, p, true)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if s.CanControl() {
		t.Fatal("devices=0 kontrol vermemeli")
	}
	if err := s.PointerButton(BtnLeft, true); !errors.Is(err, ErrNotAllowed) {
		t.Fatalf("izin yok bekleniyordu: %v", err)
	}
}

func TestAC399P28gPortalViewOnlyNoRemoteDesktop(t *testing.T) {
	p := &portalScript{f: newFake(), streams: okStreams(), fd: socketFD(t)}
	s, err := open(t, p, false)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for _, c := range p.f.calls {
		if strings.HasPrefix(c, ifRemote) {
			t.Fatalf("yalnız görüntüde RemoteDesktop çağrılmamalı: %v", p.f.calls)
		}
	}
}

func TestAC399P28gPortalCancelAndDeny(t *testing.T) {
	for code, want := range map[uint32]error{1: ErrCancelled, 2: ErrDenied} {
		p := &portalScript{f: newFake(), startCode: code, streams: okStreams(), fd: socketFD(t)}
		if _, err := open(t, p, true); !errors.Is(err, want) {
			t.Fatalf("kod %d: %v", code, err)
		}
		if p.f.calls[len(p.f.calls)-1] != ifSession+".Close" {
			t.Fatalf("hata yolunda oturum kapanmalı: %v", p.f.calls)
		}
	}
}

func TestAC399P28gPortalProtocolBounds(t *testing.T) {
	two := append(okStreams(), okStreams()[0])
	big := [][]any{{uint32(1), map[string]dbus.Variant{"size": size(20000, 10)}}}
	nosize := [][]any{{uint32(1), map[string]dbus.Variant{}}}
	cases := map[string]*portalScript{
		"iki akış":    {streams: two, devices: u32(3)},
		"büyük boyut": {streams: big, devices: u32(3)},
		"boyut yok":   {streams: nosize, devices: u32(3)},
		"dokunmatik":  {streams: okStreams(), devices: u32(7)},
		"yanlış yol":  {streams: okStreams(), devices: u32(3), badPath: true},
	}
	for name, p := range cases {
		p.f, p.fd = newFake(), socketFD(t)
		if _, err := open(t, p, true); !errors.Is(err, ErrProtocol) {
			t.Fatalf("%s: ErrProtocol bekleniyordu: %v", name, err)
		}
	}
	// soket olmayan fd
	f, _ := os.Open(os.DevNull)
	defer f.Close()
	p := &portalScript{f: newFake(), streams: okStreams(), devices: u32(3), fd: int(f.Fd())}
	if _, err := open(t, p, true); !errors.Is(err, ErrProtocol) {
		t.Fatalf("soket olmayan fd: %v", err)
	}
}

func TestAC399P28gPortalForeignSenderIgnored(t *testing.T) {
	p := &portalScript{f: newFake(), startCode: 1, foreignRes: true, streams: okStreams(), fd: socketFD(t)}
	// yabancı gönderen "başarı" yollasa da gerçek sahibin iptali geçerli olmalı
	if _, err := open(t, p, true); !errors.Is(err, ErrCancelled) {
		t.Fatalf("yabancı gönderen kabul edildi: %v", err)
	}
}

func TestAC399P28gPortalUnavailable(t *testing.T) {
	f := newFake()
	f.owners = map[string]string{}
	f.handle = func(string, dbus.ObjectPath, string, []any) ([]any, error) { return nil, errors.New("yok") }
	if _, err := Open(context.Background(), f, Options{}); !errors.Is(err, ErrUnavailable) {
		t.Fatal(err)
	}
}

func TestAC102P28gPortalClosedSignal(t *testing.T) {
	p := &portalScript{f: newFake(), devices: u32(3), streams: okStreams(), fd: socketFD(t)}
	s, err := open(t, p, true)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	p.f.emit(foreign, s.handle, ifSession+".Closed", map[string]dbus.Variant{})
	select {
	case <-s.Closed():
		t.Fatal("yabancı Closed kabul edildi")
	case <-time.After(30 * time.Millisecond):
	}
	t0 := time.Now()
	p.f.emit(portalU, s.handle, ifSession+".Closed", map[string]dbus.Variant{})
	select {
	case <-s.Closed():
		if d := time.Since(t0); d > 100*time.Millisecond {
			t.Fatalf("Closed geç: %v", d)
		}
	case <-time.After(time.Second):
		t.Fatal("Closed işlenmedi")
	}
	if err := s.KeyboardKeycode(30, true); !errors.Is(err, ErrClosed) {
		t.Fatalf("kapalı oturumda Notify: %v", err)
	}
}

func TestAC399P28gLockWatcher(t *testing.T) {
	f := newFake()
	f.owners[saverName] = ":1.8"
	var mu sync.Mutex
	active, fail := false, false
	f.handle = func(dest string, _ dbus.ObjectPath, method string, _ []any) ([]any, error) {
		mu.Lock()
		defer mu.Unlock()
		if fail || dest != ":1.8" {
			return nil, errors.New("hata")
		}
		return []any{active}, nil
	}
	ch := make(chan LockState, 8)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	w := WatchLock(ctx, f, func(s LockState) { ch <- s })
	if st := w.State(); !st.Known || st.Locked {
		t.Fatalf("ilk durum: %+v", st)
	}
	f.emit(foreign, saverPath, saverIface+".ActiveChanged", true)
	select {
	case s := <-ch:
		t.Fatalf("yabancı sinyal kabul edildi: %+v", s)
	case <-time.After(30 * time.Millisecond):
	}
	t0 := time.Now()
	f.emit(":1.8", saverPath, saverIface+".ActiveChanged", true)
	if s := <-ch; !s.Locked || time.Since(t0) > 100*time.Millisecond {
		t.Fatalf("kilit ≤ 100 ms: %+v %v", s, time.Since(t0))
	}
	mu.Lock()
	fail = true
	mu.Unlock()
	select {
	case s := <-ch:
		if s.Known {
			t.Fatalf("okunamayan durum bilinmez olmalı: %+v", s)
		}
	case <-time.After(2500 * time.Millisecond):
		t.Fatal("yoklama okuma hatasını bildirmedi")
	}
}

func TestAC399P28gLockGuard(t *testing.T) {
	cases := []struct {
		keys, off any
		ok        bool
	}{
		{[]string{"<Super>l"}, false, true},
		{[]string{}, false, false},
		{[]string{""}, false, false},
		{"<Super>l", false, true},
		{[]string{"<Super>l"}, true, false},
		{uint32(1), false, false},
		{[]string{"<Super>l"}, "x", false},
	}
	for i, c := range cases {
		if g := lockGuardOf(c.keys, c.off); g.OK() != c.ok {
			t.Fatalf("%d: %+v", i, g)
		}
	}
	f := newFake()
	f.handle = func(_ string, _ dbus.ObjectPath, _ string, args []any) ([]any, error) {
		if args[1] == keyLock {
			return []any{dbus.MakeVariant(dbus.MakeVariant([]string{"<Super>l"}))}, nil // eski iç içe varyant
		}
		return []any{dbus.MakeVariant(false)}, nil
	}
	if g := ReadLockGuard(f); !g.OK() {
		t.Fatalf("iç içe varyant: %+v", g)
	}
}
