// P21 portal test yardımcıları: doğrudan DB'ye portal hesabı (gerçek argon2id özeti — db-notlari "P21" CHECK'i), giriş
// isteği ve portal oturum başlıkları. İstemci IP'si XFF ile (TRUSTED_PROXY_CIDR 127.0.0.1/32).
import { CSRF_HEADER } from "@remote/contracts/api/auth";
import { PORTAL_CSRF_COOKIE, PORTAL_SESSION_COOKIE } from "@remote/contracts/api/portal";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { hotp, base32Decode, newTotpSecret, stepOf } from "../../src/auth/mfa.ts";
import { hashPassword } from "../../src/auth/password.ts";
import { aadFor, type SecretBox } from "../../src/lib/crypto.ts";
import { newId } from "../../src/lib/ids.ts";
import { ORIGIN, PASSWORD, testDb } from "./app.ts";

export const PORTAL_ENV = { TRUSTED_PROXY_CIDR: "127.0.0.1/32" };

let hashCache: Promise<string> | undefined;
let ipSeq = 0;
/** Testler arası çakışmasız istemci IP'si (IP kovaları test başına temiz). */
export const nextIp = (): string => `10.21.${Math.floor(++ipSeq / 250) % 250}.${(ipSeq % 250) + 1}`;

export interface TestPortalUser {
  id: string;
  email: string;
  slug: string;
  tenantId: string;
  customerId: string;
  password: string;
}

export async function createPortalUser(o: {
  tenantId: string;
  slug: string;
  customerId: string;
  email?: string;
  mustChangePassword?: boolean;
  tempPasswordExpiresAt?: Date | null;
  status?: "ACTIVE" | "PASSIVE";
  passiveAt?: Date;
}): Promise<TestPortalUser> {
  const id = newId();
  const email = o.email ?? `p-${id.toLowerCase()}@example.test`;
  hashCache ??= hashPassword(PASSWORD);
  const must = o.mustChangePassword ?? false;
  await testDb().portalUser.create({
    data: {
      id,
      tenantId: o.tenantId,
      customerId: o.customerId,
      email,
      fullName: "Portal Kişi",
      passwordHash: await hashCache,
      mustChangePassword: must,
      tempPasswordExpiresAt: must ? (o.tempPasswordExpiresAt ?? null) : null,
      status: o.status ?? "ACTIVE",
      passiveAt: o.status === "PASSIVE" ? (o.passiveAt ?? new Date()) : null,
    },
  });
  return { id, email, slug: o.slug, tenantId: o.tenantId, customerId: o.customerId, password: PASSWORD };
}

/** Portal hesabına doğrudan etkin TOTP (sır portal AAD'siyle); dönen: base32 sır. */
export async function enableTotpRow(box: SecretBox, portalUserId: string): Promise<string> {
  const secret = newTotpSecret();
  await testDb().portalUser.update({
    where: { id: portalUserId },
    data: { totpEnabled: true, totpSecretEnc: box.encrypt(secret, aadFor.portalTotpSecret(portalUserId)), totpLastStep: null },
  });
  return secret;
}

/** `offset` adım kaydırmalı geçerli kod (±1 adım kabul edilir). */
export const totpAt = (secret: string, offset = 0): string => hotp(base32Decode(secret), stepOf(Date.now()) + offset);

export function portalLoginReq(
  app: FastifyInstance,
  body: { email: string; tenantSlug: string; password: string; totpCode?: string },
  o: { ip?: string; origin?: string | null; cookie?: string } = {},
) {
  const headers: Record<string, string> = { "x-forwarded-for": o.ip ?? nextIp() };
  if (o.origin !== null) headers.origin = o.origin ?? ORIGIN;
  if (o.cookie) headers.cookie = o.cookie;
  return app.inject({ method: "POST", url: "/api/v1/portal/auth/login", headers, payload: body });
}

export interface PortalSession {
  token: string;
  csrf: string;
  headers: { cookie: string; "x-csrf-token": string; origin: string };
}

export function sessionOf(res: LightMyRequestResponse): PortalSession {
  const jar = Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
  const token = jar[PORTAL_SESSION_COOKIE] ?? "";
  const csrf = jar[PORTAL_CSRF_COOKIE] ?? "";
  return {
    token,
    csrf,
    headers: { cookie: `${PORTAL_SESSION_COOKIE}=${token}; ${PORTAL_CSRF_COOKIE}=${csrf}`, [CSRF_HEADER]: csrf, origin: ORIGIN } as PortalSession["headers"],
  };
}

export async function portalLoginAs(app: FastifyInstance, u: TestPortalUser, extra: { totpCode?: string } = {}): Promise<PortalSession> {
  const res = await portalLoginReq(app, { email: u.email, tenantSlug: u.slug, password: u.password, ...extra });
  if (res.statusCode !== 200) throw new Error(`portal girişi başarısız: ${res.statusCode} ${res.body}`);
  return sessionOf(res);
}
