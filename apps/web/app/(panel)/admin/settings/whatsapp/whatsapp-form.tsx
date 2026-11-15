"use client";

import { SaveBar } from "@/components/ui/save-bar";
import { normalizeWaView, type WhatsappServiceView } from "@/lib/admin-settings/whatsapp";
import { t } from "@/lib/i18n";
import { useFocusOn } from "@/lib/use-focus-error";
import { useHydrated } from "@/lib/use-hydrated";
import { EnvResetButton } from "../env-reset";
import { WhatsappTestSection } from "./whatsapp-test-section";
import { WhatsappAlerts, WhatsappDialogs, WhatsappFields } from "./whatsapp-parts";
import { useWhatsappForm } from "./use-whatsapp-form";

const FORM_ID = "wa-service-form";

/**
 * WhatsApp servisi (AC-196, ortak standart §2.2). Durumlar: boş (env de yok → `url: null`, bilgi kutusu + test pasif),
 * kısmi (env kaynağı bilgi notu; `insecure` uyarısı — kanal canlıda kapalı), başarı (panel kaydı). Alan yalnız panel
 * kaydını gösterir; etkin adres (env dahil) üstteki özette. "Ortam değişkenine dön" (DELETE) yalnız panel kaydı varken,
 * `alertdialog` (odak Vazgeç). Test kayıtlı etkin adresle yapılır (formdaki kaydedilmemiş değer değil); sonuç ekranda kalır.
 */
export function WhatsappForm({ initial: raw }: { initial: WhatsappServiceView }) {
  const ready = useHydrated(); // data-ready: e2e hidrasyondan önce yazmasın (QA P12 Tur 2)
  const { ref: urlRef, focus: focusUrl } = useFocusOn<HTMLInputElement>();
  const { ref: keyRef, focus: focusKey } = useFocusOn<HTMLInputElement>();
  const f = useWhatsappForm(normalizeWaView(raw), { focusUrl, focusKey });
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <WhatsappAlerts f={f} />
      <form
        id={FORM_ID}
        onSubmit={f.submit}
        noValidate
        className="flex flex-col gap-6"
        data-testid="wa-svc-form"
        data-ready={ready ? "true" : "false"}
      >
        <fieldset disabled={f.busy} className="flex flex-col gap-6">
          <WhatsappFields f={f} urlRef={urlRef} keyRef={keyRef} />
        </fieldset>
      </form>
      {f.saved.source === "panel" && (
        <EnvResetButton label={t("wa.svc.reset")} busy={f.busy} onClick={() => f.setConfirmReset(true)} testId="wa-svc-reset" />
      )}
      <WhatsappTestSection configured={f.configured} canTest={f.canTest} dirty={f.dirty} ready={ready} />
      <SaveBar
        dirty={f.dirty && !f.confirmReset && !f.confirmKeyRemove}
        busy={f.busy}
        formId={FORM_ID}
        onReset={f.reset}
        message={t("wa.svc.unsaved")}
        leaveBody={t("wa.svc.leaveBody")}
      />
      <WhatsappDialogs f={f} />
    </div>
  );
}
