package remember

import (
	"net"
	"net/url"
	"strconv"
	"strings"
)

// CanonicalOrigin G-E10-6 (mimari-e10 §15.5): kayıt anahtarının yalnız kaydı veren sunucuya gönderilmesi için tek
// karşılaştırma biçimi. Yalnız `https`; kullanıcı bilgisi, yol (`/` dışında), sorgu ve parça varsa red. Host küçük
// harfe çevrilir, sondaki nokta silinir; port yoksa 443, baştaki sıfırlar atılır. Sonuç `https://host:port`
// (IPv6 `https://[adres]:port`). Dosyaya yazarken ve gömülü sunucu adresi için aynı fonksiyon kullanılır;
// karşılaştırma dize eşitliğidir.
//
// Sapma (implementation.md P8c-2 S1): `golang.org/x/net/idna` yeni modül (`golang.org/x/text`) gerektirdiği için
// kullanılmaz. Host yalnız ASCII LDH etiketleri (punycode `xn--` dahil) ya da IP adresi olabilir; Unicode (IDN) host
// REDDEDİLİR → kayıt anahtarı hiç kullanılmaz/gönderilmez (fail-closed). Gömülü adres ASCII'dir (build.sh).
func CanonicalOrigin(raw string) (string, bool) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Opaque != "" || (u.Path != "" && u.Path != "/") ||
		u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || strings.Contains(raw, "#") {
		return "", false
	}
	port, ok := canonicalPort(u.Port(), u.Host)
	if !ok {
		return "", false
	}
	host := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
	if ip := net.ParseIP(host); ip != nil {
		if ip.To4() != nil {
			return "https://" + ip.String() + ":" + port, true
		}
		return "https://[" + ip.String() + "]:" + port, true
	}
	if !validHostname(host) {
		return "", false
	}
	return "https://" + host + ":" + port, true
}

// validHostname küçük harfli ASCII LDH: etiket 1..63, `-` ile başlamaz/bitmez, toplam ≤ 253.
func validHostname(h string) bool {
	if h == "" || len(h) > 253 {
		return false
	}
	for _, label := range strings.Split(h, ".") {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for i := 0; i < len(label); i++ {
			c := label[i]
			if (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '-' {
				return false
			}
		}
	}
	return true
}

// canonicalPort boş port → 443; "host:" (boş port, iki nokta var) ve aralık dışı red; baştaki sıfırlar atılır.
func canonicalPort(p, hostport string) (string, bool) {
	if p == "" {
		if strings.HasSuffix(hostport, ":") {
			return "", false
		}
		return "443", true
	}
	n, err := strconv.Atoi(p)
	if err != nil || n < 1 || n > 65535 {
		return "", false
	}
	return strconv.Itoa(n), true
}

// SameRegistration AC-251 (AC-187 eki): yeni kayıt önceki kaydın sürdürülmesi mi? Karşılaştırma (köken, tenant
// kimliği) çiftiyledir; görünen ad yalnız metin içindir. Tenant kimliği istemciye hiç gönderilmez (G-E10-4); onun
// yerine sunucunun kimlikle verdiği karar kullanılır: `binding.issued.renewed` = önceki anahtar (yalnız aynı kökene
// gönderilir) aynı tenant'ın etkin kaydıydı ve yenilendi. Köken farklıysa ya da sunucu yeni kayıt açtıysa (başka
// tenant, iptal edilmiş/geçersiz önceki kayıt) değişim sayılır. Aynı tenant içinde müşteri değişimi ad ile anlaşılır
// (sunucu müşteri kimliği göndermez; AC-187).
func SameRegistration(prev Binding, server string, renewed bool, customerName string) bool {
	return prev.Server == server && renewed && prev.CustomerName == customerName
}
