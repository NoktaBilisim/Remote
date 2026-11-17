// P28d test-operatoru: konsol başlığında üst üste binme / taşma ölçümü (geçici keşif; ürün kodu değil). Koşu zz-p28d-op ile aynı.
import { appendFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { newSession, signIn } from "./helpers";

const DIR = "/Users/mennan/Projeler/Remote/docs/test-raporu/e2e/p28d/";
const log = (o: unknown) => appendFileSync(`${DIR}olcum.jsonl`, JSON.stringify(o) + "\n");

/** Başlık doğrudan çocukları: kutu, sağ taşma, çakışan kardeş çiftleri; belge taşmasına yol açan en geniş öğe. */
async function measure(p: Page, label: string) {
  const r = await p.evaluate(() => {
    const h = [...document.querySelectorAll("header")].find((x) => x.querySelector('[data-testid="console-status"]'))!;
    const hb = h.getBoundingClientRect();
    const kids = [...h.children].map((e) => {
      const b = e.getBoundingClientRect();
      return { tag: e.tagName, tid: e.getAttribute("data-testid"), text: (e as HTMLElement).innerText.replace(/\s+/g, " ").slice(0, 40), x: Math.round(b.left), r: Math.round(b.right), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) };
    });
    const overlaps: string[] = [];
    for (let i = 0; i < kids.length; i++)
      for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i], b = kids[j];
        if (a.w && b.w && a.x < b.r - 1 && b.x < a.r - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1) overlaps.push(`${a.text} ⟂ ${b.text}`);
      }
    const vw = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll("body *")]
      .map((e) => ({ e, b: e.getBoundingClientRect() }))
      .filter((x) => x.b.right > vw + 0.5 && x.b.width > 0)
      .slice(0, 5)
      .map((x) => `${x.e.tagName}.${(x.e.getAttribute("class") ?? "").slice(0, 60)} r=${Math.round(x.b.right)} "${(x.e as HTMLElement).innerText?.slice(0, 30)}"`);
    const rowsY = [...new Set(kids.filter((k) => k.w).map((k) => k.y))].length;
    return { header: { w: Math.round(hb.width), r: Math.round(hb.right), h: Math.round(hb.height) }, kids, overlaps, outOfHeader: kids.filter((k) => k.r > hb.right + 0.5).map((k) => k.text), wide, rowsY };
  });
  log({ label, ...r });
  return r;
}

for (const w of [1280, 1440, 375]) {
  test(`başlık ölçümü ${w}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    await signIn(ctx, "p28d");
    const p = await ctx.newPage();
    const s = await newSession(p);
    await p.goto(`/sessions/${s.id}/console`);
    const g = await (await browser.newContext({ viewport: { width: w, height: 900 } })).newPage();
    await g.goto(new URL(s.link).pathname);
    await expect(g.getByTestId("join-form")).toHaveAttribute("data-ready", "true");
    await g.getByTestId("guest-name").fill("Ayşe Yılmaz");
    await g.getByTestId("guest-consent").check();
    await g.getByTestId("join-browser").click();
    const code = ((await g.getByTestId("admit-code").getAttribute("aria-label")) ?? "").replace(/\s/g, "");
    await p.getByTestId("admit-input").fill(code);
    await p.getByTestId("admit-submit").click();
    await expect(p.getByTestId("console-status")).toHaveText("Aktif");
    await expect(p.getByTestId("voice-controls")).toHaveAttribute("data-view", "idle");
    await measure(p, `${w} bosta`);
    await p.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException("x", "NotAllowedError");
      };
    });
    await p.getByTestId("voice-call").click();
    await expect(p.getByTestId("voice-notice")).toHaveAttribute("data-kind", "micDenied");
    await measure(p, `${w} micDenied`);
    await ctx.close();
  });
}

test("başlık ölçümü ses yok (p28c taban, 1280)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await signIn(ctx, "plain");
  const p = await ctx.newPage();
  const s = await newSession(p);
  await p.goto(`/sessions/${s.id}/console`);
  const g = await (await browser.newContext()).newPage();
  await g.goto(new URL(s.link).pathname);
  await expect(g.getByTestId("join-form")).toHaveAttribute("data-ready", "true");
  await g.getByTestId("guest-name").fill("Ayşe Yılmaz");
  await g.getByTestId("guest-consent").check();
  await g.getByTestId("join-browser").click();
  const code = ((await g.getByTestId("admit-code").getAttribute("aria-label")) ?? "").replace(/\s/g, "");
  await p.getByTestId("admit-input").fill(code);
  await p.getByTestId("admit-submit").click();
  await expect(p.getByTestId("console-status")).toHaveText("Aktif");
  log({ label: "plain voice-controls count", n: await p.getByTestId("voice-controls").count() });
  await measure(p, "1280 plain");
  await p.screenshot({ path: "/private/tmp/claude-501/-Users-mennan-Projeler-Remote/fa15848a-dcdd-4f1b-abf9-1c72703d5eac/scratchpad/p28d/img/konsol-plain-1280.png" });
  await ctx.close();
});
