"use client";

import { useId, useRef } from "react";
import { SaveBar } from "@/components/ui/save-bar";
import type { ConsentTextSettings } from "@/lib/admin-settings/contract";
import { t } from "@/lib/i18n";
import { useHydrated } from "@/lib/use-hydrated";
import { BodyField, ConfirmDialog, ConsentAlerts, CurrentSection, VersionHistory } from "./consent-parts";
import { useConsentForm } from "./use-consent-form";

const FORM_ID = "consent-form";

/**
 * Aydınlatma metni (P11; AC-29, 127): textarea (50–20.000 karakter sayacı), "Yeni sürüm olarak kaydet" → onay diyaloğu
 * ("Yeni oturumlar bu metni gösterecek; eski onaylar eski sürüme bağlı kalır") → PUT. Metin düz metindir (React metin
 * düğümü; HTML yorumlanmaz). `settings.edit` yoksa salt okunur. Değişmeyen gövde sürüm üretmez (`changed:false`).
 */
export function ConsentForm({ initial, canEdit }: { initial: ConsentTextSettings; canEdit: boolean }) {
  const ready = useHydrated(); // data-ready: e2e hidrasyondan önce yazmasın (QA P12 Tur 2)
  const id = useId();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const f = useConsentForm(initial, canEdit, areaRef);
  return (
    <div className="mt-6 flex max-w-3xl flex-col gap-6">
      <ConsentAlerts f={f} canEdit={canEdit} />

      <CurrentSection id={id} cur={f.data.current}>
        <form
          id={FORM_ID}
          onSubmit={f.submit}
          noValidate
          className="mt-4 flex flex-col gap-1.5"
          data-testid="consent-form"
          data-ready={ready ? "true" : "false"}
        >
          <BodyField f={f} id={id} canEdit={canEdit} areaRef={areaRef} />
        </form>
      </CurrentSection>

      <VersionHistory f={f} id={id} />

      {canEdit && (
        <SaveBar
          dirty={f.dirty && !f.confirm}
          busy={f.busy}
          formId={FORM_ID}
          onReset={f.reset}
          message={t("ct.unsaved")}
          leaveBody={t("ct.leaveBody")}
          saveLabel={t("ct.save")}
        />
      )}

      <ConfirmDialog f={f} />
    </div>
  );
}
