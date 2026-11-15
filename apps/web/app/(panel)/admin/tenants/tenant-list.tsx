"use client";

import { Archive, ArchiveRestore, ArrowRightLeft, Building, Check, PenLine, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type ReactNode } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { formatDateTime, formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { SwitchTenantResponse, TenantItem } from "@/lib/users/contract";
import { StatusPill } from "../../users/user-list";
import { TenantFormDialog } from "./tenant-form-dialog";

type Action = { kind: "edit" | "deactivate" | "reactivate"; tenant: TenantItem };

/** "Yeni firma" düğmesi (başlık ve boş durum). */
export function NewTenantButton({ testId = "tenant-new" }: { testId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid={testId}>
        <Plus aria-hidden className="size-4" />
        {t("tn.new")}
      </Button>
      {open && (
        <TenantFormDialog
          onClose={() => setOpen(false)}
          onSaved={(x) => {
            setOpen(false);
            toast(t("tn.created", { name: x.name }));
            router.refresh();
          }}
        />
      )}
    </>
  );
}

/**
 * Firma listesi (AC-70): ≥ md tablo, dar ekranda kart. Satır eylemleri: Düzenle, Bu firmaya geç (aktif ve etkin
 * olmayan), Pasife al / Yeniden etkinleştir. Etkin firma satırında "Etkin firma" rozeti.
 */
export function TenantList({ items, actingId }: { items: TenantItem[]; actingId: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [action, setAction] = useState<Action | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  const switchTo = async (x: TenantItem) => {
    setSwitching(x.id);
    try {
      const r = await api<SwitchTenantResponse>("POST", "/admin/switch-tenant", { tenantId: x.id });
      toast(t("ts.switched", { name: r.actingTenant?.name ?? x.name }));
      router.refresh();
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      toast(t("ts.failed"), "danger");
      router.refresh();
    } finally {
      setSwitching(null);
    }
  };

  const actions = (x: TenantItem): ReactNode => (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="secondary"
        onClick={() => setAction({ kind: "edit", tenant: x })}
        aria-label={t("tn.editFor", { name: x.name })}
        data-testid="tenant-edit"
      >
        <PenLine aria-hidden className="size-4" />
        <span aria-hidden>{t("tn.edit")}</span>
      </Button>
      {x.status === "ACTIVE" && x.id !== actingId && (
        <Button
          variant="secondary"
          loading={switching === x.id}
          disabled={switching !== null}
          onClick={() => void switchTo(x)}
          aria-label={t("tn.switchFor", { name: x.name })}
          data-testid="tenant-switch"
        >
          {switching !== x.id && <ArrowRightLeft aria-hidden className="size-4" />}
          <span aria-hidden>{t("tn.switch")}</span>
        </Button>
      )}
      {x.status === "ACTIVE" ? (
        <Button
          variant="danger-ghost"
          onClick={() => setAction({ kind: "deactivate", tenant: x })}
          aria-label={t("tn.deactFor", { name: x.name })}
          data-testid="tenant-deactivate"
        >
          <Archive aria-hidden className="size-4" />
          <span aria-hidden>{t("tn.deact")}</span>
        </Button>
      ) : (
        <Button
          variant="secondary"
          onClick={() => setAction({ kind: "reactivate", tenant: x })}
          aria-label={t("tn.rFor", { name: x.name })}
          data-testid="tenant-reactivate"
        >
          <ArchiveRestore aria-hidden className="size-4" />
          <span aria-hidden>{t("tn.r")}</span>
        </Button>
      )}
    </div>
  );
  const nameCell = (x: TenantItem) => (
    <span className="flex min-w-0 items-center gap-2">
      <Building aria-hidden className="size-4 shrink-0 text-fg-muted" />
      <span className="truncate font-medium text-fg" title={x.name}>
        {x.name}
      </span>
      {x.id === actingId && (
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-surface px-2 py-0.5 text-xs font-medium text-primary"
          data-testid="tenant-current"
        >
          <Check aria-hidden className="size-3.5" />
          {t("tn.current")}
        </span>
      )}
    </span>
  );

  return (
    <>
      <div
        className="hidden overflow-x-auto rounded-lg border border-border bg-surface md:block"
        tabIndex={0}
        role="region"
        aria-label={t("tn.tableRegion")}
      >
        <table className="w-full text-left text-sm" data-testid="tenants-table">
          <caption className="sr-only">{t("tn.title")}</caption>
          <thead className="bg-surface-muted text-xs text-fg-muted">
            <tr>
              <th scope="col" className="px-3 py-3 font-medium">
                {t("tn.col.name")}
              </th>
              <th scope="col" className="px-3 py-3 font-medium">
                {t("tn.col.slug")}
              </th>
              <th scope="col" className="px-3 py-3 text-right font-medium">
                {t("tn.col.users")}
              </th>
              <th scope="col" className="px-3 py-3 font-medium">
                {t("tn.col.created")}
              </th>
              <th scope="col" className="px-3 py-3 font-medium">
                {t("tn.col.status")}
              </th>
              <th scope="col" className="px-3 py-3 font-medium">
                {t("tn.col.actions")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((x) => (
              <tr key={x.id} data-testid="tenant-row" className="hover:bg-surface-muted">
                <td className="max-w-72 px-3 py-2">{nameCell(x)}</td>
                <td className="px-3 py-2 font-mono text-xs text-fg">{x.slug}</td>
                <td className="px-3 py-2 text-right tabular-nums text-fg">{formatNumber(x.activeUserCount)}</td>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums text-fg">{formatDateTime(x.createdAt)}</td>
                <td className="px-3 py-2">
                  <StatusPill status={x.status} testId="tenant-status" />
                </td>
                <td className="px-3 py-2">{actions(x)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-2 md:hidden" data-testid="tenants-cards">
        {items.map((x) => (
          <li key={x.id} data-testid="tenant-card" className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">{nameCell(x)}</div>
              <StatusPill status={x.status} testId="tenant-status" />
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-fg-muted">{t("tn.col.slug")}</dt>
              <dd className="font-mono text-fg">{x.slug}</dd>
              <dt className="text-fg-muted">{t("tn.col.users")}</dt>
              <dd className="tabular-nums text-fg">{formatNumber(x.activeUserCount)}</dd>
            </dl>
            {actions(x)}
          </li>
        ))}
      </ul>

      {action?.kind === "edit" && (
        <TenantFormDialog
          tenant={action.tenant}
          onClose={() => setAction(null)}
          onSaved={(x) => {
            setAction(null);
            toast(t("tn.saved", { name: x.name }));
            router.refresh();
          }}
        />
      )}
      <StatusDialog
        action={
          action && (action.kind === "deactivate" || action.kind === "reactivate") ? { kind: action.kind, tenant: action.tenant } : null
        }
        onClose={() => setAction(null)}
      />
    </>
  );
}

/**
 * Pasife al (etkiler listesi + kısa adı yazarak onay; odak "Vazgeç") / Yeniden etkinleştir onayı. `alertdialog`.
 */
function StatusDialog({
  action,
  onClose,
}: {
  action: { kind: "deactivate" | "reactivate"; tenant: TenantItem } | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [typed, setTyped] = useState("");
  const [typedErr, setTypedErr] = useState<string | undefined>();
  const listId = useId();
  const deact = action?.kind === "deactivate";
  const x = action?.tenant;

  const close = () => {
    if (busy) return;
    setTyped("");
    setTypedErr(undefined);
    setError(null);
    onClose();
  };
  const run = async () => {
    if (!action || !x) return;
    if (deact && typed.trim() !== x.slug) return setTypedErr(t("tn.d.typeMismatch"));
    setBusy(true);
    setError(null);
    try {
      await api<unknown>("POST", `/admin/tenants/${x.id}/${action.kind}`, {});
      toast(t(deact ? "tn.d.done" : "tn.r.done", { name: x.name }));
      setTyped("");
      onClose();
      router.refresh();
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      if (e instanceof ApiError && e.status === 409) {
        toast(t(deact ? "tn.d.already" : "tn.r.already"), "danger");
        onClose();
        router.refresh();
      } else setError(toUiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={action !== null}
      onClose={close}
      role="alertdialog"
      size="sm"
      testId={action ? `tenant-${action.kind}-dialog` : undefined}
      title={x ? t(deact ? "tn.d.title" : "tn.r.title", { name: x.name }) : ""}
      description={x ? deact ? <span id={listId}>{t("tn.d.intro")}</span> : t("tn.r.body") : undefined}
      footer={
        action && (
          <>
            <Button variant="secondary" data-autofocus onClick={close} disabled={busy} className="sm:ml-auto">
              {t("rq.rj.cancel")}
            </Button>
            <Button variant={deact ? "danger" : "primary"} loading={busy} onClick={() => void run()} data-testid="tenant-action-confirm">
              {!busy && (deact ? <Archive aria-hidden className="size-4" /> : <ArchiveRestore aria-hidden className="size-4" />)}
              {t(deact ? "tn.d.confirm" : "tn.r.confirm")}
            </Button>
          </>
        )
      }
    >
      {(deact || error) && (
        <div className="flex flex-col gap-4">
          {error && <FormError error={error} />}
          {deact && x && (
            <>
              <ul
                className="flex list-disc flex-col gap-1 pl-5 text-sm text-fg"
                aria-labelledby={listId}
                data-testid="tenant-deactivate-effects"
              >
                <li>{t("tn.d.e1")}</li>
                <li>{t("tn.d.e2")}</li>
                <li>{t("tn.d.e3")}</li>
                <li>{t("tn.d.e4")}</li>
              </ul>
              <TextField
                label={t("tn.d.typeLabel", { slug: x.slug })}
                value={typed}
                autoComplete="off"
                spellCheck={false}
                error={typedErr}
                disabled={busy}
                data-testid="tenant-deactivate-type"
                onChange={(e) => {
                  setTyped(e.target.value);
                  setTypedErr(undefined);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void run();
                  }
                }}
              />
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
