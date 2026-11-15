// Seed (idempotent): Super Admin + demo tenant + her tenant için KVKK metni (P4; P8b-1, P8c-1 yeni sürüm) + demo talep
// ayarı + (P8c-1) demo örnek müşteri. Gizli değer yok; parola env'den gelir.
// Çalıştırma: pnpm db:seed  (DATABASE_URL = app kullanıcısı; DDL gerekmez)
// Env: SEED_SUPERADMIN_EMAIL, SEED_SUPERADMIN_PASSWORD (>= 12 karakter), SEED_SUPERADMIN_NAME?
// Demo tenant NODE_ENV=production iken oluşturulmaz.
// Var olan Super Admin'in parolası ASLA ezilmez (yeniden çalıştırma güvenli).
import { randomBytes } from "node:crypto";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import argon2 from "argon2";
import { ulid } from "ulid";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { seedConsentTexts } from "./seed-consent.ts";

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

// P8b-1 (mimari-e9 §3.1): yalnız geliştirmede demo tenant'ın talep ayarı (indirme bağlantısı hazır olsun). Üretimde
// satır tembel oluşturulur (Admin ayar ekranı). Ref = 10 rastgele bayt → RFC 4648 base32 küçük harf (16 karakter, 80 bit).
function randomTenantRef(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const bytes = randomBytes(10);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

const WEEKDAY = [
  { from: "09:00", to: "12:30" },
  { from: "13:30", to: "18:00" },
];
const DEMO_BUSINESS_HOURS = [WEEKDAY, WEEKDAY, WEEKDAY, WEEKDAY, WEEKDAY, [], []];

async function seedDemoRequestSettings(prisma: PrismaClient): Promise<"created" | "exists" | "skipped"> {
  if (process.env.NODE_ENV === "production") return "skipped";
  const tenant = await prisma.tenant.findUnique({ where: { slug: DEMO_TENANT.slug }, select: { id: true } });
  if (!tenant) return "skipped";
  const existing = await prisma.tenantRequestSettings.findUnique({ where: { tenantId: tenant.id }, select: { tenantId: true } });
  if (existing) return "exists";
  const requestRef = randomTenantRef();
  // P8c-1 (ADR-0006 r5): her ref üretimi aynı TX'te tek ad alanına (request_refs) yazılır.
  await prisma.$transaction([
    prisma.requestRef.create({ data: { ref: requestRef, tenantId: tenant.id, customerId: null } }),
    prisma.tenantRequestSettings.create({
      data: {
        tenantId: tenant.id,
        requestRef,
        fileLabel: "DemoFirma",
        waRecipients: [],
        emailRecipients: [],
        trustedCidrs: [],
        // P18 (AC-258): mesai ekranı boş gelmesin — hafta içi 09:00–18:00 (öğle arası 12:30–13:30). Takvim kapalı
        // (hours_enabled=false) → geliştirmede talep akışı saatten bağımsız kalır.
        businessHours: DEMO_BUSINESS_HOURS,
        // P19 (AC-259): geliştirmede /r/<ref> web formu hazır olsun. Bildirim kanalları kapalı (SMS/WA/SMTP seed'lenmez;
        // açık kanal yapılandırmasız `unconfigured` FAILED üretirdi).
        webFormEnabled: true,
      },
    }),
  ]);
  return "created";
}

// P8c-1 (mimari-e10 §3.1): yalnız geliştirmede demo tenant'a örnek müşteri (Müşteriler sayfası boş kalmasın). Katlanmış
// anahtarlar contracts `foldKey` çıktısının elle hesaplanmış karşılığıdır (ad ASCII dışı harf içeriyor: Ö, ü, ş, Ş →
// "ornek musteri a.s."); DB CHECK `customers_search_key_chk` search_key'in name_key ile başladığını doğrular.
// Seed migrate imajında contracts'a bağımlı olmasın diye sabit kalır; `test/unit/customers-p8c.test.ts` (metin okuması) bu sabitlerin
// contracts `customerKeys` / `suggestFileLabel` çıktısıyla aynı olduğunu doğrular (backend P8c-1).
const DEMO_CUSTOMER = {
  name: "Örnek Müşteri A.Ş.",
  nameKey: "ornek musteri a.s.",
  fileLabel: "OrnekMusteri",
  contactName: "Deneme Yetkili",
  phone: "+905550000000",
};

const demoSearchKey = (): string => `${DEMO_CUSTOMER.nameKey} deneme yetkili ${DEMO_CUSTOMER.phone.replace(/\D/g, "")}`;

async function seedDemoCustomer(prisma: PrismaClient): Promise<"created" | "exists" | "skipped"> {
  if (process.env.NODE_ENV === "production") return "skipped";
  const tenant = await prisma.tenant.findUnique({ where: { slug: DEMO_TENANT.slug }, select: { id: true } });
  if (!tenant) return "skipped";
  const existing = await prisma.customer.findUnique({
    where: { tenantId_nameKey: { tenantId: tenant.id, nameKey: DEMO_CUSTOMER.nameKey } },
    select: { id: true },
  });
  if (existing) return "exists";
  const id = ulid();
  const requestRef = randomTenantRef();
  const searchKey = demoSearchKey();
  // FK sırası: önce customers, sonra request_refs (FK (tenant_id, customer_id) anında denetlenir).
  await prisma.$transaction([
    prisma.customer.create({
      data: {
        id,
        tenantId: tenant.id,
        name: DEMO_CUSTOMER.name,
        nameKey: DEMO_CUSTOMER.nameKey,
        searchKey,
        fileLabel: DEMO_CUSTOMER.fileLabel,
        requestRef,
        contactName: DEMO_CUSTOMER.contactName,
        phone: DEMO_CUSTOMER.phone,
      },
    }),
    prisma.requestRef.create({ data: { ref: requestRef, tenantId: tenant.id, customerId: id } }),
    prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        action: "customer.created",
        entity: "customer",
        entityId: id,
        newValue: { name: DEMO_CUSTOMER.name, fileLabel: DEMO_CUSTOMER.fileLabel, refPrefix: requestRef.slice(0, 4), source: "seed" },
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
    const consents = await seedConsentTexts(prisma);
    const requestSettings = await seedDemoRequestSettings(prisma);
    const customer = await seedDemoCustomer(prisma);
    process.stdout.write(
      `seed: superAdmin=${superAdmin} demoTenant=${demo} consentTextsCreated=${consents} demoRequestSettings=${requestSettings} demoCustomer=${customer}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`seed başarısız: ${message}\n`);
  process.exit(1);
});
