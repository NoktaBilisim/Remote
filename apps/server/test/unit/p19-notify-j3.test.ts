// P19 J3 birim testleri: şablon ad süzgeci (S-P19-T8/11), SMS ≤ 2 bölüm, telefon/URL kuralları (T5, T7), dış POST yardımcısı
// (S-P19-5: yönlendirme izlenmez, netguard reddi, zaman aşımı → dışa `unreachable`).
import { canonicalServiceUrl, smsSettingsInputSchema, toSmsPhone } from "@remote/contracts/api/notify";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNetGuard } from "../../src/lib/netguard.ts";
import { postJson, publicReason } from "../../src/lib/outbound.ts";
import { tenantUrlPortOk } from "../../src/notify/sms.ts";
import { isParsableServiceUrl } from "../../src/notify/service-url.ts";
import { firmName, linkMessage, sanitizeTemplateName, statusMessage, techShortName } from "../../src/notify/templates.ts";

describe("S-P19-T8 / S-P19-11 şablonlar", () => {
  it("S-P19-T8: alan adı, şema, tam genişlik nokta, bidi ve sıfır genişlik boşluk atılır", () => {
    expect(sanitizeTemplateName("Ziraat destek www.x.tld")).toBe("Ziraat destek x tld");
    expect(sanitizeTemplateName("Tıkla https://a.bc")).toBe("Tıkla a bc");
    expect(sanitizeTemplateName("ｘ．tld")).toBe("x tld");
    expect(sanitizeTemplateName("Firma‮ kötü​")).toBe("Firma kötü");
    expect(firmName("   ")).toBe("Destek");
    expect([...firmName("A".repeat(50))]).toHaveLength(30);
  });

  it("S-P19-K4: ideografik/yarım genişlik/küçük nokta varyantları noktaya eşlenir ve bozulur; IPv4 biçimi bozulur", () => {
    expect(sanitizeTemplateName("Banka\u3002com destek")).toBe("Banka com destek");
    expect(sanitizeTemplateName("Banka\uFF61com destek")).toBe("Banka com destek");
    expect(sanitizeTemplateName("Banka\uFE12com")).toBe("Banka com");
    expect(sanitizeTemplateName("Banka\uFE52com")).toBe("Banka com");
    expect(sanitizeTemplateName("Banka\u2024com")).toBe("Banka com");
    expect(sanitizeTemplateName("evil\u3002example\u3002tld")).toBe("evil example tld");
    expect(sanitizeTemplateName("Destek 192.168.1.10 ara")).toBe("Destek 192 168 1 10 ara");
    expect(sanitizeTemplateName("Destek \uFF11\uFF10\uFF0E\uFF10\uFF0E\uFF10\uFF0E\uFF11")).toBe("Destek 10 0 0 1");
    expect(sanitizeTemplateName("http://1.2.3.4/x")).toBe("1 2 3 4/x");
    expect(sanitizeTemplateName("Nokta A.Ş. 2.0")).toBe("Nokta A.Ş. 2.0"); // sürüm/kısaltma bozulmaz
  });

  it("S-P19-T8: teknisyen 'Ad S.' biçimi", () => {
    expect(techShortName("Mehmet Ali Yılmaz")).toBe("Mehmet Y.");
    expect(techShortName("Ayşe")).toBe("Ayşe");
    expect(techShortName("ışıl çağ")).toBe("ışıl Ç.");
  });

  it("AC-261: durum SMS ≤ 2 bölüm (UCS-2 134); AC-260 bağlantı SMS ≤ 3 bölüm (201; sapma notu); ret metni ve müşteri metni şablonda yok", () => {
    const link = `https://remote.example.com/session/${"a".repeat(43)}`;
    expect(linkMessage("A".repeat(60), link, "Mehmet Ali Yılmaz").length).toBeLessThanOrEqual(201);
    for (const k of ["REQ_ACCEPTED", "REQ_REJECTED", "REQ_EXPIRED"] as const)
      expect(statusMessage(k, "A".repeat(60), "ABC123").length).toBeLessThanOrEqual(134);
    expect(statusMessage("REQ_REJECTED", "Firma", "ABC123")).toBe("Firma: ABC123 numaralı destek talebiniz şu an karşılanamadı.");
  });
});

describe("AC-260 telefon ve adres kuralları", () => {
  it("AC-260: yalnız +905… SMS'e gider", () => {
    expect(toSmsPhone("+905321234567")).toBe("5321234567");
    expect(toSmsPhone("+4915112345678")).toBeNull();
    expect(toSmsPhone("+902121234567")).toBeNull();
  });

  it("S-P19-T5: userinfo / sorgu / boş sorgu / parça reddi; WA ayrıştırma kuralı aynı", () => {
    for (const bad of [
      "https://u:p@h.example",
      "https://h.example/x?apikey=1",
      "https://h.example/?",
      "https://h.example/#k",
      "ftp://h.example",
    ]) {
      expect(canonicalServiceUrl(bad), bad).toBeNull();
      expect(isParsableServiceUrl(bad), bad).toBe(false);
    }
    expect(canonicalServiceUrl("HTTPS://Sms.Example.com:443/api/")).toBe("https://sms.example.com/api");
    expect(smsSettingsInputSchema.safeParse({ url: "https://h.example/?k=1", header: null }).success).toBe(false);
    expect(smsSettingsInputSchema.safeParse({ url: null, header: "ÇOK-UZUN-BASLIK" }).success).toBe(false);
  });

  it("S-P19-T7: production'da tenant adresi yalnız https + 443", () => {
    expect(tenantUrlPortOk("https://h.example:8443", true)).toBe(false);
    expect(tenantUrlPortOk("http://h.example", true)).toBe(false);
    expect(tenantUrlPortOk("https://h.example:443", true)).toBe(true);
    expect(tenantUrlPortOk("http://h.example:8080", false)).toBe(true);
  });
});

describe("S-P19-5 postJson", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/redirect") return void res.writeHead(302, { location: "http://169.254.169.254/" }).end();
      if (req.url === "/auth") return void res.writeHead(401).end();
      if (req.url === "/big") return void res.writeHead(200).end("x".repeat(100_000));
      if (req.url === "/hang") return;
      res.writeHead(200).end("{}");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const a = server.address();
    base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("S-P19-5: 2xx ok, 302 izlenmez, 401 unauthorized, büyük gövde atılır", async () => {
    expect(await postJson(`${base}/ok`, {}, { timeoutMs: 2000, guard: null })).toBe("ok");
    expect(await postJson(`${base}/redirect`, {}, { timeoutMs: 2000, guard: null })).toBe("redirect");
    expect(await postJson(`${base}/auth`, {}, { timeoutMs: 2000, guard: null })).toBe("unauthorized");
    expect(await postJson(`${base}/big`, {}, { timeoutMs: 2000, guard: null })).toBe("ok");
  });

  it("S-P19-5: netguard loopback/metadata/özel/rebinding → host_not_allowed (istek gitmez); IP sabitlenir", async () => {
    const guard = createNetGuard();
    for (const u of ["http://127.0.0.1:9/x", "http://169.254.169.254/x", "http://10.0.0.1/x", "http://[::ffff:127.0.0.1]/x"])
      expect(await postJson(u, {}, { timeoutMs: 2000, guard }), u).toBe("host_not_allowed");
    // Rebinding: ilk çözüm genel, ikincisi özel olsaydı — tek çözüm yapılır ve bağlantı o IP'ye sabitlenir.
    let calls = 0;
    const pinned = createNetGuard({ lookupAll: async () => [++calls === 1 ? "127.0.0.1" : "10.0.0.1"], isBlocked: () => false });
    const port = new URL(base).port;
    expect(await postJson(`http://sms.test:${port}/ok`, {}, { timeoutMs: 2000, guard: pinned })).toBe("ok");
    expect(calls).toBe(1);
  });

  it("S-P19-T7: zaman aşımı ve bağlantı reddi dışarıda aynı `unreachable`", async () => {
    const t = await postJson(`${base}/hang`, {}, { timeoutMs: 200, guard: null });
    expect(t).toBe("timeout");
    const refused = await postJson("http://127.0.0.1:9/x", {}, { timeoutMs: 2000, guard: null });
    expect(refused).toBe("unreachable");
    expect(publicReason("timeout")).toBe(publicReason("unreachable"));
  });
});
