"use client";

import type { RequestBlockKind } from "@remote/contracts/api/request-blocks";
import { Globe, MonitorSmartphone, ShieldBan } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import type { UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import {
  REQUEST_BLOCK_NOTE_MAX,
  blockErrorOf,
  buildCidrBlock,
  buildRequestBlock,
  durationOptions,
  emptyBlockDraft,
  type BlockDraft,
  type BlockErrors,
} from "@/lib/requests/blocks";

/** Süre + not alanları (iki diyalogda ortak). */
function DurationNote({
  draft,
  set,
  errors,
  disabled,
}: {
  draft: Pick<BlockDraft, "duration" | "note">;
  set: (p: Partial<BlockDraft>) => void;
  errors: BlockErrors;
  disabled: boolean;
}) {
  return (
    <>
      <SelectField
        label={t("bl.f.duration")}
        options={durationOptions()}
        value={draft.duration}
        onChange={(e) => set({ duration: e.target.value })}
        error={errors.durationHours}
        hint={t("bl.f.durationHint")}
        disabled={disabled}
        data-testid="block-duration"
      />
      <TextField
        label={t("bl.f.note")}
        value={draft.note}
        maxLength={REQUEST_BLOCK_NOTE_MAX}
        onChange={(e) => set({ note: e.target.value })}
        error={errors.note}
        hint={t("bl.f.noteHint", { max: REQUEST_BLOCK_NOTE_MAX })}
        disabled={disabled}
        data-testid="block-note"
      />
    </>
  );
}

/**
 * "Engel ekle" (P15, AC-235): IP adresi ya da önek (IPv4 /24–/32, IPv6 /48–/128; contracts `checkBlockCidr` — hizasız önek
 * sunucuda ağ adresine indirgenir), süre (1 sa – süresiz), not. Alan bazlı hata, ilk hatalı alana odak; 409 "zaten engelli"
 * hedef alanına, sınır (1.000) form üstüne.
 */
export function AddBlockDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState<BlockDraft>(emptyBlockDraft);
  const [errors, setErrors] = useState<BlockErrors>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const cidrRef = useRef<HTMLInputElement>(null);
  const set = (p: Partial<BlockDraft>) => setDraft((d) => ({ ...d, ...p }));

  // Her açılışta temiz form
  const [seen, setSeen] = useState(open);
  if (seen !== open) {
    setSeen(open);
    if (open) {
      setDraft(emptyBlockDraft());
      setErrors({});
      setFormError(null);
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const r = buildCidrBlock(draft);
    setErrors(r.errors);
    setFormError(null);
    if (!r.body) {
      if (r.errors.cidr) cidrRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await api("POST", "/request-blocks", r.body);
      onSaved();
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      const m = blockErrorOf(err);
      setErrors(m.fields);
      if (m.message) setFormError({ message: m.message, tone: "danger" });
      // Alan istek sürerken pasif; odak busy kalkınca (sonraki karede) verilir
      if (m.fields.cidr) requestAnimationFrame(() => cidrRef.current?.focus());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      testId="block-add-dialog"
      title={t("bl.add.title")}
      description={t("bl.add.body")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy} className="sm:ml-auto">
            {t("su.cancel")}
          </Button>
          <Button type="submit" form="block-add-form" loading={busy} data-testid="block-add-submit">
            {!busy && <ShieldBan aria-hidden className="size-4" />}
            {t("bl.add.submit")}
          </Button>
        </>
      }
    >
      <form id="block-add-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {formError && <FormError error={formError} />}
        <TextField
          ref={cidrRef}
          label={t("bl.f.cidr")}
          value={draft.cidr}
          onChange={(e) => set({ cidr: e.target.value })}
          error={errors.cidr}
          hint={t("bl.f.cidrHint")}
          placeholder="203.0.113.7"
          autoComplete="off"
          spellCheck={false}
          inputMode="url"
          disabled={busy}
          data-autofocus
          className="[&_input]:font-mono"
          data-testid="block-cidr"
        />
        <DurationNote draft={draft} set={set} errors={errors} disabled={busy} />
      </form>
    </Dialog>
  );
}

/**
 * Talepler ekranı "Bu kaynağı engelle" kısayolu (P15, AC-235): hedef IP adresi ya da bilgisayar (cihaz anahtarı). Panel
 * IP'yi/cihaz anahtarını görmez — sunucu talep satırından alır; kaynak yoksa sunucunun mesajı form üstünde.
 */
export function RequestBlockDialog({
  request,
  onClose,
  onSaved,
}: {
  request: { id: string; name: string } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const [target, setTarget] = useState<RequestBlockKind>("IP");
  const [draft, setDraft] = useState<Pick<BlockDraft, "duration" | "note">>({ duration: "24", note: "" });
  const [errors, setErrors] = useState<BlockErrors>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<BlockDraft>) => setDraft((d) => ({ ...d, ...p }));
  const open = request !== null;

  const [seen, setSeen] = useState(open);
  if (seen !== open) {
    setSeen(open);
    if (open) {
      setTarget("IP");
      setDraft({ duration: "24", note: "" });
      setErrors({});
      setFormError(null);
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !request) return;
    const r = buildRequestBlock(request.id, target, draft);
    setErrors(r.errors);
    setFormError(null);
    if (!r.body) return;
    setBusy(true);
    try {
      await api("POST", "/request-blocks", r.body);
      onSaved();
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      const m = blockErrorOf(err);
      setErrors(m.fields);
      const msg = m.message ?? m.fields.cidr;
      if (msg) setFormError({ message: msg, tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const opt = (value: RequestBlockKind, Icon: typeof Globe, label: string, hint: string) => (
    <label
      className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-sm ${
        target === value ? "border-primary bg-primary-surface" : "border-border"
      }`}
    >
      <input
        type="radio"
        name={`${id}-target`}
        value={value}
        checked={target === value}
        onChange={() => setTarget(value)}
        disabled={busy}
        className="mt-0.5 size-5 shrink-0 accent-primary"
        data-testid={`block-target-${value}`}
      />
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2 font-medium text-fg">
          <Icon aria-hidden className="size-4 text-fg-muted" />
          {label}
        </span>
        <span className="text-xs text-fg-muted">{hint}</span>
      </span>
    </label>
  );

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      testId="request-block-dialog"
      title={t("bl.rq.title", { name: request?.name ?? "" })}
      description={t("bl.rq.body")}
      footer={
        <>
          <Button variant="secondary" data-autofocus onClick={onClose} disabled={busy} className="sm:ml-auto">
            {t("su.cancel")}
          </Button>
          <Button type="submit" form="request-block-form" variant="danger" loading={busy} data-testid="request-block-submit">
            {!busy && <ShieldBan aria-hidden className="size-4" />}
            {t("bl.rq.submit")}
          </Button>
        </>
      }
    >
      <form id="request-block-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {formError && <FormError error={formError} />}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-fg">{t("bl.rq.target")}</legend>
          {opt("IP", Globe, t("bl.rq.ip"), t("bl.rq.ipHint"))}
          {opt("DEVICE", MonitorSmartphone, t("bl.rq.device"), t("bl.rq.deviceHint"))}
        </fieldset>
        <DurationNote draft={draft} set={set} errors={errors} disabled={busy} />
      </form>
    </Dialog>
  );
}
