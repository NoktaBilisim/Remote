// Package transfer teknisyenden müşteriye (TO_CUSTOMER) dosya alımıdır (AC-36, 53, 54, 55; mimari-protokol §4.1–4.2).
// Kurallar: müşteri "Kabul et" demeden diske yazılmaz; ad gösterimden önce temizlenir; dosya önce `<ad>.part` olarak
// yazılır, alınan bayt sayacı beyan edilen boyutu veya tenant sınırını aşarsa iptal edilir; SHA-256 doğrulanınca
// `.part`'a MOTW yazılır, sonra üzerine yazmadan yeniden adlandırılır (S6-3). Ret sonrası 30 sn yeni teklif otomatik reddedilir; aynı anda tek teklif/transfer.
// Manager tek goroutine'den (flow döngüsü) kullanılır; kilit yoktur.
package transfer

import (
	"errors"
	"os"
	"path/filepath"
	"time"

	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/files"
	"remote-support/agent-win/internal/signal"
)

// RejectCooldown ret sonrası otomatik ret süresi (G-03).
const RejectCooldown = 30 * time.Second

// Prompt kabul diyaloğunda gösterilecek teklif.
type Prompt struct {
	FID     string
	Name    string // temizlenmiş ad
	Size    int64
	Warning files.Warning
}

// Deps dış dünya: ctl gönderimi, WS file.meta, MOTW ve saat (testte sahte).
type Deps struct {
	Dir      string // %USERPROFILE%\Downloads
	MaxBytes int64
	SendCtl  func([]byte) error
	Meta     func(signal.FileMeta)
	MOTW     func(path string) error
	Now      func() time.Time
}

type offer struct {
	fid  string
	idx  uint16
	name string
	size int64
	sha  string
}

type active struct {
	offer
	part string
	f    *os.File
	rx   *dc.Receiver
}

// Manager alım durumu.
type Manager struct {
	d           Deps
	asking      *offer
	cur         *active
	rejectUntil time.Time
}

// Result bir transferin kullanıcıya gösterilecek sonucu.
type Result struct {
	Name   string
	Path   string // OK'de kaydedilen tam yol
	Status string // OK, REJECTED, CANCELLED, CORRUPT
	// MOTWFailed NTFS dışı birimde Zone.Identifier yazılamadı. Uyarısız türde dosya teslim edilir ve kullanıcı
	// uyarılır; tehlikeli/çift uzantılı türde dosya silinir ve Status REJECTED olur (S6-3).
	MOTWFailed bool
}

// New yönetici kurar.
func New(d Deps) *Manager {
	if d.Now == nil {
		d.Now = time.Now
	}
	return &Manager{d: d}
}

func (m *Manager) reply(t, fid string) {
	if b, err := dc.FileReply(t, fid); err == nil {
		_ = m.d.SendCtl(b)
	}
}

func (m *Manager) meta(o offer, result string) {
	m.d.Meta(signal.FileMeta{T: "file.meta", Direction: "TO_CUSTOMER", FileName: o.name, SizeBytes: o.size,
		SHA256: o.sha, Result: result})
}

// Offer `file.offer`'ı değerlendirir. Diyalog gerekiyorsa Prompt döner; aksi halde otomatik reddeder
// (meşgul, ret bekleme süresi, sınır aşımı) ve nil döner.
func (m *Manager) Offer(c dc.Ctl) *Prompt {
	o := offer{fid: c.FID, idx: uint16(*c.Idx), name: files.SanitizeFileName(c.Name), size: *c.Size, sha: c.SHA}
	if m.asking != nil || m.cur != nil || m.d.Now().Before(m.rejectUntil) || o.size > m.d.MaxBytes {
		m.reply("file.reject", o.fid)
		m.meta(o, "REJECTED")
		return nil
	}
	m.asking = &o
	return &Prompt{FID: o.fid, Name: o.name, Size: o.size, Warning: files.NameWarning(o.name)}
}

// Decide müşterinin kararı. Kabulde `.part` oluşturulur ve file.accept gönderilir.
func (m *Manager) Decide(fid string, accept bool) (*Result, error) {
	o := m.asking
	if o == nil || o.fid != fid {
		return nil, errors.New("transfer: bekleyen teklif yok")
	}
	m.asking = nil
	if !accept {
		m.rejectUntil = m.d.Now().Add(RejectCooldown)
		m.reply("file.reject", fid)
		m.meta(*o, "REJECTED")
		return &Result{Name: o.name, Status: "REJECTED"}, nil
	}
	final, err := m.availableName(o.name)
	if err != nil {
		return m.failOffer(*o, err)
	}
	part := filepath.Join(m.d.Dir, final+".part")
	f, err := os.OpenFile(part, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return m.failOffer(*o, err)
	}
	m.cur = &active{offer: *o, part: part, f: f, rx: dc.NewReceiver(o.size, m.d.MaxBytes)}
	m.cur.name = final
	m.reply("file.accept", fid)
	return nil, nil
}

func (m *Manager) failOffer(o offer, err error) (*Result, error) {
	m.reply("file.reject", o.fid)
	m.meta(o, "REJECTED")
	return &Result{Name: o.name, Status: "REJECTED"}, err
}

// availableName hem nihai adın hem `.part` eşinin boş olduğu adı seçer (üzerine yazma yok).
func (m *Manager) availableName(name string) (string, error) {
	return files.AvailableName(name, func(n string) bool {
		for _, p := range []string{n, n + ".part"} {
			if _, err := os.Lstat(filepath.Join(m.d.Dir, p)); !errors.Is(err, os.ErrNotExist) {
				return true
			}
		}
		return false
	})
}

// Chunk `file` çerçevesi. Bozuk çerçeve, sıra dışı parça veya sınır aşımı → iptal.
func (m *Manager) Chunk(c dc.Chunk, ok bool) *Result {
	if m.cur == nil || (ok && c.FIDIndex != m.cur.idx) {
		return nil // eşleşen alım yok → parça düşer (§4.1 idx kuralı)
	}
	if !ok || m.cur.rx.Add(c) != dc.AddOK {
		m.reply("file.cancel", m.cur.fid)
		return m.abort("CANCELLED")
	}
	if _, err := m.cur.f.Write(c.Payload); err != nil {
		m.reply("file.cancel", m.cur.fid)
		return m.abort("CANCELLED")
	}
	return nil
}

// Progress alınan/beyan edilen bayt (ilerleme yüzdesi, AC-53); alım yoksa false.
func (m *Manager) Progress() (int64, int64, bool) {
	if m.cur == nil {
		return 0, 0, false
	}
	return m.cur.rx.Bytes(), m.cur.size, true
}

// Done gönderenin `file.done`'u: SHA-256 + boyut doğrulaması (AC-54).
func (m *Manager) Done(fid string) *Result {
	a := m.cur
	if a == nil || a.fid != fid {
		return nil
	}
	if !a.rx.Verify(a.sha) {
		m.sendResult(fid, false)
		return m.abort("CORRUPT")
	}
	if err := a.f.Close(); err != nil {
		m.sendResult(fid, false)
		return m.abort("CORRUPT")
	}
	m.cur = nil
	// S6-3: MOTW yeniden adlandırmadan önce `.part`'a yazılır; nihai ad hiçbir an işaretsiz görünmez.
	motwFailed := m.d.MOTW(a.part) != nil
	if motwFailed && files.NameWarning(a.name) != files.WarnNone {
		_ = os.Remove(a.part)
		m.sendResult(fid, false)
		m.meta(a.offer, "REJECTED")
		return &Result{Name: a.name, Status: "REJECTED", MOTWFailed: true}
	}
	final, err := m.place(a.part, a.name)
	if err != nil {
		_ = os.Remove(a.part)
		m.sendResult(fid, false)
		m.meta(a.offer, "CORRUPT")
		return &Result{Name: a.name, Status: "CORRUPT"}
	}
	m.sendResult(fid, true)
	m.meta(a.offer, "OK")
	return &Result{Name: filepath.Base(final), Path: final, Status: "OK", MOTWFailed: motwFailed}
}

// errExists hedef ad dolu (renameNoReplace).
var errExists = errors.New("transfer: hedef var")

// placeAttempts aynı anda oluşan dosyalarla yarışta yeni ad deneme sayısı.
const placeAttempts = 5

// place `.part`'ı üzerine yazmadan nihai ada taşır; ad doluysa (alım sırasında oluşmuşsa) ` (n)` ekli ad seçer.
func (m *Manager) place(part, name string) (string, error) {
	cand := name
	for i := 0; i < placeAttempts; i++ {
		dst := filepath.Join(m.d.Dir, cand)
		err := renameNoReplace(part, dst)
		if err == nil {
			return dst, nil
		}
		if !errors.Is(err, errExists) {
			return "", err
		}
		if cand, err = m.availableName(name); err != nil {
			return "", err
		}
	}
	return "", errExists
}

func (m *Manager) sendResult(fid string, ok bool) {
	if b, err := dc.FileResult(fid, ok); err == nil {
		_ = m.d.SendCtl(b)
	}
}

// Cancel gönderenin `file.cancel`'ı (bekleyen teklif veya süren alım).
func (m *Manager) Cancel(fid string) *Result {
	if m.asking != nil && m.asking.fid == fid {
		o := *m.asking
		m.asking = nil
		m.meta(o, "CANCELLED")
		return &Result{Name: o.name, Status: "CANCELLED"}
	}
	if m.cur != nil && m.cur.fid == fid {
		return m.abort("CANCELLED")
	}
	return nil
}

// CancelLocal müşterinin "İptal" düğmesi (AC-53).
func (m *Manager) CancelLocal() *Result {
	if m.cur == nil {
		return nil
	}
	m.reply("file.cancel", m.cur.fid)
	return m.abort("CANCELLED")
}

// Pending teklif diyaloğu açıkken teklif geri çekildiyse UI diyaloğu kapatır.
func (m *Manager) Pending() string {
	if m.asking == nil {
		return ""
	}
	return m.asking.fid
}

// abort süren alımı kapatır, `.part`'ı siler ve WS'ye raporlar.
func (m *Manager) abort(status string) *Result {
	a := m.cur
	m.cur = nil
	_ = a.f.Close()
	_ = os.Remove(a.part)
	m.meta(a.offer, status)
	return &Result{Name: a.name, Status: status}
}

// Close oturum sonunda yarım alımı siler (AC-108: iz bırakılmaz).
func (m *Manager) Close() {
	if m.cur != nil {
		a := m.cur
		m.cur = nil
		_ = a.f.Close()
		_ = os.Remove(a.part)
	}
	m.asking = nil
}
