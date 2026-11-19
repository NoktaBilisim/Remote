import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { t } from "@/lib/i18n";
import { LINUX_RUN_COMMAND } from "@/lib/linux-command";
import { AgentDownload } from "./agent-download";
import { LinuxGuide } from "./linux-guide";

const noop = () => undefined;
const decode = (h: string) =>
  h
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

describe("P28g LINUX_RUN_COMMAND (S-P28g-6, mimari-p28g §4.3)", () => {
  it("mimari §4.3 kod bloğuyla bayt bayt aynı", () => {
    const doc = readFileSync(resolve(__dirname, "../../../../../docs/mimari-p28g.md"), "utf8");
    const sec = doc.slice(doc.indexOf("### 4.3"));
    const block = sec.split("  ```\n")[1]!.replace(/\n$/, "");
    expect(block.slice(2)).toBe(LINUX_RUN_COMMAND); // 2 boşluk = liste girintisi
  });
  it("tek boşlukla başlar, satır sonu / sudo yok, tek dosyaya u+x", () => {
    expect(LINUX_RUN_COMMAND.startsWith(" d=")).toBe(true);
    expect(LINUX_RUN_COMMAND.startsWith("  ")).toBe(false);
    expect(/[\r\n]/.test(LINUX_RUN_COMMAND)).toBe(false);
    expect(LINUX_RUN_COMMAND).not.toMatch(/sudo/);
    expect(LINUX_RUN_COMMAND).toContain(String.raw`-printf '%f\n'`);
    // K10 (D-P28g-K2-1): 10 dk pencere; eşleşme tam 1 değilse durur (en yeni seçimi yok)
    expect(LINUX_RUN_COMMAND).toContain("-mmin -10 ");
    expect(LINUX_RUN_COMMAND).toContain(String.raw`[ "$(printf '%s\n' "$f" | wc -l)" -eq 1 ] ||`);
    expect(LINUX_RUN_COMMAND).not.toMatch(/sort|head -n/);
    expect(LINUX_RUN_COMMAND).toContain('chmod u+x -- "$f"');
    expect(LINUX_RUN_COMMAND.endsWith('./"$f"')).toBe(true);
  });
});

describe("P28g LinuxGuide (AC-397)", () => {
  const html = renderToStaticMarkup(<LinuxGuide id="g" highlight={false} verifyCode="4821" host="destek.ornek.com" />);
  it("görünen komut = sabit; uyarı metni birebir, kopyala düğmesinin yanında", () => {
    const code = /<code data-testid="linux-command">([\s\S]*?)<\/code>/.exec(html)![1]!;
    expect(decode(code)).toBe(LINUX_RUN_COMMAND);
    expect(t("gl.never")).toBe(
      "Nokta Destek size bundan başka komut vermez; bu komutu yalnız bu sayfadan kopyalayın — sohbet, e-posta ya da telefonla verilen komutu çalıştırmayın.",
    );
    expect(html).toContain(t("gl.never"));
    expect(html.indexOf('data-testid="linux-copy"')).toBeLessThan(html.indexOf('data-testid="linux-never-command"'));
    expect(html).not.toMatch(/<details[^>]*>[^]*linux-never-command/);
  });
  it("Dosyalar yolu, Wayland izin adımı, doğrulama kodu + sunucu, SHA256SUMS + attestation", () => {
    expect(html).toContain("Program olarak çalıştır");
    expect(html).toContain("Uzaktan etkileşime izin ver");
    expect(html).toContain("doğrulama kodu 4821, sunucu adresi destek.ornek.com");
    expect(html).toContain("SHA256SUMS");
    expect(html).toContain("attestation");
  });
});

describe("P28g AgentDownload (Linux)", () => {
  const html = renderToStaticMarkup(<AgentDownload sessionRef="r1" verifyCode="4821" os="linux" onEnd={noop} />);
  it("indirme os=linux, Linux rehberi; SmartScreen / macOS rehberi yok", () => {
    expect(html).toContain('href="/api/v1/public/agent/download?ref=r1&amp;os=linux"');
    expect(html).toContain('data-os="linux"');
    expect(html).toContain("Ubuntu 22.04 / 24.04");
    expect(html).toContain('data-testid="linux-guide"');
    expect(html).not.toContain('data-testid="smartscreen-guide"');
    expect(html).not.toContain('data-testid="mac-guide"');
  });
});
