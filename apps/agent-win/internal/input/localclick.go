package input

import (
	"crypto/rand"
	"encoding/binary"
	"time"
)

// P28f K3 — `localClick()` (mimari-p28f §5.2a, S-P28f-1; ADR-0037 m.3): korunan denetimlerin (kontrol/monitör izni, dosya
// teklifi, yazdırma, pano anahtarı, roster "Çıkar", kayıt rızası, "Erişime izin ver") tek kabul kuralı. BEYAZ LİSTE,
// fail-closed: aşağıdakilerin HEPSİ sağlanmazsa eylem reddedilir.
//
//  1. Eylem anındaki olay (NSApp.currentEvent) var ve sol fare BIRAKMA; aynı düğmenin BASIŞI da kaydedilmiş ve o da
//     aşağıdaki koşulları sağlıyor. Klavye etkinleştirmesi, performClick:, AXPress/VoiceOver/Sesle Denetim (olay yok ya
//     da fare olayı değil) → ret.
//  2. kCGEventSourceStateID == kCGEventSourceStateHIDSystemState (1) — ikinci katman, tek başına yeterli değil.
//  3. kCGEventSourceUnixProcessID == 0 (asıl ayırıcı: sentetik olay gönderenin PID'ini taşır).
//  4. kCGEventSourceUserData alanında bu sürecin enjekte ettiği olaylara konan işaret YOK.
//  5. Bayat değil: bırakma eylem anından en çok ClickMaxAge önce; basış bırakmadan önce ve en çok ClickMaxHold önce.
//
// Platformdan bağımsız karar burada (birim testli); alanları AppKit/CGEvent'ten okuyan ince yardımcılar
// click_darwin.go'dadır (EventClick, CurrentClick, Uptime). Bağlama ya da okuma hatası → Present false → ret.

// NSEventType değerleri (NSEvent.h).
const (
	NSLeftMouseDown uint32 = 1
	NSLeftMouseUp   uint32 = 2
)

// hidSystemState kCGEventSourceStateHIDSystemState (kCGEventSourceStateID alanının donanım değeri).
const hidSystemState = 1

const (
	// ClickMaxAge bırakma ile eylem arasındaki en uzun süre (NSButton eylemi bırakmada eşzamanlı çalışır).
	ClickMaxAge = time.Second
	// ClickMaxHold basış ile bırakma arasındaki en uzun süre.
	ClickMaxHold = 10 * time.Second
)

// ClickEvent localClick için okunan olay alanları. Sıfır değer = olay yok (ret).
type ClickEvent struct {
	Present  bool
	Type     uint32        // NSEventType
	StateID  int64         // kCGEventSourceStateID
	PID      int64         // kCGEventSourceUnixProcessID
	UserData int64         // kCGEventSourceUserData
	At       time.Duration // NSEvent.timestamp (sistem açılışından beri)
}

// marker süreç başına rastgele, sıfırdan farklı işaret; enjekte edilen her CGEvent'in kCGEventSourceUserData alanına
// yazılır. Üretilemezse 0 kalır: enjektör çalışmaz (Inject hata) ve ControlReady false (kontrol yok).
var marker = func() int64 {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return 0
	}
	m := int64(binary.LittleEndian.Uint64(b[:]) &^ (1 << 63))
	if m == 0 {
		m = 1
	}
	return m
}()

// localField tek olayın yerel donanım olayı olma koşulları (m.2–m.4).
func localField(e ClickEvent, mark int64) bool {
	return e.Present && e.StateID == hidSystemState && e.PID == 0 && mark != 0 && e.UserData != mark
}

// LocalClick korunan denetimin eylemi kabul edilir mi. press: aynı düğmenin kaydedilmiş basışı; release: eylem anındaki
// NSApp.currentEvent; now: eylem anı (Uptime). Herhangi bir koşul sağlanmazsa false.
func LocalClick(press, release ClickEvent, now time.Duration) bool {
	return localClick(press, release, now, marker)
}

func localClick(press, release ClickEvent, now time.Duration, mark int64) bool {
	if press.Type != NSLeftMouseDown || release.Type != NSLeftMouseUp {
		return false
	}
	if !localField(press, mark) || !localField(release, mark) {
		return false
	}
	if release.At < press.At || release.At-press.At > ClickMaxHold {
		return false
	}
	return now >= release.At && now-release.At <= ClickMaxAge
}

// LocalInput olay musluğu ve AC-104 için: yerel (donanım) girdi mi — PID 0 ve bizim işaretimiz yok. Durum kaynağı
// alanı burada aranmaz (bazı donanım olayları farklı durum kaynağıyla gelebilir; yanlış pozitif yalnız uzaktan girdiyi
// 1 sn askıya alır, güvenli yön).
func LocalInput(pid, userData int64) bool {
	return pid == 0 && (marker == 0 || userData != marker)
}
