// P28c entegrasyon testleri ortak fikstürü: canlı sunucu (sahte saatli oda), sahip + multi1 misafir, üye davet/kabul/WS.
import { WS_CAP_MULTI } from "@remote/contracts/ws-multi";
import type { ServerOutbound } from "@remote/contracts/ws";
import { createTenant, createUser, ORIGIN, testDb, type Session, type TestUser } from "./app.ts";
import { signIn } from "./auth.ts";
import { startLive, type Live } from "./signal-flow.ts";
import { connect, FakeClock, techHeaders, type WsClient } from "./ws.ts";

export const OWNER_PERMS = {
  "sessions.create": true,
  "sessions.view": true,
  "sessions.invite": true,
  "remote_control.use": true,
  "file_transfer.use": true,
};
export const MEMBER_PERMS = { "sessions.view": true, "remote_control.use": true };
export const SUPERVISOR_PERMS = { "sessions.view": true, "sessions.supervise": true };

let ipSeq = 0;
/** Her giriş/genel istek ayrı istemci IP'sinden (IP başına giriş/çözüm kovası dosyanın toplamına takılmasın). */
export const nextIp = (): string => `198.51.${100 + (Math.floor(++ipSeq / 250) % 100)}.${(ipSeq % 250) + 1}`;
const loginAs = (app: Live["app"], user: TestUser): Promise<Session> => signIn(app, user, nextIp());

export interface MultiLive extends Live {
  clock: FakeClock;
}

export async function startMultiLive(env: Record<string, string> = {}): Promise<MultiLive> {
  const clock = new FakeClock();
  // XFF yalnız güvenilen proxy'den okunur: test istemcisi 127.0.0.1 → IP başına kovalar `nextIp()` ile ayrışır.
  const live = await startLive({ env: { TRUSTED_PROXY_CIDR: "127.0.0.1/32", ...env }, signaling: { clock, revalidateMs: 300 } });
  return { ...live, clock };
}

export interface Owner {
  tenantId: string;
  user: TestUser;
  s: Session;
  sessionId: string;
  ws: WsClient;
  guest: WsClient;
}

/** Sahip + oturum + sahip WS + kabul edilmiş tarayıcı misafiri (`multi` → `rs.cap.multi1` bildirir). */
export async function ownerWithGuest(
  live: Live,
  o: { multi?: boolean; tenantId?: string; perms?: Record<string, boolean> } = {},
): Promise<Owner> {
  const tenantId = o.tenantId ?? (await createTenant()).id;
  const user = await createUser({ tenantId, role: "USER", perms: o.perms ?? OWNER_PERMS });
  const s = await loginAs(live.app, user);
  const res = await live.app.inject({ method: "POST", url: "/api/v1/sessions", headers: s.headers, payload: {} });
  const created = res.json<{ id: string; link: string }>();
  const ws = await connect(`${live.base}/ws/tech?sessionId=${created.id}`, ["rs.v1"], {
    ...techHeaders(s.token, ORIGIN),
    "x-forwarded-for": nextIp(),
  });
  await ws.waitFor("hello");
  const headers = { origin: ORIGIN, "x-forwarded-for": nextIp() };
  const token = created.link.split("/").pop() ?? "";
  const r = await live.app.inject({
    method: "POST",
    url: "/api/v1/public/sessions/resolve",
    headers,
    payload: { token, clientKind: "BROWSER" },
  });
  const { joinNonce, consentText } = r.json<{ joinNonce: string; consentText: { id: string } }>();
  const j = await live.app.inject({
    method: "POST",
    url: "/api/v1/public/sessions/join",
    headers,
    payload: { joinNonce, customerName: "Ayşe Müşteri", consentAccepted: true, consentTextId: consentText.id },
  });
  const { wsTicket, admitCode } = j.json<{ wsTicket: string; admitCode: string }>();
  const protos = ["rs.v1", `rs.ticket.${wsTicket}`, ...(o.multi === false ? [] : [WS_CAP_MULTI])];
  const guest = await connect(`${live.base}/ws/guest`, protos, { origin: ORIGIN, "x-forwarded-for": nextIp() });
  await guest.waitFor("lobby.wait");
  await ws.waitFor("peer.pending");
  ws.send({ t: "guest.admit", admitCode });
  await guest.waitFor("hello");
  await ws.waitFor("peer.joined");
  return { tenantId, user, s, sessionId: created.id, ws, guest };
}

export async function newUser(
  live: Live,
  tenantId: string | null,
  perms: Record<string, boolean>,
  role: "USER" | "ADMIN" | "SUPER_ADMIN" = "USER",
) {
  const user = await createUser({ tenantId, role, perms });
  return { user, s: await loginAs(live.app, user) };
}

export const inject = (live: Live, method: "GET" | "POST" | "DELETE", url: string, s: Session, payload?: object) =>
  live.app.inject({ method, url, headers: s.headers, ...(payload !== undefined ? { payload } : method === "POST" ? { payload: {} } : {}) });

export const errCode = (r: { statusCode: number; json<T>(): T }): string =>
  `${r.statusCode} ${r.json<{ error?: { code: string } }>().error?.code ?? ""}`;

/** Üye WS (`/ws/tech`) + hello. */
export async function memberWs(live: Live, sessionId: string, s: Session) {
  const ws = await connect(`${live.base}/ws/tech?sessionId=${sessionId}`, ["rs.v1"], {
    ...techHeaders(s.token, ORIGIN),
    "x-forwarded-for": nextIp(),
  });
  const hello = await ws.waitFor("hello");
  return { ws, hello };
}

/** Davet → kabul → WS: bağlı katılımcı. */
export async function inviteAndJoin(live: Live, owner: Owner, perms: Record<string, boolean> = MEMBER_PERMS) {
  const m = await newUser(live, owner.tenantId, perms);
  const inv = await inject(live, "POST", `/api/v1/sessions/${owner.sessionId}/invites`, owner.s, { userId: m.user.id });
  if (inv.statusCode !== 201) throw new Error(`davet ${inv.statusCode} ${inv.body}`);
  const { inviteId } = inv.json<{ inviteId: string }>();
  const acc = await inject(live, "POST", `/api/v1/sessions/invites/${inviteId}/accept`, m.s, {});
  if (acc.statusCode !== 200) throw new Error(`kabul ${acc.statusCode} ${acc.body}`);
  const w = await memberWs(live, owner.sessionId, m.s);
  return { ...m, ...w, inviteId };
}

/** İlk eşleşen mesaj (koşullu). */
export async function waitMsg<T extends ServerOutbound["t"]>(
  c: WsClient,
  t: T,
  pred: (m: Extract<ServerOutbound, { t: T }>) => boolean = () => true,
  ms = 5000,
): Promise<Extract<ServerOutbound, { t: T }>> {
  const end = Date.now() + ms;
  for (;;) {
    const m = await c.waitFor(t, Math.max(1, end - Date.now()));
    if (pred(m)) return m;
  }
}

export const audits = (sessionId: string, action: string) =>
  testDb().auditLog.findMany({ where: { entityId: sessionId, action }, orderBy: { id: "asc" } });

export const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

export async function until(fn: () => Promise<boolean> | boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error("koşul zaman aşımı");
    await tick(25);
  }
}
