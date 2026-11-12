package request

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fxCase struct {
	In    string  `json:"in"`
	Out   *string `json:"out"`
	Valid *bool   `json:"valid"`
}

func loadFixture(t *testing.T, name string, dst any) {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", name))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, dst); err != nil {
		t.Fatal(err)
	}
}

func want(c fxCase) string {
	if c.Out == nil {
		return "<geçersiz>"
	}
	return *c.Out
}

// TestAC134FormMatchesContractsFixture sunucu zod şemalarıyla aynı sonuç (ortak fixture).
func TestAC134FormMatchesContractsFixture(t *testing.T) {
	var fx struct {
		Phone, CustomerName, Description, Email []fxCase
	}
	loadFixture(t, "request-form.json", &fx)
	if len(fx.Phone) == 0 || len(fx.CustomerName) == 0 || len(fx.Description) == 0 || len(fx.Email) == 0 {
		t.Fatal("fixture boş")
	}
	for _, c := range fx.Phone {
		got, ok := NormalizePhone(c.In)
		if ok != (c.Out != nil) || (ok && got != *c.Out) {
			t.Errorf("phone %q: got (%q,%v) want %s", c.In, got, ok, want(c))
		}
	}
	for _, c := range fx.CustomerName {
		got, msg := CustomerName(c.In)
		if (msg == "") != (c.Out != nil) || (msg == "" && got != *c.Out) {
			t.Errorf("name %q: got (%q,%q) want %s", c.In, got, msg, want(c))
		}
	}
	for _, c := range fx.Description {
		got, msg := Description(c.In)
		if (msg == "") != (c.Out != nil) || (msg == "" && got != *c.Out) {
			t.Errorf("description %q: got (%q,%q) want %s", c.In, got, msg, want(c))
		}
	}
	for _, c := range fx.Email {
		got, msg := Email(c.In)
		valid := c.Valid == nil || *c.Valid
		if (msg == "") != valid || (c.Out != nil && got != *c.Out) || (c.Out == nil && got != "") {
			t.Errorf("email %q: got (%q,%q) want %s valid=%v", c.In, got, msg, want(c), valid)
		}
	}
}

func TestAC134ValidateFieldErrorsAndOrder(t *testing.T) {
	_, errs := Validate(Form{Name: "A", Phone: "123", Email: "x@", Description: "kısa"})
	for _, k := range FieldOrder {
		if errs[k] == "" {
			t.Errorf("%s hatası bekleniyordu", k)
		}
	}
	v, errs := Validate(Form{Name: " Ayşe Yılmaz ", Phone: "0532 123 45 67", Description: "Yazıcı\r\nçalışmıyor  acil", Consent: true})
	if len(errs) != 0 || v.Name != "Ayşe Yılmaz" || v.Phone != "+905321234567" || v.Email != "" || v.Description != "Yazıcı çalışmıyor acil" {
		t.Fatalf("%+v %v", v, errs)
	}
}

func TestAC134BoundaryLengths(t *testing.T) {
	if _, msg := CustomerName(strings.Repeat("ş", 80)); msg != "" {
		t.Error("80 kod noktası geçerli olmalı")
	}
	if _, msg := Description(strings.Repeat("a", 500)); msg != "" {
		t.Error("500 geçerli olmalı")
	}
	if _, msg := Description(strings.Repeat("a", 501)); msg == "" {
		t.Error("501 geçersiz olmalı")
	}
	if _, msg := Description(strings.Repeat(" ", 2001) + "0123456789"); msg == "" {
		t.Error("ham 2000 üstü reddedilmeli (zod max)")
	}
	if _, msg := Description("satır ayırıcı metin"); msg != "" {
		t.Error("JS \\s kümesindeki U+2028 boşluğa çevrilmeli")
	}
	if _, msg := Email(strings.Repeat("a", 250) + "@b.co"); msg == "" {
		t.Error("254 üstü e-posta reddedilmeli")
	}
}
