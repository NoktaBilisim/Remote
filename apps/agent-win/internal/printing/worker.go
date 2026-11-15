package printing

import (
	"context"
	"errors"
	"io"
	"sync"
	"time"
)

// İşleyici süreç protokolünün iki ucu (mimari-p28 §5.2). İşleyici tarafı (serve) yalnız boru okur/yazar; üst süreç
// tarafı (Worker) işleyici çıktısını güvenilmeyen girdi sayar (r2 O-P28a-3): her yanıt proto.go'da doğrulanır, okuma
// ayrı goroutine'de zaman aşımıyla yapılır ve geçersiz PDF dışındaki her hatada işleyici durdurulur (job kapanır).

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
	pageTimeout    = 15 * time.Second // sayfa ölçüsü ve render, ayrı ayrı
	totalTimeout   = 10 * time.Minute // işleyici ömrü boyunca
	stopGrace      = time.Second
)

// IsWorkerLaunch argümanlar yalnız WorkerArg ise true (başka biçim kabul edilmez).
func IsWorkerLaunch(args []string) bool { return len(args) == 2 && args[1] == WorkerArg }

// pageDoc işleyicide yüklü belge (Windows: Windows.Data.Pdf).
type pageDoc interface {
	pageCount() uint32
	pageSize(idx uint32) (w, h uint32, err error)
	render(idx, w, h uint32) (*Bitmap, error)
	close()
}

// serve istekleri EOF'a kadar sırayla işler. Yüklü belge bir sonraki inspect'e kadar tutulur.
func serve(r io.Reader, w io.Writer, load func([]byte) (pageDoc, error)) int {
	var doc pageDoc
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
			doc, err = load(q.PDF)
			clear(q.PDF)
			resp = inspectResponse(doc, err)
			if err != nil {
				doc = nil
			}
		case OpPageSize:
			resp = sizeResponse(doc, q.Idx)
		case OpRender:
			resp = renderResponse(doc, q)
		}
		err = WriteResponse(w, resp)
		clear(resp.Payload)
		if err != nil {
			return WorkerExitIO
		}
	}
}

func inspectResponse(doc pageDoc, err error) Response {
	switch {
	case err == nil && doc != nil:
		return Response{Status: StatusOK, A: doc.pageCount()}
	case errors.Is(err, ErrInvalidPDF):
		return Response{Status: StatusInvalidPDF}
	}
	return Response{Status: StatusError}
}

func sizeResponse(doc pageDoc, idx uint32) Response {
	if doc == nil {
		return Response{Status: StatusError}
	}
	w, h, err := doc.pageSize(idx)
	if err != nil {
		return Response{Status: StatusError}
	}
	return Response{Status: StatusOK, A: w, B: h}
}

func renderResponse(doc pageDoc, q Request) Response {
	if doc == nil {
		return Response{Status: StatusError}
	}
	bm, err := doc.render(q.Idx, q.W, q.H)
	if err != nil {
		return Response{Status: StatusError}
	}
	return Response{Status: StatusOK, A: uint32(bm.W), B: uint32(bm.H), C: uint32(bm.Stride), Payload: bm.Pix}
}

// Worker üst sürecin işleyici bağlantısı. Inspect/PageSize/Render eşzamanlı çağrılmaz (tek iş sırası); Close her
// goroutine'den çağrılabilir.
type Worker struct {
	in       io.WriteCloser
	out      io.ReadCloser
	kill     func(grace time.Duration) uint32 // EOF sonrası bekler, çıkmazsa job'u kapatır; çıkış kodu
	pid      uint32
	deadline time.Time
	pages    uint32

	mu       sync.Mutex
	stopped  bool
	exitCode uint32
}

func newWorker(in io.WriteCloser, out io.ReadCloser, kill func(time.Duration) uint32, pid uint32) *Worker {
	return &Worker{in: in, out: out, kill: kill, pid: pid, deadline: time.Now().Add(totalTimeout)}
}

// Inspect PDF'i işleyiciye yükler, sayfa sayısını döner (1..MaxPages; dışı ErrInvalidPDF).
func (w *Worker) Inspect(ctx context.Context, pdf []byte) (int, error) {
	switch {
	case len(pdf) == 0:
		return 0, ErrInvalidPDF
	case len(pdf) > MaxPDFBytes:
		return 0, ErrTooLarge
	}
	var pages int
	err := w.roundTrip(ctx, Request{Op: OpInspect, PDF: pdf}, inspectTimeout, func(r io.Reader) (err error) {
		pages, err = readInspect(r)
		return err
	})
	if err == nil {
		w.pages = uint32(pages)
	}
	return pages, err
}

// PageSize idx sayfasının ölçüsü (DIP; yalnız oran için). idx inspect'in döndürdüğü aralıkta olmalıdır.
func (w *Worker) PageSize(ctx context.Context, idx uint32) (uint32, uint32, error) {
	if idx >= w.pages {
		return 0, 0, ErrProtocol
	}
	var pw, ph uint32
	err := w.roundTrip(ctx, Request{Op: OpPageSize, Idx: idx}, pageTimeout, func(r io.Reader) (err error) {
		pw, ph, err = readPageSize(r)
		return err
	})
	return pw, ph, err
}

// Render idx sayfasını tam width×height BGR olarak ister; yanıt hedefle birebir doğrulanır (O-P28a-3).
func (w *Worker) Render(ctx context.Context, idx, width, height uint32) (*Bitmap, error) {
	if idx >= w.pages || !validTarget(width, height) {
		return nil, ErrProtocol
	}
	var bm *Bitmap
	err := w.roundTrip(ctx, Request{Op: OpRender, Idx: idx, W: width, H: height}, pageTimeout, func(r io.Reader) (err error) {
		bm, err = readRender(r, width, height)
		return err
	})
	return bm, err
}

// roundTrip istek/yanıtı ayrı goroutine'de yürütür. Zaman aşımı (adım veya toplam 10 dk) → ErrWorker, ctx iptali →
// ErrCancelled; ikisinde ve geçersiz PDF dışındaki her hatada işleyici durdurulur.
func (w *Worker) roundTrip(ctx context.Context, q Request, timeout time.Duration, read func(io.Reader) error) error {
	if w.isStopped() {
		return ErrWorker
	}
	if left := time.Until(w.deadline); left < timeout {
		timeout = left
	}
	if timeout <= 0 {
		w.Close()
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
			w.Close()
			if !errors.Is(err, ErrProtocol) {
				err = errors.Join(ErrWorker, err)
			}
		}
		return err
	case <-t.C:
		w.Close()
		<-done
		return ErrWorker
	case <-ctx.Done():
		w.Close()
		<-done
		return ErrCancelled
	}
}

func (w *Worker) isStopped() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.stopped
}

// Close işleyiciye EOF verir, kısa süre çıkmasını bekler, job'u kapatır; çıkış kodunu döner. Tekrar çağrılabilir.
func (w *Worker) Close() uint32 {
	w.mu.Lock()
	defer w.mu.Unlock()
	if !w.stopped {
		w.stopped = true
		_ = w.in.Close()
		w.exitCode = w.kill(stopGrace)
		_ = w.out.Close()
	}
	return w.exitCode
}
