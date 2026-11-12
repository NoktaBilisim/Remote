// P11 uçları. /api/v1/admin/settings/{mysql,turn} — yalnız SUPER_ADMIN (rol kontrolü); /api/v1/settings/consent-text —
// settings.view/edit, etkin tenant. Sıra: requireAuth → rol/yetki → kapsam → zod → servis.
import { consentTextInputSchema, mysqlSettingsInputSchema, turnSettingsInputSchema, type ConsentTextSaveResponse, type ConsentTextSettings, type MysqlSettingsSaveResponse, type MysqlSettingsView, type MysqlTestResponse, type TurnSettingsView } from "@remote/contracts/api/system-settings";
import type { FastifyInstance } from "fastify";
import { auditContext } from "../audit/service.ts";
import { authOf, requireAuth, requirePerm, requireSuperAdmin, tenantScope } from "../auth/guards.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import { getConsentSettings, saveConsentText } from "./consent.ts";
import { deleteTurnSettings, effectiveTurn, getMysqlSettings, getTurnSettings, saveMysqlSettings, saveTurnSettings, testMysql, type SystemDeps } from "./system.ts";
import type { ProbeResult, ProbeTarget } from "./mysql-probe.ts";

const noStore = async (_req: unknown, reply: { header(k: string, v: string): unknown }) => {
  void reply.header("Cache-Control", "no-store");
};

export function systemDeps(app: FastifyInstance): SystemDeps {
  return {
    db: app.db,
    secrets: app.secrets,
    log: app.log,
    databaseUrl: app.env.DATABASE_URL,
    turnEnv: { urls: app.env.turnUrls, secret: app.env.TURN_SECRET, ttlMin: app.env.TURN_CRED_TTL_MIN },
  };
}

/** Panel TURN kaydını odalara uygular (açılışta ve her değişiklikte; tek instance — ADR-0005). */
export async function applyTurn(app: FastifyInstance): Promise<void> {
  app.rooms.turn = await effectiveTurn(systemDeps(app));
}

export async function adminSettingsRoutes(app: FastifyInstance, opts: { mysqlProbe?: (t: ProbeTarget) => Promise<ProbeResult> }): Promise<void> {
  app.addHook("preHandler", requireAuth);
  app.addHook("preHandler", requireSuperAdmin);
  app.addHook("onSend", noStore);
  const d = systemDeps(app);
  const testLimits = {
    perUser: new FixedWindowCounter(6, 60_000, 60_000), // AC-77: 5/dk/kullanıcı (6. → 429)
    global: new FixedWindowCounter(21, 60_000, 60_000), // B-P11-4: tüm Super Admin'ler için 20/dk (21. → 429)
  };
  app.addHook("onClose", async () => {
    testLimits.perUser.close();
    testLimits.global.close();
  });

  app.get("/mysql", async (): Promise<MysqlSettingsView> => getMysqlSettings(d));
  app.put("/mysql", async (req): Promise<MysqlSettingsSaveResponse> => saveMysqlSettings(d, auditContext(req), authOf(req), parseInput(mysqlSettingsInputSchema, req.body)));
  app.post("/mysql/test", async (req): Promise<MysqlTestResponse> => testMysql(d, auditContext(req), authOf(req), parseInput(mysqlSettingsInputSchema, req.body), testLimits, opts.mysqlProbe));

  app.get("/turn", async (): Promise<TurnSettingsView> => getTurnSettings(d));
  app.put("/turn", async (req): Promise<TurnSettingsView> => {
    const out = await saveTurnSettings(d, auditContext(req), authOf(req), parseInput(turnSettingsInputSchema, req.body));
    await applyTurn(app);
    return out;
  });
  app.delete("/turn", async (req): Promise<TurnSettingsView> => {
    const out = await deleteTurnSettings(d, auditContext(req), authOf(req));
    await applyTurn(app);
    return out;
  });
}

/** B-P11-6: aydınlatma metni kaydı tenant başına 10/saat (11. → 429); geçerli her PUT sayılır (`changed:false` dahil). */
export const CONSENT_SAVE_PER_HOUR = 10;

export async function consentTextRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  app.addHook("onSend", noStore);
  const saveLimit = new FixedWindowCounter(CONSENT_SAVE_PER_HOUR + 1, 3_600_000, 3_600_000);
  app.addHook("onClose", async () => saveLimit.close());
  app.get("", { preHandler: requirePerm("settings.view") }, async (req): Promise<ConsentTextSettings> => getConsentSettings(app.db, tenantScope(req).tenantId));
  app.put("", { preHandler: requirePerm("settings.edit") }, async (req): Promise<ConsentTextSaveResponse> => {
    const { tenantId } = tenantScope(req);
    const { body } = parseInput(consentTextInputSchema, req.body);
    const wait = saveLimit.blockedFor(tenantId);
    if (wait > 0 || saveLimit.hit(tenantId)) throw new AppError("RATE_LIMITED", { retryAfterSec: wait || 3600 });
    return saveConsentText(app.db, auditContext(req), authOf(req), tenantId, body);
  });
}
