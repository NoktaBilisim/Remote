import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { t } from "@/lib/i18n";
import { getMe, serverGet } from "@/lib/server-api";
import type { RegistrationCodeListResponse, UnattendedStatus } from "@/lib/unattended/contract";
import { createCodeBlock, isRiskAccepted } from "@/lib/unattended/errors";
import { CodesTab } from "../../codes-tab";
import { accessOf, gateBody, UnattendedShell } from "../../unattended-shell";

export const metadata: Metadata = { title: t("un.tab.codes") };

/** /unattended/codes — bekleyen kayıt kodları (`manage`; AC-273, 336). Kod listede yoktur, yalnız üretimde bir kez. */
export default async function CodesPage() {
  const me = await getMe();
  if (me.kind !== "ok") redirect(EXPIRED_LOGIN_PATH);
  const access = accessOf({ ...me.me, permissions: me.me.permissions as readonly string[] });
  const gate = gateBody(access);
  if (gate || !access.manage)
    return (
      <UnattendedShell access={access} status={undefined} createBlock={null}>
        {gate ?? (
          <div className="mt-6 max-w-xl">
            <Alert tone="warning" testId="un-forbidden">
              {t("un.codes.forbidden")}
            </Alert>
          </div>
        )}
      </UnattendedShell>
    );
  const [st, res] = await Promise.all([
    serverGet<UnattendedStatus>("/unattended/status"),
    serverGet<RegistrationCodeListResponse>("/unattended/registration-codes"),
  ]);
  if ((st.kind === "error" && st.status === 401) || (res.kind === "error" && res.status === 401)) redirect(EXPIRED_LOGIN_PATH);
  const status = st.kind === "ok" ? st.data : null;
  const createBlock = createCodeBlock(status);
  return (
    <UnattendedShell access={access} status={status} createBlock={createBlock}>
      <section aria-label={t("un.tab.codes")}>
        {res.kind === "error" ? (
          <div className="max-w-xl">
            <LoadError />
          </div>
        ) : (
          <CodesTab items={res.data.items} createBlock={createBlock} riskAccepted={isRiskAccepted(status)} />
        )}
      </section>
    </UnattendedShell>
  );
}
