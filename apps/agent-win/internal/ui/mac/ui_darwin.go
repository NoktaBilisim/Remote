//go:build darwin

// Package mac macOS istemcisinin AppKit arayüzüdür (mimari-p28f §2.1; flow.UI, ClipPrintUI, FileServerUI, RosterUI,
// VoiceUI, RecUI). Platformdan bağımsız mantık internal/ui/uicore'dadır. P28f K1 yalnız giriş noktasını tanımlar;
// ekranlar K4'te.
package mac

import (
	"errors"

	"remote-support/agent-win/internal/flow"
)

// ErrNotImplemented AppKit arayüzü bu sürümde yok (K4). İstemci açılmaz; akış hiç başlamaz (fail-closed: arayüzsüz
// ya da kendiliğinden onaylayan bir akış çalışmaz).
var ErrNotImplemented = errors.New("ui/mac: arayüz bu sürümde yok")

// New arayüzü kurar: akış arayüzü ve olay kanalı. Ana iş parçacığında, NSApplication kurulduktan sonra çağrılır.
func New(host, version, fingerprint string) (flow.UI, <-chan flow.Event, error) {
	return nil, nil, ErrNotImplemented
}
