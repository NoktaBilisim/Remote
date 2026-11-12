"use client";

import { CUSTOMER_STATUS_LABELS } from "@remote/contracts/labels";
import { useCallback } from "react";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { api } from "@/lib/api";
import type { CustomerOptionsResponse } from "@/lib/customers/contract";
import { t } from "@/lib/i18n";

/**
 * Müşteri firma seçimi (AC-176, AC-180): `GET /customers/options` (≤ 20, ad sırası). `status="active"` yeni oturumda
 * (pasif müşteri seçilemez — AC-171); filtrelerde `all` (pasif müşterinin geçmiş talepleri de bulunur, satırda "Pasif").
 */
export function CustomerCombobox({
  label,
  value,
  onChange,
  status = "active",
  hint,
  error,
  hideLabel,
  disabled,
  testId = "customer-combobox",
}: {
  label: string;
  value: ComboOption | null;
  onChange: (v: ComboOption | null) => void;
  status?: "active" | "all";
  hint?: string;
  error?: string;
  hideLabel?: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  const load = useCallback(
    async (q: string, signal: AbortSignal): Promise<ComboOption[]> => {
      const qs = new URLSearchParams({ status });
      if (q) qs.set("q", q.slice(0, 100));
      const r = await api<CustomerOptionsResponse>("GET", `/customers/options?${qs.toString()}`, undefined, {
        fetch: (input, init) => fetch(input, { ...init, signal }),
        cookie: () => document.cookie,
      });
      return r.items.map((c) => ({ id: c.id, label: c.name, hint: c.status === "PASSIVE" ? CUSTOMER_STATUS_LABELS.PASSIVE : undefined }));
    },
    [status],
  );
  return (
    <Combobox
      label={label}
      value={value}
      onChange={onChange}
      load={load}
      placeholder={t("cu.combo.ph")}
      hint={hint}
      error={error}
      hideLabel={hideLabel}
      disabled={disabled}
      testId={testId}
    />
  );
}
