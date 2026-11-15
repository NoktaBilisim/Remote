"use client";

import { Archive, ArchiveRestore, PenLine, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import type { CustomerDetail } from "@/lib/customers/contract";
import { toUiError, type UiError } from "@/lib/error-message";
import { t, type MessageKey } from "@/lib/i18n";
import { CustomerFormDialog } from "../customer-form-dialog";

type Action = "rotate" | "deactivate" | "reactivate";

const ACTION: Record<
  Action,
  { title: MessageKey; body: MessageKey; confirm: MessageKey; done: MessageKey; conflict: MessageKey; danger: boolean }
> = {
  rotate: {
    title: "cu.rotate.title",
    body: "cu.rotate.body",
    confirm: "cu.rotate.confirm",
    done: "cu.rotate.done",
    conflict: "cu.err.passive",
    danger: true,
  },
  deactivate: {
    title: "cu.deact.title",
    body: "cu.deact.body",
    confirm: "cu.deact.confirm",
    done: "cu.deact.done",
    conflict: "cu.err.alreadyPassive",
    danger: true,
  },
  reactivate: {
    title: "cu.react.title",
    body: "cu.react.body",
    confirm: "cu.react.confirm",
    done: "cu.react.done",
    conflict: "cu.err.alreadyActive",
    danger: false,
  },
};

const ICON: Record<Action, ReactNode> = {
  rotate: <RefreshCw aria-hidden className="size-4" />,
  deactivate: <Archive aria-hidden className="size-4" />,
  reactivate: <ArchiveRestore aria-hidden className="size-4" />,
};

/** Onay diyaloğu (AC-170, AC-171): `alertdialog`, varsayılan odak "Vazgeç". */
function ConfirmDialog({
  action,
  name,
  onClose,
  onConfirm,
  busy,
  error,
}: {
  action: Action | null;
  name: string;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
  error: UiError | null;
}) {
  const a = action ? ACTION[action] : null;
  return (
    <Dialog
      open={action !== null}
      onClose={() => !busy && onClose()}
      role="alertdialog"
      size="sm"
      testId={action ? `customer-${action}-dialog` : undefined}
      title={a ? t(a.title, { name }) : ""}
      description={a ? t(a.body) : undefined}
      footer={
        action &&
        a && (
          <>
            <Button variant="secondary" data-autofocus onClick={onClose} disabled={busy} className="sm:ml-auto">
              {t("rq.rj.cancel")}
            </Button>
            <Button variant={a.danger ? "danger" : "primary"} loading={busy} onClick={onConfirm} data-testid="customer-action-confirm">
              {!busy && ICON[action]}
              {t(a.confirm)}
            </Button>
          </>
        )
      }
    >
      {error && <FormError error={error} />}
    </Dialog>
  );
}

/**
 * Müşteri detay eylemleri: Düzenle (`customers.edit`), Bağlantıyı yenile (`edit`, yalnız aktif), Pasife al
 * (`customers.delete`) / Yeniden aktif et (`edit`). Başarıda toast + sunucudan yeniden çizim.
 */
export function CustomerActions({
  customer,
  canEdit,
  canDelete,
  only,
}: {
  customer: CustomerDetail;
  canEdit: boolean;
  canDelete: boolean;
  only?: "rotate";
}) {
  const router = useRouter();
  const toast = useToast();
  const [action, setAction] = useState<Action | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const active = customer.status === "ACTIVE";

  const run = async () => {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      const path = action === "rotate" ? "rotate-ref" : action;
      await api<CustomerDetail>("POST", `/customers/${customer.id}/${path}`, {});
      toast(t(ACTION[action].done));
      setAction(null);
      router.refresh();
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      if (e instanceof ApiError && e.status === 409) {
        toast(t(ACTION[action].conflict), "danger");
        setAction(null);
        router.refresh();
      } else setError(toUiError(e, { 404: t("cu.notFoundBody") }));
    } finally {
      setBusy(false);
    }
  };
  const open = (a: Action) => {
    setError(null);
    setAction(a);
  };

  const dialogs = (
    <>
      <ConfirmDialog
        action={action}
        name={customer.name}
        busy={busy}
        error={error}
        onClose={() => setAction(null)}
        onConfirm={() => void run()}
      />
      {editing && (
        <CustomerFormDialog
          customer={customer}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            toast(t("cu.saved"));
            router.refresh();
          }}
        />
      )}
    </>
  );

  if (only === "rotate") {
    if (!canEdit || !active) return null;
    return (
      <>
        <Button variant="danger-ghost" onClick={() => open("rotate")} className="self-start" data-testid="customer-rotate">
          <RefreshCw aria-hidden className="size-4" />
          {t("cu.rotate.open")}
        </Button>
        {dialogs}
      </>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {canEdit && (
        <Button variant="secondary" onClick={() => setEditing(true)} data-testid="customer-edit">
          <PenLine aria-hidden className="size-4" />
          {t("cu.edit")}
        </Button>
      )}
      {active && canDelete && (
        <Button variant="danger-ghost" onClick={() => open("deactivate")} data-testid="customer-deactivate">
          <Archive aria-hidden className="size-4" />
          {t("cu.deact.open")}
        </Button>
      )}
      {!active && canEdit && (
        <Button variant="secondary" onClick={() => open("reactivate")} data-testid="customer-reactivate">
          <ArchiveRestore aria-hidden className="size-4" />
          {t("cu.react.open")}
        </Button>
      )}
      {dialogs}
    </div>
  );
}
