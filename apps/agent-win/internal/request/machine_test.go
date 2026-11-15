package request

import (
	"encoding/json"
	"errors"
	"net/url"
	"testing"
	"time"

	"remote-support/agent-win/internal/api"
)

var acc = Accepted{T: "request.accepted", WsTicket: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", TechnicianName: "Mehmet",
	TechVerifyCode: "4821", TicketExpiresAt: "2026-11-12T10:02:05.000Z"}

func TestAC139StateOnlyWhileWaiting(t *testing.T) {
	var m Machine
	if st := m.OnServer(State{Position: 2}); st.State == nil || st.State.Position != 2 {
		t.Fatal("bekleme durumunda state gösterilmeli")
	}
	m.OnServer(acc)
	if st := m.OnServer(State{Position: 1}); st.State != nil {
		t.Fatal("kabulden sonra state yok sayılmalı")
	}
}

func TestAC154AcceptedThenShare(t *testing.T) {
	var m Machine
	if st := m.OnServer(acc); st.Accept == nil || m.Phase() != PhAccepted || st.Share != nil {
		t.Fatal("kabul onay ekranı açmalı, kendiliğinden bağlanmamalı")
	}
	reissued := acc
	reissued.WsTicket = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
	m.OnServer(reissued) // yeniden bağlanan soket yeni ticket alır
	st := m.OnUser(UserShare)
	if st.Share == nil || st.Share.WsTicket != reissued.WsTicket || m.Phase() != PhSharing {
		t.Fatalf("%+v", st)
	}
	if st := m.OnServer(Closed{Status: "CONNECT_FAILED"}); st.End != nil {
		t.Fatal("paylaşımdan sonra makine bitmiş olmalı")
	}
}

func TestAC154ShareIgnoredBeforeAccept(t *testing.T) {
	var m Machine
	if st := m.OnUser(UserShare); st.Share != nil {
		t.Fatal("kabulsüz paylaşım olmamalı")
	}
}

func TestAC154CancellingIgnoresLateAccept(t *testing.T) {
	var m Machine
	if st := m.OnUser(UserCancel); st.Send != SendCancel || m.Phase() != PhCancelling {
		t.Fatalf("%+v", st)
	}
	st := m.OnServer(acc)
	if st.Accept != nil || st.Share != nil || st.Send != SendDecline {
		t.Fatalf("iptal sonrası kabul yok sayılıp decline gönderilmeli: %+v", st)
	}
	st = m.OnServer(Closed{Status: "CANCELLED"})
	if st.End == nil || st.End.Reason != EndUserCancel {
		t.Fatalf("%+v", st)
	}
}

func TestAC154DeclineAndWindowCloseWhenAccepted(t *testing.T) {
	var m Machine
	m.OnServer(acc)
	if st := m.OnUser(UserDecline); st.Send != SendDecline || m.Phase() != PhCancelling {
		t.Fatalf("%+v", st)
	}
	if st := m.OnServer(Closed{Status: "CANCELLED"}); st.End.Reason != EndDeclined {
		t.Fatal("vazgeçme sonucu beklenirdi")
	}
	var m2 Machine
	m2.OnServer(acc)
	st := m2.OnUser(UserClose)
	if st.Send != SendDecline || !st.CloseNow || st.End.Reason != EndWindowClosed {
		t.Fatalf("%+v", st)
	}
}

func TestAC141WindowCloseSendsCancelThenClose(t *testing.T) {
	var m Machine
	st := m.OnUser(UserClose)
	if st.Send != SendCancel || !st.CloseNow || st.End == nil || st.End.Reason != EndWindowClosed {
		t.Fatalf("%+v", st)
	}
}

func TestAC141CancelTimeoutEndsWithIntent(t *testing.T) {
	var m Machine
	m.OnUser(UserCancel)
	st := m.OnCancelTimeout()
	if !st.CloseNow || st.End.Reason != EndUserCancel {
		t.Fatalf("%+v", st)
	}
}

func TestAC155TicketExpiry(t *testing.T) {
	var m Machine
	if st := m.OnTicketExpired(); st.End != nil {
		t.Fatal("kabul yokken süre dolumu anlamsız")
	}
	m.OnServer(acc)
	if st := m.OnTicketExpired(); st.End == nil || st.End.Reason != EndTicketExpired {
		t.Fatal("onay süresi dolunca bitmeli")
	}
}

func TestAC142AC157ClosedViews(t *testing.T) {
	msg := "Şu an müsait değiliz"
	if v := closedView(Closed{Status: "EXPIRED"}); !v.Recreate || v.Title != "Talebiniz zaman aşımına uğradı" {
		t.Errorf("%+v", v)
	}
	if v := closedView(Closed{Status: "REJECTED", Message: &msg}); v.FirmMessage != msg || v.Recreate {
		t.Errorf("%+v", v)
	}
	passive := "TENANT_PASSIVE"
	if v := closedView(Closed{Status: "CANCELLED", Reason: &passive}); v.Recreate {
		t.Errorf("%+v", v)
	}
}

// TestAC154WsRequestMatchesContractsFixture ortak fixture `ws-request.json`.
func TestAC154WsRequestMatchesContractsFixture(t *testing.T) {
	var fx struct {
		Valid struct {
			RequestInbound  []json.RawMessage `json:"requestInbound"`
			RequestOutbound []json.RawMessage `json:"requestOutbound"`
		} `json:"valid"`
		Invalid struct {
			RequestOutbound []json.RawMessage `json:"requestOutbound"`
		} `json:"invalid"`
	}
	loadFixture(t, "ws-request.json", &fx)
	if len(fx.Valid.RequestOutbound) == 0 || len(fx.Invalid.RequestOutbound) == 0 {
		t.Fatal("fixture boş")
	}
	expectServerParse(t, fx.Valid.RequestOutbound, fx.Invalid.RequestOutbound)
	for i, raw := range fx.Valid.RequestInbound {
		out := []Outbound{SendCancel, SendDecline}[i]
		b, err := Encode(out)
		var a, w map[string]any
		_ = json.Unmarshal(b, &a)
		_ = json.Unmarshal(raw, &w)
		if err != nil || len(a) != 1 || a["t"] != w["t"] {
			t.Errorf("%s != %s (%v)", b, raw, err)
		}
	}
	if _, err := Encode("request.accept"); err == nil {
		t.Error("sözleşme dışı giden mesaj reddedilmeli")
	}
}

func TestS8b8CreateRetryPolicy(t *testing.T) {
	noJitter := func(time.Duration) time.Duration { return 0 }
	busy := &api.Error{Status: 503, Code: "NOT_READY", RetryAfter: 5 * time.Second}
	if d, ok := createRetryDelay(busy, 1, noJitter); !ok || d != 5*time.Second {
		t.Fatalf("ilk 503 bir kez denenmeli: %v %v", d, ok)
	}
	if _, ok := createRetryDelay(busy, 2, noJitter); ok {
		t.Fatal("en çok 2 deneme")
	}
	long := &api.Error{Status: 503, Code: "NOT_READY", RetryAfter: time.Hour}
	if d, _ := createRetryDelay(long, 1, func(m time.Duration) time.Duration { return m }); d != 16*time.Second {
		t.Fatalf("15 sn kırpma + jitter: %v", d)
	}
	for _, e := range []error{&api.Error{Status: 0}, &api.Error{Status: 502}, &api.Error{Status: 503, Code: "UNKNOWN"},
		&api.Error{Status: 429, Code: "RATE_LIMITED"}, errors.New("x")} {
		if _, ok := createRetryDelay(e, 1, noJitter); ok {
			t.Errorf("%v denenmemeli", e)
		}
	}
}

func TestAC133OutdatedAndDownloadURL(t *testing.T) {
	v := func(s string) *string { return &s }
	cases := []struct {
		ver string
		min *string
		out bool
	}{{"0.9.0", nil, false}, {"0.9.0", v(""), false}, {"0.9.0", v("0.9.0"), false}, {"0.9.0", v("0.9.1"), true},
		{"0.9.0", v("0.10.0"), true}, {"1.0.0", v("0.99.9"), false}, {"0.9.0", v("bozuk"), false}}
	for _, c := range cases {
		if Outdated(c.ver, c.min) != c.out {
			t.Errorf("%s vs %v", c.ver, c.min)
		}
	}
	srv, _ := url.Parse("https://remote.example:4450")
	if u, ok := DownloadURL(srv, "abcdefghijk23456"); !ok || u != "https://remote.example:4450/api/v1/public/agent/request-download?ref=abcdefghijk23456" {
		t.Fatal(u)
	}
	if _, ok := DownloadURL(srv, "ABC&x=1"); ok {
		t.Fatal("geçersiz ref ile URL üretilmemeli")
	}
}
