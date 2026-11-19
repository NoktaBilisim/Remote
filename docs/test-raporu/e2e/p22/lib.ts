// P22-T yardımcıları (yalnız yerel test). Gizli değerler $W/secrets.env + $W/totp.json'dan (600) okunur, yazdırılmaz.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { hotp, base32Decode } from "../../server/src/auth/mfa.ts";

export const W = process.env.P22_W ?? "";
export const BASE = "http://localhost:3484";
export const API = `${BASE}/api/v1`;
const env = Object.fromEntries(
  readFileSync(`${W}/secrets.env`, "utf8")
    .split("\n")
    .map((l) => /^export (\w+)='(.*)'$/.exec(l))
    .filter(Boolean)
    .map((m) => [m![1], m![2]]),
);
export const USERS = { a1: env.A1!, a2: env.A2!, sa: env.SA_EMAIL! };
const PW: Record<string, string> = { [env.A1!]: env.APW!, [env.A2!]: env.APW!, [env.SA_EMAIL!]: env.SA_PW! };
const TOTP_FILE = `${W}/totp.json`;
const totps: Record<string, string> = existsSync(TOTP_FILE) ? JSON.parse(readFileSync(TOTP_FILE, "utf8")) : {};
const STEP_FILE = `${W}/step.json`;
const lastStep: Record<string, number> = existsSync(STEP_FILE) ? JSON.parse(readFileSync(STEP_FILE, "utf8")) : {};

export async function code(email: string): Promise<string> {
  let step = Math.floor(Date.now() / 30000);
  if (step <= (lastStep[email] ?? 0)) {
    await new Promise((r) => setTimeout(r, ((lastStep[email] ?? 0) + 1) * 30000 - Date.now() + 300));
    step = Math.floor(Date.now() / 30000);
  }
  lastStep[email] = step;
  writeFileSync(STEP_FILE, JSON.stringify(lastStep), { mode: 0o600 });
  return hotp(base32Decode(totps[email]!), step);
}

export async function csrf(ctx: BrowserContext): Promise<string> {
  return (await ctx.cookies()).find((c) => c.name === "__Host-rs_csrf")?.value ?? "";
}

export async function api(ctx: BrowserContext, method: string, path: string, data?: unknown) {
  const req: APIRequestContext = ctx.request;
  const res = await req.fetch(API + path, {
    method,
    headers: { Origin: BASE, "x-csrf-token": await csrf(ctx), ...(data !== undefined ? { "Content-Type": "application/json" } : {}) },
    data: data === undefined ? undefined : JSON.stringify(data),
    failOnStatusCode: false,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status(), json };
}

/** API ile giriş (+ 2FA kurulum/doğrulama). Bağlam çerezleri oturumu taşır. */
export async function login(ctx: BrowserContext, email: string) {
  await ctx.request.get(BASE + "/login");
  let r = await api(ctx, "POST", "/auth/login", { login: email, password: PW[email] });
  if (r.status !== 200) throw new Error(`login ${r.status} ${JSON.stringify(r.json)}`);
  if (r.json.mfaSetupRequired) {
    const s = await api(ctx, "POST", "/auth/mfa/setup", {});
    totps[email] = s.json.secret;
    writeFileSync(TOTP_FILE, JSON.stringify(totps), { mode: 0o600 });
    const e = await api(ctx, "POST", "/auth/mfa/enable", { code: await code(email) });
    if (e.status !== 200) throw new Error(`mfa enable ${e.status}`);
    r = await api(ctx, "POST", "/auth/login", { login: email, password: PW[email] });
  }
  if (r.json.mfaRequired) {
    const v = await api(ctx, "POST", "/auth/mfa/verify", { code: await code(email) });
    if (v.status !== 200) throw new Error(`mfa verify ${v.status} ${JSON.stringify(v.json)}`);
  }
  const me = await api(ctx, "GET", "/auth/me");
  if (me.json?.mfa?.stage && me.json.mfa.stage !== "ok") throw new Error(`stage ${me.json.mfa.stage}`);
  return me.json;
}

export async function stepUp(ctx: BrowserContext, email: string) {
  return api(ctx, "POST", "/auth/step-up", { code: await code(email) });
}

/** Önceki koşulardan kalan PENDING/ACTIVE oturumları kapatır. */
export async function cancelLeftovers(ctx: BrowserContext) {
  const list = await api(ctx, "GET", "/sessions?pageSize=100");
  for (const s of (list.json?.items ?? []).filter((i: any) => i.status === "PENDING" || i.status === "ACTIVE")) {
    await api(ctx, "POST", `/sessions/${s.id}/${s.status === "PENDING" ? "cancel" : "terminate"}`, {});
  }
}

export function fakeDisplayMedia() {
  const md = navigator.mediaDevices;
  if (!md) return;
  md.getDisplayMedia = async () => {
    const c = document.createElement("canvas");
    c.width = 1280;
    c.height = 720;
    const x = c.getContext("2d")!;
    let f = 0;
    const draw = () => {
      f++;
      x.fillStyle = `hsl(${f % 360},60%,50%)`;
      x.fillRect(0, 0, 1280, 720);
      x.fillStyle = "#fff";
      x.font = "48px sans-serif";
      x.fillText(`kare ${f}`, 40, 80);
    };
    draw();
    setInterval(draw, 33);
    return (c as any).captureStream(30) as MediaStream;
  };
}

export async function axe(page: Page, include?: string) {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  let b = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  if (include) b = b.include(include);
  const r = await b.analyze();
  return r.violations.map((v) => `${v.id}(${v.nodes.length})`);
}

export async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}
