package uicore

import _ "embed"

// P28d (ADR-0036 r3 m.1 c, mimari-p28d §10): gömülü ses kodlayıcısının (libopus.wasm) ve çalışma zamanının (wazero)
// üçüncü taraf bildirimleri; tepsi menüsündeki "Lisanslar" salt okunur penceresinde gösterilir (ShowLicenses). Metinler
// sabit commit'lerden aynen alınmıştır (kaynaklar docs/implementation.md "P28d — K3"); libopus COPYING'in
// internal/voice/libopus-COPYING.txt ile bayt bayt aynı yer aldığı testle sabittir.

//go:embed third_party_notices.txt
var ThirdPartyNotices string
