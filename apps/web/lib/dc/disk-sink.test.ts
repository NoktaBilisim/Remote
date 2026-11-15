import { afterEach, describe, expect, it, vi } from "vitest";
import { DISK_MIN_BYTES, diskSink, FileTransfers, type FileChannelLike, type Transfer, type WritableLike } from "./files";
import type { CtlMessage } from "./ctl";

// S-P5-T2-1: showSaveFilePicker disk yolu. FileSystemWritableFileStream taklidi: doğrulanmayan içerik close() ile
// hedef ada kalıcılaşmaz; abort() çağrılır.
function writable(opts: { failWrite?: boolean } = {}) {
  const chunks: Uint8Array[] = [];
  const w = {
    write: vi.fn(async (d: Uint8Array) => {
      if (opts.failWrite) throw new Error("disk dolu");
      chunks.push(d);
    }),
    close: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
  } satisfies WritableLike;
  return { w, chunks };
}

describe("diskSink (S-P5-T2-1)", () => {
  it("özet tuttu → yazılanlar sırayla, close çağrılır, abort çağrılmaz; url yok", async () => {
    const { w, chunks } = writable();
    const s = diskSink(w);
    const a = new Uint8Array([1, 2]);
    s.write(a);
    a[0] = 9; // kopya yazılır: çağıranın tamponu değişse de içerik bozulmaz
    s.write(new Uint8Array([3]));
    await expect(s.finish(true)).resolves.toEqual({ ok: true });
    expect(chunks.map((c) => [...c])).toEqual([[1, 2], [3]]);
    expect(w.close).toHaveBeenCalledOnce();
    expect(w.abort).not.toHaveBeenCalled();
  });

  it("özet tutmadı → abort, close çağrılmaz", async () => {
    const { w } = writable();
    const s = diskSink(w);
    s.write(new Uint8Array([1]));
    await expect(s.finish(false)).resolves.toEqual({ ok: false });
    expect(w.abort).toHaveBeenCalledOnce();
    expect(w.close).not.toHaveBeenCalled();
  });

  it("yazım hatası → özet tutsa da bozuk sayılır, abort", async () => {
    const { w } = writable({ failWrite: true });
    const s = diskSink(w);
    s.write(new Uint8Array([1]));
    await expect(s.finish(true)).resolves.toEqual({ ok: false });
    expect(w.close).not.toHaveBeenCalled();
    expect(w.abort).toHaveBeenCalledOnce();
  });

  it("iptal (discard) → abort; bitmişse ikinci kez dokunulmaz", async () => {
    const { w } = writable();
    const s = diskSink(w);
    s.write(new Uint8Array([1]));
    s.discard();
    await vi.waitFor(() => expect(w.abort).toHaveBeenCalledOnce());
    expect(w.close).not.toHaveBeenCalled();
    const b = writable();
    const s2 = diskSink(b.w);
    await s2.finish(true);
    s2.discard();
    await Promise.resolve();
    expect(b.w.abort).not.toHaveBeenCalled();
  });
});

describe("kabul → disk yolu (FileTransfers)", () => {
  afterEach(() => {
    delete (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });

  function rig() {
    const ctl: CtlMessage[] = [];
    let list: Transfer[] = [];
    const file: FileChannelLike = {
      readyState: "open",
      bufferedAmount: 0,
      bufferedAmountLowThreshold: 0,
      send: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const ft = new FileTransfers({
      inbound: "TO_CUSTOMER",
      file,
      sendCtl: (m) => ctl.push(m),
      sendMeta: () => undefined,
      onChange: (l) => (list = l),
      allowed: () => true,
      maxBytes: 2 * DISK_MIN_BYTES,
    });
    return {
      ft,
      ctl,
      get list() {
        return list;
      },
    };
  }
  const offer = { t: "file.offer", fid: "big", idx: 0, name: "yedek.zip", size: DISK_MIN_BYTES + 1, sha256: "a".repeat(64) } as const;

  it("büyük dosyada kayıt yeri sorulur; karşı taraf iptal ederse yazıcı abort edilir, close edilmez", async () => {
    const { w } = writable();
    const pick = vi.fn(async () => ({ createWritable: async () => w }));
    (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker = pick;
    const r = rig();
    await r.ft.onCtl(offer);
    await r.ft.accept("big");
    expect(pick).toHaveBeenCalledWith({ suggestedName: "yedek.zip" });
    expect(r.ctl.at(-1)).toEqual({ t: "file.accept", fid: "big" });
    await r.ft.onCtl({ t: "file.cancel", fid: "big" });
    expect(r.list[0]?.status).toBe("cancelled");
    await vi.waitFor(() => expect(w.abort).toHaveBeenCalledOnce());
    expect(w.close).not.toHaveBeenCalled();
  });

  it("kayıt penceresi kapatılırsa (AbortError) teklif beklemede kalır, kabul gönderilmez", async () => {
    (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker = vi.fn(async () => {
      throw Object.assign(new Error("vazgeçti"), { name: "AbortError" });
    });
    const r = rig();
    await r.ft.onCtl(offer);
    await r.ft.accept("big");
    expect(r.list[0]?.status).toBe("pending");
    expect(r.ctl).toEqual([]);
  });
});
