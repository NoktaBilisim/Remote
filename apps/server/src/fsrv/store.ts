// P28b saklanan dosya deposu (mimari-p28b §2 `store.ts`, K-P28b-1; T13). Kök `FILES_DIR` (volume `stored_files`, uploads'tan
// ayrı). Göreli yol `{tenantId}/{rastgele24}.rsf` (DB `storage_rel` CHECK ile aynı); yükleme sırasında `.part`, son parçada
// fsync + rename. Yol her zaman sunucuda kurulur; regex + kök altında kalma denetimi → path traversal yok.
import { randomBytes } from "node:crypto";
import { lstat, mkdir, open, readdir, rename, rm, statfs, type FileHandle } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

const TENANT_RE = /^[0-9A-Z]{26}$/;
const NAME_RE = /^[A-Za-z0-9_-]{24}\.rsf$/;
const PART_RE = /^[A-Za-z0-9_-]{24}\.rsf\.part$/;
export const STORAGE_REL_RE = /^[0-9A-Z]{26}\/[A-Za-z0-9_-]{24}\.rsf$/;

export interface StoredListing {
  /** `tenant/ad.rsf` (yalnız biçime uyan düzenli dosyalar; `.part` için `rel` = hedefin yolu). */
  rel: string;
  part: boolean;
  mtimeMs: number;
}

export class FileStore {
  readonly root: string;
  /** Yalnız testler: `statfs` yerine sahte boş alan oranı (AC-362 disk %10). */
  freeRatioOverride: number | null = null;

  constructor(root: string) {
    this.root = resolve(root);
  }

  newRel(tenantId: string): string {
    if (!TENANT_RE.test(tenantId)) throw new Error("geçersiz firma kimliği");
    return `${tenantId}/${randomBytes(18).toString("base64url")}.rsf`;
  }

  abs(rel: string): string {
    if (!STORAGE_REL_RE.test(rel)) throw new Error("geçersiz dosya yolu");
    const full = resolve(this.root, rel);
    if (!full.startsWith(this.root + sep)) throw new Error("dosya kökü dışı");
    return full;
  }

  tenantDir(tenantId: string): string {
    if (!TENANT_RE.test(tenantId)) throw new Error("geçersiz firma kimliği");
    return join(this.root, tenantId);
  }

  /** `.part`'ı oluşturur (yoksa) ve başlığı yazar. */
  async createPart(rel: string, header: Buffer): Promise<void> {
    const part = `${this.abs(rel)}.part`;
    await mkdir(resolve(this.root, rel.split("/")[0] ?? ""), { recursive: true, mode: 0o750 });
    const fh = await open(part, "wx", 0o640);
    try {
      await fh.write(header, 0, header.length, 0);
      await fh.sync();
    } finally {
      await fh.close();
    }
  }

  /** `.part`'a konumlu yazım + fsync. */
  async writePart(rel: string, offset: number, data: Buffer): Promise<void> {
    const fh = await open(`${this.abs(rel)}.part`, "r+");
    try {
      await fh.write(data, 0, data.length, offset);
      await fh.sync();
    } finally {
      await fh.close();
    }
  }

  openPart(rel: string): Promise<FileHandle> {
    return open(`${this.abs(rel)}.part`, "r");
  }

  async commit(rel: string): Promise<void> {
    const full = this.abs(rel);
    await rename(`${full}.part`, full);
  }

  open(rel: string): Promise<FileHandle> {
    return open(this.abs(rel), "r");
  }

  async exists(rel: string): Promise<boolean> {
    const st = await lstat(this.abs(rel)).catch(() => null);
    return st?.isFile() ?? false;
  }

  /** `.rsf` ve `.part` silinir (yoksa sessiz). */
  async remove(rel: string): Promise<void> {
    const full = this.abs(rel);
    await rm(full, { force: true });
    await rm(`${full}.part`, { force: true });
  }

  async removeTenant(tenantId: string): Promise<void> {
    await rm(this.tenantDir(tenantId), { recursive: true, force: true });
  }

  /** Disk boş alan oranı (`statfs` bavail/blocks); okunamazsa 0 (fail-closed: yükleme reddedilir). */
  async freeRatio(): Promise<number> {
    if (this.freeRatioOverride !== null) return this.freeRatioOverride;
    try {
      const s = await statfs(this.root);
      return s.blocks > 0 ? s.bavail / s.blocks : 0;
    } catch {
      return 0;
    }
  }

  /** Mutabakat (§3.3 a): kök altındaki tüm biçime uygun dosyalar (sembolik bağlantı izlenmez). */
  async list(): Promise<StoredListing[]> {
    const out: StoredListing[] = [];
    const tenants = await readdir(this.root, { withFileTypes: true }).catch(() => []);
    for (const t of tenants) {
      if (!t.isDirectory() || !TENANT_RE.test(t.name)) continue;
      for (const f of await readdir(join(this.root, t.name), { withFileTypes: true }).catch(() => [])) {
        if (!f.isFile()) continue;
        const part = PART_RE.test(f.name);
        if (!part && !NAME_RE.test(f.name)) continue;
        const st = await lstat(join(this.root, t.name, f.name)).catch(() => null);
        if (!st?.isFile()) continue;
        out.push({ rel: `${t.name}/${part ? f.name.slice(0, -5) : f.name}`, part, mtimeMs: st.mtimeMs });
      }
    }
    return out;
  }

  async writable(): Promise<boolean> {
    try {
      await mkdir(this.root, { recursive: true, mode: 0o750 });
      const probe = join(this.root, `.probe-${randomBytes(4).toString("hex")}`);
      const fh = await open(probe, "wx");
      await fh.close();
      await rm(probe, { force: true });
      return true;
    } catch {
      return false;
    }
  }
}
