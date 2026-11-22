//go:build darwin

package flow

// P33 K1: macOS'ta mikrofon hatası metni Windows gizlilik yolunu değil Mac Mikrofon iznini tarif eder.
func init() { VoiceTexts.Device = MacVoiceTexts.Device }
