"use client";

import { ChevronsDown, ChevronsUp, Flag, Minus, UserCheck, UserMinus, UserPlus } from "lucide-react";
import { useState } from "react";
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

type Run = (e: React.MouseEvent<HTMLButtonElement>, fn: () => void) => void;

interface MenuButtonProps {
  testId: string;
  busy: boolean;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
  Icon: typeof Minus;
  label: string;
}

function MenuButton({ testId, busy, onClick, Icon, label }: MenuButtonProps) {
  return (
    <button type="button" disabled={busy} className={itemCls} data-testid={testId} onClick={onClick}>
      <Icon aria-hidden className="size-4 shrink-0" />
      {label}
    </button>
  );
}

/** "Öncelik" grubu: Yüksek → Düşük; seçili olan `aria-pressed`, yeniden seçmek istek göndermez. */
function PriorityGroup({ item, actions, run }: { item: SupportRequestItem; actions: AssignActions; run: Run }) {
  return (
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
            disabled={actions.busy}
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
  );
}

/**
 * Kart menüsünün atama/öncelik öğeleri (§8b.8; yalnız `support_requests.assign` ile çizilir): "Ata…" (`UserPlus`),
 * "Bana ata" (`UserCheck`), "Atamayı kaldır" (`UserMinus`), "Öncelik" (`Flag`) grubu — seçili olan `aria-pressed`.
 */
export function AssignMenuItems({ item, actions }: { item: SupportRequestItem; actions: AssignActions }) {
  const { meId, busy } = actions;
  const run: Run = (e, fn) => {
    closeMenu(e.currentTarget);
    fn();
  };
  return (
    <div data-testid="assign-menu" className="flex flex-col">
      <MenuButton testId="assign-open" busy={busy} onClick={(e) => run(e, actions.onOpenAssign)} Icon={UserPlus} label={t("rq.as.open")} />
      {item.assignedTo?.id !== meId && (
        <MenuButton
          testId="assign-me"
          busy={busy}
          onClick={(e) => run(e, () => actions.onAssign(meId))}
          Icon={UserCheck}
          label={t("rq.as.me")}
        />
      )}
      {item.assignedTo && (
        <MenuButton
          testId="assign-clear"
          busy={busy}
          onClick={(e) => run(e, () => actions.onAssign(null))}
          Icon={UserMinus}
          label={t("rq.as.clear")}
        />
      )}
      <PriorityGroup item={item} actions={actions} run={run} />
    </div>
  );
}

/** Atanabilir etkin teknisyenler; arama metni ad içinde (tr küçük harf) aranır. */
async function loadAssignable(q: string, signal: AbortSignal): Promise<ComboOption[]> {
  const r = await api<UserOptionsResponse>("GET", "/users/options?assignable=1", undefined, {
    fetch: (input, init) => fetch(input, { ...init, signal }),
    cookie: () => document.cookie,
  });
  const needle = q.trim().toLocaleLowerCase("tr");
  return r.items
    .filter((u) => u.status === "ACTIVE" && (!needle || u.fullName.toLocaleLowerCase("tr").includes(needle)))
    .map((u) => ({ id: u.id, label: u.fullName }));
}

function AssignFooter({ busy, onCancel, onSubmit }: { busy: boolean; onCancel: () => void; onSubmit: () => void }) {
  return (
    <>
      <Button variant="secondary" onClick={onCancel} disabled={busy} className="sm:ml-auto">
        {t("rq.rj.cancel")}
      </Button>
      <Button loading={busy} data-testid="assign-submit" onClick={onSubmit}>
        {!busy && <UserPlus aria-hidden className="size-4" />}
        {t("rq.as.submit")}
      </Button>
    </>
  );
}

interface AssignDialogProps {
  item: SupportRequestItem | null;
  busy: boolean;
  error: UiError | null;
  onClose: () => void;
  onSubmit: (userId: string) => void;
}

/** Seçili teknisyen ve alan hatası; kapatırken (meşgul değilse) sıfırlanır, seçimsiz gönderim alan hatası verir. */
function useAssignPick(busy: boolean, onClose: () => void, onSubmit: (userId: string) => void) {
  const [value, setValue] = useState<ComboOption | null>(null);
  const [fieldError, setFieldError] = useState<string>();
  const change = (v: ComboOption | null) => {
    setValue(v);
    setFieldError(undefined);
  };
  const close = () => {
    if (busy) return;
    setValue(null);
    setFieldError(undefined);
    onClose();
  };
  const submit = () => {
    if (!value) return setFieldError(t("rq.as.pick"));
    onSubmit(value.id);
  };
  return { value, fieldError, change, close, submit };
}

/** "Ata…" diyaloğu: atanabilir teknisyenler (`GET /users/options?assignable=1`) arasından seçim. */
export function AssignDialog({ item, busy, error, onClose, onSubmit }: AssignDialogProps) {
  const { value, fieldError, change, close, submit } = useAssignPick(busy, onClose, onSubmit);
  return (
    <Dialog
      open={item !== null}
      onClose={close}
      size="sm"
      testId="assign-dialog"
      title={t("rq.as.title")}
      description={item ? t("rq.as.desc", { name: item.customerName ?? t("rq.anon") }) : undefined}
      footer={<AssignFooter busy={busy} onCancel={close} onSubmit={submit} />}
    >
      <div className="flex flex-col gap-3">
        {error && <FormError error={error} />}
        <div>
          <Combobox
            label={t("rq.as.tech")}
            value={value}
            onChange={change}
            load={loadAssignable}
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
