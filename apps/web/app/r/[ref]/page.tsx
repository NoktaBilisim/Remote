import { tenantRefSchema } from "@remote/contracts/api/requests";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { t } from "@/lib/i18n";
import { WebRequestFlow } from "./web-request-flow";

// Ref URL'de: başka siteye Referer ile sızmasın, arama motoruna girmesin (G-10; Caddy logunda `/r/***`)
export const metadata: Metadata = {
  title: t("wr.title"),
  referrer: "no-referrer",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * /r/[ref] — herkese açık web talep formu (P19 AC-259; mimari-e11 §8c.2). Form bilgisi ve token TARAYICIDAN alınır
 * (`GET /public/web-requests/form`): IP kovaları ziyaretçinin adresini saymalı, 2 sn sayacı tarayıcıda başlamalı.
 * Biçimi bozuk ref → tek tip not-found; geçersiz/kapalı form da aynı ekranı görür (S-P19-2).
 */
export default async function WebRequestPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  if (!tenantRefSchema.safeParse(ref).success) notFound();
  return <WebRequestFlow tenantRef={ref} />;
}
