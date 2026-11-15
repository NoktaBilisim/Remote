// P27-K3 test yardımcıları: Ed25519 anahtarlı gerçek cihaz satırı, sahte servis istemcisi (`/ws/device`), sahte yardımcı
// (`/ws/guest` bileti) ve hazır bağlantı fikstürü (firma + müşteri + adres + SMTP + yetkili teknisyen + çevrimiçi cihaz).
import { generateKeyPairSync, sign } from "node:crypto";
import { deviceAuthMessage, WS_DEVICE_SUBPROTOCOL } from "@remote/contracts/ws-device";
import { newId } from "../../src/lib/ids.ts";
import { createTenant, createUser, loginStepUp, ORIGIN, testDb, type Session, type TestUser } from "./app.ts";
import { createCustomerRow } from "./requests.ts";
import type { Live } from "./signal-flow.ts";
import { contactRow, grantRow, SHA, setSmtp } from "./unattended.ts";
import { connect, type WsClient } from "./ws.ts";

export interface KeyedDevice {
  id: string;
  sig(nonce: string, origin?: string): string;
}

/** Ed25519 anahtar çifti üretir, açık anahtarı cihaz satırına yazar. */
export async function keyedDevice(tenantId: string, customerId: string, o: { lastIp?: string; localEnabled?: boolean } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x ?? "", "base64url");
  const id = newId();
  await testDb().unattendedDevice.create({
    data: {
      id,
      tenantId,
      customerId,
      name: `PC-${id.slice(-6)}`,
      publicKey: raw,
      osVersion: "Windows 11 Pro",
      agentVersion: "1.0.0",
      binarySha256: SHA,
      signed: false,
      localEnabled: o.localEnabled ?? true,
      registeredIp: "198.51.100.7",
      lastIp: o.lastIp ?? "127.0.0.1",
    },
  });
  const dev: KeyedDevice = {
    id,
    sig: (nonce, origin = ORIGIN) => sign(null, Buffer.from(deviceAuthMessage(nonce, id, origin)), privateKey).toString("base64url"),
  };
  return dev;
}

const authMsg = (dev: KeyedDevice, nonce: string, extra: Record<string, unknown> = {}) => ({
  t: "device.auth",
  deviceId: dev.id,
  sig: dev.sig(nonce),
  version: "1.0.0",
  sha256: SHA,
  signed: false,
  localEnabled: true,
  osVersion: "Windows 11 Pro",
  ...extra,
});

/** Ham `/ws/device` soketi (hello alınmış); `nonce` döner. */
export async function rawDevice(live: Live, headers: Record<string, string> = {}): Promise<{ c: WsClient; nonce: string }> {
  const c = await connect(`${live.base}/ws/device`, [WS_DEVICE_SUBPROTOCOL], headers);
  const hello = (await c.waitFor("device.hello" as never)) as unknown as { nonce: string };
  return { c, nonce: hello.nonce };
}

/** Kimliği doğrulanmış cihaz soketi (`device.ready` alınmış). */
export async function onlineDevice(live: Live, dev: KeyedDevice, extra: Record<string, unknown> = {}): Promise<WsClient> {
  const { c, nonce } = await rawDevice(live);
  c.send(authMsg(dev, nonce, extra));
  await c.waitFor("device.ready" as never);
  return c;
}

export { authMsg };

export interface ConnectMsg {
  sessionId: string;
  ticket: string;
  indicatorText: string;
  expiresInSec: number;
}

/** Yardımcı: bilet ile `/ws/guest` (AGENT: Origin yok). */
export function helperGuest(live: Live, ticket: string): Promise<WsClient> {
  return connect(`${live.base}/ws/guest`, ["rs.v1", `rs.ticket.${ticket}`]);
}

export interface Ready {
  tenantId: string;
  customerId: string;
  tech: TestUser;
  s: Session;
  dev: KeyedDevice;
  device: WsClient;
}

export const UN_TECH_PERMS = { "unattended.connect": true, "remote_control.use": true, "file_transfer.use": true, "sessions.view": true };

/** Bağlanmaya hazır fikstür: tüm ön koşullar sağlanmış, cihaz çevrimiçi, teknisyen step-up'lı. */
export async function ready(live: Live, o: { online?: boolean } = {}): Promise<Ready> {
  const t = await createTenant();
  await setSmtp(t.id);
  const customer = await createCustomerRow(t.id);
  await contactRow(t.id, customer.id);
  const tech = await createUser({ tenantId: t.id, role: "USER", perms: UN_TECH_PERMS });
  const dev = await keyedDevice(t.id, customer.id);
  await grantRow(t.id, dev.id, tech.id);
  const s = await loginStepUp(live.app, tech);
  const device = o.online === false ? (undefined as unknown as WsClient) : await onlineDevice(live, dev);
  return { tenantId: t.id, customerId: customer.id, tech, s, dev, device };
}

export const connectReq = (r: Pick<Ready, "s" | "dev">) => ({
  method: "POST" as const,
  url: `/api/v1/unattended/devices/${r.dev.id}/connect`,
  headers: r.s.headers,
  payload: {},
});

export async function waitUntil(fn: () => Promise<boolean>, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("koşul zaman aşımı");
}

/** Bağlan → cihaza `connect` → yardımcı bilete bağlanır → hello; oturum ACTIVE. */
export async function activeSession(live: Live, r: Ready): Promise<{ sessionId: string; helper: WsClient; msg: ConnectMsg }> {
  const res = await live.app.inject(connectReq(r));
  if (res.statusCode !== 200) throw new Error(`connect ${res.statusCode} ${res.body}`);
  const msg = (await r.device.waitFor("connect" as never)) as unknown as ConnectMsg;
  const helper = await helperGuest(live, msg.ticket);
  await helper.waitFor("hello");
  return { sessionId: msg.sessionId, helper, msg };
}

export const sessionStatus = async (id: string) =>
  testDb().supportSession.findUniqueOrThrow({ where: { id }, select: { status: true, endReason: true, mode: true } });
