//go:build windows

package launch

import "remote-support/agent-win/internal/autorun"

// defaultAutostart Windows'ta HKCU\…\Run (internal/autorun, K4).
func defaultAutostart() Autostart { return autorun.New() }
