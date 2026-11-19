import { describe, expect, it } from "vitest";
import { AGENT_AVAILABILITY_URL, agentDownloadUrl, fetchAgentAvailability, macVariant, probeAgentDownload } from "./agent-download";

const json = (status: number, code: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { code, message: "x", requestId: "01JREQ" } }), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
const fake = (r: Response | Error) =>
  (async () => {
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
    expect(await probeAgentDownload("ref", "windows", f)).toEqual({ kind: "ok" });
    expect(init?.redirect).toBe("manual");
  });

  it("302 (Node fetch) → ok", async () =>
    expect(
      await probeAgentDownload(
        "ref",
        "windows",
        fake(new Response(null, { status: 302, headers: { Location: "/downloads/Destek-12345678.exe" } })),
      ),
    ).toEqual({ kind: "ok" }));

  it("503 NOT_READY → notReady (tarayıcı moduna öner)", async () =>
    expect(await probeAgentDownload("ref", "windows", fake(json(503, "NOT_READY")))).toEqual({ kind: "notReady" }));

  it.each([
    ["SESSION_EXPIRED", "expired"],
    ["SESSION_CANCELLED", "cancelled"],
    ["SESSION_CONSUMED", "consumed"],
  ] as const)("410 %s → %s", async (code, end) =>
    expect(await probeAgentDownload("ref", "windows", fake(json(410, code)))).toEqual({ kind: "end", end }),
  );

  it("404 → notFound", async () =>
    expect(await probeAgentDownload("ref", "windows", fake(json(404, "NOT_FOUND")))).toEqual({ kind: "end", end: "notFound" }));

  it("429 → rate + Retry-After", async () =>
    expect(await probeAgentDownload("ref", "windows", fake(json(429, "RATE_LIMITED", { "Retry-After": "900" })))).toEqual({
      kind: "rate",
      retryAfter: 900,
    }));

  it("500 → error + requestId; ağ hatası → error", async () => {
    expect(await probeAgentDownload("ref", "windows", fake(json(500, "INTERNAL")))).toEqual({ kind: "error", requestId: "01JREQ" });
    expect(await probeAgentDownload("ref", "windows", fake(new TypeError("net")))).toEqual({ kind: "error" });
  });
});

describe("P28f AC-396: macOS indirme adresi", () => {
  it("Windows adresi değişmez (os parametresi yok); macOS'ta &os=macos", () => {
    expect(agentDownloadUrl("r1")).toBe("/api/v1/public/agent/download?ref=r1");
    expect(agentDownloadUrl("r1", "windows")).toBe("/api/v1/public/agent/download?ref=r1");
    expect(agentDownloadUrl("a+b", "macos")).toBe("/api/v1/public/agent/download?ref=a%2Bb&os=macos");
  });
  it("P28g: Linux'ta &os=linux", () => expect(agentDownloadUrl("r1", "linux")).toBe("/api/v1/public/agent/download?ref=r1&os=linux"));
  it("ön kontrol macOS adresine gider; 302 .zip → ok", async () => {
    let url = "";
    const f = (async (u: string) => {
      url = u;
      return new Response(null, { status: 302, headers: { Location: "/downloads/Destek-12345678.zip" } });
    }) as unknown as typeof fetch;
    expect(await probeAgentDownload("ref", "macos", f)).toEqual({ kind: "ok" });
    expect(url).toBe("/api/v1/public/agent/download?ref=ref&os=macos");
  });
});

describe("P28f AC-390 / S-P28f-15: fetchAgentAvailability (fail-closed)", () => {
  const ok = (body: unknown, status = 200) =>
    fake(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  it("200 { windows, macos, macosTestBuild } → değer; çerez gönderilmez", async () => {
    let init: RequestInit | undefined;
    let url = "";
    const f = (async (u: string, i: RequestInit) => {
      url = u;
      init = i;
      return new Response(JSON.stringify({ windows: true, macos: true, macosTestBuild: true }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await fetchAgentAvailability(f)).toEqual({ windows: true, macos: true, linux: false, macosTestBuild: true, macosSigning: null });
    expect(url).toBe(AGENT_AVAILABILITY_URL);
    expect(url).toBe("/api/v1/public/agent/availability");
    expect(init?.credentials).toBe("omit");
  });
  it("macos:false → değer (çağıran indirmeyi gizler)", async () =>
    expect(await fetchAgentAvailability(ok({ windows: true, macos: false, macosTestBuild: false }))).toEqual({
      windows: true,
      macos: false,
      linux: false,
      macosTestBuild: false,
      macosSigning: null,
    }));
  it("S-P28f-8: macosTestBuild eksik/geçersiz → false (imzalı rehber; 'Yine de Aç' varsayılan değil)", async () => {
    expect(await fetchAgentAvailability(ok({ windows: true, macos: true }))).toEqual({
      windows: true,
      macos: true,
      linux: false,
      macosTestBuild: false,
      macosSigning: null,
    });
    expect((await fetchAgentAvailability(ok({ windows: true, macos: true, macosTestBuild: "evet" })))?.macosTestBuild).toBe(false);
  });
  it("P28g (S-P28g-12): linux:true → true; eksik (eski sunucu) / geçersiz → false, Windows/macOS etkilenmez", async () => {
    expect((await fetchAgentAvailability(ok({ windows: true, macos: true, linux: true })))?.linux).toBe(true);
    expect(await fetchAgentAvailability(ok({ windows: true, macos: false, linux: "evet" }))).toEqual({
      windows: true,
      macos: false,
      linux: false,
      macosTestBuild: false,
      macosSigning: null,
    });
  });
  it.each([
    ["429", ok({ error: { code: "RATE_LIMITED" } }, 429)],
    ["500", ok({ error: { code: "INTERNAL" } }, 500)],
    ["şema dışı", ok({ windows: "yes", macos: 1 })],
    ["eksik alan", ok({ windows: true })],
    ["JSON değil", fake(new Response("<html>", { status: 200 }))],
    ["ağ hatası", fake(new TypeError("net"))],
  ])("%s → null (yalnız tarayıcı modu)", async (_n, f) => expect(await fetchAgentAvailability(f)).toBeNull());
});

describe("P28f-r4 AC-503 / K-P28f-r4-3: macosSigning şeması ve varyant", () => {
  const ok = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
  const base = { windows: true, macos: true, macosTestBuild: false };
  it.each([
    ["notarized", "notarized"],
    ["adhoc", "adhoc"],
    [null, null],
    [undefined, null],
    ["NOTARIZED", null],
    ["evet", null],
    [true, null],
  ] as const)("macosSigning %s → %s (bilinmeyen asla notarized değil; şema geri kalanı geçerli)", async (inp, out) => {
    const r = await fetchAgentAvailability(ok({ ...base, macosSigning: inp }));
    expect(r).not.toBeNull();
    expect(r?.macosSigning).toBe(out);
  });
  it("varyant: test > notarized > adhoc (eksik/geçersiz/null → adhoc)", () => {
    expect(macVariant({ macosTestBuild: true, macosSigning: "notarized" })).toBe("test");
    expect(macVariant({ macosTestBuild: true, macosSigning: null })).toBe("test");
    expect(macVariant({ macosTestBuild: false, macosSigning: "notarized" })).toBe("notarized");
    expect(macVariant({ macosTestBuild: false, macosSigning: "adhoc" })).toBe("adhoc");
    expect(macVariant({ macosTestBuild: false, macosSigning: null })).toBe("adhoc");
    expect(macVariant(null)).toBe("adhoc");
    expect(macVariant(undefined)).toBe("adhoc");
  });
  it("uçtan uca: eski sunucu (alan yok) ve geçersiz değer → adhoc", async () => {
    expect(macVariant(await fetchAgentAvailability(ok(base)))).toBe("adhoc");
    expect(macVariant(await fetchAgentAvailability(ok({ ...base, macosSigning: "Notarized" })))).toBe("adhoc");
    expect(macVariant(await fetchAgentAvailability(ok({ ...base, macosSigning: "notarized" })))).toBe("notarized");
  });
});
