import type { SuperadminListResponse } from "@remote/contracts/api/users";
import { ShieldUser, SquareTerminal } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoadError } from "@/components/load-error";
import { EmptyState } from "@/components/ui/empty-state";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { t } from "@/lib/i18n";
import { serverGet } from "@/lib/server-api";
import { Section } from "../section";
import { SuperadminList } from "./superadmin-list";

export const metadata: Metadata = { title: `${t("sys.tab.superadmins")} · ${t("sys.title")}` };

/**
 * /admin/settings/superadmins — Super Admin hesapları (P15, AC-232). Başka bir Super Admin'in şifresi panelden sıfırlanır
 * (step-up; geçici şifre bir kez). Kendi satırında düğme yok (uç da 403). Tek Super Admin varsa yol CLI'dır (AC-299).
 */
export default async function SuperadminsPage() {
  const res = await serverGet<SuperadminListResponse>("/admin/superadmins");
  if (res.kind === "error") {
    if (res.status === 401) redirect(EXPIRED_LOGIN_PATH);
    return (
      <div className="max-w-xl">
        <LoadError />
      </div>
    );
  }
  const others = res.data.items.filter((x) => !x.self);
  return (
    <div className="max-w-3xl">
      <Section id="sa" title={t("sa.title")} Icon={ShieldUser}>
        <p className="text-sm text-fg-muted">{t("sa.subtitle")}</p>
        {others.length === 0 ? (
          <EmptyState Icon={SquareTerminal} title={t("sa.emptyTitle")} body={t("sa.emptyBody")} testId="superadmins-empty" />
        ) : null}
        <SuperadminList items={res.data.items} />
      </Section>
    </div>
  );
}
