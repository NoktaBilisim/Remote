package flow

import (
	"slices"
	"testing"

	"remote-support/agent-win/internal/signal"
)

// newServerCP SERVER modunda yazdırma (caps'te `print` yok — sunucu çıkarır; mimari-p28b §5.4).
func newServerCP(t *testing.T, fs *fakeFS) *cpH {
	h := newCP(t)
	h.caps = []string{"remote_control", "clipboard"}
	h.c.setSource(true, fs)
	return h
}

func (h *cpH) serverOffer(pid string, pdf []byte) signal.FsrvOffer {
	return signal.FsrvOffer{T: "fsrv.offer", FID: fsrvFID, Name: signal.FsrvPrintFileName, Size: int64(len(pdf)),
		SHA256: shaHex(pdf), Purpose: "PRINT", PID: pid}
}

func TestAC355P28bServerPrintHappyPath(t *testing.T) {
	pdf := []byte("%PDF-1.7 sunucudan belge")
	fs := &fakeFS{bodies: [][]byte{pdf}}
	h := newServerCP(t, fs)
	h.c.onServer(signal.PrintRequest{T: "print.request", PID: pid1, SizeBytes: int64(len(pdf))})
	if m := ctlOf(t, h.ctl[len(h.ctl)-1]); m.T != "print.ready" { // DC print.ready aynen (§5.3)
		t.Fatalf("%+v", m)
	}
	h.c.onFsrvOffer(h.serverOffer(pid1, pdf))
	if a, ok := h.last().(signal.FsrvAccept); !ok || a.FID != fsrvFID {
		t.Fatalf("fsrv.accept bekleniyordu: %+v", h.last())
	}
	if !h.c.onFsrvDownload(signal.FsrvDownload{T: "fsrv.download", FID: fsrvFID, Token: fsrvToken, ExpiresAt: "2026-11-16T10:05:00.000Z"}) {
		t.Fatal("indirme yazdırma işine ait")
	}
	h.runAsync() // indirme → doğrulama → inceleme
	if r, ok := h.sent[len(h.sent)-1].(signal.FsrvResult); !ok || !r.OK {
		t.Fatalf("fsrv.result{ok:true} bekleniyordu: %+v", h.sent)
	}
	h.runAsync()
	if len(h.ui.prompts) != 1 || h.ui.prompts[0].Pages != 3 {
		t.Fatalf("onay diyaloğu: %+v", h.ui.prompts)
	}
	h.c.onUser(Event{Kind: EvPrintApprove, PID: pid1})
	h.runAsync()
	if r := h.lastPrint("APPROVED", "PRINTED"); r.SizeBytes != int64(len(pdf)) {
		t.Fatalf("%+v", r)
	}
	if fs.calls[0] != fsrvFID+"|"+fsrvToken {
		t.Fatalf("%v", fs.calls)
	}
}

func TestDP28b3ServerPrintOfferMismatchRejected(t *testing.T) {
	pdf := []byte("%PDF-1.7 belge")
	h := newServerCP(t, &fakeFS{})
	h.c.onServer(signal.PrintRequest{T: "print.request", PID: pid1, SizeBytes: int64(len(pdf))})
	// Bilinmeyen pid: teklif reddedilir, bekleyen iş sürer.
	h.c.onFsrvOffer(h.serverOffer(pid2, pdf))
	if r, ok := h.last().(signal.FsrvReject); !ok || r.FID != fsrvFID || h.c.print == nil {
		t.Fatalf("%+v", h.sent)
	}
	// Boyut uyuşmaz: ret + print.report{ERROR}.
	o := h.serverOffer(pid1, append(pdf, 'x'))
	h.c.onFsrvOffer(o)
	h.lastPrint("NONE", "ERROR")
	if !slices.ContainsFunc(h.sent, func(m signal.Outbound) bool { _, ok := m.(signal.FsrvReject); return ok }) {
		t.Fatal("fsrv.reject yok")
	}
}

func TestDP28b3ServerPrintBadContent(t *testing.T) {
	for name, tc := range map[string]struct {
		body   []byte
		result string
	}{
		"sha":   {[]byte("%PDF-1.7 değişti"), "ERROR"},
		"magic": {[]byte("MZ-1.7 belge!!"), "INVALID_PDF"},
	} {
		t.Run(name, func(t *testing.T) {
			pdf := []byte("%PDF-1.7 belge!!")
			if name == "magic" {
				pdf = tc.body
			}
			h := newServerCP(t, &fakeFS{bodies: [][]byte{tc.body}})
			h.c.onServer(signal.PrintRequest{T: "print.request", PID: pid1, SizeBytes: int64(len(pdf))})
			o := h.serverOffer(pid1, pdf)
			if name == "sha" {
				o.Size = int64(len(tc.body))
				h.c.print.size = o.Size
			}
			h.c.onFsrvOffer(o)
			h.c.onFsrvDownload(signal.FsrvDownload{T: "fsrv.download", FID: fsrvFID, Token: fsrvToken, ExpiresAt: "2026-11-16T10:05:00.000Z"})
			h.runAsync()
			if r, ok := h.last().(signal.FsrvResult); !ok || r.OK {
				t.Fatalf("fsrv.result{ok:false}: %+v", h.sent)
			}
			r := h.sent[len(h.sent)-2].(signal.PrintReport)
			if r.Result != tc.result || len(h.ui.prompts) != 0 {
				t.Fatalf("%+v", r)
			}
		})
	}
}

func TestAC355P28bServerModeIgnoresDCPrintOfferAndMissingPrintCap(t *testing.T) {
	pdf := []byte("%PDF-1.7 belge")
	h := newServerCP(t, &fakeFS{})
	h.c.onServer(signal.PrintRequest{T: "print.request", PID: pid1, SizeBytes: int64(len(pdf))})
	h.c.capsChanged() // caps'te print yok: SERVER modunda iş sürer
	if h.c.print == nil {
		t.Fatal("SERVER modunda print caps'i aranmaz")
	}
	h.c.onCtl(offer(pid1, 7, "a.pdf", pdf)) // DC print.offer → ERROR
	h.lastPrint("NONE", "ERROR")
	// P2P'de caps'te print yoksa istek reddedilir (G-09 aynen).
	p := newCP(t)
	p.caps = []string{"remote_control"}
	p.c.setSource(false, nil)
	p.c.onServer(signal.PrintRequest{T: "print.request", PID: pid1, SizeBytes: int64(len(pdf))})
	p.lastPrint("NONE", "ERROR")
}
