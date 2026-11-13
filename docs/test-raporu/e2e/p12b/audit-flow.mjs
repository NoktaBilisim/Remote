// P12b audit ekranı: yeni WhatsApp eylem etiketleri liste + detay (audit-proxy.mjs :4218 üzerinden web :3218). Light/dark, 1280/390.
import { chromium, IMG, rec, track, axe, overflow } from "./common.mjs";
const B = "http://localhost:3218"; const F = "flows.jsonl";
const br = await chromium.launch(); let cur = "audit-real";
const check = (flow, ok, note = "") => { rec(F, { kind: "check", flow, ok: !!ok, note }); console.log(ok ? "OK  " : "FAIL", flow, note); };
for (const scheme of ["light", "dark"]) for (const width of [1280, 390]) {
  const ctx = await br.newContext({ viewport: { width, height: width > 600 ? 900 : 844 }, colorScheme: scheme, locale: "tr-TR", ...(width < 600 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const base = { domain: "localhost", path: "/", secure: true, sameSite: "Strict" };
  await ctx.addCookies([{ ...base, name: "__Host-rs_session", value: `u-ausa-${Math.random().toString(36).slice(2)}`, httpOnly: true }, { ...base, name: "__Host-rs_csrf", value: "csrf-test-token" }]);
  const p = await ctx.newPage(); cur = `audit ${scheme} ${width}`; track(p, F, () => cur);
  await p.goto(B + "/audit", { waitUntil: "networkidle" });
  const rows = p.getByTestId(width < 600 ? "audit-card" : "audit-row");
  const cnt = await p.locator('[data-testid="audit-row"], [data-testid="audit-card"]').count();
  const first3 = await p.locator('[data-testid="audit-row"]:visible, [data-testid="audit-card"]:visible').evaluateAll((els) => els.slice(0, 3).map((e) => e.innerText.replace(/\s+/g, " ").slice(0, 160)));
  console.log(cur, "satır", cnt, first3);
  const joined = first3.join(" || ");
  check(`${cur}: 3 etiket listede`, ["WhatsApp test mesajı", "WhatsApp servisi ortam değerine döndü", "WhatsApp servis adresi güncellendi"].every((x) => joined.includes(x)), "");
  const a = await axe(p); const o = await overflow(p);
  check(`${cur}: axe 0, taşma yok`, a.length === 0 && o.doc <= 0, a.join("|") + " of=" + o.doc + " " + o.inner.join(","));
  await p.screenshot({ path: `${IMG}a-${scheme}-${width}-audit.png`, fullPage: false });
  if (scheme === "light" && width === 1280) {
    for (let i = 0; i < 3; i++) {
      await p.getByTestId("audit-detail-open").nth(i).click(); await p.waitForTimeout(400);
      const txt = (await p.getByTestId("audit-detail").innerText()).replace(/\s+/g, " ");
      rec(F, { kind: "auditdetail", i, txt: txt.slice(0, 700) }); console.log("DETAY", i, "::", txt.slice(0, 500));
      await p.screenshot({ path: `${IMG}a-detail-${i}.png` });
      await p.keyboard.press("Escape"); await p.waitForTimeout(300);
    }
  }
  await ctx.close();
}
await br.close();
