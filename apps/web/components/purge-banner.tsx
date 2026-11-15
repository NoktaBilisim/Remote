"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { PURGE_BANNER_POLL_MS, TENANT_PURGE_OPEN_STATES, type PurgeJobItem, type PurgeJobsResponse } from "@/lib/tenants/purge";
import { deletedTenantLabel } from "@remote/contracts/audit";

const isOpen = (j: PurgeJobItem) => (TENANT_PURGE_OPEN_STATES as readonly string[]).includes(j.state);

/**
 * Super Admin silme bandı (P16, AC-242; mimari-e11 §7.3, §7.8). Açık (SCHEDULED/RUNNING/FAILED) firma silme işi varken
 * panelin her sayfasında kapatılamayan `role="alert"` uyarı bandı + iş başına iptal/durum bağlantısı. İlk değer sunucuda
 * (layout, flaşsız); sonra `GET /admin/purge-jobs?open=1` 60 sn yoklama. Hatalar sessiz (son değer korunur); 401/403 durur.
 * Sayfa `router.refresh()` yapınca (iptal, zamanlama) sunucudan gelen yeni ilk değer bandı hemen günceller.
 */
export function PurgeBanner({ initial }: { initial: PurgeJobItem[] }) {
  const [items, setItems] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setItems(initial);
  }

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const r = await api<PurgeJobsResponse>("GET", "/admin/purge-jobs?open=1");
        if (!stopped) setItems(r.items);
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) stopped = true;
      }
    };
    const id = setInterval(() => {
      if (!stopped) void tick();
    }, PURGE_BANNER_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  const open = items.filter(isOpen);
  if (open.length === 0) return null;
  return (
    <section
      role="alert"
      aria-label={t("pb.label")}
      data-testid="purge-banner"
      className="mb-4 flex items-start gap-3 rounded-md border border-warning/30 bg-warning-surface px-3 py-2 text-sm text-fg"
    >
      <TriangleAlert aria-hidden className="mt-3 size-4 shrink-0 text-warning" />
      <ul className="flex min-w-0 flex-1 flex-col">
        {open.map((j) => {
          const name = j.tenantName ?? deletedTenantLabel(j.tenantId);
          const msg =
            j.state === "SCHEDULED"
              ? t("pb.scheduled", { name, at: formatDateTime(j.scheduledFor) })
              : t(j.state === "RUNNING" ? "pb.running" : "pb.failed", { name });
          const label = t(j.state === "SCHEDULED" ? "pb.cancel" : "pb.view");
          return (
            <li key={j.jobId} className="flex flex-wrap items-center gap-x-3" data-testid="purge-banner-item" data-state={j.state}>
              <span className="min-w-0 py-2 break-words">{msg}</span>
              <Link
                href={`/admin/tenants/${j.tenantId}#purge`}
                className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2 hover:no-underline"
                aria-label={`${label}: ${name}`}
                data-testid="purge-banner-link"
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
