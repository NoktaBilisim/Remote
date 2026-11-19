//go:build darwin || linux

package main

import (
	"strings"

	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/update"
)

// withUpdateNotice son ekran metnine bekleyen güncelleme bilgisini ekler (Linux/macOS; flow dosyalarına dokunmadan).
// Son ekran yoksa bilgi tüketilmez.
func withUpdateNotice(m flow.Message, upd *update.Portable) flow.Message {
	if m == (flow.Message{}) {
		return m
	}
	if n := upd.Notice(); n != "" {
		m.Body = strings.TrimSpace(m.Body + "\n\n" + n)
	}
	return m
}
