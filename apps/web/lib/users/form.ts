/*
 * Kullanıcı ve firma formları (P9): istemci doğrulaması sözleşme zod şemalarıyla (lib/users/contract.ts — contracts'a
 * geçince aynı şema sunucuyla ortak). Alan bazlı Türkçe hata; sunucu 400/409 `fields` yolları alanlara yansır.
 */
import type { z } from "zod";
import {
  createTenantInputSchema,
  createUserInputSchema,
  type CreateTenantInput,
  type CreateUserInput,
  type ManagedRole,
  type TenantItem,
  type UpdateTenantInput,
  type UpdateUserInput,
  type UserDetail,
} from "./contract";
import { changedKeys, type PermState } from "./permissions";

export type Errors<F extends string> = Partial<Record<F, string>>;

function issuesToErrors<F extends string>(error: z.ZodError, fields: readonly F[]): Errors<F> {
  const out: Errors<F> = {};
  for (const i of error.issues) {
    const k = String(i.path[0] ?? "") as F;
    if (fields.includes(k) && !out[k]) out[k] = i.message;
  }
  return out;
}

/** Sunucu `fields` → bilinen alanlar + kalan mesajlar (form üstünde). */
export function splitServerFields<F extends string>(fields: Record<string, string>, known: readonly F[]): { errors: Errors<F>; rest: string[] } {
  const errors: Errors<F> = {};
  const rest: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    const root = k.split(".")[0] as F;
    if (known.includes(root) && root !== ("permissions" as F)) errors[root] ??= v;
    else rest.push(v);
  }
  return { errors, rest };
}

/* ---------- Kullanıcı ---------- */

export const USER_FIELDS = ["fullName", "email", "role"] as const;
export type UserField = (typeof USER_FIELDS)[number];
export interface UserDraft {
  fullName: string;
  email: string;
  role: ManagedRole;
}

export const emptyUserDraft = (): UserDraft => ({ fullName: "", email: "", role: "USER" });
export const userDraftOf = (u: Pick<UserDetail, "fullName" | "email" | "role">): UserDraft => ({
  fullName: u.fullName,
  email: u.email,
  role: u.role === "ADMIN" ? "ADMIN" : "USER",
});

export function buildCreateUser(d: UserDraft, permissions: PermState): { ok: true; body: CreateUserInput } | { ok: false; errors: Errors<UserField> } {
  const r = createUserInputSchema.safeParse({ ...d, permissions });
  return r.success ? { ok: true, body: r.data } : { ok: false, errors: issuesToErrors(r.error, USER_FIELDS) };
}

/**
 * PATCH gövdesi: yalnız değişen profil alanları; rol aynıysa yalnız DEĞİŞEN yetki anahtarları (kilitli/dokunulmamış
 * anahtar gönderilmez → Admin'in sahip olmadığı yetki isteğe hiç girmez, AC-73). Değişiklik yoksa boş nesne.
 *
 * Rol değişirse TÜM anahtarlar ekrandaki değerleriyle açıkça gönderilir: sunucu (`users/service.ts` normalizeRows)
 * gövdede olmayan ve ezmesi olmayan anahtarı YENİ rolün varsayılanıyla (`roleDefaultGranted`) hesaplar. Kilitli bir
 * anahtar ekranda eski değerinde kalır (ör. USER→ADMIN'de kapalı); gönderilmezse sunucu onu açık sayar ve AC-73
 * 403'ü döner. Açıkça gönderilen ama etkin değeri değişmeyen anahtar sunucu küme kontrolüne takılmaz.
 */
export function buildUpdateUser(
  d: UserDraft,
  base: UserDraft,
  perms: PermState,
  basePerms: PermState,
): { ok: true; body: UpdateUserInput } | { ok: false; errors: Errors<UserField> } {
  const parsed = createUserInputSchema.safeParse(d);
  if (!parsed.success) return { ok: false, errors: issuesToErrors(parsed.error, USER_FIELDS) };
  const body: UpdateUserInput = {};
  if (parsed.data.fullName !== base.fullName.trim()) body.fullName = parsed.data.fullName;
  if (parsed.data.email !== base.email.trim().toLowerCase()) body.email = parsed.data.email;
  if (d.role !== base.role) body.role = d.role;
  const changed = d.role !== base.role ? Object.keys(perms) : changedKeys(perms, basePerms);
  if (changed.length) body.permissions = Object.fromEntries(changed.map((k) => [k, perms[k] === true]));
  return { ok: true, body };
}

export const userDraftDirty = (a: UserDraft, b: UserDraft) => a.fullName !== b.fullName || a.email !== b.email || a.role !== b.role;

/* ---------- Firma ---------- */

export const TENANT_FIELDS = ["name", "slug"] as const;
export type TenantField = (typeof TENANT_FIELDS)[number];
export interface TenantDraft {
  name: string;
  slug: string;
}

const TR_FOLD: Record<string, string> = { ç: "c", ğ: "g", ı: "i", i: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };

/** Firma adından kısa ad önerisi: Türkçe harfler katlanır, harf/rakam dışı tire, en çok 60. "Şişli Bilişim A.Ş." → "sisli-bilisim-a-s". */
export function suggestSlug(name: string): string {
  const folded = [...name.toLocaleLowerCase("tr-TR")].map((c) => TR_FOLD[c] ?? c).join("");
  return folded
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

export const tenantDraftOf = (x?: Pick<TenantItem, "name" | "slug">): TenantDraft => ({ name: x?.name ?? "", slug: x?.slug ?? "" });

export function buildTenant(d: TenantDraft, base?: TenantDraft): { ok: true; body: CreateTenantInput | UpdateTenantInput } | { ok: false; errors: Errors<TenantField> } {
  const r = createTenantInputSchema.safeParse(d);
  if (!r.success) return { ok: false, errors: issuesToErrors(r.error, TENANT_FIELDS) };
  if (!base) return { ok: true, body: r.data };
  const body: UpdateTenantInput = {};
  if (r.data.name !== base.name) body.name = r.data.name;
  if (r.data.slug !== base.slug) body.slug = r.data.slug;
  return { ok: true, body };
}
