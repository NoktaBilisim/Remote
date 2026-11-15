package clipprint

import (
	"context"
	"errors"
	"testing"

	"remote-support/agent-win/internal/clip"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/printing"
)

type fakeClip struct {
	text    string
	err     error
	written string
}

func (f *fakeClip) ReadText() (string, error) { return f.text, f.err }
func (f *fakeClip) WriteText(s string) error  { f.written = s; return f.err }
func (f *fakeClip) Close()                    {}

func TestP28aClipAdapterErrors(t *testing.T) {
	cases := map[error]error{clip.ErrEmpty: flow.ErrClipEmpty, clip.ErrSensitive: flow.ErrClipSensitive,
		clip.ErrTooLarge: flow.ErrClipTooLarge}
	for in, want := range cases {
		a := &Clipboard{c: &fakeClip{err: in}}
		if _, err := a.Read(); !errors.Is(err, want) || !errors.Is(err, in) {
			t.Errorf("%v → %v", in, err)
		}
	}
	a := &Clipboard{c: &fakeClip{err: clip.ErrFailed}}
	if _, err := a.Read(); !errors.Is(err, clip.ErrFailed) || errors.Is(err, flow.ErrClipEmpty) {
		t.Errorf("ERROR eşlemesi: %v", err)
	}
	f := &fakeClip{text: "ğ\r\n"}
	a = &Clipboard{c: f}
	if b, err := a.Read(); err != nil || string(b) != "ğ\r\n" {
		t.Fatalf("%q %v", b, err)
	}
	if err := a.Write([]byte("x\ny")); err != nil || f.written != "x\ny" {
		t.Fatalf("yazma %q %v", f.written, err)
	}
}

type fakePrinter struct {
	name     string
	nameErr  error
	pages    int
	inspErr  error
	printErr error
	opened   int
	closed   int
	printed  string
}

func (p *fakePrinter) DefaultPrinter() (string, error) { return p.name, p.nameErr }
func (p *fakePrinter) Inspect(context.Context, []byte) (printing.Job, error) {
	if p.inspErr != nil {
		return nil, p.inspErr
	}
	p.opened++
	return &fakeJob{p: p}, nil
}

type fakeJob struct{ p *fakePrinter }

func (j *fakeJob) Pages() int { return j.p.pages }
func (j *fakeJob) Print(_ context.Context, name string) error {
	j.p.printed = name
	return j.p.printErr
}
func (j *fakeJob) Close() { j.p.closed++ }

func TestP28aPrinterAdapter(t *testing.T) {
	p := &fakePrinter{name: "Ofis", pages: 3}
	a := &Printer{p: p}
	if name, ok := a.DefaultPrinter(); !ok || name != "Ofis" {
		t.Fatal("yazıcı")
	}
	ctx := context.Background()
	if n, err := a.Inspect(ctx, []byte("%PDF-")); n != 3 || err != nil || p.closed != 1 {
		t.Fatalf("inspect %d %v kapanan=%d", n, err, p.closed)
	}
	if err := a.Print(ctx, []byte("%PDF-"), 3); err != nil || p.printed != "Ofis" || p.closed != 2 {
		t.Fatalf("print %v %q kapanan=%d", err, p.printed, p.closed)
	}
	if err := a.Print(ctx, []byte("%PDF-"), 4); err == nil {
		t.Fatal("sayfa sayısı farkı kabul edildi")
	}

	if _, ok := (&Printer{p: &fakePrinter{nameErr: printing.ErrNoPrinter}}).DefaultPrinter(); ok {
		t.Error("yazıcı yokken ok")
	}
	if err := (&Printer{p: &fakePrinter{nameErr: printing.ErrNoPrinter}}).Print(ctx, nil, 1); !errors.Is(err, flow.ErrNoPrinter) {
		t.Errorf("NO_PRINTER: %v", err)
	}
	for _, in := range []error{printing.ErrInvalidPDF, printing.ErrTooLarge} {
		if _, err := (&Printer{p: &fakePrinter{inspErr: in}}).Inspect(ctx, nil); !errors.Is(err, flow.ErrPrintInvalidPDF) {
			t.Errorf("%v → %v", in, err)
		}
	}
	if err := (&Printer{p: &fakePrinter{name: "x", pages: 1, printErr: printing.ErrCancelled}}).Print(ctx, nil, 1); !errors.Is(err, printing.ErrCancelled) || errors.Is(err, flow.ErrNoPrinter) {
		t.Errorf("iptal: %v", err)
	}
}
