// P21 düzeltme turu 1 (S-P21-K-4): logger redaksiyonu hata kodunu gizlemez; portal TOTP kodu/geçici şifre yine gizli.
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/lib/logger.ts";

function capture() {
  const lines: string[] = [];
  const log = createLogger(
    "info",
    new Writable({
      write(c: Buffer, _e, cb) {
        lines.push(c.toString());
        cb();
      },
    }),
  );
  return { log, all: () => lines.join("") };
}

describe("S-P21-K-4 logger redaksiyonu", () => {
  it("AC-262 S-P21-K-4: hata nesnesinin code alanı (P2002, ECONNREFUSED) logda görünür", () => {
    const { log, all } = capture();
    log.warn({ err: Object.assign(new Error("x"), { code: "P2002" }) }, "a");
    log.error({ cause: { code: "ECONNREFUSED" } }, "b");
    expect(all()).toContain('"code":"P2002"');
    expect(all()).toContain('"code":"ECONNREFUSED"');
  });

  it("AC-262 S-P21-K-4: portal TOTP kodu, geçici şifre ve istek gövdesindeki code gizli", () => {
    const { log, all } = capture();
    log.info({ input: { totpCode: "GIZLI-1" } }, "a");
    log.info({ result: { temporaryPassword: "GIZLI-2" } }, "b");
    log.info({ request: { body: { code: "GIZLI-3" } } }, "c");
    log.info({ body: { code: "GIZLI-4" } }, "d");
    expect(all()).not.toMatch(/GIZLI-/);
  });
});
