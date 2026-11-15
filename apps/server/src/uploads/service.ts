// Logo / avatar / sistem logosu / tema servisi (AC-81..85, T16; ortak standart 1.5).
// Sıra: resim doğrulama + yeniden kodlama (TX dışında) → dosya atomik yazılır → TX: satır kilidi + yol güncelleme +
// audit → commit sonrası eski dosya silinir. TX düşerse yeni dosya silinir (yetim dosya kalmaz). Reddedilen yükleme
// `upload.rejected` (fail) audit'i yazar.
import type { AvatarResponse, LogoResponse, SystemLogoResponse, ThemeValue } from "@remote/contracts/api/branding";
import { SYSTEM_PREFIX } from "@remote/contracts/api/branding";
import { BRANDING_AUDIT } from "@remote/contracts/audit";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { processImage, type ImageKind } from "./image.ts";
import type { UploadStore } from "./store.ts";
import { SYSTEM_LOGO_KEY, avatarUrlFor, systemLogoPath, systemLogoUrl, tenantLogoUrl } from "./urls.ts";

export interface BrandingDeps {
  db: Db;
  store: UploadStore;
  log: { error(o: object, m: string): void };
}

type Tx = Prisma.TransactionClient;

const actor = (auth: AuthContext) => ({ userId: auth.user.id, username: auth.user.email });

async function dropFile(d: BrandingDeps, rel: string | null): Promise<void> {
  try {
    await d.store.remove(rel);
  } catch (err) {
    d.log.error({ err, alarm: "upload_cleanup" }, "eski yükleme dosyası silinemedi");
  }
}

/** Ham yüklemeyi doğrular/kodlar; ret → `upload.rejected` audit + aynı hata. */
async function encode(
  d: BrandingDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string | null,
  kind: ImageKind | "system_logo",
  read: () => Promise<Buffer>,
) {
  try {
    return await processImage(await read(), kind === "system_logo" ? "logo" : kind);
  } catch (err) {
    if (err instanceof AppError && (err.code === "INVALID_IMAGE" || err.code === "PAYLOAD_TOO_LARGE")) {
      const reason = err.code === "INVALID_IMAGE" ? "invalid_image" : "too_large";
      await writeAudit(d.db, ctx, {
        tenantId,
        ...actor(auth),
        action: BRANDING_AUDIT.UPLOAD_REJECTED,
        entity: "uploads",
        result: "fail",
        newValue: { kind, reason },
      });
    }
    throw err;
  }
}

/** Yeni dosyayı yazar, TX'te yolu değiştirir; eski yolu (varsa) commit sonrası siler. */
async function swap(
  d: BrandingDeps,
  prefix: string,
  img: { data: Buffer; ext: "png" | "webp" },
  write: (tx: Tx, rel: string) => Promise<string | null>,
): Promise<string> {
  const rel = await d.store.save(prefix, img.ext, img.data);
  let old: string | null;
  try {
    old = await d.db.$transaction((tx) => write(tx, rel));
  } catch (err) {
    await dropFile(d, rel);
    throw err;
  }
  if (old !== rel) await dropFile(d, old);
  return rel;
}

async function lockTenantLogo(tx: Tx, tenantId: string): Promise<string | null> {
  const rows = await tx.$queryRaw<
    { logo_path: string | null }[]
  >`SELECT logo_path FROM tenants WHERE id = ${tenantId} AND deleted_at IS NULL FOR UPDATE`;
  if (rows.length === 0) throw new AppError("NOT_FOUND");
  return rows[0]?.logo_path ?? null;
}

async function lockAvatar(tx: Tx, userId: string): Promise<string | null> {
  const rows = await tx.$queryRaw<
    { avatar_path: string | null }[]
  >`SELECT avatar_path FROM users WHERE id = ${userId} AND deleted_at IS NULL FOR UPDATE`;
  if (rows.length === 0) throw new AppError("NOT_FOUND");
  return rows[0]?.avatar_path ?? null;
}

// --- firma logosu (AC-81) ---

export async function uploadTenantLogo(
  d: BrandingDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  read: () => Promise<Buffer>,
): Promise<LogoResponse> {
  const img = await encode(d, ctx, auth, tenantId, "logo", read);
  const rel = await swap(d, tenantId, img, async (tx, next) => {
    const old = await lockTenantLogo(tx, tenantId);
    await tx.tenant.update({ where: { id: tenantId }, data: { logoPath: next } });
    await writeAudit(tx, ctx, {
      tenantId,
      ...actor(auth),
      action: BRANDING_AUDIT.LOGO_UPDATED,
      entity: "tenants",
      entityId: tenantId,
      result: "success",
      oldValue: { path: old },
      newValue: { path: next, width: img.width, height: img.height },
    });
    return old;
  });
  return { logoUrl: tenantLogoUrl(rel) };
}

/** İdempotent: logo yoksa değişiklik ve audit yok. */
export async function removeTenantLogo(d: BrandingDeps, ctx: AuditContext, auth: AuthContext, tenantId: string): Promise<LogoResponse> {
  const old = await d.db.$transaction(async (tx) => {
    const cur = await lockTenantLogo(tx, tenantId);
    if (cur === null) return null;
    await tx.tenant.update({ where: { id: tenantId }, data: { logoPath: null } });
    await writeAudit(tx, ctx, {
      tenantId,
      ...actor(auth),
      action: BRANDING_AUDIT.LOGO_REMOVED,
      entity: "tenants",
      entityId: tenantId,
      result: "success",
      oldValue: { path: cur },
      newValue: { path: null },
    });
    return cur;
  });
  await dropFile(d, old);
  return { logoUrl: null };
}

// --- avatar (AC-83) ---

export interface AvatarTarget {
  id: string;
  /** Hedefin kendi tenant'ı (Super Admin → null → `system/`). */
  tenantId: string | null;
}

export async function uploadAvatar(
  d: BrandingDeps,
  ctx: AuditContext,
  auth: AuthContext,
  target: AvatarTarget,
  read: () => Promise<Buffer>,
): Promise<AvatarResponse> {
  const img = await encode(d, ctx, auth, target.tenantId, "avatar", read);
  const rel = await swap(d, target.tenantId ?? SYSTEM_PREFIX, img, async (tx, next) => {
    const old = await lockAvatar(tx, target.id);
    await tx.user.update({ where: { id: target.id }, data: { avatarPath: next } });
    await writeAudit(tx, ctx, {
      tenantId: target.tenantId,
      ...actor(auth),
      action: BRANDING_AUDIT.AVATAR_UPDATED,
      entity: "users",
      entityId: target.id,
      result: "success",
      oldValue: { path: old },
      newValue: { path: next },
    });
    return old;
  });
  return { avatarUrl: avatarUrlFor(rel) };
}

export async function removeAvatar(d: BrandingDeps, ctx: AuditContext, auth: AuthContext, target: AvatarTarget): Promise<AvatarResponse> {
  const old = await d.db.$transaction(async (tx) => {
    const cur = await lockAvatar(tx, target.id);
    if (cur === null) return null;
    await tx.user.update({ where: { id: target.id }, data: { avatarPath: null } });
    await writeAudit(tx, ctx, {
      tenantId: target.tenantId,
      ...actor(auth),
      action: BRANDING_AUDIT.AVATAR_REMOVED,
      entity: "users",
      entityId: target.id,
      result: "success",
      oldValue: { path: cur },
      newValue: { path: null },
    });
    return cur;
  });
  await dropFile(d, old);
  return { avatarUrl: null };
}

// --- sistem logosu (AC-82; P15 AC-233 kaldırma = `{path:null}` UPDATE — app'in system_settings DELETE yetkisi yok, V31) ---

export async function uploadSystemLogo(
  d: BrandingDeps,
  ctx: AuditContext,
  auth: AuthContext,
  read: () => Promise<Buffer>,
): Promise<SystemLogoResponse> {
  const img = await encode(d, ctx, auth, null, "system_logo", read);
  await swap(d, SYSTEM_PREFIX, img, async (tx, next) => {
    await tx.$queryRaw`SELECT \`key\` FROM system_settings WHERE \`key\` = ${SYSTEM_LOGO_KEY} FOR UPDATE`;
    const old = await systemLogoPath(tx);
    await tx.systemSetting.upsert({
      where: { key: SYSTEM_LOGO_KEY },
      create: { key: SYSTEM_LOGO_KEY, valueJson: { path: next }, updatedBy: auth.user.id },
      update: { valueJson: { path: next }, updatedBy: auth.user.id },
    });
    await writeAudit(tx, ctx, {
      tenantId: null,
      ...actor(auth),
      action: BRANDING_AUDIT.SYSTEM_LOGO_UPDATED,
      entity: "system_settings",
      entityId: SYSTEM_LOGO_KEY,
      result: "success",
      oldValue: { path: old },
      newValue: { path: next, width: img.width, height: img.height },
    });
    return old;
  });
  return { logoUrl: await systemLogoUrl(d.db) };
}

/**
 * DELETE /admin/settings/system-logo (P15, AC-233): satır kilidi + `{ path: null }` + audit tek TX; dosya commit SONRASI
 * silinir. Kayıtlı logo yoksa yazım ve audit yok (idempotent). Login/PDF/e-posta `systemLogoPath` null → varsayılan logo.
 */
export async function removeSystemLogo(d: BrandingDeps, ctx: AuditContext, auth: AuthContext): Promise<SystemLogoResponse> {
  const old = await d.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT \`key\` FROM system_settings WHERE \`key\` = ${SYSTEM_LOGO_KEY} FOR UPDATE`;
    const cur = await systemLogoPath(tx);
    if (cur === null) return null;
    await tx.systemSetting.update({ where: { key: SYSTEM_LOGO_KEY }, data: { valueJson: { path: null }, updatedBy: auth.user.id } });
    await writeAudit(tx, ctx, {
      tenantId: null,
      ...actor(auth),
      action: BRANDING_AUDIT.SYSTEM_LOGO_REMOVED,
      entity: "system_settings",
      entityId: SYSTEM_LOGO_KEY,
      result: "success",
      oldValue: { path: cur },
      newValue: { path: null },
    });
    return cur;
  });
  await dropFile(d, old);
  return { logoUrl: await systemLogoUrl(d.db) };
}

// --- tema (AC-85) ---

/** Değer aynıysa yazım/audit yok; değiştiyse aynı TX'te `user.theme_changed`. */
export async function setTheme(db: Db, ctx: AuditContext, auth: AuthContext, theme: ThemeValue): Promise<void> {
  await db.$transaction(async (tx) => {
    const cur = await tx.user.findUniqueOrThrow({ where: { id: auth.user.id }, select: { theme: true } });
    if (cur.theme === theme) return;
    await tx.user.update({ where: { id: auth.user.id }, data: { theme } });
    await writeAudit(tx, ctx, {
      tenantId: auth.user.tenantId,
      ...actor(auth),
      action: BRANDING_AUDIT.THEME_CHANGED,
      entity: "users",
      entityId: auth.user.id,
      result: "success",
      oldValue: { theme: cur.theme },
      newValue: { theme },
    });
  });
}
