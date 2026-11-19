// Kurulum: setup.json'daki her kullanıcı için ilk giriş → 2FA kurulumu (API). Sırlar P29_STATE'e (scratch) yazılır.
import fs from "node:fs";
import { client, freshTotp } from "./p29lib.mjs";
const st = JSON.parse(fs.readFileSync(process.env.P29_STATE));
st.totp ??= {};
for (const k of ["sa", "adminA", "viewA", "noneA", "adminB"]) {
  if (st.totp[k]) continue;
  const c = client();
  const r = await c.call("POST", "/auth/login", { login: st[k].email, password: process.env.P29_PW });
  const s = await c.call("POST", "/auth/mfa/setup", {});
  if (s.status !== 200) throw new Error(`${k} setup ${r.status}/${s.status} ${s.text}`);
  const e = await c.call("POST", "/auth/mfa/enable", { code: await freshTotp(s.json.secret) });
  if (e.status !== 200) throw new Error(`${k} enable ${e.status} ${e.text}`);
  st.totp[k] = s.json.secret;
  console.log(k, "2FA kuruldu");
}
fs.writeFileSync(process.env.P29_STATE, JSON.stringify(st));
