"use client";

import { useState } from "react";
import { RequestBlockDialog } from "@/components/request-blocks/block-dialogs";
import { useToast } from "@/components/ui/toast";
import { t } from "@/lib/i18n";
import type { SupportRequestItem } from "@/lib/requests/contract";
import { RevokeBindingDialog } from "./revoke-binding-dialog";

/** Kart menüsü diyaloglarının durumu (kuyruk ve Geçmiş ortak; PT-K13 klon birleştirme): engelle, kaydı iptal et. */
export function useCardMenus() {
  const [revoking, setRevoking] = useState<SupportRequestItem | null>(null);
  const [blocking, setBlocking] = useState<SupportRequestItem | null>(null);
  return { revoking, setRevoking, blocking, setBlocking };
}
type CardMenus = ReturnType<typeof useCardMenus>;

/**
 * "Bu kaynağı engelle" (P15, AC-235) + "Bu bilgisayarın kaydını iptal et" (P8c r2 §15.2) diyalogları. İptal sonrası
 * `onRemoved` (kuyruk: kart düşer) → toast → `onRefresh`; talep gitmişse toast → `onRefresh`.
 */
export function CardMenuDialogs({
  menus,
  onRemoved,
  onRefresh,
}: {
  menus: CardMenus;
  onRemoved?: (id: string) => void;
  onRefresh: () => void;
}) {
  const toast = useToast();
  const { blocking, setBlocking, setRevoking } = menus;
  return (
    <>
      <RequestBlockDialog
        request={blocking ? { id: blocking.id, name: blocking.customerName ?? t("rq.anon") } : null}
        onClose={() => setBlocking(null)}
        onSaved={() => {
          setBlocking(null);
          toast(t("bl.rq.done"));
        }}
      />
      <RevokeBindingDialog
        item={menus.revoking}
        onClose={() => setRevoking(null)}
        onDone={(id) => {
          setRevoking(null);
          onRemoved?.(id);
          toast(t("rq.revoke.done"));
          onRefresh();
        }}
        onGone={(_id, message) => {
          setRevoking(null);
          toast(message, "danger");
          onRefresh();
        }}
      />
    </>
  );
}
