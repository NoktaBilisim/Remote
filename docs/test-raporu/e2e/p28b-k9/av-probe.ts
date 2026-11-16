// K9 test-operatoru: clamd altyapı dumanı (oturum/ayar değiştirmez). server konteynerinde koşar.
import { randomBytes } from "node:crypto";
import { ClamdClient, parseVersion, selfTestJudgement } from "/app/apps/server/src/fsrv/clamd.ts";
import { AV_SELFTEST_ENCRYPTED_ZIP_B64, avEicar } from "/app/packages/contracts/src/api/clamav.ts";
const t = { host: process.env.CLAMAV_HOST ?? "clamav", port: Number(process.env.CLAMAV_PORT ?? 3310) };
const c = new ClamdClient({ cidr: process.env.CLAMAV_ALLOWED_CIDR });
async function* once(b: Buffer) { yield b; }
async function* chunks(total: number) { for (let o = 0; o < total; o += 1_048_576) yield randomBytes(Math.min(1_048_576, total - o)); }
const dl = () => Date.now() + 60_000;
const pong = (await c.once(t, "PING")).replace(/\0+$/, "").trim();
const ver = parseVersion(await c.once(t, "VERSION"));
const eicar = await c.instream(t, once(Buffer.from(avEicar())), dl());
const zip = await c.instream(t, once(Buffer.from(AV_SELFTEST_ENCRYPTED_ZIP_B64, "base64")), dl());
console.log(JSON.stringify({ pong, version: ver?.version, dbDate: ver?.dbDate, eicar, zip, judgement: selfTestJudgement(eicar, zip) }));
const n = Number(process.argv[2] ?? 5), size = 50 * 1_048_576;
for (let i = 1; i <= n; i++) {
  const s = performance.now();
  const v = await c.instream(t, chunks(size), dl());
  console.log(JSON.stringify({ run: i, mb: 50, ms: Math.round(performance.now() - s), verdict: v.state, reason: (v as { reason?: string }).reason }));
}
