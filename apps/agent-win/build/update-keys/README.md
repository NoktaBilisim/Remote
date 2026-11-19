# Güncelleme açık anahtarları (P29, ADR-0040)

Bu klasördeki `prod.pub` ve `staging.pub` dosyaları, ilgili ortamın istemci ikililerine derlemede gömülen Ed25519 **açık**
anahtarlarıdır (`build/update-ldflags.sh`). Gizli değildirler.

- Biçim: satır başına ya da virgülle ayrılmış anahtar (base64url, dolgusuz, 43 karakter; `update-sign keygen` çıktısındaki `PUBLIC_KEY`). En çok 2 anahtar bulunur: önce etkin, sonra yedek.
  `#` ile başlayan satırlar ve boş satırlar yok sayılır.
- Dosya yoksa ikili **güncelleyici kapalı** derlenir.
- Üretim, rotasyon ve sızıntı adımları: `docs/runbook.md` §31.2–§31.3.
- Özel tohum bu klasöre ve repoya **asla** girmez.
