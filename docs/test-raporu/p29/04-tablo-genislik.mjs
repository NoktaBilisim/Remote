// /unattended masaüstü tablosu: kapsayıcı yatay kaydırma (scrollWidth - clientWidth) 1280/1440/1920 px.
import { BASE, chromium, login, rec, state, SHOTS } from "./p29lib.mjs";
const st = state(); const c = await login(st.adminA.email, st.totp.adminA); const b = await chromium.launch();
for (const w of [1280, 1440, 1920]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 } }); await ctx.addCookies(c.cookies());
  const p = await ctx.newPage(); await p.goto(BASE + "/unattended"); await p.getByTestId("un-table").waitFor();
  const m = await p.getByTestId("un-table").evaluate((e) => { const s = e.closest(".overflow-x-auto") ?? e; return { scroll: s.scrollWidth, client: s.clientWidth }; });
  rec({ kind: "tablo", width: w, ...m }); console.log(w, JSON.stringify(m));
  if (w === 1440) await p.getByTestId("un-table").screenshot({ path: `${SHOTS}/unattended-tablo-1440-light.png` });
  await ctx.close();
}
await b.close();
