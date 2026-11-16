import { describe, expect, it } from "vitest";
import { buildClamav, buildFilesBody, checkQuotaGb, usagePct } from "./settings";

// P28b K4 ayar ekranları saf mantığı (AC-353, 354, 362).
const saved = { fileServerMode: false, fileRetentionDays: 1 };

describe("buildFilesBody (AC-354)", () => {
  it("açarken onay kutusu zorunlu; işaretliyse consentUpdated:true gider", () => {
    expect(buildFilesBody({ on: true, days: "1", consent: false }, saved)).toEqual({
      errors: { consentUpdated: "Açmadan önce aydınlatma metnini güncellediğinizi onaylayın" },
    });
    expect(buildFilesBody({ on: true, days: "3", consent: true }, saved).body).toEqual({
      fileServerMode: true,
      consentUpdated: true,
      fileRetentionDays: 3,
    });
  });
  it("kapatırken onay yok; saklama 1–7 dışı alan hatası; değişiklik yoksa gövde yok", () => {
    expect(buildFilesBody({ on: false, days: "2", consent: false }, { fileServerMode: true, fileRetentionDays: 2 }).body).toEqual({
      fileServerMode: false,
    });
    expect(buildFilesBody({ on: false, days: "8", consent: false }, saved).errors.fileRetentionDays).toBe("1-7 arası olmalı");
    expect(buildFilesBody({ on: false, days: "x", consent: false }, saved).errors.fileRetentionDays).toBeTruthy();
    expect(buildFilesBody({ on: false, days: "1", consent: false }, saved)).toEqual({ errors: {} });
  });
});

describe("ClamAV ve kota", () => {
  it("host biçimi ve port aralığı; host küçük harfe", () => {
    expect(buildClamav({ host: " ClamAV ", port: "3310" }).body).toEqual({ host: "clamav", port: 3310 });
    expect(buildClamav({ host: "", port: "3310" }).errors.host).toBeTruthy();
    expect(buildClamav({ host: "clamav", port: "70000" }).errors.port).toBe("Port 1-65535 arası olmalı");
  });
  it("kota 1–2000 GB; kullanım yüzdesi", () => {
    expect(checkQuotaGb("50")).toEqual({ gb: 50 });
    expect(checkQuotaGb("0").error).toBe("Kota 1-2000 GB arası olmalı");
    expect(checkQuotaGb("2001").error).toBeTruthy();
    expect(usagePct({ usedBytes: 5, quotaBytes: 10 })).toBe(50);
    expect(usagePct({ usedBytes: 50, quotaBytes: 10 })).toBe(100);
  });
});
