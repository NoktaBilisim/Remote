// storageState üretir: $WORK/state-{sa,admin,admin2}.json (repo dışında; parola içermez ama oturum çerezi içerir)
import { chromium, WORK, login, rec } from "./common.mjs";
const users = { sa: [process.env.P9_SA_LOGIN, process.env.P9_SA_PW], admin: [process.env.P9_ADMIN_LOGIN, process.env.P9_ADMIN_PW], admin2: [process.env.P9_ADMIN2_LOGIN, process.env.P9_ADMIN_PW] };
const br = await chromium.launch();
for (const [k, [id, pw]] of Object.entries(users)) {
  const ctx = await br.newContext();
  const p = await login(ctx, id, pw);
  const path = new URL(p.url()).pathname;
  console.log(k, "->", path);
  rec("login.jsonl", { user: k, path });
  await ctx.storageState({ path: `${WORK}/state-${k}.json` });
  await ctx.close();
}
await br.close();
