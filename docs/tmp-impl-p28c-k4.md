# P28c K4 — devops notu (2026-11-16)

Kaynak: mimari-p28c r2 §6.1, §7, §8, §12 (AC-371), §13 K4; ADR-0035. Yeni env yok, migration yok, yeni bağımlılık yok.

## Değişen dosyalar

- `docs/runbook.md` → yeni §28c (28c.1 yetkiler, 28c.2 audit, 28c.3 hız sınırları, 28c.4 sorun giderme, 28c.5 metrikler,
  28c.6 alarm, 28c.7 Windows elle turu, 28c.8 AC-371 ölçüm prosedürü, 28c.9 staging yayını, 28c.10 geri alma).
- `deploy/ops/remote-watch.sh` → `multi-denied` kontrolü: 37. alan `rs_multi_denied_total` (bütün `type` toplamı; etiketsiz
  `rs_multi_denied_total 0` = P28c işareti, yoksa kontrol yok), örnekler `multi_samples` durum anahtarı (90 dk), 1 sa artışı >
  `WATCH_MULTI_DENIED_MAX` (vars. 20) → uyarı. Davet reddi / üye sayısı için alarm yok (kullanıcı davranışı; tasarımda "üye iptal
  hatası" metriği yok — uydurulmadı), runbook'ta elle bakış.
- `deploy/ops/test-watch.sh` → P28c bölümü (işaret yok/var, tohumsuz iki ardışık koşu ile durum yazımı, eşik sınırı, pencere dışı,
  sayaç sıfırlanması, 90 dk budama, `a[$(…)]` enjeksiyonu), metrik ayrıştırma (etiketli toplam + işaret), mevcut `exp=` dizileri 37.
  alanla güncellendi; **ad eşlemesi**: `ops/metrics.ts`'te hiç `rs_multi_` yoksa UYARI + mimari-p28c'ye karşı denetim; bir tane bile
  varsa betikteki ad birebir olmalı (FAIL).
- `deploy/ops/watch.env.example` → `WATCH_MULTI_DENIED_MAX` açıklaması (watch.env; uygulama env'i değil → `.env.example`/`env.ts`/compose
  değişmez).
- `.github/workflows/agent-win.yml` → "P28c çoklu teknisyen testleri (-v)" adımı (P28e adımından sonra, K6s kilit adımından önce;
  `-run 'P28c'`, signal/dc/rtc/flow/capture/ui/unattended); zorunlu PASS listesi şimdilik dört K0 testi. Etiket kontrol listesine
  "0.17.0 → P28c, migration yok" ve çoklu teknisyen elle turu + AC-371 maddesi. Yeni Action yok; SHA/permissions değişmedi.

## Diğer ajanlara

- **backend-dev (K1):** `apps/server/src/ops/metrics.ts`'e `m.counter("rs_multi_denied_total", …)` **etiketsiz kayıt** (render ilk
  artışa kadar `rs_multi_denied_total 0` yazar → remote-watch işareti), artışta `{type}` etiketi. Tam ad değişirse
  `test-watch.sh` FAIL verir. `rs_multi_invites_total{result}`, `rs_multi_members{role}` adları da tasarımdaki gibi. Rol kapısı log
  satırında "denied" sözcüğü geçerse runbook §28c.6 grep'i çalışır.
- **backend-dev Go (K3):** P28c Go test adlarına `P28c` koyun (ör. `TestAC371P28cLowEncoderMax8FPS`) ve agent-win.yml'deki P28c
  adımının zorunlu listesine ekleyin. Not: yerel linux konteynerinde `-run P28c ./internal/{rtc,flow,ui,unattended}/...` o sırada
  derlenemedi (K3 çalışırken ağaç değişiyordu / Windows'a özgü paketler); CI adımı Windows koşucusunda koşar.
- **test-operatoru (K5):** §28c.7 + §28c.8. Windows QoS (`New-NetQosPolicy … -PolicyStore ActiveStore`) ile şekillendirme
  **denenmedi** (macOS'tan doğrulanamaz); ilk koşuda Görev Yöneticisi "Gönder" ile tavanın uygulandığını doğrulayın, çalışmazsa
  runbook'taki `tc tbf` / pfSense alternatifi.

## Doğrulama (yerel)

- `bash deploy/ops/test-watch.sh` → **SONUÇ: GEÇTİ** (P28c 8 senaryo + 2 ayrıştırma PASS; ad eşlemesi UYARI — K1 henüz kayıtlı değil).
- shellcheck v0.11.0 (`deploy`, `scripts`, `-S warning`) → temiz; actionlint 1.7.8 → temiz.
- `go test -count=1 -v -run P28c ./internal/signal/... ./internal/dc/...` (golang:1.26 konteyner) → dört K0 testi PASS; `GOOS=windows go vet` temiz.
- Prettier: `docs/runbook.md`, `agent-win.yml` temiz (runbook diff'i yalnız ekleme).
- Denenmedi: staging yayını, Windows elle turu, AC-371 ölçümü, QoS şekillendirme.
