// $WORK/mail/*.eml okuyucu: quoted-printable/base64 gövdeyi çözer.
import { readdirSync, readFileSync } from "node:fs";
const qp = (s) => Buffer.from(s.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8");
export function mails(work) {
  let files = []; try { files = readdirSync(work + "/mail").sort(); } catch {}
  return files.map((f) => {
    const raw = readFileSync(`${work}/mail/${f}`, "utf8");
    const rcpt = raw.match(/^X-Rcpt: (.*)$/m)?.[1] ?? "";
    const subjRaw = raw.match(/^Subject: (.*(?:\r?\n[ \t].*)*)/m)?.[1] ?? "";
    const subject = subjRaw.replace(/\r?\n[ \t]/g, " ").replace(/=\?utf-8\?([BQ])\?([^?]*)\?=/gi, (_, e, t) => e.toUpperCase() === "B" ? Buffer.from(t, "base64").toString("utf8") : qp(t.replace(/_/g, " "))).replace(/\?=\s+=\?/g, "");
    let body = raw;
    for (const part of raw.split(/\r?\n--/)) {
      if (/Content-Transfer-Encoding: base64/i.test(part)) { const b = part.split(/\r?\n\r?\n/).slice(1).join("").replace(/\s/g, ""); body += "\n" + Buffer.from(b, "base64").toString("utf8"); }
      if (/Content-Transfer-Encoding: quoted-printable/i.test(part)) body += "\n" + qp(part);
    }
    return { file: f, rcpt, subject, body };
  });
}
