// P28u-K4 test yardımcıları: izinli (`ask`) oturumu cihaz onay sonucuyla açma, izinsiz (`silent`) oturumu K3 bağlantı ucundan
// bağımsız kurma (PENDING satır `consent_mode='silent'` + `preAdmitDevice`), teknisyen konsolu ve kontrolü açma.
import { newId, newSecretToken, sha256Hex } from "../../src/lib/ids.ts";
import { preAdmitDevice } from "../../src/signaling/rooms-device.ts";
import { createTenant, createUser, loginStepUp, ORIGIN, testDb } from "./app.ts";
import { createCustomerRow } from "./requests.ts";
import type { Live } from "./signal-flow.ts";
import { contactRow, grantRow, setSmtp } from "./unattended.ts";
import { connectReq, helperGuest, keyedDevice, onlineDevice, UN_TECH_PERMS, type ConnectMsg, type Ready } from "./unattended-device.ts";
import { connect, techHeaders, type WsClient } from "./ws.ts";

export const SILENT_PERMS = { ...UN_TECH_PERMS, "unattended.silent": true, "session_history.view": true };
export const REASON = "Sunucu bakım penceresi; kullanıcıya ulaşılamadı.";

/** `ready()` eşi; yetkiler ve eski servis (belirteçsiz) seçilebilir. */
export async function readyK4(live: Live, o: { perms?: Record<string, boolean>; legacy?: boolean } = {}): Promise<Ready> {
  const t = await createTenant();
  await setSmtp(t.id);
  const customer = await createCustomerRow(t.id);
  await contactRow(t.id, customer.id);
  const tech = await createUser({ tenantId: t.id, role: "USER", perms: o.perms ?? SILENT_PERMS });
  const dev = await keyedDevice(t.id, customer.id);
  await grantRow(t.id, dev.id, tech.id);
  const s = await loginStepUp(live.app, tech);
  const device = await onlineDevice(live, dev, {}, o.legacy ?? false);
  return { tenantId: t.id, customerId: customer.id, tech, s, dev, device };
}

/** `ask` bağlantısı → cihaza `connect` (onay sonucu henüz yok). */
export async function askConnect(live: Live, r: Ready): Promise<ConnectMsg> {
  const res = await live.app.inject(connectReq(r));
  if (res.statusCode !== 200) throw new Error(`connect ${res.statusCode} ${res.body}`);
  return (await r.device.waitFor("connect" as never)) as unknown as ConnectMsg;
}

export async function setPolicy(tenantId: string, on: boolean, ackBy: string): Promise<void> {
  await testDb().tenantSettings.update({
    where: { tenantId },
    data: on
      ? { unattendedSilentEnabled: true, unattendedSilentAckAt: new Date(), unattendedSilentAckBy: ackBy }
      : { unattendedSilentEnabled: false },
  });
}

/** İzinsiz oturum (K3 ucundan bağımsız): politika açık, PENDING `silent` satır + oda + bilet. */
export async function silentPending(live: Live, r: Ready, o: { policy?: boolean } = {}): Promise<{ sessionId: string; ticket: string }> {
  await setPolicy(r.tenantId, o.policy ?? true, r.tech.id);
  const id = newId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60_000);
  const dev = await testDb().unattendedDevice.findUniqueOrThrow({ where: { id: r.dev.id }, select: { name: true } });
  await testDb().supportSession.create({
    data: {
      id,
      tenantId: r.tenantId,
      technicianId: r.tech.id,
      deviceId: r.dev.id,
      customerId: r.customerId,
      customerName: dev.name,
      tokenHash: sha256Hex(newSecretToken()),
      techVerifyCode: "1234",
      status: "PENDING",
      createdAt: now,
      expiresAt,
      consentMode: "silent",
      silentReason: REASON,
    },
  });
  const row = { id, tenantId: r.tenantId, technicianId: r.tech.id, technician: { fullName: "Teknisyen" }, expiresAt };
  const { ticket } = preAdmitDevice(live.app.rooms, row, {
    deviceId: r.dev.id,
    deviceName: dev.name,
    customerId: r.customerId,
    consent: "silent",
  });
  return { sessionId: id, ticket };
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

/** Konsol "Müdahale et" → yardımcı P27 otomatik GRANTED → konsol GRANTED. */
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
