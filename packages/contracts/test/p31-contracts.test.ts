// P31-B1 contracts (mimari-p31 K-P31-2, K-P31-4, §4, §15 S-P31-7; AC-509, AC-511, AC-521).
import { describe, expect, it } from "vitest";
import {
  createRequestInputSchema,
  REQUEST_CLIENT_OS,
  requestClientOsSchema,
  requestDownloadQuerySchema,
} from "../src/api/requests.ts";
import { CLIENT_OS } from "../src/api/sessions.ts";

const body = (o: Record<string, unknown> = {}) => ({
  ref: "abcdefghijklmnop",
  clientInstanceId: "A".repeat(22),
  clientVersion: "0.24.0",
  customerName: "Ayşe Yılmaz",
  phone: "0532 123 45 67",
  description: "Yazıcı çalışmıyor, yardım lazım",
  consentTextId: "01JA0000000000000000000000",
  consentAccepted: true,
  ...o,
});

describe("P31 requestClientOsSchema (S-P31-7)", () => {
  it("AC-511: yalnız windows|macos — linux (resolve ClientOs'ta var) ve büyük harf/boşluklu değerler reddedilir", () => {
    expect(REQUEST_CLIENT_OS).toEqual(["windows", "macos"]);
    for (const v of REQUEST_CLIENT_OS) expect(requestClientOsSchema.safeParse(v).success).toBe(true);
    expect(CLIENT_OS).toContain("linux"); // resolve şeması linux'u içerir; talep şeması bilinçli olarak içermez
    for (const v of ["linux", "MACOS", "Windows", "macos ", "darwin", "", null, 1])
      expect(requestClientOsSchema.safeParse(v).success).toBe(false);
  });
});

describe("P31 createRequestInputSchema.clientOs (AC-511)", () => {
  it("AC-511: alan isteğe bağlı; yokken gövde (Windows / eski istemci) bugünkü gibi geçer ve çıktıda clientOs yok", () => {
    const r = createRequestInputSchema.safeParse(body());
    expect(r.success).toBe(true);
    expect(r.success && "clientOs" in r.data).toBe(false);
  });

  it("AC-511: clientOs windows|macos kabul, değer aynen döner", () => {
    for (const clientOs of ["windows", "macos"]) {
      const r = createRequestInputSchema.safeParse(body({ clientOs }));
      expect(r.success && r.data.clientOs).toBe(clientOs);
    }
  });

  it("AC-511: clientOs linux ve diğer değerler 400 (şema reddi; yol clientOs)", () => {
    for (const clientOs of ["linux", "MACOS", "", "macos ", null, 1]) {
      const r = createRequestInputSchema.safeParse(body({ clientOs }));
      expect(r.success).toBe(false);
      expect(r.error?.issues.some((i) => i.path[0] === "clientOs")).toBe(true);
    }
  });

  it("AC-511: şema hâlâ katı — bilinmeyen alan reddedilir (clientOS gibi yanlış yazım)", () => {
    expect(createRequestInputSchema.safeParse(body({ clientOS: "macos" })).success).toBe(false);
  });
});

describe("P31 requestDownloadQuerySchema (AC-509, AC-521)", () => {
  it("AC-509: os yok / windows / macos geçer; ref bu şemada doğrulanmaz (servis tek 404)", () => {
    expect(requestDownloadQuerySchema.parse({ ref: "x" })).toEqual({});
    expect(requestDownloadQuerySchema.parse({ ref: "abcdefghijklmnop", os: "macos" })).toEqual({ os: "macos" });
    expect(requestDownloadQuerySchema.parse({ os: "windows" })).toEqual({ os: "windows" });
  });

  it("AC-521: os=linux, boş, büyük harf, dizi (os=a&os=b) → geçersiz", () => {
    for (const os of ["linux", "", "MACOS", "mac", ["macos", "windows"]])
      expect(requestDownloadQuerySchema.safeParse({ ref: "abcdefghijklmnop", os }).success).toBe(false);
  });
});
