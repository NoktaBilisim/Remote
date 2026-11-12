// Seed (idempotent): Super Admin + demo tenant + her tenant için KVKK metni (P4; P8b-1 yeni sürüm) + demo talep ayarı. Gizli değer yok; parola env'den gelir.
// Çalıştırma: pnpm db:seed  (DATABASE_URL = app kullanıcısı; DDL gerekmez)
// Env: SEED_SUPERADMIN_EMAIL, SEED_SUPERADMIN_PASSWORD (>= 12 karakter), SEED_SUPERADMIN_NAME?
// Demo tenant NODE_ENV=production iken oluşturulmaz.
// Var olan Super Admin'in parolası ASLA ezilmez (yeniden çalıştırma güvenli).
import { createHash, randomBytes } from "node:crypto";
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

// P4 (mimari §3.1 consent_texts, AC-29/127) + P8b-1 (mimari-e9 §3.6, AC-135): sistem aydınlatma metni. Tenant Admin'i
// P11'de kendi sürümünü ekler. Üretimde de çalışır (demo verisi değildir). Kural (idempotent):
//  - metni olmayan tenant → güncel sistem metni v1;
//  - güncel sürüm SİSTEM metniyse (created_by NULL) ve gövde güncel sistem metninden farklıysa → yeni sürüm (max+1),
//    eskisi is_current=0 (aynı TX; app'te sütun düzeyi UPDATE(is_current, updated_at) — grants.sql P8b-1);
//  - Admin'in yazdığı güncel metne (created_by dolu) DOKUNULMAZ.
// Not: yeni sürüm, eski sürümle açık karşılama sayfalarını join'de 400'e düşürür (AC-127) — runbook yayın notu.
function defaultConsentBody(tenantName: string): string {
  return [
    `Bu uzaktan destek hizmetinde veri sorumlusu ${tenantName}'dır.`,
    "Destek talebi ve oturum sırasında adınız, telefon numaranız, e-posta adresiniz (verirseniz), sorun açıklamanız, IP adresiniz, cihaz/tarayıcı bilgileriniz ve onay kayıtlarınız; destek hizmetinin verilmesi ve kayıt altına alınması amacıyla 6698 sayılı KVKK'ya uygun olarak işlenir.",
    "Ekranınız yalnız siz paylaşımı başlattığınızda (\"Ekranımı paylaş\") ve oturum süresince teknisyene canlı olarak iletilir; ekran görüntüsü veya video kaydı tutulmaz. Paylaşımı istediğiniz an durdurabilir, oturumu sonlandırabilirsiniz.",
    "\"Bilgilerimi hatırla\" kutucuğunu işaretlerseniz adınız, telefonunuz, e-postanız ve bu bilgisayarı tanımaya yarayan rastgele bir cihaz anahtarı yalnız bu bilgisayarda, Windows kullanıcı profilinizde şifreli bir dosyada (%LOCALAPPDATA%\\NoktaDestek\\hatirla.bin) saklanır; sorun açıklamanız saklanmaz. Bu bilgileri istediğiniz an \"Bilgilerimi unut\" ile ya da kutucuğu boş bırakarak gönderim yaparak silebilirsiniz.",
    "Talep ve oturum kayıtları firmanın belirlediği saklama süresi kadar tutulur, süre sonunda kişisel veriler anonimleştirilir. KVKK'nın 11. maddesindeki haklarınız için firmayla iletişime geçebilirsiniz.",
    "Devam ederek bu metni okuduğunuzu ve ekranınızın görüntülenmesine açık rıza verdiğinizi onaylarsınız.",
  ].join("\n\n");
}

const sha256Hex = (body: string): string => createHash("sha256").update(body, "utf8").digest("hex"); // DB CHECK: = SHA2(body,256)

async function seedTenantConsent(prisma: PrismaClient, tenant: { id: string; name: string }): Promise<boolean> {
  const body = defaultConsentBody(tenant.name);
  const sha256 = sha256Hex(body);
  const current = await prisma.consentText.findFirst({
    where: { tenantId: tenant.id, isCurrent: true },
    select: { id: true, sha256: true, createdBy: true },
  });
  if (current && (current.createdBy !== null || current.sha256 === sha256)) return false;
  const last = await prisma.consentText.findFirst({
    where: { tenantId: tenant.id },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const id = ulid();
  const version = (last?.version ?? 0) + 1;
  await prisma.$transaction([
    ...(current ? [prisma.consentText.update({ where: { id: current.id }, data: { isCurrent: false } })] : []),
    prisma.consentText.create({ data: { id, tenantId: tenant.id, version, body, sha256, isCurrent: true } }),
    prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        action: "consent_text.created",
        entity: "consent_texts",
        entityId: id,
        newValue: { version, sha256, source: "seed" },
        result: "success",
      },
    }),
  ]);
  return true;
}

async function seedConsentTexts(prisma: PrismaClient): Promise<number> {
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true }, orderBy: { id: "asc" } });
  let created = 0;
  for (const tenant of tenants) if (await seedTenantConsent(prisma, tenant)) created += 1;
  return created;
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

async function seedDemoRequestSettings(prisma: PrismaClient): Promise<"created" | "exists" | "skipped"> {
  if (process.env.NODE_ENV === "production") return "skipped";
  const tenant = await prisma.tenant.findUnique({ where: { slug: DEMO_TENANT.slug }, select: { id: true } });
  if (!tenant) return "skipped";
  const existing = await prisma.tenantRequestSettings.findUnique({ where: { tenantId: tenant.id }, select: { tenantId: true } });
  if (existing) return "exists";
  await prisma.tenantRequestSettings.create({
    data: {
      tenantId: tenant.id,
      requestRef: randomTenantRef(),
      fileLabel: "DemoFirma",
      waRecipients: [],
      emailRecipients: [],
      trustedCidrs: [],
    },
  });
  return "created";
}

async function main(): Promise<void> {
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(requireEnv("DATABASE_URL")) });
  try {
    const superAdmin = await seedSuperAdmin(prisma);
    const demo = await seedDemoTenant(prisma);
    const consents = await seedConsentTexts(prisma);
    const requestSettings = await seedDemoRequestSettings(prisma);
    process.stdout.write(
      `seed: superAdmin=${superAdmin} demoTenant=${demo} consentTextsCreated=${consents} demoRequestSettings=${requestSettings}\n`,
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
