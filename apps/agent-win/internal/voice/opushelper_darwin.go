//go:build darwin

package voice

import (
	"encoding/binary"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"remote-support/agent-win/internal/darwin/helpermode"
	"remote-support/agent-win/internal/darwin/sandbox"
)

// Opus çözücü yardımcısı (mimari-p33 §6.6; S-P33-T-1 öneri A, S-P33-T2-1/2/3). Teknisyenden gelen güvenilmeyen Opus
// yükü ana süreçte (Ekran Kaydı, Erişilebilirlik, Mikrofon TCC'li) değil, aynı ikilinin `--opus-cozucu` kipindeki,
// `sandbox_init` ile `(deny default)` profiline girmiş alt sürecinde çözülür.
//
// Yardımcı: önce devralınmış fd'leri kapatır (0/1/2 = IPC dışında; S-P33-K-1), üç AudioConverter çözücüsünü kurar ve
// ısıtır (gömülü gerçek paket + PLC + Reset; sandbox sonrası bileşen kaydı gerekmesin; kodlayıcı kurulmaz, S-P33-K-2),
// sandbox'a girer, öz-test yapar (sandbox_check + ev/sistem dizini okuma, /tmp yazma, ağ: EPERM), ancak
// sonra boruya tek "hazır" baytı yazar. İstek = tid(1) | uzunluk(u16 LE) | paket(≤ 1275); uzunluk 0 = PLC. Yanıt sabit
// 1 + 1920 bayt: durum(1) | 960 × s16 LE. tid ≥ 3 ya da uzunluk > 1275 → hemen çıkış.
//
// Ana süreç: yol EvalSymlinks sonrası kendi .app paketinin Contents/MacOS'u içinde değilse başlatmaz; argv tam
// [exe, "--opus-cozucu"], ortam boş, ExtraFiles yok, stderr /dev/null. Hazır baytı 3 sn içinde gelmeli ve
// sandbox_check(çocuk) = 1 olmalı; aksi yardımcı öldürülür. Yanıt io.ReadFull ile sabit boyutta okunur, durum yalnız
// bilinen değerler. Tik başına bekleme 15 ms: aşılırsa o çerçeve sessiz geçer (mikrofon gönderimi bloklanmaz) ve
// yardımcıda yanıtı beklenen istek varken yeni istek gönderilmez (hiçbir konuşan IPC beklemez); 200 ms'de yanıt yoksa,
// boru kapanırsa ya da durum bilinmiyorsa yardımcı öldürülür ve ErrCodecPanic YALNIZ uçuştaki isteğin sahibine yazılır
// (diğer konuşanlar o tikleri PLC/sessizlikle geçer; masum konuşan düşmez). Yardımcı sonraki istekte yeniden başlar.
// Konuşan başına bir yuva (tid 0..2) ayrılır; yuva devrinde çözücü durumu sıfırlanmaz (yeni konuşanın ilk ≤ 20 ms'si
// önceki konuşanın durumuyla çözülür; kabul — protokol §6.6'da sıfırlama yok).

const (
	helperSlots     = 3
	helperReadyByte = 0xA5
	helperRespOK    = 0
	helperRespBad   = 1 // paket çözülemedi (yük hatası; yardımcı sağlıklı)
	helperReqHdr    = 3
	helperRespSize  = 1 + FrameSamples*2
	helperTickLimit = 15 * time.Millisecond  // T2-3: tik başına bekleme
	helperHardLimit = 200 * time.Millisecond // §6.6: yanıt yoksa yardımcı askıda/çökmüş sayılır
	helperReadyWait = 3 * time.Second
	maxHelperStarts = 1 + helperSlots*maxPanics // görüşme başına başlatma bütçesi
)

// Yardımcı çıkış kodları (yalnız sayı; ana süreç ayırt etmez, tanı içindir).
const (
	helperExitOK = iota
	helperExitArgs
	helperExitCodec
	helperExitSandbox
	helperExitSelfTest
	helperExitPipe
	helperExitProtocol
	helperExitFDs
)

var (
	errHelperNotReady = errors.New("voice: çözücü yardımcısı hazır değil")
	errHelperBusy     = errors.New("voice: çözücü yardımcısı meşgul")
	errHelperSlow     = errors.New("voice: çözücü yardımcısı tik süresinde yanıt vermedi")
	errNotInBundle    = errors.New("voice: ikili .app paketi içinde değil")
	errHelperStart    = errors.New("voice: çözücü yardımcısı başlatılamadı")
)

// ---------- Yardımcı tarafı ----------

// RunDecoderHelper `--opus-cozucu` kipinin gövdesi (cmd/noktadestek main'in ilk satırı). Ana UI/ağ kodu çalışmaz.
func RunDecoderHelper() int {
	if !helpermode.Active {
		return helperExitArgs
	}
	if sandbox.CloseInheritedFDs() != nil {
		return helperExitFDs
	}
	decs, err := warmDecoders()
	if err != nil {
		return helperExitCodec
	}
	if sandbox.Enter() != nil {
		return helperExitSandbox
	}
	if sandbox.SelfTest() != nil {
		return helperExitSelfTest
	}
	if _, err := os.Stdout.Write([]byte{helperReadyByte}); err != nil {
		return helperExitPipe
	}
	return serveHelper(os.Stdin, os.Stdout, decs)
}

// warmPacket ısıtma paketi: 20 ms hibrit (TOC 0x78, SILK + CELT yolu). K1'de ısıtmayı yapan AudioToolbox kodlayıcısının
// 440 Hz sinüsten ürettiği paketin birebir kopyasıdır (çıktı belirlenimci); yardımcıda kodlayıcı kurulmaz (S-P33-K-2).
const warmPacket = "788201b76c9e99ac0000086d69dc92085474dc09cd81ef0dcf951a5924e3eebc7443ed92041bd82385be6cdbed96043625051d688a9b149" +
	"882fba3f85f91deffe54da21b2274da063f321874d17d082d7b625445aeacd82eb24233f7f695a3da4c2ee416a8837f2627e6311064e60b"

// warmDecoders üç çözücüyü sandbox'tan önce kurar ve her birinde bir gerçek paket + PLC çözüp Reset eder (K1 ölçümü:
// sonrasında `(deny default)` altında çözme/PLC/Reset sürer).
func warmDecoders() ([helperSlots]*atDecoder, error) {
	var decs [helperSlots]*atDecoder
	pkt, err := hex.DecodeString(warmPacket)
	if err != nil {
		return decs, err
	}
	out := make([]int16, FrameSamples)
	for i := range decs {
		d, err := newATDecoder()
		if err != nil {
			return decs, err
		}
		if err := errors.Join(d.decode20(pkt, out), d.decode20(nil, out), d.c.reset()); err != nil {
			return decs, err
		}
		decs[i] = d
	}
	return decs, nil
}

// serveHelper istek/yanıt döngüsü (sandbox içinde). Çerçeve dışı istek → çıkış.
func serveHelper(r io.Reader, w io.Writer, decs [helperSlots]*atDecoder) int {
	var hdr [helperReqHdr]byte
	pkt := make([]byte, maxPacketSize)
	pcm := make([]int16, FrameSamples)
	resp := make([]byte, helperRespSize)
	for {
		if _, err := io.ReadFull(r, hdr[:]); err != nil {
			return helperExitOK // ana süreç boruyu kapattı (görüşme bitti / öldürüldü)
		}
		tid, n := int(hdr[0]), int(binary.LittleEndian.Uint16(hdr[1:]))
		if tid >= helperSlots || n > maxPacketSize {
			return helperExitProtocol
		}
		if _, err := io.ReadFull(r, pkt[:n]); err != nil {
			return helperExitProtocol
		}
		resp[0] = helperRespOK
		if err := decs[tid].decode20(pkt[:n], pcm); err != nil {
			resp[0] = helperRespBad
			clear(pcm)
			if decs[tid].c.reset() != nil {
				return helperExitCodec
			}
		}
		for i, s := range pcm {
			binary.LittleEndian.PutUint16(resp[1+2*i:], uint16(s))
		}
		if _, err := w.Write(resp); err != nil {
			return helperExitOK
		}
	}
}

// ---------- Ana süreç tarafı ----------

// helperPath yardımcı olarak çalıştırılacak ikili (test dikişi; üretimde bundledExecutable).
var helperPath = bundledExecutable

// bundledExecutable os.Executable + EvalSymlinks; yol `<…>.app/Contents/MacOS/<ad>` biçiminde değilse hata (S-P33-T2-3).
func bundledExecutable() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return "", err
	}
	if !inAppBundle(exe) {
		return "", errNotInBundle
	}
	return exe, nil
}

// inAppBundle yol bir .app paketinin Contents/MacOS dizininin doğrudan çocuğu mu.
func inAppBundle(p string) bool {
	if !filepath.IsAbs(p) || filepath.Clean(p) != p {
		return false
	}
	dir := filepath.Dir(p)
	return filepath.Base(dir) == "MacOS" && filepath.Base(filepath.Dir(dir)) == "Contents" &&
		strings.HasSuffix(filepath.Dir(filepath.Dir(dir)), ".app") && filepath.Base(p) != ""
}

// helperConn çalışan bir yardımcı süreç.
type helperConn struct {
	cmd  *exec.Cmd
	w, r *os.File
	resp chan []byte   // okuyucu goroutine'den yanıtlar (en çok 1 bekler)
	dead chan struct{} // okuyucu bitti (EOF/hata/fazla yanıt)
	once sync.Once
}

// spawnHelper yardımcıyı başlatır, hazır baytını bekler ve sandbox'ta olduğunu doğrular (S-P33-T2-2).
func spawnHelper() (*helperConn, error) {
	exe, err := helperPath()
	if err != nil {
		return nil, err
	}
	cr, pw, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	pr, cw, err := os.Pipe()
	if err != nil {
		_ = cr.Close()
		_ = pw.Close()
		return nil, err
	}
	cmd := &exec.Cmd{Path: exe, Args: []string{exe, helpermode.Flag}, Env: []string{}, Stdin: cr, Stdout: cw}
	err = cmd.Start()
	_ = cr.Close()
	_ = cw.Close()
	if err != nil {
		_ = pw.Close()
		_ = pr.Close()
		return nil, errors.Join(errHelperStart, err)
	}
	hc := &helperConn{cmd: cmd, w: pw, r: pr, resp: make(chan []byte, 1), dead: make(chan struct{})}
	var b [1]byte
	_ = pr.SetReadDeadline(time.Now().Add(helperReadyWait))
	_, err = io.ReadFull(pr, b[:])
	_ = pr.SetReadDeadline(time.Time{})
	if err != nil || b[0] != helperReadyByte {
		hc.kill()
		return nil, errHelperStart
	}
	if in, err := sandbox.Check(cmd.Process.Pid); err != nil || !in {
		hc.kill()
		return nil, errHelperStart
	}
	go hc.read()
	return hc, nil
}

// read sabit boyutlu yanıtları okur; beklenmeyen (istenmemiş) yanıt ya da hata okuyucuyu bitirir.
func (hc *helperConn) read() {
	defer close(hc.dead)
	for {
		b := make([]byte, helperRespSize)
		if _, err := io.ReadFull(hc.r, b); err != nil {
			return
		}
		select {
		case hc.resp <- b:
		default:
			return // istenmemiş yanıt: protokol ihlali
		}
	}
}

// kill yardımcıyı öldürür ve boruları kapatır (idempotent); süreç arka planda biçilir.
func (hc *helperConn) kill() {
	hc.once.Do(func() {
		if hc.cmd.Process != nil {
			_ = hc.cmd.Process.Kill()
		}
		_ = hc.w.Close()
		_ = hc.r.Close()
		go func() { _ = hc.cmd.Wait() }()
	})
}

// helperProc bir görüşmenin çözücü yardımcısı (görüşme başına tek; yuva başına bir konuşan). Decode çağrıları döngü
// goroutine'inden, close her goroutine'den gelebilir.
type helperProc struct {
	mu       sync.Mutex
	closed   bool
	starting bool
	broken   bool
	starts   int
	conn     *helperConn
	slots    [helperSlots]*helperCodec
	inflight *helperCodec // yanıtı tik süresinde gelmemiş isteğin sahibi
	sent     time.Time
	req      []byte
	spawn    func() (*helperConn, error)
}

func newHelperProc() *helperProc {
	return &helperProc{req: make([]byte, helperReqHdr+maxPacketSize), spawn: spawnHelper}
}

// ensureStart (mu altında) yardımcı yoksa arka planda başlatır; bütçe dolarsa kalıcı bozuk.
func (h *helperProc) ensureStart() {
	if h.closed || h.broken || h.starting || h.conn != nil {
		return
	}
	if h.starts >= maxHelperStarts {
		h.broken = true
		return
	}
	h.starts++
	h.starting = true
	go func() {
		conn, err := h.spawn()
		h.mu.Lock()
		defer h.mu.Unlock()
		h.starting = false
		switch {
		case err != nil:
		case h.closed:
			conn.kill()
		default:
			h.conn = conn
		}
	}()
}

// drop (mu altında) yardımcıyı öldürür; culprit uçuştaki isteğin sahibidir (çağıran değilse panik ona yazılır).
func (h *helperProc) drop(culprit, caller *helperCodec) error {
	if h.conn != nil {
		h.conn.kill()
		h.conn = nil
	}
	h.inflight = nil
	h.ensureStart()
	if culprit == nil {
		return errHelperNotReady
	}
	if culprit == caller {
		return ErrCodecPanic
	}
	culprit.panicPending = true
	return errHelperNotReady
}

// newCodec boş bir yuva ayırır (konuşan başına bir çözücü).
func (h *helperProc) newCodec() (codec, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return nil, errClosed
	}
	for i, s := range h.slots {
		if s == nil {
			c := &helperCodec{h: h, slot: byte(i)}
			h.slots[i] = c
			h.ensureStart()
			return c, nil
		}
	}
	return nil, errors.New("voice: çözücü yuvası yok")
}

func (h *helperProc) close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.closed = true
	if h.conn != nil {
		h.conn.kill()
		h.conn = nil
	}
}

// roundTrip bir isteği gönderir ve tik süresi içinde yanıtı bekler (ayrıntı dosya başında).
func (h *helperProc) roundTrip(c *helperCodec, pkt []byte, out []int16) (int, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	switch {
	case h.closed || c.closed:
		return 0, errClosed
	case c.panicPending:
		c.panicPending = false
		return 0, ErrCodecPanic
	case h.broken:
		return 0, ErrPeerDropped
	case h.conn == nil:
		h.ensureStart()
		return 0, errHelperNotReady
	}
	conn := h.conn
	if h.inflight != nil {
		select {
		case <-conn.resp: // bayat yanıt atılır; boru hizada
			h.inflight = nil
		case <-conn.dead:
			return 0, h.drop(h.inflight, c)
		default:
			if time.Since(h.sent) > helperHardLimit {
				return 0, h.drop(h.inflight, c)
			}
			return 0, errHelperBusy
		}
	}
	select {
	case <-conn.dead: // istek yokken öldü: suçlu yok
		return 0, h.drop(nil, c)
	default:
	}
	req := h.req[:helperReqHdr+len(pkt)]
	req[0] = c.slot
	binary.LittleEndian.PutUint16(req[1:], uint16(len(pkt)))
	copy(req[helperReqHdr:], pkt)
	sent := time.Now()
	if _, err := conn.w.Write(req); err != nil {
		return 0, h.drop(c, c)
	}
	t := time.NewTimer(helperTickLimit)
	defer t.Stop()
	select {
	case b := <-conn.resp:
		switch b[0] {
		case helperRespOK:
			for i := range FrameSamples {
				out[i] = int16(binary.LittleEndian.Uint16(b[1+2*i:]))
			}
			return FrameSamples, nil
		case helperRespBad:
			return 0, opusError(-4)
		}
		return 0, h.drop(c, c)
	case <-conn.dead:
		return 0, h.drop(c, c)
	case <-t.C:
		h.inflight, h.sent = c, sent
		return 0, errHelperSlow
	}
}

// helperCodec codec arayüzünün istemci uygulaması (bir yuva). Paket R1–R7 + 20 ms süzgecinden geçmeden gönderilmez.
type helperCodec struct {
	h            *helperProc
	slot         byte
	closed       bool
	panicPending bool // yardımcı bu yuvanın isteğinde öldü; sonraki çağrı ErrCodecPanic döner (mu altında)
}

func (c *helperCodec) Decode(packet []byte, pcm []int16, frameSize int, decodeFEC bool) (int, error) {
	if decodeFEC {
		return 0, opusError(-5) // V-P33-A2: FEC çözme yok; jitter Conceal'e geçer
	}
	if frameSize < FrameSamples || len(pcm) < FrameSamples {
		return 0, opusError(-1)
	}
	if len(packet) > 0 {
		if err := opus20ms(packet); err != nil {
			return 0, err
		}
	}
	return c.h.roundTrip(c, packet, pcm[:FrameSamples])
}

func (c *helperCodec) Close() error {
	c.h.mu.Lock()
	defer c.h.mu.Unlock()
	if !c.closed {
		c.closed = true
		if c.h.slots[c.slot] == c {
			c.h.slots[c.slot] = nil
		}
	}
	return nil
}
