package update

import (
	"context"
	"encoding/base64"
	"testing"
	"time"
)

func TestAC485MergePolicyClosedWins(t *testing.T) {
	f, tr := false, true
	cases := []struct {
		in   []Policy
		want Policy
	}{
		{nil, PolicyAuto},
		{[]Policy{PolicyAuto, PolicyAuto}, PolicyAuto},
		{[]Policy{PolicyAuto, PolicyNotify, PolicyAuto}, PolicyNotify},
		{[]Policy{PolicyFromBinding(&tr), PolicyFromBinding(&f)}, PolicyNotify},
		{[]Policy{PolicyFromBinding(nil)}, PolicyAuto},
		{[]Policy{ParsePolicy(""), ParsePolicy("auto")}, PolicyAuto},
		{[]Policy{ParsePolicy("gelecekteki-deger")}, PolicyNotify},
	}
	for i, c := range cases {
		if got := MergePolicy(c.in...); got != c.want {
			t.Errorf("%d: %s, beklenen %s", i, got, c.want)
		}
	}
}

func TestAC485DecideFlow(t *testing.T) {
	run := Version{0, 22, 0}
	acc := Result{Outcome: OutcomeAccept, Manifest: Manifest{Version: "0.22.1"}}
	d := Decide(acc, PolicyAuto, run, testNow)
	if d.Action != ActionInstall || len(d.Events) != 1 || d.Events[0].Type != EventAvailable || d.Events[0].FromVersion != "0.22.0" {
		t.Fatalf("auto: %+v", d)
	}
	d = Decide(acc, PolicyNotify, run, testNow)
	if d.Action != ActionNotify || len(d.Events) != 2 || d.Events[1].Type != EventSkipped || d.Events[1].Reason != ReasonPolicyOff {
		t.Fatalf("notify: %+v", d)
	}
	d = Decide(Result{Outcome: OutcomeManualOnly, Reason: ReasonManualOnly, Manifest: Manifest{Version: "0.22.1"}}, PolicyAuto, run, testNow)
	if d.Action != ActionNotify || d.Events[1].Reason != ReasonManualOnly {
		t.Fatalf("manual: %+v", d)
	}
	d = Decide(Result{Outcome: OutcomeRejected, Reason: ReasonManifestSignature}, PolicyAuto, run, testNow)
	if d.Action != ActionNone || len(d.Events) != 1 || d.Events[0].Type != EventFailed || d.Events[0].Version != "0.22.0" {
		t.Fatalf("ret (sürüm bilinmiyor): %+v", d)
	}
	for _, o := range []Outcome{OutcomeDisabled, OutcomeNone} {
		if d := Decide(Result{Outcome: o}, PolicyAuto, run, testNow); d.Action != ActionNone || len(d.Events) != 0 {
			t.Fatalf("%v: %+v", o, d)
		}
	}
}

func TestAC474VerifyEncoded(t *testing.T) {
	raw, sig := signed("prod-active", baseManifest())
	run := windowsClient(t, "0.22.0")
	if r := VerifyEncoded(prodTrust(), base64.StdEncoding.EncodeToString(raw), EncodeSignature(sig), run, Version{}, testNow); r.Outcome != OutcomeAccept {
		t.Fatalf("%+v", r)
	}
	for name, in := range map[string][2]string{
		"manifest base64 bozuk": {"%%%", EncodeSignature(sig)},
		"imza bozuk":            {base64.StdEncoding.EncodeToString(raw), "kisa"},
		"ikisi boş":             {"", ""},
	} {
		if r := VerifyEncoded(prodTrust(), in[0], in[1], run, Version{}, testNow); r.Reason != ReasonManifestSignature {
			t.Errorf("%s: %+v", name, r)
		}
	}
	if r := VerifyEncoded(Trust{}, "", "", run, Version{}, testNow); r.Outcome != OutcomeDisabled {
		t.Fatalf("anahtarsız: %+v", r)
	}
}

// AC-487: ≤ 20 olay, available/failed/skipped sürüm başına 1; installed tekrarlanabilir; Ack yalnız gönderileni çıkarır.
func TestAC487QueueBoundAndDedup(t *testing.T) {
	q := NewQueue(QueueState{})
	if !q.Add(NewEvent(EventAvailable, "0.22.1", "0.22.0", "", testNow)) || q.Add(NewEvent(EventAvailable, "0.22.1", "0.22.0", "", testNow.Add(time.Hour))) {
		t.Fatal("available tekilleştirilmedi")
	}
	if !q.Add(NewEvent(EventFailed, "0.22.1", "0.22.0", ReasonDownload, testNow)) || q.Add(NewEvent(EventFailed, "0.22.1", "0.22.0", ReasonHashMismatch, testNow)) {
		t.Fatal("failed sürüm başına 1 değil")
	}
	if !q.Add(NewEvent(EventAvailable, "0.22.2", "0.22.0", "", testNow)) {
		t.Fatal("yeni sürüm available eklenmeli")
	}
	for i := 0; i < 2; i++ {
		if !q.Add(NewEvent(EventInstalled, "0.22.2", "0.22.0", "", testNow)) {
			t.Fatal("installed tekilleştirilmemeli")
		}
	}
	for i := 0; i < 30; i++ {
		q.Add(NewEvent(EventRolledBack, "0.22.2", "0.22.0", ReasonHealth, testNow.Add(time.Duration(i)*time.Second)))
	}
	p := q.Pending()
	if len(p) != QueueMax || p[len(p)-1].At != testNow.Add(29*time.Second).Format(eventTimeLayout) {
		t.Fatalf("sınır/en eski düşer: %d", len(p))
	}
	q.Add(NewEvent(EventSkipped, "0.22.3", "0.22.0", ReasonPolicyOff, testNow))
	q.Ack(p[:5])
	// Taşmada en eski (p[0]) düştü; Ack kalan 4'ünü çıkarır → 20 − 4 = 16.
	if got := len(q.Pending()); got != QueueMax-4 {
		t.Fatalf("kalan %d", got)
	}
	// Durum gidiş-dönüşü tekilleştirmeyi korur (servis durum.json).
	q2 := NewQueue(q.State())
	if q2.Add(NewEvent(EventSkipped, "0.22.3", "0.22.0", ReasonPolicyOff, testNow)) {
		t.Fatal("durumdan yüklenen kuyruk tekilleştirmeyi unuttu")
	}
	if len(q2.Pending()) != len(q.Pending()) {
		t.Fatal("durum gidiş-dönüşü")
	}
}

func TestAC487QueueAckExact(t *testing.T) {
	q := NewQueue(QueueState{})
	a := NewEvent(EventInstalled, "0.22.1", "0.22.0", "", testNow)
	b := NewEvent(EventInstalled, "0.22.2", "0.22.1", "", testNow)
	q.Add(a)
	sent := q.Pending()
	q.Add(b) // gönderim sırasında eklendi
	q.Ack(sent)
	if p := q.Pending(); len(p) != 1 || p[0] != b {
		t.Fatalf("%+v", p)
	}
}

// AC-478: açılışta hemen, sonra 22..26 sa aralığında; sahte saatle.
func TestAC478ScheduleJitter(t *testing.T) {
	if NextInterval(0) != 22*time.Hour || NextInterval(0.5) != 24*time.Hour || NextInterval(0.999999) >= 26*time.Hour ||
		NextInterval(-1) != 24*time.Hour || NextInterval(1) != 24*time.Hour {
		t.Fatal("aralık")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ticks := make(chan time.Time)
	var waits []time.Duration
	timer := func(d time.Duration) <-chan time.Time { waits = append(waits, d); return ticks }
	rs := []float64{0, 0.25, 0.75}
	i := 0
	checks := make(chan struct{}, 10)
	done := make(chan struct{})
	go func() {
		RunChecks(ctx, timer, func() float64 { r := rs[i%len(rs)]; i++; return r }, func(context.Context) { checks <- struct{}{} })
		close(done)
	}()
	<-checks // açılış: zamanlayıcı beklenmeden
	ticks <- time.Time{}
	<-checks
	ticks <- time.Time{}
	<-checks
	cancel()
	<-done
	if len(waits) != 3 || waits[0] != 22*time.Hour || waits[1] != 23*time.Hour || waits[2] != 25*time.Hour {
		t.Fatalf("beklemeler %v", waits)
	}
}

func TestAC482Messages(t *testing.T) {
	if MessageReady("0.22.1") != "Yeni sürüm (0.22.1) hazır — programı sonraki açışınızda kullanılacak" {
		t.Fatal(MessageReady("0.22.1"))
	}
	if MessageAvailable != "Yeni sürüm var — indirme bağlantısından yeni sürümü alın" {
		t.Fatal("AC-483 metni")
	}
}
