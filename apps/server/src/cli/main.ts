// `pnpm --filter @remote/server cli <komut>` giriş noktası: komut önekine göre ilgili araca yönlendirir.
//   erasure:replay | erasure:verify → cli/erasure.ts (P16, runbook §23.5)
//   crypto:check-retire | crypto:rewrap → cli/crypto.ts (P18 H3, runbook §25.5)
import { main as cryptoMain } from "./crypto.ts";
import { main as erasureMain } from "./erasure.ts";

const io = { out: (s: string) => void process.stdout.write(s), err: (s: string) => void process.stderr.write(s) };
const argv = process.argv.slice(2);
process.exitCode = argv[0]?.startsWith("crypto:") ? await cryptoMain(argv, process.env, io) : await erasureMain(argv, process.env, io);
