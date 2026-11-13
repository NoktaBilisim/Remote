// Logo/avatar yolu → URL (AC-81..83). Tüm `logoUrl`/`avatarUrl` alanları buradan üretilir (tek kaynak).
// Logo zinciri: firma logosu → sistem logosu → `/img/logo.png` (Nokta). Avatar yalnız görüntüleyen erişebiliyorsa döner.
import {
  DEFAULT_LOGO_URL,
  SYSTEM_PREFIX,
  avatarFileUrl,
  logoFileUrl,
  systemLogoFileUrl,
  systemLogoValueSchema,
} from "@remote/contracts/api/branding";
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";
import { isRelPath } from "./store.ts";

type DbOrTx = Db | Prisma.TransactionClient;

export const SYSTEM_LOGO_KEY = "system_logo";

/** Kayıtlı sistem logosunun göreli yolu; yoksa/bozuksa null. */
export async function systemLogoPath(db: DbOrTx): Promise<string | null> {
  const row = await db.systemSetting.findUnique({ where: { key: SYSTEM_LOGO_KEY }, select: { valueJson: true } });
  const parsed = systemLogoValueSchema.safeParse(row?.valueJson);
  return parsed.success ? parsed.data.path : null;
}

export const tenantLogoUrl = (path: string | null | undefined): string | null => (path && isRelPath(path) ? logoFileUrl(path) : null);

/** Sistem logosu URL'si (yoksa varsayılan Nokta logosu). */
export async function systemLogoUrl(db: DbOrTx): Promise<string> {
  const p = await systemLogoPath(db);
  return p ? systemLogoFileUrl(p) : DEFAULT_LOGO_URL;
}

/** Firma logosu → sistem logosu → varsayılan. */
export async function effectiveLogoUrl(db: DbOrTx, tenantLogoPath: string | null | undefined): Promise<string> {
  return tenantLogoUrl(tenantLogoPath) ?? (await systemLogoUrl(db));
}

/** E-posta için mutlak logo adresi (`PUBLIC_BASE_URL` + public URL). */
export async function mailLogoUrl(db: DbOrTx, publicBaseUrl: string, tenantId: string | null): Promise<string> {
  const t = tenantId ? await db.tenant.findUnique({ where: { id: tenantId }, select: { logoPath: true } }) : null;
  return `${publicBaseUrl.replace(/\/+$/, "")}${await effectiveLogoUrl(db, t?.logoPath)}`;
}

export interface AvatarViewer {
  role: string;
  /** Görüntüleyenin KENDİ tenant'ı (Super Admin'de null). */
  tenantId: string | null;
}

/** Avatar dosyasını bu kullanıcı görebilir mi: Super Admin hepsini; diğerleri yalnız kendi tenant klasörünü. */
export function canViewAvatar(viewer: AvatarViewer, prefix: string): boolean {
  if (viewer.role === "SUPER_ADMIN") return true;
  return prefix !== SYSTEM_PREFIX && prefix === viewer.tenantId;
}

/** Avatar URL'si; yol yoksa ya da görüntüleyen dosyaya erişemeyecekse null (UI baş harf rozeti). */
export function avatarUrlFor(path: string | null | undefined, viewer?: AvatarViewer): string | null {
  if (!path || !isRelPath(path)) return null;
  if (viewer && !canViewAvatar(viewer, path.split("/")[0] ?? "")) return null;
  return avatarFileUrl(path);
}
