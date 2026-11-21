# Remote Support — proje kuralları

Ortak standartlar: `/Users/mennan/Projeler/CLAUDE.md`, `~/.claude/checklists/kalite-standartlari.md`.
Bu dosya onları yalnız daraltır. Tasarım: `docs/mimari.md` (+ `mimari-api.md`, `mimari-protokol.md`),
UI: `DESIGN.md`. Repo **2026-11-21'den beri private** (kullanıcı kararı; öncesinde 11 gün public/Apache-2.0 kaldı): yine de gizli bilgi asla repoya girmez (CI gitleaks).

## Paket kuralları (mimari §10.1 — bağlayıcı)

- İş P1..P13 dikey paketlerle yürür; sıra `dba → (backend ‖ frontend ‖ devops) → (qa ‖ güvenlik) → düzeltme → test-operatoru`.
- Önceki paket qa GEÇTİ + güvenlik Kritik/Yüksek 0 olmadan sonrakine geçilmez.
- Yalnız paketin AC'leri kodlanır; spekülatif soyutlama, kullanılmayan kod/bileşen yok.
- Yeni bağımlılık mimari §10.4 dışındaysa `docs/implementation.md`'de gerekçelenir. AGPL/GPL yasak.
- Ortak altyapı (auth, tenant guard, yetki, audit, hata zarfı, logger) P1'de bir kez kurulur; kopyalanmaz.
- Prod açılışı P10 (2FA) sonrası; öncesi yalnız staging (185.126.217.99:4450).

## Dizin yapısı

`apps/server` (Fastify + ws + Prisma, `node src/server.ts`), `apps/web` (Next.js), `packages/contracts`
(zod, permissions, errors), `apps/agent-win` (Go, P6), `deploy/` (compose, Caddyfile, mysql init),
`.github/` (CI, Dependabot), `docs/` (gereksinim, mimari, runbook, raporlar).

## Komutlar (pnpm 9, Node 22)

| İş                | Komut                                                                    |
| ----------------- | ------------------------------------------------------------------------ |
| Kurulum           | `pnpm install --frozen-lockfile && pnpm db:generate`                     |
| Lint / tip / test | `pnpm -r run lint` · `pnpm -r run typecheck` · `pnpm -r run test`        |
| Web e2e           | `pnpm --filter @remote/web e2e`                                          |
| Migration / seed  | `pnpm db:migrate` (MIGRATE_DATABASE_URL) · `pnpm db:seed` (DATABASE_URL) |
| Yığın             | `cd deploy && docker compose up -d` (ayrıntı `docs/runbook.md`)          |

## Değişmez kurallar

- DB: `migrator` yalnız `migrate` servisinde; server yalnız `app` kullanıcısı. Yeni tablo → `prisma/sql/grants.sql`.
- Yeni env değişkeni → `.env.example` (boş) + `env.ts` + `deploy/docker-compose.yml` ilgili servis + runbook.
- GitHub Action'lar commit SHA ile sabitlenir; `permissions` en az.
- Caddy logunda sorgu dizesi, çerez, `Sec-WebSocket-Protocol` yazılmaz (G-10); CSP'yi uygulama üretir.
- Commit/push yalnız kullanıcı isteyince.
