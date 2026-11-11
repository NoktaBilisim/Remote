// P4: DataChannel temel zarfı (mimari-protokol §4) — boyut, JSON ve zarf doğrulaması.
import { describe, expect, it } from "vitest";
import { DC_CTL_MAX_BYTES, DC_LABELS, parseDcEnvelope } from "@remote/contracts/dc";

describe("DataChannel zarfı", () => {
  it("geçerli zarfı döner; kanal adları protokoldeki gibi", () => {
    expect(parseDcEnvelope(JSON.stringify({ t: "chat", id: "x" }))).toEqual({ t: "chat", id: "x" });
    expect(DC_LABELS).toEqual({ CTL: "ctl", FILE: "file", INPUT: "input" });
  });

  it("ikili veri, geçersiz JSON, zarfsız nesne ve 16 KB üstü (UTF-8 bayt) → null", () => {
    expect(parseDcEnvelope(new ArrayBuffer(4))).toBeNull();
    expect(parseDcEnvelope("{bozuk")).toBeNull();
    expect(parseDcEnvelope(JSON.stringify({ text: "t yok" }))).toBeNull();
    expect(parseDcEnvelope(JSON.stringify({ t: "" }))).toBeNull();
    const big = JSON.stringify({ t: "chat", pad: "ş".repeat(DC_CTL_MAX_BYTES / 2) });
    expect(big.length).toBeLessThan(DC_CTL_MAX_BYTES * 1.1);
    expect(parseDcEnvelope(big)).toBeNull();
  });
});
