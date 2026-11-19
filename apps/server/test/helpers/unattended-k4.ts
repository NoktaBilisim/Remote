// P28u-K4 test yardımcıları (r3: tek kip): oturumu cihazın `consent.result{no_user}`'ıyla açma, teknisyen konsolu ve kontrolü açma.
import { createTenant, createUser, loginStepUp, ORIGIN, testDb } from "./app.ts";
import { createCustomerRow } from "./requests.ts";
import type { Live } from "./signal-flow.ts";
import { contactRow, grantRow, setSmtp } from "./unattended.ts";
import {
  connectReq,
  helperGuest,
  keyedDevice,
  onlineDevice,
  UN_TECH_PERMS,
  type ConnectMsg,
  type Legacy,
  type Ready,
} from "./unattended-device.ts";
import { connect, techHeaders, type WsClient } from "./ws.ts";

export const K4_PERMS = { ...UN_TECH_PERMS, "session_history.view": true };

/** `ready()` eşi; yetkiler ve eski servis (belirteçsiz / yalnız `consent1`) seçilebilir. */
export async function readyK4(live: Live, o: { perms?: Record<string, boolean>; legacy?: Legacy } = {}): Promise<Ready> {
  const t = await createTenant();
  await setSmtp(t.id);
  const customer = await createCustomerRow(t.id);
  await contactRow(t.id, customer.id);
  const tech = await createUser({ tenantId: t.id, role: "USER", perms: o.perms ?? K4_PERMS });
  const dev = await keyedDevice(t.id, customer.id);
  await grantRow(t.id, dev.id, tech.id);
  const s = await loginStepUp(live.app, tech);
  const device = await onlineDevice(live, dev, {}, o.legacy ?? false);
  return { tenantId: t.id, customerId: customer.id, tech, s, dev, device };
}

/** Bağlantı → cihaza `connect` (`consent.result` henüz gönderilmedi). */
export async function askConnect(live: Live, r: Ready): Promise<ConnectMsg> {
  const res = await live.app.inject(connectReq(r));
  if (res.statusCode !== 200) throw new Error(`connect ${res.statusCode} ${res.body}`);
  return (await r.device.waitFor("connect" as never)) as unknown as ConnectMsg;
}

/** r3 tek kip: bağlan → cihaz `consent.result{no_user}` → yardımcı kabul edilir (ACTIVE). */
export async function directSession(live: Live, r: Ready): Promise<{ sessionId: string; ticket: string; helper: WsClient }> {
  const msg = await askConnect(live, r);
  r.device.send({ t: "consent.result", sessionId: msg.sessionId, mode: "no_user" });
  const helper = await helperIn(live, msg.ticket);
  return { sessionId: msg.sessionId, ticket: msg.ticket, helper };
}

/** Yardımcı bağlanır ve kabul edilir (hello). */
export async function helperIn(live: Live, ticket: string): Promise<WsClient> {
  const h = await helperGuest(live, ticket);
  await h.waitFor("hello");
  return h;
}

/** Teknisyen konsolu (hello alınmış). */
export async function techConsole(live: Live, r: Ready, sessionId: string): Promise<{ ws: WsClient; hello: Record<string, unknown> }> {
  const ws = await connect(`${live.base}/ws/tech?sessionId=${sessionId}`, ["rs.v1"], techHeaders(r.s.token, ORIGIN));
  const hello = (await ws.waitFor("hello")) as unknown as Record<string, unknown>;
  return { ws, hello };
}

/** Konsol `control.request` → yardımcı P27 otomatik GRANTED → konsol GRANTED. */
export async function grantControl(tech: WsClient, helper: WsClient): Promise<void> {
  tech.send({ t: "control.request" });
  await helper.waitFor("control.request");
  helper.send({ t: "control.state", state: "GRANTED", source: "UNATTENDED" });
  for (;;) {
    const m = (await tech.waitFor("control.state")) as unknown as { state: string };
    if (m.state === "GRANTED") return;
  }
}

export const auditsOf = (entityId: string, action: string) =>
  testDb().auditLog.findMany({ where: { entityId, action }, orderBy: { id: "asc" } });
