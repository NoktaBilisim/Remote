// Tarama için kullanıcı/firma id'lerini API'den okur (admin oturumu)
import { chromium, B, WORK, csrfFetch } from "./common.mjs";
const br = await chromium.launch();
const ctx = await br.newContext({ storageState: `${WORK}/state-admin.json` });
const p = await ctx.newPage(); await p.goto(B + "/");
const r = await csrfFetch(p, "GET", "/api/v1/users?pageSize=100");
console.log(JSON.stringify(r.body?.items?.map((u) => ({ id: u.id, role: u.role, name: u.fullName })) ?? r));
await br.close();
