// Yükleme deposu (AC-84, T16). DB'deki göreli yol `{öndek}/{ad}.{uzantı}` (db-notlari P12); öndek tenant id'si veya
// `system`, ad kriptografik rastgele (base64url 18 bayt = 24 karakter). Yol her zaman sunucuda kurulur ve okunmadan
// önce regex + kök altında kalma kontrolünden geçer → path traversal imkânsız. Yazım atomik: aynı dizinde geçici dosya
// (adı regex'e uymaz, sunulamaz) + fsync + rename.
import { randomBytes } from "node:crypto";
import { lstat, mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { SYSTEM_PREFIX, TENANT_PREFIX_RE, UPLOAD_NAME_RE } from "@remote/contracts/api/branding";

export const isPrefix = (p: string): boolean => p === SYSTEM_PREFIX || TENANT_PREFIX_RE.test(p);
export const isFileName = (f: string): boolean => UPLOAD_NAME_RE.test(f);

/** `a/b` biçiminde geçerli göreli yol mu (tam olarak iki parça, ikisi de kurala uygun). */
export function isRelPath(rel: string): boolean {
  const parts = rel.split("/");
  return parts.length === 2 && isPrefix(parts[0] ?? "") && isFileName(parts[1] ?? "");
}

/** `save()`'in geçici dosyası: `<ad>.<uzantı>.<12 hex>.tmp` (sunulamaz; çökme artığı). */
const TMP_NAME_RE = /^[A-Za-z0-9_-]{16,100}\.(png|jpg|webp)\.[0-9a-f]{12}\.tmp$/;
/** P16 (AC-243): yetim taraması durum dosyası (kök altında; öndek klasörü değil → hiçbir zaman sunulmaz/taranmaz). */
const ORPHANS_FILE = ".orphans.json";

interface UploadListing {
  /** Geçerli göreli yollu düzenli dosyalar (`öndek/ad.uzantı`) ve değişiklik zamanı. */
  files: { rel: string; mtimeMs: number }[];
  /** `save()` geçici dosya artıkları (`öndek/…tmp`). */
  tmp: { rel: string; mtimeMs: number }[];
}

/** Yetim kaydı: göreli yol → ilk görülme (ISO). */
export type OrphanState = { v: 1; lastSuccessAt: string | null; files: Record<string, string> };

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

  /**
   * P16 (S16-2): öndek klasörünün mutlak yolu — yalnız geçerli öndek (`isPrefix`; firma silme `TENANT_PREFIX_RE` ile ayrıca
   * daraltır), `resolve` + kök altında kalma.
   */
  absDir(prefix: string): string {
    if (!isPrefix(prefix)) throw new Error("geçersiz öndek");
    const full = resolve(this.root, prefix);
    if (!full.startsWith(this.root + sep)) throw new Error("yükleme kökü dışı");
    return full;
  }

  /**
   * P16 (AC-243, S16-9): kök altındaki öndek klasörlerinin düzenli dosyaları. `lstat`/`Dirent` — sembolik bağlantı
   * izlenmez ve listelenmez (ne klasör ne dosya olarak); kural dışı adlar yok sayılır (silinmez).
   */
  async list(): Promise<UploadListing> {
    const out: UploadListing = { files: [], tmp: [] };
    let dirs;
    try {
      dirs = await readdir(this.root, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return out;
      throw err;
    }
    for (const d of dirs) {
      if (!d.isDirectory() || !isPrefix(d.name)) continue;
      const dir = this.absDir(d.name);
      for (const f of await readdir(dir, { withFileTypes: true })) {
        if (!f.isFile()) continue;
        const rel = `${d.name}/${f.name}`;
        const kind = isFileName(f.name) ? out.files : TMP_NAME_RE.test(f.name) ? out.tmp : null;
        if (!kind) continue;
        const st = await lstat(resolve(dir, f.name)).catch(() => null);
        if (st?.isFile()) kind.push({ rel, mtimeMs: st.mtimeMs });
      }
    }
    return out;
  }

  /** `save()` geçici artığını siler (yalnız kural uyan ad; kök altı). */
  async removeTmp(rel: string): Promise<void> {
    const [prefix = "", name = "", ...rest] = rel.split("/");
    if (rest.length > 0 || !TMP_NAME_RE.test(name)) return;
    await rm(resolve(this.absDir(prefix), name), { force: true });
  }

  /** Yetim durum dosyası; yoksa ya da bozuksa boş durum (bozuk dosya en kötü 7 günlük sayacı sıfırlar — silme değil). */
  async readOrphans(): Promise<OrphanState> {
    const empty: OrphanState = { v: 1, lastSuccessAt: null, files: {} };
    let raw: string;
    try {
      raw = await readFile(resolve(this.root, ORPHANS_FILE), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return empty;
      throw err;
    }
    try {
      const j = JSON.parse(raw) as Partial<OrphanState>;
      const files: Record<string, string> = {};
      for (const [k, v] of Object.entries(j.files ?? {}))
        if (isRelPath(k) && typeof v === "string" && !Number.isNaN(Date.parse(v))) files[k] = v;
      const last = typeof j.lastSuccessAt === "string" && !Number.isNaN(Date.parse(j.lastSuccessAt)) ? j.lastSuccessAt : null;
      return { v: 1, lastSuccessAt: last, files };
    } catch {
      return empty;
    }
  }

  /** Atomik yazım: aynı klasörde geçici dosya + fsync + rename (0600). */
  async writeOrphans(state: OrphanState): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o750 });
    const target = resolve(this.root, ORPHANS_FILE);
    const tmp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
    const fh = await open(tmp, "wx", 0o600);
    try {
      await fh.writeFile(JSON.stringify(state));
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
