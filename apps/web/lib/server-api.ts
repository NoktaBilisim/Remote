import "server-only";
import { cookies, headers as requestHeaders } from "next/headers";
import { cache } from "react";
import type { MeResponse } from "@/lib/account/contract";
import { forwardHeaders, readEdgeSecret } from "@/lib/edge-forward";

/*
 * Sunucu bileşenlerinden API çağrısı: kullanıcının çerezleri iç ağdaki
 * server'a iletilir (mimari §2: "WEB → API iç HTTP, çerez iletilir").
 */
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://server:3001";

export type MeState =
  | { kind: "ok"; me: MeResponse }
  | { kind: "unauthenticated" }
  /** P10: yarı oturum — 2FA kodu bekleniyor (`verify`) ya da zorunlu 2FA kurulmamış (`setup`). */
  | { kind: "mfa"; step: "verify" | "setup" }
  | { kind: "error"; status: number };

/**
 * P10 yönlendirme kararı (sayfalar ve panel kabuğu ortak): 2FA adımı → kod ekranı; şifre değişimi zorunlu → şifre;
 * zorunlu 2FA kurulmamış → kurulum kapısı. `null` = panel açılabilir. Sunucu da aynı kuralı uçlarda uygular.
 */
export function gateOf(state: MeState): "/login/2fa" | "/change-password" | "/2fa/setup" | null {
  if (state.kind === "mfa") return state.step === "verify" ? "/login/2fa" : "/2fa/setup";
  if (state.kind !== "ok") return null;
  const { user, mfa } = state.me;
  if (mfa?.stage === "verify") return "/login/2fa";
  if (user.mustChangePassword) return "/change-password";
  if (mfa?.stage === "setup") return "/2fa/setup";
  return null;
}

/** İstek başına tek /auth/me (layout + sayfa aynı sonucu paylaşır). */
export const getMe = cache(async (): Promise<MeState> => {
  const jar = await cookies();
  const cookie = jar
    .getAll()
    .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join("; ");

  let res: Response;
  try {
    res = await fetch(`${API_INTERNAL_URL}/api/v1/auth/me`, {
      headers: { cookie, accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    return { kind: "error", status: 0 };
  }
  if (res.status === 401) return { kind: "unauthenticated" };
  if (res.status === 403) {
    const code = ((await res.json().catch(() => null)) as { error?: { code?: unknown } } | null)?.error?.code;
    // Sözleşmede /auth/me yarı oturumda da 200 + `mfa.stage` döner; 403 kodları yalnız savunma amaçlı
    if (code === "MFA_REQUIRED") return { kind: "mfa", step: "verify" };
    if (code === "MFA_SETUP_REQUIRED") return { kind: "mfa", step: "setup" };
  }
  if (!res.ok) return { kind: "error", status: res.status };
  return { kind: "ok", me: (await res.json()) as MeResponse };
});

export type ServerResult<T> =
  { kind: "ok"; data: T; /** Yanıt zamanı (ms) */ at: number } | { kind: "error"; status: number; code: string; retryAfter?: number };

async function cookieHeader(): Promise<string> {
  const jar = await cookies();
  return jar
    .getAll()
    .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join("; ");
}

/** Oturumlu GET (çerez iletilir). Ağ hatası → status 0. */
export async function serverGet<T>(path: string): Promise<ServerResult<T>> {
  const cookie = await cookieHeader();
  return toResult<T>(() =>
    fetch(`${API_INTERNAL_URL}/api/v1${path}`, {
      headers: { cookie, accept: "application/json" },
      cache: "no-store",
    }),
  );
}

/**
 * Herkese açık GET (B-P12-1): çerez gönderilmez; istemci IP'si (XFF) yalnız istek Caddy'den geldiyse
 * (X-Edge-Auth doğru) iletilir — `resolveSessionToken` ile aynı kural (lib/edge-forward.ts). Böylece server'ın
 * IP başına limiti (ör. /public/branding 60/dk) gerçek ziyaretçiye uygulanır; tüm ziyaretçiler web konteynerinin
 * IP kovasını paylaşmaz.
 */
export async function publicGet<T>(path: string): Promise<ServerResult<T>> {
  const fwd = forwardHeaders(await requestHeaders(), readEdgeSecret());
  return toResult<T>(() =>
    fetch(`${API_INTERNAL_URL}/api/v1${path}`, {
      headers: { ...fwd, accept: "application/json" },
      cache: "no-store",
    }),
  );
}

async function toResult<T>(call: () => Promise<Response>): Promise<ServerResult<T>> {
  let res: Response;
  try {
    res = await call();
  } catch {
    return { kind: "error", status: 0, code: "NETWORK" };
  }
  const body = (await res.json().catch(() => null)) as unknown;
  if (res.ok) return { kind: "ok", data: body as T, at: Date.now() };
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  const retry = Number(res.headers.get("Retry-After"));
  return {
    kind: "error",
    status: res.status,
    code: typeof code === "string" ? code : "INTERNAL",
    retryAfter: Number.isFinite(retry) && retry > 0 ? retry : undefined,
  };
}

/**
 * Müşteri karşılama: POST /public/sessions/resolve sunucudan (token tarayıcı JS'ine ve loglara düşmez).
 * Origin = PUBLIC_BASE_URL (API durum değiştiren istekte Origin allowlist'i ister). İstemci IP'si
 * (XFF) yalnız istek Caddy'den geldiyse (X-Edge-Auth = EDGE_PROXY_SECRET, sabit zamanlı) iletilir;
 * müşterinin User-Agent'ı kırpılarak iletilir (audit) — bkz. lib/edge-forward.ts (S-P2-1, S-P2-2).
 * Gelen XFF başlığına doğrulanmadan güvenilmez (çağıran taraftan IP alınmaz).
 */
export async function resolveSessionToken<T>(token: string): Promise<ServerResult<T>> {
  const origin = new URL(process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").origin;
  const fwd = forwardHeaders(await requestHeaders(), readEdgeSecret());
  const headers: Record<string, string> = {
    ...fwd,
    origin,
    accept: "application/json",
    "content-type": "application/json",
  };
  return toResult<T>(() =>
    fetch(`${API_INTERNAL_URL}/api/v1/public/sessions/resolve`, {
      method: "POST",
      headers,
      body: JSON.stringify({ token, clientKind: "BROWSER" }),
      cache: "no-store",
    }),
  );
}
