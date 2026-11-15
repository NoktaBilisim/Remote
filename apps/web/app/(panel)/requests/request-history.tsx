"use client";

import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import type { SupportRequestItem } from "@/lib/requests/contract";
import { CardMenuDialogs, useCardMenus } from "./card-dialogs";
import { RequestCard } from "./request-card";

/** Geçmiş sekmesi kartları (P8b) + P8c r2: kart menüsünden kayıt iptali (§15.2; kuyruk ve Geçmiş). */
export function RequestHistory({
  items,
  canRevoke,
  canBlock = false,
}: {
  items: SupportRequestItem[];
  canRevoke: boolean;
  /** P15 (AC-235): "Bu kaynağı engelle" kısayolu. */
  canBlock?: boolean;
}) {
  const router = useRouter();
  const menus = useCardMenus();
  return (
    <>
      <ol className="flex flex-col gap-4" aria-label={t("rq.tab.history")}>
        {items.map((it) => (
          <li key={it.id}>
            <RequestCard
              item={it}
              onRevokeBinding={canRevoke ? () => menus.setRevoking(it) : undefined}
              onBlock={canBlock ? () => menus.setBlocking(it) : undefined}
            />
          </li>
        ))}
      </ol>
      <CardMenuDialogs menus={menus} onRefresh={() => router.refresh()} />
    </>
  );
}
