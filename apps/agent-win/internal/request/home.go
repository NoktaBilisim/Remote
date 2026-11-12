package request

import (
	"context"

	"remote-support/agent-win/internal/remember"
)

// Ana ekran ve bilgisayar kaydı metinleri (contracts `api/bindings.ts`, fixtures/bindings.json `messages` ile aynı).
const (
	MsgBindingInvalid = "Bu bilgisayarın destek kaydı artık geçerli değil. Firmanızdan yeni dosya isteyin ya da teknisyeninizin verdiği kodla bağlanın."
	MsgForgotten      = "Bu bilgisayar unutuldu"
	MsgNoSource       = "Destek istemek için firmanızın gönderdiği dosyayı kullanın veya teknisyeninizin verdiği kodu girin"
	noticeForgetAll   = "Bu bilgisayardaki kayıt silinemedi. Pencereyi kapatıp yeniden deneyin."
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

func (r *runner) homeView() HomeView {
	v := HomeView{Registered: r.registered, Notice: r.homeNotice}
	if r.info != nil {
		v.Tenant, v.Logo, v.AbuseEmail, v.Support = r.info.Tenant.Name, r.logo, r.abuse, true
	} else {
		v.Hint = MsgNoSource // AC-190
	}
	return v
}

// home AC-189: "Destek iste" → form; "Bağlantı kodum var" → 8 hane akışı; "Bu bilgisayarı unut" → AC-186 (ekran
// kalır, "Destek iste" yalnız kaynak hâlâ geçerliyse etkin); kapatma → süreç biter.
func (r *runner) home(ctx context.Context) *Outcome {
	for {
		act := r.d.UI.RequestHome(ctx, r.homeView())
		r.homeNotice = ""
		switch act {
		case HomeSupport:
			if r.info != nil {
				r.homeDone = true
				return nil
			}
		case HomeCode:
			return &Outcome{Kind: OutCodeMode}
		case HomeForget:
			r.forgetComputer(ctx)
		default:
			return &Outcome{Kind: OutClose}
		}
	}
}

// forgetComputer AC-186: dosya (kişisel bilgiler + kayıt) ve boşsa klasör silinir, sunucuya iptal gider (launch).
// İdempotent: dosya yoksa da "Bu bilgisayar unutuldu".
func (r *runner) forgetComputer(ctx context.Context) {
	var err error
	if r.d.ForgetComputer != nil {
		err = r.d.ForgetComputer(ctx)
	}
	r.rem, r.remembered, r.vals, r.forgetWarn = remember.Personal{}, false, Form{}, ""
	r.registered = ""
	if r.d.BindingKey != "" {
		r.d.BindingKey, r.info, r.homeDone = "", nil, false
	}
	r.homeNotice = MsgForgotten
	if err != nil {
		r.homeNotice = noticeForgetAll
	}
}

// bindingInvalid AC-185: kayıt silinir (kişisel bilgiler kalır), kaynaksız ana ekran + metin, "Bağlantı kodum var".
func (r *runner) bindingInvalid() {
	if r.d.OnBindingInvalid != nil {
		r.d.OnBindingInvalid()
	}
	r.d.BindingKey, r.info, r.registered, r.homeDone = "", nil, "", false
	r.homeNotice = MsgBindingInvalid
}
