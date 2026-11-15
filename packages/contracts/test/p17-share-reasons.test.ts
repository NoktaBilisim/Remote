import { describe, expect, it } from "vitest";
import reasonGo from "../../../apps/agent-win/internal/capture/reason.go?raw";
import { describeShareFailure, SHARE_FAIL_REASON_LABELS, SHARE_METHOD_LABELS } from "../src/labels.ts";
import { SHARE_FAIL_REASON_PATTERN, SHARE_METHODS } from "../src/ws.ts";

/** Go `capture.Reason` sabitleri: `ReasonX Reason = "KOD"` satırları (yalnız `type Reason` sabitleri). */
function goReasons(src: string): string[] {
  return [...src.matchAll(/^\s*Reason\w+\s+Reason\s*=\s*"([^"]+)"/gm)].map((m) => m[1] ?? "");
}

describe("P17 share.state neden kodları (AC-234, AC-248)", () => {
  const codes = goReasons(reasonGo);

  it("reason.go okunur ve bilinen sabitleri içerir (regex bozulursa test boş geçmez)", () => {
    expect(codes.length).toBeGreaterThanOrEqual(15);
    expect(codes).toContain("OTHER");
    expect(codes).toContain("WINDOW_CLOSED");
  });

  it("Go istemcisinin her neden kodu için Türkçe etiket var; tabloda Go'da olmayan kod yok", () => {
    expect([...codes].sort()).toEqual(Object.keys(SHARE_FAIL_REASON_LABELS).sort());
    for (const c of codes) {
      expect(c).toMatch(SHARE_FAIL_REASON_PATTERN);
      expect(SHARE_FAIL_REASON_LABELS[c]?.trim()).toBeTruthy();
    }
  });

  it("AC-248 pencere modu nedenleri Türkçe; 'Bilinmeyen neden' yoluna düşmez", () => {
    expect(describeShareFailure("WINDOW_CLOSED", "WGC")).toBe("Paylaşılan pencere kapatıldı — Pencere yakalama (WGC)");
    expect(describeShareFailure("WGC_UNSUPPORTED")).toBe("Bu Windows sürümü pencere paylaşımını desteklemiyor");
    expect(describeShareFailure("WINDOW_UNAVAILABLE")).not.toMatch("Bilinmeyen");
  });

  it("her yakalama yönteminin etiketi var", () => {
    for (const m of SHARE_METHODS) expect(SHARE_METHOD_LABELS[m]?.trim()).toBeTruthy();
  });
});
