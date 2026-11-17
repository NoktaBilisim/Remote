package voice

// releaser bırakılabilir bir kaynak: COM arayüzü (Release) ya da çekirdek tanıtıcısı (CloseHandle).
type releaser interface{ release() }

// owner WASAPI yaşam döngüsünün tek sahibidir (D-PD-4): edinilen her kaynak edinme sırasıyla eklenir, releaseAll ters
// sırayla bırakır (önce istemci servisleri, en son aygıt numaralandırıcısı). İkinci releaseAll zararsızdır. Eşzamanlı
// kullanım güvenli değildir; COM iş parçacığında kullanılır.
type owner struct{ items []releaser }

// add r'yi sahipliğe alır; nil yok sayılır.
func (o *owner) add(r releaser) {
	if r != nil {
		o.items = append(o.items, r)
	}
}

// releaseAll tüm kaynakları ters sırayla bırakır ve listeyi boşaltır.
func (o *owner) releaseAll() {
	for i := len(o.items) - 1; i >= 0; i-- {
		o.items[i].release()
		o.items[i] = nil
	}
	o.items = o.items[:0]
}
