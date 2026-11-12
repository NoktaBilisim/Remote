package launch

import (
	"sync"
	"time"

	"remote-support/agent-win/internal/remember"
	"remote-support/agent-win/internal/request"
	"remote-support/agent-win/internal/signal"
)

// ChangedText AC-187 oturum sonu bilgisi.
func ChangedText(label string) string { return "Bu bilgisayar artık " + label + " için kayıtlı." }

// keeper flow.BindingHandler: kaydın alınması ve DPAPI dosyasına yazılması (mimari-e10 §8.4).
type keeper struct {
	mu     sync.Mutex
	store  Store
	server string // gömülü sunucunun kanonik kökeni (dosyaya bu yazılır)
	prev   *remember.Binding
	now    func() time.Time
}

func newKeeper(s Store, server string, local *remember.Binding, now func() time.Time) *keeper {
	return &keeper{store: s, server: server, prev: local, now: now}
}

// PreviousKey yalnız kaydı veren sunucu bu sunucuysa (T43, G-E10-6: kanonik köken dize eşitliği).
func (k *keeper) PreviousKey() string {
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.prev == nil || k.prev.Server != k.server {
		return ""
	}
	return k.prev.Key
}

// Issued kaydı yazar (tek kayıt, üzerine yazar — AC-187). Yazma hatası sessiz. Önceki kayıt (herhangi bir köken)
// farklı firma/müşteriye aitse etiket döner.
func (k *keeper) Issued(m signal.BindingIssued) string {
	customer := ""
	if m.CustomerFirmName != nil {
		customer = request.Display(*m.CustomerFirmName, "")
	}
	b := remember.Binding{Server: k.server, Key: m.BindingKey, TenantName: request.Display(m.TenantName, "Firma"),
		CustomerName: customer, IssuedAt: k.now().UTC().Truncate(time.Second)}
	if k.store.SaveBinding(b) != nil {
		return ""
	}
	k.mu.Lock()
	defer k.mu.Unlock()
	prev := k.prev
	k.prev = &b
	if prev == nil || (prev.TenantName == b.TenantName && prev.CustomerName == b.CustomerName) {
		return ""
	}
	return request.Label(b.TenantName, b.CustomerName)
}

// forget "Bu bilgisayarı unut" sonrası: aynı süreçteki sonraki oturum önceki kaydı anahtar olarak göndermez.
func (k *keeper) forget() {
	k.mu.Lock()
	k.prev = nil
	k.mu.Unlock()
}
