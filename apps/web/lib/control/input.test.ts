import { describe, expect, it } from "vitest";
import { actualViewSize, comboMsgs, keyMsg, mouseButton, pointFromClient, printableKey, releaseComboTracker, SPECIAL_COMBOS, wheelMsg } from "./input";
import { parseInputMessage } from "@remote/contracts/dc";
import { inputMsgSchema } from "./protocol";

// Hem şema hem Go istemcisinin okuduğu ham çerçeve yolu (parseInputMessage: boyut + JSON + şema)
const valid = (m: unknown) => {
  expect(inputMsgSchema.safeParse(m).success).toBe(true);
  expect(parseInputMessage(JSON.stringify(m))).toEqual(m);
};

describe("P7 girdi eşlemesi", () => {
  it("AC-49: koordinat object-contain içerik alanına göre normalize (letterbox hariç)", () => {
    // 1000x1000 kutu, 1920x1080 video → içerik y 218.75..781.25
    const box = { left: 100, top: 50, width: 1000, height: 1000 };
    expect(pointFromClient(100, 50 + 218.75, box, 1920, 1080)).toEqual([0, 0]);
    expect(pointFromClient(1100, 50 + 781.25, box, 1920, 1080)).toEqual([1, 1]);
    expect(pointFromClient(600, 550, box, 1920, 1080)).toEqual([0.5, 0.5]);
    expect(pointFromClient(600, 60, box, 1920, 1080)).toBeNull(); // siyah bant
    expect(pointFromClient(600, 60, box, 1920, 1080, true)).toEqual([0.5, 0]);
    // ±2 px: 3840 genişlikte 1 px'lik hedef 5 ondalıkla korunur
    const p = pointFromClient(100 + (1234.5 / 3840) * 1000, 550, box, 3840, 2160)!;
    expect(Math.abs(p[0] * 3840 - 1234.5)).toBeLessThan(0.1);
    valid({ t: "m.move", x: p[0], y: p[1] });
  });

  it("TEST-P7-1: %100 kipinde kaydırılmış kutuda tık uzak piksele ±1 px düşer", () => {
    // Video 1280×720 CSS px çizilmiş; kaydırma kutusu (276,365), kaydırma (300,200) → video sol üstü (-24, 165)
    const box = { left: 276 - 300, top: 365 - 200, width: 1280, height: 720 };
    const p = pointFromClient(276 + 50, 365 + 50, box, 320, 180)!; // akış küçültülmüş (320×180) olsa da
    expect(Math.abs(p[0] * 1280 - 350)).toBeLessThanOrEqual(1);
    expect(Math.abs(p[1] * 720 - 250)).toBeLessThanOrEqual(1);
    // Kaydırma yok: (50,50)
    const q = pointFromClient(276 + 50, 365 + 50, { left: 276, top: 365, width: 1280, height: 720 }, 1280, 720)!;
    expect(Math.abs(q[0] * 1280 - 50)).toBeLessThanOrEqual(1);
    expect(Math.abs(q[1] * 720 - 50)).toBeLessThanOrEqual(1);
  });

  it("TEST-P7-1: %100 boyutu monitör çözünürlüğü (oran uyumluysa), yoksa doğal video boyutu", () => {
    expect(actualViewSize({ w: 1920, h: 1080 }, 320, 180)).toEqual({ w: 1920, h: 1080 });
    expect(actualViewSize({ w: 1920, h: 1080 }, 0, 0)).toEqual({ w: 1920, h: 1080 });
    expect(actualViewSize({ w: 1280, h: 1024 }, 320, 180)).toEqual({ w: 320, h: 180 }); // oran tutmuyor (başka monitörün akışı)
    expect(actualViewSize(null, 640, 360)).toEqual({ w: 640, h: 360 });
    expect(actualViewSize(null, 0, 0)).toBeNull();
  });

  it("AC-49: Sığdır kipinde letterbox'lı kutuda ±1 px", () => {
    // 580×352 kutu, 1280×720 içerik → ölçek 0.453125, içerik 580×326.25, y bandı 12.875
    const box = { left: 276, top: 365, width: 580, height: 352 };
    const s = 580 / 1280;
    for (const [px, py] of [[0, 0], [640, 360], [1279, 719], [123, 456]] as const) {
      const p = pointFromClient(276 + px * s, 365 + 12.875 + py * s, box, 1280, 720)!;
      expect(Math.abs(p[0] * 1280 - px)).toBeLessThanOrEqual(1);
      expect(Math.abs(p[1] * 720 - py)).toBeLessThanOrEqual(1);
    }
  });

  it("AC-48: fare düğmeleri ve tekerlek", () => {
    expect([0, 1, 2, 3].map(mouseButton)).toEqual(["l", "m", "r", null]);
    expect(wheelMsg(0, 100, 0)).toEqual({ t: "m.wheel", dx: 0, dy: 120 });
    expect(wheelMsg(0, -3, 1)).toEqual({ t: "m.wheel", dx: 0, dy: -120 });
    expect(wheelMsg(0, 50, 2)).toEqual({ t: "m.wheel", dx: 0, dy: 1200 });
    expect(wheelMsg(0, 0, 0)).toBeNull();
    valid(wheelMsg(5000, -5000, 0));
    valid({ t: "m.btn", b: "r", down: true, x: 1, y: 0 });
    valid({ t: "k.release_all" });
  });

  it("AC-48: Türkçe karakterler key ile, özel tuşlar yalnız code ile", () => {
    for (const ch of ["ç", "ğ", "ı", "ö", "ş", "ü", "İ", "Ç", "@", " "]) {
      const m = keyMsg({ type: "keydown", code: "KeyX", key: ch });
      expect(m).toEqual({ t: "k", code: "KeyX", down: true, key: ch });
      valid(m);
    }
    expect(keyMsg({ type: "keyup", code: "F5", key: "F5" })).toEqual({ t: "k", code: "F5", down: false });
    expect(keyMsg({ type: "keydown", code: "Tab", key: "Tab" })).toEqual({ t: "k", code: "Tab", down: true });
    expect(keyMsg({ type: "keydown", code: "Quote", key: "Dead" })).toEqual({ t: "k", code: "Quote", down: true });
    expect(keyMsg({ type: "keydown", code: "KeyA", key: "a", isComposing: true })).toBeNull();
    expect(keyMsg({ type: "keydown", code: "", key: "a" })).toBeNull();
    expect(keyMsg({ type: "keydown", code: "Key-A", key: "a" })).toBeNull(); // kod sözleşmesi ^[A-Za-z0-9]{1,32}$
    for (const [code, key] of <[string, string][]>[["ShiftLeft", "Shift"], ["Enter", "Enter"], ["ArrowUp", "ArrowUp"], ["Digit1", "1"], ["Semicolon", "ş"], ["F12", "F12"], ["MetaLeft", "Meta"]]) {
      const m = keyMsg({ type: "keyup", code, key })!;
      valid(m);
      if (key.length > 1) expect("key" in m).toBe(false); // özel tuş adları key ile gitmez
    }
    expect(printableKey("\u0008")).toBe(false);
    expect(printableKey("😀")).toBe(true);
    expect(printableKey("ab")).toBe(false);
  });

  it("Ctrl+Alt+Shift tek başına basılıp bırakılınca klavye yakalaması bırakılır; araya tuş girerse bırakılmaz", () => {
    const tr = releaseComboTracker();
    const seq = (codes: string[], ups: string[]) => [...codes.map((code) => tr.feed({ type: "keydown", code })), ...ups.map((code) => tr.feed({ type: "keyup", code }))];
    expect(seq(["ControlLeft", "AltLeft", "ShiftLeft"], ["ShiftLeft", "AltLeft", "ControlLeft"]).at(-1)).toBe(true);
    expect(seq(["ControlLeft", "AltLeft", "ShiftLeft", "KeyQ"], ["KeyQ", "ShiftLeft", "AltLeft", "ControlLeft"]).some(Boolean)).toBe(false);
    expect(seq(["ControlLeft", "ShiftLeft"], ["ShiftLeft", "ControlLeft"]).some(Boolean)).toBe(false);
  });

  it("AC-48: özel kombinasyonlar şemaya uyar; Ctrl+Alt+Del yok", () => {
    const all = SPECIAL_COMBOS.flatMap((c) => comboMsgs(c.codes));
    all.forEach(valid);
    expect(comboMsgs(["AltLeft", "Tab"]).map((m) => (m.t === "k" ? `${m.code}:${m.down}` : ""))).toEqual(["AltLeft:true", "Tab:true", "Tab:false", "AltLeft:false"]);
    expect(SPECIAL_COMBOS.some((c) => (c.codes as readonly string[]).includes("Delete"))).toBe(false);
  });
});
