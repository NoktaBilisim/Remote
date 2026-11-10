import { sessionTokenSchema, type ResolveSessionResponse } from "@remote/contracts/api/sessions";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { t } from "@/lib/i18n";
import { resolveSessionToken } from "@/lib/server-api";
import { endFromError, GuestEndScreen, GuestShell } from "../guest-ui";
import { RetryButton } from "../retry-button";
import { GuestWelcome } from "./guest-welcome";

// Token URL'de: başka siteye Referer ile sızmasın, arama motoruna girmesin (G-10, AC-126)
export const metadata: Metadata = {
  title: t("g.title"),
  referrer: "no-referrer",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * /session/[token] — müşteri karşılama (P2 kısmı). Resolve sunucuda yapılır; token istemci
 * JS'ine verilmez, loglanmaz. İstemci yalnız opak `sessionRef` ile 2 sn'de bir durum yoklar.
 */
export default async function GuestSessionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!sessionTokenSchema.safeParse(token).success) notFound();
  const res = await resolveSessionToken<ResolveSessionResponse>(token);
  if (res.kind === "ok") {
    return (
      <GuestShell>
        <GuestWelcome data={res.data} />
      </GuestShell>
    );
  }
  const kind = endFromError(res.status, res.code);
  if (kind === "notFound") notFound();
  return (
    <GuestShell>
      <GuestEndScreen kind={kind} action={kind === "error" ? <RetryButton /> : undefined} />
    </GuestShell>
  );
}
