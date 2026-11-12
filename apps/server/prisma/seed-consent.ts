// Seed aydınlatma metni (seed.ts'ten ayrıldı — P8c-1 düzeltme turu 1, QA AC-188: entegrasyon testi seed'i bütün DB'ye
// koşmadan tek tenant üzerinde doğrulayabilsin). seed.ts bu modülü çağırır; davranış değişmedi.
import { createHash } from "node:crypto";
import { ulid } from "ulid";
import type { PrismaClient } from "../src/generated/prisma/client.ts";

// P4 (mimari §3.1 consent_texts, AC-29/127) + P8b-1 (mimari-e9 §3.6, AC-135): sistem aydınlatma metni. Tenant Admin'i
// P11'de kendi sürümünü ekler. Üretimde de çalışır (demo verisi değildir). Kural (idempotent):
//  - metni olmayan tenant → güncel sistem metni v1;
//  - güncel sürüm SİSTEM metniyse (created_by NULL) ve gövde güncel sistem metninden farklıysa → yeni sürüm (max+1),
//    eskisi is_current=0 (aynı TX; app'te sütun düzeyi UPDATE(is_current, updated_at) — grants.sql P8b-1);
//  - Admin'in yazdığı güncel metne (created_by dolu) DOKUNULMAZ.
// Not: yeni sürüm, eski sürümle açık karşılama sayfalarını join'de 400'e düşürür (AC-127) — runbook yayın notu.
export function defaultConsentBody(tenantName: string): string {
  return [
    `Bu uzaktan destek hizmetinde veri sorumlusu ${tenantName}'dır.`,
    "Destek talebi ve oturum sırasında adınız, telefon numaranız, e-posta adresiniz (verirseniz), sorun açıklamanız, IP adresiniz, cihaz/tarayıcı bilgileriniz ve onay kayıtlarınız; destek hizmetinin verilmesi ve kayıt altına alınması amacıyla 6698 sayılı KVKK'ya uygun olarak işlenir.",
    "Ekranınız yalnız siz paylaşımı başlattığınızda (\"Ekranımı paylaş\") ve oturum süresince teknisyene canlı olarak iletilir; ekran görüntüsü veya video kaydı tutulmaz. Paylaşımı istediğiniz an durdurabilir, oturumu sonlandırabilirsiniz.",
    "\"Bilgilerimi hatırla\" kutucuğunu işaretlerseniz adınız, telefonunuz, e-postanız ve bu bilgisayarı tanımaya yarayan rastgele bir cihaz anahtarı yalnız bu bilgisayarda, Windows kullanıcı profilinizde şifreli bir dosyada (%LOCALAPPDATA%\\NoktaDestek\\hatirla.bin) saklanır; sorun açıklamanız saklanmaz. Bu bilgileri istediğiniz an \"Bilgilerimi unut\" ile ya da kutucuğu boş bırakarak gönderim yaparak silebilirsiniz.",
    // P8c-1 (AC-188, mimari-e10 §3.5): bilgisayar kaydı — ne, nerede, ne kadar, nasıl silinir.
    `Başarılı bir destek oturumundan sonra bu bilgisayar ${tenantName} için hatırlanır: Windows kullanıcı profilinizdeki aynı şifreli dosyaya (%LOCALAPPDATA%\\NoktaDestek\\hatirla.bin) firmaya ait rastgele bir kayıt anahtarı yazılır; sunucuda bu anahtarın yalnız tek yönlü özeti tutulur ve bilgisayar adınız, IP adresiniz gibi bilgiler bu kayda eklenmez. Kayıt yalnız yeniden destek talebi açmaya yarar; bilgisayarınıza onayınız olmadan bağlanılmasına izin vermez, her oturumda ekran paylaşımını yine siz başlatırsınız. Kayıt son kullanımdan sonra firmanın saklama süresi kadar kullanılmazsa geçersizleşir; istediğiniz an "Bu bilgisayarı unut" ile bilgisayarınızdan ve sunucudan silebilirsiniz.`,
    // P8c-1 (AC-195): müşteri firma yetkili kişi verisi.
    `Kurumunuz ${tenantName} müşterisi olarak kayıtlıysa, kurumunuzun yetkili kişisinin adı, telefonu, e-postası ve destek notları müşteri kaydında tutulur; müşteri kaydı pasife alındıktan sonra saklama süresi dolunca bu bilgiler anonimleştirilir.`,
    "Talep ve oturum kayıtları firmanın belirlediği saklama süresi kadar tutulur, süre sonunda kişisel veriler anonimleştirilir. KVKK'nın 11. maddesindeki haklarınız için firmayla iletişime geçebilirsiniz.",
    "Devam ederek bu metni okuduğunuzu ve ekranınızın görüntülenmesine açık rıza verdiğinizi onaylarsınız.",
  ].join("\n\n");
}

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
