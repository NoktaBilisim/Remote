// P18 (AC-258; mimari-e11 §8b.5): /api/v1/settings/business-hours ve /api/v1/settings/holidays. Sıra: requireAuth (CSRF
// yazmada) → requirePerm (okuma settings.view, yazma settings.edit) → tenantScope (Super Admin firma seçmeli) → hız → zod →
// servis (`hours.ts`). Yanıtlar `Cache-Control: no-store`.
import {
  businessHoursSchema,
  holidayIdSchema,
  holidayInputSchema,
  holidaysQuerySchema,
  importTrHolidaysInputSchema,
  type BusinessHoursView,
  type HolidayImportResponse,
  type HolidayItem,
  type HolidayListResponse,
} from "@remote/contracts/api/requests";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { auditContext } from "../audit/service.ts";
import { authOf, requireAuth, requirePerm, tenantScope } from "../auth/guards.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import {
  addHoliday,
  getBusinessHours,
  importTrHolidays,
  listHolidays,
  removeHoliday,
  updateBusinessHours,
  type HoursDeps,
} from "./hours.ts";
import { ensureSettings } from "./panel.ts";

export const BUSINESS_HOURS_WRITES_PER_MIN = 30;
export const HOLIDAY_WRITES_PER_MIN = 60;
export const HOLIDAY_IMPORTS_PER_MIN = 10;

/** Kullanıcı başına sabit pencere kovası (P15 engel kalıbı); aşım 429 + Retry-After. */
function userLimit(app: FastifyInstance, perMin: number): (req: FastifyRequest) => Promise<void> {
  const c = new FixedWindowCounter(perMin + 1, 60_000, 60_000);
  app.addHook("onClose", async () => c.close());
  return async (req) => {
    const key = authOf(req).user.id;
    const wait = c.blockedFor(key);
    if (wait > 0 || c.hit(key)) throw new AppError("RATE_LIMITED", { retryAfterSec: c.blockedFor(key) || 60 });
  };
}

function deps(app: FastifyInstance): HoursDeps {
  const svc = app.requests;
  return { db: app.db, cache: svc.calendars, now: () => svc.d.clock.now(), ensureSettings: (tenantId) => ensureSettings(svc, tenantId) };
}

export async function businessHoursRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  app.addHook("onSend", async (_req, reply) => {
    void reply.header("Cache-Control", "no-store");
  });
  const writes = userLimit(app, BUSINESS_HOURS_WRITES_PER_MIN);

  app.get("", { preHandler: requirePerm("settings.view") }, async (req): Promise<BusinessHoursView> =>
    getBusinessHours(deps(app), tenantScope(req).tenantId),
  );

  app.put("", { preHandler: [requirePerm("settings.edit"), writes] }, async (req): Promise<BusinessHoursView> => {
    const { tenantId } = tenantScope(req);
    const input = parseInput(businessHoursSchema, req.body);
    return updateBusinessHours(deps(app), auditContext(req), authOf(req), tenantId, input);
  });
}

export async function holidayRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  app.addHook("onSend", async (_req, reply) => {
    void reply.header("Cache-Control", "no-store");
  });
  const writes = userLimit(app, HOLIDAY_WRITES_PER_MIN);
  const imports = userLimit(app, HOLIDAY_IMPORTS_PER_MIN);

  app.get("", { preHandler: requirePerm("settings.view") }, async (req): Promise<HolidayListResponse> => {
    const { tenantId } = tenantScope(req);
    const { year } = parseInput(holidaysQuerySchema, req.query);
    return listHolidays(deps(app), tenantId, year);
  });

  app.post("", { preHandler: [requirePerm("settings.edit"), writes] }, async (req, reply): Promise<HolidayItem> => {
    const { tenantId } = tenantScope(req);
    const input = parseInput(holidayInputSchema, req.body);
    return reply.status(201).send(await addHoliday(deps(app), auditContext(req), authOf(req), tenantId, input));
  });

  app.post("/import-tr", { preHandler: [requirePerm("settings.edit"), imports] }, async (req): Promise<HolidayImportResponse> => {
    const { tenantId } = tenantScope(req);
    const { year } = parseInput(importTrHolidaysInputSchema, req.body);
    return importTrHolidays(deps(app), auditContext(req), authOf(req), tenantId, year);
  });

  app.delete("/:id", { preHandler: [requirePerm("settings.edit"), writes] }, async (req, reply) => {
    const { tenantId } = tenantScope(req);
    const id = holidayIdSchema.safeParse((req.params as { id?: string }).id);
    if (!id.success) throw new AppError("NOT_FOUND");
    await removeHoliday(deps(app), auditContext(req), authOf(req), tenantId, id.data);
    return reply.status(204).send();
  });
}
