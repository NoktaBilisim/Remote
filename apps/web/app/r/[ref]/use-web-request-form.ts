"use client";

import type { CreateRequestResponse, WebFormInfo } from "@remote/contracts/api/requests";
import { useEffect, useRef, useState } from "react";
import type { UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import { emptyDraft, newClientInstanceId, remainingDelay, submitFailure, type FormDraft } from "@/lib/web-request/flow";
import type { WebRequestSource } from "@/lib/web-request/source";

export interface WebRequestFormProps {
  /** P21 K-P21-2: veri kaynağı adaptörü (`/r/` herkese açık uçlar ya da portal uçları). */
  source: WebRequestSource;
  info: WebFormInfo;
  issuedAt: number;
  refreshInfo: () => Promise<WebFormInfo | null>;
  onCreated: (r: CreateRequestResponse, customerName: string) => void;
  onNotFound: () => void;
}

/** Formda alanı olmayan hata (ref, token, aydınlatma metni kimliği…) genel mesaja yansır; aksi kullanıcı takılır. */
const SHOWN = new Set(["customerName", "phone", "email", "description", "consent"]);
const fieldlessError = (errs: Record<string, string>): string | undefined => Object.entries(errs).find(([k]) => !SHOWN.has(k))?.[1];
const fixError = (errs: Record<string, string>): UiError => ({ message: fieldlessError(errs) ?? t("wr.fixErrors"), tone: "danger" });

type Failure = ReturnType<typeof submitFailure>["failure"];
const failureMessage = (f: Exclude<Failure, { kind: "fields" | "notFound" }>): string =>
  f.kind === "busy" ? t("wr.busy") : f.kind === "fast" ? t("wr.fast") : f.message;

interface FailureSink {
  setErrors: (e: Record<string, string>) => void;
  setFormErr: (e: UiError) => void;
  onNotFound: () => void;
}

/** Sunucu hatasını forma yansıtır (404 → bulunamadı ekranı); `true` → yeni token alınmalı. */
function applyFailure(err: unknown, sink: FailureSink): boolean {
  const { failure, refreshToken } = submitFailure(err, t("err.network"));
  if (failure.kind === "notFound") {
    sink.onNotFound();
    return false;
  }
  if (failure.kind === "fields") {
    sink.setErrors(failure.fields);
    sink.setFormErr(fixError(failure.fields));
  } else sink.setFormErr({ message: failureMessage(failure), tone: "danger" });
  return refreshToken;
}

/** 2 sn sayacı: her yeni token'la (issuedAt) yeniden kurulur. */
function useSubmitWait(issuedAt: number, minDelayMs: number): number {
  const [wait, setWait] = useState(() => remainingDelay(issuedAt, Date.now(), minDelayMs));
  useEffect(() => {
    const tick = () => setWait(remainingDelay(issuedAt, Date.now(), minDelayMs));
    tick();
    const h = setInterval(tick, 250);
    return () => clearInterval(h);
  }, [issuedAt, minDelayMs]);
  return wait;
}

/**
 * Web talep formu durumu ve gönderimi: taslak, alan/genel hata, meşgul, 2 sn bekleme. 4xx/429/503 sonrası yeni token
 * (`refreshInfo`); 404 → bulunamadı ekranı.
 */
export function useWebRequestForm({ source, info, issuedAt, refreshInfo, onCreated, onNotFound }: WebRequestFormProps) {
  const [d, setD] = useState<FormDraft>(() => ({ ...emptyDraft(), ...source.initialDraft }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const wait = useSubmitWait(issuedAt, info.minDelayMs);
  const instance = useRef<string>("");
  const set = (p: Partial<FormDraft>) => setD((x) => ({ ...x, ...p }));
  const retentionShown = Number.isInteger(info.chatRetentionDays) && info.chatRetentionDays > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !retentionShown) return;
    instance.current ||= newClientInstanceId();
    const { body, errors: errs } = source.build(d, instance.current, info);
    setErrors(errs);
    setFormErr(null);
    if (!body) return setFormErr(fixError(errs));
    if (remainingDelay(issuedAt, Date.now(), info.minDelayMs) > 0) return setFormErr({ message: t("wr.fast"), tone: "danger" });
    setBusy(true);
    try {
      const r = await source.create(body);
      onCreated(r, body.customerName);
    } catch (err) {
      if (source.onGateError?.(err)) return;
      if (applyFailure(err, { setErrors, setFormErr, onNotFound })) await refreshInfo();
    } finally {
      setBusy(false);
    }
  };
  return { d, set, errors, formErr, busy, wait, retentionShown, submit };
}
