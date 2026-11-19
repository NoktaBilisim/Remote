package servis

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"strings"
	"time"

	"remote-support/agent-win/internal/update"
)

// Gözetmen (`--update-apply`) ve önyükleme kurtarma kancası (`--update-recover`) — mimari-p29 §5.3 sağ sütun, §14.3.
// İkisi de eski (kurulu) ikilidir, argümansız ve yolsuz; yalnız LocalSystem jetonuyla ve Global\NoktaDestekServisUpdate
// mutex'i alınabildiğinde çalışır (T-4). Gözetmen yalnız phase=staged ve durum.json nonce'u = apply.nonce iken ilerler.

// ErrStagedHash yeni.bin'in ya da kopyalanan akışın SHA-256'sı durum.json'daki değerle uyuşmuyor.
var ErrStagedHash = errors.New("servis: sahnelenmiş dosyanın SHA-256'sı uyuşmuyor")

// ApplySys gözetmen/kurtarma platform işleri (Windows: update_apply_windows.go; testte sahte).
type ApplySys interface {
	// IsLocalSystem süreç jetonu LocalSystem mi (S-1-5-18).
	IsLocalSystem() bool
	// AcquireSupervisor Global\NoktaDestekServisUpdate'i varlık anlamıyla alır (DACL yalnız SY); var ya da hata → false.
	AcquireSupervisor() (release func(), ok bool)
	// PrepareDir `Guncelleme\` VerifyDir (T-6).
	PrepareDir() (recreated bool, err error)
	// ReadNonce `Guncelleme\apply.nonce`.
	ReadNonce() (string, error)
	// CopyStagedToNew yeni.bin'i FILE_SHARE_READ ile açar, aynı tutamaçtan SHA'yı hesaplar ve Program Files\…exe.yeni'ye
	// (önceki artık silinir, CREATE_NEW) kopyalar; kopyalanan akışın SHA'sı da karşılaştırılır (§5.1 TOCTOU).
	CopyStagedToNew(sha256 string) error
	// QueryFailureActions servisin mevcut SCM kurtarma ayarları.
	QueryFailureActions() (RecoveryBackup, error)
	// SetRecoverActions tüm kurtarma yuvalarını RUN_COMMAND `"<kurulu yol>.eski" --update-recover` yapar (T-3).
	SetRecoverActions() error
	// RestoreFailureActions yedekten geri yükler (nil: komut bizimse kurulum varsayılanı).
	RestoreFailureActions(b *RecoveryBackup) error
	StopService() error
	StartService() error
	// ServiceStopped SCM durumu SERVICE_STOPPED mı.
	ServiceStopped() (bool, error)
	// Swap exe.eski ← exe (sabit bağlantı) + exe.yeni → exe tek adım (FileRenameInfoEx); olmazsa iki MoveFileEx
	// (WRITE_THROUGH; ikincisi başarısızsa ilki geri alınır). Hata dönerse exe eski ikilidir.
	Swap() error
	// RollbackFiles dosyaya bakar: exe.eski varsa exe → exe.bozuk, exe.eski → exe. exe.eski yoksa nil (dokunulmaz).
	RollbackFiles() error
	// RemoveStaged yeni.bin + apply.nonce; RemoveNew exe.yeni.
	RemoveStaged()
	RemoveNew()
}

// Gözetmen çıkış kodları (yalnız tanı; SCM bunları görmez).
const (
	ApplyOK = iota
	ApplyDenied
	ApplyBusy
	ApplyNothing
	ApplyFailed
	ApplyRolledBack
)

// Supervisor gözetmen/kurtarma çalıştırıcısı.
type Supervisor struct {
	Sys    ApplySys
	Store  *StateStore
	Events EventSink
	// Health sağlık penceresi (60 sn, §5.3 adım 11); Poll yoklama aralığı (1 sn).
	Health time.Duration
	Poll   time.Duration
	now    func() time.Time
	sleep  func(d time.Duration)
}

func (s *Supervisor) clock() time.Time {
	if s.now != nil {
		return s.now()
	}
	return time.Now()
}

func (s *Supervisor) pause(d time.Duration) {
	if s.sleep != nil {
		s.sleep(d)
		return
	}
	time.Sleep(d)
}

func (s *Supervisor) timing() (health, poll time.Duration) {
	health, poll = s.Health, s.Poll
	if health == 0 {
		health = 60 * time.Second
	}
	if poll == 0 {
		poll = time.Second
	}
	return health, poll
}

// Apply `--update-apply` (§5.3 adım 7–12).
func (s *Supervisor) Apply() int {
	if !s.Sys.IsLocalSystem() {
		return ApplyDenied
	}
	release, ok := s.Sys.AcquireSupervisor()
	if !ok {
		return ApplyBusy
	}
	defer release()
	st := s.Store.Load()
	nonce, err := s.Sys.ReadNonce()
	if st.Phase != phaseStaged || st.Nonce == "" || err != nil || nonce != st.Nonce {
		return ApplyNothing
	}
	target, prev := st.Target, st.Prev
	if recreated, err := s.Sys.PrepareDir(); err != nil || recreated {
		if recreated {
			s.Events.Write(evUpdateFolder())
		}
		return s.abort(target, prev, update.ReasonInstall, nil)
	}
	if err := s.Sys.CopyStagedToNew(st.SHA256); err != nil {
		reason := update.ReasonInstall
		if errors.Is(err, ErrStagedHash) {
			reason = update.ReasonHashMismatch
		}
		return s.abort(target, prev, reason, nil)
	}
	backup, err := s.Sys.QueryFailureActions()
	if err != nil {
		return s.abort(target, prev, update.ReasonInstall, nil)
	}
	if strings.Contains(backup.Command, "--update-recover") { // önceki denemenin geri yüklenmemiş ayarı: gerçek yedek ezilmez
		if st.Recovery != nil {
			backup = *st.Recovery
		} else {
			backup = installRecoveryBackup()
		}
	}
	if _, err := s.Store.Update(func(u *UpdateState) bool { u.Recovery = &backup; return true }); err != nil {
		return s.abort(target, prev, update.ReasonInstall, nil)
	}
	if err := s.Sys.SetRecoverActions(); err != nil {
		return s.abort(target, prev, update.ReasonInstall, &backup)
	}
	if err := s.Sys.StopService(); err != nil {
		_ = s.Sys.StartService()
		return s.abort(target, prev, update.ReasonInstall, &backup)
	}
	if err := s.setPhase(phaseSwapping); err != nil { // yer değiştirmeden önce, fsync'li (§14.3 m.4)
		_ = s.Sys.StartService()
		return s.abort(target, prev, update.ReasonInstall, &backup)
	}
	if err := s.Sys.Swap(); err != nil {
		_ = s.Sys.StartService()
		return s.abort(target, prev, update.ReasonInstall, &backup)
	}
	if err := s.setPhase(phaseSwapped); err != nil || s.Sys.StartService() != nil {
		return s.rollback(target, prev, &backup)
	}
	if !s.awaitHealthy(st.Nonce) {
		return s.rollback(target, prev, &backup)
	}
	// 12a: önce FailureActions, sonra done (gözetmen arada ölürse yeni servis aynı geri yüklemeyi yapar — R2-1).
	if err := s.Sys.RestoreFailureActions(&backup); err == nil {
		_, _ = s.Store.Update(func(u *UpdateState) bool {
			if u.Phase == phaseHealthy {
				u.clearPhase(phaseDone)
			}
			u.Recovery = nil
			return true
		})
	}
	s.Sys.RemoveStaged()
	return ApplyOK // exe.eski kendi imajıdır: servis açılışı/24 sa denemesi siler
}

func (s *Supervisor) setPhase(phase string) error {
	_, err := s.Store.Update(func(u *UpdateState) bool { u.Phase = phase; return true })
	return err
}

// awaitHealthy 60 sn boyunca: yeni servis healthy(nonce) yazdı mı; SCM STOPPED → başarısız.
func (s *Supervisor) awaitHealthy(nonce string) bool {
	health, poll := s.timing()
	deadline := s.clock().Add(health)
	for s.clock().Before(deadline) {
		s.pause(poll)
		if st := s.Store.Load(); st.Phase == phaseHealthy && st.Nonce == nonce {
			return true
		}
		if stopped, err := s.Sys.ServiceStopped(); err == nil && stopped {
			return false
		}
	}
	return false
}

// abort yer değiştirme olmadan biten deneme: exe.yeni ve yeni.bin silinir, faz boşa döner, failed(reason) kuyruğa.
func (s *Supervisor) abort(target, prev string, reason update.Reason, backup *RecoveryBackup) int {
	if backup != nil {
		_ = s.Sys.RestoreFailureActions(backup)
	}
	s.Sys.RemoveNew()
	s.Sys.RemoveStaged()
	now := s.clock()
	_, _ = s.Store.Update(func(u *UpdateState) bool {
		u.clearPhase("")
		if backup != nil {
			u.Recovery = nil
		}
		u.addEvents(update.NewEvent(update.EventFailed, target, prev, reason, now))
		return true
	})
	if reason.Security() {
		s.Events.Write(evUpdateRejected(target, reason))
	}
	return ApplyFailed
}

// rollback 12b: servisi durdur → exe → exe.bozuk, exe.eski → exe → başlat → rolled_back(HEALTH) + 24 sa blok.
func (s *Supervisor) rollback(target, prev string, backup *RecoveryBackup) int {
	_ = s.Sys.StopService()
	_ = s.Sys.RollbackFiles()
	_ = s.Sys.StartService()
	return s.markRolledBack(target, prev, backup)
}

func (s *Supervisor) markRolledBack(target, prev string, backup *RecoveryBackup) int {
	restored := s.Sys.RestoreFailureActions(backup) == nil
	s.Sys.RemoveNew()
	s.Sys.RemoveStaged()
	now := s.clock()
	_, _ = s.Store.Update(func(u *UpdateState) bool {
		u.clearPhase(phaseRolledBack)
		u.Target, u.Prev = target, prev
		u.block(target, now)
		if restored {
			u.Recovery = nil
		}
		u.addEvents(update.NewEvent(update.EventRolledBack, target, prev, update.ReasonHealth, now))
		return true
	})
	s.Events.Write(evUpdateRolledBack(target, update.ReasonHealth))
	return ApplyRolledBack
}

// Recover `--update-recover` (SCM FailureActions RUN_COMMAND, §14.3 m.3). Mutex tutuluysa gözetmen canlıdır ve geri dönüşü
// o yapar → sessiz çıkış. swapping/swapped iken geri döner; diğer fazlarda yalnız kurtarma eylemlerini geri yükleyip servisi
// başlatır (SCM bu eylemde servisi kendisi yeniden başlatmaz).
func (s *Supervisor) Recover() int {
	if !s.Sys.IsLocalSystem() {
		return ApplyDenied
	}
	release, ok := s.Sys.AcquireSupervisor()
	if !ok {
		return ApplyBusy
	}
	defer release()
	st := s.Store.Load()
	switch st.Phase {
	case phaseSwapping, phaseSwapped:
		_ = s.Sys.RollbackFiles()
		_ = s.Sys.StartService()
		return s.markRolledBack(st.Target, st.Prev, st.Recovery)
	}
	if err := s.Sys.RestoreFailureActions(st.Recovery); err == nil && st.Recovery != nil {
		_, _ = s.Store.Update(func(u *UpdateState) bool { u.Recovery = nil; return true })
	}
	_ = s.Sys.StartService()
	return ApplyNothing
}

// hashReader r'yi (w nil değilse w'ye de yazarak) okur ve SHA-256'yı küçük hex döner.
func hashReader(r io.Reader, w io.Writer) (string, error) {
	h := sha256.New()
	dst := io.Writer(h)
	if w != nil {
		dst = io.MultiWriter(w, h)
	}
	if _, err := io.Copy(dst, r); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// installRecoveryBackup kurulum varsayılanı (3×10 sn yeniden başlat, 24 sa; SC_ACTION_RESTART = 1).
func installRecoveryBackup() RecoveryBackup {
	step := RecoveryStep{Type: 1, DelayMs: 10000}
	return RecoveryBackup{ResetSec: 86400, Actions: []RecoveryStep{step, step, step}}
}
