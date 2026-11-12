// RFC 6238 TOTP (SHA-1, 6 hane, 30 sn) — base32 sırdan.
import { createHmac } from "node:crypto";
export function b32(s) { const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = ""; for (const c of s.replace(/[\s=-]/g, "").toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, "0"); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
export function totp(secret, t = Date.now(), step = 0) { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(t / 30000) + step)); const h = createHmac("sha1", b32(secret)).update(c).digest(); const o = h[h.length - 1] & 15; return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0"); }
/** Aynı 30 sn penceresinde ikinci kullanım reddedilebilir; pencere sonuna 3 sn'den az varsa bekle. */
export async function freshTotp(secret, used = new Set()) { for (;;) { const now = Date.now(); const left = 30000 - (now % 30000); const code = totp(secret, now); if (left > 3000 && !used.has(code)) { used.add(code); return code; } await new Promise((r) => setTimeout(r, left + 200)); } }
