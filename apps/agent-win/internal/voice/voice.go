package voice

import (
	"errors"
	"fmt"
	"slices"
	"sync"
	"sync/atomic"
	"time"
)

// Device mikrofon + hoparlör çifti (48 kHz mono s16, 20 ms çerçeve). Windows'ta OpenWASAPI.
type Device interface {
	// ReadFrame 960 mikrofon örneğini doldurur; mikrofon saatiyle (20 ms) bloklar. Close sonrası hata döner.
	ReadFrame(pcm []int16) error
	// WriteFrame 960 örneği hoparlör kuyruğuna koyar; bloklamaz.
	WriteFrame(pcm []int16) error
	// Close aygıtı bırakır. Her goroutine'den çağrılabilir, bloklu ReadFrame/WriteFrame'i çözer; ikinci çağrı zararsızdır.
	Close() error
}

// frameEncoder *Encoder'ın kullanılan yüzü (testte sahte kodlayıcı).
type frameEncoder interface {
	Encode(pcm []int16) ([]byte, error)
	Close() error
}

const (
	frameDur  = 20 * time.Millisecond
	closeWait = 500 * time.Millisecond // Close: aygıt bırakıldıktan sonra döngünün bitişini bekleme üst sınırı (AC-374 ≤ 1 sn)
	maxRoles  = 3                      // talkers/listeners en çok 3 tid (contracts ws-voice)
)

// silentFrame salt okunur 20 ms sessizlik.
var silentFrame [FrameSamples]int16

// errLoopPanic döngüde beklenmeyen panik; aygıt hatası gibi ele alınır (mikrofon bırakılır).
var errLoopPanic = fmt.Errorf("%w: ses döngüsü durdu", ErrDevice)

// Call bir sesli görüşmenin misafir tarafı motoru (ADR-0036 m.4, mimari-p28d §4.3). Tek döngü mikrofon saatiyle 20 ms'de
// bir step() koşar: konuşan (talker) başına tek çözme; aynı çerçeve hoparlöre (Σ talkers) ve mix-minus'a gider; yalnız
// listeners eşlerine eş başına kodlayıcıyla kodlanıp yazılır. Kodlayıcı/çözücüler görüşmede sıfırdan kurulur, döngü
// goroutine'ine aittir. Eşzamanlı kullanım: tüm dışa açık yöntemler her goroutine'den güvenlidir.
type Call struct {
	dev    Device
	be     backend // nil: test (sahte kodek); görüşme bitince close (darwin: çözücü yardımcısı öldürülür)
	onFail func(error)
	newDec func() (frameDecoder, error)
	newEnc func() (frameEncoder, error)
	now    func() time.Time

	mu        sync.Mutex
	closed    bool
	peers     map[string]func([]byte, time.Duration) error
	talkers   []string
	listeners []string
	jit       map[string]*jitter   // yalnız talkers (düşürülmüşler hariç); talker dışı tid'e tampon/çözücü yok
	dropped   map[string]bool      // 3 tuzakta düşen eşler (görüşme sonuna dek)
	rx        map[string]*peerStat // tanılama: eş başına gelen paket (Close'da silinmez)
	st        callStats

	muted     atomic.Bool
	silenced  atomic.Bool
	stop      chan struct{}
	done      chan struct{}
	closeOnce sync.Once
	closeErr  error

	// döngü goroutine'ine ait
	decs   map[string]frameDecoder
	encs   map[string]frameEncoder
	mic    []int16
	spk    []int16
	out    []int16
	frames []voiceFrame
	snap   snapshot
}

type sendTo struct {
	tid  string
	sink func([]byte, time.Duration) error
}

type snapshot struct {
	talkers []string
	jits    []*jitter
	sends   []sendTo
}

// New görüşmeyi kurar: Opus çalışma zamanını hazırlar, aygıtı açar (hata → çağıran `voice.end{device}` gönderir) ve
// döngüyü başlatır. onFail görüşme sırasında aygıt hatasında bir kez, döngü bittikten ve aygıt bırakıldıktan sonra
// çağrılır (içinden Close çağrılabilir); Close ile biten görüşmede çağrılmaz.
func New(open func() (Device, error), onFail func(error)) (*Call, error) {
	be, err := openBackend()
	if err != nil {
		return nil, err
	}
	dev, err := open()
	if err != nil {
		be.close()
		return nil, err
	}
	c := newCall(dev, onFail, be.newDecoder, be.newEncoder)
	c.be = be
	c.start()
	return c, nil
}

func newCall(dev Device, onFail func(error), newDec func() (frameDecoder, error), newEnc func() (frameEncoder, error)) *Call {
	return &Call{dev: dev, onFail: onFail, newDec: newDec, newEnc: newEnc, now: time.Now,
		peers: map[string]func([]byte, time.Duration) error{}, jit: map[string]*jitter{}, dropped: map[string]bool{}, rx: map[string]*peerStat{},
		stop: make(chan struct{}), decs: map[string]frameDecoder{}, encs: map[string]frameEncoder{},
		mic: make([]int16, FrameSamples), spk: make([]int16, FrameSamples), out: make([]int16, FrameSamples)}
}

func (c *Call) start() {
	c.done = make(chan struct{})
	go c.run()
}

func (c *Call) run() {
	var failErr error
	defer func() {
		if recover() != nil {
			failErr = errLoopPanic
		}
		c.closeCodecs()
		c.closeBackend()
		if failErr != nil {
			_ = c.dev.Close()
		}
		close(c.done)
		if failErr != nil && !c.silenced.Load() && c.onFail != nil {
			c.onFail(failErr)
		}
	}()
	for {
		select {
		case <-c.stop:
			return
		default:
		}
		err := c.dev.ReadFrame(c.mic)
		if err == nil {
			err = c.step()
		}
		if err != nil {
			if !c.silenced.Load() {
				failErr = err
			}
			return
		}
	}
}

// SetPeer eşin ses göndericisini bağlar (eş başına kodlayıcı ilk gönderimde kurulur).
func (c *Call) SetPeer(tid string, sink func([]byte, time.Duration) error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.closed && sink != nil {
		c.peers[tid] = sink
	}
}

// RemovePeer eşin göndericisini çözer; kodlayıcısı bir sonraki tikte kapanır (eş geri gelirse sıfırdan kurulur).
func (c *Call) RemovePeer(tid string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.peers, tid)
}

// SetRoles sunucunun voice.state'indeki konuşanları ve dinleyenleri uygular (her durumda yeniden; roster'a süzülmüş).
// Konuşmayı bırakan tid'in tamponu hemen atılır, çözücüsü bir sonraki tikte kapanır.
func (c *Call) SetRoles(talkers, listeners []string) {
	t, l := uniq(talkers), uniq(listeners)
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return
	}
	c.talkers, c.listeners = t, l
	for tid := range c.jit {
		if !slices.Contains(t, tid) {
			delete(c.jit, tid)
		}
	}
	for _, tid := range t {
		if c.jit[tid] == nil && !c.dropped[tid] {
			c.jit[tid] = newJitter()
		}
	}
}

func uniq(in []string) []string {
	out := make([]string, 0, min(len(in), maxRoles))
	for _, s := range in {
		if s != "" && !slices.Contains(out, s) && len(out) < maxRoles {
			out = append(out, s)
		}
	}
	return out
}

// SetMuted mikrofonu yerel olarak susturur (sıfır örnek); diğer konuşanların karışımı dinleyenlere gitmeye devam eder.
func (c *Call) SetMuted(on bool) { c.muted.Store(on) }

// Push eşten gelen Opus yükünü (RTP sırasıyla) konuşanın tamponuna koyar. Talker kapısı (Y-PD-2): talkers dışındaki ya
// da düşürülmüş tid'in paketi çözücü kurulmadan atılır. Yük kopyalanır (çağıran tamponu yeniden kullanabilir).
func (c *Call) Push(tid string, seq uint16, payload []byte) {
	if c.silenced.Load() || len(payload) == 0 || len(payload) > maxPacketSize {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	ps := c.stat(tid)
	if ps != nil {
		ps.s.Rx++
	}
	j := c.jit[tid]
	if c.closed || j == nil {
		if ps != nil {
			ps.s.Gated++
		}
		return
	}
	if !j.push(seq, append([]byte(nil), payload...), c.now()) && ps != nil {
		ps.s.Jitter++
	}
}

// Close görüşmeyi bitirir (AC-374): önce gönderim susar, döngüye dur denir, aygıt bırakılır (bloklu okuma çözülür),
// döngünün bitişi en çok 500 ms beklenir. Mikrofon ≤ 1 sn içinde kapanır. İkinci çağrı zararsızdır; onFail çağrılmaz.
func (c *Call) Close() error {
	c.closeOnce.Do(func() {
		c.silenced.Store(true)
		c.mu.Lock()
		c.closed = true
		clear(c.peers)
		clear(c.jit)
		c.mu.Unlock()
		close(c.stop)
		c.closeErr = c.dev.Close()
		if c.done != nil {
			select {
			case <-c.done:
			case <-time.After(closeWait):
			}
		}
		c.closeBackend() // döngü beklenenden uzun sürdüyse de yardımcı hemen bırakılır (idempotent)
	})
	return c.closeErr
}

func (c *Call) closeBackend() {
	if c.be != nil {
		c.be.close()
	}
}

// takeSnapshot Call.mu altında bu tikin anlık görüntüsünü alır.
func (c *Call) takeSnapshot() *snapshot {
	s := &c.snap
	s.talkers, s.jits, s.sends = s.talkers[:0], s.jits[:0], s.sends[:0]
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, tid := range c.talkers {
		if j := c.jit[tid]; j != nil {
			s.talkers = append(s.talkers, tid)
			s.jits = append(s.jits, j)
		}
	}
	for _, tid := range c.listeners {
		if sink := c.peers[tid]; sink != nil {
			s.sends = append(s.sends, sendTo{tid, sink})
		}
	}
	return s
}

// step bir 20 ms tiki (c.mic dolu): konuşan başına tek çözme → hoparlör (Σ talkers) → dinleyen başına mix-minus kodla/yaz.
// Dönen hata yalnız aygıt hatasıdır.
func (c *Call) step() error {
	if c.muted.Load() {
		clear(c.mic)
	}
	s := c.takeSnapshot()
	for tid, d := range c.decs {
		if !slices.Contains(s.talkers, tid) {
			_ = d.Close()
			delete(c.decs, tid)
		}
	}
	c.frames = c.frames[:0]
	for i, tid := range s.talkers {
		pcm, err := c.pull(tid, s.jits[i])
		if errors.Is(err, ErrPeerDropped) {
			c.dropTalker(tid)
			continue
		}
		c.frames = append(c.frames, voiceFrame{tid, pcm})
	}
	mixAll(c.spk, c.frames)
	devErr := c.dev.WriteFrame(c.spk)
	if devErr == nil {
		c.st.written.Add(1)
		if audible(c.spk) {
			c.st.audible.Add(1)
		}
	}
	for tid, e := range c.encs {
		if !slices.ContainsFunc(s.sends, func(t sendTo) bool { return t.tid == tid }) {
			_ = e.Close()
			delete(c.encs, tid)
		}
	}
	for _, to := range s.sends {
		if c.silenced.Load() {
			break
		}
		c.send(to)
	}
	return devErr
}

// pull konuşanın bu tikteki 960 örneğini üretir; çözücü yalnız tamponda çözülecek paket varken kurulur.
func (c *Call) pull(tid string, j *jitter) ([]int16, error) {
	for range maxPullSteps {
		if len(j.fifo) >= FrameSamples {
			break
		}
		c.mu.Lock()
		kind, pkt := j.take()
		c.mu.Unlock()
		if kind == pullSilence {
			break
		}
		dec := c.decs[tid]
		if dec == nil {
			d, err := c.newDec()
			if err != nil {
				break
			}
			dec, c.decs[tid] = d, d
		}
		var pcm []int16
		var err error
		switch kind {
		case pullDecode:
			pcm, err = dec.Decode(pkt)
		case pullFEC:
			pcm, err = dec.DecodeFEC(pkt)
		default:
			pcm, err = dec.Conceal()
		}
		switch {
		case err == nil && kind == pullDecode:
			c.st.decoded.Add(1)
		case err == nil && kind == pullFEC:
			c.st.fec.Add(1)
		case err == nil:
			c.st.plc.Add(1)
		}
		if err != nil && !errors.Is(err, ErrPeerDropped) && kind != pullConceal {
			c.st.decodeErr.Add(1)
			pcm, err = dec.Conceal() // bozuk paket/tuzak/hız: kayıp gibi gizlenir
		}
		if errors.Is(err, ErrPeerDropped) {
			return nil, err
		}
		if err != nil {
			pcm = silentFrame[:] // gizleme de olmadı: bu adım sessiz
		}
		j.feed(pcm)
	}
	return j.emit(), nil
}

// dropTalker 3. tuzaktan sonra eşin sesini görüşme sonuna dek düşürür (ErrPeerDropped).
func (c *Call) dropTalker(tid string) {
	c.st.dropped.Add(1)
	c.mu.Lock()
	c.dropped[tid] = true
	delete(c.jit, tid)
	c.mu.Unlock()
	if d := c.decs[tid]; d != nil {
		_ = d.Close()
		delete(c.decs, tid)
	}
}

// send `to` eşine mic + Σ(talkers \ {to}) kodlayıp yazar. Kodlayıcı tuzakta kapanır; bir sonraki tikte yenisi kurulur.
func (c *Call) send(to sendTo) {
	enc := c.encs[to.tid]
	if enc == nil {
		e, err := c.newEnc()
		if err != nil {
			return
		}
		enc, c.encs[to.tid] = e, e
	}
	mixMinus(c.out, c.mic, c.frames, to.tid)
	pkt, err := enc.Encode(c.out)
	if err != nil {
		if errors.Is(err, ErrCodecPanic) {
			delete(c.encs, to.tid)
		}
		return
	}
	_ = to.sink(pkt, frameDur) // eş kapanıyor olabilir; hata o eşin işidir
}

func (c *Call) closeCodecs() {
	for tid, d := range c.decs {
		_ = d.Close()
		delete(c.decs, tid)
	}
	for tid, e := range c.encs {
		_ = e.Close()
		delete(c.encs, tid)
	}
}
