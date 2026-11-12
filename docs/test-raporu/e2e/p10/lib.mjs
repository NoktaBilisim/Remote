// Ortak: adım kaydı, giriş (+TOTP), sır dosyası ($WORK/sec.json, repo dışı).
import { B, WORK, rec } from "./common.mjs";
import { freshTotp } from "./totp.mjs";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
export const F = "flow.jsonl";
const SEC = WORK + "/sec.json";
export const sec = existsSync(SEC) ? JSON.parse(readFileSync(SEC, "utf8")) : {};
export const save = () => writeFileSync(SEC, JSON.stringify(sec), { mode: 0o600 });
export const used = new Set();
export async function step(name, fn) {
  try { const note = await fn(); rec(F, { step: name, ok: true, note }); console.log("GEÇTİ", name, "|", note ?? ""); }
  catch (e) { rec(F, { step: name, ok: false, err: e.message.slice(0, 400) }); console.log("KALDI", name, "|", e.message.split("\n")[0].slice(0, 300)); }
}
export async function pwLogin(p, id, pw) {
  await p.goto(B + "/login");
  await p.getByLabel("E-posta veya kullanıcı adı").fill(id);
  await p.getByLabel("Şifre", { exact: true }).fill(pw);
  await p.getByRole("button", { name: "Giriş yap" }).click();
  await p.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 });
}
export async function fullLogin(p, id, pw, totpSecret) {
  await pwLogin(p, id, pw);
  if (p.url().endsWith("/login/2fa")) {
    await p.getByLabel("6 haneli kod").fill(await freshTotp(totpSecret, used));
    await p.getByTestId("mfa-submit").click();
    await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
  }
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function sql(q) {
  // geçici test DB'si; app kullanıcısı parolası konteyner ortamından okunur (ekrana yazılmaz)
  return import("node:child_process").then(({ execFileSync }) => execFileSync("docker", ["exec", "rs-mysql-p10op", "sh", "-c", `MYSQL_PWD="$MYSQL_APP_PASSWORD" mysql -uapp -NB remote -e "$0"`, q], { encoding: "utf8" }).trim());
}
