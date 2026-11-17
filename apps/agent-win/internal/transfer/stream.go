package transfer

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"hash"
	"os"
	"path/filepath"
	"sync"
)

// P28b (mimari-p28b §8 "İndirme"): SERVER modunda bayt kaynağı DataChannel değil HTTPS akışıdır. Hedef kuralları aynıdır:
// Dir (İndirilenler) + CheckDir, üzerine yazmayan ad, `<ad>.part` (O_EXCL), boyut sayacı, SHA-256, MOTW yeniden
// adlandırmadan önce, renameNoReplace. Kabul diyaloğu ve teklif durumu çağırandadır (flow/files_server.go).

// errStreamSize akış beyan edilen boyutu aştı ya da eksik kaldı.
var errStreamSize = errors.New("transfer: akış boyutu uyuşmuyor")

// Stream tek bir sunucu indirmesinin `.part` hedefidir. Open/Write/Commit/Abort bir goroutine'den çağrılır; yalnız
// Manager'ın değişmez Deps alanlarını okur (alım durumuna dokunmaz).
type Stream struct {
	m    *Manager
	name string
	size int64
	sha  string
	part string
	f    *os.File
	h    hash.Hash
	n    int64
	once sync.Once
}

// OpenStream temizlenmiş ad için `.part` açar. Hata → aktarım reddedilir (dosya oluşmaz).
func (m *Manager) OpenStream(name string, size int64, sha string) (*Stream, error) {
	if size < 0 || size > m.d.MaxBytes {
		return nil, errStreamSize
	}
	if err := m.checkDir(); err != nil {
		return nil, err
	}
	final, err := m.availableName(name)
	if err != nil {
		return nil, err
	}
	part := filepath.Join(m.d.Dir, final+".part")
	f, err := os.OpenFile(part, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, err
	}
	return &Stream{m: m, name: final, size: size, sha: sha, part: part, f: f, h: sha256.New()}, nil
}

// Write io.Writer: beyan edilen boyutu aşan yazım reddedilir.
func (s *Stream) Write(p []byte) (int, error) {
	if s.n+int64(len(p)) > s.size {
		return 0, errStreamSize
	}
	k, err := s.f.Write(p)
	s.h.Write(p[:k])
	s.n += int64(k)
	return k, err
}

// Written yazılan bayt (ilerleme).
func (s *Stream) Written() int64 { return s.n }

// Abort `.part`'ı siler (iptal, ağ hatası, oturum sonu — AC-108 iz yok).
func (s *Stream) Abort() {
	s.once.Do(func() {
		_ = s.f.Close()
		_ = os.Remove(s.part)
	})
}

// Commit boyut + SHA-256 doğrulaması, MOTW ve üzerine yazmadan yerleştirme (DC finish ile aynı kurallar). Status:
// OK / CORRUPT / REJECTED (MOTW yazılamadı ve tür tehlikeli). Hata durumunda `.part` silinir.
func (s *Stream) Commit() Result {
	owned := false
	s.once.Do(func() { owned = true }) // Abort'la yarışta tek sahip; sonraki Abort etkisiz
	if !owned {
		return Result{Name: s.name, Status: "CORRUPT"}
	}
	if s.n != s.size || hex.EncodeToString(s.h.Sum(nil)) != s.sha {
		_ = s.f.Close()
		_ = os.Remove(s.part)
		return Result{Name: s.name, Status: "CORRUPT"}
	}
	if err := s.f.Close(); err != nil {
		_ = os.Remove(s.part)
		return Result{Name: s.name, Status: "CORRUPT"}
	}
	motwFailed := s.m.d.MOTW(s.part) != nil
	if motwReject(s.name, motwFailed) {
		_ = os.Remove(s.part)
		return Result{Name: s.name, Status: motwFailStatus, MOTWFailed: true}
	}
	final, err := s.m.place(s.part, s.name)
	if err != nil {
		_ = os.Remove(s.part)
		return Result{Name: s.name, Status: "CORRUPT"}
	}
	return Result{Name: filepath.Base(final), Path: final, Status: "OK", MOTWFailed: motwFailed}
}
