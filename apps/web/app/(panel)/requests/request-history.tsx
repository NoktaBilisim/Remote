"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import { t } from "@/lib/i18n";
import type { SupportRequestItem } from "@/lib/requests/contract";
import { RequestCard } from "./request-card";
import { RevokeBindingDialog } from "./revoke-binding-dialog";

/** Geçmiş sekmesi kartları (P8b) + P8c r2: kart menüsünden kayıt iptali (§15.2; kuyruk ve Geçmiş). */
export function RequestHistory({ items, canRevoke }: { items: SupportRequestItem[]; canRevoke: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [revoking, setRevoking] = useState<SupportRequestItem | null>(null);
  return (
    <>
      <ol className="flex flex-col gap-4" aria-label={t("rq.tab.history")}>
        {items.map((it) => (
          <li key={it.id}>
            <RequestCard item={it} onRevokeBinding={canRevoke ? () => setRevoking(it) : undefined} />
          </li>
        ))}
      </ol>
      <RevokeBindingDialog
        item={revoking}
        onClose={() => setRevoking(null)}
        onDone={() => {
          setRevoking(null);
          toast(t("rq.revoke.done"));
          router.refresh();
        }}
        onGone={(_id, message) => {
          setRevoking(null);
          toast(message, "danger");
          router.refresh();
        }}
      />
    </>
  );
}
