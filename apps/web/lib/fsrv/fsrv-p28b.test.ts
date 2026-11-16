import { describe, expect, it } from "vitest";
import { FSRV_CHUNK_BYTES, FSRV_PRINT_FILE_NAME } from "@remote/contracts/ws-fsrv";
import { featureState } from "../clip/feature-state";
import type { Transfer } from "../dc/files";
import { sha256Hex } from "../dc/files";
import { PrintJobs, type PrintState } from "../print/print-send";
import { downloadVerified, fetchBlob } from "./download";
import { FsrvTransfers, type FsrvOut } from "./transfers";
import { uploadChunks } from "./upload";

// P28b K4 (mimari-p28b §4, §5, §9): sıralı 1 MiB parça, kopmada kaldığı yerden, belirteç yalnız başlıkta; indirme + SHA-256.
const FID = "01JFSRV0000000000000000001";
const TOKEN = "A".repeat(43);
const blob = (n: number) => new Blob([new Uint8Array(n).map((_, i) => i % 251)]);
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

interface Call {
  url: string;
  auth: string | null;
  credentials?: RequestCredentials;
  size: number;
}
function server(script: (n: number, call: number) => Response | "throw") {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const n = Number(/chunks\/(\d+)$/.exec(url)?.[1]);
    calls.push({
      url,
      auth: new Headers(init.headers).get("authorization"),
      credentials: init.credentials,
      size: init.body instanceof Blob ? init.body.size : 0,
    });
    const r = script(n, calls.length);
    if (r === "throw") throw new TypeError("network");
    return r;
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("uploadChunks", () => {
  it("sıralı 1 MiB parçalar, son parça kalan bayt; belirteç yalnız Authorization'da, çerez yok", async () => {
    const size = FSRV_CHUNK_BYTES * 2 + 10;
    const s = server((n) =>
      n === 2 ? json(202, { state: "SCANNING" }) : json(200, { next: n + 1, received: (n + 1) * FSRV_CHUNK_BYTES }),
    );
    const progress: number[] = [];
    const r = await uploadChunks({ fid: FID, token: TOKEN, file: blob(size), fetch: s.f, onProgress: (x) => progress.push(x) });
    expect(r).toBe("ok");
    expect(s.calls.map((c) => c.size)).toEqual([FSRV_CHUNK_BYTES, FSRV_CHUNK_BYTES, 10]);
    expect(s.calls.every((c) => c.auth === `Bearer ${TOKEN}` && c.credentials === "omit")).toBe(true);
    expect(s.calls.some((c) => c.url.includes(TOKEN))).toBe(false);
    expect(s.calls[0]!.url).toBe(`/api/v1/fsrv/uploads/${FID}/chunks/0`);
    expect(progress.at(-1)).toBe(size);
  });

  it("ağ kopması → aynı parça yeniden; 409 {next} → sunucunun beklediği parçadan devam", async () => {
    const s = server((n, call) => {
      if (call === 2) return "throw"; // parça 1 koptu
      if (call === 3) return json(409, { next: 2 }); // sunucu aslında 1'i almıştı
      return n === 2 ? json(202, { state: "SCANNING" }) : json(200, { next: n + 1, received: 0 });
    });
    const r = await uploadChunks({ fid: FID, token: TOKEN, file: blob(FSRV_CHUNK_BYTES * 3), fetch: s.f, retryDelayMs: () => 0 });
    expect(r).toBe("ok");
    expect(s.calls.map((c) => Number(/(\d+)$/.exec(c.url)![1]))).toEqual([0, 1, 1, 2]);
  });

  it("3 yeniden denemeden sonra başarısız; 409 STORAGE_QUOTA zarfı → kota; 404 → kalıcı", async () => {
    const down = server(() => "throw");
    expect(await uploadChunks({ fid: FID, token: TOKEN, file: blob(5), fetch: down.f, retryDelayMs: () => 0 })).toBe("failed");
    expect(down.calls).toHaveLength(4);
    const quota = server(() => json(409, { error: { code: "STORAGE_QUOTA", message: "Firma depolama kotası doldu" } }));
    expect(await uploadChunks({ fid: FID, token: TOKEN, file: blob(5), fetch: quota.f })).toBe("quota");
    const gone = server(() => json(404, { error: { code: "NOT_FOUND", message: "x" } }));
    expect(await uploadChunks({ fid: FID, token: TOKEN, file: blob(5), fetch: gone.f })).toBe("failed");
    expect(gone.calls).toHaveLength(1);
  });
});

describe("downloadVerified / fetchBlob", () => {
  it("SHA-256 eşleşince ok + blob adresi; uyuşmazsa corrupt; beyan edilenden fazla bayt kesilir", async () => {
    const data = blob(3000);
    const sha = await sha256Hex(data);
    const seen: (string | null)[] = [];
    const f = (async (_u: string, init: RequestInit) => {
      seen.push(new Headers(init.headers).get("authorization"));
      return new Response(data);
    }) as unknown as typeof fetch;
    const ok = await downloadVerified({ fid: FID, token: TOKEN, size: 3000, sha256: sha, fetch: f });
    expect(ok.kind).toBe("ok");
    expect(seen[0]).toBe(`Bearer ${TOKEN}`);
    const bad = await downloadVerified({ fid: FID, token: TOKEN, size: 3000, sha256: "0".repeat(64), fetch: f });
    expect(bad.kind).toBe("corrupt");
    const big = await downloadVerified({ fid: FID, token: TOKEN, size: 100, sha256: sha, fetch: f, attempts: 1 });
    expect(big.kind).toBe("failed");
    expect((await fetchBlob(FID, TOKEN, 5000, f))?.size).toBe(3000);
    expect(await fetchBlob(FID, TOKEN, 10, f)).toBeNull();
  });
});

function engine(inbound: "TO_TECH" | "TO_CUSTOMER", f?: typeof fetch) {
  const sent: FsrvOut[] = [];
  let list: Transfer[] = [];
  let n = 0;
  const x = new FsrvTransfers({
    inbound,
    sendWs: (m) => sent.push(m),
    onChange: (l) => (list = l),
    maxBytes: 10 * 1024 * 1024,
    allowed: () => true,
    newXid: () => `xid-test-${++n}`,
    fetch: f,
    retryDelayMs: () => 0,
  });
  return { x, sent, rows: () => list };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("FsrvTransfers", () => {
  it("gönderen: init → upload → tarama → temiz (müşteri onayı) → teslim edildi", async () => {
    const s = server(() => json(202, { state: "SCANNING" }));
    const e = engine("TO_TECH", s.f);
    expect(await e.x.send(new File([blob(10)], "rapor.pdf"))).toBe("ok");
    const init = e.sent[0] as Extract<FsrvOut, { t: "fsrv.init" }>;
    expect(init).toMatchObject({ t: "fsrv.init", name: "rapor.pdf", size: 10, purpose: "FILE" });
    e.x.onWs({ t: "fsrv.upload", xid: init.xid, fid: FID, token: TOKEN, chunkBytes: FSRV_CHUNK_BYTES, chunks: 1 });
    await flush();
    expect(e.rows()[0]!.status).toBe("scanning");
    e.x.onWs({ t: "fsrv.status", fid: FID, state: "CLEAN" });
    expect(e.rows()[0]).toMatchObject({ status: "offered", note: "Müşteri onayı bekleniyor" });
    expect(e.x.outBusy).toBe(true);
    e.x.onWs({ t: "fsrv.status", fid: FID, state: "DELIVERED" });
    expect(e.rows()[0]).toMatchObject({ status: "ok", note: "Teslim edildi" });
  });

  it("virüslü / taranamadı / kapı reddi metinleri (describeFsrvStatus); boş dosya gönderilmez", async () => {
    const e = engine("TO_TECH", server(() => json(202, {})).f);
    expect(await e.x.send(new File([], "bos.txt"))).toBe("empty");
    await e.x.send(new File([blob(4)], "a.zip"));
    const xid = (e.sent[0] as { xid: string }).xid;
    e.x.onWs({ t: "fsrv.upload", xid, fid: FID, token: TOKEN, chunkBytes: FSRV_CHUNK_BYTES, chunks: 1 });
    await flush();
    e.x.onWs({ t: "fsrv.status", fid: FID, state: "INFECTED", signature: "Eicar-Test-Signature" });
    expect(e.rows()[0]).toMatchObject({ status: "infected", note: "Dosya virüslü bulundu (Eicar-Test-Signature), teslim edilmedi" });
    await e.x.send(new File([blob(4)], "b.zip"));
    const xid2 = (e.sent.at(-1) as { xid: string }).xid;
    e.x.onWs({ t: "fsrv.status", xid: xid2, state: "REJECTED", reason: "QUOTA" });
    expect(e.rows()[1]).toMatchObject({ status: "gate", note: "Firma depolama kotası doldu" });
    await e.x.send(new File([blob(4)], "c.zip"));
    const xid3 = (e.sent.at(-1) as { xid: string }).xid;
    e.x.onWs({ t: "fsrv.upload", xid: xid3, fid: "01JFSRV0000000000000000003", token: TOKEN, chunkBytes: FSRV_CHUNK_BYTES, chunks: 1 });
    await flush();
    e.x.onWs({ t: "fsrv.status", fid: "01JFSRV0000000000000000003", state: "SCAN_FAILED", reason: "ENCRYPTED" });
    expect(e.rows()[2]!.note).toBe("Dosya taranamadı, teslim edilmedi: şifreli arşiv");
  });

  it("alıcı: teklif adı temizlenir + tehlike işareti; kabul → indir → SHA doğrula → fsrv.result{ok}", async () => {
    const data = blob(50);
    const sha = await sha256Hex(data);
    const f = (async () => new Response(data)) as unknown as typeof fetch;
    const e = engine("TO_CUSTOMER", f);
    e.x.onWs({ t: "fsrv.status", fid: FID, state: "SCANNING" });
    expect(e.rows()[0]).toMatchObject({ dir: "in", status: "scanning", name: "Gelen dosya" });
    e.x.onWs({ t: "fsrv.offer", fid: FID, name: "fatura.pdf.exe", size: 50, sha256: sha, purpose: "FILE" });
    expect(e.rows()).toHaveLength(1);
    expect(e.rows()[0]).toMatchObject({ status: "pending", dangerous: true, double: true });
    e.x.accept(FID);
    expect(e.sent.at(-1)).toEqual({ t: "fsrv.accept", fid: FID });
    e.x.onWs({ t: "fsrv.download", fid: FID, token: TOKEN, expiresAt: new Date().toISOString() });
    await new Promise((r) => setTimeout(r, 20));
    expect(e.sent.at(-1)).toEqual({ t: "fsrv.result", fid: FID, ok: true });
    expect(e.rows()[0]!.status).toBe("ok");
  });

  it("yazdırma teklifi tarayıcıda reddedilir (diyalog yok); ret → fsrv.reject", () => {
    const e = engine("TO_CUSTOMER");
    e.x.onWs({
      t: "fsrv.offer",
      fid: FID,
      name: FSRV_PRINT_FILE_NAME,
      size: 5,
      sha256: "a".repeat(64),
      purpose: "PRINT",
      pid: "pid-test-1",
    });
    expect(e.sent).toEqual([{ t: "fsrv.reject", fid: FID }]);
    expect(e.rows()).toEqual([]);
    e.x.onWs({ t: "fsrv.offer", fid: "01JFSRV0000000000000000002", name: "x.txt", size: 5, sha256: "a".repeat(64), purpose: "FILE" });
    e.x.reject("01JFSRV0000000000000000002");
    expect(e.sent.at(-1)).toEqual({ t: "fsrv.reject", fid: "01JFSRV0000000000000000002" });
  });
});

describe("P28b yazdırma sunucu yolu (§5.3)", () => {
  it("print.ready → fsrv.init{PRINT, pid, belge.pdf, aynı boyut}; DC print.offer yok; virüs metni ERROR'u ezer", async () => {
    const s = server(() => json(202, {}));
    const e = engine("TO_TECH", s.f);
    const ctl: unknown[] = [];
    let st: PrintState = { job: null, fieldError: null, cooldownUntil: 0 };
    const p = new PrintJobs({
      sendWs: () => undefined,
      sendCtl: (m) => (ctl.push(m), true),
      file: () => null,
      nextIdx: () => 0,
      fileBusy: () => false,
      sha256: sha256Hex,
      newId: () => "pid-test-1",
      onChange: (x) => (st = x),
      viaServer: (pid, file, sha, cb) => (e.x.sendPrint(pid, file, sha, cb), true),
      dropServer: () => e.x.dropPrint(),
    });
    const pdf = new File([new TextEncoder().encode("%PDF-1.7\n%%EOF\n")], "gizli.pdf", { type: "application/pdf" });
    await p.start(pdf);
    await p.onReady("pid-test-1");
    const init = e.sent[0] as Extract<FsrvOut, { t: "fsrv.init" }>;
    expect(init).toMatchObject({ purpose: "PRINT", pid: "pid-test-1", name: "belge.pdf", size: pdf.size });
    expect(ctl).toEqual([]);
    e.x.onWs({ t: "fsrv.upload", xid: init.xid, fid: FID, token: TOKEN, chunkBytes: FSRV_CHUNK_BYTES, chunks: 1 });
    await flush();
    expect(st.job?.phase).toBe("scanning");
    p.onStatus({ pid: "pid-test-1", result: "ERROR" });
    e.x.onWs({ t: "fsrv.status", fid: FID, state: "INFECTED" });
    // print.status{ERROR} önce gelse de virüs metni kazanır
    expect(e.rows()).toEqual([]);
    expect(st.job).toMatchObject({ phase: "done", outcome: "SERVER", message: "Dosya virüslü bulundu (bilinmeyen imza), teslim edilmedi" });
  });

  it("SERVER modunda misafirde fsrv yoksa yazdırma 'unsupported'", () => {
    const base = {
      feature: "print" as const,
      permitted: true,
      ready: true,
      guestPresent: true,
      guestKind: "AGENT" as const,
      unattended: false,
      controlGranted: true,
      clipConsent: false,
      busy: false,
    };
    expect(featureState({ ...base, guestFeatures: ["print"], serverFiles: true }).reason).toBe("unsupported");
    expect(featureState({ ...base, guestFeatures: ["print", "fsrv"], serverFiles: true }).enabled).toBe(true);
  });
});
