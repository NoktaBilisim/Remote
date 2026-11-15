//go:build windows

package main

import "remote-support/agent-win/internal/unattended/helper"

// P27 K6: `--helper` kipi (main.go kancası; ayrı dosya — K7 kancalarıyla çakışmaz). Atama DLL yüklemez; main'in ilk
// deyimi dllsafe.Harden olarak kalır (AC-341).
func init() { runHelper = helper.Main }
