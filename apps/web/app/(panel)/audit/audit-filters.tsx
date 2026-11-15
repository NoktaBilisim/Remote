"use client";

import { FilterButtons } from "@/components/filter-buttons";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { actionOptionGroups } from "@/lib/audit/actions";
import { AUDIT_RESULT_LABELS, AUDIT_RESULTS } from "@/lib/audit/contract";
import type { AuditFilters } from "@/lib/audit/query";
import { istanbulDay } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useAuditFilters, type AuditFilterState } from "./use-audit-filters";

type Opt = { value: string; label: string };
type F = { f: AuditFilterState };

function DateFields({ f, today }: F & { today: string }) {
  return (
    <>
      <TextField
        label={t("h.f.from")}
        type="date"
        name="from"
        value={f.draft.from}
        max={today}
        onChange={f.set("from")}
        error={f.errors.from}
        hint={t("au.f.rangeHint")}
        data-testid="audit-from"
      />
      <TextField
        label={t("h.f.to")}
        type="date"
        name="to"
        value={f.draft.to}
        max={today}
        onChange={f.set("to")}
        error={f.errors.to}
        hint={t("h.f.dateHint")}
        data-testid="audit-to"
      />
    </>
  );
}

/** Kullanıcı / işlem / sonuç seçimleri. */
function EventSelects({ f, all, users, usersHint, action }: F & { all: Opt; users: Opt[]; usersHint?: string; action?: string }) {
  return (
    <>
      <SelectField
        label={t("au.f.user")}
        name="userId"
        value={f.draft.userId}
        onChange={f.set("userId")}
        options={[all, ...users]}
        hint={usersHint}
        data-testid="audit-user"
      />
      <SelectField
        label={t("au.f.action")}
        name="action"
        value={f.draft.action}
        onChange={f.set("action")}
        options={[{ value: "", label: t("au.f.allActions") }]}
        groups={actionOptionGroups(action)}
        data-testid="audit-action"
      />
      <SelectField
        label={t("au.f.result")}
        name="result"
        value={f.draft.result}
        onChange={f.set("result")}
        options={[all, ...AUDIT_RESULTS.map((r) => ({ value: r, label: AUDIT_RESULT_LABELS[r] }))]}
        data-testid="audit-result"
      />
    </>
  );
}

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
  const today = istanbulDay();
  const f = useAuditFilters(filters, today);
  const all: Opt = { value: "", label: t("h.f.all") };
  return (
    <form
      onSubmit={f.submit}
      noValidate
      aria-label={t("au.filters")}
      data-testid="audit-filters"
      className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <DateFields f={f} today={today} />
      {tenants && (
        <SelectField
          label={t("h.f.tenant")}
          name="tenantId"
          value={f.draft.tenantId}
          onChange={f.set("tenantId")}
          options={[all, ...tenants]}
          data-testid="audit-tenant"
        />
      )}
      <EventSelects f={f} all={all} users={users} usersHint={usersHint} action={filters.action} />
      <FilterButtons
        pending={f.pending}
        onClear={f.clear}
        className={`flex flex-wrap items-end gap-2 sm:col-span-2 ${tenants ? "lg:col-span-2" : "lg:col-span-2 lg:col-start-3"}`}
      />
    </form>
  );
}
