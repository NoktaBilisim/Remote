import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatNumber } from "@/lib/format";
import type { Sample } from "@/lib/webrtc/stats";
import { QualityPanel } from "./quality-panel";

const sample = (audioLossPct: number | null): Sample => ({
  at: 1000,
  fps: 30,
  kbps: 1200,
  rttMs: 20,
  lossPct: 0,
  audioLossPct,
  width: 1280,
  height: 720,
  connType: "host",
});

describe("AC-376 kalite paneli ses kaybı satırı (§8)", () => {
  it("audioLossPct değerliyken 'Ses kaybı %x' satırı görünür", () => {
    const html = renderToStaticMarkup(<QualityPanel last={sample(6.25)} verdict={{ level: "ok", issues: [] }} />);
    expect(html).toContain("<dt");
    expect(html).toMatch(new RegExp(`Ses kaybı</dt><dd[^>]*>%${formatNumber(6.25, 1)}</dd>`));
  });

  it("audioLossPct null iken (görüşme yok) satır yok", () => {
    const html = renderToStaticMarkup(<QualityPanel last={sample(null)} verdict={{ level: "ok", issues: [] }} />);
    expect(html).toContain('data-testid="quality-panel"');
    expect(html).not.toContain("Ses kaybı");
  });

  it("sürekli ses kaybı sorunu seviye rozetinde metinle", () => {
    const html = renderToStaticMarkup(<QualityPanel last={sample(12)} verdict={{ level: "bad", issues: ["audioLoss"] }} />);
    expect(html).toContain('data-level="bad"');
    expect(html).toContain("ses kaybı yüksek");
  });
});
