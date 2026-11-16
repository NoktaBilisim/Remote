// P28a AC-352 (O-P28a-4, V45): gözetimsiz odada sunucu yardımcının `rs.cap.*` belirteçlerini okumaz — cihaz bileti
// soketi `rs.cap.clip1, rs.cap.print1` gönderse de guestFeatures=[]; teknisyenin print.request/clip.push → FORBIDDEN.
// Gerçek WS + MySQL; gözetimsiz kurulum P27-K3 yardımcılarıyla (sahte servis + sahte yardımcı).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createUser, loginStepUp, ORIGIN } from "../helpers/app.ts";
import { createCustomerRow } from "../helpers/requests.ts";
import { startLive, type Live } from "../helpers/signal-flow.ts";
import { contactRow, grantRow, setSmtp, UNSIGNED_ENV } from "../helpers/unattended.ts";
import { connectReq, keyedDevice, onlineDevice, UN_TECH_PERMS, type ConnectMsg } from "../helpers/unattended-device.ts";
import { connect, techHeaders, type WsClient } from "../helpers/ws.ts";

let live: Live;
beforeAll(async () => {
  live = await startLive({ env: { ...UNSIGNED_ENV } });
});
afterAll(async () => live.close());

const PERMS = { ...UN_TECH_PERMS, "remote_control.clipboard": true, "file_transfer.print": true };
const CAPS = ["rs.cap.clip1", "rs.cap.print1"];
const ID = (n: number) => `p28a-ac352-${String(n).padStart(4, "0")}`;

/** Pano/yazdırma yetkili teknisyenle gözetimsiz oda: yardımcı `caps` ile cihaz biletine bağlanır, sonra teknisyen konsolu. */
async function unattendedRoom(caps: string[]) {
  const t = await createTenant();
  await setSmtp(t.id);
  const customer = await createCustomerRow(t.id);
  await contactRow(t.id, customer.id);
  const tech = await createUser({ tenantId: t.id, role: "USER", perms: PERMS });
  const dev = await keyedDevice(t.id, customer.id);
  await grantRow(t.id, dev.id, tech.id);
  const s = await loginStepUp(live.app, tech);
  const device = await onlineDevice(live, dev);
  const res = await live.app.inject(connectReq({ s, dev }));
  expect(res.statusCode).toBe(200);
  const msg = (await device.waitFor("connect" as never)) as unknown as ConnectMsg;
  device.send({ t: "consent.result", sessionId: msg.sessionId, mode: "no_user" }); // P28u K-P28u-3
  const helper = await connect(`${live.base}/ws/guest`, ["rs.v1", `rs.ticket.${msg.ticket}`, ...caps]);
  const helperHello = await helper.waitFor("hello");
  const console_ = await connect(`${live.base}/ws/tech?sessionId=${msg.sessionId}`, ["rs.v1"], techHeaders(s.token, ORIGIN));
  const techHello = await console_.waitFor("hello");
  return { sessionId: msg.sessionId, helper, helperHello, tech: console_, techHello };
}

/**
 * Gözetimsiz odada oda caps'i yalnız remote_control/file_transfer (admit-device.ts) ve misafir özelliği boş: kapı ilk adımda
 * (oturum caps'i) FORBIDDEN döner. Mesaj metni değil kod ve misafire hiçbir şey iletilmemesi bağlayıcıdır (AC-352: 403).
 */
async function expectDenied(tech: WsClient, helper: WsClient): Promise<void> {
  tech.send({ t: "print.request", pid: ID(1), sizeBytes: 100 });
  expect(await tech.waitFor("error")).toMatchObject({ code: "FORBIDDEN" });
  tech.send({ t: "clip.push", cid: ID(2), bytes: 5 });
  expect(await tech.waitFor("error")).toMatchObject({ code: "FORBIDDEN" });
  expect(helper.msgs.filter((m) => m.t.startsWith("print.") || m.t.startsWith("clip."))).toHaveLength(0);
}

describe("P28a AC-352 — gözetimsiz odada pano/yazdırma kapalı (O-P28a-4)", () => {
  it("AC-352: cihaz bileti soketi rs.cap.clip1+print1 gönderir → guestFeatures=[], caps yeni değer içermez; print.request ve clip.push → 403 FORBIDDEN", async () => {
    const x = await unattendedRoom(CAPS);
    expect(x.helperHello).toMatchObject({ caps: ["remote_control", "file_transfer"] });
    expect(x.techHello).not.toHaveProperty("guestFeatures");
    expect(x.techHello).not.toHaveProperty("clipConsent");
    expect(x.techHello).toMatchObject({ unattended: expect.any(Object) });
    await expectDenied(x.tech, x.helper);
    // Misafirin pano izni açma girişimi de yok sayılmaz: özellik yok → soket ihlali (eski istemciyle aynı, 1008).
    x.helper.send({ t: "clip.consent", on: true });
    expect((await x.helper.closed).code).toBe(1008);
  });

  it("AC-352: gözetimsiz odada yetenek göndermeyen (eski) yardımcı → aynı FORBIDDEN davranışı", async () => {
    const x = await unattendedRoom([]);
    expect(x.helperHello).toMatchObject({ caps: ["remote_control", "file_transfer"] });
    expect(x.techHello).not.toHaveProperty("guestFeatures");
    await expectDenied(x.tech, x.helper);
  });
});
