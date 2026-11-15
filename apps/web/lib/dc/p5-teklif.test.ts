import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileTransfers, OFFER_LIMIT, OFFER_TIMEOUT_MS, SELF_OFFER_LIMIT, type FileChannelLike, type Transfer } from "./files";
import type { CtlMessage, FileMetaMsg } from "./ctl";

// TEST-P5-1: alıcı sınırı aşan teklifi sessizce düşürür; gönderen kilitte kalmamalı.
const ch = (): FileChannelLike => ({
  readyState: "open",
  bufferedAmount: 0,
  bufferedAmountLowThreshold: 0,
  send: () => undefined,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
});

/** Gönderen (konsol) ↔ alıcı (müşteri) eşi; ctl mesajları doğrudan karşıya iletilir. */
function pair(clock: { t: number }, selfThrottle = true) {
  const sent: CtlMessage[] = [];
  const meta: FileMetaMsg[] = [];
  let out: Transfer[] = [];
  let inc: Transfer[] = [];
  const holder: { a?: FileTransfers; b?: FileTransfers } = {};
  const a = new FileTransfers({
    inbound: "TO_TECH",
    file: ch(),
    sendMeta: (m) => meta.push(m),
    onChange: (l) => (out = l),
    allowed: () => true,
    now: () => clock.t,
    sendCtl: (m) => {
      sent.push(m);
      void holder.b!.onCtl(m);
    },
    selfThrottle: () => selfThrottle,
  });
  const b = new FileTransfers({
    inbound: "TO_CUSTOMER",
    file: ch(),
    sendMeta: () => undefined,
    onChange: (l) => (inc = l),
    allowed: () => true,
    now: () => clock.t,
    sendCtl: (m) => void holder.a!.onCtl(m),
  });
  holder.a = a;
  holder.b = b;
  return {
    a,
    b,
    sent,
    meta,
    get out() {
      return out;
    },
    get inc() {
      return inc;
    },
  };
}
const f = (n: string) => new File(["x"], n);

describe("TEST-P5-1 teklif kilidi", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("gönderen kendi teklif hızını sınırlar: 4. teklif çıkmaz ('rate'), pencere dolunca yeniden gönderilir", async () => {
    const c = { t: 0 };
    const r = pair(c);
    for (let i = 0; i < OFFER_LIMIT.max; i++) {
      expect(await r.a.send(f(`d${i}.txt`))).toBe("ok");
      r.a.cancel(r.out.at(-1)!.fid, "out"); // teklif kapanır → yeni gönderim serbest
      c.t += 1_000;
    }
    expect(await r.a.send(f("d4.txt"))).toBe("rate");
    expect(r.sent.filter((m) => m.t === "file.offer")).toHaveLength(OFFER_LIMIT.max);
    c.t = SELF_OFFER_LIMIT.windowMs;
    expect(await r.a.send(f("d5.txt"))).toBe("ok");
    expect(r.inc.at(-1)).toMatchObject({ name: "d5.txt", status: "pending" });
    const sent = r.sent.length;
    r.a.cancel("yok", "out"); // bilinmeyen teklif: etkisiz
    expect(r.sent).toHaveLength(sent);
    r.a.dispose(); // bağlantı koptu: bekleyen teklifin zaman aşımı da temizlenir
    vi.advanceTimersByTime(OFFER_TIMEOUT_MS * 2);
    expect(r.out.at(-1)?.status).not.toBe("timeout");
  });

  it("alıcı teklifi düşürürse gönderen OFFER_TIMEOUT_MS sonra 'timeout' olur, iptal + CANCELLED raporu gider, kilit açılır", async () => {
    const c = { t: 0 };
    const r = pair(c, false);
    for (let i = 0; i < OFFER_LIMIT.max; i++) {
      await r.a.send(f(`d${i}.txt`));
      r.a.cancel(r.out.at(-1)!.fid, "out");
    }
    expect(await r.a.send(f("y.scr"))).toBe("ok");
    expect(r.b.dropped).toBe(1);
    expect(r.out.at(-1)?.status).toBe("offered");
    expect(await r.a.send(f("z.txt"))).toBe("busy");
    vi.advanceTimersByTime(OFFER_TIMEOUT_MS - 1);
    expect(r.out.at(-1)?.status).toBe("offered");
    vi.advanceTimersByTime(1);
    const last = r.out.at(-1)!;
    expect(last.status).toBe("timeout");
    expect(r.sent.at(-1)).toEqual({ t: "file.cancel", fid: last.fid });
    expect(r.meta.at(-1)).toMatchObject({ result: "CANCELLED", fileName: "y.scr" });
    c.t = OFFER_LIMIT.windowMs;
    expect(await r.a.send(f("z.txt"))).toBe("ok");
    expect(r.inc.at(-1)).toMatchObject({ name: "z.txt", status: "pending" });
  });

  it("'offered' satırında iptal kilidi her zaman açar; geç gelen kabul yok sayılır, zamanlayıcı temizlenir", async () => {
    const c = { t: 0 };
    const r = pair(c);
    await r.a.send(f("a.txt"));
    const fid = r.out[0]!.fid;
    r.a.cancel(fid, "out");
    expect(r.out[0]?.status).toBe("cancelled");
    expect(r.inc[0]?.status).toBe("cancelled"); // alıcı diyaloğu kapanır
    await r.a.onCtl({ t: "file.accept", fid });
    expect(r.out[0]?.status).toBe("cancelled");
    vi.advanceTimersByTime(OFFER_TIMEOUT_MS);
    expect(r.out[0]?.status).toBe("cancelled");
    expect(vi.getTimerCount()).toBe(0);
    expect(await r.a.send(f("b.txt"))).toBe("ok");
  });

  it("kabul gelince zaman aşımı kurulmaz kalmaz (aktarım sürerken 'timeout' olmaz)", async () => {
    const c = { t: 0 };
    const r = pair(c);
    await r.a.send(f("a.txt"));
    await r.b.accept(r.inc[0]!.fid);
    vi.advanceTimersByTime(OFFER_TIMEOUT_MS * 2);
    expect(r.out[0]?.status).not.toBe("timeout");
  });
});
