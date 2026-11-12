import { chromium, B, DIR, rec } from "./common.mjs";
const users = { admin: ["teknisyen.admin@remote-staging.local", process.env.RS_ADMIN_PW], user: ["teknisyen.user@remote-staging.local", process.env.RS_USER_PW] };
const br = await chromium.launch();
for (const [k, [login, pw]] of Object.entries(users)) {
  if (!pw) { console.log(k, "parola yok"); continue; }
  const ctx = await br.newContext({ ignoreHTTPSErrors: false });
  const p = await ctx.newPage();
  await p.goto(B + "/login");
  await p.locator('[name="login"]').fill(login);
  await p.locator('[name="password"]').fill(pw);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {}), p.locator('button[type="submit"]').click()]);
  await p.waitForLoadState("networkidle").catch(() => {});
  const path = new URL(p.url()).pathname;
  console.log(k, "->", path);
  rec("login.jsonl", { user: k, path });
  if (!path.startsWith("/login") && !path.startsWith("/change-password")) await ctx.storageState({ path: DIR + `${k}.json` });
  await ctx.close();
}
await br.close();
