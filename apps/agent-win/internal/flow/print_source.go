package flow

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"

	"remote-support/agent-win/internal/signal"
)

// P28b (mimari-p28b §5.3, §8): yazdırma belgesinin bayt kaynağı. Kaynak oturumun ilk hello'sunda fileMode'a göre BİR KEZ
// seçilir (setSource); doğrulama (boyut, SHA-256, `%PDF-`, değişmez tampon) arayüzün arkasında değil ortak acceptPDF'tedir.
//   - dcPrintSource: P28a — `print.offer` + `file` çerçeveleri olay döngüsünde toplanır (chunk), `print.done`'da Fetch
//     toplanan tamponu döner (engellemez).
//   - serverPrintSource: `fsrv.offer{PRINT}` pid + boyut bekleyen işle eşleşirse `fsrv.accept`; `fsrv.download`
//     belirteciyle HTTPS'ten YALNIZ belleğe ≤ 20 MiB indirir (ayrı goroutine, c.async). Ad WS'den geçmez (`belge.pdf`).

// PrintSource yazdırma belgesinin baytları.
type PrintSource interface {
	Fetch(ctx context.Context, j *printJob) ([]byte, error)
}

type dcPrintSource struct{}

func (dcPrintSource) Fetch(_ context.Context, j *printJob) ([]byte, error) { return j.buf, nil }

type serverPrintSource struct{ fs FileServer }

func (s serverPrintSource) Fetch(ctx context.Context, j *printJob) ([]byte, error) {
	limit := min(j.size, signal.FsrvPrintMaxBytes)
	var b bytes.Buffer
	b.Grow(int(limit))
	if _, err := s.fs.Download(ctx, j.fid, j.token, limit, &b); err != nil {
		clear(b.Bytes())
		return nil, err
	}
	return b.Bytes(), nil
}

// setSource ilk hello'da bir kez (session.fixFileMode). SERVER yalnız fsrv bildirildiyse, yani fs bağlıyken seçilir.
func (c *clipPrint) setSource(server bool, fs FileServer) {
	if c == nil {
		return
	}
	c.server = server && fs != nil
	c.src = PrintSource(dcPrintSource{})
	if c.server {
		c.src = serverPrintSource{fs: fs}
	}
}

// printCap yazdırma yeteneği: P2P'de caps `print` (G-09); SERVER'da sunucu caps'ten çıkarır, kapı sunucudadır (§5.4).
func (c *clipPrint) printCap() bool { return c.server || c.d.hasCap(capPrint) }

// printBusy yazdırma işi var (yön başına tek TO_CUSTOMER aktarım).
func (c *clipPrint) printBusy() bool { return c != nil && c.print != nil }

func sha256Equal(b []byte, hexSum string) bool {
	want, err := hex.DecodeString(hexSum)
	sum := sha256.Sum256(b)
	return err == nil && subtle.ConstantTimeCompare(sum[:], want) == 1
}

// onFsrvOffer `fsrv.offer{PRINT}`: yalnız bekleyen işin pid'i + yetkilenen boyutu (≤ 20 MiB) ile eşleşirse kabul;
// aksi teklif reddedilir ve eşleşen pid'in işi `print.report{ERROR}` ile biter (D-P28b-3).
func (c *clipPrint) onFsrvOffer(m signal.FsrvOffer) {
	j := c.print
	ok := c.printOK && c.server && j != nil && j.pid == m.PID && j.stage == psWaitOffer && m.Size == j.size &&
		m.Size <= signal.FsrvPrintMaxBytes
	if !ok {
		c.d.send(signal.FsrvReject{T: "fsrv.reject", FID: m.FID})
		if j != nil && j.pid == m.PID {
			c.finishPrint("ERROR")
		} else {
			c.dropped++
		}
		return
	}
	j.fid, j.sha, j.stage = m.FID, m.SHA256, psReceiving
	c.d.send(signal.FsrvAccept{T: "fsrv.accept", FID: m.FID})
}

// onFsrvDownload yazdırma işinin belirteci geldiyse indirmeyi başlatır (true: mesaj bu işin).
func (c *clipPrint) onFsrvDownload(m signal.FsrvDownload) bool {
	if c == nil {
		return false
	}
	j := c.print
	if j == nil || j.fid == "" || j.fid != m.FID {
		return false
	}
	if j.stage != psReceiving || j.busy { // tek indirme
		return true
	}
	j.token = m.Token
	src := c.src
	c.async(j, func(ctx context.Context) func() {
		buf, err := src.Fetch(ctx, j)
		j.buf = buf // goroutine sahibi; döngü busy iken tampona dokunmaz, iş düştüyse async temizler
		return func() { c.onFetched(j, err) }
	})
	return true
}

// onFetched indirme bitti: ortak doğrulama; sonuç `fsrv.result` ile bildirilir (sunucu PRINT belgesini siler).
func (c *clipPrint) onFetched(j *printJob, err error) {
	j.token = ""
	if err != nil {
		c.d.send(signal.FsrvResult{T: "fsrv.result", FID: j.fid, OK: false})
		c.finishPrint("ERROR")
		return
	}
	ok := c.acceptPDF(j, j.buf)
	c.d.send(signal.FsrvResult{T: "fsrv.result", FID: j.fid, OK: ok})
}
