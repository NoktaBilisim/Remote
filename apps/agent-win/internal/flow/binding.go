package flow

import (
	"context"

	"remote-support/agent-win/internal/remember"
	"remote-support/agent-win/internal/signal"
)

// bindingErrorCodes sunucunun `binding.request` yolunda gönderdiği hata kodları (signaling/binding.ts:
// FORBIDDEN/CONFLICT/RATE_LIMITED/INTERNAL). İstek bekliyorken yalnız bunlar kayıt yanıtı sayılıp yutulur (S5).
var bindingErrorCodes = []string{"FORBIDDEN", "CONFLICT", "RATE_LIMITED", "INTERNAL"}

// onBinding P8c (mimari-protokol §6, mimari-e10 §8.4). Teklif yalnız admit edilmiş misafire gelir (hello sonrası);
// teklif gelmezse hiçbir şey yapılmaz (eski sunucu → geri alma güvenli). Her teklife en çok bir istek; kayıt
// alındıktan sonra yeniden bağlanma teklifleri yok sayılır. Yazma hatası oturumu etkilemez.
func (s *session) onBinding(ctx context.Context, m signal.Inbound) {
	if s.d.Binding == nil {
		return
	}
	switch m := m.(type) {
	case signal.BindingOffer:
		// B-P8c2-2: yalnız hello sonrası (kabul edilmiş, etkin oturum); lobide/yeniden bağlanırken gelen teklif yok sayılır.
		if s.phase != phActive || s.bindingDone || s.bindingPending || s.conn == nil {
			return
		}
		if s.conn.Send(ctx, signal.BindingRequest{T: "binding.request", PreviousKey: s.d.Binding.PreviousKey()}) == nil {
			s.bindingPending = true
		}
	case signal.BindingIssued:
		if !s.bindingPending { // istenmemiş kayıt yazılmaz
			return
		}
		s.bindingPending, s.bindingDone = false, true
		if c := s.d.Binding.Issued(m); c != "" {
			s.bindingChanged = c
		}
	}
}

// finish oturum sonucuna kayıt değişikliği bilgisini ekler (AC-187).
func (s *session) finish(out Outcome) Outcome {
	out.BindingChanged = s.bindingChanged
	return out
}

// rememberNote AC-188: kayıt açıksa karşılama ekranındaki bilgi satırı.
func rememberNote(d Deps, tenant string) string {
	if d.Binding == nil {
		return ""
	}
	return remember.NoticeText(tenant)
}
