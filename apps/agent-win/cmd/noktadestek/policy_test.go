//go:build windows || darwin || linux

package main

import (
	"errors"
	"reflect"
	"testing"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/update"
)

func TestAC485AC486MergeBindingPolicies(t *testing.T) {
	off, on := false, true
	ok := func(k string, v *bool) bindingStatus {
		return bindingStatus{key: k, info: &api.BindingInfo{AutoUpdate: v}}
	}
	invalid := bindingStatus{key: "x", err: &api.Error{Status: 404, Code: "BINDING_INVALID"}}
	outdated := bindingStatus{key: "o", err: &api.Error{Status: 426, Code: "CLIENT_OUTDATED"}}
	cases := []struct {
		name string
		in   []bindingStatus
		pol  update.Policy
		keys []string
		err  bool
	}{
		{"kayıt yok", nil, update.PolicyAuto, nil, false},
		{"kapalı kazanır", []bindingStatus{ok("a", &on), ok("b", &off)}, update.PolicyNotify, []string{"a", "b"}, false},
		{"eski sunucu alan yok", []bindingStatus{ok("a", nil)}, update.PolicyAuto, []string{"a"}, false},
		{"geçersiz kayıt düşer", []bindingStatus{invalid, ok("b", &off)}, update.PolicyNotify, []string{"b"}, false},
		{"426 tek kayıt → auto", []bindingStatus{outdated}, update.PolicyAuto, []string{"o"}, false},
		{"426 + kapalı tenant → auto (K-P29-19)", []bindingStatus{ok("b", &off), outdated}, update.PolicyAuto, []string{"b", "o"}, false},
		{"5xx → karar yok", []bindingStatus{ok("a", &on), {key: "c", err: &api.Error{Status: 503}}}, "", nil, true},
		{"ağ hatası → karar yok", []bindingStatus{{key: "c", err: errors.New("ağ")}}, "", nil, true},
	}
	for _, c := range cases {
		pol, keys, err := mergeBindingPolicies(c.in)
		if (err != nil) != c.err || pol != c.pol || !reflect.DeepEqual(keys, c.keys) {
			t.Errorf("%s: %q %v %v", c.name, pol, keys, err)
		}
	}
}
