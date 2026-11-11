/*
 * Uzaktan girdi eşlemesi (AC-48, 49; mimari-protokol §4.3) — saf fonksiyonlar, DOM olayından `input` DC mesajına.
 * Fare: görüntünün GÖRÜNEN içerik alanına (object-contain boşlukları hariç) göre 0..1 normalize; 5 ondalık
 * (4K'da < 0,04 px yuvarlama, AC-49 ±2 px). Klavye: `code` her zaman; tek kod noktalı basılabilir karakterde
 * `key` (Türkçe ç ğ ı ö ş ü İ → istemci KEYEVENTF_UNICODE). Ctrl+Alt+Del konsoldan gönderilemez (AC-48).
 */
import { contentRect } from "@/lib/dc/annot";
import { WHEEL_MAX, type InputMsg, type MouseButton } from "./protocol";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const round5 = (v: number) => Math.round(v * 1e5) / 1e5;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * İstemci koordinatı → normalize nokta. `clamp=false` iken içerik alanı dışı → null (hareket/tık gönderilmez);
 * `clamp=true` (sürükleme, bırakma) sınıra kırpılır — takılı düğme kalmasın.
 */
export function pointFromClient(clientX: number, clientY: number, video: Box, vidW: number, vidH: number, clamp = false): [number, number] | null {
  const r = contentRect(video.width, video.height, vidW, vidH);
  if (r.w <= 0 || r.h <= 0) return null;
  const x = (clientX - video.left - r.x) / r.w;
  const y = (clientY - video.top - r.y) / r.h;
  if (!clamp && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
  return [round5(clamp01(x)), round5(clamp01(y))];
}

/**
 * TEST-P7-1: "%100" görünümünün CSS boyutu. Alınan akış WebRTC tarafından küçültülebilir (bant genişliği, ilk
 * saniyeler 320×180 gibi); doğal video boyutunda çizmek uzak ekranla 1:1 değildir ve teknisyen tıkladığı pikselin
 * uzakta başka piksele düştüğünü görür. Monitör çözünürlüğü (`share.state.monitors[].w×h`) biliniyor ve en-boy
 * oranı akışla uyumluysa (±%2) o boyut kullanılır; değilse doğal video boyutu. Normalizasyon (pointFromClient)
 * her durumda çizilen kutuya göredir — bu yalnız 1:1 görünümü düzeltir.
 */
export function actualViewSize(native: { w: number; h: number } | null, vidW: number, vidH: number): { w: number; h: number } | null {
  if (native && native.w > 0 && native.h > 0) {
    if (!vidW || !vidH || Math.abs(native.w / native.h - vidW / vidH) <= 0.02 * (native.w / native.h)) return { w: native.w, h: native.h };
  }
  return vidW && vidH ? { w: vidW, h: vidH } : null;
}

/** PointerEvent.button → protokol düğmesi (0 sol, 1 orta, 2 sağ); diğerleri (geri/ileri) gönderilmez. */
export function mouseButton(button: number): MouseButton | null {
  return button === 0 ? "l" : button === 1 ? "m" : button === 2 ? "r" : null;
}

/**
 * WheelEvent → `m.wheel`. Birim Windows WHEEL_DELTA'dır (bir çentik = 120): piksel kipinde Chromium çentik başına
 * ~100 px verir → ×1,2; satır kipinde 3 satır = 1 çentik → ×40; sayfa kipinde ×1200. Yön DOM yönüdür
 * (pozitif dy = aşağı, pozitif dx = sağa); istemci MOUSEEVENTF_WHEEL'de dy işaretini ters çevirir.
 */
export function wheelMsg(deltaX: number, deltaY: number, deltaMode: number): InputMsg | null {
  const f = deltaMode === 1 ? 40 : deltaMode === 2 ? WHEEL_MAX : 1.2;
  const c = (v: number) => Math.max(-WHEEL_MAX, Math.min(WHEEL_MAX, Math.round(v * f)));
  const dx = c(deltaX);
  const dy = c(deltaY);
  return dx === 0 && dy === 0 ? null : { t: "m.wheel", dx: dx || 0, dy: dy || 0 };
}

export interface KeyLike {
  type: string;
  code: string;
  key: string;
  isComposing?: boolean;
}

/** Tek kod noktası ve ≤ 4 UTF-16 birimi olan basılabilir karakter mi ("Enter", "Dead", "Unidentified" değil). */
export function printableKey(key: string): boolean {
  // Tek kod noktası; denetim karakterleri (U+0000–001F, U+007F) yazdırılabilir sayılmaz
  return key.length > 0 && key.length <= 4 && [...key].length === 1 && !/^[\u0000-\u001f\u007f]$/.test(key);
}

/** Sözleşme (contracts dc.ts `keySchema`, Go istemci): `code` yalnız harf/rakam, 1..32. */
export const KEY_CODE = /^[A-Za-z0-9]{1,32}$/;

/** KeyboardEvent → `k`. IME birleştirmesi ve kodsuz olay (sanal klavye) gönderilmez. */
export function keyMsg(e: KeyLike): InputMsg | null {
  if (e.isComposing || !KEY_CODE.test(e.code) || e.code === "Unidentified") return null;
  if (e.type !== "keydown" && e.type !== "keyup") return null;
  return { t: "k", code: e.code, down: e.type === "keydown", ...(printableKey(e.key) ? { key: e.key } : {}) };
}

const MODS = { ctrl: ["ControlLeft", "ControlRight"], alt: ["AltLeft", "AltRight"], shift: ["ShiftLeft", "ShiftRight"] } as const;
const isMod = (code: string) => Object.values(MODS).some((g) => (g as readonly string[]).includes(code));

/**
 * Klavye yakalamadan çıkış kısayolu: Ctrl + Alt + Shift birlikte basılıp başka tuşa basılmadan bırakılır
 * (tarayıcıdaki uzak masaüstü araçlarının yaygın kalıbı). Tab vb. uzak ekrana gittiği için klavyeyle çıkış yolu budur.
 * `feed` true dönerse yakalama bırakılmalıdır.
 */
export function releaseComboTracker() {
  const down = new Set<string>();
  let armed = false;
  let spoiled = false;
  return {
    feed(e: { type: string; code: string }): boolean {
      if (e.type === "keydown") {
        if (!isMod(e.code)) spoiled = true;
        down.add(e.code);
        if ((["ctrl", "alt", "shift"] as const).every((g) => MODS[g].some((c) => down.has(c)))) armed = true;
        return false;
      }
      down.delete(e.code);
      if (down.size > 0) return false;
      const hit = armed && !spoiled;
      armed = false;
      spoiled = false;
      return hit;
    },
    reset() {
      down.clear();
      armed = false;
      spoiled = false;
    },
  };
}

/**
 * Tarayıcının/işletim sisteminin yakaladığı kombinasyonlar için "Özel tuşlar" (AC-48: Alt+Tab, Win kombinasyonları).
 * Tam ekranda Keyboard Lock API (Chromium) bunları doğrudan da yakalar. Ctrl+Alt+Del bilinçli olarak YOK.
 */
export const SPECIAL_COMBOS = [
  { id: "altTab", codes: ["AltLeft", "Tab"] },
  { id: "win", codes: ["MetaLeft"] },
  { id: "winD", codes: ["MetaLeft", "KeyD"] },
  { id: "winR", codes: ["MetaLeft", "KeyR"] },
  { id: "winE", codes: ["MetaLeft", "KeyE"] },
  { id: "altF4", codes: ["AltLeft", "F4"] },
  { id: "taskManager", codes: ["ControlLeft", "ShiftLeft", "Escape"] },
  { id: "printScreen", codes: ["PrintScreen"] },
] as const;
export type SpecialComboId = (typeof SPECIAL_COMBOS)[number]["id"];

/** Kombinasyon → sırayla basış, ters sırayla bırakış (`key` yok: istemci sanal tuş kodunu kullanır). */
export function comboMsgs(codes: readonly string[]): InputMsg[] {
  return [...codes.map((code) => ({ t: "k" as const, code, down: true })), ...[...codes].reverse().map((code) => ({ t: "k" as const, code, down: false }))];
}
