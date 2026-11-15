//go:build windows

package printing

import (
	"bufio"
	"errors"
	"io"
	"os"
	"runtime"
	"time"
)

// İşleyici süreç (mimari-p28 §5.2): aynı ikili `--pdf-isleyici` ile yalnız stdin/stdout borusunu devralarak açılır.
// Pencere, ağ, dosya açma kodu yoktur; tek iş parçacığında WinRT MTA. Üst süreç Worker ile konuşur.

// WorkerArg işleyici kipinin tek ve tam argümanı.
const WorkerArg = "--pdf-isleyici"

// İşleyici çıkış kodları.
const (
	WorkerExitOK    = 0
	WorkerExitIO    = 1
	WorkerExitWinRT = 2
)

const (
	inspectTimeout = 15 * time.Second // §5.2
	pageTimeout    = 15 * time.Second
	stopGrace      = time.Second
)

// IsWorkerLaunch argümanlar yalnız WorkerArg ise true (başka biçim kabul edilmez).
func IsWorkerLaunch(args []string) bool { return len(args) == 2 && args[1] == WorkerArg }

// RunWorker işleyici ana döngüsü; çağıran önce dllsafe.Harden yapmış olmalıdır. Dönüş süreç çıkış kodudur.
func RunWorker() int {
	runtime.LockOSThread()
	if err := roInit(); err != nil {
		return WorkerExitWinRT
	}
	defer roUninit()
	return serve(bufio.NewReader(os.Stdin), os.Stdout)
}

// serve istekleri EOF'a kadar sırayla işler. Yüklü belge bir sonraki inspect'e kadar tutulur.
func serve(r io.Reader, w io.Writer) int {
	var doc *pdfDoc
	defer func() {
		if doc != nil {
			doc.close()
		}
	}()
	for {
		q, err := ReadRequest(r)
		if errors.Is(err, io.EOF) {
			return WorkerExitOK
		}
		if err != nil {
			return WorkerExitIO
		}
		var resp Response
		switch q.Op {
		case OpInspect:
			if doc != nil {
				doc.close()
				doc = nil
			}
			doc, err = loadPDF(q.PDF)
			clear(q.PDF)
			resp = inspectResponse(doc, err)
		case OpRender:
			resp = renderResponse(doc, q)
		}
		if err := WriteResponse(w, resp); err != nil {
			return WorkerExitIO
		}
	}
}

func inspectResponse(doc *pdfDoc, err error) Response {
	switch {
	case err == nil:
		return Response{Status: StatusOK, A: doc.pages}
	case errors.Is(err, ErrInvalidPDF):
		return Response{Status: StatusInvalidPDF}
	}
	return Response{Status: StatusError}
}

func renderResponse(doc *pdfDoc, q Request) Response {
	if doc == nil {
		return Response{Status: StatusError}
	}
	bm, err := doc.render(q.Idx, q.W, q.H)
	if err != nil {
		return Response{Status: StatusError}
	}
	return Response{Status: StatusOK, A: uint32(bm.W), B: uint32(bm.H), C: uint32(bm.Stride), Payload: bm.Pix}
}

// Worker üst sürecin işleyici bağlantısı. Yöntemler eşzamanlı çağrılmaz (tek iş sırası).
type Worker struct {
	p        *workerProc
	in, out  *os.File
	stopped  bool
	exitCode uint32
}

// Inspect PDF'i işleyiciye yükler, sayfa sayısını döner (1..MaxPages; dışı ErrInvalidPDF).
func (w *Worker) Inspect(pdf []byte) (int, error) {
	if len(pdf) == 0 || len(pdf) > MaxPDFBytes {
		return 0, ErrInvalidPDF
	}
	var pages int
	err := w.roundTrip(Request{Op: OpInspect, PDF: pdf}, inspectTimeout, func(r io.Reader) (err error) {
		pages, err = readInspect(r)
		return err
	})
	return pages, err
}

// Render idx sayfasını tam w×h BGR olarak ister; yanıt hedefle birebir doğrulanır (O-P28a-3).
func (w *Worker) Render(idx, width, height uint32) (*Bitmap, error) {
	if !validTarget(width, height) {
		return nil, ErrProtocol
	}
	var bm *Bitmap
	err := w.roundTrip(Request{Op: OpRender, Idx: idx, W: width, H: height}, pageTimeout, func(r io.Reader) (err error) {
		bm, err = readRender(r, width, height)
		return err
	})
	return bm, err
}

// roundTrip istek/yanıtı ayrı goroutine'de yürütür; zaman aşımında veya geçersiz PDF dışındaki her hatada işleyici
// durdurulur (job kapanır).
func (w *Worker) roundTrip(q Request, timeout time.Duration, read func(io.Reader) error) error {
	if w.stopped {
		return ErrWorker
	}
	done := make(chan error, 1)
	go func() {
		if err := WriteRequest(w.in, q); err != nil {
			done <- err
			return
		}
		done <- read(w.out)
	}()
	t := time.NewTimer(timeout)
	defer t.Stop()
	select {
	case err := <-done:
		if err != nil && !errors.Is(err, ErrInvalidPDF) {
			w.stop()
		}
		return err
	case <-t.C:
		w.stop()
		<-done
		return ErrWorker
	}
}

// Close işleyiciye EOF verir, kısa süre çıkmasını bekler, job'u kapatır; çıkış kodunu döner.
func (w *Worker) Close() uint32 {
	w.stop()
	return w.exitCode
}

func (w *Worker) stop() {
	if w.stopped {
		return
	}
	w.stopped = true
	_ = w.in.Close()
	w.exitCode = w.p.waitOrKill(stopGrace)
	_ = w.out.Close()
}
