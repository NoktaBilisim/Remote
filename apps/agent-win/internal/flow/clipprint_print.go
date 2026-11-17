package flow

import (
	"bytes"
	"context"
	"errors"
	"slices"
	"strings"
	"unicode"

	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/files"
	"remote-support/agent-win/internal/signal"
)

// Uzaktan yazdırma, misafir tarafı (mimari-p28 §4.5 "Yazdır", §5.3; r2 O-P28a-1/2, Y-P28a-1). Bayt yalnız bellekte
// toplanır; `print.done` doğrulandıktan sonra tampon değişmez (inceleme, diyalog ve basma aynı dilimi kullanır) ve iş
// her sonuçta sıfırlanır.

type printStage int

const (
	psWaitOffer  printStage = iota // print.ready gönderildi, offer bekleniyor
	psReceiving                    // offer alındı, `file` çerçeveleri toplanıyor
	psInspecting                   // done doğrulandı, işleyici sayfa sayıyor
	psPrompt                       // onay diyaloğu açık
	psPrinting                     // onaylandı, basılıyor
)

type printJob struct {
	pid     string
	size    int64
	stage   printStage
	owns    bool // idx bu işe ait (yazdırma çerçeveleri dosya alıcısına gitmez)
	idx     uint16
	name    string // temizlenmiş, yalnız diyalogda gösterilir
	sha     string
	rx      *dc.Receiver
	buf     []byte
	pages   int
	printer string
	stop    func() bool
	cancel  context.CancelFunc
	busy    bool // goroutine tamponu kullanıyor; sıfırlama dönüş kapanışında
	// P28b sunucu kaynağı: teklifin fid'i, indirme belirteci (yalnız bellek; loglanmaz), alınan bayt.
	fid, token string
	got        int64
}

func noStop() bool { return false }

func (c *clipPrint) printReport(pid, decision, result string, pages int, size int64) {
	r := signal.PrintReport{T: "print.report", PID: pid, Decision: decision, Result: result, SizeBytes: size}
	if pages > 0 {
		r.Pages = &pages
	}
	c.d.send(r)
}

func (c *clipPrint) onPrintRequest(m signal.PrintRequest) {
	if !c.printOK {
		return
	}
	reject := func(result string) { c.dropped++; c.printReport(m.PID, "NONE", result, 0, 0) }
	name, hasPrinter := "", false
	switch {
	case !c.remember(m.PID) || !c.printCap():
		reject("ERROR")
		return
	case c.print != nil || c.d.filesBusy(): // yön başına tek aktarım (§4.4)
		reject("BUSY")
		return
	case !c.d.gateOpen(): // Y-P28a-1
		reject("CANCELLED")
		return
	}
	if name, hasPrinter = c.d.printer.DefaultPrinter(); !hasPrinter {
		reject("NO_PRINTER")
		return
	}
	j := &printJob{pid: m.PID, size: m.SizeBytes, printer: name, stop: noStop}
	c.print = j
	j.stop = c.d.after(printDeadline, func() {
		if c.print == j && j.stage < psPrompt {
			result := "ERROR" // aktarım/inceleme aşaması
			if j.stage == psWaitOffer {
				result = "TIMEOUT"
			}
			c.finishPrint(result)
		}
	})
	b, err := dc.PrintReady(m.PID)
	if err != nil || c.d.sendCtl(b) != nil {
		c.finishPrint("ERROR")
	}
}

func (c *clipPrint) onPrintOffer(m dc.Ctl) {
	j := c.print
	switch {
	case c.server && j != nil && m.PID == j.pid: // P28b §5.4: SERVER modunda DC print.offer reddedilir
		c.finishPrint("ERROR")
	case c.server || j == nil || m.PID != j.pid:
		c.dropped++
	case j.stage != psWaitOffer: // pid başına tek offer (O-P28a-2 m.1)
		c.finishPrint("ERROR")
	case *m.Size != j.size || slices.Contains(c.seenIdx, uint16(*m.Idx)): // yetkilenen boyut; idx yeniden kullanımı
		c.finishPrint("ERROR")
	default:
		j.idx, j.owns, j.sha = uint16(*m.Idx), true, m.SHA
		j.name = displayText(files.SanitizeFileName(m.Name), files.Fallback)
		c.rememberIdx(j.idx)
		j.rx = dc.NewReceiver(j.size, dc.PrintMaxBytes)
		j.buf = make([]byte, 0, j.size)
		j.stage = psReceiving
	}
}

// chunk `file` çerçevesi: yazdırmanın idx'iyse tüketir (true); değilse dosya alıcısına bırakır.
func (c *clipPrint) chunk(ch dc.Chunk, ok bool) bool {
	if c == nil || c.print == nil || !c.print.owns {
		return false
	}
	j := c.print
	if !ok { // bozuk çerçeve: kimin olduğu bilinmez, alımdaki yazdırma da biter
		c.finishPrint("ERROR")
		return false
	}
	if ch.FIDIndex != j.idx {
		return false
	}
	if j.stage != psReceiving { // done sonrası çerçeve: tampon değişmez (O-P28a-2 m.2)
		c.finishPrint("ERROR")
		return true
	}
	switch j.rx.Add(ch) {
	case dc.AddExceeded:
		c.finishPrint("TOO_LARGE")
	case dc.AddOutOfOrder:
		c.finishPrint("ERROR")
	default:
		j.buf = append(j.buf, ch.Payload...)
	}
	return true
}

func (c *clipPrint) onPrintDone(pid string) {
	j := c.print
	switch {
	case j == nil || pid != j.pid:
		c.dropped++
		return
	case j.stage != psReceiving:
		c.finishPrint("ERROR")
		return
	}
	j.owns = false
	buf, _ := c.src.Fetch(c.ctx, j) // DC kaynağı: toplanan tampon (engellemez)
	c.acceptPDF(j, buf)
}

// acceptPDF ortak doğrulama (iki kaynak; mimari-p28b §8 "arayüzün arkasında değil"): boyut = yetkilenen boyut, SHA-256 =
// teklifteki, `%PDF-` öneki. Geçerse tampon donar (inceleme, diyalog ve basma aynı dilimi kullanır) ve inceleme başlar.
func (c *clipPrint) acceptPDF(j *printJob, buf []byte) bool {
	j.buf, j.got = buf, int64(len(buf))
	switch {
	case j.got != j.size || !sha256Equal(buf, j.sha):
		c.finishPrint("ERROR")
		return false
	case !bytes.HasPrefix(buf, []byte(dc.PDFMagic)):
		c.finishPrint("INVALID_PDF")
		return false
	}
	j.stage = psInspecting
	pdf, p := j.buf, c.d.printer
	c.async(j, func(ctx context.Context) func() {
		pages, err := p.Inspect(ctx, pdf)
		return func() { c.onInspected(j, pages, err) }
	})
	return true
}

// async op'u ayrı goroutine'de çalıştırır; sonuç kapanışı yalnız iş hâlâ güncelse uygulanır, değilse tampon sıfırlanır.
func (c *clipPrint) async(j *printJob, op func(ctx context.Context) func()) {
	ctx, cancel := context.WithCancel(c.ctx)
	j.cancel, j.busy = cancel, true
	c.d.spawn(func() func() {
		done := op(ctx)
		return func() {
			cancel()
			j.busy = false
			if c.print != j {
				clear(j.buf)
				j.buf = nil
				return
			}
			done()
		}
	})
}

func (c *clipPrint) onInspected(j *printJob, pages int, err error) {
	unknown := pagesUnknown(c.d.printer) && pages == 0 // r4: yalnız sayfa sayısı vermeyen yazıcıda (macOS)
	switch {
	case errors.Is(err, ErrPrintInvalidPDF) || (err == nil && !unknown && (pages < 1 || pages > signal.PrintMaxPages)):
		c.finishPrint("INVALID_PDF")
		return
	case err != nil:
		c.finishPrint("ERROR")
		return
	case !c.d.gateOpen():
		c.finishPrint("CANCELLED")
		return
	}
	j.stop()
	j.pages, j.stage = pages, psPrompt
	j.stop = c.d.after(printConsentFor, func() {
		if c.print == j && j.stage == psPrompt {
			c.finishPrintAs("TIMEOUT", "TIMEOUT", true)
		}
	})
	c.d.ui.PrintPrompt(PrintPrompt{PID: j.pid, TechName: c.d.techName(), FileName: j.name, Pages: pages, PagesUnknown: unknown, Size: int64(len(j.buf)),
		Printer: displayText(j.printer, ""), Deadline: c.d.now().Add(printConsentFor)})
}

// onPrintDecision müşterinin diyalog kararı (diyaloğu UI kendisi kapattı).
func (c *clipPrint) onPrintDecision(pid string, approve bool) {
	j := c.print
	if j == nil || j.pid != pid || j.stage != psPrompt {
		return
	}
	switch {
	case !approve:
		c.finishPrintAs("REJECTED", "REJECTED", false)
		return
	case !c.d.gateOpen(): // basmadan hemen önce (Y-P28a-1)
		c.finishPrintAs("NONE", "CANCELLED", false)
		return
	}
	j.stop()
	j.stop, j.stage = noStop, psPrinting
	pdf, pages, p := j.buf, j.pages, c.d.printer
	c.async(j, func(ctx context.Context) func() {
		err := p.Print(ctx, pdf, pages)
		return func() { c.onPrinted(j, err) }
	})
}

func (c *clipPrint) onPrinted(j *printJob, err error) {
	switch {
	case err == nil:
		c.finishPrintAs("APPROVED", "PRINTED", false)
		c.d.ui.Notice(noticePrinted)
	case errors.Is(err, ErrNoPrinter):
		c.finishPrintAs("APPROVED", "NO_PRINTER", false)
	default:
		c.finishPrintAs("APPROVED", "ERROR", false)
	}
}

// finishPrint işi sonuçla bitirir; karar basma aşamasında APPROVED, öncesinde NONE. Açık diyalog kapanır.
func (c *clipPrint) finishPrint(result string) {
	decision := "NONE"
	if c.print.stage == psPrinting {
		decision = "APPROVED"
	}
	c.finishPrintAs(decision, result, true)
}

func (c *clipPrint) finishPrintAs(decision, result string, closePrompt bool) {
	j := c.print
	size := min(j.got, j.size)
	if j.rx != nil {
		size = min(j.rx.Bytes(), j.size)
	}
	c.printReport(j.pid, decision, result, j.pages, size)
	if !closePrompt {
		j.stage = psPrinting // diyalog zaten kapalı; dropPrint kapatma çağırmasın
	}
	c.dropPrint()
}

// dropPrint işi raporsuz kaldırır: zamanlayıcı durur, süren işlem iptal edilir, açık diyalog kapanır, tampon sıfırlanır
// (goroutine kullanıyorsa dönüşünde).
func (c *clipPrint) dropPrint() {
	j := c.print
	c.print = nil
	j.stop()
	if j.cancel != nil {
		j.cancel()
	}
	if j.stage == psPrompt {
		c.d.ui.PrintPromptClosed(j.pid)
	}
	if !j.busy {
		clear(j.buf)
		j.buf = nil
	}
}

// displayText gösterim süzgeci (G-06; `request.Display` eşi — gözetimsiz yardımcı sınırı internal/request'i yasakladığı
// için akış kendi kopyasını tutmaz, aynı kuralı burada uygular): satır/paragraf ayırıcıları ve sekme boşluğa, diğer
// Cc/Cf (bidi, sıfır genişlik), U+034F, U+180E çıkarılır; boşsa fallback.
func displayText(s, fallback string) string {
	out := strings.TrimSpace(strings.Map(func(r rune) rune {
		switch {
		case r == '\n' || r == '\r' || r == '\t' || unicode.In(r, unicode.Zl, unicode.Zp):
			return ' '
		case unicode.In(r, unicode.Cc, unicode.Cf) || r == 0x034f || r == 0x180e:
			return -1
		}
		return r
	}, s))
	if out == "" {
		return fallback
	}
	return out
}
