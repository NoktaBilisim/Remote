// Sözleşme örnekleri (packages/contracts/fixtures/ws-messages.json) contracts/src/ws.ts şemalarıyla uyumlu (ADR-0004).
import { readFileSync } from "node:fs";
import { guestInboundSchema, serverOutboundSchema, techInboundSchema } from "@remote/contracts/ws";
import { describe, expect, it } from "vitest";

const fx = JSON.parse(readFileSync(new URL("../../../../packages/contracts/fixtures/ws-messages.json", import.meta.url), "utf8")) as {
  valid: Record<"tech" | "guest" | "server", unknown[]>;
  invalid: Record<"tech" | "guest", unknown[]>;
};
const schemas = { tech: techInboundSchema, guest: guestInboundSchema, server: serverOutboundSchema };

describe("WS fixtures", () => {
  for (const side of ["tech", "guest", "server"] as const) {
    it.each(fx.valid[side].map((m) => [JSON.stringify(m).slice(0, 60), m]))(`${side} geçerli: %s`, (_n, m) => {
      expect(schemas[side].safeParse(m).success).toBe(true);
    });
  }
  for (const side of ["tech", "guest"] as const) {
    it.each(fx.invalid[side].map((m) => [JSON.stringify(m).slice(0, 60), m]))(`AC-18 ${side} reddedilir: %s`, (_n, m) => {
      expect(schemas[side].safeParse(m).success).toBe(false);
    });
  }
});
