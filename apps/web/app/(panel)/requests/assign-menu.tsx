"use client";

import { ChevronsDown, ChevronsUp, Flag, Minus, UserCheck, UserMinus, UserPlus } from "lucide-react";
import { useCallback, useState } from "react";
import { labelOf, PRIORITY_LABELS } from "@remote/contracts/labels";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Dialog } from "@/components/ui/dialog";
import { closeMenu } from "@/components/ui/menu";
import { api } from "@/lib/api";
import type { UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import type { SupportRequestItem } from "@/lib/requests/contract";
import { REQUEST_PRIORITIES, type RequestPriority } from "@/lib/requests/p18";
import type { UserOptionsResponse } from "@/lib/users/contract";

const itemCls =
  "flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-sm px-3 text-left text-sm text-fg hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60";
const PRIORITY_ICON: Record<RequestPriority, typeof Minus> = { HIGH: ChevronsUp, NORMAL: Minus, LOW: ChevronsDown };

export interface AssignActions {
  meId: string;
  busy: boolean;
  onOpenAssign: () => void;
  onAssign: (userId: string | null) => void;
  onPriority: (p: RequestPriority) => void;
}

/**
 * Kart menüsünün atama/öncelik öğeleri (§8b.8; yalnız `support_requests.assign` ile çizilir): "Ata…" (`UserPlus`),
 * "Bana ata" (`UserCheck`), "Atamayı kaldır" (`UserMinus`), "Öncelik" (`Flag`) grubu — seçili olan `aria-pressed`.
 */
export function AssignMenuItems({ item, actions }: { item: SupportRequestItem; actions: AssignActions }) {
  const { meId, busy } = actions;
  const run = (e: React.MouseEvent<HTMLButtonElement>, fn: () => void) => {
    closeMenu(e.currentTarget);
    fn();
  };
  return (
    <div data-testid="assign-menu" className="flex flex-col">
      <button type="button" disabled={busy} className={itemCls} data-testid="assign-open" onClick={(e) => run(e, actions.onOpenAssign)}>
        <UserPlus aria-hidden className="size-4 shrink-0" />
        {t("rq.as.open")}
      </button>
      {item.assignedTo?.id !== meId && (
        <button
          type="button"
          disabled={busy}
          className={itemCls}
          data-testid="assign-me"
          onClick={(e) => run(e, () => actions.onAssign(meId))}
        >
          <UserCheck aria-hidden className="size-4 shrink-0" />
          {t("rq.as.me")}
        </button>
      )}
      {item.assignedTo && (
        <button
          type="button"
          disabled={busy}
          className={itemCls}
          data-testid="assign-clear"
          onClick={(e) => run(e, () => actions.onAssign(null))}
        >
          <UserMinus aria-hidden className="size-4 shrink-0" />
          {t("rq.as.clear")}
        </button>
      )}
      <div role="group" aria-labelledby={`prio-${item.id}`} className="mt-1 border-t border-border pt-1">
        <p id={`prio-${item.id}`} className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-fg-muted">
          <Flag aria-hidden className="size-4 shrink-0" />
          {t("rq.p.title")}
        </p>
        {[...REQUEST_PRIORITIES].reverse().map((p) => {
          const Icon = PRIORITY_ICON[p];
          const active = item.priority === p;
          return (
            <button
              key={p}
              type="button"
              aria-pressed={active}
              disabled={busy}
              data-testid={`priority-${p}`}
              className={`${itemCls} ${active ? "bg-primary-surface font-medium text-primary" : ""}`}
              onClick={(e) => run(e, () => !active && actions.onPriority(p))}
            >
              <Icon aria-hidden className="size-4 shrink-0" />
              {labelOf(PRIORITY_LABELS, p)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** "Ata…" diyaloğu: atanabilir teknisyenler (`GET /users/options?assignable=1`) arasından seçim. */
export function AssignDialog({
  item,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  item: SupportRequestItem | null;
  busy: boolean;
  error: UiError | null;
  onClose: () => void;
  onSubmit: (userId: string) => void;
}) {
  const [value, setValue] = useState<ComboOption | null>(null);
  const [fieldError, setFieldError] = useState<string>();
  const load = useCallback(async (q: string, signal: AbortSignal): Promise<ComboOption[]> => {
    const r = await api<UserOptionsResponse>("GET", "/users/options?assignable=1", undefined, {
      fetch: (input, init) => fetch(input, { ...init, signal }),
      cookie: () => document.cookie,
    });
    const needle = q.trim().toLocaleLowerCase("tr");
    return r.items
      .filter((u) => u.status === "ACTIVE" && (!needle || u.fullName.toLocaleLowerCase("tr").includes(needle)))
      .map((u) => ({ id: u.id, label: u.fullName }));
  }, []);
  const close = () => {
    if (busy) return;
    setValue(null);
    setFieldError(undefined);
    onClose();
  };
  return (
    <Dialog
      open={item !== null}
      onClose={close}
      size="sm"
      testId="assign-dialog"
      title={t("rq.as.title")}
      description={item ? t("rq.as.desc", { name: item.customerName ?? t("rq.anon") }) : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy} className="sm:ml-auto">
            {t("rq.rj.cancel")}
          </Button>
          <Button
            loading={busy}
            data-testid="assign-submit"
            onClick={() => {
              if (!value) return setFieldError(t("rq.as.pick"));
              onSubmit(value.id);
            }}
          >
            {!busy && <UserPlus aria-hidden className="size-4" />}
            {t("rq.as.submit")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <FormError error={error} />}
        <div>
          <Combobox
            label={t("rq.as.tech")}
            value={value}
            onChange={(v) => {
              setValue(v);
              setFieldError(undefined);
            }}
            load={load}
            placeholder={t("rq.as.search")}
            hint={item?.assignedTo ? t("rq.as.current", { name: item.assignedTo.name }) : undefined}
            error={fieldError}
            disabled={busy}
            openOnFocus
            inline
            testId="assign-combobox"
          />
        </div>
      </div>
    </Dialog>
  );
}
