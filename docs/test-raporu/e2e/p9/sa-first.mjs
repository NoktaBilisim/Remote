// Seed Super Admin ilk girişte şifre değiştirir (AC-66). Yeni parola rastgele; $WORK/creds.env'e eklenir, ekrana yazılmaz.
import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { chromium, WORK, login } from "./common.mjs";
const br = await chromium.launch();
const ctx = await br.newContext();
const p = await login(ctx, process.env.P9_SA_LOGIN, process.env.P9_SA_PW);
const np = "Sn-" + randomBytes(16).toString("hex");
await p.locator('[name="current"]').fill(process.env.P9_SA_PW);
await p.locator('[name="next"]').fill(np);
await p.locator('[name="confirm"]').fill(np);
await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/change-password"), { timeout: 20000 }), p.locator('button[type="submit"]').click()]);
appendFileSync(`${WORK}/creds.env`, `export P9_SA_PW='${np}'\n`);
console.log("sa ->", new URL(p.url()).pathname);
await br.close();
