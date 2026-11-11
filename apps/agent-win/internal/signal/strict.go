package signal

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"sync"
)

// decodeStrict zod `strictObject` eşdeğeri: anahtarlar BÜYÜK/KÜÇÜK HARF DUYARLI olarak struct json etiketlerinin
// alt kümesi olmalı (encoding/json tek başına harf duyarsız eşler ve bilinmeyeni sessizce atar), `omitempty`
// olmayan her alan mevcut olmalı (null yalnız işaretçi alanda). Ardından normal Unmarshal.
func decodeStrict(raw []byte, dst any) error {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil {
		return fmt.Errorf("json: %w", err)
	}
	spec := specOf(reflect.TypeOf(dst).Elem())
	for k := range obj {
		if _, ok := spec.allowed[k]; !ok {
			return fmt.Errorf("bilinmeyen alan %q", k)
		}
	}
	for _, k := range spec.required {
		if _, ok := obj[k]; !ok {
			return fmt.Errorf("eksik alan %q", k)
		}
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields() // iç içe nesneler (monitör, iceServer) için
	return dec.Decode(dst)
}

type fieldSpec struct {
	allowed  map[string]struct{}
	required []string
}

var specCache sync.Map // reflect.Type → fieldSpec

func specOf(t reflect.Type) fieldSpec {
	if s, ok := specCache.Load(t); ok {
		return s.(fieldSpec)
	}
	s := fieldSpec{allowed: map[string]struct{}{}}
	for i := 0; i < t.NumField(); i++ {
		tag := t.Field(i).Tag.Get("json")
		name, opts, _ := strings.Cut(tag, ",")
		if name == "" || name == "-" {
			continue
		}
		s.allowed[name] = struct{}{}
		if !strings.Contains(opts, "omitempty") {
			s.required = append(s.required, name)
		}
	}
	specCache.Store(t, s)
	return s
}
