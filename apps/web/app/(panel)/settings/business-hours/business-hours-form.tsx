"use client";

import { CalendarClock } from "lucide-react";
import { FormError } from "@/components/form-error";
import { SettingsSection } from "@/components/settings/section";
import { Alert } from "@/components/ui/alert";
import { SaveBar } from "@/components/ui/save-bar";
import { Switch } from "@/components/ui/switch";
import { t } from "@/lib/i18n";
import type { BusinessHoursView } from "@/lib/requests/business-hours";
import { ModeField, Preview, TimeZoneField, WeekField } from "./hours-parts";
import { useHoursForm } from "./use-business-hours";

const FORM_ID = "business-hours-form";

/**
 * Ayarlar > Mesai saatleri (AC-258): aç/kapa, saat dilimi (combobox, vars. Europe/Istanbul), mesai dışı modu (radyo),
 * gün gün en çok 2 aralık ("24:00" gün sonu). Kirliyken kaydet çubuğu + ayrılma uyarısı; `canEdit` yoksa salt okunur.
 */
export function BusinessHoursForm({ initial, canEdit }: { initial: BusinessHoursView; canEdit: boolean }) {
  const f = useHoursForm(initial, canEdit);
  const saveBar = (
    <SaveBar dirty={f.dirty} busy={f.busy} formId={FORM_ID} onReset={f.reset} message={t("bh.unsaved")} leaveBody={t("bh.leaveBody")} />
  );
  return (
    <SettingsSection id="bh" title={t("bh.week.title")} Icon={CalendarClock} testId="bh-section" after={saveBar}>
      <Preview saved={f.saved} dirty={f.dirty} />
      {!canEdit && (
        <Alert tone="info" testId="bh-readonly">
          {t("bh.readonly")}
        </Alert>
      )}
      <form id={FORM_ID} onSubmit={f.save} noValidate className="flex flex-col gap-5" data-testid="bh-form">
        {f.formError && <FormError error={f.formError} />}
        <fieldset disabled={f.busy || !canEdit} className="flex flex-col gap-5">
          <Switch
            label={t("bh.enabled")}
            checked={f.st.enabled}
            onChange={(v) => f.set({ enabled: v })}
            description={t("bh.enabledDesc")}
            onText={t("rq.on")}
            offText={t("rq.off")}
            testId="bh-enabled"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TimeZoneField f={f} canEdit={canEdit} />
            <ModeField f={f} />
          </div>
          <WeekField f={f} />
        </fieldset>
      </form>
    </SettingsSection>
  );
}
