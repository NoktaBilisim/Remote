import { describe, expect, it } from "vitest";
import { EDGE_AUTH_HEADER, edgeAuthOk, forwardHeaders, readEdgeSecret, UA_MAX } from "@/lib/edge-forward";

const SECRET = "s".repeat(44);
const h = (o: Record<string, string>) => new Headers(o);

describe("lib/edge-forward (S-P2-1, S-P2-2)", () => {
  it("X-Edge-Auth eşleşirse XFF'in ilk (Caddy'nin yazdığı) öğesini iletir", () => {
    const out = forwardHeaders(h({ [EDGE_AUTH_HEADER]: SECRET, "x-forwarded-for": "203.0.113.7, 172.30.0.2" }), SECRET);
    expect(out["x-forwarded-for"]).toBe("203.0.113.7");
  });

  it("IPv6 istemci adresini iletir", () => {
    const out = forwardHeaders(h({ [EDGE_AUTH_HEADER]: SECRET, "x-forwarded-for": "2001:db8::1" }), SECRET);
    expect(out["x-forwarded-for"]).toBe("2001:db8::1");
  });

  it("başlık yoksa, yanlışsa veya sır boşsa XFF göndermez (edge ağından taklit)", () => {
    const xff = { "x-forwarded-for": "6.6.6.6" };
    expect(forwardHeaders(h(xff), SECRET)["x-forwarded-for"]).toBeUndefined();
    expect(forwardHeaders(h({ ...xff, [EDGE_AUTH_HEADER]: "yanlis" }), SECRET)["x-forwarded-for"]).toBeUndefined();
    expect(forwardHeaders(h({ ...xff, [EDGE_AUTH_HEADER]: `${SECRET}x` }), SECRET)["x-forwarded-for"]).toBeUndefined();
    expect(forwardHeaders(h({ ...xff, [EDGE_AUTH_HEADER]: "" }), "")["x-forwarded-for"]).toBeUndefined();
  });

  it("IP olmayan XFF değerini iletmez", () => {
    const out = forwardHeaders(h({ [EDGE_AUTH_HEADER]: SECRET, "x-forwarded-for": "evil.example, 1.2.3.4" }), SECRET);
    expect(out["x-forwarded-for"]).toBeUndefined();
  });

  it("User-Agent'ı kırparak iletir, yoksa eklemez", () => {
    expect(forwardHeaders(h({ "user-agent": "Mozilla/5.0" }), SECRET)["user-agent"]).toBe("Mozilla/5.0");
    expect(forwardHeaders(h({ "user-agent": "a".repeat(2000) }), SECRET)["user-agent"]).toHaveLength(UA_MAX);
    expect(forwardHeaders(h({}), SECRET)["user-agent"]).toBeUndefined();
  });

  it("edgeAuthOk sabit zamanlı karşılaştırma: farklı uzunlukta da false (hata atmaz)", () => {
    expect(edgeAuthOk(SECRET, SECRET)).toBe(true);
    expect(edgeAuthOk("kisa", SECRET)).toBe(false);
    expect(edgeAuthOk(null, SECRET)).toBe(false);
  });

  it("readEdgeSecret: production'da zorunlu (>= 32), geliştirmede boş döner", () => {
    expect(() => readEdgeSecret({ NODE_ENV: "production" })).toThrow(/EDGE_PROXY_SECRET/);
    expect(() => readEdgeSecret({ NODE_ENV: "production", EDGE_PROXY_SECRET: "kisa" })).toThrow();
    expect(readEdgeSecret({ NODE_ENV: "production", EDGE_PROXY_SECRET: SECRET })).toBe(SECRET);
    expect(readEdgeSecret({ NODE_ENV: "development" })).toBe("");
  });
});
