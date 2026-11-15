// K12 gerçek sunucu akışı (P27a + P27 REST): hatırla → çıkış → TOTP'siz giriş; cihaz kaldır → TOTP geri; step-up atlanmaz;
// kayıt kodu SMTP yokken 409. Yalnız yerel geçici DB'ye karşı. Parola dosyadan okunur, yazdırılmaz.
import { readFileSync } from "node:fs";
import { hotp, base32Decode } from "/Users/mennan/Projeler/Remote/apps/server/src/auth/mfa.ts";

const API = "http://127.0.0.1:3352/api/v1";
const ORIGIN = "http://localhost:3218";
const PW = readFileSync(new URL("./.pw", import.meta.url), "utf8").trim();
const LOGIN = "k12a@e2e.invalid";
const out: string[] = [];
const ok = (name: string, cond: boolean, info: unknown = "") => out.push(`${cond ? "PASS" : "FAIL"} ${name} ${cond ? "" : JSON.stringify(info)}`);

type Jar = Map<string, string>;
function store(jar: Jar, res: Response) {
  for (const c of res.headers.getSetCookie()) {
    const [kv, ...attrs] = c.split(";");
    const i = kv.indexOf("=");
    const k = kv.slice(0, i).trim();
    const v = kv.slice(i + 1);
    const del = attrs.some((a) => /max-age=0/i.test(a)) || v === "";
    if (del) jar.delete(k);
    else jar.set(k, v);
  }
}
async function call(jar: Jar, method: string, path: string, body?: unknown) {
  const csrf = [...jar.entries()].find(([k]) => /csrf/i.test(k))?.[1];
  const res = await fetch(API + path, {
    method,
    headers: {
      Origin: ORIGIN,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(csrf ? { "x-csrf-token": csrf } : {}),
      Cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  store(jar, res);
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, setCookie: res.headers.getSetCookie() };
}
let lastStep = 0;
async function totp(secret: string) {
  // Aynı 30 sn adımında ikinci kullanım tekrar sayılabilir → yeni adımı bekle
  let step = Math.floor(Date.now() / 30000);
  if (step <= lastStep) {
    await new Promise((r) => setTimeout(r, (lastStep + 1) * 30000 - Date.now() + 200));
    step = Math.floor(Date.now() / 30000);
  }
  lastStep = step;
  return hotp(base32Decode(secret), step);
}
const csrfPrime = async (jar: Jar) => {
  await call(jar, "GET", "/auth/csrf").catch(() => null);
};

const jar: Jar = new Map();
await csrfPrime(jar);
let r = await call(jar, "POST", "/auth/login", { login: LOGIN, password: PW });
out.push(`login1 ${r.status} ${JSON.stringify({ mfaRequired: r.json?.mfaRequired, setup: r.json?.mfaSetupRequired, mcp: r.json?.mustChangePassword })}`);
r = await call(jar, "POST", "/auth/mfa/setup", {});
const secret: string = r.json?.secret;
ok("mfa setup", r.status === 200 && !!secret, r);
r = await call(jar, "POST", "/auth/mfa/enable", { code: await totp(secret) });
ok("mfa enable", r.status === 200, r);
r = await call(jar, "GET", "/auth/me");
out.push(`me after enable: stage=${r.json?.mfa?.stage} rememberAvail=${r.json?.mfa?.rememberDeviceAvailable}`);
r = await call(jar, "POST", "/auth/logout", {});
ok("logout1", r.status < 300, r.status);

// 2) Giriş → 2FA adımı → hatırla
r = await call(jar, "POST", "/auth/login", { login: LOGIN, password: PW });
ok("login2 mfaRequired=true", r.json?.mfaRequired === true, r.json);
r = await call(jar, "GET", "/auth/me");
ok("me verify stage rememberDeviceAvailable=true", r.json?.mfa?.rememberDeviceAvailable === true, r.json?.mfa);
r = await call(jar, "POST", "/auth/mfa/verify", { code: await totp(secret), rememberDevice: true });
const tdCookie = r.setCookie.find((c) => /rs_td/.test(c)) ?? "";
ok("verify rememberDevice → deviceRemembered", r.json?.deviceRemembered === true, r.json);
ok("td çerezi HttpOnly/Secure/SameSite=Strict/Path=/api/v1/auth/Max-Age=2592000",
  /HttpOnly/i.test(tdCookie) && /Secure/i.test(tdCookie) && /SameSite=Strict/i.test(tdCookie) && /Path=\/api\/v1\/auth/i.test(tdCookie) && /Max-Age=2592000/i.test(tdCookie),
  tdCookie.replace(/=[^;]+/, "=***"));
r = await call(jar, "GET", "/auth/trusted-devices");
ok("liste 1 cihaz current=true", r.json?.items?.length === 1 && r.json.items[0].current === true, r.json);
r = await call(jar, "POST", "/auth/logout", {});
ok("logout2", r.status < 300, r.status);
const tdKey = [...jar.keys()].find((k) => /rs_td/.test(k));
ok("çıkıştan sonra td çerezi kalır", !!tdKey, [...jar.keys()]);
const firstTd = tdKey ? jar.get(tdKey) : "";

// 3) Tekrar giriş TOTP'siz
r = await call(jar, "POST", "/auth/login", { login: LOGIN, password: PW });
ok("login3 TOTP'siz (mfaRequired=false)", r.json?.mfaRequired === false, r.json);
ok("td döndürüldü (yeni değer)", !!tdKey && jar.get(tdKey) !== firstTd);
r = await call(jar, "GET", "/auth/me");
ok("me stage=ok", r.json?.mfa?.stage === "ok", r.json?.mfa);

// 4) Step-up atlanmaz (AC-327): hassas uç
r = await call(jar, "POST", "/unattended/registration-codes", { customerId: "01JAAAAAAAAAAAAAAAAAAAAAAA" });
ok("hatırlanan oturumda kayıt kodu → 401 MFA_STEP_UP_REQUIRED (veya mod off 403/409)", r.status === 401 || r.status === 403 || r.status === 409, { s: r.status, c: r.json?.error?.code });
out.push(`registration-codes (mode off, step-up yok): ${r.status} ${r.json?.error?.code}`);
r = await call(jar, "POST", "/auth/step-up", { method: "TOTP", code: await totp(secret) });
ok("step-up 200", r.status === 200, r);
r = await call(jar, "POST", "/unattended/registration-codes", { customerId: "01JAAAAAAAAAAAAAAAAAAAAAAA" });
out.push(`registration-codes step-up sonrası: ${r.status} ${r.json?.error?.code}`);
r = await call(jar, "GET", "/unattended/status");
out.push(`unattended/status: ${r.status} ${JSON.stringify(r.json)}`);

// 5) Eski (döndürülmüş) çerezle giriş → yeniden kullanım (AC-335b)
const reuseJar: Jar = new Map();
await csrfPrime(reuseJar);
if (tdKey && firstTd) reuseJar.set(tdKey, firstTd);
r = await call(reuseJar, "POST", "/auth/login", { login: LOGIN, password: PW });
ok("eski td ile giriş → TOTP sorulur (reuse)", r.json?.mfaRequired === true, r.json);
r = await call(jar, "GET", "/auth/me");
ok("reuse sonrası asıl oturum kapandı (401)", r.status === 401, r.status);

// 6) Yeniden hatırla → kaldır → TOTP geri gelir
const j2: Jar = new Map();
await csrfPrime(j2);
r = await call(j2, "POST", "/auth/login", { login: LOGIN, password: PW });
ok("reuse sonrası giriş TOTP ister", r.json?.mfaRequired === true, r.json);
r = await call(j2, "POST", "/auth/mfa/verify", { code: await totp(secret), rememberDevice: true });
ok("yeniden hatırla", r.json?.deviceRemembered === true, r.json);
r = await call(j2, "GET", "/auth/trusted-devices");
const id = r.json?.items?.[0]?.id;
ok("liste 1 cihaz", r.json?.items?.length === 1, r.json);
r = await call(j2, "DELETE", `/auth/trusted-devices/${id}`);
ok("bu cihazı kaldır → currentCleared", r.status === 200 && r.json?.currentCleared === true, r);
ok("kaldırınca yanıt td çerezini siler", ![...j2.keys()].some((k) => /rs_td/.test(k)), [...j2.keys()]);
r = await call(j2, "DELETE", `/auth/trusted-devices/01JAAAAAAAAAAAAAAAAAAAAAAA`);
ok("bilinmeyen id 404", r.status === 404, r.status);
r = await call(j2, "POST", "/auth/logout", {});
r = await call(j2, "POST", "/auth/login", { login: LOGIN, password: PW });
ok("kaldırdıktan sonra giriş TOTP ister", r.json?.mfaRequired === true, r.json);

// 7) Kurtarma kodu modunda rememberDevice 400
r = await call(j2, "POST", "/auth/mfa/verify", { recoveryCode: "AAAA-BBBB", rememberDevice: true });
out.push(`recovery+rememberDevice: ${r.status} ${r.json?.error?.code}`);

console.log(out.join("\n"));
