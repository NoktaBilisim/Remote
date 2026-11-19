//go:build linux

package flow

// K5: Linux'ta mikrofon hatası metni Windows gizlilik yolunu değil GNOME ses ayarını tarif eder (tek tablo:
// LinuxTexts.VoiceDevice).
func init() { VoiceTexts.Device = LinuxTexts.VoiceDevice }
