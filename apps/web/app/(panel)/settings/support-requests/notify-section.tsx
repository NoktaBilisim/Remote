"use client";

import { Mail, MessageSquare, Send } from "lucide-react";
import Link from "next/link";
import { PhoneTestRow, type usePhoneTest } from "@/components/settings/phone-test";
import { SettingsSection } from "@/components/settings/section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { t } from "@/lib/i18n";
import { errText, SettingsList } from "./list-editor";
import { onOff } from "./sections";
import type { SettingsCtx } from "./use-settings-form";

/** E-posta kanalı (P10, AC-151): SMTP yoksa açılamaz (bağlantı SMTP ayarlarına), alıcılar, test maili. */
function MailChannel({ ctx, onMailTest }: { ctx: SettingsCtx; onMailTest: () => void }) {
  const { st, set, errors, saved } = ctx;
  const smtp = saved.email.smtpConfigured;
  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4" data-testid="mail-channel">
      <Switch
        label={t("srs.mail.label")}
        checked={st.mailEnabled}
        onChange={(v) => set({ mailEnabled: v })}
        disabled={!smtp && !st.mailEnabled}
        description={smtp ? t("srs.mail.desc") : t("srs.mail.needSmtp")}
        {...onOff()}
        testId="mail-switch"
      />
      {errText(errors["email.enabled"]) && <p className="text-xs font-medium text-danger">{errText(errors["email.enabled"])}</p>}
      {!smtp && (
        <Link
          href="/settings/smtp"
          className="inline-flex min-h-11 items-center gap-2 self-start rounded-md px-1 text-sm font-medium text-primary hover:underline"
          data-testid="mail-smtp-link"
        >
          <Mail aria-hidden className="size-4" />
          {t("srs.mail.goSmtp")}
        </Link>
      )}
      <SettingsList ctx={ctx} kind="mail" />
      <Button type="button" variant="secondary" className="self-start" disabled={!smtp} onClick={onMailTest} data-testid="mail-test-open">
        <Send aria-hidden className="size-4" />
        {t("srs.mail.test")}
      </Button>
    </div>
  );
}

/** WhatsApp servis bantları: güvensiz adres, servis yapılandırılmamış. */
function WaBanners({ whatsapp }: { whatsapp: SettingsCtx["saved"]["whatsapp"] }) {
  return (
    <>
      {whatsapp.insecure && (
        <Alert tone="warning" testId="wa-insecure">
          {t("srs.wa.insecure")}
        </Alert>
      )}
      {!whatsapp.serviceConfigured && (
        <Alert tone="warning" testId="wa-unconfigured">
          {t("srs.wa.unconfigured")}
        </Alert>
      )}
    </>
  );
}

/** Teknisyen bildirimi: WhatsApp (bantlar, anahtar, alıcılar, test) + e-posta kanalı. */
export function NotifySection({
  ctx,
  waTest,
  onMailTest,
}: {
  ctx: SettingsCtx;
  waTest: ReturnType<typeof usePhoneTest>;
  onMailTest: () => void;
}) {
  const { st, set, saved } = ctx;
  return (
    <SettingsSection id="wa" title={t("srs.notify.title")} Icon={MessageSquare}>
      <WaBanners whatsapp={saved.whatsapp} />
      <Switch
        label={t("srs.wa.label")}
        checked={st.waEnabled}
        onChange={(v) => set({ waEnabled: v })}
        description={t("srs.wa.desc")}
        {...onOff()}
        testId="wa-switch"
      />
      <SettingsList ctx={ctx} kind="wa" />
      <PhoneTestRow
        test={waTest}
        divided
        field={{ label: t("srs.wa.testPhone"), inputMode: "tel", hint: t("srs.wa.testHint") }}
        buttonLabel={t("srs.wa.test")}
        resultTestId="wa-test-result"
      />
      <MailChannel ctx={ctx} onMailTest={onMailTest} />
    </SettingsSection>
  );
}
