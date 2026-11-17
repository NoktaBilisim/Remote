// Test operatörü yardımcısı (ürün kodu değil): :4218 → :4217 şeffaf vekil; GET /api/v1/audit yanıtına
// P28f `os` beyanlı katılım satırları ekler (sahte API'de os alanlı satır yok, liste SSR olduğundan page.route yetmez).
import http from "node:http";
const UP = { host: "127.0.0.1", port: 4217 };
const now = Date.now();
const row = (id, action, newValue, ms) => ({
  id, createdAt: new Date(now - ms).toISOString(), tenantId: "01JHXT0000000000000000000T1".slice(0, 26), tenantName: "Demo Firma",
  userId: null, username: "customer", userFullName: null, avatarUrl: null, action, entity: "support_sessions",
  entityId: "01JHXST000000000000000P28F", oldValue: null, newValue, ipAddress: "203.0.113.0/24", userAgent: null, result: "success",
});
http.createServer((req, res) => {
  const p = http.request({ ...UP, method: req.method, path: req.url, headers: req.headers }, (u) => {
    const url = new URL(req.url, "http://x");
    if (req.method !== "GET" || url.pathname !== "/api/v1/audit" || url.searchParams.has("cursor") || u.statusCode !== 200) {
      res.writeHead(u.statusCode, u.headers); u.pipe(res); return;
    }
    const chunks = []; u.on("data", (c) => chunks.push(c)); u.on("end", () => {
      const j = JSON.parse(Buffer.concat(chunks).toString());
      const t1 = j.items[0]?.tenantId ?? null;
      const extra = [
        row("9001", "guest.pending", { guestKind: "AGENT", os: "macos" }, 10_000),
        row("9002", "guest.pending", { guestKind: "AGENT", os: "windows" }, 20_000),
        row("9003", "session.join", { customerName: "x", os: "<b>x</b>" }, 30_000),
        row("9004", "guest.pending", { mode: "BROWSER", os: "browser" }, 40_000),
      ].map((r) => ({ ...r, tenantId: t1 }));
      j.items = [...extra, ...j.items].slice(0, 50);
      const b = Buffer.from(JSON.stringify(j));
      const h = { ...u.headers, "content-length": String(b.length) }; delete h["transfer-encoding"];
      res.writeHead(200, h); res.end(b);
    });
  });
  p.on("error", () => { res.writeHead(502); res.end(); });
  req.pipe(p);
}).listen(4218, "127.0.0.1");
