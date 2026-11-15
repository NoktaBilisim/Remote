//go:build windows

package servis

import (
	"context"
	"errors"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// HKLM\SOFTWARE\NoktaDestek\Servis (§5.3 adım 3, §5.4): `DeviceId`, `TenantName`, `CustomerName`, `LocalEnabled`.
// Anahtar HKLM\SOFTWARE'in varsayılan ACL'ini devralır (yazma: SYSTEM + Administrators; okuma: Users). Tek kaynak
// `LocalEnabled` (DWORD): yalnız 1 açık sayılır; okunamazsa kapalı (fail-closed).
const (
	valDeviceID     = "DeviceId"
	valTenantName   = "TenantName"
	valCustomerName = "CustomerName"
	valLocalEnabled = "LocalEnabled"
	parentKeyPath   = `SOFTWARE\NoktaDestek`
)

// Registration kurulumun HKLM'deki kaydı.
type Registration struct {
	DeviceID     string
	TenantName   string
	CustomerName string
}

// RegSwitch LocalSwitch'in HKLM uygulaması.
type RegSwitch struct{}

// Enabled LocalEnabled == 1.
func (RegSwitch) Enabled() (bool, error) {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, RegKeyPath, registry.QUERY_VALUE)
	if err != nil {
		return false, err
	}
	defer func() { _ = k.Close() }()
	v, _, err := k.GetIntegerValue(valLocalEnabled)
	if err != nil {
		return false, err
	}
	return v == 1, nil
}

// Disable LocalEnabled = 0 (boru `disable`; servis SYSTEM bağlamında yazar).
func (RegSwitch) Disable() error { return SetLocalEnabled(false) }

// SetLocalEnabled değeri yazar (`--enable` yönetici bağlamında; açma yalnız buradan — §5.4).
func SetLocalEnabled(on bool) error {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, RegKeyPath, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer func() { _ = k.Close() }()
	var v uint32
	if on {
		v = 1
	}
	return k.SetDWordValue(valLocalEnabled, v)
}

// ReadRegistration kaydı okur.
func ReadRegistration() (Registration, error) {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, RegKeyPath, registry.QUERY_VALUE)
	if err != nil {
		return Registration{}, err
	}
	defer func() { _ = k.Close() }()
	var r Registration
	var errs [3]error
	r.DeviceID, _, errs[0] = k.GetStringValue(valDeviceID)
	r.TenantName, _, errs[1] = k.GetStringValue(valTenantName)
	r.CustomerName, _, errs[2] = k.GetStringValue(valCustomerName)
	if err := errors.Join(errs[:]...); err != nil {
		return Registration{}, err
	}
	if !ulidRe.MatchString(r.DeviceID) {
		return Registration{}, errors.New("servis: kayıtlı cihaz kimliği geçersiz")
	}
	return r, nil
}

// writeRegistration kurulumda kaydı yazar; yerel anahtar açık başlar.
func writeRegistration(r Registration) error {
	k, _, err := registry.CreateKey(registry.LOCAL_MACHINE, RegKeyPath, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer func() { _ = k.Close() }()
	return errors.Join(k.SetStringValue(valDeviceID, r.DeviceID), k.SetStringValue(valTenantName, r.TenantName),
		k.SetStringValue(valCustomerName, r.CustomerName), k.SetDWordValue(valLocalEnabled, 1))
}

// WatchLocal LocalEnabled değişimini RegNotifyChangeKeyValue ile izler ve her bildirimde onChange çağırır. Bağlam
// iptali en geç 1 sn'de fark edilir (bildirim anında gelir; bekleme yalnız iptal denetimi içindir).
func WatchLocal(ctx context.Context, onChange func()) error {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, RegKeyPath, registry.NOTIFY|registry.QUERY_VALUE)
	if err != nil {
		return err
	}
	defer func() { _ = k.Close() }()
	ev, err := windows.CreateEvent(nil, 0, 0, nil)
	if err != nil {
		return err
	}
	defer func() { _ = windows.CloseHandle(ev) }()
	for ctx.Err() == nil {
		if err := windows.RegNotifyChangeKeyValue(windows.Handle(k), false, windows.REG_NOTIFY_CHANGE_LAST_SET, ev, true); err != nil {
			return err
		}
		if !waitEvent(ctx, ev) {
			break
		}
		onChange()
	}
	return ctx.Err()
}

// waitEvent olay sinyallenene (true) ya da bağlam bitene (false) kadar 1 sn'lik dilimlerle bekler.
func waitEvent(ctx context.Context, ev windows.Handle) bool {
	for ctx.Err() == nil {
		r, err := windows.WaitForSingleObject(ev, 1000)
		if err != nil {
			return false
		}
		if r == windows.WAIT_OBJECT_0 {
			return true
		}
	}
	return false
}

// writeAppKeys Run (`--tray`) ve Uninstall kayıtları (§5.3 adım 5–6).
func writeAppKeys(exe, version string) error {
	run, err1 := RunCommand(exe)
	un, err2 := UninstallCommand(exe)
	if err := errors.Join(err1, err2); err != nil {
		return err
	}
	rk, _, err := registry.CreateKey(registry.LOCAL_MACHINE, RunKeyPath, registry.SET_VALUE)
	if err != nil {
		return err
	}
	err = rk.SetStringValue(RunValueName, run)
	_ = rk.Close()
	if err != nil {
		return err
	}
	uk, _, err := registry.CreateKey(registry.LOCAL_MACHINE, UninstallKey, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer func() { _ = uk.Close() }()
	return errors.Join(uk.SetStringValue("DisplayName", ServiceDisplay), uk.SetStringValue("Publisher", Publisher),
		uk.SetStringValue("DisplayVersion", version), uk.SetStringValue("UninstallString", un),
		uk.SetStringValue("DisplayIcon", exe), uk.SetDWordValue("NoModify", 1), uk.SetDWordValue("NoRepair", 1))
}

// deleteAppKeys Run değeri, Uninstall anahtarı ve servis kaydı (boşsa üst `NoktaDestek` anahtarı da) silinir.
func deleteAppKeys() error {
	var errs []error
	if rk, err := registry.OpenKey(registry.LOCAL_MACHINE, RunKeyPath, registry.SET_VALUE); err == nil {
		if err := rk.DeleteValue(RunValueName); err != nil && !errors.Is(err, registry.ErrNotExist) {
			errs = append(errs, err)
		}
		_ = rk.Close()
	}
	for _, p := range []string{UninstallKey, RegKeyPath} {
		if err := registry.DeleteKey(registry.LOCAL_MACHINE, p); err != nil && !errors.Is(err, registry.ErrNotExist) {
			errs = append(errs, err)
		}
	}
	_ = registry.DeleteKey(registry.LOCAL_MACHINE, parentKeyPath) // P20 değer yazmaz; doluysa silinmez
	return errors.Join(errs...)
}
