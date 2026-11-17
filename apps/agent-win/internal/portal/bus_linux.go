//go:build linux

// Package portal xdg-desktop-portal ScreenCast + RemoteDesktop birleşik oturumu, Notify* girdi çağrıları, GNOME kilit
// ekranı izleyicisi ve kilit kısayolu ayarları (mimari-p28g §2, §5.2, §5.2b, §13 S-P28g-1/2/10, §14 m.6/m.8; ADR-0038).
// D-Bus saf Go'dur (godbus/dbus/v5, BSD-2); C geri çağrısı yoktur (ADR-0038 m.2).
//
// Güvenlik kuralları (S-P28g-10):
//   - Beklenen hizmetin benzersiz adı (`GetNameOwner`) çağrıdan ÖNCE alınır; sinyal yalnız o gönderenden ve beklenen nesne
//     yolundan kabul edilir. Eşleme kuralı da çağrıdan önce kurulur (yarış yok).
//   - `handle_token` / `session_handle_token` 128 bit rastgeledir; dönen yol beklenen yolla karşılaştırılır.
//   - Değer sınırları: tam 1 akış, `node` uint32, `size` 1..16384, `devices` ⊆ {KEYBOARD, POINTER}, fd soket + O_CLOEXEC.
//   - `persist_mode=0`; `restore_token` istenmez ve saklanmaz (T11).
package portal

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/godbus/dbus/v5"
)

// Bus portal paketinin kullandığı en küçük D-Bus yüzeyi. Gerçek bağlantı Connect ile; testte sahte (router paylaşılır).
type Bus interface {
	// Unique bu bağlantının benzersiz adı (":1.42").
	Unique() string
	// Owner iyi bilinen adın şu anki benzersiz sahibi.
	Owner(name string) (string, error)
	// Call yöntem çağrısı; yanıt gövdesi döner.
	Call(ctx context.Context, dest string, path dbus.ObjectPath, method string, args ...any) ([]any, error)
	// Watch eşleme kuralını veri yoluna ekler ve uyan sinyalleri döner (Sender/Path/Name birebir).
	Watch(m Match) (*Sub, error)
	// Close bağlantıyı kapatır.
	Close() error
}

// Match tek sinyal eşlemesi. Sender benzersiz addır (boş kabul edilmez: S-P28g-10).
type Match struct {
	Sender string
	Path   dbus.ObjectPath
	Iface  string
	Member string
}

func (m Match) name() string { return m.Iface + "." + m.Member }

// Sub tek abonelik. C kapanmaz; Cancel sonrası yeni sinyal gelmez.
type Sub struct {
	C      <-chan *dbus.Signal
	ch     chan *dbus.Signal
	m      Match
	r      *router
	cancel func()
	once   sync.Once
}

// Cancel aboneliği ve (gerçek bağlantıda) eşleme kuralını kaldırır.
func (s *Sub) Cancel() {
	s.once.Do(func() {
		s.r.remove(s)
		if s.cancel != nil {
			s.cancel()
		}
	})
}

// router gelen sinyalleri abonelere dağıtır. Eşleşme birebirdir: gönderen benzersiz adı, nesne yolu, arayüz.üye.
// Yabancı gönderen ya da yol sessizce atılır (S-P28g-10). Gönderim bloklamaz (abone tamponu doluysa atılır; abonelerin
// beklediği sinyaller seyrektir: Response, Closed, ActiveChanged, SettingChanged).
type router struct {
	mu   sync.Mutex
	subs map[*Sub]struct{}
}

func newRouter() *router { return &router{subs: map[*Sub]struct{}{}} }

func (r *router) add(m Match, cancel func()) *Sub {
	ch := make(chan *dbus.Signal, 16)
	s := &Sub{C: ch, ch: ch, m: m, r: r, cancel: cancel}
	r.mu.Lock()
	r.subs[s] = struct{}{}
	r.mu.Unlock()
	return s
}

func (r *router) remove(s *Sub) {
	r.mu.Lock()
	delete(r.subs, s)
	r.mu.Unlock()
}

func (r *router) deliver(sig *dbus.Signal) {
	if sig == nil || sig.Sender == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for s := range r.subs {
		if s.m.Sender == sig.Sender && s.m.Path == sig.Path && s.m.name() == sig.Name {
			select {
			case s.ch <- sig:
			default:
			}
		}
	}
}

// errNoSender eşleme gönderensiz kurulamaz.
var errNoSender = errors.New("portal: eşleme için gönderen yok")

// conn gerçek godbus bağlantısı.
type conn struct {
	c  *dbus.Conn
	r  *router
	in chan *dbus.Signal
}

// callTimeout tek bir yöntem çağrısının üst sınırı (kullanıcı beklemeyen çağrılar).
const callTimeout = 5 * time.Second

// Connect address'e (oturum veri yolu; çağıran §15 D-P28g-T2-1 kuralını uygular) bağlanır. Sinyaller tek kanaldan
// router'a aktarılır.
func Connect(address string) (Bus, error) {
	c, err := dbus.Connect(address)
	if err != nil {
		return nil, err
	}
	b := &conn{c: c, r: newRouter(), in: make(chan *dbus.Signal, 64)}
	c.Signal(b.in)
	go func() {
		for sig := range b.in {
			b.r.deliver(sig)
		}
	}()
	return b, nil
}

func (b *conn) Unique() string {
	if n := b.c.Names(); len(n) > 0 {
		return n[0]
	}
	return ""
}

func (b *conn) Owner(name string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), callTimeout)
	defer cancel()
	var owner string
	err := b.c.BusObject().CallWithContext(ctx, "org.freedesktop.DBus.GetNameOwner", 0, name).Store(&owner)
	return owner, err
}

func (b *conn) Call(ctx context.Context, dest string, path dbus.ObjectPath, method string, args ...any) ([]any, error) {
	call := b.c.Object(dest, path).CallWithContext(ctx, method, 0, args...)
	return call.Body, call.Err
}

func (b *conn) Watch(m Match) (*Sub, error) {
	if m.Sender == "" {
		return nil, errNoSender
	}
	opts := []dbus.MatchOption{dbus.WithMatchSender(m.Sender), dbus.WithMatchObjectPath(m.Path),
		dbus.WithMatchInterface(m.Iface), dbus.WithMatchMember(m.Member)}
	if err := b.c.AddMatchSignal(opts...); err != nil {
		return nil, err
	}
	return b.r.add(m, func() { _ = b.c.RemoveMatchSignal(opts...) }), nil
}

func (b *conn) Close() error { return b.c.Close() }
