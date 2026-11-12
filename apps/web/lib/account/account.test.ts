import { describe, expect, it } from "vitest";
import { groupSecret } from "./contract";
import { IDLE_PROBE_MS, shouldProbe } from "./idle";
import { recoveryFileName, recoveryFileText } from "./recovery";
import { readResetToken } from "./reset-token";
import { buildSmtpInput, smtpCredsAllowed, smtpDirty, smtpPortOptions, smtpServerFields, suggestPort, toSmtpState } from "./smtp-form";

const view = { host: "smtp.ornek.com", port: 587, security: "STARTTLS" as const, user: "destek", fromName: "Destek", fromEmail: "destek@ornek.com", hasPassword: true };

describe("P10 SMTP formu (AC-79)", () => {
  it("güvenlik seçimi portu önerir; özel port korunur", () => {
    expect(suggestPort("587", "SSL")).toBe("465");
    expect(suggestPort("", "NONE")).toBe("25");
    expect(suggestPort("465", "STARTTLS")).toBe("587");
    expect(suggestPort("2525", "SSL")).toBe("2525");
  });
  it("kayıtlı şifre forma yazılmaz; boş şifre gönderilmez (korunur)", () => {
    const st = toSmtpState(view);
    expect(st.password).toBe("");
    const r = buildSmtpInput(st);
    expect(r.input).toMatchObject({ host: "smtp.ornek.com", port: 587, security: "STARTTLS", user: "destek", fromEmail: "destek@ornek.com" });
    expect(r.input && "password" in r.input).toBe(false);
    expect(buildSmtpInput({ ...st, password: "yeni-sifre" }).input).toMatchObject({ password: "yeni-sifre" });
  });
  it("alan hataları sözleşme şemasından; şifre kullanıcı adı ister", () => {
    const st = toSmtpState(null);
    const e = buildSmtpInput({ ...st, host: "smtp ornek", port: "70000", fromEmail: "x", password: "p" }).errors;
    expect(e.host).toBeTruthy();
    expect(e.port).toBeTruthy();
    expect(e.fromEmail).toBeTruthy();
    expect(e.user).toBe("Şifre için kullanıcı adı gerekli");
  });
  it("B-P10-1: port yalnız 25/465/587/2525; eski kayıtlı port seçeneklerde işaretli kalır", () => {
    const st = toSmtpState(view);
    expect(buildSmtpInput({ ...st, port: "2525" }).input).toMatchObject({ port: 2525 });
    for (const port of ["22", "2526", "", "abc"]) expect(buildSmtpInput({ ...st, port }).errors.port).toBe("Port 25, 465, 587 veya 2525 olmalı");
    const lbl = (p: string) => `${p} (eski)`;
    expect(smtpPortOptions("587", lbl).map((o) => o.value)).toEqual(["25", "465", "587", "2525"]);
    expect(smtpPortOptions("2526", lbl).at(-1)).toEqual({ value: "2526", label: "2526 (eski)" });
  });
  it("B-P10-5: güvenlik Yok iken kullanıcı adı/şifre gönderilmez", () => {
    expect(smtpCredsAllowed("NONE")).toBe(false);
    expect(smtpCredsAllowed("SSL")).toBe(true);
    const st = { ...toSmtpState(view), security: "NONE" as const, port: "25", password: "gizli-deger" };
    const r = buildSmtpInput(st);
    expect(r.errors).toEqual({});
    expect(r.input).toMatchObject({ security: "NONE", user: "" });
    expect(r.input && "password" in r.input).toBe(false);
    // Yazılan şifre "Yok"ta kirlilik sayılmaz; kullanıcı adı silinecekse kirli
    const none = { ...toSmtpState({ ...view, security: "NONE", port: 25, user: null, hasPassword: false }) };
    expect(smtpDirty(none, { ...none, user: "x", password: "y" })).toBe(false);
    expect(smtpDirty(toSmtpState(view), { ...toSmtpState(view), security: "NONE" })).toBe(true);
  });
  it("tüm alanlar boş → kaldır (null)", () => {
    expect(buildSmtpInput({ ...toSmtpState(null), port: "" }).input).toBeNull();
  });
  it("kirli durum boşlukları yok sayar; sunucu alanları eşlenir", () => {
    const a = toSmtpState(view);
    expect(smtpDirty(a, { ...a, host: " smtp.ornek.com " })).toBe(false);
    expect(smtpDirty(a, { ...a, password: "x" })).toBe(true);
    expect(smtpServerFields({ "smtp.host": "Bu sunucu adresi kullanılamaz.", _: "genel" })).toEqual({ errors: { host: "Bu sunucu adresi kullanılamaz." }, rest: ["genel"] });
    expect(smtpServerFields({ "smtp.port": "P", "smtp.security": "S" }).errors).toEqual({ port: "P", security: "S" });
  });
});

describe("P10 hesap yardımcıları", () => {
  it("sıfırlama tokenı yalnız URL parçasından (# — sorgu kabul edilmez)", () => {
    expect(readResetToken({ hash: "#token=abc" })).toBe("abc");
    expect(readResetToken({ hash: "" })).toBeNull();
  });
  it("elle anahtar 4'lü gruplanır", () => {
    expect(groupSecret("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP");
  });
  it("kurtarma kodu dosyası: numaralı, CRLF, kişisel veri yalnız başlıkta", () => {
    const txt = recoveryFileText(["aaaaa-11111", "bbbbb-22222"], { title: "T", account: "a@b.c", note: "N", createdAt: "D" });
    expect(txt.split("\r\n")).toEqual(["T", "a@b.c", "D", "", " 1. aaaaa-11111", " 2. bbbbb-22222", "", "N", ""]);
    expect(recoveryFileName("2026-11-12")).toBe("kurtarma-kodlari-2026-11-12.txt");
  });
  it("AC-68 boşta yoklama: yalnız eşik aşılınca ve aynı boşlukta bir kez", () => {
    const t0 = 1_000_000;
    expect(shouldProbe("idle", t0 + IDLE_PROBE_MS - 1, t0, t0)).toBe(false);
    expect(shouldProbe("idle", t0 + IDLE_PROBE_MS, t0, t0)).toBe(true);
    expect(shouldProbe("idle", t0 + IDLE_PROBE_MS + 60_000, t0, t0 + IDLE_PROBE_MS)).toBe(false);
    expect(shouldProbe("visible", t0 + 30_000, t0, t0)).toBe(false);
    expect(shouldProbe("visible", t0 + 120_000, t0, t0)).toBe(true);
  });
});
