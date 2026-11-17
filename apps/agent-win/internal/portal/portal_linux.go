//go:build linux

package portal

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/godbus/dbus/v5"
	"golang.org/x/sys/unix"
)

// Portal adları (xdg-desktop-portal belgesi).
const (
	desktopName = "org.freedesktop.portal.Desktop"
	desktopPath = dbus.ObjectPath("/org/freedesktop/portal/desktop")
	ifRemote    = "org.freedesktop.portal.RemoteDesktop"
	ifCast      = "org.freedesktop.portal.ScreenCast"
	ifRequest   = "org.freedesktop.portal.Request"
	ifSession   = "org.freedesktop.portal.Session"
	ifProps     = "org.freedesktop.DBus.Properties"
)

// Aygıt bitleri (RemoteDesktop AvailableDeviceTypes / devices).
const (
	DevKeyboard uint32 = 1
	DevPointer  uint32 = 2
	DevControl         = DevKeyboard | DevPointer
)

const (
	sourceMonitor  uint32 = 1
	cursorEmbedded uint32 = 2
	persistNone    uint32 = 0
	maxStreamSide         = 16384
	// startWait kullanıcının sistem diyaloğunda karar vermesi için üst sınır (aşılırsa iptal sayılır).
	startWait = 5 * time.Minute
)

// Hatalar. Arayüz bunları sabit metinlere eşler (messages_p28g.go); ayrıntı kullanıcıya gösterilmez.
var (
	// ErrUnavailable portal hizmeti ya da ScreenCast/RemoteDesktop arayüzü yok (A-PG-2, §14 m.11).
	ErrUnavailable = errors.New("portal: ekran paylaşımı bileşeni yok")
	// ErrCancelled kullanıcı sistem diyaloğunda vazgeçti (yanıt kodu 1) ya da süre doldu.
	ErrCancelled = errors.New("portal: paylaşım başlatılmadı")
	// ErrDenied portal isteği başka nedenle reddetti (yanıt kodu 2).
	ErrDenied = errors.New("portal: paylaşım reddedildi")
	// ErrProtocol yanıt beklenen biçimde değil (yol, akış sayısı, boyut, aygıt bitleri, fd) — fail-closed.
	ErrProtocol = errors.New("portal: beklenmeyen yanıt")
	// ErrNotAllowed Notify* reddedildi (aygıt izni yok ya da oturum geçersiz; §14 m.6: çökme değil "izin yok").
	ErrNotAllowed = errors.New("portal: girdi izni yok")
	// ErrClosed oturum kapandı (Closed sinyali ya da Close).
	ErrClosed = errors.New("portal: oturum kapandı")
)

// Options oturum seçenekleri.
type Options struct {
	// Parent üst pencere tanıtıcısı ("x11:<onaltılı XID>"; boş olabilir).
	Parent string
	// Control RemoteDesktop (klavye + işaretçi) de istenir; false → yalnız ScreenCast (FAIL dalı / D-Bus kuralı, §5.2b m.6–7).
	Control bool
}

// Stream portalın verdiği tek PipeWire akışı.
type Stream struct {
	Node uint32
	W, H int
}

// Session açık portal oturumu.
type Session struct {
	bus     Bus
	owner   string
	handle  dbus.ObjectPath
	devices uint32
	stream  Stream
	fd      int

	closed    chan struct{}
	closeOnce sync.Once
	sub       *Sub
}

// newToken 128 bit rastgele belirteç (S-P28g-10). Nesne yolu öğesi olduğundan yalnız [A-Za-z0-9_].
func newToken() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return "nd_" + hex.EncodeToString(b[:]), nil
}

// senderPart benzersiz adın nesne yolu biçimi (":1.42" → "1_42").
func senderPart(unique string) string {
	return strings.ReplaceAll(strings.TrimPrefix(unique, ":"), ".", "_")
}

func requestPath(unique, token string) dbus.ObjectPath {
	return dbus.ObjectPath("/org/freedesktop/portal/desktop/request/" + senderPart(unique) + "/" + token)
}

func sessionPath(unique, token string) dbus.ObjectPath {
	return dbus.ObjectPath("/org/freedesktop/portal/desktop/session/" + senderPart(unique) + "/" + token)
}

// Open birleşik oturumu kurar: CreateSession → (Control ise) SelectDevices(KEYBOARD|POINTER) → SelectSources(MONITOR,
// tek, imleç gömülü, persist_mode=0) → Start(parent) → OpenPipeWireRemote. Start sistem diyaloğunu açar ve kullanıcı
// karar verene kadar bekler (ctx ya da startWait). Hata yollarında oturum kapatılır.
func Open(ctx context.Context, b Bus, o Options) (*Session, error) {
	owner, err := b.Owner(desktopName)
	if err != nil || owner == "" {
		return nil, ErrUnavailable
	}
	s := &Session{bus: b, owner: owner, fd: -1, closed: make(chan struct{})}
	if err := s.checkInterfaces(ctx, o.Control); err != nil {
		return nil, err
	}
	iface := ifCast
	if o.Control {
		iface = ifRemote
	}
	stok, err := newToken()
	if err != nil {
		return nil, err
	}
	res, err := s.request(ctx, iface, "CreateSession", callTimeout, nil,
		map[string]dbus.Variant{"session_handle_token": dbus.MakeVariant(stok)})
	if err != nil {
		return nil, err
	}
	if err := s.adoptHandle(res, sessionPath(b.Unique(), stok)); err != nil {
		return nil, err
	}
	ok := false
	defer func() {
		if !ok {
			s.Close()
		}
	}()
	if o.Control {
		if _, err := s.request(ctx, ifRemote, "SelectDevices", callTimeout, []any{s.handle},
			map[string]dbus.Variant{"types": dbus.MakeVariant(DevControl), "persist_mode": dbus.MakeVariant(persistNone)}); err != nil {
			return nil, err
		}
	}
	if _, err := s.request(ctx, ifCast, "SelectSources", callTimeout, []any{s.handle},
		map[string]dbus.Variant{"types": dbus.MakeVariant(sourceMonitor), "multiple": dbus.MakeVariant(false),
			"cursor_mode": dbus.MakeVariant(cursorEmbedded), "persist_mode": dbus.MakeVariant(persistNone)}); err != nil {
		return nil, err
	}
	res, err = s.request(ctx, iface, "Start", startWait, []any{s.handle, o.Parent}, map[string]dbus.Variant{})
	if err != nil {
		return nil, err
	}
	if err := s.adoptStart(res, o.Control); err != nil {
		return nil, err
	}
	if err := s.openPipeWire(ctx); err != nil {
		return nil, err
	}
	ok = true
	return s, nil
}

// checkInterfaces ScreenCast (ve kontrol isteniyorsa RemoteDesktop) arayüzü sunuluyor mu (sürüm özelliği okunabiliyor).
func (s *Session) checkInterfaces(ctx context.Context, control bool) error {
	ifaces := []string{ifCast}
	if control {
		ifaces = append(ifaces, ifRemote)
	}
	for _, i := range ifaces {
		c, cancel := context.WithTimeout(ctx, callTimeout)
		_, err := s.bus.Call(c, s.owner, desktopPath, ifProps+".Get", i, "version")
		cancel()
		if err != nil {
			return ErrUnavailable
		}
	}
	return nil
}

// request portal istek kalıbı: Response eşlemesi çağrıdan ÖNCE kurulur, handle_token eklenir, dönen istek yolu
// beklenenle karşılaştırılır, yanıt yalnız portal sahibinden ve o yoldan kabul edilir.
func (s *Session) request(ctx context.Context, iface, method string, wait time.Duration, lead []any,
	opts map[string]dbus.Variant) (map[string]dbus.Variant, error) {
	tok, err := newToken()
	if err != nil {
		return nil, err
	}
	want := requestPath(s.bus.Unique(), tok)
	sub, err := s.bus.Watch(Match{Sender: s.owner, Path: want, Iface: ifRequest, Member: "Response"})
	if err != nil {
		return nil, ErrUnavailable
	}
	defer sub.Cancel()
	opts["handle_token"] = dbus.MakeVariant(tok)
	c, cancel := context.WithTimeout(ctx, callTimeout)
	body, err := s.bus.Call(c, s.owner, desktopPath, iface+"."+method, append(lead, opts)...)
	cancel()
	if err != nil {
		return nil, ErrDenied
	}
	var got dbus.ObjectPath
	if dbus.Store(body, &got) != nil || got != want {
		return nil, ErrProtocol
	}
	t := time.NewTimer(wait)
	defer t.Stop()
	select {
	case sig := <-sub.C:
		return responseOf(sig)
	case <-s.closed:
		return nil, ErrClosed
	case <-ctx.Done():
	case <-t.C:
	}
	c2, cancel2 := context.WithTimeout(context.Background(), callTimeout)
	_, _ = s.bus.Call(c2, s.owner, want, ifRequest+".Close")
	cancel2()
	return nil, ErrCancelled
}

// responseOf Request.Response(u code, a{sv} results): 0 başarı, 1 kullanıcı vazgeçti, diğer → ret.
func responseOf(sig *dbus.Signal) (map[string]dbus.Variant, error) {
	var code uint32
	var res map[string]dbus.Variant
	if dbus.Store(sig.Body, &code, &res) != nil {
		return nil, ErrProtocol
	}
	switch code {
	case 0:
		if res == nil {
			res = map[string]dbus.Variant{}
		}
		return res, nil
	case 1:
		return nil, ErrCancelled
	}
	return nil, ErrDenied
}

// adoptHandle CreateSession sonucu: session_handle beklenen yol olmalı (sürüme göre dizge ya da nesne yolu). Ardından
// Closed eşlemesi kurulur.
func (s *Session) adoptHandle(res map[string]dbus.Variant, want dbus.ObjectPath) error {
	v, ok := res["session_handle"]
	if !ok {
		return ErrProtocol
	}
	var got dbus.ObjectPath
	switch h := v.Value().(type) {
	case string:
		got = dbus.ObjectPath(h)
	case dbus.ObjectPath:
		got = h
	default:
		return ErrProtocol
	}
	if got != want {
		return ErrProtocol
	}
	s.handle = got
	sub, err := s.bus.Watch(Match{Sender: s.owner, Path: s.handle, Iface: ifSession, Member: "Closed"})
	if err != nil {
		s.closeRemote()
		return ErrUnavailable
	}
	s.sub = sub
	go func() {
		select {
		case <-sub.C:
			s.markClosed()
		case <-s.closed:
		}
	}()
	return nil
}

// streamEntry a(ua{sv}) öğesi.
type streamEntry struct {
	Node  uint32
	Props map[string]dbus.Variant
}

// adoptStart Start sonucu: tam 1 akış, boyut sınırları, aygıt bitleri (S-P28g-10). restore_token okunmaz (T11).
func (s *Session) adoptStart(res map[string]dbus.Variant, control bool) error {
	var streams []streamEntry
	v, ok := res["streams"]
	if !ok || v.Store(&streams) != nil || len(streams) != 1 {
		return ErrProtocol
	}
	sz, ok := streams[0].Props["size"]
	var wh struct{ W, H int32 }
	if !ok || sz.Store(&wh) != nil || wh.W < 1 || wh.H < 1 || wh.W > maxStreamSide || wh.H > maxStreamSide {
		return ErrProtocol
	}
	s.stream = Stream{Node: streams[0].Node, W: int(wh.W), H: int(wh.H)}
	if d, ok := res["devices"]; ok && control {
		var dev uint32
		if d.Store(&dev) != nil || dev&^DevControl != 0 {
			return ErrProtocol
		}
		s.devices = dev
	}
	return nil
}

// openPipeWire OpenPipeWireRemote: fd bir Unix soketi olmalı; O_CLOEXEC konur (S-P28g-4/10).
func (s *Session) openPipeWire(ctx context.Context) error {
	c, cancel := context.WithTimeout(ctx, callTimeout)
	defer cancel()
	body, err := s.bus.Call(c, s.owner, desktopPath, ifCast+".OpenPipeWireRemote", s.handle, map[string]dbus.Variant{})
	if err != nil {
		return ErrDenied
	}
	var fd dbus.UnixFD
	if dbus.Store(body, &fd) != nil || fd < 0 {
		return ErrProtocol
	}
	if !isSocket(int(fd)) {
		_ = syscall.Close(int(fd))
		return ErrProtocol
	}
	syscall.CloseOnExec(int(fd))
	s.fd = int(fd)
	return nil
}

func isSocket(fd int) bool {
	var st unix.Stat_t
	return unix.Fstat(fd, &st) == nil && st.Mode&unix.S_IFMT == unix.S_IFSOCK
}

// Devices verilen aygıt bitleri (Control istenmediyse ya da kullanıcı "Uzaktan etkileşim"i açmadıysa 0; §14 m.6).
func (s *Session) Devices() uint32 { return s.devices }

// CanControl klavye VE işaretçi izni var mı (kontrol bunlarla verilir; aksi WAYLAND_NO_CONTROL).
func (s *Session) CanControl() bool { return s.devices&DevControl == DevControl }

// Stream portal akışı.
func (s *Session) Stream() Stream { return s.stream }

// FD PipeWire uzak bağlantı tanımlayıcısı (oturum ömrünce açık; pipewiresrc kendi kopyasını alır).
func (s *Session) FD() int { return s.fd }

// Closed oturum kapanınca (Closed sinyali — sistem "Durdur" — ya da Close) kapanan kanal.
func (s *Session) Closed() <-chan struct{} { return s.closed }

func (s *Session) markClosed() { s.closeOnce.Do(func() { close(s.closed) }) }

// closeRemote Session.Close (en iyi çaba).
func (s *Session) closeRemote() {
	if s.handle == "" {
		return
	}
	c, cancel := context.WithTimeout(context.Background(), callTimeout)
	_, _ = s.bus.Call(c, s.owner, s.handle, ifSession+".Close")
	cancel()
}

// Close oturumu kapatır, aboneliği ve fd'yi bırakır. Birden çok kez çağrılabilir.
func (s *Session) Close() {
	select {
	case <-s.closed:
	default:
		s.closeRemote()
	}
	s.markClosed()
	if s.sub != nil {
		s.sub.Cancel()
	}
	if s.fd >= 0 {
		_ = syscall.Close(s.fd)
		s.fd = -1
	}
}
