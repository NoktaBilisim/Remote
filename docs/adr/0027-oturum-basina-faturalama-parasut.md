# ADR-0027 — Oturum başına faturalama ve Paraşüt'te taslak fatura (S23)

Tarih: 2026-11-14 · Durum: Kabul (çerçeve; ayrıntı P26) · İlgili: AC-271, AC-272, R33, Projeler/CLAUDE.md §2.4, `docs/mimari-e11.md` §10.2

## Bağlam

S23: tenant'lar aylık faturalanabilir oturum sayısıyla faturalanır; ay sonunda Paraşüt'te taslak fatura. Sayım anonimleştirme/silmeden etkilenmemeli;
tutar uygulamada değil Paraşüt'te tutulur; aynı ay için ikinci fatura oluşmamalı.

## Karar

- `billable_sessions` (oturum ilk ACTIVE olduğunda `INSERT IGNORE`, PII yok, FK yok) → ay kapanınca `usage_monthly` dondurulur (değişmez tetikleyici).
- Fiyat `tenant_billing.price_per_session DECIMAL(12,2)` + `currency`. Float yok.
- Fatura işi durum makinesi + Paraşüt'te `RS-<tenant>-<YYYY-MM>` ile ön arama (çökme sonrası çift fatura önlemi). 0 oturum → fatura yok.
- Paraşüt ayarı **sistem düzeyinde** (Super Admin); client kimlikleri `deploy/.env` (repoya girmez), kullanıcı şifresi ve tokenlar şifreli, test düğmesi, her yazma audit.

## Alternatifler

- Sayımı `support_sessions`'tan anlık sorgulamak: retention/kalıcı silme sayımı değiştirir. - Faturayı doğrudan kesmek (taslak değil): S23 aksine.

## Sonuçlar

- Finansal saklama süresi 10 yıl (VUK; K-E11-5 kullanıcı kararı 2026-11-14); retention işi bu tablolara dokunmaz. Paraşüt API değişikliği riski; uç ve alanlar P26'da apidocs'tan doğrulanır.
