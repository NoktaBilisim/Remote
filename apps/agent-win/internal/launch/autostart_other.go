//go:build !windows

package launch

// defaultAutostart Windows dışında otomatik başlatma yok (birim testleri sahte verir).
func defaultAutostart() Autostart { return nil }
