//go:build p22glive

// P22-GQ test-operatoru canlı probu (ürün kodu DEĞİL; yalnız yerel koşu). Koşarken anlık görüntüde
// apps/agent-win/internal/flow/ altına kopyalanır: `go test -tags p22glive -run TestP22GLive ./internal/flow`.
// Gerçek internal/api istemcisi + gerçek signal.Dial (gerçek flow.Features → rs.cap.schat1) + gerçek rtc eşi, yerel
// gerçek sunucuya (apps/server) bir TLS ters vekil (httptest + httputil.ReverseProxy, WS yükseltmesini geçirir) üstünden
// bağlanır. Arayüz sahte (olaylar JSONL'a), ekran kaynağı sahte (TCC istemi yok). Sertifika güveni yalnız bu süreçte:
// api.New'in taşıyıcısına vekilin kökü eklenir (ürün TLS ayarı aynen kalır, MinVersion vb.).
// Ortam: P22G_UPSTREAM (http://127.0.0.1:3483), P22G_CODE (8 hane), P22G_OUT (olay JSONL), P22G_CMD (komut dosyası:
// "send <metin>" | "drop" | "up" | "end"), P22G_MODE ("" | "noretention": resolve yanıtından chatRetentionDays silinir).
package flow

import (
	"bytes"
	"context"
	"crypto/x509"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/transfer"
)

type liveLog struct {
	mu sync.Mutex
	f  *os.File
}

func (l *liveLog) ev(m map[string]any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	m["ts"] = time.Now().Format(time.RFC3339Nano)
	b, _ := json.Marshal(m)
	_, _ = l.f.Write(append(b, '\n'))
}

type liveUI struct{ l *liveLog }

func (u *liveUI) AskCode(context.Context, string) (string, bool) { return "", false }
func (u *liveUI) Welcome(_ context.Context, w Welcome) (string, bool) {
	line := ""
	if w.ChatRetentionDays >= 1 {
		line = ChatRetentionLine(w.ChatRetentionDays)
	}
	u.l.ev(map[string]any{"ev": "welcome", "days": w.ChatRetentionDays, "line": line, "tenant": w.Tenant, "tech": w.TechName})
	return "Go Probe", true // onay kutusu işaretli + Bağlan (arayüz kapısı GTK/uicore testlerinde)
}
func (u *liveUI) Lobby(code, tech string) { u.l.ev(map[string]any{"ev": "lobby", "code": code, "tech": tech}) }
func (u *liveUI) Connecting(tech string)  { u.l.ev(map[string]any{"ev": "connecting"}) }
func (u *liveUI) ChooseShare(_ context.Context, m []signal.Monitor, def int, _ bool) (ShareChoice, bool) {
	return ShareChoice{Monitor: m[0].ID}, true
}
func (u *liveUI) Active(tech string, m signal.Monitor) { u.l.ev(map[string]any{"ev": "active", "tech": tech}) }
func (u *liveUI) Status(msg string)                    { u.l.ev(map[string]any{"ev": "status", "msg": msg}) }
func (u *liveUI) SessionChat(v ChatView) {
	u.l.ev(map[string]any{"ev": "chat", "rev": v.Rev, "enabled": v.Enabled, "status": v.Status, "text": v.Text,
		"clear": v.Clear, "restore": v.Restore, "notify": v.NotifyNew})
}
func (u *liveUI) Annot(m dc.Ctl)                  { u.l.ev(map[string]any{"ev": "annot", "t": m.T}) }
func (u *liveUI) FileOffer(transfer.Prompt)       {}
func (u *liveUI) FileOfferWithdrawn(string)       {}
func (u *liveUI) FileProgress(int64, int64)       {}
func (u *liveUI) FileResult(transfer.Result)      {}
func (u *liveUI) Ended(m Message)                 { u.l.ev(map[string]any{"ev": "ended", "title": m.Title, "body": m.Body}) }
func (u *liveUI) ControlRequest(ControlPrompt)    {}
func (u *liveUI) MonitorRequest(signal.Monitor)   {}
func (u *liveUI) ControlPromptClosed()            {}
func (u *liveUI) MonitorPromptClosed()            {}
func (u *liveUI) ControlState(bool, string)       {}
func (u *liveUI) MonitorChanged(signal.Monitor)   {}

type blockSrc struct{}

func (blockSrc) NextFrame(ctx context.Context) (rtc.Frame, error) { <-ctx.Done(); return rtc.Frame{}, ctx.Err() }
func (blockSrc) Close() error                                     { return nil }

// liveConn gerçek *signal.Conn; "drop" ile yerelden kapatılır (ağ kopması taklidi), flow yeniden bağlanır.
type liveConn struct{ *signal.Conn }

func TestP22GLive(t *testing.T) {
	up, _ := url.Parse(os.Getenv("P22G_UPSTREAM"))
	code := os.Getenv("P22G_CODE")
	mode := os.Getenv("P22G_MODE")
	f, err := os.OpenFile(os.Getenv("P22G_OUT"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	l := &liveLog{f: f}
	var joins, resolves, wsDials atomic.Int64

	rp := httputil.NewSingleHostReverseProxy(up)
	rp.ModifyResponse = func(r *http.Response) error {
		p := r.Request.URL.Path
		if strings.HasSuffix(p, "/resolve") {
			resolves.Add(1)
			if mode == "noretention" && r.StatusCode == 200 {
				b, _ := io.ReadAll(r.Body)
				var m map[string]any
				_ = json.Unmarshal(b, &m)
				l.ev(map[string]any{"ev": "proxy-resolve", "serverDays": m["chatRetentionDays"], "stripped": true})
				delete(m, "chatRetentionDays")
				b, _ = json.Marshal(m)
				r.Body = io.NopCloser(bytes.NewReader(b))
				r.ContentLength = int64(len(b))
				r.Header.Set("Content-Length", strconv.Itoa(len(b)))
			}
		}
		if strings.HasSuffix(p, "/join") {
			joins.Add(1)
		}
		return nil
	}
	ts := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/ws/") {
			wsDials.Add(1)
			l.ev(map[string]any{"ev": "proxy-ws", "path": r.URL.Path, "protocols": len(strings.Split(r.Header.Get("Sec-Websocket-Protocol"), ","))})
		}
		rp.ServeHTTP(w, r)
	}))
	ts.StartTLS()
	defer ts.Close()
	srvURL, _ := url.Parse(ts.URL)

	client := api.New(srvURL, "0.21.0")
	pool := x509.NewCertPool()
	pool.AddCert(ts.Certificate())
	client.HTTPClient().Transport.(*http.Transport).TLSClientConfig.RootCAs = pool

	ui := &liveUI{l: l}
	events := make(chan Event, 16)
	media, merr := rtc.NewMedia(rtc.H264)
	if merr != nil {
		t.Fatal(merr)
	}
	var cur atomic.Pointer[liveConn]
	var hold sync.Mutex // "drop" sonrası "up" gelene kadar yeniden bağlanma bekletilir
	d := Deps{
		Host: srvURL.Host, Version: "0.21.0", Fingerprint: "p22g-probe",
		API: client,
		NewPeer: func(ice []signal.IceServer, caps []string, h rtc.Handlers) (Peer, error) {
			l.ev(map[string]any{"ev": "peer", "caps": caps})
			return rtc.New(ice, caps, h, media)
		},
		Monitors: func() ([]signal.Monitor, error) {
			return []signal.Monitor{{ID: 0, Name: "Probe", Primary: true, W: 1280, H: 720}}, nil
		},
		Capture:         func(int) (rtc.Source, error) { return blockSrc{}, nil },
		DownloadDir:     func() (string, error) { return t.TempDir(), nil },
		MOTW:            func(string) error { return nil },
		UI:              ui,
		Events:          events,
		ChatUI:          ui,
		ReconnectWindow: 120 * time.Second,
	}
	features := Features(d)
	l.ev(map[string]any{"ev": "features", "features": features})
	d.Dial = func(ctx context.Context, cred signal.Credential) (Conn, error) {
		hold.Lock()
		hold.Unlock()
		c, err := signal.Dial(ctx, client.HTTPClient(), srvURL, cred, features)
		if err != nil {
			l.ev(map[string]any{"ev": "dial-err", "err": err.Error(), "reconnect": cred.Reconnect != ""})
			return nil, err
		}
		lc := &liveConn{c}
		cur.Store(lc)
		l.ev(map[string]any{"ev": "dial", "reconnect": cred.Reconnect != ""})
		return lc, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()
	go func() { // komut dosyası
		off := 0
		held := false
		for ctx.Err() == nil {
			time.Sleep(200 * time.Millisecond)
			b, _ := os.ReadFile(os.Getenv("P22G_CMD"))
			if len(b) <= off {
				continue
			}
			lines := strings.Split(strings.TrimRight(string(b[off:]), "\n"), "\n")
			off = len(b)
			for _, ln := range lines {
				cmd, arg, _ := strings.Cut(ln, " ")
				l.ev(map[string]any{"ev": "cmd", "cmd": cmd})
				switch cmd {
				case "send":
					events <- Event{Kind: EvChat, Text: arg}
				case "drop":
					if !held {
						hold.Lock()
						held = true
					}
					if c := cur.Load(); c != nil {
						_ = c.Close()
					}
				case "up":
					if held {
						hold.Unlock()
						held = false
					}
				case "end":
					events <- Event{Kind: EvEnd}
				}
			}
		}
	}()
	out := Run(ctx, d, code)
	l.ev(map[string]any{"ev": "outcome", "title": out.Message.Title, "failed": out.Failed,
		"resolves": resolves.Load(), "joins": joins.Load(), "wsDials": wsDials.Load()})
}
