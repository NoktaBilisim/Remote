// Package helpermode P33 Opus çözücü yardımcısının kip bayrağıdır (mimari-p33 §6.6, S-P33-T2-3). Bağımlılığı yalnız
// os'tur: paket init'leri main'den önce koştuğundan AppKit/ScreenCaptureKit yükleyen init'ler (ui/mac, capture) bu
// bayrağa bakıp yardımcı kipinde hiçbir şey kurmaz; sandbox öncesi yalnız Go çalışma zamanı ve AudioToolbox çalışır.
package helpermode

import "os"

// Flag yardımcı kipinin tek argümanı.
const Flag = "--opus-cozucu"

// Is argv tam olarak [exe, Flag] mi (başka argüman varsa normal akış).
func Is(args []string) bool { return len(args) == 2 && args[1] == Flag }

// Active bu süreç yardımcı kipinde mi (os.Args paket init'lerinden önce hazırdır).
var Active = Is(os.Args)
