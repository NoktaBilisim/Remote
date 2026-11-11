import { readFileSync } from "node:fs";
const L = readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };
const st = (a) => { a = a.filter((x) => typeof x === "number" && isFinite(x)); return a.length ? { n: a.length, min: +Math.min(...a).toFixed(1), p5: +q(a, .05).toFixed(1), p50: +q(a, .5).toFixed(1), p95: +q(a, .95).toFixed(1), max: +Math.max(...a).toFixed(1), avg: +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(1) } : null; };
for (const r of L.filter((r) => r.kind === "pair" || r.kind === "pair-end")) console.log(r.kind, r.who, r.mode, r.connectionState, r.iceTransportPolicy, "L:", r.local?.type, r.local?.protocol, "relayProto", r.local?.relayProtocol, r.local?.url, "R:", r.remote?.type, r.remote?.protocol, "rtt", r.rttMs);
for (const r of L.filter((r) => r.kind === "iceUrls")) console.log("iceUrls", r.mode, JSON.stringify(r.tech), JSON.stringify(r.guest));
for (const r of L.filter((r) => r.kind === "firstVideoUi")) console.log("firstVideoUi", r.mode, r.ms);
const labels = [...new Set(L.filter((r) => r.kind === "sample").map((r) => r.label))];
for (const lb of labels) {
  const s = L.filter((r) => r.kind === "sample" && r.label === lb);
  const steady = s.slice(5);
  const last = s.at(-1);
  console.log(`\n== ${lb}: ${s.length} örnek; son lost=${last.lost} recv=${last.recv} freeze=${last.freeze} dropped=${last.dropped} codec=${last.codec} res=${last.w}x${last.h} enc=${last.out.enc} qlr=${last.out.qlr}`);
  console.log(" res dağılımı", JSON.stringify(Object.entries(s.reduce((m, r) => ((m[`${r.w}x${r.h}`] = (m[`${r.w}x${r.h}`] ?? 0) + 1), m), {}))));
  console.log(" out res dağılımı", JSON.stringify(Object.entries(s.reduce((m, r) => ((m[`${r.out.w}x${r.out.h}`] = (m[`${r.out.w}x${r.out.h}`] ?? 0) + 1), m), {}))), "qlr", JSON.stringify(Object.entries(s.reduce((m, r) => ((m[r.out.qlr] = (m[r.out.qlr] ?? 0) + 1), m), {}))));
  for (const k of ["fps", "fpsCalc", "kbps", "rttMs", "jitterMs", "jbMs"]) console.log(" all", k, JSON.stringify(st(s.map((r) => r[k]))), " | 5sn sonrası", JSON.stringify(st(steady.map((r) => r[k]))));
  for (const k of ["fps", "targetKbps", "kbps", "availOutKbps"]) console.log(" out", k, JSON.stringify(st(s.map((r) => r.out[k]))));
  console.log(" fps seri", s.map((r) => r.fps).join(","));
  console.log(" lost seri", s.map((r) => r.lost).join(","));
}
for (const r of L.filter((r) => r.kind === "clock")) console.log(`\nclock ${r.label} n=${r.n} bad=${r.bad}`, JSON.stringify(st(r.lat)), " ilk 2 sn hariç:", JSON.stringify(st(r.lat.slice(60))));
for (const r of L.filter((r) => r.kind === "encoder")) console.log("\nencoder", r.label, JSON.stringify({ ...r, test: undefined, trackSettings: { ...r.trackSettings, deviceId: undefined } }));
const ff = {};
for (const r of L.filter((r) => r.kind === "firstframe")) (ff[r.label] ??= []).push(r.ms);
for (const [k, v] of Object.entries(ff)) console.log("\nfirstframe", k, JSON.stringify(st(v)), v.map((x) => x.toFixed(0)).join(","));
for (const r of L.filter((r) => r.kind === "annot")) console.log("\nannot", r.label, r.n, "ok", r.ok ?? r.shown, "lost", JSON.stringify(r.lost ?? []), "lat", JSON.stringify(st(r.lat)), "paint", JSON.stringify(st(r.paintLat)));
const cons = L.filter((r) => r.kind === "console" || r.kind === "pageerror");
console.log("\nconsole/pageerror", cons.length); for (const c of cons.slice(0, 15)) console.log(" ", c.who, c.type ?? c.kind, c.text);
