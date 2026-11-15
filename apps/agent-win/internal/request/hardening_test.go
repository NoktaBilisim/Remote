package request

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"remote-support/agent-win/internal/remember"
)

var personA = remember.Personal{Name: "Ayşe Yılmaz", Phone: "+905321234567", DeviceKey: "AAAAAAAAAAAAAAAAAAAAAA"}

// S8b2-1 saf karar tablosu.
func TestAC136RememberPlan(t *testing.T) {
	same := Valid{Name: personA.Name, Phone: personA.Phone}
	other := Valid{Name: "Ali Veli", Phone: personA.Phone}
	otherPhone := Valid{Name: personA.Name, Phone: "+905339876543"}
	cases := []struct {
		name             string
		f                Form
		v                Valid
		rem              remember.Personal
		remembered       bool
		wantKeep, wantNK bool
	}{
		{"işaretsiz", Form{}, same, personA, true, false, false},
		{"aynı kişi, işaretli açıldı", Form{Remember: true}, same, personA, true, true, false},
		{"ad değişti, kutuya dokunulmadı", Form{Remember: true}, other, personA, true, false, false},
		{"telefon değişti, kutuya dokunulmadı", Form{Remember: true}, otherPhone, personA, true, false, false},
		{"ad değişti, müşteri kendisi işaretledi", Form{Remember: true, RememberChosen: true}, other, personA, true, true, true},
		{"ilk kez işaretlendi", Form{Remember: true, RememberChosen: true}, same, remember.Personal{}, false, true, true},
	}
	for _, c := range cases {
		keep, nk := rememberPlan(c.f, c.v, c.rem, c.remembered)
		if keep != c.wantKeep || nk != c.wantNK {
			t.Errorf("%s: keep=%v newKey=%v", c.name, keep, nk)
		}
	}
}

// TestAC136ChangedIdentityNotSavedWithoutOptIn (S8b2-1): A hatırlanmış; B kendi adıyla gönderir, kutuya dokunmaz →
// kayıt yok, A'nın dosyası silinir, deviceKey gönderilmez. B kutuyu kendisi işaretlerse yeni deviceKey ile kaydedilir.
func TestAC136ChangedIdentityNotSavedWithoutOptIn(t *testing.T) {
	for _, chosen := range []bool{false, true} {
		a, u, conn, ev := &fakeAPI{}, newUI(), newConn(), make(chan UserAction, 4)
		d := personA
		rem := &memRemember{d: &d}
		f := goodForm
		f.Name, f.Remember, f.RememberChosen = "Ali Veli", true, chosen
		u.forms = submits(f)
		out := runAsync(deps(a, u, conn, ev, rem))
		connected(t, u, conn)
		ev <- UserClose
		wait(t, out)
		b := a.bodies[0]
		if !chosen {
			if b.DeviceKey != "" || rem.d != nil || rem.forgot != 1 {
				t.Fatalf("onaysız kişi değişikliği kaydedilmemeli: key=%q rem=%+v", b.DeviceKey, rem.d)
			}
			continue
		}
		if len(b.DeviceKey) != 22 || b.DeviceKey == personA.DeviceKey || rem.d == nil || rem.d.Name != "Ali Veli" ||
			rem.d.DeviceKey != b.DeviceKey {
			t.Fatalf("açık onayla yeni deviceKey ile kaydedilmeli: key=%q rem=%+v", b.DeviceKey, rem.d)
		}
	}
}

// TestAC137ForgetFailureVisible (QA-P8b2-2): işaretsiz gönderimde silme başarısızsa talep yine gider, bekleme ekranında
// kalıcı uyarı görünür (yeniden bağlanma Notice'i silmez).
func TestAC137ForgetFailureVisible(t *testing.T) {
	a, u, conn, ev := &fakeAPI{}, newUI(), newConn(), make(chan UserAction, 4)
	d := personA
	rem := &memRemember{d: &d, forgetErr: errors.New("erişim engellendi")}
	u.forms = submits(goodForm)
	out := runAsync(deps(a, u, conn, ev, rem))
	first := wait(t, u.waiting)
	connected(t, u, conn)
	ev <- UserClose
	wait(t, out)
	if len(a.bodies) != 1 || first.Warning != noticeForgetFail {
		t.Fatalf("talep gitmeli + uyarı görünmeli: bodies=%d warning=%q", len(a.bodies), first.Warning)
	}
}

// TestAC137ForgetButtonFailureVisible "Bilgilerimi unut" başarısızsa "silindi" denmez, uyarı formda kalır.
func TestAC137ForgetButtonFailureVisible(t *testing.T) {
	a, u := &fakeAPI{}, newUI()
	d := personA
	rem := &memRemember{d: &d, forgetErr: errors.New("erişim engellendi")}
	u.forms = []func(FormView) (FormAction, Form){
		func(FormView) (FormAction, Form) { return FormForget, Form{} },
		submit(Form{Name: "x"}), // doğrulama hatası: uyarı yine görünür
	}
	Run(context.Background(), deps(a, u, newConn(), nil, rem))
	if n := u.views[1].Notice; n != noticeForgetFail {
		t.Fatalf("%q", n)
	}
	if n := u.views[2].Notice; !strings.HasPrefix(n, noticeForgetFail) || !strings.Contains(n, noticeCheck) {
		t.Fatalf("uyarı başarılı silmeye kadar kalmalı: %q", n)
	}
}

// S8b2-2: üstel geri çekilme + jitter + Retry-After, kopma bütçesi içinde.
func TestS8b22DialRetryDelay(t *testing.T) {
	j := func(time.Duration) time.Duration { return 300 * time.Millisecond }
	netErr := errors.New("eof")
	want := []time.Duration{2300, 4300, 8300, 15300, 15300}
	for i, w := range want {
		if got := dialRetryDelay(netErr, i+1, 2*time.Second, time.Minute, j); got != w*time.Millisecond {
			t.Errorf("deneme %d: %v", i+1, got)
		}
	}
	rl := &DialError{Status: 429, RetryAfter: 30 * time.Second}
	if got := dialRetryDelay(rl, 1, 2*time.Second, time.Minute, j); got != 30*time.Second {
		t.Errorf("Retry-After'a uyulmalı: %v", got)
	}
	if got := dialRetryDelay(&DialError{Status: 429, RetryAfter: time.Hour}, 1, 2*time.Second, 2*time.Minute, j); got != time.Minute {
		t.Errorf("Retry-After 60 sn'ye kırpılmalı: %v", got)
	}
	if got := dialRetryDelay(rl, 1, 2*time.Second, 5*time.Second, j); got != 5*time.Second {
		t.Errorf("bekleme kalan bütçeyi aşmamalı: %v", got)
	}
}

func TestS8b22DialBackoffInWaitLoop(t *testing.T) {
	a, u, conn, ev := &fakeAPI{}, newUI(), newConn(), make(chan UserAction, 4)
	u.forms = submits(goodForm)
	d := deps(a, u, conn, ev, nil)
	var mu sync.Mutex
	var waits []time.Duration
	d.After = func(x time.Duration) <-chan time.Time {
		mu.Lock()
		waits = append(waits, x)
		mu.Unlock()
		c := make(chan time.Time, 1)
		c <- time.Now()
		return c
	}
	errs := []error{&DialError{Status: 429, RetryAfter: 20 * time.Second}, errors.New("ağ"), errors.New("ağ")}
	d.Dial = func(context.Context, string) (Conn, error) {
		mu.Lock()
		defer mu.Unlock()
		if len(errs) > 0 {
			e := errs[0]
			errs = errs[1:]
			return nil, e
		}
		return conn, nil
	}
	out := runAsync(d)
	connected(t, u, conn)
	ev <- UserClose
	wait(t, out)
	mu.Lock()
	defer mu.Unlock()
	if len(waits) != 3 || waits[0] != 20*time.Second || waits[1] != 4*time.Second || waits[2] != 8*time.Second {
		t.Fatalf("429 Retry-After, sonra üstel: %v", waits)
	}
}

// S8b2-3: sunucu metinleri tek süzgeçten geçer.
func TestS8b23Display(t *testing.T) {
	cases := map[string]string{
		"Mehmet":                  "Mehmet",
		"Meh\u202emet":            "Mehmet",
		"\u2067Firma\u2069 A.Ş.":  "Firma A.Ş.",
		"a\u200bb\u00adc\u034fd":  "abcd",
		"satır1\r\nsatır2\tson":   "satır1  satır2 son",
		"x y\u0007z":              "x yz",
		"  \u202e\u200f  ":        "yedek",
		"Ayşe & Ortakları <Ltd.>": "Ayşe & Ortakları <Ltd.>",
	}
	for in, want := range cases {
		if got := Display(in, "yedek"); got != want {
			t.Errorf("%q → %q, beklenen %q", in, got, want)
		}
	}
}

func TestS8b23ServerTextsSanitized(t *testing.T) {
	m, err := ParseServer([]byte(`{"t":"request.accepted","wsTicket":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",` +
		`"technicianName":"Meh` + "\u202e" + `met","techVerifyCode":"4821","ticketExpiresAt":"2026-11-12T10:01:00.000Z"}`))
	if err != nil || m.(Accepted).TechnicianName != "Mehmet" {
		t.Fatalf("%+v %v", m, err)
	}
	m, err = ParseServer([]byte(`{"t":"request.accepted","wsTicket":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",` +
		`"technicianName":"` + "\u200f" + `","techVerifyCode":"4821","ticketExpiresAt":"2026-11-12T10:01:00.000Z"}`))
	if err != nil || m.(Accepted).TechnicianName != "Teknisyen" {
		t.Fatalf("%+v %v", m, err)
	}
	m, err = ParseServer([]byte(`{"t":"request.closed","status":"REJECTED","message":"Yarın` + "\u2066" + ` arayın"}`))
	if err != nil || *m.(Closed).Message != "Yarın arayın" {
		t.Fatalf("%+v %v", m, err)
	}
	a, u := &fakeAPI{tenant: "\u202eDemo Firma"}, newUI()
	Run(context.Background(), deps(a, u, newConn(), nil, nil))
	if u.views[0].Tenant != "Demo Firma" {
		t.Fatalf("%q", u.views[0].Tenant)
	}
}

// QA önerisi / mimari-protokol §5.1: hello'dan önce bağlantı hatası → 1001 (CONNECT_FAILED), REST iptal yok;
// müşteri vazgeçti → 1000.
func TestAC154ReleaseKinds(t *testing.T) {
	for _, k := range []ReleaseKind{ReleaseFailed, ReleaseAbandoned} {
		a, u, conn, ev := &fakeAPI{}, newUI(), newConn(), make(chan UserAction, 4)
		u.forms = submits(goodForm)
		out := runAsync(deps(a, u, conn, ev, nil))
		connected(t, u, conn)
		conn.in <- acc
		wait(t, u.accepted)
		ev <- UserShare
		o := wait(t, out)
		o.Release(k)
		o.Release(ReleaseAbandoned) // bir kez çalışır
		if normal := wait(t, conn.closed); normal != (k == ReleaseAbandoned) || a.cancels != 0 {
			t.Fatalf("kind=%d normal=%v cancels=%d", k, normal, a.cancels)
		}
	}
}
