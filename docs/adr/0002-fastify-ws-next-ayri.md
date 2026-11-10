# ADR-0002 — API/sinyalizasyon Fastify + ws, UI Next.js; Caddy reverse proxy
Durum: Kabul · Tarih: 2026-11-10
## Bağlam
Next.js route handler'ları uzun ömürlü WS için uygun değil; kullanıcı stack'i Fastify + ws belirledi (V2).
## Karar
- `apps/server`: REST `/api/v1` + WS `/ws/*` aynı Fastify süreci (`ws` `noServer` modu, `server.on("upgrade")` içinde doğrulama, sonra `handleUpgrade`).
- `apps/web`: yalnız UI; veri erişimi API üzerinden. SSR'da `API_INTERNAL_URL` ile çerez iletilir.
- Caddy tek TLS girişi (port 4450): `/api/*`, `/ws/*` → server; diğerleri → web. Aynı origin → CORS yok.
- `@fastify/websocket` yerine doğrudan `ws`: upgrade öncesi Origin/çerez/ticket doğrulaması ve 403 kontrolü açık kalır.
## Alternatifler
Socket.IO (gereksiz protokol katmanı, Go istemcide ek kütüphane); Nginx (Caddy otomatik TLS + basit config; publish sunucusunda nginx varsa devops değiştirebilir — davranış sözleşmesi aynı).
## Sonuçlar
İki Node süreci; web'in DB'ye doğrudan erişimi yok (tek yetki noktası server).
