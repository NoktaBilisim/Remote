"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { markSelfAssigned } from "@/components/request-notifier";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import type { AcceptResult, SupportRequestItem } from "@/lib/requests/contract";
import { consolePath, requestErrorMessage } from "@/lib/requests/errors";
import { withP18Defaults, type RequestPriority } from "@/lib/requests/p18";
import { acceptedHere } from "./use-request-queue";

/* RequestQueue kabul / atama / öncelik eylemleri — PT-K13: bileşenden çıkarıldı; istek ve durum sırası aynı. */

/** Kabul (AC-149) + reddet diyaloğu durumu + K-P18-3: başkasına atanmış talep kabul edilebilir ama önce onay istenir. */
export function useAcceptFlow(meId: string, drop: (id: string) => void) {
  const router = useRouter();
  const toast = useToast();
  const [confirmAccept, setConfirmAccept] = useState<SupportRequestItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<SupportRequestItem | null>(null);
  const accept = async (it: SupportRequestItem) => {
    setConfirmAccept(null);
    setBusyId(it.id);
    try {
      const r = await api<AcceptResult>("POST", `/support-requests/${it.id}/accept`, {});
      acceptedHere.add(it.id);
      router.push(consolePath(r));
    } catch (e) {
      setBusyId(null);
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      toast(requestErrorMessage(e), "danger", { durationMs: 6000 });
      if (e instanceof ApiError && (e.code === "REQUEST_TAKEN" || e.code === "REQUEST_CLOSED" || e.status === 404)) drop(it.id);
    }
  };
  const requestAccept = (it: SupportRequestItem) => {
    if (it.assignedTo && it.assignedTo.id !== meId) setConfirmAccept(it);
    else void accept(it);
  };
  return { confirmAccept, setConfirmAccept, busyId, accept, requestAccept, rejecting, setRejecting };
}

/** 400 `fields.userId` (seçilen kullanıcı atanamaz) → alan mesajı; diğer hatalarda null. */
const userIdError = (e: unknown): UiError | null =>
  e instanceof ApiError && e.status === 400 && e.fields?.userId
    ? { message: e.fields.userId, tone: "danger", requestId: e.requestId }
    : null;

/** Atama / öncelik ortak hata yolu: kapanmış talep düşer, diğerleri gösterilecek hata (oturum düştüyse null). */
function useAssignFailed(drop: (id: string) => void) {
  const router = useRouter();
  const toast = useToast();
  return (it: SupportRequestItem, e: unknown): UiError | null => {
    if (isUnauthenticated(e)) {
      router.replace(EXPIRED_LOGIN_PATH);
      return null;
    }
    if (e instanceof ApiError && (e.code === "REQUEST_CLOSED" || e.status === 404)) {
      drop(it.id);
      toast(t("rq.err.closed"), "danger");
      return null;
    }
    return toUiError(e);
  };
}

/** Öncelik değiştirme (AC-257): başarıda toast, hatada `assignFailed` yolu. */
function usePriority(
  setAssignBusy: (id: string | null) => void,
  assignFailed: ReturnType<typeof useAssignFailed>,
  replace: (next: SupportRequestItem) => void,
) {
  const toast = useToast();
  return async (it: SupportRequestItem, priority: RequestPriority) => {
    setAssignBusy(it.id);
    try {
      const next = await api<SupportRequestItem>("POST", `/support-requests/${it.id}/priority`, { priority });
      replace(withP18Defaults(next));
      toast(t("rq.p.done"));
    } catch (e) {
      const ui = assignFailed(it, e);
      if (ui) toast(ui.message, "danger", { durationMs: 6000 });
    } finally {
      setAssignBusy(null);
    }
  };
}

/** Atama (AC-256) ve öncelik (AC-257): kart menüsünden toast, "Ata…" diyaloğundan diyalog içi hata. */
export function useAssignFlow(meId: string, drop: (id: string) => void, replace: (next: SupportRequestItem) => void) {
  const toast = useToast();
  const assignFailed = useAssignFailed(drop);
  const [assigning, setAssigning] = useState<SupportRequestItem | null>(null);
  const [assignBusy, setAssignBusy] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<UiError | null>(null);
  const assignTo = async (it: SupportRequestItem, userId: string | null, fromDialog = false) => {
    setAssignBusy(it.id);
    setAssignError(null);
    if (userId && userId === meId) markSelfAssigned(it.id);
    try {
      const next = await api<SupportRequestItem>("POST", `/support-requests/${it.id}/assign`, { userId });
      replace(withP18Defaults(next));
      if (fromDialog) setAssigning(null);
      toast(userId === null ? t("rq.as.cleared") : t("rq.as.done", { name: next.assignedTo?.name ?? "" }));
    } catch (e) {
      const ui = assignFailed(it, e);
      const shown = ui && (userIdError(e) ?? ui);
      if (shown) {
        if (fromDialog) setAssignError(shown);
        else toast(shown.message, "danger", { durationMs: 6000 });
      } else if (fromDialog) setAssigning(null);
    } finally {
      setAssignBusy(null);
    }
  };
  const setPriority = usePriority(setAssignBusy, assignFailed, replace);
  return { assigning, setAssigning, assignBusy, assignError, setAssignError, assignTo, setPriority };
}
