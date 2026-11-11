// İndirilen Windows istemcisinin bütünlük kapısı (mimari §8.1, ADR-0010, G-07). Deploy betiği ikiliyi attestation +
// SHA256SUMS doğrulamasından sonra volume'a koyar ve AGENT_SHA256'yı yazar; sunucu dosyanın gerçek SHA-256'sını bununla
// karşılaştırır. Eşleşmezse (veya yapılandırma/dosya yoksa) indirme 503 — fail-closed. Hash dosya değişince
// (boyut/mtime/inode) yeniden hesaplanır; aynı anda gelen istekler tek hesaplamayı bekler.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

export type AgentBinaryState = "ok" | "unconfigured" | "missing" | "mismatch";

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export class AgentBinary {
  private readonly path: string | undefined;
  private readonly expected: string | undefined;
  private readonly onProblem: (state: AgentBinaryState) => void;
  private cache: { key: string; state: AgentBinaryState } | undefined;
  private inflight: Promise<AgentBinaryState> | undefined;
  private lastReported: AgentBinaryState | undefined;

  /** `onProblem`: durum "ok" dışına her geçişte bir kez (log spam'i yok); yol/hash değeri verilmez. */
  constructor(path: string | undefined, expectedSha256: string | undefined, onProblem: (state: AgentBinaryState) => void) {
    this.path = path;
    this.expected = expectedSha256;
    this.onProblem = onProblem;
  }

  check(): Promise<AgentBinaryState> {
    const { path, expected } = this;
    if (!path || !expected) return Promise.resolve(this.report("unconfigured"));
    this.inflight ??= this.evaluate(path, expected).finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async evaluate(path: string, expected: string): Promise<AgentBinaryState> {
    try {
      const st = await stat(path);
      if (!st.isFile()) return this.report("missing");
      const key = `${st.size}:${st.mtimeMs}:${st.ctimeMs}:${st.ino}`; // ctime: mtime geri alınsa da değişir (N6-1)
      if (this.cache?.key !== key) this.cache = { key, state: (await sha256File(path)) === expected ? "ok" : "mismatch" };
      return this.report(this.cache.state);
    } catch {
      this.cache = undefined;
      return this.report("missing");
    }
  }

  private report(state: AgentBinaryState): AgentBinaryState {
    if (state !== "ok" && state !== this.lastReported) this.onProblem(state);
    this.lastReported = state;
    return state;
  }
}
