// P28u-K3 entegrasyon testleri ortak fikstürü: `rs.cap.consent1` bildiren sahte servis, politika/yetki kurulumu, istek yapıcılar.
import { WS_DEVICE_CAP_CONSENT, WS_DEVICE_SUBPROTOCOL } from "@remote/contracts/ws-device";
import { testDb, type Session } from "./app.ts";
import { closeSmtp, inboxTransport, loopbackNetguard, startInboxSmtp } from "./mail-tls.ts";
import { startLive, type Live } from "./signal-flow.ts";
import { UNSIGNED_ENV } from "./unattended.ts";
import { authMsg, ready, type Ready } from "./unattended-device.ts";
import { connect, type WsClient } from "./ws.ts";

export type ErrBody = { error: { code: string; fields?: Record<string, string> } };
export const REASON = "Müşteri sunucusu gece yanıt vermiyor, acil müdahale.";

/** Gerçek sunucu + süreç içi sahte SMTP (gelen kutusu). */
export async function startSilentLive(): Promise<{ live: Live; inbox: { to: string; body: string }[]; close(): Promise<void> }> {
  const inbox: { to: string; body: string }[] = [];
  const { smtp, port } = await startInboxSmtp(inbox);
  const live = await startLive({
    env: { ...UNSIGNED_ENV },
    signaling: { timing: { requestConnectMs: 1500 } },
    p10: { netguard: loopbackNetguard(), mailTransport: inboxTransport(() => port), mfaSetupEnforcement: false },
  });
  return {
    live,
    inbox,
    close: async () => {
      await live.close();
      await closeSmtp(smtp);
    },
  };
}

/** `rs.cap.consent1` bildiren sahte servis (`device.ready` alınmış). */
export async function capDevice(live: Live, dev: Ready["dev"]): Promise<WsClient> {
  const c = await connect(`${live.base}/ws/device`, [WS_DEVICE_SUBPROTOCOL, WS_DEVICE_CAP_CONSENT]);
  const hello = (await c.waitFor("device.hello" as never)) as unknown as { nonce: string };
  c.send(authMsg(dev, hello.nonce));
  await c.waitFor("device.ready" as never);
  return c;
}

export const setPolicy = (tenantId: string, on: boolean) =>
  testDb().tenantSettings.update({
    where: { tenantId },
    data: on ? { unattendedSilentEnabled: true, unattendedSilentAckAt: new Date() } : { unattendedSilentEnabled: false },
  });

/** Hazır fikstür + consent1 cihaz; `silentPerm` → teknisyende `unattended.silent`; `policy` → politika açık. */
export async function setup(live: Live, o: { silentPerm?: boolean; policy?: boolean } = {}): Promise<Ready> {
  const r = await ready(live, { online: false });
  if (o.silentPerm) await testDb().userPermission.create({ data: { userId: r.tech.id, permKey: "unattended.silent", granted: true } });
  if (o.policy) await setPolicy(r.tenantId, true);
  return { ...r, device: await capDevice(live, r.dev) };
}

export const connectReq = (r: Pick<Ready, "s" | "dev">, payload: object = {}) => ({
  method: "POST" as const,
  url: `/api/v1/unattended/devices/${r.dev.id}/connect`,
  headers: r.s.headers,
  payload,
});
export const policyReq = (s: Session, payload: object) => ({
  method: "PUT" as const,
  url: "/api/v1/unattended/policy",
  headers: s.headers,
  payload,
});
export const code = (res: { statusCode: number; json<T>(): T }) => `${res.statusCode} ${res.json<ErrBody>().error.code}`;
export const failAudits = async (deviceId: string) =>
  (await testDb().auditLog.findMany({ where: { entityId: deviceId, action: "unattended.connect", result: "fail" } })).map(
    (a) => a.newValue as Record<string, unknown>,
  );
export const noLog = { error: () => undefined };

/** "Subject:" başlığını (RFC 2047 base64/QP, katlanmış) çözer. */
export function decodeSubject(raw: string): string {
  const m = /^Subject: ((?:.*)(?:\r?\n[ \t].*)*)/m.exec(raw);
  if (!m?.[1]) return "";
  return m[1]
    .replace(/\r?\n[ \t]/g, " ")
    .replace(/=\?UTF-8\?([BQ])\?([^?]*)\?=\s*/gi, (_x, enc: string, data: string) =>
      enc.toUpperCase() === "B"
        ? Buffer.from(data, "base64").toString("utf8")
        : Buffer.from(
            data.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (_y, h: string) => String.fromCharCode(parseInt(h, 16))),
            "latin1",
          ).toString("utf8"),
    )
    .trim();
}
