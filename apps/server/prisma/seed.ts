// Seed (idempotent): Super Admin + demo tenant + her tenant için KVKK metni v1 (P4). Gizli değer yok; parola env'den gelir.
// Çalıştırma: pnpm db:seed  (DATABASE_URL = app kullanıcısı; DDL gerekmez)
// Env: SEED_SUPERADMIN_EMAIL, SEED_SUPERADMIN_PASSWORD (>= 12 karakter), SEED_SUPERADMIN_NAME?
// Demo tenant NODE_ENV=production iken oluşturulmaz.
// Var olan Super Admin'in parolası ASLA ezilmez (yeniden çalıştırma güvenli).
import { createHash } from "node:crypto";
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

// P4 (mimari §3.1 consent_texts, AC-29/127): başlangıç aydınlatma/onay metni. Tenant Admin'i P11'de
// yeni sürüm ekler. Üretimde de çalışır (demo verisi değildir): metni olmayan her tenant'a v1 eklenir.
function defaultConsentBody(tenantName: string): string {
  return [
    `Bu uzaktan destek oturumunda veri sorumlusu ${tenantName}'dır.`,
    "Oturum sırasında adınız, e-posta adresiniz (verirseniz), IP adresiniz, tarayıcı bilgileriniz ve onay kayıtlarınız; destek hizmetinin verilmesi ve kayıt altına alınması amacıyla 6698 sayılı KVKK'ya uygun olarak işlenir.",
    "Ekranınız yalnız siz paylaşımı başlattığınızda ve oturum süresince teknisyene canlı olarak iletilir; ekran görüntüsü veya video kaydı tutulmaz. Paylaşımı istediğiniz an durdurabilir, oturumu sonlandırabilirsiniz.",
    "Kayıtlar firmanın belirlediği saklama süresi sonunda anonimleştirilir. KVKK'nın 11. maddesindeki haklarınız için firmayla iletişime geçebilirsiniz.",
    "Devam ederek bu metni okuduğunuzu ve ekranınızın görüntülenmesine açık rıza verdiğinizi onaylarsınız.",
  ].join("\n\n");
}

async function seedConsentTexts(prisma: PrismaClient): Promise<number> {
  const tenants = await prisma.tenant.findMany({
    where: { consentTexts: { none: {} } },
    select: { id: true, name: true },
  });
  for (const tenant of tenants) {
    const id = ulid();
    const body = defaultConsentBody(tenant.name);
    const sha256 = createHash("sha256").update(body, "utf8").digest("hex"); // DB CHECK: = SHA2(body,256)
    await prisma.$transaction([
      prisma.consentText.create({ data: { id, tenantId: tenant.id, version: 1, body, sha256, isCurrent: true } }),
      prisma.auditLog.create({
        data: {
          tenantId: tenant.id,
          action: "consent_text.created",
          entity: "consent_texts",
          entityId: id,
          newValue: { version: 1, sha256, source: "seed" },
          result: "success",
        },
      }),
    ]);
  }
  return tenants.length;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(requireEnv("DATABASE_URL")) });
  try {
    const superAdmin = await seedSuperAdmin(prisma);
    const demo = await seedDemoTenant(prisma);
    const consents = await seedConsentTexts(prisma);
    process.stdout.write(`seed: superAdmin=${superAdmin} demoTenant=${demo} consentTextsCreated=${consents}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`seed başarısız: ${message}\n`);
  process.exit(1);
});
