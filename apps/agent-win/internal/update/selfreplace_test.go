package update

import (
	"bytes"
	"errors"
	"io/fs"
	"sort"
	"strings"
	"testing"
)

// fakeWinFS bellek içi Windows dosya sistemi (K-P29-9 sırası her ana makinede test edilir). ADS `<yol>:Zone.Identifier`
// ayrı anahtardır ve Move ile dosyayla birlikte taşınır (NTFS davranışı).
type fakeWinFS struct {
	files    map[string][]byte
	open     map[string]bool
	notFixed bool
	failMove map[string]error // hedef yol → hata
	zoneErr  error
	moves    []string
}

func newFakeWinFS(exe string) *fakeWinFS {
	return &fakeWinFS{files: map[string][]byte{exe: []byte("eski")}, open: map[string]bool{}, failMove: map[string]error{}}
}

func (f *fakeWinFS) FixedLocal(string) bool { return !f.notFixed }

func (f *fakeWinFS) CreateExclusive(p string) (WinFile, error) {
	if _, ok := f.files[p]; ok || f.open[p] {
		return nil, ErrBusy
	}
	f.open[p] = true
	return &fakeWinFile{fs: f, path: p}, nil
}

func (f *fakeWinFS) Move(from, to string) error {
	f.moves = append(f.moves, from+"→"+to)
	if err := f.failMove[to]; err != nil {
		return err
	}
	b, ok := f.files[from]
	if !ok || f.open[from] {
		return fs.ErrNotExist
	}
	delete(f.files, from)
	f.files[to] = b
	delete(f.files, to+zoneStream)
	if z, ok := f.files[from+zoneStream]; ok {
		delete(f.files, from+zoneStream)
		f.files[to+zoneStream] = z
	}
	return nil
}

func (f *fakeWinFS) Remove(p string) error {
	if f.open[p] {
		return errors.New("paylaşım ihlali")
	}
	if _, ok := f.files[p]; !ok {
		return fs.ErrNotExist
	}
	delete(f.files, p)
	delete(f.files, p+zoneStream)
	return nil
}

func (f *fakeWinFS) ReadFile(p string, _ int64) ([]byte, error) {
	if f.zoneErr != nil && strings.HasSuffix(p, zoneStream) {
		return nil, f.zoneErr
	}
	b, ok := f.files[p]
	if !ok {
		return nil, fs.ErrNotExist
	}
	return b, nil
}

func (f *fakeWinFS) WriteFile(p string, b []byte) error {
	f.files[p] = append([]byte(nil), b...)
	return nil
}

func (f *fakeWinFS) names() []string {
	var out []string
	for k := range f.files {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

type fakeWinFile struct {
	fs   *fakeWinFS
	path string
	buf  bytes.Buffer
}

func (w *fakeWinFile) Write(p []byte) (int, error) { return w.buf.Write(p) }
func (w *fakeWinFile) Sync() error                 { return nil }
func (w *fakeWinFile) Close() error {
	if w.fs.open[w.path] {
		delete(w.fs.open, w.path)
		w.fs.files[w.path] = w.buf.Bytes()
	}
	return nil
}

const winExe = `C:\Users\u\Downloads\NoktaDestek-firma-abcdefghijklmnop.exe`

func stageWin(t *testing.T, fsys *fakeWinFS, body string) Staging {
	t.Helper()
	st, err := WindowsReplacer{Exe: winExe, FS: fsys}.Prepare()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.Write([]byte(body)); err != nil {
		t.Fatal(err)
	}
	return st
}

func TestAC482WindowsSwapSameNameNextLaunchCleansOld(t *testing.T) {
	fsys := newFakeWinFS(winExe)
	if err := stageWin(t, fsys, "yeni").Commit(); err != nil {
		t.Fatal(err)
	}
	if got := string(fsys.files[winExe]); got != "yeni" {
		t.Fatalf("aynı yol/ad yeni içerik olmalı: %q", got)
	}
	want := []string{winExe, winExe + WinOldSuffix}
	if got := fsys.names(); strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("kurulumdan sonra yalnız ikili + .eski (D-3) kalmalı: %v", got)
	}
	if fsys.moves[0] != winExe+"→"+winExe+WinOldSuffix || fsys.moves[1] != winExe+WinNewSuffix+"→"+winExe {
		t.Fatalf("sıra: %v", fsys.moves)
	}
	// AC-484: yeni sürümün ilk açılışında .eski silinir → yalnız değiştirilen ikili kalır.
	WindowsReplacer{Exe: winExe, FS: fsys}.CleanupPrevious()
	if got := fsys.names(); len(got) != 1 || got[0] != winExe {
		t.Fatalf("temizlik sonrası: %v", got)
	}
}

func TestAC482WindowsSecondRenameFailsRollsBack(t *testing.T) {
	fsys := newFakeWinFS(winExe)
	st := stageWin(t, fsys, "yeni")
	// ilk Move (exe → .eski) geçer, ikinci (.yeni → exe) başarısız, üçüncü (geri alma .eski → exe) geçer.
	calls := 0
	st.(*winStaging).fs = &moveOnce{fakeWinFS: fsys, failAt: 2, err: errors.New("erişim engellendi"), calls: &calls}
	if err := st.Commit(); err == nil {
		t.Fatal("ikinci adım hatası dönmeli")
	}
	if got := string(fsys.files[winExe]); got != "eski" {
		t.Fatalf("geri alınmalı: %q", got)
	}
	if got := fsys.names(); len(got) != 1 {
		t.Fatalf("yarım dosya/artık kalmamalı: %v", got)
	}
}

// moveOnce n'inci Move çağrısını başarısız kılar.
type moveOnce struct {
	*fakeWinFS
	failAt int
	err    error
	calls  *int
}

func (m *moveOnce) Move(from, to string) error {
	*m.calls++
	if *m.calls == m.failAt {
		return m.err
	}
	return m.fakeWinFS.Move(from, to)
}

func TestAC482WindowsMOTWCopied(t *testing.T) {
	fsys := newFakeWinFS(winExe)
	zone := []byte("[ZoneTransfer]\r\nZoneId=3\r\n")
	fsys.files[winExe+zoneStream] = zone
	if err := stageWin(t, fsys, "yeni").Commit(); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(fsys.files[winExe+zoneStream], zone) {
		t.Fatal("MOTW yeni dosyaya kopyalanmalı (S-P29-T-8)")
	}

	fsys = newFakeWinFS(winExe) // MOTW yoksa eklenmez
	if err := stageWin(t, fsys, "yeni").Commit(); err != nil {
		t.Fatal(err)
	}
	if _, ok := fsys.files[winExe+zoneStream]; ok {
		t.Fatal("asılda MOTW yokken eklenmemeli")
	}

	fsys = newFakeWinFS(winExe) // MOTW okunamıyor → kurulum yok (fail-closed)
	fsys.files[winExe+zoneStream] = zone
	st := stageWin(t, fsys, "yeni")
	fsys.zoneErr = errors.New("okunamadı")
	if err := st.Commit(); err == nil {
		t.Fatal("MOTW kopyalanamazsa kurulum yapılmamalı")
	}
	if string(fsys.files[winExe]) != "eski" {
		t.Fatal("çalışan dosya değişmemeli")
	}
	if _, ok := fsys.files[winExe+WinNewSuffix]; ok {
		t.Fatal(".yeni silinmeli (AC-484)")
	}
}

func TestAC483WindowsNotWritableAndBusy(t *testing.T) {
	fsys := newFakeWinFS(winExe)
	fsys.notFixed = true
	if _, err := (WindowsReplacer{Exe: winExe, FS: fsys}).Prepare(); !errors.Is(err, ErrNotWritable) {
		t.Fatalf("ağ/çıkarılabilir sürücü: %v", err)
	}
	if len(fsys.files) != 1 {
		t.Fatal("yan dosya bırakılmamalı (K-P20-2)")
	}
	fsys = newFakeWinFS(winExe)
	st := stageWin(t, fsys, "x") // birinci örnek tutuyor
	if _, err := (WindowsReplacer{Exe: winExe, FS: fsys}).Prepare(); !errors.Is(err, ErrBusy) {
		t.Fatalf("ikinci örnek sessiz geçmeli: %v", err)
	}
	st.Abort()
	st.Abort() // idempotent
	if got := fsys.names(); len(got) != 1 {
		t.Fatalf("Abort .yeni'yi silmeli: %v", got)
	}
}

func TestAC484WindowsStaleNewRemovedOnPrepare(t *testing.T) {
	fsys := newFakeWinFS(winExe)
	fsys.files[winExe+WinNewSuffix] = []byte("çökmüş indirme")
	if err := stageWin(t, fsys, "yeni").Commit(); err != nil {
		t.Fatal(err)
	}
	if string(fsys.files[winExe]) != "yeni" {
		t.Fatal("bayat .yeni silinip yeni hazırlık kullanılmalı")
	}
}

func TestSwapInPlaceRollbackFailureReported(t *testing.T) {
	n := 0
	err := SwapInPlace(func(string, string) error {
		n++
		if n == 1 {
			return nil
		}
		return errors.New("hata")
	}, "a", "b", "c")
	if err == nil || n != 3 {
		t.Fatalf("geri alma denenmeli ve iki hata birleşmeli: %v, %d", err, n)
	}
}

func TestAC483PosixLocation(t *testing.T) {
	ok := PosixLocation{ExeRegular: true, ExeOwner: 1000, Euid: 1000, DirMode: fs.ModeDir | 0o755}
	cases := []struct {
		name string
		mod  func(*PosixLocation)
		want error
	}{
		{"ev klasörü", func(*PosixLocation) {}, nil},
		{"farklı sahip", func(l *PosixLocation) { l.ExeOwner = 0 }, ErrNotWritable},
		{"düzenli dosya değil", func(l *PosixLocation) { l.ExeRegular = false }, ErrNotWritable},
		{"salt okunur bağlama", func(l *PosixLocation) { l.FSFlags = StRdonly }, ErrNotWritable},
		{"noexec bağlama", func(l *PosixLocation) { l.FSFlags = StNoexec | 0x400 }, ErrNotWritable},
		{"herkes yazılabilir, sticky değil (T-12)", func(l *PosixLocation) { l.DirMode = fs.ModeDir | 0o777 }, ErrNotWritable},
		{"herkes yazılabilir + sticky (/tmp)", func(l *PosixLocation) { l.DirMode = fs.ModeDir | fs.ModeSticky | 0o777 }, nil},
		{"grup yazılabilir", func(l *PosixLocation) { l.DirMode = fs.ModeDir | 0o775 }, nil},
	}
	for _, c := range cases {
		l := ok
		c.mod(&l)
		if err := CheckPosixLocation(l); !errors.Is(err, c.want) || (c.want == nil && err != nil) {
			t.Errorf("%s: %v, beklenen %v", c.name, err, c.want)
		}
	}
}

func TestAC483MacAlwaysNotifyOnly(t *testing.T) {
	cases := []struct {
		l    MacLocation
		want error
	}{
		{MacLocation{Translocated: true, Writable: true}, ErrNotWritable},
		{MacLocation{Writable: false}, ErrNotWritable},
		{MacLocation{Writable: true}, ErrManualOnly}, // ad-hoc/TEST ve bugün her paket (D-6)
	}
	for i, c := range cases {
		if err := DecideMac(c.l); !errors.Is(err, c.want) {
			t.Errorf("%d: %v, beklenen %v", i, err, c.want)
		}
	}
}

func TestAC484LinuxTempName(t *testing.T) {
	base := "Destek-12345678"
	for name, want := range map[string]bool{
		".Destek-12345678.yeni-0a1b2c3d":  true,
		".Destek-12345678.yeni-0A1B2C3D":  false,
		".Destek-12345678.yeni-0a1b2c3":   false,
		".Destek-12345678.yeni-0a1b2c3d9": false,
		"Destek-12345678.yeni-0a1b2c3d":   false,
		".Destek-87654321.yeni-0a1b2c3d":  false,
	} {
		if IsLinuxTemp(base, name) != want {
			t.Errorf("%s: %v olmalı", name, want)
		}
	}
}
