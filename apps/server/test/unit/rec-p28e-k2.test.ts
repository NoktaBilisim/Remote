// P28e-K2: logger redaksiyonu (S-P28e-6) ve K3/K4 arayüz sabitleri.
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/lib/logger.ts";
import { REC_METRICS, REC_PART_RESULTS } from "../../src/rec/types.ts";

const capture = () => {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { lines, logger: createLogger("info", sink) };
};

describe("P28e K2", () => {
  it("S-P28e-6: rec.state.upload.token ve hello.rec.upload.token loga açık yazılmaz", () => {
    const { lines, logger } = capture();
    logger.info({ msg: { t: "rec.state", upload: { token: "GizliYuklemeBelirteci1" } } }, "a");
    logger.info({ hello: { rec: { upload: { token: "GizliYuklemeBelirteci2" } } } }, "b");
    logger.info({ rec: { state: { upload: { token: "GizliYuklemeBelirteci3" } } } }, "c");
    const all = lines.join("");
    expect(all).not.toContain("GizliYuklemeBelirteci");
    expect(all).toContain("***");
  });

  it("AC-388: metrik adları ve parça sonuç etiketleri §11.2 ile aynı", () => {
    expect(Object.values(REC_METRICS)).toEqual([
      "rs_rec_active",
      "rs_rec_part_total",
      "rs_rec_stop_total",
      "rs_rec_bytes_total",
      "rs_rec_part_bytes",
      "rs_rec_view_throttled_total",
    ]);
    expect(REC_PART_RESULTS).toEqual(["ok", "dup", "order", "quota", "rate", "invalid", "gone", "busy", "stopped", "nosource"]);
  });
});
