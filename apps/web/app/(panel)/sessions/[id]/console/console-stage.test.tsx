import type { SessionView } from "@remote/contracts/api/sessions";
import { createRef, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DrawTool } from "@/components/collab/annot-layer";
import { initialControl, type ControlState } from "@/lib/control/machine";
import { initialAnnot } from "@/lib/dc/annot";
import type { Collab } from "@/lib/dc/use-collab";
import { initialTech, type TechState } from "@/lib/webrtc/tech-machine";
import { activeDrawTool, comboSender, ConsoleStage } from "./console-stage";

// AC-498 r2: kontrol açıkken çizim. Sahne SSR işaretlemesiyle doğrulanır (jsdom yok; Esc ve gerçek olaylar e2e'de).
const live: TechState = { ...initialTech, phase: "live", guest: { name: "Ayşe", kind: "AGENT" }, share: "sharing" };
const granted: ControlState = { ...initialControl, phase: "granted", requests: 1 };

function setup(control: ControlState, tool: DrawTool | null, seatLock: string | null = null) {
  const ts = {
    state: live,
    control,
    stream: null,
    input: null,
    admit: vi.fn(),
    reject: vi.fn(),
    requestControl: vi.fn(),
    releaseControl: vi.fn(),
    cancelControl: vi.fn(),
    requestMonitor: vi.fn(),
  };
  const collab = { ready: true, annot: initialAnnot, sendAnnot: vi.fn() } as unknown as Collab;
  const onTool = vi.fn();
  const props = {
    ts,
    session: { techVerifyCode: "123456", code: "123456789" } as unknown as SessionView,
    collab,
    draw: { tool, color: "red", onTool, onColor: vi.fn() },
    canControl: true,
    seatLock,
    now: 0,
    releaseRef: createRef<HTMLButtonElement>(),
  } as unknown as ComponentProps<typeof ConsoleStage>;
  return { html: renderToStaticMarkup(<ConsoleStage {...props} />), ts, onTool };
}

const canvas = (html: string) => /<canvas[^>]*data-testid="annot-layer"[^>]*>/.exec(html)?.[0] ?? "";
const penTag = (html: string) => /<button[^>]*data-testid="annot-pen"[^>]*>/.exec(html)?.[0] ?? "<yok>";
const scroll = (html: string) => /<div[^>]*data-testid="stage-scroll"[^>]*>/.exec(html)?.[0] ?? "";

describe("AC-498 r2: kontrol açıkken çizim (konsol sahnesi)", () => {
  it("kontrol açık + araç seçili → girdi yakalanmaz, kontrol açık kalır, çizim katmanı girdiyi alır, ipucu görünür", () => {
    const { html, ts } = setup(granted, "pen");
    expect(html).toContain('data-control="on"'); // kırmızı çerçeve: kontrol hâlâ açık
    expect(html).toContain('data-capture="paused"');
    expect(html).toContain("border-control-frame");
    expect(scroll(html)).not.toContain('role="application"');
    expect(canvas(html)).toContain("cursor-crosshair");
    expect(penTag(html)).toContain('aria-pressed="true"');
    expect(penTag(html)).not.toContain(' disabled=""');
    expect(html).toContain("Çizim modu — fare ve klavye duraklatıldı");
    expect(html).toContain('data-drawing="on"');
    expect(html).not.toContain('data-testid="special-keys"'); // özel tuşlar uzak bilgisayara gitmez → gizli
    expect(html).toContain('data-testid="control-release"'); // kontrol bırakılmadı
    expect(ts.releaseControl).not.toHaveBeenCalled();
    expect(ts.requestControl).not.toHaveBeenCalled();
  });

  it("araç kapanınca yakalama geri gelir (aynı kontrol durumu, yeni istek yok); araç çubuğu kontrolde de etkin", () => {
    const { html, ts } = setup(granted, null);
    expect(html).toContain('data-control="on"');
    expect(html).toContain('data-capture="on"');
    expect(scroll(html)).toContain('role="application"');
    expect(canvas(html)).toContain("pointer-events-none");
    expect(html).toContain('data-testid="annot-toolbar"');
    expect(penTag(html)).not.toContain(' disabled=""');
    expect(html).not.toContain("Çizim modu");
    expect(html).toContain('data-testid="special-keys"');
    expect(ts.requestControl).not.toHaveBeenCalled();
    expect(ts.releaseControl).not.toHaveBeenCalled();
  });

  it("P28c: kontrol sahibi değilse araç etkisiz (seçili kalsa da) ve araç çubuğu pasif", () => {
    const { html } = setup(initialControl, "pen", "Yalnız kontrol sahibi kullanabilir");
    expect(canvas(html)).toContain("pointer-events-none");
    expect(penTag(html)).toContain(' disabled=""');
    expect(html).not.toContain("Çizim modu");
  });

  it("etkin araç: kontrol sahibi değil veya kanal hazır değil → yok", () => {
    expect(activeDrawTool("pen", true, null)).toBe("pen");
    expect(activeDrawTool("pen", true, "kilit")).toBeNull();
    expect(activeDrawTool("pen", false, null)).toBeNull();
    expect(activeDrawTool(null, true, null)).toBeNull();
  });

  it("özel tuşlar yalnız yakalama sürerken gönderilir (çizim modunda gitmez)", () => {
    const send = vi.fn();
    const ch = { readyState: "open", send } as unknown as RTCDataChannel;
    comboSender(ch, false)("altTab");
    expect(send).not.toHaveBeenCalled();
    comboSender(ch, true)("altTab");
    expect(send).toHaveBeenCalled();
  });
});
