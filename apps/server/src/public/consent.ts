// KVKK aydınlatma metni + onay kaydı (P4; G-24, AC-29, AC-127; db-notlari "P4 → Backend-dev için").
// Metin tenant bazlı ve sürümlü; tenant başına tek `is_current` (DB fonksiyonel UQ). Onay kaydı append-only.
import { createHash } from "node:crypto";
import type { ConsentTextView } from "@remote/contracts/api/sessions";
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";

type DbOrTx = Db | Prisma.TransactionClient;

/**
 * Sistem aydınlatma metni gövdesi (seed ve P9 firma oluşturma ortak; prisma/seed-consent.ts'ten taşındı, metin aynı).
 */
export function defaultConsentBody(tenantName: string): string {
  return [
    `Bu uzaktan destek hizmetinde veri sorumlusu ${tenantName}'dır.`,
    "Destek talebi ve oturum sırasında adınız, telefon numaranız, e-posta adresiniz (verirseniz), sorun açıklamanız, IP adresiniz, cihaz/tarayıcı bilgileriniz ve onay kayıtlarınız; destek hizmetinin verilmesi ve kayıt altına alınması amacıyla 6698 sayılı KVKK'ya uygun olarak işlenir.",
    'Ekranınız yalnız siz paylaşımı başlattığınızda ("Ekranımı paylaş") ve oturum süresince teknisyene canlı olarak iletilir; ekran görüntüsü veya video kaydı tutulmaz. Paylaşımı istediğiniz an durdurabilir, oturumu sonlandırabilirsiniz.',
    '"Bilgilerimi hatırla" kutucuğunu işaretlerseniz adınız, telefonunuz, e-postanız ve bu bilgisayarı tanımaya yarayan rastgele bir cihaz anahtarı yalnız bu bilgisayarda, Windows kullanıcı profilinizde şifreli bir dosyada (%LOCALAPPDATA%\\NoktaDestek\\hatirla.bin) saklanır; sorun açıklamanız saklanmaz. Bu bilgileri istediğiniz an "Bilgilerimi unut" ile ya da kutucuğu boş bırakarak gönderim yaparak silebilirsiniz.',
    // P8c-1 (AC-188, mimari-e10 §3.5): bilgisayar kaydı — ne, nerede, ne kadar, nasıl silinir.
    `Başarılı bir destek oturumundan sonra bu bilgisayar ${tenantName} için hatırlanır: Windows kullanıcı profilinizdeki aynı şifreli dosyaya (%LOCALAPPDATA%\\NoktaDestek\\hatirla.bin) firmaya ait rastgele bir kayıt anahtarı yazılır; sunucuda bu anahtarın yalnız tek yönlü özeti tutulur ve bilgisayar adınız, IP adresiniz gibi bilgiler bu kayda eklenmez. Kayıt yalnız yeniden destek talebi açmaya yarar; bilgisayarınıza onayınız olmadan bağlanılmasına izin vermez, her oturumda ekran paylaşımını yine siz başlatırsınız. Kayıt son kullanımdan sonra firmanın saklama süresi kadar kullanılmazsa geçersizleşir; istediğiniz an "Bu bilgisayarı unut" ile bilgisayarınızdan ve sunucudan silebilirsiniz.`,
    // P8c-1 (AC-195): müşteri firma yetkili kişi verisi.
    `Kurumunuz ${tenantName} müşterisi olarak kayıtlıysa, kurumunuzun yetkili kişisinin adı, telefonu, e-postası ve destek notları müşteri kaydında tutulur; müşteri kaydı pasife alındıktan sonra saklama süresi dolunca bu bilgiler anonimleştirilir.`,
    "Talep ve oturum kayıtları firmanın belirlediği saklama süresi kadar tutulur, süre sonunda kişisel veriler anonimleştirilir. KVKK'nın 11. maddesindeki haklarınız için firmayla iletişime geçebilirsiniz.",
    "Devam ederek bu metni okuduğunuzu ve ekranınızın görüntülenmesine açık rıza verdiğinizi onaylarsınız.",
  ].join("\n\n");
}

/**
 * P9 firma oluşturma: sistem metni v1 (`created_by` NULL → seed sonraki sistem metni sürümünü kendisi ekler).
 * Çağıranın TX'inde; resolve/join güncel metin ister (P4).
 */
export async function createInitialConsent(
  tx: Prisma.TransactionClient,
  tenant: { id: string; name: string },
): Promise<{ id: string; version: number; sha256: string }> {
  const body = defaultConsentBody(tenant.name);
  const sha256 = createHash("sha256").update(body, "utf8").digest("hex");
  const row = { id: newId(), tenantId: tenant.id, version: 1, body, sha256, isCurrent: true };
  await tx.consentText.create({ data: row, select: { id: true } });
  return { id: row.id, version: 1, sha256 };
}

/** Join anında onaylanan metin; admit'e kadar yalnız bellekte (lobi misafiri) tutulur. */
export interface GuestConsent {
  textId: string;
  version: number;
  sha256: string;
  at: Date;
  ip: string;
  userAgent: string;
}

/** Resolve: tenant'ın güncel metni. Yoksa seed eksik → bilinmeyen hata (500 + referans, loglanır). */
export async function currentConsentText(db: DbOrTx, tenantId: string): Promise<ConsentTextView> {
  const t = await db.consentText.findFirst({
    where: { tenantId, isCurrent: true },
    select: { id: true, version: true, body: true, sha256: true },
  });
  if (!t) throw new Error(`consent_text_missing tenant=${tenantId}`);
  return t;
}

/** Join (G-24, AC-127): id oturumun tenant'ının güncel sürümü değilse 400 (yok / eski / başka tenant ayırt edilmez). */
export async function acceptConsent(
  db: DbOrTx,
  tenantId: string,
  consentTextId: string,
  ctx: { ip: string; userAgent: string },
): Promise<GuestConsent> {
  const t = await db.consentText.findFirst({
    where: { id: consentTextId, tenantId, isCurrent: true },
    select: { id: true, version: true, sha256: true },
  });
  if (!t) {
    throw new AppError("VALIDATION", {
      message: "Aydınlatma metni güncel değil.",
      fields: { consentTextId: "Aydınlatma metni güncellendi; sayfayı yenileyip tekrar onaylayın." },
    });
  }
  return { textId: t.id, version: t.version, sha256: t.sha256, at: new Date(), ip: ctx.ip, userAgent: ctx.userAgent.slice(0, 300) };
}

/** Admit TX'inde (P3 atomik UPDATE'ten sonra) görüntüleme onayı: VIEW / GRANTED / UI + metin özeti (AC-29). */
export async function recordViewConsent(
  tx: DbOrTx,
  sessionId: string,
  tenantId: string,
  c: GuestConsent,
  requestId?: string,
): Promise<void> {
  // Bileşik FK'lar nedeniyle düz alanlar (unchecked input), `connect` değil (db-notlari P4).
  await tx.sessionConsent.create({
    data: {
      id: newId(),
      sessionId,
      tenantId,
      level: "VIEW",
      decision: "GRANTED",
      source: "UI",
      consentTextId: c.textId,
      consentSha256: c.sha256,
      ip: c.ip.slice(0, 45),
      userAgent: c.userAgent,
      createdAt: c.at,
      ...(requestId ? { requestId } : {}), // P8b §13.3: "Ekranımı paylaş" onayı → talep formundaki onaya bağ
    },
  });
}

/** "Kötüye kullanımı bildir" adresi kaynağı (AC-125, S-P4-1). */
export interface AbuseEmailSource {
  fromEnv?: string | undefined;
  /** Super Admin e-postasına düşme yalnız dev/test'te; production'da ABUSE_EMAIL yoksa null (S-P4-1). */
  superAdminFallback: boolean;
}

/** AC-125 / V13: `ABUSE_EMAIL`; yoksa (yalnız dev/test) ilk aktif Super Admin e-postası; aksi halde null. */
export async function abuseEmail(db: DbOrTx, src: AbuseEmailSource): Promise<string | null> {
  if (src.fromEnv) return src.fromEnv;
  if (!src.superAdminFallback) return null;
  const u = await db.user.findFirst({
    where: { role: "SUPER_ADMIN", status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { email: true },
  });
  return u?.email ?? null;
}

export interface PublishedConsent {
  id: string;
  version: number;
  sha256: string;
  previous: { id: string; version: number; sha256: string } | null;
}

/**
 * Yeni aydınlatma metni sürümü (P11 düzenleme + seed ortak; çağıranın TX'inde). Sıra: güncel sürüm → `is_current=0`
 * (koşullu; 0 satır = eşzamanlı başka yayın → 409 CONFLICT) → max+1 INSERT. Eşzamanlı aynı sürüm numarası UQ(tenant,
 * version) ile reddedilir. Gövde ile sha256 DB CHECK'iyle bağlı. `null` = gövde güncel sürümle aynı (yeni sürüm yok).
 */
export async function publishConsentText(
  tx: Prisma.TransactionClient,
  tenantId: string,
  body: string,
  createdBy: string | null,
): Promise<PublishedConsent | null> {
  const sha256 = createHash("sha256").update(body, "utf8").digest("hex");
  const current = await tx.consentText.findFirst({
    where: { tenantId, isCurrent: true },
    select: { id: true, version: true, sha256: true },
  });
  if (current?.sha256 === sha256) return null;
  const last = await tx.consentText.findFirst({ where: { tenantId }, orderBy: { version: "desc" }, select: { version: true } });
  if (current) {
    const { count } = await tx.consentText.updateMany({ where: { id: current.id, isCurrent: true }, data: { isCurrent: false } });
    if (count !== 1) throw new AppError("CONFLICT", { message: "Metin aynı anda başka biri tarafından değiştirildi. Sayfayı yenileyin." });
  }
  const id = newId();
  const version = (last?.version ?? 0) + 1;
  await tx.consentText.create({ data: { id, tenantId, version, body, sha256, isCurrent: true, createdBy }, select: { id: true } });
  return { id, version, sha256, previous: current };
}
