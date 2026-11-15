"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { SwitchTenantResponse, TenantItem } from "@/lib/users/contract";
import { StatusPill } from "../../users/user-list";
import { TenantFormDialog } from "./tenant-form-dialog";
import { NameCell, PurgeBadge, TenantActions, type Action } from "./tenant-row-parts";
import { StatusDialog } from "./tenant-status-dialog";

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

/** "Bu firmaya geç": istek sürerken tüm geçiş düğmeleri pasif; hata/başarıda liste yenilenir. */
function useSwitchTenant() {
  const router = useRouter();
  const toast = useToast();
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
  return { switching, onSwitch: (x: TenantItem) => void switchTo(x) };
}

type ViewProps = {
  items: TenantItem[];
  actingId: string | null;
  switching: string | null;
  onSwitch: (x: TenantItem) => void;
  onAction: (a: Action) => void;
};

const COLS = [
  ["tn.col.name", "px-3 py-3 font-medium"],
  ["tn.col.slug", "px-3 py-3 font-medium"],
  ["tn.col.users", "px-3 py-3 text-right font-medium"],
  ["tn.col.created", "px-3 py-3 font-medium"],
  ["tn.col.status", "px-3 py-3 font-medium"],
  ["tn.col.actions", "px-3 py-3 font-medium"],
] as const;

function TenantTable({ items, ...rest }: ViewProps) {
  return (
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
            {COLS.map(([k, cls]) => (
              <th key={k} scope="col" className={cls}>
                {t(k)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((x) => (
            <TenantRow key={x.id} x={x} {...rest} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TenantRow({ x, ...rest }: Omit<ViewProps, "items"> & { x: TenantItem }) {
  return (
    <tr data-testid="tenant-row" className="hover:bg-surface-muted">
      <td className="max-w-72 px-3 py-2">
        <NameCell x={x} actingId={rest.actingId} />
      </td>
      <td className="px-3 py-2 font-mono text-xs text-fg">{x.slug}</td>
      <td className="px-3 py-2 text-right tabular-nums text-fg">{formatNumber(x.activeUserCount)}</td>
      <td className="px-3 py-2 whitespace-nowrap tabular-nums text-fg">{formatDateTime(x.createdAt)}</td>
      <td className="px-3 py-2">
        <span className="flex flex-col items-start gap-1">
          <StatusPill status={x.status} testId="tenant-status" />
          {x.purge && <PurgeBadge purge={x.purge} />}
        </span>
      </td>
      <td className="px-3 py-2">
        <TenantActions x={x} {...rest} />
      </td>
    </tr>
  );
}

function TenantCards({ items, ...rest }: ViewProps) {
  return (
    <ul className="flex flex-col gap-2 md:hidden" data-testid="tenants-cards">
      {items.map((x) => (
        <li key={x.id} data-testid="tenant-card" className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <NameCell x={x} actingId={rest.actingId} />
            </div>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <StatusPill status={x.status} testId="tenant-status" />
              {x.purge && <PurgeBadge purge={x.purge} />}
            </span>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-fg-muted">{t("tn.col.slug")}</dt>
            <dd className="font-mono text-fg">{x.slug}</dd>
            <dt className="text-fg-muted">{t("tn.col.users")}</dt>
            <dd className="tabular-nums text-fg">{formatNumber(x.activeUserCount)}</dd>
          </dl>
          <TenantActions x={x} {...rest} />
        </li>
      ))}
    </ul>
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
  const sw = useSwitchTenant();
  const view: ViewProps = { items, actingId, switching: sw.switching, onSwitch: sw.onSwitch, onAction: setAction };
  return (
    <>
      <TenantTable {...view} />
      <TenantCards {...view} />
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
