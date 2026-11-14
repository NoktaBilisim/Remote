# ADR-0026 — Dış sistem entegrasyonu yalnız genel webhook + public API (S22): outbox ve HMAC
Tarih: 2026-11-14 · Durum: Kabul (çerçeve; ayrıntı P25) · İlgili: AC-268, AC-269, AC-270, `docs/mimari-e11.md` §10.3

## Bağlam
S22: ITSM'ye (Nokta ITSM dahil) özel entegrasyon yazılmaz. Olaylar kaybolmamalı, alan işlemini yavaşlatmamalı; dış uç SSRF yüzeyidir.

## Karar
- Transactional outbox: olay alan TX'inde `outbox_events`'e yazılır; zamanlayıcı dağıtıcı teslim eder (`webhook_deliveries`, 5 deneme üstel).
- İmza `X-Remote-Signature: t=..,v1=HMAC-SHA256(secret, t.body)`, ±5 dk; sır şifreli, bir kez gösterilir; netguard + DNS sabitleme, yönlendirme yok, 10 sn.
- Yük sürümlü (`v:1`), içerik/sohbet taşımaz. ITSM eşlemesi yalnız `docs/api.md` örneğidir.
- Public API ayrı önek `/api/v1/public-api/*`, `api_keys` (özet, kapsam, son kullanma, iptal), anahtar başına 60/dk, step-up ile üretim.

## Alternatifler
- Alan kodunda doğrudan HTTP çağrısı: kayıp/yavaşlık. - Harici kuyruk (Redis/RabbitMQ): tek instance için gereksiz altyapı (ADR-0005).

## Sonuçlar
- Outbox tablosu temizlik işi ister (30 g). P26 bildirim ve P27 müşteri bildirimleri aynı outbox'ı kullanır (genişleme noktası).
