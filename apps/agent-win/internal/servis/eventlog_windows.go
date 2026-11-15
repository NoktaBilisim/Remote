//go:build windows

package servis

import (
	"golang.org/x/sys/windows/svc/eventlog"
)

// EventLog Application günlüğü, kaynak `NoktaDestek` (§5.7). Açılamazsa yazımlar sessizce atlanır (servis çalışmaya
// devam eder; yetkili kayıt sunucu audit'idir — D-P27-5).
type EventLog struct{ l *eventlog.Log }

// OpenEventLog kaynağı açar.
func OpenEventLog() *EventLog {
	l, err := eventlog.Open(EventSource)
	if err != nil {
		return &EventLog{}
	}
	return &EventLog{l: l}
}

// Write olayı yazar.
func (e *EventLog) Write(ev Event) {
	if e == nil || e.l == nil {
		return
	}
	if ev.Warning {
		_ = e.l.Warning(ev.ID, ev.Text)
		return
	}
	_ = e.l.Info(ev.ID, ev.Text)
}

// Close günlüğü kapatır.
func (e *EventLog) Close() {
	if e != nil && e.l != nil {
		_ = e.l.Close()
	}
}

// installEventSource kaynağı (yeniden) kaydeder; önceki yarım kurulumdan kalan kayıt silinir.
func installEventSource() error {
	_ = eventlog.Remove(EventSource)
	return eventlog.InstallAsEventCreate(EventSource, eventlog.Error|eventlog.Warning|eventlog.Info)
}

// removeEventSource kaldırmada.
func removeEventSource() { _ = eventlog.Remove(EventSource) }
