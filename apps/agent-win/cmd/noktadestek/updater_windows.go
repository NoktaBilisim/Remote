//go:build windows

package main

import (
	"context"
	"errors"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/pairing"
	"remote-support/agent-win/internal/remember"
	"remote-support/agent-win/internal/servis"
	"remote-support/agent-win/internal/update"
)

// Windows taşınabilir güncelleme ilkelleri (K-P29-9): internal/update yalnız stdlib kullanır; MoveFileEx ve GetDriveType
// x/sys/windows'tan buradan enjekte edilir.

// winReplacer çalışan exe için yer değiştirici.
func winReplacer(exe string) update.WindowsReplacer {
	return update.WindowsReplacer{Exe: exe, FS: update.NewWindowsFS(moveWriteThrough, fixedLocal),
		PlatformSig: platformSignature}
}

// errPlatformUnverified çalışan exe Authenticode imzalıyken yayıncı karşılaştırması bu derlemede yapılamıyor.
var errPlatformUnverified = errors.New("platform imzası doğrulanamadı")

// platformSignature K-P29-13 / AC-476: çalışan exe imzasızsa (bugün tüm derlemeler) kapı atlanır. İmzalıysa yeni exe
// aynı yayıncıyla imzalı olmalı; yayıncı özeti karşılaştırması K7'nin internal/servis/update_sign_windows.go'sundaki
// (dışa açık değil) işlevle yapılacak — o dışa açılana kadar imzalı çalışan exe'de güncelleme reddedilir (fail-closed).
func platformSignature(cur, _ string) error {
	if !servis.SelfSigned(cur) {
		return nil
	}
	return errPlatformUnverified
}

// moveWriteThrough MoveFileEx(REPLACE_EXISTING | WRITE_THROUGH).
func moveWriteThrough(from, to string) error {
	f, err := windows.UTF16PtrFromString(from)
	if err != nil {
		return err
	}
	t, err := windows.UTF16PtrFromString(to)
	if err != nil {
		return err
	}
	return windows.MoveFileEx(f, t, windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH)
}

// fixedLocal yalnız sürücü harfli yerel sabit disk (UNC, ağ, çıkarılabilir, CD → false; AC-483).
func fixedLocal(path string) bool {
	vol := filepath.VolumeName(path)
	if len(vol) != 2 || vol[1] != ':' || strings.HasPrefix(path, `\\`) {
		return false
	}
	root, err := windows.UTF16PtrFromString(vol + `\`)
	if err != nil {
		return false
	}
	return windows.GetDriveType(root) == windows.DRIVE_FIXED
}

var errBindingsUnreadable = errors.New("kayıt dosyası okunamadı")

// startUpdater güncelleyiciyi kurar ve önceki güncellemenin artıklarını siler (her açılışta, anahtarsız derlemede de).
func (a *app) startUpdater(client *api.Client, notify func(string) bool) {
	rep := winReplacer(a.exe)
	rep.CleanupPrevious() // D-3: .eski yeni sürümün ilk açılışında silinir
	ref, _ := pairing.RefFromFileName(a.exe)
	a.upd = newUpdater(a.cfg, client, rep, ref, a.updatePolicy(client), notify)
}

// updatePolicy kayıtlı bilgisayar politikası (K-P29-7, K-P29-19): gömülü kökenin her kaydı için bindings/status;
// birleştirme kuralı mergeBindingPolicies. Kayıt dosyası okunamıyorsa bu dönem karar verilmez (AC-485).
func (a *app) updatePolicy(client *api.Client) func(context.Context) (update.Policy, []string, error) {
	return func(ctx context.Context) (update.Policy, []string, error) {
		if a.store == nil || a.origin == "" {
			return update.PolicyAuto, nil, nil
		}
		st := a.store.LoadState()
		switch st.Status {
		case remember.StatusUnreadable:
			return "", nil, errBindingsUnreadable
		case remember.StatusAbsent:
			return update.PolicyAuto, nil, nil
		}
		var rs []bindingStatus
		for _, b := range st.Data.ForOrigin(a.origin) {
			info, err := client.BindingStatus(ctx, b.Key)
			rs = append(rs, bindingStatus{key: b.Key, info: info, err: err})
			if err != nil && !errors.As(err, new(*api.Error)) {
				return "", nil, err // ağ/TLS: kalanları sorma
			}
		}
		return mergeBindingPolicies(rs)
	}
}
