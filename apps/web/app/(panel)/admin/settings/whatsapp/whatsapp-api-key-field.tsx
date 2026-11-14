"use client";

import { KeyRound, Trash2 } from "lucide-react";
import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/text-field";
import { normalizeWaView, type WhatsappServiceView } from "@/lib/admin-settings/whatsapp";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { Section, SourceBadge } from "../section";

const PATH = "/admin/settings/whatsapp";

/** Servis anahtarı bölümü (S-P13b-3): maskeli alan, kaynak rozeti, panel anahtarı için "Anahtarı kaldır". Değer üst formda tutulur (PUT ile birlikte gider). */
export function WhatsappApiKeyField({
  saved,
  value,
  onChange,
  error,
  inputRef,
  busy,
  onRemoveClick,
}: {
  saved: WhatsappServiceView;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  inputRef: RefObject<HTMLInputElement | null>;
  busy: boolean;
  onRemoveClick: () => void;
}) {
  return (
    <Section
      id="wa-key"
      title={t("wa.svc.keyTitle")}
      Icon={KeyRound}
      aside={<SourceBadge testId="wa-key-source" source={saved.apiKeySource} panel={t("wa.svc.keyPanelBadge")} env={t("wa.svc.keyEnvBadge")} none={t("wa.svc.keyNoneBadge")} />}
    >
      <p className="text-sm text-fg-muted">{t("wa.svc.keyIntro")}</p>
      <TextField
        ref={inputRef}
        label={t("wa.svc.keyLabel")}
        type="password"
        revealable
        value={value}
        onChange={(e) => onChange(e.target.value)}
        error={error}
        hint={saved.apiKeySource === "panel" ? t("wa.svc.keyHintSet") : saved.apiKeySource === "env" ? t("wa.svc.keyHintEnv") : saved.source === "panel" ? t("wa.svc.keyHintPanelNone") : t("wa.svc.keyHintNone")}
        autoComplete="new-password"
        spellCheck={false}
        autoCapitalize="none"
        maxLength={300}
        data-testid="wa-key-input"
      />
      {saved.apiKeySource === "panel" && saved.source === "panel" && (
        <div>
          <Button type="button" variant="danger-ghost" disabled={busy} onClick={onRemoveClick} data-testid="wa-key-remove">
            <Trash2 aria-hidden className="size-4" />
            {t("wa.svc.keyRemove")}
          </Button>
        </div>
      )}
    </Section>
  );
}

/** Panel anahtarını siler (PUT `apiKey: null`); adres kayıtlı değerle gider, formdaki kaydedilmemiş adres kullanılmaz. */
export function WhatsappApiKeyRemoveDialog({
  open,
  saved,
  busy,
  setBusy,
  onClose,
  onRemoved,
  onFail,
}: {
  open: boolean;
  saved: WhatsappServiceView;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onClose: () => void;
  onRemoved: (v: WhatsappServiceView) => void;
  onFail: (err: unknown) => void;
}) {
  const remove = async () => {
    if (!saved.url || saved.source !== "panel") return;
    setBusy(true);
    try {
      onRemoved(normalizeWaView(await api<WhatsappServiceView>("PUT", PATH, { url: saved.url, apiKey: null })));
    } catch (err) {
      onFail(err);
    } finally {
      setBusy(false);
    }
  };
  return (
<Dialog
  open={open}
  onClose={() => {
    if (!busy) onClose();
  }}
  role="alertdialog"
  size="sm"
  testId="wa-key-remove-dialog"
  title={t("wa.svc.keyRemoveTitle")}
  description={t("wa.svc.keyRemoveBody")}
  footer={
    <>
      <Button variant="secondary" data-autofocus disabled={busy} className="sm:ml-auto" onClick={() => onClose()}>
        {t("rq.rj.cancel")}
      </Button>
      <Button variant="danger" loading={busy} onClick={() => void remove()} data-testid="wa-key-remove-confirm">
        {!busy && <Trash2 aria-hidden className="size-4" />}
        {t("wa.svc.keyRemove")}
      </Button>
    </>
  }
/>
  );
}
