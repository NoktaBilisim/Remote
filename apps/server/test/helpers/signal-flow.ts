// Uçtan uca P3 akışı (A1): gerçek dinleyen sunucu + iki sahte istemci (teknisyen + müşteri), UI yok.
import type { FastifyInstance } from "fastify";
import { createTenant, createUser, currentConsentId, loginAs, makeApp, ORIGIN, type TestUser } from "./app.ts";
import { connect, techHeaders, type WsClient } from "./ws.ts";

export interface Live {
  app: FastifyInstance;
  base: string;
  close(): Promise<void>;
}

export async function startLive(opts: Parameters<typeof makeApp>[0] = {}): Promise<Live> {
  const app = makeApp(opts);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { app, base: `ws://127.0.0.1:${port}`, close: () => app.close() };
}

export const TECH_PERMS = { "sessions.create": true, "sessions.view": true, "remote_control.use": true, "file_transfer.use": true };

/** Teknisyen + oturum (REST) + teknisyen WS (hello alınmış). */
export async function techSession(live: Live, tenantId?: string) {
  const tid = tenantId ?? (await createTenant()).id;
  const tech = await createUser({ tenantId: tid, role: "USER", perms: TECH_PERMS });
  const s = await loginAs(live.app, tech);
  const res = await live.app.inject({ method: "POST", url: "/api/v1/sessions", headers: s.headers, payload: {} });
  const created = res.json<{ id: string; link: string; code: string }>();
  const ws = await connect(`${live.base}/ws/tech?sessionId=${created.id}`, ["rs.v1"], techHeaders(s.token, ORIGIN));
  await ws.waitFor("hello");
  return {
    tenantId: tid,
    consentTextId: await currentConsentId(tid),
    tech,
    techAuth: s,
    sessionId: created.id,
    token: created.link.split("/").pop() ?? "",
    code: created.code,
    ws,
  };
}

export type TechSide = Awaited<ReturnType<typeof techSession>>;

/** resolve + join (BROWSER, Origin'li) → misafir WS lobide. */
export async function joinGuest(
  live: Live,
  t: Pick<TechSide, "token">,
  ip = "203.0.113.20",
): Promise<{ ws: WsClient; admitCode: string; guestId: string }> {
  const headers = { origin: ORIGIN, "x-forwarded-for": ip };
  const r = await live.app.inject({
    method: "POST",
    url: "/api/v1/public/sessions/resolve",
    headers,
    payload: { token: t.token, clientKind: "BROWSER" },
  });
  if (r.statusCode !== 200) throw new Error(`resolve ${r.statusCode} ${r.body}`);
  const { joinNonce, consentText } = r.json<{ joinNonce: string; consentText: { id: string } }>();
  const j = await live.app.inject({
    method: "POST",
    url: "/api/v1/public/sessions/join",
    headers,
    payload: { joinNonce, customerName: "Ayşe Müşteri", consentAccepted: true, consentTextId: consentText.id },
  });
  if (j.statusCode !== 200) throw new Error(`join ${j.statusCode} ${j.body}`);
  const { wsTicket, admitCode } = j.json<{ wsTicket: string; admitCode: string }>();
  const ws = await connect(`${live.base}/ws/guest`, ["rs.v1", `rs.ticket.${wsTicket}`], { origin: ORIGIN });
  await ws.waitFor("lobby.wait");
  return { ws, admitCode, guestId: "" };
}

/** Lobi → admit → iki tarafta hello/peer.joined. */
export async function admitted(live: Live, t: TechSide) {
  const g = await joinGuest(live, t);
  const pending = await t.ws.waitFor("peer.pending");
  t.ws.send({ t: "guest.admit", admitCode: g.admitCode });
  const hello = await g.ws.waitFor("hello");
  await t.ws.waitFor("peer.joined");
  return { guest: g.ws, hello, guestId: pending.guestId };
}

export type { TestUser };
