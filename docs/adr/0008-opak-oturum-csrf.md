# ADR-0008 — Opak DB oturumu (JWT değil) + double-submit CSRF

Durum: Kabul · Tarih: 2026-11-10

## Bağlam

"Tüm cihazlardan çıkış" ≤ 5 sn (AC-68), pasif tenant'ta oturumların sonlanması (AC-70), boşta 30 dk zaman aşımı.

## Karar

32 bayt rastgele token → `rs_session` çerezi (HttpOnly, Secure, SameSite=Strict); DB'de SHA-256. Her istekte DB doğrulaması (tek indeksli sorgu, 50 oturum ölçeğinde ihmal edilebilir). CSRF: `rs_csrf` çerezi + `X-CSRF-Token` başlığı eşitliği, ayrıca `Origin` kontrolü. NextAuth kullanılmaz (auth Fastify'da; Next yalnız UI).

## Alternatifler

JWT (iptal için blacklist gerekir → aynı DB sorgusu + karmaşıklık); NextAuth (auth'u UI katmanına taşır, Fastify ile çift kaynak).

## Sonuçlar

Basit iptal; ölçek ihtiyacında `auth_sessions` okuması 30 sn önbelleğe alınabilir (≤ 5 sn hedefiyle çelişmemesi için 5 sn TTL).
