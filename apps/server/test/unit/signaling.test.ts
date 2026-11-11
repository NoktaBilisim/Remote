// P3 birim testleri: TURN HMAC (AC-21/22), tek kullanımlık depo (nonce/ticket), token-bucket (AC-18), checkPublicClient (ADR-0012), env.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { publicClientAllowed } from "../../src/auth/guards.ts";
import { loadEnv } from "../../src/env.ts";
import { TokenBucket } from "../../src/signaling/handlers.ts";
import { OneTimeStore } from "../../src/signaling/store.ts";
import { iceServersFor } from "../../src/signaling/turn.ts";
import { FAKE_TURN_SECRET_32, FAKE_TURN_SECRET_SHORT } from "../helpers/secrets.ts";
import type { Clock } from "../../src/signaling/types.ts";

const clockAt = (t: { v: number }): Clock => ({ now: () => t.v, setTimeout: () => 0, clearTimeout: () => undefined });
const cfg = { urls: ["stun:s:3478", "turn:s:3478?transport=udp"], secret: FAKE_TURN_SECRET_SHORT, ttlMin: 60 };

describe("TURN credential", () => {
  it("AC-21: username=<bitiş>:<sessionId>, credential=HMAC-SHA1; ömür min(60 dk, kalan süre)", () => {
    const now = 1_700_000_000_000;
    const g = iceServersFor(cfg, "S1", now, now + 4 * 3_600_000);
    const turn = g.iceServers.find((s) => s.username);
    expect(g.expiresAt).toBe(now + 3_600_000);
    expect(turn?.username).toBe(`${(now + 3_600_000) / 1000}:S1`);
    expect(turn?.credential).toBe(createHmac("sha1", cfg.secret).update(turn?.username ?? "").digest("base64"));
    expect(iceServersFor(cfg, "S1", now, now + 10 * 60_000).expiresAt).toBe(now + 10 * 60_000);
  });
  it("AC-21: secret yoksa yalnız STUN, credential yok", () => {
    expect(iceServersFor({ ...cfg, secret: undefined }, "S", 0, 1).iceServers).toEqual([{ urls: ["stun:s:3478"] }]);
  });
});

describe("OneTimeStore / TokenBucket", () => {
  it("tek kullanımlık ve süreli", () => {
    const t = { v: 0 };
    const s = new OneTimeStore<string>(clockAt(t), 60_000);
    const a = s.issue("x");
    expect(s.take(a.token)).toBe("x");
    expect(s.take(a.token)).toBeNull();
    const b = s.issue("y");
    t.v = 60_000;
    expect(s.take(b.token)).toBeNull();
  });
  it("AC-18: 50 mesaj/sn; fazlası reddedilir, zamanla dolar", () => {
    const t = { v: 0 };
    const b = new TokenBucket(clockAt(t));
    expect(Array.from({ length: 51 }, () => b.take()).filter(Boolean)).toHaveLength(50);
    t.v = 100;
    expect(b.take()).toBe(true);
  });
});

describe("checkPublicClient (ADR-0012)", () => {
  const allowed = ["https://rs.test:4450"];
  it.each([
    [{ origin: "https://rs.test:4450" }, "BROWSER", true],
    [{ origin: "https://rs.test:4450" }, "AGENT", false],
    [{ origin: "null" }, "BROWSER", false],
    [{ origin: "https://evil.test" }, "BROWSER", false],
    [{}, "AGENT", true],
    [{}, "BROWSER", false],
    [{ "sec-fetch-site": "none" }, "AGENT", false],
    [{ "sec-fetch-mode": "cors" }, "AGENT", false],
  ] as const)("%o + %s → %s", (h, kind, ok) => expect(publicClientAllowed(h, allowed, kind)).toBe(ok));
});

describe("env (P3)", () => {
  const base = { NODE_ENV: "test", PUBLIC_BASE_URL: "https://rs.test", DATABASE_URL: "mysql://a:b@h/d" };
  it("turn: URL'si varken TURN_SECRET zorunlu; liste ayrıştırılır", () => {
    expect(() => loadEnv({ ...base, TURN_URLS: "stun:a:3478,turn:a:3478" })).toThrow("TURN_SECRET");
    expect(loadEnv({ ...base, TURN_URLS: "stun:a:3478, turns:a:5349", TURN_SECRET: FAKE_TURN_SECRET_32 }).turnUrls).toEqual(["stun:a:3478", "turns:a:5349"]);
    expect(loadEnv({ ...base, TURN_URLS: "stun:a:3478" }).TURN_CRED_TTL_MIN).toBe(20);
  });
});
