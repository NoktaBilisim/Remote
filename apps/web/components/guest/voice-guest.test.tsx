import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GuestBarModel } from "@/lib/voice/ui";
import { VoiceAnnounce, VoiceBar } from "./voice-bar";
import { VoiceRequestDialog } from "./voice-dialog";

const noop = () => undefined;
/** `data-testid` taşıyan açılış etiketi (öznitelik sırasından bağımsız denetim için). */
const tagOf = (html: string, id: string): string => new RegExp(`<[a-z]+[^>]*data-testid="${id}"[^>]*>`).exec(html)?.[0] ?? "";
const disabled = (html: string, id: string) => / disabled=""/.test(tagOf(html, id));
const bar = (p: Partial<GuestBarModel>) =>
  renderToStaticMarkup(
    <VoiceBar model={{ show: true, mic: "on", muted: false, talkers: [], listenersOnly: [], ...p }} onMute={noop} onEnd={noop} />,
  );

describe("P28d VoiceRequestDialog (müşteri, AC-116 kalıbı)", () => {
  const html = renderToStaticMarkup(
    <VoiceRequestDialog request={{ callId: "c1", name: "Ayşe" }} listenerNames={["Mehmet"]} onAccept={noop} onReject={noop} />,
  );
  it("alertdialog, başlık '<ad> sesli görüşme istiyor', ilk odak Reddet", () => {
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain("Ayşe sesli görüşme istiyor");
    expect(tagOf(html, "voice-reject")).toContain("data-autofocus");
    expect(disabled(html, "voice-reject")).toBe(false);
  });
  it("'Kabul et' ilk çizimde kilitli (1,5 sn), dinleyecekler ve kulaklık önerisi görünür", () => {
    expect(disabled(html, "voice-accept")).toBe(true);
    expect(html).toContain("Görüşmeyi dinleyecekler: Mehmet");
    expect(html).toContain("Yankı olmaması için kulaklık kullanmanız önerilir.");
  });
  it("istek yokken içerik çizilmez", () => {
    const none = renderToStaticMarkup(<VoiceRequestDialog request={null} listenerNames={[]} onAccept={noop} onReject={noop} />);
    expect(none).not.toContain("voice-accept");
  });
});

describe("P28d VoiceBar (müşteri görüşme çubuğu, AC-374, Y-PD-3)", () => {
  it("show=false → çizilmez", () => {
    expect(bar({ show: false })).toBe("");
  });
  it("mikrofon açık: 'Mikrofon açık' polite durum, Konuşan / Dinleyen, Sessize al, Görüşmeyi bitir", () => {
    const h = bar({ talkers: ["Ayşe"], listenersOnly: ["Mehmet"] });
    expect(h).toMatch(/role="status" aria-live="polite"[^>]*data-testid="voice-bar-mic"/);
    expect(h).toContain("Mikrofon açık");
    expect(h).toContain("Konuşan: Ayşe");
    expect(h).toContain("Dinleyen: Mehmet");
    expect(h).toContain("Sessize al");
    expect(h).toContain("Görüşmeyi bitir");
  });
  it("kabul sonrası açılırken gösterge 'Mikrofon açılıyor…', sessize alma pasif; sessizde 'Mikrofonu aç'", () => {
    const o = bar({ mic: "opening" });
    expect(o).toContain("Mikrofon açılıyor…");
    expect(disabled(o, "voice-bar-mute")).toBe(true);
    expect(disabled(bar({}), "voice-bar-mute")).toBe(false);
    const m = bar({ muted: true });
    expect(m).toContain("Sessizde");
    expect(m).toContain("Mikrofonu aç");
  });
});

describe("P28d VoiceAnnounce (yeni dinleyici, aria-live=assertive)", () => {
  it("bölge duyuru yokken de monte, şerit yok", () => {
    const h = renderToStaticMarkup(<VoiceAnnounce seq={0} items={[]} onRemove={noop} />);
    expect(h).toContain('aria-live="assertive"');
    expect(h).not.toContain("voice-announce-strip");
  });
  it("duyuru metni + sahip dışındakilere 'Çıkar'", () => {
    const h = renderToStaticMarkup(
      <VoiceAnnounce
        seq={2}
        items={[
          { tid: "a", name: "Mehmet", owner: false },
          { tid: "b", name: "Ayşe", owner: true },
        ]}
        onRemove={noop}
      />,
    );
    expect(h).toContain("Mehmet görüşmeyi dinlemeye başladı");
    expect(h).toContain("Ayşe görüşmeyi dinlemeye başladı");
    expect(h.match(/data-testid="voice-announce-remove"/g)).toHaveLength(1);
    expect(h).toContain('aria-label="Çıkar: Mehmet"');
  });
});
