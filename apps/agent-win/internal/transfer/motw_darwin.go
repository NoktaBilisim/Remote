//go:build darwin

package transfer

// mimari-p28f §5.1 T8: karantina özniteliği yazılamazsa dosya hiçbir türde teslim edilmez; `.part` silinir, sonuç CORRUPT.
const (
	motwRequired   = true
	motwFailStatus = "CORRUPT"
)
