// P31-B1 birim (mimari-p31 K-P31-2/3, §15.1, §15.3; AC-509, AC-510, AC-520, AC-521): UA kararı, firma zip adı/deseni,
// K3 kaynak satırı.
import { describe, expect, it } from "vitest";
import { osFromUserAgent } from "../../src/lib/agent-os.ts";
import { renderFor } from "../../src/notify/customer-templates.ts";
import { UA } from "../helpers/user-agents.ts";
import { FIRM_ZIP_URI, parseFirmDownloadUri, requestDownloadLocation, requestFileName } from "../../src/requests/ref.ts";

describe("P31 osFromUserAgent (AC-509, AC-521)", () => {
  it("AC-509: Mac Safari ve Mac Chrome → macos", () => {
    expect(osFromUserAgent(UA.macSafari)).toBe("macos");
    expect(osFromUserAgent(UA.macChrome)).toBe("macos");
  });

  it('AC-509: iPad / iPhone ("like Mac OS X") → windows (bugünkü davranış)', () => {
    expect(osFromUserAgent(UA.iPad)).toBe("windows");
    expect(osFromUserAgent(UA.iPhone)).toBe("windows");
  });

  it("AC-509, AC-521: Windows, Linux, UA yok / boş → windows", () => {
    for (const ua of [UA.windows, UA.linux, undefined, ""]) expect(osFromUserAgent(ua)).toBe("windows");
  });
});

describe("P31 firma zip adı ve deseni (AC-510, K-P31-3)", () => {
  const ref = "abcdefghijklmnop";

  it("AC-510: macos → NoktaDestek-<label>-<ref>.zip; varsayılan (Windows) ad değişmez", () => {
    expect(requestFileName("Firma", ref, "macos")).toBe(`NoktaDestek-Firma-${ref}.zip`);
    expect(requestFileName("Firma", ref)).toBe(`NoktaDestek-Firma-${ref}.exe`);
    expect(requestDownloadLocation("Firma", ref, "macos")).toBe(`/downloads/NoktaDestek-Firma-${ref}.zip`);
  });

  it("AC-510: tam desen duyarlı — sorgu dizesi, maskeli yol, büyük harfli ref/önek, .exe, 21 karakter etiket reddedilir", () => {
    expect(FIRM_ZIP_URI.test(`/downloads/NoktaDestek-Firma-${ref}.zip`)).toBe(true);
    for (const uri of [
      `/downloads/NoktaDestek-Firma-${ref}.zip?x=1`,
      "/downloads/***",
      `/downloads/NoktaDestek-Firma-${ref.toUpperCase()}.zip`,
      `/downloads/noktadestek-Firma-${ref}.zip`,
      `/downloads/NoktaDestek-Firma-${ref}.exe`,
      `/downloads/NoktaDestek-${"A".repeat(21)}-${ref}.zip`,
      `/downloads/NoktaDestek-Firma-${ref}.ZIP`,
      "/downloads/NoktaDestek-macOS.zip",
      "",
    ])
      expect(FIRM_ZIP_URI.test(uri), uri).toBe(false);
  });

  it("T-P31-3: uzantı çaprazlanamaz — .zip yolu .exe ayrıştırıcısında, .exe yolu .zip ayrıştırıcısında null", () => {
    expect(parseFirmDownloadUri(`/downloads/NoktaDestek-Firma-${ref}.zip`, ".zip")).toEqual({ label: "Firma", ref });
    expect(parseFirmDownloadUri(`/downloads/NoktaDestek-Firma-${ref}.zip`, ".exe")).toBeNull();
    expect(parseFirmDownloadUri(`/downloads/NoktaDestek-Firma-${ref}.exe`, ".zip")).toBeNull();
  });
});

describe("P31 K3 kaynak satırı (AC-520, §15.3)", () => {
  const k3 = (origin: string) =>
    ({
      kind: "CUSTOMER",
      firm: "Nokta Bilişim",
      downloadUrl: `${origin}/api/v1/public/agent/request-download?ref=abcdefghijklmnop`,
      webFormUrl: null,
      origin,
    }) as const;

  it("AC-520: e-posta ve WhatsApp'ta 'Bağlantı her zaman https://{host}/ ile başlar; dosya eki göndermeyiz.'", () => {
    const line = "Bağlantı her zaman https://remote.noktabilisim.net/ ile başlar; dosya eki göndermeyiz.";
    for (const ch of ["EMAIL", "WHATSAPP"] as const) expect(renderFor(ch, k3("https://remote.noktabilisim.net")).text).toContain(line);
    expect(renderFor("EMAIL", k3("https://remote.noktabilisim.net")).bodyHtml).toContain(line);
  });

  it("AC-520: K3 indirme etiketi platformdan bağımsız — 'Hızlı Destek programı (Windows / macOS)', '(Windows):' yok", () => {
    for (const ch of ["EMAIL", "WHATSAPP", "SMS"] as const) {
      const r = renderFor(ch, k3("https://remote.noktabilisim.net"));
      const all = `${r.text}\n${r.bodyHtml ?? ""}`;
      expect(all).toContain("Hızlı Destek programı (Windows / macOS)");
      expect(all).not.toContain("(Windows):");
    }
  });

  it("AC-520: köken firma adı süzgecinden geçmez (rakamlı port korunur), HTML'de kaçışlı", () => {
    const r = renderFor("EMAIL", k3("https://185.126.217.99:4450"));
    expect(r.text).toContain("https://185.126.217.99:4450/ ile başlar");
    expect(renderFor("EMAIL", k3("https://x.test/<b>")).bodyHtml).toContain("https://x.test/&#60;b&#62;/");
  });
});
