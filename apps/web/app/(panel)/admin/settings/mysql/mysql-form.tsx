"use client";

import { SaveBar } from "@/components/ui/save-bar";
import type { MysqlSettingsView } from "@/lib/admin-settings/contract";
import { t } from "@/lib/i18n";
import { useFocusFirstError } from "@/lib/use-focus-error";
import { useHydrated } from "@/lib/use-hydrated";
import { AuthSection, MysqlAlerts, ServerSection, TestSection, TlsSection } from "./mysql-parts";
import { useMysqlForm } from "./use-mysql-form";

const FORM_ID = "mysql-form";

/**
 * MySQL Ayarları (AC-77, 78; ortak standart §1.2; ADR-0003). Şifre forma geri yazılmaz: kayıtlıysa yer tutucu "Kayıtlı —
 * değiştirmek için yazın", boş bırakılırsa korunur. "Bağlantıyı Test Et" formdaki değerlerle (kaydetmeden) çalışır,
 * sonuç (başarı + ms / hata, süresiz) ekranda kalır; 10 sn sınırı sunucuda. Kayıt çalışan bağlantıyı değiştirmez → kalıcı uyarı.
 */
export function MysqlForm({ initial }: { initial: MysqlSettingsView }) {
  const ready = useHydrated(); // data-ready: e2e hidrasyondan önce yazmasın (QA P12 Tur 2)
  const { formRef, focusError } = useFocusFirstError();
  const f = useMysqlForm(initial, focusError);
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <MysqlAlerts f={f} />
      <form
        id={FORM_ID}
        ref={formRef}
        onSubmit={f.submit}
        noValidate
        className="flex flex-col gap-6"
        data-testid="mysql-form"
        data-ready={ready ? "true" : "false"}
      >
        <fieldset disabled={f.busy} className="flex flex-col gap-6">
          <ServerSection f={f} />
          <AuthSection f={f} />
          <TlsSection f={f} />
        </fieldset>
      </form>
      <TestSection f={f} />
      <SaveBar dirty={f.dirty} busy={f.busy} formId={FORM_ID} onReset={f.reset} message={t("my.unsaved")} leaveBody={t("my.leaveBody")} />
    </div>
  );
}
