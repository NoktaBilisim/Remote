package flow

import (
	"context"
	"testing"
	"time"

	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/transfer"
)

// P28d düzeltme turu 1: D-PD-K1-2 (kabulden sonra `active` 5 sn gelmezse mikrofon bırakılır) ve QA m.2 (multi kipinde
// doneTimeout olayı tid süzgecine takılmaz).

func shortActiveWait(d *Deps) { d.VoiceActiveWait = 150 * time.Millisecond }

// D-PD-K1-2: sunucu kabulü bayat bulup düşürürse `active` hiç gelmez; mikrofon tek bırakma yolundan kapanır, mesaj
// gitmez. Sonradan gelen active rızasız sayılır: mikrofon yeniden açılmaz, callId başına tek voice.end{customer}.
func TestAC374P28dReleaseMicWhenActiveNeverArrives(t *testing.T) {
	v := startVoiceDeps(t, nil, shortActiveWait)
	c := v.accepted(t, call1)
	eventually(t, "active beklemesi bırakır", func() bool { return closes(c) == 1 })
	if b, _ := v.ui.lastBar(); b.On || b.Note != VoiceTexts.Unconfirmed {
		t.Fatalf("bırakma sonrası gösterge: %+v", b)
	}
	if n, muted, _, _, _ := c.get(); n != 1 || !muted {
		t.Fatalf("önce sustur sonra kapat: closes=%d muted=%v", n, muted)
	}
	if got := v.voiceSent(200 * time.Millisecond); len(got) != 0 {
		t.Fatalf("zaman aşımında mesaj gitmemeli: %+v", got)
	}
	v.c.toClient <- vstate("active", call1, []string{tidA}, []string{tidA})
	v.c.toClient <- vstate("active", call1, []string{tidA}, []string{tidA, tidB})
	got := v.voiceSent(300 * time.Millisecond)
	if len(got) != 1 {
		t.Fatalf("geç active → tek voice.end beklenirdi: %+v", got)
	}
	if e, ok := got[0].(signal.VoiceEnd); !ok || e.Reason != signal.VoiceEndCustomer || e.CallID != call1 {
		t.Fatalf("voice.end{customer}: %+v", got[0])
	}
	if n, _ := v.op.count(); n != 1 {
		t.Fatalf("geç active mikrofon açtı: %d", n)
	}
}

// `active` süre içinde gelirse zamanlayıcı etkisizdir: mikrofon açık kalır.
func TestAC374P28dActiveInTimeKeepsMic(t *testing.T) {
	v := startVoiceDeps(t, nil, shortActiveWait)
	c := v.accepted(t, call1)
	v.c.toClient <- vstate("active", call1, []string{tidA}, []string{tidA})
	eventually(t, "roller", func() bool { _, _, _, tk, _ := c.get(); return len(tk) == 1 })
	time.Sleep(400 * time.Millisecond)
	if n := closes(c); n != 0 {
		t.Fatalf("active geldiği hâlde mikrofon bırakıldı (closes=%d)", n)
	}
	if b, _ := v.ui.lastBar(); !b.On {
		t.Fatalf("gösterge kapandı: %+v", b)
	}
}

// Aygıt açılışı sürerken bekleme dolarsa rıza silinir; açılış sonradan biterse bayat sayılıp hemen kapatılır.
func TestAC374P28dActiveWaitDuringOpenClosesStaleOpen(t *testing.T) {
	op := &fakeOpener{block: make(chan struct{})}
	v := startVoiceDeps(t, op, shortActiveWait)
	v.ask(t, call1)
	v.c.toClient <- vstate("pending", call1, nil, []string{tidA})
	eventually(t, "pending diyaloğu", func() bool { return len(v.asksNow()) >= 2 })
	v.h.events <- Event{Kind: EvVoiceAccept, CallID: call1}
	if a, ok := v.nextVoice(t).(signal.VoiceAnswer); !ok || !a.Accept {
		t.Fatalf("voice.answer{true}: %+v", a)
	}
	recv(t, op.started)
	eventually(t, "gösterge kapanır", func() bool { b, _ := v.ui.lastBar(); return !b.On && b.Note == VoiceTexts.Unconfirmed })
	close(op.block)
	eventually(t, "bayat açılış kapanır", func() bool {
		_, calls := op.count()
		return len(calls) == 1 && closes(calls[0]) == 1
	})
}

// QA P28d m.2: c3a60b4 onPeer düzeltmesinin doneTimeout dalı. Kontrol sahibi tid'i doluyken (multi1) dosya bekleme
// zaman aşımı `e.tid != s.ctrlTid()` dalında yutulmamalı: DoneTimeout çağrılır, sonuç arayüze gider.
func TestP28dDoneTimeoutEventsInMultiMode(t *testing.T) {
	ui := &fakeUI{calls: make(chan string, 8)}
	s := &session{d: withDefaults(Deps{UI: ui}), peers: map[string]*techPeer{}}
	s.setCtrl(tidA)
	s.files = transfer.New(transfer.Deps{
		Dir: t.TempDir(), MaxBytes: 1 << 20,
		SendCtl: func([]byte) error { return nil },
		Meta:    func(signal.FileMeta) {},
		After:   func(time.Duration, string) func() bool { return func() bool { return true } },
	})
	idx, size := 7, int64(10)
	if p := s.files.Offer(dc.Ctl{T: "file.offer", FID: "f1", Idx: &idx, Name: "a.txt", Size: &size,
		SHA: "0000000000000000000000000000000000000000000000000000000000000000"}); p == nil {
		t.Fatal("teklif reddedildi")
	}
	if _, err := s.files.Decide("f1", true); err != nil {
		t.Fatal(err)
	}
	if r := s.files.Chunk(dc.Chunk{FIDIndex: 7, Seq: 0, Payload: []byte("abc")}, true); r != nil {
		t.Fatalf("parça: %+v", r)
	}
	if r := s.files.Done("f1"); r != nil {
		t.Fatalf("eksik baytta done beklemeli: %+v", r)
	}
	s.onPeer(context.Background(), peerEvent{doneTimeout: "f1"})
	select {
	case got := <-ui.calls:
		if got != "fileresult:CORRUPT" {
			t.Fatalf("beklenen fileresult:CORRUPT, gelen %q", got)
		}
	default:
		t.Fatal("multi kipinde doneTimeout olayı yutuldu (FileResult yok)")
	}
}
