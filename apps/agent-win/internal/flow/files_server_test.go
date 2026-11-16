package flow

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/signal"
)

const (
	fsrvFID   = "01JD5ZQ8X3M4N5P6Q7R8S9T0VW"
	fsrvToken = "Abc_defGhijKlmnOpqrStuvWxyz0123456789-_ABCD"
)

// fakeFS internal/fsrv.Client eşi: her Download çağrısı sıradaki gövdeyi yazar.
type fakeFS struct {
	mu      sync.Mutex
	bodies  [][]byte
	calls   []string // fid|token
	err     error
	block   chan struct{} // nil değilse gövde yazıldıktan sonra ctx iptaline kadar bekler
	started chan struct{}
}

func (f *fakeFS) Download(ctx context.Context, fid, token string, limit int64, w io.Writer) (int64, error) {
	f.mu.Lock()
	f.calls = append(f.calls, fid+"|"+token)
	var body []byte
	if len(f.bodies) > 0 {
		body, f.bodies = f.bodies[0], f.bodies[1:]
	}
	err := f.err
	f.mu.Unlock()
	if err != nil {
		return 0, err
	}
	if int64(len(body)) > limit {
		return 0, errors.New("sınır")
	}
	n, werr := w.Write(body)
	if f.block != nil {
		f.started <- struct{}{}
		select {
		case <-f.block:
		case <-ctx.Done():
			return int64(n), ctx.Err()
		}
	}
	return int64(n), werr
}

type fakeFSUI struct{ calls chan string }

func (u *fakeFSUI) FileServerMode(on bool) {
	if on {
		u.calls <- "mode:SERVER"
	} else {
		u.calls <- "mode:P2P"
	}
}
func (u *fakeFSUI) FileServerStatus(text string, final bool) {
	if final {
		u.calls <- "final:" + text
	} else {
		u.calls <- "status:" + text
	}
}

func expectFS(t *testing.T, u *fakeFSUI, want string) {
	t.Helper()
	for recv(t, u.calls) != want {
	}
}

func shaHex(b []byte) string { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }

// sentOf sıradaki giden mesajlar arasında T tipindekini bekler.
func sentOf[T signal.Outbound](t *testing.T, c *fakeConn) T {
	t.Helper()
	for {
		if m, ok := recv(t, c.sent).(T); ok {
			return m
		}
	}
}

type fsH struct {
	*harness
	fs   *fakeFS
	fsui *fakeFSUI
	dir  string
	c    *fakeConn
	p    *fakePeer
	out  chan Outcome
}

// serverSession SERVER modunda kabul edilmiş oturum (fsrv bildirildi, hello.fileMode=SERVER, caps'te file_transfer yok).
func serverSession(t *testing.T, mode string) *fsH {
	t.Helper()
	h := &fsH{harness: newHarness(t), fs: &fakeFS{started: make(chan struct{}, 1)}, fsui: &fakeFSUI{calls: make(chan string, 16)}, dir: t.TempDir()}
	h.deps.FileServer, h.deps.FileServerUI = h.fs, h.fsui
	h.deps.DownloadDir = func() (string, error) { return h.dir, nil }
	h.out = start(h.harness, "12345678")
	h.c = recv(t, h.conns)
	hl := hello(token)
	hl.Caps, hl.FileMode = []string{"remote_control"}, mode
	h.c.toClient <- hl
	h.p = recv(t, h.peers)
	expectCall(t, h.ui, "active:Ali Teknisyen:Ekran 2")
	return h
}

func (h *fsH) end(t *testing.T) {
	t.Helper()
	h.c.toClient <- signal.SessionEnded{T: "session.ended", Reason: "tech"}
	recv(t, h.out)
}

func (h *fsH) offerFile(t *testing.T, name string, data []byte) {
	t.Helper()
	h.c.toClient <- signal.FsrvOffer{T: "fsrv.offer", FID: fsrvFID, Name: name, Size: int64(len(data)), SHA256: shaHex(data),
		Purpose: "FILE"}
	expectCall(t, h.ui, "fileoffer:"+name)
}

func TestAC355P28bFeatureDeclaredOnlyWhenWiredAndAttended(t *testing.T) {
	fs, ui := &fakeFS{}, &fakeFSUI{}
	if f := Features(Deps{FileServer: fs, FileServerUI: ui}); !slices.Equal(f, []string{signal.FeatureFsrv}) {
		t.Fatalf("%v", f)
	}
	if f := Features(Deps{FileServer: fs, FileServerUI: ui, Unattended: true}); f != nil {
		t.Fatalf("gözetimsiz yardımcı fsrv bildirmez: %v", f)
	}
	if f := Features(Deps{FileServer: fs}); f != nil {
		t.Fatalf("UI'sız bildirilmez: %v", f)
	}
}

func TestAC357P28bServerFileOfferAcceptDownloadVerify(t *testing.T) {
	h := serverSession(t, signal.FileModeServer)
	expectFS(t, h.fsui, "mode:SERVER") // AC-363 satırı
	data := []byte("teknisyenin raporu")
	h.fs.bodies = [][]byte{data}
	h.offerFile(t, "rapor.txt", data)
	h.events <- Event{Kind: EvFileAccept, FID: fsrvFID}
	if a := sentOf[signal.FsrvAccept](t, h.c); a.FID != fsrvFID {
		t.Fatalf("%+v", a)
	}
	h.c.toClient <- signal.FsrvDownload{T: "fsrv.download", FID: fsrvFID, Token: fsrvToken, ExpiresAt: "2026-11-16T10:05:00.000Z"}
	if r := sentOf[signal.FsrvResult](t, h.c); !r.OK {
		t.Fatalf("%+v", r)
	}
	expectCall(t, h.ui, "fileresult:OK")
	if got, _ := os.ReadFile(filepath.Join(h.dir, "rapor.txt")); !bytes.Equal(got, data) {
		t.Fatal("dosya yazılmadı")
	}
	if h.fs.calls[0] != fsrvFID+"|"+fsrvToken {
		t.Fatalf("indirme: %v", h.fs.calls)
	}
	h.end(t)
	// SERVER modunda file.meta gönderilmez (sunucu satırı kendisi yazar) ve DC yanıtı yok.
	for len(h.c.sent) > 0 {
		if m, ok := (<-h.c.sent).(signal.FileMeta); ok {
			t.Fatalf("file.meta gitti: %+v", m)
		}
	}
	if len(h.p.ctl) != 0 {
		t.Fatal("DC yanıtı gitti")
	}
}

func TestAC54P28bCorruptDownloadRetriesThenFails(t *testing.T) {
	h := serverSession(t, signal.FileModeServer)
	data := []byte("asıl içerik")
	bad := []byte("bozuk içerik")
	h.fs.bodies = [][]byte{bad, bad, bad}
	h.offerFile(t, "a.txt", data)
	h.events <- Event{Kind: EvFileAccept, FID: fsrvFID}
	for i := 0; i < signal.FsrvDownloadTokensPerFile; i++ {
		sentOf[signal.FsrvAccept](t, h.c)
		h.c.toClient <- signal.FsrvDownload{T: "fsrv.download", FID: fsrvFID, Token: fsrvToken, ExpiresAt: "2026-11-16T10:05:00.000Z"}
		if r := sentOf[signal.FsrvResult](t, h.c); r.OK {
			t.Fatal("bozuk dosya ok:true")
		}
	}
	expectCall(t, h.ui, "fileresult:CORRUPT")
	if ents, _ := os.ReadDir(h.dir); len(ents) != 0 {
		t.Fatalf("iz kaldı: %v", ents)
	}
	h.end(t)
}

func TestAC116P28bRejectAndCooldown(t *testing.T) {
	h := serverSession(t, signal.FileModeServer)
	data := []byte("x")
	h.offerFile(t, "a.txt", data)
	h.events <- Event{Kind: EvFileReject, FID: fsrvFID}
	if r := sentOf[signal.FsrvReject](t, h.c); r.FID != fsrvFID {
		t.Fatalf("%+v", r)
	}
	expectCall(t, h.ui, "fileresult:REJECTED")
	// 30 sn içinde yeni teklif diyalogsuz reddedilir.
	h.c.toClient <- signal.FsrvOffer{T: "fsrv.offer", FID: "01JD5ZQ8X3M4N5P6Q7R8S9T0VX", Name: "b.txt", Size: 1, SHA256: shaHex(data),
		Purpose: "FILE"}
	if r := sentOf[signal.FsrvReject](t, h.c); r.FID != "01JD5ZQ8X3M4N5P6Q7R8S9T0VX" {
		t.Fatalf("%+v", r)
	}
	h.end(t)
}

func TestAC355P28bDCFileOfferRejectedInServerMode(t *testing.T) {
	h := serverSession(t, signal.FileModeServer)
	idx, size := 3, int64(5)
	h.p.h.Ctl(dc.Ctl{T: "file.offer", FID: "f1", Idx: &idx, Name: "a.txt", Size: &size, SHA: strings.Repeat("a", 64)})
	b := recv(t, h.p.ctl)
	if m, err := dc.ParseCtl(b); err != nil || m.T != "file.reject" {
		t.Fatalf("DC teklif reddedilmeli: %s", b)
	}
	h.end(t)
}

func TestAC355P28bModeFixedAtFirstHello(t *testing.T) {
	h := serverSession(t, signal.FileModeP2P)
	expectFS(t, h.fsui, "mode:P2P")
	// Yeniden bağlanma hello'su SERVER dese de mod değişmez: fsrv teklifi reddedilir.
	hl := hello(token)
	hl.FileMode = signal.FileModeServer
	h.c.toClient <- hl
	recv(t, h.peers)
	h.c.toClient <- signal.FsrvOffer{T: "fsrv.offer", FID: fsrvFID, Name: "a.txt", Size: 1, SHA256: shaHex([]byte("x")), Purpose: "FILE"}
	if r := sentOf[signal.FsrvReject](t, h.c); r.FID != fsrvFID {
		t.Fatalf("%+v", r)
	}
	select {
	case c := <-h.fsui.calls:
		t.Fatalf("mod ikinci kez bildirildi: %s", c)
	default:
	}
	h.end(t)
}

func TestAC358AC359P28bStatusTexts(t *testing.T) {
	h := serverSession(t, signal.FileModeServer)
	expectFS(t, h.fsui, "mode:SERVER")
	p := 40
	h.c.toClient <- signal.FsrvStatus{T: "fsrv.status", FID: fsrvFID, State: "UPLOADING", Progress: &p}
	expectFS(t, h.fsui, "status:Yükleniyor %40")
	h.c.toClient <- signal.FsrvStatus{T: "fsrv.status", FID: fsrvFID, State: "SCANNING"}
	expectFS(t, h.fsui, "status:Virüs taraması yapılıyor")
	h.c.toClient <- signal.FsrvStatus{T: "fsrv.status", FID: fsrvFID, State: "INFECTED", Signature: "Eicar-Test-Signature"}
	expectFS(t, h.fsui, "final:Dosya virüslü bulundu (Eicar-Test-Signature), teslim edilmedi")
	h.c.toClient <- signal.FsrvStatus{T: "fsrv.status", FID: fsrvFID, State: "INFECTED"}
	expectFS(t, h.fsui, "final:Dosya virüslü bulundu (bilinmeyen imza), teslim edilmedi")
	h.c.toClient <- signal.FsrvStatus{T: "fsrv.status", FID: fsrvFID, State: "SCAN_FAILED", Reason: "ENCRYPTED"}
	expectFS(t, h.fsui, "final:Dosya taranamadı, teslim edilmedi: şifreli arşiv")
	h.c.toClient <- signal.FsrvStatus{T: "fsrv.status", FID: fsrvFID, State: "SCAN_FAILED", Reason: "BUSY"}
	expectFS(t, h.fsui, "final:Virüs tarama servisi yoğun, dosya teslim edilmedi")
	h.c.toClient <- signal.FsrvStatus{T: "fsrv.status", FID: fsrvFID, State: "SCANNING"}
	expectFS(t, h.fsui, "status:Virüs taraması yapılıyor")
	h.c.toClient <- signal.FsrvStatus{T: "fsrv.status", FID: fsrvFID, State: "CANCELLED"} // teklif öncesi iptal: alan temizlenir
	expectFS(t, h.fsui, "status:")
	h.end(t)
}

func TestAC108P28bCancelDuringDownloadLeavesNoTrace(t *testing.T) {
	h := serverSession(t, signal.FileModeServer)
	h.fs.block = make(chan struct{})
	data := []byte("uzun dosya içeriği")
	h.fs.bodies = [][]byte{data[:4]}
	h.offerFile(t, "a.txt", data)
	h.events <- Event{Kind: EvFileAccept, FID: fsrvFID}
	sentOf[signal.FsrvAccept](t, h.c)
	h.c.toClient <- signal.FsrvDownload{T: "fsrv.download", FID: fsrvFID, Token: fsrvToken, ExpiresAt: "2026-11-16T10:05:00.000Z"}
	recv(t, h.fs.started)
	h.events <- Event{Kind: EvFileCancel}
	if c := sentOf[signal.FsrvCancel](t, h.c); c.FID != fsrvFID {
		t.Fatalf("%+v", c)
	}
	expectCall(t, h.ui, "fileresult:CANCELLED")
	h.end(t)
	// Goroutine ctx iptaliyle döner ve `.part`'ı siler.
	deadline := 50
	for ; deadline > 0; deadline-- {
		if ents, _ := os.ReadDir(h.dir); len(ents) == 0 {
			return
		}
		<-time.After(20 * time.Millisecond)
	}
	ents, _ := os.ReadDir(h.dir)
	t.Fatalf("iz kaldı: %v", ents)
}

func TestAC108P28bSessionEndDuringDownloadLeavesNoTrace(t *testing.T) {
	h := serverSession(t, signal.FileModeServer)
	h.fs.block = make(chan struct{})
	data := []byte("uzun dosya içeriği")
	h.fs.bodies = [][]byte{data[:4]}
	h.offerFile(t, "a.txt", data)
	h.events <- Event{Kind: EvFileAccept, FID: fsrvFID}
	sentOf[signal.FsrvAccept](t, h.c)
	h.c.toClient <- signal.FsrvDownload{T: "fsrv.download", FID: fsrvFID, Token: fsrvToken, ExpiresAt: "2026-11-16T10:05:00.000Z"}
	recv(t, h.fs.started)
	h.end(t) // cleanup goroutine'i bekler ve `.part`'ı siler
	if ents, _ := os.ReadDir(h.dir); len(ents) != 0 {
		t.Fatalf("iz kaldı: %v", ents)
	}
}

// Yeniden bağlanmada yarım alım yerelde CANCELLED biter, `.part` silinir ve yeni sokette fsrv.cancel gider; sonraki
// teklif meşgul sayılmaz.
func TestAC24P28bReconnectResetsServerTransfer(t *testing.T) {
	h := serverSession(t, signal.FileModeServer)
	h.fs.block = make(chan struct{})
	data := []byte("uzun dosya içeriği")
	h.fs.bodies = [][]byte{data[:4]}
	h.offerFile(t, "a.txt", data)
	h.events <- Event{Kind: EvFileAccept, FID: fsrvFID}
	sentOf[signal.FsrvAccept](t, h.c)
	h.c.toClient <- signal.FsrvDownload{T: "fsrv.download", FID: fsrvFID, Token: fsrvToken, ExpiresAt: "2026-11-16T10:05:00.000Z"}
	recv(t, h.fs.started)
	h.c.toClient <- errors.New("kopma")
	expectCall(t, h.ui, "fileresult:CANCELLED")
	c2 := recv(t, h.conns)
	if ents, _ := os.ReadDir(h.dir); len(ents) != 0 {
		t.Fatalf("iz kaldı: %v", ents)
	}
	c2.toClient <- hello(token)
	recv(t, h.peers)
	if c := sentOf[signal.FsrvCancel](t, c2); c.FID != fsrvFID {
		t.Fatalf("%+v", c)
	}
	h.c = c2
	h.fs.block = nil
	h.offerFile(t, "b.txt", data) // meşgul değil: diyalog açılır
	h.end(t)
}
