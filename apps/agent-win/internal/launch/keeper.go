package launch

import (
	"fmt"
	"sync"
	"time"

	"remote-support/agent-win/internal/remember"
	"remote-support/agent-win/internal/request"
	"remote-support/agent-win/internal/signal"
)

// Oturum sonu kayıt bilgileri (mimari-e11 §8d.1/§8d.2, G-P20-4/12/17).
const (
	NoteWriteFailed   = "Kayıt bu bilgisayara yazılamadı."
	NoteThirdOrigin   = "Bu bilgisayarda başka iki sunucunun kayıtları var; bu firma için kayıt alınmadı."
	noteFirmFallback  = "bu firma"
	eventStoreFailure = "store_write_failed"
)

// AddedText yeni yuva eklendi: "Bu bilgisayar artık <firma> için de kayıtlı (n/5)." (§8d.2).
func AddedText(label string, n int) string {
	return fmt.Sprintf("Bu bilgisayar artık %s için de kayıtlı (%d/%d).", label, n, remember.MaxPerOrigin)
}

// LimitText BINDING_LIMIT veya eski sunucuda 5 yuva dolu (§8d.2).
func LimitText(firm string) string {
	if firm == "" {
		firm = noteFirmFallback
	}
	return fmt.Sprintf("Bu bilgisayar %d firmaya kayıtlı; %s için kayıt alınmadı. Ana ekrandan bir firmayı unutabilirsiniz.",
		remember.MaxPerOrigin, firm)
}

// RenamedText G-P20-12: `status`/`issued` sonrası adı değişen öğede bir kez.
func RenamedText(old, cur string) string { return "Firma adı değişti: " + old + " → " + cur }

// keeper flow.BindingHandler: çoklu firma kaydının istenmesi ve DPAPI dosyasına yazılması (mimari-e11 §8d.2). Oturum
// kapsamlıdır (G-P20-5): her oturum için yeni keeper; slot bu oturumda yazılan yuva.
type keeper struct {
	mu     sync.Mutex
	store  Store
	server string // gömülü sunucunun kanonik kökeni (dosyaya bu yazılır, anahtarlar yalnız bu kökenden)
	now    func() time.Time
	diag   func(event, class string)
	tenant func() string // oturum firmasının adı (BINDING_LIMIT metni); boş olabilir
	sent   []string      // son istekteki previousKeys
	slot   string        // bu oturumda yazılan yuvanın anahtarı
}

func newKeeper(s Store, server string, now func() time.Time) *keeper {
	return &keeper{store: s, server: server, now: now}
}

func (k *keeper) firm() string {
	if k.tenant == nil {
		return ""
	}
	return k.tenant()
}

// Request §8d.2 istemci kuralı. Dosya her istekte yeniden okunur (başka süreç yazmış olabilir).
func (k *keeper) Request(multi bool) (signal.BindingRequest, string, bool) {
	st := k.store.LoadState()
	if st.Status == remember.StatusUnreadable { // salt-okunur açılış: kayıt yazılamaz (G-P20-3)
		return signal.BindingRequest{}, "", false
	}
	own := st.Data.ForOrigin(k.server)
	if foreignOrigins(st.Data, k.server) >= remember.MaxOrigins { // üçüncü köken (G-P20-17)
		return signal.BindingRequest{}, NoteThirdOrigin, false
	}
	req := signal.BindingRequest{T: "binding.request"}
	k.mu.Lock()
	defer k.mu.Unlock()
	k.sent = nil
	if !multi {
		// Eski sunucu: previousKey GÖNDERİLMEZ (başka firmanın kaydı REPLACED olmasın); 5 doluysa istek yok.
		if len(own) >= remember.MaxPerOrigin {
			return signal.BindingRequest{}, LimitText(k.firm()), false
		}
		return req, "", true
	}
	for _, b := range own {
		k.sent = append(k.sent, b.Key)
	}
	req.PreviousKeys = append([]string(nil), k.sent...)
	req.Full = len(own) >= remember.MaxPerOrigin // yalnız gömülü kökenin sayısı (G-P20-17)
	return req, "", true
}

// foreignOrigins gömülü köken dışındaki farklı köken sayısı.
func foreignOrigins(d remember.Data, server string) int {
	seen := map[string]bool{}
	for _, b := range d.Bindings {
		if b.Server != server {
			seen[b.Server] = true
		}
	}
	return len(seen)
}

// Issued yuvayı yazar: bu oturumda yazılmış yuva → o; değilse previousIndex yuvası; null → yeni yuva (5 doluysa
// yazılmaz). Yenilemede ilk kayıt tarihi korunur (G-P20-12: tarih firmanın bu bilgisayardaki kayıt tarihidir).
func (k *keeper) Issued(m signal.BindingIssued) string {
	customer := ""
	if m.CustomerFirmName != nil {
		customer = request.Display(*m.CustomerFirmName, "")
	}
	b := remember.Binding{Server: k.server, Key: m.BindingKey, TenantName: request.Display(m.TenantName, "Firma"),
		CustomerName: customer, IssuedAt: k.now().UTC().Truncate(time.Second)}
	k.mu.Lock()
	defer k.mu.Unlock()
	replace := k.slot
	if replace == "" && m.PreviousIndex != nil && *m.PreviousIndex < len(k.sent) {
		replace = k.sent[*m.PreviousIndex]
	}
	st := k.store.LoadState()
	if st.Status == remember.StatusUnreadable {
		if k.diag != nil {
			k.diag(eventStoreFailure, st.Class)
		}
		return NoteWriteFailed
	}
	own := st.Data.ForOrigin(k.server)
	var old *remember.Binding
	for i := range own {
		if own[i].Key == replace || own[i].Key == b.Key {
			old = &own[i]
			break
		}
	}
	if old == nil && len(own) >= remember.MaxPerOrigin { // sunucu zaten reddeder; istemci de yazmaz
		return LimitText(b.TenantName)
	}
	if old != nil {
		b.IssuedAt = old.IssuedAt
	}
	if err := k.store.SaveBinding(b, replace); err != nil {
		k.report(err)
		return NoteWriteFailed
	}
	k.slot = b.Key
	label := request.Label(b.TenantName, b.CustomerName)
	if old == nil {
		n := len(own) + 1
		if d, ok := k.store.Load(); ok {
			n = len(d.ForOrigin(k.server))
		}
		return AddedText(label, n)
	}
	if prev := request.Label(old.TenantName, old.CustomerName); prev != label {
		return RenamedText(prev, label)
	}
	return ""
}

// Limited BINDING_LIMIT (oturum sürer).
func (k *keeper) Limited() string { return LimitText(k.firm()) }

// report G-P20-4: yazma hatası diag olayı (içerik yok, yalnız sınıf).
func (k *keeper) report(err error) {
	if k.diag != nil {
		k.diag(eventStoreFailure, remember.ErrorClass(err))
	}
}
