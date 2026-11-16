import type { SessionView } from "@remote/contracts/api/sessions";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Breadcrumb } from "@/components/breadcrumb";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { t } from "@/lib/i18n";
import { getMe, serverGet } from "@/lib/server-api";
import { ConsoleView } from "./console-view";

export const metadata: Metadata = { title: t("c.title") };

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * /sessions/[id]/console — teknisyen konsolu (P4). Oturum sunucuda okunur; WS yalnız oturumun
 * teknisyenine açılır (AC-15, Admin dahil başkası değil). DESIGN §8: konsol varsayılan koyu.
 */
export default async function ConsolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ULID.test(id)) notFound();
  const me = await getMe();
  if (me.kind !== "ok") redirect(EXPIRED_LOGIN_PATH);
  const res = await serverGet<SessionView>(`/sessions/${id}`);
  if (res.kind === "error" && res.status === 401) redirect(EXPIRED_LOGIN_PATH);
  if (res.kind === "error" && res.status === 404) notFound();

  const crumbs = <Breadcrumb items={[{ label: t("nav.sessions"), href: "/sessions" }, { label: t("c.title") }]} />;
  const back = (
    <Link href="/sessions" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:underline">
      <ArrowLeft aria-hidden className="size-4" />
      {t("c.back")}
    </Link>
  );
  let blocked: string | null = null;
  const isOwner = res.kind === "ok" && res.data.technician.id === me.me.user.id;
  // P28c (§4.1): sahip olmayan kullanıcı yalnız ACTIVE odaya üye olarak bağlanabilir (sunucu WS'te §4.3 `ws` evresini uygular;
  // üye değilse ilk `hello`'dan önce kapanış → "notMember"). PENDING oturumun konsolu yalnız sahibe.
  if (res.kind === "ok" && !isOwner && res.data.status !== "ACTIVE") blocked = t("c.notOwner");
  else if (res.kind === "ok" && res.data.status !== "PENDING" && res.data.status !== "ACTIVE") blocked = t("c.closed");

  return (
    <div className="theme-dark flex flex-col gap-4">
      {crumbs}
      {res.kind === "error" ? (
        <div className="max-w-xl">
          <LoadError />
        </div>
      ) : blocked ? (
        <div className="flex max-w-xl flex-col gap-3">
          <h1 className="text-2xl font-semibold text-fg">{t("c.title")}</h1>
          <Alert tone="warning">{blocked}</Alert>
          {back}
        </div>
      ) : (
        <ConsoleView
          session={res.data}
          canFiles={me.me.permissions.includes("file_transfer.use")}
          canControl={me.me.permissions.includes("remote_control.use")}
          canClip={me.me.permissions.includes("remote_control.clipboard")}
          canPrint={me.me.permissions.includes("file_transfer.print")}
          isOwner={isOwner}
          canInvite={me.me.permissions.includes("sessions.invite")}
        />
      )}
    </div>
  );
}
