import { Building2 } from "lucide-react";
import type { ReactNode } from "react";
import { ListPageHeader } from "@/components/list-page";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { t } from "@/lib/i18n";
import { UNATTENDED_OFF_BANNER, UNATTENDED_TEST_BANNER, type UnattendedStatus } from "@/lib/unattended/contract";
import { CreateCodeButton } from "./code-dialog";
import { UnTabs } from "./un-tabs";

export interface UnAccess {
  connect: boolean;
  manage: boolean;
  pickTenant: boolean;
  history: boolean;
}

export function accessOf(me: { permissions: readonly string[]; user: { role: string }; actingTenant?: unknown }): UnAccess {
  const p = me.permissions;
  return {
    connect: p.includes("unattended.connect"),
    manage: p.includes("unattended.manage"),
    pickTenant: me.user.role === "SUPER_ADMIN" && !me.actingTenant,
    history: p.includes("session_history.view"),
  };
}

/** Kapı bantları (AC-297, 342): kapalı/imzasız red → `danger`; staging imzasız → TEST `warning`; durum alınamadı → `warning`. */
export function ModeBanner({ status }: { status: UnattendedStatus | null }) {
  if (!status)
    return (
      <Alert tone="warning" testId="un-status-error">
        {t("un.statusError")}
      </Alert>
    );
  return (
    <>
      {!status.available && (
        <Alert tone="danger" testId="un-off-banner">
          {UNATTENDED_OFF_BANNER}
        </Alert>
      )}
      {status.mode === "unsigned" && (
        <Alert tone="warning" testId="un-test-banner">
          {UNATTENDED_TEST_BANNER}
        </Alert>
      )}
    </>
  );
}

/** /unattended ve /unattended/codes ortak kabuğu: başlık (+ yönetici "Kayıt kodu oluştur"), bant, sekmeler (`manage`). */
export function UnattendedShell({
  access,
  status,
  createBlock,
  children,
}: {
  access: UnAccess;
  status: UnattendedStatus | null | undefined;
  createBlock: string | null;
  children: ReactNode;
}) {
  const ready = (access.connect || access.manage) && !access.pickTenant;
  return (
    <>
      <ListPageHeader
        crumb={t("nav.unattended")}
        title={t("un.title")}
        subtitle={t("un.subtitle")}
        actions={ready && access.manage && status !== undefined && <CreateCodeButton block={createBlock} />}
      />
      {ready && status !== undefined && (
        <div className="mt-4 flex max-w-3xl flex-col gap-2">
          <ModeBanner status={status} />
        </div>
      )}
      {ready && access.manage && (
        <div className="mt-6">
          <UnTabs />
        </div>
      )}
      {children}
    </>
  );
}

/** Yetki yok / firma seçilmemiş (Super Admin) gövdesi; null = sayfa açılabilir. */
export function gateBody(access: UnAccess): ReactNode {
  if (!access.connect && !access.manage)
    return (
      <div className="mt-6 max-w-xl">
        <Alert tone="warning" testId="un-forbidden">
          {t("un.forbidden")}
        </Alert>
      </div>
    );
  if (access.pickTenant)
    return (
      <div className="mt-6">
        <EmptyState Icon={Building2} title={t("rq.pickTenantTitle")} body={t("un.pickTenantBody")} testId="un-pick-tenant" />
      </div>
    );
  return null;
}
