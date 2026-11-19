//go:build windows || darwin || linux

package main

import (
	"errors"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/update"
)

// bindingStatus bir kaydın bindings/status sonucu (politika birleştirme girdisi).
type bindingStatus struct {
	key  string
	info *api.BindingInfo
	err  error
}

// errPolicyUnknown bir kaydın politikası okunamadı (ağ, 5xx, hız sınırı): bu dönem karar yok (AC-485 fail-closed).
var errPolicyUnknown = errors.New("kayıt politikası okunamadı")

// mergeBindingPolicies K-P29-7 + K-P29-19 (orkestratör kararı, düzeltme turu 1):
//   - geçerli kayıt: `autoUpdate`, kapalı kazanır; anahtar olay kimliğidir;
//   - 404 BINDING_INVALID: hesaptan düşer;
//   - 426 CLIENT_OUTDATED: istemci asgari sürümün altında ve zaten kilitli → sonuç her durumda `auto` (MIN_AGENT_VERSION
//     yöneticinin güncelleme talebidir; tenant ayarı Kapalı olsa bile). Anahtar kimlik için tutulur;
//   - diğer hata: politika bilinmiyor → errPolicyUnknown (bu dönem karar yok).
func mergeBindingPolicies(rs []bindingStatus) (update.Policy, []string, error) {
	pol, outdated := update.PolicyAuto, false
	var keys []string
	for _, r := range rs {
		var ae *api.Error
		switch {
		case r.err == nil && r.info != nil:
			pol = update.MergePolicy(pol, update.PolicyFromBinding(r.info.AutoUpdate))
			keys = append(keys, r.key)
		case errors.As(r.err, &ae) && ae.Code == "BINDING_INVALID":
		case errors.As(r.err, &ae) && (ae.Code == "CLIENT_OUTDATED" || ae.Status == 426):
			outdated = true
			keys = append(keys, r.key)
		default:
			return "", nil, errPolicyUnknown
		}
	}
	if outdated {
		pol = update.PolicyAuto
	}
	return pol, keys, nil
}
