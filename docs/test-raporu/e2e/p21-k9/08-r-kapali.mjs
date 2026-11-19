// /r/<ref> web formu kapalı firmada (beta) hâlâ kapalı mı; açık firmada (demo) açık mı.
import { chromium, BASE, rec, watch } from "./k9lib.mjs";
const b = await chromium.launch(); const p = await (await b.newContext()).newPage(); const w = watch(p, "r-form");
for (const [n, ref] of [["beta (kapalı)", "cgkmmbx564yafykf"], ["demo A1 (açık)", "kbcjz33j4fjxp26o"]]) {
  await p.goto(BASE + "/r/" + ref); await p.waitForTimeout(2500);
  const form = await p.getByTestId("wr-form").count(); const t = (await p.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 160);
  rec({ kind: "flow", step: "/r/ " + n, ok: n.includes("kapalı") ? form === 0 : form === 1, note: t }); console.log(n, "form=", form, t);
}
console.log(JSON.stringify(w.http)); await b.close();
