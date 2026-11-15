"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { FilterButtons } from "@/components/filter-buttons";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { actionOptionGroups } from "@/lib/audit/actions";
import { AUDIT_RESULT_LABELS, AUDIT_RESULTS } from "@/lib/audit/contract";
import { auditHref, rangeError, type AuditFilters } from "@/lib/audit/query";
import { istanbulDay } from "@/lib/format";
import { t } from "@/lib/i18n";

type Opt = { value: string; label: string };
type Draft = Record<"from" | "to" | "tenantId" | "userId" | "action" | "result", string>;

const toDraft = (f: AuditFilters): Draft => ({
  from: f.from ?? "",
  to: f.to ?? "",
  tenantId: f.tenantId ?? "",
  userId: f.userId ?? "",
  action: f.action ?? "",
  result: f.result ?? "",
});

/**
 * /audit filtre formu (AC-76): durum URL'de; Enter/Filtrele ile uygulanır. Tarih aralığı sunucu kuralıyla aynı
 * denetlenir (başlangıç ≤ bitiş, ≤ 731 gün) — geçersizse istek atılmaz. Kullanıcı seçenekleri /users'tan (yoksa sayfadaki
 * kayıtlardan), firma filtresi yalnız firma seçmemiş Super Admin'de.
 */
export function AuditFiltersForm({
  filters,
  users,
  usersHint,
  tenants,
}: {
  filters: AuditFilters;
  users: Opt[];
  usersHint?: string;
  tenants: Opt[] | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => toDraft(filters));
  const [errors, setErrors] = useState<Partial<Record<"from" | "to", string>>>({});
  const [pending, start] = useTransition();
  const today = istanbulDay();
  const all: Opt = { value: "", label: t("h.f.all") };

  const set = (k: keyof Draft) => (e: { target: { value: string } }) => {
    setDraft((d) => ({ ...d, [k]: e.target.value }));
    if (k === "from" || k === "to") setErrors({});
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const err = rangeError(draft.from || undefined, draft.to || undefined, today);
    if (err) {
      setErrors(
        err === "date"
          ? { [draft.from && !/^\d{4}-\d{2}-\d{2}$/.test(draft.from) ? "from" : "to"]: t("h.v.date") }
          : err === "order"
            ? { to: t("h.v.dateOrder") }
            : { from: t("au.v.range") },
      );
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

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={t("au.filters")}
      data-testid="audit-filters"
      className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <TextField
        label={t("h.f.from")}
        type="date"
        name="from"
        value={draft.from}
        max={today}
        onChange={set("from")}
        error={errors.from}
        hint={t("au.f.rangeHint")}
        data-testid="audit-from"
      />
      <TextField
        label={t("h.f.to")}
        type="date"
        name="to"
        value={draft.to}
        max={today}
        onChange={set("to")}
        error={errors.to}
        hint={t("h.f.dateHint")}
        data-testid="audit-to"
      />
      {tenants && (
        <SelectField
          label={t("h.f.tenant")}
          name="tenantId"
          value={draft.tenantId}
          onChange={set("tenantId")}
          options={[all, ...tenants]}
          data-testid="audit-tenant"
        />
      )}
      <SelectField
        label={t("au.f.user")}
        name="userId"
        value={draft.userId}
        onChange={set("userId")}
        options={[all, ...users]}
        hint={usersHint}
        data-testid="audit-user"
      />
      <SelectField
        label={t("au.f.action")}
        name="action"
        value={draft.action}
        onChange={set("action")}
        options={[{ value: "", label: t("au.f.allActions") }]}
        groups={actionOptionGroups(filters.action)}
        data-testid="audit-action"
      />
      <SelectField
        label={t("au.f.result")}
        name="result"
        value={draft.result}
        onChange={set("result")}
        options={[all, ...AUDIT_RESULTS.map((r) => ({ value: r, label: AUDIT_RESULT_LABELS[r] }))]}
        data-testid="audit-result"
      />
      <FilterButtons
        pending={pending}
        onClear={clear}
        className={`flex flex-wrap items-end gap-2 sm:col-span-2 ${tenants ? "lg:col-span-2" : "lg:col-span-2 lg:col-start-3"}`}
      />
    </form>
  );
}
