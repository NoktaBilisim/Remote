// Seed aydınlatma metni (seed.ts'ten ayrıldı — P8c-1 düzeltme turu 1, QA AC-188: entegrasyon testi seed'i bütün DB'ye
// koşmadan tek tenant üzerinde doğrulayabilsin). seed.ts bu modülü çağırır; davranış değişmedi.
import { createHash } from "node:crypto";
import { ulid } from "ulid";
import type { PrismaClient } from "../src/generated/prisma/client.ts";
import { defaultConsentBody } from "../src/public/consent.ts";

export { defaultConsentBody };

// P4 (mimari §3.1 consent_texts, AC-29/127) + P8b-1 (mimari-e9 §3.6, AC-135): sistem aydınlatma metni. Tenant Admin'i
// P11'de kendi sürümünü ekler. Üretimde de çalışır (demo verisi değildir). Kural (idempotent):
//  - metni olmayan tenant → güncel sistem metni v1;
//  - güncel sürüm SİSTEM metniyse (created_by NULL) ve gövde güncel sistem metninden farklıysa → yeni sürüm (max+1),
//    eskisi is_current=0 (aynı TX; app'te sütun düzeyi UPDATE(is_current, updated_at) — grants.sql P8b-1);
//  - Admin'in yazdığı güncel metne (created_by dolu) DOKUNULMAZ.
// Not: yeni sürüm, eski sürümle açık karşılama sayfalarını join'de 400'e düşürür (AC-127) — runbook yayın notu.
const sha256Hex = (body: string): string => createHash("sha256").update(body, "utf8").digest("hex"); // DB CHECK: = SHA2(body,256)

export async function seedTenantConsent(prisma: PrismaClient, tenant: { id: string; name: string }): Promise<boolean> {
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

export async function seedConsentTexts(prisma: PrismaClient): Promise<number> {
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true }, orderBy: { id: "asc" } });
  let created = 0;
  for (const tenant of tenants) if (await seedTenantConsent(prisma, tenant)) created += 1;
  return created;
}
