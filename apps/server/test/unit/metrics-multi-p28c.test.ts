// P28c QA-1 (mimari-p28c §8): çoklu teknisyen sayaçları kayıtlı — etiketsiz "0" satırı (remote-watch multi-denied işareti)
// ilk retten önce de görünür; `inc` kayıtsız sayaçta sessizce düştüğü için kayıt şart.
import { describe, expect, it } from "vitest";
import { createMetrics } from "../../src/ops/metrics.ts";

describe("P28c metrikler (AC-367, AC-364)", () => {
  it("AC-367: rs_multi_denied_total ve rs_multi_invites_total kayıtlı; ilk olaydan önce etiketsiz 0", () => {
    const out = createMetrics().render().split("\n");
    expect(out).toContain("# TYPE rs_multi_denied_total counter");
    expect(out).toContain("rs_multi_denied_total 0");
    expect(out).toContain("# TYPE rs_multi_invites_total counter");
    expect(out).toContain("rs_multi_invites_total 0");
  });

  it("AC-364: inc sonrası etiketli seri sayılır (kayıt yoksa no-op olurdu)", () => {
    const m = createMetrics();
    m.inc("rs_multi_denied_total", { type: "input" });
    m.inc("rs_multi_denied_total", { type: "input" });
    m.inc("rs_multi_invites_total", { result: "sent" });
    const out = m.render().split("\n");
    expect(out).toContain('rs_multi_denied_total{type="input"} 2');
    expect(out).toContain('rs_multi_invites_total{result="sent"} 1');
    expect(out).not.toContain("rs_multi_denied_total 0");
  });
});
