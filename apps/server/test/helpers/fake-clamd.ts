// P28b entegrasyon testleri için sahte clamd (TCP, 127.0.0.1). zINSTREAM içeriğine göre yanıt: EICAR → `Eicar-Test-Signature`,
// zip (PK) → `Heuristics.Encrypted.Zip`, "VIRUS" içeren → `Win.Test.Virus FOUND`, aksi `stream: OK`. `mode`: "ok" | "noEncrypted"
// (öz-sınama yanlış yapılandırma) | "error" (her taramada `ERROR`). Uygulama `fsrvTest.dialHost` ile buraya yönlenir.
import { createServer, type Server } from "node:net";
import { avEicar } from "@remote/contracts/api/clamav";
import type { FsrvTestOptions } from "../../src/fsrv/wiring.ts";

export const AV_CIDR = "10.89.0.0/24";
export const AV_IP = "10.89.0.10";

export interface FakeClamd {
  port: number;
  mode: "ok" | "noEncrypted" | "error";
  scans: number;
  signatureAgeMs: number;
  close(): Promise<void>;
  /** `makeApp({ env, fsrvTest })` için. */
  env(): Record<string, string>;
  test: FsrvTestOptions;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n: number) => String(n).padStart(2, "0");
/** C `ctime` (UTC): `Sun Nov  8 06:23:52 2026`. */
const ctime = (d: Date): string =>
  `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, " ")} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} ${d.getUTCFullYear()}`;

export async function startFakeClamd(): Promise<FakeClamd> {
  const eicar = Buffer.from(avEicar(), "ascii");
  const fake: FakeClamd = {
    port: 0,
    mode: "ok",
    scans: 0,
    signatureAgeMs: 3_600_000,
    close: async () => undefined,
    env: () => ({ CLAMAV_HOST: "clamav.test", CLAMAV_PORT: String(fake.port), CLAMAV_ALLOWED_CIDR: AV_CIDR }),
    test: {
      lookupAll: async (h) => (h === "clamav.test" ? [AV_IP] : ["8.8.8.8"]),
      dialHost: () => "127.0.0.1",
      retryTotalMs: 200,
      retryIntervalMs: 20,
      // geliştirici makinesinin diski dolu olabilir; disk kuralı (%10) ayrı testte `freeRatioOverride` ile sınanır
      freeRatio: 0.5,
    },
  };
  const server: Server = createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on("error", () => undefined);
    sock.on("data", (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      const z = buf.indexOf(0);
      if (z < 0) return;
      const cmd = buf.subarray(1, z).toString();
      if (cmd === "PING") return void sock.end("PONG\0");
      if (cmd === "VERSION") return void sock.end(`ClamAV 1.5.4/28177/${ctime(new Date(Date.now() - fake.signatureAgeMs))}\0`);
      let off = z + 1;
      const body: Buffer[] = [];
      for (;;) {
        if (buf.length < off + 4) return;
        const len = buf.readUInt32BE(off);
        if (len === 0) break;
        if (buf.length < off + 4 + len) return;
        body.push(buf.subarray(off + 4, off + 4 + len));
        off += 4 + len;
      }
      const data = Buffer.concat(body);
      fake.scans++;
      if (fake.mode === "error") return void sock.end("stream: some failure ERROR\0");
      if (data.equals(eicar)) return void sock.end("stream: Eicar-Test-Signature FOUND\0");
      if (data.subarray(0, 2).toString() === "PK")
        return void sock.end(fake.mode === "noEncrypted" ? "stream: OK\0" : "stream: Heuristics.Encrypted.Zip FOUND\0");
      if (data.includes("VIRUS")) return void sock.end("stream: Win.Test.Virus FOUND\0");
      sock.end("stream: OK\0");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address();
  fake.port = typeof a === "object" && a ? a.port : 0;
  fake.close = () => new Promise<void>((r) => server.close(() => r()));
  return fake;
}
