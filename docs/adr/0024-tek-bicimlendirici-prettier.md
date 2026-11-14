# ADR-0024 — Tek biçimlendirici: Prettier (TS/JS/JSON/MD/CSS) + gofmt (Go)
Tarih: 2026-11-14 · Durum: Kabul · İlgili: AC-218

## Bağlam
Depoda biçimlendirici yok; stil ESLint kurallarıyla kısmen tutuluyor, inceleme gürültüsü var. Kriterler: ekip bilgisi, bakım, geri dönüş.

## Karar
- Prettier (MIT; ekipte yaygın, aktif bakım) kök `devDependency`; `.prettierrc` mevcut stile en yakın (printWidth 140, çift tırnak, noktalı virgül).
  ESLint'te stil kuralları kapatılır (`eslint-config-prettier`, MIT). Go: `gofmt -l` CI'da.
- Tek seferlik biçimlendirme commit'i P13c sonrası, açık dal yokken; SHA `.git-blame-ignore-revs`'e. CI `pnpm format:check` ana dalda 0 fark.

## Alternatifler
- Biome: hızlı ama ESLint kural setimizin (özel `eslint-rules`) yerini tutmaz, iki araç olur. - Biçimlendirici yok: AC-218 "yazılı karar" ile mümkün ama gürültü sürer.

## Sonuçlar
- Büyük tek fark commit'i; `git blame` ignore dosyasıyla korunur. Geri dönüş: `format:check` adımını kaldırmak.
