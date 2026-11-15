// P7 DC `input` sözleşme örnekleri (packages/contracts/fixtures/dc-input.json) contracts/src/dc.ts ile uyumlu (ADR-0004).
// Go istemci (internal/input) aynı dosyayı go test ile doğrular.
import { readFileSync } from "node:fs";
import { parseInputMessage } from "@remote/contracts/dc";
import { describe, expect, it } from "vitest";

const fx = JSON.parse(readFileSync(new URL("../../../../packages/contracts/fixtures/dc-input.json", import.meta.url), "utf8")) as {
  valid: unknown[];
  invalid: unknown[];
};

describe("DC input fixtures", () => {
  it.each(fx.valid.map((m) => [JSON.stringify(m), m]))("AC-48 geçerli: %s", (_n, m) => {
    expect(parseInputMessage(JSON.stringify(m))).not.toBeNull();
  });
  it.each(fx.invalid.map((m) => [JSON.stringify(m), m]))("AC-49/G-09 reddedilir: %s", (_n, m) => {
    expect(parseInputMessage(JSON.stringify(m))).toBeNull();
  });
});
