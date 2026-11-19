package update

import (
	"sync"
	"time"
)

// Olay türleri (contracts UPDATE_EVENT_TYPES; `installing` olay değil, yalnız WS `update.state`).
const (
	EventAvailable  = "available"
	EventInstalled  = "installed"
	EventFailed     = "failed"
	EventRolledBack = "rolled_back"
	EventSkipped    = "skipped"
)

// QueueMax olay kuyruğu üst sınırı (K-P29-17, contracts UPDATE_LIMITS.queueMax).
const QueueMax = 20

// eventTimeLayout `at` alanı; zod `z.iso.datetime()` (Z, saniye hassasiyeti).
const eventTimeLayout = "2006-01-02T15:04:05Z"

// Event updateEventSchema (POST update-events gövdesindeki öğe ve WS `update.event` alanları).
type Event struct {
	Type        string `json:"type"`
	Version     string `json:"version"`
	FromVersion string `json:"fromVersion"`
	Reason      Reason `json:"reason,omitempty"`
	At          string `json:"at"`
}

// NewEvent `at` = now (UTC, saniye). Reason yalnız failed/rolled_back/skipped'te dolu olmalı (sunucu refine'ı).
func NewEvent(typ, version, from string, reason Reason, now time.Time) Event {
	return Event{Type: typ, Version: version, FromVersion: from, Reason: reason, At: now.UTC().Format(eventTimeLayout)}
}

// dedupKey "sürüm başına 1" kuralı (AC-487, §14 Diğer): available, failed ve skipped her sürüm için bir kez kuyruğa girer.
// installed / rolled_back her gerçekleşmede gönderilir.
func dedupKey(e Event) string {
	switch e.Type {
	case EventAvailable, EventFailed, EventSkipped:
		return e.Type + "/" + e.Version
	}
	return ""
}

// QueueState kalıcı biçim (servis `durum.json` `queue` + `sent`; taşınabilir istemci bellekte tutar, diske yazmaz — AC-484).
type QueueState struct {
	Events []Event  `json:"queue"`
	Sent   []string `json:"sent"`
}

// Queue gönderilemeyen olayları ≤ QueueMax tutar (taşarsa en eskisi düşer) ve tekilleştirir. Eşzamanlı kullanıma güvenlidir.
type Queue struct {
	mu     sync.Mutex
	events []Event
	sent   []string // tekilleştirme anahtarları, en çok QueueMax (en eskisi düşer)
}

// NewQueue durumdan kuyruk; state sınır dışıysa kırpılır.
func NewQueue(state QueueState) *Queue {
	q := &Queue{}
	for _, e := range state.Events {
		q.push(e)
	}
	for _, k := range state.Sent {
		q.remember(k)
	}
	return q
}

// Add olayı ekler; aynı sürüm için daha önce eklenmiş available/failed/skipped ise false döner.
func (q *Queue) Add(e Event) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	if k := dedupKey(e); k != "" {
		for _, s := range q.sent {
			if s == k {
				return false
			}
		}
		q.remember(k)
	}
	q.push(e)
	return true
}

func (q *Queue) push(e Event) {
	q.events = append(q.events, e)
	if len(q.events) > QueueMax {
		q.events = append([]Event(nil), q.events[len(q.events)-QueueMax:]...)
	}
}

func (q *Queue) remember(k string) {
	q.sent = append(q.sent, k)
	if len(q.sent) > QueueMax {
		q.sent = append([]string(nil), q.sent[len(q.sent)-QueueMax:]...)
	}
}

// Pending gönderilecek olayların kopyası (en çok QueueMax).
func (q *Queue) Pending() []Event {
	q.mu.Lock()
	defer q.mu.Unlock()
	return append([]Event(nil), q.events...)
}

// Ack başarıyla gönderilen olayları çıkarır: her gönderilen olay için kuyruktaki ilk eşit olay silinir. Pending ile Ack
// arasında eklenenler korunur; taşmada zaten düşmüş olanlar yok sayılır.
func (q *Queue) Ack(sent []Event) {
	q.mu.Lock()
	defer q.mu.Unlock()
	for _, s := range sent {
		for i, e := range q.events {
			if e == s {
				q.events = append(q.events[:i:i], q.events[i+1:]...)
				break
			}
		}
	}
}

// State kalıcı biçim kopyası.
func (q *Queue) State() QueueState {
	q.mu.Lock()
	defer q.mu.Unlock()
	return QueueState{Events: append([]Event(nil), q.events...), Sent: append([]string(nil), q.sent...)}
}
