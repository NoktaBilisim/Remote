import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MULTI_ERROR_MESSAGES } from "@remote/contracts/api/multi";
import type { VoiceView } from "@/lib/voice/console";
import { VoiceAudio, VoiceControls } from "./voice-controls";

const noop = () => undefined;
/** `data-testid` taşıyan açılış etiketi (öznitelik sırasından bağımsız denetim için). */
const tagOf = (html: string, id: string): string => new RegExp(`<[a-z]+[^>]*data-testid="${id}"[^>]*>`).exec(html)?.[0] ?? "";
const disabled = (html: string, id: string) => / disabled=""/.test(tagOf(html, id));
const render = (view: VoiceView) =>
  renderToStaticMarkup(
    <VoiceControls
      view={view}
      unsupportedText={MULTI_ERROR_MESSAGES.CLIENT_UNSUPPORTED}
      onRequest={noop}
      onJoin={noop}
      onEnd={noop}
      onMute={noop}
    />,
  );

describe("P28d VoiceControls (konsol, §8)", () => {
  it("hidden → hiçbir şey çizilmez", () => {
    expect(render({ kind: "hidden" })).toBe("");
  });

  it("idle: 'Sesli görüşme' etkin; bildirim varsa aria-describedby ile bağlı; bekleme süresinde pasif (D-PD-2)", () => {
    const free = render({ kind: "idle", busy: false, notice: null, blocked: false });
    expect(free).toContain('data-view="idle"');
    expect(free).toContain("Sesli görüşme");
    expect(disabled(free, "voice-call")).toBe(false);
    expect(free).not.toContain("aria-describedby");

    const cool = render({ kind: "idle", busy: false, notice: { kind: "rejected", until: 9 }, blocked: true });
    expect(disabled(cool, "voice-call")).toBe(true);
    expect(cool).toContain("Müşteri reddetti — 30 sn sonra tekrar deneyebilirsiniz");
    const id = /aria-describedby="([^"]+)"/.exec(cool)?.[1];
    expect(id).toBeTruthy();
    expect(cool).toContain(`id="${id}"`);
  });

  it("idle meşgul (izin alınıyor) → loading; mikrofon izni yok → tarayıcı yönergesi", () => {
    expect(render({ kind: "idle", busy: true, notice: null, blocked: false })).toContain('aria-busy="true"');
    const denied = render({ kind: "idle", busy: false, notice: { kind: "micDenied", until: null }, blocked: false });
    expect(denied).toContain("Mikrofon izni verilmedi");
    expect(denied).toContain('data-kind="micDenied"');
  });

  it("waiting → 'Yanıt bekleniyor · m:ss' (canlı bölge yok)", () => {
    const h = render({ kind: "waiting", leftMs: 45_000 });
    expect(h).toContain("Yanıt bekleniyor · 0:45");
    expect(h).not.toContain("aria-live");
  });

  it("talking: 'Mikrofon açık' aria-live=polite, ikon-only Sessize al / Görüşmeyi bitir (aria-label + title)", () => {
    const h = render({ kind: "talking", muted: false });
    expect(h).toMatch(/role="status" aria-live="polite"[^>]*data-testid="voice-mic-state"/);
    expect(h).toContain("Mikrofon açık");
    expect(h).toContain('aria-label="Sessize al" title="Sessize al"');
    expect(h).toContain('aria-label="Görüşmeyi bitir" title="Görüşmeyi bitir"');
    const m = render({ kind: "talking", muted: true });
    expect(m).toContain("Sessizde");
    expect(m).toContain('aria-label="Mikrofonu aç"');
  });

  it("canJoin → 'Görüşmeye katıl'; izleyici → 'Dinleniyor'; yetkisiz → bilgi metni (V-PD-6)", () => {
    expect(render({ kind: "canJoin", busy: false, notice: null })).toContain('data-testid="voice-join"');
    expect(render({ kind: "canJoin", busy: false, notice: null })).toContain("Görüşmeye katıl");
    expect(render({ kind: "listening" })).toContain("Dinleniyor");
    expect(render({ kind: "noPerm" })).toContain("Sesli görüşme sürüyor — dinleme yetkiniz yok");
    expect(render({ kind: "otherPending" })).toContain('data-testid="voice-other-pending"');
  });

  it("eski istemci → pasif düğme + AC-352 metni; gözetimsiz → pasif + neden", () => {
    const u = render({ kind: "unsupported" });
    expect(disabled(u, "voice-call")).toBe(true);
    expect(u).toContain(MULTI_ERROR_MESSAGES.CLIENT_UNSUPPORTED);
    const g = render({ kind: "unattended" });
    expect(disabled(g, "voice-call")).toBe(true);
    expect(g).toContain("Gözetimsiz oturumda sesli görüşme yapılamaz");
  });

  it("VoiceAudio: <audio> her zaman monte, denetimsiz; ilk çizimde 'Sesi aç' yok", () => {
    const h = renderToStaticMarkup(<VoiceAudio track={null} listen={false} />);
    expect(h).toContain('<audio data-testid="voice-audio" data-listen="false"');
    expect(h).not.toContain("controls");
    expect(h).not.toContain("voice-play");
  });
});
