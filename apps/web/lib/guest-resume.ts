/*
 * TEST-P4-1: müşteri sekmesi yenilenince (F5) aynı oturuma dönüş. Kabul sonrası `hello.reconnectToken` (ve her
 * yenilenen token) yalnız bu sekmenin sessionStorage'ında, link token'ının SHA-256 özetine bağlı `rs.resume.*`
 * anahtarında tutulur (link token'ı depoya yazılmaz). Oturum bitince / müşteri ayrılınca / dönüş reddedilince silinir.
 * Depolama veya Web Crypto yoksa özellik sessizce kapanır (eski davranış: "zaten kullanıldı").
 */
import { z } from "zod";
import { STORAGE_PREFIX } from "./session-storage";

const resumeSchema = z.object({
  reconnectToken: z.string().min(16).max(200),
  technicianName: z.string().max(100),
  customerName: z.string().max(100),
  verifyCode: z.string().max(10),
  /** Opak durum referansı (resolve.sessionRef): dönüş reddedilirse oturumun bitip bitmediğini sormak için. */
  sessionRef: z.string().min(1).max(200),
});
export type GuestResume = z.infer<typeof resumeSchema>;
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const store = (): Store | undefined => {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
};

/** Link token'ı → `rs.resume.<özet>`; Web Crypto yoksa null. */
export async function resumeKey(linkToken: string): Promise<string | null> {
  try {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(linkToken));
    const hex = [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${STORAGE_PREFIX}resume.${hex}`;
  } catch {
    return null;
  }
}

/** Bulunulan `/session/<token>` yolundan link token'ı (yalnız istemci). */
export function linkTokenFromPath(path: string = globalThis.location?.pathname ?? ""): string | null {
  return /^\/session\/([A-Za-z0-9_-]+)\/?$/.exec(path)?.[1] ?? null;
}

export function readResume(key: string, s: Store | undefined = store()): GuestResume | null {
  try {
    const raw = s?.getItem(key);
    if (!raw) return null;
    const r = resumeSchema.safeParse(JSON.parse(raw));
    if (r.success) return r.data;
    s?.removeItem(key);
  } catch {
    /* bozuk kayıt / depolama kapalı */
  }
  return null;
}

export function writeResume(key: string, data: GuestResume, s: Store | undefined = store()): void {
  try {
    s?.setItem(key, JSON.stringify(data));
  } catch {
    /* kota / gizli mod */
  }
}

export function forgetResume(key: string, s: Store | undefined = store()): void {
  try {
    s?.removeItem(key);
  } catch {
    /* depolama kapalı */
  }
}
