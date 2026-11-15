"use client";

import { BellRing, Info, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SaveBar } from "@/components/ui/save-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import type { UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import {
  canAddRow,
  fieldKey,
  newRow,
  rowsOf,
  signature,
  validateContacts,
  type ContactErrors,
  type ContactRow,
} from "@/lib/unattended/contacts";
import { NOTIFY_CONTACTS_MAX, type NotifyContactsResponse } from "@/lib/unattended/contract";
import { unattendedUiError } from "@/lib/unattended/errors";

type Load = { kind: "loading" } | { kind: "error" } | { kind: "ok"; saved: string };

/** Kayıtlı adresleri yükler; `apply` sunucu yanıtını hem forma hem kayıtlı imzaya yazar. */
function useContactsLoad(customerId: string) {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [base, setBase] = useState<ContactRow[]>([]);
  const [nonce, setNonce] = useState(0);
  const apply = (r: NotifyContactsResponse) => {
    const next = rowsOf(r.items);
    setRows(next);
    setBase(next);
    setLoad({ kind: "ok", saved: signature(next) });
  };
  useEffect(() => {
    let live = true;
    api<NotifyContactsResponse>("GET", `/unattended/customers/${customerId}/contacts`).then(
      (r) => live && apply(r),
      (e: unknown) => live && (isUnauthenticated(e) ? router.replace(EXPIRED_LOGIN_PATH) : setLoad({ kind: "error" })),
    );
    return () => {
      live = false;
    };
  }, [customerId, nonce, router]);
  return { load, rows, setRows, base, apply, retry: () => setNonce((n) => n + 1) };
}

function useContacts(customerId: string) {
  const router = useRouter();
  const toast = useToast();
  const l = useContactsLoad(customerId);
  const [errors, setErrors] = useState<ContactErrors>({});
  const [failure, setFailure] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const v = validateContacts(l.rows);
    setErrors(v.errors);
    setFailure(null);
    if (!v.body) return;
    setBusy(true);
    try {
      l.apply(await api<NotifyContactsResponse>("PUT", `/unattended/customers/${customerId}/contacts`, v.body));
      toast(t("un.contacts.saved"));
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFailure(unattendedUiError(err));
    } finally {
      setBusy(false);
    }
  };
  const reset = () => (l.setRows(l.base), setErrors({}), setFailure(null));
  return { load: l.load, rows: l.rows, setRows: l.setRows, errors, failure, busy, submit, reset, retry: l.retry };
}

type FieldsProps = {
  row: ContactRow;
  i: number;
  errors: ContactErrors;
  busy: boolean;
  onChange: (r: ContactRow) => void;
  onRemove: () => void;
};

function ContactFields({ row, i, errors, busy, onChange, onRemove }: FieldsProps) {
  const field = (k: "email" | "phone") => ({
    autoComplete: "off",
    value: row[k],
    onChange: (e: ChangeEvent<HTMLInputElement>) => onChange({ ...row, [k]: e.target.value }),
    error: errors[fieldKey(i, k)],
    disabled: busy,
    className: "sm:flex-1",
  });
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-start" data-testid="un-contact-row">
      <TextField label={t("un.contacts.email", { n: i + 1 })} type="email" {...field("email")} />
      <TextField label={t("un.contacts.phone", { n: i + 1 })} type="tel" hint={t("un.contacts.phoneHint")} {...field("phone")} />
      <Button
        type="button"
        variant="ghost"
        onClick={onRemove}
        disabled={busy}
        aria-label={t("un.contacts.remove", { n: i + 1 })}
        className="self-end sm:mt-6 sm:self-start"
      >
        <Trash2 aria-hidden className="size-4" />
      </Button>
    </li>
  );
}

type Contacts = ReturnType<typeof useContacts>;

function ContactRows({ c }: { c: Contacts }) {
  if (c.rows.length === 0) return null;
  const update = (i: number, r: ContactRow) => c.setRows((rs) => rs.map((x, j) => (j === i ? r : x)));
  return (
    <ul className="flex flex-col gap-2">
      {c.rows.map((r, i) => (
        <ContactFields
          key={r.key}
          row={r}
          i={i}
          errors={c.errors}
          busy={c.busy}
          onChange={(x) => update(i, x)}
          onRemove={() => c.setRows((rs) => rs.filter((_, j) => j !== i))}
        />
      ))}
    </ul>
  );
}

function ContactsForm({ c, saved }: { c: Contacts; saved: string }) {
  const formId = "un-contacts-form";
  return (
    <form id={formId} noValidate onSubmit={(e) => void c.submit(e)} className="flex flex-col gap-3">
      {c.rows.length === 0 && (
        <Alert tone="warning" testId="un-contacts-empty">
          {t("un.contacts.empty")}
        </Alert>
      )}
      <FormError error={c.failure} />
      <ContactRows c={c} />
      <Button
        type="button"
        variant="secondary"
        onClick={() => c.setRows((rs) => [...rs, newRow()])}
        disabled={c.busy || !canAddRow(c.rows)}
        className="self-start"
        data-testid="un-contacts-add"
      >
        <Plus aria-hidden className="size-4" />
        {t("un.contacts.add")}
      </Button>
      <p className="flex items-start gap-2 text-sm text-fg-muted" data-testid="un-contacts-notice">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        {t("un.contacts.notice")}
      </p>
      <SaveBar
        dirty={signature(c.rows) !== saved}
        busy={c.busy}
        formId={formId}
        onReset={c.reset}
        message={t("un.contacts.dirty")}
        leaveBody={t("un.contacts.leave")}
        testId="un-contacts-bar"
      />
    </form>
  );
}

/**
 * Müşteri → "Gözetimsiz bildirim adresleri" (AC-296, 337; `unattended.manage`): ≤ 5 e-posta + isteğe bağlı telefon.
 * Kaydet sunucuda step-up ister (`lib/api` diyaloğu, bir kez yinelenir). Boşken bağlantı engeli uyarısı (`BellRing`).
 */
export function NotifyContacts({ customerId }: { customerId: string }) {
  const c = useContacts(customerId);
  return (
    <section
      id="bildirim-adresleri"
      aria-labelledby="bildirim-adresleri-h"
      className="flex flex-col gap-3 border-t border-border pt-6"
      data-testid="un-contacts"
    >
      <h2 id="bildirim-adresleri-h" className="flex items-center gap-2 text-lg font-semibold text-fg">
        <BellRing aria-hidden className="size-5 text-primary" />
        {t("un.contacts.title")}
      </h2>
      <p className="text-sm text-fg-muted">{t("un.contacts.desc", { n: NOTIFY_CONTACTS_MAX })}</p>
      {c.load.kind === "loading" && (
        <div aria-busy="true">
          <Skeleton className="h-20 w-full" />
        </div>
      )}
      {c.load.kind === "error" && <LoadError onRetry={c.retry} />}
      {c.load.kind === "ok" && <ContactsForm c={c} saved={c.load.saved} />}
    </section>
  );
}
