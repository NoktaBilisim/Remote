/*
 * Yetki toggle ekranının saf mantığı (AC-71..73; Projeler/CLAUDE.md §1.3). Liste koddaki TEK tanımdan
 * (`PERMISSION_MODULES`, @remote/contracts/permissions) üretilir; burada elle anahtar listesi yok (AC-72).
 * Tanıma yeni modül/eylem eklenince matris, varsayılanlar ve kilitler başka değişiklik olmadan onu içerir;
 * etiket sözlükte yoksa anahtarın kendisi gösterilir (ekranda görünmesi garanti).
 */
import { PERMISSION_MODULES } from "@remote/contracts/permissions";
import tr from "@/messages/tr.json";
import type { ManagedRole } from "./contract";

/** Matrisin sabit sütunları (Görüntüle/Ekle/Düzenle/Sil/Dışa aktar); kalan eylemler "Diğer" sütununda. */
export const STANDARD_ACTIONS = ["view", "create", "edit", "delete", "export"] as const;
export type StandardAction = (typeof STANDARD_ACTIONS)[number];

export interface PermModule {
  key: string;
  actions: readonly string[];
}
/** anahtar → açık mı */
export type PermState = Record<string, boolean>;

export interface MatrixRow {
  module: string;
  /** Sabit sütun → yetki anahtarı (modülde o eylem yoksa null → "Uygulanmaz"). */
  cells: Record<StandardAction, string | null>;
  /** Sabit sütun dışındaki eylemler (ör. `sessions.terminate`, `remote_control.use`). */
  other: { key: string; action: string }[];
  /** Satırdaki tüm anahtarlar (grup "Tümünü aç/kapat"). */
  keys: string[];
}

const MODULES: readonly PermModule[] = PERMISSION_MODULES;

export function buildMatrix(modules: readonly PermModule[] = MODULES): MatrixRow[] {
  return modules.map((m) => {
    const cells = Object.fromEntries(STANDARD_ACTIONS.map((a) => [a, m.actions.includes(a) ? `${m.key}.${a}` : null])) as Record<
      StandardAction,
      string | null
    >;
    const other = m.actions
      .filter((a) => !(STANDARD_ACTIONS as readonly string[]).includes(a))
      .map((a) => ({ key: `${m.key}.${a}`, action: a }));
    return { module: m.key, cells, other, keys: m.actions.map((a) => `${m.key}.${a}`) };
  });
}

export const allKeys = (modules: readonly PermModule[] = MODULES): string[] =>
  modules.flatMap((m) => m.actions.map((a) => `${m.key}.${a}`));

/** Sunucudan gelen (eksik olabilen) yetki sözlüğü → tanımdaki her anahtar için boolean; tanım dışı anahtar atılır. */
export function normalize(perms: Partial<Record<string, boolean>> | undefined, modules: readonly PermModule[] = MODULES): PermState {
  return Object.fromEntries(allKeys(modules).map((k) => [k, perms?.[k] === true]));
}

/** AC-73: Admin varsayılan tümü açık, User tümü kapalı. */
export function roleDefaults(role: ManagedRole, modules: readonly PermModule[] = MODULES): PermState {
  return Object.fromEntries(allKeys(modules).map((k) => [k, role === "ADMIN"]));
}

/**
 * AC-73: işlemi yapan kişinin sahip olmadığı yetkiler kilitlidir (veremez ve — sunucu küme kontrolüyle tutarlı
 * kalsın diye — değiştiremez). Super Admin için kilit yok.
 */
export function lockedKeys(actor: { role: string; permissions: readonly string[] }, modules: readonly PermModule[] = MODULES): Set<string> {
  if (actor.role === "SUPER_ADMIN") return new Set();
  const own = new Set(actor.permissions);
  return new Set(allKeys(modules).filter((k) => !own.has(k)));
}

/** Grup anahtarının durumu: tümü açık → true, tümü kapalı → false, karışık → "mixed" (aria-checked). */
export function groupState(keys: readonly string[], state: PermState): boolean | "mixed" {
  const on = keys.filter((k) => state[k]).length;
  if (on === 0) return false;
  return on === keys.length ? true : "mixed";
}

/**
 * Grup "Tümünü aç/kapat": kilitsiz anahtarların hepsi açıksa hepsini kapatır, değilse hepsini açar.
 * Kilitli anahtarlar olduğu gibi kalır.
 */
export function toggleGroup(keys: readonly string[], state: PermState, locked: ReadonlySet<string>): PermState {
  const free = keys.filter((k) => !locked.has(k));
  if (free.length === 0) return state;
  const next = !free.every((k) => state[k]);
  return { ...state, ...Object.fromEntries(free.map((k) => [k, next])) };
}

export const groupLocked = (keys: readonly string[], locked: ReadonlySet<string>) => keys.every((k) => locked.has(k));

/** Rol değişince kilitsiz yetkiler o rolün varsayılanına döner; kilitli olanlar korunur. */
export function applyRoleDefaults(
  role: ManagedRole,
  state: PermState,
  locked: ReadonlySet<string>,
  modules: readonly PermModule[] = MODULES,
): PermState {
  const d = roleDefaults(role, modules);
  return Object.fromEntries(Object.keys(d).map((k) => [k, locked.has(k) ? state[k] === true : d[k] === true]));
}

/** İki durum arasında değeri farklı anahtarlar (kaydedilmemiş değişiklik + özet). */
export function changedKeys(a: PermState, b: PermState): string[] {
  return Object.keys({ ...a, ...b }).filter((k) => (a[k] === true) !== (b[k] === true));
}

const dict = tr as Record<string, string>;
/** Modül etiketi; sözlükte yoksa anahtarın kendisi (AC-72: yeni anahtar etiket eklenmeden de görünür). */
export const moduleLabel = (module: string) => dict[`perm.m.${module}`] ?? module;
/** Eylem etiketi; yoksa eylem adı. */
export const actionLabel = (action: string) => dict[`perm.a.${action}`] ?? action;

/** "modül.eylem" → "Audit log — Dışa aktar" (etiket yoksa anahtar parçaları). */
export function keyLabel(key: string): string {
  const i = key.lastIndexOf(".");
  if (i < 0) return key;
  const mod = moduleLabel(key.slice(0, i));
  const act = actionLabel(key.slice(i + 1));
  return (dict["perm.itemLabel"] ?? "{module} — {action}").replace("{module}", mod).replace("{action}", act);
}

/** AC-73 403 yanıtı `fields["permissions.<anahtar>"]` → verilemeyen yetkilerin etiketleri. */
export function forbiddenPermLabels(fields: Record<string, string> | undefined): string[] {
  return Object.keys(fields ?? {})
    .filter((k) => k.startsWith("permissions."))
    .map((k) => keyLabel(k.slice("permissions.".length)));
}
