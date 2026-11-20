/*
 * AC-27: "Hızlı Destek uygulamasını indir" ön kontrolü. GET /public/agent/download?ref= başarıda 302 → /downloads/Destek-<kod>.exe
 * döner (mimari-api public tablosu). Düz bir bağlantı hata yanıtını (503 NOT_READY, 410, 404, 429) okuyamaz ve sayfayı
 * JSON'a götürür; bu yüzden önce `redirect: "manual"` ile denenir: opaqueredirect = yönlendirme var → indirme başlatılır.
 * Not: ön kontrol sunucunun indirme kovasından (ipKey 20/dk) bir hak harcar; asıl indirme ikinci haktır.
 */
import type { AgentAvailabilityResponse } from "@remote/contracts/api/sessions";
import { z } from "zod";
import { API_BASE } from "@/lib/api";
import type { AgentOs } from "@/lib/device-support";

type AgentEnd = "expired" | "cancelled" | "consumed" | "notFound";

type AgentProbe =
  | { kind: "ok" }
  | { kind: "notReady" }
  | { kind: "end"; end: AgentEnd }
  | { kind: "rate"; retryAfter?: number }
  | { kind: "error"; requestId?: string };

const GONE: Record<string, AgentEnd> = {
  SESSION_EXPIRED: "expired",
  SESSION_CANCELLED: "cancelled",
  SESSION_CONSUMED: "consumed",
};

/**
 * İndirme ucunun adresi (aynı origin; ref opak sessionRef, kodu taşımaz). P28f: macOS'ta `&os=macos` (302 → `.zip`);
 * P28g: Linux'ta `&os=linux` (302 → uzantısız `Destek-<kod>`). Windows adresi değişmez (sunucu varsayılanı `windows`, eski bağlantılar aynen çalışır).
 */
export const agentDownloadUrl = (sessionRef: string, os: AgentOs = "windows"): string =>
  `${API_BASE}/public/agent/download?ref=${encodeURIComponent(sessionRef)}${os === "windows" ? "" : `&os=${os}`}`;

/**
 * P31 (AC-520, mimari-p31 §3.1): firma bağlantısının (`request-download?ref=`) macOS adresi — `os=macos` eklenir (302 → `.zip`).
 * Taban göreli (`/r/`) ya da mutlak (portal `links.downloadUrl`) olabilir; mevcut sorgu korunur. Windows adresi değişmez.
 */
export function requestDownloadHref(base: string, os: "windows" | "macos"): string {
  if (os === "windows") return base;
  return `${base}${base.includes("?") ? "&" : "?"}os=macos`;
}

export async function probeAgentDownload(
  sessionRef: string,
  os: AgentOs = "windows",
  doFetch: typeof fetch = (...a) => fetch(...a),
): Promise<AgentProbe> {
  let res: Response;
  try {
    res = await doFetch(agentDownloadUrl(sessionRef, os), {
      method: "GET",
      redirect: "manual",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch {
    return { kind: "error" };
  }
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) return { kind: "ok" };

  const body: unknown = await res.json().catch(() => null);
  const err = (body as { error?: { code?: unknown; requestId?: unknown } } | null)?.error ?? {};
  const code = typeof err.code === "string" ? err.code : "";
  if (res.status === 503) return { kind: "notReady" };
  if (res.status === 410) return { kind: "end", end: GONE[code] ?? "expired" };
  if (res.status === 404) return { kind: "end", end: "notFound" };
  if (res.status === 429) {
    const retry = Number(res.headers.get("Retry-After"));
    return { kind: "rate", retryAfter: Number.isFinite(retry) && retry > 0 ? retry : undefined };
  }
  return { kind: "error", requestId: typeof err.requestId === "string" ? err.requestId : undefined };
}

/**
 * P28f (mimari-p28f §4.1, AC-390): `GET /public/agent/availability` → `{ windows, macos }` (contracts
 * `AgentAvailabilityResponse`; sözleşmede yalnız tip var → yanıt burada doğrulanır, fazladan alan yok sayılır).
 */
// macosTestBuild eksik/geçersiz → false. P28f-r4 (K-P28f-r4-3, AC-503): `macosSigning` eksik/geçersiz → null → `adhoc` rehberi
// ("Yine de Aç" + yalnız-bu-sayfa uyarısı); bilinmeyen değer asla `notarized` sayılmaz.
const availabilitySchema = z.object({
  windows: z.boolean(),
  macos: z.boolean(),
  macosTestBuild: z.boolean().catch(false),
  macosSigning: z.enum(["notarized", "adhoc"]).nullable().catch(null),
  // P28g (mimari-p28g §4.1): eski sunucu / eksik / geçersiz `linux` → false (fail-closed, yalnız tarayıcı).
  linux: z.boolean().catch(false),
}) satisfies z.ZodType<AgentAvailabilityResponse>;
export type AgentAvailability = z.infer<typeof availabilitySchema>;

/** macOS rehber varyantı (K-P28f-r4-3/6). */
export type MacVariant = "test" | "adhoc" | "notarized";

/** `macosTestBuild` true → test; değilse yalnız açık `"notarized"` → notarized; diğer her durum (eksik/geçersiz/null) → adhoc. */
export function macVariant(a: Pick<AgentAvailability, "macosTestBuild" | "macosSigning"> | null | undefined): MacVariant {
  if (a?.macosTestBuild === true) return "test";
  return a?.macosSigning === "notarized" ? "notarized" : "adhoc";
}
export const AGENT_AVAILABILITY_URL = `${API_BASE}/public/agent/availability`;

/**
 * Fail-closed (S-P28f-15): ağ hatası, 429, 2xx dışı yanıt ya da şemaya uymayan gövde → `null` (çağıran indirmeyi göstermez,
 * yalnız tarayıcı modu sunar). Girdi yok, çerez gönderilmez.
 */
export async function fetchAgentAvailability(doFetch: typeof fetch = (...a) => fetch(...a)): Promise<AgentAvailability | null> {
  try {
    const res = await doFetch(AGENT_AVAILABILITY_URL, { method: "GET", credentials: "omit", headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const r = availabilitySchema.safeParse(await res.json());
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
