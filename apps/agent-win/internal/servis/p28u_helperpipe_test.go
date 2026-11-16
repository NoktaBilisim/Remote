package servis

import (
	"bufio"
	"context"
	"errors"
	"io"
	"testing"
	"time"

	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/servis/helperio"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/unattended/helper"
)

// P28u K6 (mimari-p28u §7.4, D-P28u-1): uçtan uca boru — servis girdiyi (yeni satırlı, boru KAPATILMADAN) ve `lock`
// komutunu yazar; yardımcı (helper.Run, gerçek okuyucu/yazar) onay kararını ve kilit sonucunu durum borusuna yazar;
// servisin gerçek satır okuyucusu + olay × durum tablosu hiçbirini ihlal saymaz. (Test K6'ya aittir; servis paketinde
// çünkü okuyucu dışa açık değildir.)

type e2eInd struct{ failed chan struct{} }

func (i e2eInd) Failed() <-chan struct{} { return i.failed }
func (e2eInd) Desktop() string           { return "Default" }
func (e2eInd) Close()                    {}

type e2eLocker struct{}

func (e2eLocker) Lock(context.Context) (bool, string) { return true, "" }

func TestAC431AC443HelperPipeEndToEnd(t *testing.T) {
	inR, inW := io.Pipe()
	stR, stW := io.Pipe()
	release := make(chan struct{})
	in := helperio.Input{V: helperio.Version, SessionID: "01JX0000000000000000000000",
		Ticket: "tabcdefghijklmnopqrstuvwxyz0123456789ABCDEF", TechName: "Ali", TenantName: "Acme",
		IndicatorText: "Uzaktan bağlantı: Ali — Acme", ExpiresInSec: 60,
		Consent: helperio.ConsentAsk, Mode: helperio.ModeAsked}
	done := make(chan uint32, 1)
	go func() {
		br := helperio.NewReader(inR)
		got, err := helperio.ReadInput(br) // boru açıkken takılmamalı
		if err != nil {
			done <- 99
			return
		}
		d := helper.Deps{
			ShowIndicator: func(string) (helper.Indicator, error) { return e2eInd{failed: make(chan struct{})}, nil },
			InputDesktop:  func() (string, error) { return "Default", nil },
			AskConsent: func(context.Context, helper.ConsentSpec) (string, time.Time) {
				return helperio.DecisionGranted, time.Now()
			},
			Status: stW, Commands: br, Locker: e2eLocker{},
			Flow: flow.Deps{Dial: func(ctx context.Context, _ signal.Credential) (flow.Conn, error) {
				<-release
				return nil, errors.New("test bitti")
			}},
		}
		done <- helper.Run(context.Background(), d, got)
		_ = stW.Close()
	}()
	b, err := helperio.Encode(in)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := inW.Write(b); err != nil { // servis boruyu kapatmaz
		t.Fatal(err)
	}
	st := &helperStatus{consent: in.Consent}
	br := bufio.NewReader(stR)
	next := func() helperio.Status {
		t.Helper()
		line, err := readStatusLine(br)
		if err != nil {
			t.Fatalf("durum satırı: %v", err)
		}
		s, err := decodeStatus(line)
		if err != nil {
			t.Fatalf("bozuk satır %q", line)
		}
		if _, err := st.apply(s); err != nil {
			t.Fatalf("tablo ihlali %+v: %v", s, err)
		}
		return s
	}
	if s := next(); s.Ev != "consent" || s.Decision != helperio.DecisionGranted {
		t.Fatalf("%+v", s)
	}
	const id = "01JX0000000000000000000009"
	st.pendingLock = id // servis komutu gönderirken bekleyeni kaydeder
	c, _ := helperio.EncodeCommand(helperio.Command{Cmd: helperio.CmdLock, ID: id})
	if _, err := inW.Write(c); err != nil {
		t.Fatal(err)
	}
	if s := next(); s.Ev != "lock" || s.ID != id || s.Ok == nil || !*s.Ok {
		t.Fatalf("%+v", s)
	}
	close(release)
	select {
	case code := <-done:
		if code != helperio.ExitHelperFailed { // katılım öncesi dial hatası (test sonu)
			t.Fatalf("çıkış %d", code)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("yardımcı bitmedi")
	}
	_ = inW.Close()
}
