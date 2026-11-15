/*
 * Dosya transferi ortak modeli (lib/dc/files.ts): sınırlar, kayıt tipleri ve gönderen/alan tarafın paylaştığı liste
 * deposu (`TransferStore`). Dışa açık adlar files.ts'den yeniden verilir.
 */
import { DEFAULT_MAX_FILE_MB, FileReceiveGuard, maxFileBytes } from "@remote/contracts/dc";
import { fileNameWarning } from "@remote/contracts/files";
import type { Sink } from "./file-disk";
import type { CtlMessage, FileDirection, FileMetaMsg } from "./ctl";
import { Sha256 } from "./sha256";

const DEFAULT_MAX_FILE_BYTES = maxFileBytes(DEFAULT_MAX_FILE_MB);

/** Ad için tehlike sınıfı (contracts `fileNameWarning`): tehlikeli uzantı ve/veya çift uzantı (`fatura.pdf.exe`). */
export function fileRisk(name: string): { dangerous: boolean; double: boolean } {
  const w = fileNameWarning(name);
  return { dangerous: w !== "none", double: w === "double_extension" };
}

/** SHA-256 hex; Blob parça parça okunur (dosyanın tamamı belleğe alınmaz). */
export async function sha256Hex(data: ArrayBuffer | Blob): Promise<string> {
  const h = new Sha256();
  if (!(data instanceof Blob)) return h.update(new Uint8Array(data)).hex();
  for (let off = 0; off < data.size; off += HASH_SLICE) h.update(new Uint8Array(await data.slice(off, off + HASH_SLICE).arrayBuffer()));
  return h.hex();
}
const HASH_SLICE = 4 * 1024 * 1024;

/** Gelen teklif sınırı: pencerede en çok N; aşan teklif hiç işlenmez (ret/meta yok — gönderen zaman aşımıyla çözer). */
export const OFFER_LIMIT = { max: 3, windowMs: 10_000 };
/** Gönderenin kendi teklif penceresi: alıcının sınırı + ağ gecikmesi payı (alıcı damgaları varışta alır). */
export const SELF_OFFER_LIMIT = { max: OFFER_LIMIT.max, windowMs: OFFER_LIMIT.windowMs + 1_000 };
/** Gönderilen teklife bu süre içinde kabul/ret gelmezse teklif "Yanıt yok" ile kapanır (TEST-P5-1). */
export const OFFER_TIMEOUT_MS = 30_000;
/** Karşı tarafın tetiklediği REJECTED/CANCELLED meta sınırı (sunucu kotasını ve WS bucket'ını korur). */
export const PEER_META_LIMIT = { max: 5, windowMs: 60_000 };
/** Tutulan en çok kayıt (Map + liste); otomatik ret satırı listede en çok AUTO_KEEP. */
const KEEP = 100;
export const AUTO_KEEP = 20;
const TERMINAL = new Set<TransferStatus>(["ok", "corrupt", "rejected", "cancelled", "tooLarge", "busy", "timeout"]);
/** file.done sonrası eksik parçalar için bekleme; dolunca eksikse bozuk sayılır. */
export const DONE_WAIT_MS = 10_000;

export type TransferStatus =
  | "offered" // gönderen: karşı tarafın kararı bekleniyor
  | "pending" // alıcı: kullanıcının kararı bekleniyor
  | "hashing" // gönderen: özet hesaplanıyor
  | "sending"
  | "receiving"
  | "verifying"
  | "ok"
  | "corrupt"
  | "rejected"
  | "cancelled"
  | "tooLarge"
  | "busy"
  | "timeout"; // gönderen: teklife OFFER_TIMEOUT_MS içinde yanıt gelmedi

export interface Transfer {
  fid: string;
  dir: "out" | "in";
  /** Temizlenmiş ad (gelen) / yerel ad (giden). */
  name: string;
  size: number;
  done: number;
  status: TransferStatus;
  dangerous: boolean;
  double: boolean;
  /** Doğrulanmış gelen dosyanın indirme adresi (object URL). */
  url?: string;
  /** Otomatik ret nedeni (yetki/bekleme/meşgul). */
  auto?: "caps" | "cooldown" | "busy" | "tooLarge";
}

export interface OutState {
  t: Transfer;
  idx: number;
  file: Blob;
  sha: string;
  abort: boolean;
  /** Gönderen raporu (file.meta) bir kez gönderildi. */
  reported?: boolean;
  /** Teklif zaman aşımı (yalnız "offered" iken kurulu). */
  offerTimer?: ReturnType<typeof setTimeout>;
}
export interface InState {
  t: Transfer;
  idx: number;
  sha: string;
  sink: Sink;
  hash: Sha256;
  guard: FileReceiveGuard;
  /** file.done ctl'den geldi ama son parçalar file kanalında henüz yolda (iki DC arasında sıra garantisi yok). */
  doneTimer?: ReturnType<typeof setTimeout>;
}

export interface FileChannelLike {
  readonly readyState: string;
  bufferedAmount: number;
  bufferedAmountLowThreshold: number;
  send(data: Uint8Array<ArrayBuffer>): void;
  addEventListener(type: "bufferedamountlow", fn: () => void): void;
  removeEventListener(type: "bufferedamountlow", fn: () => void): void;
}

export interface TransferDeps {
  /** Bu tarafa gelen dosyanın yönü (müşteri sayfası: TO_CUSTOMER, konsol: TO_TECH). */
  inbound: FileDirection;
  sendCtl: (m: CtlMessage) => void;
  file: FileChannelLike;
  sendMeta: (m: FileMetaMsg) => void;
  onChange: (list: Transfer[]) => void;
  maxBytes?: number;
  /** G-09: false → gelen teklif otomatik reddedilir, gönderim yapılmaz. */
  allowed: () => boolean;
  now?: () => number;
  /** Yalnız e2e (NEXT_PUBLIC_RS_E2E=1): giden özeti bozar → alıcıda AC-54 yolu. */
  corruptSha?: () => boolean;
  /** Yalnız e2e (NEXT_PUBLIC_RS_E2E=1): parça başına gecikme (ms) → iptal testi aktarımı gözleyebilsin (AC-53). */
  chunkDelayMs?: () => number;
  /** Teklif zaman aşımı (ms); varsayılan OFFER_TIMEOUT_MS. e2e kancası (NEXT_PUBLIC_RS_E2E=1) kısaltır. */
  offerTimeoutMs?: () => number;
  /** false → gönderenin kendi teklif sınırı atlanır (yalnız e2e: alıcıda düşme + zaman aşımı yolu). */
  selfThrottle?: () => boolean;
  /** P28a: giden yönde başka aktarım (uzaktan yazdırma) sürüyor → dosya teklifi "busy". */
  extBusy?: () => boolean;
}

/** Gönderen ve alan tarafın ortak kayıtları: Map'ler + gösterilen liste (değişince `onChange`). */
export class TransferStore {
  readonly out = new Map<string, OutState>();
  readonly inc = new Map<string, InState>();
  list: Transfer[] = [];
  readonly max: number;
  readonly now: () => number;
  /** Giden `fidIndex` sayacı — dosya ve yazdırma tek ortak sayaç (r2 O-P28a-2); uint16'da sarar. */
  private outIdx = 0;

  constructor(readonly d: TransferDeps) {
    this.max = d.maxBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.now = d.now ?? Date.now;
  }

  nextIdx(): number {
    return this.outIdx++ & 0xffff;
  }

  put(t: Transfer) {
    const i = this.list.findIndex((x) => x.fid === t.fid && x.dir === t.dir);
    this.list = i < 0 ? [...this.list, t] : this.list.map((x, j) => (j === i ? t : x));
    if (i < 0) this.prune();
    this.d.onChange(this.list);
  }
  set(st: { t: Transfer }, patch: Partial<Transfer>) {
    st.t = { ...st.t, ...patch };
    this.put(st.t);
  }
  /** S-P5-2: Map'ler ve liste sınırlı; önce en eski bitmiş kayıtlar düşer (aktif/bekleyen korunur). */
  prune() {
    const drop = new Set<string>();
    const auto = this.list.filter((x) => x.auto);
    for (const x of auto.slice(0, Math.max(0, auto.length - AUTO_KEEP))) drop.add(`${x.dir}.${x.fid}`);
    for (const [dir, m] of [
      ["in", this.inc],
      ["out", this.out],
    ] as const) {
      let n = m.size;
      for (const [fid, s] of m) {
        if (n <= KEEP) break;
        if (TERMINAL.has(s.t.status)) {
          drop.add(`${dir}.${fid}`);
          n--;
        }
      }
    }
    if (!drop.size) return;
    this.dropKeys(drop);
  }
  private dropKeys(drop: Set<string>) {
    for (const k of drop) {
      const [dir, fid] = [k.slice(0, k.indexOf(".")), k.slice(k.indexOf(".") + 1)];
      const s = dir === "in" ? this.inc.get(fid) : this.out.get(fid);
      if (dir === "in" && s?.t.url) URL.revokeObjectURL(s.t.url);
      if (dir === "in") this.inc.delete(fid);
      else this.out.delete(fid);
    }
    this.list = this.list.filter((x) => !drop.has(`${x.dir}.${x.fid}`));
  }
}
