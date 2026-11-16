package fsrv

import (
	"context"
	"io"
	"net/http"

	"remote-support/agent-win/internal/signal"
)

// Download `fsrv.download` belirteciyle dosyayı w'ye akıtır ve yazılan bayt sayısını döner. limit beyan edilen boyuttur
// (yazdırmada ayrıca ≤ 20 MiB): Content-Length ya da gövde limit'i aşarsa ErrTooLarge (fazla bayt yazılmaz). Yeniden
// deneme yoktur: alıcı doğrulama sonucunu `fsrv.result{ok:false}` ile bildirip `fsrv.accept`'le yeni belirteç ister
// (fid başına ≤ 3). Süre ctx ile sınırlanır (iptal = "İptal" düğmesi / oturum sonu).
func (c *Client) Download(ctx context.Context, fid, token string, limit int64, w io.Writer) (int64, error) {
	if !signal.ValidFsrvFID(fid) || !signal.ValidFsrvToken(token) || limit < 1 {
		return 0, ErrInvalid
	}
	req, err := c.request(ctx, http.MethodGet, downloadPath+fid+"/content", token, nil, 0)
	if err != nil {
		return 0, err
	}
	resp, err := c.do(req)
	if err != nil {
		return 0, err
	}
	if resp.StatusCode != http.StatusOK {
		return 0, httpError(resp)
	}
	defer resp.Body.Close()
	if resp.ContentLength > limit {
		return 0, ErrTooLarge
	}
	lw := &limitWriter{w: w, left: limit}
	_, err = io.Copy(lw, resp.Body)
	return lw.n, err
}

// limitWriter left baytı geçen yazımı ErrTooLarge ile keser (fazla bayt alttaki yazıcıya hiç gitmez).
type limitWriter struct {
	w    io.Writer
	left int64
	n    int64
}

func (l *limitWriter) Write(p []byte) (int, error) {
	if int64(len(p)) > l.left {
		return 0, ErrTooLarge
	}
	k, err := l.w.Write(p)
	l.left -= int64(k)
	l.n += int64(k)
	return k, err
}
