// Seed (idempotent): Super Admin + demo tenant. Gizli değer yok; parola env'den gelir.
// Çalıştırma: pnpm db:seed  (DATABASE_URL = app kullanıcısı; DDL gerekmez)
// Env: SEED_SUPERADMIN_EMAIL, SEED_SUPERADMIN_PASSWORD (>= 12 karakter), SEED_SUPERADMIN_NAME?
// Demo tenant NODE_ENV=production iken oluşturulmaz.
// Var olan Super Admin'in parolası ASLA ezilmez (yeniden çalıştırma güvenli).
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import argon2 from "argon2";
import { ulid } from "ulid";
import { PrismaClient } from "../src/generated/prisma/client.js";

// mimari §5.1: argon2id, m=19 MiB, t=2, p=1 (OWASP). Uygulamadaki auth/password.ts ile aynı olmalı.
const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const DEMO_TENANT = { slug: "demo", name: "Demo Firma" };

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} tanımlı değil`);
  return value;
}

function readSuperAdminInput() {
  const email = requireEnv("SEED_SUPERADMIN_EMAIL").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) {
    throw new Error("SEED_SUPERADMIN_EMAIL geçerli bir e-posta değil");
  }
  const password = requireEnv("SEED_SUPERADMIN_PASSWORD");
  if (password.length < 12 || password.length > 200) {
    throw new Error("SEED_SUPERADMIN_PASSWORD 12-200 karakter olmalı (AC-64)");
  }
  const fullName = process.env.SEED_SUPERADMIN_NAME?.trim() || "Super Admin";
  return { email, password, fullName };
}

async function seedSuperAdmin(prisma: PrismaClient): Promise<"created" | "exists"> {
  const input = readSuperAdminInput();
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) return "exists";

  const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS);
  const id = ulid();
  await prisma.$transaction([
    prisma.user.create({
      data: {
        id,
        tenantId: null,
        email: input.email,
        fullName: input.fullName,
        role: "SUPER_ADMIN",
        passwordHash,
        mustChangePassword: true, // ilk girişte zorunlu değişim (ortak standart 1.3)
      },
    }),
    prisma.auditLog.create({
      data: {
        action: "user.created",
        entity: "users",
        entityId: id,
        newValue: { email: input.email, role: "SUPER_ADMIN", source: "seed" },
        result: "success",
      },
    }),
  ]);
  return "created";
}

async function seedDemoTenant(prisma: PrismaClient): Promise<"created" | "exists" | "skipped"> {
  if (process.env.NODE_ENV === "production") return "skipped";
  const existing = await prisma.tenant.findUnique({ where: { slug: DEMO_TENANT.slug }, select: { id: true } });
  if (existing) return "exists";

  const id = ulid();
  await prisma.$transaction([
    prisma.tenant.create({ data: { id, ...DEMO_TENANT, settings: { create: {} } } }),
    prisma.auditLog.create({
      data: {
        tenantId: id,
        action: "tenant.created",
        entity: "tenants",
        entityId: id,
        newValue: { ...DEMO_TENANT, source: "seed" },
        result: "success",
      },
    }),
  ]);
  return "created";
}

async function main(): Promise<void> {
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(requireEnv("DATABASE_URL")) });
  try {
    const superAdmin = await seedSuperAdmin(prisma);
    const demo = await seedDemoTenant(prisma);
    process.stdout.write(`seed: superAdmin=${superAdmin} demoTenant=${demo}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`seed başarısız: ${message}\n`);
  process.exit(1);
});
