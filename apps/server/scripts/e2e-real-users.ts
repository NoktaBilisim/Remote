// Yalnız test/staging: gerçek sunucu e2e'si (apps/web/e2e/p4-real.spec.ts) için demo tenant'ta iki ADMIN teknisyen.
// Çalıştırma (repo kökünden): pnpm --filter @remote/web e2e:real:users   (DATABASE_URL = app kullanıcısı; script
// E2E_REAL_ALLOW=1'i kendisi geçer). Doğrudan çalıştırmada E2E_REAL_ALLOW=1 açıkça verilmelidir (S-P4-T2-2).
// Env: E2E_REAL_LOGIN, E2E_REAL_LOGIN2 (e-posta), E2E_REAL_PASSWORD (>= 12 karakter). Değerler repoya yazılmaz.
// Önkoşul: `pnpm db:seed` (demo tenant + KVKK metni). NODE_ENV=production iken veya E2E_REAL_ALLOW=1 yoksa çalışmaz.
// İdempotent: kullanıcı varsa parolası env'deki değerle yenilenir, kilit/sayaç sıfırlanır, ilk giriş değişimi kapatılır.
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import argon2 from "argon2";
import { ulid } from "ulid";
import { PrismaClient } from "../src/generated/prisma/client.js";

// seed.ts ile aynı argon2id parametreleri (mimari §5.1)
const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const DEMO_SLUG = "demo";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} tanımlı değil`);
  return value;
}

function readInput() {
  const emails = [requireEnv("E2E_REAL_LOGIN"), requireEnv("E2E_REAL_LOGIN2")].map((e) => e.toLowerCase());
  for (const e of emails) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 190) throw new Error(`geçersiz e-posta: ${e}`);
  }
  if (emails[0] === emails[1]) throw new Error("E2E_REAL_LOGIN ve E2E_REAL_LOGIN2 farklı olmalı");
  const password = requireEnv("E2E_REAL_PASSWORD");
  if (password.length < 12 || password.length > 200) throw new Error("E2E_REAL_PASSWORD 12-200 karakter olmalı");
  return { emails, password };
}

async function upsertAdmin(prisma: PrismaClient, tenantId: string, email: string, fullName: string, passwordHash: string) {
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, tenantId: true, role: true } });
  if (existing) {
    if (existing.tenantId !== tenantId || existing.role !== "ADMIN") throw new Error(`${email} başka tenant/rolde; dokunulmadı`);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash, mustChangePassword: false, failedLoginCount: 0, failedWindowAt: null, lockedUntil: null, status: "ACTIVE" },
      }),
      prisma.auditLog.create({
        data: { tenantId, action: "user.password_reset", entity: "users", entityId: existing.id, newValue: { email, source: "e2e-real-users" }, result: "success" },
      }),
    ]);
    return "updated";
  }
  const id = ulid();
  await prisma.$transaction([
    prisma.user.create({ data: { id, tenantId, email, fullName, role: "ADMIN", passwordHash, mustChangePassword: false } }),
    prisma.auditLog.create({
      data: { tenantId, action: "user.created", entity: "users", entityId: id, newValue: { email, role: "ADMIN", source: "e2e-real-users" }, result: "success" },
    }),
  ]);
  return "created";
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new Error("NODE_ENV=production iken çalıştırılamaz");
  if (process.env.E2E_REAL_ALLOW !== "1") {
    throw new Error("açık izin yok: bu araç demo tenant'taki ADMIN parolalarını sıfırlar; yalnız test/staging DB'sinde E2E_REAL_ALLOW=1 ile çalıştırın");
  }
  const { emails, password } = readInput();
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(requireEnv("DATABASE_URL")) });
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: DEMO_SLUG }, select: { id: true } });
    if (!tenant) throw new Error("demo tenant yok; önce `pnpm db:seed` çalıştırın");
    const hash = await argon2.hash(password, ARGON2_OPTIONS);
    const results = [];
    for (const [i, email] of emails.entries()) results.push(await upsertAdmin(prisma, tenant.id, email, `E2E Teknisyen ${i + 1}`, hash));
    process.stdout.write(`e2e-real-users: ${results.join(", ")}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`e2e-real-users başarısız: ${message}\n`);
  process.exit(1);
});
