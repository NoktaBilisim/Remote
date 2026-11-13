// P12b (AC-196): WhatsappNotifier etkin adresi çalışırken değişir; configured/insecure/usable etkin adresten; test ucu
// tek deneme, 8 sn zaman aşımı, yönlendirme izlenmez, güvensiz/yapılandırılmamış adrese istek gönderilmez.
import { WA_TEST_MESSAGES } from "@remote/contracts/api/system-settings";
import { describe, expect, it } from "vitest";
import type { Db } from "../../src/lib/db.ts";
import { auditValueView } from "../../src/audit/view.ts";
import { WA_TIMEOUT_MS, WhatsappNotifier, isInsecureServiceUrl, type FetchLike } from "../../src/notify/whatsapp.ts";
import { createMetrics } from "../../src/ops/metrics.ts";
import { FakeClock } from "../helpers/ws.ts";

interface Call {
  url: string;
  body: string;
  redirect: string;
}

function make(o: { url: string; production?: boolean; respond?: (url: string) => ReturnType<FetchLike> }) {
  const calls: Call[] = [];
  const warns: Record<string, unknown>[] = [];
  const errors: Record<string, unknown>[] = [];
  const clock = new FakeClock();
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, body: init.body, redirect: init.redirect });
    return o.respond ? o.respond(url) : { ok: true, status: 200 };
  };
  const log = { info: () => undefined, warn: (obj: object) => void warns.push(obj as Record<string, unknown>), error: (obj: object) => void errors.push(obj as Record<string, unknown>) };
  const n = new WhatsappNotifier({ url: o.url, production: o.production ?? false, publicBaseUrl: "https://rs.test", db: {} as Db, log, metrics: createMetrics(), clock, fetch });
  return { n, calls, warns, errors, clock };
}

describe("P12b WhatsApp etkin adres (AC-196)", () => {
  it("AC-196: setUrl sonrası test yeni adrese gider (yeniden başlatma yok); adres yolu korunur, sondaki / kırpılır; redirect manual", async () => {
    const { n, calls } = make({ url: "http://127.0.0.1:3000" });
    expect(await n.test("+905321112233")).toEqual({ ok: true, message: WA_TEST_MESSAGES.ok, reason: null });
    n.setUrl("https://wa.example.com/api/");
    expect(n.effectiveUrl).toBe("https://wa.example.com/api/");
    await n.test("+905321112233");
    expect(calls.map((c) => c.url)).toEqual(["http://127.0.0.1:3000/test-send", "https://wa.example.com/api/test-send"]);
    expect(calls.every((c) => c.redirect === "manual")).toBe(true);
    expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({ phoneNumber: "905321112233" });
  });

  it("AC-196 / AC-150: production'da güvensiz adrese geçiş kanalı kapatır (alarm logu), güvenli adrese dönüş açar; güvensizde istek yok", async () => {
    const { n, calls, warns } = make({ url: "http://10.0.0.5:3000", production: true });
    expect(n.usable).toBe(true);
    expect(warns).toHaveLength(0);
    n.setUrl("http://203.0.113.10:3000");
    expect({ configured: n.configured, insecure: n.insecure, usable: n.usable }).toEqual({ configured: true, insecure: true, usable: false });
    expect(warns.filter((w) => w.alarm === "whatsapp_insecure")).toHaveLength(1);
    expect(JSON.stringify(warns)).not.toContain("203.0.113.10");
    expect(await n.test("+905321112233")).toEqual({ ok: false, message: "Servis güvenli yapılandırılmamış.", reason: "insecure" });
    expect(calls).toHaveLength(0);
    n.setUrl("https://wa.example.com");
    expect({ insecure: n.insecure, usable: n.usable }).toEqual({ insecure: false, usable: true });
    // staging (production değil): aynı http + genel adres güvenli sayılır
    const staging = make({ url: "http://203.0.113.10:3000" });
    expect(staging.n.insecure).toBe(false);
  });

  it("AC-196: boş adres → yapılandırılmamış; test istek göndermeden ok:false", async () => {
    const { n, calls } = make({ url: "http://127.0.0.1:3000" });
    n.setUrl("");
    expect({ configured: n.configured, usable: n.usable }).toEqual({ configured: false, usable: false });
    expect(await n.test("+905321112233")).toEqual({ ok: false, message: "Servis yapılandırılmamış.", reason: "unconfigured" });
    expect(calls).toHaveLength(0);
  });

  it("AC-196: servis hatası / 3xx / ağ hatası / 8 sn zaman aşımı → tek deneme, sabit mesaj, sınıflı neden", async () => {
    const status = (s: number) => make({ url: "http://127.0.0.1:3000", respond: async () => ({ ok: s < 300, status: s }) });
    const e500 = status(500);
    expect(await e500.n.test("+905321112233")).toEqual({ ok: false, message: WA_TEST_MESSAGES.http_error, reason: "http_error" });
    expect(e500.calls).toHaveLength(1);
    const r307 = status(307);
    expect(await r307.n.test("+905321112233")).toMatchObject({ ok: false, reason: "redirect" });
    expect(r307.calls).toHaveLength(1);
    const down = make({ url: "http://127.0.0.1:3000", respond: async () => Promise.reject(new TypeError("fetch failed: connect ECONNREFUSED 127.0.0.1:3000")) });
    const out = await down.n.test("+905321112233");
    expect(out).toEqual({ ok: false, message: WA_TEST_MESSAGES.unreachable, reason: "unreachable" });
    expect(out.message).not.toContain("127.0.0.1");

    let signal: AbortSignal | undefined;
    const clock = new FakeClock();
    const hangFetch: FetchLike = (_url, init) =>
      new Promise((_res, rej) => {
        signal = init.signal;
        init.signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
      });
    const slow = new WhatsappNotifier({ url: "http://127.0.0.1:3000", production: false, publicBaseUrl: "https://rs.test", db: {} as Db, log: { info: () => undefined, warn: () => undefined, error: () => undefined }, metrics: createMetrics(), clock, fetch: hangFetch });
    const p = slow.test("+905321112233");
    await Promise.resolve();
    clock.advance(WA_TIMEOUT_MS - 1);
    expect(signal?.aborted).toBe(false);
    clock.advance(1);
    expect(await p).toEqual({ ok: false, message: WA_TEST_MESSAGES.timeout, reason: "timeout" });
  });

  it("B-P12b-1: ayrıştırılamayan adres (DB CHECK'ten geçen http://a:99999) → önce sınıflandır sonra ata: kanal kapalı, alarm, istek yok; her ortamda", async () => {
    for (const production of [false, true]) {
      const { n, calls, errors } = make({ url: "https://wa.example.com", production });
      expect(() => n.setUrl("http://a:99999")).not.toThrow();
      expect({ url: n.effectiveUrl, configured: n.configured, insecure: n.insecure, usable: n.usable }).toEqual({ url: "http://a:99999", configured: true, insecure: true, usable: false });
      expect(errors.filter((e) => e.alarm === "whatsapp_invalid_url")).toHaveLength(1);
      expect(JSON.stringify(errors)).not.toContain("99999");
      expect(await n.test("+905321112233")).toMatchObject({ ok: false, reason: "insecure" });
      expect(calls).toHaveLength(0);
      n.setUrl("https://wa.example.com");
      expect(n.usable).toBe(true);
    }
    // GET görünümü de fırlatmaz (fail-closed)
    expect(isInsecureServiceUrl("http://a:99999", false)).toBe(true);
    // açılışta (constructor) da aynı
    expect(make({ url: "http://[::1", production: false }).n.usable).toBe(false);
  });

  it("B-P12b-6: yanıt gövdesi her sonuçta iptal edilir (2xx, 5xx, 3xx); okunmaz", async () => {
    for (const status of [200, 500, 307]) {
      let cancelled = 0;
      const body = { cancel: async () => void (cancelled += 1) };
      const { n } = make({ url: "http://127.0.0.1:3000", respond: async () => ({ ok: status < 300, status, body }) });
      await n.test("+905321112233");
      expect(cancelled, String(status)).toBe(1);
    }
    // cancel reddi sonucu bozmaz
    const rejecting = make({ url: "http://127.0.0.1:3000", respond: async () => ({ ok: true, status: 200, body: { cancel: () => Promise.reject(new Error("x")) } }) });
    expect(await rejecting.n.test("+905321112233")).toMatchObject({ ok: true });
  });

  it("QA-P12b: iki test ucunun audit numara anahtarı `recipient` — audit görünümünde maskeli kalır", () => {
    expect(auditValueView("settings.whatsapp.test", { recipient: "+90******2233", result: "fail", reason: "insecure" })).toEqual({ recipient: "+90******2233", result: "fail", reason: "insecure" });
  });
});
