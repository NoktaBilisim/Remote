// Entegrasyon test yardımcıları: gerçek MySQL (TEST_DATABASE_URL, app kullanıcısı), fastify.inject.
// Her test kendi benzersiz verisini üretir (ULID'li slug/e-posta); testler sırasız ve bağımsızdır.
import { CSRF_COOKIE, SESSION_COOKIE } from "@remote/contracts/api/auth";
import type { FastifyInstance, InjectOptions } from "fastify";
import type { Logger } from "pino";
import { buildApp, type AppDeps } from "../../src/app.ts";
import { hashPassword } from "../../src/auth/password.ts";
import { loadEnv, type Env } from "../../src/env.ts";
import { createDb, type Db } from "../../src/lib/db.ts";
import { newId, newSecretToken, sha256Hex } from "../../src/lib/ids.ts";

export const ORIGIN = "https://rs.test:4450";
export const PASSWORD = "Dogru-Sifre-123";

export function testEnv(extra: Record<string, string> = {}): Env {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL tanımlı değil (scripts/test-db.sh up)");
  // WHATSAPP_SERVICE_URL varsayılanı canlı servis; testler ASLA ona gitmemeli → kapalı yerel port (discard, 9).
  return loadEnv({ NODE_ENV: "test", PUBLIC_BASE_URL: ORIGIN, DATABASE_URL: url, LOG_LEVEL: "silent", WHATSAPP_SERVICE_URL: "http://127.0.0.1:9", ...extra });
}

let db: Db | undefined;
export function testDb(): Db {
  db ??= createDb(testEnv().DATABASE_URL);
  return db;
}

/** P10: zorunlu 2FA kurulum aşaması varsayılan KAPALI (P1–P9 testleri); P10 testleri `p10: { ... }` ile açar. */
export function makeApp(opts: { env?: Record<string, string>; logger?: Logger; signaling?: AppDeps["signaling"]; p10?: Pick<AppDeps, "netguard" | "mailTransport" | "mfaSetupEnforcement">; p11?: Pick<AppDeps, "mysqlProbe"> } = {}): FastifyInstance {
  const env = testEnv(opts.env);
  // B-P10-3: production modlu testlerde zorunlu 2FA kurulumu kapatılamaz (buildApp reddeder) → gerçek kural uygulanır.
  return buildApp({ env, db: testDb(), mfaSetupEnforcement: env.NODE_ENV === "production", ...opts.p10, ...opts.p11, ...(opts.logger ? { logger: opts.logger } : {}), ...(opts.signaling ? { signaling: opts.signaling } : {}) });
}

/** Tenant + ayarlar + güncel KVKK metni v1 (P4: resolve/join metin ister — seed'in tenant başına v1 kuralı). */
export async function createTenant(status = "ACTIVE") {
  const id = newId();
  const tenant = await testDb().tenant.create({
    data: { id, name: `Firma ${id.slice(-6)}`, slug: `t-${id.toLowerCase()}`, status, settings: { create: {} } },
  });
  await createConsentText(id, { version: 1, isCurrent: true });
  return tenant;
}

/** Doğrudan DB'ye aydınlatma metni; sha256 DB CHECK'i için gövdenin UTF-8 SHA-256'sı. */
export async function createConsentText(tenantId: string, o: { version: number; isCurrent: boolean; body?: string }) {
  const body = o.body ?? `Test aydınlatma metni v${o.version} — çğıöşü İ.`;
  return testDb().consentText.create({ data: { id: newId(), tenantId, version: o.version, body, sha256: sha256Hex(body), isCurrent: o.isCurrent } });
}

/** Tenant'ın güncel metninin id'si (join gövdesi için). */
export async function currentConsentId(tenantId: string): Promise<string> {
  return (await testDb().consentText.findFirstOrThrow({ where: { tenantId, isCurrent: true }, select: { id: true } })).id;
}

export interface TestUser {
  id: string;
  email: string;
  username: string;
  tenantId: string | null;
  password: string;
}

let hashCache: Promise<string> | undefined;

export async function createUser(o: {
  tenantId: string | null;
  role?: "SUPER_ADMIN" | "ADMIN" | "USER";
  mustChangePassword?: boolean;
  status?: string;
  perms?: Record<string, boolean>;
}): Promise<TestUser> {
  const id = newId();
  const email = `u-${id.toLowerCase()}@example.test`;
  const username = `u${id.toLowerCase()}`;
  hashCache ??= hashPassword(PASSWORD);
  await testDb().user.create({
    data: {
      id,
      tenantId: o.tenantId,
      email,
      username,
      fullName: "Test Kullanıcı",
      role: o.role ?? "USER",
      passwordHash: await hashCache,
      mustChangePassword: o.mustChangePassword ?? false,
      status: o.status ?? "ACTIVE",
      permissions: { create: Object.entries(o.perms ?? {}).map(([permKey, granted]) => ({ permKey, granted })) },
    },
  });
  return { id, email, username, tenantId: o.tenantId, password: PASSWORD };
}

export interface Session {
  token: string;
  headers: { cookie: string; "x-csrf-token": string; origin: string };
}

export function loginRequest(login: string, password: string, extra: Partial<InjectOptions> = {}): InjectOptions {
  return { method: "POST", url: "/api/v1/auth/login", headers: { origin: ORIGIN }, payload: { login, password }, ...extra };
}

export async function loginAs(app: FastifyInstance, user: TestUser, password = user.password): Promise<Session> {
  const res = await app.inject(loginRequest(user.email, password));
  if (res.statusCode !== 200) throw new Error(`login başarısız: ${res.statusCode} ${res.body}`);
  const jar = Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
  const session = jar[SESSION_COOKIE] ?? "";
  const csrf = jar[CSRF_COOKIE] ?? "";
  return { token: session, headers: { cookie: `${SESSION_COOKIE}=${session}; ${CSRF_COOKIE}=${csrf}`, "x-csrf-token": csrf, origin: ORIGIN } };
}

let codeSeq = 0;
/** Testlere özgü (çakışmasız) 8 haneli kod: süreç + sayaç tabanlı. */
export const uniqueCode = (): string =>
  String((process.pid * 7919 + Date.now() + ++codeSeq * 104_729) % 100_000_000).padStart(8, "0");

/** Doğrudan DB'ye destek oturumu (API dışı kurulum). Varsayılan PENDING, 15 dk TTL. */
export async function createSupportSessionRow(o: {
  tenantId: string;
  technicianId: string;
  status?: "PENDING" | "ACTIVE" | "ENDED" | "EXPIRED" | "CANCELLED";
  createdAt?: Date;
  ttlMin?: number;
}) {
  const id = newId();
  const token = newSecretToken();
  const createdAt = o.createdAt ?? new Date();
  const status = o.status ?? "PENDING";
  const code = status === "PENDING" ? uniqueCode() : null;
  const ended = status !== "PENDING" && status !== "ACTIVE";
  await testDb().supportSession.create({
    data: {
      id,
      tenantId: o.tenantId,
      technicianId: o.technicianId,
      tokenHash: sha256Hex(token),
      activeCode: code,
      techVerifyCode: "1234",
      status,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + (o.ttlMin ?? 15) * 60_000),
      ...(ended ? { endedAt: createdAt, endedBy: "SYSTEM", endReason: status.toLowerCase() } : {}),
      // consumed_status_chk (db-notlari P3): ACTIVE (ve tüketilmiş ENDED) satırda consumedAt + mode zorunlu.
      ...(status === "ACTIVE" || status === "ENDED" ? { consumedAt: createdAt, mode: "BROWSER" } : {}),
    },
  });
  return { id, token, code };
}
