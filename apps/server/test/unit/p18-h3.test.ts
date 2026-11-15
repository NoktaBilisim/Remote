// P18 H3 birim testleri: hub yetenek ayrımı ve activity birleştirme (AC-255, S-P18-T4), logger redaksiyonu (S-P18-T9),
// mesaj AAD'si (S-P18-T2), sohbet fikstürleri ve eski istemci şeması (geriye uyum).
import { Writable } from "node:stream";
import { readFileSync } from "node:fs";
import { requestOutboundSchema, type PanelOutbound, type RequestChatOutbound, type RequestOutbound } from "@remote/contracts/ws-request";
import { describe, expect, it } from "vitest";
import { aadFor, keyVersionOf, SecretBox } from "../../src/lib/crypto.ts";
import { createLogger } from "../../src/lib/logger.ts";
import { RequestHub, type JsonPeer, type PanelConn, type RequestConn } from "../../src/requests/hub.ts";
import { displayName } from "../../src/requests/messages.ts";
import { FakeClock } from "../helpers/ws.ts";

type Any = RequestOutbound | RequestChatOutbound;
function peer<T>(): JsonPeer<T> & { sent: T[] } {
  const p = { sent: [] as T[], send: (m: T) => void p.sent.push(m), close: () => undefined, isOpen: () => true };
  return p;
}
const hubOf = (clock: FakeClock) =>
  new RequestHub(
    clock,
    async () => new Map(),
    () => undefined,
    60_000,
  );
const conn = (id: string, chat: boolean): RequestConn & { peer: ReturnType<typeof peer<Any>> } => ({
  peer: peer<Any>(),
  caps: { chat },
  requestId: id,
  tenantId: "T",
  ipKey: "1.2.3.4",
  trusted: false,
});

describe("AC-255 geriye uyum — hub yetenek ayrımı", () => {
  it("AC-255: yeteneksiz (0.11.0) sokete sendChat/sendChatError 0 çerçeve; kapanışta yalnız request.closed", () => {
    const hub = hubOf(new FakeClock());
    const old = conn("R1", false);
    hub.attachRequest(old);
    expect(hub.sendChat("R1", { t: "request.chat", enabled: false })).toBe(false);
    expect(hub.sendChat("R1", { t: "request.messages", items: [] })).toBe(false);
    expect(hub.sendChatError("R1", "RATE_LIMITED", "x")).toBe(false);
    expect(hub.chatState("R1")).toBe("UNSUPPORTED");
    hub.closeRequest("R1", { t: "request.closed", status: "REJECTED", message: "Müsait değiliz" });
    expect(old.peer.sent.map((m) => m.t)).toEqual(["request.closed"]);
    expect(hub.chatState("R1")).toBe("OFFLINE");
    hub.shutdown();
  });

  it("AC-255: yetenekli sokete sohbet mesajları gider; kapanışta önce request.chat{enabled:false}", () => {
    const hub = hubOf(new FakeClock());
    const c = conn("R2", true);
    hub.attachRequest(c);
    expect(hub.chatState("R2")).toBe("SUPPORTED");
    expect(hub.sendChat("R2", { t: "request.messages", items: [] })).toBe(true);
    hub.closeRequest("R2", { t: "request.closed", status: "EXPIRED" });
    expect(c.peer.sent.map((m) => m.t)).toEqual(["request.messages", "request.chat", "request.closed"]);
    hub.shutdown();
  });

  it("AC-255: sohbet tipleri eski requestOutboundSchema'dan geçmez (0.11.0 ParseServer eşi)", () => {
    const fx = JSON.parse(readFileSync(new URL("../../../../packages/contracts/fixtures/ws-request.json", import.meta.url), "utf8")) as {
      valid: { requestChatOutbound: unknown[] };
    };
    for (const m of fx.valid.requestChatOutbound) expect(requestOutboundSchema.safeParse(m).success).toBe(false);
  });
});

describe("S-P18-T4 request.activity birleştirme", () => {
  it("S-P18-T4: talep başına ≤ 1/sn — ilk olay hemen, pencere içindekiler birleşir (son sender/at), sonra sessiz", () => {
    const clock = new FakeClock();
    const hub = hubOf(clock);
    const p = peer<PanelOutbound>();
    const pc: PanelConn = { peer: p, userId: "U", tokenHash: "h", token: "t", tenantId: "T" };
    hub.addPanel(pc);
    hub.activity("T", "R", "TECH", "a1");
    hub.activity("T", "R", "CUSTOMER", "a2");
    hub.activity("T", "R", "TECH", "a3");
    hub.activity("T", "R2", "CUSTOMER", "b1"); // başka talep ayrı pencere
    expect(p.sent).toHaveLength(2);
    clock.advance(1_000);
    expect(p.sent.at(-1)).toEqual({ t: "request.activity", id: "R", kind: "message", sender: "TECH", at: "a3" });
    expect(p.sent).toHaveLength(3);
    clock.advance(5_000);
    expect(p.sent).toHaveLength(3);
    hub.shutdown();
  });
});

describe("S-P18-T9 logger redaksiyonu", () => {
  it("S-P18-T9: body, *.body, *.*.body loglanmaz (gövde 0 kez)", () => {
    const lines: string[] = [];
    const log = createLogger(
      "info",
      new Writable({
        write(c: Buffer, _e, cb) {
          lines.push(c.toString());
          cb();
        },
      }),
    );
    log.info({ body: "GIZLI-1" }, "a");
    log.info({ msg: { body: "GIZLI-2" } }, "b");
    log.error({ err: { input: { body: "GIZLI-3" } } }, "c");
    const all = lines.join("");
    expect(lines).toHaveLength(3);
    expect(all).not.toMatch(/GIZLI-/);
    expect(all).toContain("***");
  });
});

describe("S-P18-T2 mesaj AAD'si ve anahtar sürümü", () => {
  it("S-P18-T2: AAD satıra bağlı (tenant|talep|id); sürüm ilk bayt; teknisyen adı süzülür", () => {
    const box = new SecretBox(new Map([[3, Buffer.alloc(32, 3)]]));
    const enc = box.encrypt("merhaba", aadFor.sessionMessage("T", "R", "M1"));
    expect(keyVersionOf(enc)).toBe(3);
    expect(box.decrypt(enc, aadFor.sessionMessage("T", "R", "M1"))).toBe("merhaba");
    for (const aad of [
      aadFor.sessionMessage("T", "R", "M2"),
      aadFor.sessionMessage("T2", "R", "M1"),
      aadFor.sessionMessage("T", "R2", "M1"),
    ])
      expect(() => box.decrypt(enc, aad)).toThrow();
    expect(displayName("Ali\u202E Veli")).toBe("Ali Veli");
    expect(displayName("")).toBe("Teknisyen");
    expect([...displayName("ğ".repeat(150))]).toHaveLength(100);
  });
});
