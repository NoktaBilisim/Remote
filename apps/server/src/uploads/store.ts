// Yükleme deposu (AC-84, T16). DB'deki göreli yol `{öndek}/{ad}.{uzantı}` (db-notlari P12); öndek tenant id'si veya
// `system`, ad kriptografik rastgele (base64url 18 bayt = 24 karakter). Yol her zaman sunucuda kurulur ve okunmadan
// önce regex + kök altında kalma kontrolünden geçer → path traversal imkânsız. Yazım atomik: aynı dizinde geçici dosya
// (adı regex'e uymaz, sunulamaz) + fsync + rename.
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { SYSTEM_PREFIX, TENANT_PREFIX_RE, UPLOAD_NAME_RE } from "@remote/contracts/api/branding";

export const isPrefix = (p: string): boolean => p === SYSTEM_PREFIX || TENANT_PREFIX_RE.test(p);
export const isFileName = (f: string): boolean => UPLOAD_NAME_RE.test(f);

/** `a/b` biçiminde geçerli göreli yol mu (tam olarak iki parça, ikisi de kurala uygun). */
export function isRelPath(rel: string): boolean {
  const parts = rel.split("/");
  return parts.length === 2 && isPrefix(parts[0] ?? "") && isFileName(parts[1] ?? "");
}

export class UploadStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private abs(rel: string): string {
    if (!isRelPath(rel)) throw new Error("geçersiz yükleme yolu");
    const full = resolve(this.root, rel);
    if (!full.startsWith(this.root + sep)) throw new Error("yükleme kökü dışı");
    return full;
  }

  /** Yeni rastgele adla yazar, göreli yolu döner. */
  async save(prefix: string, ext: "png" | "jpg" | "webp", data: Buffer): Promise<string> {
    if (!isPrefix(prefix)) throw new Error("geçersiz öndek");
    const rel = `${prefix}/${randomBytes(18).toString("base64url")}.${ext}`;
    const target = this.abs(rel);
    await mkdir(resolve(this.root, prefix), { recursive: true, mode: 0o750 });
    const tmp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
    const fh = await open(tmp, "wx", 0o640);
    try {
      await fh.writeFile(data);
      await fh.sync();
    } finally {
      await fh.close();
    }
    try {
      await rename(tmp, target);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
    return rel;
  }

  /** Yoksa null. */
  async read(rel: string): Promise<Buffer | null> {
    if (!isRelPath(rel)) return null;
    try {
      return await readFile(this.abs(rel));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  /** Sessiz silme (yoksa sorun değil); geçersiz yol hiç dokunulmaz. */
  async remove(rel: string | null): Promise<void> {
    if (!rel || !isRelPath(rel)) return;
    await rm(this.abs(rel), { force: true });
  }

  /** Açılışta yazılabilirlik denetimi (alarm logu için). */
  async writable(): Promise<boolean> {
    try {
      await mkdir(this.root, { recursive: true, mode: 0o750 });
      const probe = resolve(this.root, `.probe-${randomBytes(6).toString("hex")}`);
      const fh = await open(probe, "wx", 0o600);
      await fh.close();
      await rm(probe, { force: true });
      return true;
    } catch {
      return false;
    }
  }
}
