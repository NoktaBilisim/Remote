// Yetki anahtarlarının TEK tanımı (AC-71, AC-72; mimari-api.md "Yetki anahtarları").
// Toggle ekranı, sunucu `requirePerm` ve /auth/me bu listeden üretilir; başka yerde elle liste tutulmaz.
// Yeni modül/alt yetki yalnız buraya eklenir.

export const PERMISSION_MODULES = [
  { key: "sessions", actions: ["view", "create", "edit", "delete", "terminate"] },
  { key: "remote_control", actions: ["use"] },
  { key: "file_transfer", actions: ["use"] },
  { key: "session_history", actions: ["view", "edit", "export"] },
  // P8b (AC-147): view = kuyruk, geçmiş, panel bildirimi; accept = kabul VE ret (sessions.create gerekmez, mimari-e9 §4).
  // P15 (AC-235): block = talep engelleri (IP/önek, cihaz) listele/ekle/kaldır.
  { key: "support_requests", actions: ["view", "accept", "block"] },
  // P8c (AC-165): view = liste, detay, Genel bağlantı, oturumda seçim; edit = düzenle, bağlantıyı yenile, yeniden aktif et,
  // tek kayıt iptali; delete = PASİFE ALMA (kalıcı silme yok — V23).
  { key: "customers", actions: ["view", "create", "edit", "delete"] },
  { key: "users", actions: ["view", "create", "edit", "delete"] },
  { key: "settings", actions: ["view", "edit"] },
  { key: "audit", actions: ["view", "export"] },
] as const;

type PermissionModule = (typeof PERMISSION_MODULES)[number];
export type PermissionKey = PermissionModule extends infer M
  ? M extends { key: infer K extends string; actions: readonly (infer A extends string)[] }
    ? `${K}.${A}`
    : never
  : never;

/** Modül tanımından anahtar listesi (`modül.eylem`). AC-72 testi geçici modülle aynı üretimi kullanır. */
export function permissionKeysOf(modules: readonly { key: string; actions: readonly string[] }[]): PermissionKey[] {
  return modules.flatMap((m) => m.actions.map((a) => `${m.key}.${a}` as PermissionKey));
}

export const PERMISSION_KEYS: readonly PermissionKey[] = permissionKeysOf(PERMISSION_MODULES);

/**
 * P9 (mimari-e9 §13.2): toggle ekranında alt yetki açıklaması — yalnız davranışı adından anlaşılmayan anahtarlar.
 * Etiketler web sözlüğündedir; açıklama yoksa ekran yalnız etiketi gösterir.
 */
export const PERMISSION_DESCRIPTIONS: Readonly<Partial<Record<PermissionKey, string>>> = {
  "sessions.terminate": "Etkin bir destek oturumunu yönetici olarak zorla sonlandırır.",
  "support_requests.accept":
    "Talep kabul et — kabul edilen talep için oturum açar (Oturum oluşturma yetkisi gerekmez; açık oturum sınırı geçerlidir). Reddetme de bu yetkiyle yapılır.",
  "customers.delete": "Müşteriyi pasife alır (kalıcı silme yoktur).",
  "users.edit": "Kullanıcı bilgilerini, rolünü ve yetkilerini değiştirir; kullanıcıyı pasife alır veya yeniden etkinleştirir.",
  "support_requests.block":
    "Belirli bir IP adresinden/ağdan veya bilgisayardan gelen destek taleplerini engeller; engelleri listeler ve kaldırır.",
  // P15 (AC-237): anahtar kalıcı kullanıcı silme ucunu korur (uç P16, ADR-0030). Pasife alma "Düzenle" yetkisiyle yapılır.
  // P16 (AC-237/241): DELETE /users/:id — yalnız pasif kullanıcı, ad onayı + step-up.
  "users.delete": 'Pasif kullanıcıyı kalıcı siler (geri alınamaz). Pasife alma "Düzenle" yetkisiyle yapılır.',
};

export const ROLES = ["SUPER_ADMIN", "ADMIN", "USER"] as const;
export type Role = (typeof ROLES)[number];

export interface PermissionOverride {
  permKey: string;
  granted: boolean;
}

/**
 * Etkin yetkiler (AC-73): SUPER_ADMIN tümü (toggle değil, rol); ADMIN varsayılan tümü açık,
 * USER varsayılan tümü kapalı; `user_permissions` satırları varsayılanı kullanıcı bazında ezer.
 * Tanımda olmayan (eski) anahtarlar yok sayılır.
 */
export function effectivePermissions(role: Role, overrides: readonly PermissionOverride[]): PermissionKey[] {
  return effectivePermissionsFrom(PERMISSION_KEYS, role, overrides);
}

/** `effectivePermissions`'ın verilen anahtar listesiyle çalışan hâli (AC-72 testi geçici anahtarla aynı kuralı kullanır). */
export function effectivePermissionsFrom(
  keys: readonly PermissionKey[],
  role: Role,
  overrides: readonly PermissionOverride[],
): PermissionKey[] {
  if (role === "SUPER_ADMIN") return [...keys];
  const byKey = new Map(overrides.map((o) => [o.permKey, o.granted]));
  const defaultGranted = role === "ADMIN";
  return keys.filter((key) => byKey.get(key) ?? defaultGranted);
}

/** Rol varsayılanı (AC-73): ADMIN açık, USER kapalı (SUPER_ADMIN toggle'a tabi değil, tümü açık). */
export const roleDefaultGranted = (role: Role): boolean => role !== "USER";
