import { ArrowLeft, SearchX } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Breadcrumb } from "@/components/breadcrumb";
import { LIST_LINK_CLS } from "@/components/list-page";
import { LoadError } from "@/components/load-error";
import { EmptyState } from "@/components/ui/empty-state";
import { t } from "@/lib/i18n";
import { PORTAL_CHANGE_PASSWORD, PORTAL_HOME } from "@/lib/portal/paths";
import { portalExpiredLogin, portalGet } from "@/lib/portal/server";

export const PORTAL_CRUMB_HOME = { href: PORTAL_HOME, label: t("portal.home") };
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function PortalBreadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return <Breadcrumb home={PORTAL_CRUMB_HOME} items={items} />;
}

const back = (
  <Link href={PORTAL_HOME} className={LIST_LINK_CLS} data-testid="portal-back">
    <ArrowLeft aria-hidden className="size-4" />
    {t("portal.back")}
  </Link>
);

/** 404 (başka müşteri/firma ya da yok — ayrım yapılmaz, mimari-p21 §5.3): aynı ekran. */
export function PortalNotFound() {
  return (
    <EmptyState
      Icon={SearchX}
      title={t("portal.notFound")}
      body={t("portal.notFoundBody")}
      testId="portal-not-found"
      headingLevel={1}
      action={back}
    />
  );
}

/** Tekil kayıt: ULID değilse 404 ekranı; 401/403 kapısı; diğer hata `LoadError`. */
export async function loadPortalItem<T>(kind: "requests" | "sessions", id: string): Promise<{ ok: T } | { view: ReactNode }> {
  if (!ULID.test(id)) return { view: <PortalNotFound /> };
  const r = await portalGet<T>(`/portal/${kind}/${id}`);
  if (r.kind === "ok") return { ok: r.data };
  if (r.status === 401) redirect(await portalExpiredLogin());
  if (r.status === 403 && r.code === "PASSWORD_CHANGE_REQUIRED") redirect(PORTAL_CHANGE_PASSWORD);
  if (r.status === 404) return { view: <PortalNotFound /> };
  return { view: <LoadError /> };
}

export function Facts({ rows, testId }: { rows: { label: string; value: ReactNode; testId?: string }[]; testId: string }) {
  return (
    <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]" data-testid={testId}>
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-fg-muted">{r.label}</dt>
          <dd className="min-w-0 text-fg wrap-anywhere" data-testid={r.testId}>
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export { back as PortalBackLink };
