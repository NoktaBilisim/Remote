/*
 * P14b (AC-226): firma seçicisi — `GET /admin/tenants/options?q=&limit=20` (SUPER_ADMIN; sunucu ad önek + içerir, harf
 * duyarsız, aktif önce süzer). Üst menü firma geçişi ve /history firma filtresi aynı yükleyiciyi kullanır.
 */
import { api } from "@/lib/api";
import { TENANT_OPTIONS_MAX, type TenantOption, type TenantOptionsResponse } from "./contract";

/** mimari-e11 §5.1 AC-226: firma seçicide yazım gecikmesi. */
export const TENANT_COMBO_DEBOUNCE_MS = 250;
/** Sunucu şemasıyla aynı üst sınır (fazlası 400 olurdu); uzun metin kırpılır. */
const Q_MAX = 120;

function tenantOptionsPath(q: string): string {
  const qs = new URLSearchParams({ limit: String(TENANT_OPTIONS_MAX) });
  const v = q.trim().slice(0, Q_MAX);
  if (v) qs.set("q", v);
  return `/admin/tenants/options?${qs.toString()}`;
}

export async function loadTenantOptions(q: string, signal: AbortSignal): Promise<TenantOption[]> {
  const r = await api<TenantOptionsResponse>("GET", tenantOptionsPath(q), undefined, {
    fetch: (input, init) => fetch(input, { ...init, signal }),
    cookie: () => document.cookie,
  });
  return r.items;
}

/**
 * Seçilen firmanın adı (istemci içi bellek): filtre uygulanınca URL'de yalnız `tenantId` kalır; o firmanın sayfada
 * kaydı yoksa adı buradan gelir (tam sayfa yenilemede yoksa genel "Seçili" etiketi).
 */
const labels = new Map<string, string>();
export const rememberTenantLabel = (id: string, name: string) => void labels.set(id, name);
export const tenantLabelOf = (id: string): string | undefined => labels.get(id);
