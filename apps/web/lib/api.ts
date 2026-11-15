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

/** P14a (AC-215): hassas uç son 5 dk içinde step-up ister (`requireStepUp`, contracts `errors.ts`). */
const STEP_UP_REQUIRED_CODE = "MFA_STEP_UP_REQUIRED";

/**
 * 401: oturum süresi dolmuş/geçersiz. P14a (AC-215): 401 `MFA_STEP_UP_REQUIRED` oturum düşmesi değildir (kullanıcı
 * step-up diyaloğunu kapattı) → girişe yönlendirilmez, çağıran hatayı form üstünde gösterir.
 */
export const isUnauthenticated = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.status === 401 && e.code !== STEP_UP_REQUIRED_CODE;

/**
 * Step-up işleyicisi: panel kabuğundaki `StepUpProvider` kaydeder (tek örnek). Diyaloğu açar; doğrulama başarılıysa
 * true, kullanıcı vazgeçerse false döner. Kayıtlı değilse (ör. giriş ekranları) 401 hatası olduğu gibi fırlatılır.
 */
type StepUpHandler = () => Promise<boolean>;
let stepUpHandler: StepUpHandler | null = null;
/** Aynı anda birden çok istek step-up isterse tek diyalog açılır; hepsi aynı sonucu bekler. */
let stepUpPending: Promise<boolean> | null = null;

export function setStepUpHandler(h: StepUpHandler | null): () => void {
  stepUpHandler = h;
  return () => {
    if (stepUpHandler === h) stepUpHandler = null;
  };
}

function requestStepUp(): Promise<boolean> | null {
  const h = stepUpHandler;
  if (!h) return null;
  stepUpPending ??= h()
    .catch(() => false)
    .finally(() => {
      stepUpPending = null;
    });
  return stepUpPending;
}

/** Diyalog kapatıldığında (vazgeç) çağırana dönen mesaj — sunucu metni "kod gerekli" dediği için istemci metni. */
export const STEP_UP_CANCELLED_MESSAGE = "İşlem yapılmadı: kimliğinizi doğrulamadınız. Tekrar denediğinizde kod sorulur.";

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

type Deps = { fetch: typeof fetch; cookie: () => string };

/**
 * `init.headers`: isteğe özel ek başlık (ör. P14a AC-206 `If-Match`).
 * `init.stepUp`: 401 `MFA_STEP_UP_REQUIRED` → diyalog → isteği bir kez tekrarla (varsayılan açık; ikinci 401 fırlatılır).
 */
export async function api<T>(
  method: Method,
  path: string,
  body?: unknown,
  deps: Deps = {
    fetch: (...a) => fetch(...a),
    cookie: () => document.cookie,
  },
  init: { headers?: Record<string, string>; stepUp?: boolean } = {},
): Promise<T> {
  try {
    return await send<T>(method, path, body, deps, init.headers);
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401 || e.code !== STEP_UP_REQUIRED_CODE || init.stepUp === false) throw e;
    const wait = requestStepUp();
    if (!wait) throw e;
    if (!(await wait)) {
      throw new ApiError(401, STEP_UP_REQUIRED_CODE, STEP_UP_CANCELLED_MESSAGE, undefined, e.requestId);
    }
    // Tek tekrar: ikinci kez step-up istenirse (ör. süre o anda doldu) hata çağırana gider, döngü yok
    return send<T>(method, path, body, deps, init.headers);
  }
}

async function send<T>(method: Method, path: string, body: unknown, deps: Deps, extra?: Record<string, string>): Promise<T> {
  const headers: Record<string, string> = { ...extra, Accept: "application/json" };
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
