package fsrv

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"remote-support/agent-win/internal/signal"
)

// maxRewinds 409 `{next}` ile geri sarma payı (sonsuz döngü koruması).
const maxRewinds = 8

// chunkTimeout tek parça isteğinin üst süresi (Caddy `read_body 30s` + yanıt payı).
const chunkTimeout = 45 * time.Second

// Digest kaynağın SHA-256'sı ve boyutu (yüklemenin ilk geçişi; bellek sabit, `fsrv.init` bunu beyan eder).
func Digest(r io.Reader) (sha string, size int64, err error) {
	h := sha256.New()
	n, err := io.Copy(h, r)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}

// chunkReply 200 `{next, received}` / 409 `{next}` / 202 `{state:"SCANNING"}`.
type chunkReply struct {
	Next  *int   `json:"next"`
	State string `json:"state"`
}

// Upload `fsrv.upload` belirteciyle size baytı 1 MiB'lık sıralı PUT parçalarıyla gönderir (ikinci geçiş: src ReadAt).
// Parça başına 3 deneme (1/2/4 sn; yalnız ağ/5xx); 409 `{next}` → sunucunun beklediği parçadan devam; 409
// STORAGE_QUOTA → ErrQuota. progress (nil olabilir) gönderilen bayt sayısıyla çağrılır. Son parça 202 ile biter.
func (c *Client) Upload(ctx context.Context, fid, token string, size int64, src io.ReaderAt, progress func(sent int64)) error {
	if !signal.ValidFsrvFID(fid) || !signal.ValidFsrvToken(token) || size < 1 || size > signal.FsrvMaxBytes {
		return ErrInvalid
	}
	chunks := int((size + signal.FsrvChunkBytes - 1) / signal.FsrvChunkBytes)
	buf := make([]byte, signal.FsrvChunkBytes)
	for n, steps := 0, 0; n < chunks; steps++ {
		if steps > 2*chunks+maxRewinds { // sunucu ilerlemiyor (ping-pong): kesin hata
			return &HTTPError{Status: http.StatusConflict}
		}
		off := int64(n) * signal.FsrvChunkBytes
		part := buf[:min(int64(signal.FsrvChunkBytes), size-off)]
		if k, err := src.ReadAt(part, off); k != len(part) { // dosya küçüldü/okunamadı: eski tampon gönderilmez
			if err == nil || errors.Is(err, io.EOF) {
				err = io.ErrUnexpectedEOF
			}
			return err
		}
		next, done, err := c.putChunk(ctx, fid, token, n, part)
		if err != nil {
			return err
		}
		if done {
			if progress != nil {
				progress(size)
			}
			return nil
		}
		if next < 0 || next > chunks {
			return &HTTPError{Status: http.StatusConflict}
		}
		n = next
		if progress != nil {
			progress(min(int64(n)*signal.FsrvChunkBytes, size))
		}
	}
	return &HTTPError{Status: http.StatusConflict} // son parça 202 almadan sıra bitti
}

// putChunk tek parçayı yeniden denemeyle gönderir; next = sunucunun beklediği parça, done = 202 (tarama başladı).
func (c *Client) putChunk(ctx context.Context, fid, token string, n int, data []byte) (next int, done bool, err error) {
	for attempt := 0; ; attempt++ {
		next, done, err = c.putOnce(ctx, fid, token, n, data)
		if err == nil || !retryable(err) || attempt >= len(c.backoff) {
			return next, done, err
		}
		if serr := sleep(ctx, c.backoff[attempt]); serr != nil {
			return 0, false, serr
		}
	}
}

func (c *Client) putOnce(ctx context.Context, fid, token string, n int, data []byte) (int, bool, error) {
	cctx, cancel := context.WithTimeout(ctx, chunkTimeout)
	defer cancel()
	req, err := c.request(cctx, http.MethodPut, uploadPath+fid+"/chunks/"+strconv.Itoa(n), token, bytes.NewReader(data),
		int64(len(data)))
	if err != nil {
		return 0, false, err
	}
	resp, err := c.do(req)
	if err != nil {
		if ctx.Err() != nil {
			return 0, false, ctx.Err()
		}
		return 0, false, err
	}
	switch resp.StatusCode {
	case http.StatusOK, http.StatusAccepted:
		defer resp.Body.Close()
		var r chunkReply
		if json.NewDecoder(io.LimitReader(resp.Body, errBodyMax)).Decode(&r) != nil {
			return 0, false, &HTTPError{Status: resp.StatusCode}
		}
		if resp.StatusCode == http.StatusAccepted {
			return 0, r.State == "SCANNING", nil
		}
		if r.Next == nil {
			return 0, false, &HTTPError{Status: resp.StatusCode}
		}
		return *r.Next, false, nil
	case http.StatusConflict:
		return conflict(resp)
	}
	return 0, false, httpError(resp)
}

// conflict 409: `{next}` (n > next → kaldığı yerden devam) ya da hata zarfı (STORAGE_QUOTA → ErrQuota).
func conflict(resp *http.Response) (int, bool, error) {
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, errBodyMax))
	var r chunkReply
	if json.Unmarshal(raw, &r) == nil && r.Next != nil {
		return *r.Next, false, nil
	}
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(raw, &env)
	if env.Error.Code == "STORAGE_QUOTA" {
		return 0, false, ErrQuota
	}
	return 0, false, &HTTPError{Status: resp.StatusCode, Code: env.Error.Code}
}
