// P28c K5 (test-operatoru, geçici): sunucu tarafı API_INTERNAL_URL için geçirgen vekil. Yalnız
// GET /api/v1/sessions/<RICH>/history yanıtına `participants` ekler (sahte API'de P28c katılımcı verisi yok).
// Koşu: node history-proxy.mjs (:4219 → :4217). Kod değil; ürün davranışını değiştirmez.
import http from "node:http";
import net from "node:net";
const RICH = "01JHXST0000000000000000000";
const UP = { host: "127.0.0.1", port: 4217 };
const T0 = Date.parse("2026-11-10T09:00:00Z");
const at = (m) => new Date(T0 + m * 60_000).toISOString();
const PARTS = [
  { userId: "01JUSR0000000000000000000A", name: "Mehmet Teknisyen", role: "owner", joinedAt: at(0), leftAt: at(40), leaveReason: null, transferredAt: at(25) },
  { userId: "01JUSR0000000000000000000B", name: "Burak Katılımcı Çok Uzun Soyadlı Teknisyen Adı Örneği <script>alert(1)</script>", role: "participant", joinedAt: at(5), leftAt: at(20), leaveReason: "removed", transferredAt: null },
  { userId: "01JUSR0000000000000000000C", name: "Selin İzleyici", role: "observer", joinedAt: at(10), leftAt: null, leaveReason: null, transferredAt: null },
  { userId: "01JUSR0000000000000000000D", name: "Kerem Devralan", role: "participant", joinedAt: at(12), leftAt: at(40), leaveReason: "left", transferredAt: at(25) },
];
http
  .createServer((req, res) => {
    const patch = req.method === "GET" && req.url === `/api/v1/sessions/${RICH}/history`;
    const up = http.request({ ...UP, method: req.method, path: req.url, headers: req.headers }, (r) => {
      if (!patch || r.statusCode !== 200) {
        res.writeHead(r.statusCode ?? 502, r.headers);
        return r.pipe(res);
      }
      const chunks = [];
      r.on("data", (c) => chunks.push(c));
      r.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        body.participants = PARTS;
        const out = Buffer.from(JSON.stringify(body));
        const h = { ...r.headers, "content-length": String(out.length) };
        delete h["content-encoding"]; delete h["transfer-encoding"];
        res.writeHead(200, h);
        res.end(out);
      });
    });
    up.on("error", () => (res.writeHead(502), res.end()));
    req.pipe(up);
  })
  .on("upgrade", (req, sock, head) => {
    // WS geçişi: ham TCP boru (başlıklar olduğu gibi)
    const up = net.connect(UP.port, UP.host, () => {
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n") + "\r\n\r\n");
      if (head?.length) up.write(head);
      sock.pipe(up).pipe(sock);
    });
    up.on("error", () => sock.destroy());
    sock.on("error", () => up.destroy());
  })
  .listen(4219, "127.0.0.1", () => console.log("history-proxy :4219"));
