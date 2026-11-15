"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { auditHref, rangeError, type AuditFilters } from "@/lib/audit/query";
import { t } from "@/lib/i18n";

export type Draft = Record<"from" | "to" | "tenantId" | "userId" | "action" | "result", string>;
type RangeErrors = Partial<Record<"from" | "to", string>>;

const toDraft = (f: AuditFilters): Draft => ({
  from: f.from ?? "",
  to: f.to ?? "",
  tenantId: f.tenantId ?? "",
  userId: f.userId ?? "",
  action: f.action ?? "",
  result: f.result ?? "",
});

/** `rangeError` sonucunu alan hatasına çevirir (biçim → hatalı alan, sıra → bitiş, aralık → başlangıç). */
const rangeErrors = (err: NonNullable<ReturnType<typeof rangeError>>, from: string): RangeErrors =>
  err === "date"
    ? { [from && !/^\d{4}-\d{2}-\d{2}$/.test(from) ? "from" : "to"]: t("h.v.date") }
    : err === "order"
      ? { to: t("h.v.dateOrder") }
      : { from: t("au.v.range") };

/**
 * /audit filtre durumu (AC-76): taslak URL'den başlar; tarih aralığı sunucu kuralıyla aynı denetlenir
 * (başlangıç ≤ bitiş, ≤ 731 gün) — geçersizse istek atılmaz. Temizle her şeyi sıfırlar.
 */
export function useAuditFilters(filters: AuditFilters, today: string) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => toDraft(filters));
  const [errors, setErrors] = useState<RangeErrors>({});
  const [pending, start] = useTransition();

  const set = (k: keyof Draft) => (e: { target: { value: string } }) => {
    setDraft((d) => ({ ...d, [k]: e.target.value }));
    if (k === "from" || k === "to") setErrors({});
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const err = rangeError(draft.from || undefined, draft.to || undefined, today);
    if (err) {
      setErrors(rangeErrors(err, draft.from));
      return;
    }
    const next = Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== "")) as AuditFilters;
    start(() => router.push(auditHref(next)));
  };
  const clear = () => {
    setDraft(toDraft({}));
    setErrors({});
    start(() => router.push(auditHref({})));
  };
  return { draft, errors, pending, set, submit, clear };
}

export type AuditFilterState = ReturnType<typeof useAuditFilters>;
