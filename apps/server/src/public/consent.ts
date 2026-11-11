// KVKK aydınlatma metni + onay kaydı (P4; G-24, AC-29, AC-127; db-notlari "P4 → Backend-dev için").
// Metin tenant bazlı ve sürümlü; tenant başına tek `is_current` (DB fonksiyonel UQ). Onay kaydı append-only.
import type { ConsentTextView } from "@remote/contracts/api/sessions";
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";

type DbOrTx = Db | Prisma.TransactionClient;

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
  const t = await db.consentText.findFirst({ where: { tenantId, isCurrent: true }, select: { id: true, version: true, body: true, sha256: true } });
  if (!t) throw new Error(`consent_text_missing tenant=${tenantId}`);
  return t;
}

/** Join (G-24, AC-127): id oturumun tenant'ının güncel sürümü değilse 400 (yok / eski / başka tenant ayırt edilmez). */
export async function acceptConsent(db: DbOrTx, tenantId: string, consentTextId: string, ctx: { ip: string; userAgent: string }): Promise<GuestConsent> {
  const t = await db.consentText.findFirst({ where: { id: consentTextId, tenantId, isCurrent: true }, select: { id: true, version: true, sha256: true } });
  if (!t) {
    throw new AppError("VALIDATION", {
      message: "Aydınlatma metni güncel değil.",
      fields: { consentTextId: "Aydınlatma metni güncellendi; sayfayı yenileyip tekrar onaylayın." },
    });
  }
  return { textId: t.id, version: t.version, sha256: t.sha256, at: new Date(), ip: ctx.ip, userAgent: ctx.userAgent.slice(0, 300) };
}

/** Admit TX'inde (P3 atomik UPDATE'ten sonra) görüntüleme onayı: VIEW / GRANTED / UI + metin özeti (AC-29). */
export async function recordViewConsent(tx: DbOrTx, sessionId: string, tenantId: string, c: GuestConsent): Promise<void> {
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
  const u = await db.user.findFirst({ where: { role: "SUPER_ADMIN", status: "ACTIVE" }, orderBy: { createdAt: "asc" }, select: { email: true } });
  return u?.email ?? null;
}
