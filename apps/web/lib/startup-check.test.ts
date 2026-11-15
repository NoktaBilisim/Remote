// P14a (AC-217): production açılış kontrolü — sır yok/kısa → mesajı yazıp exit(1); geçerli sır → exit çağrılmaz.
// process.exit taklit edilir (gerçek süreç sonlanmaz); sır değeri log mesajında yer almaz.
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertEdgeSecretOrExit } from "./startup-check";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("assertEdgeSecretOrExit (AC-217)", () => {
  it("AC-217: production'da EDGE_PROXY_SECRET yoksa hata yazar ve exit(1)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EDGE_PROXY_SECRET", "");
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    assertEdgeSecretOrExit();
    expect(exit).toHaveBeenCalledWith(1);
    expect(err.mock.calls[0]?.[0]).toMatch(/açılış durduruldu: EDGE_PROXY_SECRET gerekli/);
  });

  it("AC-217: production'da kısa sır da reddedilir; sır değeri loga yazılmaz", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EDGE_PROXY_SECRET", "kisa-sir-degeri");
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    assertEdgeSecretOrExit();
    expect(exit).toHaveBeenCalledWith(1);
    expect(String(err.mock.calls[0]?.[0])).not.toContain("kisa-sir-degeri");
  });

  it("AC-217: geçerli sırda exit çağrılmaz", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EDGE_PROXY_SECRET", "x".repeat(48));
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    assertEdgeSecretOrExit();
    expect(exit).not.toHaveBeenCalled();
  });
});
