import type { SessionHistoryDetail } from "@remote/contracts/api/sessions";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Breadcrumb } from "@/components/breadcrumb";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getMe, serverGet } from "@/lib/server-api";
import { NoteForm } from "./note-form";
import { ConsentsList, ControlPeriods, Files, Quality, Section, Summary, Timeline } from "./sections";

export const metadata: Metadata = { title: t("h.d.title") };

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** /history/[id] — oturum ayrıntısı (P8: AC-61, 62, 63). Kapsam dışı / yok → 404 (sunucu varlık sızdırmaz). */
export default async function HistoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (me.kind !== "ok") redirect(EXPIRED_LOGIN_PATH);
  const perms = me.me.permissions as readonly string[];
  const crumbs = [{ label: t("nav.history"), href: "/history" }, { label: t("h.d.title") }];
  if (!perms.includes("session_history.view")) {
    return (
      <>
        <Breadcrumb items={crumbs} />
        <h1 className="text-2xl font-semibold text-fg">{t("h.d.title")}</h1>
        <div className="mt-6 max-w-xl"><Alert tone="warning" testId="history-forbidden">{t("h.forbidden")}</Alert></div>
      </>
    );
  }
  if (!ULID.test(id)) notFound();
  const res = await serverGet<SessionHistoryDetail>(`/sessions/${id}/history`);
  if (res.kind === "error" && res.status === 401) redirect(EXPIRED_LOGIN_PATH);
  if (res.kind === "error" && res.status === 404) notFound();
  if (res.kind === "error") {
    return (
      <>
        <Breadcrumb items={crumbs} />
        <h1 className="text-2xl font-semibold text-fg">{t("h.d.title")}</h1>
        <div className="mt-6 max-w-xl">
          {res.status === 403 ? <Alert tone="warning" testId="history-forbidden">{t("h.forbidden")}</Alert> : <LoadError />}
        </div>
      </>
    );
  }
  const s = res.data;
  const showTenant = me.me.user.role === "SUPER_ADMIN" && !me.me.actingTenant;
  const canEdit = perms.includes("session_history.edit");

  return (
    <>
      <Breadcrumb items={[{ label: t("nav.history"), href: "/history" }, { label: s.customerName ?? t("h.d.title") }]} />
      <h1 className="text-2xl font-semibold text-fg wrap-anywhere" data-testid="detail-title">
        {s.customerName ?? t("h.d.title")}
      </h1>
      <p className="mt-1 text-sm text-fg-muted tabular-nums">{formatDateTime(s.createdAt)} · {s.technician.name}</p>

      <div className="mt-6 flex flex-col gap-8">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <Section id="summary" title={t("h.d.summary")}>
            <Summary s={s} showTenant={showTenant} />
          </Section>
          <Section id="note" title={t("h.n.title")}>
            {canEdit ? (
              <NoteForm session={s} />
            ) : s.ticketNo || s.note ? (
              <dl className="flex flex-col gap-2 text-sm" data-testid="note-readonly">
                <dt className="text-fg-muted">{t("h.n.ticket")}</dt>
                <dd className="text-fg wrap-anywhere">{s.ticketNo ?? "—"}</dd>
                <dt className="text-fg-muted">{t("h.n.note")}</dt>
                <dd className="whitespace-pre-wrap text-fg wrap-anywhere">{s.note ?? "—"}</dd>
                <dd className="mt-2 text-xs text-fg-muted">{t("h.n.readonly")}</dd>
              </dl>
            ) : (
              <p className="text-sm text-fg-muted" data-testid="note-readonly">{t("h.n.empty")} {t("h.n.readonly")}</p>
            )}
          </Section>
        </div>
        <Section id="consents" title={t("h.c.title")}>
          <ConsentsList s={s} />
        </Section>
        <Section id="control" title={t("h.k.title")}>
          <ControlPeriods s={s} />
        </Section>
        <Section id="timeline" title={t("h.t.title")}>
          <Timeline s={s} />
        </Section>
        <Section id="quality" title={t("h.q.title")}>
          <Quality s={s} />
        </Section>
        {/* Dosyalar tam genişlik: 6 sütunlu tablo yarım sütuna sığmıyordu (TEST-P8-1). */}
        <Section id="files" title={t("h.file.title")}>
          <Files s={s} />
        </Section>
      </div>
    </>
  );
}
