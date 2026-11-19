// P29 manifest fikstürlerini diske yazar (elle; CI çalıştırmaz). Kaynak build.ts — Node 22.6+ tür ayıklamasıyla içe aktarılır.
// Kullanım (repo kökünden): node packages/contracts/test/fixtures/update-manifest/generate.mjs
// Sonra: pnpm --filter @remote/contracts test (update-p29 diskteki baytları yeniden üretilenle karşılaştırır).
import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFixtures } from "./build.ts";

const dir = dirname(fileURLToPath(import.meta.url));
const keep = new Set(["build.ts", "generate.mjs"]);
for (const name of readdirSync(dir)) if (!keep.has(name)) rmSync(join(dir, name));
for (const [name, bytes] of buildFixtures()) writeFileSync(join(dir, name), bytes);
