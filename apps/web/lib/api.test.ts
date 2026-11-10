import { describe, expect, it, vi } from "vitest";
import { CSRF_COOKIE } from "@remote/contracts/api/auth";
import { api, ApiError, isUnauthenticated, NetworkError, readCookie, safeNext } from "@/lib/api";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

describe("lib/api", () => {
  it("POST isteğinde CSRF çerezini (contracts CSRF_COOKIE) X-CSRF-Token başlığına yazar (ADR-0008)", async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await api("POST", "/auth/logout", undefined, { fetch: f, cookie: () => `a=1; ${CSRF_COOKIE}=tok%3D1` });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("/api/v1/auth/logout");
    expect(init.headers["x-csrf-token"]).toBe("tok=1");
    expect(init.credentials).toBe("same-origin");
  });

  it("GET isteğine CSRF başlığı eklemez", async () => {
    const f = vi.fn().mockResolvedValue(json(200, { ok: true }));
    await api("GET", "/auth/me", undefined, { fetch: f, cookie: () => `${CSRF_COOKIE}=x` });
    expect(f.mock.calls[0]![1].headers["x-csrf-token"]).toBeUndefined();
  });

  it("AC-65: 423 hata zarfını ApiError olarak çözer (code, requestId, Retry-After)", async () => {
    const body = { error: { code: "ACCOUNT_LOCKED", message: "Kilitli", requestId: "01J" } };
    const f = vi.fn().mockResolvedValue(json(423, body, { "Retry-After": "900" }));
    const p = api("POST", "/auth/login", { login: "a", password: "b" }, { fetch: f, cookie: () => "" });
    await expect(p).rejects.toMatchObject({ status: 423, code: "ACCOUNT_LOCKED", requestId: "01J", retryAfter: 900 });
    await expect(p).rejects.toBeInstanceOf(ApiError);
  });

  it("gövdesiz 5xx yanıtında INTERNAL koduna düşer", async () => {
    const f = vi.fn().mockResolvedValue(new Response("x", { status: 502 }));
    await expect(api("GET", "/x", undefined, { fetch: f, cookie: () => "" })).rejects.toMatchObject({
      status: 502,
      code: "INTERNAL",
    });
  });

  it("ağ hatasını NetworkError'a çevirir", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(api("GET", "/x", undefined, { fetch: f, cookie: () => "" })).rejects.toBeInstanceOf(NetworkError);
  });

  it("readCookie yalnız tam ad eşleşmesini döndürür", () => {
    expect(readCookie(CSRF_COOKIE, `x${CSRF_COOKIE}=1; ${CSRF_COOKIE}=2`)).toBe("2");
    expect(readCookie(CSRF_COOKIE, "")).toBeUndefined();
  });

  it("S1-1: safeNext açık yönlendirmeyi engeller", () => {
    const o = "https://destek.example:4450";
    expect(safeNext("/x?y", o)).toBe("/x?y");
    expect(safeNext("/sessions", o)).toBe("/sessions");
    for (const bad of ["%2F%09%2Fevil.example", "/\t/evil.example", "/%0a/evil", "/\n/evil", "/%0d/evil", "/%09/evil",
      "//evil", "/\\evil", "https://evil", "/%2F/evil", "", null, undefined])
      expect(safeNext(bad, o), String(bad)).toBe("/");
  });
});

describe("isUnauthenticated", () => {
  it("yalnız 401 ApiError için true", () => {
    expect(isUnauthenticated(new ApiError(401, "UNAUTHENTICATED", "x"))).toBe(true);
    expect(isUnauthenticated(new ApiError(403, "FORBIDDEN", "x"))).toBe(false);
    expect(isUnauthenticated(new NetworkError())).toBe(false);
  });
});
