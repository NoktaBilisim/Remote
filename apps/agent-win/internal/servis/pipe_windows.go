//go:build windows

package servis

import (
	"bytes"
	"context"
	"errors"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Adlandırılmış boru sunucusu (mimari-p27 §5.4, r2 O-P27-1/K-P27-19; AC-295, AC-338). İlk örnek
// `FILE_FLAG_FIRST_PIPE_INSTANCE` ile açılır: ad önceden alınmışsa (squatting) boru sunulmaz, olay 1004
// `pipe_squatted`. En çok 4 örnek, uzak istemci reddi, istek 5 sn'de tamamlanmalı. DACL: NETWORK ve ANONYMOUS LOGON
// ret; SYSTEM/Administrators tam; INTERACTIVE yalnız okuma/yazma verisi — FILE_APPEND_DATA (= FILE_CREATE_PIPE_INSTANCE)
// verilmez, standart kullanıcı ek örnek açıp istemcileri karşılayamaz. Olay 1003'teki kullanıcı adı mesajdan değil
// istemci sürecinin jetonundan alınır.
const pipeSDDL = "D:P(D;;GA;;;NU)(D;;GA;;;AN)(A;;GA;;;SY)(A;;GA;;;BA)(A;;0x120083;;;IU)"

// ErrPipeSquatted boru adı başka süreçte.
var ErrPipeSquatted = errors.New("servis: boru adı önceden alınmış")

// PipeServer boru sunucusu.
type PipeServer struct {
	Handler PipeHandler
	Events  EventSink
}

// Serve bağlam bitene kadar istemcileri karşılar.
func (s *PipeServer) Serve(ctx context.Context) error {
	sd, err := windows.SecurityDescriptorFromString(pipeSDDL)
	if err != nil {
		return err
	}
	sa := &windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), SecurityDescriptor: sd}
	first := true
	for ctx.Err() == nil {
		h, err := createPipeInstance(sa, first)
		if first && err != nil {
			s.Events.Write(EvReject(ReasonPipeSquatted, ""))
			return errors.Join(ErrPipeSquatted, err)
		}
		if errors.Is(err, windows.ERROR_PIPE_BUSY) { // 4 örnek dolu: biri bitene kadar bekle
			if !sleepCtx(ctx, 200*time.Millisecond) {
				break
			}
			continue
		}
		if err != nil {
			return err
		}
		first = false
		if err := connectPipe(ctx, h); err != nil {
			_ = windows.CloseHandle(h)
			continue
		}
		go s.serveClient(h)
	}
	return ctx.Err()
}

func createPipeInstance(sa *windows.SecurityAttributes, first bool) (windows.Handle, error) {
	name, err := windows.UTF16PtrFromString(PipeName)
	if err != nil {
		return windows.InvalidHandle, err
	}
	open := uint32(windows.PIPE_ACCESS_DUPLEX | windows.FILE_FLAG_OVERLAPPED)
	if first {
		open |= windows.FILE_FLAG_FIRST_PIPE_INSTANCE
	}
	mode := uint32(windows.PIPE_TYPE_BYTE | windows.PIPE_READMODE_BYTE | windows.PIPE_WAIT | windows.PIPE_REJECT_REMOTE_CLIENTS)
	return windows.CreateNamedPipe(name, open, mode, PipeMaxInstances, MaxPipeLine, MaxPipeLine, 0, sa)
}

// connectPipe istemciyi bekler (bağlam iptal edilebilir).
func connectPipe(ctx context.Context, h windows.Handle) error {
	ov, done, err := newOverlapped()
	if err != nil {
		return err
	}
	defer done()
	err = windows.ConnectNamedPipe(h, ov)
	if errors.Is(err, windows.ERROR_PIPE_CONNECTED) {
		return nil
	}
	_, err = finishIO(ctx, h, ov, err, 0)
	return err
}

// serveClient tek istek/yanıt; okuma 5 sn ile sınırlı.
func (s *PipeServer) serveClient(h windows.Handle) {
	defer func() {
		_ = windows.DisconnectNamedPipe(h)
		_ = windows.CloseHandle(h)
	}()
	ctx, cancel := context.WithTimeout(context.Background(), PipeReadTimeout*time.Second)
	defer cancel()
	line, err := readLine(ctx, h)
	if err != nil {
		return
	}
	user, elevated := pipeClient(h)
	resp := HandlePipe(s.Handler, line, user, elevated)
	out := EncodePipeResponse(resp)
	ov, done, err := newOverlapped()
	if err != nil {
		return
	}
	defer done()
	var n uint32
	werr := windows.WriteFile(h, out, &n, ov)
	_, _ = finishIO(ctx, h, ov, werr, 0)
	_ = windows.FlushFileBuffers(h)
}

// readLine `\n`'e ya da MaxPipeLine+1 bayta kadar okur.
func readLine(ctx context.Context, h windows.Handle) ([]byte, error) {
	buf := make([]byte, 0, MaxPipeLine+1)
	chunk := make([]byte, MaxPipeLine+1)
	for len(buf) <= MaxPipeLine {
		ov, done, err := newOverlapped()
		if err != nil {
			return nil, err
		}
		var n uint32
		rerr := windows.ReadFile(h, chunk[:MaxPipeLine+1-len(buf)], &n, ov)
		n, err = finishIO(ctx, h, ov, rerr, n)
		done()
		if err != nil && !errors.Is(err, windows.ERROR_MORE_DATA) {
			return nil, err
		}
		buf = append(buf, chunk[:n]...)
		if i := bytes.IndexByte(buf, '\n'); i >= 0 {
			return buf[:i+1], nil
		}
		if n == 0 {
			return nil, errors.New("servis: boş okuma")
		}
	}
	return nil, ErrPipeFormat
}

func newOverlapped() (*windows.Overlapped, func(), error) {
	ev, err := windows.CreateEvent(nil, 1, 0, nil)
	if err != nil {
		return nil, nil, err
	}
	return &windows.Overlapped{HEvent: ev}, func() { _ = windows.CloseHandle(ev) }, nil
}

// finishIO bekleyen G/Ç'yi bağlam bitene kadar bekler; bağlam biterse G/Ç iptal edilir.
func finishIO(ctx context.Context, h windows.Handle, ov *windows.Overlapped, err error, n uint32) (uint32, error) {
	if err == nil {
		return n, nil
	}
	if !errors.Is(err, windows.ERROR_IO_PENDING) {
		return 0, err
	}
	if !waitEvent(ctx, ov.HEvent) {
		_ = windows.CancelIoEx(h, ov)
		_ = windows.GetOverlappedResult(h, ov, &n, true)
		return 0, context.Canceled
	}
	if err := windows.GetOverlappedResult(h, ov, &n, false); err != nil {
		return n, err
	}
	return n, nil
}

// pipeClient istemci sürecinin hesap adı (DOMAIN\kullanıcı) ve yükseltilmiş olup olmadığı; okunamazsa ("", false).
func pipeClient(h windows.Handle) (string, bool) {
	var pid uint32
	if windows.GetNamedPipeClientProcessId(h, &pid) != nil {
		return "", false
	}
	ph, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return "", false
	}
	defer func() { _ = windows.CloseHandle(ph) }()
	var tok windows.Token
	if windows.OpenProcessToken(ph, windows.TOKEN_QUERY, &tok) != nil {
		return "", false
	}
	defer tok.Close()
	u, err := tok.GetTokenUser()
	if err != nil {
		return "", tok.IsElevated()
	}
	acct, dom, _, err := u.User.Sid.LookupAccount("")
	if err != nil {
		return u.User.Sid.String(), tok.IsElevated()
	}
	return dom + `\` + acct, tok.IsElevated()
}

func sleepCtx(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}
