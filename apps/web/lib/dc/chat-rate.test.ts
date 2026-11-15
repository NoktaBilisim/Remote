import { CHAT_SEND_PER_SEC } from "@remote/contracts/dc";
import { describe, expect, it } from "vitest";
import { chatSendLimiter, IN_LIMITS, inboundLimiter } from "./rate";

describe("AC-227 (TEST-P5-4): gönderen tarafta sohbet hız sınırı", () => {
  it("AC-227: sınır tek sabitten — saniyede 5 mesaj", () => {
    expect(CHAT_SEND_PER_SEC).toBe(5);
  });

  it("AC-227: alıcı sınırı ≥ gönderen sınırı", () => {
    expect(IN_LIMITS.chat).toBeGreaterThanOrEqual(CHAT_SEND_PER_SEC);
  });

  it("AC-227: 1 sn içinde 6. mesaj reddedilir (kuyruğa alınmaz), pencere geçince yeniden gönderilir", () => {
    let now = 0;
    const lim = chatSendLimiter(() => now);
    const sent = Array.from({ length: 8 }, () => lim.take()).filter(Boolean).length;
    expect(sent).toBe(CHAT_SEND_PER_SEC);
    now = 999;
    expect(lim.take()).toBe(false);
    now = 1000;
    expect(lim.take()).toBe(true);
  });

  it("AC-227: gönderenin geçirdiği mesajlar ağ gecikmesinde sıkışsa da alıcıda sessizce düşmez", () => {
    // 10 sn boyunca her 20 ms'de bir yazma denemesi; gönderen sınırı geçenler 0–400 ms rastgele gecikmeyle sıralı varır
    let sendNow = 0;
    const send = chatSendLimiter(() => sendNow);
    let seed = 7;
    const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647) * 400;
    const arrivals: number[] = [];
    let last = 0;
    for (sendNow = 0; sendNow < 10_000; sendNow += 20) {
      if (!send.take()) continue;
      last = Math.max(last, sendNow + rnd()); // DataChannel sıralı: geç kalan öncekini geçemez
      arrivals.push(last);
    }
    let recvNow = 0;
    const allow = inboundLimiter(() => recvNow);
    let dropped = 0;
    for (const at of arrivals) {
      recvNow = at;
      if (!allow("chat")) dropped++;
    }
    expect(arrivals.length).toBeGreaterThan(40);
    expect(dropped).toBe(0);
  });
});
