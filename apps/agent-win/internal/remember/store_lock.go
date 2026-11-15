package remember

import (
	"errors"
	"io"
	"os"
	"time"

	"remote-support/agent-win/internal/diag"
)

// Kilit yoklama aralığı ve en uzun bekleme (G-P20-2); testler kısaltır.
var (
	lockPoll = 50 * time.Millisecond
	lockWait = 2 * time.Second
)

// held alınmış kilit: klasör (handle'larıyla sabit, AC-249) ve kilit dosyası.
type held struct {
	dir  *diag.Dir
	lock *os.File // kilit ve sayaç baytı bu handle üzerinden; nil = kilitsiz (ForgetAll zaman aşımı)
}

// acquire klasörü açar (create: yoksa oluşturur), `kayitlar.lock`'u handle kuralıyla açar ve özel kilidi 50 ms
// aralıkla en çok 2 sn yoklar. Klasör veya kilit dosyası açılışındaki paylaşım ihlali (başka sürecin wipe'ı kilit
// dosyasını ya da boş klasörü silmek için kısa süre DELETE erişimiyle açık tutar; AV) aynı süre içinde yeniden denenir:
// henüz hiçbir dosya okunmadığı ve yazılmadığı için geçici sınıfın "dosyaya dokunma" kuralı (G-P20-18) korunur; süre
// dolarsa paylaşım hatası (sınıf 2, ClassSharing) döner. Klasör yoksa os.ErrNotExist; kilit zaman aşımında
// ErrLockTimeout.
func (s *Store) acquire(create bool) (*held, error) {
	deadline := time.Now().Add(lockWait)
	for {
		h, retry, err := s.tryAcquire(create)
		if !retry {
			return h, err
		}
		if time.Now().After(deadline) {
			if err == nil {
				err = ErrLockTimeout
			}
			return nil, err
		}
		time.Sleep(lockPoll)
	}
}

// tryAcquire tek deneme. retry: kilit başkasında (err nil) veya paylaşım ihlali (err dolu); handle'lar kapatılmıştır.
func (s *Store) tryAcquire(create bool) (*held, bool, error) {
	dir, err := diag.OpenDir(s.Dir, create)
	if err != nil {
		return nil, isSharing(err), err
	}
	f, err := dir.Open(lockName, diag.ModeLock)
	if err != nil {
		dir.Close()
		return nil, isSharing(err), err
	}
	ok, err := tryLock(f)
	if ok {
		return &held{dir: dir, lock: f}, false, nil
	}
	_ = f.Close()
	dir.Close()
	return nil, err == nil, err
}

// unlock kilidi bırakır ve kilit dosyasını kapatır (klasör açık kalır).
func (h *held) unlock() {
	if h.lock != nil {
		unlock(h.lock)
		_ = h.lock.Close()
		h.lock = nil
	}
}

func (h *held) close() {
	h.unlock()
	h.dir.Close()
}

// counter kilit dosyasındaki tek bayt: yüksek 4 bit sınıf-2 kodu, düşük 4 bit ardışık açılış sayısı (G-P20-18).
// Kişisel veri değildir; yalnız kilit altında okunur/yazılır.
func (h *held) counter() byte {
	if h.lock == nil {
		return 0
	}
	b := make([]byte, 1)
	if n, err := h.lock.ReadAt(b, 0); n != 1 || (err != nil && !errors.Is(err, io.EOF)) {
		return 0
	}
	return b[0]
}

func (h *held) setCounter(v byte) {
	if h.lock != nil && h.counter() != v {
		_, _ = h.lock.WriteAt([]byte{v}, 0)
	}
}

// unreadable sınıf-2 okumada sayacı işler: aynı kod sürüyorsa ardışık sayı, değilse 0'dan; startup ise (açılışta bir
// kez) sayı ilerletilip yazılır. Silme önerisi (SuggestForget) gerekiyorsa true (G-P20-18).
func (h *held) unreadable(class string, startup bool) bool {
	code, c := counterCode(class), h.counter()
	n := c & 0x0f
	if c>>4 != code {
		n = 0
	}
	if startup {
		if n < 0x0f {
			n++
		}
		h.setCounter(code<<4 | n)
	}
	return n >= suggestForgetN
}
