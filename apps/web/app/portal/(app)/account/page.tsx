import { KeyRound, Palette, ShieldCheck, UserRound } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemePicker } from "@/components/branding/theme-provider";
import { LoadError } from "@/components/load-error";
import { t } from "@/lib/i18n";
import { getPortalMe } from "@/lib/portal/server";
import { Facts, PortalBreadcrumb } from "../detail-parts";
import { MfaSection, PasswordSection } from "./account-sections";

export const metadata: Metadata = { title: t("portal.acc.title") };

function Section({ id, Icon, title, children }: { id: string; Icon: typeof KeyRound; title: string; children: ReactNode }) {
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

/** /portal/account (AC-262): ad/e-posta salt okunur, şifre değiştir, isteğe bağlı 2FA, tema (Açık/Koyu/Sistem). */
export default async function PortalAccountPage() {
  const s = await getPortalMe();
  if (s.kind !== "ok") return <LoadError />;
  const { user, customer } = s.me;
  return (
    <>
      <PortalBreadcrumb items={[{ label: t("portal.acc.title") }]} />
      <h1 className="text-2xl font-semibold text-fg">{t("portal.acc.title")}</h1>
      <div className="mt-6 flex max-w-xl flex-col gap-6">
        <Section id="portal-acc-profile" Icon={UserRound} title={t("portal.acc.profile")}>
          <Facts
            testId="portal-acc-facts"
            rows={[
              { label: t("portal.acc.name"), value: user.fullName },
              { label: t("portal.acc.email"), value: user.email },
              { label: t("portal.acc.customer"), value: customer.name },
            ]}
          />
          <p className="text-sm text-fg-muted">{t("portal.acc.readonly")}</p>
        </Section>
        <Section id="portal-acc-pw" Icon={KeyRound} title={t("portal.acc.pw")}>
          <PasswordSection />
        </Section>
        <Section id="portal-acc-mfa" Icon={ShieldCheck} title={t("portal.acc.mfa")}>
          <MfaSection enabled={user.totpEnabled} />
        </Section>
        <Section id="portal-acc-theme" Icon={Palette} title={t("portal.acc.theme")}>
          <ThemePicker testId="portal-theme" />
        </Section>
      </div>
    </>
  );
}
