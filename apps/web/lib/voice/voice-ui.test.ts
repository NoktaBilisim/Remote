import { describe, expect, it } from "vitest";
import type { TechRosterEntry } from "@remote/contracts/ws-multi";
import type { VoiceEnded } from "./console";
import type { GuestVoiceView } from "./guest";
import { freshListeners, guestBarModel, noticeText, voiceEndToast } from "./ui";

const ended = (p: Partial<VoiceEnded>): VoiceEnded => ({
  callId: "c",
  wasPhase: "active",
  reason: "tech",
  durationSec: 192,
  mine: true,
  ...p,
});
const roster = [
  { tid: "A", name: "Ayşe", role: "controller", owner: true, connected: true },
  { tid: "B", name: "Mehmet", role: "observer", owner: false, connected: true },
] as unknown as TechRosterEntry[];
const view = (p: Partial<GuestVoiceView>): GuestVoiceView => ({
  request: null,
  active: null,
  mic: "off",
  muted: false,
  announce: null,
  note: null,
  ...p,
});

describe("P28d voiceEndToast (§8)", () => {
  it("ret / yanıt yok / bitiş + süre; başkasının görüşmesi ve diğer pending bitişleri toast'sız", () => {
    expect(voiceEndToast(ended({ wasPhase: "pending", reason: "customer", durationSec: null }))).toBe("Müşteri sesli görüşmeyi reddetti");
    expect(voiceEndToast(ended({ wasPhase: "pending", reason: "timeout", durationSec: null }))).toBe("Müşteri yanıt vermedi");
    expect(voiceEndToast(ended({}))).toBe("Sesli görüşme bitti · 3 dk 12 sn");
    expect(voiceEndToast(ended({ durationSec: null }))).toBe("Sesli görüşme bitti");
    expect(voiceEndToast(ended({ mine: false }))).toBeNull();
    expect(voiceEndToast(ended({ wasPhase: "pending", reason: "disconnect" }))).toBeNull();
    expect(voiceEndToast(null)).toBeNull();
  });
  it("noticeText: AC-352 metni dışarıdan; diğerleri sözlükten", () => {
    expect(noticeText("unsupported", "X")).toBe("X");
    expect(noticeText("customerEnded", "X")).toBe("Müşteri görüşmeyi bitirdi — 30 sn sonra tekrar deneyebilirsiniz");
  });
});

describe("P28d guestBarModel / freshListeners (Y-PD-3, AC-374)", () => {
  it("kabul ile active arası mikrofon açılırken çubuk görünür (gösterge gerçek mikrofona bağlı)", () => {
    expect(guestBarModel(view({ mic: "opening" }), roster).show).toBe(true);
    expect(guestBarModel(view({}), roster).show).toBe(false);
  });
  it("Dinleyen = listeners − talkers; roster dışı tid ad üretmez", () => {
    const m = guestBarModel(view({ mic: "on", active: { callId: "c", talkers: ["A"], listeners: ["A", "B", "Z"] } }), roster);
    expect(m.talkers).toEqual(["Ayşe"]);
    expect(m.listenersOnly).toEqual(["Mehmet"]);
  });
  it("duyuru yalnız görülen seq'ten büyükse ve tid hâlâ dinliyorsa", () => {
    const active = { callId: "c", talkers: ["A"], listeners: ["A", "B"] };
    expect(freshListeners(view({ active, announce: { seq: 2, tids: ["B"] } }), 1)).toEqual(["B"]);
    expect(freshListeners(view({ active, announce: { seq: 2, tids: ["B"] } }), 2)).toEqual([]);
    expect(freshListeners(view({ active: { ...active, listeners: ["A"] }, announce: { seq: 2, tids: ["B"] } }), 1)).toEqual([]);
    expect(freshListeners(view({ announce: { seq: 2, tids: ["B"] } }), 1)).toEqual([]);
  });
});
