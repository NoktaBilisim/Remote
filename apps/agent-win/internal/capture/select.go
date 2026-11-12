package capture

import "time"

// Method yakalama yöntemi (tanılama logunda da bu adla görünür).
type Method string

const (
	MethodDXGI  Method = "DXGI"  // IDXGIOutput1::DuplicateOutput
	MethodDXGI1 Method = "DXGI1" // IDXGIOutput5::DuplicateOutput1 (BGRA istenir; HDR/gelişmiş renk)
	MethodGDI   Method = "GDI"   // BitBlt(CAPTUREBLT) yedeği, düşük kare hızı
)

// grabber tek monitörün BGRA kaynağı (DXGI çoğaltması veya GDI). Yalnız kaynağın iş parçacığında kullanılır.
type grabber interface {
	// acquire en çok timeoutMs bekler; yeni görüntü/imleç varsa yüzeyi fn'e verir ve true döner. Değişiklik yoksa
	// false, nil. Hata = kaynak kayboldu (çağıran kapatıp aynı yöntemle yeniden açar).
	acquire(timeoutMs uint32, fn func(px []byte, w, h, pitch int) error) (bool, error)
	rotation() Rotation
	cursor() *Cursor // kareye ayrıca bindirilecek imleç; görüntüye zaten çizildiyse nil
	close()
}

// methodOpener yöntem ve açıcısı. Açıcı yeniden açmada da kullanılır.
type methodOpener struct {
	m    Method
	open func() (grabber, error)
}

// attempt denenen yöntemin sonucu (err nil → başarılı).
type attempt struct {
	m   Method
	err *Error
}

// selectMethod yöntemleri sırayla dener: açılan kaynaktan first ilk kareyi beklemeli (başarısızsa kaynağı kapatıp
// tipli hata döner). DXGI1 yalnız DXGI hiç AÇILAMADIYSA veya yüzeyi BGRA dışıysa (DXGI_UNSUPPORTED) denenir (DuplicateOutput1 açılmış çoğaltmanın kare
// vermemesini çözmez); GDI her DXGI başarısızlığında son çaredir. Hepsi başarısızsa ilk denemenin hatası döner
// (en bilgilendirici olan; GDI hatası yalnız logda).
func selectMethod(chain []methodOpener, first func(c methodOpener, g grabber) (grabber, error)) (grabber, int, []attempt, error) {
	var tried []attempt
	dxgiOpenFailed := false
	for i, c := range chain {
		if c.m == MethodDXGI1 && !dxgiOpenFailed {
			continue
		}
		g, err := c.open()
		if err != nil {
			e := asOpenError(c.m, err)
			tried = append(tried, attempt{m: c.m, err: e})
			if c.m == MethodDXGI {
				dxgiOpenFailed = true
			}
			continue
		}
		g, err = first(c, g)
		if e, ok := AsError(err); ok && e.Reason == ReasonDXGIUnsupported {
			// Çoğaltma açıldı ama yüzey işlenemez (BGRA dışı, ör. HDR FP16): "açılamadı" sayılır, DXGI1 (BGRA
			// istenerek) denenir.
			tried = append(tried, attempt{m: c.m, err: e})
			if c.m == MethodDXGI {
				dxgiOpenFailed = true
			}
			continue
		}
		if err != nil {
			tried = append(tried, attempt{m: c.m, err: tag(err, stageFirstFrame, "FirstFrame")})
			continue
		}
		tried = append(tried, attempt{m: c.m})
		return g, i, tried, nil
	}
	if len(tried) == 0 {
		return nil, -1, nil, &Error{Reason: ReasonOther, Op: "selectMethod"}
	}
	return nil, -1, tried, tried[0].err
}

// asOpenError açıcı hatası zaten sınıflandırılmışsa korunur; değilse yönteme göre sınıflandırılır.
func asOpenError(m Method, err error) *Error {
	if e, ok := AsError(err); ok && e.Reason != "" && e.Reason != ReasonOther {
		return e
	}
	if m == MethodGDI {
		return tag(err, stageGDI, "OpenGDI")
	}
	return tag(err, stageDuplicate, "Duplicate")
}

// awaitFirst g'den ilk kare gelene kadar acquire eder. DXGI_UNSUPPORTED (BGRA dışı yüzey) hemen döner. Diğer acquire hatasında (çoğaltma kaybı: ACCESS_LOST, mod değişimi)
// g kapatılıp reopen ile yeniden açılır. deadline geçerse g kapatılır ve FIRST_FRAME_TIMEOUT döner (son hatanın
// işlemi/HRESULT'u korunur). Başarıda (son açılmış) kaynak döner.
func awaitFirst(g grabber, reopen func() (grabber, error), fn func(grabber) func([]byte, int, int, int) error,
	deadline time.Time, now func() time.Time, pause func(time.Duration)) (grabber, error) {
	var last *Error
	for {
		if g != nil {
			ok, err := g.acquire(acquireWaitMs, fn(g))
			if err == nil && ok {
				return g, nil
			}
			if e, ok := AsError(err); ok && e.Reason == ReasonDXGIUnsupported {
				g.close() // BGRA dışı yüzey: yeniden açmak düzeltmez, hemen döner
				return nil, e
			}
			if err != nil {
				last = tag(err, stageDuplicate, "AcquireNextFrame")
				g.close()
				g = nil
			}
		}
		if !now().Before(deadline) {
			if g != nil {
				g.close()
			}
			e := &Error{Reason: ReasonFirstFrameTimeout, Op: "FirstFrame"}
			if last != nil {
				e.Op, e.HR = last.Op, last.HR
			}
			return nil, e
		}
		if g == nil {
			pause(reopenPause)
			ng, err := reopen()
			if err != nil {
				last = tag(err, stageDuplicate, "Duplicate")
				continue
			}
			g = ng
		}
	}
}

const (
	acquireWaitMs = 100 // NextFrame içinde ctx iptali en geç bu süre + kodlama kadar gecikir
	reopenPause   = 100 * time.Millisecond
)
