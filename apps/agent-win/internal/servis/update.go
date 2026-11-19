package servis

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"

	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/update"
)

// P29 servis güncellemesinin kalıcı durumu (mimari-p29 §5.3, §14.3): `%ProgramData%\NoktaDestek Servis\Guncelleme\`
// (DataDirSDDL: yalnız SY/BA). `durum.json` ≤ 8 KiB katı şema; bilinmeyen alan ya da geçersiz değer varsa faz alanları
// yok sayılır (T-6). Dosyaya iki süreç yazar (servis: maxSeen/kuyruk/healthy; gözetmen: swapping/swapped/done/rolled_back);
// her yazma süreçler arası kilit altında oku-değiştir-yaz'dır (StateStore.Update) ve atomik değiştirmeyle diske iner.

// Güncelleme klasörü ve dosya adları.
const (
	UpdateDirName   = "Guncelleme"
	stateFileName   = "durum.json"
	stateTmpName    = "durum.json.yeni"
	nonceFileName   = "apply.nonce"
	stagedFileName  = "yeni.bin"
	exeNewSuffix    = ".yeni"  // Program Files\NoktaDestekServis.exe.yeni (yürütülemez uzantı, gizli değil — T-8)
	exeOldSuffix    = ".eski"  // gözetmen/kurtarma imajı
	exeBrokenSuffix = ".bozuk" // geri dönüşte yeni ikili
	stateMaxBytes   = 8 * 1024
	recoveryCmdMax  = 1024
	recoveryStepMax = 8
)

// Fazlar (§5.3). "" = boşta.
const (
	phaseStaged     = "staged"
	phaseSwapping   = "swapping"
	phaseSwapped    = "swapped"
	phaseHealthy    = "healthy"
	phaseDone       = "done"
	phaseRolledBack = "rolled_back"
)

// blockFor geri dönülen sürüm bu süre denenmez (§5.3 12b).
const blockFor = 24 * time.Hour

// UpdateState `durum.json`. Kuyruk/tekilleştirme alanları update.QueueState ile aynı adlardadır (queue, sent).
type UpdateState struct {
	MaxSeen  string          `json:"maxSeen,omitempty"`
	Phase    string          `json:"phase,omitempty"`
	Target   string          `json:"target,omitempty"`
	Prev     string          `json:"prev,omitempty"`
	SHA256   string          `json:"sha256,omitempty"`
	Nonce    string          `json:"nonce,omitempty"`
	Blocked  *BlockedVersion `json:"blocked,omitempty"`
	Queue    []update.Event  `json:"queue,omitempty"`
	Sent     []string        `json:"sent,omitempty"`
	Recovery *RecoveryBackup `json:"recovery,omitempty"`
}

// BlockedVersion geri dönülen sürüm ve tekrar denenebileceği an (UTC, RFC 3339).
type BlockedVersion struct {
	Version string `json:"version"`
	Until   string `json:"until"`
}

// RecoveryBackup servisin SCM FailureActions yedeği (§14.3 m.3); gözetmen yer değiştirmeden önce yazar, done/rolled_back
// sonrası (gözetmen ya da R2-1 servis açılışı) geri yüklenir.
type RecoveryBackup struct {
	ResetSec uint32         `json:"resetSec"`
	Command  string         `json:"command"`
	NonCrash bool           `json:"nonCrash"`
	Actions  []RecoveryStep `json:"actions"`
}

// RecoveryStep tek kurtarma eylemi (mgr.RecoveryAction: tür + gecikme).
type RecoveryStep struct {
	Type    int    `json:"type"`
	DelayMs uint32 `json:"delayMs"`
}

var (
	nonceRe = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
	phases  = map[string]bool{"": true, phaseStaged: true, phaseSwapping: true, phaseSwapped: true, phaseHealthy: true,
		phaseDone: true, phaseRolledBack: true}
)

// ParseUpdateState `durum.json` baytları. Boyut sınırı aşılırsa ya da JSON okunamazsa sıfır durum. Katı çözümleme
// başarısızsa (bilinmeyen alan) ya da faz alanları geçersizse faz yok sayılır; maxSeen, blok, kuyruk ve yedek ayrı ayrı
// doğrulanır (geçersiz olan düşer).
func ParseUpdateState(raw []byte) UpdateState {
	if len(raw) == 0 || len(raw) > stateMaxBytes {
		return UpdateState{}
	}
	var s UpdateState
	strict := signal.DecodeStrict(raw, &s) == nil
	if !strict {
		s = UpdateState{}
		if json.Unmarshal(raw, &s) != nil {
			return UpdateState{}
		}
	}
	if !strict || !validPhaseFields(s) {
		s.Phase, s.Target, s.Prev, s.SHA256, s.Nonce = "", "", "", "", ""
	}
	if s.MaxSeen != "" && !versionRe.MatchString(s.MaxSeen) {
		s.MaxSeen = ""
	}
	if b := s.Blocked; b != nil {
		if _, err := time.Parse(time.RFC3339, b.Until); err != nil || !versionRe.MatchString(b.Version) {
			s.Blocked = nil
		}
	}
	q := s.Queue[:0:0]
	for _, e := range s.Queue {
		if validUpdateEvent(e) && len(q) < update.QueueMax {
			q = append(q, e)
		}
	}
	s.Queue = q
	if len(s.Sent) > update.QueueMax {
		s.Sent = s.Sent[len(s.Sent)-update.QueueMax:]
	}
	if r := s.Recovery; r != nil && (len(r.Command) > recoveryCmdMax || len(r.Actions) > recoveryStepMax) {
		s.Recovery = nil
	}
	return s
}

func validPhaseFields(s UpdateState) bool {
	if !phases[s.Phase] {
		return false
	}
	switch s.Phase {
	case "":
		return s.Target == "" && s.Nonce == ""
	case phaseDone, phaseRolledBack:
		return (s.Target == "" || versionRe.MatchString(s.Target)) && (s.Prev == "" || versionRe.MatchString(s.Prev))
	}
	return versionRe.MatchString(s.Target) && versionRe.MatchString(s.Prev) && sha256Re.MatchString(s.SHA256) &&
		nonceRe.MatchString(s.Nonce)
}

// encode boyut sınırına sığdırır: sığmazsa önce en eski olaylar, sonra tekilleştirme anahtarları kırpılır.
func (s UpdateState) encode() ([]byte, error) {
	for {
		b, err := json.Marshal(s)
		if err != nil {
			return nil, err
		}
		if len(b) <= stateMaxBytes {
			return b, nil
		}
		switch {
		case len(s.Queue) > 0:
			s.Queue = s.Queue[1:]
		case len(s.Sent) > 0:
			s.Sent = s.Sent[1:]
		default:
			return nil, errors.New("servis: durum.json sınırı aşıldı")
		}
	}
}

// clearPhase faz alanlarını sıfırlar.
func (s *UpdateState) clearPhase(phase string) {
	s.Phase, s.Nonce, s.SHA256 = phase, "", ""
	if phase == "" {
		s.Target, s.Prev = "", ""
	}
}

// queue kuyruk görünümü; değişiklik sonrası save ile geri yazılır.
func (s *UpdateState) queue() *update.Queue {
	return update.NewQueue(update.QueueState{Events: s.Queue, Sent: s.Sent})
}

func (s *UpdateState) saveQueue(q *update.Queue) {
	st := q.State()
	s.Queue, s.Sent = st.Events, st.Sent
}

// addEvents olayları tekilleştirerek ekler; eklenenleri döner.
func (s *UpdateState) addEvents(evs ...update.Event) []update.Event {
	q := s.queue()
	var added []update.Event
	for _, e := range evs {
		if validUpdateEvent(e) && q.Add(e) {
			added = append(added, e)
		}
	}
	s.saveQueue(q)
	return added
}

// block hedef sürümü 24 sa engeller.
func (s *UpdateState) block(version string, now time.Time) {
	s.Blocked = &BlockedVersion{Version: version, Until: now.UTC().Add(blockFor).Format(time.RFC3339)}
}

// blockOnFail S-P29-K-3: kurulum/bütünlük/platform imzası hatasından sonra hedef sürüm 24 sa yeniden indirilmez
// (rolled_back ile aynı kural). DOWNLOAD (ağ) geçicidir, engellenmez.
func (s *UpdateState) blockOnFail(version string, reason update.Reason, now time.Time) {
	switch reason {
	case update.ReasonInstall, update.ReasonHashMismatch, update.ReasonPlatformSignature:
		if versionRe.MatchString(version) {
			s.block(version, now)
		}
	}
}

// blocked sürüm engelli mi.
func (s UpdateState) blocked(version string, now time.Time) bool {
	if s.Blocked == nil || s.Blocked.Version != version {
		return false
	}
	until, err := time.Parse(time.RFC3339, s.Blocked.Until)
	return err == nil && now.Before(until)
}

// StateStore `durum.json` deposu. Lock süreçler arası kilit (Windows: adlandırılmış mutex; nil = yalnız süreç içi).
// Replace atomik değiştirme (Windows: MoveFileEx REPLACE_EXISTING|WRITE_THROUGH; nil = os.Rename).
type StateStore struct {
	Dir     string
	Lock    func() (unlock func(), err error)
	Replace func(from, to string) error
	// Open okuma tutamacı (Windows: FILE_SHARE_DELETE — açık okuyucu atomik değiştirmeyi engellemesin; nil = os.Open).
	Open func(path string) (*os.File, error)
	mu   sync.Mutex
}

// replaceTries atomik değiştirme denemesi (başka sürecin kısa süreli okuması / AV taraması).
const replaceTries = 5

// Load anlık durumu okur (süreçler arası kilitsiz: yazma atomik değiştirmedir).
func (st *StateStore) Load() UpdateState {
	open := st.Open
	if open == nil {
		open = os.Open
	}
	f, err := open(filepath.Join(st.Dir, stateFileName))
	if err != nil {
		return UpdateState{}
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, stateMaxBytes+1))
	if err != nil {
		return UpdateState{}
	}
	return ParseUpdateState(raw)
}

// Update kilit altında oku-değiştir-yaz; fn false dönerse yazılmaz. Yazılan durumu döner.
func (st *StateStore) Update(fn func(s *UpdateState) bool) (UpdateState, error) {
	st.mu.Lock()
	defer st.mu.Unlock()
	if st.Lock != nil {
		unlock, err := st.Lock()
		if err != nil {
			return UpdateState{}, err
		}
		defer unlock()
	}
	s := st.Load()
	if !fn(&s) {
		return s, nil
	}
	return s, st.write(s)
}

func (st *StateStore) write(s UpdateState) error {
	b, err := s.encode()
	if err != nil {
		return err
	}
	tmp := filepath.Join(st.Dir, stateTmpName)
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	_, werr := f.Write(b)
	if err := errors.Join(werr, f.Sync(), f.Close()); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	replace := st.Replace
	if replace == nil {
		replace = os.Rename
	}
	for i := 1; ; i++ {
		err = replace(tmp, filepath.Join(st.Dir, stateFileName))
		if err == nil || i >= replaceTries {
			return err
		}
		time.Sleep(time.Duration(i) * 50 * time.Millisecond)
	}
}

// newNonce 32 bayt rastgele (base64url, 43 karakter).
func newNonce() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}

// Olay günlüğü (AC-489; §5.3): 1010 kuruldu, 1011 geri dönüldü, 1012 reddedildi / klasör yeniden oluşturuldu.
const (
	EvUpdateInstalled  uint32 = 1010
	EvUpdateRolledBack uint32 = 1011
	EvUpdateRejected   uint32 = 1012
)

func evUpdateInstalled(from, to string) Event {
	return Event{ID: EvUpdateInstalled, Text: fmt.Sprintf("Gözetimsiz erişim servisi güncellendi: %s → %s.",
		clean(from, 12), clean(to, 12))}
}

func evUpdateRolledBack(target string, reason update.Reason) Event {
	return Event{ID: EvUpdateRolledBack, Warning: true, Text: fmt.Sprintf(
		"Gözetimsiz erişim servisi güncellemesi geri alındı (%s). Hedef sürüm: %s; 24 saat yeniden denenmeyecek.",
		clean(string(reason), 24), clean(target, 12))}
}

func evUpdateRejected(version string, reason update.Reason) Event {
	return Event{ID: EvUpdateRejected, Warning: true, Text: fmt.Sprintf(
		"Gözetimsiz erişim servisi güncellemesi reddedildi. Neden: %s; sürüm: %s", clean(string(reason), 24), clean(version, 12))}
}

func evUpdateFolder() Event {
	return Event{ID: EvUpdateRejected, Warning: true,
		Text: "Güncelleme klasörü güvenli değildi (bağlantı noktası, sahip ya da izin); silinip yeniden oluşturuldu."}
}
