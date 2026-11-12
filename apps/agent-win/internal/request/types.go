package request

import (
	"context"
	"image"
	"time"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/remember"
)

// API public talep uçları (internal/api.Client).
type API interface {
	TenantInfo(ctx context.Context, ref string) (*api.TenantRequestInfo, error)
	// BindingStatus P8c (AC-182, 185): kayıt modunda firma bilgisi; 404 BINDING_INVALID tek tip yanıt.
	BindingStatus(ctx context.Context, key string) (*api.BindingInfo, error)
	CreateRequest(ctx context.Context, body api.CreateRequestBody) (*api.CreateRequestResult, error)
	CancelRequest(ctx context.Context, secret string) error
}

// Conn `/ws/request` soketi (WSConn).
type Conn interface {
	Read(ctx context.Context) (Inbound, error)
	Send(ctx context.Context, m Outbound) error
	Close(normal bool) error
}

// Remember hatırlama dosyasının kişisel bölümü (remember.Store, format v2); nil olabilir (dosya klasörü bulunamadı →
// kutucuk yine çalışır, yazmaz). "Bilgilerimi unut" yalnız kişisel bilgileri siler, kaydı korur (AC-186).
type Remember interface {
	LoadPersonal() (remember.Personal, bool)
	SavePersonal(p remember.Personal) error
	ClearPersonal() error
}

// Message başlık + açıklama.
type Message struct{ Title, Body string }

// Problem form öncesi/yerine gösterilen engel ekranı (ağ/TLS hatası, geçersiz dosya, eski sürüm).
type Problem struct {
	Message
	Retry    bool // "Tekrar dene"
	CodeMode bool // "Bağlantı kodum var" (AC-189)
	Download bool // "Yeni sürümü indir" (yalnız DownloadURL)
}

// ProblemAction engel ekranı kararı.
type ProblemAction int

const (
	ProblemClose ProblemAction = iota
	ProblemRetry
	ProblemCodeMode
	ProblemDownload
)

// FormView firma penceresi + form (AC-133, 134, 135, 136).
type FormView struct {
	Tenant         string
	Logo           image.Image // nil → sistem logosu
	ConsentVersion int
	ConsentBody    string
	AbuseEmail     string // boşsa "Kötüye kullanımı bildir" gizli
	WaitMinutes    int
	Values         Form
	Errors         map[string]string // alan → hata metni
	Focus          string            // odaklanacak alan (hata varsa ilk hatalı alan)
	Notice         string
	Remembered     bool // "Bu bilgiler size ait değilse: Bilgilerimi unut" ipucu
	// RememberNote AC-188 bilgi satırı (KVKK onayının üstünde).
	RememberNote string
}

// HomeView ana ekran (AC-182, 183, 189, 190; mimari-e10 §8.2). Tenant boşsa kaynaksız ekrandır (satır 3/8).
type HomeView struct {
	Tenant     string
	Logo       image.Image // nil → sistem logosu
	Registered string      // "<firma>[ – <müşteri>]"; doluysa "Bu bilgisayar … için kayıtlı"
	Support    bool        // "Destek iste" etkin; değilse pasif + Hint (AC-190)
	Hint       string
	Notice     string // bilgi satırı: süre doldu / dosya geçersiz / kayıt geçersiz (AC-185) / unutuldu (AC-186)
	AbuseEmail string // boşsa "Kötüye kullanımı bildir" gizli
}

// HomeAction ana ekran kararı. Tab sırası: Destek iste → Bağlantı kodum var → Bu bilgisayarı unut → Kötüye kullanımı
// bildir (AC-189).
type HomeAction int

const (
	HomeClose HomeAction = iota
	HomeSupport
	HomeCode
	HomeForget
)

// FormAction form kararı.
type FormAction int

const (
	FormClose FormAction = iota
	FormSubmit
	FormCodeMode
	FormForget
)

// WaitView bekleme ekranı (AC-139).
type WaitView struct {
	Tenant   string
	Logo     image.Image
	Code     string // 6 hane
	Position int    // 0 = henüz bilinmiyor
	Elapsed  time.Duration
	Notice   string
	// Warning kalıcı uyarı (QA-P8b2-2: hatırlama dosyası silinemedi); Notice'ten bağımsız, yeniden bağlanmada silinmez.
	Warning string
}

// AcceptView "<Teknisyen> bağlanmak istiyor" onay ekranı (AC-154, §13.3).
type AcceptView struct {
	Tenant         string
	Logo           image.Image
	TechName       string
	TechVerifyCode string
	RequestCode    string
	Remaining      time.Duration
}

// ClosedView talep kapandı ekranı.
type ClosedView struct {
	Message
	FirmMessage string // REJECTED: "Firmanızın mesajı:" altında düz metin (AC-157)
	Recreate    bool   // "Yeniden talep oluştur" (form dolu, AC-142)
}

// ClosedAction kapanış ekranı kararı.
type ClosedAction int

const (
	ClosedClose ClosedAction = iota
	ClosedRecreate
)

// UI talep modunun arayüzü (Win32: internal/ui). Engelleyen çağrılar karar dönene kadar bekler; diğerleri hemen döner.
// Bekleme/onay ekranındaki kullanıcı eylemleri Deps.Events'ten gelir.
type UI interface {
	// RequestHome ana ekranı gösterir ve bir karar bekler (pencere karar verilince kapanır).
	RequestHome(ctx context.Context, v HomeView) HomeAction
	RequestProblem(ctx context.Context, p Problem) ProblemAction
	// RequestForm pencere yoksa açar, varsa günceller (girilen değerler korunur) ve bir karar bekler.
	RequestForm(ctx context.Context, v FormView) (FormAction, Form)
	RequestFormBusy(notice string) // form açık kalır, düğmeler devre dışı
	RequestFormClose()
	RequestWaiting(v WaitView) // bekleme penceresini açar/günceller
	RequestAccepted(v AcceptView)
	RequestAcceptedTick(remaining time.Duration)
	RequestWaitClose() // bekleme penceresi + onay diyaloğu kapanır
	RequestClosed(ctx context.Context, v ClosedView) ClosedAction
	OpenURL(u string)
}

// OutcomeKind talep modunun sonucu.
type OutcomeKind int

const (
	OutClose    OutcomeKind = iota // pencere kapatıldı / bitti → süreç sonlanır (AC-163)
	OutCodeMode                    // "Bağlantı kodum var" → 8 hane akışı (AC-162, AC-189)
	OutShare                       // "Ekranımı paylaş" → flow.RunTicket
)

// Outcome Run sonucu.
type Outcome struct {
	Kind     OutcomeKind
	Ticket   string
	TechName string
	// Release `/ws/request`'i bırakır (bkz. ReleaseKind). Bir kez çalışır; sonraki çağrılar etkisizdir.
	Release func(ReleaseKind)
}

// ReleaseKind `/ws/guest` sonucunun `/ws/request` kapanışına çevirisi.
type ReleaseKind int

const (
	ReleaseAdmitted  ReleaseKind = iota // hello geldi → 1000 (yok sayılır)
	ReleaseAbandoned                    // hello'dan önce müşteri vazgeçti → 1000 / REST iptal (customer_declined)
	ReleaseFailed                       // hello'dan önce bağlantı hatası → 1001 (CONNECT_FAILED, connect_timeout)
)
