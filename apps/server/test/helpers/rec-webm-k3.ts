// P28e K3 test fikstürü: küçük EBML/WebM yapıcı (MediaRecorder biçimi; gerçek kodlanmış kare yok).
import { randomBytes } from "node:crypto";

// --- EBML yapıcı (test fikstürü) ---
const vint = (n: number): Buffer => {
  for (let len = 1; len <= 8; len++)
    if (n < 2 ** (7 * len) - 1) {
      const b = Buffer.alloc(len);
      let v = n;
      for (let i = len - 1; i >= 0; i--) {
        b[i] = v & 0xff;
        v = Math.floor(v / 256);
      }
      b[0] = (b[0] ?? 0) | (0x80 >> (len - 1));
      return b;
    }
  throw new Error("büyük");
};
const idBuf = (id: number): Buffer =>
  Buffer.from(id.toString(16).padStart(id > 0xffffff ? 8 : id > 0xffff ? 6 : id > 0xff ? 4 : 2, "0"), "hex");
export const el = (id: number, ...kids: Buffer[]): Buffer => {
  const data = Buffer.concat(kids);
  return Buffer.concat([idBuf(id), vint(data.length), data]);
};
export const str = (id: number, s: string): Buffer => el(id, Buffer.from(s, "latin1"));
export const u8 = (id: number, v: number): Buffer => el(id, Buffer.from([v]));
const UNKNOWN_SIZE = Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
export const track = (type: number, codec: string): Buffer => el(0xae, u8(0xd7, 1), u8(0x83, type), str(0x86, codec));

/** MediaRecorder biçimi: EBML + bilinmeyen boyutlu Segment(Info, Tracks, Cluster…). */
export function webm(tracks: Buffer[], docType = "webm", clusterFirst = false): Buffer {
  const head = el(0x1a45dfa3, u8(0x4286, 1), str(0x4282, docType));
  const info = el(0x1549a966, u8(0x2ad7b1, 1));
  const cluster = el(0x1f43b675, u8(0xe7, 0), el(0xa3, randomBytes(64)));
  const body = clusterFirst ? [info, cluster, el(0x1654ae6b, ...tracks)] : [info, el(0x1654ae6b, ...tracks), cluster];
  return Buffer.concat([head, idBuf(0x18538067), UNKNOWN_SIZE, ...body]);
}
export const VIDEO_WEBM = (): Buffer => webm([track(1, "V_VP8")]);
export const CLUSTER_PART = (n = 256): Buffer => el(0x1f43b675, u8(0xe7, 5), el(0xa3, randomBytes(n)));
