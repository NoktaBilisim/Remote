import { sessionTokenSchema } from "@remote/contracts/api/sessions";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { t } from "@/lib/i18n";
import { resolveSessionToken } from "@/lib/server-api";
import { endFromError, GuestShell } from "../guest-ui";
import { GuestFlow } from "./guest-flow";
import { GuestResumeGate } from "./guest-resume-gate";
import type { ResolveData } from "./join-form";

// Token URL'de: başka siteye Referer ile sızmasın, arama motoruna girmesin (G-10, AC-126)
export const metadata: Metadata = {
  title: t("g.title"),
  referrer: "no-referrer",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * /session/[token] — müşteri karşılama → lobi → tarayıcı modu oturumu (P4). Resolve sunucuda yapılır; token istemci
 * JS'ine verilmez, loglanmaz. İstemci yalnız opak `sessionRef` ile 2 sn'de bir durum yoklar.
 */
export default async function GuestSessionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!sessionTokenSchema.safeParse(token).success) notFound();
  const res = await resolveSessionToken<ResolveData>(token);
  if (res.kind === "ok") {
    return (
      <GuestShell>
        <GuestFlow data={res.data} abuseEmail={res.data.abuseEmail} />
      </GuestShell>
    );
  }
  const kind = endFromError(res.status, res.code);
  if (kind === "notFound") notFound();
  return (
    <GuestShell>
      <GuestResumeGate kind={kind} />
    </GuestShell>
  );
}
