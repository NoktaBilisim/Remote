import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/lib/logger.ts";
import { createTenant, createUser, loginAs, loginRequest, makeApp } from "../helpers/app.ts";

describe("log tarama", () => {
  it("AC-90: loglar JSON + korelasyon ID; şifre, oturum/CSRF token'ı, çerez, /session/<token> ve sorgu dizesi görünmez", async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(...chunk.toString().split("\n").filter(Boolean));
        cb();
      },
    });
    const app = makeApp({ logger: createLogger("trace", sink) });
    const t = await createTenant();
    const u = await createUser({ tenantId: t.id });
    await app.inject(loginRequest(u.email, "Yanlis-Sifre-777"));
    const s = await loginAs(app, u);
    const sessionToken = s.token;
    await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { ...s.headers, authorization: "Bearer gizli-bearer" } });
    await app.inject({ method: "GET", url: "/session/GizliLinkTokeni123?nonce=GizliNonce" });
    await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: s.headers });
    await app.close();

    expect(lines.length).toBeGreaterThan(5);
    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(parsed.filter((p) => "req" in p || "res" in p).every((p) => typeof p.reqId === "string")).toBe(true);
    const all = lines.join("\n");
    for (const secret of [
      u.password,
      "Yanlis-Sifre-777",
      sessionToken,
      s.headers["x-csrf-token"],
      "gizli-bearer",
      "GizliLinkTokeni123",
      "GizliNonce",
    ]) {
      expect(secret.length).toBeGreaterThan(0);
      expect(all).not.toContain(secret);
    }
    expect(all).toContain("/session/***");
  });
});
