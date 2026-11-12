/*
 * Sistem ayarları formlarının saf mantığı (bileşenden ayrı → birim testli). Gizli değerler (MySQL şifresi, TURN secret)
 * forma geri yazılmaz: durumda hep boş başlar, boş gönderilmez → sunucu kayıtlıyı korur (AC-78).
 */
import {
  MYSQL_DEFAULT_PORT,
  mysqlSettingsInputSchema,
  turnSettingsInputSchema,
  type MysqlSettingsData,
  type MysqlSettingsView,
  type TurnSettingsData,
  type TurnSettingsView,
} from "./contract";

export type MysqlField = "host" | "port" | "database" | "user" | "password";
export interface MysqlState {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
}

export function toMysqlState(v: MysqlSettingsView | null): MysqlState {
  return { host: v?.host ?? "", port: String(v?.port ?? MYSQL_DEFAULT_PORT), database: v?.database ?? "", user: v?.user ?? "", password: "" };
}

export const mysqlDirty = (a: MysqlState, b: MysqlState): boolean =>
  a.host.trim() !== b.host.trim() || a.port.trim() !== b.port.trim() || a.database.trim() !== b.database.trim() || a.user.trim() !== b.user.trim() || a.password !== "";

/** Alan hatalarını (ilk mesaj) toplar. Sunucu `fields` anahtarları da aynı adlarla gelir. */
function fieldErrors<F extends string>(issues: readonly { path: readonly PropertyKey[]; message: string }[], known: readonly F[]) {
  const errors: Partial<Record<F, string>> = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? "") as F;
    if (known.includes(k) && !errors[k]) errors[k] = i.message;
  }
  return errors;
}

const MYSQL_FIELDS: readonly MysqlField[] = ["host", "port", "database", "user", "password"];

/** Port metni → sayı (boş → varsayılan 3306; sayı değilse NaN → şema hatası). */
const portOf = (v: string): number | undefined => (v.trim() === "" ? undefined : /^\d{1,5}$/.test(v.trim()) ? Number(v.trim()) : Number.NaN);

export function buildMysqlInput(s: MysqlState): { input?: MysqlSettingsData; errors: Partial<Record<MysqlField, string>> } {
  const raw = { host: s.host, port: portOf(s.port), database: s.database, user: s.user, ...(s.password ? { password: s.password } : {}) };
  const p = mysqlSettingsInputSchema.safeParse(raw);
  if (!p.success) return { errors: fieldErrors(p.error.issues, MYSQL_FIELDS) };
  return { input: p.data, errors: {} };
}

/** Sunucu `fields` → alan hataları + alana bağlanamayanlar (form üstü). */
export function splitServerFields<F extends string>(fields: Record<string, string>, known: readonly F[]): { errors: Partial<Record<F, string>>; rest: string[] } {
  const errors: Partial<Record<F, string>> = {};
  const rest: string[] = [];
  for (const [k, msg] of Object.entries(fields)) {
    const head = k.split(".")[0] as F;
    if (known.includes(head) && !errors[head]) errors[head] = msg;
    else rest.push(msg);
  }
  return { errors, rest };
}
export const mysqlServerFields = (fields: Record<string, string>) => splitServerFields(fields, MYSQL_FIELDS);

export interface TurnState {
  urls: string[];
  secret: string;
}
export type TurnField = "urls" | "secret";
export type TurnErrors = { urls?: string; secret?: string; url?: Record<number, string> };

export const toTurnState = (v: TurnSettingsView | null): TurnState => ({ urls: v?.urls.length ? [...v.urls] : [""], secret: "" });

export const turnDirty = (a: TurnState, b: TurnState): boolean =>
  a.secret !== "" || a.urls.length !== b.urls.length || a.urls.some((u, i) => u.trim() !== (b.urls[i] ?? "").trim());

/** Boş satırlar atılır; satır başına hata `url[i]` (ekrandaki sıra). */
export function buildTurnInput(s: TurnState): { input?: TurnSettingsData; errors: TurnErrors } {
  const filled = s.urls.map((u, i) => ({ u: u.trim(), i })).filter((x) => x.u !== "");
  const p = turnSettingsInputSchema.safeParse({ urls: filled.map((x) => x.u), ...(s.secret ? { secret: s.secret } : {}) });
  if (p.success) return { input: p.data, errors: {} };
  const errors: TurnErrors = {};
  for (const issue of p.error.issues) {
    const [k, idx] = issue.path;
    if (k === "urls" && typeof idx === "number") {
      const row = filled[idx]?.i ?? idx;
      errors.url = { ...errors.url, [row]: errors.url?.[row] ?? issue.message };
    } else if (k === "urls") errors.urls ??= issue.message;
    else if (k === "secret") errors.secret ??= issue.message;
  }
  return { errors };
}

/** turn:/turns: adresi varsa secret zorunlu (DB şeması) — yazılmamış ve kayıtlı da değilse istemci kaydı engeller. */
export const needsTurnSecret = (urls: readonly string[]): boolean => urls.some((u) => /^turns?:/i.test(u.trim()));
