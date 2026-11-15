/*
 * AC-27: "Hızlı Destek uygulamasını indir" ön kontrolü. GET /public/agent/download?ref= başarıda 302 → /downloads/Destek-<kod>.exe
 * döner (mimari-api public tablosu). Düz bir bağlantı hata yanıtını (503 NOT_READY, 410, 404, 429) okuyamaz ve sayfayı
 * JSON'a götürür; bu yüzden önce `redirect: "manual"` ile denenir: opaqueredirect = yönlendirme var → indirme başlatılır.
 * Not: ön kontrol sunucunun indirme kovasından (ipKey 20/dk) bir hak harcar; asıl indirme ikinci haktır.
 */
import { API_BASE } from "@/lib/api";

export type AgentEnd = "expired" | "cancelled" | "consumed" | "notFound";

export type AgentProbe =
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

/** İndirme ucunun adresi (aynı origin; ref opak sessionRef, kodu taşımaz). */
export const agentDownloadUrl = (sessionRef: string): string => `${API_BASE}/public/agent/download?ref=${encodeURIComponent(sessionRef)}`;

export async function probeAgentDownload(sessionRef: string, doFetch: typeof fetch = (...a) => fetch(...a)): Promise<AgentProbe> {
  let res: Response;
  try {
    res = await doFetch(agentDownloadUrl(sessionRef), {
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
