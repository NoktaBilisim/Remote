//go:build linux

package files

import (
	"bufio"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

// ErrNoDownloads indirme klasörü bulunamadı (dosya teklifleri otomatik reddedilir).
var ErrNoDownloads = errors.New("files: İndirilenler klasörü yok")

// userDirsMax `user-dirs.dirs` okuma üst sınırı (normalde < 1 KB).
const userDirsMax = 64 << 10

// DownloadsDir Linux indirme klasörü (mimari-p28g §2): `~/.config/user-dirs.dirs` içindeki XDG_DOWNLOAD_DIR saf Go ile
// okunur (alt süreç yok; `xdg-user-dir` ile aynı sonuç, Türkçe yerelde `~/İndirilenler`); yoksa ya da geçersizse
// `~/Downloads`, o da yoksa `$HOME`. Her aday bu kullanıcıya ait gerçek dizin olmalıdır (son bileşen sembolik bağ
// değil; macOS DownloadsDir ile aynı kural). XDG_CONFIG_HOME ortam izin listesinde olmadığından `~/.config` sabittir.
func DownloadsDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil || !filepath.IsAbs(home) {
		return "", ErrNoDownloads
	}
	return downloadsIn(home)
}

func downloadsIn(home string) (string, error) {
	var cands []string
	if b, err := readLimited(filepath.Join(home, ".config", "user-dirs.dirs")); err == nil {
		if d, ok := parseUserDirs(b, home); ok {
			cands = append(cands, d)
		}
	}
	for _, d := range append(cands, filepath.Join(home, "Downloads"), home) {
		if ownedDir(d) {
			return d, nil
		}
	}
	return "", ErrNoDownloads
}

func readLimited(p string) ([]byte, error) {
	f, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	b := make([]byte, userDirsMax+1)
	n, _ := f.Read(b)
	if n > userDirsMax {
		return nil, errors.New("user-dirs.dirs çok büyük")
	}
	return b[:n], nil
}

// parseUserDirs xdg-user-dirs biçimi: `XDG_DOWNLOAD_DIR="$HOME/yol"` ya da `XDG_DOWNLOAD_DIR="/mutlak/yol"`; başka biçim
// desteklenmez (dosyanın kendi açıklaması). Değer kabukça kaçışlıdır (`\"`, `\\`, `\$`, "\`"). Başka değişken (`$`),
// göreli yol ve `..` bileşeni reddedilir. Son geçerli satır geçerlidir (kabuk `source` davranışı).
func parseUserDirs(b []byte, home string) (string, bool) {
	out, found := "", false
	sc := bufio.NewScanner(strings.NewReader(string(b)))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		rest, ok := strings.CutPrefix(line, "XDG_DOWNLOAD_DIR")
		if !ok {
			continue
		}
		rest = strings.TrimSpace(rest)
		if rest, ok = strings.CutPrefix(rest, "="); !ok {
			continue
		}
		rest = strings.TrimSpace(rest)
		if len(rest) < 2 || rest[0] != '"' || rest[len(rest)-1] != '"' {
			continue
		}
		v, ok := unescape(rest[1 : len(rest)-1])
		if !ok {
			continue
		}
		if r, rel := strings.CutPrefix(v, "$HOME"); rel {
			if r != "" && r[0] != '/' {
				continue
			}
			v = home + r
		}
		if !filepath.IsAbs(v) || strings.Contains(v, "$") {
			continue
		}
		bad := false
		for _, c := range strings.Split(v, "/") {
			if c == ".." {
				bad = true
			}
		}
		if bad {
			continue
		}
		out, found = filepath.Clean(v), true
	}
	return out, found
}

// unescape kabuk çift tırnak kaçışları; kaçışsız `"` ya da "`" geçersizdir. `$HOME` dışında kaçışsız `$` kalırsa çağıran
// reddeder.
func unescape(s string) (string, bool) {
	var sb strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch c {
		case '\\':
			if i+1 < len(s) && strings.IndexByte("\"\\$`", s[i+1]) >= 0 {
				i++
				if s[i] == '$' {
					return "", false // kaçışlı `$` geçerli ama ad içinde `$` desteklemiyoruz (fail-closed: yedek klasör)
				}
				sb.WriteByte(s[i])
				continue
			}
			sb.WriteByte(c)
		case '"', '`':
			return "", false
		default:
			sb.WriteByte(c)
		}
	}
	return sb.String(), true
}

// ownedDir yol bu kullanıcıya ait gerçek dizin mi (son bileşen sembolik bağ değil).
func ownedDir(p string) bool {
	fi, err := os.Lstat(p)
	if err != nil || !fi.IsDir() {
		return false
	}
	st, ok := fi.Sys().(*syscall.Stat_t)
	return ok && int(st.Uid) == os.Getuid()
}
