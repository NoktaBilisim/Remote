/*
 * Gelen dosyanın hedefi ("disk" parçası, lib/dc/files.ts): bellek (tek kopya, 8 MB'lık Blob grupları) ya da
 * File System Access ile disk (doğrulanmadan kaydedilmez). Dışa açık adlar files.ts'den yeniden verilir.
 */

/** Bu boyuttan büyük gelen dosya, tarayıcı destekliyorsa doğrudan diske yazılır. */
export const DISK_MIN_BYTES = 256 * 1024 * 1024;
/** Disk akışı yokken bu boyutun üstünde kabul diyaloğunda bellek uyarısı. */
export const BIG_MEM_WARN_BYTES = 512 * 1024 * 1024;
const MEM_GROUP_BYTES = 8 * 1024 * 1024;

export interface WritableLike {
  write(d: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}
type SavePicker = (o: { suggestedName?: string }) => Promise<{ createWritable(): Promise<WritableLike> }>;
export const picker = (): SavePicker | undefined => (globalThis as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
/** Tarayıcı dosyayı doğrudan diske yazabiliyor mu (File System Access). */
export const canStreamToDisk = () => typeof picker() === "function";

/**
 * AC-230: kabul diyaloğundaki "256 MB üzeri doğrudan diske yazılır; seçtiğiniz dosyanın üzerine yazılır" uyarısı
 * gösterilsin mi? Yalnız eşik (`DISK_MIN_BYTES`) AŞILINCA ve tarayıcı diske akış destekliyorsa (kayıt penceresi açılacaksa).
 */
export function shouldWarnLargeWrite(bytes: number, streamToDisk: boolean = canStreamToDisk()): boolean {
  return streamToDisk && bytes > DISK_MIN_BYTES;
}

/** Alınan içeriğin hedefi: bellek (tek kopya, 8 MB'lık Blob grupları) ya da disk (doğrulanmadan kaydedilmez). */
export interface Sink {
  write(u: Uint8Array): void;
  /** ok=false → içerik atılır. Dönüş: başarılı mı + (bellekte) indirme adresi. */
  finish(ok: boolean): Promise<{ ok: boolean; url?: string }>;
  discard(): void;
}
export function memorySink(): Sink {
  let parts: Blob[] = [];
  let pend: Uint8Array[] = [];
  let pendBytes = 0;
  const flush = () => {
    if (pend.length) parts.push(new Blob(pend as BlobPart[]));
    pend = [];
    pendBytes = 0;
  };
  return {
    write(u) {
      pend.push(u.slice());
      pendBytes += u.byteLength;
      if (pendBytes >= MEM_GROUP_BYTES) flush();
    },
    async finish(ok) {
      flush();
      // S-P5-5: tür açıkça octet-stream — blob: adresi yeni sekmede açılırsa HTML/SVG olarak çizilmez
      const url = ok ? URL.createObjectURL(new Blob(parts, { type: "application/octet-stream" })) : undefined;
      parts = [];
      return { ok, url };
    },
    discard() {
      pend = [];
      parts = [];
    },
  };
}
/** Chromium: yazılanlar `close()`'a kadar geçici dosyada; bozuksa `abort()` ile hiç kaydedilmez. Dışa açık: birim testi (S-P5-T2-1). */
export function diskSink(w: WritableLike): Sink {
  let q: Promise<void> = Promise.resolve();
  let failed = false;
  let closed = false;
  return {
    write(u) {
      const c = u.slice();
      q = q.then(() => w.write(c)).catch(() => void (failed = true));
    },
    async finish(ok) {
      await q;
      closed = true;
      try {
        if (ok && !failed) {
          await w.close();
          return { ok: true };
        }
        await w.abort();
      } catch {
        /* yazılamadı → bozuk say */
      }
      return { ok: false };
    },
    discard() {
      if (closed) return;
      closed = true;
      void q.then(() => w.abort()).catch(() => undefined);
    },
  };
}
