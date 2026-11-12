// Yerel sahte SMTP (127.0.0.1:2525, kimliksiz, TLS yok). Gelen her iletiyi $WORK/mail/<n>.eml olarak yazar.
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
const req = createRequire("/Users/mennan/Projeler/Remote/apps/server/package.json");
const { SMTPServer } = req("smtp-server");
const dir = process.env.WORK + "/mail"; mkdirSync(dir, { recursive: true });
let n = 0;
const s = new SMTPServer({
  authOptional: true, disabledCommands: ["STARTTLS", "AUTH"], logger: false,
  onData(stream, session, cb) {
    const chunks = []; stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => { const f = `${dir}/${String(++n).padStart(3, "0")}.eml`; writeFileSync(f, `X-Rcpt: ${session.envelope.rcptTo.map((r) => r.address).join(",")}\r\n` + Buffer.concat(chunks).toString("utf8")); cb(); });
  },
});
s.listen(2525, "127.0.0.1", () => console.log("smtp-sink 127.0.0.1:2525"));
