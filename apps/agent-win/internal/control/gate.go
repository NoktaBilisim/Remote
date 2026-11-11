// Package control uzaktan kontrolün istemci tarafı kararlarıdır (mimari-protokol §4.3): izin kapısı (gate), kontrol ve
// monitör isteklerinin hız kuralı, izin diyaloğu zamanlama/odak kuralları (G-03), diyalog konumu ve kısayol yedeği
// (G-21). Platformdan bağımsızdır; Win32 bağlantısı internal/ui ve internal/input'tadır.
package control

import (
	"sync"
	"sync/atomic"
	"time"
)

// LocalPriority AC-104: yerel fare/klavye olayından sonra uzaktan girdinin askıda kaldığı süre.
const LocalPriority = time.Second

// Gate izin kapısı — tek doğruluk kaynağı. Varsayılan CLOSED. Yalnız yerel, enjekte olmayan kullanıcı etkileşimi
// (izin diyaloğu) Open çağırır; diğer her şey (kapat düğmesi, kısayol, oturum sonu, kopma, yeniden bağlanma,
// control.revoke/release/cancel, caps daralması) Close veya Shut çağırır. IsOpen/Allow kilitsizdir (her input mesajında).
type Gate struct {
	// state = nesil<<1 | açık. Nesil her kapalı → açık geçişinde artar; açıklık ve nesil tek atomik değerde olduğundan
	// "hangi açılışın kapanışı" sorusu yarışsız yanıtlanır (S7-16).
	state   atomic.Uint64
	suspend atomic.Int64 // unix nano; bu ana kadar uzaktan girdi askıda (AC-104)
	dropped atomic.Uint64

	mu      sync.Mutex
	onOpen  []func(gen uint64)
	onClose []func(gen uint64)
}

// Open kapıyı açar; daha önce kapalıysa yeni bir nesil başlatır ve açılış dinleyicilerini (LL kancalarını kurma, S7-7)
// çalıştırır. Çağıran yerel etkileşimi doğrulamış olmalıdır (internal/ui).
func (g *Gate) Open() {
	for {
		s := g.state.Load()
		if s&1 == 1 {
			return
		}
		next := ((s>>1)+1)<<1 | 1
		if g.state.CompareAndSwap(s, next) {
			g.run(&g.onOpen, next>>1)
			return
		}
	}
}

// close kapıyı atomik kapatır; açıktıysa kapanan açılışın neslini ve true döner.
func (g *Gate) close() (uint64, bool) {
	for {
		s := g.state.Load()
		if s&1 == 0 {
			return s >> 1, false
		}
		if g.state.CompareAndSwap(s, s&^1) {
			return s >> 1, true
		}
	}
}

// Close kapıyı kapatır; daha önce açıksa true döner ve kapanış dinleyicilerini (takılı tuş bırakma) Close dönmeden
// çalıştırır. Dinleyici input.Applier kilidini beklediğinden Close, uçuştaki tek enjeksiyonun bitmesini de bekler
// (AC-101: Close döndükten sonra hiçbir olay uygulanmaz). LL kanca / kısayol iş parçacığından ÇAĞRILMAZ — orada Shut.
func (g *Gate) Close() bool {
	gen, was := g.close()
	if was {
		g.run(&g.onClose, gen)
	}
	return was
}

// Shut S7-3: LL kanca ve kısayol iş parçacığı için kapatma. Kapı atomik olarak hemen kapanır (bu andan sonra Allow
// false; hiçbir yeni olay uygulanmaz); kapanış dinleyicileri ve after ayrı goroutine'de çalışır, Shut asla bloklamaz.
// Gerekçe: SendInput, Applier kilidi tutulurken bu iş parçacığındaki LL kancasının işlenmesini bekler; burada kilit
// beklemek karşılıklı kilitlenmeye ve Windows'un kancayı sessizce kaldırmasına yol açar.
// S7-16: dinleyiciler gecikebileceğinden kapanan açılışın neslini alır; durum değiştiren dinleyici (kanca kaldırma)
// uygulanmadan önce StillClosed(gen) ile isteğin bayatlamadığını (arada yeniden açılmadığını) denetler.
func (g *Gate) Shut(after func()) bool {
	gen, was := g.close()
	go func() {
		if was {
			g.run(&g.onClose, gen)
		}
		if after != nil {
			after()
		}
	}()
	return was
}

// StillClosed S7-16: kapı kapalı ve gen neslinin kapanışından beri yeniden açılmamış mı. false ise gen'e ait kapanış
// isteği bayattır; yeni açılışın durumu (kurulu kancalar) bozulmamalıdır.
func (g *Gate) StillClosed(gen uint64) bool { return g.state.Load() == gen<<1 }

func (g *Gate) run(list *[]func(uint64), gen uint64) {
	g.mu.Lock()
	fns := append([]func(uint64){}, (*list)...)
	g.mu.Unlock()
	for _, fn := range fns {
		fn(gen)
	}
}

// OnOpen kapı kapalıyken açılınca çağrılır (Open'ı çağıran goroutine'de). Bloklamamalıdır.
func (g *Gate) OnOpen(fn func()) {
	g.mu.Lock()
	g.onOpen = append(g.onOpen, func(uint64) { fn() })
	g.mu.Unlock()
}

// OnClose kapı açıkken kapanınca çağrılır (Close'da aynı goroutine'de Close dönmeden; Shut'ta ayrı goroutine'de).
func (g *Gate) OnClose(fn func()) { g.OnCloseGen(func(uint64) { fn() }) }

// OnCloseGen OnClose gibi; dinleyici kapanan açılışın neslini alır (S7-16, bkz. StillClosed).
func (g *Gate) OnCloseGen(fn func(gen uint64)) {
	g.mu.Lock()
	g.onClose = append(g.onClose, fn)
	g.mu.Unlock()
}

// IsOpen kapı açık mı.
func (g *Gate) IsOpen() bool { return g.state.Load()&1 == 1 }

// Suspend AC-104: yerel girdi görüldü; uzaktan girdi now+LocalPriority'ye kadar uygulanmaz.
func (g *Gate) Suspend(now time.Time) { g.suspend.Store(now.Add(LocalPriority).UnixNano()) }

// Allow kapı açık ve yerel öncelik askısı yoksa true. false ise çağıran olayı düşürür ve Drop'u çağırır.
func (g *Gate) Allow(now time.Time) bool {
	return g.IsOpen() && now.UnixNano() >= g.suspend.Load()
}

// Drop düşürülen olay sayacı (AC-101 testi ve tanı).
func (g *Gate) Drop() { g.dropped.Add(1) }

// Dropped düşürülen olay sayısı.
func (g *Gate) Dropped() uint64 { return g.dropped.Load() }
