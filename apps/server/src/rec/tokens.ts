// P28e kayıt belirteç tablosu (mimari-p28e r2 §5 "Belirteçler", S-P28e-3/6; ADR-0005). P28b `TokenTable` ile AYNI kalıp: 32 bayt
// rastgele base64url (`newSecretToken`), tabloda yalnız SHA-256'sı, bellek içi (yeniden başlatmada düşer). Ayrı örnek: P28b
// tablosunun `dropRoom` (oda kapanışında anında siler) ve `fid` alanına bağlı kuralları kayıt belirteçlerinin 15 sn payıyla ve
// geçmişten izlemeyle çelişir (sapma notu `docs/tmp-impl-p28e-k3.md`). Tür alanları `rec/types.ts`'te.
import { newSecretToken, sha256Hex } from "../lib/ids.ts";
import type { RecUploadTokenEntry, RecViewTokenEntry } from "./types.ts";

export type RecTokenEntry = RecUploadTokenEntry | RecViewTokenEntry;

export class RecTokenTable {
  private readonly map = new Map<string, RecTokenEntry>();

  get size(): number {
    return this.map.size;
  }

  issue(e: RecTokenEntry): string {
    const token = newSecretToken();
    this.map.set(sha256Hex(token), e);
    return token;
  }

  /** Kayıt (süre denetimi çağıranda: izleme belirteci kayan süreli, yükleme belirteci olay güdümlü). */
  get(token: string): RecTokenEntry | null {
    return this.map.get(sha256Hex(token)) ?? null;
  }

  /** Koşula uyan kayıtları siler; silinenleri döner (izleme düşüşünde `recording.view.end` yazılır). */
  drop(match: (e: RecTokenEntry) => boolean): RecTokenEntry[] {
    const out: RecTokenEntry[] = [];
    for (const [k, e] of this.map) {
      if (!match(e)) continue;
      this.map.delete(k);
      out.push(e);
    }
    return out;
  }

  /** Koşula uyan kayıtlar (silmeden). */
  find(match: (e: RecTokenEntry) => boolean): RecTokenEntry[] {
    return [...this.map.values()].filter(match);
  }

  /** Tek kaydı (aynı nesne) siler; zaten düştüyse false. */
  remove(entry: RecTokenEntry): boolean {
    for (const [k, e] of this.map) {
      if (e !== entry) continue;
      this.map.delete(k);
      return true;
    }
    return false;
  }
}
