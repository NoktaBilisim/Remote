package request

import "remote-support/agent-win/internal/remember"

// Ana ekran (launch firma listesi) ve bilgisayar kaydı metinleri (contracts `api/bindings.ts`, fixtures/bindings.json
// `messages` ile aynı).
const (
	MsgBindingInvalid = "Bu bilgisayarın destek kaydı artık geçerli değil. Firmanızdan yeni dosya isteyin ya da teknisyeninizin verdiği kodla bağlanın."
	MsgForgotten      = "Bu bilgisayar unutuldu"
	MsgNoSource       = "Destek istemek için firmanızın gönderdiği dosyayı kullanın veya teknisyeninizin verdiği kodu girin"
)

// msgFirmClosed CUSTOMER_PASSIVE / BINDING_REVOKED (AC-145 kalıbı: genel metin, iç neden gösterilmez).
var msgFirmClosed = Message{"Talebiniz kapatıldı", "Firmanız bu talebi şu an kabul edemiyor. Lütfen firmanızı telefonla arayın."}

// rememberNote AC-188 form satırı; kayıt kapalıyken boş (karşılama ekranıyla aynı kural).
func (r *runner) rememberNote() string {
	if !r.d.BindingEnabled {
		return ""
	}
	return remember.NoticeText(r.info.Tenant.Name)
}

// Label "<firma>[ – <müşteri>]" (AC-182, AC-187). Girdiler Display'den geçmiş olmalı.
func Label(tenant, customer string) string {
	if customer == "" {
		return tenant
	}
	return tenant + " – " + customer
}

// bindingInvalid AC-185: kayıt silinir (kişisel bilgiler kalır); talep biter, ana ekran (firma listesi, launch) metinle
// yeniden gösterilir.
func (r *runner) bindingInvalid() *Outcome {
	if r.d.OnBindingInvalid != nil {
		r.d.OnBindingInvalid()
	}
	return &Outcome{Kind: OutBack, Notice: MsgBindingInvalid}
}
