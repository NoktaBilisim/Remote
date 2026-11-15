import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTenant, createUser, loginRequest, makeApp, testDb } from "../helpers/app.ts";

let app: FastifyInstance;
afterEach(() => app.close());

let n = 0; // her denemede farklı hesap: hesap+IP kilidi değil yalnız IP limiti ölçülür
const attempt = (xff: string, remoteAddress = "127.0.0.1") =>
  app.inject(
    loginRequest(`yok${++n}@example.test`, "x-yanlis", {
      remoteAddress,
      headers: { origin: "https://rs.test:4450", "x-forwarded-for": xff },
    }),
  );

describe("gerçek istemci IP'si", () => {
  it("AC-121: proxy güvenilir değilken sahte X-Forwarded-For IP limitini atlatamaz", async () => {
    app = makeApp();
    for (let i = 0; i < 20; i++) expect((await attempt(`10.0.0.${i}`, "192.0.2.10")).statusCode).toBe(401);
    expect((await attempt("10.0.0.250", "192.0.2.10")).statusCode).toBe(429);
  });

  it("AC-121: yalnız güvenilen proxy'den gelen XFF okunur; zincire eklenen sahte değer etkisiz", async () => {
    app = makeApp({ env: { TRUSTED_PROXY_CIDR: "127.0.0.1/32" } });
    const u = await createUser({ tenantId: (await createTenant()).id });
    const res = await app.inject(
      loginRequest(u.email, u.password, { headers: { origin: "https://rs.test:4450", "x-forwarded-for": "6.6.6.6, 198.51.100.5" } }),
    );
    expect(res.statusCode).toBe(200);
    const row = await testDb().auditLog.findFirstOrThrow({ where: { userId: u.id, result: "success" } });
    expect(row.ipAddress).toBe("198.51.100.5");
    // Güvenilmeyen kaynaktan gelen XFF yok sayılır
    for (let i = 0; i < 20; i++) await attempt(`10.1.0.${i}`, "192.0.2.11");
    expect((await attempt("10.1.0.99", "192.0.2.11")).statusCode).toBe(429);
  });

  it("AC-121: IPv6 istemciler /64 bazında sınırlanır", async () => {
    app = makeApp({ env: { TRUSTED_PROXY_CIDR: "127.0.0.1/32" } });
    for (let i = 1; i <= 20; i++) expect((await attempt(`2001:db8:aa:1::${i.toString(16)}`)).statusCode).toBe(401);
    expect((await attempt("2001:db8:aa:1:ffff::1")).statusCode).toBe(429);
    expect((await attempt("2001:db8:aa:2::1")).statusCode).toBe(401);
  });
});
