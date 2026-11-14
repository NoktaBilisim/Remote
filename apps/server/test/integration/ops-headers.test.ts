import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.ts";
import { createDb } from "../../src/lib/db.ts";
import { makeApp, testEnv } from "../helpers/app.ts";

describe("health / ready", () => {
  it("AC-89: /health 200, /ready DB + son migration ile 200", async () => {
    const app = makeApp();
    expect((await app.inject("/health")).json()).toEqual({ status: "ok" });
    const ready = await app.inject("/ready");
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: "ready", migration: expect.stringMatching(/^\d{14}_[a-z0-9_]+$/) });
    await app.close();
  });

  it("AC-89: DB'ye ulaşılamazsa /ready 503 NOT_READY (ayrıntı sızmaz)", async () => {
    const db = createDb("mysql://app:yanlis@127.0.0.1:1/remote?connectTimeout=300&acquireTimeout=800");
    const app = buildApp({ mfaSetupEnforcement: false, env: testEnv(), db });
    const res = await app.inject("/ready");
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("NOT_READY");
    expect(res.body).not.toMatch(/127\.0\.0\.1|yanlis|ECONN/);
    await app.close();
    await db.$disconnect();
  });
});

describe("güvenlik başlıkları", () => {
  it("AC-126: HSTS includeSubDomains (preload yok), CSP connect-src portu içerir, worker/manifest 'self', upgrade-insecure-requests, CORP; Server/X-Powered-By yok; unsafe-inline yok", async () => {
    const app = makeApp();
    for (const url of ["/api/v1/auth/me", "/health", "/yok"]) {
      const res = await app.inject(url);
      const csp = String(res.headers["content-security-policy"]);
      expect(csp).toContain("connect-src 'self' wss://rs.test:4450");
      expect(csp).toContain("worker-src 'self'");
      expect(csp).toContain("manifest-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("upgrade-insecure-requests");
      expect(csp).not.toContain("unsafe-inline");
      expect(res.headers["cross-origin-resource-policy"]).toBe("same-origin");
      expect(res.headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains"); // P13b §7.5: preload yok
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["permissions-policy"]).toContain("camera=()");
      expect(res.headers["x-request-id"]).toMatch(/^[0-9A-Z]{26}$/);
      expect(res.headers.server).toBeUndefined();
      expect(res.headers["x-powered-by"]).toBeUndefined();
    }
    await app.close();
  });

  it("AC-90: bilinmeyen hata 500 INTERNAL + requestId; stack/mesaj sızmaz", async () => {
    const app = makeApp();
    app.get("/api/v1/__test/boom", async () => {
      throw new Error("SELECT * FROM gizli_tablo");
    });
    const res = await app.inject("/api/v1/__test/boom");
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toEqual({ code: "INTERNAL", message: expect.any(String), requestId: res.headers["x-request-id"] });
    expect(res.body).not.toContain("gizli_tablo");
    await app.close();
  });
});
