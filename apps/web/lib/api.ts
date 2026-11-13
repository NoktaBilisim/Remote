/*
 * Tarayıcı tarafı API yardımcısı: fetch + CSRF (double-submit, ADR-0008).
 * Durum değiştiren isteklerde CSRF çerezi (`CSRF_COOKIE` = `__Host-rs_csrf`, contracts) `CSRF_HEADER` başlığına yazılır.
 * Hata zarfı: { error: { code, message, fields?, requestId } } (mimari-api.md).
 */

import { CSRF_COOKIE, CSRF_HEADER } from "@remote/contracts/api/auth";

export const API_BASE = "/api/v1";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
    readonly requestId?: string,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Oturum düştüğünde (401) gidilecek giriş adresi; tüm istemci/sunucu yönlendirmeleri bunu kullanır. */
export const EXPIRED_LOGIN_PATH = "/login?reason=expired";

/** 401: oturum süresi dolmuş/geçersiz. */
export const isUnauthenticated = (e: unknown): e is ApiError => e instanceof ApiError && e.status === 401;

/** Sunucuya hiç ulaşılamadı (ağ hatası). */
export class NetworkError extends Error {
  constructor() {
    super("network");
    this.name = "NetworkError";
  }
}

export function readCookie(name: string, cookieString: string): string | undefined {
  for (const part of cookieString.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function api<T>(
  method: Method,
  path: string,
  body?: unknown,
  deps: { fetch: typeof fetch; cookie: () => string } = {
    fetch: (...a) => fetch(...a),
    cookie: () => document.cookie,
  },
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  // P12: multipart yükleme — FormData olduğu gibi gider, sınır (boundary) başlığını tarayıcı yazar
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  if (method !== "GET") {
    const csrf = readCookie(CSRF_COOKIE, deps.cookie());
    if (csrf) headers[CSRF_HEADER] = csrf;
  }

  let res: Response;
  try {
    res = await deps.fetch(API_BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new NetworkError();
  }

  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (res.ok) return data as T;

  const err = (data as { error?: Partial<Record<string, unknown>> } | null)?.error ?? {};
  // P10 (AC-67): yarı oturumda (2FA kodu / zorunlu kurulum bekleniyor) her uç 403 verir → ilgili ekrana
  if (res.status === 403 && typeof window !== "undefined" && (err.code === "MFA_REQUIRED" || err.code === "MFA_SETUP_REQUIRED")) {
    const gate = err.code === "MFA_REQUIRED" ? "/login/2fa" : "/2fa/setup";
    if (window.location.pathname !== gate) window.location.assign(gate);
  }
  const retry = Number(res.headers.get("Retry-After"));
  throw new ApiError(
    res.status,
    typeof err.code === "string" ? err.code : "INTERNAL",
    typeof err.message === "string" ? err.message : "",
    (err.fields as Record<string, string> | undefined) ?? undefined,
    typeof err.requestId === "string" ? err.requestId : undefined,
    Number.isFinite(retry) && retry > 0 ? retry : undefined,
  );
}

const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f\\]/;

/**
 * Açık yönlendirmeyi önler (S1-1): yalnız aynı origin'deki uygulama içi yol.
 * Kontrol karakteri (\t \n \r …, kodlanmış hâli dahil), ters bölü ve "//" içeren değerler reddedilir;
 * son karar `new URL(next, origin)` ile origin karşılaştırmasıdır.
 */
export function safeNext(next: string | null | undefined, origin: string, fallback = "/"): string {
  if (!next) return fallback;
  let decoded: string;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return fallback;
  }
  if (CONTROL_OR_BACKSLASH.test(next) || CONTROL_OR_BACKSLASH.test(decoded)) return fallback;
  if (!next.startsWith("/") || next.includes("//") || decoded.includes("//")) return fallback;
  let url: URL;
  try {
    url = new URL(next, origin);
  } catch {
    return fallback;
  }
  if (url.origin !== new URL(origin).origin) return fallback;
  return url.pathname + url.search + url.hash;
}
