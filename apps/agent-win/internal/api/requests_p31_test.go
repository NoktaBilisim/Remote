package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"
)

// TestAC511RequestClientOSOnlyMac P31 AC-511 + §14 D-1: talep gövdesinin `clientOs`'u yalnız macOS'ta "macos"; Windows,
// Linux ve bilinmeyen platform alanı göndermez (sunucu şeması `linux`'u 400 ile reddeder, S-P31-7).
func TestAC511RequestClientOSOnlyMac(t *testing.T) {
	for goos, want := range map[string]string{"darwin": "macos", "windows": "", "linux": "", "freebsd": "", "": ""} {
		if got := requestClientOS(goos); got != want {
			t.Errorf("requestClientOS(%q) = %q, beklenen %q", goos, got, want)
		}
	}
}

// TestAC511WindowsRequestBodyUnchanged P31 AC-511/AC-522: ClientOS boşken gövde P31 öncesiyle bayt bayt aynı (alan
// yok); doluyken yalnız `"clientOs":"macos"` eklenir.
func TestAC511WindowsRequestBodyUnchanged(t *testing.T) {
	body := CreateRequestBody{Ref: "abcdefghijk23456", ClientInstanceID: "i", ClientVersion: "0.24.0", CustomerName: "Ayşe",
		Phone: "+905551112233", Description: "Yazıcı çalışmıyor", ConsentTextID: "c1", ConsentAccepted: true}
	b, _ := json.Marshal(body)
	const before = `{"ref":"abcdefghijk23456","clientInstanceId":"i","clientVersion":"0.24.0","customerName":"Ayşe",` +
		`"phone":"+905551112233","description":"Yazıcı çalışmıyor","consentTextId":"c1","consentAccepted":true}`
	if string(b) != before {
		t.Fatalf("Windows gövdesi değişti: %s", b)
	}
	body.ClientOS = "macos"
	b, _ = json.Marshal(body)
	if string(b) != strings.TrimSuffix(before, "}")+`,"clientOs":"macos"}` {
		t.Fatalf("macOS gövdesi: %s", b)
	}
}

// TestAC511CreateRequestSendsPlatformClientOS P31 AC-511: CreateRequest gövdeyi çalışan platformdan doldurur (çağıranın
// verdiği değer yok sayılır); bu testin koştuğu platformda beklenen requestClientOS(runtime.GOOS).
func TestAC511CreateRequestSendsPlatformClientOS(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		got, has := body["clientOs"]
		if want := requestClientOS(runtime.GOOS); (want == "" && has) || (want != "" && got != want) {
			t.Errorf("clientOs %v (gövde %s)", got, raw)
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"requestId":"r","requestSecret":"s","requestCode":"123456","expiresAt":"2026-11-20T12:00:00.000Z","position":1}`))
	}))
	defer srv.Close()
	if _, err := trusted(t, srv).CreateRequest(context.Background(), CreateRequestBody{Ref: "abcdefghijk23456",
		ConsentAccepted: true, ClientOS: "linux"}); err != nil {
		t.Fatal(err)
	}
}
