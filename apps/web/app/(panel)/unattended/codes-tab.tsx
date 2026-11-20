"use client";

import { KeyRound, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import type { UiError } from "@/lib/error-message";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { RegistrationCodeItem } from "@/lib/unattended/contract";
import { unattendedUiError } from "@/lib/unattended/errors";
import { CreateCodeButton } from "./code-dialog";

function useCancel(code: RegistrationCodeItem | null, onClose: () => void, onDone: (id: string) => void) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const close = () => (busy ? undefined : (setError(null), onClose()));
  const confirm = async () => {
    if (!code || busy) return;
    setBusy(true);
    try {
      await api("DELETE", `/unattended/registration-codes/${code.id}`);
      onDone(code.id);
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      setError(unattendedUiError(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, close, confirm };
}

function CancelDialog({ code, onClose, onDone }: { code: RegistrationCodeItem | null; onClose: () => void; onDone: (id: string) => void }) {
  const { busy, error, close, confirm } = useCancel(code, onClose, onDone);
  return (
    <Dialog
      open={code !== null}
      onClose={close}
      role="alertdialog"
      size="sm"
      testId="un-cancel-dialog"
      title={t("un.codes.cancelTitle")}
      description={code ? t("un.codes.cancelBody", { customer: code.customerName }) : undefined}
      footer={
        <>
          <Button variant="secondary" data-autofocus className="sm:ml-auto" onClick={close} disabled={busy}>
            {t("su.cancel")}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void confirm()} data-testid="un-cancel-confirm">
            {!busy && <Trash2 aria-hidden className="size-4" />}
            {t("un.codes.cancel")}
          </Button>
        </>
      }
    >
      {error && <FormError error={error} />}
    </Dialog>
  );
}

function CodeRow({ c, onCancel }: { c: RegistrationCodeItem; onCancel: (c: RegistrationCodeItem) => void }) {
  return (
    <li data-testid="un-code-row" className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-fg">{c.customerName}</p>
        <p className="text-xs text-fg-muted">
          {t("un.codes.by", { name: c.createdBy?.name ?? t("un.codes.deletedUser") })} ·{" "}
          <span className="tabular-nums">{t("un.codes.expires", { at: formatDateTime(c.expiresAt) })}</span>
        </p>
      </div>
      <Button
        variant="danger-ghost"
        onClick={() => onCancel(c)}
        aria-label={t("un.codes.cancelFor", { customer: c.customerName })}
        data-testid="un-code-cancel"
        className="self-start sm:self-auto"
      >
        <Trash2 aria-hidden className="size-4" />
        {t("un.codes.cancel")}
      </Button>
    </li>
  );
}

/** Kayıt kodları sekmesi (AC-273, `manage`): bekleyen kodlar (kodun kendisi yok), iptal onaylı. */
export function CodesTab({
  items,
  createBlock,
  riskAccepted = false,
}: {
  items: RegistrationCodeItem[];
  createBlock: string | null;
  riskAccepted?: boolean;
}) {
  const toast = useToast();
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [target, setTarget] = useState<RegistrationCodeItem | null>(null);
  const list = items.filter((c) => !removed.has(c.id));
  if (list.length === 0)
    return (
      <EmptyState
        Icon={KeyRound}
        title={t("un.codes.empty")}
        body={t("un.codes.emptyBody")}
        testId="un-codes-empty"
        action={<CreateCodeButton block={createBlock} riskAccepted={riskAccepted} testId="un-codes-empty-create" />}
      />
    );
  return (
    <>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface" data-testid="un-codes">
        {list.map((c) => (
          <CodeRow key={c.id} c={c} onCancel={setTarget} />
        ))}
      </ul>
      <CancelDialog
        code={target}
        onClose={() => setTarget(null)}
        onDone={(id) => {
          setRemoved((s) => new Set([...s, id]));
          setTarget(null);
          toast(t("un.codes.cancelled"));
        }}
      />
    </>
  );
}
