// Gözetimsiz entegrasyon testleri: gerçek sunucu + süreç içi sahte SMTP gelen kutusu (P28e `recording_policy` dört göz e-postası).
// r3: eski `unattended-silent.ts` fikstürünün izinsiz kip/politika dışı kalan kısmı.
import { closeSmtp, inboxTransport, loopbackNetguard, startInboxSmtp } from "./mail-tls.ts";
import { startLive, type Live } from "./signal-flow.ts";
import { UNSIGNED_ENV } from "./unattended.ts";

/** Gerçek sunucu + süreç içi sahte SMTP (gelen kutusu). */
export async function startMailLive(): Promise<{ live: Live; inbox: { to: string; body: string }[]; close(): Promise<void> }> {
  const inbox: { to: string; body: string }[] = [];
  const { smtp, port } = await startInboxSmtp(inbox);
  const live = await startLive({
    env: { ...UNSIGNED_ENV },
    signaling: { timing: { requestConnectMs: 1500 } },
    p10: { netguard: loopbackNetguard(), mailTransport: inboxTransport(() => port), mfaSetupEnforcement: false },
  });
  return {
    live,
    inbox,
    close: async () => {
      await live.close();
      await closeSmtp(smtp);
    },
  };
}

/** "Subject:" başlığını (RFC 2047 base64/QP, katlanmış) çözer. */
export function decodeSubject(raw: string): string {
  const m = /^Subject: ((?:.*)(?:\r?\n[ \t].*)*)/m.exec(raw);
  if (!m?.[1]) return "";
  return m[1]
    .replace(/\r?\n[ \t]/g, " ")
    .replace(/=\?UTF-8\?([BQ])\?([^?]*)\?=\s*/gi, (_x, enc: string, data: string) =>
      enc.toUpperCase() === "B"
        ? Buffer.from(data, "base64").toString("utf8")
        : Buffer.from(
            data.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (_y, h: string) => String.fromCharCode(parseInt(h, 16))),
            "latin1",
          ).toString("utf8"),
    )
    .trim();
}
