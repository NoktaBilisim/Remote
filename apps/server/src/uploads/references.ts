// P16 (AC-243, S16-9; ADR-0030 m.7): `uploads/` dosyalarına DB'den verilen referansların TEK listesi. Yetim taraması
// (jobs/orphan-scan.ts) referans kümesini yalnız buradan kurar; listede olmayan kaynağın dosyaları 7 gün sonra silinir.
// Meta-test (orphan-scan-p16 AC-243): şemadaki bütün `*_path` sütunları bu listede olmalı — yeni dosya türü eklenince
// (P18+) burası güncellenmezse test kırılır.
import type { Db } from "../lib/db.ts";
import { isRelPath } from "./store.ts";
import { systemLogoPath } from "./urls.ts";

export interface UploadReferenceSource {
  /** Tablo ve sütun (meta-test eşlemesi; JSON içindeki değer için `value_json.path` gibi). */
  table: string;
  column: string;
  /** Geçerli göreli yollar (`öndek/ad.uzantı`); geçersiz değerler süzülür. */
  read(db: Db): Promise<string[]>;
}

const valid = (paths: (string | null)[]): string[] => paths.filter((p): p is string => p !== null && isRelPath(p));

export const UPLOAD_REFERENCE_SOURCES: readonly UploadReferenceSource[] = [
  {
    table: "tenants",
    column: "logo_path",
    read: async (db) =>
      valid((await db.tenant.findMany({ where: { logoPath: { not: null } }, select: { logoPath: true } })).map((r) => r.logoPath)),
  },
  {
    table: "users",
    column: "avatar_path",
    read: async (db) =>
      valid((await db.user.findMany({ where: { avatarPath: { not: null } }, select: { avatarPath: true } })).map((r) => r.avatarPath)),
  },
  {
    table: "system_settings",
    column: "value_json.path",
    read: async (db) => valid([await systemLogoPath(db)]),
  },
];

/** Bütün kaynakların birleşimi. Bir kaynak okunamazsa hata yukarı çıkar (tur silmeden biter — fail-closed). */
export async function readUploadReferences(
  db: Db,
  sources: readonly UploadReferenceSource[] = UPLOAD_REFERENCE_SOURCES,
): Promise<Set<string>> {
  const out = new Set<string>();
  for (const s of sources) for (const p of await s.read(db)) out.add(p);
  return out;
}
