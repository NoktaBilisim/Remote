//go:build windows

package printing

import (
	"bufio"
	"os"
	"runtime"
)

// İşleyici süreç (mimari-p28 §5.2): aynı ikili `--pdf-isleyici` ile yalnız stdin/stdout borusunu devralarak açılır.
// Pencere, ağ, dosya açma kodu yoktur (boundary_test.go); tek iş parçacığında WinRT MTA.

// RunWorker işleyici ana döngüsü; çağıran önce dllsafe.Harden yapmış olmalıdır. Dönüş süreç çıkış kodudur.
func RunWorker() int {
	runtime.LockOSThread()
	if err := roInit(); err != nil {
		return WorkerExitWinRT
	}
	defer roUninit()
	return serve(bufio.NewReader(os.Stdin), os.Stdout, loadPageDoc)
}

// loadPageDoc loadPDF'i pageDoc'a uyarlar (hatada türlü nil arayüz dönmesin).
func loadPageDoc(data []byte) (pageDoc, error) {
	d, err := loadPDF(data)
	if err != nil {
		return nil, err
	}
	return d, nil
}
