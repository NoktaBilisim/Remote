"use client";

import type { TechRosterEntry } from "@remote/contracts/ws-multi";
import { UserX, Users, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { t } from "@/lib/i18n";
import { joinedSince, ROLE_LABEL_KEY, sortedRoster } from "@/lib/multi/roster";

/** Yeni katılan teknisyen bildirimi (3 sn, mimari-p28c §10): ilk roster bildirim üretmez. */
function useJoinNotice(roster: readonly TechRosterEntry[]) {
  const [notice, setNotice] = useState<string | null>(null);
  const [prev, setPrev] = useState<readonly TechRosterEntry[] | null>(null);
  if (prev !== roster) {
    const fresh = joinedSince(prev, roster);
    setPrev(roster);
    if (fresh.length) setNotice(fresh.map((e) => t("mt.g.joined", { name: e.name, role: t(ROLE_LABEL_KEY[e.role]) })).join(" · "));
  }
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 3_000);
    return () => clearTimeout(id);
  }, [notice]);
  return notice;
}

/**
 * Müşteri sayfası "Bağlı teknisyenler" (mimari-p28c §5.3, §10; AC-366): ad + rol (+ "Oturum sahibi"); sahip dışındakilerde
 * "Çıkar" (onay, odak Vazgeç). Çizim sonrası `onDrawn` → eş haritası yalnız ekranda adı görünen teknisyenin teklifini yanıtlar
 * (Y-PC-4, gizli izleyici yok).
 */
export function TechsList({
  roster,
  onRemove,
  onDrawn,
}: {
  roster: readonly TechRosterEntry[];
  onRemove: (tid: string) => void;
  onDrawn: (tids: string[]) => void;
}) {
  const [confirm, setConfirm] = useState<TechRosterEntry | null>(null);
  const notice = useJoinNotice(roster);
  const list = sortedRoster(roster);
  const drawnRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    // DOM'a gerçekten basılmış satırlar (gizli izleyici yok): yalnız görünen tid'ler bildirilir
    const tids = [...(drawnRef.current?.querySelectorAll<HTMLElement>("[data-tid]") ?? [])].map((el) => el.dataset.tid ?? "");
    onDrawn(tids.filter(Boolean));
  }, [roster, onDrawn]);
  return (
    <section
      aria-labelledby="mt-g-t"
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 shadow-sm"
      data-testid="guest-techs"
    >
      <h2 id="mt-g-t" className="flex items-center gap-2 text-base font-semibold text-fg">
        <Users aria-hidden className="size-5 text-fg-muted" />
        {t("mt.g.title")}
      </h2>
      <p role="status" className="text-sm text-primary empty:hidden" data-testid="guest-techs-notice">
        {notice ?? ""}
      </p>
      <ul ref={drawnRef} className="flex flex-col gap-2">
        {list.map((e) => (
          <li key={e.tid} data-tid={e.tid} className="flex items-center gap-3" data-testid="guest-tech">
            <Avatar name={e.name} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fg">{e.name}</p>
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                <span>{t(ROLE_LABEL_KEY[e.role])}</span>
                {e.owner && <span className="rounded-full bg-primary-surface px-2 py-0.5 font-medium text-primary">{t("mt.owner")}</span>}
                {!e.connected && (
                  <span className="inline-flex items-center gap-1 text-danger">
                    <WifiOff aria-hidden className="size-3.5" />
                    {t("mt.offline")}
                  </span>
                )}
              </p>
            </div>
            {!e.owner && (
              <Button
                variant="danger-ghost"
                onClick={() => setConfirm(e)}
                aria-label={t("mt.g.removeRow", { name: e.name })}
                data-testid="guest-tech-remove"
              >
                <UserX aria-hidden className="size-4" />
                {t("mt.g.remove")}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={t("mt.g.removeTitle", { name: confirm?.name ?? "" })}
        description={t("mt.g.removeBody")}
        size="sm"
        role="alertdialog"
        testId="guest-remove-confirm"
        footer={
          <>
            <Button variant="secondary" data-autofocus onClick={() => setConfirm(null)} className="sm:ml-auto">
              {t("mt.keep")}
            </Button>
            <Button
              variant="danger"
              data-testid="guest-remove-ok"
              onClick={() => {
                if (confirm) onRemove(confirm.tid);
                setConfirm(null);
              }}
            >
              <UserX aria-hidden className="size-4" />
              {t("mt.g.remove")}
            </Button>
          </>
        }
      />
    </section>
  );
}
