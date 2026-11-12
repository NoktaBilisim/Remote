// Yetki anahtarlarının TEK tanımı (AC-71, AC-72; mimari-api.md "Yetki anahtarları").
// Toggle ekranı, sunucu `requirePerm` ve /auth/me bu listeden üretilir; başka yerde elle liste tutulmaz.
// Yeni modül/alt yetki yalnız buraya eklenir.

export const PERMISSION_MODULES = [
  { key: "sessions", actions: ["view", "create", "edit", "delete", "terminate"] },
  { key: "remote_control", actions: ["use"] },
  { key: "file_transfer", actions: ["use"] },
  { key: "session_history", actions: ["view", "edit", "export"] },
  // P8b (AC-147): view = kuyruk, geçmiş, panel bildirimi; accept = kabul VE ret (sessions.create gerekmez, mimari-e9 §4).
  { key: "support_requests", actions: ["view", "accept"] },
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

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSION_MODULES.flatMap((m) =>
  m.actions.map((a) => `${m.key}.${a}` as PermissionKey),
);

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
  if (role === "SUPER_ADMIN") return [...PERMISSION_KEYS];
  const byKey = new Map(overrides.map((o) => [o.permKey, o.granted]));
  const defaultGranted = role === "ADMIN";
  return PERMISSION_KEYS.filter((key) => byKey.get(key) ?? defaultGranted);
}
