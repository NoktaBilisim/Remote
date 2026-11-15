import type { SessionListResponse } from "@remote/contracts/api/sessions";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Breadcrumb } from "@/components/breadcrumb";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { t } from "@/lib/i18n";
import { getMe, serverGet } from "@/lib/server-api";
import { SessionsView } from "./sessions-view";

export const metadata: Metadata = { title: t("nav.sessions") };

/** /sessions — teknisyenin destek oturumları (P2: AC-1..5, 8, 9, 11, 12, 61). Veri sunucuda çekilir, istemci 10 sn'de bir yeniler. */
export default async function SessionsPage() {
  const me = await getMe();
  if (me.kind !== "ok") redirect(EXPIRED_LOGIN_PATH);
  const perms = me.me.permissions as readonly string[];
  // Firma seçmemiş Super Admin: liste tüm firmaları gösterir (historyScope), ama oluşturma/iptal/sonlandırma firma ister
  // (tenantScope → 403 "Önce bir firma seçin."). Bu eylemler gizlenir, yerine yönlendirme notu gösterilir.
  const pickTenant = me.me.user.role === "SUPER_ADMIN" && !me.me.actingTenant;
  const res = await serverGet<SessionListResponse>("/sessions?pageSize=100");
  if (res.kind === "error" && res.status === 401) redirect(EXPIRED_LOGIN_PATH);

  return (
    <>
      <Breadcrumb items={[{ label: t("nav.sessions") }]} />
      {res.kind === "error" && (res.status === 403 || !perms.includes("sessions.view")) ? (
        <>
          <h1 className="text-2xl font-semibold text-fg">{t("s.title")}</h1>
          <div className="mt-6 max-w-xl">
            <Alert tone="warning">{t("s.forbidden")}</Alert>
          </div>
        </>
      ) : res.kind === "error" ? (
        <>
          <h1 className="text-2xl font-semibold text-fg">{t("s.title")}</h1>
          <div className="mt-6 max-w-xl">
            <LoadError />
          </div>
        </>
      ) : (
        <SessionsView
          initial={res.data.items}
          fetchedAt={res.at}
          canCreate={!pickTenant && perms.includes("sessions.create")}
          canCancel={!pickTenant && perms.includes("sessions.delete")}
          showTechnician={me.me.user.role !== "USER"}
          meId={me.me.user.id}
          canTerminate={!pickTenant && perms.includes("sessions.terminate")}
          pickTenant={pickTenant}
          canPickCustomer={perms.includes("customers.view")}
          canSendLink={perms.includes("sessions.create") && perms.includes("sessions.send_link")}
        />
      )}
    </>
  );
}
