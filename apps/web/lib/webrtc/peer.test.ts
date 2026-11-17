import { describe, expect, it, vi } from "vitest";
import { PeerLink } from "./peer";

/** RTCPeerConnection node'da yok: yalnız ses transceiver'ı taşıyan sahte `pc` ile `setAudioTrack` sınanır. */
function fakeLink(fail: (t: MediaStreamTrack | null) => boolean) {
  const sender = {
    track: null as MediaStreamTrack | null,
    replaceTrack: vi.fn(async (t: MediaStreamTrack | null) => {
      if (fail(t)) throw new DOMException("bağlanamadı", "InvalidModificationError");
      sender.track = t;
    }),
  };
  const pc = { getTransceivers: () => [{ receiver: { track: { kind: "audio" } }, sender }] };
  const link = Object.create(PeerLink.prototype) as PeerLink;
  Object.assign(link, { pc, audioOut: null, onAudioError: null });
  return { link, sender };
}
const mic = { id: "mic" } as unknown as MediaStreamTrack;

describe("P28d PeerLink.setAudioTrack (QA P28d tur 1 öneri)", () => {
  it("replaceTrack reddi yutulmaz: gönderici susturulur (null) ve onAudioError çağrılır", async () => {
    const { link, sender } = fakeLink((t) => t !== null);
    const onErr = vi.fn();
    link.onAudioError = onErr;
    await link.setAudioTrack(mic);
    expect(sender.replaceTrack.mock.calls.map((c) => c[0])).toEqual([mic, null]);
    expect(sender.track).toBeNull();
    expect(onErr).toHaveBeenCalledTimes(1);
  });

  it("null bağlama hatası sessiz (bırakma yolu yeniden girmez); başarıda bildirim yok", async () => {
    const bad = fakeLink(() => true);
    bad.sender.track = mic;
    const onErr = vi.fn();
    bad.link.onAudioError = onErr;
    await bad.link.setAudioTrack(null);
    expect(onErr).not.toHaveBeenCalled();

    const ok = fakeLink(() => false);
    ok.link.onAudioError = onErr;
    await ok.link.setAudioTrack(mic);
    expect(ok.sender.track).toBe(mic);
    expect(onErr).not.toHaveBeenCalled();
  });
});
