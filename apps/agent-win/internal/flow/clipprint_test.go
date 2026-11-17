package flow

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/signal"
)

// --- sahteler (birim: clipPrint durum makinesi, döngü yerine test sürücüsü) ---------------------------------------

type fakeTimer struct {
	d       time.Duration
	f       func()
	stopped bool
}

type fakeClip struct {
	text    []byte
	readErr error
	written [][]byte
}

func (c *fakeClip) Read() ([]byte, error) { return append([]byte(nil), c.text...), c.readErr }
func (c *fakeClip) Write(t []byte) error {
	c.written = append(c.written, append([]byte(nil), t...))
	return nil
}

type fakePrinter struct {
	name      string
	pages     int
	inspectE  error
	printE    error
	seen      [][]byte // Inspect/Print'e verilen dilimler (sıfırlama denetimi)
	cancelled int
	unknown   bool // r4: PagesUnknownPrinter (macOS lp)
}

func (p *fakePrinter) PagesUnknown() bool { return p.unknown }

func (p *fakePrinter) DefaultPrinter() (string, bool) { return p.name, p.name != "" }
func (p *fakePrinter) Inspect(ctx context.Context, pdf []byte) (int, error) {
	p.seen = append(p.seen, pdf)
	if ctx.Err() != nil {
		p.cancelled++
	}
	return p.pages, p.inspectE
}
func (p *fakePrinter) Print(ctx context.Context, pdf []byte, _ int) error {
	p.seen = append(p.seen, pdf)
	if ctx.Err() != nil {
		p.cancelled++
	}
	return p.printE
}

type fakeCPUI struct {
	switches []ClipSwitchState
	prompts  []PrintPrompt
	closed   []string
	notices  []string
}

func (u *fakeCPUI) ClipSwitch(st ClipSwitchState)   { u.switches = append(u.switches, st) }
func (u *fakeCPUI) PrintPrompt(p PrintPrompt)       { u.prompts = append(u.prompts, p) }
func (u *fakeCPUI) PrintPromptClosed(pid string)    { u.closed = append(u.closed, pid) }
func (u *fakeCPUI) Notice(text string)              { u.notices = append(u.notices, text) }
func (u *fakeCPUI) lastSwitch() (s ClipSwitchState) { return u.switches[len(u.switches)-1] }

type cpH struct {
	t       *testing.T
	c       *clipPrint
	sent    []signal.Outbound
	ctl     [][]byte
	gate    bool
	caps    []string
	busy    bool
	timers  []*fakeTimer
	async   []func() func()
	ui      *fakeCPUI
	clip    *fakeClip
	printer *fakePrinter
	status  []string
}

func newCP(t *testing.T) *cpH {
	h := &cpH{t: t, gate: true, caps: []string{"remote_control", "clipboard", "print"}, ui: &fakeCPUI{},
		clip: &fakeClip{}, printer: &fakePrinter{name: "Ofis Yazıcısı", pages: 3}}
	h.c = newClipPrint(context.Background(), cpDeps{
		clip: h.clip, printer: h.printer, ui: h.ui,
		after: func(d time.Duration, f func()) func() bool {
			tm := &fakeTimer{d: d, f: f}
			h.timers = append(h.timers, tm)
			return func() bool { was := !tm.stopped; tm.stopped = true; return was }
		},
		spawn: func(op func() func()) { h.async = append(h.async, op) },
		send: func(m signal.Outbound) {
			if _, err := signal.Encode(m); err != nil {
				t.Fatalf("geçersiz WS mesajı: %+v %v", m, err)
			}
			h.sent = append(h.sent, m)
		},
		sendCtl:   func(b []byte) error { h.ctl = append(h.ctl, append([]byte(nil), b...)); return nil }, // rtc SendText kopyalar
		gateOpen:  func() bool { return h.gate },
		hasCap:    func(c string) bool { return slices.Contains(h.caps, c) },
		filesBusy: func() bool { return h.busy },
		techName:  func() string { return "Ali Teknisyen" },
		status:    func(s string) { h.status = append(h.status, s) },
		now:       func() time.Time { return time.Date(2026, 11, 16, 10, 0, 0, 0, time.UTC) },
	}, []string{signal.FeatureClip, signal.FeaturePrint})
	return h
}

// fire süresi d olan son durdurulmamış zamanlayıcıyı tetikler.
func (h *cpH) fire(d time.Duration) {
	h.t.Helper()
	for i := len(h.timers) - 1; i >= 0; i-- {
		if tm := h.timers[i]; tm.d == d && !tm.stopped {
			tm.stopped = true
			tm.f()
			return
		}
	}
	h.t.Fatalf("%v zamanlayıcısı yok", d)
}

// runAsync bekleyen goroutine işlerini çalıştırıp sonuç kapanışlarını (döngü yerine) uygular.
func (h *cpH) runAsync() {
	for len(h.async) > 0 {
		op := h.async[0]
		h.async = h.async[1:]
		op()()
	}
}

func (h *cpH) last() signal.Outbound {
	h.t.Helper()
	if len(h.sent) == 0 {
		h.t.Fatal("WS mesajı yok")
	}
	return h.sent[len(h.sent)-1]
}

func (h *cpH) lastClip(result string, n int) {
	h.t.Helper()
	r, ok := h.last().(signal.ClipReport)
	if !ok || r.Result != result || r.Bytes != n {
		h.t.Fatalf("clip.report %+v, beklenen %s/%d", h.last(), result, n)
	}
}

func (h *cpH) lastPrint(decision, result string) signal.PrintReport {
	h.t.Helper()
	r, ok := h.last().(signal.PrintReport)
	if !ok || r.Decision != decision || r.Result != result {
		h.t.Fatalf("print.report %+v, beklenen %s/%s", h.last(), decision, result)
	}
	return r
}

func (h *cpH) consentOn() {
	h.t.Helper()
	h.c.onUser(Event{Kind: EvClipConsent, On: true})
	if m, ok := h.last().(signal.ClipConsentSet); !ok || !m.On {
		h.t.Fatalf("clip.consent{on:true} gönderilmeli: %+v", h.sent)
	}
}

func ctlOf(t *testing.T, b []byte) dc.Ctl {
	t.Helper()
	m, err := dc.ParseCtl(b)
	if err != nil {
		t.Fatalf("ctl %s: %v", b, err)
	}
	return m
}

func (h *cpH) pushText(cid, text string) {
	h.t.Helper()
	frames, err := dc.ClipChunks(cid, []byte(text))
	if err != nil {
		h.t.Fatal(err)
	}
	for _, f := range frames {
		h.c.onCtl(ctlOf(h.t, f))
	}
}

const (
	cid1 = "aZ3_x-Q9LmN0pR7sT2uV1w"
	cid2 = "bZ3_x-Q9LmN0pR7sT2uV1w"
	pid1 = "Pq8-Zx_4KdLm2Nb7Vc1Ty0"
	pid2 = "Qq8-Zx_4KdLm2Nb7Vc1Ty0"
)

// --- pano ------------------------------------------------------------------------------------------------------

func TestAC344P28aClipPushAppliesOnlyWithSwitchAndGate(t *testing.T) {
	h := newCP(t)
	h.c.onServer(signal.ClipPush{T: "clip.push", CID: cid1, Bytes: 5})
	h.lastClip("DENIED", 0) // anahtar kapalı
	h.consentOn()
	h.c.onServer(signal.ClipPush{T: "clip.push", CID: cid2, Bytes: len("çğ\r\nİ🖨")})
	if m := ctlOf(t, h.ctl[len(h.ctl)-1]); m.T != "clip.ready" || m.CID != cid2 {
		t.Fatalf("clip.ready bekleniyordu: %+v", m)
	}
	h.pushText(cid2, "çğ\r\nİ🖨")
	if len(h.clip.written) != 1 || string(h.clip.written[0]) != "çğ\r\nİ🖨" {
		t.Fatalf("panoya birebir yazılmalı: %q", h.clip.written)
	}
	h.lastClip("OK", len("çğ\r\nİ🖨"))
	if !slices.Equal(h.ui.notices, []string{noticeClipPut}) {
		t.Fatalf("bildirim %v", h.ui.notices)
	}
}

func TestAC344P28aSwitchOffBeforeDataDenies(t *testing.T) {
	h := newCP(t)
	h.consentOn()
	h.c.onServer(signal.ClipPush{T: "clip.push", CID: cid1, Bytes: 1})
	h.gate = false // kapı atomik kapandı, closeControl henüz çalışmadı: yazmadan hemen önceki denetim tutar
	h.pushText(cid1, "a")
	h.lastClip("DENIED", 0)
	if len(h.clip.written) != 0 {
		t.Fatal("kapı kapalıyken panoya yazılmamalı")
	}
	// Kapanış: anahtar yerelde kapanır, WS clip.consent GÖNDERİLMEZ (§5.3).
	n := len(h.sent)
	h.c.controlClosed()
	if len(h.sent) != n || h.ui.lastSwitch().On {
		t.Fatalf("kapanışta WS gönderimi olmamalı / anahtar kapanmalı: %+v", h.sent[n:])
	}
	// Kapı kapalıyken açma isteği reddedilir; görünüm mantığa geri çekilir.
	h.c.onUser(Event{Kind: EvClipConsent, On: true})
	if len(h.sent) != n || h.ui.lastSwitch() != (ClipSwitchState{Visible: true, Enabled: false, On: false}) {
		t.Fatalf("kapalı kapıda anahtar açılmamalı: %+v", h.ui.lastSwitch())
	}
}

func TestAC344P28aServerConsentOffNoReply(t *testing.T) {
	h := newCP(t)
	h.consentOn()
	n := len(h.sent)
	h.c.onServer(signal.ClipConsent{T: "clip.consent", On: false})
	if len(h.sent) != n || h.c.clipOn {
		t.Fatal("sunucu kapatınca yanıt gönderilmez, anahtar kapanır")
	}
}

func TestOP28a1ClipDeadlineDirectionAndReuse(t *testing.T) {
	h := newCP(t)
	h.consentOn()
	h.c.onServer(signal.ClipPush{T: "clip.push", CID: cid1, Bytes: 1})
	h.fire(8 * time.Second)
	h.lastClip("TIMEOUT", 0)
	n := len(h.sent)
	h.pushText(cid1, "a") // süresi dolan kimlik silindi
	if len(h.clip.written) != 0 || len(h.sent) != n {
		t.Fatal("son tarihten sonra veri uygulanmamalı")
	}
	h.c.onServer(signal.ClipPush{T: "clip.push", CID: cid1, Bytes: 1}) // tek kullanım
	h.lastClip("DENIED", 0)
	// Yön bağı: pull cid'iyle gelen clip.data uygulanmaz.
	h.clip.text = []byte("x")
	h.c.onServer(signal.ClipPull{T: "clip.pull", CID: cid2})
	h.pushText(cid2, "y")
	if len(h.clip.written) != 0 {
		t.Fatal("pull kimliği gelen veriyi yetkilendirmemeli")
	}
	// Son 64 kimlik tutulur.
	for i := range signal.IDReuseWindow {
		h.c.remember("idx-" + strings.Repeat("a", 4) + string(rune('A'+i%26)) + string(rune('a'+i/26)))
	}
	if !h.c.remember(cid1) {
		t.Fatal("64'ten eski kimlik pencereden çıkmalı")
	}
}

func TestAC345P28aClipPullResults(t *testing.T) {
	cases := []struct {
		text   string
		err    error
		result string
		n      int
	}{
		{"ç ğ ı ö ş ü İ", nil, "OK", len("ç ğ ı ö ş ü İ")},
		{"", nil, "EMPTY", 0},
		{"", ErrClipSensitive, "SENSITIVE", 0},
		{strings.Repeat("a", dc.ClipMaxBytes+1), nil, "TOO_LARGE", 0},
		{"", errors.New("meşgul"), "ERROR", 0},
	}
	for i, tc := range cases {
		h := newCP(t)
		h.consentOn()
		h.clip.text, h.clip.readErr = []byte(tc.text), tc.err
		h.c.onServer(signal.ClipPull{T: "clip.pull", CID: cid1})
		h.lastClip(tc.result, tc.n)
		if r := h.last().(signal.ClipReport); r.Dir != "TO_TECH" {
			t.Errorf("%d: yön %s", i, r.Dir)
		}
		if tc.result == "OK" {
			asm := dc.NewClipAssembler(tc.n)
			text, done, err := asm.Add(ctlOf(t, h.ctl[0]))
			if err != nil || !done || string(text) != tc.text {
				t.Errorf("%d: giden clip.data birebir değil", i)
			}
			if !slices.Equal(h.ui.notices, []string{noticeClipRead}) {
				t.Errorf("%d: bildirim %v", i, h.ui.notices)
			}
		} else if len(h.ctl) != 0 {
			t.Errorf("%d: başarısız okumada veri gitmemeli", i)
		}
	}
}

func TestOP28a1ResetClearsPendingWithoutReports(t *testing.T) {
	h := newCP(t)
	h.consentOn()
	h.c.onServer(signal.ClipPush{T: "clip.push", CID: cid1, Bytes: 1})
	h.startPrint(pid1, []byte("%PDF-1.7 belge"))
	h.runAsync()
	n := len(h.sent)
	h.c.reset()
	if len(h.sent) != n {
		t.Fatalf("kopmada rapor gönderilmez: %+v", h.sent[n:])
	}
	if h.c.clip != nil || h.c.print != nil || h.c.clipOn || !slices.Equal(h.ui.closed, []string{pid1}) {
		t.Fatalf("bekleyenler temizlenmeli, diyalog kapanmalı: %v", h.ui.closed)
	}
}

// --- yazdırma --------------------------------------------------------------------------------------------------

func chunkFrame(idx uint16, seq uint32, payload []byte) dc.Chunk {
	b := make([]byte, dc.ChunkHeaderBytes+len(payload))
	binary.BigEndian.PutUint16(b, idx)
	binary.BigEndian.PutUint32(b[2:], seq)
	copy(b[dc.ChunkHeaderBytes:], payload)
	c, _ := dc.DecodeChunk(b)
	return c
}

func offer(pid string, idx int, name string, pdf []byte) dc.Ctl {
	sum := sha256.Sum256(pdf)
	size := int64(len(pdf))
	return dc.Ctl{T: "print.offer", PID: pid, Idx: &idx, Name: name, Size: &size, SHA: hex.EncodeToString(sum[:])}
}

// startPrint istek → offer → çerçeveler → done (inceleme kuyrukta).
func (h *cpH) startPrint(pid string, pdf []byte) {
	h.t.Helper()
	h.c.onServer(signal.PrintRequest{T: "print.request", PID: pid, SizeBytes: int64(len(pdf))})
	if m := ctlOf(h.t, h.ctl[len(h.ctl)-1]); m.T != "print.ready" || m.PID != pid {
		h.t.Fatalf("print.ready bekleniyordu: %+v", m)
	}
	h.c.onCtl(offer(pid, 7, "..\\gizli-ad\u202efdp.exe", pdf))
	if !h.c.chunk(chunkFrame(7, 0, pdf), true) {
		h.t.Fatal("yazdırma çerçevesi yazdırmaya gitmeli")
	}
	h.c.onPrintDone(pid)
}

func TestAC349P28aPrintHappyPathAndBufferWiped(t *testing.T) {
	h := newCP(t)
	pdf := []byte("%PDF-1.7 belge içeriği")
	h.startPrint(pid1, pdf)
	h.runAsync()
	if len(h.ui.prompts) != 1 {
		t.Fatal("onay diyaloğu açılmalı")
	}
	p := h.ui.prompts[0]
	if p.Pages != 3 || p.Printer != "Ofis Yazıcısı" || p.TechName != "Ali Teknisyen" || strings.ContainsAny(p.FileName, "\\\u202e") {
		t.Fatalf("diyalog %+v", p)
	}
	h.c.onUser(Event{Kind: EvPrintApprove, PID: pid1})
	h.runAsync()
	r := h.lastPrint("APPROVED", "PRINTED")
	if r.Pages == nil || *r.Pages != 3 || r.SizeBytes != int64(len(pdf)) {
		t.Fatalf("rapor %+v", r)
	}
	if len(h.printer.seen) != 2 || &h.printer.seen[0][0] != &h.printer.seen[1][0] {
		t.Fatal("inceleme ve basma aynı (değişmez) dilimi kullanmalı")
	}
	if slices.ContainsFunc(h.printer.seen[1], func(b byte) bool { return b != 0 }) {
		t.Fatal("iş bitince tampon sıfırlanmalı")
	}
	if !slices.Equal(h.ui.notices, []string{noticePrinted}) || len(h.ui.closed) != 0 {
		t.Fatalf("bildirim %v kapanış %v", h.ui.notices, h.ui.closed)
	}
}

func TestAC348P28aPrintRequestRejections(t *testing.T) {
	h := newCP(t)
	h.gate = false
	h.c.onServer(signal.PrintRequest{T: "print.request", PID: pid1, SizeBytes: 100})
	h.lastPrint("NONE", "CANCELLED") // Y-P28a-1: kontrol izni yok
	h.gate, h.busy = true, true
	h.c.onServer(signal.PrintRequest{T: "print.request", PID: pid2, SizeBytes: 100})
	h.lastPrint("NONE", "BUSY") // TO_CUSTOMER dosya aktarımı sürüyor
	h.busy, h.printer.name = false, ""
	h.c.onServer(signal.PrintRequest{T: "print.request", PID: "Rq8-Zx_4KdLm2Nb7Vc1Ty0", SizeBytes: 100})
	h.lastPrint("NONE", "NO_PRINTER")
	h.c.onServer(signal.PrintRequest{T: "print.request", PID: pid1, SizeBytes: 100})
	h.lastPrint("NONE", "ERROR") // yeniden kullanılan pid
	if len(h.ctl) != 0 || len(h.ui.prompts) != 0 {
		t.Fatal("reddedilen istekte print.ready/diyalog olmamalı")
	}
}

func TestOP28a2PrintIntegrityRules(t *testing.T) {
	pdf := []byte("%PDF-1.4 xx")
	cases := map[string]func(h *cpH) string{
		"ikinci offer": func(h *cpH) string {
			h.c.onCtl(offer(pid1, 7, "a.pdf", pdf))
			h.c.onCtl(offer(pid1, 8, "a.pdf", pdf))
			return "ERROR"
		},
		"boyut farkı": func(h *cpH) string {
			h.c.onCtl(offer(pid1, 7, "a.pdf", append(pdf, 'x')))
			return "ERROR"
		},
		"kullanılmış idx": func(h *cpH) string {
			h.c.fileIdx(7)
			h.c.onCtl(offer(pid1, 7, "a.pdf", pdf))
			return "ERROR"
		},
		"beyanı aşan": func(h *cpH) string {
			h.c.onCtl(offer(pid1, 7, "a.pdf", pdf))
			h.c.chunk(chunkFrame(7, 0, append(pdf, 'x')), true)
			return "TOO_LARGE"
		},
		"hash farkı": func(h *cpH) string {
			o := offer(pid1, 7, "a.pdf", pdf)
			o.SHA = strings.Repeat("0", 64)
			h.c.onCtl(o)
			h.c.chunk(chunkFrame(7, 0, pdf), true)
			h.c.onPrintDone(pid1)
			return "ERROR"
		},
		"done sonrası çerçeve": func(h *cpH) string {
			h.c.onCtl(offer(pid1, 7, "a.pdf", pdf))
			h.c.chunk(chunkFrame(7, 0, pdf), true)
			h.c.onPrintDone(pid1)
			h.c.print.owns = true // sahiplik bırakılmış olsa da: done sonrası tampon değişmez
			h.c.chunk(chunkFrame(7, 1, []byte("x")), true)
			return "ERROR"
		},
		"PDF değil": func(h *cpH) string {
			doc := []byte("MZ\x90\x00exe!!!!") // istekle aynı boyut, `%PDF-` öneki yok
			h.c.onCtl(offer(pid1, 7, "a.pdf", doc))
			h.c.chunk(chunkFrame(7, 0, doc), true)
			h.c.onPrintDone(pid1)
			return "INVALID_PDF"
		},
	}
	for name, f := range cases {
		h := newCP(t)
		h.c.onServer(signal.PrintRequest{T: "print.request", PID: pid1, SizeBytes: int64(len(pdf))})
		want := f(h)
		if r, ok := h.last().(signal.PrintReport); !ok || r.Result != want || h.c.print != nil {
			t.Errorf("%s: %+v, beklenen %s", name, h.last(), want)
		}
	}
}

func TestOP28a2IdxOwnershipKeepsPrintBytesFromFiles(t *testing.T) {
	h := newCP(t)
	pdf := []byte("%PDF-1.7 x")
	h.c.onServer(signal.PrintRequest{T: "print.request", PID: pid1, SizeBytes: int64(len(pdf))})
	h.c.onCtl(offer(pid1, 7, "a.pdf", pdf))
	if h.c.fileIdx(7) {
		t.Fatal("etkin yazdırmanın idx'iyle dosya teklifi reddedilmeli")
	}
	if h.c.chunk(chunkFrame(9, 0, []byte("dosya")), true) {
		t.Fatal("başka idx dosya alıcısına kalmalı")
	}
	if !h.c.chunk(chunkFrame(7, 0, pdf), true) {
		t.Fatal("yazdırma idx'i tüketilmeli")
	}
}

func TestYP28a1ControlCloseCancelsPrint(t *testing.T) {
	for _, stage := range []string{"inceleme", "diyalog", "basma"} {
		h := newCP(t)
		h.startPrint(pid1, []byte("%PDF-1.7 belge"))
		if stage != "inceleme" {
			h.runAsync()
		}
		if stage == "basma" {
			h.c.onUser(Event{Kind: EvPrintApprove, PID: pid1})
		}
		h.c.controlClosed()
		want := "NONE"
		if stage == "basma" {
			want = "APPROVED"
		}
		h.lastPrint(want, "CANCELLED")
		if !slices.Equal(h.status, []string{statusPrintCanceled}) {
			t.Errorf("%s: durum %v", stage, h.status)
		}
		if (stage == "diyalog") != slices.Equal(h.ui.closed, []string{pid1}) {
			t.Errorf("%s: diyalog kapanışı %v", stage, h.ui.closed)
		}
		n := len(h.sent)
		h.runAsync() // iptal edilen işin geç sonucu etkisiz; tampon sıfırlanır
		if len(h.sent) != n || h.printer.cancelled == 0 && stage != "diyalog" {
			t.Errorf("%s: geç sonuç rapor üretmemeli / ctx iptal edilmeli", stage)
		}
		if len(h.printer.seen) > 0 && slices.ContainsFunc(h.printer.seen[0], func(b byte) bool { return b != 0 }) {
			t.Errorf("%s: tampon sıfırlanmalı", stage)
		}
	}
}

func TestAC349P28aPrintDeadlinesAndCancel(t *testing.T) {
	h := newCP(t)
	h.c.onServer(signal.PrintRequest{T: "print.request", PID: pid1, SizeBytes: 100})
	h.fire(8 * time.Minute)
	h.lastPrint("NONE", "TIMEOUT") // offer hiç gelmedi
	h = newCP(t)
	h.c.onServer(signal.PrintRequest{T: "print.request", PID: pid1, SizeBytes: 100})
	h.c.onCtl(offer(pid1, 7, "a.pdf", make([]byte, 100)))
	h.fire(8 * time.Minute)
	h.lastPrint("NONE", "ERROR") // aktarım aşaması
	h = newCP(t)
	h.startPrint(pid1, []byte("%PDF-1.7 belge"))
	h.runAsync()
	h.fire(time.Minute)
	h.lastPrint("TIMEOUT", "TIMEOUT")
	if !slices.Equal(h.ui.closed, []string{pid1}) {
		t.Fatal("zaman aşımında diyalog kapanmalı")
	}
	h = newCP(t)
	h.startPrint(pid1, []byte("%PDF-1.7 belge"))
	h.runAsync()
	h.c.onUser(Event{Kind: EvPrintReject, PID: pid1})
	if r := h.lastPrint("REJECTED", "REJECTED"); r.Pages == nil || *r.Pages != 3 {
		t.Fatalf("ret raporu sayfa taşır: %+v", r)
	}
	h = newCP(t)
	h.startPrint(pid1, []byte("%PDF-1.7 belge"))
	h.c.onServer(signal.PrintCancel{T: "print.cancel", PID: pid1})
	h.lastPrint("NONE", "CANCELLED")
	h = newCP(t)
	h.printer.inspectE = ErrPrintInvalidPDF
	h.startPrint(pid1, []byte("%PDF-1.7 parolalı"))
	h.runAsync()
	h.lastPrint("NONE", "INVALID_PDF")
}

// --- özellik bildirimi ----------------------------------------------------------------------------------------

func TestAC352P28aFeaturesOnlyWhenWired(t *testing.T) {
	ui, clip, pr := &fakeCPUI{}, &fakeClip{}, &fakePrinter{}
	if f := Features(Deps{}); f != nil {
		t.Fatalf("bağlı uygulama yokken bildirilmez: %v", f)
	}
	if f := Features(Deps{Clipboard: clip, Printer: pr, ClipPrintUI: ui}); !slices.Equal(f, []string{signal.FeatureClip, signal.FeaturePrint}) {
		t.Fatalf("%v", f)
	}
	if f := Features(Deps{Clipboard: clip, Printer: pr, ClipPrintUI: ui, Unattended: true}); f != nil {
		t.Fatalf("gözetimsiz yardımcı bildirmez: %v", f)
	}
	// Bildirilmeyen özelliğin iletimi yok sayılır (rapor 1008 doğururdu).
	var sent []signal.Outbound
	c := newClipPrint(context.Background(), cpDeps{clip: clip, printer: pr, ui: ui,
		send: func(m signal.Outbound) { sent = append(sent, m) }}, nil)
	c.onServer(signal.ClipPush{T: "clip.push", CID: cid1, Bytes: 1})
	c.onServer(signal.PrintRequest{T: "print.request", PID: pid1, SizeBytes: 5})
	if len(sent) != 0 {
		t.Fatalf("özelliksiz sokette gönderim: %+v", sent)
	}
}

// --- D-P28a-3: içerik ve dosya adı log/diag/durum/WS'ye yazılmaz ---------------------------------------------------

func TestDP28a3NoContentOrFileNameLeaks(t *testing.T) {
	const marker, name = "P28A-ISARET-pano-icerigi", "gizli-ad-fatura.pdf"
	h := newCP(t)
	h.consentOn()
	h.c.onServer(signal.ClipPush{T: "clip.push", CID: cid1, Bytes: len(marker)})
	h.pushText(cid1, marker)
	h.clip.text = []byte(marker)
	h.c.onServer(signal.ClipPull{T: "clip.pull", CID: cid2})
	pdf := []byte("%PDF-1.7 " + marker)
	h.c.onServer(signal.PrintRequest{T: "print.request", PID: pid1, SizeBytes: int64(len(pdf))})
	h.c.onCtl(offer(pid1, 3, name, pdf))
	h.c.chunk(chunkFrame(3, 0, pdf), true)
	h.c.onPrintDone(pid1)
	h.runAsync()
	h.c.controlClosed()
	var out []string
	for _, m := range h.sent {
		b, _ := json.Marshal(m)
		out = append(out, string(b))
	}
	out = append(append(out, h.status...), h.ui.notices...)
	for _, s := range out {
		if strings.Contains(s, "P28A-ISARET-") || strings.Contains(s, "gizli-ad-") {
			t.Fatalf("içerik/dosya adı sızdı: %s", s)
		}
	}
	// Kaynak sınırı: akışın P28a dosyaları log/diag/dosya/biçimli çıktı paketlerini içe aktarmaz.
	for _, f := range []string{"clipprint.go", "clipprint_print.go", "messages_p28.go", "files_server.go", "print_source.go"} { // + P28b
		src, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		for _, banned := range []string{`"log"`, `"log/slog"`, `"fmt"`, `"os"`, `internal/diag"`} {
			if strings.Contains(string(src), banned) {
				t.Errorf("%s %s içe aktarmamalı", f, banned)
			}
		}
	}
}

// r4 (mimari-p28f K5 notu, AC-349 macOS kısmi): sayfa sayısı vermeyen yazıcıda (PagesUnknown) sayfa 0 kabul edilir, diyalog
// PagesUnknown + boyutla açılır, rapor sayfa taşımaz; Windows yolunda (PagesUnknown false) sayfa 0 hâlâ INVALID_PDF.
func TestAC349P28fPrintPagesUnknown(t *testing.T) {
	pdf := []byte("%PDF-1.7 mac belgesi")
	h := newCP(t)
	h.printer.pages, h.printer.unknown, h.printer.name = 0, true, "Varsayılan yazıcı"
	h.startPrint(pid1, pdf)
	h.runAsync()
	if len(h.ui.prompts) != 1 {
		t.Fatal("onay diyaloğu açılmalı")
	}
	p := h.ui.prompts[0]
	if !p.PagesUnknown || p.Pages != 0 || p.Size != int64(len(pdf)) || p.Printer != "Varsayılan yazıcı" {
		t.Fatalf("diyalog %+v", p)
	}
	h.c.onUser(Event{Kind: EvPrintApprove, PID: pid1})
	h.runAsync()
	if r := h.lastPrint("APPROVED", "PRINTED"); r.Pages != nil {
		t.Fatalf("rapor sayfa taşımamalı: %+v", r)
	}
	// lp hatası (varsayılan yazıcı yok) onaydan sonra NO_PRINTER.
	h = newCP(t)
	h.printer.pages, h.printer.unknown, h.printer.printE = 0, true, ErrNoPrinter
	h.startPrint(pid1, pdf)
	h.runAsync()
	h.c.onUser(Event{Kind: EvPrintApprove, PID: pid1})
	h.runAsync()
	h.lastPrint("APPROVED", "NO_PRINTER")

	for _, c := range []struct {
		unknown bool
		pages   int
	}{{false, 0}, {true, -1}, {true, signal.PrintMaxPages + 1}} {
		h = newCP(t)
		h.printer.pages, h.printer.unknown = c.pages, c.unknown
		h.startPrint(pid1, pdf)
		h.runAsync()
		h.lastPrint("NONE", "INVALID_PDF")
		if len(h.ui.prompts) != 0 {
			t.Fatalf("%+v: diyalog açılmamalı", c)
		}
	}
	// Windows yolu: bilinen sayfa sayısı PagesUnknown=false ile gider.
	h = newCP(t)
	h.startPrint(pid1, pdf)
	h.runAsync()
	if p := h.ui.prompts[0]; p.PagesUnknown || p.Pages != 3 {
		t.Fatalf("Windows diyaloğu %+v", p)
	}
}
