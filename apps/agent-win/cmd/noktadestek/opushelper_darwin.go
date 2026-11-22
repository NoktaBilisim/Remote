//go:build darwin

package main

import "remote-support/agent-win/internal/voice"

// runOpusHelper `--opus-cozucu` kipi (mimari-p33 §6.6): AudioConverter çözücüleri kurulur, sandbox_init (deny default)
// + öz-test, "hazır" baytı, boru döngüsü. Gövde internal/voice'tadır (test ikilisi aynı yolu kendini yeniden
// çalıştırarak sınar).
func runOpusHelper() int { return voice.RunDecoderHelper() }
