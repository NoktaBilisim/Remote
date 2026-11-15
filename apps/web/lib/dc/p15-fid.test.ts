import { describe, expect, it } from "vitest";
import { fileMetaSchema } from "@remote/contracts/ws";
import { FileTransfers, type FileChannelLike } from "./files";
import type { CtlMessage, FileMetaMsg } from "./ctl";

/** Bir uç: gönderdiği ctl ve file çerçeveleri karşı uca aktarılmak üzere toplanır. */
function end(inbound: "TO_CUSTOMER" | "TO_TECH") {
  const ctl: CtlMessage[] = [];
  const frames: ArrayBuffer[] = [];
  const meta: FileMetaMsg[] = [];
  const file: FileChannelLike = {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    send: (d: Uint8Array<ArrayBuffer>) => void frames.push(d.slice().buffer),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  const ft = new FileTransfers({
    inbound,
    file,
    sendCtl: (m) => ctl.push(m),
    sendMeta: (m) => meta.push(m),
    onChange: () => undefined,
    allowed: () => true,
  });
  return { ft, ctl, frames, meta };
}

/** a'nın bekleyen ctl/çerçevelerini b'ye iletir (sıra korunur). */
async function pump(a: ReturnType<typeof end>, b: ReturnType<typeof end>) {
  for (const m of a.ctl.splice(0)) await b.ft.onCtl(m);
  for (const f of a.frames.splice(0)) b.ft.onFrame(f);
}

describe("AC-238 file.meta fid (P15 düzeltme 1, QA 1)", () => {
  it("AC-238: teknisyen gönderir, müşteri alır → iki uç aynı fid + yön + özet ile file.meta gönderir (sunucu şemasına uyar)", async () => {
    const tech = end("TO_TECH"); // konsol: gelen TO_TECH, giden TO_CUSTOMER
    const guest = end("TO_CUSTOMER");
    expect(await tech.ft.send(new File(["merhaba dünya"], "not.txt"))).toBe("ok");
    const offer = tech.ctl.find((m) => m.t === "file.offer") as Extract<CtlMessage, { t: "file.offer" }>;
    await pump(tech, guest);
    await guest.ft.accept(offer.fid);
    await pump(guest, tech); // file.accept → gönderim başlar
    await new Promise((r) => setTimeout(r, 0));
    await pump(tech, guest); // çerçeveler + file.done
    await pump(guest, tech); // file.result
    await new Promise((r) => setTimeout(r, 0));
    await pump(guest, tech);

    expect(guest.meta).toHaveLength(1);
    expect(tech.meta).toHaveLength(1);
    const [g, t] = [guest.meta[0], tech.meta[0]];
    expect(g).toMatchObject({ fid: offer.fid, direction: "TO_CUSTOMER", result: "OK", sha256: offer.sha256, sizeBytes: offer.size });
    expect(t).toMatchObject({ fid: offer.fid, direction: "TO_CUSTOMER", result: "OK", sha256: offer.sha256, sizeBytes: offer.size });
    expect(fileMetaSchema.safeParse(g).success).toBe(true);
    expect(fileMetaSchema.safeParse(t).success).toBe(true);
  });

  it("AC-238: müşteri gönderir, teknisyen alır (TO_TECH) — ret raporu da fid taşır", async () => {
    const guest = end("TO_CUSTOMER");
    const tech = end("TO_TECH");
    expect(await guest.ft.send(new File(["x"], "a.txt"))).toBe("ok");
    const offer = guest.ctl.find((m) => m.t === "file.offer") as Extract<CtlMessage, { t: "file.offer" }>;
    await pump(guest, tech);
    tech.ft.reject(offer.fid);
    await pump(tech, guest);
    expect(tech.meta.at(-1)).toMatchObject({ fid: offer.fid, direction: "TO_TECH", result: "REJECTED" });
    expect(guest.meta.at(-1)).toMatchObject({ fid: offer.fid, direction: "TO_TECH", result: "REJECTED" });
  });
});
