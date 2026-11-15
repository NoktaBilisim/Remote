/*
 * P14b (AC-225): teknisyen seçenekleri — `GET /users/options[?tenantId=]`. Liste her zaman uçtan gelir (sayfadaki
 * kayıtlardan üretilmez). `tenantId` yalnız firma seçmemiş Super Admin'de anlamlıdır; diğer rollerde sunucu yok sayar.
 */
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { UserOptionsResponse } from "./contract";

type TechOption = { value: string; label: string };

export function userOptionsPath(tenantId?: string): string {
  return tenantId ? `/users/options?${new URLSearchParams({ tenantId }).toString()}` : "/users/options";
}

/** Seçenekler (sunucu `fullName` sırasıyla); pasif hesap etiketle, seçili ama listede olmayan id "Seçili (…)" olarak eklenir. */
export function techOptions(items: UserOptionsResponse["items"], selected?: string): TechOption[] {
  const out = items.map((u) => ({ value: u.id, label: u.status === "ACTIVE" ? u.fullName : t("h.f.techPassive", { name: u.fullName }) }));
  if (selected && !out.some((o) => o.value === selected))
    out.push({ value: selected, label: t("h.f.selected", { id: selected.slice(-6) }) });
  return out;
}

/** İstemci tarafı: Super Admin firma filtresinde firma seçince o firmanın teknisyenleri. */
export async function loadUserOptions(tenantId: string, signal: AbortSignal): Promise<UserOptionsResponse["items"]> {
  const r = await api<UserOptionsResponse>("GET", userOptionsPath(tenantId), undefined, {
    fetch: (input, init) => fetch(input, { ...init, signal }),
    cookie: () => document.cookie,
  });
  return r.items;
}
