"use client";

import { Archive, ArchiveRestore, ArrowRightLeft, Building, CalendarX2, Check, CircleAlert, PenLine, Trash2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { TenantPurgeBadge } from "@/lib/tenants/purge";
import type { TenantItem } from "@/lib/users/contract";

export type Action = { kind: "edit" | "deactivate" | "reactivate"; tenant: TenantItem };

/** Satır eylemleri: Düzenle, Bu firmaya geç (aktif ve etkin olmayan), Pasife al / Yeniden etkinleştir. */
export function TenantActions({
  x,
  actingId,
  switching,
  onSwitch,
  onAction,
}: {
  x: TenantItem;
  actingId: string | null;
  switching: string | null;
  onSwitch: (x: TenantItem) => void;
  onAction: (a: Action) => void;
}) {
  const active = x.status === "ACTIVE";
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="secondary"
        onClick={() => onAction({ kind: "edit", tenant: x })}
        aria-label={t("tn.editFor", { name: x.name })}
        data-testid="tenant-edit"
      >
        <PenLine aria-hidden className="size-4" />
        <span aria-hidden>{t("tn.edit")}</span>
      </Button>
      {active && x.id !== actingId && (
        <Button
          variant="secondary"
          loading={switching === x.id}
          disabled={switching !== null}
          onClick={() => onSwitch(x)}
          aria-label={t("tn.switchFor", { name: x.name })}
          data-testid="tenant-switch"
        >
          {switching !== x.id && <ArrowRightLeft aria-hidden className="size-4" />}
          <span aria-hidden>{t("tn.switch")}</span>
        </Button>
      )}
      {active ? (
        <Button
          variant="danger-ghost"
          onClick={() => onAction({ kind: "deactivate", tenant: x })}
          aria-label={t("tn.deactFor", { name: x.name })}
          data-testid="tenant-deactivate"
        >
          <Archive aria-hidden className="size-4" />
          <span aria-hidden>{t("tn.deact")}</span>
        </Button>
      ) : (
        <Button
          variant="secondary"
          onClick={() => onAction({ kind: "reactivate", tenant: x })}
          aria-label={t("tn.rFor", { name: x.name })}
          data-testid="tenant-reactivate"
        >
          <ArchiveRestore aria-hidden className="size-4" />
          <span aria-hidden>{t("tn.r")}</span>
        </Button>
      )}
    </div>
  );
}

/** Firma adı (detay bağlantısı) + etkin firma rozeti. */
export function NameCell({ x, actingId }: { x: TenantItem; actingId: string | null }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Building aria-hidden className="size-4 shrink-0 text-fg-muted" />
      <Link
        href={`/admin/tenants/${x.id}`}
        className="inline-flex min-h-11 min-w-0 items-center truncate font-medium text-primary hover:underline"
        title={x.name}
        data-testid="tenant-link"
      >
        <span className="truncate">{x.name}</span>
      </Link>
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
}

/** P16 (AC-242): firma listesinde silme işi rozeti — "Silinecek: <tarih>" / "Siliniyor" / "Silme başarısız" (metin + ikon). */
export function PurgeBadge({ purge }: { purge: TenantPurgeBadge }) {
  if (purge.state !== "SCHEDULED" && purge.state !== "RUNNING" && purge.state !== "FAILED") return null;
  const failed = purge.state === "FAILED";
  const Icon = purge.state === "SCHEDULED" ? CalendarX2 : failed ? CircleAlert : Trash2;
  const text =
    purge.state === "SCHEDULED"
      ? t("tn.p.badgeScheduled", { at: formatDateTime(purge.scheduledFor) })
      : t(failed ? "tn.p.badgeFailed" : "tn.p.badgeRunning");
  return (
    <span
      data-testid="tenant-purge-badge"
      data-state={purge.state}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
        failed ? "border-danger/30 bg-danger-surface text-danger" : "border-warning/30 bg-warning-surface text-warning"
      }`}
    >
      <Icon aria-hidden className="size-3.5" />
      {text}
    </span>
  );
}
