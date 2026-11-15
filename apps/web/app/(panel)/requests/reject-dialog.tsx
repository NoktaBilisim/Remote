"use client";

import { UserX } from "lucide-react";
import { useId, useRef, useState, type RefObject } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/text-field";
import { api, ApiError } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import { REJECT_PRESETS, type SupportRequestItem } from "@/lib/requests/contract";
import { checkRejectMessage } from "@/lib/requests/validate";

const OTHER = "other";

type OtherRef = RefObject<HTMLInputElement | null>;

const isGone = (err: unknown): err is ApiError =>
  err instanceof ApiError && (err.code === "REQUEST_TAKEN" || err.code === "REQUEST_CLOSED" || err.status === 404);

interface RejectFormOptions {
  item: SupportRequestItem | null;
  onDone: (id: string) => void;
  onGone: (id: string, code: string) => void;
  otherRef: OtherRef;
}

function useRejectState() {
  const [choice, setChoice] = useState<string>(REJECT_PRESETS[0]);
  const [other, setOther] = useState("");
  const [fieldError, setFieldError] = useState<string>();
  const [formError, setFormError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setChoice(REJECT_PRESETS[0]);
    setOther("");
    setFieldError(undefined);
    setFormError(null);
  };
  return { choice, setChoice, other, setOther, fieldError, setFieldError, formError, setFormError, busy, setBusy, reset };
}

/** Seçim/serbest metin durumu ve gönderim; `otherRef` bileşende oluşturulur (React Compiler `react-hooks/refs`). */
function useRejectForm({ item, onDone, onGone, otherRef }: RejectFormOptions) {
  const st = useRejectState();
  const { choice, setChoice, other, setOther, setFieldError, setFormError, setBusy, reset } = st;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;
    const raw = choice === OTHER ? other : choice;
    const v = checkRejectMessage(raw);
    if (!v.value) {
      setFieldError(v.error);
      otherRef.current?.focus();
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await api("POST", `/support-requests/${item.id}/reject`, { message: v.value });
      reset();
      onDone(item.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.fields?.message) {
        setChoice(OTHER);
        setOther(raw);
        setFieldError(err.fields.message);
      } else if (isGone(err)) {
        reset();
        onGone(item.id, err.code);
      } else setFormError(toUiError(err));
    } finally {
      setBusy(false);
    }
  };

  return { ...st, submit };
}

/** Hazır mesajlar + "Diğer" (radyo grubu; ilki otomatik odak, "Diğer" seçilince metin alanına odak). */
type RejectForm = ReturnType<typeof useRejectForm>;

function RejectChoices({ f, otherRef }: { f: RejectForm; otherRef: OtherRef }) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm font-medium text-fg">{t("rq.rj.legend")}</legend>
      {[...REJECT_PRESETS, OTHER].map((p, i) => (
        <label key={p} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm text-fg hover:bg-surface-muted">
          <input
            type="radio"
            name={name}
            value={p}
            checked={f.choice === p}
            data-autofocus={i === 0 ? true : undefined}
            onChange={() => {
              f.setChoice(p);
              f.setFieldError(undefined);
              if (p === OTHER) setTimeout(() => otherRef.current?.focus(), 0);
            }}
            className="size-4 accent-primary"
          />
          {p === OTHER ? t("rq.rj.other") : p}
        </label>
      ))}
    </fieldset>
  );
}

interface RejectDialogProps extends Omit<RejectFormOptions, "otherRef"> {
  onClose: () => void;
}

/** "Diğer" seçiliyse serbest metin alanı; değilse (sunucu alan hatası) kısa hata satırı. */
function RejectOther({ f, otherRef }: { f: RejectForm; otherRef: OtherRef }) {
  if (f.choice !== OTHER) return f.fieldError && <p className="text-xs font-medium text-danger">{f.fieldError}</p>;
  return (
    <TextField
      ref={otherRef}
      label={t("rq.rj.message")}
      value={f.other}
      maxLength={200}
      onChange={(e) => {
        f.setOther(e.target.value);
        f.setFieldError(undefined);
      }}
      error={f.fieldError}
      hint={t("rq.rj.hint")}
      data-testid="reject-other"
    />
  );
}

function RejectFooter({ busy, onCancel }: { busy: boolean; onCancel: () => void }) {
  return (
    <div className="flex flex-col-reverse gap-2 border-t border-border pt-3 sm:flex-row sm:justify-end">
      <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
        {t("rq.rj.cancel")}
      </Button>
      <Button type="submit" variant="danger" loading={busy}>
        {!busy && <UserX aria-hidden className="size-4" />}
        {t("rq.rj.submit")}
      </Button>
    </div>
  );
}

/**
 * Talebi reddet (AC-157, G-E9-12): hazır mesajlar varsayılan seçili; serbest metin yalnız "Diğer" ile açılır.
 * Kural istemcide de uygulanır (5–200, tek satır, bağlantı/e-posta/telefon yok); sunucu 400 `fields.message` forma yansır.
 * 409 REQUEST_TAKEN / REQUEST_CLOSED → çağırana bildirilir (kart listeden düşer).
 */
export function RejectDialog({ item, onClose, onDone, onGone }: RejectDialogProps) {
  const otherRef = useRef<HTMLInputElement>(null);
  const f = useRejectForm({ item, onDone, onGone, otherRef });
  const close = () => {
    if (f.busy) return;
    f.reset();
    onClose();
  };

  return (
    <Dialog
      open={item !== null}
      onClose={close}
      size="sm"
      testId="reject-dialog"
      title={t("rq.rj.title")}
      description={item ? t("rq.rj.desc", { name: item.customerName ?? t("rq.anon") }) : undefined}
    >
      <form onSubmit={f.submit} noValidate className="flex flex-col gap-4">
        {f.formError && <FormError error={f.formError} />}
        <RejectChoices f={f} otherRef={otherRef} />
        <RejectOther f={f} otherRef={otherRef} />
        <RejectFooter busy={f.busy} onCancel={close} />
      </form>
    </Dialog>
  );
}
