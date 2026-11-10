#!/usr/bin/env node
// Prod bağımlılık lisans kontrolü (mimari §10.4: AGPL/GPL yasak). LGPL izinli (dinamik bağlama).
// Kullanım: pnpm licenses list --json --prod | node scripts/check-licenses.mjs
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync(0, "utf8") || "{}");
const forbidden = /(^|[^L])\b(A?GPL)\b/i; // GPL-2.0, GPL-3.0, AGPL-3.0; LGPL hariç
const bad = [];
for (const [license, pkgs] of Object.entries(data)) {
  if (!forbidden.test(license)) continue;
  for (const p of pkgs) bad.push(`${p.name}@${p.versions.join(",")} (${license})`);
}
if (bad.length) {
  console.error(`Yasak lisans (AGPL/GPL):\n  ${bad.join("\n  ")}`);
  process.exit(1);
}
console.log(`Lisans kontrolü temiz: ${Object.keys(data).join(", ")}`);
