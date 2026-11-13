// P12b operatör: :4218 → :4217 ince vekil. GET /api/v1/audit yanıtının başına 3 WhatsApp audit kaydı ekler (yalnız test).
// Amaç: audit listesi SSR olduğundan tarayıcıda taklit edilemiyor; yeni eylem etiketleri liste/detayda gerçek yoldan görülsün.
import http from "node:http";
const items = (now) => [
  ["9003", "settings.whatsapp.test", null, { phone: "+90532*****00", result: "fail", reason: "unreachable" }, "fail"],
  ["9002", "settings.whatsapp.deleted", { url: "https://wa.ornek.com" }, null, "success"],
  ["9001", "settings.whatsapp.updated", { url: "http://10.20.0.5:3000" }, { url: "https://wa.ornek.com" }, "success"],
].map(([id, action, oldValue, newValue, result]) => ({ id, createdAt: new Date(now).toISOString(), tenantId: null, tenantName: null, userId: "01JAV00000000000000000000A", username: "derya@ornek.com", userFullName: "Derya Kaya", avatarUrl: null, action, entity: "system_settings", entityId: null, oldValue, newValue, ipAddress: "203.0.113.7", userAgent: "Chrome/130", result }));
http.createServer((req, res) => {
  const up = http.request({ host: "127.0.0.1", port: 4217, path: req.url, method: req.method, headers: req.headers }, (r) => {
    const isList = req.method === "GET" && /^\/api\/v1\/audit(\?|$)/.test(req.url) && !/cursor=/.test(req.url) && r.statusCode === 200;
    if (!isList) { res.writeHead(r.statusCode, r.headers); r.pipe(res); return; }
    let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => {
      const j = JSON.parse(b); j.items = [...items(Date.now()), ...j.items];
      const out = JSON.stringify(j); const h = { ...r.headers }; delete h["content-length"]; delete h["transfer-encoding"];
      res.writeHead(200, h); res.end(out);
    });
  });
  req.pipe(up);
}).listen(4218, "127.0.0.1");
