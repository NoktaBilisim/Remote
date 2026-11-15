//go:build windows

package helper

import (
	"runtime"

	"remote-support/agent-win/internal/desktop"
	"remote-support/agent-win/internal/input"
)

// K6b: SendInput yalnız çağıran iş parçacığının masaüstü giriş masaüstüyse uygulanır (Winlogon/UAC'de ret). Enjeksiyon
// kilitli tek bir iş parçacığında yapılır; masaüstü kapısının dönemi değişince iş parçacığı yeni giriş masaüstüne geçer.
// Kapı kapalıyken olaylar düşürülür (desktop.Input'a ek ikinci savunma; O-P27-4).

type injectJob struct {
	evs  []input.Event
	resp chan error
}

type deskInjector struct {
	gate  *desktop.Gate
	inner input.Injector
	jobs  chan injectJob
}

func newDeskInjector(g *desktop.Gate, inner input.Injector) *deskInjector {
	d := &deskInjector{gate: g, inner: inner, jobs: make(chan injectJob)}
	go d.loop()
	return d
}

// Inject input.Injector.
func (d *deskInjector) Inject(evs []input.Event) error {
	resp := make(chan error, 1)
	d.jobs <- injectJob{evs: evs, resp: resp}
	return <-resp
}

// loop süreç ömrünce yaşayan enjeksiyon iş parçacığı (yardımcı tek oturumluk süreçtir).
func (d *deskInjector) loop() {
	runtime.LockOSThread()
	var epoch uint64
	release := func() {}
	for j := range d.jobs {
		cur, open := d.gate.State()
		if !open {
			j.resp <- nil // düşürüldü
			continue
		}
		if cur != epoch {
			release()
			release = func() {}
			if _, rel, err := desktop.Attach(); err == nil {
				release = rel
			}
			epoch = cur // bağlanamadıysa SendInput reddedilir; sonraki dönemde yeniden denenir
		}
		j.resp <- d.inner.Inject(j.evs)
	}
}

// attachCapture capture.Opener.Attach: yakalama iş parçacığını giriş masaüstüne bağlar.
func attachCapture() (func(), error) {
	_, release, err := desktop.Attach()
	return release, err
}
