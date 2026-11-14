"use client";

import type { SessionListItem } from "@remote/contracts/api/sessions";
import { CircleX, Copy, Monitor, Power, Timer } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/badge";
import { CodeDisplay } from "@/components/ui/code-display";
import { useToast } from "@/components/ui/toast";
import { formatRemaining, formatSessionCode, formatTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { copyText, useNow } from "@/lib/use-now";
import { WaitingBadge } from "./waiting-badge";

interface Props {
  items: SessionListItem[];
  showTechnician: boolean;
  canCancel: boolean;
  onCancel: (s: SessionListItem) => void;
  /** P4: konsol yalnız oturumun teknisyenine (AC-15); zorla sonlandırma sessions.terminate (AC-114). */
  meId: string;
  canTerminate: boolean;
  onTerminate: (s: SessionListItem) => void;
  /** Firma seçmemiş Super Admin: konsol bağlantısı yok, lobi rozeti bilgi amaçlı (AC-310). */
  pickTenant?: boolean;
}

const dangerBtn =
  "inline-flex size-11 cursor-pointer items-center justify-center rounded-md text-danger transition-transform duration-150 ease-out hover:bg-danger-surface active:scale-[0.97]";
const iconBtn =
  "inline-flex size-11 cursor-pointer items-center justify-center rounded-md text-fg-muted transition-transform duration-150 ease-out hover:bg-surface-muted hover:text-fg active:scale-[0.97]";

/** Oturum listesi: ≥ md tablo, dar ekranda kart listesi (aynı veri, aynı eylemler). */
export function SessionList({ items, showTechnician, canCancel, onCancel, meId, canTerminate, onTerminate, pickTenant = false }: Props) {
  const now = useNow();
  const toast = useToast();

  const remaining = (s: SessionListItem) => {
    if (s.status !== "PENDING") return null;
    if (now === null) return "—";
    return t("s.left", { time: formatRemaining(Date.parse(s.expiresAt) - now) });
  };
  const copy = async (code: string) => {
    const ok = await copyText(code);
    toast(ok ? t("toast.copied") : t("toast.copyFailed"), ok ? "success" : "danger");
  };
  const actions = (s: SessionListItem) => {
    const pending = s.status === "PENDING" && (now === null || Date.parse(s.expiresAt) > now);
    const open = pending || s.status === "ACTIVE";
    // Firma seçmemiş Super Admin konsola giremez (tenantScope 403) → bağlantı yok (a71d80e, AC-310)
    const mine = s.technician.id === meId && !pickTenant;
    const terminate = s.status === "ACTIVE" && canTerminate;
    if (!pending && !(open && mine) && !terminate) return null;
    const code = s.code ? formatSessionCode(s.code) : "";
    return (
      <div className="flex justify-end gap-1">
        {open && mine && (
          <Link href={`/sessions/${s.id}/console`} className={iconBtn} aria-label={t("s.openConsole")} title={t("s.openConsole")} data-testid="open-console">
            <Monitor aria-hidden className="size-4" />
          </Link>
        )}
        {pending && s.code && (
          <button type="button" className={iconBtn} aria-label={t("s.copyCode", { code })} onClick={() => copy(s.code!)}>
            <Copy aria-hidden className="size-4" />
          </button>
        )}
        {pending && canCancel && (
          <button type="button" className={iconBtn} aria-label={t("s.cancelRow", { code })} onClick={() => onCancel(s)}>
            <CircleX aria-hidden className="size-4" />
          </button>
        )}
        {terminate && (
          <button type="button" className={dangerBtn} aria-label={t("s.terminateRow", { name: s.technician.name })} title={t("st.action")} onClick={() => onTerminate(s)} data-testid="terminate">
            <Power aria-hidden className="size-4" />
          </button>
        )}
      </div>
    );
  };
  /**
   * P13b-L (AC-304/305/309/310): PENDING satırda lobi rozeti yuvası (n = 0 iken görünmez, yer kaymaz). Bağlantı yalnız
   * kendi oturumumda ve firma bağlamı varken ("Konsolu aç" ile aynı koşul, V-L7).
   */
  const waiting = (s: SessionListItem) =>
    s.status === "PENDING" ? (
      <WaitingBadge n={s.waitingGuests} href={s.technician.id === meId && !pickTenant ? `/sessions/${s.id}/console` : undefined} />
    ) : null;
  const timeCell = (s: SessionListItem) => {
    const r = remaining(s);
    return r ? (
      <span className="inline-flex items-center gap-1.5 tabular-nums text-fg">
        <Timer aria-hidden className="size-4 text-fg-muted" />
        {r}
      </span>
    ) : (
      <span className="text-fg-muted">—</span>
    );
  };

  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface md:block">
        <table className="w-full text-left text-sm" data-testid="sessions-table">
          <thead className="bg-surface-muted text-xs text-fg-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">{t("s.col.status")}</th>
              <th scope="col" className="px-4 py-3 font-medium">{t("s.col.code")}</th>
              {showTechnician && <th scope="col" className="px-4 py-3 font-medium">{t("s.col.tech")}</th>}
              <th scope="col" className="px-4 py-3 font-medium">{t("s.col.created")}</th>
              <th scope="col" className="px-4 py-3 font-medium">{t("s.col.time")}</th>
              <th scope="col" className="px-4 py-3 font-medium"><span className="sr-only">{t("s.col.actions")}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((s) => (
              <tr key={s.id} data-testid="session-row">
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <StatusBadge status={s.status} />
                    {waiting(s)}
                  </div>
                </td>
                <td className="px-4 py-2">{s.code ? <CodeDisplay code={s.code} size="sm" /> : <span className="text-fg-muted">—</span>}</td>
                {showTechnician && <td className="px-4 py-2 text-fg">{s.technician.name}</td>}
                <td className="px-4 py-2 tabular-nums text-fg">{formatTime(s.createdAt)}</td>
                <td className="px-4 py-2">{timeCell(s)}</td>
                <td className="px-2 py-1">{actions(s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-2 md:hidden" data-testid="sessions-cards">
        {items.map((s) => (
          <li key={s.id} data-testid="session-card" className="rounded-lg border border-border bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <StatusBadge status={s.status} />
              <span className="text-xs tabular-nums text-fg-muted">
                {t("s.col.created")}: {formatTime(s.createdAt)}
              </span>
            </div>
            {s.status === "PENDING" && <div className="mt-1 flex">{waiting(s)}</div>}
            {(s.status === "PENDING" || s.status === "ACTIVE" || showTechnician) && (
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-1 text-sm">
                  {s.code && <CodeDisplay code={s.code} size="sm" />}
                  {showTechnician && <span className="truncate text-fg-muted">{s.technician.name}</span>}
                  {s.status === "PENDING" && timeCell(s)}
                </div>
                {actions(s)}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
