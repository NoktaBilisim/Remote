package request

import (
	"testing"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/signal"
)

// AC-381 (mimari-p28e §8, talep formu): kutu yalnız teklif geçerliyken gösterilir; seçim yalnız teklif varken
// "Ekranımı paylaş" sonucuna (flow.Deps.RecConsent) taşınır, talep gövdesine yazılmaz.
func TestAC381RequestFormRecordingConsent(t *testing.T) {
	valid := &api.RecordingOffer{Offered: true, Line: signal.RecConsentLine, LineSha256: signal.RecConsentLineSHA256}
	other := &api.RecordingOffer{Offered: true, Line: "x", LineSha256: "0000000000000000000000000000000000000000000000000000000000000000"}
	cases := []struct {
		name          string
		offer         *api.RecordingOffer
		record, shown bool
		want          bool
	}{
		{"teklif yok", nil, true, false, false},
		{"SHA farklı", other, true, false, false},
		{"teklif var, işaretsiz", valid, false, true, false},
		{"teklif var, işaretli", valid, true, true, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			a, u, conn, ev := &fakeAPI{rec: c.offer}, newUI(), newConn(), make(chan UserAction, 4)
			f := goodForm
			f.Record = c.record
			shown := make(chan bool, 1)
			u.forms = []func(FormView) (FormAction, Form){func(v FormView) (FormAction, Form) {
				shown <- v.RecOffered
				return FormSubmit, f
			}}
			out := runAsync(deps(a, u, conn, ev, &memRemember{}))
			if got := wait(t, shown); got != c.shown {
				t.Fatalf("kutu gösterimi %v, beklenen %v", got, c.shown)
			}
			connectedAt(t, u, conn, 1)
			conn.in <- acc
			wait(t, u.accepted)
			ev <- UserShare
			o := wait(t, out)
			if o.Kind != OutShare || o.Record != c.want {
				t.Fatalf("Record %v, beklenen %v (%+v)", o.Record, c.want, o.Kind)
			}
			o.Release(ReleaseAdmitted)
		})
	}
}
