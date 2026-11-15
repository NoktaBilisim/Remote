"use client";

import { serviceUrlSchema } from "@remote/contracts/api/notify";
import { MessageCircle } from "lucide-react";
import type { RefObject } from "react";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { TextField } from "@/components/ui/text-field";
import { WA_INSECURE_WARNING, WA_SERVICE_URL_MAX, type WhatsappServiceView } from "@/lib/admin-settings/whatsapp";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { EnvResetDialog } from "../env-reset";
import { Section, SourceBadge } from "../section";
import { WhatsappApiKeyField, WhatsappApiKeyRemoveDialog } from "./whatsapp-api-key-field";
import type { WhatsappFormState } from "./use-whatsapp-form";

type P = { f: WhatsappFormState };
type InputRef = RefObject<HTMLInputElement | null>;

/** Boş / ortam kaynağı bilgisi, yeniden kayıt ve güvensiz kanal uyarıları, form üstü hata. */
export function WhatsappAlerts({ f }: P) {
  const { saved } = f;
  return (
    <>
      {!f.configured ? (
        <Alert tone="info" testId="wa-svc-empty">
          {t("wa.svc.empty")}
        </Alert>
      ) : (
        <>
          {saved.source === "env" && (
            <Alert tone="info" testId="wa-svc-env-source">
              {t("wa.svc.envSource")}
            </Alert>
          )}
        </>
      )}
      {/* P19 (S-P19-T5, §8c.4): kayıtlı panel adresi yeni URL kuralına uymuyor → kanal kullanılamaz; yeniden kaydedilmeli */}
      {saved.source === "panel" && saved.url !== null && !serviceUrlSchema.safeParse(saved.url).success && (
        <Alert tone="warning" testId="wa-svc-resave">
          {t("wa.svc.resave")}
        </Alert>
      )}
      {saved.insecure && (
        <Alert tone="warning" testId="wa-svc-insecure">
          {t("wa.svc.insecure", { warning: WA_INSECURE_WARNING })}
        </Alert>
      )}
      {f.formError && <FormError error={f.formError} />}
    </>
  );
}

/** Etkin adres (env dahil) ve son güncelleme özeti. */
function ServiceSummary({ saved }: { saved: WhatsappServiceView }) {
  return (
    <dl
      className="grid gap-x-4 gap-y-2 rounded-md border border-border bg-canvas px-3 py-2.5 text-sm sm:grid-cols-[9rem_1fr]"
      data-testid="wa-svc-summary"
    >
      <dt className="text-fg-muted">{t("wa.svc.effective")}</dt>
      <dd className="min-w-0 font-mono break-all text-fg" data-testid="wa-svc-effective">
        {saved.url ?? t("wa.svc.none")}
      </dd>
      <dt className="text-fg-muted">{t("wa.svc.updated")}</dt>
      <dd className="text-fg tabular-nums" data-testid="wa-svc-updated">
        {saved.updatedAt ? formatDateTime(saved.updatedAt) : t("wa.svc.never")}
      </dd>
    </dl>
  );
}

/** Servis bölümü: tanıtım, etkin adres / güncelleme özeti, panel adresi alanı. */
function ServiceSection({ f, urlRef }: P & { urlRef: InputRef }) {
  const { saved } = f;
  return (
    <Section
      id="wa-svc"
      title={t("wa.svc.title")}
      Icon={MessageCircle}
      aside={<SourceBadge source={saved.source} panel={t("wa.svc.panelBadge")} env={t("wa.svc.envBadge")} />}
    >
      <p className="text-sm text-fg-muted">{t("wa.svc.intro")}</p>
      <ServiceSummary saved={saved} />
      <TextField
        ref={urlRef}
        label={t("wa.svc.url")}
        value={f.url}
        onChange={(e) => f.changeUrl(e.target.value)}
        error={f.urlError}
        hint={saved.source === "env" ? `${t("wa.svc.urlHint")} ${t("wa.svc.urlHintEnv")}` : t("wa.svc.urlHint")}
        placeholder="https://wa.ornek.com"
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="none"
        maxLength={WA_SERVICE_URL_MAX + 20}
        data-testid="wa-svc-url"
      />
    </Section>
  );
}

/** Form alanları: servis adresi bölümü + servis anahtarı bölümü. */
export function WhatsappFields({ f, urlRef, keyRef }: P & { urlRef: InputRef; keyRef: InputRef }) {
  return (
    <>
      <ServiceSection f={f} urlRef={urlRef} />
      <WhatsappApiKeyField
        saved={f.saved}
        value={f.apiKey}
        onChange={f.changeKey}
        error={f.keyError}
        inputRef={keyRef}
        busy={f.busy}
        onRemoveClick={() => f.setConfirmKeyRemove(true)}
      />
    </>
  );
}

/** Anahtar kaldırma ve "Ortam değişkenine dön" onay diyalogları. */
export function WhatsappDialogs({ f }: P) {
  return (
    <>
      <WhatsappApiKeyRemoveDialog
        open={f.confirmKeyRemove}
        saved={f.saved}
        busy={f.busy}
        setBusy={f.setBusy}
        onClose={() => f.setConfirmKeyRemove(false)}
        onRemoved={f.onKeyRemoved}
        onFail={f.onKeyRemoveFail}
      />
      <EnvResetDialog
        open={f.confirmReset}
        busy={f.busy}
        onCancel={() => f.setConfirmReset(false)}
        onConfirm={() => void f.doReset()}
        texts={{ title: t("wa.svc.resetTitle"), body: t("wa.svc.resetBody"), action: t("wa.svc.reset") }}
        testId="wa-svc-reset"
      />
    </>
  );
}
