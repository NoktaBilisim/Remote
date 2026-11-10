import "server-only";
import { cookies, headers as requestHeaders } from "next/headers";
import { cache } from "react";
import type { MeResult } from "@/lib/auth-schema";
import { forwardHeaders, readEdgeSecret } from "@/lib/edge-forward";

/*
 * Sunucu bileşenlerinden API çağrısı: kullanıcının çerezleri iç ağdaki
 * server'a iletilir (mimari §2: "WEB → API iç HTTP, çerez iletilir").
 */
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://server:3001";

export type MeState =
  | { kind: "ok"; me: MeResult }
  | { kind: "unauthenticated" }
  | { kind: "error"; status: number };

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
  if (!res.ok) return { kind: "error", status: res.status };
  return { kind: "ok", me: (await res.json()) as MeResult };
});

export type ServerResult<T> =
  | { kind: "ok"; data: T; /** Yanıt zamanı (ms) */ at: number }
  | { kind: "error"; status: number; code: string; retryAfter?: number };

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
