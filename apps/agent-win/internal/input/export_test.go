package input

// Yalnız testlerin okuduğu sayaçlar (PT-K7: üretim kodunda okuyucusu yok; sayımlar applier.go/scope.go'da sürer).

// Limited hız sınırı nedeniyle düşen mesaj sayısı (S7-8).
func (a *Applier) Limited() uint64 { return a.limited.Load() }

// ScopeDropped pencere kapsamı nedeniyle düşen olay sayısı.
func (a *Applier) ScopeDropped() uint64 { return a.scopeDropped.Load() }
