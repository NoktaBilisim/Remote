//go:build linux

package transfer

// mimari-p28g §5.1 T8: Linux'ta MOTW karşılığı yoktur (GNOME xattr denetlemez); tek koruma alınan dosyanın yürütme
// bitinin olmamasıdır (files.ClearExec). Bu garanti edilemezse (ör. fmask'lı vfat/exfat birimde biti söküp atamayız)
// dosya hiçbir türde teslim edilmez: uzantısız ELF/betik de çalıştırılabilir olduğundan "yalnız tehlikeli tür" ayrımı
// (Windows S6-3) burada yetmez. macOS ile aynı fail-closed davranış; `.part` silinir, sonuç CORRUPT.
const (
	motwRequired   = true
	motwFailStatus = "CORRUPT"
)
