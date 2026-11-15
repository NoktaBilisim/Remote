//go:build windows

package autorun

import (
	"errors"

	"golang.org/x/sys/windows/registry"
)

// New gerçek HKCU ve dosya sistemiyle çalışan yönetici.
func New() *Manager { return &Manager{Reg: sysRegistry{}, Probe: sysProber{}} }

// sysRegistry HKCU\…\Run (oku/yaz/sil) ve StartupApproved\Run (yalnız oku).
type sysRegistry struct{}

func (sysRegistry) Read(name string) (string, Kind, error) {
	k, err := registry.OpenKey(registry.CURRENT_USER, RunKey, registry.QUERY_VALUE)
	if errors.Is(err, registry.ErrNotExist) {
		return "", 0, ErrNotFound
	}
	if err != nil {
		return "", 0, err
	}
	defer func() { _ = k.Close() }()
	v, typ, err := k.GetStringValue(name)
	switch {
	case errors.Is(err, registry.ErrNotExist):
		return "", 0, ErrNotFound
	case errors.Is(err, registry.ErrUnexpectedType):
		return "", KindOther, nil
	case err != nil:
		return "", 0, err
	case typ != registry.SZ: // REG_EXPAND_SZ: `%` genişlemesi istenmez (G-P20-6)
		return "", KindOther, nil
	}
	return v, KindString, nil
}

func (sysRegistry) WriteString(name, val string) error {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, RunKey, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer func() { _ = k.Close() }()
	return k.SetStringValue(name, val)
}

func (sysRegistry) Delete(name string) error {
	k, err := registry.OpenKey(registry.CURRENT_USER, RunKey, registry.SET_VALUE)
	if errors.Is(err, registry.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer func() { _ = k.Close() }()
	if err := k.DeleteValue(name); err != nil && !errors.Is(err, registry.ErrNotExist) {
		return err
	}
	return nil
}

func (sysRegistry) Approved(name string) ([]byte, error) {
	k, err := registry.OpenKey(registry.CURRENT_USER, ApprovedKey, registry.QUERY_VALUE)
	if errors.Is(err, registry.ErrNotExist) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	defer func() { _ = k.Close() }()
	v, _, err := k.GetBinaryValue(name)
	if errors.Is(err, registry.ErrNotExist) || errors.Is(err, registry.ErrUnexpectedType) {
		return nil, ErrNotFound
	}
	return v, err
}
