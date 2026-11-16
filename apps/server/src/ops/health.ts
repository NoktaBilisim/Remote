// /health (süreç canlı) ve /ready (DB ping + uygulanmış son migration) — AC-89, AC-88.
// /api dışında olduğu için Caddy bu yolları dışarı açmaz (mimari-api.md "Operasyon").
import type { FastifyInstance } from "fastify";
import { AppError } from "../lib/errors.ts";
import { effectiveClamav } from "../settings/clamav.ts";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // P28b (K-P28b-14): clamd durumu yalnız gövdede; HTTP durumu değişmez, `/ready` clamd'a bakmaz.
  app.get("/health", async () => {
    const f = app.fsrv;
    const configured = (await effectiveClamav(f.clamav).catch(() => null)) !== null;
    return {
      status: "ok",
      clamav: { configured, reachable: f.scanner.up === 1, signatureAgeDays: f.scanner.signatureAgeDays(), stale: f.scanner.stale },
    };
  });

  app.get("/ready", async (req) => {
    let rows: { migration_name: string }[];
    try {
      rows = await app.db.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM _prisma_migrations
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        ORDER BY finished_at DESC LIMIT 1`;
    } catch (err) {
      req.log.warn({ err }, "ready: veritabanına ulaşılamadı");
      throw new AppError("NOT_READY");
    }
    const latest = rows[0];
    if (!latest) throw new AppError("NOT_READY", { message: "Migration uygulanmamış." });
    return { status: "ready", migration: latest.migration_name };
  });
}
