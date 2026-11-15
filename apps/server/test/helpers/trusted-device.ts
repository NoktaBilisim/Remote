// P27a-K3: güvenilir cihaz entegrasyon testlerinin ortak yardımcıları (p27a-auth, p27a-rotation). Gerçek TOTP kurulumu
// (setup + enable) ve "bu cihazı hatırla" doğrulaması; çerez kavanozu yalnız `__Secure-rs_td` için.
import {
  TRUSTED_DEVICE_COOKIE,
  type LoginResponse,
  type MfaEnableResponse,
  type MfaSetupResponse,
  type MfaVerifyResponse,
} from "@remote/contracts/api/auth";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { base32Decode, hotp, stepOf } from "../../src/auth/mfa.ts";
import { createUser, loginRequest, ORIGIN, testDb, type Session, type TestUser } from "./app.ts";
import { sessionOf } from "./auth.ts";

let ipSeq = 0;
/** Dosya başına ayrı IP öneki ile çağrılır (IP 20/dk ve 2FA hesap+IP sayaçlarına takılmasın). */
export const ipFactory = (prefix: number) => (): string => `10.${prefix}.${Math.floor(++ipSeq / 250) % 250}.${(ipSeq % 250) + 1}`;

export interface Enrolled {
  user: TestUser;
  secret: string;
  codes: string[];
}

export const call = (
  app: FastifyInstance,
  ip: string,
  s: Session | null,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
  extraCookie = "",
) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: s
      ? { ...s.headers, cookie: extraCookie ? `${s.headers.cookie}; ${extraCookie}` : s.headers.cookie }
      : { origin: ORIGIN, ...(extraCookie ? { cookie: extraCookie } : {}) },
    remoteAddress: ip,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

/** Son kaydedilen adımı sıfırlar ve şimdiki TOTP kodunu verir (aynı adımda tekrar doğrulama için; replay testi değil). */
export async function freshCode(e: Enrolled): Promise<string> {
  await testDb().user.update({ where: { id: e.user.id }, data: { totpLastStep: null } });
  return hotp(base32Decode(e.secret), stepOf(Date.now()));
}

/** Kullanıcı + gerçek TOTP kurulumu (setup + enable). */
export async function enroll(
  app: FastifyInstance,
  ip: () => string,
  o: { tenantId: string | null; role?: "SUPER_ADMIN" | "ADMIN" | "USER" },
): Promise<Enrolled> {
  const user = await createUser({ tenantId: o.tenantId, role: o.role ?? "ADMIN" });
  const s = sessionOf(await app.inject(loginRequest(user.email, user.password, { remoteAddress: ip() })));
  const setup = (await call(app, ip(), s, "POST", "/auth/mfa/setup", {})).json<MfaSetupResponse>();
  const code = hotp(base32Decode(setup.secret), stepOf(Date.now()));
  const en = await call(app, ip(), s, "POST", "/auth/mfa/enable", { code });
  if (en.statusCode !== 200) throw new Error(`enable ${en.statusCode} ${en.body}`);
  return { user, secret: setup.secret, codes: en.json<MfaEnableResponse>().recoveryCodes };
}

export const tdCookie = (value: string): string => `${TRUSTED_DEVICE_COOKIE}=${value}`;

/** Yanıttaki güvenilir cihaz çerezi (yoksa undefined). */
export const tdOf = (res: LightMyRequestResponse) => res.cookies.find((c) => c.name === TRUSTED_DEVICE_COOKIE);

/** Şifreyle giriş; `cookie` verilirse istekle gönderilir. */
export async function passwordLogin(app: FastifyInstance, ip: string, u: TestUser, cookie = "", password = u.password) {
  const res = await app.inject(
    loginRequest(u.email, password, { remoteAddress: ip, headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) } }),
  );
  return { res, body: res.statusCode === 200 ? res.json<LoginResponse>() : null, s: sessionOf(res) };
}

/** Giriş + TOTP doğrulaması (`rememberDevice`); hatırlandıysa çerez değeri döner. */
export async function rememberDevice(
  app: FastifyInstance,
  ip: () => string,
  e: Enrolled,
  o: { remember?: boolean; ua?: string; existing?: string } = {},
) {
  const login = await passwordLogin(app, ip(), e.user, o.existing ? tdCookie(o.existing) : "");
  if (!login.body?.mfaRequired) throw new Error(`TOTP aşaması beklenirdi: ${login.res.body}`);
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/mfa/verify",
    headers: {
      ...login.s.headers,
      cookie: o.existing ? `${login.s.headers.cookie}; ${tdCookie(o.existing)}` : login.s.headers.cookie,
      ...(o.ua ? { "user-agent": o.ua } : {}),
    },
    remoteAddress: ip(),
    payload: { code: await freshCode(e), ...(o.remember === false ? {} : { rememberDevice: true }) },
  });
  if (res.statusCode !== 200) throw new Error(`verify ${res.statusCode} ${res.body}`);
  return { res, body: res.json<MfaVerifyResponse>(), cookie: tdOf(res)?.value, s: sessionOf(res) };
}
