"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import type { ComboOption } from "@/components/ui/combobox";
import { checkCustomer, historyHref, isCalendarDay, type HistoryFilters } from "@/lib/history/query";
import { t } from "@/lib/i18n";
import { loadTenantOptions, tenantLabelOf } from "@/lib/users/tenant-options";
import { loadUserOptions, techOptions } from "@/lib/users/user-options";

export type Opt = { value: string; label: string };
type Draft = Record<
  "from" | "to" | "status" | "mode" | "source" | "technicianId" | "tenantId" | "customer" | "customerFirm" | "consentMode",
  string
>;
type Errors = Partial<Record<keyof Draft, string>>;
export type FirmMode = "" | "none" | "customer";
type TechState = "idle" | "loading" | "error";

const CUSTOMER_ERR = { short: "h.v.customerShort", long: "h.v.customerLong", chars: "h.v.customerChars" } as const;

/** Sunucu kuralıyla aynı denetim (mimari-api P8 §1); geçersizse istek atılmaz. */
function validateDraft(d: Draft): Errors {
  const e: Errors = {};
  if (d.from && !isCalendarDay(d.from)) e.from = t("h.v.date");
  if (d.to && !isCalendarDay(d.to)) e.to = t("h.v.date");
  if (!e.from && !e.to && d.from && d.to && d.from > d.to) e.to = t("h.v.dateOrder");
  const c = checkCustomer(d.customer).error;
  if (c) e.customer = t(CUSTOMER_ERR[c]);
  return e;
}

const toDraft = (f: HistoryFilters): Draft => ({
  from: f.from ?? "",
  to: f.to ?? "",
  status: f.status ?? "",
  mode: f.mode ?? "",
  consentMode: f.consentMode ?? "",
  source: f.source ?? "",
  technicianId: f.technicianId ?? "",
  tenantId: f.tenantId ?? "",
  customer: f.customer ?? "",
  customerFirm: f.customerFirm ?? "",
});

/** Teknisyen seçenekleri; AC-225: Super Admin firma filtresini değiştirince o firmanın `/users/options?tenantId=` yanıtı. */
function useTechOptions(technicians: Opt[] | null, techniciansError?: boolean) {
  const [techs, setTechs] = useState<Opt[] | null>(technicians);
  const [techState, setTechState] = useState<TechState>(techniciansError ? "error" : "idle");
  const techAbort = useRef<AbortController | null>(null);
  useEffect(() => () => techAbort.current?.abort(), []);
  const reloadTechs = (tenantId: string) => {
    techAbort.current?.abort();
    setTechs([]);
    if (!tenantId) {
      setTechState("idle");
      return;
    }
    const ac = new AbortController();
    techAbort.current = ac;
    setTechState("loading");
    loadUserOptions(tenantId, ac.signal).then(
      (items) => {
        setTechs(techOptions(items));
        setTechState("idle");
      },
      () => {
        if (!ac.signal.aborted) setTechState("error");
      },
    );
  };
  return { techs, techState, reloadTechs };
}

/** Firma (tenant) ve müşteri firma seçicilerinin durumu (URL'deki seçimden başlar). */
function usePickers(filters: HistoryFilters, tenantLabel?: string, customerFirmName?: string) {
  const [tenant, setTenant] = useState<ComboOption | null>(
    filters.tenantId
      ? {
          id: filters.tenantId,
          label: tenantLabel ?? tenantLabelOf(filters.tenantId) ?? t("h.f.selected", { id: filters.tenantId.slice(-6) }),
        }
      : null,
  );
  const loadTenants = useCallback(
    async (q: string, signal: AbortSignal): Promise<ComboOption[]> =>
      (await loadTenantOptions(q, signal)).map((x) => ({
        id: x.id,
        label: x.name,
        hint: x.status === "PASSIVE" ? t("h.f.tenantPassive") : undefined,
      })),
    [],
  );
  const [firmMode, setFirmMode] = useState<FirmMode>(filters.customerFirm === "none" ? "none" : filters.customerFirm ? "customer" : "");
  const [firm, setFirm] = useState<ComboOption | null>(
    filters.customerFirm && filters.customerFirm !== "none"
      ? { id: filters.customerFirm, label: customerFirmName ?? t("rq.cf.selected") }
      : null,
  );
  return { tenant, setTenant, loadTenants, firmMode, setFirmMode, firm, setFirm };
}

/** Uygulanacak filtreler: boş alanlar düşer, müşteri araması kırpılır, sayfa 1. */
const nextFilters = (draft: Draft, pageSize: HistoryFilters["pageSize"]) =>
  ({
    ...Object.fromEntries(Object.entries(draft).filter(([, v]) => v.trim() !== "")),
    customer: checkCustomer(draft.customer).value,
    page: 1,
    pageSize,
  }) as Partial<HistoryFilters>;

export interface HistoryFilterInput {
  filters: HistoryFilters;
  technicians: Opt[] | null;
  techniciansError?: boolean;
  showTenant: boolean;
  tenantLabel?: string;
  customerFirmName?: string;
}

/** /history filtre formu durumu: taslak + hatalar; Filtrele URL'ye yazar (sayfa 1), Temizle her şeyi sıfırlar. */
export function useHistoryFilters({
  filters,
  technicians,
  techniciansError,
  showTenant,
  tenantLabel,
  customerFirmName,
}: HistoryFilterInput) {
  const tech = useTechOptions(technicians, techniciansError);
  const pick = usePickers(filters, tenantLabel, customerFirmName);
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => toDraft(filters));
  const [errors, setErrors] = useState<Errors>({});
  const [pending, start] = useTransition();

  const set = (k: keyof Draft) => (e: { target: { value: string } }) => {
    setDraft((d) => ({ ...d, [k]: e.target.value }));
    setErrors((x) => ({ ...x, [k]: undefined }));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs = validateDraft(draft);
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
    const next = nextFilters(draft, filters.pageSize);
    start(() => router.push(historyHref(next)));
  };
  const clear = () => {
    setDraft(toDraft({ page: 1, pageSize: filters.pageSize }));
    pick.setFirmMode("");
    pick.setFirm(null);
    pick.setTenant(null);
    if (showTenant) tech.reloadTechs("");
    setErrors({});
    start(() => router.push(historyHref({ pageSize: filters.pageSize })));
  };
  return { ...tech, ...pick, draft, setDraft, errors, pending, set, submit, clear };
}

export type HistoryFilterState = ReturnType<typeof useHistoryFilters>;
