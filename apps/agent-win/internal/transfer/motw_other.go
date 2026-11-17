//go:build !darwin

package transfer

// S6-3 (Windows): MOTW yazılamazsa yalnız uyarılı (tehlikeli/çift uzantılı/gizli) adlar teslim edilmez (REJECTED);
// diğerleri MOTWFailed uyarısıyla teslim edilir.
const (
	motwRequired   = false
	motwFailStatus = "REJECTED"
)
