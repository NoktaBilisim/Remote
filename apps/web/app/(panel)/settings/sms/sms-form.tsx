"use client";

import { Send } from "lucide-react";
import type { SmsSettingsView, SmsTestResponse } from "@remote/contracts/api/notify";
import { FormError } from "@/components/form-error";
import { LeaveDialog } from "@/components/leave-dialog";
import { DirtyBar } from "@/components/settings/dirty-bar";
import { PhoneTestRow, usePhoneTest } from "@/components/settings/phone-test";
import { SettingsSection } from "@/components/settings/section";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import { KeyRemoveDialog, SmsBanners, SmsConnSection, SmsKeySection } from "./sms-sections";
import { useSmsForm } from "./use-sms-form";

const smsResult = (r: SmsTestResponse) => ({ ok: r.ok, message: r.message });

/**
 * SMS ayarları (ortak standart §2.3): adres (boş = sistem varsayılanı), API anahtarı (maskeli; kayıtlı değer forma
 * gelmez, boş bırakılırsa korunur; "Anahtarı sil" onaylı), başlık, Kaydet; "Test SMS Gönder" sonucu ekranda.
 * Bantlar: anahtar okunamıyor (`keyUnreadable`), güvensiz adres, kullanılamıyor.
 */
export function SmsForm({ initial, canEdit }: { initial: SmsSettingsView; canEdit: boolean }) {
  const f = useSmsForm(initial);
  const test = usePhoneTest("/settings/sms/test", smsResult, f.unauth);
  const guard = useLeaveGuard(f.dirty && !f.saving);
  return (
    <div className="mt-6 flex max-w-3xl flex-col gap-6">
      <SmsBanners saved={f.saved} canEdit={canEdit} />
      <form onSubmit={f.save} noValidate className="flex flex-col gap-6" data-testid="sms-form">
        {f.formError && <FormError error={f.formError} />}
        <fieldset disabled={f.saving || !canEdit} className="flex flex-col gap-6">
          <SmsConnSection f={f} />
          <SmsKeySection f={f} />
        </fieldset>
        {f.saved.updatedAt && <p className="text-xs text-fg-muted">{t("sms.updatedAt", { at: formatDateTime(f.saved.updatedAt) })}</p>}
        {(f.dirty || f.saving) && canEdit && <DirtyBar saving={f.saving} onRevert={f.revert} submitTestId="sms-save" />}
      </form>

      <SettingsSection id="sms-test" title={t("sms.test")} Icon={Send}>
        <PhoneTestRow
          test={test}
          field={{
            label: t("sms.testPhone"),
            type: "tel",
            inputMode: "tel",
            hint: f.dirty ? t("sms.testDirty") : t("sms.testHint"),
            disabled: !canEdit,
          }}
          fieldTestId="sms-test-phone"
          button={{ disabled: !canEdit, testId: "sms-test-send" }}
          buttonLabel={t("sms.test")}
          resultTestId="sms-test-result"
        />
      </SettingsSection>

      <KeyRemoveDialog f={f} />
      <LeaveDialog guard={guard} body={t("srs.leaveBody")} />
    </div>
  );
}
