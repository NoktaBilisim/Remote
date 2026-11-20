import type { Metadata } from "next";
import Link from "next/link";
import { UpdateBadge } from "@/components/update-badge";
import { notFound, redirect } from "next/navigation";
import { History, Info, UserCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Breadcrumb } from "@/components/breadcrumb";
import { LoadError } from "@/components/load-error";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getMe, serverGet } from "@/lib/server-api";
import type { DeviceDetail, UnattendedStatus } from "@/lib/unattended/contract";
import { gateOpen } from "@/lib/unattended/errors";
import { DeviceBadges } from "../device-badges";
import { UserState } from "../user-state";
import { accessOf, gateBody, ModeBanner, type UnAccess } from "../unattended-shell";
import { DetailConnect, RevokeButton } from "./device-actions";
import { DeviceSessions } from "./device-sessions";
import { GrantsEditor } from "./grants";

export const metadata: Metadata = { title: t("un.detailTitle") };
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const crumbs = [{ label: t("nav.unattended"), href: "/unattended" }];

function Section({ id, title, Icon, children }: { id: string; title: string; Icon: typeof Info; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 border-t border-border pt-6">
      <h2 id={id} className="flex items-center gap-2 text-lg font-semibold text-fg">
        <Icon aria-hidden className="size-5 text-primary" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function InfoList({ d, manage }: { d: DeviceDetail; manage: boolean }) {
  const rows: [string, ReactNode][] = [
    [
      t("un.col.customer"),
      <Link key="c" href={`/customers/${d.customerId}`} className="text-primary hover:underline">
        {d.customerName}
      </Link>,
    ],
    [t("un.d.os"), d.osVersion],
    [
      t("un.d.version"),
      <UpdateBadge key="v" version={d.agentVersion} badge={d.updateBadge} reason={d.updateReason} target={d.updateVersion} />,
    ],
    [t("un.d.signature"), t(d.signed ? "un.d.signed" : "un.d.unsigned")],
    [t("un.col.lastSeen"), d.lastSeenAt ? formatDateTime(d.lastSeenAt) : t("un.never")],
    [t("un.col.lastSession"), d.lastSessionAt ? formatDateTime(d.lastSessionAt) : t("un.never")],
  ];
  if (manage)
    rows.push([
      t("un.d.lastIp"),
      <span key="ip" className="font-mono">
        {d.lastIp ?? "—"}
      </span>,
    ]);
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]" data-testid="un-info">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-fg-muted">{k}</dt>
          <dd className="min-w-0 text-fg wrap-anywhere tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Kapı kapalı / yükleme hatası: yalnız başlık + gövde. */
function TitleOnly({ children }: { children: ReactNode }) {
  return (
    <>
      <Breadcrumb items={[...crumbs, { label: t("un.detailTitle") }]} />
      <h1 className="text-2xl font-semibold text-fg">{t("un.detailTitle")}</h1>
      {children}
    </>
  );
}

function DeviceSections({ d, access }: { d: DeviceDetail; access: UnAccess }) {
  return (
    <div className="mt-6 flex max-w-3xl flex-col gap-6">
      <Section id="cihaz-bilgi" title={t("un.d.info")} Icon={Info}>
        <InfoList d={d} manage={access.manage} />
      </Section>
      {access.manage && d.grants && (
        <Section id="cihaz-yetki" title={t("un.grants.title")} Icon={UserCheck}>
          <GrantsEditor
            deviceId={d.id}
            deviceName={d.name}
            grants={d.grants}
            registeredAt={d.registeredAt}
            registeredIp={d.registeredIp}
            verified={d.verified}
          />
        </Section>
      )}
      {access.history && (
        <Section id="cihaz-oturum" title={t("un.sessions.title")} Icon={History}>
          <DeviceSessions deviceId={d.id} />
        </Section>
      )}
      {access.manage && (
        <div className="border-t border-border pt-6">
          <RevokeButton id={d.id} name={d.name} />
        </div>
      )}
    </div>
  );
}

function DeviceView({ d, status, access }: { d: DeviceDetail; status: UnattendedStatus | null; access: UnAccess }) {
  return (
    <>
      <Breadcrumb items={[...crumbs, { label: d.name }]} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-2xl font-semibold text-fg wrap-anywhere">{d.name}</h1>
          <DeviceBadges device={d} />
          <p className="flex flex-wrap items-center gap-2 text-sm text-fg-muted" data-testid="un-detail-user">
            {t("un.col.user")}: <UserState state={d.userState} />
          </p>
        </div>
        <DetailConnect device={d} available={gateOpen(status)} />
      </div>
      <div className="mt-4 flex max-w-3xl flex-col gap-2">
        <ModeBanner status={status} superAdmin={access.superAdmin} />
      </div>
      <DeviceSections d={d} access={access} />
    </>
  );
}

/**
 * /unattended/[id] — cihaz ayrıntısı (AC-275, 293, 337): bilgi, Bağlan, teknisyen yetkileri ve iptal (`manage`), son 20
 * gözetimsiz oturum. Yok / başka tenant / grant yok → 404 (sunucu varlık sızdırmaz).
 */
export default async function DevicePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await getMe();
  if (me.kind !== "ok") redirect(EXPIRED_LOGIN_PATH);
  const access = accessOf({ ...me.me, permissions: me.me.permissions as readonly string[] });
  const { id } = await params;
  const gate = gateBody(access);
  if (gate) return <TitleOnly>{gate}</TitleOnly>;
  if (!ULID.test(id)) notFound();
  const [res, st] = await Promise.all([
    serverGet<DeviceDetail>(`/unattended/devices/${id}`),
    serverGet<UnattendedStatus>("/unattended/status"),
  ]);
  if (res.kind === "error" && res.status === 401) redirect(EXPIRED_LOGIN_PATH);
  if (res.kind === "error" && res.status === 404) notFound();
  if (res.kind === "error")
    return (
      <TitleOnly>
        <div className="mt-6 max-w-xl">
          <LoadError />
        </div>
      </TitleOnly>
    );
  return <DeviceView d={res.data} status={st.kind === "ok" ? st.data : null} access={access} />;
}
