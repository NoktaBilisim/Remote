import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { parsePanelMessage } from "./contract";
import { consolePath, requestErrorMessage } from "./errors";
import { MAX_UNOPENED, panelBackoff, panelCloseAction, panelRetryDelay, titleWithCount } from "./panel-socket";
import { buildInput, isDirty, toState } from "./settings-form";
import { readSoundPref, writeSoundPref } from "./sound";
import { formatRequestCode, sourceView } from "./source";
import { checkCidr, checkRejectMessage } from "./validate";

const ID = "01JREQ0000000000000000000A";
const SID = "01JSES0000000000000000000A";

describe("bilinen kaynak (mimari-e9 §13.1, koordinatör kararı)", () => {
  it("IP / TRUSTED / cihaz → bilinen; PREFIX uyarıyı kaldırmaz; NONE → ilk kez", () => {
    expect(sourceView("IP", false)).toEqual({ known: true, reasons: ["ip"], sameBlock: false });
    expect(sourceView("TRUSTED", true)).toEqual({ known: true, reasons: ["trusted", "device"], sameBlock: false });
    expect(sourceView("NONE", true).known).toBe(true);
    expect(sourceView("PREFIX", false)).toEqual({ known: false, reasons: [], sameBlock: true });
    expect(sourceView("NONE", false)).toEqual({ known: false, reasons: [], sameBlock: false });
  });
  it("talep kodu 3+3 gösterilir", () => {
    expect(formatRequestCode("123456")).toBe("123 456");
    expect(formatRequestCode("12a")).toBe("12a");
  });
});

describe("/ws/panel", () => {
  it("geçerli mesajları ayrıştırır, bilinmeyen/bozuk olanı yok sayar", () => {
    expect(parsePanelMessage(JSON.stringify({ t: "queue.count", pending: 3 }))).toEqual({ t: "queue.count", pending: 3 });
    expect(
      parsePanelMessage(
        JSON.stringify({
          t: "request.new",
          id: ID,
          requestCode: "123456",
          customerName: "Ayşe",
          preview: "Yazıcı",
          networkMatch: "PREFIX",
          knownDevice: false,
          createdAt: "2026-11-12T10:00:00.000Z",
          customerFirm: null,
          viaBinding: false,
          bindingRevoked: false,
          staleSource: false,
        }),
      )?.t,
    ).toBe("request.new");
    expect(parsePanelMessage(JSON.stringify({ t: "request.removed", id: ID, status: "ACCEPTED" }))?.t).toBe("request.removed");
    expect(parsePanelMessage(JSON.stringify({ t: "x.y" }))).toBeNull();
    expect(parsePanelMessage(JSON.stringify({ t: "queue.count", pending: -1 }))).toBeNull();
    expect(parsePanelMessage("{bozuk")).toBeNull();
    expect(parsePanelMessage(42)).toBeNull();
  });
  it("AC-216: 4429 `retry=<sn>` → bekle ± %20 ve yeniden dene; gerekçesiz / too_many → dur", () => {
    expect(panelCloseAction(4429, true, 0, "retry=12")).toBe("retry");
    expect(panelCloseAction(4429, true, 0, "too_many")).toBe("stop");
    expect(panelRetryDelay(4429, "retry=10", 5, 0)).toBe(8000);
    expect(panelRetryDelay(4429, "retry=10", 5, 0.5)).toBe(10_000);
    expect(panelRetryDelay(4429, "retry=10", 5, 0.999_999)).toBeLessThanOrEqual(12_000);
    for (let i = 0; i < 50; i++) {
      const d = panelRetryDelay(4429, "retry=10", 0);
      expect(d).toBeGreaterThanOrEqual(8000);
      expect(d).toBeLessThanOrEqual(12_000);
    }
    // 4429 dışı kapanışta üstel geri çekilme
    expect(panelRetryDelay(1006, "retry=10", 2, 0)).toBe(4000);
  });
  it("kapanış kararı: 4401 dene, 4429 gerekçesiz/1008 dur, açılamayan 3 denemeden sonra dur", () => {
    expect(panelCloseAction(4401, true, 0)).toBe("retry");
    expect(panelCloseAction(4429, true, 0)).toBe("stop");
    expect(panelCloseAction(1008, true, 0)).toBe("stop");
    expect(panelCloseAction(1006, true, 5)).toBe("retry");
    expect(panelCloseAction(1006, false, MAX_UNOPENED - 1)).toBe("retry");
    expect(panelCloseAction(1006, false, MAX_UNOPENED)).toBe("stop");
    expect(panelBackoff(0)).toBe(1000);
    expect(panelBackoff(10)).toBe(30_000);
  });
  it("sekme başlığı öneki", () => {
    expect(titleWithCount("Talepler · Nokta", 3)).toBe("(3) Talepler · Nokta");
    expect(titleWithCount("(3) Talepler · Nokta", 5)).toBe("(5) Talepler · Nokta");
    expect(titleWithCount("(3) Talepler · Nokta", 0)).toBe("Talepler · Nokta");
  });
});

describe("ret mesajı (AC-157, G-E9-12)", () => {
  it("hazır metinler geçer", () =>
    expect(checkRejectMessage("  Şu an müsait değiliz, sizi arayacağız ").value).toBe("Şu an müsait değiliz, sizi arayacağız"));
  it.each([
    "abc",
    "x".repeat(201),
    "bkz. https://kotu",
    "www.ornek",
    "ornek.com adresine",
    "bana a@b yaz",
    "0532 123 45 67 arayın",
    "iki\nsatır",
  ])("%s reddedilir", (m) => expect(checkRejectMessage(m).error).toBeTruthy());
});

describe("güvenilen CIDR", () => {
  it("ağ adresine normalize eder; geniş/özel aralığı reddeder", () => {
    expect(checkCidr("203.0.113.7/24").value).toBe("203.0.113.0/24");
    expect(checkCidr("203.0.0.0/8").error).toMatch("/16");
    expect(checkCidr("10.0.0.0/24").error).toBeTruthy();
    expect(checkCidr("2001:db8::/16").error).toMatch("/32");
    expect(checkCidr("abc").error).toBeTruthy();
  });
});

describe("ayar formu", () => {
  const base = {
    downloadUrl: "https://x/api/v1/public/agent/request-download?ref=abcdefghijklmnop",
    fileName: "NoktaDestek-Demo-abcdefghijklmnop.exe",
    refPrefix: "abcd",
    refRotatedAt: null,
    waitMinutes: 30,
    trustedCidrs: [],
    whatsapp: { enabled: false, recipients: [], serviceConfigured: true, insecure: false },
    email: { enabled: false, recipients: [], smtpConfigured: false },
    requireAcceptCode: false,
    defaultPriority: "NORMAL" as const,
    defaultSlaMinutes: null,
  };
  it("geçerli durum → PUT gövdesi (telefon E.164, CIDR kanonik, boş satır atlanır)", () => {
    const st = {
      waitMinutes: "45",
      trustedCidrs: ["203.0.113.9/24", ""],
      waEnabled: true,
      waRecipients: ["0532 111 22 33"],
      mailEnabled: false,
      mailRecipients: [],
      acceptCode: false,
    };
    expect(buildInput(st, base.email).input).toEqual({
      waitMinutes: 45,
      trustedCidrs: ["203.0.113.0/24"],
      whatsapp: { enabled: true, recipients: ["+905321112233"] },
      email: { enabled: false, recipients: [] },
      requireAcceptCode: false,
    });
  });
  it("AC-239: kabul kodu anahtarı durumdan PUT gövdesine gider ve kirli sayılır", () => {
    const a = toState({ ...base, requireAcceptCode: true });
    expect(a.acceptCode).toBe(true);
    expect(buildInput({ ...a, acceptCode: false }, base.email).input?.requireAcceptCode).toBe(false);
    expect(buildInput(a, base.email).input?.requireAcceptCode).toBe(true);
    expect(isDirty(a, { ...a, acceptCode: false })).toBe(true);
  });
  it("alan bazlı hatalar", () => {
    const st = {
      waitMinutes: "5",
      trustedCidrs: ["1.0.0.0/8", "203.0.113.0/24", "203.0.113.1/24"],
      waEnabled: true,
      waRecipients: ["12", "05321112233", "+905321112233"],
      mailEnabled: false,
      mailRecipients: [],
      acceptCode: false,
    };
    const { input, errors } = buildInput(st, base.email);
    expect(input).toBeUndefined();
    expect(errors.waitMinutes).toBe("wait");
    expect(errors["whatsapp.recipients.0"]).toBe("phone");
    expect(errors["whatsapp.recipients.2"]).toBe("phoneDup");
    expect(errors["trustedCidrs.0"]).toMatch(/^msg:/);
    expect(errors["trustedCidrs.2"]).toBe("cidrDup");
  });
  it("P10 AC-151: e-posta kanalı — SMTP yoksa açılamaz; alıcılar küçük harf, tekil, geçerli", () => {
    expect(buildInput({ ...toState(base), mailEnabled: true, mailRecipients: ["a@ornek.com"] }, base.email).errors["email.enabled"]).toBe(
      "smtpRequired",
    );
    const smtp = { ...base.email, smtpConfigured: true };
    expect(buildInput({ ...toState(base), mailEnabled: true }, smtp).errors["email.recipients"]).toBe("recipientsRequired");
    const bad = buildInput({ ...toState(base), mailEnabled: true, mailRecipients: ["x", "A@ornek.com", "a@ornek.com"] }, smtp).errors;
    expect(bad["email.recipients.0"]).toBe("email");
    expect(bad["email.recipients.2"]).toBe("emailDup");
    expect(buildInput({ ...toState(base), mailEnabled: true, mailRecipients: [" Destek@Ornek.com ", ""] }, smtp).input?.email).toEqual({
      enabled: true,
      recipients: ["destek@ornek.com"],
    });
  });
  it("WhatsApp açık ve alıcı yok → hata", () => {
    expect(buildInput({ ...toState(base), waEnabled: true }, base.email).errors["whatsapp.recipients"]).toBe("recipientsRequired");
  });
  it("kirli durum tespiti boşlukları yok sayar", () => {
    const a = toState(base);
    expect(isDirty(a, { ...a, waitMinutes: " 30 " })).toBe(false);
    expect(isDirty(a, { ...a, trustedCidrs: [""] })).toBe(false);
    expect(isDirty(a, { ...a, waEnabled: true })).toBe(true);
  });
});

describe("kabul / hata mesajları", () => {
  it("konsol yolu yalnız uygulama içi", () => {
    expect(consolePath({ sessionId: SID, consoleUrl: `/sessions/${SID}/console` })).toBe(`/sessions/${SID}/console`);
    expect(consolePath({ sessionId: SID, consoleUrl: "https://kotu.example/x" })).toBe(`/sessions/${SID}/console`);
  });
  it("hata kodları Türkçe mesaja", () => {
    expect(requestErrorMessage(new ApiError(409, "REQUEST_TAKEN", ""))).toMatch("başka bir teknisyen");
    expect(requestErrorMessage(new ApiError(409, "REQUEST_CLOSED", ""))).toMatch("açık değil");
    expect(requestErrorMessage(new ApiError(429, "QUEUE_FULL", ""))).toMatch("yoğunuz");
    expect(requestErrorMessage(new ApiError(426, "CLIENT_OUTDATED", ""))).toMatch("eski");
    expect(requestErrorMessage(new ApiError(409, "OPEN_SESSION_LIMIT", "Sınır"))).toBe("Sınır");
    expect(requestErrorMessage(new ApiError(409, "ACCEPT_CODE_CLIENT_UNSUPPORTED", ""))).toBe(
      "Müşterinin istemcisi kabul kodunu desteklemiyor (0.11.0 gerekli). Müşteriden istemciyi güncellemesini isteyin veya bu firmada kabul kodu ayarını kapatın.",
    );
  });
});

describe("ses tercihi", () => {
  it("varsayılan açık, kapatılınca saklanır", () => {
    const m = new Map<string, string>();
    const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(readSoundPref(st)).toBe(true);
    writeSoundPref(false, st);
    expect(readSoundPref(st)).toBe(false);
    expect(readSoundPref(null)).toBe(true);
  });
});
