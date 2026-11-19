package update

import (
	"errors"
	"io"
	"io/fs"
	"strings"
)

// Taşınabilir istemcinin kendi dosyasını yerinde değiştirmesi (P29 K8; mimari-p29 §5.2, K-P29-9/10/11, §14.7 T-8/T-12).
// Mimari §7'deki `install_{windows,darwin,linux}.go` adı yerine `selfreplace_*.go` kullanıldı (servis kurulumu K7 ile ad
// çakışmasın). Yer değiştirme sırası ve konum kararları bu dosyada, platformdan bağımsız ve yalnız stdlib'dir: Windows ve
// macOS davranışı da sahte dosya sistemiyle her ana makinede test edilir. Platform dosyaları yalnız sistem çağrılarını
// bağlar (stdlib `syscall`; x/sys gerektiren ilkel işlevler cmd/noktadestek'ten enjekte edilir — reason.go paket kuralı).

// Hazırlık (yazılabilirlik) hataları. SelfReplacer.Prepare indirmeden ÖNCE çağrılır; bu hatalarda dosya inmez.
var (
	// ErrNotWritable konum yazılamıyor (salt okunur, ağ/çıkarılabilir sürücü, farklı sahip, noexec, sticky olmayan herkes
	// yazılabilir klasör, App Translocation) → skipped(NOT_WRITABLE) + "Yeni sürüm var" bilgisi (AC-483).
	ErrNotWritable = errors.New("update: konum yazılamıyor")
	// ErrManualOnly yerinde değiştirme bu platformda/imzada yapılmaz (macOS, K-P29-10) → skipped(MANUAL_ONLY) + bilgi.
	ErrManualOnly = errors.New("update: yalnız elle güncelleme")
	// ErrPlatformSignature çalışan ikili platform imzalıyken yeni ikili aynı yayıncıyla geçerli imzalı değil (K-P29-13,
	// AC-476) → failed(PLATFORM_SIGNATURE), güvenlik olayı; kurulum yok.
	ErrPlatformSignature = errors.New("update: platform imzası uyuşmuyor")
	// ErrBusy aynı dosyanın başka bir örneği hazırlık yapıyor (tepsi + çift tık): sessizce geçilir, olay yok.
	ErrBusy = errors.New("update: başka örnek güncelliyor")
)

// SelfReplacer platform yer değiştiricisi.
type SelfReplacer interface {
	// Prepare konumu denetler ve doğrulanacak baytın yazılacağı geçici dosyayı açar (yazılabilirlik yoklamasının kendisi;
	// ayrı deneme dosyası yok). ErrNotWritable / ErrManualOnly / ErrBusy ya da başka hata (sessiz) döner.
	Prepare() (Staging, error)
}

// Staging indirme hedefi. Download yazar; doğrulama geçerse oturum yokken Commit, aksi hâlde Abort çağrılır.
type Staging interface {
	io.Writer
	// Commit geçici dosyayı çalışan dosyanın yerine atomik koyar (aynı yol, aynı ad). Hata → failed(INSTALL); geçici dosya
	// silinmiş ve çalışan dosya yerinde olur.
	Commit() error
	// Abort geçici dosyayı kapatıp siler (idempotent; Commit sonrası etkisiz).
	Abort()
}

// --- Windows (K-P29-9, r2 S-P29-T-8) ----------------------------------------------------------------------------------

// Windows yan dosya ekleri: yürütülemez uzantı, gizli öznitelik yok. `.eski` yeni sürümün ilk açılışında silinir (D-3).
const (
	WinNewSuffix = ".yeni"
	WinOldSuffix = ".eski"
	// zoneStream MOTW alternatif veri akışı; içeriği en çok zoneMax bayt kopyalanır.
	zoneStream = ":Zone.Identifier"
	zoneMax    = 4096
)

// WinFile paylaşımsız (share=0) açılmış geçici dosya tutamacı (Sync = FlushFileBuffers).
type WinFile interface {
	io.Writer
	Sync() error
	Close() error
}

// WinFS Windows dosya ilkelleri (gerçeği selfreplace_windows.go + cmd/noktadestek; testte sahte).
type WinFS interface {
	// FixedLocal yol yerel sabit diskte mi (UNC, ağ, çıkarılabilir, CD → false).
	FixedLocal(path string) bool
	// CreateExclusive CREATE_NEW + share=0. Dosya zaten varsa / paylaşım ihlali ErrBusy, diğer hatalar ErrNotWritable.
	CreateExclusive(path string) (WinFile, error)
	// Move MoveFileEx(REPLACE_EXISTING | WRITE_THROUGH).
	Move(from, to string) error
	Remove(path string) error
	ReadFile(path string, max int64) ([]byte, error)
	WriteFile(path string, b []byte) error
}

// WindowsReplacer çalışan `<ad>`'ı aynı klasörde `<ad>.yeni` üzerinden değiştirir.
type WindowsReplacer struct {
	Exe string
	FS  WinFS
	// PlatformSig K-P29-13: çalışan imzasızsa nil; imzalıysa yeni dosya aynı yayıncıyla geçerli imzalı değilse hata.
	// nil ise kapı yok sayılır DEĞİL: Prepare reddeder (fail-closed; cmd her zaman bağlar).
	PlatformSig func(cur, next string) error
}

// CleanupPrevious açılışta önceki güncellemenin artıkları (`<ad>.eski`, bayat `<ad>.yeni`) silinir; silinemezse (başka
// örnek kullanıyor) sessiz kalınır (AC-484, D-3).
func (r WindowsReplacer) CleanupPrevious() {
	_ = r.FS.Remove(r.Exe + WinOldSuffix)
	_ = r.FS.Remove(r.Exe + WinNewSuffix)
}

// Prepare sabit disk denetimi → bayat `.yeni` silinir → CREATE_NEW share=0.
func (r WindowsReplacer) Prepare() (Staging, error) {
	if r.PlatformSig == nil {
		return nil, ErrPlatformSignature
	}
	if r.Exe == "" || !r.FS.FixedLocal(r.Exe) {
		return nil, ErrNotWritable
	}
	tmp := r.Exe + WinNewSuffix
	_ = r.FS.Remove(tmp) // başka örnek tutuyorsa silinemez → CreateExclusive ErrBusy
	f, err := r.FS.CreateExclusive(tmp)
	if err != nil {
		return nil, err
	}
	return &winStaging{fs: r.FS, exe: r.Exe, tmp: tmp, f: f, sig: r.PlatformSig}, nil
}

type winStaging struct {
	fs       WinFS
	exe, tmp string
	f        WinFile
	sig      func(cur, next string) error
	done     bool
}

func (s *winStaging) Write(p []byte) (int, error) { return s.f.Write(p) }

// Commit FlushFileBuffers → kapat → platform imzası (K-P29-13) → MOTW kopyala → `<ad>` → `<ad>.eski` → `<ad>.yeni` → `<ad>` (ikincisi başarısızsa ilki
// geri alınır). Tutamaç kapatıldıktan hemen sonra yeniden adlandırılır (TOCTOU §5.1; sınır aynı kullanıcı).
func (s *winStaging) Commit() error {
	if s.done {
		return errors.New("update: hazırlık kapalı")
	}
	s.done = true
	if err := errors.Join(s.f.Sync(), s.f.Close()); err != nil {
		_ = s.fs.Remove(s.tmp)
		return err
	}
	// §5.1 adım 9: platform imzası tutamaç kapandıktan sonra (WinVerifyTrust dosyayı okur), yer değiştirmeden önce.
	if err := s.sig(s.exe, s.tmp); err != nil {
		_ = s.fs.Remove(s.tmp)
		return errors.Join(ErrPlatformSignature, err)
	}
	if err := s.copyZone(); err != nil {
		_ = s.fs.Remove(s.tmp)
		return err
	}
	if err := SwapInPlace(s.fs.Move, s.exe, s.tmp, s.exe+WinOldSuffix); err != nil {
		_ = s.fs.Remove(s.tmp)
		return err
	}
	return nil
}

// copyZone asıl dosyada MOTW varsa yeni dosyaya kopyalanır (S-P29-T-8). Asılda yoksa bir şey yapılmaz; varsa ve
// kopyalanamazsa kurulum yapılmaz (SmartScreen politikası korunur, fail-closed).
func (s *winStaging) copyZone() error {
	b, err := s.fs.ReadFile(s.exe+zoneStream, zoneMax)
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return nil
	case err != nil:
		return err
	}
	return s.fs.WriteFile(s.tmp+zoneStream, b)
}

func (s *winStaging) Abort() {
	if s.done {
		return
	}
	s.done = true
	_ = s.f.Close()
	_ = s.fs.Remove(s.tmp)
}

// SwapInPlace iki adımlı atomik yer değiştirme: cur → old, next → cur; ikinci adım başarısızsa old → cur geri alınır.
// Her adımda yol `cur` ya eski ya yeni tam dosyadır (yarım dosya yok, AC-482).
func SwapInPlace(move func(from, to string) error, cur, next, old string) error {
	if err := move(cur, old); err != nil {
		return err
	}
	if err := move(next, cur); err != nil {
		if rerr := move(old, cur); rerr != nil {
			return errors.Join(err, rerr)
		}
		return err
	}
	return nil
}

// --- Linux (K-P29-11, r2 S-P29-T-12) ---------------------------------------------------------------------------------

// Linux statfs f_flags (ST_RDONLY, ST_NOEXEC; syscall paketinde dışa açık değil).
const (
	StRdonly = 0x1
	StNoexec = 0x8
)

// LinuxTempPrefix geçici dosya adı `.<ad>.yeni-<8 hex>` (aynı klasör, gizli nokta öneki).
func LinuxTempPrefix(base string) string { return "." + base + ".yeni-" }

// IsLinuxTemp ad, base için bu istemcinin geçici dosya deseni mi (`.<ad>.yeni-` + tam 8 küçük hex).
func IsLinuxTemp(base, name string) bool {
	p := LinuxTempPrefix(base)
	return strings.HasPrefix(name, p) && isLowerHex(name[len(p):], 8)
}

// PosixLocation ELF konumunun yer değiştirme için gereken özellikleri (saf karar girdisi; stat/statfs/euid).
type PosixLocation struct {
	ExeRegular bool
	ExeOwner   uint32
	Euid       uint32
	DirMode    fs.FileMode
	FSFlags    int64
}

// CheckPosixLocation yerinde değiştirme yapılabilir mi: düzenli dosya, sahibi süreç (farklı sahip → hayır), dosya sistemi
// salt okunur ya da noexec değil, klasör herkese yazılabilir ise sticky (T-12). Klasör yazma izni ayrıca Prepare'de
// geçici dosya açılarak yoklanır.
func CheckPosixLocation(l PosixLocation) error {
	switch {
	case !l.ExeRegular, l.ExeOwner != l.Euid:
		return ErrNotWritable
	case l.FSFlags&(StRdonly|StNoexec) != 0:
		return ErrNotWritable
	case l.DirMode&0o002 != 0 && l.DirMode&fs.ModeSticky == 0:
		return ErrNotWritable
	}
	return nil
}

// --- macOS (K-P29-10, D-6) -------------------------------------------------------------------------------------------

// MacLocation çalışan paketin konumu.
type MacLocation struct {
	// Translocated App Translocation (salt okunur rastgele bağlama).
	Translocated bool
	// Writable paket ve üst klasörü yazılabilir.
	Writable bool
}

// DecideMac macOS kararı: Translocation ya da yazılamayan konum → ErrNotWritable; diğer her durumda ErrManualOnly.
// Yerinde paket değiştirme (Developer ID + aynı Team ID + notarization kapısı) bu pakette YAZILMADI: yeni paketin
// SecStaticCodeCheckValidity/SecAssessment doğrulaması Developer ID'li paket olmadan test edilemez; Apple hesabı yokken
// her derleme ad-hoc/TEST'tir ve dal zaten erişilemez (implementation.md P29-K8 sapma notu). Fail-closed: zip inmez.
func DecideMac(l MacLocation) error {
	if l.Translocated || !l.Writable {
		return ErrNotWritable
	}
	return ErrManualOnly
}
