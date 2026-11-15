package launch

import "testing"

// TestAC182AC183AC190AC254DecideTable mimari-e10 §8.1 karar tablosunun tüm satırları (+ ağ hatası satırları). Tek ekran
// kararı (2026-11-15): kod akışı dışındaki her satır aynı ana ekrandır; geçerli (veya ağ hatalı) firma dosyası dosya
// satırını ekler.
func TestAC182AC183AC190AC254DecideTable(t *testing.T) {
	const gone = "Bu destek bağlantısının süresi doldu. Teknisyeninizden yeni bir bağlantı isteyin."
	home := func(n string) Decision { return Decision{Screen: ScreenHome, Notice: n} }
	file := Decision{Screen: ScreenHome, FileRow: true}
	cases := []struct {
		row  string
		in   Input
		want Decision
	}{
		{"1 kod geçerli, kayıt yok", Input{File: FileCode, Net: NetOK}, Decision{Screen: ScreenCode}},
		{"1 kod geçerli, kayıt var", Input{File: FileCode, Net: NetOK, Bindings: 1}, Decision{Screen: ScreenCode}},
		{"2 kod geçersiz, kayıt var", Input{File: FileCode, Net: NetGone, Bindings: 1, GoneMessage: gone}, home(NoticeCodeExpired)},
		{"3 kod geçersiz, kayıt yok", Input{File: FileCode, Net: NetGone, GoneMessage: gone}, home(gone)},
		{"kod ağ hatası (mesaj değişmez)", Input{File: FileCode, Net: NetError, Bindings: 1}, Decision{Screen: ScreenCode}},
		{"4 ref geçerli, kayıt yok", Input{File: FileRef, Net: NetOK}, file},
		{"4 ref geçerli, kayıt var", Input{File: FileRef, Net: NetOK, Bindings: 1}, file},
		{"5 ref geçersiz, kayıt var (K22)", Input{File: FileRef, Net: NetGone, Bindings: 1}, home(NoticeRefBinding)},
		{"6 ref geçersiz, kayıt yok", Input{File: FileRef, Net: NetGone}, home(NoticeRefGone)},
		{"ref ağ hatası (engel ekranı Destek iste ile)", Input{File: FileRef, Net: NetError, Bindings: 1}, file},
		{"7 diğer, kayıt var", Input{File: FileOther, Bindings: 1}, home("")},
		{"8 diğer, kayıt yok", Input{File: FileOther}, home("")},
		{"7 diğer, 5 firma", Input{File: FileOther, Bindings: 5}, home("")},
		{"5 ref geçersiz, 3 firma", Input{File: FileRef, Net: NetGone, Bindings: 3}, home(NoticeRefBinding)},
		{"2 kod geçersiz, 2 firma", Input{File: FileCode, Net: NetGone, Bindings: 2, GoneMessage: gone}, home(NoticeCodeExpired)},
	}
	for _, c := range cases {
		if got := Decide(c.in); got != c.want {
			t.Errorf("%s: %+v, beklenen %+v", c.row, got, c.want)
		}
	}
}
