/*
 * Yeni talep sesi (AC-149): WebAudio ile kısa iki tonlu uyarı — yeni bağımlılık/ses dosyası yok (mimari-e9 §1).
 * Tercih tarayıcıda saklanır (kullanıcı başına; sunucu tercihi P12). Tarayıcı sesi engellerse (autoplay politikası)
 * sessizce geçilir; görsel bildirim (toast + rozet) her durumda gösterilir.
 */
const SOUND_KEY = "rs.requests.sound";

export function readSoundPref(storage: Pick<Storage, "getItem"> | null = safeStorage()): boolean {
  return storage?.getItem(SOUND_KEY) !== "off";
}

export function writeSoundPref(on: boolean, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  storage?.setItem(SOUND_KEY, on ? "on" : "off");
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

let ctx: AudioContext | null = null;

/** true → çalındı; false → engellendi/desteklenmiyor. */
export async function playChime(): Promise<boolean> {
  try {
    const AC = globalThis.AudioContext;
    if (!AC) return false;
    ctx ??= new AC();
    if (ctx.state === "suspended") await ctx.resume();
    if (ctx.state !== "running") return false;
    const now = ctx.currentTime;
    for (const [i, f] of [880, 1320].entries()) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now + i * 0.16);
      g.gain.exponentialRampToValueAtTime(0.15, now + i * 0.16 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.16 + 0.15);
      o.connect(g).connect(ctx.destination);
      o.start(now + i * 0.16);
      o.stop(now + i * 0.16 + 0.16);
    }
    return true;
  } catch {
    return false;
  }
}
