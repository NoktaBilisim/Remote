"use client";

import { useRef } from "react";
import { MailTestDialog } from "@/components/account/mail-test-dialog";
import { FormError } from "@/components/form-error";
import { SaveBar } from "@/components/ui/save-bar";
import type { SmtpSettingsView } from "@/lib/account/contract";
import { t } from "@/lib/i18n";
import { SmtpAuthSection, SmtpBanners, SmtpClearDialog, SmtpFromSection, SmtpServerSection, SmtpTestSection } from "./smtp-sections";
import { useSmtpForm } from "./use-smtp-form";

const FORM_ID = "smtp-form";

/**
 * SMTP Ayarları (AC-79, 80, 122; ortak standart §2.1). Port yalnız izinli değerlerden seçilir (25/465/587/2525, B-P10-1);
 * güvenlik seçimi portu önerir (25/465/587). "Yok" seçiliyken kullanıcı adı/şifre pasif (B-P10-5). Şifre forma geri
 * yazılmaz: kayıtlıysa "kayıtlı — değiştirmek için yazın", boş bırakılırsa korunur. Kayıt PUT /settings/tenant `{ smtp }`;
 * 400 `HOST_NOT_ALLOWED` sunucu alanına genel mesajla düşer. Tüm alanlar boşaltılıp kaydedilirse onayla `smtp: null`.
 * "Test Maili Gönder" kayıtlı ayarla çalışır (kirliyken pasif), alıcıyı diyalogda sorar, sonucu diyalogda gösterir.
 */
export function SmtpForm({ initial, canEdit }: { initial: SmtpSettingsView | null; canEdit: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const f = useSmtpForm(initial, canEdit, formRef);
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <SmtpBanners canEdit={canEdit} configured={Boolean(f.saved)} />
      {f.formError && <FormError error={f.formError} />}
      <form id={FORM_ID} ref={formRef} onSubmit={f.submit} noValidate className="flex flex-col gap-6" data-testid="smtp-form">
        <fieldset disabled={!canEdit || f.busy} className="flex flex-col gap-6">
          <SmtpServerSection f={f} canEdit={canEdit} />
          <SmtpAuthSection f={f} />
          <SmtpFromSection f={f} />
        </fieldset>
      </form>
      <SmtpTestSection f={f} canEdit={canEdit} />
      {canEdit && (
        <SaveBar
          dirty={f.dirty && !f.confirmClear}
          busy={f.busy}
          formId={FORM_ID}
          onReset={f.reset}
          message={t("smtp.unsaved")}
          leaveBody={t("smtp.leaveBody")}
        />
      )}
      <SmtpClearDialog f={f} />
      <MailTestDialog
        open={f.testOpen}
        onClose={() => f.setTestOpen(false)}
        path="/settings/smtp/test"
        title={t("smtp.test")}
        body={t("smtp.testDialogBody")}
        testId="smtp-test-dialog"
      />
    </div>
  );
}
