// P11 uçları. /api/v1/admin/settings/{mysql,turn,whatsapp (P12b)} — yalnız SUPER_ADMIN (rol kontrolü); /api/v1/settings/consent-text —
// settings.view/edit, etkin tenant. Sıra: requireAuth → rol/yetki → kapsam → zod → servis.
import {
  consentTextInputSchema,
  mysqlSettingsInputSchema,
  turnSettingsInputSchema,
  whatsappAdminTestInputSchema,
  whatsappSettingsInputSchema,
  type ConsentTextSaveResponse,
  type ConsentTextSettings,
  type MysqlSettingsSaveResponse,
  type MysqlSettingsView,
  type MysqlTestResponse,
  type TurnSettingsView,
  type WhatsappAdminTestResponse,
  type WhatsappSettingsView,
} from "@remote/contracts/api/system-settings";
import {
  clamavSettingsInputSchema,
  clamavTestInputSchema,
  type ClamavSettingsView,
  type ClamavTestResponse,
} from "@remote/contracts/api/clamav";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { auditContext } from "../audit/service.ts";
import { authOf, requireAuth, requirePerm, requireStepUp, requireSuperAdmin, tenantScope } from "../auth/guards.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import { getConsentSettings, saveConsentText } from "./consent.ts";
import {
  deleteTurnSettings,
  effectiveTurn,
  getMysqlSettings,
  getTurnSettings,
  saveMysqlSettings,
  saveTurnSettings,
  testMysql,
  type SystemDeps,
} from "./system.ts";
import { deleteWhatsappSettings, effectiveWhatsappTarget, getWhatsappSettings, saveWhatsappSettings, testWhatsapp } from "./whatsapp.ts";
import type { ProbeResult, ProbeTarget } from "./mysql-probe.ts";
import { CLAMAV_TEST_LIMIT, getClamavSettings, saveClamavSettings, testClamav } from "./clamav.ts";

const noStore = async (_req: unknown, reply: { header(k: string, v: string): unknown }) => {
  void reply.header("Cache-Control", "no-store");
};

/** Sıralı yürütücü: her iş öncekinin bitmesini bekler (hata zinciri kırmaz). Tek süreç (ADR-0005). */
function serialQueue(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn);
    tail = run.catch(() => undefined);
    return run;
  };
}

export function systemDeps(app: FastifyInstance): SystemDeps {
  return {
    db: app.db,
    secrets: app.secrets,
    log: app.log,
    databaseUrl: app.env.DATABASE_URL,
    turnEnv: { urls: app.env.turnUrls, secret: app.env.TURN_SECRET, ttlMin: app.env.TURN_CRED_TTL_MIN },
    whatsappEnvUrl: app.env.WHATSAPP_SERVICE_URL,
    whatsappEnvApiKey: app.env.WHATSAPP_SERVICE_API_KEY,
    whatsappAllowInsecureHttp: app.env.WHATSAPP_ALLOW_INSECURE_HTTP,
    production: app.env.NODE_ENV === "production",
    metrics: app.metrics,
  };
}

/** P12b (AC-196): etkin WhatsApp adresini (panel > env) notifier'a uygular (açılışta ve her PUT/DELETE sonrası; tek süreç). */
export async function applyWhatsapp(app: FastifyInstance): Promise<void> {
  const t = await effectiveWhatsappTarget(systemDeps(app));
  app.whatsapp.setUrl(t.url, t.apiKey);
}

/** Panel TURN kaydını odalara uygular (açılışta ve her değişiklikte; tek instance — ADR-0005). */
export async function applyTurn(app: FastifyInstance): Promise<void> {
  app.rooms.turn = await effectiveTurn(systemDeps(app));
}

export async function adminSettingsRoutes(
  app: FastifyInstance,
  opts: { mysqlProbe?: (t: ProbeTarget) => Promise<ProbeResult> },
): Promise<void> {
  app.addHook("preHandler", requireAuth);
  app.addHook("preHandler", requireSuperAdmin);
  app.addHook("onSend", noStore);
  const d = systemDeps(app);
  const testLimits = {
    perUser: new FixedWindowCounter(6, 60_000, 60_000), // AC-77: 5/dk/kullanıcı (6. → 429)
    global: new FixedWindowCounter(21, 60_000, 60_000), // B-P11-4: tüm Super Admin'ler için 20/dk (21. → 429)
  };
  const waTestLimits = {
    perUser: new FixedWindowCounter(6, 60_000, 60_000), // AC-196: 5/dk/kullanıcı (6. → 429)
    global: new FixedWindowCounter(21, 60_000, 60_000), // B-P12b-5: tüm Super Admin'ler için 20/dk (21. → 429)
  };
  // P13a (B-P12b-5): sistem ayarı yazımları (PUT/DELETE mysql|turn|whatsapp) kullanıcı başına toplam 10/dk (11. → 429).
  // Girdi doğrulamasından sonra sayılır (aydınlatma metni kalıbı): 400 alan isteği kotayı tüketmez.
  const writeLimit = new FixedWindowCounter(SYSTEM_SETTINGS_WRITES_PER_MIN + 1, 60_000, 60_000);
  const writeGuard = (req: FastifyRequest): void => {
    const userId = authOf(req).user.id;
    const wait = writeLimit.blockedFor(userId);
    if (wait > 0 || writeLimit.hit(userId)) throw new AppError("RATE_LIMITED", { retryAfterSec: wait || 60 });
  };
  // B-P12b-2: WhatsApp yazımı + belleğe uygulama süreç içinde sıralı (son commit = bellekteki adres).
  const waSerial = serialQueue();
  app.addHook("onClose", async () => {
    testLimits.perUser.close();
    testLimits.global.close();
    waTestLimits.perUser.close();
    waTestLimits.global.close();
    writeLimit.close();
  });

  // P14a (AC-215, ADR-0022): sistem ayarı değişikliği (PUT/DELETE mysql|turn|whatsapp) son 5 dk içinde step-up ister.
  const stepUp = { preHandler: requireStepUp() };

  app.get("/mysql", async (): Promise<MysqlSettingsView> => getMysqlSettings(d));
  app.put("/mysql", stepUp, async (req): Promise<MysqlSettingsSaveResponse> => {
    const input = parseInput(mysqlSettingsInputSchema, req.body);
    writeGuard(req);
    return saveMysqlSettings(d, auditContext(req), authOf(req), input);
  });
  app.post("/mysql/test", async (req): Promise<MysqlTestResponse> =>
    testMysql(d, auditContext(req), authOf(req), parseInput(mysqlSettingsInputSchema, req.body), testLimits, opts.mysqlProbe),
  );

  app.get("/turn", async (): Promise<TurnSettingsView> => getTurnSettings(d));
  app.put("/turn", stepUp, async (req): Promise<TurnSettingsView> => {
    const input = parseInput(turnSettingsInputSchema, req.body);
    writeGuard(req);
    const out = await saveTurnSettings(d, auditContext(req), authOf(req), input);
    await applyTurn(app);
    return out;
  });
  app.delete("/turn", stepUp, async (req): Promise<TurnSettingsView> => {
    writeGuard(req);
    const out = await deleteTurnSettings(d, auditContext(req), authOf(req));
    await applyTurn(app);
    return out;
  });

  app.get("/whatsapp", async (): Promise<WhatsappSettingsView> => getWhatsappSettings(d));
  app.put("/whatsapp", stepUp, async (req): Promise<WhatsappSettingsView> => {
    const input = parseInput(whatsappSettingsInputSchema, req.body);
    writeGuard(req);
    return waSerial(async () => {
      const t = await saveWhatsappSettings(d, auditContext(req), authOf(req), input);
      app.whatsapp.setUrl(t.url, t.apiKey);
      return getWhatsappSettings(d);
    });
  });
  app.delete("/whatsapp", stepUp, async (req): Promise<WhatsappSettingsView> => {
    writeGuard(req);
    return waSerial(async () => {
      const t = await deleteWhatsappSettings(d, auditContext(req), authOf(req));
      app.whatsapp.setUrl(t.url, t.apiKey);
      return getWhatsappSettings(d);
    });
  });
  app.post("/whatsapp/test", async (req): Promise<WhatsappAdminTestResponse> => {
    const { phoneNumber } = parseInput(whatsappAdminTestInputSchema, req.body);
    return testWhatsapp(d, auditContext(req), authOf(req), phoneNumber, waTestLimits, app.whatsapp);
  });

  // P28b (mimari-p28b §4, AC-353): ClamAV hedefi — PUT step-up + hedef kuralı; test 6/dk/kullanıcı. DELETE yok (K4 kararı).
  const av = app.fsrv.clamav;
  const avTestLimit = new FixedWindowCounter(CLAMAV_TEST_LIMIT, 60_000, 60_000);
  app.addHook("onClose", async () => avTestLimit.close());
  app.get("/clamav", async (): Promise<ClamavSettingsView> => getClamavSettings(av));
  app.put("/clamav", stepUp, async (req): Promise<ClamavSettingsView> => {
    const input = parseInput(clamavSettingsInputSchema, req.body);
    writeGuard(req);
    return saveClamavSettings(av, auditContext(req), authOf(req), input);
  });
  app.post("/clamav/test", async (req): Promise<ClamavTestResponse> => {
    const input = parseInput(clamavTestInputSchema, req.body ?? {});
    return testClamav(av, auditContext(req), authOf(req), input, avTestLimit, () => new Date(app.fsrv.service.d.clock.now()));
  });
}

/** P13a (B-P12b-5): sistem ayarı PUT/DELETE üst sınırı (kullanıcı başına, dakika; üç ayar toplamı). */
const SYSTEM_SETTINGS_WRITES_PER_MIN = 10;

/** B-P11-6: aydınlatma metni kaydı tenant başına 10/saat (11. → 429); geçerli her PUT sayılır (`changed:false` dahil). */
export const CONSENT_SAVE_PER_HOUR = 10;

export async function consentTextRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  app.addHook("onSend", noStore);
  const saveLimit = new FixedWindowCounter(CONSENT_SAVE_PER_HOUR + 1, 3_600_000, 3_600_000);
  app.addHook("onClose", async () => saveLimit.close());
  app.get("", { preHandler: requirePerm("settings.view") }, async (req): Promise<ConsentTextSettings> =>
    getConsentSettings(app.db, tenantScope(req).tenantId),
  );
  app.put("", { preHandler: requirePerm("settings.edit") }, async (req): Promise<ConsentTextSaveResponse> => {
    const { tenantId } = tenantScope(req);
    const { body } = parseInput(consentTextInputSchema, req.body);
    const wait = saveLimit.blockedFor(tenantId);
    if (wait > 0 || saveLimit.hit(tenantId)) throw new AppError("RATE_LIMITED", { retryAfterSec: wait || 3600 });
    return saveConsentText(app.db, auditContext(req), authOf(req), tenantId, body);
  });
}
