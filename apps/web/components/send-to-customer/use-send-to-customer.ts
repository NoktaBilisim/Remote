"use client";

import type { SendTarget } from "@remote/contracts/api/customer-send";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { useToast } from "@/components/ui/toast";
import { EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import {
  canSend,
  checkRecipient,
  fetchSendOptions,
  initialSendState,
  maskRecipient,
  postCustomerSend,
  recipientKind,
  sendFailure,
  sendReducer,
} from "@/lib/customer-send";
import { toUiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import { useNow } from "@/lib/use-now";

/**
 * LG-3 diyalog mantığı (mimari-link-gonderme §9): açılışta `POST /customer-send/options`, gönderimde
 * `POST /customer-send`. Durum makinesi `lib/customer-send.ts` içinde (birim testli); burada yalnız yan etkiler.
 */
export function useSendToCustomer(target: SendTarget) {
  const router = useRouter();
  const toast = useToast();
  const [s, dispatch] = useReducer(sendReducer, initialSendState);
  const now = useNow();
  // Çağıranlar hedefi satır içi nesne olarak verir; kimlik değişimi yeniden yükleme tetiklemesin.
  const targetRef = useRef(target);
  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  useEffect(() => {
    if (s.rateUntil !== null && now !== null && now >= s.rateUntil) dispatch({ type: "rateOver" });
  }, [now, s.rateUntil]);

  const load = useCallback(async () => {
    dispatch({ type: "load" });
    try {
      dispatch({ type: "loaded", options: await fetchSendOptions(targetRef.current) });
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      dispatch({ type: "loadFailed", message: toUiError(e).message });
    }
  }, [router]);

  /** Geçersiz alıcıda false döner (çağıran alana odak taşır). */
  const send = async (): Promise<boolean> => {
    if (!canSend(s) || !s.channel) return true;
    const channel = s.channel;
    const chk = checkRecipient(s.to[recipientKind(channel)], channel);
    if (!chk.to) {
      dispatch({ type: "invalid", message: chk.error ?? t("v.required") });
      return false;
    }
    dispatch({ type: "sending" });
    try {
      await postCustomerSend(targetRef.current, channel, chk.to);
      const message = t("customerSend.sent", { channel: t(`customerSend.ch.${channel}`), to: maskRecipient(chk.to) });
      dispatch({ type: "sent", message });
      toast(message);
      return true;
    } catch (e) {
      if (isUnauthenticated(e)) {
        router.replace(EXPIRED_LOGIN_PATH);
        return true;
      }
      const failure = sendFailure(e);
      dispatch({ type: "failed", failure, now: Date.now() });
      return failure.kind !== "field";
    }
  };

  const waitMs = s.rateUntil === null || now === null ? 0 : s.rateUntil - now;
  return { s, dispatch, load, send, waitMs };
}
