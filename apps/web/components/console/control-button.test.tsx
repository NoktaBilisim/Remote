import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { initialControl, type ControlState } from "@/lib/control/machine";
import { ControlButton } from "./control-button";

const released: ControlState = { ...initialControl, phase: "ended", endedBy: "tech", endedAt: null, requests: 1 };
const noop = () => {};
const render = (s: ControlState, unattended?: boolean) =>
  renderToStaticMarkup(
    <ControlButton
      s={s}
      now={0}
      available
      onRequest={noop}
      onRelease={noop}
      onCancel={noop}
      onKeys={noop}
      releaseRef={createRef<HTMLButtonElement>()}
      {...(unattended === undefined ? {} : { unattended })}
    />,
  );

describe("P30 kontrolü bırakınca not metni", () => {
  it("Hızlı Destek: müşteri yeniden onaylamalı", () => {
    const html = render(released);
    expect(html).toContain("Kontrole devam");
    expect(html).toContain("müşteri yeniden onaylamalı");
  });

  it("gözetimsiz: onay metni yok, çizim + Kontrole devam açıklaması var", () => {
    const html = render(released, true);
    expect(html).toContain("Kontrole devam");
    expect(html).not.toContain("onaylamalı");
    expect(html).toContain("Çizim araçları açıldı");
  });

  it("gözetimsiz ama başka neden (müşteri kapattı): kendi metni korunur", () => {
    const html = render({ ...released, endedBy: "customer" }, true);
    expect(html).toContain("Kontrol müşteri tarafından kapatıldı");
    expect(html).not.toContain("Çizim araçları açıldı");
  });
});
