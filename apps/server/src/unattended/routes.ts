// /api/v1/unattended/* (mimari-p27 §4.2; AC-273, 275, 293, 296, 297, 336, 337, 339). Panel uçları: requireAuth (CSRF) →
// yetki (`connect` ∨ `manage` / `manage`) → tenantScope → (yazma) kullanıcı kovası → (gerekirse) step-up → zod → servis.
// `POST /register` cihaz ucudur: çerezsiz, Origin'siz (AGENT kuralı), kayıt kodu kimliği, IP + başarısız deneme kovaları.
// `POST /devices/:id/connect` (K3, unattended/connect.ts): yetki denetimi serviste (ret audit'lensin), kullanıcı başına 20/sa.
import {
  createRegistrationCodeInputSchema,
  listDevicesQuerySchema,
  putDeviceGrantsInputSchema,
  putNotifyContactsInputSchema,
  putUnattendedPolicyInputSchema,
  unattendedConnectInputSchema,
  CONNECT_ASK_COOLDOWN_SEC,
  registerDeviceInputSchema,
  type CreatedRegistrationCode,
  type DeviceDetail,
  type DeviceGrantsResponse,
  type DeviceListResponse,
  type NotifyContactsResponse,
  type RegisterDeviceResponse,
  type RegistrationCodeListResponse,
  type UnattendedConnectResponse,
  type UnattendedPolicyView,
  type UnattendedStatus,
} from "@remote/contracts/api/unattended";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { auditContext } from "../audit/service.ts";
import { authOf, requireAnyPerm, requireAuth, requirePerm, requireStepUp, tenantScope } from "../auth/guards.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import { connectDevice } from "./connect.ts";
import type { ConnectRequest } from "./connect-tx.ts";
import { sendSilentNotice, silentPolicyMail } from "./mail.ts";
import { getPolicy, putPolicy, silentAllowedFor } from "./policy.ts";
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
  return () => ({ db: app.db, mail: app.mail, gate, link, now: Date.now, log: app.log, secrets: app.secrets, metrics: app.metrics });
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
  pairLimit: FixedWindowCounter;
}

function connectRequest(body: unknown): ConnectRequest {
  const v = parseInput(unattendedConnectInputSchema, body ?? {});
  return v.silent && v.reason !== undefined ? { consent: "silent", reason: v.reason } : { consent: "ask" };
}

const anyPerm = () => ({ preHandler: requireAnyPerm("unattended.connect", "unattended.manage") });
const manage = () => ({ preHandler: requirePerm("unattended.manage") });
const manageStepUp = (p: Panel) => ({ preHandler: [requirePerm("unattended.manage"), p.stepUp] });

/** Durum + cihaz uçları (liste, ayrıntı, yetkiler, iptal, bağlan). */
function deviceRoutes(p: Panel): void {
  const { app, d } = p;
  app.get("/status", anyPerm(), async (req): Promise<UnattendedStatus> => {
    const auth = authOf(req);
    const base = await unattendedStatus(d().gate, app.mail, auth.tenantId);
    return { ...base, silentAllowed: await silentAllowedFor(app.db, auth, auth.tenantId) };
  });
  app.get("/devices", anyPerm(), async (req): Promise<DeviceListResponse> =>
    listDevices(d(), authOf(req), tenantScope(req).tenantId, parseInput(listDevicesQuerySchema, req.query)),
  );
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
    const input = connectRequest(req.body);
    const hub = app.unattendedHub;
    const c = {
      ...d(),
      hub,
      rooms: app.rooms,
      metrics: app.metrics,
      limit: p.connectLimit,
      pairLimit: p.pairLimit,
      consentCapable: (deviceId: string) => hub.has(deviceId, "consent1"), // §5.1 8a
    };
    return connectDevice(c, auditContext(req), authOf(req), tenantId, id, input);
  });
}

/** §5.2 politika (AC-436): `manage` ∧ `settings.view|edit`; açma step-up'ı serviste (tüketmez). */
function policyRoutes(p: Panel): void {
  const { app } = p;
  const view = { preHandler: [requirePerm("unattended.manage"), requirePerm("settings.view")] };
  const edit = { preHandler: [requirePerm("unattended.manage"), requirePerm("settings.edit")] };
  app.get("/policy", view, async (req): Promise<UnattendedPolicyView> => getPolicy(app.db, tenantScope(req).tenantId));
  app.put("/policy", edit, async (req): Promise<UnattendedPolicyView> => {
    const { tenantId } = tenantScope(req);
    const input = parseInput(putUnattendedPolicyInputSchema, req.body);
    const auth = authOf(req);
    const ctx = auditContext(req);
    const r = await putPolicy({ db: app.db, rooms: app.rooms, now: Date.now, log: app.log }, ctx, auth, tenantId, input);
    if (r.changed) {
      const content = silentPolicyMail({ user: auth.user.fullName, old: r.old, next: input.silentEnabled, at: new Date() });
      void sendSilentNotice(
        { db: app.db, mail: app.mail, metrics: app.metrics, log: app.log },
        {
          ctx,
          tenantId,
          actor: { userId: auth.user.id, email: auth.user.email },
          event: "policy",
          entity: "tenant_settings",
          entityId: tenantId,
          content,
        },
      );
    }
    return r.view;
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
  const pairLimit = new FixedWindowCounter(1, CONNECT_ASK_COOLDOWN_SEC * 1000, CONNECT_ASK_COOLDOWN_SEC * 1000);
  app.addHook("onClose", async () => {
    connectLimit.close();
    pairLimit.close();
  });
  const link = opts.link ?? app.unattendedHub ?? OFFLINE_LINK;
  const p: Panel = { app, d: depsOf(app, link), stepUp: requireStepUp(), connectLimit, pairLimit };
  deviceRoutes(p);
  policyRoutes(p);
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
