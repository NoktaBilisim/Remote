import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../../src/env.ts";
import { createLogger } from "../../src/lib/logger.ts";
import { AgentBinary, type AgentBinaryState } from "../../src/public/agent-binary.ts";
import { agentDownloadLocation } from "../../src/public/agent.ts";

const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "rs-agent-"));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

function binary(path: string | undefined, expected: string | undefined) {
  const problems: AgentBinaryState[] = [];
  return { b: new AgentBinary(path, expected, (s) => problems.push(s)), problems };
}

describe("AgentBinary (G-07: indirme yalnız AGENT_SHA256 eşleşirken)", () => {
  it("AC-96: dosya hash'i AGENT_SHA256 ile eşleşirse ok; eşleşmezse mismatch (503)", async () => {
    const path = join(dir, "ok.exe");
    const bytes = Buffer.from("MZ sahte ikili");
    await writeFile(path, bytes);
    expect(await binary(path, sha(bytes)).b.check()).toBe("ok");
    const bad = binary(path, "0".repeat(64));
    expect(await bad.b.check()).toBe("mismatch");
    expect(bad.problems).toEqual(["mismatch"]);
  });

  it("AC-96: yapılandırma eksik → unconfigured; dosya yok/klasör → missing (fail-closed)", async () => {
    expect(await binary(undefined, "0".repeat(64)).b.check()).toBe("unconfigured");
    expect(await binary(join(dir, "ok.exe"), undefined).b.check()).toBe("unconfigured");
    expect(await binary(join(dir, "yok.exe"), "0".repeat(64)).b.check()).toBe("missing");
    expect(await binary(dir, "0".repeat(64)).b.check()).toBe("missing");
  });

  it("AC-96: dosya değişince yeniden hesaplanır; sorun aynı durumda tekrar raporlanmaz; eşzamanlı çağrılar tek sonuç", async () => {
    const path = join(dir, "degisen.exe");
    const v1 = Buffer.from("surum-1");
    await writeFile(path, v1);
    const { b, problems } = binary(path, sha(v1));
    const both = await Promise.all([b.check(), b.check()]);
    expect(both).toEqual(["ok", "ok"]);
    await writeFile(path, Buffer.from("surum-2-degistirilmis")); // ikili değiştirildi (ör. ele geçirilmiş volume)
    expect(await b.check()).toBe("mismatch");
    expect(await b.check()).toBe("mismatch");
    expect(problems).toEqual(["mismatch"]);
    await writeFile(path, v1);
    expect(await b.check()).toBe("ok");
  });
});

describe("env + log (P6)", () => {
  const base = { PUBLIC_BASE_URL: "https://rs.test:4450", DATABASE_URL: "mysql://app:gizli@db/remote" };

  it("AC-96: AGENT_SHA256 64 hex (küçük harfe indirilir), AGENT_BINARY_PATH mutlak; boş = tanımsız", () => {
    const env = loadEnv({ ...base, AGENT_BINARY_PATH: "/data/downloads/NoktaDestek.exe", AGENT_SHA256: "AB".repeat(32) });
    expect(env.AGENT_SHA256).toBe("ab".repeat(32));
    expect(() => loadEnv({ ...base, AGENT_SHA256: "abc" })).toThrow(/AGENT_SHA256/);
    expect(() => loadEnv({ ...base, AGENT_BINARY_PATH: "downloads/x.exe" })).toThrow(/AGENT_BINARY_PATH/);
    const blank = loadEnv({ ...base, AGENT_BINARY_PATH: "", AGENT_SHA256: " " });
    expect(blank.AGENT_BINARY_PATH).toBeUndefined();
    expect(blank.AGENT_SHA256).toBeUndefined();
  });

  it("AC-27, G-10: `ref` alanı log nesnelerinde redakte edilir", () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    createLogger("info", sink).info({ query: { ref: "GizliRefDegeri" } }, "x");
    expect(lines.join("")).not.toContain("GizliRefDegeri");
  });

  it("AC-27: yönlendirme konumu ADR-0006 dosya adı biçimi (Destek-<8 hane>.exe)", () => {
    expect(agentDownloadLocation("04829137")).toBe("/downloads/Destek-04829137.exe");
  });
});
