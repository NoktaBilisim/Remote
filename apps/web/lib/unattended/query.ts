/*
 * /unattended liste durumu URL'de: `q` (≤ 64), `customerId` (ULID), `state` (online | offline | all vars.), P29 `version`
 * (sürüm dağılımı süzgeci, `x.y.z`) ve `scope=all` (yalnız Super Admin şeridi; listeye gitmez). Sunucu
 * `listDevicesQuerySchema` strict olduğundan geçersiz değer API'ye hiç gönderilmez (yok sayılır). Keyset sayfalı;
 * 8 sn (P28u) yoklama ilk sayfayı (en çok 100 satır) tazeler (mimari-p27 §4.2).
 */
import { UNSAFE_NAME_CHARS } from "@remote/contracts/api/sessions";
import {
  DEVICE_LIST_STATES,
  DEVICE_PAGE_SIZE,
  DEVICE_PAGE_SIZE_MAX,
  UPDATE_VERSION_PATTERN,
  type DeviceListResponse,
  type DeviceListState,
} from "./contract";

export interface DeviceListParams {
  q?: string;
  customerId?: string;
  state: DeviceListState;
  /** P29 (AC-490): `agent_version` birebir eşitlik süzgeci. */
  version?: string;
  /** P29: sürüm şeridi kapsamı (yalnız Super Admin'de anlamlı; cihaz listesine gönderilmez). */
  scope?: "all";
}

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const DEVICE_SEARCH_MAX = 64;

/** Arama metni: trim, 2..64 kod noktası, görünmez/kontrol karakteri yok; geçersiz → undefined. */
export function deviceSearchTerm(raw: string | undefined): string | undefined {
  const v = raw?.trim() ?? "";
  const n = [...v].length;
  if (n < 2 || n > DEVICE_SEARCH_MAX || UNSAFE_NAME_CHARS.test(v)) return undefined;
  return v;
}

export function parseDeviceParams(sp: SP): DeviceListParams {
  const state = one(sp.state);
  const customerId = one(sp.customerId);
  const version = one(sp.version);
  return {
    q: deviceSearchTerm(one(sp.q)),
    customerId: customerId && ULID.test(customerId) ? customerId : undefined,
    state: (DEVICE_LIST_STATES as readonly string[]).includes(state ?? "") ? (state as DeviceListState) : "all",
    version: version && UPDATE_VERSION_PATTERN.test(version) ? version : undefined,
    scope: one(sp.scope) === "all" ? "all" : undefined,
  };
}

/** Uygulama içi bağlantı (varsayılanlar yazılmaz → kararlı URL). */
export function devicesHref(p: Partial<DeviceListParams>): string {
  const q = new URLSearchParams();
  if (p.q) q.set("q", p.q);
  if (p.customerId) q.set("customerId", p.customerId);
  if (p.state && p.state !== "all") q.set("state", p.state);
  if (p.version) q.set("version", p.version);
  if (p.scope) q.set("scope", p.scope);
  const s = q.toString();
  return s ? `/unattended?${s}` : "/unattended";
}

/** GET /unattended/devices sorgusu (`limit` her zaman açık; `scope` gönderilmez — strict şema 400 verirdi). */
export function devicesApiPath(
  p: Pick<DeviceListParams, "q" | "customerId" | "state" | "version">,
  page: { cursor?: string; limit?: number } = {},
): string {
  const q = new URLSearchParams();
  if (p.q) q.set("q", p.q);
  if (p.customerId) q.set("customerId", p.customerId);
  q.set("state", p.state);
  if (p.version) q.set("version", p.version);
  if (page.cursor) q.set("cursor", page.cursor);
  q.set("limit", String(page.limit ?? DEVICE_PAGE_SIZE));
  return `/unattended/devices?${q.toString()}`;
}

/** P29 (§4.8): GET /unattended/versions — `scope=all` yalnız Super Admin'de istenir (diğerinde 403). */
export function versionsApiPath(scopeAll: boolean): string {
  return scopeAll ? "/unattended/versions?scope=all" : "/unattended/versions";
}

/** Yoklamada istenecek satır sayısı: yüklenen kadar (50..100). */
export const pollLimit = (loaded: number): number => Math.min(DEVICE_PAGE_SIZE_MAX, Math.max(DEVICE_PAGE_SIZE, loaded));

/**
 * Yoklama sonucunu birleştirir: yüklenen satırlar sınırı aşmıyorsa liste tümüyle yenilenir (eklenen/kaldırılan cihaz
 * görünür); aşıyorsa (> 100 satır yüklendi) yalnız dönen satırlar yerinde güncellenir, sayfa imleci korunur.
 */
export function mergePoll(prev: DeviceListResponse, next: DeviceListResponse, limit: number): DeviceListResponse {
  if (prev.items.length <= limit) return next;
  const fresh = new Map(next.items.map((d) => [d.id, d]));
  return { items: prev.items.map((d) => fresh.get(d.id) ?? d), nextCursor: prev.nextCursor };
}

/** Sonraki sayfayı ekler (aynı kimlik iki kez görünmez). */
export function appendPage(prev: DeviceListResponse, next: DeviceListResponse): DeviceListResponse {
  const seen = new Set(prev.items.map((d) => d.id));
  return { items: [...prev.items, ...next.items.filter((d) => !seen.has(d.id))], nextCursor: next.nextCursor };
}

/** Cihaz ayrıntısındaki "son 20 gözetimsiz oturum" (mevcut geçmiş ucu; `deviceId` filtresi — bkz. implementation.md P27-K8). */
export const DEVICE_SESSIONS_LIMIT = 20;
export function deviceSessionsPath(deviceId: string): string {
  const q = new URLSearchParams({ mode: "UNATTENDED", deviceId, page: "1", pageSize: String(DEVICE_SESSIONS_LIMIT) });
  return `/sessions?${q.toString()}`;
}
