// API akışları: public güncelleme uçları (curl, doğrudan sunucu portu, istemci UA), olaylar → audit, politika Kapalı →
// bindings/status + ?ref= policy, IDOR, rol 403. Kayıt anahtarı P29_STATE'ten okunur, çıktıya yazılmaz.
import { execFileSync } from "node:child_process";
import { API, login, rec, state } from "./p29lib.mjs";
const st = state();
const UA = "NoktaDestek/0.22.0";
const out = [];
const ok = (name, cond, note = "") => { out.push(`${cond ? "OK  " : "FAIL"} ${name}${note ? " — " + note : ""}`); rec({ kind: "flow", name, ok: !!cond, note }); };
function curl(method, url, body) {
  const args = ["-s", "-o", "/dev/stdout", "-w", "\n%{http_code}", "-A", UA, "-X", method, API + url];
  if (body !== undefined) args.push("-H", "content-type: application/json", "--data-binary", JSON.stringify(body));
  const r = execFileSync("curl", args).toString(); const i = r.lastIndexOf("\n");
  return { status: Number(r.slice(i + 1)), text: r.slice(0, i) };
}
const CHECK = "/api/v1/public/agent/update?platform=windows&arch=amd64&component=client";
const policy = (ref) => JSON.parse(curl("GET", `${CHECK}&ref=${ref}`).text).policy;
const at = new Date().toISOString().slice(0, 19) + "Z";

const A = await login(st.adminA.email, st.totp.adminA);
const B = await login(st.adminB.email, st.totp.adminB);
const V = await login(st.viewA.email, st.totp.viewA);
const N = await login(st.noneA.email, st.totp.noneA);
const SA = await login(st.sa.email, st.totp.sa);

// 1) Denetim ucu
ok("GET update windows client 200 + auto", curl("GET", CHECK).status === 200 && policy(st.refA) === "auto");
ok("GET update linux (yanlış anahtarla imzalı) 204", curl("GET", "/api/v1/public/agent/update?platform=linux&arch=amd64&component=client").status === 204);
const bad = curl("GET", "/api/v1/public/agent/update?platform=CANARYX&arch=amd64&component=client&CANARYK=1");
ok("GET update biçim hatası 400, değer yansımaz", bad.status === 400 && !bad.text.includes("CANARY"), bad.text.slice(0, 120));

// 2) Olaylar: kimlikli (tek istek, 5 tür) → 204 + audit; kimliksiz → 204, audit yok; biçim → 400
const ev = (type, reason) => ({ type, version: "0.22.1", fromVersion: "0.22.0", ...(reason ? { reason } : {}), at });
const r1 = curl("POST", "/api/v1/public/agent/update-events", {
  platform: "windows", arch: "amd64", component: "client", bindingKeys: [st.bindingKey],
  events: [ev("available"), ev("installed"), ev("failed", "MANIFEST_SIGNATURE"), ev("rolled_back", "HEALTH"), ev("skipped", "NOT_WRITABLE")],
});
ok("update-events kimlikli → 204", r1.status === 204, String(r1.status));
const r2 = curl("POST", "/api/v1/public/agent/update-events", { platform: "windows", arch: "amd64", component: "client", events: [ev("failed", "HASH_MISMATCH")] });
ok("update-events kimliksiz → 204", r2.status === 204, String(r2.status));
const r3 = curl("POST", "/api/v1/public/agent/update-events", { platform: "windows", arch: "amd64", component: "client", events: [ev("available", "HEALTH")] });
ok("update-events neden/tür uyuşmazlığı → 400", r3.status === 400, String(r3.status));
await new Promise((r) => setTimeout(r, 800));
const au = await A.call("GET", "/audit?action=client.update.*&limit=50");
const items = au.json?.items ?? au.json?.rows ?? [];
const mine = items.filter((x) => x.entityId === st.bindingId);
ok("audit: kimlikli olaylar A firmasında (5 satır)", mine.length === 5, `${au.status} toplam ${items.length}, kayıt ${mine.length}: ${mine.map((x) => x.action + "/" + x.result).join(", ")}`);
ok("audit: imza reddi result=fail", mine.some((x) => x.action === "client.update.failed" && x.result === "fail"));
ok("audit: kimliksiz HASH_MISMATCH yazılmadı", !items.some((x) => JSON.stringify(x).includes("HASH_MISMATCH")));
ok("audit: ham kayıt anahtarı yanıtta yok", !au.text.includes(st.bindingKey));
const auB = await B.call("GET", "/audit?action=client.update.*&limit=50");
ok("IDOR: B audit'inde A olayları yok", !(auB.json?.items ?? []).some((x) => x.entityId === st.bindingId), String(auB.status));

// 3) Sürüm uçları + IDOR
const vA = await A.call("GET", "/unattended/versions");
ok("A /unattended/versions 200, B sürümü (0.19.7) yok", vA.status === 200 && !vA.text.includes("0.19.7"), vA.text.slice(0, 300));
const vB = await B.call("GET", "/unattended/versions");
ok("B /unattended/versions yalnız 0.19.7 ×2", vB.status === 200 && !vB.text.includes("0.22."), vB.text.slice(0, 200));
ok("A scope=all → 403", (await A.call("GET", "/unattended/versions?scope=all")).status === 403);
const lA = await A.call("GET", "/unattended?version=0.19.7");
ok("A ?version=0.19.7 → B cihazı yok", lA.status === 200 && !lA.text.includes("B-GIZLI"), String(lA.status));
const lA2 = await A.call("GET", "/unattended");
ok("A liste: 6 cihaz, agentVersion/updateBadge dolu", lA2.status === 200 && !lA2.text.includes("B-GIZLI"), lA2.text.slice(0, 200));
rec({ kind: "data", name: "A liste", body: lA2.json });
const dB = await A.call("GET", `/unattended/${st.devB.gizli}`);
ok("A → B cihaz detayı 404", dB.status === 404, String(dB.status));
const saNo = await SA.call("GET", "/unattended/versions");
const saAll = await SA.call("GET", "/unattended/versions?scope=all");
ok("SA firma seçmeden versions 403, scope=all 200", saNo.status === 403 && saAll.status === 200, `${saNo.status}/${saAll.status} ${saNo.text.slice(0, 100)}`);

// 4) Ayar uçları + roller
ok("noneA GET settings/client-update 403", (await N.call("GET", "/settings/client-update")).status === 403);
ok("noneA /unattended/versions 403", (await N.call("GET", "/unattended/versions")).status === 403);
ok("viewA GET 200", (await V.call("GET", "/settings/client-update")).status === 200);
ok("viewA PUT 403", (await V.call("PUT", "/settings/client-update", { autoUpdate: false })).status === 403);
const g0 = await A.call("GET", "/settings/client-update");
ok("A varsayılan autoUpdate=true", g0.json?.autoUpdate === true, g0.text);
const bst = () => JSON.parse(curl("POST", "/api/v1/public/bindings/status", { bindingKey: st.bindingKey, clientVersion: "0.22.0" }).text);
ok("bindings/status autoUpdate=true (önce)", bst().autoUpdate === true);
const bad2 = await A.call("PUT", "/settings/client-update", { autoUpdate: "hayır" });
ok("PUT geçersiz tür 400", bad2.status === 400, String(bad2.status));
const p = await A.call("PUT", "/settings/client-update", { autoUpdate: false });
ok("A PUT autoUpdate=false 200", p.status === 200 && p.json?.autoUpdate === false, p.text);
const s1 = bst();
ok("bindings/status autoUpdate=false (sonra)", s1.autoUpdate === false, JSON.stringify(s1).replace(st.bindingKey, "***").slice(0, 200));
ok("?ref=<A Genel ref> policy=notify", policy(st.refA) === "notify");
ok("?ref=<A müşteri ref> policy=notify", policy(st.custARef) === "notify");
ok("B'nin politikası etkilenmedi (B GET true)", (await B.call("GET", "/settings/client-update")).json?.autoUpdate === true);
const aud2 = await A.call("GET", "/audit?action=settings.client_update&limit=5");
ok("audit settings.client_update eski→yeni", aud2.status === 200 && aud2.text.includes("settings.client_update"), aud2.text.slice(0, 400));
console.log(out.join("\n"));
