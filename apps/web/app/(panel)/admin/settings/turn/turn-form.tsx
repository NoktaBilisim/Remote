"use client";

import { useRef } from "react";
import { SaveBar } from "@/components/ui/save-bar";
import type { TurnSettingsView } from "@/lib/admin-settings/contract";
import { t } from "@/lib/i18n";
import { useFocusFirstError } from "@/lib/use-focus-error";
import { useHydrated } from "@/lib/use-hydrated";
import { EnvResetButton } from "../env-reset";
import { ResetDialog, SecretSection, TurnAlerts, UrlsSection } from "./turn-parts";
import { useTurnForm } from "./use-turn-form";

const FORM_ID = "turn-form";

/**
 * TURN ayarı (AC-78, G-13): adres listesi (satır ekle/kaldır, en çok 10) + paylaşılan gizli anahtar. Secret forma geri
 * yazılmaz; boş = kayıtlı korunur. "Ortam değerlerine dön" (DELETE) yalnız panel kaydı varken, onay diyaloğuyla
 * (odak Vazgeç'te).
 */
export function TurnForm({ initial }: { initial: TurnSettingsView }) {
  const ready = useHydrated(); // data-ready: e2e hidrasyondan önce yazmasın (QA P12 Tur 2)
  const { formRef, focusError } = useFocusFirstError();
  const addRef = useRef<HTMLButtonElement>(null);
  const f = useTurnForm(initial, focusError, formRef, addRef);
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <TurnAlerts f={f} />
      <form
        id={FORM_ID}
        ref={formRef}
        onSubmit={f.submit}
        noValidate
        className="flex flex-col gap-6"
        data-testid="turn-form"
        data-ready={ready ? "true" : "false"}
      >
        <fieldset disabled={f.busy} className="flex flex-col gap-6">
          <UrlsSection f={f} addRef={addRef} />
          <SecretSection f={f} />
        </fieldset>
      </form>

      {f.saved.source === "panel" && (
        <EnvResetButton label={t("tu.reset")} busy={f.busy} onClick={() => f.setConfirmReset(true)} testId="turn-reset" />
      )}

      <SaveBar
        dirty={f.dirty && !f.confirmReset}
        busy={f.busy}
        formId={FORM_ID}
        onReset={f.reset}
        message={t("tu.unsaved")}
        leaveBody={t("tu.leaveBody")}
      />

      <ResetDialog f={f} />
    </div>
  );
}
