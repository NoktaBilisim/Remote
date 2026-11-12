// P8b test yardımcıları: talep ayarı + doğrudan DB'ye talep satırı (API dışı kurulum), sahte WhatsApp servisi.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import { newId, newRequestCode, newSecretToken, newTenantRef, sha256Hex } from "../../src/lib/ids.ts";
import { ORIGIN, testDb } from "./app.ts";
import { connect, techHeaders, type WsClient } from "./ws.ts";

export async function createRequestSettings(tenantId: string, o: { trustedCidrs?: string[]; waEnabled?: boolean; waRecipients?: string[]; waitMinutes?: number } = {}) {
  const ref = newTenantRef();
  await testDb().tenantRequestSettings.create({
    data: { tenantId, requestRef: ref, fileLabel: "TestFirma", waitMinutes: o.waitMinutes ?? 30, waEnabled: o.waEnabled ?? false, waRecipients: o.waRecipients ?? [], emailRecipients: [], trustedCidrs: o.trustedCidrs ?? [] },
  });
  return ref;
}

let seq = 0;
/** PENDING talep (varsayılan). `createdAt` geçmişe alınabilir (süre dolumu / anonimleştirme testleri). */
export async function createRequestRow(
  tenantId: string,
  o: { createdAt?: Date; waitMinutes?: number; ip?: string; customerName?: string; customerEmail?: string; description?: string; deviceHash?: string } = {},
) {
  const db = testDb();
  const consent = await db.consentText.findFirstOrThrow({ where: { tenantId, isCurrent: true }, select: { id: true, sha256: true } });
  const id = newId();
  const secret = newSecretToken();
  const createdAt = o.createdAt ?? new Date();
  const ip = o.ip ?? `198.51.100.${(++seq % 250) + 1}`;
  await db.supportRequest.create({
    data: {
      id,
      tenantId,
      requestCode: newRequestCode(),
      secretHash: sha256Hex(secret),
      clientInstance: newSecretToken().slice(0, 22),
      clientVersion: "0.9.0",
      customerName: o.customerName ?? "Ayşe Müşteri",
      customerPhone: "+905321234567",
      customerEmail: o.customerEmail ?? null,
      description: o.description ?? "Yazıcı çalışmıyor lütfen yardım",
      deviceHash: o.deviceHash ?? null,
      consentTextId: consent.id,
      consentSha256: consent.sha256,
      consentedAt: createdAt,
      ip,
      ipKey: ip,
      netKey: `${ip.split(".").slice(0, 3).join(".")}.0/24`,
      expiresAt: new Date(createdAt.getTime() + (o.waitMinutes ?? 30) * 60_000),
      createdAt,
    },
  });
  return { id, secret };
}

export interface WaHit {
  path: string;
  body: Record<string, unknown>;
}

/** Yanıt planı: HTTP durum kodu veya "hang" (yanıt verilmez; istemci zaman aşımı). n = 1'den başlayan çağrı sırası. */
export type WaPlan = (n: number, hit: WaHit) => number | "hang";

export interface FakeWhatsapp {
  url: string;
  hits: WaHit[];
  plan: WaPlan;
  close(): Promise<void>;
}

/** Yerel sahte whatsapp-bildirim servisi (127.0.0.1, rastgele port). Gerçek servise hiçbir istek gitmez. */
export async function startFakeWhatsapp(plan: WaPlan = () => 200): Promise<FakeWhatsapp> {
  const hung = new Set<ServerResponse>();
  const fake: FakeWhatsapp = { url: "", hits: [], plan, close: async () => undefined };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const hit: WaHit = { path: req.url ?? "", body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown> };
      fake.hits.push(hit);
      const out = fake.plan(fake.hits.length, hit);
      if (out === "hang") return void hung.add(res);
      res.writeHead(out, { "content-type": "application/json" }).end(JSON.stringify({ success: out < 300 }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  fake.url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  fake.close = async () => {
    for (const res of hung) res.destroy();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  };
  return fake;
}

export interface CreateReqOpts {
  ip?: string;
  version?: string;
  consentTextId?: string;
  instance?: string;
  deviceKey?: string;
  /** Gövdeye eklenen/üzerine yazılan alanlar (ör. `email`, `customerName`, `description`). */
  extra?: Record<string, unknown>;
}

/** Canlı uygulama üzerinde public talep akışı kısayolları (P8b testleri). XFF ile istemci IP'si (TRUSTED_PROXY_CIDR 127.0.0.1/32). */
export function requestClient(app: FastifyInstance, base: string) {
  const tenantInfo = (ref: string, ip: string) => app.inject({ method: "GET", url: `/api/v1/public/requests/tenant?ref=${ref}`, headers: { "x-forwarded-for": ip } });
  const consentId = async (ref: string, ip: string) => (await tenantInfo(ref, ip)).json<{ consentText: { id: string } }>().consentText.id;
  const createReq = async (ref: string, ip: string, o: CreateReqOpts = {}) =>
    app.inject({
      method: "POST",
      url: "/api/v1/public/requests",
      headers: { "x-forwarded-for": ip },
      payload: {
        ref,
        clientInstanceId: o.instance ?? newSecretToken().slice(0, 22),
        clientVersion: o.version ?? "0.9.0",
        customerName: "Ayşe Müşteri",
        phone: "0532 123 45 67",
        description: "Yazıcı çalışmıyor lütfen yardım",
        consentTextId: o.consentTextId ?? (await consentId(ref, ip)),
        consentAccepted: true,
        ...(o.deviceKey ? { deviceKey: o.deviceKey } : {}),
        ...o.extra,
      },
    });
  const cancel = (secret: string, ip: string) => app.inject({ method: "POST", url: "/api/v1/public/requests/cancel", headers: { "x-forwarded-for": ip }, payload: { requestSecret: secret } });
  const reqWs = (secret: string, headers: Record<string, string> = {}) => connect(`${base}/ws/request`, ["rs.v1", `rs.req.${secret}`], headers);
  const panelWs = (token: string) => connect(`${base}/ws/panel`, ["rs.v1"], techHeaders(token, ORIGIN));
  const guestWs = (ticket: string) => connect(`${base}/ws/guest`, ["rs.v1", `rs.ticket.${ticket}`]);
  const accept = (headers: Record<string, string>, id: string) => app.inject({ method: "POST", url: `/api/v1/support-requests/${id}/accept`, headers, payload: {} });
  return { tenantInfo, consentId, createReq, cancel, reqWs, panelWs, guestWs, accept };
}

/** WsClient mesajı (P8b mesajları ServerOutbound birliğinde değil). */
export const waitMsg = async <T = Record<string, unknown>>(c: WsClient, t: string, ms?: number): Promise<T> => (await c.waitFor(t as never, ms)) as unknown as T;
export const hasMsg = (c: WsClient, t: string): boolean => c.msgs.some((m) => (m as { t: string }).t === t);

/**
 * İstemci anlamı (QA P8b-1 Tur 2 Öneri 1): 503 NOT_READY'yi `Retry-After`'a uyarak sınırlı sayıda yeniden dener.
 * Testte bekleme kısaltılır (Retry-After saniyesi × `scaleMs`, + jitter); başka yanıt hemen döner. `signal` iptalinde
 * son yanıtla durur.
 */
export async function retryNotReady<R extends { statusCode: number; headers: Record<string, unknown> }>(send: () => Promise<R>, o: { attempts?: number; scaleMs?: number; signal?: AbortSignal } = {}): Promise<R & { retries: number }> {
  const attempts = o.attempts ?? 30;
  for (let retries = 0; ; retries++) {
    const r = await send();
    // `signal` iptal edildiyse (test düştü, app kapanacak) yeniden deneme yok: kapalı app'e istek atılmaz (QA-P8b-14).
    if (r.statusCode !== 503 || retries + 1 >= attempts || o.signal?.aborted) return Object.assign(r, { retries });
    const after = Number(r.headers["retry-after"]);
    if (!Number.isFinite(after) || after <= 0) throw new Error("503 Retry-After başlığı olmadan döndü");
    await new Promise((res) => setTimeout(res, after * (o.scaleMs ?? 40) + Math.random() * 100));
    if (o.signal?.aborted) return Object.assign(r, { retries });
  }
}
