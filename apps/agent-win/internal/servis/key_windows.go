//go:build windows

package servis

import (
	"errors"
	"io"
	"os"
	"unsafe"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/diag"
)

// DPAPI (§5.3 r2 m.e): kurulum makine kapsamı (`CRYPTPROTECT_LOCAL_MACHINE`), servis SYSTEM kullanıcı kapsamı (bayrak
// yok — yalnız SYSTEM çözer). Sabit ek entropi gizli değildir; başka uygulamanın DPAPI çıktısıyla karışmayı önler.
var keyEntropy = []byte("NoktaDestek.servis.key.v1")

const maxKeyFile = 4096

type dpapi struct{ machine bool }

// MachineDPAPI kurulum mühürü; UserDPAPI servis (SYSTEM) mühürü.
var (
	MachineDPAPI Protector = dpapi{machine: true}
	UserDPAPI    Protector = dpapi{machine: false}
)

func dataBlob(b []byte) *windows.DataBlob {
	if len(b) == 0 {
		return &windows.DataBlob{}
	}
	return &windows.DataBlob{Size: uint32(len(b)), Data: &b[0]}
}

func takeDataBlob(out *windows.DataBlob) []byte {
	defer func() { _, _ = windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data))) }()
	return append([]byte(nil), unsafe.Slice(out.Data, out.Size)...)
}

func (d dpapi) flags() uint32 {
	f := uint32(windows.CRYPTPROTECT_UI_FORBIDDEN)
	if d.machine {
		f |= windows.CRYPTPROTECT_LOCAL_MACHINE
	}
	return f
}

func (d dpapi) Protect(plain []byte) ([]byte, error) {
	var out windows.DataBlob
	if err := windows.CryptProtectData(dataBlob(plain), nil, dataBlob(keyEntropy), 0, nil, d.flags(), &out); err != nil {
		return nil, err
	}
	return takeDataBlob(&out), nil
}

func (d dpapi) Unprotect(sealed []byte) ([]byte, error) {
	var out windows.DataBlob
	if err := windows.CryptUnprotectData(dataBlob(sealed), nil, dataBlob(keyEntropy), 0, nil, d.flags(), &out); err != nil {
		return nil, err
	}
	return takeDataBlob(&out), nil
}

// dirFiles KeyFiles'ın reparse denetimli uygulaması (diag.Dir: klasör sabitlenir, bağlantı/sabit bağ reddedilir).
type dirFiles struct{ d *diag.Dir }

// OpenKeyFiles veri klasörünü sabitleyip anahtar dosya işlemlerini verir; kapatıcı çağrılmalıdır.
func OpenKeyFiles(dataDir string) (KeyFiles, func(), error) {
	d, err := diag.OpenDir(dataDir, false)
	if err != nil {
		return nil, nil, err
	}
	return dirFiles{d: d}, d.Close, nil
}

func (f dirFiles) Read(name string) ([]byte, error) {
	h, err := f.d.Open(name, diag.ModeRead)
	if err != nil {
		return nil, err
	}
	defer h.Close()
	b, err := io.ReadAll(io.LimitReader(h, maxKeyFile+1))
	if err != nil {
		return nil, err
	}
	if len(b) > maxKeyFile {
		return nil, errors.New("servis: anahtar dosyası çok büyük")
	}
	return b, nil
}

func (f dirFiles) Create(name string, data []byte) error {
	h, err := f.d.Open(name, diag.ModeCreate)
	if err != nil {
		return err
	}
	_, werr := h.Write(data)
	serr := h.Sync()
	if err := errors.Join(werr, serr, h.Close()); err != nil {
		_ = f.d.Remove(name)
		return err
	}
	return nil
}

func (f dirFiles) Remove(name string) error {
	err := f.d.Remove(name)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
