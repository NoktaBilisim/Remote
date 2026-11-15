"use client";

import { useState } from "react";
import { MailTestDialog } from "@/components/account/mail-test-dialog";
import { FormError } from "@/components/form-error";
import { LeaveDialog } from "@/components/leave-dialog";
import { DirtyBar } from "@/components/settings/dirty-bar";
import { usePhoneTest } from "@/components/settings/phone-test";
import { t } from "@/lib/i18n";
import type { SupportRequestSettings, WhatsappTestResponse } from "@/lib/requests/contract";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import { NotifySection } from "./notify-section";
import {
  AcceptCodeSection,
  ChannelsSection,
  CidrSection,
  DownloadSection,
  PrioritySection,
  RotateDialog,
  WaitSection,
  WebFormSection,
} from "./sections";
import { useCopyUrl, useRotateRef, useSettingsForm } from "./use-settings-form";

const waResult = (r: WhatsappTestResponse) => ({ ok: r.ok, message: r.message || (r.ok ? t("srs.wa.testOk") : t("srs.wa.testFail")) });

/**
 * Ayarlar > Destek talepleri (AC-129, 131, 142, 150–152). Kaydedilmemiş değişiklikte sayfadan ayrılma uyarısı;
 * submit sırasında alanlar kilitli; sunucu 400 `fields` aynı yollarla alanlara yansır.
 */
export function SettingsForm({ initial }: { initial: SupportRequestSettings }) {
  const f = useSettingsForm(initial);
  const rot = useRotateRef(f.setSaved, f.unauth);
  const waTest = usePhoneTest("/settings/support-requests/whatsapp/test", waResult, f.unauth);
  const [mailTestOpen, setMailTestOpen] = useState(false);
  // TEST-P8b-1: menü bağlantısı, geri tuşu ve yenileme/kapama — oturum geçmişi notuyla aynı koruma.
  const guard = useLeaveGuard(f.dirty && !f.saving);
  const copy = useCopyUrl(f.saved.downloadUrl);

  return (
    <div className="mt-6 flex max-w-3xl flex-col gap-6">
      <DownloadSection saved={f.saved} onCopy={copy} onRotate={() => rot.setOpen(true)} />
      <form onSubmit={f.save} noValidate className="flex flex-col gap-6" data-testid="settings-form">
        {f.formError && <FormError error={f.formError} />}
        <fieldset disabled={f.saving} className="flex flex-col gap-6">
          <WaitSection ctx={f} />
          <PrioritySection ctx={f} />
          <AcceptCodeSection ctx={f} />
          <NotifySection ctx={f} waTest={waTest} onMailTest={() => setMailTestOpen(true)} />
          <WebFormSection ctx={f} onCopy={copy} />
          <ChannelsSection ctx={f} />
          <CidrSection ctx={f} />
        </fieldset>
        {/* TEST-P8b-3: çubuk yalnız kaydedilmemiş değişiklikte (veya kayıt sürerken); mobilde tek satır, geri al ikon. */}
        {(f.dirty || f.saving) && (
          <DirtyBar saving={f.saving} onRevert={f.revert} revertClassName="shrink-0 px-3 sm:px-4" submitClassName="shrink-0" />
        )}
      </form>
      <RotateDialog rot={rot} />
      <LeaveDialog guard={guard} body={t("srs.leaveBody")} />
      <MailTestDialog
        open={mailTestOpen}
        onClose={() => setMailTestOpen(false)}
        path="/settings/support-requests/email/test"
        title={t("srs.mail.test")}
        body={t("srs.mail.testBody")}
        testId="mail-test-dialog"
      />
    </div>
  );
}
