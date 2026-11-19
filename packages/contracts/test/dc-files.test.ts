// P5 DC sözleşmesi + dosya adı güvenliği (mimari-protokol §4.1–4.2; AC-35, 36, 53, 54, 56, 57, 117, 119).
// Ortak fixture (fixtures/file-names.json) apps/server/test/unit/file-names.test.ts'te doğrulanır (node fs).
import { describe, expect, it } from "vitest";
import {
  ANNOT_MAX_POINTS,
  CHAT_MAX_CHARS,
  DC_CTL_MAX_BYTES,
  FILE_CHUNK_MAX_PAYLOAD,
  FileReceiveGuard,
  ctlAllowed,
  decodeFileChunk,
  encodeFileChunk,
  maxFileBytes,
  parseCtlMessage,
} from "../src/dc.ts";
import { DANGEROUS_EXT, fileNameWarning, isSanitizedFileName, receivedFileName, sanitizeFileName } from "../src/files.ts";

const sha = "0".repeat(64);
const j = (o: unknown) => JSON.stringify(o);

describe("P5 ctl mesajları", () => {
  it("AC-35: chat 1..2000 karakter, HTML düz metin olarak taşınır; fazlası/boş reddedilir", () => {
    expect(parseCtlMessage(j({ t: "chat", id: "m1", text: "<img src=x onerror=alert(1)>", ts: 1 }))).toMatchObject({
      text: "<img src=x onerror=alert(1)>",
    });
    expect(parseCtlMessage(j({ t: "chat", id: "m1", text: "a".repeat(CHAT_MAX_CHARS), ts: 1 }))).not.toBeNull();
    expect(parseCtlMessage(j({ t: "chat", id: "m1", text: "a".repeat(CHAT_MAX_CHARS + 1), ts: 1 }))).toBeNull();
    expect(parseCtlMessage(j({ t: "chat", id: "m1", text: "", ts: 1 }))).toBeNull();
    expect(parseCtlMessage(j({ t: "chat", id: "m1", text: "x", ts: 1, html: true }))).toBeNull();
  });

  it("AC-56/57: çizgi normalize (0..1), ≤ 500 nokta, 4 renk; lazer 0..1", () => {
    const pts = Array.from({ length: ANNOT_MAX_POINTS }, (_, i) => [i / ANNOT_MAX_POINTS, 0.5]);
    expect(parseCtlMessage(j({ t: "annot.stroke", id: "s1", tool: "arrow", color: "green", pts }))).not.toBeNull();
    expect(parseCtlMessage(j({ t: "annot.stroke", id: "s1", tool: "pen", color: "red", pts: [...pts, [0, 0]] }))).toBeNull();
    expect(parseCtlMessage(j({ t: "annot.stroke", id: "s1", tool: "pen", color: "pink", pts: [[0, 0]] }))).toBeNull();
    expect(parseCtlMessage(j({ t: "annot.stroke", id: "s1", tool: "pen", color: "red", pts: [[1.2, 0]] }))).toBeNull();
    expect(parseCtlMessage(j({ t: "annot.laser", x: 0.1, y: 1 }))).not.toBeNull();
    expect(parseCtlMessage(j({ t: "annot.laser", x: -0.1, y: 1 }))).toBeNull();
    expect(parseCtlMessage(j({ t: "annot.undo" }))).not.toBeNull();
    expect(parseCtlMessage(j({ t: "annot.clear", id: "s1" }))).not.toBeNull();
  });

  it("AC-119: control.* DC'de yok; file.* yalnız file_transfer caps ile; > 16 KB / ikili / bozuk JSON düşer", () => {
    expect(parseCtlMessage(j({ t: "control.request" }))).toBeNull();
    expect(ctlAllowed("file.offer", ["remote_control"])).toBe(false);
    expect(ctlAllowed("file.offer", ["file_transfer"])).toBe(true);
    expect(ctlAllowed("chat", [])).toBe(true);
    expect(parseCtlMessage(j({ t: "chat", id: "m", text: "x".repeat(DC_CTL_MAX_BYTES), ts: 1 }))).toBeNull();
    expect(parseCtlMessage(new ArrayBuffer(4))).toBeNull();
    expect(parseCtlMessage("{")).toBeNull();
  });

  it("AC-53/54: file.offer şeması (sha256 küçük harf, boyut ≤ 2 GiB), file.result", () => {
    const offer = { t: "file.offer", fid: "f1", idx: 1, name: "rapor.pdf", size: 1024, sha256: sha };
    expect(parseCtlMessage(j(offer))).not.toBeNull();
    expect(parseCtlMessage(j({ ...offer, sha256: "A".repeat(64) }))).toBeNull();
    expect(parseCtlMessage(j({ ...offer, size: 2 ** 31 + 1 }))).toBeNull();
    expect(parseCtlMessage(j({ ...offer, idx: 70000 }))).toBeNull();
    expect(parseCtlMessage(j({ t: "file.result", fid: "f1", ok: false }))).not.toBeNull();
    for (const t of ["file.accept", "file.reject", "file.cancel", "file.done"]) expect(parseCtlMessage(j({ t, fid: "f1" }))).not.toBeNull();
    expect(maxFileBytes(100)).toBe(104_857_600);
    expect(maxFileBytes(4096)).toBe(2048 * 1024 * 1024);
  });
});

describe("P5 file kanalı", () => {
  it("çerçeve kodla/çöz: fidIndex uint16 + seq uint32 + payload ≤ 16 KB", () => {
    const f = decodeFileChunk(encodeFileChunk(513, 70_000, new Uint8Array([1, 2, 3])));
    expect(f).toMatchObject({ fidIndex: 513, seq: 70_000 });
    expect([...(f?.payload ?? [])]).toEqual([1, 2, 3]);
    expect(decodeFileChunk(new Uint8Array(5))).toBeNull();
    expect(decodeFileChunk(new Uint8Array(6 + FILE_CHUNK_MAX_PAYLOAD + 1))).toBeNull();
    expect(() => encodeFileChunk(0, 0, new Uint8Array(FILE_CHUNK_MAX_PAYLOAD + 1))).toThrow();
  });

  it("AC-117: sınır alınan bayt sayacıyla — beyandan fazla gelen veri iptal; sıra dışı parça", () => {
    const g = new FileReceiveGuard(10, 100);
    expect(g.add({ seq: 0, payload: new Uint8Array(8) })).toBe("ok");
    expect(g.complete()).toBe(false);
    expect(g.add({ seq: 1, payload: new Uint8Array(3) })).toBe("exceeded");
    const lim = new FileReceiveGuard(1000, 10); // beyan tenant sınırını aşıyor → tenant sınırı geçerli
    expect(lim.add({ seq: 0, payload: new Uint8Array(11) })).toBe("exceeded");
    const ord = new FileReceiveGuard(10, 100);
    expect(ord.add({ seq: 1, payload: new Uint8Array(1) })).toBe("out_of_order");
    const ok = new FileReceiveGuard(4, 100);
    ok.add({ seq: 0, payload: new Uint8Array(4) });
    expect(ok.complete()).toBe(true);
  });
});

describe("P5 dosya adı (G-06)", () => {
  it("AC-117: yol, yasak karakter, RTLO, ayrılmış ad, uzunluk", () => {
    expect(sanitizeFileName("..\\..\\x\\evil.dll")).toBe("evil.dll");
    expect(sanitizeFileName("fatura‮txt.exe")).toBe("faturatxt.exe");
    expect(sanitizeFileName("aux.txt")).toBe("_aux.txt");
    expect(sanitizeFileName("..")).toBe("dosya");
    expect(Array.from(sanitizeFileName(`${"ğ".repeat(300)}.pdf`))).toHaveLength(255);
    expect(isSanitizedFileName("rapor.pdf")).toBe(true);
    expect(isSanitizedFileName("a:b")).toBe(false);
  });

  it("AC-36: tehlikeli uzantı ve çift uzantı uyarısı", () => {
    expect(fileNameWarning("setup.EXE")).toBe("dangerous");
    expect(fileNameWarning("fatura.pdf.exe")).toBe("double_extension");
    expect(fileNameWarning("rapor.pdf")).toBe("none");
  });
});

describe("P28g alınan dosya (mimari-p28g §5.4, S-P28g-6 m.3)", () => {
  it("AC-398 S-P28g-6: `destek-` önekli ad `Dosya-` ile yeniden adlandırılır, diğerleri değişmez", () => {
    expect(receivedFileName("Destek-12345678")).toBe("Dosya-Destek-12345678");
    expect(receivedFileName("dEsTeK-1.sh")).toBe("Dosya-dEsTeK-1.sh");
    expect(receivedFileName("rapor.pdf")).toBe("rapor.pdf");
    const long = receivedFileName(`Destek-${"x".repeat(300)}.pdf`);
    expect(Array.from(long).length).toBe(255);
    expect(long.endsWith(".pdf") && isSanitizedFileName(long)).toBe(true);
  });

  it("AC-117 T8: Linux çalıştırılabilir/paket türleri tehlikeli", () => {
    for (const e of [
      "desktop",
      "run",
      "bin",
      "appimage",
      "deb",
      "rpm",
      "snap",
      "flatpak",
      "flatpakref",
      "flatpakrepo",
      "so",
      "ko",
      "service",
    ]) {
      expect(DANGEROUS_EXT.has(e), e).toBe(true);
      expect(fileNameWarning(sanitizeFileName(`a.${e.toUpperCase()}`)), e).toBe("dangerous");
    }
  });
});
