// PT-K2: entegrasyon testlerinin ortak giriş yardımcıları (dosya-yerel `signIn`/`login`/çerez kavanozu kopyalarının tek
// tanımı). Saf: IP sayacı ve uygulama örneği çağıran dosyada kalır; burada paylaşılan değişebilir durum yok.
import { CSRF_COOKIE, SESSION_COOKIE } from "@remote/contracts/api/auth";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { createUser, loginAs, loginRequest, ORIGIN, type Session, type TestUser } from "./app.ts";

/** Giriş yanıtının çerezlerinden oturum (çerez + CSRF başlığı + origin). */
export function sessionOf(res: LightMyRequestResponse): Session {
  const jar = Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
  const token = jar[SESSION_COOKIE] ?? "";
  const csrf = jar[CSRF_COOKIE] ?? "";
  return { token, headers: { cookie: `${SESSION_COOKIE}=${token}; ${CSRF_COOKIE}=${csrf}`, "x-csrf-token": csrf, origin: ORIGIN } };
}

/** Verilen istemci IP'sinden giriş (IP başına giriş kovası dosyanın toplam girişine takılmasın); 200 değilse fırlatır. */
export async function signIn(app: FastifyInstance, user: TestUser, remoteAddress: string): Promise<Session> {
  const res = await app.inject(loginRequest(user.email, user.password, { remoteAddress }));
  if (res.statusCode !== 200) throw new Error(`login ${res.statusCode}`);
  return sessionOf(res);
}

/** Firmada yeni kullanıcı (varsayılan USER) + oturum. */
export async function login(
  app: FastifyInstance,
  tenantId: string | null,
  o: { role?: "SUPER_ADMIN" | "ADMIN" | "USER"; perms?: Record<string, boolean> } = {},
): Promise<{ user: TestUser; s: Session }> {
  const user = await createUser({ tenantId, role: o.role ?? "USER", ...(o.perms ? { perms: o.perms } : {}) });
  return { user, s: await loginAs(app, user) };
}
