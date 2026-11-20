// /api/v1/unattended/* (mimari-p27 §4.2; AC-273, 275, 293, 296, 297, 336, 337, 339). Panel uçları: requireAuth (CSRF) →
// yetki (`connect` ∨ `manage` / `manage`) → tenantScope → (yazma) kullanıcı kovası → (gerekirse) step-up → zod → servis.
// `POST /register` cihaz ucudur: çerezsiz, Origin'siz (AGENT kuralı), kayıt kodu kimliği, IP + başarısız deneme kovaları.
// `POST /devices/:id/connect` (K3, unattended/connect.ts): yetki denetimi serviste (ret audit'lensin), kullanıcı başına 20/sa.
import {
  createRegistrationCodeInputSchema,
  deviceVersionsQuerySchema,
  listDevicesQuerySchema,
  putDeviceGrantsInputSchema,
  putNotifyContactsInputSchema,
  unattendedConnectInputSchema,
  registerDeviceInputSchema,
  type CreatedRegistrationCode,
  type DeviceDetail,
  type DeviceGrantsResponse,
  type DeviceListResponse,
  type DeviceVersionsResponse,
  type NotifyContactsResponse,
  type RegisterDeviceResponse,
  type RegistrationCodeListResponse,
  type UnattendedConnectResponse,
  type UnattendedStatus,
} from "@remote/contracts/api/unattended";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { auditContext } from "../audit/service.ts";
import { authOf, requireAnyPerm, requireAuth, requirePerm, requireStepUp, tenantScope } from "../auth/guards.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import { connectDevice } from "./connect.ts";
import { putContacts, getContacts } from "./contacts.ts";
import { sendServiceBinary } from "./download.ts";
import { createGate, unattendedStatus } from "./gate.ts";
import { registerDevice, type RegisterLimits } from "./register.ts";
import { cancelCode, createCode, listCodes, type RegistrationDeps } from "./registration.ts";
import { getDevice, listDevices, OFFLINE_LINK, putGrants, revokeDevice, type DeviceLink } from "./service.ts";

const WRITES_PER_MIN = 30;
/** §4.2: bağlantı ucu kullanıcı başına (bildirim sayısının kaynak sınırı, K-P27-8). */
const CONNECTS_PER_HOUR = 20;
const ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);

function idParam(req: FastifyRequest, name = "id"): string {
  const r = ulid.safeParse((req.params as Record<string, string | undefined>)[name]);
  if (!r.success) throw new AppError("NOT_FOUND");
  return r.data;
}

export interface UnattendedRouteOptions {
  /** Testler: sahte canlı kanal; verilmezse `app.unattendedHub` (K3 DeviceHub). */
  link?: DeviceLink;
}

function depsOf(app: FastifyInstance, link: DeviceLink): () => RegistrationDeps {
  const gate = createGate(app.env);
  return () => ({
    db: app.db,
    mail: app.mail,
    gate,
    link,
    now: Date.now,
    log: app.log,
    secrets: app.secrets,
    metrics: app.metrics,
    updates: app.updates,
    minAgentVersion: app.env.MIN_AGENT_VERSION,
    agentSha256: app.env.UNATTENDED_AGENT_SHA256,
  });
}

function writeLimit(app: FastifyInstance): void {
  const writes = new FixedWindowCounter(WRITES_PER_MIN + 1, 60_000, 60_000);
  app.addHook("onClose", async () => writes.close());
  app.addHook("preHandler", async (req) => {
    if (req.method === "GET" || req.method === "HEAD") return;
    const key = authOf(req).user.id;
    const wait = writes.blockedFor(key);
    if (wait > 0 || writes.hit(key)) throw new AppError("RATE_LIMITED", { retryAfterSec: writes.blockedFor(key) || 60 });
  });
}

/** Panel eklentisinin ortak bağlamı (kancalar kurulduktan sonra rota gruplarına verilir). */
interface Panel {
  app: FastifyInstance;
  d: () => RegistrationDeps;
  stepUp: ReturnType<typeof requireStepUp>;
  connectLimit: FixedWindowCounter;
}

const anyPerm = () => ({ preHandler: requireAnyPerm("unattended.connect", "unattended.manage") });
const manage = () => ({ preHandler: requirePerm("unattended.manage") });
const manageStepUp = (p: Panel) => ({ preHandler: [requirePerm("unattended.manage"), p.stepUp] });

/** Durum + cihaz uçları (liste, ayrıntı, yetkiler, iptal, bağlan). */
function deviceRoutes(p: Panel): void {
  const { app, d } = p;
  app.get("/status", anyPerm(), async (req): Promise<UnattendedStatus> => unattendedStatus(d().gate, app.mail, authOf(req).tenantId));
  app.get("/devices", anyPerm(), async (req): Promise<DeviceListResponse> =>
    listDevices(d(), authOf(req), tenantScope(req).tenantId, parseInput(listDevicesQuerySchema, req.query)),
  );
  // P29 (§4.8, AC-490): sürüm dağılımı. `unattended.view` = mevcut liste koruması (connect ∨ manage; ayrı anahtar yok, K-P29-20).
  // `scope=all` yalnız Super Admin (rol denetimi) ve tenantScope'tan ÖNCE (firma seçmemiş Super Admin); aksi tenant kapsamı.
  app.get("/versions", anyPerm(), async (req): Promise<DeviceVersionsResponse> => {
    const q = parseInput(deviceVersionsQuerySchema, req.query);
    if (q.scope === "all") {
      if (authOf(req).user.role !== "SUPER_ADMIN") throw new AppError("FORBIDDEN");
      return app.updateVersions.view(null);
    }
    return app.updateVersions.view(tenantScope(req).tenantId);
  });
  app.get("/devices/:id", anyPerm(), async (req): Promise<DeviceDetail> =>
    getDevice(d(), authOf(req), tenantScope(req).tenantId, idParam(req)),
  );
  app.put("/devices/:id/grants", manage(), async (req): Promise<DeviceGrantsResponse> => {
    const { tenantId } = tenantScope(req);
    const id = idParam(req);
    const { userIds } = parseInput(putDeviceGrantsInputSchema, req.body);
    return putGrants(d(), auditContext(req), authOf(req), tenantId, id, userIds, () => p.stepUp(req));
  });
  app.post("/devices/:id/revoke", manage(), async (req, reply) => {
    const { tenantId } = tenantScope(req);
    await revokeDevice(d(), auditContext(req), authOf(req), tenantId, idParam(req));
    return reply.status(204).send();
  });
  app.post("/devices/:id/connect", async (req): Promise<UnattendedConnectResponse> => {
    const { tenantId } = tenantScope(req);
    const id = idParam(req);
    parseInput(unattendedConnectInputSchema, req.body ?? {}); // AC-430: boş nesne; bilinmeyen alan 400
    const c = { ...d(), hub: app.unattendedHub, rooms: app.rooms, metrics: app.metrics, limit: p.connectLimit };
    return connectDevice(c, auditContext(req), authOf(req), tenantId, id);
  });
}

/** Kayıt kodları + müşteri bildirim adresleri. */
function codeAndContactRoutes(p: Panel): void {
  const { app, d } = p;
  app.get("/registration-codes", manage(), async (req): Promise<RegistrationCodeListResponse> => listCodes(d(), tenantScope(req).tenantId));
  app.post("/registration-codes", manageStepUp(p), async (req, reply): Promise<CreatedRegistrationCode> => {
    const { tenantId } = tenantScope(req);
    const { customerId } = parseInput(createRegistrationCodeInputSchema, req.body);
    return reply.status(201).send(await createCode(d(), auditContext(req), authOf(req), tenantId, customerId));
  });
  app.delete("/registration-codes/:id", manage(), async (req, reply) => {
    const { tenantId } = tenantScope(req);
    await cancelCode(d(), auditContext(req), authOf(req), tenantId, idParam(req));
    return reply.status(204).send();
  });
  app.get("/customers/:customerId/contacts", manage(), async (req): Promise<NotifyContactsResponse> =>
    getContacts(app.db, tenantScope(req).tenantId, idParam(req, "customerId")),
  );
  app.put("/customers/:customerId/contacts", manageStepUp(p), async (req): Promise<NotifyContactsResponse> => {
    const { tenantId } = tenantScope(req);
    const customerId = idParam(req, "customerId");
    const input = parseInput(putNotifyContactsInputSchema, req.body);
    return putContacts({ db: app.db, secrets: app.secrets, now: Date.now }, auditContext(req), authOf(req), tenantId, customerId, input);
  });
}

/** Servis ikilisi indirme (yalnız `manage`; SHA uyuşmazsa 503). */
function downloadRoute(app: FastifyInstance): void {
  app.get("/download", manage(), async (_req, reply) => sendServiceBinary(app.unattendedBinary, app.env.UNATTENDED_AGENT_PATH, reply));
}

export async function unattendedRoutes(app: FastifyInstance, opts: UnattendedRouteOptions): Promise<void> {
  app.addHook("preHandler", requireAuth);
  app.addHook("onSend", async (_req, reply) => {
    void reply.header("Cache-Control", "no-store");
  });
  writeLimit(app);
  const connectLimit = new FixedWindowCounter(CONNECTS_PER_HOUR + 1, 3_600_000, 3_600_000);
  app.addHook("onClose", async () => connectLimit.close());
  const link = opts.link ?? app.unattendedHub ?? OFFLINE_LINK;
  const p: Panel = { app, d: depsOf(app, link), stepUp: requireStepUp(), connectLimit };
  deviceRoutes(p);
  codeAndContactRoutes(p);
  downloadRoute(app);
}

/** Cihaz kayıt ucu (kimliksiz; ayrı eklenti — panel kancaları uygulanmaz). */
export async function unattendedRegisterRoutes(app: FastifyInstance): Promise<void> {
  const d = depsOf(app, OFFLINE_LINK);
  const limits: RegisterLimits = {
    perIp: new FixedWindowCounter(11, 3_600_000, 3_600_000),
    badCode: new FixedWindowCounter(5, 15 * 60_000, 15 * 60_000),
    globalFail: new FixedWindowCounter(101, 3_600_000, 3_600_000),
  };
  app.addHook("onClose", async () => Object.values(limits).forEach((l) => l.close()));
  app.post("/register", async (req, reply): Promise<RegisterDeviceResponse> => {
    void reply.header("Cache-Control", "no-store");
    return registerDevice(d(), limits, req, () => parseInput(registerDeviceInputSchema, req.body));
  });
}
