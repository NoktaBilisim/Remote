import { describe, expect, it } from "vitest";
import { agentDownloadUrl, probeAgentDownload } from "./agent-download";

const json = (status: number, code: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { code, message: "x", requestId: "01JREQ" } }), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
const fake = (r: Response | Error) => (async () => {
  if (r instanceof Error) throw r;
  return r;
}) as unknown as typeof fetch;

describe("probeAgentDownload (AC-27)", () => {
  it("adres opak ref'i kodlar, aynı origin /api/v1", () =>
    expect(agentDownloadUrl("a+b/c")).toBe("/api/v1/public/agent/download?ref=a%2Bb%2Fc"));

  it("yönlendirme (opaqueredirect) → ok, isteği redirect: manual ile atar", async () => {
    let init: RequestInit | undefined;
    const f = (async (_u: string, i: RequestInit) => {
      init = i;
      return { type: "opaqueredirect", status: 0 } as Response;
    }) as unknown as typeof fetch;
    expect(await probeAgentDownload("ref", f)).toEqual({ kind: "ok" });
    expect(init?.redirect).toBe("manual");
  });

  it("302 (Node fetch) → ok", async () =>
    expect(await probeAgentDownload("ref", fake(new Response(null, { status: 302, headers: { Location: "/downloads/Destek-12345678.exe" } })))).toEqual({ kind: "ok" }));

  it("503 NOT_READY → notReady (tarayıcı moduna öner)", async () =>
    expect(await probeAgentDownload("ref", fake(json(503, "NOT_READY")))).toEqual({ kind: "notReady" }));

  it.each([
    ["SESSION_EXPIRED", "expired"],
    ["SESSION_CANCELLED", "cancelled"],
    ["SESSION_CONSUMED", "consumed"],
  ] as const)("410 %s → %s", async (code, end) =>
    expect(await probeAgentDownload("ref", fake(json(410, code)))).toEqual({ kind: "end", end }));

  it("404 → notFound", async () =>
    expect(await probeAgentDownload("ref", fake(json(404, "NOT_FOUND")))).toEqual({ kind: "end", end: "notFound" }));

  it("429 → rate + Retry-After", async () =>
    expect(await probeAgentDownload("ref", fake(json(429, "RATE_LIMITED", { "Retry-After": "900" })))).toEqual({ kind: "rate", retryAfter: 900 }));

  it("500 → error + requestId; ağ hatası → error", async () => {
    expect(await probeAgentDownload("ref", fake(json(500, "INTERNAL")))).toEqual({ kind: "error", requestId: "01JREQ" });
    expect(await probeAgentDownload("ref", fake(new TypeError("net")))).toEqual({ kind: "error" });
  });
});
