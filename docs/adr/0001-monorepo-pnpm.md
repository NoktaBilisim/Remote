# ADR-0001 — pnpm workspaces monorepo
Durum: Kabul · Tarih: 2026-11-10
## Bağlam
Server (Fastify), web (Next.js), Go istemci ve ortak sözleşme (zod) tek repoda; sözleşme sapması en büyük entegrasyon riski.
## Karar
pnpm workspaces: `apps/server`, `apps/web`, `packages/contracts`. `apps/agent-win` aynı repoda ama ayrı `go.mod` (pnpm dışı). Turborepo/Nx **yok**; `pnpm -r` betikleri yeter.
## Alternatifler
- Ayrı repolar: sözleşme senkronu zor. - Turborepo/Nx: 3 paket için gereksiz katman (geliştirme kuralı 3). - npm workspaces: pnpm daha hızlı, katı bağımlılık izolasyonu.
## Sonuçlar
Contracts değişikliği tek PR'da server+web'i etkiler. Build önbelleği gerekirse Turborepo sonradan `turbo.json` ile eklenebilir (geri dönüşlü).
