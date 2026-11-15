"use client";

import { KeyRound, MessageSquareText, RotateCcw, Trash2 } from "lucide-react";
import { SMS_KEY_UNREADABLE_WARNING, type SmsSettingsView } from "@remote/contracts/api/notify";
import { SettingsSection } from "@/components/settings/section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/text-field";
import { t } from "@/lib/i18n";
import type { useSmsForm } from "./use-sms-form";

type Form = ReturnType<typeof useSmsForm>;

/** Durum bantları: anahtar okunamıyor, güvensiz adres, kullanılamıyor / kullanılabilir, salt okunur. */
export function SmsBanners({ saved, canEdit }: { saved: SmsSettingsView; canEdit: boolean }) {
  const unusableReason = !saved.usable && !saved.keyUnreadable && !saved.insecure;
  return (
    <>
      {saved.keyUnreadable && (
        <Alert tone="warning" testId="sms-key-unreadable">
          {SMS_KEY_UNREADABLE_WARNING}
        </Alert>
      )}
      {saved.insecure && (
        <Alert tone="warning" testId="sms-insecure">
          {t("sms.insecure")}
        </Alert>
      )}
      {unusableReason && (
        <Alert tone="info" testId="sms-unusable">
          {t("sms.unusable")}
        </Alert>
      )}
      {saved.usable && (
        <Alert tone="success" testId="sms-usable">
          {t("sms.usable")}
        </Alert>
      )}
      {!canEdit && (
        <Alert tone="locked" testId="sms-readonly">
          {t("sms.readonly")}
        </Alert>
      )}
    </>
  );
}

export function SmsConnSection({ f: { saved, st, set, errors } }: { f: Form }) {
  return (
    <SettingsSection id="sms-conn" title={t("sms.conn")} Icon={MessageSquareText}>
      <TextField
        label={t("sms.url")}
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        placeholder={saved.defaultUrl ? t("sms.urlDefault") : "https://sms.ornek.com"}
        value={st.url}
        error={errors.url}
        hint={saved.defaultUrl ? t("sms.urlHintDefault") : t("sms.urlHintNoDefault")}
        onChange={(e) => set({ url: e.target.value })}
        data-testid="sms-url"
      />
      <TextField
        label={t("sms.header")}
        maxLength={11}
        autoComplete="off"
        value={st.header}
        error={errors.header}
        hint={t("sms.headerHint")}
        onChange={(e) => set({ header: e.target.value })}
        data-testid="sms-header"
      />
    </SettingsSection>
  );
}

/** Kayıtlı anahtarı silme: onay bekleyen silmeyi geri al ya da silme onayını aç. */
function KeyRemoveControl({ f: { st, set, setConfirmRemove } }: { f: Form }) {
  return st.removeKey ? (
    <p className="flex flex-wrap items-center gap-2 text-sm text-danger" data-testid="sms-key-remove-pending">
      {t("sms.keyWillRemove")}
      <Button type="button" variant="ghost" onClick={() => set({ removeKey: false })}>
        <RotateCcw aria-hidden className="size-4" />
        {t("srs.revert")}
      </Button>
    </p>
  ) : (
    <Button type="button" variant="danger-ghost" className="self-start" onClick={() => setConfirmRemove(true)} data-testid="sms-key-remove">
      <Trash2 aria-hidden className="size-4" />
      {t("sms.keyRemove")}
    </Button>
  );
}

export function SmsKeySection({ f }: { f: Form }) {
  const { saved, st, set, errors } = f;
  return (
    <SettingsSection id="sms-key" title={t("sms.key")} Icon={KeyRound}>
      <TextField
        label={t("sms.apiKey")}
        type="password"
        revealable
        autoComplete="new-password"
        spellCheck={false}
        value={st.apiKey}
        disabled={st.removeKey}
        placeholder={saved.apiKeySet ? t("sms.keySaved") : ""}
        error={errors.apiKey}
        hint={saved.apiKeySet ? t("sms.keyKeep") : t("sms.keyNone")}
        onChange={(e) => set({ apiKey: e.target.value })}
        data-testid="sms-api-key"
      />
      {saved.apiKeySet && <KeyRemoveControl f={f} />}
    </SettingsSection>
  );
}

export function KeyRemoveDialog({ f: { confirmRemove, setConfirmRemove, set } }: { f: Form }) {
  return (
    <Dialog
      open={confirmRemove}
      onClose={() => setConfirmRemove(false)}
      size="sm"
      role="alertdialog"
      testId="sms-key-remove-dialog"
      title={t("sms.keyRemoveTitle")}
      description={t("sms.keyRemoveBody")}
      footer={
        <>
          <Button variant="secondary" data-autofocus onClick={() => setConfirmRemove(false)} className="sm:ml-auto">
            {t("rq.rj.cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              set({ removeKey: true, apiKey: "" });
              setConfirmRemove(false);
            }}
            data-testid="sms-key-remove-confirm"
          >
            <Trash2 aria-hidden className="size-4" />
            {t("sms.keyRemove")}
          </Button>
        </>
      }
    />
  );
}
